/**
 * Secrets Management Module
 *
 * Provides encrypted storage for sensitive credentials.
 * Uses AES-256-GCM encryption with a separate key file.
 *
 * Storage:
 * - Encrypted secrets: /root/tournament-control-center/.secrets.enc
 * - Encryption key: /root/tournament-control-center/.secrets.key
 *
 * Usage:
 *   const secrets = require('./config/secrets');
 *   const apiKey = secrets.getChallongeApiKey();
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// File paths
const BASE_PATH = path.resolve(__dirname, '../..');
const SECRETS_FILE = path.join(BASE_PATH, '.secrets.enc');
const SECRETS_KEY_FILE = path.join(BASE_PATH, '.secrets.key');

// Encryption settings
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;  // 256 bits
const IV_LENGTH = 16;   // 128 bits
const AUTH_TAG_LENGTH = 16;

// Cache for decrypted secrets
let secretsCache = null;

/**
 * Get or generate the encryption key
 * @returns {Buffer} 32-byte encryption key
 */
function getSecretsKey() {
	// Check environment variable first (for production deployments)
	if (process.env.SECRETS_KEY) {
		return Buffer.from(process.env.SECRETS_KEY, 'hex');
	}

	// Check for existing key file
	if (fs.existsSync(SECRETS_KEY_FILE)) {
		const keyHex = fs.readFileSync(SECRETS_KEY_FILE, 'utf8').trim();
		return Buffer.from(keyHex, 'hex');
	}

	// Generate new key if none exists
	console.log('[Secrets] Generating new encryption key...');
	const key = crypto.randomBytes(KEY_LENGTH);
	fs.writeFileSync(SECRETS_KEY_FILE, key.toString('hex'), { mode: 0o600 });
	console.log(`[Secrets] Key saved to ${SECRETS_KEY_FILE}`);
	return key;
}

/**
 * Encrypt secrets object to file
 * @param {Object} secrets - Object containing secrets
 */
function encryptSecrets(secrets) {
	const key = getSecretsKey();
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

	const plaintext = JSON.stringify(secrets);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, 'utf8'),
		cipher.final()
	]);
	const authTag = cipher.getAuthTag();

	const data = {
		version: 1,
		algorithm: ALGORITHM,
		iv: iv.toString('hex'),
		authTag: authTag.toString('hex'),
		data: encrypted.toString('hex'),
		createdAt: new Date().toISOString()
	};

	fs.writeFileSync(SECRETS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
	console.log(`[Secrets] Encrypted secrets saved to ${SECRETS_FILE}`);

	// Clear cache
	secretsCache = null;
}

/**
 * Decrypt secrets from file
 * @returns {Object} Decrypted secrets object
 */
function decryptSecrets() {
	if (!fs.existsSync(SECRETS_FILE)) {
		return {};
	}

	try {
		const key = getSecretsKey();
		const fileData = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));

		const iv = Buffer.from(fileData.iv, 'hex');
		const authTag = Buffer.from(fileData.authTag, 'hex');
		const encryptedData = Buffer.from(fileData.data, 'hex');

		const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(authTag);

		const decrypted = Buffer.concat([
			decipher.update(encryptedData),
			decipher.final()
		]);

		return JSON.parse(decrypted.toString('utf8'));
	} catch (error) {
		console.error('[Secrets] Failed to decrypt secrets:', error.message);
		return {};
	}
}

/**
 * Get secrets (with caching)
 * @returns {Object} Secrets object
 */
function getSecrets() {
	if (!secretsCache) {
		secretsCache = decryptSecrets();
	}
	return secretsCache;
}

/**
 * Update a specific secret
 * @param {string} key - Secret key
 * @param {*} value - Secret value
 */
function setSecret(key, value) {
	const secrets = getSecrets();
	secrets[key] = value;
	encryptSecrets(secrets);
}

/**
 * Delete a specific secret
 * @param {string} key - Secret key to delete
 */
function deleteSecret(key) {
	const secrets = getSecrets();
	delete secrets[key];
	encryptSecrets(secrets);
}

/**
 * Check if encrypted secrets file exists
 * @returns {boolean}
 */
function hasEncryptedSecrets() {
	return fs.existsSync(SECRETS_FILE);
}

// =============================================================================
// CONVENIENCE GETTERS (with .env fallback)
// =============================================================================

/**
 * Get Challonge API Key
 * Falls back to environment variable if not in encrypted secrets
 */
function getChallongeApiKey() {
	const secrets = getSecrets();
	return secrets.challongeApiKey || process.env.DEFAULT_CHALLONGE_KEY;
}

/**
 * Get Challonge OAuth Client ID
 */
function getChallongeClientId() {
	const secrets = getSecrets();
	return secrets.challongeClientId || process.env.CHALLONGE_CLIENT_ID;
}

/**
 * Get Challonge OAuth Client Secret
 */
function getChallongeClientSecret() {
	const secrets = getSecrets();
	return secrets.challongeClientSecret || process.env.CHALLONGE_CLIENT_SECRET;
}

/**
 * Get Session Secret
 * SECURITY: No hardcoded fallback - requires proper configuration
 */
function getSessionSecret() {
	const secrets = getSecrets();
	const secret = secrets.sessionSecret || process.env.SESSION_SECRET;

	if (!secret) {
		console.error('[SECURITY] CRITICAL: No SESSION_SECRET configured.');
		console.error('[SECURITY] Set SESSION_SECRET environment variable or configure via encrypted secrets.');

		if (process.env.NODE_ENV === 'production') {
			console.error('[SECURITY] Refusing to start in production without SESSION_SECRET.');
			process.exit(1);
		}

		// Generate random secret for development only (not persistent across restarts)
		console.warn('[SECURITY] Generating temporary session secret for development. Sessions will not persist across restarts.');
		return require('crypto').randomBytes(32).toString('hex');
	}

	return secret;
}

/**
 * Get Activity Webhook Token
 * SECURITY: No hardcoded fallback - requires proper configuration
 */
function getActivityWebhookToken() {
	const secrets = getSecrets();
	const token = secrets.activityWebhookToken || process.env.ACTIVITY_WEBHOOK_TOKEN;

	if (!token) {
		console.warn('[SECURITY] No ACTIVITY_WEBHOOK_TOKEN configured. External activity webhook will reject requests.');
		return null; // Will cause webhook auth to fail
	}

	return token;
}

// =============================================================================
// MIGRATION HELPER
// =============================================================================

/**
 * Migrate secrets from environment variables to encrypted storage
 * Call this once to move from .env to encrypted secrets
 */
function migrateFromEnv() {
	console.log('[Secrets] Starting migration from environment variables...');

	const secrets = {};

	// Collect secrets from environment
	if (process.env.DEFAULT_CHALLONGE_KEY) {
		secrets.challongeApiKey = process.env.DEFAULT_CHALLONGE_KEY;
	}
	if (process.env.CHALLONGE_CLIENT_ID) {
		secrets.challongeClientId = process.env.CHALLONGE_CLIENT_ID;
	}
	if (process.env.CHALLONGE_CLIENT_SECRET) {
		secrets.challongeClientSecret = process.env.CHALLONGE_CLIENT_SECRET;
	}
	if (process.env.SESSION_SECRET) {
		secrets.sessionSecret = process.env.SESSION_SECRET;
	}
	if (process.env.ACTIVITY_WEBHOOK_TOKEN) {
		secrets.activityWebhookToken = process.env.ACTIVITY_WEBHOOK_TOKEN;
	}

	if (Object.keys(secrets).length > 0) {
		encryptSecrets(secrets);
		console.log(`[Secrets] Migrated ${Object.keys(secrets).length} secrets to encrypted storage`);
		console.log('[Secrets] You can now remove these values from .env (keep as fallback if desired)');
	} else {
		console.log('[Secrets] No secrets found in environment variables to migrate');
	}

	return secrets;
}

module.exports = {
	// Core functions
	encryptSecrets,
	decryptSecrets,
	getSecrets,
	setSecret,
	deleteSecret,
	hasEncryptedSecrets,

	// Convenience getters
	getChallongeApiKey,
	getChallongeClientId,
	getChallongeClientSecret,
	getSessionSecret,
	getActivityWebhookToken,

	// Migration
	migrateFromEnv,

	// Constants (for CLI tools)
	SECRETS_FILE,
	SECRETS_KEY_FILE
};
