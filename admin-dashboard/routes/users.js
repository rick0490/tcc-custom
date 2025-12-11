/**
 * Users Routes
 *
 * User management API endpoints (admin only).
 * Extracted from server.js for modularity.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuthAPI, requireAdmin } = require('../middleware/auth');
const settings = require('../services/settings');

/**
 * GET /api/users
 * Get all users (admin only)
 */
router.get('/', requireAuthAPI, requireAdmin, (req, res) => {
	const usersData = settings.loadUsers();

	// Don't send passwords to client
	const safeUsers = usersData.users.map(u => ({
		id: u.id,
		username: u.username,
		role: u.role,
		createdAt: u.createdAt
	}));

	res.json({
		success: true,
		users: safeUsers
	});
});

/**
 * POST /api/users
 * Add new user (admin only)
 */
router.post('/', requireAuthAPI, requireAdmin, async (req, res) => {
	const { username, password, role } = req.body;

	if (!username || !password) {
		return res.status(400).json({
			success: false,
			error: 'Username and password are required'
		});
	}

	// Validate password
	const passwordValidation = settings.validatePassword(password);
	if (!passwordValidation.valid) {
		return res.status(400).json({
			success: false,
			error: passwordValidation.errors.join('. ')
		});
	}

	// Check if user already exists
	const usersData = settings.loadUsers();
	if (usersData.users.find(u => u.username === username)) {
		return res.status(409).json({
			success: false,
			error: 'Username already exists'
		});
	}

	// Hash password
	const hashedPassword = await bcrypt.hash(password, 10);

	// Create new user
	const newUser = {
		id: Math.max(...usersData.users.map(u => u.id), 0) + 1,
		username,
		password: hashedPassword,
		role: role || 'user',
		createdAt: new Date().toISOString()
	};

	usersData.users.push(newUser);
	settings.saveUsers(usersData);

	res.json({
		success: true,
		user: {
			id: newUser.id,
			username: newUser.username,
			role: newUser.role,
			createdAt: newUser.createdAt
		}
	});
});

/**
 * PUT /api/users/:id
 * Update user (admin only)
 */
router.put('/:id', requireAuthAPI, requireAdmin, async (req, res) => {
	const userId = parseInt(req.params.id);
	const { username, password, role } = req.body;

	const usersData = settings.loadUsers();
	const userIndex = usersData.users.findIndex(u => u.id === userId);

	if (userIndex === -1) {
		return res.status(404).json({
			success: false,
			error: 'User not found'
		});
	}

	// Update fields
	if (username) {
		// Check if new username already exists
		if (usersData.users.find(u => u.username === username && u.id !== userId)) {
			return res.status(409).json({
				success: false,
				error: 'Username already exists'
			});
		}
		usersData.users[userIndex].username = username;
	}

	if (password) {
		// Validate password
		const passwordValidation = settings.validatePassword(password);
		if (!passwordValidation.valid) {
			return res.status(400).json({
				success: false,
				error: passwordValidation.errors.join('. ')
			});
		}
		const hashedPassword = await bcrypt.hash(password, 10);
		usersData.users[userIndex].password = hashedPassword;
	}

	if (role) {
		usersData.users[userIndex].role = role;
	}

	settings.saveUsers(usersData);

	res.json({
		success: true,
		user: {
			id: usersData.users[userIndex].id,
			username: usersData.users[userIndex].username,
			role: usersData.users[userIndex].role,
			createdAt: usersData.users[userIndex].createdAt
		}
	});
});

/**
 * DELETE /api/users/:id
 * Delete user (admin only)
 */
router.delete('/:id', requireAuthAPI, requireAdmin, (req, res) => {
	const userId = parseInt(req.params.id);

	// Prevent deleting own account
	if (req.session.userId === userId) {
		return res.status(400).json({
			success: false,
			error: 'Cannot delete your own account'
		});
	}

	const usersData = settings.loadUsers();
	const userIndex = usersData.users.findIndex(u => u.id === userId);

	if (userIndex === -1) {
		return res.status(404).json({
			success: false,
			error: 'User not found'
		});
	}

	usersData.users.splice(userIndex, 1);
	settings.saveUsers(usersData);

	res.json({
		success: true,
		message: 'User deleted successfully'
	});
});

module.exports = router;
