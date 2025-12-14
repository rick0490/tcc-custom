/**
 * Bracket Renderer Service
 *
 * Generates visualization data for tournament brackets.
 * Supports single elimination, double elimination, round robin, and swiss formats.
 * Replaces Challonge iframe with native bracket rendering.
 */

const bracketEngine = require('./bracket-engine');

/**
 * Generate bracket visualization data for a tournament
 *
 * @param {string} type - Tournament type
 * @param {Array} matches - All tournament matches
 * @param {Array} participants - All participants
 * @param {Object} options - Additional options
 * @returns {Object} Visualization data structure
 */
function generateVisualization(type, matches, participants, options = {}) {
	const participantMap = {};
	participants.forEach(p => {
		participantMap[p.id] = {
			id: p.id,
			name: p.name || p.display_name || 'TBD',
			seed: p.seed
		};
	});

	switch (type) {
		case 'single_elimination':
			return generateSingleElimVisualization(matches, participantMap, options);

		case 'double_elimination':
			return generateDoubleElimVisualization(matches, participantMap, options);

		case 'round_robin':
			return generateRoundRobinVisualization(matches, participantMap, options);

		case 'swiss':
			return generateSwissVisualization(matches, participantMap, options);

		default:
			return generateSingleElimVisualization(matches, participantMap, options);
	}
}

/**
 * Generate single elimination bracket visualization
 */
function generateSingleElimVisualization(matches, participantMap, options) {
	// Group matches by round
	const rounds = {};
	let maxRound = 0;

	// Separate main bracket from 3rd place match
	const mainMatches = matches.filter(m => m.identifier !== '3P');
	const thirdPlaceMatch = matches.find(m => m.identifier === '3P');

	mainMatches.forEach(m => {
		const round = m.round;
		if (!rounds[round]) {
			rounds[round] = [];
		}
		maxRound = Math.max(maxRound, round);
	});

	// Build bracket structure
	const bracket = {
		type: 'single_elimination',
		rounds: [],
		thirdPlaceMatch: null,
		stats: {
			totalMatches: matches.length,
			completedMatches: matches.filter(m => m.state === 'complete').length,
			totalRounds: maxRound
		}
	};

	// Process each round
	const customLabels = options.customLabels || null;
	for (let r = 1; r <= maxRound; r++) {
		const roundMatches = mainMatches
			.filter(m => m.round === r)
			.sort((a, b) => (a.bracket_position || 0) - (b.bracket_position || 0));

		const roundData = {
			round: r,
			name: getRoundName(r, maxRound, 'single', customLabels),
			matches: roundMatches.map(m => formatMatchForViz(m, participantMap))
		};

		bracket.rounds.push(roundData);
	}

	// Add 3rd place match if exists
	if (thirdPlaceMatch) {
		bracket.thirdPlaceMatch = formatMatchForViz(thirdPlaceMatch, participantMap);
	}

	return bracket;
}

/**
 * Generate double elimination bracket visualization
 */
function generateDoubleElimVisualization(matches, participantMap, options) {
	// Separate winners, losers, and grand finals
	const winnersMatches = matches.filter(m => !m.losers_bracket && !m.is_grand_finals);
	const losersMatches = matches.filter(m => m.losers_bracket);
	const grandFinalsMatches = matches.filter(m => m.is_grand_finals);

	// Group by round
	const winnersRounds = {};
	const losersRounds = {};
	let maxWinnersRound = 0;
	let minLosersRound = 0;

	winnersMatches.forEach(m => {
		const round = m.round;
		if (!winnersRounds[round]) winnersRounds[round] = [];
		winnersRounds[round].push(m);
		maxWinnersRound = Math.max(maxWinnersRound, round);
	});

	losersMatches.forEach(m => {
		const round = m.round; // Negative for losers bracket
		if (!losersRounds[round]) losersRounds[round] = [];
		losersRounds[round].push(m);
		minLosersRound = Math.min(minLosersRound, round);
	});

	const bracket = {
		type: 'double_elimination',
		winners: {
			name: 'Winners Bracket',
			rounds: []
		},
		losers: {
			name: 'Losers Bracket',
			rounds: []
		},
		grandFinals: [],
		stats: {
			totalMatches: matches.length,
			completedMatches: matches.filter(m => m.state === 'complete').length,
			winnersRounds: maxWinnersRound,
			losersRounds: Math.abs(minLosersRound)
		}
	};

	// Process winners bracket rounds
	const customLabels = options.customLabels || null;
	for (let r = 1; r <= maxWinnersRound; r++) {
		const roundMatches = (winnersRounds[r] || [])
			.sort((a, b) => (a.bracket_position || 0) - (b.bracket_position || 0));

		bracket.winners.rounds.push({
			round: r,
			name: getRoundName(r, maxWinnersRound, 'winners', customLabels),
			matches: roundMatches.map(m => formatMatchForViz(m, participantMap))
		});
	}

	// Process losers bracket rounds
	const maxLosersRound = Math.abs(minLosersRound);
	for (let r = -1; r >= minLosersRound; r--) {
		const roundMatches = (losersRounds[r] || [])
			.sort((a, b) => (a.bracket_position || 0) - (b.bracket_position || 0));

		bracket.losers.rounds.push({
			round: Math.abs(r),
			name: getRoundName(Math.abs(r), maxLosersRound, 'losers', customLabels),
			matches: roundMatches.map(m => formatMatchForViz(m, participantMap))
		});
	}

	// Process grand finals
	grandFinalsMatches
		.sort((a, b) => {
			if (a.is_grand_finals_reset && !b.is_grand_finals_reset) return 1;
			if (!a.is_grand_finals_reset && b.is_grand_finals_reset) return -1;
			return 0;
		})
		.forEach((m, index) => {
			const gfMatch = formatMatchForViz(m, participantMap);
			gfMatch.name = index === 0 ? 'Grand Finals' : 'Grand Finals Reset';
			bracket.grandFinals.push(gfMatch);
		});

	return bracket;
}

/**
 * Generate round robin visualization (standings + match grid)
 */
function generateRoundRobinVisualization(matches, participantMap, options) {
	const participants = Object.values(participantMap);

	// Calculate standings
	const standings = bracketEngine.roundRobin.calculateStandings(matches, participants, options);

	// Group matches by round
	const rounds = {};
	let maxRound = 0;

	matches.forEach(m => {
		const round = m.round;
		if (!rounds[round]) rounds[round] = [];
		rounds[round].push(m);
		maxRound = Math.max(maxRound, round);
	});

	// Build head-to-head matrix
	const h2hMatrix = {};
	participants.forEach(p => {
		h2hMatrix[p.id] = {};
	});

	matches.filter(m => m.state === 'complete').forEach(m => {
		if (m.player1_id && m.player2_id) {
			const p1Score = m.player1_score || 0;
			const p2Score = m.player2_score || 0;

			h2hMatrix[m.player1_id][m.player2_id] = {
				score: `${p1Score}-${p2Score}`,
				won: m.winner_id === m.player1_id
			};
			h2hMatrix[m.player2_id][m.player1_id] = {
				score: `${p2Score}-${p1Score}`,
				won: m.winner_id === m.player2_id
			};
		}
	});

	return {
		type: 'round_robin',
		standings: standings.map((s, index) => ({
			rank: index + 1,
			participantId: s.participant_id,
			name: s.participant_name || participantMap[s.participant_id]?.name || 'Unknown',
			matchesPlayed: s.matches_played,
			wins: s.matches_won,
			losses: s.matches_lost,
			ties: s.matches_tied || 0,
			points: s.points,
			pointsDiff: s.points_difference || 0,
			buchholz: s.buchholz || 0
		})),
		rounds: Object.keys(rounds).sort((a, b) => a - b).map(r => ({
			round: parseInt(r),
			name: `Round ${r}`,
			matches: rounds[r].map(m => formatMatchForViz(m, participantMap))
		})),
		headToHead: h2hMatrix,
		stats: {
			totalMatches: matches.length,
			completedMatches: matches.filter(m => m.state === 'complete').length,
			totalRounds: maxRound,
			participantCount: participants.length
		}
	};
}

/**
 * Generate swiss system visualization (standings + round results)
 */
function generateSwissVisualization(matches, participantMap, options) {
	const participants = Object.values(participantMap);

	// Calculate current standings
	const standings = bracketEngine.swiss.calculateStandings(matches, participants);

	// Group matches by round
	const rounds = {};
	let maxRound = 0;

	matches.forEach(m => {
		const round = m.round;
		if (!rounds[round]) rounds[round] = [];
		rounds[round].push(m);
		maxRound = Math.max(maxRound, round);
	});

	// Check which rounds are complete
	const roundsComplete = {};
	for (let r = 1; r <= maxRound; r++) {
		roundsComplete[r] = bracketEngine.swiss.isRoundComplete(matches, r);
	}

	return {
		type: 'swiss',
		standings: standings.map(s => ({
			rank: s.rank,
			participantId: s.participant_id,
			name: s.participant?.name || participantMap[s.participant_id]?.name || 'Unknown',
			points: s.points,
			wins: s.wins,
			losses: s.losses,
			draws: s.draws,
			buchholz: s.buchholz,
			hadBye: s.hadBye
		})),
		rounds: Object.keys(rounds).sort((a, b) => a - b).map(r => ({
			round: parseInt(r),
			name: `Round ${r}`,
			complete: roundsComplete[parseInt(r)] || false,
			matches: rounds[r].map(m => formatMatchForViz(m, participantMap))
		})),
		currentRound: maxRound,
		stats: {
			totalMatches: matches.length,
			completedMatches: matches.filter(m => m.state === 'complete').length,
			totalRounds: options.totalRounds || maxRound,
			currentRound: maxRound,
			participantCount: participants.length
		}
	};
}

/**
 * Format a match for visualization
 */
function formatMatchForViz(match, participantMap) {
	const getPlayerName = (id) => {
		if (!id) return 'TBD';
		const p = participantMap[id];
		return p ? p.name : `Player ${id}`;
	};

	const getPlayerSeed = (id) => {
		if (!id) return null;
		const p = participantMap[id];
		return p ? p.seed : null;
	};

	return {
		id: match.id,
		identifier: match.identifier,
		round: match.round,
		position: match.bracket_position,
		state: match.state,
		player1: {
			id: match.player1_id,
			name: getPlayerName(match.player1_id),
			seed: getPlayerSeed(match.player1_id),
			score: match.player1_score,
			isWinner: match.winner_id === match.player1_id
		},
		player2: {
			id: match.player2_id,
			name: getPlayerName(match.player2_id),
			seed: getPlayerSeed(match.player2_id),
			score: match.player2_score,
			isWinner: match.winner_id === match.player2_id
		},
		winnerId: match.winner_id,
		loserId: match.loser_id,
		isBye: match.is_bye || false,
		underwayAt: match.underway_at,
		completedAt: match.completed_at,
		stationId: match.station_id,
		suggestedPlayOrder: match.suggested_play_order
	};
}

/**
 * Get round name based on position
 * @param {number} round - Round number
 * @param {number} maxRound - Maximum round in bracket
 * @param {string} bracketType - 'single', 'winners', or 'losers'
 * @param {Object} customLabels - Optional custom labels { winners: { "1": "Label", ... }, losers: { ... } }
 */
function getRoundName(round, maxRound, bracketType, customLabels = null) {
	// Check for custom label first
	const key = bracketType === 'losers' ? 'losers' : 'winners';
	if (customLabels && customLabels[key] && customLabels[key][round.toString()]) {
		return customLabels[key][round.toString()];
	}

	// Default behavior
	const roundsFromEnd = maxRound - round;

	if (bracketType === 'single' || bracketType === 'winners') {
		switch (roundsFromEnd) {
			case 0: return 'Finals';
			case 1: return 'Semi-Finals';
			case 2: return 'Quarter-Finals';
			default: return `Round ${round}`;
		}
	}

	return `Losers Round ${round}`;
}

/**
 * Calculate bracket dimensions for rendering
 */
function calculateBracketDimensions(bracket, options = {}) {
	const {
		matchWidth = 220,
		matchHeight = 60,
		matchSpacing = 30,
		roundSpacing = 50,
		startX = 20,
		startY = 20
	} = options;

	if (bracket.type === 'single_elimination') {
		const rounds = bracket.rounds.length;
		const firstRoundMatches = bracket.rounds[0]?.matches.length || 0;

		return {
			width: startX + (rounds * (matchWidth + roundSpacing)),
			height: startY + (firstRoundMatches * (matchHeight + matchSpacing)),
			matchWidth,
			matchHeight,
			matchSpacing,
			roundSpacing
		};
	}

	if (bracket.type === 'double_elimination') {
		const winnersRounds = bracket.winners.rounds.length;
		const losersRounds = bracket.losers.rounds.length;
		const maxRounds = Math.max(winnersRounds, losersRounds) + 1; // +1 for GF

		const winnersMatches = bracket.winners.rounds[0]?.matches.length || 0;
		const losersMatches = Math.ceil(winnersMatches / 2);

		return {
			width: startX + (maxRounds * (matchWidth + roundSpacing)) + 100,
			height: startY + ((winnersMatches + losersMatches + 2) * (matchHeight + matchSpacing)),
			matchWidth,
			matchHeight,
			matchSpacing,
			roundSpacing,
			winnersHeight: winnersMatches * (matchHeight + matchSpacing),
			losersStartY: startY + winnersMatches * (matchHeight + matchSpacing) + 50
		};
	}

	// Default dimensions for table-based formats
	return {
		width: 800,
		height: 600,
		matchWidth,
		matchHeight
	};
}

/**
 * Generate bracket SVG/Canvas positioning data
 */
function generatePositionData(bracket, options = {}) {
	const dimensions = calculateBracketDimensions(bracket, options);
	const positions = [];

	if (bracket.type === 'single_elimination') {
		bracket.rounds.forEach((round, roundIndex) => {
			const matchCount = round.matches.length;
			const verticalSpacing = dimensions.height / matchCount;

			round.matches.forEach((match, matchIndex) => {
				const x = dimensions.matchWidth * 0.5 + roundIndex * (dimensions.matchWidth + dimensions.roundSpacing);
				const y = (matchIndex + 0.5) * verticalSpacing;

				positions.push({
					matchId: match.id,
					x,
					y,
					width: dimensions.matchWidth,
					height: dimensions.matchHeight,
					round: round.round,
					position: matchIndex
				});
			});
		});
	}

	return {
		dimensions,
		positions,
		connections: generateConnections(bracket, positions)
	};
}

/**
 * Generate connection lines between matches
 */
function generateConnections(bracket, positions) {
	const connections = [];
	const positionMap = {};

	positions.forEach(p => {
		positionMap[p.matchId] = p;
	});

	if (bracket.type === 'single_elimination' || bracket.type === 'double_elimination') {
		// For each match, find its prerequisite matches and draw connections
		bracket.rounds?.forEach(round => {
			round.matches?.forEach(match => {
				if (match.player1_prereq_match_id && positionMap[match.player1_prereq_match_id]) {
					const from = positionMap[match.player1_prereq_match_id];
					const to = positionMap[match.id];
					if (from && to) {
						connections.push({
							fromMatchId: match.player1_prereq_match_id,
							toMatchId: match.id,
							fromX: from.x + from.width,
							fromY: from.y,
							toX: to.x,
							toY: to.y - (to.height / 4),
							type: 'winner'
						});
					}
				}

				if (match.player2_prereq_match_id && positionMap[match.player2_prereq_match_id]) {
					const from = positionMap[match.player2_prereq_match_id];
					const to = positionMap[match.id];
					if (from && to) {
						connections.push({
							fromMatchId: match.player2_prereq_match_id,
							toMatchId: match.id,
							fromX: from.x + from.width,
							fromY: from.y,
							toX: to.x,
							toY: to.y + (to.height / 4),
							type: 'winner'
						});
					}
				}
			});
		});
	}

	return connections;
}

/**
 * Export bracket as JSON for frontend rendering
 */
function exportForRendering(type, matches, participants, options = {}) {
	const visualization = generateVisualization(type, matches, participants, options);
	const positionData = generatePositionData(visualization, options);

	return {
		visualization,
		rendering: positionData,
		exportedAt: new Date().toISOString()
	};
}

module.exports = {
	generateVisualization,
	generateSingleElimVisualization,
	generateDoubleElimVisualization,
	generateRoundRobinVisualization,
	generateSwissVisualization,
	formatMatchForViz,
	getRoundName,
	calculateBracketDimensions,
	generatePositionData,
	generateConnections,
	exportForRendering
};
