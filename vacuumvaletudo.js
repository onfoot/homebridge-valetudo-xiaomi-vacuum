const { sendJSONRequest } = require('./request');
const types = require('./types');

class VacuumValetudo {
  constructor(log, config, statusCallback) {
    const powerControl = config['power-control'];

    if (powerControl) {
      const defaultSpeedValue = VacuumValetudo.getSpeedValue(powerControl['default-speed'] || 'balanced');
      const highSpeedValue = VacuumValetudo.getSpeedValue(powerControl['high-speed'] || 'max');

      this.powerControl = {
        defaultSpeed: defaultSpeedValue,
        highSpeed: highSpeedValue,
        mop: powerControl['mop-enabled'] === true,
      };

      this.log.debug(`Setting power control: default speed - ${this.powerControl.defaultSpeed}, high speed - ${this.powerControl.highSpeed}, mop enabled - ${this.powerControl.mop}`);
    }

    this.ip = config.ip;
    this.log = log;

    this.current_status = null;
    this.status_callbacks = [];
    this.current_status_time = null;
    this.status_timer = null;

    this.idle_update_interval = 120000;
    this.busy_update_interval = 10000;
    this.status_callback = statusCallback;

    if (!this.ip) {
      throw Error('You must provide an ip address of the vacuum cleaner.');
    }
  }

  static statusUrl(ip) {
    return `http://${ip}/api/v2/robot/state/attributes`;
  }

  static parseStatus(response) {
    const simpleStatus = {};

    response.forEach((value) => {
      // eslint-disable-next-line no-underscore-dangle
      switch (value.__class) {
        case 'StatusStateAttribute':
          simpleStatus.state = value.value;
          simpleStatus.cleaning_mode = value.flag;
          break;
        case 'IntensityStateAttribute':
          simpleStatus.fan_power = value.value;
          break;
        case 'BatteryStateAttribute':
          simpleStatus.battery = value.level;
          simpleStatus.battery_status = value.flag;
          break;
        default:
          break;
      }
    });

    return simpleStatus;
  }

  isHighSpeedMode(callback) {
    this.getStatus(false, (error, status) => {
      if (error) {
        callback(error, false);
      } else {
        callback(null, status.fan_power === this.powerControl.highSpeed);
      }
    });
  }

  isMopMode(callback) {
    this.getStatus(false, (error, status) => {
      if (error) {
        callback(error, false);
      } else {
        callback(null, status.fan_power === VacuumValetudo.SPEEDS.OFF);
      }
    });
  }

  setHighSpeedMode(on, callback) {
    this.isHighSpeedMode((error, isOn) => {
      if (error) {
        callback(error);
      }

      if (on && isOn) {
        callback(null);
        return;
      }
      if (!on && isOn) {
        callback(null);
      }

      if (on) {
        this.setFanSpeed(this.powerControl.highSpeed, callback);
      } else {
        this.setFanSpeed(this.powerControl.defaultSpeed, callback);
      }
    });
  }

  setMopMode(on, callback) {
    this.isMopMode((error, isOn) => {
      if (error) {
        callback(error);
      }

      if (on && isOn) {
        callback(null);
      }

      if (!on && !isOn) {
        callback(null);
      }

      if (on) {
        this.setFanSpeed(VacuumValetudo.SPEEDS.OFF, callback);
      } else {
        this.setFanSpeed(this.powerControl.defaultSpeed, callback);
      }
    });
  }

  async setFanSpeed(value, callback) {
    this.log.debug(`Setting fan power to ${value}`);

    try {
      await sendJSONRequest({
        url: `http://${this.ip}/api/v2/robot/capabilities/FanSpeedControlCapability/preset`, method: 'PUT', content: { name: value }, raw_response: true,
      });
      this.updateStatus(true);
      callback(null);
    } catch (e) {
      this.log.error(`Failed to change fan power: ${e}`);
      callback(e);
    }
  }

  getBatteryLevel(callback) {
    this.getStatus(false, (error, status) => {
      if (error) {
        callback(error, null);
      } else {
        callback(null, status.battery);
      }
    });
  }

  getChargingState(callback) {
    this.getStatus(false, (error, status) => {
      if (error) {
        callback(error);
      } else if (status.battery_status === VacuumValetudo.BATTERY_STATE.CHARGING) {
        callback(null, types.CHARGING_STATE.CHARGING);
      } else if (status.battery_status === VacuumValetudo.BATTERY_STATE.DISCHARGING) {
        callback(null, types.CHARGING_STATE.DISCHARGING);
      } else {
        callback(null, types.CHARGING_STATE.CHARGED);
      }
    });
  }

  async version(callback) {
    try {
      const response = await sendJSONRequest({ url: `http://${this.ip}/api/v2/valetudo/version` });
      if (response != null) {
        callback(null, response.release);
      } else {
        throw Error('Cannot get current version');
      }
    } catch (e) {
      this.log.error(`Error parsing firmware info: ${e}`);
      callback(e);
    }
  }

  async doFind(callback) {
    const { log } = this;

    try {
      await sendJSONRequest({
        url: `http://${this.ip}/api/v2/robot/capabilities/LocateCapability`, method: 'PUT', content: { action: 'locate' }, raw_response: true,
      });
      callback();
    } catch (e) {
      log.error(`Failed to identify robot: ${e}`);
      callback(e);
    }
  }

  async goHome(callback) {
    const { log } = this;

    log.debug('Executing go home');

    try {
      await sendJSONRequest({
        url: `http://${this.ip}/api/v2/robot/capabilities/BasicControlCapability`, method: 'PUT', content: { action: 'home' }, raw_response: true,
      });
    } catch (e) {
      log.error(`Failed to execute go home: ${e}`);
    } finally {
      setTimeout(() => { callback(); this.updateStatus(true); }, 2000);
    }
  }

  isGoingHome(callback) {
    this.getStatus(false, (error, status) => {
      if (error) {
        callback(new Error(`Error retrieving going home status: ${error}`));
        return;
      }

      callback(null, status.state === VacuumValetudo.STATES.RETURNING);
    });
  }

  async startCleaning(callback) {
    this.log.debug('Executing start cleaning');

    try {
      await sendJSONRequest({
        url: `http://${this.ip}/api/v2/robot/capabilities/BasicControlCapability`, method: 'PUT', content: { action: 'start' }, raw_response: true,
      });
      setTimeout(() => { callback(); this.updateStatus(true); }, 2000);
    } catch (e) {
      this.log.error(`Failed to start cleaning: ${e}`);
      setTimeout(() => { callback(); this.updateStatus(true); }, 2000);
    }
  }

  async stopCleaning(callback) {
    this.log.debug('Executing stop cleaning');

    this.getStatus(true, async (err, status) => {
      if (err) {
        callback(err);
        return;
      }

      if (status.state === VacuumValetudo.STATES.ERROR
                  || status.state === VacuumValetudo.STATES.DOCKED
                  || status.state === VacuumValetudo.STATES.IDLE
                  || status.state === VacuumValetudo.STATES.RETURNING
                  || status.state === VacuumValetudo.STATES.MANUAL_CONTROL
                  || status.state === VacuumValetudo.STATES.MOVING) {
        callback(new Error('Cannot stop cleaning in current state'));
      }

      try {
        await sendJSONRequest({
          url: `http://${this.ip}/api/v2/robot/capabilities/BasicControlCapability`, method: 'PUT', content: { action: 'stop' }, raw_response: true,
        });
        setTimeout(() => { callback(); this.updateStatus(true); }, 2000);
      } catch (e) {
        this.log.error(`Failed to stop cleaning: ${e}`);
        setTimeout(() => { callback(); this.updateStatus(true); }, 2000);
      }
    });
  }

  isCleaning(callback) {
    this.getStatus(false, (error, status) => {
      this.log.debug(`Is cleaning? error: ${error}, state: ${status !== null ? status.state : null}`);

      if (error) {
        callback(error);
        return;
      }

      callback(null, status.state === VacuumValetudo.STATES.CLEANING);
    });
  }

  async startSpotCleaning(callback) {
    this.log.debug('Executing spot cleaning');
    try {
      await sendJSONRequest({ url: `http://${this.ip}/api/spot_clean`, method: 'PUT', raw_response: true });
      setTimeout(() => { callback(); this.updateStatus(true); }, 2000);
    } catch (e) {
      this.log.error(`Failed to start spot cleaning: ${e}`);
      setTimeout(() => { callback(); this.updateStatus(true); }, 2000);
    }
  }

  isSpotCleaning(callback) {
    this.getStatus(false, (error, status) => {
      if (error) {
        callback(error);
        return;
      }

      callback(null, status.cleaning_mode === VacuumValetudo.CLEANING_MODES.SPOT);
    });
  }

  updateStatus(forced = false) {
    this.log.debug('Updating vacuum status');
    this.getStatus(forced, (err, status) => {
      if (err) {
        return;
      }
      try {
        this.status_callback(status);
      } catch (e) {
        this.log.error('status callback function errored out');
      }
    });
  }

  updateInterval() {
    if (this.current_status !== null) {
      switch (this.current_status.state) {
        case VacuumValetudo.STATES.DOCKED:
        case VacuumValetudo.STATES.IDLE:
          return this.idle_update_interval; // slow update interval for idle states
        default:
          break;
      }
    }
    return this.busy_update_interval; // fast update interval for non-idle states
  }

  clearUpdateTimer() {
    clearTimeout(this.status_timer);
  }

  setupUpdateTimer() {
    this.status_timer = setTimeout(() => { this.updateStatus(true); }, this.updateInterval());
  }

  async getStatus(forced, callback) {
    if (this.status_callbacks.length > 0) {
      this.log.debug('Pushing status callback to queue - updating');
      this.status_callbacks.push(callback);
      return;
    }

    const now = Date.now();

    if (!forced && this.current_status !== null
              && this.current_status_time !== null
              && (now - this.current_status_time < this.busy_update_interval)) {
      this.log.debug('Returning cached status');
      callback(null, this.current_status);
      return;
    }

    this.clearUpdateTimer();

    this.log.debug(`Executing update, forced: ${forced}`);
    this.status_callbacks.push(callback);

    try {
      const response = await sendJSONRequest({ url: VacuumValetudo.statusUrl(this.ip) });
      this.log.debug('Done executing update');

      const status = VacuumValetudo.parseStatus(response);

      this.current_status = status;
      this.current_status_time = Date.now();
      const callbacks = this.status_callbacks;
      this.status_callbacks = [];

      this.log.debug(`Calling ${callbacks.length} queued callbacks`);
      callbacks.forEach((element) => {
        element(null, status);
      });
      this.setupUpdateTimer();
    } catch (e) {
      this.log.error(`Error parsing current status info: ${e}`);
      const callbacks = this.status_callbacks;
      this.status_callbacks = [];

      callbacks.forEach((element) => {
        element(e, null);
      });

      this.setupUpdateTimer();
    }
  }

  static getSpeedValue(preset) {
    switch (preset) {
      case 'min': return VacuumValetudo.SPEEDS.LOW;
      case 'quiet': return VacuumValetudo.SPEEDS.LOW;
      case 'low': return VacuumValetudo.SPEEDS.LOW;
      case 'medium': return VacuumValetudo.SPEEDS.MEDIUM;
      case 'balanced': return VacuumValetudo.SPEEDS.MEDIUM;
      case 'max': return VacuumValetudo.SPEEDS.HIGH;
      case 'turbo': return VacuumValetudo.SPEEDS.MAX;
      case 'mop': return VacuumValetudo.SPEEDS.OFF;
      default: throw Error(`Invalid power preset given: ${preset}`);
    }
  }
}

VacuumValetudo.STATES = {
  ERROR: 'error',
  DOCKED: 'docked',
  IDLE: 'idle',
  RETURNING: 'returning',
  CLEANING: 'cleaning',
  PAUSED: 'paused',
  MANUAL_CONTROL: 'manual_control',
  MOVING: 'moving',
};

VacuumValetudo.BATTERY_STATE = {
  NONE: 'none',
  CHARGING: 'charging',
  DISCHARGING: 'discharging',
  CHARGED: 'charged',
  MAX: 'max',
};

VacuumValetudo.SPEEDS = {
  OFF: 'off',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  MAX: 'max',
};

VacuumValetudo.CLEANING_MODES = {
  NONE: 'none',
  ZONE: 'zone',
  SECTION: 'section',
  SPOT: 'spot',
  TARGET: 'target',
  RESUMABLE: 'resumable',
};

module.exports = { VacuumValetudo };
