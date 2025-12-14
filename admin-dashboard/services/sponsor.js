/**
 * Sponsor Service
 *
 * Manages sponsor overlays, rotation, and timer view functionality.
 * Extracted from server.js for modularity.
 *
 * MULTI-TENANT: Sponsors are stored per-user. Each user has their own
 * sponsor-state-{userId}.json file and sponsors/{userId}/ directory.
 * All WebSocket broadcasts are user-targeted using io.to(`user:${userId}`).
 */

const fsSync = require('fs');
const path = require('path');
const axios = require('axios');

// References set by init
let io = null;

// Base paths
const SPONSOR_STATE_DIR = path.join(__dirname, '..');
const SPONSORS_DIR = path.join(__dirname, '..', 'sponsors');

// Legacy file path (for migration)
const LEGACY_SPONSOR_STATE_FILE = path.join(__dirname, '..', 'sponsor-state.json');

// Rotation state (keyed by userId, then by position)
// Structure: { [userId]: { [position]: timerId } }
let sponsorRotationTimers = {};

// Timer view state (keyed by userId)
// Structure: { [userId]: { timeout: timeoutId, state: 'visible'|'hidden' } }
let sponsorTimerViewState = {};

/**
 * Broadcast event to user's displays (multi-tenant)
 * @param {string} event - Event name
 * @param {Object} payload - Event payload
 * @param {number} userId - User ID (null for global broadcast)
 */
function broadcastToUser(event, payload, userId = null) {
	if (!io) {
		console.warn(`[Sponsors] Cannot broadcast ${event}: io not initialized`);
		return;
	}

	if (userId) {
		io.to(`user:${userId}`).emit(event, payload);
		console.log(`[WebSocket] User-targeted ${event} to user:${userId}`);
	} else {
		io.emit(event, payload);
		console.log(`[WebSocket] Global ${event} broadcast`);
	}
}

/**
 * Get the sponsor state file path for a specific user
 * @param {number} userId - User ID
 * @returns {string} Path to sponsor state file
 */
function getSponsorStateFilePath(userId) {
	if (!userId) {
		// Fallback to legacy file if no userId provided
		return LEGACY_SPONSOR_STATE_FILE;
	}
	return path.join(SPONSOR_STATE_DIR, `sponsor-state-${userId}.json`);
}

/**
 * Get the sponsors directory for a specific user
 * @param {number} userId - User ID
 * @returns {string} Path to user's sponsors directory
 */
function getUserSponsorsDir(userId) {
	if (!userId) {
		return SPONSORS_DIR;
	}
	const userDir = path.join(SPONSORS_DIR, String(userId));
	// Ensure directory exists
	if (!fsSync.existsSync(userDir)) {
		fsSync.mkdirSync(userDir, { recursive: true });
	}
	return userDir;
}

/**
 * Initialize the Sponsor service with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.io - Socket.IO server instance
 */
function init({ io: ioServer }) {
	io = ioServer;
}

/**
 * Load sponsor state from file for a specific user
 * @param {number} userId - User ID (optional, uses legacy file if not provided)
 * @returns {Object} Sponsor state object
 */
function loadSponsorState(userId = null) {
	const filePath = getSponsorStateFilePath(userId);
	try {
		const data = fsSync.readFileSync(filePath, 'utf8');
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
			activeUserId: userId || null,
			lastUpdated: null
		};
	}
}

/**
 * Save sponsor state to file for a specific user
 * @param {Object} state - Sponsor state object
 * @param {number} userId - User ID (optional, uses legacy file if not provided)
 */
function saveSponsorState(state, userId = null) {
	const filePath = getSponsorStateFilePath(userId);
	state.lastUpdated = new Date().toISOString();
	if (userId) {
		state.activeUserId = userId;
	}
	fsSync.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

/**
 * Load all sponsor states across all users (for superadmin)
 * @returns {Array} Array of {userId, state} objects
 */
function loadAllSponsorStates() {
	const allStates = [];

	try {
		// Get all sponsor-state-*.json files
		const files = fsSync.readdirSync(SPONSOR_STATE_DIR);
		const stateFiles = files.filter(f => f.match(/^sponsor-state-\d+\.json$/));

		for (const file of stateFiles) {
			const match = file.match(/^sponsor-state-(\d+)\.json$/);
			if (match) {
				const userId = parseInt(match[1], 10);
				try {
					const data = fsSync.readFileSync(path.join(SPONSOR_STATE_DIR, file), 'utf8');
					const state = JSON.parse(data);
					allStates.push({ userId, state });
				} catch (err) {
					console.warn(`[Sponsors] Failed to read ${file}: ${err.message}`);
				}
			}
		}

		// Also check legacy file (userId = 1 by default for migration)
		if (fsSync.existsSync(LEGACY_SPONSOR_STATE_FILE)) {
			try {
				const data = fsSync.readFileSync(LEGACY_SPONSOR_STATE_FILE, 'utf8');
				const state = JSON.parse(data);
				// Only include if it has sponsors and no user-specific file exists
				if (state.sponsors && state.sponsors.length > 0) {
					const hasUserFile = allStates.some(s => s.userId === 1);
					if (!hasUserFile) {
						allStates.push({ userId: 1, state, isLegacy: true });
					}
				}
			} catch (err) {
				// Legacy file not readable, skip
			}
		}
	} catch (error) {
		console.error('[Sponsors] Failed to load all sponsor states:', error.message);
	}

	return allStates;
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
 * Start sponsor rotation timers for a user
 * @param {number} userId - User ID for multi-tenant targeting
 */
function startSponsorRotation(userId = null) {
	stopSponsorRotation(userId); // Clear any existing timers for this user

	const state = loadSponsorState(userId);
	if (!state.config.enabled || !state.config.rotationEnabled) {
		console.log(`[Sponsors] Rotation disabled for user:${userId || 'global'} - not starting timers`);
		return;
	}

	// Store activeUserId in state for background processes
	if (userId) {
		state.activeUserId = userId;
		saveSponsorState(state, userId);
	}

	const activeUserId = userId || state.activeUserId || null;

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

	// Broadcast initial sponsor:show to user's displays
	if (Object.keys(initialSponsors).length > 0) {
		broadcastToUser('sponsor:show', { sponsors: initialSponsors, duration: 0 }, activeUserId);
		console.log(`[Sponsors] Initial show for user:${activeUserId || 'global'}: ${Object.keys(initialSponsors).join(', ')}`);

		// HTTP fallback to MagicMirror modules
		const matchUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
		const bracketUrl = process.env.BRACKET_API_URL || 'http://localhost:2053';

		axios.post(`${matchUrl}/api/sponsor/show`, { sponsors: initialSponsors }, { timeout: 5000 })
			.catch(err => console.warn(`[Sponsors] HTTP fallback to match failed: ${err.message}`));
		axios.post(`${bracketUrl}/api/sponsor/show`, { sponsors: initialSponsors }, { timeout: 5000 })
			.catch(err => console.warn(`[Sponsors] HTTP fallback to bracket failed: ${err.message}`));
	}

	// Initialize user's timer storage if needed
	const userKey = activeUserId || 'global';
	if (!sponsorRotationTimers[userKey]) {
		sponsorRotationTimers[userKey] = {};
	}

	// Start timer for each position with multiple sponsors
	Object.entries(byPosition).forEach(([position, sponsors]) => {
		if (sponsors.length > 1) {
			console.log(`[Sponsors] Starting rotation timer for ${position} (user:${userKey}, ${sponsors.length} sponsors, ${state.config.rotationInterval}s interval)`);
			sponsorRotationTimers[userKey][position] = setInterval(() => {
				rotateSponsor(position, activeUserId);
			}, state.config.rotationInterval * 1000);
		}
	});
}

/**
 * Stop all sponsor rotation timers for a user
 * @param {number} userId - User ID (null to stop all)
 */
function stopSponsorRotation(userId = null) {
	const userKey = userId || 'global';

	if (userId === null) {
		// Stop all timers for all users
		Object.keys(sponsorRotationTimers).forEach(key => {
			Object.keys(sponsorRotationTimers[key]).forEach(position => {
				clearInterval(sponsorRotationTimers[key][position]);
			});
		});
		sponsorRotationTimers = {};
		console.log('[Sponsors] All rotation timers stopped');
	} else if (sponsorRotationTimers[userKey]) {
		// Stop timers for specific user
		Object.keys(sponsorRotationTimers[userKey]).forEach(position => {
			clearInterval(sponsorRotationTimers[userKey][position]);
		});
		delete sponsorRotationTimers[userKey];
		console.log(`[Sponsors] Rotation timers stopped for user:${userKey}`);
	}
}

/**
 * Rotate to next sponsor at a position for a user
 * @param {string} position - Position to rotate
 * @param {number} userId - User ID for multi-tenant targeting
 */
function rotateSponsor(position, userId = null) {
	const state = loadSponsorState(userId);
	const activeUserId = userId || state.activeUserId || null;

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
	saveSponsorState(state, userId);

	const nextSponsor = sponsors[nextIndex];
	console.log(`[Sponsors] Rotating ${position} for user:${activeUserId || 'global'}: ${nextSponsor.name}`);

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
	broadcastToUser('sponsor:rotate', { position, sponsor: sponsorData, transitionDelay }, activeUserId);

	// HTTP fallback to MagicMirror modules
	const matchUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
	const bracketUrl = process.env.BRACKET_API_URL || 'http://localhost:2053';

	axios.post(`${matchUrl}/api/sponsor/rotate`, { position, sponsor: sponsorData, transitionDelay }, { timeout: 5000 })
		.catch(err => {}); // Silent fail - WebSocket is primary
	axios.post(`${bracketUrl}/api/sponsor/rotate`, { position, sponsor: sponsorData, transitionDelay }, { timeout: 5000 })
		.catch(err => {}); // Silent fail - WebSocket is primary
}

/**
 * Start sponsor timer view (show/hide cycling) for a user
 * @param {number} userId - User ID for multi-tenant targeting
 */
function startSponsorTimerView(userId = null) {
	stopSponsorTimerView(userId);

	const state = loadSponsorState(userId);
	if (!state.config.enabled || !state.config.timerViewEnabled) {
		console.log(`[Sponsors] Timer View disabled for user:${userId || 'global'} - not starting`);
		return;
	}

	// Store activeUserId in state
	if (userId) {
		state.activeUserId = userId;
		saveSponsorState(state, userId);
	}

	const activeUserId = userId || state.activeUserId || null;
	const userKey = activeUserId || 'global';

	const showDuration = (state.config.timerShowDuration || 10) * 1000;
	const hideDuration = (state.config.timerHideDuration || 5) * 1000;

	console.log(`[Sponsors] Starting Timer View for user:${userKey}: show ${showDuration / 1000}s, hide ${hideDuration / 1000}s`);

	// Initialize user's timer view state
	sponsorTimerViewState[userKey] = {
		timeout: null,
		state: 'hidden'
	};

	function cycle() {
		const currentState = loadSponsorState(userId);
		if (!currentState.config.enabled || !currentState.config.timerViewEnabled) {
			stopSponsorTimerView(userId);
			return;
		}

		if (sponsorTimerViewState[userKey].state === 'hidden') {
			// Show all active sponsors
			showAllActiveSponsorsForTimer(activeUserId);
			sponsorTimerViewState[userKey].state = 'visible';
			sponsorTimerViewState[userKey].timeout = setTimeout(cycle, showDuration);
		} else {
			// Hide all sponsors
			hideAllSponsorsForTimer(activeUserId);
			sponsorTimerViewState[userKey].state = 'hidden';
			sponsorTimerViewState[userKey].timeout = setTimeout(cycle, hideDuration);
		}
	}

	// Start cycle by showing sponsors
	showAllActiveSponsorsForTimer(activeUserId);
	sponsorTimerViewState[userKey].state = 'visible';
	sponsorTimerViewState[userKey].timeout = setTimeout(cycle, showDuration);
}

/**
 * Stop sponsor timer view for a user
 * @param {number} userId - User ID (null to stop all)
 */
function stopSponsorTimerView(userId = null) {
	const userKey = userId || 'global';

	if (userId === null) {
		// Stop all timer views
		Object.keys(sponsorTimerViewState).forEach(key => {
			if (sponsorTimerViewState[key].timeout) {
				clearTimeout(sponsorTimerViewState[key].timeout);
			}
		});
		sponsorTimerViewState = {};
		console.log('[Sponsors] All Timer Views stopped');
	} else if (sponsorTimerViewState[userKey]) {
		if (sponsorTimerViewState[userKey].timeout) {
			clearTimeout(sponsorTimerViewState[userKey].timeout);
		}
		delete sponsorTimerViewState[userKey];
		console.log(`[Sponsors] Timer View stopped for user:${userKey}`);
	}
}

/**
 * Show all active sponsors for timer view
 * @param {number} userId - User ID for multi-tenant targeting
 */
async function showAllActiveSponsorsForTimer(userId = null) {
	const state = loadSponsorState(userId);
	const activeUserId = userId || state.activeUserId || null;

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
		console.log(`[Sponsors] Timer View for user:${activeUserId || 'global'}: Showing ${Object.keys(sponsorData).length} sponsor(s)`);

		// Broadcast via WebSocket (multi-tenant)
		broadcastToUser('sponsor:show', { sponsors: sponsorData, duration: 0 }, activeUserId);

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
 * @param {number} userId - User ID for multi-tenant targeting
 */
async function hideAllSponsorsForTimer(userId = null) {
	const state = loadSponsorState(userId);
	const activeUserId = userId || state.activeUserId || null;

	console.log(`[Sponsors] Timer View for user:${activeUserId || 'global'}: Hiding all sponsors`);

	// Broadcast via WebSocket (multi-tenant)
	broadcastToUser('sponsor:hide', { all: true }, activeUserId);

	// Also send via HTTP to MagicMirror modules
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
 * @param {number} userId - User ID for multi-tenant targeting
 */
async function showSponsors(sponsors, config, userId = null) {
	const payload = { sponsors, duration: 0 };

	// Broadcast via WebSocket (multi-tenant)
	broadcastToUser('sponsor:show', payload, userId);

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
 * @param {number} userId - User ID for multi-tenant targeting
 */
async function hideSponsors(position = null, userId = null) {
	const payload = position ? { position } : { all: true };

	// Broadcast via WebSocket (multi-tenant)
	broadcastToUser('sponsor:hide', payload, userId);

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
 * @param {number} userId - User ID for multi-tenant targeting
 */
function updateConfig(newConfig, userId = null) {
	const state = loadSponsorState(userId);
	state.config = { ...state.config, ...newConfig };
	if (userId) {
		state.activeUserId = userId;
	}
	saveSponsorState(state, userId);

	const activeUserId = userId || state.activeUserId || null;

	// Restart rotation with new settings
	if (state.config.enabled && state.config.rotationEnabled) {
		startSponsorRotation(activeUserId);
	} else {
		stopSponsorRotation(activeUserId);
	}

	// Handle timer view
	if (state.config.enabled && state.config.timerViewEnabled) {
		startSponsorTimerView(activeUserId);
	} else {
		stopSponsorTimerView(activeUserId);
	}

	// Broadcast config update (multi-tenant)
	broadcastToUser('sponsor:config', state.config, activeUserId);
}

/**
 * Get current timer view state for a user
 * @param {number} userId - User ID (null for global/legacy)
 * @returns {string} 'visible' or 'hidden'
 */
function getTimerViewState(userId = null) {
	const userKey = userId || 'global';
	return sponsorTimerViewState[userKey]?.state || 'hidden';
}

/**
 * Check if rotation is active for a user
 * @param {number} userId - User ID (null for any)
 * @returns {boolean} True if rotation timers are active
 */
function isRotationActive(userId = null) {
	if (userId === null) {
		// Check if any user has active rotation
		return Object.keys(sponsorRotationTimers).some(key =>
			Object.keys(sponsorRotationTimers[key]).length > 0
		);
	}
	const userKey = userId || 'global';
	return sponsorRotationTimers[userKey] && Object.keys(sponsorRotationTimers[userKey]).length > 0;
}

module.exports = {
	init,
	loadSponsorState,
	saveSponsorState,
	loadAllSponsorStates,
	getSponsorStateFilePath,
	getUserSponsorsDir,
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
	isRotationActive,
	broadcastToUser,
	SPONSORS_DIR
};
