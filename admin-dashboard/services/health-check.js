/**
 * Health Check Service
 *
 * Provides comprehensive system health diagnostics including:
 * - Database integrity checks (PRAGMA integrity_check)
 * - Disk space monitoring
 * - Memory usage monitoring
 * - WebSocket connection stats
 *
 * Part of Roadmap Phase 1.3: Health Check Diagnostics Enhancement
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// Thresholds for health checks
const THRESHOLDS = {
    disk: {
        warning: 10,    // Warn when < 10% available
        critical: 5     // Critical when < 5% available
    },
    memory: {
        warning: 80,    // Warn when > 80% used
        critical: 95    // Critical when > 95% used
    },
    websocket: {
        warning: 1000,  // Warn when queue > 1000
        critical: 5000  // Critical when queue > 5000
    }
};

// Database references (injected via init)
let db = null;
let getWebSocketStatus = null;

/**
 * Initialize with dependencies
 * @param {Object} deps - Dependencies
 */
function init(deps) {
    db = deps.db;
    getWebSocketStatus = deps.getWebSocketStatus;
}

/**
 * Check database integrity using PRAGMA integrity_check
 * @returns {Object} Database health status
 */
function checkDatabaseIntegrity() {
    const results = {
        status: 'healthy',
        details: {}
    };

    const databases = [
        { name: 'tournaments', module: db?.tournaments },
        { name: 'players', module: db?.players },
        { name: 'system', module: db?.system },
        { name: 'cache', module: db?.cache }
    ];

    const errors = [];

    for (const { name, module } of databases) {
        try {
            if (!module) {
                results.details[name] = {
                    integrity: 'unavailable',
                    error: 'Database module not loaded'
                };
                errors.push(`${name}: Database module not loaded`);
                continue;
            }

            const dbInstance = module.getDb();

            // Run integrity check
            const integrityResult = dbInstance.pragma('integrity_check');
            const isOk = integrityResult.length === 1 && integrityResult[0].integrity_check === 'ok';

            // Get database file size
            const dbPath = module.DB_PATH;
            let sizeBytes = 0;
            let tables = 0;

            try {
                const stats = fs.statSync(dbPath);
                sizeBytes = stats.size;

                // Count tables
                const tableList = dbInstance.prepare(
                    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'"
                ).get();
                tables = tableList?.count || 0;
            } catch (statError) {
                // File stats failed but integrity check passed
            }

            results.details[name] = {
                integrity: isOk ? 'ok' : 'corrupted',
                sizeBytes,
                tables,
                path: dbPath
            };

            if (!isOk) {
                errors.push(`${name}: Integrity check failed - ${JSON.stringify(integrityResult)}`);
            }
        } catch (error) {
            results.details[name] = {
                integrity: 'error',
                error: error.message
            };
            errors.push(`${name}: ${error.message}`);
        }
    }

    if (errors.length > 0) {
        results.status = 'unhealthy';
        results.errors = errors;
    }

    return results;
}

/**
 * Check disk space for database location
 * @returns {Object} Disk space status
 */
function checkDiskSpace() {
    const result = {
        status: 'healthy',
        warning: false
    };

    try {
        // Get database directory path
        const dbPath = db?.tournaments?.DB_PATH || path.join(__dirname, '../tournaments.db');
        const dbDir = path.dirname(dbPath);

        // Use df command to get disk usage
        const dfOutput = execSync(`df -B1 "${dbDir}" | tail -1`, { encoding: 'utf8' });
        const parts = dfOutput.trim().split(/\s+/);

        // df output: Filesystem 1B-blocks Used Available Use% Mounted
        const totalBytes = parseInt(parts[1], 10);
        const usedBytes = parseInt(parts[2], 10);
        const availableBytes = parseInt(parts[3], 10);
        const usagePercent = parseFloat(parts[4].replace('%', ''));
        const availablePercent = 100 - usagePercent;

        result.totalBytes = totalBytes;
        result.usedBytes = usedBytes;
        result.availableBytes = availableBytes;
        result.usagePercent = usagePercent;
        result.availablePercent = availablePercent;
        result.mountPoint = parts[5];

        // Check thresholds
        if (availablePercent < THRESHOLDS.disk.critical) {
            result.status = 'critical';
            result.warning = true;
            result.message = `Critical: Only ${availablePercent.toFixed(1)}% disk space available`;
        } else if (availablePercent < THRESHOLDS.disk.warning) {
            result.status = 'warning';
            result.warning = true;
            result.message = `Warning: Only ${availablePercent.toFixed(1)}% disk space available`;
        }
    } catch (error) {
        result.status = 'error';
        result.error = error.message;
    }

    return result;
}

/**
 * Check memory usage (process and system)
 * @returns {Object} Memory status
 */
function checkMemoryUsage() {
    const result = {
        status: 'healthy',
        warning: false
    };

    try {
        // Process memory
        const processMemory = process.memoryUsage();
        result.process = {
            heapUsedMB: Math.round(processMemory.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(processMemory.heapTotal / 1024 / 1024),
            rssMB: Math.round(processMemory.rss / 1024 / 1024),
            externalMB: Math.round(processMemory.external / 1024 / 1024)
        };

        // System memory
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const usagePercent = (usedMem / totalMem) * 100;

        result.system = {
            totalMB: Math.round(totalMem / 1024 / 1024),
            freeMB: Math.round(freeMem / 1024 / 1024),
            usedMB: Math.round(usedMem / 1024 / 1024),
            usagePercent: Math.round(usagePercent * 10) / 10
        };

        // Check thresholds
        if (usagePercent >= THRESHOLDS.memory.critical) {
            result.status = 'critical';
            result.warning = true;
            result.message = `Critical: System memory usage at ${usagePercent.toFixed(1)}%`;
        } else if (usagePercent >= THRESHOLDS.memory.warning) {
            result.status = 'warning';
            result.warning = true;
            result.message = `Warning: System memory usage at ${usagePercent.toFixed(1)}%`;
        }
    } catch (error) {
        result.status = 'error';
        result.error = error.message;
    }

    return result;
}

/**
 * Get WebSocket connection statistics
 * @param {Object} io - Socket.IO server instance
 * @returns {Object} WebSocket stats
 */
function getWebSocketStats(io) {
    const result = {
        status: 'healthy',
        warning: false,
        connections: {
            displays: 0,
            adminClients: 0,
            total: 0
        },
        queueLength: 0
    };

    try {
        // Get connection counts from status function if available
        if (getWebSocketStatus) {
            const wsStatus = getWebSocketStatus();
            result.connections.displays = wsStatus.displayCount || 0;
            result.connections.adminClients = wsStatus.adminClientCount || 0;
            result.connections.total = wsStatus.totalConnections || 0;
        }

        // Get Socket.IO engine stats if available
        if (io && io.engine) {
            const engine = io.engine;

            // Total connected clients
            result.connections.total = engine.clientsCount || result.connections.total;

            // Estimate queue length from pending packets
            // Socket.IO doesn't expose this directly, so we check write buffer
            let totalQueueLength = 0;

            if (io.sockets && io.sockets.sockets) {
                for (const [, socket] of io.sockets.sockets) {
                    // Check socket's write buffer if available
                    if (socket.conn && socket.conn.writeBuffer) {
                        totalQueueLength += socket.conn.writeBuffer.length;
                    }
                }
            }

            result.queueLength = totalQueueLength;
        }

        // Check thresholds
        if (result.queueLength >= THRESHOLDS.websocket.critical) {
            result.status = 'critical';
            result.warning = true;
            result.message = `Critical: WebSocket queue length at ${result.queueLength}`;
        } else if (result.queueLength >= THRESHOLDS.websocket.warning) {
            result.status = 'warning';
            result.warning = true;
            result.message = `Warning: WebSocket queue length at ${result.queueLength}`;
        }
    } catch (error) {
        result.status = 'error';
        result.error = error.message;
    }

    return result;
}

/**
 * Generate comprehensive health report
 * @param {Object} io - Socket.IO server instance
 * @returns {Object} Full health report
 */
function generateHealthReport(io) {
    const timestamp = new Date().toISOString();
    const warnings = [];
    const errors = [];

    // Run all checks
    const databases = checkDatabaseIntegrity();
    const disk = checkDiskSpace();
    const memory = checkMemoryUsage();
    const websocket = getWebSocketStats(io);

    // Collect warnings and errors
    if (databases.status !== 'healthy') {
        if (databases.errors) {
            errors.push(...databases.errors);
        }
    }
    if (disk.warning && disk.message) {
        warnings.push(disk.message);
    }
    if (disk.status === 'error') {
        errors.push(`Disk check: ${disk.error}`);
    }
    if (memory.warning && memory.message) {
        warnings.push(memory.message);
    }
    if (memory.status === 'error') {
        errors.push(`Memory check: ${memory.error}`);
    }
    if (websocket.warning && websocket.message) {
        warnings.push(websocket.message);
    }
    if (websocket.status === 'error') {
        errors.push(`WebSocket check: ${websocket.error}`);
    }

    // Determine overall status
    let overallStatus = 'healthy';
    if (errors.length > 0 ||
        databases.status === 'unhealthy' ||
        disk.status === 'critical' ||
        memory.status === 'critical' ||
        websocket.status === 'critical') {
        overallStatus = 'unhealthy';
    } else if (warnings.length > 0 ||
               disk.status === 'warning' ||
               memory.status === 'warning' ||
               websocket.status === 'warning') {
        overallStatus = 'degraded';
    }

    return {
        status: overallStatus,
        timestamp,
        checks: {
            databases,
            disk,
            memory,
            websocket
        },
        warnings,
        errors,
        thresholds: THRESHOLDS
    };
}

/**
 * Generate quick health check (for load balancers)
 * @param {Object} io - Socket.IO server instance
 * @returns {Object} Quick health status
 */
function generateQuickHealth(io) {
    const timestamp = new Date().toISOString();
    let status = 'healthy';

    // Quick database connection test
    let dbOk = true;
    try {
        if (db?.tournaments) {
            db.tournaments.getDb().prepare('SELECT 1').get();
        } else {
            dbOk = false;
        }
    } catch {
        dbOk = false;
    }

    // Quick memory check
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;
    const memoryOk = memoryUsage < THRESHOLDS.memory.critical;

    // Determine status
    if (!dbOk || !memoryOk) {
        status = 'unhealthy';
    } else if (memoryUsage >= THRESHOLDS.memory.warning) {
        status = 'degraded';
    }

    return {
        status,
        timestamp,
        database: dbOk ? 'ok' : 'error',
        memory: memoryOk ? 'ok' : 'warning',
        uptime: process.uptime()
    };
}

module.exports = {
    init,
    checkDatabaseIntegrity,
    checkDiskSpace,
    checkMemoryUsage,
    getWebSocketStats,
    generateHealthReport,
    generateQuickHealth,
    THRESHOLDS
};
