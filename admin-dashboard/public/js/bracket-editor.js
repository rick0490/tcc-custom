/**
 * Bracket Editor Page Controller
 * Manages tournament selection, participant seeding, and bracket preview
 */
const BracketEditor = (function() {
	'use strict';

	// State
	let state = {
		tournaments: [],
		selectedTournament: null,
		participants: [],
		originalSeeds: new Map(),  // participant.id -> original seed
		currentSeeds: new Map(),   // participant.id -> current seed
		hasChanges: false,
		sortableInstance: null,
		isLoading: false
	};

	// DOM Elements
	const elements = {};

	/**
	 * Initialize the bracket editor
	 */
	function init() {
		FrontendDebug.log('BracketEditor', 'Initializing');
		cacheElements();
		bindEvents();
		loadTournaments();
		initWebSocket();
	}

	/**
	 * Cache DOM element references
	 */
	function cacheElements() {
		elements.tournamentSelect = document.getElementById('tournamentSelect');
		elements.pendingChanges = document.getElementById('pendingChanges');
		elements.bracketContainer = document.getElementById('bracketContainer');
		elements.bracketCanvas = document.getElementById('bracketCanvas');
		elements.emptyState = document.getElementById('emptyState');
		elements.formatBadge = document.getElementById('formatBadge');
		elements.zoomLevel = document.getElementById('zoomLevel');
		elements.seedingTools = document.getElementById('seedingTools');
		elements.participantList = document.getElementById('participantList');
		elements.participantCount = document.getElementById('participantCount');
		elements.participantSearch = document.getElementById('participantSearch');
		elements.participantEmptyState = document.getElementById('participantEmptyState');
		elements.participantPanel = document.getElementById('participantPanel');
		elements.actionButtons = document.getElementById('actionButtons');
		elements.applyBtn = document.getElementById('applyBtn');
		elements.discardBtn = document.getElementById('discardBtn');
	}

	/**
	 * Bind event listeners
	 */
	function bindEvents() {
		if (elements.tournamentSelect) {
			elements.tournamentSelect.addEventListener('change', handleTournamentChange);
		}
		if (elements.participantSearch) {
			elements.participantSearch.addEventListener('input', handleSearch);
		}

		// Warn before leaving with unsaved changes
		window.addEventListener('beforeunload', (e) => {
			if (state.hasChanges) {
				e.preventDefault();
				e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
			}
		});
	}

	/**
	 * Initialize WebSocket for real-time updates
	 */
	function initWebSocket() {
		if (typeof WebSocketManager === 'undefined') {
			FrontendDebug.warn('BracketEditor', 'WebSocketManager not available');
			return;
		}

		if (!WebSocketManager.init()) {
			FrontendDebug.warn('BracketEditor', 'WebSocket not initialized');
			return;
		}

		WebSocketManager.subscribeMany({
			[WS_EVENTS.TOURNAMENT_UPDATED]: handleTournamentUpdate,
			[WS_EVENTS.TOURNAMENT_STARTED]: handleTournamentStarted,
			[WS_EVENTS.PARTICIPANT_ADDED]: handleParticipantChange,
			[WS_EVENTS.PARTICIPANT_UPDATED]: handleParticipantChange,
			[WS_EVENTS.PARTICIPANT_DELETED]: handleParticipantChange
		});

		FrontendDebug.log('BracketEditor', 'WebSocket initialized');
	}

	/**
	 * Load pending tournaments from API
	 */
	async function loadTournaments() {
		try {
			FrontendDebug.api('BracketEditor', 'Loading tournaments');
			const response = await csrfFetch('/api/tournaments?state=pending');
			if (!response.ok) throw new Error('Failed to load tournaments');

			const data = await response.json();
			state.tournaments = data.tournaments || [];

			renderTournamentOptions();
			FrontendDebug.log('BracketEditor', 'Tournaments loaded', { count: state.tournaments.length });
		} catch (error) {
			FrontendDebug.error('BracketEditor', 'Error loading tournaments', error);
			showAlert('Failed to load tournaments', 'error');
		}
	}

	/**
	 * Render tournament dropdown options
	 */
	function renderTournamentOptions() {
		const options = ['<option value="">Select a tournament...</option>'];

		state.tournaments.forEach(t => {
			const participantCount = t.participant_count || 0;
			const format = formatTournamentType(t.tournament_type);
			options.push(`<option value="${t.id}">${escapeHtml(t.name)} (${participantCount} players, ${format})</option>`);
		});

		elements.tournamentSelect.innerHTML = options.join('');
	}

	/**
	 * Handle tournament selection change
	 */
	async function handleTournamentChange() {
		const tournamentId = elements.tournamentSelect.value;

		if (!tournamentId) {
			clearEditor();
			return;
		}

		// Check for unsaved changes
		if (state.hasChanges) {
			const confirmed = confirm('You have unsaved changes. Discard them?');
			if (!confirmed) {
				elements.tournamentSelect.value = state.selectedTournament?.id || '';
				return;
			}
		}

		await loadTournament(tournamentId);
	}

	/**
	 * Load tournament and participants
	 */
	async function loadTournament(tournamentId) {
		if (state.isLoading) return;
		state.isLoading = true;

		try {
			FrontendDebug.api('BracketEditor', 'Loading tournament', { tournamentId });

			// Fetch tournament details
			const tournamentRes = await csrfFetch(`/api/tournaments/${tournamentId}`);
			if (!tournamentRes.ok) throw new Error('Failed to load tournament');
			state.selectedTournament = await tournamentRes.json();

			// Verify tournament is pending
			if (state.selectedTournament.state !== 'pending') {
				showAlert('Only pending tournaments can be edited', 'warning');
				clearEditor();
				return;
			}

			// Fetch participants
			const participantsRes = await csrfFetch(`/api/participants/${tournamentId}`);
			if (!participantsRes.ok) throw new Error('Failed to load participants');
			const participantsData = await participantsRes.json();
			state.participants = participantsData.participants || [];

			// Store original seeds
			state.originalSeeds.clear();
			state.currentSeeds.clear();
			state.participants.forEach(p => {
				state.originalSeeds.set(p.id, p.seed);
				state.currentSeeds.set(p.id, p.seed);
			});

			state.hasChanges = false;

			// Update UI
			updateFormatBadge();
			renderParticipantList();
			initSortable();
			await generateBracketPreview();
			showEditorUI();

			FrontendDebug.log('BracketEditor', 'Tournament loaded', {
				name: state.selectedTournament.name,
				participants: state.participants.length
			});

		} catch (error) {
			FrontendDebug.error('BracketEditor', 'Error loading tournament', error);
			showAlert('Failed to load tournament data', 'error');
		} finally {
			state.isLoading = false;
		}
	}

	/**
	 * Generate bracket preview via API
	 */
	async function generateBracketPreview() {
		if (!state.selectedTournament || state.participants.length < 2) {
			elements.emptyState.classList.remove('hidden');
			BracketCanvas.clear();
			return;
		}

		try {
			FrontendDebug.api('BracketEditor', 'Generating preview');

			// Build seed order from current state
			const seedOrder = [];
			state.currentSeeds.forEach((seed, participantId) => {
				seedOrder.push({ participantId, seed });
			});
			seedOrder.sort((a, b) => a.seed - b.seed);

			const response = await csrfFetch(`/api/bracket-editor/preview/${state.selectedTournament.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ seedOrder: seedOrder.map(s => s.participantId) })
			});

			if (!response.ok) throw new Error('Failed to generate preview');

			const visualization = await response.json();

			elements.emptyState.classList.add('hidden');
			BracketCanvas.render(visualization, state.participants, state.currentSeeds, state.originalSeeds);

			FrontendDebug.log('BracketEditor', 'Preview generated', { type: visualization.type });

		} catch (error) {
			FrontendDebug.error('BracketEditor', 'Error generating preview', error);
			showAlert('Failed to generate bracket preview', 'error');
		}
	}

	/**
	 * Render participant list with drag handles
	 */
	function renderParticipantList() {
		if (state.participants.length === 0) {
			elements.participantList.innerHTML = `
				<div class="p-4 text-center text-gray-400">
					<p>No participants in tournament</p>
				</div>`;
			elements.participantCount.textContent = '0 players';
			return;
		}

		// Sort by current seed
		const sorted = [...state.participants].sort((a, b) => {
			return (state.currentSeeds.get(a.id) || 999) - (state.currentSeeds.get(b.id) || 999);
		});

		const html = sorted.map(p => {
			const currentSeed = state.currentSeeds.get(p.id);
			const originalSeed = state.originalSeeds.get(p.id);
			const isChanged = currentSeed !== originalSeed;
			const displayName = p.display_name || p.name;

			return `
				<div class="participant-item flex items-center gap-3 px-4 py-3 border-b border-gray-700 hover:bg-gray-750 ${isChanged ? 'bg-yellow-900/20' : ''}"
					 data-id="${p.id}" data-seed="${currentSeed}">
					<div class="drag-handle text-gray-500 cursor-grab">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
						</svg>
					</div>
					<span class="seed-badge px-2 py-1 rounded text-sm font-mono ${isChanged ? 'bg-yellow-600' : 'bg-blue-600'} text-white">
						${currentSeed}
					</span>
					<span class="text-white flex-1 truncate">${escapeHtml(displayName)}</span>
					${isChanged ? `<span class="text-xs text-yellow-400">(was ${originalSeed})</span>` : ''}
				</div>`;
		}).join('');

		elements.participantList.innerHTML = html;
		elements.participantCount.textContent = `${state.participants.length} players`;
	}

	/**
	 * Initialize SortableJS for drag-drop reordering
	 */
	function initSortable() {
		if (state.sortableInstance) {
			state.sortableInstance.destroy();
		}

		if (typeof Sortable === 'undefined') {
			FrontendDebug.error('BracketEditor', 'SortableJS not loaded');
			return;
		}

		state.sortableInstance = new Sortable(elements.participantList, {
			animation: 150,
			handle: '.drag-handle',
			ghostClass: 'sortable-ghost',
			chosenClass: 'sortable-chosen',
			onEnd: handleSortEnd
		});

		FrontendDebug.log('BracketEditor', 'Sortable initialized');
	}

	/**
	 * Handle drag-drop sort end
	 */
	function handleSortEnd(evt) {
		FrontendDebug.action('BracketEditor', 'Drag-drop completed', {
			from: evt.oldIndex,
			to: evt.newIndex
		});

		// Rebuild seed order based on DOM order
		const items = elements.participantList.querySelectorAll('.participant-item');

		items.forEach((item, index) => {
			const participantId = parseInt(item.dataset.id);
			state.currentSeeds.set(participantId, index + 1);
		});

		checkForChanges();
		renderParticipantList();
		generateBracketPreview();
	}

	/**
	 * Check if there are unsaved changes
	 */
	function checkForChanges() {
		let hasChanges = false;

		state.currentSeeds.forEach((seed, id) => {
			if (seed !== state.originalSeeds.get(id)) {
				hasChanges = true;
			}
		});

		state.hasChanges = hasChanges;
		updateChangeIndicator();
	}

	/**
	 * Update UI to show/hide change indicator
	 */
	function updateChangeIndicator() {
		elements.pendingChanges.classList.toggle('hidden', !state.hasChanges);
		elements.applyBtn.disabled = !state.hasChanges;
		elements.discardBtn.disabled = !state.hasChanges;

		if (state.hasChanges) {
			elements.participantPanel?.classList.add('has-changes');
		} else {
			elements.participantPanel?.classList.remove('has-changes');
		}
	}

	/**
	 * Randomize seeds
	 */
	async function randomizeSeeds() {
		FrontendDebug.action('BracketEditor', 'Randomizing seeds');

		const ids = [...state.currentSeeds.keys()];

		// Fisher-Yates shuffle
		for (let i = ids.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[ids[i], ids[j]] = [ids[j], ids[i]];
		}

		// Assign new seeds
		ids.forEach((id, index) => {
			state.currentSeeds.set(id, index + 1);
		});

		checkForChanges();
		renderParticipantList();
		await generateBracketPreview();
	}

	/**
	 * Apply Elo-based seeding
	 */
	async function applyEloSeeding() {
		if (!state.selectedTournament?.game_id) {
			showAlert('Tournament has no game assigned for Elo lookup', 'warning');
			return;
		}

		try {
			FrontendDebug.api('BracketEditor', 'Applying Elo seeding');

			const response = await csrfFetch(`/api/participants/${state.selectedTournament.id}/elo-seeding`, {
				method: 'POST'
			});

			if (!response.ok) throw new Error('Failed to apply Elo seeding');

			const data = await response.json();

			// Update current seeds from response
			if (data.participants) {
				data.participants.forEach(p => {
					state.currentSeeds.set(p.id, p.seed);
				});
			}

			checkForChanges();
			renderParticipantList();
			await generateBracketPreview();

			showAlert('Elo seeding applied', 'success');
		} catch (error) {
			FrontendDebug.error('BracketEditor', 'Error applying Elo seeding', error);
			showAlert('Failed to apply Elo seeding', 'error');
		}
	}

	/**
	 * Sort participants alphabetically
	 */
	async function sortAlphabetically() {
		FrontendDebug.action('BracketEditor', 'Sorting alphabetically');

		// Get participants sorted by name
		const sorted = [...state.participants].sort((a, b) => {
			const nameA = (a.display_name || a.name || '').toLowerCase();
			const nameB = (b.display_name || b.name || '').toLowerCase();
			return nameA.localeCompare(nameB);
		});

		// Assign new seeds based on sorted order
		sorted.forEach((p, index) => {
			state.currentSeeds.set(p.id, index + 1);
		});

		checkForChanges();
		renderParticipantList();
		await generateBracketPreview();
	}

	/**
	 * Reverse seed order
	 */
	async function reverseSeeds() {
		FrontendDebug.action('BracketEditor', 'Reversing seed order');

		const maxSeed = state.currentSeeds.size;

		state.currentSeeds.forEach((seed, id) => {
			state.currentSeeds.set(id, maxSeed - seed + 1);
		});

		checkForChanges();
		renderParticipantList();
		await generateBracketPreview();
	}

	/**
	 * Reset to original seeds
	 */
	async function resetToOriginal() {
		FrontendDebug.action('BracketEditor', 'Resetting to original seeds');

		state.originalSeeds.forEach((seed, id) => {
			state.currentSeeds.set(id, seed);
		});

		state.hasChanges = false;
		updateChangeIndicator();
		renderParticipantList();
		await generateBracketPreview();
	}

	/**
	 * Apply seed changes to server
	 */
	async function applyChanges() {
		if (!state.hasChanges || !state.selectedTournament) return;

		elements.applyBtn.disabled = true;
		elements.applyBtn.innerHTML = `
			<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
				<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
			</svg>
			Applying...`;

		try {
			FrontendDebug.api('BracketEditor', 'Applying seed changes');

			// Build seed updates array
			const seedUpdates = [];
			state.currentSeeds.forEach((seed, participantId) => {
				seedUpdates.push({ participantId, seed });
			});

			const response = await csrfFetch(`/api/bracket-editor/apply-seeds/${state.selectedTournament.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ seeds: seedUpdates })
			});

			if (!response.ok) throw new Error('Failed to apply seeds');

			// Update original seeds to match current
			state.currentSeeds.forEach((seed, id) => {
				state.originalSeeds.set(id, seed);
			});

			state.hasChanges = false;
			updateChangeIndicator();
			renderParticipantList();

			showAlert('Seeding changes applied successfully', 'success');
			FrontendDebug.log('BracketEditor', 'Seeds applied successfully');

		} catch (error) {
			FrontendDebug.error('BracketEditor', 'Error applying changes', error);
			showAlert('Failed to apply seeding changes', 'error');
		} finally {
			elements.applyBtn.disabled = false;
			elements.applyBtn.innerHTML = `
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
				</svg>
				Apply Changes`;
		}
	}

	/**
	 * Discard pending changes
	 */
	function discardChanges() {
		if (!state.hasChanges) return;

		const confirmed = confirm('Discard all unsaved changes?');
		if (confirmed) {
			resetToOriginal();
			showAlert('Changes discarded', 'info');
		}
	}

	/**
	 * Handle search input
	 */
	function handleSearch(e) {
		const query = e.target.value.toLowerCase().trim();
		const items = elements.participantList.querySelectorAll('.participant-item');

		items.forEach(item => {
			const name = item.querySelector('.text-white')?.textContent?.toLowerCase() || '';
			item.style.display = name.includes(query) ? '' : 'none';
		});
	}

	/**
	 * Handle tournament update from WebSocket
	 */
	function handleTournamentUpdate(data) {
		FrontendDebug.ws('BracketEditor', 'Tournament update', data);

		if (state.selectedTournament && data.tournament?.id === state.selectedTournament.id) {
			if (data.tournament.state !== 'pending') {
				showAlert('Tournament has started. Editing disabled.', 'warning');
				clearEditor();
			}
		}
		loadTournaments();
	}

	/**
	 * Handle tournament started event
	 */
	function handleTournamentStarted(data) {
		FrontendDebug.ws('BracketEditor', 'Tournament started', data);

		if (state.selectedTournament && data.tournament?.id === state.selectedTournament.id) {
			showAlert('Tournament has started. Editing disabled.', 'warning');
			clearEditor();
		}
		loadTournaments();
	}

	/**
	 * Handle participant changes from WebSocket
	 */
	function handleParticipantChange(data) {
		FrontendDebug.ws('BracketEditor', 'Participant change', data);

		if (state.selectedTournament && data.tournamentId === state.selectedTournament.id) {
			// Reload tournament if we have no unsaved changes
			if (!state.hasChanges) {
				loadTournament(state.selectedTournament.id);
			} else {
				showAlert('Participant data changed. Reload to see updates.', 'info');
			}
		}
	}

	/**
	 * Show editor UI elements
	 */
	function showEditorUI() {
		elements.emptyState.classList.add('hidden');
		elements.seedingTools.classList.remove('hidden');
		elements.actionButtons.classList.remove('hidden');
		if (elements.participantEmptyState) {
			elements.participantEmptyState.classList.add('hidden');
		}
	}

	/**
	 * Clear editor and hide UI
	 */
	function clearEditor() {
		state.selectedTournament = null;
		state.participants = [];
		state.originalSeeds.clear();
		state.currentSeeds.clear();
		state.hasChanges = false;

		elements.tournamentSelect.value = '';
		elements.emptyState.classList.remove('hidden');
		elements.seedingTools.classList.add('hidden');
		elements.actionButtons.classList.add('hidden');
		elements.formatBadge.classList.add('hidden');
		if (elements.participantEmptyState) {
			elements.participantEmptyState.classList.remove('hidden');
		}
		elements.participantList.innerHTML = `
			<div id="participantEmptyState" class="p-4 text-center text-gray-400">
				<p>No tournament selected</p>
			</div>`;
		elements.participantCount.textContent = '0 players';

		updateChangeIndicator();
		BracketCanvas.clear();
	}

	/**
	 * Update format badge
	 */
	function updateFormatBadge() {
		if (!state.selectedTournament) return;

		const format = formatTournamentType(state.selectedTournament.tournament_type);
		elements.formatBadge.textContent = format;
		elements.formatBadge.classList.remove('hidden');
	}

	/**
	 * Format tournament type for display
	 */
	function formatTournamentType(type) {
		const formats = {
			'single_elimination': 'Single Elimination',
			'double_elimination': 'Double Elimination',
			'round_robin': 'Round Robin',
			'swiss': 'Swiss'
		};
		return formats[type] || type;
	}

	// Public API
	return {
		init,
		randomizeSeeds,
		applyEloSeeding,
		sortAlphabetically,
		reverseSeeds,
		resetToOriginal,
		applyChanges,
		discardChanges
	};
})();
