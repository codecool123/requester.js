/**
 * Requester.js Service Worker
 * Handles notification action buttons and background notifications
 */

// Store for notification callbacks
const notificationCallbacks = new Map();

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data.type === 'STORE_NOTIFICATION_CALLBACKS') {
    notificationCallbacks.set(event.data.tag, event.data.callbacks);
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;
  
  event.notification.close();

  // Get stored callbacks for this notification
  const callbacks = notificationCallbacks.get(notification.tag);
  
  if (callbacks) {
    // If an action button was clicked
    if (action && callbacks.buttons) {
      const button = callbacks.buttons.find(btn => btn.action === action);
      if (button && button.callback) {
        // Send message to all clients to execute the callback
        event.waitUntil(
          self.clients.matchAll({ type: 'window' }).then(clients => {
            clients.forEach(client => {
              client.postMessage({
                type: 'NOTIFICATION_ACTION_CLICKED',
                action: action,
                tag: notification.tag,
                data: notification.data
              });
            });
          })
        );
      }
    } else if (callbacks.onClick) {
      // Main notification body clicked
      event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => {
            client.postMessage({
              type: 'NOTIFICATION_CLICKED',
              tag: notification.tag,
              data: notification.data
            });
          });
        })
      );
    }
  }

  // Focus or open a window
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Check if there's already a window open
      for (const client of clients) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  const notification = event.notification;
  const callbacks = notificationCallbacks.get(notification.tag);
  
  if (callbacks && callbacks.onClose) {
    self.clients.matchAll({ type: 'window' }).then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'NOTIFICATION_CLOSED',
          tag: notification.tag,
          data: notification.data
        });
      });
    });
  }
  
  // Clean up stored callbacks
  notificationCallbacks.delete(notification.tag);
});

// Service worker installation
self.addEventListener('install', (event) => {
  console.log('Requester.js Service Worker installed');
  self.skipWaiting();
});

// Service worker activation
self.addEventListener('activate', (event) => {
  console.log('Requester.js Service Worker activated');
  event.waitUntil(self.clients.claim());
});
