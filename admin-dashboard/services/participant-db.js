/**
 * Participant Database Service
 * Local participant management - replaces Challonge API
 */

const analyticsDb = require('../analytics-db');

/**
 * Create a participant
 */
function create(tournamentId, data) {
    const db = analyticsDb.getDb();

    // Auto-assign seed if not provided
    let seed = data.seed;
    if (!seed) {
        const maxSeed = db.prepare(`
            SELECT MAX(seed) as max_seed FROM tcc_participants
            WHERE tournament_id = ? AND active = 1
        `).get(tournamentId);
        seed = (maxSeed.max_seed || 0) + 1;
    }

    // Try to link to unified player
    let playerId = data.player_id;
    if (!playerId && data.name) {
        const player = analyticsDb.findPlayerByName(data.name);
        if (player) {
            playerId = player.player.id;
        }
    }

    const stmt = db.prepare(`
        INSERT INTO tcc_participants (
            tournament_id, player_id, name, display_name, email, seed,
            active, checked_in, on_waiting_list, misc, instagram
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        tournamentId,
        playerId || null,
        data.name,
        data.display_name || data.name,
        data.email || null,
        seed,
        data.active !== false ? 1 : 0,
        data.checked_in ? 1 : 0,
        data.on_waiting_list ? 1 : 0,
        data.misc || null,
        data.instagram || null
    );

    return getById(result.lastInsertRowid);
}

/**
 * Bulk create participants
 */
function bulkCreate(tournamentId, participants) {
    const db = analyticsDb.getDb();

    // Get current max seed
    const maxSeed = db.prepare(`
        SELECT MAX(seed) as max_seed FROM tcc_participants
        WHERE tournament_id = ? AND active = 1
    `).get(tournamentId);
    let nextSeed = (maxSeed.max_seed || 0) + 1;

    const stmt = db.prepare(`
        INSERT INTO tcc_participants (
            tournament_id, player_id, name, display_name, email, seed,
            active, checked_in, on_waiting_list, misc, instagram
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((list) => {
        const insertedIds = [];
        for (const data of list) {
            // Try to link to unified player
            let playerId = data.player_id;
            if (!playerId && data.name) {
                const player = analyticsDb.findPlayerByName(data.name);
                if (player) {
                    playerId = player.player.id;
                }
            }

            const seed = data.seed || nextSeed++;

            const result = stmt.run(
                tournamentId,
                playerId || null,
                data.name,
                data.display_name || data.name,
                data.email || null,
                seed,
                data.active !== false ? 1 : 0,
                data.checked_in ? 1 : 0,
                data.on_waiting_list ? 1 : 0,
                data.misc || null,
                data.instagram || null
            );
            insertedIds.push(result.lastInsertRowid);
        }
        return insertedIds;
    });

    return insertMany(participants);
}

/**
 * Get participant by ID
 */
function getById(id) {
    const db = analyticsDb.getDb();

    return db.prepare(`
        SELECT p.*, pl.canonical_name as player_canonical_name
        FROM tcc_participants p
        LEFT JOIN players pl ON p.player_id = pl.id
        WHERE p.id = ?
    `).get(id);
}

/**
 * Get all participants for a tournament
 */
function getByTournament(tournamentId, options = {}) {
    const db = analyticsDb.getDb();

    let sql = `
        SELECT p.*, pl.canonical_name as player_canonical_name
        FROM tcc_participants p
        LEFT JOIN players pl ON p.player_id = pl.id
        WHERE p.tournament_id = ?
    `;
    const params = [tournamentId];

    if (options.active !== undefined) {
        sql += ' AND p.active = ?';
        params.push(options.active ? 1 : 0);
    }

    if (options.checked_in !== undefined) {
        sql += ' AND p.checked_in = ?';
        params.push(options.checked_in ? 1 : 0);
    }

    if (options.on_waiting_list !== undefined) {
        sql += ' AND p.on_waiting_list = ?';
        params.push(options.on_waiting_list ? 1 : 0);
    }

    // Default sort by seed
    sql += ' ORDER BY p.seed ASC';

    return db.prepare(sql).all(...params);
}

/**
 * Get active participants sorted by seed
 */
function getActiveByTournament(tournamentId) {
    return getByTournament(tournamentId, { active: true });
}

/**
 * Update participant
 */
function update(id, data) {
    const db = analyticsDb.getDb();

    const updates = [];
    const params = [];

    const allowedFields = [
        'name', 'display_name', 'email', 'seed', 'active',
        'checked_in', 'checked_in_at', 'on_waiting_list',
        'final_rank', 'group_id', 'group_seed', 'misc', 'instagram'
    ];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            updates.push(`${field} = ?`);
            if (typeof data[field] === 'boolean') {
                params.push(data[field] ? 1 : 0);
            } else {
                params.push(data[field]);
            }
        }
    }

    if (updates.length === 0) {
        return getById(id);
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    db.prepare(`UPDATE tcc_participants SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return getById(id);
}

/**
 * Update participant seed
 */
function updateSeed(id, newSeed) {
    return update(id, { seed: newSeed });
}

/**
 * Randomize seeds for all active participants
 */
function randomizeSeeds(tournamentId) {
    const db = analyticsDb.getDb();

    // Get all active participants
    const participants = getByTournament(tournamentId, { active: true });

    // Shuffle using Fisher-Yates
    const shuffled = [...participants];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Update seeds in transaction
    const now = new Date().toISOString();
    const updateStmt = db.prepare('UPDATE tcc_participants SET seed = ?, updated_at = ? WHERE id = ?');

    const updateAll = db.transaction(() => {
        shuffled.forEach((p, index) => {
            updateStmt.run(index + 1, now, p.id);
        });
    });

    updateAll();

    return getByTournament(tournamentId, { active: true });
}

/**
 * Check in a participant
 */
function checkIn(id) {
    const db = analyticsDb.getDb();
    const now = new Date().toISOString();

    db.prepare(`
        UPDATE tcc_participants
        SET checked_in = 1, checked_in_at = ?, updated_at = ?
        WHERE id = ?
    `).run(now, now, id);

    return getById(id);
}

/**
 * Undo check-in for a participant
 */
function undoCheckIn(id) {
    const db = analyticsDb.getDb();
    const now = new Date().toISOString();

    db.prepare(`
        UPDATE tcc_participants
        SET checked_in = 0, checked_in_at = NULL, updated_at = ?
        WHERE id = ?
    `).run(now, id);

    return getById(id);
}

/**
 * Bulk check-in all active participants
 */
function bulkCheckIn(tournamentId) {
    const db = analyticsDb.getDb();
    const now = new Date().toISOString();

    const result = db.prepare(`
        UPDATE tcc_participants
        SET checked_in = 1, checked_in_at = ?, updated_at = ?
        WHERE tournament_id = ? AND active = 1 AND checked_in = 0
    `).run(now, now, tournamentId);

    return result.changes;
}

/**
 * Delete participant
 */
function deleteParticipant(id) {
    const db = analyticsDb.getDb();

    const participant = getById(id);
    if (!participant) return false;

    const result = db.prepare('DELETE FROM tcc_participants WHERE id = ?').run(id);

    // Resequence seeds
    if (result.changes > 0) {
        resequenceSeeds(participant.tournament_id);
    }

    return result.changes > 0;
}

/**
 * Deactivate participant (soft delete)
 */
function deactivate(id) {
    return update(id, { active: false });
}

/**
 * Reactivate participant
 */
function reactivate(id) {
    return update(id, { active: true });
}

/**
 * Clear all participants from a tournament
 */
function clearAll(tournamentId) {
    const db = analyticsDb.getDb();
    const result = db.prepare('DELETE FROM tcc_participants WHERE tournament_id = ?').run(tournamentId);
    return result.changes;
}

/**
 * Resequence seeds to fill gaps
 */
function resequenceSeeds(tournamentId) {
    const db = analyticsDb.getDb();

    const participants = db.prepare(`
        SELECT id FROM tcc_participants
        WHERE tournament_id = ? AND active = 1
        ORDER BY seed ASC
    `).all(tournamentId);

    const now = new Date().toISOString();
    const updateStmt = db.prepare('UPDATE tcc_participants SET seed = ?, updated_at = ? WHERE id = ?');

    const updateAll = db.transaction(() => {
        participants.forEach((p, index) => {
            updateStmt.run(index + 1, now, p.id);
        });
    });

    updateAll();
}

/**
 * Move participant to waiting list
 */
function moveToWaitingList(id) {
    return update(id, { on_waiting_list: true, active: false });
}

/**
 * Promote from waiting list to active
 */
function promoteFromWaitingList(id) {
    const db = analyticsDb.getDb();
    const participant = getById(id);

    if (!participant || !participant.on_waiting_list) {
        throw new Error('Participant not on waiting list');
    }

    // Get next seed
    const maxSeed = db.prepare(`
        SELECT MAX(seed) as max_seed FROM tcc_participants
        WHERE tournament_id = ? AND active = 1
    `).get(participant.tournament_id);
    const nextSeed = (maxSeed.max_seed || 0) + 1;

    return update(id, {
        on_waiting_list: false,
        active: true,
        seed: nextSeed
    });
}

/**
 * Get count of participants
 */
function getCount(tournamentId, options = {}) {
    const db = analyticsDb.getDb();

    let sql = 'SELECT COUNT(*) as count FROM tcc_participants WHERE tournament_id = ?';
    const params = [tournamentId];

    if (options.active !== undefined) {
        sql += ' AND active = ?';
        params.push(options.active ? 1 : 0);
    }

    if (options.checked_in !== undefined) {
        sql += ' AND checked_in = ?';
        params.push(options.checked_in ? 1 : 0);
    }

    return db.prepare(sql).get(...params).count;
}

/**
 * Search participant by name in tournament
 */
function searchByName(tournamentId, searchTerm) {
    const db = analyticsDb.getDb();

    return db.prepare(`
        SELECT * FROM tcc_participants
        WHERE tournament_id = ?
        AND (name LIKE ? OR display_name LIKE ?)
        ORDER BY seed ASC
    `).all(tournamentId, `%${searchTerm}%`, `%${searchTerm}%`);
}

/**
 * Set final ranks for all participants (called after tournament complete)
 */
function setFinalRanks(tournamentId, ranks) {
    const db = analyticsDb.getDb();
    const now = new Date().toISOString();

    const updateStmt = db.prepare(`
        UPDATE tcc_participants
        SET final_rank = ?, updated_at = ?
        WHERE id = ?
    `);

    const updateAll = db.transaction(() => {
        for (const [participantId, rank] of Object.entries(ranks)) {
            updateStmt.run(rank, now, participantId);
        }
    });

    updateAll();
}

/**
 * Get participants with their Elo ratings for a game
 */
function getWithRatings(tournamentId, gameId) {
    const db = analyticsDb.getDb();

    return db.prepare(`
        SELECT p.*,
               pr.elo_rating, pr.peak_rating, pr.matches_played, pr.wins, pr.losses
        FROM tcc_participants p
        LEFT JOIN players pl ON p.player_id = pl.id
        LEFT JOIN player_ratings pr ON pl.id = pr.player_id AND pr.game_id = ?
        WHERE p.tournament_id = ? AND p.active = 1
        ORDER BY p.seed ASC
    `).all(gameId, tournamentId);
}

/**
 * Apply seeding based on Elo ratings
 */
function applyEloSeeding(tournamentId, gameId) {
    const db = analyticsDb.getDb();

    // Get participants with ratings
    const participants = getWithRatings(tournamentId, gameId);

    // Sort by Elo (descending), then by matches played
    participants.sort((a, b) => {
        const ratingA = a.elo_rating || 1200;
        const ratingB = b.elo_rating || 1200;
        if (ratingB !== ratingA) return ratingB - ratingA;
        return (b.matches_played || 0) - (a.matches_played || 0);
    });

    // Apply new seeds
    const now = new Date().toISOString();
    const updateStmt = db.prepare('UPDATE tcc_participants SET seed = ?, updated_at = ? WHERE id = ?');

    const updateAll = db.transaction(() => {
        participants.forEach((p, index) => {
            updateStmt.run(index + 1, now, p.id);
        });
    });

    updateAll();

    return getByTournament(tournamentId, { active: true });
}

module.exports = {
    create,
    bulkCreate,
    getById,
    getByTournament,
    getActiveByTournament,
    update,
    updateSeed,
    randomizeSeeds,
    checkIn,
    undoCheckIn,
    bulkCheckIn,
    delete: deleteParticipant,
    deactivate,
    reactivate,
    clearAll,
    resequenceSeeds,
    moveToWaitingList,
    promoteFromWaitingList,
    getCount,
    searchByName,
    setFinalRanks,
    getWithRatings,
    applyEloSeeding
};
