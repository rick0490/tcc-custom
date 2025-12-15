/**
 * System Database Module
 * SQLite database for system configuration, auth, and shared data
 *
 * Contains: games, game_configs, users, auth_tracking, system_settings,
 *           displays, view_mappings, tournament_templates, oauth_tokens,
 *           api_tokens, push_subscriptions, notification_preferences,
 *           sponsors, sponsor_config
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'system.db');
let db = null;

/**
 * Initialize database connection and create tables
 */
function initDatabase() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        -- Game definitions (multi-tenant with user_id)
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,  -- Tenant isolation
            game_key TEXT NOT NULL,    -- Unique per user (e.g., 'ssbu', 'mkw')
            name TEXT NOT NULL,
            short_name TEXT,
            icon TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, game_key),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Game-specific rules and prizes (replaces game-configs.json)
        CREATE TABLE IF NOT EXISTS game_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL UNIQUE,
            rules_json TEXT,           -- Array of {title, description}
            prizes_json TEXT,          -- Array of prize objects
            additional_info_json TEXT, -- Array of strings
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        );

        -- Add index for fast tenant lookups
        CREATE INDEX IF NOT EXISTS idx_games_user_id ON games(user_id);

        -- User accounts (replaces users.json)
        -- Note: Role column removed - each tenant has one user, no admin/user distinction
        -- Superadmin is determined by userId === 1
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Login tracking (replaces auth-data.json)
        CREATE TABLE IF NOT EXISTS auth_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            failed_attempts INTEGER DEFAULT 0,
            locked_until DATETIME,
            last_attempt DATETIME,
            last_success DATETIME
        );

        -- System settings (replaces system-settings.json)
        CREATE TABLE IF NOT EXISTS system_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value_json TEXT NOT NULL,
            description TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Registered Pi displays (replaces displays.json)
        CREATE TABLE IF NOT EXISTS displays (
            id TEXT PRIMARY KEY,          -- MAC-based ID
            hostname TEXT,
            ip TEXT,
            external_ip TEXT,
            mac TEXT,
            current_view TEXT,
            assigned_view TEXT,
            status TEXT DEFAULT 'offline' CHECK(status IN ('online', 'offline', 'error')),
            last_heartbeat DATETIME,
            system_info_json TEXT,
            debug_mode INTEGER DEFAULT 0,
            pending_command_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Display view mappings
        CREATE TABLE IF NOT EXISTS view_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            view_name TEXT UNIQUE NOT NULL,
            server_url TEXT,
            port INTEGER,
            use_tls INTEGER DEFAULT 0,
            description TEXT
        );

        -- Tournament templates
        CREATE TABLE IF NOT EXISTS tournament_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT,
            game_name TEXT,
            is_default INTEGER DEFAULT 0,
            created_by TEXT,
            settings_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- OAuth tokens
        CREATE TABLE IF NOT EXISTS oauth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT DEFAULT 'challonge',
            access_token_encrypted TEXT,
            refresh_token_encrypted TEXT,
            expires_at DATETIME,
            scope TEXT,
            iv TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- API tokens for devices
        CREATE TABLE IF NOT EXISTS api_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_hash TEXT UNIQUE NOT NULL,
            device_name TEXT,
            device_type TEXT DEFAULT 'streamdeck' CHECK(device_type IN ('streamdeck', 'display', 'api', 'other')),
            permissions TEXT DEFAULT 'full',
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME,
            expires_at DATETIME
        );

        -- Push notification subscriptions
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            endpoint TEXT UNIQUE NOT NULL,
            p256dh_key TEXT,
            auth_key TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        -- Notification preferences
        CREATE TABLE IF NOT EXISTS notification_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE,
            match_completed INTEGER DEFAULT 1,
            tournament_started INTEGER DEFAULT 1,
            new_signup INTEGER DEFAULT 1,
            display_disconnected INTEGER DEFAULT 1,
            dq_timer_expired INTEGER DEFAULT 1,
            sound_enabled INTEGER DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Sponsor overlays (replaces sponsor-state.json)
        CREATE TABLE IF NOT EXISTS sponsors (
            id TEXT PRIMARY KEY,
            name TEXT,
            filename TEXT NOT NULL,
            position TEXT CHECK(position IN ('top-left', 'top-right', 'bottom-left', 'bottom-right', 'center', 'top-banner', 'bottom-banner')),
            type TEXT DEFAULT 'corner' CHECK(type IN ('corner', 'banner', 'fullscreen')),
            size INTEGER DEFAULT 100,
            opacity INTEGER DEFAULT 100,
            offset_x INTEGER DEFAULT 0,
            offset_y INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            display_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Sponsor display config
        CREATE TABLE IF NOT EXISTS sponsor_config (
            id INTEGER PRIMARY KEY CHECK(id = 1),  -- Single row
            enabled INTEGER DEFAULT 0,
            rotation_interval INTEGER DEFAULT 30,
            current_index_json TEXT
        );

        -- Insert default sponsor config if not exists
        INSERT OR IGNORE INTO sponsor_config (id, enabled, rotation_interval) VALUES (1, 0, 30);

        -- Sponsor impression tracking (monetization analytics)
        CREATE TABLE IF NOT EXISTS sponsor_impressions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sponsor_id TEXT NOT NULL,
            display_id TEXT,                  -- Which Pi display showed it
            display_type TEXT CHECK(display_type IN ('match', 'bracket', 'flyer')),
            tournament_id INTEGER,            -- Which tournament was active
            position TEXT,                    -- Position on screen
            display_start DATETIME NOT NULL,  -- When sponsor was shown
            display_end DATETIME,             -- When sponsor was hidden
            duration_seconds INTEGER,         -- Calculated display time
            viewer_estimate INTEGER DEFAULT 0, -- Estimated viewers (can be set manually)
            FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
        );

        -- Sponsor impression aggregates (daily summaries)
        CREATE TABLE IF NOT EXISTS sponsor_impression_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sponsor_id TEXT NOT NULL,
            stat_date DATE NOT NULL,
            total_impressions INTEGER DEFAULT 0,
            total_duration_seconds INTEGER DEFAULT 0,
            total_viewer_minutes INTEGER DEFAULT 0, -- duration * viewers / 60
            display_match_count INTEGER DEFAULT 0,
            display_bracket_count INTEGER DEFAULT 0,
            tournaments_count INTEGER DEFAULT 0,
            UNIQUE(sponsor_id, stat_date),
            FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
        );

        -- Platform announcements (superadmin broadcasts)
        CREATE TABLE IF NOT EXISTS platform_announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message TEXT NOT NULL,
            type TEXT DEFAULT 'info' CHECK(type IN ('info', 'warning', 'alert')),
            is_active INTEGER DEFAULT 1,
            expires_at DATETIME,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        );

        -- Discord integration settings (per-user, multi-tenant)
        CREATE TABLE IF NOT EXISTS discord_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            integration_type TEXT DEFAULT 'webhook' CHECK(integration_type IN ('webhook', 'bot')),
            webhook_url_encrypted TEXT,
            webhook_iv TEXT,
            bot_token_encrypted TEXT,
            bot_token_iv TEXT,
            channel_id TEXT,
            guild_id TEXT,
            notify_tournament_start INTEGER DEFAULT 1,
            notify_tournament_complete INTEGER DEFAULT 1,
            notify_match_complete INTEGER DEFAULT 1,
            notify_participant_signup INTEGER DEFAULT 1,
            notify_participant_checkin INTEGER DEFAULT 1,
            notify_dq_timer INTEGER DEFAULT 1,
            mention_role_id TEXT,
            embed_color TEXT DEFAULT '#5865F2',
            include_bracket_link INTEGER DEFAULT 1,
            is_enabled INTEGER DEFAULT 0,
            last_test_at DATETIME,
            last_error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- =============================================================================
        -- PHASE 2: Performance Monitoring Tables
        -- =============================================================================

        -- Store historical metrics for trend charts
        CREATE TABLE IF NOT EXISTS metrics_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            metric_type TEXT NOT NULL,  -- 'api_latency', 'memory', 'cpu', 'display_health'
            metric_name TEXT NOT NULL,  -- endpoint name or resource name
            value REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_metrics_type_time ON metrics_history(metric_type, timestamp);

        -- Alert thresholds configuration
        CREATE TABLE IF NOT EXISTS alert_thresholds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            metric_type TEXT NOT NULL UNIQUE,
            warning_threshold REAL,
            critical_threshold REAL,
            enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Alert history
        CREATE TABLE IF NOT EXISTS alert_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            metric_type TEXT NOT NULL,
            metric_name TEXT,
            severity TEXT CHECK(severity IN ('warning', 'critical')),
            message TEXT NOT NULL,
            value REAL,
            acknowledged INTEGER DEFAULT 0,
            acknowledged_by INTEGER,
            acknowledged_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (acknowledged_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_alert_history_unacked ON alert_history(acknowledged, created_at);

        -- Insert default alert thresholds
        INSERT OR IGNORE INTO alert_thresholds (metric_type, warning_threshold, critical_threshold) VALUES
            ('api_latency', 500, 1000),        -- ms
            ('memory_usage', 70, 90),           -- percent
            ('cpu_usage', 70, 90),              -- percent
            ('display_offline', 1, 3),          -- count
            ('database_size', 500, 900);        -- MB

        -- =============================================================================
        -- PHASE 2: Display Fleet Management Tables
        -- =============================================================================

        -- Command history for audit
        CREATE TABLE IF NOT EXISTS display_commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_id TEXT NOT NULL,
            user_id INTEGER,  -- Which user owns this display (multi-tenant)
            command TEXT NOT NULL,  -- 'reboot', 'shutdown', 'refresh', 'debug_on', 'debug_off'
            issued_by INTEGER NOT NULL,
            issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            executed_at DATETIME,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'executed', 'failed', 'cancelled')),
            error_message TEXT,
            FOREIGN KEY (issued_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_display_commands_display ON display_commands(display_id, issued_at);
        CREATE INDEX IF NOT EXISTS idx_display_commands_status ON display_commands(status);

        -- =============================================================================
        -- PHASE 2: Automated Backup System Tables
        -- =============================================================================

        -- Backup schedules
        CREATE TABLE IF NOT EXISTS backup_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            database TEXT NOT NULL CHECK(database IN ('all', 'tournaments', 'players', 'system')),
            cron_expression TEXT NOT NULL,  -- e.g., '0 2 * * *' for 2am daily
            retention_days INTEGER DEFAULT 7,
            enabled INTEGER DEFAULT 1,
            last_run DATETIME,
            last_status TEXT CHECK(last_status IN ('success', 'failed')),
            next_run DATETIME,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        );

        -- Backup history with status
        CREATE TABLE IF NOT EXISTS backup_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            schedule_id INTEGER,  -- NULL for manual backups
            filename TEXT NOT NULL,
            database TEXT NOT NULL,
            size_bytes INTEGER,
            status TEXT CHECK(status IN ('success', 'failed', 'in_progress')),
            error_message TEXT,
            created_by INTEGER,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            FOREIGN KEY (schedule_id) REFERENCES backup_schedules(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_backup_history_schedule ON backup_history(schedule_id, started_at);
        CREATE INDEX IF NOT EXISTS idx_backup_history_status ON backup_history(status);

        -- Flyer media settings (multi-tenant video playback control)
        CREATE TABLE IF NOT EXISTS flyer_media_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            -- Behavior Settings
            loop_enabled INTEGER DEFAULT 1,
            autoplay_enabled INTEGER DEFAULT 1,
            default_muted INTEGER DEFAULT 1,
            default_volume INTEGER DEFAULT 100,
            -- Playlist Settings
            playlist_enabled INTEGER DEFAULT 0,
            playlist_loop INTEGER DEFAULT 1,
            playlist_auto_advance INTEGER DEFAULT 1,
            playlist_items_json TEXT,
            playlist_current_index INTEGER DEFAULT 0,
            -- State Tracking
            current_flyer TEXT,
            playback_state TEXT DEFAULT 'stopped' CHECK(playback_state IN ('playing', 'paused', 'stopped')),
            current_time REAL DEFAULT 0,
            duration REAL DEFAULT 0,
            is_muted INTEGER DEFAULT 1,
            current_volume INTEGER DEFAULT 100,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_flyer_media_settings_user ON flyer_media_settings(user_id);

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_auth_tracking_username ON auth_tracking(username);
        CREATE INDEX IF NOT EXISTS idx_auth_tracking_locked ON auth_tracking(locked_until);
        CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
        CREATE INDEX IF NOT EXISTS idx_displays_status ON displays(status);
        CREATE INDEX IF NOT EXISTS idx_displays_view ON displays(assigned_view);
        CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
        CREATE INDEX IF NOT EXISTS idx_api_tokens_active ON api_tokens(is_active);
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sponsors_active ON sponsors(active);
        CREATE INDEX IF NOT EXISTS idx_sponsors_order ON sponsors(display_order);
        CREATE INDEX IF NOT EXISTS idx_sponsor_impressions_sponsor ON sponsor_impressions(sponsor_id);
        CREATE INDEX IF NOT EXISTS idx_sponsor_impressions_date ON sponsor_impressions(display_start);
        CREATE INDEX IF NOT EXISTS idx_sponsor_impressions_display ON sponsor_impressions(display_id);
        CREATE INDEX IF NOT EXISTS idx_sponsor_impression_stats_sponsor ON sponsor_impression_stats(sponsor_id);
        CREATE INDEX IF NOT EXISTS idx_sponsor_impression_stats_date ON sponsor_impression_stats(stat_date);
        CREATE INDEX IF NOT EXISTS idx_platform_announcements_active ON platform_announcements(is_active, expires_at);
        CREATE INDEX IF NOT EXISTS idx_discord_settings_user ON discord_settings(user_id);
        CREATE INDEX IF NOT EXISTS idx_discord_settings_enabled ON discord_settings(is_enabled);
    `);

    // Migration: Add active_tournament_id column to users table if not exists
    // This column stores manual override for active tournament (NULL = auto-select)
    try {
        const userColumns = db.prepare("PRAGMA table_info(users)").all();
        const hasActiveTournament = userColumns.some(col => col.name === 'active_tournament_id');
        if (!hasActiveTournament) {
            db.exec('ALTER TABLE users ADD COLUMN active_tournament_id INTEGER');
            console.log('[System DB] Added active_tournament_id column to users table');
        }
    } catch (err) {
        console.error('[System DB] Error adding active_tournament_id column:', err.message);
    }

    console.log('[System DB] Database initialized at', DB_PATH);
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
// GAMES HELPERS (Multi-Tenant)
// =============================================================================

/**
 * Get all games for a specific user (tenant)
 * @param {number} userId - User/tenant ID
 */
function getAllGamesForUser(userId) {
    return getDb().prepare(`
        SELECT g.*, gc.rules_json, gc.prizes_json, gc.additional_info_json, gc.updated_at as config_updated_at
        FROM games g
        LEFT JOIN game_configs gc ON g.id = gc.game_id
        WHERE g.user_id = ?
        ORDER BY g.name
    `).all(userId);
}

/**
 * Get all games (superadmin view - no tenant filter)
 */
function getAllGames() {
    return getDb().prepare(`
        SELECT g.*, gc.rules_json, gc.prizes_json, gc.additional_info_json
        FROM games g
        LEFT JOIN game_configs gc ON g.id = gc.game_id
        ORDER BY g.user_id, g.name
    `).all();
}

/**
 * Get game by ID
 */
function getGameById(id) {
    return getDb().prepare(`
        SELECT g.*, gc.rules_json, gc.prizes_json, gc.additional_info_json
        FROM games g
        LEFT JOIN game_configs gc ON g.id = gc.game_id
        WHERE g.id = ?
    `).get(id);
}

/**
 * Get game by key for a specific user
 * @param {number} userId - User/tenant ID
 * @param {string} gameKey - Game key (e.g., 'ssbu', 'mkw')
 */
function getGameByKey(userId, gameKey) {
    return getDb().prepare(`
        SELECT g.*, gc.rules_json, gc.prizes_json, gc.additional_info_json
        FROM games g
        LEFT JOIN game_configs gc ON g.id = gc.game_id
        WHERE g.user_id = ? AND g.game_key = ?
    `).get(userId, gameKey);
}

/**
 * Get game by name for a specific user
 * @param {number} userId - User/tenant ID
 * @param {string} name - Game name
 */
function getGameByName(userId, name) {
    return getDb().prepare(`
        SELECT g.*, gc.rules_json, gc.prizes_json, gc.additional_info_json
        FROM games g
        LEFT JOIN game_configs gc ON g.id = gc.game_id
        WHERE g.user_id = ? AND g.name = ?
    `).get(userId, name);
}

/**
 * Create game for a user
 * @param {number} userId - User/tenant ID
 * @param {Object} data - Game data { gameKey, name, shortName, rules, prizes, additionalInfo }
 */
function createGame(userId, data) {
    const db = getDb();
    const { gameKey, name, shortName, rules, prizes, additionalInfo } = data;

    // Insert game
    const result = db.prepare(`
        INSERT INTO games (user_id, game_key, name, short_name)
        VALUES (?, ?, ?, ?)
    `).run(userId, gameKey, name, shortName || '');

    const gameId = result.lastInsertRowid;

    // Insert game config
    db.prepare(`
        INSERT INTO game_configs (game_id, rules_json, prizes_json, additional_info_json)
        VALUES (?, ?, ?, ?)
    `).run(
        gameId,
        JSON.stringify(rules || []),
        JSON.stringify(prizes || getDefaultPrizes()),
        JSON.stringify(additionalInfo || [])
    );

    return getGameById(gameId);
}

/**
 * Update game
 * @param {number} gameId - Game ID
 * @param {Object} data - Fields to update
 */
function updateGame(gameId, data) {
    const db = getDb();
    const { gameKey, name, shortName, rules, prizes, additionalInfo } = data;

    // Update game table if name/shortName/gameKey provided
    if (name !== undefined || shortName !== undefined || gameKey !== undefined) {
        const updates = [];
        const params = [];

        if (gameKey !== undefined) {
            updates.push('game_key = ?');
            params.push(gameKey);
        }
        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        if (shortName !== undefined) {
            updates.push('short_name = ?');
            params.push(shortName);
        }

        if (updates.length > 0) {
            params.push(gameId);
            db.prepare(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }
    }

    // Update game_configs if rules/prizes/additionalInfo provided
    if (rules !== undefined || prizes !== undefined || additionalInfo !== undefined) {
        const updates = [];
        const params = [];

        if (rules !== undefined) {
            updates.push('rules_json = ?');
            params.push(JSON.stringify(rules));
        }
        if (prizes !== undefined) {
            updates.push('prizes_json = ?');
            params.push(JSON.stringify(prizes));
        }
        if (additionalInfo !== undefined) {
            updates.push('additional_info_json = ?');
            params.push(JSON.stringify(additionalInfo));
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(gameId);

        db.prepare(`UPDATE game_configs SET ${updates.join(', ')} WHERE game_id = ?`).run(...params);
    }

    return getGameById(gameId);
}

/**
 * Delete game
 * @param {number} gameId - Game ID
 */
function deleteGame(gameId) {
    const result = getDb().prepare('DELETE FROM games WHERE id = ?').run(gameId);
    return result.changes > 0;
}

/**
 * Create or get game for a user (upsert by name)
 * @param {number} userId - User/tenant ID
 * @param {string} name - Game name
 * @param {string} shortCode - Optional short code
 */
function ensureGame(userId, name, shortCode = null) {
    const existing = getGameByName(userId, name);
    if (existing) return existing;

    // Generate game key from name
    const gameKey = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 30);

    return createGame(userId, {
        gameKey,
        name,
        shortName: shortCode || ''
    });
}

/**
 * Get default prizes structure
 */
function getDefaultPrizes() {
    return [
        { place: 1, position: '1st Place', emoji: '', amount: 30, gradient: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)', extras: [] },
        { place: 2, position: '2nd Place', emoji: '', amount: 20, gradient: 'linear-gradient(135deg, #c0c0c0 0%, #909090 100%)', extras: [] },
        { place: 3, position: '3rd Place', emoji: '', amount: 10, gradient: 'linear-gradient(135deg, #cd7f32 0%, #8b5a2b 100%)', extras: [] }
    ];
}

/**
 * Create default game for a new user
 * @param {number} userId - User ID
 */
function createDefaultGameForUser(userId) {
    const existing = getGameByKey(userId, 'default');
    if (existing) return existing;

    return createGame(userId, {
        gameKey: 'default',
        name: 'Tournament',
        shortName: '',
        rules: [],
        prizes: getDefaultPrizes(),
        additionalInfo: []
    });
}

// =============================================================================
// SETTINGS HELPERS
// =============================================================================

/**
 * Get setting value
 */
function getSetting(key, defaultValue = null) {
    const row = getDb().prepare('SELECT value_json FROM system_settings WHERE key = ?').get(key);
    if (!row) return defaultValue;
    try {
        return JSON.parse(row.value_json);
    } catch {
        return defaultValue;
    }
}

/**
 * Set setting value
 */
function setSetting(key, value, description = null) {
    const valueJson = JSON.stringify(value);
    getDb().prepare(`
        INSERT INTO system_settings (key, value_json, description, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            description = COALESCE(excluded.description, system_settings.description),
            updated_at = CURRENT_TIMESTAMP
    `).run(key, valueJson, description);
}

/**
 * Get all settings
 */
function getAllSettings() {
    const rows = getDb().prepare('SELECT key, value_json, description FROM system_settings').all();
    const settings = {};
    for (const row of rows) {
        try {
            settings[row.key] = JSON.parse(row.value_json);
        } catch {
            settings[row.key] = row.value_json;
        }
    }
    return settings;
}

// =============================================================================
// USER HELPERS
// =============================================================================

/**
 * Get user by username
 */
function getUserByUsername(username) {
    return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

/**
 * Get user by ID
 */
function getUserById(id) {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/**
 * Create user
 * Note: Role parameter removed - each tenant has one user
 */
function createUser(username, passwordHash) {
    const result = getDb().prepare(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)'
    ).run(username, passwordHash);
    return getUserById(result.lastInsertRowid);
}

/**
 * Update user password
 */
function updateUserPassword(id, passwordHash) {
    getDb().prepare(
        'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(passwordHash, id);
}

/**
 * Get all users (without password hashes)
 */
function getAllUsers() {
    return getDb().prepare(
        'SELECT id, username, email, created_at, updated_at FROM users'
    ).all();
}

// =============================================================================
// ACTIVE TOURNAMENT HELPERS
// =============================================================================

/**
 * Get manually set active tournament ID for a user
 * Returns NULL if user is in auto-select mode
 * @param {number} userId - User ID
 * @returns {number|null} Tournament ID or null
 */
function getManualActiveTournamentId(userId) {
    const user = getDb().prepare('SELECT active_tournament_id FROM users WHERE id = ?').get(userId);
    return user ? user.active_tournament_id : null;
}

/**
 * Set manual active tournament for a user (overrides auto-select)
 * Pass NULL to revert to auto-select mode
 * @param {number} userId - User ID
 * @param {number|null} tournamentId - Tournament ID or null for auto-select
 */
function setManualActiveTournamentId(userId, tournamentId) {
    getDb().prepare(
        'UPDATE users SET active_tournament_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(tournamentId, userId);
}

/**
 * Clear manual active tournament (revert to auto-select)
 * @param {number} userId - User ID
 */
function clearManualActiveTournament(userId) {
    setManualActiveTournamentId(userId, null);
}

/**
 * Check if user is in manual override mode for active tournament
 * @param {number} userId - User ID
 * @returns {boolean} True if manual override is set
 */
function isManualActiveTournamentMode(userId) {
    return getManualActiveTournamentId(userId) !== null;
}

// =============================================================================
// AUTH TRACKING HELPERS
// =============================================================================

/**
 * Get auth tracking for username
 */
function getAuthTracking(username) {
    return getDb().prepare('SELECT * FROM auth_tracking WHERE username = ?').get(username);
}

/**
 * Record failed login attempt
 */
function recordFailedAttempt(username, lockDurationMinutes = 15) {
    const existing = getAuthTracking(username);
    const now = new Date().toISOString();

    if (existing) {
        const newAttempts = existing.failed_attempts + 1;
        let lockedUntil = null;

        // Lock after 5 failed attempts
        if (newAttempts >= 5) {
            const lockTime = new Date();
            lockTime.setMinutes(lockTime.getMinutes() + lockDurationMinutes);
            lockedUntil = lockTime.toISOString();
        }

        getDb().prepare(`
            UPDATE auth_tracking
            SET failed_attempts = ?, locked_until = ?, last_attempt = ?
            WHERE username = ?
        `).run(newAttempts, lockedUntil, now, username);
    } else {
        getDb().prepare(`
            INSERT INTO auth_tracking (username, failed_attempts, last_attempt)
            VALUES (?, 1, ?)
        `).run(username, now);
    }
}

/**
 * Record successful login
 */
function recordSuccessfulLogin(username) {
    const now = new Date().toISOString();
    getDb().prepare(`
        INSERT INTO auth_tracking (username, failed_attempts, last_success)
        VALUES (?, 0, ?)
        ON CONFLICT(username) DO UPDATE SET
            failed_attempts = 0,
            locked_until = NULL,
            last_success = ?
    `).run(username, now, now);
}

/**
 * Check if user is locked out
 */
function isUserLocked(username) {
    const tracking = getAuthTracking(username);
    if (!tracking || !tracking.locked_until) return false;
    return new Date(tracking.locked_until) > new Date();
}

// =============================================================================
// DISPLAY HELPERS
// =============================================================================

/**
 * Get all displays
 */
function getAllDisplays() {
    return getDb().prepare('SELECT * FROM displays ORDER BY hostname').all();
}

/**
 * Get display by ID
 */
function getDisplayById(id) {
    return getDb().prepare('SELECT * FROM displays WHERE id = ?').get(id);
}

/**
 * Register or update display
 */
function upsertDisplay(id, data) {
    const existing = getDisplayById(id);
    const now = new Date().toISOString();

    if (existing) {
        getDb().prepare(`
            UPDATE displays SET
                hostname = COALESCE(?, hostname),
                ip = COALESCE(?, ip),
                external_ip = COALESCE(?, external_ip),
                mac = COALESCE(?, mac),
                current_view = COALESCE(?, current_view),
                status = COALESCE(?, status),
                last_heartbeat = ?,
                system_info_json = COALESCE(?, system_info_json)
            WHERE id = ?
        `).run(
            data.hostname, data.ip, data.external_ip, data.mac,
            data.current_view, data.status, now,
            data.system_info_json ? JSON.stringify(data.system_info_json) : null,
            id
        );
    } else {
        getDb().prepare(`
            INSERT INTO displays (id, hostname, ip, external_ip, mac, current_view, status, last_heartbeat, system_info_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.hostname, data.ip, data.external_ip, data.mac,
            data.current_view, data.status || 'online', now,
            data.system_info_json ? JSON.stringify(data.system_info_json) : null,
            now
        );
    }

    return getDisplayById(id);
}

/**
 * Update display heartbeat
 */
function updateDisplayHeartbeat(id) {
    getDb().prepare(`
        UPDATE displays SET last_heartbeat = CURRENT_TIMESTAMP, status = 'online' WHERE id = ?
    `).run(id);
}

/**
 * Mark stale displays as offline
 */
function markStaleDisplaysOffline(staleMinutes = 5) {
    const cutoff = new Date();
    cutoff.setMinutes(cutoff.getMinutes() - staleMinutes);

    getDb().prepare(`
        UPDATE displays SET status = 'offline'
        WHERE status = 'online' AND last_heartbeat < ?
    `).run(cutoff.toISOString());
}

// =============================================================================
// API TOKEN HELPERS
// =============================================================================

const crypto = require('crypto');

/**
 * Create API token
 */
function createApiToken(deviceName, deviceType = 'streamdeck', permissions = 'full', expiresAt = null) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = getDb().prepare(`
        INSERT INTO api_tokens (token_hash, device_name, device_type, permissions, expires_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash, deviceName, deviceType, permissions, expiresAt);

    return {
        id: result.lastInsertRowid,
        token,  // Only returned on creation
        device_name: deviceName,
        device_type: deviceType,
        permissions
    };
}

/**
 * Verify API token and return token record if valid
 */
function verifyApiToken(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = getDb().prepare(`
        SELECT * FROM api_tokens
        WHERE token_hash = ? AND is_active = 1
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `).get(tokenHash);
    return record || null;
}

/**
 * Update token last used timestamp
 */
function updateTokenLastUsed(tokenId) {
    getDb().prepare(
        'UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(tokenId);
}

/**
 * List all API tokens (without hashes)
 */
function listApiTokens() {
    return getDb().prepare(`
        SELECT id, device_name, device_type, permissions, is_active,
               created_at, last_used_at, expires_at
        FROM api_tokens
        ORDER BY created_at DESC
    `).all();
}

/**
 * Get API token by ID (without hash)
 */
function getApiToken(id) {
    return getDb().prepare(`
        SELECT id, device_name, device_type, permissions, is_active,
               created_at, last_used_at, expires_at
        FROM api_tokens WHERE id = ?
    `).get(id);
}

/**
 * Revoke API token
 */
function revokeApiToken(id) {
    const result = getDb().prepare(
        'UPDATE api_tokens SET is_active = 0 WHERE id = ?'
    ).run(id);
    return result.changes > 0;
}

// =============================================================================
// OAUTH TOKEN HELPERS
// =============================================================================

/**
 * Save OAuth tokens (encrypted)
 */
function saveOAuthTokens(data) {
    const existing = getDb().prepare('SELECT id FROM oauth_tokens WHERE provider = ?').get(data.provider || 'challonge');

    if (existing) {
        getDb().prepare(`
            UPDATE oauth_tokens SET
                access_token_encrypted = ?,
                refresh_token_encrypted = ?,
                expires_at = ?,
                scope = ?,
                iv = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE provider = ?
        `).run(
            data.access_token_encrypted,
            data.refresh_token_encrypted,
            data.expires_at,
            data.scope,
            data.iv,
            data.provider || 'challonge'
        );
    } else {
        getDb().prepare(`
            INSERT INTO oauth_tokens (provider, access_token_encrypted, refresh_token_encrypted, expires_at, scope, iv)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            data.provider || 'challonge',
            data.access_token_encrypted,
            data.refresh_token_encrypted,
            data.expires_at,
            data.scope,
            data.iv
        );
    }
}

/**
 * Get OAuth status (without tokens)
 */
function getOAuthStatus() {
    const record = getDb().prepare(`
        SELECT provider, expires_at, scope, created_at, updated_at
        FROM oauth_tokens WHERE provider = 'challonge'
    `).get();

    if (!record) {
        return { connected: false };
    }

    const isExpired = record.expires_at && new Date(record.expires_at) < new Date();
    return {
        connected: true,
        provider: record.provider,
        expires_at: record.expires_at,
        is_expired: isExpired,
        scope: record.scope,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

/**
 * Get OAuth tokens (encrypted)
 */
function getOAuthTokens() {
    return getDb().prepare('SELECT * FROM oauth_tokens WHERE provider = ?').get('challonge');
}

/**
 * Delete OAuth tokens
 */
function deleteOAuthTokens() {
    getDb().prepare('DELETE FROM oauth_tokens WHERE provider = ?').run('challonge');
}

// =============================================================================
// PUSH SUBSCRIPTION HELPERS
// =============================================================================

/**
 * Save push subscription
 */
function savePushSubscription(userId, endpoint, p256dhKey, authKey, userAgent) {
    const existing = getDb().prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);

    if (existing) {
        getDb().prepare(`
            UPDATE push_subscriptions SET
                user_id = ?, p256dh_key = ?, auth_key = ?, user_agent = ?
            WHERE endpoint = ?
        `).run(userId, p256dhKey, authKey, userAgent, endpoint);
        return existing.id;
    } else {
        const result = getDb().prepare(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, user_agent)
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, endpoint, p256dhKey, authKey, userAgent);
        return result.lastInsertRowid;
    }
}

/**
 * Get push subscription by endpoint
 */
function getPushSubscription(endpoint) {
    return getDb().prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
}

/**
 * Get all push subscriptions for a user
 */
function getPushSubscriptionsByUser(userId) {
    return getDb().prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
}

/**
 * Get all push subscriptions
 */
function getAllPushSubscriptions() {
    return getDb().prepare('SELECT * FROM push_subscriptions').all();
}

/**
 * Update subscription last used (for tracking)
 */
function updateSubscriptionLastUsed(endpoint) {
    // Note: The table doesn't have a last_used column, so this is a no-op
    // Could add column if needed
}

/**
 * Delete push subscription
 */
function deletePushSubscription(endpoint) {
    const result = getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    return result.changes > 0;
}

/**
 * Delete all push subscriptions for a user
 */
function deleteUserPushSubscriptions(userId) {
    const result = getDb().prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    return result.changes;
}

/**
 * Get notification preferences for user
 */
function getNotificationPreferences(userId) {
    return getDb().prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId);
}

/**
 * Save notification preferences
 */
function saveNotificationPreferences(userId, prefs) {
    const existing = getNotificationPreferences(userId);

    if (existing) {
        getDb().prepare(`
            UPDATE notification_preferences SET
                match_completed = ?, tournament_started = ?, new_signup = ?,
                display_disconnected = ?, dq_timer_expired = ?, sound_enabled = ?
            WHERE user_id = ?
        `).run(
            prefs.match_completed ? 1 : 0,
            prefs.tournament_started ? 1 : 0,
            prefs.new_signup ? 1 : 0,
            prefs.display_disconnected ? 1 : 0,
            prefs.dq_timer_expired ? 1 : 0,
            prefs.sound_enabled ? 1 : 0,
            userId
        );
    } else {
        getDb().prepare(`
            INSERT INTO notification_preferences
            (user_id, match_completed, tournament_started, new_signup, display_disconnected, dq_timer_expired, sound_enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId,
            prefs.match_completed ? 1 : 0,
            prefs.tournament_started ? 1 : 0,
            prefs.new_signup ? 1 : 0,
            prefs.display_disconnected ? 1 : 0,
            prefs.dq_timer_expired ? 1 : 0,
            prefs.sound_enabled ? 1 : 0
        );
    }
}

// =============================================================================
// SPONSOR IMPRESSION HELPERS
// =============================================================================

/**
 * Record sponsor impression start (when sponsor is shown)
 * Returns the impression ID for later end tracking
 */
function startSponsorImpression(data) {
    const result = getDb().prepare(`
        INSERT INTO sponsor_impressions
        (sponsor_id, display_id, display_type, tournament_id, position, display_start, viewer_estimate)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `).run(
        data.sponsorId,
        data.displayId || null,
        data.displayType || null,
        data.tournamentId || null,
        data.position || null,
        data.viewerEstimate || 0
    );
    return result.lastInsertRowid;
}

/**
 * Record sponsor impression end (when sponsor is hidden)
 */
function endSponsorImpression(impressionId) {
    getDb().prepare(`
        UPDATE sponsor_impressions
        SET display_end = CURRENT_TIMESTAMP,
            duration_seconds = CAST((julianday(CURRENT_TIMESTAMP) - julianday(display_start)) * 86400 AS INTEGER)
        WHERE id = ? AND display_end IS NULL
    `).run(impressionId);
}

/**
 * Record a complete impression (start and end together)
 */
function recordSponsorImpression(data) {
    const durationSeconds = data.durationSeconds || 0;
    const viewerMinutes = Math.round((durationSeconds * (data.viewerEstimate || 0)) / 60);

    // Insert raw impression
    const result = getDb().prepare(`
        INSERT INTO sponsor_impressions
        (sponsor_id, display_id, display_type, tournament_id, position, display_start, display_end, duration_seconds, viewer_estimate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        data.sponsorId,
        data.displayId || null,
        data.displayType || null,
        data.tournamentId || null,
        data.position || null,
        data.displayStart || new Date().toISOString(),
        data.displayEnd || new Date().toISOString(),
        durationSeconds,
        data.viewerEstimate || 0
    );

    // Update daily stats aggregate
    const today = new Date().toISOString().split('T')[0];
    getDb().prepare(`
        INSERT INTO sponsor_impression_stats
        (sponsor_id, stat_date, total_impressions, total_duration_seconds, total_viewer_minutes, display_match_count, display_bracket_count, tournaments_count)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(sponsor_id, stat_date) DO UPDATE SET
            total_impressions = total_impressions + 1,
            total_duration_seconds = total_duration_seconds + excluded.total_duration_seconds,
            total_viewer_minutes = total_viewer_minutes + excluded.total_viewer_minutes,
            display_match_count = display_match_count + excluded.display_match_count,
            display_bracket_count = display_bracket_count + excluded.display_bracket_count,
            tournaments_count = CASE
                WHEN excluded.tournaments_count > 0 THEN tournaments_count + 1
                ELSE tournaments_count
            END
    `).run(
        data.sponsorId,
        today,
        durationSeconds,
        viewerMinutes,
        data.displayType === 'match' ? 1 : 0,
        data.displayType === 'bracket' ? 1 : 0,
        data.tournamentId ? 1 : 0
    );

    return result.lastInsertRowid;
}

/**
 * Get impression statistics for a sponsor
 */
function getSponsorImpressionStats(sponsorId, options = {}) {
    const { startDate, endDate, limit = 30 } = options;

    let sql = `
        SELECT
            stat_date,
            total_impressions,
            total_duration_seconds,
            total_viewer_minutes,
            display_match_count,
            display_bracket_count,
            tournaments_count
        FROM sponsor_impression_stats
        WHERE sponsor_id = ?
    `;
    const params = [sponsorId];

    if (startDate) {
        sql += ' AND stat_date >= ?';
        params.push(startDate);
    }
    if (endDate) {
        sql += ' AND stat_date <= ?';
        params.push(endDate);
    }

    sql += ' ORDER BY stat_date DESC LIMIT ?';
    params.push(limit);

    return getDb().prepare(sql).all(...params);
}

/**
 * Get all-time impression totals for a sponsor
 */
function getSponsorImpressionTotals(sponsorId) {
    return getDb().prepare(`
        SELECT
            COUNT(*) as total_impressions,
            SUM(duration_seconds) as total_duration_seconds,
            SUM(CAST((duration_seconds * viewer_estimate / 60.0) AS INTEGER)) as total_viewer_minutes,
            SUM(CASE WHEN display_type = 'match' THEN 1 ELSE 0 END) as match_impressions,
            SUM(CASE WHEN display_type = 'bracket' THEN 1 ELSE 0 END) as bracket_impressions,
            COUNT(DISTINCT tournament_id) as unique_tournaments,
            MIN(display_start) as first_impression,
            MAX(display_start) as last_impression
        FROM sponsor_impressions
        WHERE sponsor_id = ?
    `).get(sponsorId);
}

/**
 * Get impression stats for all sponsors (overview)
 */
function getAllSponsorImpressionStats(options = {}) {
    const { startDate, endDate } = options;

    let sql = `
        SELECT
            s.id as sponsor_id,
            s.name as sponsor_name,
            s.filename,
            s.position,
            s.active,
            COALESCE(SUM(si.total_impressions), 0) as total_impressions,
            COALESCE(SUM(si.total_duration_seconds), 0) as total_duration_seconds,
            COALESCE(SUM(si.total_viewer_minutes), 0) as total_viewer_minutes
        FROM sponsors s
        LEFT JOIN sponsor_impression_stats si ON s.id = si.sponsor_id
    `;
    const params = [];

    if (startDate || endDate) {
        sql += ' AND 1=1';
        if (startDate) {
            sql += ' AND si.stat_date >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND si.stat_date <= ?';
            params.push(endDate);
        }
    }

    sql += ' GROUP BY s.id ORDER BY total_impressions DESC';

    return getDb().prepare(sql).all(...params);
}

/**
 * Get raw impressions (for detailed reports)
 */
function getSponsorImpressions(sponsorId, options = {}) {
    const { startDate, endDate, limit = 100, offset = 0 } = options;

    let sql = `
        SELECT
            si.*,
            d.hostname as display_hostname
        FROM sponsor_impressions si
        LEFT JOIN displays d ON si.display_id = d.id
        WHERE si.sponsor_id = ?
    `;
    const params = [sponsorId];

    if (startDate) {
        sql += ' AND si.display_start >= ?';
        params.push(startDate);
    }
    if (endDate) {
        sql += ' AND si.display_start <= ?';
        params.push(endDate);
    }

    sql += ' ORDER BY si.display_start DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return getDb().prepare(sql).all(...params);
}

/**
 * Clean up old impressions (data retention)
 */
function cleanupOldImpressions(daysToKeep = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffStr = cutoffDate.toISOString();

    const result = getDb().prepare(`
        DELETE FROM sponsor_impressions
        WHERE display_start < ?
    `).run(cutoffStr);

    return result.changes;
}

// =============================================================================
// DISCORD SETTINGS HELPERS
// =============================================================================

/**
 * Get Discord settings for a user
 * @param {number} userId - User ID
 * @returns {Object|null} Discord settings or null if not configured
 */
function getDiscordSettings(userId) {
    return getDb().prepare('SELECT * FROM discord_settings WHERE user_id = ?').get(userId);
}

/**
 * Save Discord settings (create or update)
 * @param {number} userId - User ID
 * @param {Object} data - Settings data to save
 * @returns {Object} Updated settings
 */
function saveDiscordSettings(userId, data) {
    const existing = getDiscordSettings(userId);
    const now = new Date().toISOString();

    if (existing) {
        // Build dynamic update query
        const updates = [];
        const params = [];

        const allowedFields = [
            'integration_type', 'webhook_url_encrypted', 'webhook_iv',
            'bot_token_encrypted', 'bot_token_iv', 'channel_id', 'guild_id',
            'notify_tournament_start', 'notify_tournament_complete',
            'notify_match_complete', 'notify_participant_signup',
            'notify_participant_checkin', 'notify_dq_timer',
            'mention_role_id', 'embed_color', 'include_bracket_link',
            'is_enabled', 'last_test_at', 'last_error'
        ];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updates.push(`${field} = ?`);
                params.push(data[field]);
            }
        }

        if (updates.length > 0) {
            updates.push('updated_at = ?');
            params.push(now);
            params.push(userId);

            getDb().prepare(`
                UPDATE discord_settings SET ${updates.join(', ')} WHERE user_id = ?
            `).run(...params);
        }
    } else {
        // Insert new record with defaults
        const fields = ['user_id'];
        const values = [userId];
        const placeholders = ['?'];

        const allowedFields = [
            'integration_type', 'webhook_url_encrypted', 'webhook_iv',
            'bot_token_encrypted', 'bot_token_iv', 'channel_id', 'guild_id',
            'notify_tournament_start', 'notify_tournament_complete',
            'notify_match_complete', 'notify_participant_signup',
            'notify_participant_checkin', 'notify_dq_timer',
            'mention_role_id', 'embed_color', 'include_bracket_link',
            'is_enabled', 'last_test_at', 'last_error'
        ];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                fields.push(field);
                values.push(data[field]);
                placeholders.push('?');
            }
        }

        fields.push('created_at', 'updated_at');
        values.push(now, now);
        placeholders.push('?', '?');

        getDb().prepare(`
            INSERT INTO discord_settings (${fields.join(', ')})
            VALUES (${placeholders.join(', ')})
        `).run(...values);
    }

    return getDiscordSettings(userId);
}

/**
 * Delete Discord settings for a user
 * @param {number} userId - User ID
 * @returns {boolean} True if deleted, false if not found
 */
function deleteDiscordSettings(userId) {
    const result = getDb().prepare('DELETE FROM discord_settings WHERE user_id = ?').run(userId);
    return result.changes > 0;
}

/**
 * Get all users with Discord notifications enabled
 * @returns {Array} Array of Discord settings with user info
 */
function getEnabledDiscordUsers() {
    return getDb().prepare(`
        SELECT ds.*, u.username
        FROM discord_settings ds
        JOIN users u ON ds.user_id = u.id
        WHERE ds.is_enabled = 1
    `).all();
}

// =============================================================================
// PHASE 2: METRICS HELPERS
// =============================================================================

/**
 * Record a metric value
 * @param {string} metricType - Type of metric (api_latency, memory, cpu, etc.)
 * @param {string} metricName - Name of the specific metric
 * @param {number} value - The metric value
 */
function recordMetric(metricType, metricName, value) {
    getDb().prepare(`
        INSERT INTO metrics_history (metric_type, metric_name, value)
        VALUES (?, ?, ?)
    `).run(metricType, metricName, value);
}

/**
 * Get metrics history for a specific type
 * @param {string} metricType - Type of metric
 * @param {Object} options - Query options
 * @returns {Array} Metric records
 */
function getMetricsHistory(metricType, options = {}) {
    const { hours = 24, metricName = null, limit = 1000 } = options;
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    let sql = `
        SELECT metric_type, metric_name, value, timestamp
        FROM metrics_history
        WHERE metric_type = ? AND timestamp >= ?
    `;
    const params = [metricType, cutoff.toISOString()];

    if (metricName) {
        sql += ' AND metric_name = ?';
        params.push(metricName);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    return getDb().prepare(sql).all(...params);
}

/**
 * Get latest metric values grouped by name
 * @param {string} metricType - Type of metric
 * @returns {Array} Latest values per metric name
 */
function getLatestMetrics(metricType) {
    return getDb().prepare(`
        SELECT metric_name, value, timestamp
        FROM metrics_history m1
        WHERE metric_type = ?
        AND timestamp = (
            SELECT MAX(timestamp)
            FROM metrics_history m2
            WHERE m2.metric_type = m1.metric_type
            AND m2.metric_name = m1.metric_name
        )
    `).all(metricType);
}

/**
 * Clean up old metrics
 * @param {number} daysToKeep - Days to retain
 * @returns {number} Number of deleted records
 */
function cleanupOldMetrics(daysToKeep = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    const result = getDb().prepare(`
        DELETE FROM metrics_history WHERE timestamp < ?
    `).run(cutoff.toISOString());

    return result.changes;
}

// =============================================================================
// PHASE 2: ALERT HELPERS
// =============================================================================

/**
 * Get all alert thresholds
 * @returns {Array} Alert threshold records
 */
function getAlertThresholds() {
    return getDb().prepare('SELECT * FROM alert_thresholds ORDER BY metric_type').all();
}

/**
 * Update an alert threshold
 * @param {string} metricType - Metric type
 * @param {Object} data - Threshold data
 */
function updateAlertThreshold(metricType, data) {
    const { warningThreshold, criticalThreshold, enabled } = data;
    getDb().prepare(`
        UPDATE alert_thresholds SET
            warning_threshold = COALESCE(?, warning_threshold),
            critical_threshold = COALESCE(?, critical_threshold),
            enabled = COALESCE(?, enabled),
            updated_at = CURRENT_TIMESTAMP
        WHERE metric_type = ?
    `).run(warningThreshold, criticalThreshold, enabled, metricType);
}

/**
 * Create an alert
 * @param {Object} data - Alert data
 * @returns {number} Alert ID
 */
function createAlert(data) {
    const { metricType, metricName, severity, message, value } = data;
    const result = getDb().prepare(`
        INSERT INTO alert_history (metric_type, metric_name, severity, message, value)
        VALUES (?, ?, ?, ?, ?)
    `).run(metricType, metricName || null, severity, message, value);
    return result.lastInsertRowid;
}

/**
 * Get active (unacknowledged) alerts
 * @returns {Array} Active alerts
 */
function getActiveAlerts() {
    return getDb().prepare(`
        SELECT * FROM alert_history
        WHERE acknowledged = 0
        ORDER BY created_at DESC
    `).all();
}

/**
 * Acknowledge an alert
 * @param {number} alertId - Alert ID
 * @param {number} userId - User acknowledging
 */
function acknowledgeAlert(alertId, userId) {
    getDb().prepare(`
        UPDATE alert_history SET
            acknowledged = 1,
            acknowledged_by = ?,
            acknowledged_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(userId, alertId);
}

/**
 * Get alert history
 * @param {Object} options - Query options
 * @returns {Array} Alert records
 */
function getAlertHistory(options = {}) {
    const { limit = 100, offset = 0, severity = null, acknowledged = null } = options;

    let sql = 'SELECT * FROM alert_history WHERE 1=1';
    const params = [];

    if (severity) {
        sql += ' AND severity = ?';
        params.push(severity);
    }
    if (acknowledged !== null) {
        sql += ' AND acknowledged = ?';
        params.push(acknowledged ? 1 : 0);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return getDb().prepare(sql).all(...params);
}

// =============================================================================
// PHASE 2: DISPLAY COMMAND HELPERS
// =============================================================================

/**
 * Record a display command
 * @param {Object} data - Command data
 * @returns {number} Command ID
 */
function recordDisplayCommand(data) {
    const { displayId, userId, command, issuedBy } = data;
    const result = getDb().prepare(`
        INSERT INTO display_commands (display_id, user_id, command, issued_by)
        VALUES (?, ?, ?, ?)
    `).run(displayId, userId || null, command, issuedBy);
    return result.lastInsertRowid;
}

/**
 * Get display commands
 * @param {Object} options - Query options
 * @returns {Array} Command records
 */
function getDisplayCommands(options = {}) {
    const { displayId = null, limit = 100, offset = 0 } = options;

    let sql = `
        SELECT dc.*, u.username as issued_by_username
        FROM display_commands dc
        LEFT JOIN users u ON dc.issued_by = u.id
        WHERE 1=1
    `;
    const params = [];

    if (displayId) {
        sql += ' AND dc.display_id = ?';
        params.push(displayId);
    }

    sql += ' ORDER BY dc.issued_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return getDb().prepare(sql).all(...params);
}

/**
 * Update display command status
 * @param {number} commandId - Command ID
 * @param {string} status - New status
 * @param {string} errorMessage - Error message if failed
 */
function updateDisplayCommandStatus(commandId, status, errorMessage = null) {
    getDb().prepare(`
        UPDATE display_commands SET
            status = ?,
            executed_at = CASE WHEN ? IN ('executed', 'failed') THEN CURRENT_TIMESTAMP ELSE executed_at END,
            error_message = ?
        WHERE id = ?
    `).run(status, status, errorMessage, commandId);
}

/**
 * Get pending display commands for a specific display
 * @param {string} displayId - Display ID
 * @returns {Array} Pending commands
 */
function getPendingDisplayCommands(displayId) {
    return getDb().prepare(`
        SELECT * FROM display_commands
        WHERE display_id = ? AND status = 'pending'
        ORDER BY issued_at ASC
    `).all(displayId);
}

// =============================================================================
// PHASE 2: BACKUP SCHEDULE HELPERS
// =============================================================================

/**
 * Get all backup schedules
 * @returns {Array} Schedule records
 */
function getBackupSchedules() {
    return getDb().prepare(`
        SELECT bs.*, u.username as created_by_username
        FROM backup_schedules bs
        LEFT JOIN users u ON bs.created_by = u.id
        ORDER BY bs.name
    `).all();
}

/**
 * Get backup schedule by ID
 * @param {number} id - Schedule ID
 * @returns {Object|null} Schedule record
 */
function getBackupScheduleById(id) {
    return getDb().prepare(`
        SELECT bs.*, u.username as created_by_username
        FROM backup_schedules bs
        LEFT JOIN users u ON bs.created_by = u.id
        WHERE bs.id = ?
    `).get(id);
}

/**
 * Create a backup schedule
 * @param {Object} data - Schedule data
 * @returns {Object} Created schedule
 */
function createBackupSchedule(data) {
    const { name, database, cronExpression, retentionDays, enabled, nextRun, createdBy } = data;
    const result = getDb().prepare(`
        INSERT INTO backup_schedules (name, database, cron_expression, retention_days, enabled, next_run, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, database, cronExpression, retentionDays || 7, enabled !== false ? 1 : 0, nextRun || null, createdBy);
    return getBackupScheduleById(result.lastInsertRowid);
}

/**
 * Update a backup schedule
 * @param {number} id - Schedule ID
 * @param {Object} data - Fields to update
 * @returns {Object} Updated schedule
 */
function updateBackupSchedule(id, data) {
    const updates = [];
    const params = [];

    if (data.name !== undefined) {
        updates.push('name = ?');
        params.push(data.name);
    }
    if (data.database !== undefined) {
        updates.push('database = ?');
        params.push(data.database);
    }
    if (data.cronExpression !== undefined) {
        updates.push('cron_expression = ?');
        params.push(data.cronExpression);
    }
    if (data.retentionDays !== undefined) {
        updates.push('retention_days = ?');
        params.push(data.retentionDays);
    }
    if (data.enabled !== undefined) {
        updates.push('enabled = ?');
        params.push(data.enabled ? 1 : 0);
    }
    if (data.nextRun !== undefined) {
        updates.push('next_run = ?');
        params.push(data.nextRun);
    }

    if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);
        getDb().prepare(`UPDATE backup_schedules SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    return getBackupScheduleById(id);
}

/**
 * Delete a backup schedule
 * @param {number} id - Schedule ID
 * @returns {boolean} True if deleted
 */
function deleteBackupSchedule(id) {
    const result = getDb().prepare('DELETE FROM backup_schedules WHERE id = ?').run(id);
    return result.changes > 0;
}

/**
 * Update schedule last run info
 * @param {number} id - Schedule ID
 * @param {string} status - 'success' or 'failed'
 * @param {string} nextRun - Next run datetime
 */
function updateScheduleLastRun(id, status, nextRun) {
    getDb().prepare(`
        UPDATE backup_schedules SET
            last_run = CURRENT_TIMESTAMP,
            last_status = ?,
            next_run = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(status, nextRun, id);
}

// =============================================================================
// PHASE 2: BACKUP HISTORY HELPERS
// =============================================================================

/**
 * Record backup start
 * @param {Object} data - Backup info
 * @returns {number} Backup history ID
 */
function recordBackupStart(data) {
    const { scheduleId, filename, database, createdBy } = data;
    const result = getDb().prepare(`
        INSERT INTO backup_history (schedule_id, filename, database, status, created_by)
        VALUES (?, ?, ?, 'in_progress', ?)
    `).run(scheduleId || null, filename, database, createdBy || null);
    return result.lastInsertRowid;
}

/**
 * Record backup completion
 * @param {number} id - Backup history ID
 * @param {string} status - 'success' or 'failed'
 * @param {number} sizeBytes - File size in bytes
 * @param {string} errorMessage - Error message if failed
 */
function recordBackupComplete(id, status, sizeBytes = null, errorMessage = null) {
    getDb().prepare(`
        UPDATE backup_history SET
            status = ?,
            size_bytes = ?,
            error_message = ?,
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(status, sizeBytes, errorMessage, id);
}

/**
 * Get backup history
 * @param {Object} options - Query options
 * @returns {Array} Backup history records
 */
function getBackupHistory(options = {}) {
    const { scheduleId = null, limit = 100, offset = 0 } = options;

    let sql = `
        SELECT bh.*, bs.name as schedule_name, u.username as created_by_username
        FROM backup_history bh
        LEFT JOIN backup_schedules bs ON bh.schedule_id = bs.id
        LEFT JOIN users u ON bh.created_by = u.id
        WHERE 1=1
    `;
    const params = [];

    if (scheduleId) {
        sql += ' AND bh.schedule_id = ?';
        params.push(scheduleId);
    }

    sql += ' ORDER BY bh.started_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return getDb().prepare(sql).all(...params);
}

/**
 * Clean up old backup records (not files, just DB records)
 * @param {number} daysToKeep - Days to retain records
 * @returns {number} Number of deleted records
 */
function cleanupOldBackupRecords(daysToKeep = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    const result = getDb().prepare(`
        DELETE FROM backup_history WHERE started_at < ?
    `).run(cutoff.toISOString());

    return result.changes;
}

// =============================================================================
// FLYER MEDIA SETTINGS HELPERS
// =============================================================================

/**
 * Get flyer media settings for a user
 * @param {number} userId - User ID
 * @returns {Object|null} Media settings or null if not configured
 */
function getFlyerMediaSettings(userId) {
    const row = getDb().prepare('SELECT * FROM flyer_media_settings WHERE user_id = ?').get(userId);
    if (!row) return null;

    // Parse JSON fields
    return {
        ...row,
        playlistItems: row.playlist_items_json ? JSON.parse(row.playlist_items_json) : []
    };
}

/**
 * Get or create flyer media settings for a user
 * @param {number} userId - User ID
 * @returns {Object} Media settings (creates default if not exists)
 */
function getOrCreateFlyerMediaSettings(userId) {
    let settings = getFlyerMediaSettings(userId);
    if (!settings) {
        getDb().prepare(`
            INSERT INTO flyer_media_settings (user_id) VALUES (?)
        `).run(userId);
        settings = getFlyerMediaSettings(userId);
    }
    return settings;
}

/**
 * Save flyer media settings (create or update)
 * @param {number} userId - User ID
 * @param {Object} data - Settings data to save
 * @returns {Object} Updated settings
 */
function saveFlyerMediaSettings(userId, data) {
    const existing = getFlyerMediaSettings(userId);
    const now = new Date().toISOString();

    // Prepare playlist items JSON
    const playlistItemsJson = data.playlistItems !== undefined
        ? JSON.stringify(data.playlistItems)
        : (existing?.playlist_items_json || null);

    if (existing) {
        // Build dynamic update query
        const updates = [];
        const params = [];

        const fieldMappings = {
            loopEnabled: 'loop_enabled',
            autoplayEnabled: 'autoplay_enabled',
            defaultMuted: 'default_muted',
            defaultVolume: 'default_volume',
            playlistEnabled: 'playlist_enabled',
            playlistLoop: 'playlist_loop',
            playlistAutoAdvance: 'playlist_auto_advance',
            playlistCurrentIndex: 'playlist_current_index',
            currentFlyer: 'current_flyer',
            playbackState: 'playback_state',
            currentTime: 'current_time',
            duration: 'duration',
            isMuted: 'is_muted',
            currentVolume: 'current_volume'
        };

        for (const [camelKey, snakeKey] of Object.entries(fieldMappings)) {
            if (data[camelKey] !== undefined) {
                updates.push(`${snakeKey} = ?`);
                // Convert booleans to integers for SQLite
                const value = typeof data[camelKey] === 'boolean' ? (data[camelKey] ? 1 : 0) : data[camelKey];
                params.push(value);
            }
        }

        // Handle playlist items separately
        if (data.playlistItems !== undefined) {
            updates.push('playlist_items_json = ?');
            params.push(playlistItemsJson);
        }

        if (updates.length > 0) {
            updates.push('updated_at = ?');
            params.push(now);
            params.push(userId);

            getDb().prepare(`
                UPDATE flyer_media_settings SET ${updates.join(', ')} WHERE user_id = ?
            `).run(...params);
        }
    } else {
        // Insert new record with provided values
        getDb().prepare(`
            INSERT INTO flyer_media_settings (
                user_id, loop_enabled, autoplay_enabled, default_muted, default_volume,
                playlist_enabled, playlist_loop, playlist_auto_advance, playlist_items_json,
                playlist_current_index, current_flyer, playback_state, current_time, duration,
                is_muted, current_volume, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId,
            data.loopEnabled !== undefined ? (data.loopEnabled ? 1 : 0) : 1,
            data.autoplayEnabled !== undefined ? (data.autoplayEnabled ? 1 : 0) : 1,
            data.defaultMuted !== undefined ? (data.defaultMuted ? 1 : 0) : 1,
            data.defaultVolume !== undefined ? data.defaultVolume : 100,
            data.playlistEnabled !== undefined ? (data.playlistEnabled ? 1 : 0) : 0,
            data.playlistLoop !== undefined ? (data.playlistLoop ? 1 : 0) : 1,
            data.playlistAutoAdvance !== undefined ? (data.playlistAutoAdvance ? 1 : 0) : 1,
            playlistItemsJson,
            data.playlistCurrentIndex || 0,
            data.currentFlyer || null,
            data.playbackState || 'stopped',
            data.currentTime || 0,
            data.duration || 0,
            data.isMuted !== undefined ? (data.isMuted ? 1 : 0) : 1,
            data.currentVolume !== undefined ? data.currentVolume : 100,
            now
        );
    }

    return getFlyerMediaSettings(userId);
}

/**
 * Update flyer playback state (lightweight update for real-time status)
 * @param {number} userId - User ID
 * @param {Object} state - Playback state { playbackState, currentTime, duration, currentFlyer, isMuted, currentVolume }
 */
function updateFlyerPlaybackState(userId, state) {
    const updates = [];
    const params = [];

    if (state.playbackState !== undefined) {
        updates.push('playback_state = ?');
        params.push(state.playbackState);
    }
    if (state.currentTime !== undefined) {
        updates.push('current_time = ?');
        params.push(state.currentTime);
    }
    if (state.duration !== undefined) {
        updates.push('duration = ?');
        params.push(state.duration);
    }
    if (state.currentFlyer !== undefined) {
        updates.push('current_flyer = ?');
        params.push(state.currentFlyer);
    }
    if (state.isMuted !== undefined) {
        updates.push('is_muted = ?');
        params.push(state.isMuted ? 1 : 0);
    }
    if (state.currentVolume !== undefined) {
        updates.push('current_volume = ?');
        params.push(state.currentVolume);
    }
    if (state.playlistCurrentIndex !== undefined) {
        updates.push('playlist_current_index = ?');
        params.push(state.playlistCurrentIndex);
    }

    if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(userId);

        // Use INSERT OR REPLACE pattern to handle non-existent rows
        const existing = getDb().prepare('SELECT id FROM flyer_media_settings WHERE user_id = ?').get(userId);
        if (existing) {
            getDb().prepare(`
                UPDATE flyer_media_settings SET ${updates.join(', ')} WHERE user_id = ?
            `).run(...params);
        } else {
            // Create with defaults then update
            getDb().prepare('INSERT INTO flyer_media_settings (user_id) VALUES (?)').run(userId);
            getDb().prepare(`
                UPDATE flyer_media_settings SET ${updates.join(', ')} WHERE user_id = ?
            `).run(...params);
        }
    }
}

/**
 * Delete flyer media settings for a user
 * @param {number} userId - User ID
 * @returns {boolean} True if deleted
 */
function deleteFlyerMediaSettings(userId) {
    const result = getDb().prepare('DELETE FROM flyer_media_settings WHERE user_id = ?').run(userId);
    return result.changes > 0;
}

module.exports = {
    // Core functions
    initDatabase,
    getDb,
    closeDatabase,
    getDbPath,
    DB_PATH,

    // Games (Multi-Tenant)
    getAllGames,
    getAllGamesForUser,
    getGameById,
    getGameByKey,
    getGameByName,
    createGame,
    updateGame,
    deleteGame,
    ensureGame,
    getDefaultPrizes,
    createDefaultGameForUser,

    // Settings
    getSetting,
    setSetting,
    getAllSettings,

    // Users
    getUserByUsername,
    getUserById,
    createUser,
    updateUserPassword,
    getAllUsers,

    // Active Tournament
    getManualActiveTournamentId,
    setManualActiveTournamentId,
    clearManualActiveTournament,
    isManualActiveTournamentMode,

    // Auth tracking
    getAuthTracking,
    recordFailedAttempt,
    recordSuccessfulLogin,
    isUserLocked,

    // Displays
    getAllDisplays,
    getDisplayById,
    upsertDisplay,
    updateDisplayHeartbeat,
    markStaleDisplaysOffline,

    // API Tokens
    createApiToken,
    verifyApiToken,
    updateTokenLastUsed,
    listApiTokens,
    getApiToken,
    revokeApiToken,

    // OAuth
    saveOAuthTokens,
    getOAuthStatus,
    getOAuthTokens,
    deleteOAuthTokens,

    // Push Subscriptions
    savePushSubscription,
    getPushSubscription,
    getPushSubscriptionsByUser,
    getAllPushSubscriptions,
    updateSubscriptionLastUsed,
    deletePushSubscription,
    deleteUserPushSubscriptions,
    getNotificationPreferences,
    saveNotificationPreferences,

    // Sponsor Impressions
    startSponsorImpression,
    endSponsorImpression,
    recordSponsorImpression,
    getSponsorImpressionStats,
    getSponsorImpressionTotals,
    getAllSponsorImpressionStats,
    getSponsorImpressions,
    cleanupOldImpressions,

    // Discord Settings
    getDiscordSettings,
    saveDiscordSettings,
    deleteDiscordSettings,
    getEnabledDiscordUsers,

    // Phase 2: Metrics
    recordMetric,
    getMetricsHistory,
    cleanupOldMetrics,
    getLatestMetrics,

    // Phase 2: Alerts
    getAlertThresholds,
    updateAlertThreshold,
    createAlert,
    getActiveAlerts,
    acknowledgeAlert,
    getAlertHistory,

    // Phase 2: Display Commands
    recordDisplayCommand,
    getDisplayCommands,
    updateDisplayCommandStatus,
    getPendingDisplayCommands,

    // Phase 2: Backup Schedules
    getBackupSchedules,
    getBackupScheduleById,
    createBackupSchedule,
    updateBackupSchedule,
    deleteBackupSchedule,
    updateScheduleLastRun,

    // Phase 2: Backup History
    recordBackupStart,
    recordBackupComplete,
    getBackupHistory,
    cleanupOldBackupRecords,

    // Flyer Media Settings
    getFlyerMediaSettings,
    getOrCreateFlyerMediaSettings,
    saveFlyerMediaSettings,
    updateFlyerPlaybackState,
    deleteFlyerMediaSettings
};
