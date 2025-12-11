/**
 * Flyers Routes
 *
 * Handles flyer management: upload, list, delete, preview, and display updates.
 * Supports PNG, JPG, and MP4 files up to 50MB.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Module dependencies (injected via init)
let axios = null;
let requireAuthAPI = null;
let logActivity = null;

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

/**
 * Initialize route dependencies
 * @param {Object} deps - Dependencies object
 */
function init(deps) {
	axios = deps.axios;
	requireAuthAPI = deps.requireAuthAPI;
	logActivity = deps.logActivity || (() => {});
}

// ============================================
// PUBLIC ROUTES (no authentication required)
// ============================================

/**
 * GET /preview/:filename
 * Serve flyer image/video for preview
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
 */
router.get('/', async (req, res) => {
	try {
		const flyersPath = process.env.FLYERS_PATH;
		const files = await fs.readdir(flyersPath);

		const flyers = await Promise.all(
			files
				.filter(file => {
					const ext = path.extname(file).toLowerCase();
					return ALLOWED_FLYER_EXTENSIONS.includes(ext);
				})
				.map(async (file) => {
					const stats = await fs.stat(path.join(flyersPath, file));
					const ext = path.extname(file).toLowerCase();
					return {
						filename: file,
						size: stats.size,
						modified: stats.mtime,
						type: ext === '.mp4' ? 'video' : 'image'
					};
				})
		);

		res.json({
			success: true,
			flyers: flyers
		});
	} catch (error) {
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * POST /upload
 * Upload a new flyer
 */
router.post('/upload', upload.single('flyer'), async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({
				success: false,
				error: 'No file uploaded'
			});
		}

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
		const targetPath = path.join(process.env.FLYERS_PATH, finalName);

		// Move file from uploads to flyers directory
		await fs.rename(tempPath, targetPath);

		// Log activity
		if (logActivity) {
			logActivity('flyer_upload', req.session?.username || 'system', {
				filename: finalName,
				type: originalExt === '.mp4' ? 'video' : 'image'
			});
		}

		res.json({
			success: true,
			message: 'Flyer uploaded successfully',
			filename: finalName,
			type: originalExt === '.mp4' ? 'video' : 'image'
		});
	} catch (error) {
		console.error('Upload error:', error);
		res.status(500).json({
			success: false,
			error: error.message
		});
	}
});

/**
 * DELETE /:filename
 * Delete a flyer
 */
router.delete('/:filename', async (req, res) => {
	try {
		const filename = req.params.filename;
		const filePath = path.join(process.env.FLYERS_PATH, filename);

		// Security check - prevent path traversal
		if (filename.includes('..') || filename.includes('/')) {
			return res.status(400).json({
				success: false,
				error: 'Invalid filename'
			});
		}

		await fs.unlink(filePath);

		// Log activity
		if (logActivity) {
			logActivity('flyer_delete', req.session?.username || 'system', {
				filename: filename
			});
		}

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
 */
router.post('/update', async (req, res) => {
	const { flyer } = req.body;

	// Validation
	if (!flyer) {
		return res.status(400).json({
			success: false,
			error: 'Flyer filename is required'
		});
	}

	try {
		// Send only to flyer module
		const flyerResponse = await axios.post(
			`${process.env.FLYER_API_URL}/api/flyer/update`,
			{ flyer: flyer },
			{ timeout: 5000 }
		);

		// Log activity
		if (logActivity) {
			logActivity('flyer_set_active', req.session?.username || 'system', {
				flyer: flyer
			});
		}

		res.json({
			success: true,
			message: 'Flyer display updated successfully',
			result: flyerResponse.data,
			flyer: flyer
		});
	} catch (error) {
		console.error('Flyer update error:', error.message);
		res.status(500).json({
			success: false,
			error: 'Failed to update flyer display',
			details: error.response ? error.response.data : error.message
		});
	}
});

module.exports = router;
module.exports.init = init;
module.exports.ALLOWED_FLYER_EXTENSIONS = ALLOWED_FLYER_EXTENSIONS;
module.exports.ALLOWED_FLYER_MIMETYPES = ALLOWED_FLYER_MIMETYPES;
