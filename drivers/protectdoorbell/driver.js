'use strict';

const Homey = require('homey');

class UniFiDoorbellDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    Homey.app.debug('UnifiDoorbell Driver has been initialized');
  }

  onPair(socket) {
    // Validate NVR IP address
    socket.on('validate', (data, callback) => {
      const nvrip = Homey.ManagerSettings.get('ufp:nvrip');
      callback(null, nvrip ? 'ok' : 'nok');
    });

    // Perform when device list is shown
    socket.on('list_devices', async (data, callback) => {
      callback(null, Object.values(await Homey.app.api.getDoorbells()).map(camera => {
        return {
          data: { id: String(camera.id) },
          name: camera.name,
        };
      }));
    });
  }

  onParseWebsocketMessage(camera, payload) {
    if (Object.prototype.hasOwnProperty.call(camera, '_events')) {
      Homey.app.debug(JSON.stringify(payload));
      if (payload.hasOwnProperty('isRecording')) {
        camera.onIsRecording(payload.isRecording);
      }

      if (payload.hasOwnProperty('isMicEnabled')) {
        camera.onIsMicEnabled(payload.isMicEnabled);
      }

      if (payload.hasOwnProperty('micVolume')) {
        camera.onMicVolume(payload.micVolume);
      }

      if (payload.hasOwnProperty('isConnected')) {
        camera.onIsConnected(payload.isConnected);
      }

      if (payload.hasOwnProperty('recordingSettings') && payload.recordingSettings.hasOwnProperty('mode')) {
        camera.onRecordingMode(payload.recordingSettings.mode);
      }

      if (payload.hasOwnProperty('lastMotion')) {
        camera.onMotionDetected(payload.lastMotion, payload.isMotionDetected);
      }

      if (payload.hasOwnProperty('smartDetectTypes')) {
        camera.onSmartDetection(payload.start, payload.smartDetectTypes, payload.score);
      }

      if (payload.hasOwnProperty('lastRing')) {
        camera.onDoorbellRinging(payload.lastRing);
      }

      if (payload.hasOwnProperty('isDark')) {
        camera.onIsDark(payload.isDark);
      }
    }
  }

  getUnifiDeviceById(camera) {
    const device = this.getDevice({
      id: camera,
    });

    return device;
  }
}

module.exports = UniFiDoorbellDriver;
