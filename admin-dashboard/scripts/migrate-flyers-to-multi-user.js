#!/usr/bin/env node
/**
 * Migration Script: Flyer Multi-Tenant Support
 *
 * Migrates existing flyers from the legacy shared flyers directory
 * to user-specific locations:
 *   - flyers/{file} -> flyers/{userId}/{file}
 *
 * The legacy files are assumed to belong to userId 1 (ricardo/superadmin)
 *
 * Usage: node scripts/migrate-flyers-to-multi-user.js
 */

const fs = require('fs');
const path = require('path');

// Read FLYERS_PATH from .env or use default
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const FLYERS_PATH = process.env.FLYERS_PATH || '/root/tcc-custom/MagicMirror-flyer/flyers';
const DEFAULT_USER_ID = 1; // ricardo (superadmin) - owner of legacy flyers

// Allowed file extensions for flyers
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.mp4'];

console.log('===========================================');
console.log('Flyer Multi-Tenant Migration');
console.log('===========================================\n');
console.log(`Flyers directory: ${FLYERS_PATH}`);

// Check if flyers directory exists
if (!fs.existsSync(FLYERS_PATH)) {
	console.log('Flyers directory does not exist. Nothing to migrate.');
	process.exit(0);
}

// Check if user directory already exists with files
const userDir = path.join(FLYERS_PATH, String(DEFAULT_USER_ID));
if (fs.existsSync(userDir)) {
	const userFiles = fs.readdirSync(userDir);
	if (userFiles.length > 0) {
		console.log(`User-specific directory already exists with ${userFiles.length} files: flyers/${DEFAULT_USER_ID}/`);
		console.log('Migration may have already been completed.');
		console.log('If you need to re-migrate, move files back to root directory first.');
		process.exit(0);
	}
}

try {
	// Get list of flyer files in root directory
	const entries = fs.readdirSync(FLYERS_PATH, { withFileTypes: true });
	const flyerFiles = entries.filter(entry => {
		if (entry.isDirectory()) return false;
		const ext = path.extname(entry.name).toLowerCase();
		return ALLOWED_EXTENSIONS.includes(ext);
	});

	if (flyerFiles.length === 0) {
		console.log('No flyer files found in root directory. Nothing to migrate.');
		process.exit(0);
	}

	console.log(`Found ${flyerFiles.length} flyer(s) in root directory\n`);

	// Create user-specific directory
	if (!fs.existsSync(userDir)) {
		fs.mkdirSync(userDir, { recursive: true });
		console.log(`Created directory: flyers/${DEFAULT_USER_ID}/`);
	}

	// Move flyer files to user-specific directory
	let movedFiles = 0;
	let errors = 0;

	for (const file of flyerFiles) {
		const oldPath = path.join(FLYERS_PATH, file.name);
		const newPath = path.join(userDir, file.name);

		try {
			fs.renameSync(oldPath, newPath);
			console.log(`  Moved: ${file.name} -> flyers/${DEFAULT_USER_ID}/${file.name}`);
			movedFiles++;
		} catch (error) {
			console.log(`  ERROR: Failed to move ${file.name}: ${error.message}`);
			errors++;
		}
	}

	// Summary
	console.log('\n===========================================');
	console.log('Migration Complete!');
	console.log('===========================================');
	console.log(`  User ID: ${DEFAULT_USER_ID} (ricardo)`);
	console.log(`  Flyers found: ${flyerFiles.length}`);
	console.log(`  Files moved: ${movedFiles}`);
	if (errors > 0) {
		console.log(`  Errors: ${errors} (check messages above)`);
	}
	console.log(`\nFlyers are now stored in user-specific locations:`);
	console.log(`  - Path: flyers/{userId}/{filename}`);

} catch (error) {
	console.error('\nMigration failed:', error.message);
	process.exit(1);
}
