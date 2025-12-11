/**
 * Service Container (AppContext)
 *
 * Centralized state management for the Tournament Control Center.
 * Provides shared access to Socket.IO, HTTP server, and other runtime state.
 *
 * Usage:
 *   const context = require('./services/container');
 *   context.io.emit('event', data);
 */

const { RATE_MODES } = require('../constants');

/**
 * AppContext - Singleton container for shared application state
 */
class AppContext {
	constructor() {
		// Server instances (set once at startup)
		this.io = null;
		this.httpServer = null;
		this.app = null;

		// WebSocket connection tracking
		this.wsConnections = {
			displays: new Map(),   // displayId -> socket
			clients: new Set()     // admin dashboard clients
		};

		// WebSocket delivery status tracking
		this.displayDeliveryStatus = {
			status: new Map(),     // displayId -> { lastAckTime, lastPushTime, ackCount, pushCount }
			httpFallbackDelayMs: 30000
		};

		// Rate limiter state
		this.challongeRateLimiter = {
			lastRequestTime: 0,
			requestQueue: [],
			isProcessing: false
		};

		// Adaptive rate limiter state
		this.adaptiveRateState = {
			currentMode: RATE_MODES.IDLE,
			effectiveRate: 1,
			upcomingTournament: null,
			activeTournament: null,
			lastCheck: null,
			nextCheck: null,
			checkIntervalId: null,
			manualOverride: null  // Set to null for automatic mode, or RATE_MODES.IDLE/UPCOMING/ACTIVE to force
		};

		// Development mode state (bypasses rate limiting for 3 hours)
		this.devModeState = {
			active: false,
			activatedAt: null,
			expiresAt: null,
			timeoutId: null
		};

		// Match polling state
		this.matchPollingState = {
			intervalId: null,
			isPolling: false,
			lastPollTime: null,
			currentTournamentId: null,
			pollIntervalMs: 15000,      // 15 seconds (normal mode)
			devModePollIntervalMs: 5000  // 5 seconds (dev mode)
		};

		// Match data cache for WebSocket broadcasts
		this.matchDataCache = {
			tournamentId: null,
			matches: null,
			participants: null,
			lastUpdated: null
		};

		// Sponsor rotation timers
		this.sponsorRotationTimers = {};

		// Previous match state for delta detection
		this.previousMatchState = new Map();
	}

	/**
	 * Initialize the context with server instances
	 * @param {Object} options - { io, httpServer, app }
	 */
	init({ io, httpServer, app }) {
		this.io = io;
		this.httpServer = httpServer;
		this.app = app;
	}

	/**
	 * Get WebSocket connection status
	 * @returns {Object} Connection statistics
	 */
	getWebSocketStatus() {
		return {
			displays: Array.from(this.wsConnections.displays.entries()).map(([id, socket]) => ({
				id,
				type: socket.displayType || 'unknown',
				connected: socket.connected
			})),
			displayCount: this.wsConnections.displays.size,
			adminClientCount: this.wsConnections.clients.size,
			totalConnections: this.wsConnections.displays.size + this.wsConnections.clients.size
		};
	}

	/**
	 * Broadcast to all connected displays
	 * @param {string} event - Event name
	 * @param {*} data - Data to send
	 */
	broadcastToDisplays(event, data) {
		if (this.io) {
			this.io.to('displays').emit(event, data);
		}
	}

	/**
	 * Broadcast to all admin clients
	 * @param {string} event - Event name
	 * @param {*} data - Data to send
	 */
	broadcastToClients(event, data) {
		if (this.io) {
			this.io.to('admins').emit(event, data);
		}
	}

	/**
	 * Reset all state (for testing)
	 */
	reset() {
		this.wsConnections.displays.clear();
		this.wsConnections.clients.clear();
		this.displayDeliveryStatus.status.clear();
		this.challongeRateLimiter.requestQueue = [];
		this.challongeRateLimiter.isProcessing = false;
		this.previousMatchState.clear();
		this.matchDataCache = {
			tournamentId: null,
			matches: null,
			participants: null,
			lastUpdated: null
		};
	}
}

// Export singleton instance
module.exports = new AppContext();
