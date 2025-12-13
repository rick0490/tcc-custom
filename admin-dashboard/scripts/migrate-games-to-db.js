#!/usr/bin/env node
/**
 * Migration Script: game-configs.json to Multi-Tenant Database
 *
 * This script migrates existing game configurations from JSON file storage
 * to the multi-tenant SQLite database (system.db).
 *
 * Usage: node scripts/migrate-games-to-db.js [--dry-run] [--user-id=N]
 *
 * Options:
 *   --dry-run    Preview changes without writing to database
 *   --user-id=N  Migrate games for specific user ID (default: 1)
 *
 * The script will:
 * 1. Read game-configs.json from admin-dashboard/
 * 2. Create corresponding entries in the games and game_configs tables
 * 3. Associate all games with the specified user_id
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const userIdArg = args.find(a => a.startsWith('--user-id='));
const userId = userIdArg ? parseInt(userIdArg.split('=')[1], 10) : 1;

// File paths
const DB_PATH = path.join(__dirname, '..', 'system.db');
const GAME_CONFIGS_FILE = path.join(__dirname, '..', 'game-configs.json');

console.log('='.repeat(60));
console.log('Game Configs Migration to Multi-Tenant Database');
console.log('='.repeat(60));
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
console.log(`Target User ID: ${userId}`);
console.log(`Database: ${DB_PATH}`);
console.log(`Source: ${GAME_CONFIGS_FILE}`);
console.log('');

// Check if source file exists
if (!fs.existsSync(GAME_CONFIGS_FILE)) {
    console.log('No game-configs.json found. Nothing to migrate.');
    process.exit(0);
}

// Check if database exists
if (!fs.existsSync(DB_PATH)) {
    console.error('ERROR: system.db not found. Please ensure the admin dashboard has been started at least once.');
    process.exit(1);
}

// Load game configs
let gameConfigs;
try {
    const data = fs.readFileSync(GAME_CONFIGS_FILE, 'utf8');
    gameConfigs = JSON.parse(data);
    console.log(`Found ${Object.keys(gameConfigs).length} games in game-configs.json`);
} catch (error) {
    console.error('ERROR: Failed to read game-configs.json:', error.message);
    process.exit(1);
}

// Connect to database
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Check if user exists
const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
if (!user) {
    console.error(`ERROR: User ID ${userId} not found in database.`);
    console.log('Available users:');
    const users = db.prepare('SELECT id, username FROM users').all();
    users.forEach(u => console.log(`  - ID ${u.id}: ${u.username}`));
    db.close();
    process.exit(1);
}

console.log(`Migrating games for user: ${user.username} (ID: ${userId})`);
console.log('');

// Check for existing games for this user
const existingGames = db.prepare('SELECT game_key FROM games WHERE user_id = ?').all(userId);
if (existingGames.length > 0) {
    console.log(`WARNING: User already has ${existingGames.length} games in database:`);
    existingGames.forEach(g => console.log(`  - ${g.game_key}`));
    console.log('');
    console.log('These will be skipped. Delete them first if you want to re-migrate.');
    console.log('');
}

const existingKeys = new Set(existingGames.map(g => g.game_key));

// Prepare statements
const insertGame = db.prepare(`
    INSERT INTO games (user_id, game_key, name, short_name)
    VALUES (?, ?, ?, ?)
`);

const insertConfig = db.prepare(`
    INSERT INTO game_configs (game_id, rules_json, prizes_json, additional_info_json)
    VALUES (?, ?, ?, ?)
`);

// Begin migration
console.log('Migration plan:');
console.log('-'.repeat(60));

let migrated = 0;
let skipped = 0;

const migrateGame = db.transaction((gameKey, config) => {
    // Insert game
    const result = insertGame.run(
        userId,
        gameKey,
        config.name || gameKey,
        config.shortName || ''
    );

    const gameId = result.lastInsertRowid;

    // Insert config
    insertConfig.run(
        gameId,
        JSON.stringify(config.rules || []),
        JSON.stringify(config.prizes || []),
        JSON.stringify(config.additionalInfo || [])
    );

    return gameId;
});

for (const [gameKey, config] of Object.entries(gameConfigs)) {
    const status = existingKeys.has(gameKey) ? 'SKIP (exists)' : 'MIGRATE';

    console.log(`  ${gameKey.padEnd(25)} ${(config.name || '-').padEnd(30)} ${status}`);

    if (status === 'SKIP (exists)') {
        skipped++;
        continue;
    }

    if (!dryRun) {
        try {
            const gameId = migrateGame(gameKey, config);
            console.log(`    -> Created game ID: ${gameId}`);
            migrated++;
        } catch (error) {
            console.error(`    -> ERROR: ${error.message}`);
        }
    } else {
        migrated++;
    }
}

console.log('-'.repeat(60));
console.log('');
console.log('Summary:');
console.log(`  Total in JSON:  ${Object.keys(gameConfigs).length}`);
console.log(`  Migrated:       ${migrated}`);
console.log(`  Skipped:        ${skipped}`);

if (dryRun) {
    console.log('');
    console.log('This was a dry run. No changes were made.');
    console.log('Run without --dry-run to perform the migration.');
} else if (migrated > 0) {
    console.log('');
    console.log('Migration complete!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Restart the admin dashboard: sudo systemctl restart control-center-admin');
    console.log('  2. Verify games appear in the Games page');
    console.log('  3. Optionally backup and remove game-configs.json');
}

db.close();
