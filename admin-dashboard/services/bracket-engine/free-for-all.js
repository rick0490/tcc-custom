/**
 * Free-for-All Tournament Generator
 *
 * Implements multi-player tournament format where players compete simultaneously
 * and earn points based on their placement in each round.
 *
 * Use cases:
 * - Battle royale games (Fortnite, PUBG, Apex)
 * - Racing games (Mario Kart, F-Zero)
 * - Party games with 3+ players per match
 *
 * Features:
 * - Configurable players per match (4-16)
 * - Configurable number of rounds
 * - Customizable points per placement
 * - Cumulative standings across rounds
 */

const { createLogger } = require('../debug-logger');
const logger = createLogger('bracket-engine:free-for-all');

/**
 * Default points system (similar to F1/Mario Kart)
 */
const DEFAULT_POINTS_SYSTEM = {
    1: 25,   // 1st place
    2: 18,   // 2nd place
    3: 15,   // 3rd place
    4: 12,
    5: 10,
    6: 8,
    7: 6,
    8: 4,
    9: 2,
    10: 1,
    default: 0  // 11th and beyond
};

/**
 * Alternative points systems
 */
const POINTS_SYSTEMS = {
    // F1-style (25-18-15-12-10-8-6-4-2-1)
    f1: DEFAULT_POINTS_SYSTEM,

    // Linear descending (10-9-8-7-6-5-4-3-2-1)
    linear: {
        1: 10, 2: 9, 3: 8, 4: 7, 5: 6,
        6: 5, 7: 4, 8: 3, 9: 2, 10: 1,
        default: 0
    },

    // Winner-take-all style
    winner: {
        1: 10, 2: 5, 3: 3, default: 1
    },

    // Fortnite-style (top-heavy)
    fortnite: {
        1: 100, 2: 75, 3: 60, 4: 50, 5: 45,
        6: 40, 7: 35, 8: 30, 9: 25, 10: 20,
        11: 15, 12: 12, 13: 10, 14: 8, 15: 6,
        16: 4, 17: 3, 18: 2, 19: 1, 20: 1,
        default: 0
    }
};

/**
 * Generate free-for-all tournament structure
 *
 * @param {Array} participants - Array of participant objects with {id, seed, name}
 * @param {Object} options - Generation options
 * @param {number} options.playersPerMatch - Players in each match (default 8)
 * @param {number} options.totalRounds - Number of rounds to play (default 3)
 * @param {Object|string} options.pointsSystem - Points per placement or preset name
 * @param {boolean} options.allPlayAllRounds - All players compete every round (true) or lobby-based (false)
 * @returns {Object} Tournament data with matches array
 */
function generate(participants, options = {}) {
    const {
        playersPerMatch = 8,
        totalRounds = 3,
        pointsSystem = DEFAULT_POINTS_SYSTEM,
        allPlayAllRounds = true
    } = options;

    logger.log('generate:start', {
        participantCount: participants.length,
        playersPerMatch,
        totalRounds,
        allPlayAllRounds
    });

    // Validate configuration
    if (participants.length < 3) {
        throw new Error('Need at least 3 participants for free-for-all');
    }
    if (playersPerMatch < 3 || playersPerMatch > 100) {
        throw new Error('playersPerMatch must be between 3 and 100');
    }
    if (totalRounds < 1 || totalRounds > 20) {
        throw new Error('totalRounds must be between 1 and 20');
    }

    // Resolve points system
    const resolvedPoints = typeof pointsSystem === 'string'
        ? POINTS_SYSTEMS[pointsSystem] || DEFAULT_POINTS_SYSTEM
        : pointsSystem;

    // Sort participants by seed
    const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));

    // Generate matches for all rounds
    const matches = [];
    let matchId = 0;
    let playOrder = 1;

    if (allPlayAllRounds) {
        // All players compete in every round
        // Each round has one "match" per lobby (split if too many players)
        for (let round = 1; round <= totalRounds; round++) {
            const roundMatches = generateRoundMatches(
                sorted,
                round,
                playersPerMatch,
                matchId,
                playOrder
            );

            roundMatches.forEach(m => {
                matches.push(m);
                matchId++;
                playOrder++;
            });
        }
    } else {
        // Lobby-based: Participants are split into lobbies
        // (Future enhancement: could support heats/advancement)
        for (let round = 1; round <= totalRounds; round++) {
            const roundMatches = generateRoundMatches(
                sorted,
                round,
                playersPerMatch,
                matchId,
                playOrder
            );

            roundMatches.forEach(m => {
                matches.push(m);
                matchId++;
                playOrder++;
            });
        }
    }

    const stats = {
        participantCount: participants.length,
        playersPerMatch,
        totalRounds,
        matchesPerRound: Math.ceil(participants.length / playersPerMatch),
        totalMatches: matches.length,
        maxPointsPerRound: resolvedPoints[1] || 25,
        maxPossiblePoints: (resolvedPoints[1] || 25) * totalRounds
    };

    logger.log('generate:complete', {
        totalMatches: matches.length,
        stats
    });

    return {
        type: 'free_for_all',
        matches,
        stats,
        participants: sorted,
        options: {
            playersPerMatch,
            totalRounds,
            pointsSystem: resolvedPoints,
            allPlayAllRounds
        }
    };
}

/**
 * Generate matches for a single round
 *
 * @param {Array} participants - All participants
 * @param {number} round - Round number
 * @param {number} playersPerMatch - Max players per match
 * @param {number} startMatchId - Starting match ID
 * @param {number} startPlayOrder - Starting play order
 * @returns {Array} Array of match objects
 */
function generateRoundMatches(participants, round, playersPerMatch, startMatchId, startPlayOrder) {
    const matches = [];

    // If all participants fit in one match, create single match
    if (participants.length <= playersPerMatch) {
        matches.push({
            id: startMatchId,
            identifier: `R${round}-M1`,
            round,
            lobby: 1,
            bracket_position: 0,
            suggested_play_order: startPlayOrder,
            state: round === 1 ? 'open' : 'pending',
            participant_ids: participants.map(p => p.id),
            player_count: participants.length,
            is_ffa: true
        });
    } else {
        // Split into multiple lobbies
        const lobbyCount = Math.ceil(participants.length / playersPerMatch);

        for (let lobby = 0; lobby < lobbyCount; lobby++) {
            const start = lobby * playersPerMatch;
            const end = Math.min(start + playersPerMatch, participants.length);
            const lobbyParticipants = participants.slice(start, end);

            matches.push({
                id: startMatchId + lobby,
                identifier: `R${round}-L${lobby + 1}`,
                round,
                lobby: lobby + 1,
                bracket_position: lobby,
                suggested_play_order: startPlayOrder + lobby,
                state: round === 1 ? 'open' : 'pending',
                participant_ids: lobbyParticipants.map(p => p.id),
                player_count: lobbyParticipants.length,
                is_ffa: true
            });
        }
    }

    return matches;
}

/**
 * Record placements for a completed FFA match
 *
 * @param {Object} match - The match object
 * @param {Array} placements - Array of {participant_id, placement} in order
 * @param {Object} pointsSystem - Points per placement
 * @returns {Object} Match with placements recorded
 */
function recordPlacements(match, placements, pointsSystem = DEFAULT_POINTS_SYSTEM) {
    logger.log('recordPlacements', {
        matchId: match.id,
        placementCount: placements.length
    });

    // Validate all participants are accounted for
    const matchParticipants = new Set(match.participant_ids);
    const placedParticipants = new Set(placements.map(p => p.participant_id));

    if (matchParticipants.size !== placedParticipants.size) {
        throw new Error(`Placement count (${placedParticipants.size}) doesn't match participant count (${matchParticipants.size})`);
    }

    // Calculate points for each placement
    const results = placements.map((p, index) => {
        const placement = p.placement || (index + 1);
        const points = pointsSystem[placement] !== undefined
            ? pointsSystem[placement]
            : (pointsSystem.default || 0);

        return {
            participant_id: p.participant_id,
            placement,
            points_awarded: points
        };
    });

    // Sort by placement
    results.sort((a, b) => a.placement - b.placement);

    return {
        ...match,
        state: 'complete',
        placements: results,
        winner_id: results[0]?.participant_id, // First place
        completed_at: new Date().toISOString()
    };
}

/**
 * Calculate current standings from all matches
 *
 * @param {Array} matches - All tournament matches
 * @param {Array} participants - All participants
 * @param {Object} options - Options including pointsSystem
 * @returns {Array} Sorted standings array
 */
function calculateStandings(matches, participants, options = {}) {
    const { pointsSystem = DEFAULT_POINTS_SYSTEM } = options;

    // Initialize standings
    const standings = {};
    participants.forEach(p => {
        standings[p.id] = {
            participant_id: p.id,
            participant_name: p.name,
            rounds_played: 0,
            total_points: 0,
            wins: 0,  // 1st places
            podiums: 0,  // Top 3 finishes
            placements: [],
            average_placement: 0,
            best_placement: null,
            worst_placement: null
        };
    });

    // Process completed matches
    matches.filter(m => m.state === 'complete' && m.placements).forEach(match => {
        match.placements.forEach(p => {
            const standing = standings[p.participant_id];
            if (!standing) return;

            standing.rounds_played++;
            standing.total_points += p.points_awarded;
            standing.placements.push(p.placement);

            if (p.placement === 1) standing.wins++;
            if (p.placement <= 3) standing.podiums++;

            // Track best/worst
            if (standing.best_placement === null || p.placement < standing.best_placement) {
                standing.best_placement = p.placement;
            }
            if (standing.worst_placement === null || p.placement > standing.worst_placement) {
                standing.worst_placement = p.placement;
            }
        });
    });

    // Calculate averages
    Object.values(standings).forEach(s => {
        if (s.rounds_played > 0) {
            s.average_placement = s.placements.reduce((a, b) => a + b, 0) / s.rounds_played;
        }
    });

    // Sort standings
    const sorted = Object.values(standings).sort((a, b) => {
        // Primary: Total points (descending)
        if (b.total_points !== a.total_points) return b.total_points - a.total_points;

        // Tiebreaker 1: Number of wins
        if (b.wins !== a.wins) return b.wins - a.wins;

        // Tiebreaker 2: Number of podiums
        if (b.podiums !== a.podiums) return b.podiums - a.podiums;

        // Tiebreaker 3: Average placement (ascending - lower is better)
        if (a.average_placement !== b.average_placement) return a.average_placement - b.average_placement;

        // Tiebreaker 4: Best single placement
        if (a.best_placement !== b.best_placement) return (a.best_placement || 999) - (b.best_placement || 999);

        return 0;
    });

    // Assign ranks
    sorted.forEach((s, index) => {
        s.rank = index + 1;
    });

    return sorted;
}

/**
 * Calculate final ranks from standings
 *
 * @param {Array} matches - All matches
 * @param {Array} participants - All participants
 * @param {Object} options - Options
 * @returns {Object} Map of participant_id to final rank
 */
function calculateFinalRanks(matches, participants, options = {}) {
    const standings = calculateStandings(matches, participants, options);
    const ranks = {};

    standings.forEach(s => {
        ranks[s.participant_id] = s.rank;
    });

    return ranks;
}

/**
 * Check if a round is complete
 *
 * @param {Array} matches - All matches
 * @param {number} round - Round number
 * @returns {boolean} True if all matches in round are complete
 */
function isRoundComplete(matches, round) {
    const roundMatches = matches.filter(m => m.round === round);
    return roundMatches.every(m => m.state === 'complete');
}

/**
 * Open next round's matches when current round completes
 *
 * @param {Array} matches - All matches
 * @param {number} completedRound - Just completed round number
 * @returns {Array} Updated matches with next round opened
 */
function openNextRound(matches, completedRound) {
    const nextRound = completedRound + 1;
    const maxRound = Math.max(...matches.map(m => m.round));

    if (nextRound > maxRound) {
        return matches; // Tournament complete
    }

    return matches.map(m => {
        if (m.round === nextRound && m.state === 'pending') {
            return { ...m, state: 'open' };
        }
        return m;
    });
}

/**
 * Check if tournament is complete
 *
 * @param {Array} matches - All matches
 * @returns {boolean} True if all matches complete
 */
function isTournamentComplete(matches) {
    return matches.every(m => m.state === 'complete');
}

/**
 * Get visualization data for free-for-all tournament
 *
 * @param {Array} matches - All matches
 * @param {Array} participants - All participants
 * @returns {Object} Visualization data
 */
function getVisualizationData(matches, participants) {
    const standings = calculateStandings(matches, participants);

    // Group matches by round
    const rounds = {};
    matches.forEach(m => {
        if (!rounds[m.round]) {
            rounds[m.round] = [];
        }
        rounds[m.round].push(m);
    });

    // Calculate round statistics
    const roundStats = Object.keys(rounds).map(round => {
        const roundMatches = rounds[round];
        const complete = roundMatches.filter(m => m.state === 'complete').length;
        const total = roundMatches.length;

        return {
            round: parseInt(round),
            matches: roundMatches,
            complete,
            total,
            isComplete: complete === total
        };
    });

    return {
        standings,
        rounds: roundStats,
        totalRounds: Object.keys(rounds).length,
        completedRounds: roundStats.filter(r => r.isComplete).length,
        currentRound: roundStats.find(r => !r.isComplete)?.round || null
    };
}

module.exports = {
    generate,
    generateRoundMatches,
    recordPlacements,
    calculateStandings,
    calculateFinalRanks,
    isRoundComplete,
    openNextRound,
    isTournamentComplete,
    getVisualizationData,
    // Export points systems for UI
    POINTS_SYSTEMS,
    DEFAULT_POINTS_SYSTEM
};
