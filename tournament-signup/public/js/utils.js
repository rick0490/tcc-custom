/**
 * Utility functions for Tournament Signup PWA
 * @module utils
 */

// ==================== DEBOUNCE ====================

/**
 * Creates a debounced version of a function that delays execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ==================== REQUEST TRACKER ====================

/**
 * Tracks in-flight API requests to prevent duplicate submissions
 */
export const requestTracker = {
    _requests: new Set(),

    /**
     * Check if a request is currently in flight
     * @param {string} key - Request identifier
     * @returns {boolean}
     */
    isInFlight(key) {
        return this._requests.has(key);
    },

    /**
     * Mark a request as started
     * @param {string} key - Request identifier
     */
    start(key) {
        this._requests.add(key);
    },

    /**
     * Mark a request as completed
     * @param {string} key - Request identifier
     */
    end(key) {
        this._requests.delete(key);
    }
};

// ==================== DATE FORMATTING ====================

/**
 * Format a date in the user's local timezone
 * @param {string} isoString - ISO 8601 date string
 * @returns {string} Formatted date string
 */
export function formatDateInUserTimezone(isoString) {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
    }).format(date);
}

/**
 * Get the user's timezone abbreviation
 * @returns {string} Timezone abbreviation (e.g., "CST", "EST")
 */
export function getTimezoneAbbr() {
    return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
        .formatToParts(new Date())
        .find(part => part.type === 'timeZoneName')?.value || '';
}

/**
 * Format relative time (e.g., "2h ago", "Just now")
 * @param {string|Date} dateInput - Date to format
 * @returns {string} Relative time string
 */
export function formatRelativeTime(dateInput) {
    const date = new Date(dateInput);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays > 0) {
        return `${diffDays}d ago`;
    } else if (diffHours > 0) {
        return `${diffHours}h ago`;
    } else if (diffMins > 0) {
        return `${diffMins}m ago`;
    } else {
        return 'Just now';
    }
}

// ==================== LOCAL STORAGE ====================

/**
 * Safely get item from localStorage
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default value if not found
 * @returns {*} Stored value or default
 */
export function getStorageItem(key, defaultValue = null) {
    try {
        const item = localStorage.getItem(key);
        return item !== null ? item : defaultValue;
    } catch (e) {
        console.warn('localStorage access failed:', e);
        return defaultValue;
    }
}

/**
 * Safely set item in localStorage
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 */
export function setStorageItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn('localStorage write failed:', e);
    }
}

/**
 * Safely remove item from localStorage
 * @param {string} key - Storage key
 */
export function removeStorageItem(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        console.warn('localStorage remove failed:', e);
    }
}
