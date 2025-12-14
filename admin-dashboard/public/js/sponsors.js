// Sponsor Management Page JavaScript

// State
let sponsors = [];
let sponsorConfig = {};
let deleteTarget = null;
let editTarget = null;
let currentFilter = 'all';
let statusRefreshInterval = null;
let currentUserId = null;  // Current user's ID for URL construction
let isSuperadminView = false;  // Whether viewing as superadmin

// Collapsible section state
const SECTION_STATE_KEY = 'sponsorsPageSections';
let sectionStates = {
	settings: true,
	upload: true,
	gallery: true
};

// Track if initial config has been loaded (to avoid overwriting unsaved changes)
let initialConfigLoaded = false;

// Load section states from localStorage
function loadSectionStates() {
	try {
		const saved = localStorage.getItem(SECTION_STATE_KEY);
		if (saved) {
			sectionStates = JSON.parse(saved);
		}
	} catch (e) {
		console.error('Failed to load section states:', e);
	}
}

// Save section states to localStorage
function saveSectionStates() {
	try {
		localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(sectionStates));
	} catch (e) {
		console.error('Failed to save section states:', e);
	}
}

// Toggle section visibility
function toggleSection(sectionId) {
	const content = document.getElementById(`${sectionId}Content`);
	const chevron = document.getElementById(`${sectionId}Chevron`);

	if (!content || !chevron) return;

	const isExpanded = !content.classList.contains('hidden');

	if (isExpanded) {
		// Collapse
		content.classList.add('hidden');
		chevron.style.transform = 'rotate(-90deg)';
		sectionStates[sectionId] = false;
	} else {
		// Expand
		content.classList.remove('hidden');
		chevron.style.transform = 'rotate(0deg)';
		sectionStates[sectionId] = true;
	}

	saveSectionStates();
}

// Apply saved section states on page load
function applySectionStates() {
	Object.keys(sectionStates).forEach(sectionId => {
		const content = document.getElementById(`${sectionId}Content`);
		const chevron = document.getElementById(`${sectionId}Chevron`);

		if (!content || !chevron) return;

		if (sectionStates[sectionId]) {
			// Expanded
			content.classList.remove('hidden');
			chevron.style.transform = 'rotate(0deg)';
		} else {
			// Collapsed
			content.classList.add('hidden');
			chevron.style.transform = 'rotate(-90deg)';
		}
	});
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
	// Load and apply section states
	loadSectionStates();
	applySectionStates();

	// Initialize last updated timestamp
	initLastUpdated('sponsorsLastUpdated', loadSponsors, { prefix: 'Updated', thresholds: { fresh: 30, stale: 120 } });

	// Setup form event listeners
	setupUploadForm();
	setupEditForm();
	setupSliders();
	setupPositionTypeHandler();

	// Load initial data
	await loadSponsors();

	// Start polling with visibility awareness
	startPolling();
	setupVisibilityHandler(
		() => { startPolling(); },
		() => { stopPolling(); }
	);
});

function startPolling() {
	if (!statusRefreshInterval) {
		statusRefreshInterval = setInterval(loadSponsors, 15000);
	}
}

function stopPolling() {
	if (statusRefreshInterval) {
		clearInterval(statusRefreshInterval);
		statusRefreshInterval = null;
	}
}

// Load sponsors from API
async function loadSponsors() {
	// Show loading state
	const btn = document.getElementById('refreshSponsorsBtn');
	const icon = document.getElementById('refreshSponsorsIcon');
	const text = document.getElementById('refreshSponsorsText');
	if (btn) btn.disabled = true;
	if (icon) icon.classList.add('animate-spin');
	if (text) text.textContent = 'Refreshing...';

	try {
		const response = await fetch('/api/sponsors');
		if (!response.ok) throw new Error('Failed to load sponsors');

		const data = await response.json();
		if (data.success) {
			sponsors = data.sponsors || [];
			sponsorConfig = data.config || {};
			currentUserId = data.currentUserId || null;
			isSuperadminView = data.isSuperadmin || false;
			// Only update config UI on initial load to avoid overwriting unsaved changes
			if (!initialConfigLoaded && sponsorConfig) {
				updateConfigUI();
				initialConfigLoaded = true;
			}
			renderGallery();
			document.getElementById('sponsorCount').textContent = `(${sponsors.length} sponsor${sponsors.length !== 1 ? 's' : ''})`;
			setLastUpdated('sponsorsLastUpdated');
		}
	} catch (error) {
		console.error('Failed to load sponsors:', error);
		showAlert('Failed to load sponsors', 'error');
	} finally {
		// Reset loading state
		if (btn) btn.disabled = false;
		if (icon) icon.classList.remove('animate-spin');
		if (text) text.textContent = 'Refresh';
	}
}

// Update config UI from loaded config
function updateConfigUI() {
	document.getElementById('masterToggle').checked = sponsorConfig.enabled || false;
	document.getElementById('rotationToggle').checked = sponsorConfig.rotationEnabled !== false;
	document.getElementById('rotationInterval').value = sponsorConfig.rotationInterval || 30;
	document.getElementById('rotationTransition').value = sponsorConfig.rotationTransition || 500;
	document.getElementById('rotationOrder').value = sponsorConfig.rotationOrder || 'sequential';
	document.getElementById('timerViewToggle').checked = sponsorConfig.timerViewEnabled || false;
	document.getElementById('timerShowDuration').value = sponsorConfig.timerShowDuration || 10;
	document.getElementById('timerHideDuration').value = sponsorConfig.timerHideDuration || 5;
	document.getElementById('displayMatch').checked = sponsorConfig.displays?.match !== false;
	document.getElementById('displayBracket').checked = sponsorConfig.displays?.bracket !== false;
}

// Setup sliders to show values
function setupSliders() {
	// Upload form sliders
	const sizeSlider = document.getElementById('sizeSlider');
	const sizeValue = document.getElementById('sizeValue');
	const opacitySlider = document.getElementById('opacitySlider');
	const opacityValue = document.getElementById('opacityValue');

	sizeSlider.addEventListener('input', () => {
		sizeValue.textContent = sizeSlider.value;
	});

	opacitySlider.addEventListener('input', () => {
		opacityValue.textContent = opacitySlider.value;
	});

	// Edit form sliders
	const editSizeSlider = document.getElementById('editSize');
	const editSizeValue = document.getElementById('editSizeValue');
	const editOpacitySlider = document.getElementById('editOpacity');
	const editOpacityValue = document.getElementById('editOpacityValue');

	editSizeSlider.addEventListener('input', () => {
		editSizeValue.textContent = editSizeSlider.value;
	});

	editOpacitySlider.addEventListener('input', () => {
		editOpacityValue.textContent = editOpacitySlider.value;
	});
}

// Setup position type handler to update position dropdown
function setupPositionTypeHandler() {
	const positionType = document.getElementById('positionType');
	const positionSelect = document.getElementById('positionSelect');

	if (!positionType || !positionSelect) {
		console.error('[Sponsors] Position type elements not found');
		return;
	}

	// Update options when type changes
	positionType.addEventListener('change', () => {
		updatePositionOptions(positionSelect, positionType.value);
	});

	// Set initial options based on current type selection
	updatePositionOptions(positionSelect, positionType.value);
}

// Update position dropdown based on type (called from HTML onchange)
function updatePositionDropdown(type) {
	const positionSelect = document.getElementById('positionSelect');
	if (!positionSelect) return;

	const cornerOptions = `
		<option value="top-left">Top Left</option>
		<option value="top-right">Top Right</option>
		<option value="bottom-left">Bottom Left</option>
		<option value="bottom-right">Bottom Right</option>
	`;

	const bannerOptions = `
		<option value="top-banner">Top Banner</option>
		<option value="bottom-banner">Bottom Banner</option>
	`;

	positionSelect.innerHTML = type === 'banner' ? bannerOptions : cornerOptions;
}

// Legacy function kept for compatibility
function updatePositionOptions(selectElement, type) {
	const cornerOptions = [
		{ value: 'top-left', text: 'Top Left' },
		{ value: 'top-right', text: 'Top Right' },
		{ value: 'bottom-left', text: 'Bottom Left' },
		{ value: 'bottom-right', text: 'Bottom Right' }
	];

	const bannerOptions = [
		{ value: 'top-banner', text: 'Top Banner' },
		{ value: 'bottom-banner', text: 'Bottom Banner' }
	];

	const options = type === 'banner' ? bannerOptions : cornerOptions;
	selectElement.innerHTML = options.map(opt =>
		`<option value="${opt.value}">${opt.text}</option>`
	).join('');
}

// Render sponsor gallery
function renderGallery() {
	const gallery = document.getElementById('sponsorGallery');
	if (!gallery) return;

	// Filter sponsors by position
	const filteredSponsors = currentFilter === 'all'
		? sponsors
		: sponsors.filter(s => s.position === currentFilter);

	if (filteredSponsors.length === 0) {
		gallery.innerHTML = `
			<div class="text-center py-8 text-gray-400 col-span-full">
				${sponsors.length === 0
					? 'No sponsors uploaded yet. Upload your first sponsor above.'
					: `No sponsors found for this position filter.`}
			</div>
		`;
		return;
	}

	gallery.innerHTML = filteredSponsors.map(sponsor => {
		const positionLabel = getPositionLabel(sponsor.position);
		const typeLabel = sponsor.type === 'banner' ? 'Banner' : 'Corner';
		const isActive = sponsor.active !== false;
		// Convert percentage to multiplier for display (100% = 1.0x)
		const sizeMultiplier = ((sponsor.size || 100) / 100).toFixed(1);

		// Build preview URL with user-specific path
		const previewUrl = getSponsorPreviewUrl(sponsor);
		// Show owner badge for superadmin view
		const ownerBadge = isSuperadminView && sponsor.ownerId
			? `<span class="bg-indigo-600 text-white text-xs px-1.5 py-0.5 rounded font-medium ml-1">User ${sponsor.ownerId}</span>`
			: '';

		return `
		<div class="sponsor-card group bg-gray-750 rounded-lg border border-gray-600 overflow-hidden ${!isActive ? 'opacity-60' : ''}">
			<!-- Image Container -->
			<div class="relative aspect-video bg-gray-700 cursor-pointer" onclick="previewSponsor('${escapeHtml(sponsor.id)}')">
				<img src="${previewUrl}"
					 alt="${escapeHtml(sponsor.name)}"
					 class="w-full h-full object-contain p-2"
					 style="opacity: ${sponsor.opacity / 100}"
					 onerror="this.parentElement.innerHTML = '<div class=\\'flex items-center justify-center h-full text-gray-500\\'><svg class=\\'w-12 h-12\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'2\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\'></path></svg></div>'">

				<!-- Status Badge -->
				<div class="absolute top-2 left-2 flex gap-1">
					${isActive ? `
						<span class="bg-green-600 text-white text-xs px-2 py-0.5 rounded font-medium">Active</span>
					` : `
						<span class="bg-gray-600 text-gray-300 text-xs px-2 py-0.5 rounded font-medium">Inactive</span>
					`}
					${ownerBadge}
				</div>

				<!-- Type Badge -->
				<div class="absolute top-2 right-2">
					<span class="bg-blue-600 text-white text-xs px-2 py-0.5 rounded font-medium">${typeLabel}</span>
				</div>
			</div>

			<!-- Info Section -->
			<div class="p-3">
				<h3 class="text-white font-medium truncate mb-1" title="${escapeHtml(sponsor.name)}">${escapeHtml(sponsor.name)}</h3>
				<div class="flex items-center justify-between text-xs text-gray-400 mb-3">
					<span>${positionLabel}</span>
					<span>${sizeMultiplier}x | ${sponsor.opacity}%</span>
				</div>

				<!-- Action Buttons -->
				<div class="flex gap-2 mb-3">
					<button onclick="event.stopPropagation(); showSponsorNow('${escapeHtml(sponsor.id)}')"
							class="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-xs py-1.5 rounded transition font-medium"
							title="Display this sponsor now">
						Show
					</button>
					<button onclick="event.stopPropagation(); hideSponsorNow('${escapeHtml(sponsor.position)}')"
							class="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white text-xs py-1.5 rounded transition font-medium"
							title="Hide this sponsor from display">
						Hide
					</button>
					<button onclick="event.stopPropagation(); toggleActive('${escapeHtml(sponsor.id)}', ${!isActive})"
							class="${isActive ? 'bg-gray-600 hover:bg-gray-500' : 'bg-green-600 hover:bg-green-700'} text-white text-xs py-1.5 px-2 rounded transition font-medium"
							title="${isActive ? 'Deactivate' : 'Activate'}">
						${isActive ? 'Off' : 'On'}
					</button>
					<button onclick="event.stopPropagation(); openEditModal('${escapeHtml(sponsor.id)}')"
							class="px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition font-medium"
							title="Edit sponsor">
						Edit
					</button>
					<button onclick="event.stopPropagation(); showDeleteModal('${escapeHtml(sponsor.id)}')"
							class="px-2 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition font-medium"
							title="Delete sponsor">
						Del
					</button>
				</div>

				<!-- X/Y Offset Sliders (real-time) -->
				<div class="space-y-2 pt-2 border-t border-gray-600">
					<div>
						<label class="flex items-center justify-between text-xs text-gray-400 mb-1">
							<span>X Offset</span>
							<input type="number"
								id="offsetX-${escapeHtml(sponsor.id)}-input"
								min="-500" max="500" step="1"
								value="${sponsor.offsetX || 0}"
								oninput="updateOffsetFromInput('${escapeHtml(sponsor.id)}', 'X', this.value)"
								onchange="saveOffset('${escapeHtml(sponsor.id)}')"
								class="w-16 px-1 py-0.5 text-xs text-right bg-gray-700 border border-gray-500 rounded text-white">
						</label>
						<input type="range"
							id="offsetX-${escapeHtml(sponsor.id)}"
							min="-500" max="500" step="5"
							value="${sponsor.offsetX || 0}"
							oninput="updateOffsetValue('${escapeHtml(sponsor.id)}', 'X', this.value)"
							onchange="saveOffset('${escapeHtml(sponsor.id)}')"
							class="w-full h-2 rounded-lg cursor-pointer">
					</div>
					<div>
						<label class="flex items-center justify-between text-xs text-gray-400 mb-1">
							<span>Y Offset</span>
							<input type="number"
								id="offsetY-${escapeHtml(sponsor.id)}-input"
								min="-500" max="500" step="1"
								value="${sponsor.offsetY || 0}"
								oninput="updateOffsetFromInput('${escapeHtml(sponsor.id)}', 'Y', this.value)"
								onchange="saveOffset('${escapeHtml(sponsor.id)}')"
								class="w-16 px-1 py-0.5 text-xs text-right bg-gray-700 border border-gray-500 rounded text-white">
						</label>
						<input type="range"
							id="offsetY-${escapeHtml(sponsor.id)}"
							min="-500" max="500" step="5"
							value="${sponsor.offsetY || 0}"
							oninput="updateOffsetValue('${escapeHtml(sponsor.id)}', 'Y', this.value)"
							onchange="saveOffset('${escapeHtml(sponsor.id)}')"
							class="w-full h-2 rounded-lg cursor-pointer">
					</div>
				</div>
			</div>
		</div>
	`;
	}).join('');
}

// Get position display label
function getPositionLabel(position) {
	const labels = {
		'top-left': 'Top Left',
		'top-right': 'Top Right',
		'bottom-left': 'Bottom Left',
		'bottom-right': 'Bottom Right',
		'top-banner': 'Top Banner',
		'bottom-banner': 'Bottom Banner'
	};
	return labels[position] || position;
}

/**
 * Get preview URL for a sponsor
 * Uses user-specific path: /api/sponsors/preview/{userId}/{filename}
 * @param {Object} sponsor - Sponsor object with ownerId and filename
 * @returns {string} Preview URL
 */
function getSponsorPreviewUrl(sponsor) {
	const userId = sponsor.ownerId || currentUserId;
	if (userId) {
		return `/api/sponsors/preview/${userId}/${encodeURIComponent(sponsor.filename)}`;
	}
	// Fallback to legacy URL format (will search all directories)
	return `/api/sponsors/preview/${encodeURIComponent(sponsor.filename)}`;
}

// Filter by position
function filterByPosition(position) {
	currentFilter = position;

	// Update tab styles
	document.querySelectorAll('.position-tab').forEach(tab => {
		const tabPosition = tab.dataset.position;
		if (tabPosition === position) {
			tab.classList.remove('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
			tab.classList.add('bg-blue-600', 'text-white', 'active');
		} else {
			tab.classList.add('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
			tab.classList.remove('bg-blue-600', 'text-white', 'active');
		}
	});

	renderGallery();
}

// Setup upload form - now handled via onclick handler in HTML (handleSponsorUpload)
function setupUploadForm() {
	// Upload is handled by handleSponsorUpload() via onclick attribute
	// This function is kept for backwards compatibility but does nothing
}

// Setup edit form
function setupEditForm() {
	const form = document.getElementById('editForm');
	if (!form) return;

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		await saveEdit();
	});
}

// Toggle sponsor active state
async function toggleActive(sponsorId, newState) {
	try {
		const response = await csrfFetch(`/api/sponsors/${encodeURIComponent(sponsorId)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ active: newState })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Sponsor ${newState ? 'activated' : 'deactivated'}`, 'success');
			await loadSponsors();
		} else {
			showAlert(`Update failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Update error: ${error.message}`, 'error');
	}
}

// Open edit modal
function openEditModal(sponsorId) {
	const sponsor = sponsors.find(s => s.id === sponsorId);
	if (!sponsor) return;

	editTarget = sponsorId;

	// Convert percentage to multiplier (100% = 1.0x)
	const sizeMultiplier = (sponsor.size || 100) / 100;

	document.getElementById('editSponsorId').value = sponsorId;
	document.getElementById('editName').value = sponsor.name;
	document.getElementById('editPosition').value = sponsor.position;
	document.getElementById('editSize').value = sizeMultiplier.toFixed(1);
	document.getElementById('editSizeValue').textContent = sizeMultiplier.toFixed(1);
	document.getElementById('editOpacity').value = sponsor.opacity;
	document.getElementById('editOpacityValue').textContent = sponsor.opacity;
	document.getElementById('editBorderRadius').value = sponsor.borderRadius || 0;
	document.getElementById('editBorderRadiusValue').textContent = sponsor.borderRadius || 0;
	document.getElementById('editActive').checked = sponsor.active !== false;

	document.getElementById('editModal').classList.remove('hidden');
}

// Close edit modal
function closeEditModal() {
	editTarget = null;
	document.getElementById('editModal').classList.add('hidden');
}

// Save edit
async function saveEdit() {
	if (!editTarget) return;

	// Convert multiplier to percentage (1.0x = 100%)
	const sizeMultiplier = parseFloat(document.getElementById('editSize').value);
	const sizePercent = Math.round(sizeMultiplier * 100);

	const updates = {
		name: document.getElementById('editName').value.trim(),
		position: document.getElementById('editPosition').value,
		size: sizePercent,
		opacity: parseInt(document.getElementById('editOpacity').value),
		borderRadius: parseInt(document.getElementById('editBorderRadius').value),
		active: document.getElementById('editActive').checked
	};

	// Update type based on position
	updates.type = updates.position.includes('banner') ? 'banner' : 'corner';

	try {
		const response = await csrfFetch(`/api/sponsors/${encodeURIComponent(editTarget)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(updates)
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Sponsor updated successfully', 'success');
			closeEditModal();
			await loadSponsors();
		} else {
			showAlert(`Update failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Update error: ${error.message}`, 'error');
	}
}

// Show delete confirmation modal
function showDeleteModal(sponsorId) {
	const sponsor = sponsors.find(s => s.id === sponsorId);
	if (!sponsor) return;

	deleteTarget = sponsorId;
	document.getElementById('deleteFileName').textContent = sponsor.name;
	document.getElementById('deleteModal').classList.remove('hidden');
}

// Close delete modal
function closeDeleteModal() {
	deleteTarget = null;
	document.getElementById('deleteModal').classList.add('hidden');
}

// Confirm delete
async function confirmDelete() {
	if (!deleteTarget) return;

	try {
		const response = await csrfFetch(`/api/sponsors/${encodeURIComponent(deleteTarget)}`, {
			method: 'DELETE'
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Sponsor deleted', 'success');
			closeDeleteModal();
			await loadSponsors();
		} else {
			showAlert(`Delete failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Delete error: ${error.message}`, 'error');
	}
}

// Preview sponsor
function previewSponsor(sponsorId) {
	const sponsor = sponsors.find(s => s.id === sponsorId);
	if (!sponsor) return;

	const modal = document.getElementById('previewModal');
	const image = document.getElementById('previewImage');
	const name = document.getElementById('previewName');

	image.src = getSponsorPreviewUrl(sponsor);
	name.textContent = sponsor.name;
	modal.classList.remove('hidden');
}

// Close preview modal
function closePreviewModal() {
	document.getElementById('previewModal').classList.add('hidden');
}

// Save config settings
async function saveConfig() {
	const config = {
		enabled: document.getElementById('masterToggle').checked,
		rotationEnabled: document.getElementById('rotationToggle').checked,
		rotationInterval: parseInt(document.getElementById('rotationInterval').value) || 30,
		rotationTransition: parseInt(document.getElementById('rotationTransition').value) || 500,
		rotationOrder: document.getElementById('rotationOrder').value,
		timerViewEnabled: document.getElementById('timerViewToggle').checked,
		timerShowDuration: parseInt(document.getElementById('timerShowDuration').value) || 10,
		timerHideDuration: parseInt(document.getElementById('timerHideDuration').value) || 5,
		displays: {
			match: document.getElementById('displayMatch').checked,
			bracket: document.getElementById('displayBracket').checked
		}
	};

	try {
		const response = await csrfFetch('/api/sponsors/config', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config)
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Settings saved successfully', 'success');
			sponsorConfig = data.config;
		} else {
			showAlert(`Save failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Save error: ${error.message}`, 'error');
	}
}

// Show all active sponsors on displays
async function showAllSponsors() {
	const activeSponsors = sponsors.filter(s => s.active !== false);
	if (activeSponsors.length === 0) {
		showAlert('No active sponsors to show', 'warning');
		return;
	}

	try {
		const response = await csrfFetch('/api/sponsors/show', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ all: true })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(data.message || `Showing sponsor(s) on displays`, 'success');
		} else {
			showAlert(`Show failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Show error: ${error.message}`, 'error');
	}
}

// Hide all sponsors from displays
async function hideAllSponsors() {
	try {
		const response = await csrfFetch('/api/sponsors/hide', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		});

		const data = await response.json();

		if (data.success) {
			showAlert('All sponsors hidden from displays', 'success');
		} else {
			showAlert(`Hide failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Hide error: ${error.message}`, 'error');
	}
}

// Show a single sponsor immediately on displays
async function showSponsorNow(sponsorId) {
	try {
		const response = await csrfFetch('/api/sponsors/show', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sponsorId })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(data.message || 'Sponsor displayed', 'success');
		} else {
			showAlert(`Show failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Show error: ${error.message}`, 'error');
	}
}

// Hide a single sponsor at a specific position from displays
async function hideSponsorNow(position) {
	try {
		const response = await csrfFetch('/api/sponsors/hide', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ position })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Sponsor at ${position.replace('-', ' ')} hidden`, 'success');
		} else {
			showAlert(`Hide failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Hide error: ${error.message}`, 'error');
	}
}

// Debounce timer for real-time offset updates
let offsetDebounceTimers = {};

// Update offset value from slider (syncs to number input)
function updateOffsetValue(sponsorId, axis, value) {
	// Sync the number input
	const numberInput = document.getElementById(`offset${axis}-${sponsorId}-input`);
	if (numberInput) {
		numberInput.value = value;
	}

	// Debounce the real-time display update
	const timerKey = `${sponsorId}-${axis}`;
	if (offsetDebounceTimers[timerKey]) {
		clearTimeout(offsetDebounceTimers[timerKey]);
	}

	offsetDebounceTimers[timerKey] = setTimeout(() => {
		// Send real-time update to display
		sendRealtimeOffsetUpdate(sponsorId);
	}, 100); // 100ms debounce for smooth updates
}

// Update offset value from number input (syncs to slider)
function updateOffsetFromInput(sponsorId, axis, value) {
	// Clamp value to valid range
	let numValue = parseInt(value) || 0;
	numValue = Math.max(-500, Math.min(500, numValue));

	// Sync the slider
	const slider = document.getElementById(`offset${axis}-${sponsorId}`);
	if (slider) {
		slider.value = numValue;
	}

	// Debounce the real-time display update
	const timerKey = `${sponsorId}-${axis}`;
	if (offsetDebounceTimers[timerKey]) {
		clearTimeout(offsetDebounceTimers[timerKey]);
	}

	offsetDebounceTimers[timerKey] = setTimeout(() => {
		// Send real-time update to display
		sendRealtimeOffsetUpdate(sponsorId);
	}, 100); // 100ms debounce for smooth updates
}

// Send real-time offset update to displays (without saving to database)
async function sendRealtimeOffsetUpdate(sponsorId) {
	const sponsor = sponsors.find(s => s.id === sponsorId);
	if (!sponsor) return;

	// Read from number inputs (more precise) with fallback to sliders
	const offsetX = parseInt(document.getElementById(`offsetX-${sponsorId}-input`)?.value)
		|| parseInt(document.getElementById(`offsetX-${sponsorId}`)?.value) || 0;
	const offsetY = parseInt(document.getElementById(`offsetY-${sponsorId}-input`)?.value)
		|| parseInt(document.getElementById(`offsetY-${sponsorId}`)?.value) || 0;

	try {
		// Use the show endpoint to push updated sponsor with new offsets
		await csrfFetch('/api/sponsors/show', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				sponsorId,
				realtimeUpdate: true,
				offsetX,
				offsetY
			})
		});
	} catch (error) {
		console.error('[Sponsors] Real-time update error:', error);
	}
}

// Save offset values to database (called on slider/input change/release)
async function saveOffset(sponsorId) {
	// Read from number inputs (more precise) with fallback to sliders
	const offsetX = parseInt(document.getElementById(`offsetX-${sponsorId}-input`)?.value)
		|| parseInt(document.getElementById(`offsetX-${sponsorId}`)?.value) || 0;
	const offsetY = parseInt(document.getElementById(`offsetY-${sponsorId}-input`)?.value)
		|| parseInt(document.getElementById(`offsetY-${sponsorId}`)?.value) || 0;

	try {
		const response = await csrfFetch(`/api/sponsors/${encodeURIComponent(sponsorId)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ offsetX, offsetY })
		});

		const data = await response.json();

		if (data.success) {
			// Update local state without full reload
			const sponsor = sponsors.find(s => s.id === sponsorId);
			if (sponsor) {
				sponsor.offsetX = offsetX;
				sponsor.offsetY = offsetY;
			}
			console.log(`[Sponsors] Offset saved: X=${offsetX}, Y=${offsetY}`);
		} else {
			showAlert(`Failed to save offset: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Save offset error: ${error.message}`, 'error');
	}
}

// Handle sponsor upload (called from HTML onclick)
async function handleSponsorUpload(e) {
	const form = document.getElementById('uploadForm');
	const fileInput = document.getElementById('logoFile');
	const sponsorName = document.getElementById('sponsorName');
	const positionType = document.getElementById('positionType');
	const positionSelect = document.getElementById('positionSelect');
	const sizeSlider = document.getElementById('sizeSlider');
	const opacitySlider = document.getElementById('opacitySlider');
	const borderRadiusSlider = document.getElementById('borderRadiusSlider');
	const customName = document.getElementById('customName');

	if (!fileInput.files || fileInput.files.length === 0) {
		showAlert('Please select a file to upload', 'warning');
		return;
	}

	if (!sponsorName.value.trim()) {
		showAlert('Please enter a sponsor name', 'warning');
		return;
	}

	// Convert multiplier to percentage (1.0x = 100%)
	const sizeMultiplier = parseFloat(sizeSlider.value);
	const sizePercent = Math.round(sizeMultiplier * 100);

	const formData = new FormData();
	formData.append('logo', fileInput.files[0]);
	formData.append('name', sponsorName.value.trim());
	formData.append('type', positionType.value);
	formData.append('position', positionSelect.value);
	formData.append('size', sizePercent);
	formData.append('opacity', opacitySlider.value);
	formData.append('borderRadius', borderRadiusSlider.value);
	if (customName.value.trim()) {
		formData.append('customName', customName.value.trim());
	}

	const submitBtn = e.target;
	const originalText = submitBtn.textContent;
	submitBtn.disabled = true;
	submitBtn.textContent = 'Uploading...';

	try {
		const response = await csrfFetch('/api/sponsors/upload', {
			method: 'POST',
			body: formData
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Sponsor "${data.sponsor.name}" uploaded successfully!`, 'success');
			form.reset();
			document.getElementById('sizeValue').textContent = '1.0';
			document.getElementById('opacityValue').textContent = '100';
			document.getElementById('borderRadiusValue').textContent = '0';
			await loadSponsors();
		} else {
			showAlert(`Upload failed: ${data.error}`, 'error');
		}
	} catch (error) {
		console.error('[Sponsors] Upload error:', error);
		showAlert(`Upload error: ${error.message}`, 'error');
	} finally {
		submitBtn.disabled = false;
		submitBtn.textContent = originalText;
	}
}

// Export functions for use in HTML onclick handlers
window.handleSponsorUpload = handleSponsorUpload;
window.loadSponsors = loadSponsors;
window.filterByPosition = filterByPosition;
window.toggleActive = toggleActive;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.showDeleteModal = showDeleteModal;
window.closeDeleteModal = closeDeleteModal;
window.confirmDelete = confirmDelete;
window.previewSponsor = previewSponsor;
window.closePreviewModal = closePreviewModal;
window.saveConfig = saveConfig;
window.showAllSponsors = showAllSponsors;
window.hideAllSponsors = hideAllSponsors;
window.saveEdit = saveEdit;
window.toggleSection = toggleSection;
window.updatePositionDropdown = updatePositionDropdown;
window.showSponsorNow = showSponsorNow;
window.hideSponsorNow = hideSponsorNow;
window.updateOffsetValue = updateOffsetValue;
window.updateOffsetFromInput = updateOffsetFromInput;
window.saveOffset = saveOffset;

// Cleanup all intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	if (statusRefreshInterval) clearInterval(statusRefreshInterval);
});
