/**
 * UI utilities for Tournament Signup PWA
 * @module ui
 */

import { getStorageItem, setStorageItem, formatDateInUserTimezone, getTimezoneAbbr, formatRelativeTime } from './utils.js';

// ==================== THEME MANAGEMENT ====================

/** @type {MediaQueryList|null} System theme media query */
let systemThemeQuery = null;

/**
 * Initialize theme based on saved preference or system preference
 * Also sets up listener for system theme changes
 */
export function initTheme() {
    const savedTheme = getStorageItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    setTheme(theme);

    // Listen for system theme changes
    setupSystemThemeListener();
}

/**
 * Set up listener for system theme preference changes
 */
function setupSystemThemeListener() {
    if (systemThemeQuery) return; // Already set up

    systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Listen for changes
    systemThemeQuery.addEventListener('change', (e) => {
        // Only auto-switch if user hasn't explicitly set a preference
        const hasExplicitPreference = getStorageItem('theme_explicit') === 'true';

        if (!hasExplicitPreference) {
            const newTheme = e.matches ? 'dark' : 'light';
            setTheme(newTheme, false); // Don't mark as explicit
            console.log(`[Theme] System preference changed to ${newTheme}`);
        }
    });
}

/**
 * Set the current theme
 * @param {'light'|'dark'} theme - Theme to set
 * @param {boolean} [explicit=true] - Whether this is an explicit user choice
 */
export function setTheme(theme, explicit = true) {
    const sunIcon = document.getElementById('sun-icon');
    const moonIcon = document.getElementById('moon-icon');

    if (theme === 'light') {
        document.documentElement.classList.add('light');
        sunIcon?.classList.add('hidden');
        moonIcon?.classList.remove('hidden');
    } else {
        document.documentElement.classList.remove('light');
        sunIcon?.classList.remove('hidden');
        moonIcon?.classList.add('hidden');
    }

    setStorageItem('theme', theme);

    // Track if user explicitly set theme (vs system auto)
    if (explicit) {
        setStorageItem('theme_explicit', 'true');
    }
}

/**
 * Toggle between light and dark theme
 * Marks the choice as explicit (user override)
 */
export function toggleTheme() {
    const currentTheme = getStorageItem('theme', 'dark');
    setTheme(currentTheme === 'dark' ? 'light' : 'dark', true);
}

/**
 * Reset theme to follow system preference
 */
export function resetThemeToSystem() {
    setStorageItem('theme_explicit', 'false');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark ? 'dark' : 'light', false);
}

// ==================== ALERTS & MESSAGES ====================

/**
 * Show an error message in the form
 * @param {string} message - Error message to display
 */
export function showErrorMessage(message) {
    const errorDiv = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');

    if (errorDiv && errorText) {
        errorText.textContent = message;
        errorDiv.classList.remove('hidden');

        // Auto-hide after 5 seconds
        setTimeout(() => {
            errorDiv.classList.add('hidden');
        }, 5000);
    }
}

/**
 * Hide the error message
 */
export function hideErrorMessage() {
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
    }
}

/**
 * Show an alert toast (for waitlist errors, etc.)
 * @param {string} message - Alert message
 * @param {'error'|'success'|'warning'} type - Alert type
 */
export function showAlert(message, type = 'error') {
    // For now, use the error message display
    // Future: implement toast notification system
    if (type === 'error') {
        showErrorMessage(message);
    } else {
        console.log(`[${type}] ${message}`);
    }
}

/**
 * Show the "someone just signed up" notification toast
 * @param {string} playerName - Name of the player who signed up
 */
export function showNewSignupNotification(playerName) {
    const notification = document.getElementById('signup-notification');
    const nameSpan = document.getElementById('signup-notification-name');

    if (notification && nameSpan) {
        nameSpan.textContent = playerName;
        notification.classList.remove('hidden', 'opacity-0', 'translate-y-2');
        notification.classList.add('opacity-100', 'translate-y-0');

        // Hide after 3 seconds
        setTimeout(() => {
            notification.classList.add('opacity-0', 'translate-y-2');
            setTimeout(() => {
                notification.classList.add('hidden');
            }, 300);
        }, 3000);
    }
}

// ==================== CAPACITY DISPLAY ====================

/**
 * Update the capacity progress bar display
 * @param {Object} tournament - Tournament data
 * @param {number} tournament.participantsCount - Current count
 * @param {number|null} tournament.signupCap - Max capacity
 */
export function updateCapacityDisplay(tournament) {
    const section = document.getElementById('capacity-section');
    const text = document.getElementById('capacity-text');
    const bar = document.getElementById('capacity-bar');
    const urgency = document.getElementById('capacity-urgency');

    if (!section || !text || !bar || !urgency) return;

    // Only show if signup cap is set
    if (!tournament.signupCap) {
        section.classList.add('hidden');
        return;
    }

    // Show the capacity section
    section.classList.remove('hidden');

    const current = tournament.participantsCount || 0;
    const max = tournament.signupCap;
    const remaining = max - current;
    const percent = Math.min((current / max) * 100, 100);

    // Update text
    text.textContent = `${current} of ${max} spots filled`;

    // Update progress bar width
    bar.style.width = `${percent}%`;

    // Reset bar color classes
    bar.classList.remove('bg-purple-500', 'bg-yellow-500', 'bg-red-500');

    // Reset urgency display
    urgency.classList.add('hidden');
    urgency.classList.remove('text-yellow-400', 'text-red-400');

    // Apply urgency colors based on capacity
    if (percent >= 90) {
        // Critical - almost full (red)
        bar.classList.add('bg-red-500');
        urgency.classList.remove('hidden');
        urgency.classList.add('text-red-400');
        if (remaining === 0) {
            urgency.textContent = 'Tournament is full!';
        } else if (remaining === 1) {
            urgency.textContent = 'Only 1 spot left!';
        } else {
            urgency.textContent = `Only ${remaining} spots left!`;
        }
    } else if (percent >= 75) {
        // Warning - filling up (yellow)
        bar.classList.add('bg-yellow-500');
        urgency.classList.remove('hidden');
        urgency.classList.add('text-yellow-400');
        urgency.textContent = `${remaining} spots remaining`;
    } else {
        // Normal (purple)
        bar.classList.add('bg-purple-500');
    }
}

// ==================== WEBSOCKET INDICATOR ====================

/**
 * Update the WebSocket connection indicator
 * @param {boolean} connected - Whether WebSocket is connected
 */
export function updateConnectionIndicator(connected) {
    const indicator = document.getElementById('ws-indicator');
    if (indicator) {
        if (connected) {
            indicator.classList.remove('bg-gray-500');
            indicator.classList.add('bg-green-500', 'animate-pulse');
            indicator.title = 'Live updates active';
        } else {
            indicator.classList.remove('bg-green-500', 'animate-pulse');
            indicator.classList.add('bg-gray-500');
            indicator.title = 'Live updates disconnected';
        }
    }
}

// ==================== TOURNAMENT STATE UI ====================

/**
 * Show a registration status message (too_early, full, etc.)
 * @param {'too_early'|'full'} type - Message type
 */
export function showRegistrationMessage(type) {
    // Hide all messages first
    const elements = [
        'registration-closed-early',
        'tournament-full-message',
        'checkin-message',
        'underway-message',
        'complete-message',
        'signup-form'
    ];

    elements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    // Show rules section
    const rulesSection = document.getElementById('view-rules-section');
    if (rulesSection) rulesSection.classList.remove('hidden');

    // Show appropriate message
    if (type === 'too_early') {
        const el = document.getElementById('registration-closed-early');
        if (el) el.classList.remove('hidden');
    } else if (type === 'full') {
        const el = document.getElementById('tournament-full-message');
        if (el) el.classList.remove('hidden');
    }
}

/**
 * Update UI based on tournament state
 * @param {string} state - Tournament state
 */
export function updateUIForState(state) {
    // Hide all state-specific sections first
    const stateElements = ['checkin-message', 'underway-message', 'complete-message'];
    stateElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const signupForm = document.getElementById('signup-form');
    const viewRulesSection = document.getElementById('view-rules-section');

    switch (state) {
        case 'pending':
            // Show signup form (default state)
            signupForm?.classList.remove('hidden');
            viewRulesSection?.classList.remove('hidden');
            break;

        case 'checking_in':
        case 'checked_in':
            // Hide signup form, show check-in message
            signupForm?.classList.add('hidden');
            viewRulesSection?.classList.remove('hidden');
            document.getElementById('checkin-message')?.classList.remove('hidden');
            break;

        case 'underway':
        case 'awaiting_review':
            // Hide signup form, show tournament in progress
            signupForm?.classList.add('hidden');
            viewRulesSection?.classList.add('hidden');
            document.getElementById('underway-message')?.classList.remove('hidden');
            break;

        case 'complete':
            // Hide signup form, show completion message
            signupForm?.classList.add('hidden');
            viewRulesSection?.classList.add('hidden');
            document.getElementById('complete-message')?.classList.remove('hidden');
            break;

        default:
            // Default to showing signup form
            signupForm?.classList.remove('hidden');
            viewRulesSection?.classList.remove('hidden');
    }
}

// ==================== LOOKUP UI ====================

/**
 * Display lookup result in the UI
 * @param {Object} data - Lookup response data
 * @param {boolean} data.found - Whether participant was found
 * @param {Object} [data.participant] - Participant data
 * @param {string} [data.tournamentState] - Tournament state
 */
export function displayLookupResult(data) {
    const resultDiv = document.getElementById('lookup-result');
    const foundDiv = document.getElementById('lookup-found');
    const notFoundDiv = document.getElementById('lookup-not-found');

    if (!resultDiv) return;

    resultDiv.classList.remove('hidden');

    if (data.found && data.participant) {
        foundDiv?.classList.remove('hidden');
        notFoundDiv?.classList.add('hidden');

        const p = data.participant;

        // Basic info
        const nameEl = document.getElementById('lookup-found-name');
        const seedEl = document.getElementById('lookup-seed');
        const regAtEl = document.getElementById('lookup-registered-at');

        if (nameEl) nameEl.textContent = p.name;
        if (seedEl) seedEl.textContent = p.seed ? `#${p.seed}` : 'TBD';
        if (regAtEl) {
            regAtEl.textContent = p.registeredAt ? formatRelativeTime(p.registeredAt) : '--';
        }

        // Match status (only for underway tournaments)
        updateMatchStatusDisplay(data.tournamentState, p);
    } else {
        foundDiv?.classList.add('hidden');
        notFoundDiv?.classList.remove('hidden');
    }
}

/**
 * Update the match status section in lookup results
 * @param {string} tournamentState - Current tournament state
 * @param {Object} participant - Participant data
 */
function updateMatchStatusDisplay(tournamentState, participant) {
    const matchStatusDiv = document.getElementById('lookup-match-status');
    const currentMatchDiv = document.getElementById('lookup-current-match');
    const eliminatedDiv = document.getElementById('lookup-eliminated');
    const waitingDiv = document.getElementById('lookup-waiting');

    // Reset all match status sections
    matchStatusDiv?.classList.add('hidden');
    currentMatchDiv?.classList.add('hidden');
    eliminatedDiv?.classList.add('hidden');
    waitingDiv?.classList.add('hidden');

    if (tournamentState === 'underway' || tournamentState === 'awaiting_review') {
        matchStatusDiv?.classList.remove('hidden');

        if (participant.currentMatch) {
            // Has active match
            currentMatchDiv?.classList.remove('hidden');
            const opponentEl = document.getElementById('lookup-opponent');
            const stateEl = document.getElementById('lookup-match-state');
            const stationSpan = document.getElementById('lookup-station');
            const stationNameEl = document.getElementById('lookup-station-name');

            if (opponentEl) opponentEl.textContent = participant.currentMatch.opponent;
            if (stateEl) {
                stateEl.textContent = participant.currentMatch.state === 'underway'
                    ? 'In Progress' : 'Ready to Play';
            }

            if (participant.currentMatch.station && stationSpan && stationNameEl) {
                stationSpan.classList.remove('hidden');
                stationNameEl.textContent = participant.currentMatch.station;
            } else if (stationSpan) {
                stationSpan.classList.add('hidden');
            }
        } else if (participant.isEliminated) {
            // Eliminated
            eliminatedDiv?.classList.remove('hidden');
            const recordEl = document.getElementById('lookup-record');
            if (recordEl && participant.record) {
                recordEl.textContent = `${participant.record.wins}-${participant.record.losses}`;
            }
        } else {
            // Waiting for next match
            waitingDiv?.classList.remove('hidden');
            const recordEl = document.getElementById('lookup-record-waiting');
            if (recordEl && participant.record) {
                recordEl.textContent = `${participant.record.wins}-${participant.record.losses}`;
            }
        }
    }
}

// ==================== COUNTDOWN TIMERS ====================

let registrationCountdownInterval = null;

/**
 * Start a countdown timer until registration opens
 * @param {number} targetTime - Target time in milliseconds
 * @param {Function} onComplete - Callback when countdown reaches zero
 */
export function startRegistrationOpenCountdown(targetTime, onComplete) {
    const countdownDisplay = document.getElementById('opens-countdown');

    // Clear any existing interval
    if (registrationCountdownInterval) {
        clearInterval(registrationCountdownInterval);
    }

    registrationCountdownInterval = setInterval(() => {
        const now = Date.now();
        const distance = targetTime - now;

        if (distance < 0) {
            clearInterval(registrationCountdownInterval);
            if (countdownDisplay) {
                countdownDisplay.textContent = 'Registration is now open!';
            }
            if (onComplete) {
                setTimeout(onComplete, 2000);
            }
            return;
        }

        // Calculate time units
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        if (countdownDisplay) {
            if (days > 0) {
                countdownDisplay.textContent =
                    `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            } else {
                countdownDisplay.textContent =
                    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }
        }
    }, 1000);
}

/**
 * Stop the registration countdown timer
 */
export function stopRegistrationCountdown() {
    if (registrationCountdownInterval) {
        clearInterval(registrationCountdownInterval);
        registrationCountdownInterval = null;
    }
}

// ==================== FORM UTILITIES ====================

/**
 * Set button to loading state
 * @param {HTMLButtonElement} button - Button element
 * @param {string} [loadingText] - Text to show during loading
 */
export function setButtonLoading(button, loadingText = null) {
    if (!button) return;
    button.disabled = true;
    if (loadingText) {
        button.textContent = loadingText;
    } else {
        button.innerHTML = '<span class="loading mx-auto"></span>';
    }
}

/**
 * Reset button to normal state
 * @param {HTMLButtonElement} button - Button element
 * @param {string} text - Text to display
 */
export function resetButton(button, text) {
    if (!button) return;
    button.disabled = false;
    button.innerHTML = text;
}

// ==================== TOURNAMENT DISPLAY ====================

/**
 * Display tournament information in the header
 * @param {Object} tournament - Tournament data
 */
export function displayTournamentHeader(tournament) {
    const loadingEl = document.getElementById('loading-tournament');
    const infoEl = document.getElementById('tournament-info');
    const nameEl = document.getElementById('tournament-name');
    const gameEl = document.getElementById('game-name');
    const countEl = document.getElementById('participant-count');
    const bracketLink = document.getElementById('view-bracket-link');
    const resultsLink = document.getElementById('view-results-link');

    loadingEl?.classList.add('hidden');
    infoEl?.classList.remove('hidden');

    if (nameEl) nameEl.textContent = tournament.name;
    if (gameEl) gameEl.textContent = tournament.gameName || 'Tournament';
    if (countEl) countEl.textContent = tournament.participantsCount || 0;

    // Set bracket links
    const bracketUrl = tournament.fullChallongeUrl || `https://challonge.com/${tournament.url || tournament.id}`;
    if (bracketLink) bracketLink.href = 'https://bracket.despairhardware.com';
    if (resultsLink) resultsLink.href = bracketUrl;
}

/**
 * Show tournament load error state
 */
export function showTournamentError() {
    const loadingEl = document.getElementById('loading-tournament');
    const errorEl = document.getElementById('error-tournament');
    const formEl = document.getElementById('signup-form');

    loadingEl?.classList.add('hidden');
    errorEl?.classList.remove('hidden');
    formEl?.classList.add('opacity-50', 'pointer-events-none');
}

// ==================== PUSH NOTIFICATION UI ====================

/**
 * Update the push notification toggle button state
 * @param {'enabled'|'disabled'|'unavailable'|'denied'} state - Button state
 */
export function updatePushToggleState(state) {
    const btn = document.getElementById('push-toggle');
    const bellOn = document.getElementById('bell-on-icon');
    const bellOff = document.getElementById('bell-off-icon');
    const bellSlash = document.getElementById('bell-slash-icon');

    if (!btn) return;

    // Reset all states
    btn.classList.remove('bg-green-500/20', 'text-green-400', 'bg-red-500/20', 'text-red-400');
    bellOn?.classList.add('hidden');
    bellOff?.classList.add('hidden');
    bellSlash?.classList.add('hidden');

    switch (state) {
        case 'enabled':
            btn.classList.add('bg-green-500/20', 'text-green-400');
            bellOn?.classList.remove('hidden');
            btn.title = 'Push notifications enabled - Click to disable';
            btn.disabled = false;
            break;

        case 'disabled':
            bellOff?.classList.remove('hidden');
            btn.title = 'Enable push notifications';
            btn.disabled = false;
            break;

        case 'denied':
            btn.classList.add('bg-red-500/20', 'text-red-400');
            bellSlash?.classList.remove('hidden');
            btn.title = 'Push notifications blocked - Enable in browser settings';
            btn.disabled = true;
            break;

        case 'unavailable':
        default:
            bellSlash?.classList.remove('hidden');
            btn.title = 'Push notifications not available';
            btn.disabled = true;
            btn.classList.add('opacity-50');
            break;
    }
}

/**
 * Show the offline queue status indicator
 * @param {number} pendingCount - Number of pending signups
 */
export function updateOfflineQueueStatus(pendingCount) {
    const indicator = document.getElementById('offline-queue-indicator');
    const countEl = document.getElementById('offline-queue-count');

    if (!indicator) return;

    if (pendingCount > 0) {
        indicator.classList.remove('hidden');
        if (countEl) countEl.textContent = pendingCount.toString();
    } else {
        indicator.classList.add('hidden');
    }
}

/**
 * Show push notification permission request toast
 */
export function showPushPermissionToast() {
    const toast = document.getElementById('push-permission-toast');
    if (toast) {
        toast.classList.remove('hidden', 'opacity-0', 'translate-y-2');
        toast.classList.add('opacity-100', 'translate-y-0');
    }
}

/**
 * Hide push notification permission toast
 */
export function hidePushPermissionToast() {
    const toast = document.getElementById('push-permission-toast');
    if (toast) {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 300);
    }
}
