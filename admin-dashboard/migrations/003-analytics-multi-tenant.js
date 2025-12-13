/**
 * Migration: Add Multi-Tenant Support to Analytics Database
 *
 * This migration adds user_id columns to analytics tables for per-tenant isolation:
 * - players: Each user has their own player pool
 * - tournaments: Each user has their own archived tournaments
 * - player_ratings: Elo ratings are per-tenant
 *
 * Existing data is assigned to user_id = 1 (superadmin)
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'analytics.db');

function migrate() {
    console.log('[Migration 003] Starting analytics multi-tenant migration...');

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    try {
        db.exec('BEGIN TRANSACTION');

        // ============================================
        // 1. Add user_id to players table
        // ============================================
        console.log('[Migration 003] Adding user_id to players table...');

        // Check if column exists
        const playersColumns = db.prepare("PRAGMA table_info(players)").all();
        const hasPlayersUserId = playersColumns.some(col => col.name === 'user_id');

        if (!hasPlayersUserId) {
            db.exec(`ALTER TABLE players ADD COLUMN user_id INTEGER DEFAULT 1`);
            console.log('[Migration 003] Added user_id column to players');

            // Update existing records
            const playersUpdated = db.prepare(`UPDATE players SET user_id = 1 WHERE user_id IS NULL`).run();
            console.log(`[Migration 003] Set user_id=1 for ${playersUpdated.changes} existing players`);

            // Create index
            db.exec(`CREATE INDEX IF NOT EXISTS idx_players_user ON players(user_id)`);
            console.log('[Migration 003] Created index on players.user_id');

            // Drop and recreate unique constraint to include user_id
            // SQLite doesn't support dropping constraints, so we need to recreate the table
            console.log('[Migration 003] Updating players unique constraint to include user_id...');

            db.exec(`
                -- Create new table with updated constraint
                CREATE TABLE players_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER DEFAULT 1,
                    canonical_name TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    email TEXT,
                    challonge_username TEXT,
                    instagram TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, canonical_name)
                );

                -- Copy data
                INSERT INTO players_new (id, user_id, canonical_name, display_name, email, challonge_username, instagram, created_at, updated_at)
                SELECT id, COALESCE(user_id, 1), canonical_name, display_name, email, challonge_username, instagram, created_at, updated_at
                FROM players;

                -- Drop old table
                DROP TABLE players;

                -- Rename new table
                ALTER TABLE players_new RENAME TO players;

                -- Recreate indexes
                CREATE INDEX idx_players_canonical ON players(canonical_name);
                CREATE INDEX idx_players_user ON players(user_id);
            `);
            console.log('[Migration 003] Updated players table with user_id in unique constraint');
        } else {
            console.log('[Migration 003] players.user_id already exists, skipping');
        }

        // ============================================
        // 2. Add user_id to tournaments table
        // ============================================
        console.log('[Migration 003] Adding user_id to tournaments table...');

        const tournamentsColumns = db.prepare("PRAGMA table_info(tournaments)").all();
        const hasTournamentsUserId = tournamentsColumns.some(col => col.name === 'user_id');

        if (!hasTournamentsUserId) {
            db.exec(`ALTER TABLE tournaments ADD COLUMN user_id INTEGER DEFAULT 1`);
            console.log('[Migration 003] Added user_id column to tournaments');

            // Update existing records
            const tournamentsUpdated = db.prepare(`UPDATE tournaments SET user_id = 1 WHERE user_id IS NULL`).run();
            console.log(`[Migration 003] Set user_id=1 for ${tournamentsUpdated.changes} existing tournaments`);

            // Create index
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tournaments_user ON tournaments(user_id)`);
            console.log('[Migration 003] Created index on tournaments.user_id');
        } else {
            console.log('[Migration 003] tournaments.user_id already exists, skipping');
        }

        // ============================================
        // 3. Add user_id to player_ratings table
        // ============================================
        console.log('[Migration 003] Adding user_id to player_ratings table...');

        const ratingsColumns = db.prepare("PRAGMA table_info(player_ratings)").all();
        const hasRatingsUserId = ratingsColumns.some(col => col.name === 'user_id');

        if (!hasRatingsUserId) {
            db.exec(`ALTER TABLE player_ratings ADD COLUMN user_id INTEGER DEFAULT 1`);
            console.log('[Migration 003] Added user_id column to player_ratings');

            // Update existing records
            const ratingsUpdated = db.prepare(`UPDATE player_ratings SET user_id = 1 WHERE user_id IS NULL`).run();
            console.log(`[Migration 003] Set user_id=1 for ${ratingsUpdated.changes} existing player_ratings`);

            // Create index
            db.exec(`CREATE INDEX IF NOT EXISTS idx_ratings_user ON player_ratings(user_id)`);
            console.log('[Migration 003] Created index on player_ratings.user_id');

            // Update unique constraint to include user_id
            console.log('[Migration 003] Updating player_ratings unique constraint to include user_id...');

            db.exec(`
                -- Create new table with updated constraint
                CREATE TABLE player_ratings_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER DEFAULT 1,
                    player_id INTEGER NOT NULL,
                    game_id INTEGER NOT NULL,
                    elo_rating INTEGER DEFAULT 1200,
                    peak_rating INTEGER DEFAULT 1200,
                    matches_played INTEGER DEFAULT 0,
                    wins INTEGER DEFAULT 0,
                    losses INTEGER DEFAULT 0,
                    last_active DATETIME,
                    FOREIGN KEY (player_id) REFERENCES players(id),
                    FOREIGN KEY (game_id) REFERENCES games(id),
                    UNIQUE(user_id, player_id, game_id)
                );

                -- Copy data
                INSERT INTO player_ratings_new (id, user_id, player_id, game_id, elo_rating, peak_rating, matches_played, wins, losses, last_active)
                SELECT id, COALESCE(user_id, 1), player_id, game_id, elo_rating, peak_rating, matches_played, wins, losses, last_active
                FROM player_ratings;

                -- Drop old table
                DROP TABLE player_ratings;

                -- Rename new table
                ALTER TABLE player_ratings_new RENAME TO player_ratings;

                -- Recreate indexes
                CREATE INDEX idx_ratings_player_game ON player_ratings(player_id, game_id);
                CREATE INDEX idx_ratings_user ON player_ratings(user_id);
            `);
            console.log('[Migration 003] Updated player_ratings table with user_id in unique constraint');
        } else {
            console.log('[Migration 003] player_ratings.user_id already exists, skipping');
        }

        // ============================================
        // 4. Add user_id to player_aliases table
        // ============================================
        console.log('[Migration 003] Adding user_id to player_aliases table...');

        const aliasesColumns = db.prepare("PRAGMA table_info(player_aliases)").all();
        const hasAliasesUserId = aliasesColumns.some(col => col.name === 'user_id');

        if (!hasAliasesUserId) {
            db.exec(`ALTER TABLE player_aliases ADD COLUMN user_id INTEGER DEFAULT 1`);
            console.log('[Migration 003] Added user_id column to player_aliases');

            // Update existing records
            const aliasesUpdated = db.prepare(`UPDATE player_aliases SET user_id = 1 WHERE user_id IS NULL`).run();
            console.log(`[Migration 003] Set user_id=1 for ${aliasesUpdated.changes} existing player_aliases`);

            // Update unique constraint to include user_id
            console.log('[Migration 003] Updating player_aliases unique constraint to include user_id...');

            db.exec(`
                -- Create new table with updated constraint
                CREATE TABLE player_aliases_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER DEFAULT 1,
                    player_id INTEGER NOT NULL,
                    alias TEXT NOT NULL,
                    normalized_alias TEXT NOT NULL,
                    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
                    UNIQUE(user_id, normalized_alias)
                );

                -- Copy data
                INSERT INTO player_aliases_new (id, user_id, player_id, alias, normalized_alias)
                SELECT id, COALESCE(user_id, 1), player_id, alias, normalized_alias
                FROM player_aliases;

                -- Drop old table
                DROP TABLE player_aliases;

                -- Rename new table
                ALTER TABLE player_aliases_new RENAME TO player_aliases;

                -- Recreate indexes
                CREATE INDEX idx_aliases_normalized ON player_aliases(normalized_alias);
                CREATE INDEX idx_aliases_user ON player_aliases(user_id);
            `);
            console.log('[Migration 003] Updated player_aliases table with user_id in unique constraint');
        } else {
            console.log('[Migration 003] player_aliases.user_id already exists, skipping');
        }

        db.exec('COMMIT');
        console.log('[Migration 003] Migration completed successfully!');

        // Print summary
        const playerCount = db.prepare('SELECT COUNT(*) as count FROM players').get().count;
        const tournamentCount = db.prepare('SELECT COUNT(*) as count FROM tournaments').get().count;
        const ratingsCount = db.prepare('SELECT COUNT(*) as count FROM player_ratings').get().count;

        console.log('\n[Migration 003] Summary:');
        console.log(`  - Players: ${playerCount} (all assigned to user_id=1)`);
        console.log(`  - Tournaments: ${tournamentCount} (all assigned to user_id=1)`);
        console.log(`  - Player Ratings: ${ratingsCount} (all assigned to user_id=1)`);

    } catch (error) {
        console.error('[Migration 003] Error during migration:', error.message);
        db.exec('ROLLBACK');
        throw error;
    } finally {
        db.close();
    }
}

// Run migration if called directly
if (require.main === module) {
    migrate();
}

module.exports = { migrate };
