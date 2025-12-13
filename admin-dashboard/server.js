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
const sharp = require('sharp');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const webpush = require('web-push');
const secrets = require('./config/secrets');
const tickerScheduler = require('./services/ticker-scheduler');
const debugLogger = require('./services/debug-logger');

// Local database routes (TCC-Custom - no Challonge dependency)
const localRoutes = require('./routes');

// Local database services (TCC-Custom)
const participantDb = require('./services/participant-db');
const tournamentDb = require('./services/tournament-db');
const matchDb = require('./services/match-db');
const stationDb = require('./services/station-db');
const sponsorService = require('./services/sponsor');

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

// Database modules
const analyticsDb = require('./analytics-db');  // For player analytics & archiving
const systemDb = require('./db/system-db');     // For API tokens, OAuth, push subscriptions

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
	// Default allowed origins (production + local development + display services)
	return [
		'https://admin.despairhardware.com',
		'https://live.despairhardware.com',
		'http://localhost:3000',
		'http://127.0.0.1:3000',
		'http://localhost:3002',
		'http://127.0.0.1:3002',
		'http://192.168.1.28:3002',
		/^http:\/\/192\.168\.\d+\.\d+:\d+$/  // Allow local network IPs
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
	// Uses camelCase since matches come from transformed payload
	if (oldMatch.winnerId !== newMatch.winnerId) {
		return { type: 'WINNER_DECLARED', match: newMatch };
	}

	// Check for underway change
	if (oldMatch.underwayAt !== newMatch.underwayAt) {
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
	// Uses camelCase since payload contains transformed match data
	const matches = newPayload.matches || [];
	const tv1Match = matches.find(m => m.stationName === tv1Name && (m.state === 'open' || m.state === 'pending')) || null;
	const tv2Match = matches.find(m => m.stationName === tv2Name && (m.state === 'open' || m.state === 'pending')) || null;

	// Get up-next queue (matches without station, open state, sorted by play order)
	const upNextMatches = matches
		.filter(m => !m.stationName && m.state === 'open')
		.sort((a, b) => (a.suggestedPlayOrder || 9999) - (b.suggestedPlayOrder || 9999))
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

// Debug request logging middleware (activated via DEBUG_MODE=true)
app.use(debugLogger.requestLogger());

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
			styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],   // Needed for Tailwind CSS + Google Fonts
			imgSrc: ["'self'", "data:", "https:", "http:"],  // Allow data URIs and external images
			connectSrc: ["'self'", "wss:", "ws:", "https://cloudflareinsights.com", "https://static.cloudflareinsights.com", "https://cdn.socket.io", "https://cdn.tailwindcss.com"],  // WebSocket + Cloudflare + Socket.IO + Tailwind
			fontSrc: ["'self'", "https://fonts.gstatic.com"],  // Google Fonts
			frameSrc: ["https://challonge.com", "https://*.challonge.com"],  // Challonge iframe embed
			objectSrc: ["'none'"],
			// Disable upgrade-insecure-requests in development to allow HTTP
			upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
		}
	},
	crossOriginEmbedderPolicy: false,  // Allow Challonge iframe
	crossOriginResourcePolicy: { policy: "cross-origin" },  // Allow cross-origin resources
	// Disable HSTS in development to allow HTTP access
	hsts: process.env.NODE_ENV === 'production'
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

// Tenant Context (multi-tenant isolation)
const { attachTenantContext, allowViewAllTenants } = require('./middleware/tenant');
app.use(attachTenantContext);
app.use(allowViewAllTenants);

// Subscription Enforcement
const { checkMaintenanceMode, attachSubscriptionStatus, warnExpiringSubscription } = require('./middleware/subscription');
app.use(checkMaintenanceMode);
app.use(attachSubscriptionStatus);
app.use(warnExpiringSubscription);

// ============================================
// LOCAL DATABASE ROUTES (TCC-Custom)
// ============================================

// Helper function to read state files (needed by routes)
async function readStateFile(filePath) {
	try {
		const data = await fs.readFile(filePath, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		return null;
	}
}

// Initialize routes with dependencies
localRoutes.tournaments.init({ io });
localRoutes.matches.init({ io });
localRoutes.participants.init({ participantDb, tournamentDb, readStateFile, io });
localRoutes.stations.init({ io });
localRoutes.flyers.init({ axios, requireAuthAPI, logActivity, io });
localRoutes.sponsors.init({ axios, io, requireAuthAPI, sponsorService, logActivity });

// Mount local database routes (replaces Challonge API)
// Mount at both singular and plural paths for frontend compatibility
app.use('/api/tournaments', localRoutes.tournaments);
app.use('/api/tournament', localRoutes.tournaments);  // Singular alias for frontend
app.use('/api/matches', localRoutes.matches);
app.use('/api/participants', localRoutes.participants);
app.use('/api/stations', localRoutes.stations);
app.use('/api/flyers', localRoutes.flyers);
app.use('/api/sponsors', localRoutes.sponsors);

// Signup routes (public - no auth required)
app.use('/api/auth', localRoutes.signup);

// Platform/Admin routes (superadmin only - god mode)
app.use('/api/admin', localRoutes.platform);

// Station settings aliases for frontend compatibility
// Frontend calls /api/tournament/:id/station-settings but local routes use /api/stations/settings/:id
app.get('/api/tournament/:tournamentId/station-settings', requireAuthAPI, (req, res) => {
	const tournament = tournamentDb.getById(parseInt(req.params.tournamentId)) ||
		tournamentDb.getBySlug(req.params.tournamentId);
	if (!tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });
	const formatSettings = tournament.format_settings || {};
	res.json({
		success: true,
		stationSettings: {
			autoAssign: formatSettings.autoAssign || false,
			onlyStartWithStations: formatSettings.onlyStartWithStations || false
		}
	});
});
app.put('/api/tournament/:tournamentId/station-settings', requireAuthAPI, (req, res) => {
	const tournament = tournamentDb.getById(parseInt(req.params.tournamentId)) ||
		tournamentDb.getBySlug(req.params.tournamentId);
	if (!tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });
	const { autoAssign, onlyStartWithStations } = req.body;
	const currentSettings = tournament.format_settings || {};
	const newSettings = {
		...currentSettings,
		autoAssign: typeof autoAssign === 'boolean' ? autoAssign : currentSettings.autoAssign,
		onlyStartWithStations: typeof onlyStartWithStations === 'boolean' ? onlyStartWithStations : currentSettings.onlyStartWithStations
	};
	tournamentDb.update(tournament.id, { format_settings_json: newSettings });
	res.json({
		success: true,
		message: 'Station settings updated',
		stationSettings: { autoAssign: newSettings.autoAssign || false, onlyStartWithStations: newSettings.onlyStartWithStations || false }
	});
});

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

// ============================================
// TCC-CUSTOM: Local Mode Stubs
// (Challonge rate limiting removed - using local database)
// ============================================

// Stub: Always returns false since we use local database
function isChallongeConnected() {
	return false;
}

// Stub: No legacy API key needed for local mode
function getLegacyApiKey() {
	return null;
}

// Stub: Returns null since we use local database
function getChallongeApiKey() {
	return null;
}

// Stub: Rate limit status for dashboard (returns local mode info)
function getRateLimitStatus() {
	return {
		mode: 'local',
		description: 'Using local SQLite database - no rate limiting needed',
		adaptiveEnabled: false,
		currentMode: 'LOCAL',
		modeDescription: 'Local database mode',
		effectiveRate: 'unlimited',
		manualRateLimit: null,
		manualOverride: null,
		settings: null,
		devModeActive: false,
		matchPolling: {
			active: matchPollingState.isPolling,
			intervalMs: matchPollingState.pollIntervalMs,
			lastPollTime: matchPollingState.lastPollTime
		}
	};
}

// Stub: Dev mode functions (no-ops in local mode)
function isDevModeActive() { return false; }
function enableDevMode() { console.log('[Local Mode] Dev mode not applicable - using local database'); }
function disableDevMode() { console.log('[Local Mode] Dev mode not applicable - using local database'); }
function getDevModeRemainingMs() { return 0; }

// Stub: Rate limiter functions (no-ops in local mode)
function checkTournamentsAndUpdateMode() { return Promise.resolve(); }
function startAdaptiveRateScheduler() { console.log('[Local Mode] Rate limiting not needed - using local database'); }
function updateRateMode() {}

// Stub: State objects for backward compatibility with routes
const RATE_MODES = {
	IDLE: { name: 'LOCAL', description: 'Local database mode' },
	UPCOMING: { name: 'LOCAL', description: 'Local database mode' },
	ACTIVE: { name: 'LOCAL', description: 'Local database mode' }
};
const adaptiveRateState = {
	currentMode: { name: 'LOCAL', description: 'Local database mode' },
	effectiveRate: 'unlimited',
	manualOverride: null
};
const devModeState = {
	active: false,
	expiresAt: null
};

// Stub: Challonge API functions (throw errors in local mode - caught by try/catch)
async function challongeV2Request() {
	throw new Error('Challonge API not available - using local database mode');
}

async function getChallongeV2Headers() {
	throw new Error('Challonge API not available - using local database mode');
}

const rateLimitedAxios = {
	get: async () => { throw new Error('Challonge API not available - using local database mode'); },
	post: async () => { throw new Error('Challonge API not available - using local database mode'); },
	put: async () => { throw new Error('Challonge API not available - using local database mode'); },
	delete: async () => { throw new Error('Challonge API not available - using local database mode'); },
	patch: async () => { throw new Error('Challonge API not available - using local database mode'); }
};

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
function startServerDQTimer(tournamentId, matchId, tv, duration, playerId, playerName, userId = null) {
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
		userId,  // Store user who started the timer for multi-tenant broadcasts
		startTime: new Date(),
		expiresAt: new Date(Date.now() + duration * 1000),
		warningTimeoutId: null,
		timeoutId: null
	};

	// Set warning timeout (30 seconds before expiry)
	if (duration > warningThreshold) {
		timer.warningTimeoutId = setTimeout(() => {
			broadcastToUser('timer:dq:warning', {
				key,
				tv,
				matchId,
				playerName,
				secondsRemaining: warningThreshold
			}, timer.userId);
		}, (duration - warningThreshold) * 1000);
	}

	// Set expiry timeout
	timer.timeoutId = setTimeout(() => {
		handleDQTimerExpiry(key);
	}, duration * 1000);

	activeDQTimers.set(key, timer);

	// Broadcast timer started (multi-tenant)
	broadcastToUser('timer:dq:started', {
		key,
		tournamentId,
		matchId,
		tv,
		playerId,
		playerName,
		duration,
		startTime: timer.startTime.toISOString(),
		expiresAt: timer.expiresAt.toISOString()
	}, userId);

	console.log(`[DQ Timer] Started: ${key} (${playerName || 'unknown'}) - ${duration}s${userId ? ` for user:${userId}` : ''}`);
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
			broadcastToUser('timer:dq:error', { key, error: error.message }, timer.userId);
		}
	} else {
		// Just notify - no auto-DQ (multi-tenant)
		broadcastToUser('timer:dq:expired', {
			key,
			tv: timer.tv,
			matchId: timer.matchId,
			playerName: timer.playerName,
			action: 'notify'
		}, timer.userId);
	}

	// Clean up
	if (timer.warningTimeoutId) clearTimeout(timer.warningTimeoutId);
	activeDQTimers.delete(key);
}

// Perform auto-DQ on a player (uses local database)
async function performAutoDQ(timer) {
	const { tournamentId, matchId, playerId } = timer;

	// Get match details from local database
	const match = matchDb.getById(matchId);
	if (!match) {
		throw new Error(`Match ${matchId} not found in local database`);
	}

	const player1Id = match.player1_id;
	const player2Id = match.player2_id;

	if (!player1Id || !player2Id) {
		throw new Error('Could not determine player IDs');
	}

	// The winner is the player who is NOT being DQ'd
	const winnerId = String(playerId) === String(player1Id) ? player2Id : player1Id;
	const loserId = playerId;

	// Use local database to set winner (DQ/forfeit with 0-0 score)
	const result = matchDb.setWinner(matchId, winnerId, {
		player1_score: 0,
		player2_score: 0,
		forfeit: true
	});

	// Emit success event (multi-tenant)
	broadcastToUser('timer:dq:executed', {
		key: timer.key,
		tournamentId,
		matchId,
		winnerId,
		loserId,
		playerName: timer.playerName
	}, timer.userId);

	// Push updates via WebSocket
	await fetchAndPushMatches(tournamentId, timer.userId);

	console.log(`[DQ Timer] Auto-DQ executed for ${timer.playerName} in match ${matchId}${timer.userId ? ` for user:${timer.userId}` : ''}`);
}

// Cancel a DQ timer
function cancelDQTimer(key, userId = null) {
	const timer = activeDQTimers.get(key);
	if (timer) {
		if (timer.timeoutId) clearTimeout(timer.timeoutId);
		if (timer.warningTimeoutId) clearTimeout(timer.warningTimeoutId);
		activeDQTimers.delete(key);

		// Use the timer's stored userId or the provided userId
		const targetUserId = userId || timer.userId;
		broadcastToUser('timer:dq:cancelled', { key, tv: timer.tv }, targetUserId);
		console.log(`[DQ Timer] Cancelled: ${key}${targetUserId ? ` for user:${targetUserId}` : ''}`);
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
	// In local mode, always allow polling (no rate limiting needed)
	return true;
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
	// Uses camelCase since this receives the simplified/transformed matches array
	const openMatches = matches.filter(m =>
		m.state === 'open' &&
		!m.underwayAt &&
		m.player1Id &&
		m.player2Id
	);

	if (openMatches.length === 0) return null;

	// Sort by suggested play order
	openMatches.sort((a, b) =>
		(a.suggestedPlayOrder || 9999) - (b.suggestedPlayOrder || 9999)
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

// Fetch matches from local database and push to MagicMirror
async function fetchAndPushMatches(specificTournamentId = null) {
	// Get tournament info from state file or use provided ID
	let tournamentId = specificTournamentId;
	
	if (!tournamentId) {
		const stateFile = process.env.MATCH_STATE_FILE || '/root/tcc-custom/admin-dashboard/tournament-state.json';
		try {
			const data = fsSync.readFileSync(stateFile, 'utf8');
			const tournamentState = JSON.parse(data);
			tournamentId = tournamentState?.tournamentId;
		} catch (error) {
			console.error('[Match Polling] Error reading tournament state:', error.message);
			return;
		}
	}

	if (!tournamentId) {
		console.log('[Match Polling] No tournament configured - skipping');
		return;
	}

	try {
		console.log('[Match Polling] Fetching matches from local DB for tournament:', tournamentId);

		// Resolve tournament (can be ID or slug)
		const tournament = isNaN(tournamentId) 
			? tournamentDb.getBySlug(tournamentId)
			: tournamentDb.getById(parseInt(tournamentId));

		if (!tournament) {
			console.error('[Match Polling] Tournament not found:', tournamentId);
			return;
		}

		const dbTournamentId = tournament.id;

		// Fetch data from local database
		const matches = matchDb.getByTournament(dbTournamentId);
		const participants = participantDb.getByTournament(dbTournamentId);
		const stations = stationDb.getByTournament(dbTournamentId);

		// Build participant name lookup
		const participantsCache = {};
		participants.forEach(p => {
			participantsCache[String(p.id)] = p.name || p.display_name || `Seed ${p.seed}`;
		});

		// Build station maps
		const stationMap = {};
		const matchStationMap = {};
		stations.forEach(s => {
			stationMap[String(s.id)] = s.name;
			if (s.current_match_id) {
				matchStationMap[String(s.current_match_id)] = s.name;
			}
		});

		// Transform matches to camelCase (consistent with transformMatch in routes/matches.js)
		const simplified = matches.map(m => ({
			id: m.id,
			state: m.state,
			round: m.round,
			identifier: m.identifier,
			suggestedPlayOrder: m.suggested_play_order || 9999,
			player1Id: m.player1_id,
			player2Id: m.player2_id,
			player1Name: m.player1_name || participantsCache[String(m.player1_id)] || 'TBD',
			player2Name: m.player2_name || participantsCache[String(m.player2_id)] || 'TBD',
			stationId: m.station_id,
			stationName: m.station_name || matchStationMap[String(m.id)] || null,
			underwayAt: m.underway_at,
			winnerId: m.winner_id,
			winnerName: m.winner_name
		}));

		// Calculate tournament completion for podium
		let podium = { isComplete: false, first: null, second: null, third: null, has3rdPlace: false };
		const has3rdPlaceMatch = matches.some(m => m.identifier === '3P');
		podium.has3rdPlace = has3rdPlaceMatch;

		if (matches.length > 0 && matches.every(m => m.state === 'complete')) {
			// Find finals match (highest positive round that isn't 3P)
			const finalsMatch = matches
				.filter(m => m.round > 0 && m.identifier !== '3P')
				.sort((a, b) => b.round - a.round)[0];

			if (finalsMatch && finalsMatch.winner_id) {
				const loserId = finalsMatch.winner_id === finalsMatch.player1_id 
					? finalsMatch.player2_id 
					: finalsMatch.player1_id;
				
				podium.isComplete = true;
				podium.first = participantsCache[String(finalsMatch.winner_id)] || 'Unknown';
				podium.second = participantsCache[String(loserId)] || 'Unknown';
				
				// Find 3rd place match winner
				const thirdMatch = matches.find(m => m.identifier === '3P' && m.state === 'complete');
				if (thirdMatch && thirdMatch.winner_id) {
					podium.third = participantsCache[String(thirdMatch.winner_id)] || null;
				}
			}
		}

		// Calculate match statistics (using camelCase field names)
		const completedCount = simplified.filter(m => m.state === 'complete').length;
		const underwayCount = simplified.filter(m => m.state === 'underway' || (m.state === 'open' && m.underwayAt)).length;
		const openCount = simplified.filter(m => m.state === 'open' && !m.underwayAt).length;
		const totalCount = simplified.length;

		// Find next suggested match
		const nextMatch = findNextSuggestedMatch(simplified, Object.keys(matchStationMap));

		const pushTimestamp = new Date().toISOString();
		const payload = {
			tournamentId: tournament.url_slug || tournamentId,
			matches: simplified,
			podium: podium,
			availableStations: Object.values(stationMap),
			participantsCache: participantsCache,
			timestamp: pushTimestamp,
			source: 'local',
			metadata: {
				nextMatchId: nextMatch?.id || null,
				nextMatchPlayers: nextMatch ? {
					player1: nextMatch.player1Name,
					player2: nextMatch.player2Name
				} : null,
				completedCount,
				underwayCount,
				openCount,
				totalCount,
				progressPercent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
			}
		};

		// Compute hash for deduplication
		const payloadHash = require('crypto')
			.createHash('md5')
			.update(JSON.stringify({ matches: simplified, podium: podium }))
			.digest('hex');

		// Save to cache
		saveMatchDataCache(dbTournamentId, payload);

		// Check WebSocket connections
		const displayCount = wsConnections.displays.size;
		const hasConnectedDisplays = displayCount > 0;

		// Broadcast via WebSocket
		broadcastMatchData(payload, payloadHash);

		// HTTP fallback if no WebSocket displays
		const shouldHttpFallback = !hasConnectedDisplays || needsHttpFallback();
		if (shouldHttpFallback) {
			const matchApiUrl = process.env.MATCH_API_URL || 'http://localhost:2052';
			try {
				await axios.post(`${matchApiUrl}/api/matches/push`, payload, { timeout: 5000 });
				console.log(`[Match Polling] HTTP fallback push`);
			} catch (httpError) {
				console.warn(`[Match Polling] HTTP fallback failed: ${httpError.message}`);
			}
		}

		matchPollingState.lastPollTime = pushTimestamp;
		console.log(`[Match Polling] Pushed ${simplified.length} matches from local DB (WS: ${displayCount} displays)`);

	} catch (error) {
		console.error('[Match Polling] Error:', error.message);
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

// Check if user is superadmin (admin with userId 1, or configured superadmin)
function isSuperadmin(req) {
	if (!req.session || !req.session.userId) return false;
	// Legacy support: admin with userId 1 is superadmin
	return req.session.role === 'admin' && req.session.userId === 1;
}

// API Token OR Session auth middleware (for device access like Stream Deck)
// Checks X-API-Token header first, falls back to session auth
function requireTokenOrSessionAuth(req, res, next) {
	// Check for API token first
	const apiToken = req.headers['x-api-token'];
	if (apiToken) {
		const tokenRecord = systemDb.verifyApiToken(apiToken);
		if (tokenRecord && tokenRecord.isActive) {
			systemDb.updateTokenLastUsed(tokenRecord.id);
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

// Note: Flyer preview routes are now handled by routes/flyers.js with multi-tenant support
// Legacy single-tenant route removed - see routes/flyers.js for /preview/:userId/:filename

// Login page and static files (no auth required)
app.use(express.static('public'));

// ============================================
// WEBSOCKET (SOCKET.IO) HANDLERS
// ============================================

// Socket.IO connection handler
io.on('connection', (socket) => {
	console.log(`[WebSocket] New connection: ${socket.id} from origin: ${socket.handshake.headers.origin || 'unknown'}`);

	// Debug: Log all incoming events (temporarily for debugging)
	socket.onAny((eventName, ...args) => {
		if (!['matches:ack'].includes(eventName)) {  // Skip noisy events
			console.log(`[WebSocket] Event from ${socket.id}: ${eventName}`, args.length > 0 ? JSON.stringify(args[0]).substring(0, 100) : '');
		}
	});

	// Handle display registration (MagicMirror modules and web displays)
	socket.on('display:register', (data) => {
		const { displayType, displayId, userId } = data;
		console.log(`[WebSocket] Display registered: ${displayType} (${displayId})${userId ? ` for user:${userId}` : ''}`);

		// Store display connection
		socket.displayType = displayType;
		socket.displayId = displayId;
		socket.userId = userId || null;
		wsConnections.displays.set(displayId, socket);

		// Join user-specific rooms for multi-tenant isolation
		if (userId) {
			socket.join(`user:${userId}`);
			socket.join(`user:${userId}:${displayType}`);
			console.log(`[WebSocket] Display joined rooms: user:${userId}, user:${userId}:${displayType}`);
		}

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
			userId: userId || null,
			rooms: userId ? [`user:${userId}`, `user:${userId}:${displayType}`] : [],
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

// Broadcast match data to a specific user's displays only (multi-tenant isolation)
function broadcastMatchDataToUser(userId, payload, updateHash = null, deltaInfo = null) {
	const timestamp = new Date().toISOString();

	// Build delta payload if available
	const delta = deltaInfo || buildDeltaPayload(previousMatchState, payload, payload.availableStations);

	const data = {
		...payload,
		timestamp,
		source: 'live',
		updateHash: updateHash,
		updateType: delta.type,
		changes: delta.changes
	};

	if (userId) {
		// Targeted broadcast to user's displays only
		io.to(`user:${userId}`).emit('matches:update', data);
		console.log(`[WebSocket] User-targeted broadcast to user:${userId} (hash: ${updateHash ? updateHash.substring(0, 8) + '...' : 'none'})`);
	} else {
		// Fallback: broadcast to all (for legacy Pi displays without userId)
		io.emit('matches:update', data);
		console.log(`[WebSocket] Legacy broadcast to all displays (hash: ${updateHash ? updateHash.substring(0, 8) + '...' : 'none'})`);
	}
}

// Broadcast ticker message to user's displays (multi-tenant)
function broadcastTickerMessage(message, duration, userId = null) {
	const payload = {
		message,
		duration,
		timestamp: new Date().toISOString()
	};

	if (userId) {
		// Targeted broadcast to user's displays only
		io.to(`user:${userId}`).emit('ticker:message', payload);
		console.log(`[WebSocket] User-targeted ticker to user:${userId}: "${message}" (${duration}s)`);
	} else {
		// Fallback to global broadcast (for scheduled tickers without user context)
		io.emit('ticker:message', payload);
		console.log(`[WebSocket] Global ticker broadcast: "${message}" (${duration}s)`);
	}
}

// Generic multi-tenant broadcast helper
function broadcastToUser(event, payload, userId = null) {
	if (userId) {
		io.to(`user:${userId}`).emit(event, payload);
		console.log(`[WebSocket] User-targeted ${event} to user:${userId}`);
	} else {
		io.emit(event, payload);
		console.log(`[WebSocket] Global ${event} broadcast`);
	}
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
		isSuperadmin: isSuperadmin(req),
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

		const result = systemDb.createApiToken(
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
		const tokens = systemDb.listApiTokens();
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
		const token = systemDb.getApiToken(tokenId);
		if (!token) {
			return res.status(404).json({
				success: false,
				error: 'Token not found'
			});
		}

		const revoked = systemDb.revokeApiToken(tokenId);
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

	const tokenRecord = systemDb.verifyApiToken(apiToken);
	if (tokenRecord && tokenRecord.isActive) {
		systemDb.updateTokenLastUsed(tokenRecord.id);
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
		systemDb.saveOAuthTokens({
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
		const status = systemDb.getOAuthStatus();
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
		const tokens = systemDb.getOAuthTokens();

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
		systemDb.deleteOAuthTokens();

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
		const tokens = systemDb.getOAuthTokens();

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
		systemDb.saveOAuthTokens({
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
			systemDb.deleteOAuthTokens();
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
	const tokens = systemDb.getOAuthTokens();

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
			systemDb.saveOAuthTokens({
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
			systemDb.deleteOAuthTokens();
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
// Note: /api/flyers handles auth internally (preview routes are public)
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
		systemDb.updateSubscriptionLastUsed(subscription.endpoint);
		return { success: true };
	} catch (error) {
		console.error('[Push] Error sending notification:', error.message);
		// Remove invalid subscriptions (410 Gone or 404 Not Found)
		if (error.statusCode === 410 || error.statusCode === 404) {
			systemDb.deletePushSubscription(subscription.endpoint);
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

	const subscriptions = systemDb.getAllPushSubscriptions();
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
		systemDb.savePushSubscription(req.session.userId, subscription, userAgent);

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
			systemDb.deletePushSubscription(endpoint);
		} else {
			systemDb.deleteUserPushSubscriptions(req.session.userId);
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
		const preferences = systemDb.getNotificationPreferences(req.session.userId);
		const subscriptions = systemDb.getPushSubscriptionsByUser(req.session.userId);

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
		systemDb.saveNotificationPreferences(req.session.userId, preferences);

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
		const subscriptions = systemDb.getPushSubscriptionsByUser(req.session.userId);

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
	const stateFile = process.env.MATCH_STATE_FILE || '/root/tcc-custom/admin-dashboard/tournament-state.json';
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

// Setup tournament on both modules (tcc-custom: uses local database)
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

	try {
		// Get tournament from local database
		const tournament = tournamentDb.getBySlug(tournamentId) || tournamentDb.getById(tournamentId);
		if (!tournament) {
			return res.status(404).json({
				success: false,
				error: 'Tournament not found in local database'
			});
		}

		// Build bracket URL for native rendering (tcc-custom uses local bracket display)
		const displaySettings = getDisplaySettings();
		const bracketUrl = `${process.env.BRACKET_API_URL || 'http://localhost:2053'}/bracket/${tournamentId}`;

		// Send to match and bracket modules (flyer is managed separately via Flyers page)
		const results = { match: null, bracket: null };
		const errors = [];

		// Try match module
		try {
			const matchResponse = await axios.post(`${process.env.MATCH_API_URL}/api/tournament/update`, {
				apiKey: 'local-tcc-custom',  // Placeholder for local DB mode
				tournamentId: tournamentId,
				tournamentName: tournament.name,
				gameName: tournament.game_name,
				registrationWindowHours: regWindow,
				signupCap: cap
			}, { timeout: 5000 });
			results.match = matchResponse.data;
		} catch (matchErr) {
			console.error('Match module setup error:', matchErr.message);
			errors.push(`Match module: ${matchErr.message}`);
		}

		// Try bracket module
		try {
			const bracketResponse = await axios.post(`${process.env.BRACKET_API_URL}/api/bracket/update`, {
				tournamentId: tournamentId,
				bracketUrl: bracketUrl
			}, { timeout: 5000 });
			results.bracket = bracketResponse.data;
		} catch (bracketErr) {
			console.error('Bracket module setup error:', bracketErr.message);
			errors.push(`Bracket module: ${bracketErr.message}`);
		}

		// Broadcast tournament deployed event so dashboard updates immediately
		if (io) {
			io.emit('tournament:deployed', {
				tournamentId: tournamentId,
				tournament: {
					id: tournamentId,
					name: tournament.name,
					bracketUrl: bracketUrl
				}
			});
		}

		// Write state file directly for deployment checklist verification
		// This ensures the pre-flight checklist shows "Deployed" even if modules are offline
		// Note: tournamentId must be the URL slug to match frontend expectations
		try {
			const stateFilePath = process.env.MATCH_STATE_FILE || '/root/tcc-custom/admin-dashboard/tournament-state.json';
			const stateDir = require('path').dirname(stateFilePath);

			// Ensure directory exists
			await require('fs').promises.mkdir(stateDir, { recursive: true });

			// Write state file - tournamentId should be the URL slug (as frontend expects)
			// tournamentId parameter could be numeric ID or slug, so use tournament.url_slug
			await require('fs').promises.writeFile(stateFilePath, JSON.stringify({
				tournamentId: tournament.url_slug,
				tournamentDbId: tournament.id,
				tournamentName: tournament.name,
				gameName: tournament.game_name,
				bracketUrl: bracketUrl,
				deployedAt: new Date().toISOString(),
				lastUpdated: new Date().toISOString()
			}, null, 2));

			console.log(`[Tournament Setup] State file written to ${stateFilePath}`);
		} catch (stateErr) {
			console.error('[Tournament Setup] Failed to write state file:', stateErr.message);
			errors.push(`State file: ${stateErr.message}`);
		}

		// Return success even if some modules failed (they might be offline)
		res.json({
			success: true,
			message: errors.length > 0
				? `Tournament configured with warnings: ${errors.join('; ')}`
				: 'Tournament configured successfully on display modules',
			results: results,
			tournament: {
				id: tournamentId,
				name: tournament.name,
				bracketUrl: bracketUrl
			},
			warnings: errors.length > 0 ? errors : undefined
		});
	} catch (error) {
		console.error('Tournament setup error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to configure tournament',
			details: error.message
		});
	}
});

// Update flyer display only (without reconfiguring tournament)
// Updated for standalone flyer-display service - uses WebSocket only, no HTTP proxy
app.post('/api/flyer/update', async (req, res) => {
	const { flyer } = req.body;
	const userId = req.session?.userId;

	// Validation
	if (!flyer) {
		return res.status(400).json({
			success: false,
			error: 'Flyer filename is required'
		});
	}

	try {
		// Broadcast to user-specific flyer room (WebSocket only, no HTTP to port 2054)
		if (io && userId) {
			io.to(`user:${userId}:flyer`).emit('flyer:activated', {
				flyer,
				userId,
				timestamp: new Date().toISOString()
			});
			console.log(`[Flyer] Broadcast to user:${userId}:flyer - ${flyer}`);
		}

		// General broadcast for admin dashboard updates
		io.emit('flyer:activated', { flyer, userId });

		// Log activity
		if (typeof logActivity === 'function') {
			logActivity('flyer_set_active', req.session?.username || 'system', {
				flyer: flyer,
				userId: userId
			});
		}

		res.json({
			success: true,
			message: 'Flyer display updated successfully',
			flyer: flyer,
			userId: userId
		});
	} catch (error) {
		console.error('Flyer update error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to update flyer display',
			details: error.message
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
	const userId = req.session?.userId;

	// Broadcast via WebSocket (real-time) - multi-tenant
	broadcastTickerMessage(trimmedMessage, tickerDuration, userId);

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
		const userId = req.session?.userId;

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

		// Broadcast via WebSocket (multi-tenant)
		broadcastToUser('audio:announce', payload, userId);
		console.log(`[Audio] Announcement broadcast via WebSocket: "${announcementText.substring(0, 50)}..."${userId ? ` (user:${userId})` : ''}`);

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
	const userId = req.session?.userId;

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

	console.log(`[Timer] Starting DQ timer for ${tv}: ${timerDuration} seconds${userId ? ` (user:${userId})` : ''}`);

	// If enhanced params provided, use server-side timer management
	if (tournamentId && matchId) {
		startServerDQTimer(tournamentId, matchId, tv, timerDuration, playerId, playerName, userId);
	}

	// Broadcast via WebSocket (multi-tenant)
	broadcastToUser('timer:dq', {
		tv: tv,
		duration: timerDuration,
		action: 'start',
		matchId: matchId || null,
		playerName: playerName || null,
		timestamp: new Date().toISOString()
	}, userId);

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
	const userId = req.session?.userId;

	// URL decode the key (it may contain colons)
	const decodedKey = decodeURIComponent(key);

	if (cancelDQTimer(decodedKey, userId)) {
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
	const userId = req.session?.userId;

	// Validate duration
	const timerDuration = parseInt(duration, 10);
	if (!timerDuration || timerDuration < 10 || timerDuration > 3600) {
		return res.status(400).json({
			success: false,
			error: 'Duration must be between 10 and 3600 seconds (1 hour max)'
		});
	}

	console.log(`[Timer] Starting tournament timer: ${timerDuration} seconds${userId ? ` (user:${userId})` : ''}`);

	// Broadcast via WebSocket (multi-tenant)
	broadcastToUser('timer:tournament', {
		duration: timerDuration,
		action: 'start',
		timestamp: new Date().toISOString()
	}, userId);

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
	const userId = req.session?.userId;

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

	console.log(`[Timer] Hiding timer: type=${type}, tv=${tv || 'N/A'}${userId ? ` (user:${userId})` : ''}`);

	// Broadcast via WebSocket (multi-tenant)
	broadcastToUser('timer:hide', {
		type: type,
		tv: tv || null,
		timestamp: new Date().toISOString()
	}, userId);

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
	const userId = req.session?.userId;

	// Broadcast via WebSocket (multi-tenant)
	const qrPayload = {
		qrCode: qrDataUrl,
		url: url,
		label: label || 'Scan to Join',
		duration: qrDuration,
		timestamp: new Date().toISOString()
	};

	if (userId) {
		io.to(`user:${userId}`).emit('qr:show', qrPayload);
		console.log(`[WebSocket] User-targeted QR show to user:${userId}`);
	} else {
		io.emit('qr:show', qrPayload);
		console.log(`[WebSocket] Global QR show broadcast`);
	}

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
	const userId = req.session?.userId;

	// Broadcast via WebSocket (multi-tenant)
	const hidePayload = { timestamp: new Date().toISOString() };

	if (userId) {
		io.to(`user:${userId}`).emit('qr:hide', hidePayload);
		console.log(`[WebSocket] User-targeted QR hide to user:${userId}`);
	} else {
		io.emit('qr:hide', hidePayload);
		console.log(`[WebSocket] Global QR hide broadcast`);
	}

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

// Note: GET /api/flyers is now handled by routes/flyers.js with multi-tenant support

// Note: Flyer preview is handled by routes/flyers.js

// Image optimization constants
const IMAGE_MAX_WIDTH = 1920;
const IMAGE_MAX_HEIGHT = 1080;
const JPEG_QUALITY = 85;
const PNG_COMPRESSION = 9;

/**
 * Optimize image by resizing and compressing
 */
async function optimizeImage(inputPath, outputPath) {
	const inputStats = await fs.stat(inputPath);
	const metadata = await sharp(inputPath).metadata();

	const needsResize = metadata.width > IMAGE_MAX_WIDTH || metadata.height > IMAGE_MAX_HEIGHT;

	let pipeline = sharp(inputPath).rotate(); // Auto-orient based on EXIF

	if (needsResize) {
		pipeline = pipeline.resize(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, {
			fit: 'inside',
			withoutEnlargement: true
		});
	}

	// Apply format-specific optimization
	if (outputPath.match(/\.jpe?g$/i)) {
		pipeline = pipeline.jpeg({ quality: JPEG_QUALITY });
	} else if (outputPath.match(/\.png$/i)) {
		pipeline = pipeline.png({ compressionLevel: PNG_COMPRESSION });
	}

	await pipeline.toFile(outputPath);

	const outputStats = await fs.stat(outputPath);

	return {
		originalDimensions: `${metadata.width}x${metadata.height}`,
		optimized: needsResize,
		originalSize: inputStats.size,
		newSize: outputStats.size
	};
}

// Note: POST /api/flyers/upload is now handled by routes/flyers.js with multi-tenant support

// Note: DELETE /api/flyers/:filename is now handled by routes/flyers.js with multi-tenant support

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
		const userId = req.session?.userId;
		const state = loadSponsorState();

		// Store userId for background sponsor processes (rotation, timer view)
		if (userId) {
			state.activeUserId = userId;
			saveSponsorState(state);
		}

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
// Sponsor Impression Tracking API Endpoints
// ============================================

// POST /api/sponsors/impressions/record - Record impression from display (no auth for displays)
app.post('/api/sponsors/impressions/record', async (req, res) => {
	try {
		const {
			sponsorId,
			displayId,
			displayType,
			tournamentId,
			position,
			displayStart,
			displayEnd,
			durationSeconds,
			viewerEstimate
		} = req.body;

		if (!sponsorId) {
			return res.status(400).json({ success: false, error: 'sponsorId is required' });
		}

		const impressionId = systemDb.recordSponsorImpression({
			sponsorId,
			displayId,
			displayType,
			tournamentId,
			position,
			displayStart,
			displayEnd,
			durationSeconds: durationSeconds || 0,
			viewerEstimate: viewerEstimate || 0
		});

		console.log(`[Sponsors] Impression recorded: ${sponsorId}, duration: ${durationSeconds}s`);

		res.json({
			success: true,
			impressionId,
			message: 'Impression recorded'
		});
	} catch (error) {
		console.error('[Sponsors] Impression record error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// POST /api/sponsors/impressions/start - Start tracking an impression
app.post('/api/sponsors/impressions/start', async (req, res) => {
	try {
		const { sponsorId, displayId, displayType, tournamentId, position, viewerEstimate } = req.body;

		if (!sponsorId) {
			return res.status(400).json({ success: false, error: 'sponsorId is required' });
		}

		const impressionId = systemDb.startSponsorImpression({
			sponsorId,
			displayId,
			displayType,
			tournamentId,
			position,
			viewerEstimate
		});

		res.json({
			success: true,
			impressionId
		});
	} catch (error) {
		console.error('[Sponsors] Impression start error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// POST /api/sponsors/impressions/:id/end - End tracking an impression
app.post('/api/sponsors/impressions/:id/end', async (req, res) => {
	try {
		const impressionId = parseInt(req.params.id);

		systemDb.endSponsorImpression(impressionId);

		res.json({
			success: true,
			message: 'Impression ended'
		});
	} catch (error) {
		console.error('[Sponsors] Impression end error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// GET /api/sponsors/impressions/overview - Get impression stats for all sponsors
app.get('/api/sponsors/impressions/overview', requireAuthAPI, async (req, res) => {
	try {
		const { startDate, endDate } = req.query;

		const stats = systemDb.getAllSponsorImpressionStats({
			startDate,
			endDate
		});

		// Calculate totals
		const totals = stats.reduce((acc, s) => ({
			totalImpressions: acc.totalImpressions + (s.total_impressions || 0),
			totalDuration: acc.totalDuration + (s.total_duration_seconds || 0),
			totalViewerMinutes: acc.totalViewerMinutes + (s.total_viewer_minutes || 0)
		}), { totalImpressions: 0, totalDuration: 0, totalViewerMinutes: 0 });

		res.json({
			success: true,
			sponsors: stats,
			totals: {
				totalImpressions: totals.totalImpressions,
				totalDurationSeconds: totals.totalDuration,
				totalDurationFormatted: formatDurationSeconds(totals.totalDuration),
				totalViewerMinutes: totals.totalViewerMinutes
			},
			dateRange: { startDate, endDate }
		});
	} catch (error) {
		console.error('[Sponsors] Impressions overview error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// GET /api/sponsors/:id/impressions - Get impression stats for a single sponsor
app.get('/api/sponsors/:id/impressions', requireAuthAPI, async (req, res) => {
	try {
		const sponsorId = req.params.id;
		const { startDate, endDate, limit } = req.query;

		// Get daily stats
		const dailyStats = systemDb.getSponsorImpressionStats(sponsorId, {
			startDate,
			endDate,
			limit: parseInt(limit) || 30
		});

		// Get all-time totals
		const totals = systemDb.getSponsorImpressionTotals(sponsorId);

		res.json({
			success: true,
			sponsorId,
			dailyStats,
			totals: {
				...totals,
				totalDurationFormatted: formatDurationSeconds(totals.total_duration_seconds || 0)
			},
			dateRange: { startDate, endDate }
		});
	} catch (error) {
		console.error('[Sponsors] Sponsor impressions error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// GET /api/sponsors/:id/impressions/raw - Get raw impression records
app.get('/api/sponsors/:id/impressions/raw', requireAuthAPI, async (req, res) => {
	try {
		const sponsorId = req.params.id;
		const { startDate, endDate, limit, offset } = req.query;

		const impressions = systemDb.getSponsorImpressions(sponsorId, {
			startDate,
			endDate,
			limit: parseInt(limit) || 100,
			offset: parseInt(offset) || 0
		});

		res.json({
			success: true,
			sponsorId,
			impressions,
			pagination: {
				limit: parseInt(limit) || 100,
				offset: parseInt(offset) || 0,
				count: impressions.length
			}
		});
	} catch (error) {
		console.error('[Sponsors] Raw impressions error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// POST /api/sponsors/impressions/cleanup - Clean up old impressions
app.post('/api/sponsors/impressions/cleanup', requireAuthAPI, async (req, res) => {
	try {
		const { daysToKeep } = req.body;
		const deleted = systemDb.cleanupOldImpressions(daysToKeep || 90);

		console.log(`[Sponsors] Cleaned up ${deleted} old impression records`);

		res.json({
			success: true,
			deleted,
			message: `Deleted ${deleted} old impression records`
		});
	} catch (error) {
		console.error('[Sponsors] Impressions cleanup error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Helper function to format duration
function formatDurationSeconds(seconds) {
	if (!seconds || seconds === 0) return '0s';

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	const parts = [];
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

	return parts.join(' ');
}

// ============================================
// Sponsor QR Code Overlay API Endpoints
// ============================================

// PUT /api/sponsors/:id/qr - Update sponsor QR code URL
app.put('/api/sponsors/:id/qr', requireAuthAPI, async (req, res) => {
	try {
		const sponsorId = req.params.id;
		const { qrUrl } = req.body;

		// Update the sponsor's qr_url in the database
		systemDb.getDb().prepare(`
			UPDATE sponsors SET qr_url = ? WHERE id = ?
		`).run(qrUrl || null, sponsorId);

		console.log(`[Sponsors] QR URL updated for ${sponsorId}: ${qrUrl || '(cleared)'}`);

		res.json({
			success: true,
			message: 'QR URL updated',
			sponsorId,
			qrUrl
		});
	} catch (error) {
		console.error('[Sponsors] QR URL update error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// POST /api/sponsors/:id/show-with-qr - Show sponsor with QR code overlay
app.post('/api/sponsors/:id/show-with-qr', requireAuthAPI, async (req, res) => {
	try {
		const sponsorId = req.params.id;
		const { duration, qrLabel, viewerEstimate } = req.body;

		// Get sponsor from database
		const sponsor = systemDb.getDb().prepare('SELECT * FROM sponsors WHERE id = ?').get(sponsorId);
		if (!sponsor) {
			return res.status(404).json({ success: false, error: 'Sponsor not found' });
		}

		// Get QR URL from sponsor or request body
		const qrUrl = req.body.qrUrl || sponsor.qr_url;
		if (!qrUrl) {
			return res.status(400).json({ success: false, error: 'No QR URL configured for this sponsor' });
		}

		// Generate QR code
		const QRCode = require('qrcode');
		const qrSize = 200;
		const qrDataUrl = await QRCode.toDataURL(qrUrl, {
			width: qrSize,
			margin: 1,
			color: {
				dark: '#000000',
				light: '#ffffff'
			}
		});

		// Build sponsor data for display
		const sponsorData = {
			id: sponsor.id,
			name: sponsor.name,
			filename: sponsor.filename,
			position: sponsor.position,
			type: sponsor.type,
			size: sponsor.size,
			opacity: sponsor.opacity,
			offsetX: sponsor.offset_x || 0,
			offsetY: sponsor.offset_y || 0,
			qrCode: qrDataUrl,
			qrUrl: qrUrl,
			qrLabel: qrLabel || 'Scan for offer'
		};

		const qrDuration = duration ? Math.min(Math.max(duration, 10), 3600) : 0;

		// Broadcast via WebSocket
		io.emit('sponsor:show-with-qr', {
			sponsor: sponsorData,
			duration: qrDuration,
			timestamp: new Date().toISOString()
		});

		// Also send via HTTP to MagicMirror modules
		const state = sponsorService.loadSponsorState();
		const matchEnabled = state.config.displays?.match !== false;
		const bracketEnabled = state.config.displays?.bracket !== false;

		if (matchEnabled && process.env.SPONSOR_MATCH_API_URL) {
			try {
				await axios.post(`${process.env.SPONSOR_MATCH_API_URL}/api/sponsor/show-with-qr`, {
					sponsor: sponsorData,
					duration: qrDuration
				}, { timeout: 5000 });
			} catch (httpError) {
				console.warn(`[Sponsors] HTTP QR push to match failed: ${httpError.message}`);
			}
		}

		if (bracketEnabled && process.env.SPONSOR_BRACKET_API_URL) {
			try {
				await axios.post(`${process.env.SPONSOR_BRACKET_API_URL}/api/sponsor/show-with-qr`, {
					sponsor: sponsorData,
					duration: qrDuration
				}, { timeout: 5000 });
			} catch (httpError) {
				console.warn(`[Sponsors] HTTP QR push to bracket failed: ${httpError.message}`);
			}
		}

		// Record impression with QR flag
		try {
			systemDb.recordSponsorImpression({
				sponsorId: sponsor.id,
				displayType: 'match', // Could be enhanced to track which display
				position: sponsor.position,
				durationSeconds: qrDuration || 30,
				viewerEstimate: viewerEstimate || 0
			});
		} catch (impError) {
			console.warn('[Sponsors] Failed to record QR impression:', impError.message);
		}

		console.log(`[Sponsors] Showing ${sponsor.name} with QR code for ${qrDuration || 'unlimited'}s`);

		res.json({
			success: true,
			message: `Showing ${sponsor.name} with QR code`,
			sponsor: sponsorData,
			duration: qrDuration
		});
	} catch (error) {
		console.error('[Sponsors] Show with QR error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// GET /api/sponsors/:id/qr - Get sponsor's QR code URL and preview
app.get('/api/sponsors/:id/qr', requireAuthAPI, async (req, res) => {
	try {
		const sponsorId = req.params.id;

		const sponsor = systemDb.getDb().prepare('SELECT id, name, qr_url FROM sponsors WHERE id = ?').get(sponsorId);
		if (!sponsor) {
			return res.status(404).json({ success: false, error: 'Sponsor not found' });
		}

		let qrPreview = null;
		if (sponsor.qr_url) {
			const QRCode = require('qrcode');
			qrPreview = await QRCode.toDataURL(sponsor.qr_url, {
				width: 150,
				margin: 1
			});
		}

		res.json({
			success: true,
			sponsorId: sponsor.id,
			sponsorName: sponsor.name,
			qrUrl: sponsor.qr_url,
			qrPreview
		});
	} catch (error) {
		console.error('[Sponsors] Get QR error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// ============================================
// Sponsor Report Generation API Endpoints
// ============================================

// GET /api/sponsors/report/json - Get sponsor report as JSON
app.get('/api/sponsors/report/json', requireAuthAPI, async (req, res) => {
	try {
		const { sponsorId, startDate, endDate } = req.query;

		let sponsors = [];
		if (sponsorId) {
			const sponsor = systemDb.getDb().prepare('SELECT * FROM sponsors WHERE id = ?').get(sponsorId);
			if (!sponsor) {
				return res.status(404).json({ success: false, error: 'Sponsor not found' });
			}
			sponsors = [sponsor];
		} else {
			sponsors = systemDb.getDb().prepare('SELECT * FROM sponsors').all();
		}

		// Build report data for each sponsor
		const reportData = sponsors.map(sponsor => {
			const totals = systemDb.getSponsorImpressionTotals(sponsor.id);
			const dailyStats = systemDb.getSponsorImpressionStats(sponsor.id, {
				startDate,
				endDate,
				limit: 90
			});

			return {
				sponsor: {
					id: sponsor.id,
					name: sponsor.name,
					position: sponsor.position,
					type: sponsor.type,
					active: Boolean(sponsor.active)
				},
				totals: {
					totalImpressions: totals.total_impressions || 0,
					totalDurationSeconds: totals.total_duration_seconds || 0,
					totalDurationFormatted: formatDurationSeconds(totals.total_duration_seconds || 0),
					totalViewerMinutes: totals.total_viewer_minutes || 0,
					matchImpressions: totals.match_impressions || 0,
					bracketImpressions: totals.bracket_impressions || 0,
					uniqueTournaments: totals.unique_tournaments || 0,
					firstImpression: totals.first_impression,
					lastImpression: totals.last_impression
				},
				dailyBreakdown: dailyStats.map(day => ({
					date: day.stat_date,
					impressions: day.total_impressions,
					durationSeconds: day.total_duration_seconds,
					viewerMinutes: day.total_viewer_minutes,
					matchCount: day.display_match_count,
					bracketCount: day.display_bracket_count
				}))
			};
		});

		res.json({
			success: true,
			generatedAt: new Date().toISOString(),
			dateRange: { startDate: startDate || 'all-time', endDate: endDate || 'present' },
			sponsorCount: reportData.length,
			report: sponsorId ? reportData[0] : reportData
		});
	} catch (error) {
		console.error('[Sponsors] Report JSON error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// GET /api/sponsors/report/csv - Export sponsor impressions as CSV
app.get('/api/sponsors/report/csv', requireAuthAPI, async (req, res) => {
	try {
		const { sponsorId, startDate, endDate, type } = req.query;

		// Get all sponsors or specific one
		let sponsors = [];
		if (sponsorId) {
			const sponsor = systemDb.getDb().prepare('SELECT * FROM sponsors WHERE id = ?').get(sponsorId);
			if (!sponsor) {
				return res.status(404).json({ success: false, error: 'Sponsor not found' });
			}
			sponsors = [sponsor];
		} else {
			sponsors = systemDb.getDb().prepare('SELECT * FROM sponsors').all();
		}

		let csv = '';

		if (type === 'daily') {
			// Daily breakdown CSV
			const headers = ['Sponsor Name', 'Date', 'Impressions', 'Duration (seconds)', 'Viewer Minutes', 'Match Count', 'Bracket Count'];
			csv = headers.join(',') + '\n';

			for (const sponsor of sponsors) {
				const dailyStats = systemDb.getSponsorImpressionStats(sponsor.id, {
					startDate,
					endDate,
					limit: 365
				});

				for (const day of dailyStats) {
					csv += [
						`"${sponsor.name}"`,
						day.stat_date,
						day.total_impressions,
						day.total_duration_seconds,
						day.total_viewer_minutes,
						day.display_match_count,
						day.display_bracket_count
					].join(',') + '\n';
				}
			}
		} else {
			// Summary CSV
			const headers = ['Sponsor Name', 'Position', 'Active', 'Total Impressions', 'Total Duration', 'Viewer Minutes', 'Match Impressions', 'Bracket Impressions', 'Tournaments'];
			csv = headers.join(',') + '\n';

			for (const sponsor of sponsors) {
				const totals = systemDb.getSponsorImpressionTotals(sponsor.id);
				csv += [
					`"${sponsor.name}"`,
					sponsor.position,
					sponsor.active ? 'Yes' : 'No',
					totals.total_impressions || 0,
					formatDurationSeconds(totals.total_duration_seconds || 0),
					totals.total_viewer_minutes || 0,
					totals.match_impressions || 0,
					totals.bracket_impressions || 0,
					totals.unique_tournaments || 0
				].join(',') + '\n';
			}
		}

		const filename = sponsorId
			? `sponsor_report_${sponsors[0]?.name?.replace(/[^a-z0-9]/gi, '_') || 'unknown'}.csv`
			: 'sponsors_report.csv';

		res.setHeader('Content-Type', 'text/csv');
		res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
		res.send(csv);
	} catch (error) {
		console.error('[Sponsors] Report CSV error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// GET /api/sponsors/report/pdf - Generate professional PDF sponsor report
app.get('/api/sponsors/report/pdf', requireAuthAPI, async (req, res) => {
	try {
		const { sponsorId, startDate, endDate } = req.query;
		const PDFDocument = require('pdfkit');

		// Get sponsor(s)
		let sponsors = [];
		if (sponsorId) {
			const sponsor = systemDb.getDb().prepare('SELECT * FROM sponsors WHERE id = ?').get(sponsorId);
			if (!sponsor) {
				return res.status(404).json({ success: false, error: 'Sponsor not found' });
			}
			sponsors = [sponsor];
		} else {
			sponsors = systemDb.getDb().prepare('SELECT * FROM sponsors').all();
		}

		// PDF color scheme
		const PDF_COLORS = {
			primary: '#1a1a2e',
			secondary: '#ffffff',
			accent: '#e94560',
			muted: '#6b7280',
			border: '#e5e7eb',
			rowAlt: '#f9fafb',
			success: '#10b981'
		};

		// Create PDF
		const doc = new PDFDocument({ margin: 50, size: 'LETTER' });

		const filename = sponsorId
			? `sponsor_report_${sponsors[0]?.name?.replace(/[^a-z0-9]/gi, '_') || 'unknown'}.pdf`
			: 'sponsors_report.pdf';

		res.setHeader('Content-Type', 'application/pdf');
		res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

		doc.pipe(res);

		// === HEADER ===
		doc.rect(0, 0, 612, 80).fill(PDF_COLORS.primary);
		doc.fillColor(PDF_COLORS.secondary)
			.fontSize(24)
			.text('Sponsor Performance Report', 50, 25, { width: 512 });

		const dateRange = startDate && endDate
			? `${startDate} to ${endDate}`
			: startDate ? `From ${startDate}`
			: endDate ? `Through ${endDate}`
			: 'All Time';

		doc.fontSize(11)
			.fillColor('#9ca3af')
			.text(`Date Range: ${dateRange} | Generated: ${new Date().toLocaleDateString()}`, 50, 52);

		let y = 100;

		// === SUMMARY SECTION ===
		doc.fillColor(PDF_COLORS.primary)
			.fontSize(16)
			.text('Summary', 50, y);

		y += 25;

		// Calculate overall totals
		const overallTotals = sponsors.reduce((acc, sponsor) => {
			const totals = systemDb.getSponsorImpressionTotals(sponsor.id);
			return {
				totalImpressions: acc.totalImpressions + (totals.total_impressions || 0),
				totalDuration: acc.totalDuration + (totals.total_duration_seconds || 0),
				totalViewerMinutes: acc.totalViewerMinutes + (totals.total_viewer_minutes || 0)
			};
		}, { totalImpressions: 0, totalDuration: 0, totalViewerMinutes: 0 });

		// Summary boxes
		const boxWidth = 160;
		const boxHeight = 50;

		// Box 1: Total Impressions
		doc.rect(50, y, boxWidth, boxHeight).fillAndStroke('#f3f4f6', PDF_COLORS.border);
		doc.fillColor(PDF_COLORS.muted).fontSize(9).text('TOTAL IMPRESSIONS', 60, y + 8);
		doc.fillColor(PDF_COLORS.primary).fontSize(20).text(overallTotals.totalImpressions.toLocaleString(), 60, y + 25);

		// Box 2: Display Time
		doc.rect(220, y, boxWidth, boxHeight).fillAndStroke('#f3f4f6', PDF_COLORS.border);
		doc.fillColor(PDF_COLORS.muted).fontSize(9).text('TOTAL DISPLAY TIME', 230, y + 8);
		doc.fillColor(PDF_COLORS.primary).fontSize(20).text(formatDurationSeconds(overallTotals.totalDuration), 230, y + 25);

		// Box 3: Viewer Minutes
		doc.rect(390, y, boxWidth, boxHeight).fillAndStroke('#f3f4f6', PDF_COLORS.border);
		doc.fillColor(PDF_COLORS.muted).fontSize(9).text('VIEWER MINUTES', 400, y + 8);
		doc.fillColor(PDF_COLORS.primary).fontSize(20).text(overallTotals.totalViewerMinutes.toLocaleString(), 400, y + 25);

		y += boxHeight + 30;

		// === INDIVIDUAL SPONSOR SECTIONS ===
		for (const sponsor of sponsors) {
			if (y > 650) {
				doc.addPage();
				y = 50;
			}

			const totals = systemDb.getSponsorImpressionTotals(sponsor.id);
			const dailyStats = systemDb.getSponsorImpressionStats(sponsor.id, {
				startDate,
				endDate,
				limit: 7
			});

			// Sponsor name header
			doc.rect(50, y, 512, 25).fill(PDF_COLORS.primary);
			doc.fillColor(PDF_COLORS.secondary)
				.fontSize(12)
				.text(sponsor.name, 60, y + 7);
			doc.text(`Position: ${sponsor.position || 'N/A'}`, 400, y + 7, { width: 150, align: 'right' });

			y += 35;

			// Stats row
			doc.fillColor(PDF_COLORS.muted).fontSize(9);
			doc.text(`Impressions: ${(totals.total_impressions || 0).toLocaleString()}`, 50, y);
			doc.text(`Duration: ${formatDurationSeconds(totals.total_duration_seconds || 0)}`, 180, y);
			doc.text(`Viewer Minutes: ${(totals.total_viewer_minutes || 0).toLocaleString()}`, 310, y);
			doc.text(`Match: ${totals.match_impressions || 0} | Bracket: ${totals.bracket_impressions || 0}`, 440, y);

			y += 20;

			// Recent activity (last 7 days)
			if (dailyStats.length > 0) {
				doc.fillColor(PDF_COLORS.primary).fontSize(10).text('Recent Activity (Last 7 Days):', 50, y);
				y += 15;

				// Table header
				doc.fillColor(PDF_COLORS.muted).fontSize(8);
				doc.text('Date', 50, y);
				doc.text('Impressions', 150, y);
				doc.text('Duration', 250, y);
				doc.text('Viewer Min', 350, y);

				y += 12;

				for (let i = 0; i < Math.min(dailyStats.length, 5); i++) {
					const day = dailyStats[i];
					if (i % 2 === 0) {
						doc.rect(50, y - 2, 512, 12).fill(PDF_COLORS.rowAlt);
					}
					doc.fillColor(PDF_COLORS.primary).fontSize(8);
					doc.text(day.stat_date, 50, y);
					doc.text(day.total_impressions.toString(), 150, y);
					doc.text(formatDurationSeconds(day.total_duration_seconds), 250, y);
					doc.text(day.total_viewer_minutes.toString(), 350, y);
					y += 12;
				}
			}

			y += 20;
		}

		// === FOOTER ===
		doc.fillColor(PDF_COLORS.muted)
			.fontSize(8)
			.text(`Generated by TCC Custom | ${new Date().toISOString()}`, 50, 750, { width: 512, align: 'center' });

		doc.end();

		console.log(`[Sponsors] PDF report generated for ${sponsors.length} sponsor(s)`);
	} catch (error) {
		console.error('[Sponsors] Report PDF error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// GET /api/sponsors/:id/report/pdf - Generate PDF report for single sponsor
app.get('/api/sponsors/:id/report/pdf', requireAuthAPI, async (req, res) => {
	// Redirect to main report endpoint with sponsorId
	req.query.sponsorId = req.params.id;
	res.redirect(`/api/sponsors/report/pdf?sponsorId=${req.params.id}&${new URLSearchParams(req.query).toString()}`);
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

// ============================================
// LOCAL DATABASE API ENDPOINTS
// ============================================

// Test database connection (local)
app.get('/api/test-connection', requireAuthAPI, async (req, res) => {
	try {
		// Test local database connection
		const db = analyticsDb.getDb();
		const result = db.prepare('SELECT COUNT(*) as count FROM tcc_tournaments').get();
		res.json({
			success: true,
			message: 'Database connection successful',
			stats: { tournamentCount: result.count }
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: 'Database connection failed',
			details: error.message
		});
	}
});

// Get participant stats (local database)
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

		// Get tournament from local database (supports both numeric ID and slug)
		const tournamentId = matchState.tournamentId;
		const tournament = isNaN(tournamentId)
			? tournamentDb.getBySlug(tournamentId)
			: tournamentDb.getById(parseInt(tournamentId));

		if (!tournament) {
			return res.status(404).json({
				success: false,
				error: 'Tournament not found'
			});
		}

		// Get participants from local database
		const participants = participantDb.getByTournament(tournament.id);

		// Calculate stats
		const totalParticipants = participants.length;
		const checkedInCount = participants.filter(p => p.checked_in).length;

		res.json({
			success: true,
			stats: {
				totalParticipants,
				checkedInCount,
				signupCap: tournament.signup_cap || null,
				checkInEnabled: !!tournament.check_in_duration,
				tournamentState: tournament.state,
				tournamentName: tournament.name
			},
			source: 'local'
		});
	} catch (error) {
		console.error('[Participant Stats] Error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to get participant stats',
			details: error.message
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

		// Broadcast display registration via WebSocket
		io.emit('display:registered', {
			display: {
				id: displayId,
				hostname,
				ip: display.ip,
				currentView: display.currentView,
				status: 'online'
			}
		});
		io.emit('displays:update', { action: 'registered', displayId });

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

		// Broadcast if display came online
		if (previousStatus === 'offline') {
			io.emit('display:updated', {
				display: {
					id: display.id,
					hostname: display.hostname,
					status: 'online',
					currentView: display.currentView
				}
			});
			io.emit('displays:update', { action: 'online', displayId: id });
		}

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

// GET /api/announcements/active - Get active platform announcements for banner display
// Available to all authenticated users
app.get('/api/announcements/active', requireAuthAPI, (req, res) => {
	try {
		const sysDb = systemDb.getDb();

		const announcements = sysDb.prepare(`
			SELECT id, message, type, created_at, expires_at
			FROM platform_announcements
			WHERE is_active = 1
			  AND (expires_at IS NULL OR expires_at > datetime('now'))
			ORDER BY
				CASE type WHEN 'alert' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
				created_at DESC
		`).all();

		res.json({
			success: true,
			announcements
		});
	} catch (error) {
		console.error('[Announcements] Error fetching active announcements:', error);
		// Return empty array on error to not break the banner
		res.json({
			success: true,
			announcements: []
		});
	}
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
