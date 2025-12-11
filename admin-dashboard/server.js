require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const webpush = require('web-push');
const secrets = require('./config/secrets');
const tickerScheduler = require('./services/ticker-scheduler');

// PDF Report Color Palette
const PDF_COLORS = {
	primary: '#1A1A1A',      // Near-black for headers/backgrounds
	secondary: '#FFFFFF',    // White for text on dark backgrounds
	accent: '#E63946',       // Red for highlights and accents
	muted: '#6B7280',        // Gray for secondary text
	surface: '#2D2D2D',      // Dark gray for alternating rows
	border: '#404040',       // Subtle borders
	gold: '#FFD700',         // 1st place medal
	silver: '#C0C0C0',       // 2nd place medal
	bronze: '#CD7F32',       // 3rd place medal
	rowAlt: '#F5F5F5'        // Alternating row background
};

// PDF Helper: Draw medal circle for top 3 placements
function drawPdfMedal(doc, x, y, rank) {
	const medalColors = { 1: PDF_COLORS.gold, 2: PDF_COLORS.silver, 3: PDF_COLORS.bronze };
	const color = medalColors[rank];
	if (!color) return;

	doc.save();
	doc.circle(x, y, 12).fill(color);
	doc.fillColor(rank === 1 ? '#000000' : '#FFFFFF')
		.fontSize(10).font('Helvetica-Bold')
		.text(rank.toString(), x - 4, y - 5, { width: 8, align: 'center' });
	doc.restore();
}

// PDF Helper: Draw section header with accent bar
function drawPdfSectionHeader(doc, title, y) {
	const x = 50;
	doc.save();
	doc.fillColor(PDF_COLORS.accent).rect(x, y, 4, 24).fill();
	doc.fillColor(PDF_COLORS.primary).font('Helvetica-Bold').fontSize(14)
		.text(title, x + 12, y + 4);
	doc.restore();
	return y + 35;
}

// PDF Helper: Draw alternating row background
function drawPdfTableRow(doc, y, isAlternate, height = 24) {
	if (isAlternate) {
		doc.save();
		doc.fillColor(PDF_COLORS.rowAlt).rect(50, y, 510, height).fill();
		doc.restore();
	}
}

// PDF Analytics: Find biggest upsets (lower seed beating higher seed)
function findUpsets(matches, standings) {
	const seedMap = {};
	standings.forEach(s => { seedMap[s.name] = s.seed; });

	return matches
		.filter(m => m.winner && m.player1 && m.player2)
		.map(m => {
			const winnerSeed = seedMap[m.winner] || 999;
			const loserName = m.winner === m.player1 ? m.player2 : m.player1;
			const loserSeed = seedMap[loserName] || 999;
			return {
				...m,
				winnerSeed,
				loserSeed,
				loserName,
				seedDiff: winnerSeed - loserSeed
			};
		})
		.filter(m => m.seedDiff > 0) // Winner had higher seed number (worse seed = upset)
		.sort((a, b) => b.seedDiff - a.seedDiff) // Biggest upsets first
		.slice(0, 5);
}

// PDF Analytics: Find closest matches (decided by 1 game)
function findCloseMatches(matches) {
	return matches
		.filter(m => {
			if (!m.score || m.score === '-') return false;
			const parts = m.score.split('-').map(n => parseInt(n, 10) || 0);
			if (parts.length < 2) return false;
			const p1 = parts[0];
			const p2 = parts[1];
			return Math.abs(p1 - p2) === 1 && (p1 > 0 || p2 > 0);
		})
		.slice(0, 5);
}

// PDF Analytics: Calculate match statistics
function calculateMatchStats(matches) {
	const completed = matches.filter(m => m.winner).length;
	const forfeits = matches.filter(m =>
		m.score === '0-0' || (m.score === '-' && m.winner)
	).length;

	return {
		total: matches.length,
		completed,
		forfeits
	};
}

// PDF Analytics: Calculate tournament duration
function calculateDuration(tournament) {
	if (!tournament.startedAt || !tournament.completedAt) return null;
	const start = new Date(tournament.startedAt);
	const end = new Date(tournament.completedAt);
	const diffMs = end - start;
	if (diffMs <= 0) return null;
	const hours = Math.floor(diffMs / 3600000);
	const minutes = Math.floor((diffMs % 3600000) / 60000);
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}

// System monitoring module
const systemMonitor = require('./system-monitor');

// Analytics database module
const analyticsDb = require('./analytics-db');

// Cache database module for API response caching
const cacheDb = require('./cache-db');

// AI Seeding service module
const aiSeedingService = require('./services/ai-seeding');

// Tournament Narrator service module
const tournamentNarratorService = require('./services/tournament-narrator');

// Configure web-push for push notifications
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@despairhardware.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
	webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
	console.log('[Push Notifications] VAPID keys configured');
} else {
	console.warn('[Push Notifications] VAPID keys not configured - push notifications disabled');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Emergency mode state
let emergencyModeState = {
	active: false,
	activatedAt: null,
	activatedBy: null,
	reason: null
};

// Match history for rollback (stores last N match changes per tournament)
const MAX_MATCH_HISTORY = 20;
const matchHistory = new Map(); // Map<tournamentId, Array<{matchId, previousState, action, timestamp, user}>>

/**
 * Record a match state change for potential rollback
 */
function recordMatchChange(tournamentId, matchId, previousState, action, user) {
	if (!matchHistory.has(tournamentId)) {
		matchHistory.set(tournamentId, []);
	}
	const history = matchHistory.get(tournamentId);
	history.unshift({
		matchId,
		previousState,
		action,
		timestamp: new Date().toISOString(),
		user: user || 'unknown'
	});
	// Keep only last N entries
	if (history.length > MAX_MATCH_HISTORY) {
		history.pop();
	}
}

// Create HTTP server and Socket.IO for real-time updates
const httpServer = http.createServer(app);

// CORS configuration - restrict origins for security
const getAllowedOrigins = () => {
	if (process.env.CORS_ALLOWED_ORIGINS) {
		return process.env.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim());
	}
	// Default allowed origins (production + local development)
	return [
		'https://admin.despairhardware.com',
		'http://localhost:3000',
		'http://127.0.0.1:3000'
	];
};

const io = new Server(httpServer, {
	cors: {
		origin: getAllowedOrigins(),
		methods: ['GET', 'POST'],
		credentials: true
	},
	pingTimeout: 60000,
	pingInterval: 25000
});

// WebSocket connection tracking
const wsConnections = {
	displays: new Map(),  // displayId -> socket
	clients: new Set()    // admin dashboard clients
};

// Display delivery status tracking for WebSocket ACK mechanism
// Tracks when each display last acknowledged receiving match data
const displayDeliveryStatus = {
	// Map of displayId -> { lastAckTime, lastUpdateHash, ackCount }
	status: new Map(),
	// How long to wait before falling back to HTTP (ms)
	httpFallbackDelayMs: 30000,  // 30 seconds
	// Last broadcast timestamp for fallback comparison
	lastBroadcastTime: null,
	lastBroadcastHash: null
};

// Track previous match state for delta updates
const previousMatchState = {
	tv1Match: null,      // Match object for TV 1 slot
	tv2Match: null,      // Match object for TV 2 slot
	upNextMatches: [],   // Array of up-next match IDs
	podium: null,        // Previous podium state
	lastHash: null       // Last broadcast hash
};

// Detect changes for a specific TV slot
function detectTvSlotChange(slotName, oldMatch, newMatch) {
	// No old match, this is a new assignment
	if (!oldMatch && newMatch) {
		return { type: 'MATCH_SWAP', match: newMatch };
	}

	// Had a match, now empty
	if (oldMatch && !newMatch) {
		return { type: 'MATCH_CLEARED', match: null };
	}

	// Both null - no change
	if (!oldMatch && !newMatch) {
		return null;
	}

	// Different match ID - full swap
	if (oldMatch.id !== newMatch.id) {
		return { type: 'MATCH_SWAP', match: newMatch };
	}

	// Same match - check for state changes
	if (oldMatch.state !== newMatch.state) {
		return { type: 'STATE_CHANGE', match: newMatch, oldState: oldMatch.state };
	}

	// Check for winner change (most important for visual feedback)
	if (oldMatch.winner_id !== newMatch.winner_id) {
		return { type: 'WINNER_DECLARED', match: newMatch };
	}

	// Check for underway change
	if (oldMatch.underway_at !== newMatch.underway_at) {
		return { type: 'UNDERWAY_CHANGE', match: newMatch };
	}

	// No meaningful change
	return null;
}

// Detect changes in up-next queue
function detectUpNextChanges(oldMatches, newMatches) {
	const changes = [];
	// Always generate changes for the 2-slot up-next queue
	const maxSlots = 2;

	for (let i = 0; i < maxSlots; i++) {
		const oldMatch = oldMatches[i] || null;
		const newMatch = newMatches[i] || null;

		// Both empty - no change
		if (!oldMatch && !newMatch) {
			changes.push({ index: i, type: 'NO_CHANGE', match: null });
			continue;
		}

		// New item added to empty slot
		if (!oldMatch && newMatch) {
			changes.push({ index: i, type: 'NEW_ITEM', match: newMatch });
		}
		// Item removed from slot
		else if (oldMatch && !newMatch) {
			changes.push({ index: i, type: 'ITEM_CHANGE', match: null });
		}
		// Different match now in this slot
		else if (oldMatch.id !== newMatch.id) {
			changes.push({ index: i, type: 'ITEM_CHANGE', match: newMatch });
		}
		// Same match, state changed (less visually important)
		else if (oldMatch.state !== newMatch.state) {
			changes.push({ index: i, type: 'ITEM_CHANGE', match: newMatch });
		}
		// No change
		else {
			changes.push({ index: i, type: 'NO_CHANGE', match: newMatch });
		}
	}

	// Only return if there are actual changes (not all NO_CHANGE)
	const hasChanges = changes.some(c => c.type !== 'NO_CHANGE');
	return hasChanges ? changes : null;
}

// Build delta payload by comparing old and new state
function buildDeltaPayload(oldState, newPayload, stations) {
	const tv1Name = 'TV 1';
	const tv2Name = 'TV 2';

	// Find current TV matches
	const matches = newPayload.matches || [];
	const tv1Match = matches.find(m => m.station_name === tv1Name && (m.state === 'open' || m.state === 'pending')) || null;
	const tv2Match = matches.find(m => m.station_name === tv2Name && (m.state === 'open' || m.state === 'pending')) || null;

	// Get up-next queue (matches without station, open state, sorted by play order)
	const upNextMatches = matches
		.filter(m => !m.station_name && m.state === 'open')
		.sort((a, b) => (a.suggested_play_order || 9999) - (b.suggested_play_order || 9999))
		.slice(0, 5);

	// Detect changes
	const changes = {
		tv1: detectTvSlotChange(tv1Name, oldState.tv1Match, tv1Match),
		tv2: detectTvSlotChange(tv2Name, oldState.tv2Match, tv2Match),
		upNext: detectUpNextChanges(oldState.upNextMatches, upNextMatches),
		podium: null
	};

	// Check podium change
	const newPodium = newPayload.podium || { isComplete: false };
	if (oldState.podium?.isComplete !== newPodium.isComplete) {
		changes.podium = newPodium;
	}

	// Determine if this is a meaningful change
	const hasChanges = changes.tv1 || changes.tv2 || changes.upNext || changes.podium;

	// Update previous state for next comparison
	previousMatchState.tv1Match = tv1Match;
	previousMatchState.tv2Match = tv2Match;
	previousMatchState.upNextMatches = upNextMatches;
	previousMatchState.podium = newPodium;

	return {
		type: hasChanges ? 'delta' : 'none',
		changes: hasChanges ? changes : null,
		// Always include full data for fallback
		fullPayload: newPayload
	};
}

// Check if HTTP fallback is needed based on ACK status
function needsHttpFallback() {
	// If no broadcast has been made yet, don't need fallback
	if (!displayDeliveryStatus.lastBroadcastTime) {
		return false;
	}

	const lastBroadcast = new Date(displayDeliveryStatus.lastBroadcastTime).getTime();
	const now = Date.now();
	const timeSinceBroadcast = now - lastBroadcast;

	// If within the fallback window, check for ACKs
	if (timeSinceBroadcast < displayDeliveryStatus.httpFallbackDelayMs) {
		// Check if any display has ACKed recently
		for (const [displayId, status] of displayDeliveryStatus.status.entries()) {
			if (status.lastAckTime) {
				const ackTime = new Date(status.lastAckTime).getTime();
				// ACK is valid if it's after the last broadcast
				if (ackTime >= lastBroadcast) {
					return false;  // Got an ACK, no fallback needed
				}
			}
		}
		// No ACKs yet but still within window - don't fallback yet
		return false;
	}

	// Past the fallback window with no valid ACKs
	return true;
}

// ============================================
// ACTIVITY FEED TYPES AND CATEGORIES
// ============================================

// Activity type constants for consistent action naming
const ACTIVITY_TYPES = {
	// Admin Actions
	ADMIN_LOGIN: 'admin_login',
	ADMIN_LOGOUT: 'admin_logout',
	SETTINGS_UPDATE: 'update_settings',
	USER_CREATE: 'user_create',
	USER_DELETE: 'user_delete',
	TOKEN_CREATE: 'token_created',
	TOKEN_REVOKE: 'token_revoked',

	// Tournament Events
	TOURNAMENT_CREATE: 'tournament_create',
	TOURNAMENT_START: 'tournament_start',
	TOURNAMENT_COMPLETE: 'tournament_complete',
	TOURNAMENT_RESET: 'tournament_reset',
	TOURNAMENT_DELETE: 'tournament_delete',

	// Participant Events
	PARTICIPANT_SIGNUP: 'participant_signup',
	PARTICIPANT_ADD: 'participant_add',
	PARTICIPANT_CHECKIN: 'participant_checkin',
	PARTICIPANT_CHECKOUT: 'participant_checkout',
	PARTICIPANT_DELETE: 'participant_delete',

	// Match Events
	MATCH_START: 'match_start',
	MATCH_COMPLETE: 'match_complete',
	MATCH_DQ: 'match_dq',
	MATCH_REOPEN: 'match_reopen',

	// Display Events
	DISPLAY_ONLINE: 'display_online',
	DISPLAY_OFFLINE: 'display_offline',
	DISPLAY_REBOOT: 'display_reboot',
	DISPLAY_SHUTDOWN: 'display_shutdown',

	// System Events
	DEV_MODE_ENABLED: 'dev_mode_enabled',
	DEV_MODE_DISABLED: 'dev_mode_disabled',
	RATE_MODE_CHANGE: 'rate_mode_change',
	GAME_CREATE: 'create_game',
	GAME_UPDATE: 'update_game',
	GAME_DELETE: 'delete_game'
};

// Category mappings for filtering
const ACTIVITY_CATEGORIES = {
	admin: ['admin_login', 'admin_logout', 'update_settings', 'user_create', 'user_delete', 'token_created', 'token_revoked'],
	tournament: ['tournament_create', 'tournament_start', 'tournament_complete', 'tournament_reset', 'tournament_delete'],
	participant: ['participant_signup', 'participant_add', 'participant_checkin', 'participant_checkout', 'participant_delete'],
	match: ['match_start', 'match_complete', 'match_dq', 'match_reopen'],
	display: ['display_online', 'display_offline', 'display_reboot', 'display_shutdown'],
	system: ['dev_mode_enabled', 'dev_mode_disabled', 'rate_mode_change', 'create_game', 'update_game', 'delete_game', 'quick_system_check', 'player_alias_added', 'rate_mode_override_set', 'rate_mode_override_cleared', 'clear_activity_log']
};

// Get category for an action
function getActivityCategory(action) {
	for (const [category, actions] of Object.entries(ACTIVITY_CATEGORIES)) {
		if (actions.includes(action)) return category;
	}
	return 'system';
}

// Trust proxy for rate limiter and secure cookies (required when behind Nginx Proxy Manager + Cloudflare)
// 'true' trusts all proxies in the chain (Cloudflare -> Nginx Proxy Manager -> Express)
app.set('trust proxy', true);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prevent caching of HTML pages and service worker (avoid stale CSP/JS issues)
app.use((req, res, next) => {
	if (req.path.endsWith('.html') || req.path === '/' || req.path === '/sw.js') {
		res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
		res.set('Pragma', 'no-cache');
		res.set('Expires', '0');
	}
	next();
});

// Security headers via helmet
app.use(helmet({
	contentSecurityPolicy: {
		directives: {
			defaultSrc: ["'self'"],
			scriptSrc: [
				"'self'",
				"'unsafe-inline'",
				"https://cdn.tailwindcss.com",          // Tailwind CSS CDN
				"https://cdn.socket.io",                // Socket.IO CDN
				"https://cdn.jsdelivr.net",             // SortableJS, ApexCharts
				"https://static.cloudflareinsights.com" // Cloudflare analytics
			],
			scriptSrcAttr: ["'unsafe-inline'"],        // Allow inline event handlers (onclick, etc.)
			styleSrc: ["'self'", "'unsafe-inline'"],   // Needed for Tailwind CSS
			imgSrc: ["'self'", "data:", "https:"],     // Allow data URIs and external images
			connectSrc: ["'self'", "wss:", "ws:", "https://cloudflareinsights.com", "https://static.cloudflareinsights.com", "https://cdn.socket.io", "https://cdn.tailwindcss.com"],  // WebSocket + Cloudflare + Socket.IO + Tailwind
			fontSrc: ["'self'"],
			frameSrc: ["https://challonge.com", "https://*.challonge.com"],  // Challonge iframe embed
			objectSrc: ["'none'"]
		}
	},
	crossOriginEmbedderPolicy: false,  // Allow Challonge iframe
	crossOriginResourcePolicy: { policy: "cross-origin" }  // Allow cross-origin resources
}));

// Load system settings to get session timeout
let sessionTimeout = 60 * 60 * 1000; // Default: 1 hour (secure default)
try {
	const SETTINGS_FILE = path.join(__dirname, 'system-settings.json');
	const settingsData = fsSync.readFileSync(SETTINGS_FILE, 'utf8');
	const systemSettings = JSON.parse(settingsData);
	if (systemSettings?.security?.sessionTimeout) {
		sessionTimeout = systemSettings.security.sessionTimeout;
	}
} catch (error) {
	console.log('Using default session timeout (1 hour)');
}

// Session configuration with file-based store (survives server restarts)
const sessionStore = new FileStore({
	path: path.join(__dirname, 'sessions'),
	ttl: sessionTimeout / 1000, // TTL in seconds
	retries: 0,
	reapInterval: 3600, // Clean expired sessions every hour
	logFn: () => {} // Suppress verbose logging
});

// Determine if request is over HTTPS (including through proxy)
const isSecureRequest = (req) => {
	return req.secure ||
		req.get('x-forwarded-proto') === 'https' ||
		req.get('cf-visitor')?.includes('https');  // Cloudflare specific
};

app.use(session({
	store: sessionStore,
	secret: secrets.getSessionSecret(),  // Secure: uses encrypted secrets or env var, no hardcoded fallback
	resave: false,
	saveUninitialized: false,
	rolling: true, // Reset cookie maxAge on every request (session won't expire if active)
	proxy: true,  // Trust the reverse proxy
	cookie: {
		// Don't set secure flag - let it be set dynamically
		// The cookie will work over HTTP (local dev) and HTTPS (production)
		secure: false,
		httpOnly: true,
		sameSite: 'lax', // Lax is fine for same-site navigation
		maxAge: sessionTimeout // Configurable from admin settings (Security section)
	}
}));

// Middleware to set secure cookie flag for HTTPS requests
app.use((req, res, next) => {
	if (isSecureRequest(req) && req.session && req.session.cookie) {
		req.session.cookie.secure = true;
	}
	next();
});

console.log(`Session timeout configured: ${sessionTimeout / 1000 / 60} minutes (rolling, file-store)`);

// CSRF Protection
const csrf = require('./csrf');
app.use(csrf.ensureToken);
app.use(csrf.validateToken);

// Rate limiting
// TEMPORARILY DISABLED - Skip function not working correctly
// TODO: Fix skip function or apply rate limiting more selectively
/*
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // limit each IP to 100 requests per windowMs
	skip: (req) => {
		// Skip rate limiting for monitoring endpoints (no limits at all)
		// These endpoints need unlimited access for auto-refresh and heartbeats
		return req.path.startsWith('/api/displays') ||
		       req.path.startsWith('/api/status');
	}
});

// Apply strict rate limiting to API endpoints (monitoring endpoints are skipped)
app.use('/api/', limiter);
*/

// ============================================
// AUTHENTICATION HELPERS
// ============================================

const USERS_FILE = path.join(__dirname, 'users.json');
const AUTH_DATA_FILE = path.join(__dirname, 'auth-data.json');
const SETTINGS_FILE = path.join(__dirname, 'system-settings.json');
const ACTIVITY_LOG_FILE = path.join(__dirname, 'activity-log.json');

// System settings cache (reloaded on demand)
let systemSettingsCache = null;
let systemSettingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 60000; // 1 minute

// Load system settings with caching
function loadSystemSettings() {
	const now = Date.now();
	if (systemSettingsCache && (now - systemSettingsCacheTime) < SETTINGS_CACHE_TTL) {
		return systemSettingsCache;
	}

	try {
		const data = fsSync.readFileSync(SETTINGS_FILE, 'utf8');
		systemSettingsCache = JSON.parse(data);
		systemSettingsCacheTime = now;
		return systemSettingsCache;
	} catch (error) {
		console.error('Error loading system settings:', error);
		return null;
	}
}

// Check if Challonge OAuth is connected
function isChallongeConnected() {
	return analyticsDb.isOAuthConnected('challonge');
}

// Get the legacy API key from environment (fallback when OAuth not connected)
function getLegacyApiKey() {
	return process.env.DEFAULT_CHALLONGE_KEY || null;
}

// Returns 'oauth-connected' if OAuth connected, otherwise the legacy API key
function getChallongeApiKey() {
	if (isChallongeConnected()) {
		return 'oauth-connected';
	}
	return getLegacyApiKey();
}

// ============================================
// CHALLONGE API RATE LIMITER (ADAPTIVE)
// ============================================

// Rate mode constants
const RATE_MODES = {
	IDLE: { name: 'IDLE', description: 'No upcoming tournaments' },
	UPCOMING: { name: 'UPCOMING', description: 'Tournament starting soon' },
	ACTIVE: { name: 'ACTIVE', description: 'Tournament underway' }
};

// Rate limiter state
const challongeRateLimiter = {
	lastRequestTime: 0,
	requestQueue: [],
	isProcessing: false
};

// Adaptive rate limiter state
const adaptiveRateState = {
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
const devModeState = {
	active: false,
	activatedAt: null,
	expiresAt: null,
	timeoutId: null
};

// Dev mode duration: 3 hours in milliseconds
const DEV_MODE_DURATION_MS = 3 * 60 * 60 * 1000;

// Check if dev mode is currently active
function isDevModeActive() {
	if (!devModeState.active) return false;

	// Check if expired
	if (devModeState.expiresAt && Date.now() > devModeState.expiresAt) {
		disableDevMode();
		return false;
	}

	return true;
}

// Enable dev mode for 3 hours
function enableDevMode() {
	const now = Date.now();

	devModeState.active = true;
	devModeState.activatedAt = new Date(now).toISOString();
	devModeState.expiresAt = now + DEV_MODE_DURATION_MS;

	// Clear any existing timeout
	if (devModeState.timeoutId) {
		clearTimeout(devModeState.timeoutId);
	}

	// Set timeout to auto-disable
	devModeState.timeoutId = setTimeout(() => {
		disableDevMode();
		console.log('[Dev Mode] Automatically disabled after 3 hours');
	}, DEV_MODE_DURATION_MS);

	console.log(`[Dev Mode] Enabled - expires at ${new Date(devModeState.expiresAt).toISOString()}`);

	// Log activity
	logActivity(0, 'System', 'dev_mode_enabled', {
		expiresAt: new Date(devModeState.expiresAt).toISOString()
	});

	// Start match polling (dev mode enables faster polling)
	setTimeout(() => {
		if (typeof updateMatchPolling === 'function') {
			updateMatchPolling();
		}
	}, 100);
}

// Disable dev mode
function disableDevMode() {
	if (devModeState.timeoutId) {
		clearTimeout(devModeState.timeoutId);
	}

	const wasActive = devModeState.active;

	devModeState.active = false;
	devModeState.activatedAt = null;
	devModeState.expiresAt = null;
	devModeState.timeoutId = null;

	if (wasActive) {
		console.log('[Dev Mode] Disabled');
		logActivity(0, 'System', 'dev_mode_disabled', {});

		// Update match polling (may stop if not in ACTIVE mode)
		setTimeout(() => {
			if (typeof updateMatchPolling === 'function') {
				updateMatchPolling();
			}
		}, 100);
	}
}

// Get remaining dev mode time in ms
function getDevModeRemainingMs() {
	if (!isDevModeActive()) return 0;
	return Math.max(0, devModeState.expiresAt - Date.now());
}

// Get adaptive rate limit settings
function getAdaptiveRateLimitSettings() {
	const settings = loadSystemSettings();
	return {
		enabled: settings?.challonge?.adaptiveRateLimit?.enabled ?? false,
		idleRate: settings?.challonge?.adaptiveRateLimit?.idleRate ?? 1,
		upcomingRate: settings?.challonge?.adaptiveRateLimit?.upcomingRate ?? 5,
		activeRate: settings?.challonge?.adaptiveRateLimit?.activeRate ?? 15,
		checkIntervalHours: settings?.challonge?.adaptiveRateLimit?.checkIntervalHours ?? 8,
		upcomingWindowHours: settings?.challonge?.adaptiveRateLimit?.upcomingWindowHours ?? 48,
		manualRateLimit: settings?.challonge?.rateLimit ?? 15
	};
}

// Get rate limit settings (requests per minute) - now adaptive
function getChallongeRateLimit() {
	const adaptiveSettings = getAdaptiveRateLimitSettings();

	if (!adaptiveSettings.enabled) {
		// Adaptive disabled - use manual setting
		return adaptiveSettings.manualRateLimit;
	}

	// Return effective rate (capped by manual setting)
	return Math.min(adaptiveRateState.effectiveRate, adaptiveSettings.manualRateLimit);
}

// Update rate mode based on tournament state
function updateRateMode(mode, tournament = null) {
	const adaptiveSettings = getAdaptiveRateLimitSettings();
	const previousMode = adaptiveRateState.currentMode;

	adaptiveRateState.currentMode = mode;

	// Set effective rate based on mode
	switch (mode.name) {
		case 'IDLE':
			adaptiveRateState.effectiveRate = adaptiveSettings.idleRate;
			adaptiveRateState.upcomingTournament = null;
			adaptiveRateState.activeTournament = null;
			break;
		case 'UPCOMING':
			adaptiveRateState.effectiveRate = adaptiveSettings.upcomingRate;
			adaptiveRateState.upcomingTournament = tournament;
			adaptiveRateState.activeTournament = null;
			break;
		case 'ACTIVE':
			adaptiveRateState.effectiveRate = adaptiveSettings.activeRate;
			adaptiveRateState.activeTournament = tournament;
			break;
	}

	// Cap by manual rate limit
	adaptiveRateState.effectiveRate = Math.min(
		adaptiveRateState.effectiveRate,
		adaptiveSettings.manualRateLimit
	);

	// Log mode change if different
	if (previousMode.name !== mode.name) {
		const tournamentInfo = tournament ? ` (${tournament.name})` : '';
		console.log(`[Adaptive Rate] Mode changed: ${previousMode.name} -> ${mode.name}${tournamentInfo}, effective rate: ${adaptiveRateState.effectiveRate} req/min`);

		// Log to activity log (async, don't await)
		logActivity(0, 'System', 'rate_mode_change', {
			previousMode: previousMode.name,
			newMode: mode.name,
			effectiveRate: adaptiveRateState.effectiveRate,
			tournament: tournament?.name || null
		});

		// Update match polling based on new mode (start/stop as needed)
		// Use setTimeout to ensure matchPollingState is initialized
		setTimeout(() => {
			if (typeof updateMatchPolling === 'function') {
				updateMatchPolling();
			}
		}, 100);
	}
}

// Check tournaments and update rate mode (called periodically)
async function checkTournamentsAndUpdateMode() {
	const adaptiveSettings = getAdaptiveRateLimitSettings();

	if (!adaptiveSettings.enabled) {
		return;
	}

	// If manual override is set, use that mode and skip tournament check
	if (adaptiveRateState.manualOverride) {
		console.log(`[Adaptive Rate] Manual override active: ${adaptiveRateState.manualOverride.name}`);
		updateRateMode(adaptiveRateState.manualOverride);
		adaptiveRateState.lastCheck = new Date().toISOString();
		return;
	}

	// Check if we have any way to authenticate (OAuth or legacy key)
	if (!isChallongeConnected() && !getLegacyApiKey()) {
		console.warn('[Adaptive Rate] No Challonge credentials available, skipping tournament check');
		return;
	}

	adaptiveRateState.lastCheck = new Date().toISOString();

	try {
		// Make a single API call to get tournaments using v2.1 (this call itself uses current rate limit)
		console.log('[Adaptive Rate] Checking tournaments via v2.1...');

		const headers = await getChallongeV2Headers();
		const response = await axios.get('https://api.challonge.com/v2.1/tournaments.json', {
			headers,
			timeout: 15000
		});

		const tournamentsData = response.data?.data || [];
		const now = new Date();
		const upcomingWindowMs = adaptiveSettings.upcomingWindowHours * 60 * 60 * 1000;
		const staleThresholdMs = 7 * 24 * 60 * 60 * 1000; // 7 days - ignore stale underway tournaments

		// Transform v2.1 data to internal format for processing
		const tournaments = tournamentsData.map(t => ({
			tournament: {
				id: parseInt(t.id),
				name: t.attributes.name,
				url: t.attributes.url,
				state: t.attributes.state,
				started_at: t.attributes.timestamps?.started_at,
				start_at: t.attributes.timestamps?.starts_at || t.attributes.starts_at
			}
		}));

		// Check for active (underway) tournaments first
		// Skip stale tournaments (underway for more than 7 days - likely abandoned)
		const activeTournament = tournaments.find(t => {
			if (t.tournament.state !== 'underway') return false;

			// Check if tournament is stale
			const startedAt = t.tournament.started_at;
			if (startedAt) {
				const startDate = new Date(startedAt);
				const age = now - startDate;
				if (age > staleThresholdMs) {
					console.log(`[Adaptive Rate] Skipping stale tournament: ${t.tournament.name} (started ${Math.round(age / (24 * 60 * 60 * 1000))} days ago)`);
					return false;
				}
			}
			return true;
		});

		if (activeTournament) {
			updateRateMode(RATE_MODES.ACTIVE, {
				name: activeTournament.tournament.name,
				id: activeTournament.tournament.url,
				state: activeTournament.tournament.state
			});
			return;
		}

		// Check for pending tournaments where start time has passed (should be ACTIVE)
		// This handles the case where tournament started but Challonge state hasn't updated to "underway" yet
		const startedButPending = tournaments.find(t => {
			if (t.tournament.state !== 'pending') return false;
			if (!t.tournament.start_at) return false;

			const startAt = new Date(t.tournament.start_at);
			const timeUntilStart = startAt - now;

			// Start time has passed (negative) but within reasonable window (last 12 hours)
			return timeUntilStart < 0 && timeUntilStart > -12 * 60 * 60 * 1000;
		});

		if (startedButPending) {
			console.log(`[Adaptive Rate] Tournament "${startedButPending.tournament.name}" start time has passed but still pending - treating as ACTIVE`);
			updateRateMode(RATE_MODES.ACTIVE, {
				name: startedButPending.tournament.name,
				id: startedButPending.tournament.url,
				state: 'pending (started)',
				note: 'Start time passed, awaiting Challonge state update'
			});
			return;
		}

		// Check for upcoming tournaments (pending with start_at within window)
		const upcomingTournament = tournaments.find(t => {
			if (t.tournament.state !== 'pending') return false;
			if (!t.tournament.start_at) return false;

			const startAt = new Date(t.tournament.start_at);
			const timeUntilStart = startAt - now;

			return timeUntilStart > 0 && timeUntilStart <= upcomingWindowMs;
		});

		if (upcomingTournament) {
			const startAt = new Date(upcomingTournament.tournament.start_at);
			const hoursUntil = Math.round((startAt - now) / (1000 * 60 * 60));

			updateRateMode(RATE_MODES.UPCOMING, {
				name: upcomingTournament.tournament.name,
				id: upcomingTournament.tournament.url,
				state: upcomingTournament.tournament.state,
				startAt: upcomingTournament.tournament.start_at,
				hoursUntil: hoursUntil
			});
			return;
		}

		// No active or upcoming tournaments - go to idle
		updateRateMode(RATE_MODES.IDLE);

	} catch (error) {
		console.error('[Adaptive Rate] Error checking tournaments:', error.message);
		// On error, don't change mode - keep current state
	}

	// Schedule next check
	const nextCheckTime = new Date(Date.now() + adaptiveSettings.checkIntervalHours * 60 * 60 * 1000);
	adaptiveRateState.nextCheck = nextCheckTime.toISOString();
}

// Start the adaptive rate scheduler
function startAdaptiveRateScheduler() {
	const adaptiveSettings = getAdaptiveRateLimitSettings();

	if (!adaptiveSettings.enabled) {
		console.log('[Adaptive Rate] Disabled - using manual rate limit');
		return;
	}

	// Clear existing interval if any
	if (adaptiveRateState.checkIntervalId) {
		clearInterval(adaptiveRateState.checkIntervalId);
	}

	const intervalMs = adaptiveSettings.checkIntervalHours * 60 * 60 * 1000;

	console.log(`[Adaptive Rate] Starting scheduler - checking every ${adaptiveSettings.checkIntervalHours} hours`);
	console.log(`[Adaptive Rate] Rates - Idle: ${adaptiveSettings.idleRate}, Upcoming: ${adaptiveSettings.upcomingRate}, Active: ${adaptiveSettings.activeRate} req/min`);
	console.log(`[Adaptive Rate] Manual cap: ${adaptiveSettings.manualRateLimit} req/min`);

	// Run initial check after a short delay (let server start first)
	setTimeout(() => {
		checkTournamentsAndUpdateMode();
	}, 5000);

	// Schedule periodic checks
	adaptiveRateState.checkIntervalId = setInterval(() => {
		checkTournamentsAndUpdateMode();
	}, intervalMs);

	// Calculate next check time
	const nextCheckTime = new Date(Date.now() + intervalMs);
	adaptiveRateState.nextCheck = nextCheckTime.toISOString();
}

// ============================================
// MATCH POLLING SCHEDULER (Centralized)
// ============================================
// Polls Challonge for matches and pushes to MagicMirror when in ACTIVE mode or dev mode

const matchPollingState = {
	intervalId: null,
	isPolling: false,
	lastPollTime: null,
	pollIntervalMs: 15000,  // 15 seconds default
	devModePollIntervalMs: 5000  // 5 seconds in dev mode
};

// ============================================
// SERVER-SIDE DQ TIMER MANAGEMENT
// ============================================
// Tracks active DQ timers for auto-DQ functionality
// Key: "tournamentId:matchId:tv", Value: timer object
const activeDQTimers = new Map();

// Get DQ timer settings from system settings
function getDQTimerSettings() {
	const settings = loadSystemSettings();
	return settings.dqTimer || {
		autoDqEnabled: false,
		autoDqAction: 'notify',  // 'auto-dq' or 'notify'
		defaultDuration: 180,
		warningThreshold: 30
	};
}

// Start a server-side DQ timer with auto-DQ capability
function startServerDQTimer(tournamentId, matchId, tv, duration, playerId, playerName) {
	const key = `${tournamentId}:${matchId}:${tv}`;

	// Clear existing timer if any
	if (activeDQTimers.has(key)) {
		clearTimeout(activeDQTimers.get(key).timeoutId);
		activeDQTimers.delete(key);
	}

	const settings = getDQTimerSettings();
	const warningThreshold = settings.warningThreshold || 30;

	// Create timer object
	const timer = {
		key,
		tournamentId,
		matchId,
		tv,
		playerId,
		playerName,
		duration,
		startTime: new Date(),
		expiresAt: new Date(Date.now() + duration * 1000),
		warningTimeoutId: null,
		timeoutId: null
	};

	// Set warning timeout (30 seconds before expiry)
	if (duration > warningThreshold) {
		timer.warningTimeoutId = setTimeout(() => {
			io.emit('timer:dq:warning', {
				key,
				tv,
				matchId,
				playerName,
				secondsRemaining: warningThreshold
			});
		}, (duration - warningThreshold) * 1000);
	}

	// Set expiry timeout
	timer.timeoutId = setTimeout(() => {
		handleDQTimerExpiry(key);
	}, duration * 1000);

	activeDQTimers.set(key, timer);

	// Broadcast timer started
	io.emit('timer:dq:started', {
		key,
		tournamentId,
		matchId,
		tv,
		playerId,
		playerName,
		duration,
		startTime: timer.startTime.toISOString(),
		expiresAt: timer.expiresAt.toISOString()
	});

	console.log(`[DQ Timer] Started: ${key} (${playerName || 'unknown'}) - ${duration}s`);
	return timer;
}

// Handle DQ timer expiry
async function handleDQTimerExpiry(key) {
	const timer = activeDQTimers.get(key);
	if (!timer) return;

	const settings = getDQTimerSettings();
	const autoDqAction = settings.autoDqAction || 'notify';

	console.log(`[DQ Timer] Expired: ${key} - Action: ${autoDqAction}`);

	// Send push notification for DQ timer expiry
	broadcastPushNotification('dq_timer_expired', {
		title: 'DQ Timer Expired',
		body: `${timer.playerName || 'Player'} - ${timer.tv || 'Unknown TV'}`,
		data: {
			type: 'dq_timer_expired',
			tv: timer.tv,
			matchId: timer.matchId,
			playerId: timer.playerId,
			playerName: timer.playerName,
			action: autoDqAction
		}
	}).catch(err => console.error('[Push] DQ timer notification error:', err.message));

	if (autoDqAction === 'auto-dq' && timer.playerId && timer.matchId) {
		// Auto-DQ the player
		try {
			await performAutoDQ(timer);
			logActivity(0, 'System', 'auto_dq_executed', {
				tournamentId: timer.tournamentId,
				matchId: timer.matchId,
				tv: timer.tv,
				playerId: timer.playerId,
				playerName: timer.playerName
			});
		} catch (error) {
			console.error(`[DQ Timer] Auto-DQ failed:`, error.message);
			io.emit('timer:dq:error', { key, error: error.message });
		}
	} else {
		// Just notify - no auto-DQ
		io.emit('timer:dq:expired', {
			key,
			tv: timer.tv,
			matchId: timer.matchId,
			playerName: timer.playerName,
			action: 'notify'
		});
	}

	// Clean up
	if (timer.warningTimeoutId) clearTimeout(timer.warningTimeoutId);
	activeDQTimers.delete(key);
}

// Perform auto-DQ on a player
async function performAutoDQ(timer) {
	const { tournamentId, matchId, playerId } = timer;

	// Get match details to find winner (the other player)
	const matchResponse = await challongeV2Request('GET', `/tournaments/${tournamentId}/matches/${matchId}.json`);
	const matchData = matchResponse.data?.data;
	const relationships = matchData?.relationships;

	let player1Id = relationships?.player1?.data?.id;
	let player2Id = relationships?.player2?.data?.id;

	if (!player1Id || !player2Id) {
		throw new Error('Could not determine player IDs');
	}

	// The winner is the player who is NOT being DQ'd
	const winnerId = String(playerId) === String(player1Id) ? player2Id : player1Id;
	const loserId = playerId;

	// Use DQ endpoint to forfeit the player
	const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}.json`, {
		data: {
			type: 'Match',
			attributes: {
				match: [
					{ participant_id: String(winnerId), score_set: '0', rank: 1, advancing: true },
					{ participant_id: String(loserId), score_set: '0', rank: 2, advancing: false, forfeited: true }
				]
			}
		}
	});

	// Emit success event
	io.emit('timer:dq:executed', {
		key: timer.key,
		tournamentId,
		matchId,
		winnerId,
		loserId,
		playerName: timer.playerName
	});

	// Invalidate cache and push updates
	cacheDb.invalidateCache('matches', tournamentId);
	await fetchAndPushMatches(tournamentId);

	console.log(`[DQ Timer] Auto-DQ executed for ${timer.playerName} in match ${matchId}`);
}

// Cancel a DQ timer
function cancelDQTimer(key) {
	const timer = activeDQTimers.get(key);
	if (timer) {
		if (timer.timeoutId) clearTimeout(timer.timeoutId);
		if (timer.warningTimeoutId) clearTimeout(timer.warningTimeoutId);
		activeDQTimers.delete(key);

		io.emit('timer:dq:cancelled', { key, tv: timer.tv });
		console.log(`[DQ Timer] Cancelled: ${key}`);
		return true;
	}
	return false;
}

// Get all active DQ timers
function getActiveDQTimers() {
	const timers = [];
	const now = Date.now();

	activeDQTimers.forEach((timer, key) => {
		const secondsRemaining = Math.max(0, Math.floor((timer.expiresAt.getTime() - now) / 1000));
		timers.push({
			key,
			tournamentId: timer.tournamentId,
			matchId: timer.matchId,
			tv: timer.tv,
			playerId: timer.playerId,
			playerName: timer.playerName,
			duration: timer.duration,
			secondsRemaining,
			startTime: timer.startTime.toISOString(),
			expiresAt: timer.expiresAt.toISOString()
		});
	});

	return timers;
}

// Local underway tracking - used when Challonge v2.1 change_state endpoint fails
// Key: "tournamentId:matchId", Value: ISO timestamp
const localUnderwayTracking = new Map();

// ============================================
// MATCH DATA CACHE (Hybrid Caching - Admin Side)
// ============================================
// Caches Challonge match data to provide resilience during API outages
const matchDataCache = {
	data: null,           // Cached match payload (matches, podium, stations, participants)
	timestamp: null,      // When the cache was last updated
	tournamentId: null,   // Which tournament the cache is for
	staleThresholdMs: 60000  // Data considered stale after 60 seconds
};

const MATCH_CACHE_FILE = path.join(__dirname, 'cache', 'match-data-cache.json');

// Ensure cache directory exists
function ensureCacheDirectory() {
	const cacheDir = path.join(__dirname, 'cache');
	if (!fsSync.existsSync(cacheDir)) {
		fsSync.mkdirSync(cacheDir, { recursive: true });
	}
}

// Save match data to cache (both memory and file)
function saveMatchDataCache(tournamentId, payload) {
	const cacheEntry = {
		data: payload,
		timestamp: new Date().toISOString(),
		tournamentId: tournamentId
	};

	matchDataCache.data = payload;
	matchDataCache.timestamp = cacheEntry.timestamp;
	matchDataCache.tournamentId = tournamentId;

	// Persist to file for restart resilience
	try {
		ensureCacheDirectory();
		fsSync.writeFileSync(MATCH_CACHE_FILE, JSON.stringify(cacheEntry, null, 2));
		console.log('[Match Cache] Saved to file:', MATCH_CACHE_FILE);
	} catch (error) {
		console.warn('[Match Cache] Failed to save cache file:', error.message);
	}
}

// Load match data cache from file (on server startup)
function loadMatchDataCache() {
	try {
		if (fsSync.existsSync(MATCH_CACHE_FILE)) {
			const data = fsSync.readFileSync(MATCH_CACHE_FILE, 'utf8');
			const cacheEntry = JSON.parse(data);
			matchDataCache.data = cacheEntry.data;
			matchDataCache.timestamp = cacheEntry.timestamp;
			matchDataCache.tournamentId = cacheEntry.tournamentId;
			console.log('[Match Cache] Loaded from file, timestamp:', cacheEntry.timestamp);
			return true;
		}
	} catch (error) {
		console.warn('[Match Cache] Failed to load cache file:', error.message);
	}
	return false;
}

// Get cached match data with staleness info
function getMatchDataCache(tournamentId) {
	if (!matchDataCache.data || matchDataCache.tournamentId !== tournamentId) {
		return null;
	}

	const now = Date.now();
	const cacheTime = new Date(matchDataCache.timestamp).getTime();
	const ageMs = now - cacheTime;
	const isStale = ageMs > matchDataCache.staleThresholdMs;

	return {
		...matchDataCache.data,
		cacheTimestamp: matchDataCache.timestamp,
		cacheAgeMs: ageMs,
		isStale: isStale
	};
}

// Initialize cache on startup
loadMatchDataCache();

// Check if match polling should be active
function shouldPollMatches() {
	// Poll if in ACTIVE mode or dev mode is enabled
	return adaptiveRateState.currentMode.name === 'ACTIVE' || isDevModeActive();
}

// Get the current poll interval based on mode
function getMatchPollInterval() {
	if (isDevModeActive()) {
		return matchPollingState.devModePollIntervalMs;
	}
	return matchPollingState.pollIntervalMs;
}

// Find the next suggested match to play (for auto-advance feature)
function findNextSuggestedMatch(matches, assignedStations = []) {
	// Filter open matches that are not underway and have both players
	const openMatches = matches.filter(m =>
		m.state === 'open' &&
		!m.underway_at &&
		m.player1_id &&
		m.player2_id
	);

	if (openMatches.length === 0) return null;

	// Sort by suggested play order
	openMatches.sort((a, b) =>
		(a.suggested_play_order || 9999) - (b.suggested_play_order || 9999)
	);

	// If we have stations, prefer matches that can be assigned to available stations
	const usedStations = new Set(assignedStations);
	const availableMatch = openMatches.find(m => {
		// For simplicity, return first match in play order
		// More sophisticated: check if station is available
		return true;
	});

	return availableMatch || openMatches[0];
}

// Fetch matches from Challonge and push to MagicMirror
async function fetchAndPushMatches() {
	// Get tournament info from state file
	const stateFile = process.env.MATCH_STATE_FILE || '/root/tournament-control-center/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json';

	let tournamentState;
	try {
		const data = fsSync.readFileSync(stateFile, 'utf8');
		tournamentState = JSON.parse(data);
	} catch (error) {
		console.error('[Match Polling] Error reading tournament state:', error.message);
		return;
	}

	if (!tournamentState || !tournamentState.tournamentId) {
		console.log('[Match Polling] No tournament configured - skipping');
		return;
	}

	const { tournamentId } = tournamentState;

	try {
		console.log('[Match Polling] Fetching matches for tournament:', tournamentId);

		// Get auth headers (OAuth or legacy key)
		let headers;
		try {
			headers = await getChallongeV2Headers();
		} catch (authError) {
			console.error('[Match Polling] No Challonge credentials available:', authError.message);
			return;
		}

		// Fetch participants first (for name mapping)
		let participantsCache = {};
		try {
			const participantsResponse = await rateLimitedAxios.get(
				`https://api.challonge.com/v2.1/tournaments/${tournamentId}/participants.json`,
				{
					headers,
					timeout: 15000
				}
			);

			const participantsData = participantsResponse.data.data || [];
			participantsData.forEach(item => {
				if (item.type === 'participant') {
					const attrs = item.attributes || {};
					const name = attrs.name || attrs.display_name || attrs.username ||
						(attrs.seed != null ? 'Seed ' + attrs.seed : 'Player ' + item.id);
					participantsCache[String(item.id)] = name;
				}
			});
		} catch (participantError) {
			console.warn('[Match Polling] Could not fetch participants:', participantError.message);
		}

		// Fetch matches
		const matchesResponse = await rateLimitedAxios.get(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}/matches.json?include=participants,stations`,
			{
				headers,
				timeout: 15000
			}
		);

		const data = matchesResponse.data.data || [];
		const included = matchesResponse.data.included || [];

		// Build participant map from included array
		const participantMap = { ...participantsCache };
		included.forEach(item => {
			if (item.type === 'participant') {
				const attrs = item.attributes || {};
				const name = attrs.name || attrs.display_name || attrs.username ||
					(attrs.seed != null ? 'Seed ' + attrs.seed : 'Player ' + item.id);
				participantMap[String(item.id)] = name;
			}
		});

		// Fetch stations SEPARATELY - Challonge stores match assignments on station objects, not matches
		// This is the same approach as GET /api/matches which works correctly
		let stationMap = {};       // stationId -> stationName
		let matchStationMap = {};  // matchId -> stationName (direct lookup for display)
		try {
			const stationHeaders = getStationsApiHeaders();
			const stationsResponse = await rateLimitedAxios.get(
				`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations.json`,
				{ headers: stationHeaders, timeout: 10000 }
			);

			if (stationsResponse.data?.data) {
				stationsResponse.data.data.forEach(station => {
					const stationId = String(station.id);
					const stationName = station.attributes?.name || 'Station ' + station.id;
					stationMap[stationId] = stationName;

					// Build reverse mapping: matchId -> stationName
					// Station stores which match it's assigned to in relationships.match.data
					const matchData = station.relationships?.match?.data;
					if (matchData?.id) {
						matchStationMap[String(matchData.id)] = stationName;
					}
				});
			}
			console.log('[Match Polling] Stations: ' + Object.keys(stationMap).length +
				' configured (' + Object.keys(stationMap).map(id => stationMap[id]).join(', ') + '), ' +
				Object.keys(matchStationMap).length + ' assigned to matches');
		} catch (stationError) {
			console.warn('[Match Polling] Could not fetch stations:', stationError.message);
		}

		// Available stations from stationMap (all configured stations)
		const availableStations = new Set(Object.values(stationMap));

		// Simplify matches for MagicMirror
		const simplified = data.map(match => {
			const attrs = match.attributes || {};
			const rel = match.relationships || {};

			let p1Id = null;
			let p2Id = null;

			if (Array.isArray(attrs.points_by_participant) && attrs.points_by_participant.length >= 2) {
				p1Id = attrs.points_by_participant[0].participant_id;
				p2Id = attrs.points_by_participant[1].participant_id;
			}

			const p1Key = p1Id != null ? String(p1Id) : null;
			const p2Key = p2Id != null ? String(p2Id) : null;

			const p1Name = p1Key && participantMap[p1Key] ? participantMap[p1Key] :
				p1Id != null ? 'Player ' + p1Id : 'TBD';
			const p2Name = p2Key && participantMap[p2Key] ? participantMap[p2Key] :
				p2Id != null ? 'Player ' + p2Id : 'TBD';

			// Use matchStationMap for direct lookup (built from station -> match relationship)
			const stationName = matchStationMap[String(match.id)] || null;

			// Check for local underway tracking (when Challonge v2.1 change_state is broken)
			const trackingKey = `${tournamentId}:${match.id}`;
			const localUnderwayAt = localUnderwayTracking.get(trackingKey);
			const challongeUnderwayAt = (attrs.timestamps && attrs.timestamps.underway_at) || null;

			// Use local tracking if available and Challonge doesn't have underway_at
			const effectiveUnderwayAt = challongeUnderwayAt || localUnderwayAt || null;

			return {
				id: match.id,
				state: attrs.state,
				round: attrs.round,
				identifier: attrs.identifier,
				suggested_play_order: attrs.suggested_play_order != null ? attrs.suggested_play_order : 9999,
				player1_id: p1Id,
				player2_id: p2Id,
				player1_name: p1Name,
				player2_name: p2Name,
				station_name: stationName,
				underway_at: effectiveUnderwayAt,
				winner_id: attrs.winner_id || null,
				local_tracking: localUnderwayAt && !challongeUnderwayAt ? true : undefined
			};
		});

		// Check if tournament is complete for podium
		const has3rdPlaceMatch = data.some(m => (m.attributes || {}).identifier === '3P');
		let podium = { isComplete: false, first: null, second: null, third: null, has3rdPlace: has3rdPlaceMatch };

		if (data.length > 0 && data.every(m => (m.attributes || {}).state === 'complete')) {
			// Find finals match
			let finalsMatch = null;
			data.forEach(m => {
				const a = m.attributes || {};
				if (typeof a.round === 'number' && a.round > 0 && a.identifier !== '3P') {
					if (!finalsMatch || a.round > (finalsMatch.attributes.round || 0)) {
						finalsMatch = m;
					}
				}
			});

			if (finalsMatch) {
				const fa = finalsMatch.attributes || {};
				const winnerId = fa.winner_id;
				let secondId = null;

				const fPoints = fa.points_by_participant || [];
				fPoints.forEach(p => {
					if (p.participant_id != null && p.participant_id !== winnerId) {
						secondId = p.participant_id;
					}
				});

				const thirdMatch = data.find(m => (m.attributes || {}).identifier === '3P' && (m.attributes || {}).state === 'complete');
				const thirdId = thirdMatch && (thirdMatch.attributes || {}).winner_id;

				const nameForId = id => {
					if (!id) return null;
					return participantMap[String(id)] || 'Player ' + id;
				};

				podium = {
					isComplete: true,
					first: nameForId(winnerId),
					second: nameForId(secondId),
					third: thirdId ? nameForId(thirdId) : null,
					has3rdPlace: has3rdPlaceMatch
				};
			}
		}

		// Build payload for push and cache
		const pushTimestamp = new Date().toISOString();

		// Calculate match statistics for metadata
		const completedCount = simplified.filter(m => m.state === 'complete').length;
		const underwayCount = simplified.filter(m => m.state === 'open' && m.underway_at).length;
		const openCount = simplified.filter(m => m.state === 'open' && !m.underway_at).length;
		const totalCount = simplified.length;

		// Find next suggested match using assigned stations
		const assignedStations = Object.keys(matchStationMap);
		const nextMatch = findNextSuggestedMatch(simplified, assignedStations);

		const payload = {
			tournamentId: tournamentId,  // Include tournament ID for admin clients
			matches: simplified,
			podium: podium,
			availableStations: Array.from(availableStations),
			participantsCache: participantsCache,
			timestamp: pushTimestamp,
			source: 'live',  // Indicates fresh data from Challonge
			metadata: {
				nextMatchId: nextMatch?.id || null,
				nextMatchPlayers: nextMatch ? {
					player1: nextMatch.player1_name,
					player2: nextMatch.player2_name
				} : null,
				completedCount,
				underwayCount,
				openCount,
				totalCount,
				progressPercent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
			}
		};

		// Compute hash for deduplication and ACK tracking
		const payloadHash = require('crypto')
			.createHash('md5')
			.update(JSON.stringify({ matches: simplified, podium: podium }))
			.digest('hex');

		// Save to cache before pushing (ensures cache is available even if push fails)
		saveMatchDataCache(tournamentId, payload);

		// Check if any displays are connected via WebSocket
		const displayCount = wsConnections.displays.size;
		const hasConnectedDisplays = displayCount > 0;

		// Broadcast via WebSocket to all connected displays (real-time)
		broadcastMatchData(payload, payloadHash);

		// HTTP fallback logic - only push via HTTP if:
		// 1. No displays connected via WebSocket, OR
		// 2. No ACK received from any display within fallback window
		const shouldHttpFallback = !hasConnectedDisplays || needsHttpFallback();

		if (shouldHttpFallback) {
			const matchApiUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
			try {
				await axios.post(`${matchApiUrl}/api/matches/push`, payload, { timeout: 5000 });
				console.log(`[Match Polling] HTTP fallback push (${hasConnectedDisplays ? 'no ACK received' : 'no WS displays'})`);
			} catch (httpError) {
				console.warn(`[Match Polling] HTTP fallback failed: ${httpError.message}`);
			}
		} else {
			console.log(`[Match Polling] WebSocket delivery confirmed, skipping HTTP push`);
		}

		matchPollingState.lastPollTime = pushTimestamp;
		console.log(`[Match Polling] Pushed ${simplified.length} matches (WS: ${displayCount} displays${shouldHttpFallback ? ', HTTP fallback' : ''})`);

	} catch (error) {
		console.error('[Match Polling] Error:', error.message);

		// If Challonge fetch failed, try to push cached data with stale indicator
		const cachedData = getMatchDataCache(tournamentState?.tournamentId);
		if (cachedData && cachedData.data) {
			try {
				const matchApiUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
				await axios.post(`${matchApiUrl}/api/matches/push`, {
					...cachedData.data,
					timestamp: cachedData.cacheTimestamp,
					source: 'cache',
					isStale: true,
					cacheAgeMs: cachedData.cacheAgeMs
				}, { timeout: 5000 });
				console.log('[Match Polling] Pushed cached data (stale) to MagicMirror');
			} catch (pushError) {
				console.error('[Match Polling] Failed to push cached data:', pushError.message);
			}
		}
	}
}

// Start match polling
function startMatchPolling() {
	if (matchPollingState.intervalId) {
		clearInterval(matchPollingState.intervalId);
		matchPollingState.intervalId = null;
	}

	if (!shouldPollMatches()) {
		console.log('[Match Polling] Not active - mode is not ACTIVE and dev mode is off');
		matchPollingState.isPolling = false;
		return;
	}

	const interval = getMatchPollInterval();
	console.log(`[Match Polling] Starting - polling every ${interval / 1000} seconds`);

	matchPollingState.isPolling = true;

	// Poll immediately
	fetchAndPushMatches();

	// Then at interval
	matchPollingState.intervalId = setInterval(() => {
		if (shouldPollMatches()) {
			fetchAndPushMatches();
		} else {
			stopMatchPolling();
		}
	}, interval);
}

// Stop match polling
function stopMatchPolling() {
	if (matchPollingState.intervalId) {
		clearInterval(matchPollingState.intervalId);
		matchPollingState.intervalId = null;
	}
	matchPollingState.isPolling = false;
	console.log('[Match Polling] Stopped');
}

// Update match polling based on rate mode changes
function updateMatchPolling() {
	if (shouldPollMatches()) {
		// Restart with potentially different interval
		if (!matchPollingState.isPolling) {
			startMatchPolling();
		} else {
			// Check if interval needs to change (dev mode toggle)
			const currentInterval = getMatchPollInterval();
			// Restart to apply new interval
			stopMatchPolling();
			startMatchPolling();
		}
	} else {
		stopMatchPolling();
	}
}

// Get current rate limit status (for API/dashboard)
function getRateLimitStatus() {
	const adaptiveSettings = getAdaptiveRateLimitSettings();
	const devModeActive = isDevModeActive();

	return {
		adaptiveEnabled: adaptiveSettings.enabled,
		currentMode: adaptiveRateState.currentMode.name,
		modeDescription: adaptiveRateState.currentMode.description,
		effectiveRate: devModeActive ? 'unlimited' : getChallongeRateLimit(),
		manualRateLimit: adaptiveSettings.manualRateLimit,
		manualOverride: adaptiveRateState.manualOverride ? adaptiveRateState.manualOverride.name : null,
		settings: {
			idleRate: adaptiveSettings.idleRate,
			upcomingRate: adaptiveSettings.upcomingRate,
			activeRate: adaptiveSettings.activeRate,
			checkIntervalHours: adaptiveSettings.checkIntervalHours,
			upcomingWindowHours: adaptiveSettings.upcomingWindowHours
		},
		upcomingTournament: adaptiveRateState.upcomingTournament,
		activeTournament: adaptiveRateState.activeTournament,
		lastCheck: adaptiveRateState.lastCheck,
		nextCheck: adaptiveRateState.nextCheck,
		devModeActive: devModeActive,
		devModeExpiresAt: devModeActive ? new Date(devModeState.expiresAt).toISOString() : null,
		devModeRemainingMs: getDevModeRemainingMs(),
		matchPolling: {
			active: matchPollingState.isPolling,
			intervalMs: getMatchPollInterval(),
			lastPollTime: matchPollingState.lastPollTime
		}
	};
}

// Calculate minimum delay between requests in ms
function getMinRequestDelay() {
	// Dev mode bypasses rate limiting
	if (isDevModeActive()) {
		return 0;
	}

	const requestsPerMinute = getChallongeRateLimit();
	// Convert to ms delay between requests (60000ms / requests)
	return Math.ceil(60000 / requestsPerMinute);
}

// Rate-limited request executor
async function executeRateLimitedRequest(requestFn) {
	return new Promise((resolve, reject) => {
		challongeRateLimiter.requestQueue.push({ requestFn, resolve, reject });
		processRequestQueue();
	});
}

// Process queued requests with rate limiting
async function processRequestQueue() {
	if (challongeRateLimiter.isProcessing || challongeRateLimiter.requestQueue.length === 0) {
		return;
	}

	challongeRateLimiter.isProcessing = true;

	while (challongeRateLimiter.requestQueue.length > 0) {
		const now = Date.now();
		const minDelay = getMinRequestDelay();
		const timeSinceLastRequest = now - challongeRateLimiter.lastRequestTime;
		const waitTime = Math.max(0, minDelay - timeSinceLastRequest);

		const queueLength = challongeRateLimiter.requestQueue.length;
		if (waitTime > 0) {
			console.log(`[Rate Limiter] Waiting ${waitTime}ms before next request (queue: ${queueLength}, rate: ${getChallongeRateLimit()} req/min)`);
			await new Promise(r => setTimeout(r, waitTime));
		} else {
			console.log(`[Rate Limiter] Processing request (queue: ${queueLength}, no delay needed)`);
		}

		const { requestFn, resolve, reject } = challongeRateLimiter.requestQueue.shift();
		challongeRateLimiter.lastRequestTime = Date.now();

		try {
			const result = await requestFn();
			resolve(result);
		} catch (error) {
			// Check for Cloudflare rate limit (429 or 403 with specific markers)
			if (error.response?.status === 429 ||
				(error.response?.status === 403 && error.response?.data?.toString()?.includes('cloudflare'))) {
				console.warn('Challonge rate limit hit, adding extra delay...');
				// Add extra delay and retry once
				await new Promise(r => setTimeout(r, 5000));
				try {
					challongeRateLimiter.lastRequestTime = Date.now();
					const retryResult = await requestFn();
					resolve(retryResult);
				} catch (retryError) {
					reject(retryError);
				}
			} else {
				reject(error);
			}
		}
	}

	challongeRateLimiter.isProcessing = false;
}

// ============================================
// CHALLONGE API v2.1 HELPERS
// ============================================

// Get v2.1 API headers - uses OAuth Bearer token if connected, falls back to legacy v1 auth
async function getChallongeV2Headers() {
	// Try OAuth first if connected
	if (isChallongeConnected()) {
		try {
			const accessToken = await ensureValidToken();
			return {
				'Authorization': `Bearer ${accessToken}`,
				'Authorization-Type': 'v2',  // Required for OAuth Bearer tokens
				'Content-Type': 'application/vnd.api+json',
				'Accept': 'application/json'
			};
		} catch (error) {
			console.warn('[Challonge API] OAuth token error, trying legacy key:', error.message);
		}
	}

	// Fall back to legacy API key
	const legacyKey = getLegacyApiKey();
	if (!legacyKey) {
		throw new Error('Challonge not connected. Please connect your account in Settings or configure a legacy API key.');
	}

	return {
		'Authorization': legacyKey,
		'Authorization-Type': 'v1',
		'Content-Type': 'application/vnd.api+json',
		'Accept': 'application/json'
	};
}

// Get headers for stations API - always uses legacy key (Challonge doesn't support OAuth scopes for stations)
function getStationsApiHeaders() {
	const legacyKey = getLegacyApiKey();
	if (!legacyKey) {
		throw new Error('Challonge legacy API key required for stations. Please configure DEFAULT_CHALLONGE_KEY in .env');
	}
	return {
		'Authorization': legacyKey,
		'Authorization-Type': 'v1',
		'Content-Type': 'application/vnd.api+json',
		'Accept': 'application/json'
	};
}

// Make a v2.1 API request (rate-limited) with OAuth 401 fallback to legacy key
async function challongeV2Request(method, endpoint, data = null) {
	return executeRateLimitedRequest(async () => {
		const url = `https://api.challonge.com/v2.1${endpoint}`;

		// Try OAuth first if connected
		if (isChallongeConnected()) {
			try {
				const oauthHeaders = await getChallongeV2Headers();
				const config = {
					method,
					url,
					headers: oauthHeaders,
					timeout: 15000
				};

				if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
					config.data = data;
				}

				return await axios(config);
			} catch (error) {
				// If OAuth returns 401 or 404, fall back to legacy key
				// 401 = token invalid, 404 = tournament might belong to different account
				if (error.response?.status === 401) {
					console.warn('[Challonge API] OAuth token rejected (401), clearing token and trying legacy key');
					analyticsDb.deleteOAuthTokens('challonge');
				} else if (error.response?.status === 404) {
					console.warn('[Challonge API] OAuth returned 404, trying legacy key (tournament may belong to different account)');
					// Fall through to legacy key
				} else {
					throw error; // Re-throw other errors
				}
			}
		}

		// Fall back to legacy API key
		const legacyKey = getLegacyApiKey();
		if (!legacyKey) {
			throw new Error('Challonge not connected. Please connect your account in Settings or configure a legacy API key.');
		}

		const legacyHeaders = {
			'Authorization': legacyKey,
			'Authorization-Type': 'v1',
			'Content-Type': 'application/vnd.api+json',
			'Accept': 'application/json'
		};

		const config = {
			method,
			url,
			headers: legacyHeaders,
			timeout: 15000
		};

		if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
			config.data = data;
		}

		return axios(config);
	});
}

// Make a v1 API request (rate-limited) - uses OAuth Bearer if connected, falls back to legacy
// Automatically clears OAuth token and retries with legacy key if OAuth returns 401
async function challongeV1Request(method, url, config = {}) {
	return executeRateLimitedRequest(async () => {
		// Try OAuth first if connected
		if (isChallongeConnected()) {
			try {
				const accessToken = await ensureValidToken();
				const oauthHeaders = {
					'Authorization': `Bearer ${accessToken}`,
					'Authorization-Type': 'v2',  // Required for OAuth Bearer tokens
					'Content-Type': 'application/json'
				};

				return await axios({
					method,
					url,
					timeout: 15000,
					...config,
					headers: {
						...config.headers,
						...oauthHeaders
					}
				});
			} catch (error) {
				// If OAuth returns 401, token is invalid - clear it and fall back to legacy
				if (error.response?.status === 401) {
					console.warn('[Challonge API] OAuth token rejected (401) in v1 request, clearing token and trying legacy key');
					analyticsDb.deleteOAuthTokens('challonge');
				} else if (error.name === 'OAuthNotConnectedError' || error.name === 'OAuthTokenExpiredError') {
					console.warn('[Challonge API] OAuth token error in v1 request, trying legacy key:', error.message);
				} else {
					throw error; // Re-throw non-auth errors
				}
			}
		}

		// Fall back to legacy API key
		const legacyKey = getLegacyApiKey();
		if (!legacyKey) {
			throw new Error('Challonge not connected. Please connect your account in Settings or configure a legacy API key.');
		}

		const legacyHeaders = {
			'Authorization': legacyKey,
			'Authorization-Type': 'v1',
			'Content-Type': 'application/json'
		};

		return axios({
			method,
			url,
			timeout: 15000,
			...config,
			headers: {
				...config.headers,
				...legacyHeaders
			}
		});
	});
}

// Rate-limited axios wrapper for direct API calls
// Use this to wrap any axios call: await rateLimitedAxios.get(...) or rateLimitedAxios.post(...)
const rateLimitedAxios = {
	get: (...args) => executeRateLimitedRequest(() => axios.get(...args)),
	post: (...args) => executeRateLimitedRequest(() => axios.post(...args)),
	put: (...args) => executeRateLimitedRequest(() => axios.put(...args)),
	delete: (...args) => executeRateLimitedRequest(() => axios.delete(...args)),
	patch: (...args) => executeRateLimitedRequest(() => axios.patch(...args))
};

// Parse v2.1 JSON:API response to extract data
function parseV2Response(response) {
	const data = response.data?.data;
	const included = response.data?.included || [];

	// Build lookup maps for included resources
	const includedMap = {};
	included.forEach(item => {
		const key = `${item.type}_${item.id}`;
		includedMap[key] = item;
	});

	return { data, included, includedMap };
}

// Transform v2.1 match to frontend format
function transformV2Match(match, includedMap = {}) {
	const attrs = match.attributes;
	const relationships = match.relationships || {};

	// Get participant IDs from relationships
	let player1Id = null;
	let player2Id = null;

	// v2.1 uses points_by_participant for player info
	if (attrs.points_by_participant && attrs.points_by_participant.length >= 2) {
		player1Id = attrs.points_by_participant[0]?.participant_id;
		player2Id = attrs.points_by_participant[1]?.participant_id;
	}

	// Get station ID from relationship
	let stationId = null;
	const stationLink = relationships?.station?.links?.related;
	if (stationLink) {
		// Extract station ID from URL like ".../stations/620521.json"
		const stationMatch = stationLink.match(/stations\/(\d+)\.json/);
		if (stationMatch) {
			stationId = stationMatch[1];
		}
	}

	// Parse scores from v2.1 format
	let scores_csv = '';
	if (attrs.score_in_sets && attrs.score_in_sets.length > 0) {
		// score_in_sets is like [[2, 1]] for a 2-1 match
		const lastSet = attrs.score_in_sets[attrs.score_in_sets.length - 1];
		if (lastSet && lastSet.length === 2) {
			scores_csv = `${lastSet[0]}-${lastSet[1]}`;
		}
	} else if (attrs.scores) {
		// scores field is like "2 - 1"
		scores_csv = attrs.scores.replace(/\s/g, '');
	}

	return {
		id: parseInt(match.id),
		tournamentId: null, // Will be set by caller
		state: attrs.state,
		round: attrs.round,
		player1Id: player1Id,
		player2Id: player2Id,
		winnerId: attrs.winner_id,
		loserId: null, // Not directly in v2.1 response
		scores_csv: scores_csv,
		suggestedPlayOrder: attrs.suggested_play_order,
		identifier: attrs.identifier,
		startedAt: attrs.timestamps?.started_at,
		completedAt: null, // Not in v2.1 timestamps
		underwayAt: attrs.timestamps?.underway_at,
		stationId: stationId
	};
}

// Transform v2.1 participant to frontend format
function transformV2Participant(participant) {
	const attrs = participant.attributes;
	return {
		id: parseInt(participant.id),
		name: attrs.name || attrs.display_name,
		displayName: attrs.display_name || attrs.name,
		seed: attrs.seed,
		active: attrs.active,
		checkedIn: attrs.checked_in,
		checkedInAt: attrs.checked_in_at,
		canCheckIn: attrs.can_check_in,
		onWaitingList: attrs.on_waiting_list,
		invitationPending: attrs.invitation_pending,
		finalRank: attrs.final_rank,
		misc: attrs.misc,
		email: attrs.email_hash ? null : attrs.email, // email_hash means email is hidden
		challongeUsername: attrs.challonge_username,
		groupId: attrs.group_id
	};
}

// Get security settings with defaults
function getSecuritySettings() {
	const settings = loadSystemSettings();
	return {
		maxFailedAttempts: settings?.security?.maxFailedAttempts || 5,
		lockoutDuration: settings?.security?.lockoutDuration || (60 * 60 * 1000), // 1 hour
		passwordMinLength: settings?.security?.passwordMinLength || 10,  // Secure default
		requirePasswordComplexity: settings?.security?.requirePasswordComplexity !== false,  // Default: true
		sessionTimeout: settings?.security?.sessionTimeout || (60 * 60 * 1000) // 1 hour (secure default)
	};
}

// Get system defaults with fallbacks
function getSystemDefaults() {
	const settings = loadSystemSettings();
	return {
		registrationWindow: settings?.systemDefaults?.registrationWindow || 48,
		signupCap: settings?.systemDefaults?.signupCap || null,
		defaultGame: settings?.systemDefaults?.defaultGame || '',
		tournamentType: settings?.systemDefaults?.tournamentType || 'single elimination'
	};
}

// Get display settings with defaults
function getDisplaySettings() {
	const settings = loadSystemSettings();
	return {
		matchRefreshInterval: settings?.display?.matchRefreshInterval || 5000,
		bracketRefreshInterval: settings?.display?.bracketRefreshInterval || 60000,
		flyerRefreshInterval: settings?.display?.flyerRefreshInterval || 60000,
		defaultFlyer: settings?.display?.defaultFlyer || '',
		bracketZoomLevel: settings?.display?.bracketZoomLevel || 0.75
	};
}

// Load users from file
function loadUsers() {
	try {
		const data = fsSync.readFileSync(USERS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('Error loading users:', error);
		return { users: [] };
	}
}

// Save users to file
function saveUsers(usersData) {
	try {
		fsSync.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2));
		return true;
	} catch (error) {
		console.error('Error saving users:', error);
		return false;
	}
}

// Load auth data (failed attempts and lockouts)
function loadAuthData() {
	try {
		const data = fsSync.readFileSync(AUTH_DATA_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		return { failedAttempts: {}, lockedAccounts: {} };
	}
}

// Save auth data
function saveAuthData(authData) {
	try {
		fsSync.writeFileSync(AUTH_DATA_FILE, JSON.stringify(authData, null, 2));
	} catch (error) {
		console.error('Error saving auth data:', error);
	}
}

// Check if account is locked
function isAccountLocked(username) {
	const securitySettings = getSecuritySettings();
	const authData = loadAuthData();
	if (authData.lockedAccounts[username]) {
		const lockoutTime = authData.lockedAccounts[username];
		const now = Date.now();
		if (now - lockoutTime < securitySettings.lockoutDuration) {
			const remainingTime = securitySettings.lockoutDuration - (now - lockoutTime);
			return {
				locked: true,
				remainingMinutes: Math.ceil(remainingTime / 60000)
			};
		} else {
			// Lockout expired, remove it
			delete authData.lockedAccounts[username];
			delete authData.failedAttempts[username];
			saveAuthData(authData);
		}
	}
	return { locked: false };
}

// Record failed login attempt
function recordFailedAttempt(username) {
	const securitySettings = getSecuritySettings();
	const authData = loadAuthData();
	authData.failedAttempts[username] = (authData.failedAttempts[username] || 0) + 1;

	if (authData.failedAttempts[username] >= securitySettings.maxFailedAttempts) {
		authData.lockedAccounts[username] = Date.now();
		console.log(`Account locked: ${username} (too many failed attempts)`);
	}

	saveAuthData(authData);
	return authData.failedAttempts[username];
}

// Clear failed attempts on successful login
function clearFailedAttempts(username) {
	const authData = loadAuthData();
	delete authData.failedAttempts[username];
	saveAuthData(authData);
}

// Validate password against security settings
function validatePassword(password) {
	const securitySettings = getSecuritySettings();
	const errors = [];

	// Check minimum length
	if (password.length < securitySettings.passwordMinLength) {
		errors.push(`Password must be at least ${securitySettings.passwordMinLength} characters long`);
	}

	// Check complexity if required
	if (securitySettings.requirePasswordComplexity) {
		const hasUpperCase = /[A-Z]/.test(password);
		const hasLowerCase = /[a-z]/.test(password);
		const hasNumber = /[0-9]/.test(password);
		const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

		if (!hasUpperCase) {
			errors.push('Password must contain at least one uppercase letter');
		}
		if (!hasLowerCase) {
			errors.push('Password must contain at least one lowercase letter');
		}
		if (!hasNumber) {
			errors.push('Password must contain at least one number');
		}
		if (!hasSpecial) {
			errors.push('Password must contain at least one special character');
		}
	}

	return {
		valid: errors.length === 0,
		errors: errors
	};
}

// Load system settings
function loadSettings() {
	try {
		const data = fsSync.readFileSync(SETTINGS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('Error loading settings:', error);
		return null;
	}
}

// Save system settings
function saveSettings(settings) {
	try {
		fsSync.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
		return true;
	} catch (error) {
		console.error('Error saving settings:', error);
		return false;
	}
}

// Load activity log
function loadActivityLog() {
	try {
		const data = fsSync.readFileSync(ACTIVITY_LOG_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		return { logs: [] };
	}
}

// Save activity log
function saveActivityLog(logData) {
	try {
		fsSync.writeFileSync(ACTIVITY_LOG_FILE, JSON.stringify(logData, null, 2));
	} catch (error) {
		console.error('Error saving activity log:', error);
	}
}

// Add activity log entry
function logActivity(userId, username, action, details = {}) {
	const logData = loadActivityLog();
	const entry = {
		id: Date.now(),
		userId,
		username,
		action,
		category: getActivityCategory(action),
		details,
		timestamp: new Date().toISOString()
	};

	logData.logs.unshift(entry);

	// Keep only last 1000 entries
	if (logData.logs.length > 1000) {
		logData.logs = logData.logs.slice(0, 1000);
	}

	saveActivityLog(logData);

	// Broadcast to connected admin clients via WebSocket
	broadcastActivityEvent(entry);
}

// Broadcast activity event to admin clients
function broadcastActivityEvent(entry) {
	io.emit('activity:new', {
		...entry,
		serverTime: new Date().toISOString()
	});
	console.log(`[Activity] Broadcast: ${entry.action} by ${entry.username}`);
}

// Authentication middleware
function requireAuth(req, res, next) {
	if (req.session && req.session.userId) {
		return next();
	}
	res.redirect('/login.html');
}

// API authentication middleware (returns JSON instead of redirect)
function requireAuthAPI(req, res, next) {
	if (req.session && req.session.userId) {
		return next();
	}
	res.status(401).json({
		success: false,
		error: 'Authentication required'
	});
}

// Admin-only middleware
function requireAdmin(req, res, next) {
	if (req.session && req.session.userId && req.session.role === 'admin') {
		return next();
	}
	res.status(403).json({
		success: false,
		error: 'Admin access required'
	});
}

// API Token OR Session auth middleware (for device access like Stream Deck)
// Checks X-API-Token header first, falls back to session auth
function requireTokenOrSessionAuth(req, res, next) {
	// Check for API token first
	const apiToken = req.headers['x-api-token'];
	if (apiToken) {
		const tokenRecord = analyticsDb.verifyApiToken(apiToken);
		if (tokenRecord && tokenRecord.isActive) {
			analyticsDb.updateTokenLastUsed(tokenRecord.id);
			req.apiToken = tokenRecord;
			req.isTokenAuth = true;
			return next();
		}
		return res.status(401).json({
			success: false,
			error: 'Invalid or expired API token'
		});
	}

	// Fall back to session auth
	return requireAuthAPI(req, res, next);
}

// ============================================
// PUBLIC ROUTES (no authentication required)
// ============================================

// Public route for flyer previews
app.get('/api/flyers/preview/:filename', async (req, res) => {
	try {
		const filename = req.params.filename;

		// Security check - prevent path traversal
		if (filename.includes('..') || filename.includes('/')) {
			return res.status(400).json({
				success: false,
				error: 'Invalid filename'
			});
		}

		const filePath = path.join(process.env.FLYERS_PATH, filename);
		res.sendFile(filePath);
	} catch (error) {
		res.status(500).json({
			success: false,
			error: 'Failed to serve flyer preview'
		});
	}
});

// Login page and static files (no auth required)
app.use(express.static('public'));

// ============================================
// WEBSOCKET (SOCKET.IO) HANDLERS
// ============================================

// Socket.IO connection handler
io.on('connection', (socket) => {
	console.log(`[WebSocket] New connection: ${socket.id}`);

	// Handle display registration (MagicMirror modules)
	socket.on('display:register', (data) => {
		const { displayType, displayId } = data;
		console.log(`[WebSocket] Display registered: ${displayType} (${displayId})`);

		// Store display connection
		socket.displayType = displayType;
		socket.displayId = displayId;
		wsConnections.displays.set(displayId, socket);

		// Send current match data if available
		if (matchDataCache.data) {
			socket.emit('matches:update', {
				...matchDataCache.data,
				timestamp: matchDataCache.timestamp,
				source: 'cache'
			});
			console.log(`[WebSocket] Sent cached match data to ${displayType}`);
		}

		// Send current sponsor state if rotation is enabled
		try {
			const sponsorState = loadSponsorState();
			if (sponsorState.config.enabled && (sponsorState.config.rotationEnabled || sponsorState.config.timerViewEnabled)) {
				const byPosition = {};
				sponsorState.sponsors.filter(s => s.active).forEach(s => {
					if (!byPosition[s.position]) byPosition[s.position] = [];
					byPosition[s.position].push(s);
				});

				const currentSponsors = {};
				Object.entries(byPosition).forEach(([position, sponsors]) => {
					const sorted = sponsors.sort((a, b) => a.order - b.order);
					const currentIndex = sponsorState.config.currentIndex[position] || 0;
					const sponsor = sorted[currentIndex % sorted.length];
					if (sponsor) {
						currentSponsors[position] = {
							id: sponsor.id,
							filename: sponsor.filename,
							name: sponsor.name,
							position: sponsor.position,
							type: sponsor.type,
							size: sponsor.size,
							opacity: sponsor.opacity,
							borderRadius: sponsor.borderRadius || 0,
							active: true
						};
					}
				});

				if (Object.keys(currentSponsors).length > 0) {
					socket.emit('sponsor:show', { sponsors: currentSponsors, duration: 0 });
					console.log(`[WebSocket] Sent sponsor state to ${displayType}: ${Object.keys(currentSponsors).join(', ')}`);
				}
			}
		} catch (err) {
			console.error(`[WebSocket] Error sending sponsor state: ${err.message}`);
		}

		// Acknowledge registration
		socket.emit('display:registered', {
			success: true,
			displayId,
			displayType,
			serverTime: new Date().toISOString()
		});
	});

	// Handle admin client registration
	socket.on('admin:register', () => {
		console.log(`[WebSocket] Admin client registered: ${socket.id}`);
		wsConnections.clients.add(socket);

		// Send initial activity data
		try {
			const logData = loadActivityLog();
			const recentActivity = logData.logs.slice(0, 20);
			socket.emit('activity:initial', {
				activity: recentActivity,
				serverTime: new Date().toISOString()
			});
			console.log(`[WebSocket] Sent ${recentActivity.length} initial activities to ${socket.id}`);
		} catch (error) {
			console.error('[WebSocket] Error sending initial activity:', error.message);
		}
	});

	// Handle request for current data
	socket.on('matches:request', () => {
		if (matchDataCache.data) {
			socket.emit('matches:update', {
				...matchDataCache.data,
				timestamp: matchDataCache.timestamp,
				source: 'cache'
			});
		}
	});

	// Handle match data ACK from displays
	socket.on('matches:ack', (data) => {
		const displayId = socket.displayId || data.displayId || 'unknown';
		const ackTime = new Date().toISOString();
		const hash = data.hash || null;

		// Update delivery status for this display
		const currentStatus = displayDeliveryStatus.status.get(displayId) || { ackCount: 0 };
		displayDeliveryStatus.status.set(displayId, {
			lastAckTime: ackTime,
			lastAckHash: hash,
			ackCount: currentStatus.ackCount + 1
		});

		console.log(`[WebSocket] ACK received from ${displayId}, hash: ${hash ? hash.substring(0, 8) + '...' : 'none'}`);
	});

	// Handle disconnect
	socket.on('disconnect', () => {
		console.log(`[WebSocket] Disconnected: ${socket.id}`);

		// Remove from display connections
		if (socket.displayId) {
			wsConnections.displays.delete(socket.displayId);
		}

		// Remove from admin clients
		wsConnections.clients.delete(socket);
	});

	// Handle errors
	socket.on('error', (error) => {
		console.error(`[WebSocket] Socket error: ${error.message}`);
	});
});

// Broadcast match data to all connected displays
function broadcastMatchData(payload, updateHash = null, deltaInfo = null) {
	const timestamp = new Date().toISOString();

	// Build delta payload if available
	const delta = deltaInfo || buildDeltaPayload(previousMatchState, payload, payload.availableStations);

	const data = {
		...payload,
		timestamp,
		source: 'live',
		updateHash: updateHash,  // Include hash so client can ACK with it
		// Delta update information
		updateType: delta.type,  // 'delta', 'full', or 'none'
		changes: delta.changes   // Specific slot changes (tv1, tv2, upNext, podium)
	};

	// Track this broadcast for fallback comparison
	displayDeliveryStatus.lastBroadcastTime = timestamp;
	displayDeliveryStatus.lastBroadcastHash = updateHash;

	// Emit to all connected clients
	io.emit('matches:update', data);

	const displayCount = wsConnections.displays.size;
	const clientCount = wsConnections.clients.size;

	// Log delta details
	if (delta.type === 'delta' && delta.changes) {
		const changedSlots = [];
		if (delta.changes.tv1) changedSlots.push(`TV1:${delta.changes.tv1.type}`);
		if (delta.changes.tv2) changedSlots.push(`TV2:${delta.changes.tv2.type}`);
		if (delta.changes.upNext) changedSlots.push(`UpNext:${delta.changes.upNext.length} items`);
		if (delta.changes.podium) changedSlots.push('Podium');
		console.log(`[WebSocket] Delta broadcast: [${changedSlots.join(', ')}] to ${displayCount} displays`);
	} else {
		console.log(`[WebSocket] Broadcast matches to ${displayCount} displays, ${clientCount} admin clients (hash: ${updateHash ? updateHash.substring(0, 8) + '...' : 'none'})`);
	}
}

// Broadcast ticker message to all displays
function broadcastTickerMessage(message, duration) {
	io.emit('ticker:message', {
		message,
		duration,
		timestamp: new Date().toISOString()
	});
	console.log(`[WebSocket] Broadcast ticker message: "${message}" (${duration}s)`);
}

// Broadcast tournament update
function broadcastTournamentUpdate(tournamentData) {
	io.emit('tournament:update', {
		...tournamentData,
		timestamp: new Date().toISOString()
	});
	console.log(`[WebSocket] Broadcast tournament update`);
}

// Get WebSocket connection status
function getWebSocketStatus() {
	return {
		displays: Array.from(wsConnections.displays.entries()).map(([id, socket]) => ({
			id,
			type: socket.displayType,
			connected: socket.connected
		})),
		displayCount: wsConnections.displays.size,
		adminClientCount: wsConnections.clients.size,
		totalConnections: io.engine.clientsCount
	};
}

// ============================================
// AUTHENTICATION ROUTES
// ============================================

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
	const { username, password } = req.body;

	if (!username || !password) {
		return res.status(400).json({
			success: false,
			message: 'Username and password are required'
		});
	}

	// Check if account is locked
	const lockStatus = isAccountLocked(username);
	if (lockStatus.locked) {
		return res.status(403).json({
			success: false,
			locked: true,
			message: `Account is locked due to too many failed login attempts. Please try again in ${lockStatus.remainingMinutes} minutes.`
		});
	}

	// Load users and find matching username
	const usersData = loadUsers();
	const user = usersData.users.find(u => u.username === username);

	if (!user) {
		// Record failed attempt even if user doesn't exist (to prevent username enumeration timing attacks)
		recordFailedAttempt(username);
		return res.status(401).json({
			success: false,
			message: 'Username or password is incorrect. Please try again.'
		});
	}

	// Verify password
	const passwordMatch = await bcrypt.compare(password, user.password);

	if (!passwordMatch) {
		const failedAttempts = recordFailedAttempt(username);
		const securitySettings = getSecuritySettings();
		const remainingAttempts = securitySettings.maxFailedAttempts - failedAttempts;

		if (remainingAttempts <= 0) {
			return res.status(403).json({
				success: false,
				locked: true,
				message: `Account locked due to too many failed login attempts. Please try again in ${Math.ceil(securitySettings.lockoutDuration / 60000)} minutes.`
			});
		}

		return res.status(401).json({
			success: false,
			message: 'Username or password is incorrect. Please try again.'
		});
	}

	// Successful login
	clearFailedAttempts(username);
	req.session.userId = user.id;
	req.session.username = user.username;
	req.session.role = user.role;

	// Log activity
	logActivity(user.id, user.username, ACTIVITY_TYPES.ADMIN_LOGIN, {
		ip: req.ip || req.connection?.remoteAddress
	});

	// Explicitly save session before responding to avoid race conditions
	req.session.save((err) => {
		if (err) {
			console.error('[Auth] Session save error:', err);
			return res.status(500).json({
				success: false,
				message: 'Login successful but session could not be saved. Please try again.'
			});
		}
		res.json({
			success: true,
			user: {
				id: user.id,
				username: user.username,
				role: user.role
			}
		});
	});
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
	// Capture user info before destroying session
	const userId = req.session?.userId || 0;
	const username = req.session?.username || 'Unknown';

	req.session.destroy((err) => {
		if (err) {
			return res.status(500).json({
				success: false,
				error: 'Failed to logout'
			});
		}

		// Log activity after successful logout
		logActivity(userId, username, ACTIVITY_TYPES.ADMIN_LOGOUT, {});

		res.json({ success: true });
	});
});

// Check auth status
app.get('/api/auth/status', requireAuthAPI, (req, res) => {
	const usersData = loadUsers();
	const user = usersData.users.find(u => u.id === req.session.userId);

	if (!user) {
		return res.status(404).json({
			success: false,
			error: 'User not found'
		});
	}

	// Get session timeout from settings (with rolling sessions, this resets on each request)
	const settings = loadSystemSettings();
	const sessionTimeoutMs = settings?.security?.sessionTimeout || (7 * 24 * 60 * 60 * 1000);

	res.json({
		success: true,
		user: {
			id: user.id,
			username: user.username,
			role: user.role
		},
		session: {
			timeoutMs: sessionTimeoutMs,
			serverTime: Date.now(),
			expiresAt: Date.now() + sessionTimeoutMs
		}
	});
});

// Get CSRF token (for initial page load or token refresh)
app.get('/api/csrf-token', csrf.getTokenEndpoint);

// ============================================
// API TOKEN MANAGEMENT (for devices like Stream Deck)
// ============================================

// Create new API token (admin only)
app.post('/api/auth/tokens', requireAdmin, async (req, res) => {
	try {
		const { deviceName, deviceType = 'streamdeck', permissions = 'full', expiresInDays = null } = req.body;

		if (!deviceName || deviceName.trim().length === 0) {
			return res.status(400).json({
				success: false,
				error: 'Device name is required'
			});
		}

		// Validate permissions
		const validPermissions = ['full', 'readonly', 'matches_only'];
		if (!validPermissions.includes(permissions)) {
			return res.status(400).json({
				success: false,
				error: 'Invalid permissions. Must be: full, readonly, or matches_only'
			});
		}

		const result = analyticsDb.createApiToken(
			deviceName.trim(),
			deviceType,
			req.session.username,
			permissions,
			expiresInDays
		);

		// Log the action
		logActivity('token_created', `API token created for ${deviceName}`, req.session.username);

		res.json({
			success: true,
			message: 'API token created successfully',
			token: result.token, // Plain text token - shown only once!
			record: result.record
		});
	} catch (error) {
		console.error('[API Tokens] Create error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to create API token'
		});
	}
});

// List all API tokens (admin only)
app.get('/api/auth/tokens', requireAdmin, (req, res) => {
	try {
		const tokens = analyticsDb.listApiTokens();
		res.json({
			success: true,
			tokens
		});
	} catch (error) {
		console.error('[API Tokens] List error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to list API tokens'
		});
	}
});

// Revoke API token (admin only)
app.delete('/api/auth/tokens/:id', requireAdmin, (req, res) => {
	try {
		const tokenId = parseInt(req.params.id, 10);
		if (isNaN(tokenId)) {
			return res.status(400).json({
				success: false,
				error: 'Invalid token ID'
			});
		}

		// Get token info before revoking for logging
		const token = analyticsDb.getApiToken(tokenId);
		if (!token) {
			return res.status(404).json({
				success: false,
				error: 'Token not found'
			});
		}

		const revoked = analyticsDb.revokeApiToken(tokenId);
		if (revoked) {
			logActivity('token_revoked', `API token revoked: ${token.deviceName}`, req.session.username);
			res.json({
				success: true,
				message: 'API token revoked successfully'
			});
		} else {
			res.status(404).json({
				success: false,
				error: 'Token not found'
			});
		}
	} catch (error) {
		console.error('[API Tokens] Revoke error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to revoke API token'
		});
	}
});

// Verify API token (token auth - for devices to test their token)
app.get('/api/auth/verify-token', (req, res) => {
	const apiToken = req.headers['x-api-token'];

	if (!apiToken) {
		return res.status(401).json({
			success: false,
			error: 'X-API-Token header required'
		});
	}

	const tokenRecord = analyticsDb.verifyApiToken(apiToken);
	if (tokenRecord && tokenRecord.isActive) {
		analyticsDb.updateTokenLastUsed(tokenRecord.id);
		res.json({
			success: true,
			device: {
				name: tokenRecord.deviceName,
				type: tokenRecord.deviceType,
				permissions: tokenRecord.permissions
			}
		});
	} else {
		res.status(401).json({
			success: false,
			error: 'Invalid or expired API token'
		});
	}
});

// ============================================
// CHALLONGE OAUTH 2.0 ROUTES
// ============================================

// OAuth configuration from environment
const OAUTH_CONFIG = {
	clientId: process.env.CHALLONGE_CLIENT_ID,
	clientSecret: process.env.CHALLONGE_CLIENT_SECRET,
	redirectUri: process.env.CHALLONGE_REDIRECT_URI || 'https://admin.despairhardware.com/auth/challonge/callback',
	authorizationEndpoint: 'https://api.challonge.com/oauth/authorize',
	tokenEndpoint: 'https://api.challonge.com/oauth/token',
	scope: 'me tournaments:read tournaments:write participants:read participants:write matches:read matches:write stations:read stations:write'
};

// Generate random state for CSRF protection
function generateOAuthState() {
	return require('crypto').randomBytes(32).toString('hex');
}

// Initiate OAuth flow - redirects to Challonge authorization
app.get('/auth/challonge', requireAuth, (req, res) => {
	// Check if OAuth is configured
	if (!OAUTH_CONFIG.clientId || !OAUTH_CONFIG.clientSecret) {
		return res.status(500).send(`
			<html>
			<head><title>OAuth Not Configured</title></head>
			<body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
				<h1>OAuth Not Configured</h1>
				<p>Challonge OAuth credentials are not configured.</p>
				<p>Please set CHALLONGE_CLIENT_ID and CHALLONGE_CLIENT_SECRET in .env file.</p>
				<a href="/settings.html">Return to Settings</a>
			</body>
			</html>
		`);
	}

	// Generate and store state for CSRF protection
	const state = generateOAuthState();
	req.session.oauthState = state;

	// Build authorization URL
	const authUrl = new URL(OAUTH_CONFIG.authorizationEndpoint);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('client_id', OAUTH_CONFIG.clientId);
	authUrl.searchParams.set('redirect_uri', OAUTH_CONFIG.redirectUri);
	authUrl.searchParams.set('scope', OAUTH_CONFIG.scope);
	authUrl.searchParams.set('state', state);

	console.log('[OAuth] Redirecting to Challonge authorization');
	res.redirect(authUrl.toString());
});

// OAuth callback - exchanges authorization code for tokens
app.get('/auth/challonge/callback', async (req, res) => {
	const { code, state, error, error_description } = req.query;

	// Handle OAuth errors from Challonge
	if (error) {
		console.error('[OAuth] Authorization error:', error, error_description);
		return res.redirect(`/settings.html?oauth_error=${encodeURIComponent(error_description || error)}`);
	}

	// Validate state parameter (CSRF protection)
	if (!state || state !== req.session.oauthState) {
		console.error('[OAuth] State mismatch - possible CSRF attack');
		return res.redirect('/settings.html?oauth_error=Invalid+state+parameter');
	}

	// Clear stored state
	delete req.session.oauthState;

	if (!code) {
		console.error('[OAuth] No authorization code received');
		return res.redirect('/settings.html?oauth_error=No+authorization+code');
	}

	try {
		// Exchange authorization code for tokens
		console.log('[OAuth] Exchanging authorization code for tokens');
		const tokenResponse = await axios.post(OAUTH_CONFIG.tokenEndpoint, {
			grant_type: 'authorization_code',
			client_id: OAUTH_CONFIG.clientId,
			client_secret: OAUTH_CONFIG.clientSecret,
			code: code,
			redirect_uri: OAUTH_CONFIG.redirectUri
		}, {
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			},
			timeout: 30000
		});

		const tokens = tokenResponse.data;
		console.log('[OAuth] Token exchange successful');

		// Try to fetch user info
		let userInfo = {};
		try {
			const userResponse = await axios.get('https://api.challonge.com/v2.1/me.json', {
				headers: {
					'Authorization': `Bearer ${tokens.access_token}`,
					'Authorization-Type': 'v2',  // Required for OAuth Bearer tokens
					'Content-Type': 'application/vnd.api+json',
					'Accept': 'application/json'
				},
				timeout: 15000
			});
			const userData = userResponse.data.data?.attributes || {};
			userInfo = {
				user_id: userResponse.data.data?.id,
				username: userData.username || userData.name || userData.email
			};
			console.log('[OAuth] User info retrieved:', userInfo.username);
		} catch (userError) {
			console.warn('[OAuth] Could not fetch user info:', userError.message);
		}

		// Save tokens to database (encrypted)
		analyticsDb.saveOAuthTokens({
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			token_type: tokens.token_type || 'Bearer',
			expires_in: tokens.expires_in || 7200,
			scope: tokens.scope || OAUTH_CONFIG.scope,
			user_id: userInfo.user_id,
			username: userInfo.username
		});

		console.log('[OAuth] Tokens saved successfully');
		res.redirect('/settings.html?oauth_success=true');

	} catch (error) {
		console.error('[OAuth] Token exchange failed:', error.response?.data || error.message);
		const errorMsg = error.response?.data?.error_description || error.response?.data?.error || error.message;
		res.redirect(`/settings.html?oauth_error=${encodeURIComponent(errorMsg)}`);
	}
});

// Get OAuth connection status
app.get('/api/oauth/status', requireAuthAPI, (req, res) => {
	try {
		const status = analyticsDb.getOAuthStatus();
		res.json({
			success: true,
			...status,
			configured: !!(OAUTH_CONFIG.clientId && OAUTH_CONFIG.clientSecret)
		});
	} catch (error) {
		console.error('[OAuth] Status check failed:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Disconnect OAuth (revoke and delete tokens)
app.post('/api/oauth/disconnect', requireAuthAPI, async (req, res) => {
	try {
		// Get tokens before deleting
		const tokens = analyticsDb.getOAuthTokens();

		if (tokens) {
			// Try to revoke token with Challonge (best effort)
			try {
				await axios.post('https://api.challonge.com/oauth/revoke', {
					token: tokens.accessToken,
					client_id: OAUTH_CONFIG.clientId,
					client_secret: OAUTH_CONFIG.clientSecret
				}, {
					headers: { 'Content-Type': 'application/json' },
					timeout: 10000
				});
				console.log('[OAuth] Token revoked with Challonge');
			} catch (revokeError) {
				console.warn('[OAuth] Token revocation failed (continuing anyway):', revokeError.message);
			}
		}

		// Delete tokens from database
		analyticsDb.deleteOAuthTokens();

		res.json({
			success: true,
			message: 'Challonge account disconnected'
		});
	} catch (error) {
		console.error('[OAuth] Disconnect failed:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Manually refresh OAuth token
app.post('/api/oauth/refresh', requireAuthAPI, async (req, res) => {
	try {
		const tokens = analyticsDb.getOAuthTokens();

		if (!tokens || !tokens.refreshToken) {
			return res.status(400).json({
				success: false,
				error: 'No refresh token available'
			});
		}

		// Request new tokens using refresh token
		const tokenResponse = await axios.post(OAUTH_CONFIG.tokenEndpoint, {
			grant_type: 'refresh_token',
			client_id: OAUTH_CONFIG.clientId,
			client_secret: OAUTH_CONFIG.clientSecret,
			refresh_token: tokens.refreshToken
		}, {
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			},
			timeout: 30000
		});

		const newTokens = tokenResponse.data;

		// Save new tokens (preserve user info)
		analyticsDb.saveOAuthTokens({
			access_token: newTokens.access_token,
			refresh_token: newTokens.refresh_token || tokens.refreshToken,
			token_type: newTokens.token_type || 'Bearer',
			expires_in: newTokens.expires_in || 7200,
			scope: newTokens.scope || tokens.scope,
			user_id: tokens.challongeUserId,
			username: tokens.challongeUsername
		});

		console.log('[OAuth] Token refreshed successfully');

		res.json({
			success: true,
			message: 'Token refreshed successfully',
			expiresIn: newTokens.expires_in || 7200
		});

	} catch (error) {
		console.error('[OAuth] Token refresh failed:', error.response?.data || error.message);

		// If refresh fails, token might be invalid - mark as disconnected
		if (error.response?.status === 400 || error.response?.status === 401) {
			analyticsDb.deleteOAuthTokens();
			return res.status(401).json({
				success: false,
				error: 'Refresh token expired. Please reconnect your Challonge account.',
				reconnectRequired: true
			});
		}

		res.status(500).json({
			success: false,
			error: error.response?.data?.error_description || error.message
		});
	}
});

// ============================================
// OAUTH TOKEN MIDDLEWARE
// ============================================

// Custom error classes for OAuth
class OAuthNotConnectedError extends Error {
	constructor(message = 'Challonge account not connected') {
		super(message);
		this.name = 'OAuthNotConnectedError';
	}
}

class OAuthTokenExpiredError extends Error {
	constructor(message = 'OAuth token expired and refresh failed') {
		super(message);
		this.name = 'OAuthTokenExpiredError';
	}
}

/**
 * Ensure a valid OAuth token is available
 * Automatically refreshes if token is expiring soon
 * @returns {Promise<string>} Valid access token
 * @throws {OAuthNotConnectedError} If no token exists
 * @throws {OAuthTokenExpiredError} If token is expired and refresh fails
 */
async function ensureValidToken() {
	const tokens = analyticsDb.getOAuthTokens();

	if (!tokens) {
		throw new OAuthNotConnectedError();
	}

	const expiresAt = new Date(tokens.expiresAt);
	const refreshThreshold = 5 * 60 * 1000; // 5 minutes

	// Check if token needs refresh
	if (Date.now() > expiresAt.getTime() - refreshThreshold) {
		console.log('[OAuth] Token expiring soon, attempting refresh');

		if (!tokens.refreshToken) {
			throw new OAuthTokenExpiredError('Token expired and no refresh token available');
		}

		try {
			const tokenResponse = await axios.post(OAUTH_CONFIG.tokenEndpoint, {
				grant_type: 'refresh_token',
				client_id: OAUTH_CONFIG.clientId,
				client_secret: OAUTH_CONFIG.clientSecret,
				refresh_token: tokens.refreshToken
			}, {
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				},
				timeout: 30000
			});

			const newTokens = tokenResponse.data;

			// Save new tokens
			analyticsDb.saveOAuthTokens({
				access_token: newTokens.access_token,
				refresh_token: newTokens.refresh_token || tokens.refreshToken,
				token_type: newTokens.token_type || 'Bearer',
				expires_in: newTokens.expires_in || 7200,
				scope: newTokens.scope || tokens.scope,
				user_id: tokens.challongeUserId,
				username: tokens.challongeUsername
			});

			console.log('[OAuth] Token refreshed automatically');
			return newTokens.access_token;

		} catch (error) {
			console.error('[OAuth] Auto-refresh failed:', error.message);
			analyticsDb.deleteOAuthTokens();
			throw new OAuthTokenExpiredError('Token refresh failed. Please reconnect your Challonge account.');
		}
	}

	return tokens.accessToken;
}

// Redirect root to login if not authenticated
app.get('/', requireAuth, (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Configure multer for file uploads
const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, 'uploads/');
	},
	filename: (req, file, cb) => {
		const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
		cb(null, uniqueSuffix + path.extname(file.originalname));
	}
});

// Allowed file types for flyers
const ALLOWED_FLYER_MIMETYPES = ['image/png', 'image/jpeg', 'video/mp4'];
const ALLOWED_FLYER_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.mp4'];

// Allowed file types for sponsor logos
const ALLOWED_SPONSOR_MIMETYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'];
const ALLOWED_SPONSOR_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

// ============================================
// Game Configuration Management
// ============================================
const GAME_CONFIGS_FILE = path.join(__dirname, 'game-configs.json');
const SIGNUP_GAME_CONFIGS_FILE = path.join(__dirname, '..', 'tournament-signup', 'game-configs.json');

// Game config helper functions
function loadGameConfigs() {
	try {
		const data = fsSync.readFileSync(GAME_CONFIGS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('[Game Configs] Error loading:', error.message);
		return {
			default: {
				name: 'Tournament',
				shortName: '',
				rules: [],
				prizes: [],
				additionalInfo: []
			}
		};
	}
}

function saveGameConfigs(configs) {
	// Write to admin-dashboard (master copy)
	fsSync.writeFileSync(GAME_CONFIGS_FILE, JSON.stringify(configs, null, 2));

	// Write to tournament-signup (for hot-reload)
	try {
		fsSync.writeFileSync(SIGNUP_GAME_CONFIGS_FILE, JSON.stringify(configs, null, 2));
		console.log('[Game Configs] Synced to signup app');
	} catch (error) {
		console.error('[Game Configs] Failed to sync to signup app:', error.message);
	}
}

function validateGameKey(key) {
	// Only allow lowercase alphanumeric and underscores
	return /^[a-z][a-z0-9_]*$/.test(key) && key.length <= 30;
}

// Sponsor state file path
const SPONSORS_DIR = path.join(__dirname, 'sponsors');
const SPONSOR_STATE_FILE = path.join(__dirname, 'sponsor-state.json');

// Sponsor rotation timers
let sponsorRotationTimers = {};

// Sponsor timer view state
let sponsorTimerViewTimeout = null;
let sponsorTimerViewState = 'hidden'; // 'visible' or 'hidden'

// Sponsor helper functions
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

function saveSponsorState(state) {
	state.lastUpdated = new Date().toISOString();
	fsSync.writeFileSync(SPONSOR_STATE_FILE, JSON.stringify(state, null, 2));
}

function sanitizeSponsorFilename(name) {
	return name.toLowerCase()
		.replace(/[^a-z0-9-_]/g, '_')
		.replace(/_+/g, '_')
		.substring(0, 50);
}

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

function stopSponsorRotation() {
	Object.keys(sponsorRotationTimers).forEach(position => {
		clearInterval(sponsorRotationTimers[position]);
	});
	sponsorRotationTimers = {};
	console.log('[Sponsors] Rotation timers stopped');
}

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

// Timer View functions - show all sponsors for X seconds, hide for Y seconds
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

function stopSponsorTimerView() {
	if (sponsorTimerViewTimeout) {
		clearTimeout(sponsorTimerViewTimeout);
		sponsorTimerViewTimeout = null;
	}
	sponsorTimerViewState = 'hidden';
	console.log('[Sponsors] Timer View stopped');
}

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
				active: true
			};
		}
	});

	if (Object.keys(sponsorData).length > 0) {
		console.log(`[Sponsors] Timer View: Showing ${Object.keys(sponsorData).length} sponsor(s)`);

		// Broadcast via WebSocket
		io.emit('sponsor:show', { sponsors: sponsorData, duration: 0 });

		// Also send via HTTP to MagicMirror modules (for displays without WebSocket)
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

async function hideAllSponsorsForTimer() {
	console.log('[Sponsors] Timer View: Hiding all sponsors');

	// Broadcast via WebSocket
	io.emit('sponsor:hide', { all: true });

	// Also send via HTTP to MagicMirror modules (for displays without WebSocket)
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

const upload = multer({
	storage: storage,
	limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit (for videos)
	fileFilter: (req, file, cb) => {
		if (ALLOWED_FLYER_MIMETYPES.includes(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new Error('Only PNG, JPG, and MP4 files are allowed'));
		}
	}
});

// Multer configuration for sponsor uploads
const sponsorUpload = multer({
	storage: storage,
	limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for logos
	fileFilter: (req, file, cb) => {
		if (ALLOWED_SPONSOR_MIMETYPES.includes(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new Error('Only PNG, JPG, GIF, SVG, and WebP files are allowed'));
		}
	}
});

// Helper function to read state files
async function readStateFile(filePath) {
	try {
		const data = await fs.readFile(filePath, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		return null;
	}
}

// Helper function to check service status
async function checkModuleStatus(apiUrl, endpoint = '/api/tournament/status') {
	try {
		const response = await axios.get(`${apiUrl}${endpoint}`, { timeout: 10000 }); // Increased timeout to 10s
		return { running: true, response: response.data };
	} catch (error) {
		console.error(`[Status Check Failed] ${apiUrl}${endpoint} - Error: ${error.message}`);
		return { running: false, error: error.message };
	}
}

// ============================================
// PROTECTED API ROUTES (require authentication)
// ============================================

// Apply authentication middleware to all /api/ routes except auth routes
app.use('/api/status', requireTokenOrSessionAuth);
app.use('/api/tournament', requireAuthAPI);
app.use('/api/flyers', requireAuthAPI);
app.use('/api/flyer', requireAuthAPI);
app.use('/api/tournaments', requireAuthAPI);
app.use('/api/test-connection', requireAuthAPI);
app.use('/api/participants', requireTokenOrSessionAuth);
app.use('/api/settings', requireAuthAPI);
app.use('/api/users', requireAuthAPI);

// Get system status
app.get('/api/status', async (req, res) => {
	try {
		const [matchStatus, flyerStatus, bracketStatus, matchState, flyerState, bracketState] = await Promise.all([
			checkModuleStatus(process.env.MATCH_API_URL, '/api/tournament/status'),
			checkModuleStatus(process.env.FLYER_API_URL, '/api/flyer/status'),
			checkModuleStatus(process.env.BRACKET_API_URL, '/api/bracket/status'),
			readStateFile(process.env.MATCH_STATE_FILE),
			readStateFile(process.env.FLYER_STATE_FILE),
			readStateFile(process.env.BRACKET_STATE_FILE)
		]);

		res.json({
			success: true,
			timestamp: new Date().toISOString(),
			modules: {
				match: {
					status: matchStatus,
					state: matchState,
					port: 2052
				},
				flyer: {
					status: flyerStatus,
					state: flyerState,
					port: 2054
				},
				bracket: {
					status: bracketStatus,
					state: bracketState,
					port: 2053
				}
			}
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Get rate limit status
app.get('/api/rate-limit/status', requireAuthAPI, (req, res) => {
	res.json({
		success: true,
		...getRateLimitStatus()
	});
});

// Manually trigger tournament check for adaptive rate limiting
app.post('/api/rate-limit/check', requireAuthAPI, async (req, res) => {
	try {
		await checkTournamentsAndUpdateMode();
		res.json({
			success: true,
			message: 'Tournament check completed',
			...getRateLimitStatus()
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// ==========================================
// Cache Management API Endpoints
// ==========================================

// Get cache statistics
app.get('/api/cache/status', requireAuthAPI, (req, res) => {
	try {
		const stats = cacheDb.getCacheStats();
		res.json({
			success: true,
			...stats,
			activeTournamentMode: false // Could be enhanced to track this
		});
	} catch (error) {
		console.error('[Cache API] Error getting cache status:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Invalidate specific cache
app.post('/api/cache/invalidate', requireAuthAPI, (req, res) => {
	const { type, key } = req.body;

	// Validate type
	const validTypes = ['tournaments', 'matches', 'participants', 'stations', 'tournamentDetails'];
	if (!type || !validTypes.includes(type)) {
		return res.status(400).json({
			success: false,
			error: `Invalid cache type. Must be one of: ${validTypes.join(', ')}`
		});
	}

	try {
		const success = cacheDb.invalidateCache(type, key || null);
		const message = key
			? `Cache invalidated for ${type}/${key}`
			: `All ${type} cache invalidated`;

		console.log(`[Cache API] ${message} by ${req.session.username}`);
		logActivity('cache_invalidate', 'system', `${message}`, req.session.username);

		res.json({
			success,
			message
		});
	} catch (error) {
		console.error('[Cache API] Error invalidating cache:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Clear all caches
app.post('/api/cache/clear', requireAuthAPI, (req, res) => {
	try {
		const success = cacheDb.invalidateAllCache();

		console.log(`[Cache API] All caches cleared by ${req.session.username}`);
		logActivity('cache_clear', 'system', 'All caches cleared', req.session.username);

		res.json({
			success,
			message: 'All caches cleared successfully'
		});
	} catch (error) {
		console.error('[Cache API] Error clearing all caches:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Get cache summary for a specific tournament
app.get('/api/cache/tournament/:tournamentId', requireAuthAPI, (req, res) => {
	const { tournamentId } = req.params;

	try {
		const summary = cacheDb.getTournamentCacheSummary(tournamentId);
		res.json({
			success: true,
			tournamentId,
			caches: summary
		});
	} catch (error) {
		console.error('[Cache API] Error getting tournament cache summary:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// ==========================================
// Push Notification API Endpoints
// ==========================================

/**
 * Send push notification to a specific subscription
 */
async function sendPushNotification(subscription, payload) {
	if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
		console.warn('[Push] VAPID keys not configured, skipping notification');
		return { success: false, error: 'VAPID keys not configured' };
	}

	const pushSubscription = {
		endpoint: subscription.endpoint,
		keys: {
			p256dh: subscription.p256dh_key,
			auth: subscription.auth_key
		}
	};

	try {
		await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
		analyticsDb.updateSubscriptionLastUsed(subscription.endpoint);
		return { success: true };
	} catch (error) {
		console.error('[Push] Error sending notification:', error.message);
		// Remove invalid subscriptions (410 Gone or 404 Not Found)
		if (error.statusCode === 410 || error.statusCode === 404) {
			analyticsDb.deletePushSubscription(subscription.endpoint);
			console.log('[Push] Removed invalid subscription:', subscription.endpoint.substring(0, 50));
		}
		return { success: false, error: error.message };
	}
}

/**
 * Broadcast push notification to all subscriptions matching a notification type
 */
async function broadcastPushNotification(notificationType, payload) {
	if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
		return { success: false, sent: 0, error: 'VAPID keys not configured' };
	}

	const subscriptions = analyticsDb.getAllPushSubscriptions();
	let sent = 0;
	let failed = 0;

	for (const sub of subscriptions) {
		// Check if user has this notification type enabled (default to enabled)
		const prefKey = notificationType.replace(/-/g, '_');
		if (sub[prefKey] === 0) {
			continue; // User has disabled this notification type
		}

		const result = await sendPushNotification(sub, payload);
		if (result.success) {
			sent++;
		} else {
			failed++;
		}
	}

	return { success: true, sent, failed };
}

// Get VAPID public key (for client-side subscription)
app.get('/api/notifications/vapid-public-key', requireAuthAPI, (req, res) => {
	if (!VAPID_PUBLIC_KEY) {
		return res.status(503).json({
			success: false,
			error: 'Push notifications not configured'
		});
	}
	res.json({
		success: true,
		publicKey: VAPID_PUBLIC_KEY
	});
});

// Subscribe to push notifications
app.post('/api/notifications/subscribe', requireAuthAPI, (req, res) => {
	const { subscription } = req.body;

	if (!subscription || !subscription.endpoint || !subscription.keys) {
		return res.status(400).json({
			success: false,
			error: 'Invalid subscription object'
		});
	}

	try {
		const userAgent = req.headers['user-agent'];
		analyticsDb.savePushSubscription(req.session.userId, subscription, userAgent);

		console.log(`[Push] Subscription saved for user ${req.session.username}`);
		logActivity('push_subscribe', 'system', 'Push notifications enabled', req.session.username);

		res.json({
			success: true,
			message: 'Subscription saved successfully'
		});
	} catch (error) {
		console.error('[Push] Error saving subscription:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Unsubscribe from push notifications
app.delete('/api/notifications/unsubscribe', requireAuthAPI, (req, res) => {
	const { endpoint } = req.body;

	try {
		if (endpoint) {
			analyticsDb.deletePushSubscription(endpoint);
		} else {
			analyticsDb.deleteUserPushSubscriptions(req.session.userId);
		}

		console.log(`[Push] Subscription removed for user ${req.session.username}`);
		logActivity('push_unsubscribe', 'system', 'Push notifications disabled', req.session.username);

		res.json({
			success: true,
			message: 'Unsubscribed successfully'
		});
	} catch (error) {
		console.error('[Push] Error removing subscription:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Get notification preferences
app.get('/api/notifications/preferences', requireAuthAPI, (req, res) => {
	try {
		const preferences = analyticsDb.getNotificationPreferences(req.session.userId);
		const subscriptions = analyticsDb.getPushSubscriptions(req.session.userId);

		res.json({
			success: true,
			preferences,
			subscriptionCount: subscriptions.length,
			isSubscribed: subscriptions.length > 0
		});
	} catch (error) {
		console.error('[Push] Error getting preferences:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Update notification preferences
app.put('/api/notifications/preferences', requireAuthAPI, (req, res) => {
	const preferences = req.body;

	try {
		analyticsDb.saveNotificationPreferences(req.session.userId, preferences);

		console.log(`[Push] Preferences updated for user ${req.session.username}`);

		res.json({
			success: true,
			message: 'Preferences saved successfully'
		});
	} catch (error) {
		console.error('[Push] Error saving preferences:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Send test notification
app.post('/api/notifications/test', requireAuthAPI, async (req, res) => {
	try {
		const subscriptions = analyticsDb.getPushSubscriptions(req.session.userId);

		if (subscriptions.length === 0) {
			return res.status(400).json({
				success: false,
				error: 'No push subscriptions found. Please enable notifications first.'
			});
		}

		const payload = {
			title: 'Tournament Control Center',
			body: 'Push notifications are working!',
			icon: '/icons/icon-192.png',
			badge: '/icons/badge-72.png',
			tag: 'test-notification',
			data: {
				type: 'test',
				timestamp: new Date().toISOString()
			}
		};

		let sent = 0;
		for (const sub of subscriptions) {
			const result = await sendPushNotification(sub, payload);
			if (result.success) sent++;
		}

		res.json({
			success: true,
			message: `Test notification sent to ${sent} device(s)`
		});
	} catch (error) {
		console.error('[Push] Error sending test notification:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// ==========================================
// WebSocket API Endpoints
// ==========================================

// Get WebSocket connection status
app.get('/api/websocket/status', requireAuthAPI, (req, res) => {
	res.json({
		success: true,
		...getWebSocketStatus()
	});
});

// Force update match data - fetches from Challonge and pushes to displays
// Used when automatic polling is not active or user wants immediate refresh
app.post('/api/matches/force-update', requireAuthAPI, async (req, res) => {
	try {
		console.log('[Force Update] Manually triggered by:', req.session.username);
		await fetchAndPushMatches();

		const cacheInfo = matchDataCache.timestamp ? {
			lastUpdate: matchDataCache.timestamp,
			tournamentId: matchDataCache.tournamentId
		} : null;

		res.json({
			success: true,
			message: 'Match data refreshed and pushed to displays',
			cache: cacheInfo,
			pollingActive: matchPollingState.isPolling
		});
	} catch (error) {
		console.error('[Force Update] Error:', error.message);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Get match cache status
app.get('/api/matches/cache-status', requireAuthAPI, (req, res) => {
	const stateFile = process.env.MATCH_STATE_FILE || '/root/tournament-control-center/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json';
	let tournamentId = null;

	try {
		const data = fsSync.readFileSync(stateFile, 'utf8');
		const state = JSON.parse(data);
		tournamentId = state.tournamentId;
	} catch (error) {
		// No tournament configured
	}

	const cacheData = tournamentId ? getMatchDataCache(tournamentId) : null;

	res.json({
		success: true,
		hasCache: !!cacheData,
		cacheTimestamp: matchDataCache.timestamp,
		cacheTournamentId: matchDataCache.tournamentId,
		isStale: cacheData?.isStale || false,
		cacheAgeMs: cacheData?.cacheAgeMs || null,
		pollingActive: matchPollingState.isPolling,
		lastPollTime: matchPollingState.lastPollTime
	});
});

// Enable development mode (3-hour rate limit bypass)
app.post('/api/rate-limit/dev-mode/enable', requireAuthAPI, requireAdmin, (req, res) => {
	enableDevMode();

	// Log who enabled it
	logActivity(req.session.userId, req.session.username, 'dev_mode_enabled', {
		expiresAt: new Date(devModeState.expiresAt).toISOString()
	});

	res.json({
		success: true,
		message: 'Development mode enabled for 3 hours',
		...getRateLimitStatus()
	});
});

// Disable development mode
app.post('/api/rate-limit/dev-mode/disable', requireAuthAPI, requireAdmin, (req, res) => {
	disableDevMode();

	// Log who disabled it
	logActivity(req.session.userId, req.session.username, 'dev_mode_disabled', {});

	res.json({
		success: true,
		message: 'Development mode disabled',
		...getRateLimitStatus()
	});
});

// Set manual rate mode override
app.post('/api/rate-limit/mode', requireAuthAPI, requireAdmin, (req, res) => {
	const { mode } = req.body;

	// Valid modes: IDLE, UPCOMING, ACTIVE, or null/auto to clear override
	const validModes = ['IDLE', 'UPCOMING', 'ACTIVE', 'auto', null];

	if (!validModes.includes(mode)) {
		return res.status(400).json({
			success: false,
			error: 'Invalid mode. Valid modes: IDLE, UPCOMING, ACTIVE, or auto'
		});
	}

	if (mode === 'auto' || mode === null) {
		// Clear manual override
		adaptiveRateState.manualOverride = null;
		console.log('[Adaptive Rate] Manual override cleared - returning to automatic mode');

		logActivity(req.session.userId, req.session.username, 'rate_mode_override_cleared', {});

		// Trigger an immediate tournament check to set the correct mode
		checkTournamentsAndUpdateMode();

		res.json({
			success: true,
			message: 'Rate mode set to automatic',
			...getRateLimitStatus()
		});
	} else {
		// Set manual override
		const modeObj = RATE_MODES[mode];
		adaptiveRateState.manualOverride = modeObj;

		// Apply the mode immediately
		updateRateMode(modeObj);

		console.log(`[Adaptive Rate] Manual override set to ${mode}`);

		logActivity(req.session.userId, req.session.username, 'rate_mode_override_set', {
			mode: mode,
			effectiveRate: adaptiveRateState.effectiveRate
		});

		res.json({
			success: true,
			message: `Rate mode manually set to ${mode}`,
			...getRateLimitStatus()
		});
	}
});

// Setup tournament on both modules
app.post('/api/tournament/setup', async (req, res) => {
	const { tournamentId, registrationWindowHours, signupCap } = req.body;

	// Validation - only tournamentId is required
	if (!tournamentId) {
		return res.status(400).json({
			success: false,
			error: 'Tournament ID is required'
		});
	}

	// Validate registration settings
	const regWindow = registrationWindowHours ? parseInt(registrationWindowHours) : 48;
	const cap = signupCap ? parseInt(signupCap) : null;

	const useApiKey = getChallongeApiKey();

	if (!useApiKey) {
		return res.status(500).json({
			success: false,
			error: 'Challonge not connected. Please connect your account in Settings.'
		});
	}

	try {
		// Build bracket URL (HTTPS required for mixed content security)
		const displaySettings = getDisplaySettings();
		const bracketUrl = `https://challonge.com/${tournamentId}/module?scale_to_fit=1&multiplier=${displaySettings.bracketZoomLevel}`;

		// Send to match and bracket modules (flyer is managed separately via Flyers page)
		const [matchResponse, bracketResponse] = await Promise.all([
			axios.post(`${process.env.MATCH_API_URL}/api/tournament/update`, {
				apiKey: useApiKey,
				tournamentId: tournamentId,
				registrationWindowHours: regWindow,
				signupCap: cap
			}, { timeout: 5000 }),
			axios.post(`${process.env.BRACKET_API_URL}/api/bracket/update`, {
				bracketUrl: bracketUrl
			}, { timeout: 5000 })
		]);

		res.json({
			success: true,
			message: 'Tournament configured successfully on display modules',
			results: {
				match: matchResponse.data,
				bracket: bracketResponse.data
			},
			tournament: {
				id: tournamentId,
				bracketUrl: bracketUrl
			}
		});
	} catch (error) {
		console.error('Tournament setup error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to configure tournament',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Update flyer display only (without reconfiguring tournament)
app.post('/api/flyer/update', async (req, res) => {
	const { flyer } = req.body;

	// Validation
	if (!flyer) {
		return res.status(400).json({
			success: false,
			error: 'Flyer filename is required'
		});
	}

	try {
		// Send only to flyer module
		const flyerResponse = await axios.post(
			`${process.env.FLYER_API_URL}/api/flyer/update`,
			{ flyer: flyer },
			{ timeout: 5000 }
		);

		res.json({
			success: true,
			message: 'Flyer display updated successfully',
			result: flyerResponse.data,
			flyer: flyer
		});
	} catch (error) {
		console.error('Flyer update error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to update flyer display',
			details: error.response ? error.response.data : error.message
		});
	}
});

// ============================================================================
// Bracket Control Proxy Endpoints
// ============================================================================

// Get bracket status (proxied from bracket module)
app.get('/api/bracket/status', async (req, res) => {
	try {
		const response = await axios.get(
			`${process.env.BRACKET_API_URL}/api/bracket/status`,
			{ timeout: 5000 }
		);
		res.json(response.data);
	} catch (error) {
		console.error('Bracket status error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to get bracket status',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Set bracket zoom level
app.post('/api/bracket/zoom', async (req, res) => {
	const { zoomScale, animationDuration } = req.body;

	if (zoomScale === undefined || zoomScale === null) {
		return res.status(400).json({
			success: false,
			error: 'Missing zoomScale parameter'
		});
	}

	try {
		const response = await axios.post(
			`${process.env.BRACKET_API_URL}/api/bracket/zoom`,
			{ zoomScale, animationDuration },
			{ timeout: 5000 }
		);
		res.json(response.data);
	} catch (error) {
		console.error('Bracket zoom error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to set bracket zoom',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Focus on a specific match
app.post('/api/bracket/focus', async (req, res) => {
	const { matchIdentifier, zoomScale, animationDuration } = req.body;

	if (matchIdentifier === undefined || matchIdentifier === null) {
		return res.status(400).json({
			success: false,
			error: 'Missing matchIdentifier parameter'
		});
	}

	try {
		const response = await axios.post(
			`${process.env.BRACKET_API_URL}/api/bracket/focus`,
			{ matchIdentifier, zoomScale, animationDuration },
			{ timeout: 5000 }
		);
		res.json(response.data);
	} catch (error) {
		console.error('Bracket focus error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to focus on match',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Reset bracket view to default
app.post('/api/bracket/reset', async (req, res) => {
	const { animationDuration } = req.body;

	try {
		const response = await axios.post(
			`${process.env.BRACKET_API_URL}/api/bracket/reset`,
			{ animationDuration },
			{ timeout: 5000 }
		);
		res.json(response.data);
	} catch (error) {
		console.error('Bracket reset error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to reset bracket view',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Generic bracket control (for advanced commands)
app.post('/api/bracket/control', async (req, res) => {
	const { command } = req.body;

	if (!command) {
		return res.status(400).json({
			success: false,
			error: 'Missing command parameter'
		});
	}

	try {
		const response = await axios.post(
			`${process.env.BRACKET_API_URL}/api/bracket/control`,
			req.body,
			{ timeout: 5000 }
		);
		res.json(response.data);
	} catch (error) {
		console.error('Bracket control error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to send bracket control command',
			details: error.response ? error.response.data : error.message
		});
	}
});

// ============================================
// TICKER MESSAGE API
// ============================================

// Send ticker message to match display
app.post('/api/ticker/send', requireTokenOrSessionAuth, async (req, res) => {
	const { message, duration } = req.body;

	if (!message || typeof message !== 'string' || message.trim().length === 0) {
		return res.status(400).json({
			success: false,
			error: 'Message is required'
		});
	}

	const tickerDuration = parseInt(duration, 10) || 5;
	if (tickerDuration < 3 || tickerDuration > 30) {
		return res.status(400).json({
			success: false,
			error: 'Duration must be between 3 and 30 seconds'
		});
	}

	const trimmedMessage = message.trim().substring(0, 200);

	// Broadcast via WebSocket (real-time)
	broadcastTickerMessage(trimmedMessage, tickerDuration);

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/ticker/message`,
			{
				message: trimmedMessage,
				duration: tickerDuration
			},
			{ timeout: 5000 }
		);
	} catch (httpError) {
		// HTTP failed but WebSocket broadcast succeeded - this is OK
		console.warn(`[Ticker] HTTP push failed (WebSocket still worked): ${httpError.message}`);
	}

	res.json({
		success: true,
		message: 'Ticker message sent via WebSocket',
		data: { message: trimmedMessage, duration: tickerDuration }
	});
});

// ============================================
// SCHEDULED TICKER ENDPOINTS
// ============================================

// Get all scheduled ticker messages
app.get('/api/ticker/schedule', requireAuthAPI, (req, res) => {
	try {
		const messages = tickerScheduler.getScheduledMessages();
		res.json({ success: true, messages });
	} catch (error) {
		console.error('[Ticker Schedule] Error getting messages:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Create a new scheduled ticker message
app.post('/api/ticker/schedule', requireAuthAPI, (req, res) => {
	try {
		const { message, duration, scheduleType, scheduledTime, recurringDays } = req.body;

		if (!message || typeof message !== 'string' || message.trim().length === 0) {
			return res.status(400).json({ success: false, error: 'Message is required' });
		}

		if (!scheduleType || !['once', 'daily', 'weekly'].includes(scheduleType)) {
			return res.status(400).json({ success: false, error: 'Schedule type must be once, daily, or weekly' });
		}

		const tickerDuration = parseInt(duration, 10) || 5;
		if (tickerDuration < 3 || tickerDuration > 30) {
			return res.status(400).json({ success: false, error: 'Duration must be between 3 and 30 seconds' });
		}

		const scheduledMessage = tickerScheduler.addScheduledMessage({
			message: message.trim().substring(0, 200),
			duration: tickerDuration,
			scheduleType,
			scheduledTime,
			recurringDays: recurringDays || []
		});

		res.json({ success: true, message: 'Scheduled message created', scheduled: scheduledMessage });
	} catch (error) {
		console.error('[Ticker Schedule] Error creating message:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Update a scheduled ticker message
app.put('/api/ticker/schedule/:id', requireAuthAPI, (req, res) => {
	try {
		const { id } = req.params;
		const updates = req.body;

		// Validate message if provided
		if (updates.message !== undefined) {
			if (typeof updates.message !== 'string' || updates.message.trim().length === 0) {
				return res.status(400).json({ success: false, error: 'Message cannot be empty' });
			}
			updates.message = updates.message.trim().substring(0, 200);
		}

		// Validate duration if provided
		if (updates.duration !== undefined) {
			const dur = parseInt(updates.duration, 10);
			if (isNaN(dur) || dur < 3 || dur > 30) {
				return res.status(400).json({ success: false, error: 'Duration must be between 3 and 30 seconds' });
			}
			updates.duration = dur;
		}

		const updated = tickerScheduler.updateScheduledMessage(id, updates);
		if (!updated) {
			return res.status(404).json({ success: false, error: 'Scheduled message not found' });
		}

		res.json({ success: true, message: 'Scheduled message updated', scheduled: updated });
	} catch (error) {
		console.error('[Ticker Schedule] Error updating message:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Delete a scheduled ticker message
app.delete('/api/ticker/schedule/:id', requireAuthAPI, (req, res) => {
	try {
		const { id } = req.params;
		const deleted = tickerScheduler.deleteScheduledMessage(id);

		if (!deleted) {
			return res.status(404).json({ success: false, error: 'Scheduled message not found' });
		}

		res.json({ success: true, message: 'Scheduled message deleted' });
	} catch (error) {
		console.error('[Ticker Schedule] Error deleting message:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Clear all scheduled ticker messages
app.delete('/api/ticker/schedule', requireAuthAPI, (req, res) => {
	try {
		tickerScheduler.clearAllScheduled();
		res.json({ success: true, message: 'All scheduled messages cleared' });
	} catch (error) {
		console.error('[Ticker Schedule] Error clearing messages:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// ============================================
// AUDIO ANNOUNCEMENT ENDPOINT
// ============================================

// Trigger audio announcement on Pi displays via TTS
app.post('/api/audio/announce', requireAuthAPI, async (req, res) => {
	try {
		const { text, voice, rate, volume } = req.body;

		if (!text || typeof text !== 'string' || text.trim().length === 0) {
			return res.status(400).json({ success: false, error: 'Text is required' });
		}

		const announcementText = text.trim().substring(0, 500);
		const announcementRate = Math.min(Math.max(parseFloat(rate) || 1.0, 0.5), 2.0);
		const announcementVolume = Math.min(Math.max(parseFloat(volume) || 1.0, 0.0), 1.0);

		const payload = {
			text: announcementText,
			voice: voice || 'default',
			rate: announcementRate,
			volume: announcementVolume,
			timestamp: Date.now()
		};

		// Broadcast via WebSocket
		io.emit('audio:announce', payload);
		console.log(`[Audio] Announcement broadcast via WebSocket: "${announcementText.substring(0, 50)}..."`);

		// Also send via HTTP to match display for redundancy
		try {
			await axios.post(
				`${process.env.MATCH_API_URL}/api/audio/announce`,
				payload,
				{ timeout: 5000 }
			);
		} catch (httpError) {
			console.warn(`[Audio] HTTP push failed (WebSocket still worked): ${httpError.message}`);
		}

		res.json({ success: true, message: 'Audio announcement triggered', data: payload });
	} catch (error) {
		console.error('[Audio] Error sending announcement:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// ============================================
// TIMER ENDPOINTS
// ============================================

// Start a DQ timer for a specific TV (TV 1 or TV 2)
app.post('/api/timer/dq', requireAuthAPI, async (req, res) => {
	const { tv, duration, tournamentId, matchId, playerId, playerName } = req.body;

	// Validate TV parameter
	if (!tv || (tv !== 'TV 1' && tv !== 'TV 2')) {
		return res.status(400).json({
			success: false,
			error: 'TV must be "TV 1" or "TV 2"'
		});
	}

	// Get default duration from settings
	const dqSettings = getDQTimerSettings();
	const timerDuration = parseInt(duration, 10) || dqSettings.defaultDuration || 180;
	if (timerDuration < 10 || timerDuration > 600) {
		return res.status(400).json({
			success: false,
			error: 'Duration must be between 10 and 600 seconds'
		});
	}

	console.log(`[Timer] Starting DQ timer for ${tv}: ${timerDuration} seconds`);

	// If enhanced params provided, use server-side timer management
	if (tournamentId && matchId) {
		startServerDQTimer(tournamentId, matchId, tv, timerDuration, playerId, playerName);
	}

	// Broadcast via WebSocket (for display)
	io.emit('timer:dq', {
		tv: tv,
		duration: timerDuration,
		action: 'start',
		matchId: matchId || null,
		playerName: playerName || null,
		timestamp: new Date().toISOString()
	});

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/timer/dq`,
			{ tv, duration: timerDuration, action: 'start' },
			{ timeout: 5000 }
		);
	} catch (httpError) {
		console.warn(`[Timer] HTTP push failed (WebSocket still worked): ${httpError.message}`);
	}

	res.json({
		success: true,
		message: `DQ timer started for ${tv}`,
		data: { tv, duration: timerDuration, matchId, playerName }
	});
});

// Get active DQ timers
app.get('/api/timer/dq/active', requireAuthAPI, (req, res) => {
	const timers = getActiveDQTimers();
	res.json({
		success: true,
		timers,
		count: timers.length
	});
});

// Cancel a specific DQ timer
app.delete('/api/timer/dq/:key', requireAuthAPI, (req, res) => {
	const { key } = req.params;

	// URL decode the key (it may contain colons)
	const decodedKey = decodeURIComponent(key);

	if (cancelDQTimer(decodedKey)) {
		res.json({
			success: true,
			message: 'DQ timer cancelled'
		});
	} else {
		res.status(404).json({
			success: false,
			error: 'Timer not found'
		});
	}
});

// Start the tournament-wide timer (large timer between TVs and Up Next)
app.post('/api/timer/tournament', requireAuthAPI, async (req, res) => {
	const { duration } = req.body;

	// Validate duration
	const timerDuration = parseInt(duration, 10);
	if (!timerDuration || timerDuration < 10 || timerDuration > 3600) {
		return res.status(400).json({
			success: false,
			error: 'Duration must be between 10 and 3600 seconds (1 hour max)'
		});
	}

	console.log(`[Timer] Starting tournament timer: ${timerDuration} seconds`);

	// Broadcast via WebSocket
	io.emit('timer:tournament', {
		duration: timerDuration,
		action: 'start',
		timestamp: new Date().toISOString()
	});

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/timer/tournament`,
			{ duration: timerDuration, action: 'start' },
			{ timeout: 5000 }
		);
	} catch (httpError) {
		console.warn(`[Timer] HTTP push failed (WebSocket still worked): ${httpError.message}`);
	}

	res.json({
		success: true,
		message: 'Tournament timer started',
		data: { duration: timerDuration }
	});
});

// Hide/stop a timer
app.post('/api/timer/hide', requireAuthAPI, async (req, res) => {
	const { type, tv } = req.body;

	// Validate type parameter
	if (!type || (type !== 'dq' && type !== 'tournament' && type !== 'all')) {
		return res.status(400).json({
			success: false,
			error: 'Type must be "dq", "tournament", or "all"'
		});
	}

	// For DQ timers, tv is required
	if (type === 'dq' && (!tv || (tv !== 'TV 1' && tv !== 'TV 2'))) {
		return res.status(400).json({
			success: false,
			error: 'For DQ timers, TV must be "TV 1" or "TV 2"'
		});
	}

	console.log(`[Timer] Hiding timer: type=${type}, tv=${tv || 'N/A'}`);

	// Broadcast via WebSocket
	io.emit('timer:hide', {
		type: type,
		tv: tv || null,
		timestamp: new Date().toISOString()
	});

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/timer/hide`,
			{ type, tv },
			{ timeout: 5000 }
		);
	} catch (httpError) {
		console.warn(`[Timer] HTTP push failed (WebSocket still worked): ${httpError.message}`);
	}

	res.json({
		success: true,
		message: `Timer hidden: ${type}${tv ? ` (${tv})` : ''}`,
		data: { type, tv }
	});
});

// ========================================
// QR CODE ENDPOINTS
// ========================================

// Generate QR code as data URL
app.get('/api/qr/generate', requireAuthAPI, async (req, res) => {
	const { url, size = 300 } = req.query;

	if (!url) {
		return res.status(400).json({
			success: false,
			error: 'URL parameter is required'
		});
	}

	try {
		const qrDataUrl = await QRCode.toDataURL(url, {
			width: parseInt(size, 10),
			margin: 2,
			color: {
				dark: '#000000',
				light: '#ffffff'
			}
		});

		res.json({
			success: true,
			qrCode: qrDataUrl,
			url: url
		});
	} catch (error) {
		console.error('QR code generation error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to generate QR code'
		});
	}
});

// Show QR code on match display
app.post('/api/qr/show', requireAuthAPI, async (req, res) => {
	const { url, label, duration } = req.body;

	if (!url) {
		return res.status(400).json({
			success: false,
			error: 'URL is required'
		});
	}

	// Generate QR code as data URL
	let qrDataUrl;
	try {
		qrDataUrl = await QRCode.toDataURL(url, {
			width: 400,
			margin: 2,
			color: {
				dark: '#000000',
				light: '#ffffff'
			}
		});
	} catch (error) {
		console.error('QR code generation error:', error);
		return res.status(500).json({
			success: false,
			error: 'Failed to generate QR code'
		});
	}

	const qrDuration = duration ? Math.min(Math.max(duration, 10), 300) : null; // 10s-5min, or null for permanent

	// Broadcast via WebSocket
	io.emit('qr:show', {
		qrCode: qrDataUrl,
		url: url,
		label: label || 'Scan to Join',
		duration: qrDuration,
		timestamp: new Date().toISOString()
	});

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/qr/show`,
			{ qrCode: qrDataUrl, url, label: label || 'Scan to Join', duration: qrDuration },
			{ timeout: 5000 }
		);
	} catch (httpError) {
		console.warn(`[QR] HTTP push failed (WebSocket still worked): ${httpError.message}`);
	}

	res.json({
		success: true,
		message: 'QR code displayed on match screen',
		data: { url, label, duration: qrDuration }
	});
});

// Hide QR code from match display
app.post('/api/qr/hide', requireAuthAPI, async (req, res) => {
	// Broadcast via WebSocket
	io.emit('qr:hide', {
		timestamp: new Date().toISOString()
	});

	// Also send via HTTP for backward compatibility
	try {
		await axios.post(
			`${process.env.MATCH_API_URL}/api/qr/hide`,
			{},
			{ timeout: 5000 }
		);
	} catch (httpError) {
		console.warn(`[QR] HTTP push failed (WebSocket still worked): ${httpError.message}`);
	}

	res.json({
		success: true,
		message: 'QR code hidden'
	});
});

// ============================================
// EMERGENCY MODE (PANIC BUTTON)
// ============================================

// Get emergency mode status
app.get('/api/emergency/status', requireTokenOrSessionAuth, (req, res) => {
	res.json({
		success: true,
		emergency: emergencyModeState
	});
});

// Activate emergency mode - freezes all displays, pauses timers
app.post('/api/emergency/activate', requireAuthAPI, async (req, res) => {
	const { reason } = req.body;
	const username = req.session?.user?.username || 'unknown';

	if (emergencyModeState.active) {
		return res.json({
			success: false,
			message: 'Emergency mode is already active'
		});
	}

	emergencyModeState = {
		active: true,
		activatedAt: new Date().toISOString(),
		activatedBy: username,
		reason: reason || 'Emergency stop activated'
	};

	// Broadcast emergency state to all connected clients and displays
	io.emit('emergency:activated', {
		...emergencyModeState,
		timestamp: new Date().toISOString()
	});

	// Cancel all active DQ timers
	const activeTimerKeys = Object.keys(activeDQTimers);
	for (const key of activeTimerKeys) {
		const timer = activeDQTimers[key];
		if (timer && timer.timeout) {
			clearTimeout(timer.timeout);
			clearInterval(timer.warningInterval);
			io.emit('timer:dq:cancelled', { key, tv: timer.tv });
			delete activeDQTimers[key];
		}
	}

	// Log activity
	logActivity({
		action: 'emergency_activated',
		details: `Emergency mode activated by ${username}: ${reason || 'No reason provided'}`,
		user: username
	});

	console.log(`[EMERGENCY] Mode ACTIVATED by ${username}: ${reason || 'No reason'}`);

	res.json({
		success: true,
		message: 'Emergency mode activated - all displays frozen',
		emergency: emergencyModeState
	});
});

// Deactivate emergency mode - resumes normal operation
app.post('/api/emergency/deactivate', requireAuthAPI, async (req, res) => {
	const username = req.session?.user?.username || 'unknown';

	if (!emergencyModeState.active) {
		return res.json({
			success: false,
			message: 'Emergency mode is not active'
		});
	}

	const previousState = { ...emergencyModeState };

	emergencyModeState = {
		active: false,
		activatedAt: null,
		activatedBy: null,
		reason: null
	};

	// Broadcast emergency deactivation to all clients
	io.emit('emergency:deactivated', {
		deactivatedBy: username,
		previousState,
		timestamp: new Date().toISOString()
	});

	// Log activity
	logActivity({
		action: 'emergency_deactivated',
		details: `Emergency mode deactivated by ${username} (was active since ${previousState.activatedAt})`,
		user: username
	});

	console.log(`[EMERGENCY] Mode DEACTIVATED by ${username}`);

	res.json({
		success: true,
		message: 'Emergency mode deactivated - normal operation resumed',
		emergency: emergencyModeState
	});
});

// ============================================
// MATCH HISTORY & ROLLBACK
// ============================================

// Get match history for a tournament (for rollback)
app.get('/api/matches/:tournamentId/history', requireTokenOrSessionAuth, (req, res) => {
	const { tournamentId } = req.params;
	const history = matchHistory.get(tournamentId) || [];

	res.json({
		success: true,
		history: history.slice(0, 10), // Return last 10 changes
		total: history.length
	});
});

// Undo last match action (rollback)
app.post('/api/matches/:tournamentId/undo', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId } = req.params;
	const username = req.session?.user?.username || req.tokenUsername || 'unknown';

	const history = matchHistory.get(tournamentId);
	if (!history || history.length === 0) {
		return res.json({
			success: false,
			message: 'No match history available to undo'
		});
	}

	const lastChange = history[0];

	try {
		// Reopen the match to allow changes
		let reopenSuccess = false;
		try {
			const reopenResponse = await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${lastChange.matchId}/change_state.json`, {
				data: {
					type: 'MatchState',
					attributes: {
						state: 'reopen'
					}
				}
			});
			reopenSuccess = true;
		} catch (v2Error) {
			// If v2.1 returns 500, fall back to v1 API
			if (v2Error.response?.status === 500) {
				console.log('[Undo] v2.1 API returned 500, trying v1 fallback...');
				try {
					const apiKey = getLegacyApiKey();
					if (apiKey) {
						await rateLimitedAxios.post(
							`https://api.challonge.com/v1/tournaments/${tournamentId}/matches/${lastChange.matchId}/reopen.json`,
							null,
							{
								params: { api_key: apiKey },
								timeout: 15000
							}
						);
						reopenSuccess = true;
						console.log('[Undo] v1 fallback succeeded');
					}
				} catch (v1Error) {
					console.error('[Undo] v1 fallback also failed:', v1Error.message);
				}
			}
		}

		if (!reopenSuccess) {
			return res.status(500).json({
				success: false,
				message: 'Failed to reopen match for undo'
			});
		}

		// Remove the entry from history
		history.shift();

		// Invalidate matches cache
		cacheDb.invalidateCache('matches', tournamentId);

		// Trigger match data refresh
		fetchAndPushMatches().catch(err => {
			console.error('[Undo] Background fetch/push failed:', err.message);
		});

		// Log activity
		logActivity({
			action: 'match_undo',
			details: `Match ${lastChange.matchId} undone by ${username} (was: ${lastChange.action})`,
			user: username,
			tournamentId,
			matchId: lastChange.matchId
		});

		// Broadcast undo event
		io.emit('match:undo', {
			tournamentId,
			matchId: lastChange.matchId,
			undoneAction: lastChange.action,
			undoneBy: username,
			timestamp: new Date().toISOString()
		});

		console.log(`[UNDO] Match ${lastChange.matchId} undone by ${username}`);

		res.json({
			success: true,
			message: `Undone: ${lastChange.action} on match ${lastChange.matchId}`,
			undoneChange: lastChange,
			remainingHistory: history.length
		});
	} catch (error) {
		console.error('[Undo] Error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to undo match action',
			details: error.message
		});
	}
});

// List available flyers
app.get('/api/flyers', async (req, res) => {
	try {
		const flyersPath = process.env.FLYERS_PATH;
		const files = await fs.readdir(flyersPath);

		const flyers = await Promise.all(
			files
				.filter(file => {
					const ext = path.extname(file).toLowerCase();
					return ALLOWED_FLYER_EXTENSIONS.includes(ext);
				})
				.map(async (file) => {
					const stats = await fs.stat(path.join(flyersPath, file));
					const ext = path.extname(file).toLowerCase();
					return {
						filename: file,
						size: stats.size,
						modified: stats.mtime,
						type: ext === '.mp4' ? 'video' : 'image'
					};
				})
		);

		res.json({
			success: true,
			flyers: flyers
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Serve flyer preview

// Upload new flyer
app.post('/api/flyers/upload', upload.single('flyer'), async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({
				success: false,
				error: 'No file uploaded'
			});
		}

		// Get the original file extension
		const originalExt = path.extname(req.file.originalname).toLowerCase();
		const customName = req.body.customName;

		let finalName;
		if (customName) {
			// If custom name provided, ensure it has the correct extension
			const customExt = path.extname(customName).toLowerCase();
			if (ALLOWED_FLYER_EXTENSIONS.includes(customExt)) {
				finalName = customName;
			} else {
				// Add the original file's extension
				finalName = customName + originalExt;
			}
		} else {
			// Use original filename
			finalName = req.file.originalname;
		}

		const tempPath = req.file.path;
		const targetPath = path.join(process.env.FLYERS_PATH, finalName);

		// Move file from uploads to flyers directory
		await fs.rename(tempPath, targetPath);

		res.json({
			success: true,
			message: 'Flyer uploaded successfully',
			filename: finalName,
			type: originalExt === '.mp4' ? 'video' : 'image'
		});
	} catch (error) {
		console.error('Upload error:', error);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// Delete flyer
app.delete('/api/flyers/:filename', async (req, res) => {
	try {
		const filename = req.params.filename;
		const filePath = path.join(process.env.FLYERS_PATH, filename);

		// Security check - prevent path traversal
		if (filename.includes('..') || filename.includes('/')) {
			return res.status(400).json({
				success: false,
				error: 'Invalid filename'
			});
		}

		await fs.unlink(filePath);

		res.json({
			success: true,
			message: 'Flyer deleted successfully'
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

// ========================================
// SPONSOR MANAGEMENT ENDPOINTS
// ========================================

// Serve sponsor logo preview (public)
app.get('/api/sponsors/preview/:filename', async (req, res) => {
	try {
		const filename = decodeURIComponent(req.params.filename);

		// Security check
		if (filename.includes('..') || filename.includes('/')) {
			return res.status(400).json({ error: 'Invalid filename' });
		}

		const filePath = path.join(SPONSORS_DIR, filename);
		res.sendFile(filePath);
	} catch (error) {
		res.status(404).json({ error: 'Sponsor logo not found' });
	}
});

// List all sponsors with config
app.get('/api/sponsors', requireAuthAPI, async (req, res) => {
	try {
		const state = loadSponsorState();

		// Add file stats to each sponsor
		const sponsorsWithStats = await Promise.all(
			state.sponsors.map(async (sponsor) => {
				try {
					const filePath = path.join(SPONSORS_DIR, sponsor.filename);
					const stats = await fs.stat(filePath);
					return {
						...sponsor,
						fileSize: stats.size,
						modified: stats.mtime
					};
				} catch {
					return { ...sponsor, fileSize: 0, modified: null };
				}
			})
		);

		res.json({
			success: true,
			sponsors: sponsorsWithStats,
			config: state.config,
			lastUpdated: state.lastUpdated
		});
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get single sponsor
app.get('/api/sponsors/:id', requireAuthAPI, async (req, res) => {
	try {
		const state = loadSponsorState();
		const sponsor = state.sponsors.find(s => s.id === req.params.id);

		if (!sponsor) {
			return res.status(404).json({ success: false, error: 'Sponsor not found' });
		}

		res.json({ success: true, sponsor });
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

// Upload new sponsor logo
app.post('/api/sponsors/upload', requireAuthAPI, sponsorUpload.single('logo'), async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ success: false, error: 'No file uploaded' });
		}

		const { name, position, type, size = 100, opacity = 100, borderRadius = 0, customName } = req.body;

		if (!name) {
			await fs.unlink(req.file.path);
			return res.status(400).json({ success: false, error: 'Sponsor name is required' });
		}

		if (!position) {
			await fs.unlink(req.file.path);
			return res.status(400).json({ success: false, error: 'Position is required' });
		}

		const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-banner', 'bottom-banner'];
		if (!validPositions.includes(position)) {
			await fs.unlink(req.file.path);
			return res.status(400).json({ success: false, error: 'Invalid position' });
		}

		const validTypes = ['corner', 'banner'];
		const sponsorType = type || (position.includes('banner') ? 'banner' : 'corner');
		if (!validTypes.includes(sponsorType)) {
			await fs.unlink(req.file.path);
			return res.status(400).json({ success: false, error: 'Invalid type' });
		}

		// Generate filename
		const originalExt = path.extname(req.file.originalname).toLowerCase();
		let finalName;
		if (customName) {
			const sanitized = sanitizeSponsorFilename(customName);
			finalName = sanitized + originalExt;
		} else {
			finalName = `sponsor_${Date.now()}${originalExt}`;
		}

		// Move file to sponsors directory
		const targetPath = path.join(SPONSORS_DIR, finalName);
		await fs.rename(req.file.path, targetPath);

		// Create sponsor entry
		const state = loadSponsorState();
		const newSponsor = {
			id: `sponsor_${Date.now()}`,
			name: name,
			filename: finalName,
			originalFilename: req.file.originalname,
			position: position,
			type: sponsorType,
			size: Math.min(Math.max(parseInt(size, 10) || 100, 50), 500), // 50 = 0.5x, 100 = 1.0x, 500 = 5.0x
			opacity: Math.min(Math.max(parseInt(opacity, 10) || 100, 10), 100),
			borderRadius: Math.min(Math.max(parseInt(borderRadius, 10) || 0, 0), 50),
			active: true,
			order: state.sponsors.filter(s => s.position === position).length + 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		state.sponsors.push(newSponsor);
		saveSponsorState(state);

		// Restart rotation if enabled
		if (state.config.enabled && state.config.rotationEnabled) {
			startSponsorRotation();
		}

		console.log(`[Sponsors] Uploaded: ${name} (${finalName}) at ${position}`);

		res.json({
			success: true,
			message: 'Sponsor uploaded successfully',
			sponsor: newSponsor
		});
	} catch (error) {
		console.error('[Sponsors] Upload error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Update sponsor metadata
app.put('/api/sponsors/:id', requireAuthAPI, async (req, res) => {
	try {
		const state = loadSponsorState();
		const index = state.sponsors.findIndex(s => s.id === req.params.id);

		if (index === -1) {
			return res.status(404).json({ success: false, error: 'Sponsor not found' });
		}

		const { name, position, type, size, opacity, borderRadius, offsetX, offsetY, active } = req.body;
		const sponsor = state.sponsors[index];

		if (name !== undefined) sponsor.name = name;
		if (position !== undefined) {
			const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-banner', 'bottom-banner'];
			if (validPositions.includes(position)) {
				sponsor.position = position;
			}
		}
		if (type !== undefined) {
			const validTypes = ['corner', 'banner'];
			if (validTypes.includes(type)) {
				sponsor.type = type;
			}
		}
		if (size !== undefined) {
			// Size is stored as percentage: 50 = 0.5x, 100 = 1.0x, 500 = 5.0x
			sponsor.size = Math.min(Math.max(parseInt(size, 10), 50), 500);
		}
		if (opacity !== undefined) {
			sponsor.opacity = Math.min(Math.max(parseInt(opacity, 10), 10), 100);
		}
		if (borderRadius !== undefined) {
			sponsor.borderRadius = Math.min(Math.max(parseInt(borderRadius, 10), 0), 50);
		}
		if (offsetX !== undefined) {
			sponsor.offsetX = Math.min(Math.max(parseInt(offsetX, 10), -500), 500);
		}
		if (offsetY !== undefined) {
			sponsor.offsetY = Math.min(Math.max(parseInt(offsetY, 10), -500), 500);
		}
		if (active !== undefined) {
			sponsor.active = Boolean(active);
		}

		sponsor.updatedAt = new Date().toISOString();
		saveSponsorState(state);

		// Restart rotation if config changed
		if (state.config.enabled && state.config.rotationEnabled) {
			startSponsorRotation();
		}

		// Broadcast update
		io.emit('sponsor:update', { sponsors: state.sponsors });

		res.json({ success: true, sponsor });
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

// Delete sponsor
app.delete('/api/sponsors/:id', requireAuthAPI, async (req, res) => {
	try {
		const state = loadSponsorState();
		const index = state.sponsors.findIndex(s => s.id === req.params.id);

		if (index === -1) {
			return res.status(404).json({ success: false, error: 'Sponsor not found' });
		}

		const sponsor = state.sponsors[index];

		// Delete the file
		try {
			await fs.unlink(path.join(SPONSORS_DIR, sponsor.filename));
		} catch (fileError) {
			console.warn(`[Sponsors] Could not delete file: ${sponsor.filename}`);
		}

		// Remove from state
		state.sponsors.splice(index, 1);
		saveSponsorState(state);

		// Restart rotation
		if (state.config.enabled && state.config.rotationEnabled) {
			startSponsorRotation();
		}

		// Broadcast update
		io.emit('sponsor:update', { sponsors: state.sponsors });

		console.log(`[Sponsors] Deleted: ${sponsor.name}`);

		res.json({ success: true, message: 'Sponsor deleted successfully' });
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

// Reorder sponsors
app.post('/api/sponsors/reorder', requireAuthAPI, async (req, res) => {
	try {
		const { order } = req.body; // Array of { id, order }

		if (!Array.isArray(order)) {
			return res.status(400).json({ success: false, error: 'Order must be an array' });
		}

		const state = loadSponsorState();

		order.forEach(({ id, order: newOrder }) => {
			const sponsor = state.sponsors.find(s => s.id === id);
			if (sponsor) {
				sponsor.order = newOrder;
				sponsor.updatedAt = new Date().toISOString();
			}
		});

		saveSponsorState(state);

		// Restart rotation with new order
		if (state.config.enabled && state.config.rotationEnabled) {
			startSponsorRotation();
		}

		res.json({ success: true, message: 'Order updated' });
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get sponsor config
app.get('/api/sponsors/config', requireAuthAPI, async (req, res) => {
	try {
		const state = loadSponsorState();
		res.json({ success: true, config: state.config });
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

// Update sponsor config
app.post('/api/sponsors/config', requireAuthAPI, async (req, res) => {
	try {
		const state = loadSponsorState();
		const { enabled, rotationEnabled, rotationInterval, rotationTransition, rotationOrder, timerViewEnabled, timerShowDuration, timerHideDuration, displays } = req.body;

		if (enabled !== undefined) state.config.enabled = Boolean(enabled);
		if (rotationEnabled !== undefined) state.config.rotationEnabled = Boolean(rotationEnabled);
		if (rotationInterval !== undefined) {
			state.config.rotationInterval = Math.min(Math.max(parseInt(rotationInterval, 10), 10), 300);
		}
		if (rotationTransition !== undefined) {
			state.config.rotationTransition = Math.min(Math.max(parseInt(rotationTransition, 10), 0), 5000);
		}
		if (rotationOrder !== undefined) {
			if (['sequential', 'random'].includes(rotationOrder)) {
				state.config.rotationOrder = rotationOrder;
			}
		}
		if (timerViewEnabled !== undefined) state.config.timerViewEnabled = Boolean(timerViewEnabled);
		if (timerShowDuration !== undefined) {
			state.config.timerShowDuration = Math.min(Math.max(parseInt(timerShowDuration, 10), 3), 300);
		}
		if (timerHideDuration !== undefined) {
			state.config.timerHideDuration = Math.min(Math.max(parseInt(timerHideDuration, 10), 3), 300);
		}
		if (displays !== undefined) {
			state.config.displays = {
				match: displays.match !== undefined ? Boolean(displays.match) : state.config.displays.match,
				bracket: displays.bracket !== undefined ? Boolean(displays.bracket) : state.config.displays.bracket
			};
		}

		saveSponsorState(state);

		// Update timers - Timer View takes priority over rotation
		if (state.config.enabled && state.config.timerViewEnabled) {
			stopSponsorRotation();
			startSponsorTimerView();
		} else if (state.config.enabled && state.config.rotationEnabled) {
			stopSponsorTimerView();
			startSponsorRotation();
		} else {
			stopSponsorTimerView();
			stopSponsorRotation();
		}

		// Broadcast config update
		io.emit('sponsor:config', { config: state.config });

		console.log(`[Sponsors] Config updated: enabled=${state.config.enabled}, rotation=${state.config.rotationEnabled}, timerView=${state.config.timerViewEnabled}`);

		res.json({ success: true, config: state.config });
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

// Show sponsor(s) on displays
app.post('/api/sponsors/show', requireAuthAPI, async (req, res) => {
	try {
		const { sponsorId, position, all, duration = 0, realtimeUpdate, offsetX, offsetY } = req.body;
		const state = loadSponsorState();

		let sponsorsToShow = [];

		if (sponsorId) {
			// Show specific sponsor
			const sponsor = state.sponsors.find(s => s.id === sponsorId);
			if (sponsor) {
				// If this is a real-time update with custom offsets, use them temporarily
				if (realtimeUpdate && (offsetX !== undefined || offsetY !== undefined)) {
					sponsorsToShow.push({
						...sponsor,
						offsetX: offsetX !== undefined ? offsetX : (sponsor.offsetX || 0),
						offsetY: offsetY !== undefined ? offsetY : (sponsor.offsetY || 0)
					});
				} else {
					sponsorsToShow.push(sponsor);
				}
			}
		} else if (position) {
			// Show first active sponsor at position
			const sponsor = state.sponsors
				.filter(s => s.active && s.position === position)
				.sort((a, b) => a.order - b.order)[0];
			if (sponsor) {
				sponsorsToShow.push(sponsor);
			}
		} else if (all) {
			// Show all active sponsors (one per position)
			const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-banner', 'bottom-banner'];
			positions.forEach(pos => {
				const sponsor = state.sponsors
					.filter(s => s.active && s.position === pos)
					.sort((a, b) => a.order - b.order)[0];
				if (sponsor) {
					sponsorsToShow.push(sponsor);
				}
			});
		}

		if (sponsorsToShow.length === 0) {
			return res.status(400).json({ success: false, error: 'No sponsors to show' });
		}

		// Format sponsors for display - MagicMirror expects object keyed by position
		const sponsorData = {};
		sponsorsToShow.forEach(s => {
			sponsorData[s.position] = {
				id: s.id,
				filename: s.filename,
				name: s.name,
				position: s.position,
				type: s.type,
				size: s.size,
				opacity: s.opacity,
				borderRadius: s.borderRadius || 0,
				offsetX: s.offsetX || 0,
				offsetY: s.offsetY || 0,
				active: true
			};
		});

		// Broadcast via WebSocket
		io.emit('sponsor:show', {
			sponsors: sponsorData,
			duration: duration > 0 ? Math.min(Math.max(duration, 10), 3600) : 0
		});

		// Also send via HTTP to MagicMirror modules
		const matchEnabled = state.config.displays?.match !== false;
		const bracketEnabled = state.config.displays?.bracket !== false;

		if (matchEnabled && process.env.SPONSOR_MATCH_API_URL) {
			try {
				await axios.post(`${process.env.SPONSOR_MATCH_API_URL}/api/sponsor/show`, {
					sponsors: sponsorData,
					duration: duration > 0 ? Math.min(Math.max(duration, 10), 3600) : 0
				}, { timeout: 5000 });
			} catch (httpError) {
				console.warn(`[Sponsors] HTTP push to match failed: ${httpError.message}`);
			}
		}

		if (bracketEnabled && process.env.SPONSOR_BRACKET_API_URL) {
			try {
				await axios.post(`${process.env.SPONSOR_BRACKET_API_URL}/api/sponsor/show`, {
					sponsors: sponsorData,
					duration: duration > 0 ? Math.min(Math.max(duration, 10), 3600) : 0
				}, { timeout: 5000 });
			} catch (httpError) {
				console.warn(`[Sponsors] HTTP push to bracket failed: ${httpError.message}`);
			}
		}

		console.log(`[Sponsors] Showing ${Object.keys(sponsorData).length} sponsor(s)`);

		res.json({
			success: true,
			message: `Showing ${Object.keys(sponsorData).length} sponsor(s)`,
			showing: sponsorData
		});
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

// Hide sponsor(s) from displays
app.post('/api/sponsors/hide', requireAuthAPI, async (req, res) => {
	try {
		const { position, all = true } = req.body;
		const state = loadSponsorState();

		// Broadcast hide via WebSocket
		io.emit('sponsor:hide', { position, all: all || !position });

		// Also send via HTTP to MagicMirror modules
		const matchEnabled = state.config.displays?.match !== false;
		const bracketEnabled = state.config.displays?.bracket !== false;

		if (matchEnabled && process.env.SPONSOR_MATCH_API_URL) {
			try {
				await axios.post(`${process.env.SPONSOR_MATCH_API_URL}/api/sponsor/hide`, {
					position,
					all: all || !position
				}, { timeout: 5000 });
			} catch (httpError) {
				console.warn(`[Sponsors] HTTP hide to match failed: ${httpError.message}`);
			}
		}

		if (bracketEnabled && process.env.SPONSOR_BRACKET_API_URL) {
			try {
				await axios.post(`${process.env.SPONSOR_BRACKET_API_URL}/api/sponsor/hide`, {
					position,
					all: all || !position
				}, { timeout: 5000 });
			} catch (httpError) {
				console.warn(`[Sponsors] HTTP hide to bracket failed: ${httpError.message}`);
			}
		}

		console.log(`[Sponsors] Hidden: ${position || 'all'}`);

		res.json({ success: true, message: 'Sponsors hidden' });
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

// ============================================
// Game Configuration API Endpoints
// ============================================

// GET /api/games - List all games with configs
app.get('/api/games', requireAuthAPI, (req, res) => {
	try {
		const configs = loadGameConfigs();
		const games = Object.entries(configs).map(([key, config]) => ({
			gameKey: key,
			name: config.name || key,
			shortName: config.shortName || '',
			rules: config.rules || [],
			prizes: config.prizes || [],
			additionalInfo: config.additionalInfo || [],
			isDefault: key === 'default'
		}));

		res.json({
			success: true,
			games,
			totalGames: games.length
		});
	} catch (error) {
		console.error('[Game Configs] Error listing games:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// GET /api/games/:gameKey - Get single game config
app.get('/api/games/:gameKey', requireAuthAPI, (req, res) => {
	try {
		const { gameKey } = req.params;
		const configs = loadGameConfigs();

		if (!configs[gameKey]) {
			return res.status(404).json({ success: false, error: 'Game not found' });
		}

		res.json({
			success: true,
			gameKey,
			config: configs[gameKey]
		});
	} catch (error) {
		console.error('[Game Configs] Error getting game:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// POST /api/games - Create new game
app.post('/api/games', requireAuthAPI, requireAdmin, (req, res) => {
	try {
		const { gameKey, name, shortName, rules, prizes, additionalInfo } = req.body;

		if (!gameKey || !name) {
			return res.status(400).json({ success: false, error: 'gameKey and name are required' });
		}

		if (!validateGameKey(gameKey)) {
			return res.status(400).json({
				success: false,
				error: 'Invalid game key. Use lowercase letters, numbers, and underscores only. Must start with a letter.'
			});
		}

		const configs = loadGameConfigs();

		if (configs[gameKey]) {
			return res.status(400).json({ success: false, error: 'Game key already exists' });
		}

		// Create new game config
		configs[gameKey] = {
			name: name.trim(),
			shortName: (shortName || '').trim(),
			rules: rules || [],
			prizes: prizes || [
				{ place: 1, position: '1st Place', emoji: '', amount: 30, gradient: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)', extras: [] },
				{ place: 2, position: '2nd Place', emoji: '', amount: 20, gradient: 'linear-gradient(135deg, #c0c0c0 0%, #909090 100%)', extras: [] },
				{ place: 3, position: '3rd Place', emoji: '', amount: 10, gradient: 'linear-gradient(135deg, #cd7f32 0%, #8b5a2b 100%)', extras: [] }
			],
			additionalInfo: additionalInfo || []
		};

		saveGameConfigs(configs);

		logActivity(req.session.userId, req.session.username, 'create_game', {
			gameKey,
			name: configs[gameKey].name
		});

		console.log(`[Game Configs] Created game: ${gameKey}`);

		res.json({
			success: true,
			message: 'Game created successfully',
			gameKey,
			config: configs[gameKey]
		});
	} catch (error) {
		console.error('[Game Configs] Error creating game:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// PUT /api/games/:gameKey - Update game config
app.put('/api/games/:gameKey', requireAuthAPI, requireAdmin, (req, res) => {
	try {
		const { gameKey } = req.params;
		const { name, shortName, rules, prizes, additionalInfo, newGameKey } = req.body;

		const configs = loadGameConfigs();

		if (!configs[gameKey]) {
			return res.status(404).json({ success: false, error: 'Game not found' });
		}

		// Handle rename
		if (newGameKey && newGameKey !== gameKey) {
			if (gameKey === 'default') {
				return res.status(400).json({ success: false, error: 'Cannot rename the default game' });
			}

			if (!validateGameKey(newGameKey)) {
				return res.status(400).json({
					success: false,
					error: 'Invalid new game key. Use lowercase letters, numbers, and underscores only.'
				});
			}

			if (configs[newGameKey]) {
				return res.status(400).json({ success: false, error: 'New game key already exists' });
			}

			// Move config to new key
			configs[newGameKey] = configs[gameKey];
			delete configs[gameKey];

			console.log(`[Game Configs] Renamed game: ${gameKey} -> ${newGameKey}`);
		}

		const targetKey = newGameKey || gameKey;

		// Update fields if provided
		if (name !== undefined) configs[targetKey].name = name.trim();
		if (shortName !== undefined) configs[targetKey].shortName = shortName.trim();
		if (rules !== undefined) configs[targetKey].rules = rules;
		if (prizes !== undefined) configs[targetKey].prizes = prizes;
		if (additionalInfo !== undefined) configs[targetKey].additionalInfo = additionalInfo;

		saveGameConfigs(configs);

		logActivity(req.session.userId, req.session.username, 'update_game', {
			gameKey: targetKey,
			name: configs[targetKey].name,
			renamed: newGameKey && newGameKey !== gameKey ? { from: gameKey, to: newGameKey } : undefined
		});

		console.log(`[Game Configs] Updated game: ${targetKey}`);

		res.json({
			success: true,
			message: 'Game updated successfully',
			gameKey: targetKey,
			config: configs[targetKey]
		});
	} catch (error) {
		console.error('[Game Configs] Error updating game:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// DELETE /api/games/:gameKey - Delete game
app.delete('/api/games/:gameKey', requireAuthAPI, requireAdmin, (req, res) => {
	try {
		const { gameKey } = req.params;

		if (gameKey === 'default') {
			return res.status(400).json({ success: false, error: 'Cannot delete the default game' });
		}

		const configs = loadGameConfigs();

		if (!configs[gameKey]) {
			return res.status(404).json({ success: false, error: 'Game not found' });
		}

		const deletedName = configs[gameKey].name;
		delete configs[gameKey];

		saveGameConfigs(configs);

		logActivity(req.session.userId, req.session.username, 'delete_game', {
			gameKey,
			name: deletedName
		});

		console.log(`[Game Configs] Deleted game: ${gameKey}`);

		res.json({
			success: true,
			message: 'Game deleted successfully',
			deletedGameKey: gameKey
		});
	} catch (error) {
		console.error('[Game Configs] Error deleting game:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Create a new tournament on Challonge
app.post('/api/tournaments/create', async (req, res) => {
	console.log('=== Tournament Creation Request ===');
	console.log('Session user:', req.session?.username || 'NOT AUTHENTICATED');
	console.log('Request body:', JSON.stringify(req.body, null, 2));

	const apiKey = getChallongeApiKey();

	if (!apiKey) {
		console.log('ERROR: Challonge not connected');
		return res.status(500).json({
			success: false,
			error: 'Challonge not connected. Please connect your account in Settings.'
		});
	}

	const {
		// Basic info
		name,
		tournamentType,
		gameName,
		description,

		// Schedule
		startAt,
		checkInDuration,
		signupCap,

		// Format-specific options
		grandFinalsModifier,
		holdThirdPlaceMatch,

		// Round Robin options
		rrIterations,
		rankedBy,
		rrMatchWin,
		rrMatchTie,
		rrGameWin,
		rrGameTie,

		// Swiss options
		swissRounds,
		swissMatchWin,
		swissMatchTie,
		swissBye,
		swissGameWin,
		swissGameTie,

		// Seeding & Display
		hideSeeds,
		sequentialPairings,
		showRounds,

		// Station options
		autoAssign,

		// Group Stage options (for elimination formats)
		groupStageEnabled,
		groupStageOptions,

		// Registration & Privacy
		openSignup,
		privateTournament,
		hideForum,

		// Match Settings
		acceptAttachments,
		// quickAdvance: NOT supported by Challonge v2.1 API

		// Notifications
		notifyMatchOpen,
		notifyTournamentEnd
	} = req.body;

	// Validation
	if (!name || !name.trim()) {
		console.log('ERROR: Tournament name is required');
		return res.status(400).json({
			success: false,
			error: 'Tournament name is required'
		});
	}

	if (name.length > 60) {
		return res.status(400).json({
			success: false,
			error: 'Tournament name must be 60 characters or less'
		});
	}

	try {
		// Generate URL in format: venue_game_monYY_xxxx
		// Example: neilsbahr_mkw_dec25_a7x2

		// Helper: Abbreviate game names
		const abbreviateGame = (game) => {
			if (!game) return 'tournament';
			const gameMap = {
				'super smash bros. ultimate': 'ssbu',
				'super smash bros ultimate': 'ssbu',
				'smash ultimate': 'ssbu',
				'ssbu': 'ssbu',
				'super smash bros. melee': 'melee',
				'super smash bros melee': 'melee',
				'melee': 'melee',
				'mario kart 8': 'mk8',
				'mario kart 8 deluxe': 'mk8',
				'mk8': 'mk8',
				'mario kart world': 'mkw',
				'mkw': 'mkw',
				'street fighter 6': 'sf6',
				'sf6': 'sf6',
				'tekken 8': 'tekken8',
				'guilty gear strive': 'ggst',
				'mortal kombat 1': 'mk1',
				'dead or alive xtreme beach volleyball': 'doaxbv',
				'doaxbv': 'doaxbv'
			};
			const lower = game.toLowerCase().trim();
			if (gameMap[lower]) return gameMap[lower];
			// Fallback: take first letters of each word (max 4 chars)
			return lower.split(/\s+/).map(w => w[0]).join('').substring(0, 4);
		};

		// Helper: Extract venue from tournament name
		const extractVenue = (tournamentName) => {
			// Try to find venue after @ symbol: "Game Night @ Venue Name - ..."
			const atMatch = tournamentName.match(/@\s*([^-]+)/i);
			if (atMatch) {
				return atMatch[1].trim().toLowerCase()
					.replace(/[^a-z0-9]/g, '')
					.substring(0, 12);
			}
			// Fallback: use first meaningful word
			return tournamentName.toLowerCase()
				.replace(/[^a-z0-9\s]/g, '')
				.split(/\s+/)
				.find(w => w.length > 2 && !['game', 'night', 'the', 'tournament'].includes(w))
				|| 'event';
		};

		// Helper: Format month and year
		const formatMonthYear = (dateStr) => {
			const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
			let date;
			if (dateStr) {
				date = new Date(dateStr);
			} else {
				date = new Date();
			}
			const month = months[date.getMonth()];
			const year = String(date.getFullYear()).slice(-2);
			return `${month}${year}`;
		};

		// Helper: Generate short random suffix
		const randomSuffix = () => {
			return Math.random().toString(36).substring(2, 6);
		};

		// Build the URL
		const venue = extractVenue(name);
		const game = abbreviateGame(gameName);
		const monthYear = formatMonthYear(startAt);
		const suffix = randomSuffix();

		const uniqueUrl = `${venue}_${game}_${monthYear}_${suffix}`;
		console.log(`[Tournament Create] Generated URL: ${uniqueUrl} (venue: ${venue}, game: ${game}, date: ${monthYear})`);

		// Build tournament parameters
		const tournamentParams = {
			name: name.trim(),
			url: uniqueUrl,
			tournament_type: tournamentType || 'single elimination',
			game_name: gameName || null,
			description: description || '',
			private: !!privateTournament,
			open_signup: !!openSignup,
			hide_forum: !!hideForum,
			notify_users_when_matches_open: !!notifyMatchOpen,
			notify_users_when_the_tournament_ends: !!notifyTournamentEnd,
			accept_attachments: !!acceptAttachments
			// quick_advance: NOT supported by Challonge v2.1 API
		};

		// Schedule parameters
		if (startAt) {
			// Convert datetime-local format (YYYY-MM-DDTHH:mm) to ISO 8601 for Challonge
			const startDate = new Date(startAt);
			if (!isNaN(startDate.getTime())) {
				tournamentParams.start_at = startDate.toISOString();
				console.log(`[Tournament Create] Converted startAt: ${startAt} -> ${tournamentParams.start_at}`);
			} else {
				console.log(`[Tournament Create] Invalid startAt date: ${startAt}`);
			}
		}

		if (checkInDuration && parseInt(checkInDuration) > 0) {
			tournamentParams.check_in_duration = parseInt(checkInDuration);
		}

		if (signupCap && parseInt(signupCap) > 0) {
			tournamentParams.signup_cap = parseInt(signupCap);
		}

		// Seeding & Display options
		if (hideSeeds) {
			tournamentParams.hide_seeds = true;
		}

		if (sequentialPairings) {
			tournamentParams.sequential_pairings = true;
		}

		if (showRounds) {
			tournamentParams.show_rounds = true;
		}

		// Station auto-assign option
		if (autoAssign) {
			tournamentParams.auto_assign = true;
		}

		// Double elimination specific options
		if (tournamentType === 'double elimination' && grandFinalsModifier) {
			tournamentParams.grand_finals_modifier = grandFinalsModifier;
		}

		// Single elimination specific options
		if (tournamentType === 'single elimination' && holdThirdPlaceMatch) {
			tournamentParams.hold_third_place_match = true;
		}

		// Round Robin specific options
		if (tournamentType === 'round robin') {
			if (rankedBy) {
				tournamentParams.ranked_by = rankedBy;
			}

			// Round Robin point values (only for custom ranking)
			if (rankedBy === 'custom') {
				if (rrMatchWin !== undefined) tournamentParams.rr_pts_for_match_win = parseFloat(rrMatchWin);
				if (rrMatchTie !== undefined) tournamentParams.rr_pts_for_match_tie = parseFloat(rrMatchTie);
				if (rrGameWin !== undefined) tournamentParams.rr_pts_for_game_win = parseFloat(rrGameWin);
				if (rrGameTie !== undefined) tournamentParams.rr_pts_for_game_tie = parseFloat(rrGameTie);
			}

			// Round Robin iterations (how many times everyone plays each other)
			if (rrIterations && parseInt(rrIterations) > 1) {
				// Note: The API doesn't have a direct parameter for this in v1
				// This would need v2.1 API with round_robin_options.iterations
			}
		}

		// Swiss specific options
		if (tournamentType === 'swiss') {
			if (swissRounds && parseInt(swissRounds) > 0) {
				tournamentParams.swiss_rounds = parseInt(swissRounds);
			}

			// Swiss point values
			if (swissMatchWin !== undefined) tournamentParams.pts_for_match_win = parseFloat(swissMatchWin);
			if (swissMatchTie !== undefined) tournamentParams.pts_for_match_tie = parseFloat(swissMatchTie);
			if (swissBye !== undefined) tournamentParams.pts_for_bye = parseFloat(swissBye);
			if (swissGameWin !== undefined) tournamentParams.pts_for_game_win = parseFloat(swissGameWin);
			if (swissGameTie !== undefined) tournamentParams.pts_for_game_tie = parseFloat(swissGameTie);
		}

		// Group Stage options (for elimination tournaments only)
		if ((tournamentType === 'single elimination' || tournamentType === 'double elimination') && groupStageEnabled) {
			tournamentParams.group_stage_enabled = true;
			if (groupStageOptions) {
				tournamentParams.group_stage_options = {
					stage_type: groupStageOptions.stageType || 'round robin',
					group_size: parseInt(groupStageOptions.groupSize) || 4,
					participant_count_to_advance_per_group: parseInt(groupStageOptions.participantCountToAdvance) || 2,
					ranked_by: groupStageOptions.rankedBy || 'match wins'
				};
			}
		}

		// Create tournament via Challonge API v2.1
		console.log('Calling Challonge API v2.1 to create tournament:', tournamentParams.name);
		console.log('Tournament params:', JSON.stringify(tournamentParams, null, 2));

		// Build v2.1 JSON:API payload
		const v2Payload = {
			data: {
				type: 'tournaments',
				attributes: {
					name: tournamentParams.name,
					url: tournamentParams.url,
					tournament_type: tournamentParams.tournament_type,
					game_name: tournamentParams.game_name,
					description: tournamentParams.description,
					private: tournamentParams.private,
					open_signup: tournamentParams.open_signup,
					hide_forum: tournamentParams.hide_forum,
					notify_users_when_matches_open: tournamentParams.notify_users_when_matches_open,
					notify_users_when_the_tournament_ends: tournamentParams.notify_users_when_the_tournament_ends,
					accept_attachments: tournamentParams.accept_attachments,
					// quick_advance: NOT supported by Challonge v2.1 API
					hide_seeds: tournamentParams.hide_seeds,
					sequential_pairings: tournamentParams.sequential_pairings,
					show_rounds: tournamentParams.show_rounds
				}
			}
		};

		// Add optional fields if set
		if (tournamentParams.signup_cap) v2Payload.data.attributes.signup_cap = tournamentParams.signup_cap;
		if (tournamentParams.start_at) v2Payload.data.attributes.starts_at = tournamentParams.start_at;
		if (tournamentParams.check_in_duration) v2Payload.data.attributes.check_in_duration = tournamentParams.check_in_duration;

		// Format-specific options using v2.1 nested structure
		// Double elimination: grand_finals_modifier goes in double_elimination_options
		if (tournamentParams.grand_finals_modifier) {
			v2Payload.data.attributes.double_elimination_options = {
				grand_finals_modifier: tournamentParams.grand_finals_modifier
			};
		}
		// Single elimination: hold_third_place_match goes in match_options.consolation_matches_target_rank
		if (tournamentParams.hold_third_place_match) {
			v2Payload.data.attributes.match_options = v2Payload.data.attributes.match_options || {};
			v2Payload.data.attributes.match_options.consolation_matches_target_rank = 3;
		}

		// Round robin options
		if (tournamentParams.rr_iterations) v2Payload.data.attributes.rr_iterations = tournamentParams.rr_iterations;
		if (tournamentParams.ranked_by) v2Payload.data.attributes.ranked_by = tournamentParams.ranked_by;
		if (tournamentParams.rr_pts_for_match_win !== undefined) v2Payload.data.attributes.rr_pts_for_match_win = tournamentParams.rr_pts_for_match_win;
		if (tournamentParams.rr_pts_for_match_tie !== undefined) v2Payload.data.attributes.rr_pts_for_match_tie = tournamentParams.rr_pts_for_match_tie;
		if (tournamentParams.rr_pts_for_game_win !== undefined) v2Payload.data.attributes.rr_pts_for_game_win = tournamentParams.rr_pts_for_game_win;
		if (tournamentParams.rr_pts_for_game_tie !== undefined) v2Payload.data.attributes.rr_pts_for_game_tie = tournamentParams.rr_pts_for_game_tie;

		// Swiss options
		if (tournamentParams.swiss_rounds) v2Payload.data.attributes.swiss_rounds = tournamentParams.swiss_rounds;
		if (tournamentParams.pts_for_match_win !== undefined) v2Payload.data.attributes.pts_for_match_win = tournamentParams.pts_for_match_win;
		if (tournamentParams.pts_for_match_tie !== undefined) v2Payload.data.attributes.pts_for_match_tie = tournamentParams.pts_for_match_tie;
		if (tournamentParams.pts_for_bye !== undefined) v2Payload.data.attributes.pts_for_bye = tournamentParams.pts_for_bye;
		if (tournamentParams.pts_for_game_win !== undefined) v2Payload.data.attributes.pts_for_game_win = tournamentParams.pts_for_game_win;
		if (tournamentParams.pts_for_game_tie !== undefined) v2Payload.data.attributes.pts_for_game_tie = tournamentParams.pts_for_game_tie;

		// Group Stage options (for elimination tournaments)
		if (tournamentParams.group_stage_enabled) {
			v2Payload.data.attributes.group_stage_enabled = true;
			if (tournamentParams.group_stage_options) {
				v2Payload.data.attributes.group_stage_options = tournamentParams.group_stage_options;
			}
		}

		const response = await challongeV2Request('POST', '/tournaments.json', v2Payload);

		const tournamentData = response.data.data;
		const attrs = tournamentData.attributes;
		const timestamps = attrs.timestamps || {};

		console.log('SUCCESS: Tournament created on Challonge');
		console.log('Tournament ID:', tournamentData.id);
		console.log('Tournament URL:', attrs.url);

		// Invalidate tournaments list cache
		cacheDb.invalidateCache('tournaments', 'list');

		res.json({
			success: true,
			message: 'Tournament created successfully',
			tournament: {
				id: parseInt(tournamentData.id),
				tournamentId: attrs.url,
				name: attrs.name,
				game: attrs.game_name,
				state: attrs.state,
				url: attrs.full_challonge_url,
				tournamentType: attrs.tournament_type,
				startAt: timestamps.starts_at || attrs.starts_at,
				signupCap: attrs.signup_cap,
				checkInDuration: attrs.check_in_duration
			}
		});
	} catch (error) {
		console.error('=== Tournament Creation FAILED ===');
		console.error('Error status:', error.response?.status);
		console.error('Error data:', JSON.stringify(error.response?.data, null, 2));
		console.error('Error message:', error.message);

		// Extract meaningful error message from Challonge response
		let errorMessage = 'Failed to create tournament';
		if (error.response?.data?.errors) {
			const errors = error.response.data.errors;
			if (Array.isArray(errors)) {
				errorMessage = errors.join(', ');
			} else if (typeof errors === 'object') {
				// Handle errors like {name: ["has already been taken"]}
				errorMessage = Object.entries(errors)
					.map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
					.join('; ');
			}
		} else if (error.response?.status === 422) {
			errorMessage = 'Invalid tournament data - check that name is unique';
		} else if (error.message) {
			errorMessage = error.message;
		}

		res.status(error.response?.status || 500).json({
			success: false,
			error: errorMessage
		});
	}
});

// Get list of tournaments from Challonge (v2.1 API) - WITH CACHING
app.get('/api/tournaments', async (req, res) => {
	const apiKey = getChallongeApiKey();

	if (!apiKey) {
		return res.status(500).json({
			success: false,
			error: 'Challonge not connected. Please connect your account in Settings.'
		});
	}

	try {
		// Get filter parameter (default: 90 days, 0 = show all)
		// Using 90 days to catch tournaments created months ago but scheduled for upcoming dates
		const daysFilter = parseInt(req.query.days) || 90;
		const cacheKey = `list_${daysFilter}`;
		const forceRefresh = req.query.refresh === 'true';

		// Try to get from cache (unless force refresh requested)
		if (!forceRefresh) {
			const cached = cacheDb.getCachedData('tournaments', cacheKey);
			if (cached && !cached.isExpired) {
				return res.json({
					...cached.data,
					_cache: cached._cache
				});
			}
		}

		// Fetch tournaments from all states separately using v2.1 API
		// Note: Challonge API states: pending, underway, group_stages_underway, awaiting_review, complete
		const states = ['pending', 'underway', 'group_stages_underway', 'awaiting_review', 'complete'];
		const fetchPromises = states.map(state => {
			return challongeV2Request('GET', `/tournaments.json?state=${state}`)
				.catch(err => {
					console.error(`Failed to fetch ${state} tournaments:`, err.message);
					return { data: { data: [] } }; // Return empty array on error
				});
		});

		const responses = await Promise.all(fetchPromises);

		// Combine and transform the data (excluding archived/stale tournaments)
		// Use a Map to deduplicate by tournament ID
		const tournamentMap = new Map();
		const now = new Date();
		const cutoffDate = new Date();
		if (daysFilter > 0) {
			cutoffDate.setDate(cutoffDate.getDate() - daysFilter);
		}

		responses.forEach(response => {
			const tournaments = response.data?.data || [];
			if (Array.isArray(tournaments)) {
				tournaments.forEach(item => {
					const attrs = item.attributes;
					const id = parseInt(item.id);

					// Skip if already processed (deduplication)
					if (tournamentMap.has(id)) {
						return;
					}

					// Get timestamps - v2.1 uses timestamps object
					const timestamps = attrs.timestamps || {};
					const startAt = timestamps.starts_at || attrs.starts_at;
					const startedAt = timestamps.started_at;
					const createdAt = timestamps.created_at || attrs.created_at;
					const completedAt = timestamps.completed_at;
					const updatedAt = timestamps.updated_at;

					// Skip archived tournaments
					if (timestamps.archived_at || attrs.archived === true) {
						return;
					}

					// Apply date filter for completed states
					const activeStates = ['pending', 'underway', 'group_stages_underway'];
					if (daysFilter > 0 && !activeStates.includes(attrs.state) && createdAt) {
						const createdDate = new Date(createdAt);
						if (createdDate < cutoffDate) {
							return; // Skip - tournament created before cutoff
						}
					}

					// Skip stale pending tournaments
					if (attrs.state === 'pending') {
						if (startAt) {
							// Has start date - skip if start date passed by more than 7 days
							const startDate = new Date(startAt);
							const daysSinceScheduled = (now - startDate) / (1000 * 60 * 60 * 24);
							if (daysSinceScheduled > 7) {
								return; // Skip - tournament was supposed to start more than 7 days ago
							}
						} else if (createdAt) {
							// No start date - skip if created more than 30 days ago (likely abandoned)
							const createdDate = new Date(createdAt);
							const daysSinceCreated = (now - createdDate) / (1000 * 60 * 60 * 24);
							if (daysSinceCreated > 30) {
								return; // Skip - old tournament with no scheduled start date
							}
						}
					}

					// Skip stale in-progress tournaments (underway for more than 7 days)
					if (attrs.state === 'underway' || attrs.state === 'awaiting_review' || attrs.state === 'group_stages_underway') {
						const referenceDate = startedAt || createdAt;
						if (referenceDate) {
							const refDate = new Date(referenceDate);
							const daysSinceStart = (now - refDate) / (1000 * 60 * 60 * 24);
							if (daysSinceStart > 7) {
								return; // Skip - tournament has been in progress too long (abandoned)
							}
						}
					}

					tournamentMap.set(id, {
						id: id,
						tournamentId: attrs.url, // This is the URL identifier
						name: attrs.name,
						game: attrs.game_name || 'Not specified',
						state: attrs.state, // pending, underway, awaiting_review, group_stages_underway, complete
						participants: attrs.participants_count,
						startedAt: startedAt,
						createdAt: createdAt,
						url: attrs.full_challonge_url,
						// Tournament metadata
						tournamentType: attrs.tournament_type || 'single elimination',
						checkInDuration: attrs.check_in_duration || null,
						startAt: startAt || null,
						signupCap: attrs.signup_cap || null,
						openSignup: attrs.open_signup || false,
						holdThirdPlaceMatch: attrs.hold_third_place_match || false,
						description: attrs.description || null,
						completedAt: completedAt || null,
						updatedAt: updatedAt || null
					});
				});
			}
		});

		// Convert Map to array
		const allTournaments = Array.from(tournamentMap.values());

		// Separate tournaments by state
		const categorized = {
			pending: allTournaments.filter(t => t.state === 'pending'),
			inProgress: allTournaments.filter(t => t.state === 'underway' || t.state === 'awaiting_review' || t.state === 'group_stages_underway'),
			completed: allTournaments.filter(t => t.state === 'complete')
		};

		// Build the response data
		const responseData = {
			success: true,
			tournaments: categorized,
			all: allTournaments,
			filter: {
				days: daysFilter,
				total: allTournaments.length,
				filteredByDate: daysFilter > 0,
				archivedExcluded: true
			}
		};

		// Cache the result
		cacheDb.setCachedData('tournaments', cacheKey, responseData);

		res.json({
			...responseData,
			_cache: {
				hit: false,
				source: 'api',
				cachedAt: new Date().toISOString(),
				ageSeconds: 0,
				stale: false
			}
		});
	} catch (error) {
		console.error('Failed to fetch tournaments:', error.message);

		// Try to serve stale cache on API failure
		const staleCache = cacheDb.getCachedData('tournaments', `list_${parseInt(req.query.days) || 90}`);
		if (staleCache) {
			console.log('[Cache] Serving stale tournament data due to API error');
			return res.json({
				...staleCache.data,
				_cache: {
					...staleCache._cache,
					stale: true,
					offline: true,
					error: error.message
				}
			});
		}

		res.status(500).json({
			success: false,
			error: 'Failed to fetch tournaments from Challonge',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Test Challonge API connection (v2.1 API)
// GET endpoint for simple API connectivity check (used by checklist)
app.get('/api/test-connection', requireAuthAPI, async (req, res) => {
	try {
		// Simple request to list tournaments - tests API connectivity
		const response = await challongeV2Request('GET', '/tournaments.json?page=1&per_page=1');
		res.json({
			success: true,
			message: 'Challonge API connection successful'
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: 'Failed to connect to Challonge API',
			details: error.message
		});
	}
});

// POST endpoint for testing connection with specific tournament
app.post('/api/test-connection', async (req, res) => {
	const { tournamentId } = req.body;

	if (!tournamentId) {
		return res.status(400).json({
			success: false,
			error: 'Tournament ID is required'
		});
	}

	try {
		const response = await challongeV2Request('GET', `/tournaments/${tournamentId}.json`);
		const tournamentData = response.data.data;
		const attrs = tournamentData.attributes;

		res.json({
			success: true,
			message: 'Connection successful',
			tournament: {
				name: attrs.name,
				state: attrs.state,
				participants: attrs.participants_count
			}
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: 'Failed to connect to Challonge',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Complete a tournament (v2.1 API)
app.post('/api/tournament/:tournamentId/complete', async (req, res) => {
	const { tournamentId } = req.params;

	try {
		// Finalize the tournament on Challonge using v2.1 change_state endpoint
		const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/change_state.json`, {
			data: {
				type: 'TournamentState',
				attributes: {
					state: 'finalize'
				}
			}
		});

		const finalizedData = response.data.data;
		const attrs = finalizedData.attributes;

		// Invalidate all caches for this tournament
		cacheDb.invalidateTournamentCaches(tournamentId);
		cacheDb.invalidateCache('tournaments', 'list');

		// Trigger rate mode check - tournament completed means it's no longer ACTIVE
		setTimeout(() => {
			console.log('[Tournament Complete] Triggering rate mode check after tournament finalized');
			checkTournamentsAndUpdateMode();
		}, 500);

		res.json({
			success: true,
			message: 'Tournament finalized successfully',
			tournament: {
				name: attrs.name,
				state: attrs.state
			}
		});
	} catch (error) {
		console.error('Tournament finalization error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to finalize tournament',
			details: error.response ? error.response.data : error.message
		});
	}
});

// ============================================
// PARTICIPANT MANAGEMENT API ENDPOINTS
// ============================================

// Get participant stats (lightweight endpoint for dashboard) (v2.1 API)
app.get('/api/participants/stats', async (req, res) => {
	try {
		// Read tournament ID from match state file
		const matchState = await readStateFile(process.env.MATCH_STATE_FILE);

		if (!matchState || !matchState.tournamentId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournamentId = matchState.tournamentId;

		// Fetch tournament details and participants from Challonge using v2.1
		const [tournamentResponse, participantsResponse] = await Promise.all([
			challongeV2Request('GET', `/tournaments/${tournamentId}.json`),
			challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json`)
		]);

		const tournamentData = tournamentResponse.data.data;
		const tournamentAttrs = tournamentData.attributes;
		const participants = participantsResponse.data.data || [];

		// Calculate stats
		const totalParticipants = participants.length;
		let withInstagram = 0;
		let latestSignupTime = null;

		participants.forEach(item => {
			const attrs = item.attributes;

			// Check if has Instagram in misc field
			if (attrs.misc && attrs.misc.match(/Instagram:/i)) {
				withInstagram++;
			}

			// Track latest signup
			const createdAt = attrs.timestamps?.created_at || attrs.created_at;
			if (createdAt) {
				const createdDate = new Date(createdAt);
				if (!latestSignupTime || createdDate > latestSignupTime) {
					latestSignupTime = createdDate;
				}
			}
		});

		const instagramPercentage = totalParticipants > 0
			? Math.round((withInstagram / totalParticipants) * 100)
			: 0;

		res.json({
			success: true,
			tournament: {
				id: parseInt(tournamentData.id),
				name: tournamentAttrs.name,
				gameName: tournamentAttrs.game_name,
				state: tournamentAttrs.state,
				url: tournamentAttrs.url,
				fullChallongeUrl: tournamentAttrs.full_challonge_url,
				startedAt: tournamentAttrs.timestamps?.started_at,
				completedAt: tournamentAttrs.timestamps?.completed_at
			},
			stats: {
				totalParticipants: totalParticipants,
				withInstagram: withInstagram,
				withoutInstagram: totalParticipants - withInstagram,
				instagramPercentage: instagramPercentage,
				latestSignupTime: latestSignupTime
			}
		});
	} catch (error) {
		console.error('Get participant stats error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to fetch participant stats',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Get all participants from active tournament (v2.1 API)
app.get('/api/participants', async (req, res) => {
	try {
		// Read tournament ID from match state file
		const matchState = await readStateFile(process.env.MATCH_STATE_FILE);

		if (!matchState || !matchState.tournamentId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournamentId = matchState.tournamentId;

		// Fetch tournament details and participants from Challonge using v2.1
		const [tournamentResponse, participantsResponse] = await Promise.all([
			challongeV2Request('GET', `/tournaments/${tournamentId}.json`),
			challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json`)
		]);

		const tournamentData = tournamentResponse.data.data;
		const tournamentAttrs = tournamentData.attributes;
		const participantsData = participantsResponse.data.data || [];

		// Process participants to extract Instagram from misc field
		const participants = participantsData.map(item => {
			const attrs = item.attributes;
			let instagram = '';

			// Extract Instagram handle from misc field
			if (attrs.misc) {
				const instagramMatch = attrs.misc.match(/Instagram:\s*@?([a-zA-Z0-9._]+)/i);
				if (instagramMatch) {
					instagram = instagramMatch[1];
				}
			}

			return {
				id: parseInt(item.id),
				tournamentId: parseInt(tournamentId),
				name: attrs.name || attrs.display_name || 'Unknown',
				seed: attrs.seed,
				instagram: instagram,
				misc: attrs.misc || '',
				finalRank: attrs.final_rank,
				createdAt: attrs.timestamps?.created_at || attrs.created_at
			};
		});

		// Sort by seed
		participants.sort((a, b) => (a.seed || 999) - (b.seed || 999));

		res.json({
			success: true,
			tournamentId: tournamentId,
			tournament: {
				id: parseInt(tournamentData.id),
				name: tournamentAttrs.name,
				gameName: tournamentAttrs.game_name,
				state: tournamentAttrs.state,
				participantsCount: tournamentAttrs.participants_count,
				url: tournamentAttrs.url
			},
			participants: participants,
			count: participants.length
		});
	} catch (error) {
		console.error('Get participants error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to fetch participants',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Add a new participant (v2.1 API)
app.post('/api/participants', async (req, res) => {
	const { participantName, instagram } = req.body;

	if (!participantName) {
		return res.status(400).json({
			success: false,
			error: 'Participant name is required'
		});
	}

	try {
		// Read tournament ID from match state file
		const matchState = await readStateFile(process.env.MATCH_STATE_FILE);

		if (!matchState || !matchState.tournamentId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournamentId = matchState.tournamentId;

		// Prepare misc field with Instagram if provided
		let misc = '';
		if (instagram) {
			const cleanInstagram = instagram.replace(/^@/, '').trim();
			misc = `Instagram: @${cleanInstagram}`;
		}

		// Add participant to Challonge using v2.1
		const v2Payload = {
			data: {
				type: 'participants',
				attributes: {
					name: participantName.trim(),
					misc: misc
				}
			}
		};

		const response = await challongeV2Request('POST', `/tournaments/${tournamentId}/participants.json`, v2Payload);
		const participantData = response.data.data;
		const attrs = participantData.attributes;

		res.json({
			success: true,
			message: 'Participant added successfully',
			participant: {
				id: parseInt(participantData.id),
				name: attrs.name,
				seed: attrs.seed,
				instagram: instagram ? instagram.replace(/^@/, '') : ''
			}
		});
	} catch (error) {
		console.error('Add participant error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to add participant',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Update a participant (v2.1 API)
app.put('/api/participants/:id', async (req, res) => {
	const { id } = req.params;
	const { participantName, instagram, misc, seed } = req.body;

	if (!participantName) {
		return res.status(400).json({
			success: false,
			error: 'Participant name is required'
		});
	}

	try {
		// Read tournament ID from match state file
		const matchState = await readStateFile(process.env.MATCH_STATE_FILE);

		if (!matchState || !matchState.tournamentId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournamentId = matchState.tournamentId;

		// Prepare misc field
		let miscField = misc || '';
		if (instagram) {
			const cleanInstagram = instagram.replace(/^@/, '').trim();
			// Update or add Instagram in misc field
			if (miscField.match(/Instagram:/i)) {
				miscField = miscField.replace(/Instagram:\s*@?[a-zA-Z0-9._]+/i, `Instagram: @${cleanInstagram}`);
			} else {
				miscField = miscField ? `Instagram: @${cleanInstagram}\n${miscField}` : `Instagram: @${cleanInstagram}`;
			}
		} else {
			// Remove Instagram from misc field if no instagram provided
			miscField = miscField.replace(/Instagram:\s*@?[a-zA-Z0-9._]+\n?/gi, '').trim();
		}

		// Prepare update payload for v2.1
		// misc must be a string (not null) for Challonge v2.1
		const attributes = {
			name: participantName.trim(),
			misc: miscField || ''
		};

		// Add seed if provided
		if (seed !== undefined && seed !== null) {
			attributes.seed = parseInt(seed);
		}

		const v2Payload = {
			data: {
				type: 'participants',
				attributes
			}
		};

		// Update participant on Challonge using v2.1
		const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/participants/${id}.json`, v2Payload);
		const participantData = response.data.data;
		const attrs = participantData.attributes;

		res.json({
			success: true,
			message: 'Participant updated successfully',
			participant: {
				id: parseInt(participantData.id),
				name: attrs.name,
				seed: attrs.seed
			}
		});
	} catch (error) {
		console.error('Update participant error:', error.message);
		console.error('Challonge error details:', JSON.stringify(error.response?.data, null, 2));

		// Parse Challonge error message for more helpful response
		let errorMessage = 'Failed to update participant';
		if (error.response?.data?.errors) {
			const errors = error.response.data.errors;
			if (Array.isArray(errors)) {
				errorMessage = errors.map(e => e.detail || e.title || e).join(', ');
			}
		}

		res.status(error.response?.status || 500).json({
			success: false,
			error: errorMessage,
			details: error.response ? error.response.data : error.message
		});
	}
});

// Randomize all participant seeds (v2.1 API)
app.post('/api/participants/randomize', requireAuthAPI, async (req, res) => {
	try {
		// Read tournament ID from match state file
		const matchState = await readStateFile(process.env.MATCH_STATE_FILE);

		if (!matchState || !matchState.tournamentId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournamentId = matchState.tournamentId;

		// Use v2.1 process endpoint for randomize
		const response = await challongeV2Request('POST', `/tournaments/${tournamentId}/participants/process.json`, {
			data: {
				type: 'ParticipantProcess',
				attributes: {
					action: 'randomize'
				}
			}
		});

		const participantsData = response.data.data || [];

		res.json({
			success: true,
			message: 'Participant seeds randomized successfully',
			participants: participantsData
		});
	} catch (error) {
		console.error('Randomize participants error:', error.message);
		console.error('Challonge error details:', JSON.stringify(error.response?.data, null, 2));

		let errorMessage = 'Failed to randomize participant seeds';
		if (error.response?.data?.errors) {
			const errors = error.response.data.errors;
			if (Array.isArray(errors)) {
				errorMessage = errors.map(e => e.detail || e.title || e).join(', ');
			}
		}

		res.status(error.response?.status || 500).json({
			success: false,
			error: errorMessage,
			details: error.response ? error.response.data : error.message
		});
	}
});

// Bulk add participants (v2.1 API)
app.post('/api/participants/bulk', requireAuthAPI, async (req, res) => {
	const { participants } = req.body;

	if (!participants || !Array.isArray(participants) || participants.length === 0) {
		return res.status(400).json({
			success: false,
			error: 'Participants array is required'
		});
	}

	try {
		// Read tournament ID from match state file
		const matchState = await readStateFile(process.env.MATCH_STATE_FILE);

		if (!matchState || !matchState.tournamentId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournamentId = matchState.tournamentId;

		// Format participants for v2.1 bulk add endpoint
		const formattedParticipants = participants.map(name => ({
			name: name.trim()
		}));

		// Use v2.1 bulk add endpoint
		const v2Payload = {
			data: {
				type: 'participants',
				attributes: {
					participants: formattedParticipants
				}
			}
		};

		const response = await challongeV2Request('POST', `/tournaments/${tournamentId}/participants/bulk_add.json`, v2Payload);
		const participantsData = response.data.data || [];

		res.json({
			success: true,
			message: `Successfully added ${formattedParticipants.length} participants`,
			participants: participantsData,
			count: formattedParticipants.length
		});
	} catch (error) {
		console.error('Bulk add participants error:', error.message);
		console.error('Challonge error details:', JSON.stringify(error.response?.data, null, 2));

		let errorMessage = 'Failed to bulk add participants';
		if (error.response?.data?.errors) {
			const errors = error.response.data.errors;
			if (Array.isArray(errors)) {
				errorMessage = errors.map(e => e.detail || e.title || e).join(', ');
			}
		}

		res.status(error.response?.status || 500).json({
			success: false,
			error: errorMessage,
			details: error.response ? error.response.data : error.message
		});
	}
});

// Delete a participant (v2.1 API)
app.delete('/api/participants/:id', async (req, res) => {
	const { id } = req.params;

	try {
		// Read tournament ID from match state file
		const matchState = await readStateFile(process.env.MATCH_STATE_FILE);

		if (!matchState || !matchState.tournamentId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournamentId = matchState.tournamentId;

		// Delete participant from Challonge using v2.1
		await challongeV2Request('DELETE', `/tournaments/${tournamentId}/participants/${id}.json`);

		res.json({
			success: true,
			message: 'Participant deleted successfully'
		});
	} catch (error) {
		console.error('Delete participant error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to delete participant',
			details: error.response ? error.response.data : error.message
		});
	}
});

// ============================================
// MATCH MANAGEMENT API ENDPOINTS
// ============================================

// Get matches for a tournament (v2.1 API) - with caching
app.get('/api/matches/:tournamentId', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId } = req.params;
	const apiKey = getChallongeApiKey();

	if (!apiKey) {
		return res.status(500).json({
			success: false,
			error: 'Challonge not connected. Please connect your account in Settings.'
		});
	}

	// Helper function to fetch matches from Challonge API
	const fetchMatchesFromAPI = async () => {
		// Fetch matches from v2.1 API with stations included
		const response = await challongeV2Request(
			'GET',
			`/tournaments/${tournamentId}/matches.json`
		);

		// Fetch participants for name resolution
		let participantMap = {}; // participantId -> name
		try {
			const participantsResponse = await challongeV2Request(
				'GET',
				`/tournaments/${tournamentId}/participants.json`
			);
			const participantsData = participantsResponse.data?.data || [];
			participantsData.forEach(item => {
				if (item.type === 'participant') {
					const attrs = item.attributes || {};
					const name = attrs.name || attrs.display_name || attrs.username ||
						(attrs.seed != null ? 'Seed ' + attrs.seed : 'Player ' + item.id);
					participantMap[String(item.id)] = name;
				}
			});
		} catch (participantError) {
			console.warn('Failed to fetch participants for name resolution:', participantError.message);
		}

		// Also fetch stations to build match-station mapping
		// (station relationships aren't in match response, they're in station objects)
		let stationMatchMap = {}; // matchId -> stationId
		let stationNameMap = {}; // stationId -> name
		try {
			// Note: Stations API requires legacy key - Challonge doesn't support OAuth scopes for stations
			const headers = getStationsApiHeaders();
			const stationsResponse = await rateLimitedAxios.get(
				`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations.json`,
				{ headers, timeout: 10000 }
			);

			if (stationsResponse.data?.data) {
				stationsResponse.data.data.forEach(station => {
					stationNameMap[station.id] = station.attributes?.name || 'Station';
					const matchData = station.relationships?.match?.data;
					if (matchData?.id) {
						stationMatchMap[matchData.id] = station.id;
					}
				});
			}
		} catch (stationError) {
			console.warn('Failed to fetch stations:', stationError.message);
		}

		const { data: matchesData } = parseV2Response(response);

		// Transform matches from v2.1 format
		const matches = (Array.isArray(matchesData) ? matchesData : [matchesData]).map(match => {
			const attrs = match.attributes;
			const relationships = match.relationships || {};

			// Get participant IDs from relationships (v2.1 structure) first
			// Fall back to points_by_participant if relationships not available
			let player1Id = relationships.player1?.data?.id || null;
			let player2Id = relationships.player2?.data?.id || null;

			// Fallback to points_by_participant if relationships don't have IDs
			if (!player1Id && !player2Id && attrs.points_by_participant && attrs.points_by_participant.length >= 2) {
				player1Id = attrs.points_by_participant[0]?.participant_id;
				player2Id = attrs.points_by_participant[1]?.participant_id;
			}

			// Resolve player names from participant map
			const player1Name = player1Id ? (participantMap[String(player1Id)] || 'TBD') : 'TBD';
			const player2Name = player2Id ? (participantMap[String(player2Id)] || 'TBD') : 'TBD';

			// Parse scores from v2.1 format
			let scores_csv = '';
			if (attrs.score_in_sets && attrs.score_in_sets.length > 0) {
				const lastSet = attrs.score_in_sets[attrs.score_in_sets.length - 1];
				if (lastSet && lastSet.length === 2) {
					scores_csv = `${lastSet[0]}-${lastSet[1]}`;
				}
			} else if (attrs.scores) {
				scores_csv = attrs.scores.replace(/\s/g, '');
			}

			return {
				id: parseInt(match.id),
				tournamentId: tournamentId,
				state: attrs.state,
				round: attrs.round,
				player1Id: player1Id,
				player2Id: player2Id,
				player1Name: player1Name,
				player2Name: player2Name,
				winnerId: attrs.winner_id,
				loserId: null,
				scores_csv: scores_csv,
				suggestedPlayOrder: attrs.suggested_play_order,
				identifier: attrs.identifier,
				startedAt: attrs.timestamps?.started_at,
				completedAt: attrs.timestamps?.completed_at,
				underwayAt: attrs.timestamps?.underway_at,
				stationId: stationMatchMap[String(match.id)] || null
			};
		});

		// Sort by suggested play order, then by round
		matches.sort((a, b) => {
			if (a.suggestedPlayOrder && b.suggestedPlayOrder) {
				return a.suggestedPlayOrder - b.suggestedPlayOrder;
			}
			return (a.round || 0) - (b.round || 0);
		});

		return { matches, count: matches.length };
	};

	try {
		// Use cache with stale-while-revalidate pattern
		const { data, _cache } = await cacheDb.getCachedOrFetch(
			'matches',
			tournamentId,
			fetchMatchesFromAPI
		);

		// Merge local underway tracking into match data
		// This handles the case where Challonge v2.1 change_state endpoint is broken
		const matchesWithLocalTracking = data.matches.map(match => {
			const trackingKey = `${tournamentId}:${match.id}`;
			const localUnderwayAt = localUnderwayTracking.get(trackingKey);

			if (localUnderwayAt && !match.underwayAt) {
				// Local tracking exists but Challonge doesn't have it
				return {
					...match,
					underwayAt: localUnderwayAt,
					localTracking: true
				};
			}
			return match;
		});

		res.json({
			success: true,
			matches: matchesWithLocalTracking,
			count: data.count,
			_cache
		});
	} catch (error) {
		console.error('Get matches error:', error.message);
		console.error('Error details:', error.response?.data);
		res.status(500).json({
			success: false,
			error: 'Failed to fetch matches',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Get match statistics for a tournament (v2.1 API) - Enhanced
app.get('/api/matches/:tournamentId/stats', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId } = req.params;
	const apiKey = getChallongeApiKey();

	if (!apiKey) {
		return res.status(500).json({
			success: false,
			error: 'Challonge not connected. Please connect your account in Settings.'
		});
	}

	try {
		const response = await challongeV2Request(
			'GET',
			`/tournaments/${tournamentId}/matches.json`
		);

		const { data: matchesData } = parseV2Response(response);
		const matches = Array.isArray(matchesData) ? matchesData : [matchesData];

		const total = matches.length;
		const completed = matches.filter(match => match.attributes?.state === 'complete').length;
		const remaining = total - completed;

		// Count in-progress matches (open with underway_at set)
		const inProgress = matches.filter(match => {
			const attrs = match.attributes || {};
			return attrs.state === 'open' && attrs.timestamps?.underway_at != null;
		}).length;

		// Find current round (highest round among open/underway matches)
		let currentRound = '--';
		const activeMatches = matches.filter(match => {
			const attrs = match.attributes || {};
			return attrs.state === 'open' || attrs.state === 'pending';
		});
		if (activeMatches.length > 0) {
			const rounds = activeMatches.map(m => m.attributes?.round).filter(r => r != null);
			if (rounds.length > 0) {
				// Get the minimum round number for winners bracket (positive rounds)
				// or the maximum for losers bracket (negative rounds)
				const positiveRounds = rounds.filter(r => r > 0);
				const negativeRounds = rounds.filter(r => r < 0);

				if (positiveRounds.length > 0 && negativeRounds.length > 0) {
					// Double elimination - show both
					const winnersRound = Math.min(...positiveRounds);
					const losersRound = Math.max(...negativeRounds);
					currentRound = `W${winnersRound}/L${Math.abs(losersRound)}`;
				} else if (positiveRounds.length > 0) {
					currentRound = `R${Math.min(...positiveRounds)}`;
				} else if (negativeRounds.length > 0) {
					currentRound = `L${Math.abs(Math.max(...negativeRounds))}`;
				}
			}
		}

		// Calculate average match time for completed matches
		let avgMatchTime = null;
		const completedMatches = matches.filter(match => match.attributes?.state === 'complete');
		if (completedMatches.length > 0) {
			const durations = completedMatches
				.map(match => {
					const attrs = match.attributes || {};
					const underwayAt = attrs.timestamps?.underway_at;
					const completedAt = attrs.timestamps?.completed_at;
					if (underwayAt && completedAt) {
						const start = new Date(underwayAt);
						const end = new Date(completedAt);
						return (end - start) / 1000; // seconds
					}
					return null;
				})
				.filter(d => d != null && d > 0 && d < 7200); // Filter out invalid or >2hr matches

			if (durations.length > 0) {
				avgMatchTime = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
			}
		}

		res.json({
			success: true,
			stats: {
				total,
				completed,
				remaining,
				inProgress,
				currentRound,
				avgMatchTime // in seconds
			}
		});
	} catch (error) {
		console.error('Get match stats error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to fetch match stats',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Get participants for a specific tournament (v2.1 API) - with caching
app.get('/api/participants/:tournamentId', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId } = req.params;

	// Helper function to fetch participants from Challonge API
	const fetchParticipantsFromAPI = async () => {
		const response = await challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json`);
		const participantsData = response.data.data || [];

		const participants = participantsData.map(item => {
			const p = item.attributes;
			// Extract Instagram from misc field if present
			let instagram = null;
			let misc = p.misc || '';
			const instagramMatch = misc.match(/Instagram:\s*@?([a-zA-Z0-9._]+)/i);
			if (instagramMatch) {
				instagram = instagramMatch[1];
			}
			return {
				id: parseInt(item.id),
				name: p.name || p.display_name || `Player ${item.id}`,
				displayName: p.display_name,
				seed: p.seed,
				instagram: instagram,
				misc: misc,
				email: p.email || null,
				challongeUsername: p.challonge_username || null,
				checkedIn: p.checked_in,
				checkedInAt: p.checked_in_at,
				canCheckIn: p.can_check_in,
				active: p.active,
				onWaitingList: p.on_waiting_list,
				invitationPending: p.invitation_pending,
				finalRank: p.final_rank,
				groupId: p.group_id,
				createdAt: p.timestamps?.created_at || p.created_at,
				updatedAt: p.timestamps?.updated_at || p.updated_at
			};
		});

		return participants;
	};

	try {
		// Use cache with stale-while-revalidate pattern
		const { data: participants, _cache } = await cacheDb.getCachedOrFetch(
			'participants',
			tournamentId,
			fetchParticipantsFromAPI
		);

		res.json({
			success: true,
			participants: participants,
			_cache
		});
	} catch (error) {
		console.error('Get participants error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to fetch participants',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Add participant to a specific tournament (v2.1 API)
app.post('/api/participants/:tournamentId', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId } = req.params;
	const { participantName, email, challongeUsername, instagram, seed } = req.body;

	// At least one identifier is required
	if (!participantName?.trim() && !email?.trim() && !challongeUsername?.trim()) {
		return res.status(400).json({
			success: false,
			error: 'At least a name, email, or Challonge username is required'
		});
	}

	try {
		// Build misc field with Instagram if provided
		let misc = '';
		if (instagram) {
			misc = `Instagram: @${instagram.replace('@', '')}`;
		}

		// Build participant payload for v2.1
		const attributes = {};
		if (participantName?.trim()) attributes.name = participantName.trim();
		if (email?.trim()) attributes.email = email.trim();
		if (challongeUsername?.trim()) attributes.challonge_username = challongeUsername.trim();
		if (misc) attributes.misc = misc;
		if (seed) attributes.seed = seed;

		const v2Payload = {
			data: {
				type: 'participants',
				attributes
			}
		};

		const response = await challongeV2Request('POST', `/tournaments/${tournamentId}/participants.json`, v2Payload);
		const participantData = response.data.data;

		// Invalidate participants cache
		cacheDb.invalidateCache('participants', tournamentId);

		// Schedule AI seeding recalculation (debounced)
		aiSeedingService.scheduleRecalculation(tournamentId);

		res.json({
			success: true,
			participant: {
				id: parseInt(participantData.id),
				...participantData.attributes
			}
		});
	} catch (error) {
		console.error('Add participant error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to add participant',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Update participant in a specific tournament (v2.1 API)
app.put('/api/participants/:tournamentId/:participantId', requireAuthAPI, async (req, res) => {
	const { tournamentId, participantId } = req.params;
	const { participantName, email, challongeUsername, instagram, misc, seed } = req.body;

	try {
		// Build misc field with Instagram
		let miscField = misc || '';
		if (instagram) {
			// Remove any existing Instagram line
			miscField = miscField.replace(/Instagram:\s*@?[a-zA-Z0-9._]+\n?/gi, '').trim();
			// Add new Instagram
			miscField = `Instagram: @${instagram.replace('@', '')}${miscField ? '\n' + miscField : ''}`;
		}

		const attributes = {};
		if (participantName) attributes.name = participantName.trim();
		if (email !== undefined) attributes.email = email?.trim() || null;
		if (challongeUsername !== undefined) attributes.challonge_username = challongeUsername?.trim() || null;
		// misc must be a string (not null) for Challonge v2.1
		if (miscField !== undefined) attributes.misc = miscField || '';
		if (seed !== undefined && seed !== null) attributes.seed = seed;

		const v2Payload = {
			data: {
				type: 'participants',
				attributes
			}
		};

		const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/participants/${participantId}.json`, v2Payload);
		const participantData = response.data.data;

		// Invalidate participants cache
		cacheDb.invalidateCache('participants', tournamentId);

		res.json({
			success: true,
			participant: {
				id: parseInt(participantData.id),
				...participantData.attributes
			}
		});
	} catch (error) {
		console.error('Update participant error:', error.message);
		console.error('Challonge error details:', JSON.stringify(error.response?.data, null, 2));
		console.error('Request payload was:', JSON.stringify(req.body, null, 2));

		// Parse error message
		let errorMessage = 'Failed to update participant';
		if (error.response?.data?.errors) {
			const errors = error.response.data.errors;
			if (Array.isArray(errors)) {
				errorMessage = errors.map(e => e.detail || e.title || e).join(', ');
			}
		}

		res.status(error.response?.status || 500).json({
			success: false,
			error: errorMessage,
			details: error.response ? error.response.data : error.message
		});
	}
});

// Delete participant from a specific tournament (v2.1 API)
app.delete('/api/participants/:tournamentId/:participantId', requireAuthAPI, async (req, res) => {
	const { tournamentId, participantId } = req.params;

	try {
		await challongeV2Request('DELETE', `/tournaments/${tournamentId}/participants/${participantId}.json`);

		// Invalidate participants cache
		cacheDb.invalidateCache('participants', tournamentId);

		// Schedule AI seeding recalculation (debounced)
		aiSeedingService.scheduleRecalculation(tournamentId);

		res.json({
			success: true,
			message: 'Participant deleted successfully'
		});
	} catch (error) {
		console.error('Delete participant error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to delete participant',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Randomize participants for a specific tournament (v2.1 API)
app.post('/api/participants/:tournamentId/randomize', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;

	try {
		// Use v2.1 process endpoint for randomize
		const response = await challongeV2Request('POST', `/tournaments/${tournamentId}/participants/process.json`, {
			data: {
				type: 'ParticipantProcess',
				attributes: {
					action: 'randomize'
				}
			}
		});

		const participantsData = response.data.data || [];

		// Invalidate participants cache
		cacheDb.invalidateCache('participants', tournamentId);

		res.json({
			success: true,
			message: 'Participants randomized successfully',
			participants: participantsData
		});
	} catch (error) {
		console.error('Randomize participants error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to randomize participants',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Bulk add participants to a specific tournament (v2.1 API)
app.post('/api/participants/:tournamentId/bulk', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;
	const { participants } = req.body;

	if (!participants || !Array.isArray(participants) || participants.length === 0) {
		return res.status(400).json({
			success: false,
			error: 'Participants array is required'
		});
	}

	try {
		// Format participants for v2.1 bulk add endpoint
		// Supports both string names and full participant objects
		const bulkData = participants.map(p => {
			if (typeof p === 'string') {
				return { name: p.trim() };
			}
			// Full participant object
			const participant = {};
			if (p.name) participant.name = p.name.trim();
			if (p.email) participant.email = p.email.trim();
			if (p.challongeUsername) participant.challonge_username = p.challongeUsername.trim();
			if (p.seed) participant.seed = p.seed;
			if (p.misc) participant.misc = p.misc.trim();
			return participant;
		});

		const v2Payload = {
			data: {
				type: 'participants',
				attributes: {
					participants: bulkData
				}
			}
		};

		const response = await challongeV2Request('POST', `/tournaments/${tournamentId}/participants/bulk_add.json`, v2Payload);
		const participantsData = response.data.data || [];

		// Invalidate participants cache
		cacheDb.invalidateCache('participants', tournamentId);

		// Schedule AI seeding recalculation (debounced)
		aiSeedingService.scheduleRecalculation(tournamentId);

		res.json({
			success: true,
			message: 'Participants added successfully',
			count: participantsData.length || bulkData.length,
			participants: participantsData
		});
	} catch (error) {
		console.error('Bulk add participants error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to add participants',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Check in a participant (v2.1 API)
app.post('/api/participants/:tournamentId/:participantId/check-in', requireAuthAPI, async (req, res) => {
	const { tournamentId, participantId } = req.params;

	try {
		// Use v2.1 process endpoint for check-in
		const response = await challongeV2Request('POST', `/tournaments/${tournamentId}/participants/${participantId}/process.json`, {
			data: {
				type: 'ParticipantProcess',
				attributes: {
					action: 'check_in'
				}
			}
		});

		const participantData = response.data.data;

		// Log activity
		const userId = req.session?.userId || 0;
		const username = req.session?.username || 'System';
		const playerName = participantData?.attributes?.name || 'Unknown';
		logActivity(userId, username, ACTIVITY_TYPES.PARTICIPANT_CHECKIN, {
			tournamentId,
			participantId,
			playerName
		});

		// Invalidate participants cache
		cacheDb.invalidateCache('participants', tournamentId);

		res.json({
			success: true,
			message: 'Participant checked in successfully',
			participant: participantData ? {
				id: parseInt(participantData.id),
				...participantData.attributes
			} : null
		});
	} catch (error) {
		console.error('Check in participant error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to check in participant',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Undo check-in for a participant (v2.1 API)
app.post('/api/participants/:tournamentId/:participantId/undo-check-in', requireAuthAPI, async (req, res) => {
	const { tournamentId, participantId } = req.params;

	try {
		// Use v2.1 process endpoint for undo check-in
		const response = await challongeV2Request('POST', `/tournaments/${tournamentId}/participants/${participantId}/process.json`, {
			data: {
				type: 'ParticipantProcess',
				attributes: {
					action: 'undo_check_in'
				}
			}
		});

		const participantData = response.data.data;

		// Log activity
		const userId = req.session?.userId || 0;
		const username = req.session?.username || 'System';
		const playerName = participantData?.attributes?.name || 'Unknown';
		logActivity(userId, username, ACTIVITY_TYPES.PARTICIPANT_CHECKOUT, {
			tournamentId,
			participantId,
			playerName
		});

		// Invalidate participants cache
		cacheDb.invalidateCache('participants', tournamentId);

		res.json({
			success: true,
			message: 'Check-in undone successfully',
			participant: participantData ? {
				id: parseInt(participantData.id),
				...participantData.attributes
			} : null
		});
	} catch (error) {
		console.error('Undo check in error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to undo check-in',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Clear all participants from a tournament (v2.1 API)
app.delete('/api/participants/:tournamentId/clear', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;

	try {
		// Use v2.1 process endpoint for clear
		await challongeV2Request('POST', `/tournaments/${tournamentId}/participants/process.json`, {
			data: {
				type: 'ParticipantProcess',
				attributes: {
					action: 'clear'
				}
			}
		});

		// Invalidate participants cache
		cacheDb.invalidateCache('participants', tournamentId);

		// Invalidate AI seeding cache since all participants are cleared
		analyticsDb.invalidateSeedingCache(tournamentId);

		res.json({
			success: true,
			message: 'All participants cleared successfully'
		});
	} catch (error) {
		console.error('Clear all participants error:', error.message);
		let errorMessage = 'Failed to clear participants';
		if (error.response?.data?.errors) {
			const errors = error.response.data.errors;
			if (Array.isArray(errors)) {
				errorMessage = errors.map(e => e.detail || e.title || e).join(', ');
			}
		}
		res.status(error.response?.status || 500).json({
			success: false,
			error: errorMessage,
			details: error.response ? error.response.data : error.message
		});
	}
});

// Mark match as underway (v2.1 API with v1 fallback)
// NOTE: Challonge v2.1 change_state endpoint is currently broken (returns 500)
// When v2.1 fails, we fall back to v1 API until v2.1 is fixed
app.post('/api/matches/:tournamentId/:matchId/underway', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId, matchId } = req.params;

	try {
		let matchData = null;
		let underwayAt = null;
		let usedV1Fallback = false;

		// Try v2.1 change_state endpoint first
		try {
			const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}/change_state.json`, {
				data: {
					type: 'MatchState',
					attributes: {
						state: 'mark_as_underway'
					}
				}
			});

			matchData = response.data?.data?.attributes;
			underwayAt = matchData?.timestamps?.underway_at || matchData?.underway_at;

			// Clear any local tracking if v2.1 succeeded
			const trackingKey = `${tournamentId}:${matchId}`;
			localUnderwayTracking.delete(trackingKey);

		} catch (v2Error) {
			// If v2.1 returns 500, fall back to v1 API
			if (v2Error.response?.status === 500) {
				console.log('[Underway] v2.1 API returned 500, trying v1 fallback...');

				try {
					const apiKey = getLegacyApiKey();
					if (!apiKey) {
						throw new Error('No legacy API key configured for v1 fallback');
					}
					const v1Response = await rateLimitedAxios.post(
						`https://api.challonge.com/v1/tournaments/${tournamentId}/matches/${matchId}/mark_as_underway.json`,
						null,
						{
							params: { api_key: apiKey },
							timeout: 15000
						}
					);

					matchData = v1Response.data?.match;
					underwayAt = matchData?.underway_at || new Date().toISOString();
					usedV1Fallback = true;

					// Clear any local tracking
					const trackingKey = `${tournamentId}:${matchId}`;
					localUnderwayTracking.delete(trackingKey);

					console.log('[Underway] v1 fallback succeeded');
				} catch (v1Error) {
					console.error('[Underway] v1 fallback also failed:', v1Error.message);
					throw v1Error;
				}
			} else {
				throw v2Error; // Not a 500 error, rethrow
			}
		}

		// Trigger immediate fetch and push to update TV display quickly
		fetchAndPushMatches().catch(err => {
			console.error('[Underway] Background fetch/push failed:', err.message);
		});

		// Log activity
		const userId = req.session?.userId || req.tokenUserId || 0;
		const username = req.session?.username || req.tokenUsername || 'API';
		logActivity(userId, username, ACTIVITY_TYPES.MATCH_START, {
			tournamentId,
			matchId,
			underwayAt: underwayAt,
			v1Fallback: usedV1Fallback
		});

		// Invalidate matches cache
		cacheDb.invalidateCache('matches', tournamentId);

		res.json({
			success: true,
			message: usedV1Fallback ? 'Match marked as underway (v1 fallback)' : 'Match marked as underway',
			match: matchData,
			underwayAt: underwayAt,
			v1Fallback: usedV1Fallback
		});
	} catch (error) {
		console.error('Mark underway error:', error.message);
		console.error('Full error:', JSON.stringify(error.response?.data, null, 2));
		console.error('Status:', error.response?.status);

		// Parse error details for better feedback
		const errorData = error.response?.data;
		let errorMessage = 'Failed to mark match as underway';

		// Check for specific Challonge error types
		if (error.response?.status === 422) {
			errorMessage = 'Match cannot be marked as underway (may already be underway or completed)';
		} else if (error.response?.status === 404) {
			errorMessage = 'Match not found';
		} else if (error.response?.status === 500) {
			errorMessage = 'Challonge server error - please try again';
		}

		res.status(error.response?.status || 500).json({
			success: false,
			error: errorMessage,
			details: errorData || error.message
		});
	}
});

// Unmark match as underway (v2.1 API with v1 fallback)
app.post('/api/matches/:tournamentId/:matchId/unmark-underway', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId, matchId } = req.params;

	try {
		// Clear any local tracking
		const trackingKey = `${tournamentId}:${matchId}`;
		localUnderwayTracking.delete(trackingKey);

		let matchData = null;
		let usedV1Fallback = false;

		// Try v2.1 change_state endpoint first
		try {
			const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}/change_state.json`, {
				data: {
					type: 'MatchState',
					attributes: {
						state: 'unmark_as_underway'
					}
				}
			});
			matchData = response.data?.data?.attributes;
		} catch (v2Error) {
			// If v2.1 returns 500, fall back to v1 API
			if (v2Error.response?.status === 500) {
				console.log('[Unmark Underway] v2.1 API returned 500, trying v1 fallback...');

				try {
					const apiKey = getLegacyApiKey();
					if (!apiKey) {
						throw new Error('No legacy API key configured for v1 fallback');
					}
					const v1Response = await rateLimitedAxios.post(
						`https://api.challonge.com/v1/tournaments/${tournamentId}/matches/${matchId}/unmark_as_underway.json`,
						null,
						{
							params: { api_key: apiKey },
							timeout: 15000
						}
					);

					matchData = v1Response.data?.match;
					usedV1Fallback = true;
					console.log('[Unmark Underway] v1 fallback succeeded');
				} catch (v1Error) {
					console.error('[Unmark Underway] v1 fallback also failed:', v1Error.message);
					throw v1Error;
				}
			} else {
				throw v2Error; // Rethrow non-500 errors
			}
		}

		// Invalidate matches cache
		cacheDb.invalidateCache('matches', tournamentId);

		res.json({
			success: true,
			message: usedV1Fallback ? 'Match unmarked as underway (v1 fallback)' : 'Match unmarked as underway',
			match: matchData,
			v1Fallback: usedV1Fallback
		});
	} catch (error) {
		console.error('Unmark underway error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to unmark match as underway',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Update match score (v2.1 API)
app.post('/api/matches/:tournamentId/:matchId/score', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId, matchId } = req.params;
	const { scores, player1Id, player2Id } = req.body;

	if (!scores) {
		return res.status(400).json({
			success: false,
			error: 'Scores are required (format: "1-2")'
		});
	}

	try {
		// Parse scores "1-2" into individual scores
		const scoreParts = scores.split('-').map(s => s.trim());
		if (scoreParts.length !== 2) {
			return res.status(400).json({
				success: false,
				error: 'Scores must be in format "X-Y" (e.g., "1-2")'
			});
		}

		// If player IDs not provided, fetch match first to get them
		let p1Id = player1Id;
		let p2Id = player2Id;
		if (!p1Id || !p2Id) {
			const matchResponse = await challongeV2Request('GET', `/tournaments/${tournamentId}/matches/${matchId}.json`);
			const matchAttrs = matchResponse.data?.data?.attributes;
			// v2.1 uses points_by_participant array with participant relationship
			const relationships = matchResponse.data?.data?.relationships;
			if (relationships?.player1?.data?.id) {
				p1Id = relationships.player1.data.id;
			}
			if (relationships?.player2?.data?.id) {
				p2Id = relationships.player2.data.id;
			}
			// Fallback to attributes if relationships not available
			if (!p1Id) p1Id = matchAttrs?.player1_id;
			if (!p2Id) p2Id = matchAttrs?.player2_id;
		}

		if (!p1Id || !p2Id) {
			return res.status(400).json({
				success: false,
				error: 'Could not determine participant IDs for match'
			});
		}

		// Use v2.1 update match endpoint with proper payload
		const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}.json`, {
			data: {
				type: 'Match',
				attributes: {
					match: [
						{ participant_id: String(p1Id), score_set: scoreParts[0] },
						{ participant_id: String(p2Id), score_set: scoreParts[1] }
					]
				}
			}
		});

		const matchData = response.data?.data?.attributes;

		// Invalidate matches cache
		cacheDb.invalidateCache('matches', tournamentId);

		res.json({
			success: true,
			message: 'Match score updated',
			match: matchData
		});
	} catch (error) {
		console.error('Update score error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to update match score',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Declare match winner (v2.1 API)
app.post('/api/matches/:tournamentId/:matchId/winner', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId, matchId } = req.params;
	const { winnerId, scores, player1Id, player2Id } = req.body;

	if (!winnerId) {
		return res.status(400).json({
			success: false,
			error: 'Winner ID is required'
		});
	}

	if (!scores) {
		return res.status(400).json({
			success: false,
			error: 'Scores are required when declaring winner (format: "1-2")'
		});
	}

	try {
		// Parse scores "1-2" into individual scores
		const scoreParts = scores.split('-').map(s => s.trim());
		if (scoreParts.length !== 2) {
			return res.status(400).json({
				success: false,
				error: 'Scores must be in format "X-Y" (e.g., "1-2")'
			});
		}

		// If player IDs not provided, fetch match first to get them
		let p1Id = player1Id;
		let p2Id = player2Id;
		if (!p1Id || !p2Id) {
			const matchResponse = await challongeV2Request('GET', `/tournaments/${tournamentId}/matches/${matchId}.json`);
			const matchAttrs = matchResponse.data?.data?.attributes;
			const relationships = matchResponse.data?.data?.relationships;
			if (relationships?.player1?.data?.id) {
				p1Id = relationships.player1.data.id;
			}
			if (relationships?.player2?.data?.id) {
				p2Id = relationships.player2.data.id;
			}
			// Fallback to points_by_participant (v2.1 structure)
			if (!p1Id && !p2Id && matchAttrs?.points_by_participant?.length >= 2) {
				p1Id = matchAttrs.points_by_participant[0]?.participant_id;
				p2Id = matchAttrs.points_by_participant[1]?.participant_id;
			}
			// Final fallback to player1_id/player2_id
			if (!p1Id) p1Id = matchAttrs?.player1_id;
			if (!p2Id) p2Id = matchAttrs?.player2_id;
		}

		if (!p1Id || !p2Id) {
			return res.status(400).json({
				success: false,
				error: 'Could not determine participant IDs for match'
			});
		}

		// Determine which player wins
		const p1Wins = String(winnerId) === String(p1Id);

		// Use v2.1 update match endpoint with rank and advancing to declare winner
		const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}.json`, {
			data: {
				type: 'Match',
				attributes: {
					match: [
						{ participant_id: String(p1Id), score_set: scoreParts[0], rank: p1Wins ? 1 : 2, advancing: p1Wins },
						{ participant_id: String(p2Id), score_set: scoreParts[1], rank: p1Wins ? 2 : 1, advancing: !p1Wins }
					]
				}
			}
		});

		const matchData = response.data?.data?.attributes;

		// Clear local underway tracking since match is now complete
		const trackingKey = `${tournamentId}:${matchId}`;
		localUnderwayTracking.delete(trackingKey);

		// Record match change for rollback
		const usernameForHistory = req.session?.user?.username || req.tokenUsername || 'API';
		recordMatchChange(tournamentId, matchId, {
			winnerId,
			scores,
			player1Id: p1Id,
			player2Id: p2Id
		}, `winner_declared: ${scores}`, usernameForHistory);

		// Trigger immediate fetch and push to update TV display quickly
		fetchAndPushMatches().catch(err => {
			console.error('[Winner] Background fetch/push failed:', err.message);
		});

		// Log activity
		const userId = req.session?.userId || req.tokenUserId || 0;
		const username = req.session?.username || req.tokenUsername || 'API';
		logActivity(userId, username, ACTIVITY_TYPES.MATCH_COMPLETE, {
			tournamentId,
			matchId,
			winnerId,
			score: scores
		});

		// Send push notification for match completion
		broadcastPushNotification('match_completed', {
			title: 'Match Completed',
			body: `Match finished: ${scores}`,
			data: {
				type: 'match_completed',
				tournamentId,
				matchId,
				winnerId,
				scores
			}
		}).catch(err => console.error('[Push] Match notification error:', err.message));

		// Invalidate matches cache
		cacheDb.invalidateCache('matches', tournamentId);

		res.json({
			success: true,
			message: 'Match winner declared',
			match: matchData
		});
	} catch (error) {
		console.error('Declare winner error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to declare match winner',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Reopen a completed match (v2.1 API with v1 fallback)
app.post('/api/matches/:tournamentId/:matchId/reopen', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId, matchId } = req.params;

	try {
		let matchData = null;
		let usedV1Fallback = false;

		// Try v2.1 change_state endpoint first
		try {
			const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}/change_state.json`, {
				data: {
					type: 'MatchState',
					attributes: {
						state: 'reopen'
					}
				}
			});
			matchData = response.data?.data?.attributes;
		} catch (v2Error) {
			// If v2.1 returns 500, fall back to v1 API
			if (v2Error.response?.status === 500) {
				console.log('[Reopen] v2.1 API returned 500, trying v1 fallback...');

				try {
					const apiKey = getLegacyApiKey();
					if (!apiKey) {
						throw new Error('No legacy API key configured for v1 fallback');
					}
					const v1Response = await rateLimitedAxios.post(
						`https://api.challonge.com/v1/tournaments/${tournamentId}/matches/${matchId}/reopen.json`,
						null,
						{
							params: { api_key: apiKey },
							timeout: 15000
						}
					);

					matchData = v1Response.data?.match;
					usedV1Fallback = true;
					console.log('[Reopen] v1 fallback succeeded');
				} catch (v1Error) {
					console.error('[Reopen] v1 fallback also failed:', v1Error.message);
					throw v1Error;
				}
			} else {
				throw v2Error; // Rethrow non-500 errors
			}
		}

		// Invalidate matches cache
		cacheDb.invalidateCache('matches', tournamentId);

		res.json({
			success: true,
			message: usedV1Fallback ? 'Match reopened (v1 fallback)' : 'Match reopened',
			match: matchData,
			v1Fallback: usedV1Fallback
		});
	} catch (error) {
		console.error('Reopen match error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to reopen match',
			details: error.response ? error.response.data : error.message
		});
	}
});

// DQ/Forfeit - Declare winner due to disqualification or no-show (v2.1 API)
app.post('/api/matches/:tournamentId/:matchId/dq', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId, matchId } = req.params;
	const { winnerId, loserId, player1Id, player2Id } = req.body;

	if (!winnerId) {
		return res.status(400).json({
			success: false,
			error: 'Winner ID is required (the player who advances)'
		});
	}

	try {
		// If player IDs not provided, fetch match first to get them
		let p1Id = player1Id;
		let p2Id = player2Id;
		if (!p1Id || !p2Id) {
			const matchResponse = await challongeV2Request('GET', `/tournaments/${tournamentId}/matches/${matchId}.json`);
			const matchAttrs = matchResponse.data?.data?.attributes;
			const relationships = matchResponse.data?.data?.relationships;
			if (relationships?.player1?.data?.id) {
				p1Id = relationships.player1.data.id;
			}
			if (relationships?.player2?.data?.id) {
				p2Id = relationships.player2.data.id;
			}
			if (!p1Id) p1Id = matchAttrs?.player1_id;
			if (!p2Id) p2Id = matchAttrs?.player2_id;
		}

		if (!p1Id || !p2Id) {
			return res.status(400).json({
				success: false,
				error: 'Could not determine participant IDs for match'
			});
		}

		// Determine which player wins
		const p1Wins = String(winnerId) === String(p1Id);

		// v2.1 API: Set winner with 0-0 score (indicates forfeit)
		const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}.json`, {
			data: {
				type: 'Match',
				attributes: {
					match: [
						{ participant_id: String(p1Id), score_set: '0', rank: p1Wins ? 1 : 2, advancing: p1Wins },
						{ participant_id: String(p2Id), score_set: '0', rank: p1Wins ? 2 : 1, advancing: !p1Wins }
					]
				}
			}
		});

		const matchData = response.data?.data?.attributes;

		// Trigger immediate match data refresh for displays
		if (typeof fetchAndPushMatches === 'function') {
			fetchAndPushMatches().catch(err => console.error('Error pushing matches after DQ:', err.message));
		}

		// Log activity
		const userId = req.session?.userId || req.tokenUserId || 0;
		const username = req.session?.username || req.tokenUsername || 'API';
		logActivity(userId, username, ACTIVITY_TYPES.MATCH_DQ, {
			tournamentId,
			matchId,
			winnerId,
			loserId: loserId || (p1Wins ? p2Id : p1Id)
		});

		// Invalidate matches cache
		cacheDb.invalidateCache('matches', tournamentId);

		res.json({
			success: true,
			message: 'Match forfeited - winner advanced',
			match: matchData,
			forfeited: true
		});
	} catch (error) {
		console.error('DQ/Forfeit error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to process forfeit',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Assign station to a match
app.post('/api/matches/:tournamentId/:matchId/station', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId, matchId } = req.params;
	const { stationId } = req.body;
	const apiKey = getChallongeApiKey();

	if (!apiKey) {
		return res.status(500).json({
			success: false,
			error: 'Challonge not connected. Please connect your account in Settings.'
		});
	}

	const headers = {
		'Authorization': apiKey,
		'Authorization-Type': 'v1',
		'Content-Type': 'application/vnd.api+json',
		'Accept': 'application/json'
	};

	try {
		if (stationId) {
			// Assign match to station: PUT to station endpoint with match_id
			const stationData = {
				data: {
					type: 'station',
					attributes: {
						match_id: String(matchId)
					}
				}
			};

			await rateLimitedAxios.put(
				`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations/${stationId}.json`,
				stationData,
				{ headers, timeout: 10000 }
			);

			// Trigger immediate fetch and push to update TV display quickly
			fetchAndPushMatches().catch(err => {
				console.error('[Station Assign] Background fetch/push failed:', err.message);
			});

			// Invalidate matches and stations caches
			cacheDb.invalidateCache('matches', tournamentId);
			cacheDb.invalidateCache('stations', tournamentId);

			res.json({
				success: true,
				message: 'Station assigned to match'
			});
		} else {
			// Unassign: Find which station has this match and clear it
			const stationsResponse = await rateLimitedAxios.get(
				`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations.json`,
				{ headers, timeout: 10000 }
			);

			// Find station that has this match
			const stationWithMatch = stationsResponse.data?.data?.find(station => {
				const stationMatchId = station.relationships?.match?.data?.id;
				return stationMatchId === String(matchId);
			});

			if (stationWithMatch) {
				// Clear the station's match assignment
				const stationData = {
					data: {
						type: 'station',
						attributes: {
							match_id: null
						}
					}
				};

				await rateLimitedAxios.put(
					`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations/${stationWithMatch.id}.json`,
					stationData,
					{ headers, timeout: 10000 }
				);
			}

			// Trigger immediate fetch and push to update TV display quickly
			fetchAndPushMatches().catch(err => {
				console.error('[Station Unassign] Background fetch/push failed:', err.message);
			});

			// Invalidate matches and stations caches
			cacheDb.invalidateCache('matches', tournamentId);
			cacheDb.invalidateCache('stations', tournamentId);

			res.json({
				success: true,
				message: 'Station unassigned from match'
			});
		}
	} catch (error) {
		console.error('Assign station error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to assign station',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Clear match scores (reset to no score, keep state) - v2.1 API
app.post('/api/matches/:tournamentId/:matchId/clear-scores', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId, matchId } = req.params;
	const { player1Id, player2Id } = req.body;

	try {
		// If player IDs not provided, fetch match first to get them
		let p1Id = player1Id;
		let p2Id = player2Id;
		if (!p1Id || !p2Id) {
			const matchResponse = await challongeV2Request('GET', `/tournaments/${tournamentId}/matches/${matchId}.json`);
			const matchAttrs = matchResponse.data?.data?.attributes;
			const relationships = matchResponse.data?.data?.relationships;
			if (relationships?.player1?.data?.id) {
				p1Id = relationships.player1.data.id;
			}
			if (relationships?.player2?.data?.id) {
				p2Id = relationships.player2.data.id;
			}
			if (!p1Id) p1Id = matchAttrs?.player1_id;
			if (!p2Id) p2Id = matchAttrs?.player2_id;
		}

		if (!p1Id || !p2Id) {
			return res.status(400).json({
				success: false,
				error: 'Could not determine participant IDs for match'
			});
		}

		// v2.1 API: Clear scores with empty score_set
		const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}.json`, {
			data: {
				type: 'Match',
				attributes: {
					match: [
						{ participant_id: String(p1Id), score_set: '' },
						{ participant_id: String(p2Id), score_set: '' }
					]
				}
			}
		});

		const matchData = response.data?.data?.attributes;

		// Invalidate matches cache
		cacheDb.invalidateCache('matches', tournamentId);

		res.json({
			success: true,
			message: 'Match scores cleared',
			match: matchData
		});
	} catch (error) {
		console.error('Clear scores error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to clear scores',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Batch score entry - submit multiple match scores at once
app.post('/api/matches/:tournamentId/batch-scores', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId } = req.params;
	const { scores } = req.body;

	if (!scores || !Array.isArray(scores) || scores.length === 0) {
		return res.status(400).json({
			success: false,
			error: 'scores array is required'
		});
	}

	// Validate all entries first
	const validationErrors = [];
	for (let i = 0; i < scores.length; i++) {
		const entry = scores[i];
		if (!entry.matchId) {
			validationErrors.push({ index: i, error: 'matchId is required' });
			continue;
		}
		if (!entry.winnerId) {
			validationErrors.push({ index: i, error: 'winnerId is required' });
			continue;
		}
		if (entry.score1 === undefined || entry.score2 === undefined) {
			validationErrors.push({ index: i, error: 'score1 and score2 are required' });
			continue;
		}
		// Scores must be different (no ties) or one must be 0 for forfeit
		if (entry.score1 === entry.score2 && entry.score1 !== 0) {
			validationErrors.push({ index: i, error: 'Tied scores not allowed' });
		}
	}

	if (validationErrors.length > 0) {
		return res.status(400).json({
			success: false,
			error: 'Validation failed',
			validationErrors
		});
	}

	const results = [];
	let succeeded = 0;
	let failed = 0;

	// Process each score entry
	for (const entry of scores) {
		try {
			// Get match details first to get player IDs
			const matchResponse = await challongeV2Request('GET', `/tournaments/${tournamentId}/matches/${entry.matchId}.json`);
			const matchData = matchResponse.data?.data;
			const matchAttrs = matchData?.attributes;
			const relationships = matchData?.relationships;

			// Extract player IDs
			let player1Id = relationships?.player1?.data?.id || matchAttrs?.player1_id;
			let player2Id = relationships?.player2?.data?.id || matchAttrs?.player2_id;

			if (!player1Id || !player2Id) {
				results.push({
					matchId: entry.matchId,
					success: false,
					error: 'Could not determine player IDs'
				});
				failed++;
				continue;
			}

			// Determine winner and loser
			const isPlayer1Winner = String(entry.winnerId) === String(player1Id);
			const winnerId = isPlayer1Winner ? player1Id : player2Id;
			const loserId = isPlayer1Winner ? player2Id : player1Id;
			const winnerScore = isPlayer1Winner ? entry.score1 : entry.score2;
			const loserScore = isPlayer1Winner ? entry.score2 : entry.score1;

			// Build v2.1 match update payload
			const updatePayload = {
				data: {
					type: 'Match',
					attributes: {
						match: [
							{
								participant_id: String(winnerId),
								score_set: String(winnerScore),
								rank: 1,
								advancing: true
							},
							{
								participant_id: String(loserId),
								score_set: String(loserScore),
								rank: 2,
								advancing: false
							}
						]
					}
				}
			};

			// Submit to Challonge
			await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${entry.matchId}.json`, updatePayload);

			results.push({
				matchId: entry.matchId,
				success: true,
				winnerId: entry.winnerId,
				score: `${entry.score1}-${entry.score2}`
			});
			succeeded++;

		} catch (error) {
			console.error(`Batch score error for match ${entry.matchId}:`, error.message);
			results.push({
				matchId: entry.matchId,
				success: false,
				error: error.response?.data?.errors?.[0]?.detail || error.message
			});
			failed++;
		}
	}

	// Single cache invalidation at the end
	cacheDb.invalidateCache('matches', tournamentId);

	// Single push to displays at the end
	try {
		await fetchAndPushMatches(tournamentId);
	} catch (pushError) {
		console.error('Failed to push matches after batch score:', pushError.message);
	}

	// Log activity
	logActivity(
		req.session?.userId || 0,
		req.session?.username || 'API',
		'batch_score_entry',
		{
			tournamentId,
			submitted: scores.length,
			succeeded,
			failed
		}
	);

	res.json({
		success: failed === 0,
		submitted: scores.length,
		succeeded,
		failed,
		results
	});
});

// Get single match details (v2.1 API)
app.get('/api/matches/:tournamentId/:matchId', requireAuthAPI, async (req, res) => {
	const { tournamentId, matchId } = req.params;

	try {
		const response = await challongeV2Request('GET', `/tournaments/${tournamentId}/matches/${matchId}.json`);

		const matchData = response.data?.data;
		const match = matchData?.attributes || {};
		const relationships = matchData?.relationships || {};
		const timestamps = match.timestamps || {};

		// Extract player IDs from relationships or attributes
		let player1Id = relationships?.player1?.data?.id || match.player1_id;
		let player2Id = relationships?.player2?.data?.id || match.player2_id;

		// Parse v2.1 scores format to scores_csv
		let scoresCsv = '';
		if (match.score_in_sets && Array.isArray(match.score_in_sets) && match.score_in_sets.length > 0) {
			// v2.1 format: [[p1Score, p2Score], ...] - take first set for simple score
			const firstSet = match.score_in_sets[0];
			if (Array.isArray(firstSet) && firstSet.length === 2) {
				scoresCsv = `${firstSet[0]}-${firstSet[1]}`;
			}
		} else if (match.scores) {
			// Alternative format: "X - Y" string
			scoresCsv = match.scores.replace(/\s/g, '');
		}

		res.json({
			success: true,
			match: {
				id: parseInt(matchData.id),
				state: match.state,
				round: match.round,
				player1Id: player1Id,
				player2Id: player2Id,
				winnerId: match.winner_id,
				loserId: match.loser_id,
				scores_csv: scoresCsv,
				underwayAt: timestamps.underway_at || match.underway_at,
				startedAt: timestamps.started_at || match.started_at,
				completedAt: timestamps.completed_at || match.completed_at,
				suggestedPlayOrder: match.suggested_play_order,
				stationId: relationships?.station?.data?.id || null,
				identifier: match.identifier
			}
		});
	} catch (error) {
		console.error('Get match error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to get match',
			details: error.response ? error.response.data : error.message
		});
	}
});

// ============================================
// STATION MANAGEMENT API ENDPOINTS
// ============================================

// Get stations for a tournament - with caching
app.get('/api/stations/:tournamentId', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId } = req.params;

	// Helper function to fetch stations from Challonge API
	// Note: Stations API requires legacy key - Challonge doesn't support OAuth scopes for stations
	const fetchStationsFromAPI = async () => {
		const headers = getStationsApiHeaders();
		const response = await rateLimitedAxios.get(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations.json`,
			{
				headers,
				timeout: 10000
			}
		);

		const stations = (response.data.data || []).map(s => ({
			id: s.id,
			name: s.attributes?.name || `Station ${s.id}`,
			streamUrl: s.attributes?.stream_url || null
		}));

		return stations;
	};

	try {
		// Use cache with stale-while-revalidate pattern
		const { data: stations, _cache } = await cacheDb.getCachedOrFetch(
			'stations',
			tournamentId,
			fetchStationsFromAPI
		);

		res.json({
			success: true,
			stations,
			_cache
		});
	} catch (error) {
		console.error('Get stations error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to get stations',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Create a station for a tournament
// Note: Stations API requires legacy key - Challonge doesn't support OAuth scopes for stations
app.post('/api/stations/:tournamentId', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId } = req.params;
	const { name } = req.body;

	if (!name) {
		return res.status(400).json({
			success: false,
			error: 'Station name is required'
		});
	}

	try {
		const headers = getStationsApiHeaders();
		const response = await rateLimitedAxios.post(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations.json`,
			{
				data: {
					type: 'station',
					attributes: { name }
				}
			},
			{
				headers,
				timeout: 10000
			}
		);

		const station = response.data.data;

		// Invalidate stations cache
		cacheDb.invalidateCache('stations', tournamentId);

		res.json({
			success: true,
			message: `Station "${name}" created`,
			station: {
				id: station.id,
				name: station.attributes?.name || name
			}
		});
	} catch (error) {
		console.error('Create station error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to create station',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Delete a station
// Note: Stations API requires legacy key - Challonge doesn't support OAuth scopes for stations
app.delete('/api/stations/:tournamentId/:stationId', requireAuthAPI, async (req, res) => {
	const { tournamentId, stationId } = req.params;

	try {
		const headers = getStationsApiHeaders();
		await rateLimitedAxios.delete(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations/${stationId}.json`,
			{
				headers,
				timeout: 10000
			}
		);

		// Invalidate stations cache
		cacheDb.invalidateCache('stations', tournamentId);

		res.json({
			success: true,
			message: 'Station deleted'
		});
	} catch (error) {
		console.error('Delete station error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to delete station',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Get station settings for a tournament
// Note: Station settings use legacy key for consistency with stations API
app.get('/api/tournament/:tournamentId/station-settings', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;

	try {
		const headers = getStationsApiHeaders();
		const response = await rateLimitedAxios.get(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}.json`,
			{
				headers,
				timeout: 10000
			}
		);

		const stationOptions = response.data.data?.attributes?.station_options || {};
		res.json({
			success: true,
			stationSettings: {
				autoAssign: stationOptions.auto_assign || false,
				onlyStartWithStations: stationOptions.only_start_matches_with_assigned_stations || false
			}
		});
	} catch (error) {
		console.error('Get station settings error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to get station settings',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Update station settings for a tournament
// Note: Station settings use legacy key for consistency with stations API
app.put('/api/tournament/:tournamentId/station-settings', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;
	const { autoAssign, onlyStartWithStations } = req.body;

	try {
		// Build station_options object
		const stationOptions = {};
		if (typeof autoAssign === 'boolean') {
			stationOptions.auto_assign = autoAssign;
		}
		if (typeof onlyStartWithStations === 'boolean') {
			stationOptions.only_start_matches_with_assigned_stations = onlyStartWithStations;
		}

		const headers = getStationsApiHeaders();
		const response = await rateLimitedAxios.put(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}.json`,
			{
				data: {
					type: 'tournament',
					attributes: {
						station_options: stationOptions
					}
				}
			},
			{
				headers,
				timeout: 10000
			}
		);

		const updatedOptions = response.data.data?.attributes?.station_options || {};
		res.json({
			success: true,
			message: 'Station settings updated',
			stationSettings: {
				autoAssign: updatedOptions.auto_assign || false,
				onlyStartWithStations: updatedOptions.only_start_matches_with_assigned_stations || false
			}
		});
	} catch (error) {
		console.error('Update station settings error:', error.message);
		// Check if it's a "can't change after started" error
		const errorDetails = error.response?.data?.errors;
		if (errorDetails && Array.isArray(errorDetails)) {
			const relevantErrors = errorDetails.filter(e =>
				e.source?.pointer?.includes('station_options')
			);
			if (relevantErrors.length === 0 && errorDetails.length > 0) {
				// The errors are about other fields, not station_options
				// Try to get current settings and return success
				try {
					const getResponse = await rateLimitedAxios.get(
						`https://api.challonge.com/v2.1/tournaments/${tournamentId}.json`,
						{
							headers: {
								'Accept': 'application/json',
								'Content-Type': 'application/vnd.api+json',
								'Authorization-Type': 'v1',
								'Authorization': apiKey
							},
							timeout: 10000
						}
					);
					const currentOptions = getResponse.data.data?.attributes?.station_options || {};
					return res.json({
						success: true,
						message: 'Station settings may have been updated (some tournament fields cannot be changed after start)',
						stationSettings: {
							autoAssign: currentOptions.auto_assign || false,
							onlyStartWithStations: currentOptions.only_start_matches_with_assigned_stations || false
						}
					});
				} catch (getError) {
					// Fall through to error response
				}
			}
		}
		res.status(500).json({
			success: false,
			error: 'Failed to update station settings',
			details: error.response ? error.response.data : error.message
		});
	}
});

// ============================================
// TOURNAMENT LIFECYCLE API ENDPOINTS
// ============================================

// Get a single tournament's details (v2.1 API) - with caching
app.get('/api/tournament/:tournamentId', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;

	// Helper function to fetch tournament details from Challonge API
	const fetchTournamentFromAPI = async () => {
		const response = await challongeV2Request('GET', `/tournaments/${tournamentId}.json`);
		const tournamentData = response.data.data;
		const attrs = tournamentData.attributes;

		// Debug: Log the raw response for troubleshooting
		console.log('[Tournament GET] Raw attrs for', tournamentId, ':', JSON.stringify({
			starts_at: attrs.starts_at,
			timestamps_starts_at: attrs.timestamps?.starts_at,
			match_options: attrs.match_options,
			notifications: attrs.notifications
		}, null, 2));

		// v2.1 returns nested option objects
		const regOpts = attrs.registration_options || {};
		const seedOpts = attrs.seeding_options || {};
		const matchOpts = attrs.match_options || {};
		const notifyOpts = attrs.notifications || {};
		const doubleElimOpts = attrs.double_elimination_options || {};

		return {
			// Basic info
			id: parseInt(tournamentData.id),
			tournamentId: attrs.url,
			name: attrs.name,
			description: attrs.description || '',
			game: attrs.game_name || '',
			state: attrs.state,
			tournamentType: attrs.tournament_type,
			participants: attrs.participants_count || 0,
			url: attrs.full_challonge_url,

			// Schedule (v2.1 uses timestamps.starts_at or top-level starts_at)
			startAt: attrs.timestamps?.starts_at || attrs.starts_at,
			checkInDuration: regOpts.check_in_duration,

			// Registration (from registration_options)
			signupCap: regOpts.signup_cap,
			openSignup: regOpts.open_signup || false,

			// Format options
			// v2.1 uses consolation_matches_target_rank in match_options (>= 3 = enabled)
			holdThirdPlaceMatch: matchOpts.consolation_matches_target_rank != null && matchOpts.consolation_matches_target_rank >= 3,
			// v2.1 uses double_elimination_options for grand_finals_modifier
			grandFinalsModifier: doubleElimOpts.grand_finals_modifier || '',
			sequentialPairings: seedOpts.sequential_pairings || false,
			showRounds: attrs.show_rounds || false,
			swissRounds: attrs.swiss_rounds || 0,

			// Round Robin options
			rankedBy: attrs.ranked_by || 'match wins',
			rrIterations: attrs.rr_iterations || 1,
			rrPtsForMatchWin: attrs.rr_pts_for_match_win || '1.0',
			rrPtsForMatchTie: attrs.rr_pts_for_match_tie || '0.5',
			rrPtsForGameWin: attrs.rr_pts_for_game_win || '0.0',
			rrPtsForGameTie: attrs.rr_pts_for_game_tie || '0.0',

			// Swiss options
			ptsForMatchWin: attrs.pts_for_match_win || '1.0',
			ptsForMatchTie: attrs.pts_for_match_tie || '0.5',
			ptsForBye: attrs.pts_for_bye || '1.0',
			ptsForGameWin: attrs.pts_for_game_win || '0.0',
			ptsForGameTie: attrs.pts_for_game_tie || '0.0',

			// Display options (from seeding_options)
			hideSeeds: seedOpts.hide_seeds || false,
			hideForum: attrs.hide_forum || false,
			privateTournament: attrs.private || false,

			// Match settings (from match_options)
			acceptAttachments: matchOpts.accept_attachments || false,
			// NOTE: quickAdvance is NOT supported by Challonge v2.1 API

			// Notifications (from notifications)
			notifyMatchOpen: notifyOpts.upon_matches_open || false,
			notifyTournamentEnd: notifyOpts.upon_tournament_ends || false,

			// Group Stage
			groupStageEnabled: attrs.group_stage_enabled || false,
			groupStageOptions: attrs.group_stage_options ? {
				stageType: attrs.group_stage_options.stage_type,
				groupSize: attrs.group_stage_options.group_size,
				participantCountToAdvance: attrs.group_stage_options.participant_count_to_advance_per_group,
				rankedBy: attrs.group_stage_options.ranked_by
			} : null
		};
	};

	try {
		// Use cache with stale-while-revalidate pattern
		const { data: tournament, _cache } = await cacheDb.getCachedOrFetch(
			'tournamentDetails',
			tournamentId,
			fetchTournamentFromAPI
		);

		res.json({
			success: true,
			tournament,
			_cache
		});
	} catch (error) {
		console.error('Get tournament error:', error.message);
		res.status(error.response?.status || 500).json({
			success: false,
			error: 'Failed to get tournament details',
			details: error.response?.data || error.message
		});
	}
});

// Update a tournament (v2.1 API)
app.put('/api/tournament/:tournamentId', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;

	const {
		// Basic info
		name,
		description,
		gameName,

		// Schedule
		startAt,
		checkInDuration,

		// Registration
		signupCap,
		openSignup,

		// Format options
		holdThirdPlaceMatch,
		grandFinalsModifier,
		sequentialPairings,
		showRounds,
		swissRounds,

		// Round Robin options
		rankedBy,
		rrPtsForMatchWin,
		rrPtsForMatchTie,
		rrPtsForGameWin,
		rrPtsForGameTie,

		// Swiss options
		ptsForMatchWin,
		ptsForMatchTie,
		ptsForBye,
		ptsForGameWin,
		ptsForGameTie,

		// Display options
		hideSeeds,
		hideForum,
		privateTournament,

		// Match settings
		acceptAttachments,
		// Note: quickAdvance is NOT supported by Challonge v2.1 API

		// Notifications
		notifyMatchOpen,
		notifyTournamentEnd,

		// Group Stage
		groupStageEnabled,
		groupStageOptions
	} = req.body;

	// Validation
	if (name !== undefined && (!name || !name.trim())) {
		return res.status(400).json({
			success: false,
			error: 'Tournament name cannot be empty'
		});
	}

	if (name && name.length > 60) {
		return res.status(400).json({
			success: false,
			error: 'Tournament name must be 60 characters or less'
		});
	}

	try {
		// Build update params - only include fields that were provided
		// v2.1 API requires nested option objects
		const tournamentParams = {};

		// Top-level fields
		if (name !== undefined) {
			tournamentParams.name = name.trim();
		}

		if (description !== undefined) {
			tournamentParams.description = description;
		}

		if (gameName !== undefined) {
			tournamentParams.game_name = gameName || null;
		}

		// Note: v2.1 uses "starts_at" (with 's'), not "start_at"
		// IMPORTANT: Challonge v2.1 rejects starts_at: null with 422 error
		// Only send starts_at if it has a valid value (to change date) - omit to keep existing
		console.log(`[Tournament Update] Client sent startAt:`, startAt, `(type: ${typeof startAt})`);
		if (startAt !== undefined && startAt) {
			const startDate = new Date(startAt);
			if (!isNaN(startDate.getTime())) {
				tournamentParams.starts_at = startDate.toISOString();
				console.log(`[Tournament Update] Converted startAt: ${startAt} -> ${tournamentParams.starts_at}`);
			} else {
				console.log(`[Tournament Update] Invalid date, not sending starts_at`);
			}
		} else {
			console.log(`[Tournament Update] startAt is empty/undefined, not sending starts_at (preserves existing)`);
		}
		// Note: To clear a start date, user must do it directly on Challonge (API doesn't support null)

		if (privateTournament !== undefined) {
			tournamentParams.private = !!privateTournament;
		}

		if (hideForum !== undefined) {
			tournamentParams.hide_forum = !!hideForum;
		}

		// Format-specific fields are handled in nested options below
		// showRounds remains at top level in v2.1
		if (showRounds !== undefined) {
			tournamentParams.show_rounds = !!showRounds;
		}

		if (swissRounds !== undefined && swissRounds !== null) {
			tournamentParams.swiss_rounds = parseInt(swissRounds) || 0;
		}

		// Round Robin options (top-level)
		if (rankedBy !== undefined) {
			tournamentParams.ranked_by = rankedBy || 'match wins';
		}

		if (rrPtsForMatchWin !== undefined) {
			tournamentParams.rr_pts_for_match_win = parseFloat(rrPtsForMatchWin) || 1.0;
		}

		if (rrPtsForMatchTie !== undefined) {
			tournamentParams.rr_pts_for_match_tie = parseFloat(rrPtsForMatchTie) || 0.5;
		}

		if (rrPtsForGameWin !== undefined) {
			tournamentParams.rr_pts_for_game_win = parseFloat(rrPtsForGameWin) || 0.0;
		}

		if (rrPtsForGameTie !== undefined) {
			tournamentParams.rr_pts_for_game_tie = parseFloat(rrPtsForGameTie) || 0.0;
		}

		// Swiss options (top-level)
		if (ptsForMatchWin !== undefined) {
			tournamentParams.pts_for_match_win = parseFloat(ptsForMatchWin) || 1.0;
		}

		if (ptsForMatchTie !== undefined) {
			tournamentParams.pts_for_match_tie = parseFloat(ptsForMatchTie) || 0.5;
		}

		if (ptsForBye !== undefined) {
			tournamentParams.pts_for_bye = parseFloat(ptsForBye) || 1.0;
		}

		if (ptsForGameWin !== undefined) {
			tournamentParams.pts_for_game_win = parseFloat(ptsForGameWin) || 0.0;
		}

		if (ptsForGameTie !== undefined) {
			tournamentParams.pts_for_game_tie = parseFloat(ptsForGameTie) || 0.0;
		}

		// NOTE: quick_advance is NOT supported by Challonge v2.1 API (removed)

		// v2.1 nested option objects
		// Registration options - only include fields with actual values (v2.1 rejects null for integers)
		const registrationOptions = {};
		if (checkInDuration !== undefined && checkInDuration !== null && checkInDuration !== '') {
			registrationOptions.check_in_duration = parseInt(checkInDuration);
		}
		if (signupCap !== undefined && signupCap !== null && signupCap !== '') {
			registrationOptions.signup_cap = parseInt(signupCap);
		}
		if (openSignup !== undefined) {
			registrationOptions.open_signup = !!openSignup;
		}
		if (Object.keys(registrationOptions).length > 0) {
			tournamentParams.registration_options = registrationOptions;
		}

		// Seeding options
		const seedingOptions = {};
		if (hideSeeds !== undefined) {
			seedingOptions.hide_seeds = !!hideSeeds;
		}
		if (sequentialPairings !== undefined) {
			seedingOptions.sequential_pairings = !!sequentialPairings;
		}
		if (Object.keys(seedingOptions).length > 0) {
			tournamentParams.seeding_options = seedingOptions;
		}

		// Match options
		const matchOptions = {};
		if (acceptAttachments !== undefined) {
			matchOptions.accept_attachments = !!acceptAttachments;
		}
		// NOTE: quick_advance is NOT supported by Challonge v2.1 API (removed)
		// v2.1 uses consolation_matches_target_rank instead of hold_third_place_match
		// Setting to 3 enables 3rd place match
		// To disable, we need to send an empty match_options or exclude the field (API rejects null/0)
		if (holdThirdPlaceMatch !== undefined) {
			if (holdThirdPlaceMatch) {
				matchOptions.consolation_matches_target_rank = 3;
			}
			// If false, we still send match_options but without consolation_matches_target_rank
			// This will reset it to null on Challonge's side
		}
		// Always send match_options if holdThirdPlaceMatch was provided (even if empty, to reset)
		if (Object.keys(matchOptions).length > 0 || holdThirdPlaceMatch !== undefined) {
			tournamentParams.match_options = matchOptions;
		}

		// Double elimination options
		if (grandFinalsModifier !== undefined) {
			tournamentParams.double_elimination_options = {
				grand_finals_modifier: grandFinalsModifier || null
			};
		}

		// Notifications
		// NOTE: Challonge API ignores notification setting updates (they stay at current values)
		// Users must change notification settings directly on Challonge website
		// We still send the values for completeness, but they won't take effect
		const notifications = {};
		if (notifyMatchOpen !== undefined) {
			notifications.upon_matches_open = !!notifyMatchOpen;
		}
		if (notifyTournamentEnd !== undefined) {
			notifications.upon_tournament_ends = !!notifyTournamentEnd;
		}
		if (Object.keys(notifications).length > 0) {
			tournamentParams.notifications = notifications;
		}

		// Group Stage
		if (groupStageEnabled !== undefined) {
			tournamentParams.group_stage_enabled = !!groupStageEnabled;

			if (groupStageEnabled && groupStageOptions) {
				tournamentParams.group_stage_options = {
					stage_type: groupStageOptions.stageType || 'round robin',
					group_size: parseInt(groupStageOptions.groupSize) || 4,
					participant_count_to_advance_per_group: parseInt(groupStageOptions.participantCountToAdvance) || 2,
					ranked_by: groupStageOptions.rankedBy || 'match wins'
				};
			}
		}

		console.log(`[Tournament Update] Updating tournament ${tournamentId}:`, JSON.stringify(tournamentParams, null, 2));

		// Build v2.1 JSON:API payload
		const v2Payload = {
			data: {
				type: 'tournaments',
				attributes: tournamentParams
			}
		};

		console.log('[Tournament Update] Sending payload to Challonge:', JSON.stringify(v2Payload, null, 2));
		const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}.json`, v2Payload);

		// Debug: Log what Challonge returns
		const responseAttrs = response.data.data.attributes;
		console.log('[Tournament Update] Challonge response starts_at:', responseAttrs.starts_at);
		console.log('[Tournament Update] Challonge response timestamps.starts_at:', responseAttrs.timestamps?.starts_at);
		console.log('[Tournament Update] Challonge response match_options:', JSON.stringify(responseAttrs.match_options));

		const tournamentData = response.data.data;
		const t = tournamentData.attributes;

		// v2.1 returns nested option objects
		const regOpts = t.registration_options || {};
		const seedOpts = t.seeding_options || {};
		const matchOpts = t.match_options || {};
		const notifyOpts = t.notifications || {};
		const doubleElimOpts = t.double_elimination_options || {};

		// Invalidate tournament details cache
		cacheDb.invalidateCache('tournamentDetails', tournamentId);
		cacheDb.invalidateCache('tournaments', 'list');

		res.json({
			success: true,
			message: 'Tournament updated successfully',
			tournament: {
				// Basic info
				id: parseInt(tournamentData.id),
				tournamentId: t.url,
				name: t.name,
				description: t.description || '',
				game: t.game_name || '',
				state: t.state,
				tournamentType: t.tournament_type,
				participants: t.participants_count || 0,
				url: t.full_challonge_url,

				// Schedule (v2.1 uses timestamps.starts_at or top-level starts_at)
				startAt: t.timestamps?.starts_at || t.starts_at,
				checkInDuration: regOpts.check_in_duration,

				// Registration (from registration_options)
				signupCap: regOpts.signup_cap,
				openSignup: regOpts.open_signup || false,

				// Format options
				// v2.1 uses consolation_matches_target_rank in match_options (>= 3 = enabled)
				holdThirdPlaceMatch: matchOpts.consolation_matches_target_rank != null && matchOpts.consolation_matches_target_rank >= 3,
				// v2.1 uses double_elimination_options for grand_finals_modifier
				grandFinalsModifier: doubleElimOpts.grand_finals_modifier || '',
				sequentialPairings: seedOpts.sequential_pairings || false,
				showRounds: t.show_rounds || false,
				swissRounds: t.swiss_rounds || 0,

				// Round Robin options
				rankedBy: t.ranked_by || 'match wins',
				rrPtsForMatchWin: t.rr_pts_for_match_win || '1.0',
				rrPtsForMatchTie: t.rr_pts_for_match_tie || '0.5',
				rrPtsForGameWin: t.rr_pts_for_game_win || '0.0',
				rrPtsForGameTie: t.rr_pts_for_game_tie || '0.0',

				// Swiss options
				ptsForMatchWin: t.pts_for_match_win || '1.0',
				ptsForMatchTie: t.pts_for_match_tie || '0.5',
				ptsForBye: t.pts_for_bye || '1.0',
				ptsForGameWin: t.pts_for_game_win || '0.0',
				ptsForGameTie: t.pts_for_game_tie || '0.0',

				// Display options (from seeding_options)
				hideSeeds: seedOpts.hide_seeds || false,
				hideForum: t.hide_forum || false,
				privateTournament: t.private || false,

				// Match settings (from match_options)
				acceptAttachments: matchOpts.accept_attachments || false,
				// NOTE: quickAdvance is NOT supported by Challonge v2.1 API

				// Notifications (from notifications)
				notifyMatchOpen: notifyOpts.upon_matches_open || false,
				notifyTournamentEnd: notifyOpts.upon_tournament_ends || false,

				// Group Stage
				groupStageEnabled: t.group_stage_enabled || false,
				groupStageOptions: t.group_stage_options ? {
					stageType: t.group_stage_options.stage_type,
					groupSize: t.group_stage_options.group_size,
					participantCountToAdvance: t.group_stage_options.participant_count_to_advance_per_group,
					rankedBy: t.group_stage_options.ranked_by
				} : null
			}
		});
	} catch (error) {
		console.error('Update tournament error:', error.message);
		console.error('Error response:', JSON.stringify(error.response?.data, null, 2));

		let errorMessage = 'Failed to update tournament';
		if (error.response?.data?.errors) {
			const errors = error.response.data.errors;
			if (Array.isArray(errors)) {
				errorMessage = errors.join(', ');
			} else if (typeof errors === 'object') {
				errorMessage = Object.entries(errors)
					.map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
					.join('; ');
			}
		} else if (error.response?.status === 422) {
			errorMessage = 'Invalid tournament data';
		} else if (error.response?.status === 401) {
			errorMessage = 'Unauthorized - check API key';
		}

		res.status(error.response?.status || 500).json({
			success: false,
			error: errorMessage,
			details: error.response?.data || error.message
		});
	}
});

// Start a tournament (v2.1 API)
app.post('/api/tournament/:tournamentId/start', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;

	try {
		// First check tournament state and participant count
		const checkResponse = await challongeV2Request('GET', `/tournaments/${tournamentId}.json`);
		const tournamentData = checkResponse.data.data;
		const attrs = tournamentData.attributes;

		// Validate tournament can be started
		if (attrs.state !== 'pending') {
			return res.status(400).json({
				success: false,
				error: `Tournament cannot be started - current state is "${attrs.state}"`
			});
		}

		if (attrs.participants_count < 2) {
			return res.status(400).json({
				success: false,
				error: `Tournament needs at least 2 participants to start (currently has ${attrs.participants_count})`
			});
		}

		// Now start the tournament via v2.1 change_state endpoint
		const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/change_state.json`, {
			data: {
				type: 'TournamentState',
				attributes: {
					state: 'start'
				}
			}
		});

		const startedData = response.data.data;
		const startedAttrs = startedData.attributes;

		// Invalidate all caches for this tournament
		cacheDb.invalidateTournamentCaches(tournamentId);
		cacheDb.invalidateCache('tournaments', 'list');

		// Trigger immediate rate mode check to switch to ACTIVE mode and start match polling
		// This prevents the 2-hour delay before the next scheduled check
		setTimeout(() => {
			console.log('[Tournament Start] Triggering rate mode check after tournament start');
			checkTournamentsAndUpdateMode();
		}, 500);

		// Send push notification for tournament start
		broadcastPushNotification('tournament_started', {
			title: 'Tournament Started',
			body: `${startedAttrs.name} has begun!`,
			data: {
				type: 'tournament_started',
				tournamentId,
				name: startedAttrs.name
			}
		}).catch(err => console.error('[Push] Tournament start notification error:', err.message));

		res.json({
			success: true,
			message: 'Tournament started',
			tournament: {
				name: startedAttrs.name,
				state: startedAttrs.state
			}
		});
	} catch (error) {
		console.error('Start tournament error:', error.message);

		// Try to extract more helpful error message
		let errorMessage = 'Failed to start tournament';
		if (error.response?.data?.errors) {
			const errors = error.response.data.errors;
			if (Array.isArray(errors)) {
				errorMessage = errors.map(e => e.detail || e.title || e).join(', ');
			}
		} else if (error.response?.status === 422) {
			errorMessage = 'Tournament cannot be started - check that it has enough participants and is in pending state';
		} else if (error.response?.status === 400) {
			errorMessage = 'Invalid request - tournament may not have enough participants';
		}

		res.status(error.response?.status || 500).json({
			success: false,
			error: errorMessage,
			details: error.response?.data || error.message
		});
	}
});

// Reset a tournament (v2.1 API)
app.post('/api/tournament/:tournamentId/reset', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;

	try {
		// Use v2.1 change_state endpoint with reset action
		const response = await challongeV2Request('PUT', `/tournaments/${tournamentId}/change_state.json`, {
			data: {
				type: 'TournamentState',
				attributes: {
					state: 'reset'
				}
			}
		});

		const resetData = response.data.data;
		const attrs = resetData.attributes;

		// Invalidate all caches for this tournament
		cacheDb.invalidateTournamentCaches(tournamentId);
		cacheDb.invalidateCache('tournaments', 'list');

		// Trigger rate mode check - tournament reset means it's no longer ACTIVE
		setTimeout(() => {
			console.log('[Tournament Reset] Triggering rate mode check after tournament reset');
			checkTournamentsAndUpdateMode();
		}, 500);

		res.json({
			success: true,
			message: 'Tournament reset',
			tournament: {
				name: attrs.name,
				state: attrs.state
			}
		});
	} catch (error) {
		console.error('Reset tournament error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to reset tournament',
			details: error.response ? error.response.data : error.message
		});
	}
});

// Delete a tournament (v2.1 API)
app.delete('/api/tournament/:tournamentId', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;

	try {
		await challongeV2Request('DELETE', `/tournaments/${tournamentId}.json`);

		// Invalidate all caches for this tournament
		cacheDb.invalidateTournamentCaches(tournamentId);
		cacheDb.invalidateCache('tournaments', 'list');

		res.json({
			success: true,
			message: 'Tournament deleted'
		});
	} catch (error) {
		console.error('Delete tournament error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to delete tournament',
			details: error.response ? error.response.data : error.message
		});
	}
});

// ============================================
// DISPLAY MANAGEMENT API ENDPOINTS
// ============================================

const DISPLAYS_FILE = path.join(__dirname, 'displays.json');

// Load displays from file
function loadDisplays() {
	try {
		const data = fsSync.readFileSync(DISPLAYS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('Error loading displays:', error);
		return { displays: [], viewMappings: {} };
	}
}

// Save displays to file
function saveDisplays(displaysData) {
	try {
		fsSync.writeFileSync(DISPLAYS_FILE, JSON.stringify(displaysData, null, 2));
		return true;
	} catch (error) {
		console.error('Error saving displays:', error);
		return false;
	}
}

// Register a new display (no auth required - Pi's register automatically)
app.post('/api/displays/register', async (req, res) => {
	const { hostname, mac, ip, currentView } = req.body;

	if (!hostname || !mac) {
		return res.status(400).json({
			success: false,
			error: 'Hostname and MAC address are required'
		});
	}

	try {
		const displaysData = loadDisplays();
		const displayId = mac.replace(/:/g, '').toLowerCase();

		// Check if display already exists
		let display = displaysData.displays.find(d => d.id === displayId);

		if (display) {
			// Update existing display
			display.hostname = hostname;
			display.ip = ip || display.ip;
			display.currentView = currentView || display.currentView;
			display.lastHeartbeat = new Date().toISOString();
			display.status = 'online';
		} else {
			// Create new display
			display = {
				id: displayId,
				hostname: hostname,
				ip: ip || 'Unknown',
				mac: mac,
				currentView: currentView || 'match',
				assignedView: currentView || 'match',
				status: 'online',
				lastHeartbeat: new Date().toISOString(),
				registeredAt: new Date().toISOString(),
				uptimeSeconds: 0,
				systemInfo: {
					cpuTemp: 0,
					memoryUsage: 0
				},
				debugMode: false,
				debugLogs: []
			};
			displaysData.displays.push(display);
		}

		saveDisplays(displaysData);

		// Get view configuration
		const viewConfig = displaysData.viewMappings[display.assignedView] || displaysData.viewMappings.match;

		res.json({
			success: true,
			id: displayId,
			assignedView: display.assignedView,
			config: viewConfig
		});
	} catch (error) {
		console.error('Display registration error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to register display'
		});
	}
});

// Heartbeat from display (no auth required - Pi's send automatically)
app.post('/api/displays/:id/heartbeat', async (req, res) => {
	const { id } = req.params;
	const { uptimeSeconds, cpuTemp, memoryUsage, currentView, wifiQuality, wifiSignal, ip, externalIp, ssid, voltage, mac, hostname } = req.body;

	try {
		const displaysData = loadDisplays();
		const display = displaysData.displays.find(d => d.id === id);

		if (!display) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		// Track previous state to detect changes
		const previousView = display.currentView;
		const previousStatus = display.status;

		// Update heartbeat and system info
		display.lastHeartbeat = new Date().toISOString();
		display.status = 'online';
		display.currentView = currentView || display.currentView;

		// Log activity if display came online
		if (previousStatus === 'offline') {
			logActivity(0, 'System', ACTIVITY_TYPES.DISPLAY_ONLINE, {
				displayId: id,
				hostname: display.hostname || hostname || 'Unknown',
				ip: ip || display.ip
			});
		}

		// If display just switched TO match view, trigger immediate data refresh
		if (previousView !== 'match' && currentView === 'match') {
			console.log(`[Match Refresh] Display ${display.hostname} switched to match view - triggering data refresh`);
			// Don't await - let it run in background so heartbeat response is fast
			fetchAndPushMatches().catch(err => {
				console.error('[Match Refresh] Failed to push fresh match data:', err.message);
			});
		}
		display.uptimeSeconds = uptimeSeconds || 0;
		// Update IP if provided (can change with DHCP)
		if (ip) display.ip = ip;
		if (externalIp) display.externalIp = externalIp;
		if (mac) display.mac = mac;
		if (hostname) display.hostname = hostname;
		display.systemInfo = {
			cpuTemp: cpuTemp || 0,
			memoryUsage: memoryUsage || 0,
			wifiQuality: wifiQuality || 0,
			wifiSignal: wifiSignal || 0,
			ssid: ssid || 'Unknown',
			voltage: voltage || 0
		};

		saveDisplays(displaysData);

		res.json({ success: true });
	} catch (error) {
		console.error('Heartbeat error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to process heartbeat'
		});
	}
});

// Get configuration for a display (no auth required - Pi's poll automatically)
app.get('/api/displays/:id/config', async (req, res) => {
	const { id } = req.params;

	try {
		const displaysData = loadDisplays();
		const displayIndex = displaysData.displays.findIndex(d => d.id === id);

		if (displayIndex === -1) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		const display = displaysData.displays[displayIndex];

		// Get view configuration
		const viewConfig = displaysData.viewMappings[display.assignedView] || displaysData.viewMappings.match;

		// Check if display needs to restart (currentView != assignedView)
		const shouldRestart = display.currentView !== display.assignedView;

		// Check for pending command and clear it (Pi will execute it)
		let pendingCommand = null;
		if (display.pendingCommand) {
			pendingCommand = display.pendingCommand;
			// Clear the pending command so it doesn't execute again
			delete displaysData.displays[displayIndex].pendingCommand;
			saveDisplays(displaysData);
			console.log(`Pending command '${pendingCommand.action}' sent to ${display.hostname}`);
		}

		res.json({
			success: true,
			assignedView: display.assignedView,
			config: viewConfig,
			shouldRestart: shouldRestart,
			pendingCommand: pendingCommand,
			debugMode: display.debugMode || false,
			displayScaleFactor: display.displayScaleFactor || 1.0
		});
	} catch (error) {
		console.error('Get config error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to get configuration'
		});
	}
});

// List all displays (requires authentication)
app.get('/api/displays', requireAuthAPI, async (req, res) => {
	try {
		const displaysData = loadDisplays();

		// Update status based on last heartbeat
		const now = new Date();
		displaysData.displays.forEach(display => {
			const lastSeen = new Date(display.lastHeartbeat);
			const timeSinceHeartbeat = now - lastSeen;
			const previousStatus = display.status;

			// Mark as offline if no heartbeat in 90 seconds (Pi displays heartbeat every 60s)
			if (timeSinceHeartbeat > 90000) {
				display.status = 'offline';

				// Log activity and send push notification if display went offline
				if (previousStatus === 'online') {
					logActivity(0, 'System', ACTIVITY_TYPES.DISPLAY_OFFLINE, {
						displayId: display.id,
						hostname: display.hostname || 'Unknown',
						lastSeen: display.lastHeartbeat
					});

					// Send push notification for display disconnection
					broadcastPushNotification('display_disconnected', {
						title: 'Display Disconnected',
						body: `${display.hostname || 'Display'} (${display.currentView || 'unknown'}) went offline`,
						data: {
							type: 'display_disconnected',
							displayId: display.id,
							hostname: display.hostname,
							currentView: display.currentView,
							lastSeen: display.lastHeartbeat
						}
					}).catch(err => console.error('[Push] Display offline notification error:', err.message));
				}
			}
		});

		saveDisplays(displaysData);

		res.json({
			success: true,
			displays: displaysData.displays
		});
	} catch (error) {
		console.error('List displays error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to list displays'
		});
	}
});

// Update display configuration (requires authentication)
app.put('/api/displays/:id/config', requireAuthAPI, async (req, res) => {
	const { id } = req.params;
	const { assignedView, displayScaleFactor } = req.body;

	// At least one field must be provided
	if (!assignedView && displayScaleFactor === undefined) {
		return res.status(400).json({
			success: false,
			error: 'At least one configuration field is required (assignedView or displayScaleFactor)'
		});
	}

	// Validate displayScaleFactor range if provided
	if (displayScaleFactor !== undefined) {
		const scale = parseFloat(displayScaleFactor);
		if (isNaN(scale) || scale < 1.0 || scale > 3.0) {
			return res.status(400).json({
				success: false,
				error: 'Display scale factor must be between 1.0 and 3.0'
			});
		}
	}

	try {
		const displaysData = loadDisplays();
		const display = displaysData.displays.find(d => d.id === id);

		if (!display) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		// Validate view exists if provided
		if (assignedView && !displaysData.viewMappings[assignedView]) {
			return res.status(400).json({
				success: false,
				error: 'Invalid view type'
			});
		}

		// Track if restart is needed
		let needsRestart = false;

		// Update assigned view if provided
		if (assignedView && assignedView !== display.assignedView) {
			display.assignedView = assignedView;
			needsRestart = true;
		}

		// Update display scale factor if provided
		if (displayScaleFactor !== undefined) {
			const newScale = parseFloat(displayScaleFactor);
			if (display.displayScaleFactor !== newScale) {
				display.displayScaleFactor = newScale;
				needsRestart = true;
			}
		}

		// Only set transitioning if something changed
		if (needsRestart) {
			display.status = 'transitioning';
		}

		saveDisplays(displaysData);

		// Log activity
		logActivity(
			req.session.userId,
			req.session.username,
			'update_display_config',
			{
				displayId: id,
				hostname: display.hostname,
				assignedView: display.assignedView,
				displayScaleFactor: display.displayScaleFactor
			}
		);

		res.json({
			success: true,
			message: needsRestart ? 'Display configuration updated. Display will restart.' : 'No changes needed.'
		});
	} catch (error) {
		console.error('Update display config error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to update display configuration'
		});
	}
});

// Reboot display (requires authentication)
// Uses command queue - Pi polls for pending commands
app.post('/api/displays/:id/reboot', requireAuthAPI, async (req, res) => {
	const { id } = req.params;

	try {
		const displaysData = loadDisplays();
		const displayIndex = displaysData.displays.findIndex(d => d.id === id);

		if (displayIndex === -1) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		const display = displaysData.displays[displayIndex];

		// Queue reboot command for Pi to pick up
		displaysData.displays[displayIndex].pendingCommand = {
			action: 'reboot',
			queuedAt: new Date().toISOString(),
			queuedBy: req.session.username
		};
		saveDisplays(displaysData);

		console.log(`Reboot command queued for ${display.hostname} (will execute on next poll)`);

		// Log activity
		logActivity(
			req.session.userId,
			req.session.username,
			'reboot_display',
			{
				displayId: id,
				hostname: display.hostname,
				ip: display.ip
			}
		);

		res.json({
			success: true,
			message: `Reboot command queued for ${display.hostname} (will execute within 10 seconds)`
		});
	} catch (error) {
		console.error('Reboot display error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to queue reboot command'
		});
	}
});

// Shutdown display (requires authentication)
// Uses command queue - Pi polls for pending commands
app.post('/api/displays/:id/shutdown', requireAuthAPI, async (req, res) => {
	const { id } = req.params;

	try {
		const displaysData = loadDisplays();
		const displayIndex = displaysData.displays.findIndex(d => d.id === id);

		if (displayIndex === -1) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		const display = displaysData.displays[displayIndex];

		// Queue shutdown command for Pi to pick up
		displaysData.displays[displayIndex].pendingCommand = {
			action: 'shutdown',
			queuedAt: new Date().toISOString(),
			queuedBy: req.session.username
		};
		saveDisplays(displaysData);

		console.log(`Shutdown command queued for ${display.hostname} (will execute on next poll)`);

		// Log activity
		logActivity(
			req.session.userId,
			req.session.username,
			'shutdown_display',
			{
				displayId: id,
				hostname: display.hostname,
				ip: display.ip
			}
		);

		res.json({
			success: true,
			message: `Shutdown command queued for ${display.hostname} (will execute within 10 seconds)`
		});
	} catch (error) {
		console.error('Shutdown display error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to shutdown display'
		});
	}
});

// Toggle debug mode for a display (requires authentication)
app.post('/api/displays/:id/debug', requireAuthAPI, async (req, res) => {
	const { id } = req.params;
	const { enabled } = req.body;

	try {
		const displaysData = loadDisplays();
		const displayIndex = displaysData.displays.findIndex(d => d.id === id);

		if (displayIndex === -1) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		const display = displaysData.displays[displayIndex];
		const previousState = display.debugMode || false;

		// Update debug mode
		displaysData.displays[displayIndex].debugMode = enabled;

		// Clear logs when disabling debug mode
		if (!enabled && previousState) {
			displaysData.displays[displayIndex].debugLogs = [];
		}

		// Initialize debugLogs array if enabling
		if (enabled && !displaysData.displays[displayIndex].debugLogs) {
			displaysData.displays[displayIndex].debugLogs = [];
		}

		saveDisplays(displaysData);

		console.log(`Debug mode ${enabled ? 'enabled' : 'disabled'} for ${display.hostname}`);

		// Log activity
		logActivity(
			req.session.userId,
			req.session.username,
			enabled ? 'enable_debug_mode' : 'disable_debug_mode',
			{
				displayId: id,
				hostname: display.hostname
			}
		);

		res.json({
			success: true,
			debugMode: enabled,
			message: `Debug mode ${enabled ? 'enabled' : 'disabled'} for ${display.hostname}`
		});
	} catch (error) {
		console.error('Toggle debug mode error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to toggle debug mode'
		});
	}
});

// Push debug logs from display (no auth required - Pi's push automatically)
// Logs are stored with a max of 500 entries per display
app.post('/api/displays/:id/logs', async (req, res) => {
	const { id } = req.params;
	const { logs } = req.body;

	if (!logs || !Array.isArray(logs)) {
		return res.status(400).json({
			success: false,
			error: 'Logs array is required'
		});
	}

	try {
		const displaysData = loadDisplays();
		const displayIndex = displaysData.displays.findIndex(d => d.id === id);

		if (displayIndex === -1) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		const display = displaysData.displays[displayIndex];

		// Only accept logs if debug mode is enabled
		if (!display.debugMode) {
			return res.json({
				success: true,
				message: 'Debug mode not enabled, logs ignored',
				debugMode: false
			});
		}

		// Initialize debugLogs if not exists
		if (!displaysData.displays[displayIndex].debugLogs) {
			displaysData.displays[displayIndex].debugLogs = [];
		}

		// Add new logs with timestamp
		const timestamp = new Date().toISOString();
		const newLogs = logs.map(log => ({
			timestamp: log.timestamp || timestamp,
			level: log.level || 'info',
			source: log.source || 'unknown',
			message: log.message || String(log)
		}));

		displaysData.displays[displayIndex].debugLogs.push(...newLogs);

		// Keep only last 500 log entries to prevent unbounded growth
		const maxLogs = 500;
		if (displaysData.displays[displayIndex].debugLogs.length > maxLogs) {
			displaysData.displays[displayIndex].debugLogs =
				displaysData.displays[displayIndex].debugLogs.slice(-maxLogs);
		}

		saveDisplays(displaysData);

		res.json({
			success: true,
			logsReceived: logs.length,
			totalLogs: displaysData.displays[displayIndex].debugLogs.length,
			debugMode: true
		});
	} catch (error) {
		console.error('Push debug logs error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to store debug logs'
		});
	}
});

// Get debug logs for a display (requires authentication)
app.get('/api/displays/:id/logs', requireAuthAPI, async (req, res) => {
	const { id } = req.params;
	const { limit = 100, offset = 0, level, source } = req.query;

	try {
		const displaysData = loadDisplays();
		const display = displaysData.displays.find(d => d.id === id);

		if (!display) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		let logs = display.debugLogs || [];

		// Filter by level if specified
		if (level) {
			logs = logs.filter(log => log.level === level);
		}

		// Filter by source if specified
		if (source) {
			logs = logs.filter(log => log.source === source);
		}

		// Apply pagination (newest first)
		const totalLogs = logs.length;
		logs = logs.slice().reverse().slice(parseInt(offset), parseInt(offset) + parseInt(limit));

		res.json({
			success: true,
			displayId: id,
			hostname: display.hostname,
			debugMode: display.debugMode || false,
			logs: logs,
			totalLogs: totalLogs,
			limit: parseInt(limit),
			offset: parseInt(offset)
		});
	} catch (error) {
		console.error('Get debug logs error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to retrieve debug logs'
		});
	}
});

// Clear debug logs for a display (requires authentication)
app.delete('/api/displays/:id/logs', requireAuthAPI, async (req, res) => {
	const { id } = req.params;

	try {
		const displaysData = loadDisplays();
		const displayIndex = displaysData.displays.findIndex(d => d.id === id);

		if (displayIndex === -1) {
			return res.status(404).json({
				success: false,
				error: 'Display not found'
			});
		}

		const display = displaysData.displays[displayIndex];
		const logCount = display.debugLogs ? display.debugLogs.length : 0;

		// Clear logs
		displaysData.displays[displayIndex].debugLogs = [];
		saveDisplays(displaysData);

		// Log activity
		logActivity(
			req.session.userId,
			req.session.username,
			'clear_debug_logs',
			{
				displayId: id,
				hostname: display.hostname,
				logsCleared: logCount
			}
		);

		res.json({
			success: true,
			message: `Cleared ${logCount} debug logs for ${display.hostname}`
		});
	} catch (error) {
		console.error('Clear debug logs error:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to clear debug logs'
		});
	}
});

// ============================================
// USER MANAGEMENT API ENDPOINTS
// ============================================

// Get all users (admin only)
app.get('/api/users', requireAuthAPI, requireAdmin, (req, res) => {
	const usersData = loadUsers();

	// Don't send passwords to client
	const safeUsers = usersData.users.map(u => ({
		id: u.id,
		username: u.username,
		role: u.role,
		createdAt: u.createdAt
	}));

	res.json({
		success: true,
		users: safeUsers
	});
});

// Add new user (admin only)
app.post('/api/users', requireAuthAPI, requireAdmin, async (req, res) => {
	const { username, password, role } = req.body;

	if (!username || !password) {
		return res.status(400).json({
			success: false,
			error: 'Username and password are required'
		});
	}

	// Validate password
	const passwordValidation = validatePassword(password);
	if (!passwordValidation.valid) {
		return res.status(400).json({
			success: false,
			error: passwordValidation.errors.join('. ')
		});
	}

	// Check if user already exists
	const usersData = loadUsers();
	if (usersData.users.find(u => u.username === username)) {
		return res.status(409).json({
			success: false,
			error: 'Username already exists'
		});
	}

	// Hash password
	const hashedPassword = await bcrypt.hash(password, 10);

	// Create new user
	const newUser = {
		id: Math.max(...usersData.users.map(u => u.id), 0) + 1,
		username,
		password: hashedPassword,
		role: role || 'user',
		createdAt: new Date().toISOString()
	};

	usersData.users.push(newUser);
	saveUsers(usersData);

	res.json({
		success: true,
		user: {
			id: newUser.id,
			username: newUser.username,
			role: newUser.role,
			createdAt: newUser.createdAt
		}
	});
});

// Update user (admin only)
app.put('/api/users/:id', requireAuthAPI, requireAdmin, async (req, res) => {
	const userId = parseInt(req.params.id);
	const { username, password, role } = req.body;

	const usersData = loadUsers();
	const userIndex = usersData.users.findIndex(u => u.id === userId);

	if (userIndex === -1) {
		return res.status(404).json({
			success: false,
			error: 'User not found'
		});
	}

	// Update fields
	if (username) {
		// Check if new username already exists
		if (usersData.users.find(u => u.username === username && u.id !== userId)) {
			return res.status(409).json({
				success: false,
				error: 'Username already exists'
			});
		}
		usersData.users[userIndex].username = username;
	}

	if (password) {
		// Validate password
		const passwordValidation = validatePassword(password);
		if (!passwordValidation.valid) {
			return res.status(400).json({
				success: false,
				error: passwordValidation.errors.join('. ')
			});
		}
		const hashedPassword = await bcrypt.hash(password, 10);
		usersData.users[userIndex].password = hashedPassword;
	}

	if (role) {
		usersData.users[userIndex].role = role;
	}

	saveUsers(usersData);

	res.json({
		success: true,
		user: {
			id: usersData.users[userIndex].id,
			username: usersData.users[userIndex].username,
			role: usersData.users[userIndex].role,
			createdAt: usersData.users[userIndex].createdAt
		}
	});
});

// Delete user (admin only)
app.delete('/api/users/:id', requireAuthAPI, requireAdmin, (req, res) => {
	const userId = parseInt(req.params.id);

	// Prevent deleting own account
	if (req.session.userId === userId) {
		return res.status(400).json({
			success: false,
			error: 'Cannot delete your own account'
		});
	}

	const usersData = loadUsers();
	const userIndex = usersData.users.findIndex(u => u.id === userId);

	if (userIndex === -1) {
		return res.status(404).json({
			success: false,
			error: 'User not found'
		});
	}

	usersData.users.splice(userIndex, 1);
	saveUsers(usersData);

	res.json({
		success: true,
		message: 'User deleted successfully'
	});
});

// ============================================
// SYSTEM SETTINGS API ENDPOINTS (ADMIN ONLY)
// ============================================

// Get all system settings
app.get('/api/settings/system', requireAuthAPI, requireAdmin, (req, res) => {
	const settings = loadSettings();

	if (!settings) {
		return res.status(500).json({
			success: false,
			error: 'Failed to load settings'
		});
	}

	// Don't send sensitive data like passwords
	const safeSettings = { ...settings };
	if (safeSettings.notifications?.email?.smtpPassword) {
		safeSettings.notifications.email.smtpPassword = '********';
	}

	res.json({
		success: true,
		settings: safeSettings
	});
});

// Update system settings
app.put('/api/settings/system', requireAuthAPI, requireAdmin, (req, res) => {
	const { section, data } = req.body;

	if (!section || !data) {
		return res.status(400).json({
			success: false,
			error: 'Section and data are required'
		});
	}

	const settings = loadSettings();
	if (!settings) {
		return res.status(500).json({
			success: false,
			error: 'Failed to load settings'
		});
	}

	// Update the specific section
	settings[section] = data;

	if (!saveSettings(settings)) {
		return res.status(500).json({
			success: false,
			error: 'Failed to save settings'
		});
	}

	// Clear settings cache so changes take effect immediately
	systemSettingsCache = null;
	systemSettingsCacheTime = 0;

	// Restart adaptive rate scheduler if challonge settings changed
	if (section === 'challonge') {
		console.log('[Settings] Challonge settings updated, restarting adaptive rate scheduler...');
		startAdaptiveRateScheduler();
	}

	// Log activity
	logActivity(req.session.userId, req.session.username, 'update_settings', {
		section,
		changes: Object.keys(data)
	});

	res.json({
		success: true,
		message: 'Settings updated successfully'
	});
});

// Get activity log
app.get('/api/settings/activity-log', requireAuthAPI, requireAdmin, (req, res) => {
	const limit = parseInt(req.query.limit) || 100;
	const offset = parseInt(req.query.offset) || 0;

	const logData = loadActivityLog();
	const logs = logData.logs.slice(offset, offset + limit);

	res.json({
		success: true,
		logs,
		total: logData.logs.length,
		limit,
		offset
	});
});

// Clear activity log
app.delete('/api/settings/activity-log', requireAuthAPI, requireAdmin, (req, res) => {
	saveActivityLog({ logs: [] });

	logActivity(req.session.userId, req.session.username, 'clear_activity_log', {});

	res.json({
		success: true,
		message: 'Activity log cleared'
	});
});

// ============================================
// LIVE ACTIVITY FEED API ENDPOINTS
// ============================================

// GET /api/activity - Paginated activity with filtering
// Query params: ?limit=50&offset=0&category=all&search=
app.get('/api/activity', requireAuthAPI, (req, res) => {
	const limit = Math.min(parseInt(req.query.limit) || 50, 100);
	const offset = parseInt(req.query.offset) || 0;
	const category = req.query.category || 'all';
	const search = (req.query.search || '').toLowerCase().trim();

	const logData = loadActivityLog();
	let filtered = logData.logs;

	// Filter by category
	if (category !== 'all' && ACTIVITY_CATEGORIES[category]) {
		filtered = filtered.filter(entry =>
			ACTIVITY_CATEGORIES[category].includes(entry.action)
		);
	}

	// Filter by search (player name, username, action, tournament name)
	if (search) {
		filtered = filtered.filter(entry => {
			const playerName = (entry.details?.playerName || '').toLowerCase();
			const tournamentName = (entry.details?.tournamentName || entry.details?.name || '').toLowerCase();
			const username = (entry.username || '').toLowerCase();
			const action = (entry.action || '').toLowerCase();
			return username.includes(search) ||
				action.includes(search) ||
				playerName.includes(search) ||
				tournamentName.includes(search);
		});
	}

	const total = filtered.length;
	const paginated = filtered.slice(offset, offset + limit);

	res.json({
		success: true,
		activity: paginated,
		pagination: {
			total,
			limit,
			offset,
			hasMore: offset + limit < total
		}
	});
});

// POST /api/activity/external - Webhook for external event sources (signup PWA, etc.)
// Uses X-Activity-Token header for authentication (no session required)
app.post('/api/activity/external', (req, res) => {
	// Validate activity webhook token
	const authToken = req.headers['x-activity-token'];
	const expectedToken = process.env.ACTIVITY_WEBHOOK_TOKEN || 'default-activity-token-change-me';

	if (!authToken || authToken !== expectedToken) {
		return res.status(401).json({
			success: false,
			error: 'Invalid or missing activity token'
		});
	}

	const { action, details, source } = req.body;

	if (!action) {
		return res.status(400).json({
			success: false,
			error: 'Action is required'
		});
	}

	// Log with source indicator (userId = 0 for external sources)
	logActivity(0, source || 'External', action, {
		...details,
		source: source || 'external'
	});

	// Send push notification for new signups
	if (action === 'participant_signup' || action === 'new_signup') {
		const participantName = details?.name || details?.participantName || 'New participant';
		const tournamentName = details?.tournament || details?.tournamentName || '';
		broadcastPushNotification('new_signup', {
			title: 'New Signup',
			body: tournamentName ? `${participantName} signed up for ${tournamentName}` : `${participantName} signed up`,
			data: {
				type: 'new_signup',
				participantName,
				tournamentName,
				...details
			}
		}).catch(err => console.error('[Push] Signup notification error:', err.message));
	}

	res.json({
		success: true,
		message: 'Activity logged successfully'
	});
});

// Change own password
app.post('/api/settings/change-password', requireAuthAPI, async (req, res) => {
	const { currentPassword, newPassword } = req.body;

	if (!currentPassword || !newPassword) {
		return res.status(400).json({
			success: false,
			error: 'Current password and new password are required'
		});
	}

	const usersData = loadUsers();
	const user = usersData.users.find(u => u.id === req.session.userId);

	if (!user) {
		return res.status(404).json({
			success: false,
			error: 'User not found'
		});
	}

	// Verify current password
	const passwordMatch = await bcrypt.compare(currentPassword, user.password);
	if (!passwordMatch) {
		return res.status(401).json({
			success: false,
			error: 'Current password is incorrect'
		});
	}

	// Validate new password
	const passwordValidation = validatePassword(newPassword);
	if (!passwordValidation.valid) {
		return res.status(400).json({
			success: false,
			error: passwordValidation.errors.join('. ')
		});
	}

	// Hash and save new password
	const hashedPassword = await bcrypt.hash(newPassword, 10);
	user.password = hashedPassword;
	saveUsers(usersData);

	res.json({
		success: true,
		message: 'Password changed successfully'
	});
});

// Get system defaults (for pre-filling tournament form)
app.get('/api/settings/defaults', requireAuthAPI, (req, res) => {
	const defaults = getSystemDefaults();
	const securitySettings = getSecuritySettings();

	res.json({
		success: true,
		defaults: {
			registrationWindow: defaults.registrationWindow,
			signupCap: defaults.signupCap,
			defaultGame: defaults.defaultGame,
			tournamentType: defaults.tournamentType
		},
		security: {
			passwordMinLength: securitySettings.passwordMinLength,
			requirePasswordComplexity: securitySettings.requirePasswordComplexity
		}
	});
});

// ============================================
// SYSTEM MONITORING API ENDPOINTS (ADMIN ONLY)
// ============================================

// Start monitoring session
app.post('/api/monitoring/start', requireAuthAPI, requireAdmin, async (req, res) => {
	const { durationMinutes = 5 } = req.body;

	// Validate duration (1-120 minutes)
	const duration = Math.min(Math.max(parseInt(durationMinutes) || 5, 1), 120);
	const durationMs = duration * 60 * 1000;

	const result = systemMonitor.startMonitoring(durationMs);

	if (result.success) {
		logActivity(
			req.session.userId,
			req.session.username,
			'monitoring_started',
			{ sessionId: result.sessionId, durationMinutes: duration }
		);
	}

	res.json(result);
});

// Stop monitoring session
app.post('/api/monitoring/stop', requireAuthAPI, requireAdmin, async (req, res) => {
	const result = systemMonitor.stopMonitoring();

	if (result.success) {
		logActivity(
			req.session.userId,
			req.session.username,
			'monitoring_stopped',
			{ sessionId: result.sessionId, samplesCollected: result.samplesCollected }
		);
	}

	res.json(result);
});

// Get monitoring status
app.get('/api/monitoring/status', requireAuthAPI, requireAdmin, (req, res) => {
	const status = systemMonitor.getMonitoringStatus();
	res.json({ success: true, ...status });
});

// Generate and get monitoring report
app.get('/api/monitoring/report', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const result = await systemMonitor.generateCurrentReport();

		if (result.error) {
			return res.status(400).json({ success: false, error: result.error });
		}

		logActivity(
			req.session.userId,
			req.session.username,
			'monitoring_report_generated',
			{ savedTo: result.savedTo }
		);

		res.json(result);
	} catch (error) {
		console.error('Error generating monitoring report:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Run quick system check (no persistent monitoring)
app.get('/api/monitoring/quick-check', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const result = await systemMonitor.runQuickCheck();

		logActivity(
			req.session.userId,
			req.session.username,
			'quick_system_check',
			{ issueCount: result.report?.issuesForDebugging?.length || 0 }
		);

		res.json(result);
	} catch (error) {
		console.error('Error running quick check:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get service logs for debugging
app.get('/api/monitoring/logs', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const logs = await systemMonitor.getServiceLogs();
		res.json({ success: true, logs });
	} catch (error) {
		console.error('Error getting service logs:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// List saved monitoring reports
app.get('/api/monitoring/reports', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const reportsDir = systemMonitor.CONFIG.reportDir;

		// Create directory if it doesn't exist
		try {
			await fs.mkdir(reportsDir, { recursive: true });
		} catch (e) {
			// Directory may already exist
		}

		const files = await fs.readdir(reportsDir);
		const reports = [];

		for (const file of files) {
			if (file.endsWith('.json')) {
				const stat = await fs.stat(path.join(reportsDir, file));
				reports.push({
					filename: file,
					createdAt: stat.mtime.toISOString(),
					sizeBytes: stat.size
				});
			}
		}

		// Sort by date descending (newest first)
		reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

		res.json({ success: true, reports });
	} catch (error) {
		console.error('Error listing reports:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get a specific saved report
app.get('/api/monitoring/reports/:filename', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const { filename } = req.params;

		// Validate filename to prevent directory traversal
		if (!filename.match(/^monitoring-report-[\d-TZ]+\.json$/)) {
			return res.status(400).json({ success: false, error: 'Invalid filename' });
		}

		const filepath = path.join(systemMonitor.CONFIG.reportDir, filename);
		const content = await fs.readFile(filepath, 'utf8');
		const report = JSON.parse(content);

		res.json({ success: true, report });
	} catch (error) {
		if (error.code === 'ENOENT') {
			res.status(404).json({ success: false, error: 'Report not found' });
		} else {
			console.error('Error reading report:', error);
			res.status(500).json({ success: false, error: error.message });
		}
	}
});

// Delete a saved report
app.delete('/api/monitoring/reports/:filename', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const { filename } = req.params;

		// Validate filename to prevent directory traversal
		if (!filename.match(/^monitoring-report-[\d-TZ]+\.json$/)) {
			return res.status(400).json({ success: false, error: 'Invalid filename' });
		}

		const filepath = path.join(systemMonitor.CONFIG.reportDir, filename);
		await fs.unlink(filepath);

		logActivity(
			req.session.userId,
			req.session.username,
			'monitoring_report_deleted',
			{ filename }
		);

		res.json({ success: true, message: 'Report deleted' });
	} catch (error) {
		if (error.code === 'ENOENT') {
			res.status(404).json({ success: false, error: 'Report not found' });
		} else {
			console.error('Error deleting report:', error);
			res.status(500).json({ success: false, error: error.message });
		}
	}
});

// ============================================
// TOURNAMENT TEMPLATES API ROUTES
// ============================================

// Get all templates
app.get('/api/templates', requireAuthAPI, (req, res) => {
	try {
		const { game } = req.query;
		const templates = analyticsDb.getAllTemplates({ gameName: game || null });
		res.json({ success: true, templates });
	} catch (error) {
		console.error('Error fetching templates:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get template by ID
app.get('/api/templates/:id', requireAuthAPI, (req, res) => {
	try {
		const templateId = parseInt(req.params.id);
		const template = analyticsDb.getTemplateById(templateId);
		if (!template) {
			return res.status(404).json({ success: false, error: 'Template not found' });
		}
		res.json({ success: true, template });
	} catch (error) {
		console.error('Error fetching template:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Create new template
app.post('/api/templates', requireAuthAPI, (req, res) => {
	try {
		const { name, description, gameName, settings } = req.body;

		if (!name || !name.trim()) {
			return res.status(400).json({ success: false, error: 'Template name is required' });
		}
		if (!settings || typeof settings !== 'object') {
			return res.status(400).json({ success: false, error: 'Settings object is required' });
		}

		const template = analyticsDb.createTemplate(
			name.trim(),
			description || '',
			gameName || '',
			settings,
			req.session.username || 'admin'
		);

		logActivity(req.session.userId, req.session.username, 'template_created', {
			templateId: template.id,
			templateName: template.name
		});

		res.json({ success: true, template, message: 'Template created successfully' });
	} catch (error) {
		console.error('Error creating template:', error);
		if (error.message.includes('UNIQUE constraint')) {
			return res.status(400).json({ success: false, error: 'A template with this name already exists' });
		}
		res.status(500).json({ success: false, error: error.message });
	}
});

// Update template
app.put('/api/templates/:id', requireAuthAPI, (req, res) => {
	try {
		const templateId = parseInt(req.params.id);
		const updates = req.body;

		const template = analyticsDb.updateTemplate(templateId, updates);
		if (!template) {
			return res.status(404).json({ success: false, error: 'Template not found' });
		}

		logActivity(req.session.userId, req.session.username, 'template_updated', {
			templateId: template.id,
			templateName: template.name
		});

		res.json({ success: true, template, message: 'Template updated successfully' });
	} catch (error) {
		console.error('Error updating template:', error);
		if (error.message.includes('UNIQUE constraint')) {
			return res.status(400).json({ success: false, error: 'A template with this name already exists' });
		}
		res.status(500).json({ success: false, error: error.message });
	}
});

// Delete template
app.delete('/api/templates/:id', requireAuthAPI, (req, res) => {
	try {
		const templateId = parseInt(req.params.id);
		const template = analyticsDb.getTemplateById(templateId);

		if (!template) {
			return res.status(404).json({ success: false, error: 'Template not found' });
		}

		const deleted = analyticsDb.deleteTemplate(templateId);
		if (!deleted) {
			return res.status(400).json({ success: false, error: 'Could not delete template' });
		}

		logActivity(req.session.userId, req.session.username, 'template_deleted', {
			templateId: templateId,
			templateName: template.name
		});

		res.json({ success: true, message: 'Template deleted successfully' });
	} catch (error) {
		console.error('Error deleting template:', error);
		if (error.message.includes('Cannot delete default template')) {
			return res.status(400).json({ success: false, error: 'Cannot delete the default template' });
		}
		res.status(500).json({ success: false, error: error.message });
	}
});

// Create template from tournament data
app.post('/api/templates/from-tournament', requireAuthAPI, (req, res) => {
	try {
		const { tournamentData, templateName, description } = req.body;

		if (!templateName || !templateName.trim()) {
			return res.status(400).json({ success: false, error: 'Template name is required' });
		}
		if (!tournamentData || typeof tournamentData !== 'object') {
			return res.status(400).json({ success: false, error: 'Tournament data is required' });
		}

		const template = analyticsDb.createTemplateFromTournament(
			tournamentData,
			templateName.trim(),
			description || '',
			req.session.username || 'admin'
		);

		logActivity(req.session.userId, req.session.username, 'template_created_from_tournament', {
			templateId: template.id,
			templateName: template.name
		});

		res.json({ success: true, template, message: 'Template created from tournament successfully' });
	} catch (error) {
		console.error('Error creating template from tournament:', error);
		if (error.message.includes('UNIQUE constraint')) {
			return res.status(400).json({ success: false, error: 'A template with this name already exists' });
		}
		res.status(500).json({ success: false, error: error.message });
	}
});

// ============================================
// ANALYTICS API ROUTES
// ============================================

// Initialize analytics database on startup
analyticsDb.initDatabase();

// Initialize local DB services for tcc-custom
const tournamentDb = require('./services/tournament-db');
const matchDb = require('./services/match-db');
const participantDb = require('./services/participant-db');

// Initialize AI seeding service with local DB
aiSeedingService.init({
	io,
	analyticsDb,
	tournamentApi: {
		getTournament: async (tournamentId) => {
			return tournamentDb.getById(tournamentId);
		},
		getParticipants: async (tournamentId) => {
			return participantDb.getByTournament(tournamentId);
		},
		updateParticipantSeed: async (tournamentId, participantId, seed) => {
			return participantDb.update(participantId, { seed });
		}
	},
	activityLogger: {
		log: logActivity
	}
});

// Initialize Tournament Narrator service
tournamentNarratorService.init({
	io,
	analyticsDb,
	activityLogger: {
		logActivity
	}
});

// Get all games with tournament counts
app.get('/api/analytics/games', requireAuthAPI, (req, res) => {
	try {
		const games = analyticsDb.getAllGames();
		res.json({ success: true, games });
	} catch (error) {
		console.error('Error fetching games:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get overview statistics
app.get('/api/analytics/stats/overview', requireAuthAPI, (req, res) => {
	try {
		const stats = analyticsDb.getOverviewStats();
		res.json({ success: true, ...stats });
	} catch (error) {
		console.error('Error fetching overview stats:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get attendance statistics
app.get('/api/analytics/stats/attendance', requireAuthAPI, (req, res) => {
	try {
		const { game: gameId, months = 6 } = req.query;
		const stats = analyticsDb.getAttendanceStats(
			gameId ? parseInt(gameId) : null,
			parseInt(months)
		);
		res.json({ success: true, ...stats });
	} catch (error) {
		console.error('Error fetching attendance stats:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get player rankings for a game
app.get('/api/analytics/rankings/:gameId', requireAuthAPI, (req, res) => {
	try {
		const { gameId } = req.params;
		const { limit = 50, offset = 0, sortBy = 'elo' } = req.query;

		const rankings = analyticsDb.getPlayerRankings(parseInt(gameId), {
			limit: parseInt(limit),
			offset: parseInt(offset),
			sortBy
		});

		res.json({ success: true, rankings });
	} catch (error) {
		console.error('Error fetching rankings:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Search players
app.get('/api/analytics/players', requireAuthAPI, (req, res) => {
	try {
		const { search = '', game: gameId, limit = 20 } = req.query;

		if (!search) {
			return res.json({ success: true, players: [] });
		}

		const players = analyticsDb.searchPlayers(
			search,
			gameId ? parseInt(gameId) : null,
			parseInt(limit)
		);

		res.json({ success: true, players });
	} catch (error) {
		console.error('Error searching players:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get player profile
app.get('/api/analytics/players/:playerId', requireAuthAPI, (req, res) => {
	try {
		const { playerId } = req.params;
		const profile = analyticsDb.getPlayerProfile(parseInt(playerId));

		if (!profile) {
			return res.status(404).json({ success: false, error: 'Player not found' });
		}

		res.json({ success: true, ...profile });
	} catch (error) {
		console.error('Error fetching player profile:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get head-to-head record
app.get('/api/analytics/players/:player1Id/head-to-head/:player2Id', requireAuthAPI, (req, res) => {
	try {
		const { player1Id, player2Id } = req.params;
		const { game: gameId } = req.query;

		const h2h = analyticsDb.getHeadToHead(
			parseInt(player1Id),
			parseInt(player2Id),
			gameId ? parseInt(gameId) : null
		);

		res.json({ success: true, ...h2h });
	} catch (error) {
		console.error('Error fetching head-to-head:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Add alias to player
app.put('/api/analytics/players/:playerId/alias', requireAuthAPI, async (req, res) => {
	try {
		const { playerId } = req.params;
		const { alias } = req.body;

		if (!alias) {
			return res.status(400).json({ success: false, error: 'Alias is required' });
		}

		const success = analyticsDb.addPlayerAlias(parseInt(playerId), alias);

		if (success) {
			logActivity(req.session.userId, req.session.username, 'player_alias_added', { playerId, alias });
		}

		res.json({ success });
	} catch (error) {
		console.error('Error adding alias:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Merge players
app.post('/api/analytics/players/merge', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const { sourcePlayerId, targetPlayerId } = req.body;

		if (!sourcePlayerId || !targetPlayerId) {
			return res.status(400).json({ success: false, error: 'Both player IDs are required' });
		}

		analyticsDb.mergePlayers(parseInt(sourcePlayerId), parseInt(targetPlayerId));

		logActivity(req.session.userId, req.session.username, 'players_merged', { sourcePlayerId, targetPlayerId });

		res.json({ success: true });
	} catch (error) {
		console.error('Error merging players:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get unmatched players queue
app.get('/api/analytics/players/unmatched', requireAuthAPI, (req, res) => {
	try {
		const unmatched = analyticsDb.getUnmatchedPlayers();
		res.json({ success: true, unmatched });
	} catch (error) {
		console.error('Error fetching unmatched players:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Resolve unmatched player
app.post('/api/analytics/players/unmatched/:id/resolve', requireAuthAPI, async (req, res) => {
	try {
		const { id } = req.params;
		const { playerId, createNew, newPlayerName } = req.body;

		let resolvedPlayerId = playerId;

		if (createNew && newPlayerName) {
			resolvedPlayerId = analyticsDb.createPlayer(newPlayerName);
		}

		analyticsDb.resolveUnmatchedPlayer(parseInt(id), resolvedPlayerId ? parseInt(resolvedPlayerId) : null);

		logActivity(req.session.userId, req.session.username, 'unmatched_player_resolved', { unmatchedId: id, playerId: resolvedPlayerId });

		res.json({ success: true });
	} catch (error) {
		console.error('Error resolving unmatched player:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get archived tournaments
app.get('/api/analytics/tournaments', requireAuthAPI, (req, res) => {
	try {
		const { game: gameId, limit = 50, offset = 0 } = req.query;

		const tournaments = analyticsDb.getArchivedTournaments({
			gameId: gameId ? parseInt(gameId) : null,
			limit: parseInt(limit),
			offset: parseInt(offset)
		});

		res.json({ success: true, tournaments });
	} catch (error) {
		console.error('Error fetching archived tournaments:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get tournament details
app.get('/api/analytics/tournaments/:tournamentId', requireAuthAPI, (req, res) => {
	try {
		const { tournamentId } = req.params;
		const data = analyticsDb.getTournamentById(parseInt(tournamentId));

		if (!data) {
			return res.status(404).json({ success: false, error: 'Tournament not found' });
		}

		res.json({ success: true, ...data });
	} catch (error) {
		console.error('Error fetching tournament details:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get archive status (which tournaments are archived vs not) - v2.1 API
app.get('/api/analytics/archive/status', requireAuthAPI, async (req, res) => {
	try {
		// Fetch completed tournaments from Challonge v2.1
		const response = await challongeV2Request('GET', '/tournaments.json?page_size=100&state=complete');
		const tournamentsData = response.data?.data || [];

		// Filter to only include tournaments that are truly complete (have completed_at date)
		const challongeTournaments = tournamentsData
			.filter(t => t.attributes.state === 'complete' && t.attributes.timestamps?.completed_at)
			.map(t => ({
				id: parseInt(t.id),
				url: t.attributes.url,
				name: t.attributes.name,
				game: t.attributes.game_name,
				state: t.attributes.state,
				completedAt: t.attributes.timestamps?.completed_at,
				participantCount: t.attributes.participants_count
			}));

		// Check which are archived
		const archived = [];
		const unarchived = [];

		for (const t of challongeTournaments) {
			if (analyticsDb.isTournamentArchived(t.url)) {
				archived.push(t);
			} else {
				unarchived.push(t);
			}
		}

		res.json({ success: true, archived, unarchived });
	} catch (error) {
		console.error('Error fetching archive status:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Archive a tournament - v2.1 API
app.post('/api/analytics/archive/:tournamentId', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params; // This is the Challonge URL slug

		// Check if already archived
		if (analyticsDb.isTournamentArchived(tournamentId)) {
			return res.status(400).json({ success: false, error: 'Tournament already archived' });
		}

		// Fetch tournament details from Challonge v2.1
		const tournamentResponse = await challongeV2Request('GET', `/tournaments/${tournamentId}.json`);
		const tournamentData = tournamentResponse.data.data;
		const attrs = tournamentData.attributes;

		// Transform to internal format
		const tournament = {
			id: parseInt(tournamentData.id),
			url: attrs.url,
			name: attrs.name,
			game_name: attrs.game_name,
			tournament_type: attrs.tournament_type,
			state: attrs.state,
			started_at: attrs.timestamps?.started_at,
			completed_at: attrs.timestamps?.completed_at,
			full_challonge_url: attrs.full_challonge_url
		};

		if (tournament.state !== 'complete') {
			return res.status(400).json({ success: false, error: 'Tournament is not complete' });
		}

		// Fetch participants v2.1
		const participantsResponse = await challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json?page_size=256`);
		const participantsData = participantsResponse.data?.data || [];
		const participants = participantsData.map(p => ({
			id: parseInt(p.id),
			name: p.attributes.name,
			display_name: p.attributes.display_name,
			seed: p.attributes.seed,
			final_rank: p.attributes.final_rank,
			checked_in: p.attributes.checked_in,
			invite_email: p.attributes.email,
			challonge_username: p.attributes.username,
			misc: p.attributes.misc
		}));

		// Fetch matches v2.1
		const matchesResponse = await challongeV2Request('GET', `/tournaments/${tournamentId}/matches.json?page_size=256`);
		const matchesData = matchesResponse.data?.data || [];
		const matches = matchesData.map(m => {
			// v2.1 API: player IDs are in points_by_participant, NOT in attributes.player1_id
			const pointsByParticipant = m.attributes?.points_by_participant || [];
			const player1Points = pointsByParticipant[0]?.participant_id;
			const player2Points = pointsByParticipant[1]?.participant_id;

			return {
				id: parseInt(m.id),
				state: m.attributes.state,
				round: m.attributes.round,
				player1_id: player1Points,
				player2_id: player2Points,
				winner_id: m.attributes.winner_id,
				// v2.1 uses 'scores' (display format like "2 - 0") instead of scores_csv
				scores_csv: m.attributes.scores_csv || (m.attributes.scores ? m.attributes.scores.replace(/\s/g, '') : null),
				completed_at: m.attributes.timestamps?.completed_at,
				identifier: m.attributes.identifier
			};
		});

		// Get or create game
		const game = analyticsDb.getOrCreateGame(tournament.game_name || 'Unknown');

		// Map Challonge participant IDs to our player IDs
		const participantToPlayerMap = {};
		const unmatchedParticipants = [];

		for (const participant of participants) {
			const name = participant.name || participant.display_name;
			const match = analyticsDb.findPlayerByName(name);

			if (match && match.matchType !== 'suggestion') {
				participantToPlayerMap[participant.id] = match.player.id;
			} else if (match && match.matchType === 'suggestion') {
				// Create new player but queue for potential manual merge
				const newPlayerId = analyticsDb.createPlayer(
					name,
					participant.invite_email,
					participant.challonge_username,
					participant.misc?.includes('Instagram:') ? participant.misc.replace('Instagram:', '').trim() : null
				);
				participantToPlayerMap[participant.id] = newPlayerId;
				unmatchedParticipants.push({
					name,
					playerId: newPlayerId,
					suggestedMerge: match.player.id,
					distance: match.distance
				});
			} else {
				// Create new player
				const newPlayerId = analyticsDb.createPlayer(
					name,
					participant.invite_email,
					participant.challonge_username,
					participant.misc?.includes('Instagram:') ? participant.misc.replace('Instagram:', '').trim() : null
				);
				participantToPlayerMap[participant.id] = newPlayerId;
			}
		}

		// Archive tournament
		const dbTournamentId = analyticsDb.archiveTournament({
			challongeId: tournament.id,
			challongeUrl: tournament.url,
			name: tournament.name,
			gameId: game.id,
			tournamentType: tournament.tournament_type,
			participantCount: participants.length,
			startedAt: tournament.started_at,
			completedAt: tournament.completed_at,
			fullChallongeUrl: tournament.full_challonge_url
		});

		// Add tournament participants
		for (const participant of participants) {
			analyticsDb.addTournamentParticipant({
				tournamentId: dbTournamentId,
				playerId: participantToPlayerMap[participant.id],
				challongeParticipantId: participant.id,
				seed: participant.seed,
				finalRank: participant.final_rank,
				checkedIn: participant.checked_in
			});
		}

		// Add matches
		for (const match of matches) {
			if (match.state !== 'complete') continue;

			const scores = analyticsDb.parseScores(match.scores_csv);
			const player1Id = participantToPlayerMap[match.player1_id];
			const player2Id = participantToPlayerMap[match.player2_id];
			const winnerId = participantToPlayerMap[match.winner_id];
			const loserId = winnerId === player1Id ? player2Id : player1Id;

			analyticsDb.addMatch({
				tournamentId: dbTournamentId,
				challongeMatchId: match.id,
				round: match.round,
				player1Id,
				player2Id,
				winnerId,
				loserId,
				player1Score: scores.player1Score,
				player2Score: scores.player2Score,
				scoresCsv: match.scores_csv,
				completedAt: match.completed_at,
				matchIdentifier: match.identifier
			});
		}

		// Queue unmatched for review
		for (const um of unmatchedParticipants) {
			analyticsDb.addUnmatchedPlayer(dbTournamentId, um.name, um.suggestedMerge, 1 - (um.distance / 10));
		}

		// Update Elo ratings
		analyticsDb.updateEloRatings(dbTournamentId, game.id);

		logActivity(req.session.userId, req.session.username, 'tournament_archived', {
			tournamentId,
			name: tournament.name,
			participants: participants.length,
			matches: matches.filter(m => m.state === 'complete').length
		});

		res.json({
			success: true,
			archived: {
				id: dbTournamentId,
				name: tournament.name,
				participants: participants.length,
				matches: matches.filter(m => m.state === 'complete').length,
				unmatchedPlayers: unmatchedParticipants.length
			}
		});
	} catch (error) {
		console.error('Error archiving tournament:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get upcoming tournaments (for seeding suggestions) - v2.1 API
// Only shows pending tournaments (not yet started) - seeding should be done before tournament starts
app.get('/api/analytics/upcoming-tournaments', requireAuthAPI, async (req, res) => {
	try {
		// Fetch only pending tournaments using v2.1
		const pendingRes = await challongeV2Request('GET', '/tournaments.json?page_size=100&state=pending');
		const pendingData = pendingRes.data?.data || [];

		const now = new Date();

		const tournaments = pendingData
			.map(t => {
				const startAt = t.attributes.timestamps?.starts_at || t.attributes.starts_at;
				return {
					id: parseInt(t.id),
					url: t.attributes.url,
					name: t.attributes.name,
					game: t.attributes.game_name,
					state: t.attributes.state,
					startAt: startAt,
					participantCount: t.attributes.participants_count,
					isToday: startAt ?
						new Date(startAt).toDateString() === now.toDateString() : false
				};
			})
			.sort((a, b) => {
				// Today's tournaments first, then by start date
				if (a.isToday && !b.isToday) return -1;
				if (!a.isToday && b.isToday) return 1;
				return new Date(a.startAt || 0) - new Date(b.startAt || 0);
			});

		res.json({ success: true, tournaments });
	} catch (error) {
		console.error('Error fetching upcoming tournaments:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get seeding suggestions based on Elo rankings - v2.1 API
app.get('/api/analytics/seeding-suggestions/:tournamentId', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;

		// Fetch tournament info using v2.1
		const tournamentRes = await challongeV2Request('GET', `/tournaments/${tournamentId}.json`);
		const tournamentData = tournamentRes.data.data;
		const tournament = {
			id: parseInt(tournamentData.id),
			url: tournamentData.attributes.url,
			name: tournamentData.attributes.name,
			game_name: tournamentData.attributes.game_name,
			state: tournamentData.attributes.state,
			participants_count: tournamentData.attributes.participants_count
		};

		// Fetch current participants using v2.1
		const participantsRes = await challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json?page_size=256`);
		const participantsData = participantsRes.data?.data || [];
		const participants = participantsData.map(p => ({
			id: parseInt(p.id),
			name: p.attributes.name,
			display_name: p.attributes.display_name,
			seed: p.attributes.seed
		}));

		// Get game from tournament
		const gameName = tournament.game_name;
		const game = gameName ? analyticsDb.getOrCreateGame(gameName) : null;

		// Match participants to player records and get Elo
		const suggestions = [];
		for (const participant of participants) {
			const name = participant.name || participant.display_name;
			const playerMatch = analyticsDb.findPlayerByName(name);

			let elo = null;
			let playerId = null;
			let matchType = 'none';

			if (playerMatch) {
				playerId = playerMatch.player.id;
				matchType = playerMatch.matchType;

				// Get Elo for this game
				if (game) {
					const db = analyticsDb.getDb();
					const rating = db.prepare(`
						SELECT elo_rating, matches_played, wins, losses
						FROM player_ratings
						WHERE player_id = ? AND game_id = ?
					`).get(playerId, game.id);

					if (rating) {
						elo = rating.elo_rating;
					}
				}
			}

			suggestions.push({
				participantId: participant.id,
				name: name,
				currentSeed: participant.seed,
				playerId: playerId,
				matchType: matchType,
				elo: elo,
				isNewPlayer: !elo
			});
		}

		// Sort by Elo (highest first), new players at the end
		suggestions.sort((a, b) => {
			if (a.elo && b.elo) return b.elo - a.elo;
			if (a.elo && !b.elo) return -1;
			if (!a.elo && b.elo) return 1;
			return 0;
		});

		// Assign suggested seeds
		suggestions.forEach((s, index) => {
			s.suggestedSeed = index + 1;
			s.seedDiff = s.currentSeed ? s.suggestedSeed - s.currentSeed : null;
		});

		res.json({
			success: true,
			tournament: {
				id: tournament.id,
				url: tournament.url,
				name: tournament.name,
				game: gameName,
				state: tournament.state,
				participantCount: participants.length
			},
			suggestions,
			timestamp: new Date().toISOString()
		});
	} catch (error) {
		console.error('Error getting seeding suggestions:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Apply seeding suggestions to a tournament - v2.1 API
app.post('/api/analytics/apply-seeding/:tournamentId', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { seeds } = req.body; // Array of { participantId, seed }

		if (!seeds || !Array.isArray(seeds)) {
			return res.status(400).json({ success: false, error: 'Seeds array is required' });
		}

		// Update each participant's seed using v2.1
		const results = [];
		for (const { participantId, seed } of seeds) {
			try {
				await challongeV2Request('PUT', `/tournaments/${tournamentId}/participants/${participantId}.json`, {
					data: {
						type: 'Participant',
						attributes: { seed }
					}
				});
				results.push({ participantId, seed, success: true });
			} catch (err) {
				results.push({ participantId, seed, success: false, error: err.message });
			}
		}

		logActivity(req.session.userId, req.session.username, 'seeding_applied', {
			tournamentId,
			seedsApplied: results.filter(r => r.success).length,
			seedsFailed: results.filter(r => !r.success).length
		});

		res.json({
			success: true,
			results,
			applied: results.filter(r => r.success).length,
			failed: results.filter(r => !r.success).length
		});
	} catch (error) {
		console.error('Error applying seeding:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// ============================================
// AI SEEDING ENDPOINTS
// ============================================

// Check if AI seeding is available
app.get('/api/analytics/ai-seeding/status', requireAuthAPI, (req, res) => {
	try {
		const status = aiSeedingService.isAvailable();
		res.json({ success: true, ...status });
	} catch (error) {
		console.error('Error checking AI seeding status:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get AI seeding suggestions for a tournament
app.get('/api/analytics/ai-seeding/:tournamentId', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { regenerate } = req.query;

		console.log('[AI Seeding API] Request received for tournament:', tournamentId);
		console.log('[AI Seeding API] Regenerate:', regenerate);

		const forceRegenerate = regenerate === 'true';
		const result = await aiSeedingService.generateSeedingSuggestions(tournamentId, forceRegenerate);

		console.log('[AI Seeding API] Result success:', result.success !== false);
		console.log('[AI Seeding API] Result source:', result.source);
		console.log('[AI Seeding API] Seeds count:', result.seeds?.length || 0);

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[AI Seeding API] Error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Lock specific seed positions for AI seeding
app.post('/api/analytics/ai-seeding/:tournamentId/lock', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { lockedSeeds } = req.body; // Array of { participantId, seed }

		if (!lockedSeeds || !Array.isArray(lockedSeeds)) {
			return res.status(400).json({ success: false, error: 'lockedSeeds array is required' });
		}

		await aiSeedingService.updateLockedSeeds(tournamentId, lockedSeeds);

		res.json({ success: true, message: 'Seeds locked successfully' });
	} catch (error) {
		console.error('Error locking seeds:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Apply AI seeding suggestions to Challonge
app.post('/api/analytics/ai-seeding/:tournamentId/apply', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { seeds } = req.body; // Array of { participantId, seed }

		if (!seeds || !Array.isArray(seeds)) {
			return res.status(400).json({ success: false, error: 'seeds array is required' });
		}

		// Apply seeds to Challonge
		const results = [];
		for (const { participantId, seed } of seeds) {
			try {
				await challongeV2Request('PUT', `/tournaments/${tournamentId}/participants/${participantId}.json`, {
					data: {
						type: 'Participant',
						attributes: { seed }
					}
				});
				results.push({ participantId, seed, success: true });
			} catch (err) {
				results.push({ participantId, seed, success: false, error: err.message });
			}
		}

		logActivity(req.session.userId, req.session.username, 'ai_seeding_applied', {
			tournamentId,
			seedsApplied: results.filter(r => r.success).length,
			seedsFailed: results.filter(r => !r.success).length
		});

		res.json({
			success: true,
			results,
			applied: results.filter(r => r.success).length,
			failed: results.filter(r => !r.success).length
		});
	} catch (error) {
		console.error('Error applying AI seeding:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// ============================================
// TOURNAMENT NARRATIVE ENDPOINTS
// ============================================

// Check if narrative generation is available
app.get('/api/analytics/ai/narrative/status', requireAuthAPI, (req, res) => {
	try {
		const status = tournamentNarratorService.isAvailable();
		res.json({ success: true, ...status });
	} catch (error) {
		console.error('Error checking narrative status:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get/generate narrative for a tournament
app.get('/api/analytics/ai/narrative/:tournamentId', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { format = 'discord', regenerate = 'false' } = req.query;

		const result = await tournamentNarratorService.generateNarrative(
			parseInt(tournamentId, 10),
			format,
			{ forceRegenerate: regenerate === 'true' }
		);

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('Error generating narrative:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Regenerate narrative (explicit POST)
app.post('/api/analytics/ai/narrative/:tournamentId/regenerate', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { format = 'discord' } = req.body;

		const result = await tournamentNarratorService.generateNarrative(
			parseInt(tournamentId, 10),
			format,
			{ forceRegenerate: true }
		);

		logActivity(req.session.userId, req.session.username, 'narrative_regenerated', {
			tournamentId,
			format,
			source: result.source
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('Error regenerating narrative:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Get all cached narratives for a tournament
app.get('/api/analytics/ai/narrative/:tournamentId/cached', requireAuthAPI, (req, res) => {
	try {
		const { tournamentId } = req.params;
		const cached = tournamentNarratorService.getCachedNarratives(parseInt(tournamentId, 10));
		res.json({ success: true, cached });
	} catch (error) {
		console.error('Error getting cached narratives:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Clear cached narratives for a tournament
app.delete('/api/analytics/ai/narrative/:tournamentId/cache', requireAuthAPI, (req, res) => {
	try {
		const { tournamentId } = req.params;
		tournamentNarratorService.clearCache(parseInt(tournamentId, 10));
		res.json({ success: true, message: 'Narrative cache cleared' });
	} catch (error) {
		console.error('Error clearing narrative cache:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// ============================================
// EXPORT ENDPOINTS - Tournament Results Export
// ============================================

// Export standings as CSV
app.get('/api/export/:tournamentId/standings/csv', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { source } = req.query; // 'archive' or 'live'

		let standings = [];
		let tournamentName = 'tournament';

		if (source === 'archive') {
			// Get from SQLite analytics database (tournamentId is database ID)
			const data = analyticsDb.getTournamentById(parseInt(tournamentId));
			if (!data || !data.tournament) {
				return res.status(404).json({ success: false, error: 'Archived tournament not found' });
			}
			tournamentName = data.tournament.name;
			standings = data.standings.map(s => ({
				final_rank: s.final_rank,
				name: s.display_name || s.canonical_name,
				seed: s.seed
			}));
		} else {
			// Get live from Challonge API (tournamentId is Challonge URL slug)
			const [tournamentRes, participantsRes] = await Promise.all([
				challongeV2Request('GET', `/tournaments/${tournamentId}.json`),
				challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json?page_size=256`)
			]);

			tournamentName = tournamentRes.data?.data?.attributes?.name || 'tournament';
			const participantsData = participantsRes.data?.data || [];
			standings = participantsData.map(p => ({
				final_rank: p.attributes.final_rank,
				name: p.attributes.name || p.attributes.display_name,
				seed: p.attributes.seed
			})).sort((a, b) => (a.final_rank || 999) - (b.final_rank || 999));
		}

		// Generate CSV
		const headers = ['Rank', 'Name', 'Seed'];
		const rows = standings.map(s => [
			s.final_rank || '-',
			`"${(s.name || '').replace(/"/g, '""')}"`,
			s.seed || '-'
		].join(','));

		const csv = [headers.join(','), ...rows].join('\n');
		const safeFilename = tournamentName.replace(/[^a-z0-9]/gi, '_').substring(0, 50);

		res.setHeader('Content-Type', 'text/csv');
		res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}_standings.csv"`);
		res.send(csv);
	} catch (error) {
		console.error('Error exporting standings:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Export matches as CSV
app.get('/api/export/:tournamentId/matches/csv', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { source } = req.query;

		let matches = [];
		let tournamentName = 'tournament';

		if (source === 'archive') {
			// Get from SQLite analytics database
			const data = analyticsDb.getTournamentById(parseInt(tournamentId));
			if (!data || !data.tournament) {
				return res.status(404).json({ success: false, error: 'Archived tournament not found' });
			}
			tournamentName = data.tournament.name;
			matches = data.matches.map(m => ({
				round: m.round,
				identifier: m.match_identifier || '-',
				player1: m.player1_name || 'BYE',
				player2: m.player2_name || 'BYE',
				score: m.scores_csv || `${m.player1_score || 0}-${m.player2_score || 0}`,
				winner: m.winner_name || '-'
			}));
		} else {
			// Get live from Challonge API
			const [tournamentRes, matchesRes, participantsRes] = await Promise.all([
				challongeV2Request('GET', `/tournaments/${tournamentId}.json`),
				challongeV2Request('GET', `/tournaments/${tournamentId}/matches.json?page_size=256`),
				challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json?page_size=256`)
			]);

			tournamentName = tournamentRes.data?.data?.attributes?.name || 'tournament';

			// Build participant lookup
			const participants = {};
			(participantsRes.data?.data || []).forEach(p => {
				participants[p.id] = p.attributes.name || p.attributes.display_name;
			});

			const matchesData = matchesRes.data?.data || [];
			matches = matchesData.map(m => {
				const attrs = m.attributes;
				return {
					round: attrs.round,
					identifier: attrs.identifier || '-',
					player1: participants[attrs.player1_id] || 'TBD',
					player2: participants[attrs.player2_id] || 'TBD',
					score: attrs.scores_csv || '-',
					winner: participants[attrs.winner_id] || '-'
				};
			}).sort((a, b) => a.round - b.round);
		}

		// Generate CSV
		const headers = ['Round', 'Match', 'Player 1', 'Player 2', 'Score', 'Winner'];
		const rows = matches.map(m => [
			m.round,
			`"${m.identifier}"`,
			`"${(m.player1 || '').replace(/"/g, '""')}"`,
			`"${(m.player2 || '').replace(/"/g, '""')}"`,
			`"${m.score}"`,
			`"${(m.winner || '').replace(/"/g, '""')}"`
		].join(','));

		const csv = [headers.join(','), ...rows].join('\n');
		const safeFilename = tournamentName.replace(/[^a-z0-9]/gi, '_').substring(0, 50);

		res.setHeader('Content-Type', 'text/csv');
		res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}_matches.csv"`);
		res.send(csv);
	} catch (error) {
		console.error('Error exporting matches:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Export tournament report as PDF
app.get('/api/export/:tournamentId/report/pdf', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { source } = req.query;

		let tournament, standings, matches;

		if (source === 'archive') {
			// Get from SQLite analytics database
			const data = analyticsDb.getTournamentById(parseInt(tournamentId));
			if (!data || !data.tournament) {
				return res.status(404).json({ success: false, error: 'Archived tournament not found' });
			}
			tournament = {
				name: data.tournament.name,
				game: data.tournament.game_name,
				type: data.tournament.tournament_type,
				participantCount: data.tournament.participant_count,
				completedAt: data.tournament.completed_at,
				startedAt: data.tournament.started_at
			};
			standings = data.standings.map(s => ({
				rank: s.final_rank,
				name: s.display_name || s.canonical_name,
				seed: s.seed
			}));
			matches = data.matches.filter(m => m.winner_name).map(m => ({
				round: m.round,
				player1: m.player1_name,
				player2: m.player2_name,
				score: m.scores_csv || `${m.player1_score || 0}-${m.player2_score || 0}`,
				winner: m.winner_name
			}));
		} else {
			// Get live from Challonge API
			const [tournamentRes, participantsRes, matchesRes] = await Promise.all([
				challongeV2Request('GET', `/tournaments/${tournamentId}.json`),
				challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json?page_size=256`),
				challongeV2Request('GET', `/tournaments/${tournamentId}/matches.json?page_size=256`)
			]);

			const tAttrs = tournamentRes.data?.data?.attributes || {};
			tournament = {
				name: tAttrs.name || 'Tournament',
				game: tAttrs.game_name || '',
				type: tAttrs.tournament_type || '',
				participantCount: tAttrs.participants_count || 0,
				completedAt: tAttrs.timestamps?.completed_at,
				startedAt: tAttrs.timestamps?.started_at
			};

			// Build participant lookup
			const participants = {};
			(participantsRes.data?.data || []).forEach(p => {
				participants[p.id] = {
					name: p.attributes.name || p.attributes.display_name,
					rank: p.attributes.final_rank,
					seed: p.attributes.seed
				};
			});

			standings = Object.values(participants)
				.filter(p => p.rank)
				.sort((a, b) => a.rank - b.rank)
				.map(p => ({ rank: p.rank, name: p.name, seed: p.seed }));

			const matchesData = matchesRes.data?.data || [];
			matches = matchesData
				.filter(m => m.attributes.winner_id)
				.map(m => {
					const attrs = m.attributes;
					return {
						round: attrs.round,
						player1: participants[attrs.player1_id]?.name || 'TBD',
						player2: participants[attrs.player2_id]?.name || 'TBD',
						score: attrs.scores_csv || '-',
						winner: participants[attrs.winner_id]?.name || '-'
					};
				})
				.sort((a, b) => a.round - b.round);
		}

		// Create PDF document
		const doc = new PDFDocument({ margin: 50, size: 'LETTER', autoFirstPage: true });

		const safeFilename = tournament.name.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
		res.setHeader('Content-Type', 'application/pdf');
		res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}_results.pdf"`);

		doc.pipe(res);

		// Page dimensions (LETTER: 612 x 792)
		const PAGE_HEIGHT = 792;
		const PAGE_BOTTOM = PAGE_HEIGHT - 60; // Leave room for footer

		// Helper: Check if we need a new page
		function needsNewPage(currentY, neededSpace = 100) {
			return currentY + neededSpace > PAGE_BOTTOM;
		}

		// Helper: Add new page and return starting y position
		function addNewPage() {
			doc.addPage();
			return 50; // Top margin
		}

		// === HEADER SECTION ===
		// Black header bar
		doc.rect(0, 0, 612, 100).fill(PDF_COLORS.primary);

		// Tournament name (white, centered)
		doc.fillColor(PDF_COLORS.secondary)
			.font('Helvetica-Bold').fontSize(22)
			.text(tournament.name, 50, 25, { width: 512, align: 'center' });

		// Game and format subtitle (positioned below title)
		const subtitle = `${tournament.game || ''}${tournament.type ? ` • ${tournament.type.replace(/_/g, ' ')}` : ''}`;
		if (subtitle.trim()) {
			doc.font('Helvetica').fontSize(11)
				.text(subtitle, 50, 80, { width: 512, align: 'center' });
		}

		// Red accent line
		doc.strokeColor(PDF_COLORS.accent).lineWidth(3)
			.moveTo(50, 95).lineTo(562, 95).stroke();

		// === STATS ROW ===
		let y = 115;
		doc.fillColor(PDF_COLORS.muted).font('Helvetica').fontSize(10);
		const statsText = [];
		if (tournament.participantCount) statsText.push(`Participants: ${tournament.participantCount}`);
		if (tournament.completedAt) {
			const date = new Date(tournament.completedAt).toLocaleDateString('en-US', {
				month: 'short', day: 'numeric', year: 'numeric'
			});
			statsText.push(`Completed: ${date}`);
		}
		if (statsText.length > 0) {
			doc.text(statsText.join('  •  '), 50, y, { width: 512, align: 'center' });
		}

		// === FINAL STANDINGS SECTION ===
		y = drawPdfSectionHeader(doc, 'FINAL STANDINGS', 145);

		// Top 3 with medal circles
		const top3 = standings.slice(0, 3);
		top3.forEach((s, i) => {
			const rank = i + 1;
			drawPdfMedal(doc, 70, y + 10, rank);
			doc.fillColor(PDF_COLORS.primary).font('Helvetica-Bold').fontSize(12)
				.text(s.name, 95, y + 3, { width: 350 });
			doc.fillColor(PDF_COLORS.muted).font('Helvetica').fontSize(10)
				.text(`Seed: ${s.seed || '-'}`, 450, y + 5, { width: 100, align: 'right' });
			y += 28;
		});

		// Divider line after top 3
		doc.strokeColor(PDF_COLORS.border).lineWidth(0.5)
			.moveTo(50, y + 5).lineTo(562, y + 5).stroke();
		y += 15;

		// Remaining standings (4-8 only to fit on page)
		const restStandings = standings.slice(3, 8);
		restStandings.forEach((s, i) => {
			drawPdfTableRow(doc, y, i % 2 === 1, 22);
			doc.fillColor(PDF_COLORS.primary).font('Helvetica').fontSize(10)
				.text(`${s.rank}.`, 60, y + 5, { width: 25 })
				.text(s.name, 95, y + 5, { width: 350 });
			doc.fillColor(PDF_COLORS.muted)
				.text(`Seed: ${s.seed || '-'}`, 450, y + 5, { width: 100, align: 'right' });
			y += 22;
		});

		// === NOTABLE MATCHES SECTION ===
		y += 20;

		// Check if we need a new page before Notable Matches
		if (needsNewPage(y, 150)) {
			y = addNewPage();
		}

		// Filter for notable matches (finals, semis, etc.) - limit to 5
		const notableMatches = matches.filter(m => {
			const absRound = Math.abs(m.round);
			return absRound >= Math.max(1, Math.floor(Math.log2(tournament.participantCount || 8)) - 1);
		}).slice(-5);

		if (notableMatches.length > 0) {
			y = drawPdfSectionHeader(doc, 'NOTABLE MATCHES', y);

			// Table header row (black background)
			doc.fillColor(PDF_COLORS.primary).rect(50, y, 510, 22).fill();
			doc.fillColor(PDF_COLORS.secondary).font('Helvetica-Bold').fontSize(9)
				.text('ROUND', 60, y + 6, { width: 60 })
				.text('MATCHUP', 130, y + 6, { width: 250 })
				.text('SCORE', 390, y + 6, { width: 60, align: 'center' })
				.text('WINNER', 460, y + 6, { width: 100 });
			y += 25;

			// Match rows with alternating backgrounds
			notableMatches.forEach((m, i) => {
				drawPdfTableRow(doc, y, i % 2 === 1, 20);
				const roundLabel = m.round > 0 ? `W${m.round}` : `L${Math.abs(m.round)}`;
				// Round label in red accent color
				doc.fillColor(PDF_COLORS.accent).font('Helvetica-Bold').fontSize(9)
					.text(roundLabel, 60, y + 5, { width: 60 });
				// Match details in primary color
				doc.fillColor(PDF_COLORS.primary).font('Helvetica').fontSize(9)
					.text(`${m.player1} vs ${m.player2}`, 130, y + 5, { width: 250 })
					.text(m.score || '-', 390, y + 5, { width: 60, align: 'center' })
					.text(m.winner, 460, y + 5, { width: 100 });
				y += 20;
			});
		}

		// === TOURNAMENT STATISTICS SECTION ===
		y += 25;

		// Check if we need a new page before Tournament Statistics
		if (needsNewPage(y, 120)) {
			y = addNewPage();
		}

		const matchStats = calculateMatchStats(matches);
		const duration = calculateDuration(tournament);

		y = drawPdfSectionHeader(doc, 'TOURNAMENT STATISTICS', y);

		// Stats grid (4 columns)
		const statsBoxWidth = 115;
		const statsBoxHeight = 45;
		const statsStartX = 55;
		const statsGap = 10;

		const stats = [
			{ label: 'Total Matches', value: matchStats.total.toString() },
			{ label: 'Completed', value: matchStats.completed.toString() },
			{ label: 'Forfeits/DQs', value: matchStats.forfeits.toString() },
			{ label: 'Duration', value: duration || 'N/A' }
		];

		stats.forEach((stat, i) => {
			const x = statsStartX + (i * (statsBoxWidth + statsGap));
			doc.fillColor(PDF_COLORS.rowAlt).rect(x, y, statsBoxWidth, statsBoxHeight).fill();
			doc.fillColor(PDF_COLORS.muted).fontSize(8).font('Helvetica')
				.text(stat.label, x, y + 8, { width: statsBoxWidth, align: 'center' });
			doc.fillColor(PDF_COLORS.primary).fontSize(16).font('Helvetica-Bold')
				.text(stat.value, x, y + 22, { width: statsBoxWidth, align: 'center' });
		});
		y += statsBoxHeight + 20;

		// === MATCH HIGHLIGHTS SECTION ===
		const upsets = findUpsets(matches, standings);
		const closeMatches = findCloseMatches(matches);

		if (upsets.length > 0 || closeMatches.length > 0) {
			// Check if we need a new page before Match Highlights
			if (needsNewPage(y, 120)) {
				y = addNewPage();
			}
			y = drawPdfSectionHeader(doc, 'MATCH HIGHLIGHTS', y);

			// Two-column layout
			const leftColX = 55;
			const rightColX = 310;
			let leftY = y;
			let rightY = y;

			// Left column: Upsets
			if (upsets.length > 0) {
				doc.fillColor(PDF_COLORS.accent).fontSize(10).font('Helvetica-Bold')
					.text('BIGGEST UPSETS', leftColX, leftY);
				leftY += 15;
				upsets.forEach(u => {
					doc.fillColor(PDF_COLORS.primary).fontSize(9).font('Helvetica')
						.text(`• Seed ${u.winnerSeed} beat Seed ${u.loserSeed} (${u.winner})`, leftColX, leftY);
					leftY += 12;
				});
			}

			// Right column: Close Matches
			if (closeMatches.length > 0) {
				doc.fillColor(PDF_COLORS.accent).fontSize(10).font('Helvetica-Bold')
					.text('CLOSEST MATCHES', rightColX, rightY);
				rightY += 15;
				closeMatches.forEach(m => {
					doc.fillColor(PDF_COLORS.primary).fontSize(9).font('Helvetica')
						.text(`• ${m.player1} vs ${m.player2} (${m.score})`, rightColX, rightY);
					rightY += 12;
				});
			}

			y = Math.max(leftY, rightY) + 15;
		}

		// === PLAYER ANALYTICS SECTION (archive only) ===
		if (source === 'archive') {
			const dbTournamentId = parseInt(tournamentId);
			const eloChanges = analyticsDb.getEloChangesForTournament(dbTournamentId);
			const attendance = analyticsDb.getNewVsReturningPlayers(dbTournamentId);

			if ((eloChanges && eloChanges.length > 0) || (attendance && attendance.total > 0)) {
				// Check if we need a new page before Player Analytics
				if (needsNewPage(y, 120)) {
					y = addNewPage();
				}
				y = drawPdfSectionHeader(doc, 'PLAYER ANALYTICS', y);

				const leftColX = 55;
				const rightColX = 310;
				let leftY = y;
				let rightY = y;

				// Left column: Elo Changes
				if (eloChanges && eloChanges.length > 0) {
					doc.fillColor(PDF_COLORS.accent).fontSize(10).font('Helvetica-Bold')
						.text('ELO CHANGES', leftColX, leftY);
					leftY += 15;

					// Top 3 gainers
					const gainers = eloChanges.filter(e => e.rating_change > 0).slice(0, 3);
					gainers.forEach(e => {
						doc.fillColor('#27AE60').fontSize(9).font('Helvetica') // Green for gains
							.text(`[+] ${e.display_name || e.canonical_name}: +${e.rating_change} (${e.rating_before} -> ${e.rating_after})`, leftColX, leftY);
						leftY += 12;
					});

					// Top 2 losers (biggest drops)
					const losers = eloChanges.filter(e => e.rating_change < 0).slice(-2).reverse();
					losers.forEach(e => {
						doc.fillColor(PDF_COLORS.accent).fontSize(9).font('Helvetica') // Red for losses
							.text(`[-] ${e.display_name || e.canonical_name}: ${e.rating_change} (${e.rating_before} -> ${e.rating_after})`, leftColX, leftY);
						leftY += 12;
					});
				}

				// Right column: Attendance
				if (attendance && attendance.total > 0) {
					doc.fillColor(PDF_COLORS.accent).fontSize(10).font('Helvetica-Bold')
						.text('ATTENDANCE', rightColX, rightY);
					rightY += 15;
					doc.fillColor(PDF_COLORS.primary).fontSize(9).font('Helvetica')
						.text(`New Players: ${attendance.new}`, rightColX, rightY);
					rightY += 12;
					doc.text(`Returning: ${attendance.returning}`, rightColX, rightY);
					rightY += 12;
					doc.text(`Return Rate: ${attendance.returnRate}%`, rightColX, rightY);
					rightY += 12;
				}

				y = Math.max(leftY, rightY) + 10;
			}
		}

		// === FOOTER ===
		// Place footer below content with spacing, or at page bottom if content is near bottom
		const footerY = Math.max(y + 30, PAGE_BOTTOM - 20);

		// Only add footer if it fits on current page, otherwise skip to avoid blank page
		if (footerY < PAGE_HEIGHT - 20) {
			doc.fillColor(PDF_COLORS.muted).font('Helvetica').fontSize(8)
				.text(
					`Generated by Tournament Dashboard • ${new Date().toLocaleDateString()}`,
					50,
					footerY,
					{ width: 512, align: 'center' }
				);
		}

		doc.end();
	} catch (error) {
		console.error('Error exporting PDF:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Start server with WebSocket support (only when run directly, not when imported for testing)
if (require.main === module) {
	httpServer.listen(PORT, '0.0.0.0', () => {
		console.log('========================================');
		console.log('Tournament Admin Dashboard');
		console.log('========================================');
		console.log(`Server running on port ${PORT}`);
		console.log(`WebSocket enabled on port ${PORT}`);
		console.log(`Access at: http://localhost:${PORT}`);
		console.log('Default credentials: admin / tournament2024');
		console.log('========================================');

		// Start adaptive rate limiter scheduler
		startAdaptiveRateScheduler();

		// Check if match polling should start (after scheduler initializes mode)
		setTimeout(() => {
			if (shouldPollMatches()) {
				console.log('[Match Polling] Mode is ACTIVE or dev mode enabled - starting match polling');
				startMatchPolling();
			} else {
				console.log('[Match Polling] Mode is not ACTIVE - match polling disabled');
			}
		}, 6000);  // After initial tournament check (5s delay + buffer)

		// Start sponsor rotation if enabled
		try {
			const sponsorState = loadSponsorState();
			if (sponsorState.config.enabled && sponsorState.config.rotationEnabled) {
				startSponsorRotation();
				console.log('[Sponsors] Auto-rotation started on server boot');
			} else if (sponsorState.config.enabled && sponsorState.config.timerViewEnabled) {
				startSponsorTimerView();
				console.log('[Sponsors] Timer view started on server boot');
			}
		} catch (err) {
			console.error('[Sponsors] Failed to start rotation on boot:', err.message);
		}

		// Initialize ticker scheduler
		try {
			tickerScheduler.initialize(broadcastTickerMessage);
			console.log('[Ticker Scheduler] Initialized');
		} catch (err) {
			console.error('[Ticker Scheduler] Failed to initialize:', err.message);
		}
	});
}

// Export for testing
module.exports = { app, httpServer, io };
