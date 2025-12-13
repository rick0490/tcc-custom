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

	// Colors
	const COLORS = {
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
	};

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
		isDragging: false,
		lastMouseX: 0,
		lastMouseY: 0,
		canvasWidth: 800,
		canvasHeight: 600
	};

	/**
	 * Initialize canvas
	 */
	function init() {
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
		state.participants = participants;
		state.currentSeeds = currentSeeds;
		state.originalSeeds = originalSeeds;

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
		const isBye = match.isBye || (!match.player1 && !match.player2);

		// Match background
		ctx.fillStyle = isBye ? COLORS.bye : COLORS.matchBg;
		ctx.strokeStyle = isBye ? COLORS.byeBorder : COLORS.matchBorder;
		ctx.lineWidth = 1;

		roundRect(ctx, x, y, MATCH_WIDTH, MATCH_HEIGHT, 4);
		ctx.fill();
		ctx.stroke();

		// Player 1 (top half)
		drawPlayer(match.player1, x, y, match.winnerId);

		// Divider line
		ctx.strokeStyle = COLORS.matchBorder;
		ctx.beginPath();
		ctx.moveTo(x, y + PLAYER_HEIGHT);
		ctx.lineTo(x + MATCH_WIDTH, y + PLAYER_HEIGHT);
		ctx.stroke();

		// Player 2 (bottom half)
		drawPlayer(match.player2, x, y + PLAYER_HEIGHT, match.winnerId);

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
	 */
	function drawPlayer(player, x, y, winnerId) {
		if (!player) {
			// TBD slot
			ctx.fillStyle = COLORS.textMuted;
			ctx.font = 'italic 12px Inter, sans-serif';
			ctx.fillText('TBD', x + 8, y + 19);
			return;
		}

		const participantId = player.id;
		const seed = participantId ? state.currentSeeds.get(participantId) : player.seed;
		const originalSeed = participantId ? state.originalSeeds.get(participantId) : player.seed;
		const seedChanged = seed !== originalSeed;
		const isWinner = winnerId && participantId === winnerId;
		const name = player.name || 'TBD';

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

		// Score if exists
		if (player.score !== undefined && player.score !== null) {
			ctx.fillStyle = isWinner ? COLORS.winner : COLORS.textSecondary;
			ctx.font = 'bold 12px JetBrains Mono, monospace';
			ctx.textAlign = 'right';
			ctx.fillText(player.score.toString(), x + MATCH_WIDTH - 8, y + 19);
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

	// Pan/Zoom handlers
	function handleMouseDown(e) {
		state.isDragging = true;
		state.lastMouseX = e.clientX;
		state.lastMouseY = e.clientY;
		canvas.style.cursor = 'grabbing';
	}

	function handleMouseMove(e) {
		if (!state.isDragging) return;

		const dx = e.clientX - state.lastMouseX;
		const dy = e.clientY - state.lastMouseY;

		state.panX += dx;
		state.panY += dy;

		state.lastMouseX = e.clientX;
		state.lastMouseY = e.clientY;

		draw();
	}

	function handleMouseUp() {
		state.isDragging = false;
		canvas.style.cursor = 'grab';
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

	function handleTouchStart(e) {
		if (e.touches.length === 1) {
			e.preventDefault();
			state.isDragging = true;
			touchStartX = e.touches[0].clientX;
			touchStartY = e.touches[0].clientY;
			state.lastMouseX = touchStartX;
			state.lastMouseY = touchStartY;
		}
	}

	function handleTouchMove(e) {
		if (e.touches.length === 1 && state.isDragging) {
			e.preventDefault();
			const dx = e.touches[0].clientX - state.lastMouseX;
			const dy = e.touches[0].clientY - state.lastMouseY;

			state.panX += dx;
			state.panY += dy;

			state.lastMouseX = e.touches[0].clientX;
			state.lastMouseY = e.touches[0].clientY;

			draw();
		}
	}

	function handleTouchEnd() {
		state.isDragging = false;
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
		resetZoom
	};
})();
