/**
 * Invite Keys Service
 * Manages invite key creation, validation, and usage tracking
 *
 * Key Types:
 * - single: Can only be used once
 * - multi: Can be used multiple times until uses_remaining reaches 0
 * - unlimited: Can be used unlimited times (master keys)
 */

const systemDb = require('../db/system-db');
const crypto = require('crypto');
const { createLogger } = require('./debug-logger');

const logger = createLogger('services:invite-keys');

/**
 * Generate a secure random key code
 * @param {number} length - Length in bytes (will be doubled for hex)
 * @returns {string} Uppercase hex string
 */
function generateKeyCode(length = 16) {
    return crypto.randomBytes(length).toString('hex').toUpperCase();
}

/**
 * Create a new invite key
 * @param {Object} options - Key options
 * @param {string} options.name - Key name/description
 * @param {string} options.keyType - 'single', 'multi', or 'unlimited'
 * @param {number} options.usesAllowed - For 'multi' keys, how many uses allowed
 * @param {Date|string} options.expiresAt - Expiration date (null for never)
 * @param {number} options.createdBy - User ID who created the key
 * @returns {Object} Created key with key_code
 */
function createKey(options = {}) {
    const db = systemDb.getDb();

    const keyCode = generateKeyCode();
    const keyType = options.keyType || 'unlimited';
    const usesRemaining = keyType === 'single' ? 1 :
                         keyType === 'multi' ? (options.usesAllowed || 10) :
                         null; // unlimited

    const expiresAt = options.expiresAt ?
        (typeof options.expiresAt === 'string' ? options.expiresAt : options.expiresAt.toISOString()) :
        null;

    const result = db.prepare(`
        INSERT INTO invite_keys (key_code, name, key_type, uses_remaining, expires_at, is_active, created_by)
        VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(
        keyCode,
        options.name || `Key ${new Date().toLocaleDateString()}`,
        keyType,
        usesRemaining,
        expiresAt,
        options.createdBy || null
    );

    logger.log('createKey', { id: result.lastInsertRowid, keyType, name: options.name });

    return {
        id: result.lastInsertRowid,
        key_code: keyCode,
        name: options.name,
        key_type: keyType,
        uses_remaining: usesRemaining,
        expires_at: expiresAt,
        is_active: 1,
        total_uses: 0,
        created_at: new Date().toISOString()
    };
}

/**
 * Get key by code
 */
function getKeyByCode(keyCode) {
    const db = systemDb.getDb();
    return db.prepare('SELECT * FROM invite_keys WHERE key_code = ?').get(keyCode.toUpperCase());
}

/**
 * Get key by ID
 */
function getKeyById(id) {
    const db = systemDb.getDb();
    return db.prepare('SELECT * FROM invite_keys WHERE id = ?').get(id);
}

/**
 * Get all keys
 */
function getAllKeys() {
    const db = systemDb.getDb();
    return db.prepare(`
        SELECT k.*,
               COUNT(u.id) as actual_uses,
               creator.username as created_by_username
        FROM invite_keys k
        LEFT JOIN invite_key_usage u ON k.id = u.key_id
        LEFT JOIN users creator ON k.created_by = creator.id
        GROUP BY k.id
        ORDER BY k.created_at DESC
    `).all();
}

/**
 * Validate an invite key
 * @param {string} keyCode - The key code to validate
 * @returns {Object} { valid: boolean, error?: string, key?: object }
 */
function validateKey(keyCode) {
    if (!keyCode || typeof keyCode !== 'string') {
        return { valid: false, error: 'Invalid key format' };
    }

    const key = getKeyByCode(keyCode.trim());

    if (!key) {
        logger.warn('validateKey:notFound', { keyCode: keyCode.substring(0, 8) + '...' });
        return { valid: false, error: 'Invalid invite key' };
    }

    // Check if active
    if (!key.is_active) {
        return { valid: false, error: 'This invite key has been deactivated' };
    }

    // Check expiration
    if (key.expires_at) {
        const expiresAt = new Date(key.expires_at);
        if (expiresAt < new Date()) {
            return { valid: false, error: 'This invite key has expired' };
        }
    }

    // Check uses remaining (for single/multi keys)
    if (key.uses_remaining !== null && key.uses_remaining <= 0) {
        return { valid: false, error: 'This invite key has no remaining uses' };
    }

    logger.log('validateKey:valid', { keyId: key.id, keyType: key.key_type });

    return { valid: true, key };
}

/**
 * Record key usage after successful signup
 * @param {number} keyId - Key ID
 * @param {number} userId - User ID who used the key
 * @param {Object} requestInfo - Optional request info (ip, etc.)
 */
function recordUsage(keyId, userId, requestInfo = {}) {
    const db = systemDb.getDb();

    // Insert usage record
    db.prepare(`
        INSERT INTO invite_key_usage (key_id, user_id, ip_address)
        VALUES (?, ?, ?)
    `).run(keyId, userId, requestInfo.ip || null);

    // Update key stats
    db.prepare(`
        UPDATE invite_keys SET
            total_uses = total_uses + 1,
            uses_remaining = CASE
                WHEN uses_remaining IS NOT NULL THEN uses_remaining - 1
                ELSE NULL
            END
        WHERE id = ?
    `).run(keyId);

    logger.log('recordUsage', { keyId, userId });
}

/**
 * Get usage history for a key
 */
function getKeyUsage(keyId) {
    const db = systemDb.getDb();
    return db.prepare(`
        SELECT u.*, user.username, user.email
        FROM invite_key_usage u
        JOIN users user ON u.user_id = user.id
        WHERE u.key_id = ?
        ORDER BY u.used_at DESC
    `).all(keyId);
}

/**
 * Deactivate a key
 */
function deactivateKey(keyId) {
    const db = systemDb.getDb();
    const result = db.prepare('UPDATE invite_keys SET is_active = 0 WHERE id = ?').run(keyId);
    logger.log('deactivateKey', { keyId, success: result.changes > 0 });
    return result.changes > 0;
}

/**
 * Reactivate a key
 */
function reactivateKey(keyId) {
    const db = systemDb.getDb();
    const result = db.prepare('UPDATE invite_keys SET is_active = 1 WHERE id = ?').run(keyId);
    logger.log('reactivateKey', { keyId, success: result.changes > 0 });
    return result.changes > 0;
}

/**
 * Delete a key (and its usage records)
 */
function deleteKey(keyId) {
    const db = systemDb.getDb();

    // Delete usage records first (foreign key)
    db.prepare('DELETE FROM invite_key_usage WHERE key_id = ?').run(keyId);

    const result = db.prepare('DELETE FROM invite_keys WHERE id = ?').run(keyId);
    logger.log('deleteKey', { keyId, success: result.changes > 0 });
    return result.changes > 0;
}

/**
 * Update key details
 */
function updateKey(keyId, updates) {
    const db = systemDb.getDb();

    const allowedFields = ['name', 'expires_at', 'uses_remaining'];
    const setClause = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            setClause.push(`${key} = ?`);
            params.push(value);
        }
    }

    if (setClause.length === 0) return getKeyById(keyId);

    params.push(keyId);

    db.prepare(`UPDATE invite_keys SET ${setClause.join(', ')} WHERE id = ?`).run(...params);

    return getKeyById(keyId);
}

/**
 * Get key statistics
 */
function getKeyStats() {
    const db = systemDb.getDb();

    const stats = db.prepare(`
        SELECT
            COUNT(*) as total_keys,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_keys,
            SUM(CASE WHEN key_type = 'unlimited' THEN 1 ELSE 0 END) as unlimited_keys,
            SUM(CASE WHEN key_type = 'single' THEN 1 ELSE 0 END) as single_keys,
            SUM(CASE WHEN key_type = 'multi' THEN 1 ELSE 0 END) as multi_keys,
            SUM(total_uses) as total_registrations
        FROM invite_keys
    `).get();

    return stats;
}

module.exports = {
    generateKeyCode,
    createKey,
    getKeyByCode,
    getKeyById,
    getAllKeys,
    validateKey,
    recordUsage,
    getKeyUsage,
    deactivateKey,
    reactivateKey,
    deleteKey,
    updateKey,
    getKeyStats
};
