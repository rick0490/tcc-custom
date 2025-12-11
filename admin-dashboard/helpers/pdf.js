/**
 * PDF Helper Functions
 *
 * Helper functions for generating tournament PDF reports.
 * Extracted from server.js for modularity.
 */

// PDF Report Color Palette
const PDF_COLORS = {
	primary: '#1A1A1A',      // Near-black for headers/backgrounds
	secondary: '#FFFFFF',    // White for text on dark backgrounds
	accent: '#E63946',       // Red for highlights and accents
	muted: '#6B7280',        // Gray for secondary text
	surface: '#2D2D2D',      // Dark gray for alternating rows
	border: '#404040',       // Subtle borders
	gold: '#FFD700',         // 1st place medal
	silver: '#C0C0C0',       // 2nd place medal
	bronze: '#CD7F32',       // 3rd place medal
	rowAlt: '#F5F5F5'        // Alternating row background
};

/**
 * Draw medal circle for top 3 placements
 * @param {PDFDocument} doc - PDFKit document
 * @param {number} x - X coordinate (center)
 * @param {number} y - Y coordinate (center)
 * @param {number} rank - Placement rank (1, 2, or 3)
 */
function drawPdfMedal(doc, x, y, rank) {
	const medalColors = { 1: PDF_COLORS.gold, 2: PDF_COLORS.silver, 3: PDF_COLORS.bronze };
	const color = medalColors[rank];
	if (!color) return;

	doc.save();
	doc.circle(x, y, 12).fill(color);
	doc.fillColor(rank === 1 ? '#000000' : '#FFFFFF')
		.fontSize(10).font('Helvetica-Bold')
		.text(rank.toString(), x - 4, y - 5, { width: 8, align: 'center' });
	doc.restore();
}

/**
 * Draw section header with accent bar
 * @param {PDFDocument} doc - PDFKit document
 * @param {string} title - Section title
 * @param {number} y - Y position
 * @returns {number} New Y position after header
 */
function drawPdfSectionHeader(doc, title, y) {
	const x = 50;
	doc.save();
	doc.fillColor(PDF_COLORS.accent).rect(x, y, 4, 24).fill();
	doc.fillColor(PDF_COLORS.primary).font('Helvetica-Bold').fontSize(14)
		.text(title, x + 12, y + 4);
	doc.restore();
	return y + 35;
}

/**
 * Draw alternating row background
 * @param {PDFDocument} doc - PDFKit document
 * @param {number} y - Y position
 * @param {boolean} isAlternate - Whether this is an alternate row
 * @param {number} height - Row height (default 24)
 */
function drawPdfTableRow(doc, y, isAlternate, height = 24) {
	if (isAlternate) {
		doc.save();
		doc.fillColor(PDF_COLORS.rowAlt).rect(50, y, 510, height).fill();
		doc.restore();
	}
}

/**
 * Find biggest upsets (lower seed beating higher seed)
 * @param {Array} matches - Array of match objects
 * @param {Array} standings - Array of standing objects with name and seed
 * @returns {Array} Top 5 upsets sorted by seed difference
 */
function findUpsets(matches, standings) {
	const seedMap = {};
	standings.forEach(s => { seedMap[s.name] = s.seed; });

	return matches
		.filter(m => m.winner && m.player1 && m.player2)
		.map(m => {
			const winnerSeed = seedMap[m.winner] || 999;
			const loserName = m.winner === m.player1 ? m.player2 : m.player1;
			const loserSeed = seedMap[loserName] || 999;
			return {
				...m,
				winnerSeed,
				loserSeed,
				loserName,
				seedDiff: winnerSeed - loserSeed
			};
		})
		.filter(m => m.seedDiff > 0) // Winner had higher seed number (worse seed = upset)
		.sort((a, b) => b.seedDiff - a.seedDiff) // Biggest upsets first
		.slice(0, 5);
}

/**
 * Find closest matches (decided by 1 game)
 * @param {Array} matches - Array of match objects
 * @returns {Array} Top 5 closest matches
 */
function findCloseMatches(matches) {
	return matches
		.filter(m => {
			if (!m.score || m.score === '-') return false;
			const parts = m.score.split('-').map(n => parseInt(n, 10) || 0);
			if (parts.length < 2) return false;
			const p1 = parts[0];
			const p2 = parts[1];
			return Math.abs(p1 - p2) === 1 && (p1 > 0 || p2 > 0);
		})
		.slice(0, 5);
}

/**
 * Calculate match statistics
 * @param {Array} matches - Array of match objects
 * @returns {Object} { total, completed, forfeits }
 */
function calculateMatchStats(matches) {
	const completed = matches.filter(m => m.winner).length;
	// A forfeit is specifically a 0-0 score with a winner
	// null/undefined scores simply mean scores weren't entered, NOT forfeits
	// The '-' character was used in old v1 API but v2.1 uses null for no scores
	const forfeits = matches.filter(m => {
		if (!m.winner) return false;
		// Only count as forfeit if score is explicitly "0-0" or "0 - 0"
		if (!m.score) return false; // null/undefined scores are NOT forfeits
		const normalizedScore = m.score.replace(/\s/g, '');
		return normalizedScore === '0-0';
	}).length;

	return {
		total: matches.length,
		completed,
		forfeits
	};
}

/**
 * Calculate tournament duration
 * @param {Object} tournament - Tournament object with startedAt and completedAt
 * @returns {string|null} Duration string or null if unavailable
 */
function calculateDuration(tournament) {
	if (!tournament.startedAt || !tournament.completedAt) return null;
	const start = new Date(tournament.startedAt);
	const end = new Date(tournament.completedAt);
	const diffMs = end - start;
	if (diffMs <= 0) return null;
	const hours = Math.floor(diffMs / 3600000);
	const minutes = Math.floor((diffMs % 3600000) / 60000);
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}

module.exports = {
	PDF_COLORS,
	drawPdfMedal,
	drawPdfSectionHeader,
	drawPdfTableRow,
	findUpsets,
	findCloseMatches,
	calculateMatchStats,
	calculateDuration
};
