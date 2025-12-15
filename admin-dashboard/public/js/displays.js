// Display Management Page JavaScript

// State
let displays = [];
let displaysRefreshInterval = null;
let wsConnected = false;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
	FrontendDebug.log('Displays', 'Initializing Display Management page');

	// Initialize last updated timestamp
	initLastUpdated('displaysLastUpdated', refreshDisplays, { prefix: 'Updated', thresholds: { fresh: 20, stale: 90 } });

	await refreshDisplays();

	// Initialize WebSocket for real-time updates
	initWebSocket();

	// Start polling with visibility awareness
	startPolling();

	// Setup visibility handler to pause/resume polling
	setupVisibilityHandler(
		() => { startPolling(); }, // onVisible
		() => { stopPolling(); }   // onHidden
	);
});

// WebSocket initialization
function initWebSocket() {
	if (!WebSocketManager.init()) {
		FrontendDebug.warn('Displays', 'WebSocket not available, using polling');
		return;
	}

	// Subscribe to display events
	WebSocketManager.subscribeMany({
		'displays:update': handleDisplayUpdate,
		[WS_EVENTS.DISPLAY_REGISTERED]: handleDisplayEvent,
		[WS_EVENTS.DISPLAY_UPDATED]: handleDisplayEvent,
		[WS_EVENTS.DISPLAY_OFFLINE]: handleDisplayEvent
	});

	WebSocketManager.onConnection('connect', () => {
		FrontendDebug.ws('Displays', 'WebSocket connected');
		wsConnected = true;
		// Reduce polling when connected
		stopPolling();
		startPolling(30000); // Slower polling when WS connected
	});

	WebSocketManager.onConnection('disconnect', () => {
		FrontendDebug.ws('Displays', 'WebSocket disconnected');
		wsConnected = false;
		// Increase polling when disconnected
		stopPolling();
		startPolling(15000); // Back to faster polling
	});
}

// Handle display update event
function handleDisplayUpdate(data) {
	FrontendDebug.ws('Displays', 'Update received', { action: data.action });
	refreshDisplays();
}

// Handle specific display events
function handleDisplayEvent(data) {
	FrontendDebug.ws('Displays', 'Event received', data);
	refreshDisplays();
}

function startPolling(displaysInterval = 15000) {
	if (!displaysRefreshInterval) {
		displaysRefreshInterval = setInterval(refreshDisplays, displaysInterval);
	}
}

function stopPolling() {
	if (displaysRefreshInterval) {
		clearInterval(displaysRefreshInterval);
		displaysRefreshInterval = null;
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
		FrontendDebug.error('Displays', 'Failed to load displays', error);
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
window.refreshDisplays = refreshDisplays;
window.assignDisplayView = assignDisplayView;
window.rebootDisplay = rebootDisplay;
window.shutdownDisplay = shutdownDisplay;
window.toggleDebugMode = toggleDebugMode;
window.viewDebugLogs = viewDebugLogs;
window.closeDebugLogsModal = closeDebugLogsModal;
window.refreshDebugLogs = refreshDebugLogs;
window.filterDebugLogs = filterDebugLogs;
window.clearDebugLogs = clearDebugLogs;
window.copyDebugLogs = copyDebugLogs;
window.downloadDebugLogs = downloadDebugLogs;

// ============================================================================
// Flyer Media Controls
// ============================================================================

// Media controls state
let mediaStatus = null;
let mediaSettings = null;
let playlistItems = [];
let availableFlyers = [];
let isPlaying = false;
let isMuted = true;

// Initialize media controls on page load
document.addEventListener('DOMContentLoaded', () => {
	initMediaControls();
});

// Initialize media controls
async function initMediaControls() {
	FrontendDebug.log('Displays', 'Initializing media controls');

	// Load initial settings and status
	await loadMediaSettings();
	await loadAvailableFlyers();

	// Subscribe to flyer status updates via WebSocket
	if (WebSocketManager && WebSocketManager.socket) {
		// Register for admin room to receive status updates
		WebSocketManager.socket.emit('admin:register', {
			userId: window.currentUserId || 1  // Will be set from session
		});

		WebSocketManager.subscribe('flyer:status', handleFlyerStatusUpdate);
	}
}

// Toggle media controls section collapse
function toggleMediaControlsSection() {
	const content = document.getElementById('mediaControlsContent');
	const chevron = document.getElementById('mediaControlsChevron');

	if (content && chevron) {
		const isHidden = content.classList.contains('hidden');
		content.classList.toggle('hidden');
		chevron.classList.toggle('rotate-180', !isHidden);
	}
}

// Load media settings from server
async function loadMediaSettings() {
	try {
		const response = await fetch('/api/displays/flyer/settings');
		if (!response.ok) return;

		const data = await response.json();
		if (data.success && data.settings) {
			mediaSettings = data.settings;
			applyMediaSettingsToUI(data.settings);
			FrontendDebug.log('Displays', 'Media settings loaded', data.settings);
		}
	} catch (error) {
		FrontendDebug.error('Displays', 'Failed to load media settings', error);
	}
}

// Apply loaded settings to UI
function applyMediaSettingsToUI(settings) {
	// Behavior toggles
	const loopEl = document.getElementById('loopEnabled');
	const autoplayEl = document.getElementById('autoplayEnabled');
	const mutedEl = document.getElementById('defaultMuted');

	if (loopEl) loopEl.checked = settings.loopEnabled;
	if (autoplayEl) autoplayEl.checked = settings.autoplayEnabled;
	if (mutedEl) mutedEl.checked = settings.defaultMuted;

	// Volume slider
	const volumeSlider = document.getElementById('volumeSlider');
	if (volumeSlider) {
		volumeSlider.value = settings.defaultVolume || 100;
		updateVolumeDisplay(settings.defaultVolume || 100);
	}

	// Playlist settings
	const playlistEnabledEl = document.getElementById('playlistEnabled');
	const playlistLoopEl = document.getElementById('playlistLoop');
	const playlistAutoAdvanceEl = document.getElementById('playlistAutoAdvance');

	if (playlistEnabledEl) playlistEnabledEl.checked = settings.playlistEnabled;
	if (playlistLoopEl) playlistLoopEl.checked = settings.playlistLoop;
	if (playlistAutoAdvanceEl) playlistAutoAdvanceEl.checked = settings.playlistAutoAdvance;

	// Show/hide playlist containers
	updatePlaylistUIVisibility(settings.playlistEnabled);

	// Playlist items
	playlistItems = settings.playlistItems || [];
	renderPlaylistItems();

	// Current status
	updateStatusDisplay({
		filename: settings.currentFlyer,
		state: settings.playbackState,
		currentTime: settings.currentTime,
		duration: settings.duration,
		volume: settings.currentVolume,
		muted: settings.isMuted,
		playlistIndex: settings.playlistCurrentIndex
	});
}

// Handle real-time flyer status update from WebSocket
function handleFlyerStatusUpdate(data) {
	FrontendDebug.ws('Displays', 'Flyer status update', data);
	updateStatusDisplay(data);
}

// Update status display elements
function updateStatusDisplay(status) {
	if (!status) return;

	// Current media name
	const mediaNameEl = document.getElementById('currentMediaName');
	if (mediaNameEl) {
		mediaNameEl.textContent = status.filename || 'No media';
	}

	// Playback state indicator and text
	const stateIndicator = document.getElementById('playbackStateIndicator');
	const stateText = document.getElementById('playbackStateText');

	if (stateIndicator) {
		stateIndicator.className = 'playback-state-dot';
		if (status.state === 'playing') {
			stateIndicator.classList.add('playing');
		} else if (status.state === 'paused') {
			stateIndicator.classList.add('paused');
		} else {
			stateIndicator.classList.add('stopped');
		}
	}

	if (stateText) {
		const stateLabels = { playing: 'Playing', paused: 'Paused', stopped: 'Stopped' };
		stateText.textContent = stateLabels[status.state] || 'Stopped';
	}

	// Update play/pause button icon
	isPlaying = status.state === 'playing';
	const playIcon = document.getElementById('playIcon');
	const pauseIcon = document.getElementById('pauseIcon');
	if (playIcon && pauseIcon) {
		playIcon.classList.toggle('hidden', isPlaying);
		pauseIcon.classList.toggle('hidden', !isPlaying);
	}

	// Progress bar
	if (status.duration > 0) {
		const progress = (status.currentTime / status.duration) * 100;
		const progressFill = document.getElementById('progressFill');
		if (progressFill) {
			progressFill.style.width = `${progress}%`;
		}
	}

	// Time displays
	const currentTimeEl = document.getElementById('currentTimeDisplay');
	const durationEl = document.getElementById('durationDisplay');
	if (currentTimeEl) currentTimeEl.textContent = formatTime(status.currentTime || 0);
	if (durationEl) durationEl.textContent = formatTime(status.duration || 0);

	// Volume display
	const volumeDisplayEl = document.getElementById('volumeDisplay');
	if (volumeDisplayEl) {
		volumeDisplayEl.textContent = `${status.volume || 0}%`;
	}

	// Mute indicator
	isMuted = status.muted;
	const mutedIndicatorEl = document.getElementById('mutedIndicator');
	const muteIcon = document.getElementById('muteIcon');
	const unmuteIcon = document.getElementById('unmuteIcon');

	if (mutedIndicatorEl) {
		mutedIndicatorEl.classList.toggle('hidden', !status.muted);
	}
	if (muteIcon && unmuteIcon) {
		muteIcon.classList.toggle('hidden', !status.muted);
		unmuteIcon.classList.toggle('hidden', status.muted);
	}

	// Playlist position
	if (playlistItems.length > 0 && status.playlistIndex !== undefined) {
		const positionEl = document.getElementById('playlistPosition');
		if (positionEl) {
			positionEl.textContent = `${status.playlistIndex + 1} / ${playlistItems.length}`;
		}
	}
}

// Format time in MM:SS
function formatTime(seconds) {
	if (isNaN(seconds) || seconds < 0) return '0:00';
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Send media control command
async function sendMediaControl(action) {
	try {
		const response = await csrfFetch('/api/displays/flyer/control', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action })
		});

		const data = await response.json();
		if (!data.success) {
			showAlert(`Control failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Toggle play/pause
function togglePlayPause() {
	sendMediaControl(isPlaying ? 'pause' : 'play');
}

// Toggle mute
function toggleMute() {
	sendMediaControl(isMuted ? 'unmute' : 'mute');
}

// Update volume display as slider moves
function updateVolumeDisplay(value) {
	const sliderValue = document.getElementById('volumeSliderValue');
	if (sliderValue) {
		sliderValue.textContent = `${value}%`;
	}
}

// Set volume
async function setVolume(value) {
	try {
		const response = await csrfFetch('/api/displays/flyer/volume', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ volume: parseInt(value) })
		});

		const data = await response.json();
		if (!data.success) {
			showAlert(`Volume failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Save media settings
async function saveMediaSettings() {
	const loopEnabled = document.getElementById('loopEnabled')?.checked;
	const autoplayEnabled = document.getElementById('autoplayEnabled')?.checked;
	const defaultMuted = document.getElementById('defaultMuted')?.checked;

	try {
		const response = await csrfFetch('/api/displays/flyer/settings', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ loopEnabled, autoplayEnabled, defaultMuted })
		});

		const data = await response.json();
		if (data.success) {
			showAlert('Settings saved', 'success');
		} else {
			showAlert(`Save failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// ============================================================================
// Playlist Functions
// ============================================================================

// Toggle playlist mode
async function togglePlaylist() {
	const enabled = document.getElementById('playlistEnabled')?.checked;

	try {
		const response = await csrfFetch('/api/displays/flyer/playlist/control', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'toggle', enabled })
		});

		const data = await response.json();
		if (data.success) {
			updatePlaylistUIVisibility(enabled);
			showAlert(enabled ? 'Playlist mode enabled' : 'Playlist mode disabled', 'success');
		} else {
			showAlert(`Failed: ${data.error}`, 'error');
			// Revert checkbox
			document.getElementById('playlistEnabled').checked = !enabled;
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
		document.getElementById('playlistEnabled').checked = !enabled;
	}
}

// Update playlist UI visibility
function updatePlaylistUIVisibility(enabled) {
	const container = document.getElementById('playlistContainer');
	const controls = document.getElementById('playlistControlsContainer');

	if (container) container.classList.toggle('hidden', !enabled);
	if (controls) controls.classList.toggle('hidden', !enabled);
}

// Load available flyers for playlist dropdown
async function loadAvailableFlyers() {
	try {
		const response = await fetch('/api/flyers');
		if (!response.ok) return;

		const data = await response.json();
		if (data.success) {
			availableFlyers = data.flyers || [];
			updatePlaylistDropdown();
		}
	} catch (error) {
		FrontendDebug.error('Displays', 'Failed to load flyers', error);
	}
}

// Update playlist dropdown options
function updatePlaylistDropdown() {
	const select = document.getElementById('addToPlaylistSelect');
	if (!select) return;

	select.innerHTML = '<option value="">Select flyer to add...</option>';

	availableFlyers.forEach(flyer => {
		const option = document.createElement('option');
		option.value = flyer.filename;
		option.textContent = flyer.filename;
		select.appendChild(option);
	});
}

// Add item to playlist
async function addToPlaylist() {
	const select = document.getElementById('addToPlaylistSelect');
	const filename = select?.value;

	if (!filename) {
		showAlert('Please select a flyer', 'warning');
		return;
	}

	// Determine if it's a video or image
	const isVideo = filename.toLowerCase().endsWith('.mp4');
	const defaultDuration = isVideo ? 0 : 10; // Videos use their natural duration

	// Add to local array
	playlistItems.push({ filename, duration: defaultDuration });

	// Save to server
	await savePlaylist();

	// Reset dropdown
	select.value = '';
}

// Remove item from playlist
async function removeFromPlaylist(index) {
	playlistItems.splice(index, 1);
	await savePlaylist();
}

// Update item duration
async function updatePlaylistItemDuration(index, duration) {
	playlistItems[index].duration = parseInt(duration) || 0;
	await savePlaylist();
}

// Save playlist to server
async function savePlaylist() {
	const loop = document.getElementById('playlistLoop')?.checked;
	const autoAdvance = document.getElementById('playlistAutoAdvance')?.checked;

	try {
		const response = await csrfFetch('/api/displays/flyer/playlist', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				items: playlistItems,
				loop,
				autoAdvance
			})
		});

		const data = await response.json();
		if (data.success) {
			renderPlaylistItems();
		} else {
			showAlert(`Save failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Save playlist settings (loop, auto-advance)
function savePlaylistSettings() {
	savePlaylist();
}

// Render playlist items
function renderPlaylistItems() {
	const container = document.getElementById('playlistItems');
	const countEl = document.getElementById('playlistCount');

	if (countEl) {
		countEl.textContent = `${playlistItems.length} items`;
	}

	if (!container) return;

	if (playlistItems.length === 0) {
		container.innerHTML = '<div class="text-center py-4 text-gray-500 text-sm">No items in playlist</div>';
		return;
	}

	container.innerHTML = playlistItems.map((item, index) => {
		const isVideo = item.filename.toLowerCase().endsWith('.mp4');
		const icon = isVideo
			? '<svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
			: '<svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>';

		return `
			<div class="playlist-item flex items-center gap-2 p-2 bg-gray-600/50 rounded">
				<span class="text-gray-400 text-xs w-5">${index + 1}.</span>
				${icon}
				<span class="flex-1 text-white text-sm truncate" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span>
				${!isVideo ? `
					<input type="number" value="${item.duration}" min="1" max="300"
						onchange="updatePlaylistItemDuration(${index}, this.value)"
						class="w-16 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white text-center"
						title="Duration in seconds">
					<span class="text-xs text-gray-500">sec</span>
				` : '<span class="text-xs text-gray-500 w-20 text-center">auto</span>'}
				<button onclick="removeFromPlaylist(${index})" class="text-red-400 hover:text-red-300 p-1" title="Remove">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			</div>
		`;
	}).join('');

	// Update position display
	const positionEl = document.getElementById('playlistPosition');
	if (positionEl && playlistItems.length > 0) {
		const currentIndex = mediaSettings?.playlistCurrentIndex || 0;
		positionEl.textContent = `${currentIndex + 1} / ${playlistItems.length}`;
	}
}

// Playlist navigation
async function playlistControl(action) {
	try {
		const response = await csrfFetch('/api/displays/flyer/playlist/control', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action })
		});

		const data = await response.json();
		if (!data.success) {
			showAlert(`Failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Error: ${error.message}`, 'error');
	}
}

// Export media control functions
window.toggleMediaControlsSection = toggleMediaControlsSection;
window.sendMediaControl = sendMediaControl;
window.togglePlayPause = togglePlayPause;
window.toggleMute = toggleMute;
window.updateVolumeDisplay = updateVolumeDisplay;
window.setVolume = setVolume;
window.saveMediaSettings = saveMediaSettings;
window.togglePlaylist = togglePlaylist;
window.addToPlaylist = addToPlaylist;
window.removeFromPlaylist = removeFromPlaylist;
window.updatePlaylistItemDuration = updatePlaylistItemDuration;
window.savePlaylistSettings = savePlaylistSettings;
window.playlistControl = playlistControl;
