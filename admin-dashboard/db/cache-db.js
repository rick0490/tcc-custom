/**
 * Cache Database Module
 * SQLite database for ephemeral API response caching
 *
 * This database can be deleted anytime without data loss.
 * Contains: cache_tournaments, cache_matches, cache_participants,
 *           cache_stations, cache_tournament_details, cache_stats
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'cache.db');
let db = null;

// Default TTL values in seconds
const DEFAULT_TTL = {
    tournaments: 60,       // Tournament list
    matches: 30,           // Match data
    participants: 120,     // Participant list
    stations: 300,         // Station list
    tournamentDetails: 300 // Tournament details
};

// Shorter TTL for active tournaments
const ACTIVE_TTL = {
    tournaments: 30,
    matches: 15,
    participants: 60,
    stations: 60,
    tournamentDetails: 120
};

// Cache table mapping
const CACHE_TABLES = {
    tournaments: 'cache_tournaments',
    matches: 'cache_matches',
    participants: 'cache_participants',
    stations: 'cache_stations',
    tournamentDetails: 'cache_tournament_details'
};

// Track if we're in active tournament mode
let isActiveTournamentMode = false;

/**
 * Initialize database connection and create tables
 */
function initDatabase() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    db.exec(`
        -- Tournament list cache
        CREATE TABLE IF NOT EXISTS cache_tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cache_key TEXT UNIQUE NOT NULL,
            data_json TEXT,
            cached_at DATETIME,
            expires_at DATETIME
        );

        -- Match data cache
        CREATE TABLE IF NOT EXISTS cache_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT UNIQUE NOT NULL,
            data_json TEXT,
            match_count INTEGER,
            cached_at DATETIME,
            expires_at DATETIME
        );

        -- Participant data cache
        CREATE TABLE IF NOT EXISTS cache_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT UNIQUE NOT NULL,
            data_json TEXT,
            participant_count INTEGER,
            cached_at DATETIME,
            expires_at DATETIME
        );

        -- Station data cache
        CREATE TABLE IF NOT EXISTS cache_stations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT UNIQUE NOT NULL,
            data_json TEXT,
            cached_at DATETIME,
            expires_at DATETIME
        );

        -- Tournament details cache
        CREATE TABLE IF NOT EXISTS cache_tournament_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT UNIQUE NOT NULL,
            data_json TEXT,
            cached_at DATETIME,
            expires_at DATETIME
        );

        -- Cache statistics
        CREATE TABLE IF NOT EXISTS cache_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cache_type TEXT UNIQUE NOT NULL,
            hits INTEGER DEFAULT 0,
            misses INTEGER DEFAULT 0,
            api_calls_saved INTEGER DEFAULT 0,
            last_hit DATETIME,
            last_miss DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_cache_tournaments_key ON cache_tournaments(cache_key);
        CREATE INDEX IF NOT EXISTS idx_cache_tournaments_expires ON cache_tournaments(expires_at);
        CREATE INDEX IF NOT EXISTS idx_cache_matches_tournament ON cache_matches(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_cache_matches_expires ON cache_matches(expires_at);
        CREATE INDEX IF NOT EXISTS idx_cache_participants_tournament ON cache_participants(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_cache_participants_expires ON cache_participants(expires_at);
        CREATE INDEX IF NOT EXISTS idx_cache_stations_tournament ON cache_stations(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_cache_stations_expires ON cache_stations(expires_at);
        CREATE INDEX IF NOT EXISTS idx_cache_details_tournament ON cache_tournament_details(tournament_id);
        CREATE INDEX IF NOT EXISTS idx_cache_details_expires ON cache_tournament_details(expires_at);
    `);

    console.log('[Cache DB] Database initialized at', DB_PATH);
    return db;
}

/**
 * Get database instance
 */
function getDb() {
    if (!db) {
        initDatabase();
    }
    return db;
}

/**
 * Close database connection
 */
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Get database file path
 */
function getDbPath() {
    return DB_PATH;
}

/**
 * Set active tournament mode (shorter TTLs)
 */
function setActiveTournamentMode(active) {
    isActiveTournamentMode = active;
}

/**
 * Get TTL for a cache type
 */
function getTTL(type) {
    const ttlConfig = isActiveTournamentMode ? ACTIVE_TTL : DEFAULT_TTL;
    return ttlConfig[type] || DEFAULT_TTL.tournaments;
}

/**
 * Get cached data
 * @param {string} type - Cache type
 * @param {string} key - Cache key
 * @returns {Object|null} Cached data with metadata or null
 */
function getCachedData(type, key) {
    const database = getDb();
    const table = CACHE_TABLES[type];

    if (!table) {
        console.warn(`[Cache] Unknown cache type: ${type}`);
        return null;
    }

    try {
        let row;
        if (type === 'tournaments') {
            row = database.prepare(`SELECT * FROM ${table} WHERE cache_key = ?`).get(key);
        } else {
            row = database.prepare(`SELECT * FROM ${table} WHERE tournament_id = ?`).get(key);
        }

        if (!row) {
            incrementStats(type, 'miss');
            return null;
        }

        const now = new Date();
        const expiresAt = new Date(row.expires_at);
        const cachedAt = new Date(row.cached_at);
        const isExpired = now > expiresAt;
        const ageSeconds = Math.floor((now - cachedAt) / 1000);

        incrementStats(type, 'hit');

        return {
            data: JSON.parse(row.data_json),
            cachedAt: row.cached_at,
            expiresAt: row.expires_at,
            ageSeconds,
            isExpired,
            isStale: isExpired,
            _cache: {
                hit: true,
                source: 'database',
                cachedAt: row.cached_at,
                ageSeconds,
                stale: isExpired
            }
        };
    } catch (error) {
        console.error(`[Cache] Error reading ${type} cache:`, error.message);
        return null;
    }
}

/**
 * Set cached data
 * @param {string} type - Cache type
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} ttlSeconds - Optional TTL override
 */
function setCachedData(type, key, data, ttlSeconds = null) {
    const database = getDb();
    const table = CACHE_TABLES[type];

    if (!table) {
        console.warn(`[Cache] Unknown cache type: ${type}`);
        return false;
    }

    const ttl = ttlSeconds || getTTL(type);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (ttl * 1000));

    try {
        const dataJson = JSON.stringify(data);

        if (type === 'tournaments') {
            database.prepare(`
                INSERT INTO ${table} (cache_key, data_json, cached_at, expires_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    data_json = excluded.data_json,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at
            `).run(key, dataJson, now.toISOString(), expiresAt.toISOString());
        } else if (type === 'matches') {
            const matchCount = Array.isArray(data) ? data.length : (data.matches?.length || 0);
            database.prepare(`
                INSERT INTO ${table} (tournament_id, data_json, match_count, cached_at, expires_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(tournament_id) DO UPDATE SET
                    data_json = excluded.data_json,
                    match_count = excluded.match_count,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at
            `).run(key, dataJson, matchCount, now.toISOString(), expiresAt.toISOString());
        } else if (type === 'participants') {
            const participantCount = Array.isArray(data) ? data.length : 0;
            database.prepare(`
                INSERT INTO ${table} (tournament_id, data_json, participant_count, cached_at, expires_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(tournament_id) DO UPDATE SET
                    data_json = excluded.data_json,
                    participant_count = excluded.participant_count,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at
            `).run(key, dataJson, participantCount, now.toISOString(), expiresAt.toISOString());
        } else {
            database.prepare(`
                INSERT INTO ${table} (tournament_id, data_json, cached_at, expires_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(tournament_id) DO UPDATE SET
                    data_json = excluded.data_json,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at
            `).run(key, dataJson, now.toISOString(), expiresAt.toISOString());
        }

        incrementStats(type, 'api_saved');
        return true;
    } catch (error) {
        console.error(`[Cache] Error writing ${type} cache:`, error.message);
        return false;
    }
}

/**
 * Get cached data or fetch from source
 * Implements stale-while-revalidate pattern
 * @param {string} type - Cache type
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Async function to fetch fresh data
 * @param {number} ttlSeconds - Optional TTL override
 * @param {Object} options - Additional options
 * @returns {Object} { data, _cache }
 */
async function getCachedOrFetch(type, key, fetchFn, ttlSeconds = null, options = {}) {
    const { forWrite = false } = options;

    // For write operations, always fetch fresh data
    if (forWrite) {
        try {
            const freshData = await fetchFn();
            setCachedData(type, key, freshData, ttlSeconds);
            const version = extractVersion(freshData);
            return {
                data: freshData,
                _cache: {
                    hit: false,
                    source: 'api',
                    cachedAt: new Date().toISOString(),
                    ageSeconds: 0,
                    stale: false,
                    forWrite: true,
                    version
                }
            };
        } catch (error) {
            console.error(`[Cache] Fresh fetch failed for ${type}/${key} (forWrite):`, error.message);
            throw error;
        }
    }

    const cached = getCachedData(type, key);

    // Fresh cache hit - return immediately
    if (cached && !cached.isExpired) {
        const version = extractVersion(cached.data);
        return {
            data: cached.data,
            _cache: {
                ...cached._cache,
                version
            }
        };
    }

    // Stale cache - try to refresh, fall back to stale data
    if (cached && cached.isExpired) {
        try {
            const freshData = await fetchFn();
            setCachedData(type, key, freshData, ttlSeconds);
            const version = extractVersion(freshData);
            return {
                data: freshData,
                _cache: {
                    hit: false,
                    source: 'api',
                    cachedAt: new Date().toISOString(),
                    ageSeconds: 0,
                    stale: false,
                    version
                }
            };
        } catch (error) {
            console.warn(`[Cache] API failed for ${type}/${key}, serving stale data:`, error.message);
            const version = extractVersion(cached.data);
            return {
                data: cached.data,
                _cache: {
                    hit: true,
                    source: 'database',
                    cachedAt: cached.cachedAt,
                    ageSeconds: cached.ageSeconds,
                    stale: true,
                    offline: true,
                    error: error.message,
                    version
                }
            };
        }
    }

    // No cache - must fetch
    const freshData = await fetchFn();
    setCachedData(type, key, freshData, ttlSeconds);
    const version = extractVersion(freshData);
    return {
        data: freshData,
        _cache: {
            hit: false,
            source: 'api',
            cachedAt: new Date().toISOString(),
            ageSeconds: 0,
            stale: false,
            version
        }
    };
}

/**
 * Extract version identifier from data
 */
function extractVersion(data) {
    if (!data) return new Date().toISOString();

    if (data.updated_at) return data.updated_at;
    if (data.updatedAt) return data.updatedAt;
    if (data.timestamps?.updated_at) return data.timestamps.updated_at;

    if (Array.isArray(data) && data.length > 0) {
        const timestamps = data
            .map(item => item.updated_at || item.updatedAt || item.timestamps?.updated_at)
            .filter(Boolean)
            .sort()
            .reverse();
        if (timestamps.length > 0) return timestamps[0];
    }

    return new Date().toISOString();
}

/**
 * Invalidate cache for a specific type/key
 */
function invalidateCache(type, key = null) {
    const database = getDb();
    const table = CACHE_TABLES[type];

    if (!table) {
        console.warn(`[Cache] Unknown cache type: ${type}`);
        return false;
    }

    try {
        if (key) {
            if (type === 'tournaments') {
                if (key === 'list') {
                    database.prepare(`DELETE FROM ${table} WHERE cache_key LIKE 'list%'`).run();
                } else {
                    database.prepare(`DELETE FROM ${table} WHERE cache_key = ?`).run(key);
                }
            } else {
                database.prepare(`DELETE FROM ${table} WHERE tournament_id = ?`).run(key);
            }
            console.log(`[Cache] Invalidated ${type}/${key}`);
        } else {
            database.prepare(`DELETE FROM ${table}`).run();
            console.log(`[Cache] Invalidated all ${type} cache`);
        }
        return true;
    } catch (error) {
        console.error(`[Cache] Error invalidating ${type}:`, error.message);
        return false;
    }
}

/**
 * Invalidate all caches for a tournament
 */
function invalidateTournamentCaches(tournamentId) {
    invalidateCache('matches', tournamentId);
    invalidateCache('participants', tournamentId);
    invalidateCache('stations', tournamentId);
    invalidateCache('tournamentDetails', tournamentId);
    console.log(`[Cache] Invalidated all caches for tournament ${tournamentId}`);
}

/**
 * Invalidate all cached data
 */
function invalidateAllCache() {
    const database = getDb();

    try {
        Object.values(CACHE_TABLES).forEach(table => {
            database.prepare(`DELETE FROM ${table}`).run();
        });
        console.log('[Cache] Invalidated all caches');
        return true;
    } catch (error) {
        console.error('[Cache] Error invalidating all caches:', error.message);
        return false;
    }
}

/**
 * Clean up expired cache entries
 */
function cleanupExpiredCache() {
    const database = getDb();
    const now = new Date().toISOString();
    let totalDeleted = 0;

    try {
        Object.values(CACHE_TABLES).forEach(table => {
            const result = database.prepare(`DELETE FROM ${table} WHERE expires_at < ?`).run(now);
            totalDeleted += result.changes;
        });

        if (totalDeleted > 0) {
            console.log(`[Cache] Cleaned up ${totalDeleted} expired entries`);
        }
        return totalDeleted;
    } catch (error) {
        console.error('[Cache] Error cleaning up expired cache:', error.message);
        return 0;
    }
}

/**
 * Increment cache statistics
 */
function incrementStats(type, stat) {
    const database = getDb();
    const now = new Date().toISOString();

    try {
        database.prepare(`
            INSERT OR IGNORE INTO cache_stats (cache_type, hits, misses, api_calls_saved, created_at)
            VALUES (?, 0, 0, 0, ?)
        `).run(type, now);

        if (stat === 'hit') {
            database.prepare(`
                UPDATE cache_stats SET hits = hits + 1, last_hit = ? WHERE cache_type = ?
            `).run(now, type);
        } else if (stat === 'miss') {
            database.prepare(`
                UPDATE cache_stats SET misses = misses + 1, last_miss = ? WHERE cache_type = ?
            `).run(now, type);
        } else if (stat === 'api_saved') {
            database.prepare(`
                UPDATE cache_stats SET api_calls_saved = api_calls_saved + 1 WHERE cache_type = ?
            `).run(type);
        }
    } catch (error) {
        // Non-critical - silent fail
    }
}

/**
 * Get cache statistics
 */
function getCacheStats() {
    const database = getDb();

    try {
        const stats = database.prepare('SELECT * FROM cache_stats').all();
        const result = {
            byType: {},
            totals: {
                hits: 0,
                misses: 0,
                apiCallsSaved: 0,
                hitRate: 0
            }
        };

        stats.forEach(row => {
            result.byType[row.cache_type] = {
                hits: row.hits,
                misses: row.misses,
                apiCallsSaved: row.api_calls_saved,
                hitRate: row.hits + row.misses > 0
                    ? ((row.hits / (row.hits + row.misses)) * 100).toFixed(1) + '%'
                    : 'N/A',
                lastHit: row.last_hit,
                lastMiss: row.last_miss
            };
            result.totals.hits += row.hits;
            result.totals.misses += row.misses;
            result.totals.apiCallsSaved += row.api_calls_saved;
        });

        const totalRequests = result.totals.hits + result.totals.misses;
        result.totals.hitRate = totalRequests > 0
            ? ((result.totals.hits / totalRequests) * 100).toFixed(1) + '%'
            : 'N/A';

        // Add cache entry counts
        Object.keys(CACHE_TABLES).forEach(type => {
            const table = CACHE_TABLES[type];
            const count = database.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
            if (!result.byType[type]) {
                result.byType[type] = { hits: 0, misses: 0, apiCallsSaved: 0, hitRate: 'N/A' };
            }
            result.byType[type].entries = count.count;
        });

        return result;
    } catch (error) {
        console.error('[Cache] Error getting stats:', error.message);
        return { byType: {}, totals: { hits: 0, misses: 0, apiCallsSaved: 0, hitRate: 'N/A' } };
    }
}

/**
 * Reset cache statistics
 */
function resetCacheStats() {
    const database = getDb();

    try {
        database.prepare('DELETE FROM cache_stats').run();
        console.log('[Cache] Statistics reset');
        return true;
    } catch (error) {
        console.error('[Cache] Error resetting stats:', error.message);
        return false;
    }
}

/**
 * Get cache summary for a tournament
 */
function getTournamentCacheSummary(tournamentId) {
    const database = getDb();
    const summary = {};

    try {
        ['matches', 'participants', 'stations', 'tournamentDetails'].forEach(type => {
            const table = CACHE_TABLES[type];
            const row = database.prepare(`SELECT cached_at, expires_at FROM ${table} WHERE tournament_id = ?`).get(tournamentId);
            if (row) {
                const now = new Date();
                const cachedAt = new Date(row.cached_at);
                const expiresAt = new Date(row.expires_at);
                summary[type] = {
                    cached: true,
                    cachedAt: row.cached_at,
                    expiresAt: row.expires_at,
                    ageSeconds: Math.floor((now - cachedAt) / 1000),
                    expired: now > expiresAt
                };
            } else {
                summary[type] = { cached: false };
            }
        });
        return summary;
    } catch (error) {
        console.error('[Cache] Error getting tournament cache summary:', error.message);
        return {};
    }
}

module.exports = {
    // Core functions
    initDatabase,
    getDb,
    closeDatabase,
    getDbPath,
    DB_PATH,

    // Core cache operations
    getCachedData,
    setCachedData,
    getCachedOrFetch,

    // Invalidation
    invalidateCache,
    invalidateTournamentCaches,
    invalidateAllCache,

    // Maintenance
    cleanupExpiredCache,

    // Configuration
    setActiveTournamentMode,
    getTTL,
    DEFAULT_TTL,
    ACTIVE_TTL,

    // Statistics
    getCacheStats,
    resetCacheStats,
    getTournamentCacheSummary
};
