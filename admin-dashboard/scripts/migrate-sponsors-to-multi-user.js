#!/usr/bin/env node
/**
 * Migration Script: Sponsor Multi-Tenant Support
 *
 * Migrates existing sponsors from the legacy shared sponsor-state.json
 * and sponsors/ directory to user-specific locations:
 *   - sponsor-state.json -> sponsor-state-{userId}.json
 *   - sponsors/{file} -> sponsors/{userId}/{file}
 *
 * The legacy file is assumed to belong to userId 1 (ricardo/superadmin)
 *
 * Usage: node scripts/migrate-sponsors-to-multi-user.js
 */

const fs = require('fs');
const path = require('path');

const ADMIN_DIR = path.join(__dirname, '..');
const LEGACY_STATE_FILE = path.join(ADMIN_DIR, 'sponsor-state.json');
const SPONSORS_DIR = path.join(ADMIN_DIR, 'sponsors');
const DEFAULT_USER_ID = 1; // ricardo (superadmin) - owner of legacy sponsors

console.log('===========================================');
console.log('Sponsor Multi-Tenant Migration');
console.log('===========================================\n');

// Check if legacy state file exists
if (!fs.existsSync(LEGACY_STATE_FILE)) {
	console.log('No legacy sponsor-state.json found. Nothing to migrate.');
	process.exit(0);
}

// Check if already migrated
const newStateFile = path.join(ADMIN_DIR, `sponsor-state-${DEFAULT_USER_ID}.json`);
if (fs.existsSync(newStateFile)) {
	console.log(`User-specific state file already exists: sponsor-state-${DEFAULT_USER_ID}.json`);
	console.log('Migration may have already been completed.');
	console.log('If you need to re-migrate, delete the user-specific file first.');
	process.exit(0);
}

try {
	// Read legacy state
	const legacyState = JSON.parse(fs.readFileSync(LEGACY_STATE_FILE, 'utf8'));
	console.log(`Found ${legacyState.sponsors?.length || 0} sponsors in legacy state file`);

	// Create user-specific sponsors directory
	const userSponsorsDir = path.join(SPONSORS_DIR, String(DEFAULT_USER_ID));
	if (!fs.existsSync(userSponsorsDir)) {
		fs.mkdirSync(userSponsorsDir, { recursive: true });
		console.log(`Created directory: sponsors/${DEFAULT_USER_ID}/`);
	}

	// Move sponsor files to user-specific directory
	let movedFiles = 0;
	let missingFiles = 0;

	if (legacyState.sponsors) {
		for (const sponsor of legacyState.sponsors) {
			const oldPath = path.join(SPONSORS_DIR, sponsor.filename);
			const newPath = path.join(userSponsorsDir, sponsor.filename);

			if (fs.existsSync(oldPath)) {
				// Move file to user directory
				fs.renameSync(oldPath, newPath);
				console.log(`  Moved: ${sponsor.filename} -> sponsors/${DEFAULT_USER_ID}/${sponsor.filename}`);
				movedFiles++;
			} else if (fs.existsSync(newPath)) {
				// Already in correct location
				console.log(`  Already exists: sponsors/${DEFAULT_USER_ID}/${sponsor.filename}`);
			} else {
				console.log(`  WARNING: File not found: ${sponsor.filename}`);
				missingFiles++;
			}
		}
	}

	// Save user-specific state file
	fs.writeFileSync(newStateFile, JSON.stringify(legacyState, null, 2));
	console.log(`\nCreated: sponsor-state-${DEFAULT_USER_ID}.json`);

	// Rename legacy file (backup, don't delete)
	const backupFile = path.join(ADMIN_DIR, 'sponsor-state.json.bak');
	fs.renameSync(LEGACY_STATE_FILE, backupFile);
	console.log('Backed up legacy file: sponsor-state.json -> sponsor-state.json.bak');

	// Summary
	console.log('\n===========================================');
	console.log('Migration Complete!');
	console.log('===========================================');
	console.log(`  User ID: ${DEFAULT_USER_ID} (ricardo)`);
	console.log(`  Sponsors migrated: ${legacyState.sponsors?.length || 0}`);
	console.log(`  Files moved: ${movedFiles}`);
	if (missingFiles > 0) {
		console.log(`  Files missing: ${missingFiles} (check warnings above)`);
	}
	console.log(`\nSponsors are now stored in user-specific locations:`);
	console.log(`  - State: sponsor-state-{userId}.json`);
	console.log(`  - Files: sponsors/{userId}/{filename}`);

} catch (error) {
	console.error('\nMigration failed:', error.message);
	process.exit(1);
}
