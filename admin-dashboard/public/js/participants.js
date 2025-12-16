// Global state
let allParticipants = [];
let filteredParticipants = [];
let currentTournament = null;
let selectedTournamentId = null;
let tournaments = [];
let participantsCacheInfo = null;
let participantsRefreshInterval = null;

// Load sort preferences from localStorage or use defaults
const SORT_STORAGE_KEY = 'participants_sort_preferences';
let sortColumn = 'seed';
let sortDirection = 'asc';

// Load saved sort preferences
function loadSortPreferences() {
	try {
		const saved = localStorage.getItem(SORT_STORAGE_KEY);
		if (saved) {
			const prefs = JSON.parse(saved);
			if (prefs.column && ['seed', 'name'].includes(prefs.column)) {
				sortColumn = prefs.column;
			}
			if (prefs.direction && ['asc', 'desc'].includes(prefs.direction)) {
				sortDirection = prefs.direction;
			}
		}
	} catch (e) {
		FrontendDebug.warn('Participants', 'Failed to load sort preferences', e);
	}
}

// Save sort preferences to localStorage
function saveSortPreferences() {
	try {
		localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({
			column: sortColumn,
			direction: sortDirection
		}));
	} catch (e) {
		FrontendDebug.warn('Participants', 'Failed to save sort preferences', e);
	}
}

// Update sort indicators in table headers
function updateSortIndicators() {
	// Remove existing indicators
	document.querySelectorAll('.sort-indicator').forEach(el => el.remove());

	// Find the header for the current sort column
	const headers = document.querySelectorAll('th');
	headers.forEach(th => {
		const text = th.textContent.toLowerCase();
		let column = null;

		if (text.includes('seed')) column = 'seed';
		else if (text.includes('name')) column = 'name';

		if (column === sortColumn) {
			const clickable = th.querySelector('.cursor-pointer') || th;
			if (clickable.classList.contains('cursor-pointer') || th.classList.contains('cursor-pointer')) {
				const indicator = document.createElement('span');
				indicator.className = 'sort-indicator ml-1 text-blue-400';
				indicator.textContent = sortDirection === 'asc' ? ' ▲' : ' ▼';
				clickable.appendChild(indicator);
			}
		}
	});
}

// WebSocket state
let wsConnected = false;

// Initialize page on load
document.addEventListener('DOMContentLoaded', async () => {
	// Load sort preferences first
	loadSortPreferences();

	// Initialize last updated timestamp
	initLastUpdated('participantsLastUpdated', () => loadParticipants(), { prefix: 'Updated', thresholds: { fresh: 30, stale: 120 } });

	// Load tournaments first, then participants
	await loadTournaments();

	// Setup search input listener
	const searchInput = document.getElementById('searchInput');
	searchInput.addEventListener('input', handleSearch);

	// Initialize WebSocket for real-time updates
	initWebSocket();

	// Auto-refresh every 60 seconds (reduced from 30s when WebSocket is available)
	startPolling();
});

// WebSocket initialization
function initWebSocket() {
	if (!WebSocketManager.init()) {
		FrontendDebug.warn('Participants', 'WebSocket not available, using polling');
		return;
	}

	// Subscribe to participant events
	WebSocketManager.subscribeMany({
		'participants:update': handleParticipantUpdate,
		[WS_EVENTS.PARTICIPANT_ADDED]: handleParticipantEvent,
		[WS_EVENTS.PARTICIPANT_UPDATED]: handleParticipantEvent,
		[WS_EVENTS.PARTICIPANT_DELETED]: handleParticipantEvent,
		[WS_EVENTS.PARTICIPANT_CHECKIN]: handleParticipantEvent,
		[WS_EVENTS.PARTICIPANTS_BULK]: handleParticipantEvent,
		[WS_EVENTS.PARTICIPANTS_SEEDED]: handleParticipantEvent
	});

	WebSocketManager.onConnection('connect', () => {
		FrontendDebug.ws('Participants', 'WebSocket connected');
		wsConnected = true;
		// Reduce polling when connected
		stopPolling();
		startPolling(60000); // 60 second backup polling
	});

	WebSocketManager.onConnection('disconnect', () => {
		FrontendDebug.ws('Participants', 'WebSocket disconnected');
		wsConnected = false;
		// Increase polling when disconnected
		stopPolling();
		startPolling(30000); // 30 second polling
	});
}

// Handle participant update event
function handleParticipantUpdate(data) {
	// Only handle events for selected tournament
	if (!selectedTournamentId) return;

	// Tournament ID could be numeric or string
	const eventTournamentId = String(data.tournamentId);
	const currentTournamentId = String(selectedTournamentId);

	if (eventTournamentId !== currentTournamentId) return;

	FrontendDebug.ws('Participants', 'Update received', { action: data.action });
	loadParticipants();
}

// Handle specific participant events
function handleParticipantEvent(data) {
	if (!selectedTournamentId) return;

	const eventTournamentId = String(data.tournamentId);
	const currentTournamentId = String(selectedTournamentId);

	if (eventTournamentId !== currentTournamentId) return;

	FrontendDebug.ws('Participants', 'Event received', data);
	loadParticipants();
}

// Polling functions
function startPolling(interval = 30000) {
	if (participantsRefreshInterval) return;
	participantsRefreshInterval = setInterval(() => {
		if (selectedTournamentId) {
			loadParticipants();
		}
	}, interval);
}

function stopPolling() {
	if (participantsRefreshInterval) {
		clearInterval(participantsRefreshInterval);
		participantsRefreshInterval = null;
	}
}

// Cleanup interval on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	stopPolling();
});

// ============================================
// TOURNAMENT SELECTION
// ============================================

async function loadTournaments() {
	try {
		const response = await fetch('/api/tournaments?days=30');
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
			const inProgress = data.tournaments?.inProgress || [];
			const pending = data.tournaments?.pending || [];
			tournaments = [...inProgress, ...pending];

			updateTournamentSelect();

			if (tournaments.length > 0) {
				// Auto-select active tournament (or fall back to first)
				await selectActiveTournament();
			} else {
				document.getElementById('tournamentSelect').innerHTML = '<option value="">No tournaments available</option>';
				document.getElementById('loadingState').classList.add('hidden');
				document.getElementById('emptyState').classList.remove('hidden');
				document.getElementById('emptyState').innerHTML = `
					<div class="text-gray-400 mb-2">No active tournaments</div>
					<div class="text-sm text-gray-500">Create a tournament first</div>
				`;
			}
		}
	} catch (error) {
		console.error('Failed to load tournaments:', error);
		showAlert('Failed to load tournaments', 'error');
	}
}

// Auto-select the active tournament based on user's active tournament setting
async function selectActiveTournament() {
	const select = document.getElementById('tournamentSelect');
	let selectedId = null;

	try {
		const response = await fetch('/api/tournament/active');
		if (response.ok) {
			const data = await response.json();
			if (data.success && data.tournament) {
				// API returns tournamentId (url_slug) and id (numeric)
				const slugId = data.tournament.tournamentId;
				const numericId = data.tournament.id;

				// Check if active tournament is in our dropdown (match by slug or numeric id)
				const option = Array.from(select.options).find(opt =>
					opt.value === String(slugId) || opt.value === String(numericId)
				);

				if (option) {
					selectedId = option.value;
					FrontendDebug.log('Participants', 'Auto-selected active tournament', {
						tournament: data.tournament.name,
						mode: data.mode
					});
				}
			}
		}
	} catch (error) {
		FrontendDebug.warn('Participants', 'Could not fetch active tournament', error);
	}

	// Fall back to first tournament if no active tournament found
	if (!selectedId && tournaments.length > 0) {
		selectedId = tournaments[0].tournamentId;
		FrontendDebug.log('Participants', 'No active tournament, selecting first', { tournament: tournaments[0].name });
	}

	if (selectedId) {
		selectedTournamentId = selectedId;
		select.value = selectedId;
		onTournamentChange();
	}
}

function updateTournamentSelect() {
	const select = document.getElementById('tournamentSelect');

	if (tournaments.length === 0) {
		select.innerHTML = '<option value="">No tournaments available</option>';
		return;
	}

	select.innerHTML = tournaments.map(t => {
		const stateLabel = t.state === 'underway' ? '(In Progress)' : '(Pending)';
		return `<option value="${t.tournamentId}">${escapeHtml(t.name)} ${stateLabel}</option>`;
	}).join('');
}

function onTournamentChange() {
	const select = document.getElementById('tournamentSelect');
	selectedTournamentId = select.value;

	if (!selectedTournamentId) {
		document.getElementById('tournamentInfo').classList.add('hidden');
		document.getElementById('participantCount').textContent = '--';
		document.getElementById('loadingState').classList.add('hidden');
		document.getElementById('tableContainer').classList.add('hidden');
		document.getElementById('emptyState').classList.remove('hidden');
		updateActionButtonStates(null);
		return;
	}

	// Find tournament details
	const tournament = tournaments.find(t => t.tournamentId === selectedTournamentId);
	if (tournament) {
		currentTournament = tournament;
		document.getElementById('tournamentInfo').classList.remove('hidden');
		document.getElementById('tournamentGame').textContent = tournament.game || '--';
		updateActionButtonStates(tournament);
	}

	// Load participants for selected tournament
	document.getElementById('loadingState').classList.remove('hidden');
	document.getElementById('tableContainer').classList.add('hidden');
	document.getElementById('emptyState').classList.add('hidden');
	loadParticipants();
}

// ============================================
// ACTION BUTTON STATE MANAGEMENT
// ============================================

// Update action button states based on tournament state
// Buttons should be disabled when tournament is in progress (underway)
function updateActionButtonStates(tournament) {
	const isInProgress = tournament && tournament.state === 'underway';

	const randomizeSeedsBtn = document.getElementById('randomizeSeedsBtn');
	const addParticipantBtn = document.getElementById('addParticipantBtn');
	const bulkAddBtn = document.getElementById('bulkAddBtn');
	const clearAllBtn = document.getElementById('clearAllBtn');

	if (randomizeSeedsBtn) {
		randomizeSeedsBtn.disabled = isInProgress;
		randomizeSeedsBtn.title = isInProgress
			? 'Cannot randomize seeds while tournament is in progress'
			: 'Randomly shuffle all participant seeds';
	}

	if (addParticipantBtn) {
		addParticipantBtn.disabled = isInProgress;
		addParticipantBtn.title = isInProgress
			? 'Cannot add participants while tournament is in progress'
			: 'Add a new participant';
	}

	if (bulkAddBtn) {
		bulkAddBtn.disabled = isInProgress;
		bulkAddBtn.title = isInProgress
			? 'Cannot add participants while tournament is in progress'
			: 'Add multiple participants at once';
	}

	if (clearAllBtn) {
		clearAllBtn.disabled = isInProgress;
		clearAllBtn.title = isInProgress
			? 'Cannot clear participants while tournament is in progress'
			: 'Delete all participants (only before tournament starts)';
	}
}

// ============================================
// LOAD PARTICIPANTS
// ============================================

async function loadParticipants() {
	if (!selectedTournamentId) {
		document.getElementById('loadingState').classList.add('hidden');
		document.getElementById('emptyState').classList.remove('hidden');
		return;
	}

	try {
		const response = await fetch(`/api/participants/${selectedTournamentId}`);
		const data = await response.json();

		if (data.success) {
			allParticipants = data.participants || [];
			filteredParticipants = [...allParticipants];
			participantsCacheInfo = data._cache || null;

			// Update participant count
			document.getElementById('participantCount').textContent = allParticipants.length;

			// Apply current search filter
			if (document.getElementById('searchInput').value) {
				handleSearch();
			} else {
				renderParticipantsTable();
			}

			// Hide loading, show table or empty state
			document.getElementById('loadingState').classList.add('hidden');
			if (allParticipants.length === 0) {
				document.getElementById('emptyState').classList.remove('hidden');
				document.getElementById('emptyState').innerHTML = `
					<div class="text-gray-400 mb-2">No participants found</div>
					<div class="text-sm text-gray-500">Add participants using the button above</div>
				`;
				document.getElementById('tableContainer').classList.add('hidden');
			} else {
				document.getElementById('emptyState').classList.add('hidden');
				document.getElementById('tableContainer').classList.remove('hidden');
			}
			// Update last refreshed timestamp
			setLastUpdated('participantsLastUpdated');
			// Update cache indicator
			updateParticipantsCacheIndicator();
		} else {
			showAlert(data.error || 'Failed to load participants', 'error');
			document.getElementById('loadingState').classList.add('hidden');
			document.getElementById('emptyState').classList.remove('hidden');
		}
	} catch (error) {
		console.error('Failed to load participants:', error);
		showAlert('Failed to load participants', 'error');
		document.getElementById('loadingState').classList.add('hidden');
	}
}

async function refreshParticipants() {
	// Show loading state
	const btn = document.getElementById('refreshParticipantsBtn');
	const icon = document.getElementById('refreshParticipantsIcon');
	const text = document.getElementById('refreshParticipantsText');
	if (btn) btn.disabled = true;
	if (icon) icon.classList.add('animate-spin');
	if (text) text.textContent = 'Refreshing...';

	document.getElementById('loadingState').classList.remove('hidden');
	document.getElementById('tableContainer').classList.add('hidden');

	try {
		await loadParticipants();
	} finally {
		// Reset loading state
		if (btn) btn.disabled = false;
		if (icon) icon.classList.remove('animate-spin');
		if (text) text.textContent = 'Refresh';
	}
}

// Update cache indicator display
function updateParticipantsCacheIndicator() {
	const container = document.getElementById('participantsCacheIndicator');
	if (!container) return;

	if (participantsCacheInfo) {
		container.innerHTML = renderCacheIndicator(participantsCacheInfo);
		container.classList.remove('hidden');
	} else {
		container.classList.add('hidden');
	}
}

// ============================================
// RENDER TABLE
// ============================================

function renderParticipantsTable() {
	const tbody = document.getElementById('participantsTableBody');
	tbody.innerHTML = '';

	// Initialize drag & drop if SortableJS is available
	if (typeof Sortable !== 'undefined' && !tbody.sortableInstance) {
		tbody.sortableInstance = Sortable.create(tbody, {
			animation: 150,
			handle: '.drag-handle', // Only allow dragging from specific element
			ghostClass: 'sortable-ghost',
			dragClass: 'sortable-drag',
			onEnd: handleDragEnd
		});
	}

	// Sort participants
	const sorted = [...filteredParticipants].sort((a, b) => {
		let aVal = a[sortColumn];
		let bVal = b[sortColumn];

		// Handle null/undefined values
		if (aVal === null || aVal === undefined) aVal = '';
		if (bVal === null || bVal === undefined) bVal = '';

		// Convert to lowercase for string comparison
		if (typeof aVal === 'string') aVal = aVal.toLowerCase();
		if (typeof bVal === 'string') bVal = bVal.toLowerCase();

		if (sortDirection === 'asc') {
			return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
		} else {
			return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
		}
	});

	sorted.forEach(participant => {
		const row = document.createElement('tr');
		row.className = 'hover:bg-gray-750 transition cursor-move';
		row.setAttribute('data-id', participant.id);

		// Extract Instagram from misc for display
		let instagramDisplay = participant.instagram || '';
		let miscDisplay = participant.misc || '';

		// Remove Instagram line from misc for cleaner display
		if (miscDisplay) {
			miscDisplay = miscDisplay.replace(/Instagram:\s*@?[a-zA-Z0-9._]+\n?/gi, '').trim();
		}

		// Build status badges
		let statusBadges = [];
		if (participant.checkedIn) {
			statusBadges.push('<span class="bg-green-600 text-white text-xs px-2 py-0.5 rounded">Checked In</span>');
		}
		if (participant.active === false) {
			statusBadges.push('<span class="bg-red-600 text-white text-xs px-2 py-0.5 rounded">Inactive</span>');
		}
		if (participant.onWaitingList) {
			statusBadges.push('<span class="bg-yellow-600 text-white text-xs px-2 py-0.5 rounded">Waiting List</span>');
		}
		if (participant.invitationPending) {
			statusBadges.push('<span class="bg-blue-600 text-white text-xs px-2 py-0.5 rounded">Invite Pending</span>');
		}
		if (statusBadges.length === 0) {
			statusBadges.push('<span class="text-gray-500 text-xs">Active</span>');
		}

		// Build contact info
		let contactItems = [];
		if (instagramDisplay) {
			contactItems.push(`<a href="https://instagram.com/${instagramDisplay}" target="_blank" class="text-purple-400 hover:text-purple-300 text-xs flex items-center gap-1">@${escapeHtml(instagramDisplay)}</a>`);
		}
		if (participant.email) {
			contactItems.push(`<span class="text-gray-400 text-xs">${escapeHtml(participant.email)}</span>`);
		}

		row.innerHTML = `
			<td class="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-sm text-gray-300">
				<div class="flex items-center gap-2 sm:gap-3">
					<span class="drag-handle cursor-grab active:cursor-grabbing text-gray-500 hover:text-white touch-target" title="Drag to reorder">
						⠿
					</span>
					<span
						class="bg-gray-700 px-2 sm:px-3 py-1 rounded cursor-pointer hover:bg-gray-600 transition touch-target"
						onclick="editSeedInline(${participant.id}, ${participant.seed || 0})"
						title="Click to edit seed"
					>
						${participant.seed || '-'}
					</span>
				</div>
			</td>
			<td class="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
				<div class="text-sm font-medium text-white">${escapeHtml(participant.name)}</div>
				${instagramDisplay ? `<div class="text-xs text-purple-400 sm:hidden">@${escapeHtml(instagramDisplay)}</div>` : ''}
			</td>
			<td class="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
				<div class="flex flex-wrap gap-1">
					${statusBadges.join('')}
				</div>
				${participant.canCheckIn ? `
					<button onclick="checkInParticipant(${participant.id}, '${escapeHtml(participant.name)}')" class="text-green-400 hover:text-green-300 text-xs mt-1 touch-target">Check In</button>
				` : ''}
				${participant.checkedIn ? `
					<button onclick="undoCheckInParticipant(${participant.id}, '${escapeHtml(participant.name)}')" class="text-yellow-400 hover:text-yellow-300 text-xs mt-1 touch-target">Undo</button>
				` : ''}
			</td>
			<td class="px-4 sm:px-6 py-3 sm:py-4 hide-on-mobile">
				<div class="flex flex-col gap-1">
					${contactItems.length > 0 ? contactItems.join('') : '<span class="text-gray-500 text-xs">-</span>'}
				</div>
			</td>
			<td class="px-4 sm:px-6 py-3 sm:py-4 text-sm text-gray-400 max-w-xs truncate hide-on-mobile">
				${miscDisplay ? escapeHtml(miscDisplay) : '-'}
			</td>
			<td class="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-right text-sm font-medium">
				<div class="flex gap-2 justify-end">
					<button
						onclick="openEditParticipantModal(${participant.id})"
						class="text-blue-400 hover:text-blue-300 touch-target px-2 py-1"
						title="Edit participant"
					>
						Edit
					</button>
					<button
						onclick="confirmDeleteParticipant(${participant.id}, '${escapeHtml(participant.name)}')"
						class="text-red-400 hover:text-red-300 touch-target px-2 py-1"
						title="Delete participant"
					>
						Del
					</button>
				</div>
			</td>
		`;

		tbody.appendChild(row);
	});

	// Update sort indicators after rendering
	updateSortIndicators();
}

// ============================================
// SEARCH & FILTER
// ============================================

function handleSearch() {
	const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();

	if (!searchTerm) {
		filteredParticipants = [...allParticipants];
	} else {
		filteredParticipants = allParticipants.filter(participant => {
			const nameMatch = participant.name.toLowerCase().includes(searchTerm);
			const instagramMatch = participant.instagram && participant.instagram.toLowerCase().includes(searchTerm);
			const miscMatch = participant.misc && participant.misc.toLowerCase().includes(searchTerm);

			return nameMatch || instagramMatch || miscMatch;
		});
	}

	renderParticipantsTable();

	// Show/hide empty state
	if (filteredParticipants.length === 0) {
		document.getElementById('tableContainer').classList.add('hidden');
		document.getElementById('emptyState').classList.remove('hidden');
		document.getElementById('emptyState').innerHTML = `
			<div class="text-gray-400 mb-2">No participants found matching "${escapeHtml(searchTerm)}"</div>
			<div class="text-sm text-gray-500">Try a different search term</div>
		`;
	} else {
		document.getElementById('tableContainer').classList.remove('hidden');
		document.getElementById('emptyState').classList.add('hidden');
	}
}

// ============================================
// SORT TABLE
// ============================================

function sortTable(column) {
	if (sortColumn === column) {
		// Toggle direction
		sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
	} else {
		sortColumn = column;
		sortDirection = 'asc';
	}

	// Save preferences to localStorage
	saveSortPreferences();

	renderParticipantsTable();
}

// ============================================
// ADD PARTICIPANT
// ============================================

function openAddParticipantModal() {
	// Block if tournament is in progress
	if (currentTournament && currentTournament.state === 'underway') {
		showAlert('Cannot add participants while tournament is in progress', 'error');
		return;
	}

	document.getElementById('addParticipantModal').classList.remove('hidden');
	document.getElementById('addParticipantModal').classList.add('flex');
	document.getElementById('newParticipantName').value = '';
	document.getElementById('newParticipantEmail').value = '';
	document.getElementById('newParticipantInstagram').value = '';
	document.getElementById('newParticipantSeed').value = '';
	document.getElementById('newParticipantName').focus();
}

function closeAddParticipantModal() {
	document.getElementById('addParticipantModal').classList.add('hidden');
	document.getElementById('addParticipantModal').classList.remove('flex');
}

async function addParticipant(event) {
	event.preventDefault();

	if (!selectedTournamentId) {
		showAlert('Please select a tournament first', 'error');
		return;
	}

	const participantName = document.getElementById('newParticipantName').value.trim();
	const email = document.getElementById('newParticipantEmail').value.trim();
	let instagram = document.getElementById('newParticipantInstagram').value.trim();
	const seedValue = document.getElementById('newParticipantSeed').value;
	const seed = seedValue ? parseInt(seedValue) : null;

	if (!participantName) {
		showAlert('Participant name is required', 'error');
		return;
	}

	// Remove @ if user typed it
	if (instagram && instagram.startsWith('@')) {
		instagram = instagram.substring(1);
	}

	try {
		const response = await csrfFetch(`/api/participants/${selectedTournamentId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				participantName,
				email,
				instagram,
				seed
			})
		});

		const data = await response.json();

		if (data.success) {
			showToast(`Participant "${participantName}" added successfully!`, 'success');
			closeAddParticipantModal();
			loadParticipants();
		} else {
			showAlert(data.error || 'Failed to add participant', 'error');
		}
	} catch (error) {
		console.error('Add participant error:', error);
		showAlert('Failed to add participant', 'error');
	}
}

// ============================================
// EDIT PARTICIPANT
// ============================================

function openEditParticipantModal(participantId) {
	const participant = allParticipants.find(p => p.id === participantId);
	if (!participant) {
		showAlert('Participant not found', 'error');
		return;
	}

	document.getElementById('editParticipantId').value = participant.id;
	document.getElementById('editParticipantName').value = participant.name;
	document.getElementById('editParticipantSeed').value = participant.seed || '';
	document.getElementById('editParticipantEmail').value = participant.email || '';
	document.getElementById('editParticipantInstagram').value = participant.instagram || '';

	// Extract misc without Instagram line
	let miscWithoutInstagram = participant.misc || '';
	miscWithoutInstagram = miscWithoutInstagram.replace(/Instagram:\s*@?[a-zA-Z0-9._]+\n?/gi, '').trim();
	document.getElementById('editParticipantMisc').value = miscWithoutInstagram;

	document.getElementById('editParticipantModal').classList.remove('hidden');
	document.getElementById('editParticipantModal').classList.add('flex');
	document.getElementById('editParticipantName').focus();
}

function closeEditParticipantModal() {
	document.getElementById('editParticipantModal').classList.add('hidden');
	document.getElementById('editParticipantModal').classList.remove('flex');
}

async function saveParticipantEdit(event) {
	event.preventDefault();

	if (!selectedTournamentId) {
		showAlert('Please select a tournament first', 'error');
		return;
	}

	const participantId = document.getElementById('editParticipantId').value;
	const participantName = document.getElementById('editParticipantName').value.trim();
	const seedValue = document.getElementById('editParticipantSeed').value;
	const seed = seedValue ? parseInt(seedValue) : null;
	const email = document.getElementById('editParticipantEmail').value.trim();
	let instagram = document.getElementById('editParticipantInstagram').value.trim();
	const misc = document.getElementById('editParticipantMisc').value.trim();

	if (!participantName) {
		showAlert('Participant name is required', 'error');
		return;
	}

	// Remove @ if user typed it
	if (instagram && instagram.startsWith('@')) {
		instagram = instagram.substring(1);
	}

	try {
		const response = await csrfFetch(`/api/participants/${selectedTournamentId}/${participantId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				participantName,
				seed,
				email,
				instagram,
				misc
			})
		});

		const data = await response.json();

		if (data.success) {
			showToast(`Participant "${participantName}" updated successfully!`, 'success');
			closeEditParticipantModal();
			loadParticipants();
		} else {
			showAlert(data.error || 'Failed to update participant', 'error');
		}
	} catch (error) {
		console.error('Update participant error:', error);
		showAlert('Failed to update participant', 'error');
	}
}

// ============================================
// DELETE PARTICIPANT
// ============================================

async function confirmDeleteParticipant(participantId, participantName) {
	const confirmed = await showConfirmModal(
		`Are you sure you want to delete "${participantName}"?\n\nThis action cannot be undone.`,
		{
			title: 'Delete Participant',
			confirmText: 'Delete',
			dangerous: true
		}
	);
	if (confirmed) {
		deleteParticipant(participantId, participantName);
	}
}

async function deleteParticipant(participantId, participantName) {
	if (!selectedTournamentId) {
		showAlert('Please select a tournament first', 'error');
		return;
	}

	try {
		const response = await csrfFetch(`/api/participants/${selectedTournamentId}/${participantId}`, {
			method: 'DELETE'
		});

		const data = await response.json();

		if (data.success) {
			showToast(`Participant "${participantName}" deleted successfully`, 'success');
			loadParticipants();
		} else {
			showAlert(data.error || 'Failed to delete participant', 'error');
		}
	} catch (error) {
		console.error('Delete participant error:', error);
		showAlert('Failed to delete participant', 'error');
	}
}

// ============================================
// EXPORT TO CSV
// ============================================

function exportToCSV() {
	if (allParticipants.length === 0) {
		showAlert('No participants to export', 'warning');
		return;
	}

	// Build CSV content
	const headers = ['Seed', 'Name', 'Instagram', 'Misc'];
	const rows = allParticipants.map(p => {
		// Extract misc without Instagram line for CSV
		let miscWithoutInstagram = p.misc || '';
		miscWithoutInstagram = miscWithoutInstagram.replace(/Instagram:\s*@?[a-zA-Z0-9._]+\n?/gi, '').trim();

		return [
			p.seed || '',
			`"${(p.name || '').replace(/"/g, '""')}"`, // Escape quotes
			p.instagram ? `@${p.instagram}` : '',
			`"${miscWithoutInstagram.replace(/"/g, '""')}"`
		].join(',');
	});

	const csv = [headers.join(','), ...rows].join('\n');

	// Create download link
	const blob = new Blob([csv], { type: 'text/csv' });
	const url = window.URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;

	// Filename with tournament name and timestamp
	const tournamentName = (currentTournament?.name || 'tournament').replace(/[^a-z0-9]/gi, '_');
	const timestamp = new Date().toISOString().split('T')[0];
	a.download = `${tournamentName}_participants_${timestamp}.csv`;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	window.URL.revokeObjectURL(url);

	showToast('Participant list exported to CSV', 'success');
}

// ============================================
// NOTIFICATIONS
// ============================================

// Note: showAlert and escapeHtml are now in utils.js

function showToast(message, type = 'info') {
	const toastContainer = document.getElementById('toastContainer');

	const bgColors = {
		success: 'bg-green-600',
		error: 'bg-red-600',
		info: 'bg-blue-600'
	};

	const toast = document.createElement('div');
	toast.className = `${bgColors[type]} text-white px-6 py-3 rounded-lg shadow-lg toast-slide-down`;
	toast.textContent = message;

	toastContainer.appendChild(toast);

	// Trigger exit animation and remove
	setTimeout(() => {
		toast.classList.add('toast-exit');
		setTimeout(() => toast.remove(), 500);
	}, 3000);
}

// ============================================
// SEED MANAGEMENT
// ============================================

// Randomize all participant seeds
async function randomizeSeeds() {
	if (!selectedTournamentId) {
		showAlert('Please select a tournament first', 'error');
		return;
	}

	// Block if tournament is in progress
	if (currentTournament && currentTournament.state === 'underway') {
		showAlert('Cannot randomize seeds while tournament is in progress', 'error');
		return;
	}

	if (allParticipants.length === 0) {
		showAlert('No participants to randomize', 'warning');
		return;
	}

	const confirmed = await showConfirmModal(
		`Randomize seeds for all ${allParticipants.length} participants?\n\nThis will shuffle the bracket randomly.`,
		{
			title: 'Randomize Seeds',
			confirmText: 'Randomize',
			confirmClass: 'bg-orange-600 hover:bg-orange-700',
			dangerous: false
		}
	);
	if (!confirmed) {
		return;
	}

	try {
		showToast('Randomizing seeds...', 'info');

		// Randomize seeds via API
		const response = await csrfFetch(`/api/participants/${selectedTournamentId}/randomize`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showToast(`Successfully randomized ${allParticipants.length} participants!`, 'success');
			loadParticipants();
		} else {
			showAlert(data.error || 'Failed to randomize seeds', 'error');
		}
	} catch (error) {
		console.error('Randomize seeds error:', error);
		showAlert('Failed to randomize seeds', 'error');
	}
}

// Handle drag & drop end event
async function handleDragEnd(evt) {
	const oldIndex = evt.oldIndex;
	const newIndex = evt.newIndex;

	if (oldIndex === newIndex) {
		return; // No change
	}

	// Get current order from DOM
	const tbody = document.getElementById('participantsTableBody');
	const rows = Array.from(tbody.querySelectorAll('tr'));

	// Build updates array based on new row order
	const updates = rows.map((row, index) => {
		const participantId = parseInt(row.getAttribute('data-id'));
		const participant = allParticipants.find(p => p.id === participantId);

		return {
			id: participantId,
			name: participant ? participant.name : 'Unknown',
			newSeed: index + 1
		};
	});

	try {
		showToast('Updating seeds...', 'info');

		// Update all seeds via API
		await updateMultipleSeeds(updates);

		showToast('Seeds updated successfully!', 'success');
		loadParticipants();
	} catch (error) {
		console.error('Drag & drop update error:', error);
		showAlert('Failed to update seeds', 'error');
		// Reload to revert
		loadParticipants();
	}
}

// Edit seed inline (click to edit)
function editSeedInline(participantId, currentSeed) {
	const participant = allParticipants.find(p => p.id === participantId);
	if (!participant) {
		showAlert('Participant not found', 'error');
		return;
	}

	const newSeed = prompt(`Enter new seed for "${participant.name}":\n\nCurrent seed: ${currentSeed || 'None'}`, currentSeed || '');

	if (newSeed === null) {
		return; // Cancelled
	}

	const seedNumber = parseInt(newSeed);

	if (isNaN(seedNumber) || seedNumber < 1) {
		showAlert('Seed must be a positive number', 'error');
		return;
	}

	// Update seed
	updateSingleSeed(participantId, participant.name, seedNumber);
}

// Update a single participant's seed
async function updateSingleSeed(participantId, participantName, newSeed) {
	if (!selectedTournamentId) {
		showAlert('Please select a tournament first', 'error');
		return;
	}

	try {
		// Find the participant to get their current data
		const participant = allParticipants.find(p => p.id === participantId);
		if (!participant) {
			showAlert('Participant not found', 'error');
			return;
		}

		const response = await csrfFetch(`/api/participants/${selectedTournamentId}/${participantId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				participantName: participant.name,
				instagram: participant.instagram || '',
				misc: participant.misc || '',
				seed: newSeed
			})
		});

		const data = await response.json();

		if (data.success) {
			showToast(`Seed updated to ${newSeed} for "${participantName}"`, 'success');
			loadParticipants();
		} else {
			showAlert(data.error || 'Failed to update seed', 'error');
		}
	} catch (error) {
		console.error('Update seed error:', error);
		showAlert('Failed to update seed', 'error');
	}
}

// Update multiple participants' seeds (for randomize and drag & drop)
async function updateMultipleSeeds(updates) {
	if (!selectedTournamentId) {
		throw new Error('No tournament selected');
	}

	// Send all updates in parallel for speed
	const promises = updates.map(update => {
		// Find the participant to get their current data
		const participant = allParticipants.find(p => p.id === update.id);
		if (!participant) {
			return Promise.reject(new Error(`Participant ${update.id} not found`));
		}

		return csrfFetch(`/api/participants/${selectedTournamentId}/${update.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				participantName: participant.name,
				instagram: participant.instagram || '',
				misc: participant.misc || '',
				seed: update.newSeed
			})
		});
	});

	const responses = await Promise.all(promises);

	// Check if any failed
	const failed = responses.filter(r => !r.ok);
	if (failed.length > 0) {
		throw new Error(`${failed.length} seed updates failed`);
	}

	return responses;
}

// ============================================
// BULK ADD FUNCTIONS
// ============================================

// Open bulk add modal
function openBulkAddModal() {
	document.getElementById('bulkAddModal').classList.remove('hidden');
	document.getElementById('bulkAddModal').classList.add('flex');
	document.getElementById('bulkAddTextarea').value = '';
	updateBulkAddCount();
	document.getElementById('bulkAddTextarea').focus();
}

// Close bulk add modal
function closeBulkAddModal() {
	document.getElementById('bulkAddModal').classList.add('hidden');
	document.getElementById('bulkAddModal').classList.remove('flex');
}

// Clear bulk add textarea
function clearBulkAddTextarea() {
	document.getElementById('bulkAddTextarea').value = '';
	updateBulkAddCount();
}

// Update participant count from textarea
function updateBulkAddCount() {
	const textarea = document.getElementById('bulkAddTextarea');
	const format = document.getElementById('bulkAddFormat').value;
	const participants = parseBulkAddParticipants(textarea.value, format);
	const count = participants.length;

	document.getElementById('bulkAddCount').textContent = count;

	// Enable/disable submit button
	const submitBtn = document.getElementById('bulkAddSubmitBtn');
	submitBtn.disabled = count === 0;
}

// Parse participants from textarea based on format
function parseBulkAddParticipants(text, format) {
	const lines = text
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0);

	if (format === 'csv') {
		return lines.map(line => {
			const parts = line.split(',').map(p => p.trim());
			return {
				name: parts[0] || '',
				email: parts[1] || '',
				seed: parts[2] ? parseInt(parts[2]) : null,
				misc: parts[3] || ''
			};
		}).filter(p => p.name.length > 0);
	} else {
		// Names only format
		return lines.map(name => ({ name }));
	}
}

// Parse names from textarea (one per line, filter empty) - legacy function for compatibility
function parseBulkAddNames(text) {
	return text
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0);
}

// Submit bulk add
async function submitBulkAdd() {
	if (!selectedTournamentId) {
		showAlert('Please select a tournament first', 'error');
		return;
	}

	const textarea = document.getElementById('bulkAddTextarea');
	const format = document.getElementById('bulkAddFormat').value;
	const participants = parseBulkAddParticipants(textarea.value, format);

	if (participants.length === 0) {
		showAlert('No participants to add', 'warning');
		return;
	}

	const displayNames = participants.slice(0, 5).map(p => p.name).join(', ');
	const confirmed = await showConfirmModal(
		`Add ${participants.length} participants?\n\n${displayNames}${participants.length > 5 ? '...' : ''}`,
		{
			title: 'Bulk Add Participants',
			confirmText: 'Add All',
			confirmClass: 'bg-purple-600 hover:bg-purple-700',
			dangerous: false
		}
	);
	if (!confirmed) {
		return;
	}

	try {
		showToast('Adding participants...', 'info');

		const response = await csrfFetch(`/api/participants/${selectedTournamentId}/bulk`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ participants })
		});

		const data = await response.json();

		if (data.success) {
			showToast(`Successfully added ${data.count} participants!`, 'success');
			closeBulkAddModal();
			loadParticipants();
		} else {
			showAlert(data.error || 'Failed to add participants', 'error');
		}
	} catch (error) {
		console.error('Bulk add error:', error);
		showAlert('Failed to add participants', 'error');
	}
}

// ============================================
// CHECK-IN FUNCTIONS
// ============================================

// Check in a participant
async function checkInParticipant(participantId, participantName) {
	if (!selectedTournamentId) {
		showAlert('Please select a tournament first', 'error');
		return;
	}

	try {
		const response = await csrfFetch(`/api/participants/${selectedTournamentId}/${participantId}/check-in`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showToast(`"${participantName}" checked in successfully!`, 'success');
			loadParticipants();
		} else {
			showAlert(data.error || 'Failed to check in participant', 'error');
		}
	} catch (error) {
		console.error('Check in participant error:', error);
		showAlert('Failed to check in participant', 'error');
	}
}

// Undo check-in for a participant
async function undoCheckInParticipant(participantId, participantName) {
	if (!selectedTournamentId) {
		showAlert('Please select a tournament first', 'error');
		return;
	}

	try {
		const response = await csrfFetch(`/api/participants/${selectedTournamentId}/${participantId}/undo-check-in`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showToast(`Check-in undone for "${participantName}"`, 'success');
			loadParticipants();
		} else {
			showAlert(data.error || 'Failed to undo check-in', 'error');
		}
	} catch (error) {
		console.error('Undo check in error:', error);
		showAlert('Failed to undo check-in', 'error');
	}
}

// ============================================
// CLEAR ALL PARTICIPANTS
// ============================================

async function confirmClearAllParticipants() {
	if (!selectedTournamentId) {
		showAlert('Please select a tournament first', 'error');
		return;
	}

	if (allParticipants.length === 0) {
		showAlert('No participants to clear', 'warning');
		return;
	}

	// First confirmation
	const firstConfirm = await showConfirmModal(
		`WARNING: This will delete ALL ${allParticipants.length} participants from this tournament!\n\nThis action cannot be undone and is only allowed before the tournament starts.`,
		{
			title: 'Clear All Participants',
			confirmText: 'Yes, Delete All',
			dangerous: true
		}
	);
	if (!firstConfirm) {
		return;
	}

	// Double confirm for safety
	const secondConfirm = await showConfirmModal(
		`Please confirm again: Delete all ${allParticipants.length} participants?`,
		{
			title: 'Final Confirmation',
			confirmText: 'Delete All',
			dangerous: true
		}
	);
	if (!secondConfirm) {
		return;
	}

	clearAllParticipants();
}

async function clearAllParticipants() {
	try {
		showToast('Clearing all participants...', 'info');

		const response = await csrfFetch(`/api/participants/${selectedTournamentId}/clear`, {
			method: 'DELETE'
		});

		const data = await response.json();

		if (data.success) {
			showToast('All participants cleared successfully!', 'success');
			loadParticipants();
		} else {
			showAlert(data.error || 'Failed to clear participants', 'error');
		}
	} catch (error) {
		console.error('Clear all participants error:', error);
		showAlert('Failed to clear participants', 'error');
	}
}

// ============================================
// BULK ADD FORMAT HELPERS
// ============================================

// Update placeholder based on selected format
function updateBulkAddPlaceholder() {
	const format = document.getElementById('bulkAddFormat').value;
	const textarea = document.getElementById('bulkAddTextarea');
	const instructions = document.getElementById('bulkAddInstructions');

	if (format === 'csv') {
		textarea.placeholder = 'John Smith, john@email.com, 1, Notes here\nJane Doe, jane@email.com, 2,\nPlayer3,,,';
		instructions.textContent = 'CSV format: name, email, seed, misc (all fields except name are optional)';
	} else {
		textarea.placeholder = 'John Smith\nJane Doe\nPlayer3\n...';
		instructions.textContent = 'Enter one participant name per line. Empty lines will be ignored.';
	}

	updateBulkAddCount();
}

// Note: Utility functions (escapeHtml, showAlert, etc.) are in utils.js
