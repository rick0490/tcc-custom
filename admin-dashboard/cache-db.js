/**
 * Cache Database Module
 * SQLite-based caching for tournament data
 * Reduces redundant queries and provides offline resilience
 */

const cacheDb = require('./db/cache-db');

// Default TTL values in seconds
const DEFAULT_TTL = {
	tournaments: 60,      // Tournament list
	matches: 30,          // Match data
	participants: 120,    // Participant list
	stations: 300,        // Station list
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

// Track if we're in active tournament mode (set by server.js)
let isActiveTournamentMode = false;

/**
 * Set active tournament mode (shorter TTLs)
 * @param {boolean} active
 */
function setActiveTournamentMode(active) {
	isActiveTournamentMode = active;
}

/**
 * Get TTL for a cache type
 * @param {string} type - Cache type
 * @returns {number} TTL in seconds
 */
function getTTL(type) {
	const ttlConfig = isActiveTournamentMode ? ACTIVE_TTL : DEFAULT_TTL;
	return ttlConfig[type] || DEFAULT_TTL.tournaments;
}

/**
 * Get cached data
 * @param {string} type - Cache type (tournaments, matches, participants, stations, tournamentDetails)
 * @param {string} key - Cache key (e.g., 'list' for tournaments, tournamentId for others)
 * @returns {Object|null} Cached data with metadata or null if not found/expired
 */
function getCachedData(type, key) {
	const db = cacheDb.getDb();
	const table = CACHE_TABLES[type];

	if (!table) {
		console.warn(`[Cache] Unknown cache type: ${type}`);
		return null;
	}

	try {
		let row;
		if (type === 'tournaments') {
			row = db.prepare(`SELECT * FROM ${table} WHERE cache_key = ?`).get(key);
		} else {
			row = db.prepare(`SELECT * FROM ${table} WHERE tournament_id = ?`).get(key);
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

		// Update hit stats
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
	const db = cacheDb.getDb();
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
			db.prepare(`
				INSERT INTO ${table} (cache_key, data_json, cached_at, expires_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(cache_key) DO UPDATE SET
					data_json = excluded.data_json,
					cached_at = excluded.cached_at,
					expires_at = excluded.expires_at
			`).run(key, dataJson, now.toISOString(), expiresAt.toISOString());
		} else if (type === 'matches') {
			const matchCount = Array.isArray(data) ? data.length : (data.matches?.length || 0);
			db.prepare(`
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
			db.prepare(`
				INSERT INTO ${table} (tournament_id, data_json, participant_count, cached_at, expires_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(tournament_id) DO UPDATE SET
					data_json = excluded.data_json,
					participant_count = excluded.participant_count,
					cached_at = excluded.cached_at,
					expires_at = excluded.expires_at
			`).run(key, dataJson, participantCount, now.toISOString(), expiresAt.toISOString());
		} else {
			db.prepare(`
				INSERT INTO ${table} (tournament_id, data_json, cached_at, expires_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(tournament_id) DO UPDATE SET
					data_json = excluded.data_json,
					cached_at = excluded.cached_at,
					expires_at = excluded.expires_at
			`).run(key, dataJson, now.toISOString(), expiresAt.toISOString());
		}

		// Increment API calls saved stat
		incrementStats(type, 'api_saved');

		return true;
	} catch (error) {
		console.error(`[Cache] Error writing ${type} cache:`, error.message);
		return false;
	}
}

/**
 * Get cached data or fetch from API
 * Implements stale-while-revalidate pattern
 * @param {string} type - Cache type
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Async function to fetch fresh data
 * @param {number} ttlSeconds - Optional TTL override
 * @param {Object} options - Additional options
 * @param {boolean} options.forWrite - If true, always fetch fresh data (bypass cache for edit operations)
 * @returns {Object} { data, _cache }
 */
async function getCachedOrFetch(type, key, fetchFn, ttlSeconds = null, options = {}) {
	const { forWrite = false } = options;

	// For write operations, ALWAYS fetch fresh data to prevent stale data overwrites
	if (forWrite) {
		try {
			const freshData = await fetchFn();
			setCachedData(type, key, freshData, ttlSeconds);
			// Extract version from the data (updated_at timestamp)
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
			throw error; // Don't serve stale data for write operations
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
			// API failed - return stale data with warning
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
		// No cache and API failed - throw error
		throw error;
	}
}

/**
 * Extract version identifier from data
 * Uses updated_at timestamp if available, falls back to current time
 * @param {any} data - Data to extract version from
 * @returns {string} Version string (ISO timestamp)
 */
function extractVersion(data) {
	if (!data) return new Date().toISOString();

	// Tournament data cache
	if (data.updated_at) return data.updated_at;
	if (data.updatedAt) return data.updatedAt;

	// Nested in timestamps object (v2.1 format)
	if (data.timestamps?.updated_at) return data.timestamps.updated_at;

	// Array of items - use most recent
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
 * @param {string} type - Cache type
 * @param {string} key - Cache key (optional, if not provided invalidates all of type)
 */
function invalidateCache(type, key = null) {
	const db = cacheDb.getDb();
	const table = CACHE_TABLES[type];

	if (!table) {
		console.warn(`[Cache] Unknown cache type: ${type}`);
		return false;
	}

	try {
		if (key) {
			if (type === 'tournaments') {
				// Use LIKE pattern for 'list' to match 'list_30', 'list_90', etc.
				if (key === 'list') {
					db.prepare(`DELETE FROM ${table} WHERE cache_key LIKE 'list%'`).run();
				} else {
					db.prepare(`DELETE FROM ${table} WHERE cache_key = ?`).run(key);
				}
			} else {
				db.prepare(`DELETE FROM ${table} WHERE tournament_id = ?`).run(key);
			}
			console.log(`[Cache] Invalidated ${type}/${key}`);
		} else {
			db.prepare(`DELETE FROM ${table}`).run();
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
 * @param {string} tournamentId
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
	const db = cacheDb.getDb();

	try {
		Object.values(CACHE_TABLES).forEach(table => {
			db.prepare(`DELETE FROM ${table}`).run();
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
	const db = cacheDb.getDb();
	const now = new Date().toISOString();
	let totalDeleted = 0;

	try {
		Object.values(CACHE_TABLES).forEach(table => {
			const result = db.prepare(`DELETE FROM ${table} WHERE expires_at < ?`).run(now);
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
 * @param {string} type - Cache type
 * @param {string} stat - Stat to increment ('hit', 'miss', 'api_saved')
 */
function incrementStats(type, stat) {
	const db = cacheDb.getDb();
	const now = new Date().toISOString();

	try {
		// Ensure stats row exists
		db.prepare(`
			INSERT OR IGNORE INTO cache_stats (cache_type, hits, misses, api_calls_saved, created_at)
			VALUES (?, 0, 0, 0, ?)
		`).run(type, now);

		// Increment the appropriate stat
		if (stat === 'hit') {
			db.prepare(`
				UPDATE cache_stats SET hits = hits + 1, last_hit = ? WHERE cache_type = ?
			`).run(now, type);
		} else if (stat === 'miss') {
			db.prepare(`
				UPDATE cache_stats SET misses = misses + 1, last_miss = ? WHERE cache_type = ?
			`).run(now, type);
		} else if (stat === 'api_saved') {
			db.prepare(`
				UPDATE cache_stats SET api_calls_saved = api_calls_saved + 1 WHERE cache_type = ?
			`).run(type);
		}
	} catch (error) {
		// Non-critical - don't log every time
	}
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics by type
 */
function getCacheStats() {
	const db = cacheDb.getDb();

	try {
		const stats = db.prepare('SELECT * FROM cache_stats').all();
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
			const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
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
	const db = cacheDb.getDb();

	try {
		db.prepare('DELETE FROM cache_stats').run();
		console.log('[Cache] Statistics reset');
		return true;
	} catch (error) {
		console.error('[Cache] Error resetting stats:', error.message);
		return false;
	}
}

/**
 * Get cache summary for a tournament
 * @param {string} tournamentId
 * @returns {Object} Summary of cached data for tournament
 */
function getTournamentCacheSummary(tournamentId) {
	const db = cacheDb.getDb();
	const summary = {};

	try {
		['matches', 'participants', 'stations', 'tournamentDetails'].forEach(type => {
			const table = CACHE_TABLES[type];
			const row = db.prepare(`SELECT cached_at, expires_at FROM ${table} WHERE tournament_id = ?`).get(tournamentId);
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

// Export functions
module.exports = {
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
