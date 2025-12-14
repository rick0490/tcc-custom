/**
 * Bracket Display Main Controller
 *
 * Orchestrates WebSocket connection, bracket rendering, and sponsor overlays
 * for the standalone bracket display service.
 */

class BracketDisplay {
	constructor(config) {
		this.config = {
			userId: config.userId || '1',
			adminWsUrl: config.adminWsUrl || 'http://localhost:3000',
			adminHttpUrl: config.adminHttpUrl || config.adminWsUrl || 'http://localhost:3000',
			debugMode: config.debugMode || false,
			pollInterval: 30000,  // HTTP fallback poll interval
			reconnectDelay: 5000
		};

		// State
		this.state = {
			connected: false,
			tournament: null,
			matches: [],
			participants: [],
			roundLabels: null,  // Custom round labels { winners: { "1": "Label" }, losers: { "1": "Label" } }
			theme: 'midnight',
			zoom: 1.0,
			initialized: false
		};

		// Module references
		this.wsClient = null;
		this.renderer = null;
		this.pollTimer = null;

		// DOM references
		this.elements = {
			loadingScreen: document.getElementById('loading-screen'),
			loadingStatus: document.getElementById('loading-status'),
			errorScreen: document.getElementById('error-screen'),
			bracketCanvas: document.getElementById('bracket-canvas'),
			placeholder: document.getElementById('no-bracket-placeholder'),
			connectionIndicator: document.getElementById('connection-indicator'),
			connectionText: document.querySelector('.connection-text')
		};

		// Initialize
		this.init();
	}

	/**
	 * Debug logger
	 */
	log(action, data = {}) {
		if (this.config.debugMode) {
			console.log(`%c[BracketDisplay] ${action}`, 'color: #10b981', data);
		}
	}

	/**
	 * Initialize the display
	 */
	async init() {
		this.log('init', { config: this.config });
		this.updateLoadingStatus('Initializing...');

		try {
			// Initialize bracket renderer
			this.initRenderer();

			// Initialize sponsor overlay
			SponsorOverlay.init(this.config.adminHttpUrl, this.config.debugMode);

			// Initialize WebSocket connection
			this.initWebSocket();

			// Fetch initial data via HTTP
			await this.fetchBracketData();

			// Show connection indicator in debug mode
			if (this.config.debugMode) {
				this.elements.connectionIndicator.classList.add('visible');
			}

			this.state.initialized = true;
			this.log('initialized');

		} catch (error) {
			console.error('[BracketDisplay] Initialization error:', error);
			this.showError('Failed to initialize display');
		}
	}

	/**
	 * Initialize bracket renderer
	 */
	initRenderer() {
		// BracketRenderer is a singleton module, not a constructor
		BracketRenderer.init('bracket-canvas');
		BracketRenderer.setDebugMode(this.config.debugMode);

		// Store reference to the module
		this.renderer = BracketRenderer;

		// Handle window resize
		window.addEventListener('resize', () => {
			if (this.state.tournament && this.state.matches.length > 0) {
				this.renderer.render(
					this.state.tournament,
					this.state.matches,
					this.state.participants
				);
			}
		});

		this.log('renderer initialized');
	}

	/**
	 * Initialize WebSocket connection
	 */
	initWebSocket() {
		this.wsClient = new WebSocketClient(this.config.adminWsUrl, this.config.userId);
		this.wsClient.setDebugMode(this.config.debugMode);

		// Register event handlers
		this.wsClient.onMany({
			'connect': () => this.onConnect(),
			'disconnect': (reason) => this.onDisconnect(reason),
			'reconnecting': (attempt) => this.onReconnecting(attempt),
			'error': (error) => this.onError(error),

			// Bracket events
			'bracket:update': (data) => this.onBracketUpdate(data),
			'bracket:zoom': (data) => this.onZoomChange(data),
			'bracket:reset': () => this.onBracketReset(),
			'bracket:control': (data) => this.onBracketControl(data),

			// Match events
			'matches:update': (data) => this.onMatchesUpdate(data),

			// Tournament events
			'tournament:update': (data) => this.onTournamentUpdate(data),
			'tournament:deployed': (data) => this.onTournamentDeployed(data),
			'tournament:started': (data) => this.onTournamentStarted(data),
			'tournament:completed': (data) => this.onTournamentCompleted(data),
			'tournament:reset': (data) => this.onTournamentReset(data),

			// Sponsor events
			'sponsor:show': (data) => this.onSponsorShow(data),
			'sponsor:hide': (data) => this.onSponsorHide(data),
			'sponsor:rotate': (data) => this.onSponsorRotate(data),
			'sponsor:config': (data) => this.onSponsorConfig(data),

			// Emergency mode events
			'emergency:activated': (data) => this.onEmergencyActivated(data),
			'emergency:deactivated': (data) => this.onEmergencyDeactivated(data),
			'emergency:status': (data) => this.onEmergencyStatus(data)
		});

		// Connect
		this.wsClient.connect();
		this.log('websocket initialized');
	}

	/**
	 * Update loading status text
	 */
	updateLoadingStatus(text) {
		if (this.elements.loadingStatus) {
			this.elements.loadingStatus.textContent = text;
		}
	}

	/**
	 * Hide loading screen
	 */
	hideLoading() {
		if (this.elements.loadingScreen) {
			this.elements.loadingScreen.classList.add('hidden');
		}
	}

	/**
	 * Show error screen
	 */
	showError(message) {
		this.hideLoading();
		if (this.elements.errorScreen) {
			this.elements.errorScreen.classList.remove('hidden');
			const errorMsg = this.elements.errorScreen.querySelector('.error-message');
			if (errorMsg) {
				errorMsg.textContent = message;
			}
		}
	}

	/**
	 * Hide error screen
	 */
	hideError() {
		if (this.elements.errorScreen) {
			this.elements.errorScreen.classList.add('hidden');
		}
	}

	/**
	 * Show placeholder (no bracket)
	 */
	showPlaceholder() {
		if (this.elements.placeholder) {
			this.elements.placeholder.classList.remove('hidden');
		}
		if (this.elements.bracketCanvas) {
			this.elements.bracketCanvas.style.display = 'none';
		}
	}

	/**
	 * Hide placeholder
	 */
	hidePlaceholder() {
		if (this.elements.placeholder) {
			this.elements.placeholder.classList.add('hidden');
		}
		if (this.elements.bracketCanvas) {
			this.elements.bracketCanvas.style.display = 'block';
		}
	}

	/**
	 * Update connection indicator
	 */
	updateConnectionIndicator(status, text) {
		const indicator = this.elements.connectionIndicator;
		if (!indicator) return;

		indicator.classList.remove('connected', 'disconnected', 'connecting');
		indicator.classList.add(status);

		if (this.elements.connectionText) {
			this.elements.connectionText.textContent = text;
		}

		// Show temporarily on status change, then fade
		indicator.classList.add('visible');
		if (!this.config.debugMode) {
			setTimeout(() => {
				indicator.classList.remove('visible');
			}, 3000);
		}
	}

	/**
	 * Fetch bracket data via HTTP
	 */
	async fetchBracketData() {
		this.updateLoadingStatus('Fetching bracket data...');
		this.log('fetchBracketData');

		try {
			const response = await fetch(`/api/u/${this.config.userId}/bracket/data`);

			if (!response.ok) {
				if (response.status === 404) {
					// No tournament configured - only show placeholder if we don't have WebSocket data
					this.hideLoading();
					if (!this.state.tournament) {
						this.showPlaceholder();
					}
					this.startPolling();
					return;
				}
				throw new Error(`HTTP ${response.status}`);
			}

			const data = await response.json();
			this.log('fetchBracketData response', {
				hasTournament: !!data.tournament,
				matchCount: data.matches?.length || 0,
				participantCount: data.participants?.length || 0
			});

			// Always apply theme from HTTP response if provided
			if (data.theme) {
				this.state.theme = data.theme;
				if (this.renderer) {
					this.renderer.setTheme(data.theme);
				}
			}

			// Apply round labels from HTTP response if provided
			if (data.roundLabels !== undefined) {
				this.state.roundLabels = data.roundLabels;
				if (this.renderer) {
					this.renderer.setCustomLabels(this.state.roundLabels);
				}
			}

			// Check if HTTP response has usable data
			const httpHasData = data.tournament && (data.matches?.length > 0 || data.participants?.length >= 2);

			if (httpHasData) {
				// Update state from HTTP response
				this.state.tournament = data.tournament;
				this.state.matches = data.matches || [];
				this.state.participants = data.participants || [];

				// Render bracket
				this.renderBracket();
				this.hideLoading();
				this.hidePlaceholder();
			} else {
				// HTTP has no data - don't overwrite existing WebSocket state
				// Only show placeholder if we don't already have valid state
				const existingHasData = this.state.matches.length > 0 || this.state.participants.length >= 2;
				if (!this.state.tournament || !existingHasData) {
					this.hideLoading();
					this.showPlaceholder();
				}
			}

			// Start polling as fallback
			this.startPolling();

		} catch (error) {
			console.error('[BracketDisplay] Failed to fetch bracket data:', error);
			// Don't show error or placeholder if we have valid WebSocket state
			const existingHasData = this.state.matches.length > 0 || this.state.participants.length >= 2;
			if (!this.state.tournament || !existingHasData) {
				this.hideLoading();
				this.showPlaceholder();
			}
			this.startPolling();
		}
	}

	/**
	 * Render the bracket
	 */
	renderBracket() {
		// Allow rendering with at least 2 participants even without matches (pre-start state)
		const hasData = this.state.matches.length > 0 || this.state.participants.length >= 2;
		if (!this.renderer || !this.state.tournament || !hasData) {
			this.log('renderBracket skipped', {
				hasRenderer: !!this.renderer,
				hasTournament: !!this.state.tournament,
				matchCount: this.state.matches.length,
				participantCount: this.state.participants.length
			});
			return;
		}

		this.log('renderBracket', {
			tournament: this.state.tournament.name,
			format: this.state.tournament.tournament_type,
			matches: this.state.matches.length,
			participants: this.state.participants.length,
			theme: this.state.theme
		});

		this.renderer.render(
			this.state.tournament,
			this.state.matches,
			this.state.participants
		);
	}

	/**
	 * Start HTTP polling (fallback for WebSocket)
	 */
	startPolling() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
		}

		// Only poll if WebSocket is disconnected
		this.pollTimer = setInterval(() => {
			if (!this.state.connected) {
				this.fetchBracketData();
			}
		}, this.config.pollInterval);

		this.log('polling started', { interval: this.config.pollInterval });
	}

	/**
	 * Stop HTTP polling
	 */
	stopPolling() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.log('polling stopped');
	}

	// ========== WebSocket Event Handlers ==========

	onConnect() {
		this.state.connected = true;
		this.updateConnectionIndicator('connected', 'Connected');
		this.hideError();
		this.log('connected');

		// Refresh data on reconnect
		if (this.state.initialized) {
			this.fetchBracketData();
		}
	}

	onDisconnect(reason) {
		this.state.connected = false;
		this.updateConnectionIndicator('disconnected', 'Disconnected');
		this.log('disconnected', { reason });
	}

	onReconnecting(attempt) {
		this.updateConnectionIndicator('connecting', `Reconnecting (${attempt})...`);
		this.log('reconnecting', { attempt });
	}

	onError(error) {
		console.error('[BracketDisplay] WebSocket error:', error);
		this.updateConnectionIndicator('disconnected', 'Connection Error');
	}

	onBracketUpdate(data) {
		this.log('bracket:update', data);

		if (data.tournament) {
			this.state.tournament = data.tournament;
		}
		if (data.matches) {
			this.state.matches = data.matches;
		}
		if (data.participants) {
			this.state.participants = data.participants;
		}
		if (data.theme) {
			this.state.theme = data.theme;
			if (this.renderer) {
				this.renderer.setTheme(data.theme);
			}
		}
		if (data.roundLabels !== undefined) {
			this.state.roundLabels = data.roundLabels;
			if (this.renderer) {
				this.renderer.setCustomLabels(this.state.roundLabels);
			}
		}

		// Allow rendering with at least 2 participants even without matches (pre-start state)
		const hasData = this.state.matches.length > 0 || this.state.participants.length >= 2;
		if (this.state.tournament && hasData) {
			this.hidePlaceholder();
			this.renderBracket();
		} else {
			this.showPlaceholder();
		}
	}

	onZoomChange(data) {
		this.log('bracket:zoom', data);

		if (data.zoom !== undefined && this.renderer) {
			this.renderer.setZoom(data.zoom);
		}
	}

	onBracketReset() {
		this.log('bracket:reset');

		if (this.renderer) {
			this.renderer.resetView();
		}
	}

	onBracketControl(data) {
		this.log('bracket:control', data);

		switch (data.action) {
			case 'zoomIn':
				if (this.renderer) this.renderer.zoomIn();
				break;
			case 'zoomOut':
				if (this.renderer) this.renderer.zoomOut();
				break;
			case 'resetView':
				if (this.renderer) this.renderer.resetView();
				break;
			case 'fitToScreen':
				if (this.renderer) this.renderer.fitBracket();
				break;
			case 'setTheme':
				if (data.theme && this.renderer) {
					this.state.theme = data.theme;
					this.renderer.setTheme(data.theme);
				}
				break;
			case 'setRoundLabels':
				this.log('setRoundLabels', { labels: data.labels });
				this.state.roundLabels = data.labels || null;
				if (this.renderer) {
					this.renderer.setCustomLabels(this.state.roundLabels);
				}
				break;
		}
	}

	onMatchesUpdate(data) {
		this.log('matches:update', {
			matchCount: data.matches?.length,
			hasParticipantsCache: !!data.participantsCache,
			hasTournament: !!data.tournament,
			existingParticipants: this.state.participants?.length
		});

		if (data.matches) {
			this.state.matches = data.matches;
		}

		// Extract participants from cache if available
		// Note: participantsCache is {id: name} format, convert to participant objects
		// Only use cache if we don't already have valid participants
		if (data.participantsCache && Object.keys(data.participantsCache).length > 0) {
			// Check if we already have valid participant objects
			const hasValidParticipants = this.state.participants?.length > 0 &&
				typeof this.state.participants[0] === 'object' &&
				this.state.participants[0]?.id !== undefined;

			if (!hasValidParticipants) {
				// Convert cache {id: name} to participant objects
				this.state.participants = Object.entries(data.participantsCache).map(([id, name]) => ({
					id: parseInt(id),
					name: name,
					seed: null
				}));
				this.log('matches:update converted cache to participants', {
					count: this.state.participants.length
				});
			}
		}

		// Extract tournament info if included
		if (data.tournament) {
			this.state.tournament = data.tournament;
		}

		// Try to render if we have the minimum data
		this.renderBracket();
	}

	onTournamentUpdate(data) {
		this.log('tournament:update', data);

		if (data.tournament) {
			this.state.tournament = data.tournament;
			this.renderBracket();
		}
	}

	onTournamentDeployed(data) {
		this.log('tournament:deployed', {
			tournamentId: data.tournamentId,
			hasTournament: !!data.tournament,
			hasParticipants: !!data.participants,
			participantCount: data.participants?.length || 0,
			theme: data.theme
		});

		// Use tournament data from event if available
		if (data.tournament) {
			this.state.tournament = data.tournament;
		}

		// Use participants from event if available
		if (data.participants && data.participants.length > 0) {
			this.state.participants = data.participants;
		}

		// Apply theme from event if available
		if (data.theme) {
			this.state.theme = data.theme;
			if (this.renderer) {
				this.renderer.setTheme(data.theme);
			}
		}

		// If we have enough data for a preview bracket, render it
		const hasData = this.state.matches.length > 0 || this.state.participants.length >= 2;
		if (this.state.tournament && hasData) {
			this.hidePlaceholder();
			this.hideLoading();
			this.renderBracket();
		} else {
			// Fetch additional data if needed
			this.fetchBracketData();
		}
	}

	onTournamentStarted(data) {
		this.log('tournament:started', {
			tournamentId: data.tournamentId,
			hasTournament: !!data.tournament,
			hasMatches: !!data.matches
		});

		// Use data from event if available
		if (data.tournament) {
			this.state.tournament = data.tournament;
		}
		if (data.matches) {
			this.state.matches = data.matches;
		}

		// Render or fetch additional data if needed
		const hasData = this.state.matches.length > 0 || this.state.participants.length >= 2;
		if (this.state.tournament && hasData) {
			this.hidePlaceholder();
			this.renderBracket();
		} else {
			this.fetchBracketData();
		}
	}

	onTournamentCompleted(data) {
		this.log('tournament:completed', data);

		// Update state and re-render
		if (data.tournament) {
			this.state.tournament = data.tournament;
		}
		this.renderBracket();
	}

	onTournamentReset(data) {
		this.log('tournament:reset', data);

		// Clear bracket and show placeholder
		this.state.tournament = null;
		this.state.matches = [];
		this.state.participants = [];
		this.showPlaceholder();
	}

	onSponsorShow(data) {
		this.log('sponsor:show', data);
		SponsorOverlay.show(data.sponsors, data.config);
	}

	onSponsorHide(data) {
		this.log('sponsor:hide', data);

		if (data.position) {
			SponsorOverlay.hide(data.position);
		} else {
			SponsorOverlay.hideAll();
		}
	}

	onSponsorRotate(data) {
		this.log('sponsor:rotate', data);

		if (data.position && data.sponsor) {
			SponsorOverlay.rotate(data.position, data.sponsor);
		}
	}

	onSponsorConfig(data) {
		this.log('sponsor:config', data);
		SponsorOverlay.updateConfig(data.config);
	}

	// ========== Emergency Mode Handlers ==========

	onEmergencyActivated(data) {
		this.log('emergency:activated', data);
		this.showTechnicalDifficulties(data);
	}

	onEmergencyDeactivated(data) {
		this.log('emergency:deactivated', data);
		this.hideTechnicalDifficulties();
	}

	onEmergencyStatus(data) {
		this.log('emergency:status', data);
		if (data.active) {
			this.showTechnicalDifficulties(data);
		} else {
			this.hideTechnicalDifficulties();
		}
	}

	/**
	 * Show Technical Difficulties overlay (emergency mode)
	 */
	showTechnicalDifficulties(data = {}) {
		const overlay = document.getElementById('emergency-overlay');
		const timestamp = document.getElementById('emergency-timestamp');

		if (overlay) {
			overlay.classList.add('active');

			// Update timestamp
			if (timestamp) {
				const time = data.activatedAt ? new Date(data.activatedAt) : new Date();
				timestamp.textContent = `Emergency mode activated at ${time.toLocaleTimeString()}`;
			}

			this.log('showTechnicalDifficulties', { activatedAt: data.activatedAt });
		}
	}

	/**
	 * Hide Technical Difficulties overlay (all clear)
	 */
	hideTechnicalDifficulties() {
		const overlay = document.getElementById('emergency-overlay');

		if (overlay) {
			overlay.classList.remove('active');
			this.log('hideTechnicalDifficulties');
		}
	}

	// ========== Public API ==========

	/**
	 * Get current state
	 */
	getState() {
		return {
			...this.state,
			wsStatus: this.wsClient ? this.wsClient.getStatus() : null,
			rendererZoom: this.renderer ? this.renderer.getZoom() : null,
			rendererTheme: this.renderer ? this.renderer.getTheme() : null,
			rendererRoundLabels: this.renderer ? this.renderer.getCustomLabels() : null,
			sponsorState: SponsorOverlay.getState()
		};
	}

	/**
	 * Set theme
	 */
	setTheme(theme) {
		this.state.theme = theme;
		if (this.renderer) {
			this.renderer.setTheme(theme);
		}
	}

	/**
	 * Set custom round labels
	 */
	setRoundLabels(labels) {
		this.state.roundLabels = labels || null;
		if (this.renderer) {
			this.renderer.setCustomLabels(this.state.roundLabels);
		}
	}

	/**
	 * Set zoom level
	 */
	setZoom(zoom) {
		if (this.renderer) {
			this.renderer.setZoom(zoom);
		}
	}

	/**
	 * Reset view
	 */
	resetView() {
		if (this.renderer) {
			this.renderer.resetView();
		}
	}

	/**
	 * Fit to screen
	 */
	fitToScreen() {
		if (this.renderer) {
			this.renderer.fitBracket();
		}
	}

	/**
	 * Force refresh
	 */
	refresh() {
		this.fetchBracketData();
	}

	/**
	 * Destroy instance
	 */
	destroy() {
		this.stopPolling();
		if (this.wsClient) {
			this.wsClient.disconnect();
		}
		// BracketRenderer is a singleton module, no destroy needed
		SponsorOverlay.hideAll();
	}
}

// Export for use
window.BracketDisplay = BracketDisplay;
