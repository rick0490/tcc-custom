# CLAUDE.md - Bracket Display Service

Standalone web-based bracket display service. Replaces the legacy MagicMirror-bracket module with a minimal Express server (~250 lines).

## Overview

| Property | Value |
|----------|-------|
| Port | 2053 |
| URL Pattern | `/u/:userId/bracket` |
| Framework | Express 5.1.0 |
| Template Engine | EJS |
| Dependencies | 5 (axios, dotenv, ejs, express, express-rate-limit) |

## Architecture

```
bracket-display/
├── server.js                # Express server (~250 lines)
├── package.json             # 5 dependencies
├── .env                     # Configuration
├── .env.example             # Template
├── bracket-display.service  # Systemd service
├── CLAUDE.md               # This file
├── views/
│   └── bracket-display.ejs  # HTML template
└── public/
    ├── css/
    │   └── bracket-display.css  # Fullscreen + sponsor overlay styling
    └── js/
        ├── websocket-client.js  # Socket.IO client
        ├── bracket-display.js   # Main controller
        ├── bracket-renderer.js  # Canvas bracket rendering
        └── sponsor-overlay.js   # Sponsor overlay manager
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service info JSON |
| `/api/health` | GET | Health check |
| `/api/bracket/status` | GET | Service status |
| `/u/:userId/bracket` | GET | Render bracket display |
| `/u/:userId` | GET | Redirect to `/u/:userId/bracket` |
| `/api/u/:userId/bracket/data` | GET | HTTP fallback for bracket data |
| `/api/bracket/update` | POST | Update bracket (deprecated) |
| `/api/bracket/zoom` | POST | Set zoom level (deprecated) |
| `/api/bracket/reset` | POST | Reset view (deprecated) |
| `/api/bracket/control` | POST | Generic control (deprecated) |
| `/api/sponsor/show` | POST | Show sponsors (deprecated) |
| `/api/sponsor/hide` | POST | Hide sponsors (deprecated) |
| `/api/sponsor/rotate` | POST | Rotate sponsors (deprecated) |

Note: POST endpoints are deprecated. All real-time updates now use WebSocket.

## Configuration (.env)

```bash
# Server port (uses legacy MagicMirror-bracket API port)
PORT=2053

# Admin Dashboard URL (for HTTP fallback API calls)
ADMIN_DASHBOARD_URL=http://localhost:3000

# Admin Dashboard WebSocket URL (for real-time updates from browser)
# Using internal IP directly to bypass reverse proxy (WebSocket issue)
ADMIN_WS_URL=http://192.168.1.28:3000

# Enable debug logging
DEBUG_MODE=false
```

## WebSocket Events

### Bracket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `display:register` | Client → Server | `{ displayType: 'bracket', userId, displayId }` |
| `bracket:update` | Server → Client | `{ tournament, matches, participants, theme, updateHash }` |
| `bracket:zoom` | Server → Client | `{ zoom: number }` |
| `bracket:reset` | Server → Client | `{}` |
| `bracket:control` | Server → Client | `{ action, ... }` |
| `bracket:ack` | Client → Server | `{ displayId, hash }` |

### Tournament Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `tournament:update` | Server → Client | `{ tournament }` |
| `tournament:deployed` | Server → Client | `{ tournamentId, tournament, participants }` |
| `tournament:started` | Server → Client | `{ tournamentId, tournament?, matches? }` |
| `tournament:completed` | Server → Client | `{ tournament }` |
| `tournament:reset` | Server → Client | `{ tournamentId }` |
| `matches:update` | Server → Client | `{ matches }` |

### Sponsor Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `sponsor:show` | Server → Client | `{ sponsors, config }` |
| `sponsor:hide` | Server → Client | `{ position? }` |
| `sponsor:rotate` | Server → Client | `{ position, sponsor }` |
| `sponsor:config` | Server → Client | `{ config }` |

## Features

### Bracket Rendering (bracket-renderer.js)
- **Native Canvas Rendering**: No iframes, fully custom drawing
- **4 Tournament Formats**: Single elimination, double elimination, round robin, swiss
- **5 Color Themes**: Midnight, Arctic Light, Neon Arcade, Royal Tournament, Forest
- **Pan/Zoom Support**: Mouse drag, scroll wheel, touch gestures
- **Auto-Fit**: Automatically scales bracket to fill screen
- **TV-Optimized**: Large fonts (14-20px) for 30ft readability
- **Match States**: Color-coded (pending gray, open white, underway amber pulse, complete green)
- **Preview Mode**: Shows seeded bracket before tournament starts (requires 2+ participants)
  - Single/Double Elimination: Full bracket structure with seeded players in R1, TBD in later rounds
  - Round Robin/Swiss: Participant list display

### Sponsor Overlay (sponsor-overlay.js)
- **6 Positions**: top-left, top-right, bottom-left, bottom-right, top-banner, bottom-banner
- **Fade Animations**: 0.5s enter/exit with scale transform
- **Dynamic Sizing**: Size, opacity, and offset controls
- **Banner Support**: Full-width banners with gradient backgrounds
- **Responsive**: Scales for 4K and 720p displays

### Display Controller (bracket-display.js)
- **Real-Time Updates**: WebSocket connection to admin dashboard
- **HTTP Fallback**: Polls every 30s when WebSocket disconnected
- **Loading States**: Spinner, placeholder, error screens
- **Connection Indicator**: Shows connection status (debug mode)
- **Multi-Tenant**: User-specific bracket data via WebSocket rooms

## Color Themes

| Theme | Background | Card | Text | Underway |
|-------|------------|------|------|----------|
| Midnight | #0a0a1a | #1a1a3a | #e0e0ff | #f59e0b |
| Arctic Light | #f8fafc | #ffffff | #1e293b | #f97316 |
| Neon Arcade | #0d0d0d | #1a1a1a | #00ff88 | #ff00ff |
| Royal Tournament | #1a1525 | #2d2640 | #d4af37 | #ffd700 |
| Forest | #0a1a0f | #1a2f1f | #90ee90 | #ffa500 |

## Commands

```bash
# Development
cd /root/tcc-custom/bracket-display && node server.js

# Systemd
sudo systemctl start bracket-display
sudo systemctl stop bracket-display
sudo systemctl restart bracket-display
sudo systemctl status bracket-display

# Logs
sudo journalctl -u bracket-display -f

# Test endpoints
curl http://localhost:2053/api/health
curl http://localhost:2053/api/bracket/status

# Install service
sudo cp bracket-display.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bracket-display
```

## Migration from MagicMirror-bracket

This service replaces `MagicMirror-bracket/` which used:
- Electron + Node.js + MagicMirror framework (~780 dependencies)
- Ports 8081 (web UI) + 2053 (API)
- MMM-BracketView module with node_helper.js
- Winston logger with 7-day rotation
- HTTP POST from admin dashboard to port 2053
- Optional Challonge iframe fallback

Now uses:
- Express 5.1.0 (~5 dependencies)
- Port 2053 only
- WebSocket-only communication (no HTTP callbacks)
- Direct Socket.IO connection to admin dashboard
- Native canvas rendering (no iframe dependencies)

## Bracket Data Flow

```
1. Admin Dashboard starts tournament
2. WebSocket broadcast: tournament:started
3. bracket-display fetches data: GET /api/u/:userId/bracket/data
4. bracket-renderer.js draws bracket on canvas
5. Match scored → WebSocket: matches:update → Re-render
6. Admin changes theme → WebSocket: bracket:control → Apply theme
```

## Related Files

- **Admin Dashboard Routes**: `/admin-dashboard/routes/tournaments.js`
- **Bracket Engine**: `/admin-dashboard/services/bracket-engine/`
- **Match DB**: `/admin-dashboard/services/match-db.js`
- **WebSocket Handler**: `/admin-dashboard/server.js` (display:register event)
- **Sponsor Storage**: `/admin-dashboard/sponsors/{userId}/`

## Debugging

Enable debug mode to see detailed console logging:

```javascript
// Browser console
localStorage.setItem('debug_mode', 'true');
location.reload();

// Shows connection indicator and verbose logs
```

Or via URL parameter:
```
http://localhost:2053/u/1/bracket?debug=true
```

Log prefixes:
- `[BracketDisplay]` - Main controller
- `[BracketRenderer]` - Canvas rendering
- `[WebSocket]` - Socket.IO client
- `[SponsorOverlay]` - Sponsor overlays
