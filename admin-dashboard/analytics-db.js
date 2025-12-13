/**
 * Analytics Database Module
 * SQLite database for historical tournament data
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'analytics.db');
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

    // Create tables
    db.exec(`
        -- Unified player identity
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            canonical_name TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            email TEXT,
            challonge_username TEXT,
            instagram TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Player aliases for fuzzy matching
        CREATE TABLE IF NOT EXISTS player_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            alias TEXT NOT NULL,
            normalized_alias TEXT NOT NULL,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            UNIQUE(normalized_alias)
        );

        -- Games list
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            short_code TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Archived tournaments
        CREATE TABLE IF NOT EXISTS tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            challonge_id INTEGER NOT NULL,
            challonge_url TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            game_id INTEGER NOT NULL,
            tournament_type TEXT NOT NULL,
            participant_count INTEGER NOT NULL,
            started_at DATETIME,
            completed_at DATETIME,
            archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            full_challonge_url TEXT,
            FOREIGN KEY (game_id) REFERENCES games(id)
        );

        -- Tournament participants
        CREATE TABLE IF NOT EXISTS tournament_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            player_id INTEGER NOT NULL,
            challonge_participant_id INTEGER NOT NULL,
            seed INTEGER,
            final_rank INTEGER,
            checked_in INTEGER DEFAULT 0,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
            FOREIGN KEY (player_id) REFERENCES players(id),
            UNIQUE(tournament_id, player_id)
        );

        -- Match results
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            challonge_match_id INTEGER NOT NULL,
            round INTEGER NOT NULL,
            player1_id INTEGER,
            player2_id INTEGER,
            winner_id INTEGER,
            loser_id INTEGER,
            player1_score INTEGER,
            player2_score INTEGER,
            scores_csv TEXT,
            completed_at DATETIME,
            match_identifier TEXT,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
            FOREIGN KEY (player1_id) REFERENCES players(id),
            FOREIGN KEY (player2_id) REFERENCES players(id),
            FOREIGN KEY (winner_id) REFERENCES players(id),
            FOREIGN KEY (loser_id) REFERENCES players(id)
        );

        -- Player Elo ratings per game
        CREATE TABLE IF NOT EXISTS player_ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            game_id INTEGER NOT NULL,
            elo_rating INTEGER DEFAULT ${ELO_INITIAL_RATING},
            peak_rating INTEGER DEFAULT ${ELO_INITIAL_RATING},
            matches_played INTEGER DEFAULT 0,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            last_active DATETIME,
            FOREIGN KEY (player_id) REFERENCES players(id),
            FOREIGN KEY (game_id) REFERENCES games(id),
            UNIQUE(player_id, game_id)
        );

        -- Rating history for trend charts
        CREATE TABLE IF NOT EXISTS rating_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            game_id INTEGER NOT NULL,
            tournament_id INTEGER NOT NULL,
            rating_before INTEGER NOT NULL,
            rating_after INTEGER NOT NULL,
            rating_change INTEGER NOT NULL,
            recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (player_id) REFERENCES players(id),
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
        );

        -- Unmatched players queue for manual review
        CREATE TABLE IF NOT EXISTS unmatched_players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            original_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            suggested_player_id INTEGER,
            similarity_score REAL,
            resolved INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
            FOREIGN KEY (suggested_player_id) REFERENCES players(id)
        );

        -- OAuth tokens storage (encrypted)
        CREATE TABLE IF NOT EXISTS oauth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL DEFAULT 'challonge',
            access_token_encrypted TEXT NOT NULL,
            refresh_token_encrypted TEXT,
            token_type TEXT DEFAULT 'Bearer',
            expires_at DATETIME NOT NULL,
            scope TEXT,
            challonge_user_id TEXT,
            challonge_username TEXT,
            iv TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(provider)
        );

        -- API tokens for device authentication (Stream Deck, automation, etc.)
        CREATE TABLE IF NOT EXISTS api_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_hash TEXT NOT NULL UNIQUE,
            device_name TEXT NOT NULL,
            device_type TEXT DEFAULT 'streamdeck',
            permissions TEXT DEFAULT 'full',
            created_at INTEGER NOT NULL,
            last_used_at INTEGER,
            expires_at INTEGER,
            created_by TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        );

        -- ============================================
        -- API RESPONSE CACHE TABLES
        -- ============================================

        -- Tournament list cache
        CREATE TABLE IF NOT EXISTS cache_tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cache_key TEXT NOT NULL UNIQUE,
            data_json TEXT NOT NULL,
            cached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL
        );

        -- Match data cache per tournament
        CREATE TABLE IF NOT EXISTS cache_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT NOT NULL UNIQUE,
            data_json TEXT NOT NULL,
            match_count INTEGER,
            cached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL
        );

        -- Participant cache per tournament
        CREATE TABLE IF NOT EXISTS cache_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT NOT NULL UNIQUE,
            data_json TEXT NOT NULL,
            participant_count INTEGER,
            cached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL
        );

        -- Station cache per tournament
        CREATE TABLE IF NOT EXISTS cache_stations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT NOT NULL UNIQUE,
            data_json TEXT NOT NULL,
            cached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL
        );

        -- Tournament details cache
        CREATE TABLE IF NOT EXISTS cache_tournament_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT NOT NULL UNIQUE,
            data_json TEXT NOT NULL,
            cached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL
        );

        -- Cache statistics for monitoring
        CREATE TABLE IF NOT EXISTS cache_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cache_type TEXT NOT NULL UNIQUE,
            hits INTEGER DEFAULT 0,
            misses INTEGER DEFAULT 0,
            api_calls_saved INTEGER DEFAULT 0,
            last_hit DATETIME,
            last_miss DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Tournament templates for quick setup
        CREATE TABLE IF NOT EXISTS tournament_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            game_name TEXT,
            is_default INTEGER DEFAULT 0,
            created_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            settings_json TEXT NOT NULL
        );

        -- ============================================
        -- PUSH NOTIFICATION TABLES
        -- ============================================

        -- Push notification subscriptions
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh_key TEXT NOT NULL,
            auth_key TEXT NOT NULL,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME
        );

        -- Notification preferences per user
        CREATE TABLE IF NOT EXISTS notification_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            match_completed INTEGER DEFAULT 1,
            checkin_deadline INTEGER DEFAULT 1,
            display_disconnected INTEGER DEFAULT 1,
            new_signup INTEGER DEFAULT 1,
            dq_timer_expired INTEGER DEFAULT 1,
            tournament_started INTEGER DEFAULT 1,
            sound_enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- AI Seeding Cache
        CREATE TABLE IF NOT EXISTS ai_seeding_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT NOT NULL UNIQUE,
            tournament_url TEXT NOT NULL,
            game_id INTEGER,
            suggestions_json TEXT NOT NULL,
            participant_hash TEXT NOT NULL,
            locked_seeds_json TEXT,
            generation_count INTEGER DEFAULT 1,
            source TEXT DEFAULT 'ai',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id)
        );

        -- Tournament Narratives Cache (AI-generated recaps)
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
            UNIQUE(tournament_id, format),
            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
        );

        -- ============================================
        -- TCC-CUSTOM: LOCAL TOURNAMENT MANAGEMENT TABLES
        -- These tables replace Challonge API dependency
        -- ============================================

        -- Local tournaments (replaces Challonge tournaments)
        CREATE TABLE IF NOT EXISTS tcc_tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url_slug TEXT NOT NULL UNIQUE,
            description TEXT,
            game_id INTEGER,
            tournament_type TEXT NOT NULL CHECK(tournament_type IN
                ('single_elimination', 'double_elimination', 'round_robin', 'swiss')),
            state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN
                ('pending', 'checking_in', 'underway', 'awaiting_review', 'complete')),

            -- Registration settings
            signup_cap INTEGER,
            open_signup INTEGER DEFAULT 0,
            check_in_duration INTEGER,
            registration_open_at DATETIME,

            -- Timestamps
            starts_at DATETIME,
            started_at DATETIME,
            completed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            -- Format-specific settings
            hold_third_place_match INTEGER DEFAULT 0,
            grand_finals_modifier TEXT CHECK(grand_finals_modifier IN ('single', 'skip', NULL)),
            swiss_rounds INTEGER,
            ranked_by TEXT DEFAULT 'match wins',
            show_rounds INTEGER DEFAULT 1,

            -- Seeding options
            hide_seeds INTEGER DEFAULT 0,
            sequential_pairings INTEGER DEFAULT 0,

            -- Privacy
            private INTEGER DEFAULT 0,

            -- Extended settings (JSON for flexibility)
            format_settings_json TEXT,

            FOREIGN KEY (game_id) REFERENCES games(id)
        );

        -- Local participants (replaces Challonge participants)
        CREATE TABLE IF NOT EXISTS tcc_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            player_id INTEGER,
            name TEXT NOT NULL,
            display_name TEXT,
            email TEXT,
            seed INTEGER,

            -- Status
            active INTEGER DEFAULT 1,
            checked_in INTEGER DEFAULT 0,
            checked_in_at DATETIME,
            on_waiting_list INTEGER DEFAULT 0,

            -- Results (set after tournament)
            final_rank INTEGER,

            -- Group stage (for pools/round robin groups)
            group_id INTEGER,
            group_seed INTEGER,

            -- Metadata
            misc TEXT,
            instagram TEXT,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE,
            FOREIGN KEY (player_id) REFERENCES players(id)
        );

        -- Local matches (replaces Challonge matches)
        CREATE TABLE IF NOT EXISTS tcc_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,

            -- Match identification
            identifier TEXT,
            round INTEGER NOT NULL,
            suggested_play_order INTEGER,

            -- Bracket position for visualization
            bracket_position INTEGER,
            losers_bracket INTEGER DEFAULT 0,

            -- Participants
            player1_id INTEGER,
            player2_id INTEGER,
            player1_prereq_match_id INTEGER,
            player2_prereq_match_id INTEGER,
            player1_is_prereq_loser INTEGER DEFAULT 0,
            player2_is_prereq_loser INTEGER DEFAULT 0,

            -- State
            state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN
                ('pending', 'open', 'complete')),

            -- Results
            winner_id INTEGER,
            loser_id INTEGER,
            player1_score INTEGER DEFAULT 0,
            player2_score INTEGER DEFAULT 0,
            scores_csv TEXT,
            forfeited INTEGER DEFAULT 0,
            forfeited_participant_id INTEGER,

            -- Station assignment
            station_id INTEGER,

            -- Timestamps
            underway_at DATETIME,
            completed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE,
            FOREIGN KEY (player1_id) REFERENCES tcc_participants(id),
            FOREIGN KEY (player2_id) REFERENCES tcc_participants(id),
            FOREIGN KEY (winner_id) REFERENCES tcc_participants(id),
            FOREIGN KEY (loser_id) REFERENCES tcc_participants(id),
            FOREIGN KEY (player1_prereq_match_id) REFERENCES tcc_matches(id),
            FOREIGN KEY (player2_prereq_match_id) REFERENCES tcc_matches(id),
            FOREIGN KEY (station_id) REFERENCES tcc_stations(id)
        );

        -- Local stations (replaces Challonge stations)
        CREATE TABLE IF NOT EXISTS tcc_stations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            current_match_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE,
            FOREIGN KEY (current_match_id) REFERENCES tcc_matches(id),
            UNIQUE(tournament_id, name)
        );

        -- Round robin/Swiss standings
        CREATE TABLE IF NOT EXISTS tcc_standings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            participant_id INTEGER NOT NULL,
            group_id INTEGER,

            -- Stats
            matches_played INTEGER DEFAULT 0,
            matches_won INTEGER DEFAULT 0,
            matches_lost INTEGER DEFAULT 0,
            matches_tied INTEGER DEFAULT 0,

            -- Games/Sets (for games within matches)
            games_won INTEGER DEFAULT 0,
            games_lost INTEGER DEFAULT 0,

            -- Points (configurable per tournament)
            points INTEGER DEFAULT 0,

            -- Tiebreakers
            buchholz_score REAL DEFAULT 0,
            head_to_head_json TEXT,

            -- Final position
            rank INTEGER,

            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE,
            FOREIGN KEY (participant_id) REFERENCES tcc_participants(id),
            UNIQUE(tournament_id, participant_id)
        );

        -- Create indexes for common queries
        CREATE INDEX IF NOT EXISTS idx_tournaments_game ON tournaments(game_id);
        CREATE INDEX IF NOT EXISTS idx_tournaments_completed ON tournaments(completed_at);
        CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(player1_id, player2_id);
        CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_id);
        CREATE INDEX IF NOT EXISTS idx_participants_player ON tournament_participants(player_id);
        CREATE INDEX IF NOT EXISTS idx_participants_tournament ON tournament_participants(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_ratings_player_game ON player_ratings(player_id, game_id);
        CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON player_aliases(normalized_alias);
        CREATE INDEX IF NOT EXISTS idx_players_canonical ON players(canonical_name);
        CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_tokens(provider);
        CREATE INDEX IF NOT EXISTS idx_oauth_expires ON oauth_tokens(expires_at);
        CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
        CREATE INDEX IF NOT EXISTS idx_api_tokens_active ON api_tokens(is_active);

        -- Cache table indexes
        CREATE INDEX IF NOT EXISTS idx_cache_tournaments_key ON cache_tournaments(cache_key);
        CREATE INDEX IF NOT EXISTS idx_cache_tournaments_expires ON cache_tournaments(expires_at);
        CREATE INDEX IF NOT EXISTS idx_cache_matches_tournament ON cache_matches(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_cache_matches_expires ON cache_matches(expires_at);
        CREATE INDEX IF NOT EXISTS idx_cache_participants_tournament ON cache_participants(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_cache_participants_expires ON cache_participants(expires_at);
        CREATE INDEX IF NOT EXISTS idx_cache_stations_tournament ON cache_stations(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_cache_details_tournament ON cache_tournament_details(tournament_id);

        -- Template indexes
        CREATE INDEX IF NOT EXISTS idx_templates_game ON tournament_templates(game_name);
        CREATE INDEX IF NOT EXISTS idx_templates_default ON tournament_templates(is_default);

        -- Push notification indexes
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
        CREATE INDEX IF NOT EXISTS idx_notification_prefs_user ON notification_preferences(user_id);

        -- AI seeding cache index
        CREATE INDEX IF NOT EXISTS idx_ai_seeding_tournament ON ai_seeding_cache(tournament_id);

        -- Tournament narratives cache index
        CREATE INDEX IF NOT EXISTS idx_narratives_tournament ON tournament_narratives(tournament_id);

        -- ============================================
        -- TCC-CUSTOM TABLE INDEXES
        -- ============================================
        CREATE INDEX IF NOT EXISTS idx_tcc_tournaments_state ON tcc_tournaments(state);
        CREATE INDEX IF NOT EXISTS idx_tcc_tournaments_slug ON tcc_tournaments(url_slug);
        CREATE INDEX IF NOT EXISTS idx_tcc_tournaments_game ON tcc_tournaments(game_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_tournaments_starts ON tcc_tournaments(starts_at);

        CREATE INDEX IF NOT EXISTS idx_tcc_participants_tournament ON tcc_participants(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_participants_seed ON tcc_participants(tournament_id, seed);
        CREATE INDEX IF NOT EXISTS idx_tcc_participants_player ON tcc_participants(player_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_participants_active ON tcc_participants(tournament_id, active);

        CREATE INDEX IF NOT EXISTS idx_tcc_matches_tournament ON tcc_matches(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_matches_state ON tcc_matches(tournament_id, state);
        CREATE INDEX IF NOT EXISTS idx_tcc_matches_round ON tcc_matches(tournament_id, round);
        CREATE INDEX IF NOT EXISTS idx_tcc_matches_prereq1 ON tcc_matches(player1_prereq_match_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_matches_prereq2 ON tcc_matches(player2_prereq_match_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_matches_station ON tcc_matches(station_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_matches_order ON tcc_matches(tournament_id, suggested_play_order);

        CREATE INDEX IF NOT EXISTS idx_tcc_stations_tournament ON tcc_stations(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_stations_match ON tcc_stations(current_match_id);

        CREATE INDEX IF NOT EXISTS idx_tcc_standings_tournament ON tcc_standings(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_standings_participant ON tcc_standings(participant_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_standings_rank ON tcc_standings(tournament_id, rank);
    `);

    console.log('[Analytics DB] Database initialized at', DB_PATH);
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

// ============================================
// NAME NORMALIZATION & MATCHING
// ============================================

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
 * Find matching player by name (multi-tenant)
 * Returns { player, matchType } or null
 * @param {string} name - Player name to search
 * @param {number} userId - User ID for tenant isolation (required)
 */
function findPlayerByName(name, userId) {
    const db = getDb();
    const normalized = normalizePlayerName(name);

    if (!normalized || !userId) return null;

    // 1. Exact match on canonical name within user's player pool
    let player = db.prepare(`
        SELECT * FROM players WHERE canonical_name = ? AND user_id = ?
    `).get(normalized, userId);

    if (player) {
        return { player, matchType: 'exact' };
    }

    // 2. Exact match on alias within user's player pool
    const alias = db.prepare(`
        SELECT p.* FROM players p
        JOIN player_aliases a ON p.id = a.player_id
        WHERE a.normalized_alias = ? AND a.user_id = ?
    `).get(normalized, userId);

    if (alias) {
        return { player: alias, matchType: 'alias' };
    }

    // 3. Fuzzy match with Levenshtein distance within user's player pool
    const allPlayers = db.prepare(`SELECT * FROM players WHERE user_id = ?`).all(userId);
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

    // Return fuzzy match with distance 2 as suggestion only
    if (bestMatch && bestDistance === 2) {
        return { player: bestMatch, matchType: 'suggestion', distance: bestDistance };
    }

    return null;
}

/**
 * Create a new player (multi-tenant)
 * @param {string} name - Player display name
 * @param {number} userId - User ID for tenant isolation (required)
 * @param {string} email - Optional email
 * @param {string} challongeUsername - Optional Challonge username
 * @param {string} instagram - Optional Instagram handle
 */
function createPlayer(name, userId, email = null, challongeUsername = null, instagram = null) {
    const db = getDb();
    const normalized = normalizePlayerName(name);

    if (!userId) {
        throw new Error('userId is required to create a player');
    }

    const result = db.prepare(`
        INSERT INTO players (canonical_name, display_name, email, challonge_username, instagram, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(normalized, name, email, challongeUsername, instagram, userId);

    return result.lastInsertRowid;
}

/**
 * Add alias to player (multi-tenant)
 * @param {number} playerId - Player ID
 * @param {string} alias - Alias to add
 * @param {number} userId - User ID for tenant isolation (required)
 */
function addPlayerAlias(playerId, alias, userId) {
    const db = getDb();
    const normalized = normalizePlayerName(alias);

    if (!userId) {
        throw new Error('userId is required to add player alias');
    }

    try {
        db.prepare(`
            INSERT INTO player_aliases (player_id, alias, normalized_alias, user_id)
            VALUES (?, ?, ?, ?)
        `).run(playerId, alias, normalized, userId);
        return true;
    } catch (e) {
        // Alias already exists
        return false;
    }
}

/**
 * Merge two players (move all data from source to target, scoped to user)
 * @param {number} sourcePlayerId - Player to merge from
 * @param {number} targetPlayerId - Player to merge into
 * @param {number} userId - User ID for tenant isolation
 */
function mergePlayers(sourcePlayerId, targetPlayerId, userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required for merging players');
    }

    // Verify both players belong to this user
    const source = db.prepare(`SELECT display_name FROM players WHERE id = ? AND user_id = ?`).get(sourcePlayerId, userId);
    const target = db.prepare(`SELECT id FROM players WHERE id = ? AND user_id = ?`).get(targetPlayerId, userId);

    if (!source) {
        throw new Error('Source player not found or does not belong to user');
    }
    if (!target) {
        throw new Error('Target player not found or does not belong to user');
    }

    const mergeTransaction = db.transaction(() => {
        // Move aliases (scoped to user)
        db.prepare(`
            UPDATE OR IGNORE player_aliases SET player_id = ? WHERE player_id = ? AND user_id = ?
        `).run(targetPlayerId, sourcePlayerId, userId);

        // Add source name as alias to target
        if (source) {
            addPlayerAlias(targetPlayerId, source.display_name, userId);
        }

        // Update tournament participants
        db.prepare(`
            UPDATE tournament_participants SET player_id = ? WHERE player_id = ?
        `).run(targetPlayerId, sourcePlayerId);

        // Update matches
        db.prepare(`UPDATE matches SET player1_id = ? WHERE player1_id = ?`).run(targetPlayerId, sourcePlayerId);
        db.prepare(`UPDATE matches SET player2_id = ? WHERE player2_id = ?`).run(targetPlayerId, sourcePlayerId);
        db.prepare(`UPDATE matches SET winner_id = ? WHERE winner_id = ?`).run(targetPlayerId, sourcePlayerId);
        db.prepare(`UPDATE matches SET loser_id = ? WHERE loser_id = ?`).run(targetPlayerId, sourcePlayerId);

        // Merge ratings (keep higher rating, scoped to user)
        const sourceRatings = db.prepare(`SELECT * FROM player_ratings WHERE player_id = ? AND user_id = ?`).all(sourcePlayerId, userId);
        for (const sr of sourceRatings) {
            const targetRating = db.prepare(`
                SELECT * FROM player_ratings WHERE player_id = ? AND game_id = ? AND user_id = ?
            `).get(targetPlayerId, sr.game_id, userId);

            if (targetRating) {
                // Merge: keep higher rating, sum stats
                db.prepare(`
                    UPDATE player_ratings SET
                        elo_rating = MAX(elo_rating, ?),
                        peak_rating = MAX(peak_rating, ?),
                        matches_played = matches_played + ?,
                        wins = wins + ?,
                        losses = losses + ?
                    WHERE player_id = ? AND game_id = ? AND user_id = ?
                `).run(sr.elo_rating, sr.peak_rating, sr.matches_played, sr.wins, sr.losses, targetPlayerId, sr.game_id, userId);
            } else {
                // Move rating to target
                db.prepare(`UPDATE player_ratings SET player_id = ? WHERE id = ?`).run(targetPlayerId, sr.id);
            }
        }

        // Update rating history
        db.prepare(`UPDATE rating_history SET player_id = ? WHERE player_id = ?`).run(targetPlayerId, sourcePlayerId);

        // Delete source player (scoped to user)
        db.prepare(`DELETE FROM players WHERE id = ? AND user_id = ?`).run(sourcePlayerId, userId);
    });

    mergeTransaction();
    return true;
}

// ============================================
// GAMES
// ============================================

/**
 * Game abbreviation mapping
 */
const GAME_ABBREVIATIONS = {
    'super smash bros. ultimate': 'ssbu',
    'super smash bros ultimate': 'ssbu',
    'ssbu': 'ssbu',
    'mario kart world': 'mkw',
    'mario kart 8': 'mk8',
    'mario kart 8 deluxe': 'mk8dx',
    'street fighter 6': 'sf6',
    'tekken 8': 't8',
    'melee': 'melee',
    'super smash bros. melee': 'melee',
    'guilty gear strive': 'ggst',
    'mortal kombat 1': 'mk1',
    'granblue fantasy versus rising': 'gbvsr'
};

/**
 * Get short code for a game name
 */
function getGameShortCode(gameName) {
    if (!gameName) return 'unk';
    const lower = gameName.toLowerCase().trim();
    if (GAME_ABBREVIATIONS[lower]) {
        return GAME_ABBREVIATIONS[lower];
    }
    // Fallback: first letter of each word
    return lower.split(/\s+/).map(w => w[0]).join('').slice(0, 4);
}

/**
 * Get or create a game record
 */
function getOrCreateGame(gameName) {
    const db = getDb();

    let game = db.prepare(`SELECT * FROM games WHERE name = ?`).get(gameName);

    if (!game) {
        const shortCode = getGameShortCode(gameName);
        const result = db.prepare(`
            INSERT INTO games (name, short_code) VALUES (?, ?)
        `).run(gameName, shortCode);
        game = { id: result.lastInsertRowid, name: gameName, short_code: shortCode };
    }

    return game;
}

/**
 * Get all games with tournament counts
 */
function getAllGames() {
    const db = getDb();
    return db.prepare(`
        SELECT g.*, COUNT(t.id) as tournament_count
        FROM games g
        LEFT JOIN tournaments t ON g.id = t.game_id
        GROUP BY g.id
        ORDER BY tournament_count DESC, g.name ASC
    `).all();
}

// ============================================
// TOURNAMENTS
// ============================================

/**
 * Check if tournament is already archived (scoped to user)
 * @param {string} challongeUrl - Tournament URL slug
 * @param {number} userId - User ID for tenant isolation
 */
function isTournamentArchived(challongeUrl, userId) {
    const db = getDb();
    if (!userId) {
        throw new Error('userId is required to check tournament archive status');
    }
    const existing = db.prepare(`SELECT id FROM tournaments WHERE challonge_url = ? AND user_id = ?`).get(challongeUrl, userId);
    return !!existing;
}

/**
 * Archive a tournament (scoped to user)
 * @param {Object} tournamentData - Tournament data to archive
 * @param {number} tournamentData.userId - User ID for tenant isolation (required)
 */
function archiveTournament(tournamentData) {
    const db = getDb();

    if (!tournamentData.userId) {
        throw new Error('userId is required to archive tournament');
    }

    const result = db.prepare(`
        INSERT INTO tournaments (
            user_id, challonge_id, challonge_url, name, game_id, tournament_type,
            participant_count, started_at, completed_at, full_challonge_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        tournamentData.userId,
        tournamentData.challongeId,
        tournamentData.challongeUrl,
        tournamentData.name,
        tournamentData.gameId,
        tournamentData.tournamentType,
        tournamentData.participantCount,
        tournamentData.startedAt,
        tournamentData.completedAt,
        tournamentData.fullChallongeUrl
    );

    return result.lastInsertRowid;
}

/**
 * Get archived tournaments with filters (multi-tenant)
 * @param {Object} options - Query options
 * @param {number} options.userId - User ID for tenant isolation (required)
 * @param {number} options.gameId - Optional game filter
 * @param {number} options.limit - Max results (default 50)
 * @param {number} options.offset - Offset for pagination
 */
function getArchivedTournaments(options = {}) {
    const db = getDb();
    const { userId, gameId, limit = 50, offset = 0 } = options;

    if (!userId) {
        throw new Error('userId is required to get archived tournaments');
    }

    let query = `
        SELECT t.*, g.name as game_name, g.short_code as game_short_code
        FROM tournaments t
        JOIN games g ON t.game_id = g.id
        WHERE t.user_id = ?
    `;
    const params = [userId];

    if (gameId) {
        query += ` AND t.game_id = ?`;
        params.push(gameId);
    }

    query += ` ORDER BY t.completed_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    return db.prepare(query).all(...params);
}

/**
 * Get tournament by ID with full details (multi-tenant)
 * @param {number} tournamentId - Tournament ID
 * @param {number} userId - User ID for tenant isolation (required)
 */
function getTournamentById(tournamentId, userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get tournament');
    }

    const tournament = db.prepare(`
        SELECT t.*, g.name as game_name, g.short_code as game_short_code
        FROM tournaments t
        JOIN games g ON t.game_id = g.id
        WHERE t.id = ? AND t.user_id = ?
    `).get(tournamentId, userId);

    if (!tournament) return null;

    // Get standings
    const standings = db.prepare(`
        SELECT tp.*, p.display_name, p.canonical_name
        FROM tournament_participants tp
        JOIN players p ON tp.player_id = p.id
        WHERE tp.tournament_id = ?
        ORDER BY tp.final_rank ASC NULLS LAST, tp.seed ASC
    `).all(tournamentId);

    // Get matches
    const matches = db.prepare(`
        SELECT m.*,
            p1.display_name as player1_name,
            p2.display_name as player2_name,
            w.display_name as winner_name
        FROM matches m
        LEFT JOIN players p1 ON m.player1_id = p1.id
        LEFT JOIN players p2 ON m.player2_id = p2.id
        LEFT JOIN players w ON m.winner_id = w.id
        WHERE m.tournament_id = ?
        ORDER BY m.round ASC, m.id ASC
    `).all(tournamentId);

    return { tournament, standings, matches };
}

// ============================================
// PARTICIPANTS
// ============================================

/**
 * Add participant to tournament
 */
function addTournamentParticipant(participantData) {
    const db = getDb();

    try {
        const result = db.prepare(`
            INSERT INTO tournament_participants (
                tournament_id, player_id, challonge_participant_id, seed, final_rank, checked_in
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            participantData.tournamentId,
            participantData.playerId,
            participantData.challongeParticipantId,
            participantData.seed,
            participantData.finalRank,
            participantData.checkedIn ? 1 : 0
        );
        return result.lastInsertRowid;
    } catch (e) {
        // Duplicate entry - player already in tournament
        return null;
    }
}

// ============================================
// MATCHES
// ============================================

/**
 * Parse scores CSV into player scores
 */
function parseScores(scoresCsv) {
    if (!scoresCsv) return { player1Score: null, player2Score: null };

    const parts = scoresCsv.split('-');
    if (parts.length >= 2) {
        return {
            player1Score: parseInt(parts[0]) || 0,
            player2Score: parseInt(parts[1]) || 0
        };
    }
    return { player1Score: null, player2Score: null };
}

/**
 * Add match to tournament
 */
function addMatch(matchData) {
    const db = getDb();

    const result = db.prepare(`
        INSERT INTO matches (
            tournament_id, challonge_match_id, round, player1_id, player2_id,
            winner_id, loser_id, player1_score, player2_score, scores_csv,
            completed_at, match_identifier
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        matchData.tournamentId,
        matchData.challongeMatchId,
        matchData.round,
        matchData.player1Id,
        matchData.player2Id,
        matchData.winnerId,
        matchData.loserId,
        matchData.player1Score,
        matchData.player2Score,
        matchData.scoresCsv,
        matchData.completedAt,
        matchData.matchIdentifier
    );

    return result.lastInsertRowid;
}

// ============================================
// ELO RATINGS
// ============================================

/**
 * Calculate Elo rating change
 */
function calculateEloChange(winnerRating, loserRating) {
    const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const expectedLoser = 1 - expectedWinner;

    const winnerChange = Math.round(ELO_K_FACTOR * (1 - expectedWinner));
    const loserChange = Math.round(ELO_K_FACTOR * (0 - expectedLoser));

    return { winnerChange, loserChange };
}

/**
 * Get or create player rating for a game (multi-tenant)
 * @param {number} playerId - Player ID
 * @param {number} gameId - Game ID
 * @param {number} userId - User ID for tenant isolation (required)
 */
function getOrCreatePlayerRating(playerId, gameId, userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get/create player rating');
    }

    let rating = db.prepare(`
        SELECT * FROM player_ratings WHERE player_id = ? AND game_id = ? AND user_id = ?
    `).get(playerId, gameId, userId);

    if (!rating) {
        db.prepare(`
            INSERT INTO player_ratings (player_id, game_id, user_id) VALUES (?, ?, ?)
        `).run(playerId, gameId, userId);
        rating = {
            player_id: playerId,
            game_id: gameId,
            user_id: userId,
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
 * Update Elo ratings for a tournament (multi-tenant)
 * Process matches in order and update ratings
 * @param {number} tournamentId - Tournament ID
 * @param {number} gameId - Game ID
 * @param {number} userId - User ID for tenant isolation (required)
 */
function updateEloRatings(tournamentId, gameId, userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to update Elo ratings');
    }

    // Get all completed matches for this tournament, ordered by completion time
    const matches = db.prepare(`
        SELECT * FROM matches
        WHERE tournament_id = ? AND winner_id IS NOT NULL
        ORDER BY completed_at ASC, id ASC
    `).all(tournamentId);

    const updateTransaction = db.transaction(() => {
        for (const match of matches) {
            if (!match.winner_id || !match.loser_id) continue;

            const winnerRating = getOrCreatePlayerRating(match.winner_id, gameId, userId);
            const loserRating = getOrCreatePlayerRating(match.loser_id, gameId, userId);

            const { winnerChange, loserChange } = calculateEloChange(
                winnerRating.elo_rating,
                loserRating.elo_rating
            );

            const newWinnerRating = winnerRating.elo_rating + winnerChange;
            const newLoserRating = Math.max(100, loserRating.elo_rating + loserChange);

            // Update winner (with user_id filter for multi-tenant)
            db.prepare(`
                UPDATE player_ratings SET
                    elo_rating = ?,
                    peak_rating = MAX(peak_rating, ?),
                    matches_played = matches_played + 1,
                    wins = wins + 1,
                    last_active = CURRENT_TIMESTAMP
                WHERE player_id = ? AND game_id = ? AND user_id = ?
            `).run(newWinnerRating, newWinnerRating, match.winner_id, gameId, userId);

            // Update loser (with user_id filter for multi-tenant)
            db.prepare(`
                UPDATE player_ratings SET
                    elo_rating = ?,
                    matches_played = matches_played + 1,
                    losses = losses + 1,
                    last_active = CURRENT_TIMESTAMP
                WHERE player_id = ? AND game_id = ? AND user_id = ?
            `).run(newLoserRating, match.loser_id, gameId, userId);

            // Record rating history for winner
            db.prepare(`
                INSERT INTO rating_history (player_id, game_id, tournament_id, rating_before, rating_after, rating_change)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(match.winner_id, gameId, tournamentId, winnerRating.elo_rating, newWinnerRating, winnerChange);

            // Record rating history for loser
            db.prepare(`
                INSERT INTO rating_history (player_id, game_id, tournament_id, rating_before, rating_after, rating_change)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(match.loser_id, gameId, tournamentId, loserRating.elo_rating, newLoserRating, loserChange);
        }
    });

    updateTransaction();
}

// ============================================
// ANALYTICS QUERIES
// ============================================

/**
 * Get player rankings for a game (multi-tenant)
 * @param {number} gameId - Game ID
 * @param {Object} options - Query options
 * @param {number} options.userId - User ID for tenant isolation (required)
 * @param {number} options.limit - Max results (default 50)
 * @param {number} options.offset - Offset for pagination
 * @param {string} options.sortBy - Sort field
 */
function getPlayerRankings(gameId, options = {}) {
    const db = getDb();
    const { userId, limit = 50, offset = 0, sortBy = 'elo' } = options;

    if (!userId) {
        throw new Error('userId is required to get player rankings');
    }

    let orderBy = 'pr.elo_rating DESC';
    switch (sortBy) {
        case 'wins': orderBy = 'pr.wins DESC'; break;
        case 'winrate': orderBy = '(CAST(pr.wins AS FLOAT) / NULLIF(pr.matches_played, 0)) DESC'; break;
        case 'matches': orderBy = 'pr.matches_played DESC'; break;
        case 'attendance': orderBy = 'attendance DESC'; break;
    }

    const query = `
        SELECT
            p.id, p.display_name, p.canonical_name,
            pr.elo_rating, pr.peak_rating, pr.matches_played, pr.wins, pr.losses,
            pr.last_active,
            ROUND(CAST(pr.wins AS FLOAT) / NULLIF(pr.matches_played, 0) * 100, 1) as win_rate,
            (SELECT COUNT(DISTINCT tp.tournament_id)
             FROM tournament_participants tp
             JOIN tournaments t ON tp.tournament_id = t.id
             WHERE tp.player_id = p.id AND t.game_id = ? AND t.user_id = ?) as attendance
        FROM players p
        JOIN player_ratings pr ON p.id = pr.player_id
        WHERE pr.game_id = ? AND pr.matches_played > 0 AND pr.user_id = ?
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
    `;

    return db.prepare(query).all(gameId, userId, gameId, userId, limit, offset);
}

/**
 * Get player profile with all stats (multi-tenant)
 * @param {number} playerId - Player ID
 * @param {number} userId - User ID for tenant isolation (required)
 */
function getPlayerProfile(playerId, userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get player profile');
    }

    // Verify player belongs to this user
    const player = db.prepare(`SELECT * FROM players WHERE id = ? AND user_id = ?`).get(playerId, userId);
    if (!player) return null;

    // Get stats per game (filtered by user's ratings)
    const gameStats = db.prepare(`
        SELECT
            g.id as game_id, g.name as game_name, g.short_code,
            pr.elo_rating, pr.peak_rating, pr.matches_played, pr.wins, pr.losses,
            pr.last_active,
            ROUND(CAST(pr.wins AS FLOAT) / NULLIF(pr.matches_played, 0) * 100, 1) as win_rate,
            (SELECT COUNT(DISTINCT tp.tournament_id)
             FROM tournament_participants tp
             JOIN tournaments t ON tp.tournament_id = t.id
             WHERE tp.player_id = ? AND t.game_id = g.id AND t.user_id = ?) as tournaments_attended
        FROM player_ratings pr
        JOIN games g ON pr.game_id = g.id
        WHERE pr.player_id = ? AND pr.user_id = ?
        ORDER BY pr.matches_played DESC
    `).all(playerId, userId, playerId, userId);

    // Get recent matches (only from user's tournaments)
    const recentMatches = db.prepare(`
        SELECT
            m.*,
            t.name as tournament_name,
            g.name as game_name,
            p1.display_name as player1_name,
            p2.display_name as player2_name,
            CASE WHEN m.winner_id = ? THEN 'win' ELSE 'loss' END as result
        FROM matches m
        JOIN tournaments t ON m.tournament_id = t.id
        JOIN games g ON t.game_id = g.id
        LEFT JOIN players p1 ON m.player1_id = p1.id
        LEFT JOIN players p2 ON m.player2_id = p2.id
        WHERE (m.player1_id = ? OR m.player2_id = ?) AND t.user_id = ?
        ORDER BY m.completed_at DESC
        LIMIT 20
    `).all(playerId, playerId, playerId, userId);

    // Get rating history (only from user's tournaments)
    const ratingHistory = db.prepare(`
        SELECT
            rh.*,
            t.name as tournament_name,
            g.name as game_name
        FROM rating_history rh
        JOIN tournaments t ON rh.tournament_id = t.id
        JOIN games g ON rh.game_id = g.id
        WHERE rh.player_id = ? AND t.user_id = ?
        ORDER BY rh.recorded_at DESC
        LIMIT 50
    `).all(playerId, userId);

    // Get tournament placements (only from user's tournaments)
    const placements = db.prepare(`
        SELECT
            tp.final_rank, tp.seed,
            t.name as tournament_name, t.completed_at,
            g.name as game_name,
            t.participant_count
        FROM tournament_participants tp
        JOIN tournaments t ON tp.tournament_id = t.id
        JOIN games g ON t.game_id = g.id
        WHERE tp.player_id = ? AND t.user_id = ?
        ORDER BY t.completed_at DESC
        LIMIT 20
    `).all(playerId, userId);

    // Get aliases (filtered by user)
    const aliases = db.prepare(`
        SELECT alias FROM player_aliases WHERE player_id = ? AND user_id = ?
    `).all(playerId, userId);

    return {
        player,
        gameStats,
        recentMatches,
        ratingHistory,
        placements,
        aliases: aliases.map(a => a.alias)
    };
}

/**
 * Get head-to-head record between two players (multi-tenant)
 * @param {number} player1Id - First player ID
 * @param {number} player2Id - Second player ID
 * @param {number} userId - User ID for tenant isolation (required)
 * @param {number} gameId - Optional game filter
 */
function getHeadToHead(player1Id, player2Id, userId, gameId = null) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get head-to-head');
    }

    let query = `
        SELECT
            m.*,
            t.name as tournament_name,
            t.completed_at as tournament_date,
            g.name as game_name
        FROM matches m
        JOIN tournaments t ON m.tournament_id = t.id
        JOIN games g ON t.game_id = g.id
        WHERE ((m.player1_id = ? AND m.player2_id = ?) OR (m.player1_id = ? AND m.player2_id = ?))
        AND t.user_id = ?
    `;
    const params = [player1Id, player2Id, player2Id, player1Id, userId];

    if (gameId) {
        query += ` AND t.game_id = ?`;
        params.push(gameId);
    }

    query += ` ORDER BY m.completed_at DESC`;

    const matches = db.prepare(query).all(...params);

    // Verify players belong to this user
    const player1 = db.prepare(`SELECT * FROM players WHERE id = ? AND user_id = ?`).get(player1Id, userId);
    const player2 = db.prepare(`SELECT * FROM players WHERE id = ? AND user_id = ?`).get(player2Id, userId);

    let player1Wins = 0;
    let player2Wins = 0;

    for (const m of matches) {
        if (m.winner_id === player1Id) player1Wins++;
        else if (m.winner_id === player2Id) player2Wins++;
    }

    return {
        player1: player1,
        player2: player2,
        matches,
        record: {
            player1Wins,
            player2Wins
        }
    };
}

/**
 * Get overview statistics (multi-tenant)
 * @param {number} userId - User ID for tenant isolation (required)
 */
function getOverviewStats(userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get overview stats');
    }

    const totals = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM tournaments WHERE user_id = ?) as total_tournaments,
            (SELECT COUNT(*) FROM players WHERE user_id = ?) as total_players,
            (SELECT COUNT(*) FROM matches m JOIN tournaments t ON m.tournament_id = t.id WHERE m.winner_id IS NOT NULL AND t.user_id = ?) as total_matches
    `).get(userId, userId, userId);

    const gameBreakdown = db.prepare(`
        SELECT g.name, g.short_code, COUNT(t.id) as count
        FROM games g
        LEFT JOIN tournaments t ON g.id = t.game_id AND t.user_id = ?
        GROUP BY g.id
        ORDER BY count DESC
    `).all(userId);

    const recentTournaments = db.prepare(`
        SELECT t.*, g.name as game_name
        FROM tournaments t
        JOIN games g ON t.game_id = g.id
        WHERE t.user_id = ?
        ORDER BY t.completed_at DESC
        LIMIT 5
    `).all(userId);

    const topPlayers = db.prepare(`
        SELECT p.display_name, g.name as game_name, pr.elo_rating
        FROM player_ratings pr
        JOIN players p ON pr.player_id = p.id
        JOIN games g ON pr.game_id = g.id
        WHERE pr.matches_played >= 3 AND pr.user_id = ?
        ORDER BY pr.elo_rating DESC
        LIMIT 10
    `).all(userId);

    return {
        ...totals,
        gameBreakdown,
        recentTournaments,
        topPlayers
    };
}

/**
 * Get attendance statistics (multi-tenant)
 * @param {number} userId - User ID for tenant isolation (required)
 * @param {number} gameId - Optional game filter
 * @param {number} months - Number of months to look back (default 6)
 */
function getAttendanceStats(userId, gameId = null, months = 6) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get attendance stats');
    }

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);

    let whereClause = `WHERE t.completed_at >= ? AND t.user_id = ?`;
    const params = [cutoffDate.toISOString(), userId];

    if (gameId) {
        whereClause += ` AND t.game_id = ?`;
        params.push(gameId);
    }

    // Monthly attendance
    const monthlyQuery = `
        SELECT
            strftime('%Y-%m', t.completed_at) as month,
            COUNT(DISTINCT t.id) as tournaments,
            COUNT(DISTINCT tp.player_id) as unique_players,
            COUNT(tp.id) as total_participants
        FROM tournaments t
        LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
        ${whereClause}
        GROUP BY month
        ORDER BY month ASC
    `;

    const monthlyAttendance = db.prepare(monthlyQuery).all(...params);

    // New vs returning players per month (scoped to user's tournaments)
    const newVsReturningQuery = `
        SELECT
            strftime('%Y-%m', t.completed_at) as month,
            tp.player_id,
            p.display_name,
            (SELECT MIN(t2.completed_at)
             FROM tournament_participants tp2
             JOIN tournaments t2 ON tp2.tournament_id = t2.id
             WHERE tp2.player_id = tp.player_id AND t2.user_id = ?) as first_tournament
        FROM tournament_participants tp
        JOIN tournaments t ON tp.tournament_id = t.id
        JOIN players p ON tp.player_id = p.id
        ${whereClause}
    `;

    const playerData = db.prepare(newVsReturningQuery).all(userId, ...params);

    // Group by month and count new vs returning
    const newVsReturning = {};
    for (const pd of playerData) {
        if (!newVsReturning[pd.month]) {
            newVsReturning[pd.month] = { new: 0, returning: 0 };
        }
        const firstMonth = pd.first_tournament ? pd.first_tournament.substring(0, 7) : pd.month;
        if (firstMonth === pd.month) {
            newVsReturning[pd.month].new++;
        } else {
            newVsReturning[pd.month].returning++;
        }
    }

    // Top attendees (within user's tournaments)
    let topAttendeesQuery = `
        SELECT
            p.id, p.display_name,
            COUNT(DISTINCT tp.tournament_id) as tournaments_attended
        FROM players p
        JOIN tournament_participants tp ON p.id = tp.player_id
        JOIN tournaments t ON tp.tournament_id = t.id
        ${whereClause}
        GROUP BY p.id
        ORDER BY tournaments_attended DESC
        LIMIT 20
    `;

    const topAttendees = db.prepare(topAttendeesQuery).all(...params);

    return {
        monthlyAttendance,
        newVsReturning: Object.entries(newVsReturning).map(([month, data]) => ({ month, ...data })),
        topAttendees
    };
}

/**
 * Search players by name (multi-tenant)
 * @param {string} query - Search query
 * @param {number} userId - User ID for tenant isolation (required)
 * @param {number} gameId - Optional game filter
 * @param {number} limit - Max results (default 20)
 */
function searchPlayers(query, userId, gameId = null, limit = 20) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to search players');
    }

    const searchTerm = `%${query.toLowerCase()}%`;

    let sql = `
        SELECT DISTINCT p.*,
            (SELECT pr.elo_rating FROM player_ratings pr WHERE pr.player_id = p.id AND pr.user_id = ? LIMIT 1) as elo
        FROM players p
        LEFT JOIN player_aliases pa ON p.id = pa.player_id AND pa.user_id = ?
        WHERE p.user_id = ? AND (p.canonical_name LIKE ? OR p.display_name LIKE ? OR pa.alias LIKE ?)
    `;
    const params = [userId, userId, userId, searchTerm, searchTerm, searchTerm];

    if (gameId) {
        sql += ` AND EXISTS (SELECT 1 FROM player_ratings pr WHERE pr.player_id = p.id AND pr.game_id = ? AND pr.user_id = ?)`;
        params.push(gameId, userId);
    }

    sql += ` ORDER BY p.display_name LIMIT ?`;
    params.push(limit);

    return db.prepare(sql).all(...params);
}

/**
 * Get unmatched players queue (scoped to user via tournament)
 * @param {number} userId - User ID for tenant isolation
 */
function getUnmatchedPlayers(userId) {
    const db = getDb();
    if (!userId) {
        throw new Error('userId is required to get unmatched players');
    }
    return db.prepare(`
        SELECT up.*, t.name as tournament_name,
            sp.display_name as suggested_name
        FROM unmatched_players up
        JOIN tournaments t ON up.tournament_id = t.id
        LEFT JOIN players sp ON up.suggested_player_id = sp.id
        WHERE up.resolved = 0 AND t.user_id = ?
        ORDER BY up.created_at DESC
    `).all(userId);
}

/**
 * Add to unmatched queue (userId used for verification)
 * @param {number} tournamentId - Tournament ID
 * @param {string} originalName - Original player name
 * @param {number} suggestedPlayerId - Suggested player ID to merge with
 * @param {number} similarityScore - Name similarity score
 * @param {number} userId - User ID for tenant verification
 */
function addUnmatchedPlayer(tournamentId, originalName, suggestedPlayerId = null, similarityScore = null, userId = null) {
    const db = getDb();
    const normalized = normalizePlayerName(originalName);

    // Verify tournament belongs to user if userId provided
    if (userId) {
        const tournament = db.prepare(`SELECT id FROM tournaments WHERE id = ? AND user_id = ?`).get(tournamentId, userId);
        if (!tournament) {
            throw new Error('Tournament not found or does not belong to user');
        }
    }

    db.prepare(`
        INSERT INTO unmatched_players (tournament_id, original_name, normalized_name, suggested_player_id, similarity_score)
        VALUES (?, ?, ?, ?, ?)
    `).run(tournamentId, originalName, normalized, suggestedPlayerId, similarityScore);
}

/**
 * Resolve unmatched player (scoped to user via tournament)
 * @param {number} unmatchedId - Unmatched player record ID
 * @param {number} playerId - Player ID to associate with
 * @param {number} userId - User ID for tenant verification
 */
function resolveUnmatchedPlayer(unmatchedId, playerId, userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to resolve unmatched player');
    }

    // Verify unmatched player belongs to user's tournament
    const unmatched = db.prepare(`
        SELECT up.original_name, t.user_id
        FROM unmatched_players up
        JOIN tournaments t ON up.tournament_id = t.id
        WHERE up.id = ?
    `).get(unmatchedId);

    if (!unmatched || unmatched.user_id !== userId) {
        throw new Error('Unmatched player not found or does not belong to user');
    }

    db.prepare(`UPDATE unmatched_players SET resolved = 1 WHERE id = ?`).run(unmatchedId);

    // Optionally add as alias (scoped to user)
    if (unmatched && playerId) {
        addPlayerAlias(playerId, unmatched.original_name, userId);
    }
}

// ============================================
// OAUTH TOKEN MANAGEMENT
// ============================================

const crypto = require('crypto');

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * Get encryption key from environment
 */
function getEncryptionKey() {
    const key = process.env.OAUTH_ENCRYPTION_KEY;
    if (!key) {
        throw new Error('OAUTH_ENCRYPTION_KEY environment variable is not set');
    }
    if (key.length !== 64) {
        throw new Error('OAUTH_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return Buffer.from(key, 'hex');
}

/**
 * Encrypt a token using AES-256-GCM
 * @param {string} token - Plain text token
 * @returns {{encrypted: string, iv: string}} Encrypted token and IV
 */
function encryptToken(token) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return {
        encrypted: encrypted + ':' + authTag,
        iv: iv.toString('hex')
    };
}

/**
 * Decrypt a token using AES-256-GCM
 * @param {string} encryptedData - Encrypted token with auth tag (format: encrypted:authTag)
 * @param {string} iv - Initialization vector (hex)
 * @returns {string} Decrypted token
 */
function decryptToken(encryptedData, iv) {
    const key = getEncryptionKey();
    const [encrypted, authTag] = encryptedData.split(':');

    const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        key,
        Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Save OAuth tokens to database (encrypted)
 * @param {Object} tokens - Token data from OAuth provider
 * @param {string} tokens.access_token - Access token
 * @param {string} tokens.refresh_token - Refresh token (optional)
 * @param {string} tokens.token_type - Token type (default: Bearer)
 * @param {number} tokens.expires_in - Expires in seconds
 * @param {string} tokens.scope - Granted scopes
 * @param {string} tokens.user_id - Challonge user ID (optional)
 * @param {string} tokens.username - Challonge username (optional)
 * @param {string} provider - Provider name (default: challonge)
 */
function saveOAuthTokens(tokens, provider = 'challonge') {
    const db = getDb();

    // Encrypt access token
    const accessEncrypted = encryptToken(tokens.access_token);

    // Encrypt refresh token if present
    let refreshEncrypted = null;
    let refreshIv = null;
    if (tokens.refresh_token) {
        const encrypted = encryptToken(tokens.refresh_token);
        refreshEncrypted = encrypted.encrypted;
        // Store refresh token IV with access token IV (separated by colon)
        refreshIv = encrypted.iv;
    }

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString();

    // Use INSERT OR REPLACE to handle both insert and update
    db.prepare(`
        INSERT OR REPLACE INTO oauth_tokens (
            provider, access_token_encrypted, refresh_token_encrypted,
            token_type, expires_at, scope, challonge_user_id,
            challonge_username, iv, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
        provider,
        accessEncrypted.encrypted,
        refreshEncrypted,
        tokens.token_type || 'Bearer',
        expiresAt,
        tokens.scope || null,
        tokens.user_id || null,
        tokens.username || null,
        accessEncrypted.iv + (refreshIv ? ':' + refreshIv : '')
    );

    console.log(`[Analytics DB] OAuth tokens saved for provider: ${provider}`);
}

/**
 * Get OAuth tokens from database (decrypted)
 * @param {string} provider - Provider name (default: challonge)
 * @returns {Object|null} Decrypted token data or null if not found
 */
function getOAuthTokens(provider = 'challonge') {
    const db = getDb();

    const row = db.prepare(`
        SELECT * FROM oauth_tokens WHERE provider = ?
    `).get(provider);

    if (!row) {
        return null;
    }

    try {
        // Parse IV (may contain both access and refresh IVs)
        const ivParts = row.iv.split(':');
        const accessIv = ivParts[0];
        const refreshIv = ivParts[1] || null;

        // Decrypt access token
        const accessToken = decryptToken(row.access_token_encrypted, accessIv);

        // Decrypt refresh token if present
        let refreshToken = null;
        if (row.refresh_token_encrypted && refreshIv) {
            refreshToken = decryptToken(row.refresh_token_encrypted, refreshIv);
        }

        return {
            accessToken,
            refreshToken,
            tokenType: row.token_type,
            expiresAt: row.expires_at,
            scope: row.scope,
            challongeUserId: row.challonge_user_id,
            challongeUsername: row.challonge_username,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    } catch (error) {
        console.error('[Analytics DB] Failed to decrypt OAuth tokens:', error.message);
        return null;
    }
}

/**
 * Delete OAuth tokens from database
 * @param {string} provider - Provider name (default: challonge)
 */
function deleteOAuthTokens(provider = 'challonge') {
    const db = getDb();
    db.prepare(`DELETE FROM oauth_tokens WHERE provider = ?`).run(provider);
    console.log(`[Analytics DB] OAuth tokens deleted for provider: ${provider}`);
}

/**
 * Check if OAuth is connected (valid token exists)
 * @param {string} provider - Provider name (default: challonge)
 * @returns {boolean} True if connected with valid token
 */
function isOAuthConnected(provider = 'challonge') {
    const tokens = getOAuthTokens(provider);
    if (!tokens) {
        return false;
    }

    // Check if token is expired
    const expiresAt = new Date(tokens.expiresAt);
    return expiresAt > new Date();
}

/**
 * Check if token needs refresh (expires within threshold)
 * @param {string} provider - Provider name (default: challonge)
 * @param {number} thresholdMinutes - Minutes before expiry to trigger refresh (default: 5)
 * @returns {boolean} True if token needs refresh
 */
function tokenNeedsRefresh(provider = 'challonge', thresholdMinutes = 5) {
    const tokens = getOAuthTokens(provider);
    if (!tokens) {
        return false;
    }

    const expiresAt = new Date(tokens.expiresAt);
    const threshold = new Date(Date.now() + (thresholdMinutes * 60 * 1000));

    return expiresAt <= threshold;
}

/**
 * Get OAuth connection status for display
 * @param {string} provider - Provider name (default: challonge)
 * @returns {Object} Connection status info
 */
function getOAuthStatus(provider = 'challonge') {
    const tokens = getOAuthTokens(provider);

    if (!tokens) {
        return {
            connected: false,
            provider,
            message: 'Not connected'
        };
    }

    const expiresAt = new Date(tokens.expiresAt);
    const now = new Date();
    const isExpired = expiresAt <= now;
    const expiresInMinutes = Math.max(0, Math.floor((expiresAt - now) / (1000 * 60)));

    return {
        connected: !isExpired,
        provider,
        challongeUsername: tokens.challongeUsername,
        challongeUserId: tokens.challongeUserId,
        expiresAt: tokens.expiresAt,
        expiresInMinutes,
        isExpired,
        scope: tokens.scope,
        hasRefreshToken: !!tokens.refreshToken,
        lastRefresh: tokens.updatedAt,
        message: isExpired ? 'Token expired' : `Expires in ${expiresInMinutes} minutes`
    };
}

// ============================================
// API TOKEN MANAGEMENT (Device Authentication)
// ============================================

/**
 * Generate a secure random API token
 * @returns {string} 64-character hex token
 */
function generateApiToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash an API token using SHA-256
 * @param {string} token - Plain text token
 * @returns {string} SHA-256 hash of token
 */
function hashApiToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new API token for a device
 * Returns the plain text token (shown only once) and token record
 * @param {string} deviceName - Name of the device (e.g., "Stream Deck 1")
 * @param {string} deviceType - Type of device ('streamdeck', 'automation', etc.)
 * @param {string} createdBy - Username who created the token
 * @param {string} permissions - Permission level ('full', 'readonly', 'matches_only')
 * @param {number|null} expiresInDays - Days until expiration (null = never expires)
 * @returns {{token: string, record: Object}} Plain text token and database record
 */
function createApiToken(deviceName, deviceType = 'streamdeck', createdBy, permissions = 'full', expiresInDays = null) {
    const db = getDb();

    // Generate secure token
    const token = generateApiToken();
    const tokenHash = hashApiToken(token);

    const now = Date.now();
    const expiresAt = expiresInDays ? now + (expiresInDays * 24 * 60 * 60 * 1000) : null;

    const result = db.prepare(`
        INSERT INTO api_tokens (token_hash, device_name, device_type, permissions, created_at, expires_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tokenHash, deviceName, deviceType, permissions, now, expiresAt, createdBy);

    const record = {
        id: result.lastInsertRowid,
        deviceName,
        deviceType,
        permissions,
        createdAt: now,
        expiresAt,
        createdBy,
        isActive: true
    };

    console.log(`[Analytics DB] API token created for device: ${deviceName} (type: ${deviceType})`);

    // Return plain text token (shown only once) and record
    return { token, record };
}

/**
 * Verify an API token and return the token record if valid
 * @param {string} token - Plain text token to verify
 * @returns {Object|null} Token record or null if invalid/expired/inactive
 */
function verifyApiToken(token) {
    const db = getDb();

    if (!token || typeof token !== 'string') {
        return null;
    }

    const tokenHash = hashApiToken(token);

    const record = db.prepare(`
        SELECT * FROM api_tokens WHERE token_hash = ?
    `).get(tokenHash);

    if (!record) {
        return null;
    }

    // Check if active
    if (!record.is_active) {
        return null;
    }

    // Check if expired
    if (record.expires_at && record.expires_at < Date.now()) {
        return null;
    }

    return {
        id: record.id,
        deviceName: record.device_name,
        deviceType: record.device_type,
        permissions: record.permissions,
        createdAt: record.created_at,
        lastUsedAt: record.last_used_at,
        expiresAt: record.expires_at,
        createdBy: record.created_by,
        isActive: record.is_active === 1
    };
}

/**
 * Update last used timestamp for a token
 * @param {number} tokenId - Token ID
 */
function updateTokenLastUsed(tokenId) {
    const db = getDb();
    db.prepare(`
        UPDATE api_tokens SET last_used_at = ? WHERE id = ?
    `).run(Date.now(), tokenId);
}

/**
 * List all API tokens (without exposing the actual token values)
 * @returns {Array} List of token records (no token hashes)
 */
function listApiTokens() {
    const db = getDb();

    const tokens = db.prepare(`
        SELECT id, device_name, device_type, permissions, created_at, last_used_at, expires_at, created_by, is_active
        FROM api_tokens
        ORDER BY created_at DESC
    `).all();

    return tokens.map(t => ({
        id: t.id,
        deviceName: t.device_name,
        deviceType: t.device_type,
        permissions: t.permissions,
        createdAt: t.created_at,
        lastUsedAt: t.last_used_at,
        expiresAt: t.expires_at,
        createdBy: t.created_by,
        isActive: t.is_active === 1,
        isExpired: t.expires_at ? t.expires_at < Date.now() : false
    }));
}

/**
 * Revoke an API token (soft delete - sets is_active to 0)
 * @param {number} tokenId - Token ID to revoke
 * @returns {boolean} True if token was revoked
 */
function revokeApiToken(tokenId) {
    const db = getDb();

    const result = db.prepare(`
        UPDATE api_tokens SET is_active = 0 WHERE id = ?
    `).run(tokenId);

    if (result.changes > 0) {
        console.log(`[Analytics DB] API token revoked: ID ${tokenId}`);
        return true;
    }
    return false;
}

/**
 * Delete an API token permanently (hard delete)
 * @param {number} tokenId - Token ID to delete
 * @returns {boolean} True if token was deleted
 */
function deleteApiToken(tokenId) {
    const db = getDb();

    const result = db.prepare(`
        DELETE FROM api_tokens WHERE id = ?
    `).run(tokenId);

    if (result.changes > 0) {
        console.log(`[Analytics DB] API token deleted: ID ${tokenId}`);
        return true;
    }
    return false;
}

/**
 * Get a single API token by ID
 * @param {number} tokenId - Token ID
 * @returns {Object|null} Token record or null
 */
function getApiToken(tokenId) {
    const db = getDb();

    const record = db.prepare(`
        SELECT id, device_name, device_type, permissions, created_at, last_used_at, expires_at, created_by, is_active
        FROM api_tokens WHERE id = ?
    `).get(tokenId);

    if (!record) return null;

    return {
        id: record.id,
        deviceName: record.device_name,
        deviceType: record.device_type,
        permissions: record.permissions,
        createdAt: record.created_at,
        lastUsedAt: record.last_used_at,
        expiresAt: record.expires_at,
        createdBy: record.created_by,
        isActive: record.is_active === 1,
        isExpired: record.expires_at ? record.expires_at < Date.now() : false
    };
}

// ============================================
// PDF REPORT ANALYTICS
// ============================================

/**
 * Get Elo rating changes for all players in a tournament (multi-tenant)
 * @param {number} tournamentId - Tournament ID
 * @param {number} userId - User ID for tenant isolation (required)
 */
function getEloChangesForTournament(tournamentId, userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get Elo changes');
    }

    // Verify tournament belongs to user
    const tournament = db.prepare(`SELECT id FROM tournaments WHERE id = ? AND user_id = ?`).get(tournamentId, userId);
    if (!tournament) return [];

    return db.prepare(`
        SELECT
            rh.player_id,
            p.display_name,
            p.canonical_name,
            rh.rating_before,
            rh.rating_after,
            rh.rating_change
        FROM rating_history rh
        JOIN players p ON rh.player_id = p.id
        WHERE rh.tournament_id = ?
        ORDER BY rh.rating_change DESC
    `).all(tournamentId);
}

/**
 * Get new vs returning player counts for a tournament (multi-tenant)
 * @param {number} tournamentId - Tournament ID
 * @param {number} userId - User ID for tenant isolation (required)
 */
function getNewVsReturningPlayers(tournamentId, userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get new vs returning players');
    }

    const tournament = db.prepare(`
        SELECT id, game_id, started_at FROM tournaments WHERE id = ? AND user_id = ?
    `).get(tournamentId, userId);

    if (!tournament) return { total: 0, new: 0, returning: 0, returnRate: 0 };

    // Count returning players (scoped to user's tournaments)
    const result = db.prepare(`
        SELECT
            COUNT(DISTINCT tp.player_id) as total,
            COUNT(DISTINCT CASE
                WHEN (
                    SELECT COUNT(*) FROM tournament_participants tp2
                    JOIN tournaments t2 ON tp2.tournament_id = t2.id
                    WHERE tp2.player_id = tp.player_id
                    AND t2.game_id = ?
                    AND t2.started_at < ?
                    AND t2.id != ?
                    AND t2.user_id = ?
                ) > 0 THEN tp.player_id
            END) as returning_count
        FROM tournament_participants tp
        WHERE tp.tournament_id = ?
    `).get(tournament.game_id, tournament.started_at, tournamentId, userId, tournamentId);

    return {
        total: result.total,
        returning: result.returning_count,
        new: result.total - result.returning_count,
        returnRate: result.total > 0 ? Math.round((result.returning_count / result.total) * 100) : 0
    };
}

// ============================================
// TOURNAMENT TEMPLATES
// ============================================

/**
 * Get all tournament templates
 * @param {Object} options - Query options
 * @param {string} options.gameName - Filter by game name
 * @returns {Array} List of templates
 */
function getAllTemplates(options = {}) {
    const db = getDb();
    const { gameName } = options;

    let query = `
        SELECT id, name, description, game_name, is_default, created_by, created_at, updated_at, settings_json
        FROM tournament_templates
    `;
    const params = [];

    if (gameName) {
        query += ` WHERE game_name = ?`;
        params.push(gameName);
    }

    query += ` ORDER BY is_default DESC, name ASC`;

    const templates = db.prepare(query).all(...params);

    // Parse settings_json for each template
    return templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        gameName: t.game_name,
        isDefault: t.is_default === 1,
        createdBy: t.created_by,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        settings: JSON.parse(t.settings_json)
    }));
}

/**
 * Get a single template by ID
 * @param {number} templateId - Template ID
 * @returns {Object|null} Template or null
 */
function getTemplateById(templateId) {
    const db = getDb();

    const t = db.prepare(`
        SELECT id, name, description, game_name, is_default, created_by, created_at, updated_at, settings_json
        FROM tournament_templates WHERE id = ?
    `).get(templateId);

    if (!t) return null;

    return {
        id: t.id,
        name: t.name,
        description: t.description,
        gameName: t.game_name,
        isDefault: t.is_default === 1,
        createdBy: t.created_by,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        settings: JSON.parse(t.settings_json)
    };
}

/**
 * Create a new tournament template
 * @param {string} name - Template name (unique)
 * @param {string} description - Template description
 * @param {string} gameName - Game name
 * @param {Object} settings - Tournament settings object
 * @param {string} createdBy - Username who created the template
 * @returns {Object} Created template
 */
function createTemplate(name, description, gameName, settings, createdBy) {
    const db = getDb();

    const settingsJson = JSON.stringify(settings);

    const result = db.prepare(`
        INSERT INTO tournament_templates (name, description, game_name, settings_json, created_by)
        VALUES (?, ?, ?, ?, ?)
    `).run(name, description, gameName, settingsJson, createdBy);

    console.log(`[Analytics DB] Template created: ${name} by ${createdBy}`);

    return {
        id: result.lastInsertRowid,
        name,
        description,
        gameName,
        isDefault: false,
        createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings
    };
}

/**
 * Update a tournament template
 * @param {number} templateId - Template ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} Updated template or null
 */
function updateTemplate(templateId, updates) {
    const db = getDb();

    const existing = getTemplateById(templateId);
    if (!existing) return null;

    const fields = [];
    const params = [];

    if (updates.name !== undefined) {
        fields.push('name = ?');
        params.push(updates.name);
    }
    if (updates.description !== undefined) {
        fields.push('description = ?');
        params.push(updates.description);
    }
    if (updates.gameName !== undefined) {
        fields.push('game_name = ?');
        params.push(updates.gameName);
    }
    if (updates.isDefault !== undefined) {
        // If setting as default, unset any existing default first
        if (updates.isDefault) {
            db.prepare(`UPDATE tournament_templates SET is_default = 0`).run();
        }
        fields.push('is_default = ?');
        params.push(updates.isDefault ? 1 : 0);
    }
    if (updates.settings !== undefined) {
        fields.push('settings_json = ?');
        params.push(JSON.stringify(updates.settings));
    }

    if (fields.length === 0) {
        return existing;
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(templateId);

    db.prepare(`
        UPDATE tournament_templates SET ${fields.join(', ')} WHERE id = ?
    `).run(...params);

    console.log(`[Analytics DB] Template updated: ID ${templateId}`);

    return getTemplateById(templateId);
}

/**
 * Delete a tournament template
 * @param {number} templateId - Template ID
 * @returns {boolean} True if deleted
 */
function deleteTemplate(templateId) {
    const db = getDb();

    // Prevent deleting default template
    const template = getTemplateById(templateId);
    if (!template) return false;
    if (template.isDefault) {
        throw new Error('Cannot delete default template');
    }

    const result = db.prepare(`
        DELETE FROM tournament_templates WHERE id = ?
    `).run(templateId);

    if (result.changes > 0) {
        console.log(`[Analytics DB] Template deleted: ID ${templateId}`);
        return true;
    }
    return false;
}

/**
 * Create a template from tournament data
 * @param {Object} tournamentData - Tournament data object
 * @param {string} templateName - Name for the template
 * @param {string} description - Template description
 * @param {string} createdBy - Username who created the template
 * @returns {Object} Created template
 */
function createTemplateFromTournament(tournamentData, templateName, description, createdBy) {
    // Extract settings from tournament data
    const settings = {
        tournamentType: tournamentData.tournamentType,
        gameName: tournamentData.gameName,
        // Single/Double Elim options
        grandFinalsModifier: tournamentData.grandFinalsModifier,
        holdThirdPlaceMatch: tournamentData.holdThirdPlaceMatch,
        sequentialPairings: tournamentData.sequentialPairings,
        showRounds: tournamentData.showRounds,
        // Round Robin options
        rrIterations: tournamentData.rrIterations,
        rankedBy: tournamentData.rankedBy,
        rrMatchWin: tournamentData.rrMatchWin,
        rrMatchTie: tournamentData.rrMatchTie,
        rrGameWin: tournamentData.rrGameWin,
        rrGameTie: tournamentData.rrGameTie,
        // Swiss options
        swissRounds: tournamentData.swissRounds,
        swissMatchWin: tournamentData.swissMatchWin,
        swissMatchTie: tournamentData.swissMatchTie,
        swissBye: tournamentData.swissBye,
        swissGameWin: tournamentData.swissGameWin,
        swissGameTie: tournamentData.swissGameTie,
        // Registration options
        checkInDuration: tournamentData.checkInDuration,
        signupCap: tournamentData.signupCap,
        openSignup: tournamentData.openSignup,
        // Display options
        hideSeeds: tournamentData.hideSeeds,
        privateTournament: tournamentData.privateTournament,
        hideForum: tournamentData.hideForum,
        // Match options
        acceptAttachments: tournamentData.acceptAttachments,
        quickAdvance: tournamentData.quickAdvance,
        // Notifications
        notifyMatchOpen: tournamentData.notifyMatchOpen,
        notifyTournamentEnd: tournamentData.notifyTournamentEnd,
        // Station settings
        autoAssign: tournamentData.autoAssign,
        // Group stage options
        groupStageEnabled: tournamentData.groupStageEnabled,
        groupStageOptions: tournamentData.groupStageOptions
    };

    // Remove undefined values
    Object.keys(settings).forEach(key => {
        if (settings[key] === undefined) {
            delete settings[key];
        }
    });

    return createTemplate(templateName, description, tournamentData.gameName, settings, createdBy);
}

// ============================================
// AI SEEDING CACHE FUNCTIONS
// ============================================

/**
 * Get cached AI seeding suggestions for a tournament
 * @param {string} tournamentId - Tournament ID (Challonge)
 * @returns {Object|null} Cached seeding data or null
 */
function getSeedingCache(tournamentId) {
    const db = getDb();

    const row = db.prepare(`
        SELECT * FROM ai_seeding_cache WHERE tournament_id = ?
    `).get(tournamentId);

    if (!row) return null;

    return {
        tournamentId: row.tournament_id,
        tournamentUrl: row.tournament_url,
        gameId: row.game_id,
        suggestions: JSON.parse(row.suggestions_json),
        participantHash: row.participant_hash,
        lockedSeeds: row.locked_seeds_json ? JSON.parse(row.locked_seeds_json) : [],
        generationCount: row.generation_count,
        source: row.source,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * Save AI seeding suggestions to cache
 * @param {string} tournamentId - Tournament ID
 * @param {string} tournamentUrl - Tournament URL slug
 * @param {number} gameId - Game ID (can be null)
 * @param {Object} suggestions - AI seeding suggestions
 * @param {string} participantHash - MD5 hash of participant IDs
 * @param {string} source - 'ai' or 'fallback'
 */
function saveSeedingCache(tournamentId, tournamentUrl, gameId, suggestions, participantHash, source = 'ai') {
    const db = getDb();

    const existing = getSeedingCache(tournamentId);
    const generationCount = existing ? existing.generationCount + 1 : 1;

    db.prepare(`
        INSERT INTO ai_seeding_cache (tournament_id, tournament_url, game_id, suggestions_json, participant_hash, generation_count, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(tournament_id) DO UPDATE SET
            tournament_url = excluded.tournament_url,
            game_id = excluded.game_id,
            suggestions_json = excluded.suggestions_json,
            participant_hash = excluded.participant_hash,
            generation_count = excluded.generation_count,
            source = excluded.source,
            updated_at = CURRENT_TIMESTAMP
    `).run(tournamentId, tournamentUrl, gameId, JSON.stringify(suggestions), participantHash, generationCount, source);

    console.log(`[Analytics DB] AI seeding cache saved for tournament: ${tournamentId} (generation ${generationCount})`);
}

/**
 * Update locked seeds for a tournament
 * @param {string} tournamentId - Tournament ID
 * @param {Array} lockedSeeds - Array of {participantId, seed, name}
 */
function updateLockedSeeds(tournamentId, lockedSeeds) {
    const db = getDb();

    db.prepare(`
        UPDATE ai_seeding_cache
        SET locked_seeds_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tournament_id = ?
    `).run(JSON.stringify(lockedSeeds), tournamentId);

    console.log(`[Analytics DB] Locked seeds updated for tournament: ${tournamentId} (${lockedSeeds.length} locked)`);
}

/**
 * Invalidate (delete) seeding cache for a tournament
 * Called when participants change
 * @param {string} tournamentId - Tournament ID
 */
function invalidateSeedingCache(tournamentId) {
    const db = getDb();

    const result = db.prepare(`
        DELETE FROM ai_seeding_cache WHERE tournament_id = ?
    `).run(tournamentId);

    if (result.changes > 0) {
        console.log(`[Analytics DB] AI seeding cache invalidated for tournament: ${tournamentId}`);
    }
}

// ============================================
// TOURNAMENT NARRATIVE CACHE
// ============================================

/**
 * Get cached narrative for a tournament and format
 * @param {number} tournamentId - Tournament ID (database ID)
 * @param {string} format - Narrative format (social, discord, full)
 * @returns {Object|null} Cached narrative data or null
 */
function getNarrativeCache(tournamentId, format) {
    const db = getDb();

    const row = db.prepare(`
        SELECT * FROM tournament_narratives
        WHERE tournament_id = ? AND format = ?
    `).get(tournamentId, format);

    if (!row) return null;

    return {
        id: row.id,
        tournamentId: row.tournament_id,
        format: row.format,
        narrative: row.narrative,
        socialPost: row.social_post,
        dataHash: row.data_hash,
        storylines: row.storylines_json ? JSON.parse(row.storylines_json) : null,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
        source: row.source,
        generatedAt: row.generated_at
    };
}

/**
 * Save narrative to cache
 * @param {number} tournamentId - Tournament ID (database ID)
 * @param {string} format - Narrative format (social, discord, full)
 * @param {string} narrative - Generated narrative text
 * @param {string} dataHash - Hash of tournament data for cache invalidation
 * @param {Object} metadata - Additional metadata (storylines, etc.)
 * @param {string} source - 'ai' or 'fallback'
 */
function saveNarrativeCache(tournamentId, format, narrative, dataHash, metadata = {}, source = 'ai') {
    const db = getDb();

    const { storylines, socialPost, ...otherMeta } = metadata;

    db.prepare(`
        INSERT INTO tournament_narratives (tournament_id, format, narrative, social_post, data_hash, storylines_json, metadata_json, source, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(tournament_id, format) DO UPDATE SET
            narrative = excluded.narrative,
            social_post = excluded.social_post,
            data_hash = excluded.data_hash,
            storylines_json = excluded.storylines_json,
            metadata_json = excluded.metadata_json,
            source = excluded.source,
            generated_at = CURRENT_TIMESTAMP
    `).run(
        tournamentId,
        format,
        narrative,
        socialPost || null,
        dataHash,
        storylines ? JSON.stringify(storylines) : null,
        Object.keys(otherMeta).length > 0 ? JSON.stringify(otherMeta) : null,
        source
    );

    console.log(`[Analytics DB] Narrative cache saved for tournament: ${tournamentId} (format: ${format}, source: ${source})`);
}

/**
 * Delete all cached narratives for a tournament
 * @param {number} tournamentId - Tournament ID (database ID)
 */
function deleteNarrativeCache(tournamentId) {
    const db = getDb();

    const result = db.prepare(`
        DELETE FROM tournament_narratives WHERE tournament_id = ?
    `).run(tournamentId);

    if (result.changes > 0) {
        console.log(`[Analytics DB] Narrative cache cleared for tournament: ${tournamentId} (${result.changes} entries)`);
    }
}

/**
 * Get all cached narrative formats for a tournament
 * @param {number} tournamentId - Tournament ID (database ID)
 * @returns {Array} Array of cached narratives
 */
function getAllNarrativesForTournament(tournamentId) {
    const db = getDb();

    const rows = db.prepare(`
        SELECT format, source, generated_at FROM tournament_narratives
        WHERE tournament_id = ?
        ORDER BY generated_at DESC
    `).all(tournamentId);

    return rows.map(row => ({
        format: row.format,
        source: row.source,
        generatedAt: row.generated_at
    }));
}

/**
 * Get recent matchups between a set of players (multi-tenant)
 * Used to avoid repeat matchups in AI seeding
 * @param {Array<number>} playerIds - Array of player IDs to check
 * @param {number} gameId - Game ID to filter by
 * @param {number} userId - User ID for tenant isolation (required)
 * @param {number} tournamentLimit - Number of recent tournaments to check (default 2)
 * @returns {Array} Array of {player1Id, player2Id, tournamentName, round, completedAt}
 */
function getPlayerRecentMatchups(playerIds, gameId, userId, tournamentLimit = 2) {
    const db = getDb();

    if (!playerIds || playerIds.length < 2) return [];
    if (!userId) {
        throw new Error('userId is required to get player recent matchups');
    }

    // Get the most recent tournaments for this game (within user's tournaments)
    const recentTournaments = db.prepare(`
        SELECT id, name FROM tournaments
        WHERE game_id = ? AND user_id = ?
        ORDER BY completed_at DESC
        LIMIT ?
    `).all(gameId, userId, tournamentLimit);

    if (recentTournaments.length === 0) return [];

    const tournamentIds = recentTournaments.map(t => t.id);
    const playerIdSet = new Set(playerIds);

    // Get all matches from these tournaments involving these players
    const placeholders = tournamentIds.map(() => '?').join(',');
    const matches = db.prepare(`
        SELECT m.*, t.name as tournament_name
        FROM matches m
        JOIN tournaments t ON m.tournament_id = t.id
        WHERE m.tournament_id IN (${placeholders})
        AND m.player1_id IS NOT NULL AND m.player2_id IS NOT NULL
        ORDER BY m.completed_at DESC
    `).all(...tournamentIds);

    // Filter to only matches between players in our set
    const matchups = [];
    for (const m of matches) {
        if (playerIdSet.has(m.player1_id) && playerIdSet.has(m.player2_id)) {
            matchups.push({
                player1Id: m.player1_id,
                player2Id: m.player2_id,
                tournamentName: m.tournament_name,
                round: m.round,
                completedAt: m.completed_at
            });
        }
    }

    return matchups;
}

/**
 * Get tournament count for a player in a specific game (multi-tenant)
 * Used to identify new players (< 3 tournaments)
 * @param {number} playerId - Player ID
 * @param {number} gameId - Game ID
 * @param {number} userId - User ID for tenant isolation (required)
 * @returns {number} Number of tournaments attended
 */
function getPlayerTournamentCount(playerId, gameId, userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get player tournament count');
    }

    const result = db.prepare(`
        SELECT COUNT(DISTINCT tp.tournament_id) as count
        FROM tournament_participants tp
        JOIN tournaments t ON tp.tournament_id = t.id
        WHERE tp.player_id = ? AND t.game_id = ? AND t.user_id = ?
    `).get(playerId, gameId, userId);

    return result?.count || 0;
}

/**
 * Get recent tournament placements for a player (multi-tenant)
 * @param {number} playerId - Player ID
 * @param {number} gameId - Game ID
 * @param {number} userId - User ID for tenant isolation (required)
 * @param {number} limit - Number of placements to return (default 5)
 * @returns {Array} Array of {tournamentName, finalRank, seed, participantCount, completedAt}
 */
function getPlayerRecentPlacements(playerId, gameId, userId, limit = 5) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get player recent placements');
    }

    return db.prepare(`
        SELECT
            t.name as tournament_name,
            tp.final_rank,
            tp.seed,
            t.participant_count,
            t.completed_at
        FROM tournament_participants tp
        JOIN tournaments t ON tp.tournament_id = t.id
        WHERE tp.player_id = ? AND t.game_id = ? AND t.user_id = ?
        ORDER BY t.completed_at DESC
        LIMIT ?
    `).all(playerId, gameId, userId, limit);
}

/**
 * Get comprehensive player data for AI seeding (multi-tenant)
 * @param {number} playerId - Player ID
 * @param {number} gameId - Game ID
 * @param {number} userId - User ID for tenant isolation (required)
 * @returns {Object|null} Player data with ELO, stats, and history
 */
function getPlayerSeedingData(playerId, gameId, userId) {
    const db = getDb();

    if (!userId) {
        throw new Error('userId is required to get player seeding data');
    }

    // Get player basic info (verify belongs to user)
    const player = db.prepare(`SELECT * FROM players WHERE id = ? AND user_id = ?`).get(playerId, userId);
    if (!player) return null;

    // Get rating for this game (user-scoped)
    const rating = db.prepare(`
        SELECT * FROM player_ratings WHERE player_id = ? AND game_id = ? AND user_id = ?
    `).get(playerId, gameId, userId);

    // Get tournament count (user-scoped)
    const tournamentCount = getPlayerTournamentCount(playerId, gameId, userId);

    // Get recent placements (user-scoped)
    const recentPlacements = getPlayerRecentPlacements(playerId, gameId, userId, 5);

    return {
        playerId,
        name: player.display_name,
        canonicalName: player.canonical_name,
        elo: rating?.elo_rating || ELO_INITIAL_RATING,
        peakElo: rating?.peak_rating || ELO_INITIAL_RATING,
        matchesPlayed: rating?.matches_played || 0,
        wins: rating?.wins || 0,
        losses: rating?.losses || 0,
        winRate: rating?.matches_played > 0
            ? Math.round((rating.wins / rating.matches_played) * 100)
            : 0,
        tournamentsAttended: tournamentCount,
        isNewPlayer: tournamentCount < 3,
        recentPlacements: recentPlacements.map(p => ({
            tournament: p.tournament_name,
            rank: p.final_rank,
            seed: p.seed,
            totalParticipants: p.participant_count,
            date: p.completed_at
        })),
        lastActive: rating?.last_active
    };
}

// ============================================
// PUSH NOTIFICATION FUNCTIONS
// ============================================

/**
 * Save or update a push subscription
 */
function savePushSubscription(userId, subscription, userAgent = null) {
    const database = getDb();
    const { endpoint, keys } = subscription;

    const stmt = database.prepare(`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, user_agent, last_used)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(endpoint) DO UPDATE SET
            user_id = excluded.user_id,
            p256dh_key = excluded.p256dh_key,
            auth_key = excluded.auth_key,
            user_agent = excluded.user_agent,
            last_used = CURRENT_TIMESTAMP
    `);

    stmt.run(userId, endpoint, keys.p256dh, keys.auth, userAgent);
    return { success: true };
}

/**
 * Get all push subscriptions for a user
 */
function getPushSubscriptions(userId) {
    const database = getDb();
    const stmt = database.prepare(`
        SELECT id, endpoint, p256dh_key, auth_key, user_agent, created_at, last_used
        FROM push_subscriptions
        WHERE user_id = ?
    `);
    return stmt.all(userId);
}

/**
 * Get all push subscriptions (for broadcasting)
 */
function getAllPushSubscriptions() {
    const database = getDb();
    const stmt = database.prepare(`
        SELECT ps.id, ps.user_id, ps.endpoint, ps.p256dh_key, ps.auth_key,
               np.match_completed, np.checkin_deadline, np.display_disconnected,
               np.new_signup, np.dq_timer_expired, np.tournament_started, np.sound_enabled
        FROM push_subscriptions ps
        LEFT JOIN notification_preferences np ON ps.user_id = np.user_id
    `);
    return stmt.all();
}

/**
 * Delete a push subscription by endpoint
 */
function deletePushSubscription(endpoint) {
    const database = getDb();
    const stmt = database.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`);
    const result = stmt.run(endpoint);
    return { success: result.changes > 0 };
}

/**
 * Delete all subscriptions for a user
 */
function deleteUserPushSubscriptions(userId) {
    const database = getDb();
    const stmt = database.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?`);
    const result = stmt.run(userId);
    return { success: true, deleted: result.changes };
}

/**
 * Get notification preferences for a user
 */
function getNotificationPreferences(userId) {
    const database = getDb();
    const stmt = database.prepare(`
        SELECT * FROM notification_preferences WHERE user_id = ?
    `);
    const prefs = stmt.get(userId);

    // Return defaults if no preferences exist
    if (!prefs) {
        return {
            user_id: userId,
            match_completed: 1,
            checkin_deadline: 1,
            display_disconnected: 1,
            new_signup: 1,
            dq_timer_expired: 1,
            tournament_started: 1,
            sound_enabled: 1
        };
    }
    return prefs;
}

/**
 * Save or update notification preferences
 */
function saveNotificationPreferences(userId, preferences) {
    const database = getDb();

    const stmt = database.prepare(`
        INSERT INTO notification_preferences (
            user_id, match_completed, checkin_deadline, display_disconnected,
            new_signup, dq_timer_expired, tournament_started, sound_enabled, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            match_completed = excluded.match_completed,
            checkin_deadline = excluded.checkin_deadline,
            display_disconnected = excluded.display_disconnected,
            new_signup = excluded.new_signup,
            dq_timer_expired = excluded.dq_timer_expired,
            tournament_started = excluded.tournament_started,
            sound_enabled = excluded.sound_enabled,
            updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
        userId,
        preferences.match_completed ?? 1,
        preferences.checkin_deadline ?? 1,
        preferences.display_disconnected ?? 1,
        preferences.new_signup ?? 1,
        preferences.dq_timer_expired ?? 1,
        preferences.tournament_started ?? 1,
        preferences.sound_enabled ?? 1
    );

    return { success: true };
}

/**
 * Update subscription last used timestamp
 */
function updateSubscriptionLastUsed(endpoint) {
    const database = getDb();
    const stmt = database.prepare(`
        UPDATE push_subscriptions SET last_used = CURRENT_TIMESTAMP WHERE endpoint = ?
    `);
    stmt.run(endpoint);
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    // Database
    initDatabase,
    getDb,
    closeDatabase,

    // Name matching
    normalizePlayerName,
    findPlayerByName,
    levenshteinDistance,

    // Players
    createPlayer,
    addPlayerAlias,
    mergePlayers,
    searchPlayers,
    getPlayerProfile,

    // Games
    getOrCreateGame,
    getAllGames,
    getGameShortCode,

    // Tournaments
    isTournamentArchived,
    archiveTournament,
    getArchivedTournaments,
    getTournamentById,

    // Participants
    addTournamentParticipant,

    // Matches
    parseScores,
    addMatch,

    // Ratings
    calculateEloChange,
    updateEloRatings,
    getPlayerRankings,

    // Analytics
    getHeadToHead,
    getOverviewStats,
    getAttendanceStats,
    getEloChangesForTournament,
    getNewVsReturningPlayers,

    // Unmatched players
    getUnmatchedPlayers,
    addUnmatchedPlayer,
    resolveUnmatchedPlayer,

    // OAuth token management
    encryptToken,
    decryptToken,
    saveOAuthTokens,
    getOAuthTokens,
    deleteOAuthTokens,
    isOAuthConnected,
    tokenNeedsRefresh,
    getOAuthStatus,

    // API token management (device authentication)
    createApiToken,
    verifyApiToken,
    updateTokenLastUsed,
    listApiTokens,
    revokeApiToken,
    deleteApiToken,
    getApiToken,

    // Tournament templates
    getAllTemplates,
    getTemplateById,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    createTemplateFromTournament,

    // Push notifications
    savePushSubscription,
    getPushSubscriptions,
    getAllPushSubscriptions,
    deletePushSubscription,
    deleteUserPushSubscriptions,
    getNotificationPreferences,
    saveNotificationPreferences,
    updateSubscriptionLastUsed,

    // AI Seeding cache
    getSeedingCache,
    saveSeedingCache,
    updateLockedSeeds,
    invalidateSeedingCache,
    getPlayerRecentMatchups,
    getPlayerTournamentCount,
    getPlayerRecentPlacements,
    getPlayerSeedingData,

    // Tournament Narrative cache
    getNarrativeCache,
    saveNarrativeCache,
    deleteNarrativeCache,
    getAllNarrativesForTournament,

    // Constants
    ELO_K_FACTOR,
    ELO_INITIAL_RATING
};
