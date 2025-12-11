/**
 * Tournament URL Helper Functions
 *
 * Helper functions for generating tournament URLs on Challonge.
 * Extracted from server.js for modularity.
 */

/**
 * Game name to abbreviation mapping for tournament URLs
 */
const GAME_ABBREVIATIONS = {
	'super smash bros. ultimate': 'ssbu',
	'super smash bros ultimate': 'ssbu',
	'ssbu': 'ssbu',
	'mario kart world': 'mkw',
	'mario kart 8': 'mk8',
	'mario kart 8 deluxe': 'mk8dx',
	'street fighter 6': 'sf6',
	'tekken 8': 't8',
	'melee': 'melee',
	'super smash bros. melee': 'melee',
	'guilty gear strive': 'ggst',
	'mortal kombat 1': 'mk1',
	'granblue fantasy versus rising': 'gbvsr',
	'dragon ball fighterz': 'dbfz',
	'under night in-birth': 'uni',
	'the king of fighters xv': 'kof15',
	'soulcalibur vi': 'scvi',
	'rivals of aether': 'roa',
	'multiversus': 'mvs',
	'brawlhalla': 'brawl'
};

/**
 * Abbreviate game name to short code for URL
 * @param {string} game - Full game name
 * @returns {string} Abbreviated game code
 */
function abbreviateGame(game) {
	if (!game) return 'tournament';

	const normalized = game.toLowerCase().trim();

	// Check predefined mappings
	if (GAME_ABBREVIATIONS[normalized]) {
		return GAME_ABBREVIATIONS[normalized];
	}

	// Generate abbreviation from first letters of each word (max 4 chars)
	const words = normalized.split(/\s+/).filter(w => w.length > 0);
	if (words.length === 1) {
		// Single word: use first 4 chars
		return words[0].substring(0, 4).replace(/[^a-z0-9]/g, '');
	}

	// Multiple words: use first letter of each word
	return words
		.slice(0, 4)
		.map(w => w[0])
		.join('')
		.replace(/[^a-z0-9]/g, '');
}

/**
 * Extract venue name from tournament name
 * Looks for text after @ symbol
 * @param {string} tournamentName - Full tournament name
 * @returns {string} Extracted venue name or 'tournament'
 */
function extractVenue(tournamentName) {
	if (!tournamentName) return 'tournament';

	// Look for @ symbol and extract venue after it
	const atIndex = tournamentName.indexOf('@');
	if (atIndex !== -1 && atIndex < tournamentName.length - 1) {
		const venue = tournamentName.substring(atIndex + 1).trim();
		// Clean and limit to 12 alphanumeric chars
		return venue
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '')
			.substring(0, 12) || 'tournament';
	}

	// No @ symbol: use first word or first 12 chars
	const firstWord = tournamentName.split(/\s+/)[0];
	return firstWord
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')
		.substring(0, 12) || 'tournament';
}

/**
 * Format date as monYY (e.g., dec25, jan26)
 * @param {string|Date} dateStr - Date to format
 * @returns {string} Formatted date string
 */
function formatMonthYear(dateStr) {
	try {
		const date = new Date(dateStr);
		if (isNaN(date.getTime())) {
			// Invalid date, use current date
			const now = new Date();
			const month = now.toLocaleString('en-US', { month: 'short' }).toLowerCase();
			const year = String(now.getFullYear()).slice(-2);
			return `${month}${year}`;
		}

		const month = date.toLocaleString('en-US', { month: 'short' }).toLowerCase();
		const year = String(date.getFullYear()).slice(-2);
		return `${month}${year}`;
	} catch (e) {
		const now = new Date();
		const month = now.toLocaleString('en-US', { month: 'short' }).toLowerCase();
		const year = String(now.getFullYear()).slice(-2);
		return `${month}${year}`;
	}
}

/**
 * Generate random 4-character alphanumeric suffix
 * @returns {string} Random suffix (e.g., 'a7x2')
 */
function randomSuffix() {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 4; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

/**
 * Generate tournament URL slug
 * Format: venue_game_monthYY_xxxx
 * @param {string} name - Tournament name
 * @param {string} gameName - Game name
 * @param {string|Date} startDate - Start date
 * @returns {string} Generated URL slug
 */
function generateTournamentUrl(name, gameName, startDate) {
	const venue = extractVenue(name);
	const game = abbreviateGame(gameName);
	const date = formatMonthYear(startDate);
	const suffix = randomSuffix();

	return `${venue}_${game}_${date}_${suffix}`;
}

module.exports = {
	GAME_ABBREVIATIONS,
	abbreviateGame,
	extractVenue,
	formatMonthYear,
	randomSuffix,
	generateTournamentUrl
};
