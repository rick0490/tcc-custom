/**
 * Command Center View - Single-page tournament control dashboard
 *
 * Consolidates all critical tournament info into a 4-quadrant layout:
 * - Q1: Current Matches (underway)
 * - Q2: Match Queue (open, not started)
 * - Q3: System Status (displays, API health)
 * - Q4: Quick Actions (ticker, timers, etc.)
 *
 * Features:
 * - WebSocket real-time updates
 * - Keyboard shortcuts for rapid match management
 * - Mobile responsive
 */

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

let socket = null;
let currentTournament = null;
let currentMatches = [];
let currentStations = [];
let systemStatus = {
	matchModule: { online: false },
	bracketModule: { online: false },
	flyerModule: { online: false },
	rateLimit: {}
};
let selectedMatchIndex = -1;
let selectedMatch = null;
let isConnected = false;
let lastDataUpdate = null;
let nextMatchInfo = null;
let previousCompletedCount = 0;
let autoAdvanceEnabled = true;
let emergencyModeActive = false;

// Polling fallback
let pollingInterval = null;
let systemStatusInterval = null;
const POLL_INTERVAL = 15000; // 15 seconds fallback

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
	// Navigation is initialized in HTML
	initWebSocket();
	initKeyboardShortcuts();
	await loadInitialData();
	await loadEmergencyStatus();

	// Start system status polling (always needed)
	systemStatusInterval = setInterval(refreshSystemStatus, 30000);
});

/**
 * Load initial data from APIs
 */
async function loadInitialData() {
	try {
		// Load system status first to get active tournament
		const statusRes = await fetch('/api/status');
		const statusData = await statusRes.json();

		if (statusData.success) {
			// Update module status
			systemStatus.matchModule = {
				online: statusData.modules?.match?.status?.running ?? false,
				tournamentId: statusData.modules?.match?.state?.tournamentId
			};
			systemStatus.bracketModule = {
				online: statusData.modules?.bracket?.status?.running ?? false
			};
			systemStatus.flyerModule = {
				online: statusData.modules?.flyer?.status?.running ?? false
			};

			// Get tournament ID from match module state
			const tournamentId = statusData.modules?.match?.state?.tournamentId;
			if (tournamentId) {
				currentTournament = { id: tournamentId, name: tournamentId };
				await loadTournamentData();
				showCommandGrid();
			} else {
				showNoTournamentState();
			}
		} else {
			showNoTournamentState();
		}

		// Load rate limit status
		await refreshRateLimitStatus();
		renderSystemStatus();
	} catch (error) {
		console.error('Failed to load initial data:', error);
		showAlert('Failed to load tournament data', 'error');
		showNoTournamentState();
	}
}

/**
 * Load all tournament-related data
 */
async function loadTournamentData() {
	if (!currentTournament?.id) return;

	try {
		const [matchesRes, stationsRes] = await Promise.all([
			fetch(`/api/matches/${currentTournament.id}`),
			fetch(`/api/stations/${currentTournament.id}`).catch(() => ({ ok: false }))
		]);

		if (matchesRes.ok) {
			const matchesData = await matchesRes.json();
			if (matchesData.success) {
				// Map to consistent format - API uses camelCase, WebSocket uses snake_case
				currentMatches = (matchesData.matches || []).map(m => {
					// Handle both camelCase (API) and snake_case (WebSocket) field names
					const p1Id = m.player1Id ?? m.player1_id;
					const p2Id = m.player2Id ?? m.player2_id;
					const p1Name = m.player1Name ?? m.player1_name ?? 'TBD';
					const p2Name = m.player2Name ?? m.player2_name ?? 'TBD';
					const underwayAt = m.underwayAt ?? m.underway_at;
					const stationId = m.stationId ?? m.station_id;
					const suggestedPlayOrder = m.suggestedPlayOrder ?? m.suggested_play_order;
					const scores = m.scores_csv ?? m.scores ?? '';

					return {
						id: m.id,
						state: m.state,
						round: m.round,
						roundLabel: m.roundLabel || m.identifier || `R${m.round}`,
						player1: { id: p1Id, name: p1Name },
						player2: { id: p2Id, name: p2Name },
						player1Score: scores?.split('-')?.[0] ?? null,
						player2Score: scores?.split('-')?.[1] ?? null,
						underwayAt: underwayAt,
						stationId: stationId,
						suggestedPlayOrder: suggestedPlayOrder
					};
				});
				// Get tournament name if available
				if (matchesData.tournament?.name) {
					currentTournament.name = matchesData.tournament.name;
				}
			}
		}

		if (stationsRes.ok) {
			const stationsData = await stationsRes.json();
			if (stationsData.success) {
				currentStations = stationsData.stations || [];
			}
		}

		lastDataUpdate = new Date();
		renderAllQuadrants();
		updateTournamentIndicator();
		updateLastUpdated();
	} catch (error) {
		console.error('Failed to load tournament data:', error);
	}
}

// =============================================================================
// WEBSOCKET HANDLING
// =============================================================================

/**
 * Initialize WebSocket connection for real-time updates
 */
function initWebSocket() {
	if (typeof io === 'undefined') {
		console.warn('Socket.IO not loaded, using polling fallback');
		startPollingFallback();
		return;
	}

	socket = io({
		transports: ['websocket', 'polling'],
		reconnection: true,
		reconnectionAttempts: 10,
		reconnectionDelay: 1000
	});

	socket.on('connect', () => {
		isConnected = true;
		updateConnectionStatus(true);
		socket.emit('admin:register');

		// Stop polling fallback if active
		if (pollingInterval) {
			clearInterval(pollingInterval);
			pollingInterval = null;
		}
	});

	socket.on('disconnect', () => {
		isConnected = false;
		updateConnectionStatus(false);
		startPollingFallback();
	});

	socket.on('connect_error', () => {
		isConnected = false;
		updateConnectionStatus(false);
	});

	// Real-time match updates
	socket.on('matches:update', (data) => {
		// Set tournament from WebSocket data if not already set
		if (data.tournamentId && !currentTournament) {
			currentTournament = { id: data.tournamentId, name: data.tournamentId };
			showCommandGrid();
			updateTournamentIndicator();
		}

		if (data.matches && currentTournament) {
			// Map WebSocket format to our format
			currentMatches = data.matches.map(m => {
				return {
					id: m.id,
					state: m.state,
					round: m.round,
					roundLabel: m.roundLabel || `R${m.round}`,
					player1: { id: m.player1_id, name: m.player1_name || 'TBD' },
					player2: { id: m.player2_id, name: m.player2_name || 'TBD' },
					player1Score: m.scores?.split('-')?.[0] ?? null,
					player2Score: m.scores?.split('-')?.[1] ?? null,
					underwayAt: m.underway_at,
					stationId: m.station_id,
					suggestedPlayOrder: m.suggested_play_order
				};
			});
			lastDataUpdate = new Date();
			renderCurrentMatches();
			renderMatchQueue();
			updateMatchCounts();
			updateLastUpdated();
			updateMatchHistoryBadge();

			// Check for match completion and show next up indicator
			handleMatchCompletion(data);
		}
	});

	// Tournament updates
	socket.on('tournament:update', (data) => {
		if (data.tournament) {
			currentTournament = {
				id: data.tournament.id || currentTournament?.id,
				name: data.tournament.name || currentTournament?.name,
				state: data.tournament.state
			};
			updateTournamentIndicator();
		}
	});

	// Emergency mode handlers
	socket.on('emergency:activated', (data) => {
		emergencyModeActive = true;
		showAlert('EMERGENCY MODE ACTIVATED - All displays frozen', 'error', 0);
		updateEmergencyModeUI();
		renderQuickActions();
	});

	socket.on('emergency:deactivated', (data) => {
		emergencyModeActive = false;
		showAlert('Emergency mode deactivated - Normal operation resumed', 'success');
		updateEmergencyModeUI();
		renderQuickActions();
	});
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(connected) {
	const statusEl = document.getElementById('connectionStatus');
	if (!statusEl) return;

	const indicator = statusEl.querySelector('.status-indicator');
	const text = statusEl.querySelector('span:last-child');

	if (connected) {
		indicator.classList.remove('offline');
		indicator.classList.add('online');
		text.textContent = 'Live';
		text.classList.remove('text-gray-400');
		text.classList.add('text-green-400');
	} else {
		indicator.classList.remove('online');
		indicator.classList.add('offline');
		text.textContent = 'Reconnecting...';
		text.classList.remove('text-green-400');
		text.classList.add('text-gray-400');
	}
}

/**
 * Start polling fallback when WebSocket disconnects
 */
function startPollingFallback() {
	if (pollingInterval) return;

	pollingInterval = setInterval(async () => {
		await loadTournamentData();
	}, POLL_INTERVAL);
}

/**
 * Update last updated timestamp with color coding for freshness
 */
function updateLastUpdated() {
	const el = document.getElementById('lastUpdated');
	if (!el || !lastDataUpdate) return;

	const now = Date.now();
	const ageSeconds = Math.floor((now - lastDataUpdate.getTime()) / 1000);

	el.textContent = `Updated ${formatTimeAgo(lastDataUpdate)}`;
	el.classList.remove('hidden');

	// Color coding based on data age
	// Remove existing freshness classes
	el.classList.remove('text-green-400', 'text-yellow-400', 'text-orange-400', 'text-red-400', 'text-gray-500');

	if (ageSeconds < 15) {
		// Fresh - less than 15s
		el.classList.add('text-green-400');
	} else if (ageSeconds < 30) {
		// Recent - 15-30s
		el.classList.add('text-yellow-400');
	} else if (ageSeconds < 60) {
		// Getting stale - 30-60s
		el.classList.add('text-orange-400');
	} else {
		// Stale - over 60s
		el.classList.add('text-red-400');
	}
}

// Auto-update freshness indicator every 5 seconds
setInterval(updateLastUpdated, 5000);

// =============================================================================
// KEYBOARD SHORTCUTS
// =============================================================================

/**
 * Initialize keyboard shortcuts
 */
function initKeyboardShortcuts() {
	document.addEventListener('keydown', handleKeyboardShortcut);
}

/**
 * Handle keyboard shortcut
 */
function handleKeyboardShortcut(e) {
	// Skip if typing in input/textarea
	if (e.target.matches('input, textarea, select')) return;

	// Check modal states
	const scoreModalOpen = !document.getElementById('scoreModal').classList.contains('hidden');
	const tickerModalOpen = !document.getElementById('tickerModal').classList.contains('hidden');
	const helpModalOpen = !document.getElementById('keyboardHelpModal').classList.contains('hidden');
	const dqTimerModalOpen = !document.getElementById('dqTimerModal').classList.contains('hidden');

	// Escape always works
	if (e.key === 'Escape') {
		e.preventDefault();
		if (scoreModalOpen) {
			closeScoreModal();
			return;
		}
		if (tickerModalOpen) {
			closeTickerModal();
			return;
		}
		if (dqTimerModalOpen) {
			closeDQTimerModal();
			return;
		}
		if (helpModalOpen) {
			toggleKeyboardHelp();
			return;
		}
		deselectMatch();
		return;
	}

	// Handle ticker modal keyboard shortcuts
	if (tickerModalOpen) {
		if (e.key >= '1' && e.key <= '4') {
			e.preventDefault();
			const tickerPresets = [
				'5 Minute Break',
				'Report to your station!',
				'Tournament starting soon!',
				'Grand Finals!'
			];
			const index = parseInt(e.key) - 1;
			if (tickerPresets[index]) {
				sendQuickTicker(tickerPresets[index]);
			}
			return;
		}
		return;
	}

	// Block other shortcuts if modal is open
	if (scoreModalOpen || dqTimerModalOpen || helpModalOpen) return;

	const key = e.key.toLowerCase();

	switch (key) {
		// Number keys 1-5: Select match
		case '1':
		case '2':
		case '3':
		case '4':
		case '5':
			e.preventDefault();
			selectMatchByIndex(parseInt(key) - 1);
			break;

		// W: Player 1 wins (quick 2-0)
		case 'w':
			e.preventDefault();
			if (selectedMatch) {
				quickWin(1);
			}
			break;

		// L: Player 2 wins (quick 0-2)
		case 'l':
			e.preventDefault();
			if (selectedMatch) {
				quickWin(2);
			}
			break;

		// S: Start selected match
		case 's':
			e.preventDefault();
			if (selectedMatch && selectedMatch.state === 'open' && !selectedMatch.underwayAt) {
				startMatch(selectedMatch.id);
			}
			break;

		// Enter: Open score modal
		case 'enter':
			e.preventDefault();
			if (selectedMatch) {
				openScoreModal(selectedMatch);
			}
			break;

		// R: Refresh
		case 'r':
			e.preventDefault();
			refreshAll();
			break;

		// T: Ticker message
		case 't':
			e.preventDefault();
			openTickerModal();
			break;

		// D: DQ Timer
		case 'd':
			e.preventDefault();
			openDQTimerModal();
			break;

		// P: Panic / Emergency mode toggle
		case 'p':
			e.preventDefault();
			if (emergencyModeActive) {
				deactivateEmergencyMode();
			} else {
				activateEmergencyMode();
			}
			break;

		// Z: Undo last match
		case 'z':
			e.preventDefault();
			undoLastMatch();
			break;

		// ?: Toggle help
		case '?':
			e.preventDefault();
			toggleKeyboardHelp();
			break;
	}
}

// =============================================================================
// MATCH SELECTION & ACTIONS
// =============================================================================

/**
 * Get selectable matches in order (underway first, then open)
 */
function getSelectableMatches() {
	const underwayMatches = currentMatches.filter(m =>
		m.state === 'open' && m.underwayAt
	).sort((a, b) => (a.suggestedPlayOrder || 0) - (b.suggestedPlayOrder || 0));

	const openMatches = currentMatches.filter(m =>
		m.state === 'open' && !m.underwayAt
	).sort((a, b) => (a.suggestedPlayOrder || 0) - (b.suggestedPlayOrder || 0));

	return [...underwayMatches, ...openMatches];
}

/**
 * Select match by index (for keyboard navigation)
 */
function selectMatchByIndex(index) {
	const selectableMatches = getSelectableMatches();

	if (index >= 0 && index < selectableMatches.length) {
		selectedMatchIndex = index;
		selectedMatch = selectableMatches[index];
		highlightSelectedMatch();
	}
}

/**
 * Highlight selected match in UI
 */
function highlightSelectedMatch() {
	// Remove previous selection
	document.querySelectorAll('.cc-match-card.selected').forEach(el => {
		el.classList.remove('selected');
	});

	// Add selection to current match
	if (selectedMatch) {
		const matchCard = document.querySelector(`[data-match-id="${selectedMatch.id}"]`);
		if (matchCard) {
			matchCard.classList.add('selected');
			matchCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
	}
}

/**
 * Deselect current match
 */
function deselectMatch() {
	selectedMatchIndex = -1;
	selectedMatch = null;
	document.querySelectorAll('.cc-match-card.selected').forEach(el => {
		el.classList.remove('selected');
	});
}

/**
 * Select match by ID (click handler)
 */
function selectMatchById(matchId) {
	const match = currentMatches.find(m => m.id == matchId);
	if (match) {
		selectedMatch = match;
		const selectableMatches = getSelectableMatches();
		selectedMatchIndex = selectableMatches.findIndex(m => m.id == matchId);
		highlightSelectedMatch();
	}
}

/**
 * Quick win - declare winner with 2-0 score
 */
async function quickWin(playerNum) {
	if (!selectedMatch || !currentTournament) return;

	const winnerId = playerNum === 1 ?
		selectedMatch.player1?.id :
		selectedMatch.player2?.id;

	if (!winnerId) {
		showAlert('Cannot determine winner - player ID missing', 'error');
		return;
	}

	try {
		const response = await csrfFetch(
			`/api/matches/${currentTournament.id}/${selectedMatch.id}/winner`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					winnerId,
					scores: playerNum === 1 ? '2-0' : '0-2'
				})
			}
		);

		const data = await response.json();
		if (data.success) {
			const winnerName = playerNum === 1 ? selectedMatch.player1?.name : selectedMatch.player2?.name;
			showAlert(`Winner: ${winnerName}`, 'success', 2000);
			deselectMatch();
			// WebSocket will update, but also refresh
			await loadTournamentData();
		} else {
			showAlert(data.error || 'Failed to declare winner', 'error');
		}
	} catch (error) {
		console.error('Quick win error:', error);
		showAlert('Failed to declare winner', 'error');
	}
}

/**
 * Start match (mark as underway)
 */
async function startMatch(matchId) {
	if (!currentTournament) return;

	try {
		const response = await csrfFetch(
			`/api/matches/${currentTournament.id}/${matchId}/underway`,
			{ method: 'POST' }
		);

		const data = await response.json();
		if (data.success) {
			showAlert('Match started', 'success', 2000);
			await loadTournamentData();
		} else {
			showAlert(data.error || 'Failed to start match', 'error');
		}
	} catch (error) {
		console.error('Start match error:', error);
		showAlert('Failed to start match', 'error');
	}
}

// =============================================================================
// RENDER FUNCTIONS
// =============================================================================

/**
 * Render all quadrants
 */
function renderAllQuadrants() {
	renderCurrentMatches();
	renderMatchQueue();
	renderSystemStatus();
	renderQuickActions();
	updateMatchCounts();
	updateMatchHistoryBadge();
}

/**
 * Render Current Matches quadrant (underway matches)
 */
function renderCurrentMatches() {
	const container = document.getElementById('currentMatchesContainer');
	if (!container) return;

	const underwayMatches = currentMatches.filter(m =>
		m.state === 'open' && m.underwayAt
	).sort((a, b) => (a.suggestedPlayOrder || 0) - (b.suggestedPlayOrder || 0));

	if (underwayMatches.length === 0) {
		container.innerHTML = `
			<div class="cc-empty-state">
				<p class="text-gray-500">No matches in progress</p>
				<p class="text-gray-600 text-xs mt-1">Start a match from the queue</p>
			</div>
		`;
		return;
	}

	const selectableMatches = getSelectableMatches();

	container.innerHTML = underwayMatches.map(match => {
		const globalIndex = selectableMatches.findIndex(m => m.id === match.id);
		return renderMatchCard(match, globalIndex, true);
	}).join('');
}

/**
 * Render Match Queue quadrant (open matches not yet started)
 */
function renderMatchQueue() {
	const container = document.getElementById('matchQueueContainer');
	if (!container) return;

	const openMatches = currentMatches.filter(m =>
		m.state === 'open' && !m.underwayAt
	).sort((a, b) => (a.suggestedPlayOrder || 0) - (b.suggestedPlayOrder || 0))
	.slice(0, 10); // Show next 10

	if (openMatches.length === 0) {
		container.innerHTML = `
			<div class="cc-empty-state">
				<p class="text-gray-500">No matches waiting</p>
			</div>
		`;
		return;
	}

	const selectableMatches = getSelectableMatches();

	container.innerHTML = openMatches.map(match => {
		const globalIndex = selectableMatches.findIndex(m => m.id === match.id);
		return renderMatchCard(match, globalIndex, false);
	}).join('');
}

/**
 * Render a match card
 */
function renderMatchCard(match, index, isUnderway) {
	const station = currentStations.find(s => s.id === match.stationId);
	const elapsed = match.underwayAt ? formatElapsedTime(match.underwayAt) : '';
	const isSelected = selectedMatch?.id === match.id;
	const keyHint = index >= 0 && index < 5 ? `<span class="cc-key-hint">${index + 1}</span>` : '';

	// Defensive: ensure names are never empty strings
	const p1Name = (match.player1?.name || '').trim() || 'TBD';
	const p2Name = (match.player2?.name || '').trim() || 'TBD';
	const p1Score = match.player1Score ?? '-';
	const p2Score = match.player2Score ?? '-';

	return `
		<div class="cc-match-card ${isSelected ? 'selected' : ''} ${isUnderway ? 'underway' : ''}"
			 data-match-id="${match.id}"
			 onclick="selectMatchById('${match.id}')">
			<div class="cc-match-header">
				<span class="cc-match-round">${match.roundLabel || 'R' + match.round}</span>
				${station ? `<span class="cc-match-station">${escapeHtml(station.name || station.id)}</span>` : ''}
				${elapsed ? `<span class="cc-match-elapsed">${elapsed}</span>` : ''}
				${keyHint}
			</div>
			<div class="cc-match-players">
				<div class="cc-player">
					<span class="cc-player-name" title="${escapeHtml(p1Name)}">${escapeHtml(p1Name)}</span>
					<span class="cc-player-score">${p1Score}</span>
				</div>
				<span class="cc-vs">vs</span>
				<div class="cc-player">
					<span class="cc-player-name" title="${escapeHtml(p2Name)}">${escapeHtml(p2Name)}</span>
					<span class="cc-player-score">${p2Score}</span>
				</div>
			</div>
			<div class="cc-match-actions">
				${isUnderway ? `
					<button onclick="event.stopPropagation(); openScoreModal(getMatchById('${match.id}'))"
							class="cc-btn cc-btn-primary">Score</button>
				` : `
					<button onclick="event.stopPropagation(); startMatch('${match.id}')"
							class="cc-btn cc-btn-secondary">Start</button>
				`}
			</div>
		</div>
	`;
}

/**
 * Render System Status quadrant
 */
function renderSystemStatus() {
	const container = document.getElementById('systemStatusContainer');
	if (!container) return;

	const rateLimit = systemStatus.rateLimit || {};
	const completedCount = getCompletedCount();
	const totalCount = currentMatches.length;
	const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

	container.innerHTML = `
		<div class="cc-status-grid">
			<!-- Display Modules -->
			<div class="cc-status-section">
				<h4 class="cc-status-label">Display Modules</h4>
				<div class="cc-status-items">
					<div class="cc-status-item">
						<span class="status-indicator ${systemStatus.matchModule.online ? 'online' : 'offline'}"></span>
						<span>Match</span>
					</div>
					<div class="cc-status-item">
						<span class="status-indicator ${systemStatus.bracketModule.online ? 'online' : 'offline'}"></span>
						<span>Bracket</span>
					</div>
					<div class="cc-status-item">
						<span class="status-indicator ${systemStatus.flyerModule.online ? 'online' : 'offline'}"></span>
						<span>Flyer</span>
					</div>
				</div>
			</div>

			<!-- API Status -->
			<div class="cc-status-section">
				<h4 class="cc-status-label">Challonge API</h4>
				<div class="cc-status-items">
					<div class="cc-status-item">
						<span class="cc-status-mode cc-mode-${(rateLimit.currentMode || 'idle').toLowerCase()}">${rateLimit.currentMode || 'IDLE'}</span>
					</div>
					<div class="cc-status-item">
						<span class="text-gray-400 text-xs">${rateLimit.effectiveRate || 0}/min</span>
					</div>
				</div>
			</div>

			<!-- Tournament Progress -->
			<div class="cc-status-section">
				<h4 class="cc-status-label">Tournament Progress</h4>
				<div class="cc-progress-bar">
					<div class="cc-progress-fill" style="width: ${progressPercent}%"></div>
				</div>
				<div class="cc-status-items">
					<span class="text-sm text-gray-400">${completedCount} / ${totalCount} matches (${progressPercent}%)</span>
				</div>
			</div>
		</div>
	`;
}

/**
 * Render Quick Actions quadrant
 */
function renderQuickActions() {
	const container = document.getElementById('quickActionsContainer');
	if (!container) return;

	// Check if tournament is ready to finalize (all matches complete)
	const completedCount = getCompletedCount();
	const totalCount = currentMatches.length;
	const allMatchesComplete = totalCount > 0 && completedCount === totalCount;

	container.innerHTML = `
		<div class="cc-actions-grid">
			<!-- EMERGENCY / PANIC BUTTON (always first) -->
			${emergencyModeActive ? `
			<button onclick="deactivateEmergencyMode()" class="cc-action-btn cc-action-btn-warning animate-pulse">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
					</path>
				</svg>
				<span>Resume</span>
			</button>
			` : `
			<button onclick="activateEmergencyMode()" class="cc-action-btn cc-action-btn-danger">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z">
					</path>
				</svg>
				<span>STOP</span>
				<kbd class="cc-kbd hidden md:inline-block">P</kbd>
			</button>
			`}

			${allMatchesComplete ? `
			<!-- Finalize Tournament (shown when all matches complete) -->
			<button id="finalizeTournamentBtn" onclick="finalizeTournament()" class="cc-action-btn cc-action-btn-success disabled:opacity-50 disabled:cursor-not-allowed">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z">
					</path>
				</svg>
				<span>Finalize</span>
			</button>
			` : ''}

			<!-- Ticker Messages -->
			<button onclick="openTickerModal()" class="cc-action-btn">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z">
					</path>
				</svg>
				<span>Ticker</span>
				<kbd class="cc-kbd hidden md:inline-block">T</kbd>
			</button>

			<!-- DQ Timer -->
			<button onclick="openDQTimerModal()" class="cc-action-btn">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z">
					</path>
				</svg>
				<span>DQ Timer</span>
				<kbd class="cc-kbd hidden md:inline-block">D</kbd>
			</button>

			<!-- QR Code -->
			<button onclick="showSignupQR()" class="cc-action-btn">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z">
					</path>
				</svg>
				<span>QR Code</span>
			</button>

			<!-- Refresh -->
			<button id="refreshAllBtn" onclick="refreshAll()" class="cc-action-btn disabled:opacity-50 disabled:cursor-not-allowed">
				<svg id="refreshAllIcon" class="w-5 h-5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15">
					</path>
				</svg>
				<span id="refreshAllText">Refresh</span>
				<kbd class="cc-kbd hidden md:inline-block">R</kbd>
			</button>

			<!-- Hide QR -->
			<button onclick="hideQR()" class="cc-action-btn">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21">
					</path>
				</svg>
				<span>Hide QR</span>
			</button>

			<!-- Undo Last Match -->
			<button onclick="undoLastMatch()" class="cc-action-btn" title="Undo last match result">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6">
					</path>
				</svg>
				<span>Undo</span>
				<kbd class="cc-kbd hidden md:inline-block">Z</kbd>
			</button>

			<!-- Full Matches Page -->
			<a href="/matches.html" class="cc-action-btn">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2">
					</path>
				</svg>
				<span>All Matches</span>
			</a>
		</div>
	`;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Show/hide states
 */
function showCommandGrid() {
	document.getElementById('noTournamentState').classList.add('hidden');
	document.getElementById('noTournamentState').classList.remove('flex');
	document.getElementById('commandGrid').classList.remove('hidden');
	document.getElementById('ccHeader').classList.remove('hidden');
}

function showNoTournamentState() {
	document.getElementById('commandGrid').classList.add('hidden');
	document.getElementById('ccHeader').classList.add('hidden');
	document.getElementById('noTournamentState').classList.remove('hidden');
	document.getElementById('noTournamentState').classList.add('flex');
}

/**
 * Update tournament indicator in header
 */
function updateTournamentIndicator() {
	const indicator = document.getElementById('tournamentIndicator');
	if (!indicator) return;

	if (currentTournament) {
		const displayName = currentTournament.name || currentTournament.id;
		indicator.innerHTML = `
			<span class="status-indicator online"></span>
			<span class="text-white font-medium truncate max-w-[200px]" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
			<button onclick="copyTournamentId(event)" class="ml-2 p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors" title="Copy Tournament ID">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
				</svg>
			</button>
		`;
	} else {
		indicator.innerHTML = `
			<span class="status-indicator offline"></span>
			<span class="text-gray-400 text-sm">No tournament active</span>
		`;
	}
}

/**
 * Copy tournament ID to clipboard
 */
function copyTournamentId(event) {
	event.stopPropagation();
	if (!currentTournament || !currentTournament.id) {
		showAlert('No tournament selected', 'error');
		return;
	}

	const tournamentId = currentTournament.id;
	navigator.clipboard.writeText(tournamentId).then(() => {
		showAlert('Tournament ID copied!', 'success', 2000);
	}).catch(err => {
		console.error('Failed to copy:', err);
		showAlert('Failed to copy ID', 'error');
	});
}

/**
 * Update match count badges
 */
function updateMatchCounts() {
	const underwayCount = currentMatches.filter(m => m.state === 'open' && m.underwayAt).length;
	const openCount = currentMatches.filter(m => m.state === 'open' && !m.underwayAt).length;

	const currentEl = document.getElementById('currentMatchCount');
	const queueEl = document.getElementById('queueMatchCount');

	if (currentEl) currentEl.textContent = underwayCount;
	if (queueEl) queueEl.textContent = openCount;
}

/**
 * Get completed match count
 */
function getCompletedCount() {
	return currentMatches.filter(m => m.state === 'complete').length;
}

/**
 * Format elapsed time since match started
 */
function formatElapsedTime(startTime) {
	const start = new Date(startTime);
	const now = new Date();
	const diffMs = now - start;
	const diffMins = Math.floor(diffMs / 60000);

	if (diffMins < 1) return '<1m';
	if (diffMins < 60) return `${diffMins}m`;
	const hours = Math.floor(diffMins / 60);
	const mins = diffMins % 60;
	return `${hours}h ${mins}m`;
}

/**
 * Get match by ID
 */
function getMatchById(matchId) {
	return currentMatches.find(m => m.id == matchId);
}

/**
 * Refresh all data
 */
async function refreshAll() {
	// Show loading state
	const btn = document.getElementById('refreshAllBtn');
	const icon = document.getElementById('refreshAllIcon');
	const text = document.getElementById('refreshAllText');
	if (btn) btn.disabled = true;
	if (icon) icon.classList.add('animate-spin');
	if (text) text.textContent = 'Refreshing...';

	try {
		await loadTournamentData();
		await refreshSystemStatus();
		await refreshRateLimitStatus();
		renderSystemStatus();
	} finally {
		// Reset loading state
		if (btn) btn.disabled = false;
		if (icon) icon.classList.remove('animate-spin');
		if (text) text.textContent = 'Refresh';
	}
}

/**
 * Refresh system status
 */
async function refreshSystemStatus() {
	try {
		const response = await fetch('/api/status');
		const data = await response.json();

		if (data.success) {
			systemStatus.matchModule = {
				online: data.modules?.match?.status?.running ?? false,
				tournamentId: data.modules?.match?.state?.tournamentId
			};
			systemStatus.bracketModule = {
				online: data.modules?.bracket?.status?.running ?? false
			};
			systemStatus.flyerModule = {
				online: data.modules?.flyer?.status?.running ?? false
			};
		}
	} catch (error) {
		console.error('Failed to refresh system status:', error);
	}
}

/**
 * Refresh rate limit status
 */
async function refreshRateLimitStatus() {
	try {
		const response = await fetch('/api/rate-limit/status');
		const data = await response.json();

		if (data.success) {
			systemStatus.rateLimit = {
				currentMode: data.currentMode,
				effectiveRate: data.effectiveRate
			};
		}
	} catch (error) {
		console.error('Failed to refresh rate limit status:', error);
	}
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
	if (!text) return '';
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

// =============================================================================
// SCORE MODAL
// =============================================================================

/**
 * Open score modal for a match
 */
function openScoreModal(match) {
	if (!match) return;

	selectedMatch = match;
	const modal = document.getElementById('scoreModal');
	const title = document.getElementById('scoreModalTitle');
	const subtitle = document.getElementById('scoreModalSubtitle');
	const content = document.getElementById('scoreModalContent');

	const p1Name = match.player1?.name || 'Player 1';
	const p2Name = match.player2?.name || 'Player 2';

	title.textContent = `${p1Name} vs ${p2Name}`;
	subtitle.textContent = match.roundLabel || `Round ${match.round}`;

	content.innerHTML = `
		<div class="space-y-6">
			<!-- Quick Winners -->
			<div class="grid grid-cols-2 gap-4">
				<button onclick="declareWinnerFromModal(1, '2-0')"
						class="p-4 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium transition">
					<div class="text-lg truncate">${escapeHtml(p1Name)}</div>
					<div class="text-sm opacity-75">Wins 2-0</div>
				</button>
				<button onclick="declareWinnerFromModal(2, '0-2')"
						class="p-4 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium transition">
					<div class="text-lg truncate">${escapeHtml(p2Name)}</div>
					<div class="text-sm opacity-75">Wins 0-2</div>
				</button>
			</div>

			<!-- Custom Score Entry -->
			<div class="border-t border-gray-700 pt-4">
				<h4 class="text-sm text-gray-400 mb-3">Custom Score</h4>
				<div class="flex items-center justify-center gap-4">
					<div class="text-center">
						<div class="flex items-center gap-2">
							<button onclick="adjustModalScore(1, -1)" class="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-lg text-xl transition">-</button>
							<input type="number" id="modalScore1" value="${match.player1Score || 0}" min="0"
								   class="w-14 h-10 bg-gray-700 border border-gray-600 rounded-lg text-center text-xl text-white">
							<button onclick="adjustModalScore(1, 1)" class="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-lg text-xl transition">+</button>
						</div>
						<div class="text-sm text-gray-400 mt-2 truncate max-w-[120px]">${escapeHtml(p1Name)}</div>
					</div>
					<span class="text-gray-500 text-xl">-</span>
					<div class="text-center">
						<div class="flex items-center gap-2">
							<button onclick="adjustModalScore(2, -1)" class="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-lg text-xl transition">-</button>
							<input type="number" id="modalScore2" value="${match.player2Score || 0}" min="0"
								   class="w-14 h-10 bg-gray-700 border border-gray-600 rounded-lg text-center text-xl text-white">
							<button onclick="adjustModalScore(2, 1)" class="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-lg text-xl transition">+</button>
						</div>
						<div class="text-sm text-gray-400 mt-2 truncate max-w-[120px]">${escapeHtml(p2Name)}</div>
					</div>
				</div>
				<button onclick="submitCustomScore()" class="w-full mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition">
					Submit Score
				</button>
			</div>

			<!-- DQ/Forfeit -->
			<div class="border-t border-gray-700 pt-4">
				<h4 class="text-sm text-gray-400 mb-3">DQ / Forfeit</h4>
				<div class="grid grid-cols-2 gap-2">
					<button onclick="forfeitFromModal(1)" class="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white text-sm transition">
						DQ ${escapeHtml(p1Name.length > 10 ? p1Name.substring(0, 10) + '...' : p1Name)}
					</button>
					<button onclick="forfeitFromModal(2)" class="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white text-sm transition">
						DQ ${escapeHtml(p2Name.length > 10 ? p2Name.substring(0, 10) + '...' : p2Name)}
					</button>
				</div>
			</div>
		</div>
	`;

	modal.classList.remove('hidden');
}

function closeScoreModal() {
	document.getElementById('scoreModal').classList.add('hidden');
}

function adjustModalScore(player, delta) {
	const input = document.getElementById(`modalScore${player}`);
	const newValue = Math.max(0, parseInt(input.value || 0) + delta);
	input.value = newValue;
}

async function declareWinnerFromModal(playerNum, scores) {
	if (!selectedMatch || !currentTournament) return;

	const winnerId = playerNum === 1 ? selectedMatch.player1?.id : selectedMatch.player2?.id;

	if (!winnerId) {
		showAlert('Cannot determine winner - player ID missing', 'error');
		return;
	}

	try {
		const response = await csrfFetch(
			`/api/matches/${currentTournament.id}/${selectedMatch.id}/winner`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ winnerId, scores })
			}
		);

		const data = await response.json();
		if (data.success) {
			showAlert('Winner declared', 'success', 2000);
			closeScoreModal();
			deselectMatch();
			await loadTournamentData();
		} else {
			showAlert(data.error || 'Failed to declare winner', 'error');
		}
	} catch (error) {
		showAlert('Failed to declare winner', 'error');
	}
}

async function submitCustomScore() {
	if (!selectedMatch || !currentTournament) return;

	const score1 = parseInt(document.getElementById('modalScore1').value) || 0;
	const score2 = parseInt(document.getElementById('modalScore2').value) || 0;

	if (score1 === score2) {
		showAlert('Scores cannot be tied - declare a winner', 'warning');
		return;
	}

	const winnerId = score1 > score2 ? selectedMatch.player1?.id : selectedMatch.player2?.id;
	const scores = `${score1}-${score2}`;

	if (!winnerId) {
		showAlert('Cannot determine winner - player ID missing', 'error');
		return;
	}

	try {
		const response = await csrfFetch(
			`/api/matches/${currentTournament.id}/${selectedMatch.id}/winner`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ winnerId, scores })
			}
		);

		const data = await response.json();
		if (data.success) {
			showAlert('Score submitted', 'success', 2000);
			closeScoreModal();
			deselectMatch();
			await loadTournamentData();
		} else {
			showAlert(data.error || 'Failed to submit score', 'error');
		}
	} catch (error) {
		showAlert('Failed to submit score', 'error');
	}
}

async function forfeitFromModal(loserNum) {
	if (!selectedMatch || !currentTournament) return;

	const winnerId = loserNum === 1 ? selectedMatch.player2?.id : selectedMatch.player1?.id;
	const loserId = loserNum === 1 ? selectedMatch.player1?.id : selectedMatch.player2?.id;

	if (!winnerId || !loserId) {
		showAlert('Cannot determine players - IDs missing', 'error');
		return;
	}

	try {
		const response = await csrfFetch(
			`/api/matches/${currentTournament.id}/${selectedMatch.id}/dq`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ winnerId, loserId })
			}
		);

		const data = await response.json();
		if (data.success) {
			showAlert('Player DQ\'d', 'success', 2000);
			closeScoreModal();
			deselectMatch();
			await loadTournamentData();
		} else {
			showAlert(data.error || 'Failed to DQ player', 'error');
		}
	} catch (error) {
		showAlert('Failed to DQ player', 'error');
	}
}

// =============================================================================
// TICKER MODAL
// =============================================================================

function openTickerModal() {
	document.getElementById('tickerModal').classList.remove('hidden');
	setTimeout(() => {
		document.getElementById('tickerMessageInput').focus();
	}, 100);
}

function closeTickerModal() {
	document.getElementById('tickerModal').classList.add('hidden');
	document.getElementById('tickerMessageInput').value = '';
}

async function sendQuickTicker(message) {
	try {
		const response = await csrfFetch('/api/ticker/send', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message, duration: 5 })
		});

		const data = await response.json();
		if (data.success) {
			showAlert('Ticker sent', 'success', 2000);
			closeTickerModal();
		} else {
			showAlert(data.error || 'Failed to send ticker', 'error');
		}
	} catch (error) {
		showAlert('Failed to send ticker', 'error');
	}
}

async function sendCustomTicker() {
	const message = document.getElementById('tickerMessageInput').value.trim();
	if (!message) {
		showAlert('Please enter a message', 'warning');
		return;
	}
	await sendQuickTicker(message);
}

// =============================================================================
// DQ TIMER MODAL
// =============================================================================

function openDQTimerModal() {
	populateDQMatchDropdown();
	loadActiveTimers();
	document.getElementById('dqTimerModal').classList.remove('hidden');
}

function closeDQTimerModal() {
	document.getElementById('dqTimerModal').classList.add('hidden');
}

// Populate match dropdown with underway matches
function populateDQMatchDropdown() {
	const select = document.getElementById('dqMatchSelect');
	if (!select) return;

	// Get underway matches
	const underwayMatches = currentMatches.filter(m =>
		m.state === 'open' && m.underwayAt
	);

	select.innerHTML = '<option value="">Select match...</option>' +
		underwayMatches.map(m => {
			const p1 = m.player1?.name || 'TBD';
			const p2 = m.player2?.name || 'TBD';
			return `<option value="${m.id}" data-p1-id="${m.player1?.id}" data-p1-name="${escapeHtml(p1)}" data-p2-id="${m.player2?.id}" data-p2-name="${escapeHtml(p2)}">${p1} vs ${p2}</option>`;
		}).join('');

	// Reset player dropdown
	document.getElementById('dqPlayerSelect').innerHTML = '<option value="">Select player...</option>';
}

// Populate player dropdown based on selected match
function populateDQPlayerDropdown() {
	const matchSelect = document.getElementById('dqMatchSelect');
	const playerSelect = document.getElementById('dqPlayerSelect');
	if (!matchSelect || !playerSelect) return;

	const selectedOption = matchSelect.options[matchSelect.selectedIndex];
	if (!selectedOption || !selectedOption.value) {
		playerSelect.innerHTML = '<option value="">Select player...</option>';
		return;
	}

	const p1Id = selectedOption.dataset.p1Id;
	const p1Name = selectedOption.dataset.p1Name;
	const p2Id = selectedOption.dataset.p2Id;
	const p2Name = selectedOption.dataset.p2Name;

	playerSelect.innerHTML = `
		<option value="">Select player...</option>
		<option value="${p1Id}" data-name="${p1Name}">${p1Name}</option>
		<option value="${p2Id}" data-name="${p2Name}">${p2Name}</option>
	`;
}

// Start enhanced DQ timer with match/player tracking
async function startEnhancedDQTimer() {
	const matchSelect = document.getElementById('dqMatchSelect');
	const playerSelect = document.getElementById('dqPlayerSelect');
	const tvSelect = document.getElementById('dqTvSelect');

	const matchId = matchSelect?.value;
	const playerId = playerSelect?.value;
	const playerName = playerSelect?.options[playerSelect.selectedIndex]?.dataset.name;
	const tv = tvSelect?.value || 'TV 1';

	if (!matchId) {
		showAlert('Please select a match', 'warning');
		return;
	}

	if (!playerId) {
		showAlert('Please select a player', 'warning');
		return;
	}

	try {
		const response = await csrfFetch('/api/timer/dq', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				tv,
				duration: 180,
				tournamentId: currentTournament?.id,
				matchId,
				playerId,
				playerName
			})
		});

		const data = await response.json();
		if (data.success) {
			showAlert(`DQ timer started for ${playerName} on ${tv}`, 'success', 2000);
			loadActiveTimers();
		} else {
			showAlert(data.error || 'Failed to start timer', 'error');
		}
	} catch (error) {
		showAlert('Failed to start timer', 'error');
	}
}

// Load active DQ timers
async function loadActiveTimers() {
	try {
		const response = await fetch('/api/timer/dq/active');
		const data = await response.json();

		const section = document.getElementById('activeTimersSection');
		const list = document.getElementById('activeTimersList');

		if (data.success && data.timers && data.timers.length > 0) {
			section.classList.remove('hidden');
			list.innerHTML = data.timers.map(timer => `
				<div class="flex items-center justify-between bg-gray-700 rounded-lg p-2">
					<div>
						<span class="text-white text-sm">${escapeHtml(timer.playerName || 'Unknown')}</span>
						<span class="text-gray-400 text-xs ml-2">${timer.tv}</span>
						<span class="text-red-400 text-xs ml-2">${timer.secondsRemaining}s</span>
					</div>
					<button onclick="cancelDQTimer('${timer.key}')" class="text-gray-400 hover:text-red-400 p-1" title="Cancel">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>
			`).join('');
		} else {
			section.classList.add('hidden');
		}
	} catch (error) {
		console.error('Failed to load active timers:', error);
	}
}

// Cancel a DQ timer
async function cancelDQTimer(key) {
	try {
		const response = await csrfFetch(`/api/timer/dq/${encodeURIComponent(key)}`, {
			method: 'DELETE'
		});

		const data = await response.json();
		if (data.success) {
			showAlert('Timer cancelled', 'success', 2000);
			loadActiveTimers();
		} else {
			showAlert(data.error || 'Failed to cancel timer', 'error');
		}
	} catch (error) {
		showAlert('Failed to cancel timer', 'error');
	}
}

// =============================================================================
// QUICK ACTIONS
// =============================================================================

async function startDQTimer(tv) {
	try {
		const response = await csrfFetch('/api/timer/dq', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tv, duration: 180 })
		});

		const data = await response.json();
		if (data.success) {
			showAlert(`DQ timer started on ${tv} (3 min)`, 'success', 2000);
			closeDQTimerModal();
		} else {
			showAlert(data.error || 'Failed to start timer', 'error');
		}
	} catch (error) {
		showAlert('Failed to start timer', 'error');
	}
}

async function showSignupQR() {
	try {
		const response = await csrfFetch('/api/qr/show', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				url: 'https://signup.despairhardware.com',
				label: 'Sign Up'
			})
		});

		const data = await response.json();
		if (data.success) {
			showAlert('QR code displayed', 'success', 2000);
		} else {
			showAlert(data.error || 'Failed to show QR', 'error');
		}
	} catch (error) {
		showAlert('Failed to show QR', 'error');
	}
}

async function hideQR() {
	try {
		const response = await csrfFetch('/api/qr/hide', {
			method: 'POST'
		});

		const data = await response.json();
		if (data.success) {
			showAlert('QR code hidden', 'success', 2000);
		} else {
			showAlert(data.error || 'Failed to hide QR', 'error');
		}
	} catch (error) {
		showAlert('Failed to hide QR', 'error');
	}
}

// =============================================================================
// FINALIZE TOURNAMENT
// =============================================================================

/**
 * Finalize the current tournament on Challonge
 */
async function finalizeTournament() {
	if (!currentTournament?.id) {
		showAlert('No tournament selected', 'error');
		return;
	}

	const tournamentName = currentTournament.name || currentTournament.id;
	if (!confirm(`Finalize tournament "${tournamentName}"?\n\nThis will mark it as complete on Challonge.`)) {
		return;
	}

	const btn = document.getElementById('finalizeTournamentBtn');
	if (btn) {
		btn.disabled = true;
		btn.querySelector('span').textContent = 'Finalizing...';
	}

	try {
		const response = await csrfFetch(`/api/tournament/${currentTournament.id}/complete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Tournament finalized successfully!', 'success');
			// Refresh data to update UI
			await loadTournamentData();
		} else {
			showAlert(`Failed to finalize: ${data.error}`, 'error');
		}
	} catch (error) {
		console.error('Finalize tournament error:', error);
		showAlert('Failed to finalize tournament', 'error');
	} finally {
		if (btn) {
			btn.disabled = false;
			btn.querySelector('span').textContent = 'Finalize';
		}
	}
}

// =============================================================================
// KEYBOARD HELP MODAL
// =============================================================================

function toggleKeyboardHelp() {
	const modal = document.getElementById('keyboardHelpModal');
	modal.classList.toggle('hidden');
}

// =============================================================================
// NEXT UP INDICATOR (Match Queue Auto-Advance)
// =============================================================================

/**
 * Handle match completion detection and show next up indicator
 */
function handleMatchCompletion(data) {
	if (!autoAdvanceEnabled) return;

	const metadata = data.metadata;
	if (!metadata) return;

	// Check if a match was just completed
	const newCompletedCount = metadata.completedCount || 0;
	if (newCompletedCount > previousCompletedCount && previousCompletedCount > 0) {
		// A match was completed, show next up indicator
		if (metadata.nextMatchId && metadata.nextMatchPlayers) {
			showNextUpIndicator(
				metadata.nextMatchId,
				metadata.nextMatchPlayers.player1,
				metadata.nextMatchPlayers.player2
			);
		}
	}

	// Update tracked count
	previousCompletedCount = newCompletedCount;

	// Store next match info for quick access
	if (metadata.nextMatchId) {
		nextMatchInfo = {
			id: metadata.nextMatchId,
			player1: metadata.nextMatchPlayers?.player1,
			player2: metadata.nextMatchPlayers?.player2
		};
	} else {
		nextMatchInfo = null;
	}
}

/**
 * Show the NEXT UP floating indicator
 */
function showNextUpIndicator(matchId, player1, player2) {
	const indicator = document.getElementById('nextUpIndicator');
	const p1El = document.getElementById('nextUpPlayer1');
	const p2El = document.getElementById('nextUpPlayer2');

	if (!indicator) return;

	// Update player names
	if (p1El) p1El.textContent = player1 || 'TBD';
	if (p2El) p2El.textContent = player2 || 'TBD';

	// Store match ID for quick start
	indicator.dataset.matchId = matchId;

	// Show indicator with animation
	indicator.classList.remove('hidden');

	// Auto-select the next match in the queue
	const match = currentMatches.find(m => m.id == matchId);
	if (match) {
		selectMatchById(matchId);
		scrollToMatch(matchId);
	}

	// Auto-hide after 15 seconds if not interacted with
	setTimeout(() => {
		if (indicator.dataset.matchId == matchId) {
			hideNextUpIndicator();
		}
	}, 15000);
}

/**
 * Hide the NEXT UP indicator
 */
function hideNextUpIndicator() {
	const indicator = document.getElementById('nextUpIndicator');
	if (indicator) {
		indicator.classList.add('hidden');
		indicator.dataset.matchId = '';
	}
}

/**
 * Start the next suggested match from the indicator
 */
async function startNextMatch() {
	const indicator = document.getElementById('nextUpIndicator');
	const matchId = indicator?.dataset.matchId;

	if (!matchId || !currentTournament) {
		showAlert('No next match available', 'warning');
		return;
	}

	hideNextUpIndicator();
	await startMatch(matchId);
}

/**
 * Scroll to a specific match card
 */
function scrollToMatch(matchId) {
	const matchCard = document.querySelector(`[data-match-id="${matchId}"]`);
	if (matchCard) {
		matchCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
}

/**
 * Toggle auto-advance feature
 */
function toggleAutoAdvance() {
	autoAdvanceEnabled = !autoAdvanceEnabled;
	showAlert(autoAdvanceEnabled ? 'Auto-advance enabled' : 'Auto-advance disabled', 'info', 2000);
	if (!autoAdvanceEnabled) {
		hideNextUpIndicator();
	}
}

// =============================================================================
// EMERGENCY MODE (PANIC BUTTON)
// =============================================================================

/**
 * Activate emergency mode - freezes all displays
 */
async function activateEmergencyMode() {
	if (emergencyModeActive) return;

	// Confirm with user
	if (!confirm('ACTIVATE EMERGENCY MODE?\n\nThis will:\n- Freeze all displays\n- Cancel all active DQ timers\n- Pause tournament operations\n\nContinue?')) {
		return;
	}

	try {
		const response = await csrfFetch('/api/emergency/activate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ reason: 'Manual emergency stop from Command Center' })
		});

		const data = await response.json();
		if (data.success) {
			emergencyModeActive = true;
			updateEmergencyModeUI();
			renderQuickActions();
			// Alert is shown by WebSocket handler
		} else {
			showAlert(data.message || 'Failed to activate emergency mode', 'error');
		}
	} catch (error) {
		console.error('Emergency mode activation failed:', error);
		showAlert('Failed to activate emergency mode', 'error');
	}
}

/**
 * Deactivate emergency mode - resumes normal operation
 */
async function deactivateEmergencyMode() {
	if (!emergencyModeActive) return;

	// Confirm with user
	if (!confirm('RESUME NORMAL OPERATION?\n\nThis will deactivate emergency mode and resume tournament operations.\n\nContinue?')) {
		return;
	}

	try {
		const response = await csrfFetch('/api/emergency/deactivate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();
		if (data.success) {
			emergencyModeActive = false;
			updateEmergencyModeUI();
			renderQuickActions();
			// Alert is shown by WebSocket handler
		} else {
			showAlert(data.message || 'Failed to deactivate emergency mode', 'error');
		}
	} catch (error) {
		console.error('Emergency mode deactivation failed:', error);
		showAlert('Failed to deactivate emergency mode', 'error');
	}
}

/**
 * Update UI elements when emergency mode changes
 */
function updateEmergencyModeUI() {
	const header = document.getElementById('ccHeader');
	const grid = document.getElementById('commandGrid');

	if (emergencyModeActive) {
		// Add emergency styling
		header?.classList.add('emergency-mode');
		grid?.classList.add('emergency-mode');

		// Show emergency banner in header
		let banner = document.getElementById('emergencyBanner');
		if (!banner && header) {
			banner = document.createElement('div');
			banner.id = 'emergencyBanner';
			banner.className = 'emergency-banner';
			banner.innerHTML = `
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z">
					</path>
				</svg>
				<span>EMERGENCY MODE ACTIVE - Displays Frozen</span>
			`;
			header.appendChild(banner);
		}
	} else {
		// Remove emergency styling
		header?.classList.remove('emergency-mode');
		grid?.classList.remove('emergency-mode');

		// Remove emergency banner
		document.getElementById('emergencyBanner')?.remove();
	}
}

/**
 * Load emergency mode status on page load
 */
async function loadEmergencyStatus() {
	try {
		const response = await fetch('/api/emergency/status');
		const data = await response.json();
		if (data.success && data.emergency) {
			emergencyModeActive = data.emergency.active;
			if (emergencyModeActive) {
				updateEmergencyModeUI();
				renderQuickActions();
			}
		}
	} catch (error) {
		console.error('Failed to load emergency status:', error);
	}
}

// =============================================================================
// MATCH HISTORY PANEL
// =============================================================================

let matchHistoryExpanded = false;

/**
 * Toggle the Match History Panel
 */
function toggleMatchHistoryPanel() {
	matchHistoryExpanded = !matchHistoryExpanded;
	const content = document.getElementById('matchHistoryContent');
	const toggle = document.querySelector('.match-history-toggle');

	if (matchHistoryExpanded) {
		content.classList.remove('hidden');
		toggle.classList.add('expanded');
		renderMatchHistory();
	} else {
		content.classList.add('hidden');
		toggle.classList.remove('expanded');
	}
}

/**
 * Render the Match History content
 */
function renderMatchHistory() {
	const content = document.getElementById('matchHistoryContent');
	const badge = document.getElementById('matchHistoryCount');
	if (!content) return;

	// Filter completed matches
	const completedMatches = currentMatches
		.filter(m => m.state === 'complete')
		.sort((a, b) => {
			// Sort by suggested play order descending (most recent first)
			return (b.suggestedPlayOrder || 0) - (a.suggestedPlayOrder || 0);
		})
		.slice(0, 10);

	// Update badge count
	if (badge) {
		badge.textContent = completedMatches.length;
	}

	if (completedMatches.length === 0) {
		content.innerHTML = `
			<div class="match-history-empty">
				No completed matches yet
			</div>
		`;
		return;
	}

	content.innerHTML = completedMatches.map(match => {
		const p1Name = match.player1?.name || 'TBD';
		const p2Name = match.player2?.name || 'TBD';
		const p1Score = match.player1Score || '0';
		const p2Score = match.player2Score || '0';

		// Determine winner
		const p1Wins = parseInt(p1Score) > parseInt(p2Score);
		const p2Wins = parseInt(p2Score) > parseInt(p1Score);

		return `
			<div class="match-history-item">
				<div class="match-history-players">
					<div class="match-history-player ${p1Wins ? 'winner' : ''}">
						${p1Wins ? '<span title="Winner">&#10003;</span>' : ''}
						<span>${p1Name}</span>
					</div>
					<div class="match-history-player ${p2Wins ? 'winner' : ''}">
						${p2Wins ? '<span title="Winner">&#10003;</span>' : ''}
						<span>${p2Name}</span>
					</div>
				</div>
				<div class="flex flex-col items-end gap-1">
					<span class="match-history-score">${p1Score} - ${p2Score}</span>
					<span class="match-history-time">${match.roundLabel || 'R' + match.round}</span>
				</div>
			</div>
		`;
	}).join('');
}

/**
 * Update match history when matches change
 */
function updateMatchHistoryBadge() {
	const badge = document.getElementById('matchHistoryCount');
	if (!badge) return;

	const completedCount = currentMatches.filter(m => m.state === 'complete').length;
	badge.textContent = completedCount;

	// If panel is expanded, re-render
	if (matchHistoryExpanded) {
		renderMatchHistory();
	}
}

// =============================================================================
// MATCH UNDO / ROLLBACK
// =============================================================================

/**
 * Undo the last match result
 */
async function undoLastMatch() {
	if (!currentTournament?.id) {
		showAlert('No tournament selected', 'error');
		return;
	}

	try {
		// First, check if there's history available
		const historyRes = await fetch(`/api/matches/${currentTournament.id}/history`);
		const historyData = await historyRes.json();

		if (!historyData.success || !historyData.history || historyData.history.length === 0) {
			showAlert('No match history available to undo', 'warning');
			return;
		}

		const lastChange = historyData.history[0];

		// Confirm with user
		if (!confirm(`UNDO LAST MATCH?\n\nAction: ${lastChange.action}\nMatch ID: ${lastChange.matchId}\nBy: ${lastChange.user}\nAt: ${new Date(lastChange.timestamp).toLocaleTimeString()}\n\nThis will reopen the match and clear the result.`)) {
			return;
		}

		// Perform undo
		const response = await csrfFetch(`/api/matches/${currentTournament.id}/undo`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();
		if (data.success) {
			showAlert(`Undone: ${data.undoneChange.action}`, 'success');
			// Refresh match data
			await loadTournamentData();
			renderCurrentMatches();
			renderMatchQueue();
		} else {
			showAlert(data.message || 'Failed to undo match', 'error');
		}
	} catch (error) {
		console.error('Undo match failed:', error);
		showAlert('Failed to undo match', 'error');
	}
}

// Cleanup all intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	if (pollingInterval) clearInterval(pollingInterval);
	if (systemStatusInterval) clearInterval(systemStatusInterval);
	if (socket) socket.disconnect();
});
