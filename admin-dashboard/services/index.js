/**
 * Services Index
 *
 * Central export for all service modules.
 * Simplifies server.js imports and initialization.
 */

const settingsService = require('./settings');
const rateLimiterService = require('./rate-limiter');
const activityLoggerService = require('./activity-logger');
const challongeApiService = require('./challonge-api');
const dqTimerService = require('./dq-timer');
const matchPollingService = require('./match-polling');
const sponsorService = require('./sponsor');
const aiSeedingService = require('./ai-seeding');
const tournamentNarratorService = require('./tournament-narrator');
const errorHandlerService = require('./error-handler');

// Existing services (not extracted from server.js)
const containerService = require('./container');
const websocketAckService = require('./websocket-ack');

module.exports = {
	// Extracted services
	settings: settingsService,
	rateLimiter: rateLimiterService,
	activityLogger: activityLoggerService,
	challongeApi: challongeApiService,
	dqTimer: dqTimerService,
	matchPolling: matchPollingService,
	sponsor: sponsorService,
	aiSeeding: aiSeedingService,
	tournamentNarrator: tournamentNarratorService,
	errorHandler: errorHandlerService,

	// Existing services
	container: containerService,
	websocketAck: websocketAckService
};
