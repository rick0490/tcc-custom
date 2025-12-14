require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const rateLimit = require('express-rate-limit');

// ==================== ERROR CODES ====================
const ERROR_CODES = {
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	NAME_REQUIRED: 'NAME_REQUIRED',
	NAME_TOO_SHORT: 'NAME_TOO_SHORT',
	NAME_TOO_LONG: 'NAME_TOO_LONG',
	INVALID_INSTAGRAM: 'INVALID_INSTAGRAM',
	DUPLICATE_NAME: 'DUPLICATE_NAME',
	TOURNAMENT_FULL: 'TOURNAMENT_FULL',
	TOURNAMENT_STARTED: 'TOURNAMENT_STARTED',
	TOURNAMENT_NOT_FOUND: 'TOURNAMENT_NOT_FOUND',
	REGISTRATION_NOT_OPEN: 'REGISTRATION_NOT_OPEN',
	RATE_LIMITED: 'RATE_LIMITED',
	SERVER_ERROR: 'SERVER_ERROR'
};

// ==================== VALIDATION ====================
const VALIDATION = {
	NAME_MIN: 2,
	NAME_MAX: 50,
	INSTAGRAM_PATTERN: /^[a-zA-Z0-9._]{1,30}$/
};

// Helper to create standardized error responses
function errorResponse(res, status, code, message, field = null) {
	return res.status(status).json({
		success: false,
		error: {
			code: code,
			message: message,
			field: field
		}
	});
}

// ==================== DEBUG LOGGER ====================
const DEBUG = process.env.DEBUG_MODE === 'true';

function debugLog(service, action, data = {}) {
	if (!DEBUG) return;
	const timestamp = new Date().toISOString();
	const prefix = `[${timestamp}] [${service}:${action}]`;
	if (Object.keys(data).length === 0) {
		console.log(prefix);
	} else {
		try {
			console.log(prefix, JSON.stringify(data, null, 2));
		} catch (e) {
			console.log(prefix, data);
		}
	}
}

function debugError(service, action, error, context = {}) {
	const timestamp = new Date().toISOString();
	const prefix = `[${timestamp}] [${service}:${action}] ERROR:`;
	console.error(prefix, {
		message: error.message || error,
		stack: error.stack,
		...context
	});
}

// Create bound logger for this service
const log = (action, data) => debugLog('signup', action, data);
const logError = (action, error, context) => debugError('signup', action, error, context);

// Game configs path
const GAME_CONFIGS_PATH = path.join(__dirname, 'game-configs.json');

// Load game configurations
let gameConfigs = {};
function loadGameConfigs() {
	try {
		gameConfigs = JSON.parse(fs.readFileSync(GAME_CONFIGS_PATH, 'utf8'));
		log('game-configs:loaded', { games: Object.keys(gameConfigs) });
	} catch (error) {
		logError('game-configs:load', error);
		gameConfigs = { default: { name: 'Tournament', shortName: '', rules: [], prizes: [], additionalInfo: [] } };
	}
}

// Initial load
loadGameConfigs();

// Hot-reload: Watch for config file changes
const configWatcher = chokidar.watch(GAME_CONFIGS_PATH, {
	persistent: true,
	ignoreInitial: true,
	awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
});

configWatcher.on('change', () => {
	log('game-configs:file-changed', { path: GAME_CONFIGS_PATH });
	loadGameConfigs();
});

configWatcher.on('error', (error) => {
	logError('game-configs:watcher', error);
});

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== RATE LIMITING ====================
// Signup-specific rate limiter (stricter)
const signupLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10, // 10 signup attempts per IP per 15 minutes
	message: {
		success: false,
		error: {
			code: ERROR_CODES.RATE_LIMITED,
			message: 'Too many signup attempts. Please try again in 15 minutes.',
			field: null
		}
	},
	standardHeaders: true,
	legacyHeaders: false,
	keyGenerator: (req) => req.ip || req.connection?.remoteAddress || 'unknown'
});

// General API rate limiter (more lenient)
const apiLimiter = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minute
	max: 60, // 60 requests per minute
	message: {
		success: false,
		error: {
			code: ERROR_CODES.RATE_LIMITED,
			message: 'Too many requests. Please slow down.',
			field: null
		}
	},
	standardHeaders: true,
	legacyHeaders: false
});

// Admin Dashboard Activity Webhook Configuration
const ADMIN_WEBHOOK_URL = process.env.ADMIN_WEBHOOK_URL || 'http://localhost:3000/api/activity/external';
const ACTIVITY_TOKEN = process.env.ACTIVITY_TOKEN || '';

// Notify admin dashboard of signups (non-blocking)
async function notifyAdminDashboard(action, details) {
	if (!ACTIVITY_TOKEN) {
		log('webhook:skip', { reason: 'no token configured' });
		return;
	}

	try {
		await axios.post(ADMIN_WEBHOOK_URL, {
			action,
			source: 'signup-pwa',
			details
		}, {
			headers: {
				'Content-Type': 'application/json',
				'X-Activity-Token': ACTIVITY_TOKEN
			},
			timeout: 5000
		});
		log('webhook:sent', { action, details });
	} catch (error) {
		// Non-critical - log and continue
		logError('webhook:send', error, { action });
	}
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Helper function to map game name to config key
function getGameConfigKey(gameName) {
	if (!gameName) return 'default';

	const lowerGame = gameName.toLowerCase();

	// Super Smash Bros. Ultimate
	if (lowerGame.includes('ultimate') || lowerGame === 'ssbu') return 'ssbu';

	// Super Smash Bros. Melee
	if (lowerGame.includes('melee')) return 'melee';

	// Mario Kart World (new primary game)
	if (lowerGame.includes('mario kart world') || lowerGame === 'mkw') return 'mkw';

	// Mario Kart 8 (legacy support)
	if (lowerGame.includes('mario kart 8') || lowerGame === 'mk8' || lowerGame === 'mk8dx') return 'mk8';

	// Mario Kart (fallback to mkw if just "mario kart" is specified)
	if (lowerGame.includes('mario kart')) return 'mkw';

	// Halo 3
	if (lowerGame.includes('halo 3') || lowerGame === 'halo3' || lowerGame === 'h3') return 'halo3';

	// Halo (any other Halo games fall back to halo3 config)
	if (lowerGame.includes('halo')) return 'halo3';

	// Street Fighter 6
	if (lowerGame.includes('street fighter') || lowerGame === 'sf6') return 'sf6';

	// Check if game key exists directly in configs (for custom games)
	if (gameConfigs[lowerGame]) return lowerGame;

	// Fallback to default
	return 'default';
}

// Helper function to get game configuration
function getGameConfig(gameName) {
	const configKey = getGameConfigKey(gameName);
	return gameConfigs[configKey] || gameConfigs.default;
}

// Helper function to get current tournament info
function getTournamentInfo() {
	try {
		const stateFilePath = process.env.TOURNAMENT_STATE_FILE ||
			path.join(__dirname, '..', 'admin-dashboard', 'tournament-state.json');

		if (fs.existsSync(stateFilePath)) {
			const stateData = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
			// Use env API key if state file has placeholder or OAuth marker
			const apiKey = (stateData.apiKey && stateData.apiKey !== 'oauth-connected')
				? stateData.apiKey
				: process.env.CHALLONGE_API_KEY;
			return {
				tournamentId: stateData.tournamentId,
				apiKey: apiKey,
				registrationWindowHours: stateData.registrationWindowHours || 48,
				signupCap: stateData.signupCap || null
			};
		}

		// Fallback to environment variable
		if (process.env.FALLBACK_TOURNAMENT_ID) {
			return {
				tournamentId: process.env.FALLBACK_TOURNAMENT_ID,
				apiKey: process.env.CHALLONGE_API_KEY,
				registrationWindowHours: 48,
				signupCap: null
			};
		}

		return null;
	} catch (error) {
		logError('tournament-state:read', error);
		return null;
	}
}

// Helper function to get Challonge v2.1 API headers
function getChallongeV2Headers(apiKey) {
	return {
		'Authorization': apiKey,  // v2.1 with v1 API key (no Bearer prefix)
		'Authorization-Type': 'v1',
		'Content-Type': 'application/vnd.api+json',
		'Accept': 'application/json'
	};
}

// Helper function to get registration window from system settings
function getSystemRegistrationWindow() {
	try {
		const settingsPath = path.join(__dirname, '..', 'admin-dashboard', 'system-settings.json');
		if (fs.existsSync(settingsPath)) {
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
			return settings.systemDefaults?.registrationWindow || 48;
		}
	} catch (error) {
		logError('system-settings:read', error);
	}
	return 48; // Default fallback
}

// Helper function to check if registration is open
function isRegistrationOpen(tournamentDetails, registrationWindowHours) {
	// If tournament is not pending, registration is closed
	// This is the ONLY check for "tournament started" - we only close registration
	// when the tournament state actually changes (via Start Tournament button),
	// NOT based on the scheduled start time. This allows late walk-ins.
	if (tournamentDetails.state !== 'pending') {
		return { open: false, reason: 'tournament_started' };
	}

	// If tournament has no start time, keep registration open
	if (!tournamentDetails.start_at) {
		return { open: true };
	}

	// Use provided window hours, or fall back to system settings
	const effectiveWindowHours = registrationWindowHours || getSystemRegistrationWindow();

	const now = new Date();
	const tournamentStart = new Date(tournamentDetails.start_at);
	const registrationOpenTime = new Date(tournamentStart.getTime() - (effectiveWindowHours * 60 * 60 * 1000));

	// Check if we're before the registration window
	if (now < registrationOpenTime) {
		return {
			open: false,
			reason: 'too_early',
			opensAt: registrationOpenTime.toISOString()
		};
	}

	// NOTE: We intentionally do NOT close registration based on scheduled start time.
	// Registration stays open until the tournament is explicitly started via the
	// admin dashboard "Start Tournament" button. This allows for late walk-in entries.
	// The tournament state check at the top handles closure when actually started.

	// Registration is open
	return { open: true };
}

// Admin Dashboard API URL (for local database access)
const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://localhost:3000';

// Helper function to fetch tournament details from local database (via admin dashboard)
async function fetchTournamentDetails(tournamentId, apiKey) {
	try {
		const response = await axios.get(`${ADMIN_API_URL}/api/public/tournament`, {
			timeout: 5000
		});

		if (!response.data.success) {
			throw new Error(response.data.error || 'Failed to fetch tournament');
		}

		const tournament = response.data.tournament;

		// Map local response to expected format (compatible with old field names)
		return {
			id: tournament.id,
			name: tournament.name,
			url: tournament.urlSlug,
			full_challonge_url: tournament.bracketUrl || `http://bracket.despairhardware.com`,
			game_name: tournament.gameName,
			state: tournament.state,
			participants_count: tournament.participantsCount,
			start_at: tournament.startAt,
			signup_cap: tournament.signupCap,
			registration_open: tournament.registrationOpen,
			registration_reason: tournament.registrationReason,
			is_full: tournament.isFull
		};
	} catch (error) {
		logError('admin-api:fetch-tournament', error, {
			url: `${ADMIN_API_URL}/api/public/tournament`,
			status: error.response?.status,
			responseData: error.response?.data
		});
		throw error;
	}
}

// Helper function to fetch existing participants from local database (via admin dashboard)
async function fetchParticipants(tournamentId, apiKey) {
	try {
		const response = await axios.get(`${ADMIN_API_URL}/api/public/participants`, {
			timeout: 5000
		});

		if (!response.data.success) {
			throw new Error(response.data.error || 'Failed to fetch participants');
		}

		return response.data.participants || [];
	} catch (error) {
		logError('admin-api:fetch-participants', error, {
			url: `${ADMIN_API_URL}/api/public/participants`
		});
		return []; // Return empty array on error to allow signup to proceed
	}
}

// Helper function to check if a name is already registered (case-insensitive)
function isDuplicateName(existingParticipants, newName) {
	const normalizedNewName = newName.trim().toLowerCase();
	return existingParticipants.some(p =>
		p.name.trim().toLowerCase() === normalizedNewName
	);
}

// Helper function to find similar names (for better error messages)
function findSimilarName(existingParticipants, newName) {
	const normalizedNewName = newName.trim().toLowerCase();
	const match = existingParticipants.find(p =>
		p.name.trim().toLowerCase() === normalizedNewName
	);
	return match ? match.name : null;
}

// Helper function to add participant to local database (via admin dashboard)
async function addParticipant(tournamentId, apiKey, participantName, instagram, notes = null) {
	try {
		const response = await axios.post(
			`${ADMIN_API_URL}/api/public/signup`,
			{
				participantName: participantName,
				instagram: instagram,
				misc: notes  // Notes are stored in the misc field
			},
			{
				headers: { 'Content-Type': 'application/json' },
				timeout: 10000
			}
		);

		if (!response.data.success) {
			throw new Error(response.data.error || 'Signup failed');
		}

		return {
			id: response.data.participant.id,
			name: response.data.participant.name,
			seed: response.data.participant.seed
		};
	} catch (error) {
		logError('admin-api:add-participant', error, {
			url: `${ADMIN_API_URL}/api/public/signup`,
			participantName,
			status: error.response?.status,
			responseData: error.response?.data
		});
		throw error;
	}
}

// Routes

// GET / - Main signup page
app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET /confirmation - Confirmation page
app.get('/confirmation', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'confirmation.html'));
});

// GET /rules - Rules and prizes page
app.get('/rules', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'rules.html'));
});

// GET /api/game-config - Get game-specific rules and prizes
app.get('/api/game-config', async (req, res) => {
	try {
		const tournamentInfo = getTournamentInfo();

		if (!tournamentInfo) {
			// Return default config if no tournament is active
			return res.json({
				success: true,
				config: gameConfigs.default,
				gameKey: 'default'
			});
		}

		// Fetch tournament details to get game name
		const tournamentDetails = await fetchTournamentDetails(
			tournamentInfo.tournamentId,
			tournamentInfo.apiKey
		);

		const gameName = tournamentDetails.game_name;
		const config = getGameConfig(gameName);
		const gameKey = getGameConfigKey(gameName);

		res.json({
			success: true,
			config: config,
			gameKey: gameKey,
			gameName: gameName
		});
	} catch (error) {
		logError('api:game-config', error);
		// Return default config on error
		res.json({
			success: true,
			config: gameConfigs.default,
			gameKey: 'default',
			error: 'Failed to fetch tournament details, using default config'
		});
	}
});

// GET /api/tournament - Get current tournament info
app.get('/api/tournament', async (req, res) => {
	try {
		const tournamentInfo = getTournamentInfo();

		if (!tournamentInfo) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournamentDetails = await fetchTournamentDetails(
			tournamentInfo.tournamentId,
			tournamentInfo.apiKey
		);

		// Check registration status
		const registrationStatus = isRegistrationOpen(
			tournamentDetails,
			tournamentInfo.registrationWindowHours
		);

		// Check if tournament is full
		const isFull = tournamentInfo.signupCap &&
			tournamentDetails.participants_count >= tournamentInfo.signupCap;

		// Calculate registration open time if applicable
		let registrationOpenTime = null;
		if (tournamentDetails.start_at && tournamentInfo.registrationWindowHours) {
			const tournamentStart = new Date(tournamentDetails.start_at);
			registrationOpenTime = new Date(
				tournamentStart.getTime() - (tournamentInfo.registrationWindowHours * 60 * 60 * 1000)
			).toISOString();
		}

		res.json({
			success: true,
			tournament: {
				id: tournamentDetails.id,
				name: tournamentDetails.name,
				gameName: tournamentDetails.game_name,
				state: tournamentDetails.state,
				participantsCount: tournamentDetails.participants_count,
				url: tournamentDetails.url,
				fullChallongeUrl: tournamentDetails.full_challonge_url,
				startAt: tournamentDetails.start_at,
				// Registration settings
				registrationWindowHours: tournamentInfo.registrationWindowHours,
				signupCap: tournamentInfo.signupCap,
				registrationOpenTime: registrationOpenTime,
				// Registration status
				registrationOpen: registrationStatus.open,
				registrationReason: registrationStatus.reason,
				registrationOpensAt: registrationStatus.opensAt,
				isFull: isFull
			}
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: 'Failed to fetch tournament information',
			message: error.message
		});
	}
});

// POST /api/signup - Submit participant signup
app.post('/api/signup', signupLimiter, async (req, res) => {
	try {
		const { participantName, instagram, notes } = req.body;

		// ==================== INPUT VALIDATION ====================
		// Validate participant name exists
		if (!participantName || typeof participantName !== 'string') {
			return errorResponse(res, 400, ERROR_CODES.NAME_REQUIRED,
				'Participant name is required', 'participantName');
		}

		const trimmedName = participantName.trim();

		// Validate name is not empty after trimming
		if (trimmedName === '') {
			return errorResponse(res, 400, ERROR_CODES.NAME_REQUIRED,
				'Participant name is required', 'participantName');
		}

		// Validate minimum length
		if (trimmedName.length < VALIDATION.NAME_MIN) {
			return errorResponse(res, 400, ERROR_CODES.NAME_TOO_SHORT,
				`Name must be at least ${VALIDATION.NAME_MIN} characters`, 'participantName');
		}

		// Validate maximum length
		if (trimmedName.length > VALIDATION.NAME_MAX) {
			return errorResponse(res, 400, ERROR_CODES.NAME_TOO_LONG,
				`Name must be ${VALIDATION.NAME_MAX} characters or less`, 'participantName');
		}

		// Validate Instagram format if provided
		let sanitizedInstagram = null;
		if (instagram) {
			const cleanInstagram = instagram.trim().replace(/^@/, '');
			if (cleanInstagram && !VALIDATION.INSTAGRAM_PATTERN.test(cleanInstagram)) {
				return errorResponse(res, 400, ERROR_CODES.INVALID_INSTAGRAM,
					'Invalid Instagram handle format. Use only letters, numbers, periods, and underscores (max 30 characters)',
					'instagram');
			}
			sanitizedInstagram = cleanInstagram || null;
		}

		// Validate and sanitize notes if provided
		let sanitizedNotes = null;
		if (notes && typeof notes === 'string') {
			const trimmedNotes = notes.trim();
			if (trimmedNotes.length > 200) {
				return errorResponse(res, 400, ERROR_CODES.VALIDATION_ERROR,
					'Notes must be 200 characters or less', 'notes');
			}
			sanitizedNotes = trimmedNotes || null;
		}
		// ==================== END VALIDATION ====================

		const tournamentInfo = getTournamentInfo();

		if (!tournamentInfo) {
			return errorResponse(res, 404, ERROR_CODES.TOURNAMENT_NOT_FOUND,
				'No active tournament configured');
		}

		// Fetch tournament details to check registration status
		const tournamentDetails = await fetchTournamentDetails(
			tournamentInfo.tournamentId,
			tournamentInfo.apiKey
		);

		// Check if registration is open
		const registrationStatus = isRegistrationOpen(
			tournamentDetails,
			tournamentInfo.registrationWindowHours
		);

		if (!registrationStatus.open) {
			if (registrationStatus.reason === 'too_early') {
				const opensAt = new Date(registrationStatus.opensAt);
				const errorMessage = `Registration opens ${opensAt.toLocaleString('en-US', {
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit',
					timeZoneName: 'short'
				})}`;
				return res.status(403).json({
					success: false,
					error: {
						code: ERROR_CODES.REGISTRATION_NOT_OPEN,
						message: errorMessage,
						field: null
					},
					opensAt: registrationStatus.opensAt
				});
			} else if (registrationStatus.reason === 'tournament_started') {
				return errorResponse(res, 403, ERROR_CODES.TOURNAMENT_STARTED,
					'Tournament has already started. Registration is closed.');
			}

			return errorResponse(res, 403, ERROR_CODES.REGISTRATION_NOT_OPEN,
				'Registration is closed');
		}

		// Check if tournament is full
		if (tournamentInfo.signupCap &&
			tournamentDetails.participants_count >= tournamentInfo.signupCap) {
			return res.status(403).json({
				success: false,
				error: {
					code: ERROR_CODES.TOURNAMENT_FULL,
					message: `Tournament is full (${tournamentInfo.signupCap}/${tournamentInfo.signupCap} participants)`,
					field: null
				},
				signupCap: tournamentInfo.signupCap
			});
		}

		// Check for duplicate name (case-insensitive)
		const existingParticipants = await fetchParticipants(
			tournamentInfo.tournamentId,
			tournamentInfo.apiKey
		);

		const existingName = findSimilarName(existingParticipants, trimmedName);
		if (existingName) {
			return errorResponse(res, 400, ERROR_CODES.DUPLICATE_NAME,
				`"${existingName}" is already registered. Please use a different name.`,
				'participantName');
		}

		// Instagram and notes were already validated and sanitized in the validation section above

		const participant = await addParticipant(
			tournamentInfo.tournamentId,
			tournamentInfo.apiKey,
			trimmedName,
			sanitizedInstagram,
			sanitizedNotes
		);

		log('participant:added', {
			name: trimmedName,
			instagram: sanitizedInstagram || null,
			notes: sanitizedNotes || null,
			participantId: participant.id,
			seed: participant.seed
		});

		// Notify admin dashboard (non-blocking)
		notifyAdminDashboard('participant_signup', {
			tournamentName: tournamentDetails.name || 'Tournament',
			playerName: trimmedName,
			participantCount: (tournamentDetails.participants_count || 0) + 1,
			instagram: sanitizedInstagram || null
		}).catch(() => {}); // Silently ignore errors

		res.json({
			success: true,
			participant: {
				id: participant.id,
				name: participant.name,
				seed: participant.seed,
				instagram: sanitizedInstagram
			}
		});
	} catch (error) {
		logError('api:signup', error, { participantName: req.body.participantName });

		// Handle API errors with standardized format
		if (error.response && error.response.data) {
			const errorData = error.response.data;

			// Check for duplicate name error from admin dashboard
			if (errorData.error && typeof errorData.error === 'string') {
				const lowerError = errorData.error.toLowerCase();
				if (lowerError.includes('already registered') ||
					lowerError.includes('duplicate') ||
					lowerError.includes('already exists')) {
					return errorResponse(res, 400, ERROR_CODES.DUPLICATE_NAME,
						'This name is already registered. Please use a different name.',
						'participantName');
				}
			}

			// Return standardized error from upstream
			const message = errorData.error?.message || errorData.error || 'Signup failed';
			return errorResponse(res, error.response.status || 400,
				ERROR_CODES.VALIDATION_ERROR, message);
		}

		return errorResponse(res, 500, ERROR_CODES.SERVER_ERROR,
			'Failed to complete signup. Please try again.');
	}
});

// GET /api/participants/lookup - Check if a participant is registered
app.get('/api/participants/lookup', async (req, res) => {
	log('api:lookup:start', { query: req.query });
	try {
		const { name } = req.query;

		if (!name || name.trim() === '') {
			return res.status(400).json({
				success: false,
				found: false,
				error: 'Name parameter is required'
			});
		}

		// Call the admin dashboard's public lookup endpoint
		const response = await axios.get(
			`${ADMIN_API_URL}/api/public/participants/lookup`,
			{
				params: { name: name },
				timeout: 5000
			}
		);

		// Forward the response from admin dashboard
		return res.json(response.data);

	} catch (error) {
		logError('api:lookup', error, { name: req.query.name });
		res.status(500).json({
			success: false,
			found: false,
			error: 'Failed to lookup participant',
			message: error.message
		});
	}
});

// ==================== WAITLIST ENDPOINTS ====================

// POST /api/waitlist - Join waitlist (proxy to admin dashboard)
app.post('/api/waitlist', signupLimiter, async (req, res) => {
	try {
		const { name, email } = req.body;

		if (!name || name.trim() === '') {
			return errorResponse(res, 400, ERROR_CODES.NAME_REQUIRED,
				'Name is required to join waitlist', 'name');
		}

		const response = await axios.post(
			`${ADMIN_API_URL}/api/public/waitlist`,
			{ name, email },
			{
				headers: { 'Content-Type': 'application/json' },
				timeout: 5000
			}
		);

		log('waitlist:joined', { name, position: response.data.position });
		return res.json(response.data);

	} catch (error) {
		logError('api:waitlist:join', error, { name: req.body.name });

		// Forward error from admin dashboard
		if (error.response && error.response.data) {
			return res.status(error.response.status || 400).json(error.response.data);
		}

		return errorResponse(res, 500, ERROR_CODES.SERVER_ERROR,
			'Failed to join waitlist. Please try again.');
	}
});

// GET /api/waitlist - Check waitlist status (proxy to admin dashboard)
app.get('/api/waitlist', async (req, res) => {
	try {
		const { name } = req.query;

		if (!name || name.trim() === '') {
			return res.status(400).json({
				success: false,
				error: 'Name parameter is required'
			});
		}

		const response = await axios.get(
			`${ADMIN_API_URL}/api/public/waitlist`,
			{
				params: { name },
				timeout: 5000
			}
		);

		return res.json(response.data);

	} catch (error) {
		logError('api:waitlist:check', error, { name: req.query.name });

		// Forward error from admin dashboard
		if (error.response && error.response.data) {
			return res.status(error.response.status || 400).json(error.response.data);
		}

		return res.status(500).json({
			success: false,
			error: 'Failed to check waitlist status'
		});
	}
});

// DELETE /api/waitlist - Leave waitlist (proxy to admin dashboard)
app.delete('/api/waitlist', async (req, res) => {
	try {
		const { name } = req.body;

		if (!name || name.trim() === '') {
			return res.status(400).json({
				success: false,
				error: 'Name is required to leave waitlist'
			});
		}

		const response = await axios.delete(
			`${ADMIN_API_URL}/api/public/waitlist`,
			{
				data: { name },
				headers: { 'Content-Type': 'application/json' },
				timeout: 5000
			}
		);

		log('waitlist:left', { name });
		return res.json(response.data);

	} catch (error) {
		logError('api:waitlist:leave', error, { name: req.body.name });

		// Forward error from admin dashboard
		if (error.response && error.response.data) {
			return res.status(error.response.status || 400).json(error.response.data);
		}

		return res.status(500).json({
			success: false,
			error: 'Failed to leave waitlist'
		});
	}
});

// Health check endpoint
app.get('/api/health', (req, res) => {
	res.json({
		status: 'ok',
		service: 'tournament-signup',
		timestamp: new Date().toISOString()
	});
});

// ==================== PUSH NOTIFICATION ENDPOINTS ====================

// GET /api/push/vapid-public-key - Get VAPID public key from admin dashboard
app.get('/api/push/vapid-public-key', async (req, res) => {
	try {
		const response = await axios.get(
			`${ADMIN_API_URL}/api/public/push/vapid-public-key`,
			{ timeout: 5000 }
		);

		if (!response.data.success) {
			return res.status(503).json({
				success: false,
				error: 'Push notifications not configured on server'
			});
		}

		res.json(response.data);
	} catch (error) {
		logError('api:push:vapid-key', error);
		res.status(503).json({
			success: false,
			error: 'Push notifications not available'
		});
	}
});

// POST /api/push/subscribe - Subscribe to push notifications
app.post('/api/push/subscribe', async (req, res) => {
	try {
		const { subscription, notificationTypes } = req.body;

		if (!subscription || !subscription.endpoint) {
			return res.status(400).json({
				success: false,
				error: 'Invalid push subscription'
			});
		}

		// Forward subscription to admin dashboard
		const response = await axios.post(
			`${ADMIN_API_URL}/api/public/push/subscribe`,
			{
				subscription,
				source: 'signup-pwa',
				notificationTypes: notificationTypes || ['registration_open', 'tournament_starting']
			},
			{
				headers: { 'Content-Type': 'application/json' },
				timeout: 10000
			}
		);

		log('push:subscribed', { endpoint: subscription.endpoint.slice(0, 50) + '...' });
		res.json(response.data);
	} catch (error) {
		logError('api:push:subscribe', error);

		if (error.response?.data) {
			return res.status(error.response.status || 500).json(error.response.data);
		}

		res.status(500).json({
			success: false,
			error: 'Failed to subscribe to notifications'
		});
	}
});

// DELETE /api/push/unsubscribe - Unsubscribe from push notifications
app.delete('/api/push/unsubscribe', async (req, res) => {
	try {
		const { endpoint } = req.body;

		if (!endpoint) {
			return res.status(400).json({
				success: false,
				error: 'Endpoint is required'
			});
		}

		const response = await axios.delete(
			`${ADMIN_API_URL}/api/public/push/unsubscribe`,
			{
				data: { endpoint },
				headers: { 'Content-Type': 'application/json' },
				timeout: 5000
			}
		);

		log('push:unsubscribed', { endpoint: endpoint.slice(0, 50) + '...' });
		res.json(response.data);
	} catch (error) {
		logError('api:push:unsubscribe', error);
		res.status(500).json({
			success: false,
			error: 'Failed to unsubscribe'
		});
	}
});

// Start server only if not in test mode
if (process.env.NODE_ENV !== 'test') {
	app.listen(PORT, '0.0.0.0', () => {
		log('server:started', {
			port: PORT,
			debugMode: DEBUG,
			localUrl: `http://localhost:${PORT}`,
			productionUrl: 'https://signup.despairhardware.com'
		});
		console.log(`Tournament Signup app listening on port ${PORT}`);
	});
}

// Export for testing
module.exports = {
	app,
	getGameConfigKey,
	getGameConfig,
	isRegistrationOpen,
	VALIDATION,
	ERROR_CODES
};
