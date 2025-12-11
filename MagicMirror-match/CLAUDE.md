# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **MagicMirror² instance** specifically configured for tournament match display. It's part of a comprehensive five-service tournament management system that includes an admin dashboard, a signup web app, and two other MagicMirror display instances (bracket and flyer).

**This instance's role:** Displays live tournament match information from Challonge API, including player names, match states, and station assignments (TV 1 and/or TV 2).

**System context:** This is one of three MagicMirror instances in the tournament ecosystem. See `/root/tournament-control-center/CLAUDE.md` for full system architecture.

## Custom Module: MMM-TournamentNowPlaying

**Location:** `modules/MMM-TournamentNowPlaying/`

**Purpose:** Displays current/upcoming match details from Challonge API with dynamic TV station display.

**Key features:**
- **Centralized polling mode** - receives match data pushed from admin dashboard (no direct Challonge API calls)
- Shows "Now Playing" and "Up Next" matches per TV station
- Participant name caching to avoid display name mismatches
- **Dynamic TV display** - automatically shows 1 or 2 TV elements based on Challonge stations
  - If tournament has "TV 1" station only: displays single centered TV
  - If tournament has "TV 1" and "TV 2" stations: displays both side-by-side
  - Falls back to both TVs if no stations configured (backward compatibility)
- **Real-time match state highlighting** with color-coded animations:
  - Yellow pulsing border for "In Progress" matches
  - Green celebration animation for completed matches with winner display
  - 4-second hold on winner display before transitioning
  - Station tracking for both "next-up" and "underway" matches (fixes animation when winner declared without starting match)
- **Ticker message overlay** - displays announcements from admin dashboard
  - Slides up from bottom of screen with red gradient background
  - Large text (6vw) for TV viewing at distance
  - Configurable duration (3-30 seconds)
  - Auto-dismisses with slide-down animation
- **DQ Timers** - per-TV station countdown timers
  - Positioned under TV 1 (left) and TV 2 (right) quadrants
  - "DQ TIMER" label with MM:SS countdown
  - Visual warning states: yellow pulse at 30s, red rapid pulse at 10s
  - Auto-hides when timer reaches 0
- **Tournament Timer** - custom duration countdown
  - Centered below both TV quadrants
  - 1-60 minute duration set from admin dashboard
  - Warning/critical animations as time runs low
  - Auto-hides when complete
- **QR Code Overlay** - fullscreen QR code display
  - Shows signup URL, bracket link, or custom URL
  - Large QR with label and URL text
  - Optional auto-hide duration
  - Scale-in/out animations
- **Audio Announcements** - text-to-speech via Web Speech API
  - Play announcements on Pi display speakers
  - Configurable voice, rate (0.5-2.0), and volume (0-1.0)
  - Quick presets: "Report In", "5 Min Warning", "Finals"
  - Custom message support from admin dashboard
  - Real-time via WebSocket (`audio:announce` event) + HTTP fallback
- **Sponsor Logo Overlays** (shared module: `MM-SponsorOverlay`)
  - 6 positions: top-left, top-right, bottom-left, bottom-right, top-banner, bottom-banner
  - Corner logos: scalable via config, default 50px from edge
  - Banners: full-width, 80px height with gradient background, 25px from edge
  - Fade in/out animations (0.5s) with configurable transition delay
  - Controlled via WebSocket from admin dashboard + HTTP API on port 2055
  - z-index 9500 (below QR at 10000, above timers at 9000)
  - Config-driven positioning via `cornerOffset`, `bannerOffset` options
  - Module symlinked from `/root/tournament-control-center/MM-SponsorOverlay/`
  - Runs independently from bracket view (both can display sponsors simultaneously)
- **Automatic podium mode** when tournament complete (shows 1st, 2nd, 3rd place)
- Remote API control on port **2052**
- State persistence via `tournament-state.json` (shared with admin dashboard and signup app)

**Configuration (in `config/config.js`):**
```javascript
{
  module: "MMM-TournamentNowPlaying",
  position: "fullscreen_above",
  config: {
    apiKey: "...",          // Challonge API key
    tournamentId: "...",     // Tournament identifier
    pollInterval: 30000      // 30 seconds
  }
}
```

**API endpoints:**
- `POST http://<ip>:2052/api/tournament/update` - Update tournament config
- `GET http://<ip>:2052/api/tournament/status` - Health check (includes `centralizedPolling`, `lastPushTime`)
- `POST http://<ip>:2052/api/ticker/message` - Display ticker message (body: {message, duration})
- `POST http://<ip>:2052/api/matches/push` - Receive match data from admin dashboard (centralized polling)
- `POST http://<ip>:2052/api/polling/control` - Enable/disable internal polling (body: {enabled})
- `POST http://<ip>:2052/api/timer/dq` - Start DQ timer (body: {tv: "TV 1"|"TV 2", duration, action})
- `POST http://<ip>:2052/api/timer/tournament` - Start tournament timer (body: {duration, action})
- `POST http://<ip>:2052/api/timer/hide` - Hide timer (body: {type: "dq"|"tournament"|"all", tv})
- `POST http://<ip>:2052/api/qr/show` - Show QR code overlay (body: {qrCode, url, label, duration?})
- `POST http://<ip>:2052/api/qr/hide` - Hide QR code overlay
- `POST http://<ip>:2052/api/sponsors/show` - Show sponsor overlays (body: {sponsors, config})
- `POST http://<ip>:2052/api/sponsors/hide` - Hide sponsor overlays (body: {position?} or {} for all)
- `POST http://<ip>:2052/api/sponsors/rotate` - Rotate sponsor at position (body: {position, sponsor})
- `GET http://<ip>:2052/api/sponsors/image/:filename` - Proxy sponsor image from admin dashboard
- `POST http://<ip>:2052/api/audio/announce` - Play text-to-speech announcement (body: {text, voice?, rate?, volume?})

**Key files:**
- `MMM-TournamentNowPlaying.js` - Frontend module (includes `showTickerMessage()`, `showQRCode()`, `playAudioAnnouncement()` functions)
- `MMM-TournamentNowPlaying.css` - Styles including ticker overlay (`.tourney-ticker*`), QR overlay (`.tourney-qr*` classes)
- `node_helper.js` - Backend logic, API server, Challonge integration
- `tournament-state.json` - Shared state file (read by admin dashboard and signup app)

**Socket notifications:**
- `TICKER_MESSAGE` - Received from node_helper to display ticker (payload: {message, duration})
- `TIMER_DQ` - Start/update DQ timer (payload: {tv, duration, action})
- `TIMER_TOURNAMENT` - Start/update tournament timer (payload: {duration, action})
- `TIMER_HIDE` - Hide timer (payload: {type, tv})
- `QR_SHOW` - Display QR code overlay (payload: {qrCode, url, label, duration})
- `QR_HIDE` - Hide QR code overlay
- `SPONSOR_SHOW` - Display sponsor overlays (payload: {sponsors, config})
- `SPONSOR_HIDE` - Hide sponsor overlays (payload: {position?})
- `SPONSOR_ROTATE` - Rotate sponsor at position (payload: {position, sponsor})
- `SPONSOR_CONFIG` - Update sponsor configuration (payload: config object)
- `AUDIO_ANNOUNCE` - Play text-to-speech announcement (payload: {text, voice?, rate?, volume?})

## Development Commands

### Running the Application

**Development mode:**
```bash
# Start MagicMirror with default X11 display
npm start

# Start in development mode (enables developer tools)
npm run start:dev

# Start server-only mode (no Electron GUI) - PRODUCTION MODE
npm run server
```

**Production deployment:**
This instance runs as a systemd service in server-only mode (no Electron GUI). See "Production Deployment" section below.

### Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit          # Unit tests only
npm run test:e2e           # End-to-end tests only
npm run test:electron      # Electron tests only

# Run tests with coverage
npm run test:coverage
```

### Linting and Formatting

```bash
# Lint and auto-fix JavaScript
npm run lint:js

# Lint and auto-fix CSS
npm run lint:css

# Format all files with Prettier
npm run lint:prettier

# Lint markdown files
npm run lint:markdown

# Check only (no auto-fix)
npm run test:js            # Check JavaScript
npm run test:css           # Check CSS
npm run test:prettier      # Check formatting
npm run test:markdown      # Check markdown
npm run test:spelling      # Check spelling
```

### Configuration

```bash
# Check config file for errors
npm run config:check
```

## Architecture

### Core Components

- **js/app.js**: Main application bootstrap. Loads config, instantiates modules, starts HTTP server and node_helpers
- **js/electron.js**: Electron wrapper entry point (launches browser window)
- **js/server.js**: Express HTTP server setup with Socket.io for real-time communication
- **js/main.js**: Client-side coordinator that manages module lifecycle and DOM updates
- **js/module.js**: Base Module class that all modules extend from
- **js/node_helper.js**: Base NodeHelper class for server-side module logic
- **js/loader.js**: Dynamic module loader for frontend
- **serveronly/index.js**: Entry point for server-only mode (no Electron)

### Module System

MagicMirror uses a modular architecture where each module consists of:

1. **Frontend module** (`modulename.js`): Extends `Module` class
   - Defines `defaults` object for configuration
   - Implements `getDom()` to return HTML to display
   - Can use `getTemplate()` and `getTemplateData()` with Nunjucks templates
   - Listens to notifications via `notificationReceived(notification, payload, sender)`
   - Communicates with backend via `sendSocketNotification(notification, payload)`

2. **Backend node_helper** (optional `node_helper.js`): Extends `NodeHelper` class
   - Runs in Node.js context on the server
   - Handles data fetching, processing, external APIs
   - Communicates with frontend via `sendSocketNotification(notification, payload)`
   - Receives from frontend via `socketNotificationReceived(notification, payload)`

3. **Templates** (optional `.njk` files): Nunjucks templates for rendering
4. **Styles** (optional `.css` files): Module-specific styling
5. **Translations** (optional): JSON files in language-specific directories

### Module Registration

Modules register themselves using:

```javascript
Module.register("modulename", {
  defaults: { /* default config */ },
  start() { /* initialization */ },
  getDom() { /* return DOM element */ },
  notificationReceived(notification, payload, sender) { /* handle notifications */ },
  socketNotificationReceived(notification, payload) { /* handle socket messages */ }
});
```

### Communication Flow

- **Module-to-Module**: `sendNotification(notification, payload)` → all modules receive via `notificationReceived()`
- **Frontend-to-Backend**: `sendSocketNotification()` → `node_helper.socketNotificationReceived()`
- **Backend-to-Frontend**: `node_helper.sendSocketNotification()` → `Module.socketNotificationReceived()`

### Configuration

- Config files live in `config/` directory
- Main config file: `config/config.js` (copy from `config/config.js.sample`)
- Environment variable substitution: Use `config.js.template` with `${VAR_NAME}` syntax
- Config structure: Array of module objects with `module`, `position`, `config` properties
- Valid positions defined in `js/positions.js`

### Module Positions

Modules can be placed in predefined regions:
- `top_bar`, `top_left`, `top_center`, `top_right`
- `upper_third`, `middle_center`, `lower_third`
- `bottom_left`, `bottom_center`, `bottom_right`, `bottom_bar`
- `fullscreen_above`, `fullscreen_below`

## Code Style

- **Indentation**: Tabs (not spaces)
- **Quotes**: Double quotes for strings
- **Semicolons**: Always required
- **Globals**: `Log`, `MM`, `Module`, `config`, `moment` are globally available
- **Module Aliases**: `logger` and `node_helper` are aliased in package.json `_moduleAliases`

## Testing Structure

Tests are organized in `tests/` directory:
- `tests/unit/`: Unit tests for individual functions/classes
- `tests/e2e/`: End-to-end tests using Playwright
- `tests/electron/`: Electron-specific tests
- `tests/configs/`: Test configuration files
- `tests/mocks/`: Mock modules for testing

Jest configuration is project-based (see `jest.config.js`) with separate test runners for unit, electron, and e2e tests.

## Important Files

- **package.json**: Defines all npm scripts and dependencies
- **eslint.config.mjs**: ESLint configuration (ignores custom modules, only lints core and default modules)
- **js/defaults.js**: Default application configuration values
- **modules/default/**: Built-in default modules (clock, calendar, weather, newsfeed, etc.)
- **translations/**: Core translation files

## Custom Module Development

When creating new modules:
1. Place in `modules/` directory (not `modules/default/`)
2. Custom modules are git-ignored by default
3. Follow the module structure: main `.js` file, optional `node_helper.js`, templates, styles
4. Use `Module.register()` to register the module
5. Use `NodeHelper.create()` for node_helpers
6. Reference example modules in `modules/default/helloworld/` for simple cases
7. Reference `modules/default/calendar/` for complex modules with node_helpers

## Version Requirements

- **Node.js**: >= 22.18.0
- **MagicMirror² version checking**: Modules can specify `requiresVersion` property

## Production Deployment with systemd

This MagicMirror instance runs as a systemd service for automatic startup and crash recovery.

**Service file:** `/etc/systemd/system/magic-mirror-match.service`

**Service management:**
```bash
# Start/stop/restart service
sudo systemctl start magic-mirror-match
sudo systemctl stop magic-mirror-match
sudo systemctl restart magic-mirror-match

# Check status
sudo systemctl status magic-mirror-match

# View logs (follow mode)
sudo journalctl -u magic-mirror-match -f

# View last 50 log lines
sudo journalctl -u magic-mirror-match -n 50

# Enable/disable auto-start on boot
sudo systemctl enable magic-mirror-match
sudo systemctl disable magic-mirror-match

# Reload systemd after editing service file
sudo systemctl daemon-reload
```

**Service configuration:**
- Runs in **server-only mode** (no Electron GUI)
- Runs as **root user**
- **Auto-restarts on failure** with 10-second delay
- **MagicMirror web UI:** port 8080 (internal use)
- **Module API server:** port 2052
- **Logs sent to systemd journal**

## Port Configuration

- **MagicMirror web interface:** 8080 (internal, access via browser)
- **MMM-TournamentNowPlaying API:** 2052 (used by admin dashboard)
- **Important:** This instance uses port 8080, while the bracket instance uses 8081

## Integration with Tournament Ecosystem

This MagicMirror instance integrates with four other services:

| Service | Port | Integration |
|---------|------|-------------|
| **Admin Dashboard** | 3000 | Controls this instance via port 2052 API |
| **Tournament Signup** | 3001 | Reads tournament state from `tournament-state.json` |
| **MagicMirror Bracket** | 8081/2053 | Paired instance for bracket/flyer rotation display |
| **MagicMirror Flyer** | 8082/2054 | Paired instance for dedicated flyer-only display |

**Shared state file:** `/root/tournament-control-center/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json`
- Written by this module when tournament is configured
- Read by admin dashboard for status monitoring
- Read by signup app to determine current tournament

**Workflow:**
1. Admin dashboard sends tournament config to port 2052
2. MMM-TournamentNowPlaying updates its state and writes to `tournament-state.json`
3. Signup app reads state file to get current tournament ID
4. Admin dashboard polls Challonge API and pushes match data to this module

## Centralized Polling Mode

This module operates in **centralized polling mode** by default. Instead of polling Challonge directly, it receives match data pushed from the admin dashboard.

**State flags (node_helper.js):**
```javascript
this.centralizedPolling = true;  // Default: centralized mode
this.lastPushTime = null;        // Timestamp of last data push
```

**Benefits:**
- All Challonge API calls go through a single rate-limited endpoint on admin dashboard
- No direct Challonge dependencies from MagicMirror module
- Rate limit settings and development mode apply consistently
- Simpler architecture - display module just displays data

**Push endpoint:**
```
POST /api/matches/push
Content-Type: application/json

{
  "matches": [...],              // Match array from Challonge
  "podium": {                    // Optional podium data
    "isComplete": false,
    "firstPlace": null,
    "secondPlace": null,
    "thirdPlace": null
  },
  "availableStations": ["TV 1", "TV 2"],
  "participantsCache": {         // Optional participant name cache
    "123": "Player Name"
  }
}
```

**Status endpoint includes centralized polling info:**
```
GET /api/tournament/status

{
  "status": "configured",
  "tournamentId": "...",
  "centralizedPolling": true,
  "internalPollingActive": false,
  "lastPushTime": "2025-11-27T05:30:00.000Z"
}
```

**Fallback to internal polling:**
If needed, internal polling can be re-enabled via:
```
POST /api/polling/control
{ "enabled": true }
```

## WebSocket Real-Time Updates

This module connects to the admin dashboard via WebSocket (Socket.IO) for instant match updates with sub-second latency.

**Connection Configuration (node_helper.js):**
```javascript
this.wsSocket = null;
this.wsConnected = false;
this.wsReconnectAttempts = 0;
this.wsMaxReconnectAttempts = 10;
this.wsReconnectDelay = 5000;
this.wsAdminUrl = process.env.ADMIN_WS_URL || 'http://localhost:3000';
```

**Events Received:**
| Event | Description |
|-------|-------------|
| `matches:update` | Real-time match data from admin dashboard |
| `ticker:message` | Ticker announcements to display |
| `tournament:update` | Tournament configuration changes |

**Auto-Reconnect:**
- Automatic reconnection with exponential backoff
- Max 10 reconnection attempts
- Base delay: 5 seconds, max delay: 30 seconds
- Falls back to HTTP push if WebSocket unavailable

**Connection Lifecycle:**
1. Module starts → connects to admin dashboard WebSocket
2. On connect → registers as display type "match"
3. Receives real-time `matches:update` events
4. On disconnect → auto-reconnect with backoff
5. HTTP `/api/matches/push` still works as fallback

**Status endpoint includes WebSocket info:**
```
GET /api/tournament/status

{
  "status": "configured",
  "tournamentId": "...",
  "centralizedPolling": true,
  "websocket": {
    "connected": true,
    "socketId": "abc123..."
  }
}
```

**Benefits over HTTP polling:**
- Sub-second update latency (vs 15-second poll interval)
- Reduced server load (no repeated HTTP requests)
- Instant ticker messages
- Bidirectional communication capability

## Display Scaling for Large TVs

When displaying on large TVs (40"+), elements may appear too small. Use Chromium's device scale factor.

**Recommended scale factors:**
| TV Size | Viewing Distance | Scale Factor |
|---------|------------------|--------------|
| 32" | 6-8 ft | 1.5 |
| 43" | 10+ ft | 2.0-2.5 |
| 55"+ | 15+ ft | 2.5-3.0 |

**To configure on the Pi:**
```bash
ssh pi-display-1
nano ~/kiosk.sh
```

Find and edit the `DISPLAY_SCALE_FACTOR` variable:
```bash
DISPLAY_SCALE_FACTOR=2.3
```

Then restart:
```bash
sudo systemctl restart kiosk-manager
```

## Testing

This module is tested through the system-wide testing infrastructure:

**API Testing:**
- Smoke tests via `scripts/smoke-test.sh` verify the module API is responding
- CI/CD pipeline includes module health checks during deployment

**Manual Testing:**
```bash
# Test module API
curl -sf http://localhost:2052/api/tournament/status && echo "OK"

# Test with admin dashboard
# 1. Set up tournament and matches via admin dashboard
# 2. Verify match data appears on display
# 3. Test ticker messages, timers, and QR codes
```

**Related Testing:**
- Admin dashboard E2E tests cover match management workflows
- See `/root/tournament-control-center/admin-dashboard/__tests__/` for test suite
- See `/root/tournament-control-center/CLAUDE.md` for full testing documentation

## Cache-Busting for CDN Compatibility

When accessing MagicMirror through a CDN like Cloudflare, static files (JS/CSS) can be cached at the edge, preventing updates from reaching the browser. This module implements automatic cache-busting to ensure fresh content delivery.

**How it works:**

1. **Server-side cache headers** (`js/server.js`): All responses include no-cache headers
   ```javascript
   res.header("Cache-Control", "no-cache, no-store, must-revalidate");
   res.header("Pragma", "no-cache");
   res.header("Cloudflare-CDN-Cache-Control", "no-store");
   ```

2. **Static file headers** (`js/server.js`): Express static middleware configured to prevent caching
   ```javascript
   const staticOptions = {
       etag: false,
       lastModified: false,
       setHeaders: (res) => {
           res.set("Cache-Control", "no-cache, no-store, must-revalidate");
       }
   };
   ```

3. **Cache-busting timestamps** (`js/server_functions.js`): All JS/CSS URLs include `?v=timestamp`
   - Timestamp is set once at server start (`serverStartTime = Date.now()`)
   - Injected into HTML: `<script src="file.js?v=1733000000000">`
   - Exposed to frontend as `window.mmCacheBuster`

4. **Dynamic module loading** (`js/loader.js`): Uses `window.mmCacheBuster` for module files
   ```javascript
   script.src = fileName + "?v=" + cacheBuster;
   stylesheet.href = fileName + "?v=" + cacheBuster;
   ```

**Key files modified:**
- `js/server.js` - Static file middleware with no-cache headers
- `js/server_functions.js` - HTML injection of cache-busting timestamps
- `js/loader.js` - Dynamic file loading with cache-busting

**When cache issues occur:**
1. Restart the MagicMirror service (generates new timestamp)
2. Clear browser cache on the Pi display
3. If using Cloudflare, purge cache or wait for TTL expiry

**Symptoms of cache problems:**
- Ticker messages sent but not displayed
- Timers not appearing
- New features not working after deployment
- Browser console shows old JavaScript without expected handlers

## Notes

- The application can run in two modes: full Electron app or server-only (headless)
- Socket.io namespaces are used per-module for isolated communication
- Fetch timeout for node_helpers is configurable via `mmFetchTimeout` env var (default: 30000ms)
- The project uses module-alias for cleaner imports (see `_moduleAliases` in package.json)
- Hot-reload is not available; restart the application to see changes
