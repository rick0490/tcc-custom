/**
 * Main application controller for Tournament Signup PWA
 * @module app
 */

import { getStorageItem, setStorageItem, removeStorageItem, formatDateInUserTimezone, getTimezoneAbbr } from './utils.js';
import { fetchTournament, submitSignup, lookupParticipant, joinWaitlist, checkWaitlistStatus as apiCheckWaitlistStatus, getVapidPublicKey, subscribeToPush, unsubscribeFromPush } from './api.js';
import * as UI from './ui.js';

// ==================== APPLICATION STATE ====================

/** @type {Object|null} Current tournament data */
let tournamentData = null;

/** @type {ReturnType<typeof setInterval>|null} Auto-refresh interval */
let autoRefreshInterval = null;

/** @type {Object|null} Socket.IO connection */
let socket = null;

/** @type {boolean} WebSocket connection status */
let wsConnected = false;

/** Polling intervals (ms) */
const POLL_INTERVAL_WS = 60000; // 60s when WebSocket connected
const POLL_INTERVAL_NO_WS = 30000; // 30s when disconnected

// ==================== WEBSOCKET MANAGEMENT ====================

/**
 * Initialize WebSocket connection for real-time updates
 */
function initWebSocket() {
    // Get admin API URL from current origin
    const wsUrl = window.location.origin.replace(':3001', ':3000');

    try {
        // Socket.IO is loaded via CDN in HTML
        socket = io(wsUrl, {
            transports: ['websocket', 'polling'],
            timeout: 10000,
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 3000
        });

        socket.on('connect', () => {
            console.log('[WebSocket] Connected to admin dashboard');
            wsConnected = true;
            UI.updateConnectionIndicator(true);
            // Slow down polling when WebSocket is connected
            restartAutoRefresh(POLL_INTERVAL_WS);
        });

        socket.on('disconnect', () => {
            console.log('[WebSocket] Disconnected');
            wsConnected = false;
            UI.updateConnectionIndicator(false);
            // Speed up polling when WebSocket is disconnected
            restartAutoRefresh(POLL_INTERVAL_NO_WS);
        });

        socket.on('connect_error', (error) => {
            console.warn('[WebSocket] Connection error:', error.message);
            wsConnected = false;
            UI.updateConnectionIndicator(false);
        });

        // Listen for participant added events
        socket.on('participant:added', (data) => {
            console.log('[WebSocket] Participant added:', data);
            // Only update if it's for our tournament
            if (tournamentData && data.tournamentId === tournamentData.id) {
                // Increment participant count locally
                tournamentData.participantsCount = (tournamentData.participantsCount || 0) + 1;
                // Update capacity display
                UI.updateCapacityDisplay(tournamentData);
                // Show notification
                UI.showNewSignupNotification(data.participant?.name || 'Someone');
            }
        });

        // Listen for tournament state changes
        socket.on('tournament:updated', (data) => {
            console.log('[WebSocket] Tournament updated:', data);
            if (tournamentData && data.tournament?.id === tournamentData.id) {
                // Refresh tournament data
                loadTournament();
            }
        });

        socket.on('tournament:started', (data) => {
            console.log('[WebSocket] Tournament started:', data);
            // Refresh to show registration closed
            loadTournament();
        });

    } catch (error) {
        console.warn('[WebSocket] Init failed:', error);
    }
}

// ==================== AUTO-REFRESH ====================

/**
 * Restart the auto-refresh interval with a new delay
 * @param {number} interval - Interval in milliseconds
 */
function restartAutoRefresh(interval) {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    autoRefreshInterval = setInterval(async () => {
        console.log(`Auto-refreshing tournament data (${interval / 1000}s interval)...`);
        await loadTournament();
    }, interval);
}

/**
 * Start auto-refresh with adaptive interval based on WebSocket connection
 */
function startAutoRefresh() {
    const interval = wsConnected ? POLL_INTERVAL_WS : POLL_INTERVAL_NO_WS;
    restartAutoRefresh(interval);
    // Initialize WebSocket for real-time updates
    initWebSocket();
}

// ==================== TOURNAMENT LOADING ====================

/**
 * Load and display tournament information
 */
async function loadTournament() {
    const response = await fetchTournament();

    if (response.success && response.tournament) {
        tournamentData = response.tournament;
        displayTournament(response.tournament);
        checkWaitlistStatus();
    } else {
        UI.showTournamentError();
    }
}

/**
 * Display tournament information and handle registration status
 * @param {Object} tournament - Tournament data
 */
function displayTournament(tournament) {
    UI.displayTournamentHeader(tournament);
    UI.updateCapacityDisplay(tournament);
    handleRegistrationStatus(tournament);
}

/**
 * Handle registration status and show appropriate UI
 * @param {Object} tournament - Tournament data
 */
function handleRegistrationStatus(tournament) {
    // Check if tournament is full
    if (tournament.isFull) {
        const capacityEl = document.getElementById('capacity-display');
        if (capacityEl) {
            capacityEl.textContent = `${tournament.participantsCount}/${tournament.signupCap}`;
        }
        UI.showRegistrationMessage('full');
        return;
    }

    // Check if registration is closed (too early)
    if (!tournament.registrationOpen && tournament.registrationReason === 'too_early') {
        // Show registration opens time in user's local timezone
        const opensAtFormatted = formatDateInUserTimezone(tournament.registrationOpensAt);
        const opensInEl = document.getElementById('registration-opens-in');
        if (opensInEl) {
            opensInEl.textContent = opensAtFormatted;
        }

        // Show timezone hint
        const tzHint = document.getElementById('user-timezone-hint');
        if (tzHint) {
            const timezone = getTimezoneAbbr();
            tzHint.textContent = `Times shown in your local timezone (${timezone})`;
        }

        // Start countdown to opening time
        const opensAt = new Date(tournament.registrationOpensAt);
        UI.startRegistrationOpenCountdown(opensAt.getTime(), () => loadTournament());
        UI.showRegistrationMessage('too_early');
        return;
    }

    // Check if registration is closed (tournament started)
    if (!tournament.registrationOpen && tournament.registrationReason === 'tournament_started') {
        // Handle via state-based UI
        UI.updateUIForState(tournament.state);
        return;
    }

    // Registration is open - handle normally via state
    UI.updateUIForState(tournament.state);
}

// ==================== WAITLIST ====================

/**
 * Check if user is already on the waitlist
 */
async function checkWaitlistStatus() {
    const storedName = getStorageItem('waitlist-name');
    if (!storedName) return;

    const response = await apiCheckWaitlistStatus(storedName);

    if (response.success && response.status === 'waiting') {
        // User is on the waitlist - show their position
        document.getElementById('waitlist-form')?.classList.add('hidden');
        document.getElementById('waitlist-joined')?.classList.remove('hidden');
        const positionEl = document.getElementById('waitlist-position');
        if (positionEl) positionEl.textContent = response.position;
    } else if (response.success && response.status === 'promoted') {
        // User was promoted! Clear stored name and show signup form
        removeStorageItem('waitlist-name');
        UI.showAlert('A spot opened up! You can now register.', 'success');
    } else if (!response.success) {
        // Not on waitlist anymore - clear stored name
        removeStorageItem('waitlist-name');
    }
}

/**
 * Handle waitlist join button click
 */
async function handleWaitlistJoin() {
    const nameInput = document.getElementById('waitlist-name');
    const emailInput = document.getElementById('waitlist-email');
    const btn = document.getElementById('join-waitlist-btn');

    const name = nameInput?.value.trim();
    const email = emailInput?.value.trim() || '';

    if (!name) {
        nameInput?.focus();
        return;
    }

    UI.setButtonLoading(btn, 'Joining...');

    const response = await joinWaitlist(name, email);

    if (response.success) {
        // Store name in localStorage to check status on page reload
        setStorageItem('waitlist-name', name);

        // Show joined message with position
        document.getElementById('waitlist-form')?.classList.add('hidden');
        document.getElementById('waitlist-joined')?.classList.remove('hidden');
        const positionEl = document.getElementById('waitlist-position');
        if (positionEl) positionEl.textContent = response.position;
    } else {
        // Handle standardized error format: { error: { code, message, field } }
        const errorMessage = response.error?.message || response.error || 'Failed to join waitlist';
        UI.showAlert(errorMessage, 'error');
        UI.resetButton(btn, 'Join Waitlist');
    }
}

// ==================== LOOKUP ====================

/**
 * Handle lookup button click
 */
async function handleLookup() {
    const nameInput = document.getElementById('lookup-name');
    const btn = document.getElementById('lookup-btn');

    const name = nameInput?.value.trim();
    if (!name) return;

    UI.setButtonLoading(btn, '...');

    const response = await lookupParticipant(name);
    UI.displayLookupResult(response);
    UI.resetButton(btn, 'Search');
}

/**
 * Toggle lookup form visibility
 */
function toggleLookupForm() {
    const form = document.getElementById('lookup-form');
    const result = document.getElementById('lookup-result');
    form?.classList.toggle('hidden');
    result?.classList.add('hidden');
}

// ==================== SIGNUP ====================

/**
 * Handle signup form submission
 * @param {Event} e - Form submit event
 */
async function handleSignupSubmit(e) {
    e.preventDefault();
    UI.hideErrorMessage();

    const submitBtn = document.getElementById('submit-btn');
    const participantName = document.getElementById('participant-name')?.value.trim();
    const instagram = document.getElementById('instagram')?.value.trim();
    const notes = document.getElementById('notes')?.value.trim();

    if (!participantName) {
        UI.showErrorMessage('Please enter your name');
        return;
    }

    UI.setButtonLoading(submitBtn);

    const response = await submitSignup({
        participantName,
        instagram: instagram || undefined,
        notes: notes || undefined
    });

    if (response.success) {
        // Redirect to confirmation page with participant name
        window.location.href = `/confirmation?name=${encodeURIComponent(participantName)}&tournament=${encodeURIComponent(tournamentData?.name || 'Tournament')}`;
    } else {
        // Handle standardized error format: { error: { code, message, field } }
        const errorMessage = response.error?.message || response.message || response.error || 'Signup failed. Please try again.';
        UI.showErrorMessage(errorMessage);
        UI.resetButton(submitBtn, 'Join Tournament');
    }
}

// ==================== PWA ====================

/** @type {ServiceWorkerRegistration|null} */
let swRegistration = null;

/** @type {ServiceWorker|null} */
let swWaiting = null;

/**
 * Register service worker for PWA functionality
 */
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/service-worker.js');
            swRegistration = registration;
            console.log('ServiceWorker registered:', registration);

            // Check if there's already a waiting service worker
            if (registration.waiting) {
                swWaiting = registration.waiting;
                showUpdateBanner();
            }

            // Listen for new service worker updates
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) return;

                console.log('ServiceWorker update found');

                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // New service worker is ready
                        swWaiting = newWorker;
                        console.log('New ServiceWorker installed and waiting');
                        showUpdateBanner();
                    }
                });
            });

            // Check for updates periodically
            setInterval(() => {
                registration.update();
            }, 60000); // Check every minute

        } catch (error) {
            console.log('ServiceWorker registration failed:', error);
        }
    });

    // Handle controller change (new SW activated)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('ServiceWorker controller changed, reloading...');
        window.location.reload();
    });
}

/**
 * Show the update available banner
 */
function showUpdateBanner() {
    const banner = document.getElementById('sw-update-banner');
    if (banner) {
        banner.classList.remove('hidden');
    }
}

/**
 * Hide the update banner
 */
function hideUpdateBanner() {
    const banner = document.getElementById('sw-update-banner');
    if (banner) {
        banner.classList.add('hidden');
    }
}

/**
 * Apply the waiting service worker update
 */
function applyServiceWorkerUpdate() {
    if (!swWaiting) {
        console.log('No waiting service worker');
        window.location.reload();
        return;
    }

    // Tell the waiting SW to skip waiting
    swWaiting.postMessage({ type: 'SKIP_WAITING' });
}

/**
 * Handle PWA install prompt
 */
function setupInstallPrompt() {
    let deferredPrompt;

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent the mini-infobar from appearing on mobile
        e.preventDefault();
        // Stash the event so it can be triggered later
        deferredPrompt = e;
        console.log('PWA install prompt ready');

        // Optional: Show custom install button
        // You can add a button here to trigger the install prompt
    });

    // Track PWA installation
    window.addEventListener('appinstalled', () => {
        console.log('PWA was installed');
        deferredPrompt = null;
    });
}

// ==================== PUSH NOTIFICATIONS ====================

/** @type {string|null} VAPID public key */
let vapidPublicKey = null;

/** @type {PushSubscription|null} Current push subscription */
let pushSubscription = null;

/**
 * Initialize push notification support
 */
async function initPushNotifications() {
    // Check if push notifications are supported
    if (!('PushManager' in window) || !('serviceWorker' in navigator)) {
        console.log('[Push] Not supported in this browser');
        UI.updatePushToggleState('unavailable');
        return;
    }

    // Check current permission state
    const permission = Notification.permission;
    if (permission === 'denied') {
        console.log('[Push] Permission denied');
        UI.updatePushToggleState('denied');
        return;
    }

    // Get the VAPID public key
    const vapidResponse = await getVapidPublicKey();
    if (!vapidResponse.success || !vapidResponse.publicKey) {
        console.log('[Push] VAPID key not available:', vapidResponse.error);
        UI.updatePushToggleState('unavailable');
        return;
    }
    vapidPublicKey = vapidResponse.publicKey;

    // Check for existing subscription
    try {
        const registration = await navigator.serviceWorker.ready;
        pushSubscription = await registration.pushManager.getSubscription();

        if (pushSubscription) {
            console.log('[Push] Already subscribed');
            UI.updatePushToggleState('enabled');
        } else {
            console.log('[Push] Not subscribed');
            UI.updatePushToggleState('disabled');
        }
    } catch (error) {
        console.error('[Push] Error checking subscription:', error);
        UI.updatePushToggleState('disabled');
    }
}

/**
 * Toggle push notification subscription
 */
async function togglePushNotifications() {
    if (!vapidPublicKey) {
        UI.showAlert('Push notifications not available', 'error');
        return;
    }

    if (pushSubscription) {
        // Unsubscribe
        await handlePushUnsubscribe();
    } else {
        // Subscribe
        await handlePushSubscribe();
    }
}

/**
 * Subscribe to push notifications
 */
async function handlePushSubscribe() {
    try {
        // Request permission if not granted
        if (Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.log('[Push] Permission denied');
                UI.updatePushToggleState('denied');
                return;
            }
        }

        if (Notification.permission !== 'granted') {
            UI.updatePushToggleState('denied');
            return;
        }

        // Get service worker registration
        const registration = await navigator.serviceWorker.ready;

        // Convert VAPID key to Uint8Array
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

        // Subscribe to push
        console.log('[Push] Subscribing...');
        pushSubscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey
        });

        console.log('[Push] Subscribed:', pushSubscription.endpoint);

        // Send subscription to server
        const response = await subscribeToPush(pushSubscription);

        if (response.success) {
            UI.updatePushToggleState('enabled');
            setStorageItem('push_subscribed', 'true');
            console.log('[Push] Subscription saved to server');
        } else {
            // Rollback local subscription on server error
            await pushSubscription.unsubscribe();
            pushSubscription = null;
            UI.updatePushToggleState('disabled');
            UI.showAlert('Failed to save notification preferences', 'error');
        }
    } catch (error) {
        console.error('[Push] Subscribe error:', error);
        UI.updatePushToggleState('disabled');
        UI.showAlert('Failed to enable notifications', 'error');
    }
}

/**
 * Unsubscribe from push notifications
 */
async function handlePushUnsubscribe() {
    if (!pushSubscription) return;

    try {
        const endpoint = pushSubscription.endpoint;

        // Unsubscribe locally
        await pushSubscription.unsubscribe();
        pushSubscription = null;

        // Remove from server
        await unsubscribeFromPush(endpoint);

        UI.updatePushToggleState('disabled');
        removeStorageItem('push_subscribed');
        console.log('[Push] Unsubscribed');
    } catch (error) {
        console.error('[Push] Unsubscribe error:', error);
        UI.showAlert('Failed to disable notifications', 'error');
    }
}

/**
 * Convert a URL-safe base64 string to Uint8Array
 * Required for VAPID applicationServerKey
 * @param {string} base64String - URL-safe base64 encoded string
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// ==================== OFFLINE QUEUE ====================

/**
 * Check for pending offline signups and update UI
 */
async function checkOfflineQueue() {
    if (!navigator.serviceWorker.controller) return;

    try {
        const messageChannel = new MessageChannel();

        return new Promise((resolve) => {
            messageChannel.port1.onmessage = (event) => {
                const { signups } = event.data;
                const count = signups?.length || 0;
                UI.updateOfflineQueueStatus(count);

                if (count > 0) {
                    console.log(`[Offline Queue] ${count} pending signup(s)`);
                }
                resolve(count);
            };

            navigator.serviceWorker.controller.postMessage(
                { type: 'GET_PENDING_SIGNUPS' },
                [messageChannel.port2]
            );
        });
    } catch (error) {
        console.warn('[Offline Queue] Error checking queue:', error);
        return 0;
    }
}

/**
 * Manually trigger sync of offline signups
 */
async function syncOfflineSignups() {
    if (!navigator.serviceWorker.controller) return;

    try {
        const messageChannel = new MessageChannel();

        return new Promise((resolve) => {
            messageChannel.port1.onmessage = (event) => {
                console.log('[Offline Queue] Sync triggered');
                // Refresh queue status after sync
                setTimeout(checkOfflineQueue, 2000);
                resolve();
            };

            navigator.serviceWorker.controller.postMessage(
                { type: 'SYNC_NOW' },
                [messageChannel.port2]
            );
        });
    } catch (error) {
        console.warn('[Offline Queue] Error triggering sync:', error);
    }
}

// ==================== INITIALIZATION ====================

/**
 * Initialize the application
 */
function init() {
    // Initialize theme
    UI.initTheme();

    // Set up event listeners
    document.getElementById('theme-toggle')?.addEventListener('click', UI.toggleTheme);
    document.getElementById('lookup-toggle')?.addEventListener('click', toggleLookupForm);
    document.getElementById('lookup-btn')?.addEventListener('click', handleLookup);
    document.getElementById('join-waitlist-btn')?.addEventListener('click', handleWaitlistJoin);
    document.getElementById('signup-form')?.addEventListener('submit', handleSignupSubmit);
    document.getElementById('sw-update-btn')?.addEventListener('click', applyServiceWorkerUpdate);
    document.getElementById('push-toggle')?.addEventListener('click', togglePushNotifications);
    document.getElementById('offline-sync-btn')?.addEventListener('click', syncOfflineSignups);

    // Load tournament data
    loadTournament();

    // Start auto-refresh and WebSocket
    startAutoRefresh();

    // Register service worker for PWA
    registerServiceWorker();

    // Set up PWA install prompt handler
    setupInstallPrompt();

    // Initialize push notifications (after service worker registration)
    setTimeout(() => {
        initPushNotifications();
        checkOfflineQueue();
    }, 1000);

    // Listen for online events to trigger offline queue sync
    window.addEventListener('online', () => {
        console.log('[App] Back online - checking offline queue');
        setTimeout(syncOfflineSignups, 1000);
    });
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for potential testing
export { loadTournament, tournamentData };
