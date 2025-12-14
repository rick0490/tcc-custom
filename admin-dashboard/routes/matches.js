/**
 * Matches Routes - TCC-Custom
 *
 * Match management API endpoints using local database.
 * Replaces Challonge API integration with custom bracket progression.
 */

const express = require('express');
const router = express.Router();
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:matches');

// Local services
const tournamentDb = require('../services/tournament-db');
const matchDb = require('../services/match-db');
const participantDb = require('../services/participant-db');
const bracketEngine = require('../services/bracket-engine');

// Dependencies injected via init()
let activityLogger = null;
let pushNotifications = null;
let io = null;
let discordNotify = null;
let recordMatchChange = null;

/**
 * Initialize matches routes with dependencies
 */
function init(deps) {
    activityLogger = deps.activityLogger;
    pushNotifications = deps.pushNotifications;
    io = deps.io;
    recordMatchChange = deps.recordMatchChange;
}

/**
 * Set Discord notification service (called after init when discordNotify is available)
 */
function setDiscordNotify(service) {
    discordNotify = service;
}

// Helper to get user info from request
function getUserInfo(req) {
    return {
        userId: req.session?.userId || req.tokenUserId || 0,
        username: req.session?.username || req.tokenUsername || 'API'
    };
}

// Helper to broadcast match updates
// Emits both events:
// - 'match:updated' for single match changes (admin dashboard pages)
// - 'matches:update' with full array (match display + command center)
function broadcastMatchUpdate(tournamentId, data) {
    if (io) {
        // Emit single-match event for admin pages
        io.emit('match:updated', { tournamentId, ...data });

        // Also emit full matches array for match display and command center
        const matches = matchDb.getByTournament(tournamentId);
        const transformedMatches = matches.map(m => transformMatch(m));
        io.emit('matches:update', {
            tournamentId,
            matches: transformedMatches,
            match: data.match  // Include single match for incremental updates
        });
    }
}

// Helper to get tournament by ID or slug
function getTournament(tournamentId) {
    return isNaN(tournamentId)
        ? tournamentDb.getBySlug(tournamentId)
        : tournamentDb.getById(parseInt(tournamentId));
}

// ============================================
// GET /api/matches/:tournamentId - Get all matches
// ============================================
router.get('/:tournamentId', async (req, res) => {
    try {
        const tournament = getTournament(req.params.tournamentId);

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        // Calculate metadata
        const completedCount = matches.filter(m => m.state === 'complete').length;
        const totalMatches = matches.filter(m => !m.is_bye).length;
        const progressPercent = totalMatches > 0 ? Math.round((completedCount / totalMatches) * 100) : 0;

        // Find next match
        const nextMatch = matchDb.findNextMatch(tournament.id);

        res.json({
            success: true,
            matches: matches.map(m => transformMatch(m)),
            metadata: {
                tournamentId: tournament.url_slug,
                tournamentName: tournament.name,
                state: tournament.state,
                totalMatches,
                completedCount,
                progressPercent,
                nextMatchId: nextMatch?.id || null,
                nextMatchPlayers: nextMatch ? `${nextMatch.player1_name || 'TBD'} vs ${nextMatch.player2_name || 'TBD'}` : null
            },
            source: 'local'
        });
    } catch (error) {
        logger.error('list', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET /api/matches/:tournamentId/stats - Get match statistics
// ============================================
router.get('/:tournamentId/stats', async (req, res) => {
    try {
        const tournament = getTournament(req.params.tournamentId);

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const stats = matchDb.getStats(tournament.id);

        res.json({
            success: true,
            stats: {
                total: stats.total,
                pending: stats.pending,
                open: stats.open,
                underway: stats.underway,
                complete: stats.complete,
                progressPercent: stats.total > 0 ? Math.round((stats.complete / stats.total) * 100) : 0
            }
        });
    } catch (error) {
        logger.error('stats', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET /api/matches/:tournamentId/:matchId - Get single match
// ============================================
router.get('/:tournamentId/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params;
        const match = matchDb.getById(parseInt(matchId));

        if (!match) {
            return res.status(404).json({
                success: false,
                error: 'Match not found'
            });
        }

        res.json({
            success: true,
            match: transformMatch(match)
        });
    } catch (error) {
        logger.error('get', error, { matchId: req.params.matchId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/matches/:tournamentId/:matchId/underway - Mark match as underway
// ============================================
router.post('/:tournamentId/:matchId/underway', async (req, res) => {
    try {
        const { matchId } = req.params;
        const match = matchDb.getById(parseInt(matchId));

        if (!match) {
            return res.status(404).json({
                success: false,
                error: 'Match not found'
            });
        }

        if (match.state !== 'open') {
            return res.status(400).json({
                success: false,
                error: `Cannot mark match as underway: match is ${match.state}`
            });
        }

        const updatedMatch = matchDb.markUnderway(match.id);
        const user = getUserInfo(req);

        logger.log('underway', {
            matchId: match.id,
            identifier: updatedMatch.identifier,
            player1: updatedMatch.player1_name,
            player2: updatedMatch.player2_name,
            user: user.username
        });

        // Log activity
        if (activityLogger) {
            activityLogger.log('MATCH_STARTED', {
                matchId: match.id,
                identifier: updatedMatch.identifier,
                player1: updatedMatch.player1_name,
                player2: updatedMatch.player2_name,
                station: updatedMatch.station_name
            }, user.username);
        }

        // Broadcast update
        broadcastMatchUpdate(match.tournament_id, {
            action: 'underway',
            match: transformMatch(updatedMatch)
        });

        res.json({
            success: true,
            match: transformMatch(updatedMatch)
        });
    } catch (error) {
        console.error('[Matches] Mark underway error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/matches/:tournamentId/:matchId/unmark-underway - Unmark match as underway
// ============================================
router.post('/:tournamentId/:matchId/unmark-underway', async (req, res) => {
    try {
        const { matchId } = req.params;
        const match = matchDb.getById(parseInt(matchId));

        if (!match) {
            return res.status(404).json({
                success: false,
                error: 'Match not found'
            });
        }

        if (!match.underway_at) {
            return res.status(400).json({
                success: false,
                error: 'Match is not marked as underway'
            });
        }

        const updatedMatch = matchDb.unmarkUnderway(match.id);
        const user = getUserInfo(req);

        console.log(`[Matches] Unmarked underway: ${updatedMatch.identifier} by ${user.username}`);

        // Broadcast update
        broadcastMatchUpdate(match.tournament_id, {
            action: 'unmark_underway',
            match: transformMatch(updatedMatch)
        });

        res.json({
            success: true,
            match: transformMatch(updatedMatch)
        });
    } catch (error) {
        console.error('[Matches] Unmark underway error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/matches/:tournamentId/:matchId/score - Set match scores
// ============================================
router.post('/:tournamentId/:matchId/score', async (req, res) => {
    try {
        const { matchId } = req.params;
        const { player1Score, player2Score, winnerId } = req.body;

        const match = matchDb.getById(parseInt(matchId));

        if (!match) {
            return res.status(404).json({
                success: false,
                error: 'Match not found'
            });
        }

        if (match.state === 'complete') {
            return res.status(400).json({
                success: false,
                error: 'Match is already complete. Reopen it first to change scores.'
            });
        }

        // Determine winner from scores if not explicitly provided
        let actualWinnerId = winnerId;
        if (!actualWinnerId) {
            const p1Score = parseInt(player1Score) || 0;
            const p2Score = parseInt(player2Score) || 0;

            if (p1Score > p2Score) {
                actualWinnerId = match.player1_id;
            } else if (p2Score > p1Score) {
                actualWinnerId = match.player2_id;
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Scores are tied. Please specify a winner.'
                });
            }
        }

        const user = getUserInfo(req);

        // Record match state before change (for undo functionality)
        if (recordMatchChange) {
            recordMatchChange(
                match.tournament_id.toString(),
                match.id,
                { state: match.state, winnerId: match.winner_id, scores: match.scores_csv },
                'score_recorded',
                user.username
            );
        }

        const updatedMatch = matchDb.setWinner(match.id, actualWinnerId, {
            player1_score: parseInt(player1Score) || 0,
            player2_score: parseInt(player2Score) || 0,
            scores_csv: `${player1Score || 0}-${player2Score || 0}`
        });

        console.log(`[Matches] Score recorded: ${updatedMatch.identifier} ${player1Score}-${player2Score} by ${user.username}`);

        // Log activity
        if (activityLogger) {
            activityLogger.log('MATCH_COMPLETED', {
                matchId: match.id,
                identifier: updatedMatch.identifier,
                winner: updatedMatch.winner_name,
                score: `${player1Score}-${player2Score}`
            }, user.username);
        }

        // Send push notification
        if (pushNotifications) {
            pushNotifications.sendNotification({
                title: 'Match Complete',
                body: `${updatedMatch.player1_name} vs ${updatedMatch.player2_name}: ${player1Score}-${player2Score}`,
                type: 'match_completed'
            });
        }

        // Broadcast update
        broadcastMatchUpdate(match.tournament_id, {
            action: 'score',
            match: transformMatch(updatedMatch)
        });

        // Check if tournament is now complete
        const tournament = tournamentDb.getById(match.tournament_id);
        const allMatches = matchDb.getByTournament(tournament.id);
        const isComplete = bracketEngine.isTournamentComplete(
            tournament.tournament_type,
            allMatches,
            { totalRounds: tournament.swiss_rounds }
        );

        res.json({
            success: true,
            match: transformMatch(updatedMatch),
            tournamentComplete: isComplete
        });
    } catch (error) {
        console.error('[Matches] Score error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/matches/:tournamentId/:matchId/winner - Declare winner directly
// ============================================
router.post('/:tournamentId/:matchId/winner', async (req, res) => {
    try {
        const { matchId } = req.params;
        const { winnerId, player1Score, player2Score } = req.body;

        const match = matchDb.getById(parseInt(matchId));

        if (!match) {
            return res.status(404).json({
                success: false,
                error: 'Match not found'
            });
        }

        if (!winnerId) {
            return res.status(400).json({
                success: false,
                error: 'Winner ID is required'
            });
        }

        if (match.state === 'complete') {
            return res.status(400).json({
                success: false,
                error: 'Match is already complete'
            });
        }

        // Pass scores only if provided (null otherwise for winner-only declaration)
        const scores = {};
        if (player1Score !== undefined) scores.player1_score = parseInt(player1Score);
        if (player2Score !== undefined) scores.player2_score = parseInt(player2Score);

        const user = getUserInfo(req);

        // Record match state before change (for undo functionality)
        if (recordMatchChange) {
            recordMatchChange(
                match.tournament_id.toString(),
                match.id,
                { state: match.state, winnerId: match.winner_id, scores: match.scores_csv },
                'winner_declared',
                user.username
            );
        }

        const updatedMatch = matchDb.setWinner(match.id, parseInt(winnerId), scores);

        console.log(`[Matches] Winner declared: ${updatedMatch.identifier} -> ${updatedMatch.winner_name} by ${user.username}`);

        // Log activity
        if (activityLogger) {
            activityLogger.log('MATCH_COMPLETED', {
                matchId: match.id,
                identifier: updatedMatch.identifier,
                winner: updatedMatch.winner_name
            }, user.username);
        }

        // Broadcast update
        broadcastMatchUpdate(match.tournament_id, {
            action: 'winner',
            match: transformMatch(updatedMatch)
        });

        // Send Discord notification
        if (discordNotify) {
            const tournament = tournamentDb.getById(match.tournament_id);
            if (tournament) {
                discordNotify.notifyMatchComplete(tournament.user_id, updatedMatch, tournament).catch(err => {
                    logger.error('discordNotifyMatchComplete', err, { matchId: match.id });
                });
            }
        }

        res.json({
            success: true,
            match: transformMatch(updatedMatch)
        });
    } catch (error) {
        console.error('[Matches] Winner error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/matches/:tournamentId/:matchId/reopen - Reopen completed match
// ============================================
router.post('/:tournamentId/:matchId/reopen', async (req, res) => {
    try {
        const { matchId } = req.params;
        const match = matchDb.getById(parseInt(matchId));

        if (!match) {
            return res.status(404).json({
                success: false,
                error: 'Match not found'
            });
        }

        const updatedMatch = matchDb.reopen(match.id);
        const user = getUserInfo(req);

        console.log(`[Matches] Reopened: ${updatedMatch.identifier} by ${user.username}`);

        // Log activity
        if (activityLogger) {
            activityLogger.log('MATCH_REOPENED', {
                matchId: match.id,
                identifier: updatedMatch.identifier
            }, user.username);
        }

        // Broadcast update
        broadcastMatchUpdate(match.tournament_id, {
            action: 'reopen',
            match: transformMatch(updatedMatch)
        });

        res.json({
            success: true,
            match: transformMatch(updatedMatch)
        });
    } catch (error) {
        console.error('[Matches] Reopen error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/matches/:tournamentId/:matchId/dq - DQ/Forfeit a player
// ============================================
router.post('/:tournamentId/:matchId/dq', async (req, res) => {
    try {
        const { matchId } = req.params;
        const { participantId } = req.body;

        const match = matchDb.getById(parseInt(matchId));

        if (!match) {
            return res.status(404).json({
                success: false,
                error: 'Match not found'
            });
        }

        if (!participantId) {
            return res.status(400).json({
                success: false,
                error: 'Participant ID is required'
            });
        }

        const updatedMatch = matchDb.setForfeit(match.id, parseInt(participantId));
        const user = getUserInfo(req);

        // Get DQ'd player name
        const dqPlayer = match.player1_id === parseInt(participantId)
            ? match.player1_name
            : match.player2_name;

        console.log(`[Matches] DQ: ${dqPlayer} in ${updatedMatch.identifier} by ${user.username}`);

        // Log activity
        if (activityLogger) {
            activityLogger.log('PLAYER_DQ', {
                matchId: match.id,
                identifier: updatedMatch.identifier,
                player: dqPlayer
            }, user.username);
        }

        // Broadcast update
        broadcastMatchUpdate(match.tournament_id, {
            action: 'dq',
            match: transformMatch(updatedMatch)
        });

        res.json({
            success: true,
            match: transformMatch(updatedMatch)
        });
    } catch (error) {
        console.error('[Matches] DQ error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/matches/:tournamentId/:matchId/station - Assign station
// ============================================
router.post('/:tournamentId/:matchId/station', async (req, res) => {
    try {
        const { matchId } = req.params;
        const { stationId } = req.body;

        const match = matchDb.getById(parseInt(matchId));

        if (!match) {
            return res.status(404).json({
                success: false,
                error: 'Match not found'
            });
        }

        const updatedMatch = stationId
            ? matchDb.setStation(match.id, parseInt(stationId))
            : matchDb.clearStation(match.id);

        // Auto-mark as underway when assigning to a station (if not already underway)
        if (stationId && !match.underway_at) {
            matchDb.markUnderway(match.id);
            // Re-fetch to get updated underway_at for response
            Object.assign(updatedMatch, matchDb.getById(match.id));
        }

        const user = getUserInfo(req);

        console.log(`[Matches] Station ${stationId ? 'assigned' : 'cleared'}: ${updatedMatch.identifier} by ${user.username}`);

        // Broadcast update
        broadcastMatchUpdate(match.tournament_id, {
            action: 'station',
            match: transformMatch(updatedMatch)
        });

        res.json({
            success: true,
            match: transformMatch(updatedMatch)
        });
    } catch (error) {
        console.error('[Matches] Station error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/matches/:tournamentId/:matchId/clear-scores - Clear scores without reopening
// ============================================
router.post('/:tournamentId/:matchId/clear-scores', async (req, res) => {
    try {
        const { matchId } = req.params;
        const match = matchDb.getById(parseInt(matchId));

        if (!match) {
            return res.status(404).json({
                success: false,
                error: 'Match not found'
            });
        }

        // Can only clear scores on complete matches
        if (match.state !== 'complete') {
            return res.status(400).json({
                success: false,
                error: 'Match is not complete'
            });
        }

        // Reopen is the same as clearing scores for local DB
        const updatedMatch = matchDb.reopen(match.id);
        const user = getUserInfo(req);

        console.log(`[Matches] Scores cleared: ${updatedMatch.identifier} by ${user.username}`);

        // Broadcast update
        broadcastMatchUpdate(match.tournament_id, {
            action: 'clear_scores',
            match: transformMatch(updatedMatch)
        });

        res.json({
            success: true,
            match: transformMatch(updatedMatch)
        });
    } catch (error) {
        console.error('[Matches] Clear scores error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/matches/:tournamentId/batch-scores - Batch score entry
// ============================================
router.post('/:tournamentId/batch-scores', async (req, res) => {
    try {
        const tournament = getTournament(req.params.tournamentId);

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const { scores } = req.body;

        if (!Array.isArray(scores) || scores.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Scores array is required'
            });
        }

        const results = [];
        const user = getUserInfo(req);

        for (const entry of scores) {
            const { matchId, winnerId, score1, score2 } = entry;

            try {
                const match = matchDb.getById(parseInt(matchId));

                if (!match) {
                    results.push({
                        matchId,
                        success: false,
                        error: 'Match not found'
                    });
                    continue;
                }

                if (match.state === 'complete') {
                    results.push({
                        matchId,
                        success: false,
                        error: 'Match already complete'
                    });
                    continue;
                }

                const updatedMatch = matchDb.setWinner(match.id, parseInt(winnerId), {
                    player1_score: parseInt(score1) || 0,
                    player2_score: parseInt(score2) || 0
                });

                results.push({
                    matchId,
                    success: true,
                    match: transformMatch(updatedMatch)
                });
            } catch (matchError) {
                results.push({
                    matchId,
                    success: false,
                    error: matchError.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;

        console.log(`[Matches] Batch scores: ${successCount}/${scores.length} by ${user.username}`);

        // Log activity
        if (activityLogger && successCount > 0) {
            activityLogger.log('BATCH_SCORES', {
                tournamentId: tournament.id,
                count: successCount
            }, user.username);
        }

        // Broadcast update
        broadcastMatchUpdate(tournament.id, {
            action: 'batch_scores',
            count: successCount
        });

        res.json({
            success: true,
            results,
            summary: {
                total: scores.length,
                succeeded: successCount,
                failed: scores.length - successCount
            }
        });
    } catch (error) {
        console.error('[Matches] Batch scores error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /:tournamentId/auto-assign - Trigger auto-assign stations
// ============================================
router.post('/:tournamentId/auto-assign', async (req, res) => {
    try {
        const tournament = getTournament(req.params.tournamentId);
        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const assignments = matchDb.autoAssignStations(tournament.id);

        if (assignments.length > 0) {
            // Broadcast update
            broadcastMatchUpdate(tournament.id, {
                action: 'auto_assign',
                assignments
            });
        }

        res.json({
            success: true,
            assigned: assignments.length,
            assignments
        });
    } catch (error) {
        console.error('[Matches] Auto-assign error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// Helper: Transform match for API response
// ============================================
function transformMatch(m) {
    return {
        id: m.id,
        tournamentId: m.tournament_id,
        identifier: m.identifier,
        round: m.round,
        state: m.state,
        player1Id: m.player1_id,
        player2Id: m.player2_id,
        player1Name: m.player1_name || 'TBD',
        player2Name: m.player2_name || 'TBD',
        player1Seed: m.player1_seed,
        player2Seed: m.player2_seed,
        winnerId: m.winner_id,
        loserId: m.loser_id,
        winnerName: m.winner_name,
        player1Score: m.player1_score,
        player2Score: m.player2_score,
        scoresCsv: m.scores_csv,
        forfeited: !!m.forfeited,
        stationId: m.station_id,
        stationName: m.station_name,
        suggestedPlayOrder: m.suggested_play_order,
        bracketPosition: m.bracket_position,
        losersBracket: !!m.losers_bracket,
        underwayAt: m.underway_at,
        completedAt: m.completed_at,
        isUnderway: !!m.underway_at && m.state !== 'complete',
        source: 'local'
    };
}

// Export
router.init = init;
router.setDiscordNotify = setDiscordNotify;
module.exports = router;
