'use strict';

const BaseClass = require('./baseclass');
const https = require('https');
const ProtectWebClient = require('./webclient');
const ProtectWebSocket = require('./websocket');
const UfvConstants = require('./constants');

let UFV_API_ENDPOINT = '/proxy/protect/api';

class ProtectAPI extends BaseClass {

    constructor(...props) {
        super(...props);
        // Single WebSocket instance for all devices
        this.ws = new ProtectWebSocket();
        this.webclient = new ProtectWebClient();
        this._bootstrap = null;
        this._lastUpdateId = null;
        this._rtspPort = null;
        this.homey = null;
    }

    setHomeyObject(homey) {
        this.homey = homey;
        this.ws.setHomeyObject(this.homey);
        this.webclient.setHomeyObject(this.homey);
    }

    getProxyCookieToken() {
        return this.webclient.getCookieToken();
    }

    getHost() {
        return this.webclient.getServerHost();
    }

    getLastUpdateId() {
        return this._lastUpdateId;
    }

    getBootstrap() {
        return this._bootstrap;
    }

    getNvrName() {
        if (typeof this._bootstrap.nvr.name !== 'undefined' && this._bootstrap.nvr.name !== null) {
            return this._bootstrap.nvr.name;
        }
        if (typeof this._bootstrap.nvr.host !== 'undefined' && this._bootstrap.nvr.host !== null) {
            return this._bootstrap.nvr.host;
        }
        if (typeof this._bootstrap.nvr.id !== 'undefined' && this._bootstrap.nvr.id !== null) {
            return this._bootstrap.nvr.id;
        }

    }

    getCSRFToken(host, port) {
        this.log('Get CSRF Token...');

        return new Promise((resolve, reject) => {
            this.homey.api.realtime(UfvConstants.EVENT_SETTINGS_STATUS, 'Getting CSRF token');

            if (!host) reject(new Error('Invalid host.'));

            const options = {
                method: 'GET',
                hostname: host,
                port: port,
                path: '/',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    Accept: '*/*',
                    'x-csrf-token': 'undefined'
                },
                maxRedirects: 20,
                rejectUnauthorized: false,
                timeout: 2000,
                keepAlive: true,
            };

            const req = https.request(options, res => {
                const body = [];

                res.on('data', chunk => body.push(chunk));
                res.on('end', () => {
                    // Obtain authorization header
                    res.rawHeaders.forEach((item, index) => {
                        if (item.toLowerCase() === 'set-cookie') {
                            this.webclient.setCookieToken(res.rawHeaders[index + 1]);
                        }

                        // X-CSRF-Token
                        if (item.toLowerCase() === 'x-csrf-token') {
                            this.webclient.setCSRFToken(res.rawHeaders[index + 1]);
                        }
                    });

                    if (this.webclient.getCSRFToken() === null) {
                        reject(new Error('Invalid x-csrf-token header.'));
                        return;
                    }

                    // Connected
                    this.homey.api.realtime(UfvConstants.EVENT_SETTINGS_STATUS, 'CSRF Token found');
                    //
                    return resolve('We got it!');
                });
            });

            req.on('error', error => {
                this.homey.api.realtime(UfvConstants.EVENT_SETTINGS_STATUS, 'Disconnected');
                return reject(error);
            });
            req.end();
        });
    }

    login(host, port, username, password) {
        this.log('Logging in...');
        UFV_API_ENDPOINT = '/proxy/protect/api';

        this.webclient.setServerHost(host);
        this.webclient.setServerPort(port);

        return new Promise((resolve, reject) => {

        this.getCSRFToken(host, port).then(response => {

                this.homey.api.realtime(UfvConstants.EVENT_SETTINGS_STATUS, 'Connecting');

                if (!host) reject(new Error('Invalid host.'));
                if (!username) reject(new Error('Invalid username.'));
                if (!password) reject(new Error('Invalid password.'));

                const credentials = JSON.stringify({
                    username,
                    password,
                });

                const options = {
                    method: 'POST',
                    hostname: host,
                    port: port,
                    path: '/api/auth/login',
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        Accept: 'application/json',
                        'x-csrf-token': this.webclient.getCSRFToken(),
                    },
                    maxRedirects: 20,
                    rejectUnauthorized: false,
                    timeout: 2000,
                    keepAlive: true,
                };

                const req = https.request(options, res => {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`Request failed: ${options.path} (status code: ${res.statusCode}) (creds: ${credentials}`));
                    }
                    const body = [];

                    res.on('data', chunk => body.push(chunk));
                    res.on('end', () => {
                        const json = JSON.parse(body);

                        // Obtain authorization header
                        res.rawHeaders.forEach((item, index) => {
                            if (item.toLowerCase() === 'set-cookie') {
                                this.webclient.setCookieToken(res.rawHeaders[index + 1]);
                            }

                            // X-CSRF-Token
                            if (item.toLowerCase() === 'x-csrf-token') {
                                this.webclient.setCSRFToken(res.rawHeaders[index + 1]);
                            }
                        });

                        if (this.webclient.getCookieToken() === null) {
                            reject(new Error('Invalid set-cookie header.'));
                            return;
                        }

                        // Connected
                        this.homey.api.realtime(UfvConstants.EVENT_SETTINGS_STATUS, 'Connected');
                        //
                        return resolve('Logged in...');
                    });
                });

                req.on('error', error => {
                    this.homey.api.realtime(UfvConstants.EVENT_SETTINGS_STATUS, 'Disconnected');
                    return reject(error);
                });

                req.write(credentials);
                req.end();

        }).catch(error => reject(error));
        });
    }

    getBootstrapInfo() {
        return new Promise((resolve, reject) => {
            this.webclient.get('bootstrap')
                .then(response => {
                    const result = JSON.parse(response);

                    if (result) {
                        this._bootstrap = result;

                        if (result.accessKey) {
                            this.webclient.setApiKey(result.accessKey);
                            this._rtspPort = result.nvr.ports.rtsp;
                            this._lastUpdateId = result.lastUpdateId;
                        }

                        // lastUpdateId is changed, please reconnect to websocket
                        this.ws.reconnectUpdatesListener();

                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining bootstrap info.'));
                    }
                })
                .catch(error => reject(error));
        });
    }

    getAccessKey() {
        return new Promise((resolve, reject) => {
            this.webclient.post('auth/access-key')
                .then(response => {
                    const result = JSON.parse(response);
                    this.webclient.setApiKey(result.accessKey);

                    if (result) {
                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining access-key.'));
                    }
                })
                .catch(error => reject(error));
        });
    }

    getDebugInfo() {
        return new Promise((resolve, reject) => {
            this.webclient.get('debug/info')
                .then(response => {
                    const result = JSON.parse(response);

                    if (result) {
                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining server.'));
                    }
                })
                .catch(error => reject(error));
        });
    }

    getServer() {
        return new Promise((resolve, reject) => {
            this.webclient.get('nvr')
                .then(response => {
                    const result = JSON.parse(response);

                    if (result) {
                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining server.'));
                    }
                })
                .catch(error => reject(error));
        });
    }

    findCameraById(id) {
        return new Promise((resolve, reject) => {
            this.webclient.get(`cameras/${id}`)
                .then(response => {
                    const result = JSON.parse(response);

                    if (result) {
                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining cameras.'));
                    }
                })
                .catch(error => reject(error));
        });
    }

    getCameras() {
        return new Promise((resolve, reject) => {
            this.webclient.get('cameras')
                .then(response => {
                    let result = JSON.parse(response);
                    result = result.filter( obj => obj.type !== "UVC G4 Doorbell");
                    if (result) {
                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining cameras.'));
                    }
                })
                .catch(error => reject(error));
        });
    }

    getDoorbells() {
        return new Promise((resolve, reject) => {
            this.webclient.get('cameras')
                .then(response => {
                    let result = JSON.parse(response);
                    result = result.filter( obj => obj.type === "UVC G4 Doorbell");
                    if (result) {
                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining cameras.'));
                    }
                })
                .catch(error => reject(error));
        });
    }

    snapshot(id, widthInPixels = 1920) {
        return new Promise((resolve, reject) => {
            if (!id) reject(new Error('Invalid camera identifier.'));

            const height = this.getAspectRatioHeight(id, widthInPixels);

            const params = {
                accessKey: this.webclient.getApiKey(),
                w: widthInPixels,
                h: height,
                force: true,
            };

            let snapshot;
            return this.webclient.download(`cameras/${id}/snapshot`, params)
                .then(buffer => resolve(buffer))
                .catch(error => reject(new Error(`Error obtaining snapshot buffer: ${error}`)));
        });
    }

    createSnapshotUrl(camera, widthInPixels = 1920) {
        return new Promise((resolve, reject) => {
            if (!this.webclient.getServerHost()) reject(new Error('Invalid host.'));
            if (!camera) reject(new Error('Invalid camera'));
            const height = this.getAspectRatioHeight(camera.id, widthInPixels);

            const params = {
                accessKey: this.webclient.getApiKey(),
                w: widthInPixels,
                h: height,
                force: true,
                ts: Date.now()
            };
            return resolve(`https://${this.webclient.getServerHost()}:${this.webclient.getServerPort()}${UFV_API_ENDPOINT}/cameras/${camera.id}/snapshot${this.webclient.toQueryString(params)}`);
        });
    }

    setRecordingMode(camera, mode = 'never') {
        return new Promise((resolve, reject) => {
            this.findCameraById(camera.id)
                .then(cameraInfo => {
                    const recordingSettings = cameraInfo.recordingSettings;
                    const channels = cameraInfo.channels;
                    const smartDetectSettings = cameraInfo.smartDetectSettings;
                    recordingSettings.mode = mode;

                    const params = {
                        channels,
                        recordingSettings
                    };

                    // Only add smartDetectSettings when the camera supports it
                    if (cameraInfo.featureFlags.hasSmartDetect) {
                        params['smartDetectSettings'] = smartDetectSettings;
                    }

                    return this.webclient.patch(`cameras/${camera.id}`, params)
                        .then(() => resolve('Recording mode successfully set.'))
                        .catch(error => reject(new Error(`Error setting recording mode: ${error}`)));
                })
                .catch(error => reject(new Error(`Error setting recording mode: ${error}`)));
        });
    }

    setMicVolume(camera, volume = 100) {
        return new Promise((resolve, reject) => {
            const params = {
                micVolume: volume,
            };
            return this.webclient.patch(`cameras/${camera.id}`, params)
                .then(() => resolve('Mic volume successfully set.'))
                .catch(error => reject(new Error(`Error setting mic volume: ${error}`)));
        });
    }

    getMotionEvents() {
        return new Promise((resolve, reject) => {
            let start = new Date();
            start.setHours(0, 0, 0, 0);
            let end = new Date();
            end.setHours(23, 59, 59, 999);

            let startTime = (this._lastMotionAt == null ? start.getTime() : this._lastMotionAt);

            this.webclient.get(`events?start=${startTime}&end=${end.getTime()}&type=motion`)
                .then(response => {
                    start = null;
                    end = null;
                    startTime = null;
                    const result = JSON.parse(response);
                    if (result) {
                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining motion events.'));
                    }
                })
                .catch(error => reject(error));
        });
    }

    getAspectRatioHeight(cameraId, widthInPixels) {
        this._bootstrap.cameras.forEach(camera => {
            if (camera.id === cameraId) {
                if (camera.type === 'UVC G4 Doorbell') {
                    return widthInPixels / 4 * 3;
                } else {
                    return widthInPixels / 16 * 9;
                }
            }
        });
    }

    getStreamUrl(camera) {
        return new Promise((resolve, reject) => {
            let rtspAlias = null;

            this.findCameraById(camera.id)
                .then(cameraInfo => {
                    cameraInfo.channels.forEach(channel => {
                        if (channel.isRtspEnabled) {
                            rtspAlias = channel.rtspAlias;
                        }
                    });

                    if (!rtspAlias) {
                        resolve('');
                    }

                    resolve(`rtsp://${this.webclient.getServerHost()}:${this._rtspPort}/${rtspAlias}`);
                })
                .catch(error => reject(new Error(`Error getting steam url: ${error}`)));
        });
    }

    findLightById(id) {
        return new Promise((resolve, reject) => {
            this.webclient.get(`lights/${id}`)
                .then(response => {
                    const result = JSON.parse(response);

                    if (result) {
                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining lights.'));
                    }
                })
                .catch(error => reject(error));
        });
    }

    getLights() {
        return new Promise((resolve, reject) => {
            this.webclient.get('lights')
                .then(response => {
                    const result = JSON.parse(response);
                    if (result) {
                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining lights.'));
                    }
                })
                .catch(error => reject(error));
        });
    }

    setLightOn(light, isLightOn) {
        return new Promise((resolve, reject) => {
            const isLedForceOn = {
                isLedForceOn: isLightOn
            }
            const params = {
                isLightOn: isLightOn,
                lightOnSettings: isLedForceOn
            };
            return this.webclient.patch(`lights/${light.id}`, params)
                .then(() => resolve('isLightOn successfully set.'))
                .catch(error => reject(new Error(`Error setting isLightOn: ${error}`)));
        });
    }

    setLightLevel(light, ledLevel) {
        this.log(ledLevel);
        return new Promise((resolve, reject) => {
            const isLedForceOn = {
                ledLevel: ledLevel
            }
            const params = {
                lightDeviceSettings: isLedForceOn
            };
            return this.webclient.patch(`lights/${light.id}`, params)
                .then(() => resolve('setLightLevel successfully set.'))
                .catch(error => reject(new Error(`Error setting setLightLevel: ${error}`)));
        });
    }

    setLightMode(light, mode) {
        this.log(mode);
        return new Promise((resolve, reject) => {
            let lightModeSettings = {}
            if (mode === "motion") {
                lightModeSettings = {
                    mode: "motion",
                    enableAt: "fulltime"

                }
            }
            else if (mode === "motiondark") {
                lightModeSettings = {
                    mode: "motion",
                    enableAt: "dark"

                }
            }
            else {
                lightModeSettings = {
                    mode: mode,
                    enableAt: 'dark'

                }
            }
            const params = {
                lightModeSettings: lightModeSettings
            };
            return this.webclient.patch(`lights/${light.id}`, params)
                .then(() => resolve('setLightMode successfully set.'))
                .catch(error => reject(new Error(`Error setting setLightMode: ${error}`)));
        });
    }

    getSensors() {
        return new Promise((resolve, reject) => {
            this.webclient.get('sensors')
                .then(response => {
                    const result = JSON.parse(response);
                    if (result) {
                        return resolve(result);
                    } else {
                        return reject(new Error('Error obtaining sensors.'));
                    }
                })
                .catch(error => reject(error));
        });
    }
}

module.exports = ProtectAPI;
