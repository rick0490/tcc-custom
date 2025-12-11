/**
 * Tournament Database Service
 * Local tournament management - replaces Challonge API
 */

const analyticsDb = require('../analytics-db');

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
 * Create a new tournament
 */
function create(data) {
    const db = analyticsDb.getDb();

    // Generate URL slug if not provided
    const urlSlug = data.url_slug || generateUrlSlug(data.name, data.game_name, data.starts_at);

    // Look up game_id from game name
    let gameId = data.game_id;
    if (!gameId && data.game_name) {
        const game = db.prepare('SELECT id FROM games WHERE name = ?').get(data.game_name);
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
            private, format_settings_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        data.format_settings_json ? JSON.stringify(data.format_settings_json) : null
    );

    return getById(result.lastInsertRowid);
}

/**
 * Get tournament by ID
 */
function getById(id) {
    const db = analyticsDb.getDb();
    const tournament = db.prepare(`
        SELECT t.*, g.name as game_name
        FROM tcc_tournaments t
        LEFT JOIN games g ON t.game_id = g.id
        WHERE t.id = ?
    `).get(id);

    if (tournament) {
        tournament.format_settings = tournament.format_settings_json
            ? JSON.parse(tournament.format_settings_json)
            : null;

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
    const db = analyticsDb.getDb();
    const tournament = db.prepare(`
        SELECT t.*, g.name as game_name
        FROM tcc_tournaments t
        LEFT JOIN games g ON t.game_id = g.id
        WHERE t.url_slug = ?
    `).get(slug);

    if (tournament) {
        tournament.format_settings = tournament.format_settings_json
            ? JSON.parse(tournament.format_settings_json)
            : null;

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
 */
function list(filters = {}) {
    const db = analyticsDb.getDb();

    let sql = `
        SELECT t.*, g.name as game_name,
               (SELECT COUNT(*) FROM tcc_participants WHERE tournament_id = t.id AND active = 1) as participants_count
        FROM tcc_tournaments t
        LEFT JOIN games g ON t.game_id = g.id
        WHERE 1=1
    `;
    const params = [];

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
    sql += ' ORDER BY CASE WHEN t.state = "pending" THEN 0 ELSE 1 END, t.starts_at ASC, t.created_at DESC';

    if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
    }

    const tournaments = db.prepare(sql).all(...params);

    return tournaments.map(t => {
        t.format_settings = t.format_settings_json ? JSON.parse(t.format_settings_json) : null;
        return t;
    });
}

/**
 * Update tournament
 */
function update(id, data) {
    const db = analyticsDb.getDb();

    // Build dynamic update query
    const updates = [];
    const params = [];

    const allowedFields = [
        'name', 'description', 'game_id', 'tournament_type', 'state',
        'signup_cap', 'open_signup', 'check_in_duration', 'registration_open_at',
        'starts_at', 'started_at', 'completed_at',
        'hold_third_place_match', 'grand_finals_modifier', 'swiss_rounds',
        'ranked_by', 'show_rounds', 'hide_seeds', 'sequential_pairings',
        'private', 'format_settings_json'
    ];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            updates.push(`${field} = ?`);
            if (field === 'format_settings_json' && typeof data[field] === 'object') {
                params.push(JSON.stringify(data[field]));
            } else if (typeof data[field] === 'boolean') {
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

    const sql = `UPDATE tcc_tournaments SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...params);

    return getById(id);
}

/**
 * Update tournament state
 */
function updateState(id, newState) {
    const db = analyticsDb.getDb();
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

    return getById(id);
}

/**
 * Delete tournament
 */
function deleteTournament(id) {
    const db = analyticsDb.getDb();

    // Cascading delete will handle matches, participants, stations, standings
    const result = db.prepare('DELETE FROM tcc_tournaments WHERE id = ?').run(id);

    return result.changes > 0;
}

/**
 * Get tournament stats
 */
function getStats(id) {
    const db = analyticsDb.getDb();

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

    const db = analyticsDb.getDb();
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

module.exports = {
    generateUrlSlug,
    create,
    getById,
    getBySlug,
    list,
    update,
    updateState,
    delete: deleteTournament,
    getStats,
    canStart,
    canReset
};
