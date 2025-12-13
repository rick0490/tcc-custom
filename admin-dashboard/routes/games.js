/**
 * Games Routes
 *
 * Game configuration management API endpoints.
 * Multi-tenant: Games are isolated per user_id.
 */

const express = require('express');
const router = express.Router();
const { requireAuthAPI, requireAdmin } = require('../middleware/auth');
const { attachTenantContext, getTenantFilter, allowViewAllTenants, validateTenantAccess } = require('../middleware/tenant');
const activityLogger = require('../services/activity-logger');
const { createLogger } = require('../services/debug-logger');
const systemDb = require('../db/system-db');

const logger = createLogger('routes:games');

// Socket.IO instance (injected from server.js)
let io = null;

/**
 * Inject Socket.IO instance for WebSocket broadcasts
 * @param {Object} socketIo - Socket.IO server instance
 */
function setSocketIO(socketIo) {
    io = socketIo;
}

/**
 * Broadcast game update to user's room
 * @param {string} eventType - Event name
 * @param {number} userId - User ID to broadcast to
 * @param {Object} data - Event data
 */
function broadcastGameUpdate(eventType, userId, data) {
    if (io && userId) {
        io.to(`user:${userId}`).emit(eventType, data);
        logger.log('broadcast', { event: eventType, userId, gameKey: data.gameKey });
    }
}

/**
 * Validate game key format
 * @param {string} key - Game key to validate
 * @returns {boolean} True if valid
 */
function validateGameKey(key) {
    // Only allow lowercase alphanumeric and underscores
    return /^[a-z][a-z0-9_]*$/.test(key) && key.length <= 30;
}

/**
 * Transform database game row to API response format
 * @param {Object} game - Database game row
 * @returns {Object} API response game object
 */
function transformGameToResponse(game) {
    return {
        id: game.id,
        gameKey: game.game_key,
        name: game.name,
        shortName: game.short_name || '',
        rules: game.rules_json ? JSON.parse(game.rules_json) : [],
        prizes: game.prizes_json ? JSON.parse(game.prizes_json) : [],
        additionalInfo: game.additional_info_json ? JSON.parse(game.additional_info_json) : [],
        isDefault: game.game_key === 'default',
        userId: game.user_id,
        createdAt: game.created_at
    };
}

// Apply tenant context to all routes
router.use(attachTenantContext);

// ============================================
// GAME CONFIGURATION API ENDPOINTS
// ============================================

/**
 * GET /api/games
 * List all games for current user (or all games for superadmin with ?all=true)
 */
router.get('/', requireAuthAPI, allowViewAllTenants, (req, res) => {
    try {
        const tenantFilter = getTenantFilter(req);

        let games;
        if (tenantFilter === null) {
            // Superadmin viewing all
            games = systemDb.getAllGames();
        } else {
            // Regular user - get games for their tenant
            games = systemDb.getAllGamesForUser(tenantFilter);
        }

        const transformedGames = games.map(transformGameToResponse);

        res.json({
            success: true,
            games: transformedGames,
            totalGames: transformedGames.length
        });
    } catch (error) {
        logger.error('list', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/games/:gameKey
 * Get single game config
 */
router.get('/:gameKey', requireAuthAPI, (req, res) => {
    try {
        const { gameKey } = req.params;
        const userId = req.tenantId;

        const game = systemDb.getGameByKey(userId, gameKey);

        if (!game) {
            return res.status(404).json({ success: false, error: 'Game not found' });
        }

        // Validate tenant access
        if (!validateTenantAccess(req, game.user_id)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        res.json({
            success: true,
            gameKey,
            config: transformGameToResponse(game)
        });
    } catch (error) {
        logger.error('get', error, { gameKey: req.params.gameKey });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/games
 * Create new game
 */
router.post('/', requireAuthAPI, requireAdmin, (req, res) => {
    try {
        const { gameKey, name, shortName, rules, prizes, additionalInfo } = req.body;
        const userId = req.tenantId;

        if (!gameKey || !name) {
            return res.status(400).json({ success: false, error: 'gameKey and name are required' });
        }

        if (!validateGameKey(gameKey)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid game key. Use lowercase letters, numbers, and underscores only. Must start with a letter.'
            });
        }

        // Check if game key already exists for this user
        const existing = systemDb.getGameByKey(userId, gameKey);
        if (existing) {
            return res.status(400).json({ success: false, error: 'Game key already exists' });
        }

        // Create the game
        const game = systemDb.createGame(userId, {
            gameKey,
            name: name.trim(),
            shortName: (shortName || '').trim(),
            rules: rules || [],
            prizes: prizes || systemDb.getDefaultPrizes(),
            additionalInfo: additionalInfo || []
        });

        const responseGame = transformGameToResponse(game);

        activityLogger.logActivity(req.session.userId, req.session.username, 'create_game', {
            gameKey,
            name: responseGame.name
        });

        // Broadcast to user's room
        broadcastGameUpdate('games:created', userId, responseGame);

        logger.log('create:success', { gameKey, name: responseGame.name, userId });

        res.json({
            success: true,
            message: 'Game created successfully',
            gameKey,
            config: responseGame
        });
    } catch (error) {
        logger.error('create', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/games/:gameKey
 * Update game config
 */
router.put('/:gameKey', requireAuthAPI, requireAdmin, (req, res) => {
    try {
        const { gameKey } = req.params;
        const { name, shortName, rules, prizes, additionalInfo, newGameKey } = req.body;
        const userId = req.tenantId;

        const game = systemDb.getGameByKey(userId, gameKey);

        if (!game) {
            return res.status(404).json({ success: false, error: 'Game not found' });
        }

        // Validate tenant access
        if (!validateTenantAccess(req, game.user_id)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Handle rename
        let finalGameKey = gameKey;
        if (newGameKey && newGameKey !== gameKey) {
            if (gameKey === 'default') {
                return res.status(400).json({ success: false, error: 'Cannot rename the default game' });
            }

            if (!validateGameKey(newGameKey)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid new game key. Use lowercase letters, numbers, and underscores only.'
                });
            }

            // Check if new key already exists
            const existingNewKey = systemDb.getGameByKey(userId, newGameKey);
            if (existingNewKey) {
                return res.status(400).json({ success: false, error: 'New game key already exists' });
            }

            finalGameKey = newGameKey;
            logger.log('rename', { from: gameKey, to: newGameKey, userId });
        }

        // Build update data
        const updateData = {};
        if (newGameKey && newGameKey !== gameKey) updateData.gameKey = newGameKey;
        if (name !== undefined) updateData.name = name.trim();
        if (shortName !== undefined) updateData.shortName = shortName.trim();
        if (rules !== undefined) updateData.rules = rules;
        if (prizes !== undefined) updateData.prizes = prizes;
        if (additionalInfo !== undefined) updateData.additionalInfo = additionalInfo;

        const updatedGame = systemDb.updateGame(game.id, updateData);
        const responseGame = transformGameToResponse(updatedGame);

        activityLogger.logActivity(req.session.userId, req.session.username, 'update_game', {
            gameKey: finalGameKey,
            name: responseGame.name,
            renamed: newGameKey && newGameKey !== gameKey ? { from: gameKey, to: newGameKey } : undefined
        });

        // Broadcast to user's room
        broadcastGameUpdate('games:updated', userId, responseGame);

        logger.log('update:success', { gameKey: finalGameKey, name: responseGame.name, userId });

        res.json({
            success: true,
            message: 'Game updated successfully',
            gameKey: finalGameKey,
            config: responseGame
        });
    } catch (error) {
        logger.error('update', error, { gameKey: req.params.gameKey });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/games/:gameKey
 * Delete game
 */
router.delete('/:gameKey', requireAuthAPI, requireAdmin, (req, res) => {
    try {
        const { gameKey } = req.params;
        const userId = req.tenantId;

        if (gameKey === 'default') {
            return res.status(400).json({ success: false, error: 'Cannot delete the default game' });
        }

        const game = systemDb.getGameByKey(userId, gameKey);

        if (!game) {
            return res.status(404).json({ success: false, error: 'Game not found' });
        }

        // Validate tenant access
        if (!validateTenantAccess(req, game.user_id)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const deletedName = game.name;
        systemDb.deleteGame(game.id);

        activityLogger.logActivity(req.session.userId, req.session.username, 'delete_game', {
            gameKey,
            name: deletedName
        });

        // Broadcast to user's room
        broadcastGameUpdate('games:deleted', userId, { gameKey, name: deletedName });

        logger.log('delete:success', { gameKey, name: deletedName, userId });

        res.json({
            success: true,
            message: 'Game deleted successfully',
            deletedGameKey: gameKey
        });
    } catch (error) {
        logger.error('delete', error, { gameKey: req.params.gameKey });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
module.exports.setSocketIO = setSocketIO;
module.exports.validateGameKey = validateGameKey;
module.exports.transformGameToResponse = transformGameToResponse;
