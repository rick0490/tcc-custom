/**
 * Database Module Index
 * Central export for all database connections
 *
 * Database Architecture:
 * ----------------------
 * tournaments.db - Live tournament operations (high write, resettable)
 * players.db     - Historical analytics & Elo (append-mostly, critical backup)
 * system.db      - Config, auth, games (stable, rarely changes)
 * cache.db       - Ephemeral caching (fully deletable)
 *
 * Cross-DB References:
 * --------------------
 * SQLite doesn't support cross-database foreign keys.
 * Use app-level linking with game_id, player_id references.
 * Always verify existence before linking.
 */

const tournamentsDb = require('./tournaments-db');
const playersDb = require('./players-db');
const systemDb = require('./system-db');
const cacheDb = require('./cache-db');

/**
 * Initialize all databases
 * Call this once at application startup
 */
function initAll() {
    console.log('[DB] Initializing all databases...');

    tournamentsDb.initDatabase();
    playersDb.initDatabase();
    systemDb.initDatabase();
    cacheDb.initDatabase();

    console.log('[DB] All databases initialized');
}

/**
 * Close all database connections
 * Call this on graceful shutdown
 */
function closeAll() {
    console.log('[DB] Closing all database connections...');

    tournamentsDb.closeDatabase();
    playersDb.closeDatabase();
    systemDb.closeDatabase();
    cacheDb.closeDatabase();

    console.log('[DB] All databases closed');
}

/**
 * Get database file paths
 * Useful for backup scripts
 */
function getDbPaths() {
    return {
        tournaments: tournamentsDb.DB_PATH,
        players: playersDb.DB_PATH,
        system: systemDb.DB_PATH,
        cache: cacheDb.DB_PATH
    };
}

/**
 * Get database status
 * Returns connection status for all databases
 */
function getStatus() {
    const status = {};

    try {
        tournamentsDb.getDb();
        status.tournaments = { connected: true, path: tournamentsDb.DB_PATH };
    } catch (e) {
        status.tournaments = { connected: false, error: e.message };
    }

    try {
        playersDb.getDb();
        status.players = { connected: true, path: playersDb.DB_PATH };
    } catch (e) {
        status.players = { connected: false, error: e.message };
    }

    try {
        systemDb.getDb();
        status.system = { connected: true, path: systemDb.DB_PATH };
    } catch (e) {
        status.system = { connected: false, error: e.message };
    }

    try {
        cacheDb.getDb();
        status.cache = { connected: true, path: cacheDb.DB_PATH };
    } catch (e) {
        status.cache = { connected: false, error: e.message };
    }

    return status;
}

// =============================================================================
// CROSS-DATABASE HELPERS
// =============================================================================

/**
 * Get tournament with game info
 * Links tournament from tournaments.db to game in system.db
 * @param {number} tournamentId - Tournament ID
 * @returns {Object} Tournament with gameName attached
 */
function getTournamentWithGame(tournamentId) {
    const tournament = tournamentsDb.getDb()
        .prepare('SELECT * FROM tcc_tournaments WHERE id = ?')
        .get(tournamentId);

    if (tournament && tournament.game_id) {
        const game = systemDb.getGameById(tournament.game_id);
        tournament.gameName = game?.name || null;
        tournament.gameShortCode = game?.short_code || null;
    }

    return tournament;
}

/**
 * Link participant to canonical player
 * Updates tournaments.db participant with player_id from players.db
 * @param {number} participantId - Participant ID in tournaments.db
 * @param {number} playerId - Player ID in players.db
 */
function linkParticipantToPlayer(participantId, playerId) {
    // Verify player exists
    const player = playersDb.getPlayerById(playerId);
    if (!player) {
        throw new Error(`Player ${playerId} not found in players database`);
    }

    // Update participant
    tournamentsDb.getDb()
        .prepare('UPDATE tcc_participants SET player_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(playerId, participantId);
}

/**
 * Get player Elo for a game
 * Combines player from players.db with game from system.db
 * @param {number} playerId - Player ID
 * @param {number} gameId - Game ID
 * @returns {Object} Player rating info
 */
function getPlayerRatingForGame(playerId, gameId) {
    const player = playersDb.getPlayerById(playerId);
    if (!player) return null;

    const game = systemDb.getGameById(gameId);
    if (!game) return null;

    const rating = playersDb.getOrCreateRating(playerId, gameId);

    return {
        player,
        game,
        rating
    };
}

/**
 * Archive a completed tournament
 * Copies data from tournaments.db to players.db for permanent storage
 * @param {number} tournamentId - Tournament ID in tournaments.db
 * @returns {number} New tournament ID in players.db
 */
async function archiveCompletedTournament(tournamentId) {
    const tDb = tournamentsDb.getDb();

    // Get tournament
    const tournament = tDb.prepare('SELECT * FROM tcc_tournaments WHERE id = ?').get(tournamentId);
    if (!tournament) {
        throw new Error(`Tournament ${tournamentId} not found`);
    }

    if (tournament.state !== 'complete') {
        throw new Error(`Tournament ${tournamentId} is not complete (state: ${tournament.state})`);
    }

    // Check if already archived
    if (playersDb.isTournamentArchived(tournament.url_slug)) {
        throw new Error(`Tournament ${tournament.url_slug} is already archived`);
    }

    // Get participants
    const participants = tDb.prepare(`
        SELECT * FROM tcc_participants WHERE tournament_id = ? AND active = 1
    `).all(tournamentId);

    // Get completed matches
    const matches = tDb.prepare(`
        SELECT * FROM tcc_matches WHERE tournament_id = ? AND state = 'complete'
    `).all(tournamentId);

    // Archive tournament
    const archivedTournamentId = playersDb.archiveTournament({
        sourceId: tournament.id,
        sourceUrl: tournament.url_slug,
        name: tournament.name,
        gameId: tournament.game_id,
        tournamentType: tournament.tournament_type,
        participantCount: participants.length,
        startedAt: tournament.started_at,
        completedAt: tournament.completed_at
    });

    // Map participant IDs (original -> player)
    const participantMap = new Map();

    for (const p of participants) {
        // Get or create player
        const player = playersDb.getOrCreatePlayer(p.name, {
            email: p.email,
            instagram: p.instagram
        });

        participantMap.set(p.id, player.id);

        // Add to tournament_participants
        playersDb.addTournamentParticipant({
            tournamentId: archivedTournamentId,
            playerId: player.id,
            originalParticipantId: p.id,
            seed: p.seed,
            finalRank: p.final_rank,
            checkedIn: p.checked_in
        });
    }

    // Archive matches and update Elo
    for (const m of matches) {
        const player1Id = participantMap.get(m.player1_id);
        const player2Id = participantMap.get(m.player2_id);
        const winnerId = participantMap.get(m.winner_id);
        const loserId = participantMap.get(m.loser_id);

        playersDb.addMatch({
            tournamentId: archivedTournamentId,
            originalMatchId: m.id,
            round: m.round,
            matchIdentifier: m.identifier,
            player1Id,
            player2Id,
            winnerId,
            loserId,
            player1Score: m.player1_score,
            player2Score: m.player2_score,
            scoresCsv: m.scores_csv,
            completedAt: m.completed_at
        });

        // Update Elo if we have winner and loser
        if (winnerId && loserId && tournament.game_id) {
            playersDb.updateEloForMatch(winnerId, loserId, tournament.game_id, archivedTournamentId);
        }
    }

    console.log(`[DB] Archived tournament ${tournament.name} with ${participants.length} participants and ${matches.length} matches`);

    return archivedTournamentId;
}

module.exports = {
    // Individual database modules
    tournaments: tournamentsDb,
    players: playersDb,
    system: systemDb,
    cache: cacheDb,

    // Lifecycle
    initAll,
    closeAll,
    getDbPaths,
    getStatus,

    // Cross-database helpers
    getTournamentWithGame,
    linkParticipantToPlayer,
    getPlayerRatingForGame,
    archiveCompletedTournament
};
