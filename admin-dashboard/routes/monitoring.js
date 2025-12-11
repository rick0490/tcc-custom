/**
 * Monitoring Routes
 *
 * System monitoring API endpoints (admin only).
 * Extracted from server.js for modularity.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { requireAuthAPI, requireAdmin } = require('../middleware/auth');
const activityLogger = require('../services/activity-logger');

// Reference to system monitor (set by init)
let systemMonitor = null;

/**
 * Initialize the monitoring routes with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.systemMonitor - System monitor module
 */
function init({ systemMonitor: monitor }) {
	systemMonitor = monitor;
}

// ============================================
// SYSTEM MONITORING API ENDPOINTS (ADMIN ONLY)
// ============================================

/**
 * POST /api/monitoring/start
 * Start monitoring session
 */
router.post('/start', requireAuthAPI, requireAdmin, async (req, res) => {
	const { durationMinutes = 5 } = req.body;

	// Validate duration (1-120 minutes)
	const duration = Math.min(Math.max(parseInt(durationMinutes) || 5, 1), 120);
	const durationMs = duration * 60 * 1000;

	const result = systemMonitor.startMonitoring(durationMs);

	if (result.success) {
		activityLogger.logActivity(
			req.session.userId,
			req.session.username,
			'monitoring_started',
			{ sessionId: result.sessionId, durationMinutes: duration }
		);
	}

	res.json(result);
});

/**
 * POST /api/monitoring/stop
 * Stop monitoring session
 */
router.post('/stop', requireAuthAPI, requireAdmin, async (req, res) => {
	const result = systemMonitor.stopMonitoring();

	if (result.success) {
		activityLogger.logActivity(
			req.session.userId,
			req.session.username,
			'monitoring_stopped',
			{ sessionId: result.sessionId, samplesCollected: result.samplesCollected }
		);
	}

	res.json(result);
});

/**
 * GET /api/monitoring/status
 * Get monitoring status
 */
router.get('/status', requireAuthAPI, requireAdmin, (req, res) => {
	const status = systemMonitor.getMonitoringStatus();
	res.json({ success: true, ...status });
});

/**
 * GET /api/monitoring/report
 * Generate and get monitoring report
 */
router.get('/report', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const result = await systemMonitor.generateCurrentReport();

		if (result.error) {
			return res.status(400).json({ success: false, error: result.error });
		}

		activityLogger.logActivity(
			req.session.userId,
			req.session.username,
			'monitoring_report_generated',
			{ savedTo: result.savedTo }
		);

		res.json(result);
	} catch (error) {
		console.error('Error generating monitoring report:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * GET /api/monitoring/quick-check
 * Run quick system check (no persistent monitoring)
 */
router.get('/quick-check', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const result = await systemMonitor.runQuickCheck();

		activityLogger.logActivity(
			req.session.userId,
			req.session.username,
			'quick_system_check',
			{ issueCount: result.report?.issuesForDebugging?.length || 0 }
		);

		res.json(result);
	} catch (error) {
		console.error('Error running quick check:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * GET /api/monitoring/logs
 * Get service logs for debugging
 */
router.get('/logs', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const logs = await systemMonitor.getServiceLogs();
		res.json({ success: true, logs });
	} catch (error) {
		console.error('Error getting service logs:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * GET /api/monitoring/reports
 * List saved monitoring reports
 */
router.get('/reports', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const reportsDir = systemMonitor.CONFIG.reportDir;

		// Create directory if it doesn't exist
		try {
			await fs.mkdir(reportsDir, { recursive: true });
		} catch (e) {
			// Directory may already exist
		}

		const files = await fs.readdir(reportsDir);
		const reports = [];

		for (const file of files) {
			if (file.endsWith('.json')) {
				const stat = await fs.stat(path.join(reportsDir, file));
				reports.push({
					filename: file,
					createdAt: stat.mtime.toISOString(),
					sizeBytes: stat.size
				});
			}
		}

		// Sort by date descending (newest first)
		reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

		res.json({ success: true, reports });
	} catch (error) {
		console.error('Error listing reports:', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * GET /api/monitoring/reports/:filename
 * Get a specific saved report
 */
router.get('/reports/:filename', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const { filename } = req.params;

		// Validate filename to prevent directory traversal
		if (!filename.match(/^monitoring-report-[\d-TZ]+\.json$/)) {
			return res.status(400).json({ success: false, error: 'Invalid filename' });
		}

		const filepath = path.join(systemMonitor.CONFIG.reportDir, filename);
		const content = await fs.readFile(filepath, 'utf8');
		const report = JSON.parse(content);

		res.json({ success: true, report });
	} catch (error) {
		if (error.code === 'ENOENT') {
			res.status(404).json({ success: false, error: 'Report not found' });
		} else {
			console.error('Error reading report:', error);
			res.status(500).json({ success: false, error: error.message });
		}
	}
});

/**
 * DELETE /api/monitoring/reports/:filename
 * Delete a saved report
 */
router.delete('/reports/:filename', requireAuthAPI, requireAdmin, async (req, res) => {
	try {
		const { filename } = req.params;

		// Validate filename to prevent directory traversal
		if (!filename.match(/^monitoring-report-[\d-TZ]+\.json$/)) {
			return res.status(400).json({ success: false, error: 'Invalid filename' });
		}

		const filepath = path.join(systemMonitor.CONFIG.reportDir, filename);
		await fs.unlink(filepath);

		activityLogger.logActivity(
			req.session.userId,
			req.session.username,
			'monitoring_report_deleted',
			{ filename }
		);

		res.json({ success: true, message: 'Report deleted' });
	} catch (error) {
		if (error.code === 'ENOENT') {
			res.status(404).json({ success: false, error: 'Report not found' });
		} else {
			console.error('Error deleting report:', error);
			res.status(500).json({ success: false, error: error.message });
		}
	}
});

module.exports = router;
module.exports.init = init;
