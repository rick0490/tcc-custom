/**
 * Ticker Scheduler Service
 * Manages scheduled ticker messages with time-based triggers
 */

const fs = require('fs');
const path = require('path');

// Storage file for scheduled messages
const SCHEDULE_FILE = path.join(__dirname, '..', 'ticker-schedule.json');

// In-memory state
let scheduledMessages = [];
let checkInterval = null;
let broadcastFn = null; // Will be set from server.js

/**
 * Initialize the scheduler with broadcast function
 * @param {Function} broadcast - Function to broadcast ticker message
 */
function initialize(broadcast) {
	broadcastFn = broadcast;
	loadSchedule();
	startScheduler();
	console.log('[Ticker Scheduler] Initialized');
}

/**
 * Load schedule from disk
 */
function loadSchedule() {
	try {
		if (fs.existsSync(SCHEDULE_FILE)) {
			const data = fs.readFileSync(SCHEDULE_FILE, 'utf8');
			scheduledMessages = JSON.parse(data);
			// Filter out expired messages
			const now = Date.now();
			scheduledMessages = scheduledMessages.filter(m => {
				if (m.type === 'once') {
					return new Date(m.scheduledTime).getTime() > now;
				}
				return true; // Recurring messages are always kept
			});
			saveSchedule();
			console.log(`[Ticker Scheduler] Loaded ${scheduledMessages.length} scheduled messages`);
		}
	} catch (error) {
		console.error('[Ticker Scheduler] Error loading schedule:', error);
		scheduledMessages = [];
	}
}

/**
 * Save schedule to disk
 */
function saveSchedule() {
	try {
		fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(scheduledMessages, null, 2));
	} catch (error) {
		console.error('[Ticker Scheduler] Error saving schedule:', error);
	}
}

/**
 * Start the scheduler check interval
 */
function startScheduler() {
	// Check every 30 seconds
	checkInterval = setInterval(checkSchedule, 30000);
	// Also run immediately
	checkSchedule();
}

/**
 * Stop the scheduler
 */
function stopScheduler() {
	if (checkInterval) {
		clearInterval(checkInterval);
		checkInterval = null;
	}
}

/**
 * Check schedule and trigger due messages
 */
function checkSchedule() {
	if (!broadcastFn) return;

	const now = new Date();
	const currentTime = now.getHours() * 60 + now.getMinutes(); // Minutes since midnight
	const currentDay = now.getDay(); // 0=Sunday, 1=Monday, etc.

	scheduledMessages.forEach(msg => {
		if (!msg.enabled) return;

		let shouldTrigger = false;

		if (msg.type === 'once') {
			// One-time scheduled message
			const scheduledDate = new Date(msg.scheduledTime);
			const timeDiff = Math.abs(scheduledDate.getTime() - now.getTime());
			// Trigger if within 30 seconds of scheduled time
			if (timeDiff < 30000 && !msg.triggered) {
				shouldTrigger = true;
				msg.triggered = true;
			}
		} else if (msg.type === 'recurring') {
			// Recurring message (daily at specific time)
			const [hours, minutes] = msg.time.split(':').map(Number);
			const scheduledMinutes = hours * 60 + minutes;

			// Check if days match (if specified)
			const daysMatch = !msg.days || msg.days.length === 0 || msg.days.includes(currentDay);

			// Check if within trigger window (30 second window)
			const timeDiff = Math.abs(currentTime - scheduledMinutes);
			const inWindow = timeDiff < 1; // Within 1 minute

			// Track last trigger to avoid duplicates
			const lastTriggerKey = `${now.toDateString()}-${msg.time}`;
			if (daysMatch && inWindow && msg.lastTrigger !== lastTriggerKey) {
				shouldTrigger = true;
				msg.lastTrigger = lastTriggerKey;
			}
		}

		if (shouldTrigger) {
			console.log(`[Ticker Scheduler] Triggering message: ${msg.message}`);
			broadcastFn(msg.message, msg.duration || 5);
			msg.lastTriggeredAt = now.toISOString();
			saveSchedule();
		}
	});

	// Clean up expired one-time messages
	const before = scheduledMessages.length;
	scheduledMessages = scheduledMessages.filter(m => {
		if (m.type === 'once' && m.triggered) {
			return false; // Remove triggered one-time messages
		}
		return true;
	});
	if (scheduledMessages.length !== before) {
		saveSchedule();
	}
}

/**
 * Add a scheduled message
 * @param {Object} message - Message configuration
 * @returns {Object} Created message with ID
 */
function addScheduledMessage(message) {
	const id = `sched_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

	const newMessage = {
		id,
		message: message.message.trim().substring(0, 200),
		duration: Math.min(Math.max(parseInt(message.duration) || 5, 3), 30),
		type: message.type || 'once', // 'once' or 'recurring'
		enabled: message.enabled !== false,
		createdAt: new Date().toISOString()
	};

	if (newMessage.type === 'once') {
		newMessage.scheduledTime = message.scheduledTime;
		newMessage.triggered = false;
	} else if (newMessage.type === 'recurring') {
		newMessage.time = message.time; // HH:MM format
		newMessage.days = message.days || []; // Array of day numbers (0-6), empty = every day
		newMessage.label = message.label || ''; // Optional label like "Halftime Break"
	}

	scheduledMessages.push(newMessage);
	saveSchedule();

	console.log(`[Ticker Scheduler] Added scheduled message: ${id}`);
	return newMessage;
}

/**
 * Update a scheduled message
 * @param {string} id - Message ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} Updated message or null if not found
 */
function updateScheduledMessage(id, updates) {
	const index = scheduledMessages.findIndex(m => m.id === id);
	if (index === -1) return null;

	const msg = scheduledMessages[index];

	// Update allowed fields
	if (updates.message) msg.message = updates.message.trim().substring(0, 200);
	if (updates.duration !== undefined) msg.duration = Math.min(Math.max(parseInt(updates.duration) || 5, 3), 30);
	if (updates.enabled !== undefined) msg.enabled = updates.enabled;
	if (updates.time && msg.type === 'recurring') msg.time = updates.time;
	if (updates.days !== undefined && msg.type === 'recurring') msg.days = updates.days;
	if (updates.label !== undefined && msg.type === 'recurring') msg.label = updates.label;
	if (updates.scheduledTime && msg.type === 'once') {
		msg.scheduledTime = updates.scheduledTime;
		msg.triggered = false; // Reset trigger status
	}

	msg.updatedAt = new Date().toISOString();
	saveSchedule();

	console.log(`[Ticker Scheduler] Updated message: ${id}`);
	return msg;
}

/**
 * Delete a scheduled message
 * @param {string} id - Message ID
 * @returns {boolean} True if deleted
 */
function deleteScheduledMessage(id) {
	const before = scheduledMessages.length;
	scheduledMessages = scheduledMessages.filter(m => m.id !== id);

	if (scheduledMessages.length !== before) {
		saveSchedule();
		console.log(`[Ticker Scheduler] Deleted message: ${id}`);
		return true;
	}
	return false;
}

/**
 * Get all scheduled messages
 * @returns {Array} All scheduled messages
 */
function getScheduledMessages() {
	return scheduledMessages.map(m => ({
		...m,
		// Add computed fields
		isExpired: m.type === 'once' && new Date(m.scheduledTime).getTime() < Date.now()
	}));
}

/**
 * Get a specific scheduled message
 * @param {string} id - Message ID
 * @returns {Object|null} Message or null
 */
function getScheduledMessage(id) {
	return scheduledMessages.find(m => m.id === id) || null;
}

/**
 * Clear all scheduled messages
 */
function clearAllScheduled() {
	scheduledMessages = [];
	saveSchedule();
	console.log('[Ticker Scheduler] Cleared all scheduled messages');
}

module.exports = {
	initialize,
	stopScheduler,
	addScheduledMessage,
	updateScheduledMessage,
	deleteScheduledMessage,
	getScheduledMessages,
	getScheduledMessage,
	clearAllScheduled
};
