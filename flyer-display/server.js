/**
 * Flyer Display Service
 *
 * Standalone multi-tenant flyer display server.
 * Serves per-user flyer displays at /u/:userId/flyer
 *
 * Port: 2054 (uses legacy MagicMirror-flyer port for admin-dashboard compatibility)
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 2054;
const ADMIN_URL = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000';
const ADMIN_WS_URL = process.env.ADMIN_WS_URL || 'http://localhost:3000';
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Logging utility
function log(action, data = {}) {
    if (DEBUG_MODE) {
        console.log(`[${new Date().toISOString()}] [flyer-display:${action}]`, JSON.stringify(data));
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
        service: 'flyer-display',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Status endpoint for admin dashboard compatibility
// Admin dashboard pre-flight checklist calls this to verify module is online
app.get('/api/flyer/status', (req, res) => {
    res.json({
        success: true,
        message: 'Flyer Display service is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        port: PORT,
        service: 'flyer-display',
        version: '1.0.0'
    });
});

// Also support /api/tournament/status for legacy compatibility
app.get('/api/tournament/status', (req, res) => {
    res.json({
        success: true,
        message: 'Flyer Display service is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        port: PORT,
        service: 'flyer-display',
        version: '1.0.0'
    });
});

// Main display route
app.get('/u/:userId/flyer', async (req, res) => {
    const { userId } = req.params;
    log('renderDisplay', { userId });

    res.render('flyer-display', {
        userId,
        adminUrl: ADMIN_URL,
        adminWsUrl: ADMIN_WS_URL,
        debugMode: DEBUG_MODE
    });
});

// Catch-all for /u/:userId routes (redirect to flyer)
app.get('/u/:userId', (req, res) => {
    res.redirect(`/u/${req.params.userId}/flyer`);
});

// Root redirect to documentation/health
app.get('/', (req, res) => {
    res.json({
        service: 'Flyer Display Service',
        version: '1.0.0',
        usage: 'Access /u/:userId/flyer for per-user flyer display',
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
    console.error(`[${new Date().toISOString()}] [flyer-display:error]`, err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: DEBUG_MODE ? err.message : 'An error occurred'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`[Flyer Display] Server running on port ${PORT}`);
    console.log(`[Flyer Display] Admin Dashboard URL: ${ADMIN_URL}`);
    console.log(`[Flyer Display] WebSocket URL: ${ADMIN_WS_URL}`);
    console.log(`[Flyer Display] Debug Mode: ${DEBUG_MODE}`);
});

module.exports = app;
