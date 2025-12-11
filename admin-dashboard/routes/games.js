/**
 * Games Routes
 *
 * Game configuration management API endpoints.
 * Extracted from server.js for modularity.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fsSync = require('fs');
const { requireAuthAPI, requireAdmin } = require('../middleware/auth');
const activityLogger = require('../services/activity-logger');

// File paths
const GAME_CONFIGS_FILE = path.join(__dirname, '..', 'game-configs.json');
const SIGNUP_GAME_CONFIGS_FILE = path.join(__dirname, '..', '..', 'tournament-signup', 'game-configs.json');

/**
 * Load game configurations from file
 * @returns {Object} Game configurations object
 */
function loadGameConfigs() {
	try {
		const data = fsSync.readFileSync(GAME_CONFIGS_FILE, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('[Game Configs] Error loading:', error.message);
		return {
			default: {
				name: 'Tournament',
				shortName: '',
				rules: [],
				prizes: [],
				additionalInfo: []
			}
		};
	}
}

/**
 * Save game configurations to file
 * @param {Object} configs - Game configurations to save
 */
function saveGameConfigs(configs) {
	// Write to admin-dashboard (master copy)
	fsSync.writeFileSync(GAME_CONFIGS_FILE, JSON.stringify(configs, null, 2));

	// Write to tournament-signup (for hot-reload)
	try {
		fsSync.writeFileSync(SIGNUP_GAME_CONFIGS_FILE, JSON.stringify(configs, null, 2));
		console.log('[Game Configs] Synced to signup app');
	} catch (error) {
		console.error('[Game Configs] Failed to sync to signup app:', error.message);
	}
}

/**
 * Validate game key format
 * @param {string} key - Game key to validate
 * @returns {boolean} True if valid
 */
function validateGameKey(key) {
	// Only allow lowercase alphanumeric and underscores
	return /^[a-z][a-z0-9_]*$/.test(key) && key.length <= 30;
}

// ============================================
// GAME CONFIGURATION API ENDPOINTS
// ============================================

/**
 * GET /api/games
 * List all games with configs
 */
router.get('/', requireAuthAPI, (req, res) => {
	try {
		const configs = loadGameConfigs();
		const games = Object.entries(configs).map(([key, config]) => ({
			gameKey: key,
			name: config.name || key,
			shortName: config.shortName || '',
			rules: config.rules || [],
			prizes: config.prizes || [],
			additionalInfo: config.additionalInfo || [],
			isDefault: key === 'default'
		}));

		res.json({
			success: true,
			games,
			totalGames: games.length
		});
	} catch (error) {
		console.error('[Game Configs] Error listing games:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * GET /api/games/:gameKey
 * Get single game config
 */
router.get('/:gameKey', requireAuthAPI, (req, res) => {
	try {
		const { gameKey } = req.params;
		const configs = loadGameConfigs();

		if (!configs[gameKey]) {
			return res.status(404).json({ success: false, error: 'Game not found' });
		}

		res.json({
			success: true,
			gameKey,
			config: configs[gameKey]
		});
	} catch (error) {
		console.error('[Game Configs] Error getting game:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * POST /api/games
 * Create new game
 */
router.post('/', requireAuthAPI, requireAdmin, (req, res) => {
	try {
		const { gameKey, name, shortName, rules, prizes, additionalInfo } = req.body;

		if (!gameKey || !name) {
			return res.status(400).json({ success: false, error: 'gameKey and name are required' });
		}

		if (!validateGameKey(gameKey)) {
			return res.status(400).json({
				success: false,
				error: 'Invalid game key. Use lowercase letters, numbers, and underscores only. Must start with a letter.'
			});
		}

		const configs = loadGameConfigs();

		if (configs[gameKey]) {
			return res.status(400).json({ success: false, error: 'Game key already exists' });
		}

		// Create new game config
		configs[gameKey] = {
			name: name.trim(),
			shortName: (shortName || '').trim(),
			rules: rules || [],
			prizes: prizes || [
				{ place: 1, position: '1st Place', emoji: '', amount: 30, gradient: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)', extras: [] },
				{ place: 2, position: '2nd Place', emoji: '', amount: 20, gradient: 'linear-gradient(135deg, #c0c0c0 0%, #909090 100%)', extras: [] },
				{ place: 3, position: '3rd Place', emoji: '', amount: 10, gradient: 'linear-gradient(135deg, #cd7f32 0%, #8b5a2b 100%)', extras: [] }
			],
			additionalInfo: additionalInfo || []
		};

		saveGameConfigs(configs);

		activityLogger.logActivity(req.session.userId, req.session.username, 'create_game', {
			gameKey,
			name: configs[gameKey].name
		});

		console.log(`[Game Configs] Created game: ${gameKey}`);

		res.json({
			success: true,
			message: 'Game created successfully',
			gameKey,
			config: configs[gameKey]
		});
	} catch (error) {
		console.error('[Game Configs] Error creating game:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * PUT /api/games/:gameKey
 * Update game config
 */
router.put('/:gameKey', requireAuthAPI, requireAdmin, (req, res) => {
	try {
		const { gameKey } = req.params;
		const { name, shortName, rules, prizes, additionalInfo, newGameKey } = req.body;

		const configs = loadGameConfigs();

		if (!configs[gameKey]) {
			return res.status(404).json({ success: false, error: 'Game not found' });
		}

		// Handle rename
		if (newGameKey && newGameKey !== gameKey) {
			if (gameKey === 'default') {
				return res.status(400).json({ success: false, error: 'Cannot rename the default game' });
			}

			if (!validateGameKey(newGameKey)) {
				return res.status(400).json({
					success: false,
					error: 'Invalid new game key. Use lowercase letters, numbers, and underscores only.'
				});
			}

			if (configs[newGameKey]) {
				return res.status(400).json({ success: false, error: 'New game key already exists' });
			}

			// Move config to new key
			configs[newGameKey] = configs[gameKey];
			delete configs[gameKey];

			console.log(`[Game Configs] Renamed game: ${gameKey} -> ${newGameKey}`);
		}

		const targetKey = newGameKey || gameKey;

		// Update fields if provided
		if (name !== undefined) configs[targetKey].name = name.trim();
		if (shortName !== undefined) configs[targetKey].shortName = shortName.trim();
		if (rules !== undefined) configs[targetKey].rules = rules;
		if (prizes !== undefined) configs[targetKey].prizes = prizes;
		if (additionalInfo !== undefined) configs[targetKey].additionalInfo = additionalInfo;

		saveGameConfigs(configs);

		activityLogger.logActivity(req.session.userId, req.session.username, 'update_game', {
			gameKey: targetKey,
			name: configs[targetKey].name,
			renamed: newGameKey && newGameKey !== gameKey ? { from: gameKey, to: newGameKey } : undefined
		});

		console.log(`[Game Configs] Updated game: ${targetKey}`);

		res.json({
			success: true,
			message: 'Game updated successfully',
			gameKey: targetKey,
			config: configs[targetKey]
		});
	} catch (error) {
		console.error('[Game Configs] Error updating game:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * DELETE /api/games/:gameKey
 * Delete game
 */
router.delete('/:gameKey', requireAuthAPI, requireAdmin, (req, res) => {
	try {
		const { gameKey } = req.params;

		if (gameKey === 'default') {
			return res.status(400).json({ success: false, error: 'Cannot delete the default game' });
		}

		const configs = loadGameConfigs();

		if (!configs[gameKey]) {
			return res.status(404).json({ success: false, error: 'Game not found' });
		}

		const deletedName = configs[gameKey].name;
		delete configs[gameKey];

		saveGameConfigs(configs);

		activityLogger.logActivity(req.session.userId, req.session.username, 'delete_game', {
			gameKey,
			name: deletedName
		});

		console.log(`[Game Configs] Deleted game: ${gameKey}`);

		res.json({
			success: true,
			message: 'Game deleted successfully',
			deletedGameKey: gameKey
		});
	} catch (error) {
		console.error('[Game Configs] Error deleting game:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

module.exports = router;
module.exports.loadGameConfigs = loadGameConfigs;
module.exports.saveGameConfigs = saveGameConfigs;
module.exports.validateGameKey = validateGameKey;
