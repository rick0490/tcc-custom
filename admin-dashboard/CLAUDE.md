# CLAUDE.md - Admin Dashboard

This file provides guidance to Claude Code when working with the admin dashboard.

## Overview

Express.js web dashboard for controlling tournament displays. Features modular page-based architecture with collapsible sidebar navigation.

**Technology:** Express 5.1.0, bcrypt, express-session, axios, multer, Tailwind CSS

**Access:** https://admin.despairhardware.com (default: admin / tournament2024)

## Architecture

### Page Structure

| Page | HTML | JavaScript | Purpose |
|------|------|------------|---------|
| Dashboard | index.html | dashboard.js | Quick overview, system status, active tournament, ticker messages |
| Command Center | command-center.html | command-center.js | Single-page tournament control: 4-quadrant layout, keyboard shortcuts, real-time updates |
| Tournament | tournament.html | tournament.js | Tournament selection, creation, editing, lifecycle |
| Matches | matches.html | matches.js | Score entry, mark underway, declare winners |
| Displays | displays.html | displays.js | Module status, registered Pi displays |
| Flyers | flyers.html | flyers.js | Upload, preview, delete, quick switch |
| Sponsors | sponsors.html | sponsors.js | Sponsor logo overlays for displays |
| Participants | participants.html | participants.js | View/manage participants, stats |
| Games | games.html | games.js | Manage game configurations (rules, prizes) |
| Analytics | analytics.html | analytics.js | Historical data, Elo rankings, seeding suggestions |
| Settings | settings.html | settings.js | Users, password, system settings |
| Login | login.html | (inline) | Authentication |

### Shared Utilities (utils.js)

All pages include `utils.js` which provides common functions:

```javascript
// Available globally after utils.js loads
escapeHtml(text)                    // XSS prevention
showAlert(message, type, duration)  // Global notifications
formatDate(dateString)              // Relative date formatting
formatFileSize(bytes)               // Human-readable file sizes
formatTime(timestamp)               // Time formatting
formatTimeAgo(dateStr)              // Relative time (5s ago, 2m ago)
debounce(func, wait)                // Rate limiting
setupVisibilityHandler(onVisible, onHidden)  // Page visibility
createPollingManager(pollFn, interval)       // Managed polling

// Last Updated Timestamps
getFreshness(dateStr, thresholds)   // Returns 'fresh', 'stale', or 'old'
getFreshnessColor(freshness)        // Returns Tailwind color class
formatRelativeTime(dateStr, thresholds)     // Combines text + freshness
initLastUpdated(elementId, onRefreshClick, options)  // Initialize timestamp
setLastUpdated(elementId, timestamp)                 // Update timestamp
updateLastUpdatedDisplay(elementId)                  // Refresh display

// CSRF Protection
getCsrfToken()                      // Read token from XSRF-TOKEN cookie
csrfFetch(url, options)             // Fetch wrapper with auto CSRF headers
refreshCsrfToken()                  // Refresh token from server
```

**CSRF Protection:**
All state-changing requests (POST/PUT/DELETE/PATCH) must include CSRF token. Use `csrfFetch()` instead of `fetch()`:

```javascript
// Before (vulnerable to CSRF)
const response = await fetch('/api/endpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
});

// After (CSRF protected)
const response = await csrfFetch('/api/endpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
});
```

`csrfFetch()` automatically:
- Reads CSRF token from `XSRF-TOKEN` cookie
- Adds `X-CSRF-Token` header to requests
- Retries once on 403 CSRF errors (refreshes token first)

### Shared Navigation (nav.js)

All pages use a shared collapsible sidebar injected by `initNavigation(pageName)`:

```javascript
// Called on DOMContentLoaded in each page
initNavigation('Dashboard');  // Highlights current page
```

**Features:**
- Collapsible sidebar (toggle with hamburger icon)
- State persisted in localStorage
- Mobile-responsive with overlay menu
- Active page highlighting
- **Dark/Light theme toggle** (persisted in localStorage)
- Logout button

### Theme System

The admin dashboard supports light and dark themes with automatic detection and persistence.

**Theme Toggle:**
- Located in sidebar footer (above logout button)
- Sun icon = currently dark mode (click to switch to light)
- Moon icon = currently light mode (click to switch to dark)

**Theme Persistence:**
- Stored in `localStorage.theme` ('light' or 'dark')
- System preference detection via `prefers-color-scheme`
- Inline script in `<head>` prevents flash of wrong theme

**CSS Variables:**
Themes are implemented using CSS custom properties defined in `style.css`:

```css
:root {
  /* Light theme (default) */
  --bg-primary: #ffffff;
  --bg-secondary: #f3f4f6;
  --text-primary: #111827;
  --accent-blue: #3b82f6;
  /* ... more variables */
}

[data-theme="dark"] {
  /* Dark theme */
  --bg-primary: #111827;
  --bg-secondary: #1f2937;
  --text-primary: #f3f4f6;
  /* ... more variables */
}
```

**Theme Functions (nav.js):**
```javascript
getTheme()          // Returns current theme ('light' or 'dark')
setTheme(theme)     // Sets theme with smooth transition
toggleTheme()       // Toggles between light and dark
initTheme()         // Initializes theme on page load
```

**Tailwind Class Overrides:**
Since Tailwind utility classes use hardcoded colors, `style.css` includes light mode overrides:

```css
/* Text colors - override Tailwind's white/gray text in light mode */
[data-theme="light"] .text-white,
[data-theme="light"] .text-gray-100,
[data-theme="light"] .text-gray-200 { color: var(--text-primary); }

[data-theme="light"] .text-gray-300,
[data-theme="light"] .text-gray-400 { color: var(--text-secondary); }

/* Background colors - override dark backgrounds in light mode */
[data-theme="light"] .bg-gray-800,
[data-theme="light"] .bg-gray-900 { background-color: var(--bg-secondary); }

/* Form inputs, tables, modals also have light mode overrides */
```

**CSS Variable Reference:**
| Variable | Light Mode | Dark Mode | Usage |
|----------|------------|-----------|-------|
| `--bg-primary` | #ffffff | #111827 | Page background |
| `--bg-secondary` | #f3f4f6 | #1f2937 | Cards, sections |
| `--bg-tertiary` | #e5e7eb | #374151 | Hover states |
| `--text-primary` | #111827 | #f3f4f6 | Main text |
| `--text-secondary` | #374151 | #d1d5db | Secondary text |
| `--text-muted` | #6b7280 | #9ca3af | Muted text |
| `--border-color` | #d1d5db | #374151 | Borders |
| `--accent-blue` | #3b82f6 | #3b82f6 | Primary accent |

**Adding Theme Support to New Components:**
Use CSS variables instead of hardcoded colors:
```css
/* Before */
.my-component { background: #1f2937; color: #f3f4f6; }

/* After */
.my-component { background: var(--bg-secondary); color: var(--text-primary); }
```

**Important:** If using Tailwind classes like `text-white` or `bg-gray-800`, the theme overrides in `style.css` will automatically handle light mode. For inline `<style>` blocks, use CSS variables directly.

### Frontend Patterns

- **Polling:** 10-15 second intervals with Page Visibility API (pauses when tab hidden)
- **Alerts:** Global notifications via `showAlert(message, type)` from utils.js
- **Toasts:** Section-specific via `showToast(message, type)`
- **State:** Global variables per page (e.g., `currentStatus`, `selectedTournament`)
- **Cache busting:** Version query strings (`?v=N`)
- **Shared utilities:** Common functions in `utils.js` (escapeHtml, showAlert, formatDate, etc.)
- **Last Updated Timestamps:** Relative time indicators on all data panels (see below)

### Last Updated Timestamps

All major data panels display a "Last updated" timestamp with freshness indicators:

**Pages with timestamps:**
- Dashboard: System status and tournament data
- Matches: Match list data
- Displays: Registered displays
- Participants: Participant list
- Flyers: Flyer gallery

**Freshness thresholds:**
| State | Default Threshold | Color |
|-------|-------------------|-------|
| Fresh | ≤ 30 seconds | Green (text-green-400) |
| Stale | ≤ 120 seconds | Yellow (text-yellow-400) |
| Old | > 120 seconds | Gray (text-gray-500) |

**Usage:**
```javascript
// Initialize on DOMContentLoaded
initLastUpdated('elementId', refreshFunction, {
  prefix: 'Updated',           // Display prefix text
  thresholds: { fresh: 30, stale: 120 }  // Custom thresholds
});

// Call after successful data load
setLastUpdated('elementId');  // Uses current time
setLastUpdated('elementId', new Date('2025-01-01'));  // Custom timestamp
```

**Features:**
- Click-to-refresh: Clicking the timestamp triggers the refresh callback
- Auto-update: Display refreshes every 10 seconds to keep relative time current
- Color-coded freshness: Visual indicator of data staleness
- Responsive: Hidden on mobile (sm:inline-flex) to save space

### Refresh Button Loading States

All refresh buttons show visual feedback during data loading:

**HTML Pattern:**
```html
<button id="refreshXxxBtn" onclick="refreshXxx()" class="... disabled:opacity-50 disabled:cursor-not-allowed">
    <svg id="refreshXxxIcon" class="w-4 h-4 transition-transform" ...>
        <!-- refresh icon path -->
    </svg>
    <span id="refreshXxxText">Refresh</span>
</button>
```

**JavaScript Pattern:**
```javascript
async function refreshXxx() {
    // Show loading state
    const btn = document.getElementById('refreshXxxBtn');
    const icon = document.getElementById('refreshXxxIcon');
    const text = document.getElementById('refreshXxxText');
    if (btn) btn.disabled = true;
    if (icon) icon.classList.add('animate-spin');
    if (text) text.textContent = 'Refreshing...';

    try {
        // ... fetch data ...
    } catch (error) {
        // ... handle error ...
    } finally {
        // Reset loading state
        if (btn) btn.disabled = false;
        if (icon) icon.classList.remove('animate-spin');
        if (text) text.textContent = 'Refresh';
    }
}
```

**Implemented on:**
| Page | Functions |
|------|-----------|
| Tournament | `refreshTournaments()` |
| Matches | `refreshMatches()`, `refreshStations()` |
| Displays | `refreshModuleStatus()`, `refreshDisplays()`, `refreshDebugLogs()` |
| Dashboard | `refreshAllStatus()` |
| Participants | `refreshParticipants()` |
| Flyers | `loadFlyers()` |
| Sponsors | `loadSponsors()` |
| Command Center | `refreshAll()` |

## Commands

```bash
# Development
npm run dev

# Production
npm start
sudo systemctl restart tournament-admin

# View logs
sudo journalctl -u tournament-admin -f

# Testing
npm test              # Run all tests
npm test -- --watch   # Watch mode
npm test -- --coverage # Coverage report
```

## Testing

The admin dashboard includes both unit/integration tests (Jest) and end-to-end tests (Playwright).

### Test Structure

```
__tests__/
├── api/                    # Jest API tests
│   ├── auth.test.js        # Authentication endpoints
│   ├── csrf.test.js        # CSRF protection endpoints
│   └── status.test.js      # System status endpoints
├── unit/                   # Jest unit tests
│   ├── rateLimiter.test.js # Rate limiting logic
│   └── validation.test.js  # Input validation
├── e2e/                    # Playwright E2E tests
│   ├── fixtures/
│   │   ├── auth.fixture.ts # Authentication fixture
│   │   ├── api-mocks.ts    # API mock helpers
│   │   └── test-data.ts    # Test credentials and data
│   ├── auth.spec.ts        # Login/logout flows
│   ├── navigation.spec.ts  # Sidebar, page navigation
│   ├── dashboard.spec.ts   # Dashboard features
│   ├── tournament.spec.ts  # Tournament wizard
│   ├── matches.spec.ts     # Match management
│   └── theme.spec.ts       # Theme toggle
└── setup.js                # Jest configuration
```

### Running Tests

```bash
# Unit/Integration Tests (Jest)
npm test                    # Run all unit tests (73 tests)
npm test -- --watch         # Watch mode for development
npm test -- --coverage      # Generate coverage report
npm test -- auth.test.js    # Run specific test file

# E2E Tests (Playwright)
npm run test:e2e            # Run E2E tests (headless)
npm run test:e2e:headed     # Run with browser visible
npm run test:e2e:debug      # Debug mode with inspector
npm run test:e2e:report     # View HTML test report

# All Tests
npm run test:all            # Run unit tests + E2E tests
```

### E2E Test Configuration

Playwright config in `playwright.config.ts`:
- Browser: Chromium (headless)
- Base URL: http://localhost:3098 (separate from dev/production)
- Serial execution (workers: 1) to avoid port conflicts
- Web server auto-start during tests
- Screenshots on failure
- Video recording on retry

### Test Categories

| Category | Tests | Purpose |
|----------|-------|---------|
| Authentication | 12 | Login, logout, session management, account lockout |
| CSRF Protection | 13 | Token generation, validation, exempt routes, error messages |
| Status API | 6 | System status, rate limit status, WebSocket status |
| Rate Limiter | 14 | Mode switching, dev mode, delay calculations |
| Validation | 28 | Input validation, data transformations |

### Writing New Tests

```javascript
// Example API test
const request = require('supertest');
const { app } = require('../../server');

describe('My API', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(app);
    await agent.post('/api/auth/login').send({
      username: 'testuser',
      password: 'testpass'
    });
  });

  test('GET /api/my-endpoint returns data', async () => {
    const res = await agent.get('/api/my-endpoint');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
```

### Test Environment

- Tests run with `NODE_ENV=test`
- Uses port 3099 to avoid conflicts
- Creates temporary test users (cleaned up after tests)
- Server not started when imported for testing

## Server Structure (server.js)

~10000 lines organized as:

1. **Imports & Config** (1-280)
2. **Rate Limiting System** (280-1410)
   - Rate mode constants `RATE_MODES` (~353)
   - Rate limiter queue state `challongeRateLimiter` (~360)
   - Adaptive rate state `adaptiveRateState` (~367)
   - Dev mode state `devModeState` (~385)
   - `getAdaptiveRateLimitSettings()` with defaults
   - `updateRateMode()` - mode transitions
   - `checkTournamentsAndUpdateMode()` - stale filtering
   - `startAdaptiveRateScheduler()` - 8-hour checks
   - Match polling state and functions
   - `getMinRequestDelay()` - delay calculation (~1169)
   - `executeRateLimitedRequest()` - queue processor (~1180)
   - `rateLimitedAxios` wrapper (~1412)
3. **Challonge API v2.1 Helpers** (1244-1410) - All API calls use v2.1
   - `getChallongeV2Headers()` - OAuth/legacy header generation (~1244)
   - `challongeV2Request()` - rate-limited v2.1 API wrapper (~1289)
4. **Auth Helpers & Middleware** (1410-1800)
5. **Public Routes** (1800-1970)
6. **Auth Routes** (1970-2590)
7. **Rate Limit & Cache API Routes** (2590-3140)
8. **Protected Routes** (3140+)
   - Status & Tournament Setup
   - Bracket Control Proxy
   - Tournament Creation
   - Flyer Management
   - Participant Management (bulk add uses `/bulk_add.json` endpoint)
   - Match Management
   - Station Management
   - Tournament Lifecycle
   - Display Management
   - User Management
   - Settings
   - System Monitoring (9 endpoints)
   - Analytics (13 endpoints, ~9000+)

### Challonge API Rate Limiter

All Challonge API calls use the `rateLimitedAxios` wrapper to prevent Cloudflare rate limiting. The system features **adaptive rate limiting** that adjusts based on tournament schedule.

**Key State Objects (server.js lines 116-150):**
```javascript
// Rate mode constants
const RATE_MODES = {
    IDLE: { name: 'IDLE', description: 'No upcoming tournaments' },
    UPCOMING: { name: 'UPCOMING', description: 'Tournament starting soon' },
    ACTIVE: { name: 'ACTIVE', description: 'Tournament underway' }
};

// Rate limiter queue state
const challongeRateLimiter = {
    lastRequestTime: 0,
    requestQueue: [],
    isProcessing: false
};

// Adaptive rate state
const adaptiveRateState = {
    currentMode: RATE_MODES.IDLE,
    effectiveRate: 1,
    manualOverride: null,  // null for auto, or RATE_MODES.X to force
    upcomingTournament: null,
    activeTournament: null,
    lastCheck: null,
    nextCheck: null
};

// Dev mode state (3-hour bypass)
const devModeState = {
    active: false,
    activatedAt: null,
    expiresAt: null,
    timeoutId: null
};
const DEV_MODE_DURATION_MS = 3 * 60 * 60 * 1000;  // 3 hours
```

**Request Delay Calculation (line 777):**
```javascript
function getMinRequestDelay() {
    if (isDevModeActive()) return 0;  // No delay in dev mode
    const requestsPerMinute = getChallongeRateLimit();
    return Math.ceil(60000 / requestsPerMinute);  // e.g., 12 req/min = 5000ms
}
```

**Rate-Limited Axios Wrapper (line 901):**
```javascript
const rateLimitedAxios = {
    get: (...args) => executeRateLimitedRequest(() => axios.get(...args)),
    post: (...args) => executeRateLimitedRequest(() => axios.post(...args)),
    put: (...args) => executeRateLimitedRequest(() => axios.put(...args)),
    delete: (...args) => executeRateLimitedRequest(() => axios.delete(...args)),
    patch: (...args) => executeRateLimitedRequest(() => axios.patch(...args))
};
// All 50+ Challonge API calls use rateLimitedAxios
```

### Centralized Match Polling

The admin dashboard handles all Challonge API polling for match data and pushes updates to MagicMirror-match. This ensures all API calls go through the rate limiter.

```javascript
// Match polling state (server.js)
const matchPollingState = {
    intervalId: null,
    isPolling: false,
    lastPollTime: null,
    pollIntervalMs: 15000,      // 15 seconds (ACTIVE mode)
    devModePollIntervalMs: 5000  // 5 seconds (dev mode)
};

// Key functions
shouldPollMatches()      // Returns true if ACTIVE mode or dev mode
getMatchPollInterval()   // Returns 5000 (dev) or 15000 (normal)
fetchAndPushMatches()    // Fetches from Challonge, pushes to MagicMirror
startMatchPolling()      // Starts interval timer
stopMatchPolling()       // Stops interval timer
updateMatchPolling()     // Starts/stops based on current mode
```

**Polling behavior by rate mode:**
| Mode | Match Polling | Interval |
|------|--------------|----------|
| IDLE | OFF | - |
| UPCOMING | OFF | - |
| ACTIVE | ON | 15 seconds |
| Dev Mode | ON | 5 seconds |

**Immediate Updates (~4 second latency):**
Match actions trigger immediate `fetchAndPushMatches()` for faster TV updates:
- Mark underway (`/api/matches/:tournamentId/:matchId/underway`)
- Declare winner (`/api/matches/:tournamentId/:matchId/winner`)
- Assign station (`/api/matches/:tournamentId/:matchId/station`)
- Unassign station (station set to null)

**Integration points:**
- `updateRateMode()` calls `updateMatchPolling()` when mode changes
- `enableDevMode()` triggers `updateMatchPolling()` to start fast polling
- `disableDevMode()` triggers `updateMatchPolling()` to stop or slow down
- Server startup checks if ACTIVE mode and starts polling if needed

**Auto-trigger on tournament lifecycle:**
Tournament lifecycle endpoints automatically trigger `checkTournamentsAndUpdateMode()` 500ms after success:
- `POST /api/tournament/:id/start` - Switch to ACTIVE mode, start polling
- `POST /api/tournament/:id/reset` - May switch to IDLE/UPCOMING
- `POST /api/tournament/:id/complete` - May switch to IDLE if no other active tournaments

This eliminates the 2-hour wait between scheduled checks when starting a tournament.

### Real-Time WebSocket (Socket.IO)

The admin dashboard runs a Socket.IO server for real-time updates to MagicMirror displays. This provides near-instant updates (< 100ms) instead of waiting for polling intervals.

**WebSocket Server Setup (server.js):**
```javascript
const http = require('http');
const { Server } = require('socket.io');

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Connection tracking
const wsConnections = {
    displays: new Map(),  // displayId -> socket
    clients: new Set()    // admin dashboard clients
};
```

**WebSocket Events:**
| Event | Direction | Description |
|-------|-----------|-------------|
| `display:register` | Client→Server | Display registers with type (match/bracket/flyer) |
| `display:registered` | Server→Client | Registration acknowledgment with cached data |
| `matches:update` | Server→Client | Broadcast match data to all displays |
| `ticker:message` | Server→Client | Broadcast ticker announcement |
| `tournament:update` | Server→Client | Tournament config changed |
| `matches:request` | Client→Server | Request current cached data |

**Broadcast Functions:**
```javascript
broadcastMatchData(payload)         // Emit 'matches:update' to all clients
broadcastTickerMessage(msg, dur)    // Emit 'ticker:message' to all clients
broadcastTournamentUpdate(data)     // Emit 'tournament:update' to all clients
getWebSocketStatus()                // Get connection stats
```

**Data Flow:**
```
fetchAndPushMatches()
  ├─ saveMatchDataCache()        # Save to local cache
  ├─ broadcastMatchData()        # WebSocket broadcast (instant)
  └─ axios.post(/api/matches/push)  # HTTP fallback
```

**API Endpoint:**
```
GET /api/websocket/status
{
  "displays": [{"id": "...", "type": "match", "connected": true}],
  "displayCount": 1,
  "adminClientCount": 0,
  "totalConnections": 1
}
```

**Rate Modes:**
| Mode | Code Default | Recommended | Trigger |
|------|--------------|-------------|---------|
| IDLE | 1 req/min | 12 req/min | No tournaments within upcoming window |
| UPCOMING | 5 req/min | 20 req/min | Tournament starting within 48 hours |
| ACTIVE | 15 req/min | 30 req/min | Tournament currently underway (non-stale) |

**Code Defaults (server.js line 232):**
```javascript
// getAdaptiveRateLimitSettings() defaults:
{
    enabled: false,
    idleRate: 1,
    upcomingRate: 5,
    activeRate: 15,
    checkIntervalHours: 8,
    upcomingWindowHours: 48,
    manualRateLimit: 15
}
```

**Features:**
- **Queue-based processing:** Single request at a time with calculated delay
- **Auto-retry:** 5-second backoff on 429/403 Cloudflare errors, single retry
- **Adaptive scheduling:** Checks tournaments every 8 hours
- **Stale tournament filtering:** Tournaments underway 7+ days are ignored (line 348)
- **Manual override:** Force IDLE/UPCOMING/ACTIVE via API
- **Development mode:** 3-hour bypass with 0ms delay (auto-expires)
- **Manual cap:** Rate limit setting caps all modes (1-60 req/min)
- **Settings cache cleared:** Updates take effect immediately

**Debug Logging:**
```
[Rate Limiter] Waiting 5000ms before next request (queue: 3, rate: 12 req/min)
[Rate Limiter] Processing request (queue: 2, no delay needed)
[Adaptive Rate] Mode changed: IDLE -> ACTIVE (Name), effective rate: 30 req/min
[Adaptive Rate] Skipping stale tournament: Name (started 9 days ago)
```

**Recommended Settings:** (Cloudflare limit ~60 req/min)
- IDLE: 12 req/min (tournament page makes ~7 API calls)
- UPCOMING: 20 req/min
- ACTIVE: 30 req/min
- Cap: 30-50 req/min

### Challonge API v2.1 Migration (Completed 2025-12-06)

**IMPORTANT: DO NOT USE Challonge API v1. All operations use v2.1 exclusively.**

All Challonge API calls use v2.1 with OAuth 2.0 authentication.

**OAuth 2.0 Authentication (Completed 2025-12-05):**
The dashboard uses OAuth 2.0 for Challonge API authentication. Connect your Challonge account via Settings > Challonge Account.

**CRITICAL: Authorization-Type Header Required**
Challonge requires the `Authorization-Type` header to distinguish between OAuth and legacy authentication:
- `Authorization-Type: v2` - Required for OAuth Bearer tokens
- `Authorization-Type: v1` - Required for legacy API keys

**v2.1 Helper Functions (server.js):**
```javascript
// Get v2.1 headers with OAuth Bearer token (async)
async function getChallongeV2Headers() {
    // Try OAuth first if connected
    if (isChallongeConnected()) {
        try {
            const accessToken = await ensureValidToken();
            return {
                'Authorization': `Bearer ${accessToken}`,
                'Authorization-Type': 'v2',  // REQUIRED for OAuth
                'Content-Type': 'application/vnd.api+json',
                'Accept': 'application/json'
            };
        } catch (error) {
            // Fall through to legacy key
        }
    }
    // Fall back to legacy API key
    const apiKey = getChallongeApiKey();
    return {
        'Authorization': apiKey,
        'Authorization-Type': 'v1',  // REQUIRED for legacy keys
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/json'
    };
}

// Rate-limited v2.1 request helper with 401 fallback
async function challongeV2Request(method, endpoint, data = null) {
    return executeRateLimitedRequest(async () => {
        const url = `https://api.challonge.com/v2.1${endpoint}`;

        // Try OAuth first if connected
        if (isChallongeConnected()) {
            try {
                const oauthHeaders = await getChallongeV2Headers();
                const config = { method, url, headers: oauthHeaders, timeout: 15000 };
                if (data) config.data = data;
                return await axios(config);
            } catch (error) {
                if (error.response?.status === 401) {
                    // OAuth token rejected - clear and try legacy key
                    analyticsDb.deleteOAuthTokens('challonge');
                } else {
                    throw error;
                }
            }
        }

        // Fall back to legacy API key
        const legacyHeaders = { /* legacy headers */ };
        const config = { method, url, headers: legacyHeaders, timeout: 15000 };
        if (data) config.data = data;
        return axios(config);
    });
}
```

**OAuth Token Management:**
- Tokens stored encrypted in SQLite (analytics.db, oauth_tokens table)
- Encryption: AES-256-GCM with unique IV per token
- Automatic refresh 5 minutes before expiration
- `ensureValidToken()` middleware handles auto-refresh
- **401 Fallback:** If OAuth token rejected, automatically deletes invalid token and retries with legacy API key

**OAuth Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/challonge` | GET | Redirect to Challonge authorization |
| `/auth/challonge/callback` | GET | OAuth callback handler |
| `/api/oauth/status` | GET | Get connection status (username, expiry, scopes) |
| `/api/oauth/disconnect` | POST | Revoke and delete tokens |
| `/api/oauth/refresh` | POST | Manual token refresh |

**All Endpoints Use v2.1:**
| Category | Endpoints |
|----------|-----------|
| Tournaments | List, get, create, update, delete, start, reset, finalize, test-connection |
| Participants | List, add, update, delete, bulk add, randomize, check-in, undo check-in, clear |
| Matches | Mark underway, unmark underway, update score, declare winner, reopen, DQ/forfeit, clear scores, get single match |
| Analytics | Archive status, archive tournament, upcoming tournaments, seeding suggestions, apply seeding |
| Rate Limiter | Tournament check for adaptive mode scheduling |

**v2.1 Match State Changes:**
Use `PUT /tournaments/{id}/matches/{matchId}/change_state.json`:
```javascript
// Mark match as underway
await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}/change_state.json`, {
    data: {
        type: 'MatchState',
        attributes: { state: 'mark_as_underway' }
    }
});

// Unmark underway
attributes: { state: 'unmark_as_underway' }

// Reopen completed match
attributes: { state: 'reopen' }
```

**v2.1 Match Score/Winner Updates:**
Use `PUT /tournaments/{id}/matches/{matchId}.json`:
```javascript
// Declare winner with scores
await challongeV2Request('PUT', `/tournaments/${tournamentId}/matches/${matchId}.json`, {
    data: {
        type: 'Match',
        attributes: {
            match: [
                { participant_id: String(player1Id), score_set: '2', rank: 1, advancing: true },
                { participant_id: String(player2Id), score_set: '1', rank: 2, advancing: false }
            ]
        }
    }
});

// Update scores only (no winner)
attributes: {
    match: [
        { participant_id: String(player1Id), score_set: '2' },
        { participant_id: String(player2Id), score_set: '1' }
    ]
}

// Clear scores
attributes: {
    match: [
        { participant_id: String(player1Id), score_set: '' },
        { participant_id: String(player2Id), score_set: '' }
    ]
}
```

**v2.1 Response Format (JSON:API):**
```javascript
// v1 response format
response.data.tournament.name

// v2.1 response format (JSON:API)
response.data.data.attributes.name

// v2.1 timestamps
response.data.data.attributes.timestamps.started_at
```

**v2.1 Request Format (for mutations):**
```javascript
// Tournament lifecycle actions
challongeV2Request('POST', `/tournaments/${id}/process.json`, {
    data: {
        type: 'TournamentProcess',
        attributes: { action: 'start' }  // or 'finalize', 'reset'
    }
});

// Participant actions
challongeV2Request('POST', `/tournaments/${id}/participants/${participantId}/process.json`, {
    data: {
        type: 'ParticipantProcess',
        attributes: { action: 'check_in' }  // or 'undo_check_in'
    }
});
```

**v2.1 Field Name Differences (Tournament Update):**
| v1 Field | v2.1 Field | Notes |
|----------|------------|-------|
| `start_at` | `starts_at` | Note the 's' |
| `check_in_duration` | `registration_options.check_in_duration` | Nested |
| `signup_cap` | `registration_options.signup_cap` | Nested |
| `open_signup` | `registration_options.open_signup` | Nested |
| `hide_seeds` | `seeding_options.hide_seeds` | Nested |
| `sequential_pairings` | `seeding_options.sequential_pairings` | Nested |
| `accept_attachments` | `match_options.accept_attachments` | Nested |
| `hold_third_place_match` | `match_options.consolation_matches_target_rank` | 3 = enabled, omit to disable |
| `grand_finals_modifier` | `double_elimination_options.grand_finals_modifier` | Nested |
| `notify_users_when_matches_open` | `notifications.upon_matches_open` | Nested + renamed |
| `notify_users_when_the_tournament_ends` | `notifications.upon_tournament_ends` | Nested + renamed |

**v2.1 Nested Structure (Tournament Update):**
```javascript
// PUT /api/tournament/:tournamentId sends this to Challonge:
{
  data: {
    type: 'tournaments',
    attributes: {
      name: 'Tournament Name',
      starts_at: '2025-12-25T20:00:00.000Z',  // Note: starts_at not start_at
      private: false,
      hide_forum: false,
      show_rounds: false,
      quick_advance: true,
      // Nested option objects
      registration_options: {
        check_in_duration: 30,
        signup_cap: 16,
        open_signup: false
      },
      seeding_options: {
        hide_seeds: false,
        sequential_pairings: false
      },
      match_options: {
        accept_attachments: false,
        consolation_matches_target_rank: 3  // 3 = third place match enabled (single elim)
      },
      double_elimination_options: {
        grand_finals_modifier: 'single'  // or 'skip', null for default
      },
      notifications: {
        upon_matches_open: true,
        upon_tournament_ends: true
      }
    }
  }
}
```

**v2.1 Format-Specific Options:**
| Format | Option Object | Fields |
|--------|---------------|--------|
| Single Elim | `match_options` | `consolation_matches_target_rank` (3 = 3rd place match) |
| Double Elim | `double_elimination_options` | `grand_finals_modifier` ('single', 'skip', null) |
| Group Stage | `group_stage_options` | `stage_type`, `group_size`, `participant_count_to_advance`, `ranked_by` |

**Important v2.1 Constraints:**
- `consolation_matches_target_rank` must be >= 3 when set, or omit field entirely to disable
- Cannot send `null` for `consolation_matches_target_rank` - v2.1 rejects it
- `grand_finals_modifier` accepts 'single', 'skip', or null (default double match)

**v2.1 Response Nested Options (Reading Tournament Data):**
```javascript
const attrs = response.data.data.attributes;
const regOpts = attrs.registration_options || {};
const seedOpts = attrs.seeding_options || {};
const matchOpts = attrs.match_options || {};
const doubleElimOpts = attrs.double_elimination_options || {};
const notifyOpts = attrs.notifications || {};

// Access fields from nested objects
const startAt = attrs.timestamps?.starts_at || attrs.starts_at;
const checkInDuration = regOpts.check_in_duration;
const signupCap = regOpts.signup_cap;
const hideSeeds = seedOpts.hide_seeds;
const acceptAttachments = matchOpts.accept_attachments;
// v2.1 uses consolation_matches_target_rank >= 3 for third place match
const holdThirdPlaceMatch = matchOpts.consolation_matches_target_rank != null && matchOpts.consolation_matches_target_rank >= 3;
// v2.1 uses double_elimination_options for grand_finals_modifier
const grandFinalsModifier = doubleElimOpts.grand_finals_modifier || '';
const notifyMatchOpen = notifyOpts.upon_matches_open;
```

## API Reference

### Authentication
```
POST /api/auth/login     - Login (body: {username, password})
POST /api/auth/logout    - Logout
GET  /api/auth/status    - Check authentication
GET  /api/csrf-token     - Get CSRF token (authenticated, returns {success, token})
```

**CSRF Protection:**
All POST/PUT/DELETE/PATCH requests require CSRF token validation (except exempt routes).

| Component | Value |
|-----------|-------|
| Cookie Name | `XSRF-TOKEN` |
| Header Name | `X-CSRF-Token` |
| Token Length | 64 characters |

**Exempt Routes** (no CSRF token required):
- `POST /api/auth/login` - No session exists yet
- `POST /api/displays/register` - Pi display registration
- `POST /api/displays/:id/heartbeat` - Pi heartbeat updates
- `POST /api/displays/:id/logs` - Pi debug log push

### Status & Configuration
```
GET  /api/status              - All module status + state files
POST /api/tournament/setup    - Deploy to all displays
POST /api/test-connection     - Validate Challonge API
GET  /api/tournaments         - List from Challonge (?days=30)
```

### Match Management
```
GET  /api/matches/:tournamentId                          - Get all matches (includes stationId + metadata)
GET  /api/matches/:tournamentId/:matchId                 - Get single match details
GET  /api/matches/:tournamentId/stats                    - Get match statistics (total, completed, remaining)
POST /api/matches/:tournamentId/:matchId/underway        - Mark in progress (sets underway_at)
POST /api/matches/:tournamentId/:matchId/unmark-underway - Stop match (return to open)
POST /api/matches/:tournamentId/:matchId/score           - Update score
POST /api/matches/:tournamentId/:matchId/winner          - Declare winner (scores required)
POST /api/matches/:tournamentId/:matchId/reopen          - Reopen match
POST /api/matches/:tournamentId/:matchId/dq              - DQ/Forfeit (body: {winnerId, loserId})
POST /api/matches/:tournamentId/:matchId/station         - Assign station (body: {stationId} or null to unassign)
POST /api/matches/:tournamentId/:matchId/clear-scores    - Clear match scores
POST /api/matches/:tournamentId/batch-scores             - Batch score entry (body: {scores: [...]})
```

**Match List Response Metadata:**
```json
{
  "success": true,
  "matches": [...],
  "metadata": {
    "nextMatchId": 12345,
    "nextMatchPlayers": { "player1": "Alice", "player2": "Bob" },
    "completedCount": 5,
    "underwayCount": 2,
    "openCount": 8,
    "totalCount": 15,
    "progressPercent": 33
  }
}
```

**Batch Score Entry:**
```javascript
// Request
POST /api/matches/:tournamentId/batch-scores
{
  scores: [
    { matchId: "123", winnerId: "456", score1: "2", score2: "0" },
    { matchId: "124", winnerId: "789", score1: "2", score2: "1" }
  ]
}

// Response
{
  success: true,
  submitted: 2,
  succeeded: 2,
  failed: 0,
  results: [
    { matchId: "123", success: true, message: "Winner declared" },
    { matchId: "124", success: true, message: "Winner declared" }
  ]
}
```

**Challonge API v1 Quirks:**
- Match state does NOT change to 'underway' - Challonge keeps `state: 'open'` but sets `underway_at` timestamp
- Use `underwayAt` field to detect in-progress matches: `state === 'open' && underwayAt != null`
- Declaring a winner REQUIRES scores (422 error without them) - use format like "1-0" or "2-1"
- Station assignments: v1 API does NOT return station_id - fetched from v2.1 stations endpoint
- Assigning stations: Uses v2.1 PUT to station endpoint with `match_id`, NOT match endpoint

### Station Management
```
GET    /api/stations/:tournamentId                      - List stations (TV 1, TV 2, etc.)
POST   /api/stations/:tournamentId                      - Create station (body: {name})
DELETE /api/stations/:tournamentId/:stationId           - Delete station
GET    /api/tournament/:tournamentId/station-settings   - Get auto-assign settings
PUT    /api/tournament/:tournamentId/station-settings   - Update auto-assign (body: {autoAssign: bool})
```

**Note:** Auto-assign setting can only be changed when tournament is in **pending** state. Reset tournament to change it.

### Tournament Management
```
GET    /api/tournament/:tournamentId           - Get tournament details for editing
PUT    /api/tournament/:tournamentId           - Update tournament fields
POST   /api/tournament/:tournamentId/start     - Start tournament
POST   /api/tournament/:tournamentId/reset     - Reset tournament
POST   /api/tournament/:tournamentId/complete  - Finalize tournament
DELETE /api/tournament/:tournamentId           - Delete tournament permanently
```

**Editable Fields (PUT request body):**

| Category | Field | Type | Description |
|----------|-------|------|-------------|
| Basic | name | string | Tournament name (max 60 chars, required) |
| Basic | gameName | string | Game name |
| Basic | description | string | Tournament description |
| Schedule | startAt | ISO date | Start date/time |
| Schedule | checkInDuration | number | Check-in duration in minutes |
| Registration | signupCap | number | Maximum participants |
| Registration | openSignup | boolean | Allow public signup via Challonge |
| Single Elim | holdThirdPlaceMatch | boolean | Third place match |
| Single Elim | sequentialPairings | boolean | Seeds 1v2, 3v4 instead of 1v16, 2v15 |
| Single Elim | showRounds | boolean | Show round labels |
| Double Elim | grandFinalsModifier | string | Grand finals format (single/skip) |
| Double Elim | sequentialPairings | boolean | Seeds 1v2, 3v4 instead of 1v16, 2v15 |
| Double Elim | showRounds | boolean | Show round labels |
| Round Robin | rankedBy | string | Ranking method (match wins, game wins, custom, etc.) |
| Round Robin | rrPtsForMatchWin/Tie | number | Custom points for match results |
| Round Robin | rrPtsForGameWin/Tie | number | Custom points for game results |
| Swiss | swissRounds | number | Number of Swiss rounds |
| Swiss | ptsForMatchWin/Tie/Bye | number | Points for match results |
| Swiss | ptsForGameWin/Tie | number | Points for game results |
| Display | hideSeeds | boolean | Hide seed numbers publicly |
| Display | privateTournament | boolean | Hide from public listings |
| Display | hideForum | boolean | Disable discussion forum |
| Match | acceptAttachments | boolean | Allow match attachments |
| Match | quickAdvance | boolean | Auto-advance on score entry |
| Notifications | notifyMatchOpen | boolean | Email when match opens |
| Notifications | notifyTournamentEnd | boolean | Email final results |

**Note:** Tournament format (single/double elim, round robin, swiss) cannot be changed after creation.

### Tournament Creation
```
POST /api/tournaments/create  - Create new tournament on Challonge
```

**Creation Wizard (3 Steps):**
| Step | Section | Parameters |
|------|---------|------------|
| 1. Basic Info | Name, Game, Description | name, gameName, description |
| 2. Format | Tournament type + format-specific options | tournamentType, grandFinalsModifier, holdThirdPlaceMatch, rrIterations, rankedBy, swissRounds, custom point values, hideSeeds, sequentialPairings, showRounds, autoAssign, groupStageEnabled, groupStageOptions |
| 3. Schedule | Start time, registration, privacy, notifications | startAt, checkInDuration, signupCap, openSignup, privateTournament, acceptAttachments, notifyMatchOpen, notifyTournamentEnd |

**Format-Specific Options:**
| Format | Options |
|--------|---------|
| Single Elimination | Third place match, sequential pairings, show rounds, group stage (pools) |
| Double Elimination | Grand finals modifier (single/skip), sequential pairings, show rounds, group stage (pools) |
| Round Robin | Iterations (1-3), ranking method, custom point values (match win/tie, game win/tie) |
| Swiss | Number of rounds, point values (match win/tie, bye, game win/tie) |

**Group Stage (Pools) Options** (Single/Double Elim only):
| Option | Type | Description |
|--------|------|-------------|
| groupStageEnabled | boolean | Enable group stage before elimination bracket |
| groupStageOptions.stageType | string | 'round robin' or 'swiss' |
| groupStageOptions.groupSize | number | Participants per group (default 4) |
| groupStageOptions.participantCountToAdvance | number | Players advancing from each group (default 2) |
| groupStageOptions.rankedBy | string | 'match wins', 'game wins', 'points scored', 'points difference' |

**All Creation Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| name | string | Tournament name (required) |
| tournamentType | string | single elimination, double elimination, round robin, swiss |
| gameName | string | Game name |
| description | string | Tournament description |
| startAt | ISO date | Start date/time |
| checkInDuration | number | Check-in duration in minutes |
| signupCap | number | Maximum participants |
| grandFinalsModifier | string | Grand finals format (double elim: single, skip) |
| holdThirdPlaceMatch | boolean | Third place match (single elim only) |
| rrIterations | number | Round robin iterations (1-3) |
| rankedBy | string | RR ranking: match wins, game wins, points scored, points difference, custom |
| rrMatchWin/rrMatchTie | number | RR custom points for match results |
| rrGameWin/rrGameTie | number | RR custom points for game results |
| swissRounds | number | Number of Swiss rounds |
| swissMatchWin/swissMatchTie/swissBye | number | Swiss points for match results |
| swissGameWin/swissGameTie | number | Swiss points for game results |
| hideSeeds | boolean | Hide seed numbers publicly |
| sequentialPairings | boolean | Sequential pairings (seeds 1v2, 3v4 instead of 1v16, 2v15) |
| showRounds | boolean | Show round labels in bracket |
| autoAssign | boolean | Auto-assign matches to stations |
| openSignup | boolean | Allow public signup via Challonge |
| privateTournament | boolean | Hide from public listings |
| hideForum | boolean | Disable discussion forum tab |
| acceptAttachments | boolean | Allow match attachments |
| quickAdvance | boolean | Auto-advance participants on score submission |
| notifyMatchOpen | boolean | Email participants when match opens |
| notifyTournamentEnd | boolean | Email participants when tournament ends |

**URL Generation:**

Tournament URLs are auto-generated using the format: `venue_game_monthYY_xxxx`

| Component | Source | Example |
|-----------|--------|---------|
| `venue` | Extracted from name after @ symbol (max 12 chars, alphanumeric only) | `neilsbahr` |
| `game` | Abbreviated game name from mapping | `ssbu`, `mkw`, `sf6` |
| `monthYY` | Start date as 3-letter month + 2-digit year | `nov25`, `dec25` |
| `xxxx` | Random 4-char alphanumeric suffix | `a7x2` |

**Game Abbreviation Mapping:**
```javascript
const gameMap = {
    'super smash bros. ultimate': 'ssbu',
    'super smash bros ultimate': 'ssbu',
    'ssbu': 'ssbu',
    'mario kart world': 'mkw',
    'mario kart 8': 'mk8',
    'mario kart 8 deluxe': 'mk8dx',
    'street fighter 6': 'sf6',
    'tekken 8': 't8',
    'melee': 'melee',
    'super smash bros. melee': 'melee',
    'guilty gear strive': 'ggst',
    'mortal kombat 1': 'mk1',
    'granblue fantasy versus rising': 'gbvsr'
};
// Fallback: first letter of each word (max 4 chars)
```

**URL Generation Examples:**
| Tournament Name | Game | Result |
|-----------------|------|--------|
| Game Night @ Neils Bahr | Super Smash Bros. Ultimate | `neilsbahr_ssbu_nov25_a7x2` |
| Weekly @ The Arcade | Street Fighter 6 | `thearcade_sf6_dec25_b3k9` |
| Tournament Name | Mario Kart World | `tournament_mkw_jan26_p2m4` |

**Helper Functions (server.js ~line 2019):**
```javascript
abbreviateGame(game)         // Maps game name to short code
extractVenue(tournamentName) // Extracts venue from name after @ symbol
formatMonthYear(dateStr)     // Formats date as monYY
randomSuffix()               // Generates 4-char alphanumeric string
```

### Flyer Management
```
GET    /api/flyers                    - List flyers (returns {filename, size, modified, type})
GET    /api/flyers/preview/:filename  - Serve flyer image/video (public)
POST   /api/flyers/upload             - Upload flyer (PNG, JPG, MP4; max 50MB)
DELETE /api/flyers/:filename          - Delete flyer
POST   /api/flyer/update              - Update display flyer
```

**Supported file types:**
- PNG images
- JPG/JPEG images
- MP4 videos (H.264 recommended)

**Upload response includes:** `{success, message, filename, type}` where type is "image" or "video"

### Sponsor Management
```
GET    /api/sponsors                     - List sponsors with config and positions
GET    /api/sponsors/preview/:filename   - Serve sponsor image (public)
POST   /api/sponsors/upload              - Upload sponsor logo (PNG, JPG, GIF, SVG, WEBP; max 10MB)
PUT    /api/sponsors/:id                 - Update sponsor metadata
DELETE /api/sponsors/:id                 - Delete sponsor
POST   /api/sponsors/reorder             - Update display order (body: {ids: [...]})
POST   /api/sponsors/show                - Show sponsors on displays (body: {sponsors, config})
POST   /api/sponsors/hide                - Hide sponsor(s) (body: {position?} or all)
GET    /api/sponsors/config              - Get sponsor config (rotation interval, enabled)
POST   /api/sponsors/config              - Update sponsor config
```

**Sponsor Object:**
```json
{
  "id": "sponsor_1733500000000",
  "name": "Sponsor Name",
  "filename": "sponsor-logo.png",
  "position": "top-right",
  "type": "corner",
  "size": 100,
  "opacity": 100,
  "active": true,
  "order": 1,
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

**Positions:** `top-left`, `top-right`, `bottom-left`, `bottom-right`, `top-banner`, `bottom-banner`

**Types:** `corner` (200x100px base) or `banner` (full width, 80px height)

**WebSocket Events (to MagicMirror displays):**
| Event | Direction | Purpose |
|-------|-----------|---------|
| `sponsor:show` | Server→Client | Display sponsor(s) at positions |
| `sponsor:hide` | Server→Client | Hide sponsor(s) |
| `sponsor:rotate` | Server→Client | Rotate to next sponsor |
| `sponsor:config` | Server→Client | Config update |

**Storage:**
- Images: `admin-dashboard/sponsors/`
- State: `admin-dashboard/sponsor-state.json`

### Participant Management
```
GET    /api/participants/:tournamentId                              - Get participants with full details
POST   /api/participants/:tournamentId                              - Add single participant
PUT    /api/participants/:tournamentId/:participantId               - Update participant
DELETE /api/participants/:tournamentId/:participantId               - Delete participant
POST   /api/participants/:tournamentId/bulk                         - Bulk add participants
POST   /api/participants/:tournamentId/randomize                    - Randomize all seeds
POST   /api/participants/:tournamentId/:participantId/check-in      - Check in participant
POST   /api/participants/:tournamentId/:participantId/undo-check-in - Undo check-in
DELETE /api/participants/:tournamentId/clear                        - Clear all participants
```

**Participant Create/Update Fields:**
| Field | Type | Description |
|-------|------|-------------|
| name | string | Display name (required if no email/username) |
| email | string | Email - searches Challonge account or sends invite |
| challongeUsername | string | Link to existing Challonge account |
| seed | number | Seeding position (1 to participant count) |
| instagram | string | Instagram handle (stored in misc field) |
| misc | string | Multi-purpose field (max 255 chars, API-only) |

**Participant Response Fields:**
| Field | Description |
|-------|-------------|
| id, name, seed, misc | Basic info |
| email, challongeUsername | Contact/account info |
| checkedIn, checkedInAt, canCheckIn | Check-in status |
| active, onWaitingList, invitationPending | Status flags |
| finalRank, groupId | Tournament placement |

**Bulk Add Format:** Names only (one per line) or CSV (name, email, seed, misc)

### Display Management
```
GET    /api/displays                  - List registered displays with full system info
POST   /api/displays/register         - Register new display (called by Pi on boot)
POST   /api/displays/:id/heartbeat    - Update heartbeat with system metrics
GET    /api/displays/:id/config       - Get display config (returns pending commands + debug mode)
PUT    /api/displays/:id/config       - Update display config (change assigned view)
POST   /api/displays/:id/reboot       - Queue reboot command (cross-network)
POST   /api/displays/:id/shutdown     - Queue shutdown command (cross-network)
POST   /api/displays/:id/debug        - Toggle debug mode (body: {enabled: true/false})
POST   /api/displays/:id/logs         - Push debug logs from Pi (no auth, body: {logs: [...]})
GET    /api/displays/:id/logs         - Get debug logs (query: ?limit=100&level=&source=)
DELETE /api/displays/:id/logs         - Clear debug logs
```

**Cross-Network Command Queue:**
Reboot/shutdown commands work across different networks (Pi and server don't need direct connectivity):
1. Admin dashboard queues command in `displays.json` via `pendingCommand` field
2. Pi polls `/api/displays/:id/config` every 10 seconds
3. Server returns `pendingCommand` if queued, then clears it from storage
4. Pi executes command (`sudo reboot` or `sudo shutdown -h now`)

**Heartbeat Request Fields:**
| Field | Type | Description |
|-------|------|-------------|
| uptimeSeconds | number | System uptime in seconds |
| cpuTemp | number | CPU temperature in Celsius |
| memoryUsage | number | Memory usage percentage |
| wifiQuality | number | WiFi link quality percentage (0-100) |
| wifiSignal | number | WiFi signal strength in dBm |
| ssid | string | Connected WiFi network name |
| voltage | number | Core voltage (Pi 5 throttling detection) |
| currentView | string | Current view (match/bracket/flyer) |
| ip | string | Internal IP address |
| externalIp | string | External/public IP address (cached 5 min) |
| mac | string | MAC address |
| hostname | string | Device hostname |

**Config Response Fields:**
| Field | Description |
|-------|-------------|
| success | Boolean success indicator |
| config | View mapping config (serverUrl, port, useTls) |
| shouldRestart | True if assignedView differs from currentView |
| pendingCommand | Command object if queued ({action, queuedAt, queuedBy}) |
| debugMode | Boolean - true if debug logging is enabled |

**Debug Mode:**
Pi displays support verbose debug logging that can be toggled from the admin dashboard.

**Debug Log Format (pushed from Pi):**
```json
{
  "timestamp": "2025-11-29T12:34:56-06:00",
  "level": "info",
  "source": "manager",
  "message": "Debug mode enabled - verbose logging started"
}
```

**Log Levels:** debug, info, warn, error
**Log Sources:** kiosk, manager, chromium, system

**Debug Logs API:**
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/displays/:id/debug` | POST | Yes | Toggle debug mode |
| `/api/displays/:id/logs` | POST | No | Push logs from Pi |
| `/api/displays/:id/logs` | GET | Yes | Get logs with filters |
| `/api/displays/:id/logs` | DELETE | Yes | Clear logs |

**Get Logs Query Parameters:**
- `limit` (default 100): Max logs to return
- `offset` (default 0): Skip first N logs
- `level`: Filter by level (debug/info/warn/error)
- `source`: Filter by source (kiosk/manager/chromium/system)

**Display UI Sections:**
The displays.html page shows registered displays with 4 info sections:
1. **Network**: Internal IP, External IP, MAC address
2. **WiFi**: Network SSID, Quality %, Signal dBm
3. **System Health**: CPU temp, Memory %, Voltage (throttle detection)
4. **Display**: Current view, Assigned view, Sync status

**Color Coding in UI:**
| Field | Green | Yellow | Red |
|-------|-------|--------|-----|
| WiFi Quality | ≥80% | 40-79% | <40% |
| CPU Temp | <60C | 60-70C | ≥70C |
| Memory | <60% | 60-80% | ≥80% |
| Voltage | ≥0.9V | 0.85-0.9V | <0.85V (throttled) |

### Bracket Control (Proxy to port 2053)
```
POST /api/bracket/zoom              - Set zoom level (body: {zoomScale: 0.1-5.0}) - WORKS
POST /api/bracket/reset             - Reset view to default zoom (1.0x) - WORKS
POST /api/bracket/control           - Generic control (body: {action, parameters})
```

**Challonge iframe Limitations:**
Only `setZoomScale` works via postMessage API. The following do NOT work:
- `scrollToMatchIdentifier` - Challonge iframe ignores this
- `zoomToMatchIdentifier` - Challonge iframe ignores this
- `filterRounds` - Not supported
- `loadTheme` - Not supported

The Focus on Match UI has been removed from the displays page due to these limitations.

### Ticker Messages
```
POST /api/ticker/send    - Send message to match display (body: {message, duration})
                           Duration: 3-30 seconds, message max 200 chars
                           Proxies to match module port 2052
```

### Scheduled Ticker Messages
```
GET    /api/ticker/schedule      - List all scheduled ticker messages
POST   /api/ticker/schedule      - Create scheduled message
                                   Body: {message, duration, scheduleType, scheduledTime, recurringDays}
                                   scheduleType: "once", "daily", or "weekly"
                                   recurringDays: array of day numbers (0=Sun, 6=Sat) for weekly
PUT    /api/ticker/schedule/:id  - Update scheduled message
DELETE /api/ticker/schedule/:id  - Delete scheduled message
DELETE /api/ticker/schedule      - Clear all scheduled messages
```

**Scheduled Message Object:**
```json
{
  "id": "ticker_1733851234567",
  "message": "Tournament starting soon!",
  "duration": 5,
  "scheduleType": "once",
  "scheduledTime": "2025-12-10T20:00:00.000Z",
  "recurringDays": [],
  "enabled": true,
  "lastTriggered": null,
  "createdAt": "2025-12-10T18:00:00.000Z"
}
```

**Service:** `services/ticker-scheduler.js` - Checks every 30 seconds for due messages

### Audio Announcements
```
POST /api/audio/announce - Trigger text-to-speech on Pi displays
                           Body: {text, voice?, rate?, volume?}
                           text: required, max 500 chars
                           rate: 0.5-2.0 (default 1.0)
                           volume: 0.0-1.0 (default 1.0)
                           Broadcasts via WebSocket + HTTP fallback to match display
```

**Audio Presets (Dashboard UI):**
- "Report In" - "Attention players: please report to your stations"
- "5 Min Warning" - "Tournament starting in 5 minutes"
- "Finals" - "Finals are about to begin"

### Display Timers
```
POST   /api/timer/dq         - Start DQ timer (enhanced with match/player tracking)
                               Body: {tv, duration, matchId?, playerId?, playerName?}
                               Duration: 10-600 seconds, default 180 (3 minutes)
                               Server tracks timer state for auto-DQ functionality
GET    /api/timer/dq/active  - List all active DQ timers
                               Returns: {success, timers: [{key, matchId, tv, playerId, playerName, remaining}]}
DELETE /api/timer/dq/:key    - Cancel specific DQ timer
                               Key format: "tournamentId:matchId:tv"
POST   /api/timer/tournament - Start tournament timer (body: {duration})
                               Duration: 10-3600 seconds (up to 1 hour)
POST   /api/timer/hide       - Hide timer (body: {type: "dq"|"tournament"|"all", tv})
                               For programmatic use; timers auto-hide when complete
```

**DQ Timer Auto-DQ Feature:**
When DQ timer expires, behavior depends on `system-settings.json`:
```json
{
  "dqTimer": {
    "autoDqEnabled": true,
    "autoDqAction": "notify",  // "auto-dq" or "notify"
    "defaultDuration": 180,
    "warningThreshold": 30
  }
}
```
- `auto-dq`: Automatically DQ the selected player when timer expires
- `notify`: Send notification only (no automatic DQ)
- Warning WebSocket event (`timer:dq:warning`) sent at 30s remaining

**Timer UI Controls (Dashboard page):**
- DQ Timer buttons: "TV 1 - 3min DQ", "TV 2 - 3min DQ" (preset 180s)
- Tournament Timer: number input (1-60 min) + "Start Timer" button
- Timers appear on match display, auto-hide when countdown reaches 0
- Warning states: yellow pulse at 30s, red rapid pulse at 10s remaining

**Timer UI Controls (Command Center page):**
- Enhanced DQ modal with match dropdown and player selection
- Active timers panel showing all server-side DQ timers
- Cancel button per timer
- Auto-refresh of timer list

### QR Code Display
```
GET  /api/qr/generate   - Generate QR code (query: ?url=)
                          Returns: {success, qrCode: dataUrl, url}
POST /api/qr/show       - Show QR on match display
                          Body: {url, label, duration?}
                          Generates QR, broadcasts via WebSocket + HTTP fallback
POST /api/qr/hide       - Hide QR code overlay
                          Broadcasts via WebSocket + HTTP fallback
```

**QR Code UI Controls (Dashboard page):**
- Quick buttons: "Signup Page", "Bracket Link"
- Custom URL input with optional label
- Hide QR button to remove overlay
- QR appears as fullscreen overlay on match display

### User Management (Admin Only)
```
GET    /api/users        - List users
POST   /api/users        - Create user
PUT    /api/users/:id    - Update user
DELETE /api/users/:id    - Delete user
```

### Settings (Admin Only)
```
GET    /api/settings/system        - Get all settings
PUT    /api/settings/system        - Update settings section
GET    /api/settings/activity-log  - Get activity log
DELETE /api/settings/activity-log  - Clear activity log
POST   /api/settings/change-password - Change own password
GET    /api/settings/defaults      - Get default values
```

### System Monitoring (Admin Only)
```
POST   /api/monitoring/start                  - Start monitoring session
                                                Body: {durationMinutes: 1-120}
GET    /api/monitoring/status                 - Get current session status
POST   /api/monitoring/stop                   - Stop monitoring session
GET    /api/monitoring/report                 - Generate report from session data
GET    /api/monitoring/quick-check            - One-time instant system check
GET    /api/monitoring/logs                   - Get recent service logs
                                                Query: ?service=tournament-admin&lines=50
GET    /api/monitoring/reports                - List saved reports
GET    /api/monitoring/reports/:filename      - View saved report
DELETE /api/monitoring/reports/:filename      - Delete saved report
```

**Quick Check Response:**
```json
{
  "timestamp": "2025-11-28T...",
  "services": [
    {"name": "tournament-admin", "status": "running", "uptime": "2d 5h"}
  ],
  "apis": [
    {"name": "Match Module", "status": "ok", "responseTime": 5}
  ],
  "network": [
    {"target": "Google DNS", "latency": 12, "status": "ok"}
  ],
  "system": {
    "memory": {"total": 16384, "used": 4096, "percentage": 25},
    "cpu": {"loadAverage": [0.5, 0.4, 0.3]},
    "disk": {"total": 100, "used": 40, "percentage": 40}
  },
  "piDisplays": [
    {"hostname": "pi-display-1", "status": "online", "cpuTemp": 45}
  ],
  "issues": [
    {"severity": "warning", "message": "High memory usage on pi-display-1"}
  ]
}
```

**Monitoring Session Flow:**
1. `POST /api/monitoring/start` with duration (1-120 min)
2. System samples every 30 seconds automatically
3. `GET /api/monitoring/status` shows progress
4. `GET /api/monitoring/report` generates Claude-readable report
5. `POST /api/monitoring/stop` to end early

### Rate Limit Management (Admin Only)
```
GET  /api/rate-limit/status           - Get current rate status, mode, and settings
POST /api/rate-limit/check            - Trigger immediate tournament check
POST /api/rate-limit/mode             - Set manual mode override
                                        Body: {mode: "IDLE"|"UPCOMING"|"ACTIVE"|"auto"}
                                        "auto" clears override, returns to automatic
POST /api/rate-limit/dev-mode/enable  - Enable dev mode (3-hour bypass)
POST /api/rate-limit/dev-mode/disable - Disable dev mode
```

### Activity Feed
```
GET  /api/activity           - Get paginated activity log
                               Query: ?limit=50&offset=0&category=&search=
                               Returns: { success, activity[], pagination }
POST /api/activity/external  - Webhook for external activity (signup PWA)
                               Header: X-Activity-Token
                               Body: { action, source?, details }
```

**Activity Categories:** `admin`, `tournament`, `participant`, `match`, `display`, `system`

### Push Notifications
```
GET    /api/notifications/vapid-public-key  - Get VAPID public key for subscription
POST   /api/notifications/subscribe         - Subscribe to push notifications
                                              Body: { subscription: PushSubscription }
DELETE /api/notifications/unsubscribe       - Remove push subscription
                                              Body: { endpoint: string }
GET    /api/notifications/preferences       - Get notification preferences
PUT    /api/notifications/preferences       - Update notification preferences
                                              Body: { match_completed, display_disconnected,
                                                     new_signup, dq_timer_expired,
                                                     tournament_started, checkin_deadline }
POST   /api/notifications/test              - Send test push notification
```

**Notification Types:**
| Type | Trigger | Description |
|------|---------|-------------|
| match_completed | POST /api/matches/:id/:mid/winner | When a match winner is declared |
| tournament_started | POST /api/tournament/:id/start | When tournament begins |
| dq_timer_expired | DQ timer expiry handler | When DQ timer runs out |
| new_signup | POST /api/activity/external (participant_signup) | New participant registration |
| display_disconnected | GET /api/displays (heartbeat expiry) | Pi display goes offline |
| checkin_deadline | Preference stored | Check-in deadline reminder |

**Server Functions:**
```javascript
sendPushNotification(subscription, payload)       // Send to single subscription
broadcastPushNotification(notificationType, payload)  // Broadcast to all with preference
```

**Database Tables:**
```sql
push_subscriptions (id, user_id, endpoint, p256dh_key, auth_key, user_agent, created_at, last_used)
notification_preferences (id, user_id, match_completed, checkin_deadline, display_disconnected,
                         new_signup, dq_timer_expired, tournament_started, sound_enabled, ...)
```

**WebSocket Events:**
| Event | Direction | Payload |
|-------|-----------|---------|
| `activity:initial` | Server→Client | `{ activity[], serverTime }` (last 20 on connect) |
| `activity:new` | Server→Client | `{ ...entry, serverTime }` (real-time updates) |

**Environment Variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `ACTIVITY_WEBHOOK_TOKEN` | `default-activity-token-change-me` | Token for external webhook auth |

### Analytics
```
GET  /api/analytics/games                              - List games with tournament counts
GET  /api/analytics/stats/overview                     - Dashboard summary (tournaments, players, matches)
GET  /api/analytics/stats/attendance                   - Attendance trends (?game=&months=)
GET  /api/analytics/rankings/:gameId                   - Player leaderboard (Elo, wins, attendance)
GET  /api/analytics/players                            - Search players (?search=&game=)
GET  /api/analytics/players/:playerId                  - Player profile with full stats
GET  /api/analytics/players/:id/head-to-head/:oppId    - Head-to-head record
GET  /api/analytics/tournaments                        - Archived tournament list (?game=)
GET  /api/analytics/archive/status                     - Archived vs unarchived tournaments
POST /api/analytics/archive/:tournamentId              - Archive completed tournament
GET  /api/analytics/upcoming-tournaments               - Pending tournaments (for seeding dropdown)
GET  /api/analytics/seeding-suggestions/:tournamentId  - Elo-based seeding suggestions
POST /api/analytics/apply-seeding/:tournamentId        - Apply seeds to Challonge
```

**AI Seeding Endpoints:**
```
GET  /api/analytics/ai-seeding/status                  - Check if AI seeding available (API key configured)
GET  /api/analytics/ai-seeding/:tournamentId           - Get AI seeding suggestions (cached or fresh)
GET  /api/analytics/ai-seeding/:tournamentId?regenerate=true - Force regenerate suggestions
POST /api/analytics/ai-seeding/:tournamentId/lock      - Lock seed positions
POST /api/analytics/ai-seeding/:tournamentId/apply     - Apply AI seeds to Challonge
```

**Tournament Narrative Endpoints:**
```
GET  /api/analytics/ai/narrative/status                  - Check if AI narrative available (API key configured)
GET  /api/analytics/ai/narrative/:tournamentId           - Get/generate narrative (?format=social|discord|full, ?regenerate=true)
POST /api/analytics/ai/narrative/:tournamentId/regenerate - Force regenerate narrative (?format=)
GET  /api/analytics/ai/narrative/:tournamentId/cached    - Get all cached narratives for tournament
DELETE /api/analytics/ai/narrative/:tournamentId/cache   - Clear narrative cache
```

**Tournament Narrative Response:**
```json
{
  "success": true,
  "format": "discord",
  "narrative": "**Tournament Recap**\n\nCongratulations to **PlayerName** for winning...",
  "socialPost": "Congratulations to PlayerName for winning Tournament Name!",
  "storylines": {
    "upsets": [{"winner": "...", "loser": "...", "seedDiff": 5}],
    "closeMatches": [{"player1": "...", "player2": "...", "finalScore": "3-2"}],
    "reverseSweeps": [],
    "losersRuns": [{"player": "...", "winsInLosers": 4}]
  },
  "cached": false,
  "source": "ai",
  "generatedAt": "2025-12-09T20:34:36.000Z"
}
```

**AI Seeding Response:**
```json
{
  "success": true,
  "source": "ai",
  "cached": true,
  "cachedAt": "2025-12-09 20:34:36",
  "tournament": { "id": "123", "url": "slug", "name": "...", "gameName": "..." },
  "seeds": [
    {
      "seed": 1,
      "participantId": "456",
      "name": "PlayerName",
      "elo": 1416,
      "currentSeed": 5,
      "isNewPlayer": false,
      "reasoning": "Highest Elo rating (1416) - placed as top seed"
    }
  ],
  "bracketBalance": { "topHalfElo": 12500, "bottomHalfElo": 12350, "balancePercent": 50.2 },
  "newPlayerPlacements": ["Placed NewPlayer1 at seed 12 vs mid-tier opponent"],
  "avoidedMatchups": ["Player1 vs Player3 separated (met last 2 tournaments)"],
  "overallReasoning": "Seeded by Elo with bracket balance optimization...",
  "lockedSeeds": [],
  "generationCount": 3
}
```

**Elo-Based Seeding Suggestions Response:**
```json
{
  "tournament": { "id": 123, "name": "...", "game": "SSBU" },
  "suggestions": [
    {
      "participantId": 456,
      "name": "PlayerName",
      "currentSeed": 5,
      "suggestedSeed": 1,
      "elo": 1416,
      "matchType": "exact",
      "isNewPlayer": false
    }
  ]
}
```

**Apply Seeding Request/Response:**
```javascript
// Request
POST /api/analytics/apply-seeding/:tournamentId
// or POST /api/analytics/ai-seeding/:tournamentId/apply
{ seeds: [{ participantId: 123, seed: 1 }, ...] }

// Response
{ success: true, applied: 10, failed: 0, results: [...] }
```

### Export (Tournament Results)
```
GET  /api/export/:tournamentId/standings/csv  - Export standings as CSV
GET  /api/export/:tournamentId/matches/csv    - Export matches as CSV
GET  /api/export/:tournamentId/report/pdf     - Export full report as PDF
```

**Query Parameters:**
- `source=archive` - Fetch from SQLite analytics database (tournamentId is database ID)
- `source=live` - Fetch from Challonge API (tournamentId is URL slug)

**CSV Standings Format:** Rank, Name, Seed
**CSV Matches Format:** Round, Match, Player 1, Player 2, Score, Winner

**PDF Report Includes:**
- **Header:** Black bar with tournament name, game/format subtitle, red accent line
- **Stats Row:** Participant count, completion date
- **Final Standings:** Top 8 with medal circles for top 3 (gold/silver/bronze)
- **Notable Matches:** Top 5 finals/semifinals in table format
- **Tournament Statistics:** 4-column stat boxes (total matches, completed, forfeits, duration)
- **Match Highlights:** Two-column layout with biggest upsets and closest matches
- **Player Analytics (archive only):** Elo changes (gainers/losers) and attendance stats (new/returning)
- **Footer:** Generation timestamp

**PDF Styling:**
- Dark/minimalist design with PDF_COLORS palette
- Helper functions: drawPdfMedal(), drawPdfSectionHeader(), drawPdfTableRow()
- Analytics helpers: findUpsets(), findCloseMatches(), calculateMatchStats(), calculateDuration()
- Page management: 1-2 pages max with proper page break handling

**UI Locations:**
- Analytics page: Export buttons on each archived tournament card
- Tournament page: Export section (visible when tournament is complete or underway)

### Tournament Templates
```
GET    /api/templates              - List all templates
GET    /api/templates/:id          - Get template by ID
POST   /api/templates              - Create new template
PUT    /api/templates/:id          - Update template (name, description only)
DELETE /api/templates/:id          - Delete template (cannot delete default)
POST   /api/templates/from-tournament - Create template from tournament data
```

**Template Object:**
```json
{
  "id": 1,
  "name": "SSBU Weekly",
  "description": "Standard weekly tournament settings",
  "gameName": "Super Smash Bros. Ultimate",
  "isDefault": false,
  "createdBy": "admin",
  "createdAt": "2025-12-09T...",
  "updatedAt": "2025-12-09T...",
  "settings": {
    "tournamentType": "double elimination",
    "signupCap": 32,
    "checkInDuration": 30,
    "grandFinalsModifier": "single",
    "hideSeeds": false,
    "autoAssign": true
  }
}
```

**Create Template Request:**
```javascript
POST /api/templates
{
  name: "My Template",
  description: "Optional description",
  gameName: "Super Smash Bros. Ultimate",
  settings: {
    tournamentType: "double elimination",
    signupCap: 32,
    // ... other tournament settings
  }
}
```

**UI Locations:**
- **Tournament Wizard (Step 1):** "Load from Template" dropdown pre-fills wizard fields
- **Tournament Creation Success:** "Save as Template" button opens save modal
- **Settings Page:** Template management section with list, edit, and delete

**Rate Limit Status Response:**
```json
{
  "adaptiveEnabled": true,
  "currentMode": "IDLE",
  "modeDescription": "No upcoming tournaments",
  "effectiveRate": 12,
  "manualRateLimit": 30,
  "manualOverride": null,
  "settings": { "idleRate": 12, "upcomingRate": 20, "activeRate": 30 },
  "lastCheck": "2025-11-27T04:48:41.000Z",
  "nextCheck": "2025-11-27T12:48:41.000Z",
  "devModeActive": false,
  "matchPolling": {
    "active": false,
    "intervalMs": 15000,
    "lastPollTime": null
  }
}
```

## Page Details

### Dashboard (index.html, dashboard.js)

**Purpose:** Quick glanceable overview and rapid tournament controls

**Sections:**
- System Status Bar (4 cards: Match, Bracket, Flyer modules + API Rate status)
- Active Tournament (name, game, stats, quick actions)
- Enhanced Stats Row (check-in count, current round, in-progress, remaining, time estimate)
- Live Activity Feed (real-time event stream with filtering, search, sound notifications)
- Live Matches Panel (current matches with elapsed time)
- Upcoming Matches Queue (next 5 matches with player names)
- Ticker Message (send announcements to match display)
- Display Timers (DQ timers per TV, tournament timer with custom duration)
- QR Code Controls (signup, bracket, custom URL display)
- Quick Actions Grid (links to all pages)

**Enhanced Stats (visible during tournament):**
- Check-in Count: X/Y format showing checked-in vs total participants
- Current Round: Shows active round (W1, L2 format for double elim)
- In Progress: Number of matches currently underway
- Remaining: Matches left to play
- Time Estimate: Based on average match duration

**Ticker Message Features:**
- 4 preset quick messages (5 Min Break, Report In, Starting Soon, Finals)
- Custom message input (up to 200 characters)
- Configurable duration (3-30 seconds, default 5)
- Preset buttons send immediately on click
- Messages display as slide-up overlay on match display

**Display Timer Features:**
- DQ Timers: "TV 1 - 3min DQ" and "TV 2 - 3min DQ" preset buttons
- Tournament Timer: number input (1-60 min) with "Start Timer" button
- Timers auto-hide when countdown reaches 0 (no manual hide needed)
- Visual warning states on display (yellow at 30s, red at 10s)

**QR Code Display Features:**
- Signup Page: Shows signup URL QR code
- Bracket Link: Shows current tournament bracket URL
- Custom URL: Input any URL with optional label
- Hide QR: Remove overlay from match display

**Live Activity Feed Features:**
- Real-time WebSocket updates via Socket.IO
- Filter buttons: All, Signups, Matches, Displays, Admin
- Search input for filtering by text
- Connection status indicator (Live/Connecting/Disconnected)
- Sound toggle for notification beeps (Web Audio API)
- Collapsible with localStorage persistence
- Unread badge when collapsed
- Load More button for pagination
- Color-coded icons by activity category

**Activity Types:**
| Category | Events |
|----------|--------|
| participant | `participant_signup`, `participant_checkin`, `participant_checkout` |
| match | `match_start`, `match_complete`, `match_dq` |
| display | `display_online`, `display_offline` |
| admin | `admin_login`, `admin_logout` |
| system | `dev_mode_enabled`, `dev_mode_disabled`, settings changes |

**Key Functions:**
```javascript
refreshAllStatus()      // 10s polling (pauses when tab hidden)
loadActiveTournament()  // 15s polling (pauses when tab hidden)
updateStatusCards()     // Update UI from status data
setTickerPreset(msg)    // Send preset message immediately
sendTickerMessage()     // Send custom message from textarea
startDQTimer(tv)        // Start 3-min DQ timer for "TV 1" or "TV 2"
startTournamentTimer()  // Start tournament timer with custom duration
loadParticipantStats()  // Load check-in counts
formatElapsedTime()     // Format match duration
showSignupQR()          // Show signup page QR
showBracketQR()         // Show bracket link QR
showCustomQR()          // Show custom URL QR
hideQRCode()            // Hide QR overlay
initActivityFeed()      // Initialize Socket.IO and activity feed
handleNewActivity()     // Handle incoming activity events
renderActivityItem()    // Render single activity entry
filterActivity()        // Filter by category
toggleActivityFeed()    // Collapse/expand feed
toggleActivitySound()   // Toggle sound notifications
```

### Tournament (tournament.html, tournament.js)

**Purpose:** Tournament selection, creation, editing, and configuration

**Sections:**
- Tournament Selection (tabs: Pending, In Progress, Completed)
- Create Tournament button (opens 3-step wizard)
- Edit Tournament button (pencil icon on each tournament)
- Configuration (game, registration window, signup cap)
- Tournament Controls (Start, Reset, Finalize, Delete buttons)
- **Pre-Flight Checklist** (visible when pending tournament selected)

**Registration Window Behavior:** The registration window controls when signup **opens** (X hours before scheduled start). Registration stays open until tournament is **explicitly started** via "Start Tournament" button - does NOT auto-close at scheduled time. This allows late walk-in entries at live events.

**Key Functions:**
```javascript
// Tournament management
loadTournaments()       // Load from Challonge
selectTournament(id)    // Select for configuration
submitConfiguration()   // Deploy to displays
startTournament()       // Start via Challonge API
resetTournament()       // Reset via Challonge API
deleteTournament()      // Delete via Challonge API

// Creation wizard
openCreateWizard()           // Open tournament creation wizard
closeCreateWizard()          // Close wizard modal
nextWizardStep()             // Navigate to next step
prevWizardStep()             // Navigate to previous step
resetWizardForm()            // Reset all wizard fields to defaults
updateFormatSelection()      // Show/hide format-specific options (incl. group stage for elim)
setupWizardEventListeners()  // Initialize wizard event handlers
toggleWizardGroupStageOptions() // Show/hide group stage options based on checkbox
createTournament()           // Create new tournament via Challonge API (v2.1)

// Edit modal
openEditModal(id)              // Open edit modal with tournament data
closeEditModal()               // Close edit modal
populateEditForm(tournament)   // Populate all form fields from tournament data
saveTournamentEdit()           // Save tournament changes via PUT API
setupEditModalEventListeners() // Setup conditional field visibility
handleRankedByChange()         // Show/hide custom points for round robin
```

**Creation Wizard Features:**
- Step 1 (Basic Info): Name, game, description
- Step 2 (Format): Tournament type with format-specific options
  - Single Elimination: Third place match, sequential pairings, show rounds, group stage (pools)
  - Double Elimination: Grand finals modifier, sequential pairings, show rounds, group stage (pools)
  - Round Robin: Iterations (1-3), ranking method, custom point values
  - Swiss: Number of rounds, point values (match win/tie/bye, game win/tie)
  - All elimination formats: Hide seeds, auto-assign stations, group stage options
  - Group Stage: Stage type (RR/Swiss), group size, participants to advance, ranking method
- Step 3 (Schedule): Start time, check-in, signup cap, registration options, notifications

**Edit Modal Features:**
- Loads full tournament details from GET /api/tournament/:id
- Organized into sections: Basic Info, Schedule, Registration, Format Options, Display & Privacy, Match Settings, Notifications
- **Basic Info:** name, game, description
- **Schedule:** start date/time, check-in duration
- **Registration:** signup cap, open signup toggle
- **Format Options** (conditional based on tournament type):
  - Single Elimination: third place match, sequential pairings, show rounds
  - Double Elimination: grand finals modifier, sequential pairings, show rounds
  - Round Robin: ranking method, custom point values (when "custom" selected)
  - Swiss: number of rounds, all point values (match win/tie/bye, game win/tie)
- **Display & Privacy:** hide seeds, private tournament, hide forum
- **Match Settings:** accept attachments, quick advance
- **Notifications:** notify on match open, notify on tournament end
- **Read-only:** tournament format (cannot change after creation), Challonge URL link

**Pre-Flight Checklist:**
Automated verification shown when a pending tournament is selected:

| Check | API Call | Success | Warning | Error |
|-------|----------|---------|---------|-------|
| Display Modules | GET /api/status | All 3 online | 1-2 offline | All offline |
| Pi Displays | GET /api/displays | All online | Some offline | None registered |
| Tournament Deployed | GET /api/status | State file exists | - | Not deployed |
| Participants | GET /api/participants | Count > 0 | 0 participants | API error |
| Flyer Set | GET /api/status | Flyer configured | - | No flyer |
| Stations Configured | GET /api/stations | Stations exist | 0 stations | API error |
| Challonge API | GET /api/test-connection | Connected | - | Connection failed |

**Checklist Functions:**
```javascript
refreshChecklist()           // Run all checks
checkDisplayModules()        // Check match/bracket/flyer APIs
checkPiDisplays()            // Check registered Pi displays
checkTournamentDeployed()    // Verify state file exists
checkParticipants()          // Get participant count
checkFlyer()                 // Verify flyer configured
checkStations()              // Check station configuration
checkChallongeApi()          // Test API connectivity
updateChecklistItem(id, status, badge)  // Update UI
updateChecklistSummary()     // Update ready count
updateChecklistVisibility()  // Show/hide based on tournament state
```

### Matches (matches.html, matches.js)

**Purpose:** Match scoring, management, and TV station configuration

**Sections:**
- Station Management (TV stations list, add/delete, auto-assign toggle)
- Match Filters (All, Open, In Progress, Complete)
- Match List (cards with player names, scores, station dropdown)
- Score Modal (increment/decrement, declare winner, DQ/forfeit, clear scores)
- Batch Score Modal (enter multiple scores at once)

**Key Functions:**
```javascript
// Match functions
loadMatches()                    // Load from Challonge (includes station mapping)
markMatchUnderway(matchId)       // Mark in progress
openScoreModal(match)            // Show score entry
submitScore(matchId, scores)     // Update score
declareWinner(matchId, winnerId) // Set winner
reopenMatch(matchId)             // Reopen completed
forfeitMatch(playerNum)          // DQ/forfeit - advance winner with 0-0 score
clearScores()                    // Clear match scores
assignStation(matchId, stationId) // Assign/unassign station to match

// Station functions
refreshStations()                // Load stations and settings
renderStations()                 // Render station list UI
createStation()                  // Create new station (TV 1, TV 2)
deleteStation(stationId, name)   // Delete station
toggleAutoAssign()               // Toggle auto-assign setting
getStationName(stationId)        // Get station name by ID

// Batch score functions
openBatchScoreModal()            // Show batch score modal (Ctrl+Shift+S)
closeBatchScoreModal()           // Close modal
renderBatchScoreTable()          // Render table of scorable matches
setBatchWinner(index, playerNum) // Quick 2-0 or 0-2 score
validateBatchRow(index)          // Validate single row
updateBatchValidation()          // Update validation summary
getValidBatchEntries()           // Get array of valid entries
handleBatchScoreKeydown(e, i, p) // Handle keyboard navigation
submitBatchScores()              // Submit all valid scores
handleBatchResults(results)      // Show per-row success/failure
```

**Match Card Features:**
- Station dropdown (appears for open/underway matches when stations exist)
- Station badge displayed next to match state
- Default selection shows currently assigned station

**Score Modal Features:**
- Quick Winner buttons (1-0 score)
- DQ/Forfeit buttons (0-0 score, advances selected player)
- Score entry with +/- buttons
- Declare Winner with custom score
- Clear Scores link

**Station Management:**
- Create TV 1 and TV 2 stations for match display assignment
- Auto-assign toggle automatically assigns open matches to available stations
- Auto-assign can only be changed when tournament is pending (reset to change)

**Batch Score Entry (Quick Score Modal):**
- Opens with "Quick Score" button or Ctrl+Shift+S keyboard shortcut
- Shows all open and underway matches in a table
- Quick winner buttons (P1/P2) per row for 2-0 scores
- Tab through score inputs, Enter to set winner by score comparison
- Ctrl+Enter to submit all valid entries at once
- Per-row validation with visual feedback (green check, red x)
- Partial success handling (shows success/failure per row)
- Real-time validation count ("2 of 3 ready to submit")

### Flyers (flyers.html, flyers.js)

**Purpose:** Flyer management and display updates

**Supported formats:** PNG, JPG, MP4 (max 50MB)

**Sections:**
- Current Display Status (flyer module only)
- Upload Form (file + custom name)
- Flyer Gallery (thumbnails/video icons with Set Active/Delete buttons, file size, date)

**Key Functions:**
```javascript
loadFlyers()           // Load flyer list
renderGallery()        // Render thumbnails with active indicator
setActiveFlyer(name)   // Set flyer as active on display
setupUploadForm()      // Handle uploads
previewFlyer(name, isVideo)  // Full preview modal (image or video)
confirmDelete()        // Delete with confirmation
isVideoFile(filename)  // Check if file is MP4
```

**Gallery Card Features:**
- Active flyer highlighted with green border and "Active" badge
- Video files show purple "Video" badge and play icon
- "Set Active" button on non-active flyers
- "Delete" button on all flyers
- File size and modified date displayed
- Video preview with playback controls (autoplay, loop)

### Games (games.html, games.js)

**Purpose:** Game configuration management with inline editing

**Sections:**
- Game Cards Grid (card per game showing name, key, stats, expand for rules/prizes)
- Add/Edit Game Modal (dynamic rule/prize/info row management)
- Delete Confirmation Modal

**Key Functions:**
```javascript
loadGames()              // Load game configs from API (30s polling)
renderGamesList()        // Render game cards with stats
openAddGameModal()       // Open modal for new game
openEditGameModal(key)   // Open modal with existing game data
closeGameModal()         // Close modal
saveGame(event)          // Create or update game via API
addRuleRow()             // Add dynamic rule input row
addPrizeRow()            // Add dynamic prize input row
addInfoRow()             // Add dynamic info input row
removeRow(btn, type)     // Remove rule/prize/info row
confirmDelete(key)       // Delete game with confirmation
```

**Game Config Structure:**
```javascript
{
  name: "Super Smash Bros. Ultimate",
  shortName: "SSBU",
  rules: [
    { title: "Tournament Format", description: "Single Elimination..." }
  ],
  prizes: [
    { place: 1, position: "1st Place", emoji: "...", amount: 30, gradient: "...", extras: [] }
  ],
  additionalInfo: ["Entry is FREE...", "BYOC..."]
}
```

**Features:**
- 30-second polling with Page Visibility API (pauses when tab hidden)
- Inline editing of rules, prizes, and additional info
- Dynamic add/remove rows for rules, prizes, and info
- Hot-reload to tournament-signup (via chokidar file watcher)
- Cannot delete 'default' game configuration

### Sponsors (sponsors.html, sponsors.js)

**Purpose:** Sponsor logo overlay management for Match and Bracket displays

**Supported formats:** PNG, JPG, GIF, SVG, WEBP (max 10MB)

**Sections:**
- Sponsor Configuration (enable/disable, rotation interval)
- Upload Form (file + sponsor name)
- Sponsor Gallery (drag-drop reorder, position assignment)
- Live Preview (position preview grid)

**Key Functions:**
```javascript
loadSponsors()              // Load sponsor list and config
renderGallery()             // Render sponsor cards with position badges
handleSponsorUpload()       // Handle sponsor upload
toggleActive(id, state)     // Toggle sponsor active state
showSponsorNow(id)          // Show single sponsor on displays
hideSponsorNow(position)    // Hide single sponsor at position
showAllSponsors()           // Show all active sponsors
hideAllSponsors()           // Hide all sponsor overlays
filterByPosition(position)  // Filter gallery by position
updateOffsetValue(id, axis, value)     // Update offset from slider
updateOffsetFromInput(id, axis, value) // Update offset from number input
sendRealtimeOffsetUpdate(id)           // Push real-time offset to display
saveOffset(id)              // Save offset values to database
saveConfig()                // Update rotation/enabled settings
```

**Sponsor Card Features:**
- Logo thumbnail preview
- Name and position display
- Action buttons: Show, Hide, On/Off, Edit, Delete
- X/Y offset sliders with number inputs (real-time positioning, -500 to +500px)
- Size displayed as multiplier (e.g., "1.5x")
- Opacity percentage display

**Gallery Features:**
- Position filter tabs (All, Top Left, Top Right, Bottom Left, Bottom Right, Top Banner, Bottom Banner)
- Filter tabs located inside gallery section header
- Grid layout (1-4 columns responsive)

**Position Types:**
| Type | Positions | Size |
|------|-----------|------|
| Corner | top-left, top-right, bottom-left, bottom-right | 200x100px base, scalable |
| Banner | top-banner, bottom-banner | Full width, 80px height |

**Display Integration:**
- WebSocket push to Match (port 2052) and Bracket (port 2053) displays
- Sponsors appear as fixed overlays at z-index 9500
- Fade in/out animations (0.5s duration)
- Auto-rotation based on configured interval

### Displays (displays.html, displays.js)

**Purpose:** Display module and Pi management with full system monitoring and debug logging

**Sections:**
- Module Status (Match, Bracket, Flyer displays)
- Bracket Controls (zoom slider, match focus, quick actions)
- Registered Displays (Pi devices with comprehensive system info)
- Debug Logs Modal (view, filter, download debug logs)
- Setup Instructions

**Key Functions:**
```javascript
refreshModuleStatus()    // Load module status (10s polling)
refreshDisplays()        // Load Pi devices (15s polling)
rebootDisplay(id)        // Queue remote reboot (cross-network)
shutdownDisplay(id)      // Queue remote shutdown (cross-network)
assignDisplayView(id, view)  // Change assigned view
formatUptime(seconds)    // Format uptime as "Xd Xh Xm"

// Debug mode functions
toggleDebugMode(id, enabled)  // Toggle debug mode for display
viewDebugLogs(id, hostname)   // Open debug logs modal
closeDebugLogsModal()         // Close debug logs modal
refreshDebugLogs()            // Reload logs from server
filterDebugLogs()             // Apply level/source filters
clearDebugLogs()              // Clear all debug logs
copyDebugLogs()               // Copy logs to clipboard
downloadDebugLogs()           // Download logs as JSON file

// Bracket control functions
setBracketZoom(value)    // Update zoom slider display and apply zoom
applyBracketZoom()       // Apply zoom level to bracket via API
resetBracketView()       // Reset to default zoom (1.0x)

// Advanced section (display scaling)
toggleAdvancedSection(id)    // Toggle collapsible Advanced section
updateScaleValue(id, value)  // Update scale display from slider
setDisplayScale(id, scale)   // Set scale slider to preset value
applyDisplayScale(id)        // Apply scale via CDP (real-time) or config
```

**Note:** Focus on Match controls have been removed - Challonge iframe doesn't support scrollToMatchIdentifier.

**Registered Display Card Layout:**
Each display shows:
- **Header**: Status indicator, hostname, last seen, Debug toggle, View selector, Reboot/Shutdown buttons
- **Debug Toggle**: Purple toggle switch to enable/disable debug mode
- **Logs Button**: Appears when debug mode is on, shows log count
- 4-column grid with:
  1. **Network**: Internal IP, External IP, MAC address
  2. **WiFi**: SSID, Quality % with label (Excellent/Good/Fair/Poor), Signal dBm
  3. **System Health**: CPU temp, Memory %, Voltage with throttle status
  4. **Display**: Current view, Assigned view, Sync status

**Debug Logs Modal:**
- Level filter dropdown (All, Debug, Info, Warning, Error)
- Source filter dropdown (All, Kiosk, Manager, Chromium, System)
- Refresh, Clear buttons
- Log entries color-coded by level and source
- Copy to Clipboard button
- Download as JSON button
- Logs displayed newest first

**Color-Coded Log Levels:**
- Debug: Gray
- Info: Blue
- Warning: Yellow
- Error: Red

**Color-Coded Log Sources:**
- Kiosk: Purple
- Manager: Green
- Chromium: Orange
- System: Cyan

**Color-Coded System Indicators:**
- WiFi Quality: Green (≥80%), Blue (≥60%), Yellow (≥40%), Red (<40%)
- CPU Temp: Green (<60C), Yellow (60-70C), Red (≥70C)
- Memory: Green (<60%), Yellow (60-80%), Red (≥80%)
- Voltage: Green (≥0.9V OK), Yellow (0.85-0.9V Low), Red (<0.85V Throttled)

**Cross-Network Reboot/Shutdown:**
Commands work across different networks using a command queue:
- Admin queues command via POST `/api/displays/:id/reboot` or `/shutdown`
- Pi polls config every 10 seconds and executes pending commands
- No direct SSH or network connectivity required between admin and Pi

**Bracket Controls:**
- Zoom slider (0.3x to 3.0x) with preset buttons (0.5x, 1.0x, 2.0x) and Apply Zoom
- Slider value updates in real-time as slider is moved
- Reset View button (resets to 1.0x default zoom)
- Note: Focus on Match controls removed due to Challonge iframe limitations

**Advanced Section (Display Scaling):**
Collapsible section in each display card for scale control (default collapsed):
- **Header** (always visible): "ADVANCED" label, CDP badge (green if enabled), detected TV size
- **Expanded Content**: Detection info, scale slider (0.5x-3.0x), preset buttons, Apply button
- CDP-enabled displays apply scale instantly via Chrome DevTools Protocol
- Non-CDP displays require browser restart (~10s)
- Default 1.0x works well across most TV sizes (tested 15.5" to 84.5")

**Display Info from Pi Heartbeat:**
| Field | Description |
|-------|-------------|
| displayInfo.physicalWidth | Physical width in mm from xrandr |
| displayInfo.physicalHeight | Physical height in mm from xrandr |
| displayInfo.diagonalInches | Calculated diagonal size |
| displayInfo.suggestedScale | Suggested scale (not used - 1.0x works universally) |
| cdpEnabled | True if CDP service running on Pi |

### Participants (participants.html, participants.js)

**Purpose:** Full participant management with Challonge API integration

**Features:**
- Participant table with seed, name, status, contact info, misc
- Status badges: Checked In, Active, Waiting List, Invite Pending
- Drag-and-drop seed reordering (SortableJS)
- Inline seed editing (click to change)
- Add/Edit/Delete individual participants
- Bulk add: Names only or CSV format (name, email, seed, misc)
- Check-in/Undo check-in controls (when tournament has check-in enabled)
- Clear All Participants (before tournament starts only)
- Randomize Seeds
- Export to CSV
- Search/filter participants
- Sort by seed or name with localStorage persistence
- Auto-refresh every 30 seconds

**Participant Fields:**
| Field | Description |
|-------|-------------|
| name | Display name (required if no email/username) |
| email | Searches for Challonge account or sends invite |
| challongeUsername | Links to existing Challonge account |
| seed | Seeding position |
| instagram | Instagram handle (stored in misc) |
| misc | Multi-purpose field (max 255 chars) |

**Key Functions:**
```javascript
// CRUD operations
loadParticipants()           // Fetch from Challonge API
addParticipant(event)        // Add single participant
saveParticipantEdit(event)   // Update participant
deleteParticipant(id, name)  // Delete participant

// Bulk operations
submitBulkAdd()              // Add multiple participants
randomizeSeeds()             // Randomize all seeds
clearAllParticipants()       // Delete all participants

// Check-in
checkInParticipant(id, name)     // Check in participant
undoCheckInParticipant(id, name) // Undo check-in

// Sort with localStorage persistence
sortTable(column)            // Sort by column, toggles direction
loadSortPreferences()        // Load from localStorage on page load
saveSortPreferences()        // Save to localStorage on sort change
updateSortIndicators()       // Update visual sort indicators in headers

// UI helpers
updateBulkAddPlaceholder()   // Switch between names/CSV format
parseBulkAddParticipants()   // Parse textarea input
exportToCSV()                // Download participant list
```

### Settings (settings.html, settings.js)

**Purpose:** User and system management

**Sections:**
- User Management (table with add/edit/delete)
- Change Password (current + new)
- System Settings (admin only, 8 tabs):
  - Challonge Account (OAuth connection, rate limit)
  - System Defaults
  - Security
  - Notifications
  - Display Settings
  - Data Retention
  - Activity Log
  - System Monitoring

**Challonge Account Tab:**
- **OAuth Connection Section:**
  - Connect/Disconnect Challonge account button
  - Connection status (connected username, token expiry)
  - Refresh Token button (manual token refresh)
- **Rate Limiting Section:**
  - Rate Limit Cap (`min=1, max=60`) - maximum for all modes
  - Adaptive Rate Limiting:
    - Enable/disable adaptive mode
    - IDLE rate (`min=1, max=60`, recommended 12)
    - UPCOMING rate (`min=1, max=60`, recommended 20)
    - ACTIVE rate (`min=1, max=60`, recommended 30)
    - Check interval (`min=1, max=24` hours, default 8)
    - Upcoming window (`min=1, max=168` hours, default 48)
  - Current Status display (mode, effective rate, next check time)
  - Development Mode toggle (3-hour rate limit bypass, auto-expires)
- Stale tournament filtering: 7+ day old underway tournaments ignored

**HTML Input Ranges (settings.js):**
| Input | Min | Max | Default |
|-------|-----|-----|---------|
| Rate limit cap | 1 | 60 | 15 |
| IDLE rate | 1 | 60 | 1 (code) / 12 (recommended) |
| UPCOMING rate | 1 | 60 | 5 (code) / 20 (recommended) |
| ACTIVE rate | 1 | 60 | 15 (code) / 30 (recommended) |
| Check interval | 1 | 24 | 8 hours |
| Upcoming window | 1 | 168 | 48 hours |

**System Monitoring Tab:**
- Quick Check button - instant one-time system diagnostic
- View Service Logs button - view recent logs from any service
- Monitoring Session controls:
  - Duration dropdown (1, 5, 10, 15, 30, 60 min, 2 hours)
  - Start/Stop Monitoring buttons
  - Session status display (samples collected, elapsed time)
  - Generate Report button
- Results display area for quick check and reports
- Copy for Claude button - copies report to clipboard
- Saved Reports section - view, copy, or delete past reports

**Key Functions (settings.js):**
```javascript
// Monitoring functions
loadMonitoringStatus()      // Check if session active
startMonitoring()           // Start collection session
stopMonitoring()            // Stop collection session
generateReport()            // Generate report from session
runQuickCheck()             // One-time instant check
displayQuickCheckResults()  // Render quick check results
viewServiceLogs()           // Load and display service logs
displayServiceLogs()        // Render log output
displayReport()             // Render monitoring report
copyReportToClipboard()     // Copy report JSON for Claude
loadSavedReports()          // List saved report files
viewSavedReport()           // View specific saved report
deleteSavedReport()         // Delete saved report file
```

### Analytics (analytics.html, analytics.js)

**Purpose:** Historical tournament data, player rankings, and seeding suggestions

**Sections:**
- Game Tabs (auto-generated from archived data)
- Stats Overview (4 cards: Tournaments, Players, Matches, Avg Attendance)
- Content Tabs:
  - Rankings (Elo leaderboard by game)
  - Players (search and profile view)
  - Tournaments (archived history)
  - Head-to-Head (comparison tool)
  - Attendance (charts and trends)
- Archive Tournament Modal
- Player Profile Modal
- Narrative Modal (AI-generated tournament recaps)
- Seeding Suggestions Section (bottom of page)

**Seeding Suggestions Features:**
- Tournament dropdown (shows pending tournaments only)
- Start/Stop Polling toggle (30-second interval)
- Status bar showing polling state
- **AI Seeding toggle** (enables Anthropic Claude-powered suggestions)
- Seeding table with:
  - Lock checkbox (lock seed positions)
  - Suggested seed (based on Elo or AI)
  - Current seed (from Challonge)
  - Player name with "New Player" badge for < 3 tournaments
  - Elo rating
  - Reasoning column (AI mode only)
- Apply Suggested Seeding button (bulk updates via Challonge API)
- Regenerate button (AI mode - optimizes around locked seeds)
- Page Visibility API (pauses polling when tab hidden)

**AI Seeding Mode:**
When enabled, uses Anthropic Claude (claude-sonnet-4-20250514) to generate intelligent bracket seeding:
- Analyzes player Elo, win rates, tournament experience, recent placements
- Separates top seeds until late rounds
- Protects new players with mid-tier R1 opponents
- Avoids repeat matchups from last 2 tournaments
- Balances bracket halves by total Elo
- Respects locked seed positions during regeneration
- Shows AI reasoning for each seed assignment
- Bracket balance visualization (top/bottom half Elo percentage)
- Requires ANTHROPIC_API_KEY in .env (get key at console.anthropic.com)
- Falls back to pure Elo-based seeding when API unavailable

**Tournament Narrative Feature:**
AI-powered tournament recap generator for archived tournaments. Accessed via "Generate Recap" button on tournament cards.

**Narrative Formats:**
| Format | Max Length | Use Case |
|--------|------------|----------|
| Social | 280 chars | Twitter/X posts |
| Discord | 2-3 paragraphs | Discord announcements with markdown |
| Full | Comprehensive | Detailed tournament reports |

**Narrative Modal Features:**
- Format tabs (Social, Discord, Full) - switch between narrative styles
- Progress indicator with rotating status messages
- Storyline detection badges (upsets, close matches, reverse sweeps, losers runs)
- Copy to Clipboard button
- Regenerate button for fresh AI generation
- Cache source indicator (AI-generated vs cached)

**Storyline Detection:**
- **Upsets:** Lower seed defeats higher seed (seed diff ≥ 3)
- **Close Matches:** Final set decided by 1 game or score within 2 points
- **Reverse Sweeps:** Player wins after being down 0-2 or 1-2
- **Losers Runs:** Player wins 3+ consecutive matches in losers bracket

**Key Functions:**
```javascript
// Data loading
loadGames()                  // Load game tabs
loadStatsOverview()          // Load summary stats
loadRankings()               // Load Elo leaderboard
searchPlayers()              // Search player database
loadTournaments()            // Load archived tournaments
loadHeadToHead()             // Load H2H comparison
loadAttendanceStats()        // Load attendance data

// Archiving
loadArchiveStatus()          // Check archived vs unarchived
archiveTournament(id)        // Archive completed tournament

// Seeding suggestions
loadUpcomingTournaments()    // Load pending tournaments
loadSeedingSuggestions()     // Fetch Elo-based or AI suggestions
startSeedingPolling()        // Start 30s polling interval
stopSeedingPolling()         // Stop polling
applySeedingSuggestions()    // Apply seeds to Challonge

// AI Seeding
checkAISeedingStatus()       // Check if AI seeding available
toggleAISeeding(enabled)     // Toggle AI mode on/off
loadAISeedingSuggestions()   // Fetch AI suggestions from Claude
renderAISeedingSuggestions() // Render AI suggestions with reasoning
toggleSeedLock(id, seed)     // Lock/unlock seed position
regenerateAISeeding()        // Force regenerate around locked seeds

// Tournament Narratives
checkNarrativeStatus()       // Check if AI narrative available
openNarrativeModal(id, name) // Open narrative modal for tournament
closeNarrativeModal()        // Close narrative modal
generateNarrative(id, fmt)   // Generate narrative (format: social/discord/full)
switchNarrativeFormat(fmt)   // Switch between format tabs
regenerateNarrative()        // Force regenerate with current format
copyNarrative()              // Copy narrative text to clipboard

// Player profiles
openPlayerProfile(id)        // Open player modal
closePlayerProfile()         // Close modal
```

**Elo Rating System:**
- K-factor: 32
- Starting rating: 1200
- Calculated on tournament archival
- Per-game ratings (separate for SSBU, Melee, etc.)
- History tracked in rating_history table

**Player Name Matching:**
- Case-insensitive normalization
- Special character removal
- Levenshtein distance for fuzzy matching (threshold: 2)
- Manual alias support via player_aliases table

## Data Files

```
users.json           - User accounts with bcrypt hashes
auth-data.json       - Failed login tracking, lockouts
system-settings.json - All system settings (including challonge.rateLimit)
activity-log.json    - Admin action audit trail
analytics.db         - SQLite database for historical analytics + API cache
```

## Cache Database (cache-db.js)

SQLite-based caching module for Challonge API responses. Reduces redundant API calls, improves dashboard loading times, and provides offline resilience via stale-while-revalidate pattern.

**Cache Tables (stored in analytics.db):**
```sql
cache_tournaments (cache_key, data_json, cached_at, expires_at)
cache_matches (tournament_id, data_json, match_count, cached_at, expires_at)
cache_participants (tournament_id, data_json, participant_count, cached_at, expires_at)
cache_stations (tournament_id, data_json, cached_at, expires_at)
cache_tournament_details (tournament_id, data_json, cached_at, expires_at)
cache_stats (cache_type, hits, misses, api_calls_saved, last_hit, last_miss, created_at)
```

**TTL Configuration:**
| Data Type | Default TTL | Active Mode TTL |
|-----------|-------------|-----------------|
| Tournaments | 60s | 30s |
| Matches | 30s | 15s |
| Participants | 120s | 60s |
| Stations | 300s | 60s |
| Tournament Details | 300s | 120s |

**Key Exports:**
```javascript
const cacheDb = require('./cache-db');

// Core operations
cacheDb.getCachedData(type, key)           // Get cached data with metadata
cacheDb.setCachedData(type, key, data, ttl) // Store data in cache
cacheDb.getCachedOrFetch(type, key, fetchFn) // Stale-while-revalidate pattern

// Invalidation
cacheDb.invalidateCache(type, key)         // Clear specific cache
cacheDb.invalidateTournamentCaches(id)     // Clear all caches for tournament
cacheDb.invalidateAllCache()               // Clear all caches

// Maintenance & Stats
cacheDb.cleanupExpiredCache()              // Remove expired entries
cacheDb.getCacheStats()                    // Get hit/miss statistics
cacheDb.resetCacheStats()                  // Reset statistics
cacheDb.getTournamentCacheSummary(id)      // Get cache summary for tournament
cacheDb.setActiveTournamentMode(active)    // Toggle shorter TTLs
```

**Stale-While-Revalidate Pattern:**
- Fresh cache hit → Return immediately
- Stale cache + API success → Return fresh, update cache
- Stale cache + API failure → Return stale with `offline: true` flag
- No cache + API failure → Throw error

**Cache Metadata (_cache field in responses):**
```javascript
{
  hit: true,           // Was this served from cache?
  source: 'database',  // 'database' or 'api'
  cachedAt: '...',     // When data was cached
  ageSeconds: 15,      // How old the cache is
  stale: false,        // Is cache expired?
  offline: false,      // Was API unavailable?
  error: null          // Error message if API failed
}
```

**Cache Management API Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cache/status` | GET | Get cache statistics (hits, misses, hit rate) |
| `/api/cache/invalidate` | POST | Clear specific cache type (body: `{type, key?}`) |
| `/api/cache/clear` | POST | Clear all caches |
| `/api/cache/tournament/:id` | GET | Get cache summary for specific tournament |

**Cached GET Endpoints:**
- `GET /api/tournaments` - Tournament list (60s TTL)
- `GET /api/matches/:tournamentId` - Match data (30s TTL)
- `GET /api/participants/:tournamentId` - Participant list (120s TTL)
- `GET /api/stations/:tournamentId` - Station list (300s TTL)
- `GET /api/tournament/:tournamentId` - Tournament details (300s TTL)

**Auto-Invalidation Triggers:**
- Match mutations → invalidate matches cache
- Station assignment → invalidate matches + stations
- Participant mutations → invalidate participants cache
- Station create/delete → invalidate stations cache
- Tournament lifecycle (start/reset/complete/delete) → invalidate all tournament caches

**Settings UI:**
Cache tab in Settings page provides:
- Cache statistics overview (hits, misses, API calls saved, hit rate)
- Per-type statistics and entry counts
- Clear cache by type buttons
- Clear all caches button
- TTL reference table

## Analytics Database (analytics-db.js)

SQLite database module for historical tournament data.

**Database Schema:**
```sql
players (id, canonical_name, display_name, email, challonge_username, instagram, created_at)
player_aliases (id, player_id FK, alias, normalized_alias UNIQUE)
games (id, name UNIQUE, short_code, created_at)
tournaments (id, challonge_id, challonge_url UNIQUE, name, game_id FK, tournament_type,
             participant_count, started_at, completed_at, archived_at)
tournament_participants (id, tournament_id FK, player_id FK, challonge_participant_id,
                         seed, final_rank, UNIQUE(tournament_id, player_id))
matches (id, tournament_id FK, challonge_match_id, round, player1_id FK, player2_id FK,
         winner_id FK, loser_id FK, player1_score, player2_score, scores_csv, completed_at)
player_ratings (id, player_id FK, game_id FK, elo_rating DEFAULT 1200, peak_rating,
                matches_played, wins, losses, last_active, UNIQUE(player_id, game_id))
rating_history (id, player_id FK, game_id FK, tournament_id FK, rating_before,
                rating_after, rating_change, recorded_at)
unmatched_players (id, tournament_id FK, original_name, suggested_player_id, status)
tournament_narratives (id, tournament_id FK, format, narrative, social_post, data_hash,
                      storylines_json, metadata_json, source DEFAULT 'ai', generated_at,
                      UNIQUE(tournament_id, format))
```

**Key Exports:**
```javascript
const analyticsDb = require('./analytics-db');

analyticsDb.getDb()                        // Get database connection
analyticsDb.normalizePlayerName(name)      // Normalize for matching
analyticsDb.findPlayerByName(name)         // Find with fuzzy matching
analyticsDb.getOrCreatePlayer(name, data)  // Get or create player
analyticsDb.getOrCreateGame(name)          // Get or create game
analyticsDb.archiveTournament(id, apiKey)  // Archive from Challonge
analyticsDb.calculateEloChange(winner, loser, k) // Elo calculation
analyticsDb.updateEloRatings(tournamentId) // Update ratings after archive
analyticsDb.getPlayerRankings(gameId)      // Get leaderboard
analyticsDb.getPlayerStats(playerId)       // Get player profile
analyticsDb.getHeadToHead(p1, p2, gameId)  // H2H record
analyticsDb.getEloChangesForTournament(id) // Get Elo changes for PDF export
analyticsDb.getNewVsReturningPlayers(id)   // Get new vs returning stats for PDF
analyticsDb.getNarrativeCache(tournamentId, format) // Get cached narrative
analyticsDb.saveNarrativeCache(id, format, narrative, hash, metadata) // Cache narrative
analyticsDb.deleteNarrativeCache(tournamentId)  // Clear narrative cache
```

**system-settings.json structure:**
```json
{
  "challonge": {
    "apiKey": "your-api-key",
    "rateLimit": 30,
    "adaptiveRateLimit": {
      "enabled": true,
      "idleRate": 12,
      "upcomingRate": 20,
      "activeRate": 30,
      "checkIntervalHours": 8,
      "upcomingWindowHours": 48
    }
  },
  "systemDefaults": { ... },
  "security": { ... },
  "notifications": { ... },
  "display": { ... },
  "dataRetention": { ... }
}
```

## Authentication

**Session-based auth with HTTP-only cookies:**

```javascript
// Login creates session
req.session.userId = user.id;
req.session.username = user.username;
req.session.role = user.role;

// Middleware checks
requireAuth(req, res, next)     // HTML pages
requireAuthAPI(req, res, next)  // API endpoints
requireAdmin(req, res, next)    // Admin-only
```

**Account Lockout:**
- 5 failed attempts = 1 hour lockout
- Tracked in `auth-data.json`
- Clear with: `echo '{"failedAttempts":{},"lockedAccounts":{}}' > auth-data.json`

## CSS Classes

### Layout
```css
.app-layout              /* Flex container */
.sidebar                 /* Fixed sidebar */
.main-wrapper            /* Content area */
.sidebar-collapsed       /* Collapsed state */
```

### Status
```css
.status-indicator        /* Online/offline dot */
.status-indicator.online /* Green pulsing */
.status-indicator.offline /* Red pulsing */
.status-card-compact     /* Module status card */
```

### Alerts
```css
.alert                   /* Base alert */
.alert-success/error/warning/info
.toast                   /* In-section notification */
.toast-success/error/info
```

### Flyers
```css
.flyer-card              /* Gallery card */
.flyer-image-container   /* Image wrapper */
.flyer-image-preview     /* Thumbnail image */
.flyer-loading           /* Spinner overlay */
```

### Mobile Responsive
```css
/* Breakpoints */
@media (max-width: 640px)   /* Mobile phones */
@media (max-width: 768px)   /* Tablets portrait */
@media (max-width: 1023px)  /* Tablets landscape / small desktop */
@media (pointer: coarse)    /* Touch devices */

/* Utility Classes */
.hide-on-mobile          /* Hidden on screens < 768px */
.touch-target            /* Min 44px touch target */
.match-filters           /* Horizontal scroll container */
.scroll-hint             /* Fade gradient for scroll areas */

/* Score Modal Touch Optimization */
#scoreModal button[onclick^="adjustScore"]  /* 56x56px buttons */
#scoreModal input[type="number"]            /* 80x64px inputs */

/* Full-Screen Mobile Modals */
#scoreModal > div,
#addParticipantModal > div,
#editParticipantModal > div,
#bulkAddModal > div      /* Full screen on mobile */
```

**Mobile-Specific Features:**
- Hamburger menu with overlay sidebar (transforms off-canvas)
- Score modal: Full-screen, stacked layout, 56px adjustment buttons
- Match cards: Stacked layout, full-width station dropdown
- Participant table: Hidden Contact/Misc columns, compact action buttons
- Filter buttons: Horizontal scroll with hidden scrollbar
- Modals: Full-screen with sticky header/footer
- Swipe gestures: Left/right to cycle match filters

**Swipe Gesture Implementation (matches.js):**
```javascript
// Swipe left/right on match list to cycle filters
filterOrder = ['all', 'open', 'underway', 'complete'];
SWIPE_THRESHOLD = 50;      // Minimum horizontal distance
SWIPE_VERTICAL_LIMIT = 100; // Max vertical (prevents scroll interference)
```

## Environment Variables

```env
PORT=3000
SESSION_SECRET=change-in-production
DEFAULT_CHALLONGE_KEY=your_api_key

MATCH_API_URL=http://localhost:2052
BRACKET_API_URL=http://localhost:2053
FLYER_API_URL=http://localhost:2054

FLYERS_PATH=/root/tournament-control-center/MagicMirror-bracket/flyers
MATCH_STATE_FILE=/root/.../tournament-state.json
BRACKET_STATE_FILE=/root/.../tournament-state.json
FLYER_STATE_FILE=/root/.../flyer-state.json
```

## File Structure

```
admin-dashboard/
├── server.js              # Express server orchestrator (~3,500 lines)
├── analytics-db.js        # SQLite database module (~1150 lines)
├── cache-db.js            # API response caching module (~520 lines)
├── csrf.js                # CSRF protection module
├── system-monitor.js      # System monitoring module
├── analytics.db           # SQLite database file (includes cache tables)
├── package.json
├── .env                   # Configuration
├── users.json             # User accounts
├── auth-data.json         # Login tracking
├── system-settings.json   # System config
├── activity-log.json      # Audit trail (auto-rotates at 1000 entries)
├── sponsor-state.json     # Sponsor configuration and state
├── monitoring-reports/    # Saved monitoring reports (JSON)
├── sponsors/              # Sponsor logo images
├── uploads/               # Temp upload dir
├── constants/             # Application constants
│   └── index.js           # RATE_MODES, ACTIVITY_TYPES, PDF_COLORS
├── services/              # Business logic services (extracted from server.js)
│   ├── index.js           # Central export for all services
│   ├── container.js       # AppContext singleton for shared state
│   ├── websocket-ack.js   # Enhanced WebSocket delivery with retry
│   ├── settings.js        # Settings file operations (~380 lines)
│   ├── rate-limiter.js    # Adaptive Challonge rate limiting (~500 lines)
│   ├── activity-logger.js # Activity logging with WebSocket broadcasting (~120 lines)
│   ├── challonge-api.js   # Challonge API v2.1 communication (~300 lines)
│   ├── dq-timer.js        # Server-side DQ timer management (~280 lines)
│   ├── match-polling.js   # Centralized match polling (~550 lines)
│   ├── sponsor.js         # Sponsor overlay management (~250 lines)
│   ├── ai-seeding.js      # AI-powered seeding with Anthropic Claude (~740 lines)
│   └── tournament-narrator.js  # AI-powered tournament recap narratives (~550 lines)
├── routes/                # Express Router modules (extracted from server.js)
│   ├── index.js           # Central export for all routes
│   ├── auth.js            # Login, logout, OAuth (~400 lines)
│   ├── users.js           # User CRUD (~170 lines)
│   ├── settings.js        # System settings (~250 lines)
│   ├── games.js           # Game configurations (~210 lines)
│   ├── monitoring.js      # System monitoring (~200 lines)
│   ├── templates.js       # Tournament templates (~180 lines)
│   ├── stations.js        # Station management (~250 lines)
│   ├── participants.js    # Participant CRUD, bulk add, seeding (~700 lines)
│   ├── matches.js         # Match operations, scoring, stations (~1,200 lines)
│   ├── tournaments.js     # Tournament CRUD, lifecycle (~800 lines)
│   ├── displays.js        # Pi display management (~650 lines)
│   ├── flyers.js          # Flyer uploads and management (~290 lines)
│   ├── sponsors.js        # Sponsor overlays (~300 lines)
│   ├── analytics.js       # Analytics and seeding suggestions (~600 lines)
│   ├── exports.js         # CSV/PDF exports (~600 lines)
│   └── api.js             # Misc APIs: status, cache, timer, QR, etc. (~1,200 lines)
├── helpers/               # Utility functions (extracted from server.js)
│   ├── index.js           # Central export for all helpers
│   ├── pdf.js             # PDF generation helpers (~140 lines)
│   ├── tournament-url.js  # URL slug generation (~120 lines)
│   └── websocket.js       # Delta detection helpers (~200 lines)
├── middleware/            # Express middleware
│   ├── auth.js            # Authentication middleware (~160 lines)
│   └── validation.js      # Joi validation middleware
├── validation/            # Schema definitions
│   └── schemas.js         # All Joi input validation schemas
├── config/                # Configuration modules
│   └── secrets.js         # Encrypted credential management
└── public/
    ├── index.html         # Dashboard
    ├── tournament.html    # Tournament config
    ├── matches.html       # Match management
    ├── displays.html      # Display management
    ├── flyers.html        # Flyer management
    ├── sponsors.html      # Sponsor management
    ├── participants.html  # Participant management
    ├── analytics.html     # Historical analytics
    ├── settings.html      # Settings
    ├── login.html         # Login
    ├── css/
    │   └── style.css      # Custom styles
    └── js/
        ├── utils.js       # Shared utilities (escapeHtml, showAlert, etc.)
        ├── nav.js         # Shared navigation
        ├── dashboard.js   # Dashboard logic
        ├── tournament.js  # Tournament logic
        ├── matches.js     # Match logic
        ├── displays.js    # Display logic
        ├── flyers.js      # Flyer logic
        ├── sponsors.js    # Sponsor logic
        ├── participants.js # Participant logic
        ├── analytics.js   # Analytics logic (~1200 lines)
        └── settings.js    # Settings logic
```

## Common Tasks

### Adding a New Page

1. Create `public/newpage.html` with sidebar placeholder
2. Include scripts in order: `utils.js`, `nav.js`, then page-specific JS
3. Create `public/js/newpage.js` with `initNavigation('NewPage')`
4. Add nav item in `nav.js` `navItems` array
5. Add API endpoints in `server.js` if needed

**Script include order:**
```html
<script src="js/utils.js?v=1"></script>
<script src="js/nav.js?v=1"></script>
<script src="js/newpage.js?v=1"></script>
```

### Updating Navigation

Edit `navItems` array in `nav.js`:
```javascript
const navItems = [
    { name: 'Dashboard', href: '/', icon: '...' },
    { name: 'NewPage', href: '/newpage.html', icon: '...' },
    // ...
];
```

### Cache Busting

Increment version in HTML:
```html
<script src="js/nav.js?v=2"></script>
<script src="js/newpage.js?v=1"></script>
```

### PWA Service Worker (sw.js)

**Location:** `public/sw.js` - Provides offline support and caching

**Version Management:**
- Cache names include version: `tournament-admin-v2`, `tournament-static-v2`, `tournament-dynamic-v2`
- Registration in `pwa.js` line 16: `/sw.js?v=2`
- Query string bypasses CDN caching issues

**Caching Strategy:**
- **HTML pages:** Network-first with cache fallback (ensures fresh CSP headers)
- **Static assets (JS/CSS):** Stale-while-revalidate
- **External URLs:** Skipped entirely (let browser handle CDN requests)

**Updating the Service Worker:**
1. Make changes to `sw.js`
2. Bump cache version names (v2 → v3)
3. Update `pwa.js` registration: `/sw.js?v=3`
4. Update all HTML files: `sed -i 's/pwa\.js?v=2/pwa.js?v=3/g' public/*.html`
5. Restart service: `sudo systemctl restart control-center-admin`

**Key Design Decisions:**
- External URLs (`url.origin !== self.location.origin`) return early - no fetch/cache
- HTML uses `networkFirstWithCache()` so CSP header changes take effect immediately
- Static assets use `staleWhileRevalidate()` for performance

### Content Security Policy (CSP)

**Location:** `server.js` lines 467-489 (helmet middleware)

**IMPORTANT:** CSP is defined ONLY in Express via helmet. Do NOT add CSP headers in Nginx Proxy Manager - this causes conflicts.

**Current Whitelist:**
```javascript
scriptSrc: [
    "'self'", "'unsafe-inline'",
    "https://cdn.tailwindcss.com",
    "https://cdn.socket.io",
    "https://cdn.jsdelivr.net",           // SortableJS, ApexCharts
    "https://static.cloudflareinsights.com"
],
scriptSrcAttr: ["'unsafe-inline'"],       // Required for onclick handlers
connectSrc: [
    "'self'", "wss:", "ws:",
    "https://cloudflareinsights.com",
    "https://static.cloudflareinsights.com",
    "https://cdn.socket.io",
    "https://cdn.tailwindcss.com"
],
frameSrc: ["https://challonge.com", "https://*.challonge.com"]
```

**Adding New CDN:**
1. Add domain to appropriate CSP directive in `server.js`
2. Restart service
3. If issues persist, check if service worker is serving cached HTML with old CSP

**Debugging CSP:**
```bash
# Check server CSP headers directly
curl -sI "http://localhost:3000/" | grep -i content-security

# Check through CDN
curl -sI "https://admin.despairhardware.com/" | grep -i content-security
```

## Troubleshooting

### Page Not Loading
```bash
# Check service
sudo systemctl status tournament-admin

# Check logs
sudo journalctl -u tournament-admin -n 50
```

### Authentication Issues
```bash
# Clear lockouts
echo '{"failedAttempts":{},"lockedAccounts":{}}' > auth-data.json

# Reset password
node -e "require('bcrypt').hash('newpass', 10).then(console.log)"
# Update users.json
```

### Module Status Offline
```bash
# Test APIs directly
curl http://localhost:2052/api/tournament/status
curl http://localhost:2053/api/tournament/status
curl http://localhost:2054/api/tournament/status
```

### Flyer Thumbnails Not Showing
- Check browser console for errors
- Verify preview endpoint: `curl http://localhost:3000/api/flyers/preview/filename.png`
- Hard refresh (Ctrl+Shift+R) or increment JS version

### Challonge API Rate Limit Errors (429/403)
If you see Cloudflare rate limit errors:
1. Go to Settings > Challonge API
2. Set manual mode override to IDLE for minimal API usage
3. Or lower the rate limit cap to 20-30 requests per minute
4. Save settings (takes effect immediately)
5. Note: Stale tournaments (7+ days underway) are automatically ignored

**Check current rate status:**
```bash
# View adaptive rate state in logs
sudo journalctl -u tournament-admin | grep "Adaptive Rate"

# Check settings file
cat system-settings.json | jq '.challonge'
```

**Force IDLE mode via code (server.js adaptiveRateState ~line 136):**
```javascript
manualOverride: RATE_MODES.IDLE  // Set to null for automatic mode
```

**Key rate limiting functions:**
- `getChallongeRateLimit()` - Returns effective rate (line 253)
- `getMinRequestDelay()` - Calculates delay in ms (line 777)
- `checkTournamentsAndUpdateMode()` - Tournament check with stale filtering (line 312)

## Raspberry Pi Display Hardware

### Current Configuration (Raspberry Pi 5 4GB)

**Hardware:** Raspberry Pi 5 (4GB RAM), 500GB NVMe SSD
- IP Address: 192.168.1.145
- Hostname: pi-display-1
- Display ID: 2ccf676f5c14
- Browser: Chromium (kiosk mode)

**Software Stack:**
- OS: Raspberry Pi OS Lite (Bookworm 64-bit)
- Window Manager: Openbox (minimal)
- Browser: Chromium in kiosk mode
- Display URL: Configured via admin dashboard

**Configuration:**
- GPU memory: 256MB
- zram swap: 50% compressed
- Temperature: 45-50C under load

**Pre-configured WiFi Networks (auto-connect by priority):**
1. Neils Bahr - Guest (priority 30) - Primary venue
2. WeaponizedData_5G (priority 20) - Secondary
3. HTXPokemonCollectors-VZW (priority 10) - Tertiary

### Setup Script (setup-pi.sh)

**Location:** `public/setup-pi.sh`

**Usage:**
```bash
curl -sSL https://admin.despairhardware.com/setup-pi.sh | sudo bash
```

**9-Step Setup Process:**
1. Updates system packages
2. Installs X server, Chromium, NetworkManager, xdotool, dependencies
3. Configures console auto-login
4. Creates kiosk configuration files
5. Creates kiosk.sh and display-manager.sh scripts
6. Creates kiosk-manager.service (systemd)
7. Applies Pi 5 optimizations (zram, GPU memory, disable unused services)
8. Sets hostname (uses existing or auto-generates from MAC)
9. Adds WiFi networks (3 networks with priority-based auto-connect)

**Features:**
- Chromium browser with hardware acceleration and kiosk mode
- Display manager service with 30-second heartbeats
- Config polling every 10 seconds for fast view switching
- View transitions without reboot (browser-only restart)
- Current view derived from URL (match/bracket/flyer)
- System metrics reporting (CPU temp, memory, WiFi quality/signal)
- Multiple WiFi networks pre-configured (3 networks with priorities)
- **Hang detection watchdog:** Checks Chromium responsiveness every 30s; force-kills after 90s unresponsive
- **Intent restart validation:** URL changes write epoch timestamp; validated within 10s grace window
- **Storage-aware performance:** Detects NVMe vs SD card and adjusts settings accordingly

**Storage Detection (Performance Tuning):**
| Storage | CPU Governor | Raster Threads | GPU Compositing | Cache Size |
|---------|--------------|----------------|-----------------|------------|
| NVMe | performance | 4 | enabled | 500MB |
| SD Card | ondemand | 1 | disabled | 100MB |

**Files Created on Pi:**
| File | Purpose |
|------|---------|
| `~/kiosk.sh` | Chromium kiosk launcher with watchdog |
| `~/display-manager.sh` | Heartbeat and config manager |
| `~/.config/kiosk/config.json` | Current URL configuration |
| `~/.config/kiosk/state.json` | Display ID and registration state |
| `~/.config/kiosk/intent_restart` | URL change intent file (epoch timestamp) |
| `~/.config/kiosk/manager.log` | Manager logs |

### Admin Dashboard Display Registration

Displays register via `/api/displays/register` and send heartbeats to `/api/displays/:id/heartbeat`.

**Display entry in displays.json:**
```json
{
  "id": "2ccf676f5c14",
  "hostname": "pi-display-1",
  "ip": "192.168.1.145",
  "currentView": "match",
  "assignedView": "match",
  "status": "online",
  "lastHeartbeat": "2025-12-09T..."
}
```

**View Switching:**
- Admin changes `assignedView` via dashboard
- Pi polls config every 10 seconds
- When `shouldRestart: true`, Pi kills Chromium
- X session restarts Chromium with new URL
- Heartbeat reports updated `currentView`
- Total switch time: ~10-15 seconds

## System Monitor Module (system-monitor.js)

The system monitoring module provides comprehensive diagnostics and data collection for debugging and optimization.

**Exports:**
```javascript
const systemMonitor = require('./system-monitor');

systemMonitor.startMonitoring(durationMinutes)  // Start collection session
systemMonitor.stopMonitoring()                   // Stop session
systemMonitor.getMonitoringStatus()              // Get session status
systemMonitor.generateCurrentReport()            // Generate report from session
systemMonitor.runQuickCheck()                    // One-time instant check
systemMonitor.getServiceLogs(service, lines)     // Get service logs
```

**Configuration (system-monitor.js):**
```javascript
const CONFIG = {
    services: [
        { name: 'tournament-admin', port: 3000, description: 'Admin Dashboard' },
        { name: 'tournament-signup', port: 3001, description: 'Tournament Signup' },
        { name: 'magic-mirror-match', port: 2052, description: 'Match Display API' },
        { name: 'magic-mirror-bracket', port: 2053, description: 'Bracket Display API' },
        { name: 'magic-mirror-flyer', port: 2054, description: 'Flyer Display API' }
    ],
    apiEndpoints: [
        { name: 'Match Module Status', url: 'http://localhost:2052/api/tournament/status' },
        { name: 'Bracket Module Status', url: 'http://localhost:2053/api/bracket/status' },
        { name: 'Flyer Module Status', url: 'http://localhost:2054/api/flyer/status' }
    ],
    networkTargets: [
        { name: 'Google DNS', host: '8.8.8.8' },
        { name: 'Cloudflare DNS', host: '1.1.1.1' },
        { name: 'Challonge', host: 'api.challonge.com' }
    ],
    sampleIntervalMs: 30000,  // 30 seconds between samples
    reportsDir: './monitoring-reports'
};
```

**Data Collection:**
- **Services:** systemctl status for each service (running/stopped/failed, uptime)
- **APIs:** HTTP response time and status for module endpoints
- **Network:** ping latency to DNS and external hosts
- **System:** Memory, CPU load, disk usage via shell commands
- **Pi Displays:** Read from displays.json for heartbeat data

**Report Format:**
Reports are structured for Claude analysis with:
- Session metadata (start/end times, duration, sample count)
- Service availability percentages and uptimes
- API response time statistics (min/max/avg/percentiles)
- Network latency statistics
- System resource trends over time
- Pi display health summaries
- Detected issues with severity levels
- AI-friendly recommendations section

## UI/UX Guidelines

- Clean, modern, minimalistic design
- No emojis on any admin pages
- Professional appearance
- Status indicators with color coding
- Toast notifications for immediate feedback
- Confirmation modals for destructive actions

## Command Center

Single-page tournament control dashboard for solo operators. Consolidates critical tournament info into a 4-quadrant layout with real-time WebSocket updates.

### Layout

```
+---------------------------+---------------------------+
|   Q1: CURRENT MATCHES     |   Q2: MATCH QUEUE         |
|   - Underway matches      |   - Next 10 open matches  |
|   - Station assignment    |   - One-click start       |
|   - Elapsed time          |   - Keyboard hints 1-5    |
|   - Quick score buttons   |                           |
+---------------------------+---------------------------+
|   Q3: SYSTEM STATUS       |   Q4: QUICK ACTIONS       |
|   - 3 display modules     |   - Ticker presets        |
|   - API health/rate limit |   - DQ timer button       |
|   - Tournament progress   |   - QR code show/hide     |
|                           |   - Refresh button        |
+---------------------------+---------------------------+
```

### Keyboard Shortcuts

| Key | Action | Condition |
|-----|--------|-----------|
| 1-5 | Select match by index | No modal open |
| W | Player 1 wins (2-0) | Match selected |
| L | Player 2 wins (0-2) | Match selected |
| S | Start selected match | Open match selected |
| Enter | Open score modal | Match selected |
| Escape | Close modal / Deselect | Any time |
| R | Refresh all data | No modal open |
| T | Open ticker modal | No modal open |
| ? | Toggle keyboard help | Any time |

### Features

- **Real-time updates:** WebSocket connection with auto-reconnect (polling fallback)
- **Match selection:** Click or keyboard (1-5) to select, visual highlight
- **Quick scoring:** W/L keys for 2-0 wins, Enter for custom scores
- **Score modal:** Quick winner buttons (2-0), custom score entry, DQ options
- **Ticker modal:** Preset messages + custom input
- **System status:** Display modules, API rate limit mode, tournament progress bar
- **Mobile responsive:** Single column on tablets/phones, touch-optimized
- **NEXT UP indicator:** Floating card pulses when match completes, shows next match players, one-click start
- **Auto-advance toggle:** Enable/disable automatic next match highlighting
- **Enhanced DQ timer:** Match and player selection in modal, server-side tracking, auto-DQ capability
- **Active timers panel:** Shows all running DQ timers with countdown and cancel buttons

### Match Queue Auto-Advance

When a match is completed, the system automatically identifies and highlights the next suggested match:

1. WebSocket payload includes `metadata.nextMatchId` and `metadata.nextMatchPlayers`
2. When `completedCount` increases, `handleMatchCompletion()` triggers
3. NEXT UP floating indicator appears with pulse animation
4. Auto-scroll scrolls the match queue to the highlighted match
5. One-click "Start Next" button marks match as underway

**Settings (system-settings.json):**
```json
{
  "matchQueue": {
    "autoAdvanceEnabled": true,
    "showNextUpIndicator": true,
    "autoScrollToNext": true
  }
}
```

### Enhanced DQ Timer

The DQ timer now supports server-side tracking with match/player association:

1. Open DQ modal from Quick Actions
2. Select match from dropdown (shows underway matches)
3. Select player to DQ from dropdown
4. Start timer - server tracks state
5. When timer expires:
   - Auto-DQ mode: Automatically DQ the selected player
   - Notify mode: Send notification to operator
6. Active timers panel shows all running timers with cancel buttons

**WebSocket Events:**
- `timer:dq:started` - Timer started with match/player info
- `timer:dq:warning` - 30 seconds remaining
- `timer:dq:expired` - Timer expired, action taken
- `timer:dq:cancelled` - Timer cancelled
