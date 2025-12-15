/**
 * Discord Bot Routes
 *
 * API endpoints for managing Discord bot connections.
 * Per-tenant architecture - each user manages their own bot.
 */

const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../middleware/auth');
const systemDb = require('../db/system-db');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:discord-bot');

// Reference to Discord bot service (set by init)
let discordBot = null;

// Reference to Socket.IO server (set by init)
let io = null;

/**
 * Initialize the Discord bot routes with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.discordBot - Discord bot manager service
 * @param {Object} options.io - Socket.IO server
 */
function init({ discordBot: bot, io: socketIo }) {
    discordBot = bot;
    io = socketIo;
}

// ============================================
// DISCORD BOT API ENDPOINTS
// ============================================

/**
 * POST /api/discord/bot/connect
 * Start the bot for the authenticated user
 */
router.post('/connect', requireAuthAPI, async (req, res) => {
    const userId = req.session.userId;
    logger.log('connect', `Bot connect request from user ${userId}`);

    if (!discordBot) {
        return res.status(500).json({
            success: false,
            error: 'Discord bot service not available'
        });
    }

    // Check if user has a bot token configured
    const settings = systemDb.getDiscordSettings(userId);
    if (!settings || !settings.bot_token_encrypted) {
        return res.status(400).json({
            success: false,
            error: 'No bot token configured. Please add your bot token in Discord settings.'
        });
    }

    try {
        const result = await discordBot.startBot(userId);

        if (result.success) {
            // Enable bot in settings
            systemDb.saveDiscordSettings(userId, { bot_enabled: 1 });

            res.json({
                success: true,
                status: result.status,
                message: result.status === 'already_connected' ? 'Bot already connected' : 'Bot connecting...'
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }
    } catch (error) {
        logger.error('connect', error, { userId });
        res.status(500).json({
            success: false,
            error: 'Failed to connect bot'
        });
    }
});

/**
 * POST /api/discord/bot/disconnect
 * Stop the bot for the authenticated user
 */
router.post('/disconnect', requireAuthAPI, async (req, res) => {
    const userId = req.session.userId;
    logger.log('disconnect', `Bot disconnect request from user ${userId}`);

    if (!discordBot) {
        return res.status(500).json({
            success: false,
            error: 'Discord bot service not available'
        });
    }

    try {
        const result = await discordBot.stopBot(userId);

        // Disable bot in settings
        systemDb.saveDiscordSettings(userId, { bot_enabled: 0 });

        res.json({
            success: true,
            status: result.status,
            message: 'Bot disconnected'
        });
    } catch (error) {
        logger.error('disconnect', error, { userId });
        res.status(500).json({
            success: false,
            error: 'Failed to disconnect bot'
        });
    }
});

/**
 * GET /api/discord/bot/status
 * Get bot connection status and guild list for the authenticated user
 */
router.get('/status', requireAuthAPI, (req, res) => {
    const userId = req.session.userId;

    if (!discordBot) {
        return res.status(500).json({
            success: false,
            error: 'Discord bot service not available'
        });
    }

    const status = discordBot.getBotStatus(userId);
    const settings = systemDb.getDiscordSettings(userId);

    res.json({
        success: true,
        botEnabled: settings?.bot_enabled === 1,
        hasToken: !!(settings?.bot_token_encrypted),
        connected: status.connected,
        status: status.status,
        guildCount: status.guildCount,
        guilds: status.guilds,
        connectedSince: status.connectedSince,
        lastConnected: status.lastConnected,
        commandsEnabled: settings?.commands_enabled ? JSON.parse(settings.commands_enabled) : ['bracket', 'matches', 'standings']
    });
});

/**
 * POST /api/discord/bot/test
 * Test bot token validity without fully connecting
 */
router.post('/test', requireAuthAPI, async (req, res) => {
    const userId = req.session.userId;
    const { bot_token } = req.body;

    if (!bot_token) {
        return res.status(400).json({
            success: false,
            error: 'Bot token is required'
        });
    }

    // Validate token format (basic check)
    const tokenPattern = /^[\w-]+\.[\w-]+\.[\w-]+$/;
    if (!tokenPattern.test(bot_token)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid bot token format'
        });
    }

    try {
        // Try to fetch bot info from Discord API
        const response = await fetch('https://discord.com/api/v10/users/@me', {
            headers: {
                'Authorization': `Bot ${bot_token}`
            }
        });

        if (response.ok) {
            const botInfo = await response.json();
            res.json({
                success: true,
                valid: true,
                botInfo: {
                    id: botInfo.id,
                    username: botInfo.username,
                    discriminator: botInfo.discriminator,
                    avatar: botInfo.avatar
                },
                message: `Valid token for bot: ${botInfo.username}`
            });
        } else if (response.status === 401) {
            res.json({
                success: true,
                valid: false,
                error: 'Invalid or expired bot token'
            });
        } else {
            res.json({
                success: true,
                valid: false,
                error: `Discord API error: ${response.status}`
            });
        }
    } catch (error) {
        logger.error('test', error, { userId });
        res.status(500).json({
            success: false,
            error: 'Failed to validate token'
        });
    }
});

/**
 * POST /api/discord/bot/token
 * Save or update bot token (encrypted)
 */
router.post('/token', requireAuthAPI, async (req, res) => {
    const userId = req.session.userId;
    const { bot_token } = req.body;

    if (!bot_token) {
        return res.status(400).json({
            success: false,
            error: 'Bot token is required'
        });
    }

    if (!discordBot) {
        return res.status(500).json({
            success: false,
            error: 'Discord bot service not available'
        });
    }

    try {
        // Encrypt the token
        const { encrypted, iv } = discordBot.encryptBotToken(bot_token);

        // Save to database
        systemDb.saveDiscordSettings(userId, {
            bot_token_encrypted: encrypted,
            bot_token_iv: iv,
            integration_type: 'bot'
        });

        logger.log('token', `Bot token saved for user ${userId}`);

        res.json({
            success: true,
            message: 'Bot token saved successfully'
        });
    } catch (error) {
        logger.error('token', error, { userId });
        res.status(500).json({
            success: false,
            error: 'Failed to save bot token'
        });
    }
});

/**
 * DELETE /api/discord/bot/token
 * Remove bot token and disconnect
 */
router.delete('/token', requireAuthAPI, async (req, res) => {
    const userId = req.session.userId;

    if (!discordBot) {
        return res.status(500).json({
            success: false,
            error: 'Discord bot service not available'
        });
    }

    try {
        // Stop the bot if running
        await discordBot.stopBot(userId);

        // Clear token from database
        systemDb.saveDiscordSettings(userId, {
            bot_token_encrypted: null,
            bot_token_iv: null,
            bot_enabled: 0,
            bot_status: 'disconnected'
        });

        logger.log('token', `Bot token removed for user ${userId}`);

        res.json({
            success: true,
            message: 'Bot token removed'
        });
    } catch (error) {
        logger.error('token', error, { userId });
        res.status(500).json({
            success: false,
            error: 'Failed to remove bot token'
        });
    }
});

/**
 * POST /api/discord/bot/register-commands
 * Register/refresh slash commands for all guilds
 */
router.post('/register-commands', requireAuthAPI, async (req, res) => {
    const userId = req.session.userId;

    if (!discordBot) {
        return res.status(500).json({
            success: false,
            error: 'Discord bot service not available'
        });
    }

    const botInfo = discordBot.getBot(userId);
    if (!botInfo || botInfo.status !== 'connected') {
        return res.status(400).json({
            success: false,
            error: 'Bot is not connected'
        });
    }

    try {
        // Commands are registered automatically on guild join
        // This endpoint can trigger a re-registration if needed
        res.json({
            success: true,
            message: 'Commands are registered automatically when bot connects to guilds',
            guildCount: botInfo.guilds.length
        });
    } catch (error) {
        logger.error('registerCommands', error, { userId });
        res.status(500).json({
            success: false,
            error: 'Failed to register commands'
        });
    }
});

/**
 * PUT /api/discord/bot/commands
 * Update which commands are enabled
 */
router.put('/commands', requireAuthAPI, (req, res) => {
    const userId = req.session.userId;
    const { commands } = req.body;

    if (!Array.isArray(commands)) {
        return res.status(400).json({
            success: false,
            error: 'Commands must be an array'
        });
    }

    const validCommands = ['bracket', 'matches', 'standings', 'signup', 'link'];
    const filteredCommands = commands.filter(cmd => validCommands.includes(cmd));

    try {
        systemDb.saveDiscordSettings(userId, {
            commands_enabled: JSON.stringify(filteredCommands)
        });

        res.json({
            success: true,
            commands: filteredCommands
        });
    } catch (error) {
        logger.error('commands', error, { userId });
        res.status(500).json({
            success: false,
            error: 'Failed to update commands'
        });
    }
});

module.exports = router;
module.exports.init = init;
