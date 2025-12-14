/**
 * Settings Service
 *
 * Centralized settings, user, and authentication data management.
 * Extracted from server.js for modularity.
 */

const fsSync = require('fs');
const path = require('path');

// File paths
const USERS_FILE = path.join(__dirname, '..', 'users.json');
const AUTH_DATA_FILE = path.join(__dirname, '..', 'auth-data.json');
const SETTINGS_FILE = path.join(__dirname, '..', 'system-settings.json');
const ACTIVITY_LOG_FILE = path.join(__dirname, '..', 'activity-log.json');
const DISPLAYS_FILE = path.join(__dirname, '..', 'displays.json');
const GAME_CONFIGS_FILE = path.join(__dirname, '..', 'game-configs.json');
const SPONSOR_STATE_FILE = path.join(__dirname, '..', 'sponsor-state.json');

// Settings cache for performance
let systemSettingsCache = null;
let systemSettingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 60000; // 1 minute

/**
 * Load system settings with caching
 * @returns {Object|null} System settings or null on error
 */
function loadSystemSettings() {
	const now = Date.now();
	if (systemSettingsCache && (now - systemSettingsCacheTime) < SETTINGS_CACHE_TTL) {
		return systemSettingsCache;
	}

	try {
		const data = fsSync.readFileSync(SETTINGS_FILE, 'utf8');
		systemSettingsCache = JSON.parse(data);
		systemSettingsCacheTime = now;
		return systemSettingsCache;
	} catch (error) {
		console.error('[Settings] Error loading system settings:', error.message);
		return null;
	}
}

/**
 * Clear settings cache (call after updates)
 */
function clearSettingsCache() {
	systemSettingsCache = null;
	systemSettingsCacheTime = 0;
}

/**
 * Load system settings (alias without caching behavior exposed)
 * @returns {Object|null} System settings
 */
function loadSettings() {
	try {
		const data = fsSync.readFileSync(SETTINGS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('[Settings] Error loading settings:', error.message);
		return null;
	}
}

/**
 * Save system settings
 * @param {Object} settings - Settings to save
 * @returns {boolean} Success status
 */
function saveSettings(settings) {
	try {
		fsSync.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
		clearSettingsCache();
		return true;
	} catch (error) {
		console.error('[Settings] Error saving settings:', error.message);
		return false;
	}
}

/**
 * Get security settings with defaults
 * @returns {Object} Security settings
 */
function getSecuritySettings() {
	const settings = loadSystemSettings();
	return {
		maxFailedAttempts: settings?.security?.maxFailedAttempts || 5,
		lockoutDuration: settings?.security?.lockoutDuration || (60 * 60 * 1000), // 1 hour
		passwordMinLength: settings?.security?.passwordMinLength || 8,
		requirePasswordComplexity: settings?.security?.requirePasswordComplexity || false,
		sessionTimeout: settings?.security?.sessionTimeout || (7 * 24 * 60 * 60 * 1000) // 7 days
	};
}

/**
 * Get system defaults with fallbacks
 * @returns {Object} System defaults
 */
function getSystemDefaults() {
	const settings = loadSystemSettings();
	return {
		registrationWindow: settings?.systemDefaults?.registrationWindow || 48,
		signupCap: settings?.systemDefaults?.signupCap || null,
		defaultGame: settings?.systemDefaults?.defaultGame || '',
		tournamentType: settings?.systemDefaults?.tournamentType || 'single elimination'
	};
}

/**
 * Get display settings with defaults
 * @returns {Object} Display settings
 */
function getDisplaySettings() {
	const settings = loadSystemSettings();
	return {
		matchRefreshInterval: settings?.display?.matchRefreshInterval || 5000,
		bracketRefreshInterval: settings?.display?.bracketRefreshInterval || 60000,
		flyerRefreshInterval: settings?.display?.flyerRefreshInterval || 60000,
		defaultFlyer: settings?.display?.defaultFlyer || '',
		bracketZoomLevel: settings?.display?.bracketZoomLevel || 0.75
	};
}

/**
 * Get DQ timer settings with defaults
 * @returns {Object} DQ timer settings
 */
function getDQTimerSettings() {
	const settings = loadSystemSettings();
	return {
		autoDqEnabled: settings?.dqTimer?.autoDqEnabled ?? false,
		autoDqAction: settings?.dqTimer?.autoDqAction || 'notify',
		defaultDuration: settings?.dqTimer?.defaultDuration || 180,
		warningThreshold: settings?.dqTimer?.warningThreshold || 30
	};
}

/**
 * Get bracket display settings with defaults
 * @returns {Object} Bracket display settings
 */
function getBracketDisplaySettings() {
	const settings = loadSystemSettings();
	return {
		theme: settings?.bracketDisplay?.theme || 'midnight'
	};
}

/**
 * Get adaptive rate limit settings
 * @returns {Object} Rate limit settings
 */
function getAdaptiveRateLimitSettings() {
	const settings = loadSystemSettings();
	return {
		enabled: settings?.rateLimit?.adaptiveEnabled ?? false,
		idleRate: settings?.rateLimit?.idleRate || 1,
		upcomingRate: settings?.rateLimit?.upcomingRate || 5,
		activeRate: settings?.rateLimit?.activeRate || 15,
		checkIntervalHours: settings?.rateLimit?.checkIntervalHours || 8,
		upcomingWindowHours: settings?.rateLimit?.upcomingWindowHours || 48,
		manualRateLimit: settings?.rateLimit?.manualRateLimit || 15
	};
}

// ============================================
// USER MANAGEMENT
// ============================================

/**
 * Load users from file
 * @returns {Object} Users data object with users array
 */
function loadUsers() {
	try {
		const data = fsSync.readFileSync(USERS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('[Settings] Error loading users:', error.message);
		return { users: [] };
	}
}

/**
 * Save users to file
 * @param {Object} usersData - Users data to save
 * @returns {boolean} Success status
 */
function saveUsers(usersData) {
	try {
		fsSync.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2));
		return true;
	} catch (error) {
		console.error('[Settings] Error saving users:', error.message);
		return false;
	}
}

// ============================================
// AUTHENTICATION DATA
// ============================================

/**
 * Load auth data (failed attempts and lockouts)
 * @returns {Object} Auth data
 */
function loadAuthData() {
	try {
		const data = fsSync.readFileSync(AUTH_DATA_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		return { failedAttempts: {}, lockedAccounts: {} };
	}
}

/**
 * Save auth data
 * @param {Object} authData - Auth data to save
 */
function saveAuthData(authData) {
	try {
		fsSync.writeFileSync(AUTH_DATA_FILE, JSON.stringify(authData, null, 2));
	} catch (error) {
		console.error('[Settings] Error saving auth data:', error.message);
	}
}

/**
 * Check if account is locked
 * @param {string} username - Username to check
 * @returns {Object} { locked: boolean, remainingMinutes?: number }
 */
function isAccountLocked(username) {
	const securitySettings = getSecuritySettings();
	const authData = loadAuthData();

	if (authData.lockedAccounts[username]) {
		const lockoutTime = authData.lockedAccounts[username];
		const now = Date.now();
		if (now - lockoutTime < securitySettings.lockoutDuration) {
			const remainingTime = securitySettings.lockoutDuration - (now - lockoutTime);
			return {
				locked: true,
				remainingMinutes: Math.ceil(remainingTime / 60000)
			};
		} else {
			// Lockout expired, remove it
			delete authData.lockedAccounts[username];
			delete authData.failedAttempts[username];
			saveAuthData(authData);
		}
	}
	return { locked: false };
}

/**
 * Record failed login attempt
 * @param {string} username - Username
 * @returns {number} Number of failed attempts
 */
function recordFailedAttempt(username) {
	const securitySettings = getSecuritySettings();
	const authData = loadAuthData();
	authData.failedAttempts[username] = (authData.failedAttempts[username] || 0) + 1;

	if (authData.failedAttempts[username] >= securitySettings.maxFailedAttempts) {
		authData.lockedAccounts[username] = Date.now();
		console.log(`[Settings] Account locked: ${username} (too many failed attempts)`);
	}

	saveAuthData(authData);
	return authData.failedAttempts[username];
}

/**
 * Clear failed attempts on successful login
 * @param {string} username - Username
 */
function clearFailedAttempts(username) {
	const authData = loadAuthData();
	delete authData.failedAttempts[username];
	saveAuthData(authData);
}

/**
 * Validate password against security settings
 * @param {string} password - Password to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validatePassword(password) {
	const securitySettings = getSecuritySettings();
	const errors = [];

	// Check minimum length
	if (password.length < securitySettings.passwordMinLength) {
		errors.push(`Password must be at least ${securitySettings.passwordMinLength} characters long`);
	}

	// Check complexity if required
	if (securitySettings.requirePasswordComplexity) {
		const hasUpperCase = /[A-Z]/.test(password);
		const hasLowerCase = /[a-z]/.test(password);
		const hasNumber = /[0-9]/.test(password);
		const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

		if (!hasUpperCase) {
			errors.push('Password must contain at least one uppercase letter');
		}
		if (!hasLowerCase) {
			errors.push('Password must contain at least one lowercase letter');
		}
		if (!hasNumber) {
			errors.push('Password must contain at least one number');
		}
		if (!hasSpecial) {
			errors.push('Password must contain at least one special character');
		}
	}

	return {
		valid: errors.length === 0,
		errors: errors
	};
}

// ============================================
// ACTIVITY LOG
// ============================================

/**
 * Load activity log
 * @returns {Object} Activity log data
 */
function loadActivityLog() {
	try {
		const data = fsSync.readFileSync(ACTIVITY_LOG_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		return { logs: [] };
	}
}

/**
 * Save activity log
 * @param {Object} logData - Log data to save
 */
function saveActivityLog(logData) {
	try {
		fsSync.writeFileSync(ACTIVITY_LOG_FILE, JSON.stringify(logData, null, 2));
	} catch (error) {
		console.error('[Settings] Error saving activity log:', error.message);
	}
}

// ============================================
// DISPLAY MANAGEMENT
// ============================================

/**
 * Load displays from file
 * @returns {Object} Displays data
 */
function loadDisplays() {
	try {
		const data = fsSync.readFileSync(DISPLAYS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		return { displays: [] };
	}
}

/**
 * Save displays to file
 * @param {Object} displaysData - Displays data to save
 * @returns {boolean} Success status
 */
function saveDisplays(displaysData) {
	try {
		fsSync.writeFileSync(DISPLAYS_FILE, JSON.stringify(displaysData, null, 2));
		return true;
	} catch (error) {
		console.error('[Settings] Error saving displays:', error.message);
		return false;
	}
}

// ============================================
// GAME CONFIGURATIONS
// ============================================

/**
 * Load game configs from file
 * @returns {Object} Game configs
 */
function loadGameConfigs() {
	try {
		const data = fsSync.readFileSync(GAME_CONFIGS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('[Settings] Error loading game configs:', error.message);
		return {};
	}
}

/**
 * Save game configs to file
 * @param {Object} configs - Game configs to save
 * @returns {boolean} Success status
 */
function saveGameConfigs(configs) {
	try {
		fsSync.writeFileSync(GAME_CONFIGS_FILE, JSON.stringify(configs, null, 2));
		return true;
	} catch (error) {
		console.error('[Settings] Error saving game configs:', error.message);
		return false;
	}
}

/**
 * Validate game key format
 * @param {string} key - Game key to validate
 * @returns {boolean} Whether key is valid
 */
function validateGameKey(key) {
	return /^[a-z0-9_-]+$/i.test(key);
}

// ============================================
// SPONSOR STATE
// ============================================

/**
 * Load sponsor state from file
 * @returns {Object} Sponsor state
 */
function loadSponsorState() {
	try {
		const data = fsSync.readFileSync(SPONSOR_STATE_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		return { sponsors: [], config: { rotationInterval: 30000, enabled: false } };
	}
}

/**
 * Save sponsor state to file
 * @param {Object} state - Sponsor state to save
 * @returns {boolean} Success status
 */
function saveSponsorState(state) {
	try {
		fsSync.writeFileSync(SPONSOR_STATE_FILE, JSON.stringify(state, null, 2));
		return true;
	} catch (error) {
		console.error('[Settings] Error saving sponsor state:', error.message);
		return false;
	}
}

// ============================================
// FILE PATHS (Exported for direct access)
// ============================================

module.exports = {
	// File paths
	USERS_FILE,
	AUTH_DATA_FILE,
	SETTINGS_FILE,
	ACTIVITY_LOG_FILE,
	DISPLAYS_FILE,
	GAME_CONFIGS_FILE,
	SPONSOR_STATE_FILE,

	// Cache management
	SETTINGS_CACHE_TTL,
	clearSettingsCache,

	// System settings
	loadSystemSettings,
	loadSettings,
	saveSettings,
	getSecuritySettings,
	getSystemDefaults,
	getDisplaySettings,
	getDQTimerSettings,
	getBracketDisplaySettings,
	getAdaptiveRateLimitSettings,

	// User management
	loadUsers,
	saveUsers,

	// Auth data
	loadAuthData,
	saveAuthData,
	isAccountLocked,
	recordFailedAttempt,
	clearFailedAttempts,
	validatePassword,

	// Activity log
	loadActivityLog,
	saveActivityLog,

	// Display management
	loadDisplays,
	saveDisplays,

	// Game configs
	loadGameConfigs,
	saveGameConfigs,
	validateGameKey,

	// Sponsor state
	loadSponsorState,
	saveSponsorState
};
