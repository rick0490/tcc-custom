/**
 * Active Tournament Service
 * Manages the "active" tournament for each user - the tournament that displays show
 *
 * Supports two modes:
 * 1. Auto-select (default): Chooses tournament based on soonest start time
 * 2. Manual override: User explicitly selects a tournament via "Make Active" button
 */

const systemDb = require('../db/system-db');
const tournamentDb = require('./tournament-db');
const { createLogger } = require('./debug-logger');

const logger = createLogger('active-tournament');

/**
 * Calculate the auto-selected active tournament for a user
 * Priority:
 * 1. Underway tournaments (already started, not complete)
 * 2. Pending tournaments sorted by starts_at (soonest first)
 * 3. Most recently created pending tournament (if no starts_at)
 *
 * @param {number} userId - User ID
 * @returns {Object|null} - Tournament object or null if none available
 */
function calculateAutoActiveTournament(userId) {
    logger.log('calculateAutoActive', { userId });

    // Get all non-complete tournaments for this user
    const tournaments = tournamentDb.list({
        state: ['pending', 'underway', 'checking_in']
    }, userId);

    if (!tournaments || tournaments.length === 0) {
        logger.log('calculateAutoActive:none', { userId });
        return null;
    }

    // Priority 1: Underway tournaments (should only be one, but take first)
    const underway = tournaments.filter(t => t.state === 'underway');
    if (underway.length > 0) {
        logger.log('calculateAutoActive:underway', { userId, tournamentId: underway[0].id });
        return underway[0];
    }

    // Priority 2: Pending tournaments sorted by start time
    const pending = tournaments.filter(t => t.state === 'pending' || t.state === 'checking_in');

    if (pending.length === 0) {
        logger.log('calculateAutoActive:noPending', { userId });
        return null;
    }

    // Sort by starts_at (soonest first), then by created_at (newest first)
    pending.sort((a, b) => {
        // If both have starts_at, compare them
        if (a.starts_at && b.starts_at) {
            const aTime = new Date(a.starts_at).getTime();
            const bTime = new Date(b.starts_at).getTime();
            if (aTime !== bTime) return aTime - bTime;
        }
        // If only one has starts_at, it comes first
        if (a.starts_at && !b.starts_at) return -1;
        if (!a.starts_at && b.starts_at) return 1;
        // If neither has starts_at, sort by created_at (newest first)
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const selected = pending[0];
    logger.log('calculateAutoActive:selected', {
        userId,
        tournamentId: selected.id,
        startsAt: selected.starts_at
    });
    return selected;
}

/**
 * Get the active tournament for a user
 * Returns manual override if set, otherwise auto-calculates
 *
 * @param {number} userId - User ID
 * @returns {Object} - { tournament, mode: 'auto'|'manual' }
 */
function getActiveTournament(userId) {
    const logComplete = logger.start('getActive', { userId });

    // Check for manual override
    const manualId = systemDb.getManualActiveTournamentId(userId);

    if (manualId !== null) {
        // Manual mode - look up the tournament
        const tournament = tournamentDb.getById(manualId);

        // If manual tournament is complete or deleted, clear override and fall back to auto
        if (!tournament || tournament.state === 'complete') {
            logger.log('getActive:manualCleared', { userId, reason: tournament ? 'complete' : 'deleted' });
            systemDb.clearManualActiveTournament(userId);
            // Fall through to auto-select
        } else {
            logComplete({ mode: 'manual', tournamentId: tournament.id });
            return { tournament, mode: 'manual' };
        }
    }

    // Auto mode
    const tournament = calculateAutoActiveTournament(userId);
    logComplete({ mode: 'auto', tournamentId: tournament?.id || null });
    return { tournament, mode: 'auto' };
}

/**
 * Set a tournament as active (manual override)
 *
 * @param {number} userId - User ID
 * @param {number} tournamentId - Tournament ID to make active
 * @returns {Object} - { success, tournament, mode }
 */
function setActiveTournament(userId, tournamentId) {
    const logComplete = logger.start('setActive', { userId, tournamentId });

    // Verify tournament exists and belongs to user
    const tournament = tournamentDb.getById(tournamentId);
    if (!tournament) {
        logComplete({ error: 'notFound' });
        return { success: false, error: 'Tournament not found' };
    }

    if (tournament.user_id !== userId) {
        logComplete({ error: 'notOwner' });
        return { success: false, error: 'Tournament does not belong to this user' };
    }

    if (tournament.state === 'complete') {
        logComplete({ error: 'complete' });
        return { success: false, error: 'Cannot activate a completed tournament' };
    }

    // Set manual override
    systemDb.setManualActiveTournamentId(userId, tournamentId);

    logComplete({ success: true, tournamentName: tournament.name });
    return { success: true, tournament, mode: 'manual' };
}

/**
 * Clear manual override and revert to auto-select
 *
 * @param {number} userId - User ID
 * @returns {Object} - { success, tournament, mode }
 */
function revertToAutoSelect(userId) {
    const logComplete = logger.start('revertToAuto', { userId });

    systemDb.clearManualActiveTournament(userId);
    const result = getActiveTournament(userId);

    logComplete({ tournamentId: result.tournament?.id || null });
    return { success: true, ...result };
}

/**
 * Check if a tournament is the active one for a user
 *
 * @param {number} userId - User ID
 * @param {number} tournamentId - Tournament ID to check
 * @returns {boolean}
 */
function isActiveTournament(userId, tournamentId) {
    const { tournament } = getActiveTournament(userId);
    return tournament && tournament.id === tournamentId;
}

/**
 * Get active tournament mode (auto or manual)
 *
 * @param {number} userId - User ID
 * @returns {string} - 'auto' or 'manual'
 */
function getActiveMode(userId) {
    const manualId = systemDb.getManualActiveTournamentId(userId);
    if (manualId !== null) {
        // Verify manual tournament still valid
        const tournament = tournamentDb.getById(manualId);
        if (tournament && tournament.state !== 'complete') {
            return 'manual';
        }
    }
    return 'auto';
}

/**
 * Handle tournament completion - clear manual override if this was the active tournament
 * Called when a tournament is completed
 *
 * @param {number} userId - User ID
 * @param {number} tournamentId - Completed tournament ID
 */
function handleTournamentCompleted(userId, tournamentId) {
    logger.log('handleCompleted', { userId, tournamentId });

    const manualId = systemDb.getManualActiveTournamentId(userId);
    if (manualId === tournamentId) {
        logger.log('handleCompleted:clearingManual', { userId, tournamentId });
        systemDb.clearManualActiveTournament(userId);
    }
}

module.exports = {
    calculateAutoActiveTournament,
    getActiveTournament,
    setActiveTournament,
    revertToAutoSelect,
    isActiveTournament,
    getActiveMode,
    handleTournamentCompleted
};
