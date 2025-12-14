// Settings Page JavaScript
//
// NOTE: The following tabs have been moved to Platform Admin (superadmin-only):
// - System Status, System Defaults, Security, Data Retention, Activity Log,
//   System Monitoring, and Cache
// See platform-admin.js for these features.

// Global user info
let currentUser = null;
let systemSettings = null;
let currentSettingsTab = 'notifications'; // Track active settings tab

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

			// User management removed - single user per account
		}
	} catch (error) {
		window.location.href = '/login.html';
		return;
	}

	// Setup form handlers
	setupProfileForm();
	setupChangePasswordForm();

	// Load profile data
	loadProfile();

	// Load system settings (all authenticated users have full access - single user per tenant)
	if (currentUser) {
		loadSystemSettings();
		document.getElementById('adminSettings').classList.remove('hidden');
	}
});

// Load user profile
async function loadProfile() {
	try {
		const response = await fetch('/api/users/me');
		const data = await response.json();

		if (data.success && data.user) {
			document.getElementById('profileUsername').value = data.user.username || '';
			document.getElementById('profileEmail').value = data.user.email || '';
		}
	} catch (error) {
		FrontendDebug.error('Settings', 'Failed to load profile', error);
	}
}

// Setup profile form
function setupProfileForm() {
	const form = document.getElementById('profileForm');

	form.addEventListener('submit', async (e) => {
		e.preventDefault();

		const username = document.getElementById('profileUsername').value.trim();
		const email = document.getElementById('profileEmail').value.trim();

		// Validate username
		if (username.length < 3) {
			showAlert('Username must be at least 3 characters', 'error');
			return;
		}

		try {
			const response = await csrfFetch('/api/users/me', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, email: email || null })
			});

			const data = await response.json();

			if (data.success) {
				showAlert('Profile updated successfully', 'success');
				// Update currentUser
				if (currentUser) {
					currentUser.username = username;
				}
				// Update hidden username field for password form accessibility
				const usernameField = document.getElementById('changePasswordUsername');
				if (usernameField) {
					usernameField.value = username;
				}
			} else {
				showAlert(data.error || 'Failed to update profile', 'error');
			}
		} catch (error) {
			showAlert('Error updating profile', 'error');
		}
	});
}

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

// User management functions removed - single user per account
// Can be re-added in the future if needed

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
			// Load the specified tab, or the current tab, or default to notifications
			const targetTab = tabToShow || currentSettingsTab || 'notifications';
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
		case 'notifications':
			contentDiv.innerHTML = renderNotificationsTab();
			loadPushNotificationStatus();
			break;
		case 'bracketDisplay':
			contentDiv.innerHTML = renderBracketDisplayTab();
			break;
		case 'discord':
			contentDiv.innerHTML = renderDiscordTab();
			loadDiscordSettings();
			break;
		default:
			contentDiv.innerHTML = '<p class="text-gray-400">Tab not implemented</p>';
	}
}

// System Status, System Defaults, Security, Data Retention, Activity Log,
// System Monitoring, and Cache tabs have been moved to Platform Admin page

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

// Render Bracket Display tab
function renderBracketDisplayTab() {
	// Get current theme from settings (with fallback)
	const currentTheme = systemSettings.bracketDisplay?.theme || 'midnight';

	// Theme definitions (must match bracket-canvas.js THEMES)
	const themes = {
		midnight: {
			name: 'Midnight',
			description: 'Professional esports aesthetic',
			background: '#111827',
			matchBg: '#1f2937',
			matchBorder: '#4b5563'
		},
		arctic: {
			name: 'Arctic Light',
			description: 'Clean, bright for well-lit venues',
			background: '#f8fafc',
			matchBg: '#ffffff',
			matchBorder: '#cbd5e1'
		},
		neon: {
			name: 'Neon Arcade',
			description: 'Vibrant cyberpunk gaming',
			background: '#0f0f1a',
			matchBg: '#1a1a2e',
			matchBorder: '#e94560'
		},
		royal: {
			name: 'Royal Tournament',
			description: 'Classic gold/navy sports feel',
			background: '#0c1929',
			matchBg: '#132743',
			matchBorder: '#d4af37'
		},
		forest: {
			name: 'Forest',
			description: 'Nature-inspired green tones',
			background: '#1a2f1a',
			matchBg: '#243524',
			matchBorder: '#4a7c4a'
		}
	};

	// Generate theme cards
	const themeCards = Object.entries(themes).map(([id, theme]) => {
		const isSelected = id === currentTheme;
		return `
			<div class="theme-card ${isSelected ? 'selected' : ''}" data-theme="${id}" onclick="selectBracketTheme('${id}')">
				<div class="theme-swatch" style="background: ${theme.background}; border-color: ${theme.matchBorder};">
					<div class="theme-match" style="background: ${theme.matchBg}; border: 1px solid ${theme.matchBorder};"></div>
				</div>
				<span class="theme-name">${theme.name}</span>
				<span class="theme-description">${theme.description}</span>
			</div>
		`;
	}).join('');

	return `
		<form id="bracketDisplayForm" onsubmit="saveSettingsSection(event, 'bracketDisplay')" class="max-w-3xl">
			<div class="setting-group">
				<h3 class="text-lg font-semibold text-white mb-2">Bracket Theme</h3>
				<p class="text-sm text-gray-400 mb-4">
					Choose a color theme for the bracket visualization in the Bracket Editor and bracket displays.
				</p>

				<div class="theme-grid">
					${themeCards}
				</div>

				<input type="hidden" id="bracketTheme" value="${currentTheme}">
			</div>

			<button type="submit" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md transition">
				Save Bracket Display Settings
			</button>
		</form>
	`;
}

// Select bracket theme (called when clicking a theme card)
function selectBracketTheme(themeId) {
	// Update hidden input
	document.getElementById('bracketTheme').value = themeId;

	// Update visual selection
	document.querySelectorAll('.theme-card').forEach(card => {
		card.classList.toggle('selected', card.dataset.theme === themeId);
	});

	// Also update localStorage for immediate use in Bracket Editor
	localStorage.setItem('bracketTheme', themeId);
}

// Save settings section
async function saveSettingsSection(event, section) {
	event.preventDefault();

	const formData = {};

	switch(section) {
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

		case 'bracketDisplay':
			formData.theme = document.getElementById('bracketTheme').value;
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
		FrontendDebug.error('Settings', 'Failed to check push subscription', error);
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
		FrontendDebug.error('Settings', 'Failed to enable push notifications', error);
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
		FrontendDebug.error('Settings', 'Failed to disable push notifications', error);
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
		FrontendDebug.error('Settings', 'Failed to load push preferences', error);
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
		FrontendDebug.error('Settings', 'Failed to save push preferences', error);
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
		FrontendDebug.error('Settings', 'Failed to send test notification', error);
		showSettingsToast('Error sending test notification', 'error');
	}
}

// ============================================
// DISCORD INTEGRATION FUNCTIONS
// ============================================

// Discord settings state
let discordSettings = null;

// Render Discord tab
function renderDiscordTab() {
	return `
		<div class="max-w-2xl">
			<div class="setting-group">
				<div class="flex items-center justify-between mb-4">
					<h3 class="text-lg font-semibold text-white">Discord Integration</h3>
					<div id="discordStatusBadge">
						<span class="px-2 py-1 text-xs rounded bg-gray-600 text-gray-300">Loading...</span>
					</div>
				</div>
				<p class="text-gray-400 text-sm mb-4">
					Send tournament events to your Discord channel using webhooks or a bot token.
				</p>

				<!-- Enable Toggle -->
				<div class="bg-gray-750 rounded-lg p-4 mb-4">
					<label class="flex items-center gap-3 cursor-pointer">
						<input type="checkbox" id="discordEnabled" onchange="toggleDiscordEnabled()"
							class="w-5 h-5 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
						<div>
							<span class="text-white font-medium">Enable Discord Notifications</span>
							<p class="text-xs text-gray-500">Send tournament events to Discord</p>
						</div>
					</label>
				</div>

				<!-- Integration Type -->
				<div id="discordConfigSection" class="space-y-4">
					<div class="setting-group">
						<label class="block text-sm font-medium text-gray-300 mb-2">Integration Type</label>
						<div class="flex gap-4">
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" name="integrationType" value="webhook" id="typeWebhook" checked
									onchange="toggleIntegrationType()"
									class="text-purple-600 bg-gray-700 border-gray-600 focus:ring-purple-500">
								<span class="text-gray-300">Webhook (Recommended)</span>
							</label>
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" name="integrationType" value="bot" id="typeBot"
									onchange="toggleIntegrationType()"
									class="text-purple-600 bg-gray-700 border-gray-600 focus:ring-purple-500">
								<span class="text-gray-300">Bot Token</span>
							</label>
						</div>
					</div>

					<!-- Webhook Section -->
					<div id="webhookSection" class="bg-gray-750 rounded-lg p-4">
						<label for="webhookUrl" class="block text-sm font-medium text-gray-300 mb-2">
							Webhook URL
						</label>
						<div class="flex gap-2">
							<input type="url" id="webhookUrl" placeholder="https://discord.com/api/webhooks/..."
								class="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent">
							<button type="button" onclick="validateWebhook()" id="validateWebhookBtn"
								class="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition text-sm">
								Validate
							</button>
						</div>
						<p class="text-xs text-gray-500 mt-2">
							<a href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks" target="_blank" class="text-blue-400 hover:underline">
								How to create a Discord webhook
							</a>
						</p>
						<div id="webhookValidationResult" class="mt-2 hidden"></div>
					</div>

					<!-- Bot Section -->
					<div id="botSection" class="bg-gray-750 rounded-lg p-4 hidden">
						<div class="space-y-4">
							<div>
								<label for="botToken" class="block text-sm font-medium text-gray-300 mb-2">
									Bot Token
								</label>
								<input type="password" id="botToken" placeholder="Enter bot token..."
									class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent">
								<p class="text-xs text-gray-500 mt-1">Your bot must have MESSAGE_SEND permission</p>
							</div>
							<div>
								<label for="channelId" class="block text-sm font-medium text-gray-300 mb-2">
									Channel ID
								</label>
								<input type="text" id="channelId" placeholder="123456789012345678"
									class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent">
							</div>
							<div>
								<label for="guildId" class="block text-sm font-medium text-gray-300 mb-2">
									Guild (Server) ID <span class="text-gray-500">(optional)</span>
								</label>
								<input type="text" id="guildId" placeholder="123456789012345678"
									class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent">
							</div>
						</div>
					</div>

					<!-- Event Notifications -->
					<div class="setting-group">
						<h4 class="text-md font-medium text-gray-300 mb-3">Event Notifications</h4>
						<div class="space-y-3">
							<label class="flex items-center gap-3 cursor-pointer">
								<input type="checkbox" id="notifyTournamentStart" checked
									class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
								<span class="text-gray-300">Tournament Started</span>
							</label>
							<label class="flex items-center gap-3 cursor-pointer">
								<input type="checkbox" id="notifyTournamentComplete" checked
									class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
								<span class="text-gray-300">Tournament Complete</span>
							</label>
							<label class="flex items-center gap-3 cursor-pointer">
								<input type="checkbox" id="notifyMatchComplete" checked
									class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
								<span class="text-gray-300">Match Results</span>
							</label>
							<label class="flex items-center gap-3 cursor-pointer">
								<input type="checkbox" id="notifyParticipantSignup" checked
									class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
								<span class="text-gray-300">New Signups</span>
							</label>
							<label class="flex items-center gap-3 cursor-pointer">
								<input type="checkbox" id="notifyParticipantCheckin" checked
									class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
								<span class="text-gray-300">Check-ins</span>
							</label>
							<label class="flex items-center gap-3 cursor-pointer">
								<input type="checkbox" id="notifyDqTimer" checked
									class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
								<span class="text-gray-300">DQ Timer Expired</span>
							</label>
						</div>
					</div>

					<!-- Options -->
					<div class="setting-group">
						<h4 class="text-md font-medium text-gray-300 mb-3">Options</h4>
						<div class="space-y-4">
							<div>
								<label for="mentionRoleId" class="block text-sm font-medium text-gray-300 mb-2">
									Mention Role ID <span class="text-gray-500">(optional)</span>
								</label>
								<input type="text" id="mentionRoleId" placeholder="123456789012345678"
									class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent">
								<p class="text-xs text-gray-500 mt-1">Role to mention in notifications (leave empty for no mention)</p>
							</div>
							<div>
								<label for="embedColor" class="block text-sm font-medium text-gray-300 mb-2">
									Embed Color
								</label>
								<div class="flex items-center gap-3">
									<input type="color" id="embedColor" value="#5865F2"
										class="w-12 h-10 bg-gray-700 border border-gray-600 rounded cursor-pointer">
									<input type="text" id="embedColorHex" value="#5865F2" readonly
										class="w-24 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm">
								</div>
							</div>
							<label class="flex items-center gap-3 cursor-pointer">
								<input type="checkbox" id="includeBracketLink" checked
									class="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500">
								<span class="text-gray-300">Include bracket link in notifications</span>
							</label>
						</div>
					</div>

					<!-- Status -->
					<div id="discordStatusSection" class="bg-gray-750 rounded-lg p-4">
						<h4 class="text-md font-medium text-gray-300 mb-2">Status</h4>
						<div id="discordStatusContent" class="text-sm text-gray-400">
							Loading status...
						</div>
					</div>

					<!-- Actions -->
					<div class="flex flex-wrap gap-3">
						<button type="button" onclick="testDiscordNotification()" id="testDiscordBtn"
							class="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-md transition">
							Test Notification
						</button>
						<button type="button" onclick="saveDiscordSettings()" id="saveDiscordBtn"
							class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md transition">
							Save Settings
						</button>
						<button type="button" onclick="removeDiscordIntegration()" id="removeDiscordBtn"
							class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition">
							Remove Integration
						</button>
					</div>
				</div>
			</div>
		</div>
	`;
}

// Load Discord settings
async function loadDiscordSettings() {
	try {
		const response = await fetch('/api/settings/discord');
		const data = await response.json();

		if (data.success) {
			discordSettings = data.settings;
			populateDiscordForm(discordSettings);
			updateDiscordStatusBadge(discordSettings);
			updateDiscordStatusSection(discordSettings);
		} else {
			showSettingsToast('Failed to load Discord settings', 'error');
		}
	} catch (error) {
		FrontendDebug.error('Settings', 'Failed to load Discord settings', error);
		showSettingsToast('Error loading Discord settings', 'error');
	}
}

// Populate Discord form with settings
function populateDiscordForm(settings) {
	// Enable toggle
	document.getElementById('discordEnabled').checked = settings.is_enabled;
	toggleDiscordEnabled(false);

	// Integration type
	if (settings.integration_type === 'bot') {
		document.getElementById('typeBot').checked = true;
	} else {
		document.getElementById('typeWebhook').checked = true;
	}
	toggleIntegrationType();

	// Channel/Guild IDs
	document.getElementById('channelId').value = settings.channel_id || '';
	document.getElementById('guildId').value = settings.guild_id || '';

	// Event notifications
	document.getElementById('notifyTournamentStart').checked = settings.notify_tournament_start;
	document.getElementById('notifyTournamentComplete').checked = settings.notify_tournament_complete;
	document.getElementById('notifyMatchComplete').checked = settings.notify_match_complete;
	document.getElementById('notifyParticipantSignup').checked = settings.notify_participant_signup;
	document.getElementById('notifyParticipantCheckin').checked = settings.notify_participant_checkin;
	document.getElementById('notifyDqTimer').checked = settings.notify_dq_timer;

	// Options
	document.getElementById('mentionRoleId').value = settings.mention_role_id || '';
	document.getElementById('embedColor').value = settings.embed_color || '#5865F2';
	document.getElementById('embedColorHex').value = settings.embed_color || '#5865F2';
	document.getElementById('includeBracketLink').checked = settings.include_bracket_link;

	// Setup color picker sync
	document.getElementById('embedColor').addEventListener('input', (e) => {
		document.getElementById('embedColorHex').value = e.target.value;
	});
}

// Update Discord status badge
function updateDiscordStatusBadge(settings) {
	const badge = document.getElementById('discordStatusBadge');
	if (!badge) return;

	if (settings.is_enabled && (settings.has_webhook || settings.has_bot_token)) {
		badge.innerHTML = '<span class="px-2 py-1 text-xs rounded bg-green-600 text-white">Active</span>';
	} else if (settings.has_webhook || settings.has_bot_token) {
		badge.innerHTML = '<span class="px-2 py-1 text-xs rounded bg-yellow-600 text-white">Configured (Disabled)</span>';
	} else {
		badge.innerHTML = '<span class="px-2 py-1 text-xs rounded bg-gray-600 text-gray-300">Not Configured</span>';
	}
}

// Update Discord status section
function updateDiscordStatusSection(settings) {
	const section = document.getElementById('discordStatusContent');
	if (!section) return;

	let html = '<div class="space-y-1">';

	if (settings.has_webhook) {
		html += '<p><span class="text-green-400">Webhook configured</span></p>';
	}
	if (settings.has_bot_token) {
		html += '<p><span class="text-green-400">Bot token configured</span></p>';
	}
	if (!settings.has_webhook && !settings.has_bot_token) {
		html += '<p><span class="text-gray-500">No credentials configured</span></p>';
	}

	if (settings.last_test_at) {
		html += '<p>Last test: <span class="text-white">' + formatDateTime(settings.last_test_at) + '</span></p>';
	}

	if (settings.last_error) {
		html += '<p>Last error: <span class="text-red-400">' + escapeHtml(settings.last_error) + '</span></p>';
	}

	html += '</div>';
	section.innerHTML = html;
}

// Toggle Discord enabled state
function toggleDiscordEnabled(save = true) {
	const enabled = document.getElementById('discordEnabled').checked;
	const configSection = document.getElementById('discordConfigSection');

	if (configSection) {
		configSection.style.opacity = enabled ? '1' : '0.5';
		configSection.style.pointerEvents = enabled ? 'auto' : 'none';
	}
}

// Toggle integration type (webhook vs bot)
function toggleIntegrationType() {
	const isWebhook = document.getElementById('typeWebhook').checked;
	const webhookSection = document.getElementById('webhookSection');
	const botSection = document.getElementById('botSection');

	if (isWebhook) {
		webhookSection.classList.remove('hidden');
		botSection.classList.add('hidden');
	} else {
		webhookSection.classList.add('hidden');
		botSection.classList.remove('hidden');
	}
}

// Validate webhook URL
async function validateWebhook() {
	const url = document.getElementById('webhookUrl').value.trim();
	const btn = document.getElementById('validateWebhookBtn');
	const resultDiv = document.getElementById('webhookValidationResult');

	if (!url) {
		showSettingsToast('Please enter a webhook URL', 'error');
		return;
	}

	btn.disabled = true;
	btn.textContent = 'Validating...';
	resultDiv.classList.add('hidden');

	try {
		const response = await csrfFetch('/api/settings/discord/validate-webhook', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ webhook_url: url })
		});

		const data = await response.json();

		resultDiv.classList.remove('hidden');
		if (data.success) {
			resultDiv.innerHTML = `
				<div class="flex items-center gap-2 text-green-400">
					<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
					</svg>
					<span>Valid webhook: ${escapeHtml(data.webhookInfo?.name || 'Webhook')}</span>
				</div>
			`;
		} else {
			resultDiv.innerHTML = `
				<div class="flex items-center gap-2 text-red-400">
					<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
					</svg>
					<span>${escapeHtml(data.error || 'Invalid webhook')}</span>
				</div>
			`;
		}
	} catch (error) {
		resultDiv.classList.remove('hidden');
		resultDiv.innerHTML = `
			<div class="flex items-center gap-2 text-red-400">
				<span>Error validating webhook</span>
			</div>
		`;
	} finally {
		btn.disabled = false;
		btn.textContent = 'Validate';
	}
}

// Save Discord settings
async function saveDiscordSettings() {
	const btn = document.getElementById('saveDiscordBtn');
	btn.disabled = true;
	btn.textContent = 'Saving...';

	try {
		const isWebhook = document.getElementById('typeWebhook').checked;
		const webhookUrl = document.getElementById('webhookUrl').value.trim();
		const botToken = document.getElementById('botToken').value.trim();

		const settings = {
			integration_type: isWebhook ? 'webhook' : 'bot',
			is_enabled: document.getElementById('discordEnabled').checked,
			notify_tournament_start: document.getElementById('notifyTournamentStart').checked,
			notify_tournament_complete: document.getElementById('notifyTournamentComplete').checked,
			notify_match_complete: document.getElementById('notifyMatchComplete').checked,
			notify_participant_signup: document.getElementById('notifyParticipantSignup').checked,
			notify_participant_checkin: document.getElementById('notifyParticipantCheckin').checked,
			notify_dq_timer: document.getElementById('notifyDqTimer').checked,
			mention_role_id: document.getElementById('mentionRoleId').value.trim() || null,
			embed_color: document.getElementById('embedColor').value,
			include_bracket_link: document.getElementById('includeBracketLink').checked,
			channel_id: document.getElementById('channelId').value.trim() || null,
			guild_id: document.getElementById('guildId').value.trim() || null
		};

		// Only send credentials if they're new (not empty)
		if (webhookUrl) {
			settings.webhook_url = webhookUrl;
		}
		if (botToken) {
			settings.bot_token = botToken;
		}

		const response = await csrfFetch('/api/settings/discord', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(settings)
		});

		const data = await response.json();

		if (data.success) {
			showSettingsToast('Discord settings saved successfully', 'success');
			// Reload to get updated state
			await loadDiscordSettings();
		} else {
			showSettingsToast(data.error || 'Failed to save Discord settings', 'error');
		}
	} catch (error) {
		FrontendDebug.error('Settings', 'Failed to save Discord settings', error);
		showSettingsToast('Error saving Discord settings', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Save Settings';
	}
}

// Test Discord notification
async function testDiscordNotification() {
	const btn = document.getElementById('testDiscordBtn');
	btn.disabled = true;
	btn.textContent = 'Sending...';

	try {
		const response = await csrfFetch('/api/settings/discord/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		const data = await response.json();

		if (data.success) {
			showSettingsToast('Test notification sent successfully', 'success');
			// Reload to update last_test_at
			await loadDiscordSettings();
		} else {
			showSettingsToast(data.error || 'Failed to send test notification', 'error');
			// Reload to update last_error
			await loadDiscordSettings();
		}
	} catch (error) {
		FrontendDebug.error('Settings', 'Failed to send test notification', error);
		showSettingsToast('Error sending test notification', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Test Notification';
	}
}

// Remove Discord integration
async function removeDiscordIntegration() {
	if (!confirm('Are you sure you want to remove Discord integration? This will delete all your Discord settings.')) {
		return;
	}

	const btn = document.getElementById('removeDiscordBtn');
	btn.disabled = true;
	btn.textContent = 'Removing...';

	try {
		const response = await csrfFetch('/api/settings/discord', {
			method: 'DELETE'
		});

		const data = await response.json();

		if (data.success) {
			showSettingsToast('Discord integration removed', 'success');
			// Reload to reset form
			await loadDiscordSettings();
		} else {
			showSettingsToast(data.error || 'Failed to remove Discord integration', 'error');
		}
	} catch (error) {
		FrontendDebug.error('Settings', 'Failed to remove Discord integration', error);
		showSettingsToast('Error removing Discord integration', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Remove Integration';
	}
}

// Cleanup all intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	if (monitoringRefreshInterval) clearInterval(monitoringRefreshInterval);
});
