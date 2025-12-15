/**
 * Bracket Editor Routes (tcc-custom)
 *
 * API endpoints for bracket preview and seeding management.
 * Generates preview brackets based on custom seed orders
 * and applies seed changes to participants.
 */

const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../middleware/auth');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:bracket-editor');

// References set by init
let tournamentDb = null;
let participantDb = null;
let matchDb = null;
let bracketEngine = null;
let bracketRenderer = null;
let io = null;

// WebSocket event types
const WS_EVENTS = {
	PARTICIPANTS_SEEDED: 'participants:seeded'
};

/**
 * Initialize the bracket-editor routes with dependencies
 * @param {Object} options - Configuration options
 */
function init({ tournamentDb: tDb, participantDb: pDb, matchDb: mDb, bracketEngine: engine, bracketRenderer: renderer, io: socketIo }) {
	tournamentDb = tDb;
	participantDb = pDb;
	matchDb = mDb;
	bracketEngine = engine;
	bracketRenderer = renderer;
	io = socketIo;
	logger.log('Bracket editor routes initialized');
}

/**
 * Helper to get tournament by ID or slug
 */
function getTournament(tournamentId) {
	const numId = parseInt(tournamentId);
	if (!isNaN(numId)) {
		return tournamentDb.getById(numId);
	}
	return tournamentDb.getBySlug(tournamentId);
}

/**
 * POST /api/bracket-editor/preview/:tournamentId
 * Generate bracket preview with custom seed order
 *
 * Body: { seedOrder: [participantId1, participantId2, ...] }
 * Returns: Visualization data for canvas rendering
 */
router.post('/preview/:tournamentId', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { seedOrder } = req.body;

		logger.log('Generating bracket preview', { tournamentId, seedOrderLength: seedOrder?.length });

		// Get tournament
		const tournament = getTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ error: 'Tournament not found' });
		}

		if (tournament.state !== 'pending') {
			return res.status(400).json({ error: 'Tournament has already started' });
		}

		// Get participants
		let participants = participantDb.getByTournament(tournament.id);

		if (participants.length < 2) {
			return res.status(400).json({ error: 'Need at least 2 participants to generate bracket' });
		}

		// Apply custom seed order if provided
		if (seedOrder && Array.isArray(seedOrder) && seedOrder.length > 0) {
			participants = participants.map(p => {
				const newSeed = seedOrder.indexOf(p.id) + 1;
				return { ...p, seed: newSeed > 0 ? newSeed : p.seed };
			});
		}

		// Sort by seed
		participants.sort((a, b) => (a.seed || 999) - (b.seed || 999));

		// Generate bracket matches (preview only, not saved)
		const bracket = bracketEngine.generate(tournament.tournament_type, participants, {});
		const matches = bracket.matches;

		// Generate visualization
		const visualization = bracketRenderer.generateVisualization(
			tournament.tournament_type,
			matches,
			participants,
			{ tournamentName: tournament.name }
		);

		logger.log('Preview generated', {
			tournamentId,
			type: visualization.type,
			matchCount: matches.length
		});

		res.json(visualization);

	} catch (error) {
		logger.error('Error generating bracket preview', error);
		res.status(500).json({ error: 'Failed to generate preview', details: error.message });
	}
});

/**
 * POST /api/bracket-editor/apply-seeds/:tournamentId
 * Apply seed changes to participants
 *
 * Body: { seeds: [{ participantId, seed }, ...] }
 */
router.post('/apply-seeds/:tournamentId', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;
		const { seeds } = req.body;

		logger.log('Applying seed changes', { tournamentId, seedCount: seeds?.length });

		// Get tournament
		const tournament = getTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ error: 'Tournament not found' });
		}

		if (tournament.state !== 'pending') {
			return res.status(400).json({ error: 'Cannot edit seeds after tournament starts' });
		}

		if (!seeds || !Array.isArray(seeds) || seeds.length === 0) {
			return res.status(400).json({ error: 'Invalid seeds data' });
		}

		// Update each participant's seed
		let updated = 0;
		let failed = 0;

		for (const { participantId, seed } of seeds) {
			try {
				participantDb.updateSeed(participantId, seed);
				updated++;
			} catch (err) {
				logger.error('Failed to update seed', { participantId, seed, error: err.message });
				failed++;
			}
		}

		// Broadcast update
		if (io) {
			const userId = req.session?.userId;
			if (userId) {
				io.to(`user:${userId}`).emit(WS_EVENTS.PARTICIPANTS_SEEDED, {
					tournamentId: tournament.id,
					updated,
					timestamp: Date.now()
				});
			}
			// Also emit generic participants update
			io.emit('participants:update', {
				tournamentId: tournament.id,
				action: 'seeded',
				updated
			});
		}

		logger.log('Seeds applied', { tournamentId, updated, failed });

		res.json({
			success: true,
			message: `Seeds updated successfully`,
			updated,
			failed
		});

	} catch (error) {
		logger.error('Error applying seeds', error);
		res.status(500).json({ error: 'Failed to apply seed changes', details: error.message });
	}
});

/**
 * GET /api/bracket-editor/status/:tournamentId
 * Get bracket editor status for a tournament
 */
router.get('/status/:tournamentId', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;

		const tournament = getTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ error: 'Tournament not found' });
		}

		const participants = participantDb.getByTournament(tournament.id);

		res.json({
			success: true,
			tournament: {
				id: tournament.id,
				name: tournament.name,
				state: tournament.state,
				type: tournament.tournament_type
			},
			participantCount: participants.length,
			canEdit: tournament.state === 'pending'
		});

	} catch (error) {
		logger.error('Error getting bracket editor status', error);
		res.status(500).json({ error: 'Failed to get status' });
	}
});

/**
 * GET /api/bracket-editor/live/:tournamentId
 * Get live bracket visualization from actual match data
 * Works for both pending and underway tournaments
 */
router.get('/live/:tournamentId', requireAuthAPI, async (req, res) => {
	try {
		const { tournamentId } = req.params;

		logger.log('Fetching live bracket', { tournamentId });

		// Get tournament
		const tournament = getTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ error: 'Tournament not found' });
		}

		// Get participants
		const participants = participantDb.getByTournament(tournament.id);

		// Get actual matches from database
		const matches = matchDb.getByTournament(tournament.id);

		if (!matches || matches.length === 0) {
			// No matches yet - return empty visualization
			return res.json({
				type: tournament.tournament_type,
				rounds: [],
				dimensions: { width: 0, height: 0 },
				empty: true
			});
		}

		// Generate visualization from actual match data
		const visualization = bracketRenderer.generateVisualization(
			tournament.tournament_type,
			matches,
			participants,
			{ tournamentName: tournament.name }
		);

		logger.log('Live bracket generated', {
			tournamentId,
			type: visualization.type,
			matchCount: matches.length
		});

		res.json(visualization);

	} catch (error) {
		logger.error('Error fetching live bracket', error);
		res.status(500).json({ error: 'Failed to fetch live bracket', details: error.message });
	}
});

module.exports = { router, init };
