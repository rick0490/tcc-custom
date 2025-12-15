/**
 * Participants Routes (tcc-custom)
 *
 * Participant management API endpoints using local database.
 * Replaces Challonge API calls with local participant-db service.
 * Includes Always-Live Displays support for bracket preview updates.
 */

const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../middleware/auth');
const { createLogger } = require('../services/debug-logger');
const {
    NotFoundError,
    ValidationError,
    ConflictError
} = require('../services/error-handler');
const { asyncHandler } = require('../middleware/error-handler');
const activeTournamentService = require('../services/active-tournament');

const logger = createLogger('routes:participants');

// References set by init
let participantDb = null;
let tournamentDb = null;
let readStateFile = null;
let io = null;
let discordNotify = null;

// WebSocket event types
const WS_EVENTS = {
	PARTICIPANT_ADDED: 'participant:added',
	PARTICIPANT_UPDATED: 'participant:updated',
	PARTICIPANT_DELETED: 'participant:deleted',
	PARTICIPANT_CHECKIN: 'participant:checkin',
	PARTICIPANTS_BULK: 'participants:bulk',
	PARTICIPANTS_SEEDED: 'participants:seeded'
};

/**
 * Broadcast participant event via WebSocket
 */
function broadcastParticipant(eventType, tournamentId, data = {}) {
	if (io) {
		io.emit(eventType, { tournamentId, ...data });
		// Also emit generic update for pages that want to know when to refresh
		io.emit('participants:update', { tournamentId, action: eventType, ...data });
	}
}

/**
 * Always-Live Displays: Broadcast bracket preview when participants change
 * This sends updated participant list to displays so they can show a preview
 * Only broadcasts if the tournament is the user's active tournament
 * @param {Object} tournament - Tournament object
 */
function broadcastBracketPreviewIfActive(tournament) {
	if (!io || !tournament || !tournament.user_id) return;

	// Only broadcast for pending tournaments (preview mode)
	// Underway tournaments use match polling for updates
	if (tournament.state !== 'pending' && tournament.state !== 'checking_in') {
		return;
	}

	// Check if this is the user's active tournament
	const activeResult = activeTournamentService.getActiveTournament(tournament.user_id);
	if (!activeResult.tournament || activeResult.tournament.id !== tournament.id) {
		return;
	}

	try {
		// Get current participants
		const participants = participantDb.getByTournament(tournament.id);

		// Broadcast bracket preview to user's displays
		io.to(`user:${tournament.user_id}`).emit('tournament:preview', {
			tournament: {
				id: tournament.id,
				url_slug: tournament.url_slug,
				name: tournament.name,
				game_name: tournament.game_name,
				tournament_type: tournament.tournament_type,
				state: tournament.state
			},
			participants: participants.map(p => ({
				id: p.id,
				name: p.name || p.display_name,
				seed: p.seed,
				checkedIn: p.checked_in
			})),
			participantCount: participants.length,
			mode: activeResult.mode,
			timestamp: new Date().toISOString()
		});

		logger.log('broadcastBracketPreview', {
			userId: tournament.user_id,
			tournamentId: tournament.id,
			participantCount: participants.length
		});
	} catch (error) {
		logger.error('broadcastBracketPreview', error, { tournamentId: tournament?.id });
	}
}

/**
 * Initialize the participants routes with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.participantDb - Participant database service
 * @param {Object} options.tournamentDb - Tournament database service
 * @param {Function} options.readStateFile - Function to read state files
 * @param {Object} options.io - Socket.IO instance
 */
function init({ participantDb: pDb, tournamentDb: tDb, readStateFile: readFn, io: socketIo }) {
	participantDb = pDb;
	tournamentDb = tDb;
	readStateFile = readFn;
	io = socketIo;
}

/**
 * Set Discord notification service (called after init when discordNotify is available)
 */
function setDiscordNotify(service) {
	discordNotify = service;
}

/**
 * Helper to get tournament ID from state file
 */
async function getTournamentId() {
	const matchState = await readStateFile(process.env.MATCH_STATE_FILE);
	if (!matchState || !matchState.tournamentId) {
		return null;
	}
	return matchState.tournamentId;
}

/**
 * Helper to extract Instagram from misc field
 */
function extractInstagram(misc) {
	if (!misc) return '';
	const match = misc.match(/Instagram:\s*@?([a-zA-Z0-9._]+)/i);
	return match ? match[1] : '';
}

/**
 * Helper to build misc field with Instagram
 */
function buildMiscField(instagram, existingMisc = '') {
	// Ensure existingMisc is always a string
	const misc = existingMisc || '';

	if (!instagram) {
		// Remove Instagram from misc field if no instagram provided
		return misc.replace(/Instagram:\s*@?[a-zA-Z0-9._]+\n?/gi, '').trim();
	}

	const cleanInstagram = instagram.replace(/^@/, '').trim();
	if (misc.match(/Instagram:/i)) {
		return misc.replace(/Instagram:\s*@?[a-zA-Z0-9._]+/i, `Instagram: @${cleanInstagram}`);
	} else {
		return misc ? `Instagram: @${cleanInstagram}\n${misc}` : `Instagram: @${cleanInstagram}`;
	}
}

// ============================================
// PARTICIPANT MANAGEMENT API ENDPOINTS
// ============================================

/**
 * GET /api/participants/stats
 * Get participant stats (lightweight endpoint for dashboard)
 */
router.get('/stats', asyncHandler(async (req, res) => {
	const tournamentId = await getTournamentId();
	if (!tournamentId) {
		throw new NotFoundError('Active tournament', 'none configured');
	}

	// Get tournament and participants from local DB
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	const participants = participantDb.getByTournament(tournament.id);

	// Calculate stats
	const totalParticipants = participants.length;
	let withInstagram = 0;
	let latestSignupTime = null;

	participants.forEach(p => {
		// Check if has Instagram
		if (p.instagram || (p.misc && p.misc.match(/Instagram:/i))) {
			withInstagram++;
		}

		// Track latest signup
		if (p.created_at) {
			const createdDate = new Date(p.created_at);
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
			id: tournament.id,
			name: tournament.name,
			gameName: tournament.game_name,
			state: tournament.state,
			url: tournament.url_slug,
			startedAt: tournament.started_at,
			completedAt: tournament.completed_at
		},
		stats: {
			totalParticipants: totalParticipants,
			withInstagram: withInstagram,
			withoutInstagram: totalParticipants - withInstagram,
			instagramPercentage: instagramPercentage,
			latestSignupTime: latestSignupTime
		},
		requestId: req.requestId
	});
}));

/**
 * GET /api/participants
 * Get all participants from active tournament
 */
router.get('/', asyncHandler(async (req, res) => {
	const tournamentId = await getTournamentId();
	if (!tournamentId) {
		throw new NotFoundError('Active tournament', 'none configured');
	}

	// Get tournament and participants from local DB
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	const participantsRaw = participantDb.getByTournament(tournament.id);

	// Process participants to extract Instagram from misc field
	const participants = participantsRaw.map(p => ({
		id: p.id,
		tournamentId: p.tournament_id,
		name: p.name || p.display_name || 'Unknown',
		seed: p.seed,
		instagram: p.instagram || extractInstagram(p.misc),
		misc: p.misc || '',
		finalRank: p.final_rank,
		checkedIn: !!p.checked_in,
		checkedInAt: p.checked_in_at,
		createdAt: p.created_at
	}));

	// Sort by seed
	participants.sort((a, b) => (a.seed || 999) - (b.seed || 999));

	res.json({
		success: true,
		tournamentId: tournamentId,
		tournament: {
			id: tournament.id,
			name: tournament.name,
			gameName: tournament.game_name,
			state: tournament.state,
			participantsCount: participants.length,
			url: tournament.url_slug
		},
		participants: participants,
		count: participants.length,
		requestId: req.requestId
	});
}));

/**
 * GET /api/participants/:tournamentId
 * Get participants for a specific tournament
 */
router.get('/:tournamentId', asyncHandler(async (req, res) => {
	const { tournamentId } = req.params;

	// Get tournament and participants from local DB
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	const participantsRaw = participantDb.getByTournament(tournament.id);

	// Process participants
	const participants = participantsRaw.map(p => ({
		id: p.id,
		tournamentId: p.tournament_id,
		name: p.name || p.display_name || 'Unknown',
		seed: p.seed,
		instagram: p.instagram || extractInstagram(p.misc),
		misc: p.misc || '',
		finalRank: p.final_rank,
		checkedIn: !!p.checked_in,
		checkedInAt: p.checked_in_at,
		active: !!p.active,
		createdAt: p.created_at
	}));

	// Sort by seed
	participants.sort((a, b) => (a.seed || 999) - (b.seed || 999));

	res.json({
		success: true,
		tournamentId: tournament.id,
		tournament: {
			id: tournament.id,
			name: tournament.name,
			gameName: tournament.game_name,
			state: tournament.state,
			participantsCount: participants.length,
			url: tournament.url_slug
		},
		participants: participants,
		count: participants.length,
		requestId: req.requestId
	});
}));

/**
 * POST /api/participants
 * Add a new participant to active tournament
 */
router.post('/', asyncHandler(async (req, res) => {
	const { participantName, instagram, misc } = req.body;

	if (!participantName) {
		throw new ValidationError('Participant name is required');
	}

	const tournamentId = await getTournamentId();
	if (!tournamentId) {
		throw new NotFoundError('Active tournament', 'none configured');
	}

	// Check tournament state
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	if (tournament.state !== 'pending') {
		throw new ConflictError('Cannot add participants to a tournament that has already started');
	}

	// Build misc field with Instagram
	const miscField = buildMiscField(instagram, misc);

	// Create participant in local DB (use numeric tournament.id for FK constraint)
	const participant = participantDb.create(tournament.id, {
		name: participantName.trim(),
		instagram: instagram ? instagram.replace(/^@/, '').trim() : null,
		misc: miscField
	});

	res.json({
		success: true,
		message: 'Participant added successfully',
		participant: {
			id: participant.id,
			name: participant.name,
			seed: participant.seed,
			instagram: participant.instagram || ''
		},
		requestId: req.requestId
	});
}));

/**
 * POST /api/participants/:tournamentId
 * Add a new participant to a specific tournament
 */
router.post('/:tournamentId', asyncHandler(async (req, res) => {
	const { tournamentId } = req.params;
	const { participantName, name, instagram, misc, email, seed } = req.body;

	const playerName = participantName || name;
	if (!playerName) {
		throw new ValidationError('Participant name is required');
	}

	// Check tournament state
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	if (tournament.state !== 'pending') {
		throw new ConflictError('Cannot add participants to a tournament that has already started');
	}

	// Check signup cap
	if (tournament.signup_cap) {
		const currentCount = participantDb.getByTournament(tournament.id).length;
		if (currentCount >= tournament.signup_cap) {
			throw new ConflictError('Tournament has reached its signup cap');
		}
	}

	// Build misc field with Instagram
	const miscField = buildMiscField(instagram, misc);

	// Create participant in local DB (use numeric tournament.id for FK constraint)
	const participant = participantDb.create(tournament.id, {
		name: playerName.trim(),
		instagram: instagram ? instagram.replace(/^@/, '').trim() : null,
		email: email || null,
		seed: seed || null,
		misc: miscField
	});

	// Broadcast participant added
	broadcastParticipant(WS_EVENTS.PARTICIPANT_ADDED, tournament.id, {
		participant: {
			id: participant.id,
			name: participant.name,
			seed: participant.seed
		}
	});

	// Always-Live Displays: Broadcast bracket preview if this is the active tournament
	broadcastBracketPreviewIfActive(tournament);

	// Send Discord notification
	if (discordNotify) {
		discordNotify.notifyParticipantSignup(tournament.user_id, participant, tournament).catch(err => {
			logger.error('discordNotifySignup', err, { participantId: participant.id });
		});
	}

	res.json({
		success: true,
		message: 'Participant added successfully',
		participant: {
			id: participant.id,
			name: participant.name,
			seed: participant.seed,
			instagram: participant.instagram || ''
		},
		requestId: req.requestId
	});
}));

/**
 * PUT /api/participants/:tournamentId/:id
 * Update a participant
 */
router.put('/:tournamentId/:id', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId, id } = req.params;
	const { participantName, name, instagram, misc, seed, email } = req.body;

	const playerName = participantName || name;
	if (!playerName) {
		throw new ValidationError('Participant name is required');
	}

	// Look up tournament by ID or slug
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	// Verify participant exists and belongs to tournament
	const existing = participantDb.getById(id);
	if (!existing || existing.tournament_id !== tournament.id) {
		throw new NotFoundError('Participant', id);
	}

	// Build misc field
	const miscField = buildMiscField(instagram, misc || existing.misc);

	// Prepare update data
	const updateData = {
		name: playerName.trim(),
		misc: miscField
	};

	if (instagram !== undefined) {
		updateData.instagram = instagram ? instagram.replace(/^@/, '').trim() : null;
	}

	if (email !== undefined) {
		updateData.email = email;
	}

	if (seed !== undefined && seed !== null) {
		updateData.seed = parseInt(seed);
	}

	// Update participant
	const updated = participantDb.update(id, updateData);

	// Broadcast update
	broadcastParticipant(WS_EVENTS.PARTICIPANT_UPDATED, tournamentId, {
		participant: { id: updated.id, name: updated.name, seed: updated.seed }
	});

	// Always-Live Displays: Broadcast bracket preview if this is the active tournament
	broadcastBracketPreviewIfActive(tournament);

	res.json({
		success: true,
		message: 'Participant updated successfully',
		participant: {
			id: updated.id,
			name: updated.name,
			seed: updated.seed,
			instagram: updated.instagram || ''
		},
		requestId: req.requestId
	});
}));

/**
 * POST /api/participants/:tournamentId/randomize
 * Randomize all participant seeds
 */
router.post('/:tournamentId/randomize', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId } = req.params;

	// Check tournament state
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	if (tournament.state !== 'pending') {
		throw new ConflictError('Cannot randomize seeds after tournament has started');
	}

	// Randomize seeds in local DB (use numeric tournament.id)
	const participants = participantDb.randomizeSeeds(tournament.id);

	// Broadcast seeding change
	broadcastParticipant(WS_EVENTS.PARTICIPANTS_SEEDED, tournament.id, {
		action: 'randomized',
		count: participants.length
	});

	// Always-Live Displays: Broadcast bracket preview if this is the active tournament
	broadcastBracketPreviewIfActive(tournament);

	res.json({
		success: true,
		message: 'Participant seeds randomized successfully',
		participants: participants.map(p => ({
			id: p.id,
			name: p.name,
			seed: p.seed
		})),
		requestId: req.requestId
	});
}));

/**
 * POST /api/participants/:tournamentId/snake-draft
 * Apply snake draft seeding pattern
 */
router.post('/:tournamentId/snake-draft', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId } = req.params;
	const { teamCount = 2 } = req.body;

	// Check tournament state
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	if (tournament.state !== 'pending') {
		throw new ConflictError('Cannot apply snake draft after tournament has started');
	}

	// Validate team count
	const teams = parseInt(teamCount);
	if (isNaN(teams) || teams < 2 || teams > 8) {
		throw new ValidationError('Team count must be between 2 and 8');
	}

	// Apply snake draft seeding
	const participants = participantDb.applySnakeDraftSeeding(tournament.id, teams);

	// Broadcast seeding change
	broadcastParticipant(WS_EVENTS.PARTICIPANTS_SEEDED, tournament.id, {
		action: 'snake_draft',
		teamCount: teams,
		count: participants.length
	});

	// Always-Live Displays: Broadcast bracket preview if this is the active tournament
	broadcastBracketPreviewIfActive(tournament);

	res.json({
		success: true,
		message: `Snake draft seeding applied with ${teams} teams`,
		participants: participants.map(p => ({
			id: p.id,
			name: p.name,
			seed: p.seed
		})),
		requestId: req.requestId
	});
}));

/**
 * POST /api/participants/:tournamentId/previous-tournament-seeding
 * Apply seeding based on previous tournament results
 */
router.post('/:tournamentId/previous-tournament-seeding', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId } = req.params;
	const { previousTournamentId } = req.body;

	// Check current tournament state
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	if (tournament.state !== 'pending') {
		throw new ConflictError('Cannot apply seeding after tournament has started');
	}

	// Validate previous tournament ID
	if (!previousTournamentId) {
		throw new ValidationError('Previous tournament ID is required');
	}

	// Check previous tournament exists and is complete
	const previousTournament = tournamentDb.getById(previousTournamentId) || tournamentDb.getBySlug(previousTournamentId);
	if (!previousTournament) {
		throw new NotFoundError('Previous tournament', previousTournamentId);
	}

	if (previousTournament.state !== 'complete') {
		throw new ConflictError('Previous tournament must be completed to use for seeding');
	}

	// Apply previous tournament seeding
	const participants = participantDb.applyPreviousTournamentSeeding(tournament.id, previousTournament.id);

	// Broadcast seeding change
	broadcastParticipant(WS_EVENTS.PARTICIPANTS_SEEDED, tournament.id, {
		action: 'previous_tournament',
		previousTournamentId: previousTournament.id,
		previousTournamentName: previousTournament.name,
		count: participants.length
	});

	// Always-Live Displays: Broadcast bracket preview if this is the active tournament
	broadcastBracketPreviewIfActive(tournament);

	res.json({
		success: true,
		message: `Seeding applied from ${previousTournament.name}`,
		participants: participants.map(p => ({
			id: p.id,
			name: p.name,
			seed: p.seed
		})),
		requestId: req.requestId
	});
}));

/**
 * POST /api/participants/:tournamentId/swiss-pre-round-seeding
 * Apply seeding based on Swiss pre-round tournament results
 */
router.post('/:tournamentId/swiss-pre-round-seeding', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId } = req.params;
	const { swissTournamentId } = req.body;

	// Check current tournament state
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	if (tournament.state !== 'pending') {
		throw new ConflictError('Cannot apply seeding after tournament has started');
	}

	// Validate Swiss tournament ID
	if (!swissTournamentId) {
		throw new ValidationError('Swiss tournament ID is required');
	}

	// Check Swiss tournament exists
	const swissTournament = tournamentDb.getById(swissTournamentId) || tournamentDb.getBySlug(swissTournamentId);
	if (!swissTournament) {
		throw new NotFoundError('Swiss tournament', swissTournamentId);
	}

	// Verify it's a Swiss tournament or at least has completed matches
	if (swissTournament.tournament_type !== 'swiss') {
		throw new ValidationError('Source tournament must be a Swiss format tournament');
	}

	// Apply Swiss pre-round seeding
	const participants = participantDb.applySwissPreRoundSeeding(tournament.id, swissTournament.id);

	// Broadcast seeding change
	broadcastParticipant(WS_EVENTS.PARTICIPANTS_SEEDED, tournament.id, {
		action: 'swiss_pre_round',
		swissTournamentId: swissTournament.id,
		swissTournamentName: swissTournament.name,
		count: participants.length
	});

	// Always-Live Displays: Broadcast bracket preview if this is the active tournament
	broadcastBracketPreviewIfActive(tournament);

	res.json({
		success: true,
		message: `Seeding applied from Swiss pre-rounds (${swissTournament.name})`,
		participants: participants.map(p => ({
			id: p.id,
			name: p.name,
			seed: p.seed
		})),
		requestId: req.requestId
	});
}));

/**
 * POST /api/participants/:tournamentId/bulk
 * Bulk add participants
 */
router.post('/:tournamentId/bulk', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId } = req.params;
	const { participants } = req.body;

	if (!participants || !Array.isArray(participants) || participants.length === 0) {
		throw new ValidationError('Participants array is required');
	}

	// Check tournament state
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	if (tournament.state !== 'pending') {
		throw new ConflictError('Cannot add participants to a tournament that has already started');
	}

	// Check signup cap
	if (tournament.signup_cap) {
		const currentCount = participantDb.getByTournament(tournament.id).length;
		if (currentCount + participants.length > tournament.signup_cap) {
			throw new ConflictError(`Adding ${participants.length} participants would exceed signup cap of ${tournament.signup_cap}`);
		}
	}

	// Format participants for bulk add
	const formattedParticipants = participants.map(p => {
		if (typeof p === 'string') {
			return { name: p.trim() };
		}
		return {
			name: (p.name || p.participantName || '').trim(),
			instagram: p.instagram ? p.instagram.replace(/^@/, '').trim() : null,
			email: p.email || null,
			misc: p.misc || null
		};
	}).filter(p => p.name);

	// Bulk create in local DB (use numeric tournament.id for FK constraint)
	const created = participantDb.bulkCreate(tournament.id, formattedParticipants);

	// Broadcast bulk add
	broadcastParticipant(WS_EVENTS.PARTICIPANTS_BULK, tournament.id, {
		action: 'added',
		count: created.length
	});

	// Always-Live Displays: Broadcast bracket preview if this is the active tournament
	broadcastBracketPreviewIfActive(tournament);

	res.json({
		success: true,
		message: `Successfully added ${created.length} participants`,
		participants: created.map(p => ({
			id: p.id,
			name: p.name,
			seed: p.seed
		})),
		count: created.length,
		requestId: req.requestId
	});
}));

/**
 * DELETE /api/participants/:tournamentId/:id
 * Delete a participant
 */
router.delete('/:tournamentId/:id', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId, id } = req.params;

	// Look up tournament by ID or slug
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	// Verify participant exists and belongs to tournament
	const existing = participantDb.getById(id);
	if (!existing || existing.tournament_id !== tournament.id) {
		throw new NotFoundError('Participant', id);
	}

	// Check tournament state
	if (tournament.state !== 'pending') {
		throw new ConflictError('Cannot delete participants from a tournament that has already started');
	}

	// Delete participant
	participantDb.delete(id);

	// Broadcast deletion
	broadcastParticipant(WS_EVENTS.PARTICIPANT_DELETED, tournamentId, {
		participantId: id,
		name: existing.name
	});

	// Always-Live Displays: Broadcast bracket preview if this is the active tournament
	broadcastBracketPreviewIfActive(tournament);

	res.json({
		success: true,
		message: 'Participant deleted successfully',
		requestId: req.requestId
	});
}));

/**
 * DELETE /api/participants/:tournamentId/clear
 * Clear all participants from tournament
 */
router.delete('/:tournamentId/clear', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId } = req.params;

	// Check tournament state
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	if (tournament.state !== 'pending') {
		throw new ConflictError('Cannot clear participants from a tournament that has already started');
	}

	// Clear all participants
	const deleted = participantDb.clearAll(tournament.id);

	// Broadcast clear
	broadcastParticipant(WS_EVENTS.PARTICIPANTS_BULK, tournamentId, {
		action: 'cleared',
		count: deleted
	});

	// Always-Live Displays: Broadcast bracket preview if this is the active tournament
	broadcastBracketPreviewIfActive(tournament);

	res.json({
		success: true,
		message: `All ${deleted} participants cleared successfully`,
		requestId: req.requestId
	});
}));

/**
 * POST /api/participants/:tournamentId/:id/check-in
 * Check in a participant
 */
router.post('/:tournamentId/:id/check-in', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId, id } = req.params;

	// Look up tournament by ID or slug
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	// Verify participant exists and belongs to tournament
	const existing = participantDb.getById(id);
	if (!existing || existing.tournament_id !== tournament.id) {
		throw new NotFoundError('Participant', id);
	}

	// Check in participant
	const participant = participantDb.checkIn(id);

	// Broadcast check-in
	broadcastParticipant(WS_EVENTS.PARTICIPANT_CHECKIN, tournamentId, {
		participantId: id,
		name: participant.name,
		checkedIn: true
	});

	// Send Discord notification
	if (discordNotify) {
		discordNotify.notifyParticipantCheckin(tournament.user_id, participant, tournament).catch(err => {
			logger.error('discordNotifyCheckin', err, { participantId: participant.id });
		});
	}

	res.json({
		success: true,
		message: 'Participant checked in successfully',
		participant: {
			id: participant.id,
			name: participant.name,
			checkedIn: true,
			checkedInAt: participant.checked_in_at
		},
		requestId: req.requestId
	});
}));

/**
 * POST /api/participants/:tournamentId/:id/undo-check-in
 * Undo check-in for a participant
 */
router.post('/:tournamentId/:id/undo-check-in', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId, id } = req.params;

	// Look up tournament by ID or slug
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	// Verify participant exists and belongs to tournament
	const existing = participantDb.getById(id);
	if (!existing || existing.tournament_id !== tournament.id) {
		throw new NotFoundError('Participant', id);
	}

	// Undo check-in
	const participant = participantDb.undoCheckIn(id);

	// Broadcast check-in undo
	broadcastParticipant(WS_EVENTS.PARTICIPANT_CHECKIN, tournamentId, {
		participantId: id,
		name: participant.name,
		checkedIn: false
	});

	res.json({
		success: true,
		message: 'Check-in undone successfully',
		participant: {
			id: participant.id,
			name: participant.name,
			checkedIn: false,
			checkedInAt: null
		},
		requestId: req.requestId
	});
}));

/**
 * POST /api/participants/:tournamentId/apply-seeding
 * Apply Elo-based seeding suggestions
 */
router.post('/:tournamentId/apply-seeding', requireAuthAPI, asyncHandler(async (req, res) => {
	const { tournamentId } = req.params;
	const { gameId } = req.body;

	if (!gameId) {
		throw new ValidationError('Game ID is required for Elo-based seeding');
	}

	// Check tournament state
	const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
	if (!tournament) {
		throw new NotFoundError('Tournament', tournamentId);
	}

	if (tournament.state !== 'pending') {
		throw new ConflictError('Cannot modify seeds after tournament has started');
	}

	// Apply Elo-based seeding
	const participants = participantDb.applyEloSeeding(tournament.id, gameId);

	// Broadcast seeding change
	broadcastParticipant(WS_EVENTS.PARTICIPANTS_SEEDED, tournament.id, {
		action: 'elo_seeding',
		count: participants.length
	});

	// Always-Live Displays: Broadcast bracket preview if this is the active tournament
	broadcastBracketPreviewIfActive(tournament);

	res.json({
		success: true,
		message: 'Elo-based seeding applied successfully',
		participants: participants.map(p => ({
			id: p.id,
			name: p.name,
			seed: p.seed,
			elo: p.elo
		})),
		requestId: req.requestId
	});
}));

module.exports = router;
module.exports.init = init;
module.exports.setDiscordNotify = setDiscordNotify;
