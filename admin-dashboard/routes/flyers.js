/**
 * Flyers Routes
 *
 * Handles flyer management: upload, list, delete, preview, and display updates.
 * Supports PNG, JPG, and MP4 files up to 50MB.
 *
 * Multi-tenant support:
 * - Each user has their own flyer directory: FLYERS_PATH/{userId}/
 * - Superadmin (userId 1 + admin role) can see all users' flyers
 * - Regular users only see their own flyers
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const sharp = require('sharp');
const { createLogger } = require('../services/debug-logger');
const { validateBody } = require('../middleware/validation');
const { flyerUpdateSchema } = require('../validation/schemas');

const logger = createLogger('routes:flyers');

// Module dependencies (injected via init)
let axios = null;
let requireAuthAPI = null;
let logActivity = null;
let io = null;

/**
 * Check if user is superadmin (userId 1)
 */
function isSuperadmin(req) {
	if (!req.session || !req.session.userId) return false;
	return req.session.userId === 1;
}

/**
 * Get user-specific flyers directory
 * Creates directory if it doesn't exist
 */
function getUserFlyersDir(userId) {
	if (!userId) return process.env.FLYERS_PATH;
	const userDir = path.join(process.env.FLYERS_PATH, String(userId));
	if (!fsSync.existsSync(userDir)) {
		fsSync.mkdirSync(userDir, { recursive: true });
	}
	return userDir;
}

/**
 * Get all user directories with flyers (for superadmin)
 */
async function getAllUserFlyerDirs() {
	const basePath = process.env.FLYERS_PATH;
	const results = [];

	try {
		const entries = await fs.readdir(basePath, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.isDirectory()) {
				// Check if directory name is a number (userId)
				const userId = parseInt(entry.name, 10);
				if (!isNaN(userId)) {
					results.push({
						userId,
						path: path.join(basePath, entry.name)
					});
				}
			}
		}

		// Also check for legacy flyers in the root directory
		const rootFiles = entries.filter(e => !e.isDirectory());
		if (rootFiles.length > 0) {
			results.push({
				userId: null, // Legacy flyers without owner
				path: basePath,
				isLegacy: true
			});
		}
	} catch (error) {
		logger.error('getAllUserFlyerDirs', error);
	}

	return results;
}

// WebSocket event types
const WS_EVENTS = {
	FLYER_UPLOADED: 'flyer:uploaded',
	FLYER_DELETED: 'flyer:deleted',
	FLYER_ACTIVATED: 'flyer:activated'
};

/**
 * Broadcast flyer event via WebSocket
 */
function broadcastFlyer(eventType, data = {}) {
	if (io) {
		io.emit(eventType, data);
		io.emit('flyers:update', { action: eventType, ...data });
	}
}

// Allowed file types for flyers
const ALLOWED_FLYER_MIMETYPES = ['image/png', 'image/jpeg', 'video/mp4'];
const ALLOWED_FLYER_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.mp4'];

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

const upload = multer({
	storage: storage,
	limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit (for videos)
	fileFilter: (req, file, cb) => {
		if (ALLOWED_FLYER_MIMETYPES.includes(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new Error('Only PNG, JPG, and MP4 files are allowed'));
		}
	}
});

// Image optimization constants
const IMAGE_MAX_WIDTH = 1920;
const IMAGE_MAX_HEIGHT = 1080;
const JPEG_QUALITY = 85;
const PNG_COMPRESSION = 9;

/**
 * Optimize image by resizing and compressing
 * @param {string} inputPath - Path to source image
 * @param {string} outputPath - Path to write optimized image
 * @returns {Promise<{originalDimensions: string, optimized: boolean, originalSize: number, newSize: number}>}
 */
async function optimizeImage(inputPath, outputPath) {
	const inputStats = await fs.stat(inputPath);
	const metadata = await sharp(inputPath).metadata();

	const needsResize = metadata.width > IMAGE_MAX_WIDTH || metadata.height > IMAGE_MAX_HEIGHT;

	let pipeline = sharp(inputPath).rotate(); // Auto-orient based on EXIF

	if (needsResize) {
		pipeline = pipeline.resize(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, {
			fit: 'inside',
			withoutEnlargement: true
		});
	}

	// Apply format-specific optimization
	if (outputPath.match(/\.jpe?g$/i)) {
		pipeline = pipeline.jpeg({ quality: JPEG_QUALITY });
	} else if (outputPath.match(/\.png$/i)) {
		pipeline = pipeline.png({ compressionLevel: PNG_COMPRESSION });
	}

	await pipeline.toFile(outputPath);

	const outputStats = await fs.stat(outputPath);

	return {
		originalDimensions: `${metadata.width}x${metadata.height}`,
		optimized: needsResize,
		originalSize: inputStats.size,
		newSize: outputStats.size
	};
}

/**
 * Initialize route dependencies
 * @param {Object} deps - Dependencies object
 */
function init(deps) {
	axios = deps.axios;
	requireAuthAPI = deps.requireAuthAPI;
	logActivity = deps.logActivity || (() => {});
	io = deps.io;
}

// ============================================
// PUBLIC ROUTES (no authentication required)
// ============================================

/**
 * GET /preview/:userId/:filename
 * Serve flyer image/video for preview (user-specific path)
 * Public route - no authentication required
 */
router.get('/preview/:userId/:filename', async (req, res) => {
	try {
		const { userId, filename } = req.params;

		// Security check - prevent path traversal
		if (filename.includes('..') || filename.includes('/')) {
			return res.status(400).json({
				success: false,
				error: 'Invalid filename'
			});
		}

		// Validate userId is a number
		const userIdNum = parseInt(userId, 10);
		if (isNaN(userIdNum)) {
			return res.status(400).json({
				success: false,
				error: 'Invalid user ID'
			});
		}

		const filePath = path.join(process.env.FLYERS_PATH, String(userIdNum), filename);

		// Check if file exists
		try {
			await fs.access(filePath);
		} catch {
			return res.status(404).json({
				success: false,
				error: 'Flyer not found'
			});
		}

		res.sendFile(filePath);
	} catch (error) {
		res.status(500).json({
			success: false,
			error: 'Failed to serve flyer preview'
		});
	}
});

/**
 * GET /preview/:filename
 * Serve flyer image/video for preview (legacy path - root directory)
 * Public route - no authentication required
 */
router.get('/preview/:filename', async (req, res) => {
	try {
		const filename = req.params.filename;

		// Security check - prevent path traversal
		if (filename.includes('..') || filename.includes('/')) {
			return res.status(400).json({
				success: false,
				error: 'Invalid filename'
			});
		}

		const filePath = path.join(process.env.FLYERS_PATH, filename);

		// Check if file exists
		try {
			await fs.access(filePath);
		} catch {
			return res.status(404).json({
				success: false,
				error: 'Flyer not found'
			});
		}

		res.sendFile(filePath);
	} catch (error) {
		res.status(500).json({
			success: false,
			error: 'Failed to serve flyer preview'
		});
	}
});

// ============================================
// PROTECTED ROUTES (authentication required)
// ============================================

// Apply auth middleware to all routes below
router.use((req, res, next) => {
	// Skip auth for preview route (handled above)
	if (req.path.startsWith('/preview/')) {
		return next();
	}
	requireAuthAPI(req, res, next);
});

/**
 * GET /
 * List available flyers
 * - Regular users see only their own flyers
 * - Superadmin sees all users' flyers with ownerId field
 */
router.get('/', async (req, res) => {
	try {
		const userId = req.session.userId;
		const superadmin = isSuperadmin(req);

		if (superadmin) {
			// Superadmin sees all flyers from all users
			const userDirs = await getAllUserFlyerDirs();
			const allFlyers = [];

			for (const dir of userDirs) {
				try {
					const files = await fs.readdir(dir.path);

					// Filter out subdirectories (only process root-level flyers in legacy mode)
					const flyerFiles = [];
					for (const file of files) {
						const filePath = path.join(dir.path, file);
						const stat = await fs.stat(filePath);
						if (!stat.isDirectory()) {
							const ext = path.extname(file).toLowerCase();
							if (ALLOWED_FLYER_EXTENSIONS.includes(ext)) {
								flyerFiles.push({
									filename: file,
									size: stat.size,
									modified: stat.mtime,
									type: ext === '.mp4' ? 'video' : 'image',
									ownerId: dir.userId,
									isLegacy: dir.isLegacy || false
								});
							}
						}
					}

					allFlyers.push(...flyerFiles);
				} catch (error) {
					logger.warn('list-flyers-dir', { userId: dir.userId, error: error.message });
				}
			}

			res.json({
				success: true,
				flyers: allFlyers,
				currentUserId: userId,
				isSuperadmin: true
			});
		} else {
			// Regular user sees only their own flyers
			const userFlyersPath = getUserFlyersDir(userId);
			let files = [];

			try {
				files = await fs.readdir(userFlyersPath);
			} catch (error) {
				// Directory doesn't exist yet, return empty array
				if (error.code !== 'ENOENT') {
					throw error;
				}
			}

			const flyers = await Promise.all(
				files
					.filter(file => {
						const ext = path.extname(file).toLowerCase();
						return ALLOWED_FLYER_EXTENSIONS.includes(ext);
					})
					.map(async (file) => {
						const stats = await fs.stat(path.join(userFlyersPath, file));
						const ext = path.extname(file).toLowerCase();
						return {
							filename: file,
							size: stats.size,
							modified: stats.mtime,
							type: ext === '.mp4' ? 'video' : 'image',
							ownerId: userId
						};
					})
			);

			res.json({
				success: true,
				flyers: flyers,
				currentUserId: userId,
				isSuperadmin: false
			});
		}
	} catch (error) {
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * POST /upload
 * Upload a new flyer to user-specific directory
 */
router.post('/upload', upload.single('flyer'), async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({
				success: false,
				error: 'No file uploaded'
			});
		}

		const userId = req.session.userId;

		// Get the original file extension
		const originalExt = path.extname(req.file.originalname).toLowerCase();
		const customName = req.body.customName;

		let finalName;
		if (customName) {
			// If custom name provided, ensure it has the correct extension
			const customExt = path.extname(customName).toLowerCase();
			if (ALLOWED_FLYER_EXTENSIONS.includes(customExt)) {
				finalName = customName;
			} else {
				// Add the original file's extension
				finalName = customName + originalExt;
			}
		} else {
			// Use original filename
			finalName = req.file.originalname;
		}

		const tempPath = req.file.path;
		// Save to user-specific directory
		const userFlyersDir = getUserFlyersDir(userId);
		const targetPath = path.join(userFlyersDir, finalName);
		const isVideo = originalExt === '.mp4';
		let optimizationResult = null;

		// Optimize images (skip videos)
		if (!isVideo) {
			try {
				optimizationResult = await optimizeImage(tempPath, targetPath);
				// Remove temp file since sharp wrote directly to target
				await fs.unlink(tempPath).catch(() => {});

				if (optimizationResult.optimized) {
					logger.info('image-optimized', {
						filename: finalName,
						userId: userId,
						originalDimensions: optimizationResult.originalDimensions,
						originalSize: optimizationResult.originalSize,
						newSize: optimizationResult.newSize,
						reduction: Math.round((1 - optimizationResult.newSize / optimizationResult.originalSize) * 100) + '%'
					});
				}
			} catch (optError) {
				logger.warn('optimization-skipped', optError, { filename: finalName, userId });
				// Fallback: just move the file without optimization
				await fs.rename(tempPath, targetPath);
			}
		} else {
			// Videos: move without processing
			await fs.rename(tempPath, targetPath);
		}

		// Log activity
		if (logActivity) {
			logActivity(req.session?.userId, req.session?.username || 'system', 'flyer_upload', {
				filename: finalName,
				userId: userId,
				type: isVideo ? 'video' : 'image',
				optimized: optimizationResult?.optimized || false
			});
		}

		// Broadcast upload
		broadcastFlyer(WS_EVENTS.FLYER_UPLOADED, {
			filename: finalName,
			ownerId: userId,
			type: isVideo ? 'video' : 'image'
		});

		res.json({
			success: true,
			message: 'Flyer uploaded successfully',
			filename: finalName,
			ownerId: userId,
			type: isVideo ? 'video' : 'image',
			optimized: optimizationResult?.optimized || false
		});
	} catch (error) {
		logger.error('upload', error, { filename: req.file?.originalname });
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * DELETE /:filename
 * Delete a flyer from user's own directory
 * Superadmin can delete from any user's directory using ownerId query param
 */
router.delete('/:filename', async (req, res) => {
	try {
		const filename = req.params.filename;
		const userId = req.session.userId;
		const superadmin = isSuperadmin(req);

		// Security check - prevent path traversal
		if (filename.includes('..') || filename.includes('/')) {
			return res.status(400).json({
				success: false,
				error: 'Invalid filename'
			});
		}

		// Determine which user's directory to delete from
		let targetUserId = userId;
		if (superadmin && req.query.ownerId) {
			targetUserId = parseInt(req.query.ownerId, 10);
			if (isNaN(targetUserId)) {
				// Check for legacy (null ownerId)
				if (req.query.ownerId === 'null' || req.query.ownerId === 'legacy') {
					targetUserId = null;
				}
			}
		}

		// Construct file path
		let filePath;
		if (targetUserId === null) {
			// Legacy flyer in root directory
			filePath = path.join(process.env.FLYERS_PATH, filename);
		} else {
			filePath = path.join(process.env.FLYERS_PATH, String(targetUserId), filename);
		}

		// Check if file exists
		try {
			await fs.access(filePath);
		} catch {
			return res.status(404).json({
				success: false,
				error: 'Flyer not found'
			});
		}

		await fs.unlink(filePath);

		// Log activity
		if (logActivity) {
			logActivity(req.session?.userId, req.session?.username || 'system', 'flyer_delete', {
				filename: filename,
				ownerId: targetUserId
			});
		}

		// Broadcast deletion
		broadcastFlyer(WS_EVENTS.FLYER_DELETED, { filename, ownerId: targetUserId });

		res.json({
			success: true,
			message: 'Flyer deleted successfully'
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * POST /update (mounted at /api/flyer/update in server.js)
 * Update the active flyer on the display
 * Note: This route uses singular "flyer" path in the API
 *
 * Updated for standalone flyer-display service:
 * - No longer sends HTTP POST to port 2054
 * - Uses WebSocket only for real-time updates
 */
router.post('/update',
	validateBody(flyerUpdateSchema),
	async (req, res) => {
	const validatedData = req.validatedBody || req.body;
	const { filename: flyer, isVideo } = validatedData;
	const userId = req.session?.userId;

	// Flyer filename already validated by schema

	try {
		// Broadcast to user-specific flyer room (WebSocket only, no HTTP to port 2054)
		if (io && userId) {
			io.to(`user:${userId}:flyer`).emit('flyer:activated', {
				flyer,
				userId,
				timestamp: new Date().toISOString()
			});
			logger.info('flyerActivated', { flyer, userId, room: `user:${userId}:flyer` });
		}

		// General broadcast for admin dashboard updates
		broadcastFlyer(WS_EVENTS.FLYER_ACTIVATED, { flyer, userId });

		// Log activity
		if (logActivity) {
			logActivity(req.session?.userId, req.session?.username || 'system', 'flyer_set_active', {
				flyer: flyer,
				userId: userId
			});
		}

		res.json({
			success: true,
			message: 'Flyer display updated successfully',
			flyer: flyer,
			userId: userId
		});
	} catch (error) {
		logger.error('setActive', error, { flyer, userId });
		res.status(500).json({
			success: false,
			error: 'Failed to update flyer display',
			details: error.message
		});
	}
});

module.exports = router;
module.exports.init = init;
module.exports.ALLOWED_FLYER_EXTENSIONS = ALLOWED_FLYER_EXTENSIONS;
module.exports.ALLOWED_FLYER_MIMETYPES = ALLOWED_FLYER_MIMETYPES;
