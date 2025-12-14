/**
 * Stations Routes - TCC-Custom
 *
 * Station management API endpoints using local database.
 * Replaces Challonge stations API.
 */

const express = require('express');
const router = express.Router();
const { requireAuthAPI, requireTokenOrSessionAuth } = require('../middleware/auth');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:stations');

// Local services
const stationDb = require('../services/station-db');
const tournamentDb = require('../services/tournament-db');

// Dependencies injected via init()
let io = null;

/**
 * Initialize the stations routes with dependencies
 */
function init(deps) {
    io = deps?.io;
}

// Helper to get tournament by ID or slug
function getTournament(tournamentId) {
    return isNaN(tournamentId)
        ? tournamentDb.getBySlug(tournamentId)
        : tournamentDb.getById(parseInt(tournamentId));
}

// Helper to broadcast station updates
function broadcastStationUpdate(tournamentId, data) {
    if (io) {
        io.emit('stations:update', { tournamentId, ...data });
    }
}

// ============================================
// STATION MANAGEMENT API ENDPOINTS
// ============================================

/**
 * GET /api/stations/:tournamentId
 * Get stations for a tournament
 */
router.get('/:tournamentId', requireTokenOrSessionAuth, async (req, res) => {
    try {
        const tournament = getTournament(req.params.tournamentId);

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const stations = stationDb.getByTournament(tournament.id);

        res.json({
            success: true,
            stations: stations.map(s => ({
                id: s.id,
                name: s.name,
                currentMatchId: s.current_match_id,
                currentMatchIdentifier: s.current_match_identifier
            })),
            source: 'local'
        });
    } catch (error) {
        logger.error('list', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: 'Failed to get stations',
            details: error.message
        });
    }
});

/**
 * POST /api/stations/:tournamentId
 * Create a station for a tournament
 */
router.post('/:tournamentId', requireTokenOrSessionAuth, async (req, res) => {
    try {
        const tournament = getTournament(req.params.tournamentId);

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const { name } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Station name is required'
            });
        }

        const station = stationDb.create(tournament.id, name);

        logger.log('create:success', { name, tournamentId: tournament.id, stationId: station.id });

        // Broadcast update
        broadcastStationUpdate(tournament.id, {
            action: 'created',
            station: {
                id: station.id,
                name: station.name
            }
        });

        res.json({
            success: true,
            message: `Station "${name}" created`,
            station: {
                id: station.id,
                name: station.name
            }
        });
    } catch (error) {
        logger.error('create', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: error.message.includes('already exists')
                ? error.message
                : 'Failed to create station',
            details: error.message
        });
    }
});

/**
 * DELETE /api/stations/:tournamentId/:stationId
 * Delete a station
 */
router.delete('/:tournamentId/:stationId', requireAuthAPI, async (req, res) => {
    try {
        const { stationId } = req.params;

        const station = stationDb.getById(parseInt(stationId));
        if (!station) {
            return res.status(404).json({
                success: false,
                error: 'Station not found'
            });
        }

        const deleted = stationDb.delete(parseInt(stationId));

        if (!deleted) {
            return res.status(404).json({
                success: false,
                error: 'Station not found'
            });
        }

        logger.log('delete:success', { stationId: parseInt(stationId), name: station.name, tournamentId: station.tournament_id });

        // Broadcast update
        broadcastStationUpdate(station.tournament_id, {
            action: 'deleted',
            stationId: parseInt(stationId)
        });

        res.json({
            success: true,
            message: 'Station deleted'
        });
    } catch (error) {
        logger.error('delete', error, { stationId: req.params.stationId });
        res.status(500).json({
            success: false,
            error: 'Failed to delete station',
            details: error.message
        });
    }
});

/**
 * GET /api/stations/settings/:tournamentId
 * Get station settings for a tournament
 * Note: For local DB, auto_assign is stored in tournament format_settings_json
 */
router.get('/settings/:tournamentId', requireAuthAPI, async (req, res) => {
    try {
        const tournament = getTournament(req.params.tournamentId);

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const formatSettings = tournament.format_settings || {};

        res.json({
            success: true,
            stationSettings: {
                autoAssign: formatSettings.autoAssign || false,
                onlyStartWithStations: formatSettings.onlyStartWithStations || false
            }
        });
    } catch (error) {
        logger.error('getSettings', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: 'Failed to get station settings',
            details: error.message
        });
    }
});

/**
 * PUT /api/stations/settings/:tournamentId
 * Update station settings for a tournament
 */
router.put('/settings/:tournamentId', requireAuthAPI, async (req, res) => {
    try {
        const tournament = getTournament(req.params.tournamentId);

        if (!tournament) {
            return res.status(404).json({
                success: false,
                error: 'Tournament not found'
            });
        }

        const { autoAssign, onlyStartWithStations } = req.body;
        const currentSettings = tournament.format_settings || {};

        // Update format settings
        const newSettings = {
            ...currentSettings,
            autoAssign: typeof autoAssign === 'boolean' ? autoAssign : currentSettings.autoAssign,
            onlyStartWithStations: typeof onlyStartWithStations === 'boolean'
                ? onlyStartWithStations
                : currentSettings.onlyStartWithStations
        };

        tournamentDb.update(tournament.id, {
            format_settings_json: newSettings
        });

        logger.log('updateSettings:success', {
            tournamentId: tournament.id,
            autoAssign: newSettings.autoAssign,
            onlyStartWithStations: newSettings.onlyStartWithStations
        });

        res.json({
            success: true,
            message: 'Station settings updated',
            stationSettings: {
                autoAssign: newSettings.autoAssign || false,
                onlyStartWithStations: newSettings.onlyStartWithStations || false
            }
        });
    } catch (error) {
        logger.error('updateSettings', error, { tournamentId: req.params.tournamentId });
        res.status(500).json({
            success: false,
            error: 'Failed to update station settings',
            details: error.message
        });
    }
});

module.exports = router;
module.exports.init = init;
