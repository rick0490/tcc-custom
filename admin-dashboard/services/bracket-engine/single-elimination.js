/**
 * Single Elimination Bracket Generator
 *
 * Generates a standard single elimination bracket with:
 * - Proper seeding (1v16, 8v9, etc. in standard, or 1v2, 3v4 in sequential)
 * - Bye distribution to top seeds
 * - Optional third place match
 * - Match progression tracking
 */

const { createLogger } = require('../debug-logger');
const logger = createLogger('bracket-engine:single-elim');

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
 * BYE Strategy: Determine which seed positions receive BYEs
 *
 * @param {number} bracketSize - Power of 2 bracket size
 * @param {number} participantCount - Actual number of participants
 * @param {string} strategy - "traditional" | "spread" | "bottom_half" | "random"
 * @returns {Set<number>} Set of seed numbers that should be BYEs
 */
function getByeSeeds(bracketSize, participantCount, strategy) {
    const numByes = bracketSize - participantCount;
    if (numByes <= 0) return new Set();

    switch (strategy) {
        case 'spread':
            return getSpreadByeSeeds(bracketSize, numByes);
        case 'bottom_half':
            return getBottomHalfByeSeeds(bracketSize, numByes);
        case 'random':
            return getRandomByeSeeds(bracketSize, numByes);
        case 'traditional':
        default:
            return getTraditionalByeSeeds(bracketSize, numByes);
    }
}

/**
 * Traditional BYE placement: BYEs go to the highest seed numbers
 * (which means top seeds get BYEs against them)
 *
 * Example: 5 players in 8-bracket
 * Seeds 6, 7, 8 are BYEs → Seeds 1, 2, 3 get byes (matched against high seeds)
 */
function getTraditionalByeSeeds(bracketSize, numByes) {
    const byeSeeds = new Set();
    for (let i = bracketSize; i > bracketSize - numByes; i--) {
        byeSeeds.add(i);
    }
    return byeSeeds;
}

/**
 * Spread BYE placement: BYEs distributed evenly across bracket sections
 * Ensures no single section is BYE-heavy
 *
 * Example: 5 players in 8-bracket (3 BYEs)
 * Standard bracket order: [1,8,4,5,2,7,3,6]
 * We want BYEs spread across sections, not all in one half
 * Place BYEs at positions: seeds distributed across bracket sections
 */
function getSpreadByeSeeds(bracketSize, numByes) {
    const byeSeeds = new Set();

    // Calculate section size (how to divide bracket)
    // For spread, we want to place BYEs as evenly as possible
    const matchCount = bracketSize / 2;

    // Determine spacing between BYEs
    // Try to place one BYE per section where possible
    const spacing = Math.floor(matchCount / numByes);

    // Get the standard bracket order to understand positions
    const bracketOrder = generateStandardBracketOrder(bracketSize);

    // Select BYE positions spread across the bracket
    // Start from the end (weaker seeds) and space evenly
    const byePositions = [];
    for (let i = 0; i < numByes; i++) {
        // Calculate position in bracket order (spread evenly)
        let pos = Math.floor((i + 0.5) * (bracketSize / numByes));
        pos = Math.min(pos, bracketSize - 1);

        // Take the higher seed at this position (odd index in pair)
        const pairStart = Math.floor(pos / 2) * 2;
        const byeSeed = bracketOrder[pairStart + 1]; // Take second seed in pair (higher seed number)
        byePositions.push(byeSeed);
    }

    // Sort and take unique, fill in if needed
    byePositions.sort((a, b) => b - a);
    byePositions.forEach(seed => byeSeeds.add(seed));

    // If we don't have enough unique BYEs, fill from highest available
    let fillSeed = bracketSize;
    while (byeSeeds.size < numByes && fillSeed > 0) {
        if (!byeSeeds.has(fillSeed)) {
            byeSeeds.add(fillSeed);
        }
        fillSeed--;
    }

    return byeSeeds;
}

/**
 * Bottom-half BYE placement: All BYEs placed in the bottom half of the bracket
 * Top half has no BYEs, ensuring competitive matches throughout
 *
 * Example: 5 players in 8-bracket (3 BYEs)
 * Bracket has 4 matches: Matches 1,2 (top half) and Matches 3,4 (bottom half)
 * BYEs go to positions in bottom half only: seeds 6, 7, 8
 */
function getBottomHalfByeSeeds(bracketSize, numByes) {
    const byeSeeds = new Set();

    // Get standard bracket order
    const bracketOrder = generateStandardBracketOrder(bracketSize);

    // Bottom half starts at position bracketSize/2
    // Extract seeds from bottom half and take BYEs from there
    const bottomHalfSeeds = [];
    for (let i = bracketSize / 2; i < bracketSize; i++) {
        bottomHalfSeeds.push(bracketOrder[i]);
    }

    // Sort descending (highest seeds first - they become BYEs)
    bottomHalfSeeds.sort((a, b) => b - a);

    // Take the required number of BYEs from bottom half
    for (let i = 0; i < Math.min(numByes, bottomHalfSeeds.length); i++) {
        byeSeeds.add(bottomHalfSeeds[i]);
    }

    // If more BYEs needed than bottom half can hold, spill to top half (highest seeds first)
    if (byeSeeds.size < numByes) {
        const topHalfSeeds = [];
        for (let i = 0; i < bracketSize / 2; i++) {
            topHalfSeeds.push(bracketOrder[i]);
        }
        topHalfSeeds.sort((a, b) => b - a);

        for (let i = 0; i < topHalfSeeds.length && byeSeeds.size < numByes; i++) {
            byeSeeds.add(topHalfSeeds[i]);
        }
    }

    return byeSeeds;
}

/**
 * Random BYE placement: BYEs randomly assigned to seed positions
 *
 * Example: 5 players in 8-bracket (3 BYEs)
 * Randomly select 3 seeds to be BYEs
 */
function getRandomByeSeeds(bracketSize, numByes) {
    const byeSeeds = new Set();

    // Create array of all possible seeds
    const allSeeds = Array.from({ length: bracketSize }, (_, i) => i + 1);

    // Fisher-Yates shuffle
    for (let i = allSeeds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allSeeds[i], allSeeds[j]] = [allSeeds[j], allSeeds[i]];
    }

    // Take first numByes as BYE seeds
    for (let i = 0; i < numByes; i++) {
        byeSeeds.add(allSeeds[i]);
    }

    return byeSeeds;
}

/**
 * Map participants to seeds based on BYE strategy
 *
 * @param {Array} participants - Sorted participants by seed
 * @param {number} bracketSize - Power of 2 bracket size
 * @param {Set<number>} byeSeeds - Set of seeds that should be BYEs
 * @returns {Object} Map of seed number to participant (or null for BYE)
 */
function mapParticipantsToSeeds(participants, bracketSize, byeSeeds) {
    const seedMap = {};

    // Get all seed positions that are NOT BYEs
    const activeSeedPositions = [];
    for (let i = 1; i <= bracketSize; i++) {
        if (!byeSeeds.has(i)) {
            activeSeedPositions.push(i);
        }
    }

    // Sort active positions (lowest seed numbers first = strongest seeds)
    activeSeedPositions.sort((a, b) => a - b);

    // Assign participants to active seed positions in order
    for (let i = 0; i < participants.length && i < activeSeedPositions.length; i++) {
        seedMap[activeSeedPositions[i]] = participants[i];
    }

    // Mark BYE positions as null
    byeSeeds.forEach(seed => {
        seedMap[seed] = null;
    });

    return seedMap;
}

/**
 * Calculate the compact bracket structure
 * Returns main bracket size and number of play-in matches needed
 *
 * @param {number} participantCount - Number of participants
 * @returns {Object} Structure with mainBracketSize, playInMatches, directEntries, playInParticipants
 */
function calculateCompactBracketStructure(participantCount) {
    // Find largest power of 2 <= participantCount
    let mainBracketSize = 1;
    while (mainBracketSize * 2 <= participantCount) {
        mainBracketSize *= 2;
    }

    // If exactly power of 2, no play-ins needed
    if (mainBracketSize === participantCount) {
        return {
            mainBracketSize,
            playInMatches: 0,
            directEntries: participantCount,
            playInParticipants: 0
        };
    }

    // Calculate play-in structure
    const playInSpots = participantCount - mainBracketSize;
    const playInMatches = playInSpots;
    const playInParticipants = playInMatches * 2;
    const directEntries = participantCount - playInParticipants;

    return {
        mainBracketSize,
        playInMatches,
        directEntries,
        playInParticipants
    };
}

/**
 * Generate compact bracket with play-in rounds instead of BYEs
 *
 * @param {Array} participants - Array of participant objects with {id, seed, name}
 * @param {Object} options - Generation options
 * @returns {Object} Bracket data with matches array including play-in matches
 */
function generateCompactBracket(participants, options = {}) {
    const {
        holdThirdPlaceMatch = false,
        sequentialPairings = false
    } = options;

    // Sort participants by seed
    const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));
    const participantCount = sorted.length;

    if (participantCount < 2) {
        throw new Error('Need at least 2 participants');
    }

    // Calculate structure
    const structure = calculateCompactBracketStructure(participantCount);
    const { mainBracketSize, playInMatches, directEntries, playInParticipants } = structure;

    logger.log('generateCompact:start', {
        participantCount,
        mainBracketSize,
        playInMatches,
        directEntries
    });

    // If no play-ins needed (exact power of 2), use standard generation
    if (playInMatches === 0) {
        const result = generate(sorted, { holdThirdPlaceMatch, sequentialPairings, byeStrategy: 'traditional' });
        result.stats.isCompact = true;
        result.options.compactBracket = true;
        return result;
    }

    const matches = [];
    let matchId = 0;
    let playOrder = 1;

    // Split participants into direct entries and play-in participants
    const directEntryParticipants = sorted.slice(0, directEntries);
    const playInParticipantsList = sorted.slice(directEntries);

    // Generate play-in matches
    // Seeding: highest play-in seed vs lowest play-in seed (e.g., 3v6, 4v5)
    const playInMatchesList = [];
    for (let i = 0; i < playInMatches; i++) {
        const topSeedIdx = i;
        const bottomSeedIdx = playInParticipants - 1 - i;

        const p1 = playInParticipantsList[topSeedIdx];
        const p2 = playInParticipantsList[bottomSeedIdx];

        const match = {
            id: matchId++,
            identifier: `PI${i + 1}`,
            round: 0, // Play-in round is before round 1
            bracket_position: i,
            suggested_play_order: playOrder++,
            player1_id: p1.id,
            player2_id: p2.id,
            player1_seed: p1.seed || (directEntries + topSeedIdx + 1),
            player2_seed: p2.seed || (directEntries + bottomSeedIdx + 1),
            player1_prereq_match_id: null,
            player2_prereq_match_id: null,
            state: 'open',
            is_play_in: true
        };

        matches.push(match);
        playInMatchesList.push(match);
    }

    // Generate main bracket
    const numRounds = Math.log2(mainBracketSize);

    // Generate seeding order for main bracket
    const seedOrder = sequentialPairings
        ? generateSequentialOrder(mainBracketSize)
        : generateStandardBracketOrder(mainBracketSize);

    // Round 1 of main bracket
    const r1MatchCount = mainBracketSize / 2;
    const r1Matches = [];

    for (let i = 0; i < r1MatchCount; i++) {
        const seed1 = seedOrder[i * 2];
        const seed2 = seedOrder[i * 2 + 1];

        // Determine player1
        let p1 = null, p1PrereqMatchId = null;
        if (seed1 <= directEntries) {
            p1 = directEntryParticipants[seed1 - 1];
        } else {
            // This seed comes from a play-in match
            const playInIdx = seed1 - directEntries - 1;
            p1PrereqMatchId = playInMatchesList[playInIdx].id;
        }

        // Determine player2
        let p2 = null, p2PrereqMatchId = null;
        if (seed2 <= directEntries) {
            p2 = directEntryParticipants[seed2 - 1];
        } else {
            const playInIdx = seed2 - directEntries - 1;
            p2PrereqMatchId = playInMatchesList[playInIdx].id;
        }

        const match = {
            id: matchId++,
            identifier: generateIdentifier(1, i, numRounds),
            round: 1,
            bracket_position: i,
            suggested_play_order: playOrder++,
            player1_id: p1 ? p1.id : null,
            player2_id: p2 ? p2.id : null,
            player1_seed: seed1,
            player2_seed: seed2,
            player1_prereq_match_id: p1PrereqMatchId,
            player2_prereq_match_id: p2PrereqMatchId,
            player1_is_prereq_loser: false,
            player2_is_prereq_loser: false,
            state: (p1 && p2) ? 'open' : 'pending'
        };

        matches.push(match);
        r1Matches.push(match);
    }

    // Subsequent rounds
    let prevRoundMatches = r1Matches;
    for (let round = 2; round <= numRounds; round++) {
        const matchesInRound = mainBracketSize / Math.pow(2, round);
        const roundMatches = [];

        for (let i = 0; i < matchesInRound; i++) {
            const feeder1 = prevRoundMatches[i * 2];
            const feeder2 = prevRoundMatches[i * 2 + 1];

            const match = {
                id: matchId++,
                identifier: generateIdentifier(round, i, numRounds),
                round: round,
                bracket_position: i,
                suggested_play_order: playOrder++,
                player1_id: null,
                player2_id: null,
                player1_prereq_match_id: feeder1.id,
                player2_prereq_match_id: feeder2.id,
                player1_is_prereq_loser: false,
                player2_is_prereq_loser: false,
                state: 'pending'
            };

            matches.push(match);
            roundMatches.push(match);
        }

        prevRoundMatches = roundMatches;
    }

    // Third place match
    let thirdPlaceMatch = null;
    if (holdThirdPlaceMatch && numRounds >= 2) {
        const semiFinals = matches.filter(m => m.round === numRounds - 1);

        if (semiFinals.length === 2) {
            thirdPlaceMatch = {
                id: matchId++,
                identifier: '3RD',
                round: numRounds,
                bracket_position: 1,
                suggested_play_order: playOrder++,
                player1_id: null,
                player2_id: null,
                player1_prereq_match_id: semiFinals[0].id,
                player2_prereq_match_id: semiFinals[1].id,
                player1_is_prereq_loser: true,
                player2_is_prereq_loser: true,
                state: 'pending',
                is_third_place: true
            };
            matches.push(thirdPlaceMatch);
        }
    }

    const stats = {
        participantCount,
        mainBracketSize,
        bracketSize: mainBracketSize,
        playInMatches,
        numRounds,
        numByes: 0,
        totalMatches: matches.length,
        hasThirdPlaceMatch: !!thirdPlaceMatch,
        isCompact: true
    };

    logger.log('generateCompact:complete', {
        matchCount: matches.length,
        playInMatchCount: playInMatchesList.length,
        r1Matches: r1Matches.length,
        hasThirdPlaceMatch: !!thirdPlaceMatch
    });

    return {
        type: 'single_elimination',
        matches,
        stats,
        seedOrder,
        options: {
            holdThirdPlaceMatch,
            sequentialPairings,
            compactBracket: true
        }
    };
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
 * @param {string} options.byeStrategy - BYE distribution strategy: "traditional" | "spread" | "bottom_half" | "random"
 * @returns {Object} Bracket data with matches array
 */
function generate(participants, options = {}) {
    const {
        holdThirdPlaceMatch = false,
        sequentialPairings = false,
        byeStrategy = 'traditional'
    } = options;

    logger.log('generate:start', {
        participantCount: participants.length,
        holdThirdPlaceMatch,
        sequentialPairings,
        byeStrategy
    });

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

    logger.log('generate:bracketSize', {
        participantCount,
        bracketSize,
        numRounds,
        numByes,
        byeStrategy
    });

    // Generate seeding order
    const seedOrder = sequentialPairings
        ? generateSequentialOrder(bracketSize)
        : generateStandardBracketOrder(bracketSize);

    // Get BYE seeds based on strategy
    const byeSeeds = getByeSeeds(bracketSize, participantCount, byeStrategy);

    logger.log('generate:byeSeeds', {
        strategy: byeStrategy,
        byeSeeds: Array.from(byeSeeds)
    });

    // Map participants to seeds using BYE strategy
    const seedMap = mapParticipantsToSeeds(sorted, bracketSize, byeSeeds);

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

    logger.log('generate:complete', {
        matchCount: matches.length,
        r1Matches: matches.filter(m => m.round === 1).length,
        byeMatches: matches.filter(m => m.is_bye).length,
        openMatches: matches.filter(m => m.state === 'open').length,
        hasThirdPlaceMatch: !!thirdPlaceMatch
    });

    return {
        type: 'single_elimination',
        matches,
        stats,
        seedOrder,
        options: {
            holdThirdPlaceMatch,
            sequentialPairings,
            byeStrategy
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
    generateCompactBracket,
    calculateFinalRanks,
    getVisualizationData,
    // Export utilities for testing
    nextPowerOf2,
    generateStandardBracketOrder,
    generateSequentialOrder,
    calculateCompactBracketStructure,
    // Export BYE strategy functions for testing
    getByeSeeds,
    getTraditionalByeSeeds,
    getSpreadByeSeeds,
    getBottomHalfByeSeeds,
    getRandomByeSeeds,
    mapParticipantsToSeeds
};
