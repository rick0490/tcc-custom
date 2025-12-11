/**
 * Tournaments Routes - TCC-Custom
 *
 * Tournament management API endpoints using local database.
 * Replaces Challonge API integration with custom bracket engine.
 */

const express = require('express');
const router = express.Router();

// Local services
const tournamentDb = require('../services/tournament-db');
const matchDb = require('../services/match-db');
const participantDb = require('../services/participant-db');
const bracketEngine = require('../services/bracket-engine');

// Dependencies injected via init()
let pushNotifications = null;
let io = null;

/**
 * Initialize tournaments routes with dependencies
 */
function init(deps) {
    pushNotifications = deps.pushNotifications;
    io = deps.io;
}

// Helper to broadcast tournament updates
function broadcastTournamentUpdate(tournamentId, data) {
    if (io) {
        io.emit('tournament:update', { tournamentId, ...data });
    }
}

// ============================================
// GET /api/tournaments - List all tournaments
// ============================================
router.get('/', async (req, res) => {
    try {
        const state = req.query.state;
        const gameId = req.query.game_id;
        const limit = parseInt(req.query.limit) || 100;

        const filters = { limit };

        if (state) {
            // Support comma-separated states
            filters.state = state.includes(',') ? state.split(',') : state;
        }

        if (gameId) {
            filters.game_id = parseInt(gameId);
        }

        const tournaments = tournamentDb.list(filters);

        res.json({
            success: true,
            tournaments: tournaments.map(t => transformTournament(t)),
            count: tournaments.length,
            source: 'local'
        });
    } catch (error) {
        console.error('[Tournaments] List error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/tournaments/create - Create tournament
// ============================================
router.post('/create', async (req, res) => {
    try {
        const {
            name,
            game_name,
            tournament_type = 'double_elimination',
            description,
            starts_at,
            signup_cap,
            open_signup,
            check_in_duration,
            hold_third_place_match,
            grand_finals_modifier,
            swiss_rounds,
            ranked_by,
            hide_seeds,
            sequential_pairings
        } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Tournament name is required'
            });
        }

        // Create tournament
        const tournament = tournamentDb.create({
            name,
            game_name,
            tournament_type,
            description,
            starts_at,
            signup_cap,
            open_signup: !!open_signup,
            check_in_duration,
            hold_third_place_match: !!hold_third_place_match,
            grand_finals_modifier,
            swiss_rounds,
            ranked_by,
            hide_seeds: !!hide_seeds,
            sequential_pairings: !!sequential_pairings
        });

        console.log(`[Tournaments] Created: ${tournament.name} (${tournament.url_slug})`);

        res.json({
            success: true,
            tournament: transformTournament(tournament),
            message: 'Tournament created successfully'
        });
    } catch (error) {
        console.error('[Tournaments] Create error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET /api/tournaments/:tournamentId - Get tournament details
// ============================================
router.get('/:tournamentId', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        // Support both numeric ID and URL slug
        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const stats = tournamentDb.getStats(tournament.id);

        res.json({
            success: true,
            tournament: transformTournament(tournament),
            stats
        });
    } catch (error) {
        console.error('[Tournaments] Get error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// PUT /api/tournaments/:tournamentId - Update tournament
// ============================================
router.put('/:tournamentId', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Only allow updates for pending tournaments
        if (tournament.state !== 'pending') {
            return res.status(400).json({
                success: false,
                error: `Cannot update tournament in ${tournament.state} state`
            });
        }

        const updatedTournament = tournamentDb.update(tournament.id, req.body);

        console.log(`[Tournaments] Updated: ${updatedTournament.name}`);

        res.json({
            success: true,
            tournament: transformTournament(updatedTournament)
        });
    } catch (error) {
        console.error('[Tournaments] Update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/tournaments/:tournamentId/start - Start tournament
// ============================================
router.post('/:tournamentId/start', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Check if can start
        const canStartResult = tournamentDb.canStart(tournament.id);
        if (!canStartResult.canStart) {
            return res.status(400).json({
                success: false,
                error: canStartResult.reason
            });
        }

        // Get participants
        const participants = participantDb.getActiveByTournament(tournament.id);

        // Generate bracket
        const bracket = bracketEngine.generate(tournament.tournament_type, participants, {
            hold_third_place_match: tournament.hold_third_place_match,
            grand_finals_modifier: tournament.grand_finals_modifier,
            sequential_pairings: tournament.sequential_pairings,
            swiss_rounds: tournament.swiss_rounds,
            ranked_by: tournament.ranked_by
        });

        // Create matches in database
        const matchIds = matchDb.bulkCreate(tournament.id, bracket.matches);

        // Update prereq match IDs (they were generated with temporary IDs)
        // Map temporary IDs to real IDs
        const idMap = {};
        bracket.matches.forEach((m, index) => {
            idMap[m.id] = matchIds[index];
        });

        // Update matches with real prereq IDs
        bracket.matches.forEach((m, index) => {
            if (m.player1_prereq_match_id !== null || m.player2_prereq_match_id !== null) {
                matchDb.updatePrereqs(matchIds[index], {
                    player1_prereq_match_id: m.player1_prereq_match_id !== null ? idMap[m.player1_prereq_match_id] : null,
                    player2_prereq_match_id: m.player2_prereq_match_id !== null ? idMap[m.player2_prereq_match_id] : null,
                    player1_is_prereq_loser: m.player1_is_prereq_loser,
                    player2_is_prereq_loser: m.player2_is_prereq_loser
                });
            }
        });

        // Update tournament state
        const updatedTournament = tournamentDb.updateState(tournament.id, 'underway');

        console.log(`[Tournaments] Started: ${updatedTournament.name} with ${matchIds.length} matches`);

        // Broadcast update
        broadcastTournamentUpdate(tournament.id, {
            action: 'started',
            tournament: transformTournament(updatedTournament),
            matchCount: matchIds.length
        });

        // Send push notification
        if (pushNotifications) {
            pushNotifications.sendNotification({
                title: 'Tournament Started',
                body: `${updatedTournament.name} has begun with ${participants.length} participants!`,
                type: 'tournament_started'
            });
        }

        res.json({
            success: true,
            tournament: transformTournament(updatedTournament),
            bracket: {
                type: bracket.type,
                matchCount: matchIds.length,
                stats: bracket.stats
            }
        });
    } catch (error) {
        console.error('[Tournaments] Start error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/tournaments/:tournamentId/reset - Reset tournament
// ============================================
router.post('/:tournamentId/reset', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const canResetResult = tournamentDb.canReset(tournament.id);
        if (!canResetResult.canReset) {
            return res.status(400).json({
                success: false,
                error: canResetResult.reason
            });
        }

        // Delete all matches
        const deletedMatches = matchDb.deleteByTournament(tournament.id);

        // Reset participant final ranks
        const participants = participantDb.getByTournament(tournament.id);
        participants.forEach(p => {
            participantDb.update(p.id, { final_rank: null });
        });

        // Reset tournament state
        const updatedTournament = tournamentDb.update(tournament.id, {
            state: 'pending',
            started_at: null,
            completed_at: null
        });

        console.log(`[Tournaments] Reset: ${updatedTournament.name} (${deletedMatches} matches deleted)`);

        // Broadcast update
        broadcastTournamentUpdate(tournament.id, {
            action: 'reset',
            tournament: transformTournament(updatedTournament)
        });

        res.json({
            success: true,
            tournament: transformTournament(updatedTournament),
            deletedMatches
        });
    } catch (error) {
        console.error('[Tournaments] Reset error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/tournaments/:tournamentId/complete - Finalize tournament
// ============================================
router.post('/:tournamentId/complete', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        if (tournament.state !== 'underway' && tournament.state !== 'awaiting_review') {
            return res.status(400).json({
                success: false,
                error: `Cannot complete tournament in ${tournament.state} state`
            });
        }

        // Check if all matches are complete
        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        const isComplete = bracketEngine.isTournamentComplete(
            tournament.tournament_type,
            matches,
            { totalRounds: tournament.swiss_rounds }
        );

        if (!isComplete) {
            return res.status(400).json({
                success: false,
                error: 'Not all matches are complete'
            });
        }

        // Calculate final ranks
        const ranks = bracketEngine.calculateFinalRanks(
            tournament.tournament_type,
            matches,
            participants
        );

        // Update participant final ranks
        participantDb.setFinalRanks(tournament.id, ranks);

        // Update tournament state
        const updatedTournament = tournamentDb.updateState(tournament.id, 'complete');

        console.log(`[Tournaments] Completed: ${updatedTournament.name}`);

        // Broadcast update
        broadcastTournamentUpdate(tournament.id, {
            action: 'completed',
            tournament: transformTournament(updatedTournament),
            rankings: ranks
        });

        // Send push notification
        if (pushNotifications) {
            // Get winner name
            const winnerId = Object.entries(ranks).find(([, rank]) => rank === 1)?.[0];
            const winner = participants.find(p => p.id === parseInt(winnerId));

            pushNotifications.sendNotification({
                title: 'Tournament Complete!',
                body: winner
                    ? `${updatedTournament.name} has ended. Winner: ${winner.name}!`
                    : `${updatedTournament.name} has been completed!`,
                type: 'tournament_ended'
            });
        }

        res.json({
            success: true,
            tournament: transformTournament(updatedTournament),
            rankings: ranks
        });
    } catch (error) {
        console.error('[Tournaments] Complete error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// DELETE /api/tournaments/:tournamentId - Delete tournament
// ============================================
router.delete('/:tournamentId', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const name = tournament.name;
        const deleted = tournamentDb.delete(tournament.id);

        if (!deleted) {
            return res.status(500).json({
                success: false,
                error: 'Failed to delete tournament'
            });
        }

        console.log(`[Tournaments] Deleted: ${name}`);

        // Broadcast update
        broadcastTournamentUpdate(tournament.id, {
            action: 'deleted',
            tournamentId: tournament.id
        });

        res.json({
            success: true,
            message: `Tournament "${name}" deleted successfully`
        });
    } catch (error) {
        console.error('[Tournaments] Delete error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET /api/tournaments/:tournamentId/bracket - Get bracket visualization data
// ============================================
router.get('/:tournamentId/bracket', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        const visualizationData = bracketEngine.getVisualizationData(
            tournament.tournament_type,
            matches,
            participants
        );

        res.json({
            success: true,
            tournament: {
                id: tournament.id,
                name: tournament.name,
                type: tournament.tournament_type,
                state: tournament.state
            },
            bracket: visualizationData
        });
    } catch (error) {
        console.error('[Tournaments] Bracket error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET /api/tournaments/:tournamentId/standings - Get current standings
// ============================================
router.get('/:tournamentId/standings', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        const standings = bracketEngine.getStandings(
            tournament.tournament_type,
            matches,
            participants,
            { rankedBy: tournament.ranked_by }
        );

        res.json({
            success: true,
            standings
        });
    } catch (error) {
        console.error('[Tournaments] Standings error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/tournaments/:tournamentId/swiss/next-round - Generate next Swiss round
// ============================================
router.post('/:tournamentId/swiss/next-round', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        if (tournament.tournament_type !== 'swiss') {
            return res.status(400).json({
                success: false,
                error: 'Tournament is not Swiss format'
            });
        }

        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        // Get current round number
        const currentRound = Math.max(...matches.map(m => m.round), 0);

        // Check if current round is complete
        if (!bracketEngine.isSwissRoundComplete(matches, currentRound)) {
            return res.status(400).json({
                success: false,
                error: `Round ${currentRound} is not complete yet`
            });
        }

        // Check if we've reached the max rounds
        const maxRounds = tournament.swiss_rounds || bracketEngine.swiss.recommendedRounds(participants.length);
        if (currentRound >= maxRounds) {
            return res.status(400).json({
                success: false,
                error: 'All Swiss rounds have been played'
            });
        }

        // Generate next round
        const nextRound = currentRound + 1;
        const newMatches = bracketEngine.generateSwissRound(matches, participants, nextRound);

        // Create matches in database
        const matchIds = matchDb.bulkCreate(tournament.id, newMatches);

        console.log(`[Tournaments] Swiss round ${nextRound} generated with ${matchIds.length} matches`);

        res.json({
            success: true,
            round: nextRound,
            matchCount: matchIds.length,
            matches: newMatches
        });
    } catch (error) {
        console.error('[Tournaments] Swiss next round error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// Helper: Transform tournament for API response
// ============================================
function transformTournament(t) {
    return {
        id: t.id,
        tournamentId: t.url_slug,
        name: t.name,
        description: t.description || '',
        game: t.game_name || '',
        state: t.state,
        tournamentType: t.tournament_type,
        participants: t.participants_count || 0,
        url: null, // No external URL for local tournaments
        startAt: t.starts_at,
        startedAt: t.started_at,
        completedAt: t.completed_at,
        createdAt: t.created_at,
        checkInDuration: t.check_in_duration,
        signupCap: t.signup_cap,
        openSignup: !!t.open_signup,
        holdThirdPlaceMatch: !!t.hold_third_place_match,
        grandFinalsModifier: t.grand_finals_modifier || '',
        sequentialPairings: !!t.sequential_pairings,
        showRounds: !!t.show_rounds,
        swissRounds: t.swiss_rounds || 0,
        rankedBy: t.ranked_by || 'match wins',
        hideSeeds: !!t.hide_seeds,
        privateTournament: !!t.private,
        source: 'local'
    };
}

// Export
router.init = init;
module.exports = router;
