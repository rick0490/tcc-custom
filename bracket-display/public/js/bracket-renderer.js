/**
 * Bracket Renderer for Fullscreen Display
 * Renders tournament brackets on HTML5 Canvas with zoom/pan support
 * Optimized for TV/projector display
 */
const BracketRenderer = (function() {
	'use strict';

	// Constants - scaled up for TV visibility
	const MATCH_WIDTH = 280;
	const MATCH_HEIGHT = 80;
	const MATCH_SPACING_V = 40;
	const ROUND_SPACING = 120;
	const PADDING = 80;
	const PLAYER_HEIGHT = MATCH_HEIGHT / 2;

	// Theme Definitions
	const THEMES = {
		midnight: {
			name: 'Midnight',
			description: 'Professional esports aesthetic',
			background: '#0a0f1a',
			matchBg: '#1a2332',
			matchBgHover: '#243040',
			matchBorder: '#3d4f63',
			matchBorderHighlight: '#f59e0b',
			text: '#ffffff',
			textMuted: '#8896a8',
			textSecondary: '#c8d4e0',
			seed: '#3b82f6',
			seedChanged: '#f59e0b',
			bye: '#2a3545',
			byeBorder: '#4a5d73',
			connector: '#3d4f63',
			winner: '#22c55e',
			roundHeader: '#6b7f96',
			underway: '#ef4444'
		},
		arctic: {
			name: 'Arctic Light',
			description: 'Clean, bright theme for well-lit venues',
			background: '#e8eef5',
			matchBg: '#ffffff',
			matchBgHover: '#f0f4f8',
			matchBorder: '#b0c4d8',
			matchBorderHighlight: '#f59e0b',
			text: '#1a2940',
			textMuted: '#5a7088',
			textSecondary: '#3a5068',
			seed: '#0ea5e9',
			seedChanged: '#f59e0b',
			bye: '#d8e4f0',
			byeBorder: '#8aa8c8',
			connector: '#8aa8c8',
			winner: '#059669',
			roundHeader: '#4a6888',
			underway: '#dc2626'
		},
		neon: {
			name: 'Neon Arcade',
			description: 'Vibrant cyberpunk/retro gaming',
			background: '#080810',
			matchBg: '#151525',
			matchBgHover: '#202038',
			matchBorder: '#e94560',
			matchBorderHighlight: '#ff00ff',
			text: '#f0f0f8',
			textMuted: '#7878a0',
			textSecondary: '#b0b0d0',
			seed: '#00d9ff',
			seedChanged: '#ff00ff',
			bye: '#101828',
			byeBorder: '#e94560',
			connector: '#e94560',
			winner: '#00ff88',
			roundHeader: '#e94560',
			underway: '#ff0066'
		},
		royal: {
			name: 'Royal Tournament',
			description: 'Classic gold/navy sports feel',
			background: '#0a1525',
			matchBg: '#102040',
			matchBgHover: '#183058',
			matchBorder: '#d4af37',
			matchBorderHighlight: '#ffd700',
			text: '#f8f8f8',
			textMuted: '#7890b0',
			textSecondary: '#a8c0d8',
			seed: '#d4af37',
			seedChanged: '#ff6b35',
			bye: '#152845',
			byeBorder: '#d4af37',
			connector: '#d4af37',
			winner: '#50c878',
			roundHeader: '#d4af37',
			underway: '#ff4040'
		},
		forest: {
			name: 'Forest',
			description: 'Nature-inspired, calming green tones',
			background: '#0f1f0f',
			matchBg: '#182818',
			matchBgHover: '#203520',
			matchBorder: '#3a6a3a',
			matchBorderHighlight: '#7fff00',
			text: '#e0f0e0',
			textMuted: '#70a070',
			textSecondary: '#98c898',
			seed: '#32cd32',
			seedChanged: '#ffa500',
			bye: '#203020',
			byeBorder: '#3a6a3a',
			connector: '#3a6a3a',
			winner: '#7fff00',
			roundHeader: '#5a8a5a',
			underway: '#ff5050'
		}
	};

	// Current theme
	let currentThemeId = 'midnight';
	let COLORS = { ...THEMES.midnight };

	// State
	let canvas = null;
	let ctx = null;
	let state = {
		visualization: null,
		matches: [],
		participants: [],
		customLabels: null,  // Custom round labels { winners: { "1": "Label" }, losers: { "1": "Label" } }
		zoom: 1,
		panX: 0,
		panY: 0,
		isPanning: false,
		lastMouseX: 0,
		lastMouseY: 0,
		canvasWidth: 1920,
		canvasHeight: 1080,
		debugMode: false,
		autoFit: true
	};

	/**
	 * Set the active theme
	 */
	function setTheme(themeId) {
		if (THEMES[themeId]) {
			currentThemeId = themeId;
			COLORS = { ...THEMES[themeId] };
			localStorage.setItem('bracketTheme', themeId);
			if (canvas && state.visualization) {
				draw();
			}
		}
	}

	/**
	 * Get the current theme ID
	 */
	function getTheme() {
		return currentThemeId;
	}

	/**
	 * Get all available themes
	 */
	function getThemes() {
		return THEMES;
	}

	/**
	 * Load theme from localStorage
	 */
	function loadTheme() {
		const saved = localStorage.getItem('bracketTheme') || 'midnight';
		if (THEMES[saved]) {
			currentThemeId = saved;
			COLORS = { ...THEMES[saved] };
		}
	}

	/**
	 * Enable debug logging
	 */
	function setDebugMode(enabled) {
		state.debugMode = enabled;
	}

	/**
	 * Log message if debug mode is enabled
	 */
	function log(action, data = {}) {
		if (state.debugMode) {
			console.log(`%c[BracketRenderer] ${action}`, 'color: #22c55e', data);
		}
	}

	/**
	 * Initialize canvas
	 */
	function init(canvasId = 'bracket-canvas') {
		loadTheme();

		canvas = document.getElementById(canvasId);
		if (!canvas) {
			console.error('[BracketRenderer] Canvas not found:', canvasId);
			return false;
		}

		ctx = canvas.getContext('2d');
		bindCanvasEvents();
		resizeCanvas();

		window.addEventListener('resize', resizeCanvas);

		log('init', { canvas: canvasId, theme: currentThemeId });
		return true;
	}

	/**
	 * Resize canvas to fill container
	 */
	function resizeCanvas() {
		if (!canvas) return;

		const container = canvas.parentElement;
		if (container) {
			canvas.width = container.clientWidth || window.innerWidth;
			canvas.height = container.clientHeight || window.innerHeight;
		} else {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
		}

		if (state.visualization) {
			if (state.autoFit) {
				fitBracket();
			} else {
				draw();
			}
		}
	}

	/**
	 * Bind canvas mouse events for pan/zoom
	 */
	function bindCanvasEvents() {
		if (!canvas) return;

		canvas.addEventListener('mousedown', handleMouseDown);
		canvas.addEventListener('mousemove', handleMouseMove);
		canvas.addEventListener('mouseup', handleMouseUp);
		canvas.addEventListener('mouseleave', handleMouseUp);
		canvas.addEventListener('wheel', handleWheel, { passive: false });

		// Touch events
		canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
		canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
		canvas.addEventListener('touchend', handleTouchEnd);
	}

	/**
	 * Render bracket visualization
	 * @param {Object} tournamentOrViz - Either a tournament object or pre-built visualization
	 * @param {Array} matches - Array of match objects
	 * @param {Array} participants - Array of participant objects
	 */
	function render(tournamentOrViz, matches, participants) {
		if (!canvas || !ctx) {
			if (!init()) return;
		}

		state.matches = matches || [];
		state.participants = participants || [];

		// Detect if first param is raw tournament data (has tournament_type/tournamentType)
		// vs a pre-built visualization (has type and rounds/winners structure)
		let visualization;
		if (tournamentOrViz && (tournamentOrViz.tournament_type || tournamentOrViz.tournamentType)) {
			// Build visualization from raw tournament data
			visualization = buildVisualization(tournamentOrViz, state.matches, state.participants);
			log('render:built', {
				format: tournamentOrViz.tournament_type || tournamentOrViz.tournamentType,
				type: visualization?.type,
				matchCount: state.matches.length
			});
		} else {
			// Use as pre-built visualization
			visualization = tournamentOrViz;
		}

		state.visualization = visualization;

		log('render', {
			type: visualization?.type,
			matchCount: state.matches.length,
			participantCount: state.participants.length
		});

		// Calculate canvas size based on bracket structure
		const dims = calculateDimensions(visualization);
		state.canvasWidth = dims.width;
		state.canvasHeight = dims.height;

		if (state.autoFit) {
			fitBracket();
		} else {
			draw();
		}
	}

	/**
	 * Build visualization from raw tournament data
	 */
	function buildVisualization(tournament, matches, participants) {
		const type = tournament.tournament_type || tournament.tournamentType || 'single_elimination';

		// Build participant map and list sorted by seed
		const participantMap = {};
		const sortedParticipants = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));
		participants.forEach(p => {
			participantMap[p.id] = {
				id: p.id,
				name: p.name || p.display_name || p.displayName || 'TBD',
				seed: p.seed
			};
		});

		log('buildVisualization', { type, matchCount: matches.length, participantCount: participants.length });

		// If no matches exist but we have at least 2 participants, generate preview bracket
		if (matches.length === 0 && participants.length >= 2) {
			return buildPreviewVisualization(type, sortedParticipants, participantMap);
		}

		switch (type) {
			case 'double_elimination':
				return buildDoubleElimVisualization(matches, participantMap);
			case 'round_robin':
				return buildRoundRobinVisualization(matches, participantMap);
			case 'swiss':
				return buildSwissVisualization(matches, participantMap);
			default:
				return buildSingleElimVisualization(matches, participantMap);
		}
	}

	/**
	 * Build preview visualization when tournament hasn't started
	 * Shows participants in their seeded positions
	 */
	function buildPreviewVisualization(type, sortedParticipants, participantMap) {
		const n = sortedParticipants.length;
		log('buildPreviewVisualization', { type, participantCount: n });

		if (type === 'round_robin') {
			return buildRoundRobinPreview(sortedParticipants, participantMap);
		} else if (type === 'swiss') {
			return buildSwissPreview(sortedParticipants, participantMap);
		} else if (type === 'double_elimination') {
			return buildDoubleElimPreview(sortedParticipants, participantMap);
		} else {
			return buildSingleElimPreview(sortedParticipants, participantMap);
		}
	}

	/**
	 * Build single elimination preview bracket
	 */
	function buildSingleElimPreview(sortedParticipants, participantMap) {
		const n = sortedParticipants.length;
		// Calculate bracket size (next power of 2)
		const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
		const totalRounds = Math.ceil(Math.log2(bracketSize));
		const round1Matches = bracketSize / 2;

		// Generate seeding pairs (1 vs N, 2 vs N-1, etc.)
		const matches = [];
		for (let i = 0; i < round1Matches; i++) {
			const seed1 = i + 1;
			const seed2 = bracketSize - i;
			const p1 = sortedParticipants[seed1 - 1];
			const p2 = sortedParticipants[seed2 - 1];

			matches.push({
				id: `preview-${i + 1}`,
				round: 1,
				state: 'pending',
				player1: p1 ? { id: p1.id, name: p1.name || p1.display_name || 'TBD', seed: seed1 } : { name: 'BYE', seed: seed1 },
				player2: p2 ? { id: p2.id, name: p2.name || p2.display_name || 'TBD', seed: seed2 } : { name: 'BYE', seed: seed2 }
			});
		}

		// Build remaining rounds with TBD placeholders
		const roundsArray = [{
			name: getRoundName(1, 'single_elimination', totalRounds, state.customLabels),
			matches: matches
		}];

		let matchesInRound = round1Matches / 2;
		for (let r = 2; r <= totalRounds; r++) {
			const roundMatches = [];
			for (let i = 0; i < matchesInRound; i++) {
				roundMatches.push({
					id: `preview-r${r}-${i + 1}`,
					round: r,
					state: 'pending',
					player1: { name: 'TBD' },
					player2: { name: 'TBD' }
				});
			}
			roundsArray.push({
				name: getRoundName(r, 'single_elimination', totalRounds, state.customLabels),
				matches: roundMatches
			});
			matchesInRound = matchesInRound / 2;
		}

		return {
			type: 'single_elimination',
			rounds: roundsArray,
			thirdPlaceMatch: null,
			stats: {
				totalMatches: bracketSize - 1,
				completedMatches: 0,
				totalRounds: totalRounds
			},
			preview: true
		};
	}

	/**
	 * Build double elimination preview bracket
	 */
	function buildDoubleElimPreview(sortedParticipants, participantMap) {
		const n = sortedParticipants.length;
		const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
		const totalWinnersRounds = Math.ceil(Math.log2(bracketSize));
		const round1Matches = bracketSize / 2;

		// Generate winners round 1 with seeding
		const winnersRound1 = [];
		for (let i = 0; i < round1Matches; i++) {
			const seed1 = i + 1;
			const seed2 = bracketSize - i;
			const p1 = sortedParticipants[seed1 - 1];
			const p2 = sortedParticipants[seed2 - 1];

			winnersRound1.push({
				id: `preview-w1-${i + 1}`,
				round: 1,
				state: 'pending',
				player1: p1 ? { id: p1.id, name: p1.name || p1.display_name || 'TBD', seed: seed1 } : { name: 'BYE', seed: seed1 },
				player2: p2 ? { id: p2.id, name: p2.name || p2.display_name || 'TBD', seed: seed2 } : { name: 'BYE', seed: seed2 }
			});
		}

		// Build winners bracket rounds
		const winnersRounds = [{
			name: getRoundName(1, 'winners', totalWinnersRounds, state.customLabels),
			matches: winnersRound1
		}];

		let matchesInRound = round1Matches / 2;
		for (let r = 2; r <= totalWinnersRounds; r++) {
			const roundMatches = [];
			for (let i = 0; i < matchesInRound; i++) {
				roundMatches.push({
					id: `preview-w${r}-${i + 1}`,
					round: r,
					state: 'pending',
					player1: { name: 'TBD' },
					player2: { name: 'TBD' }
				});
			}
			winnersRounds.push({
				name: getRoundName(r, 'winners', totalWinnersRounds, state.customLabels),
				matches: roundMatches
			});
			matchesInRound = Math.max(1, matchesInRound / 2);
		}

		// Build losers bracket rounds (simplified TBD placeholders)
		const losersRounds = [];
		const totalLosersRounds = (totalWinnersRounds - 1) * 2;
		matchesInRound = round1Matches / 2;
		for (let r = 1; r <= totalLosersRounds; r++) {
			const roundMatches = [];
			const matchCount = r % 2 === 1 ? matchesInRound : matchesInRound;
			for (let i = 0; i < matchCount; i++) {
				roundMatches.push({
					id: `preview-l${r}-${i + 1}`,
					round: -r,
					state: 'pending',
					player1: { name: 'TBD' },
					player2: { name: 'TBD' }
				});
			}
			losersRounds.push({
				name: getRoundName(r, 'losers', totalLosersRounds, state.customLabels),
				matches: roundMatches
			});
			if (r % 2 === 0) matchesInRound = Math.max(1, matchesInRound / 2);
		}

		return {
			type: 'double_elimination',
			winnersRounds: winnersRounds,
			losersRounds: losersRounds,
			grandFinals: {
				id: 'preview-gf',
				round: 99,
				state: 'pending',
				player1: { name: 'TBD' },
				player2: { name: 'TBD' }
			},
			grandFinalsReset: null,
			stats: {
				totalMatches: 0,
				completedMatches: 0,
				winnersRounds: totalWinnersRounds,
				losersRounds: totalLosersRounds
			},
			preview: true
		};
	}

	/**
	 * Build round robin preview (just shows participant list)
	 */
	function buildRoundRobinPreview(sortedParticipants, participantMap) {
		return {
			type: 'round_robin',
			rounds: [{
				name: 'Participants',
				matches: sortedParticipants.map((p, i) => ({
					id: `preview-${i}`,
					round: 0,
					state: 'pending',
					player1: { id: p.id, name: p.name || p.display_name || 'TBD', seed: p.seed || i + 1 },
					player2: { name: '(Round Robin)' }
				}))
			}],
			standings: sortedParticipants.map((p, i) => ({
				participant: { id: p.id, name: p.name || p.display_name || 'TBD', seed: p.seed || i + 1 },
				wins: 0,
				losses: 0,
				ties: 0
			})),
			stats: {
				totalMatches: 0,
				completedMatches: 0,
				totalRounds: 0
			},
			preview: true
		};
	}

	/**
	 * Build swiss preview (just shows participant list)
	 */
	function buildSwissPreview(sortedParticipants, participantMap) {
		return {
			type: 'swiss',
			rounds: [{
				name: 'Participants',
				matches: sortedParticipants.map((p, i) => ({
					id: `preview-${i}`,
					round: 0,
					state: 'pending',
					player1: { id: p.id, name: p.name || p.display_name || 'TBD', seed: p.seed || i + 1 },
					player2: { name: '(Swiss)' }
				}))
			}],
			standings: sortedParticipants.map((p, i) => ({
				participant: { id: p.id, name: p.name || p.display_name || 'TBD', seed: p.seed || i + 1 },
				wins: 0,
				losses: 0,
				buchholz: 0
			})),
			stats: {
				totalMatches: 0,
				completedMatches: 0,
				totalRounds: 0
			},
			preview: true
		};
	}

	/**
	 * Build single elimination visualization
	 */
	function buildSingleElimVisualization(matches, participantMap) {
		const rounds = {};
		let maxRound = 0;

		// Separate main bracket from 3rd place match
		const mainMatches = matches.filter(m => m.identifier !== '3P');
		const thirdPlaceMatch = matches.find(m => m.identifier === '3P');

		mainMatches.forEach(m => {
			const round = m.round;
			if (!rounds[round]) rounds[round] = [];
			rounds[round].push(m);
			maxRound = Math.max(maxRound, round);
		});

		// Build rounds array
		const roundsArray = [];
		for (let r = 1; r <= maxRound; r++) {
			const roundMatches = rounds[r] || [];
			roundMatches.sort((a, b) => (a.suggested_play_order || a.suggestedPlayOrder || 0) - (b.suggested_play_order || b.suggestedPlayOrder || 0));
			roundsArray.push({
				name: getRoundName(r, 'single_elimination', maxRound, state.customLabels),
				matches: roundMatches.map(m => formatMatchForViz(m, participantMap))
			});
		}

		return {
			type: 'single_elimination',
			rounds: roundsArray,
			thirdPlaceMatch: thirdPlaceMatch ? formatMatchForViz(thirdPlaceMatch, participantMap) : null,
			stats: {
				totalMatches: matches.length,
				completedMatches: matches.filter(m => m.state === 'complete').length,
				totalRounds: maxRound
			}
		};
	}

	/**
	 * Build double elimination visualization
	 */
	function buildDoubleElimVisualization(matches, participantMap) {
		const winners = {};
		const losers = {};
		let grandFinals = null;
		let grandFinalsReset = null;
		let maxWinnersRound = 0;
		let maxLosersRound = 0;

		matches.forEach(m => {
			const round = m.round;
			if (round > 0) {
				if (!winners[round]) winners[round] = [];
				winners[round].push(m);
				maxWinnersRound = Math.max(maxWinnersRound, round);
			} else if (round < 0) {
				const losersRound = Math.abs(round);
				if (!losers[losersRound]) losers[losersRound] = [];
				losers[losersRound].push(m);
				maxLosersRound = Math.max(maxLosersRound, losersRound);
			}
		});

		// Check for grand finals (may be in winners bracket as final round)
		const winnersLastRound = winners[maxWinnersRound] || [];
		if (winnersLastRound.length === 1 && winnersLastRound[0].identifier === 'GF') {
			grandFinals = winnersLastRound[0];
			delete winners[maxWinnersRound];
			maxWinnersRound--;
		}

		// Build winners rounds
		const winnersRounds = [];
		for (let r = 1; r <= maxWinnersRound; r++) {
			const roundMatches = winners[r] || [];
			roundMatches.sort((a, b) => (a.suggested_play_order || 0) - (b.suggested_play_order || 0));
			winnersRounds.push({
				name: getRoundName(r, 'winners', maxWinnersRound, state.customLabels),
				matches: roundMatches.map(m => formatMatchForViz(m, participantMap))
			});
		}

		// Build losers rounds
		const losersRounds = [];
		for (let r = 1; r <= maxLosersRound; r++) {
			const roundMatches = losers[r] || [];
			roundMatches.sort((a, b) => (a.suggested_play_order || 0) - (b.suggested_play_order || 0));
			losersRounds.push({
				name: getRoundName(r, 'losers', maxLosersRound, state.customLabels),
				matches: roundMatches.map(m => formatMatchForViz(m, participantMap))
			});
		}

		return {
			type: 'double_elimination',
			winners: { rounds: winnersRounds },
			losers: { rounds: losersRounds },
			grandFinals: grandFinals ? formatMatchForViz(grandFinals, participantMap) : null,
			grandFinalsReset: grandFinalsReset ? formatMatchForViz(grandFinalsReset, participantMap) : null,
			stats: {
				totalMatches: matches.length,
				completedMatches: matches.filter(m => m.state === 'complete').length
			}
		};
	}

	/**
	 * Build round robin visualization
	 */
	function buildRoundRobinVisualization(matches, participantMap) {
		const rounds = {};
		let maxRound = 0;

		matches.forEach(m => {
			const round = m.round;
			if (!rounds[round]) rounds[round] = [];
			rounds[round].push(m);
			maxRound = Math.max(maxRound, round);
		});

		const roundsArray = [];
		for (let r = 1; r <= maxRound; r++) {
			const roundMatches = rounds[r] || [];
			roundMatches.sort((a, b) => (a.suggested_play_order || 0) - (b.suggested_play_order || 0));
			roundsArray.push({
				name: `Round ${r}`,
				matches: roundMatches.map(m => formatMatchForViz(m, participantMap))
			});
		}

		return {
			type: 'round_robin',
			rounds: roundsArray,
			stats: {
				totalMatches: matches.length,
				completedMatches: matches.filter(m => m.state === 'complete').length
			}
		};
	}

	/**
	 * Build swiss visualization
	 */
	function buildSwissVisualization(matches, participantMap) {
		const rounds = {};
		let maxRound = 0;

		matches.forEach(m => {
			const round = m.round;
			if (!rounds[round]) rounds[round] = [];
			rounds[round].push(m);
			maxRound = Math.max(maxRound, round);
		});

		const roundsArray = [];
		for (let r = 1; r <= maxRound; r++) {
			const roundMatches = rounds[r] || [];
			roundMatches.sort((a, b) => (a.suggested_play_order || 0) - (b.suggested_play_order || 0));
			roundsArray.push({
				name: `Swiss Round ${r}`,
				matches: roundMatches.map(m => formatMatchForViz(m, participantMap))
			});
		}

		return {
			type: 'swiss',
			rounds: roundsArray,
			stats: {
				totalMatches: matches.length,
				completedMatches: matches.filter(m => m.state === 'complete').length
			}
		};
	}

	/**
	 * Format a match for visualization
	 */
	function formatMatchForViz(match, participantMap) {
		const player1Id = match.player1_id || match.player1Id;
		const player2Id = match.player2_id || match.player2Id;
		const winnerId = match.winner_id || match.winnerId;

		return {
			id: match.id,
			identifier: match.identifier,
			round: match.round,
			state: match.state,
			player1: participantMap[player1Id] || { id: player1Id, name: 'TBD', seed: null },
			player2: participantMap[player2Id] || { id: player2Id, name: 'TBD', seed: null },
			winner: winnerId ? participantMap[winnerId] : null,
			player1Score: match.player1_score || match.player1Score,
			player2Score: match.player2_score || match.player2Score,
			isBye: !player2Id && player1Id,
			underwayAt: match.underway_at || match.underwayAt,
			completedAt: match.completed_at || match.completedAt
		};
	}

	/**
	 * Get round name based on format and round number
	 * @param {number} round - Round number
	 * @param {string} format - 'single_elimination', 'double_elimination', 'winners', or 'losers'
	 * @param {number} totalRounds - Total rounds in bracket
	 * @param {Object} customLabels - Optional custom labels { winners: { "1": "Label" }, losers: { "1": "Label" } }
	 */
	function getRoundName(round, format, totalRounds, customLabels = null) {
		// Check for custom label first
		const bracketType = (format === 'losers') ? 'losers' : 'winners';
		if (customLabels && customLabels[bracketType] && customLabels[bracketType][round.toString()]) {
			return customLabels[bracketType][round.toString()];
		}

		// Default behavior for losers bracket
		if (format === 'losers') {
			return `Losers Round ${round}`;
		}

		// Default behavior for winners/single elimination
		if (format === 'single_elimination' || format === 'winners' || format === 'double_elimination') {
			const remaining = totalRounds - round + 1;
			if (remaining === 1) return 'Finals';
			if (remaining === 2) return 'Semi-Finals';
			if (remaining === 3) return 'Quarter-Finals';
		}

		return `Round ${round}`;
	}

	/**
	 * Fit bracket to screen
	 */
	function fitBracket() {
		if (!canvas || !state.visualization) return;

		const dims = calculateDimensions(state.visualization);
		const scaleX = (canvas.width - 100) / dims.width;
		const scaleY = (canvas.height - 100) / dims.height;
		const scale = Math.min(scaleX, scaleY, 1.5);

		state.zoom = Math.max(0.2, Math.min(scale, 2.0));
		state.panX = (canvas.width - dims.width * state.zoom) / 2;
		state.panY = (canvas.height - dims.height * state.zoom) / 2;

		draw();
	}

	/**
	 * Calculate bracket dimensions based on structure
	 */
	function calculateDimensions(viz) {
		if (!viz) return { width: 1920, height: 1080 };

		let width = PADDING * 2;
		let height = PADDING * 2;

		if (viz.type === 'single_elimination' && viz.rounds) {
			const numRounds = viz.rounds.length;
			const firstRoundMatches = viz.rounds[0]?.matches?.length || 1;

			width = PADDING * 2 + numRounds * (MATCH_WIDTH + ROUND_SPACING);
			height = PADDING * 2 + firstRoundMatches * (MATCH_HEIGHT + MATCH_SPACING_V);

			if (viz.thirdPlaceMatch) {
				height += MATCH_HEIGHT + MATCH_SPACING_V + 60;
			}
		} else if (viz.type === 'double_elimination') {
			const winnersRounds = viz.winners?.rounds?.length || 0;
			const firstWinnersMatches = viz.winners?.rounds?.[0]?.matches?.length || 1;
			const firstLosersMatches = viz.losers?.rounds?.[0]?.matches?.length || 1;

			width = PADDING * 2 + (winnersRounds + 2) * (MATCH_WIDTH + ROUND_SPACING);
			const winnersHeight = firstWinnersMatches * (MATCH_HEIGHT + MATCH_SPACING_V);
			const losersHeight = firstLosersMatches * (MATCH_HEIGHT + MATCH_SPACING_V);
			height = PADDING * 2 + winnersHeight + 100 + losersHeight + 120;
		} else if (viz.type === 'round_robin' || viz.type === 'swiss') {
			const numRounds = viz.rounds?.length || 0;
			let matchCount = 0;
			viz.rounds?.forEach(r => { matchCount += r.matches?.length || 0; });
			const rows = Math.ceil(matchCount / 3);
			width = PADDING * 2 + 3 * (MATCH_WIDTH + 30);
			height = PADDING * 2 + numRounds * 60 + rows * (MATCH_HEIGHT + 20);
		}

		return { width: Math.max(width, 1200), height: Math.max(height, 800) };
	}

	/**
	 * Main draw function
	 */
	function draw() {
		if (!ctx || !state.visualization) return;

		// Clear canvas
		ctx.fillStyle = COLORS.background;
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// Apply transforms
		ctx.save();
		ctx.translate(state.panX, state.panY);
		ctx.scale(state.zoom, state.zoom);

		// Draw based on format
		const format = state.visualization.type;

		if (format === 'double_elimination') {
			drawDoubleElimination();
		} else if (format === 'round_robin') {
			drawRoundRobin();
		} else if (format === 'swiss') {
			drawSwiss();
		} else {
			drawSingleElimination();
		}

		ctx.restore();
	}

	/**
	 * Draw single elimination bracket
	 */
	function drawSingleElimination() {
		const viz = state.visualization;
		if (!viz.rounds) return;

		const rounds = viz.rounds;
		const totalRounds = rounds.length;

		rounds.forEach((round, roundIndex) => {
			const roundX = PADDING + roundIndex * (MATCH_WIDTH + ROUND_SPACING);

			// Round header
			ctx.fillStyle = COLORS.roundHeader;
			ctx.font = 'bold 18px Oswald, sans-serif';
			ctx.fillText(round.name || `Round ${round.round}`, roundX, PADDING - 20);

			// Calculate vertical spacing
			const baseSpacing = (MATCH_HEIGHT + MATCH_SPACING_V);
			const roundSpacing = baseSpacing * Math.pow(2, roundIndex);
			const roundOffset = (roundSpacing - MATCH_HEIGHT) / 2;

			round.matches.forEach((match, matchIndex) => {
				const y = PADDING + roundOffset + matchIndex * roundSpacing;
				drawMatch(match, roundX, y);

				// Draw connector to next round
				if (roundIndex < totalRounds - 1) {
					const nextMatchIndex = Math.floor(matchIndex / 2);
					const isTopMatch = matchIndex % 2 === 0;
					const nextRoundSpacing = roundSpacing * 2;
					const nextRoundOffset = (nextRoundSpacing - MATCH_HEIGHT) / 2;
					const nextY = PADDING + nextRoundOffset + nextMatchIndex * nextRoundSpacing;

					drawConnector(
						roundX + MATCH_WIDTH,
						y + MATCH_HEIGHT / 2,
						roundX + MATCH_WIDTH + ROUND_SPACING,
						nextY + MATCH_HEIGHT / 2,
						isTopMatch
					);
				}
			});
		});

		// Draw 3rd place match
		if (viz.thirdPlaceMatch) {
			const thirdPlaceY = state.canvasHeight - PADDING - MATCH_HEIGHT - 40;
			const thirdPlaceX = PADDING + (totalRounds - 1) * (MATCH_WIDTH + ROUND_SPACING);

			ctx.fillStyle = COLORS.roundHeader;
			ctx.font = 'bold 18px Oswald, sans-serif';
			ctx.fillText('3rd Place Match', thirdPlaceX, thirdPlaceY - 20);

			drawMatch(viz.thirdPlaceMatch, thirdPlaceX, thirdPlaceY);
		}
	}

	/**
	 * Draw double elimination bracket
	 */
	function drawDoubleElimination() {
		const viz = state.visualization;

		// Draw winners bracket
		if (viz.winners && viz.winners.rounds) {
			ctx.fillStyle = COLORS.text;
			ctx.font = 'bold 24px Oswald, sans-serif';
			ctx.fillText('WINNERS BRACKET', PADDING, PADDING - 35);

			const winnersRounds = viz.winners.rounds;
			winnersRounds.forEach((round, roundIndex) => {
				const roundX = PADDING + roundIndex * (MATCH_WIDTH + ROUND_SPACING);

				ctx.fillStyle = COLORS.roundHeader;
				ctx.font = '14px Inter, sans-serif';
				ctx.fillText(round.name || `W${round.round}`, roundX, PADDING - 10);

				const baseSpacing = (MATCH_HEIGHT + MATCH_SPACING_V);
				const roundSpacing = baseSpacing * Math.pow(2, roundIndex);
				const roundOffset = (roundSpacing - MATCH_HEIGHT) / 2;

				round.matches.forEach((match, matchIndex) => {
					const y = PADDING + roundOffset + matchIndex * roundSpacing;
					drawMatch(match, roundX, y);

					if (roundIndex < winnersRounds.length - 1) {
						const nextMatchIndex = Math.floor(matchIndex / 2);
						const isTopMatch = matchIndex % 2 === 0;
						const nextRoundSpacing = roundSpacing * 2;
						const nextRoundOffset = (nextRoundSpacing - MATCH_HEIGHT) / 2;
						const nextY = PADDING + nextRoundOffset + nextMatchIndex * nextRoundSpacing;

						drawConnector(
							roundX + MATCH_WIDTH,
							y + MATCH_HEIGHT / 2,
							roundX + MATCH_WIDTH + ROUND_SPACING,
							nextY + MATCH_HEIGHT / 2,
							isTopMatch
						);
					}
				});
			});
		}

		// Calculate losers bracket starting Y
		const winnersMatches = viz.winners?.rounds?.[0]?.matches?.length || 4;
		const winnersHeight = winnersMatches * (MATCH_HEIGHT + MATCH_SPACING_V);
		const losersStartY = PADDING + winnersHeight + 80;

		// Draw losers bracket
		if (viz.losers && viz.losers.rounds) {
			ctx.fillStyle = COLORS.text;
			ctx.font = 'bold 24px Oswald, sans-serif';
			ctx.fillText('LOSERS BRACKET', PADDING, losersStartY - 35);

			const losersRounds = viz.losers.rounds;
			losersRounds.forEach((round, roundIndex) => {
				const roundX = PADDING + roundIndex * (MATCH_WIDTH + ROUND_SPACING) / 2;

				ctx.fillStyle = COLORS.roundHeader;
				ctx.font = '14px Inter, sans-serif';
				ctx.fillText(round.name || `L${round.round}`, roundX, losersStartY - 10);

				round.matches.forEach((match, matchIndex) => {
					const y = losersStartY + matchIndex * (MATCH_HEIGHT + MATCH_SPACING_V / 2);
					drawMatch(match, roundX, y);
				});
			});
		}

		// Draw grand finals
		if (viz.grandFinals && viz.grandFinals.length > 0) {
			const gfX = PADDING + ((viz.winners?.rounds?.length || 4) + 0.5) * (MATCH_WIDTH + ROUND_SPACING);
			const gfY = PADDING + (winnersHeight / 2) - MATCH_HEIGHT;

			ctx.fillStyle = COLORS.text;
			ctx.font = 'bold 20px Oswald, sans-serif';
			ctx.fillText('GRAND FINALS', gfX, gfY - 20);

			viz.grandFinals.forEach((match, index) => {
				const matchY = gfY + index * (MATCH_HEIGHT + MATCH_SPACING_V);
				drawMatch(match, gfX, matchY);

				if (index === 0 && viz.grandFinals.length > 1) {
					ctx.fillStyle = COLORS.textMuted;
					ctx.font = '12px Inter, sans-serif';
					ctx.fillText('Reset (if needed)', gfX, matchY + MATCH_HEIGHT + MATCH_SPACING_V - 8);
				}
			});
		}
	}

	/**
	 * Draw round robin grid
	 */
	function drawRoundRobin() {
		const viz = state.visualization;
		if (!viz.rounds) return;

		let y = PADDING;

		viz.rounds.forEach((round, roundIndex) => {
			ctx.fillStyle = COLORS.text;
			ctx.font = 'bold 20px Oswald, sans-serif';
			ctx.fillText(`ROUND ${roundIndex + 1}`, PADDING, y);
			y += 35;

			const matchesPerRow = 3;
			round.matches.forEach((match, matchIndex) => {
				const col = matchIndex % matchesPerRow;
				const row = Math.floor(matchIndex / matchesPerRow);
				const x = PADDING + col * (MATCH_WIDTH + 30);
				const matchY = y + row * (MATCH_HEIGHT + 20);

				drawMatch(match, x, matchY);
			});

			const rows = Math.ceil(round.matches.length / matchesPerRow);
			y += rows * (MATCH_HEIGHT + 20) + 40;
		});
	}

	/**
	 * Draw Swiss rounds
	 */
	function drawSwiss() {
		drawRoundRobin();
	}

	/**
	 * Draw a single match box
	 */
	function drawMatch(match, x, y) {
		const isBye = match.isBye || (!match.player1 && !match.player2);
		const isUnderway = match.state === 'underway';
		const isComplete = match.state === 'complete';

		// Match background with state colors
		let bgColor = COLORS.matchBg;
		let borderColor = COLORS.matchBorder;

		if (isBye) {
			bgColor = COLORS.bye;
			borderColor = COLORS.byeBorder;
		} else if (isUnderway) {
			borderColor = COLORS.underway;
		} else if (isComplete && match.winnerId) {
			borderColor = COLORS.winner;
		}

		ctx.fillStyle = bgColor;
		ctx.strokeStyle = borderColor;
		ctx.lineWidth = isUnderway ? 3 : 2;

		roundRect(ctx, x, y, MATCH_WIDTH, MATCH_HEIGHT, 6);
		ctx.fill();
		ctx.stroke();

		// Player 1 (top half)
		drawPlayer(match.player1, x, y, match.winnerId);

		// Divider line
		ctx.strokeStyle = COLORS.matchBorder;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x, y + PLAYER_HEIGHT);
		ctx.lineTo(x + MATCH_WIDTH, y + PLAYER_HEIGHT);
		ctx.stroke();

		// Player 2 (bottom half)
		drawPlayer(match.player2, x, y + PLAYER_HEIGHT, match.winnerId);

		// Match identifier badge
		if (match.identifier) {
			ctx.fillStyle = COLORS.textMuted;
			ctx.font = '11px JetBrains Mono, monospace';
			ctx.textAlign = 'right';
			ctx.fillText(match.identifier, x + MATCH_WIDTH - 8, y + 14);
			ctx.textAlign = 'left';
		}

		// Underway indicator
		if (isUnderway) {
			ctx.fillStyle = COLORS.underway;
			ctx.beginPath();
			ctx.arc(x + 12, y + MATCH_HEIGHT / 2, 4, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	/**
	 * Draw player row within match
	 */
	function drawPlayer(player, x, y, winnerId) {
		if (!player) {
			ctx.fillStyle = COLORS.textMuted;
			ctx.font = 'italic 14px Inter, sans-serif';
			ctx.fillText('TBD', x + 10, y + 24);
			return;
		}

		const isWinner = winnerId && player.id === winnerId;
		const name = player.name || 'TBD';
		const seed = player.seed;

		// Seed badge
		if (seed) {
			ctx.fillStyle = COLORS.seed;
			roundRect(ctx, x + 8, y + 8, 28, 24, 4);
			ctx.fill();

			ctx.fillStyle = COLORS.text;
			ctx.font = 'bold 12px JetBrains Mono, monospace';
			ctx.textAlign = 'center';
			ctx.fillText(seed.toString(), x + 22, y + 24);
			ctx.textAlign = 'left';
		}

		// Player name
		ctx.fillStyle = isWinner ? COLORS.winner : COLORS.text;
		ctx.font = `${isWinner ? 'bold ' : ''}14px Inter, sans-serif`;

		const nameX = seed ? x + 44 : x + 10;
		const maxWidth = MATCH_WIDTH - nameX - 45;

		let displayName = name;
		while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
			displayName = displayName.slice(0, -4) + '...';
		}

		ctx.fillText(displayName, nameX, y + 24);

		// Score
		if (player.score !== undefined && player.score !== null) {
			ctx.fillStyle = isWinner ? COLORS.winner : COLORS.textSecondary;
			ctx.font = 'bold 14px JetBrains Mono, monospace';
			ctx.textAlign = 'right';
			ctx.fillText(player.score.toString(), x + MATCH_WIDTH - 10, y + 24);
			ctx.textAlign = 'left';
		}
	}

	/**
	 * Draw connector line between matches
	 */
	function drawConnector(fromX, fromY, toX, toY, isTopMatch) {
		ctx.strokeStyle = COLORS.connector;
		ctx.lineWidth = 2;

		const midX = fromX + (toX - fromX) / 2;

		ctx.beginPath();
		ctx.moveTo(fromX, fromY);
		ctx.lineTo(midX, fromY);
		ctx.lineTo(midX, toY);
		ctx.lineTo(toX, toY);
		ctx.stroke();
	}

	/**
	 * Draw rounded rectangle
	 */
	function roundRect(ctx, x, y, width, height, radius) {
		ctx.beginPath();
		ctx.moveTo(x + radius, y);
		ctx.lineTo(x + width - radius, y);
		ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
		ctx.lineTo(x + width, y + height - radius);
		ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
		ctx.lineTo(x + radius, y + height);
		ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
		ctx.lineTo(x, y + radius);
		ctx.quadraticCurveTo(x, y, x + radius, y);
		ctx.closePath();
	}

	/**
	 * Clear canvas
	 */
	function clear() {
		if (!ctx) return;

		state.visualization = null;
		ctx.fillStyle = COLORS.background;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}

	// Mouse handlers for pan
	function handleMouseDown(e) {
		state.isPanning = true;
		state.lastMouseX = e.clientX;
		state.lastMouseY = e.clientY;
		canvas.style.cursor = 'grabbing';
		state.autoFit = false;
	}

	function handleMouseMove(e) {
		if (!state.isPanning) return;

		const dx = e.clientX - state.lastMouseX;
		const dy = e.clientY - state.lastMouseY;

		state.panX += dx;
		state.panY += dy;

		state.lastMouseX = e.clientX;
		state.lastMouseY = e.clientY;

		draw();
	}

	function handleMouseUp() {
		state.isPanning = false;
		canvas.style.cursor = 'grab';
	}

	function handleWheel(e) {
		e.preventDefault();
		state.autoFit = false;

		const delta = e.deltaY > 0 ? 0.9 : 1.1;
		const newZoom = Math.max(0.2, Math.min(3, state.zoom * delta));

		const rect = canvas.getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		state.panX = mouseX - (mouseX - state.panX) * (newZoom / state.zoom);
		state.panY = mouseY - (mouseY - state.panY) * (newZoom / state.zoom);
		state.zoom = newZoom;

		draw();
	}

	// Touch handlers
	let touchStartX = 0;
	let touchStartY = 0;

	function handleTouchStart(e) {
		if (e.touches.length === 1) {
			e.preventDefault();
			touchStartX = e.touches[0].clientX;
			touchStartY = e.touches[0].clientY;
			state.isPanning = true;
			state.lastMouseX = touchStartX;
			state.lastMouseY = touchStartY;
			state.autoFit = false;
		}
	}

	function handleTouchMove(e) {
		if (e.touches.length === 1 && state.isPanning) {
			e.preventDefault();
			const touchX = e.touches[0].clientX;
			const touchY = e.touches[0].clientY;

			const dx = touchX - state.lastMouseX;
			const dy = touchY - state.lastMouseY;

			state.panX += dx;
			state.panY += dy;

			state.lastMouseX = touchX;
			state.lastMouseY = touchY;

			draw();
		}
	}

	function handleTouchEnd() {
		state.isPanning = false;
	}

	/**
	 * Set custom round labels
	 * @param {Object} labels - Custom labels { winners: { "1": "Label" }, losers: { "1": "Label" } }
	 */
	function setCustomLabels(labels) {
		state.customLabels = labels || null;
		log('setCustomLabels', { labels: state.customLabels });
		// Re-render if visualization exists
		if (state.visualization && state.matches.length > 0) {
			// Re-build visualization with new labels
			const tournament = { tournamentType: state.visualization.type };
			render(tournament, state.matches, state.participants);
		}
	}

	/**
	 * Get current custom labels
	 */
	function getCustomLabels() {
		return state.customLabels;
	}

	/**
	 * Zoom controls
	 */
	function setZoom(zoomLevel) {
		state.zoom = Math.max(0.2, Math.min(3, zoomLevel));
		state.autoFit = false;
		draw();
	}

	function zoomIn() {
		setZoom(state.zoom * 1.2);
	}

	function zoomOut() {
		setZoom(state.zoom / 1.2);
	}

	function resetView() {
		state.autoFit = true;
		fitBracket();
	}

	function getZoom() {
		return state.zoom;
	}

	// Public API
	return {
		init,
		render,
		clear,
		draw,
		setZoom,
		zoomIn,
		zoomOut,
		resetView,
		getZoom,
		fitBracket,
		setTheme,
		getTheme,
		getThemes,
		setCustomLabels,
		getCustomLabels,
		setDebugMode,
		resizeCanvas
	};
})();

// Export for use
window.BracketRenderer = BracketRenderer;
