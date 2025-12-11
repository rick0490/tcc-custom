/**
 * Routes Index
 *
 * Central export for all route modules.
 * Simplifies server.js route mounting.
 */

const authRoutes = require('./auth');
const usersRoutes = require('./users');
const settingsRoutes = require('./settings');
const gamesRoutes = require('./games');
const monitoringRoutes = require('./monitoring');
const templatesRoutes = require('./templates');
const stationsRoutes = require('./stations');
const participantsRoutes = require('./participants');
const matchesRoutes = require('./matches');
const tournamentsRoutes = require('./tournaments');
const displaysRoutes = require('./displays');
const flyersRoutes = require('./flyers');
const sponsorsRoutes = require('./sponsors');
const analyticsRoutes = require('./analytics');
const exportsRoutes = require('./exports');
const apiRoutes = require('./api');

module.exports = {
	auth: authRoutes,
	users: usersRoutes,
	settings: settingsRoutes,
	games: gamesRoutes,
	monitoring: monitoringRoutes,
	templates: templatesRoutes,
	stations: stationsRoutes,
	participants: participantsRoutes,
	matches: matchesRoutes,
	tournaments: tournamentsRoutes,
	displays: displaysRoutes,
	flyers: flyersRoutes,
	sponsors: sponsorsRoutes,
	analytics: analyticsRoutes,
	exports: exportsRoutes,
	api: apiRoutes
};
