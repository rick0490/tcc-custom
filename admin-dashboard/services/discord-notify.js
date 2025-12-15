/**
 * Discord Notification Service
 *
 * Sends tournament notifications to Discord via webhooks or bot.
 * Supports multi-tenant isolation - each user has their own Discord settings.
 */

const crypto = require('crypto');
const systemDb = require('../db/system-db');
const { createLogger } = require('./debug-logger');

const logger = createLogger('discord-notify');

// Dependencies (set by init)
let io = null;
let activityLogger = null;
let discordBotService = null;

// Rate limiting per user (Map of userId -> { requests, lastReset })
const rateLimits = new Map();
const RATE_LIMIT = {
    maxPerMinute: 30,
    webhookDelay: 500  // ms delay between webhooks to avoid rate limits
};

// Encryption key (derived from session secret)
let encryptionKey = null;

/**
 * Initialize the Discord notification service
 * @param {Object} deps - Dependencies
 * @param {Server} deps.io - Socket.IO server instance
 * @param {Object} deps.activityLogger - Activity logger module
 */
function init(deps) {
    io = deps.io;
    activityLogger = deps.activityLogger;

    // Get encryption key from session secret
    try {
        const secrets = require('../config/secrets');
        const sessionSecret = secrets.getSessionSecret() || process.env.SESSION_SECRET || 'default-session-secret';
        encryptionKey = crypto.createHash('sha256').update(sessionSecret).digest();
    } catch (e) {
        // Fallback to environment variable
        const sessionSecret = process.env.SESSION_SECRET || 'default-session-secret';
        encryptionKey = crypto.createHash('sha256').update(sessionSecret).digest();
    }

    logger.log('init', 'Discord notification service initialized');
}

/**
 * Set the Discord bot service reference
 * Called after discord-bot service is initialized
 * @param {Object} botService - Discord bot service
 */
function setDiscordBotService(botService) {
    discordBotService = botService;
    logger.log('setDiscordBotService', 'Discord bot service reference set');
}

// =============================================================================
// ENCRYPTION HELPERS
// =============================================================================

/**
 * Encrypt a credential (webhook URL or bot token)
 * @param {string} plaintext - Plain text to encrypt
 * @returns {Object} { encrypted: hex, iv: hex }
 */
function encryptCredential(plaintext) {
    if (!plaintext) return { encrypted: null, iv: null };

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);

    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return {
        encrypted: Buffer.concat([encrypted, authTag]).toString('hex'),
        iv: iv.toString('hex')
    };
}

/**
 * Decrypt a credential
 * @param {string} encryptedHex - Encrypted data in hex
 * @param {string} ivHex - IV in hex
 * @returns {string|null} Decrypted text or null on error
 */
function decryptCredential(encryptedHex, ivHex) {
    if (!encryptedHex || !ivHex) return null;

    try {
        const iv = Buffer.from(ivHex, 'hex');
        const data = Buffer.from(encryptedHex, 'hex');

        // Extract auth tag (last 16 bytes)
        const authTag = data.slice(-16);
        const encrypted = data.slice(0, -16);

        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
        decipher.setAuthTag(authTag);

        return decipher.update(encrypted) + decipher.final('utf8');
    } catch (error) {
        logger.error('decryptCredential', error);
        return null;
    }
}

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * Check if user has rate limit capacity
 * @param {number} userId - User ID
 * @returns {boolean} True if request is allowed
 */
function checkRateLimit(userId) {
    const now = Date.now();
    let userLimit = rateLimits.get(userId);

    if (!userLimit || now - userLimit.lastReset > 60000) {
        userLimit = { requests: 0, lastReset: now };
        rateLimits.set(userId, userLimit);
    }

    if (userLimit.requests >= RATE_LIMIT.maxPerMinute) {
        logger.warn('checkRateLimit', `Rate limit exceeded for user ${userId}`);
        return false;
    }

    userLimit.requests++;
    return true;
}

// =============================================================================
// WEBHOOK VALIDATION & SENDING
// =============================================================================

/**
 * Validate Discord webhook URL format (sync version for quick checks)
 * @param {string} webhookUrl - Discord webhook URL
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateWebhookUrl(webhookUrl) {
    if (!webhookUrl || typeof webhookUrl !== 'string') {
        return { valid: false, error: 'Webhook URL is required' };
    }

    // Validate format - support both discord.com and discordapp.com (old URLs)
    const webhookPattern = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;
    if (!webhookPattern.test(webhookUrl)) {
        return { valid: false, error: 'Invalid Discord webhook URL format. Expected: https://discord.com/api/webhooks/ID/TOKEN' };
    }

    return { valid: true };
}

/**
 * Validate Discord webhook URL format and connectivity (async version)
 * @param {string} webhookUrl - Discord webhook URL
 * @returns {Promise<boolean>} True if valid
 * @throws {Error} If invalid
 */
async function validateWebhookUrlWithConnectivity(webhookUrl) {
    const validation = validateWebhookUrl(webhookUrl);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    // Test connectivity with GET request (returns webhook info, doesn't send message)
    try {
        const response = await fetch(webhookUrl, { method: 'GET' });
        if (!response.ok) {
            if (response.status === 401 || response.status === 404) {
                throw new Error('Webhook URL is invalid or has been deleted');
            }
            throw new Error(`Webhook validation failed: ${response.status}`);
        }
    } catch (error) {
        if (error.message.includes('Webhook')) throw error;
        throw new Error(`Cannot reach webhook: ${error.message}`);
    }

    return true;
}

/**
 * Send notification via Discord webhook
 * @param {string} webhookUrl - Discord webhook URL
 * @param {Object} embed - Discord embed object
 * @param {string|null} mentionRoleId - Role ID to mention
 */
async function sendWebhookNotification(webhookUrl, embed, mentionRoleId = null) {
    const payload = {
        embeds: [embed],
        username: 'Tournament Bot',
        avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png'
    };

    if (mentionRoleId) {
        payload.content = `<@&${mentionRoleId}>`;
    }

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Discord webhook failed: ${response.status} - ${errorText}`);
    }

    logger.log('sendWebhookNotification', 'Notification sent successfully');
}

// =============================================================================
// EMBED BUILDERS
// =============================================================================

/**
 * Parse embed color from hex string to integer
 * @param {string} hexColor - Hex color (e.g., '#5865F2')
 * @returns {number} Integer color value
 */
function parseEmbedColor(hexColor) {
    const color = (hexColor || '#5865F2').replace('#', '');
    return parseInt(color, 16);
}

/**
 * Format tournament type for display
 * @param {string} type - Tournament type key
 * @returns {string} Formatted type name
 */
function formatTournamentType(type) {
    const types = {
        'single_elimination': 'Single Elimination',
        'double_elimination': 'Double Elimination',
        'round_robin': 'Round Robin',
        'swiss': 'Swiss'
    };
    return types[type] || type || 'Unknown';
}

/**
 * Get round name from round number
 * @param {number} round - Round number
 * @param {string} type - Tournament type
 * @returns {string} Round name
 */
function getRoundName(round, type) {
    if (round > 0) return `Winners Round ${round}`;
    if (round < 0) return `Losers Round ${Math.abs(round)}`;
    return `Round ${round}`;
}

/**
 * Build embed for tournament started
 */
function buildTournamentStartEmbed(tournament, settings) {
    return {
        title: 'Tournament Started!',
        description: `**${tournament.name}** has begun!`,
        color: parseEmbedColor(settings.embed_color),
        fields: [
            { name: 'Game', value: tournament.game_name || 'Unknown', inline: true },
            { name: 'Format', value: formatTournamentType(tournament.tournament_type), inline: true },
            { name: 'Participants', value: String(tournament.participant_count || 0), inline: true }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'Tournament Control Center' }
    };
}

/**
 * Build embed for tournament complete
 */
function buildTournamentCompleteEmbed(tournament, standings, settings) {
    const fields = [
        { name: 'Game', value: tournament.game_name || 'Unknown', inline: true },
        { name: 'Participants', value: String(tournament.participant_count || 0), inline: true }
    ];

    // Add top 3 if available
    if (standings && standings.length > 0) {
        const medals = ['🥇', '🥈', '🥉'];
        const podium = standings.slice(0, 3)
            .map((p, i) => `${medals[i]} ${p.name || p.display_name}`)
            .join('\n');
        fields.push({ name: 'Final Standings', value: podium, inline: false });
    }

    return {
        title: 'Tournament Complete!',
        description: `**${tournament.name}** has finished!`,
        color: parseEmbedColor(settings.embed_color),
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'Tournament Control Center' }
    };
}

/**
 * Build embed for match complete
 */
function buildMatchCompleteEmbed(match, tournament, settings) {
    const score = match.scores_csv || 'W';
    const winnerName = match.winner_name || match.player1_name || 'Winner';
    const loserName = match.loser_name || match.player2_name || 'Opponent';

    return {
        title: 'Match Complete',
        description: `**${winnerName}** defeats **${loserName}**`,
        color: parseEmbedColor(settings.embed_color),
        fields: [
            { name: 'Score', value: score, inline: true },
            { name: 'Round', value: getRoundName(match.round, tournament.tournament_type), inline: true },
            { name: 'Tournament', value: tournament.name, inline: false }
        ],
        timestamp: new Date().toISOString()
    };
}

/**
 * Build embed for participant signup
 */
function buildParticipantSignupEmbed(participant, tournament, settings) {
    return {
        title: 'New Signup!',
        description: `**${participant.name || participant.display_name}** has registered`,
        color: parseEmbedColor(settings.embed_color),
        fields: [
            { name: 'Tournament', value: tournament.name, inline: true },
            { name: 'Total', value: String((tournament.participant_count || 0) + 1), inline: true }
        ],
        timestamp: new Date().toISOString()
    };
}

/**
 * Build embed for participant check-in
 */
function buildCheckinEmbed(participant, tournament, settings) {
    return {
        title: 'Player Checked In',
        description: `**${participant.name || participant.display_name}** is ready`,
        color: parseInt('22C55E', 16),  // Green
        fields: [
            { name: 'Tournament', value: tournament.name, inline: true }
        ],
        timestamp: new Date().toISOString()
    };
}

/**
 * Build embed for DQ timer expired
 */
function buildDqTimerEmbed(match, playerName, tournament, settings) {
    const player1Name = match.player1_name || 'Player 1';
    const player2Name = match.player2_name || 'Player 2';

    return {
        title: 'DQ Timer Expired',
        description: `**${playerName}** has run out of time`,
        color: parseInt('EF4444', 16),  // Red
        fields: [
            { name: 'Match', value: `${player1Name} vs ${player2Name}`, inline: false },
            { name: 'Tournament', value: tournament.name, inline: true }
        ],
        timestamp: new Date().toISOString()
    };
}

/**
 * Build test message embed
 */
function buildTestEmbed(settings) {
    return {
        title: 'Test Notification',
        description: 'Discord integration is working correctly!',
        color: parseEmbedColor(settings.embed_color),
        fields: [
            { name: 'Integration Type', value: settings.integration_type || 'webhook', inline: true },
            { name: 'Status', value: 'Connected', inline: true }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'Tournament Control Center - Test Message' }
    };
}

// =============================================================================
// CORE NOTIFICATION FUNCTIONS
// =============================================================================

/**
 * Send notification based on user settings
 * @param {number} userId - User ID
 * @param {Object} embed - Discord embed object
 * @param {string} eventType - Event type for toggle checking
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendNotification(userId, embed, eventType) {
    const settings = systemDb.getDiscordSettings(userId);

    if (!settings || !settings.is_enabled) {
        logger.log('sendNotification', `Skipped: Discord not enabled for user ${userId}`);
        return false;
    }

    // Check event toggle
    const toggleMap = {
        'tournament_start': settings.notify_tournament_start,
        'tournament_complete': settings.notify_tournament_complete,
        'match_complete': settings.notify_match_complete,
        'participant_signup': settings.notify_participant_signup,
        'participant_checkin': settings.notify_participant_checkin,
        'dq_timer': settings.notify_dq_timer
    };

    if (!toggleMap[eventType]) {
        logger.log('sendNotification', `Skipped: ${eventType} notifications disabled for user ${userId}`);
        return false;
    }

    // Check rate limit
    if (!checkRateLimit(userId)) {
        logger.warn('sendNotification', `Rate limit exceeded for user ${userId}`);
        return false;
    }

    try {
        if (settings.integration_type === 'webhook' && settings.webhook_url_encrypted) {
            const webhookUrl = decryptCredential(settings.webhook_url_encrypted, settings.webhook_iv);
            if (webhookUrl) {
                await sendWebhookNotification(webhookUrl, embed, settings.mention_role_id);
                return true;
            }
        } else if (settings.integration_type === 'bot' && settings.bot_token_encrypted) {
            // Bot mode - send via Discord.js bot client
            if (!discordBotService) {
                logger.warn('sendNotification', 'Discord bot service not initialized');
                return false;
            }

            // Check if channel_id is configured
            if (!settings.channel_id) {
                logger.warn('sendNotification', `No channel configured for user ${userId}`);
                return false;
            }

            const sent = await sendBotNotification(userId, settings.channel_id, embed, settings.mention_role_id);
            return sent;
        }

        return false;
    } catch (error) {
        logger.error('sendNotification', error, { userId, eventType });

        // Save error to database
        systemDb.saveDiscordSettings(userId, { last_error: error.message });
        return false;
    }
}

/**
 * Send notification via Discord bot
 * @param {number} userId - User ID
 * @param {string} channelId - Discord channel ID
 * @param {Object} embed - Discord embed object
 * @param {string|null} mentionRoleId - Role ID to mention
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendBotNotification(userId, channelId, embed, mentionRoleId = null) {
    if (!discordBotService) {
        logger.warn('sendBotNotification', 'Discord bot service not available');
        return false;
    }

    const botInfo = discordBotService.getBot(userId);
    if (!botInfo || !botInfo.client || botInfo.status !== 'connected') {
        logger.warn('sendBotNotification', `Bot not connected for user ${userId}`);
        return false;
    }

    try {
        const channel = await botInfo.client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
            logger.warn('sendBotNotification', `Channel ${channelId} not found or not text-based`);
            return false;
        }

        const messageOptions = { embeds: [embed] };
        if (mentionRoleId) {
            messageOptions.content = `<@&${mentionRoleId}>`;
        }

        await channel.send(messageOptions);
        logger.log('sendBotNotification', `Notification sent to channel ${channelId} for user ${userId}`);
        return true;
    } catch (error) {
        logger.error('sendBotNotification', error, { userId, channelId });
        return false;
    }
}

// =============================================================================
// EVENT-SPECIFIC NOTIFICATION FUNCTIONS
// =============================================================================

/**
 * Notify tournament started
 * @param {number} userId - User ID
 * @param {Object} tournament - Tournament object
 */
async function notifyTournamentStart(userId, tournament) {
    if (!userId) return;

    const settings = systemDb.getDiscordSettings(userId);
    if (!settings) return;

    const embed = buildTournamentStartEmbed(tournament, settings);
    const sent = await sendNotification(userId, embed, 'tournament_start');

    if (sent && activityLogger) {
        activityLogger.logActivity(userId, null, 'discord_notification_sent', {
            type: 'tournament_start',
            tournamentId: tournament.id,
            tournamentName: tournament.name
        });
    }
}

/**
 * Notify tournament completed
 * @param {number} userId - User ID
 * @param {Object} tournament - Tournament object
 * @param {Array} standings - Final standings array
 */
async function notifyTournamentComplete(userId, tournament, standings = []) {
    if (!userId) return;

    const settings = systemDb.getDiscordSettings(userId);
    if (!settings) return;

    const embed = buildTournamentCompleteEmbed(tournament, standings, settings);
    const sent = await sendNotification(userId, embed, 'tournament_complete');

    if (sent && activityLogger) {
        activityLogger.logActivity(userId, null, 'discord_notification_sent', {
            type: 'tournament_complete',
            tournamentId: tournament.id,
            tournamentName: tournament.name
        });
    }
}

/**
 * Notify match completed
 * @param {number} userId - User ID
 * @param {Object} match - Match object
 * @param {Object} tournament - Tournament object
 */
async function notifyMatchComplete(userId, match, tournament) {
    if (!userId) return;

    const settings = systemDb.getDiscordSettings(userId);
    if (!settings) return;

    const embed = buildMatchCompleteEmbed(match, tournament, settings);
    await sendNotification(userId, embed, 'match_complete');
}

/**
 * Notify participant signup
 * @param {number} userId - User ID
 * @param {Object} participant - Participant object
 * @param {Object} tournament - Tournament object
 */
async function notifyParticipantSignup(userId, participant, tournament) {
    if (!userId) return;

    const settings = systemDb.getDiscordSettings(userId);
    if (!settings) return;

    const embed = buildParticipantSignupEmbed(participant, tournament, settings);
    await sendNotification(userId, embed, 'participant_signup');
}

/**
 * Notify participant check-in
 * @param {number} userId - User ID
 * @param {Object} participant - Participant object
 * @param {Object} tournament - Tournament object
 */
async function notifyParticipantCheckin(userId, participant, tournament) {
    if (!userId) return;

    const settings = systemDb.getDiscordSettings(userId);
    if (!settings) return;

    const embed = buildCheckinEmbed(participant, tournament, settings);
    await sendNotification(userId, embed, 'participant_checkin');
}

/**
 * Notify DQ timer expired
 * @param {number} userId - User ID
 * @param {Object} match - Match object
 * @param {string} playerName - Name of player who got DQ'd
 * @param {Object} tournament - Tournament object
 */
async function notifyDqTimer(userId, match, playerName, tournament) {
    if (!userId) return;

    const settings = systemDb.getDiscordSettings(userId);
    if (!settings) return;

    const embed = buildDqTimerEmbed(match, playerName, tournament, settings);
    await sendNotification(userId, embed, 'dq_timer');
}

/**
 * Send test notification to verify configuration
 * @param {number} userId - User ID
 * @throws {Error} If configuration invalid or send fails
 */
async function sendTestMessage(userId) {
    const settings = systemDb.getDiscordSettings(userId);

    if (!settings) {
        throw new Error('Discord not configured');
    }

    if (settings.integration_type === 'webhook') {
        if (!settings.webhook_url_encrypted) {
            throw new Error('Webhook URL not configured');
        }

        const webhookUrl = decryptCredential(settings.webhook_url_encrypted, settings.webhook_iv);
        if (!webhookUrl) {
            throw new Error('Failed to decrypt webhook URL');
        }

        const embed = buildTestEmbed(settings);
        await sendWebhookNotification(webhookUrl, embed, null);

        // Update last test timestamp
        systemDb.saveDiscordSettings(userId, {
            last_test_at: new Date().toISOString(),
            last_error: null
        });
    } else if (settings.integration_type === 'bot') {
        if (!settings.bot_token_encrypted) {
            throw new Error('Bot token not configured');
        }

        if (!settings.channel_id) {
            throw new Error('No notification channel configured');
        }

        if (!discordBotService) {
            throw new Error('Discord bot service not available');
        }

        const embed = buildTestEmbed(settings);
        const sent = await sendBotNotification(userId, settings.channel_id, embed, null);

        if (!sent) {
            throw new Error('Failed to send test message via bot. Check bot is connected and channel is accessible.');
        }

        // Update last test timestamp
        systemDb.saveDiscordSettings(userId, {
            last_test_at: new Date().toISOString(),
            last_error: null
        });
    } else {
        throw new Error('Invalid integration type');
    }
}

/**
 * Check if Discord is available for a user
 * @param {number} userId - User ID
 * @returns {Object} { available, configured, enabled, type }
 */
function isAvailable(userId) {
    const settings = systemDb.getDiscordSettings(userId);

    if (!settings) {
        return { available: false, configured: false, enabled: false, type: null };
    }

    const hasWebhook = !!settings.webhook_url_encrypted;
    const hasBot = !!settings.bot_token_encrypted;
    const configured = hasWebhook || hasBot;

    return {
        available: configured && settings.is_enabled,
        configured,
        enabled: !!settings.is_enabled,
        type: settings.integration_type
    };
}

module.exports = {
    init,
    setDiscordBotService,

    // Encryption
    encryptCredential,
    decryptCredential,

    // Validation
    validateWebhookUrl,
    validateWebhookUrlWithConnectivity,
    isAvailable,

    // Rate limiting
    checkRateLimit,

    // Notification functions
    sendNotification,
    sendBotNotification,
    sendTestMessage,

    // Event-specific
    notifyTournamentStart,
    notifyTournamentComplete,
    notifyMatchComplete,
    notifyParticipantSignup,
    notifyParticipantCheckin,
    notifyDqTimer,

    // Embed builders (exported for testing)
    buildTournamentStartEmbed,
    buildTournamentCompleteEmbed,
    buildMatchCompleteEmbed,
    buildParticipantSignupEmbed,
    buildCheckinEmbed,
    buildDqTimerEmbed,
    buildTestEmbed
};
