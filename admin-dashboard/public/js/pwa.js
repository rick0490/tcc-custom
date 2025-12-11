// PWA Registration and Management
// Tournament Admin Dashboard

(function() {
  'use strict';

  // Check if service workers are supported
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service workers not supported');
    return;
  }

  // Register service worker
  async function registerServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js?v=2', {
        scope: '/'
      });

      console.log('[PWA] Service worker registered:', registration.scope);

      // Check for updates on page load
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        console.log('[PWA] New service worker installing...');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available
            showUpdateNotification();
          }
        });
      });

      // Check for updates periodically (every 1 hour)
      setInterval(() => {
        registration.update();
      }, 60 * 60 * 1000);

    } catch (error) {
      console.error('[PWA] Service worker registration failed:', error);
    }
  }

  // Show update notification
  function showUpdateNotification() {
    // Check if showAlert is available (from utils.js)
    if (typeof showAlert === 'function') {
      showAlert('A new version is available. Refresh to update.', 'info', 10000);
    } else {
      console.log('[PWA] New version available - refresh to update');
    }

    // Add update banner to page
    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.className = 'fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-blue-600 text-white p-4 rounded-lg shadow-lg z-50 flex items-center justify-between';
    banner.innerHTML = `
      <div class="flex items-center gap-3">
        <svg class="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
        </svg>
        <span class="text-sm font-medium">New version available</span>
      </div>
      <button onclick="window.location.reload()" class="bg-white text-blue-600 px-3 py-1.5 rounded text-sm font-semibold hover:bg-blue-50 transition">
        Refresh
      </button>
    `;

    // Remove existing banner if present
    const existing = document.getElementById('pwa-update-banner');
    if (existing) existing.remove();

    document.body.appendChild(banner);
  }

  // Handle offline/online status
  function setupConnectivityHandlers() {
    let offlineBanner = null;

    function showOfflineBanner() {
      if (offlineBanner) return;

      offlineBanner = document.createElement('div');
      offlineBanner.id = 'pwa-offline-banner';
      offlineBanner.className = 'fixed top-0 left-0 right-0 bg-yellow-500 text-yellow-900 py-2 px-4 text-center text-sm font-medium z-50';
      offlineBanner.innerHTML = `
        <span>You are offline. Some features may be unavailable.</span>
      `;
      document.body.insertBefore(offlineBanner, document.body.firstChild);

      // Adjust main content margin
      const mainWrapper = document.querySelector('.main-wrapper');
      if (mainWrapper) {
        mainWrapper.style.marginTop = '40px';
      }
    }

    function hideOfflineBanner() {
      if (offlineBanner) {
        offlineBanner.remove();
        offlineBanner = null;

        // Reset main content margin
        const mainWrapper = document.querySelector('.main-wrapper');
        if (mainWrapper) {
          mainWrapper.style.marginTop = '';
        }
      }
    }

    window.addEventListener('online', () => {
      console.log('[PWA] Back online');
      hideOfflineBanner();
      if (typeof showAlert === 'function') {
        showAlert('Connection restored', 'success', 3000);
      }
    });

    window.addEventListener('offline', () => {
      console.log('[PWA] Gone offline');
      showOfflineBanner();
    });

    // Check initial state
    if (!navigator.onLine) {
      showOfflineBanner();
    }
  }

  // Handle beforeinstallprompt for install button
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    console.log('[PWA] Install prompt available');
    e.preventDefault();
    deferredPrompt = e;

    // Show install button in settings or header
    showInstallButton();
  });

  function showInstallButton() {
    // Add install button to header actions if available
    const headerActions = document.getElementById('headerActions');
    if (headerActions && !document.getElementById('pwa-install-btn')) {
      const installBtn = document.createElement('button');
      installBtn.id = 'pwa-install-btn';
      installBtn.className = 'flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition';
      installBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
        </svg>
        Install App
      `;
      installBtn.onclick = promptInstall;
      headerActions.prepend(installBtn);
    }
  }

  async function promptInstall() {
    if (!deferredPrompt) {
      console.log('[PWA] No install prompt available');
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Install prompt outcome:', outcome);

    if (outcome === 'accepted') {
      // Remove install button
      const installBtn = document.getElementById('pwa-install-btn');
      if (installBtn) installBtn.remove();
    }

    deferredPrompt = null;
  }

  // Detect if running as installed PWA
  function isInstalledPWA() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  // Initialize PWA features
  function init() {
    registerServiceWorker();
    setupConnectivityHandlers();

    if (isInstalledPWA()) {
      console.log('[PWA] Running as installed app');
      document.body.classList.add('pwa-standalone');
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual control
  window.pwa = {
    promptInstall,
    isInstalled: isInstalledPWA,
    clearCache: () => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
      }
    }
  };
})();
