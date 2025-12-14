/**
 * Signup Routes
 *
 * Handles user registration with invite key validation.
 */

const express = require('express');
const router = express.Router();
const usersDb = require('../db/users-db');
const inviteKeys = require('../services/invite-keys');
const subscription = require('../services/subscription');
const activityLogger = require('../services/activity-logger');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:signup');

// Rate limiting for signup (simple in-memory)
const signupAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip) {
    const now = Date.now();
    const attempts = signupAttempts.get(ip) || { count: 0, firstAttempt: now };

    // Reset if window expired
    if (now - attempts.firstAttempt > WINDOW_MS) {
        attempts.count = 0;
        attempts.firstAttempt = now;
    }

    if (attempts.count >= MAX_ATTEMPTS) {
        const retryAfter = Math.ceil((attempts.firstAttempt + WINDOW_MS - now) / 1000);
        return { allowed: false, retryAfter };
    }

    return { allowed: true };
}

function recordAttempt(ip) {
    const now = Date.now();
    const attempts = signupAttempts.get(ip) || { count: 0, firstAttempt: now };

    if (now - attempts.firstAttempt > WINDOW_MS) {
        attempts.count = 1;
        attempts.firstAttempt = now;
    } else {
        attempts.count++;
    }

    signupAttempts.set(ip, attempts);
}

/**
 * POST /api/auth/signup
 * Register a new user with invite key
 */
router.post('/signup', async (req, res) => {
    const { username, email, password, confirmPassword, inviteKey } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress;

    // Rate limiting
    const rateLimit = checkRateLimit(clientIp);
    if (!rateLimit.allowed) {
        return res.status(429).json({
            success: false,
            error: `Too many signup attempts. Please try again in ${rateLimit.retryAfter} seconds.`
        });
    }

    try {
        // Check if signups are allowed
        const canSignupResult = subscription.canSignup();
        if (!canSignupResult.allowed) {
            return res.status(503).json({
                success: false,
                error: canSignupResult.reason
            });
        }

        // Validate required fields
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username, email, and password are required'
            });
        }

        // Validate password confirmation
        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                error: 'Passwords do not match'
            });
        }

        // Validate password strength
        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 8 characters long'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        // Validate username format
        const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
        if (!usernameRegex.test(username)) {
            return res.status(400).json({
                success: false,
                error: 'Username must be 3-30 characters, alphanumeric with underscores/hyphens'
            });
        }

        // Check platform settings for invite key requirement
        const platformSettings = subscription.getPlatformSettings();

        if (platformSettings.requireInviteKey) {
            if (!inviteKey) {
                return res.status(400).json({
                    success: false,
                    error: 'Invite key is required to sign up'
                });
            }

            // Validate invite key
            const keyValidation = inviteKeys.validateKey(inviteKey);
            if (!keyValidation.valid) {
                recordAttempt(clientIp);
                return res.status(400).json({
                    success: false,
                    error: keyValidation.error
                });
            }
        }

        // Check for existing username/email
        const existingUsername = usersDb.getUserByUsername(username);
        if (existingUsername) {
            return res.status(409).json({
                success: false,
                error: 'Username already taken'
            });
        }

        const existingEmail = usersDb.getUserByEmail(email);
        if (existingEmail) {
            return res.status(409).json({
                success: false,
                error: 'Email already registered'
            });
        }

        // Create user
        const user = await usersDb.createUser({
            username,
            email,
            password,
            displayName: username,
            inviteKeyUsed: inviteKey || null
        });

        // Record invite key usage
        if (inviteKey && platformSettings.requireInviteKey) {
            const key = inviteKeys.getKeyByCode(inviteKey);
            if (key) {
                inviteKeys.recordUsage(key.id, user.id, { ip: clientIp });
            }
        }

        // Log activity
        activityLogger.logActivity(user.id, user.username, 'user_signup', {
            ip: clientIp,
            inviteKeyUsed: !!inviteKey
        });

        logger.log('signup:success', { username, email, userId: user.id });

        // Auto-login after signup
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.email = user.email;

        res.json({
            success: true,
            message: 'Account created successfully',
            user: usersDb.sanitizeUser(user)
        });

    } catch (error) {
        logger.error('signup:error', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create account'
        });
    }
});

/**
 * POST /api/auth/validate-key
 * Validate an invite key without using it
 */
router.post('/validate-key', (req, res) => {
    const { inviteKey } = req.body;

    if (!inviteKey) {
        return res.status(400).json({
            success: false,
            valid: false,
            error: 'Invite key is required'
        });
    }

    const result = inviteKeys.validateKey(inviteKey);

    res.json({
        success: true,
        valid: result.valid,
        error: result.error || null,
        keyType: result.key?.key_type || null
    });
});

/**
 * GET /api/auth/signup-status
 * Check if signups are currently allowed
 */
router.get('/signup-status', (req, res) => {
    const canSignupResult = subscription.canSignup();
    const platformSettings = subscription.getPlatformSettings();

    res.json({
        success: true,
        signupsAllowed: canSignupResult.allowed,
        requireInviteKey: platformSettings.requireInviteKey,
        reason: canSignupResult.reason || null
    });
});

module.exports = router;
