/**
 * Sponsors Routes
 *
 * Handles sponsor logo overlay management: upload, list, delete, preview,
 * positioning, rotation, and display control.
 * Supports PNG, JPG, GIF, SVG, and WebP files up to 10MB.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { createLogger } = require('../services/debug-logger');
const systemDb = require('../db/system-db');

const logger = createLogger('routes:sponsors');

// Module dependencies (injected via init)
let axios = null;
let io = null;
let requireAuthAPI = null;
let sponsorService = null;
let logActivity = null;

// File paths - now user-specific via sponsorService
// const SPONSORS_DIR = path.join(__dirname, '..', 'sponsors'); // Moved to sponsorService

/**
 * Check if user is superadmin
 * @param {Object} req - Express request
 * @returns {boolean} True if user is superadmin
 */
function isSuperadmin(req) {
	if (!req.session || !req.session.userId) return false;
	return req.session.userId === 1;
}

/**
 * Get the sponsors directory for the current user
 * @param {Object} req - Express request
 * @returns {string} Path to user's sponsors directory
 */
function getSponsorsDir(req) {
	const userId = req.session?.userId;
	return sponsorService.getUserSponsorsDir(userId);
}

// Allowed file types for sponsor logos
const ALLOWED_SPONSOR_MIMETYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'];
const ALLOWED_SPONSOR_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

// Configure multer for file uploads
const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, 'uploads/');
	},
	filename: (req, file, cb) => {
		const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
		cb(null, uniqueSuffix + path.extname(file.originalname));
	}
});

const sponsorUpload = multer({
	storage: storage,
	limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for logos
	fileFilter: (req, file, cb) => {
		if (ALLOWED_SPONSOR_MIMETYPES.includes(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new Error('Only PNG, JPG, GIF, SVG, and WebP files are allowed'));
		}
	}
});

/**
 * Initialize route dependencies
 * @param {Object} deps - Dependencies object
 */
function init(deps) {
	axios = deps.axios;
	io = deps.io;
	requireAuthAPI = deps.requireAuthAPI;
	sponsorService = deps.sponsorService;
	logActivity = deps.logActivity || (() => {});
}

// ============================================
// PUBLIC ROUTES (no authentication required)
// ============================================

/**
 * GET /preview/:userId/:filename
 * Serve sponsor logo for preview from user-specific directory
 * Public route - no authentication required (used by displays)
 */
router.get('/preview/:userId/:filename', async (req, res) => {
	try {
		const userId = parseInt(req.params.userId, 10);
		const filename = decodeURIComponent(req.params.filename);

		// Security check
		if (isNaN(userId) || userId < 1) {
			return res.status(400).json({ error: 'Invalid user ID' });
		}
		if (filename.includes('..') || filename.includes('/')) {
			return res.status(400).json({ error: 'Invalid filename' });
		}

		const userSponsorsDir = sponsorService.getUserSponsorsDir(userId);
		const filePath = path.join(userSponsorsDir, filename);
		res.sendFile(filePath);
	} catch (error) {
		res.status(404).json({ error: 'Sponsor logo not found' });
	}
});

/**
 * GET /preview/:filename
 * Serve sponsor logo for preview (legacy route - checks root sponsors dir)
 * Public route - no authentication required
 * @deprecated Use /preview/:userId/:filename instead
 */
router.get('/preview/:filename', async (req, res) => {
	try {
		const filename = decodeURIComponent(req.params.filename);

		// Security check
		if (filename.includes('..') || filename.includes('/')) {
			return res.status(400).json({ error: 'Invalid filename' });
		}

		// First check the base sponsors directory (for legacy files)
		const basePath = path.join(sponsorService.SPONSORS_DIR, filename);
		try {
			await fs.access(basePath);
			return res.sendFile(basePath);
		} catch {
			// File not in base directory, check all user directories
			const allStates = sponsorService.loadAllSponsorStates();
			for (const { userId } of allStates) {
				const userSponsorsDir = sponsorService.getUserSponsorsDir(userId);
				const filePath = path.join(userSponsorsDir, filename);
				try {
					await fs.access(filePath);
					return res.sendFile(filePath);
				} catch {
					// Continue checking other user directories
				}
			}
		}

		res.status(404).json({ error: 'Sponsor logo not found' });
	} catch (error) {
		res.status(404).json({ error: 'Sponsor logo not found' });
	}
});

// ============================================
// PROTECTED ROUTES (authentication required)
// ============================================

/**
 * GET /
 * List all sponsors with config
 * Regular users see only their own sponsors
 * Superadmin sees all sponsors from all users
 */
router.get('/', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session.userId;
			const superadmin = isSuperadmin(req);

			if (superadmin) {
				// Superadmin sees all sponsors from all users
				const allStates = sponsorService.loadAllSponsorStates();
				const allSponsors = [];

				for (const { userId: ownerId, state } of allStates) {
					const userSponsorsDir = sponsorService.getUserSponsorsDir(ownerId);
					const sponsorsWithStats = await Promise.all(
						state.sponsors.map(async (sponsor) => {
							try {
								const filePath = path.join(userSponsorsDir, sponsor.filename);
								const stats = await fs.stat(filePath);
								return {
									...sponsor,
									ownerId,
									fileSize: stats.size,
									modified: stats.mtime
								};
							} catch {
								return { ...sponsor, ownerId, fileSize: 0, modified: null };
							}
						})
					);
					allSponsors.push(...sponsorsWithStats);
				}

				res.json({
					success: true,
					sponsors: allSponsors,
					config: null, // No single config for superadmin view
					lastUpdated: new Date().toISOString(),
					isSuperadmin: true
				});
			} else {
				// Regular user sees only their own sponsors
				const state = sponsorService.loadSponsorState(userId);
				const userSponsorsDir = sponsorService.getUserSponsorsDir(userId);

				// Add file stats to each sponsor
				const sponsorsWithStats = await Promise.all(
					state.sponsors.map(async (sponsor) => {
						try {
							const filePath = path.join(userSponsorsDir, sponsor.filename);
							const stats = await fs.stat(filePath);
							return {
								...sponsor,
								ownerId: userId,  // Include ownerId for consistent URL construction
								fileSize: stats.size,
								modified: stats.mtime
							};
						} catch {
							return { ...sponsor, ownerId: userId, fileSize: 0, modified: null };
						}
					})
				);

				res.json({
					success: true,
					sponsors: sponsorsWithStats,
					config: state.config,
					lastUpdated: state.lastUpdated,
					currentUserId: userId  // Include for frontend reference
				});
			}
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /:id
 * Get single sponsor
 * Users can only access their own sponsors (superadmin can access any)
 */
router.get('/:id', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session.userId;
			const superadmin = isSuperadmin(req);

			if (superadmin) {
				// Superadmin can access any sponsor - search all states
				const allStates = sponsorService.loadAllSponsorStates();
				for (const { userId: ownerId, state } of allStates) {
					const sponsor = state.sponsors.find(s => s.id === req.params.id);
					if (sponsor) {
						return res.json({ success: true, sponsor: { ...sponsor, ownerId } });
					}
				}
				return res.status(404).json({ success: false, error: 'Sponsor not found' });
			}

			// Regular user - only their own sponsors
			const state = sponsorService.loadSponsorState(userId);
			const sponsor = state.sponsors.find(s => s.id === req.params.id);

			if (!sponsor) {
				return res.status(404).json({ success: false, error: 'Sponsor not found' });
			}

			res.json({ success: true, sponsor });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /upload
 * Upload new sponsor logo
 * Files are saved to user-specific directory
 */
router.post('/upload', (req, res, next) => {
	requireAuthAPI(req, res, () => {
		sponsorUpload.single('logo')(req, res, next);
	});
}, async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ success: false, error: 'No file uploaded' });
		}

		const userId = req.session.userId;
		const { name, position, type, size = 100, opacity = 100, borderRadius = 0, customName } = req.body;

		if (!name) {
			await fs.unlink(req.file.path);
			return res.status(400).json({ success: false, error: 'Sponsor name is required' });
		}

		if (!position) {
			await fs.unlink(req.file.path);
			return res.status(400).json({ success: false, error: 'Position is required' });
		}

		const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-banner', 'bottom-banner'];
		if (!validPositions.includes(position)) {
			await fs.unlink(req.file.path);
			return res.status(400).json({ success: false, error: 'Invalid position' });
		}

		const validTypes = ['corner', 'banner'];
		const sponsorType = type || (position.includes('banner') ? 'banner' : 'corner');
		if (!validTypes.includes(sponsorType)) {
			await fs.unlink(req.file.path);
			return res.status(400).json({ success: false, error: 'Invalid type' });
		}

		// Generate filename
		const originalExt = path.extname(req.file.originalname).toLowerCase();
		let finalName;
		if (customName) {
			const sanitized = sponsorService.sanitizeSponsorFilename(customName);
			finalName = sanitized + originalExt;
		} else {
			finalName = `sponsor_${Date.now()}${originalExt}`;
		}

		// Move file to user-specific sponsors directory
		const userSponsorsDir = sponsorService.getUserSponsorsDir(userId);
		const targetPath = path.join(userSponsorsDir, finalName);
		await fs.rename(req.file.path, targetPath);

		// Create sponsor entry in user's state
		const state = sponsorService.loadSponsorState(userId);
		const newSponsor = {
			id: `sponsor_${Date.now()}`,
			name: name,
			filename: finalName,
			originalFilename: req.file.originalname,
			position: position,
			type: sponsorType,
			size: Math.min(Math.max(parseInt(size, 10) || 100, 50), 500),
			opacity: Math.min(Math.max(parseInt(opacity, 10) || 100, 10), 100),
			borderRadius: Math.min(Math.max(parseInt(borderRadius, 10) || 0, 0), 50),
			active: true,
			order: state.sponsors.filter(s => s.position === position).length + 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		state.sponsors.push(newSponsor);
		sponsorService.saveSponsorState(state, userId);

		// Restart rotation if enabled (multi-tenant)
		if (state.config.enabled && state.config.rotationEnabled) {
			sponsorService.startSponsorRotation(userId);
		}

		logger.log('upload:success', { userId, name, filename: finalName, position });

		res.json({
			success: true,
			message: 'Sponsor uploaded successfully',
			sponsor: newSponsor
		});
	} catch (error) {
		logger.error('upload', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * PUT /:id
 * Update sponsor metadata
 * Users can only update their own sponsors
 */
router.put('/:id', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session.userId;
			const state = sponsorService.loadSponsorState(userId);
			const index = state.sponsors.findIndex(s => s.id === req.params.id);

			if (index === -1) {
				return res.status(404).json({ success: false, error: 'Sponsor not found' });
			}

			const { name, position, type, size, opacity, borderRadius, offsetX, offsetY, active } = req.body;
			const sponsor = state.sponsors[index];

			logger.log('update:received', { userId, id: req.params.id, offsetX, offsetY });

			if (name !== undefined) sponsor.name = name;
			if (position !== undefined) {
				const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-banner', 'bottom-banner'];
				if (validPositions.includes(position)) {
					sponsor.position = position;
				}
			}
			if (type !== undefined) {
				const validTypes = ['corner', 'banner'];
				if (validTypes.includes(type)) {
					sponsor.type = type;
				}
			}
			if (size !== undefined) {
				sponsor.size = Math.min(Math.max(parseInt(size, 10), 50), 500);
			}
			if (opacity !== undefined) {
				sponsor.opacity = Math.min(Math.max(parseInt(opacity, 10), 10), 100);
			}
			if (borderRadius !== undefined) {
				sponsor.borderRadius = Math.min(Math.max(parseInt(borderRadius, 10), 0), 50);
			}
			if (offsetX !== undefined) {
				sponsor.offsetX = Math.min(Math.max(parseInt(offsetX, 10), -500), 500);
			}
			if (offsetY !== undefined) {
				sponsor.offsetY = Math.min(Math.max(parseInt(offsetY, 10), -500), 500);
			}
			if (active !== undefined) {
				sponsor.active = Boolean(active);
			}

			sponsor.updatedAt = new Date().toISOString();
			sponsorService.saveSponsorState(state, userId);

			// Restart rotation if config changed (multi-tenant)
			if (state.config.enabled && state.config.rotationEnabled) {
				sponsorService.startSponsorRotation(userId);
			}

			// Broadcast update (multi-tenant)
			if (io) {
				if (userId) {
					io.to(`user:${userId}`).emit('sponsor:update', { sponsors: state.sponsors });
					console.log(`[WebSocket] User-targeted sponsor:update to user:${userId}`);
				} else {
					io.emit('sponsor:update', { sponsors: state.sponsors });
					console.log(`[WebSocket] Global sponsor:update broadcast`);
				}
			}

			res.json({ success: true, sponsor });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * DELETE /:id
 * Delete sponsor
 * Users can only delete their own sponsors
 */
router.delete('/:id', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session.userId;
			const state = sponsorService.loadSponsorState(userId);
			const index = state.sponsors.findIndex(s => s.id === req.params.id);

			if (index === -1) {
				return res.status(404).json({ success: false, error: 'Sponsor not found' });
			}

			const sponsor = state.sponsors[index];

			// Delete the file from user-specific directory
			const userSponsorsDir = sponsorService.getUserSponsorsDir(userId);
			try {
				await fs.unlink(path.join(userSponsorsDir, sponsor.filename));
			} catch (fileError) {
				logger.warn('delete:fileError', { userId, filename: sponsor.filename, error: fileError.message });
			}

			// Remove from state
			state.sponsors.splice(index, 1);
			sponsorService.saveSponsorState(state, userId);

			// Restart rotation (multi-tenant)
			if (state.config.enabled && state.config.rotationEnabled) {
				sponsorService.startSponsorRotation(userId);
			}

			// Broadcast update (multi-tenant)
			if (io) {
				if (userId) {
					io.to(`user:${userId}`).emit('sponsor:update', { sponsors: state.sponsors });
					console.log(`[WebSocket] User-targeted sponsor:update to user:${userId}`);
				} else {
					io.emit('sponsor:update', { sponsors: state.sponsors });
					console.log(`[WebSocket] Global sponsor:update broadcast`);
				}
			}

			logger.log('delete:success', { userId, id: req.params.id, name: sponsor.name });

			res.json({ success: true, message: 'Sponsor deleted successfully' });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /reorder
 * Reorder sponsors
 * Users can only reorder their own sponsors
 */
router.post('/reorder', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session.userId;
			const { order } = req.body; // Array of { id, order }

			if (!Array.isArray(order)) {
				return res.status(400).json({ success: false, error: 'Order must be an array' });
			}

			const state = sponsorService.loadSponsorState(userId);

			order.forEach(({ id, order: newOrder }) => {
				const sponsor = state.sponsors.find(s => s.id === id);
				if (sponsor) {
					sponsor.order = newOrder;
					sponsor.updatedAt = new Date().toISOString();
				}
			});

			sponsorService.saveSponsorState(state, userId);

			// Restart rotation with new order (multi-tenant)
			if (state.config.enabled && state.config.rotationEnabled) {
				sponsorService.startSponsorRotation(userId);
			}

			res.json({ success: true, message: 'Order updated' });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /config
 * Get sponsor config
 * User-specific config
 */
router.get('/config', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session.userId;
			const state = sponsorService.loadSponsorState(userId);
			res.json({ success: true, config: state.config });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /config
 * Update sponsor config
 * User-specific config
 */
router.post('/config', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session.userId;
			const state = sponsorService.loadSponsorState(userId);
			const { enabled, rotationEnabled, rotationInterval, rotationTransition, rotationOrder, timerViewEnabled, timerShowDuration, timerHideDuration, displays } = req.body;

			if (enabled !== undefined) state.config.enabled = Boolean(enabled);
			if (rotationEnabled !== undefined) state.config.rotationEnabled = Boolean(rotationEnabled);
			if (rotationInterval !== undefined) {
				state.config.rotationInterval = Math.min(Math.max(parseInt(rotationInterval, 10), 10), 300);
			}
			if (rotationTransition !== undefined) {
				state.config.rotationTransition = Math.min(Math.max(parseInt(rotationTransition, 10), 0), 5000);
			}
			if (rotationOrder !== undefined) {
				if (['sequential', 'random'].includes(rotationOrder)) {
					state.config.rotationOrder = rotationOrder;
				}
			}
			if (timerViewEnabled !== undefined) state.config.timerViewEnabled = Boolean(timerViewEnabled);
			if (timerShowDuration !== undefined) {
				state.config.timerShowDuration = Math.min(Math.max(parseInt(timerShowDuration, 10), 3), 300);
			}
			if (timerHideDuration !== undefined) {
				state.config.timerHideDuration = Math.min(Math.max(parseInt(timerHideDuration, 10), 3), 300);
			}
			if (displays !== undefined) {
				state.config.displays = {
					match: displays.match !== undefined ? Boolean(displays.match) : state.config.displays.match,
					bracket: displays.bracket !== undefined ? Boolean(displays.bracket) : state.config.displays.bracket
				};
			}

			sponsorService.saveSponsorState(state, userId);

			// Update timers - Timer View takes priority over rotation (multi-tenant)
			if (state.config.enabled && state.config.timerViewEnabled) {
				sponsorService.stopSponsorRotation(userId);
				sponsorService.startSponsorTimerView(userId);
			} else if (state.config.enabled && state.config.rotationEnabled) {
				sponsorService.stopSponsorTimerView(userId);
				sponsorService.startSponsorRotation(userId);
			} else {
				sponsorService.stopSponsorTimerView(userId);
				sponsorService.stopSponsorRotation(userId);
			}

			// Broadcast config update (multi-tenant)
			if (io) {
				if (userId) {
					io.to(`user:${userId}`).emit('sponsor:config', { config: state.config });
					console.log(`[WebSocket] User-targeted sponsor:config to user:${userId}`);
				} else {
					io.emit('sponsor:config', { config: state.config });
					console.log(`[WebSocket] Global sponsor:config broadcast`);
				}
			}

			logger.log('config:updated', { userId, enabled: state.config.enabled, rotation: state.config.rotationEnabled, timerView: state.config.timerViewEnabled });

			res.json({ success: true, config: state.config });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /show
 * Show sponsor(s) on displays
 * Users can only show their own sponsors
 */
router.post('/show', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session.userId;
			const { sponsorId, position, all, duration = 0 } = req.body;
			const state = sponsorService.loadSponsorState(userId);
			const userSponsorsDir = sponsorService.getUserSponsorsDir(userId);

			let sponsorsToShow = [];

			if (sponsorId) {
				// Show specific sponsor
				const sponsor = state.sponsors.find(s => s.id === sponsorId);
				if (sponsor) {
					sponsorsToShow.push(sponsor);
				}
			} else if (position) {
				// Show first active sponsor at position
				const sponsor = state.sponsors
					.filter(s => s.active && s.position === position)
					.sort((a, b) => a.order - b.order)[0];
				if (sponsor) {
					sponsorsToShow.push(sponsor);
				}
			} else if (all) {
				// Show all active sponsors (one per position)
				const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-banner', 'bottom-banner'];
				positions.forEach(pos => {
					const sponsor = state.sponsors
						.filter(s => s.active && s.position === pos)
						.sort((a, b) => a.order - b.order)[0];
					if (sponsor) {
						sponsorsToShow.push(sponsor);
					}
				});
			}

			if (sponsorsToShow.length === 0) {
				return res.status(400).json({ success: false, error: 'No sponsors to show' });
			}

			// Format sponsors for display - include userId for proper file path resolution
			const sponsorData = {};
			sponsorsToShow.forEach(s => {
				sponsorData[s.position] = {
					id: s.id,
					filename: s.filename,
					name: s.name,
					position: s.position,
					type: s.type,
					size: s.size,
					opacity: s.opacity,
					borderRadius: s.borderRadius || 0,
					offsetX: s.offsetX || 0,
					offsetY: s.offsetY || 0,
					active: true,
					userId: userId  // Include userId for file path resolution
				};
			});

			// Broadcast via WebSocket (multi-tenant)
			if (io) {
				const payload = {
					sponsors: sponsorData,
					duration: duration > 0 ? Math.min(Math.max(duration, 10), 3600) : 0
				};
				if (userId) {
					io.to(`user:${userId}`).emit('sponsor:show', payload);
					console.log(`[WebSocket] User-targeted sponsor:show to user:${userId}`);
				} else {
					io.emit('sponsor:show', payload);
					console.log(`[WebSocket] Global sponsor:show broadcast`);
				}
			}

			// Also send via HTTP to MagicMirror modules
			const matchEnabled = state.config.displays?.match !== false;
			const bracketEnabled = state.config.displays?.bracket !== false;

			if (matchEnabled && process.env.SPONSOR_MATCH_API_URL) {
				try {
					await axios.post(`${process.env.SPONSOR_MATCH_API_URL}/api/sponsor/show`, {
						sponsors: sponsorData,
						duration: duration > 0 ? Math.min(Math.max(duration, 10), 3600) : 0
					}, { timeout: 5000 });
				} catch (httpError) {
					console.warn(`[Sponsors] HTTP push to match failed: ${httpError.message}`);
				}
			}

			if (bracketEnabled && process.env.SPONSOR_BRACKET_API_URL) {
				try {
					await axios.post(`${process.env.SPONSOR_BRACKET_API_URL}/api/sponsor/show`, {
						sponsors: sponsorData,
						duration: duration > 0 ? Math.min(Math.max(duration, 10), 3600) : 0
					}, { timeout: 5000 });
				} catch (httpError) {
					console.warn(`[Sponsors] HTTP push to bracket failed: ${httpError.message}`);
				}
			}

			logger.log('show:success', { userId, count: Object.keys(sponsorData).length, positions: Object.keys(sponsorData) });

			res.json({
				success: true,
				message: `Showing ${Object.keys(sponsorData).length} sponsor(s)`,
				showing: sponsorData
			});
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /hide
 * Hide sponsor(s) from displays
 * User-specific config used for display settings
 */
router.post('/hide', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const userId = req.session.userId;
			const { position, all = true } = req.body;
			const state = sponsorService.loadSponsorState(userId);

			// Broadcast hide via WebSocket (multi-tenant)
			if (io) {
				if (userId) {
					io.to(`user:${userId}`).emit('sponsor:hide', { position, all: all || !position });
					console.log(`[WebSocket] User-targeted sponsor:hide to user:${userId}`);
				} else {
					io.emit('sponsor:hide', { position, all: all || !position });
					console.log(`[WebSocket] Global sponsor:hide broadcast`);
				}
			}

			// Also send via HTTP to MagicMirror modules
			const matchEnabled = state.config.displays?.match !== false;
			const bracketEnabled = state.config.displays?.bracket !== false;

			if (matchEnabled && process.env.SPONSOR_MATCH_API_URL) {
				try {
					await axios.post(`${process.env.SPONSOR_MATCH_API_URL}/api/sponsor/hide`, {
						position,
						all: all || !position
					}, { timeout: 5000 });
				} catch (httpError) {
					console.warn(`[Sponsors] HTTP hide to match failed: ${httpError.message}`);
				}
			}

			if (bracketEnabled && process.env.SPONSOR_BRACKET_API_URL) {
				try {
					await axios.post(`${process.env.SPONSOR_BRACKET_API_URL}/api/sponsor/hide`, {
						position,
						all: all || !position
					}, { timeout: 5000 });
				} catch (httpError) {
					console.warn(`[Sponsors] HTTP hide to bracket failed: ${httpError.message}`);
				}
			}

			logger.log('hide:success', { userId, position: position || 'all' });

			res.json({ success: true, message: 'Sponsors hidden' });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

// ============================================
// IMPRESSION TRACKING ROUTES
// ============================================

/**
 * POST /impressions/record
 * Record sponsor impression from display (no auth required for displays)
 * Called by MagicMirror modules when sponsors are shown/hidden
 */
router.post('/impressions/record', async (req, res) => {
	try {
		const {
			sponsorId,
			displayId,
			displayType,
			tournamentId,
			position,
			displayStart,
			displayEnd,
			durationSeconds,
			viewerEstimate
		} = req.body;

		if (!sponsorId) {
			return res.status(400).json({ success: false, error: 'sponsorId is required' });
		}

		const impressionId = systemDb.recordSponsorImpression({
			sponsorId,
			displayId,
			displayType,
			tournamentId,
			position,
			displayStart,
			displayEnd,
			durationSeconds: durationSeconds || 0,
			viewerEstimate: viewerEstimate || 0
		});

		logger.log('impression:recorded', { sponsorId, displayType, durationSeconds });

		res.json({
			success: true,
			impressionId,
			message: 'Impression recorded'
		});
	} catch (error) {
		logger.error('impression:record', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * POST /impressions/start
 * Start tracking an impression (returns ID for later end call)
 */
router.post('/impressions/start', async (req, res) => {
	try {
		const { sponsorId, displayId, displayType, tournamentId, position, viewerEstimate } = req.body;

		if (!sponsorId) {
			return res.status(400).json({ success: false, error: 'sponsorId is required' });
		}

		const impressionId = systemDb.startSponsorImpression({
			sponsorId,
			displayId,
			displayType,
			tournamentId,
			position,
			viewerEstimate
		});

		logger.log('impression:started', { sponsorId, impressionId });

		res.json({
			success: true,
			impressionId
		});
	} catch (error) {
		logger.error('impression:start', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * POST /impressions/:id/end
 * End tracking an impression
 */
router.post('/impressions/:id/end', async (req, res) => {
	try {
		const impressionId = parseInt(req.params.id);

		systemDb.endSponsorImpression(impressionId);

		logger.log('impression:ended', { impressionId });

		res.json({
			success: true,
			message: 'Impression ended'
		});
	} catch (error) {
		logger.error('impression:end', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * GET /impressions/overview
 * Get impression stats for all sponsors (dashboard overview)
 */
router.get('/impressions/overview', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { startDate, endDate } = req.query;

			const stats = systemDb.getAllSponsorImpressionStats({
				startDate,
				endDate
			});

			// Calculate totals
			const totals = stats.reduce((acc, s) => ({
				totalImpressions: acc.totalImpressions + (s.total_impressions || 0),
				totalDuration: acc.totalDuration + (s.total_duration_seconds || 0),
				totalViewerMinutes: acc.totalViewerMinutes + (s.total_viewer_minutes || 0)
			}), { totalImpressions: 0, totalDuration: 0, totalViewerMinutes: 0 });

			res.json({
				success: true,
				sponsors: stats,
				totals: {
					totalImpressions: totals.totalImpressions,
					totalDurationSeconds: totals.totalDuration,
					totalDurationFormatted: formatDuration(totals.totalDuration),
					totalViewerMinutes: totals.totalViewerMinutes
				},
				dateRange: { startDate, endDate }
			});
		} catch (error) {
			logger.error('impressions:overview', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /:id/impressions
 * Get impression stats for a single sponsor
 */
router.get('/:id/impressions', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const sponsorId = req.params.id;
			const { startDate, endDate, limit } = req.query;

			// Get daily stats
			const dailyStats = systemDb.getSponsorImpressionStats(sponsorId, {
				startDate,
				endDate,
				limit: parseInt(limit) || 30
			});

			// Get all-time totals
			const totals = systemDb.getSponsorImpressionTotals(sponsorId);

			res.json({
				success: true,
				sponsorId,
				dailyStats,
				totals: {
					...totals,
					totalDurationFormatted: formatDuration(totals.total_duration_seconds || 0)
				},
				dateRange: { startDate, endDate }
			});
		} catch (error) {
			logger.error('sponsor:impressions', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /:id/impressions/raw
 * Get raw impression records for a sponsor (for detailed reports)
 */
router.get('/:id/impressions/raw', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const sponsorId = req.params.id;
			const { startDate, endDate, limit, offset } = req.query;

			const impressions = systemDb.getSponsorImpressions(sponsorId, {
				startDate,
				endDate,
				limit: parseInt(limit) || 100,
				offset: parseInt(offset) || 0
			});

			res.json({
				success: true,
				sponsorId,
				impressions,
				pagination: {
					limit: parseInt(limit) || 100,
					offset: parseInt(offset) || 0,
					count: impressions.length
				}
			});
		} catch (error) {
			logger.error('sponsor:impressions:raw', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /impressions/cleanup
 * Clean up old impressions (admin only)
 */
router.post('/impressions/cleanup', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { daysToKeep } = req.body;
			const deleted = systemDb.cleanupOldImpressions(daysToKeep || 90);

			logger.log('impressions:cleanup', { daysToKeep: daysToKeep || 90, deleted });

			res.json({
				success: true,
				deleted,
				message: `Deleted ${deleted} old impression records`
			});
		} catch (error) {
			logger.error('impressions:cleanup', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * Helper function to format duration in human readable format
 */
function formatDuration(seconds) {
	if (!seconds || seconds === 0) return '0s';

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	const parts = [];
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

	return parts.join(' ');
}

module.exports = router;
module.exports.init = init;
module.exports.ALLOWED_SPONSOR_EXTENSIONS = ALLOWED_SPONSOR_EXTENSIONS;
module.exports.ALLOWED_SPONSOR_MIMETYPES = ALLOWED_SPONSOR_MIMETYPES;
