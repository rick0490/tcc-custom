/**
 * Subscription Service
 * Handles subscription status checks, enforcement, and platform settings
 */

const systemDb = require('../db/system-db');
const usersDb = require('../db/users-db');
const { createLogger } = require('./debug-logger');

const logger = createLogger('services:subscription');

/**
 * Get platform settings
 */
function getPlatformSettings() {
    const db = systemDb.getDb();
    const row = db.prepare('SELECT * FROM platform_settings WHERE id = 1').get();

    if (!row) {
        // Initialize with defaults
        db.prepare(`INSERT OR IGNORE INTO platform_settings (id) VALUES (1)`).run();
        return getPlatformSettings();
    }

    return {
        trialDurationDays: row.trial_duration_days,
        allowSignups: !!row.allow_signups,
        requireInviteKey: !!row.require_invite_key,
        maintenanceMode: !!row.maintenance_mode,
        maintenanceMessage: row.maintenance_message,
        featureFlags: safeJsonParse(row.feature_flags_json, {}),
        pricing: safeJsonParse(row.pricing_json, { monthly: 29.99, yearly: 299.99 }),
        updatedAt: row.updated_at
    };
}

/**
 * Update platform settings
 */
function updatePlatformSettings(updates) {
    const db = systemDb.getDb();

    const allowedFields = {
        trialDurationDays: 'trial_duration_days',
        allowSignups: 'allow_signups',
        requireInviteKey: 'require_invite_key',
        maintenanceMode: 'maintenance_mode',
        maintenanceMessage: 'maintenance_message',
        featureFlags: 'feature_flags_json',
        pricing: 'pricing_json'
    };

    const setClauses = [];
    const params = [];

    for (const [key, dbField] of Object.entries(allowedFields)) {
        if (updates[key] !== undefined) {
            let value = updates[key];

            // Convert objects to JSON
            if (typeof value === 'object') {
                value = JSON.stringify(value);
            }

            // Convert booleans to integers
            if (typeof value === 'boolean') {
                value = value ? 1 : 0;
            }

            setClauses.push(`${dbField} = ?`);
            params.push(value);
        }
    }

    if (setClauses.length === 0) {
        return getPlatformSettings();
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');

    db.prepare(`UPDATE platform_settings SET ${setClauses.join(', ')} WHERE id = 1`).run(...params);

    logger.log('updatePlatformSettings', { fields: Object.keys(updates) });

    return getPlatformSettings();
}

/**
 * Check if user has active subscription
 * @param {number} userId - User ID
 * @returns {Object} { hasAccess, reason, status, daysRemaining }
 */
function checkAccess(userId) {
    const user = usersDb.getUserById(userId);

    if (!user) {
        return { hasAccess: false, reason: 'User not found', status: 'unknown' };
    }

    // Superadmin always has access
    if (usersDb.isSuperadmin(userId)) {
        return { hasAccess: true, reason: 'Superadmin', status: 'active' };
    }

    // Check if account is active
    if (!user.is_active) {
        return { hasAccess: false, reason: 'Account disabled', status: 'disabled' };
    }

    const subscriptionStatus = usersDb.getSubscriptionStatus(user);

    return {
        hasAccess: subscriptionStatus.active,
        reason: subscriptionStatus.status,
        status: subscriptionStatus.status,
        daysRemaining: subscriptionStatus.daysRemaining,
        expiresAt: subscriptionStatus.expiresAt || subscriptionStatus.trialEndsAt
    };
}

/**
 * Check if the platform allows new signups
 */
function canSignup() {
    const settings = getPlatformSettings();

    if (settings.maintenanceMode) {
        return { allowed: false, reason: settings.maintenanceMessage || 'Platform is under maintenance' };
    }

    if (!settings.allowSignups) {
        return { allowed: false, reason: 'New registrations are currently closed' };
    }

    return { allowed: true };
}

/**
 * Get subscription plans/pricing
 */
function getPricing() {
    const settings = getPlatformSettings();
    return settings.pricing;
}

/**
 * Check feature flags
 */
function isFeatureEnabled(featureName) {
    const settings = getPlatformSettings();
    return settings.featureFlags[featureName] === true;
}

/**
 * Get expiring subscriptions (for notification purposes)
 * @param {number} daysThreshold - Days before expiration to include
 */
function getExpiringSubscriptions(daysThreshold = 7) {
    const db = systemDb.getDb();

    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    return db.prepare(`
        SELECT id, username, email, subscription_status, subscription_expires_at, trial_ends_at
        FROM users
        WHERE is_active = 1
        AND (
            (subscription_status = 'active' AND subscription_expires_at <= ? AND subscription_expires_at > datetime('now'))
            OR
            (subscription_status = 'trial' AND trial_ends_at <= ? AND trial_ends_at > datetime('now'))
        )
        ORDER BY
            COALESCE(subscription_expires_at, trial_ends_at) ASC
    `).all(thresholdDate.toISOString(), thresholdDate.toISOString());
}

/**
 * Get subscription statistics
 */
function getSubscriptionStats() {
    const userStats = usersDb.getUserStats();
    const settings = getPlatformSettings();

    return {
        users: userStats,
        platform: {
            signupsEnabled: settings.allowSignups,
            inviteKeyRequired: settings.requireInviteKey,
            maintenanceMode: settings.maintenanceMode,
            trialDays: settings.trialDurationDays
        }
    };
}

/**
 * Expire overdue subscriptions
 * This should be run periodically (e.g., daily cron job)
 */
function expireOverdueSubscriptions() {
    const db = systemDb.getDb();
    const now = new Date().toISOString();

    // Expire active subscriptions past their date
    const activeResult = db.prepare(`
        UPDATE users SET subscription_status = 'expired'
        WHERE subscription_status = 'active'
        AND subscription_expires_at IS NOT NULL
        AND subscription_expires_at < ?
    `).run(now);

    // Expire trials past their date
    const trialResult = db.prepare(`
        UPDATE users SET subscription_status = 'expired'
        WHERE subscription_status = 'trial'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at < ?
    `).run(now);

    const totalExpired = activeResult.changes + trialResult.changes;

    if (totalExpired > 0) {
        logger.log('expireOverdueSubscriptions', {
            activeExpired: activeResult.changes,
            trialsExpired: trialResult.changes
        });
    }

    return totalExpired;
}

/**
 * Helper: Safe JSON parse
 */
function safeJsonParse(str, defaultValue) {
    if (!str) return defaultValue;
    try {
        return JSON.parse(str);
    } catch {
        return defaultValue;
    }
}

module.exports = {
    // Platform settings
    getPlatformSettings,
    updatePlatformSettings,

    // Access checks
    checkAccess,
    canSignup,
    isFeatureEnabled,

    // Pricing
    getPricing,

    // Stats and maintenance
    getExpiringSubscriptions,
    getSubscriptionStats,
    expireOverdueSubscriptions
};
