/**
 * Tournament Database Service
 * Local tournament management - replaces Challonge API
 */

const tournamentsDb = require('../db/tournaments-db');
const systemDb = require('../db/system-db');
const { createLogger } = require('./debug-logger');

const logger = createLogger('tournament-db');

/**
 * Generate a URL-safe slug for a tournament
 */
function generateUrlSlug(name, gameName, startDate) {
    const now = startDate ? new Date(startDate) : new Date();
    const month = now.toLocaleString('en-US', { month: 'short' }).toLowerCase();
    const year = String(now.getFullYear()).slice(2);

    // Extract venue from name (text after @ symbol)
    let venue = 'local';
    const atMatch = name.match(/@\s*(.+)/);
    if (atMatch) {
        venue = atMatch[1].toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 15);
    }

    // Abbreviate game name
    const gameAbbreviations = {
        'super smash bros. ultimate': 'ssbu',
        'super smash bros ultimate': 'ssbu',
        'smash ultimate': 'ssbu',
        'mario kart wii': 'mkw',
        'mario kart 8': 'mk8',
        'mario kart 8 deluxe': 'mk8d',
        'street fighter 6': 'sf6',
        'tekken 8': 't8',
        'guilty gear strive': 'ggs',
        'mortal kombat 1': 'mk1'
    };
    const gameKey = (gameName || 'tournament').toLowerCase();
    const gameCode = gameAbbreviations[gameKey] || gameKey.replace(/[^a-z0-9]/g, '').slice(0, 4);

    // Generate random suffix
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let i = 0; i < 4; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return `${venue}_${gameCode}_${month}${year}_${suffix}`;
}

/**
 * Add game name to tournament object (cross-db helper)
 */
function enrichWithGameName(tournament) {
    if (!tournament) return tournament;

    if (tournament.game_id) {
        const game = systemDb.getGameById(tournament.game_id);
        tournament.game_name = game ? game.name : null;
    } else {
        tournament.game_name = null;
    }

    return tournament;
}

/**
 * Parse format_settings_json, round_labels_json, and add game name (combined enrichment helper)
 */
function enrichTournament(tournament) {
    if (!tournament) return tournament;

    // Add game name from system.db
    enrichWithGameName(tournament);

    // Parse format_settings JSON
    tournament.format_settings = tournament.format_settings_json
        ? JSON.parse(tournament.format_settings_json)
        : null;

    // Parse round_labels JSON
    tournament.round_labels = tournament.round_labels_json
        ? JSON.parse(tournament.round_labels_json)
        : null;

    return tournament;
}

/**
 * Create a new tournament
 * @param {Object} data - Tournament data
 * @param {number} userId - Owner user ID for tenant isolation (optional for backward compatibility)
 */
function create(data, userId = null) {
    const logComplete = logger.start('create', { name: data.name, type: data.tournament_type, userId });
    const db = tournamentsDb.getDb();

    // Generate URL slug if not provided
    const urlSlug = data.url_slug || generateUrlSlug(data.name, data.game_name, data.starts_at);

    // Look up game_id from game name if needed
    // Auto-create game if it doesn't exist
    let gameId = data.game_id;
    if (!gameId && data.game_name) {
        const game = systemDb.getGameByName(data.game_name) ||
                     systemDb.ensureGame(data.game_name);
        if (game) {
            gameId = game.id;
        }
    }

    const stmt = db.prepare(`
        INSERT INTO tcc_tournaments (
            name, url_slug, description, game_id, tournament_type, state,
            signup_cap, open_signup, check_in_duration, registration_open_at,
            starts_at, hold_third_place_match, grand_finals_modifier,
            swiss_rounds, ranked_by, show_rounds, hide_seeds, sequential_pairings,
            private, format_settings_json, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        data.name,
        urlSlug,
        data.description || null,
        gameId || null,
        data.tournament_type || 'double_elimination',
        data.state || 'pending',
        data.signup_cap || null,
        data.open_signup ? 1 : 0,
        data.check_in_duration || null,
        data.registration_open_at || null,
        data.starts_at || null,
        data.hold_third_place_match ? 1 : 0,
        data.grand_finals_modifier || null,
        data.swiss_rounds || null,
        data.ranked_by || 'match wins',
        data.show_rounds !== false ? 1 : 0,
        data.hide_seeds ? 1 : 0,
        data.sequential_pairings ? 1 : 0,
        data.private ? 1 : 0,
        data.format_settings_json ? JSON.stringify(data.format_settings_json) : null,
        userId
    );

    const tournament = getById(result.lastInsertRowid);
    logComplete({ tournamentId: tournament.id, urlSlug: tournament.url_slug, userId });
    return tournament;
}

/**
 * Get tournament by ID
 */
function getById(id) {
    logger.log('getById', { id });
    const db = tournamentsDb.getDb();
    const tournament = db.prepare(`
        SELECT * FROM tcc_tournaments WHERE id = ?
    `).get(id);

    if (tournament) {
        // Enrich with game name and parse format_settings
        enrichTournament(tournament);

        // Get participant count
        const countResult = db.prepare(`
            SELECT COUNT(*) as count FROM tcc_participants
            WHERE tournament_id = ? AND active = 1
        `).get(id);
        tournament.participants_count = countResult.count;
    }

    return tournament;
}

/**
 * Get tournament by URL slug
 */
function getBySlug(slug) {
    const db = tournamentsDb.getDb();
    const tournament = db.prepare(`
        SELECT * FROM tcc_tournaments WHERE url_slug = ?
    `).get(slug);

    if (tournament) {
        // Enrich with game name and parse format_settings
        enrichTournament(tournament);

        const countResult = db.prepare(`
            SELECT COUNT(*) as count FROM tcc_participants
            WHERE tournament_id = ? AND active = 1
        `).get(tournament.id);
        tournament.participants_count = countResult.count;
    }

    return tournament;
}

/**
 * List tournaments with optional filters
 * @param {Object} filters - Filter options
 * @param {number|null} userId - User ID for tenant filtering (null = all users, for superadmin)
 */
function list(filters = {}, userId = null) {
    logger.log('list', { filters, userId });
    const db = tournamentsDb.getDb();

    let sql = `
        SELECT t.*,
               (SELECT COUNT(*) FROM tcc_participants WHERE tournament_id = t.id AND active = 1) as participants_count
        FROM tcc_tournaments t
        WHERE 1=1
    `;
    const params = [];

    // Tenant isolation: filter by user_id unless null (superadmin viewing all)
    if (userId !== null) {
        sql += ' AND t.user_id = ?';
        params.push(userId);
    }

    if (filters.state) {
        if (Array.isArray(filters.state)) {
            sql += ` AND t.state IN (${filters.state.map(() => '?').join(',')})`;
            params.push(...filters.state);
        } else {
            sql += ' AND t.state = ?';
            params.push(filters.state);
        }
    }

    if (filters.game_id) {
        sql += ' AND t.game_id = ?';
        params.push(filters.game_id);
    }

    if (filters.tournament_type) {
        sql += ' AND t.tournament_type = ?';
        params.push(filters.tournament_type);
    }

    if (filters.created_after) {
        sql += ' AND t.created_at >= ?';
        params.push(filters.created_after);
    }

    if (filters.starts_before) {
        sql += ' AND t.starts_at <= ?';
        params.push(filters.starts_before);
    }

    // Default sort: pending first (by starts_at), then others by created_at desc
    sql += " ORDER BY CASE WHEN t.state = 'pending' THEN 0 ELSE 1 END, t.starts_at ASC, t.created_at DESC";

    if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
    }

    const tournaments = db.prepare(sql).all(...params);

    // Enrich each tournament with game name
    const result = tournaments.map(t => {
        enrichWithGameName(t);
        t.format_settings = t.format_settings_json ? JSON.parse(t.format_settings_json) : null;
        return t;
    });
    logger.log('list:result', { count: result.length, userId });
    return result;
}

/**
 * Update tournament
 */
function update(id, data) {
    const logComplete = logger.start('update', { id, fields: Object.keys(data) });
    const db = tournamentsDb.getDb();

    // Handle game_name -> game_id lookup (similar to create())
    // If game_name is provided but game_id is not, look up or create the game
    if (data.game_name !== undefined && data.game_id === undefined) {
        if (data.game_name) {
            // Try to find existing game, or create it
            const game = systemDb.getGameByName(data.game_name) ||
                         systemDb.ensureGame(data.game_name);
            if (game) {
                data.game_id = game.id;
            }
        } else {
            // Empty string or null means clear the game
            data.game_id = null;
        }
    }

    // Build dynamic update query
    const updates = [];
    const params = [];

    const allowedFields = [
        'name', 'description', 'game_id', 'tournament_type', 'state',
        'signup_cap', 'open_signup', 'check_in_duration', 'registration_open_at',
        'starts_at', 'started_at', 'completed_at',
        'hold_third_place_match', 'grand_finals_modifier', 'swiss_rounds',
        'ranked_by', 'show_rounds', 'hide_seeds', 'sequential_pairings',
        'private', 'format_settings_json', 'round_labels_json'
    ];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            updates.push(`${field} = ?`);
            if ((field === 'format_settings_json' || field === 'round_labels_json') && typeof data[field] === 'object') {
                params.push(JSON.stringify(data[field]));
            } else if (typeof data[field] === 'boolean') {
                params.push(data[field] ? 1 : 0);
            } else {
                params.push(data[field]);
            }
        }
    }

    if (updates.length === 0) {
        logComplete({ noChanges: true });
        return getById(id);
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    const sql = `UPDATE tcc_tournaments SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...params);

    const tournament = getById(id);
    logComplete({ updatedFields: updates.length - 1 });
    return tournament;
}

/**
 * Update tournament state
 */
function updateState(id, newState) {
    const logComplete = logger.start('updateState', { id, newState });
    const db = tournamentsDb.getDb();
    const now = new Date().toISOString();

    const updates = { state: newState, updated_at: now };

    // Set appropriate timestamp based on state
    switch (newState) {
        case 'underway':
            updates.started_at = now;
            break;
        case 'complete':
            updates.completed_at = now;
            break;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const sql = `UPDATE tcc_tournaments SET ${setClauses} WHERE id = ?`;

    db.prepare(sql).run(...Object.values(updates), id);

    const tournament = getById(id);
    logComplete({ previousState: tournament?.state, newState });
    return tournament;
}

/**
 * Delete tournament
 */
function deleteTournament(id) {
    logger.log('delete', { id });
    const db = tournamentsDb.getDb();

    // Cascading delete will handle matches, participants, stations, standings
    const result = db.prepare('DELETE FROM tcc_tournaments WHERE id = ?').run(id);

    logger.log('delete:result', { id, deleted: result.changes > 0 });
    return result.changes > 0;
}

/**
 * Get tournament stats
 */
function getStats(id) {
    const db = tournamentsDb.getDb();

    const stats = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM tcc_participants WHERE tournament_id = ? AND active = 1) as participant_count,
            (SELECT COUNT(*) FROM tcc_participants WHERE tournament_id = ? AND checked_in = 1) as checked_in_count,
            (SELECT COUNT(*) FROM tcc_matches WHERE tournament_id = ?) as total_matches,
            (SELECT COUNT(*) FROM tcc_matches WHERE tournament_id = ? AND state = 'complete') as completed_matches,
            (SELECT COUNT(*) FROM tcc_matches WHERE tournament_id = ? AND state = 'open') as open_matches,
            (SELECT COUNT(*) FROM tcc_stations WHERE tournament_id = ? AND active = 1) as station_count
    `).get(id, id, id, id, id, id);

    return stats;
}

/**
 * Check if tournament can be started
 */
function canStart(id) {
    const tournament = getById(id);
    if (!tournament) return { canStart: false, reason: 'Tournament not found' };

    if (tournament.state !== 'pending' && tournament.state !== 'checking_in') {
        return { canStart: false, reason: `Tournament is already ${tournament.state}` };
    }

    const db = tournamentsDb.getDb();
    const participantCount = db.prepare(`
        SELECT COUNT(*) as count FROM tcc_participants
        WHERE tournament_id = ? AND active = 1
    `).get(id).count;

    if (participantCount < 2) {
        return { canStart: false, reason: 'Need at least 2 participants' };
    }

    return { canStart: true, participantCount };
}

/**
 * Check if tournament can be reset
 */
function canReset(id) {
    const tournament = getById(id);
    if (!tournament) return { canReset: false, reason: 'Tournament not found' };

    if (tournament.state === 'pending') {
        return { canReset: false, reason: 'Tournament has not started yet' };
    }

    return { canReset: true };
}

/**
 * Get tournament owner (user_id) by tournament ID
 * Used for tenant access validation
 */
function getOwnerId(tournamentId) {
    const db = tournamentsDb.getDb();
    const result = db.prepare('SELECT user_id FROM tcc_tournaments WHERE id = ?').get(tournamentId);
    return result ? result.user_id : null;
}

/**
 * Check if user owns tournament
 * @param {number} tournamentId - Tournament ID
 * @param {number} userId - User ID to check
 * @returns {boolean}
 */
function isOwner(tournamentId, userId) {
    const ownerId = getOwnerId(tournamentId);
    return ownerId === userId;
}

/**
 * List tournaments for a specific user
 * Convenience function that calls list with userId
 */
function listByUser(userId, filters = {}) {
    return list(filters, userId);
}

/**
 * Get custom round labels for a tournament
 * @param {number} id - Tournament ID
 * @returns {Object|null} - Parsed round labels object or null
 */
function getRoundLabels(id) {
    logger.log('getRoundLabels', { id });
    const db = tournamentsDb.getDb();
    const result = db.prepare('SELECT round_labels_json FROM tcc_tournaments WHERE id = ?').get(id);

    if (!result || !result.round_labels_json) {
        return null;
    }

    try {
        return JSON.parse(result.round_labels_json);
    } catch (e) {
        logger.log('getRoundLabels:parseError', { id, error: e.message });
        return null;
    }
}

/**
 * Set custom round labels for a tournament
 * @param {number} id - Tournament ID
 * @param {Object} labels - Round labels object { winners: { "1": "Label", ... }, losers: { ... } }
 * @returns {Object} - Updated tournament
 */
function setRoundLabels(id, labels) {
    logger.log('setRoundLabels', { id, labels });
    const db = tournamentsDb.getDb();

    // Validate labels structure
    if (labels !== null && typeof labels !== 'object') {
        throw new Error('Round labels must be an object or null');
    }

    // Clean empty labels (remove entries where value is empty string)
    let cleanedLabels = null;
    if (labels) {
        cleanedLabels = {};
        for (const bracket of ['winners', 'losers']) {
            if (labels[bracket] && typeof labels[bracket] === 'object') {
                cleanedLabels[bracket] = {};
                for (const [round, label] of Object.entries(labels[bracket])) {
                    if (label && typeof label === 'string' && label.trim()) {
                        cleanedLabels[bracket][round] = label.trim();
                    }
                }
                // Remove bracket key if empty
                if (Object.keys(cleanedLabels[bracket]).length === 0) {
                    delete cleanedLabels[bracket];
                }
            }
        }
        // Set to null if no labels remain
        if (Object.keys(cleanedLabels).length === 0) {
            cleanedLabels = null;
        }
    }

    const jsonValue = cleanedLabels ? JSON.stringify(cleanedLabels) : null;
    db.prepare(`
        UPDATE tcc_tournaments
        SET round_labels_json = ?, updated_at = ?
        WHERE id = ?
    `).run(jsonValue, new Date().toISOString(), id);

    return getById(id);
}

module.exports = {
    generateUrlSlug,
    create,
    getById,
    getBySlug,
    list,
    listByUser,
    update,
    updateState,
    delete: deleteTournament,
    getStats,
    canStart,
    canReset,
    getOwnerId,
    isOwner,
    getRoundLabels,
    setRoundLabels
};
