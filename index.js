'use strict';

const http = require('http');
const urllib = require('url');

var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerAccessory('homebridge-valetudo-xiaomi-vacuum', 'ValetudoXiaomiVacuum', ValetudoXiaomiVacuum);
};

class ValetudoXiaomiVacuum {

    constructor(log, config) {
        this.services = [];
        this.log = log;
        this.name = config.name || 'Vacuum';

        this.legacy_mode = config['legacy-mode'] == true;

        if (!this.legacy_mode) {
            this.statusUrl = this.statusUrlModern;
            this.parseStatus = this.parseStatusModern;
            this.getSpeedValue = this.getSpeedValueModern;
            this.getCharging = this.getChargingModern;
            this.getMopMode = this.getMopModeModern;
            this.setMopMode = this.setMopModeModern;
            this.goHome = this.goHomeModern;
            this.doFind = this.doFindModern;
            this.isGoingHome = this.isGoingHomeModern;
            this.startCleaning = this.startCleaningModern;
            this.stopCleaning = this.stopCleaningModern;
            this.setFanSpeed = this.setFanSpeedModern;
            this.isSpotCleaning = this.isSpotCleaningModern;
            this.updateStatus = this.updateStatusModern;
            this.updateInterval = this.updateIntervalModern;
            this.getVersion = this.getVersionModern;
            this.isCleaning = this.isCleaningModern;
        } else {
            this.statusUrl = this.statusUrlLegacy;
            this.parseStatus = this.parseStatusLegacy;
            this.getSpeedValue = this.getSpeedValueLegacy;
            this.getCharging = this.getChargingLegacy;
            this.getMopMode = this.getMopModeLegacy;
            this.setMopMode = this.setMopModeLegacy;
            this.goHome = this.goHomeLegacy;
            this.doFind = this.doFindLegacy;
            this.isGoingHome = this.isGoingHomeLegacy;
            this.startCleaning = this.startCleaningLegacy;
            this.stopCleaning = this.stopCleaningLegacy;
            this.setFanSpeed = this.setFanSpeedLegacy;
            this.isSpotCleaning = this.isSpotCleaningLegacy;
            this.updateStatus = this.updateStatusLegacy;
            this.updateInterval = this.updateIntervalLegacy;
            this.getVersion = this.getVersionLegacy;
            this.isCleaning = this.isCleaningLegacy;
        }

        let powerControl = config['power-control'];

        if (powerControl) {
            const defaultSpeedValue = this.getSpeedValue(powerControl['default-speed'] || 'balanced');
            const highSpeedValue = this.getSpeedValue(powerControl['high-speed'] || 'max');

            this.powerControl = {
                defaultSpeed: defaultSpeedValue,
                highSpeed: highSpeedValue,
                mop: powerControl['mop-enabled'] == true
            };

            this.log.debug(`Setting power control: default speed - ${this.powerControl.defaultSpeed}, high speed - ${this.powerControl.highSpeed}, mop enabled - ${this.powerControl.mop}`);
        }

        this.ip = config.ip;
        
        this.current_status = null;
        this.status_callbacks = new Array();
        this.current_status_time = null;
        this.status_timer = null;

        this.idle_update_interval = 120000;
        this.busy_update_interval = 10000;

        if (!this.ip) {
            throw new Error('You must provide an ip address of the vacuum cleaner.');
        }

        this.serviceInfo = new Service.AccessoryInformation();
        this.serviceInfo
            .setCharacteristic(Characteristic.Manufacturer, 'Xiaomi')
            .setCharacteristic(Characteristic.Model, 'Roborock');

        this.serviceInfo.getCharacteristic(Characteristic.FirmwareRevision)
            .on('get', this.getVersion.bind(this));
        this.services.push(this.serviceInfo);

        this.findService = new Service.Switch('Find ' + this.name, 'identify');
        this.findService.getCharacteristic(Characteristic.On)
            .on('set', this.doFind.bind(this));
        this.services.push(this.findService);

        this.goHomeService = new Service.Switch('Go Home, ' + this.name, 'home');
        this.goHomeService.getCharacteristic(Characteristic.On)
            .on('set', this.goHome.bind(this))
            .on('get', this.isGoingHome.bind(this));
        this.services.push(this.goHomeService);

        this.cleanService = new Service.Switch('Clean, ' + this.name, 'clean');
        this.cleanService.getCharacteristic(Characteristic.On)
            .on('set', this.startCleaning.bind(this))
            .on('get', this.isCleaning.bind(this));
        this.services.push(this.cleanService);

        this.spotCleanService = new Service.Switch('Spot Clean, ' + this.name, 'spotclean');
        this.spotCleanService.getCharacteristic(Characteristic.On)
            .on('set', this.startSpotCleaning.bind(this))
            .on('get', this.isSpotCleaning.bind(this));
        this.services.push(this.spotCleanService);

        if (this.powerControl) {
            this.highSpeedService = new Service.Switch('High speed mode ' + this.name, 'highspeed');
            this.highSpeedService.getCharacteristic(Characteristic.On)
                .on('set', this.setHighSpeedMode.bind(this))
                .on('get', this.getHighSpeedMode.bind(this));
            this.services.push(this.highSpeedService);

            if (this.powerControl.mop) {
                this.mopService = new Service.Switch('Mopping mode ' + this.name, 'mopspeed');
                this.mopService.getCharacteristic(Characteristic.On)
                    .on('set', this.setMopMode.bind(this))
                    .on('get', this.getMopMode.bind(this));
                this.services.push(this.mopService);
            }
        }

        this.batteryService = new Service.BatteryService(this.name + ' Battery');
        this.batteryService
            .getCharacteristic(Characteristic.BatteryLevel)
            .on('get', this.getBattery.bind(this));
        this.batteryService
            .getCharacteristic(Characteristic.ChargingState)
            .on('get', this.getCharging.bind(this));
        this.batteryService
            .getCharacteristic(Characteristic.StatusLowBattery)
            .on('get', this.getBatteryLow.bind(this));
        this.services.push(this.batteryService);

        this.updateStatus(true);
    }

    statusUrlModern (ip) {
        return 'http://' + ip + '/api/v2/robot/state/attributes';
        
    }

    statusUrlLegacy (ip) {
        return 'http://' + ip + '/api/current_status';
    }

    parseStatusModern (response) {
        let simpleStatus = {};

        response.forEach((value) => {
            switch(value['__class']) {
                case 'StatusStateAttribute':
                    simpleStatus['state'] = value['value'];
                    simpleStatus['cleaning_mode'] = value['flag'];
                    break;
                case 'IntensityStateAttribute':
                    simpleStatus['fan_power'] = value['value'];
                    break;
                case 'BatteryStateAttribute':
                    simpleStatus['battery'] = value['level'];
                    simpleStatus['battery_status'] = value['flag'];
                    break;
            }

        });

        return simpleStatus;
    }

    parseStatusLegacy (response) {
        return response;
    }

    getHighSpeedMode (callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
            } else {
                callback(null, this.current_status['fan_power'] === this.powerControl.highSpeed);
            }
        });
    }

    getMopModeModern (callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
            } else {
                this.log.debug(`Fan speed is ${this.current_status['fan_power']}`);
                callback(null, this.current_status['fan_power'] === ValetudoXiaomiVacuum.SPEEDS.OFF);
            }
        });
    }

    getMopModeLegacy (callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
            } else {
                callback(null, this.current_status['fan_power'] === ValetudoXiaomiVacuum.SPEEDS_LEGACY.mop);
            }
        });
    }

    async setFanSpeedRequestModern(value) {
        try {
            const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/v2/robot/capabilities/FanSpeedControlCapability/preset', method: 'PUT', content: {name: value}, raw_response: true });
            this.updateStatus (true);
        } catch (e) {
            this.log.error(`Failed to change fan power: ${e}`);
            throw(e);
        }

    }

    async setFanSpeedModern (value, callback) {
        this.log.debug(`Setting fan power to ${value}`);

        try {
            const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/v2/robot/capabilities/FanSpeedControlCapability/preset', method: 'PUT', content: {name: value}, raw_response: true });
            this.updateStatus (true);
            callback();
        } catch (e) {
            this.log.error(`Failed to change fan power: ${e}`);
            callback();
        }
    }

    async setFanSpeedLegacy (value, callback) {
        this.log.debug(`Setting fan power to ${value}`);

        try {
            const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/fanspeed', method: 'PUT', content: {speed: value}, raw_response: true });
            callback();
            this.updateStatus (true);
            
        } catch (e) {
            this.log.error(`Failed to change fan power: ${e}`);
            callback();
        }
    }

    setHighSpeedMode (on, callback) {
        if (on) {
            if (this.highSpeedMode) {
                callback(null);
                return;
            } else {
                this.setFanSpeed(this.powerControl.highSpeed, callback);
                return;
            }
        } else {
            if (this.highSpeedMode) {
                this.setFanSpeed(this.powerControl.defaultSpeed, callback);
                return;
            } else {
                callback(null);
                return;
            }
        }
    }

    setMopModeModern (on, callback) {
        if (on) {
            if (this.mopMode) {
                callback(null);
                return;
            } else {
                this.setFanSpeed(ValetudoXiaomiVacuum.SPEEDS.OFF, callback);
                return;
            }
        } else {
            if (this.mopMode) {
                this.setFanSpeed(this.powerControl.defaultSpeed, callback);
                return;
            } else {
                callback(null);
                return;
            }
        }
    }

    setMopModeLegacy (on, callback) {
        if (on) {
            if (this.mopMode) {
                callback(null);
                return;
            } else {
                this.setFanSpeed(ValetudoXiaomiVacuum.SPEEDS_LEGACY.mop, callback);
                return;
            }
        } else {
            if (this.mopMode) {
                this.setFanSpeed(this.powerControl.defaultSpeed, callback);
                return;
            } else {
                callback(null);
                return;
            }
        }
    }

    getBattery (callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
            } else {
                callback(null, this.current_status.battery);
            }
        });
    }
    

    getChargingModern (callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
            } else {
                if (this.current_status.battery_status === ValetudoXiaomiVacuum.BATTERY.CHARGING) {
                    callback(null, Characteristic.ChargingState.CHARGING);
                } else if (this.current_status.battery_status === ValetudoXiaomiVacuum.STATES.DISCHARGING) {
                    callback(null, Characteristic.ChargingState.NOT_CHARGEABLE);
                } else {
                    callback(null, Characteristic.ChargingState.NOT_CHARGING);
                }

            }
        });
    }

    getChargingLegacy (callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
            } else {
                if (this.current_status.state === ValetudoXiaomiVacuum.STATES_LEGACY.CHARGING) {
                    this.log.debug('CHARGING!');
                    callback(null, Characteristic.ChargingState.CHARGING);
                } else if (this.current_status.state === ValetudoXiaomiVacuum.STATES_LEGACY.CHARGER_DISCONNECTED || this.current_status.state === ValetudoXiaomiVacuum.STATES_LEGACY.CHARGING_PROBLEM) {
                    callback(null, Characteristic.ChargingState.NOT_CHARGEABLE);
                } else {
                    callback(null, Characteristic.ChargingState.NOT_CHARGING);
                }

            }
        });
    }

    getBatteryLow (callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
            } else {
                if (this.current_status.battery < 10) {
                    callback(null, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
                } else {
                    callback(null, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                }
            }
        });
    }

    getServices () {
        return this.services;
    }

    async getVersionModern (callback) {
        try {
            const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/v2/valetudo/version'});
            callback(null, response.release);
        } catch (e) {
            this.log.error(`Error parsing firmware info: ${e}`);
            callback(e);
        }
    }

    async getVersionLegacy (callback) {
        try {
            const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/get_fw_version'});
            callback(null, response.version);
        } catch (e) {
            this.log.error(`Error parsing firmware info: ${e}`);
            callback(e);
        }
    }

    async doFindModern (state, callback) {
        var log = this.log;
        
        if (state) {
        try {
            const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/v2/robot/capabilities/LocateCapability', method: 'PUT', content: {action: 'locate'}, raw_response: true});
            callback();

            setTimeout(() => {
                this.findService.updateCharacteristic(Characteristic.On, false);
            }, 250);
        } catch (e) {
            log.error(`Failed to identify robot: ${e}`);
            callback(e);
        }
    } else {
        callback(null);
    }
    }

    async doFindLegacy (state, callback) {
        var log = this.log;
        
        if (state) {
        try {
            const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/find_robot', method: 'PUT', content: {action: 'locate'}, raw_response: true});
            callback();

            setTimeout(() => {
                this.findService.updateCharacteristic(Characteristic.On, false);
            }, 250);
        } catch (e) {
            log.error(`Failed to identify robot: ${e}`);
            callback(e);
        }
    } else {
        callback(null);
    }
    }

    identify (callback) {
        doFind(true, callback);
    }

    async goHomeModern (state, callback) {
        var log = this.log;

        if (state) {
            log.debug('Executing go home');

            try {
                const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/v2/robot/capabilities/BasicControlCapability', method: 'PUT', content: { action: 'home' }, raw_response: true});
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);

            } catch (e) {
                log.error(`Failed to execute go home: ${e}`);
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            }

        } else {
            setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
        }
    }

    async goHomeLegacy (state, callback) {
        var log = this.log;

        if (state) {
            log.debug('Executing go home');

            try {
                const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/drive_home', method: 'PUT', raw_response: true});
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            } catch (e) {
                log.error(`Failed to execute go home: ${e}`);
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            }

        } else {
            setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
        }
    }

    isGoingHomeModern (callback) {
        var log = this.log;

        this.getStatus(false, (error) => {

            this.log.debug(`Is going home? error: ${error}, state: ${this.current_status !== null ? this.current_status.state : null}`);

            if (error) {
                return callback(new Error(`Error retrieving going home status: ${error}`));
            }

            callback(null, this.current_status.state === ValetudoXiaomiVacuum.STATES.RETURNING);
        });
    }

    isGoingHomeLegacy (callback) {
        var log = this.log;

        this.getStatus(false, (error) => {

            this.log.debug(`Is going home? error: ${error}, state: ${this.current_status !== null ? this.current_status.state : null}`);

            if (error) {
                return callback(new Error(`Error retrieving going home status: ${error}`));
            }

            callback(null, this.current_status.state === ValetudoXiaomiVacuum.STATES.RETURNING_HOME);
        });
    }

    async startCleaningModern (state, callback) {
        var log = this.log;

        if (state) {
            log.debug('Executing cleaning');

            try {
                const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/v2/robot/capabilities/BasicControlCapability', method: 'PUT', content: { action: 'start' }, raw_response: true});
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            } catch (e) {
                log.error(`Failed to start cleaning: ${e}`);
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            }

        } else {
            this.getStatus(true, (err) => {
                if (err) {
                    callback(err);
                    return;
                }

                if (this.current_status.state === ValetudoXiaomiVacuum.STATES.CLEANING) {
                    this.stopCleaning(() => {
                        callback();
                    });
                } else {
                    callback();
                }
            });
        }
    }

    async startCleaningLegacy (state, callback) {
        var log = this.log;

        if (state) {
            log.debug('Executing cleaning');

            try {
                const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/start_cleaning', method: 'PUT', raw_response: true});
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            } catch (e) {
                log.error(`Failed to start cleaning: ${e}`);
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            }

        } else {
            this.getStatus(true, (err) => {
                if (err) {
                    callback(err);
                    return;
                }

                if (this.current_status.state === ValetudoXiaomiVacuum.STATES_LEGACY.CLEANING) {
                    this.stopCleaning(() => {
                        callback();
                    });
                } else {
                    callback();
                }
            });
        }
    }

    async stopCleaningModern (callback) {
        var log = this.log;

        log.debug('Executing stop cleaning');

        this.getStatus(true, async (err) => {
            if (err) {
                callback(err);
                return;
            }

            if (this.current_status.state == ValetudoXiaomiVacuum.STATES.ERROR ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.DOCKED ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.IDLE ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.RETURNING ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.MANUAL_CONTROL ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.MOVING) {
                    callback(new Error('Cannot stop cleaning in current state'));
            }

            try {
                const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/v2/robot/capabilities/BasicControlCapability', method: 'PUT', content: {action: 'stop'}, raw_response: true});
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            } catch (e) {
                this.log.error(`Failed to stop cleaning: ${e}`);
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            }
        });
    }

    async stopCleaningLegacy (callback) {
        var log = this.log;

        log.debug('Executing stop cleaning');

        this.getStatus(true, async (err) => {
            if (err) {
                callback(err);
                return;
            }

            if (this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.IDLE ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.RETURNING_HOME ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.CHARGING ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.PAUSED ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.SPOT_CLEANING ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.DOCKING ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.GOING_TO_TARGET) {
                    callback(new Error('Cannot stop cleaning in current state'));
            }

            try {
                const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/stop_cleaning', method: 'PUT', raw_response: true});
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            } catch (e) {
                this.log.error(`Failed to stop cleaning: ${e}`);
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            }
        });
    }

    isCleaningModern (callback) {
        this.getStatus(false, (error) => {

            this.log.debug(`Is cleaning? error: ${error}, state: ${this.current_status !== null ? this.current_status.state : null}`);

            if (error) {
                return callback(error);
            }

            callback(null, this.current_status.state === ValetudoXiaomiVacuum.STATES.CLEANING);
        });
    }

    isCleaningLegacy (callback) {
        this.getStatus(false, (error) => {

            this.log.debug(`Is cleaning? error: ${error}, state: ${this.current_status !== null ? this.current_status.state : null}`);

            if (error) {
                return callback(error);
            }

            callback(null, this.current_status.state === ValetudoXiaomiVacuum.STATES_LEGACY.CLEANING);
        });
    }

    async startSpotCleaning (state, callback) {
        var log = this.log;

        if (state) {
            log.debug('Executing spot cleaning');

            try {
                const response = await this.sendJSONRequest({url: 'http://' + this.ip + '/api/spot_clean', method: 'PUT', raw_response: true});
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            } catch (e) {
                this.log.error(`Failed to start spot cleaning: ${e}`);
                setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            }
        } else {
            callback(new Error('Cannot stop spot cleaning'));
        }
    }

    isSpotCleaningModern (callback) {
        this.getStatus(false, (error) => {

            this.log.debug(`Is spot cleaning? error: ${error}, state: ${this.current_status !== null ? this.current_status.state : null}`);

            if (error) {
                return callback(error);
            }

            callback(null, this.current_status.cleaning_mode === ValetudoXiaomiVacuum.CLEANING_MODES.SPOT);
        });
    }

    isSpotCleaningLegacy (callback) {
        this.getStatus(false, (error) => {

            this.log.debug(`Is spot cleaning? error: ${error}, state: ${this.current_status !== null ? this.current_status.state : null}`);

            if (error) {
                return callback(error);
            }

            callback(null, this.current_status.state === ValetudoXiaomiVacuum.STATES_LEGACY.SPOT_CLEANING);
        });
    }

    updateStatusModern(forced = false) {
        this.log.debug('Updating vacuum status');
        this.getStatus(forced, (err) => {
            if (err) {
                return;
            }

            this.log.debug('Updating characteristics');

            this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, this.current_status.battery);
            this.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, this.current_status.battery < 10
                ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);

            this.log.debug(`Battery status: ${this.current_status.battery_status}`);
            this.batteryService.updateCharacteristic(Characteristic.ChargingState, this.current_status.battery_status === ValetudoXiaomiVacuum.BATTERY.CHARGING
                ? Characteristic.ChargingState.CHARGING : Characteristic.ChargingState.NOT_CHARGING);

            this.cleanService.updateCharacteristic(Characteristic.On, this.current_status.state == ValetudoXiaomiVacuum.STATES.CLEANING); // cleaning
            this.goHomeService.updateCharacteristic(Characteristic.On, this.current_status.state === ValetudoXiaomiVacuum.STATES.RETURNING); // driving home
            this.spotCleanService.updateCharacteristic(Characteristic.On, this.current_status.cleaning_mode === ValetudoXiaomiVacuum.CLEANING_MODES.SPOT); // spot cleaning

            if (this.powerControl) {
                this.highSpeedMode = this.current_status['fan_power'] === this.powerControl.highSpeed;
                this.highSpeedService.updateCharacteristic(Characteristic.On, this.highSpeedMode);
                if (this.powerControl.mop) {
                    this.mopMode = this.current_status['fan_power'] === ValetudoXiaomiVacuum.SPEEDS.OFF;
                    this.mopService.updateCharacteristic(Characteristic.On, this.mopMode);
                }
            }
        });
    }

    updateStatusLegacy (forced = false) {
        this.log.debug('Updating vacuum status');
        this.getStatus(forced, (err) => {
            if (err) {
                return;
            }

            this.log.debug('Updating characteristics');

            this.log.debug(`Battery state: ${this.current_status.battery}`);

            this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, this.current_status.battery);
            this.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, this.current_status.battery < 10
                ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);

            this.batteryService.updateCharacteristic(Characteristic.ChargingState, this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.CHARGING
                ? Characteristic.ChargingState.CHARGING : Characteristic.ChargingState.NOT_CHARGING);

            this.cleanService.updateCharacteristic(Characteristic.On, this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.CLEANING); // cleaning
            this.goHomeService.updateCharacteristic(Characteristic.On, this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.RETURNING_HOME); // driving home
            this.spotCleanService.updateCharacteristic(Characteristic.On, this.current_status.state == ValetudoXiaomiVacuum.STATES_LEGACY.SPOT_CLEANING); // cleaning

            if (this.powerControl) {
                this.highSpeedMode = this.current_status['fan_power'] === this.powerControl.highSpeed;
                this.highSpeedService.updateCharacteristic(Characteristic.On, this.highSpeedMode);
                if (this.powerControl.mop) {
                    this.mopMode = this.current_status['fan_power'] === ValetudoXiaomiVacuum.SPEEDS_LEGACY.mop;
                    this.mopService.updateCharacteristic(Characteristic.On, this.mopMode);
                }
            }
        });
    }

    updateIntervalModern () {
        if (this.current_status !== null) {
            switch (this.current_status.state) {
                case ValetudoXiaomiVacuum.STATES.DOCKED:
                case ValetudoXiaomiVacuum.STATES.IDLE:
                    return this.idle_update_interval; // slow update interval for idle states
                default:
                    break;
            }
        }
        
        return this.busy_update_interval; // fast update interval for non-idle states
    }

    updateIntervalLegacy () {
        if (this.current_status !== null) {
            switch (this.current_status.state) {
                case ValetudoXiaomiVacuum.STATES_LEGACY.CHARGING:
                case ValetudoXiaomiVacuum.STATES_LEGACY.IDLE:
                    return this.idle_update_interval; // slow update interval for idle states
                default:
                    break;
            }
        }

        return this.busy_update_interval; // fast update interval for non-idle states
    }

    clearUpdateTimer () {
        clearTimeout(this.status_timer);
    }

    setupUpdateTimer () {
        this.status_timer = setTimeout(() => { this.updateStatus(true); }, this.updateInterval());
    }

    async getStatus (forced, callback) {
        if (this.status_callbacks.length > 0) {
            this.log.debug('Pushing status callback to queue - updating');
            this.status_callbacks.push(callback);
            return;
        }

        const now = Date.now();

        if (!forced && this.current_status !== null && 
            this.current_status_time !== null && 
            (now - this.current_status_time < this.busy_update_interval)) {
                this.log.debug('Returning cached status');
                callback(null);
                return;
        }

        this.clearUpdateTimer();

        this.log.debug(`Executing update, forced: ${forced}`);
        this.status_callbacks.push(callback);

        try {
            const response = await this.sendJSONRequest({url: this.statusUrl(this.ip)});
            this.log.debug('Done executing update');

            const status = this.parseStatus(response);

            this.current_status = status;
            this.current_status_time = Date.now();
            const callbacks = this.status_callbacks;
            this.status_callbacks = new Array();
    
            this.log.debug(`Calling ${callbacks.length} queued callbacks`);
            callbacks.forEach((element) => {
                element(null, response);
            });
            this.setupUpdateTimer();

        } catch (e) {
            this.log.error(`Error parsing current status info: ${e}`);
            const callbacks = this.status_callbacks;
            this.status_callbacks = new Array();

            callbacks.forEach((element) => {
                element(e);
            });

            this.setupUpdateTimer();
        }
    }

    

    async sendJSONRequest(params) {
        return new Promise((resolve, reject) => {

            if (!params.url) {
                reject(Error('Request URL missing'));
            }

            const components = new urllib.URL(params.url);

            const options = {
                method: params.method || 'GET',
                raw_response: components.raw_response || false,
                host: components.hostname,
                port: components.port,
                path: components.pathname + (components.search ? components.search : ''),
                protocol: components.protocol,
                headers: { 'Content-Type': 'application/json' }
            };

            if (params.authentication) {
                let credentials = Buffer.from(params.authentication).toString('base64');
                options.headers['Authorization'] = 'Basic ' + credentials;
            }

            const req = http.request(options, (res) => {
                res.setEncoding('utf8');

                let chunks = '';
                res.on('data', (chunk) => { chunks += chunk; });
                res.on('end', () => {
                    try {
                        this.log.debug(`Raw response: ${chunks}`);

                        if (options.raw_response) {
                            resolve(chunks);
                        } else {
                            const parsed = JSON.parse(chunks);
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', (err) => {
                reject(err);
            });

            if (params.payload) {
                const stringified = JSON.stringify(params.payload);
                this.log(`sending payload: ${stringified}`);
                req.write(stringified);
            }

            req.end();
        });
    }

    getSpeedValueModern (preset) {
        this.log.debug(`speed for ${preset}`);
        switch (preset) {
            case 'min': return ValetudoXiaomiVacuum.SPEEDS.LOW;
            case 'quiet': return ValetudoXiaomiVacuum.SPEEDS.LOW;
            case 'low': return ValetudoXiaomiVacuum.SPEEDS.LOW;
            case 'medium': return ValetudoXiaomiVacuum.SPEEDS.MEDIUM;
            case 'balanced': return ValetudoXiaomiVacuum.SPEEDS.MEDIUM;
            case 'max': return ValetudoXiaomiVacuum.SPEEDS.HIGH;
            case 'turbo': return ValetudoXiaomiVacuum.SPEEDS.MAX;
            case 'mop': return ValetudoXiaomiVacuum.SPEEDS.OFF;
            default: throw Error(`Invalid power preset given: ${preset}`);
        }
    }

    getSpeedValueLegacy (preset) {
        switch (preset) {
            case 'quiet': return ValetudoXiaomiVacuum.SPEEDS_LEGACY.quiet;
            case 'balanced': return ValetudoXiaomiVacuum.SPEEDS_LEGACY.balanced;
            case 'turbo': return ValetudoXiaomiVacuum.SPEEDS_LEGACY.turbo;
            case 'max': return ValetudoXiaomiVacuum.SPEEDS_LEGACY.max;
            case 'mop': return ValetudoXiaomiVacuum.SPEEDS_LEGACY.mop;
            default: throw Error(`Invalid power preset given: ${preset}`);
        }
    }
}

ValetudoXiaomiVacuum.STATES = {
    ERROR: 'error',
    DOCKED: 'docked',
    IDLE: 'idle',
    RETURNING: 'returning',
    CLEANING: 'cleaning',
    PAUSED: 'paused',
    MANUAL_CONTROL: 'manual_control',
    MOVING: 'moving'
};


ValetudoXiaomiVacuum.STATES_LEGACY = {
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
    ROOMS_CLEANING: 18
};


ValetudoXiaomiVacuum.BATTERY = {
    NONE: 'none',
    CHARGING: 'charging',
    DISCHARGING: 'discharging',
    CHARGED: 'charged',
    MAX: 'max'
};

ValetudoXiaomiVacuum.SPEEDS = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    MAX: 'max',
    OFF: 'off',
};

ValetudoXiaomiVacuum.SPEEDS_LEGACY = {
    quiet: 38,
    balanced: 60,
    turbo: 75,
    max: 100,
    mop: 105
};

ValetudoXiaomiVacuum.CLEANING_MODES = {
    NONE: 'none',
    ZONE: 'zone',
    SECTION: 'section',
    SPOT: 'spot',
    TARGET: 'target',
    RESUMABLE: 'resumable'
};
