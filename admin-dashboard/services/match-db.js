/**
 * Match Database Service
 * Local match management with bracket progression - replaces Challonge API
 */

const analyticsDb = require('../analytics-db');

/**
 * Create a single match
 */
function create(tournamentId, matchData) {
    const db = analyticsDb.getDb();

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
    const db = analyticsDb.getDb();

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
            const result = stmt.run(
                tournamentId,
                m.identifier || null,
                m.round,
                m.suggested_play_order || null,
                m.bracket_position || null,
                m.losers_bracket ? 1 : 0,
                m.player1_id || null,
                m.player2_id || null,
                m.player1_prereq_match_id || null,
                m.player2_prereq_match_id || null,
                m.player1_is_prereq_loser ? 1 : 0,
                m.player2_is_prereq_loser ? 1 : 0,
                m.state || 'pending'
            );
            insertedIds.push(result.lastInsertRowid);
        }
        return insertedIds;
    });

    return insertMany(matches);
}

/**
 * Get match by ID with participant names
 */
function getById(id) {
    const db = analyticsDb.getDb();

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
    const db = analyticsDb.getDb();

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
    const db = analyticsDb.getDb();

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
    const db = analyticsDb.getDb();

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
    const db = analyticsDb.getDb();
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
    const db = analyticsDb.getDb();
    const now = new Date().toISOString();

    db.prepare(`
        UPDATE tcc_matches
        SET underway_at = ?, updated_at = ?
        WHERE id = ?
    `).run(now, now, matchId);

    return getById(matchId);
}

/**
 * Unmark match as underway
 */
function unmarkUnderway(matchId) {
    const db = analyticsDb.getDb();
    const now = new Date().toISOString();

    db.prepare(`
        UPDATE tcc_matches
        SET underway_at = NULL, updated_at = ?
        WHERE id = ?
    `).run(now, matchId);

    return getById(matchId);
}

/**
 * Set match winner and scores
 * This is the main function for completing a match
 */
function setWinner(matchId, winnerId, scores = {}) {
    const db = analyticsDb.getDb();
    const now = new Date().toISOString();

    const match = getById(matchId);
    if (!match) {
        throw new Error('Match not found');
    }

    // Determine loser
    let loserId;
    if (match.player1_id === winnerId) {
        loserId = match.player2_id;
    } else if (match.player2_id === winnerId) {
        loserId = match.player1_id;
    } else {
        throw new Error('Winner must be one of the match participants');
    }

    // Update match
    db.prepare(`
        UPDATE tcc_matches
        SET winner_id = ?, loser_id = ?,
            player1_score = ?, player2_score = ?, scores_csv = ?,
            state = 'complete', completed_at = ?, updated_at = ?
        WHERE id = ?
    `).run(
        winnerId,
        loserId,
        scores.player1_score || 0,
        scores.player2_score || 0,
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
    }

    return getById(matchId);
}

/**
 * Set match as forfeit/DQ
 */
function setForfeit(matchId, forfeitedParticipantId) {
    const db = analyticsDb.getDb();
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

    return getById(matchId);
}

/**
 * Reopen a completed match
 */
function reopen(matchId) {
    const db = analyticsDb.getDb();
    const now = new Date().toISOString();

    const match = getById(matchId);
    if (!match) {
        throw new Error('Match not found');
    }

    if (match.state !== 'complete') {
        throw new Error('Match is not complete');
    }

    // Check if any subsequent matches have started
    const nextMatches = getWaitingForPrereq(match.tournament_id, matchId);
    for (const next of nextMatches) {
        if (next.state === 'complete') {
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

    // Reopen this match
    db.prepare(`
        UPDATE tcc_matches
        SET winner_id = NULL, loser_id = NULL,
            player1_score = 0, player2_score = 0, scores_csv = NULL,
            forfeited = 0, forfeited_participant_id = NULL,
            state = 'open', completed_at = NULL, updated_at = ?
        WHERE id = ?
    `).run(now, matchId);

    return getById(matchId);
}

/**
 * Assign station to match
 */
function setStation(matchId, stationId) {
    const db = analyticsDb.getDb();
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
    const db = analyticsDb.getDb();
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
 * Advance bracket after match completion
 * Moves winner/loser to their next matches
 */
function advanceBracket(tournamentId, matchId, winnerId, loserId) {
    const db = analyticsDb.getDb();
    const now = new Date().toISOString();

    const nextMatches = getWaitingForPrereq(tournamentId, matchId);

    for (const next of nextMatches) {
        let updated = false;

        // Check player 1 slot
        if (next.player1_prereq_match_id === matchId) {
            const participant = next.player1_is_prereq_loser ? loserId : winnerId;
            if (participant) {
                db.prepare('UPDATE tcc_matches SET player1_id = ?, updated_at = ? WHERE id = ?')
                    .run(participant, now, next.id);
                updated = true;
            }
        }

        // Check player 2 slot
        if (next.player2_prereq_match_id === matchId) {
            const participant = next.player2_is_prereq_loser ? loserId : winnerId;
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
                db.prepare('UPDATE tcc_matches SET state = "open", updated_at = ? WHERE id = ?')
                    .run(now, next.id);
            }
        }
    }
}

/**
 * Delete all matches for a tournament (for reset)
 */
function deleteByTournament(tournamentId) {
    const db = analyticsDb.getDb();
    const result = db.prepare('DELETE FROM tcc_matches WHERE tournament_id = ?').run(tournamentId);
    return result.changes;
}

/**
 * Get match statistics for a tournament
 */
function getStats(tournamentId) {
    const db = analyticsDb.getDb();

    return db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN state = 'open' THEN 1 ELSE 0 END) as open,
            SUM(CASE WHEN state = 'complete' THEN 1 ELSE 0 END) as complete,
            SUM(CASE WHEN underway_at IS NOT NULL AND state != 'complete' THEN 1 ELSE 0 END) as underway
        FROM tcc_matches
        WHERE tournament_id = ?
    `).get(tournamentId);
}

/**
 * Find next suggested match to call
 */
function findNextMatch(tournamentId) {
    const db = analyticsDb.getDb();

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
    const db = analyticsDb.getDb();

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
    const db = analyticsDb.getDb();
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
    advanceBracket,
    deleteByTournament,
    getStats,
    findNextMatch,
    allComplete,
    updatePrereqs
};
