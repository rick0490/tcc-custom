#!/usr/bin/env node
/**
 * Test script for new tournament formats
 * Run: node test-new-formats.js
 */

const bracketEngine = require('./index');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        testsPassed++;
    } catch (error) {
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${error.message}`);
        testsFailed++;
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
    }
}

// Generate test participants
function generateParticipants(count) {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Player ${i + 1}`,
        seed: i + 1
    }));
}

// ============================================
// TWO-STAGE TOURNAMENT TESTS
// ============================================
console.log('\n=== TWO-STAGE TOURNAMENT TESTS ===\n');

test('two_stage: generates with 16 participants, 4 groups', () => {
    const participants = generateParticipants(16);
    const result = bracketEngine.generate('two_stage', participants, {
        groupCount: 4,
        advancePerGroup: 2,
        knockoutFormat: 'single_elimination'
    });

    assert(result.type === 'two_stage', 'Type should be two_stage');
    assert(result.currentStage === 'group', 'Should start in group stage');
    assert(result.groupStage.groups.length === 4, 'Should have 4 groups');

    // Each group should have 4 participants
    result.groupStage.groups.forEach((g, i) => {
        assertEqual(g.participants.length, 4, `Group ${i + 1} should have 4 participants`);
    });

    // Check snake draft seeding
    // Group A should have seeds 1, 8, 9, 16
    // Group B should have seeds 2, 7, 10, 15
    const groupASeeds = result.groupStage.groups[0].participants.map(p => p.seed);
    assert(groupASeeds.includes(1), 'Group A should have seed 1');
    assert(groupASeeds.includes(8), 'Group A should have seed 8');
});

test('two_stage: generates correct number of group matches', () => {
    const participants = generateParticipants(16);
    const result = bracketEngine.generate('two_stage', participants, {
        groupCount: 4,
        advancePerGroup: 2
    });

    // 4 players per group = 6 matches per group (round robin)
    // 4 groups = 24 total group matches
    assertEqual(result.groupStage.matches.length, 24, 'Should have 24 group matches');
});

test('two_stage: group stage complete detection', () => {
    const participants = generateParticipants(8);
    const result = bracketEngine.generate('two_stage', participants, {
        groupCount: 2,
        advancePerGroup: 2
    });

    // Initially not complete
    assert(!bracketEngine.twoStage.isGroupStageComplete(result.groupStage.matches),
        'Group stage should not be complete initially');

    // Mark all matches as complete
    result.groupStage.matches.forEach(m => {
        m.state = 'complete';
        m.winner_id = m.player1_id;
        m.player1_score = 2;
        m.player2_score = 1;
    });

    assert(bracketEngine.twoStage.isGroupStageComplete(result.groupStage.matches),
        'Group stage should be complete after all matches done');
});

test('two_stage: advancing participants calculation', () => {
    const participants = generateParticipants(8);
    const result = bracketEngine.generate('two_stage', participants, {
        groupCount: 2,
        advancePerGroup: 2
    });

    // Simulate completed matches with clear winners
    result.groupStage.groups.forEach(group => {
        const groupMatches = result.groupStage.matches.filter(m => m.group_id === group.groupId);

        // Higher seed wins all matches
        groupMatches.forEach(m => {
            m.state = 'complete';
            const p1Seed = group.participants.find(p => p.id === m.player1_id)?.seed || 999;
            const p2Seed = group.participants.find(p => p.id === m.player2_id)?.seed || 999;

            if (p1Seed < p2Seed) {
                m.winner_id = m.player1_id;
                m.loser_id = m.player2_id;
            } else {
                m.winner_id = m.player2_id;
                m.loser_id = m.player1_id;
            }
            m.player1_score = m.winner_id === m.player1_id ? 2 : 0;
            m.player2_score = m.winner_id === m.player2_id ? 2 : 0;
        });
    });

    const advancing = bracketEngine.twoStage.getAdvancingParticipants(
        result.groupStage.matches,
        result.groupStage.groups,
        2
    );

    assertEqual(advancing.length, 4, 'Should have 4 advancing participants');

    // Check knockout seeding order
    assert(advancing[0].knockout_seed === 1, 'First advancer should be seed 1');
    assert(advancing[0].group_rank === 1, 'First advancer should be group rank 1');
});

test('two_stage: transition to knockout', () => {
    const participants = generateParticipants(8);
    const result = bracketEngine.generate('two_stage', participants, {
        groupCount: 2,
        advancePerGroup: 2,
        knockoutFormat: 'single_elimination'
    });

    // Complete all group matches
    result.groupStage.groups.forEach(group => {
        const groupMatches = result.groupStage.matches.filter(m => m.group_id === group.groupId);
        groupMatches.forEach(m => {
            m.state = 'complete';
            m.winner_id = m.player1_id;
            m.player1_score = 2;
            m.player2_score = 0;
        });
    });

    const updated = bracketEngine.twoStage.transitionToKnockout(result, participants);

    assert(updated.currentStage === 'knockout', 'Should be in knockout stage');
    assert(updated.knockoutStage !== null, 'Should have knockout stage');
    assert(updated.knockoutStage.matches.length > 0, 'Should have knockout matches');

    // 4 advancers = 4-player bracket = 2 semis + 1 final = 3 matches
    assertEqual(updated.knockoutStage.matches.length, 3, 'Should have 3 knockout matches');
});

// ============================================
// FREE-FOR-ALL TOURNAMENT TESTS
// ============================================
console.log('\n=== FREE-FOR-ALL TOURNAMENT TESTS ===\n');

test('free_for_all: generates with default options', () => {
    const participants = generateParticipants(8);
    const result = bracketEngine.generate('free_for_all', participants, {
        playersPerMatch: 8,
        totalRounds: 3
    });

    assert(result.type === 'free_for_all', 'Type should be free_for_all');
    assertEqual(result.stats.totalRounds, 3, 'Should have 3 rounds');
    assertEqual(result.stats.participantCount, 8, 'Should have 8 participants');

    // 8 players, all in one match per round = 3 matches total
    assertEqual(result.matches.length, 3, 'Should have 3 matches (1 per round)');
});

test('free_for_all: splits into lobbies when needed', () => {
    const participants = generateParticipants(16);
    const result = bracketEngine.generate('free_for_all', participants, {
        playersPerMatch: 8,
        totalRounds: 2
    });

    // 16 players / 8 per match = 2 lobbies per round
    // 2 rounds = 4 matches total
    assertEqual(result.matches.length, 4, 'Should have 4 matches (2 lobbies x 2 rounds)');

    const round1Matches = result.matches.filter(m => m.round === 1);
    assertEqual(round1Matches.length, 2, 'Round 1 should have 2 lobbies');
});

test('free_for_all: record placements', () => {
    const participants = generateParticipants(4);
    const result = bracketEngine.generate('free_for_all', participants, {
        playersPerMatch: 4,
        totalRounds: 1
    });

    const match = result.matches[0];
    const placements = [
        { participant_id: 1, placement: 1 },
        { participant_id: 2, placement: 2 },
        { participant_id: 3, placement: 3 },
        { participant_id: 4, placement: 4 }
    ];

    const updated = bracketEngine.freeForAll.recordPlacements(
        match,
        placements,
        bracketEngine.freeForAll.DEFAULT_POINTS_SYSTEM
    );

    assert(updated.state === 'complete', 'Match should be complete');
    assertEqual(updated.placements.length, 4, 'Should have 4 placements');
    assertEqual(updated.placements[0].points_awarded, 25, '1st place should get 25 points');
    assertEqual(updated.placements[1].points_awarded, 18, '2nd place should get 18 points');
});

test('free_for_all: calculate standings', () => {
    const participants = generateParticipants(4);
    const result = bracketEngine.generate('free_for_all', participants, {
        playersPerMatch: 4,
        totalRounds: 2
    });

    // Simulate two rounds
    result.matches[0] = bracketEngine.freeForAll.recordPlacements(
        result.matches[0],
        [
            { participant_id: 1, placement: 1 },
            { participant_id: 2, placement: 2 },
            { participant_id: 3, placement: 3 },
            { participant_id: 4, placement: 4 }
        ]
    );

    result.matches[1] = bracketEngine.freeForAll.recordPlacements(
        result.matches[1],
        [
            { participant_id: 2, placement: 1 },  // Player 2 wins round 2
            { participant_id: 1, placement: 2 },
            { participant_id: 4, placement: 3 },
            { participant_id: 3, placement: 4 }
        ]
    );

    const standings = bracketEngine.freeForAll.calculateStandings(result.matches, participants);

    // Player 1: 25 + 18 = 43 points
    // Player 2: 18 + 25 = 43 points
    // Player 2 should be ranked higher (more wins)
    assertEqual(standings.length, 4, 'Should have 4 standings');

    const p1 = standings.find(s => s.participant_id === 1);
    const p2 = standings.find(s => s.participant_id === 2);

    assertEqual(p1.total_points, 43, 'Player 1 should have 43 points');
    assertEqual(p2.total_points, 43, 'Player 2 should have 43 points');
    assertEqual(p1.wins, 1, 'Player 1 should have 1 win');
    assertEqual(p2.wins, 1, 'Player 2 should have 1 win');
});

test('free_for_all: points systems', () => {
    const f1Points = bracketEngine.freeForAll.POINTS_SYSTEMS.f1;
    const linearPoints = bracketEngine.freeForAll.POINTS_SYSTEMS.linear;

    assertEqual(f1Points[1], 25, 'F1 1st place should be 25');
    assertEqual(linearPoints[1], 10, 'Linear 1st place should be 10');
    assertEqual(linearPoints[10], 1, 'Linear 10th place should be 1');
});

// ============================================
// LEADERBOARD TOURNAMENT TESTS
// ============================================
console.log('\n=== LEADERBOARD TOURNAMENT TESTS ===\n');

test('leaderboard: generates empty leaderboard', () => {
    const result = bracketEngine.generate('leaderboard', [], {
        rankingType: 'points',
        seasonName: 'Season 1'
    });

    assert(result.type === 'leaderboard', 'Type should be leaderboard');
    assertEqual(result.rankingType, 'points', 'Ranking type should be points');
    assertEqual(result.seasonName, 'Season 1', 'Season name should match');
    assertEqual(result.events.length, 0, 'Should have no events');
});

test('leaderboard: generates with initial participants', () => {
    const participants = generateParticipants(4);
    const result = bracketEngine.generate('leaderboard', participants, {
        rankingType: 'points'
    });

    assertEqual(Object.keys(result.standings).length, 4, 'Should have 4 standings');
});

test('leaderboard: add event and update standings', () => {
    const participants = generateParticipants(4);
    let lb = bracketEngine.generate('leaderboard', participants);

    lb = bracketEngine.leaderboard.addEvent(lb, {
        name: 'Week 1 Tournament',
        results: [
            { participant_id: 1, placement: 1 },
            { participant_id: 2, placement: 2 },
            { participant_id: 3, placement: 3 },
            { participant_id: 4, placement: 4 }
        ]
    });

    assertEqual(lb.events.length, 1, 'Should have 1 event');
    assertEqual(lb.standings[1].total_points, 25, 'Player 1 should have 25 points');
    assertEqual(lb.standings[1].wins, 1, 'Player 1 should have 1 win');
    assertEqual(lb.standings[1].events_played, 1, 'Player 1 should have 1 event');
});

test('leaderboard: multiple events accumulate points', () => {
    const participants = generateParticipants(4);
    let lb = bracketEngine.generate('leaderboard', participants);

    lb = bracketEngine.leaderboard.addEvent(lb, {
        name: 'Week 1',
        results: [
            { participant_id: 1, placement: 1 },
            { participant_id: 2, placement: 2 },
            { participant_id: 3, placement: 3 },
            { participant_id: 4, placement: 4 }
        ]
    });

    lb = bracketEngine.leaderboard.addEvent(lb, {
        name: 'Week 2',
        results: [
            { participant_id: 2, placement: 1 },  // Player 2 wins
            { participant_id: 1, placement: 2 },
            { participant_id: 3, placement: 3 },
            { participant_id: 4, placement: 4 }
        ]
    });

    assertEqual(lb.events.length, 2, 'Should have 2 events');
    assertEqual(lb.standings[1].total_points, 25 + 18, 'Player 1 should have 43 points');
    assertEqual(lb.standings[2].total_points, 18 + 25, 'Player 2 should have 43 points');
});

test('leaderboard: calculate standings with ranking', () => {
    const participants = generateParticipants(4);
    let lb = bracketEngine.generate('leaderboard', participants);

    lb = bracketEngine.leaderboard.addEvent(lb, {
        name: 'Week 1',
        results: [
            { participant_id: 3, placement: 1 },
            { participant_id: 1, placement: 2 },
            { participant_id: 2, placement: 3 },
            { participant_id: 4, placement: 4 }
        ]
    });

    const standings = bracketEngine.leaderboard.calculateStandings(lb);

    assertEqual(standings[0].participant_id, 3, 'Player 3 should be ranked 1st');
    assertEqual(standings[0].rank, 1, 'First place should have rank 1');
    assertEqual(standings[1].participant_id, 1, 'Player 1 should be ranked 2nd');
});

test('leaderboard: minimum events to rank', () => {
    const participants = generateParticipants(4);
    let lb = bracketEngine.generate('leaderboard', participants, {
        minEventsToRank: 2
    });

    lb = bracketEngine.leaderboard.addEvent(lb, {
        name: 'Week 1',
        results: [
            { participant_id: 1, placement: 1 },
            { participant_id: 2, placement: 2 }
        ]
    });

    const standings = bracketEngine.leaderboard.calculateStandings(lb);

    const p1 = standings.find(s => s.participant_id === 1);
    const p3 = standings.find(s => s.participant_id === 3);

    assert(!p1.is_ranked, 'Player 1 should not be ranked (only 1 event)');
    assertEqual(p1.events_needed, 1, 'Player 1 needs 1 more event');
    assert(!p3.is_ranked, 'Player 3 should not be ranked (0 events)');
});

test('leaderboard: ELO ranking', () => {
    const participants = generateParticipants(4);
    let lb = bracketEngine.generate('leaderboard', participants, {
        rankingType: 'elo'
    });

    // All start at 1200
    assertEqual(lb.standings[1].elo_rating, 1200, 'Initial ELO should be 1200');

    lb = bracketEngine.leaderboard.addEvent(lb, {
        name: 'Week 1',
        results: [
            { participant_id: 1, placement: 1 },
            { participant_id: 2, placement: 2 },
            { participant_id: 3, placement: 3 },
            { participant_id: 4, placement: 4 }
        ]
    });

    // Winner should have higher ELO, loser lower
    assert(lb.standings[1].elo_rating > 1200, 'Winner ELO should increase');
    assert(lb.standings[4].elo_rating < 1200, 'Last place ELO should decrease');
});

test('leaderboard: season reset', () => {
    const participants = generateParticipants(4);
    let lb = bracketEngine.generate('leaderboard', participants, {
        seasonName: 'Season 1'
    });

    lb = bracketEngine.leaderboard.addEvent(lb, {
        name: 'Week 1',
        results: [
            { participant_id: 1, placement: 1 },
            { participant_id: 2, placement: 2 }
        ]
    });

    const { archive, leaderboard: newLb } = bracketEngine.leaderboard.resetSeason(lb, 'Season 2');

    assertEqual(archive.seasonName, 'Season 1', 'Archive should have old season name');
    assertEqual(archive.events.length, 1, 'Archive should have 1 event');
    assertEqual(newLb.seasonName, 'Season 2', 'New leaderboard should have new season name');
    assertEqual(newLb.events.length, 0, 'New leaderboard should have no events');
    assertEqual(newLb.standings[1].total_points, 0, 'Points should be reset');
});

// ============================================
// INTEGRATION TESTS
// ============================================
console.log('\n=== INTEGRATION TESTS ===\n');

test('bracketEngine.TOURNAMENT_TYPES includes new types', () => {
    assert(bracketEngine.TOURNAMENT_TYPES.includes('two_stage'), 'Should include two_stage');
    assert(bracketEngine.TOURNAMENT_TYPES.includes('free_for_all'), 'Should include free_for_all');
    assert(bracketEngine.TOURNAMENT_TYPES.includes('leaderboard'), 'Should include leaderboard');
    assertEqual(bracketEngine.TOURNAMENT_TYPES.length, 7, 'Should have 7 tournament types');
});

test('bracketEngine.getDefaultOptions works for new types', () => {
    const twoStageOpts = bracketEngine.getDefaultOptions('two_stage');
    const ffaOpts = bracketEngine.getDefaultOptions('free_for_all');
    const lbOpts = bracketEngine.getDefaultOptions('leaderboard');

    assertEqual(twoStageOpts.groupCount, 4, 'Two-stage default groupCount should be 4');
    assertEqual(ffaOpts.playersPerMatch, 8, 'FFA default playersPerMatch should be 8');
    assertEqual(lbOpts.rankingType, 'points', 'Leaderboard default rankingType should be points');
});

test('bracketEngine modules are exported', () => {
    assert(bracketEngine.twoStage !== undefined, 'twoStage module should be exported');
    assert(bracketEngine.freeForAll !== undefined, 'freeForAll module should be exported');
    assert(bracketEngine.leaderboard !== undefined, 'leaderboard module should be exported');
});

// ============================================
// SUMMARY
// ============================================
console.log('\n=== TEST SUMMARY ===\n');
console.log(`  Passed: ${testsPassed}`);
console.log(`  Failed: ${testsFailed}`);
console.log(`  Total:  ${testsPassed + testsFailed}`);
console.log('');

if (testsFailed > 0) {
    console.log('❌ Some tests failed!\n');
    process.exit(1);
} else {
    console.log('✅ All tests passed!\n');
    process.exit(0);
}
