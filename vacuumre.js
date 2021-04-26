const { sendJSONRequest } = require('./request');
const types = require('./types');

class VacuumRe {
  constructor(log, config) {
    const powerControl = config['power-control'];

    if (powerControl) {
      const defaultSpeedValue = VacuumRe.getSpeedValue(powerControl['default-speed'] || 'balanced');
      const highSpeedValue = VacuumRe.getSpeedValue(powerControl['high-speed'] || 'max');

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
      throw new Error('You must provide an ip address of the vacuum cleaner.');
    }
  }

  static statusUrl(ip) {
    return `http://${ip}/api/current_status`;
  }

  static parseStatus(response) {
    return response;
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
        callback(null, status.fan_power === VacuumRe.SPEEDS.mop);
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
        this.setFanSpeed(VacuumRe.SPEEDS.mop, callback);
      } else {
        this.setFanSpeed(this.powerControl.defaultSpeed, callback);
      }
    });
  }

  async setFanSpeed(value, callback) {
    this.log.debug(`Setting fan power to ${value}`);

    try {
      await sendJSONRequest({
        url: `http://${this.ip}/api/fanspeed`, method: 'PUT', content: { speed: value }, raw_response: true,
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
      } else if (status.state === VacuumRe.STATES.CHARGING) {
        callback(null, types.CHARGING_STATE.CHARGING);
      } else if (
        this.current_status.state === VacuumRe.STATES.CHARGER_DISCONNECTED
          || this.current_status.state === VacuumRe.STATES.CHARGING_PROBLEM
      ) {
        callback(null, types.CHARGING_STATE.DISCHARGING);
      } else {
        callback(null, types.CHARGING_STATE.CHARGED);
      }
    });
  }

  async version(callback) {
    try {
      const response = await sendJSONRequest({ url: `http://${this.ip}/api/get_fw_version` });
      if (response != null) {
        callback(null, response.version);
      } else {
        throw Error('Cannot get current version');
      }
    } catch (e) {
      this.log.error(`Error parsing firmware info: ${e}`);
      callback(e);
    }
  }

  /* getBatteryLow(callback) {
    this.log.debug('getting the battery level');
    this.getStatus(false, (error) => {
      if (error) {
        callback(error);
      } else if (this.current_status.battery < 10) {
        callback(null, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
      } else {
        callback(null, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      }
    });
  } */

  async doFind(callback) {
    const { log } = this;

    try {
      await sendJSONRequest({
        url: `http://${this.ip}/api/find_robot`, method: 'PUT', content: { action: 'locate' }, raw_response: true,
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
      await sendJSONRequest({ url: `http://${this.ip}/api/drive_home`, method: 'PUT', raw_response: true });
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

      callback(null, status.state === VacuumRe.STATES.RETURNING_HOME);
    });
  }

  async startCleaning(callback) {
    this.log.debug('Executing cleaning');

    try {
      await sendJSONRequest({ url: `http://${this.ip}/api/start_cleaning`, method: 'PUT', raw_response: true });
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

      if (
        status.state === VacuumRe.STATES.IDLE
                  || this.current_status.state === VacuumRe.STATES.RETURNING_HOME
                  || this.current_status.state === VacuumRe.STATES.CHARGING
                  || this.current_status.state === VacuumRe.STATES.PAUSED
                  || this.current_status.state === VacuumRe.STATES.SPOT_CLEANING
                  || this.current_status.state === VacuumRe.STATES.DOCKING
                  || this.current_status.state === VacuumRe.STATES.GOING_TO_TARGET
      ) {
        callback(new Error('Cannot stop cleaning in current state'));
      }

      try {
        await sendJSONRequest({ url: `http://${this.ip}/api/stop_cleaning`, method: 'PUT', raw_response: true });
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
        return callback(error);
      }

      callback(null, status.state === VacuumRe.STATES.CLEANING);
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

      callback(null, status.state === VacuumRe.STATES.SPOT_CLEANING);
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
        case VacuumRe.STATES.CHARGING:
        case VacuumRe.STATES.IDLE:
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
      const response = await sendJSONRequest({ url: VacuumRe.statusUrl(this.ip) });
      this.log.debug('Done executing update');

      const status = VacuumRe.parseStatus(response);

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
      case 'quiet': return VacuumRe.SPEEDS.quiet;
      case 'balanced': return VacuumRe.SPEEDS.balanced;
      case 'turbo': return VacuumRe.SPEEDS.turbo;
      case 'max': return VacuumRe.SPEEDS.max;
      case 'mop': return VacuumRe.SPEEDS.mop;
      default: throw Error(`Invalid power preset given: ${preset}`);
    }
  }
}

VacuumRe.SPEEDS = {
  mop: 105,
  quiet: 38,
  balanced: 60,
  turbo: 75,
  max: 100,
};

VacuumRe.STATES = {
  STARTING: 1,
  CHARGER_DISCONNECTED: 2,
  IDLE: 3,
  REMOTE_ACTIVE: 4,
  CLEANING: 5,
  RETURNING_HOME: 6,
  MANUAL_MODE: 7,
  CHARGING: 8,
  CHARGING_PROBLEM: 9,
  PAUSED: 10,
  SPOT_CLEANING: 11,
  ERROR: 12,
  SHUTTING_DOWN: 13,
  UPDATING: 14,
  DOCKING: 15,
  GOING_TO_TARGET: 16,
  ZONE_CLEANING: 17,
  ROOMS_CLEANING: 18,
};

module.exports = { VacuumRe };
