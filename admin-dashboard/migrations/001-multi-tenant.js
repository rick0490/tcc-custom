/**
 * Migration: Multi-Tenant User System
 *
 * This migration:
 * 1. Extends the users table with subscription and activation fields
 * 2. Adds superadmin role support
 * 3. Creates invite_keys table for registration control
 * 4. Creates platform_settings table for god mode configuration
 * 5. Creates impersonation_sessions table for audit logging
 * 6. Adds user_id column to tcc_tournaments for tenant isolation
 * 7. Migrates existing user (ricardo) to superadmin with full access
 * 8. Creates initial unlimited invite key
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Database paths
const SYSTEM_DB_PATH = path.join(__dirname, '..', 'system.db');
const TOURNAMENTS_DB_PATH = path.join(__dirname, '..', 'tournaments.db');
const PLAYERS_DB_PATH = path.join(__dirname, '..', 'players.db');
const USERS_JSON_PATH = path.join(__dirname, '..', 'users.json');
const BACKUP_DIR = path.join(__dirname, '..', 'backups', 'pre-migration-' + Date.now());

/**
 * Generate a secure random key for invite codes
 */
function generateInviteKey() {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
}

/**
 * Backup database file
 */
function backupDatabase(dbPath, backupDir) {
    const filename = path.basename(dbPath);
    const backupPath = path.join(backupDir, filename);

    if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
        console.log(`  Backed up ${filename} to ${backupPath}`);
    } else {
        console.log(`  Skipping backup of ${filename} (file not found)`);
    }
}

/**
 * Run the migration
 */
async function migrate() {
    console.log('='.repeat(60));
    console.log('Migration: Multi-Tenant User System');
    console.log('='.repeat(60));

    // Create backup directory
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    console.log('\n[1/8] Backing up databases...');
    backupDatabase(SYSTEM_DB_PATH, BACKUP_DIR);
    backupDatabase(TOURNAMENTS_DB_PATH, BACKUP_DIR);
    backupDatabase(PLAYERS_DB_PATH, BACKUP_DIR);
    if (fs.existsSync(USERS_JSON_PATH)) {
        fs.copyFileSync(USERS_JSON_PATH, path.join(BACKUP_DIR, 'users.json'));
        console.log('  Backed up users.json');
    }

    // Open databases
    const systemDb = new Database(SYSTEM_DB_PATH);
    systemDb.pragma('foreign_keys = OFF'); // Temporarily disable for migration

    const tournamentsDb = new Database(TOURNAMENTS_DB_PATH);
    tournamentsDb.pragma('foreign_keys = OFF');

    try {
        // Check if migration already applied
        const existingColumn = systemDb.prepare(
            "SELECT 1 FROM pragma_table_info('users') WHERE name = 'subscription_status'"
        ).get();

        if (existingColumn) {
            console.log('\n[!] Migration already applied. Skipping...');
            systemDb.close();
            tournamentsDb.close();
            return;
        }

        console.log('\n[2/8] Creating new tables in system.db...');

        // Create invite_keys table
        systemDb.exec(`
            CREATE TABLE IF NOT EXISTS invite_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_code TEXT UNIQUE NOT NULL,
                name TEXT,
                key_type TEXT DEFAULT 'unlimited' CHECK(key_type IN ('single', 'multi', 'unlimited')),
                uses_remaining INTEGER,
                total_uses INTEGER DEFAULT 0,
                expires_at DATETIME,
                is_active INTEGER DEFAULT 1,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_invite_keys_code ON invite_keys(key_code);
            CREATE INDEX IF NOT EXISTS idx_invite_keys_active ON invite_keys(is_active);
        `);
        console.log('  Created invite_keys table');

        // Create invite_key_usage table
        systemDb.exec(`
            CREATE TABLE IF NOT EXISTS invite_key_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                ip_address TEXT,
                FOREIGN KEY (key_id) REFERENCES invite_keys(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_invite_key_usage_key ON invite_key_usage(key_id);
            CREATE INDEX IF NOT EXISTS idx_invite_key_usage_user ON invite_key_usage(user_id);
        `);
        console.log('  Created invite_key_usage table');

        // Create impersonation_sessions table
        systemDb.exec(`
            CREATE TABLE IF NOT EXISTS impersonation_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                superadmin_id INTEGER NOT NULL,
                target_user_id INTEGER NOT NULL,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                ended_at DATETIME,
                reason TEXT,
                FOREIGN KEY (superadmin_id) REFERENCES users(id),
                FOREIGN KEY (target_user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_impersonation_superadmin ON impersonation_sessions(superadmin_id);
            CREATE INDEX IF NOT EXISTS idx_impersonation_target ON impersonation_sessions(target_user_id);
        `);
        console.log('  Created impersonation_sessions table');

        // Create platform_settings table
        systemDb.exec(`
            CREATE TABLE IF NOT EXISTS platform_settings (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                trial_duration_days INTEGER DEFAULT 14,
                allow_signups INTEGER DEFAULT 1,
                require_invite_key INTEGER DEFAULT 1,
                maintenance_mode INTEGER DEFAULT 0,
                maintenance_message TEXT,
                feature_flags_json TEXT DEFAULT '{}',
                pricing_json TEXT DEFAULT '{"monthly": 29.99, "yearly": 299.99}',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            INSERT OR IGNORE INTO platform_settings (id) VALUES (1);
        `);
        console.log('  Created platform_settings table');

        console.log('\n[3/8] Extending users table with new columns...');

        // Add new columns to users table (SQLite ADD COLUMN)
        // Note: SQLite doesn't allow non-constant defaults, so we use NULL or constant values
        const columnsToAdd = [
            { name: 'subscription_status', sql: "ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'active'" },
            { name: 'subscription_expires_at', sql: "ALTER TABLE users ADD COLUMN subscription_expires_at DATETIME" },
            { name: 'trial_ends_at', sql: "ALTER TABLE users ADD COLUMN trial_ends_at DATETIME" },
            { name: 'is_active', sql: "ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1" },
            { name: 'activated_at', sql: "ALTER TABLE users ADD COLUMN activated_at DATETIME" },
            { name: 'invite_key_used', sql: "ALTER TABLE users ADD COLUMN invite_key_used TEXT" },
            { name: 'display_name', sql: "ALTER TABLE users ADD COLUMN display_name TEXT" },
            { name: 'last_login_at', sql: "ALTER TABLE users ADD COLUMN last_login_at DATETIME" }
        ];

        for (const col of columnsToAdd) {
            try {
                systemDb.exec(col.sql);
                console.log(`  Added column: ${col.name}`);
            } catch (err) {
                if (err.message.includes('duplicate column')) {
                    console.log(`  Column ${col.name} already exists, skipping`);
                } else {
                    throw err;
                }
            }
        }

        // Update existing users with activated_at timestamp
        systemDb.exec(`
            UPDATE users SET activated_at = COALESCE(created_at, CURRENT_TIMESTAMP)
            WHERE activated_at IS NULL
        `);
        console.log('  Updated existing users with activated_at timestamp');

        // Update role constraint to include superadmin
        // SQLite doesn't support ALTER CONSTRAINT, so we need to recreate
        // For now, we'll just update the check at application level
        // The existing CHECK constraint allows ('admin', 'user', 'viewer')
        // We'll need to handle 'superadmin' at app level

        console.log('\n[4/8] Adding user_id to tournaments table...');

        // Check if user_id column exists
        const tournamentsCol = tournamentsDb.prepare(
            "SELECT 1 FROM pragma_table_info('tcc_tournaments') WHERE name = 'user_id'"
        ).get();

        if (!tournamentsCol) {
            tournamentsDb.exec(`
                ALTER TABLE tcc_tournaments ADD COLUMN user_id INTEGER;
                CREATE INDEX IF NOT EXISTS idx_tcc_tournaments_user ON tcc_tournaments(user_id);
            `);
            console.log('  Added user_id column to tcc_tournaments');
        } else {
            console.log('  user_id column already exists');
        }

        console.log('\n[5/8] Migrating existing users...');

        // Get existing users from database or JSON
        let existingUsers = [];

        // First try to get from database
        try {
            existingUsers = systemDb.prepare('SELECT * FROM users').all();
        } catch (err) {
            console.log('  No users in database yet');
        }

        // Also check users.json for any users not in DB
        if (fs.existsSync(USERS_JSON_PATH)) {
            try {
                const usersJson = JSON.parse(fs.readFileSync(USERS_JSON_PATH, 'utf8'));
                for (const jsonUser of usersJson.users || []) {
                    const dbUser = systemDb.prepare('SELECT id FROM users WHERE username = ?').get(jsonUser.username);
                    if (!dbUser) {
                        // Migrate from JSON to DB
                        const result = systemDb.prepare(`
                            INSERT INTO users (username, password_hash, role, email, is_active, activated_at)
                            VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
                        `).run(jsonUser.username, jsonUser.password, jsonUser.role || 'user', jsonUser.email || null);
                        console.log(`  Migrated user ${jsonUser.username} from users.json (ID: ${result.lastInsertRowid})`);
                        existingUsers.push({ id: result.lastInsertRowid, username: jsonUser.username, role: jsonUser.role });
                    }
                }
            } catch (err) {
                console.log('  Could not read users.json:', err.message);
            }
        }

        // Find the first admin user (ricardo) and make them superadmin
        let superadminId = null;
        const firstAdmin = existingUsers.find(u => u.role === 'admin' || u.username === 'ricardo');

        if (firstAdmin) {
            superadminId = firstAdmin.id;
            // Note: We can't directly update to 'superadmin' due to CHECK constraint
            // We'll handle this at the application level by treating 'admin' with id=1 as superadmin
            // OR we can store it in a separate way

            // For now, let's use a platform_settings flag to store the superadmin user ID
            systemDb.prepare(`
                UPDATE platform_settings SET feature_flags_json = json_set(
                    COALESCE(feature_flags_json, '{}'),
                    '$.superadmin_user_id',
                    ?
                ) WHERE id = 1
            `).run(superadminId);

            console.log(`  Marked user ${firstAdmin.username} (ID: ${superadminId}) as superadmin`);
        }

        console.log('\n[6/8] Assigning existing tournaments to superadmin...');

        if (superadminId) {
            const updateResult = tournamentsDb.prepare(
                'UPDATE tcc_tournaments SET user_id = ? WHERE user_id IS NULL'
            ).run(superadminId);
            console.log(`  Assigned ${updateResult.changes} tournaments to superadmin (ID: ${superadminId})`);
        } else {
            console.log('  No superadmin found, skipping tournament assignment');
        }

        console.log('\n[7/8] Creating initial invite key...');

        // Create an unlimited master invite key
        const masterKey = generateInviteKey();
        const existingKey = systemDb.prepare('SELECT id FROM invite_keys WHERE name = ?').get('Master Key');

        if (!existingKey) {
            systemDb.prepare(`
                INSERT INTO invite_keys (key_code, name, key_type, is_active, created_by)
                VALUES (?, 'Master Key', 'unlimited', 1, ?)
            `).run(masterKey, superadminId);
            console.log(`  Created unlimited master invite key: ${masterKey}`);
            console.log('  SAVE THIS KEY - you will need it to invite new users!');
        } else {
            console.log('  Master key already exists');
        }

        console.log('\n[8/8] Finalizing migration...');

        // Record migration completion
        systemDb.prepare(`
            INSERT OR REPLACE INTO system_settings (key, value_json, description)
            VALUES ('migration_001_completed', ?, 'Multi-tenant migration completion timestamp')
        `).run(JSON.stringify(new Date().toISOString()));

        // Re-enable foreign keys
        systemDb.pragma('foreign_keys = ON');
        tournamentsDb.pragma('foreign_keys = ON');

        // Close databases
        systemDb.close();
        tournamentsDb.close();

        console.log('\n' + '='.repeat(60));
        console.log('Migration completed successfully!');
        console.log('='.repeat(60));
        console.log('\nBackups saved to:', BACKUP_DIR);
        if (!existingKey) {
            console.log('\nMASTER INVITE KEY:', masterKey);
            console.log('(Use this key when signing up new users)');
        }
        console.log('\nNext steps:');
        console.log('1. Restart the admin-dashboard service');
        console.log('2. The first admin user has been marked as superadmin');
        console.log('3. Share the master invite key with users you want to onboard');

    } catch (err) {
        console.error('\n[ERROR] Migration failed:', err);
        console.error('Rolling back is not automatic. Restore from backups in:', BACKUP_DIR);

        // Close databases
        try { systemDb.close(); } catch (e) {}
        try { tournamentsDb.close(); } catch (e) {}

        process.exit(1);
    }
}

/**
 * Check migration status without making changes
 */
function checkStatus() {
    console.log('Checking migration status...\n');

    const systemDb = new Database(SYSTEM_DB_PATH);

    // Check for subscription_status column
    const hasSubscription = systemDb.prepare(
        "SELECT 1 FROM pragma_table_info('users') WHERE name = 'subscription_status'"
    ).get();

    // Check for invite_keys table
    const hasInviteKeys = systemDb.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='invite_keys'"
    ).get();

    // Check for platform_settings table
    const hasPlatformSettings = systemDb.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_settings'"
    ).get();

    // Check for migration completion marker
    const migrationCompleted = systemDb.prepare(
        "SELECT value_json FROM system_settings WHERE key = 'migration_001_completed'"
    ).get();

    systemDb.close();

    console.log('Migration Status:');
    console.log('  subscription_status column:', hasSubscription ? 'EXISTS' : 'MISSING');
    console.log('  invite_keys table:', hasInviteKeys ? 'EXISTS' : 'MISSING');
    console.log('  platform_settings table:', hasPlatformSettings ? 'EXISTS' : 'MISSING');
    console.log('  Migration marker:', migrationCompleted ? `COMPLETE (${JSON.parse(migrationCompleted.value_json)})` : 'NOT FOUND');

    if (hasSubscription && hasInviteKeys && hasPlatformSettings && migrationCompleted) {
        console.log('\nMigration has been applied successfully.');
        return true;
    } else {
        console.log('\nMigration has NOT been applied yet.');
        return false;
    }
}

// CLI interface
const args = process.argv.slice(2);

if (args.includes('--status')) {
    checkStatus();
} else if (args.includes('--help')) {
    console.log('Multi-Tenant Migration Script');
    console.log('\nUsage:');
    console.log('  node 001-multi-tenant.js          Run the migration');
    console.log('  node 001-multi-tenant.js --status Check migration status');
    console.log('  node 001-multi-tenant.js --help   Show this help');
} else {
    migrate();
}

module.exports = { migrate, checkStatus };
