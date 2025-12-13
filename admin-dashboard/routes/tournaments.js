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
    TOURNAMENT_COMPLETED: 'tournament:completed'
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
            seedingConfig
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
            format_settings_json: Object.keys(formatSettings).length > 0 ? formatSettings : null
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

        // Immediately broadcast empty matches to clear match display
        // This ensures instant update instead of waiting for polling cycle
        if (io) {
            io.emit('matches:update', {
                tournamentId: updatedTournament.url_slug,
                matches: [],
                podium: { isComplete: false },
                timestamp: new Date().toISOString(),
                source: 'reset'
            });
            logger.log('reset:matchesBroadcast', { tournamentId: updatedTournament.url_slug });
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
        seedingConfig: formatSettings.seedingConfig || null
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
