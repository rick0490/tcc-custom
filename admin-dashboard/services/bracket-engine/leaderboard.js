/**
 * Leaderboard Tournament Generator
 *
 * Implements ongoing rankings across multiple events/sessions.
 * Unlike traditional tournaments, leaderboards persist over time
 * and accumulate results from multiple events.
 *
 * Use cases:
 * - Weekly arcade rankings
 * - Fighting game scene ELO
 * - Season-long point accumulation
 * - Racing league standings
 *
 * Features:
 * - Multiple events per leaderboard
 * - Configurable point systems
 * - ELO-based ranking option
 * - Point decay (optional)
 * - Minimum events to rank
 */

const { createLogger } = require('../debug-logger');
const logger = createLogger('bracket-engine:leaderboard');

/**
 * Default points system for event placements
 */
const DEFAULT_POINTS_SYSTEM = {
    1: 25,
    2: 18,
    3: 15,
    4: 12,
    5: 10,
    6: 8,
    7: 6,
    8: 4,
    9: 2,
    10: 1,
    default: 0
};

/**
 * ELO configuration defaults
 */
const DEFAULT_ELO_CONFIG = {
    initialRating: 1200,
    kFactor: 32,
    floorRating: 100
};

/**
 * Ranking types
 */
const RANKING_TYPES = {
    POINTS: 'points',
    ELO: 'elo',
    WINS: 'wins'
};

/**
 * Generate/initialize leaderboard structure
 *
 * @param {Array} participants - Initial participants (can be empty)
 * @param {Object} options - Generation options
 * @param {string} options.rankingType - 'points', 'elo', or 'wins'
 * @param {Object} options.pointsSystem - Points per placement
 * @param {boolean} options.decayEnabled - Enable point decay
 * @param {number} options.decayRate - Percentage decay per period (0-100)
 * @param {number} options.decayPeriodDays - Days between decay applications
 * @param {number} options.minEventsToRank - Minimum events to appear in rankings
 * @param {Object} options.eloConfig - ELO configuration (if using ELO)
 * @returns {Object} Leaderboard data structure
 */
function generate(participants = [], options = {}) {
    const {
        rankingType = RANKING_TYPES.POINTS,
        pointsSystem = DEFAULT_POINTS_SYSTEM,
        decayEnabled = false,
        decayRate = 10,
        decayPeriodDays = 30,
        minEventsToRank = 1,
        eloConfig = DEFAULT_ELO_CONFIG,
        seasonName = null
    } = options;

    logger.log('generate:start', {
        participantCount: participants.length,
        rankingType,
        decayEnabled,
        minEventsToRank
    });

    // Initialize participant standings
    const standings = {};
    participants.forEach(p => {
        standings[p.id] = initializeParticipantStanding(p, rankingType, eloConfig);
    });

    const leaderboard = {
        type: 'leaderboard',
        rankingType,
        seasonName,
        events: [],
        standings,
        stats: {
            participantCount: participants.length,
            eventCount: 0,
            totalResults: 0,
            lastEventDate: null,
            lastDecayDate: null
        },
        options: {
            rankingType,
            pointsSystem,
            decayEnabled,
            decayRate,
            decayPeriodDays,
            minEventsToRank,
            eloConfig
        }
    };

    logger.log('generate:complete', {
        standingsCount: Object.keys(standings).length
    });

    return leaderboard;
}

/**
 * Initialize a participant's standing record
 */
function initializeParticipantStanding(participant, rankingType, eloConfig) {
    const base = {
        participant_id: participant.id,
        participant_name: participant.name,
        events_played: 0,
        total_points: 0,
        wins: 0,
        podiums: 0,
        event_results: [],
        last_event_date: null,
        joined_at: new Date().toISOString()
    };

    if (rankingType === RANKING_TYPES.ELO) {
        base.elo_rating = eloConfig.initialRating;
        base.peak_elo = eloConfig.initialRating;
        base.elo_history = [];
    }

    return base;
}

/**
 * Add a new event to the leaderboard
 *
 * @param {Object} leaderboard - Leaderboard object
 * @param {Object} eventData - Event details
 * @param {string} eventData.name - Event name
 * @param {Date} eventData.date - Event date
 * @param {Array} eventData.results - Array of {participant_id, placement, score?}
 * @returns {Object} Updated leaderboard
 */
function addEvent(leaderboard, eventData) {
    const { name, date = new Date(), results } = eventData;

    logger.log('addEvent:start', {
        eventName: name,
        resultCount: results.length
    });

    const event = {
        id: leaderboard.events.length + 1,
        name,
        date: date instanceof Date ? date.toISOString() : date,
        results: [],
        participant_count: results.length
    };

    // Process results and update standings
    results.forEach(result => {
        // Ensure participant exists in standings
        if (!leaderboard.standings[result.participant_id]) {
            leaderboard.standings[result.participant_id] = initializeParticipantStanding(
                { id: result.participant_id, name: result.participant_name || `Player ${result.participant_id}` },
                leaderboard.rankingType,
                leaderboard.options.eloConfig
            );
        }

        const standing = leaderboard.standings[result.participant_id];
        const pointsAwarded = calculateEventPoints(result.placement, leaderboard.options.pointsSystem);

        // Update standing
        standing.events_played++;
        standing.total_points += pointsAwarded;
        standing.last_event_date = event.date;

        if (result.placement === 1) standing.wins++;
        if (result.placement <= 3) standing.podiums++;

        standing.event_results.push({
            event_id: event.id,
            event_name: name,
            placement: result.placement,
            points_awarded: pointsAwarded,
            date: event.date
        });

        // ELO updates (if applicable)
        if (leaderboard.rankingType === RANKING_TYPES.ELO && results.length >= 2) {
            updateEloRating(standing, result.placement, results.length, leaderboard.options.eloConfig);
        }

        event.results.push({
            participant_id: result.participant_id,
            placement: result.placement,
            points_awarded: pointsAwarded,
            score: result.score
        });
    });

    // Sort event results by placement
    event.results.sort((a, b) => a.placement - b.placement);

    leaderboard.events.push(event);
    leaderboard.stats.eventCount++;
    leaderboard.stats.totalResults += results.length;
    leaderboard.stats.lastEventDate = event.date;
    leaderboard.stats.participantCount = Object.keys(leaderboard.standings).length;

    logger.log('addEvent:complete', {
        eventId: event.id,
        standingsUpdated: results.length
    });

    return leaderboard;
}

/**
 * Calculate points for a placement
 */
function calculateEventPoints(placement, pointsSystem) {
    if (pointsSystem[placement] !== undefined) {
        return pointsSystem[placement];
    }
    return pointsSystem.default || 0;
}

/**
 * Update ELO rating based on event performance
 * Simplified: treats placement as performance metric
 */
function updateEloRating(standing, placement, totalParticipants, eloConfig) {
    const { kFactor, floorRating } = eloConfig;

    // Calculate expected vs actual performance
    // Higher placement = better performance
    const expectedRank = totalParticipants / 2; // Expected median finish
    const performanceFactor = (expectedRank - placement) / expectedRank; // -1 to +1 range

    // Adjust rating
    const adjustment = Math.round(kFactor * performanceFactor);
    const newRating = Math.max(floorRating, standing.elo_rating + adjustment);

    standing.elo_history.push({
        date: new Date().toISOString(),
        old_rating: standing.elo_rating,
        new_rating: newRating,
        change: newRating - standing.elo_rating,
        placement,
        total_participants: totalParticipants
    });

    standing.elo_rating = newRating;
    standing.peak_elo = Math.max(standing.peak_elo, newRating);
}

/**
 * Apply point decay to all standings
 * Should be called periodically (e.g., daily/weekly)
 *
 * @param {Object} leaderboard - Leaderboard object
 * @returns {Object} Updated leaderboard with decay applied
 */
function applyDecay(leaderboard) {
    if (!leaderboard.options.decayEnabled) {
        return leaderboard;
    }

    const now = new Date();
    const lastDecay = leaderboard.stats.lastDecayDate
        ? new Date(leaderboard.stats.lastDecayDate)
        : null;

    // Check if decay should be applied
    if (lastDecay) {
        const daysSinceDecay = (now - lastDecay) / (1000 * 60 * 60 * 24);
        if (daysSinceDecay < leaderboard.options.decayPeriodDays) {
            return leaderboard; // Not time for decay yet
        }
    }

    logger.log('applyDecay', {
        decayRate: leaderboard.options.decayRate
    });

    const decayMultiplier = 1 - (leaderboard.options.decayRate / 100);

    Object.values(leaderboard.standings).forEach(standing => {
        const oldPoints = standing.total_points;
        standing.total_points = Math.floor(standing.total_points * decayMultiplier);

        if (oldPoints !== standing.total_points) {
            logger.log('applyDecay:participant', {
                participantId: standing.participant_id,
                oldPoints,
                newPoints: standing.total_points
            });
        }
    });

    leaderboard.stats.lastDecayDate = now.toISOString();

    return leaderboard;
}

/**
 * Calculate current leaderboard standings
 *
 * @param {Object} leaderboard - Leaderboard object
 * @returns {Array} Sorted standings array
 */
function calculateStandings(leaderboard) {
    const { rankingType, minEventsToRank } = leaderboard.options;

    // Get all standings
    let standings = Object.values(leaderboard.standings);

    // Filter by minimum events
    const ranked = standings.filter(s => s.events_played >= minEventsToRank);
    const unranked = standings.filter(s => s.events_played < minEventsToRank);

    // Sort based on ranking type
    ranked.sort((a, b) => {
        switch (rankingType) {
            case RANKING_TYPES.ELO:
                return b.elo_rating - a.elo_rating;

            case RANKING_TYPES.WINS:
                if (b.wins !== a.wins) return b.wins - a.wins;
                if (b.podiums !== a.podiums) return b.podiums - a.podiums;
                return b.total_points - a.total_points;

            case RANKING_TYPES.POINTS:
            default:
                if (b.total_points !== a.total_points) return b.total_points - a.total_points;
                if (b.wins !== a.wins) return b.wins - a.wins;
                if (b.podiums !== a.podiums) return b.podiums - a.podiums;
                // Tiebreaker: average placement (lower is better)
                const avgA = a.event_results.length > 0
                    ? a.event_results.reduce((sum, r) => sum + r.placement, 0) / a.event_results.length
                    : 999;
                const avgB = b.event_results.length > 0
                    ? b.event_results.reduce((sum, r) => sum + r.placement, 0) / b.event_results.length
                    : 999;
                return avgA - avgB;
        }
    });

    // Assign ranks
    ranked.forEach((s, index) => {
        s.rank = index + 1;
        s.is_ranked = true;
    });

    unranked.forEach(s => {
        s.rank = null;
        s.is_ranked = false;
        s.events_needed = minEventsToRank - s.events_played;
    });

    return [...ranked, ...unranked];
}

/**
 * Calculate final ranks (alias for calculateStandings)
 */
function calculateFinalRanks(leaderboard) {
    const standings = calculateStandings(leaderboard);
    const ranks = {};

    standings.forEach(s => {
        ranks[s.participant_id] = s.rank;
    });

    return ranks;
}

/**
 * Get participant history
 *
 * @param {Object} leaderboard - Leaderboard object
 * @param {number} participantId - Participant ID
 * @returns {Object|null} Participant history
 */
function getParticipantHistory(leaderboard, participantId) {
    const standing = leaderboard.standings[participantId];
    if (!standing) return null;

    return {
        ...standing,
        events: standing.event_results.map(r => {
            const event = leaderboard.events.find(e => e.id === r.event_id);
            return {
                ...r,
                event_participant_count: event?.participant_count
            };
        })
    };
}

/**
 * Get event details
 *
 * @param {Object} leaderboard - Leaderboard object
 * @param {number} eventId - Event ID
 * @returns {Object|null} Event details
 */
function getEvent(leaderboard, eventId) {
    return leaderboard.events.find(e => e.id === eventId) || null;
}

/**
 * Reset leaderboard for new season
 * Archives current standings and starts fresh
 *
 * @param {Object} leaderboard - Leaderboard object
 * @param {string} newSeasonName - Name for new season
 * @returns {Object} Object with archived data and new leaderboard
 */
function resetSeason(leaderboard, newSeasonName) {
    logger.log('resetSeason', {
        oldSeason: leaderboard.seasonName,
        newSeason: newSeasonName
    });

    // Archive current state
    const archive = {
        seasonName: leaderboard.seasonName,
        finalStandings: calculateStandings(leaderboard),
        events: leaderboard.events,
        stats: leaderboard.stats,
        archivedAt: new Date().toISOString()
    };

    // Create new leaderboard keeping participants but resetting scores
    const participants = Object.values(leaderboard.standings).map(s => ({
        id: s.participant_id,
        name: s.participant_name
    }));

    const newLeaderboard = generate(participants, {
        ...leaderboard.options,
        seasonName: newSeasonName
    });

    return {
        archive,
        leaderboard: newLeaderboard
    };
}

/**
 * Check if leaderboard is "complete" (not really applicable, but for interface compatibility)
 */
function isTournamentComplete() {
    // Leaderboards don't really "complete" - they're ongoing
    return false;
}

/**
 * Get visualization data for leaderboard
 *
 * @param {Object} leaderboard - Leaderboard object
 * @returns {Object} Visualization data
 */
function getVisualizationData(leaderboard) {
    const standings = calculateStandings(leaderboard);

    // Recent events (last 10)
    const recentEvents = [...leaderboard.events]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 10);

    // Top performers
    const topPerformers = standings.filter(s => s.is_ranked).slice(0, 10);

    // Calculate trends (if enough events)
    const trends = {};
    if (leaderboard.events.length >= 3) {
        const recentEventIds = recentEvents.slice(0, 3).map(e => e.id);

        topPerformers.forEach(s => {
            const recentResults = s.event_results
                .filter(r => recentEventIds.includes(r.event_id));

            const recentPoints = recentResults.reduce((sum, r) => sum + r.points_awarded, 0);
            const avgPointsPerEvent = s.total_points / s.events_played;
            const recentAvg = recentResults.length > 0 ? recentPoints / recentResults.length : 0;

            trends[s.participant_id] = {
                trending: recentAvg > avgPointsPerEvent ? 'up' : (recentAvg < avgPointsPerEvent ? 'down' : 'stable'),
                recentAvg,
                overallAvg: avgPointsPerEvent
            };
        });
    }

    return {
        standings: topPerformers,
        allStandings: standings,
        recentEvents,
        trends,
        stats: leaderboard.stats,
        rankingType: leaderboard.rankingType,
        seasonName: leaderboard.seasonName
    };
}

module.exports = {
    generate,
    addEvent,
    applyDecay,
    calculateStandings,
    calculateFinalRanks,
    getParticipantHistory,
    getEvent,
    resetSeason,
    isTournamentComplete,
    getVisualizationData,
    // Export types and defaults
    RANKING_TYPES,
    DEFAULT_POINTS_SYSTEM,
    DEFAULT_ELO_CONFIG
};
