/**
 * Timer Manager for Match Display
 *
 * Manages DQ timers (per-TV) and tournament-wide timers.
 * Extracted from MMM-TournamentNowPlaying.js
 */

class TimerManager {
    constructor() {
        this.dqTimers = {
            'TV 1': { active: false, endTime: null, intervalId: null },
            'TV 2': { active: false, endTime: null, intervalId: null }
        };
        this.tournamentTimer = {
            active: false,
            endTime: null,
            intervalId: null
        };
        this.debugMode = false;
    }

    /**
     * Enable/disable debug logging
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    /**
     * Log message if debug mode is enabled
     */
    log(action, data = {}) {
        if (this.debugMode) {
            console.log(`%c[TimerManager] ${action}`, 'color: #f59e0b', data);
        }
    }

    /**
     * Start a DQ timer for a specific TV
     * @param {string} tv - "TV 1" or "TV 2"
     * @param {number} duration - Duration in seconds
     */
    startDQTimer(tv, duration) {
        this.log('startDQTimer', { tv, duration });

        // Clear any existing timer for this TV
        if (this.dqTimers[tv] && this.dqTimers[tv].intervalId) {
            clearInterval(this.dqTimers[tv].intervalId);
        }

        // Ensure timer object exists
        if (!this.dqTimers[tv]) {
            this.dqTimers[tv] = { active: false, endTime: null, intervalId: null };
        }

        // Set end time
        this.dqTimers[tv].endTime = Date.now() + (duration * 1000);
        this.dqTimers[tv].active = true;

        // Create or update timer element
        const timerId = 'dq-timer-' + tv.replace(' ', '-');
        let timerEl = document.getElementById(timerId);

        if (!timerEl) {
            timerEl = document.createElement('div');
            timerEl.id = timerId;
            timerEl.className = 'tourney-dq-timer tourney-dq-timer--entering';
            timerEl.setAttribute('data-tv', tv);

            // Create label element
            const labelEl = document.createElement('span');
            labelEl.className = 'tourney-dq-timer__label';
            labelEl.textContent = 'DQ Timer';
            timerEl.appendChild(labelEl);

            // Create time element
            const timeEl = document.createElement('span');
            timeEl.className = 'tourney-dq-timer__time';
            timerEl.appendChild(timeEl);

            // Add to timer container or body
            const container = document.getElementById('timer-container') || document.body;
            container.appendChild(timerEl);

            // Trigger enter animation
            setTimeout(() => {
                timerEl.classList.remove('tourney-dq-timer--entering');
                timerEl.classList.add('tourney-dq-timer--visible');
            }, 50);
        }

        // Update immediately
        this.updateDQTimerDisplay(tv);

        // Start interval to update every second
        this.dqTimers[tv].intervalId = setInterval(() => {
            this.updateDQTimerDisplay(tv);
        }, 1000);
    }

    /**
     * Update the DQ timer display
     * @param {string} tv - "TV 1" or "TV 2"
     */
    updateDQTimerDisplay(tv) {
        const timer = this.dqTimers[tv];
        if (!timer || !timer.active) return;

        const remaining = Math.max(0, Math.ceil((timer.endTime - Date.now()) / 1000));
        const timerId = 'dq-timer-' + tv.replace(' ', '-');
        const timerEl = document.getElementById(timerId);

        if (timerEl) {
            // Update the time element
            const timeEl = timerEl.querySelector('.tourney-dq-timer__time');
            if (timeEl) {
                timeEl.textContent = this.formatTime(remaining);
            }

            // Add warning class when under 30 seconds
            if (remaining <= 30 && remaining > 10) {
                timerEl.classList.add('tourney-dq-timer--warning');
                timerEl.classList.remove('tourney-dq-timer--critical');
            }
            // Add critical class when under 10 seconds
            if (remaining <= 10) {
                timerEl.classList.remove('tourney-dq-timer--warning');
                timerEl.classList.add('tourney-dq-timer--critical');
            }
        }

        // Auto-hide when timer reaches 0
        if (remaining <= 0) {
            this.hideTimer('dq', tv);
        }
    }

    /**
     * Start the tournament-wide timer
     * @param {number} duration - Duration in seconds
     */
    startTournamentTimer(duration) {
        this.log('startTournamentTimer', { duration });

        // Clear any existing timer
        if (this.tournamentTimer.intervalId) {
            clearInterval(this.tournamentTimer.intervalId);
        }

        // Set end time
        this.tournamentTimer.endTime = Date.now() + (duration * 1000);
        this.tournamentTimer.active = true;

        // Create or update timer element
        let timerEl = document.getElementById('tournament-timer');

        if (!timerEl) {
            timerEl = document.createElement('div');
            timerEl.id = 'tournament-timer';
            timerEl.className = 'tourney-tournament-timer tourney-tournament-timer--entering';

            // Add to timer container or body
            const container = document.getElementById('timer-container') || document.body;
            container.appendChild(timerEl);

            // Trigger enter animation
            setTimeout(() => {
                timerEl.classList.remove('tourney-tournament-timer--entering');
                timerEl.classList.add('tourney-tournament-timer--visible');
            }, 50);
        }

        // Update immediately
        this.updateTournamentTimerDisplay();

        // Start interval to update every second
        this.tournamentTimer.intervalId = setInterval(() => {
            this.updateTournamentTimerDisplay();
        }, 1000);
    }

    /**
     * Update the tournament timer display
     */
    updateTournamentTimerDisplay() {
        const timer = this.tournamentTimer;
        if (!timer.active) return;

        const remaining = Math.max(0, Math.ceil((timer.endTime - Date.now()) / 1000));
        const timerEl = document.getElementById('tournament-timer');

        if (timerEl) {
            timerEl.textContent = this.formatTime(remaining);

            // Add warning class when under 60 seconds
            if (remaining <= 60 && remaining > 10) {
                timerEl.classList.add('tourney-tournament-timer--warning');
                timerEl.classList.remove('tourney-tournament-timer--critical');
            }
            // Add critical class when under 10 seconds
            if (remaining <= 10) {
                timerEl.classList.remove('tourney-tournament-timer--warning');
                timerEl.classList.add('tourney-tournament-timer--critical');
            }
        }

        // Auto-hide when timer reaches 0
        if (remaining <= 0) {
            this.hideTimer('tournament');
        }
    }

    /**
     * Hide a timer
     * @param {string} type - "dq", "tournament", or "all"
     * @param {string} tv - For DQ timers, "TV 1" or "TV 2"
     */
    hideTimer(type, tv = null) {
        this.log('hideTimer', { type, tv });

        if (type === 'dq' && tv) {
            // Hide specific DQ timer
            if (this.dqTimers[tv]) {
                if (this.dqTimers[tv].intervalId) {
                    clearInterval(this.dqTimers[tv].intervalId);
                }
                this.dqTimers[tv].active = false;
                this.dqTimers[tv].intervalId = null;

                const timerId = 'dq-timer-' + tv.replace(' ', '-');
                const timerEl = document.getElementById(timerId);
                if (timerEl) {
                    timerEl.classList.remove('tourney-dq-timer--visible');
                    timerEl.classList.add('tourney-dq-timer--exiting');
                    setTimeout(() => {
                        if (timerEl.parentNode) {
                            timerEl.parentNode.removeChild(timerEl);
                        }
                    }, 500);
                }
            }
        } else if (type === 'tournament') {
            // Hide tournament timer
            if (this.tournamentTimer.intervalId) {
                clearInterval(this.tournamentTimer.intervalId);
            }
            this.tournamentTimer.active = false;
            this.tournamentTimer.intervalId = null;

            const timerEl = document.getElementById('tournament-timer');
            if (timerEl) {
                timerEl.classList.remove('tourney-tournament-timer--visible');
                timerEl.classList.add('tourney-tournament-timer--exiting');
                setTimeout(() => {
                    if (timerEl.parentNode) {
                        timerEl.parentNode.removeChild(timerEl);
                    }
                }, 500);
            }
        } else if (type === 'all') {
            // Hide all timers
            this.hideTimer('dq', 'TV 1');
            this.hideTimer('dq', 'TV 2');
            this.hideTimer('tournament');
        }
    }

    /**
     * Format seconds as MM:SS
     * @param {number} seconds - Total seconds
     * @returns {string} Formatted time string
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }

    /**
     * Handle timer event from WebSocket
     * @param {string} type - Timer type ('dq' or 'tournament')
     * @param {Object} payload - Event payload
     */
    handleTimerEvent(type, payload) {
        this.log('handleTimerEvent', { type, payload });

        if (type === 'dq') {
            if (payload.action === 'start') {
                this.startDQTimer(payload.tv, payload.duration);
            } else if (payload.action === 'hide') {
                this.hideTimer('dq', payload.tv);
            }
        } else if (type === 'tournament') {
            if (payload.action === 'start') {
                this.startTournamentTimer(payload.duration);
            } else if (payload.action === 'hide') {
                this.hideTimer('tournament');
            }
        }
    }

    /**
     * Handle timer hide event from WebSocket
     * @param {Object} payload - Event payload with type and optionally tv
     */
    handleTimerHide(payload) {
        this.log('handleTimerHide', payload);
        this.hideTimer(payload.type || 'all', payload.tv);
    }

    /**
     * Clear all timers (cleanup on disconnect)
     */
    clearAll() {
        this.hideTimer('all');
    }
}

// Export for use in other modules
window.TimerManager = TimerManager;
