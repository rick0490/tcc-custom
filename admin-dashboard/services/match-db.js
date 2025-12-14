/**
 * Match Database Service
 * Local match management with bracket progression - replaces Challonge API
 */

const tournamentsDb = require('../db/tournaments-db');
const { createLogger } = require('./debug-logger');

const logger = createLogger('match-db');

// Lazy-loaded to avoid circular dependencies
let tournamentDb = null;
let stationDb = null;

function getTournamentDb() {
    if (!tournamentDb) {
        tournamentDb = require('./tournament-db');
    }
    return tournamentDb;
}

function getStationDb() {
    if (!stationDb) {
        stationDb = require('./station-db');
    }
    return stationDb;
}

/**
 * Create a single match
 */
function create(tournamentId, matchData) {
    const db = tournamentsDb.getDb();

    const stmt = db.prepare(`
        INSERT INTO tcc_matches (
            tournament_id, identifier, round, suggested_play_order,
            bracket_position, losers_bracket,
            player1_id, player2_id,
            player1_prereq_match_id, player2_prereq_match_id,
            player1_is_prereq_loser, player2_is_prereq_loser,
            state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        tournamentId,
        matchData.identifier || null,
        matchData.round,
        matchData.suggested_play_order || null,
        matchData.bracket_position || null,
        matchData.losers_bracket ? 1 : 0,
        matchData.player1_id || null,
        matchData.player2_id || null,
        matchData.player1_prereq_match_id || null,
        matchData.player2_prereq_match_id || null,
        matchData.player1_is_prereq_loser ? 1 : 0,
        matchData.player2_is_prereq_loser ? 1 : 0,
        matchData.state || 'pending'
    );

    return getById(result.lastInsertRowid);
}

/**
 * Bulk create matches (for bracket generation)
 */
function bulkCreate(tournamentId, matches) {
    const logComplete = logger.start('bulkCreate', { tournamentId, count: matches.length });
    const db = tournamentsDb.getDb();

    const stmt = db.prepare(`
        INSERT INTO tcc_matches (
            tournament_id, identifier, round, suggested_play_order,
            bracket_position, losers_bracket,
            player1_id, player2_id,
            player1_prereq_match_id, player2_prereq_match_id,
            player1_is_prereq_loser, player2_is_prereq_loser,
            state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((matchList) => {
        const insertedIds = [];
        for (const m of matchList) {
            // Insert with prereq IDs as NULL - they use temporary IDs from bracket engine
            // that don't exist yet. The route will update them with real IDs after all
            // matches are inserted. This avoids foreign key constraint violations.
            const result = stmt.run(
                tournamentId,
                m.identifier || null,
                m.round,
                m.suggested_play_order || null,
                m.bracket_position || null,
                m.losers_bracket ? 1 : 0,
                m.player1_id || null,
                m.player2_id || null,
                null, // player1_prereq_match_id - set later via updatePrereqs
                null, // player2_prereq_match_id - set later via updatePrereqs
                m.player1_is_prereq_loser ? 1 : 0,
                m.player2_is_prereq_loser ? 1 : 0,
                m.state || 'pending'
            );
            insertedIds.push(result.lastInsertRowid);
        }
        return insertedIds;
    });

    const insertedIds = insertMany(matches);
    logComplete({ inserted: insertedIds.length, firstId: insertedIds[0], lastId: insertedIds[insertedIds.length - 1] });
    return insertedIds;
}

/**
 * Get match by ID with participant names
 */
function getById(id) {
    const db = tournamentsDb.getDb();

    const match = db.prepare(`
        SELECT m.*,
               p1.name as player1_name, p1.seed as player1_seed,
               p2.name as player2_name, p2.seed as player2_seed,
               w.name as winner_name,
               s.name as station_name
        FROM tcc_matches m
        LEFT JOIN tcc_participants p1 ON m.player1_id = p1.id
        LEFT JOIN tcc_participants p2 ON m.player2_id = p2.id
        LEFT JOIN tcc_participants w ON m.winner_id = w.id
        LEFT JOIN tcc_stations s ON m.station_id = s.id
        WHERE m.id = ?
    `).get(id);

    return match;
}

/**
 * Get all matches for a tournament
 */
function getByTournament(tournamentId, options = {}) {
    const db = tournamentsDb.getDb();

    let sql = `
        SELECT m.*,
               p1.name as player1_name, p1.seed as player1_seed,
               p2.name as player2_name, p2.seed as player2_seed,
               w.name as winner_name,
               s.name as station_name
        FROM tcc_matches m
        LEFT JOIN tcc_participants p1 ON m.player1_id = p1.id
        LEFT JOIN tcc_participants p2 ON m.player2_id = p2.id
        LEFT JOIN tcc_participants w ON m.winner_id = w.id
        LEFT JOIN tcc_stations s ON m.station_id = s.id
        WHERE m.tournament_id = ?
    `;

    const params = [tournamentId];

    if (options.state) {
        sql += ' AND m.state = ?';
        params.push(options.state);
    }

    if (options.round !== undefined) {
        sql += ' AND m.round = ?';
        params.push(options.round);
    }

    if (options.losers_bracket !== undefined) {
        sql += ' AND m.losers_bracket = ?';
        params.push(options.losers_bracket ? 1 : 0);
    }

    // Default sort by suggested_play_order, then round
    sql += ' ORDER BY COALESCE(m.suggested_play_order, 999999), ABS(m.round), m.id';

    return db.prepare(sql).all(...params);
}

/**
 * Get open matches (ready to play)
 */
function getOpenMatches(tournamentId) {
    return getByTournament(tournamentId, { state: 'open' });
}

/**
 * Get matches waiting for a prerequisite match to complete
 */
function getWaitingForPrereq(tournamentId, prereqMatchId) {
    const db = tournamentsDb.getDb();

    return db.prepare(`
        SELECT * FROM tcc_matches
        WHERE tournament_id = ?
        AND (player1_prereq_match_id = ? OR player2_prereq_match_id = ?)
    `).all(tournamentId, prereqMatchId, prereqMatchId);
}

/**
 * Set player for match slot
 */
function setPlayer(matchId, slot, participantId) {
    const db = tournamentsDb.getDb();

    if (slot !== 1 && slot !== 2) {
        throw new Error('Invalid slot. Must be 1 or 2.');
    }

    const field = slot === 1 ? 'player1_id' : 'player2_id';
    db.prepare(`UPDATE tcc_matches SET ${field} = ?, updated_at = ? WHERE id = ?`)
        .run(participantId, new Date().toISOString(), matchId);

    // Check if both players are now assigned
    const match = getById(matchId);
    if (match.player1_id && match.player2_id && match.state === 'pending') {
        // Auto-open the match
        updateState(matchId, 'open');
    }

    return getById(matchId);
}

/**
 * Update match state
 */
function updateState(matchId, newState) {
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    const updates = { state: newState, updated_at: now };

    if (newState === 'open') {
        // Don't set underway_at here - that's for when match actually starts
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE tcc_matches SET ${setClauses} WHERE id = ?`)
        .run(...Object.values(updates), matchId);

    return getById(matchId);
}

/**
 * Mark match as underway
 */
function markUnderway(matchId) {
    logger.log('markUnderway', { matchId });
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    db.prepare(`
        UPDATE tcc_matches
        SET state = 'underway', underway_at = ?, updated_at = ?
        WHERE id = ?
    `).run(now, now, matchId);

    const match = getById(matchId);
    logger.log('markUnderway:result', { matchId, identifier: match?.identifier, state: match?.state, underwayAt: match?.underway_at });
    return match;
}

/**
 * Unmark match as underway (return to open state)
 */
function unmarkUnderway(matchId) {
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    db.prepare(`
        UPDATE tcc_matches
        SET state = 'open', underway_at = NULL, updated_at = ?
        WHERE id = ?
    `).run(now, matchId);

    return getById(matchId);
}

/**
 * Set match winner and scores
 * This is the main function for completing a match
 */
function setWinner(matchId, winnerId, scores = {}) {
    const logComplete = logger.start('setWinner', { matchId, winnerId, scores });
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    const match = getById(matchId);
    if (!match) {
        logger.error('setWinner', new Error('Match not found'), { matchId });
        throw new Error('Match not found');
    }

    logger.log('setWinner:match', {
        matchId,
        identifier: match.identifier,
        round: match.round,
        player1: { id: match.player1_id, name: match.player1_name },
        player2: { id: match.player2_id, name: match.player2_name },
        state: match.state
    });

    // Determine loser
    let loserId;
    if (match.player1_id === winnerId) {
        loserId = match.player2_id;
    } else if (match.player2_id === winnerId) {
        loserId = match.player1_id;
    } else {
        logger.error('setWinner', new Error('Winner must be one of the match participants'), {
            matchId, winnerId, player1_id: match.player1_id, player2_id: match.player2_id
        });
        throw new Error('Winner must be one of the match participants');
    }

    logger.log('setWinner:determined', { winnerId, loserId, winnerName: winnerId === match.player1_id ? match.player1_name : match.player2_name });

    // Update match (use null for scores when not provided)
    db.prepare(`
        UPDATE tcc_matches
        SET winner_id = ?, loser_id = ?,
            player1_score = ?, player2_score = ?, scores_csv = ?,
            state = 'complete', completed_at = ?, updated_at = ?
        WHERE id = ?
    `).run(
        winnerId,
        loserId,
        scores.player1_score ?? null,
        scores.player2_score ?? null,
        scores.scores_csv || null,
        now,
        now,
        matchId
    );

    // Advance winner/loser to next matches
    advanceBracket(match.tournament_id, matchId, winnerId, loserId);

    // Clear station if assigned
    if (match.station_id) {
        db.prepare('UPDATE tcc_stations SET current_match_id = NULL WHERE id = ?')
            .run(match.station_id);
        logger.log('setWinner:clearedStation', { stationId: match.station_id });
    }

    // Try to auto-assign newly opened matches to available stations
    const autoAssigned = autoAssignStations(match.tournament_id);
    if (autoAssigned.length > 0) {
        logger.log('setWinner:autoAssigned', { count: autoAssigned.length, assignments: autoAssigned });
    }

    const result = getById(matchId);
    logComplete({ winnerId, loserId, state: result.state });
    return result;
}

/**
 * Set match as forfeit/DQ
 */
function setForfeit(matchId, forfeitedParticipantId) {
    const db = tournamentsDb.getDb();
    const match = getById(matchId);

    if (!match) {
        throw new Error('Match not found');
    }

    // Determine winner (the other player)
    let winnerId;
    if (match.player1_id === forfeitedParticipantId) {
        winnerId = match.player2_id;
    } else if (match.player2_id === forfeitedParticipantId) {
        winnerId = match.player1_id;
    } else {
        throw new Error('Forfeited participant must be in this match');
    }

    const now = new Date().toISOString();

    db.prepare(`
        UPDATE tcc_matches
        SET winner_id = ?, loser_id = ?,
            player1_score = 0, player2_score = 0,
            forfeited = 1, forfeited_participant_id = ?,
            state = 'complete', completed_at = ?, updated_at = ?
        WHERE id = ?
    `).run(winnerId, forfeitedParticipantId, forfeitedParticipantId, now, now, matchId);

    // Advance bracket
    advanceBracket(match.tournament_id, matchId, winnerId, forfeitedParticipantId);

    // Clear station if assigned
    if (match.station_id) {
        const db2 = tournamentsDb.getDb();
        db2.prepare('UPDATE tcc_stations SET current_match_id = NULL WHERE id = ?')
            .run(match.station_id);
        logger.log('setForfeit:clearedStation', { stationId: match.station_id });
    }

    // Try to auto-assign newly opened matches to available stations
    autoAssignStations(match.tournament_id);

    return getById(matchId);
}

/**
 * Reopen a completed match
 */
function reopen(matchId) {
    const logComplete = logger.start('reopen', { matchId });
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    const match = getById(matchId);
    if (!match) {
        logger.error('reopen', new Error('Match not found'), { matchId });
        throw new Error('Match not found');
    }

    logger.log('reopen:match', { matchId, identifier: match.identifier, state: match.state, winnerId: match.winner_id });

    if (match.state !== 'complete') {
        logger.error('reopen', new Error('Match is not complete'), { matchId, state: match.state });
        throw new Error('Match is not complete');
    }

    // Check if any subsequent matches have started
    const nextMatches = getWaitingForPrereq(match.tournament_id, matchId);
    logger.log('reopen:checkingNextMatches', { count: nextMatches.length });
    for (const next of nextMatches) {
        if (next.state === 'complete') {
            logger.error('reopen', new Error('Cannot reopen: subsequent matches have completed'), {
                matchId, blockedByMatchId: next.id
            });
            throw new Error('Cannot reopen: subsequent matches have completed');
        }
    }

    // Clear winner/loser from next matches
    for (const next of nextMatches) {
        if (next.player1_prereq_match_id === matchId) {
            db.prepare('UPDATE tcc_matches SET player1_id = NULL, state = "pending", updated_at = ? WHERE id = ?')
                .run(now, next.id);
        }
        if (next.player2_prereq_match_id === matchId) {
            db.prepare('UPDATE tcc_matches SET player2_id = NULL, state = "pending", updated_at = ? WHERE id = ?')
                .run(now, next.id);
        }
    }

    // Reopen this match - clear both completed_at AND underway_at (full reset)
    db.prepare(`
        UPDATE tcc_matches
        SET winner_id = NULL, loser_id = NULL,
            player1_score = 0, player2_score = 0, scores_csv = NULL,
            forfeited = 0, forfeited_participant_id = NULL,
            state = 'open', underway_at = NULL, completed_at = NULL, updated_at = ?
        WHERE id = ?
    `).run(now, matchId);

    const result = getById(matchId);
    logComplete({ state: result.state, clearedNextMatches: nextMatches.length });
    return result;
}

/**
 * Assign station to match
 */
function setStation(matchId, stationId) {
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    // Clear station from any previous match
    if (stationId) {
        db.prepare('UPDATE tcc_matches SET station_id = NULL, updated_at = ? WHERE station_id = ?')
            .run(now, stationId);
        db.prepare('UPDATE tcc_stations SET current_match_id = ? WHERE id = ?')
            .run(matchId, stationId);
    }

    db.prepare('UPDATE tcc_matches SET station_id = ?, updated_at = ? WHERE id = ?')
        .run(stationId, now, matchId);

    return getById(matchId);
}

/**
 * Clear station from match
 */
function clearStation(matchId) {
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    const match = getById(matchId);
    if (match && match.station_id) {
        db.prepare('UPDATE tcc_stations SET current_match_id = NULL WHERE id = ?')
            .run(match.station_id);
    }

    db.prepare('UPDATE tcc_matches SET station_id = NULL, updated_at = ? WHERE id = ?')
        .run(now, matchId);

    return getById(matchId);
}

/**
 * Auto-assign open matches to available stations
 * Called when matches become open or stations become available
 */
function autoAssignStations(tournamentId) {
    const db = tournamentsDb.getDb();

    // Check if auto-assign is enabled for this tournament
    const tournament = getTournamentDb().getById(tournamentId);
    if (!tournament) {
        logger.log('autoAssign:noTournament', { tournamentId });
        return [];
    }

    const formatSettings = tournament.format_settings || {};
    if (!formatSettings.autoAssign) {
        logger.log('autoAssign:disabled', { tournamentId });
        return [];
    }

    // Get available stations (not currently assigned to a match)
    const availableStations = getStationDb().getAvailable(tournamentId);
    if (availableStations.length === 0) {
        logger.log('autoAssign:noAvailableStations', { tournamentId });
        return [];
    }

    // Get open matches without stations that have both players
    const openMatches = db.prepare(`
        SELECT * FROM tcc_matches
        WHERE tournament_id = ?
        AND state = 'open'
        AND station_id IS NULL
        AND player1_id IS NOT NULL
        AND player2_id IS NOT NULL
        ORDER BY COALESCE(suggested_play_order, 999999), ABS(round), id
    `).all(tournamentId);

    if (openMatches.length === 0) {
        logger.log('autoAssign:noOpenMatches', { tournamentId });
        return [];
    }

    logger.log('autoAssign:start', {
        tournamentId,
        availableStations: availableStations.length,
        openMatches: openMatches.length
    });

    const assignments = [];
    const now = new Date().toISOString();

    // Assign matches to available stations
    for (let i = 0; i < Math.min(availableStations.length, openMatches.length); i++) {
        const station = availableStations[i];
        const match = openMatches[i];

        // Update match with station
        db.prepare('UPDATE tcc_matches SET station_id = ?, updated_at = ? WHERE id = ?')
            .run(station.id, now, match.id);

        // Update station with current match
        db.prepare('UPDATE tcc_stations SET current_match_id = ? WHERE id = ?')
            .run(match.id, station.id);

        assignments.push({
            matchId: match.id,
            matchIdentifier: match.identifier,
            stationId: station.id,
            stationName: station.name
        });

        logger.log('autoAssign:assigned', {
            matchId: match.id,
            matchIdentifier: match.identifier,
            stationId: station.id,
            stationName: station.name
        });
    }

    logger.log('autoAssign:complete', { tournamentId, assignedCount: assignments.length });
    return assignments;
}

/**
 * Advance bracket after match completion
 * Moves winner/loser to their next matches
 */
function advanceBracket(tournamentId, matchId, winnerId, loserId) {
    logger.log('advanceBracket:start', { tournamentId, matchId, winnerId, loserId });
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    const nextMatches = getWaitingForPrereq(tournamentId, matchId);
    logger.log('advanceBracket:nextMatches', { count: nextMatches.length, matchIds: nextMatches.map(m => m.id) });

    for (const next of nextMatches) {
        let updated = false;

        // Check player 1 slot
        if (next.player1_prereq_match_id === matchId) {
            const participant = next.player1_is_prereq_loser ? loserId : winnerId;
            logger.log('advanceBracket:assignPlayer1', {
                nextMatchId: next.id,
                isPrereqLoser: next.player1_is_prereq_loser,
                participantId: participant
            });
            if (participant) {
                db.prepare('UPDATE tcc_matches SET player1_id = ?, updated_at = ? WHERE id = ?')
                    .run(participant, now, next.id);
                updated = true;
            }
        }

        // Check player 2 slot
        if (next.player2_prereq_match_id === matchId) {
            const participant = next.player2_is_prereq_loser ? loserId : winnerId;
            logger.log('advanceBracket:assignPlayer2', {
                nextMatchId: next.id,
                isPrereqLoser: next.player2_is_prereq_loser,
                participantId: participant
            });
            if (participant) {
                db.prepare('UPDATE tcc_matches SET player2_id = ?, updated_at = ? WHERE id = ?')
                    .run(participant, now, next.id);
                updated = true;
            }
        }

        // Check if both players are now assigned and open the match
        if (updated) {
            const updatedMatch = getById(next.id);
            if (updatedMatch.player1_id && updatedMatch.player2_id && updatedMatch.state === 'pending') {
                db.prepare("UPDATE tcc_matches SET state = 'open', updated_at = ? WHERE id = ?")
                    .run(now, next.id);
                logger.log('advanceBracket:openedMatch', {
                    matchId: next.id,
                    identifier: updatedMatch.identifier,
                    player1: updatedMatch.player1_name,
                    player2: updatedMatch.player2_name
                });
            }
        }
    }
    logger.log('advanceBracket:complete', { matchId, nextMatchesProcessed: nextMatches.length });
}

/**
 * Delete all matches for a tournament (for reset)
 */
function deleteByTournament(tournamentId) {
    const db = tournamentsDb.getDb();
    const result = db.prepare('DELETE FROM tcc_matches WHERE tournament_id = ?').run(tournamentId);
    return result.changes;
}

/**
 * Get match statistics for a tournament
 */
function getStats(tournamentId) {
    const db = tournamentsDb.getDb();

    return db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN state = 'open' THEN 1 ELSE 0 END) as open,
            SUM(CASE WHEN state = 'underway' THEN 1 ELSE 0 END) as underway,
            SUM(CASE WHEN state = 'complete' THEN 1 ELSE 0 END) as complete
        FROM tcc_matches
        WHERE tournament_id = ?
    `).get(tournamentId);
}

/**
 * Find next suggested match to call
 */
function findNextMatch(tournamentId) {
    const db = tournamentsDb.getDb();

    // Find open match with lowest suggested_play_order that isn't underway
    return db.prepare(`
        SELECT m.*,
               p1.name as player1_name, p1.seed as player1_seed,
               p2.name as player2_name, p2.seed as player2_seed
        FROM tcc_matches m
        LEFT JOIN tcc_participants p1 ON m.player1_id = p1.id
        LEFT JOIN tcc_participants p2 ON m.player2_id = p2.id
        WHERE m.tournament_id = ?
        AND m.state = 'open'
        AND m.underway_at IS NULL
        ORDER BY COALESCE(m.suggested_play_order, 999999), ABS(m.round), m.id
        LIMIT 1
    `).get(tournamentId);
}

/**
 * Check if all matches are complete
 */
function allComplete(tournamentId) {
    const db = tournamentsDb.getDb();

    const result = db.prepare(`
        SELECT COUNT(*) as incomplete
        FROM tcc_matches
        WHERE tournament_id = ? AND state != 'complete'
    `).get(tournamentId);

    return result.incomplete === 0;
}

/**
 * Update prereq match IDs (used after bracket generation to link matches)
 */
function updatePrereqs(matchId, prereqs) {
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    const updates = [];
    const params = [];

    if (prereqs.player1_prereq_match_id !== undefined) {
        updates.push('player1_prereq_match_id = ?');
        params.push(prereqs.player1_prereq_match_id);
    }
    if (prereqs.player2_prereq_match_id !== undefined) {
        updates.push('player2_prereq_match_id = ?');
        params.push(prereqs.player2_prereq_match_id);
    }
    if (prereqs.player1_is_prereq_loser !== undefined) {
        updates.push('player1_is_prereq_loser = ?');
        params.push(prereqs.player1_is_prereq_loser ? 1 : 0);
    }
    if (prereqs.player2_is_prereq_loser !== undefined) {
        updates.push('player2_is_prereq_loser = ?');
        params.push(prereqs.player2_is_prereq_loser ? 1 : 0);
    }

    if (updates.length === 0) return getById(matchId);

    updates.push('updated_at = ?');
    params.push(now);
    params.push(matchId);

    db.prepare(`UPDATE tcc_matches SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return getById(matchId);
}

module.exports = {
    create,
    bulkCreate,
    getById,
    getByTournament,
    getOpenMatches,
    getWaitingForPrereq,
    setPlayer,
    updateState,
    markUnderway,
    unmarkUnderway,
    setWinner,
    setForfeit,
    reopen,
    setStation,
    clearStation,
    autoAssignStations,
    advanceBracket,
    deleteByTournament,
    getStats,
    findNextMatch,
    allComplete,
    updatePrereqs
};
