/**
 * Users Database Module
 * Extended user management for multi-tenant SaaS platform
 *
 * Handles: User CRUD, subscription status, role management, superadmin detection
 */

const systemDb = require('./system-db');
const bcrypt = require('bcrypt');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('db:users');

const SALT_ROUNDS = 10;

// Role hierarchy (higher number = more permissions)
const ROLE_HIERARCHY = {
    viewer: 1,
    user: 2,
    admin: 3,
    superadmin: 4
};

/**
 * Get all users with safe fields (no password hashes)
 */
function getAllUsers() {
    const db = systemDb.getDb();
    return db.prepare(`
        SELECT id, username, email, display_name,
               subscription_status, subscription_expires_at, trial_ends_at,
               is_active, activated_at, invite_key_used,
               created_at, updated_at, last_login_at
        FROM users
        ORDER BY created_at DESC
    `).all();
}

/**
 * Get user by ID
 */
function getUserById(id) {
    const db = systemDb.getDb();
    return db.prepare(`
        SELECT id, username, email, display_name, password_hash,
               subscription_status, subscription_expires_at, trial_ends_at,
               is_active, activated_at, invite_key_used,
               created_at, updated_at, last_login_at
        FROM users WHERE id = ?
    `).get(id);
}

/**
 * Get user by username
 */
function getUserByUsername(username) {
    const db = systemDb.getDb();
    return db.prepare(`
        SELECT id, username, email, display_name, password_hash,
               subscription_status, subscription_expires_at, trial_ends_at,
               is_active, activated_at, invite_key_used,
               created_at, updated_at, last_login_at
        FROM users WHERE username = ?
    `).get(username);
}

/**
 * Get user by email
 */
function getUserByEmail(email) {
    const db = systemDb.getDb();
    return db.prepare(`
        SELECT id, username, email, display_name, password_hash,
               subscription_status, subscription_expires_at, trial_ends_at,
               is_active, activated_at, invite_key_used,
               created_at, updated_at, last_login_at
        FROM users WHERE email = ?
    `).get(email);
}

/**
 * Create a new user
 * @param {Object} data - User data
 * @param {string} data.username - Username (required, unique)
 * @param {string} data.email - Email (required, unique)
 * @param {string} data.password - Plain text password (will be hashed)
 * @param {string} data.displayName - Display name
 * @param {string} data.inviteKeyUsed - The invite key that was used
 * @returns {Object} Created user (without password)
 */
async function createUser(data) {
    const db = systemDb.getDb();

    // Validate required fields
    if (!data.username || !data.email || !data.password) {
        throw new Error('Username, email, and password are required');
    }

    // Check for existing username/email
    const existingUsername = getUserByUsername(data.username);
    if (existingUsername) {
        throw new Error('Username already exists');
    }

    const existingEmail = getUserByEmail(data.email);
    if (existingEmail) {
        throw new Error('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // Calculate trial end date (14 days from now)
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const now = new Date().toISOString();

    const result = db.prepare(`
        INSERT INTO users (
            username, email, password_hash, display_name,
            subscription_status, trial_ends_at, is_active, activated_at, invite_key_used,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'trial', ?, 1, ?, ?, ?, ?)
    `).run(
        data.username,
        data.email,
        passwordHash,
        data.displayName || data.username,
        trialEndsAt.toISOString(),
        now,
        data.inviteKeyUsed || null,
        now,
        now
    );

    logger.log('createUser', { username: data.username, id: result.lastInsertRowid });

    return getUserById(result.lastInsertRowid);
}

/**
 * Update user
 * @param {number} id - User ID
 * @param {Object} data - Fields to update
 */
function updateUser(id, data) {
    const db = systemDb.getDb();

    const allowedFields = [
        'username', 'email', 'display_name',
        'subscription_status', 'subscription_expires_at', 'trial_ends_at',
        'is_active'
    ];

    const updates = [];
    const params = [];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            // Convert camelCase to snake_case
            const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
            updates.push(`${dbField} = ?`);
            params.push(data[field]);
        }
    }

    if (updates.length === 0) {
        return getUserById(id);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.prepare(`
        UPDATE users SET ${updates.join(', ')} WHERE id = ?
    `).run(...params);

    logger.log('updateUser', { id, fields: Object.keys(data) });

    return getUserById(id);
}

/**
 * Update user password
 */
async function updatePassword(id, newPassword) {
    const db = systemDb.getDb();
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    db.prepare(`
        UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(passwordHash, id);

    logger.log('updatePassword', { id });
}

/**
 * Verify user password
 */
async function verifyPassword(user, password) {
    if (!user || !user.password_hash) return false;
    return bcrypt.compare(password, user.password_hash);
}

/**
 * Record successful login
 */
function recordLogin(id) {
    const db = systemDb.getDb();
    db.prepare(`
        UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
}

/**
 * Delete user
 */
function deleteUser(id) {
    const db = systemDb.getDb();
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logger.log('deleteUser', { id, deleted: result.changes > 0 });
    return result.changes > 0;
}

/**
 * Check if user is superadmin
 * Since SQLite CHECK constraint doesn't include 'superadmin', we store the
 * superadmin user ID in platform_settings
 */
function isSuperadmin(userId) {
    const db = systemDb.getDb();
    const settings = db.prepare('SELECT feature_flags_json FROM platform_settings WHERE id = 1').get();

    if (!settings || !settings.feature_flags_json) return false;

    try {
        const flags = JSON.parse(settings.feature_flags_json);
        return flags.superadmin_user_id === userId;
    } catch {
        return false;
    }
}

/**
 * Get the superadmin user ID
 */
function getSuperadminId() {
    const db = systemDb.getDb();
    const settings = db.prepare('SELECT feature_flags_json FROM platform_settings WHERE id = 1').get();

    if (!settings || !settings.feature_flags_json) return null;

    try {
        const flags = JSON.parse(settings.feature_flags_json);
        return flags.superadmin_user_id || null;
    } catch {
        return null;
    }
}

/**
 * Get effective role (returns 'superadmin' for userId 1, 'user' for all others)
 * Note: Role column was removed - all authenticated users have full tenant access
 */
function getEffectiveRole(user) {
    if (!user) return null;
    if (isSuperadmin(user.id)) return 'superadmin';
    return 'user';
}

/**
 * Check if user has permission level
 * @param {Object} user - User object
 * @param {string} requiredRole - Minimum required role
 */
function hasPermission(user, requiredRole) {
    const effectiveRole = getEffectiveRole(user);
    if (!effectiveRole) return false;

    const userLevel = ROLE_HIERARCHY[effectiveRole] || 0;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;

    return userLevel >= requiredLevel;
}

/**
 * Get subscription status for user
 */
function getSubscriptionStatus(user) {
    if (!user) return { status: 'unknown', active: false };

    const now = new Date();

    // Check if subscription has expired
    if (user.subscription_status === 'active' && user.subscription_expires_at) {
        const expiresAt = new Date(user.subscription_expires_at);
        if (expiresAt < now) {
            // Update to expired
            updateUser(user.id, { subscription_status: 'expired' });
            return { status: 'expired', active: false, expiredAt: user.subscription_expires_at };
        }
        return {
            status: 'active',
            active: true,
            expiresAt: user.subscription_expires_at,
            daysRemaining: Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24))
        };
    }

    // Check trial status
    if (user.subscription_status === 'trial' && user.trial_ends_at) {
        const trialEnds = new Date(user.trial_ends_at);
        if (trialEnds < now) {
            // Update to expired
            updateUser(user.id, { subscription_status: 'expired' });
            return { status: 'expired', active: false, trialEnded: user.trial_ends_at };
        }
        return {
            status: 'trial',
            active: true,
            trialEndsAt: user.trial_ends_at,
            daysRemaining: Math.ceil((trialEnds - now) / (1000 * 60 * 60 * 24))
        };
    }

    // Superadmin always has active subscription
    if (isSuperadmin(user.id)) {
        return { status: 'active', active: true, reason: 'superadmin' };
    }

    return {
        status: user.subscription_status || 'unknown',
        active: user.subscription_status === 'active'
    };
}

/**
 * Grant subscription to user
 * @param {number} userId - User ID
 * @param {number} days - Number of days to grant
 */
function grantSubscription(userId, days) {
    const db = systemDb.getDb();

    const user = getUserById(userId);
    if (!user) throw new Error('User not found');

    // Calculate new expiry date
    let baseDate = new Date();

    // If user has active subscription, extend from current expiry
    if (user.subscription_status === 'active' && user.subscription_expires_at) {
        const currentExpiry = new Date(user.subscription_expires_at);
        if (currentExpiry > baseDate) {
            baseDate = currentExpiry;
        }
    }

    const expiresAt = new Date(baseDate);
    expiresAt.setDate(expiresAt.getDate() + days);

    db.prepare(`
        UPDATE users SET
            subscription_status = 'active',
            subscription_expires_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(expiresAt.toISOString(), userId);

    logger.log('grantSubscription', { userId, days, expiresAt: expiresAt.toISOString() });

    return getUserById(userId);
}

/**
 * Revoke/suspend subscription
 */
function revokeSubscription(userId, status = 'suspended') {
    const db = systemDb.getDb();

    db.prepare(`
        UPDATE users SET
            subscription_status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(status, userId);

    logger.log('revokeSubscription', { userId, status });

    return getUserById(userId);
}

/**
 * Get user count by status
 */
function getUserStats() {
    const db = systemDb.getDb();

    const stats = db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN subscription_status = 'trial' THEN 1 ELSE 0 END) as trial,
            SUM(CASE WHEN subscription_status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN subscription_status = 'expired' THEN 1 ELSE 0 END) as expired,
            SUM(CASE WHEN subscription_status = 'suspended' THEN 1 ELSE 0 END) as suspended,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as enabled,
            SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as disabled
        FROM users
    `).get();

    return stats;
}

/**
 * Sanitize user object for API response (remove sensitive fields)
 */
function sanitizeUser(user) {
    if (!user) return null;

    const { password_hash, ...safeUser } = user;

    // Add effective role
    safeUser.effectiveRole = getEffectiveRole(user);
    safeUser.isSuperadmin = isSuperadmin(user.id);

    return safeUser;
}

module.exports = {
    // CRUD
    getAllUsers,
    getUserById,
    getUserByUsername,
    getUserByEmail,
    createUser,
    updateUser,
    updatePassword,
    verifyPassword,
    recordLogin,
    deleteUser,

    // Role management
    isSuperadmin,
    getSuperadminId,
    getEffectiveRole,
    hasPermission,
    ROLE_HIERARCHY,

    // Subscription management
    getSubscriptionStatus,
    grantSubscription,
    revokeSubscription,

    // Utils
    getUserStats,
    sanitizeUser
};
