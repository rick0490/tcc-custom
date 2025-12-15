/**
 * Error Handler Service
 *
 * Standardized error handling for TCC-Custom admin-dashboard.
 * Provides custom error classes, retry logic with exponential backoff,
 * and circuit breaker pattern for external service resilience.
 *
 * @module services/error-handler
 */

const { createLogger } = require('./debug-logger');
const logger = createLogger('error-handler');

// =============================================================================
// ERROR CODES
// =============================================================================

const ERROR_CODES = {
    // Client errors (4xx)
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    CONFLICT: 'CONFLICT',
    RATE_LIMITED: 'RATE_LIMITED',

    // Server errors (5xx)
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
    CIRCUIT_BREAKER_OPEN: 'CIRCUIT_BREAKER_OPEN',

    // Domain-specific errors
    TOURNAMENT_NOT_STARTED: 'TOURNAMENT_NOT_STARTED',
    TOURNAMENT_ALREADY_STARTED: 'TOURNAMENT_ALREADY_STARTED',
    MATCH_NOT_OPEN: 'MATCH_NOT_OPEN',
    MATCH_ALREADY_COMPLETE: 'MATCH_ALREADY_COMPLETE',
    PARTICIPANT_ALREADY_EXISTS: 'PARTICIPANT_ALREADY_EXISTS'
};

// =============================================================================
// CUSTOM ERROR CLASSES
// =============================================================================

/**
 * Base application error class.
 * All custom errors extend this class.
 */
class AppError extends Error {
    /**
     * @param {string} message - Human-readable error message
     * @param {string} code - Error code from ERROR_CODES
     * @param {number} statusCode - HTTP status code
     * @param {*} details - Additional error details (optional)
     */
    constructor(message, code, statusCode = 500, details = null) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = true; // Distinguishes from programmer errors
        Error.captureStackTrace(this, this.constructor);
    }

    /**
     * Convert error to JSON-serializable object
     */
    toJSON() {
        return {
            code: this.code,
            message: this.message,
            details: this.details
        };
    }
}

/**
 * Resource not found error (404)
 */
class NotFoundError extends AppError {
    /**
     * @param {string} resource - Type of resource (e.g., 'Tournament', 'Match')
     * @param {string|number} id - Resource identifier (optional)
     */
    constructor(resource = 'Resource', id = null) {
        const message = id
            ? `${resource} not found: ${id}`
            : `${resource} not found`;
        super(message, ERROR_CODES.NOT_FOUND, 404);
        this.resource = resource;
        this.resourceId = id;
    }
}

/**
 * Validation error (400)
 */
class ValidationError extends AppError {
    /**
     * @param {string} message - Error message
     * @param {Array} fields - Array of field-level errors [{field, message}]
     */
    constructor(message = 'Validation failed', fields = []) {
        super(message, ERROR_CODES.VALIDATION_ERROR, 400, fields);
    }
}

/**
 * State conflict error (409)
 * Used when an action cannot be performed due to current state
 */
class ConflictError extends AppError {
    /**
     * @param {string} message - Error message
     * @param {*} conflictingResource - Details about the conflict (optional)
     */
    constructor(message, conflictingResource = null) {
        super(
            message,
            ERROR_CODES.CONFLICT,
            409,
            conflictingResource ? { resource: conflictingResource } : null
        );
    }
}

/**
 * Authentication required error (401)
 */
class UnauthorizedError extends AppError {
    /**
     * @param {string} message - Error message
     */
    constructor(message = 'Authentication required') {
        super(message, ERROR_CODES.UNAUTHORIZED, 401);
    }
}

/**
 * Access denied error (403)
 */
class ForbiddenError extends AppError {
    /**
     * @param {string} message - Error message
     */
    constructor(message = 'Access denied') {
        super(message, ERROR_CODES.FORBIDDEN, 403);
    }
}

/**
 * External service error (503)
 * Used when an external API call fails
 */
class ExternalServiceError extends AppError {
    /**
     * @param {string} service - Name of the external service
     * @param {string} message - Error message
     * @param {Error} originalError - Original error (optional)
     */
    constructor(service, message, originalError = null) {
        super(
            `${service}: ${message}`,
            ERROR_CODES.EXTERNAL_SERVICE_ERROR,
            503
        );
        this.service = service;
        this.originalError = originalError;
    }
}

/**
 * Rate limit exceeded error (429)
 */
class RateLimitError extends AppError {
    /**
     * @param {string} message - Error message
     * @param {number} retryAfter - Seconds until retry is allowed
     */
    constructor(message = 'Rate limit exceeded', retryAfter = null) {
        super(message, ERROR_CODES.RATE_LIMITED, 429, { retryAfter });
        this.retryAfter = retryAfter;
    }
}

/**
 * Circuit breaker open error (503)
 */
class CircuitBreakerOpenError extends AppError {
    /**
     * @param {string} service - Name of the service
     * @param {number} resetTime - Milliseconds until circuit may close
     */
    constructor(service, resetTime = null) {
        super(
            `${service} circuit breaker is open - service temporarily unavailable`,
            ERROR_CODES.CIRCUIT_BREAKER_OPEN,
            503,
            { resetTime }
        );
        this.service = service;
        this.resetTime = resetTime;
    }
}

// =============================================================================
// ERROR RESPONSE FORMATTER
// =============================================================================

/**
 * Format error for API response
 * @param {Error} error - Error object
 * @param {string} requestId - Request ID for correlation
 * @returns {Object} Formatted error response
 */
function formatErrorResponse(error, requestId = null) {
    const response = {
        success: false,
        error: {
            code: error.code || ERROR_CODES.INTERNAL_ERROR,
            message: error.message || 'An unexpected error occurred',
            details: error.details || null
        }
    };

    if (requestId) {
        response.requestId = requestId;
    }

    return response;
}

// =============================================================================
// RETRY LOGIC WITH EXPONENTIAL BACKOFF
// =============================================================================

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG = {
    initialDelayMs: 1000,
    maxRetries: 3,
    backoffMultiplier: 2,
    maxDelayMs: 10000,
    retryableStatuses: [429, 500, 502, 503, 504],
    nonRetryableStatuses: [400, 401, 403, 404]
};

/**
 * Execute a function with retry logic and exponential backoff
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry configuration options
 * @returns {Promise<*>} Result of the function
 */
async function withRetry(fn, options = {}) {
    const config = { ...DEFAULT_RETRY_CONFIG, ...options };
    let lastError;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Extract status code from error
            const statusCode = error.statusCode || error.status ||
                              (error.response && error.response.status);

            // Don't retry non-retryable errors (client errors)
            if (statusCode && config.nonRetryableStatuses.includes(statusCode)) {
                logger.log('retry:nonRetryable', {
                    attempt,
                    statusCode,
                    message: error.message
                });
                throw error;
            }

            // Don't retry if we've exhausted all attempts
            if (attempt >= config.maxRetries) {
                logger.warn('retry:exhausted', 'Max retries reached', {
                    attempts: attempt + 1,
                    error: error.message
                });
                throw error;
            }

            // Calculate delay with exponential backoff
            const delay = Math.min(
                config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
                config.maxDelayMs
            );

            logger.log('retry:attempt', {
                attempt: attempt + 1,
                maxRetries: config.maxRetries,
                delayMs: delay,
                error: error.message
            });

            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

// =============================================================================
// CIRCUIT BREAKER PATTERN
// =============================================================================

/**
 * Circuit breaker states
 */
const CIRCUIT_STATE = {
    CLOSED: 'CLOSED',      // Normal operation, requests pass through
    OPEN: 'OPEN',          // Failing, requests are rejected immediately
    HALF_OPEN: 'HALF_OPEN' // Testing if service has recovered
};

/**
 * Circuit Breaker implementation
 * Prevents cascading failures when external services are down
 */
class CircuitBreaker {
    /**
     * @param {Object} options - Circuit breaker configuration
     * @param {string} options.name - Name of the service
     * @param {number} options.failureThreshold - Failures before opening (default: 5)
     * @param {number} options.resetTimeoutMs - Time before half-open (default: 30000)
     * @param {number} options.halfOpenRequests - Requests allowed in half-open (default: 1)
     */
    constructor(options = {}) {
        this.name = options.name || 'default';
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeoutMs = options.resetTimeoutMs || 30000;
        this.halfOpenRequests = options.halfOpenRequests || 1;

        this.state = CIRCUIT_STATE.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.halfOpenAttempts = 0;

        this.logger = createLogger(`circuit-breaker:${this.name}`);
    }

    /**
     * Execute a function through the circuit breaker
     * @param {Function} fn - Async function to execute
     * @returns {Promise<*>} Result of the function
     */
    async execute(fn) {
        // Check if circuit should transition from OPEN to HALF_OPEN
        if (this.state === CIRCUIT_STATE.OPEN) {
            const timeSinceLastFailure = Date.now() - this.lastFailureTime;

            if (timeSinceLastFailure >= this.resetTimeoutMs) {
                this.state = CIRCUIT_STATE.HALF_OPEN;
                this.halfOpenAttempts = 0;
                this.logger.log('transition', {
                    from: CIRCUIT_STATE.OPEN,
                    to: CIRCUIT_STATE.HALF_OPEN
                });
            } else {
                const resetTime = this.resetTimeoutMs - timeSinceLastFailure;
                throw new CircuitBreakerOpenError(this.name, resetTime);
            }
        }

        // In HALF_OPEN state, limit concurrent requests
        if (this.state === CIRCUIT_STATE.HALF_OPEN) {
            if (this.halfOpenAttempts >= this.halfOpenRequests) {
                throw new CircuitBreakerOpenError(this.name, this.resetTimeoutMs);
            }
            this.halfOpenAttempts++;
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure(error);
            throw error;
        }
    }

    /**
     * Handle successful execution
     */
    onSuccess() {
        this.failures = 0;
        this.successes++;

        if (this.state === CIRCUIT_STATE.HALF_OPEN) {
            this.state = CIRCUIT_STATE.CLOSED;
            this.logger.log('transition', {
                from: CIRCUIT_STATE.HALF_OPEN,
                to: CIRCUIT_STATE.CLOSED,
                reason: 'success in half-open state'
            });
        }
    }

    /**
     * Handle failed execution
     * @param {Error} error - The error that occurred
     */
    onFailure(error) {
        this.failures++;
        this.lastFailureTime = Date.now();

        this.logger.log('failure', {
            failures: this.failures,
            threshold: this.failureThreshold,
            error: error.message
        });

        // Transition to OPEN if threshold exceeded
        if (this.failures >= this.failureThreshold && this.state !== CIRCUIT_STATE.OPEN) {
            const previousState = this.state;
            this.state = CIRCUIT_STATE.OPEN;
            this.logger.warn('transition', 'Circuit opened due to failures', {
                from: previousState,
                to: CIRCUIT_STATE.OPEN,
                failures: this.failures
            });
        }

        // If failure in HALF_OPEN, go back to OPEN
        if (this.state === CIRCUIT_STATE.HALF_OPEN) {
            this.state = CIRCUIT_STATE.OPEN;
            this.logger.log('transition', {
                from: CIRCUIT_STATE.HALF_OPEN,
                to: CIRCUIT_STATE.OPEN,
                reason: 'failure in half-open state'
            });
        }
    }

    /**
     * Get current circuit breaker status
     * @returns {Object} Status object
     */
    getStatus() {
        return {
            name: this.name,
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            lastFailureTime: this.lastFailureTime,
            config: {
                failureThreshold: this.failureThreshold,
                resetTimeoutMs: this.resetTimeoutMs
            }
        };
    }

    /**
     * Manually reset the circuit breaker
     */
    reset() {
        this.state = CIRCUIT_STATE.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.halfOpenAttempts = 0;
        this.logger.log('reset', { state: CIRCUIT_STATE.CLOSED });
    }
}

// =============================================================================
// PRE-CONFIGURED CIRCUIT BREAKERS
// =============================================================================

/**
 * Circuit breakers for external services
 */
const circuitBreakers = {
    discord: new CircuitBreaker({
        name: 'Discord',
        failureThreshold: 3,
        resetTimeoutMs: 30000
    }),
    anthropic: new CircuitBreaker({
        name: 'Anthropic',
        failureThreshold: 3,
        resetTimeoutMs: 60000  // Longer timeout for AI service
    })
};

/**
 * Get status of all circuit breakers
 * @returns {Object} Status of all circuit breakers
 */
function getCircuitBreakerStatus() {
    const status = {};
    for (const [name, breaker] of Object.entries(circuitBreakers)) {
        status[name] = breaker.getStatus();
    }
    return status;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    // Error codes
    ERROR_CODES,

    // Error classes
    AppError,
    NotFoundError,
    ValidationError,
    ConflictError,
    UnauthorizedError,
    ForbiddenError,
    ExternalServiceError,
    RateLimitError,
    CircuitBreakerOpenError,

    // Response formatter
    formatErrorResponse,

    // Retry logic
    withRetry,
    DEFAULT_RETRY_CONFIG,

    // Circuit breaker
    CircuitBreaker,
    CIRCUIT_STATE,
    circuitBreakers,
    getCircuitBreakerStatus
};
