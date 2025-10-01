/**
 * Requester.js - A comprehensive library for handling browser permissions and device access
 * @version 1.0.0
 */

class Requester {
  constructor() {
    this.settings = {
      showErrorPopup: true,
      errorPopupDuration: 3000,
      errorPopupStyle: {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '15px 20px',
        background: '#f44336',
        color: 'white',
        borderRadius: '5px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        zIndex: '10000',
        fontFamily: 'Arial, sans-serif',
        maxWidth: '300px'
      },
      onAccept: null,
      onDecline: null,
      onError: null,
      useServiceWorker: false,
      serviceWorkerPath: '/requester-sw.js'
    };
    
    this.activeStreams = {
      camera: null,
      microphone: null,
      screen: null
    };

    this.serviceWorkerRegistration = null;
    this.notificationCallbacks = new Map();
    this._setupServiceWorkerMessageListener();
  }

  /**
   * Configure Requester settings
   * @param {Object} options - Configuration options
   */
  setSettings(options = {}) {
    this.settings = { ...this.settings, ...options };
    if (options.errorPopupStyle) {
      this.settings.errorPopupStyle = { ...this.settings.errorPopupStyle, ...options.errorPopupStyle };
    }
  }

  /**
   * Setup Service Worker message listener
   * @private
   */
  _setupServiceWorkerMessageListener() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type, tag, action } = event.data;
        const callbacks = this.notificationCallbacks.get(tag);

        if (!callbacks) return;

        switch (type) {
          case 'NOTIFICATION_ACTION_CLICKED':
            const button = callbacks.buttons?.find(btn => btn.action === action);
            if (button && button.onClick) {
              button.onClick();
            }
            break;
          case 'NOTIFICATION_CLICKED':
            if (callbacks.onClick) {
              callbacks.onClick();
            }
            break;
          case 'NOTIFICATION_CLOSED':
            if (callbacks.onClose) {
              callbacks.onClose();
            }
            this.notificationCallbacks.delete(tag);
            break;
        }
      });
    }
  }

  /**
   * Register Service Worker for advanced notification features
   * @returns {Promise<ServiceWorkerRegistration>}
   */
  async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Workers are not supported in this browser');
    }

    try {
      this.serviceWorkerRegistration = await navigator.serviceWorker.register(
        this.settings.serviceWorkerPath
      );
      
      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;
      
      this.settings.useServiceWorker = true;
      console.log('Requester.js: Service Worker registered successfully');
      
      return this.serviceWorkerRegistration;
    } catch (error) {
      console.error('Requester.js: Service Worker registration failed:', error);
      throw error;
    }
  }

  /**
   * Show error popup
   * @private
   */
  _showError(message) {
    if (!this.settings.showErrorPopup) return;
    
    const popup = document.createElement('div');
    Object.assign(popup.style, this.settings.errorPopupStyle);
    popup.textContent = message;
    
    document.body.appendChild(popup);
    
    setTimeout(() => {
      popup.style.transition = 'opacity 0.3s';
      popup.style.opacity = '0';
      setTimeout(() => popup.remove(), 300);
    }, this.settings.errorPopupDuration);
  }

  /**
   * Handle response with callbacks
   * @private
   */
  _handleResponse(success, result, error = null) {
    if (success && this.settings.onAccept) {
      this.settings.onAccept(result);
    } else if (!success && this.settings.onDecline) {
      this.settings.onDecline(error);
    }
    
    if (error && this.settings.onError) {
      this.settings.onError(error);
    }
    
    return success ? result : null;
  }

  // ========== NOTIFICATIONS ==========

  /**
   * Request notification permission
   * @param {Object} options - Custom callbacks
   * @returns {Promise<string>} Permission status
   */
  async requestNotifications(options = {}) {
    try {
      if (!('Notification' in window)) {
        const error = 'Notifications not supported in this browser';
        this._showError(error);
        if (options.onDecline) options.onDecline(error);
        return this._handleResponse(false, null, error);
      }

      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        if (options.onAccept) options.onAccept(permission);
        return this._handleResponse(true, permission);
      } else {
        const error = 'Notification permission denied';
        this._showError(error);
        if (options.onDecline) options.onDecline(error);
        return this._handleResponse(false, null, error);
      }
    } catch (error) {
      this._showError(`Notification error: ${error.message}`);
      if (options.onError) options.onError(error);
      return this._handleResponse(false, null, error);
    }
  }

  /**
   * Send a notification
   * @param {string} title - Notification title
   * @param {string} text - Notification body
   * @param {string} attachment - Icon URL (optional)
   * @param {Object} options - Notification options (buttons, onClick, onClose, etc.)
   * @returns {Notification|Promise<void>|null}
   */
  async sendNotification(title, text, attachment = null, options = {}) {
    if (Notification.permission !== 'granted') {
      this._showError('Notification permission not granted');
      return null;
    }

    // Check if buttons are requested
    const hasButtons = options.buttons && options.buttons.length > 0;

    // If buttons are requested but SW not registered, try to use SW anyway or warn
    if (hasButtons && !this.settings.useServiceWorker) {
      console.warn('Requester.js: Buttons requested but Service Worker not registered. Sending notification without buttons. Call registerServiceWorker() first for button support.');
      // Remove buttons from options to prevent error
      const optionsWithoutButtons = { ...options };
      delete optionsWithoutButtons.buttons;
      return this._sendBasicNotification(title, text, attachment, optionsWithoutButtons);
    }

    // Use Service Worker for notifications with buttons
    if (this.settings.useServiceWorker && this.serviceWorkerRegistration && hasButtons) {
      return this._sendServiceWorkerNotification(title, text, attachment, options);
    }

    // Use basic Notification API
    return this._sendBasicNotification(title, text, attachment, options);
  }

  /**
   * Send notification using Service Worker (supports buttons)
   * @private
   */
  async _sendServiceWorkerNotification(title, text, attachment, options) {
    try {
      const tag = options.tag || `notification-${Date.now()}`;
      
      const notifOptions = {
        body: text,
        icon: attachment,
        tag: tag,
        badge: options.badge,
        image: options.image,
        data: options.data,
        requireInteraction: options.requireInteraction,
        silent: options.silent,
        vibrate: options.vibrate
      };

      // Add action buttons
      if (options.buttons && options.buttons.length > 0) {
        notifOptions.actions = options.buttons.map((btn, idx) => ({
          action: btn.action || `action-${idx}`,
          title: btn.label || btn.title || `Button ${idx + 1}`,
          icon: btn.icon
        }));

        // Store callbacks with action references
        const callbackData = {
          buttons: options.buttons.map((btn, idx) => ({
            action: btn.action || `action-${idx}`,
            onClick: btn.onClick
          })),
          onClick: options.onClick,
          onClose: options.onClose
        };

        this.notificationCallbacks.set(tag, callbackData);

        // Send callbacks info to service worker
        this.serviceWorkerRegistration.active.postMessage({
          type: 'STORE_NOTIFICATION_CALLBACKS',
          tag: tag,
          callbacks: callbackData
        });
      }

      // Show notification via service worker
      await this.serviceWorkerRegistration.showNotification(title, notifOptions);
      
      return { tag, registration: this.serviceWorkerRegistration };
    } catch (error) {
      this._showError(`Failed to create notification: ${error.message}`);
      if (options.onError) {
        options.onError(error);
      }
      return null;
    }
  }

  /**
   * Send basic notification (no buttons)
   * @private
   */
  _sendBasicNotification(title, text, attachment, options) {
    // List of properties that are NOT part of the Notification constructor
    const nonNotificationProps = ['buttons', 'onClick', 'onClose', 'onError'];

    // Only include supported properties for basic Notification API
    const notifOptions = {
      body: text,
      icon: attachment
    };

    // Add optional supported properties if provided (excluding callbacks and buttons)
    for (const key in options) {
      if (options.hasOwnProperty(key) && !nonNotificationProps.includes(key)) {
        notifOptions[key] = options[key];
      }
    }

    // Explicitly remove actions if it somehow got through
    delete notifOptions.actions;
    delete notifOptions.buttons;

    // Warn about buttons without service worker
    if (options.buttons && options.buttons.length > 0) {
      console.warn('Requester.js: Action buttons require Service Worker. Call registerServiceWorker() first, or buttons will be ignored.');
    }

    try {
      const notification = new Notification(title, notifOptions);

      // Handle notification click
      notification.onclick = (e) => {
        if (options.onClick) {
          options.onClick(e);
        }
        notification.close();
      };

      notification.onclose = (e) => {
        if (options.onClose) {
          options.onClose(e);
        }
      };

      notification.onerror = (e) => {
        if (options.onError) {
          options.onError(e);
        }
      };

      return notification;
    } catch (error) {
      this._showError(`Failed to create notification: ${error.message}`);
      if (options.onError) {
        options.onError(error);
      }
      return null;
    }
  }

  // ========== CAMERA ==========

  /**
   * Request camera access
   * @param {Object} options - Custom callbacks and constraints
   * @returns {Promise<MediaStream|null>}
   */
  async requestCamera(options = {}) {
    try {
      const constraints = {
        video: options.constraints?.video || true,
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.activeStreams.camera = stream;
      
      if (options.onAccept) options.onAccept(stream);
      return this._handleResponse(true, stream);
    } catch (error) {
      this._showError(`Camera access denied: ${error.message}`);
      if (options.onDecline) options.onDecline(error);
      return this._handleResponse(false, null, error);
    }
  }

  /**
   * Get camera feed (alias for requestCamera)
   * @param {Object} options - Custom callbacks and constraints
   * @returns {Promise<MediaStream|null>}
   */
  getCameraFeed(options = {}) {
    return this.requestCamera(options);
  }

  /**
   * Stop camera stream
   */
  stopCamera() {
    if (this.activeStreams.camera) {
      this.activeStreams.camera.getTracks().forEach(track => track.stop());
      this.activeStreams.camera = null;
    }
  }

  // ========== MICROPHONE ==========

  /**
   * Request microphone access
   * @param {Object} options - Custom callbacks and constraints
   * @returns {Promise<MediaStream|null>}
   */
  async requestMicrophone(options = {}) {
    try {
      const constraints = {
        audio: options.constraints?.audio || true,
        video: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.activeStreams.microphone = stream;
      
      if (options.onAccept) options.onAccept(stream);
      return this._handleResponse(true, stream);
    } catch (error) {
      this._showError(`Microphone access denied: ${error.message}`);
      if (options.onDecline) options.onDecline(error);
      return this._handleResponse(false, null, error);
    }
  }

  /**
   * Get microphone stream (alias)
   * @param {Object} options - Custom callbacks and constraints
   * @returns {Promise<MediaStream|null>}
   */
  getMicrophoneFeed(options = {}) {
    return this.requestMicrophone(options);
  }

  /**
   * Stop microphone stream
   */
  stopMicrophone() {
    if (this.activeStreams.microphone) {
      this.activeStreams.microphone.getTracks().forEach(track => track.stop());
      this.activeStreams.microphone = null;
    }
  }

  // ========== CAMERA + MICROPHONE ==========

  /**
   * Request both camera and microphone
   * @param {Object} options - Custom callbacks and constraints
   * @returns {Promise<MediaStream|null>}
   */
  async requestCameraAndMicrophone(options = {}) {
    try {
      const constraints = {
        video: options.constraints?.video || true,
        audio: options.constraints?.audio || true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.activeStreams.camera = stream;
      this.activeStreams.microphone = stream;
      
      if (options.onAccept) options.onAccept(stream);
      return this._handleResponse(true, stream);
    } catch (error) {
      this._showError(`Media access denied: ${error.message}`);
      if (options.onDecline) options.onDecline(error);
      return this._handleResponse(false, null, error);
    }
  }

  // ========== GEOLOCATION ==========

  /**
   * Request geolocation access
   * @param {Object} options - Custom callbacks and position options
   * @returns {Promise<GeolocationPosition|null>}
   */
  async requestGeolocation(options = {}) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        const error = 'Geolocation not supported';
        this._showError(error);
        if (options.onDecline) options.onDecline(error);
        resolve(this._handleResponse(false, null, error));
        return;
      }

      const posOptions = {
        enableHighAccuracy: options.enableHighAccuracy || false,
        timeout: options.timeout || 5000,
        maximumAge: options.maximumAge || 0
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (options.onAccept) options.onAccept(position);
          resolve(this._handleResponse(true, position));
        },
        (error) => {
          this._showError(`Geolocation denied: ${error.message}`);
          if (options.onDecline) options.onDecline(error);
          resolve(this._handleResponse(false, null, error));
        },
        posOptions
      );
    });
  }

  /**
   * Watch geolocation continuously
   * @param {Function} callback - Called on each position update
   * @param {Object} options - Position options
   * @returns {number} Watch ID
   */
  watchGeolocation(callback, options = {}) {
    if (!navigator.geolocation) {
      this._showError('Geolocation not supported');
      return null;
    }

    const posOptions = {
      enableHighAccuracy: options.enableHighAccuracy || false,
      timeout: options.timeout || 5000,
      maximumAge: options.maximumAge || 0
    };

    return navigator.geolocation.watchPosition(
      callback,
      (error) => {
        this._showError(`Geolocation error: ${error.message}`);
        if (options.onError) options.onError(error);
      },
      posOptions
    );
  }

  /**
   * Clear geolocation watch
   * @param {number} watchId - Watch ID to clear
   */
  clearGeolocationWatch(watchId) {
    if (navigator.geolocation && watchId) {
      navigator.geolocation.clearWatch(watchId);
    }
  }

  // ========== SCREEN CAPTURE ==========

  /**
   * Request screen capture
   * @param {Object} options - Custom callbacks and display media options
   * @returns {Promise<MediaStream|null>}
   */
  async requestScreenCapture(options = {}) {
    try {
      const constraints = options.constraints || {
        video: { mediaSource: 'screen' },
        audio: options.includeAudio || false
      };

      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      this.activeStreams.screen = stream;
      
      if (options.onAccept) options.onAccept(stream);
      return this._handleResponse(true, stream);
    } catch (error) {
      this._showError(`Screen capture denied: ${error.message}`);
      if (options.onDecline) options.onDecline(error);
      return this._handleResponse(false, null, error);
    }
  }

  /**
   * Stop screen capture
   */
  stopScreenCapture() {
    if (this.activeStreams.screen) {
      this.activeStreams.screen.getTracks().forEach(track => track.stop());
      this.activeStreams.screen = null;
    }
  }

  // ========== MIDI ==========

  /**
   * Request MIDI access
   * @param {Object} options - Custom callbacks and MIDI options
   * @returns {Promise<MIDIAccess|null>}
   */
  async requestMIDI(options = {}) {
    try {
      if (!navigator.requestMIDIAccess) {
        const error = 'Web MIDI not supported';
        this._showError(error);
        if (options.onDecline) options.onDecline(error);
        return this._handleResponse(false, null, error);
      }

      const midiOptions = {
        sysex: options.sysex || false
      };

      const midiAccess = await navigator.requestMIDIAccess(midiOptions);
      
      if (options.onAccept) options.onAccept(midiAccess);
      return this._handleResponse(true, midiAccess);
    } catch (error) {
      this._showError(`MIDI access denied: ${error.message}`);
      if (options.onDecline) options.onDecline(error);
      return this._handleResponse(false, null, error);
    }
  }

  // ========== CLIPBOARD ==========

  /**
   * Request clipboard read permission
   * @param {Object} options - Custom callbacks
   * @returns {Promise<string|null>}
   */
  async requestClipboardRead(options = {}) {
    try {
      const text = await navigator.clipboard.readText();
      
      if (options.onAccept) options.onAccept(text);
      return this._handleResponse(true, text);
    } catch (error) {
      this._showError(`Clipboard read denied: ${error.message}`);
      if (options.onDecline) options.onDecline(error);
      return this._handleResponse(false, null, error);
    }
  }

  /**
   * Write to clipboard
   * @param {string} text - Text to write
   * @returns {Promise<boolean>}
   */
  async writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      this._showError(`Clipboard write failed: ${error.message}`);
      return false;
    }
  }

  // ========== FULLSCREEN ==========

  /**
   * Request fullscreen mode
   * @param {HTMLElement} element - Element to fullscreen (defaults to document.documentElement)
   * @param {Object} options - Custom callbacks
   * @returns {Promise<boolean>}
   */
  async requestFullscreen(element = document.documentElement, options = {}) {
    try {
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        await element.webkitRequestFullscreen();
      } else if (element.msRequestFullscreen) {
        await element.msRequestFullscreen();
      } else {
        throw new Error('Fullscreen not supported');
      }
      
      if (options.onAccept) options.onAccept();
      return this._handleResponse(true, true);
    } catch (error) {
      this._showError(`Fullscreen request failed: ${error.message}`);
      if (options.onDecline) options.onDecline(error);
      return this._handleResponse(false, false, error);
    }
  }

  /**
   * Exit fullscreen mode
   */
  exitFullscreen() {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }

  // ========== DEVICE ORIENTATION ==========

  /**
   * Request device orientation/motion permission (iOS 13+)
   * @param {Object} options - Custom callbacks
   * @returns {Promise<string|null>}
   */
  async requestDeviceOrientation(options = {}) {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && 
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        
        if (permission === 'granted') {
          if (options.onAccept) options.onAccept(permission);
          return this._handleResponse(true, permission);
        } else {
          const error = 'Device orientation permission denied';
          this._showError(error);
          if (options.onDecline) options.onDecline(error);
          return this._handleResponse(false, null, error);
        }
      } else {
        // Permission not required on this device
        if (options.onAccept) options.onAccept('granted');
        return this._handleResponse(true, 'granted');
      }
    } catch (error) {
      this._showError(`Device orientation error: ${error.message}`);
      if (options.onError) options.onError(error);
      return this._handleResponse(false, null, error);
    }
  }

  // ========== MAILTO ==========

  /**
   * Open mailto link with custom parameters
   * @param {Object} params - Email parameters
   * @returns {boolean}
   */
  openMailto(params = {}) {
    try {
      const { to = '', cc = '', bcc = '', subject = '', body = '' } = params;
      
      const mailtoParams = [];
      if (cc) mailtoParams.push(`cc=${encodeURIComponent(cc)}`);
      if (bcc) mailtoParams.push(`bcc=${encodeURIComponent(bcc)}`);
      if (subject) mailtoParams.push(`subject=${encodeURIComponent(subject)}`);
      if (body) mailtoParams.push(`body=${encodeURIComponent(body)}`);
      
      const mailtoLink = `mailto:${to}${mailtoParams.length ? '?' + mailtoParams.join('&') : ''}`;
      window.location.href = mailtoLink;
      
      return true;
    } catch (error) {
      this._showError(`Mailto error: ${error.message}`);
      return false;
    }
  }

  // ========== BLUETOOTH ==========

  /**
   * Request Bluetooth device access
   * @param {Object} options - Custom callbacks and filter options
   * @returns {Promise<BluetoothDevice|null>}
   */
  async requestBluetooth(options = {}) {
    try {
      if (!navigator.bluetooth) {
        const error = 'Web Bluetooth not supported in this browser';
        this._showError(error);
        if (options.onDecline) options.onDecline(error);
        return this._handleResponse(false, null, error);
      }

      // Check if bluetooth is available (requires HTTPS)
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        const error = 'Web Bluetooth requires HTTPS';
        this._showError(error);
        if (options.onDecline) options.onDecline(error);
        return this._handleResponse(false, null, error);
      }

      const requestOptions = {};

      // If no filters provided, accept all devices
      if (!options.filters || options.filters.length === 0) {
        requestOptions.acceptAllDevices = true;
      } else {
        requestOptions.filters = options.filters;
      }

      // Add optional services if provided
      if (options.optionalServices && options.optionalServices.length > 0) {
        requestOptions.optionalServices = options.optionalServices;
      }

      const device = await navigator.bluetooth.requestDevice(requestOptions);
      
      if (options.onAccept) options.onAccept(device);
      return this._handleResponse(true, device);
    } catch (error) {
      const errorMsg = error.message.includes('permissions policy') 
        ? 'Bluetooth access blocked by permissions policy. This requires HTTPS and proper permissions.'
        : `Bluetooth access denied: ${error.message}`;
      this._showError(errorMsg);
      if (options.onDecline) options.onDecline(error);
      return this._handleResponse(false, null, error);
    }
  }

  // ========== UTILITY METHODS ==========

  /**
   * Stop all active streams
   */
  stopAllStreams() {
    this.stopCamera();
    this.stopMicrophone();
    this.stopScreenCapture();
  }

  /**
   * Check if a permission is granted
   * @param {string} permissionName - Name of the permission
   * @returns {Promise<string>} Permission state
   */
  async checkPermission(permissionName) {
    try {
      const result = await navigator.permissions.query({ name: permissionName });
      return result.state;
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Get all available media devices
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async getMediaDevices() {
    try {
      return await navigator.mediaDevices.enumerateDevices();
    } catch (error) {
      this._showError(`Failed to enumerate devices: ${error.message}`);
      return [];
    }
  }
}

// Export for use in different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Requester;
} else {
  window.Requester = Requester;
}
