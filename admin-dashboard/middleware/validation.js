/**
 * Validation Middleware
 *
 * Express middleware for Joi schema validation.
 * Validates request body and returns standardized error responses.
 */

/**
 * Create validation middleware for a Joi schema
 *
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Validation options
 * @param {boolean} options.stripUnknown - Remove unknown fields (default: true)
 * @param {string} options.source - Request property to validate: 'body', 'query', 'params' (default: 'body')
 * @returns {Function} Express middleware function
 *
 * @example
 * const { loginSchema } = require('../validation/schemas');
 * const { validate } = require('../middleware/validation');
 *
 * app.post('/api/auth/login', validate(loginSchema), (req, res) => {
 *   // req.validatedBody contains sanitized, validated data
 *   const { username, password } = req.validatedBody;
 * });
 */
function validate(schema, options = {}) {
	const { stripUnknown = true, source = 'body' } = options;

	return (req, res, next) => {
		const dataToValidate = req[source];

		const { error, value } = schema.validate(dataToValidate, {
			abortEarly: false,  // Collect all errors
			stripUnknown,       // Remove unknown fields
			convert: true       // Convert types (e.g., string "true" to boolean)
		});

		if (error) {
			// Format validation errors
			const errors = error.details.map(detail => ({
				field: detail.path.join('.'),
				message: detail.message.replace(/"/g, "'")
			}));

			// Log validation failure for debugging
			console.log(`[Validation] Failed for ${req.method} ${req.path}:`, errors);

			return res.status(400).json({
				success: false,
				error: 'Validation failed',
				details: errors
			});
		}

		// Store validated and sanitized data
		if (source === 'body') {
			req.validatedBody = value;
		} else if (source === 'query') {
			req.validatedQuery = value;
		} else if (source === 'params') {
			req.validatedParams = value;
		}

		next();
	};
}

/**
 * Validate request body
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware
 */
function validateBody(schema) {
	return validate(schema, { source: 'body' });
}

/**
 * Validate query parameters
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware
 */
function validateQuery(schema) {
	return validate(schema, { source: 'query' });
}

/**
 * Validate route parameters
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware
 */
function validateParams(schema) {
	return validate(schema, { source: 'params' });
}

/**
 * Validation error handler middleware
 * Catches any validation errors that slip through and formats them consistently
 */
function validationErrorHandler(err, req, res, next) {
	if (err.isJoi) {
		const errors = err.details.map(detail => ({
			field: detail.path.join('.'),
			message: detail.message.replace(/"/g, "'")
		}));

		return res.status(400).json({
			success: false,
			error: 'Validation failed',
			details: errors
		});
	}

	next(err);
}

module.exports = {
	validate,
	validateBody,
	validateQuery,
	validateParams,
	validationErrorHandler
};
