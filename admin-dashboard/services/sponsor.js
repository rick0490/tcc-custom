/**
 * Sponsor Service
 *
 * Manages sponsor overlays, rotation, and timer view functionality.
 * Extracted from server.js for modularity.
 */

const fsSync = require('fs');
const path = require('path');
const axios = require('axios');

// References set by init
let io = null;

// File paths
const SPONSOR_STATE_FILE = path.join(__dirname, '..', 'sponsor-state.json');

// Rotation state
let sponsorRotationTimers = {};
let sponsorTimerViewTimeout = null;
let sponsorTimerViewState = 'hidden';

/**
 * Initialize the Sponsor service with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.io - Socket.IO server instance
 */
function init({ io: ioServer }) {
	io = ioServer;
}

/**
 * Load sponsor state from file
 * @returns {Object} Sponsor state object
 */
function loadSponsorState() {
	try {
		const data = fsSync.readFileSync(SPONSOR_STATE_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		return {
			sponsors: [],
			config: {
				enabled: false,
				rotationEnabled: true,
				rotationInterval: 30,
				rotationOrder: 'sequential',
				timerViewEnabled: false,
				timerShowDuration: 10,
				timerHideDuration: 5,
				displays: { match: true, bracket: true },
				currentIndex: {}
			},
			lastUpdated: null
		};
	}
}

/**
 * Save sponsor state to file
 * @param {Object} state - Sponsor state object
 */
function saveSponsorState(state) {
	state.lastUpdated = new Date().toISOString();
	fsSync.writeFileSync(SPONSOR_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Sanitize filename for sponsor images
 * @param {string} name - Original name
 * @returns {string} Sanitized filename
 */
function sanitizeSponsorFilename(name) {
	return name.toLowerCase()
		.replace(/[^a-z0-9-_]/g, '_')
		.replace(/_+/g, '_')
		.substring(0, 50);
}

/**
 * Start sponsor rotation timers
 */
function startSponsorRotation() {
	stopSponsorRotation(); // Clear any existing timers

	const state = loadSponsorState();
	if (!state.config.enabled || !state.config.rotationEnabled) {
		console.log('[Sponsors] Rotation disabled - not starting timers');
		return;
	}

	// Group active sponsors by position
	const byPosition = {};
	state.sponsors.filter(s => s.active).forEach(s => {
		if (!byPosition[s.position]) byPosition[s.position] = [];
		byPosition[s.position].push(s);
	});

	// Show initial sponsors at each position (first sponsor per position)
	const initialSponsors = {};
	Object.entries(byPosition).forEach(([position, sponsors]) => {
		const sorted = sponsors.sort((a, b) => a.order - b.order);
		const currentIndex = state.config.currentIndex[position] || 0;
		const sponsor = sorted[currentIndex % sorted.length];
		if (sponsor) {
			initialSponsors[position] = {
				id: sponsor.id,
				filename: sponsor.filename,
				name: sponsor.name,
				position: sponsor.position,
				type: sponsor.type,
				size: sponsor.size,
				opacity: sponsor.opacity,
				borderRadius: sponsor.borderRadius || 0,
				offsetX: sponsor.offsetX || 0,
				offsetY: sponsor.offsetY || 0,
				active: true
			};
		}
	});

	// Broadcast initial sponsor:show to display all sponsors
	if (Object.keys(initialSponsors).length > 0) {
		io.emit('sponsor:show', { sponsors: initialSponsors, duration: 0 });
		console.log(`[Sponsors] Initial show: ${Object.keys(initialSponsors).join(', ')}`);

		// HTTP fallback to MagicMirror modules
		const matchUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
		const bracketUrl = process.env.BRACKET_API_URL || 'http://localhost:2053';

		axios.post(`${matchUrl}/api/sponsor/show`, { sponsors: initialSponsors }, { timeout: 5000 })
			.catch(err => console.warn(`[Sponsors] HTTP fallback to match failed: ${err.message}`));
		axios.post(`${bracketUrl}/api/sponsor/show`, { sponsors: initialSponsors }, { timeout: 5000 })
			.catch(err => console.warn(`[Sponsors] HTTP fallback to bracket failed: ${err.message}`));
	}

	// Start timer for each position with multiple sponsors
	Object.entries(byPosition).forEach(([position, sponsors]) => {
		if (sponsors.length > 1) {
			console.log(`[Sponsors] Starting rotation timer for ${position} (${sponsors.length} sponsors, ${state.config.rotationInterval}s interval)`);
			sponsorRotationTimers[position] = setInterval(() => {
				rotateSponsor(position);
			}, state.config.rotationInterval * 1000);
		}
	});
}

/**
 * Stop all sponsor rotation timers
 */
function stopSponsorRotation() {
	Object.keys(sponsorRotationTimers).forEach(position => {
		clearInterval(sponsorRotationTimers[position]);
	});
	sponsorRotationTimers = {};
	console.log('[Sponsors] Rotation timers stopped');
}

/**
 * Rotate to next sponsor at a position
 * @param {string} position - Position to rotate
 */
function rotateSponsor(position) {
	const state = loadSponsorState();
	const sponsors = state.sponsors
		.filter(s => s.active && s.position === position)
		.sort((a, b) => a.order - b.order);

	if (sponsors.length < 2) return;

	// Initialize index if not set
	if (state.config.currentIndex[position] === undefined) {
		state.config.currentIndex[position] = 0;
	}

	let nextIndex;
	if (state.config.rotationOrder === 'random') {
		nextIndex = Math.floor(Math.random() * sponsors.length);
	} else {
		nextIndex = (state.config.currentIndex[position] + 1) % sponsors.length;
	}

	state.config.currentIndex[position] = nextIndex;
	saveSponsorState(state);

	const nextSponsor = sponsors[nextIndex];
	console.log(`[Sponsors] Rotating ${position}: ${nextSponsor.name}`);

	// Broadcast rotation event
	const sponsorData = {
		id: nextSponsor.id,
		filename: nextSponsor.filename,
		name: nextSponsor.name,
		position: nextSponsor.position,
		type: nextSponsor.type,
		size: nextSponsor.size,
		opacity: nextSponsor.opacity,
		borderRadius: nextSponsor.borderRadius || 0,
		offsetX: nextSponsor.offsetX || 0,
		offsetY: nextSponsor.offsetY || 0,
		active: true
	};

	const transitionDelay = state.config.rotationTransition || 500;
	io.emit('sponsor:rotate', { position, sponsor: sponsorData, transitionDelay });

	// HTTP fallback to MagicMirror modules
	const matchUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
	const bracketUrl = process.env.BRACKET_API_URL || 'http://localhost:2053';

	axios.post(`${matchUrl}/api/sponsor/rotate`, { position, sponsor: sponsorData, transitionDelay }, { timeout: 5000 })
		.catch(err => {}); // Silent fail - WebSocket is primary
	axios.post(`${bracketUrl}/api/sponsor/rotate`, { position, sponsor: sponsorData, transitionDelay }, { timeout: 5000 })
		.catch(err => {}); // Silent fail - WebSocket is primary
}

/**
 * Start sponsor timer view (show/hide cycling)
 */
function startSponsorTimerView() {
	stopSponsorTimerView();

	const state = loadSponsorState();
	if (!state.config.enabled || !state.config.timerViewEnabled) {
		console.log('[Sponsors] Timer View disabled - not starting');
		return;
	}

	const showDuration = (state.config.timerShowDuration || 10) * 1000;
	const hideDuration = (state.config.timerHideDuration || 5) * 1000;

	console.log(`[Sponsors] Starting Timer View: show ${showDuration / 1000}s, hide ${hideDuration / 1000}s`);

	function cycle() {
		const currentState = loadSponsorState();
		if (!currentState.config.enabled || !currentState.config.timerViewEnabled) {
			stopSponsorTimerView();
			return;
		}

		if (sponsorTimerViewState === 'hidden') {
			// Show all active sponsors
			showAllActiveSponsorsForTimer();
			sponsorTimerViewState = 'visible';
			sponsorTimerViewTimeout = setTimeout(cycle, showDuration);
		} else {
			// Hide all sponsors
			hideAllSponsorsForTimer();
			sponsorTimerViewState = 'hidden';
			sponsorTimerViewTimeout = setTimeout(cycle, hideDuration);
		}
	}

	// Start cycle by showing sponsors
	showAllActiveSponsorsForTimer();
	sponsorTimerViewState = 'visible';
	sponsorTimerViewTimeout = setTimeout(cycle, showDuration);
}

/**
 * Stop sponsor timer view
 */
function stopSponsorTimerView() {
	if (sponsorTimerViewTimeout) {
		clearTimeout(sponsorTimerViewTimeout);
		sponsorTimerViewTimeout = null;
	}
	sponsorTimerViewState = 'hidden';
	console.log('[Sponsors] Timer View stopped');
}

/**
 * Show all active sponsors for timer view
 */
async function showAllActiveSponsorsForTimer() {
	const state = loadSponsorState();
	const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-banner', 'bottom-banner'];
	const sponsorData = {};

	positions.forEach(pos => {
		const sponsor = state.sponsors
			.filter(s => s.active && s.position === pos)
			.sort((a, b) => a.order - b.order)[0];
		if (sponsor) {
			sponsorData[pos] = {
				id: sponsor.id,
				filename: sponsor.filename,
				name: sponsor.name,
				position: sponsor.position,
				type: sponsor.type,
				size: sponsor.size,
				opacity: sponsor.opacity,
				borderRadius: sponsor.borderRadius || 0,
				offsetX: sponsor.offsetX || 0,
				offsetY: sponsor.offsetY || 0,
				active: true
			};
		}
	});

	if (Object.keys(sponsorData).length > 0) {
		console.log(`[Sponsors] Timer View: Showing ${Object.keys(sponsorData).length} sponsor(s)`);

		// Broadcast via WebSocket
		io.emit('sponsor:show', { sponsors: sponsorData, duration: 0 });

		// Also send via HTTP to MagicMirror modules
		const matchEnabled = state.config.displays?.match !== false;
		const bracketEnabled = state.config.displays?.bracket !== false;

		if (matchEnabled && process.env.SPONSOR_MATCH_API_URL) {
			try {
				await axios.post(`${process.env.SPONSOR_MATCH_API_URL}/api/sponsor/show`, {
					sponsors: sponsorData,
					duration: 0
				}, { timeout: 5000 });
			} catch (httpError) {
				console.warn(`[Sponsors] Timer View HTTP push to match failed: ${httpError.message}`);
			}
		}

		if (bracketEnabled && process.env.SPONSOR_BRACKET_API_URL) {
			try {
				await axios.post(`${process.env.SPONSOR_BRACKET_API_URL}/api/sponsor/show`, {
					sponsors: sponsorData,
					duration: 0
				}, { timeout: 5000 });
			} catch (httpError) {
				console.warn(`[Sponsors] Timer View HTTP push to bracket failed: ${httpError.message}`);
			}
		}
	}
}

/**
 * Hide all sponsors for timer view
 */
async function hideAllSponsorsForTimer() {
	console.log('[Sponsors] Timer View: Hiding all sponsors');

	// Broadcast via WebSocket
	io.emit('sponsor:hide', { all: true });

	// Also send via HTTP to MagicMirror modules
	const state = loadSponsorState();
	const matchEnabled = state.config.displays?.match !== false;
	const bracketEnabled = state.config.displays?.bracket !== false;

	if (matchEnabled && process.env.SPONSOR_MATCH_API_URL) {
		try {
			await axios.post(`${process.env.SPONSOR_MATCH_API_URL}/api/sponsor/hide`, {
				all: true
			}, { timeout: 5000 });
		} catch (httpError) {
			console.warn(`[Sponsors] Timer View HTTP hide to match failed: ${httpError.message}`);
		}
	}

	if (bracketEnabled && process.env.SPONSOR_BRACKET_API_URL) {
		try {
			await axios.post(`${process.env.SPONSOR_BRACKET_API_URL}/api/sponsor/hide`, {
				all: true
			}, { timeout: 5000 });
		} catch (httpError) {
			console.warn(`[Sponsors] Timer View HTTP hide to bracket failed: ${httpError.message}`);
		}
	}
}

/**
 * Show sponsors on displays
 * @param {Object} sponsors - Sponsors by position
 * @param {Object} config - Display configuration
 */
async function showSponsors(sponsors, config) {
	const payload = { sponsors, duration: 0 };

	// Broadcast via WebSocket
	io.emit('sponsor:show', payload);

	// HTTP fallback
	const matchUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
	const bracketUrl = process.env.BRACKET_API_URL || 'http://localhost:2053';

	if (config?.displays?.match !== false) {
		axios.post(`${matchUrl}/api/sponsor/show`, payload, { timeout: 5000 })
			.catch(err => console.warn(`[Sponsors] HTTP show to match failed: ${err.message}`));
	}

	if (config?.displays?.bracket !== false) {
		axios.post(`${bracketUrl}/api/sponsor/show`, payload, { timeout: 5000 })
			.catch(err => console.warn(`[Sponsors] HTTP show to bracket failed: ${err.message}`));
	}
}

/**
 * Hide sponsors on displays
 * @param {string|null} position - Position to hide, or null for all
 */
async function hideSponsors(position = null) {
	const payload = position ? { position } : { all: true };

	// Broadcast via WebSocket
	io.emit('sponsor:hide', payload);

	// HTTP fallback
	const matchUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
	const bracketUrl = process.env.BRACKET_API_URL || 'http://localhost:2053';

	axios.post(`${matchUrl}/api/sponsor/hide`, payload, { timeout: 5000 })
		.catch(err => {});
	axios.post(`${bracketUrl}/api/sponsor/hide`, payload, { timeout: 5000 })
		.catch(err => {});
}

/**
 * Update sponsor configuration and restart rotation if needed
 * @param {Object} newConfig - New configuration
 */
function updateConfig(newConfig) {
	const state = loadSponsorState();
	state.config = { ...state.config, ...newConfig };
	saveSponsorState(state);

	// Restart rotation with new settings
	if (state.config.enabled && state.config.rotationEnabled) {
		startSponsorRotation();
	} else {
		stopSponsorRotation();
	}

	// Handle timer view
	if (state.config.enabled && state.config.timerViewEnabled) {
		startSponsorTimerView();
	} else {
		stopSponsorTimerView();
	}

	// Broadcast config update
	io.emit('sponsor:config', state.config);
}

/**
 * Get current timer view state
 * @returns {string} 'visible' or 'hidden'
 */
function getTimerViewState() {
	return sponsorTimerViewState;
}

/**
 * Check if rotation is active for any position
 * @returns {boolean} True if any rotation timers are active
 */
function isRotationActive() {
	return Object.keys(sponsorRotationTimers).length > 0;
}

module.exports = {
	init,
	loadSponsorState,
	saveSponsorState,
	sanitizeSponsorFilename,
	startSponsorRotation,
	stopSponsorRotation,
	rotateSponsor,
	startSponsorTimerView,
	stopSponsorTimerView,
	showAllActiveSponsorsForTimer,
	hideAllSponsorsForTimer,
	showSponsors,
	hideSponsors,
	updateConfig,
	getTimerViewState,
	isRotationActive
};
