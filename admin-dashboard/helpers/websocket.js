/**
 * WebSocket Helper Functions
 *
 * Helper functions for delta detection and WebSocket state management.
 * Extracted from server.js for modularity.
 */

/**
 * Detect change in a TV slot match
 * @param {string} slotName - Name of the TV slot (e.g., 'TV 1')
 * @param {Object|null} oldMatch - Previous match in slot
 * @param {Object|null} newMatch - Current match in slot
 * @returns {Object|null} Change object or null if no change
 */
function detectTvSlotChange(slotName, oldMatch, newMatch) {
	// No old match, this is a new assignment
	if (!oldMatch && newMatch) {
		return { type: 'MATCH_SWAP', match: newMatch };
	}

	// Had a match, now empty
	if (oldMatch && !newMatch) {
		return { type: 'MATCH_CLEARED', match: null };
	}

	// Both null - no change
	if (!oldMatch && !newMatch) {
		return null;
	}

	// Different match ID - full swap
	if (oldMatch.id !== newMatch.id) {
		return { type: 'MATCH_SWAP', match: newMatch };
	}

	// Same match - check for state changes
	if (oldMatch.state !== newMatch.state) {
		return { type: 'STATE_CHANGE', match: newMatch, oldState: oldMatch.state };
	}

	// Check for winner change (most important for visual feedback)
	if (oldMatch.winner_id !== newMatch.winner_id) {
		return { type: 'WINNER_DECLARED', match: newMatch };
	}

	// Check for underway change
	if (oldMatch.underway_at !== newMatch.underway_at) {
		return { type: 'UNDERWAY_CHANGE', match: newMatch };
	}

	// No meaningful change
	return null;
}

/**
 * Detect changes in up-next queue
 * @param {Array} oldMatches - Previous up-next matches
 * @param {Array} newMatches - Current up-next matches
 * @returns {Array|null} Array of changes or null if no changes
 */
function detectUpNextChanges(oldMatches, newMatches) {
	const changes = [];
	// Always generate changes for the 2-slot up-next queue
	const maxSlots = 2;

	for (let i = 0; i < maxSlots; i++) {
		const oldMatch = oldMatches[i] || null;
		const newMatch = newMatches[i] || null;

		// Both empty - no change
		if (!oldMatch && !newMatch) {
			changes.push({ index: i, type: 'NO_CHANGE', match: null });
			continue;
		}

		// New item added to empty slot
		if (!oldMatch && newMatch) {
			changes.push({ index: i, type: 'NEW_ITEM', match: newMatch });
		}
		// Item removed from slot
		else if (oldMatch && !newMatch) {
			changes.push({ index: i, type: 'ITEM_CHANGE', match: null });
		}
		// Different match now in this slot
		else if (oldMatch.id !== newMatch.id) {
			changes.push({ index: i, type: 'ITEM_CHANGE', match: newMatch });
		}
		// Same match, state changed (less visually important)
		else if (oldMatch.state !== newMatch.state) {
			changes.push({ index: i, type: 'ITEM_CHANGE', match: newMatch });
		}
		// No change
		else {
			changes.push({ index: i, type: 'NO_CHANGE', match: newMatch });
		}
	}

	// Only return if there are actual changes (not all NO_CHANGE)
	const hasChanges = changes.some(c => c.type !== 'NO_CHANGE');
	return hasChanges ? changes : null;
}

/**
 * Build delta payload by comparing old and new state
 * @param {Object} oldState - Previous match state
 * @param {Object} newPayload - New match payload
 * @param {Array} stations - Available stations
 * @param {Object} previousMatchState - Reference to update for next comparison
 * @returns {Object} Delta payload object
 */
function buildDeltaPayload(oldState, newPayload, stations, previousMatchState) {
	const tv1Name = 'TV 1';
	const tv2Name = 'TV 2';

	// Find current TV matches
	const matches = newPayload.matches || [];
	const tv1Match = matches.find(m => m.station_name === tv1Name && (m.state === 'open' || m.state === 'pending')) || null;
	const tv2Match = matches.find(m => m.station_name === tv2Name && (m.state === 'open' || m.state === 'pending')) || null;

	// Get up-next queue (matches without station, open state, sorted by play order)
	const upNextMatches = matches
		.filter(m => !m.station_name && m.state === 'open')
		.sort((a, b) => (a.suggested_play_order || 9999) - (b.suggested_play_order || 9999))
		.slice(0, 5);

	// Detect changes
	const changes = {
		tv1: detectTvSlotChange(tv1Name, oldState.tv1Match, tv1Match),
		tv2: detectTvSlotChange(tv2Name, oldState.tv2Match, tv2Match),
		upNext: detectUpNextChanges(oldState.upNextMatches || [], upNextMatches),
		podium: null
	};

	// Check podium change
	const newPodium = newPayload.podium || { isComplete: false };
	if (oldState.podium?.isComplete !== newPodium.isComplete) {
		changes.podium = newPodium;
	}

	// Determine if this is a meaningful change
	const hasChanges = changes.tv1 || changes.tv2 || changes.upNext || changes.podium;

	// Update previous state for next comparison
	if (previousMatchState) {
		previousMatchState.tv1Match = tv1Match;
		previousMatchState.tv2Match = tv2Match;
		previousMatchState.upNextMatches = upNextMatches;
		previousMatchState.podium = newPodium;
	}

	return {
		type: hasChanges ? 'delta' : 'none',
		changes: hasChanges ? changes : null,
		// Always include full data for fallback
		fullPayload: newPayload
	};
}

/**
 * Check if HTTP fallback is needed based on ACK status
 * @param {Object} displayDeliveryStatus - Delivery status tracking object
 * @returns {boolean} True if HTTP fallback should be used
 */
function needsHttpFallback(displayDeliveryStatus) {
	// If no broadcast has been made yet, don't need fallback
	if (!displayDeliveryStatus.lastBroadcastTime) {
		return false;
	}

	const lastBroadcast = new Date(displayDeliveryStatus.lastBroadcastTime).getTime();
	const now = Date.now();
	const timeSinceBroadcast = now - lastBroadcast;

	// If within the fallback window, check for ACKs
	if (timeSinceBroadcast < displayDeliveryStatus.httpFallbackDelayMs) {
		// Check if any display has ACKed recently
		for (const [displayId, status] of displayDeliveryStatus.status.entries()) {
			if (status.lastAckTime) {
				const ackTime = new Date(status.lastAckTime).getTime();
				// ACK is valid if it's after the last broadcast
				if (ackTime >= lastBroadcast) {
					return false;  // Got an ACK, no fallback needed
				}
			}
		}
		// No ACKs yet but still within window - don't fallback yet
		return false;
	}

	// Past the fallback window with no valid ACKs
	return true;
}

/**
 * Generate a simple state hash for quick comparison
 * @param {Object} payload - Match payload to hash
 * @returns {string} Simple hash string
 */
function generateStateHash(payload) {
	if (!payload || !payload.matches) return '';

	// Create a simple hash from match states
	const matchStates = payload.matches
		.map(m => `${m.id}:${m.state}:${m.winner_id || ''}:${m.station_name || ''}`)
		.sort()
		.join('|');

	// Include tournament name for additional context
	const tournamentInfo = `${payload.tournament?.name || ''}:${payload.tournament?.state || ''}`;

	return `${tournamentInfo}|${matchStates}`;
}

/**
 * Create initial match state object
 * @returns {Object} Empty match state object
 */
function createInitialMatchState() {
	return {
		tv1Match: null,
		tv2Match: null,
		upNextMatches: [],
		podium: null
	};
}

module.exports = {
	detectTvSlotChange,
	detectUpNextChanges,
	buildDeltaPayload,
	needsHttpFallback,
	generateStateHash,
	createInitialMatchState
};
