/**
 * Bracket Canvas Rendering Module
 * Renders tournament brackets on HTML5 Canvas with zoom/pan support
 */
const BracketCanvas = (function() {
	'use strict';

	// Constants from bracket-renderer.js
	const MATCH_WIDTH = 220;
	const MATCH_HEIGHT = 60;
	const MATCH_SPACING_V = 30;
	const ROUND_SPACING = 80;
	const PADDING = 50;
	const PLAYER_HEIGHT = MATCH_HEIGHT / 2;

	// Theme Definitions
	const THEMES = {
		midnight: {
			name: 'Midnight',
			description: 'Professional esports aesthetic',
			background: '#111827',
			matchBg: '#1f2937',
			matchBgHover: '#374151',
			matchBorder: '#4b5563',
			matchBorderHighlight: '#f59e0b',
			text: '#ffffff',
			textMuted: '#9ca3af',
			textSecondary: '#d1d5db',
			seed: '#3b82f6',
			seedChanged: '#f59e0b',
			bye: '#4b5563',
			byeBorder: '#6b7280',
			connector: '#4b5563',
			winner: '#22c55e',
			roundHeader: '#6b7280'
		},
		arctic: {
			name: 'Arctic Light',
			description: 'Clean, bright theme for well-lit venues',
			background: '#f8fafc',
			matchBg: '#ffffff',
			matchBgHover: '#f1f5f9',
			matchBorder: '#cbd5e1',
			matchBorderHighlight: '#f59e0b',
			text: '#1e293b',
			textMuted: '#64748b',
			textSecondary: '#475569',
			seed: '#0ea5e9',
			seedChanged: '#f59e0b',
			bye: '#e2e8f0',
			byeBorder: '#94a3b8',
			connector: '#94a3b8',
			winner: '#059669',
			roundHeader: '#475569'
		},
		neon: {
			name: 'Neon Arcade',
			description: 'Vibrant cyberpunk/retro gaming',
			background: '#0f0f1a',
			matchBg: '#1a1a2e',
			matchBgHover: '#252542',
			matchBorder: '#e94560',
			matchBorderHighlight: '#ff00ff',
			text: '#eaeaea',
			textMuted: '#8b8b9e',
			textSecondary: '#b8b8cc',
			seed: '#00d9ff',
			seedChanged: '#ff00ff',
			bye: '#16213e',
			byeBorder: '#e94560',
			connector: '#e94560',
			winner: '#00ff88',
			roundHeader: '#e94560'
		},
		royal: {
			name: 'Royal Tournament',
			description: 'Classic gold/navy sports feel',
			background: '#0c1929',
			matchBg: '#132743',
			matchBgHover: '#1a3a5c',
			matchBorder: '#d4af37',
			matchBorderHighlight: '#ffd700',
			text: '#f5f5f5',
			textMuted: '#8fa3bf',
			textSecondary: '#b8c9dc',
			seed: '#d4af37',
			seedChanged: '#ff6b35',
			bye: '#1a3a5c',
			byeBorder: '#d4af37',
			connector: '#d4af37',
			winner: '#50c878',
			roundHeader: '#d4af37'
		},
		forest: {
			name: 'Forest',
			description: 'Nature-inspired, calming green tones',
			background: '#1a2f1a',
			matchBg: '#243524',
			matchBgHover: '#2d4a2d',
			matchBorder: '#4a7c4a',
			matchBorderHighlight: '#7fff00',
			text: '#e8f5e8',
			textMuted: '#8fbc8f',
			textSecondary: '#a8d8a8',
			seed: '#32cd32',
			seedChanged: '#ffa500',
			bye: '#2d4a2d',
			byeBorder: '#4a7c4a',
			connector: '#4a7c4a',
			winner: '#7fff00',
			roundHeader: '#6b8e6b'
		}
	};

	// Current theme (dynamic)
	let currentThemeId = 'midnight';
	let COLORS = { ...THEMES.midnight };

	/**
	 * Set the active theme
	 * @param {string} themeId - Theme identifier (midnight, arctic, neon, royal, forest)
	 */
	function setTheme(themeId) {
		if (THEMES[themeId]) {
			currentThemeId = themeId;
			COLORS = { ...THEMES[themeId] };
			localStorage.setItem('bracketTheme', themeId);
			// Re-render if canvas is initialized
			if (canvas && state.visualization) {
				render(state.visualization);
			}
		}
	}

	/**
	 * Get the current theme ID
	 * @returns {string} Current theme identifier
	 */
	function getTheme() {
		return currentThemeId;
	}

	/**
	 * Get all available themes
	 * @returns {Object} All theme definitions
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

	// State
	let canvas = null;
	let ctx = null;
	let state = {
		visualization: null,
		participants: [],
		currentSeeds: new Map(),
		originalSeeds: new Map(),
		zoom: 1,
		panX: 0,
		panY: 0,
		isPanning: false,
		lastMouseX: 0,
		lastMouseY: 0,
		canvasWidth: 800,
		canvasHeight: 600,
		// Drag-drop state
		playerSlots: [],       // Array of {x, y, width, height, participantId, seed}
		dragState: {
			isDragging: false,
			sourceSlot: null,  // The slot being dragged
			currentX: 0,
			currentY: 0,
			hoverSlot: null    // Slot being hovered over
		},
		onSwapCallback: null,  // Callback when players are swapped
		readOnly: false        // When true, disable drag-drop editing
	};

	/**
	 * Initialize canvas
	 */
	function init() {
		// Load saved theme preference
		loadTheme();

		canvas = document.getElementById('bracketCanvas');
		if (!canvas) return;

		ctx = canvas.getContext('2d');
		bindCanvasEvents();
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

		// Touch events for mobile
		canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
		canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
		canvas.addEventListener('touchend', handleTouchEnd);
	}

	/**
	 * Render bracket visualization
	 */
	function render(visualization, participants, currentSeeds, originalSeeds) {
		if (!canvas || !ctx) init();
		if (!canvas) return;

		state.visualization = visualization;
		state.participants = participants || [];
		state.currentSeeds = currentSeeds || new Map();
		state.originalSeeds = originalSeeds || new Map();
		state.playerSlots = []; // Clear slots on re-render

		// Calculate canvas size based on bracket structure
		const dims = calculateDimensions(visualization);
		state.canvasWidth = dims.width;
		state.canvasHeight = dims.height;

		// Set canvas size
		const container = document.getElementById('bracketContainer');
		const containerWidth = container ? container.clientWidth : 800;
		const containerHeight = container ? container.clientHeight - 10 : 600;

		canvas.width = Math.max(dims.width, containerWidth);
		canvas.height = Math.max(dims.height, containerHeight);

		draw();
	}

	/**
	 * Set callback for when players are swapped
	 */
	function setSwapCallback(callback) {
		state.onSwapCallback = callback;
	}

	/**
	 * Set read-only mode (disables drag-drop editing)
	 */
	function setReadOnly(readOnly) {
		state.readOnly = readOnly;
	}

	/**
	 * Calculate bracket dimensions based on structure
	 */
	function calculateDimensions(viz) {
		if (!viz) return { width: 800, height: 600 };

		let width = PADDING * 2;
		let height = PADDING * 2;

		if (viz.type === 'single_elimination' && viz.rounds) {
			const numRounds = viz.rounds.length;
			const firstRoundMatches = viz.rounds[0]?.matches?.length || 1;

			width = PADDING * 2 + numRounds * (MATCH_WIDTH + ROUND_SPACING);
			height = PADDING * 2 + firstRoundMatches * (MATCH_HEIGHT + MATCH_SPACING_V);

			// Add space for 3rd place match
			if (viz.thirdPlaceMatch) {
				height += MATCH_HEIGHT + MATCH_SPACING_V + 40;
			}
		} else if (viz.type === 'double_elimination') {
			const winnersRounds = viz.winners?.rounds?.length || 0;
			const losersRounds = viz.losers?.rounds?.length || 0;
			const firstWinnersMatches = viz.winners?.rounds?.[0]?.matches?.length || 1;
			const firstLosersMatches = viz.losers?.rounds?.[0]?.matches?.length || 1;

			width = PADDING * 2 + (winnersRounds + 2) * (MATCH_WIDTH + ROUND_SPACING);
			const winnersHeight = firstWinnersMatches * (MATCH_HEIGHT + MATCH_SPACING_V);
			const losersHeight = firstLosersMatches * (MATCH_HEIGHT + MATCH_SPACING_V);
			height = PADDING * 2 + winnersHeight + 80 + losersHeight + 100;
		} else if (viz.type === 'round_robin' || viz.type === 'swiss') {
			const numRounds = viz.rounds?.length || 0;
			let matchCount = 0;
			viz.rounds?.forEach(r => { matchCount += r.matches?.length || 0; });
			const rows = Math.ceil(matchCount / 3);
			width = PADDING * 2 + 3 * (MATCH_WIDTH + 20);
			height = PADDING * 2 + numRounds * 40 + rows * (MATCH_HEIGHT + 15);
		}

		return { width: Math.max(width, 800), height: Math.max(height, 600) };
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

		// Update zoom display
		const zoomDisplay = document.getElementById('zoomLevel');
		if (zoomDisplay) {
			zoomDisplay.textContent = `${Math.round(state.zoom * 100)}%`;
		}
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
			const matchesInRound = round.matches.length;
			const roundX = PADDING + roundIndex * (MATCH_WIDTH + ROUND_SPACING);

			// Draw round header
			ctx.fillStyle = COLORS.roundHeader;
			ctx.font = 'bold 14px Inter, sans-serif';
			ctx.fillText(round.name || `Round ${round.round}`, roundX, PADDING - 15);

			// Calculate vertical spacing for this round
			// Each subsequent round should be vertically centered relative to its feeder matches
			const firstRoundMatches = rounds[0].matches.length;
			const baseSpacing = (MATCH_HEIGHT + MATCH_SPACING_V);
			const roundSpacing = baseSpacing * Math.pow(2, roundIndex);
			const roundOffset = (roundSpacing - MATCH_HEIGHT) / 2;

			round.matches.forEach((match, matchIndex) => {
				const y = PADDING + roundOffset + matchIndex * roundSpacing;
				drawMatch(match, roundX, y, roundIndex, totalRounds);

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

		// Draw 3rd place match if exists
		if (viz.thirdPlaceMatch) {
			const thirdPlaceY = canvas.height / state.zoom - PADDING - MATCH_HEIGHT - 20;
			const thirdPlaceX = PADDING + (totalRounds - 1) * (MATCH_WIDTH + ROUND_SPACING);

			ctx.fillStyle = COLORS.roundHeader;
			ctx.font = 'bold 14px Inter, sans-serif';
			ctx.fillText('3rd Place Match', thirdPlaceX, thirdPlaceY - 15);

			drawMatch(viz.thirdPlaceMatch, thirdPlaceX, thirdPlaceY, 0, 1);
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
			ctx.font = 'bold 16px Inter, sans-serif';
			ctx.fillText('Winners Bracket', PADDING, PADDING - 25);

			const winnersRounds = viz.winners.rounds;
			winnersRounds.forEach((round, roundIndex) => {
				const roundX = PADDING + roundIndex * (MATCH_WIDTH + ROUND_SPACING);

				// Round header
				ctx.fillStyle = COLORS.roundHeader;
				ctx.font = '12px Inter, sans-serif';
				ctx.fillText(round.name || `W${round.round}`, roundX, PADDING - 5);

				const firstRoundMatches = winnersRounds[0].matches.length;
				const baseSpacing = (MATCH_HEIGHT + MATCH_SPACING_V);
				const roundSpacing = baseSpacing * Math.pow(2, roundIndex);
				const roundOffset = (roundSpacing - MATCH_HEIGHT) / 2;

				round.matches.forEach((match, matchIndex) => {
					const y = PADDING + roundOffset + matchIndex * roundSpacing;
					drawMatch(match, roundX, y, roundIndex, winnersRounds.length);

					// Draw connector
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
		const losersStartY = PADDING + winnersHeight + 60;

		// Draw losers bracket
		if (viz.losers && viz.losers.rounds) {
			ctx.fillStyle = COLORS.text;
			ctx.font = 'bold 16px Inter, sans-serif';
			ctx.fillText('Losers Bracket', PADDING, losersStartY - 25);

			const losersRounds = viz.losers.rounds;
			losersRounds.forEach((round, roundIndex) => {
				const roundX = PADDING + roundIndex * (MATCH_WIDTH + ROUND_SPACING) / 2;

				// Round header
				ctx.fillStyle = COLORS.roundHeader;
				ctx.font = '12px Inter, sans-serif';
				ctx.fillText(round.name || `L${round.round}`, roundX, losersStartY - 5);

				round.matches.forEach((match, matchIndex) => {
					const y = losersStartY + matchIndex * (MATCH_HEIGHT + MATCH_SPACING_V / 2);
					drawMatch(match, roundX, y, roundIndex, losersRounds.length);
				});
			});
		}

		// Draw grand finals
		if (viz.grandFinals && viz.grandFinals.length > 0) {
			const gfX = PADDING + ((viz.winners?.rounds?.length || 4) + 0.5) * (MATCH_WIDTH + ROUND_SPACING);
			const gfY = PADDING + (winnersHeight / 2) - MATCH_HEIGHT;

			ctx.fillStyle = COLORS.text;
			ctx.font = 'bold 14px Inter, sans-serif';
			ctx.fillText('Grand Finals', gfX, gfY - 15);

			viz.grandFinals.forEach((match, index) => {
				const matchY = gfY + index * (MATCH_HEIGHT + MATCH_SPACING_V);
				drawMatch(match, gfX, matchY, 0, 1);

				if (index === 0 && viz.grandFinals.length > 1) {
					ctx.fillStyle = COLORS.textMuted;
					ctx.font = '10px Inter, sans-serif';
					ctx.fillText('Reset (if needed)', gfX, matchY + MATCH_HEIGHT + MATCH_SPACING_V - 5);
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
			// Round header
			ctx.fillStyle = COLORS.text;
			ctx.font = 'bold 14px Inter, sans-serif';
			ctx.fillText(`Round ${roundIndex + 1}`, PADDING, y);
			y += 25;

			// Draw matches in grid
			const matchesPerRow = 3;
			round.matches.forEach((match, matchIndex) => {
				const col = matchIndex % matchesPerRow;
				const row = Math.floor(matchIndex / matchesPerRow);
				const x = PADDING + col * (MATCH_WIDTH + 20);
				const matchY = y + row * (MATCH_HEIGHT + 15);

				drawMatch(match, x, matchY, 0, 1);
			});

			const rows = Math.ceil(round.matches.length / matchesPerRow);
			y += rows * (MATCH_HEIGHT + 15) + 30;
		});
	}

	/**
	 * Draw Swiss rounds
	 */
	function drawSwiss() {
		// Similar to round robin
		drawRoundRobin();
	}

	/**
	 * Draw a single match box
	 */
	function drawMatch(match, x, y, roundIndex, totalRounds) {
		const isBye = match.isBye || (!match.player1?.id && !match.player2?.id);
		const isFirstRound = roundIndex === 0; // First round matches are draggable

		// Match background
		ctx.fillStyle = isBye ? COLORS.bye : COLORS.matchBg;
		ctx.strokeStyle = isBye ? COLORS.byeBorder : COLORS.matchBorder;
		ctx.lineWidth = 1;

		roundRect(ctx, x, y, MATCH_WIDTH, MATCH_HEIGHT, 4);
		ctx.fill();
		ctx.stroke();

		// Player 1 (top half)
		drawPlayer(match.player1, x, y, match.winnerId, isFirstRound, isBye);

		// Divider line
		ctx.strokeStyle = COLORS.matchBorder;
		ctx.beginPath();
		ctx.moveTo(x, y + PLAYER_HEIGHT);
		ctx.lineTo(x + MATCH_WIDTH, y + PLAYER_HEIGHT);
		ctx.stroke();

		// Player 2 (bottom half)
		drawPlayer(match.player2, x, y + PLAYER_HEIGHT, match.winnerId, isFirstRound, isBye);

		// Match identifier badge
		if (match.identifier) {
			ctx.fillStyle = COLORS.textMuted;
			ctx.font = '9px JetBrains Mono, monospace';
			ctx.textAlign = 'right';
			ctx.fillText(match.identifier, x + MATCH_WIDTH - 5, y + 11);
			ctx.textAlign = 'left';
		}
	}

	/**
	 * Draw player row within match
	 * @param {Object} player - Player object
	 * @param {number} x - X position
	 * @param {number} y - Y position
	 * @param {number} winnerId - Winner's participant ID
	 * @param {boolean} isFirstRound - Whether this is a first-round match (draggable)
	 * @param {boolean} isBye - Whether this match is a BYE match
	 */
	function drawPlayer(player, x, y, winnerId, isFirstRound = false, isBye = false) {
		// Check for empty slot (no player object or player with no ID)
		if (!player || !player.id) {
			// Leave future match slots blank - no "BYE" or "TBD" text
			return;
		}

		const participantId = player.id;
		const seed = participantId ? state.currentSeeds.get(participantId) : player.seed;
		const originalSeed = participantId ? state.originalSeeds.get(participantId) : player.seed;
		const seedChanged = seed !== originalSeed;
		const isWinner = winnerId && participantId === winnerId;
		const name = player.name || 'TBD';

		// Check if this slot is being dragged or hovered
		const isDragSource = state.dragState.isDragging &&
			state.dragState.sourceSlot?.participantId === participantId;
		const isHoverTarget = state.dragState.isDragging &&
			state.dragState.hoverSlot?.participantId === participantId;

		// Record slot position for hit detection (only for first-round matches with real participants)
		if (isFirstRound && participantId && name !== 'BYE') {
			state.playerSlots.push({
				x: x,
				y: y,
				width: MATCH_WIDTH,
				height: PLAYER_HEIGHT,
				participantId: participantId,
				seed: seed,
				name: name
			});
		}

		// Highlight hover target
		if (isHoverTarget && !isDragSource) {
			ctx.fillStyle = COLORS.matchBorderHighlight;
			ctx.globalAlpha = 0.3;
			roundRect(ctx, x + 2, y + 2, MATCH_WIDTH - 4, PLAYER_HEIGHT - 4, 2);
			ctx.fill();
			ctx.globalAlpha = 1;
		}

		// Dim the source slot while dragging
		if (isDragSource) {
			ctx.globalAlpha = 0.4;
		}

		// Seed badge
		if (seed) {
			ctx.fillStyle = seedChanged ? COLORS.seedChanged : COLORS.seed;
			roundRect(ctx, x + 5, y + 5, 22, 20, 3);
			ctx.fill();

			ctx.fillStyle = COLORS.text;
			ctx.font = 'bold 10px JetBrains Mono, monospace';
			ctx.textAlign = 'center';
			ctx.fillText(seed.toString(), x + 16, y + 18);
			ctx.textAlign = 'left';
		}

		// Player name
		ctx.fillStyle = isWinner ? COLORS.winner : COLORS.text;
		ctx.font = `${isWinner ? 'bold ' : ''}12px Inter, sans-serif`;

		const nameX = seed ? x + 32 : x + 8;
		const maxWidth = MATCH_WIDTH - nameX - 35;

		// Truncate name if needed
		let displayName = name;
		while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
			displayName = displayName.slice(0, -4) + '...';
		}

		ctx.fillText(displayName, nameX, y + 19);

		// Score if exists - with visual divider
		if (player.score !== undefined && player.score !== null) {
			// Draw score background box for visual separation
			const scoreBoxWidth = 28;
			const scoreBoxX = x + MATCH_WIDTH - scoreBoxWidth - 4;
			ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
			roundRect(ctx, scoreBoxX, y + 4, scoreBoxWidth, PLAYER_HEIGHT - 8, 3);
			ctx.fill();

			// Draw score text
			ctx.fillStyle = isWinner ? COLORS.winner : COLORS.textSecondary;
			ctx.font = 'bold 12px JetBrains Mono, monospace';
			ctx.textAlign = 'center';
			ctx.fillText(player.score.toString(), scoreBoxX + scoreBoxWidth / 2, y + 19);
			ctx.textAlign = 'left';
		}

		// Reset alpha if it was dimmed
		if (isDragSource) {
			ctx.globalAlpha = 1;
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

	/**
	 * Convert screen coordinates to canvas coordinates (accounting for pan/zoom)
	 */
	function screenToCanvas(screenX, screenY) {
		const rect = canvas.getBoundingClientRect();
		const x = (screenX - rect.left - state.panX) / state.zoom;
		const y = (screenY - rect.top - state.panY) / state.zoom;
		return { x, y };
	}

	/**
	 * Find player slot at given canvas coordinates
	 */
	function findSlotAtPosition(canvasX, canvasY) {
		for (const slot of state.playerSlots) {
			if (canvasX >= slot.x && canvasX <= slot.x + slot.width &&
				canvasY >= slot.y && canvasY <= slot.y + slot.height) {
				return slot;
			}
		}
		return null;
	}

	/**
	 * Draw the drag preview overlay
	 */
	function drawDragPreview() {
		if (!state.dragState.isDragging || !state.dragState.sourceSlot) return;

		const slot = state.dragState.sourceSlot;
		const canvasPos = screenToCanvas(state.dragState.currentX, state.dragState.currentY);

		// Draw semi-transparent preview of the dragged player
		ctx.save();

		// Apply pan/zoom
		ctx.translate(state.panX, state.panY);
		ctx.scale(state.zoom, state.zoom);

		// Draw at cursor position (centered)
		const previewX = canvasPos.x - MATCH_WIDTH / 2;
		const previewY = canvasPos.y - PLAYER_HEIGHT / 2;

		// Background
		ctx.globalAlpha = 0.9;
		ctx.fillStyle = COLORS.matchBg;
		ctx.strokeStyle = COLORS.matchBorderHighlight;
		ctx.lineWidth = 2;
		roundRect(ctx, previewX, previewY, MATCH_WIDTH, PLAYER_HEIGHT, 4);
		ctx.fill();
		ctx.stroke();

		// Seed badge
		ctx.globalAlpha = 1;
		ctx.fillStyle = COLORS.seedChanged;
		roundRect(ctx, previewX + 5, previewY + 5, 22, 20, 3);
		ctx.fill();

		ctx.fillStyle = COLORS.text;
		ctx.font = 'bold 10px JetBrains Mono, monospace';
		ctx.textAlign = 'center';
		ctx.fillText(slot.seed?.toString() || '?', previewX + 16, previewY + 18);
		ctx.textAlign = 'left';

		// Name
		ctx.fillStyle = COLORS.text;
		ctx.font = '12px Inter, sans-serif';
		ctx.fillText(slot.name, previewX + 32, previewY + 19);

		ctx.restore();
	}

	// Pan/Zoom handlers
	function handleMouseDown(e) {
		const canvasPos = screenToCanvas(e.clientX, e.clientY);
		const slot = findSlotAtPosition(canvasPos.x, canvasPos.y);

		if (slot && !state.readOnly) {
			// Start drag-drop (only if not read-only)
			state.dragState.isDragging = true;
			state.dragState.sourceSlot = slot;
			state.dragState.currentX = e.clientX;
			state.dragState.currentY = e.clientY;
			state.dragState.hoverSlot = null;
			canvas.classList.add('dragging');
			draw();
		} else {
			// Start panning
			state.isPanning = true;
			state.lastMouseX = e.clientX;
			state.lastMouseY = e.clientY;
			canvas.style.cursor = 'grabbing';
		}
	}

	function handleMouseMove(e) {
		const canvasPos = screenToCanvas(e.clientX, e.clientY);

		if (state.dragState.isDragging) {
			// Update drag position
			state.dragState.currentX = e.clientX;
			state.dragState.currentY = e.clientY;

			// Check for hover over other slots
			const hoverSlot = findSlotAtPosition(canvasPos.x, canvasPos.y);

			// Only hover if it's a different slot than source
			if (hoverSlot && hoverSlot.participantId !== state.dragState.sourceSlot.participantId) {
				state.dragState.hoverSlot = hoverSlot;
			} else {
				state.dragState.hoverSlot = null;
			}

			// Redraw with drag preview
			draw();
			drawDragPreview();
		} else if (state.isPanning) {
			// Handle panning
			const dx = e.clientX - state.lastMouseX;
			const dy = e.clientY - state.lastMouseY;

			state.panX += dx;
			state.panY += dy;

			state.lastMouseX = e.clientX;
			state.lastMouseY = e.clientY;

			draw();
		} else {
			// Update cursor based on hover
			const slot = findSlotAtPosition(canvasPos.x, canvasPos.y);
			if (slot) {
				canvas.classList.add('hovering-slot');
			} else {
				canvas.classList.remove('hovering-slot');
			}
		}
	}

	function handleMouseUp(e) {
		if (state.dragState.isDragging) {
			// Complete the swap if hovering over a valid target
			if (state.dragState.hoverSlot && state.onSwapCallback) {
				const sourceId = state.dragState.sourceSlot.participantId;
				const targetId = state.dragState.hoverSlot.participantId;
				state.onSwapCallback(sourceId, targetId);
			}

			// Reset drag state
			state.dragState.isDragging = false;
			state.dragState.sourceSlot = null;
			state.dragState.hoverSlot = null;
			canvas.classList.remove('dragging');
			draw();
		}

		if (state.isPanning) {
			state.isPanning = false;
			canvas.style.cursor = 'default';
		}
	}

	function handleWheel(e) {
		e.preventDefault();

		const delta = e.deltaY > 0 ? 0.9 : 1.1;
		const newZoom = Math.max(0.25, Math.min(3, state.zoom * delta));

		// Zoom toward mouse position
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
	let touchStartTime = 0;

	function handleTouchStart(e) {
		if (e.touches.length === 1) {
			e.preventDefault();
			touchStartX = e.touches[0].clientX;
			touchStartY = e.touches[0].clientY;
			touchStartTime = Date.now();

			const canvasPos = screenToCanvas(touchStartX, touchStartY);
			const slot = findSlotAtPosition(canvasPos.x, canvasPos.y);

			if (slot && !state.readOnly) {
				// Start drag-drop on touch (only if not read-only)
				state.dragState.isDragging = true;
				state.dragState.sourceSlot = slot;
				state.dragState.currentX = touchStartX;
				state.dragState.currentY = touchStartY;
				state.dragState.hoverSlot = null;
				canvas.classList.add('dragging');
				draw();
			} else {
				// Start panning
				state.isPanning = true;
				state.lastMouseX = touchStartX;
				state.lastMouseY = touchStartY;
			}
		}
	}

	function handleTouchMove(e) {
		if (e.touches.length === 1) {
			e.preventDefault();
			const touchX = e.touches[0].clientX;
			const touchY = e.touches[0].clientY;
			const canvasPos = screenToCanvas(touchX, touchY);

			if (state.dragState.isDragging) {
				// Update drag position
				state.dragState.currentX = touchX;
				state.dragState.currentY = touchY;

				// Check for hover over other slots
				const hoverSlot = findSlotAtPosition(canvasPos.x, canvasPos.y);
				if (hoverSlot && hoverSlot.participantId !== state.dragState.sourceSlot.participantId) {
					state.dragState.hoverSlot = hoverSlot;
				} else {
					state.dragState.hoverSlot = null;
				}

				draw();
				drawDragPreview();
			} else if (state.isPanning) {
				const dx = touchX - state.lastMouseX;
				const dy = touchY - state.lastMouseY;

				state.panX += dx;
				state.panY += dy;

				state.lastMouseX = touchX;
				state.lastMouseY = touchY;

				draw();
			}
		}
	}

	function handleTouchEnd(e) {
		if (state.dragState.isDragging) {
			// Complete the swap if hovering over a valid target
			if (state.dragState.hoverSlot && state.onSwapCallback) {
				const sourceId = state.dragState.sourceSlot.participantId;
				const targetId = state.dragState.hoverSlot.participantId;
				state.onSwapCallback(sourceId, targetId);
			}

			// Reset drag state
			state.dragState.isDragging = false;
			state.dragState.sourceSlot = null;
			state.dragState.hoverSlot = null;
			canvas.classList.remove('dragging');
			draw();
		}

		state.isPanning = false;
	}

	function zoomIn() {
		state.zoom = Math.min(3, state.zoom * 1.2);
		draw();
	}

	function zoomOut() {
		state.zoom = Math.max(0.25, state.zoom / 1.2);
		draw();
	}

	function resetZoom() {
		state.zoom = 1;
		state.panX = 0;
		state.panY = 0;
		draw();
	}

	// Public API
	return {
		init,
		render,
		clear,
		draw,
		zoomIn,
		zoomOut,
		resetZoom,
		setTheme,
		getTheme,
		getThemes,
		setSwapCallback,
		setReadOnly
	};
})();
