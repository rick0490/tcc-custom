/**
 * Tournament Dashboard System Monitor
 *
 * Comprehensive monitoring script that collects:
 * - Service status (systemd services)
 * - API response times and errors
 * - Network conditions
 * - Pi display health metrics
 * - System resources
 *
 * Output is formatted for Claude AI analysis to identify:
 * - Services that need debugging
 * - Optimization opportunities
 * - Potential issues
 */

const { exec, execSync } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

// Configuration
const CONFIG = {
	services: [
		{ name: 'control-center-admin', port: 3000, description: 'Admin Dashboard' },
		{ name: 'control-center-signup', port: 3001, description: 'Tournament Signup' },
		{ name: 'magic-mirror-match', port: 2052, description: 'Match Display API' },
		{ name: 'magic-mirror-bracket', port: 2053, description: 'Bracket Display API' },
		{ name: 'magic-mirror-flyer', port: 2054, description: 'Flyer Display API' }
	],
	apiEndpoints: [
		{ name: 'Match Module Status', url: 'http://localhost:2052/api/tournament/status', method: 'GET' },
		{ name: 'Bracket Module Status', url: 'http://localhost:2053/api/bracket/status', method: 'GET' },
		{ name: 'Flyer Module Status', url: 'http://localhost:2054/api/flyer/status', method: 'GET' }
	],
	externalEndpoints: [
		// Challonge API requires authentication, skip in automated monitoring
		// { name: 'Challonge API', url: 'https://api.challonge.com/v1/tournaments.json', timeout: 10000 }
	],
	networkTargets: [
		{ name: 'Gateway', host: '192.168.1.1' },
		{ name: 'Google DNS', host: '8.8.8.8' },
		{ name: 'Cloudflare DNS', host: '1.1.1.1' }
	],
	sampleIntervalMs: 5000,  // Sample every 5 seconds
	maxSamples: 60,          // Keep last 60 samples (5 minutes at 5s interval)
	reportDir: path.join(__dirname, 'monitoring-reports')
};

// Monitoring state
let monitoringState = {
	isRunning: false,
	startTime: null,
	samples: [],
	errors: [],
	intervalId: null,
	sessionId: null
};

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
 * Check systemd service status
 */
async function checkServiceStatus(serviceName) {
	const result = await execCommand(`systemctl is-active ${serviceName}`);
	const statusResult = await execCommand(`systemctl show ${serviceName} --property=ActiveState,SubState,MainPID,MemoryCurrent,CPUUsageNSec`);

	let details = {};
	if (statusResult.success) {
		statusResult.stdout.split('\n').forEach(line => {
			const [key, value] = line.split('=');
			if (key && value) {
				details[key] = value;
			}
		});
	}

	return {
		name: serviceName,
		active: result.success && result.stdout === 'active',
		state: result.stdout || 'unknown',
		pid: details.MainPID || null,
		memoryBytes: details.MemoryCurrent ? parseInt(details.MemoryCurrent) : null,
		cpuNanos: details.CPUUsageNSec ? parseInt(details.CPUUsageNSec) : null
	};
}

/**
 * Check if port is listening
 */
async function checkPort(port) {
	const result = await execCommand(`ss -tlnp | grep :${port}`);
	return {
		port,
		listening: result.success && result.stdout.includes(`:${port}`),
		details: result.stdout || null
	};
}

/**
 * Make HTTP request and measure response time
 */
function httpRequest(url, options = {}) {
	return new Promise((resolve) => {
		const startTime = Date.now();
		const urlObj = new URL(url);
		const client = urlObj.protocol === 'https:' ? https : http;

		const reqOptions = {
			hostname: urlObj.hostname,
			port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
			path: urlObj.pathname + urlObj.search,
			method: options.method || 'GET',
			timeout: options.timeout || 5000,
			headers: options.headers || {}
		};

		const req = client.request(reqOptions, (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				resolve({
					success: res.statusCode >= 200 && res.statusCode < 400,
					statusCode: res.statusCode,
					responseTimeMs: Date.now() - startTime,
					dataLength: data.length,
					headers: res.headers
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
 * Ping a host and measure latency
 */
async function pingHost(host) {
	const result = await execCommand(`ping -c 3 -W 2 ${host}`);

	if (!result.success) {
		return { host, reachable: false, error: result.error };
	}

	// Parse ping output for latency
	const latencyMatch = result.stdout.match(/rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/);
	const packetLossMatch = result.stdout.match(/(\d+)% packet loss/);

	return {
		host,
		reachable: true,
		minMs: latencyMatch ? parseFloat(latencyMatch[1]) : null,
		avgMs: latencyMatch ? parseFloat(latencyMatch[2]) : null,
		maxMs: latencyMatch ? parseFloat(latencyMatch[3]) : null,
		packetLoss: packetLossMatch ? parseInt(packetLossMatch[1]) : null
	};
}

/**
 * Get system resource usage
 */
async function getSystemResources() {
	const loadAvg = os.loadavg();
	const totalMem = os.totalmem();
	const freeMem = os.freemem();
	const cpus = os.cpus();

	// Get disk usage
	const diskResult = await execCommand("df -h / | tail -1 | awk '{print $5}'");
	const diskUsage = diskResult.success ? parseInt(diskResult.stdout) : null;

	// Get network stats
	const netResult = await execCommand("cat /proc/net/dev | grep -E 'eth0|ens|enp' | head -1");
	let networkStats = null;
	if (netResult.success && netResult.stdout) {
		const parts = netResult.stdout.split(/\s+/).filter(p => p);
		networkStats = {
			interface: parts[0]?.replace(':', ''),
			rxBytes: parseInt(parts[1]) || 0,
			txBytes: parseInt(parts[9]) || 0
		};
	}

	return {
		loadAverage: {
			'1min': loadAvg[0],
			'5min': loadAvg[1],
			'15min': loadAvg[2]
		},
		memory: {
			totalBytes: totalMem,
			freeBytes: freeMem,
			usedBytes: totalMem - freeMem,
			usagePercent: ((totalMem - freeMem) / totalMem * 100).toFixed(1)
		},
		cpu: {
			count: cpus.length,
			model: cpus[0]?.model || 'Unknown'
		},
		disk: {
			usagePercent: diskUsage
		},
		network: networkStats,
		uptime: os.uptime()
	};
}

/**
 * Load Pi display data from displays.json
 */
async function getPiDisplayData() {
	try {
		const displaysFile = path.join(__dirname, 'displays.json');
		const data = await fs.readFile(displaysFile, 'utf8');
		const displaysData = JSON.parse(data);

		const now = new Date();
		return displaysData.displays.map(display => {
			const lastHeartbeat = new Date(display.lastHeartbeat);
			const timeSinceHeartbeat = now - lastHeartbeat;

			return {
				id: display.id,
				hostname: display.hostname,
				ip: display.ip,
				externalIp: display.externalIp,
				status: timeSinceHeartbeat < 90000 ? 'online' : 'offline',
				currentView: display.currentView,
				assignedView: display.assignedView,
				viewSynced: display.currentView === display.assignedView,
				uptimeSeconds: display.uptimeSeconds,
				lastHeartbeat: display.lastHeartbeat,
				timeSinceHeartbeatMs: timeSinceHeartbeat,
				systemInfo: display.systemInfo || {}
			};
		});
	} catch (error) {
		return { error: error.message };
	}
}

/**
 * Get recent logs from journalctl
 */
async function getRecentLogs(serviceName, lines = 20) {
	const result = await execCommand(`journalctl -u ${serviceName} -n ${lines} --no-pager --output=short-iso`);

	if (!result.success) {
		return { error: result.error };
	}

	// Parse logs and identify errors/warnings
	const logLines = result.stdout.split('\n').filter(l => l);
	const errors = logLines.filter(l => /error|fail|exception|crash/i.test(l));
	const warnings = logLines.filter(l => /warn|timeout|retry/i.test(l));

	return {
		totalLines: logLines.length,
		errors: errors.length,
		warnings: warnings.length,
		errorMessages: errors.slice(0, 5),  // First 5 errors
		warningMessages: warnings.slice(0, 5)
	};
}

/**
 * Collect a single sample of all metrics
 */
async function collectSample() {
	const timestamp = new Date().toISOString();
	const sample = {
		timestamp,
		services: {},
		ports: {},
		apis: {},
		network: {},
		system: null,
		piDisplays: null
	};

	// Check all services
	for (const service of CONFIG.services) {
		sample.services[service.name] = await checkServiceStatus(service.name);
		sample.ports[service.port] = await checkPort(service.port);
	}

	// Check API endpoints
	for (const endpoint of CONFIG.apiEndpoints) {
		if (endpoint.requiresAuth) {
			// Skip auth-required endpoints in automated monitoring
			sample.apis[endpoint.name] = { skipped: true, reason: 'requires authentication' };
		} else {
			sample.apis[endpoint.name] = await httpRequest(endpoint.url, {
				method: endpoint.method,
				timeout: 5000
			});
		}
	}

	// Check external endpoints (with longer timeout)
	for (const endpoint of CONFIG.externalEndpoints) {
		sample.apis[endpoint.name] = await httpRequest(endpoint.url, {
			timeout: endpoint.timeout || 10000
		});
	}

	// Network latency checks
	for (const target of CONFIG.networkTargets) {
		sample.network[target.name] = await pingHost(target.host);
	}

	// System resources
	sample.system = await getSystemResources();

	// Pi display data
	sample.piDisplays = await getPiDisplayData();

	return sample;
}

/**
 * Analyze samples and generate insights for Claude
 */
function analyzeSamples(samples) {
	if (samples.length === 0) {
		return { error: 'No samples to analyze' };
	}

	const analysis = {
		summary: {
			totalSamples: samples.length,
			timeRange: {
				start: samples[0].timestamp,
				end: samples[samples.length - 1].timestamp
			}
		},
		services: {},
		apis: {},
		network: {},
		system: {},
		piDisplays: {},
		issues: [],
		recommendations: []
	};

	// Analyze services
	for (const service of CONFIG.services) {
		const serviceData = samples.map(s => s.services[service.name]);
		const activeCount = serviceData.filter(s => s?.active).length;
		const totalMemory = serviceData
			.filter(s => s?.memoryBytes)
			.map(s => s.memoryBytes);

		analysis.services[service.name] = {
			description: service.description,
			uptime: `${((activeCount / samples.length) * 100).toFixed(1)}%`,
			activeCount,
			totalSamples: samples.length,
			memoryAvgMB: totalMemory.length > 0
				? (totalMemory.reduce((a, b) => a + b, 0) / totalMemory.length / 1024 / 1024).toFixed(1)
				: null
		};

		// Flag services with issues
		if (activeCount < samples.length) {
			analysis.issues.push({
				severity: 'high',
				type: 'service_downtime',
				service: service.name,
				message: `${service.name} was down for ${samples.length - activeCount} of ${samples.length} samples`
			});
		}
	}

	// Analyze API response times
	for (const endpoint of [...CONFIG.apiEndpoints, ...CONFIG.externalEndpoints]) {
		const apiData = samples
			.map(s => s.apis[endpoint.name])
			.filter(a => a && !a.skipped && a.responseTimeMs);

		if (apiData.length > 0) {
			const responseTimes = apiData.map(a => a.responseTimeMs);
			const successCount = apiData.filter(a => a.success).length;

			analysis.apis[endpoint.name] = {
				successRate: `${((successCount / apiData.length) * 100).toFixed(1)}%`,
				avgResponseMs: (responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(0),
				minResponseMs: Math.min(...responseTimes),
				maxResponseMs: Math.max(...responseTimes),
				samples: apiData.length
			};

			// Flag slow APIs
			const avgResponse = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
			if (avgResponse > 2000) {
				analysis.issues.push({
					severity: 'medium',
					type: 'slow_api',
					endpoint: endpoint.name,
					message: `${endpoint.name} has slow average response time: ${avgResponse.toFixed(0)}ms`
				});
			}

			// Flag unreliable APIs
			if (successCount < apiData.length * 0.95) {
				analysis.issues.push({
					severity: 'high',
					type: 'api_errors',
					endpoint: endpoint.name,
					message: `${endpoint.name} has ${((1 - successCount / apiData.length) * 100).toFixed(1)}% error rate`
				});
			}
		}
	}

	// Analyze network latency
	for (const target of CONFIG.networkTargets) {
		const pingData = samples
			.map(s => s.network[target.name])
			.filter(p => p && p.reachable);

		if (pingData.length > 0) {
			const avgLatencies = pingData.map(p => p.avgMs);
			const packetLosses = pingData.map(p => p.packetLoss).filter(l => l !== null);

			analysis.network[target.name] = {
				reachabilityRate: `${((pingData.length / samples.length) * 100).toFixed(1)}%`,
				avgLatencyMs: (avgLatencies.reduce((a, b) => a + b, 0) / avgLatencies.length).toFixed(1),
				avgPacketLoss: packetLosses.length > 0
					? `${(packetLosses.reduce((a, b) => a + b, 0) / packetLosses.length).toFixed(1)}%`
					: 'N/A'
			};

			// Flag high latency
			const avgLatency = avgLatencies.reduce((a, b) => a + b, 0) / avgLatencies.length;
			if (avgLatency > 100) {
				analysis.issues.push({
					severity: 'medium',
					type: 'high_latency',
					target: target.name,
					message: `High average latency to ${target.name}: ${avgLatency.toFixed(1)}ms`
				});
			}
		} else {
			analysis.network[target.name] = { unreachable: true };
			analysis.issues.push({
				severity: 'high',
				type: 'network_unreachable',
				target: target.name,
				message: `Cannot reach ${target.name} (${target.host})`
			});
		}
	}

	// Analyze system resources
	const systemData = samples.map(s => s.system).filter(s => s);
	if (systemData.length > 0) {
		const memoryUsages = systemData.map(s => parseFloat(s.memory.usagePercent));
		const loadAvgs = systemData.map(s => s.loadAverage['1min']);

		analysis.system = {
			avgMemoryUsage: `${(memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length).toFixed(1)}%`,
			maxMemoryUsage: `${Math.max(...memoryUsages).toFixed(1)}%`,
			avgLoad1min: (loadAvgs.reduce((a, b) => a + b, 0) / loadAvgs.length).toFixed(2),
			cpuCount: systemData[0].cpu.count
		};

		// Flag high memory usage
		const avgMemory = memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length;
		if (avgMemory > 80) {
			analysis.issues.push({
				severity: 'high',
				type: 'high_memory',
				message: `High average memory usage: ${avgMemory.toFixed(1)}%`
			});
		}

		// Flag high CPU load
		const avgLoad = loadAvgs.reduce((a, b) => a + b, 0) / loadAvgs.length;
		if (avgLoad > systemData[0].cpu.count * 0.8) {
			analysis.issues.push({
				severity: 'medium',
				type: 'high_cpu_load',
				message: `High CPU load average: ${avgLoad.toFixed(2)} (${systemData[0].cpu.count} cores)`
			});
		}
	}

	// Analyze Pi displays
	const latestPiData = samples[samples.length - 1].piDisplays;
	if (Array.isArray(latestPiData)) {
		for (const pi of latestPiData) {
			analysis.piDisplays[pi.hostname || pi.id] = {
				status: pi.status,
				ip: pi.ip,
				currentView: pi.currentView,
				viewSynced: pi.viewSynced,
				uptimeHours: pi.uptimeSeconds ? (pi.uptimeSeconds / 3600).toFixed(1) : null,
				cpuTemp: pi.systemInfo?.cpuTemp,
				memoryUsage: pi.systemInfo?.memoryUsage,
				wifiQuality: pi.systemInfo?.wifiQuality,
				voltage: pi.systemInfo?.voltage
			};

			// Flag Pi issues (medium severity - Pi displays are not critical infrastructure)
			if (pi.status === 'offline') {
				analysis.issues.push({
					severity: 'medium',
					type: 'pi_offline',
					display: pi.hostname || pi.id,
					message: `Pi display ${pi.hostname || pi.id} is offline`
				});
			}

			if (pi.systemInfo?.cpuTemp > 70) {
				analysis.issues.push({
					severity: 'medium',
					type: 'pi_high_temp',
					display: pi.hostname || pi.id,
					message: `Pi display ${pi.hostname || pi.id} has high CPU temperature: ${pi.systemInfo.cpuTemp}C`
				});
			}

			if (pi.systemInfo?.voltage && pi.systemInfo.voltage < 0.85) {
				analysis.issues.push({
					severity: 'medium',
					type: 'pi_throttling',
					display: pi.hostname || pi.id,
					message: `Pi display ${pi.hostname || pi.id} is throttling due to low voltage: ${pi.systemInfo.voltage}V`
				});
			}

			if (!pi.viewSynced) {
				analysis.issues.push({
					severity: 'low',
					type: 'pi_view_desync',
					display: pi.hostname || pi.id,
					message: `Pi display ${pi.hostname || pi.id} view not synced: current=${pi.currentView}, assigned=${pi.assignedView}`
				});
			}
		}
	}

	// Generate recommendations based on issues
	if (analysis.issues.filter(i => i.type === 'service_downtime').length > 0) {
		analysis.recommendations.push('Review systemd service configurations and check logs for crash causes');
	}
	if (analysis.issues.filter(i => i.type === 'slow_api').length > 0) {
		analysis.recommendations.push('Consider optimizing slow API endpoints or adding caching');
	}
	if (analysis.issues.filter(i => i.type === 'high_memory').length > 0) {
		analysis.recommendations.push('Review memory usage in Node.js processes, consider memory profiling');
	}
	if (analysis.issues.filter(i => i.type === 'high_latency').length > 0) {
		analysis.recommendations.push('Network latency detected - check network configuration and DNS settings');
	}
	if (analysis.issues.filter(i => i.type.startsWith('pi_')).length > 0) {
		analysis.recommendations.push('Check Pi display hardware and network connectivity');
	}

	return analysis;
}

/**
 * Generate a human and Claude-readable report
 */
function generateReport(analysis, samples) {
	const report = {
		generatedAt: new Date().toISOString(),
		version: '1.0.0',
		purpose: 'System monitoring report for Claude AI analysis',
		instructions: 'Analyze this report to identify services needing debugging and optimization opportunities',

		// Executive summary
		executiveSummary: {
			monitoringDuration: analysis.summary,
			totalIssues: analysis.issues.length,
			criticalIssues: analysis.issues.filter(i => i.severity === 'high').length,
			warningIssues: analysis.issues.filter(i => i.severity === 'medium').length,
			infoIssues: analysis.issues.filter(i => i.severity === 'low').length
		},

		// Issues for immediate attention
		issuesForDebugging: analysis.issues
			.sort((a, b) => {
				const severityOrder = { high: 0, medium: 1, low: 2 };
				return severityOrder[a.severity] - severityOrder[b.severity];
			}),

		// Service health
		serviceHealth: analysis.services,

		// API performance
		apiPerformance: analysis.apis,

		// Network conditions
		networkConditions: analysis.network,

		// System resources
		systemResources: analysis.system,

		// Pi display status
		piDisplayStatus: analysis.piDisplays,

		// Recommendations
		recommendations: analysis.recommendations,

		// Raw data summary (for deep analysis)
		rawDataSummary: {
			sampleCount: samples.length,
			firstSample: samples[0]?.timestamp,
			lastSample: samples[samples.length - 1]?.timestamp
		}
	};

	return report;
}

/**
 * Save report to file
 */
async function saveReport(report) {
	// Ensure reports directory exists
	try {
		await fs.mkdir(CONFIG.reportDir, { recursive: true });
	} catch (e) {
		// Directory may already exist
	}

	const filename = `monitoring-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
	const filepath = path.join(CONFIG.reportDir, filename);

	await fs.writeFile(filepath, JSON.stringify(report, null, 2));

	return { filename, filepath };
}

/**
 * Start monitoring session
 */
function startMonitoring(durationMs = 300000) {  // Default 5 minutes
	if (monitoringState.isRunning) {
		return { success: false, error: 'Monitoring already running' };
	}

	monitoringState = {
		isRunning: true,
		startTime: new Date().toISOString(),
		samples: [],
		errors: [],
		intervalId: null,
		sessionId: `session-${Date.now()}`
	};

	console.log(`[Monitor] Starting monitoring session ${monitoringState.sessionId}`);

	// Collect initial sample immediately
	collectSample().then(sample => {
		monitoringState.samples.push(sample);
	}).catch(err => {
		monitoringState.errors.push({ timestamp: new Date().toISOString(), error: err.message });
	});

	// Set up interval for subsequent samples
	monitoringState.intervalId = setInterval(async () => {
		try {
			const sample = await collectSample();
			monitoringState.samples.push(sample);

			// Keep only last maxSamples
			if (monitoringState.samples.length > CONFIG.maxSamples) {
				monitoringState.samples.shift();
			}
		} catch (err) {
			monitoringState.errors.push({ timestamp: new Date().toISOString(), error: err.message });
		}
	}, CONFIG.sampleIntervalMs);

	// Auto-stop after duration
	if (durationMs > 0) {
		setTimeout(() => {
			if (monitoringState.isRunning) {
				stopMonitoring();
			}
		}, durationMs);
	}

	return {
		success: true,
		sessionId: monitoringState.sessionId,
		startTime: monitoringState.startTime,
		sampleIntervalMs: CONFIG.sampleIntervalMs,
		durationMs
	};
}

/**
 * Stop monitoring session
 */
function stopMonitoring() {
	if (!monitoringState.isRunning) {
		return { success: false, error: 'Monitoring not running' };
	}

	if (monitoringState.intervalId) {
		clearInterval(monitoringState.intervalId);
	}

	const endTime = new Date().toISOString();
	const result = {
		success: true,
		sessionId: monitoringState.sessionId,
		startTime: monitoringState.startTime,
		endTime,
		samplesCollected: monitoringState.samples.length,
		errorsEncountered: monitoringState.errors.length
	};

	console.log(`[Monitor] Stopped monitoring session ${monitoringState.sessionId} - ${result.samplesCollected} samples collected`);

	monitoringState.isRunning = false;

	return result;
}

/**
 * Get current monitoring status
 */
function getMonitoringStatus() {
	return {
		isRunning: monitoringState.isRunning,
		sessionId: monitoringState.sessionId,
		startTime: monitoringState.startTime,
		samplesCollected: monitoringState.samples.length,
		errorsEncountered: monitoringState.errors.length,
		latestSampleTime: monitoringState.samples.length > 0
			? monitoringState.samples[monitoringState.samples.length - 1].timestamp
			: null
	};
}

/**
 * Generate report from current samples
 */
async function generateCurrentReport() {
	if (monitoringState.samples.length === 0) {
		return { error: 'No samples collected yet' };
	}

	const analysis = analyzeSamples(monitoringState.samples);
	const report = generateReport(analysis, monitoringState.samples);
	const saved = await saveReport(report);

	return {
		success: true,
		report,
		savedTo: saved.filepath
	};
}

/**
 * Run a quick one-time check (no persistent monitoring)
 */
async function runQuickCheck() {
	console.log('[Monitor] Running quick system check...');

	const sample = await collectSample();
	const analysis = analyzeSamples([sample]);
	const report = generateReport(analysis, [sample]);

	return {
		success: true,
		report,
		timestamp: sample.timestamp
	};
}

/**
 * Get service logs for debugging
 */
async function getServiceLogs() {
	const logs = {};

	for (const service of CONFIG.services) {
		logs[service.name] = await getRecentLogs(service.name, 30);
	}

	return logs;
}

// Export functions for use by server.js
module.exports = {
	startMonitoring,
	stopMonitoring,
	getMonitoringStatus,
	generateCurrentReport,
	runQuickCheck,
	getServiceLogs,
	collectSample,
	analyzeSamples,
	CONFIG
};

// If run directly, perform a quick check
if (require.main === module) {
	runQuickCheck().then(result => {
		console.log(JSON.stringify(result.report, null, 2));
	}).catch(err => {
		console.error('Error:', err);
		process.exit(1);
	});
}
