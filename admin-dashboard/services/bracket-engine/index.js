/**
 * Bracket Engine - Main Entry Point
 *
 * Unified interface for generating tournament brackets of all types:
 * - Single Elimination
 * - Double Elimination
 * - Round Robin
 * - Swiss System
 * - Two-Stage (Group + Knockout)
 * - Free-for-All (Multi-player)
 * - Leaderboard (Ongoing Rankings)
 *
 * Usage:
 *   const bracketEngine = require('./services/bracket-engine');
 *   const bracket = bracketEngine.generate('double_elimination', participants, options);
 */

const singleElimination = require('./single-elimination');
const doubleElimination = require('./double-elimination');
const roundRobin = require('./round-robin');
const swiss = require('./swiss');
const twoStage = require('./two-stage');
const freeForAll = require('./free-for-all');
const leaderboard = require('./leaderboard');
const { createLogger } = require('../debug-logger');

const logger = createLogger('bracket-engine');

/**
 * Generate a bracket based on tournament type
 *
 * @param {string} type - Tournament type: 'single_elimination', 'double_elimination', 'round_robin', 'swiss'
 * @param {Array} participants - Array of participant objects with {id, seed, name}
 * @param {Object} options - Type-specific options
 * @returns {Object} Generated bracket data with matches array
 */
function generate(type, participants, options = {}) {
    const logComplete = logger.start('generate', { type, participantCount: participants?.length, options });

    // Leaderboards can start empty - participants join via events
    const minParticipants = type === 'leaderboard' ? 0 : 2;

    if (!Array.isArray(participants) || participants.length < minParticipants) {
        logger.error('generate', new Error(`Need at least ${minParticipants} participants`), { participantCount: participants?.length });
        throw new Error(`Need at least ${minParticipants} participants`);
    }

    if (participants.length > 0) {
        logger.log('generate:participants', {
            count: participants.length,
            seeds: participants.map(p => ({ id: p.id, seed: p.seed, name: p.name }))
        });
    }

    let result;
    switch (type) {
        case 'single_elimination':
            // Check if compact bracket mode is enabled
            if (options.compact_bracket || options.compactBracket) {
                result = singleElimination.generateCompactBracket(participants, {
                    holdThirdPlaceMatch: options.hold_third_place_match || options.holdThirdPlaceMatch || false,
                    sequentialPairings: options.sequential_pairings || options.sequentialPairings || false
                });
            } else {
                result = singleElimination.generate(participants, {
                    holdThirdPlaceMatch: options.hold_third_place_match || options.holdThirdPlaceMatch || false,
                    sequentialPairings: options.sequential_pairings || options.sequentialPairings || false,
                    byeStrategy: options.bye_strategy || options.byeStrategy || 'traditional'
                });
            }
            break;

        case 'double_elimination':
            result = doubleElimination.generate(participants, {
                grandFinalsModifier: options.grand_finals_modifier || options.grandFinalsModifier || null,
                sequentialPairings: options.sequential_pairings || options.sequentialPairings || false
            });
            break;

        case 'round_robin':
            result = roundRobin.generate(participants, {
                iterations: options.iterations || 1,
                rankedBy: options.ranked_by || options.rankedBy || 'match wins',
                pointsPerResult: options.pointsPerResult || { win: 1, draw: 0.5, loss: 0 },
                allowTies: options.allow_ties || options.allowTies || false
            });
            break;

        case 'swiss':
            result = swiss.generate(participants, {
                rounds: options.swiss_rounds || options.swissRounds || swiss.recommendedRounds(participants.length),
                allowRematches: options.allow_rematches !== false
            });
            break;

        case 'two_stage':
            result = twoStage.generate(participants, {
                groupCount: options.group_count || options.groupCount || 4,
                advancePerGroup: options.advance_per_group || options.advancePerGroup || 2,
                knockoutFormat: options.knockout_format || options.knockoutFormat || 'single_elimination',
                groupIterations: options.group_iterations || options.groupIterations || 1,
                rankedBy: options.ranked_by || options.rankedBy || 'match wins',
                holdThirdPlaceMatch: options.hold_third_place_match || options.holdThirdPlaceMatch || false,
                grandFinalsModifier: options.grand_finals_modifier || options.grandFinalsModifier || null
            });
            break;

        case 'free_for_all':
            result = freeForAll.generate(participants, {
                playersPerMatch: options.players_per_match || options.playersPerMatch || 8,
                totalRounds: options.total_rounds || options.totalRounds || 3,
                pointsSystem: options.points_system || options.pointsSystem || freeForAll.DEFAULT_POINTS_SYSTEM,
                allPlayAllRounds: options.all_play_all_rounds !== false
            });
            break;

        case 'leaderboard':
            result = leaderboard.generate(participants, {
                rankingType: options.ranking_type || options.rankingType || 'points',
                pointsSystem: options.points_system || options.pointsSystem || leaderboard.DEFAULT_POINTS_SYSTEM,
                decayEnabled: options.decay_enabled || options.decayEnabled || false,
                decayRate: options.decay_rate || options.decayRate || 10,
                decayPeriodDays: options.decay_period_days || options.decayPeriodDays || 30,
                minEventsToRank: options.min_events_to_rank || options.minEventsToRank || 1,
                eloConfig: options.elo_config || options.eloConfig || leaderboard.DEFAULT_ELO_CONFIG,
                seasonName: options.season_name || options.seasonName || null
            });
            break;

        default:
            logger.error('generate', new Error(`Unknown tournament type: ${type}`), { type });
            throw new Error(`Unknown tournament type: ${type}`);
    }

    logComplete({
        matchCount: result?.matches?.length || 0,
        rounds: result?.totalRounds,
        byeCount: result?.matches?.filter(m => m.is_bye)?.length || 0
    });
    return result;
}

/**
 * Calculate final ranks for a completed tournament
 *
 * @param {string} type - Tournament type
 * @param {Array} matches - All tournament matches
 * @param {Array} participants - All participants
 * @param {Object} options - Type-specific options
 * @returns {Object} Map of participant_id -> final rank
 */
function calculateFinalRanks(type, matches, participants, options = {}) {
    switch (type) {
        case 'single_elimination':
            return singleElimination.calculateFinalRanks(matches, participants);

        case 'double_elimination':
            return doubleElimination.calculateFinalRanks(matches, participants);

        case 'round_robin':
            return roundRobin.calculateFinalRanks(matches, participants, options);

        case 'swiss':
            return swiss.calculateFinalRanks(matches, participants);

        case 'two_stage':
            // For two-stage, matches is actually the tournament object
            return twoStage.calculateFinalRanks(matches);

        case 'free_for_all':
            return freeForAll.calculateFinalRanks(matches, participants, options);

        case 'leaderboard':
            // For leaderboard, matches is actually the leaderboard object
            return leaderboard.calculateFinalRanks(matches);

        default:
            throw new Error(`Unknown tournament type: ${type}`);
    }
}

/**
 * Get visualization data for rendering bracket
 *
 * @param {string} type - Tournament type
 * @param {Array} matches - All tournament matches
 * @param {Array} participants - All participants
 * @returns {Object} Visualization-ready data structure
 */
function getVisualizationData(type, matches, participants) {
    switch (type) {
        case 'single_elimination':
            return singleElimination.getVisualizationData(matches, participants);

        case 'double_elimination':
            return doubleElimination.getVisualizationData(matches, participants);

        case 'round_robin':
            return roundRobin.getVisualizationData(matches, participants);

        case 'swiss':
            return swiss.getVisualizationData(matches, participants);

        case 'two_stage':
            // For two-stage, matches is actually the tournament object
            return twoStage.getVisualizationData(matches);

        case 'free_for_all':
            return freeForAll.getVisualizationData(matches, participants);

        case 'leaderboard':
            // For leaderboard, matches is actually the leaderboard object
            return leaderboard.getVisualizationData(matches);

        default:
            throw new Error(`Unknown tournament type: ${type}`);
    }
}

/**
 * Check if all matches in the tournament are complete
 *
 * @param {string} type - Tournament type
 * @param {Array} matches - All tournament matches
 * @param {Object} options - Type-specific options (e.g., totalRounds for Swiss)
 * @returns {boolean} True if tournament is complete
 */
function isTournamentComplete(type, matches, options = {}) {
    // Filter out BYE matches for completion check
    const realMatches = matches.filter(m => !m.is_bye);

    // For double elim with bracket reset, check if GF2 was needed
    if (type === 'double_elimination') {
        const gf2 = matches.find(m => m.is_grand_finals_reset);
        if (gf2) {
            // GF2 exists but may be conditional
            if (gf2.conditional) {
                const gf1 = matches.find(m => m.is_grand_finals && !m.is_grand_finals_reset);
                if (gf1 && gf1.state === 'complete') {
                    // Check if reset is needed
                    const needsReset = doubleElimination.needsGrandFinalsReset(matches, gf1.winner_id);
                    if (!needsReset) {
                        // GF2 not needed, tournament complete
                        return true;
                    }
                }
            }
        }
    }

    // For Swiss, check if all planned rounds are complete
    if (type === 'swiss') {
        const totalRounds = options.totalRounds || options.swiss_rounds;
        if (totalRounds) {
            const currentRound = Math.max(...matches.map(m => m.round));
            if (currentRound < totalRounds) {
                return false;
            }
            // Check if current round is complete
            return swiss.isRoundComplete(matches, currentRound);
        }
    }

    // Handle new tournament types
    if (type === 'two_stage') {
        // For two-stage, matches is the tournament object
        return twoStage.isTournamentComplete(matches);
    }

    if (type === 'free_for_all') {
        return freeForAll.isTournamentComplete(matches);
    }

    if (type === 'leaderboard') {
        // Leaderboards don't "complete" - they're ongoing
        return leaderboard.isTournamentComplete(matches);
    }

    // Default: check if all non-pending matches are complete
    return realMatches.every(m => m.state === 'complete');
}

/**
 * Get standings for Swiss/RoundRobin tournaments
 *
 * @param {string} type - Tournament type
 * @param {Array} matches - All tournament matches
 * @param {Array} participants - All participants
 * @param {Object} options - Ranking options
 * @returns {Array} Sorted standings array
 */
function getStandings(type, matches, participants, options = {}) {
    switch (type) {
        case 'round_robin':
            return roundRobin.calculateStandings(matches, participants, options);

        case 'swiss':
            return swiss.calculateStandings(matches, participants);

        case 'free_for_all':
            return freeForAll.calculateStandings(matches, participants, options);

        case 'leaderboard':
            // For leaderboard, matches is the leaderboard object
            return leaderboard.calculateStandings(matches);

        case 'two_stage':
            // For two-stage during group phase, return group standings
            if (matches.currentStage === 'group') {
                return twoStage.calculateGroupStandings(
                    matches.groupStage.matches,
                    matches.groupStage.groups,
                    options
                );
            }
            // During knockout, return knockout standings
            return calculateEliminationStandings(
                matches.options.knockoutFormat,
                matches.knockoutStage?.matches || [],
                matches.knockoutStage?.participants || []
            );

        default:
            // For elimination brackets, calculate based on elimination round
            return calculateEliminationStandings(type, matches, participants);
    }
}

/**
 * Calculate standings for elimination tournaments based on elimination round
 */
function calculateEliminationStandings(type, matches, participants) {
    const ranks = calculateFinalRanks(type, matches, participants);

    const standings = participants.map(p => {
        const rank = ranks[p.id] || participants.length;
        return {
            participant_id: p.id,
            participant_name: p.name,
            seed: p.seed,
            rank,
            eliminated: matches.some(m =>
                m.state === 'complete' &&
                m.loser_id === p.id &&
                // For double elim, only count final elimination
                (type !== 'double_elimination' || m.losers_bracket || m.is_grand_finals)
            )
        };
    });

    return standings.sort((a, b) => a.rank - b.rank);
}

/**
 * Generate next round for Swiss tournaments
 *
 * @param {Array} matches - Current matches
 * @param {Array} participants - All participants
 * @param {number} roundNumber - Next round number
 * @returns {Array} New match objects for the round
 */
function generateSwissRound(matches, participants, roundNumber) {
    return swiss.createNextRoundMatches(matches, participants, roundNumber);
}

/**
 * Check if a Swiss round is complete
 *
 * @param {Array} matches - All matches
 * @param {number} roundNumber - Round to check
 * @returns {boolean} True if all round matches are complete
 */
function isSwissRoundComplete(matches, roundNumber) {
    return swiss.isRoundComplete(matches, roundNumber);
}

/**
 * Generate group stage (multiple round robin groups)
 *
 * @param {Array} participants - All participants
 * @param {Object} options - Group stage options
 * @returns {Object} Group stage data with all groups and matches
 */
function generateGroupStage(participants, options = {}) {
    return roundRobin.generateGroupStage(participants, options);
}

/**
 * Get participants advancing from group stage
 *
 * @param {Object} groupStageData - Data from generateGroupStage
 * @param {number} advancingPerGroup - How many advance from each group
 * @returns {Array} Advancing participants with new seeds
 */
function getGroupStageAdvancers(groupStageData, advancingPerGroup) {
    return roundRobin.getAdvancingParticipants(groupStageData.groups, advancingPerGroup);
}

/**
 * Supported tournament types
 */
const TOURNAMENT_TYPES = [
    'single_elimination',
    'double_elimination',
    'round_robin',
    'swiss',
    'two_stage',
    'free_for_all',
    'leaderboard'
];

/**
 * Get type-specific default options
 */
function getDefaultOptions(type) {
    switch (type) {
        case 'single_elimination':
            return {
                holdThirdPlaceMatch: false,
                sequentialPairings: false,
                byeStrategy: 'traditional',
                compactBracket: false
            };

        case 'double_elimination':
            return {
                grandFinalsModifier: null,
                sequentialPairings: false
            };

        case 'round_robin':
            return {
                iterations: 1,
                rankedBy: 'match wins',
                pointsPerResult: { win: 1, draw: 0.5, loss: 0 },
                allowTies: false
            };

        case 'swiss':
            return {
                rounds: null, // Auto-calculated based on participant count
                allowRematches: true
            };

        case 'two_stage':
            return {
                groupCount: 4,
                advancePerGroup: 2,
                knockoutFormat: 'single_elimination',
                groupIterations: 1,
                rankedBy: 'match wins',
                holdThirdPlaceMatch: false,
                grandFinalsModifier: null
            };

        case 'free_for_all':
            return {
                playersPerMatch: 8,
                totalRounds: 3,
                pointsSystem: freeForAll.DEFAULT_POINTS_SYSTEM,
                allPlayAllRounds: true
            };

        case 'leaderboard':
            return {
                rankingType: 'points',
                pointsSystem: leaderboard.DEFAULT_POINTS_SYSTEM,
                decayEnabled: false,
                decayRate: 10,
                decayPeriodDays: 30,
                minEventsToRank: 1,
                eloConfig: leaderboard.DEFAULT_ELO_CONFIG,
                seasonName: null
            };

        default:
            return {};
    }
}

/**
 * Valid BYE strategies for elimination brackets
 */
const VALID_BYE_STRATEGIES = ['traditional', 'spread', 'bottom_half', 'random'];

/**
 * Validate tournament options
 */
function validateOptions(type, options) {
    const errors = [];

    if (type === 'single_elimination' || type === 'double_elimination') {
        if (options.byeStrategy && !VALID_BYE_STRATEGIES.includes(options.byeStrategy)) {
            errors.push(`byeStrategy must be one of: ${VALID_BYE_STRATEGIES.join(', ')}`);
        }
    }

    if (type === 'double_elimination' && options.grandFinalsModifier) {
        if (!['single', 'skip'].includes(options.grandFinalsModifier)) {
            errors.push('grandFinalsModifier must be "single", "skip", or null');
        }
    }

    if (type === 'round_robin' && options.iterations) {
        if (options.iterations < 1 || options.iterations > 10) {
            errors.push('iterations must be between 1 and 10');
        }
    }

    if (type === 'swiss' && options.rounds) {
        if (options.rounds < 1 || options.rounds > 20) {
            errors.push('Swiss rounds must be between 1 and 20');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// Export everything
module.exports = {
    // Main functions
    generate,
    calculateFinalRanks,
    getVisualizationData,
    isTournamentComplete,
    getStandings,

    // Swiss-specific
    generateSwissRound,
    isSwissRoundComplete,

    // Group stage
    generateGroupStage,
    getGroupStageAdvancers,

    // Two-stage specific
    transitionToKnockout: twoStage.transitionToKnockout,
    isGroupStageComplete: twoStage.isGroupStageComplete,
    getAdvancingParticipants: twoStage.getAdvancingParticipants,

    // Free-for-all specific
    recordFFAPlacements: freeForAll.recordPlacements,
    openNextFFARound: freeForAll.openNextRound,

    // Leaderboard specific
    addLeaderboardEvent: leaderboard.addEvent,
    applyLeaderboardDecay: leaderboard.applyDecay,
    resetLeaderboardSeason: leaderboard.resetSeason,
    getLeaderboardParticipantHistory: leaderboard.getParticipantHistory,

    // Utilities
    getDefaultOptions,
    validateOptions,
    TOURNAMENT_TYPES,
    VALID_BYE_STRATEGIES,

    // Direct access to format-specific modules
    singleElimination,
    doubleElimination,
    roundRobin,
    swiss,
    twoStage,
    freeForAll,
    leaderboard
};
