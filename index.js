const { VacuumRe } = require('./vacuumre');
const { VacuumValetudo } = require('./vacuumvaletudo');
const types = require('./types');

let Service; let Characteristic;

class ValetudoXiaomiVacuum {
  statusCallback(status) {
    this.device.getBatteryLevel((error, level) => {
      if (error) { return; }

      this.batteryService.updateCharacteristic(
        Characteristic.BatteryLevel, level,
      );

      this.batteryService.updateCharacteristic(
        Characteristic.StatusLowBattery, level < this.lowBatteryThreshold
          ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
          : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      );
    });

    this.device.getChargingState((error, state) => {
      if (error) { return; }

      this.batteryService.updateCharacteristic(
        Characteristic.ChargingState,
        state === types.CHARGING_STATE.CHARGING
          ? Characteristic.ChargingState.CHARGING
          : Characteristic.ChargingState.NOT_CHARGING,
      );
    });

    this.device.isCleaning((error, state) => {
      if (error) { return; }

      this.cleanService.updateCharacteristic(Characteristic.On,
        state); // cleaning
    });

    this.device.isGoingHome((error, state) => {
      if (error) { return; }

      this.goHomeService.updateCharacteristic(Characteristic.On,
        state); // driving home
    });

    this.device.isSpotCleaning((error, state) => {
      if (error) { return; }

      this.spotCleanService.updateCharacteristic(Characteristic.On,
        state); // spot cleaning
    });

    if (this.device.powerControl) {
      if (this.device.powerControl.highSpeed) {
        this.device.isHighSpeedMode((error, highSpeedMode) => {
          if (error) {
            return;
          }
          this.highSpeedService.updateCharacteristic(Characteristic.On, highSpeedMode);
        });
      }

      if (this.device.powerControl.mop) {
        this.device.isMopMode((error, mopMode) => {
          if (error) {
            return;
          }
          this.mopService.updateCharacteristic(Characteristic.On, mopMode);
        });
      }
    }
  }

  getHighSpeedMode(callback) {
    this.device.isHighSpeedMode((error, status) => {
      if (error) {
        callback(error);
      } else {
        callback(null, status);
      }
    });
  }

  getMopMode(callback) {
    this.device.isMopMode((error, mopMode) => {
      if (error) {
        callback(error);
      } else {
        callback(null, mopMode);
      }
    });
  }

  async setFanSpeedRequest(value) {
    try {
      await this.device.setFanSpeedRequest(value);
    } catch (e) {
      this.log.error(`Failed to change fan power: ${e}`);
      throw (e);
    }
  }

  async setFanSpeed(value, callback) {
    this.log.debug(`Setting fan power to ${value}`);

    try {
      await this.device.setFanSpeed(value);
      callback();
    } catch (e) {
      this.log.error(`Failed to change fan power: ${e}`);
      callback();
    }
  }

  setHighSpeedMode(on, callback) {
    this.device.setHighSpeedMode(on, callback);
  }

  setMopMode(on, callback) {
    this.device.setMopMode(on, callback);
  }

  getBattery(callback) {
    this.device.getBatteryLevel((error, level) => {
      if (error) {
        callback(error);
      } else {
        callback(null, level);
      }
    });
  }

  getCharging(callback) {
    this.device.getChargingState((error, state) => {
      if (error) {
        callback(error);
      } else if (state === types.CHARGING_STATE.CHARGING) {
        callback(null, Characteristic.ChargingState.CHARGING);
      } else if (state === types.CHARGING_STATE.DISCHARGING) {
        callback(null, Characteristic.ChargingState.NOT_CHARGEABLE);
      } else {
        callback(null, Characteristic.ChargingState.NOT_CHARGING);
      }
    });
  }

  getBatteryLow(callback) {
    this.device.getBatteryLevel((error, level) => {
      if (error) {
        callback(error);
      } else if (level < this.lowBatteryThreshold) {
        callback(null, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
      } else {
        callback(null, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      }
    });
  }

  getServices() {
    return this.services;
  }

  async getVersion(callback) {
    try {
      this.device.version(callback);
    } catch (e) {
      callback(e);
    }
  }

  async doFind(state, callback) {
    this.log.debug('Finding');
    if (state) {
      this.device.doFind((error) => {
        callback(error);

        setTimeout(() => {
          this.findService.updateCharacteristic(Characteristic.On, false);
        }, 250);
      });
    } else {
      callback(null);
    }
  }

  identify(callback) {
    this.log.debug('Identifying');
    this.device.doFind((error) => {
      callback(error);
    });
  }

  async goHome(state, callback) {
    const { log } = this;

    if (state) {
      log.debug('Executing go home');

      try {
        await this.device.goHome((error) => {
          callback(error);
        });
      } catch (e) {
        log.error(`Failed to execute go home: ${e}`);
      }
    } else {
      callback(null);
    }
  }

  isGoingHome(callback) {
    this.device.isGoingHome((error, state) => {
      this.log.debug(`Is going home? error: ${error}, state: ${state}`);
      if (error) {
        callback(error);
        return;
      }

      callback(null, state);
    });
  }

  async startCleaning(state, callback) {
    if (state) {
      this.log.debug('Executing cleaning');

      try {
        this.device.startCleaning((error) => {
          callback(error);
        });
      } catch (e) {
        this.log.error(`Failed to start cleaning: ${e}`);
      }
    } else {
      this.device.stopCleaning((error) => {
        callback(error);
      });
    }
  }

  isCleaning(callback) {
    this.device.isCleaning((error, status) => {
      if (error) {
        callback(error);
        return;
      }

      callback(null, status);
    });
  }

  async startSpotCleaning(state, callback) {
    const { log } = this;

    if (state) {
      log.debug('Executing spot cleaning');

      this.device.startSpotCleaning((error) => {
        callback(error);
      });
    } else {
      this.device.stopCleaning(callback);
    }
  }

  isSpotCleaning(callback) {
    this.device.isSpotCleaning((error, status) => {
      this.log.debug(`Is spot cleaning? error: ${error}, state: ${status}`);

      if (error) {
        callback(error);
        return;
      }

      callback(null, status);
    });
  }

  constructor(log, config) {
    this.services = [];
    this.log = log;
    this.name = config.name || 'Vacuum';
    this.lowBatteryThreshold = 10;

    const re = config['legacy-mode'] === true;

    this.device = re
      ? new VacuumRe(this.log, config, (state) => { this.statusCallback(state); })
      : new VacuumValetudo(this.log, config, (state) => { this.statusCallback(state); });

    this.serviceInfo = new Service.AccessoryInformation();
    this.serviceInfo
      .setCharacteristic(Characteristic.Manufacturer, 'Xiaomi')
      .setCharacteristic(Characteristic.Model, 'Roborock');

    this.serviceInfo.getCharacteristic(Characteristic.FirmwareRevision)
      .on('get', (callback) => { this.getVersion(callback); });
    this.services.push(this.serviceInfo);

    this.findService = new Service.Switch(`Find ${this.name}`, 'identify');
    this.findService.getCharacteristic(Characteristic.On)
      .on('set', (value, callback) => { this.doFind(value, callback); });
    this.services.push(this.findService);

    this.goHomeService = new Service.Switch(`Go Home, ${this.name}`, 'home');
    this.goHomeService.getCharacteristic(Characteristic.On)
      .on('set', (value, callback) => {
        this.goHome(value, callback);
      })
      .on('get', (callback) => { this.isGoingHome(callback); });
    this.services.push(this.goHomeService);

    this.cleanService = new Service.Switch(`Clean, ${this.name}`, 'clean');
    this.cleanService.getCharacteristic(Characteristic.On)
      .on('set', (value, callback) => { this.startCleaning(value, callback); })
      .on('get', (callback) => { this.isCleaning(callback); });
    this.services.push(this.cleanService);

    this.spotCleanService = new Service.Switch(`Spot Clean, ${this.name}`, 'spotclean');
    this.spotCleanService.getCharacteristic(Characteristic.On)
      .on('set', (value, callback) => { this.startSpotCleaning(value, callback); })
      .on('get', (callback) => { this.isSpotCleaning(callback); });
    this.services.push(this.spotCleanService);

    if (this.device.powerControl) {
      if (this.device.powerControl.highSpeed) {
        this.highSpeedService = new Service.Switch(`High speed mode ${this.name}`, 'highspeed');
        this.highSpeedService.getCharacteristic(Characteristic.On)
          .on('set', (value, callback) => { this.setHighSpeedMode(value, callback); })
          .on('get', (callback) => { this.getHighSpeedMode(callback); });
        this.services.push(this.highSpeedService);
      }

      if (this.device.powerControl.mop) {
        this.mopService = new Service.Switch(`Mopping mode ${this.name}`, 'mopspeed');
        this.mopService.getCharacteristic(Characteristic.On)
          .on('set', (value, callback) => { this.setMopMode(value, callback); })
          .on('get', (callback) => { this.getMopMode(callback); });
        this.services.push(this.mopService);
      }
    }

    this.batteryService = new Service.BatteryService(`${this.name} Battery`);
    this.batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .on('get', (callback) => { this.getBattery(callback); });
    this.batteryService
      .getCharacteristic(Characteristic.ChargingState)
      .on('get', (callback) => { this.getCharging(callback); });
    this.batteryService
      .getCharacteristic(Characteristic.StatusLowBattery)
      .on('get', (callback) => { this.getBatteryLow(callback); });
    this.services.push(this.batteryService);

    this.device.updateStatus(true);
  }
}

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  api.registerAccessory('homebridge-valetudo-xiaomi-vacuum', 'ValetudoXiaomiVacuum', ValetudoXiaomiVacuum);
};
