// Settings Page JavaScript

// Global user info
let currentUser = null;
let systemSettings = null;
let currentSettingsTab = 'challonge'; // Track active settings tab

// Check authentication on page load
document.addEventListener('DOMContentLoaded', async () => {
	// Check if user is authenticated
	try {
		const response = await fetch('/api/auth/status');
		if (!response.ok) {
			window.location.href = '/login.html';
			return;
		}

		const data = await response.json();
		if (data.success) {
			currentUser = data.user;

			// Populate hidden username field for password form accessibility
			const usernameField = document.getElementById('changePasswordUsername');
			if (usernameField && currentUser.username) {
				usernameField.value = currentUser.username;
			}

			// Hide user management section for non-admin users
			if (currentUser.role !== 'admin') {
				const userManagementSection = document.querySelector('section:first-of-type');
				if (userManagementSection) {
					userManagementSection.style.display = 'none';
				}
			} else {
				// Only load users if admin
				loadUsers();
				setupUserForm();
			}
		}
	} catch (error) {
		window.location.href = '/login.html';
		return;
	}

	// Setup form handlers
	setupChangePasswordForm();

	// Load system settings if admin
	if (currentUser && currentUser.role === 'admin') {
		loadSystemSettings();
		document.getElementById('adminSettings').classList.remove('hidden');
	}
});

// Note: showAlert and escapeHtml are now in utils.js

// Toast notification for settings section
function showSettingsToast(message, type = 'success') {
	// Find or create toast container inside settings section
	const settingsSection = document.getElementById('adminSettings');
	let toastContainer = settingsSection.querySelector('.settings-toast-container');

	if (!toastContainer) {
		toastContainer = document.createElement('div');
		toastContainer.className = 'settings-toast-container';
		toastContainer.style.cssText = 'position: relative; margin-bottom: 1rem;';
		// Insert at top of settings section content
		const settingsCard = settingsSection.querySelector('.bg-gray-800');
		settingsCard.insertBefore(toastContainer, settingsCard.firstChild);
	}

	// Create toast element
	const toast = document.createElement('div');
	const bgColor = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600';
	toast.className = `${bgColor} text-white px-4 py-3 rounded-md shadow-lg flex items-center justify-between mb-2`;
	toast.style.cssText = 'animation: slideDown 0.5s ease-out forwards;';
	toast.innerHTML = `
		<span>${message}</span>
		<button onclick="this.parentElement.remove()" class="text-xl ml-4 hover:text-gray-200">×</button>
	`;

	// Add animation styles if not already present
	if (!document.getElementById('settingsToastStyles')) {
		const style = document.createElement('style');
		style.id = 'settingsToastStyles';
		style.textContent = `
			@keyframes slideDown {
				from {
					opacity: 0;
					transform: translateY(-20px);
				}
				to {
					opacity: 1;
					transform: translateY(0);
				}
			}
			@keyframes slideUp {
				from {
					opacity: 1;
					transform: translateY(0);
				}
				to {
					opacity: 0;
					transform: translateY(-10px);
				}
			}
		`;
		document.head.appendChild(style);
	}

	toastContainer.appendChild(toast);

	// Auto-remove after 2 seconds
	setTimeout(() => {
		toast.style.animation = 'slideUp 0.3s ease-in forwards';
		setTimeout(() => toast.remove(), 300);
	}, 2000);
}

// Load users
async function loadUsers() {
	// Only admins can load users
	if (!currentUser || currentUser.role !== 'admin') {
		return;
	}

	try {
		const response = await fetch('/api/users');
		const data = await response.json();

		if (data.success) {
			displayUsers(data.users);
		} else {
			showAlert('Failed to load users', 'error');
		}
	} catch (error) {
		showAlert('Error loading users', 'error');
	}
}

// Display users in table
function displayUsers(users) {
	const tbody = document.getElementById('usersTableBody');

	if (users.length === 0) {
		tbody.innerHTML = `
			<tr>
				<td colspan="4" class="text-center py-8 text-gray-400">No users found</td>
			</tr>
		`;
		return;
	}

	tbody.innerHTML = users.map(user => `
		<tr class="border-b border-gray-700 hover:bg-gray-750">
			<td class="py-3 px-4 text-white">${escapeHtml(user.username)}</td>
			<td class="py-3 px-4">
				<span class="px-2 py-1 rounded text-xs ${user.role === 'admin' ? 'bg-purple-900 text-purple-200' : 'bg-gray-700 text-gray-300'}">
					${escapeHtml(user.role)}
				</span>
			</td>
			<td class="py-3 px-4 text-gray-400">${formatDateFull(user.createdAt)}</td>
			<td class="py-3 px-4 text-right">
				<button
					onclick="editUser(${user.id})"
					class="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1 rounded transition mr-2"
				>
					Edit
				</button>
				<button
					onclick="deleteUser(${user.id}, '${escapeHtml(user.username)}')"
					class="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-1 rounded transition"
				>
					Delete
				</button>
			</td>
		</tr>
	`).join('');
}

// Format date for settings page (uses formatDateFull from utils.js with Central Time)
// Note: formatDate, formatDateTime, formatDateFull are now in utils.js

// Show add user modal
function showAddUserModal() {
	document.getElementById('modalTitle').textContent = 'Add New User';
	document.getElementById('userForm').reset();
	document.getElementById('userId').value = '';
	document.getElementById('password').required = true;
	document.getElementById('userModal').classList.remove('hidden');
}

// Edit user
async function editUser(userId) {
	try {
		const response = await fetch('/api/users');
		const data = await response.json();

		if (data.success) {
			const user = data.users.find(u => u.id === userId);
			if (user) {
				document.getElementById('modalTitle').textContent = 'Edit User';
				document.getElementById('userId').value = user.id;
				document.getElementById('username').value = user.username;
				document.getElementById('password').value = '';
				document.getElementById('password').required = false;
				document.getElementById('role').value = user.role;
				document.getElementById('userModal').classList.remove('hidden');
			}
		}
	} catch (error) {
		showAlert('Error loading user', 'error');
	}
}

// Close user modal
function closeUserModal() {
	document.getElementById('userModal').classList.add('hidden');
	document.getElementById('userForm').reset();
}

// Setup user form
function setupUserForm() {
	const form = document.getElementById('userForm');

	form.addEventListener('submit', async (e) => {
		e.preventDefault();

		const userId = document.getElementById('userId').value;
		const username = document.getElementById('username').value;
		const password = document.getElementById('password').value;
		const role = document.getElementById('role').value;

		const isEdit = userId !== '';
		const url = isEdit ? `/api/users/${userId}` : '/api/users';
		const method = isEdit ? 'PUT' : 'POST';

		const body = { username, role };
		if (password) {
			body.password = password;
		}

		try {
			const response = await csrfFetch(url, {
				method: method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const data = await response.json();

			if (data.success) {
				showAlert(isEdit ? 'User updated successfully' : 'User added successfully', 'success');
				closeUserModal();
				loadUsers();
			} else {
				showAlert(data.error || 'Failed to save user', 'error');
			}
		} catch (error) {
			showAlert('Error saving user', 'error');
		}
	});
}

// Delete user
async function deleteUser(userId, username) {
	if (!confirm(`Are you sure you want to delete user "${username}"?`)) {
		return;
	}

	try {
		const response = await csrfFetch(`/api/users/${userId}`, {
			method: 'DELETE'
		});

		const data = await response.json();

		if (data.success) {
			showAlert('User deleted successfully', 'success');
			loadUsers();
		} else {
			showAlert(data.error || 'Failed to delete user', 'error');
		}
	} catch (error) {
		showAlert('Error deleting user', 'error');
	}
}

// Setup change password form
function setupChangePasswordForm() {
	const form = document.getElementById('changePasswordForm');

	form.addEventListener('submit', async (e) => {
		e.preventDefault();

		const currentPassword = document.getElementById('currentPassword').value;
		const newPassword = document.getElementById('newPassword').value;
		const confirmPassword = document.getElementById('confirmPassword').value;

		// Validate passwords match
		if (newPassword !== confirmPassword) {
			showAlert('New passwords do not match', 'error');
			return;
		}

		// Validate password length
		if (newPassword.length < 8) {
			showAlert('Password must be at least 8 characters long', 'error');
			return;
		}

		try {
			const response = await csrfFetch('/api/settings/change-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});

			const data = await response.json();

			if (data.success) {
				showAlert('Password changed successfully', 'success');
				form.reset();
			} else {
				showAlert(data.error || 'Failed to change password', 'error');
			}
		} catch (error) {
			showAlert('Error changing password', 'error');
		}
	});
}

// Logout
async function logout() {
	if (!confirm('Are you sure you want to logout?')) {
		return;
	}

	try {
		await csrfFetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/login.html';
	} catch (error) {
		showAlert('Error logging out', 'error');
	}
}

// ==================== ADMIN SETTINGS SYSTEM ====================

// Load system settings
async function loadSystemSettings(tabToShow = null) {
	try {
		const response = await fetch('/api/settings/system');
		const data = await response.json();

		if (data.success) {
			systemSettings = data.settings;
			// Load the specified tab, or the current tab, or default to challonge
			const targetTab = tabToShow || currentSettingsTab || 'challonge';
			switchSettingsTab(targetTab);
		} else {
			showAlert('Failed to load system settings', 'error');
		}
	} catch (error) {
		showAlert('Error loading system settings', 'error');
	}
}

// Switch between settings tabs
function switchSettingsTab(tabName) {
	// Update current tab tracker
	currentSettingsTab = tabName;

	// Update tab active states
	document.querySelectorAll('.settings-tab').forEach(tab => {
		tab.classList.remove('active');
	});
	document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

	// Render the appropriate tab content
	const contentDiv = document.getElementById('settingsTabContent');

	switch(tabName) {
		case 'challonge':
			contentDiv.innerHTML = renderChallongeTab();
			loadOAuthStatus();
			loadRateLimitStatus();
			break;
		case 'defaults':
			contentDiv.innerHTML = renderDefaultsTab();
			break;
		case 'security':
			contentDiv.innerHTML = renderSecurityTab();
			break;
		case 'notifications':
			contentDiv.innerHTML = renderNotificationsTab();
			loadPushNotificationStatus();
			break;
		case 'display':
			contentDiv.innerHTML = renderDisplayTab();
			break;
		case 'retention':
			contentDiv.innerHTML = renderRetentionTab();
			break;
		case 'activityLog':
			contentDiv.innerHTML = renderActivityLogTab();
			loadActivityLog();
			break;
		case 'monitoring':
			contentDiv.innerHTML = renderMonitoringTab();
			loadMonitoringStatus();
			break;
		case 'cache':
			contentDiv.innerHTML = renderCacheTab();
			loadCacheStatus();
			break;
		default:
			contentDiv.innerHTML = '<p class="text-gray-400">Tab not implemented</p>';
	}
}

// Render Challonge API tab
function renderChallongeTab() {
	const rateLimit = systemSettings.challonge.rateLimit || 15;
	const adaptive = systemSettings.challonge.adaptiveRateLimit || {
		enabled: false,
		idleRate: 1,
		upcomingRate: 5,
		activeRate: 15,
		checkIntervalHours: 8,
		upcomingWindowHours: 48
	};

	return `
		<div class="max-w-2xl">
			<!-- OAuth Connection Section -->
			<div class="setting-group">
				<h3 class="text-lg font-semibold text-white mb-4">Challonge Account</h3>
				<div id="oauthStatus" class="bg-gray-750 rounded-lg p-4 mb-4">
					<p class="text-gray-400 text-sm">Loading connection status...</p>
				</div>
			</div>

			<form id="challongeForm" onsubmit="saveSettingsSection(event, 'challonge')" class="max-w-2xl">

			<div class="setting-group">
				<h3 class="text-lg font-semibold text-white mb-4">API Rate Limiting</h3>

				<!-- Current Status (loaded dynamically) -->
				<div id="rateLimitStatus" class="bg-gray-750 rounded-lg p-4 mb-4">
					<p class="text-gray-400 text-sm">Loading rate limit status...</p>
				</div>

				<label class="flex items-center gap-2 text-gray-300 mb-4">
					<input
						type="checkbox"
						id="adaptiveEnabled"
						${adaptive.enabled ? 'checked' : ''}
						onchange="toggleAdaptiveSettings()"
						class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
					>
					Enable Adaptive Rate Limiting
				</label>
				<p class="text-xs text-gray-400 mb-4">
					Automatically adjusts API rate based on tournament schedule. Conserves API quota when idle.
				</p>

				<!-- Manual Rate Limit (always visible, acts as cap) -->
				<div class="mb-4">
					<label for="challongeRateLimit" class="block text-sm font-medium text-gray-300 mb-2">
						Maximum Rate Limit (requests per minute)
					</label>
					<input
						type="number"
						id="challongeRateLimit"
						value="${rateLimit}"
						class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
					>
					<p class="text-xs text-gray-400 mt-1">
						Acts as a cap for all modes. Challonge free tier: 5000 calls/month.
					</p>
				</div>

				<!-- Adaptive Settings (shown when enabled) -->
				<div id="adaptiveSettings" class="${adaptive.enabled ? '' : 'hidden'}">
					<div class="bg-gray-750 rounded-lg p-4 space-y-4">
						<div class="grid grid-cols-3 gap-4">
							<div>
								<label for="idleRate" class="block text-sm font-medium text-gray-300 mb-2">
									Idle Rate
								</label>
								<input
									type="number"
									id="idleRate"
									value="${adaptive.idleRate}"
									class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								>
								<p class="text-xs text-gray-400 mt-1">No tournaments</p>
							</div>
							<div>
								<label for="upcomingRate" class="block text-sm font-medium text-gray-300 mb-2">
									Upcoming Rate
								</label>
								<input
									type="number"
									id="upcomingRate"
									value="${adaptive.upcomingRate}"
									class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								>
								<p class="text-xs text-gray-400 mt-1">Tournament soon</p>
							</div>
							<div>
								<label for="activeRate" class="block text-sm font-medium text-gray-300 mb-2">
									Active Rate
								</label>
								<input
									type="number"
									id="activeRate"
									value="${adaptive.activeRate}"
									class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								>
								<p class="text-xs text-gray-400 mt-1">Tournament underway</p>
							</div>
						</div>

						<div class="grid grid-cols-2 gap-4">
							<div>
								<label for="checkIntervalHours" class="block text-sm font-medium text-gray-300 mb-2">
									Check Interval (hours)
								</label>
								<input
									type="number"
									id="checkIntervalHours"
									value="${adaptive.checkIntervalHours}"
									class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								>
								<p class="text-xs text-gray-400 mt-1">How often to check for tournaments</p>
							</div>
							<div>
								<label for="upcomingWindowHours" class="block text-sm font-medium text-gray-300 mb-2">
									Upcoming Window (hours)
								</label>
								<input
									type="number"
									id="upcomingWindowHours"
									value="${adaptive.upcomingWindowHours}"
									class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								>
								<p class="text-xs text-gray-400 mt-1">Hours before start to switch to upcoming mode</p>
							</div>
						</div>

						<button type="button" onclick="triggerTournamentCheck()" class="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-md transition text-sm">
							Check Now
						</button>
					</div>
				</div>
			</div>

			<!-- Development Mode -->
			<div class="setting-group mt-6">
				<h3 class="text-lg font-semibold text-white mb-4">Development Mode</h3>
				<div id="devModeSection" class="bg-gray-750 rounded-lg p-4">
					<div class="flex items-center justify-between mb-3">
						<div>
							<p class="text-gray-300 font-medium">Bypass Rate Limiting</p>
							<p class="text-xs text-gray-400">Temporarily disable all API rate limits for 3 hours</p>
						</div>
						<div id="devModeToggle">
							<button type="button" onclick="toggleDevMode()" id="devModeBtn" class="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-md transition text-sm font-medium">
								Enable Dev Mode
							</button>
						</div>
					</div>
					<div id="devModeStatus" class="text-sm text-gray-400">
						Status: Inactive
					</div>
				</div>
				<p class="text-xs text-yellow-500 mt-2">
					Warning: Development mode bypasses all rate limiting and may quickly exhaust your monthly API quota.
				</p>
			</div>

			<button type="submit" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md transition">
				Save Rate Limit Settings
			</button>
		</form>
		</div>
	`;
}

// Toggle adaptive settings visibility
function toggleAdaptiveSettings() {
	const enabled = document.getElementById('adaptiveEnabled').checked;
	const settingsDiv = document.getElementById('adaptiveSettings');
	if (enabled) {
		settingsDiv.classList.remove('hidden');
	} else {
		settingsDiv.classList.add('hidden');
	}
}

// ==================== CHALLONGE OAUTH ====================

// Load and display OAuth status
async function loadOAuthStatus() {
	const statusDiv = document.getElementById('oauthStatus');
	if (!statusDiv) return;

	try {
		const response = await fetch('/api/oauth/status');
		const data = await response.json();

		if (data.success) {
			if (data.connected) {
				// Connected state
				const expiresAt = new Date(data.expiresAt);
				const expiresIn = Math.round((expiresAt - Date.now()) / (1000 * 60));
				const expiresStr = expiresIn > 60 ?
					Math.floor(expiresIn / 60) + 'h ' + (expiresIn % 60) + 'm' :
					expiresIn + 'm';

				statusDiv.innerHTML = `
					<div class="flex items-center justify-between mb-3">
						<div class="flex items-center gap-3">
							<div class="w-3 h-3 bg-green-500 rounded-full"></div>
							<span class="text-green-400 font-medium">Connected</span>
						</div>
						<button onclick="disconnectChallonge()" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition text-sm">
							Disconnect
						</button>
					</div>
					<div class="text-sm text-gray-300 space-y-1">
						<p>Account: <span class="text-white font-medium">${escapeHtml(data.challongeUsername || data.username || 'Unknown')}</span></p>
						<p>Token expires in: <span class="text-yellow-400">${expiresStr}</span></p>
						${data.scope ? `<p class="text-xs text-gray-500">Scopes: ${escapeHtml(data.scope)}</p>` : ''}
					</div>
					<div class="mt-3 pt-3 border-t border-gray-700">
						<button onclick="refreshChallongeToken()" class="text-blue-400 hover:text-blue-300 text-sm">
							Refresh Token Now
						</button>
					</div>
				`;
			} else {
				// Not connected state
				statusDiv.innerHTML = `
					<div class="flex items-center justify-between mb-3">
						<div class="flex items-center gap-3">
							<div class="w-3 h-3 bg-gray-500 rounded-full"></div>
							<span class="text-gray-400">Not Connected</span>
						</div>
						<button onclick="connectChallonge()" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-md transition text-sm">
							Connect Challonge Account
						</button>
					</div>
					<p class="text-sm text-gray-400">
						Connect your Challonge account to access tournament data. This uses OAuth 2.0 for secure authentication.
					</p>
				`;
			}
		} else {
			statusDiv.innerHTML = `
				<p class="text-red-400">Error loading OAuth status: ${escapeHtml(data.error || 'Unknown error')}</p>
			`;
		}
	} catch (error) {
		statusDiv.innerHTML = `
			<p class="text-red-400">Error loading OAuth status: ${error.message}</p>
		`;
	}
}

// Redirect to Challonge OAuth
function connectChallonge() {
	window.location.href = '/auth/challonge';
}

// Disconnect Challonge account
async function disconnectChallonge() {
	if (!confirm('Are you sure you want to disconnect your Challonge account? You will need to reconnect to access tournament data.')) {
		return;
	}

	try {
		const response = await csrfFetch('/api/oauth/disconnect', { method: 'POST' });
		const data = await response.json();

		if (data.success) {
			showSettingsToast('Challonge account disconnected', 'success');
			loadOAuthStatus();
		} else {
			showSettingsToast(data.error || 'Failed to disconnect', 'error');
		}
	} catch (error) {
		showSettingsToast('Error disconnecting: ' + error.message, 'error');
	}
}

// Manually refresh OAuth token
async function refreshChallongeToken() {
	try {
		const response = await csrfFetch('/api/oauth/refresh', { method: 'POST' });
		const data = await response.json();

		if (data.success) {
			showSettingsToast('Token refreshed successfully', 'success');
			loadOAuthStatus();
		} else {
			showSettingsToast(data.error || 'Failed to refresh token', 'error');
		}
	} catch (error) {
		showSettingsToast('Error refreshing token: ' + error.message, 'error');
	}
}

// Load and display rate limit status
async function loadRateLimitStatus() {
	try {
		const response = await fetch('/api/rate-limit/status');
		const data = await response.json();

		if (data.success) {
			const statusDiv = document.getElementById('rateLimitStatus');
			if (!statusDiv) return;

			const modeColors = {
				'IDLE': 'text-gray-400',
				'UPCOMING': 'text-yellow-400',
				'ACTIVE': 'text-green-400'
			};

			let tournamentInfo = '';
			if (data.upcomingTournament) {
				tournamentInfo = `<p class="text-sm text-gray-300 mt-2">Upcoming: ${escapeHtml(data.upcomingTournament.name)} (in ${data.upcomingTournament.hoursUntil} hours)</p>`;
			} else if (data.activeTournament) {
				tournamentInfo = `<p class="text-sm text-gray-300 mt-2">Active: ${escapeHtml(data.activeTournament.name)}</p>`;
			}

			const lastCheck = data.lastCheck ? formatDateTime(data.lastCheck) : 'Never';
			const nextCheck = data.nextCheck ? formatDateTime(data.nextCheck) : 'N/A';

			const effectiveRateDisplay = data.devModeActive ? 'Unlimited' : `${data.effectiveRate} req/min`;
			const effectiveRateClass = data.devModeActive ? 'text-yellow-400' : 'text-white';

			statusDiv.innerHTML = `
				<div class="flex items-center justify-between mb-2">
					<span class="text-sm text-gray-400">Current Mode:</span>
					<span class="font-semibold ${data.devModeActive ? 'text-yellow-400' : modeColors[data.currentMode] || 'text-white'}">${data.devModeActive ? 'DEV MODE' : data.currentMode}</span>
				</div>
				<div class="flex items-center justify-between mb-2">
					<span class="text-sm text-gray-400">Effective Rate:</span>
					<span class="font-semibold ${effectiveRateClass}">${effectiveRateDisplay}</span>
				</div>
				<div class="flex items-center justify-between mb-2">
					<span class="text-sm text-gray-400">Adaptive:</span>
					<span class="font-semibold ${data.adaptiveEnabled ? 'text-green-400' : 'text-gray-500'}">${data.adaptiveEnabled ? 'Enabled' : 'Disabled'}</span>
				</div>
				${tournamentInfo}
				<div class="text-xs text-gray-500 mt-3 pt-2 border-t border-gray-700">
					Last check: ${lastCheck}<br>
					Next check: ${nextCheck}
				</div>
			`;

			// Also update dev mode UI
			updateDevModeUI(data);
		}
	} catch (error) {
		console.error('Error loading rate limit status:', error);
	}
}

// Trigger manual tournament check
async function triggerTournamentCheck() {
	try {
		const response = await csrfFetch('/api/rate-limit/check', { method: 'POST' });
		const data = await response.json();

		if (data.success) {
			showSettingsToast('Tournament check completed', 'success');
			loadRateLimitStatus();
		} else {
			showSettingsToast(data.error || 'Check failed', 'error');
		}
	} catch (error) {
		showSettingsToast('Error checking tournaments', 'error');
	}
}

// Toggle development mode
async function toggleDevMode() {
	const btn = document.getElementById('devModeBtn');
	const statusDiv = document.getElementById('devModeStatus');

	try {
		// Check current status first
		const statusResponse = await fetch('/api/rate-limit/status');
		const statusData = await statusResponse.json();

		const isActive = statusData.devModeActive;
		const endpoint = isActive ? '/api/rate-limit/dev-mode/disable' : '/api/rate-limit/dev-mode/enable';

		const response = await csrfFetch(endpoint, { method: 'POST' });
		const data = await response.json();

		if (data.success) {
			showSettingsToast(data.message, 'success');
			loadRateLimitStatus();
			updateDevModeUI(data);
		} else {
			showSettingsToast(data.error || 'Failed to toggle dev mode', 'error');
		}
	} catch (error) {
		showSettingsToast('Error toggling dev mode', 'error');
	}
}

// Update dev mode UI based on status
function updateDevModeUI(data) {
	const btn = document.getElementById('devModeBtn');
	const statusDiv = document.getElementById('devModeStatus');

	if (!btn || !statusDiv) return;

	if (data.devModeActive) {
		btn.textContent = 'Disable Dev Mode';
		btn.classList.remove('bg-yellow-600', 'hover:bg-yellow-700');
		btn.classList.add('bg-red-600', 'hover:bg-red-700');

		// Calculate remaining time
		const remainingMs = data.devModeRemainingMs || 0;
		const remainingMins = Math.ceil(remainingMs / 60000);
		const hours = Math.floor(remainingMins / 60);
		const mins = remainingMins % 60;

		let timeStr = '';
		if (hours > 0) {
			timeStr = `${hours}h ${mins}m`;
		} else {
			timeStr = `${mins}m`;
		}

		statusDiv.innerHTML = `
			<span class="text-yellow-400 font-semibold">Active</span>
			<span class="text-gray-400 ml-2">- Expires in ${timeStr}</span>
		`;
	} else {
		btn.textContent = 'Enable Dev Mode';
		btn.classList.remove('bg-red-600', 'hover:bg-red-700');
		btn.classList.add('bg-yellow-600', 'hover:bg-yellow-700');
		statusDiv.innerHTML = '<span class="text-gray-400">Status: Inactive</span>';
	}
}

// Render System Defaults tab
function renderDefaultsTab() {
	return `
		<form id="defaultsForm" onsubmit="saveSettingsSection(event, 'systemDefaults')" class="max-w-2xl">
			<div class="setting-group">
				<label for="registrationWindow" class="block text-sm font-medium text-gray-300 mb-2">
					Default Registration Window (hours)
				</label>
				<input
					type="number"
					id="registrationWindow"
					value="${systemSettings.systemDefaults.registrationWindow}"
					min="1"
					max="336"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
				<p class="text-xs text-gray-400 mt-2">How many hours before tournament start should signups open (default: 48)</p>
			</div>

			<div class="setting-group">
				<label for="defaultGame" class="block text-sm font-medium text-gray-300 mb-2">
					Default Game
				</label>
				<input
					type="text"
					id="defaultGame"
					value="${systemSettings.systemDefaults.defaultGame}"
					placeholder="e.g., Super Smash Bros. Ultimate"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
			</div>

			<div class="setting-group">
				<label for="tournamentType" class="block text-sm font-medium text-gray-300 mb-2">
					Default Tournament Type
				</label>
				<select
					id="tournamentType"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
					<option value="single elimination" ${systemSettings.systemDefaults.tournamentType === 'single elimination' ? 'selected' : ''}>Single Elimination</option>
					<option value="double elimination" ${systemSettings.systemDefaults.tournamentType === 'double elimination' ? 'selected' : ''}>Double Elimination</option>
					<option value="round robin" ${systemSettings.systemDefaults.tournamentType === 'round robin' ? 'selected' : ''}>Round Robin</option>
					<option value="swiss" ${systemSettings.systemDefaults.tournamentType === 'swiss' ? 'selected' : ''}>Swiss</option>
				</select>
			</div>

			<button type="submit" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md transition">
				Save Default Settings
			</button>
		</form>
	`;
}

// Render Security tab
function renderSecurityTab() {
	return `
		<form id="securityForm" onsubmit="saveSettingsSection(event, 'security')" class="max-w-2xl">
			<div class="setting-group">
				<label for="sessionTimeout" class="block text-sm font-medium text-gray-300 mb-2">
					Session Timeout (hours)
				</label>
				<input
					type="number"
					id="sessionTimeout"
					value="${systemSettings.security.sessionTimeout / (1000 * 60 * 60)}"
					min="1"
					max="168"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
				<p class="text-xs text-gray-400 mt-2">Auto-logout after inactivity (default: 24 hours)</p>
			</div>

			<div class="setting-group">
				<label for="maxFailedAttempts" class="block text-sm font-medium text-gray-300 mb-2">
					Max Failed Login Attempts
				</label>
				<input
					type="number"
					id="maxFailedAttempts"
					value="${systemSettings.security.maxFailedAttempts}"
					min="3"
					max="10"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
			</div>

			<div class="setting-group">
				<label for="lockoutDuration" class="block text-sm font-medium text-gray-300 mb-2">
					Account Lockout Duration (minutes)
				</label>
				<input
					type="number"
					id="lockoutDuration"
					value="${systemSettings.security.lockoutDuration / (1000 * 60)}"
					min="5"
					max="1440"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
			</div>

			<div class="setting-group">
				<label for="passwordMinLength" class="block text-sm font-medium text-gray-300 mb-2">
					Minimum Password Length
				</label>
				<input
					type="number"
					id="passwordMinLength"
					value="${systemSettings.security.passwordMinLength}"
					min="6"
					max="32"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
			</div>

			<div class="setting-group">
				<label class="flex items-center gap-2 text-gray-300">
					<input
						type="checkbox"
						id="requirePasswordComplexity"
						${systemSettings.security.requirePasswordComplexity ? 'checked' : ''}
						class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
					>
					Require password complexity (uppercase, lowercase, numbers, special chars)
				</label>
			</div>

			<button type="submit" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md transition">
				Save Security Settings
			</button>
		</form>
	`;
}

// Render Notifications tab
function renderNotificationsTab() {
	return `
		<!-- Push Notifications Section -->
		<div class="setting-group">
			<h3 class="text-lg font-semibold text-white mb-4">Push Notifications</h3>
			<p class="text-sm text-gray-400 mb-4">
				Receive browser push notifications for tournament events so you can move around the venue without watching screens.
			</p>

			<!-- Push Status / Enable Section -->
			<div id="pushNotificationStatus" class="bg-gray-750 rounded-lg p-4 mb-4">
				<p class="text-gray-400 text-sm">Loading push notification status...</p>
			</div>

			<!-- Notification Preferences (shown when enabled) -->
			<div id="pushPreferencesSection" class="hidden">
				<h4 class="text-md font-medium text-gray-300 mb-3">Notification Types</h4>
				<div class="space-y-3 mb-4">
					<label class="flex items-center gap-3 text-gray-300 cursor-pointer">
						<input type="checkbox" id="prefMatchCompleted" checked
							class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
						<div>
							<span class="font-medium">Match Completed</span>
							<p class="text-xs text-gray-500">When a match finishes and results are recorded</p>
						</div>
					</label>
					<label class="flex items-center gap-3 text-gray-300 cursor-pointer">
						<input type="checkbox" id="prefDisplayDisconnected" checked
							class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
						<div>
							<span class="font-medium">Display Disconnected</span>
							<p class="text-xs text-gray-500">When a Pi display goes offline or misses heartbeats</p>
						</div>
					</label>
					<label class="flex items-center gap-3 text-gray-300 cursor-pointer">
						<input type="checkbox" id="prefNewSignup" checked
							class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
						<div>
							<span class="font-medium">New Participant Signup</span>
							<p class="text-xs text-gray-500">When someone registers for the tournament</p>
						</div>
					</label>
					<label class="flex items-center gap-3 text-gray-300 cursor-pointer">
						<input type="checkbox" id="prefDqTimerExpired" checked
							class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
						<div>
							<span class="font-medium">DQ Timer Expired</span>
							<p class="text-xs text-gray-500">When a DQ timer runs out and requires action</p>
						</div>
					</label>
					<label class="flex items-center gap-3 text-gray-300 cursor-pointer">
						<input type="checkbox" id="prefTournamentStarted" checked
							class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
						<div>
							<span class="font-medium">Tournament Started</span>
							<p class="text-xs text-gray-500">When a tournament begins</p>
						</div>
					</label>
					<label class="flex items-center gap-3 text-gray-300 cursor-pointer">
						<input type="checkbox" id="prefCheckinDeadline" checked
							class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
						<div>
							<span class="font-medium">Check-in Deadline</span>
							<p class="text-xs text-gray-500">Reminder before check-in period ends</p>
						</div>
					</label>
				</div>

				<div class="flex flex-wrap gap-3">
					<button type="button" onclick="savePushPreferences()" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-md transition text-sm">
						Save Preferences
					</button>
					<button type="button" onclick="sendTestPushNotification()" class="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-md transition text-sm">
						Send Test Notification
					</button>
				</div>
			</div>
		</div>

		<form id="notificationsForm" onsubmit="saveSettingsSection(event, 'notifications')" class="max-w-2xl">
			<div class="setting-group">
				<h3 class="text-lg font-semibold text-white mb-4">Discord Notifications</h3>
				<label class="flex items-center gap-2 text-gray-300 mb-3">
					<input
						type="checkbox"
						id="discordEnabled"
						${systemSettings.notifications.discord.enabled ? 'checked' : ''}
						class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
					>
					Enable Discord notifications
				</label>
				<input
					type="url"
					id="discordWebhook"
					value="${systemSettings.notifications.discord.webhookUrl}"
					placeholder="https://discord.com/api/webhooks/..."
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
			</div>

			<div class="setting-group">
				<h3 class="text-lg font-semibold text-white mb-4">Slack Notifications</h3>
				<label class="flex items-center gap-2 text-gray-300 mb-3">
					<input
						type="checkbox"
						id="slackEnabled"
						${systemSettings.notifications.slack.enabled ? 'checked' : ''}
						class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
					>
					Enable Slack notifications
				</label>
				<input
					type="url"
					id="slackWebhook"
					value="${systemSettings.notifications.slack.webhookUrl}"
					placeholder="https://hooks.slack.com/services/..."
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
			</div>

			<div class="setting-group">
				<h3 class="text-lg font-semibold text-white mb-4">Email Notifications</h3>
				<label class="flex items-center gap-2 text-gray-300 mb-3">
					<input
						type="checkbox"
						id="emailEnabled"
						${systemSettings.notifications.email.enabled ? 'checked' : ''}
						class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
					>
					Enable email notifications
				</label>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label class="block text-sm text-gray-400 mb-1">SMTP Host</label>
						<input
							type="text"
							id="smtpHost"
							value="${systemSettings.notifications.email.smtpHost}"
							placeholder="smtp.gmail.com"
							class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
						>
					</div>
					<div>
						<label class="block text-sm text-gray-400 mb-1">SMTP Port</label>
						<input
							type="number"
							id="smtpPort"
							value="${systemSettings.notifications.email.smtpPort}"
							class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
						>
					</div>
					<div>
						<label class="block text-sm text-gray-400 mb-1">SMTP Username</label>
						<input
							type="text"
							id="smtpUser"
							value="${systemSettings.notifications.email.smtpUser}"
							class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
						>
					</div>
					<div>
						<label class="block text-sm text-gray-400 mb-1">SMTP Password</label>
						<input
							type="password"
							id="smtpPassword"
							value="${systemSettings.notifications.email.smtpPassword}"
							autocomplete="off"
							class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
						>
					</div>
					<div class="col-span-2">
						<label class="block text-sm text-gray-400 mb-1">From Address</label>
						<input
							type="email"
							id="fromAddress"
							value="${systemSettings.notifications.email.fromAddress}"
							placeholder="noreply@yourdomain.com"
							class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
						>
					</div>
				</div>
			</div>

			<button type="submit" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md transition">
				Save Notification Settings
			</button>
		</form>
	`;
}

// Render Display Settings tab
function renderDisplayTab() {
	return `
		<form id="displayForm" onsubmit="saveSettingsSection(event, 'display')" class="max-w-2xl">
			<div class="setting-group">
				<label for="matchRefreshInterval" class="block text-sm font-medium text-gray-300 mb-2">
					Match Display Refresh Interval (seconds)
				</label>
				<input
					type="number"
					id="matchRefreshInterval"
					value="${systemSettings.display.matchRefreshInterval / 1000}"
					min="5"
					max="300"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
				<p class="text-xs text-gray-400 mt-2">How often to poll Challonge for match updates (default: 30 seconds)</p>
			</div>

			<div class="setting-group">
				<label for="bracketRefreshInterval" class="block text-sm font-medium text-gray-300 mb-2">
					Bracket Display Refresh Interval (seconds)
				</label>
				<input
					type="number"
					id="bracketRefreshInterval"
					value="${systemSettings.display.bracketRefreshInterval / 1000}"
					min="30"
					max="600"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
			</div>

			<div class="setting-group">
				<label for="flyerRefreshInterval" class="block text-sm font-medium text-gray-300 mb-2">
					Flyer Display Refresh Interval (seconds)
				</label>
				<input
					type="number"
					id="flyerRefreshInterval"
					value="${systemSettings.display.flyerRefreshInterval / 1000}"
					min="30"
					max="600"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
			</div>

			<button type="submit" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md transition">
				Save Display Settings
			</button>
		</form>
	`;
}

// Render Data Retention tab
function renderRetentionTab() {
	return `
		<form id="retentionForm" onsubmit="saveSettingsSection(event, 'dataRetention')" class="max-w-2xl">
			<div class="setting-group">
				<label for="autoArchiveDays" class="block text-sm font-medium text-gray-300 mb-2">
					Auto-Archive Tournaments After (days)
				</label>
				<input
					type="number"
					id="autoArchiveDays"
					value="${systemSettings.dataRetention.autoArchiveDays}"
					min="7"
					max="365"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
				<p class="text-xs text-gray-400 mt-2">Move completed tournaments to archive after this many days (default: 90)</p>
			</div>

			<div class="setting-group">
				<label for="keepActivityLogDays" class="block text-sm font-medium text-gray-300 mb-2">
					Keep Activity Logs For (days)
				</label>
				<input
					type="number"
					id="keepActivityLogDays"
					value="${systemSettings.dataRetention.keepActivityLogDays}"
					min="7"
					max="365"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
			</div>

			<div class="setting-group">
				<label class="flex items-center gap-2 text-gray-300 mb-3">
					<input
						type="checkbox"
						id="autoBackupEnabled"
						${systemSettings.dataRetention.autoBackupEnabled ? 'checked' : ''}
						class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
					>
					Enable automatic backups
				</label>
				<select
					id="backupFrequency"
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
				>
					<option value="daily" ${systemSettings.dataRetention.backupFrequency === 'daily' ? 'selected' : ''}>Daily</option>
					<option value="weekly" ${systemSettings.dataRetention.backupFrequency === 'weekly' ? 'selected' : ''}>Weekly</option>
					<option value="monthly" ${systemSettings.dataRetention.backupFrequency === 'monthly' ? 'selected' : ''}>Monthly</option>
				</select>
			</div>

			<button type="submit" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md transition">
				Save Retention Settings
			</button>
		</form>
	`;
}

// Render Activity Log tab
function renderActivityLogTab() {
	return `
		<div class="max-w-4xl">
			<div class="flex items-center justify-between mb-6">
				<h3 class="text-lg font-semibold text-white">Activity Log</h3>
				<button onclick="clearActivityLog()" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition text-sm">
					Clear All Logs
				</button>
			</div>

			<div id="activityLogContent" class="bg-gray-750 rounded-lg p-4 max-h-96 overflow-y-auto">
				<p class="text-gray-400">Loading activity logs...</p>
			</div>
		</div>
	`;
}

// Load activity log
async function loadActivityLog() {
	try {
		const response = await fetch('/api/settings/activity-log');
		const data = await response.json();

		if (data.success) {
			const container = document.getElementById('activityLogContent');

			if (data.logs.length === 0) {
				container.innerHTML = '<p class="text-gray-400">No activity logs yet</p>';
				return;
			}

			container.innerHTML = data.logs.map(log => `
				<div class="border-b border-gray-700 py-3 last:border-b-0">
					<div class="flex items-start justify-between">
						<div class="flex-1">
							<p class="text-white font-medium">${escapeHtml(log.action)}</p>
							<p class="text-sm text-gray-400 mt-1">
								<span class="text-purple-400">${escapeHtml(log.username)}</span>
								${log.details ? ` - ${escapeHtml(JSON.stringify(log.details))}` : ''}
							</p>
						</div>
						<span class="text-xs text-gray-500">${formatDateTime(log.timestamp)}</span>
					</div>
				</div>
			`).join('');
		} else {
			showAlert('Failed to load activity log', 'error');
		}
	} catch (error) {
		showAlert('Error loading activity log', 'error');
	}
}

// Clear activity log
async function clearActivityLog() {
	if (!confirm('Are you sure you want to clear all activity logs? This cannot be undone.')) {
		return;
	}

	try {
		const response = await csrfFetch('/api/settings/activity-log', {
			method: 'DELETE'
		});

		const data = await response.json();

		if (data.success) {
			showAlert('Activity log cleared successfully', 'success');
			loadActivityLog();
		} else {
			showAlert(data.error || 'Failed to clear activity log', 'error');
		}
	} catch (error) {
		showAlert('Error clearing activity log', 'error');
	}
}

// Save settings section
async function saveSettingsSection(event, section) {
	event.preventDefault();

	const formData = {};

	switch(section) {
		case 'challonge':
			// OAuth tokens are managed separately - only save rate limit settings
			formData.rateLimit = parseInt(document.getElementById('challongeRateLimit').value) || 15;
			formData.adaptiveRateLimit = {
				enabled: document.getElementById('adaptiveEnabled').checked,
				idleRate: parseInt(document.getElementById('idleRate').value) || 1,
				upcomingRate: parseInt(document.getElementById('upcomingRate').value) || 5,
				activeRate: parseInt(document.getElementById('activeRate').value) || 15,
				checkIntervalHours: parseInt(document.getElementById('checkIntervalHours').value) || 8,
				upcomingWindowHours: parseInt(document.getElementById('upcomingWindowHours').value) || 48
			};
			break;

		case 'systemDefaults':
			formData.registrationWindow = parseInt(document.getElementById('registrationWindow').value);
			formData.defaultGame = document.getElementById('defaultGame').value;
			formData.tournamentType = document.getElementById('tournamentType').value;
			break;

		case 'security':
			formData.sessionTimeout = parseInt(document.getElementById('sessionTimeout').value) * 1000 * 60 * 60; // hours to ms
			formData.maxFailedAttempts = parseInt(document.getElementById('maxFailedAttempts').value);
			formData.lockoutDuration = parseInt(document.getElementById('lockoutDuration').value) * 1000 * 60; // minutes to ms
			formData.passwordMinLength = parseInt(document.getElementById('passwordMinLength').value);
			formData.requirePasswordComplexity = document.getElementById('requirePasswordComplexity').checked;
			break;

		case 'notifications':
			formData.discord = {
				enabled: document.getElementById('discordEnabled').checked,
				webhookUrl: document.getElementById('discordWebhook').value
			};
			formData.slack = {
				enabled: document.getElementById('slackEnabled').checked,
				webhookUrl: document.getElementById('slackWebhook').value
			};
			formData.email = {
				enabled: document.getElementById('emailEnabled').checked,
				smtpHost: document.getElementById('smtpHost').value,
				smtpPort: parseInt(document.getElementById('smtpPort').value),
				smtpUser: document.getElementById('smtpUser').value,
				smtpPassword: document.getElementById('smtpPassword').value,
				fromAddress: document.getElementById('fromAddress').value
			};
			break;

		case 'display':
			formData.matchRefreshInterval = parseInt(document.getElementById('matchRefreshInterval').value) * 1000; // seconds to ms
			formData.bracketRefreshInterval = parseInt(document.getElementById('bracketRefreshInterval').value) * 1000;
			formData.flyerRefreshInterval = parseInt(document.getElementById('flyerRefreshInterval').value) * 1000;
			formData.defaultFlyer = systemSettings.display.defaultFlyer; // Keep existing
			break;

		case 'dataRetention':
			formData.autoArchiveDays = parseInt(document.getElementById('autoArchiveDays').value);
			formData.keepActivityLogDays = parseInt(document.getElementById('keepActivityLogDays').value);
			formData.autoBackupEnabled = document.getElementById('autoBackupEnabled').checked;
			formData.backupFrequency = document.getElementById('backupFrequency').value;
			break;
	}

	try {
		const response = await csrfFetch('/api/settings/system', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ section, data: formData })
		});

		const data = await response.json();

		if (data.success) {
			// Show toast notification in settings section
			showSettingsToast('Settings saved successfully', 'success');
			// Reload settings to get updated values, but stay on current tab
			await loadSystemSettings(currentSettingsTab);
		} else {
			showSettingsToast(data.error || 'Failed to save settings', 'error');
		}
	} catch (error) {
		showSettingsToast('Error saving settings', 'error');
	}
}

// ==================== SYSTEM MONITORING ====================

// Monitoring state
let monitoringRefreshInterval = null;

// Render Monitoring tab
function renderMonitoringTab() {
	return '<div class="max-w-4xl">' +
		'<div class="flex items-center justify-between mb-6">' +
			'<div>' +
				'<h3 class="text-lg font-semibold text-white">System Monitoring</h3>' +
				'<p class="text-sm text-gray-400">Monitor services, API performance, network conditions, and Pi displays</p>' +
			'</div>' +
		'</div>' +
		'<div class="bg-gray-750 rounded-lg p-4 mb-6">' +
			'<h4 class="text-md font-semibold text-white mb-4">Quick Actions</h4>' +
			'<div class="flex flex-wrap gap-3">' +
				'<button onclick="runQuickCheck()" id="quickCheckBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition">Run Quick Check</button>' +
				'<button onclick="viewServiceLogs()" class="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-md transition">View Service Logs</button>' +
			'</div>' +
		'</div>' +
		'<div class="bg-gray-750 rounded-lg p-4 mb-6">' +
			'<h4 class="text-md font-semibold text-white mb-4">Monitoring Session</h4>' +
			'<div id="monitoringStatus" class="mb-4"><p class="text-gray-400">Loading status...</p></div>' +
			'<div class="flex flex-wrap gap-3 items-center">' +
				'<div class="flex items-center gap-2">' +
					'<label for="monitoringDuration" class="text-sm text-gray-300">Duration:</label>' +
					'<select id="monitoringDuration" class="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm">' +
						'<option value="1">1 minute</option>' +
						'<option value="5" selected>5 minutes</option>' +
						'<option value="10">10 minutes</option>' +
						'<option value="15">15 minutes</option>' +
						'<option value="30">30 minutes</option>' +
						'<option value="60">60 minutes</option>' +
						'<option value="120">2 hours</option>' +
					'</select>' +
				'</div>' +
				'<button onclick="startMonitoring()" id="startMonitoringBtn" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md transition">Start Monitoring</button>' +
				'<button onclick="stopMonitoring()" id="stopMonitoringBtn" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition hidden">Stop Monitoring</button>' +
				'<button onclick="generateReport()" id="generateReportBtn" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-md transition hidden">Generate Report</button>' +
			'</div>' +
		'</div>' +
		'<div id="quickCheckResults" class="hidden mb-6">' +
			'<div class="bg-gray-750 rounded-lg p-4">' +
				'<div class="flex items-center justify-between mb-4">' +
					'<h4 class="text-md font-semibold text-white">Quick Check Results</h4>' +
					'<button onclick="hideQuickCheckResults()" class="text-gray-400 hover:text-white text-xl">&times;</button>' +
				'</div>' +
				'<div id="quickCheckContent"></div>' +
			'</div>' +
		'</div>' +
		'<div id="serviceLogsSection" class="hidden mb-6">' +
			'<div class="bg-gray-750 rounded-lg p-4">' +
				'<div class="flex items-center justify-between mb-4">' +
					'<h4 class="text-md font-semibold text-white">Service Logs</h4>' +
					'<button onclick="hideServiceLogs()" class="text-gray-400 hover:text-white text-xl">&times;</button>' +
				'</div>' +
				'<div id="serviceLogsContent" class="max-h-96 overflow-y-auto"></div>' +
			'</div>' +
		'</div>' +
		'<div id="reportViewer" class="hidden mb-6">' +
			'<div class="bg-gray-750 rounded-lg p-4">' +
				'<div class="flex items-center justify-between mb-4">' +
					'<h4 class="text-md font-semibold text-white">Monitoring Report</h4>' +
					'<div class="flex gap-2">' +
						'<button onclick="copyReportToClipboard()" class="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1 rounded text-sm">Copy for Claude</button>' +
						'<button onclick="hideReportViewer()" class="text-gray-400 hover:text-white text-xl">&times;</button>' +
					'</div>' +
				'</div>' +
				'<div id="reportContent" class="max-h-96 overflow-y-auto"></div>' +
			'</div>' +
		'</div>' +
		'<div class="bg-gray-750 rounded-lg p-4">' +
			'<div class="flex items-center justify-between mb-4">' +
				'<h4 class="text-md font-semibold text-white">Saved Reports</h4>' +
				'<button onclick="loadSavedReports()" class="text-blue-400 hover:text-blue-300 text-sm">Refresh</button>' +
			'</div>' +
			'<div id="savedReportsList"><p class="text-gray-400 text-sm">Loading saved reports...</p></div>' +
		'</div>' +
	'</div>';
}

// Load monitoring status
async function loadMonitoringStatus() {
	try {
		const response = await fetch('/api/monitoring/status');
		const data = await response.json();

		const statusDiv = document.getElementById('monitoringStatus');
		const startBtn = document.getElementById('startMonitoringBtn');
		const stopBtn = document.getElementById('stopMonitoringBtn');
		const generateBtn = document.getElementById('generateReportBtn');

		if (data.isRunning) {
			const startTime = new Date(data.startTime);
			const elapsed = Math.floor((Date.now() - startTime) / 1000);
			const elapsedStr = elapsed > 60 ? Math.floor(elapsed / 60) + 'm ' + (elapsed % 60) + 's' : elapsed + 's';

			statusDiv.innerHTML =
				'<div class="flex items-center gap-3">' +
					'<div class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>' +
					'<span class="text-green-400 font-medium">Monitoring Active</span>' +
				'</div>' +
				'<div class="mt-2 text-sm text-gray-400">' +
					'<p>Session: ' + (data.sessionId || 'Unknown') + '</p>' +
					'<p>Started: ' + formatTimeCT(startTime) + '</p>' +
					'<p>Elapsed: ' + elapsedStr + '</p>' +
					'<p>Samples Collected: ' + (data.samplesCollected || 0) + '</p>' +
				'</div>';

			startBtn.classList.add('hidden');
			stopBtn.classList.remove('hidden');
			generateBtn.classList.remove('hidden');

			if (!monitoringRefreshInterval) {
				monitoringRefreshInterval = setInterval(loadMonitoringStatus, 5000);
			}
		} else {
			statusDiv.innerHTML =
				'<div class="flex items-center gap-3">' +
					'<div class="w-3 h-3 bg-gray-500 rounded-full"></div>' +
					'<span class="text-gray-400">Not Monitoring</span>' +
				'</div>' +
				'<p class="mt-2 text-sm text-gray-500">Select a duration and click "Start Monitoring" to begin collecting data.</p>';

			startBtn.classList.remove('hidden');
			stopBtn.classList.add('hidden');
			generateBtn.classList.add('hidden');

			if (monitoringRefreshInterval) {
				clearInterval(monitoringRefreshInterval);
				monitoringRefreshInterval = null;
			}
		}
		loadSavedReports();
	} catch (error) {
		console.error('Error loading monitoring status:', error);
	}
}

// Start monitoring session
async function startMonitoring() {
	const duration = parseInt(document.getElementById('monitoringDuration').value) || 5;
	const btn = document.getElementById('startMonitoringBtn');
	btn.disabled = true;
	btn.textContent = 'Starting...';

	try {
		const response = await csrfFetch('/api/monitoring/start', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ durationMinutes: duration })
		});
		const data = await response.json();
		if (data.success) {
			showSettingsToast('Monitoring started for ' + duration + ' minutes', 'success');
			loadMonitoringStatus();
		} else {
			showSettingsToast(data.error || 'Failed to start monitoring', 'error');
		}
	} catch (error) {
		showSettingsToast('Error starting monitoring', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Start Monitoring';
	}
}

// Stop monitoring session
async function stopMonitoring() {
	const btn = document.getElementById('stopMonitoringBtn');
	btn.disabled = true;
	btn.textContent = 'Stopping...';

	try {
		const response = await csrfFetch('/api/monitoring/stop', { method: 'POST' });
		const data = await response.json();
		if (data.success) {
			showSettingsToast('Monitoring stopped - ' + data.samplesCollected + ' samples collected', 'success');
			loadMonitoringStatus();
		} else {
			showSettingsToast(data.error || 'Failed to stop monitoring', 'error');
		}
	} catch (error) {
		showSettingsToast('Error stopping monitoring', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Stop Monitoring';
	}
}

// Generate report
async function generateReport() {
	const btn = document.getElementById('generateReportBtn');
	btn.disabled = true;
	btn.textContent = 'Generating...';

	try {
		const response = await fetch('/api/monitoring/report');
		const data = await response.json();
		if (data.success) {
			showSettingsToast('Report generated successfully', 'success');
			displayReport(data.report);
			loadSavedReports();
		} else {
			showSettingsToast(data.error || 'Failed to generate report', 'error');
		}
	} catch (error) {
		showSettingsToast('Error generating report', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Generate Report';
	}
}

// Run quick check
async function runQuickCheck() {
	const btn = document.getElementById('quickCheckBtn');
	btn.disabled = true;
	btn.textContent = 'Checking...';

	try {
		const response = await fetch('/api/monitoring/quick-check');
		const data = await response.json();
		if (data.success) {
			displayQuickCheckResults(data.report);
		} else {
			showSettingsToast(data.error || 'Quick check failed', 'error');
		}
	} catch (error) {
		showSettingsToast('Error running quick check', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Run Quick Check';
	}
}

// Display quick check results
function displayQuickCheckResults(report) {
	const container = document.getElementById('quickCheckResults');
	const content = document.getElementById('quickCheckContent');
	const issues = report.issuesForDebugging || [];
	const criticalCount = issues.filter(function(i) { return i.severity === 'high'; }).length;
	const warningCount = issues.filter(function(i) { return i.severity === 'medium'; }).length;

	var issuesHtml = '';
	if (issues.length === 0) {
		issuesHtml = '<p class="text-green-400">No issues detected</p>';
	} else {
		issuesHtml = issues.map(function(issue) {
			var severityClass = issue.severity === 'high' ? 'bg-red-900 text-red-200' :
				issue.severity === 'medium' ? 'bg-yellow-900 text-yellow-200' : 'bg-blue-900 text-blue-200';
			return '<div class="flex items-start gap-3 py-2 border-b border-gray-700 last:border-b-0">' +
				'<span class="px-2 py-1 rounded text-xs font-medium ' + severityClass + '">' + issue.severity.toUpperCase() + '</span>' +
				'<div><p class="text-white">' + escapeHtml(issue.message) + '</p>' +
				'<p class="text-xs text-gray-500">' + issue.type + '</p></div></div>';
		}).join('');
	}

	var recsHtml = '';
	if (report.recommendations && report.recommendations.length > 0) {
		recsHtml = '<div class="mt-4 pt-4 border-t border-gray-700">' +
			'<h5 class="text-sm font-medium text-white mb-2">Recommendations</h5>' +
			'<ul class="list-disc list-inside text-sm text-gray-300 space-y-1">' +
			report.recommendations.map(function(r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('') +
			'</ul></div>';
	}

	content.innerHTML = '<div class="mb-4"><div class="flex gap-4 text-sm">' +
		'<span class="text-red-400">Critical: ' + criticalCount + '</span>' +
		'<span class="text-yellow-400">Warnings: ' + warningCount + '</span>' +
		'<span class="text-blue-400">Info: ' + (issues.length - criticalCount - warningCount) + '</span>' +
		'</div></div><div class="space-y-1">' + issuesHtml + '</div>' + recsHtml;

	container.classList.remove('hidden');
}

function hideQuickCheckResults() {
	document.getElementById('quickCheckResults').classList.add('hidden');
}

// View service logs
async function viewServiceLogs() {
	try {
		const response = await fetch('/api/monitoring/logs');
		const data = await response.json();
		if (data.success) {
			displayServiceLogs(data.logs);
		} else {
			showSettingsToast('Failed to load service logs', 'error');
		}
	} catch (error) {
		showSettingsToast('Error loading service logs', 'error');
	}
}

function displayServiceLogs(logs) {
	const section = document.getElementById('serviceLogsSection');
	const content = document.getElementById('serviceLogsContent');
	var html = '';

	for (const [service, logData] of Object.entries(logs)) {
		var hasErrors = logData.errors > 0;
		var hasWarnings = logData.warnings > 0;
		var errorsHtml = '';
		var warningsHtml = '';

		if (logData.errorMessages && logData.errorMessages.length > 0) {
			errorsHtml = '<div class="bg-red-900/20 rounded p-2 mb-2">' +
				'<p class="text-xs text-red-400 font-medium mb-1">Recent Errors:</p>' +
				'<div class="text-xs text-red-300 font-mono space-y-1">' +
				logData.errorMessages.map(function(m) {
					return '<p class="truncate">' + escapeHtml(m.substring(0, 100)) + (m.length > 100 ? '...' : '') + '</p>';
				}).join('') + '</div></div>';
		}
		if (logData.warningMessages && logData.warningMessages.length > 0) {
			warningsHtml = '<div class="bg-yellow-900/20 rounded p-2">' +
				'<p class="text-xs text-yellow-400 font-medium mb-1">Recent Warnings:</p>' +
				'<div class="text-xs text-yellow-300 font-mono space-y-1">' +
				logData.warningMessages.map(function(m) {
					return '<p class="truncate">' + escapeHtml(m.substring(0, 100)) + (m.length > 100 ? '...' : '') + '</p>';
				}).join('') + '</div></div>';
		}

		html += '<div class="mb-4 pb-4 border-b border-gray-700 last:border-b-0">' +
			'<div class="flex items-center justify-between mb-2">' +
			'<h5 class="font-medium text-white">' + escapeHtml(service) + '</h5>' +
			'<div class="flex gap-2 text-xs">' +
			'<span class="' + (hasErrors ? 'text-red-400' : 'text-gray-500') + '">Errors: ' + (logData.errors || 0) + '</span>' +
			'<span class="' + (hasWarnings ? 'text-yellow-400' : 'text-gray-500') + '">Warnings: ' + (logData.warnings || 0) + '</span>' +
			'</div></div>' + errorsHtml + warningsHtml +
			(!hasErrors && !hasWarnings ? '<p class="text-sm text-gray-500">No recent errors or warnings</p>' : '') +
			'</div>';
	}

	content.innerHTML = html || '<p class="text-gray-400">No logs available</p>';
	section.classList.remove('hidden');
}

function hideServiceLogs() {
	document.getElementById('serviceLogsSection').classList.add('hidden');
}

function displayReport(report) {
	const viewer = document.getElementById('reportViewer');
	const content = document.getElementById('reportContent');
	viewer.dataset.report = JSON.stringify(report, null, 2);

	const summary = report.executiveSummary;
	const issues = report.issuesForDebugging || [];

	var issuesHtml = '';
	if (issues.length > 0) {
		issuesHtml = '<div><h5 class="text-sm font-medium text-white mb-2">Issues for Debugging</h5><div class="space-y-2">' +
			issues.map(function(issue) {
				var severityClass = issue.severity === 'high' ? 'bg-red-900 text-red-200' :
					issue.severity === 'medium' ? 'bg-yellow-900 text-yellow-200' : 'bg-blue-900 text-blue-200';
				return '<div class="flex items-start gap-3 bg-gray-800 rounded p-2">' +
					'<span class="px-2 py-1 rounded text-xs font-medium ' + severityClass + '">' + issue.severity.toUpperCase() + '</span>' +
					'<div class="flex-1"><p class="text-white text-sm">' + escapeHtml(issue.message) + '</p>' +
					'<p class="text-xs text-gray-500">' + issue.type + '</p></div></div>';
			}).join('') + '</div></div>';
	} else {
		issuesHtml = '<p class="text-green-400">No issues detected</p>';
	}

	var serviceHtml = '<div><h5 class="text-sm font-medium text-white mb-2">Service Health</h5><div class="grid grid-cols-2 gap-2">' +
		Object.entries(report.serviceHealth || {}).map(function([name, data]) {
			return '<div class="bg-gray-800 rounded p-2">' +
				'<p class="text-white text-sm font-medium">' + escapeHtml(name) + '</p>' +
				'<p class="text-xs text-gray-400">' + (data.description || '') + '</p>' +
				'<p class="text-sm ' + (data.uptime === '100.0%' ? 'text-green-400' : 'text-yellow-400') + '">Uptime: ' + data.uptime + '</p></div>';
		}).join('') + '</div></div>';

	var recsHtml = '';
	if (report.recommendations && report.recommendations.length > 0) {
		recsHtml = '<div><h5 class="text-sm font-medium text-white mb-2">Recommendations</h5>' +
			'<ul class="list-disc list-inside text-sm text-gray-300 space-y-1">' +
			report.recommendations.map(function(r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('') + '</ul></div>';
	}

	content.innerHTML = '<div class="space-y-4">' +
		'<div class="bg-gray-800 rounded p-3"><h5 class="text-sm font-medium text-white mb-2">Summary</h5>' +
		'<div class="grid grid-cols-4 gap-3 text-center text-sm">' +
		'<div><p class="text-2xl font-bold text-white">' + summary.totalIssues + '</p><p class="text-gray-400">Total Issues</p></div>' +
		'<div><p class="text-2xl font-bold text-red-400">' + summary.criticalIssues + '</p><p class="text-gray-400">Critical</p></div>' +
		'<div><p class="text-2xl font-bold text-yellow-400">' + summary.warningIssues + '</p><p class="text-gray-400">Warnings</p></div>' +
		'<div><p class="text-2xl font-bold text-blue-400">' + summary.infoIssues + '</p><p class="text-gray-400">Info</p></div>' +
		'</div></div>' + issuesHtml + serviceHtml + recsHtml + '</div>';

	viewer.classList.remove('hidden');
}

function hideReportViewer() {
	document.getElementById('reportViewer').classList.add('hidden');
}

function copyReportToClipboard() {
	const viewer = document.getElementById('reportViewer');
	const reportJson = viewer.dataset.report;
	if (reportJson) {
		navigator.clipboard.writeText(reportJson).then(function() {
			showSettingsToast('Report copied to clipboard - paste to Claude for analysis', 'success');
		}).catch(function() {
			showSettingsToast('Failed to copy to clipboard', 'error');
		});
	}
}

async function loadSavedReports() {
	try {
		const response = await fetch('/api/monitoring/reports');
		const data = await response.json();
		const container = document.getElementById('savedReportsList');

		if (!data.success || !data.reports || data.reports.length === 0) {
			container.innerHTML = '<p class="text-gray-500 text-sm">No saved reports yet. Run monitoring and generate a report to save one.</p>';
			return;
		}

		container.innerHTML = '<div class="space-y-2">' +
			data.reports.slice(0, 10).map(function(report) {
				return '<div class="flex items-center justify-between bg-gray-800 rounded p-2">' +
					'<div><p class="text-white text-sm">' + escapeHtml(report.filename.replace('monitoring-report-', '').replace('.json', '')) + '</p>' +
					'<p class="text-xs text-gray-500">' + formatDateTime(report.createdAt) + ' - ' + (report.sizeBytes / 1024).toFixed(1) + ' KB</p></div>' +
					'<div class="flex gap-2">' +
					'<button onclick="viewSavedReport(\'' + escapeHtml(report.filename) + '\')" class="text-blue-400 hover:text-blue-300 text-sm">View</button>' +
					'<button onclick="deleteSavedReport(\'' + escapeHtml(report.filename) + '\')" class="text-red-400 hover:text-red-300 text-sm">Delete</button>' +
					'</div></div>';
			}).join('') + '</div>';
	} catch (error) {
		console.error('Error loading saved reports:', error);
	}
}

async function viewSavedReport(filename) {
	try {
		const response = await fetch('/api/monitoring/reports/' + encodeURIComponent(filename));
		const data = await response.json();
		if (data.success) {
			displayReport(data.report);
		} else {
			showSettingsToast('Failed to load report', 'error');
		}
	} catch (error) {
		showSettingsToast('Error loading report', 'error');
	}
}

async function deleteSavedReport(filename) {
	if (!confirm('Are you sure you want to delete this report?')) return;
	try {
		const response = await csrfFetch('/api/monitoring/reports/' + encodeURIComponent(filename), { method: 'DELETE' });
		const data = await response.json();
		if (data.success) {
			showSettingsToast('Report deleted', 'success');
			loadSavedReports();
		} else {
			showSettingsToast(data.error || 'Failed to delete report', 'error');
		}
	} catch (error) {
		showSettingsToast('Error deleting report', 'error');
	}
}

// ============================================
// CACHE TAB FUNCTIONS
// ============================================

function renderCacheTab() {
	return `
		<div class="setting-group">
			<h3 class="text-lg font-semibold text-white mb-4">API Response Cache</h3>
			<p class="text-gray-400 text-sm mb-4">
				The dashboard caches Challonge API responses to reduce redundant API calls, improve loading times, and provide offline resilience.
			</p>

			<!-- Cache Statistics -->
			<div class="cache-stats-card mb-6">
				<div class="flex items-center justify-between mb-4">
					<h4 class="text-md font-medium text-white">Cache Statistics</h4>
					<button onclick="loadCacheStatus()" class="text-blue-400 hover:text-blue-300 text-sm">
						Refresh
					</button>
				</div>
				<div id="cacheStatsContainer" class="cache-stats-grid">
					<div class="text-gray-400">Loading...</div>
				</div>
			</div>

			<!-- Cache by Type -->
			<div class="cache-stats-card mb-6">
				<h4 class="text-md font-medium text-white mb-4">Cache by Type</h4>
				<div id="cacheByTypeContainer">
					<div class="text-gray-400">Loading...</div>
				</div>
			</div>

			<!-- Cache Actions -->
			<div class="cache-stats-card">
				<h4 class="text-md font-medium text-white mb-4">Cache Management</h4>
				<div class="space-y-3">
					<div class="flex flex-wrap gap-2">
						<button onclick="invalidateCacheType('tournaments')" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">
							Clear Tournaments
						</button>
						<button onclick="invalidateCacheType('matches')" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">
							Clear Matches
						</button>
						<button onclick="invalidateCacheType('participants')" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">
							Clear Participants
						</button>
						<button onclick="invalidateCacheType('stations')" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">
							Clear Stations
						</button>
					</div>
					<div class="pt-3 border-t border-gray-700">
						<button onclick="clearAllCaches()" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm">
							Clear All Caches
						</button>
						<span class="text-gray-500 text-xs ml-3">This will force fresh API calls for all data</span>
					</div>
				</div>
			</div>
		</div>

		<!-- TTL Information -->
		<div class="setting-group">
			<h3 class="text-lg font-semibold text-white mb-4">Cache Time-To-Live (TTL)</h3>
			<p class="text-gray-400 text-sm mb-4">
				Data is automatically refreshed when the cache expires. Shorter TTLs mean fresher data but more API calls.
			</p>
			<div class="bg-gray-900 rounded-lg p-4">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-left text-gray-400 border-b border-gray-700">
							<th class="pb-2">Data Type</th>
							<th class="pb-2">Default TTL</th>
							<th class="pb-2">Active Mode TTL</th>
						</tr>
					</thead>
					<tbody class="text-gray-300">
						<tr class="border-b border-gray-800">
							<td class="py-2">Tournaments</td>
							<td class="py-2">60 seconds</td>
							<td class="py-2">30 seconds</td>
						</tr>
						<tr class="border-b border-gray-800">
							<td class="py-2">Matches</td>
							<td class="py-2">30 seconds</td>
							<td class="py-2">15 seconds</td>
						</tr>
						<tr class="border-b border-gray-800">
							<td class="py-2">Participants</td>
							<td class="py-2">120 seconds</td>
							<td class="py-2">60 seconds</td>
						</tr>
						<tr class="border-b border-gray-800">
							<td class="py-2">Stations</td>
							<td class="py-2">300 seconds</td>
							<td class="py-2">60 seconds</td>
						</tr>
						<tr>
							<td class="py-2">Tournament Details</td>
							<td class="py-2">300 seconds</td>
							<td class="py-2">120 seconds</td>
						</tr>
					</tbody>
				</table>
				<p class="text-gray-500 text-xs mt-3">Active Mode uses shorter TTLs when a tournament is in progress.</p>
			</div>
		</div>
	`;
}

async function loadCacheStatus() {
	try {
		const response = await fetch('/api/cache/status');
		const data = await response.json();

		if (data.success) {
			renderCacheStats(data);
		} else {
			document.getElementById('cacheStatsContainer').innerHTML =
				'<div class="text-red-400">Failed to load cache status</div>';
		}
	} catch (error) {
		console.error('Error loading cache status:', error);
		document.getElementById('cacheStatsContainer').innerHTML =
			'<div class="text-red-400">Error loading cache status</div>';
	}
}

function renderCacheStats(data) {
	const totals = data.totals || { hits: 0, misses: 0, apiCallsSaved: 0, hitRate: 'N/A' };

	// Render totals
	const statsContainer = document.getElementById('cacheStatsContainer');
	statsContainer.innerHTML = `
		<div class="cache-stat-item">
			<div class="cache-stat-value text-green-400">${totals.hits}</div>
			<div class="cache-stat-label">Cache Hits</div>
		</div>
		<div class="cache-stat-item">
			<div class="cache-stat-value text-yellow-400">${totals.misses}</div>
			<div class="cache-stat-label">Cache Misses</div>
		</div>
		<div class="cache-stat-item">
			<div class="cache-stat-value text-blue-400">${totals.apiCallsSaved}</div>
			<div class="cache-stat-label">API Calls Saved</div>
		</div>
		<div class="cache-stat-item">
			<div class="cache-stat-value text-purple-400">${totals.hitRate}</div>
			<div class="cache-stat-label">Hit Rate</div>
		</div>
	`;

	// Render by type
	const byType = data.byType || {};
	const typeContainer = document.getElementById('cacheByTypeContainer');

	const typeRows = Object.entries(byType).map(([type, stats]) => `
		<tr class="border-b border-gray-800">
			<td class="py-2 capitalize">${type}</td>
			<td class="py-2">${stats.entries || 0}</td>
			<td class="py-2">${stats.hits || 0}</td>
			<td class="py-2">${stats.misses || 0}</td>
			<td class="py-2">${stats.hitRate || 'N/A'}</td>
		</tr>
	`).join('');

	typeContainer.innerHTML = `
		<table class="w-full text-sm">
			<thead>
				<tr class="text-left text-gray-400 border-b border-gray-700">
					<th class="pb-2">Type</th>
					<th class="pb-2">Entries</th>
					<th class="pb-2">Hits</th>
					<th class="pb-2">Misses</th>
					<th class="pb-2">Hit Rate</th>
				</tr>
			</thead>
			<tbody class="text-gray-300">
				${typeRows || '<tr><td colspan="5" class="py-2 text-gray-500">No cache data yet</td></tr>'}
			</tbody>
		</table>
	`;
}

async function invalidateCacheType(type) {
	try {
		const response = await csrfFetch('/api/cache/invalidate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type })
		});

		const data = await response.json();
		if (data.success) {
			showSettingsToast(`${type} cache cleared`, 'success');
			loadCacheStatus();
		} else {
			showSettingsToast(data.error || 'Failed to clear cache', 'error');
		}
	} catch (error) {
		console.error('Error clearing cache:', error);
		showSettingsToast('Error clearing cache', 'error');
	}
}

async function clearAllCaches() {
	if (!confirm('Are you sure you want to clear all caches? This will force fresh API calls for all data.')) {
		return;
	}

	try {
		const response = await csrfFetch('/api/cache/clear', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();
		if (data.success) {
			showSettingsToast('All caches cleared successfully', 'success');
			loadCacheStatus();
		} else {
			showSettingsToast(data.error || 'Failed to clear caches', 'error');
		}
	} catch (error) {
		console.error('Error clearing all caches:', error);
		showSettingsToast('Error clearing caches', 'error');
	}
}

// ============================================
// PUSH NOTIFICATIONS FUNCTIONS
// ============================================

// Push notification state
let pushSubscription = null;
let vapidPublicKey = null;

// Check if push notifications are supported
function isPushSupported() {
	return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Convert VAPID key from base64 to Uint8Array
function urlBase64ToUint8Array(base64String) {
	const padding = '='.repeat((4 - base64String.length % 4) % 4);
	const base64 = (base64String + padding)
		.replace(/-/g, '+')
		.replace(/_/g, '/');
	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

// Load push notification status when notifications tab is shown
async function loadPushNotificationStatus() {
	const statusDiv = document.getElementById('pushNotificationStatus');
	const prefsSection = document.getElementById('pushPreferencesSection');
	if (!statusDiv) return;

	// Check browser support
	if (!isPushSupported()) {
		statusDiv.innerHTML = `
			<div class="flex items-center gap-3">
				<div class="w-3 h-3 bg-red-500 rounded-full"></div>
				<span class="text-red-400">Not Supported</span>
			</div>
			<p class="text-sm text-gray-400 mt-2">
				Push notifications are not supported in this browser. Try using Chrome, Firefox, or Edge.
			</p>
		`;
		return;
	}

	// Get VAPID public key from server
	try {
		const keyResponse = await fetch('/api/notifications/vapid-public-key');
		const keyData = await keyResponse.json();
		if (!keyData.success || !keyData.publicKey) {
			statusDiv.innerHTML = `
				<div class="flex items-center gap-3">
					<div class="w-3 h-3 bg-yellow-500 rounded-full"></div>
					<span class="text-yellow-400">Not Configured</span>
				</div>
				<p class="text-sm text-gray-400 mt-2">
					Push notifications are not configured on the server. VAPID keys may be missing from .env file.
				</p>
			`;
			return;
		}
		vapidPublicKey = keyData.publicKey;
	} catch (error) {
		statusDiv.innerHTML = `
			<div class="flex items-center gap-3">
				<div class="w-3 h-3 bg-red-500 rounded-full"></div>
				<span class="text-red-400">Error</span>
			</div>
			<p class="text-sm text-gray-400 mt-2">
				Failed to fetch push configuration: ${escapeHtml(error.message)}
			</p>
		`;
		return;
	}

	// Check notification permission
	const permission = Notification.permission;

	if (permission === 'denied') {
		statusDiv.innerHTML = `
			<div class="flex items-center gap-3">
				<div class="w-3 h-3 bg-red-500 rounded-full"></div>
				<span class="text-red-400">Blocked</span>
			</div>
			<p class="text-sm text-gray-400 mt-2">
				Notifications are blocked for this site. To enable, click the lock icon in the address bar and allow notifications.
			</p>
		`;
		return;
	}

	// Check if already subscribed
	try {
		const registration = await navigator.serviceWorker.ready;
		pushSubscription = await registration.pushManager.getSubscription();

		if (pushSubscription) {
			// Subscribed - show enabled state
			statusDiv.innerHTML = `
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div class="w-3 h-3 bg-green-500 rounded-full"></div>
						<span class="text-green-400 font-medium">Enabled</span>
					</div>
					<button onclick="disablePushNotifications()" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition text-sm">
						Disable
					</button>
				</div>
				<p class="text-sm text-gray-400 mt-2">
					Push notifications are enabled for this browser. You'll receive alerts for tournament events.
				</p>
			`;
			if (prefsSection) {
				prefsSection.classList.remove('hidden');
				loadPushPreferences();
			}
		} else {
			// Not subscribed - show enable button
			statusDiv.innerHTML = `
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div class="w-3 h-3 bg-gray-500 rounded-full"></div>
						<span class="text-gray-400">Disabled</span>
					</div>
					<button onclick="enablePushNotifications()" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md transition text-sm">
						Enable Push Notifications
					</button>
				</div>
				<p class="text-sm text-gray-400 mt-2">
					Click "Enable" to receive push notifications for tournament events on this device.
				</p>
			`;
			if (prefsSection) {
				prefsSection.classList.add('hidden');
			}
		}
	} catch (error) {
		console.error('Error checking push subscription:', error);
		statusDiv.innerHTML = `
			<div class="flex items-center gap-3">
				<div class="w-3 h-3 bg-yellow-500 rounded-full"></div>
				<span class="text-yellow-400">Error</span>
			</div>
			<p class="text-sm text-gray-400 mt-2">
				Error checking subscription status: ${escapeHtml(error.message)}
			</p>
		`;
	}
}

// Enable push notifications
async function enablePushNotifications() {
	const statusDiv = document.getElementById('pushNotificationStatus');

	try {
		// Request notification permission
		const permission = await Notification.requestPermission();
		if (permission !== 'granted') {
			showSettingsToast('Notification permission denied', 'error');
			loadPushNotificationStatus();
			return;
		}

		// Register service worker if not already
		const registration = await navigator.serviceWorker.ready;

		// Subscribe to push
		const subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
		});

		// Send subscription to server
		const response = await csrfFetch('/api/notifications/subscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				subscription: subscription.toJSON()
			})
		});

		const data = await response.json();
		if (data.success) {
			pushSubscription = subscription;
			showSettingsToast('Push notifications enabled', 'success');
			loadPushNotificationStatus();
		} else {
			showSettingsToast(data.error || 'Failed to enable push notifications', 'error');
		}
	} catch (error) {
		console.error('Error enabling push notifications:', error);
		showSettingsToast('Error enabling push notifications: ' + error.message, 'error');
	}
}

// Disable push notifications
async function disablePushNotifications() {
	try {
		if (pushSubscription) {
			// Unsubscribe from push manager
			await pushSubscription.unsubscribe();

			// Remove from server
			const response = await csrfFetch('/api/notifications/unsubscribe', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					endpoint: pushSubscription.endpoint
				})
			});

			const data = await response.json();
			if (data.success) {
				pushSubscription = null;
				showSettingsToast('Push notifications disabled', 'success');
			} else {
				showSettingsToast(data.error || 'Error removing subscription', 'error');
			}
		}
		loadPushNotificationStatus();
	} catch (error) {
		console.error('Error disabling push notifications:', error);
		showSettingsToast('Error disabling push notifications: ' + error.message, 'error');
	}
}

// Load push notification preferences
async function loadPushPreferences() {
	try {
		const response = await fetch('/api/notifications/preferences');
		const data = await response.json();

		if (data.success && data.preferences) {
			const prefs = data.preferences;
			document.getElementById('prefMatchCompleted').checked = prefs.match_completed !== 0;
			document.getElementById('prefDisplayDisconnected').checked = prefs.display_disconnected !== 0;
			document.getElementById('prefNewSignup').checked = prefs.new_signup !== 0;
			document.getElementById('prefDqTimerExpired').checked = prefs.dq_timer_expired !== 0;
			document.getElementById('prefTournamentStarted').checked = prefs.tournament_started !== 0;
			document.getElementById('prefCheckinDeadline').checked = prefs.checkin_deadline !== 0;
		}
	} catch (error) {
		console.error('Error loading push preferences:', error);
	}
}

// Save push notification preferences
async function savePushPreferences() {
	try {
		const preferences = {
			match_completed: document.getElementById('prefMatchCompleted').checked ? 1 : 0,
			display_disconnected: document.getElementById('prefDisplayDisconnected').checked ? 1 : 0,
			new_signup: document.getElementById('prefNewSignup').checked ? 1 : 0,
			dq_timer_expired: document.getElementById('prefDqTimerExpired').checked ? 1 : 0,
			tournament_started: document.getElementById('prefTournamentStarted').checked ? 1 : 0,
			checkin_deadline: document.getElementById('prefCheckinDeadline').checked ? 1 : 0
		};

		const response = await csrfFetch('/api/notifications/preferences', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(preferences)
		});

		const data = await response.json();
		if (data.success) {
			showSettingsToast('Notification preferences saved', 'success');
		} else {
			showSettingsToast(data.error || 'Failed to save preferences', 'error');
		}
	} catch (error) {
		console.error('Error saving push preferences:', error);
		showSettingsToast('Error saving preferences', 'error');
	}
}

// Send test push notification
async function sendTestPushNotification() {
	try {
		const response = await csrfFetch('/api/notifications/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();
		if (data.success) {
			showSettingsToast('Test notification sent', 'success');
		} else {
			showSettingsToast(data.error || 'Failed to send test notification', 'error');
		}
	} catch (error) {
		console.error('Error sending test notification:', error);
		showSettingsToast('Error sending test notification', 'error');
	}
}

// Cleanup all intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	if (monitoringRefreshInterval) clearInterval(monitoringRefreshInterval);
});
