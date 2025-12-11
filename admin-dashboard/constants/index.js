/**
 * Constants Module
 *
 * Centralized constants for the Tournament Control Center admin dashboard.
 * Extracted from server.js for better modularity.
 */

// PDF Report Colors
const PDF_COLORS = {
	primary: '#1A1A1A',      // Near-black for headers/backgrounds
	secondary: '#FFFFFF',    // White for text on dark backgrounds
	accent: '#E63946',       // Red for highlights and accents
	muted: '#6B7280',        // Gray for secondary text
	surface: '#2D2D2D',      // Dark gray for alternating rows
	border: '#404040',       // Subtle borders
	gold: '#FFD700',         // 1st place medal
	silver: '#C0C0C0',       // 2nd place medal
	bronze: '#CD7F32',       // 3rd place medal
	rowAlt: '#F5F5F5'        // Alternating row background
};

// Activity Types for audit logging
const ACTIVITY_TYPES = {
	// Admin Actions
	ADMIN_LOGIN: 'admin_login',
	ADMIN_LOGOUT: 'admin_logout',
	SETTINGS_UPDATE: 'update_settings',
	USER_CREATE: 'user_create',
	USER_DELETE: 'user_delete',
	TOKEN_CREATE: 'token_created',
	TOKEN_REVOKE: 'token_revoked',

	// Tournament Events
	TOURNAMENT_CREATE: 'tournament_create',
	TOURNAMENT_START: 'tournament_start',
	TOURNAMENT_COMPLETE: 'tournament_complete',
	TOURNAMENT_RESET: 'tournament_reset',
	TOURNAMENT_DELETE: 'tournament_delete',

	// Participant Events
	PARTICIPANT_SIGNUP: 'participant_signup',
	PARTICIPANT_ADD: 'participant_add',
	PARTICIPANT_CHECKIN: 'participant_checkin',
	PARTICIPANT_CHECKOUT: 'participant_checkout',
	PARTICIPANT_DELETE: 'participant_delete',

	// Match Events
	MATCH_START: 'match_start',
	MATCH_COMPLETE: 'match_complete',
	MATCH_DQ: 'match_dq',
	MATCH_REOPEN: 'match_reopen',

	// Display Events
	DISPLAY_ONLINE: 'display_online',
	DISPLAY_OFFLINE: 'display_offline',
	DISPLAY_REBOOT: 'display_reboot',
	DISPLAY_SHUTDOWN: 'display_shutdown',

	// System Events
	DEV_MODE_ENABLED: 'dev_mode_enabled',
	DEV_MODE_DISABLED: 'dev_mode_disabled',
	RATE_MODE_CHANGE: 'rate_mode_change',
	GAME_CREATE: 'create_game',
	GAME_UPDATE: 'update_game',
	GAME_DELETE: 'delete_game'
};

// Category mappings for activity filtering
const ACTIVITY_CATEGORIES = {
	admin: ['admin_login', 'admin_logout', 'update_settings', 'user_create', 'user_delete', 'token_created', 'token_revoked'],
	tournament: ['tournament_create', 'tournament_start', 'tournament_complete', 'tournament_reset', 'tournament_delete'],
	participant: ['participant_signup', 'participant_add', 'participant_checkin', 'participant_checkout', 'participant_delete'],
	match: ['match_start', 'match_complete', 'match_dq', 'match_reopen'],
	display: ['display_online', 'display_offline', 'display_reboot', 'display_shutdown'],
	system: ['dev_mode_enabled', 'dev_mode_disabled', 'rate_mode_change', 'create_game', 'update_game', 'delete_game', 'quick_system_check', 'player_alias_added', 'rate_mode_override_set', 'rate_mode_override_cleared', 'clear_activity_log']
};

/**
 * Get category for an activity action
 * @param {string} action - The activity action type
 * @returns {string} The category name or 'system' as default
 */
function getActivityCategory(action) {
	for (const [category, actions] of Object.entries(ACTIVITY_CATEGORIES)) {
		if (actions.includes(action)) return category;
	}
	return 'system';
}

// Rate limiting modes
const RATE_MODES = {
	IDLE: { name: 'IDLE', description: 'No upcoming tournaments' },
	UPCOMING: { name: 'UPCOMING', description: 'Tournament starting soon' },
	ACTIVE: { name: 'ACTIVE', description: 'Tournament underway' }
};

// Dev mode duration: 3 hours in milliseconds
const DEV_MODE_DURATION_MS = 3 * 60 * 60 * 1000;

// Stale tournament threshold (7 days in milliseconds)
const STALE_TOURNAMENT_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// Match polling intervals
const MATCH_POLL_INTERVAL_MS = 15000;      // 15 seconds (normal mode)
const DEV_MODE_POLL_INTERVAL_MS = 5000;    // 5 seconds (dev mode)

// WebSocket delivery settings
const WS_HTTP_FALLBACK_DELAY_MS = 30000;   // 30 seconds before HTTP fallback

module.exports = {
	PDF_COLORS,
	ACTIVITY_TYPES,
	ACTIVITY_CATEGORIES,
	getActivityCategory,
	RATE_MODES,
	DEV_MODE_DURATION_MS,
	STALE_TOURNAMENT_THRESHOLD_MS,
	MATCH_POLL_INTERVAL_MS,
	DEV_MODE_POLL_INTERVAL_MS,
	WS_HTTP_FALLBACK_DELAY_MS
};
