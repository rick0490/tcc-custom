/**
 * Activity Logger Service
 *
 * Handles activity logging and real-time event broadcasting.
 * Extracted from server.js for modularity.
 */

const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES, getActivityCategory } = require('../constants');
const settings = require('./settings');

// Reference to Socket.IO instance (set by init)
let io = null;

/**
 * Initialize the activity logger with Socket.IO instance
 * @param {Server} socketIo - Socket.IO server instance
 */
function init(socketIo) {
	io = socketIo;
}

/**
 * Add activity log entry and broadcast to connected clients
 * @param {string|number} userId - User ID
 * @param {string} username - Username
 * @param {string} action - Activity action type
 * @param {Object} details - Additional details
 * @returns {Object} The created log entry
 */
function logActivity(userId, username, action, details = {}) {
	const logData = settings.loadActivityLog();
	const entry = {
		id: Date.now(),
		userId,
		username,
		action,
		category: getActivityCategory(action),
		details,
		timestamp: new Date().toISOString()
	};

	logData.logs.unshift(entry);

	// Keep only last 1000 entries
	if (logData.logs.length > 1000) {
		logData.logs = logData.logs.slice(0, 1000);
	}

	settings.saveActivityLog(logData);

	// Broadcast to connected admin clients via WebSocket
	broadcastActivityEvent(entry);

	return entry;
}

/**
 * Broadcast activity event to admin clients
 * @param {Object} entry - Activity log entry
 */
function broadcastActivityEvent(entry) {
	if (io) {
		io.emit('activity:new', {
			...entry,
			serverTime: new Date().toISOString()
		});
		console.log(`[Activity] Broadcast: ${entry.action} by ${entry.username}`);
	}
}

/**
 * Get paginated activity log
 * @param {Object} options - { limit, offset, category, search }
 * @returns {Object} { logs, pagination }
 */
function getActivityLog({ limit = 50, offset = 0, category = null, search = null } = {}) {
	const logData = settings.loadActivityLog();
	let logs = logData.logs || [];

	// Filter by category
	if (category && ACTIVITY_CATEGORIES[category]) {
		logs = logs.filter(log => ACTIVITY_CATEGORIES[category].includes(log.action));
	}

	// Filter by search term
	if (search) {
		const searchLower = search.toLowerCase();
		logs = logs.filter(log =>
			log.username?.toLowerCase().includes(searchLower) ||
			log.action?.toLowerCase().includes(searchLower) ||
			JSON.stringify(log.details).toLowerCase().includes(searchLower)
		);
	}

	const total = logs.length;
	const paginatedLogs = logs.slice(offset, offset + limit);

	return {
		logs: paginatedLogs,
		pagination: {
			total,
			limit,
			offset,
			hasMore: offset + limit < total
		}
	};
}

/**
 * Clear activity log
 * @returns {boolean} Success status
 */
function clearActivityLog() {
	settings.saveActivityLog({ logs: [] });
	return true;
}

/**
 * Get recent activity for initial WebSocket connection
 * @param {number} count - Number of entries to return
 * @returns {Array} Recent activity entries
 */
function getRecentActivity(count = 20) {
	const logData = settings.loadActivityLog();
	return (logData.logs || []).slice(0, count);
}

module.exports = {
	// Types and categories (re-export for convenience)
	ACTIVITY_TYPES,
	ACTIVITY_CATEGORIES,
	getActivityCategory,

	// Core functions
	init,
	logActivity,
	broadcastActivityEvent,
	getActivityLog,
	clearActivityLog,
	getRecentActivity
};
