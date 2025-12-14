#!/usr/bin/env node
/**
 * Database Migration Script
 * Migrates data from analytics.db + JSON files to 4-database architecture
 *
 * Source:
 * - analytics.db (single database with all tables)
 * - users.json, system-settings.json, displays.json, game-configs.json, sponsor-state.json
 *
 * Target:
 * - tournaments.db - Live tournament operations
 * - players.db     - Historical analytics & Elo
 * - system.db      - Config, auth, games, displays
 * - cache.db       - Ephemeral caching
 *
 * Usage:
 *   node scripts/migrate-to-multi-db.js [--dry-run] [--force]
 *
 * Options:
 *   --dry-run   Show what would be migrated without making changes
 *   --force     Overwrite existing database files
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Paths
const ADMIN_DIR = path.join(__dirname, '..');
const OLD_DB_PATH = path.join(ADMIN_DIR, 'analytics.db');

// New database paths
const TOURNAMENTS_DB_PATH = path.join(ADMIN_DIR, 'tournaments.db');
const PLAYERS_DB_PATH = path.join(ADMIN_DIR, 'players.db');
const SYSTEM_DB_PATH = path.join(ADMIN_DIR, 'system.db');
const CACHE_DB_PATH = path.join(ADMIN_DIR, 'cache.db');

// JSON config files
const JSON_FILES = {
    users: path.join(ADMIN_DIR, 'users.json'),
    systemSettings: path.join(ADMIN_DIR, 'system-settings.json'),
    displays: path.join(ADMIN_DIR, 'displays.json'),
    gameConfigs: path.join(ADMIN_DIR, 'game-configs.json'),
    sponsorState: path.join(ADMIN_DIR, 'sponsor-state.json')
};

// Parse arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

// Stats
const stats = {
    tournaments: 0,
    participants: 0,
    matches: 0,
    stations: 0,
    standings: 0,
    players: 0,
    playerAliases: 0,
    archivedTournaments: 0,
    archivedParticipants: 0,
    archivedMatches: 0,
    playerRatings: 0,
    ratingHistory: 0,
    games: 0,
    gameConfigs: 0,
    users: 0,
    settings: 0,
    displays: 0,
    sponsors: 0,
    templates: 0,
    oauthTokens: 0,
    apiTokens: 0,
    pushSubscriptions: 0,
    notificationPrefs: 0,
    aiSeedingCache: 0,
    narratives: 0,
    errors: []
};

function log(message, level = 'info') {
    const prefix = {
        info: '[INFO]',
        warn: '[WARN]',
        error: '[ERROR]',
        success: '[OK]',
        dry: '[DRY-RUN]'
    };
    console.log(`${prefix[level] || '[INFO]'} ${message}`);
}

function readJsonFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        log(`Failed to read ${filePath}: ${e.message}`, 'warn');
    }
    return null;
}

function checkPrerequisites() {
    log('Checking prerequisites...');

    // Check source database exists
    if (!fs.existsSync(OLD_DB_PATH)) {
        log(`Source database not found: ${OLD_DB_PATH}`, 'error');
        log('Nothing to migrate. Exiting.', 'info');
        process.exit(0);
    }

    // Check if target databases exist
    const existingDbs = [];
    if (fs.existsSync(TOURNAMENTS_DB_PATH)) existingDbs.push('tournaments.db');
    if (fs.existsSync(PLAYERS_DB_PATH)) existingDbs.push('players.db');
    if (fs.existsSync(SYSTEM_DB_PATH)) existingDbs.push('system.db');
    if (fs.existsSync(CACHE_DB_PATH)) existingDbs.push('cache.db');

    if (existingDbs.length > 0 && !FORCE) {
        log(`Target databases already exist: ${existingDbs.join(', ')}`, 'error');
        log('Use --force to overwrite existing databases', 'info');
        process.exit(1);
    }

    if (existingDbs.length > 0 && FORCE) {
        log(`Will overwrite existing databases: ${existingDbs.join(', ')}`, 'warn');
    }

    log('Prerequisites check passed', 'success');
}

function backupExisting() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.join(ADMIN_DIR, 'backups', `pre-migration-${timestamp}`);

    if (DRY_RUN) {
        log(`Would create backup in: ${backupDir}`, 'dry');
        return;
    }

    fs.mkdirSync(backupDir, { recursive: true });

    // Backup source database
    if (fs.existsSync(OLD_DB_PATH)) {
        fs.copyFileSync(OLD_DB_PATH, path.join(backupDir, 'analytics.db'));
        log(`Backed up analytics.db`, 'success');
    }

    // Backup JSON files
    for (const [name, filePath] of Object.entries(JSON_FILES)) {
        if (fs.existsSync(filePath)) {
            fs.copyFileSync(filePath, path.join(backupDir, path.basename(filePath)));
            log(`Backed up ${path.basename(filePath)}`, 'success');
        }
    }

    log(`Backup created at: ${backupDir}`, 'success');
}

function initializeDatabases() {
    if (DRY_RUN) {
        log('Would initialize new database files', 'dry');
        return {};
    }

    // Remove existing if force mode
    if (FORCE) {
        [TOURNAMENTS_DB_PATH, PLAYERS_DB_PATH, SYSTEM_DB_PATH, CACHE_DB_PATH].forEach(dbPath => {
            if (fs.existsSync(dbPath)) {
                fs.unlinkSync(dbPath);
                // Also remove WAL and SHM files
                if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
                if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
            }
        });
    }

    // Initialize using the new DB modules
    const db = require('../db');
    db.initAll();

    return {
        tournaments: db.tournaments.getDb(),
        players: db.players.getDb(),
        system: db.system.getDb(),
        cache: db.cache.getDb()
    };
}

function migrateGames(sourceDb, targetDb) {
    log('Migrating games...');

    const games = sourceDb.prepare('SELECT * FROM games').all();

    if (DRY_RUN) {
        log(`Would migrate ${games.length} games to system.db`, 'dry');
        stats.games = games.length;
        return new Map();
    }

    const gameIdMap = new Map(); // old_id -> new_id

    const insert = targetDb.prepare(`
        INSERT INTO games (name, short_code, created_at)
        VALUES (?, ?, ?)
    `);

    for (const game of games) {
        try {
            const result = insert.run(game.name, game.short_code, game.created_at);
            gameIdMap.set(game.id, result.lastInsertRowid);
            stats.games++;
        } catch (e) {
            stats.errors.push(`Game ${game.name}: ${e.message}`);
        }
    }

    log(`Migrated ${stats.games} games`, 'success');
    return gameIdMap;
}

function migrateUsers(targetDb) {
    log('Migrating users from JSON...');

    const usersData = readJsonFile(JSON_FILES.users);
    if (!usersData || !usersData.users) {
        log('No users.json found or empty', 'warn');
        return;
    }

    if (DRY_RUN) {
        log(`Would migrate ${usersData.users.length} users to system.db`, 'dry');
        stats.users = usersData.users.length;
        return;
    }

    const insert = targetDb.prepare(`
        INSERT INTO users (username, password_hash, role, created_at)
        VALUES (?, ?, ?, ?)
    `);

    for (const user of usersData.users) {
        try {
            insert.run(
                user.username,
                user.password,
                user.role || 'user',
                user.createdAt || new Date().toISOString()
            );
            stats.users++;
        } catch (e) {
            stats.errors.push(`User ${user.username}: ${e.message}`);
        }
    }

    log(`Migrated ${stats.users} users`, 'success');
}

function migrateSystemSettings(targetDb) {
    log('Migrating system settings from JSON...');

    const settings = readJsonFile(JSON_FILES.systemSettings);
    if (!settings) {
        log('No system-settings.json found', 'warn');
        return;
    }

    if (DRY_RUN) {
        const count = Object.keys(settings).length;
        log(`Would migrate ${count} setting sections to system.db`, 'dry');
        stats.settings = count;
        return;
    }

    const insert = targetDb.prepare(`
        INSERT INTO system_settings (key, value_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
    `);

    for (const [key, value] of Object.entries(settings)) {
        try {
            insert.run(key, JSON.stringify(value));
            stats.settings++;
        } catch (e) {
            stats.errors.push(`Setting ${key}: ${e.message}`);
        }
    }

    log(`Migrated ${stats.settings} settings`, 'success');
}

function migrateDisplays(targetDb) {
    log('Migrating displays from JSON...');

    const displays = readJsonFile(JSON_FILES.displays);
    if (!displays) {
        log('No displays.json found', 'warn');
        return;
    }

    if (DRY_RUN) {
        const count = Object.keys(displays).length;
        log(`Would migrate ${count} displays to system.db`, 'dry');
        stats.displays = count;
        return;
    }

    const insert = targetDb.prepare(`
        INSERT INTO displays (id, hostname, ip, external_ip, mac, current_view, assigned_view, status, last_heartbeat, system_info_json, debug_mode, pending_command_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [id, display] of Object.entries(displays)) {
        try {
            insert.run(
                id,
                display.hostname,
                display.ip,
                display.externalIp,
                display.mac,
                display.currentView,
                display.assignedView,
                display.status || 'offline',
                display.lastHeartbeat,
                display.systemInfo ? JSON.stringify(display.systemInfo) : null,
                display.debugMode ? 1 : 0,
                display.pendingCommand ? JSON.stringify(display.pendingCommand) : null
            );
            stats.displays++;
        } catch (e) {
            stats.errors.push(`Display ${id}: ${e.message}`);
        }
    }

    log(`Migrated ${stats.displays} displays`, 'success');
}

function migrateGameConfigs(targetDb, gameIdMap) {
    log('Migrating game configs from JSON...');

    const configs = readJsonFile(JSON_FILES.gameConfigs);
    if (!configs) {
        log('No game-configs.json found', 'warn');
        return;
    }

    if (DRY_RUN) {
        const count = Object.keys(configs).length;
        log(`Would migrate ${count} game configs to system.db`, 'dry');
        stats.gameConfigs = count;
        return;
    }

    // First ensure games exist
    const ensureGame = targetDb.prepare(`
        INSERT OR IGNORE INTO games (name, short_code) VALUES (?, ?)
    `);

    const getGameId = targetDb.prepare(`SELECT id FROM games WHERE name = ?`);

    const insert = targetDb.prepare(`
        INSERT INTO game_configs (game_id, rules_json, prizes_json, additional_info_json, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(game_id) DO UPDATE SET
            rules_json = excluded.rules_json,
            prizes_json = excluded.prizes_json,
            additional_info_json = excluded.additional_info_json,
            updated_at = CURRENT_TIMESTAMP
    `);

    for (const [key, config] of Object.entries(configs)) {
        try {
            // Ensure game exists
            const gameName = config.name || key;
            ensureGame.run(gameName, config.shortName || null);

            const game = getGameId.get(gameName);
            if (!game) continue;

            insert.run(
                game.id,
                config.rules ? JSON.stringify(config.rules) : null,
                config.prizes ? JSON.stringify(config.prizes) : null,
                config.additionalInfo ? JSON.stringify(config.additionalInfo) : null
            );
            stats.gameConfigs++;
        } catch (e) {
            stats.errors.push(`Game config ${key}: ${e.message}`);
        }
    }

    log(`Migrated ${stats.gameConfigs} game configs`, 'success');
}

function migrateSponsors(targetDb) {
    log('Migrating sponsors from JSON...');

    const sponsorState = readJsonFile(JSON_FILES.sponsorState);
    if (!sponsorState) {
        log('No sponsor-state.json found', 'warn');
        return;
    }

    if (DRY_RUN) {
        const count = sponsorState.sponsors?.length || 0;
        log(`Would migrate ${count} sponsors to system.db`, 'dry');
        stats.sponsors = count;
        return;
    }

    // Migrate sponsor config
    if (sponsorState.config) {
        targetDb.prepare(`
            UPDATE sponsor_config SET
                enabled = ?,
                rotation_interval = ?,
                current_index_json = ?
            WHERE id = 1
        `).run(
            sponsorState.config.enabled ? 1 : 0,
            sponsorState.config.rotationInterval || 30,
            sponsorState.config.currentIndex ? JSON.stringify(sponsorState.config.currentIndex) : null
        );
    }

    // Migrate sponsors
    const insert = targetDb.prepare(`
        INSERT INTO sponsors (id, name, filename, position, type, size, opacity, offset_x, offset_y, active, display_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (sponsorState.sponsors) {
        for (const sponsor of sponsorState.sponsors) {
            try {
                insert.run(
                    sponsor.id,
                    sponsor.name,
                    sponsor.filename,
                    sponsor.position,
                    sponsor.type || 'corner',
                    sponsor.size || 100,
                    sponsor.opacity || 100,
                    sponsor.offsetX || 0,
                    sponsor.offsetY || 0,
                    sponsor.active ? 1 : 0,
                    sponsor.order || 0,
                    sponsor.createdAt || new Date().toISOString()
                );
                stats.sponsors++;
            } catch (e) {
                stats.errors.push(`Sponsor ${sponsor.id}: ${e.message}`);
            }
        }
    }

    log(`Migrated ${stats.sponsors} sponsors`, 'success');
}

function migrateTemplates(sourceDb, targetDb) {
    log('Migrating tournament templates...');

    const templates = sourceDb.prepare('SELECT * FROM tournament_templates').all();

    if (DRY_RUN) {
        log(`Would migrate ${templates.length} templates to system.db`, 'dry');
        stats.templates = templates.length;
        return;
    }

    const insert = targetDb.prepare(`
        INSERT INTO tournament_templates (name, description, game_name, is_default, created_by, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const t of templates) {
        try {
            insert.run(t.name, t.description, t.game_name, t.is_default, t.created_by, t.settings_json, t.created_at, t.updated_at);
            stats.templates++;
        } catch (e) {
            stats.errors.push(`Template ${t.name}: ${e.message}`);
        }
    }

    log(`Migrated ${stats.templates} templates`, 'success');
}

function migrateOAuthTokens(sourceDb, targetDb) {
    log('Migrating OAuth tokens...');

    const tokens = sourceDb.prepare('SELECT * FROM oauth_tokens').all();

    if (DRY_RUN) {
        log(`Would migrate ${tokens.length} OAuth tokens to system.db`, 'dry');
        stats.oauthTokens = tokens.length;
        return;
    }

    const insert = targetDb.prepare(`
        INSERT INTO oauth_tokens (provider, access_token_encrypted, refresh_token_encrypted, expires_at, scope, iv, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const t of tokens) {
        try {
            insert.run(t.provider, t.access_token_encrypted, t.refresh_token_encrypted, t.expires_at, t.scope, t.iv, t.created_at, t.updated_at);
            stats.oauthTokens++;
        } catch (e) {
            stats.errors.push(`OAuth token ${t.provider}: ${e.message}`);
        }
    }

    log(`Migrated ${stats.oauthTokens} OAuth tokens`, 'success');
}

function migrateApiTokens(sourceDb, targetDb) {
    log('Migrating API tokens...');

    const tokens = sourceDb.prepare('SELECT * FROM api_tokens').all();

    if (DRY_RUN) {
        log(`Would migrate ${tokens.length} API tokens to system.db`, 'dry');
        stats.apiTokens = tokens.length;
        return;
    }

    const insert = targetDb.prepare(`
        INSERT INTO api_tokens (token_hash, device_name, device_type, permissions, is_active, created_at, last_used_at, expires_at)
        VALUES (?, ?, ?, ?, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'), datetime(?, 'unixepoch'))
    `);

    for (const t of tokens) {
        try {
            insert.run(t.token_hash, t.device_name, t.device_type, t.permissions, t.is_active, t.created_at, t.last_used_at, t.expires_at);
            stats.apiTokens++;
        } catch (e) {
            stats.errors.push(`API token ${t.device_name}: ${e.message}`);
        }
    }

    log(`Migrated ${stats.apiTokens} API tokens`, 'success');
}

function migratePushSubscriptions(sourceDb, targetDb) {
    log('Migrating push subscriptions...');

    const subs = sourceDb.prepare('SELECT * FROM push_subscriptions').all();

    if (DRY_RUN) {
        log(`Would migrate ${subs.length} push subscriptions to system.db`, 'dry');
        stats.pushSubscriptions = subs.length;
        return;
    }

    const insert = targetDb.prepare(`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const s of subs) {
        try {
            insert.run(s.user_id, s.endpoint, s.p256dh_key, s.auth_key, s.user_agent, s.created_at);
            stats.pushSubscriptions++;
        } catch (e) {
            stats.errors.push(`Push subscription: ${e.message}`);
        }
    }

    log(`Migrated ${stats.pushSubscriptions} push subscriptions`, 'success');
}

function migrateNotificationPrefs(sourceDb, targetDb) {
    log('Migrating notification preferences...');

    const prefs = sourceDb.prepare('SELECT * FROM notification_preferences').all();

    if (DRY_RUN) {
        log(`Would migrate ${prefs.length} notification preferences to system.db`, 'dry');
        stats.notificationPrefs = prefs.length;
        return;
    }

    const insert = targetDb.prepare(`
        INSERT INTO notification_preferences (user_id, match_completed, tournament_started, new_signup, display_disconnected, dq_timer_expired, sound_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of prefs) {
        try {
            insert.run(p.user_id, p.match_completed, p.tournament_started, p.new_signup, p.display_disconnected, p.dq_timer_expired, p.sound_enabled);
            stats.notificationPrefs++;
        } catch (e) {
            stats.errors.push(`Notification pref: ${e.message}`);
        }
    }

    log(`Migrated ${stats.notificationPrefs} notification preferences`, 'success');
}

function migratePlayers(sourceDb, targetDb) {
    log('Migrating players and aliases...');

    const players = sourceDb.prepare('SELECT * FROM players').all();
    const aliases = sourceDb.prepare('SELECT * FROM player_aliases').all();

    if (DRY_RUN) {
        log(`Would migrate ${players.length} players and ${aliases.length} aliases to players.db`, 'dry');
        stats.players = players.length;
        stats.playerAliases = aliases.length;
        return new Map();
    }

    const playerIdMap = new Map();

    const insertPlayer = targetDb.prepare(`
        INSERT INTO players (canonical_name, display_name, email, instagram, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertAlias = targetDb.prepare(`
        INSERT INTO player_aliases (player_id, alias, normalized_alias)
        VALUES (?, ?, ?)
    `);

    for (const p of players) {
        try {
            const result = insertPlayer.run(p.canonical_name, p.display_name, p.email, p.instagram, p.created_at, p.updated_at);
            playerIdMap.set(p.id, result.lastInsertRowid);
            stats.players++;
        } catch (e) {
            stats.errors.push(`Player ${p.display_name}: ${e.message}`);
        }
    }

    for (const a of aliases) {
        try {
            const newPlayerId = playerIdMap.get(a.player_id);
            if (newPlayerId) {
                insertAlias.run(newPlayerId, a.alias, a.normalized_alias);
                stats.playerAliases++;
            }
        } catch (e) {
            stats.errors.push(`Alias ${a.alias}: ${e.message}`);
        }
    }

    log(`Migrated ${stats.players} players and ${stats.playerAliases} aliases`, 'success');
    return playerIdMap;
}

function migrateArchivedTournaments(sourceDb, targetDb, gameIdMap, playerIdMap) {
    log('Migrating archived tournaments...');

    const tournaments = sourceDb.prepare('SELECT * FROM tournaments').all();

    if (DRY_RUN) {
        log(`Would migrate ${tournaments.length} archived tournaments to players.db`, 'dry');
        stats.archivedTournaments = tournaments.length;
        return new Map();
    }

    const tournamentIdMap = new Map();

    const insertTournament = targetDb.prepare(`
        INSERT INTO tournaments (source_id, source_url, name, game_id, tournament_type, participant_count, started_at, completed_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const t of tournaments) {
        try {
            const newGameId = gameIdMap.get(t.game_id) || t.game_id;
            const result = insertTournament.run(
                t.challonge_id,
                t.challonge_url,
                t.name,
                newGameId,
                t.tournament_type,
                t.participant_count,
                t.started_at,
                t.completed_at,
                t.archived_at
            );
            tournamentIdMap.set(t.id, result.lastInsertRowid);
            stats.archivedTournaments++;
        } catch (e) {
            stats.errors.push(`Archived tournament ${t.name}: ${e.message}`);
        }
    }

    // Migrate tournament participants
    const participants = sourceDb.prepare('SELECT * FROM tournament_participants').all();
    const insertParticipant = targetDb.prepare(`
        INSERT INTO tournament_participants (tournament_id, player_id, original_participant_id, seed, final_rank, checked_in)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const p of participants) {
        try {
            const newTournamentId = tournamentIdMap.get(p.tournament_id);
            const newPlayerId = playerIdMap.get(p.player_id);
            if (newTournamentId && newPlayerId) {
                insertParticipant.run(newTournamentId, newPlayerId, p.challonge_participant_id, p.seed, p.final_rank, p.checked_in);
                stats.archivedParticipants++;
            }
        } catch (e) {
            stats.errors.push(`Archived participant: ${e.message}`);
        }
    }

    // Migrate matches
    const matches = sourceDb.prepare('SELECT * FROM matches').all();
    const insertMatch = targetDb.prepare(`
        INSERT INTO matches (tournament_id, original_match_id, round, match_identifier, player1_id, player2_id, winner_id, loser_id, player1_score, player2_score, scores_csv, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const m of matches) {
        try {
            const newTournamentId = tournamentIdMap.get(m.tournament_id);
            if (newTournamentId) {
                insertMatch.run(
                    newTournamentId,
                    m.challonge_match_id,
                    m.round,
                    m.match_identifier,
                    playerIdMap.get(m.player1_id) || null,
                    playerIdMap.get(m.player2_id) || null,
                    playerIdMap.get(m.winner_id) || null,
                    playerIdMap.get(m.loser_id) || null,
                    m.player1_score,
                    m.player2_score,
                    m.scores_csv,
                    m.completed_at
                );
                stats.archivedMatches++;
            }
        } catch (e) {
            stats.errors.push(`Archived match: ${e.message}`);
        }
    }

    log(`Migrated ${stats.archivedTournaments} tournaments, ${stats.archivedParticipants} participants, ${stats.archivedMatches} matches`, 'success');
    return tournamentIdMap;
}

function migratePlayerRatings(sourceDb, targetDb, gameIdMap, playerIdMap, tournamentIdMap) {
    log('Migrating player ratings and history...');

    const ratings = sourceDb.prepare('SELECT * FROM player_ratings').all();
    const history = sourceDb.prepare('SELECT * FROM rating_history').all();

    if (DRY_RUN) {
        log(`Would migrate ${ratings.length} ratings and ${history.length} history entries to players.db`, 'dry');
        stats.playerRatings = ratings.length;
        stats.ratingHistory = history.length;
        return;
    }

    const insertRating = targetDb.prepare(`
        INSERT INTO player_ratings (player_id, game_id, elo_rating, peak_rating, matches_played, wins, losses, last_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const r of ratings) {
        try {
            const newPlayerId = playerIdMap.get(r.player_id);
            const newGameId = gameIdMap.get(r.game_id) || r.game_id;
            if (newPlayerId) {
                insertRating.run(newPlayerId, newGameId, r.elo_rating, r.peak_rating, r.matches_played, r.wins, r.losses, r.last_active);
                stats.playerRatings++;
            }
        } catch (e) {
            stats.errors.push(`Rating: ${e.message}`);
        }
    }

    const insertHistory = targetDb.prepare(`
        INSERT INTO rating_history (player_id, game_id, tournament_id, rating_before, rating_after, rating_change, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const h of history) {
        try {
            const newPlayerId = playerIdMap.get(h.player_id);
            const newGameId = gameIdMap.get(h.game_id) || h.game_id;
            const newTournamentId = tournamentIdMap.get(h.tournament_id);
            if (newPlayerId && newTournamentId) {
                insertHistory.run(newPlayerId, newGameId, newTournamentId, h.rating_before, h.rating_after, h.rating_change, h.recorded_at);
                stats.ratingHistory++;
            }
        } catch (e) {
            stats.errors.push(`Rating history: ${e.message}`);
        }
    }

    log(`Migrated ${stats.playerRatings} ratings and ${stats.ratingHistory} history entries`, 'success');
}

function migrateAISeedingCache(sourceDb, targetDb) {
    log('Migrating AI seeding cache...');

    const cache = sourceDb.prepare('SELECT * FROM ai_seeding_cache').all();

    if (DRY_RUN) {
        log(`Would migrate ${cache.length} AI seeding cache entries to players.db`, 'dry');
        stats.aiSeedingCache = cache.length;
        return;
    }

    const insert = targetDb.prepare(`
        INSERT INTO ai_seeding_cache (tournament_id, tournament_url, game_id, suggestions_json, participant_hash, locked_seeds_json, generation_count, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const c of cache) {
        try {
            insert.run(c.tournament_id, c.tournament_url, c.game_id, c.suggestions_json, c.participant_hash, c.locked_seeds_json, c.generation_count, c.source, c.created_at, c.updated_at);
            stats.aiSeedingCache++;
        } catch (e) {
            stats.errors.push(`AI seeding cache: ${e.message}`);
        }
    }

    log(`Migrated ${stats.aiSeedingCache} AI seeding cache entries`, 'success');
}

function migrateNarratives(sourceDb, targetDb, tournamentIdMap) {
    log('Migrating tournament narratives...');

    const narratives = sourceDb.prepare('SELECT * FROM tournament_narratives').all();

    if (DRY_RUN) {
        log(`Would migrate ${narratives.length} narratives to players.db`, 'dry');
        stats.narratives = narratives.length;
        return;
    }

    const insert = targetDb.prepare(`
        INSERT INTO tournament_narratives (tournament_id, format, narrative, social_post, data_hash, storylines_json, metadata_json, source, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const n of narratives) {
        try {
            const newTournamentId = tournamentIdMap.get(n.tournament_id);
            if (newTournamentId) {
                insert.run(newTournamentId, n.format, n.narrative, n.social_post, n.data_hash, n.storylines_json, n.metadata_json, n.source, n.generated_at);
                stats.narratives++;
            }
        } catch (e) {
            stats.errors.push(`Narrative: ${e.message}`);
        }
    }

    log(`Migrated ${stats.narratives} narratives`, 'success');
}

function migrateLiveTournaments(sourceDb, targetDb, gameIdMap) {
    log('Migrating live tournaments (tcc_* tables)...');

    // Check if tcc tables exist
    const tableCheck = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tcc_tournaments'").get();
    if (!tableCheck) {
        log('No tcc_tournaments table found, skipping live tournaments', 'warn');
        return;
    }

    const tournaments = sourceDb.prepare('SELECT * FROM tcc_tournaments').all();

    if (DRY_RUN) {
        log(`Would migrate ${tournaments.length} live tournaments to tournaments.db`, 'dry');
        stats.tournaments = tournaments.length;
        return;
    }

    const tournamentIdMap = new Map();

    const insertTournament = targetDb.prepare(`
        INSERT INTO tcc_tournaments (
            name, url_slug, description, game_id, tournament_type, state,
            signup_cap, open_signup, check_in_duration, registration_open_at,
            starts_at, started_at, completed_at, created_at, updated_at,
            hold_third_place_match, grand_finals_modifier, swiss_rounds, ranked_by, show_rounds,
            hide_seeds, sequential_pairings, private, format_settings_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const t of tournaments) {
        try {
            const newGameId = gameIdMap.get(t.game_id) || t.game_id;
            const result = insertTournament.run(
                t.name, t.url_slug, t.description, newGameId, t.tournament_type, t.state,
                t.signup_cap, t.open_signup, t.check_in_duration, t.registration_open_at,
                t.starts_at, t.started_at, t.completed_at, t.created_at, t.updated_at,
                t.hold_third_place_match, t.grand_finals_modifier, t.swiss_rounds, t.ranked_by, t.show_rounds,
                t.hide_seeds, t.sequential_pairings, t.private, t.format_settings_json
            );
            tournamentIdMap.set(t.id, result.lastInsertRowid);
            stats.tournaments++;
        } catch (e) {
            stats.errors.push(`Live tournament ${t.name}: ${e.message}`);
        }
    }

    // Migrate participants
    const participants = sourceDb.prepare('SELECT * FROM tcc_participants').all();
    const insertParticipant = targetDb.prepare(`
        INSERT INTO tcc_participants (
            tournament_id, player_id, name, display_name, email, seed,
            active, checked_in, checked_in_at, on_waiting_list,
            final_rank, group_id, group_seed, misc, instagram, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const participantIdMap = new Map();

    for (const p of participants) {
        try {
            const newTournamentId = tournamentIdMap.get(p.tournament_id);
            if (newTournamentId) {
                const result = insertParticipant.run(
                    newTournamentId, p.player_id, p.name, p.display_name, p.email, p.seed,
                    p.active, p.checked_in, p.checked_in_at, p.on_waiting_list,
                    p.final_rank, p.group_id, p.group_seed, p.misc, p.instagram, p.created_at, p.updated_at
                );
                participantIdMap.set(p.id, result.lastInsertRowid);
                stats.participants++;
            }
        } catch (e) {
            stats.errors.push(`Participant ${p.name}: ${e.message}`);
        }
    }

    // Migrate stations
    const stations = sourceDb.prepare('SELECT * FROM tcc_stations').all();
    const stationIdMap = new Map();
    const insertStation = targetDb.prepare(`
        INSERT INTO tcc_stations (tournament_id, name, active, current_match_id, created_at)
        VALUES (?, ?, ?, ?, ?)
    `);

    for (const s of stations) {
        try {
            const newTournamentId = tournamentIdMap.get(s.tournament_id);
            if (newTournamentId) {
                const result = insertStation.run(newTournamentId, s.name, s.active, null, s.created_at);
                stationIdMap.set(s.id, result.lastInsertRowid);
                stats.stations++;
            }
        } catch (e) {
            stats.errors.push(`Station ${s.name}: ${e.message}`);
        }
    }

    // Migrate matches
    const matches = sourceDb.prepare('SELECT * FROM tcc_matches').all();
    const matchIdMap = new Map();
    const insertMatch = targetDb.prepare(`
        INSERT INTO tcc_matches (
            tournament_id, identifier, round, suggested_play_order, bracket_position, losers_bracket,
            player1_id, player2_id, player1_prereq_match_id, player2_prereq_match_id,
            player1_is_prereq_loser, player2_is_prereq_loser, state,
            winner_id, loser_id, player1_score, player2_score, scores_csv,
            forfeited, forfeited_participant_id, station_id,
            underway_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // First pass: insert without prereq references
    for (const m of matches) {
        try {
            const newTournamentId = tournamentIdMap.get(m.tournament_id);
            const newPlayer1Id = participantIdMap.get(m.player1_id) || null;
            const newPlayer2Id = participantIdMap.get(m.player2_id) || null;
            const newWinnerId = participantIdMap.get(m.winner_id) || null;
            const newLoserId = participantIdMap.get(m.loser_id) || null;
            const newStationId = stationIdMap.get(m.station_id) || null;
            const newForfeitedId = participantIdMap.get(m.forfeited_participant_id) || null;

            if (newTournamentId) {
                const result = insertMatch.run(
                    newTournamentId, m.identifier, m.round, m.suggested_play_order, m.bracket_position, m.losers_bracket,
                    newPlayer1Id, newPlayer2Id, null, null,  // prereqs set in second pass
                    m.player1_is_prereq_loser, m.player2_is_prereq_loser, m.state,
                    newWinnerId, newLoserId, m.player1_score, m.player2_score, m.scores_csv,
                    m.forfeited, newForfeitedId, newStationId,
                    m.underway_at, m.completed_at, m.created_at, m.updated_at
                );
                matchIdMap.set(m.id, result.lastInsertRowid);
                stats.matches++;
            }
        } catch (e) {
            stats.errors.push(`Match ${m.identifier}: ${e.message}`);
        }
    }

    // Second pass: update prereq references
    const updatePrereqs = targetDb.prepare(`
        UPDATE tcc_matches SET player1_prereq_match_id = ?, player2_prereq_match_id = ? WHERE id = ?
    `);

    for (const m of matches) {
        const newMatchId = matchIdMap.get(m.id);
        const newPrereq1 = matchIdMap.get(m.player1_prereq_match_id) || null;
        const newPrereq2 = matchIdMap.get(m.player2_prereq_match_id) || null;
        if (newMatchId && (newPrereq1 || newPrereq2)) {
            updatePrereqs.run(newPrereq1, newPrereq2, newMatchId);
        }
    }

    // Update station current_match_id
    const updateStation = targetDb.prepare(`UPDATE tcc_stations SET current_match_id = ? WHERE id = ?`);
    for (const s of stations) {
        const newStationId = stationIdMap.get(s.id);
        const newMatchId = matchIdMap.get(s.current_match_id);
        if (newStationId && newMatchId) {
            updateStation.run(newMatchId, newStationId);
        }
    }

    // Migrate standings
    const standings = sourceDb.prepare('SELECT * FROM tcc_standings').all();
    const insertStanding = targetDb.prepare(`
        INSERT INTO tcc_standings (
            tournament_id, participant_id, group_id,
            matches_played, matches_won, matches_lost, matches_tied,
            games_won, games_lost, points, buchholz_score, head_to_head_json, rank, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of standings) {
        try {
            const newTournamentId = tournamentIdMap.get(s.tournament_id);
            const newParticipantId = participantIdMap.get(s.participant_id);
            if (newTournamentId && newParticipantId) {
                insertStanding.run(
                    newTournamentId, newParticipantId, s.group_id,
                    s.matches_played, s.matches_won, s.matches_lost, s.matches_tied,
                    s.games_won, s.games_lost, s.points, s.buchholz_score, s.head_to_head_json, s.rank, s.updated_at
                );
                stats.standings++;
            }
        } catch (e) {
            stats.errors.push(`Standing: ${e.message}`);
        }
    }

    log(`Migrated ${stats.tournaments} tournaments, ${stats.participants} participants, ${stats.matches} matches, ${stats.stations} stations, ${stats.standings} standings`, 'success');
}

function printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('MIGRATION SUMMARY');
    console.log('='.repeat(60));

    if (DRY_RUN) {
        console.log('[DRY-RUN MODE - No changes were made]\n');
    }

    console.log('\nTournaments Database (tournaments.db):');
    console.log(`  - Tournaments: ${stats.tournaments}`);
    console.log(`  - Participants: ${stats.participants}`);
    console.log(`  - Matches: ${stats.matches}`);
    console.log(`  - Stations: ${stats.stations}`);
    console.log(`  - Standings: ${stats.standings}`);

    console.log('\nPlayers Database (players.db):');
    console.log(`  - Players: ${stats.players}`);
    console.log(`  - Player Aliases: ${stats.playerAliases}`);
    console.log(`  - Archived Tournaments: ${stats.archivedTournaments}`);
    console.log(`  - Archived Participants: ${stats.archivedParticipants}`);
    console.log(`  - Archived Matches: ${stats.archivedMatches}`);
    console.log(`  - Player Ratings: ${stats.playerRatings}`);
    console.log(`  - Rating History: ${stats.ratingHistory}`);
    console.log(`  - AI Seeding Cache: ${stats.aiSeedingCache}`);
    console.log(`  - Narratives: ${stats.narratives}`);

    console.log('\nSystem Database (system.db):');
    console.log(`  - Games: ${stats.games}`);
    console.log(`  - Game Configs: ${stats.gameConfigs}`);
    console.log(`  - Users: ${stats.users}`);
    console.log(`  - Settings: ${stats.settings}`);
    console.log(`  - Displays: ${stats.displays}`);
    console.log(`  - Sponsors: ${stats.sponsors}`);
    console.log(`  - Templates: ${stats.templates}`);
    console.log(`  - OAuth Tokens: ${stats.oauthTokens}`);
    console.log(`  - API Tokens: ${stats.apiTokens}`);
    console.log(`  - Push Subscriptions: ${stats.pushSubscriptions}`);
    console.log(`  - Notification Prefs: ${stats.notificationPrefs}`);

    console.log('\nCache Database (cache.db):');
    console.log('  - Created empty (ephemeral data, will be populated on use)');

    if (stats.errors.length > 0) {
        console.log(`\nErrors (${stats.errors.length}):`);
        for (const err of stats.errors.slice(0, 10)) {
            console.log(`  - ${err}`);
        }
        if (stats.errors.length > 10) {
            console.log(`  ... and ${stats.errors.length - 10} more errors`);
        }
    }

    console.log('\n' + '='.repeat(60));

    if (!DRY_RUN) {
        console.log('\nMigration complete! Next steps:');
        console.log('1. Update imports in services and routes');
        console.log('2. Test the application');
        console.log('3. Once verified, you can remove analytics.db');
    }
}

// Main migration
async function main() {
    console.log('='.repeat(60));
    console.log('TCC-Custom Database Migration');
    console.log('From: analytics.db + JSON files');
    console.log('To: tournaments.db, players.db, system.db, cache.db');
    console.log('='.repeat(60));

    if (DRY_RUN) {
        log('Running in DRY-RUN mode - no changes will be made', 'dry');
    }

    checkPrerequisites();
    backupExisting();

    // Open source database
    const sourceDb = new Database(OLD_DB_PATH, { readonly: true });

    // Initialize target databases
    const dbs = initializeDatabases();

    if (!DRY_RUN) {
        // Migrate to system.db
        const gameIdMap = migrateGames(sourceDb, dbs.system);
        migrateUsers(dbs.system);
        migrateSystemSettings(dbs.system);
        migrateDisplays(dbs.system);
        migrateGameConfigs(dbs.system, gameIdMap);
        migrateSponsors(dbs.system);
        migrateTemplates(sourceDb, dbs.system);
        migrateOAuthTokens(sourceDb, dbs.system);
        migrateApiTokens(sourceDb, dbs.system);
        migratePushSubscriptions(sourceDb, dbs.system);
        migrateNotificationPrefs(sourceDb, dbs.system);

        // Migrate to players.db
        const playerIdMap = migratePlayers(sourceDb, dbs.players);
        const tournamentIdMap = migrateArchivedTournaments(sourceDb, dbs.players, gameIdMap, playerIdMap);
        migratePlayerRatings(sourceDb, dbs.players, gameIdMap, playerIdMap, tournamentIdMap);
        migrateAISeedingCache(sourceDb, dbs.players);
        migrateNarratives(sourceDb, dbs.players, tournamentIdMap);

        // Migrate to tournaments.db
        migrateLiveTournaments(sourceDb, dbs.tournaments, gameIdMap);
    } else {
        // Dry run - just collect stats
        const gameIdMap = migrateGames(sourceDb, null);
        migrateUsers(null);
        migrateSystemSettings(null);
        migrateDisplays(null);
        migrateGameConfigs(null, gameIdMap);
        migrateSponsors(null);
        migrateTemplates(sourceDb, null);
        migrateOAuthTokens(sourceDb, null);
        migrateApiTokens(sourceDb, null);
        migratePushSubscriptions(sourceDb, null);
        migrateNotificationPrefs(sourceDb, null);
        migratePlayers(sourceDb, null);
        migrateArchivedTournaments(sourceDb, null, new Map(), new Map());
        migratePlayerRatings(sourceDb, null, new Map(), new Map(), new Map());
        migrateAISeedingCache(sourceDb, null);
        migrateNarratives(sourceDb, null, new Map());
        migrateLiveTournaments(sourceDb, null, new Map());
    }

    sourceDb.close();

    // Close new databases
    if (!DRY_RUN) {
        const db = require('../db');
        db.closeAll();
    }

    printSummary();
}

main().catch(err => {
    log(err.message, 'error');
    console.error(err.stack);
    process.exit(1);
});
