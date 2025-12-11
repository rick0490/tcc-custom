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

// Module dependencies (injected via init)
let axios = null;
let io = null;
let requireAuthAPI = null;
let sponsorService = null;
let logActivity = null;

// File paths
const SPONSORS_DIR = path.join(__dirname, '..', 'sponsors');

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
 * GET /preview/:filename
 * Serve sponsor logo for preview
 * Public route - no authentication required
 */
router.get('/preview/:filename', async (req, res) => {
	try {
		const filename = decodeURIComponent(req.params.filename);

		// Security check
		if (filename.includes('..') || filename.includes('/')) {
			return res.status(400).json({ error: 'Invalid filename' });
		}

		const filePath = path.join(SPONSORS_DIR, filename);
		res.sendFile(filePath);
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
 */
router.get('/', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const state = sponsorService.loadSponsorState();

			// Add file stats to each sponsor
			const sponsorsWithStats = await Promise.all(
				state.sponsors.map(async (sponsor) => {
					try {
						const filePath = path.join(SPONSORS_DIR, sponsor.filename);
						const stats = await fs.stat(filePath);
						return {
							...sponsor,
							fileSize: stats.size,
							modified: stats.mtime
						};
					} catch {
						return { ...sponsor, fileSize: 0, modified: null };
					}
				})
			);

			res.json({
				success: true,
				sponsors: sponsorsWithStats,
				config: state.config,
				lastUpdated: state.lastUpdated
			});
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /:id
 * Get single sponsor
 */
router.get('/:id', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const state = sponsorService.loadSponsorState();
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

		// Move file to sponsors directory
		const targetPath = path.join(SPONSORS_DIR, finalName);
		await fs.rename(req.file.path, targetPath);

		// Create sponsor entry
		const state = sponsorService.loadSponsorState();
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
		sponsorService.saveSponsorState(state);

		// Restart rotation if enabled
		if (state.config.enabled && state.config.rotationEnabled) {
			sponsorService.startSponsorRotation();
		}

		console.log(`[Sponsors] Uploaded: ${name} (${finalName}) at ${position}`);

		res.json({
			success: true,
			message: 'Sponsor uploaded successfully',
			sponsor: newSponsor
		});
	} catch (error) {
		console.error('[Sponsors] Upload error:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * PUT /:id
 * Update sponsor metadata
 */
router.put('/:id', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const state = sponsorService.loadSponsorState();
			const index = state.sponsors.findIndex(s => s.id === req.params.id);

			if (index === -1) {
				return res.status(404).json({ success: false, error: 'Sponsor not found' });
			}

			const { name, position, type, size, opacity, borderRadius, offsetX, offsetY, active } = req.body;
			const sponsor = state.sponsors[index];

			console.log(`[Sponsors] PUT /${req.params.id} - Received:`, { offsetX, offsetY, typeOfOffsetX: typeof offsetX, typeOfOffsetY: typeof offsetY });

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
			sponsorService.saveSponsorState(state);

			// Restart rotation if config changed
			if (state.config.enabled && state.config.rotationEnabled) {
				sponsorService.startSponsorRotation();
			}

			// Broadcast update
			if (io) {
				io.emit('sponsor:update', { sponsors: state.sponsors });
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
 */
router.delete('/:id', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const state = sponsorService.loadSponsorState();
			const index = state.sponsors.findIndex(s => s.id === req.params.id);

			if (index === -1) {
				return res.status(404).json({ success: false, error: 'Sponsor not found' });
			}

			const sponsor = state.sponsors[index];

			// Delete the file
			try {
				await fs.unlink(path.join(SPONSORS_DIR, sponsor.filename));
			} catch (fileError) {
				console.warn(`[Sponsors] Could not delete file: ${sponsor.filename}`);
			}

			// Remove from state
			state.sponsors.splice(index, 1);
			sponsorService.saveSponsorState(state);

			// Restart rotation
			if (state.config.enabled && state.config.rotationEnabled) {
				sponsorService.startSponsorRotation();
			}

			// Broadcast update
			if (io) {
				io.emit('sponsor:update', { sponsors: state.sponsors });
			}

			console.log(`[Sponsors] Deleted: ${sponsor.name}`);

			res.json({ success: true, message: 'Sponsor deleted successfully' });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /reorder
 * Reorder sponsors
 */
router.post('/reorder', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { order } = req.body; // Array of { id, order }

			if (!Array.isArray(order)) {
				return res.status(400).json({ success: false, error: 'Order must be an array' });
			}

			const state = sponsorService.loadSponsorState();

			order.forEach(({ id, order: newOrder }) => {
				const sponsor = state.sponsors.find(s => s.id === id);
				if (sponsor) {
					sponsor.order = newOrder;
					sponsor.updatedAt = new Date().toISOString();
				}
			});

			sponsorService.saveSponsorState(state);

			// Restart rotation with new order
			if (state.config.enabled && state.config.rotationEnabled) {
				sponsorService.startSponsorRotation();
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
 */
router.get('/config', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const state = sponsorService.loadSponsorState();
			res.json({ success: true, config: state.config });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /config
 * Update sponsor config
 */
router.post('/config', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const state = sponsorService.loadSponsorState();
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

			sponsorService.saveSponsorState(state);

			// Update timers - Timer View takes priority over rotation
			if (state.config.enabled && state.config.timerViewEnabled) {
				sponsorService.stopSponsorRotation();
				sponsorService.startSponsorTimerView();
			} else if (state.config.enabled && state.config.rotationEnabled) {
				sponsorService.stopSponsorTimerView();
				sponsorService.startSponsorRotation();
			} else {
				sponsorService.stopSponsorTimerView();
				sponsorService.stopSponsorRotation();
			}

			// Broadcast config update
			if (io) {
				io.emit('sponsor:config', { config: state.config });
			}

			console.log(`[Sponsors] Config updated: enabled=${state.config.enabled}, rotation=${state.config.rotationEnabled}, timerView=${state.config.timerViewEnabled}`);

			res.json({ success: true, config: state.config });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * POST /show
 * Show sponsor(s) on displays
 */
router.post('/show', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { sponsorId, position, all, duration = 0 } = req.body;
			const state = sponsorService.loadSponsorState();

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

			// Format sponsors for display
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
					active: true
				};
			});

			// Broadcast via WebSocket
			if (io) {
				io.emit('sponsor:show', {
					sponsors: sponsorData,
					duration: duration > 0 ? Math.min(Math.max(duration, 10), 3600) : 0
				});
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

			console.log(`[Sponsors] Showing ${Object.keys(sponsorData).length} sponsor(s)`);

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
 */
router.post('/hide', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { position, all = true } = req.body;
			const state = sponsorService.loadSponsorState();

			// Broadcast hide via WebSocket
			if (io) {
				io.emit('sponsor:hide', { position, all: all || !position });
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

			console.log(`[Sponsors] Hidden: ${position || 'all'}`);

			res.json({ success: true, message: 'Sponsors hidden' });
		} catch (error) {
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

module.exports = router;
module.exports.init = init;
module.exports.ALLOWED_SPONSOR_EXTENSIONS = ALLOWED_SPONSOR_EXTENSIONS;
module.exports.ALLOWED_SPONSOR_MIMETYPES = ALLOWED_SPONSOR_MIMETYPES;
