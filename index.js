'use strict';

const http = require('http');
const URL = require('url');

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
        this.ip = config.ip;
        this.current_status = null;
        this.status_callbacks = new Array();
        this.current_status_time = null;
        this.status_timer = null;

        if (!this.ip) {
            throw new Error('You must provide an ip address of the vacuum cleaner.');
        }

        // HOMEKIT SERVICES
        this.serviceInfo = new Service.AccessoryInformation();
        this.serviceInfo
            .setCharacteristic(Characteristic.Manufacturer, 'Xiaomi')
            .setCharacteristic(Characteristic.Model, 'Roborock');

        this.serviceInfo.getCharacteristic(Characteristic.FirmwareRevision)
            .on('get', this.getVersion.bind(this));
        this.services.push(this.serviceInfo);

        this.findService = new Service.Switch('Find ' + this.name, 'identify');
        this.findService.getCharacteristic(Characteristic.On)
            .on('set', this.identify.bind(this));
        this.services.push(this.findService);

        this.goHomeService = new Service.Switch('Go home, ' + this.name, 'home');
        this.goHomeService.getCharacteristic(Characteristic.On)
            .on('set', this.goHome.bind(this))
            .on('get', this.isGoingHome.bind(this));
        this.services.push(this.goHomeService);

        this.cleanService = new Service.Switch(this.name + ' Start cleaning', 'clean');
        this.cleanService.getCharacteristic(Characteristic.On)
            .on('set', this.startCleaning.bind(this))
            .on('get', this.isCleaning.bind(this));
        this.services.push(this.cleanService);

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

    updateInterval() {
        if (this.current_status !== null) {
            switch (this.current_status.state) {
                case ValetudoXiaomiVacuum.STATES.CHARGING:
                case ValetudoXiaomiVacuum.STATES.IDLE:
                    return 60000; // slow update interval for idle states
                default:
                    return 3000; // fast update interval for non-idle states
            }
        } else {
            return 10000;
        }
    }

    setupUpdateTimer() {
        clearTimeout(this.status_timer);
        this.status_timer = setTimeout(() => { this.updateStatus(true); }, this.updateInterval());
    }

    updateStatus(forced = false) {
        this.log.debug('Updating vacuum status');
        this.getStatus(forced, (err) => {
            if (err) {
                return;
            }

            this.log.debug('Updating characteristics');

            this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, this.current_status.battery);
            this.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, this.current_status.battery < 20
                ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
            this.batteryService.updateCharacteristic(Characteristic.ChargingState, this.current_status.state == ValetudoXiaomiVacuum.STATES.CHARGING
                ? Characteristic.ChargingState.CHARGING : Characteristic.ChargingState.NOT_CHARGING);

            this.cleanService.updateCharacteristic(Characteristic.On, this.current_status.state == ValetudoXiaomiVacuum.STATES.CLEANING); // cleaning
            this.goHomeService.updateCharacteristic(Characteristic.On, this.current_status.state == ValetudoXiaomiVacuum.STATES.RETURNING_HOME); // driving home

            this.setupUpdateTimer();
        });
    }


    getStatus(forced, callback) {
        if (this.status_callbacks.length > 0) {
            this.log.debug('Pushing status callback to queue - updating');
            this.status_callbacks.push(callback);
            return;
        }

        const now = Date.now();

        if (!forced && this.current_status !== null && 
            this.current_status_time !== null && 
            (now - this.current_status_time < this.updateInterval())) {
                this.log.debug('Returning cached status');
                callback(null);
                return;
        }

        this.log.debug(`Executing update, forced: ${forced}`);
        this.status_callbacks.push(callback);

        this.sendJSONRequest('http://' + this.ip + '/api/current_status')
            .then((response) => {
                this.log.debug('Done executing update');
                this.current_status = response;
                this.current_status_time = Date.now();
                const callbacks = this.status_callbacks;
                this.status_callbacks = new Array();

                this.log.debug(`Calling ${callbacks.length} queued callbacks`);
                callbacks.forEach((element) => {
                    element(null, response);
                });
            })
            .catch((e) => {
                this.log.error(`Error parsing current status info: ${e}`);
                const callbacks = this.status_callbacks;
                this.status_callbacks = new Array();

                callbacks.forEach((element) => {
                    element(e);
                });
            });
    }

    getBattery(callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
            } else {
                callback(null, this.current_status.battery);
            }
        });
    }

    getCharging(callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
            } else {
                if (this.current_status.state === ValetudoXiaomiVacuum.STATES.CHARGING) {
                    callback(null, Characteristic.ChargingState.CHARGING);
                } else if (this.current_status.state === ValetudoXiaomiVacuum.STATES.CHARGER_DISCONNECTED || this.current_status.state === ValetudoXiaomiVacuum.STATES.CHARGING_PROBLEM) {
                    callback(null, Characteristic.ChargingState.NOT_CHARGEABLE);
                } else {
                    callback(null, Characteristic.ChargingState.NOT_CHARGING);
                }

            }
        });
    }

    getBatteryLow(callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
            } else {
                if (this.current_status.battery < 20) {
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

    getVersion(callback) {
        this.sendJSONRequest('http://' + this.ip + '/api/get_fw_version')
            .then((response) => {
                callback(null, response.version);
            })
            .catch((e) => {
                this.log.error(`Error parsing firmware info: ${e}`);
                callback(e);
            });
    }

    identify (state, callback) {
        var log = this.log;

        if (state) {
            log.debug('Executing vacuum find');

            this.sendJSONRequest('http://' + this.ip + '/api/find_robot', 'PUT')
                .then((response) => {})
                .catch((e) => {
                    log.error(`Failed to identify robot: ${e}`);
                })
                .finally(() => {
                    callback();
                    setTimeout(() => {
                        this.findService.updateCharacteristic(Characteristic.On, false);
                    }, 250);
                });
        }
    }

    goHome (state, callback) {
        var log = this.log;

        if (state) {
            log.debug('Executing go home');

            this.sendJSONRequest('http://' + this.ip + '/api/drive_home', 'PUT')
                .then((response) => {})
                .catch((e) => {
                    log.error(`Failed to execute go home: ${e}`);
                })
                .finally(() => {
                    setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
                });
        }
    }

    isGoingHome (callback) {
        var log = this.log;

        this.getStatus(false, (error) => {

            this.log.debug(`Is going home? error: ${error}, state: ${this.current_status !== null ? this.current_status.state : null}`);

            if (error) {
                return callback(new Error(`Error retrieving going home status: ${error}`));
            }

            callback(null, this.current_status.state === ValetudoXiaomiVacuum.STATES.RETURNING_HOME);
        });
    }

    startCleaning (state, callback) {
        var log = this.log;

        if (state) {
            log.debug('Executing cleaning');

            this.sendJSONRequest('http://' + this.ip + '/api/start_cleaning', 'PUT')
                .then((response) => {})
                .catch((e) => {
                    log.error(`Failed to execute start cleaning: ${e}`);
                })
                .finally(() => {
                    setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
                });
        } else {
            this.getStatus(true, (err) => {
                if (err) {
                    return;
                }

                if (this.current_status.state === ValetudoXiaomiVacuum.STATES.CLEANING) {
                    this.stopCleaning(() => {
                        callback();
                    });
                }
            });
        }
    }

    stopCleaning (callback) {
        var log = this.log;

        log.debug('Executing stop cleaning');

        this.getStatus(true, (err) => {
            if (err) {
                return;
            }

            if (this.current_status.state == ValetudoXiaomiVacuum.STATES.IDLE ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.RETURNING_HOME ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.CHARGING ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.PAUSED ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.SPOT_CLEANING ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.DOCKING ||
                this.current_status.state == ValetudoXiaomiVacuum.STATES.GOING_TO_TARGET) {
                    callback(new Error('Cannot stop cleaning in current state'));
            }

            this.sendJSONRequest('http://' + this.ip + '/api/stop_cleaning', 'PUT')
                .then((response) => {})
                .catch((e) => {
                this.log.error(`Failed to execute spot clean: ${e}`);
                })
                .finally(() => {
                    setTimeout(() => { callback(); this.updateStatus(true); }, 3000);
            });
        });
    }

    isCleaning (callback) {
        this.getStatus(false, (error) => {

            this.log.debug(`Is cleaning? error: ${error}, state: ${this.current_status !== null ? this.current_status.state : null}`);

            if (error) {
                return callback(error);
            }

            callback(null, this.current_status.state === ValetudoXiaomiVacuum.STATES.CLEANING);
        });
    }

    startSpotCleaning (state, callback) {
        var log = this.log;

        if (state) {
            log.debug('Executing spot cleaning');

            this.sendJSONRequest('http://' + this.ip + '/api/spot_clean', 'PUT')
                .then((response) => {})
                .catch((e) => {
                    log.error(`Failed to execute start spot cleaning: ${e}`);
                })
                .finally(() => {
                    callback();
                    this.updateStatus(true);
                });
        } else {
            callback(new Error('Cannot stop spot cleaning'));
        }
    }

    isSpotCleaning (callback) {
        this.getStatus(false, (error) => {

            this.log.debug(`Is spot cleaning? error: ${error}, state: ${this.current_status !== null ? this.current_status.state : null}`);

            if (error) {
                return callback(error);
            }

            callback(null, this.current_status.state === ValetudoXiaomiVacuum.STATES.SPOT_CLEANING);
        });
    }

    sendJSONRequest (url, method = 'GET') {
        return new Promise((resolve, reject) => {

            const components = URL.parse(url);

            const options = {
                method: method,
                host: components.host,
                port: components.port,
                path: components.pathname,
                protocol: components.protocol
            };
    
            const req = http.request(options, (res) => {
                let chunks = '';
                res.on('data', (chunk) => { chunks += chunk; });
                res.on('end', () => {
                    try {
                        this.log.debug(`Response: ${chunks}`);
                        const parsed = JSON.parse(chunks);
                        resolve(parsed);
                    } catch(e) {
                        reject(e);
                    }
                });
            });
            req.on('error', (err) => {
                reject(err);
            });
            req.end();
        });
    }
}

ValetudoXiaomiVacuum.STATES = {
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
    ZONE_CLEANING: 17
};
