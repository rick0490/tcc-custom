require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

// Game configs path
const GAME_CONFIGS_PATH = path.join(__dirname, 'game-configs.json');

// Load game configurations
let gameConfigs = {};
function loadGameConfigs() {
	try {
		gameConfigs = JSON.parse(fs.readFileSync(GAME_CONFIGS_PATH, 'utf8'));
		console.log('[Game Configs] Loaded:', Object.keys(gameConfigs).join(', '));
	} catch (error) {
		console.error('[Game Configs] Error loading:', error.message);
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
	console.log('[Game Configs] File changed, reloading...');
	loadGameConfigs();
});

configWatcher.on('error', (error) => {
	console.error('[Game Configs] Watcher error:', error.message);
});

const app = express();
const PORT = process.env.PORT || 3001;

// Admin Dashboard Activity Webhook Configuration
const ADMIN_WEBHOOK_URL = process.env.ADMIN_WEBHOOK_URL || 'http://localhost:3000/api/activity/external';
const ACTIVITY_TOKEN = process.env.ACTIVITY_TOKEN || '';

// Notify admin dashboard of signups (non-blocking)
async function notifyAdminDashboard(action, details) {
	if (!ACTIVITY_TOKEN) {
		console.log('[Activity Webhook] No token configured, skipping notification');
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
		console.log('[Activity Webhook] Notification sent:', action);
	} catch (error) {
		// Non-critical - log and continue
		console.error('[Activity Webhook] Failed to notify:', error.message);
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
		const stateFilePath = process.env.TOURNAMENT_STATE_FILE;

		if (stateFilePath && fs.existsSync(stateFilePath)) {
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
		console.error('Error reading tournament state:', error);
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
		console.error('Error reading system settings:', error.message);
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

// Helper function to fetch tournament details from Challonge (v2.1 API)
async function fetchTournamentDetails(tournamentId, apiKey) {
	try {
		const response = await axios.get(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}.json`,
			{ headers: getChallongeV2Headers(apiKey) }
		);
		// v2.1 returns { data: { id, type, attributes: {...} } } structure
		const rawData = response.data.data;
		const attrs = rawData?.attributes || {};

		// Map v2.1 response to expected format (compatible with old v1 field names)
		// NOTE: v2.1 uses 'starts_at' while v1 used 'start_at'
		return {
			id: rawData?.id || tournamentId,
			name: attrs.name,
			url: attrs.url,
			full_challonge_url: attrs.full_challonge_url,
			game_name: attrs.game_name,
			state: attrs.state,
			participants_count: attrs.participants_count,
			start_at: attrs.starts_at,  // v2.1 field name is 'starts_at'
			started_at: attrs.timestamps?.started_at,
			completed_at: attrs.timestamps?.completed_at,
			description: attrs.description,
			tournament_type: attrs.tournament_type
		};
	} catch (error) {
		console.error('Error fetching tournament details:', error.message);
		if (error.response) {
			console.error('Response status:', error.response.status);
			console.error('Response data:', JSON.stringify(error.response.data, null, 2));
		}
		throw error;
	}
}

// Helper function to fetch existing participants from Challonge (v2.1 API)
async function fetchParticipants(tournamentId, apiKey) {
	try {
		const response = await axios.get(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}/participants.json`,
			{ headers: getChallongeV2Headers(apiKey) }
		);

		// v2.1 returns { data: [{id, type, attributes: {name, ...}}, ...] }
		const participants = response.data.data || [];
		return participants.map(p => ({
			id: p.id,
			name: p.attributes?.name || ''
		}));
	} catch (error) {
		console.error('Error fetching participants:', error.message);
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

// Helper function to add participant to Challonge tournament (v2.1 API)
async function addParticipant(tournamentId, apiKey, participantName, instagram) {
	try {
		// Build v2.1 participant data structure
		const participantAttributes = {
			name: participantName
		};

		// Add Instagram handle to misc field if provided
		if (instagram) {
			participantAttributes.misc = `Instagram: @${instagram}`;
		}

		// v2.1 uses JSON:API format
		const requestData = {
			data: {
				type: 'participant',
				attributes: participantAttributes
			}
		};

		const response = await axios.post(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}/participants.json`,
			requestData,
			{ headers: getChallongeV2Headers(apiKey) }
		);

		// Map v2.1 response to expected format
		const rawData = response.data.data;
		const attrs = rawData?.attributes || {};

		return {
			id: rawData?.id,
			name: attrs.name,
			seed: attrs.seed,
			misc: attrs.misc
		};
	} catch (error) {
		console.error('Error adding participant:', error.message);
		if (error.response) {
			console.error('Response status:', error.response.status);
			console.error('Response data:', JSON.stringify(error.response.data, null, 2));
		}
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
		console.error('Error fetching game config:', error.message);
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
app.post('/api/signup', async (req, res) => {
	try {
		const { participantName, instagram } = req.body;

		if (!participantName || participantName.trim() === '') {
			return res.status(400).json({
				success: false,
				error: 'Participant name is required'
			});
		}

		const tournamentInfo = getTournamentInfo();

		if (!tournamentInfo) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
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
			let errorMessage = 'Registration is closed';

			if (registrationStatus.reason === 'too_early') {
				const opensAt = new Date(registrationStatus.opensAt);
				errorMessage = `Registration opens ${opensAt.toLocaleString('en-US', {
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit',
					timeZoneName: 'short'
				})}`;
			} else if (registrationStatus.reason === 'tournament_started') {
				errorMessage = 'Tournament has already started. Registration is closed.';
			}

			return res.status(403).json({
				success: false,
				error: errorMessage,
				reason: registrationStatus.reason,
				opensAt: registrationStatus.opensAt
			});
		}

		// Check if tournament is full
		if (tournamentInfo.signupCap &&
			tournamentDetails.participants_count >= tournamentInfo.signupCap) {
			return res.status(403).json({
				success: false,
				error: `Tournament is full (${tournamentInfo.signupCap}/${tournamentInfo.signupCap} participants)`,
				reason: 'tournament_full',
				signupCap: tournamentInfo.signupCap
			});
		}

		// Check for duplicate name (case-insensitive)
		const existingParticipants = await fetchParticipants(
			tournamentInfo.tournamentId,
			tournamentInfo.apiKey
		);

		const existingName = findSimilarName(existingParticipants, participantName);
		if (existingName) {
			return res.status(400).json({
				success: false,
				error: `"${existingName}" is already registered. Please use a different name.`,
				reason: 'duplicate_name'
			});
		}

		// Sanitize Instagram handle (remove @ if user included it)
		const sanitizedInstagram = instagram ? instagram.trim().replace(/^@/, '') : undefined;

		const participant = await addParticipant(
			tournamentInfo.tournamentId,
			tournamentInfo.apiKey,
			participantName.trim(),
			sanitizedInstagram
		);

		const logMessage = sanitizedInstagram
			? `Participant added: ${participantName} (@${sanitizedInstagram}) (ID: ${participant.id})`
			: `Participant added: ${participantName} (ID: ${participant.id})`;
		console.log(logMessage);

		// Notify admin dashboard (non-blocking)
		notifyAdminDashboard('participant_signup', {
			tournamentName: tournamentDetails.name || 'Tournament',
			playerName: participantName.trim(),
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
		console.error('Signup error:', error);

		// Handle specific Challonge errors (v2.1 API returns errors as array of objects)
		if (error.response && error.response.data && error.response.data.errors) {
			const errors = error.response.data.errors;
			let errorMessage = 'Signup failed';

			// v2.1 API error format: [{detail: "...", source: {...}}]
			if (Array.isArray(errors) && errors.length > 0) {
				const firstError = errors[0];
				if (typeof firstError === 'object' && firstError.detail) {
					errorMessage = String(firstError.detail);
				} else if (typeof firstError === 'string') {
					errorMessage = firstError;
				} else if (typeof firstError === 'object') {
					// Try to extract any useful message from the error object
					errorMessage = firstError.title || firstError.message || JSON.stringify(firstError);
				}

				// Check for duplicate name error (ensure errorMessage is a string)
				const lowerError = String(errorMessage).toLowerCase();
				if (lowerError.includes('name has already been taken') ||
					lowerError.includes('duplicate') ||
					lowerError.includes('already exists') ||
					lowerError.includes('already been taken')) {
					errorMessage = 'This name is already registered. Please use a different name.';
				}
			}

			return res.status(400).json({
				success: false,
				error: errorMessage
			});
		}

		res.status(500).json({
			success: false,
			error: 'Failed to complete signup',
			message: error.message
		});
	}
});

// GET /api/participants/lookup - Check if a participant is registered
app.get('/api/participants/lookup', async (req, res) => {
	try {
		const { name } = req.query;

		if (!name || name.trim() === '') {
			return res.status(400).json({
				success: false,
				found: false,
				error: 'Name parameter is required'
			});
		}

		const tournamentInfo = getTournamentInfo();

		if (!tournamentInfo) {
			return res.status(404).json({
				success: false,
				found: false,
				error: 'No active tournament configured'
			});
		}

		// Fetch all participants
		const participants = await fetchParticipants(
			tournamentInfo.tournamentId,
			tournamentInfo.apiKey
		);

		// Case-insensitive partial match search
		const searchName = name.trim().toLowerCase();
		const matches = participants.filter(p =>
			p.name.toLowerCase().includes(searchName) ||
			searchName.includes(p.name.toLowerCase())
		);

		// Check for exact match first (case-insensitive)
		const exactMatch = participants.find(p =>
			p.name.toLowerCase() === searchName
		);

		if (exactMatch) {
			// Fetch full participant details to get seed
			try {
				const response = await axios.get(
					`https://api.challonge.com/v2.1/tournaments/${tournamentInfo.tournamentId}/participants.json`,
					{ headers: getChallongeV2Headers(tournamentInfo.apiKey) }
				);

				const fullParticipants = response.data.data || [];
				const fullMatch = fullParticipants.find(p =>
					p.attributes?.name?.toLowerCase() === searchName
				);

				return res.json({
					success: true,
					found: true,
					participant: {
						id: fullMatch?.id || exactMatch.id,
						name: fullMatch?.attributes?.name || exactMatch.name,
						seed: fullMatch?.attributes?.seed || null,
						checkedIn: fullMatch?.attributes?.checked_in || false
					}
				});
			} catch (error) {
				// Fall back to basic info if detailed fetch fails
				return res.json({
					success: true,
					found: true,
					participant: {
						id: exactMatch.id,
						name: exactMatch.name,
						seed: null,
						checkedIn: false
					}
				});
			}
		}

		// If no exact match, check for partial matches
		if (matches.length > 0) {
			const bestMatch = matches[0];
			return res.json({
				success: true,
				found: true,
				participant: {
					id: bestMatch.id,
					name: bestMatch.name,
					seed: null,
					checkedIn: false
				},
				partial: true
			});
		}

		// No match found
		return res.json({
			success: true,
			found: false,
			message: 'No registration found for that name'
		});

	} catch (error) {
		console.error('Lookup error:', error.message);
		res.status(500).json({
			success: false,
			found: false,
			error: 'Failed to lookup participant',
			message: error.message
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
	console.log(`Tournament Signup app listening on port ${PORT}`);
	console.log(`Access at: http://localhost:${PORT}`);
	console.log(`Production URL: https://signup.despairhardware.com`);
});
