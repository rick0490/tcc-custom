/**
 * Round Robin Tournament Generator
 *
 * Generates a round robin schedule where every participant plays every other participant.
 * Uses the circle method (Berger tables) for optimal scheduling.
 *
 * Features:
 * - Handles odd/even participant counts
 * - Support for multiple iterations (double round robin, etc.)
 * - Configurable ranking criteria
 * - Group stage support
 */

/**
 * Generate round robin schedule using circle method
 *
 * @param {Array} participants - Array of participant objects with {id, seed, name}
 * @param {Object} options - Generation options
 * @param {number} options.iterations - Number of times to play through (1 = single RR, 2 = double RR)
 * @param {string} options.rankedBy - Ranking criteria: 'match wins', 'game wins', 'points scored', 'points difference'
 * @param {Object} options.pointsPerResult - Points per match result {win: 3, draw: 1, loss: 0}
 * @param {boolean} options.allowTies - Whether matches can end in a tie
 * @returns {Object} Tournament data with matches array
 */
function generate(participants, options = {}) {
    const {
        iterations = 1,
        rankedBy = 'match wins',
        pointsPerResult = { win: 1, draw: 0.5, loss: 0 },
        allowTies = false
    } = options;

    // Sort by seed
    const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));
    const participantCount = sorted.length;

    if (participantCount < 2) {
        throw new Error('Need at least 2 participants');
    }

    // For odd number of participants, add a BYE
    const isOdd = participantCount % 2 === 1;
    const effectiveCount = isOdd ? participantCount + 1 : participantCount;

    // Create participant list (with BYE placeholder if needed)
    const players = sorted.map(p => p.id);
    if (isOdd) {
        players.push(null); // BYE
    }

    const matches = [];
    let matchId = 0;
    let playOrder = 1;

    // Calculate number of rounds (each participant plays once per round except BYE)
    const roundsPerIteration = effectiveCount - 1;
    const totalRounds = roundsPerIteration * iterations;

    // Generate schedule using circle method
    for (let iteration = 0; iteration < iterations; iteration++) {
        for (let round = 0; round < roundsPerIteration; round++) {
            const actualRound = iteration * roundsPerIteration + round + 1;
            const roundMatches = [];

            // Generate pairings for this round
            for (let i = 0; i < effectiveCount / 2; i++) {
                // Calculate indices using circle method
                let p1Index, p2Index;

                if (i === 0) {
                    // First position is fixed
                    p1Index = 0;
                    p2Index = (round + 1) % (effectiveCount - 1);
                    if (p2Index === 0) p2Index = effectiveCount - 1;
                } else {
                    // Other positions rotate
                    p1Index = ((round + i) % (effectiveCount - 1)) + 1;
                    p2Index = ((round + effectiveCount - 1 - i) % (effectiveCount - 1)) + 1;

                    // Adjust for last position
                    if (p1Index === 0) p1Index = effectiveCount - 1;
                    if (p2Index === 0) p2Index = effectiveCount - 1;
                }

                const player1Id = players[p1Index];
                const player2Id = players[p2Index];

                // Skip BYE matches
                if (player1Id === null || player2Id === null) {
                    continue;
                }

                // Alternate home/away for even iterations
                const swapOrder = iteration % 2 === 1 && i % 2 === 0;

                const match = {
                    id: matchId++,
                    identifier: `R${actualRound}-${roundMatches.length + 1}`,
                    round: actualRound,
                    bracket_position: roundMatches.length,
                    suggested_play_order: playOrder++,
                    player1_id: swapOrder ? player2Id : player1Id,
                    player2_id: swapOrder ? player1Id : player2Id,
                    player1_prereq_match_id: null,
                    player2_prereq_match_id: null,
                    state: 'open', // All RR matches can be played from start
                    iteration: iteration + 1
                };

                matches.push(match);
                roundMatches.push(match);
            }
        }
    }

    // Calculate expected matches
    const matchesPerIteration = (participantCount * (participantCount - 1)) / 2;
    const expectedMatches = matchesPerIteration * iterations;

    const stats = {
        participantCount,
        roundsPerIteration,
        totalRounds,
        iterations,
        matchesPerIteration,
        totalMatches: matches.length,
        expectedMatches,
        isOdd,
        rankedBy
    };

    return {
        type: 'round_robin',
        matches,
        stats,
        options: {
            iterations,
            rankedBy,
            pointsPerResult,
            allowTies
        }
    };
}

/**
 * Calculate standings from completed matches
 *
 * @param {Array} matches - Array of match objects with results
 * @param {Array} participants - Array of participant objects
 * @param {Object} options - Ranking options
 * @returns {Array} Sorted standings array
 */
function calculateStandings(matches, participants, options = {}) {
    const {
        rankedBy = 'match wins',
        pointsPerResult = { win: 1, draw: 0.5, loss: 0 }
    } = options;

    // Initialize standings for each participant
    const standings = {};
    participants.forEach(p => {
        standings[p.id] = {
            participant_id: p.id,
            participant_name: p.name,
            matches_played: 0,
            matches_won: 0,
            matches_lost: 0,
            matches_tied: 0,
            games_won: 0,
            games_lost: 0,
            points: 0,
            points_scored: 0,
            points_against: 0,
            buchholz: 0,
            opponents: [],
            head_to_head: {}
        };
    });

    // Process completed matches
    matches.filter(m => m.state === 'complete').forEach(match => {
        const p1 = standings[match.player1_id];
        const p2 = standings[match.player2_id];

        if (!p1 || !p2) return;

        p1.matches_played++;
        p2.matches_played++;

        // Track opponents for Buchholz
        p1.opponents.push(match.player2_id);
        p2.opponents.push(match.player1_id);

        // Game/set scores
        const p1Score = match.player1_score || 0;
        const p2Score = match.player2_score || 0;

        p1.games_won += p1Score;
        p1.games_lost += p2Score;
        p2.games_won += p2Score;
        p2.games_lost += p1Score;

        p1.points_scored += p1Score;
        p1.points_against += p2Score;
        p2.points_scored += p2Score;
        p2.points_against += p1Score;

        // Match result
        if (match.winner_id === match.player1_id) {
            p1.matches_won++;
            p2.matches_lost++;
            p1.points += pointsPerResult.win;
            p2.points += pointsPerResult.loss;
            p1.head_to_head[match.player2_id] = (p1.head_to_head[match.player2_id] || 0) + 1;
        } else if (match.winner_id === match.player2_id) {
            p2.matches_won++;
            p1.matches_lost++;
            p2.points += pointsPerResult.win;
            p1.points += pointsPerResult.loss;
            p2.head_to_head[match.player1_id] = (p2.head_to_head[match.player1_id] || 0) + 1;
        } else {
            // Draw
            p1.matches_tied++;
            p2.matches_tied++;
            p1.points += pointsPerResult.draw;
            p2.points += pointsPerResult.draw;
        }
    });

    // Calculate Buchholz score (sum of opponents' points)
    Object.values(standings).forEach(s => {
        s.buchholz = s.opponents.reduce((sum, oppId) => {
            return sum + (standings[oppId]?.points || 0);
        }, 0);
        s.points_difference = s.points_scored - s.points_against;
        s.game_difference = s.games_won - s.games_lost;
    });

    // Sort standings
    const sorted = Object.values(standings).sort((a, b) => {
        // Primary: by ranking criteria
        switch (rankedBy) {
            case 'points':
            case 'match wins':
                if (b.points !== a.points) return b.points - a.points;
                break;
            case 'game wins':
                if (b.games_won !== a.games_won) return b.games_won - a.games_won;
                break;
            case 'points scored':
                if (b.points_scored !== a.points_scored) return b.points_scored - a.points_scored;
                break;
            case 'points difference':
                if (b.points_difference !== a.points_difference) return b.points_difference - a.points_difference;
                break;
        }

        // Tiebreakers
        // 1. Head-to-head
        const h2hA = a.head_to_head[b.participant_id] || 0;
        const h2hB = b.head_to_head[a.participant_id] || 0;
        if (h2hA !== h2hB) return h2hB - h2hA;

        // 2. Game/point difference
        if (b.points_difference !== a.points_difference) return b.points_difference - a.points_difference;
        if (b.game_difference !== a.game_difference) return b.game_difference - a.game_difference;

        // 3. Buchholz
        if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;

        // 4. Total wins
        if (b.matches_won !== a.matches_won) return b.matches_won - a.matches_won;

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
 */
function calculateFinalRanks(matches, participants, options) {
    const standings = calculateStandings(matches, participants, options);
    const ranks = {};

    standings.forEach(s => {
        ranks[s.participant_id] = s.rank;
    });

    return ranks;
}

/**
 * Generate group stage (multiple round robin groups)
 *
 * @param {Array} participants - All participants
 * @param {Object} options - Group options
 * @param {number} options.groupCount - Number of groups
 * @param {number} options.advancingPerGroup - How many advance from each group
 * @returns {Object} Group stage data
 */
function generateGroupStage(participants, options = {}) {
    const {
        groupCount = 2,
        advancingPerGroup = 2,
        iterations = 1,
        rankedBy = 'match wins'
    } = options;

    // Sort by seed
    const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));

    // Distribute into groups (snake draft style)
    const groups = Array.from({ length: groupCount }, () => []);

    sorted.forEach((p, index) => {
        const row = Math.floor(index / groupCount);
        const col = row % 2 === 0 ? index % groupCount : groupCount - 1 - (index % groupCount);
        groups[col].push({ ...p, group_id: col + 1 });
    });

    // Generate round robin for each group
    const groupBrackets = groups.map((groupParticipants, groupIndex) => {
        const bracket = generate(groupParticipants, { iterations, rankedBy });

        // Tag matches with group ID
        bracket.matches.forEach(m => {
            m.group_id = groupIndex + 1;
            m.identifier = `G${groupIndex + 1}-${m.identifier}`;
        });

        return {
            groupId: groupIndex + 1,
            participants: groupParticipants,
            bracket
        };
    });

    // Flatten all matches
    const allMatches = groupBrackets.flatMap(g => g.bracket.matches);

    // Renumber match IDs
    allMatches.forEach((m, index) => {
        m.id = index;
    });

    const stats = {
        participantCount: participants.length,
        groupCount,
        participantsPerGroup: Math.ceil(participants.length / groupCount),
        advancingPerGroup,
        totalAdvancing: groupCount * advancingPerGroup,
        matchesPerGroup: groupBrackets[0]?.bracket.matches.length || 0,
        totalMatches: allMatches.length
    };

    return {
        type: 'round_robin_groups',
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
 * Get participants advancing from group stage
 */
function getAdvancingParticipants(groupBrackets, advancingPerGroup) {
    const advancing = [];

    groupBrackets.forEach(group => {
        const standings = calculateStandings(group.bracket.matches, group.participants);
        const topN = standings.slice(0, advancingPerGroup);

        advancing.push(...topN.map(s => ({
            participant_id: s.participant_id,
            group_id: group.groupId,
            group_rank: s.rank,
            new_seed: advancing.length + 1
        })));
    });

    // Re-seed for bracket phase (1st from each group, then 2nd from each, etc.)
    advancing.sort((a, b) => {
        if (a.group_rank !== b.group_rank) return a.group_rank - b.group_rank;
        return a.group_id - b.group_id;
    });

    advancing.forEach((p, index) => {
        p.new_seed = index + 1;
    });

    return advancing;
}

/**
 * Get visualization data for round robin
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

    // Calculate current standings
    const standings = calculateStandings(matches, participants);

    return {
        rounds,
        standings,
        roundCount: Object.keys(rounds).length,
        matchCount: matches.length
    };
}

module.exports = {
    generate,
    calculateStandings,
    calculateFinalRanks,
    generateGroupStage,
    getAdvancingParticipants,
    getVisualizationData
};
