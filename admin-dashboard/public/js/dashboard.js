// Tournament Control Center - Main Dashboard JavaScript
// This is the streamlined dashboard for quick overview

// State management
let currentStatus = null;
let activeTournament = null;
let statusRefreshInterval = null;
let statsRefreshInterval = null;
let piDisplaysInterval = null;
let participantsLookup = {};
let wsConnected = false;

// DQ Timer state tracking for toggle functionality
const dqTimerState = {
	'TV 1': { active: false, timeoutId: null },
	'TV 2': { active: false, timeoutId: null }
};

// Initialize dashboard on page load
document.addEventListener('DOMContentLoaded', async () => {
	FrontendDebug.log('Dashboard', 'Initializing dashboard...');

	// Initialize last updated timestamps
	initLastUpdated('lastRefreshed', refreshAllStatus, { prefix: 'Updated', thresholds: { fresh: 15, stale: 60 } });

	// Load initial data
	FrontendDebug.api('Dashboard', 'Loading initial data...');
	await refreshAllStatus();
	await loadActiveTournament();
	await loadPiDisplays();

	// Setup visibility handler
	setupVisibilityHandler();

	// Initialize ticker character counter
	initTickerCharCounter();

	// Initialize WebSocket for real-time updates
	initWebSocket();

	// Start auto-refresh intervals (optimized from 5s/10s to 10s/15s)
	startPolling();

	FrontendDebug.log('Dashboard', 'Initialization complete', { wsConnected });
});

// WebSocket initialization for real-time updates
function initWebSocket() {
	if (!WebSocketManager.init()) {
		FrontendDebug.warn('Dashboard', 'WebSocket not available, using polling');
		return;
	}

	// Subscribe to tournament events
	WebSocketManager.subscribeMany({
		[WS_EVENTS.TOURNAMENT_CREATED]: handleTournamentEvent,
		[WS_EVENTS.TOURNAMENT_UPDATED]: handleTournamentEvent,
		[WS_EVENTS.TOURNAMENT_DELETED]: handleTournamentEvent,
		[WS_EVENTS.TOURNAMENT_STARTED]: handleTournamentEvent,
		[WS_EVENTS.TOURNAMENT_RESET]: handleTournamentEvent,
		[WS_EVENTS.TOURNAMENT_COMPLETED]: handleTournamentEvent,
		'tournament:update': handleTournamentEvent,
		'tournament:deployed': handleTournamentDeployed
	});

	// Subscribe to match events
	WebSocketManager.subscribeMany({
		[WS_EVENTS.MATCH_UPDATED]: handleMatchEvent,
		[WS_EVENTS.MATCH_COMPLETED]: handleMatchEvent,
		[WS_EVENTS.MATCH_UNDERWAY]: handleMatchEvent,
		'matches:update': handleMatchEvent
	});

	// Subscribe to display events
	WebSocketManager.subscribeMany({
		[WS_EVENTS.DISPLAY_REGISTERED]: handleDisplayEvent,
		[WS_EVENTS.DISPLAY_HEARTBEAT]: handleDisplayEvent,
		'displays:update': handleDisplayEvent
	});

	// Subscribe to participant events
	WebSocketManager.subscribeMany({
		[WS_EVENTS.PARTICIPANT_ADDED]: handleParticipantEvent,
		[WS_EVENTS.PARTICIPANT_UPDATED]: handleParticipantEvent,
		[WS_EVENTS.PARTICIPANT_DELETED]: handleParticipantEvent,
		[WS_EVENTS.PARTICIPANT_CHECKIN]: handleParticipantEvent,
		'participants:update': handleParticipantEvent
	});

	WebSocketManager.onConnection('connect', () => {
		FrontendDebug.ws('Dashboard', 'WebSocket connected');
		wsConnected = true;
		// Reduce polling when connected
		stopPolling();
		startPolling(30000, 45000, 45000); // Slower polling when WS connected
	});

	WebSocketManager.onConnection('disconnect', () => {
		FrontendDebug.ws('Dashboard', 'WebSocket disconnected');
		wsConnected = false;
		// Increase polling when disconnected
		stopPolling();
		startPolling(10000, 15000, 15000); // Back to normal polling
	});
}

// Handle tournament events
function handleTournamentEvent(data) {
	FrontendDebug.ws('Dashboard', 'Tournament event received', data);
	loadActiveTournament();
	refreshAllStatus();
}

// Handle match events
function handleMatchEvent(data) {
	FrontendDebug.ws('Dashboard', 'Match event received', data);
	// Refresh match stats and live matches
	if (activeTournament?.tournamentId) {
		loadMatchStats(activeTournament.tournamentId);
		loadLiveMatches();
	}
}

// Handle display events
function handleDisplayEvent(data) {
	FrontendDebug.ws('Dashboard', 'Display event received', data);
	loadPiDisplays();
	refreshAllStatus();
}

// Handle participant events
function handleParticipantEvent(data) {
	FrontendDebug.ws('Dashboard', 'Participant event received', data);
	if (activeTournament?.tournamentId) {
		loadParticipantStats(activeTournament.tournamentId);
	}
}

// Handle tournament deployed event (from tournament page deploy button)
async function handleTournamentDeployed(data) {
	FrontendDebug.ws('Dashboard', 'Tournament deployed event received', data);
	// Refresh status first to get updated state file, then load active tournament
	await refreshAllStatus();
	await loadActiveTournament();
}

// Start polling with configurable intervals
function startPolling(statusInterval = 10000, tournamentInterval = 15000, displaysInterval = 15000) {
	if (!statusRefreshInterval) {
		statusRefreshInterval = setInterval(refreshAllStatus, statusInterval);
	}
	if (!statsRefreshInterval) {
		statsRefreshInterval = setInterval(loadActiveTournament, tournamentInterval);
	}
	if (!piDisplaysInterval) {
		piDisplaysInterval = setInterval(loadPiDisplays, displaysInterval);
	}
}

// Stop all polling
function stopPolling() {
	if (statusRefreshInterval) {
		clearInterval(statusRefreshInterval);
		statusRefreshInterval = null;
	}
	if (statsRefreshInterval) {
		clearInterval(statsRefreshInterval);
		statsRefreshInterval = null;
	}
	if (piDisplaysInterval) {
		clearInterval(piDisplaysInterval);
		piDisplaysInterval = null;
	}
}

// Setup Page Visibility API
function setupVisibilityHandler() {
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			// Pause polling when tab hidden
			stopPolling();
		} else {
			// Resume polling immediately when tab becomes visible
			refreshAllStatus();
			loadActiveTournament();
			loadPiDisplays();
			// Use appropriate polling intervals based on WebSocket connection state
			if (wsConnected) {
				startPolling(30000, 45000, 45000); // Slower polling when WS connected
			} else {
				startPolling(10000, 15000, 15000); // Normal polling
			}
		}
	});
}

// Cleanup all intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	if (statusRefreshInterval) clearInterval(statusRefreshInterval);
	if (statsRefreshInterval) clearInterval(statsRefreshInterval);
	if (piDisplaysInterval) clearInterval(piDisplaysInterval);
	// Clear DQ timer timeouts
	Object.values(dqTimerState).forEach(state => {
		if (state.timeoutId) clearTimeout(state.timeoutId);
	});
});

// Refresh all system status
async function refreshAllStatus() {
	FrontendDebug.api('Dashboard', 'Fetching system status...');
	try {
		const response = await fetch('/api/status', { timeout: 10000 });

		if (!response.ok) {
			if (response.status === 401) {
				FrontendDebug.warn('Dashboard', 'Unauthorized - redirecting to login');
				window.location.href = '/login.html';
				return;
			}
			throw new Error(`HTTP ${response.status}`);
		}

		const data = await response.json();

		if (data.success) {
			currentStatus = data;
			FrontendDebug.api('Dashboard', 'Status fetched successfully', {
				matchOnline: data.modules?.match?.status?.running,
				bracketOnline: data.modules?.bracket?.status?.running,
				flyerOnline: data.modules?.flyer?.status?.running
			});
			updateStatusCards(data);
		}
	} catch (error) {
		FrontendDebug.error('Dashboard', 'Status refresh failed', error.message);
		updateStatusCards(null);
	}

	// Update last refreshed timestamp
	setLastUpdated('lastRefreshed');

	// Also refresh database status
	loadDatabaseStatus();
}

// Update the compact status cards
function updateStatusCards(data) {
	const matchCard = document.getElementById('statusMatch');
	const bracketCard = document.getElementById('statusBracket');
	const flyerCard = document.getElementById('statusFlyer');

	if (!data) {
		// Show offline state
		[matchCard, bracketCard, flyerCard].forEach(card => {
			if (card) {
				card.classList.remove('online');
				card.classList.add('offline');
				const indicator = card.querySelector('.status-indicator');
				if (indicator) {
					indicator.classList.remove('online', 'bg-gray-500');
					indicator.classList.add('offline');
				}
			}
		});
		return;
	}

	// Get tournament name from activeTournament if available
	const tournamentName = activeTournament?.name || null;

	// Match Display
	if (matchCard) {
		const matchOnline = data.modules?.match?.status?.running;
		const matchState = data.modules?.match?.state;

		matchCard.classList.toggle('online', matchOnline);
		matchCard.classList.toggle('offline', !matchOnline);

		const indicator = matchCard.querySelector('.status-indicator');
		if (indicator) {
			indicator.classList.remove('bg-gray-500', 'online', 'offline');
			indicator.classList.add(matchOnline ? 'online' : 'offline');
		}

		const tournamentEl = matchCard.querySelector('.status-tournament');
		if (tournamentEl) {
			// Show tournament name if available, otherwise show ID
			tournamentEl.textContent = tournamentName || matchState?.tournamentId || '--';
		}
	}

	// Bracket Display
	if (bracketCard) {
		const bracketOnline = data.modules?.bracket?.status?.running;
		const bracketState = data.modules?.bracket?.state;

		bracketCard.classList.toggle('online', bracketOnline);
		bracketCard.classList.toggle('offline', !bracketOnline);

		const indicator = bracketCard.querySelector('.status-indicator');
		if (indicator) {
			indicator.classList.remove('bg-gray-500', 'online', 'offline');
			indicator.classList.add(bracketOnline ? 'online' : 'offline');
		}

		const bracketEl = bracketCard.querySelector('.status-bracket');
		if (bracketEl) {
			// Show tournament name if available, otherwise extract from URL
			if (tournamentName) {
				bracketEl.textContent = tournamentName;
			} else if (bracketState?.bracketUrl) {
				// Fallback: extract tournament slug from URL
				const urlParts = bracketState.bracketUrl.split('/');
				const slug = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
				bracketEl.textContent = slug || 'configured';
			} else {
				bracketEl.textContent = '--';
			}
		}
	}

	// Flyer Display
	if (flyerCard) {
		const flyerOnline = data.modules?.flyer?.status?.running;
		const flyerState = data.modules?.flyer?.state;

		flyerCard.classList.toggle('online', flyerOnline);
		flyerCard.classList.toggle('offline', !flyerOnline);

		const indicator = flyerCard.querySelector('.status-indicator');
		if (indicator) {
			indicator.classList.remove('bg-gray-500', 'online', 'offline');
			indicator.classList.add(flyerOnline ? 'online' : 'offline');
		}

		const flyerEl = flyerCard.querySelector('.status-flyer');
		if (flyerEl) {
			flyerEl.textContent = flyerState?.flyer || '--';
		}
	}
}

// Load active tournament info
async function loadActiveTournament() {
	FrontendDebug.api('Dashboard', 'Loading active tournament...');
	try {
		const response = await fetch('/api/tournaments?days=30');
		if (!response.ok) {
			FrontendDebug.warn('Dashboard', 'Tournament fetch failed', response.status);
			return;
		}

		const data = await response.json();
		if (!data.success) {
			FrontendDebug.warn('Dashboard', 'Tournament fetch returned success=false');
			return;
		}

		const inProgress = data.tournaments?.inProgress || [];
		const pending = data.tournaments?.pending || [];
		FrontendDebug.api('Dashboard', 'Tournaments loaded', { inProgress: inProgress.length, pending: pending.length });

		// Check if there's an active tournament from status
		let activeTournamentId = null;
		if (currentStatus?.modules?.match?.state?.tournamentId) {
			activeTournamentId = currentStatus.modules.match.state.tournamentId;
		}

		// Find the active tournament
		let tournament = inProgress[0];
		if (!tournament && activeTournamentId) {
			tournament = [...inProgress, ...pending].find(t => t.tournamentId === activeTournamentId);
		}

		// Check if tournament changed
		const previousTournamentId = activeTournament?.tournamentId;

		// Store the active tournament globally
		activeTournament = tournament || null;
		FrontendDebug.state('Dashboard', 'Active tournament set', {
			id: activeTournament?.tournamentId,
			name: activeTournament?.name,
			state: activeTournament?.state
		});

		// Clear participants lookup if tournament changed
		if (activeTournament?.tournamentId !== previousTournamentId) {
			FrontendDebug.state('Dashboard', 'Tournament changed, clearing participant lookup');
			participantsLookup = {};
		}

		updateTournamentSection(tournament, activeTournamentId);

		// Update status cards with tournament name now that we have it
		if (currentStatus) {
			updateStatusCards(currentStatus);
		}

		// Load match stats if there's an active tournament
		if (activeTournamentId) {
			await loadMatchStats(activeTournamentId);
		}
	} catch (error) {
		FrontendDebug.error('Dashboard', 'Failed to load tournament', error.message);
	}
}

// Update tournament section UI
function updateTournamentSection(tournament, activeTournamentId) {
	const nameEl = document.getElementById('activeTournamentName');
	const gameEl = document.getElementById('activeTournamentGame');
	const badgeEl = document.getElementById('tournamentStateBadge');
	const statsEl = document.getElementById('tournamentQuickStats');
	const ctaEl = document.getElementById('noTournamentCTA');
	const copyBtn = document.getElementById('copyTournamentId');
	const quickStartBtn = document.getElementById('quickStartBtn');

	if (tournament) {
		// Valid tournament found - show tournament info
		if (nameEl) nameEl.textContent = tournament.name;
		if (gameEl) gameEl.textContent = tournament.game || 'Tournament';

		// Show copy button
		if (copyBtn) copyBtn.classList.remove('hidden');

		// Show/hide quick start button based on state
		if (quickStartBtn) {
			if (tournament.state === 'pending') {
				quickStartBtn.classList.remove('hidden');
			} else {
				quickStartBtn.classList.add('hidden');
			}
		}

		// Update state badge
		if (badgeEl) {
			badgeEl.classList.remove('hidden');
			badgeEl.textContent = tournament.state;

			// Style based on state
			badgeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold uppercase';
			if (tournament.state === 'underway') {
				badgeEl.classList.add('bg-green-600/20', 'text-green-400');
			} else if (tournament.state === 'pending') {
				badgeEl.classList.add('bg-yellow-600/20', 'text-yellow-400');
			} else {
				badgeEl.classList.add('bg-gray-600/20', 'text-gray-400');
			}
		}

		// Show stats section, hide CTA
		if (statsEl) statsEl.classList.remove('hidden');
		if (ctaEl) ctaEl.classList.add('hidden');

		// Update participant count
		const participantsEl = document.getElementById('statParticipants');
		if (participantsEl) {
			participantsEl.textContent = tournament.participants || '--';
		}

		// Load additional data based on tournament state
		if (tournament.state === 'underway') {
			loadLiveMatches();
		} else {
			// Hide live matches for non-underway tournaments
			const liveSection = document.getElementById('liveMatchPreviewSection');
			if (liveSection) liveSection.classList.add('hidden');
		}
	} else if (activeTournamentId) {
		// State file has tournament ID but tournament not found (deleted or invalid)
		if (nameEl) nameEl.textContent = 'Tournament Not Found';
		if (gameEl) gameEl.textContent = 'The configured tournament no longer exists';
		if (copyBtn) copyBtn.classList.add('hidden');
		if (quickStartBtn) quickStartBtn.classList.add('hidden');
		if (badgeEl) {
			badgeEl.classList.remove('hidden');
			badgeEl.textContent = 'invalid';
			badgeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold uppercase bg-red-600/20 text-red-400';
		}
		if (statsEl) statsEl.classList.add('hidden');
		if (ctaEl) ctaEl.classList.remove('hidden');
	} else {
		// No active tournament configured
		if (nameEl) nameEl.textContent = 'No Tournament Selected';
		if (gameEl) gameEl.textContent = 'Select a tournament from the Tournament page to get started';
		if (copyBtn) copyBtn.classList.add('hidden');
		if (quickStartBtn) quickStartBtn.classList.add('hidden');
		if (badgeEl) badgeEl.classList.add('hidden');
		if (statsEl) statsEl.classList.add('hidden');
		if (ctaEl) ctaEl.classList.remove('hidden');
	}
}

// Load match statistics and enhanced data
async function loadMatchStats(tournamentId) {
	try {
		const response = await fetch(`/api/matches/${tournamentId}/stats`);
		if (!response.ok) {
			updateMatchStats({ total: '--', completed: '--', remaining: '--', inProgress: '--', currentRound: '--' });
			return;
		}

		const data = await response.json();
		if (data.success) {
			updateMatchStats(data.stats);
		}
	} catch (error) {
		updateMatchStats({ total: '--', completed: '--', remaining: '--', inProgress: '--', currentRound: '--' });
	}

	// Also load participant stats for check-in count
	await loadParticipantStats(tournamentId);
}

// Load participant statistics (check-in counts)
async function loadParticipantStats(tournamentId) {
	const checkedInEl = document.getElementById('statCheckedIn');
	if (!checkedInEl) return;

	try {
		const response = await fetch(`/api/participants/${tournamentId}`);
		if (!response.ok) {
			checkedInEl.textContent = '--';
			return;
		}

		const data = await response.json();
		if (data.success && data.participants) {
			const total = data.participants.length;
			const checkedIn = data.participants.filter(p => p.checkedIn).length;
			checkedInEl.textContent = `${checkedIn}/${total}`;

			// Update participants lookup while we have the data
			participantsLookup = {};
			data.participants.forEach(p => {
				participantsLookup[p.id] = p.name || p.displayName || `Player ${p.id}`;
			});
		}
	} catch (error) {
		console.error('Failed to load participant stats:', error);
		checkedInEl.textContent = '--';
	}
}

// Update match stats UI
function updateMatchStats(stats) {
	const matchesEl = document.getElementById('statMatches');
	const completedEl = document.getElementById('statCompleted');
	const remainingEl = document.getElementById('statRemaining');
	const inProgressEl = document.getElementById('statInProgress');
	const currentRoundEl = document.getElementById('statCurrentRound');
	const timeEstimateEl = document.getElementById('statTimeEstimate');
	const underwayStatsRow = document.getElementById('underwayStatsRow');

	if (matchesEl) matchesEl.textContent = stats.total || '--';
	if (completedEl) completedEl.textContent = stats.completed || '--';
	if (remainingEl) remainingEl.textContent = stats.remaining || '--';
	if (inProgressEl) inProgressEl.textContent = stats.inProgress || '--';
	if (currentRoundEl) currentRoundEl.textContent = stats.currentRound || '--';

	// Calculate estimated time remaining
	if (timeEstimateEl && stats.completed > 0 && stats.remaining > 0 && stats.avgMatchTime) {
		const estimatedMinutes = Math.ceil((stats.remaining * stats.avgMatchTime) / 60);
		if (estimatedMinutes < 60) {
			timeEstimateEl.textContent = `~${estimatedMinutes}m`;
		} else {
			const hours = Math.floor(estimatedMinutes / 60);
			const mins = estimatedMinutes % 60;
			timeEstimateEl.textContent = `~${hours}h ${mins}m`;
		}
	} else if (timeEstimateEl) {
		timeEstimateEl.textContent = '--';
	}

	// Show underway stats row if tournament is active
	if (underwayStatsRow && activeTournament?.state === 'underway') {
		underwayStatsRow.classList.remove('hidden');
	} else if (underwayStatsRow) {
		underwayStatsRow.classList.add('hidden');
	}
}

// Note: escapeHtml and showAlert are now in utils.js

// Copy tournament ID to clipboard
async function copyTournamentId() {
	if (!activeTournament?.tournamentId) {
		showAlert('No tournament ID available', 'error');
		return;
	}

	try {
		await navigator.clipboard.writeText(activeTournament.tournamentId);
		showAlert('Tournament ID copied to clipboard', 'success');
	} catch (error) {
		console.error('Failed to copy:', error);
		showAlert('Failed to copy tournament ID', 'error');
	}
}

// Quick start tournament
async function quickStartTournament() {
	if (!activeTournament?.tournamentId) {
		showAlert('No tournament selected', 'error');
		return;
	}

	if (activeTournament.state !== 'pending') {
		showAlert('Tournament is not in pending state', 'error');
		return;
	}

	const btn = document.getElementById('quickStartBtn');
	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Starting...';
	}

	try {
		const response = await csrfFetch(`/api/tournament/${activeTournament.tournamentId}/start`, {
			method: 'POST'
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Tournament started successfully!', 'success');
			// Refresh to update UI
			await loadActiveTournament();
			await refreshAllStatus();
		} else {
			showAlert(data.error || 'Failed to start tournament', 'error');
		}
	} catch (error) {
		console.error('Failed to start tournament:', error);
		showAlert('Failed to start tournament', 'error');
	} finally {
		if (btn) {
			btn.disabled = false;
			btn.textContent = 'Start Tournament';
		}
	}
}

// Load participants for name lookups
async function loadParticipantsLookup() {
	if (!activeTournament?.tournamentId) return;

	try {
		const response = await fetch(`/api/participants/${activeTournament.tournamentId}`);
		if (!response.ok) return;

		const data = await response.json();
		if (data.success && data.participants) {
			// Create lookup map by participant ID
			participantsLookup = {};
			data.participants.forEach(p => {
				participantsLookup[p.id] = p.name || p.displayName || `Player ${p.id}`;
			});
		}
	} catch (error) {
		console.error('Failed to load participants:', error);
	}
}

// Get player name from lookup
function getPlayerName(playerId) {
	if (!playerId) return 'TBD';
	return participantsLookup[playerId] || `Player ${playerId}`;
}

// Load live matches (in-progress matches) and upcoming matches
async function loadLiveMatches() {
	if (!activeTournament?.tournamentId) return;

	const liveSection = document.getElementById('liveMatchPreviewSection');
	const liveList = document.getElementById('liveMatchesList');
	const liveCount = document.getElementById('liveMatchCount');
	const upcomingSection = document.getElementById('upcomingMatchesSection');
	const upcomingList = document.getElementById('upcomingMatchesList');
	const upcomingCount = document.getElementById('upcomingMatchCount');

	if (!liveSection || !liveList) return;

	try {
		// Load participants for name resolution if not already loaded
		if (Object.keys(participantsLookup).length === 0) {
			await loadParticipantsLookup();
		}

		const response = await fetch(`/api/matches/${activeTournament.tournamentId}`);
		if (!response.ok) return;

		const data = await response.json();
		if (!data.success || !data.matches) return;

		// Filter for in-progress matches (state = 'underway')
		const liveMatches = data.matches.filter(m =>
			m.state === 'underway'
		);

		// Filter for upcoming matches (open, has both players)
		const upcomingMatches = data.matches.filter(m =>
			m.state === 'open' && m.player1Id && m.player2Id
		).slice(0, 5); // Show top 5

		// Render live matches
		if (liveMatches.length === 0) {
			liveSection.classList.add('hidden');
		} else {
			liveSection.classList.remove('hidden');
			if (liveCount) liveCount.textContent = `${liveMatches.length} active`;

			liveList.innerHTML = liveMatches.map(match => {
				const p1Name = getPlayerName(match.player1Id);
				const p2Name = getPlayerName(match.player2Id);
				const scores = match.scoresCsv || '0-0';
				const station = match.stationName || '';
				const elapsed = formatElapsedTime(match.underwayAt);

				return `
					<div class="bg-gray-700 rounded-lg p-3 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
							<div>
								<div class="text-sm font-medium text-white">${escapeHtml(p1Name)} vs ${escapeHtml(p2Name)}</div>
								<div class="text-xs text-gray-400">Round ${match.round || '?'}${station ? ' - ' + escapeHtml(station) : ''}</div>
							</div>
						</div>
						<div class="text-right">
							<div class="text-sm font-mono text-yellow-400">${escapeHtml(scores)}</div>
							<div class="text-xs text-gray-500">${elapsed}</div>
						</div>
					</div>
				`;
			}).join('');
		}

		// Render upcoming matches
		if (upcomingSection && upcomingList) {
			if (upcomingMatches.length === 0) {
				upcomingSection.classList.add('hidden');
			} else {
				upcomingSection.classList.remove('hidden');
				if (upcomingCount) upcomingCount.textContent = `${upcomingMatches.length} waiting`;

				upcomingList.innerHTML = upcomingMatches.map(match => {
					const p1Name = getPlayerName(match.player1Id);
					const p2Name = getPlayerName(match.player2Id);
					const suggestedStation = match.stationName || '';

					return `
						<div class="bg-gray-700/50 rounded-lg p-3 flex items-center justify-between border border-gray-600/50">
							<div class="flex items-center gap-3">
								<div class="w-2 h-2 bg-gray-500 rounded-full"></div>
								<div>
									<div class="text-sm font-medium text-gray-300">${escapeHtml(p1Name)} vs ${escapeHtml(p2Name)}</div>
									<div class="text-xs text-gray-500">Round ${match.round || '?'}${suggestedStation ? ' - ' + escapeHtml(suggestedStation) : ''}</div>
								</div>
							</div>
							<div class="text-xs text-gray-500">Ready</div>
						</div>
					`;
				}).join('');
			}
		}
	} catch (error) {
		console.error('Failed to load live matches:', error);
	}
}

// Format elapsed time since a timestamp
function formatElapsedTime(timestamp) {
	if (!timestamp) return '';

	const start = new Date(timestamp);
	const now = new Date();
	const diffMs = now - start;

	if (diffMs < 0) return '';

	const diffSeconds = Math.floor(diffMs / 1000);
	const minutes = Math.floor(diffSeconds / 60);
	const seconds = diffSeconds % 60;

	if (minutes < 60) {
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	} else {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return `${hours}:${mins.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}
}

// ========================================
// PI DISPLAYS FUNCTIONS
// ========================================

// Load connected Pi displays
// Hides section if: no displays registered OR all displays offline (multi-tenant)
async function loadPiDisplays() {
	const grid = document.getElementById('piDisplaysGrid');
	const countEl = document.getElementById('piDisplaysCount');
	const section = document.getElementById('piDisplaysSection');

	if (!grid) return;

	try {
		const response = await fetch('/api/displays');
		if (!response.ok) {
			if (response.status === 401) return;
			throw new Error(`HTTP ${response.status}`);
		}

		const data = await response.json();
		const displays = data.success ? (data.displays || []) : [];

		// Determine visibility: hide if no displays OR all displays offline
		const hasDisplays = displays.length > 0;
		const anyOnline = displays.some(d => d.status === 'online');
		const shouldShow = hasDisplays && anyOnline;

		// Show/hide section based on display status
		if (section) {
			if (shouldShow) {
				section.classList.remove('hidden');
			} else {
				section.classList.add('hidden');
				return; // No need to render content if hidden
			}
		}

		// Update count
		const onlineCount = displays.filter(d => d.status === 'online').length;
		if (countEl) {
			countEl.textContent = `${onlineCount}/${displays.length} online`;
		}

		// Render display cards
		grid.innerHTML = displays.map(display => renderPiDisplayCard(display)).join('');
	} catch (error) {
		console.error('Failed to load Pi displays:', error);
		// On error, hide section
		if (section) {
			section.classList.add('hidden');
		}
	}
}

// Render a single Pi display card
function renderPiDisplayCard(display) {
	const isOnline = display.status === 'online';
	const statusColor = isOnline ? 'green' : 'red';
	const statusText = isOnline ? 'Online' : 'Offline';

	// Get metrics from systemInfo (heartbeat data)
	const metrics = display.systemInfo || {};
	const cpuTemp = metrics.cpuTemp ?? '--';
	const memoryUsage = metrics.memoryUsage ?? '--';
	const wifiQuality = metrics.wifiQuality ?? '--';
	const ssid = metrics.ssid || '--';
	const voltage = metrics.voltage ?? '--';
	const ip = display.ip || '--';
	const currentView = display.currentView || '--';

	// Color coding for temperature
	let tempColor = 'text-green-400';
	if (cpuTemp !== '--') {
		if (cpuTemp >= 70) tempColor = 'text-red-400';
		else if (cpuTemp >= 60) tempColor = 'text-yellow-400';
	}

	// Color coding for memory
	let memColor = 'text-green-400';
	if (memoryUsage !== '--') {
		if (memoryUsage >= 80) memColor = 'text-red-400';
		else if (memoryUsage >= 60) memColor = 'text-yellow-400';
	}

	// Color coding for WiFi
	let wifiColor = 'text-green-400';
	if (wifiQuality !== '--') {
		if (wifiQuality <= 30) wifiColor = 'text-red-400';
		else if (wifiQuality <= 60) wifiColor = 'text-yellow-400';
	}

	// Color coding for voltage (Pi 5 nominal is ~0.85V core)
	let voltageColor = 'text-green-400';
	if (voltage !== '--' && voltage > 0) {
		if (voltage < 0.8) voltageColor = 'text-red-400';
		else if (voltage < 0.82) voltageColor = 'text-yellow-400';
	}

	// View badge color
	const viewColors = {
		'match': 'bg-blue-600/20 text-blue-400',
		'bracket': 'bg-purple-600/20 text-purple-400',
		'flyer': 'bg-pink-600/20 text-pink-400'
	};
	const viewColor = viewColors[currentView] || 'bg-gray-600/20 text-gray-400';

	// Format voltage display
	const voltageDisplay = voltage !== '--' && voltage > 0 ? voltage.toFixed(2) + 'V' : '--';

	return `
		<div class="bg-gray-800 border border-gray-700 rounded-lg p-4 ${isOnline ? '' : 'opacity-60'}">
			<div class="flex items-center justify-between mb-2">
				<div class="flex items-center gap-2">
					<div class="w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-red-400'}"></div>
					<span class="font-semibold text-white">${escapeHtml(display.hostname || display.id)}</span>
				</div>
				<span class="px-2 py-0.5 rounded text-xs font-medium ${viewColor}">${escapeHtml(currentView)}</span>
			</div>
			<div class="text-xs text-gray-400 mb-3 font-mono">${escapeHtml(ip)}</div>
			<div class="grid grid-cols-2 gap-2 text-sm">
				<div class="flex items-center gap-2" title="CPU Temperature">
					<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
					</svg>
					<span class="${tempColor} font-mono">${cpuTemp}${cpuTemp !== '--' ? 'C' : ''}</span>
				</div>
				<div class="flex items-center gap-2" title="Memory Usage">
					<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
					</svg>
					<span class="${memColor} font-mono">${memoryUsage}${memoryUsage !== '--' ? '%' : ''}</span>
				</div>
				<div class="flex items-center gap-2" title="WiFi Quality">
					<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
					</svg>
					<span class="${wifiColor} font-mono">${wifiQuality}${wifiQuality !== '--' ? '%' : ''}</span>
				</div>
				<div class="flex items-center gap-2" title="Core Voltage">
					<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
					</svg>
					<span class="${voltageColor} font-mono">${voltageDisplay}</span>
				</div>
			</div>
			<div class="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-500 truncate" title="${escapeHtml(ssid)}">
				SSID: ${escapeHtml(ssid)}
			</div>
		</div>
	`;
}

// ========================================
// TICKER MESSAGE FUNCTIONS
// ========================================

// Initialize ticker character counter
function initTickerCharCounter() {
	const textarea = document.getElementById('tickerMessage');
	const charCount = document.getElementById('tickerCharCount');

	if (textarea && charCount) {
		textarea.addEventListener('input', () => {
			charCount.textContent = `${textarea.value.length}/200`;
		});
	}
}

// Set ticker message from preset button and send immediately
async function setTickerPreset(message) {
	const textarea = document.getElementById('tickerMessage');
	const charCount = document.getElementById('tickerCharCount');
	const durationInput = document.getElementById('tickerDuration');

	// Update textarea for visual feedback
	if (textarea) {
		textarea.value = message;
		if (charCount) {
			charCount.textContent = `${message.length}/200`;
		}
	}

	// Get duration and send immediately
	const duration = durationInput ? (parseInt(durationInput.value, 10) || 5) : 5;

	const statusEl = document.getElementById('tickerStatus');
	if (statusEl) {
		statusEl.innerHTML = `
			<div class="spinner-small"></div>
			<span class="text-sm text-yellow-400">Sending...</span>
		`;
	}

	try {
		const response = await csrfFetch('/api/ticker/send', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message, duration })
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Message sent to display', 'success');

			if (statusEl) {
				statusEl.innerHTML = `<span class="text-sm text-green-400">Sent!</span>`;
				setTimeout(() => {
					statusEl.innerHTML = `<span class="text-sm text-gray-400">Ready</span>`;
				}, 3000);
			}
		} else {
			showAlert(`Failed to send: ${data.error}`, 'error');
			if (statusEl) {
				statusEl.innerHTML = `<span class="text-sm text-red-400">Failed</span>`;
			}
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
		if (statusEl) {
			statusEl.innerHTML = `<span class="text-sm text-red-400">Error</span>`;
		}
	}
}

// Send custom ticker message
async function sendTickerMessage() {
	const messageInput = document.getElementById('tickerMessage');
	const durationInput = document.getElementById('tickerDuration');
	const statusEl = document.getElementById('tickerStatus');

	if (!messageInput || !durationInput) return;

	const message = messageInput.value.trim();
	const duration = parseInt(durationInput.value, 10) || 5;

	if (!message) {
		showAlert('Please enter a message', 'error');
		return;
	}

	if (statusEl) {
		statusEl.innerHTML = `
			<div class="spinner-small"></div>
			<span class="text-sm text-yellow-400">Sending...</span>
		`;
	}

	try {
		const response = await csrfFetch('/api/ticker/send', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message, duration })
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Message sent to display', 'success');
			messageInput.value = '';
			document.getElementById('tickerCharCount').textContent = '0/200';

			if (statusEl) {
				statusEl.innerHTML = `<span class="text-sm text-green-400">Sent!</span>`;
				setTimeout(() => {
					statusEl.innerHTML = `<span class="text-sm text-gray-400">Ready</span>`;
				}, 3000);
			}
		} else {
			showAlert(`Failed to send: ${data.error}`, 'error');
			if (statusEl) {
				statusEl.innerHTML = `<span class="text-sm text-red-400">Failed</span>`;
			}
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
		if (statusEl) {
			statusEl.innerHTML = `<span class="text-sm text-red-400">Error</span>`;
		}
	}
}

// ========================================
// TIMER FUNCTIONS
// ========================================

// Start DQ timer for a specific TV (3 minutes)
async function startDQTimer(tv) {
	const duration = 180; // 3 minutes in seconds

	try {
		const response = await csrfFetch('/api/timer/dq', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tv, duration })
		});

		const data = await response.json();

		if (data.success) {
			// Update state
			dqTimerState[tv].active = true;

			// Clear any existing timeout
			if (dqTimerState[tv].timeoutId) {
				clearTimeout(dqTimerState[tv].timeoutId);
			}

			// Set timeout to reset state when timer completes
			dqTimerState[tv].timeoutId = setTimeout(() => {
				dqTimerState[tv].active = false;
				dqTimerState[tv].timeoutId = null;
			}, duration * 1000);

			showAlert(`DQ timer started for ${tv}`, 'success');
		} else {
			showAlert(`Failed to start timer: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Hide DQ timer for a specific TV
async function hideDQTimer(tv) {
	try {
		const response = await csrfFetch('/api/timer/hide', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'dq', tv })
		});

		const data = await response.json();

		if (data.success) {
			// Update state
			dqTimerState[tv].active = false;

			// Clear the timeout
			if (dqTimerState[tv].timeoutId) {
				clearTimeout(dqTimerState[tv].timeoutId);
				dqTimerState[tv].timeoutId = null;
			}

			showAlert(`DQ timer hidden for ${tv}`, 'success');
		} else {
			showAlert(`Failed to hide timer: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Toggle DQ timer for a specific TV (start or hide)
async function toggleDQTimer(tv) {
	if (dqTimerState[tv].active) {
		await hideDQTimer(tv);
	} else {
		await startDQTimer(tv);
	}
}

// Start tournament timer with custom duration
async function startTournamentTimer() {
	const minutesInput = document.getElementById('tournamentTimerMinutes');
	if (!minutesInput) return;

	const minutes = parseInt(minutesInput.value, 10);
	if (!minutes || minutes < 1 || minutes > 60) {
		showAlert('Please enter a duration between 1 and 60 minutes', 'error');
		return;
	}

	const duration = minutes * 60; // Convert to seconds

	try {
		const response = await csrfFetch('/api/timer/tournament', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ duration })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Tournament timer started (${minutes} min)`, 'success');
		} else {
			showAlert(`Failed to start timer: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// ========================================
// DATABASE STATUS FUNCTIONS
// ========================================

// Load and display database status
async function loadDatabaseStatus() {
	const statusEl = document.getElementById('databaseStatus');
	const countEl = document.getElementById('databaseTournamentCount');
	const indicatorEl = document.getElementById('databaseStatusIndicator');

	if (!statusEl || !countEl) return;

	try {
		// Use existing /api/status endpoint which checks DB connectivity
		const response = await fetch('/api/status');
		if (!response.ok) {
			if (response.status === 401) return;
			throw new Error(`HTTP ${response.status}`);
		}

		const data = await response.json();

		if (data.success) {
			statusEl.textContent = 'Connected';
			if (indicatorEl) {
				indicatorEl.classList.remove('bg-gray-500', 'offline');
				indicatorEl.classList.add('online');
			}

			// Get tournament count from local DB
			try {
				const tournamentsRes = await fetch('/api/tournaments');
				if (tournamentsRes.ok) {
					const tournamentsData = await tournamentsRes.json();
					let activeCount = 0;

					// Handle grouped response format {pending: [], inProgress: [], completed: []}
					if (tournamentsData.tournaments && typeof tournamentsData.tournaments === 'object') {
						const t = tournamentsData.tournaments;
						if (Array.isArray(t)) {
							// Flat array format
							activeCount = t.filter(t => t.state !== 'complete').length;
						} else {
							// Grouped format - count pending and inProgress
							activeCount = (t.pending?.length || 0) + (t.inProgress?.length || 0);
						}
					}

					countEl.textContent = activeCount > 0 ? `${activeCount} active` : 'None';
				} else {
					countEl.textContent = '--';
				}
			} catch {
				countEl.textContent = '--';
			}
		}
	} catch (error) {
		console.error('Failed to load database status:', error);
		statusEl.textContent = 'Offline';
		countEl.textContent = '--';
		if (indicatorEl) {
			indicatorEl.classList.remove('bg-gray-500', 'online');
			indicatorEl.classList.add('offline');
		}
	}
}

// ========================================
// QR CODE FUNCTIONS
// ========================================

// Show QR code for signup page
async function showSignupQR() {
	const signupUrl = 'https://signup.despairhardware.com';
	await showQRCode(signupUrl, 'Scan to Sign Up');
}

// Show QR code for bracket link
async function showBracketQR() {
	if (!activeTournament?.tournamentId) {
		showAlert('No tournament selected', 'error');
		return;
	}

	// Use local bracket URL (tournament ID for QR code)
	const bracketUrl = `${window.location.origin}/tournament.html?id=${activeTournament.tournamentId}`;
	await showQRCode(bracketUrl, 'View Bracket');
}

// Show QR code for custom URL
async function showCustomQR() {
	const urlInput = document.getElementById('customQRUrl');
	const labelInput = document.getElementById('customQRLabel');

	if (!urlInput) return;

	const url = urlInput.value.trim();
	if (!url) {
		showAlert('Please enter a URL', 'error');
		return;
	}

	// Basic URL validation
	try {
		new URL(url);
	} catch (e) {
		showAlert('Please enter a valid URL', 'error');
		return;
	}

	const label = labelInput?.value.trim() || 'Scan Me';
	await showQRCode(url, label);
}

// Show QR code on match display
async function showQRCode(url, label) {
	try {
		const response = await csrfFetch('/api/qr/show', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url, label })
		});

		const data = await response.json();

		if (data.success) {
			showAlert('QR code displayed', 'success');
		} else {
			showAlert(`Failed to show QR: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Hide QR code from match display
async function hideQRCode() {
	try {
		const response = await csrfFetch('/api/qr/hide', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showAlert('QR code hidden', 'success');
		} else {
			showAlert(`Failed to hide QR: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// ============================================
// ACTIVITY FEED SYSTEM
// ============================================

// Activity feed state
let activitySocket = null;
let activityData = [];
let activityFilter = 'all';
let activitySearchTerm = '';
let activitySoundEnabled = localStorage.getItem('activitySoundEnabled') !== 'false';
let activityCollapsed = localStorage.getItem('activityFeedCollapsed') === 'true';
let activityUnreadCount = 0;
let activityOffset = 0;
const ACTIVITY_LIMIT = 20;

// Activity type icons (SVG paths)
const ACTIVITY_ICONS = {
	participant: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>',
	match: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>',
	display: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>',
	admin: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>',
	tournament: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"></path></svg>',
	system: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>'
};

// Initialize activity feed
function initActivityFeed() {
	// Restore collapsed state
	if (activityCollapsed) {
		document.getElementById('activityFeedSection')?.classList.add('collapsed');
	}

	// Restore sound state
	updateSoundToggleUI();

	// Connect to WebSocket
	connectActivitySocket();
}

// Connect to Socket.IO for activity updates
function connectActivitySocket() {
	if (typeof io === 'undefined') {
		console.error('[Activity] Socket.IO not loaded');
		updateConnectionStatus('disconnected', 'Socket.IO not available');
		return;
	}

	updateConnectionStatus('connecting', 'Connecting...');

	activitySocket = io(window.location.origin, {
		transports: ['websocket', 'polling'],
		reconnection: true,
		reconnectionDelay: 1000,
		reconnectionDelayMax: 5000,
		reconnectionAttempts: Infinity
	});

	activitySocket.on('connect', () => {
		console.log('[Activity] Connected to WebSocket');
		updateConnectionStatus('connected', 'Live');
		// Register as admin client
		activitySocket.emit('admin:register');
	});

	activitySocket.on('disconnect', () => {
		console.log('[Activity] Disconnected from WebSocket');
		updateConnectionStatus('disconnected', 'Disconnected');
	});

	activitySocket.on('connect_error', (error) => {
		console.error('[Activity] Connection error:', error.message);
		updateConnectionStatus('disconnected', 'Connection error');
	});

	// Handle initial activity data
	activitySocket.on('activity:initial', (data) => {
		console.log(`[Activity] Received ${data.activity.length} initial activities`);
		activityData = data.activity;
		renderActivityList();
	});

	// Handle new activity events
	activitySocket.on('activity:new', (entry) => {
		console.log('[Activity] New activity:', entry.action);
		handleNewActivity(entry);
	});
}

// Update connection status UI
function updateConnectionStatus(status, text) {
	const dot = document.getElementById('activityConnectionDot');
	const textEl = document.getElementById('activityConnectionText');

	if (dot) {
		dot.className = 'w-2 h-2 rounded-full';
		dot.classList.add(status);
	}
	if (textEl) {
		textEl.textContent = text;
	}
}

// Handle new activity entry
function handleNewActivity(entry) {
	// Add to beginning of array
	activityData.unshift(entry);

	// Trim to prevent memory issues
	if (activityData.length > 200) {
		activityData = activityData.slice(0, 200);
	}

	// If collapsed, increment unread count
	if (activityCollapsed) {
		activityUnreadCount++;
		updateUnreadBadge();
	}

	// Play notification sound if enabled
	if (activitySoundEnabled && !activityCollapsed) {
		playNotificationSound();
	}

	// Re-render
	renderActivityList(true);
}

// Render activity list
function renderActivityList(isNewEntry = false) {
	const container = document.getElementById('activityList');
	if (!container) return;

	// Filter activities
	let filtered = activityData;

	if (activityFilter !== 'all') {
		filtered = filtered.filter(a => a.category === activityFilter);
	}

	if (activitySearchTerm) {
		const searchLower = activitySearchTerm.toLowerCase();
		filtered = filtered.filter(a => {
			const message = formatActivityMessage(a).toLowerCase();
			const username = (a.username || '').toLowerCase();
			return message.includes(searchLower) || username.includes(searchLower);
		});
	}

	if (filtered.length === 0) {
		container.innerHTML = '<div class="text-gray-500 text-sm text-center py-8">No activity to display</div>';
		document.getElementById('activityLoadMore')?.classList.add('hidden');
		return;
	}

	// Render items
	const html = filtered.slice(0, activityOffset + ACTIVITY_LIMIT).map((entry, index) => {
		const isNew = isNewEntry && index === 0;
		return renderActivityItem(entry, isNew);
	}).join('');

	container.innerHTML = html;

	// Show/hide load more button
	const loadMore = document.getElementById('activityLoadMore');
	if (loadMore) {
		if (filtered.length > activityOffset + ACTIVITY_LIMIT) {
			loadMore.classList.remove('hidden');
		} else {
			loadMore.classList.add('hidden');
		}
	}
}

// Render single activity item
function renderActivityItem(entry, isNew = false) {
	const category = entry.category || 'system';
	const icon = ACTIVITY_ICONS[category] || ACTIVITY_ICONS.system;
	const message = formatActivityMessage(entry);
	const time = formatActivityTimeAgo(entry.timestamp);

	return `
		<div class="activity-item ${isNew ? 'new' : ''}" data-id="${entry.id}">
			<div class="activity-icon ${category}">${icon}</div>
			<div class="activity-content">
				<div class="activity-message">${message}</div>
				<div class="activity-time">${time}</div>
			</div>
		</div>
	`;
}

// Format activity message based on action type
function formatActivityMessage(entry) {
	const action = entry.action || '';
	const details = entry.details || {};
	const username = escapeHtml(entry.username || 'System');

	// Handle non-string action values
	if (typeof action !== 'string') {
		console.warn('[Activity] Invalid action type:', typeof action, action);
		return `<strong>${username}</strong>: ${escapeHtml(JSON.stringify(action))}`;
	}

	switch (action) {
		// Participant actions
		case 'participant_signup':
			return `<strong>${escapeHtml(details.playerName || 'Someone')}</strong> signed up for ${escapeHtml(details.tournamentName || 'tournament')}`;
		case 'participant_checkin':
			return `<strong>${escapeHtml(details.playerName || 'Someone')}</strong> checked in`;
		case 'participant_checkout':
			return `<strong>${escapeHtml(details.playerName || 'Someone')}</strong> checked out`;

		// Match actions
		case 'match_start':
			return `Match started: <strong>${escapeHtml(details.player1 || '?')}</strong> vs <strong>${escapeHtml(details.player2 || '?')}</strong>`;
		case 'match_complete':
			return `<strong>${escapeHtml(details.winner || '?')}</strong> defeated ${escapeHtml(details.loser || '?')} ${escapeHtml(details.score || '')}`;
		case 'match_dq':
			return `<strong>${escapeHtml(details.player || 'A player')}</strong> was disqualified`;

		// Display actions
		case 'display_online':
			return `Display <strong>${escapeHtml(details.hostname || details.displayId || 'unknown')}</strong> came online`;
		case 'display_offline':
			return `Display <strong>${escapeHtml(details.hostname || details.displayId || 'unknown')}</strong> went offline`;

		// Admin actions
		case 'admin_login':
			return `<strong>${username}</strong> logged in`;
		case 'admin_logout':
			return `<strong>${username}</strong> logged out`;
		case 'update_settings':
			return `<strong>${username}</strong> updated settings`;

		// Tournament actions
		case 'tournament_create':
			return `<strong>${username}</strong> created tournament <strong>${escapeHtml(details.name || '')}</strong>`;
		case 'tournament_start':
			return `<strong>${username}</strong> started tournament <strong>${escapeHtml(details.name || '')}</strong>`;
		case 'tournament_reset':
			return `<strong>${username}</strong> reset tournament <strong>${escapeHtml(details.name || '')}</strong>`;
		case 'tournament_complete':
			return `Tournament <strong>${escapeHtml(details.name || '')}</strong> completed`;

		// Flyer actions
		case 'flyer_upload':
			return `<strong>${username}</strong> uploaded flyer <strong>${escapeHtml(details.filename || '')}</strong>`;
		case 'flyer_delete':
			return `<strong>${username}</strong> deleted flyer <strong>${escapeHtml(details.filename || '')}</strong>`;
		case 'flyer_set_active':
			return `<strong>${username}</strong> set active flyer to <strong>${escapeHtml(details.flyer || '')}</strong>`;

		// Emergency actions
		case 'emergency_activated':
			return `<strong>${username}</strong> activated emergency mode${details.reason ? `: ${escapeHtml(details.reason)}` : ''}`;
		case 'emergency_deactivated':
			return `<strong>${username}</strong> deactivated emergency mode`;

		// System actions
		case 'dev_mode_enabled':
			return `<strong>${username}</strong> enabled dev mode`;
		case 'dev_mode_disabled':
			return `<strong>${username}</strong> disabled dev mode`;
		case 'rate_mode_change':
			return `Rate mode changed to <strong>${escapeHtml(details.mode || 'unknown')}</strong>`;

		// Default fallback
		default:
			// Handle empty or unknown actions
			if (!action) {
				return `<strong>${username}</strong>: unknown action`;
			}
			return `<strong>${username}</strong>: ${escapeHtml(action.replace(/_/g, ' '))}`;
	}
}

// Filter activity by category
function filterActivity(category) {
	activityFilter = category;
	activityOffset = 0;

	// Update filter button UI
	document.querySelectorAll('.activity-filter-btn').forEach(btn => {
		btn.classList.toggle('active', btn.dataset.filter === category);
	});

	renderActivityList();
}

// Search activity
function searchActivity(term) {
	activitySearchTerm = term;
	activityOffset = 0;
	renderActivityList();
}

// Toggle activity feed collapse
function toggleActivityFeed() {
	const section = document.getElementById('activityFeedSection');
	if (!section) return;

	activityCollapsed = !activityCollapsed;
	section.classList.toggle('collapsed', activityCollapsed);
	localStorage.setItem('activityFeedCollapsed', activityCollapsed);

	// Reset unread count when expanding
	if (!activityCollapsed) {
		activityUnreadCount = 0;
		updateUnreadBadge();
	}
}

// Toggle notification sounds
function toggleActivitySound() {
	activitySoundEnabled = !activitySoundEnabled;
	localStorage.setItem('activitySoundEnabled', activitySoundEnabled);
	updateSoundToggleUI();
}

// Update sound toggle button UI
function updateSoundToggleUI() {
	const onIcon = document.getElementById('activitySoundOn');
	const offIcon = document.getElementById('activitySoundOff');

	if (onIcon && offIcon) {
		onIcon.classList.toggle('hidden', !activitySoundEnabled);
		offIcon.classList.toggle('hidden', activitySoundEnabled);
	}
}

// Update unread badge
function updateUnreadBadge() {
	const badge = document.getElementById('activityUnreadBadge');
	if (!badge) return;

	if (activityUnreadCount > 0) {
		badge.textContent = activityUnreadCount > 99 ? '99+' : activityUnreadCount;
		badge.classList.remove('hidden');
	} else {
		badge.classList.add('hidden');
	}
}

// Load more activity
function loadMoreActivity() {
	activityOffset += ACTIVITY_LIMIT;
	renderActivityList();
}

// Shared AudioContext - only created after user interaction
let sharedAudioContext = null;
let userHasInteracted = false;

// Initialize audio context after user interaction
function initAudioContext() {
	if (sharedAudioContext) return;
	try {
		sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
		userHasInteracted = true;
	} catch (e) {
		// Audio not supported
	}
}

// Set up user interaction listener (runs once)
document.addEventListener('click', initAudioContext, { once: true });
document.addEventListener('keydown', initAudioContext, { once: true });

// Play notification sound using Web Audio API
function playNotificationSound() {
	// Only play if user has interacted and audio context exists
	if (!userHasInteracted || !sharedAudioContext) {
		return;
	}

	try {
		// Resume context if suspended
		if (sharedAudioContext.state === 'suspended') {
			sharedAudioContext.resume();
		}

		const oscillator = sharedAudioContext.createOscillator();
		const gainNode = sharedAudioContext.createGain();

		oscillator.connect(gainNode);
		gainNode.connect(sharedAudioContext.destination);

		oscillator.frequency.value = 800;
		oscillator.type = 'sine';
		gainNode.gain.value = 0.1;

		oscillator.start();
		oscillator.stop(sharedAudioContext.currentTime + 0.1);
	} catch (e) {
		// Audio error, ignore silently
	}
}

// Format time ago for activity feed
function formatActivityTimeAgo(timestamp) {
	// Use utils.js formatTimeAgo if available
	if (typeof window.formatTimeAgo === 'function') {
		return window.formatTimeAgo(timestamp);
	}

	// Fallback implementation
	const now = new Date();
	const date = new Date(timestamp);
	const diff = Math.floor((now - date) / 1000);

	if (diff < 60) return 'just now';
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

// ==========================================
// Scheduled Ticker Messages
// ==========================================

let scheduleType = 'once';
let selectedDays = [];
let scheduledTickers = [];

// Open the schedule ticker modal
function openScheduleTickerModal() {
	const modal = document.getElementById('scheduleTickerModal');
	if (modal) {
		modal.classList.remove('hidden');
		modal.classList.add('flex');
		// Set default datetime to 15 minutes from now
		const defaultTime = new Date(Date.now() + 15 * 60 * 1000);
		const dateTimeInput = document.getElementById('schedDateTime');
		if (dateTimeInput) {
			dateTimeInput.value = defaultTime.toISOString().slice(0, 16);
		}
		// Pre-fill message from main ticker input
		const tickerMsg = document.getElementById('tickerMessage');
		const schedMsg = document.getElementById('schedTickerMessage');
		if (tickerMsg && schedMsg && tickerMsg.value.trim()) {
			schedMsg.value = tickerMsg.value.trim();
		}
	}
}

// Close the schedule ticker modal
function closeScheduleTickerModal() {
	const modal = document.getElementById('scheduleTickerModal');
	if (modal) {
		modal.classList.add('hidden');
		modal.classList.remove('flex');
	}
	// Reset form
	document.getElementById('schedTickerMessage').value = '';
	document.getElementById('schedTickerDuration').value = '5';
	document.getElementById('schedDateTime').value = '';
	document.getElementById('schedTime').value = '';
	document.getElementById('schedLabel').value = '';
	selectedDays = [];
	updateDayButtons();
	setScheduleType('once');
}

// Set schedule type (once or recurring)
function setScheduleType(type) {
	scheduleType = type;
	const onceBtn = document.getElementById('schedTypeOnce');
	const recurringBtn = document.getElementById('schedTypeRecurring');
	const onceOptions = document.getElementById('schedOnceOptions');
	const recurringOptions = document.getElementById('schedRecurringOptions');

	if (type === 'once') {
		onceBtn.className = 'flex-1 px-3 py-2 bg-blue-600 border border-blue-500 rounded text-white text-sm font-medium';
		recurringBtn.className = 'flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm font-medium';
		onceOptions.classList.remove('hidden');
		recurringOptions.classList.add('hidden');
	} else {
		onceBtn.className = 'flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm font-medium';
		recurringBtn.className = 'flex-1 px-3 py-2 bg-blue-600 border border-blue-500 rounded text-white text-sm font-medium';
		onceOptions.classList.add('hidden');
		recurringOptions.classList.remove('hidden');
	}
}

// Toggle a day in recurring schedule
function toggleScheduleDay(day) {
	const idx = selectedDays.indexOf(day);
	if (idx === -1) {
		selectedDays.push(day);
	} else {
		selectedDays.splice(idx, 1);
	}
	updateDayButtons();
}

// Update day button states
function updateDayButtons() {
	document.querySelectorAll('.sched-day-btn').forEach(btn => {
		const day = parseInt(btn.dataset.day);
		if (selectedDays.includes(day)) {
			btn.className = 'sched-day-btn px-2 py-1 bg-blue-600 border border-blue-500 rounded text-xs text-white';
		} else {
			btn.className = 'sched-day-btn px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white';
		}
	});
}

// Save scheduled ticker
async function saveScheduledTicker() {
	const message = document.getElementById('schedTickerMessage').value.trim();
	const duration = parseInt(document.getElementById('schedTickerDuration').value) || 5;

	if (!message) {
		showAlert('Please enter a message', 'error');
		return;
	}

	let payload = {
		message,
		duration,
		type: scheduleType,
		enabled: true
	};

	if (scheduleType === 'once') {
		const scheduledTime = document.getElementById('schedDateTime').value;
		if (!scheduledTime) {
			showAlert('Please select a date and time', 'error');
			return;
		}
		payload.scheduledTime = new Date(scheduledTime).toISOString();
	} else {
		const time = document.getElementById('schedTime').value;
		if (!time) {
			showAlert('Please enter a time', 'error');
			return;
		}
		payload.time = time;
		payload.days = selectedDays;
		payload.label = document.getElementById('schedLabel').value.trim();
	}

	try {
		const response = await csrfFetch('/api/ticker/schedule', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		const data = await response.json();
		if (data.success) {
			showAlert('Ticker message scheduled!', 'success');
			closeScheduleTickerModal();
			refreshScheduledTickers();
		} else {
			showAlert(data.error || 'Failed to schedule message', 'error');
		}
	} catch (error) {
		console.error('Error scheduling ticker:', error);
		showAlert('Failed to schedule message', 'error');
	}
}

// Refresh scheduled tickers list
async function refreshScheduledTickers() {
	try {
		const response = await fetch('/api/ticker/schedule');
		const data = await response.json();

		if (data.success) {
			scheduledTickers = data.scheduled || [];
			renderScheduledTickers();
		}
	} catch (error) {
		console.error('Error fetching scheduled tickers:', error);
	}
}

// Render scheduled tickers list
function renderScheduledTickers() {
	const section = document.getElementById('scheduledTickerSection');
	const list = document.getElementById('scheduledTickerList');

	if (!list) return;

	if (scheduledTickers.length === 0) {
		section.classList.add('hidden');
		return;
	}

	section.classList.remove('hidden');

	list.innerHTML = scheduledTickers.map(t => {
		const isExpired = t.isExpired;
		const typeLabel = t.type === 'recurring' ? 'Recurring' : 'One-time';
		let timeInfo = '';

		if (t.type === 'once') {
			const dt = new Date(t.scheduledTime);
			timeInfo = dt.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
		} else {
			const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
			const dayStr = t.days && t.days.length > 0
				? t.days.map(d => days[d]).join(', ')
				: 'Daily';
			timeInfo = `${t.time} (${dayStr})`;
		}

		return `
			<div class="flex items-center justify-between p-2 bg-gray-700/50 rounded ${isExpired ? 'opacity-50' : ''}">
				<div class="flex-1 min-w-0 mr-2">
					<div class="text-sm text-white truncate">${escapeHtml(t.message)}</div>
					<div class="text-xs text-gray-400">
						<span class="inline-block px-1.5 py-0.5 bg-gray-600 rounded text-xs mr-1">${typeLabel}</span>
						${t.label ? `<span class="mr-1">${escapeHtml(t.label)}</span>` : ''}
						${timeInfo}
						${!t.enabled ? '<span class="text-yellow-400 ml-1">(disabled)</span>' : ''}
					</div>
				</div>
				<div class="flex gap-1">
					<button onclick="toggleScheduledTicker('${t.id}')" class="p-1 text-gray-400 hover:text-white" title="${t.enabled ? 'Disable' : 'Enable'}">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${t.enabled ? 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' : 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'}"></path>
						</svg>
					</button>
					<button onclick="deleteScheduledTicker('${t.id}')" class="p-1 text-gray-400 hover:text-red-400" title="Delete">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
						</svg>
					</button>
				</div>
			</div>
		`;
	}).join('');
}

// Toggle scheduled ticker enabled state
async function toggleScheduledTicker(id) {
	const ticker = scheduledTickers.find(t => t.id === id);
	if (!ticker) return;

	try {
		const response = await csrfFetch(`/api/ticker/schedule/${id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !ticker.enabled })
		});

		const data = await response.json();
		if (data.success) {
			refreshScheduledTickers();
		} else {
			showAlert(data.error || 'Failed to update', 'error');
		}
	} catch (error) {
		console.error('Error toggling ticker:', error);
		showAlert('Failed to update', 'error');
	}
}

// Delete scheduled ticker
async function deleteScheduledTicker(id) {
	if (!confirm('Delete this scheduled message?')) return;

	try {
		const response = await csrfFetch(`/api/ticker/schedule/${id}`, {
			method: 'DELETE'
		});

		const data = await response.json();
		if (data.success) {
			showAlert('Scheduled message deleted', 'success');
			refreshScheduledTickers();
		} else {
			showAlert(data.error || 'Failed to delete', 'error');
		}
	} catch (error) {
		console.error('Error deleting ticker:', error);
		showAlert('Failed to delete', 'error');
	}
}

// Load scheduled tickers on page load
document.addEventListener('DOMContentLoaded', () => {
	refreshScheduledTickers();
});

// Export functions for global access
window.refreshAllStatus = refreshAllStatus;
window.showAlert = showAlert;
window.copyTournamentId = copyTournamentId;
window.quickStartTournament = quickStartTournament;
window.setTickerPreset = setTickerPreset;
window.sendTickerMessage = sendTickerMessage;
window.loadDatabaseStatus = loadDatabaseStatus;
window.startDQTimer = startDQTimer;
window.hideDQTimer = hideDQTimer;
window.toggleDQTimer = toggleDQTimer;
window.startTournamentTimer = startTournamentTimer;
window.showSignupQR = showSignupQR;
window.showBracketQR = showBracketQR;
window.showCustomQR = showCustomQR;
window.hideQRCode = hideQRCode;
window.initActivityFeed = initActivityFeed;
window.filterActivity = filterActivity;
window.searchActivity = searchActivity;
window.toggleActivityFeed = toggleActivityFeed;
window.toggleActivitySound = toggleActivitySound;
window.loadMoreActivity = loadMoreActivity;
window.openScheduleTickerModal = openScheduleTickerModal;
window.closeScheduleTickerModal = closeScheduleTickerModal;
window.setScheduleType = setScheduleType;
window.toggleScheduleDay = toggleScheduleDay;
window.saveScheduledTicker = saveScheduledTicker;
window.refreshScheduledTickers = refreshScheduledTickers;
window.toggleScheduledTicker = toggleScheduledTicker;
window.deleteScheduledTicker = deleteScheduledTicker;
window.playAudioPreset = playAudioPreset;
window.playCustomAudioAnnouncement = playCustomAudioAnnouncement;

// ============================================================================
// Audio Announcements
// ============================================================================

/**
 * Play a preset audio announcement on Pi displays
 */
async function playAudioPreset(text) {
	try {
		const response = await csrfFetch('/api/audio/announce', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text: text,
				rate: 1.0,
				volume: 1.0
			})
		});

		const data = await response.json();
		if (data.success) {
			showAlert('Audio announcement sent', 'success');
		} else {
			showAlert(data.error || 'Failed to send audio announcement', 'error');
		}
	} catch (error) {
		console.error('Error sending audio announcement:', error);
		showAlert('Error sending audio announcement', 'error');
	}
}

/**
 * Play a custom audio announcement from the textarea
 */
async function playCustomAudioAnnouncement() {
	const textArea = document.getElementById('audioAnnouncementText');
	const rateSelect = document.getElementById('audioAnnouncementRate');

	const text = textArea?.value?.trim();
	const rate = parseFloat(rateSelect?.value || '1.0');

	if (!text) {
		showAlert('Please enter announcement text', 'warning');
		return;
	}

	try {
		const response = await csrfFetch('/api/audio/announce', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text: text,
				rate: rate,
				volume: 1.0
			})
		});

		const data = await response.json();
		if (data.success) {
			showAlert('Audio announcement sent', 'success');
			textArea.value = ''; // Clear the text area after success
		} else {
			showAlert(data.error || 'Failed to send audio announcement', 'error');
		}
	} catch (error) {
		console.error('Error sending audio announcement:', error);
		showAlert('Error sending audio announcement', 'error');
	}
}
