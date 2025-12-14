/**
 * Tournament Narrator Service
 *
 * Generates AI-powered tournament recap narratives using Claude AI.
 * Creates engaging storylines from tournament data for social media,
 * Discord, and comprehensive reports.
 */

const crypto = require('crypto');
const secrets = require('../config/secrets');

// Dependencies (set by init)
let io = null;
let analyticsDb = null;
let activityLogger = null;

// Anthropic client (lazy loaded - shares with ai-seeding)
let anthropicClient = null;

// Rate limiting for Claude API (shared budget with ai-seeding)
const apiRateLimit = {
	requests: 0,
	lastReset: Date.now(),
	maxPerMinute: 10
};

// Status messages for progress indicator
const STATUS_MESSAGES = [
	'Analyzing match results...',
	'Identifying storylines...',
	'Finding dramatic moments...',
	'Crafting narrative...'
];

// Valid narrative formats
const VALID_FORMATS = ['social', 'discord', 'full'];

/**
 * Initialize the tournament narrator service
 * @param {Object} deps - Dependencies
 * @param {Server} deps.io - Socket.IO server instance
 * @param {Object} deps.analyticsDb - Analytics database module
 * @param {Object} deps.activityLogger - Activity logger module
 */
function init(deps) {
	io = deps.io;
	analyticsDb = deps.analyticsDb;
	activityLogger = deps.activityLogger;
	console.log('[Tournament Narrator] Service initialized');
}

/**
 * Get or create Anthropic client
 * @returns {Anthropic|null} Client or null if API key not configured
 */
function getAnthropicClient() {
	if (anthropicClient) return anthropicClient;

	const apiKey = secrets.getAnthropicApiKey();
	if (!apiKey) {
		return null;
	}

	try {
		const Anthropic = require('@anthropic-ai/sdk');
		anthropicClient = new Anthropic({ apiKey });
		return anthropicClient;
	} catch (error) {
		console.error('[Tournament Narrator] Failed to initialize Anthropic client:', error.message);
		return null;
	}
}

/**
 * Reset the cached Anthropic client
 * Called when API key is updated via platform admin
 */
function resetClient() {
	anthropicClient = null;
	console.log('[Tournament Narrator] Client cache cleared');
}

/**
 * Check if narrative generation is available
 * @returns {Object} { available, reason }
 */
function isAvailable() {
	const apiKey = secrets.getAnthropicApiKey();
	if (!apiKey) {
		return { available: false, reason: 'Claude API key not configured' };
	}
	return { available: true, reason: null };
}

/**
 * Check rate limit for Claude API
 * @returns {boolean} True if request is allowed
 */
function checkRateLimit() {
	const now = Date.now();
	// Reset counter every minute
	if (now - apiRateLimit.lastReset > 60000) {
		apiRateLimit.requests = 0;
		apiRateLimit.lastReset = now;
	}

	if (apiRateLimit.requests >= apiRateLimit.maxPerMinute) {
		return false;
	}

	apiRateLimit.requests++;
	return true;
}

/**
 * Generate MD5 hash of tournament data for cache invalidation
 * @param {Object} tournament - Tournament object
 * @param {Array} matches - Array of match objects
 * @param {Array} standings - Array of standing objects
 * @returns {string} MD5 hash
 */
function generateDataHash(tournament, matches, standings) {
	const data = {
		tournamentId: tournament.id,
		completedAt: tournament.completedAt || tournament.completed_at,
		matchCount: matches.length,
		standingsCount: standings.length,
		// Include key match results for invalidation
		matchResults: matches.slice(0, 10).map(m => `${m.id}:${m.winner_id || m.winner}`).join(',')
	};
	return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
}

/**
 * Find reverse sweeps (comebacks from being down)
 * @param {Array} matches - Array of match objects
 * @returns {Array} Matches that were reverse sweeps
 */
function findReverseSweeps(matches) {
	return matches.filter(m => {
		if (!m.score || m.score === '-') return false;
		// Parse scores like "3-2" or "2-1"
		const parts = m.score.split('-').map(n => parseInt(n, 10) || 0);
		if (parts.length < 2) return false;
		const [p1Score, p2Score] = parts;
		// A reverse sweep is winning 3-2 or 2-1 (came from behind to win)
		// This is an approximation since we don't have game-by-game data
		return (p1Score === 3 && p2Score === 2) || (p1Score === 2 && p2Score === 1) ||
			   (p2Score === 3 && p1Score === 2) || (p2Score === 2 && p1Score === 1);
	});
}

/**
 * Find losers bracket runs (players with multiple wins in losers)
 * @param {Array} matches - Array of match objects
 * @param {Array} standings - Array of standing objects
 * @returns {Array} Players with notable losers runs
 */
function findLosersRuns(matches, standings) {
	// Group matches by player and check for losers round matches
	const playerLosersWins = {};

	matches.forEach(m => {
		// Check if this is a losers round (negative round number typically)
		const isLosers = m.round < 0 || (m.round_name && m.round_name.toLowerCase().includes('loser'));
		if (!isLosers || !m.winner) return;

		const winnerName = m.winner;
		if (!playerLosersWins[winnerName]) {
			playerLosersWins[winnerName] = 0;
		}
		playerLosersWins[winnerName]++;
	});

	// Find players with 3+ losers wins
	return Object.entries(playerLosersWins)
		.filter(([_, wins]) => wins >= 3)
		.map(([name, wins]) => {
			const standing = standings.find(s => s.name === name);
			return {
				name,
				losersWins: wins,
				finalRank: standing?.rank || standing?.final_rank || null
			};
		})
		.sort((a, b) => b.losersWins - a.losersWins);
}

/**
 * Identify key storylines from tournament data
 * @param {Array} matches - Array of match objects
 * @param {Array} standings - Array of standing objects
 * @returns {Object} Categorized storylines
 */
function identifyStorylines(matches, standings) {
	// Use helpers from pdf.js patterns
	const seedMap = {};
	standings.forEach(s => { seedMap[s.name] = s.seed; });

	// Find upsets (lower seed beating higher seed)
	const upsets = matches
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
		.filter(m => m.seedDiff > 0)
		.sort((a, b) => b.seedDiff - a.seedDiff)
		.slice(0, 5);

	// Find close matches (decided by 1 game)
	const closeMatches = matches
		.filter(m => {
			if (!m.score || m.score === '-') return false;
			const parts = m.score.split('-').map(n => parseInt(n, 10) || 0);
			if (parts.length < 2) return false;
			const p1 = parts[0];
			const p2 = parts[1];
			return Math.abs(p1 - p2) === 1 && (p1 > 0 || p2 > 0);
		})
		.slice(0, 5);

	// Find reverse sweeps
	const reverseSweeps = findReverseSweeps(matches);

	// Find losers bracket runs
	const losersRuns = findLosersRuns(matches, standings);

	return {
		upsets,
		closeMatches,
		reverseSweeps,
		losersRuns
	};
}

/**
 * Build prompt for AI narrative generation
 * @param {Object} tournamentData - Tournament data object
 * @param {string} format - Narrative format (social, discord, full)
 * @param {Object} storylines - Identified storylines
 * @returns {string} Prompt for Claude
 */
function buildPrompt(tournamentData, format, storylines) {
	const { tournament, standings, matches, matchStats, duration } = tournamentData;

	const champion = standings[0];
	const runnerUp = standings[1];
	const thirdPlace = standings[2];

	// Common context
	const context = `Tournament: ${tournament.name}
Game: ${tournament.gameName || tournament.game_name || 'Unknown'}
Date: ${tournament.completedAt || tournament.completed_at || 'Unknown'}
Participants: ${tournament.participantCount || tournament.participant_count || standings.length}

Final Standings:
1. ${champion?.name || 'Unknown'} (seed ${champion?.seed || '?'})
2. ${runnerUp?.name || 'Unknown'} (seed ${runnerUp?.seed || '?'})
3. ${thirdPlace?.name || 'Unknown'} (seed ${thirdPlace?.seed || '?'})

Match Statistics:
- Total Matches: ${matchStats.total}
- Completed: ${matchStats.completed}
- Forfeits: ${matchStats.forfeits}
${duration ? `- Duration: ${duration}` : ''}

Key Storylines:
${storylines.upsets.length > 0 ? `- Upsets: ${storylines.upsets.map(u => `${u.winner} (seed ${u.winnerSeed}) def. ${u.loserName} (seed ${u.loserSeed})`).join('; ')}` : '- No major upsets'}
${storylines.closeMatches.length > 0 ? `- Close Matches: ${storylines.closeMatches.map(m => `${m.player1} vs ${m.player2} (${m.score})`).join('; ')}` : ''}
${storylines.reverseSweeps.length > 0 ? `- Comebacks: ${storylines.reverseSweeps.length} reverse sweep(s)` : ''}
${storylines.losersRuns.length > 0 ? `- Losers Bracket Runs: ${storylines.losersRuns.map(r => `${r.name} (${r.losersWins} wins, finished ${r.finalRank})`).join('; ')}` : ''}`;

	if (format === 'social') {
		return `Generate a 1-2 sentence tournament recap for Twitter/X (max 280 characters).

${context}

Requirements:
- Maximum 280 characters total
- Engaging, hype-building tone
- Use active verbs
- No hashtags or emojis
- Mention the champion by name
- Focus on the most dramatic storyline

Return only the tweet text, nothing else.`;
	}

	if (format === 'discord') {
		return `Generate a 2-3 paragraph tournament recap for Discord.

${context}

Requirements:
- Use **bold** for player names
- Include specific scores where notable
- Mention seed numbers for upsets
- 2-3 focused paragraphs
- Markdown formatting (bold, line breaks)
- End with congratulations to champion
- Keep it exciting but professional
- Around 200-400 words

Return only the Discord message text, nothing else.`;
	}

	// Full format
	return `Generate a comprehensive tournament report narrative.

${context}

Include these sections with markdown headers:
1. ## Tournament Overview - Champion, format, participation summary
2. ## Champion's Journey - Their path through the bracket (what we know from standings)
3. ## Biggest Upsets - Lower seeds defeating higher seeds (include seed diff)
4. ## Closest Matches - Games decided by 1 point/game
5. ## Notable Performances - Standout performances beyond top 3
6. ## Statistical Summary - Match count, forfeit rate, duration

Requirements:
- Professional sports journalism style
- Use **bold** for player names
- Data-backed insights where possible
- Around 500-800 words
- Markdown formatting

Return only the report text, nothing else.`;
}

/**
 * Generate fallback narrative when AI is unavailable
 * @param {Object} tournamentData - Tournament data object
 * @param {string} format - Narrative format
 * @param {Object} storylines - Identified storylines
 * @returns {string} Template-based narrative
 */
function generateFallbackNarrative(tournamentData, format, storylines) {
	const { tournament, standings, matchStats, duration } = tournamentData;

	const champion = standings[0];
	const runnerUp = standings[1];
	const thirdPlace = standings[2];

	if (format === 'social') {
		const upsetText = storylines.upsets.length > 0
			? `with an incredible upset over seed ${storylines.upsets[0].loserSeed}`
			: '';
		return `Congratulations to ${champion?.name || 'our champion'} for winning ${tournament.name}! ${upsetText}`.slice(0, 280);
	}

	if (format === 'discord') {
		let text = `**${tournament.name}** has concluded!\n\n`;
		text += `**${champion?.name || 'Unknown'}** takes the crown`;
		if (champion?.seed) text += ` as the ${champion.seed === 1 ? 'top seed' : `seed ${champion.seed}`}`;
		text += `!\n\n`;

		text += `**Final Standings:**\n`;
		text += `1. **${champion?.name || 'Unknown'}**\n`;
		text += `2. **${runnerUp?.name || 'Unknown'}**\n`;
		text += `3. **${thirdPlace?.name || 'Unknown'}**\n\n`;

		if (storylines.upsets.length > 0) {
			const upset = storylines.upsets[0];
			text += `**Biggest Upset:** ${upset.winner} (seed ${upset.winnerSeed}) defeated ${upset.loserName} (seed ${upset.loserSeed})\n\n`;
		}

		text += `Congratulations to all participants! See you at the next event!`;
		return text;
	}

	// Full format
	let text = `## Tournament Overview\n\n`;
	text += `**${tournament.name}** featured ${tournament.participantCount || standings.length} participants competing for the title. `;
	text += `After ${matchStats.completed} matches, **${champion?.name || 'Unknown'}** emerged victorious.\n\n`;

	text += `## Final Standings\n\n`;
	text += `1. **${champion?.name || 'Unknown'}** (seed ${champion?.seed || '?'})\n`;
	text += `2. **${runnerUp?.name || 'Unknown'}** (seed ${runnerUp?.seed || '?'})\n`;
	text += `3. **${thirdPlace?.name || 'Unknown'}** (seed ${thirdPlace?.seed || '?'})\n\n`;

	if (storylines.upsets.length > 0) {
		text += `## Biggest Upsets\n\n`;
		storylines.upsets.forEach(u => {
			text += `- **${u.winner}** (seed ${u.winnerSeed}) defeated **${u.loserName}** (seed ${u.loserSeed})\n`;
		});
		text += `\n`;
	}

	if (storylines.closeMatches.length > 0) {
		text += `## Closest Matches\n\n`;
		storylines.closeMatches.forEach(m => {
			text += `- **${m.player1}** vs **${m.player2}** (${m.score})\n`;
		});
		text += `\n`;
	}

	text += `## Statistical Summary\n\n`;
	text += `- Total Matches: ${matchStats.total}\n`;
	text += `- Completed: ${matchStats.completed}\n`;
	text += `- Forfeits: ${matchStats.forfeits}\n`;
	if (duration) text += `- Duration: ${duration}\n`;

	return text;
}

/**
 * Generate narrative for a tournament
 * @param {number} tournamentId - Tournament ID (database ID)
 * @param {string} format - Narrative format (social, discord, full)
 * @param {Object} options - Options
 * @param {boolean} options.forceRegenerate - Force regeneration even if cached
 * @returns {Object} { narrative, format, source, cached, storylines, ... }
 */
async function generateNarrative(tournamentId, format = 'discord', options = {}) {
	const { forceRegenerate = false } = options;

	// Validate format
	if (!VALID_FORMATS.includes(format)) {
		throw new Error(`Invalid format: ${format}. Must be one of: ${VALID_FORMATS.join(', ')}`);
	}

	// Get tournament data from analytics database
	const tournament = analyticsDb.getTournamentById(tournamentId);
	if (!tournament) {
		throw new Error(`Tournament not found: ${tournamentId}`);
	}

	// Get matches and standings from database
	const db = analyticsDb.getDb();

	// Get standings (participants with final_rank)
	const standings = db.prepare(`
		SELECT
			p.display_name as name,
			tp.seed,
			tp.final_rank as rank
		FROM tournament_participants tp
		JOIN players p ON tp.player_id = p.id
		WHERE tp.tournament_id = ?
		ORDER BY tp.final_rank ASC NULLS LAST, tp.seed ASC
	`).all(tournamentId);

	// Get matches with player names
	const matches = db.prepare(`
		SELECT
			m.*,
			p1.display_name as player1,
			p2.display_name as player2,
			w.display_name as winner
		FROM matches m
		LEFT JOIN players p1 ON m.player1_id = p1.id
		LEFT JOIN players p2 ON m.player2_id = p2.id
		LEFT JOIN players w ON m.winner_id = w.id
		WHERE m.tournament_id = ?
		ORDER BY m.round, m.id
	`).all(tournamentId);

	// Generate data hash for cache invalidation
	const dataHash = generateDataHash(tournament, matches, standings);

	// Check cache first (unless forcing regeneration)
	if (!forceRegenerate) {
		const cached = analyticsDb.getNarrativeCache(tournamentId, format);
		if (cached && cached.dataHash === dataHash) {
			console.log(`[Tournament Narrator] Cache hit for tournament ${tournamentId} format ${format}`);
			return {
				narrative: cached.narrative,
				socialPost: cached.socialPost,
				format: cached.format,
				source: cached.source,
				cached: true,
				cachedAt: cached.generatedAt,
				storylines: cached.storylines,
				tournamentId,
				tournamentName: tournament.name
			};
		}
	}

	// Emit progress via WebSocket
	if (io) {
		io.emit('narrative:generating', {
			tournamentId,
			format,
			status: STATUS_MESSAGES[0]
		});
	}

	// Calculate match stats and duration
	const completed = matches.filter(m => m.winner_id || m.winner).length;
	const forfeits = matches.filter(m =>
		m.scores_csv === '0-0' || (m.scores_csv === '-' && (m.winner_id || m.winner))
	).length;
	const matchStats = { total: matches.length, completed, forfeits };

	// Calculate duration
	let duration = null;
	if (tournament.started_at && tournament.completed_at) {
		const start = new Date(tournament.started_at);
		const end = new Date(tournament.completed_at);
		const diffMs = end - start;
		if (diffMs > 0) {
			const hours = Math.floor(diffMs / 3600000);
			const minutes = Math.floor((diffMs % 3600000) / 60000);
			duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
		}
	}

	// Prepare matches for storyline detection (normalize field names)
	const normalizedMatches = matches.map(m => ({
		...m,
		score: m.scores_csv || '-',
		winner: m.winner || (m.winner_id ? standings.find(s => s.player_id === m.winner_id)?.name : null)
	}));

	// Identify storylines
	const storylines = identifyStorylines(normalizedMatches, standings);

	// Update progress
	if (io) {
		io.emit('narrative:generating', {
			tournamentId,
			format,
			status: STATUS_MESSAGES[1]
		});
	}

	// Prepare tournament data
	const tournamentData = {
		tournament: {
			...tournament,
			gameName: tournament.game_name,
			participantCount: tournament.participant_count,
			completedAt: tournament.completed_at
		},
		standings,
		matches: normalizedMatches,
		matchStats,
		duration
	};

	// Try AI generation
	const client = getAnthropicClient();
	let narrative = null;
	let source = 'fallback';

	if (client && checkRateLimit()) {
		try {
			// Update progress
			if (io) {
				io.emit('narrative:generating', {
					tournamentId,
					format,
					status: STATUS_MESSAGES[3]
				});
			}

			const prompt = buildPrompt(tournamentData, format, storylines);

			console.log(`[Tournament Narrator] Calling Claude API for tournament ${tournamentId} format ${format}`);

			const response = await client.messages.create({
				model: 'claude-sonnet-4-20250514',
				max_tokens: format === 'social' ? 100 : format === 'discord' ? 800 : 1500,
				messages: [
					{
						role: 'user',
						content: prompt
					}
				]
			});

			narrative = response.content[0]?.text?.trim();
			source = 'ai';

			console.log(`[Tournament Narrator] AI narrative generated for tournament ${tournamentId} format ${format}`);
		} catch (error) {
			console.error(`[Tournament Narrator] AI generation failed:`, error.message);
			// Fall through to fallback
		}
	} else if (!client) {
		console.log(`[Tournament Narrator] AI not available, using fallback`);
	} else {
		console.log(`[Tournament Narrator] Rate limit exceeded, using fallback`);
	}

	// Use fallback if AI failed or unavailable
	if (!narrative) {
		narrative = generateFallbackNarrative(tournamentData, format, storylines);
	}

	// For social format, also generate a social-specific post if using full narrative
	let socialPost = null;
	if (format !== 'social') {
		// Could generate a social version too, but for now just leave null
		socialPost = null;
	}

	// Save to cache
	analyticsDb.saveNarrativeCache(
		tournamentId,
		format,
		narrative,
		dataHash,
		{ storylines, socialPost },
		source
	);

	// Log activity
	if (activityLogger) {
		activityLogger.logActivity(0, 'System', 'narrative_generated', {
			tournamentId,
			tournamentName: tournament.name,
			format,
			source
		});
	}

	// Emit completion via WebSocket
	if (io) {
		io.emit('narrative:complete', {
			tournamentId,
			format,
			source,
			cached: false
		});
	}

	return {
		narrative,
		socialPost,
		format,
		source,
		cached: false,
		storylines,
		tournamentId,
		tournamentName: tournament.name
	};
}

/**
 * Get all cached narratives for a tournament
 * @param {number} tournamentId - Tournament ID
 * @returns {Array} Array of cached narrative info
 */
function getCachedNarratives(tournamentId) {
	return analyticsDb.getAllNarrativesForTournament(tournamentId);
}

/**
 * Clear cached narratives for a tournament
 * @param {number} tournamentId - Tournament ID
 */
function clearCache(tournamentId) {
	analyticsDb.deleteNarrativeCache(tournamentId);
}

module.exports = {
	init,
	isAvailable,
	resetClient,
	generateNarrative,
	getCachedNarratives,
	clearCache,
	identifyStorylines,
	STATUS_MESSAGES,
	VALID_FORMATS
};
