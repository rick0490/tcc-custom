/**
 * API client for Tournament Signup PWA
 * @module api
 */

import { requestTracker } from './utils.js';

// ==================== TOURNAMENT API ====================

/**
 * @typedef {Object} Tournament
 * @property {number} id - Tournament ID
 * @property {string} name - Tournament name
 * @property {string} gameName - Game name
 * @property {string} state - Tournament state (pending, underway, complete)
 * @property {number} participantsCount - Current participant count
 * @property {string} urlSlug - URL slug
 * @property {number|null} signupCap - Maximum participants (null = unlimited)
 * @property {boolean} registrationOpen - Whether registration is open
 * @property {string} registrationReason - Reason registration is closed
 * @property {string} registrationOpensAt - ISO date when registration opens
 * @property {boolean} isFull - Whether tournament is at capacity
 */

/**
 * Fetch current tournament information
 * @returns {Promise<{success: boolean, tournament?: Tournament, error?: string}>}
 */
export async function fetchTournament() {
    try {
        const response = await fetch('/api/tournament');
        return await response.json();
    } catch (error) {
        console.error('Error fetching tournament:', error);
        return { success: false, error: error.message };
    }
}

// ==================== SIGNUP API ====================

/**
 * @typedef {Object} SignupData
 * @property {string} participantName - Participant's display name
 * @property {string} [instagram] - Optional Instagram handle
 * @property {string} [notes] - Optional notes for organizers (max 200 chars)
 */

/**
 * @typedef {Object} SignupResponse
 * @property {boolean} success - Whether signup succeeded
 * @property {Object} [participant] - Created participant data
 * @property {string} [error] - Error message if failed
 * @property {string} [message] - Error message (alternative field)
 */

/**
 * Submit tournament signup
 * @param {SignupData} data - Signup data
 * @returns {Promise<SignupResponse>}
 */
export async function submitSignup(data) {
    if (requestTracker.isInFlight('signup')) {
        return { success: false, error: 'Request already in progress' };
    }

    requestTracker.start('signup');

    try {
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        // Only end tracker on failure (success redirects away)
        if (!result.success) {
            requestTracker.end('signup');
        }

        return result;
    } catch (error) {
        console.error('Signup error:', error);
        requestTracker.end('signup');
        return { success: false, error: 'Network error. Please check your connection.' };
    }
}

// ==================== LOOKUP API ====================

/**
 * @typedef {Object} LookupResult
 * @property {boolean} found - Whether participant was found
 * @property {Object} [participant] - Participant data if found
 * @property {string} [tournamentState] - Current tournament state
 */

/**
 * Look up a participant by name
 * @param {string} name - Name to search for
 * @returns {Promise<LookupResult>}
 */
export async function lookupParticipant(name) {
    if (requestTracker.isInFlight('lookup')) {
        return { found: false, error: 'Request already in progress' };
    }

    requestTracker.start('lookup');

    try {
        const response = await fetch(`/api/participants/lookup?name=${encodeURIComponent(name)}`);
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Lookup error:', error);
        return { found: false, error: error.message };
    } finally {
        requestTracker.end('lookup');
    }
}

// ==================== WAITLIST API ====================

/**
 * @typedef {Object} WaitlistResponse
 * @property {boolean} success - Whether operation succeeded
 * @property {number} [position] - Position in waitlist
 * @property {string} [status] - Waitlist status (waiting, promoted)
 * @property {string} [error] - Error message if failed
 */

/**
 * Join the tournament waitlist
 * @param {string} name - Participant name
 * @param {string} [email] - Optional email for notifications
 * @returns {Promise<WaitlistResponse>}
 */
export async function joinWaitlist(name, email = '') {
    if (requestTracker.isInFlight('waitlist')) {
        return { success: false, error: 'Request already in progress' };
    }

    requestTracker.start('waitlist');

    try {
        const response = await fetch('/api/waitlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email })
        });

        const result = await response.json();
        requestTracker.end('waitlist');
        return result;
    } catch (error) {
        console.error('Waitlist join error:', error);
        requestTracker.end('waitlist');
        return { success: false, error: 'Failed to join waitlist. Please try again.' };
    }
}

/**
 * Check waitlist status for a name
 * @param {string} name - Name to check
 * @returns {Promise<WaitlistResponse>}
 */
export async function checkWaitlistStatus(name) {
    try {
        const response = await fetch(`/api/waitlist?name=${encodeURIComponent(name)}`);
        return await response.json();
    } catch (error) {
        console.warn('Failed to check waitlist status:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Leave the waitlist
 * @param {string} name - Name to remove
 * @returns {Promise<WaitlistResponse>}
 */
export async function leaveWaitlist(name) {
    try {
        const response = await fetch('/api/waitlist', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        return await response.json();
    } catch (error) {
        console.error('Waitlist leave error:', error);
        return { success: false, error: error.message };
    }
}

// ==================== PUSH NOTIFICATIONS API ====================

/**
 * Get the VAPID public key for push notifications
 * @returns {Promise<{success: boolean, publicKey?: string, error?: string}>}
 */
export async function getVapidPublicKey() {
    try {
        const response = await fetch('/api/push/vapid-public-key');
        return await response.json();
    } catch (error) {
        console.error('Error fetching VAPID key:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Subscribe to push notifications
 * @param {PushSubscription} subscription - The push subscription object
 * @param {string[]} notificationTypes - Types of notifications to receive
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function subscribeToPush(subscription, notificationTypes = ['registration_open', 'tournament_starting']) {
    try {
        const response = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscription: subscription.toJSON(),
                notificationTypes
            })
        });
        return await response.json();
    } catch (error) {
        console.error('Push subscribe error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Unsubscribe from push notifications
 * @param {string} endpoint - The subscription endpoint to remove
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function unsubscribeFromPush(endpoint) {
    try {
        const response = await fetch('/api/push/unsubscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint })
        });
        return await response.json();
    } catch (error) {
        console.error('Push unsubscribe error:', error);
        return { success: false, error: error.message };
    }
}
