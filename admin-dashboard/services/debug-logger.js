/**
 * Debug Logger Utility
 *
 * Provides consistent logging format across all TCC-Custom services.
 * Activated via DEBUG_MODE=true environment variable.
 *
 * Format: [ISO_TIMESTAMP] [SERVICE:ACTION] { context data }
 *
 * Service Prefixes:
 * - admin: Admin Dashboard general
 * - tournament-db: Tournament CRUD operations
 * - match-db: Match operations & bracket progression
 * - participant-db: Participant management
 * - station-db: Station management
 * - bracket-engine: Bracket generation algorithms
 * - match-polling: Real-time polling & broadcasting
 * - websocket: WebSocket events
 * - http: HTTP request/response
 * - match-display: MagicMirror match module
 * - bracket-display: MagicMirror bracket module
 * - flyer-display: MagicMirror flyer module
 * - signup: Tournament Signup PWA
 */

const DEBUG = process.env.DEBUG_MODE === 'true';

/**
 * Format data for logging, handling circular references and large objects
 * @param {*} data - Data to format
 * @param {number} maxLength - Maximum string length (default 2000)
 * @returns {string} Formatted string
 */
function formatData(data, maxLength = 2000) {
    if (data === undefined) return '';
    if (data === null) return 'null';

    try {
        const str = JSON.stringify(data, (key, value) => {
            // Handle circular references
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) return '[Circular]';
                seen.add(value);
            }
            // Truncate long strings
            if (typeof value === 'string' && value.length > 500) {
                return value.substring(0, 500) + '...[truncated]';
            }
            // Handle Buffer objects
            if (Buffer.isBuffer(value)) {
                return `[Buffer: ${value.length} bytes]`;
            }
            return value;
        }, 2);

        if (str.length > maxLength) {
            return str.substring(0, maxLength) + '...[truncated]';
        }
        return str;
    } catch (err) {
        return `[Error formatting: ${err.message}]`;
    }
}

// Track seen objects to handle circular references
let seen = new WeakSet();

/**
 * Log a debug message
 * @param {string} service - Service prefix (e.g., 'tournament-db', 'match-polling')
 * @param {string} action - Action being performed (e.g., 'create', 'setWinner')
 * @param {object} data - Context data to log
 */
function log(service, action, data = {}) {
    if (!DEBUG) return;

    seen = new WeakSet(); // Reset for each log call
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${service}:${action}]`;

    if (Object.keys(data).length === 0) {
        console.log(prefix);
    } else {
        console.log(prefix, formatData(data));
    }
}

/**
 * Log an error with stack trace and context
 * @param {string} service - Service prefix
 * @param {string} action - Action that failed
 * @param {Error} error - Error object
 * @param {object} context - Additional context
 */
function logError(service, action, error, context = {}) {
    seen = new WeakSet();
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${service}:${action}] ERROR:`;

    const errorData = {
        message: error.message,
        stack: error.stack,
        ...context
    };

    console.error(prefix, formatData(errorData));
}

/**
 * Log a warning
 * @param {string} service - Service prefix
 * @param {string} action - Action with warning
 * @param {string} message - Warning message
 * @param {object} context - Additional context
 */
function logWarn(service, action, message, context = {}) {
    if (!DEBUG) return;

    seen = new WeakSet();
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${service}:${action}] WARN:`;

    console.warn(prefix, message, Object.keys(context).length > 0 ? formatData(context) : '');
}

/**
 * Log the start of an operation and return a function to log completion with duration
 * @param {string} service - Service prefix
 * @param {string} action - Action being performed
 * @param {object} data - Initial context data
 * @returns {function} Function to call when operation completes
 */
function logStart(service, action, data = {}) {
    const startTime = Date.now();
    log(service, `${action}:start`, data);

    return (resultData = {}) => {
        const duration = Date.now() - startTime;
        log(service, `${action}:complete`, { ...resultData, duration: `${duration}ms` });
        return duration;
    };
}

/**
 * Create a logger bound to a specific service
 * @param {string} service - Service prefix
 * @returns {object} Logger object with bound methods
 */
function createLogger(service) {
    return {
        log: (action, data) => log(service, action, data),
        error: (action, error, context) => logError(service, action, error, context),
        warn: (action, message, context) => logWarn(service, action, message, context),
        start: (action, data) => logStart(service, action, data),
        isEnabled: () => DEBUG
    };
}

/**
 * Log database query with timing
 * @param {string} service - Service prefix
 * @param {string} operation - Query type (SELECT, INSERT, UPDATE, DELETE)
 * @param {string} table - Table name
 * @param {object} params - Query parameters
 * @param {function} queryFn - Function that executes the query
 * @returns {*} Query result
 */
async function logQuery(service, operation, table, params, queryFn) {
    if (!DEBUG) return queryFn();

    const startTime = Date.now();
    log(service, `query:${operation.toLowerCase()}`, { table, params });

    try {
        const result = await queryFn();
        const duration = Date.now() - startTime;

        const resultInfo = {
            table,
            duration: `${duration}ms`
        };

        // Add result count if applicable
        if (Array.isArray(result)) {
            resultInfo.rowCount = result.length;
        } else if (result && typeof result === 'object') {
            if (result.changes !== undefined) resultInfo.changes = result.changes;
            if (result.lastInsertRowid !== undefined) resultInfo.lastId = result.lastInsertRowid;
        }

        log(service, `query:${operation.toLowerCase()}:result`, resultInfo);
        return result;
    } catch (error) {
        logError(service, `query:${operation.toLowerCase()}`, error, { table, params });
        throw error;
    }
}

/**
 * Log WebSocket event
 * @param {string} eventType - Event type (emit, receive, connect, disconnect)
 * @param {string} eventName - Event name
 * @param {object} payload - Event payload
 * @param {object} meta - Additional metadata (clientCount, socketId, etc.)
 */
function logWebSocket(eventType, eventName, payload = {}, meta = {}) {
    if (!DEBUG) return;

    log('websocket', eventType, {
        event: eventName,
        payload: typeof payload === 'object' ? payload : { data: payload },
        ...meta
    });
}

/**
 * Log HTTP request (for middleware)
 * @param {object} req - Express request object
 * @param {string} requestId - Unique request identifier
 */
function logHttpRequest(req, requestId) {
    if (!DEBUG) return;

    log('http', 'request', {
        requestId,
        method: req.method,
        path: req.path,
        query: Object.keys(req.query).length > 0 ? req.query : undefined,
        body: req.method !== 'GET' && req.body ? req.body : undefined,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
}

/**
 * Log HTTP response (for middleware)
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {string} requestId - Unique request identifier
 * @param {number} startTime - Request start timestamp
 */
function logHttpResponse(req, res, requestId, startTime) {
    if (!DEBUG) return;

    const duration = Date.now() - startTime;
    log('http', 'response', {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`
    });
}

/**
 * Express middleware for request/response logging
 * @returns {function} Express middleware function
 */
function requestLogger() {
    return (req, res, next) => {
        if (!DEBUG) return next();

        const startTime = Date.now();
        const requestId = Math.random().toString(36).substr(2, 9);

        // Attach requestId to request for use in route handlers
        req.requestId = requestId;

        logHttpRequest(req, requestId);

        res.on('finish', () => {
            logHttpResponse(req, res, requestId, startTime);
        });

        next();
    };
}

/**
 * Generate a unique request ID
 * @returns {string} Request ID
 */
function generateRequestId() {
    return Math.random().toString(36).substr(2, 9);
}

module.exports = {
    log,
    logError,
    logWarn,
    logStart,
    logQuery,
    logWebSocket,
    logHttpRequest,
    logHttpResponse,
    requestLogger,
    createLogger,
    generateRequestId,
    DEBUG,
    isEnabled: () => DEBUG
};
