/**
 * Platform Routes (God Mode)
 *
 * Superadmin-only routes for platform management:
 * - User management across all tenants
 * - Platform settings
 * - Impersonation
 * - Invite key management
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const usersDb = require('../db/users-db');
const db = require('../db');
const inviteKeys = require('../services/invite-keys');
const subscription = require('../services/subscription');
const impersonation = require('../services/impersonation');
const tournamentDb = require('../services/tournament-db');
const participantDb = require('../services/participant-db');
const matchDb = require('../services/match-db');
const { isSuperadmin, requireSuperadmin } = require('../middleware/auth');
const activityLogger = require('../services/activity-logger');
const { createLogger } = require('../services/debug-logger');
const backupScheduler = require('../services/backup-scheduler');

const logger = createLogger('routes:platform');

// Backup directory
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// All routes require superadmin
router.use(requireSuperadmin);

// ============================================
// USER MANAGEMENT
// ============================================

/**
 * GET /api/admin/users
 * List all users (god mode)
 */
router.get('/users', (req, res) => {
    try {
        const users = usersDb.getAllUsers();
        const stats = usersDb.getUserStats();

        res.json({
            success: true,
            users: users.map(u => usersDb.sanitizeUser(u)),
            stats
        });
    } catch (error) {
        logger.error('listUsers', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/users/:id
 * Get user details
 */
router.get('/users/:id', (req, res) => {
    try {
        const user = usersDb.getUserById(parseInt(req.params.id));
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            user: usersDb.sanitizeUser(user)
        });
    } catch (error) {
        logger.error('getUser', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/admin/users/:id/subscription
 * Update user subscription status (manual tracking)
 */
router.put('/users/:id/subscription', (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { status, expiresAt, note } = req.body;

        const user = usersDb.getUserById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Cannot modify superadmin subscription
        if (usersDb.isSuperadmin(userId)) {
            return res.status(400).json({
                success: false,
                error: 'Cannot modify superadmin subscription'
            });
        }

        let updatedUser;
        if (status === 'active') {
            updatedUser = usersDb.grantSubscription(userId, expiresAt);
        } else if (status === 'expired' || status === 'suspended') {
            updatedUser = usersDb.revokeSubscription(userId, status);
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid subscription status'
            });
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'subscription_updated', {
            targetUserId: userId,
            targetUsername: user.username,
            newStatus: status,
            expiresAt,
            note
        });

        logger.log('updateSubscription', {
            targetUserId: userId,
            newStatus: status,
            expiresAt
        });

        res.json({
            success: true,
            user: usersDb.sanitizeUser(updatedUser),
            message: `Subscription ${status === 'active' ? 'granted' : 'revoked'}`
        });
    } catch (error) {
        logger.error('updateSubscription', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/admin/users/:id/status
 * Enable/disable user account
 */
router.put('/users/:id/status', (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { isActive } = req.body;

        const user = usersDb.getUserById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Cannot disable superadmin
        if (usersDb.isSuperadmin(userId)) {
            return res.status(400).json({
                success: false,
                error: 'Cannot disable superadmin account'
            });
        }

        const updatedUser = usersDb.updateUser(userId, { is_active: isActive ? 1 : 0 });

        activityLogger.logActivity(req.session.userId, req.session.username, 'user_status_changed', {
            targetUserId: userId,
            targetUsername: user.username,
            newStatus: isActive ? 'enabled' : 'disabled'
        });

        res.json({
            success: true,
            user: usersDb.sanitizeUser(updatedUser),
            message: `User ${isActive ? 'enabled' : 'disabled'}`
        });
    } catch (error) {
        logger.error('updateUserStatus', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// PLATFORM SETTINGS
// ============================================

/**
 * GET /api/admin/platform-settings
 * Get platform configuration
 */
router.get('/platform-settings', (req, res) => {
    try {
        const settings = subscription.getPlatformSettings();
        const stats = subscription.getSubscriptionStats();

        res.json({
            success: true,
            settings,
            stats
        });
    } catch (error) {
        logger.error('getPlatformSettings', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/admin/platform-settings
 * Update platform configuration
 */
router.put('/platform-settings', (req, res) => {
    try {
        const updates = req.body;

        // Validate allowed fields
        const allowedFields = [
            'trialDurationDays',
            'allowSignups',
            'requireInviteKey',
            'maintenanceMode',
            'maintenanceMessage',
            'featureFlags',
            'pricing'
        ];

        const filteredUpdates = {};
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                filteredUpdates[field] = updates[field];
            }
        }

        const settings = subscription.updatePlatformSettings(filteredUpdates);

        activityLogger.logActivity(req.session.userId, req.session.username, 'platform_settings_updated', {
            fields: Object.keys(filteredUpdates)
        });

        logger.log('updatePlatformSettings', { fields: Object.keys(filteredUpdates) });

        res.json({
            success: true,
            settings,
            message: 'Platform settings updated'
        });
    } catch (error) {
        logger.error('updatePlatformSettings', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// CLAUDE API KEY MANAGEMENT
// ============================================

const secrets = require('../config/secrets');

/**
 * GET /api/admin/claude-api-key
 * Get Claude API key status (masked)
 */
router.get('/claude-api-key', (req, res) => {
    try {
        const apiKey = secrets.getAnthropicApiKey();
        const encryptedSecrets = secrets.getSecrets();

        // Determine source
        let source = 'none';
        if (encryptedSecrets.anthropicApiKey) {
            source = 'encrypted';
        } else if (process.env.ANTHROPIC_API_KEY) {
            source = 'environment';
        }

        res.json({
            success: true,
            configured: !!apiKey,
            maskedKey: apiKey ? `sk-ant-...${apiKey.slice(-4)}` : null,
            source
        });
    } catch (error) {
        logger.error('getClaudeApiKey', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/admin/claude-api-key
 * Save Claude API key to encrypted storage
 */
router.put('/claude-api-key', async (req, res) => {
    try {
        const { apiKey } = req.body;

        // Validate key format (Anthropic keys start with sk-ant-)
        if (apiKey && !apiKey.startsWith('sk-ant-')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid API key format. Anthropic keys start with sk-ant-'
            });
        }

        // Optional: Test the key before saving
        if (apiKey) {
            try {
                const Anthropic = require('@anthropic-ai/sdk');
                const client = new Anthropic({ apiKey });
                // Quick validation - minimal API call
                await client.messages.create({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'test' }]
                });
            } catch (testError) {
                logger.warn('claude-api-key:validation-failed', { error: testError.message });
                return res.status(400).json({
                    success: false,
                    error: 'API key validation failed: ' + (testError.message || 'Unknown error')
                });
            }
        }

        // Save or delete key
        if (apiKey) {
            secrets.setSecret('anthropicApiKey', apiKey);
        } else {
            secrets.deleteSecret('anthropicApiKey');
        }

        // Reset cached Anthropic clients in AI services
        try {
            const aiSeeding = require('../services/ai-seeding');
            const tournamentNarrator = require('../services/tournament-narrator');

            if (typeof aiSeeding.resetClient === 'function') {
                aiSeeding.resetClient();
            }
            if (typeof tournamentNarrator.resetClient === 'function') {
                tournamentNarrator.resetClient();
            }
        } catch (resetError) {
            logger.warn('claude-api-key:reset-clients', { error: resetError.message });
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'claude_api_key_updated', {
            action: apiKey ? 'set' : 'removed'
        });

        logger.log('updateClaudeApiKey', { action: apiKey ? 'set' : 'removed' });

        res.json({
            success: true,
            message: apiKey ? 'Claude API key saved and validated' : 'Claude API key removed',
            configured: !!apiKey
        });
    } catch (error) {
        logger.error('updateClaudeApiKey', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/admin/claude-api-key
 * Remove Claude API key from encrypted storage
 */
router.delete('/claude-api-key', (req, res) => {
    try {
        secrets.deleteSecret('anthropicApiKey');

        // Reset cached Anthropic clients
        try {
            const aiSeeding = require('../services/ai-seeding');
            const tournamentNarrator = require('../services/tournament-narrator');

            if (typeof aiSeeding.resetClient === 'function') {
                aiSeeding.resetClient();
            }
            if (typeof tournamentNarrator.resetClient === 'function') {
                tournamentNarrator.resetClient();
            }
        } catch (resetError) {
            logger.warn('claude-api-key:reset-clients', { error: resetError.message });
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'claude_api_key_updated', {
            action: 'removed'
        });

        logger.log('deleteClaudeApiKey', { action: 'removed' });

        res.json({
            success: true,
            message: 'Claude API key removed'
        });
    } catch (error) {
        logger.error('deleteClaudeApiKey', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// IMPERSONATION
// ============================================

/**
 * POST /api/admin/impersonate/:userId
 * Start impersonating a user
 */
router.post('/impersonate/:userId', (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId);
        const { reason } = req.body;

        const result = impersonation.startImpersonation(
            req.session.userId,
            targetUserId,
            req,
            reason
        );

        if (!result.success) {
            return res.status(400).json(result);
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'impersonation_started', {
            targetUserId,
            targetUsername: result.targetUser.username,
            reason
        });

        res.json(result);
    } catch (error) {
        logger.error('startImpersonation', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/stop-impersonation
 * Stop impersonating
 */
router.post('/stop-impersonation', (req, res) => {
    try {
        const status = impersonation.getImpersonationStatus(req);
        const result = impersonation.stopImpersonation(req);

        if (!result.success) {
            return res.status(400).json(result);
        }

        if (status) {
            activityLogger.logActivity(req.session.userId, req.session.username, 'impersonation_stopped', {
                targetUserId: status.targetUserId,
                targetUsername: status.targetUsername
            });
        }

        res.json(result);
    } catch (error) {
        logger.error('stopImpersonation', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/impersonation-status
 * Get current impersonation status
 */
router.get('/impersonation-status', (req, res) => {
    try {
        const status = impersonation.getImpersonationStatus(req);

        res.json({
            success: true,
            impersonation: status
        });
    } catch (error) {
        logger.error('getImpersonationStatus', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/impersonation-history
 * Get impersonation audit log
 */
router.get('/impersonation-history', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const history = impersonation.getImpersonationHistory({ limit });

        res.json({
            success: true,
            history
        });
    } catch (error) {
        logger.error('getImpersonationHistory', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// INVITE KEYS
// ============================================

/**
 * GET /api/admin/invite-keys
 * List all invite keys
 */
router.get('/invite-keys', (req, res) => {
    try {
        const keys = inviteKeys.getAllKeys();

        res.json({
            success: true,
            keys
        });
    } catch (error) {
        logger.error('listInviteKeys', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/invite-keys
 * Create new invite key
 */
router.post('/invite-keys', (req, res) => {
    try {
        const { name, keyType, usesRemaining, expiresAt } = req.body;

        const key = inviteKeys.createKey({
            name,
            keyType: keyType || 'unlimited',
            usesRemaining: keyType === 'single' ? 1 : (keyType === 'multi' ? usesRemaining : null),
            expiresAt,
            createdBy: req.session.userId
        });

        activityLogger.logActivity(req.session.userId, req.session.username, 'invite_key_created', {
            keyId: key.id,
            keyType: key.key_type,
            name
        });

        res.json({
            success: true,
            key,
            message: 'Invite key created'
        });
    } catch (error) {
        logger.error('createInviteKey', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/admin/invite-keys/:id
 * Deactivate invite key
 */
router.delete('/invite-keys/:id', (req, res) => {
    try {
        const keyId = parseInt(req.params.id);
        const result = inviteKeys.deactivateKey(keyId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'Invite key not found'
            });
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'invite_key_deactivated', {
            keyId
        });

        res.json({
            success: true,
            message: 'Invite key deactivated'
        });
    } catch (error) {
        logger.error('deactivateInviteKey', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/invite-keys/:id/usage
 * Get invite key usage history
 */
router.get('/invite-keys/:id/usage', (req, res) => {
    try {
        const keyId = parseInt(req.params.id);
        const usage = inviteKeys.getKeyUsage(keyId);

        res.json({
            success: true,
            usage
        });
    } catch (error) {
        logger.error('getKeyUsage', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// SUBSCRIPTION MANAGEMENT
// ============================================

/**
 * GET /api/admin/expiring-subscriptions
 * Get subscriptions expiring soon
 */
router.get('/expiring-subscriptions', (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const expiring = subscription.getExpiringSubscriptions(days);

        res.json({
            success: true,
            subscriptions: expiring,
            thresholdDays: days
        });
    } catch (error) {
        logger.error('getExpiringSubscriptions', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/expire-overdue
 * Manually expire overdue subscriptions
 */
router.post('/expire-overdue', (req, res) => {
    try {
        const expired = subscription.expireOverdueSubscriptions();

        res.json({
            success: true,
            expired,
            message: `${expired} subscription(s) expired`
        });
    } catch (error) {
        logger.error('expireOverdue', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/admin/invite-keys/:id/reactivate
 * Reactivate a deactivated invite key
 */
router.put('/invite-keys/:id/reactivate', (req, res) => {
    try {
        const keyId = parseInt(req.params.id);
        const result = inviteKeys.reactivateKey(keyId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'Invite key not found'
            });
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'invite_key_reactivated', {
            keyId
        });

        res.json({
            success: true,
            message: 'Invite key reactivated'
        });
    } catch (error) {
        logger.error('reactivateInviteKey', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// TOURNAMENT BROWSER (God Mode)
// ============================================

/**
 * GET /api/admin/tournaments
 * List all tournaments across all users
 */
router.get('/tournaments', (req, res) => {
    try {
        const { state, game, userId, search, limit = 50, offset = 0 } = req.query;

        // Build filters
        const filters = {};
        if (state) filters.state = state;
        if (game) filters.game_id = parseInt(game);
        if (limit) filters.limit = parseInt(limit);

        // Get all tournaments (null userId = all users)
        let tournaments = tournamentDb.list(filters, userId ? parseInt(userId) : null);

        // Apply search filter
        if (search) {
            const searchLower = search.toLowerCase();
            tournaments = tournaments.filter(t =>
                t.name.toLowerCase().includes(searchLower) ||
                t.url_slug.toLowerCase().includes(searchLower) ||
                (t.game_name && t.game_name.toLowerCase().includes(searchLower))
            );
        }

        // Apply offset (limit is handled in db)
        const total = tournaments.length;
        const paginatedTournaments = tournaments.slice(parseInt(offset));

        // Get owner info for each tournament
        const tournamentsWithOwner = paginatedTournaments.map(t => {
            let owner = null;
            if (t.user_id) {
                const user = usersDb.getUserById(t.user_id);
                if (user) {
                    owner = { id: user.id, username: user.username };
                }
            }
            return { ...t, owner };
        });

        res.json({
            success: true,
            tournaments: tournamentsWithOwner,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: parseInt(offset) + parseInt(limit) < total
            }
        });
    } catch (error) {
        logger.error('listTournaments', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/tournaments/:id/details
 * Get tournament details with participants
 */
router.get('/tournaments/:id/details', (req, res) => {
    try {
        const tournamentId = parseInt(req.params.id);

        const tournament = tournamentDb.getById(tournamentId);
        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Get owner info
        let owner = null;
        if (tournament.user_id) {
            const user = usersDb.getUserById(tournament.user_id);
            if (user) {
                owner = usersDb.sanitizeUser(user);
            }
        }

        // Get participants
        const participants = participantDb.getByTournament(tournamentId);

        // Get match statistics
        const stats = tournamentDb.getStats(tournamentId);

        res.json({
            success: true,
            tournament: { ...tournament, owner },
            participants,
            stats
        });
    } catch (error) {
        logger.error('getTournamentDetails', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/participants/search
 * Search participants across all tournaments
 */
router.get('/participants/search', (req, res) => {
    try {
        const { name, email, limit = 50 } = req.query;

        if (!name && !email) {
            return res.status(400).json({
                success: false,
                error: 'Search term (name or email) required'
            });
        }

        const tDb = db.tournaments.getDb();
        let sql = `
            SELECT p.*, t.name as tournament_name, t.url_slug as tournament_slug
            FROM tcc_participants p
            JOIN tcc_tournaments t ON p.tournament_id = t.id
            WHERE 1=1
        `;
        const params = [];

        if (name) {
            sql += ' AND p.name LIKE ?';
            params.push(`%${name}%`);
        }

        if (email) {
            sql += ' AND p.email LIKE ?';
            params.push(`%${email}%`);
        }

        sql += ' ORDER BY t.created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        const participants = tDb.prepare(sql).all(...params);

        res.json({
            success: true,
            participants,
            total: participants.length
        });
    } catch (error) {
        logger.error('searchParticipants', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// ACTIVITY LOG (Platform-Wide)
// ============================================

/**
 * GET /api/admin/activity-log
 * Get platform-wide activity log
 */
router.get('/activity-log', (req, res) => {
    try {
        const { userId, action, from, to, search, limit = 100, offset = 0 } = req.query;

        let result = activityLogger.getActivityLog({
            limit: parseInt(limit),
            offset: parseInt(offset),
            search
        });

        let logs = result.logs;

        // Filter by userId
        if (userId) {
            const targetUserId = parseInt(userId);
            logs = logs.filter(log => log.userId === targetUserId);
        }

        // Filter by action
        if (action) {
            logs = logs.filter(log => log.action === action);
        }

        // Filter by date range
        if (from) {
            const fromDate = new Date(from);
            logs = logs.filter(log => new Date(log.timestamp) >= fromDate);
        }

        if (to) {
            const toDate = new Date(to);
            logs = logs.filter(log => new Date(log.timestamp) <= toDate);
        }

        res.json({
            success: true,
            activities: logs,
            pagination: {
                total: result.pagination.total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: result.pagination.hasMore
            }
        });
    } catch (error) {
        logger.error('getActivityLog', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/activity-log/export
 * Export activity log as CSV
 */
router.get('/activity-log/export', (req, res) => {
    try {
        const { from, to, format = 'csv' } = req.query;

        const result = activityLogger.getActivityLog({ limit: 10000 });
        let logs = result.logs;

        // Filter by date range
        if (from) {
            const fromDate = new Date(from);
            logs = logs.filter(log => new Date(log.timestamp) >= fromDate);
        }

        if (to) {
            const toDate = new Date(to);
            logs = logs.filter(log => new Date(log.timestamp) <= toDate);
        }

        if (format === 'csv') {
            const csvRows = [
                ['Timestamp', 'User ID', 'Username', 'Action', 'Category', 'Details'].join(',')
            ];

            for (const log of logs) {
                csvRows.push([
                    log.timestamp,
                    log.userId,
                    log.username,
                    log.action,
                    log.category || '',
                    JSON.stringify(log.details || {}).replace(/"/g, '""')
                ].map(v => `"${v}"`).join(','));
            }

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="activity-log-${new Date().toISOString().split('T')[0]}.csv"`);
            res.send(csvRows.join('\n'));
        } else {
            res.json({
                success: true,
                logs,
                exportedAt: new Date().toISOString()
            });
        }
    } catch (error) {
        logger.error('exportActivityLog', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// DATABASE MANAGEMENT
// ============================================

/**
 * GET /api/admin/database/status
 * Get database status and statistics
 */
router.get('/database/status', (req, res) => {
    try {
        const dbPaths = db.getDbPaths();
        const status = db.getStatus();
        const databases = [];

        for (const [name, dbPath] of Object.entries(dbPaths)) {
            const dbInfo = {
                name,
                path: dbPath,
                connected: status[name]?.connected || false
            };

            try {
                const stats = fs.statSync(dbPath);
                dbInfo.size = stats.size;
                dbInfo.lastModified = stats.mtime.toISOString();

                // Get table count
                const connection = db[name].getDb();
                const tables = connection.prepare(`
                    SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'
                `).get();
                dbInfo.tableCount = tables.count;
            } catch (err) {
                dbInfo.error = err.message;
            }

            databases.push(dbInfo);
        }

        res.json({
            success: true,
            databases
        });
    } catch (error) {
        logger.error('getDatabaseStatus', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/database/backup
 * Create database backup
 */
router.post('/database/backup', (req, res) => {
    try {
        const { database = 'all' } = req.body;

        // Ensure backup directory exists
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backups = [];
        const dbPaths = db.getDbPaths();

        const databasesToBackup = database === 'all'
            ? Object.keys(dbPaths)
            : [database];

        for (const dbName of databasesToBackup) {
            if (!dbPaths[dbName]) {
                continue;
            }

            const sourcePath = dbPaths[dbName];
            const backupFilename = `${dbName}-${timestamp}.db`;
            const backupPath = path.join(BACKUP_DIR, backupFilename);

            // Copy database file
            fs.copyFileSync(sourcePath, backupPath);

            const stats = fs.statSync(backupPath);
            backups.push({
                database: dbName,
                filename: backupFilename,
                size: stats.size,
                createdAt: new Date().toISOString()
            });
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'database_backup_created', {
            database,
            files: backups.map(b => b.filename)
        });

        logger.log('createBackup', { database, files: backups.length });

        res.json({
            success: true,
            backups,
            message: `Created ${backups.length} backup(s)`
        });
    } catch (error) {
        logger.error('createBackup', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/database/backups
 * List database backups
 */
router.get('/database/backups', (req, res) => {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            return res.json({
                success: true,
                backups: []
            });
        }

        const files = fs.readdirSync(BACKUP_DIR);
        const backups = files
            .filter(f => f.endsWith('.db'))
            .map(filename => {
                const filePath = path.join(BACKUP_DIR, filename);
                const stats = fs.statSync(filePath);

                // Parse database name from filename (format: dbname-timestamp.db)
                const match = filename.match(/^(.+?)-(\d{4}-\d{2}-\d{2}T.+)\.db$/);
                const dbName = match ? match[1] : 'unknown';

                return {
                    filename,
                    database: dbName,
                    size: stats.size,
                    createdAt: stats.birthtime.toISOString()
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({
            success: true,
            backups
        });
    } catch (error) {
        logger.error('listBackups', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/database/backups/:filename
 * Download backup file
 */
router.get('/database/backups/:filename', (req, res) => {
    try {
        const filename = req.params.filename;

        // Sanitize filename to prevent directory traversal
        if (filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid filename'
            });
        }

        const filePath = path.join(BACKUP_DIR, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'Backup not found'
            });
        }

        res.download(filePath, filename);
    } catch (error) {
        logger.error('downloadBackup', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/admin/database/backups/:filename
 * Delete backup file
 */
router.delete('/database/backups/:filename', (req, res) => {
    try {
        const filename = req.params.filename;

        // Sanitize filename
        if (filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid filename'
            });
        }

        const filePath = path.join(BACKUP_DIR, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'Backup not found'
            });
        }

        fs.unlinkSync(filePath);

        activityLogger.logActivity(req.session.userId, req.session.username, 'database_backup_deleted', {
            filename
        });

        res.json({
            success: true,
            message: 'Backup deleted'
        });
    } catch (error) {
        logger.error('deleteBackup', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/database/clear-cache
 * Clear cache database
 */
router.post('/database/clear-cache', (req, res) => {
    try {
        const cacheDb = db.cache.getDb();

        // Get list of tables
        const tables = cacheDb.prepare(`
            SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `).all();

        let deletedCount = 0;
        for (const table of tables) {
            const result = cacheDb.prepare(`DELETE FROM ${table.name}`).run();
            deletedCount += result.changes;
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'cache_cleared', {
            tables: tables.length,
            rowsDeleted: deletedCount
        });

        res.json({
            success: true,
            tablesCleared: tables.length,
            rowsDeleted: deletedCount,
            message: 'Cache database cleared'
        });
    } catch (error) {
        logger.error('clearCache', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/database/vacuum
 * Vacuum all databases
 */
router.post('/database/vacuum', (req, res) => {
    try {
        const results = [];
        const dbPaths = db.getDbPaths();

        for (const dbName of Object.keys(dbPaths)) {
            try {
                const connection = db[dbName].getDb();

                // Get size before
                const statsBefore = fs.statSync(dbPaths[dbName]);
                const sizeBefore = statsBefore.size;

                // Run vacuum
                connection.exec('VACUUM');

                // Get size after
                const statsAfter = fs.statSync(dbPaths[dbName]);
                const sizeAfter = statsAfter.size;

                results.push({
                    database: dbName,
                    sizeBefore,
                    sizeAfter,
                    saved: sizeBefore - sizeAfter
                });
            } catch (err) {
                results.push({
                    database: dbName,
                    error: err.message
                });
            }
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'database_vacuumed', {
            results
        });

        res.json({
            success: true,
            results,
            message: 'Databases vacuumed'
        });
    } catch (error) {
        logger.error('vacuumDatabases', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// BACKUP SCHEDULER (Phase 2)
// ============================================

/**
 * GET /api/admin/backup-schedules
 * List all backup schedules
 */
router.get('/backup-schedules', (req, res) => {
    try {
        const schedules = backupScheduler.getSchedules();
        const status = backupScheduler.getSchedulerStatus();

        res.json({
            success: true,
            schedules,
            schedulerStatus: status
        });
    } catch (error) {
        logger.error('getBackupSchedules', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/backup-schedules/:id
 * Get backup schedule by ID
 */
router.get('/backup-schedules/:id', (req, res) => {
    try {
        const schedule = backupScheduler.getScheduleById(parseInt(req.params.id));

        if (!schedule) {
            return res.status(404).json({
                success: false,
                error: 'Schedule not found'
            });
        }

        res.json({
            success: true,
            schedule
        });
    } catch (error) {
        logger.error('getBackupSchedule', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/backup-schedules
 * Create new backup schedule
 */
router.post('/backup-schedules', (req, res) => {
    try {
        const { name, database, cronExpression, retentionDays, enabled } = req.body;

        if (!name || !cronExpression) {
            return res.status(400).json({
                success: false,
                error: 'Name and cron expression are required'
            });
        }

        // Validate cron expression
        if (!backupScheduler.validateCronExpression(cronExpression)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid cron expression'
            });
        }

        const result = backupScheduler.createSchedule({
            name,
            database: database || 'all',
            cronExpression,
            retentionDays: retentionDays || 7,
            enabled: enabled !== false,
            createdBy: req.session.userId
        });

        if (!result.success) {
            return res.status(400).json(result);
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'backup_schedule_created', {
            scheduleId: result.schedule.id,
            name,
            cronExpression
        });

        res.json(result);
    } catch (error) {
        logger.error('createBackupSchedule', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/admin/backup-schedules/:id
 * Update backup schedule
 */
router.put('/backup-schedules/:id', (req, res) => {
    try {
        const scheduleId = parseInt(req.params.id);
        const { name, database, cronExpression, retentionDays, enabled } = req.body;

        // Validate cron expression if provided
        if (cronExpression && !backupScheduler.validateCronExpression(cronExpression)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid cron expression'
            });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (database !== undefined) updateData.database = database;
        if (cronExpression !== undefined) updateData.cron_expression = cronExpression;
        if (retentionDays !== undefined) updateData.retention_days = retentionDays;
        if (enabled !== undefined) updateData.enabled = enabled ? 1 : 0;

        const result = backupScheduler.updateSchedule(scheduleId, updateData);

        if (!result.success) {
            return res.status(400).json(result);
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'backup_schedule_updated', {
            scheduleId,
            updates: Object.keys(updateData)
        });

        res.json(result);
    } catch (error) {
        logger.error('updateBackupSchedule', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/admin/backup-schedules/:id
 * Delete backup schedule
 */
router.delete('/backup-schedules/:id', (req, res) => {
    try {
        const scheduleId = parseInt(req.params.id);

        const result = backupScheduler.deleteSchedule(scheduleId);

        if (!result.success) {
            return res.status(400).json(result);
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'backup_schedule_deleted', {
            scheduleId
        });

        res.json(result);
    } catch (error) {
        logger.error('deleteBackupSchedule', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/backup-schedules/:id/run-now
 * Trigger immediate backup for a schedule
 */
router.post('/backup-schedules/:id/run-now', async (req, res) => {
    try {
        const scheduleId = parseInt(req.params.id);

        const result = await backupScheduler.triggerBackupNow(scheduleId, req.session.userId);

        if (!result.success) {
            return res.status(400).json(result);
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'backup_triggered', {
            scheduleId,
            backups: result.backups?.length || 0
        });

        res.json(result);
    } catch (error) {
        logger.error('triggerBackupNow', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/backup-history
 * Get backup history
 */
router.get('/backup-history', (req, res) => {
    try {
        const { scheduleId, status, limit = 50, offset = 0 } = req.query;

        const history = backupScheduler.getHistory({
            scheduleId: scheduleId ? parseInt(scheduleId) : undefined,
            status,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            history
        });
    } catch (error) {
        logger.error('getBackupHistory', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/admin/database/backups/cleanup
 * Cleanup old backup files
 */
router.delete('/database/backups/cleanup', (req, res) => {
    try {
        const { retentionDays = 30 } = req.query;

        const result = backupScheduler.cleanupOldBackups(parseInt(retentionDays));

        activityLogger.logActivity(req.session.userId, req.session.username, 'backups_cleaned_up', {
            retentionDays,
            deletedCount: result.deletedCount,
            freedBytes: result.freedBytes
        });

        res.json({
            success: true,
            ...result,
            message: `Deleted ${result.deletedCount} old backups, freed ${Math.round(result.freedBytes / 1024 / 1024 * 100) / 100} MB`
        });
    } catch (error) {
        logger.error('cleanupBackups', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/backup-schedules/presets
 * Get cron expression presets
 */
router.get('/backup-schedules/presets', (req, res) => {
    try {
        const presets = backupScheduler.getCronPresets();
        res.json({
            success: true,
            presets
        });
    } catch (error) {
        logger.error('getCronPresets', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/backup-schedules/validate-cron
 * Validate a cron expression
 */
router.post('/backup-schedules/validate-cron', (req, res) => {
    try {
        const { expression } = req.body;

        if (!expression) {
            return res.status(400).json({
                success: false,
                error: 'Expression is required'
            });
        }

        const isValid = backupScheduler.validateCronExpression(expression);

        res.json({
            success: true,
            valid: isValid
        });
    } catch (error) {
        logger.error('validateCron', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// ANNOUNCEMENTS
// ============================================

/**
 * GET /api/admin/announcements
 * Get all announcements
 */
router.get('/announcements', (req, res) => {
    try {
        const { activeOnly } = req.query;
        const sysDb = db.system.getDb();

        let sql = 'SELECT * FROM platform_announcements';
        if (activeOnly === 'true') {
            sql += ' WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > datetime("now"))';
        }
        sql += ' ORDER BY created_at DESC';

        const announcements = sysDb.prepare(sql).all();

        res.json({
            success: true,
            announcements
        });
    } catch (error) {
        logger.error('getAnnouncements', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/announcements
 * Create announcement
 */
router.post('/announcements', (req, res) => {
    try {
        const { message, type = 'info', duration, targetUserIds } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }

        const validTypes = ['info', 'warning', 'alert'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid announcement type'
            });
        }

        const sysDb = db.system.getDb();

        // Calculate expiration if duration provided (in hours)
        let expiresAt = null;
        if (duration && duration > 0) {
            const expirationDate = new Date();
            expirationDate.setHours(expirationDate.getHours() + duration);
            expiresAt = expirationDate.toISOString();
        }

        const result = sysDb.prepare(`
            INSERT INTO platform_announcements (message, type, is_active, expires_at, created_by)
            VALUES (?, ?, 1, ?, ?)
        `).run(message.trim(), type, expiresAt, req.session.userId);

        const announcement = sysDb.prepare('SELECT * FROM platform_announcements WHERE id = ?')
            .get(result.lastInsertRowid);

        activityLogger.logActivity(req.session.userId, req.session.username, 'announcement_created', {
            announcementId: announcement.id,
            type
        });

        res.json({
            success: true,
            announcement,
            message: 'Announcement created'
        });
    } catch (error) {
        logger.error('createAnnouncement', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/admin/announcements/:id
 * Update announcement
 */
router.put('/announcements/:id', (req, res) => {
    try {
        const announcementId = parseInt(req.params.id);
        const { message, type, isActive } = req.body;

        const sysDb = db.system.getDb();

        // Check if exists
        const existing = sysDb.prepare('SELECT * FROM platform_announcements WHERE id = ?')
            .get(announcementId);

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: 'Announcement not found'
            });
        }

        const updates = [];
        const params = [];

        if (message !== undefined) {
            updates.push('message = ?');
            params.push(message.trim());
        }

        if (type !== undefined) {
            updates.push('type = ?');
            params.push(type);
        }

        if (isActive !== undefined) {
            updates.push('is_active = ?');
            params.push(isActive ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.json({
                success: true,
                announcement: existing,
                message: 'No changes made'
            });
        }

        params.push(announcementId);

        sysDb.prepare(`UPDATE platform_announcements SET ${updates.join(', ')} WHERE id = ?`)
            .run(...params);

        const announcement = sysDb.prepare('SELECT * FROM platform_announcements WHERE id = ?')
            .get(announcementId);

        res.json({
            success: true,
            announcement,
            message: 'Announcement updated'
        });
    } catch (error) {
        logger.error('updateAnnouncement', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/admin/announcements/:id
 * Delete announcement
 */
router.delete('/announcements/:id', (req, res) => {
    try {
        const announcementId = parseInt(req.params.id);
        const sysDb = db.system.getDb();

        const result = sysDb.prepare('DELETE FROM platform_announcements WHERE id = ?')
            .run(announcementId);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'Announcement not found'
            });
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'announcement_deleted', {
            announcementId
        });

        res.json({
            success: true,
            message: 'Announcement deleted'
        });
    } catch (error) {
        logger.error('deleteAnnouncement', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/announcements/active
 * Get active announcements (for banner display - can be called without superadmin)
 * Note: This is a convenience endpoint; actual banner fetching is in a public route
 */
router.get('/announcements/active', (req, res) => {
    try {
        const sysDb = db.system.getDb();

        const announcements = sysDb.prepare(`
            SELECT id, message, type, created_at, expires_at
            FROM platform_announcements
            WHERE is_active = 1
              AND (expires_at IS NULL OR expires_at > datetime('now'))
            ORDER BY
                CASE type WHEN 'alert' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                created_at DESC
        `).all();

        res.json({
            success: true,
            announcements
        });
    } catch (error) {
        logger.error('getActiveAnnouncements', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// FLYERS MANAGEMENT (Platform-wide)
// ============================================

const FLYERS_PATH = process.env.FLYERS_PATH || path.join(__dirname, '..', 'flyers');

/**
 * Get user-specific flyers directory
 */
function getUserFlyersDir(userId) {
    if (!userId) return FLYERS_PATH;
    return path.join(FLYERS_PATH, String(userId));
}

/**
 * GET /api/admin/flyers
 * List all flyers across all users
 */
router.get('/flyers', async (req, res) => {
    try {
        const allFlyers = [];
        let totalSize = 0;
        const userSet = new Set();

        // Read base flyers directory
        const entries = fs.readdirSync(FLYERS_PATH, { withFileTypes: true });

        // Scan user directories
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const userId = parseInt(entry.name, 10);
                if (!isNaN(userId)) {
                    userSet.add(userId);
                    const userDir = path.join(FLYERS_PATH, entry.name);
                    try {
                        const files = fs.readdirSync(userDir);
                        for (const file of files) {
                            const filePath = path.join(userDir, file);
                            const stats = fs.statSync(filePath);
                            if (stats.isFile()) {
                                const ext = path.extname(file).toLowerCase();
                                const isVideo = ext === '.mp4';
                                allFlyers.push({
                                    filename: file,
                                    ownerId: userId,
                                    size: stats.size,
                                    modified: stats.mtime.toISOString(),
                                    type: isVideo ? 'video' : 'image'
                                });
                                totalSize += stats.size;
                            }
                        }
                    } catch (err) {
                        logger.warn('flyers:scanUserDir', { userId, error: err.message });
                    }
                }
            } else if (entry.isFile()) {
                // Legacy root-level flyers
                const filePath = path.join(FLYERS_PATH, entry.name);
                const stats = fs.statSync(filePath);
                const ext = path.extname(entry.name).toLowerCase();
                if (['.png', '.jpg', '.jpeg', '.mp4'].includes(ext)) {
                    const isVideo = ext === '.mp4';
                    allFlyers.push({
                        filename: entry.name,
                        ownerId: null,
                        isLegacy: true,
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        type: isVideo ? 'video' : 'image'
                    });
                    totalSize += stats.size;
                }
            }
        }

        // Get usernames for owner IDs
        const usersMap = {};
        for (const userId of userSet) {
            const user = usersDb.getUserById(userId);
            if (user) {
                usersMap[userId] = user.username;
            }
        }

        // Sort by modified date (newest first)
        allFlyers.sort((a, b) => new Date(b.modified) - new Date(a.modified));

        res.json({
            success: true,
            flyers: allFlyers,
            users: usersMap,
            stats: {
                totalFlyers: allFlyers.length,
                totalSize,
                userCount: userSet.size
            }
        });
    } catch (error) {
        logger.error('listAllFlyers', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/admin/flyers/:userId/:filename
 * Delete a specific flyer
 */
router.delete('/flyers/:userId/:filename', (req, res) => {
    try {
        const { userId, filename } = req.params;

        // Sanitize filename
        if (filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid filename'
            });
        }

        // Determine path based on userId
        let flyerPath;
        if (userId === 'legacy' || userId === 'null') {
            flyerPath = path.join(FLYERS_PATH, filename);
        } else {
            const userIdNum = parseInt(userId, 10);
            if (isNaN(userIdNum)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid user ID'
                });
            }
            flyerPath = path.join(FLYERS_PATH, String(userIdNum), filename);
        }

        // Check if file exists
        if (!fs.existsSync(flyerPath)) {
            return res.status(404).json({
                success: false,
                error: 'Flyer not found'
            });
        }

        // Delete the file
        fs.unlinkSync(flyerPath);

        activityLogger.logActivity(req.session.userId, req.session.username, 'flyer_deleted_admin', {
            filename,
            ownerId: userId === 'legacy' ? null : parseInt(userId, 10)
        });

        logger.log('deleteFlyer', { filename, userId });

        res.json({
            success: true,
            message: 'Flyer deleted'
        });
    } catch (error) {
        logger.error('deleteFlyer', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// SPONSORS MANAGEMENT (Platform-wide)
// ============================================

const sponsorService = require('../services/sponsor');

/**
 * GET /api/admin/sponsors
 * List all sponsors across all users
 */
router.get('/sponsors', (req, res) => {
    try {
        const allSponsors = [];
        const usersMap = {};
        let totalActive = 0;

        // Load all sponsor states
        const allStates = sponsorService.loadAllSponsorStates();

        for (const { userId, state } of allStates) {
            if (state && state.sponsors) {
                // Get username
                const user = usersDb.getUserById(userId);
                if (user) {
                    usersMap[userId] = user.username;
                }

                // Add sponsors with owner info
                for (const sponsor of state.sponsors) {
                    allSponsors.push({
                        ...sponsor,
                        ownerId: userId
                    });
                    if (sponsor.active) {
                        totalActive++;
                    }
                }
            }
        }

        // Sort by creation date (newest first)
        allSponsors.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        res.json({
            success: true,
            sponsors: allSponsors,
            users: usersMap,
            stats: {
                totalSponsors: allSponsors.length,
                activeSponsors: totalActive,
                userCount: Object.keys(usersMap).length
            }
        });
    } catch (error) {
        logger.error('listAllSponsors', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/admin/sponsors/:userId/:sponsorId
 * Delete a specific sponsor
 */
router.delete('/sponsors/:userId/:sponsorId', (req, res) => {
    try {
        const { userId, sponsorId } = req.params;
        const userIdNum = parseInt(userId, 10);

        if (isNaN(userIdNum)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID'
            });
        }

        // Load user's sponsor state
        const state = sponsorService.loadSponsorState(userIdNum);

        // Find the sponsor
        const sponsorIndex = state.sponsors.findIndex(s => s.id === sponsorId);
        if (sponsorIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Sponsor not found'
            });
        }

        const sponsor = state.sponsors[sponsorIndex];

        // Delete the image file
        const sponsorDir = sponsorService.getUserSponsorsDir(userIdNum);
        const filePath = path.join(sponsorDir, sponsor.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // Remove from state
        state.sponsors.splice(sponsorIndex, 1);
        sponsorService.saveSponsorState(state, userIdNum);

        activityLogger.logActivity(req.session.userId, req.session.username, 'sponsor_deleted_admin', {
            sponsorId,
            sponsorName: sponsor.name,
            ownerId: userIdNum
        });

        logger.log('deleteSponsor', { sponsorId, sponsorName: sponsor.name, userId: userIdNum });

        res.json({
            success: true,
            message: 'Sponsor deleted'
        });
    } catch (error) {
        logger.error('deleteSponsor', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// PHASE 1: GOD MODE ANALYTICS & TOOLS
// ============================================

/**
 * GET /api/admin/platform-stats
 * Cross-tenant platform statistics dashboard
 */
router.get('/platform-stats', (req, res) => {
    try {
        const tournamentsDb = db.tournaments.getDb();
        const playersDb = db.players.getDb();
        const systemDb = db.system.getDb();

        // User metrics
        const users = usersDb.getAllUsers();
        const userStats = usersDb.getUserStats();
        const now = new Date();
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const newThisMonth = users.filter(u => new Date(u.created_at) >= oneMonthAgo).length;
        const newThisWeek = users.filter(u => new Date(u.created_at) >= oneWeekAgo).length;

        // Tournament metrics (live from tournaments.db)
        const liveTournaments = tournamentsDb.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN state = 'complete' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN state = 'underway' THEN 1 ELSE 0 END) as underway,
                SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) as pending
            FROM tcc_tournaments
        `).get();

        // Tournament format distribution
        const formatDistribution = tournamentsDb.prepare(`
            SELECT tournament_type, COUNT(*) as count
            FROM tcc_tournaments
            GROUP BY tournament_type
        `).all();

        const byFormat = {
            single_elimination: 0,
            double_elimination: 0,
            round_robin: 0,
            swiss: 0
        };
        formatDistribution.forEach(row => {
            if (row.tournament_type && byFormat.hasOwnProperty(row.tournament_type)) {
                byFormat[row.tournament_type] = row.count;
            }
        });

        // Average participants per tournament
        const avgParticipants = tournamentsDb.prepare(`
            SELECT AVG(participant_count) as avg FROM (
                SELECT tournament_id, COUNT(*) as participant_count
                FROM tcc_participants
                GROUP BY tournament_id
            )
        `).get();

        // Match metrics (live)
        const matchStats = tournamentsDb.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN state = 'complete' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN winner_id IS NOT NULL AND (player1_score IS NULL OR player1_score = 0) AND (player2_score IS NULL OR player2_score = 0) THEN 1 ELSE 0 END) as forfeits
            FROM tcc_matches
        `).get();

        // Average match duration (only completed with underway_at)
        const avgDuration = tournamentsDb.prepare(`
            SELECT AVG(
                (julianday(completed_at) - julianday(underway_at)) * 24 * 60
            ) as avg_minutes
            FROM tcc_matches
            WHERE state = 'complete' AND underway_at IS NOT NULL
        `).get();

        // Player metrics (from players.db)
        let playerStats = { total: 0, activeLastMonth: 0, newThisMonth: 0, averageElo: 1200 };
        let topPlayers = [];
        try {
            const totalPlayers = playersDb.prepare('SELECT COUNT(*) as count FROM players').get();
            playerStats.total = totalPlayers?.count || 0;

            const activePlayers = playersDb.prepare(`
                SELECT COUNT(DISTINCT player_id) as count
                FROM player_ratings
                WHERE last_active >= date('now', '-30 days')
            `).get();
            playerStats.activeLastMonth = activePlayers?.count || 0;

            const newPlayers = playersDb.prepare(`
                SELECT COUNT(*) as count FROM players
                WHERE created_at >= date('now', '-30 days')
            `).get();
            playerStats.newThisMonth = newPlayers?.count || 0;

            const avgElo = playersDb.prepare('SELECT AVG(elo_rating) as avg FROM player_ratings').get();
            playerStats.averageElo = Math.round(avgElo?.avg || 1200);

            // Top players by Elo
            topPlayers = playersDb.prepare(`
                SELECT p.display_name as name, pr.elo_rating as elo, pr.game_id as gameId
                FROM players p
                JOIN player_ratings pr ON p.id = pr.player_id
                ORDER BY pr.elo_rating DESC
                LIMIT 10
            `).all();
        } catch (e) {
            logger.warn('platform-stats:players', { error: e.message });
        }

        // Game metrics
        let gameStats = { total: 0, mostPopular: [] };
        try {
            const games = systemDb.prepare('SELECT COUNT(*) as count FROM games').get();
            gameStats.total = games?.count || 0;

            // Most popular games by tournament count
            const popularGames = tournamentsDb.prepare(`
                SELECT game_id, COUNT(*) as tournament_count
                FROM tcc_tournaments
                WHERE game_id IS NOT NULL
                GROUP BY game_id
                ORDER BY tournament_count DESC
                LIMIT 5
            `).all();

            // Get game names
            for (const game of popularGames) {
                if (game.game_id) {
                    const gameInfo = systemDb.prepare('SELECT name FROM games WHERE id = ?').get(game.game_id);
                    gameStats.mostPopular.push({
                        name: gameInfo?.name || `Game ${game.game_id}`,
                        tournamentCount: game.tournament_count
                    });
                }
            }
        } catch (e) {
            logger.warn('platform-stats:games', { error: e.message });
        }

        // Display metrics
        let displayStats = { total: 0, online: 0, offline: 0, byType: { match: 0, bracket: 0, flyer: 0 } };
        try {
            const displays = systemDb.prepare('SELECT * FROM displays').all();
            displayStats.total = displays.length;
            const now = Date.now();
            displays.forEach(d => {
                const lastHeartbeat = new Date(d.last_heartbeat).getTime();
                const isOnline = (now - lastHeartbeat) < 5 * 60 * 1000; // 5 min threshold
                if (isOnline) displayStats.online++;
                else displayStats.offline++;

                const view = d.current_view || 'match';
                if (displayStats.byType.hasOwnProperty(view)) {
                    displayStats.byType[view]++;
                }
            });
        } catch (e) {
            logger.warn('platform-stats:displays', { error: e.message });
        }

        // Time-based trends (last 30 days)
        let trends = { tournamentsPerDay: [], matchesPerDay: [], newPlayersPerDay: [] };
        try {
            // Tournaments created per day
            const tournamentTrends = tournamentsDb.prepare(`
                SELECT date(created_at) as day, COUNT(*) as count
                FROM tcc_tournaments
                WHERE created_at >= date('now', '-30 days')
                GROUP BY date(created_at)
                ORDER BY day
            `).all();
            trends.tournamentsPerDay = tournamentTrends.map(t => ({ day: t.day, count: t.count }));

            // Matches completed per day
            const matchTrends = tournamentsDb.prepare(`
                SELECT date(completed_at) as day, COUNT(*) as count
                FROM tcc_matches
                WHERE completed_at >= date('now', '-30 days') AND state = 'complete'
                GROUP BY date(completed_at)
                ORDER BY day
            `).all();
            trends.matchesPerDay = matchTrends.map(m => ({ day: m.day, count: m.count }));

            // New players per day
            const playerTrends = playersDb.prepare(`
                SELECT date(created_at) as day, COUNT(*) as count
                FROM players
                WHERE created_at >= date('now', '-30 days')
                GROUP BY date(created_at)
                ORDER BY day
            `).all();
            trends.newPlayersPerDay = playerTrends.map(p => ({ day: p.day, count: p.count }));
        } catch (e) {
            logger.warn('platform-stats:trends', { error: e.message });
        }

        res.json({
            success: true,
            stats: {
                users: {
                    total: userStats.total || users.length,
                    active: userStats.active || 0,
                    trial: userStats.trial || 0,
                    expired: userStats.expired || 0,
                    newThisMonth,
                    newThisWeek
                },
                tournaments: {
                    total: liveTournaments?.total || 0,
                    completed: liveTournaments?.completed || 0,
                    underway: liveTournaments?.underway || 0,
                    pending: liveTournaments?.pending || 0,
                    byFormat,
                    averageParticipants: Math.round(avgParticipants?.avg || 0),
                    completionRate: liveTournaments?.total > 0
                        ? Math.round((liveTournaments.completed / liveTournaments.total) * 100)
                        : 0
                },
                matches: {
                    total: matchStats?.total || 0,
                    completed: matchStats?.completed || 0,
                    forfeits: matchStats?.forfeits || 0,
                    averageDuration: Math.round(avgDuration?.avg_minutes || 0),
                    completionRate: matchStats?.total > 0
                        ? Math.round((matchStats.completed / matchStats.total) * 100)
                        : 0
                },
                players: playerStats,
                topPlayers,
                games: gameStats,
                displays: displayStats,
                trends
            }
        });
    } catch (error) {
        logger.error('platform-stats', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/users/:id/profile
 * Comprehensive user profile with all data for deep dive
 */
router.get('/users/:id/profile', (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        if (isNaN(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }

        const user = usersDb.getUserById(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const tournamentsDb = db.tournaments.getDb();
        const systemDb = db.system.getDb();

        // Tournament statistics (Note: tournaments.db doesn't have user_id, so we count all for now)
        // In a full multi-tenant setup, tournaments would have user_id
        let tournamentStats = { created: 0, completed: 0, totalParticipants: 0, totalMatches: 0 };
        try {
            // If tournaments have user_id (future), filter by it
            const tournamentCount = tournamentsDb.prepare('SELECT COUNT(*) as count FROM tcc_tournaments').get();
            const completedCount = tournamentsDb.prepare(`SELECT COUNT(*) as count FROM tcc_tournaments WHERE state = 'complete'`).get();
            tournamentStats.created = tournamentCount?.count || 0;
            tournamentStats.completed = completedCount?.count || 0;

            const participantCount = tournamentsDb.prepare('SELECT COUNT(*) as count FROM tcc_participants').get();
            tournamentStats.totalParticipants = participantCount?.count || 0;

            const matchCount = tournamentsDb.prepare('SELECT COUNT(*) as count FROM tcc_matches').get();
            tournamentStats.totalMatches = matchCount?.count || 0;
        } catch (e) {
            logger.warn('user-profile:tournaments', { error: e.message });
        }

        // Games configured (games table has user_id)
        let gamesConfigured = 0;
        try {
            const games = systemDb.prepare('SELECT COUNT(*) as count FROM games WHERE user_id = ?').get(userId);
            gamesConfigured = games?.count || 0;
        } catch (e) {
            logger.warn('user-profile:games', { error: e.message });
        }

        // Flyers uploaded
        let flyerStats = { count: 0, totalSize: 0 };
        try {
            const flyersPath = path.join(__dirname, '..', 'flyers', String(userId));
            if (fs.existsSync(flyersPath)) {
                const files = fs.readdirSync(flyersPath);
                flyerStats.count = files.length;
                files.forEach(file => {
                    const stat = fs.statSync(path.join(flyersPath, file));
                    flyerStats.totalSize += stat.size;
                });
            }
        } catch (e) {
            logger.warn('user-profile:flyers', { error: e.message });
        }

        // Sponsors configured
        let sponsorsConfigured = 0;
        try {
            const sponsorDir = path.join(__dirname, '..', 'sponsors', String(userId));
            const stateFile = path.join(sponsorDir, 'sponsor-state.json');
            if (fs.existsSync(stateFile)) {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                sponsorsConfigured = state.sponsors?.length || 0;
            }
        } catch (e) {
            logger.warn('user-profile:sponsors', { error: e.message });
        }

        // Displays registered (displays table has user_id)
        let displaysRegistered = 0;
        try {
            const displays = systemDb.prepare('SELECT COUNT(*) as count FROM displays WHERE user_id = ?').get(userId);
            displaysRegistered = displays?.count || 0;
        } catch (e) {
            logger.warn('user-profile:displays', { error: e.message });
        }

        // Recent tournaments (last 10)
        let recentTournaments = [];
        try {
            recentTournaments = tournamentsDb.prepare(`
                SELECT id, name, state, created_at,
                    (SELECT COUNT(*) FROM tcc_participants WHERE tournament_id = tcc_tournaments.id) as participantCount
                FROM tcc_tournaments
                ORDER BY created_at DESC
                LIMIT 10
            `).all();
        } catch (e) {
            logger.warn('user-profile:recent-tournaments', { error: e.message });
        }

        // Activity summary (from activity log)
        let activitySummary = { lastWeek: 0, lastMonth: 0, mostActiveDay: null };
        try {
            const activityLogPath = path.join(__dirname, '..', 'activity-log.json');
            if (fs.existsSync(activityLogPath)) {
                const activityData = JSON.parse(fs.readFileSync(activityLogPath, 'utf8'));
                const entries = activityData.entries || [];
                const now = Date.now();
                const oneWeek = 7 * 24 * 60 * 60 * 1000;
                const oneMonth = 30 * 24 * 60 * 60 * 1000;

                const userEntries = entries.filter(e => e.userId === userId);
                activitySummary.lastWeek = userEntries.filter(e => now - new Date(e.timestamp).getTime() < oneWeek).length;
                activitySummary.lastMonth = userEntries.filter(e => now - new Date(e.timestamp).getTime() < oneMonth).length;

                // Find most active day
                const dayCounts = {};
                userEntries.forEach(e => {
                    const day = new Date(e.timestamp).toLocaleDateString('en-US', { weekday: 'long' });
                    dayCounts[day] = (dayCounts[day] || 0) + 1;
                });
                const maxDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
                activitySummary.mostActiveDay = maxDay ? maxDay[0] : null;
            }
        } catch (e) {
            logger.warn('user-profile:activity', { error: e.message });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                subscriptionTier: user.subscription_tier,
                trialEndsAt: user.trial_ends_at,
                createdAt: user.created_at,
                lastLogin: user.last_login,
                stats: {
                    tournamentsCreated: tournamentStats.created,
                    tournamentsCompleted: tournamentStats.completed,
                    totalParticipants: tournamentStats.totalParticipants,
                    totalMatches: tournamentStats.totalMatches,
                    gamesConfigured,
                    flyersUploaded: flyerStats.count,
                    sponsorsConfigured,
                    displaysRegistered
                },
                recentTournaments,
                storage: {
                    flyersSize: flyerStats.totalSize,
                    flyerCount: flyerStats.count
                },
                activitySummary
            }
        });
    } catch (error) {
        logger.error('user-profile', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/query
 * Execute read-only SQL queries (database query playground)
 */
router.post('/query', (req, res) => {
    try {
        const { database, query } = req.body;

        if (!database || !query) {
            return res.status(400).json({
                success: false,
                error: 'Database and query are required'
            });
        }

        // Validate database name
        const validDatabases = ['tournaments', 'players', 'system', 'cache'];
        if (!validDatabases.includes(database)) {
            return res.status(400).json({
                success: false,
                error: `Invalid database. Must be one of: ${validDatabases.join(', ')}`
            });
        }

        // Security: Only allow SELECT statements
        const normalizedQuery = query.trim().toLowerCase();
        const blockedKeywords = ['drop', 'delete', 'update', 'insert', 'alter', 'create', 'truncate', 'replace', 'grant', 'revoke'];

        if (!normalizedQuery.startsWith('select')) {
            return res.status(400).json({
                success: false,
                error: 'Only SELECT queries are allowed'
            });
        }

        for (const keyword of blockedKeywords) {
            if (normalizedQuery.includes(keyword)) {
                return res.status(400).json({
                    success: false,
                    error: `Blocked keyword detected: ${keyword.toUpperCase()}`
                });
            }
        }

        // Get the appropriate database connection
        let dbConnection;
        switch (database) {
            case 'tournaments':
                dbConnection = db.tournaments.getDb();
                break;
            case 'players':
                dbConnection = db.players.getDb();
                break;
            case 'system':
                dbConnection = db.system.getDb();
                break;
            case 'cache':
                dbConnection = db.cache.getDb();
                break;
        }

        // Execute query with timeout
        const startTime = Date.now();
        let results = [];
        let columns = [];

        try {
            // Limit results to 1000 rows
            const limitedQuery = query.trim().replace(/;?\s*$/, '') + ' LIMIT 1000';
            const stmt = dbConnection.prepare(limitedQuery);
            results = stmt.all();

            if (results.length > 0) {
                columns = Object.keys(results[0]);
            }
        } catch (queryError) {
            return res.status(400).json({
                success: false,
                error: `Query error: ${queryError.message}`
            });
        }

        const executionTime = Date.now() - startTime;

        // Log the query for audit
        activityLogger.logActivity(req.session.userId, req.session.username, 'query_executed', {
            database,
            query: query.substring(0, 500), // Truncate long queries
            rowCount: results.length,
            executionTime
        });

        logger.log('query-playground', { database, rowCount: results.length, executionTime });

        res.json({
            success: true,
            results,
            columns,
            rowCount: results.length,
            executionTime
        });
    } catch (error) {
        logger.error('query-playground', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/live-feed
 * Get real-time activity feed (last 100 events)
 */
router.get('/live-feed', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const eventType = req.query.type; // Optional filter

        // Load activity from log file
        const activityLogPath = path.join(__dirname, '..', 'activity-log.json');
        let entries = [];

        if (fs.existsSync(activityLogPath)) {
            const activityData = JSON.parse(fs.readFileSync(activityLogPath, 'utf8'));
            entries = activityData.entries || [];
        }

        // Sort by timestamp (newest first)
        entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Filter by event type if specified
        if (eventType) {
            entries = entries.filter(e => e.action && e.action.startsWith(eventType));
        }

        // Limit results
        entries = entries.slice(0, limit);

        // Transform for feed display
        const feed = entries.map(entry => ({
            type: entry.action,
            user: entry.username,
            userId: entry.userId,
            timestamp: entry.timestamp,
            details: entry.details || {},
            // Extract relevant info based on action type
            tournament: entry.details?.tournamentName || entry.details?.tournament,
            player: entry.details?.playerName || entry.details?.participant,
            match: entry.details?.matchId ? `Match ${entry.details.matchId}` : null
        }));

        res.json({
            success: true,
            feed,
            total: feed.length
        });
    } catch (error) {
        logger.error('live-feed', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/table-schemas
 * Get table schemas for all databases (for query playground reference)
 */
router.get('/table-schemas', (req, res) => {
    try {
        const schemas = {};

        // Get schema for each database
        const databases = {
            tournaments: db.tournaments.getDb(),
            players: db.players.getDb(),
            system: db.system.getDb(),
            cache: db.cache.getDb()
        };

        for (const [dbName, dbConn] of Object.entries(databases)) {
            try {
                // Get all tables
                const tables = dbConn.prepare(`
                    SELECT name FROM sqlite_master
                    WHERE type='table' AND name NOT LIKE 'sqlite_%'
                    ORDER BY name
                `).all();

                schemas[dbName] = {};

                for (const table of tables) {
                    // Get column info for each table
                    const columns = dbConn.prepare(`PRAGMA table_info("${table.name}")`).all();
                    schemas[dbName][table.name] = columns.map(col => ({
                        name: col.name,
                        type: col.type,
                        nullable: col.notnull === 0,
                        primaryKey: col.pk === 1,
                        defaultValue: col.dflt_value
                    }));
                }
            } catch (e) {
                schemas[dbName] = { error: e.message };
            }
        }

        res.json({
            success: true,
            schemas
        });
    } catch (error) {
        logger.error('table-schemas', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// PHASE 2: PERFORMANCE MONITORING
// ============================================

// Import metrics aggregator (lazy load to avoid circular deps)
let metricsAggregator = null;
function getMetricsAggregator() {
    if (!metricsAggregator) {
        metricsAggregator = require('../services/metrics-aggregator');
    }
    return metricsAggregator;
}

/**
 * GET /api/admin/metrics/status
 * Get metrics collection status
 */
router.get('/metrics/status', (req, res) => {
    try {
        const aggregator = getMetricsAggregator();
        const status = aggregator.getCollectionStatus();

        res.json({
            success: true,
            status
        });
    } catch (error) {
        logger.error('metrics:status', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/metrics/start
 * Start metrics collection
 */
router.post('/metrics/start', (req, res) => {
    try {
        const aggregator = getMetricsAggregator();
        const result = aggregator.startMetricsCollection();

        if (result.success) {
            activityLogger.logActivity(req.session.userId, req.session.username, 'metrics_collection_started', {});
        }

        res.json(result);
    } catch (error) {
        logger.error('metrics:start', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/metrics/stop
 * Stop metrics collection
 */
router.post('/metrics/stop', (req, res) => {
    try {
        const aggregator = getMetricsAggregator();
        const result = aggregator.stopMetricsCollection();

        if (result.success) {
            activityLogger.logActivity(req.session.userId, req.session.username, 'metrics_collection_stopped', {
                totalCollections: result.totalCollections
            });
        }

        res.json(result);
    } catch (error) {
        logger.error('metrics:stop', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/metrics/current
 * Get current metrics snapshot
 */
router.get('/metrics/current', async (req, res) => {
    try {
        const aggregator = getMetricsAggregator();
        const snapshot = await aggregator.getCurrentSnapshot();

        res.json({
            success: true,
            snapshot
        });
    } catch (error) {
        logger.error('metrics:current', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/metrics/history
 * Get historical metrics for charts
 */
router.get('/metrics/history', (req, res) => {
    try {
        const { type, hours = 24 } = req.query;

        if (!type) {
            return res.status(400).json({
                success: false,
                error: 'Metric type is required'
            });
        }

        const aggregator = getMetricsAggregator();
        const history = aggregator.getMetricsHistory(type, parseInt(hours));

        res.json({
            success: true,
            type,
            hours: parseInt(hours),
            dataPoints: history.length,
            history
        });
    } catch (error) {
        logger.error('metrics:history', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/metrics/latest
 * Get latest metrics for all types
 */
router.get('/metrics/latest', (req, res) => {
    try {
        const aggregator = getMetricsAggregator();
        const latest = aggregator.getLatestMetrics();

        res.json({
            success: true,
            metrics: latest
        });
    } catch (error) {
        logger.error('metrics:latest', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/metrics/cleanup
 * Clean up old metrics data
 */
router.post('/metrics/cleanup', (req, res) => {
    try {
        const aggregator = getMetricsAggregator();
        const result = aggregator.cleanupOldMetrics();

        if (result.success) {
            activityLogger.logActivity(req.session.userId, req.session.username, 'metrics_cleanup', {
                deletedCount: result.deletedCount
            });
        }

        res.json(result);
    } catch (error) {
        logger.error('metrics:cleanup', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// PHASE 2: ALERTS
// ============================================

/**
 * GET /api/admin/alerts
 * Get active alerts
 */
router.get('/alerts', (req, res) => {
    try {
        const aggregator = getMetricsAggregator();
        const alerts = aggregator.getActiveAlerts();

        res.json({
            success: true,
            alerts
        });
    } catch (error) {
        logger.error('alerts:list', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/alerts/history
 * Get alert history
 */
router.get('/alerts/history', (req, res) => {
    try {
        const { limit = 100, offset = 0, severity } = req.query;

        const aggregator = getMetricsAggregator();
        const history = aggregator.getAlertHistory({
            limit: parseInt(limit),
            offset: parseInt(offset),
            severity
        });

        res.json({
            success: true,
            alerts: history,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        logger.error('alerts:history', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/alerts/:id/acknowledge
 * Acknowledge an alert
 */
router.post('/alerts/:id/acknowledge', (req, res) => {
    try {
        const alertId = parseInt(req.params.id);

        const aggregator = getMetricsAggregator();
        const result = aggregator.acknowledgeAlert(alertId, req.session.userId);

        if (result.success) {
            activityLogger.logActivity(req.session.userId, req.session.username, 'alert_acknowledged', {
                alertId
            });
        }

        res.json(result);
    } catch (error) {
        logger.error('alerts:acknowledge', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/alert-thresholds
 * Get alert thresholds
 */
router.get('/alert-thresholds', (req, res) => {
    try {
        const aggregator = getMetricsAggregator();
        const thresholds = aggregator.getAlertThresholds();

        res.json({
            success: true,
            thresholds
        });
    } catch (error) {
        logger.error('alert-thresholds:get', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/admin/alert-thresholds/:metricType
 * Update alert threshold
 */
router.put('/alert-thresholds/:metricType', (req, res) => {
    try {
        const { metricType } = req.params;
        const { warningThreshold, criticalThreshold, enabled } = req.body;

        const aggregator = getMetricsAggregator();
        const result = aggregator.updateAlertThreshold(metricType, {
            warningThreshold,
            criticalThreshold,
            enabled
        });

        if (result.success) {
            activityLogger.logActivity(req.session.userId, req.session.username, 'alert_threshold_updated', {
                metricType,
                warningThreshold,
                criticalThreshold,
                enabled
            });
        }

        res.json(result);
    } catch (error) {
        logger.error('alert-thresholds:update', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// PHASE 2: DISPLAY FLEET MANAGEMENT
// ============================================

/**
 * GET /api/admin/displays
 * Get all displays across all tenants
 */
router.get('/displays', (req, res) => {
    try {
        const { status, type, userId } = req.query;
        const systemDb = db.system.getDb();

        let sql = `
            SELECT d.*, u.username as owner_username
            FROM displays d
            LEFT JOIN users u ON d.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (userId) {
            sql += ' AND d.user_id = ?';
            params.push(parseInt(userId));
        }

        if (type) {
            sql += ' AND d.current_view = ?';
            params.push(type);
        }

        sql += ' ORDER BY d.last_heartbeat DESC';

        const displays = systemDb.prepare(sql).all(...params);

        // Calculate online/offline status
        const now = Date.now();
        const processedDisplays = displays.map(d => {
            const lastHeartbeat = new Date(d.last_heartbeat).getTime();
            const isOnline = (now - lastHeartbeat) < 90000; // 90 seconds
            return {
                ...d,
                status: isOnline ? 'online' : 'offline',
                timeSinceHeartbeat: now - lastHeartbeat
            };
        });

        // Filter by status if specified
        let filteredDisplays = processedDisplays;
        if (status) {
            filteredDisplays = processedDisplays.filter(d => d.status === status);
        }

        // Calculate stats
        const stats = {
            total: displays.length,
            online: processedDisplays.filter(d => d.status === 'online').length,
            offline: processedDisplays.filter(d => d.status === 'offline').length,
            byType: {
                match: processedDisplays.filter(d => d.current_view === 'match').length,
                bracket: processedDisplays.filter(d => d.current_view === 'bracket').length,
                flyer: processedDisplays.filter(d => d.current_view === 'flyer').length
            }
        };

        res.json({
            success: true,
            displays: filteredDisplays,
            stats
        });
    } catch (error) {
        logger.error('displays:list', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/displays/:id/command
 * Issue command to a display
 */
router.post('/displays/:id/command', (req, res) => {
    try {
        const displayId = req.params.id;
        const { command } = req.body;

        const validCommands = ['reboot', 'shutdown', 'refresh', 'debug_on', 'debug_off'];
        if (!validCommands.includes(command)) {
            return res.status(400).json({
                success: false,
                error: `Invalid command. Must be one of: ${validCommands.join(', ')}`
            });
        }

        const systemDb = db.system.getDb();

        // Find the display
        const display = systemDb.prepare('SELECT * FROM displays WHERE id = ?').get(displayId);
        if (!display) {
            return res.status(404).json({
                success: false,
                error: 'Display not found'
            });
        }

        // Record the command
        systemDb.recordDisplayCommand({
            displayId,
            userId: display.user_id,
            command,
            issuedBy: req.session.userId
        });

        // Update displays.json with pending command (for backward compatibility)
        try {
            const displaysFile = path.join(__dirname, '..', 'displays.json');
            if (fs.existsSync(displaysFile)) {
                const displaysData = JSON.parse(fs.readFileSync(displaysFile, 'utf8'));
                const displayIndex = displaysData.displays.findIndex(d => d.id === displayId);
                if (displayIndex !== -1) {
                    displaysData.displays[displayIndex].pendingCommand = {
                        action: command,
                        queuedAt: new Date().toISOString(),
                        queuedBy: req.session.username
                    };
                    fs.writeFileSync(displaysFile, JSON.stringify(displaysData, null, 2));
                }
            }
        } catch (e) {
            logger.warn('displays:command:file', { error: e.message });
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'display_command_issued', {
            displayId,
            displayHostname: display.hostname,
            command
        });

        logger.log('displays:command', { displayId, command });

        res.json({
            success: true,
            message: `Command '${command}' queued for display ${display.hostname || displayId}`
        });
    } catch (error) {
        logger.error('displays:command', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/displays/commands
 * Get command history
 */
router.get('/displays/commands', (req, res) => {
    try {
        const { displayId, limit = 100, offset = 0 } = req.query;
        const systemDb = db.system.getDb();

        const commands = systemDb.getDisplayCommands({
            displayId,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            commands,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        logger.error('displays:commands:history', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/displays/broadcast
 * Broadcast command to all displays
 */
router.post('/displays/broadcast', (req, res) => {
    try {
        const { command, message } = req.body;

        const validCommands = ['reboot', 'refresh', 'debug_on', 'debug_off'];
        if (!validCommands.includes(command)) {
            return res.status(400).json({
                success: false,
                error: `Invalid command. Must be one of: ${validCommands.join(', ')}`
            });
        }

        const systemDb = db.system.getDb();

        // Get all displays
        const displays = systemDb.prepare('SELECT * FROM displays').all();
        let commandedCount = 0;

        // Queue command for each display
        for (const display of displays) {
            systemDb.recordDisplayCommand({
                displayId: display.id,
                userId: display.user_id,
                command,
                issuedBy: req.session.userId
            });
            commandedCount++;
        }

        // Also update displays.json for backward compatibility
        try {
            const displaysFile = path.join(__dirname, '..', 'displays.json');
            if (fs.existsSync(displaysFile)) {
                const displaysData = JSON.parse(fs.readFileSync(displaysFile, 'utf8'));
                displaysData.displays.forEach(d => {
                    d.pendingCommand = {
                        action: command,
                        queuedAt: new Date().toISOString(),
                        queuedBy: req.session.username
                    };
                });
                fs.writeFileSync(displaysFile, JSON.stringify(displaysData, null, 2));
            }
        } catch (e) {
            logger.warn('displays:broadcast:file', { error: e.message });
        }

        activityLogger.logActivity(req.session.userId, req.session.username, 'display_broadcast_command', {
            command,
            displayCount: commandedCount
        });

        logger.log('displays:broadcast', { command, displayCount: commandedCount });

        res.json({
            success: true,
            message: `Command '${command}' broadcast to ${commandedCount} display(s)`
        });
    } catch (error) {
        logger.error('displays:broadcast', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
