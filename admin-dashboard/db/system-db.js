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
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'viewer')),
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

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
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
 */
function createUser(username, passwordHash, role = 'user') {
    const result = getDb().prepare(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run(username, passwordHash, role);
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
        'SELECT id, username, role, email, created_at, updated_at FROM users'
    ).all();
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
    getEnabledDiscordUsers
};
