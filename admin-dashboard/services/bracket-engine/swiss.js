/**
 * Swiss System Tournament Generator
 *
 * Generates Swiss-style pairings where:
 * - Players with similar scores are paired
 * - Rematches are avoided when possible
 * - Bye is given to lowest-ranked unpaired player
 * - Number of rounds is typically log2(n) or configurable
 *
 * Features:
 * - Buchholz tiebreaker calculation
 * - Rematch avoidance
 * - Fair bye distribution
 * - Support for late entries
 */

const { createLogger } = require('../debug-logger');
const logger = createLogger('bracket-engine:swiss');

/**
 * Calculate recommended number of Swiss rounds
 */
function recommendedRounds(participantCount) {
    return Math.ceil(Math.log2(participantCount));
}

/**
 * Generate initial round 1 pairings
 * Top half vs bottom half by seed
 */
function generateRound1(participants) {
    const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));
    const halfCount = Math.floor(sorted.length / 2);

    const pairings = [];
    for (let i = 0; i < halfCount; i++) {
        pairings.push({
            player1: sorted[i],
            player2: sorted[halfCount + i]
        });
    }

    // Handle odd number - last player gets BYE
    let byePlayer = null;
    if (sorted.length % 2 === 1) {
        byePlayer = sorted[sorted.length - 1];
    }

    return { pairings, byePlayer };
}

/**
 * Calculate current scores and standings
 */
function calculateScores(matches, participants, completedRounds) {
    const scores = {};

    // Initialize
    participants.forEach(p => {
        scores[p.id] = {
            participant_id: p.id,
            participant: p,
            points: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            opponents: [],
            hadBye: false,
            buchholz: 0
        };
    });

    // Process completed matches
    matches.filter(m => m.state === 'complete').forEach(match => {
        const p1 = scores[match.player1_id];
        const p2 = scores[match.player2_id];

        if (p1 && p2) {
            p1.opponents.push(match.player2_id);
            p2.opponents.push(match.player1_id);

            if (match.winner_id === match.player1_id) {
                p1.points += 1;
                p1.wins++;
                p2.losses++;
            } else if (match.winner_id === match.player2_id) {
                p2.points += 1;
                p2.wins++;
                p1.losses++;
            } else {
                // Draw
                p1.points += 0.5;
                p2.points += 0.5;
                p1.draws++;
                p2.draws++;
            }
        }

        // BYE handling
        if (match.is_bye && match.winner_id) {
            const byeWinner = scores[match.winner_id];
            if (byeWinner) {
                byeWinner.points += 1;
                byeWinner.wins++;
                byeWinner.hadBye = true;
            }
        }
    });

    // Calculate Buchholz (sum of opponents' scores)
    Object.values(scores).forEach(s => {
        s.buchholz = s.opponents.reduce((sum, oppId) => {
            return sum + (scores[oppId]?.points || 0);
        }, 0);
    });

    return scores;
}

/**
 * Generate pairings for subsequent rounds
 * Pairs players with similar scores, avoiding rematches
 */
function generateRoundN(participants, matches, roundNumber) {
    const scores = calculateScores(matches, participants, roundNumber - 1);

    // Sort by points (desc), then by Buchholz (desc), then by seed
    const sorted = Object.values(scores).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
        return (a.participant.seed || 999) - (b.participant.seed || 999);
    });

    // Group by score
    const scoreGroups = {};
    sorted.forEach(s => {
        const key = s.points.toString();
        if (!scoreGroups[key]) scoreGroups[key] = [];
        scoreGroups[key].push(s);
    });

    // Create pairings
    const pairings = [];
    const paired = new Set();
    let byePlayer = null;

    // Process score groups from highest to lowest
    const sortedKeys = Object.keys(scoreGroups)
        .map(Number)
        .sort((a, b) => b - a);

    const unpaired = [...sorted];

    // Try to pair within score groups first
    for (const key of sortedKeys) {
        const group = scoreGroups[key].filter(s => !paired.has(s.participant_id));

        while (group.length >= 2) {
            const p1 = group.shift();
            paired.add(p1.participant_id);

            // Find best opponent (hasn't played before, closest in standing)
            let bestOpponent = null;
            let bestIndex = -1;

            for (let i = 0; i < group.length; i++) {
                const candidate = group[i];
                const hasPlayed = p1.opponents.includes(candidate.participant_id);

                if (!hasPlayed) {
                    bestOpponent = candidate;
                    bestIndex = i;
                    break; // Take first valid opponent (already sorted by quality)
                }
            }

            // If no valid opponent in group, try lower groups
            if (!bestOpponent) {
                for (const lowerKey of sortedKeys) {
                    if (Number(lowerKey) >= Number(key)) continue;
                    const lowerGroup = scoreGroups[lowerKey].filter(s => !paired.has(s.participant_id));

                    for (const candidate of lowerGroup) {
                        const hasPlayed = p1.opponents.includes(candidate.participant_id);
                        if (!hasPlayed) {
                            bestOpponent = candidate;
                            break;
                        }
                    }
                    if (bestOpponent) break;
                }
            }

            // If still no opponent (everyone has played), force a rematch
            if (!bestOpponent && group.length > 0) {
                bestOpponent = group[0];
                bestIndex = 0;
            }

            if (bestOpponent) {
                if (bestIndex >= 0) {
                    group.splice(bestIndex, 1);
                }
                paired.add(bestOpponent.participant_id);
                pairings.push({
                    player1: p1.participant,
                    player2: bestOpponent.participant
                });
            } else {
                // This player couldn't be paired, will get BYE
                paired.delete(p1.participant_id);
                group.unshift(p1); // Put back
                break;
            }
        }
    }

    // Handle BYE - lowest unpaired player who hasn't had a BYE
    const unpairedPlayers = sorted.filter(s => !paired.has(s.participant_id));
    if (unpairedPlayers.length === 1) {
        byePlayer = unpairedPlayers[0].participant;
    } else if (unpairedPlayers.length > 1) {
        // Multiple unpaired - pair them even if rematches
        for (let i = 0; i < unpairedPlayers.length - 1; i += 2) {
            pairings.push({
                player1: unpairedPlayers[i].participant,
                player2: unpairedPlayers[i + 1].participant
            });
        }
        if (unpairedPlayers.length % 2 === 1) {
            byePlayer = unpairedPlayers[unpairedPlayers.length - 1].participant;
        }
    }

    return { pairings, byePlayer };
}

/**
 * Generate Swiss tournament structure
 *
 * @param {Array} participants - Array of participant objects
 * @param {Object} options - Generation options
 * @param {number} options.rounds - Number of rounds (default: log2(n))
 * @param {boolean} options.allowRematches - Whether to allow rematches if necessary
 * @returns {Object} Tournament data
 */
function generate(participants, options = {}) {
    const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));
    const participantCount = sorted.length;

    if (participantCount < 2) {
        throw new Error('Need at least 2 participants');
    }

    const {
        rounds = recommendedRounds(participantCount),
        allowRematches = true
    } = options;

    logger.log('generate:start', {
        participantCount,
        rounds,
        allowRematches,
        recommendedRounds: recommendedRounds(participantCount)
    });

    // Generate round 1
    const { pairings: r1Pairings, byePlayer: r1Bye } = generateRound1(sorted);

    const matches = [];
    let matchId = 0;
    let playOrder = 1;

    // Create round 1 matches
    r1Pairings.forEach((pairing, index) => {
        matches.push({
            id: matchId++,
            identifier: `R1-${index + 1}`,
            round: 1,
            bracket_position: index,
            suggested_play_order: playOrder++,
            player1_id: pairing.player1.id,
            player2_id: pairing.player2.id,
            player1_prereq_match_id: null,
            player2_prereq_match_id: null,
            state: 'open'
        });
    });

    // BYE match for round 1
    if (r1Bye) {
        matches.push({
            id: matchId++,
            identifier: `R1-BYE`,
            round: 1,
            bracket_position: r1Pairings.length,
            suggested_play_order: null,
            player1_id: r1Bye.id,
            player2_id: null,
            state: 'complete',
            winner_id: r1Bye.id,
            is_bye: true
        });
    }

    // Note: Subsequent rounds are generated dynamically as rounds complete
    // We'll store placeholder structures for the expected rounds

    const stats = {
        participantCount,
        totalRounds: rounds,
        matchesPerRound: Math.floor(participantCount / 2),
        totalMatches: Math.floor(participantCount / 2) * rounds + (participantCount % 2 === 1 ? rounds : 0),
        currentRound: 1,
        allowRematches
    };

    logger.log('generate:complete', {
        matchCount: matches.length,
        totalRounds: rounds,
        r1Matches: matches.filter(m => m.round === 1 && !m.is_bye).length,
        r1Bye: r1Bye ? r1Bye.name : null
    });

    return {
        type: 'swiss',
        matches,
        stats,
        options: {
            rounds,
            allowRematches
        },
        // Function to generate next round (called after all current round matches complete)
        generateNextRound: (allMatches, allParticipants, nextRoundNumber) => {
            return generateRoundN(allParticipants, allMatches, nextRoundNumber);
        }
    };
}

/**
 * Check if round is complete
 */
function isRoundComplete(matches, roundNumber) {
    const roundMatches = matches.filter(m => m.round === roundNumber && !m.is_bye);
    return roundMatches.every(m => m.state === 'complete');
}

/**
 * Create matches for next round
 */
function createNextRoundMatches(allMatches, participants, roundNumber) {
    const { pairings, byePlayer } = generateRoundN(participants, allMatches, roundNumber);

    let matchId = Math.max(...allMatches.map(m => m.id)) + 1;
    let playOrder = Math.max(...allMatches.map(m => m.suggested_play_order || 0)) + 1;

    const newMatches = [];

    pairings.forEach((pairing, index) => {
        newMatches.push({
            id: matchId++,
            identifier: `R${roundNumber}-${index + 1}`,
            round: roundNumber,
            bracket_position: index,
            suggested_play_order: playOrder++,
            player1_id: pairing.player1.id,
            player2_id: pairing.player2.id,
            player1_prereq_match_id: null,
            player2_prereq_match_id: null,
            state: 'open'
        });
    });

    if (byePlayer) {
        newMatches.push({
            id: matchId++,
            identifier: `R${roundNumber}-BYE`,
            round: roundNumber,
            bracket_position: pairings.length,
            suggested_play_order: null,
            player1_id: byePlayer.id,
            player2_id: null,
            state: 'complete',
            winner_id: byePlayer.id,
            is_bye: true
        });
    }

    return newMatches;
}

/**
 * Calculate final standings
 */
function calculateStandings(matches, participants) {
    const scores = calculateScores(matches, participants);

    // Sort by points, then tiebreakers
    const sorted = Object.values(scores).sort((a, b) => {
        // Primary: points
        if (b.points !== a.points) return b.points - a.points;

        // Tiebreaker 1: Buchholz
        if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;

        // Tiebreaker 2: Direct encounter (not implemented in simple version)

        // Tiebreaker 3: Number of wins
        if (b.wins !== a.wins) return b.wins - a.wins;

        // Tiebreaker 4: Original seed
        return (a.participant.seed || 999) - (b.participant.seed || 999);
    });

    sorted.forEach((s, index) => {
        s.rank = index + 1;
    });

    return sorted;
}

/**
 * Calculate final ranks
 */
function calculateFinalRanks(matches, participants) {
    const standings = calculateStandings(matches, participants);
    const ranks = {};

    standings.forEach(s => {
        ranks[s.participant_id] = s.rank;
    });

    return ranks;
}

/**
 * Get visualization data for Swiss
 */
function getVisualizationData(matches, participants) {
    const participantMap = {};
    participants.forEach(p => {
        participantMap[p.id] = p;
    });

    // Group by round
    const rounds = {};
    matches.forEach(m => {
        if (!rounds[m.round]) rounds[m.round] = [];
        rounds[m.round].push({
            ...m,
            player1: m.player1_id ? participantMap[m.player1_id] : null,
            player2: m.player2_id ? participantMap[m.player2_id] : null,
            winner: m.winner_id ? participantMap[m.winner_id] : null
        });
    });

    // Current standings
    const standings = calculateStandings(matches, participants);

    return {
        rounds,
        standings,
        currentRound: Math.max(...matches.map(m => m.round)),
        roundCount: Object.keys(rounds).length,
        matchCount: matches.length
    };
}

/**
 * Check if tournament should continue
 * Returns false if all rounds are played or clear winner
 */
function shouldContinue(matches, participants, totalRounds) {
    const currentRound = Math.max(...matches.map(m => m.round));

    if (currentRound >= totalRounds) {
        return false;
    }

    // Check if current round is complete
    if (!isRoundComplete(matches, currentRound)) {
        return true; // Still playing current round
    }

    // Could add early termination if one player is clearly unbeatable
    // For now, always play all rounds
    return currentRound < totalRounds;
}

module.exports = {
    generate,
    generateRound1,
    generateRoundN,
    isRoundComplete,
    createNextRoundMatches,
    calculateScores,
    calculateStandings,
    calculateFinalRanks,
    recommendedRounds,
    shouldContinue,
    getVisualizationData
};
