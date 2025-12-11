# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **MagicMirror² instance** specifically configured for tournament bracket display. It's part of a comprehensive five-service tournament management system that includes an admin dashboard, a signup web app, and two other MagicMirror display instances (match and flyer).

**This instance's role:** Displays tournament brackets via Challonge iframe embed. This is a dedicated bracket-only display (no flyer rotation). Features Winston logging with 7-day retention.

**System context:** This is one of three MagicMirror instances in the tournament ecosystem. See `/root/tournament-control-center/CLAUDE.md` for full system architecture.

## Core Architecture

MagicMirror uses a **three-tier client-server architecture**:

1. **Electron Layer** (`js/electron.js`) - Desktop window management
2. **Node.js Server Layer** (`js/app.js`, `js/server.js`) - Express HTTP server + Socket.IO
3. **Browser Client Layer** (`js/main.js`, `js/loader.js`) - Frontend rendering

**Communication Flow:**
```
Electron App → Node.js Server (Express + Socket.IO) ↔ Browser Client → DOM
```

### Module System

Each module can have two components:

**Client-side** (`modulename.js`):
- Extends the `Module` base class (`js/module.js`)
- Handles UI rendering via `getDom()` method
- Receives notifications via `notificationReceived()`
- Registered using `Module.register("modulename", { ... })`

**Server-side** (`node_helper.js`) - Optional:
- Extends the `NodeHelper` base class (`js/node_helper.js`)
- Handles backend logic (API calls, data fetching)
- Communicates with client via Socket.IO
- Uses `module.exports = NodeHelper.create({ ... })`

### Inter-Module Communication

Modules communicate through a notification system:
```javascript
// Module A sends
this.sendNotification("EVENT_NAME", payload);

// Module B receives
notificationReceived: function(notification, payload, sender) {
    if (notification === "EVENT_NAME") { ... }
}
```

For client-server communication:
```javascript
// Client → Server
this.sendSocketNotification("EVENT", data);

// Server → Client (in node_helper.js)
this.sendSocketNotification("EVENT", data);
```

## Development Commands

### Running the Application

```bash
npm start                # Start with Electron (X11 display server)
npm run start:dev        # Start with DevTools enabled
npm run server           # Server-only mode (no Electron, access via browser)
npm run start:wayland    # For Wayland display servers
```

### Production Deployment with systemd

This MagicMirror instance runs as a systemd service for automatic startup and crash recovery.

**Service file:** `/etc/systemd/system/magic-mirror-bracket.service`

**Managing the service:**
```bash
# Start/stop/restart service
sudo systemctl start magic-mirror-bracket
sudo systemctl stop magic-mirror-bracket
sudo systemctl restart magic-mirror-bracket

# Check service status
sudo systemctl status magic-mirror-bracket

# View logs (follow mode)
sudo journalctl -u magic-mirror-bracket -f

# View last 50 log lines
sudo journalctl -u magic-mirror-bracket -n 50

# Enable/disable auto-start on boot
sudo systemctl enable magic-mirror-bracket
sudo systemctl disable magic-mirror-bracket

# Reload systemd after editing service file
sudo systemctl daemon-reload
```

**Service configuration:**
- Runs in **server-only mode** (no Electron GUI)
- Runs as **root user**
- **Auto-restarts on failure** with 10-second delay
- **MagicMirror web UI:** port 8081 (internal use)
- **Module API server:** port 2053
- **Logs sent to systemd journal** AND **Winston log files** (logs/ directory)

**Important notes:**
- The service runs in server-only mode (no Electron GUI)
- Logs are sent to both systemd journal AND Winston log files
- Service automatically restarts on failure with 10-second delay
- Running as root user (as specified in service file)

### Code Quality & Linting

```bash
npm run lint:js          # ESLint - JavaScript linting
npm run lint:css         # Stylelint - CSS linting
npm run lint:markdown    # Markdown linting
npm run lint:prettier    # Prettier formatting
```

Linting is enforced via Husky pre-commit hooks with `lint-staged`.

### Testing

```bash
npm test                 # Run all tests (unit, electron, e2e)
npm run test:unit        # Unit tests only (jsdom-based)
npm run test:electron    # Electron integration tests
npm run test:e2e         # End-to-end tests (Playwright)
npm run test:coverage    # Generate coverage report
```

**Running a single test file:**
```bash
NODE_ENV=test npx jest tests/unit/path/to/test.spec.js
```

**Running a specific test:**
```bash
NODE_ENV=test npx jest -t "test name pattern"
```

### Configuration

```bash
npm run config:check     # Validate config.js syntax and structure
```

## Configuration System

**Configuration hierarchy:**
1. `js/defaults.js` - Base defaults
2. `config/config.js` - User configuration (main config file)
3. Module-specific configs (merged with module defaults)

The config uses environment variable substitution via `envsub`. You can use `.env` files and `config.js.template` for variable substitution.

**Key config fields:**
- `address`: Server listening address (use `"0.0.0.0"` for network access)
- `port`: Main MagicMirror port (default: 8080, this instance uses 8081)
- `ipWhitelist`: Array of allowed IPs (use `[]` to allow all)
- `modules`: Array of module configurations with `module`, `position`, and `config`

## Module Positioning

Modules are positioned in **11 predefined screen regions** defined in `index.html`:
- `fullscreen_below`
- `top_bar`, `top_left`, `top_center`, `top_right`
- `upper_third`
- `middle_center`
- `lower_third`
- `bottom_bar`, `bottom_left`, `bottom_center`, `bottom_right`
- `fullscreen_above`

Layout uses CSS Flexbox with module ordering controlled by the `order` property.

## Custom Module: MMM-BracketView

This installation includes a tournament bracket display module located at `modules/MMM-BracketView/`.

**Key features:**
- Dedicated bracket-only display (no flyer rotation)
- Embeds Challonge brackets via iframe
- Remote API control on port **2053** (not 8081 - see config)
- State persistence via `bracket-state.json`
- Shows "No bracket configured" placeholder when no bracket URL is set
- **Bracket Controls via Challonge postMessage API:**
  - Zoom control (0.1x - 5.0x scale) - **WORKS**
  - ~~Scroll/focus to specific match by identifier~~ - **NOT SUPPORTED by Challonge iframe**
  - ~~Round filtering~~ - **NOT SUPPORTED by Challonge iframe**
  - ~~Theme switching~~ - **NOT SUPPORTED by Challonge iframe**
- **Sponsor Logo Overlays** (shared module: `MM-SponsorOverlay`)
  - 6 positions: top-left, top-right, bottom-left, bottom-right, top-banner, bottom-banner
  - Corner logos: scalable via config (20px top corners, 100px bottom corners in bracket view)
  - Banners: full-width, 80px height with gradient background, 25px from edge
  - Fade in/out animations (0.5s) with configurable transition delay
  - Controlled via WebSocket from admin dashboard + HTTP API on port 2056
  - z-index 9500 (below wrapper at 9999)
  - Config-driven positioning via `cornerOffset`, `bannerOffset`, `bottomCornerOffset` options
  - Module symlinked from `/root/tournament-control-center/MM-SponsorOverlay/`
  - Runs independently from match view (both can display sponsors simultaneously)

**Challonge Iframe Limitations:**

Challonge uses Cloudflare protection which can cause iframe embed issues:

| Issue | Cause | Solution |
|-------|-------|----------|
| White screen with fail icon | Cloudflare challenge blocking iframe | Clear Pi browser cache |
| `X-Frame-Options: SAMEORIGIN` error | Cloudflare strict mode | Wait for rate limit flags to clear (24-48h) |
| 429 rate limit errors | Too many requests | Reduce API polling frequency |
| Constant page flashing | Reload loop from failed loads | Kiosk reload protection handles this automatically |
| Focus/scroll to match doesn't work | Challonge iframe ignores postMessage for scroll commands | Only zoom (setZoomScale) is supported; UI controls removed |

**HTTPS Embed Note:** According to Challonge docs, HTTPS iframe embeds are "only supported for user-hosted tournaments, not organizations." If using an organization account, embeds may be blocked.

**Fallback Option:** If iframe embedding consistently fails, the Pi can be configured to load Challonge directly (bypassing MagicMirror) by setting the kiosk URL to `https://challonge.com/<tournament>/fullscreen`. This loses zoom/focus control but avoids iframe restrictions.

**API endpoints:**
```
GET  http://<ip>:2053/api/bracket/status   - Health check (returns bracket URL, zoom scale)
POST http://<ip>:2053/api/bracket/update   - Update bracket URL
POST http://<ip>:2053/api/bracket/control  - Generic control (body: {action, parameters})
POST http://<ip>:2053/api/bracket/zoom     - Set zoom level (body: {zoomScale: 0.1-5.0})
POST http://<ip>:2053/api/bracket/focus    - Focus on match (body: {matchIdentifier, zoomScale?})
POST http://<ip>:2053/api/bracket/reset    - Reset view to default zoom (1.0)
POST http://<ip>:2053/api/sponsors/show    - Show sponsor overlays (body: {sponsors, config})
POST http://<ip>:2053/api/sponsors/hide    - Hide sponsor overlays (body: {position?} or {} for all)
POST http://<ip>:2053/api/sponsors/rotate  - Rotate sponsor at position (body: {position, sponsor})
GET  http://<ip>:2053/api/sponsors/image/:filename - Proxy sponsor image from admin dashboard
```

**Bracket Control Actions (for /api/bracket/control):**
| Action | Parameters | Description |
|--------|------------|-------------|
| `setZoomScale` | `{zoomScale, animationDuration?}` | Set zoom level (0.1-5.0) |
| `scrollToMatchIdentifier` | `{matchIdentifier, animationDuration?}` | Scroll to match (e.g., "A", "B") |
| `zoomToMatchIdentifier` | `{matchIdentifier, zoomScale?, animationDuration?}` | Zoom and center on match |
| `filterRounds` | `{rounds: number[]}` | Filter visible rounds |
| `loadTheme` | `{themeName}` | Change bracket theme |

**State file format (`bracket-state.json`):**
```json
{
  "bracketUrl": "https://challonge.com/tournament_id/module",
  "zoomScale": 2,
  "lastUpdated": "2025-11-24T..."
}
```

**Client-side Methods (MMM-BracketView.js):**
```javascript
sendBracketCommand(action, parameters)  // Send postMessage to Challonge iframe
setZoomScale(zoomScale, animationDuration)
scrollToMatch(matchIdentifier, animationDuration)
zoomToMatch(matchIdentifier, zoomScale, animationDuration)
filterRounds(rounds)
loadTheme(themeName)
```

## Important Patterns

### Class Inheritance
Uses John Resig's Simple JavaScript Inheritance pattern (`js/class.js`):
```javascript
const MyClass = Class.extend({
    init: function() {
        this._super(); // Call parent constructor
    }
});
```

### Module Aliases
The project uses `module-alias` for import shortcuts:
```javascript
// In package.json _moduleAliases
"node_helper": "js/node_helper.js"
"logger": "js/logger.js"

// Usage in code
const NodeHelper = require("node_helper");
const Log = require("logger");
```

### Template Rendering
Modules can use Nunjucks templates:
```javascript
getTemplate: function() {
    return "template.njk";
},
getTemplateData: function() {
    return { data: this.data };
}
```

## Security Considerations

- Uses Helmet.js for HTTP security headers
- IP whitelist filtering available (currently disabled: `ipWhitelist: []`)
- HTTPS support with custom certificates
- Content Security Policy configurable
- **This installation is configured for full network access** - be aware in production

## Deployment Modes

**1. Full Mode (Default):** Electron + Server + Client in one process
```bash
npm start
```

**2. Server-Only Mode:** Just Node.js server, access via browser
```bash
npm run server
```

**3. Client-Only Mode:** Electron connects to remote server
```bash
node clientonly --address <ip> --port <port>
```

## Important Files

- `js/main.js` - Main MM object, client-side controller
- `js/loader.js` - Dynamic module loading system
- `js/module.js` - Base Module class that all modules extend
- `js/node_helper.js` - Base NodeHelper class for server-side helpers
- `js/server.js` - Express server setup
- `js/defaults.js` - Default configuration values
- `config/config.js` - Active configuration (modify this)
- `index.html` - Main HTML template with region definitions

## Testing Structure

Tests are organized in three Jest projects:

1. **Unit Tests** (`tests/unit/`) - Individual function/module testing with jsdom
2. **Electron Tests** (`tests/electron/`) - Electron-specific integration tests
3. **E2E Tests** (`tests/e2e/`) - Full application tests with Playwright

Test configuration in `jest.config.js` with custom test sequencer at `tests/utils/test_sequencer.js`.

## Internationalization

- Translation files in `translations/` directory (45+ languages)
- Module-specific translations supported
- Use `translator.js` for runtime translation
- Nunjucks filter for in-template translation: `{{ "KEY" | translate }}`

## Common Debugging

**Start with DevTools:**
```bash
npm run start:dev
```

**Check logs:** Logs printed to console with `console-stamp` formatting

**Module not loading:** Check:
1. Module is in `config/config.js` modules array
2. Module files exist in `modules/<modulename>/`
3. Console for JavaScript errors
4. Module naming matches directory and registration name

**Network issues:**
- Verify `address: "0.0.0.0"` for remote access
- Check firewall settings
- Confirm `ipWhitelist: []` to allow all connections

## Port Configuration

- **MagicMirror web interface:** 8081 (internal, access via browser)
- **MMM-BracketView API:** 2053 (used by admin dashboard)
- **Important:** This instance uses port 8081, while the match instance uses 8080

## Integration with Tournament Ecosystem

This MagicMirror instance integrates with four other services:

| Service | Port | Integration |
|---------|------|-------------|
| **Admin Dashboard** | 3000 | Controls this instance via port 2053 API |
| **Tournament Signup** | 3001 | Independent service |
| **MagicMirror Match** | 8080/2052 | Paired instance for live match display |
| **MagicMirror Flyer** | 8082/2054 | Paired instance for dedicated flyer-only display |

**State file:** `/root/tournament-control-center/MagicMirror-bracket/modules/MMM-BracketView/bracket-state.json`
- Written by this module when bracket URL or zoom is configured
- Read by admin dashboard for status monitoring
- Contains `bracketUrl`, `zoomScale`, and `lastUpdated` fields

**Workflow:**
1. Admin dashboard sends bracket URL to port 2053 via POST /api/bracket/update
2. MMM-BracketView updates its state and writes to `bracket-state.json`
3. Module displays bracket iframe (or placeholder if no URL configured)
4. Admin can control bracket view via POST /api/bracket/zoom, /focus, /reset
5. Commands are sent to Challonge iframe via postMessage API

## Project-Specific Notes

- Main MagicMirror runs on port **8081** (not default 8080)
- MMM-BracketView API runs on port **2053** (separate from main port)
- This is a bracket-only display (no flyer rotation logic)
- Network access enabled for remote tournament control
- No build step required - this is a pure runtime application
- Winston logging with 7-day rotation in `logs/` directory

## Testing

This module is tested through the system-wide testing infrastructure:

**API Testing:**
- Smoke tests via `scripts/smoke-test.sh` verify the module API is responding
- CI/CD pipeline includes module health checks during deployment

**Manual Testing:**
```bash
# Test module API
curl -sf http://localhost:2053/api/tournament/status && echo "OK"

# Test bracket display
# 1. Configure tournament via admin dashboard
# 2. Verify bracket iframe loads
# 3. Test zoom controls from admin dashboard
```

**Related Testing:**
- Admin dashboard E2E tests cover tournament workflows
- See `/root/tournament-control-center/admin-dashboard/__tests__/` for test suite
- See `/root/tournament-control-center/CLAUDE.md` for full testing documentation
