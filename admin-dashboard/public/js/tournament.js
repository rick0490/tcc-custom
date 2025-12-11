// Tournament Control Page JavaScript

// State
let allTournaments = null;
let selectedTournament = null;
let currentTab = 'pending';
let editingTournament = null;
let editingVersion = null; // Version tracking for optimistic locking

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
	console.log('Tournament Control page loaded');

	await Promise.all([
		refreshTournaments(),
		loadSystemDefaults()
	]);
});

// Load tournaments from API
async function refreshTournaments() {
	// Show loading state
	const btn = document.getElementById('refreshTournamentsBtn');
	const icon = document.getElementById('refreshTournamentsIcon');
	const text = document.getElementById('refreshTournamentsText');
	if (btn) btn.disabled = true;
	if (icon) icon.classList.add('animate-spin');
	if (text) text.textContent = 'Refreshing...';

	try {
		const response = await fetch('/api/tournaments?days=90');
		if (!response.ok) {
			if (response.status === 401) {
				window.location.href = '/login.html';
				return;
			}
			throw new Error(`HTTP ${response.status}`);
		}

		const data = await response.json();
		if (data.success) {
			allTournaments = data.tournaments;
			displayTournaments();
			updateActiveBanner();
			// Re-select current tournament if still exists (to update participant count, etc.)
			if (selectedTournament) {
				const allList = [
					...(allTournaments.pending || []),
					...(allTournaments.inProgress || []),
					...(allTournaments.completed || [])
				];
				const updated = allList.find(t => t.tournamentId === selectedTournament.tournamentId);
				if (updated) {
					selectedTournament = updated;
					updateLifecycleButtons();
				}
			}
		}
	} catch (error) {
		console.error('Failed to load tournaments:', error);
		showAlert('Failed to load tournaments', 'error');
	} finally {
		// Reset loading state
		if (btn) btn.disabled = false;
		if (icon) icon.classList.remove('animate-spin');
		if (text) text.textContent = 'Refresh';
	}
}

// Display tournaments based on current tab
function displayTournaments() {
	const container = document.getElementById('tournamentList');
	if (!container || !allTournaments) return;

	let tournaments = [];
	switch (currentTab) {
		case 'pending':
			tournaments = allTournaments.pending || [];
			break;
		case 'inProgress':
			tournaments = allTournaments.inProgress || [];
			break;
		case 'completed':
			tournaments = allTournaments.completed || [];
			break;
	}

	if (tournaments.length === 0) {
		container.innerHTML = `
			<div class="text-center py-8 text-gray-400">
				No ${currentTab === 'inProgress' ? 'in-progress' : currentTab} tournaments found
			</div>
		`;
		return;
	}

	container.innerHTML = tournaments.map(t => `
		<div class="tournament-item ${selectedTournament?.tournamentId === t.tournamentId ? 'selected' : ''}"
			 onclick="selectTournament('${t.tournamentId}')">
			<div class="flex-1">
				<div class="tournament-name">${escapeHtml(t.name)}</div>
				<div class="text-sm text-gray-400">${escapeHtml(t.game)}</div>
				<div class="flex flex-wrap gap-2 mt-2">
					<span class="text-xs bg-gray-700 px-2 py-1 rounded">${formatTournamentType(t.tournamentType)}</span>
					${t.startAt ? `<span class="text-xs bg-gray-700 px-2 py-1 rounded">${formatTournamentDate(t.startAt)}</span>` : ''}
				</div>
			</div>
			<div class="flex items-center gap-4">
				<button onclick="event.stopPropagation(); openEditModal('${t.tournamentId}')"
					class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5" title="Edit Tournament">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
					</svg>
					Edit
				</button>
				<span class="tournament-state ${t.state}">${t.state}</span>
				<span class="text-gray-400">${t.participants} players</span>
			</div>
		</div>
	`).join('');
}

// Switch tournament tab
function switchTab(tab) {
	currentTab = tab;

	// Update tab buttons
	document.querySelectorAll('.tab-btn').forEach(btn => {
		const isActive = btn.dataset.tab === tab;
		btn.classList.toggle('border-blue-500', isActive);
		btn.classList.toggle('text-blue-400', isActive);
		btn.classList.toggle('border-transparent', !isActive);
		btn.classList.toggle('text-gray-400', !isActive);
	});

	displayTournaments();
}

// Select a tournament
function selectTournament(tournamentId) {
	const tournaments = [
		...(allTournaments?.pending || []),
		...(allTournaments?.inProgress || []),
		...(allTournaments?.completed || [])
	];

	selectedTournament = tournaments.find(t => t.tournamentId === tournamentId);

	// Update visual selection
	document.querySelectorAll('.tournament-item').forEach(item => {
		item.classList.remove('selected');
	});
	event.currentTarget.classList.add('selected');

	// Show configuration section
	const configSection = document.getElementById('configSection');
	const lifecycleSection = document.getElementById('lifecycleSection');

	if (selectedTournament) {
		// Update selected tournament info
		document.getElementById('selectedName').textContent = selectedTournament.name;
		document.getElementById('selectedGame').textContent = selectedTournament.game;
		document.getElementById('selectedParticipants').textContent = selectedTournament.participants;

		configSection.classList.remove('hidden');
		lifecycleSection.classList.remove('hidden');

		// Update lifecycle buttons based on state
		updateLifecycleButtons();

		// Update checklist visibility (only for pending tournaments)
		updateChecklistVisibility();
	} else {
		configSection.classList.add('hidden');
		lifecycleSection.classList.add('hidden');
		// Hide checklist when no tournament selected
		const checklistSection = document.getElementById('checklistSection');
		if (checklistSection) checklistSection.classList.add('hidden');
	}

	updateDeployButton();
}

// Update lifecycle control buttons based on tournament state
function updateLifecycleButtons() {
	const startBtn = document.getElementById('startTournamentBtn');
	const resetBtn = document.getElementById('resetTournamentBtn');
	const finalizeBtn = document.getElementById('finalizeTournamentBtn');
	const deleteBtn = document.getElementById('deleteTournamentBtn');
	const startPrereqs = document.getElementById('startPrerequisites');
	const startPrereqMsg = document.getElementById('startPrereqMessage');

	if (!selectedTournament) {
		startBtn.disabled = true;
		resetBtn.disabled = true;
		finalizeBtn.disabled = true;
		deleteBtn.disabled = true;
		if (startPrereqs) startPrereqs.classList.add('hidden');
		return;
	}

	const state = selectedTournament.state;
	const participantCount = selectedTournament.participants || 0;

	// Start: check state and participant count
	let canStart = state === 'pending';
	let startMessage = '';

	if (state !== 'pending') {
		canStart = false;
		if (state === 'underway') {
			startMessage = 'Tournament already in progress';
		} else if (state === 'complete') {
			startMessage = 'Tournament already completed';
		}
	} else if (participantCount < 2) {
		canStart = false;
		startMessage = `Need ${2 - participantCount} more participant${participantCount === 1 ? '' : 's'} (${participantCount}/2 min)`;
	}

	startBtn.disabled = !canStart;

	// Show/hide prerequisite message
	if (startPrereqs && startPrereqMsg) {
		if (startMessage && state === 'pending') {
			startPrereqMsg.querySelector('span').textContent = startMessage;
			startPrereqs.classList.remove('hidden');
		} else {
			startPrereqs.classList.add('hidden');
		}
	}

	// Reset: available for underway or awaiting_review tournaments
	resetBtn.disabled = !['underway', 'awaiting_review'].includes(state);

	// Finalize: only for underway or awaiting_review
	finalizeBtn.disabled = !['underway', 'awaiting_review'].includes(state);

	// Delete: available for pending and complete tournaments (not underway)
	deleteBtn.disabled = !['pending', 'complete'].includes(state);

	// Show export section for completed or underway tournaments
	const exportSection = document.getElementById('exportSection');
	if (exportSection) {
		if (state === 'complete' || state === 'underway') {
			exportSection.classList.remove('hidden');
		} else {
			exportSection.classList.add('hidden');
		}
	}
}

// Update active tournament banner
function updateActiveBanner() {
	const banner = document.getElementById('activeTournamentBanner');
	const inProgress = allTournaments?.inProgress || [];

	if (inProgress.length > 0) {
		const active = inProgress[0];
		document.getElementById('activeTournamentName').textContent = active.name;
		document.getElementById('activeTournamentState').textContent = active.state;
		banner.classList.remove('hidden');
	} else {
		banner.classList.add('hidden');
	}
}

// Load system defaults
async function loadSystemDefaults() {
	try {
		const response = await fetch('/api/settings/defaults');
		if (!response.ok) return;

		const data = await response.json();
		if (data.success && data.defaults) {
			const regWindow = document.getElementById('registrationWindow');
			if (regWindow && data.defaults.registrationWindow) {
				regWindow.value = data.defaults.registrationWindow;
			}
		}
	} catch (error) {
		console.error('Failed to load defaults:', error);
	}
}

// Update deploy button state
function updateDeployButton() {
	const btn = document.getElementById('deployBtn');
	if (btn) {
		btn.disabled = !selectedTournament;
	}
}

// Deploy tournament to all displays
async function deployTournament() {
	if (!selectedTournament) return;

	const regWindow = document.getElementById('registrationWindow');
	const signupCap = document.getElementById('signupCap');

	const payload = {
		tournamentId: selectedTournament.tournamentId,
		gameName: selectedTournament.game,
		registrationWindowHours: parseInt(regWindow.value) || 48,
		signupCap: signupCap.value ? parseInt(signupCap.value) : null
	};

	const btn = document.getElementById('deployBtn');
	btn.disabled = true;
	btn.textContent = 'Deploying...';

	try {
		const response = await csrfFetch('/api/tournament/setup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Tournament "${selectedTournament.name}" deployed successfully!`, 'success');
		} else {
			showAlert(`Deployment failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Deployment error: ${error.message}`, 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Deploy Tournament';
		updateDeployButton();
	}
}

// Start tournament on Challonge
async function startTournament() {
	if (!selectedTournament) return;
	if (!confirm(`Start tournament "${selectedTournament.name}"? This will lock participants and begin bracket play.`)) return;

	const btn = document.getElementById('startTournamentBtn');
	btn.disabled = true;
	btn.textContent = 'Starting...';

	try {
		const response = await csrfFetch(`/api/tournament/${selectedTournament.tournamentId}/start`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Tournament started successfully!', 'success');
			// Update local state and buttons immediately
			selectedTournament.state = 'underway';
			updateLifecycleButtons();
		} else {
			showAlert(`Failed to start: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	} finally {
		btn.textContent = 'Start';
		// Always refresh to get latest state and update buttons
		try {
			await refreshTournaments();
		} catch (e) {
			console.error('Failed to refresh tournaments:', e);
		}
		updateLifecycleButtons();
	}
}

// Reset tournament on Challonge
async function resetTournament() {
	if (!selectedTournament) return;
	if (!confirm(`Reset tournament "${selectedTournament.name}"? This will clear all match results.`)) return;

	const btn = document.getElementById('resetTournamentBtn');
	btn.disabled = true;
	btn.textContent = 'Resetting...';

	try {
		const response = await csrfFetch(`/api/tournament/${selectedTournament.tournamentId}/reset`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Tournament reset successfully!', 'success');
			// Update local state and buttons immediately
			selectedTournament.state = 'pending';
			updateLifecycleButtons();
		} else {
			showAlert(`Failed to reset: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	} finally {
		btn.textContent = 'Reset';
		// Always refresh to get latest state and update buttons
		try {
			await refreshTournaments();
		} catch (e) {
			console.error('Failed to refresh tournaments:', e);
		}
		updateLifecycleButtons();
	}
}

// Finalize tournament on Challonge
async function finalizeTournament() {
	if (!selectedTournament) return;
	if (!confirm(`Finalize tournament "${selectedTournament.name}"? This will mark it as complete.`)) return;

	const btn = document.getElementById('finalizeTournamentBtn');
	btn.disabled = true;
	btn.textContent = 'Finalizing...';

	try {
		const response = await csrfFetch(`/api/tournament/${selectedTournament.tournamentId}/complete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Tournament finalized successfully!', 'success');
			// Update local state and buttons immediately
			selectedTournament.state = 'complete';
			updateLifecycleButtons();
		} else {
			showAlert(`Failed to finalize: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	} finally {
		btn.textContent = 'Finalize';
		// Always refresh to get latest state and update buttons
		try {
			await refreshTournaments();
		} catch (e) {
			console.error('Failed to refresh tournaments:', e);
		}
		updateLifecycleButtons();
	}
}

// Delete tournament permanently
async function deleteTournament() {
	if (!selectedTournament) return;
	if (!confirm(`DELETE tournament "${selectedTournament.name}"?\n\nThis action is PERMANENT and cannot be undone.`)) return;

	const btn = document.getElementById('deleteTournamentBtn');
	btn.disabled = true;
	btn.textContent = 'Deleting...';

	try {
		const response = await csrfFetch(`/api/tournament/${selectedTournament.tournamentId}`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Tournament deleted successfully', 'success');
			// Clear selection and hide config sections
			selectedTournament = null;
			document.getElementById('configSection').classList.add('hidden');
			document.getElementById('lifecycleSection').classList.add('hidden');
			await refreshTournaments();
		} else {
			showAlert(`Failed to delete: ${data.error}`, 'error');
			btn.disabled = false;
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
		btn.disabled = false;
	} finally {
		btn.textContent = 'Delete';
	}
}

// Complete active tournament (from banner)
async function completeTournament() {
	const inProgress = allTournaments?.inProgress || [];
	if (inProgress.length === 0) return;

	const active = inProgress[0];
	if (!confirm(`Complete tournament "${active.name}"?`)) return;

	try {
		const response = await csrfFetch(`/api/tournament/${active.tournamentId}/complete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Tournament completed successfully!', 'success');
			await refreshTournaments();
		} else {
			showAlert(`Failed to complete: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Helper functions
function formatTournamentType(type) {
	const types = {
		'single elimination': 'Single Elim',
		'double elimination': 'Double Elim',
		'round robin': 'Round Robin',
		'swiss': 'Swiss'
	};
	return types[type] || type;
}

function formatTournamentDate(dateStr) {
	if (!dateStr) return '';
	const date = new Date(dateStr);
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TIMEZONE });
}

// Note: escapeHtml, showAlert, formatDate, formatDateTime are now in utils.js

// ==========================================
// Tournament Creation Wizard
// ==========================================

let wizardStep = 1;

// Open the wizard
function openCreateWizard() {
	wizardStep = 1;
	resetWizardForm();
	updateWizardUI();
	document.getElementById('createWizardModal').classList.remove('hidden');
	setupWizardEventListeners();
	// Load templates for the dropdown
	loadTemplates();
}

// Close the wizard
function closeCreateWizard() {
	document.getElementById('createWizardModal').classList.add('hidden');
	resetWizardForm();
}

// Reset the wizard form
function resetWizardForm() {
	// Reset template selection
	const templateSelect = document.getElementById('wizardTemplateSelect');
	if (templateSelect) templateSelect.selectedIndex = 0;

	// Step 1: Basic Info
	document.getElementById('wizardName').value = '';
	document.getElementById('wizardGame').value = '';
	document.getElementById('wizardDescription').value = '';

	// Step 2: Format - reset format selection
	document.querySelectorAll('input[name="tournamentType"]').forEach(radio => {
		radio.checked = radio.value === 'single elimination';
	});

	// Single Elim options
	document.getElementById('wizardThirdPlace').checked = false;

	// Double Elim options
	document.getElementById('wizardGrandFinals').value = '';

	// Round Robin options
	document.getElementById('wizardRrIterations').value = '1';
	document.getElementById('wizardRankedBy').value = 'match wins';
	document.getElementById('wizardRrMatchWin').value = '1.0';
	document.getElementById('wizardRrMatchTie').value = '0.5';
	document.getElementById('wizardRrGameWin').value = '0';
	document.getElementById('wizardRrGameTie').value = '0';

	// Swiss options
	document.getElementById('wizardSwissRounds').value = '';
	document.getElementById('wizardSwissMatchWin').value = '1.0';
	document.getElementById('wizardSwissMatchTie').value = '0.5';
	document.getElementById('wizardSwissBye').value = '1.0';
	document.getElementById('wizardSwissGameWin').value = '0';
	document.getElementById('wizardSwissGameTie').value = '0';

	// Seeding & Display options
	document.getElementById('wizardHideSeeds').checked = false;
	document.getElementById('wizardSequentialPairings').checked = false;
	document.getElementById('wizardShowRounds').checked = false;

	// Station options
	document.getElementById('wizardAutoAssign').checked = false;

	// Group Stage options
	document.getElementById('wizardGroupStageEnabled').checked = false;
	document.getElementById('wizardGroupSize').value = '4';
	document.getElementById('wizardGroupAdvance').value = '2';
	document.getElementById('wizardGroupStageType').value = 'round robin';
	document.getElementById('wizardGroupRankedBy').value = 'match wins';
	document.getElementById('wizardGroupStageOptions').classList.add('hidden');

	// Step 3: Schedule & Settings
	document.getElementById('wizardStartAt').value = '';
	document.getElementById('wizardCheckIn').value = '';
	document.getElementById('wizardSignupCap').value = '';

	// Registration & Privacy
	document.getElementById('wizardOpenSignup').checked = false;
	document.getElementById('wizardPrivate').checked = false;
	document.getElementById('wizardHideForum').checked = false;

	// Match Settings
	document.getElementById('wizardAcceptAttachments').checked = false;
	// Note: quickAdvance removed - not supported by Challonge v2.1 API

	// Notifications
	document.getElementById('wizardNotifyMatchOpen').checked = false;
	document.getElementById('wizardNotifyTournamentEnd').checked = false;

	updateFormatSelection();
}

// Setup event listeners for the wizard
function setupWizardEventListeners() {
	// Format selection - update visual selection and options
	document.querySelectorAll('.format-option input[type="radio"]').forEach(radio => {
		radio.addEventListener('change', updateFormatSelection);
	});

	// Round Robin ranking method - show/hide custom points
	const rankedBySelect = document.getElementById('wizardRankedBy');
	if (rankedBySelect) {
		rankedBySelect.addEventListener('change', () => {
			const rrCustomPoints = document.getElementById('rrCustomPoints');
			rrCustomPoints.classList.toggle('hidden', rankedBySelect.value !== 'custom');
		});
	}

	// Update summary when date/time changes on step 3
	const startAtInput = document.getElementById('wizardStartAt');
	if (startAtInput) {
		startAtInput.addEventListener('change', updateWizardSummary);
	}
}

// Update format selection UI
function updateFormatSelection() {
	const selected = document.querySelector('input[name="tournamentType"]:checked')?.value;

	// Update visual selection
	document.querySelectorAll('.format-option').forEach(label => {
		const input = label.querySelector('input');
		const div = label.querySelector('div');
		if (input.checked) {
			div.classList.remove('border-gray-600');
			div.classList.add('border-blue-500');
		} else {
			div.classList.remove('border-blue-500');
			div.classList.add('border-gray-600');
		}
	});

	// Show/hide format-specific options
	const singleElimOptions = document.getElementById('singleElimOptions');
	const doubleElimOptions = document.getElementById('doubleElimOptions');
	const roundRobinOptions = document.getElementById('roundRobinOptions');
	const swissOptions = document.getElementById('swissOptions');
	const showRoundsOption = document.getElementById('showRoundsOption');
	const groupStageSection = document.getElementById('wizardGroupStageSection');

	singleElimOptions.classList.toggle('hidden', selected !== 'single elimination');
	doubleElimOptions.classList.toggle('hidden', selected !== 'double elimination');
	roundRobinOptions.classList.toggle('hidden', selected !== 'round robin');
	swissOptions.classList.toggle('hidden', selected !== 'swiss');

	// Show round labels option only for elimination formats
	const isElimination = selected === 'single elimination' || selected === 'double elimination';
	showRoundsOption.classList.toggle('hidden', !isElimination);

	// Show group stage option only for elimination formats
	if (groupStageSection) {
		groupStageSection.classList.toggle('hidden', !isElimination);
		// Reset group stage when switching away from elimination formats
		if (!isElimination) {
			const groupStageEnabled = document.getElementById('wizardGroupStageEnabled');
			if (groupStageEnabled) {
				groupStageEnabled.checked = false;
				toggleWizardGroupStageOptions();
			}
		}
	}
}

// Navigate to next step
function wizardNext() {
	// Validate current step
	if (!validateWizardStep(wizardStep)) return;

	if (wizardStep < 3) {
		wizardStep++;
		updateWizardUI();

		// Update summary on step 3
		if (wizardStep === 3) {
			updateWizardSummary();
		}
	}
}

// Navigate to previous step
function wizardBack() {
	if (wizardStep > 1) {
		wizardStep--;
		updateWizardUI();
	}
}

// Validate current wizard step
function validateWizardStep(step) {
	if (step === 1) {
		const name = document.getElementById('wizardName').value.trim();
		if (!name) {
			showAlert('Please enter a tournament name', 'warning');
			document.getElementById('wizardName').focus();
			return false;
		}
		if (name.length > 60) {
			showAlert('Tournament name must be 60 characters or less', 'warning');
			return false;
		}
	}
	return true;
}

// Update wizard UI based on current step
function updateWizardUI() {
	// Update step number
	document.getElementById('wizardStepNum').textContent = wizardStep;

	// Update step indicators
	document.getElementById('step1Indicator').className = `flex-1 h-2 rounded-full ${wizardStep >= 1 ? 'bg-blue-600' : 'bg-gray-600'}`;
	document.getElementById('step2Indicator').className = `flex-1 h-2 rounded-full ${wizardStep >= 2 ? 'bg-blue-600' : 'bg-gray-600'}`;
	document.getElementById('step3Indicator').className = `flex-1 h-2 rounded-full ${wizardStep >= 3 ? 'bg-blue-600' : 'bg-gray-600'}`;

	// Show/hide step content
	document.getElementById('wizardStep1').classList.toggle('hidden', wizardStep !== 1);
	document.getElementById('wizardStep2').classList.toggle('hidden', wizardStep !== 2);
	document.getElementById('wizardStep3').classList.toggle('hidden', wizardStep !== 3);

	// Show/hide back button
	document.getElementById('wizardBackBtn').classList.toggle('hidden', wizardStep === 1);

	// Show/hide next/create buttons
	document.getElementById('wizardNextBtn').classList.toggle('hidden', wizardStep === 3);
	document.getElementById('wizardCreateBtn').classList.toggle('hidden', wizardStep !== 3);
}

// Update summary on final step
function updateWizardSummary() {
	const name = document.getElementById('wizardName').value.trim();
	const game = document.getElementById('wizardGame').value.trim();
	const format = document.querySelector('input[name="tournamentType"]:checked')?.value || 'single elimination';
	const startAt = document.getElementById('wizardStartAt').value;

	document.getElementById('summaryName').textContent = name || '--';
	document.getElementById('summaryGame').textContent = game || 'Not specified';
	document.getElementById('summaryFormat').textContent = formatTournamentType(format);
	document.getElementById('summaryStart').textContent = startAt
		? formatDateTimeShort(startAt) + ' CT'
		: 'Not scheduled';
}

// Create tournament via API
async function createTournament() {
	console.log('=== createTournament() called ===');

	// Step 1: Basic Info
	const name = document.getElementById('wizardName').value.trim();
	const gameName = document.getElementById('wizardGame').value.trim();
	const description = document.getElementById('wizardDescription').value.trim();

	// Step 2: Format
	const tournamentType = document.querySelector('input[name="tournamentType"]:checked')?.value || 'single elimination';

	// Single Elim options
	const holdThirdPlaceMatch = document.getElementById('wizardThirdPlace').checked;

	// Double Elim options
	const grandFinalsModifier = document.getElementById('wizardGrandFinals').value;

	// Round Robin options
	const rrIterations = document.getElementById('wizardRrIterations').value;
	const rankedBy = document.getElementById('wizardRankedBy').value;
	const rrMatchWin = document.getElementById('wizardRrMatchWin').value;
	const rrMatchTie = document.getElementById('wizardRrMatchTie').value;
	const rrGameWin = document.getElementById('wizardRrGameWin').value;
	const rrGameTie = document.getElementById('wizardRrGameTie').value;

	// Swiss options
	const swissRounds = document.getElementById('wizardSwissRounds').value;
	const swissMatchWin = document.getElementById('wizardSwissMatchWin').value;
	const swissMatchTie = document.getElementById('wizardSwissMatchTie').value;
	const swissBye = document.getElementById('wizardSwissBye').value;
	const swissGameWin = document.getElementById('wizardSwissGameWin').value;
	const swissGameTie = document.getElementById('wizardSwissGameTie').value;

	// Seeding & Display options
	const hideSeeds = document.getElementById('wizardHideSeeds').checked;
	const sequentialPairings = document.getElementById('wizardSequentialPairings').checked;
	const showRounds = document.getElementById('wizardShowRounds').checked;

	// Station options
	const autoAssign = document.getElementById('wizardAutoAssign').checked;

	// Group Stage options (for elimination formats only)
	const groupStageEnabled = document.getElementById('wizardGroupStageEnabled').checked;
	const groupSize = document.getElementById('wizardGroupSize').value;
	const groupAdvance = document.getElementById('wizardGroupAdvance').value;
	const groupStageType = document.getElementById('wizardGroupStageType').value;
	const groupRankedBy = document.getElementById('wizardGroupRankedBy').value;

	// Step 3: Schedule & Settings
	const startAtValue = document.getElementById('wizardStartAt').value;
	// Convert datetime-local (Central Time) to ISO string (UTC)
	let startAt = null;
	if (startAtValue) {
		const [datePart, timePart] = startAtValue.split('T');
		const [year, month, day] = datePart.split('-').map(Number);

		// Determine if DST is in effect for Central Time on this date
		const isDST = (() => {
			if (month > 3 && month < 11) return true;
			if (month < 3 || month > 11) return false;
			if (month === 3) {
				const marchFirst = new Date(year, 2, 1);
				const secondSunday = 8 + ((7 - marchFirst.getDay()) % 7);
				return day >= secondSunday;
			}
			if (month === 11) {
				const novFirst = new Date(year, 10, 1);
				const firstSunday = 1 + ((7 - novFirst.getDay()) % 7);
				return day < firstSunday;
			}
			return false;
		})();

		const offset = isDST ? '-05:00' : '-06:00';
		const dateWithTZ = `${startAtValue}:00${offset}`;
		startAt = new Date(dateWithTZ).toISOString();
		console.log('[Tournament Create] Converting Central Time:', startAtValue, `(${isDST ? 'CDT' : 'CST'})`, '-> UTC:', startAt);
	}
	const checkInDuration = document.getElementById('wizardCheckIn').value;
	const signupCap = document.getElementById('wizardSignupCap').value;

	// Registration & Privacy
	const openSignup = document.getElementById('wizardOpenSignup').checked;
	const privateTournament = document.getElementById('wizardPrivate').checked;
	const hideForum = document.getElementById('wizardHideForum').checked;

	// Match Settings
	const acceptAttachments = document.getElementById('wizardAcceptAttachments').checked;
	// Note: quick_advance is NOT supported by Challonge v2.1 API

	// Notifications
	const notifyMatchOpen = document.getElementById('wizardNotifyMatchOpen').checked;
	const notifyTournamentEnd = document.getElementById('wizardNotifyTournamentEnd').checked;

	console.log('Tournament name:', name);
	console.log('Tournament type:', tournamentType);
	console.log('Game:', gameName);

	const btn = document.getElementById('wizardCreateBtn');
	btn.disabled = true;
	btn.textContent = 'Creating...';

	try {
		const payload = {
			// Basic info
			name,
			gameName: gameName || null,
			description,
			tournamentType,

			// Schedule
			startAt: startAt || null,
			checkInDuration: checkInDuration || null,
			signupCap: signupCap || null,

			// Format-specific options
			holdThirdPlaceMatch,
			grandFinalsModifier: grandFinalsModifier || null,

			// Round Robin options
			rrIterations: parseInt(rrIterations) || 1,
			rankedBy,
			rrMatchWin: parseFloat(rrMatchWin),
			rrMatchTie: parseFloat(rrMatchTie),
			rrGameWin: parseFloat(rrGameWin),
			rrGameTie: parseFloat(rrGameTie),

			// Swiss options
			swissRounds: swissRounds ? parseInt(swissRounds) : null,
			swissMatchWin: parseFloat(swissMatchWin),
			swissMatchTie: parseFloat(swissMatchTie),
			swissBye: parseFloat(swissBye),
			swissGameWin: parseFloat(swissGameWin),
			swissGameTie: parseFloat(swissGameTie),

			// Seeding & Display
			hideSeeds,
			sequentialPairings,
			showRounds,

			// Station options
			autoAssign,

			// Group Stage (for elimination formats only)
			groupStageEnabled,
			groupStageOptions: groupStageEnabled ? {
				stageType: groupStageType,
				groupSize: parseInt(groupSize),
				participantCountToAdvance: parseInt(groupAdvance),
				rankedBy: groupRankedBy
			} : null,

			// Registration & Privacy
			openSignup,
			privateTournament,
			hideForum,

			// Match Settings
			acceptAttachments,
			// Note: quickAdvance not supported by Challonge v2.1 API

			// Notifications
			notifyMatchOpen,
			notifyTournamentEnd
		};

		console.log('Sending payload:', JSON.stringify(payload, null, 2));

		const response = await csrfFetch('/api/tournaments/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		console.log('Response status:', response.status);

		const data = await response.json();
		console.log('Response data:', JSON.stringify(data, null, 2));

		if (data.success) {
			console.log('SUCCESS: Tournament created');

			// Store payload for potential template save
			storeTournamentData(payload);

			// Show success with option to save as template
			const saveTemplate = confirm(
				`Tournament "${name}" created successfully!\n\nWould you like to save these settings as a template for future tournaments?`
			);

			if (saveTemplate) {
				closeCreateWizard();
				openSaveTemplateModal();
			} else {
				showAlert(`Tournament "${name}" created successfully!`, 'success');
				closeCreateWizard();
				lastCreatedTournamentData = null;
			}

			await refreshTournaments();

			// Auto-select the new tournament
			if (data.tournament?.tournamentId) {
				console.log('Auto-selecting tournament:', data.tournament.tournamentId);
				setTimeout(() => {
					const newTournamentItem = document.querySelector(`[onclick*="${data.tournament.tournamentId}"]`);
					if (newTournamentItem) {
						newTournamentItem.click();
					}
				}, 500);
			}
		} else {
			console.error('FAILED:', data.error);
			showAlert(`Failed to create tournament: ${data.error}`, 'error');
		}
	} catch (error) {
		console.error('EXCEPTION:', error);
		showAlert(`Error: ${error.message}`, 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Create Tournament';
	}
}

// ==========================================
// Edit Tournament Modal
// ==========================================

// Open edit modal and load tournament details
async function openEditModal(tournamentId) {
	console.log('Opening edit modal for:', tournamentId);

	// Show modal with loading state
	document.getElementById('editTournamentModal').classList.remove('hidden');
	document.getElementById('saveEditBtn').disabled = true;

	try {
		// Use forWrite=true to bypass cache and get fresh data for editing
		const response = await fetch(`/api/tournament/${tournamentId}?forWrite=true`);
		if (!response.ok) {
			if (response.status === 401) {
				window.location.href = '/login.html';
				return;
			}
			throw new Error(`HTTP ${response.status}`);
		}

		const data = await response.json();
		if (!data.success) {
			throw new Error(data.error || 'Failed to load tournament');
		}

		editingTournament = data.tournament;
		// Store version for optimistic locking (from header or data)
		editingVersion = response.headers.get('X-Tournament-Version') ||
			data._cache?.version ||
			data.tournament.updatedAt ||
			null;
		console.log('[Edit Modal] Loaded tournament with version:', editingVersion);

		populateEditForm(editingTournament);
		document.getElementById('saveEditBtn').disabled = false;

	} catch (error) {
		console.error('Failed to load tournament:', error);
		showAlert(`Failed to load tournament: ${error.message}`, 'error');
		closeEditModal();
	}
}

// Populate the edit form with tournament data
function populateEditForm(tournament) {
	// Basic info
	document.getElementById('editName').value = tournament.name || '';
	document.getElementById('editGame').value = tournament.game || '';
	document.getElementById('editDescription').value = tournament.description || '';

	// Schedule
	if (tournament.startAt) {
		// Convert UTC date to Central Time for display
		const date = new Date(tournament.startAt);
		// Format in Central Time (America/Chicago handles DST automatically)
		const centralTime = date.toLocaleString('en-US', {
			timeZone: 'America/Chicago',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
		// Convert "MM/DD/YYYY, HH:mm" to "YYYY-MM-DDTHH:mm" for datetime-local input
		const [datePart, timePart] = centralTime.split(', ');
		const [month, day, year] = datePart.split('/');
		const localDateTime = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}`;
		document.getElementById('editStartAt').value = localDateTime;
	} else {
		document.getElementById('editStartAt').value = '';
	}

	document.getElementById('editCheckIn').value = tournament.checkInDuration || '';

	// Registration
	document.getElementById('editSignupCap').value = tournament.signupCap || '';
	document.getElementById('editOpenSignup').checked = tournament.openSignup || false;

	// Format display
	document.getElementById('editFormatDisplay').textContent = formatTournamentType(tournament.tournamentType);
	document.getElementById('editTournamentState').textContent = `State: ${tournament.state}`;

	// Hide all format-specific option sections first
	document.getElementById('editSingleElimOptions').classList.add('hidden');
	document.getElementById('editDoubleElimOptions').classList.add('hidden');
	document.getElementById('editRoundRobinOptions').classList.add('hidden');
	document.getElementById('editSwissOptions').classList.add('hidden');
	document.getElementById('editElimOptions').classList.add('hidden');

	// Show/populate format-specific options based on tournament type
	const tournamentType = tournament.tournamentType;

	if (tournamentType === 'single elimination') {
		document.getElementById('editSingleElimOptions').classList.remove('hidden');
		document.getElementById('editElimOptions').classList.remove('hidden');
		document.getElementById('editThirdPlace').checked = tournament.holdThirdPlaceMatch || false;
		document.getElementById('editSequentialPairings').checked = tournament.sequentialPairings || false;
		document.getElementById('editShowRounds').checked = tournament.showRounds || false;
	} else if (tournamentType === 'double elimination') {
		document.getElementById('editDoubleElimOptions').classList.remove('hidden');
		document.getElementById('editElimOptions').classList.remove('hidden');
		document.getElementById('editGrandFinals').value = tournament.grandFinalsModifier || '';
		document.getElementById('editSequentialPairings').checked = tournament.sequentialPairings || false;
		document.getElementById('editShowRounds').checked = tournament.showRounds || false;
	} else if (tournamentType === 'round robin') {
		document.getElementById('editRoundRobinOptions').classList.remove('hidden');
		document.getElementById('editRankedBy').value = tournament.rankedBy || 'match wins';

		// Show/hide custom points based on ranking method
		const isCustom = tournament.rankedBy === 'custom';
		document.getElementById('editRrCustomPoints').classList.toggle('hidden', !isCustom);

		if (isCustom) {
			document.getElementById('editRrMatchWin').value = tournament.rrPtsForMatchWin ?? 1.0;
			document.getElementById('editRrMatchTie').value = tournament.rrPtsForMatchTie ?? 0.5;
			document.getElementById('editRrGameWin').value = tournament.rrPtsForGameWin ?? 0;
			document.getElementById('editRrGameTie').value = tournament.rrPtsForGameTie ?? 0;
		}
	} else if (tournamentType === 'swiss') {
		document.getElementById('editSwissOptions').classList.remove('hidden');
		document.getElementById('editSwissRounds').value = tournament.swissRounds || '';
		document.getElementById('editSwissMatchWin').value = tournament.ptsForMatchWin ?? 1.0;
		document.getElementById('editSwissMatchTie').value = tournament.ptsForMatchTie ?? 0.5;
		document.getElementById('editSwissBye').value = tournament.ptsForBye ?? 1.0;
		document.getElementById('editSwissGameWin').value = tournament.ptsForGameWin ?? 0;
		document.getElementById('editSwissGameTie').value = tournament.ptsForGameTie ?? 0;
	}

	// Group Stage (only for elimination tournaments)
	const groupStageSection = document.getElementById('editGroupStageSection');
	if (tournamentType === 'single elimination' || tournamentType === 'double elimination') {
		groupStageSection.classList.remove('hidden');
		document.getElementById('editGroupStageEnabled').checked = tournament.groupStageEnabled || false;

		// Populate group stage options
		if (tournament.groupStageOptions) {
			document.getElementById('editGroupSize').value = tournament.groupStageOptions.groupSize || '4';
			document.getElementById('editGroupAdvance').value = tournament.groupStageOptions.participantCountToAdvance || '2';
			document.getElementById('editGroupStageType').value = tournament.groupStageOptions.stageType || 'round robin';
			document.getElementById('editGroupRankedBy').value = tournament.groupStageOptions.rankedBy || 'match wins';
		}

		// Show/hide options based on whether group stage is enabled
		toggleGroupStageOptions();
	} else {
		groupStageSection.classList.add('hidden');
	}

	// Display & Privacy
	document.getElementById('editHideSeeds').checked = tournament.hideSeeds || false;
	document.getElementById('editPrivate').checked = tournament.privateTournament || false;
	document.getElementById('editHideForum').checked = tournament.hideForum || false;

	// Match Settings
	document.getElementById('editAcceptAttachments').checked = tournament.acceptAttachments || false;
	// Note: Quick Advance is not supported by Challonge v2.1 API

	// Challonge link
	const challongeLink = document.getElementById('editChallongeLink');
	if (tournament.url) {
		challongeLink.href = tournament.url;
		challongeLink.textContent = tournament.url;
	} else {
		challongeLink.href = '#';
		challongeLink.textContent = '--';
	}

	// Setup event listener for ranking method dropdown
	setupEditModalEventListeners();
}

// Setup event listeners for the edit modal
function setupEditModalEventListeners() {
	const rankedBySelect = document.getElementById('editRankedBy');
	if (rankedBySelect) {
		// Remove existing listener to avoid duplicates
		rankedBySelect.removeEventListener('change', handleRankedByChange);
		rankedBySelect.addEventListener('change', handleRankedByChange);
	}
}

// Handle ranked by dropdown change
function handleRankedByChange() {
	const rankedBySelect = document.getElementById('editRankedBy');
	const rrCustomPoints = document.getElementById('editRrCustomPoints');
	rrCustomPoints.classList.toggle('hidden', rankedBySelect.value !== 'custom');
}

// Toggle group stage options visibility (edit modal)
function toggleGroupStageOptions() {
	const enabled = document.getElementById('editGroupStageEnabled').checked;
	const optionsDiv = document.getElementById('editGroupStageOptions');
	optionsDiv.classList.toggle('hidden', !enabled);
}

// Toggle group stage options visibility (creation wizard)
function toggleWizardGroupStageOptions() {
	const enabled = document.getElementById('wizardGroupStageEnabled').checked;
	const optionsDiv = document.getElementById('wizardGroupStageOptions');
	optionsDiv.classList.toggle('hidden', !enabled);
}

// Close the edit modal
function closeEditModal() {
	document.getElementById('editTournamentModal').classList.add('hidden');
	editingTournament = null;
	editingVersion = null;
}

// Save tournament edits
async function saveTournamentEdit() {
	if (!editingTournament) return;

	const name = document.getElementById('editName').value.trim();
	if (!name) {
		showAlert('Tournament name is required', 'warning');
		return;
	}

	const btn = document.getElementById('saveEditBtn');
	btn.disabled = true;
	btn.textContent = 'Saving...';

	// Convert datetime-local (Central Time) to ISO string (UTC)
	const startAtValue = document.getElementById('editStartAt').value;
	let startAtISO = null;
	if (startAtValue) {
		// datetime-local gives us YYYY-MM-DDTHH:mm - user entered in Central Time
		// Append the Central Time offset and let JavaScript parse it correctly
		const [datePart, timePart] = startAtValue.split('T');
		const [year, month, day] = datePart.split('-').map(Number);

		// Determine if DST is in effect for Central Time on this date
		// CST = UTC-6, CDT = UTC-5
		// DST: Second Sunday of March to First Sunday of November
		const isDST = (() => {
			if (month > 3 && month < 11) return true;  // Apr-Oct: DST
			if (month < 3 || month > 11) return false; // Jan-Feb, Dec: no DST
			// March: DST starts second Sunday
			if (month === 3) {
				const marchFirst = new Date(year, 2, 1);
				const secondSunday = 8 + ((7 - marchFirst.getDay()) % 7);
				return day >= secondSunday;
			}
			// November: DST ends first Sunday
			if (month === 11) {
				const novFirst = new Date(year, 10, 1);
				const firstSunday = 1 + ((7 - novFirst.getDay()) % 7);
				return day < firstSunday;
			}
			return false;
		})();

		const offset = isDST ? '-05:00' : '-06:00';
		const dateWithTZ = `${startAtValue}:00${offset}`;
		startAtISO = new Date(dateWithTZ).toISOString();
		console.log('[Tournament Edit] Converting Central Time:', startAtValue, `(${isDST ? 'CDT' : 'CST'})`, '-> UTC:', startAtISO);
	}

	// Build payload with all fields
	// IMPORTANT: Always send values (use original if field is empty) to prevent Challonge from resetting them
	const checkInValue = document.getElementById('editCheckIn').value;
	const signupCapValue = document.getElementById('editSignupCap').value;

	const payload = {
		// Basic info
		name,
		description: document.getElementById('editDescription').value.trim(),
		gameName: document.getElementById('editGame').value.trim() || editingTournament.game || null,

		// Schedule - preserve original if field is empty
		startAt: startAtISO || editingTournament.startAt || null,
		// Preserve original values if field is empty (prevents Challonge from resetting)
		checkInDuration: checkInValue !== '' ? parseInt(checkInValue) : (editingTournament.checkInDuration || null),

		// Registration
		signupCap: signupCapValue !== '' ? parseInt(signupCapValue) : (editingTournament.signupCap || null),
		openSignup: document.getElementById('editOpenSignup').checked,

		// Display & Privacy
		hideSeeds: document.getElementById('editHideSeeds').checked,
		privateTournament: document.getElementById('editPrivate').checked,
		hideForum: document.getElementById('editHideForum').checked,

		// Match Settings
		acceptAttachments: document.getElementById('editAcceptAttachments').checked,

		// Notifications - preserve original values
		notifyMatchOpen: editingTournament.notifyMatchOpen || false,
		notifyTournamentEnd: editingTournament.notifyTournamentEnd || false
		// Note: quickAdvance is not supported by Challonge v2.1 API
	};

	// Add format-specific options based on tournament type
	// IMPORTANT: Always include these fields with appropriate values to prevent Challonge from resetting them
	const tournamentType = editingTournament.tournamentType;

	if (tournamentType === 'single elimination') {
		// Use form value, fallback to original value if form element doesn't exist
		const thirdPlaceEl = document.getElementById('editThirdPlace');
		const seqPairingsEl = document.getElementById('editSequentialPairings');
		const showRoundsEl = document.getElementById('editShowRounds');

		payload.holdThirdPlaceMatch = thirdPlaceEl ? thirdPlaceEl.checked : (editingTournament.holdThirdPlaceMatch || false);
		payload.sequentialPairings = seqPairingsEl ? seqPairingsEl.checked : (editingTournament.sequentialPairings || false);
		payload.showRounds = showRoundsEl ? showRoundsEl.checked : (editingTournament.showRounds || false);
	} else if (tournamentType === 'double elimination') {
		const grandFinalsEl = document.getElementById('editGrandFinals');
		const seqPairingsEl = document.getElementById('editSequentialPairings');
		const showRoundsEl = document.getElementById('editShowRounds');

		payload.grandFinalsModifier = grandFinalsEl?.value || editingTournament.grandFinalsModifier || null;
		payload.sequentialPairings = seqPairingsEl ? seqPairingsEl.checked : (editingTournament.sequentialPairings || false);
		payload.showRounds = showRoundsEl ? showRoundsEl.checked : (editingTournament.showRounds || false);
	} else if (tournamentType === 'round robin') {
		const rankedByEl = document.getElementById('editRankedBy');
		payload.rankedBy = rankedByEl?.value || editingTournament.rankedBy || 'match wins';

		// Include custom points if ranking method is custom - preserve original values
		if (payload.rankedBy === 'custom') {
			const rrMatchWinEl = document.getElementById('editRrMatchWin');
			const rrMatchTieEl = document.getElementById('editRrMatchTie');
			const rrGameWinEl = document.getElementById('editRrGameWin');
			const rrGameTieEl = document.getElementById('editRrGameTie');

			payload.rrPtsForMatchWin = rrMatchWinEl?.value !== '' ? parseFloat(rrMatchWinEl.value) : (editingTournament.rrPtsForMatchWin ?? 1.0);
			payload.rrPtsForMatchTie = rrMatchTieEl?.value !== '' ? parseFloat(rrMatchTieEl.value) : (editingTournament.rrPtsForMatchTie ?? 0.5);
			payload.rrPtsForGameWin = rrGameWinEl?.value !== '' ? parseFloat(rrGameWinEl.value) : (editingTournament.rrPtsForGameWin ?? 0);
			payload.rrPtsForGameTie = rrGameTieEl?.value !== '' ? parseFloat(rrGameTieEl.value) : (editingTournament.rrPtsForGameTie ?? 0);
		}
	} else if (tournamentType === 'swiss') {
		const swissRoundsEl = document.getElementById('editSwissRounds');
		const swissRounds = swissRoundsEl?.value;

		// Preserve original swiss rounds if not specified
		if (swissRounds) {
			payload.swissRounds = parseInt(swissRounds);
		} else if (editingTournament.swissRounds) {
			payload.swissRounds = editingTournament.swissRounds;
		}

		const swissMatchWinEl = document.getElementById('editSwissMatchWin');
		const swissMatchTieEl = document.getElementById('editSwissMatchTie');
		const swissByeEl = document.getElementById('editSwissBye');
		const swissGameWinEl = document.getElementById('editSwissGameWin');
		const swissGameTieEl = document.getElementById('editSwissGameTie');

		payload.ptsForMatchWin = swissMatchWinEl?.value !== '' ? parseFloat(swissMatchWinEl.value) : (editingTournament.ptsForMatchWin ?? 1.0);
		payload.ptsForMatchTie = swissMatchTieEl?.value !== '' ? parseFloat(swissMatchTieEl.value) : (editingTournament.ptsForMatchTie ?? 0.5);
		payload.ptsForBye = swissByeEl?.value !== '' ? parseFloat(swissByeEl.value) : (editingTournament.ptsForBye ?? 1.0);
		payload.ptsForGameWin = swissGameWinEl?.value !== '' ? parseFloat(swissGameWinEl.value) : (editingTournament.ptsForGameWin ?? 0);
		payload.ptsForGameTie = swissGameTieEl?.value !== '' ? parseFloat(swissGameTieEl.value) : (editingTournament.ptsForGameTie ?? 0);
	}

	// Group Stage options (for elimination tournaments only)
	// IMPORTANT: Preserve original values if not changed
	if (tournamentType === 'single elimination' || tournamentType === 'double elimination') {
		const groupStageEnabledEl = document.getElementById('editGroupStageEnabled');
		payload.groupStageEnabled = groupStageEnabledEl ? groupStageEnabledEl.checked : (editingTournament.groupStageEnabled || false);

		if (payload.groupStageEnabled) {
			const origOpts = editingTournament.groupStageOptions || {};
			payload.groupStageOptions = {
				stageType: document.getElementById('editGroupStageType')?.value || origOpts.stageType || 'round robin',
				groupSize: parseInt(document.getElementById('editGroupSize')?.value) || origOpts.groupSize || 4,
				participantCountToAdvance: parseInt(document.getElementById('editGroupAdvance')?.value) || origOpts.participantCountToAdvance || 2,
				rankedBy: document.getElementById('editGroupRankedBy')?.value || origOpts.rankedBy || 'match wins'
			};
		} else if (editingTournament.groupStageOptions) {
			// Preserve original group stage options even when disabled
			payload.groupStageOptions = editingTournament.groupStageOptions;
		}
	}

	console.log('[Tournament Edit] Saving payload:', JSON.stringify(payload, null, 2));
	console.log('[Tournament Edit] Version:', editingVersion);

	try {
		// Build headers with version for optimistic locking
		const headers = { 'Content-Type': 'application/json' };
		if (editingVersion) {
			headers['X-Tournament-Version'] = editingVersion;
		}

		const response = await csrfFetch(`/api/tournament/${editingTournament.tournamentId}`, {
			method: 'PUT',
			headers,
			body: JSON.stringify(payload)
		});

		const data = await response.json();

		// Handle version conflict (409)
		if (response.status === 409 && data.conflict) {
			console.log('[Tournament Edit] Version conflict detected:', data);
			showConflictModal(data);
			return;
		}

		if (data.success) {
			showAlert('Tournament updated successfully!', 'success');

			// Save tournament ID before closing modal (closeEditModal sets editingTournament to null)
			const editedTournamentId = editingTournament.tournamentId;
			closeEditModal();
			await refreshTournaments();

			// Re-select if this was the selected tournament
			if (selectedTournament?.tournamentId === editedTournamentId) {
				selectedTournament = data.tournament;
				document.getElementById('selectedName').textContent = data.tournament.name;
				document.getElementById('selectedGame').textContent = data.tournament.game;
			}
		} else {
			showAlert(`Failed to update: ${data.error}`, 'error');
		}
	} catch (error) {
		console.error('Save tournament error:', error);
		showAlert(`Error: ${error.message}`, 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Save Changes';
	}
}

// Show conflict resolution modal
function showConflictModal(conflictData) {
	const modal = document.getElementById('conflictModal');
	if (!modal) {
		// Fallback if modal doesn't exist - show alert with options
		const reload = confirm(
			`Conflict: ${conflictData.message}\n\n` +
			`The tournament was modified since you opened it.\n\n` +
			`Click OK to reload the latest data and discard your changes,\n` +
			`or Cancel to go back and try again.`
		);
		if (reload) {
			// Reload the edit modal with fresh data
			const tournamentId = editingTournament.tournamentId;
			closeEditModal();
			openEditModal(tournamentId);
		}
		return;
	}

	// Show the conflict modal with details
	document.getElementById('conflictMessage').textContent = conflictData.message;
	modal.classList.remove('hidden');
}

// Handle conflict: reload fresh data
function conflictReload() {
	const tournamentId = editingTournament.tournamentId;
	document.getElementById('conflictModal')?.classList.add('hidden');
	closeEditModal();
	openEditModal(tournamentId);
}

// Handle conflict: force overwrite
async function conflictOverwrite() {
	document.getElementById('conflictModal')?.classList.add('hidden');

	// Clear version to skip optimistic locking
	editingVersion = null;

	// Retry save without version check
	const btn = document.getElementById('saveEditBtn');
	btn.disabled = true;
	btn.textContent = 'Saving...';
	await saveTournamentEdit();
}

// Handle conflict: cancel
function conflictCancel() {
	document.getElementById('conflictModal')?.classList.add('hidden');
}

// ============================================
// EXPORT FUNCTIONS - Tournament Results Export
// ============================================

async function exportStandingsCSV() {
	if (!selectedTournament) {
		showAlert('No tournament selected', 'warning');
		return;
	}

	try {
		const response = await fetch(`/api/export/${selectedTournament.tournamentId}/standings/csv?source=live`);
		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.error || 'Export failed');
		}

		const blob = await response.blob();
		const contentDisposition = response.headers.get('Content-Disposition');
		const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
		const filename = filenameMatch ? filenameMatch[1] : `${selectedTournament.name.replace(/[^a-z0-9]/gi, '_')}_standings.csv`;

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

async function exportMatchesCSV() {
	if (!selectedTournament) {
		showAlert('No tournament selected', 'warning');
		return;
	}

	try {
		const response = await fetch(`/api/export/${selectedTournament.tournamentId}/matches/csv?source=live`);
		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.error || 'Export failed');
		}

		const blob = await response.blob();
		const contentDisposition = response.headers.get('Content-Disposition');
		const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
		const filename = filenameMatch ? filenameMatch[1] : `${selectedTournament.name.replace(/[^a-z0-9]/gi, '_')}_matches.csv`;

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

async function exportPDF() {
	if (!selectedTournament) {
		showAlert('No tournament selected', 'warning');
		return;
	}

	try {
		showAlert('Generating PDF report...', 'info', 2000);

		const response = await fetch(`/api/export/${selectedTournament.tournamentId}/report/pdf?source=live`);
		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.error || 'Export failed');
		}

		const blob = await response.blob();
		const contentDisposition = response.headers.get('Content-Disposition');
		const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
		const filename = filenameMatch ? filenameMatch[1] : `${selectedTournament.name.replace(/[^a-z0-9]/gi, '_')}_results.pdf`;

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

// ==========================================
// Tournament Templates
// ==========================================

let lastCreatedTournamentData = null;

// Load templates into dropdown
async function loadTemplates() {
	try {
		const response = await fetch('/api/templates');
		const data = await response.json();

		const select = document.getElementById('wizardTemplateSelect');
		if (!select) return;

		// Clear existing options except the first
		while (select.options.length > 1) {
			select.remove(1);
		}

		if (data.success && data.templates) {
			data.templates.forEach(template => {
				const option = document.createElement('option');
				option.value = template.id;
				option.textContent = template.name;
				if (template.gameName) {
					option.textContent += ` (${template.gameName})`;
				}
				if (template.isDefault) {
					option.textContent += ' [Default]';
				}
				select.appendChild(option);
			});
		}
	} catch (error) {
		console.error('Error loading templates:', error);
	}
}

// Refresh templates list
async function refreshTemplates() {
	await loadTemplates();
	showAlert('Templates refreshed', 'info', 2000);
}

// Apply template to wizard
async function applyTemplate(templateId) {
	if (!templateId) {
		// Reset wizard to defaults when "Start Fresh" is selected
		resetWizardForm();
		return;
	}

	try {
		const response = await fetch(`/api/templates/${templateId}`);
		const data = await response.json();

		if (!data.success || !data.template) {
			showAlert('Failed to load template', 'error');
			return;
		}

		const template = data.template;
		const settings = template.settings;

		// Apply game name
		if (settings.gameName) {
			document.getElementById('wizardGame').value = settings.gameName;
		}

		// Apply tournament type
		if (settings.tournamentType) {
			const typeRadio = document.querySelector(`input[name="tournamentType"][value="${settings.tournamentType}"]`);
			if (typeRadio) {
				typeRadio.checked = true;
				typeRadio.dispatchEvent(new Event('change'));
				// Update format selection visuals
				setTimeout(() => updateFormatSelection(), 50);
			}
		}

		// Apply Single Elim options
		if (settings.holdThirdPlaceMatch !== undefined) {
			document.getElementById('wizardThirdPlace').checked = settings.holdThirdPlaceMatch;
		}

		// Apply Double Elim options
		if (settings.grandFinalsModifier) {
			document.getElementById('wizardGrandFinals').value = settings.grandFinalsModifier;
		}

		// Apply Round Robin options
		if (settings.rrIterations) {
			document.getElementById('wizardRrIterations').value = settings.rrIterations;
		}
		if (settings.rankedBy) {
			document.getElementById('wizardRankedBy').value = settings.rankedBy;
			// Trigger custom points visibility
			document.getElementById('wizardRankedBy').dispatchEvent(new Event('change'));
		}
		if (settings.rrMatchWin !== undefined) document.getElementById('wizardRrMatchWin').value = settings.rrMatchWin;
		if (settings.rrMatchTie !== undefined) document.getElementById('wizardRrMatchTie').value = settings.rrMatchTie;
		if (settings.rrGameWin !== undefined) document.getElementById('wizardRrGameWin').value = settings.rrGameWin;
		if (settings.rrGameTie !== undefined) document.getElementById('wizardRrGameTie').value = settings.rrGameTie;

		// Apply Swiss options
		if (settings.swissRounds) document.getElementById('wizardSwissRounds').value = settings.swissRounds;
		if (settings.swissMatchWin !== undefined) document.getElementById('wizardSwissMatchWin').value = settings.swissMatchWin;
		if (settings.swissMatchTie !== undefined) document.getElementById('wizardSwissMatchTie').value = settings.swissMatchTie;
		if (settings.swissBye !== undefined) document.getElementById('wizardSwissBye').value = settings.swissBye;
		if (settings.swissGameWin !== undefined) document.getElementById('wizardSwissGameWin').value = settings.swissGameWin;
		if (settings.swissGameTie !== undefined) document.getElementById('wizardSwissGameTie').value = settings.swissGameTie;

		// Apply Seeding & Display options
		if (settings.hideSeeds !== undefined) document.getElementById('wizardHideSeeds').checked = settings.hideSeeds;
		if (settings.sequentialPairings !== undefined) document.getElementById('wizardSequentialPairings').checked = settings.sequentialPairings;
		if (settings.showRounds !== undefined) document.getElementById('wizardShowRounds').checked = settings.showRounds;

		// Apply Station options
		if (settings.autoAssign !== undefined) document.getElementById('wizardAutoAssign').checked = settings.autoAssign;

		// Apply Group Stage options
		if (settings.groupStageEnabled !== undefined) {
			document.getElementById('wizardGroupStageEnabled').checked = settings.groupStageEnabled;
			toggleWizardGroupStageOptions();
		}
		if (settings.groupStageOptions) {
			if (settings.groupStageOptions.stageType) document.getElementById('wizardGroupStageType').value = settings.groupStageOptions.stageType;
			if (settings.groupStageOptions.groupSize) document.getElementById('wizardGroupSize').value = settings.groupStageOptions.groupSize;
			if (settings.groupStageOptions.participantCountToAdvance) document.getElementById('wizardGroupAdvance').value = settings.groupStageOptions.participantCountToAdvance;
			if (settings.groupStageOptions.rankedBy) document.getElementById('wizardGroupRankedBy').value = settings.groupStageOptions.rankedBy;
		}

		// Apply Registration options
		if (settings.checkInDuration) document.getElementById('wizardCheckIn').value = settings.checkInDuration;
		if (settings.signupCap) document.getElementById('wizardSignupCap').value = settings.signupCap;
		if (settings.openSignup !== undefined) document.getElementById('wizardOpenSignup').checked = settings.openSignup;

		// Apply Privacy options
		if (settings.privateTournament !== undefined) document.getElementById('wizardPrivate').checked = settings.privateTournament;
		if (settings.hideForum !== undefined) document.getElementById('wizardHideForum').checked = settings.hideForum;

		// Apply Match options
		if (settings.acceptAttachments !== undefined) document.getElementById('wizardAcceptAttachments').checked = settings.acceptAttachments;
		if (settings.quickAdvance !== undefined && document.getElementById('wizardQuickAdvance')) {
			document.getElementById('wizardQuickAdvance').checked = settings.quickAdvance;
		}

		// Apply Notification options
		if (settings.notifyMatchOpen !== undefined) document.getElementById('wizardNotifyMatchOpen').checked = settings.notifyMatchOpen;
		if (settings.notifyTournamentEnd !== undefined) document.getElementById('wizardNotifyTournamentEnd').checked = settings.notifyTournamentEnd;

		showAlert(`Template "${template.name}" applied`, 'success', 2000);
	} catch (error) {
		console.error('Error applying template:', error);
		showAlert('Failed to apply template', 'error');
	}
}

// Store tournament data for saving as template
function storeTournamentData(payload) {
	lastCreatedTournamentData = { ...payload };
}

// Open save template modal
function openSaveTemplateModal() {
	document.getElementById('saveTemplateName').value = '';
	document.getElementById('saveTemplateDesc').value = '';
	document.getElementById('saveTemplateModal').classList.remove('hidden');
	document.getElementById('saveTemplateName').focus();
}

// Close save template modal
function closeSaveTemplateModal() {
	document.getElementById('saveTemplateModal').classList.add('hidden');
	lastCreatedTournamentData = null;
}

// Save current settings as template
async function saveAsTemplate() {
	const templateName = document.getElementById('saveTemplateName').value.trim();
	const description = document.getElementById('saveTemplateDesc').value.trim();

	if (!templateName) {
		showAlert('Template name is required', 'error');
		return;
	}

	if (!lastCreatedTournamentData) {
		showAlert('No tournament data to save', 'error');
		closeSaveTemplateModal();
		return;
	}

	const btn = document.getElementById('saveTemplateBtn');
	btn.disabled = true;
	btn.textContent = 'Saving...';

	try {
		const response = await csrfFetch('/api/templates/from-tournament', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				tournamentData: lastCreatedTournamentData,
				templateName,
				description
			})
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Template "${templateName}" saved successfully!`, 'success');
			closeSaveTemplateModal();
			await loadTemplates(); // Refresh templates dropdown
		} else {
			showAlert(`Failed to save template: ${data.error}`, 'error');
		}
	} catch (error) {
		console.error('Error saving template:', error);
		showAlert(`Error saving template: ${error.message}`, 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Save Template';
	}
}

// ==========================================
// Pre-Flight Checklist
// ==========================================

let checklistState = {
	displays: null,
	piDisplays: null,
	deployed: null,
	participants: null,
	flyer: null,
	stations: null,
	api: null
};

// Refresh all checklist items
async function refreshChecklist() {
	if (!selectedTournament) return;

	// Reset state
	Object.keys(checklistState).forEach(key => {
		checklistState[key] = null;
		updateChecklistItem(key, 'pending', 'Checking...');
	});

	// Run all checks in parallel
	await Promise.all([
		checkDisplayModules(),
		checkPiDisplays(),
		checkTournamentDeployed(),
		checkParticipants(),
		checkFlyer(),
		checkStations(),
		checkChallongeApi()
	]);

	// Update progress and banners
	updateChecklistSummary();
}

// Check display modules are online
async function checkDisplayModules() {
	try {
		const response = await fetch('/api/status');
		if (!response.ok) throw new Error('Failed to fetch status');

		const data = await response.json();
		if (!data.success) throw new Error('Status check failed');

		const match = data.modules?.match?.online;
		const bracket = data.modules?.bracket?.online;
		const flyer = data.modules?.flyer?.online;

		const onlineCount = [match, bracket, flyer].filter(Boolean).length;

		if (onlineCount === 3) {
			checklistState.displays = 'success';
			updateChecklistItem('displays', 'success', 'All 3 modules online');
		} else if (onlineCount > 0) {
			checklistState.displays = 'warning';
			updateChecklistItem('displays', 'warning', `${onlineCount}/3 modules online`);
		} else {
			checklistState.displays = 'error';
			updateChecklistItem('displays', 'error', 'No modules online');
		}
	} catch (error) {
		console.error('Display check error:', error);
		checklistState.displays = 'error';
		updateChecklistItem('displays', 'error', 'Check failed');
	}
}

// Check Pi displays are connected
async function checkPiDisplays() {
	try {
		const response = await fetch('/api/displays');
		if (!response.ok) throw new Error('Failed to fetch displays');

		const data = await response.json();
		if (!data.success) throw new Error('Displays check failed');

		const displays = data.displays || [];
		const onlineDisplays = displays.filter(d => d.status === 'online');

		const descEl = document.getElementById('checkPiDescription');
		if (descEl) {
			descEl.textContent = `${onlineDisplays.length}/${displays.length} Pi display(s) connected`;
		}

		if (onlineDisplays.length >= 1) {
			checklistState.piDisplays = 'success';
			updateChecklistItem('pi-displays', 'success', `${onlineDisplays.length} online`);
		} else if (displays.length > 0) {
			checklistState.piDisplays = 'warning';
			updateChecklistItem('pi-displays', 'warning', 'All offline');
		} else {
			checklistState.piDisplays = 'warning';
			updateChecklistItem('pi-displays', 'warning', 'None registered');
		}
	} catch (error) {
		console.error('Pi displays check error:', error);
		checklistState.piDisplays = 'warning';
		updateChecklistItem('pi-displays', 'warning', 'Check failed');
	}
}

// Check tournament is deployed to displays
async function checkTournamentDeployed() {
	try {
		const response = await fetch('/api/status');
		if (!response.ok) throw new Error('Failed to fetch status');

		const data = await response.json();
		if (!data.success) throw new Error('Status check failed');

		// Check if match module has the selected tournament
		const matchState = data.modules?.match?.state;
		const isDeployed = matchState?.tournamentId === selectedTournament.tournamentId;

		if (isDeployed) {
			checklistState.deployed = 'success';
			updateChecklistItem('deployed', 'success', 'Deployed');
		} else {
			checklistState.deployed = 'warning';
			updateChecklistItem('deployed', 'warning', 'Not deployed');
		}
	} catch (error) {
		console.error('Deployed check error:', error);
		checklistState.deployed = 'warning';
		updateChecklistItem('deployed', 'warning', 'Check failed');
	}
}

// Check participants are registered
async function checkParticipants() {
	const count = selectedTournament?.participants || 0;
	const descEl = document.getElementById('checkParticipantsDescription');

	if (descEl) {
		descEl.textContent = `${count} participant(s) registered`;
	}

	if (count >= 2) {
		checklistState.participants = 'success';
		updateChecklistItem('participants', 'success', `${count} ready`);
	} else {
		checklistState.participants = 'error';
		updateChecklistItem('participants', 'error', `Need ${2 - count} more`);
	}
}

// Check flyer is configured
async function checkFlyer() {
	try {
		const response = await fetch('/api/status');
		if (!response.ok) throw new Error('Failed to fetch status');

		const data = await response.json();
		if (!data.success) throw new Error('Status check failed');

		const flyerState = data.modules?.flyer?.state;
		const activeFlyer = flyerState?.currentFlyer || flyerState?.flyer;

		const descEl = document.getElementById('checkFlyerDescription');

		if (activeFlyer) {
			if (descEl) descEl.textContent = `Active: ${activeFlyer}`;
			checklistState.flyer = 'success';
			updateChecklistItem('flyer', 'success', 'Set');
		} else {
			if (descEl) descEl.textContent = 'No flyer selected';
			checklistState.flyer = 'warning';
			updateChecklistItem('flyer', 'warning', 'Not set');
		}
	} catch (error) {
		console.error('Flyer check error:', error);
		checklistState.flyer = 'warning';
		updateChecklistItem('flyer', 'warning', 'Check failed');
	}
}

// Check stations are configured
async function checkStations() {
	try {
		const response = await fetch(`/api/stations/${selectedTournament.tournamentId}`);
		if (!response.ok) throw new Error('Failed to fetch stations');

		const data = await response.json();
		if (!data.success) throw new Error('Stations check failed');

		const stations = data.stations || [];
		const descEl = document.getElementById('checkStationsDescription');

		if (descEl) {
			descEl.textContent = `${stations.length} TV station(s) configured`;
		}

		if (stations.length >= 1) {
			checklistState.stations = 'success';
			updateChecklistItem('stations', 'success', `${stations.length} station(s)`);
		} else {
			checklistState.stations = 'warning';
			updateChecklistItem('stations', 'warning', 'None configured');
		}
	} catch (error) {
		console.error('Stations check error:', error);
		checklistState.stations = 'warning';
		updateChecklistItem('stations', 'warning', 'Check failed');
	}
}

// Check Challonge API connection
async function checkChallongeApi() {
	try {
		const response = await fetch('/api/test-connection');
		if (!response.ok) throw new Error('API connection failed');

		const data = await response.json();

		if (data.success) {
			checklistState.api = 'success';
			updateChecklistItem('api', 'success', 'Connected');
		} else {
			checklistState.api = 'error';
			updateChecklistItem('api', 'error', 'Connection failed');
		}
	} catch (error) {
		console.error('API check error:', error);
		checklistState.api = 'error';
		updateChecklistItem('api', 'error', 'Check failed');
	}
}

// Update a single checklist item UI
function updateChecklistItem(checkId, status, badgeText) {
	const item = document.querySelector(`.checklist-item[data-check="${checkId}"]`);
	const statusEl = document.getElementById(`check${capitalizeFirst(checkId.replace('-', ''))}Status`);

	if (item) {
		item.classList.remove('success', 'warning', 'error');
		if (status !== 'pending') {
			item.classList.add(status);
		}
	}

	if (statusEl) {
		const badge = statusEl.querySelector('.checklist-badge');
		if (badge) {
			badge.className = `checklist-badge ${status}`;
			badge.textContent = badgeText;
		}
	}
}

// Helper to capitalize first letter
function capitalizeFirst(str) {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

// Update checklist summary and banners
function updateChecklistSummary() {
	const states = Object.values(checklistState);
	const total = states.length;
	const successCount = states.filter(s => s === 'success').length;
	const errorCount = states.filter(s => s === 'error').length;

	// Update progress text
	const progressEl = document.getElementById('checklistProgress');
	if (progressEl) {
		progressEl.textContent = `${successCount}/${total} ready`;
	}

	// Show/hide banners
	const allClearBanner = document.getElementById('checklistAllClear');
	const issuesBanner = document.getElementById('checklistIssues');
	const issuesText = document.getElementById('checklistIssuesText');

	if (successCount === total) {
		// All checks passed
		if (allClearBanner) allClearBanner.classList.remove('hidden');
		if (issuesBanner) issuesBanner.classList.add('hidden');
	} else {
		// Some checks failed
		if (allClearBanner) allClearBanner.classList.add('hidden');
		if (issuesBanner) issuesBanner.classList.remove('hidden');

		// Build issues message
		const issues = [];
		if (checklistState.displays !== 'success') issues.push('display modules');
		if (checklistState.deployed !== 'success') issues.push('deployment');
		if (checklistState.participants !== 'success') issues.push('participants');
		if (checklistState.api !== 'success') issues.push('API connection');

		if (issuesText) {
			if (errorCount > 0) {
				issuesText.textContent = `${errorCount} critical item(s) need attention: ${issues.join(', ')}`;
			} else {
				issuesText.textContent = `${total - successCount} item(s) may need attention before starting.`;
			}
		}
	}
}

// Show/hide checklist section based on tournament state
function updateChecklistVisibility() {
	const checklistSection = document.getElementById('checklistSection');
	if (!checklistSection) return;

	// Show checklist only for pending tournaments
	if (selectedTournament && selectedTournament.state === 'pending') {
		checklistSection.classList.remove('hidden');
		refreshChecklist();
	} else {
		checklistSection.classList.add('hidden');
	}
}

// Export functions
window.refreshTournaments = refreshTournaments;
window.switchTab = switchTab;
window.selectTournament = selectTournament;
window.deployTournament = deployTournament;
window.startTournament = startTournament;
window.resetTournament = resetTournament;
window.finalizeTournament = finalizeTournament;
window.deleteTournament = deleteTournament;
window.completeTournament = completeTournament;
window.openCreateWizard = openCreateWizard;
window.closeCreateWizard = closeCreateWizard;
window.wizardNext = wizardNext;
window.wizardBack = wizardBack;
window.createTournament = createTournament;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.saveTournamentEdit = saveTournamentEdit;
window.toggleGroupStageOptions = toggleGroupStageOptions;
window.toggleWizardGroupStageOptions = toggleWizardGroupStageOptions;
window.exportStandingsCSV = exportStandingsCSV;
window.exportMatchesCSV = exportMatchesCSV;
window.exportPDF = exportPDF;
window.loadTemplates = loadTemplates;
window.refreshTemplates = refreshTemplates;
window.applyTemplate = applyTemplate;
window.openSaveTemplateModal = openSaveTemplateModal;
window.closeSaveTemplateModal = closeSaveTemplateModal;
window.saveAsTemplate = saveAsTemplate;
window.conflictReload = conflictReload;
window.conflictOverwrite = conflictOverwrite;
window.conflictCancel = conflictCancel;
window.refreshChecklist = refreshChecklist;
