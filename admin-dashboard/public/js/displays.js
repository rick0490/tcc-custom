// Display Management Page JavaScript

// State
let moduleStatus = null;
let displays = [];
let statusRefreshInterval = null;
let displaysRefreshInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
	console.log('Display Management page loaded');

	// Initialize last updated timestamp
	initLastUpdated('displaysLastUpdated', refreshDisplays, { prefix: 'Updated', thresholds: { fresh: 20, stale: 90 } });

	await refreshModuleStatus();
	await refreshDisplays();

	// Start polling with visibility awareness
	startPolling();

	// Setup visibility handler to pause/resume polling
	setupVisibilityHandler(
		() => { startPolling(); }, // onVisible
		() => { stopPolling(); }   // onHidden
	);
});

function startPolling() {
	if (!statusRefreshInterval) {
		statusRefreshInterval = setInterval(refreshModuleStatus, 10000);
	}
	if (!displaysRefreshInterval) {
		displaysRefreshInterval = setInterval(refreshDisplays, 15000);
	}
}

function stopPolling() {
	if (statusRefreshInterval) {
		clearInterval(statusRefreshInterval);
		statusRefreshInterval = null;
	}
	if (displaysRefreshInterval) {
		clearInterval(displaysRefreshInterval);
		displaysRefreshInterval = null;
	}
}

// Refresh module status from API
async function refreshModuleStatus() {
	// Show loading state
	const btn = document.getElementById('refreshModuleStatusBtn');
	const icon = document.getElementById('refreshModuleStatusIcon');
	const text = document.getElementById('refreshModuleStatusText');
	if (btn) btn.disabled = true;
	if (icon) icon.classList.add('animate-spin');
	if (text) text.textContent = 'Refreshing...';

	try {
		const response = await fetch('/api/status');
		if (!response.ok) {
			if (response.status === 401) {
				window.location.href = '/login.html';
				return;
			}
			throw new Error(`HTTP ${response.status}`);
		}

		const data = await response.json();
		if (data.success) {
			moduleStatus = data.modules;
			updateModuleCards();
			updateLastRefreshed();
		}
	} catch (error) {
		console.error('Failed to refresh module status:', error);
	} finally {
		// Reset loading state
		if (btn) btn.disabled = false;
		if (icon) icon.classList.remove('animate-spin');
		if (text) text.textContent = 'Refresh';
	}
}

// Update module status cards
function updateModuleCards() {
	if (!moduleStatus) return;

	// Match module
	updateModuleCard('moduleMatch', moduleStatus.match, 'tournament');

	// Bracket module
	updateModuleCard('moduleBracket', moduleStatus.bracket, 'bracket');

	// Flyer module
	updateModuleCard('moduleFlyer', moduleStatus.flyer, 'flyer');

	// Also fetch cache status for match module
	fetchMatchCacheStatus();
}

// Fetch and display match cache status
async function fetchMatchCacheStatus() {
	try {
		const response = await fetch('/api/matches/cache-status');
		if (!response.ok) return;

		const data = await response.json();
		const cacheStatusSpan = document.getElementById('matchCacheStatus');
		if (!cacheStatusSpan) return;

		if (data.hasCache) {
			const ageSeconds = Math.round((data.cacheAgeMs || 0) / 1000);
			let ageText = ageSeconds < 60 ? ageSeconds + 's' : Math.round(ageSeconds / 60) + 'm';

			if (data.isStale) {
				cacheStatusSpan.innerHTML = `<span class="text-red-400">Stale (${ageText} ago)</span>`;
			} else {
				cacheStatusSpan.innerHTML = `<span class="text-green-400">Fresh (${ageText} ago)</span>`;
			}
		} else {
			cacheStatusSpan.textContent = 'No cache';
		}

		// Show polling status
		if (data.pollingActive) {
			cacheStatusSpan.innerHTML += ' <span class="text-blue-400">[Polling]</span>';
		}
	} catch (error) {
		console.error('Failed to fetch cache status:', error);
	}
}

// Force update match data from Challonge
async function forceUpdateMatches() {
	const btn = document.getElementById('forceUpdateBtn');
	if (!btn) return;

	// Disable button and show loading state
	const originalContent = btn.innerHTML;
	btn.disabled = true;
	btn.innerHTML = `
		<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
		</svg>
		Updating...
	`;

	try {
		const response = await csrfFetch('/api/matches/force-update', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Match data refreshed and pushed to displays', 'success');
			// Refresh the cache status display
			await fetchMatchCacheStatus();
		} else {
			showAlert(data.error || 'Failed to update match data', 'error');
		}
	} catch (error) {
		console.error('Force update failed:', error);
		showAlert('Failed to connect to server', 'error');
	} finally {
		// Restore button
		btn.disabled = false;
		btn.innerHTML = originalContent;
	}
}

// Update individual module card
function updateModuleCard(cardId, module, stateKey) {
	const card = document.getElementById(cardId);
	if (!card || !module) return;

	const indicator = card.querySelector('.status-indicator');
	const isOnline = module.status?.running === true;

	// Update status indicator
	indicator.classList.remove('bg-gray-500', 'bg-green-500', 'bg-red-500');
	indicator.classList.add(isOnline ? 'bg-green-500' : 'bg-red-500');

	// Update state info
	const state = module.state || {};

	if (stateKey === 'tournament') {
		const tournamentSpan = card.querySelector('.module-tournament');
		if (tournamentSpan) {
			tournamentSpan.textContent = state.tournamentId || 'Not configured';
		}
	} else if (stateKey === 'bracket') {
		const bracketSpan = card.querySelector('.module-bracket');
		if (bracketSpan) {
			// Show shortened bracket URL or "Not configured"
			const url = state.bracketUrl;
			if (url) {
				// Extract tournament ID from URL for display
				const match = url.match(/challonge\.com\/([^\/]+)/);
				bracketSpan.textContent = match ? match[1] : url;
				bracketSpan.title = url; // Full URL on hover
			} else {
				bracketSpan.textContent = 'Not configured';
			}
		}
	} else if (stateKey === 'flyer') {
		const flyerSpan = card.querySelector('.module-flyer');
		if (flyerSpan) {
			flyerSpan.textContent = state.flyer || 'None';
		}
	}

	// Update last updated
	const updatedSpan = card.querySelector('.module-updated');
	if (updatedSpan && state.lastUpdated) {
		updatedSpan.textContent = formatTimeAgo(state.lastUpdated);
	}
}

// Update last refreshed timestamp
function updateLastRefreshed() {
	const el = document.getElementById('lastRefreshed');
	if (el) {
		el.textContent = `Last checked: ${getCurrentTimeCT()}`;
	}
}

// Refresh registered displays
async function refreshDisplays() {
	const container = document.getElementById('displayList');
	if (!container) return;

	// Show loading state
	const btn = document.getElementById('refreshDisplaysBtn');
	const icon = document.getElementById('refreshDisplaysIcon');
	const text = document.getElementById('refreshDisplaysText');
	if (btn) btn.disabled = true;
	if (icon) icon.classList.add('animate-spin');
	if (text) text.textContent = 'Refreshing...';

	try {
		const response = await fetch('/api/displays');
		if (!response.ok) {
			if (response.status === 404) {
				// API doesn't exist yet - show placeholder
				renderNoDisplaysRegistered();
				return;
			}
			throw new Error(`HTTP ${response.status}`);
		}

		const data = await response.json();
		if (data.success) {
			displays = data.displays || [];
			renderDisplayList();
			// Update last refreshed timestamp
			setLastUpdated('displaysLastUpdated');
		}
	} catch (error) {
		console.error('Failed to load displays:', error);
		renderNoDisplaysRegistered();
	} finally {
		// Reset loading state
		if (btn) btn.disabled = false;
		if (icon) icon.classList.remove('animate-spin');
		if (text) text.textContent = 'Refresh';
	}
}

// Render display list
function renderDisplayList() {
	const container = document.getElementById('displayList');
	if (!container) return;

	if (displays.length === 0) {
		renderNoDisplaysRegistered();
		return;
	}

	container.innerHTML = displays.map(display => {
		const isOnline = display.status === 'online';
		const statusClass = isOnline ? 'bg-green-500' : 'bg-red-500';
		const statusText = isOnline ? 'Online' : 'Offline';
		const displayName = display.hostname || display.id;
		const lastSeen = display.lastHeartbeat;
		const systemInfo = display.systemInfo || {};

		// WiFi signal strength indicator
		const wifiQuality = systemInfo.wifiQuality || 0;
		const wifiSignal = systemInfo.wifiSignal || 0;
		const wifiSSID = systemInfo.ssid || 'Unknown';
		let wifiStrengthClass = 'text-red-400';
		let wifiStrengthLabel = 'Poor';
		if (wifiQuality >= 80) { wifiStrengthClass = 'text-green-400'; wifiStrengthLabel = 'Excellent'; }
		else if (wifiQuality >= 60) { wifiStrengthClass = 'text-blue-400'; wifiStrengthLabel = 'Good'; }
		else if (wifiQuality >= 40) { wifiStrengthClass = 'text-yellow-400'; wifiStrengthLabel = 'Fair'; }

		// CPU temp indicator
		const cpuTemp = systemInfo.cpuTemp || 0;
		let tempClass = 'text-green-400';
		if (cpuTemp >= 70) tempClass = 'text-red-400';
		else if (cpuTemp >= 60) tempClass = 'text-yellow-400';

		// Memory usage indicator
		const memUsage = systemInfo.memoryUsage || 0;
		let memClass = 'text-green-400';
		if (memUsage >= 80) memClass = 'text-red-400';
		else if (memUsage >= 60) memClass = 'text-yellow-400';

		// Voltage indicator (Pi 5 throttling detection)
		const voltage = systemInfo.voltage || 0;
		let voltageClass = 'text-green-400';
		let voltageStatus = 'OK';
		if (voltage > 0 && voltage < 0.85) { voltageClass = 'text-red-400'; voltageStatus = 'Throttled'; }
		else if (voltage > 0 && voltage < 0.9) { voltageClass = 'text-yellow-400'; voltageStatus = 'Low'; }

		const debugMode = display.debugMode || false;
		const debugLogCount = display.debugLogs ? display.debugLogs.length : 0;

		return `
		<div class="bg-gray-750 rounded-lg border border-gray-600 overflow-hidden">
			<!-- Header Row -->
			<div class="p-4 flex items-center justify-between border-b border-gray-600">
				<div class="flex items-center gap-3">
					<div class="status-indicator ${statusClass}"></div>
					<div>
						<div class="font-semibold text-white text-lg">${escapeHtml(displayName)}</div>
						<div class="text-xs text-gray-500">${statusText} - Last seen: ${lastSeen ? formatTimeAgo(lastSeen) : 'Never'}</div>
					</div>
				</div>
				<div class="flex items-center gap-3">
					<!-- Debug Toggle -->
					<div class="flex items-center gap-2">
						<span class="text-sm text-gray-400">Debug:</span>
						<label class="relative inline-flex items-center cursor-pointer">
							<input type="checkbox" class="sr-only peer"
								   ${debugMode ? 'checked' : ''}
								   onchange="toggleDebugMode('${escapeHtml(display.id)}', this.checked)">
							<div class="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer
								        peer-checked:after:translate-x-full peer-checked:after:border-white
								        after:content-[''] after:absolute after:top-[2px] after:left-[2px]
								        after:bg-white after:border-gray-300 after:border after:rounded-full
								        after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
						</label>
						${debugMode ? `
						<button onclick="viewDebugLogs('${escapeHtml(display.id)}', '${escapeHtml(displayName)}')"
								class="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 rounded text-white font-medium flex items-center gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
							</svg>
							Logs${debugLogCount > 0 ? ` (${debugLogCount})` : ''}
						</button>
						` : ''}
					</div>
					<div class="flex items-center gap-2">
						<span class="text-sm text-gray-400">View:</span>
						<select onchange="assignDisplayView('${escapeHtml(display.id)}', this.value)"
								class="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white">
							<option value="match" ${display.assignedView === 'match' ? 'selected' : ''}>Match</option>
							<option value="bracket" ${display.assignedView === 'bracket' ? 'selected' : ''}>Bracket</option>
							<option value="flyer" ${display.assignedView === 'flyer' ? 'selected' : ''}>Flyer</option>
						</select>
					</div>
					<button onclick="rebootDisplay('${escapeHtml(display.id)}')"
							class="px-3 py-1.5 text-xs bg-yellow-600 hover:bg-yellow-500 rounded text-white font-medium">
						Reboot
					</button>
					<button onclick="shutdownDisplay('${escapeHtml(display.id)}')"
							class="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 rounded text-white font-medium">
						Shutdown
					</button>
				</div>
			</div>

			<!-- System Info Grid -->
			<div class="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
				<!-- Network Info -->
				<div class="space-y-2">
					<div class="text-xs text-gray-500 uppercase tracking-wide">Network</div>
					<div class="space-y-1 text-sm">
						<div class="flex justify-between">
							<span class="text-gray-400">Internal IP:</span>
							<span class="text-white font-mono">${escapeHtml(display.ip || 'Unknown')}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-400">External IP:</span>
							<span class="text-white font-mono">${escapeHtml(display.externalIp || 'Unknown')}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-400">MAC:</span>
							<span class="text-white font-mono text-xs">${escapeHtml(display.mac || 'Unknown')}</span>
						</div>
					</div>
				</div>

				<!-- WiFi Info -->
				<div class="space-y-2">
					<div class="text-xs text-gray-500 uppercase tracking-wide">WiFi</div>
					<div class="space-y-1 text-sm">
						<div class="flex justify-between">
							<span class="text-gray-400">Network:</span>
							<span class="text-white truncate max-w-24" title="${escapeHtml(wifiSSID)}">${escapeHtml(wifiSSID)}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-400">Quality:</span>
							<span class="${wifiStrengthClass}">${wifiQuality}% (${wifiStrengthLabel})</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-400">Signal:</span>
							<span class="text-white">${wifiSignal} dBm</span>
						</div>
					</div>
				</div>

				<!-- System Health -->
				<div class="space-y-2">
					<div class="text-xs text-gray-500 uppercase tracking-wide">System Health</div>
					<div class="space-y-1 text-sm">
						<div class="flex justify-between">
							<span class="text-gray-400">CPU Temp:</span>
							<span class="${tempClass}">${cpuTemp > 0 ? cpuTemp + 'C' : '--'}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-400">Memory:</span>
							<span class="${memClass}">${memUsage > 0 ? memUsage + '%' : '--'}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-400">Voltage:</span>
							<span class="${voltageClass}">${voltage > 0 ? voltage.toFixed(2) + 'V' : '--'} ${voltage > 0 ? '(' + voltageStatus + ')' : ''}</span>
						</div>
					</div>
				</div>

				<!-- Display Status -->
				<div class="space-y-2">
					<div class="text-xs text-gray-500 uppercase tracking-wide">Display</div>
					<div class="space-y-1 text-sm">
						<div class="flex justify-between">
							<span class="text-gray-400">Current View:</span>
							<span class="text-white capitalize">${escapeHtml(display.currentView || 'unknown')}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-400">Assigned:</span>
							<span class="text-white capitalize">${escapeHtml(display.assignedView || 'unknown')}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-400">Status:</span>
							${display.currentView !== display.assignedView
								? '<span class="text-yellow-400">Restart Pending</span>'
								: '<span class="text-green-400">Synced</span>'}
						</div>
					</div>
				</div>
			</div>

			<!-- Uptime Row -->
			${display.uptimeSeconds ? `
			<div class="px-4 pb-3 text-xs text-gray-500">
				Uptime: ${formatUptime(display.uptimeSeconds)}
			</div>
			` : ''}

			<!-- Advanced Section (Collapsible) -->
			<div class="border-t border-gray-600">
				<button onclick="toggleAdvancedSection('${escapeHtml(display.id)}')"
						class="w-full px-4 py-2 flex items-center justify-between text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-700 transition-colors">
					<div class="flex items-center gap-2">
						<span class="uppercase tracking-wide">Advanced</span>
						${display.cdpEnabled ?
							'<span class="px-1.5 py-0.5 text-xs bg-green-600 text-white rounded font-medium" title="Real-time scaling via Chrome DevTools Protocol">CDP</span>' :
							''}
						${display.displayInfo && display.displayInfo.diagonalInches > 0 ?
							`<span class="text-gray-500">${display.displayInfo.diagonalInches.toFixed(1)}" detected</span>` : ''}
					</div>
					<svg id="advancedChevron-${escapeHtml(display.id)}" class="w-4 h-4 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
					</svg>
				</button>
				<div id="advancedContent-${escapeHtml(display.id)}" class="hidden p-4 pt-2">
					<!-- Display Info -->
					${display.displayInfo && display.displayInfo.diagonalInches > 0 ? `
					<div class="mb-3 px-2 py-1.5 bg-gray-700 rounded text-xs">
						<div class="flex items-center justify-between">
							<span class="text-gray-400">
								Detected: <span class="text-white">${display.displayInfo.diagonalInches.toFixed(1)}"</span> display
								<span class="text-gray-500">(${display.displayInfo.physicalWidth}mm x ${display.displayInfo.physicalHeight}mm)</span>
							</span>
						</div>
					</div>
					` : ''}
					<!-- Scale Control -->
					<div class="flex items-center justify-between mb-2">
						<span class="text-xs text-gray-500 uppercase tracking-wide">Display Scale</span>
						<span id="scaleValue-${escapeHtml(display.id)}" class="text-white font-mono text-sm">${(display.displayScaleFactor || 1.0).toFixed(1)}x</span>
					</div>
					<div class="flex items-center gap-3">
						<input type="range" id="scaleSlider-${escapeHtml(display.id)}"
							   min="0.5" max="3.0" step="0.1" value="${display.displayScaleFactor || 1.0}"
							   oninput="updateScaleValue('${escapeHtml(display.id)}', this.value)"
							   class="flex-1 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500">
					</div>
					<div class="flex gap-2 mt-2">
						<button onclick="setDisplayScale('${escapeHtml(display.id)}', 0.5)" class="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white">0.5x</button>
						<button onclick="setDisplayScale('${escapeHtml(display.id)}', 1.0)" class="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white">1.0x</button>
						<button onclick="setDisplayScale('${escapeHtml(display.id)}', 1.5)" class="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white">1.5x</button>
						<button onclick="setDisplayScale('${escapeHtml(display.id)}', 2.0)" class="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white">2.0x</button>
						<button id="applyScaleBtn-${escapeHtml(display.id)}" onclick="applyDisplayScale('${escapeHtml(display.id)}')"
								class="ml-auto px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed">Apply</button>
					</div>
					<p class="mt-2 text-xs text-gray-500">${display.cdpEnabled ? 'Real-time scaling - no restart needed' : 'Changes require browser restart (~10s)'}</p>
				</div>
			</div>
		</div>
	`;
	}).join('');
}

// Format uptime in human readable format
function formatUptime(seconds) {
	if (!seconds || seconds < 0) return 'Unknown';

	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	const parts = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

	return parts.join(' ');
}

// Render no displays message
function renderNoDisplaysRegistered() {
	const container = document.getElementById('displayList');
	if (!container) return;

	container.innerHTML = `
		<div class="text-center py-8 text-gray-400">
			<svg class="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
			</svg>
			<div class="font-medium text-gray-300 mb-1">No displays registered</div>
			<p class="text-sm">Display devices will appear here once they connect to the system</p>
		</div>
	`;
}

// Assign view to display
async function assignDisplayView(displayId, view) {
	try {
		const response = await csrfFetch(`/api/displays/${displayId}/config`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ assignedView: view })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Display assigned to ${view} view. Pi will restart automatically.`, 'success');
			await refreshDisplays();
		} else {
			showAlert(`Assignment failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Reboot display
async function rebootDisplay(displayId) {
	if (!confirm('Are you sure you want to reboot this display?')) return;

	try {
		const response = await csrfFetch(`/api/displays/${displayId}/reboot`, {
			method: 'POST'
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Reboot command sent', 'success');
		} else {
			showAlert(`Reboot failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Shutdown display
async function shutdownDisplay(displayId) {
	if (!confirm('Are you sure you want to shutdown this display?')) return;

	try {
		const response = await csrfFetch(`/api/displays/${displayId}/shutdown`, {
			method: 'POST'
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Shutdown command sent', 'success');
		} else {
			showAlert(`Shutdown failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// ============================================================================
// Display Scale Factor Functions
// ============================================================================

// Update scale value display in real-time as slider moves
function updateScaleValue(displayId, value) {
	const el = document.getElementById(`scaleValue-${displayId}`);
	if (el) el.textContent = `${parseFloat(value).toFixed(1)}x`;
}

// Set scale to preset value (updates slider and value display)
function setDisplayScale(displayId, value) {
	const slider = document.getElementById(`scaleSlider-${displayId}`);
	if (slider) slider.value = value;
	updateScaleValue(displayId, value);
}

// Apply the current scale factor to the display
async function applyDisplayScale(displayId) {
	const slider = document.getElementById(`scaleSlider-${displayId}`);
	const btn = document.getElementById(`applyScaleBtn-${displayId}`);
	if (!slider) return;

	const scaleFactor = parseFloat(slider.value);

	// Show loading state
	btn.disabled = true;
	btn.textContent = 'Applying...';

	try {
		const response = await csrfFetch(`/api/displays/${displayId}/config`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ displayScaleFactor: scaleFactor })
		});

		const data = await response.json();

		if (data.success) {
			// CDP-enabled displays get instant scaling, others require restart
			const message = data.cdpEnabled ?
				`Scale factor set to ${scaleFactor.toFixed(1)}x (instant via CDP)` :
				`Scale factor set to ${scaleFactor.toFixed(1)}x. Display will restart.`;
			showAlert(message, 'success');
			await refreshDisplays();
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Apply';
	}
}

// Quick apply suggested scale from detection
async function applyQuickScale(displayId, suggestedScale) {
	// Update slider and value display
	setDisplayScale(displayId, suggestedScale);
	// Apply the scale
	await applyDisplayScale(displayId);
}

// Toggle advanced section visibility
function toggleAdvancedSection(displayId) {
	const content = document.getElementById(`advancedContent-${displayId}`);
	const chevron = document.getElementById(`advancedChevron-${displayId}`);

	if (content && chevron) {
		const isHidden = content.classList.contains('hidden');
		content.classList.toggle('hidden');
		chevron.classList.toggle('rotate-180', isHidden);
	}
}

// Export functions for onclick handlers
window.updateScaleValue = updateScaleValue;
window.setDisplayScale = setDisplayScale;
window.applyDisplayScale = applyDisplayScale;
window.applyQuickScale = applyQuickScale;
window.toggleAdvancedSection = toggleAdvancedSection;

// Note: escapeHtml, showAlert, formatTimeAgo are now in utils.js

// ============================================================================
// Bracket Control Functions
// ============================================================================

const BRACKET_API_URL = 'http://localhost:2053';
let currentBracketZoom = 1.0;
let bracketModuleOnline = false;

// Initialize bracket controls on page load
document.addEventListener('DOMContentLoaded', () => {
	setupBracketZoomSlider();
	refreshBracketStatus();
});

// Setup zoom slider event listener
function setupBracketZoomSlider() {
	const slider = document.getElementById('bracketZoomSlider');
	const valueDisplay = document.getElementById('bracketZoomValue');

	if (slider && valueDisplay) {
		slider.addEventListener('input', (e) => {
			const value = parseFloat(e.target.value);
			valueDisplay.textContent = `${value.toFixed(1)}x`;
		});
	}
}

// Refresh bracket module status and current settings
async function refreshBracketStatus() {
	const statusContainer = document.getElementById('bracketControlStatus');
	const zoomDisplay = document.getElementById('currentZoomDisplay');
	const urlDisplay = document.getElementById('currentBracketUrl');

	try {
		const response = await fetch('/api/bracket/status');
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const data = await response.json();

		if (data.success) {
			bracketModuleOnline = true;
			currentBracketZoom = data.zoomScale || 1.0;

			// Update status indicator
			if (statusContainer) {
				statusContainer.innerHTML = `
					<div class="status-indicator bg-green-500"></div>
					<span class="text-sm text-green-400">Online</span>
				`;
			}

			// Update zoom slider and display
			const slider = document.getElementById('bracketZoomSlider');
			const valueDisplay = document.getElementById('bracketZoomValue');
			if (slider) {
				slider.value = currentBracketZoom;
			}
			if (valueDisplay) {
				valueDisplay.textContent = `${currentBracketZoom.toFixed(1)}x`;
			}
			if (zoomDisplay) {
				zoomDisplay.textContent = `${currentBracketZoom.toFixed(1)}x`;
			}

			// Update bracket URL display
			if (urlDisplay && data.bracketUrl) {
				const match = data.bracketUrl.match(/challonge\.com\/([^\/]+)/);
				urlDisplay.textContent = match ? match[1] : data.bracketUrl;
				urlDisplay.title = data.bracketUrl;
			} else if (urlDisplay) {
				urlDisplay.textContent = 'Not configured';
			}
		}
	} catch (error) {
		console.error('Failed to get bracket status:', error);
		bracketModuleOnline = false;

		if (statusContainer) {
			statusContainer.innerHTML = `
				<div class="status-indicator bg-red-500"></div>
				<span class="text-sm text-red-400">Offline</span>
			`;
		}
	}
}

// Set bracket zoom to a specific value (updates slider AND applies zoom)
async function setBracketZoom(zoomLevel) {
	const slider = document.getElementById('bracketZoomSlider');
	const valueDisplay = document.getElementById('bracketZoomValue');

	// Update UI immediately
	if (slider) {
		slider.value = zoomLevel;
	}
	if (valueDisplay) {
		valueDisplay.textContent = `${zoomLevel.toFixed(1)}x`;
	}

	// Also apply the zoom
	try {
		const response = await csrfFetch('/api/bracket/zoom', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ zoomScale: zoomLevel })
		});

		const data = await response.json();

		if (data.success) {
			currentBracketZoom = zoomLevel;
			const zoomDisplay = document.getElementById('currentZoomDisplay');
			if (zoomDisplay) zoomDisplay.textContent = `${zoomLevel.toFixed(1)}x`;
			showAlert(`Bracket zoom set to ${zoomLevel.toFixed(1)}x`, 'success');
		} else {
			showAlert(`Failed to set zoom: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error setting zoom: ${error.message}`, 'error');
	}
}

// Apply the current slider zoom to the bracket display
async function applyBracketZoom() {
	const slider = document.getElementById('bracketZoomSlider');
	if (!slider) return;

	const zoomScale = parseFloat(slider.value);

	try {
		const response = await csrfFetch('/api/bracket/zoom', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ zoomScale })
		});

		const data = await response.json();

		if (data.success) {
			currentBracketZoom = zoomScale;
			document.getElementById('currentZoomDisplay').textContent = `${zoomScale.toFixed(1)}x`;
			showAlert(`Bracket zoom set to ${zoomScale.toFixed(1)}x`, 'success');
		} else {
			showAlert(`Failed to set zoom: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error setting zoom: ${error.message}`, 'error');
	}
}

// Focus on a specific match number or letter
async function focusOnMatch() {
	const matchInput = document.getElementById('bracketMatchInput');
	const zoomCheckbox = document.getElementById('bracketZoomOnFocus');
	const slider = document.getElementById('bracketZoomSlider');

	if (!matchInput) return;

	const inputValue = matchInput.value.trim();
	if (!inputValue) {
		showAlert('Please enter a match number (1-26) or letter (A-Z)', 'error');
		return;
	}

	// Accept either number (1-26) or letter (A-Z)
	// The API will convert numbers to letters (1=A, 2=B, etc.)
	const isNumber = /^\d+$/.test(inputValue);
	const isLetter = /^[a-zA-Z]$/i.test(inputValue);

	if (!isNumber && !isLetter) {
		showAlert('Please enter a match number (1-26) or letter (A-Z)', 'error');
		return;
	}

	const payload = { matchIdentifier: inputValue };

	// If zoom checkbox is checked, include zoom level
	if (zoomCheckbox && zoomCheckbox.checked && slider) {
		payload.zoomScale = parseFloat(slider.value);
	}

	try {
		const response = await csrfFetch('/api/bracket/focus', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		const data = await response.json();

		if (data.success) {
			// Show the letter identifier that was used
			showAlert(`Focused on match ${data.matchIdentifier}`, 'success');
			if (data.zoomScale) {
				currentBracketZoom = data.zoomScale;
				document.getElementById('currentZoomDisplay').textContent = `${data.zoomScale.toFixed(1)}x`;
			}
		} else {
			showAlert(`Failed to focus: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Reset bracket view to default (zoom 1.0, scroll to origin)
async function resetBracketView() {
	try {
		const response = await csrfFetch('/api/bracket/reset', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		});

		const data = await response.json();

		if (data.success) {
			currentBracketZoom = 1.0;

			// Update UI
			const slider = document.getElementById('bracketZoomSlider');
			const valueDisplay = document.getElementById('bracketZoomValue');
			const zoomDisplay = document.getElementById('currentZoomDisplay');

			if (slider) slider.value = 1.0;
			if (valueDisplay) valueDisplay.textContent = '1.0x';
			if (zoomDisplay) zoomDisplay.textContent = '1.0x';

			showAlert('Bracket view reset to default', 'success');
		} else {
			showAlert(`Failed to reset view: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Focus on the current "now playing" match (requires integration with match module)
async function focusOnCurrentMatch() {
	// First, get the current tournament and find underway matches
	try {
		// Get tournament state from match module
		const statusResponse = await fetch('/api/status');
		if (!statusResponse.ok) throw new Error('Failed to get status');

		const statusData = await statusResponse.json();
		const tournamentId = statusData.modules?.match?.state?.tournamentId;

		if (!tournamentId) {
			showAlert('No tournament configured', 'error');
			return;
		}

		// Get matches to find ones that are underway
		const matchResponse = await fetch(`/api/matches/${tournamentId}`);
		if (!matchResponse.ok) throw new Error('Failed to get matches');

		const matchData = await matchResponse.json();
		if (!matchData.success || !matchData.matches) {
			showAlert('No matches found', 'error');
			return;
		}

		// Find matches that are underway (state: open + underwayAt !== null)
		const underwayMatches = matchData.matches.filter(m =>
			m.state === 'open' && m.underwayAt !== null
		);

		if (underwayMatches.length === 0) {
			showAlert('No matches currently in progress', 'info');
			return;
		}

		// Use the first underway match's letter identifier
		// Challonge uses letter identifiers: A, B, C, etc.
		const match = underwayMatches[0];
		const matchIdentifier = match.identifier || match.suggestedPlayOrder || 'A';

		// Focus on this match with current zoom level
		const slider = document.getElementById('bracketZoomSlider');
		const payload = {
			matchIdentifier: matchIdentifier,
			zoomScale: slider ? parseFloat(slider.value) : currentBracketZoom
		};

		const focusResponse = await csrfFetch('/api/bracket/focus', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		const focusData = await focusResponse.json();

		if (focusData.success) {
			showAlert(`Focused on current match (${focusData.matchIdentifier})`, 'success');
		} else {
			showAlert(`Failed to focus: ${focusData.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// ============================================================================
// Ticker Message Functions
// ============================================================================

// Initialize ticker on page load
document.addEventListener('DOMContentLoaded', () => {
	setupTickerCharCount();
});

// Setup character counter for ticker message
function setupTickerCharCount() {
	const textarea = document.getElementById('tickerMessage');
	const charCount = document.getElementById('tickerCharCount');

	if (textarea && charCount) {
		textarea.addEventListener('input', () => {
			const len = textarea.value.length;
			charCount.textContent = `${len}/200`;
		});
	}
}

// Set ticker message from preset button and send immediately
async function setTickerPreset(message) {
	console.log('setTickerPreset called with:', message);
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

// Send ticker message to match display
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

	if (duration < 3 || duration > 30) {
		showAlert('Duration must be between 3 and 30 seconds', 'error');
		return;
	}

	// Update status
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

			// Show sent status briefly
			if (statusEl) {
				statusEl.innerHTML = `
					<span class="text-sm text-green-400">Sent!</span>
				`;
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

// ============================================================================
// Debug Mode Functions
// ============================================================================

let currentDebugDisplayId = null;
let currentDebugLogs = [];

// Toggle debug mode for a display
async function toggleDebugMode(displayId, enabled) {
	try {
		const response = await csrfFetch(`/api/displays/${displayId}/debug`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(data.message, 'success');
			await refreshDisplays();
		} else {
			showAlert(`Failed to toggle debug mode: ${data.error}`, 'error');
			// Revert checkbox state by refreshing
			await refreshDisplays();
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
		await refreshDisplays();
	}
}

// View debug logs for a display
async function viewDebugLogs(displayId, hostname) {
	currentDebugDisplayId = displayId;

	// Update modal header
	document.getElementById('debugLogsHostname').textContent = hostname;

	// Reset filters
	document.getElementById('debugLogsLevelFilter').value = '';
	document.getElementById('debugLogsSourceFilter').value = '';

	// Show modal
	document.getElementById('debugLogsModal').classList.remove('hidden');

	// Load logs
	await refreshDebugLogs();
}

// Close debug logs modal
function closeDebugLogsModal() {
	document.getElementById('debugLogsModal').classList.add('hidden');
	currentDebugDisplayId = null;
	currentDebugLogs = [];
}

// Refresh debug logs
async function refreshDebugLogs() {
	if (!currentDebugDisplayId) return;

	// Show loading state
	const btn = document.getElementById('refreshDebugLogsBtn');
	const icon = document.getElementById('refreshDebugLogsIcon');
	const text = document.getElementById('refreshDebugLogsText');
	if (btn) btn.disabled = true;
	if (icon) {
		icon.classList.remove('hidden');
		icon.classList.add('animate-spin');
	}
	if (text) text.textContent = 'Refreshing...';

	const levelFilter = document.getElementById('debugLogsLevelFilter').value;
	const sourceFilter = document.getElementById('debugLogsSourceFilter').value;

	const contentEl = document.getElementById('debugLogsContent');
	contentEl.innerHTML = '<div class="text-center py-8 text-gray-500"><div class="spinner mx-auto mb-2"></div>Loading logs...</div>';

	try {
		let url = `/api/displays/${currentDebugDisplayId}/logs?limit=500`;
		if (levelFilter) url += `&level=${levelFilter}`;
		if (sourceFilter) url += `&source=${sourceFilter}`;

		const response = await fetch(url);
		const data = await response.json();

		if (data.success) {
			currentDebugLogs = data.logs || [];
			renderDebugLogs();
			document.getElementById('debugLogsCount').textContent =
				`${currentDebugLogs.length} of ${data.totalLogs} logs`;
		} else {
			contentEl.innerHTML = `<div class="text-center py-8 text-red-400">Error: ${data.error}</div>`;
		}
	} catch (error) {
		contentEl.innerHTML = `<div class="text-center py-8 text-red-400">Failed to load logs: ${error.message}</div>`;
	} finally {
		// Reset loading state
		if (btn) btn.disabled = false;
		if (icon) {
			icon.classList.add('hidden');
			icon.classList.remove('animate-spin');
		}
		if (text) text.textContent = 'Refresh';
	}
}

// Filter debug logs (triggered by filter change)
function filterDebugLogs() {
	refreshDebugLogs();
}

// Render debug logs
function renderDebugLogs() {
	const contentEl = document.getElementById('debugLogsContent');

	if (currentDebugLogs.length === 0) {
		contentEl.innerHTML = `
			<div class="text-center py-8 text-gray-500">
				<svg class="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
				</svg>
				<p>No debug logs available</p>
				<p class="text-xs mt-1">Logs will appear here once the Pi sends them</p>
			</div>
		`;
		return;
	}

	// Level color mapping
	const levelColors = {
		debug: 'text-gray-400',
		info: 'text-blue-400',
		warn: 'text-yellow-400',
		error: 'text-red-400'
	};

	// Source color mapping
	const sourceColors = {
		kiosk: 'text-purple-400',
		manager: 'text-green-400',
		chromium: 'text-orange-400',
		system: 'text-cyan-400'
	};

	const logsHtml = currentDebugLogs.map(log => {
		const levelColor = levelColors[log.level] || 'text-gray-400';
		const sourceColor = sourceColors[log.source] || 'text-gray-400';
		const timestamp = formatDateTime(log.timestamp);

		return `
			<div class="py-1 border-b border-gray-800 hover:bg-gray-800/50">
				<span class="text-gray-500">${escapeHtml(timestamp)}</span>
				<span class="${levelColor} uppercase font-bold ml-2">[${escapeHtml(log.level)}]</span>
				<span class="${sourceColor} ml-1">[${escapeHtml(log.source)}]</span>
				<span class="text-white ml-2">${escapeHtml(log.message)}</span>
			</div>
		`;
	}).join('');

	contentEl.innerHTML = logsHtml;
}

// Clear debug logs
async function clearDebugLogs() {
	if (!currentDebugDisplayId) return;

	if (!confirm('Are you sure you want to clear all debug logs for this display?')) return;

	try {
		const response = await csrfFetch(`/api/displays/${currentDebugDisplayId}/logs`, {
			method: 'DELETE'
		});

		const data = await response.json();

		if (data.success) {
			showAlert(data.message, 'success');
			currentDebugLogs = [];
			renderDebugLogs();
			document.getElementById('debugLogsCount').textContent = '0 logs';
			await refreshDisplays();
		} else {
			showAlert(`Failed to clear logs: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Copy debug logs to clipboard
async function copyDebugLogs() {
	if (currentDebugLogs.length === 0) {
		showAlert('No logs to copy', 'info');
		return;
	}

	const logsText = currentDebugLogs.map(log => {
		return `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}`;
	}).join('\n');

	try {
		await navigator.clipboard.writeText(logsText);
		showAlert('Logs copied to clipboard', 'success');
	} catch (error) {
		showAlert(`Failed to copy: ${error.message}`, 'error');
	}
}

// Download debug logs as file
function downloadDebugLogs() {
	if (currentDebugLogs.length === 0) {
		showAlert('No logs to download', 'info');
		return;
	}

	const hostname = document.getElementById('debugLogsHostname').textContent;
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `debug-logs-${hostname}-${timestamp}.json`;

	const data = {
		hostname: hostname,
		displayId: currentDebugDisplayId,
		exportedAt: new Date().toISOString(),
		logCount: currentDebugLogs.length,
		logs: currentDebugLogs
	};

	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);

	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);

	showAlert(`Downloaded ${filename}`, 'success');
}

// Export functions
window.refreshModuleStatus = refreshModuleStatus;
window.refreshDisplays = refreshDisplays;
window.assignDisplayView = assignDisplayView;
window.rebootDisplay = rebootDisplay;
window.shutdownDisplay = shutdownDisplay;
window.setBracketZoom = setBracketZoom;
window.applyBracketZoom = applyBracketZoom;
window.focusOnMatch = focusOnMatch;
window.resetBracketView = resetBracketView;
window.focusOnCurrentMatch = focusOnCurrentMatch;
window.sendTickerMessage = sendTickerMessage;
window.setTickerPreset = setTickerPreset;
window.toggleDebugMode = toggleDebugMode;
window.viewDebugLogs = viewDebugLogs;
window.closeDebugLogsModal = closeDebugLogsModal;
window.refreshDebugLogs = refreshDebugLogs;
window.filterDebugLogs = filterDebugLogs;
window.clearDebugLogs = clearDebugLogs;
window.copyDebugLogs = copyDebugLogs;
window.downloadDebugLogs = downloadDebugLogs;
