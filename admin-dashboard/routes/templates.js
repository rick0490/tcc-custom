/**
 * Templates Routes
 *
 * Tournament templates API endpoints.
 * Extracted from server.js for modularity.
 */

const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../middleware/auth');
const activityLogger = require('../services/activity-logger');
const { createLogger } = require('../services/debug-logger');

const logger = createLogger('routes:templates');

// Reference to analytics database (set by init)
let analyticsDb = null;

/**
 * Initialize the templates routes with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.analyticsDb - Analytics database instance
 */
function init({ analyticsDb: db }) {
	analyticsDb = db;
}

// ============================================
// TOURNAMENT TEMPLATES API ROUTES
// ============================================

/**
 * GET /api/templates
 * Get all templates
 */
router.get('/', requireAuthAPI, (req, res) => {
	try {
		const { game } = req.query;
		const templates = analyticsDb.getAllTemplates({ gameName: game || null });
		res.json({ success: true, templates });
	} catch (error) {
		logger.error('list', error);
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * GET /api/templates/:id
 * Get template by ID
 */
router.get('/:id', requireAuthAPI, (req, res) => {
	try {
		const templateId = parseInt(req.params.id);
		const template = analyticsDb.getTemplateById(templateId);
		if (!template) {
			return res.status(404).json({ success: false, error: 'Template not found' });
		}
		res.json({ success: true, template });
	} catch (error) {
		logger.error('get', error, { templateId: req.params.id });
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * POST /api/templates
 * Create new template
 */
router.post('/', requireAuthAPI, (req, res) => {
	try {
		const { name, description, gameName, settings } = req.body;

		if (!name || !name.trim()) {
			return res.status(400).json({ success: false, error: 'Template name is required' });
		}
		if (!settings || typeof settings !== 'object') {
			return res.status(400).json({ success: false, error: 'Settings object is required' });
		}

		const template = analyticsDb.createTemplate(
			name.trim(),
			description || '',
			gameName || '',
			settings,
			req.session.username || 'admin'
		);

		activityLogger.logActivity(req.session.userId, req.session.username, 'template_created', {
			templateId: template.id,
			templateName: template.name
		});

		res.json({ success: true, template, message: 'Template created successfully' });
	} catch (error) {
		logger.error('create', error);
		if (error.message.includes('UNIQUE constraint')) {
			return res.status(400).json({ success: false, error: 'A template with this name already exists' });
		}
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * PUT /api/templates/:id
 * Update template
 */
router.put('/:id', requireAuthAPI, (req, res) => {
	try {
		const templateId = parseInt(req.params.id);
		const updates = req.body;

		const template = analyticsDb.updateTemplate(templateId, updates);
		if (!template) {
			return res.status(404).json({ success: false, error: 'Template not found' });
		}

		activityLogger.logActivity(req.session.userId, req.session.username, 'template_updated', {
			templateId: template.id,
			templateName: template.name
		});

		res.json({ success: true, template, message: 'Template updated successfully' });
	} catch (error) {
		logger.error('update', error, { templateId: req.params.id });
		if (error.message.includes('UNIQUE constraint')) {
			return res.status(400).json({ success: false, error: 'A template with this name already exists' });
		}
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * DELETE /api/templates/:id
 * Delete template
 */
router.delete('/:id', requireAuthAPI, (req, res) => {
	try {
		const templateId = parseInt(req.params.id);
		const template = analyticsDb.getTemplateById(templateId);

		if (!template) {
			return res.status(404).json({ success: false, error: 'Template not found' });
		}

		const deleted = analyticsDb.deleteTemplate(templateId);
		if (!deleted) {
			return res.status(400).json({ success: false, error: 'Could not delete template' });
		}

		activityLogger.logActivity(req.session.userId, req.session.username, 'template_deleted', {
			templateId: templateId,
			templateName: template.name
		});

		res.json({ success: true, message: 'Template deleted successfully' });
	} catch (error) {
		logger.error('delete', error, { templateId: req.params.id });
		if (error.message.includes('Cannot delete default template')) {
			return res.status(400).json({ success: false, error: 'Cannot delete the default template' });
		}
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * POST /api/templates/from-tournament
 * Create template from tournament data
 */
router.post('/from-tournament', requireAuthAPI, (req, res) => {
	try {
		const { tournamentData, templateName, description } = req.body;

		if (!templateName || !templateName.trim()) {
			return res.status(400).json({ success: false, error: 'Template name is required' });
		}
		if (!tournamentData || typeof tournamentData !== 'object') {
			return res.status(400).json({ success: false, error: 'Tournament data is required' });
		}

		const template = analyticsDb.createTemplateFromTournament(
			tournamentData,
			templateName.trim(),
			description || '',
			req.session.username || 'admin'
		);

		activityLogger.logActivity(req.session.userId, req.session.username, 'template_created_from_tournament', {
			templateId: template.id,
			templateName: template.name
		});

		res.json({ success: true, template, message: 'Template created from tournament successfully' });
	} catch (error) {
		logger.error('createFromTournament', error);
		if (error.message.includes('UNIQUE constraint')) {
			return res.status(400).json({ success: false, error: 'A template with this name already exists' });
		}
		res.status(500).json({ success: false, error: error.message });
	}
});

module.exports = router;
module.exports.init = init;
