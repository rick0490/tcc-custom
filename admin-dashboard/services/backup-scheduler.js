/**
 * Backup Scheduler Service
 *
 * Background service for automated database backups with cron scheduling,
 * retention policies, and history tracking.
 *
 * Phase 2 Feature: Automated Backup System
 */

const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

// Reference to system database (set by init)
let systemDb = null;

// Reference to database paths (set by init)
let dbPaths = {};

// Backup directory
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// Active cron jobs (Map of scheduleId -> cronJob)
const activeJobs = new Map();

// Scheduler state
let schedulerState = {
	isRunning: false,
	lastCheck: null,
	errors: []
};

/**
 * Initialize the backup scheduler with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.systemDb - System database instance
 * @param {Object} options.dbPaths - Database paths object
 */
function init({ systemDb: db, dbPaths: paths }) {
	systemDb = db;
	dbPaths = paths || {};
	console.log('[BackupScheduler] Initialized');

	// Ensure backup directory exists
	if (!fs.existsSync(BACKUP_DIR)) {
		fs.mkdirSync(BACKUP_DIR, { recursive: true });
	}
}

/**
 * Start the backup scheduler
 * Loads all enabled schedules and sets up cron jobs
 */
function startScheduler() {
	if (schedulerState.isRunning) {
		return { success: false, error: 'Scheduler already running' };
	}

	console.log('[BackupScheduler] Starting scheduler');

	try {
		// Load all enabled schedules
		const schedules = systemDb.getBackupSchedules();
		const enabledSchedules = schedules.filter(s => s.enabled);

		// Set up cron jobs for each schedule
		for (const schedule of enabledSchedules) {
			setupCronJob(schedule);
		}

		schedulerState.isRunning = true;
		schedulerState.lastCheck = new Date().toISOString();
		schedulerState.errors = [];

		console.log(`[BackupScheduler] Started with ${enabledSchedules.length} active schedules`);

		return {
			success: true,
			activeSchedules: enabledSchedules.length,
			startedAt: new Date().toISOString()
		};
	} catch (error) {
		console.error('[BackupScheduler] Failed to start:', error.message);
		return { success: false, error: error.message };
	}
}

/**
 * Stop the backup scheduler
 * Cancels all active cron jobs
 */
function stopScheduler() {
	if (!schedulerState.isRunning) {
		return { success: false, error: 'Scheduler not running' };
	}

	console.log('[BackupScheduler] Stopping scheduler');

	// Stop all cron jobs
	for (const [scheduleId, job] of activeJobs) {
		job.stop();
		console.log(`[BackupScheduler] Stopped job for schedule ${scheduleId}`);
	}
	activeJobs.clear();

	schedulerState.isRunning = false;

	return {
		success: true,
		stoppedAt: new Date().toISOString()
	};
}

/**
 * Set up a cron job for a schedule
 * @param {Object} schedule - Schedule object from database
 */
function setupCronJob(schedule) {
	// Validate cron expression
	if (!cron.validate(schedule.cron_expression)) {
		console.error(`[BackupScheduler] Invalid cron expression for schedule ${schedule.id}: ${schedule.cron_expression}`);
		return;
	}

	// Stop existing job if any
	if (activeJobs.has(schedule.id)) {
		activeJobs.get(schedule.id).stop();
	}

	// Create new cron job
	const job = cron.schedule(schedule.cron_expression, async () => {
		console.log(`[BackupScheduler] Running scheduled backup: ${schedule.name}`);
		await runBackup(schedule.id);
	}, {
		timezone: 'America/Chicago' // Use CST/CDT
	});

	activeJobs.set(schedule.id, job);
	console.log(`[BackupScheduler] Set up cron job for schedule ${schedule.id}: ${schedule.cron_expression}`);

	// Update next run time
	updateNextRunTime(schedule.id, schedule.cron_expression);
}

/**
 * Calculate and update the next run time for a schedule
 * @param {number} scheduleId - Schedule ID
 * @param {string} cronExpression - Cron expression
 */
function updateNextRunTime(scheduleId, cronExpression) {
	try {
		// Calculate next run from cron expression
		const interval = cron.schedule(cronExpression, () => {}, { scheduled: false });
		// node-cron doesn't provide next run time directly, so we calculate it
		const nextRun = calculateNextRun(cronExpression);

		systemDb.updateBackupSchedule(scheduleId, { next_run: nextRun });
	} catch (error) {
		console.error(`[BackupScheduler] Failed to update next run time for ${scheduleId}:`, error.message);
	}
}

/**
 * Calculate next run time from cron expression
 * @param {string} cronExpression - Cron expression
 * @returns {string} ISO timestamp of next run
 */
function calculateNextRun(cronExpression) {
	// Parse cron expression (minute, hour, day, month, weekday)
	const parts = cronExpression.split(' ');
	if (parts.length !== 5) {
		return null;
	}

	const now = new Date();
	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

	// Simple calculation for common patterns
	const nextRun = new Date(now);

	// Handle hour
	if (hour !== '*') {
		const targetHour = parseInt(hour);
		nextRun.setHours(targetHour, 0, 0, 0);

		// If target hour already passed today, move to tomorrow
		if (now.getHours() >= targetHour) {
			nextRun.setDate(nextRun.getDate() + 1);
		}
	}

	// Handle minute
	if (minute !== '*') {
		nextRun.setMinutes(parseInt(minute), 0, 0);
	}

	return nextRun.toISOString();
}

/**
 * Run a backup for a specific schedule
 * @param {number} scheduleId - Schedule ID
 * @param {number} createdBy - User ID who triggered the backup (null for scheduled)
 * @returns {Object} Result of backup operation
 */
async function runBackup(scheduleId, createdBy = null) {
	if (!systemDb) {
		return { success: false, error: 'Database not initialized' };
	}

	const schedule = systemDb.getBackupScheduleById(scheduleId);
	if (!schedule) {
		return { success: false, error: 'Schedule not found' };
	}

	// Record backup start
	const historyRecord = systemDb.recordBackupStart({
		scheduleId,
		database: schedule.database,
		createdBy
	});

	try {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const backups = [];

		// Determine which databases to backup
		const databasesToBackup = schedule.database === 'all'
			? Object.keys(dbPaths)
			: [schedule.database];

		let totalSize = 0;

		for (const dbName of databasesToBackup) {
			if (!dbPaths[dbName]) {
				console.warn(`[BackupScheduler] Unknown database: ${dbName}`);
				continue;
			}

			const sourcePath = dbPaths[dbName];
			const backupFilename = `${dbName}-${timestamp}.db`;
			const backupPath = path.join(BACKUP_DIR, backupFilename);

			// Copy database file
			fs.copyFileSync(sourcePath, backupPath);

			const stats = fs.statSync(backupPath);
			totalSize += stats.size;
			backups.push({
				database: dbName,
				filename: backupFilename,
				size: stats.size
			});
		}

		// Record successful completion
		systemDb.recordBackupComplete(historyRecord.id, 'success', totalSize);

		// Update last run time
		systemDb.updateScheduleLastRun(scheduleId);

		// Update next run time
		updateNextRunTime(scheduleId, schedule.cron_expression);

		// Cleanup old backups based on retention policy
		if (schedule.retention_days > 0) {
			cleanupOldBackups(schedule.retention_days);
		}

		console.log(`[BackupScheduler] Backup completed: ${backups.length} files, ${totalSize} bytes`);

		return {
			success: true,
			backups,
			totalSize,
			historyId: historyRecord.id
		};
	} catch (error) {
		console.error('[BackupScheduler] Backup failed:', error.message);

		// Record failure
		systemDb.recordBackupComplete(historyRecord.id, 'failed', null, error.message);

		schedulerState.errors.push({
			timestamp: new Date().toISOString(),
			scheduleId,
			error: error.message
		});

		// Keep only last 10 errors
		if (schedulerState.errors.length > 10) {
			schedulerState.errors.shift();
		}

		return { success: false, error: error.message };
	}
}

/**
 * Cleanup old backup files based on retention policy
 * @param {number} retentionDays - Number of days to retain backups
 * @returns {Object} Cleanup results
 */
function cleanupOldBackups(retentionDays) {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

	let deletedCount = 0;
	let freedBytes = 0;

	try {
		if (!fs.existsSync(BACKUP_DIR)) {
			return { deletedCount: 0, freedBytes: 0 };
		}

		const files = fs.readdirSync(BACKUP_DIR);

		for (const filename of files) {
			if (!filename.endsWith('.db')) continue;

			const filePath = path.join(BACKUP_DIR, filename);
			const stats = fs.statSync(filePath);

			if (stats.birthtime < cutoffDate) {
				fs.unlinkSync(filePath);
				deletedCount++;
				freedBytes += stats.size;
				console.log(`[BackupScheduler] Deleted old backup: ${filename}`);
			}
		}

		// Also cleanup database records
		if (systemDb) {
			systemDb.cleanupOldBackupRecords(retentionDays);
		}

		return { deletedCount, freedBytes };
	} catch (error) {
		console.error('[BackupScheduler] Cleanup failed:', error.message);
		return { deletedCount, freedBytes, error: error.message };
	}
}

/**
 * Get scheduler status
 * @returns {Object} Current scheduler status
 */
function getSchedulerStatus() {
	return {
		isRunning: schedulerState.isRunning,
		activeJobs: activeJobs.size,
		lastCheck: schedulerState.lastCheck,
		recentErrors: schedulerState.errors
	};
}

/**
 * Create a new backup schedule
 * @param {Object} data - Schedule data
 * @returns {Object} Created schedule
 */
function createSchedule(data) {
	if (!systemDb) {
		return { success: false, error: 'Database not initialized' };
	}

	// Validate cron expression
	if (!cron.validate(data.cronExpression)) {
		return { success: false, error: 'Invalid cron expression' };
	}

	try {
		const schedule = systemDb.createBackupSchedule({
			name: data.name,
			database: data.database || 'all',
			cronExpression: data.cronExpression,
			retentionDays: data.retentionDays || 7,
			enabled: data.enabled !== false,
			createdBy: data.createdBy
		});

		// Set up cron job if scheduler is running and schedule is enabled
		if (schedulerState.isRunning && schedule.enabled) {
			setupCronJob(schedule);
		}

		return { success: true, schedule };
	} catch (error) {
		return { success: false, error: error.message };
	}
}

/**
 * Update an existing backup schedule
 * @param {number} id - Schedule ID
 * @param {Object} data - Updated data
 * @returns {Object} Update result
 */
function updateSchedule(id, data) {
	if (!systemDb) {
		return { success: false, error: 'Database not initialized' };
	}

	// Validate cron expression if being updated
	if (data.cronExpression && !cron.validate(data.cronExpression)) {
		return { success: false, error: 'Invalid cron expression' };
	}

	try {
		const result = systemDb.updateBackupSchedule(id, data);

		// Reconfigure cron job if scheduler is running
		if (schedulerState.isRunning) {
			const schedule = systemDb.getBackupScheduleById(id);
			if (schedule) {
				if (schedule.enabled) {
					setupCronJob(schedule);
				} else {
					// Stop job if disabled
					if (activeJobs.has(id)) {
						activeJobs.get(id).stop();
						activeJobs.delete(id);
					}
				}
			}
		}

		return result;
	} catch (error) {
		return { success: false, error: error.message };
	}
}

/**
 * Delete a backup schedule
 * @param {number} id - Schedule ID
 * @returns {Object} Delete result
 */
function deleteSchedule(id) {
	if (!systemDb) {
		return { success: false, error: 'Database not initialized' };
	}

	try {
		// Stop cron job if running
		if (activeJobs.has(id)) {
			activeJobs.get(id).stop();
			activeJobs.delete(id);
		}

		return systemDb.deleteBackupSchedule(id);
	} catch (error) {
		return { success: false, error: error.message };
	}
}

/**
 * Get all backup schedules
 * @returns {Array} List of schedules
 */
function getSchedules() {
	if (!systemDb) return [];
	return systemDb.getBackupSchedules();
}

/**
 * Get backup schedule by ID
 * @param {number} id - Schedule ID
 * @returns {Object|null} Schedule or null
 */
function getScheduleById(id) {
	if (!systemDb) return null;
	return systemDb.getBackupScheduleById(id);
}

/**
 * Get backup history
 * @param {Object} options - Query options
 * @returns {Array} Backup history records
 */
function getHistory(options = {}) {
	if (!systemDb) return [];
	return systemDb.getBackupHistory(options);
}

/**
 * Trigger immediate backup for a schedule
 * @param {number} scheduleId - Schedule ID
 * @param {number} userId - User ID triggering the backup
 * @returns {Object} Backup result
 */
async function triggerBackupNow(scheduleId, userId) {
	return await runBackup(scheduleId, userId);
}

/**
 * Validate a cron expression
 * @param {string} expression - Cron expression to validate
 * @returns {boolean} True if valid
 */
function validateCronExpression(expression) {
	return cron.validate(expression);
}

/**
 * Get common cron presets for UI
 * @returns {Array} List of cron presets
 */
function getCronPresets() {
	return [
		{ label: 'Every hour', expression: '0 * * * *' },
		{ label: 'Every 6 hours', expression: '0 */6 * * *' },
		{ label: 'Daily at midnight', expression: '0 0 * * *' },
		{ label: 'Daily at 2am', expression: '0 2 * * *' },
		{ label: 'Weekly (Sunday midnight)', expression: '0 0 * * 0' },
		{ label: 'Weekly (Monday 2am)', expression: '0 2 * * 1' },
		{ label: 'Monthly (1st at 2am)', expression: '0 2 1 * *' }
	];
}

module.exports = {
	init,
	startScheduler,
	stopScheduler,
	getSchedulerStatus,
	createSchedule,
	updateSchedule,
	deleteSchedule,
	getSchedules,
	getScheduleById,
	getHistory,
	runBackup,
	triggerBackupNow,
	cleanupOldBackups,
	validateCronExpression,
	getCronPresets
};
