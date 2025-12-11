/**
 * WebSocket ACK Enhancement Module
 *
 * Provides reliable message delivery for WebSocket broadcasts with:
 * - Message queueing and retry logic
 * - Per-display ACK tracking
 * - Sequence numbers for ordering
 * - HTTP fallback after max retries
 *
 * Usage:
 *   const wsAck = require('./services/websocket-ack');
 *   wsAck.init(io, wsConnections, httpFallbackFn);
 *   wsAck.broadcastWithAck('matches:update', payload);
 */

const crypto = require('crypto');

// Configuration
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;        // 5 seconds between retries
const MESSAGE_TIMEOUT_MS = 30000;   // 30 seconds max wait
const CLEANUP_INTERVAL_MS = 60000;  // Clean up old messages every minute

// State
let io = null;
let wsConnections = null;
let httpFallbackFn = null;
let globalSequenceNumber = 0;
const pendingMessages = new Map();  // messageId -> { payload, attempts, sentAt, ackDisplays }
let cleanupIntervalId = null;

// Message stats
const stats = {
	messagesSent: 0,
	messagesAcked: 0,
	messagesRetried: 0,
	messagesFailed: 0,
	httpFallbacks: 0
};

/**
 * Initialize the WebSocket ACK system
 * @param {Object} socketIo - Socket.IO server instance
 * @param {Object} connections - WebSocket connections object { displays: Map, clients: Set }
 * @param {Function} fallbackFn - HTTP fallback function (payload, displayIds) => Promise
 */
function init(socketIo, connections, fallbackFn = null) {
	io = socketIo;
	wsConnections = connections;
	httpFallbackFn = fallbackFn;

	// Start cleanup interval
	if (cleanupIntervalId) clearInterval(cleanupIntervalId);
	cleanupIntervalId = setInterval(cleanupOldMessages, CLEANUP_INTERVAL_MS);

	console.log('[WebSocket-ACK] Initialized with retry queue');
}

/**
 * Generate unique message ID
 * @returns {string} Unique message identifier
 */
function generateMessageId() {
	return `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Get next sequence number
 * @returns {number} Monotonically increasing sequence number
 */
function getNextSequenceNumber() {
	return ++globalSequenceNumber;
}

/**
 * Broadcast message to all displays with ACK tracking
 * @param {string} event - Socket event name
 * @param {*} payload - Data to broadcast
 * @returns {string} Message ID for tracking
 */
function broadcastWithAck(event, payload) {
	if (!io || !wsConnections) {
		console.error('[WebSocket-ACK] Not initialized');
		return null;
	}

	const messageId = generateMessageId();
	const sequenceNumber = getNextSequenceNumber();

	const message = {
		messageId,
		sequenceNumber,
		payload,
		timestamp: new Date().toISOString()
	};

	// Track pending message
	pendingMessages.set(messageId, {
		event,
		message,
		attempts: 1,
		sentAt: Date.now(),
		ackDisplays: new Set()
	});

	// Broadcast to all displays
	io.to('displays').emit(event, message);
	stats.messagesSent++;

	console.log(`[WebSocket-ACK] Broadcast ${event} (msg: ${messageId}, seq: ${sequenceNumber})`);

	// Schedule retry check
	setTimeout(() => checkMessageDelivery(messageId), RETRY_DELAY_MS);

	return messageId;
}

/**
 * Check if message was delivered to all displays
 * @param {string} messageId - Message to check
 */
function checkMessageDelivery(messageId) {
	const pending = pendingMessages.get(messageId);
	if (!pending) return;  // Already fully acknowledged

	const connectedDisplays = Array.from(wsConnections.displays.keys());
	const unackedDisplays = connectedDisplays.filter(d => !pending.ackDisplays.has(d));

	// Check if all displays ACKed
	if (unackedDisplays.length === 0) {
		console.log(`[WebSocket-ACK] Message ${messageId} fully acknowledged`);
		pendingMessages.delete(messageId);
		return;
	}

	// Check if max retries reached
	if (pending.attempts >= MAX_RETRY_ATTEMPTS) {
		console.log(`[WebSocket-ACK] Message ${messageId} failed after ${MAX_RETRY_ATTEMPTS} attempts`);
		console.log(`[WebSocket-ACK] Unacked displays: ${unackedDisplays.join(', ')}`);

		// Use HTTP fallback for unacked displays
		if (httpFallbackFn) {
			console.log(`[WebSocket-ACK] Using HTTP fallback for ${unackedDisplays.length} displays`);
			httpFallbackFn(pending.message.payload, unackedDisplays)
				.catch(err => console.error('[WebSocket-ACK] HTTP fallback failed:', err));
			stats.httpFallbacks++;
		}

		stats.messagesFailed++;
		pendingMessages.delete(messageId);
		return;
	}

	// Retry - send only to unacked displays
	pending.attempts++;
	stats.messagesRetried++;

	console.log(`[WebSocket-ACK] Retry ${pending.attempts}/${MAX_RETRY_ATTEMPTS} for message ${messageId}`);

	unackedDisplays.forEach(displayId => {
		const socket = wsConnections.displays.get(displayId);
		if (socket && socket.connected) {
			socket.emit(pending.event, pending.message);
		}
	});

	// Schedule next retry check
	setTimeout(() => checkMessageDelivery(messageId), RETRY_DELAY_MS);
}

/**
 * Handle ACK from a display
 * @param {Object} socket - Socket.IO socket
 * @param {Object} data - ACK data { messageId, sequenceNumber }
 */
function handleAck(socket, data) {
	const { messageId, sequenceNumber } = data;
	const displayId = socket.displayId;

	if (!displayId || !messageId) {
		console.log('[WebSocket-ACK] Invalid ACK received:', data);
		return;
	}

	const pending = pendingMessages.get(messageId);
	if (pending) {
		pending.ackDisplays.add(displayId);
		stats.messagesAcked++;

		// Check if all displays have ACKed
		const connectedDisplays = Array.from(wsConnections.displays.keys());
		if (pending.ackDisplays.size >= connectedDisplays.length) {
			console.log(`[WebSocket-ACK] Message ${messageId} fully acknowledged by ${pending.ackDisplays.size} displays`);
			pendingMessages.delete(messageId);
		}
	}

	// Log ACK for debugging
	console.log(`[WebSocket-ACK] ACK received: display=${displayId}, msg=${messageId}, seq=${sequenceNumber}`);
}

/**
 * Register ACK handler on socket
 * @param {Object} socket - Socket.IO socket
 * @param {string} event - Event name (e.g., 'matches:ack')
 */
function registerAckHandler(socket, event = 'matches:ack') {
	socket.on(event, (data) => handleAck(socket, data));
}

/**
 * Clean up old pending messages (memory leak prevention)
 */
function cleanupOldMessages() {
	const now = Date.now();
	let cleaned = 0;

	for (const [messageId, pending] of pendingMessages) {
		if (now - pending.sentAt > MESSAGE_TIMEOUT_MS * 2) {
			pendingMessages.delete(messageId);
			cleaned++;
		}
	}

	if (cleaned > 0) {
		console.log(`[WebSocket-ACK] Cleaned up ${cleaned} stale messages`);
	}
}

/**
 * Get pending message count
 * @returns {number} Number of messages waiting for ACK
 */
function getPendingCount() {
	return pendingMessages.size;
}

/**
 * Get delivery statistics
 * @returns {Object} Stats object
 */
function getStats() {
	return {
		...stats,
		pendingMessages: pendingMessages.size,
		currentSequence: globalSequenceNumber
	};
}

/**
 * Reset statistics (for testing)
 */
function resetStats() {
	stats.messagesSent = 0;
	stats.messagesAcked = 0;
	stats.messagesRetried = 0;
	stats.messagesFailed = 0;
	stats.httpFallbacks = 0;
}

/**
 * Shutdown the ACK system
 */
function shutdown() {
	if (cleanupIntervalId) {
		clearInterval(cleanupIntervalId);
		cleanupIntervalId = null;
	}
	pendingMessages.clear();
	io = null;
	wsConnections = null;
	httpFallbackFn = null;
}

// =============================================================================
// CLIENT-SIDE HELPER (for documentation)
// =============================================================================

/**
 * Client-side ACK implementation example (for MagicMirror modules):
 *
 * // In node_helper.js
 * socket.on('matches:update', (data) => {
 *   const { messageId, sequenceNumber, payload, timestamp } = data;
 *
 *   // Process the update
 *   this.processMatchUpdate(payload);
 *
 *   // Send ACK back to server
 *   socket.emit('matches:ack', {
 *     messageId,
 *     sequenceNumber,
 *     receivedAt: new Date().toISOString()
 *   });
 * });
 *
 * // Sequence validation (optional)
 * let lastReceivedSequence = 0;
 *
 * function handleMatchUpdate(data) {
 *   if (data.sequenceNumber <= lastReceivedSequence) {
 *     console.log('[WS] Ignoring out-of-order message');
 *     return;
 *   }
 *   lastReceivedSequence = data.sequenceNumber;
 *   // Process update...
 * }
 */

module.exports = {
	init,
	broadcastWithAck,
	handleAck,
	registerAckHandler,
	getPendingCount,
	getStats,
	resetStats,
	shutdown,

	// For direct access if needed
	generateMessageId,
	getNextSequenceNumber
};
