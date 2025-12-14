/**
 * WebSocket Client for Bracket Display
 *
 * Connects to admin dashboard Socket.IO server and handles real-time updates.
 * Supports user-specific rooms for multi-tenant isolation.
 */

class WebSocketClient {
	constructor(adminWsUrl, userId) {
		this.adminWsUrl = adminWsUrl;
		this.userId = userId;
		this.socket = null;
		this.connected = false;
		this.reconnectAttempts = 0;
		this.maxReconnectAttempts = 10;
		this.reconnectDelay = 5000;
		this.eventHandlers = {};
		this.displayId = `web-bracket-${userId}-${Date.now()}`;
		this.lastBracketHash = null;
		this.debugMode = false;

		// Event types we listen for
		this.eventTypes = [
			'bracket:update',
			'bracket:zoom',
			'bracket:reset',
			'bracket:control',
			'matches:update',
			'tournament:update',
			'tournament:deployed',
			'tournament:started',
			'tournament:completed',
			'tournament:reset',
			'sponsor:show',
			'sponsor:hide',
			'sponsor:rotate',
			'sponsor:config'
		];
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
			console.log(`%c[WebSocket] ${action}`, 'color: #8b5cf6', data);
		}
	}

	/**
	 * Connect to Socket.IO server
	 */
	connect() {
		if (this.socket) {
			this.disconnect();
		}

		console.log('[WebSocket] Connecting to:', this.adminWsUrl, 'userId:', this.userId);
		this.log('connecting', { url: this.adminWsUrl, userId: this.userId });

		try {
			this.socket = io(this.adminWsUrl, {
				reconnection: true,
				reconnectionDelay: this.reconnectDelay,
				reconnectionDelayMax: 30000,
				reconnectionAttempts: this.maxReconnectAttempts,
				timeout: 20000,
				transports: ['websocket', 'polling']
			});

			this.setupEventListeners();
		} catch (error) {
			console.error('[WebSocket] Failed to connect:', error);
			this.handleConnectionError(error);
		}
	}

	/**
	 * Setup Socket.IO event listeners
	 */
	setupEventListeners() {
		// Connection established
		this.socket.on('connect', () => {
			this.connected = true;
			this.reconnectAttempts = 0;
			console.log('[WebSocket] Connected! Socket ID:', this.socket.id);
			this.log('connected', { socketId: this.socket.id });

			// Register as bracket display with user context
			console.log('[WebSocket] Registering as bracket display...');
			this.socket.emit('display:register', {
				displayType: 'bracket',
				userId: this.userId,
				displayId: this.displayId
			});

			// Notify handlers
			if (this.eventHandlers['connect']) {
				this.eventHandlers['connect']();
			}
		});

		// Registration confirmed
		this.socket.on('display:registered', (data) => {
			console.log('[WebSocket] Registration confirmed:', data);
			this.log('registered', data);
		});

		// Connection lost
		this.socket.on('disconnect', (reason) => {
			this.connected = false;
			this.log('disconnected', { reason });

			if (this.eventHandlers['disconnect']) {
				this.eventHandlers['disconnect'](reason);
			}
		});

		// Connection error
		this.socket.on('connect_error', (error) => {
			console.error('[WebSocket] Connection error:', error.message);
			this.log('connectError', { error: error.message });
			this.handleConnectionError(error);
		});

		// Reconnection attempt
		this.socket.on('reconnect_attempt', (attempt) => {
			this.reconnectAttempts = attempt;
			this.log('reconnectAttempt', { attempt });

			if (this.eventHandlers['reconnecting']) {
				this.eventHandlers['reconnecting'](attempt);
			}
		});

		// Reconnection successful
		this.socket.on('reconnect', () => {
			this.log('reconnected');

			// Re-register after reconnection
			this.socket.emit('display:register', {
				displayType: 'bracket',
				userId: this.userId,
				displayId: this.displayId
			});
		});

		// Setup event handlers for all event types
		this.eventTypes.forEach(event => {
			this.socket.on(event, (data) => {
				if (event === 'bracket:update' || event === 'matches:update') {
					console.log(`[WebSocket] Received ${event}`, data);
				}
				this.log('event', { event, data: typeof data === 'object' ? '...' : data });
				this.handleEvent(event, data);
			});
		});
	}

	/**
	 * Handle incoming event
	 */
	handleEvent(event, data) {
		// Special handling for bracket:update with hash deduplication
		if (event === 'bracket:update' && data.updateHash) {
			if (data.updateHash === this.lastBracketHash) {
				this.log('skippingDuplicate', { hash: data.updateHash });
				return;
			}
			this.lastBracketHash = data.updateHash;

			// Send acknowledgment
			this.socket.emit('bracket:ack', {
				displayId: this.displayId,
				hash: data.updateHash
			});
		}

		// Call registered handler
		if (this.eventHandlers[event]) {
			try {
				this.eventHandlers[event](data);
			} catch (error) {
				console.error(`[WebSocket] Error handling ${event}:`, error);
			}
		}
	}

	/**
	 * Handle connection error
	 */
	handleConnectionError(error) {
		if (this.eventHandlers['error']) {
			this.eventHandlers['error'](error);
		}
	}

	/**
	 * Register event handler
	 */
	on(event, handler) {
		this.eventHandlers[event] = handler;
	}

	/**
	 * Register multiple event handlers
	 */
	onMany(handlers) {
		Object.entries(handlers).forEach(([event, handler]) => {
			this.on(event, handler);
		});
	}

	/**
	 * Emit event to server
	 */
	emit(event, data) {
		if (this.socket && this.connected) {
			this.socket.emit(event, data);
		}
	}

	/**
	 * Get connection status
	 */
	getStatus() {
		return {
			connected: this.connected,
			socketId: this.socket ? this.socket.id : null,
			userId: this.userId,
			displayId: this.displayId,
			reconnectAttempts: this.reconnectAttempts
		};
	}

	/**
	 * Disconnect from server
	 */
	disconnect() {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
			this.connected = false;
		}
	}
}

// Export for use in other modules
window.WebSocketClient = WebSocketClient;
