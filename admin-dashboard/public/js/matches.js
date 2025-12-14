// Match Control Page JavaScript

// State
let tournaments = [];
let selectedTournamentId = null;
let matches = [];
let participants = {};
let currentFilter = 'all';
let selectedMatch = null;
let refreshInterval = null;
let stations = [];
let stationSettings = { autoAssign: false, onlyStartWithStations: false };
let tournamentState = null;
let isPollingActive = true;

// WebSocket state
let wsConnected = false;
let unsubscribeWs = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
	FrontendDebug.log('Matches', 'Initializing match control page...');

	// Initialize last updated timestamp
	initLastUpdated('matchesLastUpdated', refreshMatches, { prefix: 'Updated', thresholds: { fresh: 15, stale: 60 } });

	await loadTournaments();

	// Initialize WebSocket for real-time updates
	initWebSocket();

	// Start polling with visibility awareness (as fallback if WebSocket not available)
	startPolling();
	setupVisibilityHandler(
		() => { isPollingActive = true; if (selectedTournamentId && !wsConnected) refreshMatches(); },
		() => { isPollingActive = false; }
	);

	FrontendDebug.log('Matches', 'Initialization complete', { selectedTournamentId, wsConnected });
});

// WebSocket initialization for real-time match updates
function initWebSocket() {
	if (!WebSocketManager.init()) {
		FrontendDebug.warn('Matches', 'WebSocket not available, using polling');
		return;
	}

	// Subscribe to match and station events
	unsubscribeWs = WebSocketManager.subscribeMany({
		'matches:update': handleMatchUpdate,
		[WS_EVENTS.MATCH_UPDATED]: handleMatchUpdatedEvent,
		[WS_EVENTS.MATCH_SCORED]: handleMatchUpdatedEvent,
		[WS_EVENTS.MATCH_STARTED]: handleMatchUpdatedEvent,
		[WS_EVENTS.STATION_CREATED]: handleStationChange,
		[WS_EVENTS.STATION_DELETED]: handleStationChange,
		[WS_EVENTS.STATION_ASSIGNED]: handleStationAssigned,
		[WS_EVENTS.TOURNAMENT_STARTED]: handleTournamentStarted,
		[WS_EVENTS.TOURNAMENT_RESET]: handleTournamentReset
	});

	WebSocketManager.onConnection('connect', () => {
		FrontendDebug.ws('Matches', 'WebSocket connected');
		wsConnected = true;
		// Reduce polling interval when WebSocket is connected
		stopPolling();
		startPolling(30000); // 30 second backup polling
	});

	WebSocketManager.onConnection('disconnect', () => {
		FrontendDebug.ws('Matches', 'WebSocket disconnected, increasing poll rate');
		wsConnected = false;
		// Increase polling when WebSocket disconnects
		stopPolling();
		startPolling(10000); // Back to 10 second polling
	});
}

// Handle match update from WebSocket
function handleMatchUpdate(data) {
	// Only handle updates for the currently selected tournament
	if (!selectedTournamentId || data.tournamentId !== selectedTournamentId) return;

	FrontendDebug.ws('Matches', 'Match update received', { action: data.action, tournamentId: data.tournamentId });

	// Refresh matches to get latest state
	refreshMatches();
}

// Handle specific match events
function handleMatchUpdatedEvent(data) {
	if (!selectedTournamentId) return;
	FrontendDebug.ws('Matches', 'Match event received', data);
	refreshMatches();
}

// Handle station changes
function handleStationChange(data) {
	if (!selectedTournamentId) return;
	FrontendDebug.ws('Matches', 'Station change event', data);
	refreshStations();
}

// Handle station assignment
function handleStationAssigned(data) {
	if (!selectedTournamentId) return;
	FrontendDebug.ws('Matches', 'Station assigned event', data);
	refreshMatches();
}

// Handle tournament started - reload matches
function handleTournamentStarted(data) {
	if (!selectedTournamentId) return;
	const tournament = data.tournament;
	if (tournament && tournament.tournamentId === selectedTournamentId) {
		FrontendDebug.ws('Matches', 'Tournament started, reloading matches');
		tournamentState = 'underway';
		document.getElementById('tournamentStatus').innerHTML = `
			<span class="tournament-state underway">underway</span>
		`;
		refreshMatches();
	}
}

// Handle tournament reset - reload everything
function handleTournamentReset(data) {
	if (!selectedTournamentId) return;
	const tournament = data.tournament;
	if (tournament && tournament.tournamentId === selectedTournamentId) {
		FrontendDebug.ws('Matches', 'Tournament reset, reloading');
		tournamentState = 'pending';
		document.getElementById('tournamentStatus').innerHTML = `
			<span class="tournament-state pending">pending</span>
		`;
		loadTournamentMatches();
	}
}

function startPolling(interval = 10000) {
	if (!refreshInterval) {
		refreshInterval = setInterval(() => {
			if (selectedTournamentId && isPollingActive) {
				refreshMatches();
			}
		}, interval);
	}
}

function stopPolling() {
	if (refreshInterval) {
		clearInterval(refreshInterval);
		refreshInterval = null;
	}
}

// Load tournaments from API
async function loadTournaments() {
	try {
		const response = await fetch('/api/tournaments');
		if (!response.ok) {
			if (response.status === 401) {
				window.location.href = '/login.html';
				return;
			}
			throw new Error(`HTTP ${response.status}`);
		}

		const data = await response.json();
		if (data.success) {
			// Combine in-progress and pending tournaments
			tournaments = [
				...(data.tournaments.inProgress || []),
				...(data.tournaments.pending || [])
			];
			updateTournamentSelect();

			// Auto-select active tournament if available
			await selectActiveTournament();
		}
	} catch (error) {
		console.error('Failed to load tournaments:', error);
		showAlert('Failed to load tournaments', 'error');
	}
}

// Auto-select the active tournament based on user's active tournament setting
async function selectActiveTournament() {
	try {
		const response = await fetch('/api/tournament/active');
		if (!response.ok) return;

		const data = await response.json();
		if (data.success && data.tournament) {
			// API returns tournamentId (url_slug) and id (numeric)
			const slugId = data.tournament.tournamentId;
			const numericId = data.tournament.id;
			const select = document.getElementById('tournamentSelect');

			// Check if active tournament is in our dropdown (match by slug or numeric id)
			const option = Array.from(select.options).find(opt =>
				opt.value === String(slugId) || opt.value === String(numericId)
			);

			if (option) {
				select.value = option.value;
				FrontendDebug.log('Matches', 'Auto-selected active tournament', {
					tournament: data.tournament.name,
					mode: data.mode
				});
				// Trigger change to load matches
				await loadTournamentMatches();
			}
		}
	} catch (error) {
		FrontendDebug.warn('Matches', 'Could not fetch active tournament', error);
		// Silently fail - user can still manually select
	}
}

// Update tournament select dropdown
function updateTournamentSelect() {
	const select = document.getElementById('tournamentSelect');
	if (!select) return;

	if (tournaments.length === 0) {
		select.innerHTML = '<option value="">No active tournaments</option>';
		return;
	}

	select.innerHTML = `
		<option value="">Select a tournament...</option>
		${tournaments.map(t => `
			<option value="${t.tournamentId}" data-state="${t.state}">
				${escapeHtml(t.name)} (${t.state})
			</option>
		`).join('')}
	`;
}

// Load matches for selected tournament
async function loadTournamentMatches() {
	const select = document.getElementById('tournamentSelect');
	selectedTournamentId = select?.value;

	if (!selectedTournamentId) {
		document.getElementById('stationSection').classList.add('hidden');
		document.getElementById('statsSection').classList.add('hidden');
		document.getElementById('matchSection').classList.add('hidden');
		document.getElementById('tournamentStatus').textContent = 'No tournament selected';
		return;
	}

	const selectedOption = select.options[select.selectedIndex];
	tournamentState = selectedOption?.dataset?.state || 'unknown';
	document.getElementById('tournamentStatus').innerHTML = `
		<span class="tournament-state ${tournamentState}">${tournamentState}</span>
	`;

	await loadParticipants();
	await refreshStations();
	await refreshMatches();

	document.getElementById('stationSection').classList.remove('hidden');
	document.getElementById('statsSection').classList.remove('hidden');
	document.getElementById('matchSection').classList.remove('hidden');
}

// Load participants for name lookups
async function loadParticipants() {
	if (!selectedTournamentId) return;

	try {
		const response = await fetch(`/api/participants/${selectedTournamentId}`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const data = await response.json();
		if (data.success && data.participants) {
			// Create lookup map by participant ID
			participants = {};
			data.participants.forEach(p => {
				participants[p.id] = p.name || p.displayName || `Player ${p.id}`;
			});
		}
	} catch (error) {
		console.error('Failed to load participants:', error);
	}
}

// Track cache info for display
let matchesCacheInfo = null;

// Refresh matches
async function refreshMatches() {
	if (!selectedTournamentId) return;

	// Show loading state
	const btn = document.getElementById('refreshMatchesBtn');
	const icon = document.getElementById('refreshMatchesIcon');
	const text = document.getElementById('refreshMatchesText');
	if (btn) btn.disabled = true;
	if (icon) icon.classList.add('animate-spin');
	if (text) text.textContent = 'Refreshing...';

	try {
		const response = await fetch(`/api/matches/${selectedTournamentId}`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const data = await response.json();
		if (data.success) {
			matches = data.matches || [];
			matchesCacheInfo = data._cache || null;
			updateStats();
			renderMatches();
			// Update last refreshed timestamp
			setLastUpdated('matchesLastUpdated');
			// Update cache indicator
			updateCacheIndicator();
		}
	} catch (error) {
		console.error('Failed to load matches:', error);
		showAlert('Failed to load matches', 'error');
	} finally {
		// Reset loading state
		if (btn) btn.disabled = false;
		if (icon) icon.classList.remove('animate-spin');
		if (text) text.textContent = 'Refresh';
	}
}

// Update cache indicator display
function updateCacheIndicator() {
	const container = document.getElementById('matchesCacheIndicator');
	if (!container) return;

	if (matchesCacheInfo) {
		container.innerHTML = renderCacheIndicator(matchesCacheInfo);
		container.classList.remove('hidden');
	} else {
		container.classList.add('hidden');
	}
}

// Update match statistics
function updateStats() {
	const total = matches.length;
	const open = matches.filter(m => getEffectiveState(m) === 'open').length;
	const underway = matches.filter(m => getEffectiveState(m) === 'underway').length;
	const complete = matches.filter(m => getEffectiveState(m) === 'complete').length;

	document.getElementById('statTotal').textContent = total;
	document.getElementById('statOpen').textContent = open;
	document.getElementById('statUnderway').textContent = underway;
	document.getElementById('statComplete').textContent = complete;

	// Update header progress badge
	const progressBadge = document.getElementById('matchProgressBadge');
	if (progressBadge && total > 0) {
		const progressPercent = Math.round((complete / total) * 100);
		progressBadge.textContent = `${complete}/${total} (${progressPercent}%)`;
		progressBadge.classList.remove('hidden');
	} else if (progressBadge) {
		progressBadge.classList.add('hidden');
	}
}

// Filter matches
function filterMatches(filter) {
	currentFilter = filter;

	// Update filter button styles
	document.querySelectorAll('.filter-btn').forEach(btn => {
		const isActive = btn.dataset.filter === filter;
		btn.classList.toggle('bg-blue-600', isActive);
		btn.classList.toggle('text-white', isActive);
		btn.classList.toggle('bg-gray-700', !isActive);
		btn.classList.toggle('text-gray-300', !isActive);
	});

	renderMatches();
}

// Render matches
function renderMatches() {
	const container = document.getElementById('matchList');
	if (!container) return;

	let filteredMatches = matches;
	if (currentFilter !== 'all') {
		filteredMatches = matches.filter(m => getEffectiveState(m) === currentFilter);
	}

	if (filteredMatches.length === 0) {
		container.innerHTML = `
			<div class="text-center py-8 text-gray-400">
				No ${currentFilter === 'all' ? '' : currentFilter} matches found
			</div>
		`;
		return;
	}

	container.innerHTML = filteredMatches.map(match => {
		const player1 = getPlayerName(match.player1Id);
		const player2 = getPlayerName(match.player2Id);
		const effectiveState = getEffectiveState(match);
		const stateClass = getStateClass(effectiveState);
		const stateLabel = getStateLabel(effectiveState);
		const scores = formatScores(match);
		const currentStationName = getStationName(match.stationId);
		const showStationAssignment = effectiveState !== 'complete' && stations.length > 0;

		return `
			<div class="match-card bg-gray-750 rounded-lg p-4 border border-gray-600">
				<div class="flex items-center justify-between">
					<div class="flex-1">
						<div class="flex items-center gap-2 mb-2">
							<span class="text-xs px-2 py-0.5 rounded ${stateClass}">${stateLabel}</span>
							<span class="text-xs text-gray-500">Round ${match.round || '?'}</span>
							${match.suggestedPlayOrder ? `<span class="text-xs text-gray-500">Order: ${match.suggestedPlayOrder}</span>` : ''}
							${currentStationName ? `<span class="text-xs px-2 py-0.5 rounded bg-blue-600/30 text-blue-300">${escapeHtml(currentStationName)}</span>` : ''}
						</div>
						<div class="flex items-center gap-4">
							<div class="flex-1">
								<div class="flex items-center justify-between">
									<span class="text-white font-medium ${match.winnerId === match.player1Id ? 'text-green-400' : ''}">${escapeHtml(player1)}</span>
									${scores ? `<span class="text-gray-400 text-sm">${scores.player1}</span>` : ''}
								</div>
								<div class="text-xs text-gray-500 mt-1">vs</div>
								<div class="flex items-center justify-between">
									<span class="text-white font-medium ${match.winnerId === match.player2Id ? 'text-green-400' : ''}">${escapeHtml(player2)}</span>
									${scores ? `<span class="text-gray-400 text-sm">${scores.player2}</span>` : ''}
								</div>
							</div>
						</div>
					</div>
					<div class="flex flex-col gap-2 ml-4">
						${showStationAssignment ? `
							<select onchange="assignStation(${match.id}, this.value)"
								class="px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-sm text-gray-300 focus:ring-2 focus:ring-blue-500">
								<option value="">No Station</option>
								${stations.map(s => `
									<option value="${s.id}" ${match.stationId == s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>
								`).join('')}
							</select>
						` : ''}
						<div class="flex flex-wrap gap-2">
							${effectiveState === 'open' || effectiveState === 'underway' ? `
								<button onclick="quickWin(${match.id}, ${match.player1Id}, '2-0')"
									class="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-xs font-medium"
									title="P1 wins 2-0">
									P1 2-0
								</button>
								<button onclick="quickWin(${match.id}, ${match.player2Id}, '0-2')"
									class="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-xs font-medium"
									title="P2 wins 2-0">
									P2 2-0
								</button>
							` : ''}
							${effectiveState === 'open' ? `
								<button onclick="showUnderwayModal(${match.id})"
									class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium">
									Start
								</button>
								<button onclick="showScoreModal(${match.id})"
									class="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium">
									Report Score
								</button>
							` : ''}
							${effectiveState === 'underway' ? `
								<button onclick="unmarkUnderway(${match.id})"
									class="px-3 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-md text-sm font-medium">
									Stop
								</button>
								<button onclick="showScoreModal(${match.id})"
									class="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium">
									Report Score
								</button>
							` : ''}
							${effectiveState === 'complete' ? `
								<button onclick="reopenMatch(${match.id})"
									class="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md text-sm font-medium">
									Reopen
								</button>
								<button onclick="showScoreModal(${match.id})"
									class="px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md text-sm font-medium">
									View
								</button>
							` : ''}
						</div>
					</div>
				</div>
			</div>
		`;
	}).join('');
}

// Get player name from participants map
function getPlayerName(playerId) {
	if (!playerId) return 'TBD';
	return participants[playerId] || `Player ${playerId}`;
}

// Check if match is underway (state = 'underway')
function isMatchUnderway(match) {
	return match.state === 'underway';
}

// Get effective state (accounting for underwayAt)
function getEffectiveState(match) {
	if (match.state === 'complete') return 'complete';
	if (isMatchUnderway(match)) return 'underway';
	if (match.state === 'open') return 'open';
	return match.state;
}

// Get state class for styling
function getStateClass(state) {
	switch (state) {
		case 'open': return 'bg-yellow-600/30 text-yellow-300';
		case 'underway': return 'bg-blue-600/30 text-blue-300';
		case 'complete': return 'bg-green-600/30 text-green-300';
		default: return 'bg-gray-600/30 text-gray-300';
	}
}

// Get state label
function getStateLabel(state) {
	switch (state) {
		case 'open': return 'Open';
		case 'underway': return 'In Progress';
		case 'complete': return 'Complete';
		default: return state;
	}
}

// Format scores for display
function formatScores(match) {
	if (!match.scores_csv) return null;
	const parts = match.scores_csv.split('-');
	if (parts.length !== 2) return null;
	return {
		player1: parts[0],
		player2: parts[1]
	};
}

// Show underway confirmation modal
function showUnderwayModal(matchId) {
	const match = matches.find(m => m.id === matchId);
	if (!match) return;

	selectedMatch = match;
	const player1 = getPlayerName(match.player1Id);
	const player2 = getPlayerName(match.player2Id);

	document.getElementById('underwayMatchInfo').innerHTML = `
		<div class="text-center">
			<div class="text-white font-medium">${escapeHtml(player1)}</div>
			<div class="text-gray-500 text-sm my-2">vs</div>
			<div class="text-white font-medium">${escapeHtml(player2)}</div>
		</div>
	`;

	document.getElementById('underwayModal').classList.remove('hidden');
}

// Close underway modal
function closeUnderwayModal() {
	selectedMatch = null;
	document.getElementById('underwayModal').classList.add('hidden');
}

// Confirm mark as underway
async function confirmMarkUnderway() {
	if (!selectedMatch || !selectedTournamentId) return;

	const matchId = selectedMatch.id;

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/${matchId}/underway`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();
		console.log('Mark underway response:', data);

		if (data.success) {
			closeUnderwayModal();

			// Verify the state change by re-fetching matches after a short delay
			// API has eventual consistency, so we poll until verified
			const verified = await verifyMatchState(matchId, 'underway', 3);

			if (verified) {
				showAlert('Match marked as in progress', 'success');
			} else {
				showAlert('Match marked, but state verification pending. Refreshing...', 'warning');
				await refreshMatches();
			}
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Verify match state changed to expected value
async function verifyMatchState(matchId, expectedState, maxRetries = 3) {
	for (let i = 0; i < maxRetries; i++) {
		// Wait before checking (increasing delay each retry)
		await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));

		try {
			const response = await fetch(`/api/matches/${selectedTournamentId}`);
			if (!response.ok) continue;

			const data = await response.json();
			if (!data.success) continue;

			const match = data.matches.find(m => m.id === matchId);
			const actualState = match ? getEffectiveState(match) : null;

			if (actualState === expectedState) {
				// Update local state
				matches = data.matches;
				updateStats();
				renderMatches();
				return true;
			}

			console.log(`Verify attempt ${i + 1}: match effective state is '${actualState}', expected '${expectedState}', underwayAt: ${match?.underwayAt}`);
		} catch (error) {
			console.error('Verification fetch error:', error);
		}
	}

	// Final refresh even if verification failed
	await refreshMatches();
	return false;
}

// Unmark match as underway (return to open)
async function unmarkUnderway(matchId) {
	if (!selectedTournamentId) return;

	const match = matches.find(m => m.id === matchId);
	if (!match) return;

	const player1 = getPlayerName(match.player1Id);
	const player2 = getPlayerName(match.player2Id);

	if (!confirm(`Stop match between ${player1} and ${player2}?\n\nThis will return the match to "Open" status.`)) {
		return;
	}

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/${matchId}/unmark-underway`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();
		console.log('Unmark underway response:', data);

		if (data.success) {
			// Verify the state change
			const verified = await verifyMatchState(matchId, 'open', 3);

			if (verified) {
				showAlert('Match returned to open status', 'success');
			} else {
				showAlert('Match unmarked, but state verification pending. Refreshing...', 'warning');
				await refreshMatches();
			}
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Show score modal
function showScoreModal(matchId) {
	const match = matches.find(m => m.id === matchId);
	if (!match) return;

	selectedMatch = match;
	const player1 = getPlayerName(match.player1Id);
	const player2 = getPlayerName(match.player2Id);

	// Update score entry player names
	document.getElementById('scorePlayer1Name').textContent = player1;
	document.getElementById('scorePlayer2Name').textContent = player2;

	// Update quick winner button names
	document.getElementById('quickPlayer1Name').textContent = player1;
	document.getElementById('quickPlayer2Name').textContent = player2;

	// Update forfeit button names
	const forfeit1El = document.getElementById('forfeitPlayer1Name');
	const forfeit2El = document.getElementById('forfeitPlayer2Name');
	if (forfeit1El) forfeit1El.textContent = player1;
	if (forfeit2El) forfeit2El.textContent = player2;

	// Parse existing scores
	let score1 = 0, score2 = 0;
	if (match.scores_csv) {
		const parts = match.scores_csv.split('-');
		if (parts.length === 2) {
			score1 = parseInt(parts[0]) || 0;
			score2 = parseInt(parts[1]) || 0;
		}
	}

	document.getElementById('scorePlayer1').value = score1;
	document.getElementById('scorePlayer2').value = score2;

	document.getElementById('scoreModal').classList.remove('hidden');
}

// Close score modal
function closeScoreModal() {
	selectedMatch = null;
	document.getElementById('scoreModal').classList.add('hidden');
}

// Adjust score
function adjustScore(player, delta) {
	const input = document.getElementById(`scorePlayer${player}`);
	let value = parseInt(input.value) || 0;
	value = Math.max(0, Math.min(99, value + delta));
	input.value = value;
}

// Submit score
async function submitScore() {
	if (!selectedMatch || !selectedTournamentId) return;

	const score1 = parseInt(document.getElementById('scorePlayer1').value) || 0;
	const score2 = parseInt(document.getElementById('scorePlayer2').value) || 0;
	const scores = `${score1}-${score2}`;

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/${selectedMatch.id}/score`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ scores })
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Score updated', 'success');
			closeScoreModal();
			await refreshMatches();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Declare winner based on score (automatically determines winner from higher score)
async function declareWinnerByScore() {
	if (!selectedMatch || !selectedTournamentId) return;

	const score1 = parseInt(document.getElementById('scorePlayer1').value) || 0;
	const score2 = parseInt(document.getElementById('scorePlayer2').value) || 0;
	const scores = `${score1}-${score2}`;

	// Determine winner based on scores
	let winnerId;
	let winnerName;
	if (score1 > score2) {
		winnerId = selectedMatch.player1Id;
		winnerName = getPlayerName(selectedMatch.player1Id);
	} else if (score2 > score1) {
		winnerId = selectedMatch.player2Id;
		winnerName = getPlayerName(selectedMatch.player2Id);
	} else {
		showAlert('Scores are tied. Please enter different scores to determine a winner.', 'error');
		return;
	}

	if (!confirm(`Declare ${winnerName} as the winner with score ${scores}?`)) return;

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/${selectedMatch.id}/winner`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ winnerId, scores })
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Winner declared', 'success');
			closeScoreModal();
			await refreshMatches();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Quick win - declare winner with 2-0 score in one click
async function quickWin(matchId, winnerId, scores) {
	if (!selectedTournamentId || !winnerId) return;

	const match = matches.find(m => m.id === matchId);
	if (!match) return;

	const winnerName = getPlayerName(winnerId);

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/${matchId}/winner`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ winnerId, scores })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`${winnerName} wins ${scores}!`, 'success');
			await refreshMatches();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Reopen a completed match
async function reopenMatch(matchId) {
	if (!selectedTournamentId) return;

	const match = matches.find(m => m.id === matchId);
	if (!match) return;

	const player1 = getPlayerName(match.player1Id);
	const player2 = getPlayerName(match.player2Id);

	if (!confirm(`Reopen match between ${player1} and ${player2}?\n\nThis will clear the result and reset any dependent matches.`)) {
		return;
	}

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/${matchId}/reopen`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();
		console.log('Reopen match response:', data);

		if (data.success) {
			showAlert('Match reopened', 'success');
			await refreshMatches();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Quick winner - declare winner with default score (scores are required)
async function quickWinner(playerNum) {
	if (!selectedMatch || !selectedTournamentId) return;

	const winnerId = playerNum === 1 ? selectedMatch.player1Id : selectedMatch.player2Id;
	// Default score: winner gets 1, loser gets 0
	const scores = playerNum === 1 ? '1-0' : '0-1';

	if (!confirm(`Declare ${getPlayerName(winnerId)} as the winner (score: ${scores})?`)) return;

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/${selectedMatch.id}/winner`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ winnerId, scores })
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Winner declared', 'success');
			closeScoreModal();
			await refreshMatches();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// DQ/Forfeit - advance winner due to opponent no-show or disqualification
async function forfeitMatch(playerNum) {
	if (!selectedMatch || !selectedTournamentId) return;

	const winnerId = playerNum === 1 ? selectedMatch.player1Id : selectedMatch.player2Id;
	const loserId = playerNum === 1 ? selectedMatch.player2Id : selectedMatch.player1Id;
	const winnerName = getPlayerName(winnerId);
	const loserName = getPlayerName(loserId);

	if (!confirm(`Forfeit match?\n\n${loserName} will be marked as DQ/no-show.\n${winnerName} advances with a 0-0 score.`)) return;

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/${selectedMatch.id}/dq`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ winnerId, loserId })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`${winnerName} advances (opponent forfeited)`, 'success');
			closeScoreModal();
			await refreshMatches();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Clear scores from a match
async function clearScores() {
	if (!selectedMatch || !selectedTournamentId) return;

	if (!confirm('Clear scores from this match?\n\nThe match state will be preserved.')) return;

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/${selectedMatch.id}/clear-scores`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Scores cleared', 'success');
			// Reset score inputs
			document.getElementById('scorePlayer1').value = 0;
			document.getElementById('scorePlayer2').value = 0;
			await refreshMatches();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Assign station to a match
async function assignStation(matchId, stationId) {
	if (!selectedTournamentId) return;

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/${matchId}/station`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ stationId: stationId || null })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(stationId ? 'Station assigned' : 'Station unassigned', 'success');
			await refreshMatches();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Get station name by ID
function getStationName(stationId) {
	if (!stationId) return null;
	const station = stations.find(s => s.id === stationId || s.id === String(stationId));
	return station ? station.name : null;
}

// Note: escapeHtml and showAlert are now in utils.js

// ============================================
// STATION MANAGEMENT FUNCTIONS
// ============================================

// Refresh stations and settings
async function refreshStations() {
	if (!selectedTournamentId) return;

	// Show loading state
	const btn = document.getElementById('refreshStationsBtn');
	const icon = document.getElementById('refreshStationsIcon');
	const text = document.getElementById('refreshStationsText');
	if (btn) btn.disabled = true;
	if (icon) icon.classList.add('animate-spin');
	if (text) text.textContent = 'Refreshing...';

	try {
		// Load stations
		const stationsResponse = await fetch(`/api/stations/${selectedTournamentId}`);
		if (stationsResponse.ok) {
			const data = await stationsResponse.json();
			if (data.success) {
				stations = data.stations || [];
				renderStations();
			}
		}

		// Load station settings
		const settingsResponse = await fetch(`/api/tournament/${selectedTournamentId}/station-settings`);
		if (settingsResponse.ok) {
			const data = await settingsResponse.json();
			if (data.success) {
				stationSettings = data.stationSettings || { autoAssign: false, onlyStartWithStations: false };
				updateStationSettingsUI();
			}
		}
	} catch (error) {
		console.error('Failed to load stations:', error);
	} finally {
		// Reset loading state
		if (btn) btn.disabled = false;
		if (icon) icon.classList.remove('animate-spin');
		if (text) text.textContent = 'Refresh';
	}
}

// Render station list
function renderStations() {
	const container = document.getElementById('stationList');
	if (!container) return;

	if (stations.length === 0) {
		container.innerHTML = `
			<div class="bg-gray-750 rounded-lg p-4 border border-gray-600 text-center text-gray-400">
				No stations configured. Add TV 1 and TV 2 to enable match assignments.
			</div>
		`;
		return;
	}

	container.innerHTML = stations.map(station => `
		<div class="bg-gray-750 rounded-lg p-3 border border-gray-600 flex items-center justify-between">
			<div class="flex items-center gap-3">
				<svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
				</svg>
				<span class="text-white font-medium">${escapeHtml(station.name)}</span>
			</div>
			<button onclick="deleteStation('${station.id}', '${escapeHtml(station.name)}')"
				class="text-red-400 hover:text-red-300 p-1" title="Delete station">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
				</svg>
			</button>
		</div>
	`).join('');
}

// Update station settings UI
function updateStationSettingsUI() {
	const toggle = document.getElementById('autoAssignToggle');
	const note = document.getElementById('autoAssignNote');

	if (toggle) {
		toggle.checked = stationSettings.autoAssign;
	}

	if (note) {
		if (tournamentState === 'underway') {
			note.textContent = 'Note: Tournament must be reset to change this setting';
		} else {
			note.textContent = '';
		}
	}
}

// Create a new station
async function createStation() {
	if (!selectedTournamentId) return;

	const input = document.getElementById('newStationName');
	const name = input?.value?.trim();

	if (!name) {
		showAlert('Please enter a station name', 'error');
		return;
	}

	try {
		const response = await csrfFetch(`/api/stations/${selectedTournamentId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Station "${name}" created`, 'success');
			input.value = '';
			await refreshStations();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Delete a station
async function deleteStation(stationId, stationName) {
	if (!selectedTournamentId) return;

	if (!confirm(`Delete station "${stationName}"?`)) return;

	try {
		const response = await csrfFetch(`/api/stations/${selectedTournamentId}/${stationId}`, {
			method: 'DELETE'
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Station deleted', 'success');
			await refreshStations();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Toggle auto-assign setting
async function toggleAutoAssign() {
	if (!selectedTournamentId) return;

	const toggle = document.getElementById('autoAssignToggle');
	const newValue = toggle?.checked || false;

	try {
		const response = await csrfFetch(`/api/tournament/${selectedTournamentId}/station-settings`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ autoAssign: newValue })
		});

		const data = await response.json();

		if (data.success) {
			stationSettings = data.stationSettings || stationSettings;
			showAlert(newValue ? 'Auto-assign enabled' : 'Auto-assign disabled', 'success');
			updateStationSettingsUI();

			// If enabled, immediately trigger auto-assign for existing open matches
			if (newValue) {
				try {
					const autoResponse = await csrfFetch(`/api/matches/${selectedTournamentId}/auto-assign`, {
						method: 'POST'
					});
					const autoData = await autoResponse.json();
					if (autoData.success && autoData.assigned > 0) {
						showAlert(`Auto-assigned ${autoData.assigned} match(es) to stations`, 'success');
						loadMatches(); // Refresh to show new assignments
					}
				} catch (autoError) {
					console.error('Auto-assign error:', autoError);
				}
			}
		} else {
			// Revert toggle on failure
			if (toggle) toggle.checked = !newValue;
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		// Revert toggle on error
		const toggle = document.getElementById('autoAssignToggle');
		if (toggle) toggle.checked = !newValue;
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// ============================================
// BATCH SCORE ENTRY
// ============================================

let batchScoreMatches = [];

// Open batch score modal
function openBatchScoreModal() {
	if (!selectedTournamentId) {
		showAlert('Please select a tournament first', 'error');
		return;
	}

	// Filter matches that can be scored (open or underway, with both players)
	batchScoreMatches = matches.filter(m =>
		(m.state === 'open' || m.state === 'underway') &&
		m.player1Id && m.player2Id
	).slice(0, 20); // Limit to 20 matches

	if (batchScoreMatches.length === 0) {
		showAlert('No scorable matches available', 'info');
		return;
	}

	renderBatchScoreTable();
	document.getElementById('batchScoreModal').classList.remove('hidden');
}

// Close batch score modal
function closeBatchScoreModal() {
	document.getElementById('batchScoreModal').classList.add('hidden');
	batchScoreMatches = [];
}

// Render batch score table
function renderBatchScoreTable() {
	const tbody = document.getElementById('batchScoreTableBody');
	if (!tbody) return;

	tbody.innerHTML = batchScoreMatches.map((match, index) => {
		const p1Name = getPlayerName(match.player1Id);
		const p2Name = getPlayerName(match.player2Id);
		const roundLabel = match.round > 0 ? `W${match.round}` : `L${Math.abs(match.round)}`;
		const isUnderway = match.state === 'underway';

		return `
			<tr class="border-b border-gray-700" data-match-id="${match.id}" data-index="${index}">
				<td class="px-2 py-2 text-gray-400 text-sm">
					${roundLabel}
					${isUnderway ? '<span class="text-yellow-400 text-xs ml-1">(live)</span>' : ''}
				</td>
				<td class="px-2 py-2">
					<span class="text-white text-sm truncate block max-w-[120px]" title="${escapeHtml(p1Name)}">${escapeHtml(p1Name)}</span>
				</td>
				<td class="px-2 py-2 text-center">
					<input type="number" min="0" max="99" value=""
						class="batch-score-input w-12 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-center text-white"
						data-player="1" data-match-index="${index}"
						onchange="validateBatchRow(${index})"
						onkeydown="handleBatchScoreKeydown(event, ${index}, 1)">
				</td>
				<td class="px-2 py-2 text-center text-gray-500">-</td>
				<td class="px-2 py-2 text-center">
					<input type="number" min="0" max="99" value=""
						class="batch-score-input w-12 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-center text-white"
						data-player="2" data-match-index="${index}"
						onchange="validateBatchRow(${index})"
						onkeydown="handleBatchScoreKeydown(event, ${index}, 2)">
				</td>
				<td class="px-2 py-2">
					<span class="text-white text-sm truncate block max-w-[120px]" title="${escapeHtml(p2Name)}">${escapeHtml(p2Name)}</span>
				</td>
				<td class="px-2 py-2 text-center">
					<div class="flex gap-1 justify-center">
						<button onclick="setBatchWinner(${index}, 1)"
							class="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded text-white" title="Player 1 wins 2-0">P1</button>
						<button onclick="setBatchWinner(${index}, 2)"
							class="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded text-white" title="Player 2 wins 0-2">P2</button>
					</div>
				</td>
				<td class="px-2 py-2 text-center">
					<span class="batch-row-status text-xs" data-index="${index}"></span>
				</td>
			</tr>
		`;
	}).join('');

	updateBatchValidation();
}

// Quick winner button (2-0 score)
function setBatchWinner(index, playerNum) {
	const row = document.querySelector(`tr[data-index="${index}"]`);
	if (!row) return;

	const score1Input = row.querySelector('input[data-player="1"]');
	const score2Input = row.querySelector('input[data-player="2"]');

	if (playerNum === 1) {
		score1Input.value = 2;
		score2Input.value = 0;
	} else {
		score1Input.value = 0;
		score2Input.value = 2;
	}

	validateBatchRow(index);
}

// Validate a single row
function validateBatchRow(index) {
	const row = document.querySelector(`tr[data-index="${index}"]`);
	if (!row) return;

	const score1 = parseInt(row.querySelector('input[data-player="1"]').value);
	const score2 = parseInt(row.querySelector('input[data-player="2"]').value);
	const statusEl = row.querySelector('.batch-row-status');

	if (isNaN(score1) || isNaN(score2) || (score1 === '' && score2 === '')) {
		statusEl.textContent = '';
		statusEl.className = 'batch-row-status text-xs';
		row.classList.remove('bg-green-900/20', 'bg-red-900/20');
		return;
	}

	if (score1 === score2 && score1 !== 0) {
		statusEl.textContent = 'Tie';
		statusEl.className = 'batch-row-status text-xs text-red-400';
		row.classList.remove('bg-green-900/20');
		row.classList.add('bg-red-900/20');
	} else {
		const winner = score1 > score2 ? 'P1' : 'P2';
		statusEl.textContent = winner;
		statusEl.className = 'batch-row-status text-xs text-green-400';
		row.classList.remove('bg-red-900/20');
		row.classList.add('bg-green-900/20');
	}

	updateBatchValidation();
}

// Update validation summary
function updateBatchValidation() {
	const validCount = getValidBatchEntries().length;
	const totalCount = batchScoreMatches.length;
	const validationText = document.getElementById('batchValidationText');
	const submitBtn = document.getElementById('batchSubmitBtn');

	if (validationText) {
		validationText.textContent = `${validCount} of ${totalCount} ready to submit`;
	}

	if (submitBtn) {
		submitBtn.disabled = validCount === 0;
	}
}

// Get all valid batch entries
function getValidBatchEntries() {
	const entries = [];

	batchScoreMatches.forEach((match, index) => {
		const row = document.querySelector(`tr[data-index="${index}"]`);
		if (!row) return;

		const score1 = parseInt(row.querySelector('input[data-player="1"]').value);
		const score2 = parseInt(row.querySelector('input[data-player="2"]').value);

		// Skip empty rows
		if (isNaN(score1) || isNaN(score2)) return;

		// Skip ties (except 0-0 forfeit)
		if (score1 === score2 && score1 !== 0) return;

		// Determine winner
		const winnerId = score1 > score2 ? match.player1Id : match.player2Id;

		entries.push({
			matchId: match.id,
			winnerId,
			score1,
			score2
		});
	});

	return entries;
}

// Handle keyboard navigation in batch score inputs
function handleBatchScoreKeydown(event, index, playerNum) {
	if (event.key === 'Tab') {
		// Let default tab behavior work
		return;
	}

	if (event.key === 'Enter') {
		if (event.ctrlKey || event.metaKey) {
			// Ctrl+Enter submits all
			event.preventDefault();
			submitBatchScores();
		} else {
			// Enter moves to next row
			event.preventDefault();
			const nextIndex = index + 1;
			if (nextIndex < batchScoreMatches.length) {
				const nextInput = document.querySelector(`tr[data-index="${nextIndex}"] input[data-player="1"]`);
				if (nextInput) nextInput.focus();
			}
		}
	}

	if (event.key === 'ArrowDown') {
		event.preventDefault();
		const nextInput = document.querySelector(`tr[data-index="${index + 1}"] input[data-player="${playerNum}"]`);
		if (nextInput) nextInput.focus();
	}

	if (event.key === 'ArrowUp') {
		event.preventDefault();
		const prevInput = document.querySelector(`tr[data-index="${index - 1}"] input[data-player="${playerNum}"]`);
		if (prevInput) prevInput.focus();
	}
}

// Submit all valid batch scores
async function submitBatchScores() {
	const entries = getValidBatchEntries();

	if (entries.length === 0) {
		showAlert('No valid scores to submit', 'error');
		return;
	}

	const submitBtn = document.getElementById('batchSubmitBtn');
	const originalText = submitBtn.textContent;
	submitBtn.disabled = true;
	submitBtn.textContent = 'Submitting...';

	try {
		const response = await csrfFetch(`/api/matches/${selectedTournamentId}/batch-scores`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ scores: entries })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`All ${data.succeeded} scores submitted successfully`, 'success');
			closeBatchScoreModal();
			await refreshMatches();
		} else if (data.succeeded > 0) {
			// Partial success
			showAlert(`${data.succeeded} succeeded, ${data.failed} failed`, 'warning');
			handleBatchResults(data.results);
			await refreshMatches();
		} else {
			showAlert(`Failed to submit scores: ${data.error || 'Unknown error'}`, 'error');
			if (data.results) {
				handleBatchResults(data.results);
			}
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	} finally {
		submitBtn.disabled = false;
		submitBtn.textContent = originalText;
	}
}

// Handle batch results - show success/failure per row
function handleBatchResults(results) {
	results.forEach(result => {
		const match = batchScoreMatches.find(m => m.id === result.matchId);
		if (!match) return;

		const index = batchScoreMatches.indexOf(match);
		const row = document.querySelector(`tr[data-index="${index}"]`);
		if (!row) return;

		const statusEl = row.querySelector('.batch-row-status');

		if (result.success) {
			statusEl.textContent = 'Done';
			statusEl.className = 'batch-row-status text-xs text-green-400';
			row.classList.add('opacity-50');
			// Disable inputs for completed rows
			row.querySelectorAll('input').forEach(input => input.disabled = true);
			row.querySelectorAll('button').forEach(btn => btn.disabled = true);
		} else {
			statusEl.textContent = 'Error';
			statusEl.className = 'batch-row-status text-xs text-red-400';
			statusEl.title = result.error || 'Unknown error';
		}
	});

	updateBatchValidation();
}

// Keyboard shortcut for opening batch score modal (Ctrl+Shift+S)
document.addEventListener('keydown', (event) => {
	if (event.ctrlKey && event.shiftKey && event.key === 'S') {
		event.preventDefault();
		openBatchScoreModal();
	}
});

// ============================================
// SWIPE GESTURE SUPPORT FOR MOBILE
// ============================================

const filterOrder = ['all', 'open', 'underway', 'complete'];
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
const SWIPE_THRESHOLD = 50;
const SWIPE_VERTICAL_LIMIT = 100; // Ignore if vertical swipe is too large

function initSwipeGestures() {
	const matchList = document.getElementById('matchList');
	if (!matchList) return;

	matchList.addEventListener('touchstart', handleTouchStart, { passive: true });
	matchList.addEventListener('touchend', handleTouchEnd, { passive: true });
}

function handleTouchStart(e) {
	touchStartX = e.changedTouches[0].screenX;
	touchStartY = e.changedTouches[0].screenY;
}

function handleTouchEnd(e) {
	touchEndX = e.changedTouches[0].screenX;
	touchEndY = e.changedTouches[0].screenY;
	handleSwipeGesture();
}

function handleSwipeGesture() {
	const deltaX = touchEndX - touchStartX;
	const deltaY = Math.abs(touchEndY - touchStartY);

	// Ignore if vertical movement is too large (user is scrolling)
	if (deltaY > SWIPE_VERTICAL_LIMIT) return;

	// Check if horizontal swipe exceeds threshold
	if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
		const currentIndex = filterOrder.indexOf(currentFilter);

		if (deltaX < 0) {
			// Swipe left - next filter
			const nextIndex = (currentIndex + 1) % filterOrder.length;
			filterMatches(filterOrder[nextIndex]);
		} else {
			// Swipe right - previous filter
			const prevIndex = (currentIndex - 1 + filterOrder.length) % filterOrder.length;
			filterMatches(filterOrder[prevIndex]);
		}
	}
}

// Initialize swipe gestures after DOM loaded
document.addEventListener('DOMContentLoaded', () => {
	// Small delay to ensure matchList is rendered
	setTimeout(initSwipeGestures, 100);
});

// Reinitialize swipe gestures when matches are rendered
const originalRenderMatches = renderMatches;
renderMatches = function() {
	originalRenderMatches();
	initSwipeGestures();
};

// Export functions
window.loadTournaments = loadTournaments;
window.loadTournamentMatches = loadTournamentMatches;
window.refreshMatches = refreshMatches;
window.filterMatches = filterMatches;
window.showUnderwayModal = showUnderwayModal;
window.closeUnderwayModal = closeUnderwayModal;
window.confirmMarkUnderway = confirmMarkUnderway;
window.unmarkUnderway = unmarkUnderway;
window.showScoreModal = showScoreModal;
window.closeScoreModal = closeScoreModal;
window.adjustScore = adjustScore;
window.submitScore = submitScore;
window.declareWinnerByScore = declareWinnerByScore;
window.quickWinner = quickWinner;
window.reopenMatch = reopenMatch;
window.refreshStations = refreshStations;
window.createStation = createStation;
window.deleteStation = deleteStation;
window.toggleAutoAssign = toggleAutoAssign;
window.forfeitMatch = forfeitMatch;
window.clearScores = clearScores;
window.assignStation = assignStation;
window.getStationName = getStationName;

// Cleanup all intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	if (refreshInterval) clearInterval(refreshInterval);
});
