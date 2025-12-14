/**
 * Metrics Aggregator Service
 *
 * Background service for continuous metrics collection, historical storage,
 * and threshold-based alerting.
 *
 * Phase 2 Feature: Performance Monitoring Dashboard
 */

const os = require('os');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const http = require('http');

// Reference to system database (set by init)
let systemDb = null;

// Collection state
let collectionState = {
	isRunning: false,
	intervalId: null,
	lastCollectionTime: null,
	collectionCount: 0,
	errors: []
};

// Configuration
const CONFIG = {
	collectionIntervalMs: 60000, // 60 seconds
	metricsRetentionDays: 7,     // Keep metrics for 7 days
	alertCooldownMinutes: 15,    // Don't repeat same alert for 15 minutes
	displayHeartbeatTimeoutMs: 90000, // 90 seconds
	apiEndpoints: [
		{ name: 'Match Display', url: 'http://localhost:2052/api/health', metric: 'match_display' },
		{ name: 'Bracket Display', url: 'http://localhost:2053/api/health', metric: 'bracket_display' },
		{ name: 'Flyer Display', url: 'http://localhost:2054/api/health', metric: 'flyer_display' }
	]
};

// Track recent alerts to prevent duplicates
const recentAlerts = new Map();

/**
 * Initialize the metrics aggregator with dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.systemDb - System database instance
 */
function init({ systemDb: db }) {
	systemDb = db;
	console.log('[MetricsAggregator] Initialized');
}

/**
 * Execute shell command and return output
 */
function execCommand(cmd, timeout = 5000) {
	return new Promise((resolve) => {
		exec(cmd, { timeout }, (error, stdout, stderr) => {
			if (error) {
				resolve({ success: false, error: error.message, stderr });
			} else {
				resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
			}
		});
	});
}

/**
 * Make HTTP request and measure response time
 */
function httpRequest(url, timeout = 5000) {
	return new Promise((resolve) => {
		const startTime = Date.now();
		const urlObj = new URL(url);

		const reqOptions = {
			hostname: urlObj.hostname,
			port: urlObj.port || 80,
			path: urlObj.pathname + urlObj.search,
			method: 'GET',
			timeout
		};

		const req = http.request(reqOptions, (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				resolve({
					success: res.statusCode >= 200 && res.statusCode < 400,
					statusCode: res.statusCode,
					responseTimeMs: Date.now() - startTime
				});
			});
		});

		req.on('error', (error) => {
			resolve({
				success: false,
				error: error.message,
				responseTimeMs: Date.now() - startTime
			});
		});

		req.on('timeout', () => {
			req.destroy();
			resolve({
				success: false,
				error: 'Request timeout',
				responseTimeMs: Date.now() - startTime
			});
		});

		req.end();
	});
}

/**
 * Collect system metrics
 */
async function collectSystemMetrics() {
	const metrics = [];
	const now = new Date().toISOString();

	// Memory usage
	const totalMem = os.totalmem();
	const freeMem = os.freemem();
	const memoryUsagePercent = ((totalMem - freeMem) / totalMem * 100);

	metrics.push({
		type: 'memory_usage',
		name: 'system',
		value: memoryUsagePercent
	});

	// CPU usage (load average)
	const loadAvg = os.loadavg();
	const cpuCount = os.cpus().length;
	const cpuUsagePercent = (loadAvg[0] / cpuCount) * 100;

	metrics.push({
		type: 'cpu_usage',
		name: 'system',
		value: cpuUsagePercent
	});

	// Disk usage
	try {
		const diskResult = await execCommand("df -h / | tail -1 | awk '{print $5}'");
		if (diskResult.success) {
			const diskUsage = parseInt(diskResult.stdout);
			if (!isNaN(diskUsage)) {
				metrics.push({
					type: 'disk_usage',
					name: 'root',
					value: diskUsage
				});
			}
		}
	} catch (e) {
		// Ignore disk errors
	}

	// Database sizes
	try {
		const dbFiles = ['tournaments.db', 'players.db', 'system.db', 'cache.db'];
		let totalSizeMB = 0;

		for (const dbFile of dbFiles) {
			const dbPath = path.join(__dirname, '..', dbFile);
			try {
				const stats = await fs.stat(dbPath);
				const sizeMB = stats.size / (1024 * 1024);
				totalSizeMB += sizeMB;

				metrics.push({
					type: 'database_size',
					name: dbFile.replace('.db', ''),
					value: sizeMB
				});
			} catch (e) {
				// Database file may not exist
			}
		}

		metrics.push({
			type: 'database_size',
			name: 'total',
			value: totalSizeMB
		});
	} catch (e) {
		// Ignore database size errors
	}

	return metrics;
}

/**
 * Collect API latency metrics
 */
async function collectApiMetrics() {
	const metrics = [];

	for (const endpoint of CONFIG.apiEndpoints) {
		const result = await httpRequest(endpoint.url);

		metrics.push({
			type: 'api_latency',
			name: endpoint.metric,
			value: result.responseTimeMs
		});

		// Track API success/failure
		metrics.push({
			type: 'api_status',
			name: endpoint.metric,
			value: result.success ? 1 : 0
		});
	}

	return metrics;
}

/**
 * Collect display health metrics
 */
async function collectDisplayMetrics() {
	const metrics = [];

	try {
		const displaysFile = path.join(__dirname, '..', 'displays.json');
		const data = await fs.readFile(displaysFile, 'utf8');
		const displaysData = JSON.parse(data);

		const now = Date.now();
		let onlineCount = 0;
		let offlineCount = 0;

		for (const display of displaysData.displays || []) {
			const lastHeartbeat = new Date(display.lastHeartbeat).getTime();
			const timeSinceHeartbeat = now - lastHeartbeat;

			if (timeSinceHeartbeat < CONFIG.displayHeartbeatTimeoutMs) {
				onlineCount++;

				// Collect per-display metrics if available
				if (display.systemInfo) {
					if (display.systemInfo.cpuTemp) {
						metrics.push({
							type: 'display_cpu_temp',
							name: display.hostname || display.id,
							value: display.systemInfo.cpuTemp
						});
					}
					if (display.systemInfo.memoryUsage) {
						metrics.push({
							type: 'display_memory',
							name: display.hostname || display.id,
							value: display.systemInfo.memoryUsage
						});
					}
					if (display.systemInfo.wifiQuality) {
						metrics.push({
							type: 'display_wifi',
							name: display.hostname || display.id,
							value: display.systemInfo.wifiQuality
						});
					}
				}
			} else {
				offlineCount++;
			}
		}

		metrics.push({
			type: 'display_online',
			name: 'count',
			value: onlineCount
		});

		metrics.push({
			type: 'display_offline',
			name: 'count',
			value: offlineCount
		});

	} catch (e) {
		// No displays.json or parse error
	}

	return metrics;
}

/**
 * Check metrics against thresholds and create alerts
 */
async function checkThresholds(metrics) {
	if (!systemDb) return;

	const thresholds = systemDb.getAlertThresholds();
	const thresholdMap = new Map(thresholds.map(t => [t.metric_type, t]));

	for (const metric of metrics) {
		const threshold = thresholdMap.get(metric.type);
		if (!threshold || !threshold.enabled) continue;

		let severity = null;
		let message = null;

		// Check critical threshold first
		if (threshold.critical_threshold !== null && metric.value >= threshold.critical_threshold) {
			severity = 'critical';
			message = `${metric.type} (${metric.name}) is critical: ${metric.value.toFixed(1)} >= ${threshold.critical_threshold}`;
		}
		// Then warning threshold
		else if (threshold.warning_threshold !== null && metric.value >= threshold.warning_threshold) {
			severity = 'warning';
			message = `${metric.type} (${metric.name}) is elevated: ${metric.value.toFixed(1)} >= ${threshold.warning_threshold}`;
		}

		if (severity && message) {
			// Check cooldown to prevent duplicate alerts
			const alertKey = `${metric.type}:${metric.name}:${severity}`;
			const lastAlertTime = recentAlerts.get(alertKey);
			const now = Date.now();

			if (!lastAlertTime || (now - lastAlertTime) > CONFIG.alertCooldownMinutes * 60000) {
				systemDb.createAlert({
					metricType: metric.type,
					metricName: metric.name,
					severity,
					message,
					value: metric.value
				});

				recentAlerts.set(alertKey, now);
				console.log(`[MetricsAggregator] Alert created: ${message}`);
			}
		}
	}
}

/**
 * Run a single metrics collection cycle
 */
async function collectMetrics() {
	if (!systemDb) {
		console.error('[MetricsAggregator] systemDb not initialized');
		return;
	}

	try {
		const startTime = Date.now();

		// Collect all metrics
		const systemMetrics = await collectSystemMetrics();
		const apiMetrics = await collectApiMetrics();
		const displayMetrics = await collectDisplayMetrics();

		const allMetrics = [...systemMetrics, ...apiMetrics, ...displayMetrics];

		// Store metrics in database
		for (const metric of allMetrics) {
			systemDb.recordMetric(metric.type, metric.name, metric.value);
		}

		// Check thresholds and create alerts
		await checkThresholds(allMetrics);

		collectionState.lastCollectionTime = new Date().toISOString();
		collectionState.collectionCount++;

		const duration = Date.now() - startTime;
		if (process.env.DEBUG_MODE === 'true') {
			console.log(`[MetricsAggregator] Collected ${allMetrics.length} metrics in ${duration}ms`);
		}

	} catch (error) {
		console.error('[MetricsAggregator] Collection error:', error.message);
		collectionState.errors.push({
			timestamp: new Date().toISOString(),
			error: error.message
		});

		// Keep only last 10 errors
		if (collectionState.errors.length > 10) {
			collectionState.errors.shift();
		}
	}
}

/**
 * Start continuous metrics collection
 */
function startMetricsCollection() {
	if (collectionState.isRunning) {
		return { success: false, error: 'Collection already running' };
	}

	console.log('[MetricsAggregator] Starting metrics collection');

	collectionState.isRunning = true;
	collectionState.errors = [];
	collectionState.collectionCount = 0;

	// Collect immediately
	collectMetrics();

	// Set up interval
	collectionState.intervalId = setInterval(collectMetrics, CONFIG.collectionIntervalMs);

	return {
		success: true,
		intervalMs: CONFIG.collectionIntervalMs,
		startedAt: new Date().toISOString()
	};
}

/**
 * Stop metrics collection
 */
function stopMetricsCollection() {
	if (!collectionState.isRunning) {
		return { success: false, error: 'Collection not running' };
	}

	console.log('[MetricsAggregator] Stopping metrics collection');

	if (collectionState.intervalId) {
		clearInterval(collectionState.intervalId);
		collectionState.intervalId = null;
	}

	collectionState.isRunning = false;

	return {
		success: true,
		stoppedAt: new Date().toISOString(),
		totalCollections: collectionState.collectionCount
	};
}

/**
 * Get collection status
 */
function getCollectionStatus() {
	return {
		isRunning: collectionState.isRunning,
		lastCollectionTime: collectionState.lastCollectionTime,
		collectionCount: collectionState.collectionCount,
		intervalMs: CONFIG.collectionIntervalMs,
		recentErrors: collectionState.errors
	};
}

/**
 * Get metrics history from database
 * @param {string} metricType - Type of metric (api_latency, memory_usage, etc.)
 * @param {number} hours - Number of hours to look back (default 24)
 * @returns {Array} Array of metric data points
 */
function getMetricsHistory(metricType, hours = 24) {
	if (!systemDb) return [];
	return systemDb.getMetricsHistory(metricType, { hours });
}

/**
 * Get latest metrics for each type
 * @returns {Object} Latest metrics grouped by type
 */
function getLatestMetrics() {
	if (!systemDb) return {};

	const metricTypes = [
		'memory_usage', 'cpu_usage', 'disk_usage', 'database_size',
		'api_latency', 'api_status', 'display_online', 'display_offline',
		'display_cpu_temp', 'display_memory', 'display_wifi'
	];

	const latest = {};
	for (const type of metricTypes) {
		latest[type] = systemDb.getLatestMetrics(type);
	}

	return latest;
}

/**
 * Get current metrics snapshot (for real-time display)
 */
async function getCurrentSnapshot() {
	const systemMetrics = await collectSystemMetrics();
	const apiMetrics = await collectApiMetrics();
	const displayMetrics = await collectDisplayMetrics();

	return {
		timestamp: new Date().toISOString(),
		system: systemMetrics.reduce((acc, m) => {
			acc[`${m.type}_${m.name}`] = m.value;
			return acc;
		}, {}),
		api: apiMetrics.reduce((acc, m) => {
			if (m.type === 'api_latency') {
				acc[m.name] = { latencyMs: m.value };
			} else if (m.type === 'api_status') {
				acc[m.name] = acc[m.name] || {};
				acc[m.name].online = m.value === 1;
			}
			return acc;
		}, {}),
		displays: displayMetrics.reduce((acc, m) => {
			if (m.type === 'display_online' || m.type === 'display_offline') {
				acc[m.type] = m.value;
			} else {
				acc.perDisplay = acc.perDisplay || {};
				acc.perDisplay[m.name] = acc.perDisplay[m.name] || {};
				acc.perDisplay[m.name][m.type.replace('display_', '')] = m.value;
			}
			return acc;
		}, {})
	};
}

/**
 * Get active alerts
 */
function getActiveAlerts() {
	if (!systemDb) return [];
	return systemDb.getActiveAlerts();
}

/**
 * Acknowledge an alert
 */
function acknowledgeAlert(alertId, userId) {
	if (!systemDb) return { success: false, error: 'Database not initialized' };
	return systemDb.acknowledgeAlert(alertId, userId);
}

/**
 * Get alert thresholds
 */
function getAlertThresholds() {
	if (!systemDb) return [];
	return systemDb.getAlertThresholds();
}

/**
 * Update alert threshold
 */
function updateAlertThreshold(metricType, data) {
	if (!systemDb) return { success: false, error: 'Database not initialized' };
	return systemDb.updateAlertThreshold(metricType, data);
}

/**
 * Get alert history
 */
function getAlertHistory(options = {}) {
	if (!systemDb) return [];
	return systemDb.getAlertHistory(options);
}

/**
 * Clean up old metrics
 */
function cleanupOldMetrics() {
	if (!systemDb) return { success: false, error: 'Database not initialized' };

	const deleted = systemDb.cleanupOldMetrics(CONFIG.metricsRetentionDays);
	console.log(`[MetricsAggregator] Cleaned up ${deleted} old metric records`);

	return { success: true, deletedCount: deleted };
}

module.exports = {
	init,
	startMetricsCollection,
	stopMetricsCollection,
	getCollectionStatus,
	getMetricsHistory,
	getLatestMetrics,
	getCurrentSnapshot,
	getActiveAlerts,
	acknowledgeAlert,
	getAlertThresholds,
	updateAlertThreshold,
	getAlertHistory,
	cleanupOldMetrics,
	collectMetrics // Exposed for manual triggering
};
