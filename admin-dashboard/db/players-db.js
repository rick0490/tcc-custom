/**
 * Players Database Module
 * SQLite database for historical analytics and player data
 *
 * Contains: players, player_aliases, tournaments (archived), tournament_participants,
 *           matches (archived), player_ratings, rating_history, unmatched_players,
 *           ai_seeding_cache, tournament_narratives
 *
 * This database is critical for backup - contains all historical data.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'players.db');
let db = null;

// Elo rating constants
const ELO_K_FACTOR = 32;
const ELO_INITIAL_RATING = 1200;

/**
 * Initialize database connection and create tables
 */
function initDatabase() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        -- Canonical player identity
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            canonical_name TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            email TEXT,
            instagram TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Player name aliases for fuzzy matching
        CREATE TABLE IF NOT EXISTS player_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            alias TEXT NOT NULL,
            normalized_alias TEXT UNIQUE NOT NULL,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
        );

        -- Archived tournament records
        CREATE TABLE IF NOT EXISTS tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER,                  -- Original ID from tournaments.db or Challonge
            source_url TEXT UNIQUE,             -- URL slug or Challonge URL
            name TEXT NOT NULL,
            game_id INTEGER,                    -- References system.db games (app-level)
            tournament_type TEXT,
            participant_count INTEGER,
            started_at DATETIME,
            completed_at DATETIME,
            archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Archived participation records
        CREATE TABLE IF NOT EXISTS tournament_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            player_id INTEGER NOT NULL,
            original_participant_id INTEGER,    -- From source system
            seed INTEGER,
            final_rank INTEGER,
            checked_in INTEGER DEFAULT 0,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
            FOREIGN KEY (player_id) REFERENCES players(id),
            UNIQUE(tournament_id, player_id)
        );

        -- Archived match results
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            original_match_id INTEGER,          -- From source system
            round INTEGER NOT NULL,
            match_identifier TEXT,
            player1_id INTEGER,
            player2_id INTEGER,
            winner_id INTEGER,
            loser_id INTEGER,
            player1_score INTEGER,
            player2_score INTEGER,
            scores_csv TEXT,
            completed_at DATETIME,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
            FOREIGN KEY (player1_id) REFERENCES players(id),
            FOREIGN KEY (player2_id) REFERENCES players(id),
            FOREIGN KEY (winner_id) REFERENCES players(id),
            FOREIGN KEY (loser_id) REFERENCES players(id)
        );

        -- Current Elo ratings per player per game
        CREATE TABLE IF NOT EXISTS player_ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            game_id INTEGER NOT NULL,           -- References system.db games (app-level)
            elo_rating INTEGER DEFAULT ${ELO_INITIAL_RATING},
            peak_rating INTEGER DEFAULT ${ELO_INITIAL_RATING},
            matches_played INTEGER DEFAULT 0,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            last_active DATETIME,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            UNIQUE(player_id, game_id)
        );

        -- Elo change history
        CREATE TABLE IF NOT EXISTS rating_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            game_id INTEGER NOT NULL,
            tournament_id INTEGER NOT NULL,
            rating_before INTEGER NOT NULL,
            rating_after INTEGER NOT NULL,
            rating_change INTEGER NOT NULL,
            recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
        );

        -- Unmatched player names queue
        CREATE TABLE IF NOT EXISTS unmatched_players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER,
            original_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            suggested_player_id INTEGER,
            similarity_score REAL,
            resolved INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
            FOREIGN KEY (suggested_player_id) REFERENCES players(id)
        );

        -- AI seeding suggestions cache
        CREATE TABLE IF NOT EXISTS ai_seeding_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT UNIQUE NOT NULL,
            tournament_url TEXT NOT NULL,
            game_id INTEGER,
            suggestions_json TEXT NOT NULL,
            participant_hash TEXT NOT NULL,
            locked_seeds_json TEXT,
            generation_count INTEGER DEFAULT 1,
            source TEXT DEFAULT 'ai',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- AI tournament narratives
        CREATE TABLE IF NOT EXISTS tournament_narratives (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            format TEXT NOT NULL,
            narrative TEXT NOT NULL,
            social_post TEXT,
            data_hash TEXT NOT NULL,
            storylines_json TEXT,
            metadata_json TEXT,
            source TEXT DEFAULT 'ai',
            generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
            UNIQUE(tournament_id, format)
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_players_canonical ON players(canonical_name);
        CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);

        CREATE INDEX IF NOT EXISTS idx_player_aliases_player ON player_aliases(player_id);
        CREATE INDEX IF NOT EXISTS idx_player_aliases_normalized ON player_aliases(normalized_alias);

        CREATE INDEX IF NOT EXISTS idx_tournaments_game ON tournaments(game_id);
        CREATE INDEX IF NOT EXISTS idx_tournaments_completed ON tournaments(completed_at);
        CREATE INDEX IF NOT EXISTS idx_tournaments_source ON tournaments(source_url);

        CREATE INDEX IF NOT EXISTS idx_tournament_participants_tournament ON tournament_participants(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_tournament_participants_player ON tournament_participants(player_id);
        CREATE INDEX IF NOT EXISTS idx_tournament_participants_rank ON tournament_participants(tournament_id, final_rank);

        CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(tournament_id, round);
        CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_id);
        CREATE INDEX IF NOT EXISTS idx_matches_loser ON matches(loser_id);

        CREATE INDEX IF NOT EXISTS idx_player_ratings_player ON player_ratings(player_id);
        CREATE INDEX IF NOT EXISTS idx_player_ratings_game ON player_ratings(game_id);
        CREATE INDEX IF NOT EXISTS idx_player_ratings_elo ON player_ratings(game_id, elo_rating DESC);

        CREATE INDEX IF NOT EXISTS idx_rating_history_player ON rating_history(player_id);
        CREATE INDEX IF NOT EXISTS idx_rating_history_tournament ON rating_history(tournament_id);

        CREATE INDEX IF NOT EXISTS idx_unmatched_resolved ON unmatched_players(resolved);
        CREATE INDEX IF NOT EXISTS idx_narratives_tournament ON tournament_narratives(tournament_id);
    `);

    console.log('[Players DB] Database initialized at', DB_PATH);
    return db;
}

/**
 * Get database instance
 */
function getDb() {
    if (!db) {
        initDatabase();
    }
    return db;
}

/**
 * Close database connection
 */
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Get database file path
 */
function getDbPath() {
    return DB_PATH;
}

// =============================================================================
// NAME NORMALIZATION & MATCHING
// =============================================================================

/**
 * Normalize a player name for matching
 */
function normalizePlayerName(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g, '')  // Remove special chars
        .replace(/\s+/g, ' ')          // Normalize whitespace
        .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}

/**
 * Find matching player by name
 * Returns { player, matchType } or null
 */
function findPlayerByName(name) {
    const database = getDb();
    const normalized = normalizePlayerName(name);

    if (!normalized) return null;

    // 1. Exact match on canonical name
    let player = database.prepare(`
        SELECT * FROM players WHERE canonical_name = ?
    `).get(normalized);

    if (player) {
        return { player, matchType: 'exact' };
    }

    // 2. Exact match on alias
    const alias = database.prepare(`
        SELECT p.* FROM players p
        JOIN player_aliases a ON p.id = a.player_id
        WHERE a.normalized_alias = ?
    `).get(normalized);

    if (alias) {
        return { player: alias, matchType: 'alias' };
    }

    // 3. Fuzzy match with Levenshtein distance
    const allPlayers = database.prepare(`SELECT * FROM players`).all();
    let bestMatch = null;
    let bestDistance = Infinity;

    for (const p of allPlayers) {
        const distance = levenshteinDistance(normalized, p.canonical_name);
        if (distance < bestDistance && distance <= 2) {
            bestDistance = distance;
            bestMatch = p;
        }
    }

    if (bestMatch && bestDistance <= 1) {
        return { player: bestMatch, matchType: 'fuzzy', distance: bestDistance };
    }

    if (bestMatch && bestDistance === 2) {
        return { player: bestMatch, matchType: 'suggestion', distance: bestDistance };
    }

    return null;
}

/**
 * Get or create a player
 */
function getOrCreatePlayer(name, options = {}) {
    const match = findPlayerByName(name);
    if (match && match.matchType !== 'suggestion') {
        return match.player;
    }

    // Create new player
    const database = getDb();
    const normalized = normalizePlayerName(name);

    const result = database.prepare(`
        INSERT INTO players (canonical_name, display_name, email, instagram)
        VALUES (?, ?, ?, ?)
    `).run(normalized, name, options.email || null, options.instagram || null);

    return {
        id: result.lastInsertRowid,
        canonical_name: normalized,
        display_name: name,
        email: options.email || null,
        instagram: options.instagram || null
    };
}

/**
 * Add alias to player
 */
function addPlayerAlias(playerId, alias) {
    const database = getDb();
    const normalized = normalizePlayerName(alias);

    try {
        database.prepare(`
            INSERT INTO player_aliases (player_id, alias, normalized_alias)
            VALUES (?, ?, ?)
        `).run(playerId, alias, normalized);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Get player by ID
 */
function getPlayerById(playerId) {
    return getDb().prepare('SELECT * FROM players WHERE id = ?').get(playerId);
}

/**
 * Get all players
 */
function getAllPlayers(options = {}) {
    const { limit = 100, offset = 0, search = '' } = options;
    const database = getDb();

    if (search) {
        const searchPattern = `%${search.toLowerCase()}%`;
        return database.prepare(`
            SELECT * FROM players
            WHERE canonical_name LIKE ? OR display_name LIKE ?
            ORDER BY display_name
            LIMIT ? OFFSET ?
        `).all(searchPattern, searchPattern, limit, offset);
    }

    return database.prepare(`
        SELECT * FROM players
        ORDER BY display_name
        LIMIT ? OFFSET ?
    `).all(limit, offset);
}

// =============================================================================
// TOURNAMENT ARCHIVING
// =============================================================================

/**
 * Check if tournament is already archived
 */
function isTournamentArchived(sourceUrl) {
    const existing = getDb().prepare(`SELECT id FROM tournaments WHERE source_url = ?`).get(sourceUrl);
    return !!existing;
}

/**
 * Archive a tournament
 */
function archiveTournament(data) {
    const database = getDb();

    const result = database.prepare(`
        INSERT INTO tournaments (
            source_id, source_url, name, game_id, tournament_type,
            participant_count, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        data.sourceId,
        data.sourceUrl,
        data.name,
        data.gameId,
        data.tournamentType,
        data.participantCount,
        data.startedAt,
        data.completedAt
    );

    return result.lastInsertRowid;
}

/**
 * Get archived tournaments
 */
function getArchivedTournaments(options = {}) {
    const { gameId, limit = 50, offset = 0 } = options;

    let query = `SELECT * FROM tournaments`;
    const params = [];

    if (gameId) {
        query += ` WHERE game_id = ?`;
        params.push(gameId);
    }

    query += ` ORDER BY completed_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    return getDb().prepare(query).all(...params);
}

/**
 * Get tournament by ID
 */
function getTournamentById(tournamentId) {
    return getDb().prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
}

/**
 * Add participant to archived tournament
 */
function addTournamentParticipant(data) {
    const database = getDb();

    try {
        const result = database.prepare(`
            INSERT INTO tournament_participants (
                tournament_id, player_id, original_participant_id, seed, final_rank, checked_in
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            data.tournamentId,
            data.playerId,
            data.originalParticipantId || null,
            data.seed || null,
            data.finalRank || null,
            data.checkedIn ? 1 : 0
        );
        return result.lastInsertRowid;
    } catch (e) {
        return null; // Duplicate
    }
}

/**
 * Add match to archived tournament
 */
function addMatch(data) {
    const database = getDb();

    const result = database.prepare(`
        INSERT INTO matches (
            tournament_id, original_match_id, round, match_identifier,
            player1_id, player2_id, winner_id, loser_id,
            player1_score, player2_score, scores_csv, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        data.tournamentId,
        data.originalMatchId || null,
        data.round,
        data.matchIdentifier || null,
        data.player1Id || null,
        data.player2Id || null,
        data.winnerId || null,
        data.loserId || null,
        data.player1Score || null,
        data.player2Score || null,
        data.scoresCsv || null,
        data.completedAt || null
    );

    return result.lastInsertRowid;
}

// =============================================================================
// ELO RATINGS
// =============================================================================

/**
 * Calculate Elo change
 */
function calculateEloChange(winnerRating, loserRating, kFactor = ELO_K_FACTOR) {
    const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const change = Math.round(kFactor * (1 - expectedWinner));
    return change;
}

/**
 * Get or create player rating for a game
 */
function getOrCreateRating(playerId, gameId) {
    const database = getDb();

    let rating = database.prepare(`
        SELECT * FROM player_ratings WHERE player_id = ? AND game_id = ?
    `).get(playerId, gameId);

    if (!rating) {
        database.prepare(`
            INSERT INTO player_ratings (player_id, game_id, elo_rating, peak_rating)
            VALUES (?, ?, ?, ?)
        `).run(playerId, gameId, ELO_INITIAL_RATING, ELO_INITIAL_RATING);

        rating = {
            player_id: playerId,
            game_id: gameId,
            elo_rating: ELO_INITIAL_RATING,
            peak_rating: ELO_INITIAL_RATING,
            matches_played: 0,
            wins: 0,
            losses: 0
        };
    }

    return rating;
}

/**
 * Update Elo after a match
 */
function updateEloForMatch(winnerId, loserId, gameId, tournamentId) {
    const database = getDb();

    const winnerRating = getOrCreateRating(winnerId, gameId);
    const loserRating = getOrCreateRating(loserId, gameId);

    const change = calculateEloChange(winnerRating.elo_rating, loserRating.elo_rating);
    const now = new Date().toISOString();

    // Update winner
    const newWinnerRating = winnerRating.elo_rating + change;
    const newWinnerPeak = Math.max(winnerRating.peak_rating, newWinnerRating);

    database.prepare(`
        UPDATE player_ratings SET
            elo_rating = ?,
            peak_rating = ?,
            matches_played = matches_played + 1,
            wins = wins + 1,
            last_active = ?
        WHERE player_id = ? AND game_id = ?
    `).run(newWinnerRating, newWinnerPeak, now, winnerId, gameId);

    // Record winner history
    database.prepare(`
        INSERT INTO rating_history (player_id, game_id, tournament_id, rating_before, rating_after, rating_change)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(winnerId, gameId, tournamentId, winnerRating.elo_rating, newWinnerRating, change);

    // Update loser
    const newLoserRating = Math.max(100, loserRating.elo_rating - change);

    database.prepare(`
        UPDATE player_ratings SET
            elo_rating = ?,
            matches_played = matches_played + 1,
            losses = losses + 1,
            last_active = ?
        WHERE player_id = ? AND game_id = ?
    `).run(newLoserRating, now, loserId, gameId);

    // Record loser history
    database.prepare(`
        INSERT INTO rating_history (player_id, game_id, tournament_id, rating_before, rating_after, rating_change)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(loserId, gameId, tournamentId, loserRating.elo_rating, newLoserRating, -change);

    return { change, winnerNewRating: newWinnerRating, loserNewRating: newLoserRating };
}

/**
 * Get player rankings for a game
 */
function getPlayerRankings(gameId, options = {}) {
    const { limit = 50, offset = 0 } = options;

    return getDb().prepare(`
        SELECT pr.*, p.display_name, p.canonical_name
        FROM player_ratings pr
        JOIN players p ON pr.player_id = p.id
        WHERE pr.game_id = ?
        ORDER BY pr.elo_rating DESC
        LIMIT ? OFFSET ?
    `).all(gameId, limit, offset);
}

/**
 * Get player stats
 */
function getPlayerStats(playerId) {
    const database = getDb();

    const player = getPlayerById(playerId);
    if (!player) return null;

    const ratings = database.prepare(`
        SELECT * FROM player_ratings WHERE player_id = ?
    `).all(playerId);

    const tournaments = database.prepare(`
        SELECT COUNT(*) as count FROM tournament_participants WHERE player_id = ?
    `).get(playerId);

    const recentMatches = database.prepare(`
        SELECT m.*, t.name as tournament_name
        FROM matches m
        JOIN tournaments t ON m.tournament_id = t.id
        WHERE m.player1_id = ? OR m.player2_id = ?
        ORDER BY m.completed_at DESC
        LIMIT 10
    `).all(playerId, playerId);

    return {
        player,
        ratings,
        tournamentCount: tournaments.count,
        recentMatches
    };
}

/**
 * Get head-to-head record
 */
function getHeadToHead(player1Id, player2Id, gameId = null) {
    const database = getDb();

    let query = `
        SELECT m.*, t.name as tournament_name, t.game_id
        FROM matches m
        JOIN tournaments t ON m.tournament_id = t.id
        WHERE ((m.player1_id = ? AND m.player2_id = ?) OR (m.player1_id = ? AND m.player2_id = ?))
    `;
    const params = [player1Id, player2Id, player2Id, player1Id];

    if (gameId) {
        query += ` AND t.game_id = ?`;
        params.push(gameId);
    }

    query += ` ORDER BY m.completed_at DESC`;

    const matches = database.prepare(query).all(...params);

    const record = {
        player1Wins: 0,
        player2Wins: 0,
        matches: matches
    };

    for (const match of matches) {
        if (match.winner_id === player1Id) {
            record.player1Wins++;
        } else if (match.winner_id === player2Id) {
            record.player2Wins++;
        }
    }

    return record;
}

// =============================================================================
// AI SEEDING CACHE
// =============================================================================

/**
 * Get AI seeding cache
 */
function getAISeedingCache(tournamentId) {
    return getDb().prepare(`
        SELECT * FROM ai_seeding_cache WHERE tournament_id = ?
    `).get(tournamentId);
}

/**
 * Save AI seeding cache
 */
function saveAISeedingCache(data) {
    const database = getDb();
    const now = new Date().toISOString();

    database.prepare(`
        INSERT INTO ai_seeding_cache (
            tournament_id, tournament_url, game_id, suggestions_json,
            participant_hash, locked_seeds_json, generation_count, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tournament_id) DO UPDATE SET
            suggestions_json = excluded.suggestions_json,
            participant_hash = excluded.participant_hash,
            locked_seeds_json = excluded.locked_seeds_json,
            generation_count = ai_seeding_cache.generation_count + 1,
            updated_at = '${now}'
    `).run(
        data.tournamentId,
        data.tournamentUrl,
        data.gameId || null,
        JSON.stringify(data.suggestions),
        data.participantHash,
        data.lockedSeeds ? JSON.stringify(data.lockedSeeds) : null,
        data.generationCount || 1,
        data.source || 'ai'
    );
}

/**
 * Delete AI seeding cache
 */
function deleteAISeedingCache(tournamentId) {
    getDb().prepare('DELETE FROM ai_seeding_cache WHERE tournament_id = ?').run(tournamentId);
}

// =============================================================================
// TOURNAMENT NARRATIVES
// =============================================================================

/**
 * Get narrative cache
 */
function getNarrativeCache(tournamentId, format) {
    return getDb().prepare(`
        SELECT * FROM tournament_narratives WHERE tournament_id = ? AND format = ?
    `).get(tournamentId, format);
}

/**
 * Save narrative cache
 */
function saveNarrativeCache(data) {
    const database = getDb();

    database.prepare(`
        INSERT INTO tournament_narratives (
            tournament_id, format, narrative, social_post, data_hash,
            storylines_json, metadata_json, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tournament_id, format) DO UPDATE SET
            narrative = excluded.narrative,
            social_post = excluded.social_post,
            data_hash = excluded.data_hash,
            storylines_json = excluded.storylines_json,
            metadata_json = excluded.metadata_json,
            generated_at = CURRENT_TIMESTAMP
    `).run(
        data.tournamentId,
        data.format,
        data.narrative,
        data.socialPost || null,
        data.dataHash,
        data.storylines ? JSON.stringify(data.storylines) : null,
        data.metadata ? JSON.stringify(data.metadata) : null,
        data.source || 'ai'
    );
}

/**
 * Delete narrative cache for tournament
 */
function deleteNarrativeCache(tournamentId) {
    getDb().prepare('DELETE FROM tournament_narratives WHERE tournament_id = ?').run(tournamentId);
}

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Get overview statistics
 */
function getOverviewStats() {
    const database = getDb();

    const tournaments = database.prepare('SELECT COUNT(*) as count FROM tournaments').get();
    const players = database.prepare('SELECT COUNT(*) as count FROM players').get();
    const matches = database.prepare('SELECT COUNT(*) as count FROM matches').get();

    const avgAttendance = database.prepare(`
        SELECT AVG(participant_count) as avg FROM tournaments
    `).get();

    return {
        tournamentCount: tournaments.count,
        playerCount: players.count,
        matchCount: matches.count,
        averageAttendance: Math.round(avgAttendance.avg || 0)
    };
}

/**
 * Get Elo changes for a tournament (for PDF export)
 */
function getEloChangesForTournament(tournamentId) {
    return getDb().prepare(`
        SELECT rh.*, p.display_name
        FROM rating_history rh
        JOIN players p ON rh.player_id = p.id
        WHERE rh.tournament_id = ?
        ORDER BY rh.rating_change DESC
    `).all(tournamentId);
}

module.exports = {
    // Core functions
    initDatabase,
    getDb,
    closeDatabase,
    getDbPath,
    DB_PATH,

    // Constants
    ELO_K_FACTOR,
    ELO_INITIAL_RATING,

    // Name matching
    normalizePlayerName,
    levenshteinDistance,
    findPlayerByName,
    getOrCreatePlayer,
    addPlayerAlias,
    getPlayerById,
    getAllPlayers,

    // Tournament archiving
    isTournamentArchived,
    archiveTournament,
    getArchivedTournaments,
    getTournamentById,
    addTournamentParticipant,
    addMatch,

    // Elo ratings
    calculateEloChange,
    getOrCreateRating,
    updateEloForMatch,
    getPlayerRankings,
    getPlayerStats,
    getHeadToHead,

    // AI Seeding
    getAISeedingCache,
    saveAISeedingCache,
    deleteAISeedingCache,

    // Narratives
    getNarrativeCache,
    saveNarrativeCache,
    deleteNarrativeCache,

    // Statistics
    getOverviewStats,
    getEloChangesForTournament
};
