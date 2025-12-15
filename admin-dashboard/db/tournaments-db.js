/**
 * Tournaments Database Module
 * SQLite database for live tournament operations
 *
 * Contains: tcc_tournaments, tcc_participants, tcc_matches, tcc_stations, tcc_standings
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'tournaments.db');
let db = null;

/**
 * Initialize database connection and create tables
 */
function initDatabase() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        -- Local tournaments (live tournament state)
        CREATE TABLE IF NOT EXISTS tcc_tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url_slug TEXT NOT NULL UNIQUE,
            description TEXT,
            game_id INTEGER,  -- References system.db games (app-level)
            tournament_type TEXT NOT NULL CHECK(tournament_type IN
                ('single_elimination', 'double_elimination', 'round_robin', 'swiss', 'two_stage', 'free_for_all', 'leaderboard')),
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

            -- Custom round labels (JSON: { winners: { "1": "Pools", ... }, losers: { ... } })
            round_labels_json TEXT,

            -- Two-stage tournament settings
            current_stage TEXT DEFAULT 'group' CHECK(current_stage IN ('group', 'knockout', 'complete', NULL)),
            knockout_format TEXT CHECK(knockout_format IN ('single_elimination', 'double_elimination', NULL)),
            group_count INTEGER DEFAULT 4,
            advance_per_group INTEGER DEFAULT 2,

            -- Free-for-all settings
            players_per_match INTEGER DEFAULT 8,
            total_rounds INTEGER DEFAULT 3,
            points_system_json TEXT  -- JSON for custom points per placement
        );

        -- Local participants
        CREATE TABLE IF NOT EXISTS tcc_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            player_id INTEGER,  -- References players.db (app-level)
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

            FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE
        );

        -- Local matches
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

            -- State: pending -> open -> underway -> complete
            state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN
                ('pending', 'open', 'underway', 'complete')),

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

        -- Local stations
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

        -- Indexes
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

        -- Waitlist for full tournaments
        CREATE TABLE IF NOT EXISTS tcc_waitlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            position INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting', 'promoted', 'expired', 'removed')),
            notified_at DATETIME,
            promoted_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tcc_waitlist_tournament ON tcc_waitlist(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_waitlist_status ON tcc_waitlist(tournament_id, status);
        CREATE INDEX IF NOT EXISTS idx_tcc_waitlist_position ON tcc_waitlist(tournament_id, position);

        -- Free-for-All placements (for multi-player matches)
        CREATE TABLE IF NOT EXISTS tcc_ffa_placements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            participant_id INTEGER NOT NULL,
            placement INTEGER NOT NULL,        -- 1st, 2nd, 3rd, etc.
            points_awarded INTEGER DEFAULT 0,  -- Points for this placement
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (match_id) REFERENCES tcc_matches(id) ON DELETE CASCADE,
            FOREIGN KEY (participant_id) REFERENCES tcc_participants(id) ON DELETE CASCADE,
            UNIQUE(match_id, participant_id)
        );

        CREATE INDEX IF NOT EXISTS idx_tcc_ffa_match ON tcc_ffa_placements(match_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_ffa_participant ON tcc_ffa_placements(participant_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_ffa_placement ON tcc_ffa_placements(match_id, placement);

        -- Leaderboard events (for ongoing rankings)
        CREATE TABLE IF NOT EXISTS tcc_leaderboard_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,   -- The leaderboard "tournament"
            event_name TEXT,
            event_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_complete INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tcc_leaderboard_events_tournament ON tcc_leaderboard_events(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_leaderboard_events_date ON tcc_leaderboard_events(event_date);

        -- Leaderboard event results
        CREATE TABLE IF NOT EXISTS tcc_leaderboard_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id INTEGER NOT NULL,
            participant_id INTEGER NOT NULL,
            placement INTEGER,
            points_awarded INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (event_id) REFERENCES tcc_leaderboard_events(id) ON DELETE CASCADE,
            FOREIGN KEY (participant_id) REFERENCES tcc_participants(id) ON DELETE CASCADE,
            UNIQUE(event_id, participant_id)
        );

        CREATE INDEX IF NOT EXISTS idx_tcc_leaderboard_results_event ON tcc_leaderboard_results(event_id);
        CREATE INDEX IF NOT EXISTS idx_tcc_leaderboard_results_participant ON tcc_leaderboard_results(participant_id);
    `);

    // Migration: Add round_labels_json column if it doesn't exist (for existing databases)
    const tableInfo = db.prepare("PRAGMA table_info(tcc_tournaments)").all();
    const hasRoundLabels = tableInfo.some(col => col.name === 'round_labels_json');
    if (!hasRoundLabels) {
        db.exec("ALTER TABLE tcc_tournaments ADD COLUMN round_labels_json TEXT");
        console.log('[Tournaments DB] Migration: Added round_labels_json column');
    }

    // Migration: Add two-stage tournament columns
    const hasCurrentStage = tableInfo.some(col => col.name === 'current_stage');
    if (!hasCurrentStage) {
        db.exec(`
            ALTER TABLE tcc_tournaments ADD COLUMN current_stage TEXT DEFAULT 'group' CHECK(current_stage IN ('group', 'knockout', 'complete', NULL));
            ALTER TABLE tcc_tournaments ADD COLUMN knockout_format TEXT CHECK(knockout_format IN ('single_elimination', 'double_elimination', NULL));
            ALTER TABLE tcc_tournaments ADD COLUMN group_count INTEGER DEFAULT 4;
            ALTER TABLE tcc_tournaments ADD COLUMN advance_per_group INTEGER DEFAULT 2;
        `);
        console.log('[Tournaments DB] Migration: Added two-stage tournament columns');
    }

    // Migration: Add free-for-all columns
    const hasPlayersPerMatch = tableInfo.some(col => col.name === 'players_per_match');
    if (!hasPlayersPerMatch) {
        db.exec(`
            ALTER TABLE tcc_tournaments ADD COLUMN players_per_match INTEGER DEFAULT 8;
            ALTER TABLE tcc_tournaments ADD COLUMN total_rounds INTEGER DEFAULT 3;
            ALTER TABLE tcc_tournaments ADD COLUMN points_system_json TEXT;
        `);
        console.log('[Tournaments DB] Migration: Added free-for-all columns');
    }

    console.log('[Tournaments DB] Database initialized at', DB_PATH);
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

module.exports = {
    initDatabase,
    getDb,
    closeDatabase,
    getDbPath,
    DB_PATH
};
