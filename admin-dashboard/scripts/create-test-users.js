#!/usr/bin/env node
/**
 * Create Test Users Script
 * Creates 2 test users with randomized tournaments for testing god mode
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

// Paths
const USERS_JSON_PATH = path.join(__dirname, '..', 'users.json');
const SYSTEM_DB_PATH = path.join(__dirname, '..', 'system.db');
const TOURNAMENTS_DB_PATH = path.join(__dirname, '..', 'tournaments.db');

// Test user configs
const TEST_USERS = [
    { username: 'test_user_alpha', password: 'test123' },
    { username: 'test_user_beta', password: 'test123' }
];

// Random helpers
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomSlug() {
    return Math.random().toString(36).substring(2, 8);
}

// Generate random subscription settings
function generateSubscriptionSettings() {
    const statuses = ['trial', 'active', 'expired'];
    const status = randomChoice(statuses);

    const now = new Date();
    let expiresAt = null;
    let trialEndsAt = null;

    if (status === 'trial') {
        // Trial ends in 1-14 days
        trialEndsAt = new Date(now.getTime() + randomInt(1, 14) * 24 * 60 * 60 * 1000).toISOString();
    } else if (status === 'active') {
        // Expires in 10-60 days
        expiresAt = new Date(now.getTime() + randomInt(10, 60) * 24 * 60 * 60 * 1000).toISOString();
    } else {
        // Expired 1-30 days ago
        expiresAt = new Date(now.getTime() - randomInt(1, 30) * 24 * 60 * 60 * 1000).toISOString();
    }

    return { status, expiresAt, trialEndsAt };
}

// Generate random tournament names
function generateTournamentName(index) {
    const prefixes = ['Weekly', 'Monthly', 'Local', 'Pro', 'Amateur', 'Championship', 'Open'];
    const suffixes = ['Showdown', 'Battle', 'Brawl', 'Tournament', 'Cup', 'Series'];
    return `${randomChoice(prefixes)} ${randomChoice(suffixes)} #${index}`;
}

// Generate random game names
function getRandomGame() {
    const games = [
        'Super Smash Bros. Ultimate',
        'Street Fighter 6',
        'Tekken 8',
        'Mario Kart 8 Deluxe',
        'Guilty Gear Strive'
    ];
    return randomChoice(games);
}

// Generate random participant names
function generateParticipantName() {
    const prefixes = ['Pro', 'King', 'Dark', 'Shadow', 'Ace', 'Master', 'Epic', 'Super'];
    const names = ['Player', 'Gamer', 'Champion', 'Fighter', 'Hero', 'Legend', 'Warrior'];
    const numbers = ['', randomInt(1, 999), 'X', 'XL', 'HD'];
    return `${randomChoice(prefixes)}${randomChoice(names)}${randomChoice(numbers)}`;
}

async function main() {
    console.log('=== Creating Test Users and Tournaments ===\n');

    // 1. Load users.json
    console.log('1. Loading users.json...');
    let usersData;
    try {
        usersData = JSON.parse(fs.readFileSync(USERS_JSON_PATH, 'utf8'));
    } catch (e) {
        usersData = { users: [] };
    }

    // 2. Hash passwords and add users
    console.log('2. Creating test users...');
    const createdUsers = [];

    for (const testUser of TEST_USERS) {
        // Check if user already exists
        const exists = usersData.users.find(u => u.username === testUser.username);
        if (exists) {
            console.log(`   - ${testUser.username} already exists (id: ${exists.id}), skipping creation`);
            createdUsers.push(exists);
            continue;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(testUser.password, 10);

        // Get next ID
        const maxId = Math.max(0, ...usersData.users.map(u => u.id));
        const newUser = {
            id: maxId + 1,
            username: testUser.username,
            password: hashedPassword,
            role: 'user',
            createdAt: new Date().toISOString()
        };

        usersData.users.push(newUser);
        createdUsers.push(newUser);
        console.log(`   - Created ${testUser.username} (id: ${newUser.id})`);
    }

    // Save users.json
    fs.writeFileSync(USERS_JSON_PATH, JSON.stringify(usersData, null, 2));
    console.log('   - Saved users.json\n');

    // 3. Add users to system.db if it exists
    console.log('3. Adding users to system.db...');
    if (fs.existsSync(SYSTEM_DB_PATH)) {
        const systemDb = new Database(SYSTEM_DB_PATH);

        // Check if users table exists
        const tableExists = systemDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();

        if (tableExists) {
            for (const user of createdUsers) {
                const subSettings = generateSubscriptionSettings();

                try {
                    // Try to insert, or update if exists
                    const existing = systemDb.prepare('SELECT id FROM users WHERE id = ?').get(user.id);

                    if (existing) {
                        // Update subscription settings
                        systemDb.prepare(`
                            UPDATE users SET
                                subscription_status = ?,
                                subscription_expires_at = ?,
                                trial_ends_at = ?,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `).run(subSettings.status, subSettings.expiresAt, subSettings.trialEndsAt, user.id);
                        console.log(`   - Updated ${user.username}: subscription=${subSettings.status}`);
                    } else {
                        // Insert new user
                        systemDb.prepare(`
                            INSERT INTO users (id, username, password_hash, role, subscription_status, subscription_expires_at, trial_ends_at, is_active, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
                        `).run(user.id, user.username, user.password, user.role, subSettings.status, subSettings.expiresAt, subSettings.trialEndsAt);
                        console.log(`   - Inserted ${user.username}: subscription=${subSettings.status}`);
                    }
                } catch (e) {
                    console.log(`   - Warning: Could not update system.db user ${user.username}: ${e.message}`);
                }
            }
        } else {
            console.log('   - users table does not exist in system.db, skipping');
        }

        systemDb.close();
    } else {
        console.log('   - system.db does not exist, skipping');
    }

    // 4. Create tournaments in tournaments.db
    console.log('\n4. Creating random tournaments...');
    const tournamentsDb = new Database(TOURNAMENTS_DB_PATH);

    const tournamentTypes = ['single_elimination', 'double_elimination', 'round_robin'];
    const states = ['pending', 'underway'];

    for (const user of createdUsers) {
        const numTournaments = randomInt(2, 5);
        console.log(`\n   Creating ${numTournaments} tournaments for ${user.username}:`);

        for (let i = 1; i <= numTournaments; i++) {
            const name = generateTournamentName(i);
            const urlSlug = `${user.username}_${randomSlug()}`;
            const tournamentType = randomChoice(tournamentTypes);
            const state = randomChoice(states);
            const gameName = getRandomGame();
            const participantCount = randomInt(4, 16);

            // Insert tournament
            const result = tournamentsDb.prepare(`
                INSERT INTO tcc_tournaments (
                    name, url_slug, description, game_id, tournament_type, state,
                    signup_cap, open_signup, check_in_duration, user_id,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 30, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(
                name,
                urlSlug,
                `Test tournament for ${user.username}`,
                null, // game_id
                tournamentType,
                state,
                participantCount + 10,
                user.id
            );

            const tournamentId = result.lastInsertRowid;
            console.log(`      - ${name} (${tournamentType}, ${state}, ${participantCount} participants)`);

            // Add participants
            for (let p = 1; p <= participantCount; p++) {
                const participantName = generateParticipantName();
                tournamentsDb.prepare(`
                    INSERT INTO tcc_participants (
                        tournament_id, name, seed, active, checked_in, created_at
                    ) VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
                `).run(
                    tournamentId,
                    participantName,
                    p,
                    randomChoice([0, 1]) // random check-in status
                );
            }

            // If tournament is underway, generate some matches
            if (state === 'underway') {
                // Get participants
                const participants = tournamentsDb.prepare(`
                    SELECT id, seed FROM tcc_participants WHERE tournament_id = ? ORDER BY seed
                `).all(tournamentId);

                // Create a few simple matches based on format
                if (tournamentType === 'single_elimination' || tournamentType === 'double_elimination') {
                    // Create round 1 matches
                    const numMatches = Math.floor(participants.length / 2);
                    for (let m = 0; m < numMatches; m++) {
                        const p1 = participants[m * 2];
                        const p2 = participants[m * 2 + 1];
                        const matchState = randomChoice(['pending', 'open', 'complete']);

                        let winnerId = null;
                        let loserId = null;
                        let p1Score = null;
                        let p2Score = null;

                        if (matchState === 'complete') {
                            const winner = randomChoice([p1, p2]);
                            winnerId = winner.id;
                            loserId = winner.id === p1.id ? p2.id : p1.id;
                            p1Score = winner.id === p1.id ? 2 : randomInt(0, 1);
                            p2Score = winner.id === p2.id ? 2 : randomInt(0, 1);
                        }

                        tournamentsDb.prepare(`
                            INSERT INTO tcc_matches (
                                tournament_id, round, player1_id, player2_id,
                                state, winner_id, loser_id, player1_score, player2_score,
                                suggested_play_order, created_at
                            ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                        `).run(
                            tournamentId,
                            p1.id,
                            p2.id,
                            matchState,
                            winnerId,
                            loserId,
                            p1Score,
                            p2Score,
                            m + 1
                        );
                    }
                } else if (tournamentType === 'round_robin') {
                    // Create some round robin matches
                    let playOrder = 1;
                    for (let j = 0; j < participants.length && j < 4; j++) {
                        for (let k = j + 1; k < participants.length && k < 4; k++) {
                            const matchState = randomChoice(['pending', 'open', 'complete']);

                            let winnerId = null;
                            let p1Score = null;
                            let p2Score = null;

                            if (matchState === 'complete') {
                                winnerId = randomChoice([participants[j].id, participants[k].id]);
                                p1Score = winnerId === participants[j].id ? 2 : randomInt(0, 1);
                                p2Score = winnerId === participants[k].id ? 2 : randomInt(0, 1);
                            }

                            tournamentsDb.prepare(`
                                INSERT INTO tcc_matches (
                                    tournament_id, round, player1_id, player2_id,
                                    state, winner_id, player1_score, player2_score,
                                    suggested_play_order, created_at
                                ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                            `).run(
                                tournamentId,
                                participants[j].id,
                                participants[k].id,
                                matchState,
                                winnerId,
                                p1Score,
                                p2Score,
                                playOrder++
                            );
                        }
                    }
                }
            }
        }
    }

    tournamentsDb.close();

    console.log('\n=== Done! ===');
    console.log('\nTest Users Created:');
    for (const user of createdUsers) {
        console.log(`  - ${user.username} (id: ${user.id}) - password: test123`);
    }
    console.log('\nYou can now:');
    console.log('  1. Login as ricardo (superadmin) at https://admin.despairhardware.com');
    console.log('  2. Go to Settings > Users to see the test users');
    console.log('  3. Use god mode to impersonate test users');
    console.log('  4. View all tournaments with ?all=true or impersonate to see their data');
}

main().catch(console.error);
