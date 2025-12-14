// Shared utility functions for Tournament Control Center
// This file should be included before page-specific JS files

// Central Time Zone constant - all displayed times use this
const TIMEZONE = 'America/Chicago';

// ============================================
// FRONTEND DEBUG LOGGING
// ============================================

/**
 * Frontend Debug Logger
 * Enable by setting localStorage.setItem('DEBUG_MODE', 'true')
 * Or by adding ?debug=true to the URL
 */
const FrontendDebug = (function() {
	// Check if debug mode is enabled
	const isEnabled = () => {
		if (localStorage.getItem('DEBUG_MODE') === 'true') return true;
		if (window.location.search.includes('debug=true')) return true;
		return false;
	};

	// Color schemes for different log types
	const colors = {
		log: '#4CAF50',      // Green
		warn: '#FF9800',     // Orange
		error: '#F44336',    // Red
		api: '#2196F3',      // Blue
		ws: '#9C27B0',       // Purple
		state: '#00BCD4',    // Cyan
		action: '#FF5722'    // Deep Orange
	};

	// Create styled console output
	const createLog = (type, prefix, message, data) => {
		if (!isEnabled()) return;

		const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
		const color = colors[type] || colors.log;

		if (data !== undefined) {
			console.log(
				`%c[${timestamp}] [${prefix}] ${message}`,
				`color: ${color}; font-weight: bold`,
				data
			);
		} else {
			console.log(
				`%c[${timestamp}] [${prefix}] ${message}`,
				`color: ${color}; font-weight: bold`
			);
		}
	};

	return {
		isEnabled,
		log: (prefix, message, data) => createLog('log', prefix, message, data),
		warn: (prefix, message, data) => createLog('warn', prefix, message, data),
		error: (prefix, message, data) => createLog('error', prefix, message, data),
		api: (prefix, message, data) => createLog('api', prefix, message, data),
		ws: (prefix, message, data) => createLog('ws', prefix, message, data),
		state: (prefix, message, data) => createLog('state', prefix, message, data),
		action: (prefix, message, data) => createLog('action', prefix, message, data),
		// Enable/disable methods
		enable: () => { localStorage.setItem('DEBUG_MODE', 'true'); console.log('Debug mode enabled'); },
		disable: () => { localStorage.removeItem('DEBUG_MODE'); console.log('Debug mode disabled'); }
	};
})();

// Export for global access
window.FrontendDebug = FrontendDebug;

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
	if (!text) return '';
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

/**
 * Show alert notification
 * @param {string} message - Message to display
 * @param {string} type - Alert type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Auto-dismiss duration in ms (default 5000)
 */
function showAlert(message, type = 'info', duration = 5000) {
	let container = document.getElementById('alertContainer');
	if (!container) {
		container = document.createElement('div');
		container.id = 'alertContainer';
		container.className = 'fixed top-4 right-4 z-50 space-y-2 max-w-md';
		document.body.appendChild(container);
	}

	const alert = document.createElement('div');
	alert.className = `alert alert-${type}`;
	alert.innerHTML = `
		<div class="flex items-center justify-between">
			<span>${escapeHtml(message)}</span>
			<button onclick="this.parentElement.parentElement.remove()" class="text-xl ml-4">&times;</button>
		</div>
	`;
	container.appendChild(alert);

	if (duration > 0) {
		setTimeout(() => {
			alert.style.opacity = '0';
			setTimeout(() => alert.remove(), 300);
		}, duration);
	}
}

/**
 * Format date to relative or absolute string (Central Time)
 * @param {string|Date} dateString - Date to format
 * @returns {string} Formatted date
 */
function formatDate(dateString) {
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now - date;
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays === 0) {
		return 'Today';
	} else if (diffDays === 1) {
		return 'Yesterday';
	} else if (diffDays < 7) {
		return `${diffDays} days ago`;
	} else {
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TIMEZONE });
	}
}

/**
 * Format date with full details (Central Time)
 * @param {string|Date} dateString - Date to format
 * @returns {string} Formatted date like "Dec 9, 2025"
 */
function formatDateFull(dateString) {
	if (!dateString) return '--';
	const date = new Date(dateString);
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: TIMEZONE
	});
}

/**
 * Format date and time together (Central Time)
 * @param {string|Date} dateString - Date to format
 * @returns {string} Formatted datetime like "Dec 9, 2025, 8:00 PM CT"
 */
function formatDateTime(dateString) {
	if (!dateString) return '--';
	const date = new Date(dateString);
	return date.toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: TIMEZONE
	}) + ' CT';
}

/**
 * Format date and time short form (Central Time)
 * @param {string|Date} dateString - Date to format
 * @returns {string} Formatted datetime like "Dec 9, 8:00 PM"
 */
function formatDateTimeShort(dateString) {
	if (!dateString) return '--';
	const date = new Date(dateString);
	return date.toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: TIMEZONE
	});
}

/**
 * Format file size to human readable
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
function formatFileSize(bytes) {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Format timestamp to readable time (Central Time)
 * @param {string|Date} timestamp - Timestamp to format
 * @returns {string} Formatted time like "8:00 PM"
 */
function formatTime(timestamp) {
	if (!timestamp) return '--';
	const date = new Date(timestamp);
	return date.toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: TIMEZONE
	});
}

/**
 * Format time with CT suffix (Central Time)
 * @param {string|Date} timestamp - Timestamp to format
 * @returns {string} Formatted time like "8:00 PM CT"
 */
function formatTimeCT(timestamp) {
	if (!timestamp) return '--';
	return formatTime(timestamp) + ' CT';
}

/**
 * Format timestamp to relative "time ago" string
 * @param {string|Date} dateStr - Date to format
 * @returns {string} Relative time like "5 minutes ago"
 */
function formatTimeAgo(dateStr) {
	if (!dateStr) return 'Never';
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now - date;
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHour = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHour / 24);

	if (diffSec < 60) {
		return 'Just now';
	} else if (diffMin < 60) {
		return `${diffMin}m ago`;
	} else if (diffHour < 24) {
		return `${diffHour}h ago`;
	} else if (diffDay < 7) {
		return `${diffDay}d ago`;
	} else {
		return formatDateFull(dateStr);
	}
}

/**
 * Get freshness level based on timestamp age
 * @param {string|Date} dateStr - Date to check
 * @param {Object} thresholds - Custom thresholds in seconds {fresh, stale}
 * @returns {string} Freshness level: 'fresh', 'stale', or 'old'
 */
function getFreshness(dateStr, thresholds = { fresh: 30, stale: 120 }) {
	if (!dateStr) return 'old';
	const date = new Date(dateStr);
	const now = new Date();
	const diffSec = Math.floor((now - date) / 1000);

	if (diffSec <= thresholds.fresh) {
		return 'fresh';
	} else if (diffSec <= thresholds.stale) {
		return 'stale';
	} else {
		return 'old';
	}
}

/**
 * Get CSS color class based on freshness
 * @param {string} freshness - Freshness level from getFreshness()
 * @returns {string} Tailwind CSS color class
 */
function getFreshnessColor(freshness) {
	switch (freshness) {
		case 'fresh': return 'text-green-400';
		case 'stale': return 'text-yellow-400';
		case 'old': return 'text-gray-500';
		default: return 'text-gray-500';
	}
}

/**
 * Format relative time with freshness info
 * @param {string|Date} dateStr - Date to format
 * @param {Object} thresholds - Custom thresholds in seconds
 * @returns {Object} {text, freshness, colorClass}
 */
function formatRelativeTime(dateStr, thresholds) {
	const text = formatTimeAgo(dateStr);
	const freshness = getFreshness(dateStr, thresholds);
	const colorClass = getFreshnessColor(freshness);
	return { text, freshness, colorClass };
}

// Last Updated Timestamp Manager
const lastUpdatedTimestamps = {};

/**
 * Initialize a last updated timestamp display
 * @param {string} elementId - ID of the container element
 * @param {Function} onRefreshClick - Callback when user clicks to refresh
 * @param {Object} options - Custom options {thresholds, prefix}
 */
function initLastUpdated(elementId, onRefreshClick, options = {}) {
	const container = document.getElementById(elementId);
	if (!container) return;

	const prefix = options.prefix || 'Updated';
	const thresholds = options.thresholds || { fresh: 30, stale: 120 };

	// Create the timestamp element if it doesn't exist
	let timestampEl = container.querySelector('.last-updated-time');
	if (!timestampEl) {
		container.innerHTML = `
			<span class="last-updated-prefix text-gray-500 text-xs">${prefix}:</span>
			<span class="last-updated-time text-xs cursor-pointer hover:underline" title="Click to refresh">--</span>
		`;
		timestampEl = container.querySelector('.last-updated-time');
	}

	// Store config
	lastUpdatedTimestamps[elementId] = {
		timestamp: null,
		thresholds,
		onRefreshClick,
		intervalId: null
	};

	// Click to refresh
	if (onRefreshClick) {
		timestampEl.addEventListener('click', () => {
			onRefreshClick();
		});
	}

	// Start auto-update interval (every 10 seconds)
	lastUpdatedTimestamps[elementId].intervalId = setInterval(() => {
		updateLastUpdatedDisplay(elementId);
	}, 10000);
}

/**
 * Update the timestamp value
 * @param {string} elementId - ID of the container element
 * @param {Date|string} timestamp - New timestamp (defaults to now)
 */
function setLastUpdated(elementId, timestamp = new Date()) {
	if (!lastUpdatedTimestamps[elementId]) {
		// Auto-initialize if not already done
		lastUpdatedTimestamps[elementId] = {
			timestamp: null,
			thresholds: { fresh: 30, stale: 120 },
			onRefreshClick: null,
			intervalId: null
		};
	}
	lastUpdatedTimestamps[elementId].timestamp = timestamp;
	updateLastUpdatedDisplay(elementId);
}

/**
 * Update the display of a last updated timestamp
 * @param {string} elementId - ID of the container element
 */
function updateLastUpdatedDisplay(elementId) {
	const config = lastUpdatedTimestamps[elementId];
	if (!config) return;

	const container = document.getElementById(elementId);
	if (!container) return;

	const timestampEl = container.querySelector('.last-updated-time');
	if (!timestampEl) return;

	const { text, colorClass } = formatRelativeTime(config.timestamp, config.thresholds);

	// Update text and color
	timestampEl.textContent = text;
	timestampEl.className = `last-updated-time text-xs cursor-pointer hover:underline ${colorClass}`;
}

/**
 * Get current time formatted in Central Time
 * @returns {string} Current time like "8:00:00 PM"
 */
function getCurrentTimeCT() {
	return new Date().toLocaleTimeString('en-US', { timeZone: TIMEZONE });
}

/**
 * Debounce function to limit rapid calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
	let timeout;
	return function executedFunction(...args) {
		const later = () => {
			clearTimeout(timeout);
			func(...args);
		};
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
	};
}

/**
 * Page Visibility API helper - pauses/resumes polling when tab visibility changes
 * @param {Function} onVisible - Callback when page becomes visible
 * @param {Function} onHidden - Callback when page becomes hidden
 */
function setupVisibilityHandler(onVisible, onHidden) {
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			onHidden && onHidden();
		} else {
			onVisible && onVisible();
		}
	});
}

/**
 * Create a polling manager that respects page visibility
 * @param {Function} pollFn - Function to call on each poll
 * @param {number} interval - Polling interval in ms
 * @returns {Object} Controller with start, stop, pause, resume methods
 */
function createPollingManager(pollFn, interval) {
	let timerId = null;
	let isPaused = false;

	const start = () => {
		if (timerId) return;
		pollFn(); // Initial call
		timerId = setInterval(() => {
			if (!isPaused) pollFn();
		}, interval);
	};

	const stop = () => {
		if (timerId) {
			clearInterval(timerId);
			timerId = null;
		}
	};

	const pause = () => { isPaused = true; };
	const resume = () => {
		isPaused = false;
		pollFn(); // Immediate refresh on resume
	};

	// Auto-pause when tab hidden
	setupVisibilityHandler(resume, pause);

	return { start, stop, pause, resume };
}

// ============================================
// CSRF PROTECTION
// ============================================

const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * Get CSRF token from cookie
 * @returns {string|null} CSRF token or null if not found
 */
function getCsrfToken() {
	const match = document.cookie.match(new RegExp('(^| )' + CSRF_COOKIE_NAME + '=([^;]+)'));
	return match ? match[2] : null;
}

/**
 * CSRF-protected fetch wrapper
 * Automatically includes CSRF token header for state-changing requests (POST, PUT, DELETE, PATCH)
 * Also resets session timer on successful API calls (since rolling sessions extend on activity)
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>}
 */
async function csrfFetch(url, options = {}) {
	const method = (options.method || 'GET').toUpperCase();

	// Add CSRF header for state-changing methods
	if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
		const token = getCsrfToken();
		if (token) {
			options.headers = {
				...options.headers,
				[CSRF_HEADER_NAME]: token
			};
		}
	}

	const response = await fetch(url, options);

	// Handle CSRF token errors - attempt refresh and retry once
	if (response.status === 403) {
		try {
			const data = await response.clone().json();
			if (data.code === 'CSRF_INVALID') {
				// Token might have expired/rotated - refresh and retry once
				await refreshCsrfToken();
				const newToken = getCsrfToken();
				if (newToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
					options.headers = {
						...options.headers,
						[CSRF_HEADER_NAME]: newToken
					};
					return fetch(url, options);
				}
			}
		} catch (e) {
			// JSON parse failed, not a CSRF error
		}
	}

	// Reset session timer on successful API calls (rolling session behavior)
	if (response.ok && typeof window.resetSessionTimer === 'function') {
		window.resetSessionTimer();
	}

	return response;
}

/**
 * Refresh CSRF token from server
 * Call this if token validation fails or on session expiration
 * @returns {Promise<string|null>} New token or null on failure
 */
async function refreshCsrfToken() {
	try {
		const response = await fetch('/api/csrf-token');
		if (response.ok) {
			const data = await response.json();
			return data.token || null;
		}
	} catch (error) {
		console.error('Failed to refresh CSRF token:', error);
	}
	return null;
}

// ============================================
// CACHE INDICATORS
// ============================================

/**
 * Get cache status class based on cache info
 * @param {Object} cacheInfo - Cache metadata from API response (_cache field)
 * @returns {string} CSS class for styling
 */
function getCacheStatusClass(cacheInfo) {
	if (!cacheInfo) return 'cache-unknown';
	if (cacheInfo.offline) return 'cache-offline';
	if (cacheInfo.stale) return 'cache-stale';
	if (cacheInfo.hit) return 'cache-hit';
	return 'cache-fresh';
}

/**
 * Get cache status text
 * @param {Object} cacheInfo - Cache metadata from API response
 * @returns {string} Human-readable status text
 */
function getCacheStatusText(cacheInfo) {
	if (!cacheInfo) return 'Unknown';
	if (cacheInfo.offline) return 'Offline (cached)';
	if (cacheInfo.stale) return 'Stale';
	if (cacheInfo.hit) return `Cached (${cacheInfo.ageSeconds}s ago)`;
	return 'Fresh';
}

/**
 * Render cache indicator HTML
 * @param {Object} cacheInfo - Cache metadata from API response (_cache field)
 * @returns {string} HTML string for cache indicator
 */
function renderCacheIndicator(cacheInfo) {
	if (!cacheInfo) return '';

	const statusClass = getCacheStatusClass(cacheInfo);
	const statusText = getCacheStatusText(cacheInfo);

	// Determine icon based on status
	let icon = '';
	if (cacheInfo.offline) {
		icon = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M12 9v2m0 4h.01"></path></svg>';
	} else if (cacheInfo.stale) {
		icon = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
	} else if (cacheInfo.hit) {
		icon = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"></path></svg>';
	} else {
		icon = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
	}

	return `<span class="cache-indicator ${statusClass}" title="${statusText}">
		${icon}
		<span class="cache-indicator-text">${cacheInfo.hit ? 'Cached' : 'Live'}</span>
	</span>`;
}

/**
 * Render compact cache badge (just dot + status)
 * @param {Object} cacheInfo - Cache metadata from API response
 * @returns {string} HTML string for compact badge
 */
function renderCacheBadge(cacheInfo) {
	if (!cacheInfo) return '';

	const statusClass = getCacheStatusClass(cacheInfo);
	const statusText = getCacheStatusText(cacheInfo);

	return `<span class="cache-badge ${statusClass}" title="${statusText}">
		<span class="cache-dot"></span>
	</span>`;
}

/**
 * Show a cache warning banner when data may be stale
 * @param {Object} cacheInfo - Cache metadata from API response (_cache field)
 * @param {Object} options - Display options
 * @param {number} options.staleThreshold - Seconds after which to show warning (default: 60)
 * @param {Function} options.onRefresh - Callback when refresh is clicked
 * @param {string} options.containerId - ID of container to prepend banner to (default: 'main')
 */
function showCacheWarningBanner(cacheInfo, options = {}) {
	const staleThreshold = options.staleThreshold || 60;
	const containerId = options.containerId || 'main';

	// Remove existing banner
	const existingBanner = document.getElementById('cacheWarningBanner');
	if (existingBanner) {
		existingBanner.remove();
	}

	// Only show if data is stale or offline
	if (!cacheInfo) return;
	if (!cacheInfo.stale && !cacheInfo.offline && cacheInfo.ageSeconds < staleThreshold) return;

	const container = document.getElementById(containerId) || document.querySelector('main') || document.body;

	const banner = document.createElement('div');
	banner.id = 'cacheWarningBanner';
	banner.className = 'cache-warning-banner flex items-center justify-between px-4 py-2 mb-4 rounded-lg ' +
		(cacheInfo.offline ? 'bg-red-900/50 border border-red-700 text-red-200' : 'bg-yellow-900/50 border border-yellow-700 text-yellow-200');

	const ageText = cacheInfo.ageSeconds >= 60
		? `${Math.round(cacheInfo.ageSeconds / 60)}m`
		: `${cacheInfo.ageSeconds}s`;

	let message = cacheInfo.offline
		? `Offline mode - showing cached data from ${ageText} ago`
		: `Data may be ${ageText} old`;

	banner.innerHTML = `
		<div class="flex items-center gap-2">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
			</svg>
			<span>${message}</span>
		</div>
		<button id="cacheWarningRefresh" class="text-sm underline hover:no-underline">
			Refresh
		</button>
	`;

	container.insertBefore(banner, container.firstChild);

	// Add refresh click handler
	if (options.onRefresh) {
		document.getElementById('cacheWarningRefresh').addEventListener('click', () => {
			banner.remove();
			options.onRefresh();
		});
	}
}

/**
 * Hide the cache warning banner
 */
function hideCacheWarningBanner() {
	const banner = document.getElementById('cacheWarningBanner');
	if (banner) {
		banner.remove();
	}
}

// ============================================
// CONFIRMATION MODAL (Non-blocking)
// ============================================

// State for confirm modal
let confirmModalResolve = null;

/**
 * Show a non-blocking confirmation modal
 * @param {string} message - Main message to display
 * @param {Object} options - Optional settings
 * @param {string} options.title - Modal title (default: 'Confirm')
 * @param {string} options.confirmText - Confirm button text (default: 'Confirm')
 * @param {string} options.cancelText - Cancel button text (default: 'Cancel')
 * @param {string} options.confirmClass - CSS class for confirm button (default: 'bg-red-600 hover:bg-red-700')
 * @param {boolean} options.dangerous - If true, uses red styling (default: false)
 * @returns {Promise<boolean>} Resolves to true if confirmed, false if cancelled
 */
function showConfirmModal(message, options = {}) {
	return new Promise((resolve) => {
		confirmModalResolve = resolve;

		const title = options.title || 'Confirm';
		const confirmText = options.confirmText || 'Confirm';
		const cancelText = options.cancelText || 'Cancel';
		const dangerous = options.dangerous !== false; // Default to dangerous styling
		const confirmClass = options.confirmClass || (dangerous ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700');

		// Create modal if it doesn't exist
		let modal = document.getElementById('confirmModal');
		if (!modal) {
			modal = document.createElement('div');
			modal.id = 'confirmModal';
			modal.className = 'fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center z-[60]';
			modal.innerHTML = `
				<div class="bg-gray-800 rounded-lg shadow-2xl p-6 w-full max-w-md border border-gray-700 mx-4">
					<div class="flex items-center justify-between mb-4">
						<h3 id="confirmModalTitle" class="text-xl font-bold text-white"></h3>
						<button onclick="closeConfirmModal(false)" class="text-gray-400 hover:text-white text-2xl">&times;</button>
					</div>
					<div id="confirmModalMessage" class="text-gray-300 mb-6 whitespace-pre-line"></div>
					<div class="flex gap-3">
						<button
							onclick="closeConfirmModal(false)"
							id="confirmModalCancelBtn"
							class="flex-1 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-md transition"
						></button>
						<button
							onclick="closeConfirmModal(true)"
							id="confirmModalConfirmBtn"
							class="flex-1 text-white px-4 py-2 rounded-md transition"
						></button>
					</div>
				</div>
			`;
			document.body.appendChild(modal);

			// Close on backdrop click
			modal.addEventListener('click', (e) => {
				if (e.target === modal) {
					closeConfirmModal(false);
				}
			});

			// Close on Escape key
			document.addEventListener('keydown', (e) => {
				if (e.key === 'Escape' && modal.classList.contains('flex')) {
					closeConfirmModal(false);
				}
			});
		}

		// Update modal content
		document.getElementById('confirmModalTitle').textContent = title;
		document.getElementById('confirmModalMessage').textContent = message;
		document.getElementById('confirmModalCancelBtn').textContent = cancelText;
		const confirmBtn = document.getElementById('confirmModalConfirmBtn');
		confirmBtn.textContent = confirmText;
		confirmBtn.className = `flex-1 text-white px-4 py-2 rounded-md transition ${confirmClass}`;

		// Show modal
		modal.classList.remove('hidden');
		modal.classList.add('flex');

		// Focus confirm button for keyboard accessibility
		confirmBtn.focus();
	});
}

/**
 * Close the confirmation modal and resolve the promise
 * @param {boolean} result - true if confirmed, false if cancelled
 */
function closeConfirmModal(result) {
	const modal = document.getElementById('confirmModal');
	if (modal) {
		modal.classList.add('hidden');
		modal.classList.remove('flex');
	}
	if (confirmModalResolve) {
		confirmModalResolve(result);
		confirmModalResolve = null;
	}
}

// ============================================
// WebSocket Manager - Real-time Updates
// ============================================

/**
 * WebSocket event types for real-time updates
 */
const WS_EVENTS = {
	// Tournament events
	TOURNAMENT_CREATED: 'tournament:created',
	TOURNAMENT_UPDATED: 'tournament:updated',
	TOURNAMENT_DELETED: 'tournament:deleted',
	TOURNAMENT_STARTED: 'tournament:started',
	TOURNAMENT_RESET: 'tournament:reset',
	TOURNAMENT_COMPLETED: 'tournament:completed',

	// Match events
	MATCH_UPDATED: 'match:updated',
	MATCH_SCORED: 'match:scored',
	MATCH_STARTED: 'match:started',

	// Participant events
	PARTICIPANT_ADDED: 'participant:added',
	PARTICIPANT_UPDATED: 'participant:updated',
	PARTICIPANT_DELETED: 'participant:deleted',
	PARTICIPANT_CHECKIN: 'participant:checkin',
	PARTICIPANTS_BULK: 'participants:bulk',
	PARTICIPANTS_SEEDED: 'participants:seeded',

	// Station events
	STATION_CREATED: 'station:created',
	STATION_DELETED: 'station:deleted',
	STATION_ASSIGNED: 'station:assigned',

	// Display events
	DISPLAY_REGISTERED: 'display:registered',
	DISPLAY_UPDATED: 'display:updated',
	DISPLAY_OFFLINE: 'display:offline',

	// Flyer events
	FLYER_UPLOADED: 'flyer:uploaded',
	FLYER_DELETED: 'flyer:deleted',
	FLYER_ACTIVATED: 'flyer:activated',

	// Sponsor events
	SPONSOR_UPDATED: 'sponsor:updated',

	// System events
	SYSTEM_STATUS: 'system:status'
};

/**
 * WebSocket Manager Singleton
 * Provides centralized WebSocket connection for all pages
 */
const WebSocketManager = (function() {
	let socket = null;
	let isConnected = false;
	let reconnectAttempts = 0;
	const maxReconnectAttempts = 10;
	const listeners = new Map(); // eventType -> Set of callbacks
	const connectionCallbacks = { connect: [], disconnect: [] };

	/**
	 * Initialize WebSocket connection
	 * @returns {boolean} Whether initialization was successful
	 */
	function init() {
		if (socket && isConnected) {
			console.log('[WS] Already connected');
			return true;
		}

		if (typeof io === 'undefined') {
			console.error('[WS] Socket.IO not loaded');
			return false;
		}

		socket = io(window.location.origin, {
			transports: ['websocket', 'polling'],
			reconnection: true,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 5000,
			reconnectionAttempts: maxReconnectAttempts
		});

		socket.on('connect', () => {
			console.log('[WS] Connected');
			isConnected = true;
			reconnectAttempts = 0;
			socket.emit('admin:register');
			connectionCallbacks.connect.forEach(cb => cb());
		});

		socket.on('disconnect', (reason) => {
			console.log('[WS] Disconnected:', reason);
			isConnected = false;
			connectionCallbacks.disconnect.forEach(cb => cb(reason));
		});

		socket.on('connect_error', (error) => {
			console.error('[WS] Connection error:', error.message);
			reconnectAttempts++;
		});

		// Set up event forwarding for all registered listeners
		Object.values(WS_EVENTS).forEach(eventType => {
			socket.on(eventType, (data) => {
				const eventListeners = listeners.get(eventType);
				if (eventListeners) {
					eventListeners.forEach(callback => {
						try {
							callback(data);
						} catch (e) {
							console.error(`[WS] Error in listener for ${eventType}:`, e);
						}
					});
				}
			});
		});

		return true;
	}

	/**
	 * Subscribe to a WebSocket event
	 * @param {string} eventType - Event type from WS_EVENTS
	 * @param {Function} callback - Callback function
	 * @returns {Function} Unsubscribe function
	 */
	function subscribe(eventType, callback) {
		if (!listeners.has(eventType)) {
			listeners.set(eventType, new Set());
		}
		listeners.get(eventType).add(callback);

		// Return unsubscribe function
		return () => {
			const eventListeners = listeners.get(eventType);
			if (eventListeners) {
				eventListeners.delete(callback);
			}
		};
	}

	/**
	 * Subscribe to multiple events at once
	 * @param {Object} subscriptions - { eventType: callback }
	 * @returns {Function} Unsubscribe all function
	 */
	function subscribeMany(subscriptions) {
		const unsubscribers = [];
		for (const [eventType, callback] of Object.entries(subscriptions)) {
			unsubscribers.push(subscribe(eventType, callback));
		}
		return () => unsubscribers.forEach(unsub => unsub());
	}

	/**
	 * Register connection state callbacks
	 * @param {string} event - 'connect' or 'disconnect'
	 * @param {Function} callback - Callback function
	 */
	function onConnection(event, callback) {
		if (connectionCallbacks[event]) {
			connectionCallbacks[event].push(callback);
		}
	}

	/**
	 * Get connection status
	 * @returns {boolean} Whether connected
	 */
	function getStatus() {
		return {
			connected: isConnected,
			reconnectAttempts
		};
	}

	/**
	 * Manually disconnect
	 */
	function disconnect() {
		if (socket) {
			socket.disconnect();
			socket = null;
			isConnected = false;
		}
	}

	/**
	 * Emit an event (for admin actions that need server broadcast)
	 * @param {string} eventType - Event type
	 * @param {Object} data - Event data
	 */
	function emit(eventType, data) {
		if (socket && isConnected) {
			socket.emit(eventType, data);
		}
	}

	return {
		init,
		subscribe,
		subscribeMany,
		onConnection,
		getStatus,
		disconnect,
		emit,
		EVENTS: WS_EVENTS
	};
})();

// Export for global use
window.WS_EVENTS = WS_EVENTS;
window.WebSocketManager = WebSocketManager;
window.TIMEZONE = TIMEZONE;
window.escapeHtml = escapeHtml;
window.showAlert = showAlert;
window.formatDate = formatDate;
window.formatDateFull = formatDateFull;
window.formatDateTime = formatDateTime;
window.formatDateTimeShort = formatDateTimeShort;
window.formatFileSize = formatFileSize;
window.formatTime = formatTime;
window.formatTimeCT = formatTimeCT;
window.formatTimeAgo = formatTimeAgo;
window.getFreshness = getFreshness;
window.getFreshnessColor = getFreshnessColor;
window.formatRelativeTime = formatRelativeTime;
window.initLastUpdated = initLastUpdated;
window.setLastUpdated = setLastUpdated;
window.updateLastUpdatedDisplay = updateLastUpdatedDisplay;
window.getCurrentTimeCT = getCurrentTimeCT;
window.debounce = debounce;
window.setupVisibilityHandler = setupVisibilityHandler;
window.createPollingManager = createPollingManager;
window.getCsrfToken = getCsrfToken;
window.csrfFetch = csrfFetch;
window.refreshCsrfToken = refreshCsrfToken;
window.getCacheStatusClass = getCacheStatusClass;
window.getCacheStatusText = getCacheStatusText;
window.renderCacheIndicator = renderCacheIndicator;
window.renderCacheBadge = renderCacheBadge;
window.showConfirmModal = showConfirmModal;
window.closeConfirmModal = closeConfirmModal;
