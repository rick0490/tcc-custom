/**
 * Bracket Display Service
 *
 * Standalone Express server for displaying tournament brackets.
 * Multi-tenant support via /u/:userId/bracket URL pattern.
 *
 * Port: 2053 (matches legacy MagicMirror-bracket API port)
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 2053;
const ADMIN_DASHBOARD_URL = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000';
const ADMIN_WS_URL = process.env.ADMIN_WS_URL || ADMIN_DASHBOARD_URL;
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// State
let serviceStartTime = Date.now();
let currentTournament = {
	tournamentId: null,
	bracketUrl: null,
	tournament: null,
	matches: [],
	participants: [],
	theme: 'midnight',
	roundLabels: null,
	lastUpdated: null
};

// Debug logger
function log(action, data = {}) {
	if (DEBUG_MODE) {
		const timestamp = new Date().toISOString();
		console.log(`[${timestamp}] [bracket-display:${action}]`, JSON.stringify(data));
	}
}

function logError(action, error, context = {}) {
	const timestamp = new Date().toISOString();
	console.error(`[${timestamp}] [bracket-display:${action}] ERROR:`, error.message || error, context);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting for display routes
const displayLimiter = rateLimit({
	windowMs: 60 * 1000, // 1 minute
	max: 60,
	message: { success: false, error: 'Too many requests' }
});

// Request logging middleware
app.use((req, res, next) => {
	if (DEBUG_MODE && req.path !== '/api/health') {
		log('request', { method: req.method, path: req.path, query: req.query });
	}
	next();
});

// Favicon handler (prevent 404)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ============================================================================
// Health & Status Routes
// ============================================================================

/**
 * GET /
 * Service info
 */
app.get('/', (req, res) => {
	res.json({
		service: 'bracket-display',
		version: '1.0.0',
		description: 'Standalone bracket display service',
		endpoints: {
			health: '/api/health',
			status: '/api/bracket/status',
			display: '/u/:userId/bracket'
		}
	});
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
	res.json({
		success: true,
		service: 'bracket-display',
		version: '1.0.0',
		timestamp: new Date().toISOString(),
		uptime: (Date.now() - serviceStartTime) / 1000
	});
});

/**
 * GET /api/bracket/status
 * Status endpoint for admin dashboard pre-flight checklist
 */
app.get('/api/bracket/status', (req, res) => {
	res.json({
		success: true,
		service: 'bracket-display',
		status: 'ready',
		uptime: (Date.now() - serviceStartTime) / 1000,
		adminDashboardUrl: ADMIN_DASHBOARD_URL,
		adminWsUrl: ADMIN_WS_URL,
		debugMode: DEBUG_MODE
	});
});

/**
 * GET /api/tournament/status
 * Legacy status endpoint for compatibility with admin dashboard
 */
app.get('/api/tournament/status', (req, res) => {
	res.json({
		success: true,
		service: 'bracket-display',
		status: 'ready'
	});
});

// ============================================================================
// Bracket Control Routes (for admin dashboard compatibility)
// ============================================================================

/**
 * POST /api/bracket/update
 * Update bracket tournament (legacy compatibility)
 * Also fetches and caches tournament data for HTTP fallback
 */
app.post('/api/bracket/update', async (req, res) => {
	const { tournamentId, bracketUrl, theme } = req.body;
	log('bracket-update', { tournamentId, bracketUrl, theme });

	// Store tournament ID and theme
	currentTournament.tournamentId = tournamentId;
	currentTournament.bracketUrl = bracketUrl;
	if (theme) {
		currentTournament.theme = theme;
	}
	currentTournament.lastUpdated = new Date().toISOString();

	// Try to fetch tournament data for caching (best effort, don't block response)
	if (tournamentId) {
		fetchAndCacheTournamentData(tournamentId).catch(err => {
			logError('bracket-update:cache', err, { tournamentId });
		});
	}

	res.json({
		success: true,
		message: 'Bracket update acknowledged',
		tournamentId,
		bracketUrl,
		theme: currentTournament.theme
	});
});

/**
 * Helper: Fetch and cache tournament data from admin dashboard
 */
async function fetchAndCacheTournamentData(tournamentId) {
	const axios = require('axios');

	try {
		// Fetch tournament, matches, participants, bracket settings, and round labels in parallel
		const [tournamentRes, matchesRes, participantsRes, settingsRes, roundLabelsRes] = await Promise.all([
			axios.get(`${ADMIN_DASHBOARD_URL}/api/tournament/${tournamentId}`, { timeout: 10000 }).catch(() => ({ data: {} })),
			axios.get(`${ADMIN_DASHBOARD_URL}/api/matches/${tournamentId}`, { timeout: 10000 }).catch(() => ({ data: {} })),
			axios.get(`${ADMIN_DASHBOARD_URL}/api/participants/${tournamentId}`, { timeout: 10000 }).catch(() => ({ data: {} })),
			axios.get(`${ADMIN_DASHBOARD_URL}/api/settings/bracket-display`, { timeout: 5000 }).catch(() => ({ data: {} })),
			axios.get(`${ADMIN_DASHBOARD_URL}/api/tournament/${tournamentId}/round-labels`, { timeout: 5000 }).catch(() => ({ data: {} }))
		]);

		currentTournament.tournament = tournamentRes.data?.tournament || null;
		currentTournament.matches = matchesRes.data?.matches || [];
		currentTournament.participants = participantsRes.data?.participants || [];

		// Update theme from settings if available
		if (settingsRes.data?.theme) {
			currentTournament.theme = settingsRes.data.theme;
		}

		// Update round labels if available (extract custom labels from API response)
		if (roundLabelsRes.data?.success && roundLabelsRes.data?.labels) {
			// Convert the full labels format { winners: { 1: { default, custom }, ... } }
			// to simplified format { winners: { 1: "Label", ... } }
			const labels = roundLabelsRes.data.labels;
			const simplified = { winners: {}, losers: {} };

			for (const [round, data] of Object.entries(labels.winners || {})) {
				if (data.custom) {
					simplified.winners[round] = data.custom;
				}
			}
			for (const [round, data] of Object.entries(labels.losers || {})) {
				if (data.custom) {
					simplified.losers[round] = data.custom;
				}
			}

			// Only store if there are custom labels
			const hasCustomLabels = Object.keys(simplified.winners).length > 0 || Object.keys(simplified.losers).length > 0;
			currentTournament.roundLabels = hasCustomLabels ? simplified : null;
		} else {
			currentTournament.roundLabels = null;
		}

		currentTournament.lastUpdated = new Date().toISOString();

		log('bracket-update:cached', {
			tournamentId,
			matchCount: currentTournament.matches.length,
			participantCount: currentTournament.participants.length,
			theme: currentTournament.theme,
			hasRoundLabels: currentTournament.roundLabels !== null
		});
	} catch (error) {
		logError('fetchAndCacheTournamentData', error, { tournamentId });
	}
}

/**
 * POST /api/bracket/zoom
 * Set zoom level (broadcasts via WebSocket from admin dashboard)
 */
app.post('/api/bracket/zoom', (req, res) => {
	const { zoomScale } = req.body;
	log('bracket-zoom', { zoomScale });

	// Zoom is controlled client-side via WebSocket
	res.json({
		success: true,
		message: 'Zoom request acknowledged',
		zoomScale
	});
});

/**
 * POST /api/bracket/reset
 * Reset bracket view to default zoom
 */
app.post('/api/bracket/reset', (req, res) => {
	log('bracket-reset', {});

	res.json({
		success: true,
		message: 'Reset request acknowledged'
	});
});

/**
 * POST /api/bracket/control
 * Generic control endpoint
 */
app.post('/api/bracket/control', (req, res) => {
	const { action, parameters } = req.body;
	log('bracket-control', { action, parameters });

	res.json({
		success: true,
		message: 'Control request acknowledged',
		action,
		parameters
	});
});

// ============================================================================
// Sponsor Control Routes
// ============================================================================

/**
 * POST /api/sponsor/show
 * Show sponsors (broadcasts via WebSocket from admin dashboard)
 */
app.post('/api/sponsor/show', (req, res) => {
	const { sponsors, config } = req.body;
	log('sponsor-show', { sponsorCount: sponsors?.length });

	res.json({
		success: true,
		message: 'Sponsor show request acknowledged'
	});
});

/**
 * POST /api/sponsor/hide
 * Hide sponsors
 */
app.post('/api/sponsor/hide', (req, res) => {
	const { position } = req.body;
	log('sponsor-hide', { position: position || 'all' });

	res.json({
		success: true,
		message: 'Sponsor hide request acknowledged'
	});
});

/**
 * POST /api/sponsor/rotate
 * Rotate sponsor at position
 */
app.post('/api/sponsor/rotate', (req, res) => {
	const { position, sponsor } = req.body;
	log('sponsor-rotate', { position, sponsor });

	res.json({
		success: true,
		message: 'Sponsor rotate request acknowledged'
	});
});

/**
 * GET /api/sponsors/image/:filename
 * Proxy sponsor image from admin dashboard
 */
app.get('/api/sponsors/image/:userId/:filename', async (req, res) => {
	const { userId, filename } = req.params;
	const imageUrl = `${ADMIN_DASHBOARD_URL}/api/sponsors/preview/${userId}/${filename}`;

	log('sponsor-image-proxy', { userId, filename });

	try {
		// Redirect to admin dashboard for the image
		res.redirect(imageUrl);
	} catch (error) {
		logError('sponsor-image-proxy', error, { userId, filename });
		res.status(500).json({ success: false, error: 'Failed to fetch sponsor image' });
	}
});

// ============================================================================
// Display Routes (Multi-tenant)
// ============================================================================

/**
 * GET /u/:userId/bracket
 * Main bracket display page (multi-tenant)
 */
app.get('/u/:userId/bracket', displayLimiter, (req, res) => {
	const { userId } = req.params;

	log('display-render', { userId });

	res.render('bracket-display', {
		userId,
		adminDashboardUrl: ADMIN_DASHBOARD_URL,
		adminWsUrl: ADMIN_WS_URL,
		debugMode: DEBUG_MODE
	});
});

/**
 * GET /u/:userId
 * Redirect to bracket display
 */
app.get('/u/:userId', (req, res) => {
	res.redirect(`/u/${req.params.userId}/bracket`);
});

// ============================================================================
// HTTP Fallback API Routes
// ============================================================================

/**
 * GET /api/u/:userId/bracket/data
 * Get bracket data via HTTP (fallback when WebSocket unavailable)
 * Returns cached state from /api/bracket/update calls
 */
app.get('/api/u/:userId/bracket/data', (req, res) => {
	const { userId } = req.params;

	log('http-bracket-data', { userId, cachedTournament: currentTournament.tournamentId });

	// Return cached state if available
	if (currentTournament.tournamentId && currentTournament.tournament) {
		return res.json({
			success: true,
			tournament: currentTournament.tournament,
			matches: currentTournament.matches,
			participants: currentTournament.participants,
			theme: currentTournament.theme,
			roundLabels: currentTournament.roundLabels,
			source: 'cache',
			lastUpdated: currentTournament.lastUpdated
		});
	}

	// No cached data - return empty (WebSocket should handle real-time data)
	res.json({
		success: true,
		tournament: null,
		matches: [],
		participants: [],
		theme: currentTournament.theme,
		roundLabels: null,
		message: 'No tournament data cached. Data will be received via WebSocket.',
		source: 'none'
	});
});

// ============================================================================
// Error Handling
// ============================================================================

// 404 handler
app.use((req, res) => {
	res.status(404).json({
		success: false,
		error: 'Not found',
		path: req.path
	});
});

// Global error handler
app.use((err, req, res, next) => {
	logError('unhandled', err, { path: req.path });
	res.status(500).json({
		success: false,
		error: 'Internal server error'
	});
});

// ============================================================================
// Server Startup
// ============================================================================

app.listen(PORT, () => {
	console.log(`[bracket-display] Server started on port ${PORT}`);
	console.log(`[bracket-display] Admin Dashboard URL: ${ADMIN_DASHBOARD_URL}`);
	console.log(`[bracket-display] Admin WebSocket URL: ${ADMIN_WS_URL}`);
	console.log(`[bracket-display] Debug mode: ${DEBUG_MODE}`);
	log('startup', { port: PORT, adminUrl: ADMIN_DASHBOARD_URL });
});

module.exports = app;
