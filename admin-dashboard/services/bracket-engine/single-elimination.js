/**
 * Single Elimination Bracket Generator
 *
 * Generates a standard single elimination bracket with:
 * - Proper seeding (1v16, 8v9, etc. in standard, or 1v2, 3v4 in sequential)
 * - Bye distribution to top seeds
 * - Optional third place match
 * - Match progression tracking
 */

/**
 * Get the next power of 2 >= n
 */
function nextPowerOf2(n) {
    let power = 1;
    while (power < n) {
        power *= 2;
    }
    return power;
}

/**
 * Generate standard bracket seeding order
 * For 8 players: [1,8,4,5,2,7,3,6]
 * This ensures 1 plays 8, 4 plays 5, etc. in round 1
 * And winner of 1v8 plays winner of 4v5, etc.
 */
function generateStandardBracketOrder(bracketSize) {
    if (bracketSize === 1) return [1];
    if (bracketSize === 2) return [1, 2];

    // Recursive approach to build proper seeding
    const order = [];
    const halfSize = bracketSize / 2;

    // Get order for smaller bracket
    const smallerOrder = generateStandardBracketOrder(halfSize);

    // Interleave with complementary seeds
    for (const seed of smallerOrder) {
        order.push(seed);
        order.push(bracketSize + 1 - seed);
    }

    return order;
}

/**
 * Generate sequential seeding order
 * For 8 players: [1,2,3,4,5,6,7,8]
 */
function generateSequentialOrder(bracketSize) {
    return Array.from({ length: bracketSize }, (_, i) => i + 1);
}

/**
 * Generate match identifier (A, B, C, ... for round 1, then A1, A2, etc.)
 */
function generateIdentifier(round, matchIndex, totalRounds) {
    if (round === totalRounds) {
        return 'GF'; // Grand Finals
    }
    if (round === totalRounds - 1) {
        return 'SF' + (matchIndex + 1); // Semi Finals
    }
    if (round === totalRounds - 2) {
        return 'QF' + (matchIndex + 1); // Quarter Finals
    }

    // Earlier rounds: A1, A2, B1, B2, etc.
    const letter = String.fromCharCode(65 + Math.floor(matchIndex / 2));
    const num = (matchIndex % 2) + 1;
    return `R${round}-${letter}${num}`;
}

/**
 * Generate single elimination bracket
 *
 * @param {Array} participants - Array of participant objects with {id, seed, name}
 * @param {Object} options - Generation options
 * @param {boolean} options.holdThirdPlaceMatch - Include 3rd place match
 * @param {boolean} options.sequentialPairings - Use sequential seeding (1v2) instead of standard (1v16)
 * @returns {Object} Bracket data with matches array
 */
function generate(participants, options = {}) {
    const { holdThirdPlaceMatch = false, sequentialPairings = false } = options;

    // Sort participants by seed
    const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));
    const participantCount = sorted.length;

    if (participantCount < 2) {
        throw new Error('Need at least 2 participants');
    }

    // Calculate bracket size (next power of 2)
    const bracketSize = nextPowerOf2(participantCount);
    const numRounds = Math.log2(bracketSize);
    const numByes = bracketSize - participantCount;

    // Generate seeding order
    const seedOrder = sequentialPairings
        ? generateSequentialOrder(bracketSize)
        : generateStandardBracketOrder(bracketSize);

    // Map seeds to participants (BYE for missing)
    const seedMap = {};
    sorted.forEach((p, i) => {
        seedMap[i + 1] = p;
    });

    // Generate matches
    const matches = [];
    let matchId = 0;
    let playOrder = 1;

    // Track which match each participant/bye ends up in
    const slotToMatch = {}; // slot index -> {matchId, playerSlot}

    // Round 1: Initial matches
    const r1MatchCount = bracketSize / 2;
    const r1Matches = [];

    for (let i = 0; i < r1MatchCount; i++) {
        const seed1 = seedOrder[i * 2];
        const seed2 = seedOrder[i * 2 + 1];

        const p1 = seedMap[seed1] || null;
        const p2 = seedMap[seed2] || null;

        // Check if this is a BYE match
        const isBye = !p1 || !p2;

        const match = {
            id: matchId++,
            identifier: generateIdentifier(1, i, numRounds),
            round: 1,
            bracket_position: i,
            suggested_play_order: isBye ? null : playOrder++,
            player1_id: p1 ? p1.id : null,
            player2_id: p2 ? p2.id : null,
            player1_seed: seed1,
            player2_seed: seed2,
            player1_prereq_match_id: null,
            player2_prereq_match_id: null,
            state: isBye ? 'complete' : (p1 && p2 ? 'open' : 'pending'),
            // If BYE, auto-advance the present player
            winner_id: isBye ? (p1 ? p1.id : p2.id) : null,
            is_bye: isBye
        };

        matches.push(match);
        r1Matches.push(match);
    }

    // Subsequent rounds
    let prevRoundMatches = r1Matches;
    for (let round = 2; round <= numRounds; round++) {
        const matchesInRound = bracketSize / Math.pow(2, round);
        const roundMatches = [];

        for (let i = 0; i < matchesInRound; i++) {
            // Get the two feeder matches
            const feeder1 = prevRoundMatches[i * 2];
            const feeder2 = prevRoundMatches[i * 2 + 1];

            // Check if both feeders are BYEs (so this match has predetermined players)
            const p1FromBye = feeder1.is_bye ? feeder1.winner_id : null;
            const p2FromBye = feeder2.is_bye ? feeder2.winner_id : null;

            const match = {
                id: matchId++,
                identifier: generateIdentifier(round, i, numRounds),
                round: round,
                bracket_position: i,
                suggested_play_order: playOrder++,
                player1_id: p1FromBye,
                player2_id: p2FromBye,
                player1_prereq_match_id: feeder1.id,
                player2_prereq_match_id: feeder2.id,
                player1_is_prereq_loser: false,
                player2_is_prereq_loser: false,
                state: (p1FromBye && p2FromBye) ? 'open' : 'pending'
            };

            matches.push(match);
            roundMatches.push(match);
        }

        prevRoundMatches = roundMatches;
    }

    // Third place match (optional)
    let thirdPlaceMatch = null;
    if (holdThirdPlaceMatch && numRounds >= 2) {
        // Third place match is between losers of semi-finals
        const semiFinals = matches.filter(m => m.round === numRounds - 1);

        if (semiFinals.length === 2) {
            thirdPlaceMatch = {
                id: matchId++,
                identifier: '3RD',
                round: numRounds, // Same round as finals for timing
                bracket_position: 1, // Position after finals
                suggested_play_order: playOrder++,
                player1_id: null,
                player2_id: null,
                player1_prereq_match_id: semiFinals[0].id,
                player2_prereq_match_id: semiFinals[1].id,
                player1_is_prereq_loser: true, // Winner of this slot is SF1 LOSER
                player2_is_prereq_loser: true, // Winner of this slot is SF2 LOSER
                state: 'pending',
                is_third_place: true
            };
            matches.push(thirdPlaceMatch);
        }
    }

    // Calculate bracket statistics
    const stats = {
        participantCount,
        bracketSize,
        numRounds,
        numByes,
        totalMatches: matches.length,
        hasThirdPlaceMatch: !!thirdPlaceMatch
    };

    return {
        type: 'single_elimination',
        matches,
        stats,
        seedOrder,
        options: {
            holdThirdPlaceMatch,
            sequentialPairings
        }
    };
}

/**
 * Calculate final ranks after tournament completion
 */
function calculateFinalRanks(matches, participants) {
    const ranks = {};

    // Find finals match
    const finals = matches.find(m => m.identifier === 'GF' || m.round === Math.max(...matches.map(m => m.round)));

    if (finals && finals.winner_id) {
        ranks[finals.winner_id] = 1;
        ranks[finals.loser_id] = 2;
    }

    // Third place match
    const thirdPlace = matches.find(m => m.is_third_place);
    if (thirdPlace && thirdPlace.winner_id) {
        ranks[thirdPlace.winner_id] = 3;
        ranks[thirdPlace.loser_id] = 4;
    } else {
        // If no third place match, both semi-final losers are tied for 3rd
        const semiFinals = matches.filter(m => m.round === Math.max(...matches.map(m => m.round)) - 1);
        semiFinals.forEach(sf => {
            if (sf.loser_id && !ranks[sf.loser_id]) {
                ranks[sf.loser_id] = 3;
            }
        });
    }

    // Rank by round eliminated
    const maxRound = Math.max(...matches.map(m => m.round));
    for (let round = maxRound - 2; round >= 1; round--) {
        const roundMatches = matches.filter(m => m.round === round && !m.is_bye);
        const rank = Math.pow(2, maxRound - round) + 1; // Round of 8 losers = 5th, etc.

        roundMatches.forEach(m => {
            if (m.loser_id && !ranks[m.loser_id]) {
                ranks[m.loser_id] = rank;
            }
        });
    }

    return ranks;
}

/**
 * Get bracket visualization data
 */
function getVisualizationData(matches, participants) {
    const participantMap = {};
    participants.forEach(p => {
        participantMap[p.id] = p;
    });

    // Group by round
    const rounds = {};
    matches.forEach(m => {
        if (!rounds[m.round]) {
            rounds[m.round] = [];
        }
        rounds[m.round].push({
            ...m,
            player1: m.player1_id ? participantMap[m.player1_id] : null,
            player2: m.player2_id ? participantMap[m.player2_id] : null,
            winner: m.winner_id ? participantMap[m.winner_id] : null
        });
    });

    // Sort matches within each round by bracket position
    Object.keys(rounds).forEach(round => {
        rounds[round].sort((a, b) => a.bracket_position - b.bracket_position);
    });

    return {
        rounds,
        roundCount: Object.keys(rounds).length,
        matchCount: matches.length
    };
}

module.exports = {
    generate,
    calculateFinalRanks,
    getVisualizationData,
    // Export utilities for testing
    nextPowerOf2,
    generateStandardBracketOrder,
    generateSequentialOrder
};
