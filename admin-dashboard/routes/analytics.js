/**
 * Analytics Routes
 *
 * Handles analytics, player rankings, tournament archival,
 * seeding suggestions, and data export (CSV/PDF).
 */

const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:analytics');

// Module dependencies (injected via init)
let analyticsDb = null;
let challongeApi = null;
let requireAuthAPI = null;
let requireAdmin = null;
let logActivity = null;
let pdfHelpers = null;

// PDF color scheme
const PDF_COLORS = {
	primary: '#1a1a2e',
	secondary: '#ffffff',
	accent: '#e94560',
	muted: '#6b7280',
	border: '#e5e7eb',
	rowAlt: '#f9fafb'
};

/**
 * Initialize route dependencies
 * @param {Object} deps - Dependencies object
 */
function init(deps) {
	analyticsDb = deps.analyticsDb;
	challongeApi = deps.challongeApi;
	requireAuthAPI = deps.requireAuthAPI;
	requireAdmin = deps.requireAdmin;
	logActivity = deps.logActivity || (() => {});
	pdfHelpers = deps.pdfHelpers || require('../helpers/pdf');
}

// ============================================
// ANALYTICS ROUTES
// ============================================

/**
 * GET /games
 * Get all games with tournament counts
 */
router.get('/games', async (req, res) => {
	requireAuthAPI(req, res, () => {
		try {
			const games = analyticsDb.getAllGames();
			res.json({ success: true, games });
		} catch (error) {
			logger.error('games:list', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /stats/overview
 * Get overview statistics (filtered by user)
 */
router.get('/stats/overview', async (req, res) => {
	requireAuthAPI(req, res, () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const stats = analyticsDb.getOverviewStats(userId);
			res.json({ success: true, ...stats });
		} catch (error) {
			logger.error('stats:overview', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /stats/attendance
 * Get attendance statistics (filtered by user)
 */
router.get('/stats/attendance', async (req, res) => {
	requireAuthAPI(req, res, () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { game: gameId, months = 6 } = req.query;
			const stats = analyticsDb.getAttendanceStats(
				userId,
				gameId ? parseInt(gameId) : null,
				parseInt(months)
			);
			res.json({ success: true, ...stats });
		} catch (error) {
			logger.error('stats:attendance', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /rankings/:gameId
 * Get player rankings for a game (filtered by user)
 */
router.get('/rankings/:gameId', async (req, res) => {
	requireAuthAPI(req, res, () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { gameId } = req.params;
			const { limit = 50, offset = 0, sortBy = 'elo' } = req.query;

			const rankings = analyticsDb.getPlayerRankings(parseInt(gameId), {
				userId,
				limit: parseInt(limit),
				offset: parseInt(offset),
				sortBy
			});

			res.json({ success: true, rankings });
		} catch (error) {
			logger.error('rankings:get', error, { gameId: req.params.gameId });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /players
 * Search players (filtered by user)
 */
router.get('/players', async (req, res) => {
	requireAuthAPI(req, res, () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { search = '', game: gameId, limit = 20 } = req.query;

			if (!search) {
				return res.json({ success: true, players: [] });
			}

			const players = analyticsDb.searchPlayers(
				search,
				userId,
				gameId ? parseInt(gameId) : null,
				parseInt(limit)
			);

			res.json({ success: true, players });
		} catch (error) {
			logger.error('players:search', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /players/unmatched
 * Get unmatched players queue (filtered by user)
 */
router.get('/players/unmatched', async (req, res) => {
	requireAuthAPI(req, res, () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const unmatched = analyticsDb.getUnmatchedPlayers(userId);
			res.json({ success: true, unmatched });
		} catch (error) {
			logger.error('players:unmatched', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /players/:playerId
 * Get player profile (filtered by user)
 */
router.get('/players/:playerId', async (req, res) => {
	requireAuthAPI(req, res, () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { playerId } = req.params;
			const profile = analyticsDb.getPlayerProfile(parseInt(playerId), userId);

			if (!profile) {
				return res.status(404).json({ success: false, error: 'Player not found' });
			}

			res.json({ success: true, ...profile });
		} catch (error) {
			logger.error('players:profile', error, { playerId: req.params.playerId });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /players/:player1Id/head-to-head/:player2Id
 * Get head-to-head record (filtered by user)
 */
router.get('/players/:player1Id/head-to-head/:player2Id', async (req, res) => {
	requireAuthAPI(req, res, () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { player1Id, player2Id } = req.params;
			const { game: gameId } = req.query;

			const h2h = analyticsDb.getHeadToHead(
				parseInt(player1Id),
				parseInt(player2Id),
				userId,
				gameId ? parseInt(gameId) : null
			);

			res.json({ success: true, ...h2h });
		} catch (error) {
			logger.error('players:headToHead', error, { player1Id: req.params.player1Id, player2Id: req.params.player2Id });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * PUT /players/:playerId/alias
 * Add alias to player (scoped to user)
 */
router.put('/players/:playerId/alias', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { playerId } = req.params;
			const { alias } = req.body;

			if (!alias) {
				return res.status(400).json({ success: false, error: 'Alias is required' });
			}

			const success = analyticsDb.addPlayerAlias(parseInt(playerId), alias, userId);

			if (success && logActivity) {
				logActivity('player_alias_added', req.session?.username || 'system', { playerId, alias });
			}

			res.json({ success });
		} catch (error) {
			logger.error('players:alias', error, { playerId: req.params.playerId });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /players/merge
 * Merge players (admin only, scoped to user)
 */
router.post('/players/merge', async (req, res) => {
	requireAuthAPI(req, res, () => {
		requireAdmin(req, res, async () => {
			try {
				const userId = req.session?.userId;
				if (!userId) {
					return res.status(401).json({ success: false, error: 'User not authenticated' });
				}
				const { sourcePlayerId, targetPlayerId } = req.body;

				if (!sourcePlayerId || !targetPlayerId) {
					return res.status(400).json({ success: false, error: 'Both player IDs are required' });
				}

				analyticsDb.mergePlayers(parseInt(sourcePlayerId), parseInt(targetPlayerId), userId);

				if (logActivity) {
					logActivity('players_merged', req.session?.username || 'system', { sourcePlayerId, targetPlayerId });
				}

				res.json({ success: true });
			} catch (error) {
				logger.error('players:merge', error, { sourcePlayerId: req.body.sourcePlayerId, targetPlayerId: req.body.targetPlayerId });
				res.status(500).json({ success: false, error: error.message });
			}
		});
	});
});

/**
 * POST /players/unmatched/:id/resolve
 * Resolve unmatched player (scoped to user)
 */
router.post('/players/unmatched/:id/resolve', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { id } = req.params;
			const { playerId, createNew, newPlayerName } = req.body;

			let resolvedPlayerId = playerId;

			if (createNew && newPlayerName) {
				resolvedPlayerId = analyticsDb.createPlayer(newPlayerName, userId);
			}

			analyticsDb.resolveUnmatchedPlayer(parseInt(id), resolvedPlayerId ? parseInt(resolvedPlayerId) : null, userId);

			if (logActivity) {
				logActivity('unmatched_player_resolved', req.session?.username || 'system', { unmatchedId: id, playerId: resolvedPlayerId });
			}

			res.json({ success: true });
		} catch (error) {
			logger.error('players:resolveUnmatched', error, { unmatchedId: req.params.id });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /tournaments
 * Get archived tournaments (filtered by user)
 */
router.get('/tournaments', async (req, res) => {
	requireAuthAPI(req, res, () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { game: gameId, limit = 50, offset = 0 } = req.query;

			const tournaments = analyticsDb.getArchivedTournaments({
				userId,
				gameId: gameId ? parseInt(gameId) : null,
				limit: parseInt(limit),
				offset: parseInt(offset)
			});

			res.json({ success: true, tournaments });
		} catch (error) {
			logger.error('tournaments:list', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /tournaments/:tournamentId
 * Get tournament details (filtered by user)
 */
router.get('/tournaments/:tournamentId', async (req, res) => {
	requireAuthAPI(req, res, () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { tournamentId } = req.params;
			const data = analyticsDb.getTournamentById(parseInt(tournamentId), userId);

			if (!data) {
				return res.status(404).json({ success: false, error: 'Tournament not found' });
			}

			res.json({ success: true, ...data });
		} catch (error) {
			logger.error('tournaments:get', error, { tournamentId: req.params.tournamentId });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /archive/status
 * Get archive status (which tournaments are archived vs not, filtered by user)
 */
router.get('/archive/status', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}

			// Fetch completed tournaments from Challonge v2.1
			const response = await challongeApi.challongeV2Request('GET', '/tournaments.json?page_size=100&state=complete');
			const tournamentsData = response.data?.data || [];

			// Filter to only include tournaments that are truly complete
			const challongeTournaments = tournamentsData
				.filter(t => t.attributes.state === 'complete' && t.attributes.timestamps?.completed_at)
				.map(t => ({
					id: parseInt(t.id),
					url: t.attributes.url,
					name: t.attributes.name,
					game: t.attributes.game_name,
					state: t.attributes.state,
					completedAt: t.attributes.timestamps?.completed_at,
					participantCount: t.attributes.participants_count
				}));

			// Check which are archived (scoped to user)
			const archived = [];
			const unarchived = [];

			for (const t of challongeTournaments) {
				if (analyticsDb.isTournamentArchived(t.url, userId)) {
					archived.push(t);
				} else {
					unarchived.push(t);
				}
			}

			res.json({ success: true, archived, unarchived });
		} catch (error) {
			logger.error('archive:status', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /archive/:tournamentId
 * Archive a tournament (scoped to user)
 */
router.post('/archive/:tournamentId', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { tournamentId } = req.params; // Challonge URL slug

			// Check if already archived (scoped to user)
			if (analyticsDb.isTournamentArchived(tournamentId, userId)) {
				return res.status(400).json({ success: false, error: 'Tournament already archived' });
			}

			// Fetch tournament details from Challonge v2.1
			const tournamentResponse = await challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}.json`);
			const tournamentData = tournamentResponse.data.data;
			const attrs = tournamentData.attributes;

			// Transform to internal format
			const tournament = {
				id: parseInt(tournamentData.id),
				url: attrs.url,
				name: attrs.name,
				game_name: attrs.game_name,
				tournament_type: attrs.tournament_type,
				state: attrs.state,
				started_at: attrs.timestamps?.started_at,
				completed_at: attrs.timestamps?.completed_at,
				full_challonge_url: attrs.full_challonge_url
			};

			if (tournament.state !== 'complete') {
				return res.status(400).json({ success: false, error: 'Tournament is not complete' });
			}

			// Fetch participants v2.1
			const participantsResponse = await challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json?page_size=256`);
			const participantsData = participantsResponse.data?.data || [];
			const participants = participantsData.map(p => ({
				id: parseInt(p.id),
				name: p.attributes.name,
				display_name: p.attributes.display_name,
				seed: p.attributes.seed,
				final_rank: p.attributes.final_rank,
				checked_in: p.attributes.checked_in,
				invite_email: p.attributes.email,
				challonge_username: p.attributes.username,
				misc: p.attributes.misc
			}));

			// Fetch matches v2.1
			const matchesResponse = await challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}/matches.json?page_size=256`);
			const matchesData = matchesResponse.data?.data || [];
			const matches = matchesData.map(m => {
				// v2.1 API: player IDs are in points_by_participant, NOT in attributes.player1_id
				const pointsByParticipant = m.attributes?.points_by_participant || [];
				const player1Points = pointsByParticipant[0]?.participant_id;
				const player2Points = pointsByParticipant[1]?.participant_id;

				return {
					id: parseInt(m.id),
					state: m.attributes.state,
					round: m.attributes.round,
					player1_id: player1Points,
					player2_id: player2Points,
					winner_id: m.attributes.winner_id,
					// v2.1 uses 'scores' (display format like "2 - 0") instead of scores_csv
					scores_csv: m.attributes.scores_csv || (m.attributes.scores ? m.attributes.scores.replace(/\s/g, '') : null),
					completed_at: m.attributes.timestamps?.completed_at,
					identifier: m.attributes.identifier
				};
			});

			// Get or create game
			const game = analyticsDb.getOrCreateGame(tournament.game_name || 'Unknown');

			// Map Challonge participant IDs to our player IDs (scoped to user)
			const participantToPlayerMap = {};
			const unmatchedParticipants = [];

			for (const participant of participants) {
				const name = participant.name || participant.display_name;
				const match = analyticsDb.findPlayerByName(name, userId);

				if (match && match.matchType !== 'suggestion') {
					participantToPlayerMap[participant.id] = match.player.id;
				} else if (match && match.matchType === 'suggestion') {
					// Create new player but queue for potential manual merge
					const newPlayerId = analyticsDb.createPlayer(
						name,
						userId,
						participant.invite_email,
						participant.challonge_username,
						participant.misc?.includes('Instagram:') ? participant.misc.replace('Instagram:', '').trim() : null
					);
					participantToPlayerMap[participant.id] = newPlayerId;
					unmatchedParticipants.push({
						name,
						playerId: newPlayerId,
						suggestedMerge: match.player.id,
						distance: match.distance
					});
				} else {
					// Create new player
					const newPlayerId = analyticsDb.createPlayer(
						name,
						userId,
						participant.invite_email,
						participant.challonge_username,
						participant.misc?.includes('Instagram:') ? participant.misc.replace('Instagram:', '').trim() : null
					);
					participantToPlayerMap[participant.id] = newPlayerId;
				}
			}

			// Archive tournament (scoped to user)
			const dbTournamentId = analyticsDb.archiveTournament({
				userId,
				challongeId: tournament.id,
				challongeUrl: tournament.url,
				name: tournament.name,
				gameId: game.id,
				tournamentType: tournament.tournament_type,
				participantCount: participants.length,
				startedAt: tournament.started_at,
				completedAt: tournament.completed_at,
				fullChallongeUrl: tournament.full_challonge_url
			});

			// Add tournament participants
			for (const participant of participants) {
				analyticsDb.addTournamentParticipant({
					tournamentId: dbTournamentId,
					playerId: participantToPlayerMap[participant.id],
					challongeParticipantId: participant.id,
					seed: participant.seed,
					finalRank: participant.final_rank,
					checkedIn: participant.checked_in
				});
			}

			// Add matches
			for (const match of matches) {
				if (match.state !== 'complete') continue;

				const scores = analyticsDb.parseScores(match.scores_csv);
				// Convert IDs to integers for consistent map lookup (v2.1 API returns string IDs)
				const player1Id = participantToPlayerMap[parseInt(match.player1_id)];
				const player2Id = participantToPlayerMap[parseInt(match.player2_id)];
				const winnerId = participantToPlayerMap[parseInt(match.winner_id)];
				const loserId = winnerId === player1Id ? player2Id : player1Id;

				analyticsDb.addMatch({
					tournamentId: dbTournamentId,
					challongeMatchId: match.id,
					round: match.round,
					player1Id,
					player2Id,
					winnerId,
					loserId,
					player1Score: scores.player1Score,
					player2Score: scores.player2Score,
					scoresCsv: match.scores_csv,
					completedAt: match.completed_at,
					matchIdentifier: match.identifier
				});
			}

			// Queue unmatched for review (scoped to user)
			for (const um of unmatchedParticipants) {
				analyticsDb.addUnmatchedPlayer(dbTournamentId, um.name, um.suggestedMerge, 1 - (um.distance / 10), userId);
			}

			// Update Elo ratings (scoped to user)
			analyticsDb.updateEloRatings(dbTournamentId, game.id, userId);

			if (logActivity) {
				logActivity('tournament_archived', req.session?.username || 'system', {
					tournamentId,
					name: tournament.name,
					participants: participants.length,
					matches: matches.filter(m => m.state === 'complete').length
				});
			}

			res.json({
				success: true,
				archived: {
					id: dbTournamentId,
					name: tournament.name,
					participants: participants.length,
					matches: matches.filter(m => m.state === 'complete').length,
					unmatchedPlayers: unmatchedParticipants.length
				}
			});
		} catch (error) {
			logger.error('archive:tournament', error, { tournamentId: req.params.tournamentId });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /upcoming-tournaments
 * Get upcoming tournaments (for seeding suggestions)
 */
router.get('/upcoming-tournaments', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			// Fetch pending and underway tournaments using v2.1
			const [pendingRes, underwayRes] = await Promise.all([
				challongeApi.challongeV2Request('GET', '/tournaments.json?page_size=100&state=pending'),
				challongeApi.challongeV2Request('GET', '/tournaments.json?page_size=100&state=underway')
			]);

			const pendingData = pendingRes.data?.data || [];
			const underwayData = underwayRes.data?.data || [];

			const now = new Date();
			const next48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

			const tournaments = [...pendingData, ...underwayData]
				.map(t => {
					const startAt = t.attributes.timestamps?.starts_at || t.attributes.starts_at;
					return {
						id: parseInt(t.id),
						url: t.attributes.url,
						name: t.attributes.name,
						game: t.attributes.game_name,
						state: t.attributes.state,
						startAt: startAt,
						participantCount: t.attributes.participants_count,
						isToday: startAt ?
							new Date(startAt).toDateString() === now.toDateString() : false,
						isUnderway: t.attributes.state === 'underway'
					};
				})
				.filter(t => {
					// Include if underway, or starting within 48 hours
					if (t.isUnderway) return true;
					if (!t.startAt) return true;
					const startDate = new Date(t.startAt);
					return startDate <= next48Hours;
				})
				.sort((a, b) => {
					// Underway first, then by start date
					if (a.isUnderway && !b.isUnderway) return -1;
					if (!a.isUnderway && b.isUnderway) return 1;
					if (a.isToday && !b.isToday) return -1;
					if (!a.isToday && b.isToday) return 1;
					return new Date(a.startAt || 0) - new Date(b.startAt || 0);
				});

			res.json({ success: true, tournaments });
		} catch (error) {
			logger.error('upcomingTournaments', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /seeding-suggestions/:tournamentId
 * Get seeding suggestions based on Elo rankings (scoped to user)
 */
router.get('/seeding-suggestions/:tournamentId', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session?.userId;
			if (!userId) {
				return res.status(401).json({ success: false, error: 'User not authenticated' });
			}
			const { tournamentId } = req.params;

			// Fetch tournament info using v2.1
			const tournamentRes = await challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}.json`);
			const tournamentData = tournamentRes.data.data;
			const tournament = {
				id: parseInt(tournamentData.id),
				url: tournamentData.attributes.url,
				name: tournamentData.attributes.name,
				game_name: tournamentData.attributes.game_name,
				state: tournamentData.attributes.state,
				participants_count: tournamentData.attributes.participants_count
			};

			// Fetch current participants using v2.1
			const participantsRes = await challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json?page_size=256`);
			const participantsData = participantsRes.data?.data || [];
			const participants = participantsData.map(p => ({
				id: parseInt(p.id),
				name: p.attributes.name,
				display_name: p.attributes.display_name,
				seed: p.attributes.seed
			}));

			// Get game from tournament
			const gameName = tournament.game_name;
			const game = gameName ? analyticsDb.getOrCreateGame(gameName) : null;

			// Match participants to player records and get Elo (scoped to user)
			const suggestions = [];
			for (const participant of participants) {
				const name = participant.name || participant.display_name;
				const playerMatch = analyticsDb.findPlayerByName(name, userId);

				let elo = null;
				let playerId = null;
				let matchType = 'none';

				if (playerMatch) {
					playerId = playerMatch.player.id;
					matchType = playerMatch.matchType;

					// Get Elo for this game (scoped to user)
					if (game) {
						const db = analyticsDb.getDb();
						const rating = db.prepare(`
							SELECT elo_rating, matches_played, wins, losses
							FROM player_ratings
							WHERE player_id = ? AND game_id = ? AND user_id = ?
						`).get(playerId, game.id, userId);

						if (rating) {
							elo = rating.elo_rating;
						}
					}
				}

				suggestions.push({
					participantId: participant.id,
					name: name,
					currentSeed: participant.seed,
					playerId: playerId,
					matchType: matchType,
					elo: elo,
					isNewPlayer: !elo
				});
			}

			// Sort by Elo (highest first), new players at the end
			suggestions.sort((a, b) => {
				if (a.elo && b.elo) return b.elo - a.elo;
				if (a.elo && !b.elo) return -1;
				if (!a.elo && b.elo) return 1;
				return 0;
			});

			// Assign suggested seeds
			suggestions.forEach((s, index) => {
				s.suggestedSeed = index + 1;
				s.seedDiff = s.currentSeed ? s.suggestedSeed - s.currentSeed : null;
			});

			res.json({
				success: true,
				tournament: {
					id: tournament.id,
					url: tournament.url,
					name: tournament.name,
					game: gameName,
					state: tournament.state,
					participantCount: participants.length
				},
				suggestions,
				timestamp: new Date().toISOString()
			});
		} catch (error) {
			logger.error('seedingSuggestions', error, { tournamentId: req.params.tournamentId });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /apply-seeding/:tournamentId
 * Apply seeding suggestions to a tournament
 */
router.post('/apply-seeding/:tournamentId', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { tournamentId } = req.params;
			const { seeds } = req.body; // Array of { participantId, seed }

			if (!seeds || !Array.isArray(seeds)) {
				return res.status(400).json({ success: false, error: 'Seeds array is required' });
			}

			// Update each participant's seed using v2.1
			const results = [];
			for (const { participantId, seed } of seeds) {
				try {
					await challongeApi.challongeV2Request('PUT', `/tournaments/${tournamentId}/participants/${participantId}.json`, {
						data: {
							type: 'Participant',
							attributes: { seed }
						}
					});
					results.push({ participantId, seed, success: true });
				} catch (err) {
					results.push({ participantId, seed, success: false, error: err.message });
				}
			}

			if (logActivity) {
				logActivity('seeding_applied', req.session?.username || 'system', {
					tournamentId,
					seedsApplied: results.filter(r => r.success).length,
					seedsFailed: results.filter(r => !r.success).length
				});
			}

			res.json({
				success: true,
				results,
				applied: results.filter(r => r.success).length,
				failed: results.filter(r => !r.success).length
			});
		} catch (error) {
			logger.error('applySeeding', error, { tournamentId: req.params.tournamentId });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

// ============================================
// AI SEEDING ROUTES
// ============================================

// AI seeding service (injected via init or lazy loaded)
let aiSeedingService = null;

function getAISeedingService() {
	if (!aiSeedingService) {
		try {
			aiSeedingService = require('../services/ai-seeding');
		} catch (e) {
			logger.warn('aiSeeding:unavailable', { error: e.message });
		}
	}
	return aiSeedingService;
}

/**
 * GET /ai-seeding/status
 * Check if AI seeding is available
 */
router.get('/ai-seeding/status', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		const service = getAISeedingService();
		if (!service) {
			return res.json({
				success: true,
				available: false,
				reason: 'AI seeding service not loaded'
			});
		}

		const status = service.isAvailable();
		res.json({
			success: true,
			...status
		});
	});
});

/**
 * GET /ai-seeding/:tournamentId
 * Get AI-powered seeding suggestions
 * Query params: regenerate=true to force new generation
 */
router.get('/ai-seeding/:tournamentId', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { tournamentId } = req.params;
			const forceRegenerate = req.query.regenerate === 'true';

			const service = getAISeedingService();
			if (!service) {
				return res.status(503).json({
					success: false,
					error: 'AI seeding service not available'
				});
			}

			const result = await service.generateSeedingSuggestions(tournamentId, forceRegenerate);

			if (!result.success) {
				return res.status(500).json(result);
			}

			res.json(result);
		} catch (error) {
			logger.error('aiSeeding:get', error, { tournamentId: req.params.tournamentId });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /ai-seeding/:tournamentId/lock
 * Lock specific seed positions
 * Body: { lockedSeeds: [{participantId, seed, name}] }
 */
router.post('/ai-seeding/:tournamentId/lock', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { tournamentId } = req.params;
			const { lockedSeeds } = req.body;

			if (!Array.isArray(lockedSeeds)) {
				return res.status(400).json({
					success: false,
					error: 'lockedSeeds must be an array'
				});
			}

			const service = getAISeedingService();
			if (!service) {
				return res.status(503).json({
					success: false,
					error: 'AI seeding service not available'
				});
			}

			service.updateLockedSeeds(tournamentId, lockedSeeds);

			if (logActivity) {
				logActivity('ai_seeding_locked', req.session?.username || 'system', {
					tournamentId,
					lockedCount: lockedSeeds.length
				});
			}

			res.json({
				success: true,
				lockedSeeds,
				message: `${lockedSeeds.length} seed position(s) locked`
			});
		} catch (error) {
			logger.error('aiSeeding:lock', error, { tournamentId: req.params.tournamentId });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /ai-seeding/:tournamentId/apply
 * Apply AI seeding suggestions to Challonge
 * Body: { seeds: [{participantId, seed}] }
 */
router.post('/ai-seeding/:tournamentId/apply', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { tournamentId } = req.params;
			const { seeds } = req.body;

			if (!seeds || !Array.isArray(seeds)) {
				return res.status(400).json({
					success: false,
					error: 'Seeds array is required'
				});
			}

			// Apply each seed to Challonge
			const results = [];
			for (const { participantId, seed } of seeds) {
				try {
					await challongeApi.challongeV2Request('PUT', `/tournaments/${tournamentId}/participants/${participantId}.json`, {
						data: {
							type: 'Participant',
							attributes: { seed }
						}
					});
					results.push({ participantId, seed, success: true });
				} catch (err) {
					results.push({ participantId, seed, success: false, error: err.message });
				}
			}

			const applied = results.filter(r => r.success).length;
			const failed = results.filter(r => !r.success).length;

			if (logActivity) {
				logActivity('ai_seeding_applied', req.session?.username || 'system', {
					tournamentId,
					seedsApplied: applied,
					seedsFailed: failed,
					source: 'ai'
				});
			}

			res.json({
				success: true,
				results,
				applied,
				failed,
				message: `Applied ${applied} seeds${failed > 0 ? `, ${failed} failed` : ''}`
			});
		} catch (error) {
			logger.error('aiSeeding:apply', error, { tournamentId: req.params.tournamentId });
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

module.exports = router;
module.exports.init = init;
