/**
 * Migration: Match Lifecycle Update
 *
 * This migration updates the tcc_matches table to support 4 states:
 * pending -> open -> underway -> complete
 *
 * Changes:
 * 1. Updates CHECK constraint to include 'underway' state
 * 2. SQLite doesn't support ALTER CONSTRAINT, so we:
 *    a. Create new table with correct constraint
 *    b. Copy data from old table
 *    c. Drop old table
 *    d. Rename new table
 *    e. Recreate indexes and foreign keys
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database path
const TOURNAMENTS_DB_PATH = path.join(__dirname, '..', 'tournaments.db');
const BACKUP_DIR = path.join(__dirname, '..', 'backups', 'match-lifecycle-' + Date.now());

/**
 * Backup database file
 */
function backupDatabase(dbPath, backupDir) {
    const filename = path.basename(dbPath);
    const backupPath = path.join(backupDir, filename);

    if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
        console.log(`  Backed up ${filename} to ${backupPath}`);
        return true;
    } else {
        console.log(`  Database ${filename} not found - nothing to migrate`);
        return false;
    }
}

/**
 * Run the migration
 */
async function migrate() {
    console.log('='.repeat(60));
    console.log('Migration: Match Lifecycle Update');
    console.log('='.repeat(60));
    console.log('\nAdding "underway" state to match lifecycle:');
    console.log('  pending -> open -> underway -> complete\n');

    // Create backup directory
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    console.log('[1/5] Backing up database...');
    if (!backupDatabase(TOURNAMENTS_DB_PATH, BACKUP_DIR)) {
        console.log('\nNo database to migrate. Exiting.');
        return;
    }

    // Open database
    const db = new Database(TOURNAMENTS_DB_PATH);
    db.pragma('foreign_keys = OFF'); // Disable for table recreation

    try {
        // Check if migration already applied
        const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tcc_matches'").get();

        if (tableInfo && tableInfo.sql.includes("'underway'")) {
            console.log('\n[!] Migration already applied (underway state exists). Skipping...');
            db.close();
            return;
        }

        console.log('[2/5] Creating new tcc_matches table with updated constraint...');

        // Create new table with 4-state CHECK constraint
        db.exec(`
            CREATE TABLE IF NOT EXISTS tcc_matches_new (
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
                FOREIGN KEY (player1_prereq_match_id) REFERENCES tcc_matches_new(id),
                FOREIGN KEY (player2_prereq_match_id) REFERENCES tcc_matches_new(id),
                FOREIGN KEY (station_id) REFERENCES tcc_stations(id)
            )
        `);
        console.log('  Created tcc_matches_new with 4-state constraint');

        console.log('[3/5] Copying data from old table...');

        // Check if old table exists and has data
        const oldTableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tcc_matches'").get();

        if (oldTableExists) {
            const rowCount = db.prepare('SELECT COUNT(*) as count FROM tcc_matches').get();
            console.log(`  Found ${rowCount.count} matches to migrate`);

            if (rowCount.count > 0) {
                // Copy data - matches with underway_at set but state='open' will remain valid
                // since 'underway' state was not in the old schema
                db.exec(`
                    INSERT INTO tcc_matches_new (
                        id, tournament_id, identifier, round, suggested_play_order,
                        bracket_position, losers_bracket,
                        player1_id, player2_id,
                        player1_prereq_match_id, player2_prereq_match_id,
                        player1_is_prereq_loser, player2_is_prereq_loser,
                        state, winner_id, loser_id,
                        player1_score, player2_score, scores_csv,
                        forfeited, forfeited_participant_id,
                        station_id, underway_at, completed_at,
                        created_at, updated_at
                    )
                    SELECT
                        id, tournament_id, identifier, round, suggested_play_order,
                        bracket_position, losers_bracket,
                        player1_id, player2_id,
                        player1_prereq_match_id, player2_prereq_match_id,
                        player1_is_prereq_loser, player2_is_prereq_loser,
                        -- Convert matches that have underway_at set to 'underway' state
                        CASE
                            WHEN underway_at IS NOT NULL AND state = 'open' THEN 'underway'
                            ELSE state
                        END as state,
                        winner_id, loser_id,
                        player1_score, player2_score, scores_csv,
                        forfeited, forfeited_participant_id,
                        station_id, underway_at, completed_at,
                        created_at, updated_at
                    FROM tcc_matches
                `);
                console.log(`  Copied ${rowCount.count} matches to new table`);

                // Count how many were converted to 'underway' state
                const underwayConverted = db.prepare(`
                    SELECT COUNT(*) as count FROM tcc_matches
                    WHERE underway_at IS NOT NULL AND state = 'open'
                `).get();
                if (underwayConverted.count > 0) {
                    console.log(`  Converted ${underwayConverted.count} matches from 'open' to 'underway' state`);
                }
            }

            console.log('[4/5] Replacing old table with new table...');

            // Drop old table and rename new one
            db.exec('DROP TABLE tcc_matches');
            db.exec('ALTER TABLE tcc_matches_new RENAME TO tcc_matches');
            console.log('  Replaced tcc_matches table');
        } else {
            console.log('  No existing tcc_matches table found');
            db.exec('ALTER TABLE tcc_matches_new RENAME TO tcc_matches');
        }

        console.log('[5/5] Recreating indexes...');

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_tcc_matches_tournament ON tcc_matches(tournament_id);
            CREATE INDEX IF NOT EXISTS idx_tcc_matches_state ON tcc_matches(tournament_id, state);
            CREATE INDEX IF NOT EXISTS idx_tcc_matches_round ON tcc_matches(tournament_id, round);
            CREATE INDEX IF NOT EXISTS idx_tcc_matches_prereq1 ON tcc_matches(player1_prereq_match_id);
            CREATE INDEX IF NOT EXISTS idx_tcc_matches_prereq2 ON tcc_matches(player2_prereq_match_id);
            CREATE INDEX IF NOT EXISTS idx_tcc_matches_station ON tcc_matches(station_id);
            CREATE INDEX IF NOT EXISTS idx_tcc_matches_order ON tcc_matches(tournament_id, suggested_play_order);
        `);
        console.log('  Recreated all indexes');

        // Re-enable foreign keys
        db.pragma('foreign_keys = ON');

        // Verify the new constraint
        const newTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tcc_matches'").get();
        if (newTableInfo && newTableInfo.sql.includes("'underway'")) {
            console.log('\n  Verified: underway state is now in CHECK constraint');
        }

        db.close();

        console.log('\n' + '='.repeat(60));
        console.log('Migration completed successfully!');
        console.log('='.repeat(60));
        console.log('\nBackup saved to:', BACKUP_DIR);
        console.log('\nMatch lifecycle is now:');
        console.log('  pending -> open -> underway -> complete');
        console.log('\nTimestamp behavior:');
        console.log('  - underway_at: Set when match marked underway, kept on completion');
        console.log('  - completed_at: Set when match completed, cleared on reopen');
        console.log('  - Both cleared when match reopened (full reset)');
        console.log('\nNext steps:');
        console.log('  1. Restart the admin-dashboard service');
        console.log('  2. Test match state transitions in the UI');

    } catch (err) {
        console.error('\n[ERROR] Migration failed:', err);
        console.error('Restore from backup in:', BACKUP_DIR);

        try { db.close(); } catch (e) {}

        process.exit(1);
    }
}

/**
 * Check migration status
 */
function checkStatus() {
    console.log('Checking migration status...\n');

    if (!fs.existsSync(TOURNAMENTS_DB_PATH)) {
        console.log('Database not found. Migration not needed (fresh install).');
        return true;
    }

    const db = new Database(TOURNAMENTS_DB_PATH);

    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tcc_matches'").get();

    db.close();

    if (!tableInfo) {
        console.log('tcc_matches table does not exist. Migration not needed.');
        return true;
    }

    const hasUnderway = tableInfo.sql.includes("'underway'");

    console.log('Migration Status:');
    console.log('  tcc_matches CHECK constraint includes underway:', hasUnderway ? 'YES' : 'NO');

    if (hasUnderway) {
        console.log('\nMigration has been applied successfully.');
        return true;
    } else {
        console.log('\nMigration has NOT been applied yet.');
        console.log('Run: node migrations/002-match-lifecycle.js');
        return false;
    }
}

// CLI interface
const args = process.argv.slice(2);

if (args.includes('--status')) {
    checkStatus();
} else if (args.includes('--help')) {
    console.log('Match Lifecycle Migration Script');
    console.log('\nUsage:');
    console.log('  node 002-match-lifecycle.js          Run the migration');
    console.log('  node 002-match-lifecycle.js --status Check migration status');
    console.log('  node 002-match-lifecycle.js --help   Show this help');
} else {
    migrate();
}

module.exports = { migrate, checkStatus };
