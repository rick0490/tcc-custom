// Tournament Admin Dashboard - Service Worker
// Version 2: Fixed external URL handling and CSP issues
const CACHE_NAME = 'tournament-admin-v2';
const STATIC_CACHE = 'tournament-static-v2';
const DYNAMIC_CACHE = 'tournament-dynamic-v2';

// Static assets to cache on install (internal only - no external CDNs)
const STATIC_ASSETS = [
  '/css/style.css',
  '/js/utils.js',
  '/js/nav.js',
  '/js/dashboard.js',
  '/js/tournament.js',
  '/js/matches.js',
  '/js/participants.js',
  '/js/displays.js',
  '/js/flyers.js',
  '/js/settings.js',
  '/manifest.json'
];

// HTML pages - cached but always fetched fresh (network-first)
const HTML_PAGES = [
  '/',
  '/index.html',
  '/tournament.html',
  '/matches.html',
  '/participants.html',
  '/displays.html',
  '/flyers.html',
  '/settings.html',
  '/login.html',
  '/command-center.html',
  '/analytics.html',
  '/sponsors.html',
  '/games.html'
];

// Install event - cache static assets (internal only)
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker v2...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached');
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Install failed:', err);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              // Delete old cache versions
              return name.startsWith('tournament-') &&
                     name !== STATIC_CACHE &&
                     name !== DYNAMIC_CACHE;
            })
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - handle requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external URLs (CDNs, etc.) - let browser handle directly
  // This avoids CSP connect-src issues with external fetches
  if (url.origin !== self.location.origin) {
    return;
  }

  // API requests - network only, no cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML pages - network first (ensures fresh CSP headers)
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  // Static assets (JS, CSS, images) - stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// Network first strategy (for API calls)
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (error) {
    // For API calls, return an offline response
    return new Response(
      JSON.stringify({
        error: 'offline',
        message: 'You are currently offline. Please check your connection.'
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Network first with cache fallback (for HTML pages)
// Always tries network first to get fresh CSP headers
async function networkFirstWithCache(request) {
  const cache = await caches.open(STATIC_CACHE);

  try {
    const response = await fetch(request);
    // Cache successful responses for offline fallback
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Network failed, try cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // No cache, return offline page
    return new Response(
      '<html><body><h1>Offline</h1><p>Please check your connection.</p></body></html>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }
}

// Stale-while-revalidate strategy (for static assets)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);

  // Fetch from network in background
  const fetchPromise = fetch(request)
    .then((response) => {
      // Only cache successful responses
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => {
      // Network failed, rely on cache
      return cachedResponse;
    });

  // Return cached response immediately, or wait for network
  return cachedResponse || fetchPromise;
}

// Cache first strategy (for immutable assets)
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/');
    }
    throw error;
  }
}

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => caches.delete(name))
        );
      })
    );
  }
});

// Background sync for offline actions (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-match-updates') {
    console.log('[SW] Syncing match updates...');
    // Could implement offline queue sync here
  }
});

// ==========================================
// Push Notification Handling
// ==========================================

// Push event - received when a push notification is sent
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');

  let data = {
    title: 'Tournament Control Center',
    body: 'New notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: 'tcc-notification',
    data: {}
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      console.error('[SW] Error parsing push data:', e);
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/badge-72.png',
    tag: data.tag || 'tcc-notification',
    renotify: data.renotify || false,
    requireInteraction: data.requireInteraction || false,
    data: data.data || {},
    vibrate: data.vibrate || [200, 100, 200],
    actions: data.actions || []
  };

  // Add default actions based on notification type
  if (data.data?.type === 'match_completed') {
    options.actions = [
      { action: 'view-matches', title: 'View Matches' },
      { action: 'dismiss', title: 'Dismiss' }
    ];
  } else if (data.data?.type === 'display_disconnected') {
    options.actions = [
      { action: 'view-displays', title: 'View Displays' },
      { action: 'dismiss', title: 'Dismiss' }
    ];
  } else if (data.data?.type === 'new_signup') {
    options.actions = [
      { action: 'view-participants', title: 'View Participants' },
      { action: 'dismiss', title: 'Dismiss' }
    ];
  } else if (data.data?.type === 'dq_timer_expired') {
    options.actions = [
      { action: 'view-command-center', title: 'Command Center' },
      { action: 'dismiss', title: 'Dismiss' }
    ];
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click event - handle user interaction with notification
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);

  event.notification.close();

  // Handle action buttons
  const action = event.action || 'default';
  const data = event.notification.data || {};
  let url = '/';

  switch (action) {
    case 'view-matches':
      url = '/matches.html';
      break;
    case 'view-displays':
      url = '/displays.html';
      break;
    case 'view-participants':
      url = '/participants.html';
      break;
    case 'view-command-center':
      url = '/command-center.html';
      break;
    case 'dismiss':
      return; // Just close notification
    default:
      // Use URL from notification data if provided
      if (data.url) {
        url = data.url;
      } else if (data.type) {
        // Map notification type to URL
        const typeUrlMap = {
          'match_completed': '/command-center.html',
          'new_signup': '/participants.html',
          'display_disconnected': '/displays.html',
          'dq_timer_expired': '/command-center.html',
          'tournament_started': '/command-center.html',
          'checkin_deadline': '/participants.html',
          'test': '/'
        };
        url = typeUrlMap[data.type] || '/';
      }
  }

  // Focus existing window or open new one
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Try to focus an existing window
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Open new window if none found
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// Notification close event (dismissed without clicking)
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification dismissed');
});
