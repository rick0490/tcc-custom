/**
 * Discord Bot Manager Service
 *
 * Manages multiple Discord.js bot instances (one per tenant).
 * Each user provides their own bot token for complete isolation.
 */

const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js');
const crypto = require('crypto');
const systemDb = require('../../db/system-db');
const { createLogger } = require('../debug-logger');

const logger = createLogger('discord-bot');

// Active bot clients (Map of userId -> { client, status, guilds })
const botClients = new Map();

// Dependencies (set by init)
let io = null;
let tournamentDb = null;
let matchDb = null;
let participantDb = null;

// Encryption key (derived from session secret)
let encryptionKey = null;

// Auto-reconnect settings
const RECONNECT_DELAY = 5000;  // 5 seconds
const MAX_RECONNECT_ATTEMPTS = 5;

// Command rate limiting
const RATE_LIMIT_COMMANDS = 10;  // Max commands per window
const RATE_LIMIT_WINDOW_MS = 60000;  // 1 minute window
const commandCooldowns = new Map();  // userId -> { count, resetAt }

/**
 * Initialize the Discord bot manager
 * @param {Object} deps - Dependencies
 * @param {Server} deps.io - Socket.IO server instance
 * @param {Object} deps.tournamentDb - Tournament database service
 * @param {Object} deps.matchDb - Match database service
 * @param {Object} deps.participantDb - Participant database service
 */
function init(deps) {
    io = deps.io;
    tournamentDb = deps.tournamentDb;
    matchDb = deps.matchDb;
    participantDb = deps.participantDb;

    // Get encryption key from session secret
    try {
        const secrets = require('../../config/secrets');
        const sessionSecret = secrets.getSessionSecret() || process.env.SESSION_SECRET || 'default-session-secret';
        encryptionKey = crypto.createHash('sha256').update(sessionSecret).digest();
    } catch (e) {
        const sessionSecret = process.env.SESSION_SECRET || 'default-session-secret';
        encryptionKey = crypto.createHash('sha256').update(sessionSecret).digest();
    }

    logger.log('init', 'Discord bot manager initialized');
}

/**
 * Start the bot manager and reconnect enabled bots
 */
async function start() {
    logger.log('start', 'Starting bot manager, checking for enabled bots...');

    // Get all users with bot enabled
    const enabledUsers = systemDb.getBotEnabledUsers();
    logger.log('start', `Found ${enabledUsers.length} users with bot enabled`);

    // Attempt to connect each enabled bot
    for (const user of enabledUsers) {
        try {
            await startBot(user.user_id);
            // Small delay between bot starts to avoid rate limiting
            await sleep(1000);
        } catch (error) {
            logger.error('start', error, { userId: user.user_id });
        }
    }
}

/**
 * Stop the bot manager and disconnect all bots
 */
async function stop() {
    logger.log('stop', `Stopping all ${botClients.size} bot clients`);

    const stopPromises = [];
    for (const userId of botClients.keys()) {
        stopPromises.push(stopBot(userId));
    }

    await Promise.allSettled(stopPromises);
    logger.log('stop', 'All bot clients stopped');
}

// =============================================================================
// ENCRYPTION HELPERS (same as discord-notify.js)
// =============================================================================

/**
 * Decrypt a bot token
 * @param {string} encryptedHex - Encrypted token in hex
 * @param {string} ivHex - IV in hex
 * @returns {string|null} Decrypted token or null on error
 */
function decryptBotToken(encryptedHex, ivHex) {
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
        logger.error('decryptBotToken', error);
        return null;
    }
}

/**
 * Encrypt a bot token
 * @param {string} plaintext - Plain text token
 * @returns {Object} { encrypted: hex, iv: hex }
 */
function encryptBotToken(plaintext) {
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

// =============================================================================
// BOT LIFECYCLE MANAGEMENT
// =============================================================================

/**
 * Start a bot for a specific user
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Bot status
 */
async function startBot(userId) {
    logger.log('startBot', `Starting bot for user ${userId}`);

    // Check if bot already running
    if (botClients.has(userId)) {
        const existing = botClients.get(userId);
        if (existing.client && existing.status === 'connected') {
            logger.log('startBot', `Bot already connected for user ${userId}`);
            return { success: true, status: 'already_connected' };
        }
        // Clean up stale client
        await stopBot(userId);
    }

    // Get user's Discord settings
    const settings = systemDb.getDiscordSettings(userId);
    if (!settings || !settings.bot_token_encrypted) {
        logger.warn('startBot', `No bot token configured for user ${userId}`);
        return { success: false, error: 'No bot token configured' };
    }

    // Decrypt bot token
    const botToken = decryptBotToken(settings.bot_token_encrypted, settings.bot_token_iv);
    if (!botToken) {
        logger.error('startBot', new Error('Failed to decrypt bot token'), { userId });
        systemDb.updateBotStatus(userId, 'error', 'Failed to decrypt bot token');
        return { success: false, error: 'Failed to decrypt bot token' };
    }

    // Update status to connecting
    systemDb.updateBotStatus(userId, 'connecting');

    // Create Discord.js client
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages
        ]
    });

    // Store client info
    const botInfo = {
        client,
        userId,
        status: 'connecting',
        guilds: [],
        reconnectAttempts: 0,
        createdAt: new Date()
    };
    botClients.set(userId, botInfo);

    // Set up event handlers
    setupClientEvents(client, userId, botInfo);

    // Attempt to login
    try {
        await client.login(botToken);
        logger.log('startBot', `Bot logged in successfully for user ${userId}`);
        return { success: true, status: 'connecting' };
    } catch (error) {
        logger.error('startBot', error, { userId });
        botClients.delete(userId);
        systemDb.updateBotStatus(userId, 'error', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Stop a bot for a specific user
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Result
 */
async function stopBot(userId) {
    logger.log('stopBot', `Stopping bot for user ${userId}`);

    const botInfo = botClients.get(userId);
    if (!botInfo) {
        logger.log('stopBot', `No bot found for user ${userId}`);
        return { success: true, status: 'not_running' };
    }

    try {
        if (botInfo.client) {
            // Remove all listeners to prevent reconnect attempts
            botInfo.client.removeAllListeners();
            await botInfo.client.destroy();
        }
    } catch (error) {
        logger.error('stopBot', error, { userId });
    }

    botClients.delete(userId);
    systemDb.updateBotStatus(userId, 'disconnected');

    logger.log('stopBot', `Bot stopped for user ${userId}`);
    return { success: true, status: 'stopped' };
}

/**
 * Get bot for a specific user
 * @param {number} userId - User ID
 * @returns {Object|null} Bot info or null
 */
function getBot(userId) {
    return botClients.get(userId) || null;
}

/**
 * Restart a bot (stop then start)
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Result
 */
async function restartBot(userId) {
    logger.log('restartBot', `Restarting bot for user ${userId}`);
    await stopBot(userId);
    await sleep(1000);
    return startBot(userId);
}

/**
 * Get status of all bots
 * @returns {Array} Array of bot status objects
 */
function getAllBotStatus() {
    const statuses = [];
    for (const [userId, botInfo] of botClients) {
        statuses.push({
            userId,
            status: botInfo.status,
            guildCount: botInfo.guilds.length,
            guilds: botInfo.guilds.map(g => ({ id: g.id, name: g.name })),
            connectedSince: botInfo.status === 'connected' ? botInfo.connectedAt : null
        });
    }
    return statuses;
}

/**
 * Get bot status for a specific user
 * @param {number} userId - User ID
 * @returns {Object} Bot status
 */
function getBotStatus(userId) {
    const botInfo = botClients.get(userId);
    if (!botInfo) {
        // Check database for last known status
        const dbStatus = systemDb.getBotStatus(userId);
        return {
            connected: false,
            status: dbStatus?.bot_status || 'disconnected',
            lastConnected: dbStatus?.bot_last_connected || null,
            guildCount: 0,
            guilds: []
        };
    }

    return {
        connected: botInfo.status === 'connected',
        status: botInfo.status,
        guildCount: botInfo.guilds.length,
        guilds: botInfo.guilds.map(g => ({ id: g.id, name: g.name })),
        connectedSince: botInfo.connectedAt || null
    };
}

// =============================================================================
// CLIENT EVENT HANDLERS
// =============================================================================

/**
 * Set up event handlers for a Discord.js client
 * @param {Client} client - Discord.js client
 * @param {number} userId - User ID
 * @param {Object} botInfo - Bot info object
 */
function setupClientEvents(client, userId, botInfo) {
    // Ready event - bot is connected
    client.once(Events.ClientReady, () => {
        logger.log('clientReady', `Bot ready for user ${userId}, logged in as ${client.user.tag}`);

        botInfo.status = 'connected';
        botInfo.connectedAt = new Date();
        botInfo.reconnectAttempts = 0;

        // Collect guild info
        botInfo.guilds = client.guilds.cache.map(guild => ({
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount
        }));

        logger.log('clientReady', `Connected to ${botInfo.guilds.length} guilds for user ${userId}`);

        // Update database
        systemDb.updateBotStatus(userId, 'connected');

        // Register slash commands for all guilds
        registerCommandsForGuilds(client, userId, botInfo.guilds);

        // Emit WebSocket event for UI update
        if (io) {
            io.to(`user:${userId}`).emit('discord:bot:connected', {
                userId,
                botTag: client.user.tag,
                guilds: botInfo.guilds.map(g => ({ id: g.id, name: g.name }))
            });
        }
    });

    // Guild create - bot added to new guild
    client.on(Events.GuildCreate, (guild) => {
        logger.log('guildCreate', `Bot added to guild ${guild.name} (${guild.id}) for user ${userId}`);

        botInfo.guilds.push({
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount
        });

        // Register commands for new guild
        registerCommandsForGuild(client, userId, guild.id);

        if (io) {
            io.to(`user:${userId}`).emit('discord:bot:guild_added', {
                userId,
                guild: { id: guild.id, name: guild.name }
            });
        }
    });

    // Guild delete - bot removed from guild
    client.on(Events.GuildDelete, (guild) => {
        logger.log('guildDelete', `Bot removed from guild ${guild.name} (${guild.id}) for user ${userId}`);

        botInfo.guilds = botInfo.guilds.filter(g => g.id !== guild.id);

        if (io) {
            io.to(`user:${userId}`).emit('discord:bot:guild_removed', {
                userId,
                guildId: guild.id
            });
        }
    });

    // Interaction create - slash command used
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        await handleSlashCommand(interaction, userId);
    });

    // Error handling
    client.on(Events.Error, (error) => {
        logger.error('clientError', error, { userId });
    });

    // Disconnect - attempt reconnect
    client.on(Events.ShardDisconnect, (event) => {
        logger.warn('shardDisconnect', `Bot disconnected for user ${userId}`, { code: event.code });
        botInfo.status = 'disconnected';
        systemDb.updateBotStatus(userId, 'disconnected');

        if (io) {
            io.to(`user:${userId}`).emit('discord:bot:disconnected', { userId });
        }

        // Attempt auto-reconnect
        attemptReconnect(userId, botInfo);
    });
}

/**
 * Attempt to reconnect a disconnected bot
 * @param {number} userId - User ID
 * @param {Object} botInfo - Bot info object
 */
async function attemptReconnect(userId, botInfo) {
    if (botInfo.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        logger.warn('attemptReconnect', `Max reconnect attempts reached for user ${userId}`);
        systemDb.updateBotStatus(userId, 'error', 'Max reconnect attempts reached');
        return;
    }

    botInfo.reconnectAttempts++;
    const delay = RECONNECT_DELAY * botInfo.reconnectAttempts;

    logger.log('attemptReconnect', `Reconnect attempt ${botInfo.reconnectAttempts} for user ${userId} in ${delay}ms`);

    await sleep(delay);

    // Check if bot was manually stopped
    if (!botClients.has(userId)) {
        logger.log('attemptReconnect', `Bot was stopped, skipping reconnect for user ${userId}`);
        return;
    }

    try {
        await startBot(userId);
    } catch (error) {
        logger.error('attemptReconnect', error, { userId });
    }
}

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * Check if a user is rate limited for commands
 * @param {number} userId - User ID
 * @returns {Object} { limited: boolean, remaining: number, resetIn: number }
 */
function checkRateLimit(userId) {
    const now = Date.now();
    let cooldown = commandCooldowns.get(userId);

    // Reset if window expired
    if (!cooldown || now >= cooldown.resetAt) {
        cooldown = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
        commandCooldowns.set(userId, cooldown);
    }

    const remaining = RATE_LIMIT_COMMANDS - cooldown.count;
    const resetIn = Math.ceil((cooldown.resetAt - now) / 1000);

    if (cooldown.count >= RATE_LIMIT_COMMANDS) {
        return { limited: true, remaining: 0, resetIn };
    }

    // Increment counter
    cooldown.count++;
    return { limited: false, remaining: remaining - 1, resetIn };
}

/**
 * Clean up expired rate limit entries periodically
 */
function cleanupRateLimits() {
    const now = Date.now();
    for (const [userId, cooldown] of commandCooldowns) {
        if (now >= cooldown.resetAt) {
            commandCooldowns.delete(userId);
        }
    }
}

// Clean up rate limits every 5 minutes
setInterval(cleanupRateLimits, 5 * 60 * 1000);

// =============================================================================
// SLASH COMMAND HANDLING
// =============================================================================

/**
 * Register slash commands for all guilds
 * @param {Client} client - Discord.js client
 * @param {number} userId - User ID
 * @param {Array} guilds - Array of guild info
 */
async function registerCommandsForGuilds(client, userId, guilds) {
    const commands = getSlashCommands();

    for (const guild of guilds) {
        try {
            await registerCommandsForGuild(client, userId, guild.id, commands);
        } catch (error) {
            logger.error('registerCommandsForGuilds', error, { userId, guildId: guild.id });
        }
    }
}

/**
 * Register slash commands for a single guild
 * @param {Client} client - Discord.js client
 * @param {number} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Array} commands - Optional pre-built commands array
 */
async function registerCommandsForGuild(client, userId, guildId, commands = null) {
    if (!commands) {
        commands = getSlashCommands();
    }

    const rest = new REST({ version: '10' }).setToken(client.token);

    try {
        logger.log('registerCommands', `Registering ${commands.length} commands for guild ${guildId}`);

        await rest.put(
            Routes.applicationGuildCommands(client.user.id, guildId),
            { body: commands }
        );

        logger.log('registerCommands', `Commands registered successfully for guild ${guildId}`);
    } catch (error) {
        logger.error('registerCommands', error, { userId, guildId });
    }
}

/**
 * Get slash command definitions
 * @returns {Array} Array of slash command definitions
 */
function getSlashCommands() {
    return [
        {
            name: 'bracket',
            description: 'View the current tournament bracket'
        },
        {
            name: 'matches',
            description: 'List open and upcoming matches'
        },
        {
            name: 'standings',
            description: 'View current tournament standings'
        },
        {
            name: 'signup',
            description: 'Get the tournament signup link'
        }
    ];
}

/**
 * Handle a slash command interaction
 * @param {Interaction} interaction - Discord interaction
 * @param {number} userId - User ID (tenant)
 */
async function handleSlashCommand(interaction, userId) {
    const { commandName } = interaction;
    logger.log('handleSlashCommand', `Command /${commandName} from guild ${interaction.guildId} for user ${userId}`);

    // Check rate limit
    const rateLimit = checkRateLimit(userId);
    if (rateLimit.limited) {
        logger.warn('handleSlashCommand', `Rate limited user ${userId}`, { resetIn: rateLimit.resetIn });
        await interaction.reply({
            content: `⏳ Slow down! You can use bot commands again in ${rateLimit.resetIn} seconds.`,
            ephemeral: true
        });
        return;
    }

    try {
        switch (commandName) {
            case 'bracket':
                await handleBracketCommand(interaction, userId);
                break;
            case 'matches':
                await handleMatchesCommand(interaction, userId);
                break;
            case 'standings':
                await handleStandingsCommand(interaction, userId);
                break;
            case 'signup':
                await handleSignupCommand(interaction, userId);
                break;
            default:
                await interaction.reply({ content: 'Unknown command', ephemeral: true });
        }
    } catch (error) {
        logger.error('handleSlashCommand', error, { userId, command: commandName });
        try {
            await interaction.reply({ content: 'An error occurred processing your command.', ephemeral: true });
        } catch (replyError) {
            // Interaction may have already been replied to
        }
    }
}

// =============================================================================
// COMMAND IMPLEMENTATIONS
// =============================================================================

/**
 * Handle /bracket command
 */
async function handleBracketCommand(interaction, userId) {
    await interaction.deferReply();

    // Get active tournament for this user
    const tournament = await getActiveTournament(userId);
    if (!tournament) {
        await interaction.editReply('No active tournament found.');
        return;
    }

    const bracketUrl = `${process.env.EXTERNAL_URL || 'https://admin.despairhardware.com'}/u/${userId}/bracket`;

    await interaction.editReply({
        embeds: [{
            title: `${tournament.name} - Bracket`,
            description: `View the live bracket for ${tournament.name}`,
            color: 0x5865F2,
            fields: [
                { name: 'Game', value: tournament.game_name || 'N/A', inline: true },
                { name: 'Format', value: formatTournamentType(tournament.tournament_type), inline: true },
                { name: 'State', value: capitalize(tournament.state), inline: true }
            ],
            url: bracketUrl,
            timestamp: new Date().toISOString()
        }],
        components: [{
            type: 1, // ActionRow
            components: [{
                type: 2, // Button
                style: 5, // Link
                label: 'View Bracket',
                url: bracketUrl
            }]
        }]
    });
}

/**
 * Handle /matches command
 */
async function handleMatchesCommand(interaction, userId) {
    await interaction.deferReply();

    const tournament = await getActiveTournament(userId);
    if (!tournament) {
        await interaction.editReply('No active tournament found.');
        return;
    }

    // Get open matches
    const matches = matchDb.getOpenMatches(tournament.id);
    if (!matches || matches.length === 0) {
        await interaction.editReply('No open matches at the moment.');
        return;
    }

    // Get participants for name lookup
    const participants = participantDb.getByTournament(tournament.id);
    const participantMap = new Map(participants.map(p => [p.id, p]));

    // Format match list (max 10)
    const matchList = matches.slice(0, 10).map((match, idx) => {
        const p1 = participantMap.get(match.player1_id);
        const p2 = participantMap.get(match.player2_id);
        const p1Name = p1?.name || 'TBD';
        const p2Name = p2?.name || 'TBD';
        const station = match.station_id ? ` (TV ${match.station_id})` : '';
        return `${idx + 1}. **${p1Name}** vs **${p2Name}**${station}`;
    }).join('\n');

    await interaction.editReply({
        embeds: [{
            title: `${tournament.name} - Open Matches`,
            description: matchList,
            color: 0x57F287,
            footer: { text: `Showing ${Math.min(matches.length, 10)} of ${matches.length} open matches` },
            timestamp: new Date().toISOString()
        }]
    });
}

/**
 * Handle /standings command
 */
async function handleStandingsCommand(interaction, userId) {
    await interaction.deferReply();

    const tournament = await getActiveTournament(userId);
    if (!tournament) {
        await interaction.editReply('No active tournament found.');
        return;
    }

    // For elimination formats, show seeding/final ranks
    const participants = participantDb.getByTournament(tournament.id);
    if (!participants || participants.length === 0) {
        await interaction.editReply('No participants found.');
        return;
    }

    // Sort by final_rank if available, otherwise by seed
    const sorted = participants
        .filter(p => p.active !== 0)
        .sort((a, b) => {
            if (a.final_rank && b.final_rank) return a.final_rank - b.final_rank;
            if (a.final_rank) return -1;
            if (b.final_rank) return 1;
            return (a.seed || 999) - (b.seed || 999);
        })
        .slice(0, 16);

    const standingsList = sorted.map((p, idx) => {
        const rank = p.final_rank || (idx + 1);
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
        return `${medal} **${p.name}**${p.seed ? ` (Seed ${p.seed})` : ''}`;
    }).join('\n');

    await interaction.editReply({
        embeds: [{
            title: `${tournament.name} - Standings`,
            description: standingsList,
            color: 0xFEE75C,
            footer: { text: `${participants.length} participants total` },
            timestamp: new Date().toISOString()
        }]
    });
}

/**
 * Handle /signup command
 */
async function handleSignupCommand(interaction, userId) {
    const tournament = await getActiveTournament(userId);
    const signupUrl = `${process.env.EXTERNAL_URL || 'https://admin.despairhardware.com'}/u/${userId}/signup`;

    if (tournament && tournament.state === 'pending') {
        await interaction.reply({
            embeds: [{
                title: 'Tournament Signup',
                description: `Sign up for **${tournament.name}**!`,
                color: 0x5865F2,
                fields: [
                    { name: 'Game', value: tournament.game_name || 'N/A', inline: true },
                    { name: 'Participants', value: `${tournament.participant_count || 0}${tournament.signup_cap ? `/${tournament.signup_cap}` : ''}`, inline: true }
                ]
            }],
            components: [{
                type: 1,
                components: [{
                    type: 2,
                    style: 5,
                    label: 'Sign Up Now',
                    url: signupUrl
                }]
            }]
        });
    } else {
        await interaction.reply({
            content: 'No tournament is currently accepting signups.',
            ephemeral: true
        });
    }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get active tournament for a user
 * @param {number} userId - User ID
 * @returns {Object|null} Tournament or null
 */
async function getActiveTournament(userId) {
    if (!tournamentDb) return null;

    // Check for manual override
    const manualId = systemDb.getManualActiveTournamentId(userId);
    if (manualId) {
        return tournamentDb.getById(manualId);
    }

    // Get most recent underway tournament
    const tournaments = tournamentDb.list({ userId, state: 'underway' });
    if (tournaments && tournaments.length > 0) {
        return tournaments[0];
    }

    // Fall back to pending tournaments
    const pending = tournamentDb.list({ userId, state: 'pending' });
    if (pending && pending.length > 0) {
        return pending[0];
    }

    return null;
}

function formatTournamentType(type) {
    if (!type) return 'N/A';
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    init,
    start,
    stop,
    startBot,
    stopBot,
    getBot,
    restartBot,
    getBotStatus,
    getAllBotStatus,
    encryptBotToken,
    decryptBotToken
};
