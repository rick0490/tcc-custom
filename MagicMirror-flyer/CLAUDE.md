# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **MagicMirror² instance** specifically configured for dedicated tournament flyer display. It's part of a comprehensive five-service tournament management system that includes an admin dashboard, a signup web app, and two other MagicMirror display instances (match and bracket).

**This instance's role:** Displays tournament flyers fullscreen with no time-based rotation or bracket switching. Provides a static, clean flyer display for secondary screens or lobby areas.

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

**Service file:** `/etc/systemd/system/magic-mirror-flyer.service`

**Managing the service:**
```bash
# Start/stop/restart service
sudo systemctl start magic-mirror-flyer
sudo systemctl stop magic-mirror-flyer
sudo systemctl restart magic-mirror-flyer

# Check service status
sudo systemctl status magic-mirror-flyer

# View logs (follow mode)
sudo journalctl -u magic-mirror-flyer -f

# View last 50 log lines
sudo journalctl -u magic-mirror-flyer -n 50

# Enable/disable auto-start on boot
sudo systemctl enable magic-mirror-flyer
sudo systemctl disable magic-mirror-flyer

# Reload systemd after editing service file
sudo systemctl daemon-reload
```

**Service configuration:**
- Runs in **server-only mode** (no Electron GUI)
- Runs as **root user**
- **Auto-restarts on failure** with 10-second delay
- **MagicMirror web UI:** port 8082 (internal use)
- **Module API server:** port 2054
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
- `port`: Main MagicMirror port (default: 8080, this instance uses 8082)
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

## Custom Module: MMM-FlyerView

This installation includes a dedicated tournament flyer display module located at `modules/MMM-FlyerView/`.

**Key features:**
- Displays tournament flyers/videos fullscreen (PNG, JPG, MP4)
- Video playback with autoplay, loop, and muted (for browser autoplay policy)
- Static display (no time-based rotation)
- No bracket switching (flyer-only)
- Remote API control on port **2054**
- State persistence via `flyer-state.json`
- URL-encodes filenames to handle spaces and special characters
- Winston logger with 7-day log rotation

**API endpoints:**
- `POST http://<ip>:2054/api/tournament/update` - Update displayed flyer/video
- `GET http://<ip>:2054/api/tournament/status` - Health check

**Flyers location:** `/flyers/` directory (symlink to `MagicMirror-bracket/flyers/`)
- Symlinked so both displays share the same files
- Uploads go to `MagicMirror-bracket/flyers/` via admin dashboard
- PNG images (recommended: 1920x1080, 16:9)
- JPG/JPEG images
- MP4 videos (H.264 recommended, max 50MB)

**Difference from MMM-BracketView:**
- **MMM-FlyerView** (this module): Static flyer/video display only, no time-based rotation, no brackets
- **MMM-BracketView** (bracket instance): Time-based rotation between flyers and brackets, switches based on registration hours

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

**Check logs:** Logs printed to console with `console-stamp` formatting and to Winston log files in `logs/` directory

**Module not loading:** Check:
1. Module is in `config/config.js` modules array
2. Module files exist in `modules/<modulename>/`
3. Console for JavaScript errors
4. Module naming matches directory and registration name

**Network issues:**
- Verify `address: "0.0.0.0"` for remote access
- Check firewall settings
- Confirm `ipWhitelist: []` to allow all connections

### Page Load Tracking

The node_helper.js includes page load tracking to detect reload loops:

**Tracked metrics:**
- `clientRequestCount` - Total page loads since server start
- `lastClientRequestTime` - Timestamp of last page load

**Log output:**
```
[MMM-FlyerView] PAGE LOAD #5 (45000ms since last)
```

**Rapid reload detection:**
If page loads occur less than 5 seconds apart, an error is logged:
```
[MMM-FlyerView] RAPID PAGE LOADS DETECTED! Request #6 came 1200ms after previous
```

This helps diagnose:
- Reload loops caused by Cloudflare blocking
- Browser cache issues triggering repeated loads
- Server restart loops
- Socket.IO reconnection storms

**Check for reload issues:**
```bash
sudo journalctl -u magic-mirror-flyer | grep "PAGE LOAD"
sudo journalctl -u magic-mirror-flyer | grep "RAPID PAGE LOADS"
```

## Port Configuration

- **MagicMirror web interface:** 8082 (internal, access via browser)
- **MMM-FlyerView API:** 2054 (used by admin dashboard)
- **Important:** This instance uses port 8082, while match uses 8080 and bracket uses 8081

## View URLs (for Raspberry Pi displays)

The admin dashboard configures Pi displays to connect via HTTPS domains:

| View | URL |
|------|-----|
| **match** | `https://live.despairhardware.com` |
| **bracket** | `https://bracket.despairhardware.com` |
| **flyer** | `https://flyer.despairhardware.com` |

These domains route through Cloudflare and proxy to the internal MagicMirror ports.

## Integration with Tournament Ecosystem

This MagicMirror instance integrates with four other services:

| Service | Port | Integration |
|---------|------|-------------|
| **Admin Dashboard** | 3000 | Controls this instance via port 2054 API, manages flyers |
| **Tournament Signup** | 3001 | Independent but shares tournament timing context |
| **MagicMirror Match** | 8080/2052 | Paired instance for live match display |
| **MagicMirror Bracket** | 8081/2053 | Paired instance for bracket/flyer rotation display |

**State file:** `/root/tournament-control-center/MagicMirror-flyer/modules/MMM-FlyerView/flyer-state.json`
- Written by this module when flyer is configured
- Read by admin dashboard for status monitoring

**Flyers directory:** `/root/tournament-control-center/MagicMirror-flyer/flyers/`
- Shared with MagicMirror-bracket instance
- Supports PNG, JPG, and MP4 files uploaded via admin dashboard
- Recommended format: 1920x1080, 16:9 aspect ratio
- Max file size: 50MB

**Workflow:**
1. Admin dashboard uploads flyers/videos to shared `/flyers/` directory
2. Admin dashboard sends flyer selection to port 2054
3. MMM-FlyerView updates its state and writes to `flyer-state.json`
4. Module detects file type and displays image (`<img>`) or video (`<video>`) element
5. Videos autoplay with loop, muted for browser autoplay compliance

## Project-Specific Notes

- Main MagicMirror runs on port **8082** (not default 8080)
- MMM-FlyerView API runs on port **2054** (separate from main port)
- No time-based rotation logic (unlike bracket instance)
- Network access enabled for remote tournament control
- No build step required - this is a pure runtime application
- Winston logging with 7-day rotation in `logs/` directory
- Simpler than bracket instance - dedicated to flyer display only

## Use Cases

**When to use this instance vs MMM-BracketView:**
- **Use MMM-FlyerView (this instance)** for:
  - Lobby screens that should always show the flyer
  - Secondary displays where you don't want bracket switching
  - Simple, static promotional displays

- **Use MMM-BracketView (bracket instance)** for:
  - Main tournament display that needs to show both flyers and brackets
  - Time-based rotation between registration mode and tournament mode
  - Displays that need to show live bracket updates during tournaments

## Version Requirements

- **Node.js:** >= 22.18.0 (current: 24.11.1)
- **MagicMirror² version:** 2.33.0
- **Platform:** Linux (Proxmox VE 6.8.12-16)

## Testing

This module is tested through the system-wide testing infrastructure:

**API Testing:**
- Smoke tests via `scripts/smoke-test.sh` verify the module API is responding
- CI/CD pipeline includes module health checks during deployment

**Manual Testing:**
```bash
# Test module API
curl -sf http://localhost:2054/api/tournament/status && echo "OK"

# Test flyer display
# 1. Upload flyer via admin dashboard
# 2. Set flyer as active
# 3. Verify flyer displays on this module
```

**Related Testing:**
- Admin dashboard E2E tests cover flyer management workflows
- See `/root/tournament-control-center/admin-dashboard/__tests__/` for test suite
- See `/root/tournament-control-center/CLAUDE.md` for full testing documentation
