// Games Configuration Management
// Handles CRUD operations for game rulesets

let games = {};
let deleteGameKey = null;
let pollingInterval = null;

// Default prize gradients
const PRIZE_GRADIENTS = {
	1: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',  // Gold
	2: 'linear-gradient(135deg, #c0c0c0 0%, #909090 100%)',  // Silver
	3: 'linear-gradient(135deg, #cd7f32 0%, #8b5a2b 100%)'   // Bronze
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
	loadGames();
	initLastUpdated('gamesLastUpdated', loadGames, { prefix: 'Updated' });
	startPolling();
	setupVisibilityHandler(startPolling, stopPolling);
});

// Start polling for updates
function startPolling() {
	if (pollingInterval) return;
	pollingInterval = setInterval(loadGames, 30000);
}

// Stop polling
function stopPolling() {
	if (pollingInterval) {
		clearInterval(pollingInterval);
		pollingInterval = null;
	}
}

// Load all games
async function loadGames() {
	try {
		const response = await fetch('/api/games');
		if (!response.ok) throw new Error('Failed to load games');

		const data = await response.json();

		// Convert array response to object keyed by gameKey
		games = {};
		if (Array.isArray(data.games)) {
			for (const game of data.games) {
				games[game.gameKey] = game;
			}
		} else {
			games = data.games || {};
		}

		renderGamesGrid();
		updateGameCount();
		setLastUpdated('gamesLastUpdated');
	} catch (error) {
		console.error('Error loading games:', error);
		showAlert('Failed to load games: ' + error.message, 'error');
	}
}

// Update game count display
function updateGameCount() {
	const count = Object.keys(games).length;
	document.getElementById('gameCount').textContent =
		`${count} game${count !== 1 ? 's' : ''} configured`;
}

// Render games grid
function renderGamesGrid() {
	const container = document.getElementById('gamesGrid');
	const gameKeys = Object.keys(games);

	if (gameKeys.length === 0) {
		container.innerHTML = `
			<div class="text-center py-8 text-gray-400 col-span-full">
				<p class="mb-4">No games configured yet.</p>
				<button onclick="openAddGameModal()" class="text-blue-400 hover:text-blue-300">
					Add your first game
				</button>
			</div>
		`;
		return;
	}

	// Sort: default first, then alphabetically
	gameKeys.sort((a, b) => {
		if (a === 'default') return -1;
		if (b === 'default') return 1;
		return games[a].name.localeCompare(games[b].name);
	});

	container.innerHTML = gameKeys.map(key => renderGameCard(key, games[key])).join('');
}

// Render a single game card
function renderGameCard(key, game) {
	const isDefault = key === 'default';
	const rulesCount = game.rules?.length || 0;
	const prizesCount = game.prizes?.length || 0;
	const infoCount = game.additionalInfo?.length || 0;

	// Generate initials for icon
	const initials = game.shortName ||
		game.name.split(' ').map(w => w[0]).join('').substring(0, 3).toUpperCase();

	// Format prizes for display
	const prizeDisplay = game.prizes?.slice(0, 3).map(p =>
		`$${p.amount}`
	).join(' / ') || 'No prizes';

	// Different styling for default fallback card
	const cardClasses = isDefault
		? 'bg-gray-900 rounded-lg border-2 border-dashed border-gray-600 overflow-hidden'
		: 'bg-gray-800 rounded-lg border border-gray-700 overflow-hidden';

	const iconClasses = isDefault
		? 'w-12 h-12 bg-gray-600 rounded-lg flex items-center justify-center text-gray-300 font-bold text-sm'
		: 'w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm';

	return `
		<div class="${cardClasses}">
			${isDefault ? `
				<div class="bg-gray-700 px-4 py-2 border-b border-gray-600">
					<div class="flex items-center gap-2">
						<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
						</svg>
						<span class="text-xs text-gray-400">System Fallback - Used when no game-specific config exists</span>
					</div>
				</div>
			` : ''}
			<div class="p-4">
				<!-- Header -->
				<div class="flex items-start justify-between mb-4">
					<div class="flex items-center gap-3">
						<div class="${iconClasses}">
							${escapeHtml(initials)}
						</div>
						<div>
							<h3 class="text-lg font-bold ${isDefault ? 'text-gray-300' : 'text-white'}">${escapeHtml(game.name)}</h3>
							<p class="text-sm text-gray-400">
								${isDefault ? '<span class="text-gray-500">Key: default</span>' : `Key: ${escapeHtml(key)}`}
							</p>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<button onclick="openEditGameModal('${escapeHtml(key)}')"
							class="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition"
							title="Edit">
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
							</svg>
						</button>
						${!isDefault ? `
							<button onclick="openDeleteModal('${escapeHtml(key)}')"
								class="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition"
								title="Delete">
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
								</svg>
							</button>
						` : ''}
					</div>
				</div>

				<!-- Stats -->
				<div class="grid grid-cols-3 gap-4 mb-4">
					<div class="text-center p-2 ${isDefault ? 'bg-gray-800' : 'bg-gray-750'} rounded">
						<div class="text-xl font-bold ${isDefault ? 'text-gray-300' : 'text-white'}">${rulesCount}</div>
						<div class="text-xs text-gray-400">Rules</div>
					</div>
					<div class="text-center p-2 ${isDefault ? 'bg-gray-800' : 'bg-gray-750'} rounded">
						<div class="text-xl font-bold ${isDefault ? 'text-gray-300' : 'text-white'}">${prizesCount}</div>
						<div class="text-xs text-gray-400">Prizes</div>
					</div>
					<div class="text-center p-2 ${isDefault ? 'bg-gray-800' : 'bg-gray-750'} rounded">
						<div class="text-xl font-bold ${isDefault ? 'text-gray-300' : 'text-white'}">${infoCount}</div>
						<div class="text-xs text-gray-400">Info</div>
					</div>
				</div>

				<!-- Prize Preview -->
				<div class="text-sm text-gray-300 mb-3">
					<span class="text-gray-500">Prizes:</span> ${escapeHtml(prizeDisplay)}
				</div>

				<!-- Rules Preview (first 2) -->
				${game.rules?.length > 0 ? `
					<div class="space-y-1">
						${game.rules.slice(0, 2).map(rule => `
							<div class="text-sm">
								<span class="text-gray-400">${escapeHtml(rule.title)}:</span>
								<span class="text-gray-300">${escapeHtml(truncate(rule.description, 80))}</span>
							</div>
						`).join('')}
						${game.rules.length > 2 ? `
							<div class="text-xs text-gray-500">+${game.rules.length - 2} more rules</div>
						` : ''}
					</div>
				` : `
					<div class="text-sm text-gray-500 italic">No rules defined</div>
				`}
			</div>
		</div>
	`;
}

// Truncate text
function truncate(text, maxLength) {
	if (!text) return '';
	return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

// =====================
// Modal Management
// =====================

// Open add game modal
function openAddGameModal() {
	document.getElementById('modalTitle').textContent = 'Add Game';
	document.getElementById('editGameKey').value = '';
	document.getElementById('gameKey').value = '';
	document.getElementById('gameKey').disabled = false;
	document.getElementById('gameName').value = '';
	document.getElementById('gameShortName').value = '';

	// Clear dynamic sections
	document.getElementById('rulesContainer').innerHTML = '';
	document.getElementById('prizesContainer').innerHTML = '';
	document.getElementById('infoContainer').innerHTML = '';

	// Add default prize rows
	addPrizeRow({ place: 1, position: '1st Place', amount: 100 });
	addPrizeRow({ place: 2, position: '2nd Place', amount: 50 });
	addPrizeRow({ place: 3, position: '3rd Place', amount: 25 });

	document.getElementById('gameModal').classList.remove('hidden');
}

// Open edit game modal
function openEditGameModal(gameKey) {
	const game = games[gameKey];
	if (!game) {
		showAlert('Game not found', 'error');
		return;
	}

	document.getElementById('modalTitle').textContent = `Edit Game: ${game.name}`;
	document.getElementById('editGameKey').value = gameKey;
	document.getElementById('gameKey').value = gameKey;
	document.getElementById('gameKey').disabled = true;  // Can't change key when editing
	document.getElementById('gameName').value = game.name || '';
	document.getElementById('gameShortName').value = game.shortName || '';

	// Clear and populate dynamic sections
	document.getElementById('rulesContainer').innerHTML = '';
	document.getElementById('prizesContainer').innerHTML = '';
	document.getElementById('infoContainer').innerHTML = '';

	// Add rules
	if (game.rules?.length > 0) {
		game.rules.forEach(rule => addRuleRow(rule));
	}

	// Add prizes
	if (game.prizes?.length > 0) {
		game.prizes.forEach(prize => addPrizeRow(prize));
	}

	// Add additional info
	if (game.additionalInfo?.length > 0) {
		game.additionalInfo.forEach(info => addInfoRow(info));
	}

	document.getElementById('gameModal').classList.remove('hidden');
}

// Close game modal
function closeGameModal() {
	document.getElementById('gameModal').classList.add('hidden');
}

// =====================
// Dynamic Row Management
// =====================

// Add rule row
function addRuleRow(rule = {}) {
	const container = document.getElementById('rulesContainer');
	const index = container.children.length;

	const row = document.createElement('div');
	row.className = 'flex gap-2 items-start';
	row.innerHTML = `
		<input type="text" placeholder="Rule Title" value="${escapeHtml(rule.title || '')}"
			class="rule-title w-1/3 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:ring-2 focus:ring-blue-500">
		<input type="text" placeholder="Rule Description" value="${escapeHtml(rule.description || '')}"
			class="rule-description flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:ring-2 focus:ring-blue-500">
		<button type="button" onclick="this.parentElement.remove()"
			class="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition flex-shrink-0">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
			</svg>
		</button>
	`;
	container.appendChild(row);
}

// Add prize row
function addPrizeRow(prize = {}) {
	const container = document.getElementById('prizesContainer');
	const index = container.children.length + 1;

	const row = document.createElement('div');
	row.className = 'flex gap-2 items-center';
	row.innerHTML = `
		<input type="number" placeholder="Place" value="${prize.place || index}" min="1"
			class="prize-place w-16 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm text-center focus:ring-2 focus:ring-blue-500">
		<input type="text" placeholder="Position Label" value="${escapeHtml(prize.position || '')}"
			class="prize-position w-24 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:ring-2 focus:ring-blue-500">
		<div class="flex items-center">
			<span class="text-gray-400 text-sm mr-1">$</span>
			<input type="number" placeholder="Amount" value="${prize.amount || 0}" min="0"
				class="prize-amount w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:ring-2 focus:ring-blue-500">
		</div>
		<input type="text" placeholder="Extras (comma-separated)" value="${escapeHtml((prize.extras || []).join(', '))}"
			class="prize-extras flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:ring-2 focus:ring-blue-500">
		<button type="button" onclick="this.parentElement.remove()"
			class="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition flex-shrink-0">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
			</svg>
		</button>
	`;
	container.appendChild(row);
}

// Add info row
function addInfoRow(info = '') {
	const container = document.getElementById('infoContainer');

	const row = document.createElement('div');
	row.className = 'flex gap-2 items-center';
	row.innerHTML = `
		<input type="text" placeholder="Additional info text" value="${escapeHtml(info)}"
			class="info-text flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:ring-2 focus:ring-blue-500">
		<button type="button" onclick="this.parentElement.remove()"
			class="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition flex-shrink-0">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
			</svg>
		</button>
	`;
	container.appendChild(row);
}

// =====================
// Save Game
// =====================

async function saveGame(event) {
	event.preventDefault();

	const editKey = document.getElementById('editGameKey').value;
	const gameKey = document.getElementById('gameKey').value.toLowerCase().trim();
	const name = document.getElementById('gameName').value.trim();
	const shortName = document.getElementById('gameShortName').value.trim();

	// Validate
	if (!gameKey || !name) {
		showAlert('Game key and name are required', 'error');
		return;
	}

	if (!/^[a-z][a-z0-9_]*$/.test(gameKey)) {
		showAlert('Game key must start with a letter and contain only lowercase letters, numbers, and underscores', 'error');
		return;
	}

	// Collect rules
	const rules = [];
	document.querySelectorAll('#rulesContainer > div').forEach(row => {
		const title = row.querySelector('.rule-title').value.trim();
		const description = row.querySelector('.rule-description').value.trim();
		if (title || description) {
			rules.push({ title, description });
		}
	});

	// Collect prizes
	const prizes = [];
	document.querySelectorAll('#prizesContainer > div').forEach(row => {
		const place = parseInt(row.querySelector('.prize-place').value) || 0;
		const position = row.querySelector('.prize-position').value.trim();
		const amount = parseInt(row.querySelector('.prize-amount').value) || 0;
		const extrasStr = row.querySelector('.prize-extras').value.trim();
		const extras = extrasStr ? extrasStr.split(',').map(e => e.trim()).filter(e => e) : [];

		if (place > 0) {
			prizes.push({
				place,
				position: position || `${place}${getOrdinalSuffix(place)} Place`,
				emoji: '',
				amount,
				gradient: PRIZE_GRADIENTS[place] || 'linear-gradient(135deg, #4b5563 0%, #374151 100%)',
				extras
			});
		}
	});

	// Sort prizes by place
	prizes.sort((a, b) => a.place - b.place);

	// Collect additional info
	const additionalInfo = [];
	document.querySelectorAll('#infoContainer > div').forEach(row => {
		const text = row.querySelector('.info-text').value.trim();
		if (text) {
			additionalInfo.push(text);
		}
	});

	// Build game object
	const gameData = {
		name,
		shortName,
		rules,
		prizes,
		additionalInfo
	};

	try {
		const isEdit = !!editKey;
		const url = isEdit ? `/api/games/${encodeURIComponent(editKey)}` : '/api/games';
		const method = isEdit ? 'PUT' : 'POST';

		const body = isEdit ? gameData : { gameKey, ...gameData };

		const response = await csrfFetch(url, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to save game');
		}

		showAlert(`Game ${isEdit ? 'updated' : 'created'} successfully`, 'success');
		closeGameModal();
		loadGames();
	} catch (error) {
		console.error('Error saving game:', error);
		showAlert(error.message, 'error');
	}
}

// Get ordinal suffix (1st, 2nd, 3rd, etc.)
function getOrdinalSuffix(n) {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return s[(v - 20) % 10] || s[v] || s[0];
}

// =====================
// Delete Game
// =====================

function openDeleteModal(gameKey) {
	deleteGameKey = gameKey;
	const game = games[gameKey];
	document.getElementById('deleteGameName').textContent = game?.name || gameKey;
	document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() {
	deleteGameKey = null;
	document.getElementById('deleteModal').classList.add('hidden');
}

async function confirmDelete() {
	if (!deleteGameKey) return;

	try {
		const response = await csrfFetch(`/api/games/${encodeURIComponent(deleteGameKey)}`, {
			method: 'DELETE'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to delete game');
		}

		showAlert('Game deleted successfully', 'success');
		closeDeleteModal();
		loadGames();
	} catch (error) {
		console.error('Error deleting game:', error);
		showAlert(error.message, 'error');
	}
}

// Export functions for global access
window.loadGames = loadGames;
window.openAddGameModal = openAddGameModal;
window.openEditGameModal = openEditGameModal;
window.closeGameModal = closeGameModal;
window.saveGame = saveGame;
window.openDeleteModal = openDeleteModal;
window.closeDeleteModal = closeDeleteModal;
window.confirmDelete = confirmDelete;
window.addRuleRow = addRuleRow;
window.addPrizeRow = addPrizeRow;
window.addInfoRow = addInfoRow;

// Cleanup all intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	if (pollingInterval) clearInterval(pollingInterval);
});
