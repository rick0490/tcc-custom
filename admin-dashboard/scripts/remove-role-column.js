#!/usr/bin/env node
/**
 * Migration Script: Remove Role Column from Users Table
 *
 * This script removes the 'role' column from the users table in existing databases.
 * The role distinction has been removed - all authenticated users have full tenant access,
 * and superadmin is determined solely by userId === 1.
 *
 * Usage: node scripts/remove-role-column.js [--dry-run]
 *
 * Options:
 *   --dry-run    Preview changes without modifying the database
 *
 * The script will:
 * 1. Check if the role column exists in the users table
 * 2. If exists, create a new table without the role column
 * 3. Copy all data (excluding role) from old table to new
 * 4. Drop the old table
 * 5. Rename the new table to 'users'
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Database path
const DB_PATH = path.join(__dirname, '..', 'system.db');

console.log('='.repeat(60));
console.log('Migration: Remove Role Column from Users Table');
console.log('='.repeat(60));
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
console.log(`Database: ${DB_PATH}`);
console.log('');

// Check if database exists
if (!fs.existsSync(DB_PATH)) {
	console.log('Database not found. Nothing to migrate.');
	console.log('The database will be created with the correct schema when the admin dashboard starts.');
	process.exit(0);
}

// Connect to database
const db = new Database(DB_PATH);

// Check if users table exists
const tableExists = db.prepare(`
	SELECT name FROM sqlite_master
	WHERE type='table' AND name='users'
`).get();

if (!tableExists) {
	console.log('Users table does not exist. Nothing to migrate.');
	console.log('The table will be created with the correct schema when the admin dashboard starts.');
	db.close();
	process.exit(0);
}

// Get current table schema
const tableInfo = db.prepare('PRAGMA table_info(users)').all();

console.log('Current users table columns:');
tableInfo.forEach(col => {
	console.log(`  - ${col.name} (${col.type}${col.notnull ? ' NOT NULL' : ''}${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''})`);
});
console.log('');

// Check if role column exists
const roleColumn = tableInfo.find(col => col.name === 'role');

if (!roleColumn) {
	console.log('Role column does not exist in users table.');
	console.log('Migration already complete or not needed.');
	db.close();
	process.exit(0);
}

console.log('Role column found. Proceeding with migration...');
console.log('');

// Get current data
const users = db.prepare('SELECT * FROM users').all();
console.log(`Found ${users.length} user(s) in the database:`);
users.forEach(user => {
	console.log(`  - ID ${user.id}: ${user.username} (role: ${user.role || 'none'})`);
});
console.log('');

if (dryRun) {
	console.log('DRY RUN: The following changes would be made:');
	console.log('  1. Create new users table without role column');
	console.log('  2. Copy all user data (excluding role)');
	console.log('  3. Drop old users table');
	console.log('  4. Rename new table to "users"');
	console.log('');
	console.log('Run without --dry-run to perform the migration.');
	db.close();
	process.exit(0);
}

// Perform migration in a transaction
try {
	db.exec('BEGIN TRANSACTION');

	// 1. Disable foreign keys temporarily (required for table rename)
	db.exec('PRAGMA foreign_keys = OFF');

	// 2. Get all columns except 'role' to build dynamic query
	const columnsToKeep = tableInfo.filter(col => col.name !== 'role').map(col => col.name);
	console.log(`Keeping columns: ${columnsToKeep.join(', ')}`);

	// 3. Build column definitions for new table (dynamically from existing schema)
	// Note: We also need to handle UNIQUE constraint on username
	const columnDefs = tableInfo
		.filter(col => col.name !== 'role')
		.map(col => {
			let def = `${col.name} ${col.type}`;
			if (col.pk) def += ' PRIMARY KEY';
			if (col.pk && col.name === 'id') def += ' AUTOINCREMENT';
			// Add UNIQUE constraint for username
			if (col.name === 'username') def += ' UNIQUE';
			if (col.notnull && !col.pk) def += ' NOT NULL';
			if (col.dflt_value !== null) def += ` DEFAULT ${col.dflt_value}`;
			return def;
		})
		.join(',\n\t\t\t');

	// 4. Create new table without role column
	console.log('Creating new users table without role column...');
	db.exec(`
		CREATE TABLE users_new (
			${columnDefs}
		)
	`);

	// 5. Copy data from old table to new (excluding role)
	const columnList = columnsToKeep.join(', ');
	console.log('Copying user data...');
	db.exec(`
		INSERT INTO users_new (${columnList})
		SELECT ${columnList}
		FROM users
	`);

	// 6. Drop old table (this also drops associated indexes)
	console.log('Dropping old users table...');
	db.exec('DROP TABLE users');

	// 7. Rename new table
	console.log('Renaming new table to users...');
	db.exec('ALTER TABLE users_new RENAME TO users');

	// 8. Recreate useful indexes (skip role index since column is gone)
	console.log('Recreating username index...');
	db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');

	// 9. Re-enable foreign keys
	db.exec('PRAGMA foreign_keys = ON');

	// Commit transaction
	db.exec('COMMIT');

	console.log('');
	console.log('Migration completed successfully!');
	console.log('');

	// Verify the migration
	const newTableInfo = db.prepare('PRAGMA table_info(users)').all();
	console.log('New users table columns:');
	newTableInfo.forEach(col => {
		console.log(`  - ${col.name} (${col.type})`);
	});

	const roleStillExists = newTableInfo.find(col => col.name === 'role');
	if (roleStillExists) {
		console.log('');
		console.log('WARNING: Role column still exists. Migration may have failed.');
	} else {
		console.log('');
		console.log('Role column successfully removed.');
	}

	// Verify data integrity
	const newUsers = db.prepare('SELECT * FROM users').all();
	console.log(`Verified ${newUsers.length} user(s) in the migrated table.`);

	console.log('');
	console.log('Next steps:');
	console.log('  1. Restart the admin dashboard: sudo systemctl restart control-center-admin');
	console.log('  2. Verify you can log in and access all features');

} catch (error) {
	// Rollback on error
	db.exec('ROLLBACK');
	console.error('');
	console.error('ERROR: Migration failed!');
	console.error(error.message);
	console.error('');
	console.error('The database has been rolled back to its previous state.');
	db.close();
	process.exit(1);
}

db.close();
