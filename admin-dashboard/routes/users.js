/**
 * Users Routes
 *
 * User profile API endpoints.
 * Simplified to profile-only operations (no CRUD for other users).
 * Each tenant has one user - no role-based access control needed.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuthAPI } = require('../middleware/auth');
const settings = require('../services/settings');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:users');

/**
 * GET /api/users/me
 * Get current user profile
 */
router.get('/me', requireAuthAPI, (req, res) => {
	const usersData = settings.loadUsers();
	const user = usersData.users.find(u => u.id === req.session.userId);

	if (!user) {
		return res.status(404).json({
			success: false,
			error: 'User not found'
		});
	}

	res.json({
		success: true,
		user: {
			id: user.id,
			username: user.username,
			email: user.email || null,
			createdAt: user.createdAt
		}
	});
});

/**
 * PUT /api/users/me
 * Update current user profile (username, email)
 * Note: Password changes use /api/settings/change-password endpoint
 */
router.put('/me', requireAuthAPI, async (req, res) => {
	const { username, email } = req.body;

	const usersData = settings.loadUsers();
	const userIndex = usersData.users.findIndex(u => u.id === req.session.userId);

	if (userIndex === -1) {
		return res.status(404).json({
			success: false,
			error: 'User not found'
		});
	}

	// Update username if provided
	if (username) {
		// Check if new username already exists (case-insensitive)
		const existingUser = usersData.users.find(
			u => u.username.toLowerCase() === username.toLowerCase() && u.id !== req.session.userId
		);
		if (existingUser) {
			return res.status(409).json({
				success: false,
				error: 'Username already exists'
			});
		}
		usersData.users[userIndex].username = username;
		// Update session username
		req.session.username = username;
	}

	// Update email if provided
	if (email !== undefined) {
		usersData.users[userIndex].email = email || null;
	}

	settings.saveUsers(usersData);

	logger.log('profileUpdated', { userId: req.session.userId, username: usersData.users[userIndex].username });

	res.json({
		success: true,
		user: {
			id: usersData.users[userIndex].id,
			username: usersData.users[userIndex].username,
			email: usersData.users[userIndex].email || null,
			createdAt: usersData.users[userIndex].createdAt
		}
	});
});

module.exports = router;
