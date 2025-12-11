/**
 * Double Elimination Bracket Generator
 *
 * Generates a double elimination bracket with:
 * - Winners bracket (standard single elimination)
 * - Losers bracket (receives losers from winners)
 * - Grand Finals with optional bracket reset
 * - Proper seeding and BYE handling
 */

const singleElim = require('./single-elimination');

/**
 * Generate losers bracket identifier
 */
function generateLosersIdentifier(round, matchIndex) {
    return `L${Math.abs(round)}-${matchIndex + 1}`;
}

/**
 * Generate double elimination bracket
 *
 * @param {Array} participants - Array of participant objects with {id, seed, name}
 * @param {Object} options - Generation options
 * @param {string} options.grandFinalsModifier - 'single' for single GF, 'skip' to skip GF, null for default (bracket reset)
 * @param {boolean} options.sequentialPairings - Use sequential seeding
 * @returns {Object} Bracket data with matches array
 */
function generate(participants, options = {}) {
    const { grandFinalsModifier = null, sequentialPairings = false } = options;

    // Sort participants by seed
    const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));
    const participantCount = sorted.length;

    if (participantCount < 2) {
        throw new Error('Need at least 2 participants');
    }

    // Calculate bracket sizes
    const bracketSize = singleElim.nextPowerOf2(participantCount);
    const winnersRounds = Math.log2(bracketSize);
    const numByes = bracketSize - participantCount;

    // Generate seeding order
    const seedOrder = sequentialPairings
        ? singleElim.generateSequentialOrder(bracketSize)
        : singleElim.generateStandardBracketOrder(bracketSize);

    // Map seeds to participants
    const seedMap = {};
    sorted.forEach((p, i) => {
        seedMap[i + 1] = p;
    });

    const matches = [];
    let matchId = 0;
    let playOrder = 1;

    // =====================
    // WINNERS BRACKET
    // =====================

    const winnersBracket = [];

    // Winners Round 1
    const w1MatchCount = bracketSize / 2;
    const w1Matches = [];

    for (let i = 0; i < w1MatchCount; i++) {
        const seed1 = seedOrder[i * 2];
        const seed2 = seedOrder[i * 2 + 1];

        const p1 = seedMap[seed1] || null;
        const p2 = seedMap[seed2] || null;

        const isBye = !p1 || !p2;

        const match = {
            id: matchId++,
            identifier: `W1-${i + 1}`,
            round: 1, // Positive rounds = winners
            bracket_position: i,
            losers_bracket: false,
            suggested_play_order: isBye ? null : playOrder++,
            player1_id: p1 ? p1.id : null,
            player2_id: p2 ? p2.id : null,
            player1_seed: seed1,
            player2_seed: seed2,
            player1_prereq_match_id: null,
            player2_prereq_match_id: null,
            state: isBye ? 'complete' : (p1 && p2 ? 'open' : 'pending'),
            winner_id: isBye ? (p1 ? p1.id : p2.id) : null,
            loser_id: null,
            is_bye: isBye
        };

        matches.push(match);
        w1Matches.push(match);
    }
    winnersBracket.push(w1Matches);

    // Subsequent winners rounds
    let prevWinnersMatches = w1Matches;
    for (let round = 2; round <= winnersRounds; round++) {
        const matchesInRound = bracketSize / Math.pow(2, round);
        const roundMatches = [];

        for (let i = 0; i < matchesInRound; i++) {
            const feeder1 = prevWinnersMatches[i * 2];
            const feeder2 = prevWinnersMatches[i * 2 + 1];

            const p1FromBye = feeder1.is_bye ? feeder1.winner_id : null;
            const p2FromBye = feeder2.is_bye ? feeder2.winner_id : null;

            const identifier = round === winnersRounds ? 'WF' : `W${round}-${i + 1}`;

            const match = {
                id: matchId++,
                identifier,
                round: round,
                bracket_position: i,
                losers_bracket: false,
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

        winnersBracket.push(roundMatches);
        prevWinnersMatches = roundMatches;
    }

    // =====================
    // LOSERS BRACKET
    // =====================

    const losersBracket = [];

    // Losers bracket structure for N winners rounds:
    // - LR1 receives losers from WR1 (half the matches)
    // - LR2 receives winners of LR1 vs losers from WR2
    // - Pattern continues...

    // Calculate losers rounds
    // For 8-player double elim: WR=3, LR=4 (L1, L2, L3, L4)
    const losersRounds = (winnersRounds - 1) * 2;

    let losersRound = -1; // Negative rounds = losers bracket
    let prevLosersMatches = [];

    for (let lr = 1; lr <= losersRounds; lr++) {
        const isDropdownRound = (lr % 2 === 1); // Odd rounds receive dropdowns from winners
        const winnersRoundSource = Math.ceil(lr / 2);
        const winnersMatches = winnersBracket[winnersRoundSource - 1] || [];

        const roundMatches = [];

        if (lr === 1) {
            // First losers round: just losers from WR1
            // But we pair them: loser of W1-1 vs loser of W1-matchCount (from opposite side)
            const w1Losers = winnersMatches.filter(m => !m.is_bye);
            const matchCount = Math.floor(w1Losers.length / 2);

            for (let i = 0; i < matchCount; i++) {
                const feeder1 = w1Losers[i];
                const feeder2 = w1Losers[w1Losers.length - 1 - i];

                const match = {
                    id: matchId++,
                    identifier: generateLosersIdentifier(losersRound, i),
                    round: losersRound,
                    bracket_position: i,
                    losers_bracket: true,
                    suggested_play_order: playOrder++,
                    player1_id: null,
                    player2_id: null,
                    player1_prereq_match_id: feeder1.id,
                    player2_prereq_match_id: feeder2.id,
                    player1_is_prereq_loser: true,
                    player2_is_prereq_loser: true,
                    state: 'pending'
                };

                matches.push(match);
                roundMatches.push(match);
            }
        } else if (isDropdownRound) {
            // Dropdown round: winners of prev losers vs losers from winners
            const winnersDropdowns = winnersBracket[winnersRoundSource - 1] || [];
            const matchCount = Math.min(prevLosersMatches.length, winnersDropdowns.length);

            for (let i = 0; i < matchCount; i++) {
                // Reverse the order of dropdowns for proper bracket balancing
                const dropdownIndex = matchCount - 1 - i;

                const match = {
                    id: matchId++,
                    identifier: generateLosersIdentifier(losersRound, i),
                    round: losersRound,
                    bracket_position: i,
                    losers_bracket: true,
                    suggested_play_order: playOrder++,
                    player1_id: null,
                    player2_id: null,
                    player1_prereq_match_id: prevLosersMatches[i].id,
                    player2_prereq_match_id: winnersDropdowns[dropdownIndex].id,
                    player1_is_prereq_loser: false, // Winner of losers match
                    player2_is_prereq_loser: true,  // Loser from winners
                    state: 'pending'
                };

                matches.push(match);
                roundMatches.push(match);
            }
        } else {
            // Non-dropdown round: just winners of previous losers matches
            const matchCount = Math.floor(prevLosersMatches.length / 2);

            for (let i = 0; i < matchCount; i++) {
                const match = {
                    id: matchId++,
                    identifier: generateLosersIdentifier(losersRound, i),
                    round: losersRound,
                    bracket_position: i,
                    losers_bracket: true,
                    suggested_play_order: playOrder++,
                    player1_id: null,
                    player2_id: null,
                    player1_prereq_match_id: prevLosersMatches[i * 2].id,
                    player2_prereq_match_id: prevLosersMatches[i * 2 + 1].id,
                    player1_is_prereq_loser: false,
                    player2_is_prereq_loser: false,
                    state: 'pending'
                };

                matches.push(match);
                roundMatches.push(match);
            }
        }

        losersBracket.push(roundMatches);
        prevLosersMatches = roundMatches;
        losersRound--;
    }

    // Losers Finals (winner of losers bracket faces winners finals loser)
    const winnersFinalsMatch = winnersBracket[winnersRounds - 1][0];
    const lastLosersMatch = prevLosersMatches[0];

    const losersFinalsMatch = {
        id: matchId++,
        identifier: 'LF',
        round: losersRound,
        bracket_position: 0,
        losers_bracket: true,
        suggested_play_order: playOrder++,
        player1_id: null,
        player2_id: null,
        player1_prereq_match_id: lastLosersMatch.id,
        player2_prereq_match_id: winnersFinalsMatch.id,
        player1_is_prereq_loser: false, // Winner of losers semi
        player2_is_prereq_loser: true,  // Loser of winners finals
        state: 'pending'
    };
    matches.push(losersFinalsMatch);

    // =====================
    // GRAND FINALS
    // =====================

    let grandFinals1 = null;
    let grandFinals2 = null; // Reset match

    if (grandFinalsModifier !== 'skip') {
        // Grand Finals 1: Winners bracket champion vs Losers bracket champion
        grandFinals1 = {
            id: matchId++,
            identifier: 'GF',
            round: winnersRounds + 1,
            bracket_position: 0,
            losers_bracket: false,
            suggested_play_order: playOrder++,
            player1_id: null,
            player2_id: null,
            player1_prereq_match_id: winnersFinalsMatch.id,
            player2_prereq_match_id: losersFinalsMatch.id,
            player1_is_prereq_loser: false, // Winner of winners finals
            player2_is_prereq_loser: false, // Winner of losers finals
            state: 'pending',
            is_grand_finals: true
        };
        matches.push(grandFinals1);

        // Grand Finals Reset (only if not 'single' modifier)
        if (grandFinalsModifier !== 'single') {
            grandFinals2 = {
                id: matchId++,
                identifier: 'GF2',
                round: winnersRounds + 2,
                bracket_position: 0,
                losers_bracket: false,
                suggested_play_order: playOrder++,
                player1_id: null,
                player2_id: null,
                player1_prereq_match_id: grandFinals1.id,
                player2_prereq_match_id: grandFinals1.id,
                // This match only happens if losers bracket player wins GF1
                // Player 1 = GF1 loser (only if they were from winners side)
                // Player 2 = GF1 winner (the losers bracket player)
                player1_is_prereq_loser: true,
                player2_is_prereq_loser: false,
                state: 'pending',
                is_grand_finals_reset: true,
                conditional: true // Only played if needed
            };
            matches.push(grandFinals2);
        }
    }

    // Calculate stats
    const stats = {
        participantCount,
        bracketSize,
        winnersRounds,
        losersRounds: losersRounds + 1, // +1 for losers finals
        numByes,
        totalMatches: matches.length,
        grandFinalsModifier,
        hasGrandFinalsReset: grandFinals2 !== null
    };

    return {
        type: 'double_elimination',
        matches,
        winnersBracket,
        losersBracket,
        grandFinals1,
        grandFinals2,
        stats,
        seedOrder,
        options: {
            grandFinalsModifier,
            sequentialPairings
        }
    };
}

/**
 * Check if Grand Finals reset is needed
 * Returns true if losers bracket player won GF1
 */
function needsGrandFinalsReset(matches, gf1WinnerId) {
    const gf1 = matches.find(m => m.identifier === 'GF');
    if (!gf1) return false;

    // The player from winners side is player1 (comes from winners finals)
    // If winner is player2 (from losers bracket), reset is needed
    return gf1.winner_id === gf1.player2_id;
}

/**
 * Calculate final ranks for double elimination
 */
function calculateFinalRanks(matches, participants) {
    const ranks = {};

    // Find the final determining match
    const gf2 = matches.find(m => m.is_grand_finals_reset);
    const gf1 = matches.find(m => m.is_grand_finals && !m.is_grand_finals_reset);

    // Determine 1st and 2nd place
    if (gf2 && gf2.winner_id) {
        // GF reset was played
        ranks[gf2.winner_id] = 1;
        ranks[gf2.loser_id] = 2;
    } else if (gf1 && gf1.winner_id) {
        // GF1 determined the winner (winners bracket player won)
        ranks[gf1.winner_id] = 1;
        ranks[gf1.loser_id] = 2;
    }

    // 3rd place: Losers finals loser
    const lf = matches.find(m => m.identifier === 'LF');
    if (lf && lf.loser_id) {
        ranks[lf.loser_id] = 3;
    }

    // 4th place: Losers semi-finals loser (the one who lost to 3rd place)
    const losersMatches = matches.filter(m => m.losers_bracket).sort((a, b) => b.round - a.round);
    if (losersMatches.length >= 2) {
        const losersSemi = losersMatches[1];
        if (losersSemi && losersSemi.loser_id && !ranks[losersSemi.loser_id]) {
            ranks[losersSemi.loser_id] = 4;
        }
    }

    // Continue ranking by round eliminated
    const allMatches = [...matches].sort((a, b) => {
        // Sort by absolute round descending
        const roundDiff = Math.abs(b.round) - Math.abs(a.round);
        if (roundDiff !== 0) return roundDiff;
        // Losers bracket eliminated before winners in same round level
        return (a.losers_bracket ? 0 : 1) - (b.losers_bracket ? 0 : 1);
    });

    let currentRank = 5;
    const rankedInRound = new Set();

    for (const match of allMatches) {
        if (match.loser_id && !ranks[match.loser_id]) {
            ranks[match.loser_id] = currentRank;
            rankedInRound.add(match.loser_id);
        }
    }

    // Group same-round losers at same rank
    // This is simplified; proper implementation would group by elimination round

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

    // Separate winners and losers
    const winnersRounds = {};
    const losersRounds = {};
    const grandFinals = [];

    matches.forEach(m => {
        const enriched = {
            ...m,
            player1: m.player1_id ? participantMap[m.player1_id] : null,
            player2: m.player2_id ? participantMap[m.player2_id] : null,
            winner: m.winner_id ? participantMap[m.winner_id] : null
        };

        if (m.is_grand_finals || m.is_grand_finals_reset) {
            grandFinals.push(enriched);
        } else if (m.losers_bracket) {
            const round = Math.abs(m.round);
            if (!losersRounds[round]) losersRounds[round] = [];
            losersRounds[round].push(enriched);
        } else {
            if (!winnersRounds[m.round]) winnersRounds[m.round] = [];
            winnersRounds[m.round].push(enriched);
        }
    });

    // Sort matches within each round
    Object.values(winnersRounds).forEach(arr => arr.sort((a, b) => a.bracket_position - b.bracket_position));
    Object.values(losersRounds).forEach(arr => arr.sort((a, b) => a.bracket_position - b.bracket_position));

    return {
        winnersRounds,
        losersRounds,
        grandFinals,
        winnersRoundCount: Object.keys(winnersRounds).length,
        losersRoundCount: Object.keys(losersRounds).length,
        matchCount: matches.length
    };
}

module.exports = {
    generate,
    needsGrandFinalsReset,
    calculateFinalRanks,
    getVisualizationData
};
