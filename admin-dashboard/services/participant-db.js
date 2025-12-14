/**
 * Participant Database Service
 * Local participant management - replaces Challonge API
 */

const tournamentsDb = require('../db/tournaments-db');
const playersDb = require('../db/players-db');
const { createLogger } = require('./debug-logger');

const logger = createLogger('participant-db');

/**
 * Create a participant
 */
function create(tournamentId, data) {
    const logComplete = logger.start('create', { tournamentId, name: data.name });
    const db = tournamentsDb.getDb();

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
        const player = playersDb.findPlayerByName(data.name);
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

    const participant = getById(result.lastInsertRowid);
    logComplete({ participantId: participant.id, seed: participant.seed });
    return participant;
}

/**
 * Bulk create participants
 */
function bulkCreate(tournamentId, participants) {
    const logComplete = logger.start('bulkCreate', { tournamentId, count: participants.length });
    const db = tournamentsDb.getDb();

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
                const player = playersDb.findPlayerByName(data.name);
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

    const insertedIds = insertMany(participants);
    logComplete({ inserted: insertedIds.length });
    return insertedIds;
}

/**
 * Enrich participant with player data from players.db (cross-db helper)
 */
function enrichWithPlayerData(participant) {
    if (!participant) return participant;

    if (participant.player_id) {
        const player = playersDb.getPlayerById(participant.player_id);
        participant.player_canonical_name = player ? player.canonical_name : null;
    } else {
        participant.player_canonical_name = null;
    }

    return participant;
}

/**
 * Get participant by ID
 */
function getById(id) {
    const db = tournamentsDb.getDb();

    const participant = db.prepare(`
        SELECT * FROM tcc_participants WHERE id = ?
    `).get(id);

    return enrichWithPlayerData(participant);
}

/**
 * Get all participants for a tournament
 */
function getByTournament(tournamentId, options = {}) {
    logger.log('getByTournament', { tournamentId, options });
    const db = tournamentsDb.getDb();

    let sql = `SELECT * FROM tcc_participants WHERE tournament_id = ?`;
    const params = [tournamentId];

    if (options.active !== undefined) {
        sql += ' AND active = ?';
        params.push(options.active ? 1 : 0);
    }

    if (options.checked_in !== undefined) {
        sql += ' AND checked_in = ?';
        params.push(options.checked_in ? 1 : 0);
    }

    if (options.on_waiting_list !== undefined) {
        sql += ' AND on_waiting_list = ?';
        params.push(options.on_waiting_list ? 1 : 0);
    }

    // Default sort by seed
    sql += ' ORDER BY seed ASC';

    const participants = db.prepare(sql).all(...params);

    // Enrich with player data (batch for performance)
    const result = participants.map(p => enrichWithPlayerData(p));
    logger.log('getByTournament:result', { tournamentId, count: result.length });
    return result;
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
    const db = tournamentsDb.getDb();

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
    const logComplete = logger.start('randomizeSeeds', { tournamentId });
    const db = tournamentsDb.getDb();

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

    const result = getByTournament(tournamentId, { active: true });
    logComplete({ shuffled: result.length });
    return result;
}

/**
 * Check in a participant
 */
function checkIn(id) {
    logger.log('checkIn', { id });
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    db.prepare(`
        UPDATE tcc_participants
        SET checked_in = 1, checked_in_at = ?, updated_at = ?
        WHERE id = ?
    `).run(now, now, id);

    const participant = getById(id);
    logger.log('checkIn:result', { id, name: participant?.name });
    return participant;
}

/**
 * Undo check-in for a participant
 */
function undoCheckIn(id) {
    const db = tournamentsDb.getDb();
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
    const db = tournamentsDb.getDb();
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
    logger.log('delete', { id });
    const db = tournamentsDb.getDb();

    const participant = getById(id);
    if (!participant) {
        logger.log('delete:notFound', { id });
        return false;
    }

    const result = db.prepare('DELETE FROM tcc_participants WHERE id = ?').run(id);

    // Resequence seeds
    if (result.changes > 0) {
        resequenceSeeds(participant.tournament_id);
    }

    logger.log('delete:result', { id, name: participant.name, deleted: result.changes > 0 });
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
    const db = tournamentsDb.getDb();
    const result = db.prepare('DELETE FROM tcc_participants WHERE tournament_id = ?').run(tournamentId);
    return result.changes;
}

/**
 * Resequence seeds to fill gaps
 */
function resequenceSeeds(tournamentId) {
    const db = tournamentsDb.getDb();

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
    const db = tournamentsDb.getDb();
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
    const db = tournamentsDb.getDb();

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
    const db = tournamentsDb.getDb();

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
    const db = tournamentsDb.getDb();
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
    const db = tournamentsDb.getDb();

    // Get participants from tournaments.db
    const participants = db.prepare(`
        SELECT * FROM tcc_participants
        WHERE tournament_id = ? AND active = 1
        ORDER BY seed ASC
    `).all(tournamentId);

    // Enrich with ratings from players.db
    return participants.map(p => {
        enrichWithPlayerData(p);

        // Get rating for this player and game
        if (p.player_id) {
            const rating = playersDb.getOrCreateRating(p.player_id, gameId);
            p.elo_rating = rating.elo_rating;
            p.peak_rating = rating.peak_rating;
            p.matches_played = rating.matches_played;
            p.wins = rating.wins;
            p.losses = rating.losses;
        } else {
            p.elo_rating = null;
            p.peak_rating = null;
            p.matches_played = null;
            p.wins = null;
            p.losses = null;
        }

        return p;
    });
}

/**
 * Apply snake draft seeding pattern
 *
 * Creates alternating team assignments using a snake draft pattern.
 * For 2 teams with 8 players:
 *   Team A: Seeds 1, 4, 5, 8 (picks 1st, 4th, 5th, 8th)
 *   Team B: Seeds 2, 3, 6, 7 (picks 2nd, 3rd, 6th, 7th)
 *
 * @param {number} tournamentId - Tournament ID
 * @param {number} teamCount - Number of teams (default 2)
 * @returns {Array} Updated participants with new seeds
 */
function applySnakeDraftSeeding(tournamentId, teamCount = 2) {
    const logComplete = logger.start('applySnakeDraftSeeding', { tournamentId, teamCount });
    const db = tournamentsDb.getDb();

    // Get all active participants sorted by current seed
    const participants = getByTournament(tournamentId, { active: true });
    const count = participants.length;

    if (count < teamCount) {
        throw new Error(`Need at least ${teamCount} participants for ${teamCount}-team snake draft`);
    }

    // Generate snake draft order
    // Round 1: Teams pick in order (1, 2, 3, ...)
    // Round 2: Teams pick in reverse order (..., 3, 2, 1)
    // And so on...
    const teams = Array.from({ length: teamCount }, () => []);
    let direction = 1; // 1 = forward, -1 = reverse
    let currentTeam = 0;

    for (let i = 0; i < count; i++) {
        teams[currentTeam].push(participants[i]);

        // Move to next team in snake order
        if (direction === 1) {
            if (currentTeam === teamCount - 1) {
                direction = -1; // Reverse direction
            } else {
                currentTeam++;
            }
        } else {
            if (currentTeam === 0) {
                direction = 1; // Forward direction
            } else {
                currentTeam--;
            }
        }
    }

    // Flatten teams back into a single array with new seed assignments
    // Team A players get seeds: 1, teamCount+1, teamCount*2+1, ...
    // Team B players get seeds: 2, teamCount+2, teamCount*2+2, ...
    const now = new Date().toISOString();
    const updateStmt = db.prepare('UPDATE tcc_participants SET seed = ?, updated_at = ? WHERE id = ?');

    const updateAll = db.transaction(() => {
        for (let teamIndex = 0; teamIndex < teamCount; teamIndex++) {
            const teamParticipants = teams[teamIndex];
            teamParticipants.forEach((p, pickIndex) => {
                // Calculate snake seed position
                const newSeed = pickIndex * teamCount + teamIndex + 1;
                updateStmt.run(newSeed, now, p.id);
            });
        }
    });

    updateAll();

    const result = getByTournament(tournamentId, { active: true });
    logComplete({ updated: result.length, teamCount });
    return result;
}

/**
 * Apply seeding based on previous tournament results
 *
 * Seeds participants based on their final rank in a previous tournament:
 * - Previous 1st place → Seed 1
 * - Previous 2nd place → Seed 2
 * - etc.
 * - New players (not in previous tournament) get seeds after returning players
 *
 * @param {number} tournamentId - Current tournament ID
 * @param {number} previousTournamentId - Previous tournament ID to get results from
 * @returns {Array} Updated participants with new seeds
 */
function applyPreviousTournamentSeeding(tournamentId, previousTournamentId) {
    const logComplete = logger.start('applyPreviousTournamentSeeding', { tournamentId, previousTournamentId });
    const db = tournamentsDb.getDb();

    // Get current tournament participants
    const currentParticipants = getByTournament(tournamentId, { active: true });
    if (currentParticipants.length === 0) {
        throw new Error('No participants in current tournament');
    }

    // Get previous tournament participants with final ranks
    const previousParticipants = db.prepare(`
        SELECT * FROM tcc_participants
        WHERE tournament_id = ? AND active = 1 AND final_rank IS NOT NULL
        ORDER BY final_rank ASC
    `).all(previousTournamentId);

    if (previousParticipants.length === 0) {
        throw new Error('No ranked participants found in previous tournament');
    }

    // Build a map of previous participant names (normalized) to their final rank
    const normalizeNameForMatch = (name) => {
        return (name || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    };

    const previousRanks = new Map();
    previousParticipants.forEach(p => {
        const normalizedName = normalizeNameForMatch(p.name);
        if (normalizedName) {
            previousRanks.set(normalizedName, p.final_rank);
        }
        // Also check by player_id if available
        if (p.player_id) {
            previousRanks.set(`player_${p.player_id}`, p.final_rank);
        }
    });

    // Categorize current participants into returning (with previous rank) and new players
    const returningPlayers = [];
    const newPlayers = [];

    currentParticipants.forEach(p => {
        // Try to match by player_id first, then by name
        let previousRank = null;
        if (p.player_id) {
            previousRank = previousRanks.get(`player_${p.player_id}`);
        }
        if (!previousRank) {
            const normalizedName = normalizeNameForMatch(p.name);
            previousRank = previousRanks.get(normalizedName);
        }

        if (previousRank) {
            returningPlayers.push({ participant: p, previousRank });
        } else {
            newPlayers.push(p);
        }
    });

    // Sort returning players by their previous rank
    returningPlayers.sort((a, b) => a.previousRank - b.previousRank);

    // Combine: returning players first (in rank order), then new players (in current seed order)
    const now = new Date().toISOString();
    const updateStmt = db.prepare('UPDATE tcc_participants SET seed = ?, updated_at = ? WHERE id = ?');

    const updateAll = db.transaction(() => {
        let seed = 1;

        // Assign seeds to returning players
        returningPlayers.forEach(({ participant }) => {
            updateStmt.run(seed++, now, participant.id);
        });

        // Assign seeds to new players
        newPlayers.forEach(p => {
            updateStmt.run(seed++, now, p.id);
        });
    });

    updateAll();

    const result = getByTournament(tournamentId, { active: true });
    logComplete({
        updated: result.length,
        returningPlayers: returningPlayers.length,
        newPlayers: newPlayers.length
    });
    return result;
}

/**
 * Apply seeding based on Swiss pre-round standings
 *
 * Uses Swiss standings from another tournament (pre-round Swiss) to seed
 * participants in the current tournament.
 *
 * @param {number} tournamentId - Current tournament ID
 * @param {number} swissTournamentId - Swiss tournament ID to get standings from
 * @returns {Array} Updated participants with new seeds
 */
function applySwissPreRoundSeeding(tournamentId, swissTournamentId) {
    const logComplete = logger.start('applySwissPreRoundSeeding', { tournamentId, swissTournamentId });
    const db = tournamentsDb.getDb();

    // Import Swiss standings calculator
    const swiss = require('./bracket-engine/swiss');

    // Get current tournament participants
    const currentParticipants = getByTournament(tournamentId, { active: true });
    if (currentParticipants.length === 0) {
        throw new Error('No participants in current tournament');
    }

    // Get Swiss tournament matches
    const swissMatches = db.prepare(`
        SELECT * FROM tcc_matches
        WHERE tournament_id = ? AND state = 'complete'
        ORDER BY round, id
    `).all(swissTournamentId);

    if (swissMatches.length === 0) {
        throw new Error('No completed matches found in Swiss tournament');
    }

    // Get Swiss tournament participants for standings calculation
    const swissParticipants = db.prepare(`
        SELECT * FROM tcc_participants
        WHERE tournament_id = ? AND active = 1
    `).all(swissTournamentId);

    if (swissParticipants.length === 0) {
        throw new Error('No participants found in Swiss tournament');
    }

    // Calculate Swiss standings
    const standings = swiss.calculateStandings(swissMatches, swissParticipants);

    // Build a map of Swiss participant names/IDs to their rank
    const normalizeNameForMatch = (name) => {
        return (name || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    };

    const swissRanks = new Map();
    standings.forEach(s => {
        // Find participant in swiss tournament
        const swissP = swissParticipants.find(p => p.id === s.participant_id);
        if (swissP) {
            const normalizedName = normalizeNameForMatch(swissP.name);
            if (normalizedName) {
                swissRanks.set(normalizedName, s.rank);
            }
            if (swissP.player_id) {
                swissRanks.set(`player_${swissP.player_id}`, s.rank);
            }
        }
    });

    // Match current participants to Swiss standings
    const rankedParticipants = [];
    const unrankedParticipants = [];

    currentParticipants.forEach(p => {
        let swissRank = null;
        if (p.player_id) {
            swissRank = swissRanks.get(`player_${p.player_id}`);
        }
        if (!swissRank) {
            const normalizedName = normalizeNameForMatch(p.name);
            swissRank = swissRanks.get(normalizedName);
        }

        if (swissRank) {
            rankedParticipants.push({ participant: p, swissRank });
        } else {
            unrankedParticipants.push(p);
        }
    });

    // Sort ranked participants by Swiss rank
    rankedParticipants.sort((a, b) => a.swissRank - b.swissRank);

    // Apply new seeds
    const now = new Date().toISOString();
    const updateStmt = db.prepare('UPDATE tcc_participants SET seed = ?, updated_at = ? WHERE id = ?');

    const updateAll = db.transaction(() => {
        let seed = 1;

        // Assign seeds to ranked participants
        rankedParticipants.forEach(({ participant }) => {
            updateStmt.run(seed++, now, participant.id);
        });

        // Assign seeds to unranked participants (at the end)
        unrankedParticipants.forEach(p => {
            updateStmt.run(seed++, now, p.id);
        });
    });

    updateAll();

    const result = getByTournament(tournamentId, { active: true });
    logComplete({
        updated: result.length,
        rankedFromSwiss: rankedParticipants.length,
        unranked: unrankedParticipants.length
    });
    return result;
}

/**
 * Apply seeding based on Elo ratings
 */
function applyEloSeeding(tournamentId, gameId) {
    const db = tournamentsDb.getDb();

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
    applyEloSeeding,
    applySnakeDraftSeeding,
    applyPreviousTournamentSeeding,
    applySwissPreRoundSeeding
};
