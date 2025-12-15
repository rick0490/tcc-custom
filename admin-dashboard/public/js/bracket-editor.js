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
		isLoading: false,
		isSaving: false,  // Prevent concurrent saves
		isReadOnly: false // True for underway tournaments (view-only mode)
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
		elements.bracketContainer = document.getElementById('bracketContainer');
		elements.bracketCanvas = document.getElementById('bracketCanvas');
		elements.emptyState = document.getElementById('emptyState');
		elements.formatBadge = document.getElementById('formatBadge');
		elements.zoomLevel = document.getElementById('zoomLevel');
		elements.seedingTools = document.getElementById('seedingTools');
	}

	/**
	 * Bind event listeners
	 */
	function bindEvents() {
		if (elements.tournamentSelect) {
			elements.tournamentSelect.addEventListener('change', handleTournamentChange);
		}

		// Register swap callback with BracketCanvas
		BracketCanvas.setSwapCallback(handleCanvasSwap);
	}

	/**
	 * Handle swap from canvas drag-drop - saves immediately
	 * @param {number} sourceId - Source participant ID
	 * @param {number} targetId - Target participant ID
	 */
	async function handleCanvasSwap(sourceId, targetId) {
		FrontendDebug.action('BracketEditor', 'Canvas swap', { sourceId, targetId });

		// Get current seeds
		const sourceSeed = state.currentSeeds.get(sourceId);
		const targetSeed = state.currentSeeds.get(targetId);

		if (!sourceSeed || !targetSeed) {
			FrontendDebug.error('BracketEditor', 'Invalid swap - seeds not found');
			return;
		}

		// Swap seeds locally
		state.currentSeeds.set(sourceId, targetSeed);
		state.currentSeeds.set(targetId, sourceSeed);

		// Save immediately and refresh preview
		await saveSeeds();
		await generateBracketPreview();
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
	 * Load tournaments from API (pending and underway)
	 */
	async function loadTournaments() {
		try {
			FrontendDebug.api('BracketEditor', 'Loading tournaments');
			const response = await csrfFetch('/api/tournaments');
			if (!response.ok) throw new Error('Failed to load tournaments');

			const data = await response.json();
			// API returns { tournaments: { pending: [...], inProgress: [...], completed: [...] } }
			// Combine pending and inProgress tournaments for bracket editor
			const pending = (data.tournaments?.pending || []).map(t => ({ ...t, _state: 'pending' }));
			const inProgress = (data.tournaments?.inProgress || []).map(t => ({ ...t, _state: 'underway' }));
			state.tournaments = [...pending, ...inProgress];

			renderTournamentOptions();

			// Auto-select active tournament
			await selectActiveTournament();

			FrontendDebug.log('BracketEditor', 'Tournaments loaded', { count: state.tournaments.length });
		} catch (error) {
			FrontendDebug.error('BracketEditor', 'Error loading tournaments', error);
			showAlert('Failed to load tournaments', 'error');
		}
	}

	/**
	 * Auto-select the active tournament
	 */
	async function selectActiveTournament() {
		try {
			const response = await fetch('/api/tournament/active');
			if (!response.ok) return;

			const data = await response.json();
			if (data.success && data.tournament) {
				// Check if active tournament is in our dropdown (pending or underway)
				const tournamentId = data.tournament.id;
				const option = Array.from(elements.tournamentSelect.options).find(opt =>
					opt.value === String(tournamentId)
				);

				if (option) {
					elements.tournamentSelect.value = option.value;
					FrontendDebug.log('BracketEditor', 'Auto-selected active tournament', {
						tournament: data.tournament.name,
						state: data.tournament.state,
						mode: data.mode
					});
					// Trigger load
					await handleTournamentChange();
				}
			}
		} catch (error) {
			FrontendDebug.warn('BracketEditor', 'Could not fetch active tournament', error);
			// Silently fail - user can still manually select
		}
	}

	/**
	 * Render tournament dropdown options
	 */
	function renderTournamentOptions() {
		const options = ['<option value="">Select a tournament...</option>'];

		state.tournaments.forEach(t => {
			// API uses 'participants' not 'participant_count'
			const participantCount = t.participants || t.participant_count || 0;
			const format = formatTournamentType(t.tournamentType || t.tournament_type);
			const stateLabel = t._state === 'underway' ? '[LIVE] ' : '';
			options.push(`<option value="${t.id}">${stateLabel}${escapeHtml(t.name)} (${participantCount} players, ${format})</option>`);
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
			const tournamentData = await tournamentRes.json();

			// Check for API error
			if (!tournamentData.success) {
				throw new Error(tournamentData.error || 'Failed to load tournament');
			}

			// Extract tournament from response
			state.selectedTournament = tournamentData.tournament;

			// Set read-only mode for non-pending tournaments
			state.isReadOnly = state.selectedTournament.state !== 'pending';
			BracketCanvas.setReadOnly(state.isReadOnly);

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

			// Update UI
			updateFormatBadge();

			// For underway tournaments, fetch live bracket data
			if (state.isReadOnly) {
				await loadLiveBracket();
			} else {
				await generateBracketPreview();
			}

			showEditorUI();

			FrontendDebug.log('BracketEditor', 'Tournament loaded', {
				name: state.selectedTournament.name,
				participants: state.participants.length,
				readOnly: state.isReadOnly
			});

		} catch (error) {
			FrontendDebug.error('BracketEditor', 'Error loading tournament', error);
			showAlert('Failed to load tournament data', 'error');
		} finally {
			state.isLoading = false;
		}
	}

	/**
	 * Load live bracket data for underway tournaments
	 */
	async function loadLiveBracket() {
		if (!state.selectedTournament) return;

		try {
			FrontendDebug.api('BracketEditor', 'Loading live bracket');

			const response = await csrfFetch(`/api/bracket-editor/live/${state.selectedTournament.id}`);
			if (!response.ok) throw new Error('Failed to load live bracket');

			const visualization = await response.json();

			elements.emptyState.classList.add('hidden');
			BracketCanvas.render(visualization, state.participants, state.currentSeeds, state.originalSeeds);

			FrontendDebug.log('BracketEditor', 'Live bracket loaded', { type: visualization.type });

		} catch (error) {
			FrontendDebug.error('BracketEditor', 'Error loading live bracket', error);
			showAlert('Failed to load live bracket', 'error');
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
	 * Save seeds immediately to the server
	 */
	async function saveSeeds() {
		if (state.isSaving || !state.selectedTournament) return;
		state.isSaving = true;

		try {
			FrontendDebug.api('BracketEditor', 'Saving seeds');

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

			if (!response.ok) throw new Error('Failed to save seeds');

			// Update original seeds to match current
			state.currentSeeds.forEach((seed, id) => {
				state.originalSeeds.set(id, seed);
			});

			FrontendDebug.log('BracketEditor', 'Seeds saved successfully');

		} catch (error) {
			FrontendDebug.error('BracketEditor', 'Error saving seeds', error);
			showAlert('Failed to save seeding changes', 'error');
		} finally {
			state.isSaving = false;
		}
	}

	/**
	 * Randomize seeds - saves immediately
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

		await saveSeeds();
		await generateBracketPreview();
	}

	/**
	 * Apply Elo-based seeding - saves to server via API
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

			// Update both current and original seeds from response (API already saved)
			if (data.participants) {
				data.participants.forEach(p => {
					state.currentSeeds.set(p.id, p.seed);
					state.originalSeeds.set(p.id, p.seed);
				});
			}

			await generateBracketPreview();
			showAlert('Elo seeding applied', 'success');
		} catch (error) {
			FrontendDebug.error('BracketEditor', 'Error applying Elo seeding', error);
			showAlert('Failed to apply Elo seeding', 'error');
		}
	}

	/**
	 * Sort participants alphabetically - saves immediately
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

		await saveSeeds();
		await generateBracketPreview();
	}

	/**
	 * Reverse seed order - saves immediately
	 */
	async function reverseSeeds() {
		FrontendDebug.action('BracketEditor', 'Reversing seed order');

		const maxSeed = state.currentSeeds.size;

		state.currentSeeds.forEach((seed, id) => {
			state.currentSeeds.set(id, maxSeed - seed + 1);
		});

		await saveSeeds();
		await generateBracketPreview();
	}

	/**
	 * Reset to original seeds - saves immediately
	 */
	async function resetToOriginal() {
		FrontendDebug.action('BracketEditor', 'Resetting to original seeds');

		state.originalSeeds.forEach((seed, id) => {
			state.currentSeeds.set(id, seed);
		});

		await saveSeeds();
		await generateBracketPreview();
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
			// Reload tournament to get updated participant data
			loadTournament(state.selectedTournament.id);
		}
	}

	/**
	 * Show editor UI elements
	 */
	function showEditorUI() {
		elements.emptyState.classList.add('hidden');
		// Hide seeding tools for read-only mode (underway tournaments)
		if (state.isReadOnly) {
			elements.seedingTools.classList.add('hidden');
		} else {
			elements.seedingTools.classList.remove('hidden');
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

		elements.tournamentSelect.value = '';
		elements.emptyState.classList.remove('hidden');
		elements.seedingTools.classList.add('hidden');
		elements.formatBadge.classList.add('hidden');

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
		resetToOriginal
	};
})();
