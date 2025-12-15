/**
 * Two-Stage Tournament Generator
 *
 * Implements FIFA World Cup style tournaments:
 * - Stage 1: Group stage (round robin within groups)
 * - Stage 2: Knockout bracket (single or double elimination)
 *
 * Features:
 * - Snake draft seeding for balanced groups
 * - Configurable number of groups and advancing players
 * - Cross-group pairing to avoid same-group rematches in R1
 * - Automatic transition from groups to knockout
 */

const { createLogger } = require('../debug-logger');
const roundRobin = require('./round-robin');
const singleElimination = require('./single-elimination');
const doubleElimination = require('./double-elimination');

const logger = createLogger('bracket-engine:two-stage');

/**
 * Default points system for knockout bracket seeding from groups
 */
const DEFAULT_POINTS_SYSTEM = {
    win: 3,
    draw: 1,
    loss: 0
};

/**
 * Generate two-stage tournament structure
 *
 * @param {Array} participants - Array of participant objects with {id, seed, name}
 * @param {Object} options - Generation options
 * @param {number} options.groupCount - Number of groups (2-8)
 * @param {number} options.advancePerGroup - How many advance from each group (1-4)
 * @param {string} options.knockoutFormat - 'single_elimination' or 'double_elimination'
 * @param {number} options.groupIterations - 1 for single RR, 2 for double RR
 * @param {string} options.rankedBy - Group ranking criteria
 * @param {boolean} options.holdThirdPlaceMatch - Include 3rd place match in knockout
 * @returns {Object} Tournament data with group stage and knockout placeholder
 */
function generate(participants, options = {}) {
    const {
        groupCount = 4,
        advancePerGroup = 2,
        knockoutFormat = 'single_elimination',
        groupIterations = 1,
        rankedBy = 'match wins',
        holdThirdPlaceMatch = false,
        grandFinalsModifier = null // For double elimination
    } = options;

    logger.log('generate:start', {
        participantCount: participants.length,
        groupCount,
        advancePerGroup,
        knockoutFormat
    });

    // Validate configuration
    const totalAdvancing = groupCount * advancePerGroup;
    if (participants.length < groupCount * 2) {
        throw new Error(`Need at least ${groupCount * 2} participants for ${groupCount} groups`);
    }
    if (advancePerGroup < 1 || advancePerGroup > 4) {
        throw new Error('advancePerGroup must be between 1 and 4');
    }
    if (groupCount < 2 || groupCount > 8) {
        throw new Error('groupCount must be between 2 and 8');
    }

    // Sort participants by seed
    const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));

    // Generate group stage
    const groupStage = generateGroupStage(sorted, {
        groupCount,
        advancePerGroup,
        iterations: groupIterations,
        rankedBy
    });

    // Calculate knockout bracket size needed
    const knockoutSize = singleElimination.nextPowerOf2(totalAdvancing);

    const stats = {
        participantCount: participants.length,
        groupCount,
        participantsPerGroup: Math.ceil(participants.length / groupCount),
        advancePerGroup,
        totalAdvancing,
        knockoutSize,
        knockoutFormat,
        groupMatches: groupStage.matches.length,
        estimatedKnockoutMatches: knockoutFormat === 'double_elimination'
            ? knockoutSize * 2 - 1
            : knockoutSize - 1,
        totalEstimatedMatches: groupStage.matches.length + (knockoutFormat === 'double_elimination'
            ? knockoutSize * 2 - 1
            : knockoutSize - 1)
    };

    logger.log('generate:complete', {
        groupMatches: groupStage.matches.length,
        totalAdvancing,
        knockoutSize
    });

    return {
        type: 'two_stage',
        currentStage: 'group',
        groupStage,
        knockoutStage: null, // Generated when groups complete
        matches: groupStage.matches, // Active matches are group stage initially
        stats,
        options: {
            groupCount,
            advancePerGroup,
            knockoutFormat,
            groupIterations,
            rankedBy,
            holdThirdPlaceMatch,
            grandFinalsModifier
        }
    };
}

/**
 * Generate group stage with round robin groups
 *
 * @param {Array} participants - Sorted participants by seed
 * @param {Object} options - Group options
 * @returns {Object} Group stage data
 */
function generateGroupStage(participants, options = {}) {
    const {
        groupCount = 4,
        advancingPerGroup = 2,
        iterations = 1,
        rankedBy = 'match wins'
    } = options;

    logger.log('generateGroupStage:start', {
        participantCount: participants.length,
        groupCount,
        advancingPerGroup
    });

    // Distribute into groups using snake draft
    const groups = Array.from({ length: groupCount }, () => []);

    participants.forEach((p, index) => {
        const row = Math.floor(index / groupCount);
        // Snake: even rows go left-to-right, odd rows go right-to-left
        const col = row % 2 === 0
            ? index % groupCount
            : groupCount - 1 - (index % groupCount);

        groups[col].push({
            ...p,
            group_id: col + 1,
            group_seed: groups[col].length + 1
        });
    });

    // Log group composition for debugging
    groups.forEach((group, idx) => {
        logger.log('generateGroupStage:group', {
            groupId: idx + 1,
            participants: group.map(p => ({ id: p.id, name: p.name, seed: p.seed }))
        });
    });

    // Generate round robin for each group
    const groupBrackets = groups.map((groupParticipants, groupIndex) => {
        const bracket = roundRobin.generate(groupParticipants, {
            iterations,
            rankedBy,
            pointsPerResult: DEFAULT_POINTS_SYSTEM
        });

        // Tag matches with group ID and update identifiers
        bracket.matches.forEach(m => {
            m.group_id = groupIndex + 1;
            m.identifier = `G${groupIndex + 1}-${m.identifier}`;
            m.stage = 'group';
        });

        return {
            groupId: groupIndex + 1,
            groupName: `Group ${String.fromCharCode(65 + groupIndex)}`, // A, B, C, D...
            participants: groupParticipants,
            bracket
        };
    });

    // Flatten all matches and renumber IDs
    const allMatches = groupBrackets.flatMap(g => g.bracket.matches);
    allMatches.forEach((m, index) => {
        m.id = index;
    });

    const stats = {
        participantCount: participants.length,
        groupCount,
        participantsPerGroup: groups.map(g => g.length),
        advancingPerGroup,
        totalAdvancing: groupCount * advancingPerGroup,
        matchesPerGroup: groupBrackets.map(g => g.bracket.matches.length),
        totalMatches: allMatches.length
    };

    logger.log('generateGroupStage:complete', {
        totalMatches: allMatches.length,
        groupCounts: groups.map(g => g.length)
    });

    return {
        type: 'group_stage',
        groups: groupBrackets,
        matches: allMatches,
        stats,
        options: {
            groupCount,
            advancingPerGroup,
            iterations,
            rankedBy
        }
    };
}

/**
 * Calculate standings for all groups
 *
 * @param {Array} matches - All group stage matches
 * @param {Array} groups - Group brackets from generateGroupStage
 * @param {Object} options - Ranking options
 * @returns {Object} Standings per group
 */
function calculateGroupStandings(matches, groups, options = {}) {
    const standings = {};

    groups.forEach(group => {
        const groupMatches = matches.filter(m => m.group_id === group.groupId);
        standings[group.groupId] = roundRobin.calculateStandings(
            groupMatches,
            group.participants,
            options
        );
    });

    return standings;
}

/**
 * Check if all group stage matches are complete
 *
 * @param {Array} matches - All group stage matches
 * @returns {boolean} True if all matches complete
 */
function isGroupStageComplete(matches) {
    const groupMatches = matches.filter(m => m.stage === 'group');
    return groupMatches.every(m => m.state === 'complete');
}

/**
 * Get participants advancing from groups to knockout
 *
 * @param {Array} matches - All group stage matches
 * @param {Array} groups - Group brackets
 * @param {number} advancePerGroup - How many advance per group
 * @param {Object} options - Ranking options
 * @returns {Array} Advancing participants with knockout seeding
 */
function getAdvancingParticipants(matches, groups, advancePerGroup, options = {}) {
    const standings = calculateGroupStandings(matches, groups, options);
    const advancing = [];

    // Extract top N from each group
    Object.keys(standings).sort((a, b) => a - b).forEach(groupId => {
        const groupStandings = standings[groupId];
        const topN = groupStandings.slice(0, advancePerGroup);

        topN.forEach(s => {
            advancing.push({
                participant_id: s.participant_id,
                participant_name: s.participant_name,
                group_id: parseInt(groupId),
                group_rank: s.rank,
                group_points: s.points,
                group_buchholz: s.buchholz
            });
        });
    });

    // Sort for knockout seeding:
    // - First by group rank (all 1st places, then all 2nd places)
    // - Within same rank, by group number (to create cross-group matchups)
    advancing.sort((a, b) => {
        if (a.group_rank !== b.group_rank) return a.group_rank - b.group_rank;
        return a.group_id - b.group_id;
    });

    // Assign knockout seeds
    advancing.forEach((p, index) => {
        p.knockout_seed = index + 1;
    });

    logger.log('getAdvancingParticipants', {
        advancing: advancing.map(p => ({
            name: p.participant_name,
            groupId: p.group_id,
            groupRank: p.group_rank,
            knockoutSeed: p.knockout_seed
        }))
    });

    return advancing;
}

/**
 * Generate knockout bracket from advancing participants
 *
 * @param {Array} advancingParticipants - From getAdvancingParticipants()
 * @param {Array} originalParticipants - Full participant objects
 * @param {Object} options - Knockout options
 * @returns {Object} Knockout bracket data
 */
function generateKnockoutBracket(advancingParticipants, originalParticipants, options = {}) {
    const {
        knockoutFormat = 'single_elimination',
        holdThirdPlaceMatch = false,
        grandFinalsModifier = null,
        startMatchId = 0
    } = options;

    logger.log('generateKnockoutBracket:start', {
        advancingCount: advancingParticipants.length,
        knockoutFormat
    });

    // Build participant objects for bracket generation
    const participantMap = {};
    originalParticipants.forEach(p => {
        participantMap[p.id] = p;
    });

    const knockoutParticipants = advancingParticipants.map(adv => {
        const original = participantMap[adv.participant_id];
        return {
            ...original,
            id: adv.participant_id,
            seed: adv.knockout_seed,
            group_id: adv.group_id,
            group_rank: adv.group_rank
        };
    });

    // Generate appropriate bracket
    let bracket;
    if (knockoutFormat === 'double_elimination') {
        bracket = doubleElimination.generate(knockoutParticipants, {
            holdThirdPlaceMatch,
            grandFinalsModifier
        });
    } else {
        bracket = singleElimination.generate(knockoutParticipants, {
            holdThirdPlaceMatch,
            byeStrategy: 'traditional'
        });
    }

    // Tag matches as knockout stage and renumber IDs
    bracket.matches.forEach((m, index) => {
        m.id = startMatchId + index;
        m.stage = 'knockout';
        // Keep identifier but could prefix with 'K-' if needed
    });

    logger.log('generateKnockoutBracket:complete', {
        matchCount: bracket.matches.length,
        format: knockoutFormat
    });

    return {
        type: 'knockout_stage',
        format: knockoutFormat,
        participants: knockoutParticipants,
        bracket,
        matches: bracket.matches,
        stats: bracket.stats
    };
}

/**
 * Transition tournament from group stage to knockout stage
 *
 * @param {Object} tournament - Two-stage tournament object
 * @param {Array} originalParticipants - Full participant objects
 * @returns {Object} Updated tournament with knockout bracket
 */
function transitionToKnockout(tournament, originalParticipants) {
    if (!isGroupStageComplete(tournament.groupStage.matches)) {
        throw new Error('Cannot transition to knockout: group stage not complete');
    }

    logger.log('transitionToKnockout:start', {
        groupMatches: tournament.groupStage.matches.length
    });

    // Get advancing participants
    const advancingParticipants = getAdvancingParticipants(
        tournament.groupStage.matches,
        tournament.groupStage.groups,
        tournament.options.advancePerGroup,
        { rankedBy: tournament.options.rankedBy }
    );

    // Generate knockout bracket
    const knockoutStage = generateKnockoutBracket(
        advancingParticipants,
        originalParticipants,
        {
            knockoutFormat: tournament.options.knockoutFormat,
            holdThirdPlaceMatch: tournament.options.holdThirdPlaceMatch,
            grandFinalsModifier: tournament.options.grandFinalsModifier,
            startMatchId: tournament.groupStage.matches.length
        }
    );

    // Update tournament object
    const updatedTournament = {
        ...tournament,
        currentStage: 'knockout',
        knockoutStage,
        matches: [...tournament.groupStage.matches, ...knockoutStage.matches],
        stats: {
            ...tournament.stats,
            knockoutMatches: knockoutStage.matches.length,
            totalMatches: tournament.groupStage.matches.length + knockoutStage.matches.length
        }
    };

    logger.log('transitionToKnockout:complete', {
        knockoutMatches: knockoutStage.matches.length,
        totalMatches: updatedTournament.matches.length
    });

    return updatedTournament;
}

/**
 * Calculate final ranks for completed two-stage tournament
 *
 * @param {Object} tournament - Completed two-stage tournament
 * @returns {Object} Map of participant_id to final rank
 */
function calculateFinalRanks(tournament) {
    const ranks = {};

    // If knockout stage exists, use knockout rankings for top finishers
    if (tournament.knockoutStage) {
        const knockoutRanks = tournament.options.knockoutFormat === 'double_elimination'
            ? doubleElimination.calculateFinalRanks(tournament.knockoutStage.matches, tournament.knockoutStage.participants)
            : singleElimination.calculateFinalRanks(tournament.knockoutStage.matches, tournament.knockoutStage.participants);

        Object.assign(ranks, knockoutRanks);

        // Participants who didn't make knockout are ranked after knockout finishers
        const knockoutCount = Object.keys(knockoutRanks).length;
        const groupStandings = calculateGroupStandings(
            tournament.groupStage.matches,
            tournament.groupStage.groups,
            { rankedBy: tournament.options.rankedBy }
        );

        // Rank non-advancing participants by group performance
        let currentRank = knockoutCount + 1;
        const nonAdvancing = [];

        Object.values(groupStandings).forEach(standings => {
            standings.slice(tournament.options.advancePerGroup).forEach(s => {
                nonAdvancing.push({
                    participant_id: s.participant_id,
                    group_rank: s.rank,
                    points: s.points,
                    buchholz: s.buchholz
                });
            });
        });

        // Sort non-advancing by group rank, then by points, then by buchholz
        nonAdvancing.sort((a, b) => {
            if (a.group_rank !== b.group_rank) return a.group_rank - b.group_rank;
            if (b.points !== a.points) return b.points - a.points;
            return b.buchholz - a.buchholz;
        });

        nonAdvancing.forEach(p => {
            ranks[p.participant_id] = currentRank++;
        });
    }

    return ranks;
}

/**
 * Get visualization data for two-stage tournament
 *
 * @param {Object} tournament - Two-stage tournament object
 * @returns {Object} Visualization data
 */
function getVisualizationData(tournament) {
    const groupVis = {
        groups: tournament.groupStage.groups.map(group => {
            const groupMatches = tournament.groupStage.matches.filter(m => m.group_id === group.groupId);
            const standings = roundRobin.calculateStandings(groupMatches, group.participants);

            return {
                groupId: group.groupId,
                groupName: group.groupName,
                participants: group.participants,
                matches: groupMatches,
                standings
            };
        })
    };

    let knockoutVis = null;
    if (tournament.knockoutStage) {
        knockoutVis = tournament.options.knockoutFormat === 'double_elimination'
            ? doubleElimination.getVisualizationData(tournament.knockoutStage.matches, tournament.knockoutStage.participants)
            : singleElimination.getVisualizationData(tournament.knockoutStage.matches, tournament.knockoutStage.participants);
    }

    return {
        currentStage: tournament.currentStage,
        groupStage: groupVis,
        knockoutStage: knockoutVis,
        stats: tournament.stats
    };
}

/**
 * Check if tournament is complete
 *
 * @param {Object} tournament - Two-stage tournament object
 * @returns {boolean} True if all stages complete
 */
function isTournamentComplete(tournament) {
    // Group stage must be complete
    if (!isGroupStageComplete(tournament.groupStage.matches)) {
        return false;
    }

    // If no knockout stage yet, not complete
    if (!tournament.knockoutStage) {
        return false;
    }

    // Check knockout stage completion
    const knockoutMatches = tournament.knockoutStage.matches.filter(m => !m.is_bye);
    return knockoutMatches.every(m => m.state === 'complete');
}

module.exports = {
    generate,
    generateGroupStage,
    calculateGroupStandings,
    isGroupStageComplete,
    getAdvancingParticipants,
    generateKnockoutBracket,
    transitionToKnockout,
    calculateFinalRanks,
    getVisualizationData,
    isTournamentComplete
};
