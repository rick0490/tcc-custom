/**
 * Analytics Page JavaScript
 * Handles player rankings, tournament history, and statistics
 */

// State
let currentGame = 'all';
let currentGameId = null;
let currentTab = 'rankings';
let games = [];
let overviewStats = null;

// Charts
let attendanceChart = null;
let newVsReturningChart = null;

// Debounce timers
let playerSearchTimer = null;
let h2hSearchTimer = null;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
	console.log('Analytics page loaded');

	await loadGames();
	await loadOverviewStats();
	await loadTournaments();

	console.log('Analytics initialization complete');
});

// ============================================
// GAME TABS
// ============================================

async function loadGames() {
	try {
		const response = await fetch('/api/analytics/games');
		const data = await response.json();

		if (data.success) {
			games = data.games;
			renderGameTabs();
		}
	} catch (error) {
		console.error('Error loading games:', error);
	}
}

function renderGameTabs() {
	const container = document.getElementById('gameTabsContainer');

	let html = `<button class="game-tab ${currentGame === 'all' ? 'active' : ''}" data-game="all" onclick="selectGame('all')">All Games</button>`;

	for (const game of games) {
		const isActive = currentGameId === game.id;
		html += `<button class="game-tab ${isActive ? 'active' : ''}" data-game="${game.id}" onclick="selectGame(${game.id})">
			${game.short_code?.toUpperCase() || game.name} (${game.tournament_count})
		</button>`;
	}

	container.innerHTML = html;
}

function selectGame(gameId) {
	if (gameId === 'all') {
		currentGame = 'all';
		currentGameId = null;
	} else {
		currentGame = gameId;
		currentGameId = gameId;
	}

	// Update tab UI
	document.querySelectorAll('.game-tab').forEach(tab => {
		tab.classList.remove('active');
	});
	const selectedTab = document.querySelector(`.game-tab[data-game="${gameId}"]`);
	if (selectedTab) selectedTab.classList.add('active');

	// Reload current tab data
	switchContentTab(currentTab);
}

// ============================================
// CONTENT TABS
// ============================================

function switchContentTab(tab) {
	currentTab = tab;

	// Update tab UI
	document.querySelectorAll('.content-tab').forEach(t => {
		t.classList.remove('active');
	});
	document.querySelector(`.content-tab[data-tab="${tab}"]`).classList.add('active');

	// Hide all content
	document.querySelectorAll('.tab-content').forEach(content => {
		content.classList.add('hidden');
	});

	// Show selected content
	document.getElementById(`${tab}Tab`).classList.remove('hidden');

	// Load tab data
	switch (tab) {
		case 'rankings':
			loadRankings();
			break;
		case 'players':
			// Players tab uses search, no auto-load
			break;
		case 'tournaments':
			loadTournaments();
			break;
		case 'headtohead':
			// H2H tab needs manual selection
			break;
		case 'attendance':
			loadAttendanceStats();
			break;
	}
}

// ============================================
// OVERVIEW STATS
// ============================================

async function loadOverviewStats() {
	try {
		const response = await fetch('/api/analytics/stats/overview');
		const data = await response.json();

		if (data.success) {
			overviewStats = data;
			renderOverviewStats();
		}
	} catch (error) {
		console.error('Error loading overview stats:', error);
	}
}

function renderOverviewStats() {
	document.getElementById('statTournaments').textContent = overviewStats.total_tournaments || 0;
	document.getElementById('statPlayers').textContent = overviewStats.total_players || 0;
	document.getElementById('statMatches').textContent = overviewStats.total_matches || 0;

	// Calculate average attendance
	if (overviewStats.total_tournaments > 0 && overviewStats.recentTournaments?.length > 0) {
		const totalParticipants = overviewStats.recentTournaments.reduce((sum, t) => sum + (t.participant_count || 0), 0);
		const avg = Math.round(totalParticipants / overviewStats.recentTournaments.length);
		document.getElementById('statAvgAttendance').textContent = avg;
	} else {
		document.getElementById('statAvgAttendance').textContent = '--';
	}
}

// ============================================
// RANKINGS
// ============================================

async function loadRankings() {
	const content = document.getElementById('rankingsContent');
	const sortBy = document.getElementById('rankingsSortBy').value;

	if (!currentGameId) {
		content.innerHTML = '<p class="text-gray-400 text-center py-8">Select a game to view rankings</p>';
		return;
	}

	content.innerHTML = '<p class="text-gray-400 text-center py-8">Loading rankings...</p>';

	try {
		const response = await fetch(`/api/analytics/rankings/${currentGameId}?sortBy=${sortBy}&limit=50`);
		const data = await response.json();

		if (data.success && data.rankings.length > 0) {
			renderRankings(data.rankings);
		} else {
			content.innerHTML = '<p class="text-gray-400 text-center py-8">No ranking data available for this game</p>';
		}
	} catch (error) {
		console.error('Error loading rankings:', error);
		content.innerHTML = '<p class="text-red-400 text-center py-8">Error loading rankings</p>';
	}
}

function renderRankings(rankings) {
	const content = document.getElementById('rankingsContent');

	let html = `
		<div class="overflow-x-auto">
			<table class="w-full">
				<thead>
					<tr class="border-b border-gray-700 text-left">
						<th class="py-2 px-3 text-gray-400 text-sm">#</th>
						<th class="py-2 px-3 text-gray-400 text-sm">Player</th>
						<th class="py-2 px-3 text-gray-400 text-sm text-center">Elo</th>
						<th class="py-2 px-3 text-gray-400 text-sm text-center">W-L</th>
						<th class="py-2 px-3 text-gray-400 text-sm">Win Rate</th>
						<th class="py-2 px-3 text-gray-400 text-sm text-center">Tournaments</th>
					</tr>
				</thead>
				<tbody>
	`;

	rankings.forEach((player, index) => {
		const rank = index + 1;
		const rankClass = rank <= 3 ? `rank-${rank}` : 'bg-gray-700 text-gray-300';
		const winRate = player.win_rate || 0;

		html += `
			<tr class="border-b border-gray-700 hover:bg-gray-750 cursor-pointer" onclick="openPlayerProfile(${player.id})">
				<td class="py-3 px-3">
					<span class="rank-badge ${rankClass}">${rank}</span>
				</td>
				<td class="py-3 px-3">
					<span class="font-medium text-white">${escapeHtml(player.display_name)}</span>
				</td>
				<td class="py-3 px-3 text-center">
					<span class="elo-badge">${player.elo_rating}</span>
				</td>
				<td class="py-3 px-3 text-center text-sm">
					<span class="text-green-400">${player.wins}</span>
					<span class="text-gray-500">-</span>
					<span class="text-red-400">${player.losses}</span>
				</td>
				<td class="py-3 px-3">
					<div class="flex items-center gap-2">
						<div class="win-rate-bar flex-1">
							<div class="win-rate-fill" style="width: ${winRate}%"></div>
						</div>
						<span class="text-sm text-gray-300 w-12 text-right">${winRate}%</span>
					</div>
				</td>
				<td class="py-3 px-3 text-center text-sm text-gray-300">${player.attendance || 0}</td>
			</tr>
		`;
	});

	html += '</tbody></table></div>';
	content.innerHTML = html;
}

// ============================================
// PLAYER SEARCH
// ============================================

function searchPlayers() {
	clearTimeout(playerSearchTimer);
	playerSearchTimer = setTimeout(async () => {
		const query = document.getElementById('playerSearch').value.trim();
		const content = document.getElementById('playersContent');

		if (query.length < 2) {
			content.innerHTML = '<p class="text-gray-400 text-center py-8 col-span-full">Enter at least 2 characters to search</p>';
			return;
		}

		content.innerHTML = '<p class="text-gray-400 text-center py-8 col-span-full">Searching...</p>';

		try {
			const params = new URLSearchParams({ search: query, limit: 20 });
			if (currentGameId) params.append('game', currentGameId);

			const response = await fetch(`/api/analytics/players?${params}`);
			const data = await response.json();

			if (data.success && data.players.length > 0) {
				renderPlayerCards(data.players);
			} else {
				content.innerHTML = '<p class="text-gray-400 text-center py-8 col-span-full">No players found</p>';
			}
		} catch (error) {
			console.error('Error searching players:', error);
			content.innerHTML = '<p class="text-red-400 text-center py-8 col-span-full">Error searching players</p>';
		}
	}, 300);
}

function renderPlayerCards(players) {
	const content = document.getElementById('playersContent');

	let html = '';
	for (const player of players) {
		html += `
			<div class="player-card" onclick="openPlayerProfile(${player.id})">
				<div class="font-medium text-white mb-1">${escapeHtml(player.display_name)}</div>
				${player.elo ? `<span class="elo-badge">Elo: ${player.elo}</span>` : ''}
			</div>
		`;
	}

	content.innerHTML = html;
}

// ============================================
// PLAYER PROFILE
// ============================================

async function openPlayerProfile(playerId) {
	const modal = document.getElementById('playerProfileModal');
	const content = document.getElementById('profileContent');

	modal.classList.remove('hidden');
	content.innerHTML = '<p class="text-gray-400 text-center py-8">Loading profile...</p>';

	try {
		const response = await fetch(`/api/analytics/players/${playerId}`);
		const data = await response.json();

		if (data.success) {
			document.getElementById('profilePlayerName').textContent = data.player.display_name;
			renderPlayerProfile(data);
		} else {
			content.innerHTML = '<p class="text-red-400 text-center py-8">Error loading profile</p>';
		}
	} catch (error) {
		console.error('Error loading player profile:', error);
		content.innerHTML = '<p class="text-red-400 text-center py-8">Error loading profile</p>';
	}
}

function renderPlayerProfile(data) {
	const content = document.getElementById('profileContent');

	let html = '';

	// Aliases
	if (data.aliases && data.aliases.length > 0) {
		html += `
			<div class="mb-4 text-sm text-gray-400">
				Also known as: ${data.aliases.map(a => escapeHtml(a)).join(', ')}
			</div>
		`;
	}

	// Game stats
	if (data.gameStats && data.gameStats.length > 0) {
		html += '<h4 class="text-md font-semibold text-gray-300 mb-3">Stats by Game</h4>';
		html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">';

		for (const stat of data.gameStats) {
			html += `
				<div class="bg-gray-750 rounded-lg p-4">
					<div class="font-medium text-white mb-2">${escapeHtml(stat.game_name)}</div>
					<div class="grid grid-cols-2 gap-2 text-sm">
						<div>
							<span class="text-gray-400">Elo:</span>
							<span class="elo-badge ml-1">${stat.elo_rating}</span>
						</div>
						<div>
							<span class="text-gray-400">Peak:</span>
							<span class="text-yellow-400 ml-1">${stat.peak_rating}</span>
						</div>
						<div>
							<span class="text-gray-400">Record:</span>
							<span class="text-green-400 ml-1">${stat.wins}</span>-<span class="text-red-400">${stat.losses}</span>
						</div>
						<div>
							<span class="text-gray-400">Win Rate:</span>
							<span class="text-white ml-1">${stat.win_rate || 0}%</span>
						</div>
						<div class="col-span-2">
							<span class="text-gray-400">Tournaments:</span>
							<span class="text-white ml-1">${stat.tournaments_attended}</span>
						</div>
					</div>
				</div>
			`;
		}
		html += '</div>';
	}

	// Recent placements
	if (data.placements && data.placements.length > 0) {
		html += '<h4 class="text-md font-semibold text-gray-300 mb-3">Recent Placements</h4>';
		html += '<div class="space-y-2 mb-6">';

		for (const p of data.placements.slice(0, 10)) {
			const rankBadge = p.final_rank <= 3 ? `rank-${p.final_rank}` : 'bg-gray-700 text-gray-300';
			html += `
				<div class="flex items-center gap-3 text-sm">
					<span class="rank-badge ${rankBadge} text-xs" style="width:1.5rem;height:1.5rem">${p.final_rank || '-'}</span>
					<span class="text-white flex-1">${escapeHtml(p.tournament_name)}</span>
					<span class="text-gray-400">${formatDate(p.completed_at)}</span>
				</div>
			`;
		}
		html += '</div>';
	}

	// Recent matches
	if (data.recentMatches && data.recentMatches.length > 0) {
		html += '<h4 class="text-md font-semibold text-gray-300 mb-3">Recent Matches</h4>';
		html += '<div class="space-y-2">';

		for (const match of data.recentMatches.slice(0, 10)) {
			const resultClass = match.result === 'win' ? 'text-green-400' : 'text-red-400';
			const resultText = match.result === 'win' ? 'W' : 'L';
			const opponent = match.player1_id === data.player.id ? match.player2_name : match.player1_name;

			html += `
				<div class="flex items-center gap-3 text-sm">
					<span class="font-bold ${resultClass}">${resultText}</span>
					<span class="text-white">vs ${escapeHtml(opponent || 'Unknown')}</span>
					<span class="text-gray-400 ml-auto">${match.scores_csv || ''}</span>
				</div>
			`;
		}
		html += '</div>';
	}

	content.innerHTML = html || '<p class="text-gray-400 text-center py-8">No data available</p>';
}

function closePlayerProfile() {
	document.getElementById('playerProfileModal').classList.add('hidden');
}

// ============================================
// TOURNAMENTS
// ============================================

async function loadTournaments() {
	const content = document.getElementById('tournamentsContent');
	content.innerHTML = '<p class="text-gray-400 text-center py-8">Loading tournaments...</p>';

	try {
		const params = new URLSearchParams({ limit: 50 });
		if (currentGameId) params.append('game', currentGameId);

		const response = await fetch(`/api/analytics/tournaments?${params}`);
		const data = await response.json();

		if (data.success && data.tournaments.length > 0) {
			renderTournaments(data.tournaments);
		} else {
			content.innerHTML = '<p class="text-gray-400 text-center py-8">No archived tournaments found</p>';
		}
	} catch (error) {
		console.error('Error loading tournaments:', error);
		content.innerHTML = '<p class="text-red-400 text-center py-8">Error loading tournaments</p>';
	}
}

function renderTournaments(tournaments) {
	const content = document.getElementById('tournamentsContent');

	let html = '';
	for (const t of tournaments) {
		html += `
			<div class="bg-gray-750 rounded-lg p-4 hover:bg-gray-700 transition">
				<div class="flex items-center justify-between cursor-pointer" onclick="openTournamentDetails(${t.id})">
					<div>
						<div class="font-medium text-white">${escapeHtml(t.name)}</div>
						<div class="text-sm text-gray-400">
							${t.game_short_code?.toUpperCase() || t.game_name} |
							${t.tournament_type} |
							${t.participant_count} players
						</div>
					</div>
					<div class="text-sm text-gray-400">${formatDate(t.completed_at)}</div>
				</div>
				<div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-600">
					<button onclick="event.stopPropagation(); exportStandingsCSV(${t.id}, 'archive')"
						class="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded transition">
						CSV Standings
					</button>
					<button onclick="event.stopPropagation(); exportMatchesCSV(${t.id}, 'archive')"
						class="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded transition">
						CSV Matches
					</button>
					<button onclick="event.stopPropagation(); exportPDF(${t.id}, 'archive')"
						class="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition">
						PDF Report
					</button>
					<button onclick="event.stopPropagation(); openNarrativeModal(${t.id}, '${escapeHtml(t.name).replace(/'/g, "\\'")}')"
						class="narrative-btn text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded transition"
						title="Generate AI-powered tournament recap">
						Generate Recap
					</button>
				</div>
			</div>
		`;
	}

	content.innerHTML = html;
}

async function openTournamentDetails(tournamentId) {
	const modal = document.getElementById('tournamentModal');
	const content = document.getElementById('tournamentModalContent');

	modal.classList.remove('hidden');
	content.innerHTML = '<p class="text-gray-400 text-center py-8">Loading tournament details...</p>';

	try {
		const response = await fetch(`/api/analytics/tournaments/${tournamentId}`);
		const data = await response.json();

		if (data.success) {
			document.getElementById('tournamentModalTitle').textContent = data.tournament.name;
			renderTournamentDetails(data);
		} else {
			content.innerHTML = '<p class="text-red-400 text-center py-8">Error loading tournament</p>';
		}
	} catch (error) {
		console.error('Error loading tournament details:', error);
		content.innerHTML = '<p class="text-red-400 text-center py-8">Error loading tournament</p>';
	}
}

function renderTournamentDetails(data) {
	const content = document.getElementById('tournamentModalContent');
	const t = data.tournament;

	let html = `
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
			<div class="text-center">
				<div class="text-2xl font-bold text-white">${t.participant_count}</div>
				<div class="text-sm text-gray-400">Players</div>
			</div>
			<div class="text-center">
				<div class="text-2xl font-bold text-white">${data.matches?.length || 0}</div>
				<div class="text-sm text-gray-400">Matches</div>
			</div>
			<div class="text-center">
				<div class="text-lg font-bold text-white">${t.tournament_type}</div>
				<div class="text-sm text-gray-400">Format</div>
			</div>
			<div class="text-center">
				<div class="text-lg font-bold text-white">${formatDate(t.completed_at)}</div>
				<div class="text-sm text-gray-400">Completed</div>
			</div>
		</div>
	`;

	// Final standings
	if (data.standings && data.standings.length > 0) {
		html += '<h4 class="text-md font-semibold text-gray-300 mb-3">Final Standings</h4>';
		html += '<div class="space-y-2 mb-6">';

		for (const p of data.standings.slice(0, 16)) {
			const rankClass = p.final_rank <= 3 ? `rank-${p.final_rank}` : 'bg-gray-700 text-gray-300';
			html += `
				<div class="flex items-center gap-3 cursor-pointer hover:bg-gray-700 p-2 rounded" onclick="openPlayerProfile(${p.player_id})">
					<span class="rank-badge ${rankClass}">${p.final_rank || '-'}</span>
					<span class="text-white">${escapeHtml(p.display_name)}</span>
					<span class="text-gray-400 text-sm ml-auto">Seed: ${p.seed || '-'}</span>
				</div>
			`;
		}
		html += '</div>';
	}

	content.innerHTML = html;
}

function closeTournamentModal() {
	document.getElementById('tournamentModal').classList.add('hidden');
}

// ============================================
// HEAD-TO-HEAD
// ============================================

function searchH2HPlayer(playerNum) {
	clearTimeout(h2hSearchTimer);
	h2hSearchTimer = setTimeout(async () => {
		const input = document.getElementById(`h2hPlayer${playerNum}Search`);
		const dropdown = document.getElementById(`h2hPlayer${playerNum}Dropdown`);
		const query = input.value.trim();

		if (query.length < 2) {
			dropdown.classList.add('hidden');
			return;
		}

		try {
			const response = await fetch(`/api/analytics/players?search=${encodeURIComponent(query)}&limit=5`);
			const data = await response.json();

			if (data.success && data.players.length > 0) {
				let html = '';
				for (const player of data.players) {
					html += `
						<div class="px-3 py-2 hover:bg-gray-600 cursor-pointer" onclick="selectH2HPlayer(${playerNum}, ${player.id}, '${escapeHtml(player.display_name)}')">
							${escapeHtml(player.display_name)}
						</div>
					`;
				}
				dropdown.innerHTML = html;
				dropdown.classList.remove('hidden');
			} else {
				dropdown.classList.add('hidden');
			}
		} catch (error) {
			console.error('Error searching players:', error);
			dropdown.classList.add('hidden');
		}
	}, 300);
}

function selectH2HPlayer(playerNum, playerId, playerName) {
	document.getElementById(`h2hPlayer${playerNum}Id`).value = playerId;
	document.getElementById(`h2hPlayer${playerNum}Search`).value = playerName;
	document.getElementById(`h2hPlayer${playerNum}Dropdown`).classList.add('hidden');

	const selected = document.getElementById(`h2hPlayer${playerNum}Selected`);
	selected.querySelector('span').textContent = playerName;
	selected.classList.remove('hidden');
}

async function loadHeadToHead() {
	const player1Id = document.getElementById('h2hPlayer1Id').value;
	const player2Id = document.getElementById('h2hPlayer2Id').value;
	const content = document.getElementById('h2hContent');

	if (!player1Id || !player2Id) {
		showAlert('Please select both players', 'error');
		return;
	}

	content.innerHTML = '<p class="text-gray-400 text-center py-8">Loading head-to-head...</p>';

	try {
		const params = new URLSearchParams();
		if (currentGameId) params.append('game', currentGameId);

		const response = await fetch(`/api/analytics/players/${player1Id}/head-to-head/${player2Id}?${params}`);
		const data = await response.json();

		if (data.success) {
			renderHeadToHead(data);
		} else {
			content.innerHTML = '<p class="text-red-400 text-center py-8">Error loading head-to-head</p>';
		}
	} catch (error) {
		console.error('Error loading head-to-head:', error);
		content.innerHTML = '<p class="text-red-400 text-center py-8">Error loading head-to-head</p>';
	}
}

function renderHeadToHead(data) {
	const content = document.getElementById('h2hContent');

	if (!data.matches || data.matches.length === 0) {
		content.innerHTML = '<p class="text-gray-400 text-center py-8">No matches found between these players</p>';
		return;
	}

	const p1 = data.player1;
	const p2 = data.player2;
	const record = data.record;
	const total = record.player1Wins + record.player2Wins;
	const p1Pct = total > 0 ? Math.round((record.player1Wins / total) * 100) : 50;

	let html = `
		<div class="bg-gray-750 rounded-lg p-6 mb-6">
			<div class="flex items-center justify-between mb-4">
				<div class="text-center flex-1">
					<div class="text-lg font-bold text-white">${escapeHtml(p1.display_name)}</div>
					<div class="text-3xl font-bold text-green-400">${record.player1Wins}</div>
				</div>
				<div class="text-2xl text-gray-500 px-4">vs</div>
				<div class="text-center flex-1">
					<div class="text-lg font-bold text-white">${escapeHtml(p2.display_name)}</div>
					<div class="text-3xl font-bold text-red-400">${record.player2Wins}</div>
				</div>
			</div>
			<div class="h-3 bg-gray-600 rounded-full overflow-hidden">
				<div class="h-full bg-gradient-to-r from-green-500 to-green-400" style="width: ${p1Pct}%"></div>
			</div>
		</div>

		<h4 class="text-md font-semibold text-gray-300 mb-3">Match History</h4>
		<div class="space-y-2">
	`;

	for (const match of data.matches) {
		const winnerId = match.winner_id;
		const p1Won = winnerId === p1.id;
		const resultClass = p1Won ? 'border-l-green-500' : 'border-l-red-500';

		html += `
			<div class="bg-gray-750 rounded-lg p-3 border-l-4 ${resultClass}">
				<div class="flex items-center justify-between">
					<div>
						<span class="text-white font-medium">${p1Won ? escapeHtml(p1.display_name) : escapeHtml(p2.display_name)}</span>
						<span class="text-gray-400"> def. </span>
						<span class="text-white">${p1Won ? escapeHtml(p2.display_name) : escapeHtml(p1.display_name)}</span>
					</div>
					<div class="text-sm text-gray-400">
						${match.scores_csv || ''} | ${escapeHtml(match.tournament_name)}
					</div>
				</div>
			</div>
		`;
	}

	html += '</div>';
	content.innerHTML = html;
}

// ============================================
// ATTENDANCE
// ============================================

async function loadAttendanceStats() {
	try {
		const params = new URLSearchParams({ months: 6 });
		if (currentGameId) params.append('game', currentGameId);

		const response = await fetch(`/api/analytics/stats/attendance?${params}`);
		const data = await response.json();

		if (data.success) {
			renderAttendanceCharts(data);
			renderTopAttendees(data.topAttendees);
		}
	} catch (error) {
		console.error('Error loading attendance stats:', error);
	}
}

function renderAttendanceCharts(data) {
	// Destroy existing charts
	if (attendanceChart) attendanceChart.destroy();
	if (newVsReturningChart) newVsReturningChart.destroy();

	// Monthly attendance chart
	const monthlyData = data.monthlyAttendance || [];
	const months = monthlyData.map(m => m.month);
	const participants = monthlyData.map(m => m.total_participants || 0);
	const tournaments = monthlyData.map(m => m.tournaments || 0);

	if (monthlyData.length > 0) {
		attendanceChart = new ApexCharts(document.getElementById('attendanceChart'), {
			chart: {
				type: 'bar',
				height: 280,
				background: 'transparent',
				toolbar: { show: false }
			},
			series: [
				{ name: 'Total Participants', data: participants },
				{ name: 'Tournaments', data: tournaments }
			],
			xaxis: {
				categories: months,
				labels: { style: { colors: '#9CA3AF' } }
			},
			yaxis: {
				labels: { style: { colors: '#9CA3AF' } }
			},
			colors: ['#3B82F6', '#10B981'],
			plotOptions: {
				bar: { borderRadius: 4, columnWidth: '60%' }
			},
			dataLabels: { enabled: false },
			legend: {
				position: 'top',
				labels: { colors: '#9CA3AF' }
			},
			grid: {
				borderColor: '#374151'
			},
			theme: { mode: 'dark' }
		});
		attendanceChart.render();
	}

	// New vs returning chart
	const newVsReturning = data.newVsReturning || [];
	const nvrMonths = newVsReturning.map(m => m.month);
	const newPlayers = newVsReturning.map(m => m.new || 0);
	const returningPlayers = newVsReturning.map(m => m.returning || 0);

	if (newVsReturning.length > 0) {
		newVsReturningChart = new ApexCharts(document.getElementById('newVsReturningChart'), {
			chart: {
				type: 'bar',
				stacked: true,
				height: 280,
				background: 'transparent',
				toolbar: { show: false }
			},
			series: [
				{ name: 'Returning', data: returningPlayers },
				{ name: 'New', data: newPlayers }
			],
			xaxis: {
				categories: nvrMonths,
				labels: { style: { colors: '#9CA3AF' } }
			},
			yaxis: {
				labels: { style: { colors: '#9CA3AF' } }
			},
			colors: ['#6366F1', '#F59E0B'],
			plotOptions: {
				bar: { borderRadius: 4, columnWidth: '60%' }
			},
			dataLabels: { enabled: false },
			legend: {
				position: 'top',
				labels: { colors: '#9CA3AF' }
			},
			grid: {
				borderColor: '#374151'
			},
			theme: { mode: 'dark' }
		});
		newVsReturningChart.render();
	}
}

function renderTopAttendees(attendees) {
	const content = document.getElementById('topAttendeesContent');

	if (!attendees || attendees.length === 0) {
		content.innerHTML = '<p class="text-gray-400 text-center py-4 col-span-full">No attendance data</p>';
		return;
	}

	let html = '';
	for (const a of attendees.slice(0, 12)) {
		html += `
			<div class="player-card" onclick="openPlayerProfile(${a.id})">
				<div class="font-medium text-white">${escapeHtml(a.display_name)}</div>
				<div class="text-sm text-gray-400">${a.tournaments_attended} tournaments</div>
			</div>
		`;
	}

	content.innerHTML = html;
}

// ============================================
// ARCHIVE MODAL
// ============================================

async function openArchiveModal() {
	const modal = document.getElementById('archiveModal');
	const content = document.getElementById('archiveContent');

	modal.classList.remove('hidden');
	content.innerHTML = '<p class="text-gray-400 text-center py-4">Loading tournaments...</p>';

	try {
		const response = await fetch('/api/analytics/archive/status');
		const data = await response.json();

		if (data.success) {
			renderArchiveStatus(data);
		} else {
			content.innerHTML = `<p class="text-red-400 text-center py-4">${data.error || 'Error loading tournaments'}</p>`;
		}
	} catch (error) {
		console.error('Error loading archive status:', error);
		content.innerHTML = '<p class="text-red-400 text-center py-4">Error loading tournaments</p>';
	}
}

function renderArchiveStatus(data) {
	const content = document.getElementById('archiveContent');

	let html = '';

	if (data.unarchived && data.unarchived.length > 0) {
		html += '<h4 class="text-sm font-semibold text-gray-300 mb-2">Available to Archive</h4>';
		html += '<div class="space-y-2 mb-4">';

		for (const t of data.unarchived) {
			html += `
				<div class="flex items-center justify-between bg-gray-750 rounded-lg p-3">
					<div>
						<div class="font-medium text-white text-sm">${escapeHtml(t.name)}</div>
						<div class="text-xs text-gray-400">${t.game || 'Unknown'} | ${t.participantCount} players</div>
					</div>
					<button onclick="archiveTournament('${t.url}')" class="archive-btn text-white px-3 py-1 rounded text-sm">
						Archive
					</button>
				</div>
			`;
		}
		html += '</div>';
	}

	if (data.archived && data.archived.length > 0) {
		html += '<h4 class="text-sm font-semibold text-gray-300 mb-2">Already Archived</h4>';
		html += '<div class="space-y-2">';

		for (const t of data.archived.slice(0, 5)) {
			html += `
				<div class="flex items-center justify-between bg-gray-750 rounded-lg p-3 opacity-60">
					<div>
						<div class="font-medium text-white text-sm">${escapeHtml(t.name)}</div>
						<div class="text-xs text-gray-400">${t.game || 'Unknown'} | ${t.participantCount} players</div>
					</div>
					<span class="text-green-400 text-xs">Archived</span>
				</div>
			`;
		}
		html += '</div>';
	}

	if (!data.unarchived?.length && !data.archived?.length) {
		html = '<p class="text-gray-400 text-center py-4">No completed tournaments found</p>';
	}

	content.innerHTML = html;
}

async function archiveTournament(tournamentUrl) {
	try {
		const btn = event.target;
		btn.disabled = true;
		btn.textContent = 'Archiving...';

		const response = await csrfFetch(`/api/analytics/archive/${tournamentUrl}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Archived: ${data.archived.name} (${data.archived.participants} players, ${data.archived.matches} matches)`, 'success');
			openArchiveModal(); // Refresh list
			loadOverviewStats();
			loadGames();
		} else {
			showAlert(data.error || 'Error archiving tournament', 'error');
			btn.disabled = false;
			btn.textContent = 'Archive';
		}
	} catch (error) {
		console.error('Error archiving tournament:', error);
		showAlert('Error archiving tournament', 'error');
	}
}

function closeArchiveModal() {
	document.getElementById('archiveModal').classList.add('hidden');
}

// ============================================
// SEEDING SUGGESTIONS
// ============================================

let seedingPollingInterval = null;
let seedingPollingActive = false;
let currentSeedingSuggestions = null;
let selectedSeedingTournament = null;

// Load upcoming tournaments for seeding dropdown
async function loadUpcomingTournaments() {
	try {
		const response = await fetch('/api/analytics/upcoming-tournaments');
		const data = await response.json();

		if (data.success) {
			renderSeedingTournamentOptions(data.tournaments);
		}
	} catch (error) {
		console.error('Error loading upcoming tournaments:', error);
	}
}

function renderSeedingTournamentOptions(tournaments) {
	const select = document.getElementById('seedingTournamentSelect');

	let html = '<option value="">Select tournament...</option>';

	for (const t of tournaments) {
		const badge = t.isToday ? ' [TODAY]' : '';
		const game = t.game ? ` (${t.game})` : '';
		const participants = t.participantCount ? ` - ${t.participantCount} players` : '';
		html += `<option value="${t.url}" data-game="${t.game || ''}">${escapeHtml(t.name)}${game}${participants}${badge}</option>`;
	}

	select.innerHTML = html;
}

function onSeedingTournamentChange() {
	const select = document.getElementById('seedingTournamentSelect');
	const toggleBtn = document.getElementById('seedingPollToggle');
	selectedSeedingTournament = select.value;

	if (selectedSeedingTournament) {
		toggleBtn.disabled = false;
		// Auto-load once when selected
		loadSeedingSuggestions();
	} else {
		toggleBtn.disabled = true;
		stopSeedingPolling();
		document.getElementById('seedingContent').innerHTML =
			'<p class="text-gray-400 text-center py-8">Select a tournament to view seeding suggestions</p>';
		document.getElementById('seedingStatusBar').classList.add('hidden');
		document.getElementById('seedingActions').classList.add('hidden');
	}
}

function toggleSeedingPolling() {
	if (seedingPollingActive) {
		stopSeedingPolling();
	} else {
		startSeedingPolling();
	}
}

function startSeedingPolling() {
	if (!selectedSeedingTournament) return;

	seedingPollingActive = true;
	updateSeedingPollingUI();

	// Initial load
	loadSeedingSuggestions();

	// Start 30-second polling
	seedingPollingInterval = setInterval(() => {
		loadSeedingSuggestions();
	}, 30000);

	console.log('[Seeding] Started polling every 30 seconds');
}

function stopSeedingPolling() {
	seedingPollingActive = false;
	if (seedingPollingInterval) {
		clearInterval(seedingPollingInterval);
		seedingPollingInterval = null;
	}
	updateSeedingPollingUI();
	console.log('[Seeding] Stopped polling');
}

function updateSeedingPollingUI() {
	const toggleBtn = document.getElementById('seedingPollToggle');
	const pollIcon = document.getElementById('seedingPollIcon');
	const pollText = document.getElementById('seedingPollText');
	const statusBar = document.getElementById('seedingStatusBar');
	const statusIndicator = document.getElementById('seedingStatusIndicator');
	const statusText = document.getElementById('seedingStatusText');

	if (seedingPollingActive) {
		toggleBtn.classList.remove('bg-gray-600', 'hover:bg-gray-500');
		toggleBtn.classList.add('bg-red-600', 'hover:bg-red-700');
		pollIcon.classList.remove('bg-gray-400');
		pollIcon.classList.add('bg-green-400', 'animate-pulse');
		pollText.textContent = 'Stop Polling';

		statusBar.classList.remove('hidden');
		statusIndicator.classList.remove('bg-gray-500');
		statusIndicator.classList.add('bg-green-500', 'animate-pulse');
		statusText.textContent = 'Polling every 30 seconds';
	} else {
		toggleBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
		toggleBtn.classList.add('bg-gray-600', 'hover:bg-gray-500');
		pollIcon.classList.remove('bg-green-400', 'animate-pulse');
		pollIcon.classList.add('bg-gray-400');
		pollText.textContent = 'Start Polling';

		statusIndicator.classList.remove('bg-green-500', 'animate-pulse');
		statusIndicator.classList.add('bg-gray-500');
		statusText.textContent = 'Polling stopped';
	}
}

async function loadSeedingSuggestions() {
	if (!selectedSeedingTournament) return;

	// Use AI endpoint if AI mode is enabled
	if (aiSeedingEnabled) {
		return loadAISeedingSuggestions();
	}

	try {
		const response = await fetch(`/api/analytics/seeding-suggestions/${selectedSeedingTournament}`);
		const data = await response.json();

		if (data.success) {
			currentSeedingSuggestions = data;
			renderSeedingSuggestions(data);
			updateSeedingStatus(data);
		} else {
			document.getElementById('seedingContent').innerHTML =
				`<p class="text-red-400 text-center py-8">${data.error || 'Error loading suggestions'}</p>`;
		}
	} catch (error) {
		console.error('Error loading seeding suggestions:', error);
		document.getElementById('seedingContent').innerHTML =
			'<p class="text-red-400 text-center py-8">Error loading seeding suggestions</p>';
	}
}

function updateSeedingStatus(data) {
	const lastUpdate = document.getElementById('seedingLastUpdate');
	const participantCount = document.getElementById('seedingParticipantCount');
	const statusBar = document.getElementById('seedingStatusBar');

	statusBar.classList.remove('hidden');

	const time = new Date(data.timestamp);
	lastUpdate.textContent = `Updated: ${time.toLocaleTimeString()}`;
	participantCount.textContent = `${data.suggestions.length} participants`;
}

function renderSeedingSuggestions(data) {
	const content = document.getElementById('seedingContent');
	const actionsDiv = document.getElementById('seedingActions');
	const changesCount = document.getElementById('seedingChangesCount');

	if (!data.suggestions || data.suggestions.length === 0) {
		content.innerHTML = '<p class="text-gray-400 text-center py-8">No participants found</p>';
		actionsDiv.classList.add('hidden');
		return;
	}

	// Count changes
	const changes = data.suggestions.filter(s => s.seedDiff && s.seedDiff !== 0).length;
	changesCount.textContent = changes;

	let html = `
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-gray-700 text-left">
						<th class="py-2 px-3 text-gray-400">Suggested</th>
						<th class="py-2 px-3 text-gray-400">Player</th>
						<th class="py-2 px-3 text-gray-400 text-center">Elo</th>
						<th class="py-2 px-3 text-gray-400 text-center">Current Seed</th>
						<th class="py-2 px-3 text-gray-400 text-center">Change</th>
						<th class="py-2 px-3 text-gray-400">Status</th>
					</tr>
				</thead>
				<tbody>
	`;

	for (const s of data.suggestions) {
		const rankClass = s.suggestedSeed <= 3 ? `rank-${s.suggestedSeed}` : 'bg-gray-700 text-gray-300';
		const eloDisplay = s.elo ? `<span class="elo-badge">${s.elo}</span>` : '<span class="text-gray-500">--</span>';

		let changeDisplay = '--';
		let changeClass = 'text-gray-500';
		if (s.seedDiff !== null) {
			if (s.seedDiff < 0) {
				changeDisplay = `+${Math.abs(s.seedDiff)}`;
				changeClass = 'text-green-400';
			} else if (s.seedDiff > 0) {
				changeDisplay = `-${s.seedDiff}`;
				changeClass = 'text-red-400';
			} else {
				changeDisplay = '=';
				changeClass = 'text-gray-400';
			}
		}

		let statusBadge = '';
		if (s.isNewPlayer) {
			statusBadge = '<span class="px-2 py-0.5 bg-yellow-600 text-yellow-100 rounded text-xs">New</span>';
		} else if (s.matchType === 'fuzzy') {
			statusBadge = '<span class="px-2 py-0.5 bg-blue-600 text-blue-100 rounded text-xs">Matched</span>';
		} else if (s.matchType === 'exact' || s.matchType === 'alias') {
			statusBadge = '<span class="px-2 py-0.5 bg-green-600 text-green-100 rounded text-xs">Known</span>';
		}

		html += `
			<tr class="border-b border-gray-700 hover:bg-gray-750">
				<td class="py-2 px-3">
					<span class="rank-badge ${rankClass}" style="width:1.75rem;height:1.75rem;font-size:0.75rem">${s.suggestedSeed}</span>
				</td>
				<td class="py-2 px-3">
					<span class="font-medium text-white">${escapeHtml(s.name)}</span>
				</td>
				<td class="py-2 px-3 text-center">${eloDisplay}</td>
				<td class="py-2 px-3 text-center text-gray-300">${s.currentSeed || '--'}</td>
				<td class="py-2 px-3 text-center font-medium ${changeClass}">${changeDisplay}</td>
				<td class="py-2 px-3">${statusBadge}</td>
			</tr>
		`;
	}

	html += '</tbody></table></div>';
	content.innerHTML = html;

	// Show actions if there are changes
	if (changes > 0) {
		actionsDiv.classList.remove('hidden');
	} else {
		actionsDiv.classList.add('hidden');
	}
}

async function applySeedingSuggestions() {
	if (!currentSeedingSuggestions || !selectedSeedingTournament) {
		showAlert('No suggestions to apply', 'error');
		return;
	}

	const btn = document.getElementById('applySeedingBtn');
	btn.disabled = true;
	btn.textContent = 'Applying...';

	try {
		// Support both ELO-based (suggestions with suggestedSeed) and AI-based (seeds with seed)
		const seedsArray = currentSeedingSuggestions.seeds || currentSeedingSuggestions.suggestions || [];
		const seeds = seedsArray.map(s => ({
			participantId: s.participantId,
			seed: s.seed ?? s.suggestedSeed
		}));

		// Use AI endpoint if AI mode is enabled, otherwise use standard endpoint
		const endpoint = aiSeedingEnabled
			? `/api/analytics/ai-seeding/${selectedSeedingTournament}/apply`
			: `/api/analytics/apply-seeding/${selectedSeedingTournament}`;

		const response = await csrfFetch(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ seeds })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Applied seeding: ${data.applied} updated, ${data.failed} failed`, data.failed > 0 ? 'warning' : 'success');
			// Reload to show updated seeds
			await loadSeedingSuggestions();
		} else {
			showAlert(data.error || 'Error applying seeding', 'error');
		}
	} catch (error) {
		console.error('Error applying seeding:', error);
		showAlert('Error applying seeding', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Apply Suggested Seeding';
	}
}

// Load upcoming tournaments on page load
document.addEventListener('DOMContentLoaded', () => {
	loadUpcomingTournaments();
});

// Stop polling when page is hidden
document.addEventListener('visibilitychange', () => {
	if (document.hidden && seedingPollingActive) {
		console.log('[Seeding] Page hidden, pausing polling');
		clearInterval(seedingPollingInterval);
		seedingPollingInterval = null;
	} else if (!document.hidden && seedingPollingActive && !seedingPollingInterval) {
		console.log('[Seeding] Page visible, resuming polling');
		loadSeedingSuggestions();
		seedingPollingInterval = setInterval(() => {
			loadSeedingSuggestions();
		}, 30000);
	}
});

// ============================================
// AI SEEDING FUNCTIONS
// ============================================

let aiSeedingEnabled = false;
let aiSeedingAvailable = false;
let lockedSeeds = new Map(); // participantId -> seed

// Check if AI seeding is available on page load
async function checkAISeedingStatus() {
	try {
		const response = await fetch('/api/analytics/ai-seeding/status');
		const data = await response.json();

		aiSeedingAvailable = data.available;
		const statusBadge = document.getElementById('aiSeedingStatus');
		const toggle = document.getElementById('aiSeedingToggle');
		const label = document.getElementById('aiSeedingToggleLabel');

		if (aiSeedingAvailable) {
			statusBadge.classList.remove('hidden');
			statusBadge.textContent = 'Available';
			statusBadge.classList.remove('bg-gray-600', 'text-gray-300');
			statusBadge.classList.add('bg-purple-600', 'text-purple-100');
			toggle.disabled = false;
		} else {
			statusBadge.classList.remove('hidden');
			statusBadge.textContent = data.reason || 'Unavailable';
			statusBadge.classList.remove('bg-purple-600', 'text-purple-100');
			statusBadge.classList.add('bg-gray-600', 'text-gray-300');
			toggle.disabled = true;
			label.title = data.reason || 'AI seeding not available';
		}
	} catch (error) {
		console.error('[AI Seeding] Error checking status:', error);
	}
}

// Toggle AI seeding mode
function toggleAISeeding(enabled) {
	aiSeedingEnabled = enabled;
	console.log('[AI Seeding] Mode:', enabled ? 'enabled' : 'disabled');

	// Show/hide regenerate button
	const regenerateBtn = document.getElementById('regenerateSeedingBtn');
	if (enabled) {
		regenerateBtn.classList.remove('hidden');
	} else {
		regenerateBtn.classList.add('hidden');
	}

	// Hide AI-specific elements when disabled
	if (!enabled) {
		document.getElementById('bracketBalanceDisplay').classList.add('hidden');
		document.getElementById('aiSeedingReasoning').classList.add('hidden');
		lockedSeeds.clear();
	}

	// Reload suggestions with new mode
	if (selectedSeedingTournament) {
		loadSeedingSuggestions();
	}
}

// Load AI seeding suggestions
async function loadAISeedingSuggestions(forceRegenerate = false) {
	console.log('[AI Seeding] === Starting loadAISeedingSuggestions ===');
	console.log('[AI Seeding] Tournament:', selectedSeedingTournament);
	console.log('[AI Seeding] Force regenerate:', forceRegenerate);

	if (!selectedSeedingTournament) {
		console.log('[AI Seeding] No tournament selected, aborting');
		return;
	}

	const progressDiv = document.getElementById('aiSeedingProgress');
	const progressText = document.getElementById('aiSeedingProgressText');
	const statusMessages = [
		'Analyzing player data...',
		'Checking recent matchups...',
		'Optimizing bracket balance...',
		'Generating recommendations...'
	];

	// Show progress indicator
	progressDiv.classList.remove('hidden');
	let messageIndex = 0;
	const progressInterval = setInterval(() => {
		progressText.textContent = statusMessages[messageIndex % statusMessages.length];
		messageIndex++;
	}, 1500);

	try {
		const url = `/api/analytics/ai-seeding/${selectedSeedingTournament}${forceRegenerate ? '?regenerate=true' : ''}`;
		console.log('[AI Seeding] Fetching URL:', url);

		const response = await fetch(url);
		console.log('[AI Seeding] Response status:', response.status);

		const data = await response.json();
		console.log('[AI Seeding] Response data:', data);

		clearInterval(progressInterval);
		progressDiv.classList.add('hidden');

		if (data.success) {
			console.log('[AI Seeding] Success! Source:', data.source);
			console.log('[AI Seeding] Seeds count:', data.seeds?.length || 0);
			currentSeedingSuggestions = data;
			renderAISeedingSuggestions(data);
			updateAISeedingStatus(data);
		} else {
			console.error('[AI Seeding] API returned error:', data.error);
			document.getElementById('seedingContent').innerHTML =
				`<p class="text-red-400 text-center py-8">${data.error || 'Error loading AI suggestions'}</p>`;
		}
	} catch (error) {
		clearInterval(progressInterval);
		progressDiv.classList.add('hidden');
		console.error('[AI Seeding] Exception caught:', error);
		document.getElementById('seedingContent').innerHTML =
			'<p class="text-red-400 text-center py-8">Error loading AI seeding suggestions</p>';
	}
}

// Update status bar for AI seeding
function updateAISeedingStatus(data) {
	const lastUpdate = document.getElementById('seedingLastUpdate');
	const participantCount = document.getElementById('seedingParticipantCount');
	const statusBar = document.getElementById('seedingStatusBar');
	const sourceSpan = document.getElementById('seedingSource');

	statusBar.classList.remove('hidden');

	const time = new Date(data.timestamp || data.updatedAt);
	lastUpdate.textContent = `Updated: ${time.toLocaleTimeString()}`;
	participantCount.textContent = `${data.seeds?.length || data.suggestions?.length || 0} participants`;

	// Show source badge
	sourceSpan.classList.remove('hidden');
	if (data.source === 'ai') {
		sourceSpan.innerHTML = '<span class="px-2 py-0.5 bg-purple-600 text-purple-100 rounded text-xs">AI</span>';
	} else if (data.source === 'fallback') {
		sourceSpan.innerHTML = '<span class="px-2 py-0.5 bg-yellow-600 text-yellow-100 rounded text-xs">Fallback</span>';
	} else if (data.source === 'cache') {
		sourceSpan.innerHTML = '<span class="px-2 py-0.5 bg-blue-600 text-blue-100 rounded text-xs">Cached</span>';
	} else {
		sourceSpan.classList.add('hidden');
	}

	// Update bracket balance display
	if (data.bracketBalance) {
		updateBracketBalance(data.bracketBalance);
	}

	// Update AI reasoning display
	if (data.overallReasoning || data.avoidedMatchups || data.newPlayerPlacements) {
		updateAIReasoning(data);
	}
}

// Update bracket balance visualization
function updateBracketBalance(balance) {
	const balanceDiv = document.getElementById('bracketBalanceDisplay');
	const topHalfElo = document.getElementById('topHalfElo');
	const bottomHalfElo = document.getElementById('bottomHalfElo');
	const topHalfBar = document.getElementById('topHalfBar');
	const bottomHalfBar = document.getElementById('bottomHalfBar');
	const percentDisplay = document.getElementById('bracketBalancePercent');

	balanceDiv.classList.remove('hidden');

	const total = (balance.topHalfElo || 0) + (balance.bottomHalfElo || 0);
	const topPercent = total > 0 ? Math.round((balance.topHalfElo / total) * 100) : 50;
	const bottomPercent = 100 - topPercent;

	topHalfElo.textContent = balance.topHalfElo?.toLocaleString() || '--';
	bottomHalfElo.textContent = balance.bottomHalfElo?.toLocaleString() || '--';
	topHalfBar.style.width = `${topPercent}%`;
	bottomHalfBar.style.width = `${bottomPercent}%`;
	percentDisplay.textContent = `${topPercent}/${bottomPercent}`;

	// Color code based on balance
	const diff = Math.abs(topPercent - 50);
	if (diff <= 3) {
		percentDisplay.classList.remove('text-yellow-400', 'text-red-400');
		percentDisplay.classList.add('text-green-400');
	} else if (diff <= 7) {
		percentDisplay.classList.remove('text-green-400', 'text-red-400');
		percentDisplay.classList.add('text-yellow-400');
	} else {
		percentDisplay.classList.remove('text-green-400', 'text-yellow-400');
		percentDisplay.classList.add('text-red-400');
	}
}

// Update AI reasoning display
function updateAIReasoning(data) {
	const reasoningDiv = document.getElementById('aiSeedingReasoning');
	const reasoningText = document.getElementById('aiReasoningText');
	const avoidedDiv = document.getElementById('aiAvoidedMatchups');
	const avoidedList = document.getElementById('avoidedMatchupsList');
	const newPlayerDiv = document.getElementById('aiNewPlayerPlacements');
	const newPlayerList = document.getElementById('newPlayerPlacementsList');

	reasoningDiv.classList.remove('hidden');

	// Overall reasoning
	reasoningText.textContent = data.overallReasoning || 'AI-optimized bracket structure based on player statistics and bracket theory.';

	// Avoided matchups
	if (data.avoidedMatchups && data.avoidedMatchups.length > 0) {
		avoidedDiv.classList.remove('hidden');
		avoidedList.innerHTML = data.avoidedMatchups.map(m => `<li>${escapeHtml(m)}</li>`).join('');
	} else {
		avoidedDiv.classList.add('hidden');
	}

	// New player placements
	if (data.newPlayerPlacements && data.newPlayerPlacements.length > 0) {
		newPlayerDiv.classList.remove('hidden');
		newPlayerList.innerHTML = data.newPlayerPlacements.map(p => `<li>${escapeHtml(p)}</li>`).join('');
	} else {
		newPlayerDiv.classList.add('hidden');
	}
}

// Render AI seeding suggestions table with lock column
function renderAISeedingSuggestions(data) {
	const content = document.getElementById('seedingContent');
	const actionsDiv = document.getElementById('seedingActions');
	const changesCount = document.getElementById('seedingChangesCount');

	const seeds = data.seeds || data.suggestions || [];

	if (!seeds || seeds.length === 0) {
		content.innerHTML = '<p class="text-gray-400 text-center py-8">No participants found</p>';
		actionsDiv.classList.add('hidden');
		return;
	}

	// Count changes
	const changes = seeds.filter(s => {
		const diff = s.seedDiff ?? (s.currentSeed ? s.seed - s.currentSeed : 0);
		return diff !== 0;
	}).length;
	changesCount.textContent = changes;

	let html = `
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-gray-700 text-left">
						<th class="py-2 px-2 text-gray-400 w-10">Lock</th>
						<th class="py-2 px-3 text-gray-400">Seed</th>
						<th class="py-2 px-3 text-gray-400">Player</th>
						<th class="py-2 px-3 text-gray-400 text-center">Elo</th>
						<th class="py-2 px-3 text-gray-400 text-center">Current</th>
						<th class="py-2 px-3 text-gray-400 text-center">Change</th>
						<th class="py-2 px-3 text-gray-400">Status</th>
						${aiSeedingEnabled ? '<th class="py-2 px-3 text-gray-400">Reasoning</th>' : ''}
					</tr>
				</thead>
				<tbody>
	`;

	for (const s of seeds) {
		const seed = s.seed ?? s.suggestedSeed;
		const participantId = s.participantId;
		const currentSeed = s.currentSeed;
		const elo = s.elo;
		const isLocked = lockedSeeds.has(participantId);

		const rankClass = seed <= 3 ? `rank-${seed}` : 'bg-gray-700 text-gray-300';
		const eloDisplay = elo ? `<span class="elo-badge">${elo}</span>` : '<span class="text-gray-500">--</span>';

		// Calculate change
		const seedDiff = s.seedDiff ?? (currentSeed ? currentSeed - seed : null);
		let changeDisplay = '--';
		let changeClass = 'text-gray-500';
		if (seedDiff !== null) {
			if (seedDiff > 0) {
				changeDisplay = `+${seedDiff}`;
				changeClass = 'text-green-400';
			} else if (seedDiff < 0) {
				changeDisplay = `${seedDiff}`;
				changeClass = 'text-red-400';
			} else {
				changeDisplay = '=';
				changeClass = 'text-gray-400';
			}
		}

		// Status badges
		let statusBadge = '';
		if (s.isNewPlayer) {
			statusBadge = '<span class="px-2 py-0.5 bg-yellow-600 text-yellow-100 rounded text-xs">New</span>';
		} else if (s.matchType === 'fuzzy') {
			statusBadge = '<span class="px-2 py-0.5 bg-blue-600 text-blue-100 rounded text-xs">Matched</span>';
		} else if (s.matchType === 'exact' || s.matchType === 'alias') {
			statusBadge = '<span class="px-2 py-0.5 bg-green-600 text-green-100 rounded text-xs">Known</span>';
		}

		// Reasoning (AI mode only)
		const reasoning = s.reasoning || '';

		html += `
			<tr class="border-b border-gray-700 hover:bg-gray-750 ${isLocked ? 'bg-purple-900/20' : ''}">
				<td class="py-2 px-2 text-center">
					<input type="checkbox"
						${isLocked ? 'checked' : ''}
						onchange="toggleSeedLock('${participantId}', ${seed})"
						class="w-4 h-4 rounded border-gray-500 bg-gray-700 text-purple-600 focus:ring-purple-500 cursor-pointer"
						title="Lock this seed position">
				</td>
				<td class="py-2 px-3">
					<span class="rank-badge ${rankClass}" style="width:1.75rem;height:1.75rem;font-size:0.75rem">${seed}</span>
				</td>
				<td class="py-2 px-3">
					<span class="font-medium text-white">${escapeHtml(s.name)}</span>
					${isLocked ? '<span class="ml-2 text-purple-400 text-xs">locked</span>' : ''}
				</td>
				<td class="py-2 px-3 text-center">${eloDisplay}</td>
				<td class="py-2 px-3 text-center text-gray-300">${currentSeed || '--'}</td>
				<td class="py-2 px-3 text-center font-medium ${changeClass}">${changeDisplay}</td>
				<td class="py-2 px-3">${statusBadge}</td>
				${aiSeedingEnabled ? `<td class="py-2 px-3 text-xs text-gray-400 max-w-xs truncate" title="${escapeHtml(reasoning)}">${escapeHtml(reasoning)}</td>` : ''}
			</tr>
		`;
	}

	html += '</tbody></table></div>';
	content.innerHTML = html;

	// Show actions
	actionsDiv.classList.remove('hidden');
}

// Toggle seed lock
async function toggleSeedLock(participantId, seed) {
	if (lockedSeeds.has(participantId)) {
		lockedSeeds.delete(participantId);
	} else {
		lockedSeeds.set(participantId, seed);
	}

	// Update visual state immediately
	const rows = document.querySelectorAll('#seedingContent tbody tr');
	rows.forEach(row => {
		const checkbox = row.querySelector('input[type="checkbox"]');
		if (checkbox) {
			const pid = checkbox.getAttribute('onchange').match(/'([^']+)'/)?.[1];
			if (pid === participantId) {
				if (lockedSeeds.has(participantId)) {
					row.classList.add('bg-purple-900/20');
				} else {
					row.classList.remove('bg-purple-900/20');
				}
			}
		}
	});

	// If AI seeding is enabled, send lock update to server
	if (aiSeedingEnabled && selectedSeedingTournament) {
		try {
			await csrfFetch(`/api/analytics/ai-seeding/${selectedSeedingTournament}/lock`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					lockedSeeds: Array.from(lockedSeeds.entries()).map(([pid, s]) => ({ participantId: pid, seed: s }))
				})
			});
		} catch (error) {
			console.error('[AI Seeding] Error updating locked seeds:', error);
		}
	}
}

// Regenerate AI seeding
async function regenerateAISeeding() {
	if (!aiSeedingEnabled || !selectedSeedingTournament) return;

	const btn = document.getElementById('regenerateSeedingBtn');
	btn.disabled = true;
	btn.textContent = 'Regenerating...';

	try {
		await loadAISeedingSuggestions(true);
		showAlert('AI seeding regenerated', 'success');
	} catch (error) {
		showAlert('Failed to regenerate seeding', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Regenerate';
	}
}

// Override loadSeedingSuggestions to route to AI or ELO based on mode
const originalLoadSeedingSuggestions = loadSeedingSuggestions;
loadSeedingSuggestions = async function() {
	if (aiSeedingEnabled && aiSeedingAvailable) {
		await loadAISeedingSuggestions();
	} else {
		await originalLoadSeedingSuggestions();
	}
};

// Initialize WebSocket listeners for real-time AI seeding updates
function initAISeedingWebSocket() {
	if (typeof io !== 'undefined') {
		const socket = io();

		socket.on('seeding:update', (data) => {
			if (data.tournamentId === selectedSeedingTournament && aiSeedingEnabled) {
				console.log('[AI Seeding] Received real-time update');
				currentSeedingSuggestions = data;
				renderAISeedingSuggestions(data);
				updateAISeedingStatus(data);
			}
		});

		socket.on('seeding:generating', (data) => {
			if (data.tournamentId === selectedSeedingTournament && aiSeedingEnabled) {
				const progressDiv = document.getElementById('aiSeedingProgress');
				const progressText = document.getElementById('aiSeedingProgressText');
				progressDiv.classList.remove('hidden');
				progressText.textContent = data.status || 'Generating recommendations...';
			}
		});

		socket.on('seeding:error', (data) => {
			if (data.tournamentId === selectedSeedingTournament && aiSeedingEnabled) {
				const progressDiv = document.getElementById('aiSeedingProgress');
				progressDiv.classList.add('hidden');
				showAlert(data.error || 'AI seeding error', 'error');
			}
		});
	}
}

// Check AI seeding status and init websocket on page load
document.addEventListener('DOMContentLoaded', () => {
	checkAISeedingStatus();
	initAISeedingWebSocket();
});

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Close modals on escape key
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') {
		closePlayerProfile();
		closeArchiveModal();
		closeTournamentModal();
	}
});

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
	if (!e.target.closest('#h2hPlayer1Search') && !e.target.closest('#h2hPlayer1Dropdown')) {
		document.getElementById('h2hPlayer1Dropdown').classList.add('hidden');
	}
	if (!e.target.closest('#h2hPlayer2Search') && !e.target.closest('#h2hPlayer2Dropdown')) {
		document.getElementById('h2hPlayer2Dropdown').classList.add('hidden');
	}
});

// ============================================
// EXPORT FUNCTIONS - Tournament Results Export
// ============================================

async function exportStandingsCSV(tournamentId, source) {
	try {
		const response = await fetch(`/api/export/${tournamentId}/standings/csv?source=${source}`);
		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.error || 'Export failed');
		}

		const blob = await response.blob();
		const contentDisposition = response.headers.get('Content-Disposition');
		const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
		const filename = filenameMatch ? filenameMatch[1] : `standings_${tournamentId}.csv`;

		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);

		showAlert('Standings exported successfully', 'success');
	} catch (error) {
		console.error('Error exporting standings:', error);
		showAlert('Failed to export standings: ' + error.message, 'error');
	}
}

async function exportMatchesCSV(tournamentId, source) {
	try {
		const response = await fetch(`/api/export/${tournamentId}/matches/csv?source=${source}`);
		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.error || 'Export failed');
		}

		const blob = await response.blob();
		const contentDisposition = response.headers.get('Content-Disposition');
		const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
		const filename = filenameMatch ? filenameMatch[1] : `matches_${tournamentId}.csv`;

		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);

		showAlert('Matches exported successfully', 'success');
	} catch (error) {
		console.error('Error exporting matches:', error);
		showAlert('Failed to export matches: ' + error.message, 'error');
	}
}

async function exportPDF(tournamentId, source) {
	try {
		showAlert('Generating PDF report...', 'info', 2000);

		const response = await fetch(`/api/export/${tournamentId}/report/pdf?source=${source}`);
		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.error || 'Export failed');
		}

		const blob = await response.blob();
		const contentDisposition = response.headers.get('Content-Disposition');
		const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
		const filename = filenameMatch ? filenameMatch[1] : `tournament_${tournamentId}_results.pdf`;

		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);

		showAlert('PDF report downloaded', 'success');
	} catch (error) {
		console.error('Error exporting PDF:', error);
		showAlert('Failed to export PDF: ' + error.message, 'error');
	}
}

// Cleanup all intervals and timeouts on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	if (seedingPollingInterval) clearInterval(seedingPollingInterval);
	if (playerSearchTimer) clearTimeout(playerSearchTimer);
	if (h2hSearchTimer) clearTimeout(h2hSearchTimer);
});

// ============================================
// TOURNAMENT NARRATIVE FUNCTIONS
// ============================================

let narrativeAvailable = false;
let currentNarrative = null;
let currentNarrativeFormat = 'discord';
let currentNarrativeTournament = null;
let currentNarrativeTournamentName = null;

/**
 * Check if narrative generation is available
 */
async function checkNarrativeStatus() {
	try {
		const response = await fetch('/api/analytics/ai/narrative/status');
		const data = await response.json();
		narrativeAvailable = data.available;

		// Show/hide Generate Recap buttons based on availability
		document.querySelectorAll('.narrative-btn').forEach(btn => {
			btn.style.display = narrativeAvailable ? 'inline-flex' : 'none';
		});
	} catch (error) {
		console.error('[Narrative] Status check failed:', error);
		narrativeAvailable = false;
	}
}

/**
 * Open the narrative modal for a tournament
 */
async function openNarrativeModal(tournamentId, tournamentName) {
	currentNarrativeTournament = tournamentId;
	currentNarrativeTournamentName = tournamentName;
	currentNarrativeFormat = 'discord';

	// Reset tab selection
	updateNarrativeTabStyles('discord');

	// Update modal header
	document.getElementById('narrativeTournamentName').textContent = tournamentName;

	// Show modal
	document.getElementById('narrativeModal').classList.remove('hidden');

	// Generate initial narrative
	await generateNarrative(tournamentId, currentNarrativeFormat);
}

/**
 * Close the narrative modal
 */
function closeNarrativeModal() {
	document.getElementById('narrativeModal').classList.add('hidden');
	currentNarrative = null;
	currentNarrativeTournament = null;
	currentNarrativeTournamentName = null;
}

/**
 * Generate narrative for a tournament
 */
async function generateNarrative(tournamentId, format, regenerate = false) {
	const progressDiv = document.getElementById('narrativeProgress');
	const contentDiv = document.getElementById('narrativeContent');
	const progressText = document.getElementById('narrativeProgressText');

	progressDiv.classList.remove('hidden');
	contentDiv.classList.add('hidden');

	// Cycle status messages
	const messages = [
		'Analyzing match results...',
		'Identifying storylines...',
		'Finding dramatic moments...',
		'Crafting narrative...'
	];
	let msgIndex = 0;
	const msgInterval = setInterval(() => {
		progressText.textContent = messages[msgIndex % messages.length];
		msgIndex++;
	}, 1500);

	try {
		const url = `/api/analytics/ai/narrative/${tournamentId}?format=${format}${regenerate ? '&regenerate=true' : ''}`;
		const response = await fetch(url);
		const data = await response.json();

		if (data.success) {
			currentNarrative = data;
			renderNarrative(data);
		} else {
			showAlert(data.error || 'Failed to generate narrative', 'error');
			document.getElementById('narrativeText').innerHTML = `
				<p class="text-red-400">Failed to generate narrative: ${escapeHtml(data.error || 'Unknown error')}</p>
			`;
		}
	} catch (error) {
		console.error('[Narrative] Generation failed:', error);
		showAlert('Failed to generate narrative', 'error');
		document.getElementById('narrativeText').innerHTML = `
			<p class="text-red-400">Failed to generate narrative: ${escapeHtml(error.message)}</p>
		`;
	} finally {
		clearInterval(msgInterval);
		progressDiv.classList.add('hidden');
		contentDiv.classList.remove('hidden');
	}
}

/**
 * Render the narrative content
 */
function renderNarrative(data) {
	const textDiv = document.getElementById('narrativeText');
	const storylinesDiv = document.getElementById('narrativeStorylines');
	const sourceDiv = document.getElementById('narrativeSource');

	// Render narrative text
	if (data.format === 'social') {
		textDiv.innerHTML = `
			<div class="bg-gray-700 rounded-lg p-4">
				<p class="text-lg text-white">${escapeHtml(data.narrative)}</p>
				<p class="text-sm text-gray-400 mt-3">${data.narrative.length}/280 characters</p>
			</div>
		`;
	} else {
		// Simple markdown rendering for discord/full
		textDiv.innerHTML = renderMarkdown(data.narrative);
	}

	// Render storylines if available
	if (data.storylines && hasStorylines(data.storylines)) {
		storylinesDiv.classList.remove('hidden');
		const listDiv = document.getElementById('storylinesList');
		listDiv.innerHTML = '';

		if (data.storylines.upsets?.length > 0) {
			listDiv.innerHTML += `
				<div class="flex items-center gap-2 text-yellow-400">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
					</svg>
					<span>Upsets: ${data.storylines.upsets.length}</span>
				</div>
			`;
		}
		if (data.storylines.closeMatches?.length > 0) {
			listDiv.innerHTML += `
				<div class="flex items-center gap-2 text-blue-400">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
					</svg>
					<span>Close Matches: ${data.storylines.closeMatches.length}</span>
				</div>
			`;
		}
		if (data.storylines.reverseSweeps?.length > 0) {
			listDiv.innerHTML += `
				<div class="flex items-center gap-2 text-purple-400">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
					</svg>
					<span>Reverse Sweeps: ${data.storylines.reverseSweeps.length}</span>
				</div>
			`;
		}
		if (data.storylines.losersRuns?.length > 0) {
			listDiv.innerHTML += `
				<div class="flex items-center gap-2 text-green-400">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"></path>
					</svg>
					<span>Losers Bracket Runs: ${data.storylines.losersRuns.length}</span>
				</div>
			`;
		}
	} else {
		storylinesDiv.classList.add('hidden');
	}

	// Source indicator
	if (data.cached) {
		sourceDiv.textContent = `Cached (${data.source}) - ${formatTimeAgo(data.cachedAt)}`;
	} else {
		sourceDiv.textContent = `Generated (${data.source})`;
	}
}

/**
 * Check if storylines object has any data
 */
function hasStorylines(storylines) {
	return storylines.upsets?.length > 0 ||
		storylines.closeMatches?.length > 0 ||
		storylines.reverseSweeps?.length > 0 ||
		storylines.losersRuns?.length > 0;
}

/**
 * Switch narrative format
 */
function switchNarrativeFormat(format) {
	currentNarrativeFormat = format;
	updateNarrativeTabStyles(format);

	// Regenerate with new format
	if (currentNarrativeTournament) {
		generateNarrative(currentNarrativeTournament, format);
	}
}

/**
 * Update tab styling
 */
function updateNarrativeTabStyles(activeFormat) {
	['social', 'discord', 'full'].forEach(f => {
		const tab = document.getElementById(`narrativeTab${f.charAt(0).toUpperCase() + f.slice(1)}`);
		if (tab) {
			if (f === activeFormat) {
				tab.classList.add('bg-blue-600', 'text-white');
				tab.classList.remove('bg-gray-700', 'text-gray-300');
			} else {
				tab.classList.remove('bg-blue-600', 'text-white');
				tab.classList.add('bg-gray-700', 'text-gray-300');
			}
		}
	});
}

/**
 * Regenerate the current narrative
 */
async function regenerateNarrative() {
	if (!currentNarrativeTournament) return;

	const btn = document.getElementById('regenerateNarrativeBtn');
	btn.disabled = true;
	btn.innerHTML = `
		<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
		</svg>
		Regenerating...
	`;

	try {
		await generateNarrative(currentNarrativeTournament, currentNarrativeFormat, true);
		showAlert('Narrative regenerated', 'success');
	} finally {
		btn.disabled = false;
		btn.innerHTML = `
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
			</svg>
			Regenerate
		`;
	}
}

/**
 * Copy narrative to clipboard
 */
function copyNarrative() {
	if (!currentNarrative) return;

	const text = currentNarrative.narrative;

	navigator.clipboard.writeText(text).then(() => {
		showAlert('Copied to clipboard!', 'success');
	}).catch(err => {
		console.error('Failed to copy:', err);
		showAlert('Failed to copy to clipboard', 'error');
	});
}

/**
 * Simple markdown rendering for narratives
 */
function renderMarkdown(text) {
	if (!text) return '';

	return text
		// Headers
		.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold text-white mt-6 mb-3">$1</h2>')
		.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold text-white mt-4 mb-2">$1</h3>')
		// Bold
		.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
		// Italic
		.replace(/\*(.+?)\*/g, '<em>$1</em>')
		// Lists
		.replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>')
		// Paragraphs (double newlines)
		.replace(/\n\n/g, '</p><p class="mt-3 text-gray-200">')
		// Single newlines to <br>
		.replace(/\n/g, '<br>')
		// Wrap in paragraph
		.replace(/^/, '<p class="text-gray-200">')
		.replace(/$/, '</p>')
		// Clean up list items
		.replace(/<\/p><li/g, '</p><ul class="list-disc mt-2 mb-2"><li')
		.replace(/<\/li><p/g, '</li></ul><p');
}

// Check narrative status on page load
document.addEventListener('DOMContentLoaded', () => {
	checkNarrativeStatus();
});
