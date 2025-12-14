const CACHE_VERSION = 4;
const CACHE_NAME = `tournament-signup-v${CACHE_VERSION}`;
const urlsToCache = [
  '/',
  '/rules',
  '/confirmation',
  '/manifest.json',
  'https://cdn.tailwindcss.com'
];

// IndexedDB for offline signup queue
const DB_NAME = 'tournament-signup-db';
const DB_VERSION = 1;
const SIGNUP_STORE = 'pending-signups';

// ==================== INDEXEDDB HELPERS ====================

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create object store for pending signups
      if (!db.objectStoreNames.contains(SIGNUP_STORE)) {
        const store = db.createObjectStore(SIGNUP_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('status', 'status', { unique: false });
      }
    };
  });
}

async function addPendingSignup(signupData) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SIGNUP_STORE], 'readwrite');
    const store = transaction.objectStore(SIGNUP_STORE);

    const signup = {
      ...signupData,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0
    };

    const request = store.add(signup);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getPendingSignups() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SIGNUP_STORE], 'readonly');
    const store = transaction.objectStore(SIGNUP_STORE);
    const index = store.index('status');
    const request = index.getAll('pending');

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function updateSignupStatus(id, status, error = null) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SIGNUP_STORE], 'readwrite');
    const store = transaction.objectStore(SIGNUP_STORE);

    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const signup = getRequest.result;
      if (signup) {
        signup.status = status;
        signup.lastError = error;
        signup.retryCount = (signup.retryCount || 0) + 1;
        signup.lastAttempt = Date.now();
        store.put(signup);
      }
      resolve();
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

async function removeSignup(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SIGNUP_STORE], 'readwrite');
    const store = transaction.objectStore(SIGNUP_STORE);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ==================== INSTALL & ACTIVATE ====================

// Install service worker and cache resources
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing version', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching files');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('Service Worker: Cache failed', error);
      })
  );
  // Don't skipWaiting() immediately - let the controlling page decide
});

// Activate service worker and clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// ==================== FETCH HANDLER ====================

// Fetch event - network first, fall back to cache for API calls
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle signup requests specially for offline support
  if (url.pathname === '/api/signup' && request.method === 'POST') {
    event.respondWith(handleSignupRequest(request.clone()));
    return;
  }

  // Network-first strategy for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response before caching
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fall back to cache if network fails
          return caches.match(request);
        })
    );
    return;
  }

  // Cache-first strategy for static assets
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached version and update in background
          fetch(request).then((response) => {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, response);
            });
          }).catch(() => {
            // Network failed, but we have cache
          });
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetch(request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }

            // Clone the response
            const responseClone = response.clone();

            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });

            return response;
          })
          .catch((error) => {
            console.error('Service Worker: Fetch failed', error);
            // Return offline page if available
            return caches.match('/');
          });
      })
  );
});

// ==================== OFFLINE SIGNUP HANDLING ====================

async function handleSignupRequest(request) {
  try {
    // Try network first
    const response = await fetch(request);
    return response;
  } catch (error) {
    // Network failed - queue for later
    console.log('Service Worker: Network unavailable, queuing signup');

    try {
      const signupData = await request.json();
      await addPendingSignup(signupData);

      // Register for background sync
      if ('sync' in self.registration) {
        await self.registration.sync.register('sync-signup');
      }

      // Return a synthetic response indicating queued status
      return new Response(JSON.stringify({
        success: true,
        queued: true,
        message: 'Your signup has been saved and will be submitted when you\'re back online.'
      }), {
        status: 202,
        statusText: 'Accepted',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (queueError) {
      console.error('Service Worker: Failed to queue signup', queueError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Network unavailable. Please try again when connected.'
      }), {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}

// ==================== BACKGROUND SYNC ====================

self.addEventListener('sync', (event) => {
  console.log('Service Worker: Background sync triggered', event.tag);

  if (event.tag === 'sync-signup') {
    event.waitUntil(syncPendingSignups());
  }
});

async function syncPendingSignups() {
  console.log('Service Worker: Syncing pending signups');

  try {
    const pendingSignups = await getPendingSignups();
    console.log(`Service Worker: Found ${pendingSignups.length} pending signups`);

    for (const signup of pendingSignups) {
      try {
        const response = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participantName: signup.participantName,
            instagram: signup.instagram,
            notes: signup.notes
          })
        });

        const result = await response.json();

        if (result.success) {
          // Remove from queue and notify user
          await removeSignup(signup.id);
          console.log('Service Worker: Signup synced successfully', signup.participantName);

          // Show notification to user
          await showNotification('Signup Successful!', {
            body: `${signup.participantName} has been registered for the tournament.`,
            tag: `signup-success-${signup.id}`,
            data: { type: 'signup-success', participantName: signup.participantName }
          });
        } else {
          // Update status with error
          await updateSignupStatus(signup.id, 'failed', result.error?.message || result.error);

          // If it's a permanent error (like duplicate name), don't retry
          if (result.error?.code === 'DUPLICATE_NAME' || signup.retryCount >= 3) {
            await showNotification('Signup Failed', {
              body: result.error?.message || 'Unable to complete your signup.',
              tag: `signup-failed-${signup.id}`,
              data: { type: 'signup-failed', error: result.error }
            });
          }
        }
      } catch (error) {
        console.error('Service Worker: Failed to sync signup', signup.id, error);
        await updateSignupStatus(signup.id, 'pending', error.message);
      }
    }
  } catch (error) {
    console.error('Service Worker: Sync failed', error);
  }
}

// ==================== PUSH NOTIFICATIONS ====================

self.addEventListener('push', (event) => {
  console.log('Service Worker: Push notification received');

  let data = {
    title: 'Tournament Update',
    body: 'You have a new tournament notification!',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png'
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = {
        title: payload.title || data.title,
        body: payload.body || data.body,
        icon: payload.icon || data.icon,
        badge: payload.badge || data.badge,
        tag: payload.tag || 'tournament-notification',
        data: payload.data || {},
        actions: payload.actions || []
      };
    } catch (e) {
      // If not JSON, use text
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: data.tag,
    data: data.data,
    vibrate: [200, 100, 200],
    requireInteraction: data.data?.requireInteraction || false
  };

  if (data.actions && data.actions.length > 0) {
    options.actions = data.actions;
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked', event.action);
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = '/';

  // Handle different notification types
  if (data.type === 'registration_open') {
    targetUrl = '/';
  } else if (data.type === 'tournament_starting') {
    targetUrl = data.bracketUrl || '/';
  } else if (data.type === 'signup-success') {
    targetUrl = `/confirmation?name=${encodeURIComponent(data.participantName || '')}`;
  } else if (data.url) {
    targetUrl = data.url;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing window if possible
        for (const client of clientList) {
          if (client.url === targetUrl && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// Helper to show notifications
async function showNotification(title, options) {
  if (self.Notification && self.Notification.permission === 'granted') {
    return self.registration.showNotification(title, {
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [200, 100, 200],
      ...options
    });
  }
}

// ==================== MESSAGES FROM MAIN THREAD ====================

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('Service Worker: Skipping waiting per user request');
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }

  if (event.data && event.data.type === 'GET_PENDING_SIGNUPS') {
    getPendingSignups().then((signups) => {
      event.ports[0].postMessage({ signups });
    });
  }

  if (event.data && event.data.type === 'SYNC_NOW') {
    syncPendingSignups().then(() => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: true });
      }
    });
  }
});
