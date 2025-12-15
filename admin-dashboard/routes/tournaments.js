/**
 * Tournaments Routes - TCC-Custom
 *
 * Tournament management API endpoints using local database.
 * Replaces Challonge API integration with custom bracket engine.
 * Supports multi-tenant isolation via req.tenantId.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('../services/debug-logger');
const { getTenantFilter, validateTenantAccess } = require('../middleware/tenant');

const logger = createLogger('routes:tournaments');

// Local services
const tournamentDb = require('../services/tournament-db');
const matchDb = require('../services/match-db');
const participantDb = require('../services/participant-db');
const bracketEngine = require('../services/bracket-engine');
const activeTournamentService = require('../services/active-tournament');

// Dependencies injected via init()
let pushNotifications = null;
let io = null;
let discordNotify = null;

/**
 * Initialize tournaments routes with dependencies
 */
function init(deps) {
    pushNotifications = deps.pushNotifications;
    io = deps.io;
    discordNotify = deps.discordNotify;
}

// WebSocket event types (must match frontend WS_EVENTS)
const WS_EVENTS = {
    TOURNAMENT_CREATED: 'tournament:created',
    TOURNAMENT_UPDATED: 'tournament:updated',
    TOURNAMENT_DELETED: 'tournament:deleted',
    TOURNAMENT_STARTED: 'tournament:started',
    TOURNAMENT_RESET: 'tournament:reset',
    TOURNAMENT_COMPLETED: 'tournament:completed',
    TOURNAMENT_ACTIVATED: 'tournament:activated'
};

// Helper to broadcast tournament updates with specific event types
function broadcastTournament(eventType, tournament, extra = {}) {
    if (io) {
        io.emit(eventType, { tournament, ...extra });
        // Also emit generic update for backward compatibility
        io.emit('tournament:update', { tournamentId: tournament?.id, action: eventType, ...extra });
    }
}

/**
 * Broadcast tournament data to user's displays (Always-Live Displays feature)
 * This sends full tournament + matches data to match/bracket displays
 * @param {Object} tournament - Tournament object
 * @param {number} userId - User ID for targeting
 */
function broadcastTournamentDataToDisplays(tournament, userId) {
    if (!io || !tournament || !userId) return;

    try {
        // Get tournament data for displays
        const participants = participantDb.getByTournament(tournament.id);
        const matches = matchDb.getByTournament(tournament.id);

        // Build participant lookup
        const participantsCache = {};
        participants.forEach(p => {
            participantsCache[String(p.id)] = p.name || p.display_name || `Seed ${p.seed}`;
        });

        // Transform matches to camelCase for frontend
        const transformedMatches = matches.map(m => ({
            id: m.id,
            state: m.state,
            round: m.round,
            identifier: m.identifier,
            suggestedPlayOrder: m.suggested_play_order || 9999,
            player1Id: m.player1_id,
            player2Id: m.player2_id,
            player1Name: participantsCache[String(m.player1_id)] || 'TBD',
            player2Name: participantsCache[String(m.player2_id)] || 'TBD',
            stationId: m.station_id,
            underwayAt: m.underway_at,
            winnerId: m.winner_id
        }));

        // Get active mode for this user
        const activeResult = activeTournamentService.getActiveTournament(userId);

        // Broadcast to user's displays
        io.to(`user:${userId}`).emit('tournament:activated', {
            tournament: {
                id: tournament.id,
                url_slug: tournament.url_slug,
                name: tournament.name,
                game_name: tournament.game_name,
                tournament_type: tournament.tournament_type,
                state: tournament.state,
                bracketUrl: `${process.env.EXTERNAL_URL || ''}/u/${userId}/bracket`
            },
            participants: participants,
            matches: transformedMatches,
            mode: activeResult.mode,
            timestamp: new Date().toISOString()
        });

        logger.log('broadcastToDisplays', {
            userId,
            tournamentId: tournament.id,
            tournamentName: tournament.name,
            matchCount: matches.length,
            participantCount: participants.length
        });
    } catch (error) {
        logger.error('broadcastToDisplays', error, { tournamentId: tournament?.id, userId });
    }
}

/**
 * Check if tournament is the user's active tournament and broadcast if so
 * Call this after tournament mutations to keep displays in sync
 * @param {Object} tournament - Tournament object
 * @param {number} userId - User ID
 */
function broadcastIfActiveTournament(tournament, userId) {
    if (!tournament || !userId) return;

    const activeResult = activeTournamentService.getActiveTournament(userId);
    if (activeResult.tournament && activeResult.tournament.id === tournament.id) {
        broadcastTournamentDataToDisplays(tournament, userId);
    }
}

/**
 * Find a flyer matching the game name for auto-deploy
 * Searches user's flyer directory for filenames containing the game name
 * @param {string} gameName - Game name to match against
 * @param {number} userId - User ID for multi-tenant flyer directory
 * @returns {Promise<string|null>} Matching flyer filename or null
 */
async function findMatchingFlyer(gameName, userId) {
    if (!gameName || !userId) return null;

    const ALLOWED_FLYER_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.mp4'];
    const userFlyersPath = path.join(process.env.FLYERS_PATH, String(userId));

    try {
        // Check if directory exists
        await fs.access(userFlyersPath);

        // Read all files in user's flyer directory
        const files = await fs.readdir(userFlyersPath);

        // Normalize game name for matching (lowercase, remove special chars)
        const normalizedGame = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Common game abbreviations for better matching
        const gameAbbreviations = {
            'supersmashbrosultimate': ['ssbu', 'smashultimate', 'ultimate'],
            'supersmashbrosmelee': ['melee', 'ssbm'],
            'mariokartworld': ['mkw', 'mariokart'],
            'mariokart8deluxe': ['mk8dx', 'mk8', 'mariokart8'],
            'streetfighter6': ['sf6', 'streetfighter'],
            'tekken8': ['t8', 'tekken'],
            'guiltygearstrive': ['ggst', 'guiltygear'],
            'mortalkombat1': ['mk1', 'mortalkombat'],
            'granblueversusrising': ['gbvsr', 'granblue']
        };

        // Build list of search terms
        const searchTerms = [normalizedGame];
        if (gameAbbreviations[normalizedGame]) {
            searchTerms.push(...gameAbbreviations[normalizedGame]);
        }
        // Also add first letters of each word as abbreviation (e.g., "Super Smash Bros Ultimate" -> "ssbu")
        const words = gameName.toLowerCase().split(/\s+/);
        if (words.length > 1) {
            searchTerms.push(words.map(w => w[0]).join(''));
        }

        // Find matching flyer (prioritize exact matches, then partial)
        let bestMatch = null;

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (!ALLOWED_FLYER_EXTENSIONS.includes(ext)) continue;

            const normalizedFilename = file.toLowerCase().replace(/[^a-z0-9]/g, '');

            for (const term of searchTerms) {
                if (normalizedFilename.includes(term)) {
                    bestMatch = file;
                    // If we found an exact-ish match with the full game name, return immediately
                    if (normalizedFilename.includes(normalizedGame)) {
                        return file;
                    }
                    break;
                }
            }
        }

        return bestMatch;
    } catch (error) {
        // Directory doesn't exist or other error - no matching flyer
        logger.log('findMatchingFlyer:notFound', { gameName, userId, error: error.message });
        return null;
    }
}

// ============================================
// GET /api/tournaments - List all tournaments
// Filtered by tenant (user_id) unless superadmin viewing all
// ============================================
router.get('/', async (req, res) => {
    try {
        const state = req.query.state;
        const gameId = req.query.game_id;
        const limit = parseInt(req.query.limit) || 100;

        const filters = { limit };

        if (state) {
            // Support comma-separated states
            filters.state = state.includes(',') ? state.split(',') : state;
        }

        if (gameId) {
            filters.game_id = parseInt(gameId);
        }

        // Get tenant filter (null for superadmin viewing all, userId otherwise)
        const tenantFilter = getTenantFilter(req);

        const tournaments = tournamentDb.list(filters, tenantFilter);
        const transformed = tournaments.map(t => transformTournament(t));

        // Group tournaments by state for frontend
        const grouped = {
            pending: transformed.filter(t => t.state === 'pending' || t.state === 'checking_in'),
            inProgress: transformed.filter(t => t.state === 'underway' || t.state === 'awaiting_review'),
            completed: transformed.filter(t => t.state === 'complete')
        };

        res.json({
            success: true,
            tournaments: grouped,
            count: tournaments.length,
            source: 'local',
            tenantFiltered: tenantFilter !== null
        });
    } catch (error) {
        logger.error('list', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/tournaments/create - Create tournament
// ============================================
router.post('/create', async (req, res) => {
    try {
        // Frontend sends camelCase, we map to snake_case for database
        const {
            name,
            gameName,
            tournamentType,
            description,
            startAt,
            signupCap,
            openSignup,
            checkInDuration,
            holdThirdPlaceMatch,
            grandFinalsModifier,
            swissRounds,
            rankedBy,
            hideSeeds,
            sequentialPairings,
            showRounds,
            autoAssign,
            byeStrategy,
            compactBracket,
            seedingSource,
            seedingConfig,
            // Two-stage tournament options
            groupCount,
            advancePerGroup,
            knockoutFormat,
            // Free-for-all options
            playersPerMatch,
            totalRounds,
            pointsSystem,
            // Leaderboard options
            rankingType,
            decayEnabled,
            decayRate,
            minEventsToRank
        } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Tournament name is required'
            });
        }

        // Normalize tournament type: "single elimination" -> "single_elimination"
        const normalizedType = (tournamentType || 'double_elimination')
            .toLowerCase()
            .replace(/\s+/g, '_');

        // Create tournament with snake_case field names for database
        // Pass userId for tenant isolation (req.tenantId set by tenant middleware)
        const userId = req.tenantId || req.session?.userId || null;

        // Build format settings JSON for bracket-specific options
        const formatSettings = {};
        if (byeStrategy && byeStrategy !== 'traditional') {
            formatSettings.byeStrategy = byeStrategy;
        }
        if (compactBracket) {
            formatSettings.compactBracket = true;
        }
        if (seedingSource && seedingSource !== 'manual') {
            formatSettings.seedingSource = seedingSource;
            if (seedingConfig) {
                formatSettings.seedingConfig = seedingConfig;
            }
        }

        const tournament = tournamentDb.create({
            name,
            game_name: gameName,
            tournament_type: normalizedType,
            description,
            starts_at: startAt,
            signup_cap: signupCap,
            open_signup: !!openSignup,
            check_in_duration: checkInDuration,
            hold_third_place_match: !!holdThirdPlaceMatch,
            grand_finals_modifier: grandFinalsModifier,
            swiss_rounds: swissRounds,
            ranked_by: rankedBy,
            hide_seeds: !!hideSeeds,
            sequential_pairings: !!sequentialPairings,
            show_rounds: !!showRounds,
            auto_assign: !!autoAssign,
            // Two-stage tournament options
            group_count: groupCount,
            advance_per_group: advancePerGroup,
            knockout_format: knockoutFormat,
            // Free-for-all options
            players_per_match: playersPerMatch,
            total_rounds: totalRounds,
            points_system_json: pointsSystem ? JSON.stringify(pointsSystem) : null,
            // Format settings - combine all format-specific options
            format_settings_json: (() => {
                const settings = { ...formatSettings };
                // Add leaderboard options if applicable
                if (normalizedType === 'leaderboard') {
                    settings.rankingType = rankingType || 'points';
                    settings.decayEnabled = !!decayEnabled;
                    settings.decayRate = decayRate || 10;
                    settings.minEventsToRank = minEventsToRank || 1;
                }
                return Object.keys(settings).length > 0 ? JSON.stringify(settings) : null;
            })()
        }, userId);

        logger.log('create:success', {
            id: tournament.id,
            name: tournament.name,
            urlSlug: tournament.url_slug,
            type: tournament.tournament_type
        });

        // Broadcast creation
        broadcastTournament(WS_EVENTS.TOURNAMENT_CREATED, transformTournament(tournament));

        res.json({
            success: true,
            tournament: transformTournament(tournament),
            message: 'Tournament created successfully'
        });
    } catch (error) {
        logger.error('create', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// ACTIVE TOURNAMENT ROUTES - Must be defined before /:tournamentId
// These routes manage the "always-live displays" feature
// ============================================

// GET /api/tournament/active - Get current active tournament
// Returns the active tournament (auto-selected or manually set)
router.get('/active', async (req, res) => {
    try {
        const userId = req.tenantId || req.session?.userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const result = activeTournamentService.getActiveTournament(userId);

        logger.log('getActive:success', {
            userId,
            tournamentId: result.tournament?.id || null,
            mode: result.mode
        });

        // Count connected displays for this user
        let displaysSynced = 0;
        if (io) {
            const room = io.sockets.adapter.rooms.get(`user:${userId}`);
            displaysSynced = room ? room.size : 0;
        }

        res.json({
            success: true,
            tournament: result.tournament ? transformTournament(result.tournament) : null,
            mode: result.mode,
            displaysSynced
        });
    } catch (error) {
        logger.error('getActive', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/tournament/activate/auto - Revert to auto-select mode
// NOTE: This route MUST come before /activate/:tournamentId to avoid "auto" being matched as an ID
router.post('/activate/auto', async (req, res) => {
    try {
        const userId = req.tenantId || req.session?.userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const result = activeTournamentService.revertToAutoSelect(userId);

        logger.log('activateAuto:success', {
            userId,
            tournamentId: result.tournament?.id || null
        });

        // Get participants for broadcast if there's an active tournament
        let participants = [];
        if (result.tournament) {
            try {
                participants = participantDb.getByTournament(result.tournament.id);
            } catch (pErr) {
                logger.warn('activateAuto:participantsFetchFailed', { error: pErr.message });
            }

            // Write tournament-state.json for backward compatibility
            await writeTournamentStateFile(result.tournament);
        } else {
            // Clear state file when no active tournament
            await clearTournamentStateFile();
        }

        // Count connected displays for this user
        let displaysSynced = 0;
        if (io) {
            const room = io.sockets.adapter.rooms.get(`user:${userId}`);
            displaysSynced = room ? room.size : 0;

            // Broadcast to all user's displays
            io.to(`user:${userId}`).emit(WS_EVENTS.TOURNAMENT_ACTIVATED, {
                tournament: result.tournament ? transformTournament(result.tournament) : null,
                participants,
                mode: 'auto',
                timestamp: new Date().toISOString()
            });

            logger.log('activateAuto:broadcast', { userId, displaysSynced });
        }

        res.json({
            success: true,
            message: 'Reverted to auto-select',
            tournament: result.tournament ? transformTournament(result.tournament) : null,
            mode: 'auto',
            displaysSynced
        });
    } catch (error) {
        logger.error('activateAuto', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/tournament/activate/:tournamentId - Manually activate a tournament
// Sets this tournament as the active one (manual override)
router.post('/activate/:tournamentId', async (req, res) => {
    try {
        const userId = req.tenantId || req.session?.userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const { tournamentId } = req.params;

        // Resolve tournament (support both ID and slug)
        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Set as active (this validates ownership internally)
        const result = activeTournamentService.setActiveTournament(userId, tournament.id);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        logger.log('activate:success', {
            userId,
            tournamentId: tournament.id,
            name: tournament.name
        });

        // Get participants for broadcast
        let participants = [];
        try {
            participants = participantDb.getByTournament(tournament.id);
        } catch (pErr) {
            logger.warn('activate:participantsFetchFailed', { error: pErr.message });
        }

        // Write tournament-state.json for backward compatibility
        await writeTournamentStateFile(tournament);

        // Count connected displays for this user
        let displaysSynced = 0;
        if (io) {
            const room = io.sockets.adapter.rooms.get(`user:${userId}`);
            displaysSynced = room ? room.size : 0;

            // Broadcast to all user's displays
            io.to(`user:${userId}`).emit(WS_EVENTS.TOURNAMENT_ACTIVATED, {
                tournament: transformTournament(tournament),
                participants,
                mode: 'manual',
                timestamp: new Date().toISOString()
            });

            logger.log('activate:broadcast', { userId, displaysSynced });
        }

        res.json({
            success: true,
            message: 'Tournament activated (manual override)',
            tournament: transformTournament(tournament),
            mode: 'manual',
            displaysSynced
        });
    } catch (error) {
        logger.error('activate', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET /api/tournaments/:tournamentId - Get tournament details
// Validates tenant access unless public or superadmin viewing all
// ============================================
router.get('/:tournamentId', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        // Support both numeric ID and URL slug
        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Validate tenant access (allows superadmin or owner)
        if (!validateTenantAccess(req, tournament.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied - tournament belongs to another user'
            });
        }

        const stats = tournamentDb.getStats(tournament.id);

        res.json({
            success: true,
            tournament: transformTournament(tournament),
            stats
        });
    } catch (error) {
        logger.error('get', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// PUT /api/tournaments/:tournamentId - Update tournament
// Validates tenant access
// ============================================
router.put('/:tournamentId', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Validate tenant access (allows superadmin or owner)
        if (!validateTenantAccess(req, tournament.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied - tournament belongs to another user'
            });
        }

        // Only allow updates for pending tournaments
        const isPending = tournament.state === 'pending' || tournament.state === 'checking_in';
        if (!isPending) {
            return res.status(400).json({
                success: false,
                error: `Cannot update tournament in ${tournament.state} state`
            });
        }

        // Map camelCase from frontend to snake_case for database
        const {
            name,
            gameName,
            tournamentType,
            description,
            startAt,
            signupCap,
            openSignup,
            checkInDuration,
            holdThirdPlaceMatch,
            grandFinalsModifier,
            swissRounds,
            rankedBy,
            hideSeeds,
            sequentialPairings,
            showRounds,
            autoAssign,
            privateTournament,
            byeStrategy,
            compactBracket,
            seedingSource,
            seedingConfig
        } = req.body;

        // Build update object with snake_case keys
        const updateData = {};

        if (name !== undefined) updateData.name = name;
        if (gameName !== undefined) updateData.game_name = gameName;
        if (description !== undefined) updateData.description = description;
        if (startAt !== undefined) updateData.starts_at = startAt;
        if (signupCap !== undefined) updateData.signup_cap = signupCap;
        if (openSignup !== undefined) updateData.open_signup = !!openSignup;
        if (checkInDuration !== undefined) updateData.check_in_duration = checkInDuration;
        if (holdThirdPlaceMatch !== undefined) updateData.hold_third_place_match = !!holdThirdPlaceMatch;
        if (grandFinalsModifier !== undefined) updateData.grand_finals_modifier = grandFinalsModifier;
        if (swissRounds !== undefined) updateData.swiss_rounds = swissRounds;
        if (rankedBy !== undefined) updateData.ranked_by = rankedBy;
        if (hideSeeds !== undefined) updateData.hide_seeds = !!hideSeeds;
        if (sequentialPairings !== undefined) updateData.sequential_pairings = !!sequentialPairings;
        if (showRounds !== undefined) updateData.show_rounds = !!showRounds;
        if (autoAssign !== undefined) updateData.auto_assign = !!autoAssign;
        if (privateTournament !== undefined) updateData.private = !!privateTournament;

        // Tournament type can only be changed for pending tournaments
        if (tournamentType !== undefined && isPending) {
            // Normalize: "single elimination" -> "single_elimination"
            updateData.tournament_type = tournamentType.toLowerCase().replace(/\s+/g, '_');
        }

        // Handle format settings updates
        if (byeStrategy !== undefined || compactBracket !== undefined || seedingSource !== undefined) {
            // Get existing format settings or start fresh
            const existingSettings = tournament.format_settings || {};
            const formatSettings = { ...existingSettings };

            if (byeStrategy !== undefined) {
                if (byeStrategy === 'traditional' || !byeStrategy) {
                    delete formatSettings.byeStrategy;
                } else {
                    formatSettings.byeStrategy = byeStrategy;
                }
            }
            if (compactBracket !== undefined) {
                if (!compactBracket) {
                    delete formatSettings.compactBracket;
                } else {
                    formatSettings.compactBracket = true;
                }
            }
            if (seedingSource !== undefined) {
                if (seedingSource === 'manual' || !seedingSource) {
                    delete formatSettings.seedingSource;
                    delete formatSettings.seedingConfig;
                } else {
                    formatSettings.seedingSource = seedingSource;
                    if (seedingConfig) {
                        formatSettings.seedingConfig = seedingConfig;
                    }
                }
            }

            updateData.format_settings_json = Object.keys(formatSettings).length > 0 ? formatSettings : null;
        }

        const updatedTournament = tournamentDb.update(tournament.id, updateData);

        logger.log('update:success', {
            id: updatedTournament.id,
            name: updatedTournament.name,
            fields: Object.keys(updateData)
        });

        // Broadcast update
        broadcastTournament(WS_EVENTS.TOURNAMENT_UPDATED, transformTournament(updatedTournament));

        res.json({
            success: true,
            tournament: transformTournament(updatedTournament)
        });
    } catch (error) {
        logger.error('update', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/tournaments/:tournamentId/start - Start tournament
// Validates tenant access
// ============================================
router.post('/:tournamentId/start', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Validate tenant access (allows superadmin or owner)
        if (!validateTenantAccess(req, tournament.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied - tournament belongs to another user'
            });
        }

        // Check if can start
        const canStartResult = tournamentDb.canStart(tournament.id);
        if (!canStartResult.canStart) {
            return res.status(400).json({
                success: false,
                error: canStartResult.reason
            });
        }

        // Get participants
        const participants = participantDb.getActiveByTournament(tournament.id);

        // Build bracket options from tournament settings and format_settings
        const bracketOptions = {
            hold_third_place_match: tournament.hold_third_place_match,
            grand_finals_modifier: tournament.grand_finals_modifier,
            sequential_pairings: tournament.sequential_pairings,
            swiss_rounds: tournament.swiss_rounds,
            ranked_by: tournament.ranked_by
        };

        // Include format settings (byeStrategy, compactBracket, etc.)
        if (tournament.format_settings) {
            if (tournament.format_settings.byeStrategy) {
                bracketOptions.byeStrategy = tournament.format_settings.byeStrategy;
            }
            if (tournament.format_settings.compactBracket) {
                bracketOptions.compactBracket = tournament.format_settings.compactBracket;
            }
        }

        // Generate bracket
        const bracket = bracketEngine.generate(tournament.tournament_type, participants, bracketOptions);

        // Create matches in database
        const matchIds = matchDb.bulkCreate(tournament.id, bracket.matches);

        // Update prereq match IDs (they were generated with temporary IDs)
        // Map temporary IDs to real IDs
        const idMap = {};
        bracket.matches.forEach((m, index) => {
            idMap[m.id] = matchIds[index];
        });

        // Update matches with real prereq IDs
        bracket.matches.forEach((m, index) => {
            if (m.player1_prereq_match_id !== null || m.player2_prereq_match_id !== null) {
                matchDb.updatePrereqs(matchIds[index], {
                    player1_prereq_match_id: m.player1_prereq_match_id !== null ? idMap[m.player1_prereq_match_id] : null,
                    player2_prereq_match_id: m.player2_prereq_match_id !== null ? idMap[m.player2_prereq_match_id] : null,
                    player1_is_prereq_loser: m.player1_is_prereq_loser,
                    player2_is_prereq_loser: m.player2_is_prereq_loser
                });
            }
        });

        // Update tournament state
        const updatedTournament = tournamentDb.updateState(tournament.id, 'underway');

        logger.log('start:success', {
            id: updatedTournament.id,
            name: updatedTournament.name,
            type: updatedTournament.tournament_type,
            participantCount: participants.length,
            matchCount: matchIds.length
        });

        // Broadcast update
        broadcastTournament(WS_EVENTS.TOURNAMENT_STARTED, transformTournament(updatedTournament), {
            matchCount: matchIds.length
        });

        // Send push notification
        if (pushNotifications) {
            pushNotifications.sendNotification({
                title: 'Tournament Started',
                body: `${updatedTournament.name} has begun with ${participants.length} participants!`,
                type: 'tournament_started'
            });
        }

        // Send Discord notification
        if (discordNotify) {
            discordNotify.notifyTournamentStart(tournament.user_id, updatedTournament).catch(err => {
                logger.error('discordNotifyStart', err, { tournamentId: tournament.id });
            });
        }

        // Auto-assign stations to first round matches if enabled
        const autoAssigned = matchDb.autoAssignStations(tournament.id);
        if (autoAssigned.length > 0) {
            logger.log('start:autoAssigned', { count: autoAssigned.length, assignments: autoAssigned });
        }

        // Always-Live Displays: Broadcast tournament data to user's displays
        // Underway tournaments become active automatically via auto-select
        broadcastTournamentDataToDisplays(updatedTournament, tournament.user_id);

        // Write tournament-state.json for backward compatibility
        try {
            await writeTournamentStateFile(updatedTournament);
        } catch (stateFileErr) {
            logger.warn('start:stateFileError', { error: stateFileErr.message });
        }

        // Auto-deploy: Find and activate matching flyer based on game name
        let autoDeployedFlyer = null;
        if (tournament.user_id && tournament.game_name) {
            try {
                const matchingFlyer = await findMatchingFlyer(tournament.game_name, tournament.user_id);
                if (matchingFlyer) {
                    // Emit WebSocket event to activate the flyer on user's displays
                    if (io) {
                        io.to(`user:${tournament.user_id}:flyer`).emit('flyer:activated', {
                            flyer: matchingFlyer,
                            userId: tournament.user_id,
                            timestamp: new Date().toISOString(),
                            autoDeployed: true
                        });
                        logger.log('start:autoDeployFlyer', {
                            flyer: matchingFlyer,
                            gameName: tournament.game_name,
                            userId: tournament.user_id
                        });
                        autoDeployedFlyer = matchingFlyer;
                    }
                } else {
                    logger.log('start:noMatchingFlyer', { gameName: tournament.game_name, userId: tournament.user_id });
                }
            } catch (flyerErr) {
                logger.warn('start:autoDeployFlyerFailed', { error: flyerErr.message });
                // Don't fail the start - auto-deploy is optional enhancement
            }
        }

        res.json({
            success: true,
            tournament: transformTournament(updatedTournament),
            bracket: {
                type: bracket.type,
                matchCount: matchIds.length,
                stats: bracket.stats
            },
            autoDeployedFlyer: autoDeployedFlyer || undefined
        });
    } catch (error) {
        logger.error('start', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/tournaments/:tournamentId/reset - Reset tournament
// Validates tenant access
// ============================================
router.post('/:tournamentId/reset', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Validate tenant access (allows superadmin or owner)
        if (!validateTenantAccess(req, tournament.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied - tournament belongs to another user'
            });
        }

        const canResetResult = tournamentDb.canReset(tournament.id);
        if (!canResetResult.canReset) {
            return res.status(400).json({
                success: false,
                error: canResetResult.reason
            });
        }

        // Clear station match assignments first (foreign key constraint)
        const stationDb = require('../services/station-db');
        const stations = stationDb.getByTournament(tournament.id);
        stations.forEach(s => {
            if (s.current_match_id) {
                stationDb.clearMatch(s.id);
            }
        });

        // Delete all matches
        const deletedMatches = matchDb.deleteByTournament(tournament.id);

        // Reset participant final ranks
        const participants = participantDb.getByTournament(tournament.id);
        participants.forEach(p => {
            participantDb.update(p.id, { final_rank: null });
        });

        // Reset tournament state
        const updatedTournament = tournamentDb.update(tournament.id, {
            state: 'pending',
            started_at: null,
            completed_at: null
        });

        logger.log('reset:success', {
            id: updatedTournament.id,
            name: updatedTournament.name,
            deletedMatches
        });

        // Broadcast tournament reset event
        broadcastTournament(WS_EVENTS.TOURNAMENT_RESET, transformTournament(updatedTournament), {
            deletedMatches
        });

        // Always-Live Displays: Broadcast to user's displays (multi-tenant)
        // Send empty matches to clear the display since tournament is reset to pending
        if (io && tournament.user_id) {
            io.to(`user:${tournament.user_id}`).emit('matches:update', {
                tournamentId: updatedTournament.url_slug,
                matches: [],
                podium: { isComplete: false },
                timestamp: new Date().toISOString(),
                source: 'reset'
            });
            logger.log('reset:matchesBroadcast', { tournamentId: updatedTournament.url_slug, userId: tournament.user_id });
        }

        // Broadcast tournament data if this is still the active tournament
        broadcastIfActiveTournament(updatedTournament, tournament.user_id);

        // Write tournament-state.json if this is still the active tournament
        const activeResult = activeTournamentService.getActiveTournament(tournament.user_id);
        if (activeResult.tournament && activeResult.tournament.id === tournament.id) {
            try {
                await writeTournamentStateFile(updatedTournament);
            } catch (stateFileErr) {
                logger.warn('reset:stateFileError', { error: stateFileErr.message });
            }
        }

        res.json({
            success: true,
            tournament: transformTournament(updatedTournament),
            deletedMatches
        });
    } catch (error) {
        logger.error('reset', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/tournaments/:tournamentId/complete - Finalize tournament
// Validates tenant access
// ============================================
router.post('/:tournamentId/complete', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Validate tenant access (allows superadmin or owner)
        if (!validateTenantAccess(req, tournament.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied - tournament belongs to another user'
            });
        }

        if (tournament.state !== 'underway' && tournament.state !== 'awaiting_review') {
            return res.status(400).json({
                success: false,
                error: `Cannot complete tournament in ${tournament.state} state`
            });
        }

        // Check if all matches are complete
        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        const isComplete = bracketEngine.isTournamentComplete(
            tournament.tournament_type,
            matches,
            { totalRounds: tournament.swiss_rounds }
        );

        if (!isComplete) {
            return res.status(400).json({
                success: false,
                error: 'Not all matches are complete'
            });
        }

        // Calculate final ranks
        const ranks = bracketEngine.calculateFinalRanks(
            tournament.tournament_type,
            matches,
            participants
        );

        // Update participant final ranks
        participantDb.setFinalRanks(tournament.id, ranks);

        // Update tournament state
        const updatedTournament = tournamentDb.updateState(tournament.id, 'complete');

        logger.log('complete:success', {
            id: updatedTournament.id,
            name: updatedTournament.name,
            matchCount: matches.length,
            participantCount: participants.length
        });

        // Broadcast update
        broadcastTournament(WS_EVENTS.TOURNAMENT_COMPLETED, transformTournament(updatedTournament), {
            rankings: ranks
        });

        // Send push notification
        if (pushNotifications) {
            // Get winner name
            const winnerId = Object.entries(ranks).find(([, rank]) => rank === 1)?.[0];
            const winner = participants.find(p => p.id === parseInt(winnerId));

            pushNotifications.sendNotification({
                title: 'Tournament Complete!',
                body: winner
                    ? `${updatedTournament.name} has ended. Winner: ${winner.name}!`
                    : `${updatedTournament.name} has been completed!`,
                type: 'tournament_ended'
            });
        }

        // Send Discord notification with standings
        if (discordNotify) {
            // Build standings array from ranks
            const standings = Object.entries(ranks)
                .map(([participantId, rank]) => {
                    const participant = participants.find(p => p.id === parseInt(participantId));
                    return { rank, name: participant?.name || 'Unknown', participantId: parseInt(participantId) };
                })
                .sort((a, b) => a.rank - b.rank)
                .slice(0, 8); // Top 8 for Discord

            discordNotify.notifyTournamentComplete(tournament.user_id, updatedTournament, standings).catch(err => {
                logger.error('discordNotifyComplete', err, { tournamentId: tournament.id });
            });
        }

        // Always-Live Displays: Handle tournament completion
        // Clear manual override if this was the active tournament, auto-select will pick next
        if (tournament.user_id) {
            activeTournamentService.handleTournamentCompleted(tournament.user_id, tournament.id);

            // Update tournament-state.json for next active tournament (or clear if none)
            try {
                const nextActive = activeTournamentService.getActiveTournament(tournament.user_id);
                if (nextActive.tournament) {
                    await writeTournamentStateFile(nextActive.tournament);
                } else {
                    await clearTournamentStateFile();
                }
            } catch (stateFileErr) {
                logger.warn('complete:stateFileError', { error: stateFileErr.message });
            }

            // Broadcast final state to displays with podium
            const podium = {
                isComplete: true,
                first: null,
                second: null,
                third: null
            };

            // Find top 3 from ranks
            Object.entries(ranks).forEach(([participantId, rank]) => {
                const participant = participants.find(p => p.id === parseInt(participantId));
                if (rank === 1) podium.first = participant?.name || 'Unknown';
                if (rank === 2) podium.second = participant?.name || 'Unknown';
                if (rank === 3) podium.third = participant?.name || 'Unknown';
            });

            if (io) {
                io.to(`user:${tournament.user_id}`).emit('matches:update', {
                    tournamentId: updatedTournament.url_slug,
                    matches: matches.map(m => ({
                        id: m.id,
                        state: m.state,
                        round: m.round,
                        identifier: m.identifier,
                        winnerId: m.winner_id
                    })),
                    podium,
                    timestamp: new Date().toISOString(),
                    source: 'complete'
                });
            }
        }

        res.json({
            success: true,
            tournament: transformTournament(updatedTournament),
            rankings: ranks
        });
    } catch (error) {
        logger.error('complete', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// DELETE /api/tournaments/:tournamentId - Delete tournament
// Validates tenant access
// ============================================
router.delete('/:tournamentId', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Validate tenant access (allows superadmin or owner)
        if (!validateTenantAccess(req, tournament.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied - tournament belongs to another user'
            });
        }

        const name = tournament.name;
        const deleted = tournamentDb.delete(tournament.id);

        if (!deleted) {
            return res.status(500).json({
                success: false,
                error: 'Failed to delete tournament'
            });
        }

        logger.log('delete:success', { id: tournament.id, name });

        // Broadcast update
        broadcastTournament(WS_EVENTS.TOURNAMENT_DELETED, null, {
            tournamentId: tournament.id,
            name
        });

        // Update tournament-state.json if this was the active tournament
        if (tournament.user_id) {
            try {
                const nextActive = activeTournamentService.getActiveTournament(tournament.user_id);
                if (nextActive.tournament) {
                    await writeTournamentStateFile(nextActive.tournament);
                } else {
                    await clearTournamentStateFile();
                }
            } catch (stateFileErr) {
                logger.warn('delete:stateFileError', { error: stateFileErr.message });
            }
        }

        res.json({
            success: true,
            message: `Tournament "${name}" deleted successfully`
        });
    } catch (error) {
        logger.error('delete', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET /api/tournaments/:tournamentId/bracket - Get bracket visualization data
// ============================================
router.get('/:tournamentId/bracket', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        const visualizationData = bracketEngine.getVisualizationData(
            tournament.tournament_type,
            matches,
            participants
        );

        res.json({
            success: true,
            tournament: {
                id: tournament.id,
                name: tournament.name,
                type: tournament.tournament_type,
                state: tournament.state
            },
            bracket: visualizationData
        });
    } catch (error) {
        logger.error('bracket', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET /api/tournaments/:tournamentId/standings - Get current standings
// ============================================
router.get('/:tournamentId/standings', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        const standings = bracketEngine.getStandings(
            tournament.tournament_type,
            matches,
            participants,
            { rankedBy: tournament.ranked_by }
        );

        res.json({
            success: true,
            standings
        });
    } catch (error) {
        logger.error('standings', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET /api/tournament/:tournamentId/round-labels - Get custom round labels
// Returns custom labels and computed defaults for each round
// ============================================
router.get('/:tournamentId/round-labels', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Get current matches to determine round counts
        const matches = matchDb.getByTournament(tournament.id);

        // Calculate max rounds for winners and losers brackets
        let maxRounds = { winners: 0, losers: 0 };

        if (matches.length > 0) {
            const winnersMatches = matches.filter(m => !m.losers_bracket);
            const losersMatches = matches.filter(m => m.losers_bracket);

            maxRounds.winners = winnersMatches.length > 0
                ? Math.max(...winnersMatches.map(m => m.round))
                : 0;
            maxRounds.losers = losersMatches.length > 0
                ? Math.max(...losersMatches.map(m => m.round))
                : 0;
        } else {
            // Estimate rounds from participant count
            const participantCount = tournament.participants_count || 0;
            if (participantCount > 0) {
                maxRounds.winners = Math.ceil(Math.log2(participantCount));
                if (tournament.tournament_type === 'double_elimination') {
                    // Losers bracket has roughly 2x the rounds
                    maxRounds.losers = maxRounds.winners * 2 - 1;
                }
            }
        }

        // Get stored custom labels
        const customLabels = tournamentDb.getRoundLabels(tournament.id) || {};

        // Build labels response with defaults and custom values
        const labels = {
            winners: {},
            losers: {}
        };

        // Helper to compute default round name
        const getDefaultRoundName = (round, maxRound, bracketType) => {
            const roundsFromEnd = maxRound - round;
            if (bracketType === 'losers') {
                return `Losers Round ${round}`;
            }
            switch (roundsFromEnd) {
                case 0: return 'Finals';
                case 1: return 'Semi-Finals';
                case 2: return 'Quarter-Finals';
                default: return `Round ${round}`;
            }
        };

        // Build winners bracket labels
        for (let round = 1; round <= maxRounds.winners; round++) {
            const roundStr = String(round);
            labels.winners[roundStr] = {
                default: getDefaultRoundName(round, maxRounds.winners, 'winners'),
                custom: customLabels.winners?.[roundStr] || null
            };
        }

        // Build losers bracket labels (for double elimination)
        if (tournament.tournament_type === 'double_elimination' && maxRounds.losers > 0) {
            for (let round = 1; round <= maxRounds.losers; round++) {
                const roundStr = String(round);
                labels.losers[roundStr] = {
                    default: getDefaultRoundName(round, maxRounds.losers, 'losers'),
                    custom: customLabels.losers?.[roundStr] || null
                };
            }
        }

        res.json({
            success: true,
            tournamentId: tournament.id,
            tournamentType: tournament.tournament_type,
            maxRounds,
            labels,
            customLabels
        });
    } catch (error) {
        logger.error('getRoundLabels', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// PUT /api/tournament/:tournamentId/round-labels - Update custom round labels
// ============================================
router.put('/:tournamentId/round-labels', async (req, res) => {
    try {
        const { tournamentId } = req.params;
        const { winners, losers } = req.body;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        // Validate tenant access (allows superadmin or owner)
        if (!validateTenantAccess(req, tournament.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied - tournament belongs to another user'
            });
        }

        // Build labels object
        const labels = {};
        if (winners && typeof winners === 'object') {
            labels.winners = winners;
        }
        if (losers && typeof losers === 'object') {
            labels.losers = losers;
        }

        // Save to database (null if empty)
        const updatedTournament = tournamentDb.setRoundLabels(
            tournament.id,
            Object.keys(labels).length > 0 ? labels : null
        );

        logger.log('setRoundLabels:success', {
            tournamentId: tournament.id,
            hasWinners: !!labels.winners,
            hasLosers: !!labels.losers
        });

        // Broadcast to bracket displays via WebSocket
        if (io) {
            const userId = tournament.user_id;
            io.to(`user:${userId}`).emit('bracket:control', {
                action: 'setRoundLabels',
                tournamentId: tournament.id,
                labels: updatedTournament.round_labels
            });
            logger.log('setRoundLabels:broadcast', { userId, tournamentId: tournament.id });
        }

        res.json({
            success: true,
            tournament: transformTournament(updatedTournament),
            roundLabels: updatedTournament.round_labels
        });
    } catch (error) {
        logger.error('setRoundLabels', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/tournaments/:tournamentId/swiss/next-round - Generate next Swiss round
// ============================================
router.post('/:tournamentId/swiss/next-round', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        if (tournament.tournament_type !== 'swiss') {
            return res.status(400).json({
                success: false,
                error: 'Tournament is not Swiss format'
            });
        }

        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        // Get current round number
        const currentRound = Math.max(...matches.map(m => m.round), 0);

        // Check if current round is complete
        if (!bracketEngine.isSwissRoundComplete(matches, currentRound)) {
            return res.status(400).json({
                success: false,
                error: `Round ${currentRound} is not complete yet`
            });
        }

        // Check if we've reached the max rounds
        const maxRounds = tournament.swiss_rounds || bracketEngine.swiss.recommendedRounds(participants.length);
        if (currentRound >= maxRounds) {
            return res.status(400).json({
                success: false,
                error: 'All Swiss rounds have been played'
            });
        }

        // Generate next round
        const nextRound = currentRound + 1;
        const newMatches = bracketEngine.generateSwissRound(matches, participants, nextRound);

        // Create matches in database
        const matchIds = matchDb.bulkCreate(tournament.id, newMatches);

        logger.log('swissNextRound:success', {
            tournamentId: tournament.id,
            round: nextRound,
            matchCount: matchIds.length
        });

        res.json({
            success: true,
            round: nextRound,
            matchCount: matchIds.length,
            matches: newMatches
        });
    } catch (error) {
        logger.error('swissNextRound', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// Helper: Write tournament-state.json for backward compatibility
// ============================================
async function writeTournamentStateFile(tournament) {
    try {
        const stateFilePath = process.env.MATCH_STATE_FILE || '/root/tcc-custom/admin-dashboard/tournament-state.json';
        const stateDir = path.dirname(stateFilePath);

        // Ensure directory exists
        await fs.mkdir(stateDir, { recursive: true });

        const bracketUrl = `${process.env.BRACKET_API_URL || 'http://localhost:2053'}/bracket/${tournament.url_slug}`;

        await fs.writeFile(stateFilePath, JSON.stringify({
            tournamentId: tournament.url_slug,
            tournamentDbId: tournament.id,
            tournamentName: tournament.name,
            gameName: tournament.game_name,
            bracketUrl,
            deployedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        }, null, 2));

        logger.log('writeTournamentStateFile:success', { tournamentId: tournament.url_slug });
    } catch (err) {
        logger.error('writeTournamentStateFile', err);
        // Don't throw - state file is optional enhancement
    }
}

// ============================================
// Helper: Clear tournament-state.json when no active tournament
// ============================================
async function clearTournamentStateFile() {
    try {
        const stateFilePath = process.env.MATCH_STATE_FILE || '/root/tcc-custom/admin-dashboard/tournament-state.json';

        await fs.writeFile(stateFilePath, JSON.stringify({
            tournamentId: null,
            tournamentDbId: null,
            tournamentName: null,
            gameName: null,
            bracketUrl: null,
            deployedAt: null,
            lastUpdated: new Date().toISOString()
        }, null, 2));

        logger.log('clearTournamentStateFile:success', {});
    } catch (err) {
        logger.error('clearTournamentStateFile', err);
        // Don't throw - state file is optional enhancement
    }
}

// ============================================
// TWO-STAGE TOURNAMENT ROUTES
// ============================================

/**
 * POST /api/tournaments/:tournamentId/transition-to-knockout
 * Transition a two-stage tournament from group stage to knockout stage
 */
router.post('/:tournamentId/transition-to-knockout', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({ success: false, error: 'Tournament not found' });
        }

        if (!validateTenantAccess(req, tournament.user_id)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (tournament.tournament_type !== 'two_stage') {
            return res.status(400).json({ success: false, error: 'Tournament is not a two-stage tournament' });
        }

        if (tournament.current_stage !== 'group') {
            return res.status(400).json({ success: false, error: 'Tournament is not in group stage' });
        }

        // Get all group stage matches
        const matches = matchDb.getByTournament(tournament.id);
        const groupMatches = matches.filter(m => m.stage === 'group' || m.group_id);

        // Check if group stage is complete
        if (!bracketEngine.twoStage.isGroupStageComplete(groupMatches)) {
            return res.status(400).json({
                success: false,
                error: 'Group stage is not complete - all matches must be finished'
            });
        }

        // Get participants and build group structure for standings calculation
        const participants = participantDb.getByTournament(tournament.id);
        const groups = [];
        const groupIds = [...new Set(participants.map(p => p.group_id).filter(Boolean))];

        groupIds.forEach(groupId => {
            groups.push({
                groupId,
                participants: participants.filter(p => p.group_id === groupId)
            });
        });

        // Get advancing participants
        const advancingParticipants = bracketEngine.twoStage.getAdvancingParticipants(
            groupMatches,
            groups,
            tournament.advance_per_group || 2,
            { rankedBy: tournament.ranked_by || 'match wins' }
        );

        // Generate knockout bracket
        const knockoutStage = bracketEngine.twoStage.generateKnockoutBracket(
            advancingParticipants,
            participants,
            {
                knockoutFormat: tournament.knockout_format || 'single_elimination',
                holdThirdPlaceMatch: !!tournament.hold_third_place_match,
                grandFinalsModifier: tournament.grand_finals_modifier,
                startMatchId: matches.length
            }
        );

        // Create knockout matches in database
        const matchIds = matchDb.bulkCreate(tournament.id, knockoutStage.matches);

        // Update prereq match IDs
        const idMap = {};
        knockoutStage.matches.forEach((m, index) => {
            idMap[m.id] = matchIds[index];
        });

        knockoutStage.matches.forEach((m, index) => {
            if (m.player1_prereq_match_id !== null || m.player2_prereq_match_id !== null) {
                matchDb.updatePrereqs(matchIds[index], {
                    player1_prereq_match_id: m.player1_prereq_match_id !== null ? idMap[m.player1_prereq_match_id] : null,
                    player2_prereq_match_id: m.player2_prereq_match_id !== null ? idMap[m.player2_prereq_match_id] : null,
                    player1_is_prereq_loser: m.player1_is_prereq_loser,
                    player2_is_prereq_loser: m.player2_is_prereq_loser
                });
            }
        });

        // Update tournament stage
        tournamentDb.update(tournament.id, { current_stage: 'knockout' });

        logger.log('transitionToKnockout:success', {
            tournamentId: tournament.id,
            advancingCount: advancingParticipants.length,
            knockoutMatches: matchIds.length
        });

        // Broadcast update
        const updatedTournament = tournamentDb.getById(tournament.id);
        broadcastTournament(WS_EVENTS.TOURNAMENT_UPDATED, transformTournament(updatedTournament));
        broadcastIfActiveTournament(updatedTournament, tournament.user_id);

        res.json({
            success: true,
            tournament: transformTournament(updatedTournament),
            advancing: advancingParticipants,
            knockoutMatches: matchIds.length
        });
    } catch (error) {
        logger.error('transitionToKnockout', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tournaments/:tournamentId/group-standings
 * Get standings for all groups in a two-stage tournament
 */
router.get('/:tournamentId/group-standings', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({ success: false, error: 'Tournament not found' });
        }

        if (tournament.tournament_type !== 'two_stage') {
            return res.status(400).json({ success: false, error: 'Tournament is not a two-stage tournament' });
        }

        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        // Build groups structure
        const groups = [];
        const groupIds = [...new Set(participants.map(p => p.group_id).filter(Boolean))].sort((a, b) => a - b);

        groupIds.forEach(groupId => {
            const groupParticipants = participants.filter(p => p.group_id === groupId);
            const groupMatches = matches.filter(m => m.group_id === groupId);

            const standings = bracketEngine.roundRobin.calculateStandings(
                groupMatches,
                groupParticipants,
                { rankedBy: tournament.ranked_by || 'match wins' }
            );

            groups.push({
                groupId,
                groupName: `Group ${String.fromCharCode(64 + groupId)}`,
                standings,
                matchesComplete: groupMatches.filter(m => m.state === 'complete').length,
                matchesTotal: groupMatches.length
            });
        });

        res.json({
            success: true,
            currentStage: tournament.current_stage,
            advancePerGroup: tournament.advance_per_group || 2,
            groups
        });
    } catch (error) {
        logger.error('getGroupStandings', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// FREE-FOR-ALL TOURNAMENT ROUTES
// ============================================

/**
 * POST /api/tournaments/:tournamentId/matches/:matchId/ffa-placements
 * Record placements for a free-for-all match
 */
router.post('/:tournamentId/matches/:matchId/ffa-placements', async (req, res) => {
    try {
        const { tournamentId, matchId } = req.params;
        const { placements } = req.body; // Array of {participant_id, placement}

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({ success: false, error: 'Tournament not found' });
        }

        if (!validateTenantAccess(req, tournament.user_id)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (tournament.tournament_type !== 'free_for_all') {
            return res.status(400).json({ success: false, error: 'Tournament is not a free-for-all tournament' });
        }

        const match = matchDb.getById(parseInt(matchId));
        if (!match || match.tournament_id !== tournament.id) {
            return res.status(404).json({ success: false, error: 'Match not found' });
        }

        if (!Array.isArray(placements) || placements.length === 0) {
            return res.status(400).json({ success: false, error: 'Placements array is required' });
        }

        // Get points system from tournament settings
        const pointsSystem = tournament.points_system_json
            ? JSON.parse(tournament.points_system_json)
            : bracketEngine.freeForAll.DEFAULT_POINTS_SYSTEM;

        // Record placements in database
        const db = require('../db/tournaments-db').getDb();

        // Clear existing placements for this match
        db.prepare('DELETE FROM tcc_ffa_placements WHERE match_id = ?').run(match.id);

        // Insert new placements
        const insertStmt = db.prepare(`
            INSERT INTO tcc_ffa_placements (match_id, participant_id, placement, points_awarded)
            VALUES (?, ?, ?, ?)
        `);

        placements.forEach(p => {
            const placement = p.placement;
            const points = pointsSystem[placement] !== undefined
                ? pointsSystem[placement]
                : (pointsSystem.default || 0);

            insertStmt.run(match.id, p.participant_id, placement, points);
        });

        // Update match state to complete
        matchDb.update(match.id, {
            state: 'complete',
            winner_id: placements.find(p => p.placement === 1)?.participant_id || null,
            completed_at: new Date().toISOString()
        });

        // Check if this completes a round and open next round if needed
        const matches = matchDb.getByTournament(tournament.id);
        const currentRound = match.round;

        if (bracketEngine.freeForAll.isRoundComplete(matches, currentRound)) {
            const updatedMatches = bracketEngine.freeForAll.openNextRound(matches, currentRound);

            // Update match states in database
            updatedMatches.forEach(m => {
                if (m.state === 'open' && matches.find(orig => orig.id === m.id)?.state === 'pending') {
                    matchDb.update(m.id, { state: 'open' });
                }
            });
        }

        logger.log('ffaPlacements:success', {
            tournamentId: tournament.id,
            matchId: match.id,
            placementCount: placements.length
        });

        // Broadcast update
        broadcastTournament(WS_EVENTS.TOURNAMENT_UPDATED, transformTournament(tournament));

        res.json({
            success: true,
            match: matchDb.getById(match.id),
            placements
        });
    } catch (error) {
        logger.error('ffaPlacements', error, { tournamentId: req.params.tournamentId, matchId: req.params.matchId });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tournaments/:tournamentId/ffa-standings
 * Get current standings for a free-for-all tournament
 */
router.get('/:tournamentId/ffa-standings', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({ success: false, error: 'Tournament not found' });
        }

        if (tournament.tournament_type !== 'free_for_all') {
            return res.status(400).json({ success: false, error: 'Tournament is not a free-for-all tournament' });
        }

        const matches = matchDb.getByTournament(tournament.id);
        const participants = participantDb.getByTournament(tournament.id);

        // Get placements from database
        const db = require('../db/tournaments-db').getDb();
        const placements = db.prepare(`
            SELECT * FROM tcc_ffa_placements
            WHERE match_id IN (SELECT id FROM tcc_matches WHERE tournament_id = ?)
        `).all(tournament.id);

        // Attach placements to matches
        matches.forEach(m => {
            m.placements = placements.filter(p => p.match_id === m.id);
        });

        const standings = bracketEngine.freeForAll.calculateStandings(matches, participants);

        res.json({
            success: true,
            standings,
            roundsComplete: Math.max(...matches.filter(m => m.state === 'complete').map(m => m.round), 0),
            totalRounds: tournament.total_rounds || 3
        });
    } catch (error) {
        logger.error('ffaStandings', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// LEADERBOARD TOURNAMENT ROUTES
// ============================================

/**
 * POST /api/tournaments/:tournamentId/events
 * Add a new event to a leaderboard tournament
 */
router.post('/:tournamentId/events', async (req, res) => {
    try {
        const { tournamentId } = req.params;
        const { name, results, date } = req.body; // results: [{participant_id, placement}]

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({ success: false, error: 'Tournament not found' });
        }

        if (!validateTenantAccess(req, tournament.user_id)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (tournament.tournament_type !== 'leaderboard') {
            return res.status(400).json({ success: false, error: 'Tournament is not a leaderboard' });
        }

        if (!Array.isArray(results) || results.length === 0) {
            return res.status(400).json({ success: false, error: 'Results array is required' });
        }

        const db = require('../db/tournaments-db').getDb();

        // Create event
        const eventResult = db.prepare(`
            INSERT INTO tcc_leaderboard_events (tournament_id, event_name, event_date, is_complete)
            VALUES (?, ?, ?, 1)
        `).run(tournament.id, name || `Event ${Date.now()}`, date || new Date().toISOString());

        const eventId = eventResult.lastInsertRowid;

        // Get points system
        const pointsSystem = tournament.points_system_json
            ? JSON.parse(tournament.points_system_json)
            : bracketEngine.leaderboard.DEFAULT_POINTS_SYSTEM;

        // Insert results
        const insertStmt = db.prepare(`
            INSERT INTO tcc_leaderboard_results (event_id, participant_id, placement, points_awarded)
            VALUES (?, ?, ?, ?)
        `);

        results.forEach(r => {
            const points = pointsSystem[r.placement] !== undefined
                ? pointsSystem[r.placement]
                : (pointsSystem.default || 0);

            // Ensure participant exists
            let participant = participantDb.getById(r.participant_id);
            if (!participant) {
                // Create participant if they don't exist
                const newParticipant = participantDb.create(tournament.id, {
                    name: r.participant_name || `Player ${r.participant_id}`,
                    player_id: r.participant_id
                });
                r.participant_id = newParticipant.id;
            }

            insertStmt.run(eventId, r.participant_id, r.placement, points);
        });

        logger.log('leaderboardEvent:created', {
            tournamentId: tournament.id,
            eventId,
            resultCount: results.length
        });

        // Broadcast update
        broadcastTournament(WS_EVENTS.TOURNAMENT_UPDATED, transformTournament(tournament));

        res.json({
            success: true,
            event: {
                id: eventId,
                name: name || `Event ${Date.now()}`,
                date: date || new Date().toISOString(),
                resultCount: results.length
            }
        });
    } catch (error) {
        logger.error('leaderboardEvent:create', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tournaments/:tournamentId/events
 * Get all events for a leaderboard tournament
 */
router.get('/:tournamentId/events', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({ success: false, error: 'Tournament not found' });
        }

        if (tournament.tournament_type !== 'leaderboard') {
            return res.status(400).json({ success: false, error: 'Tournament is not a leaderboard' });
        }

        const db = require('../db/tournaments-db').getDb();

        const events = db.prepare(`
            SELECT e.*, COUNT(r.id) as result_count
            FROM tcc_leaderboard_events e
            LEFT JOIN tcc_leaderboard_results r ON e.id = r.event_id
            WHERE e.tournament_id = ?
            GROUP BY e.id
            ORDER BY e.event_date DESC
        `).all(tournament.id);

        res.json({
            success: true,
            events
        });
    } catch (error) {
        logger.error('leaderboardEvents:list', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tournaments/:tournamentId/leaderboard-standings
 * Get current leaderboard standings
 */
router.get('/:tournamentId/leaderboard-standings', async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const tournament = isNaN(tournamentId)
            ? tournamentDb.getBySlug(tournamentId)
            : tournamentDb.getById(parseInt(tournamentId));

        if (!tournament) {
            return res.status(404).json({ success: false, error: 'Tournament not found' });
        }

        if (tournament.tournament_type !== 'leaderboard') {
            return res.status(400).json({ success: false, error: 'Tournament is not a leaderboard' });
        }

        const db = require('../db/tournaments-db').getDb();

        // Get all results grouped by participant
        const standings = db.prepare(`
            SELECT
                p.id as participant_id,
                p.name as participant_name,
                COUNT(r.id) as events_played,
                SUM(r.points_awarded) as total_points,
                SUM(CASE WHEN r.placement = 1 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN r.placement <= 3 THEN 1 ELSE 0 END) as podiums,
                MIN(r.placement) as best_placement,
                AVG(r.placement) as avg_placement
            FROM tcc_participants p
            LEFT JOIN tcc_leaderboard_results r ON p.id = r.participant_id
            WHERE p.tournament_id = ?
            GROUP BY p.id
            ORDER BY total_points DESC, wins DESC, podiums DESC
        `).all(tournament.id);

        // Assign ranks
        standings.forEach((s, index) => {
            s.rank = index + 1;
        });

        // Get event count
        const eventCount = db.prepare(`
            SELECT COUNT(*) as count FROM tcc_leaderboard_events WHERE tournament_id = ?
        `).get(tournament.id).count;

        res.json({
            success: true,
            standings,
            eventCount,
            rankingType: tournament.ranking_type || 'points'
        });
    } catch (error) {
        logger.error('leaderboardStandings', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// Helper: Transform tournament for API response
// ============================================
function transformTournament(t) {
    // Extract format settings or use defaults
    const formatSettings = t.format_settings || {};

    return {
        id: t.id,
        tournamentId: t.url_slug,
        name: t.name,
        description: t.description || '',
        game: t.game_name || '',
        state: t.state,
        tournamentType: t.tournament_type,
        participants: t.participants_count || 0,
        url: null, // No external URL for local tournaments
        startAt: t.starts_at,
        startedAt: t.started_at,
        completedAt: t.completed_at,
        createdAt: t.created_at,
        checkInDuration: t.check_in_duration,
        signupCap: t.signup_cap,
        openSignup: !!t.open_signup,
        holdThirdPlaceMatch: !!t.hold_third_place_match,
        grandFinalsModifier: t.grand_finals_modifier || '',
        sequentialPairings: !!t.sequential_pairings,
        showRounds: !!t.show_rounds,
        swissRounds: t.swiss_rounds || 0,
        rankedBy: t.ranked_by || 'match wins',
        hideSeeds: !!t.hide_seeds,
        privateTournament: !!t.private,
        source: 'local',
        // Format settings (new bracket options)
        byeStrategy: formatSettings.byeStrategy || 'traditional',
        compactBracket: !!formatSettings.compactBracket,
        seedingSource: formatSettings.seedingSource || 'manual',
        seedingConfig: formatSettings.seedingConfig || null,
        // Custom round labels
        roundLabels: t.round_labels || null
    };
}

// Set Discord notification service (called after init when discordNotify is available)
function setDiscordNotify(service) {
    discordNotify = service;
}

// Export
router.init = init;
router.setDiscordNotify = setDiscordNotify;
module.exports = router;
