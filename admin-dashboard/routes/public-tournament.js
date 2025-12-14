/**
 * Public Tournament Routes (tcc-custom)
 *
 * Public API endpoints for tournament signup PWA.
 * No authentication required - these are meant to be called by
 * the tournament signup service running on port 3001.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:public-tournament');

// Rate limiting for signup (simple in-memory)
const signupAttempts = new Map();
const MAX_SIGNUP_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function checkSignupRateLimit(ip) {
	const now = Date.now();
	const attempts = signupAttempts.get(ip) || { count: 0, firstAttempt: now };

	// Reset if window expired
	if (now - attempts.firstAttempt > WINDOW_MS) {
		attempts.count = 0;
		attempts.firstAttempt = now;
	}

	if (attempts.count >= MAX_SIGNUP_ATTEMPTS) {
		const retryAfter = Math.ceil((attempts.firstAttempt + WINDOW_MS - now) / 1000);
		return { allowed: false, retryAfter };
	}

	return { allowed: true };
}

function recordSignupAttempt(ip) {
	const now = Date.now();
	const attempts = signupAttempts.get(ip) || { count: 0, firstAttempt: now };

	if (now - attempts.firstAttempt > WINDOW_MS) {
		attempts.count = 1;
		attempts.firstAttempt = now;
	} else {
		attempts.count++;
	}

	signupAttempts.set(ip, attempts);
}

// References set by init
let tournamentDb = null;
let participantDb = null;
let io = null;

/**
 * Initialize the routes with dependencies
 */
function init({ tournamentDb: tDb, participantDb: pDb, io: socketIo }) {
	tournamentDb = tDb;
	participantDb = pDb;
	io = socketIo;
}

/**
 * Helper to read tournament state file
 */
async function readStateFile() {
	const stateFilePath = process.env.MATCH_STATE_FILE ||
		'/root/tcc-custom/admin-dashboard/tournament-state.json';

	try {
		const data = await fs.readFile(stateFilePath, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		logger.log('state-file:not-found', { path: stateFilePath });
		return null;
	}
}

/**
 * GET /api/public/tournament
 * Get current deployed tournament info (public - no auth)
 */
router.get('/tournament', async (req, res) => {
	try {
		const stateFile = await readStateFile();

		if (!stateFile || !stateFile.tournamentDbId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		// Get tournament from database using the DB ID
		const tournament = tournamentDb.getById(stateFile.tournamentDbId);

		if (!tournament) {
			return res.status(404).json({
				success: false,
				error: 'Tournament not found in database'
			});
		}

		// Get participant count
		const participants = participantDb.getByTournament(tournament.id) || [];
		const participantsCount = participants.length;

		// Parse format settings for signup cap
		let signupCap = null;
		try {
			const formatSettings = tournament.format_settings_json ?
				(typeof tournament.format_settings_json === 'string' ?
					JSON.parse(tournament.format_settings_json) : tournament.format_settings_json) : {};
			signupCap = formatSettings.signupCap || tournament.signup_cap || null;
		} catch (e) {
			// Ignore parse errors
		}

		logger.log('tournament:get', {
			id: tournament.id,
			name: tournament.name,
			state: tournament.state,
			participantsCount
		});

		res.json({
			success: true,
			tournament: {
				id: tournament.id,
				name: tournament.name,
				urlSlug: tournament.url_slug,
				gameName: stateFile.gameName || tournament.game_name || '',
				state: tournament.state || 'pending',
				participantsCount: participantsCount,
				startAt: tournament.starts_at,
				signupCap: signupCap,
				bracketUrl: stateFile.bracketUrl || null,
				registrationOpen: tournament.state === 'pending',
				registrationReason: tournament.state !== 'pending' ? 'tournament_started' : null,
				isFull: signupCap ? participantsCount >= signupCap : false
			}
		});

	} catch (error) {
		logger.error('tournament:get:error', error);
		res.status(500).json({
			success: false,
			error: 'Failed to fetch tournament information'
		});
	}
});

/**
 * GET /api/public/participants
 * Get participant names for duplicate checking (public - no auth)
 */
router.get('/participants', async (req, res) => {
	try {
		const stateFile = await readStateFile();

		if (!stateFile || !stateFile.tournamentDbId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const participants = participantDb.getByTournament(stateFile.tournamentDbId) || [];

		// Return only names for privacy (no email, misc, etc.)
		const participantNames = participants.map(p => ({
			id: p.id,
			name: p.name || p.display_name
		}));

		res.json({
			success: true,
			participants: participantNames
		});

	} catch (error) {
		logger.error('participants:get:error', error);
		res.status(500).json({
			success: false,
			error: 'Failed to fetch participants'
		});
	}
});

/**
 * GET /api/public/participants/lookup
 * Check if a name is already registered (public - no auth)
 */
router.get('/participants/lookup', async (req, res) => {
	try {
		const { name } = req.query;

		if (!name || !name.trim()) {
			return res.status(400).json({
				success: false,
				found: false,
				error: 'Name parameter is required'
			});
		}

		const stateFile = await readStateFile();

		if (!stateFile || !stateFile.tournamentDbId) {
			return res.status(404).json({
				success: false,
				found: false,
				error: 'No active tournament configured'
			});
		}

		const participants = participantDb.getByTournament(stateFile.tournamentDbId) || [];
		const searchName = name.trim().toLowerCase();

		// Exact match (case-insensitive)
		const exactMatch = participants.find(p =>
			(p.name || p.display_name || '').toLowerCase() === searchName
		);

		if (exactMatch) {
			// Get tournament state to determine if we should include match info
			const tournament = tournamentDb.getById(stateFile.tournamentDbId);
			const tournamentState = tournament?.state || 'pending';

			// Build enhanced participant response
			const participantData = {
				id: exactMatch.id,
				name: exactMatch.name || exactMatch.display_name,
				seed: exactMatch.seed,
				checkedIn: exactMatch.checked_in === 1,
				registeredAt: exactMatch.created_at
			};

			// If tournament is underway, include current match info
			if (tournamentState === 'underway' || tournamentState === 'awaiting_review') {
				const matchDb = require('../services/match-db');
				const allMatches = matchDb.getByTournament(stateFile.tournamentDbId) || [];

				// Find participant's current or next match
				const participantId = exactMatch.id;
				const currentMatch = allMatches.find(m =>
					(m.player1_id === participantId || m.player2_id === participantId) &&
					(m.state === 'underway' || m.state === 'open')
				);

				if (currentMatch) {
					// Get opponent name
					const opponentId = currentMatch.player1_id === participantId
						? currentMatch.player2_id
						: currentMatch.player1_id;
					const opponent = participants.find(p => p.id === opponentId);

					participantData.currentMatch = {
						id: currentMatch.id,
						round: currentMatch.round,
						state: currentMatch.state,
						opponent: opponent ? (opponent.name || opponent.display_name) : 'TBD',
						station: currentMatch.station_id ? `Station ${currentMatch.station_id}` : null
					};
				}

				// Check if participant is eliminated
				const isEliminated = allMatches.some(m =>
					m.loser_id === participantId && m.state === 'complete'
				) && !allMatches.some(m =>
					(m.player1_id === participantId || m.player2_id === participantId) &&
					(m.state === 'pending' || m.state === 'open' || m.state === 'underway')
				);

				participantData.isEliminated = isEliminated;

				// Get win/loss record
				const wins = allMatches.filter(m => m.winner_id === participantId && m.state === 'complete').length;
				const losses = allMatches.filter(m => m.loser_id === participantId && m.state === 'complete').length;
				participantData.record = { wins, losses };
			}

			return res.json({
				success: true,
				found: true,
				participant: participantData,
				tournamentState: tournamentState
			});
		}

		// Partial match
		const partialMatches = participants.filter(p =>
			(p.name || p.display_name || '').toLowerCase().includes(searchName) ||
			searchName.includes((p.name || p.display_name || '').toLowerCase())
		);

		if (partialMatches.length > 0) {
			const bestMatch = partialMatches[0];
			const tournament = tournamentDb.getById(stateFile.tournamentDbId);
			const tournamentState = tournament?.state || 'pending';

			const participantData = {
				id: bestMatch.id,
				name: bestMatch.name || bestMatch.display_name,
				seed: bestMatch.seed,
				checkedIn: bestMatch.checked_in === 1,
				registeredAt: bestMatch.created_at
			};

			return res.json({
				success: true,
				found: true,
				participant: participantData,
				tournamentState: tournamentState,
				partial: true
			});
		}

		res.json({
			success: true,
			found: false,
			message: 'No registration found for that name'
		});

	} catch (error) {
		logger.error('participants:lookup:error', error);
		res.status(500).json({
			success: false,
			found: false,
			error: 'Failed to lookup participant'
		});
	}
});

/**
 * POST /api/public/signup
 * Add a participant to the current tournament (public - no auth)
 */
router.post('/signup', async (req, res) => {
	const clientIp = req.ip || req.connection?.remoteAddress;

	// Rate limiting
	const rateLimit = checkSignupRateLimit(clientIp);
	if (!rateLimit.allowed) {
		return res.status(429).json({
			success: false,
			error: `Too many signup attempts. Please try again in ${rateLimit.retryAfter} seconds.`
		});
	}

	try {
		const { participantName, instagram, misc: notesFromRequest } = req.body;

		if (!participantName || !participantName.trim()) {
			return res.status(400).json({
				success: false,
				error: 'Participant name is required'
			});
		}

		const trimmedName = participantName.trim();

		// Validate name length
		if (trimmedName.length > 50) {
			return res.status(400).json({
				success: false,
				error: 'Name must be 50 characters or less'
			});
		}

		const stateFile = await readStateFile();

		if (!stateFile || !stateFile.tournamentDbId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournament = tournamentDb.getById(stateFile.tournamentDbId);

		if (!tournament) {
			return res.status(404).json({
				success: false,
				error: 'Tournament not found'
			});
		}

		// Check if tournament is still accepting signups
		if (tournament.state !== 'pending') {
			return res.status(403).json({
				success: false,
				error: 'Tournament has already started. Registration is closed.',
				reason: 'tournament_started'
			});
		}

		// Get existing participants
		const participants = participantDb.getByTournament(tournament.id) || [];

		// Check signup cap
		let signupCap = null;
		try {
			const formatSettings = tournament.format_settings_json ?
				(typeof tournament.format_settings_json === 'string' ?
					JSON.parse(tournament.format_settings_json) : tournament.format_settings_json) : {};
			signupCap = formatSettings.signupCap || tournament.signup_cap || null;
		} catch (e) {
			// Ignore parse errors
		}

		if (signupCap && participants.length >= signupCap) {
			return res.status(403).json({
				success: false,
				error: `Tournament is full (${signupCap}/${signupCap} participants)`,
				reason: 'tournament_full'
			});
		}

		// Check for duplicate name (case-insensitive)
		const normalizedName = trimmedName.toLowerCase();
		const existingParticipant = participants.find(p =>
			(p.name || p.display_name || '').toLowerCase() === normalizedName
		);

		if (existingParticipant) {
			recordSignupAttempt(clientIp);
			return res.status(400).json({
				success: false,
				error: `"${existingParticipant.name || existingParticipant.display_name}" is already registered. Please use a different name.`,
				reason: 'duplicate_name'
			});
		}

		// Build misc field with Instagram and notes if provided
		let miscParts = [];
		if (instagram) {
			const cleanInstagram = instagram.trim().replace(/^@/, '');
			if (cleanInstagram) {
				miscParts.push(`Instagram: @${cleanInstagram}`);
			}
		}
		if (notesFromRequest && typeof notesFromRequest === 'string') {
			const trimmedNotes = notesFromRequest.trim();
			if (trimmedNotes && trimmedNotes.length <= 200) {
				miscParts.push(trimmedNotes);
			}
		}
		const misc = miscParts.join('\n');

		// Create participant
		const newParticipant = participantDb.create(tournament.id, {
			name: trimmedName,
			display_name: trimmedName,
			misc: misc || null,
			seed: participants.length + 1, // Auto-seed at end
			active: 1,
			checked_in: 0
		});

		logger.log('signup:success', {
			tournamentId: tournament.id,
			participantId: newParticipant.id,
			name: trimmedName,
			instagram: instagram ? `@${instagram.replace(/^@/, '')}` : null
		});

		// Broadcast WebSocket update if available
		if (io) {
			io.emit('participant:added', {
				tournamentId: tournament.id,
				participant: {
					id: newParticipant.id,
					name: trimmedName
				}
			});
		}

		res.json({
			success: true,
			participant: {
				id: newParticipant.id,
				name: trimmedName,
				seed: newParticipant.seed || participants.length + 1
			}
		});

	} catch (error) {
		logger.error('signup:error', error);
		recordSignupAttempt(clientIp);
		res.status(500).json({
			success: false,
			error: 'Failed to complete signup'
		});
	}
});

/**
 * POST /api/public/waitlist
 * Join the waitlist for a full tournament (public - no auth)
 */
router.post('/waitlist', async (req, res) => {
	try {
		const { name, email } = req.body;

		if (!name || !name.trim()) {
			return res.status(400).json({
				success: false,
				error: 'Name is required'
			});
		}

		const trimmedName = name.trim();

		// Validate name length
		if (trimmedName.length > 50) {
			return res.status(400).json({
				success: false,
				error: 'Name must be 50 characters or less'
			});
		}

		const stateFile = await readStateFile();

		if (!stateFile || !stateFile.tournamentDbId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournament = tournamentDb.getById(stateFile.tournamentDbId);

		if (!tournament) {
			return res.status(404).json({
				success: false,
				error: 'Tournament not found'
			});
		}

		// Get database for waitlist operations
		const tournamentsDb = require('../db/tournaments-db');
		const db = tournamentsDb.getDb();

		// Check if already on waitlist (case-insensitive)
		const existingEntry = db.prepare(`
			SELECT * FROM tcc_waitlist
			WHERE tournament_id = ? AND LOWER(name) = LOWER(?) AND status = 'waiting'
		`).get(tournament.id, trimmedName);

		if (existingEntry) {
			return res.json({
				success: true,
				alreadyOnWaitlist: true,
				position: existingEntry.position,
				message: `You're already on the waitlist at position #${existingEntry.position}`
			});
		}

		// Check if already registered as participant
		const participants = participantDb.getByTournament(tournament.id) || [];
		const existingParticipant = participants.find(p =>
			(p.name || p.display_name || '').toLowerCase() === trimmedName.toLowerCase()
		);

		if (existingParticipant) {
			return res.status(400).json({
				success: false,
				error: 'You are already registered for this tournament'
			});
		}

		// Get current max position
		const maxPosition = db.prepare(`
			SELECT COALESCE(MAX(position), 0) as max_pos FROM tcc_waitlist
			WHERE tournament_id = ? AND status = 'waiting'
		`).get(tournament.id);

		const newPosition = (maxPosition.max_pos || 0) + 1;

		// Add to waitlist
		const result = db.prepare(`
			INSERT INTO tcc_waitlist (tournament_id, name, email, position, status)
			VALUES (?, ?, ?, ?, 'waiting')
		`).run(tournament.id, trimmedName, email || null, newPosition);

		logger.log('waitlist:joined', {
			tournamentId: tournament.id,
			name: trimmedName,
			position: newPosition
		});

		// Get total waitlist size
		const totalWaiting = db.prepare(`
			SELECT COUNT(*) as count FROM tcc_waitlist
			WHERE tournament_id = ? AND status = 'waiting'
		`).get(tournament.id);

		res.json({
			success: true,
			position: newPosition,
			totalWaiting: totalWaiting.count,
			message: `You've been added to the waitlist at position #${newPosition}`
		});

	} catch (error) {
		logger.error('waitlist:join:error', error);
		res.status(500).json({
			success: false,
			error: 'Failed to join waitlist'
		});
	}
});

/**
 * GET /api/public/waitlist
 * Check waitlist status for a name (public - no auth)
 */
router.get('/waitlist', async (req, res) => {
	try {
		const { name } = req.query;

		if (!name || !name.trim()) {
			return res.status(400).json({
				success: false,
				error: 'Name parameter is required'
			});
		}

		const stateFile = await readStateFile();

		if (!stateFile || !stateFile.tournamentDbId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournamentsDb = require('../db/tournaments-db');
		const db = tournamentsDb.getDb();

		// Find entry on waitlist (case-insensitive)
		const entry = db.prepare(`
			SELECT * FROM tcc_waitlist
			WHERE tournament_id = ? AND LOWER(name) = LOWER(?)
			ORDER BY created_at DESC LIMIT 1
		`).get(stateFile.tournamentDbId, name.trim());

		if (!entry) {
			return res.json({
				success: true,
				onWaitlist: false,
				message: 'Not found on waitlist'
			});
		}

		// Get total waiting count
		const totalWaiting = db.prepare(`
			SELECT COUNT(*) as count FROM tcc_waitlist
			WHERE tournament_id = ? AND status = 'waiting'
		`).get(stateFile.tournamentDbId);

		res.json({
			success: true,
			onWaitlist: true,
			status: entry.status,
			position: entry.status === 'waiting' ? entry.position : null,
			totalWaiting: totalWaiting.count,
			joinedAt: entry.created_at,
			promotedAt: entry.promoted_at
		});

	} catch (error) {
		logger.error('waitlist:check:error', error);
		res.status(500).json({
			success: false,
			error: 'Failed to check waitlist status'
		});
	}
});

/**
 * DELETE /api/public/waitlist
 * Leave the waitlist (public - no auth)
 */
router.delete('/waitlist', async (req, res) => {
	try {
		const { name } = req.body;

		if (!name || !name.trim()) {
			return res.status(400).json({
				success: false,
				error: 'Name is required'
			});
		}

		const stateFile = await readStateFile();

		if (!stateFile || !stateFile.tournamentDbId) {
			return res.status(404).json({
				success: false,
				error: 'No active tournament configured'
			});
		}

		const tournamentsDb = require('../db/tournaments-db');
		const db = tournamentsDb.getDb();

		// Update status to 'removed'
		const result = db.prepare(`
			UPDATE tcc_waitlist
			SET status = 'removed'
			WHERE tournament_id = ? AND LOWER(name) = LOWER(?) AND status = 'waiting'
		`).run(stateFile.tournamentDbId, name.trim());

		if (result.changes === 0) {
			return res.status(404).json({
				success: false,
				error: 'Not found on waitlist'
			});
		}

		// Recalculate positions for remaining waitlist entries
		const waitingEntries = db.prepare(`
			SELECT id FROM tcc_waitlist
			WHERE tournament_id = ? AND status = 'waiting'
			ORDER BY position ASC
		`).all(stateFile.tournamentDbId);

		waitingEntries.forEach((entry, index) => {
			db.prepare(`
				UPDATE tcc_waitlist SET position = ? WHERE id = ?
			`).run(index + 1, entry.id);
		});

		logger.log('waitlist:left', {
			tournamentId: stateFile.tournamentDbId,
			name: name.trim()
		});

		res.json({
			success: true,
			message: 'Successfully removed from waitlist'
		});

	} catch (error) {
		logger.error('waitlist:leave:error', error);
		res.status(500).json({
			success: false,
			error: 'Failed to leave waitlist'
		});
	}
});

// ==================== PUSH NOTIFICATION ENDPOINTS ====================

// In-memory push subscription storage for signup PWA
// In production, this would use the same database table as admin dashboard
const signupPushSubscriptions = new Map();

/**
 * GET /api/public/push/vapid-public-key
 * Get VAPID public key for push notification subscription (public - no auth)
 */
router.get('/push/vapid-public-key', (req, res) => {
	const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;

	if (!VAPID_PUBLIC_KEY) {
		logger.warn('push:vapid-key:not-configured', { message: 'VAPID public key not configured' });
		return res.json({
			success: false,
			error: 'Push notifications not configured on server'
		});
	}

	logger.log('push:vapid-key:served', { keyLength: VAPID_PUBLIC_KEY.length });

	res.json({
		success: true,
		publicKey: VAPID_PUBLIC_KEY
	});
});

/**
 * POST /api/public/push/subscribe
 * Subscribe to push notifications from signup PWA
 */
router.post('/push/subscribe', async (req, res) => {
	try {
		const { subscription, source, notificationTypes } = req.body;

		if (!subscription || !subscription.endpoint) {
			return res.status(400).json({
				success: false,
				error: 'Invalid push subscription'
			});
		}

		// Store subscription with metadata
		const subscriptionData = {
			subscription,
			source: source || 'signup-pwa',
			notificationTypes: notificationTypes || ['registration_open', 'tournament_starting'],
			subscribedAt: new Date().toISOString()
		};

		signupPushSubscriptions.set(subscription.endpoint, subscriptionData);

		logger.log('push:subscribed', {
			source,
			types: notificationTypes,
			totalSubscriptions: signupPushSubscriptions.size
		});

		res.json({
			success: true,
			message: 'Successfully subscribed to notifications'
		});
	} catch (error) {
		logger.error('push:subscribe:error', error);
		res.status(500).json({
			success: false,
			error: 'Failed to subscribe'
		});
	}
});

/**
 * DELETE /api/public/push/unsubscribe
 * Unsubscribe from push notifications
 */
router.delete('/push/unsubscribe', async (req, res) => {
	try {
		const { endpoint } = req.body;

		if (!endpoint) {
			return res.status(400).json({
				success: false,
				error: 'Endpoint is required'
			});
		}

		const existed = signupPushSubscriptions.delete(endpoint);

		logger.log('push:unsubscribed', {
			existed,
			totalSubscriptions: signupPushSubscriptions.size
		});

		res.json({
			success: true,
			message: existed ? 'Unsubscribed successfully' : 'Subscription not found'
		});
	} catch (error) {
		logger.error('push:unsubscribe:error', error);
		res.status(500).json({
			success: false,
			error: 'Failed to unsubscribe'
		});
	}
});

/**
 * Get all signup PWA push subscriptions (for internal use)
 * This is used by the notification service to send push notifications
 */
function getSignupPushSubscriptions() {
	return signupPushSubscriptions;
}

// Export both router, init function, and subscription getter
router.init = init;
router.getSignupPushSubscriptions = getSignupPushSubscriptions;
module.exports = router;
