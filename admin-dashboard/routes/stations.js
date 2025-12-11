/**
 * Stations Routes
 *
 * Station management API endpoints.
 * Extracted from server.js for modularity.
 */

const express = require('express');
const router = express.Router();
const { requireAuthAPI, requireTokenOrSessionAuth } = require('../middleware/auth');

// References set by init
let rateLimiter = null;
let cacheDb = null;
let getStationsApiHeaders = null;

/**
 * Initialize the stations routes with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.rateLimiter - Rate limiter service
 * @param {Object} options.cacheDb - Cache database
 * @param {Function} options.getStationsApiHeaders - Function to get stations API headers
 */
function init({ rateLimiter: rl, cacheDb: cache, getStationsApiHeaders: getHeaders }) {
	rateLimiter = rl;
	cacheDb = cache;
	getStationsApiHeaders = getHeaders;
}

// ============================================
// STATION MANAGEMENT API ENDPOINTS
// ============================================

/**
 * GET /api/stations/:tournamentId
 * Get stations for a tournament - with caching
 * Note: Stations API requires legacy key - Challonge doesn't support OAuth scopes for stations
 */
router.get('/:tournamentId', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId } = req.params;

	// Helper function to fetch stations from Challonge API
	const fetchStationsFromAPI = async () => {
		const headers = getStationsApiHeaders();
		const response = await rateLimiter.rateLimitedAxios.get(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations.json`,
			{
				headers,
				timeout: 10000
			}
		);

		const stations = (response.data.data || []).map(s => ({
			id: s.id,
			name: s.attributes?.name || `Station ${s.id}`,
			streamUrl: s.attributes?.stream_url || null
		}));

		return stations;
	};

	try {
		// Use cache with stale-while-revalidate pattern
		const { data: stations, _cache } = await cacheDb.getCachedOrFetch(
			'stations',
			tournamentId,
			fetchStationsFromAPI
		);

		res.json({
			success: true,
			stations,
			_cache
		});
	} catch (error) {
		console.error('Get stations error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to get stations',
			details: error.response ? error.response.data : error.message
		});
	}
});

/**
 * POST /api/stations/:tournamentId
 * Create a station for a tournament
 * Note: Stations API requires legacy key - Challonge doesn't support OAuth scopes for stations
 */
router.post('/:tournamentId', requireTokenOrSessionAuth, async (req, res) => {
	const { tournamentId } = req.params;
	const { name } = req.body;

	if (!name) {
		return res.status(400).json({
			success: false,
			error: 'Station name is required'
		});
	}

	try {
		const headers = getStationsApiHeaders();
		const response = await rateLimiter.rateLimitedAxios.post(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations.json`,
			{
				data: {
					type: 'station',
					attributes: { name }
				}
			},
			{
				headers,
				timeout: 10000
			}
		);

		const station = response.data.data;

		// Invalidate stations cache
		cacheDb.invalidateCache('stations', tournamentId);

		res.json({
			success: true,
			message: `Station "${name}" created`,
			station: {
				id: station.id,
				name: station.attributes?.name || name
			}
		});
	} catch (error) {
		console.error('Create station error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to create station',
			details: error.response ? error.response.data : error.message
		});
	}
});

/**
 * DELETE /api/stations/:tournamentId/:stationId
 * Delete a station
 * Note: Stations API requires legacy key - Challonge doesn't support OAuth scopes for stations
 */
router.delete('/:tournamentId/:stationId', requireAuthAPI, async (req, res) => {
	const { tournamentId, stationId } = req.params;

	try {
		const headers = getStationsApiHeaders();
		await rateLimiter.rateLimitedAxios.delete(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}/stations/${stationId}.json`,
			{
				headers,
				timeout: 10000
			}
		);

		// Invalidate stations cache
		cacheDb.invalidateCache('stations', tournamentId);

		res.json({
			success: true,
			message: 'Station deleted'
		});
	} catch (error) {
		console.error('Delete station error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to delete station',
			details: error.response ? error.response.data : error.message
		});
	}
});

/**
 * GET /api/tournament/:tournamentId/station-settings
 * Get station settings for a tournament
 * Note: Station settings use legacy key for consistency with stations API
 */
router.get('/settings/:tournamentId', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;

	try {
		const headers = getStationsApiHeaders();
		const response = await rateLimiter.rateLimitedAxios.get(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}.json`,
			{
				headers,
				timeout: 10000
			}
		);

		const stationOptions = response.data.data?.attributes?.station_options || {};
		res.json({
			success: true,
			stationSettings: {
				autoAssign: stationOptions.auto_assign || false,
				onlyStartWithStations: stationOptions.only_start_matches_with_assigned_stations || false
			}
		});
	} catch (error) {
		console.error('Get station settings error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to get station settings',
			details: error.response ? error.response.data : error.message
		});
	}
});

/**
 * PUT /api/tournament/:tournamentId/station-settings
 * Update station settings for a tournament
 * Note: Station settings use legacy key for consistency with stations API
 */
router.put('/settings/:tournamentId', requireAuthAPI, async (req, res) => {
	const { tournamentId } = req.params;
	const { autoAssign, onlyStartWithStations } = req.body;

	try {
		// Build station_options object
		const stationOptions = {};
		if (typeof autoAssign === 'boolean') {
			stationOptions.auto_assign = autoAssign;
		}
		if (typeof onlyStartWithStations === 'boolean') {
			stationOptions.only_start_matches_with_assigned_stations = onlyStartWithStations;
		}

		const headers = getStationsApiHeaders();
		const response = await rateLimiter.rateLimitedAxios.put(
			`https://api.challonge.com/v2.1/tournaments/${tournamentId}.json`,
			{
				data: {
					type: 'tournament',
					attributes: {
						station_options: stationOptions
					}
				}
			},
			{
				headers,
				timeout: 10000
			}
		);

		const updatedOptions = response.data.data?.attributes?.station_options || {};
		res.json({
			success: true,
			message: 'Station settings updated',
			stationSettings: {
				autoAssign: updatedOptions.auto_assign || false,
				onlyStartWithStations: updatedOptions.only_start_matches_with_assigned_stations || false
			}
		});
	} catch (error) {
		console.error('Update station settings error:', error.message);
		// Check if it's a "can't change after started" error
		const errorDetails = error.response?.data?.errors;
		if (errorDetails && Array.isArray(errorDetails)) {
			const relevantErrors = errorDetails.filter(e =>
				e.source?.pointer?.includes('station_options')
			);
			if (relevantErrors.length === 0 && errorDetails.length > 0) {
				// The errors are about other fields, not station_options
				// Try to get current settings and return success
				try {
					const getResponse = await rateLimiter.rateLimitedAxios.get(
						`https://api.challonge.com/v2.1/tournaments/${tournamentId}.json`,
						{
							headers: getStationsApiHeaders(),
							timeout: 10000
						}
					);
					const currentOptions = getResponse.data.data?.attributes?.station_options || {};
					return res.json({
						success: true,
						message: 'Station settings may have been updated (some tournament fields cannot be changed after start)',
						stationSettings: {
							autoAssign: currentOptions.auto_assign || false,
							onlyStartWithStations: currentOptions.only_start_matches_with_assigned_stations || false
						}
					});
				} catch (getError) {
					// Fall through to error response
				}
			}
		}
		res.status(500).json({
			success: false,
			error: 'Failed to update station settings',
			details: error.response ? error.response.data : error.message
		});
	}
});

module.exports = router;
module.exports.init = init;
