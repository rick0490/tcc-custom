/**
 * Error Handler Middleware
 *
 * Centralized Express error handling middleware.
 * Catches all errors and formats them consistently.
 *
 * @module middleware/error-handler
 */

const {
    AppError,
    formatErrorResponse,
    ERROR_CODES
} = require('../services/error-handler');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('middleware:error');

/**
 * Centralized error handling middleware
 * Must be registered AFTER all routes
 *
 * @param {Error} err - Error object
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
function errorHandler(err, req, res, next) {
    // If headers already sent, delegate to default Express error handler
    if (res.headersSent) {
        return next(err);
    }

    const requestId = req.requestId || 'unknown';

    // Log the error with context
    logger.error('handleError', err, {
        requestId,
        method: req.method,
        path: req.path,
        userId: req.session?.userId,
        body: req.method !== 'GET' ? sanitizeBody(req.body) : undefined
    });

    // Handle operational errors (our custom AppError types)
    if (err.isOperational || err instanceof AppError) {
        return res.status(err.statusCode).json(
            formatErrorResponse(err, requestId)
        );
    }

    // Handle Joi validation errors
    if (err.isJoi || err.name === 'ValidationError') {
        const validationError = {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Validation failed',
            details: err.details
                ? err.details.map(d => ({
                    field: d.path.join('.'),
                    message: d.message.replace(/"/g, "'")
                }))
                : [{ field: 'unknown', message: err.message }]
        };

        return res.status(400).json({
            success: false,
            error: validationError,
            requestId
        });
    }

    // Handle SQLite database errors
    if (err.code && err.code.startsWith('SQLITE')) {
        const dbError = {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'Database operation failed',
            details: process.env.NODE_ENV !== 'production' ? err.message : null
        };

        return res.status(500).json({
            success: false,
            error: dbError,
            requestId
        });
    }

    // Handle unexpected/programmer errors
    // Don't leak internal details in production
    const internalError = {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : err.message,
        details: null
    };

    return res.status(500).json({
        success: false,
        error: internalError,
        requestId
    });
}

/**
 * Async handler wrapper
 * Wraps async route handlers to automatically catch rejected promises
 *
 * @param {Function} fn - Async route handler function
 * @returns {Function} Wrapped handler that catches errors
 *
 * @example
 * router.get('/items/:id', asyncHandler(async (req, res) => {
 *     const item = await db.getById(req.params.id);
 *     if (!item) throw new NotFoundError('Item', req.params.id);
 *     res.json({ success: true, data: item });
 * }));
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Sanitize request body for logging
 * Removes sensitive fields like passwords
 *
 * @param {Object} body - Request body
 * @returns {Object} Sanitized body
 */
function sanitizeBody(body) {
    if (!body || typeof body !== 'object') return body;

    const sanitized = { ...body };
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'api_key'];

    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = '[REDACTED]';
        }
    }

    return sanitized;
}

/**
 * 404 Not Found handler
 * Catches requests that don't match any route
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
function notFoundHandler(req, res) {
    const requestId = req.requestId || 'unknown';

    res.status(404).json({
        success: false,
        error: {
            code: ERROR_CODES.NOT_FOUND,
            message: `Route not found: ${req.method} ${req.path}`,
            details: null
        },
        requestId
    });
}

module.exports = {
    errorHandler,
    asyncHandler,
    notFoundHandler
};
