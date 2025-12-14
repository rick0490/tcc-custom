/**
 * Match Display Service
 *
 * Standalone multi-tenant match display server.
 * Serves per-user match displays at /u/:userId/match
 *
 * Port: 2052 (uses legacy MagicMirror-match port for admin-dashboard compatibility)
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 2052;
const ADMIN_URL = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000';
const ADMIN_WS_URL = process.env.ADMIN_WS_URL || 'http://localhost:3000';
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Logging utility
function log(action, data = {}) {
    if (DEBUG_MODE) {
        console.log(`[${new Date().toISOString()}] [match-display:${action}]`, JSON.stringify(data));
    }
}

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files with cache headers
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
    }
}));

// JSON body parsing
app.use(express.json());

// Rate limiting for display routes (prevent abuse)
const displayLimiter = rateLimit({
    windowMs: 1000, // 1 second
    max: 30, // 30 requests per second per IP
    message: { success: false, error: 'Too many requests' }
});

// Apply rate limiting to user routes
app.use('/u/', displayLimiter);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        service: 'match-display',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Status endpoint for admin dashboard compatibility
// Admin dashboard pre-flight checklist calls this to verify module is online
app.get('/api/tournament/status', (req, res) => {
    res.json({
        success: true,
        message: 'Match Display service is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        port: PORT,
        service: 'match-display',
        version: '1.0.0'
    });
});

// Get active tournament for user (HTTP fallback)
app.get('/api/u/:userId/tournament', async (req, res) => {
    const { userId } = req.params;
    log('getTournament', { userId });

    try {
        // Fetch active tournament for this user from admin dashboard
        const response = await axios.get(
            `${ADMIN_URL}/api/tournaments`,
            {
                params: { userId, state: 'underway' },
                headers: { 'X-Internal-Request': 'true' },
                timeout: 5000
            }
        );

        if (response.data.success && response.data.tournaments && response.data.tournaments.length > 0) {
            // Return the most recent underway tournament
            const tournament = response.data.tournaments[0];
            res.json({
                success: true,
                tournament: {
                    id: tournament.id,
                    name: tournament.name,
                    urlSlug: tournament.url_slug || tournament.urlSlug,
                    gameId: tournament.game_id || tournament.gameId,
                    state: tournament.state,
                    tournamentType: tournament.tournament_type || tournament.tournamentType
                }
            });
        } else {
            res.json({
                success: true,
                tournament: null,
                message: 'No active tournament'
            });
        }
    } catch (error) {
        log('getTournamentError', { userId, error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to fetch tournament',
            message: error.message
        });
    }
});

// Get matches for tournament (HTTP fallback)
app.get('/api/u/:userId/matches/:tournamentId', async (req, res) => {
    const { userId, tournamentId } = req.params;
    log('getMatches', { userId, tournamentId });

    try {
        const response = await axios.get(
            `${ADMIN_URL}/api/matches/${tournamentId}`,
            {
                headers: { 'X-Internal-Request': 'true' },
                timeout: 5000
            }
        );

        res.json(response.data);
    } catch (error) {
        log('getMatchesError', { userId, tournamentId, error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to fetch matches',
            message: error.message
        });
    }
});

// Main display route
app.get('/u/:userId/match', async (req, res) => {
    const { userId } = req.params;
    log('renderDisplay', { userId });

    // Optional: Validate userId exists
    // For now, we let the client handle missing user gracefully

    res.render('match-display', {
        userId,
        adminWsUrl: ADMIN_WS_URL,
        debugMode: DEBUG_MODE
    });
});

// Catch-all for /u/:userId routes (redirect to match)
app.get('/u/:userId', (req, res) => {
    res.redirect(`/u/${req.params.userId}/match`);
});

// Root redirect to documentation/health
app.get('/', (req, res) => {
    res.json({
        service: 'Match Display Service',
        version: '1.0.0',
        usage: 'Access /u/:userId/match for per-user match display',
        health: '/api/health',
        documentation: 'See CLAUDE.md for full documentation'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Not found',
        path: req.path
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] [match-display:error]`, err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: DEBUG_MODE ? err.message : 'An error occurred'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`[Match Display] Server running on port ${PORT}`);
    console.log(`[Match Display] Admin Dashboard URL: ${ADMIN_URL}`);
    console.log(`[Match Display] WebSocket URL: ${ADMIN_WS_URL}`);
    console.log(`[Match Display] Debug Mode: ${DEBUG_MODE}`);
});

module.exports = app;
