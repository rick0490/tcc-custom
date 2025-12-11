/**
 * Helpers Index
 *
 * Central export for all helper modules.
 * Simplifies server.js imports.
 */

const pdfHelpers = require('./pdf');
const tournamentUrlHelpers = require('./tournament-url');
const websocketHelpers = require('./websocket');

module.exports = {
	// PDF generation helpers
	pdf: pdfHelpers,

	// Tournament URL generation
	tournamentUrl: tournamentUrlHelpers,

	// WebSocket delta detection
	websocket: websocketHelpers
};
