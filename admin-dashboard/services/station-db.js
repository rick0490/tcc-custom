/**
 * Station Database Service
 * Local station management - replaces Challonge stations API
 */

const tournamentsDb = require('../db/tournaments-db');
const { createLogger } = require('./debug-logger');

const logger = createLogger('station-db');

/**
 * Get all stations for a tournament
 */
function getByTournament(tournamentId) {
    logger.log('getByTournament', { tournamentId });
    const db = tournamentsDb.getDb();
    const stations = db.prepare(`
        SELECT s.*, m.identifier as current_match_identifier
        FROM tcc_stations s
        LEFT JOIN tcc_matches m ON s.current_match_id = m.id
        WHERE s.tournament_id = ? AND s.active = 1
        ORDER BY s.name
    `).all(tournamentId);
    logger.log('getByTournament:result', { tournamentId, count: stations.length });
    return stations;
}

/**
 * Get station by ID
 */
function getById(id) {
    const db = tournamentsDb.getDb();
    return db.prepare(`
        SELECT s.*, m.identifier as current_match_identifier
        FROM tcc_stations s
        LEFT JOIN tcc_matches m ON s.current_match_id = m.id
        WHERE s.id = ?
    `).get(id);
}

/**
 * Create a new station
 */
function create(tournamentId, name) {
    const logComplete = logger.start('create', { tournamentId, name });
    const db = tournamentsDb.getDb();

    // Check if station with this name already exists
    const existing = db.prepare(`
        SELECT id FROM tcc_stations
        WHERE tournament_id = ? AND name = ?
    `).get(tournamentId, name);

    if (existing) {
        logger.warn('create', `Station "${name}" already exists`, { tournamentId });
        throw new Error(`Station "${name}" already exists for this tournament`);
    }

    const stmt = db.prepare(`
        INSERT INTO tcc_stations (tournament_id, name)
        VALUES (?, ?)
    `);

    const result = stmt.run(tournamentId, name);
    const station = getById(result.lastInsertRowid);
    logComplete({ stationId: station.id });
    return station;
}

/**
 * Delete a station
 */
function deleteStation(id) {
    const db = tournamentsDb.getDb();

    // Clear any match assignments first
    db.prepare('UPDATE tcc_matches SET station_id = NULL WHERE station_id = ?').run(id);

    // Delete the station
    const result = db.prepare('DELETE FROM tcc_stations WHERE id = ?').run(id);
    return result.changes > 0;
}

/**
 * Assign a match to a station
 */
function assignMatch(stationId, matchId) {
    logger.log('assignMatch', { stationId, matchId });
    const db = tournamentsDb.getDb();

    // Clear this match from any other station
    db.prepare('UPDATE tcc_stations SET current_match_id = NULL WHERE current_match_id = ?').run(matchId);

    // Assign to this station
    db.prepare('UPDATE tcc_stations SET current_match_id = ? WHERE id = ?').run(matchId, stationId);

    // Update the match's station_id
    db.prepare('UPDATE tcc_matches SET station_id = ? WHERE id = ?').run(stationId, matchId);

    const station = getById(stationId);
    logger.log('assignMatch:result', { stationId, matchId, stationName: station?.name });
    return station;
}

/**
 * Clear current match from a station
 */
function clearMatch(stationId) {
    const db = tournamentsDb.getDb();

    // Get current match ID before clearing
    const station = getById(stationId);
    if (station && station.current_match_id) {
        // Clear match's station reference
        db.prepare('UPDATE tcc_matches SET station_id = NULL WHERE id = ?').run(station.current_match_id);
    }

    // Clear station's current match
    db.prepare('UPDATE tcc_stations SET current_match_id = NULL WHERE id = ?').run(stationId);

    return getById(stationId);
}

/**
 * Get available stations (not currently assigned to a match)
 */
function getAvailable(tournamentId) {
    const db = tournamentsDb.getDb();
    return db.prepare(`
        SELECT * FROM tcc_stations
        WHERE tournament_id = ? AND active = 1 AND current_match_id IS NULL
        ORDER BY name
    `).all(tournamentId);
}

/**
 * Get station count for a tournament
 */
function getCount(tournamentId) {
    const db = tournamentsDb.getDb();
    const result = db.prepare(`
        SELECT COUNT(*) as count FROM tcc_stations
        WHERE tournament_id = ? AND active = 1
    `).get(tournamentId);
    return result.count;
}

/**
 * Clear all stations for a tournament
 */
function clearAll(tournamentId) {
    const db = tournamentsDb.getDb();

    // Clear match assignments
    db.prepare(`
        UPDATE tcc_matches SET station_id = NULL
        WHERE tournament_id = ?
    `).run(tournamentId);

    // Delete all stations
    const result = db.prepare('DELETE FROM tcc_stations WHERE tournament_id = ?').run(tournamentId);
    return result.changes;
}

module.exports = {
    getByTournament,
    getById,
    create,
    delete: deleteStation,
    assignMatch,
    clearMatch,
    getAvailable,
    getCount,
    clearAll
};
