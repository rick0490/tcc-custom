# CLAUDE.md - Flyer Display Service

Standalone web-based flyer display service. Replaces the legacy MagicMirror-flyer module with a minimal Express server (~130 lines).

## Overview

| Property | Value |
|----------|-------|
| Port | 2054 |
| URL Pattern | `/u/:userId/flyer` |
| Framework | Express 5.1.0 |
| Template Engine | EJS |
| Dependencies | 4 (express, ejs, dotenv, express-rate-limit) |

## Architecture

```
flyer-display/
├── server.js                # Express server (~130 lines)
├── package.json             # 4 dependencies
├── .env                     # Configuration
├── .env.example             # Template
├── flyer-display.service    # Systemd service
├── CLAUDE.md               # This file
├── views/
│   └── flyer-display.ejs   # HTML template
└── public/
    ├── css/
    │   └── flyer-display.css   # Fullscreen styling
    └── js/
        ├── websocket-client.js  # Socket.IO client
        └── flyer-display.js     # Main controller
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service info JSON |
| `/api/health` | GET | Health check |
| `/api/flyer/status` | GET | Service status |
| `/u/:userId/flyer` | GET | Render flyer display |
| `/u/:userId` | GET | Redirect to `/u/:userId/flyer` |

## Configuration (.env)

```bash
# Server port
PORT=2054

# Admin Dashboard URL (for flyer image fetching)
ADMIN_DASHBOARD_URL=http://localhost:3000

# Admin Dashboard WebSocket URL (direct IP for WebSocket)
# Use internal IP to bypass Nginx Proxy Manager WebSocket issues
ADMIN_WS_URL=http://192.168.1.28:3000

# Enable debug logging
DEBUG_MODE=false
```

## WebSocket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `display:register` | Client → Server | `{ displayType: 'flyer', userId, displayId }` |
| `flyer:activated` | Server → Client | `{ flyer, userId, timestamp }` |
| `flyer:uploaded` | Server → Client | `{ flyer, userId }` |
| `flyer:deleted` | Server → Client | `{ flyer, userId }` |
| `flyers:update` | Server → Client | `{ flyers: [] }` |

## Features

- **Fullscreen Display**: Pure black background, object-fit: contain
- **Image Support**: PNG, JPG, GIF
- **Video Support**: MP4 with autoplay, loop, muted
- **Fallback**: Default flyer on load error
- **Cache-Busting**: Timestamp query param for Cloudflare
- **Multi-Tenant**: User-specific flyers via WebSocket rooms
- **Real-Time Updates**: Socket.IO connection to admin dashboard
- **Debug Mode**: Connection status indicator

## Flyer URL Construction

```javascript
// Flyers served from admin dashboard
const flyerUrl = `${adminUrl}/api/flyers/preview/${userId}/${filename}?v=${Date.now()}`;

// Storage location (admin dashboard)
// /root/tcc-custom/admin-dashboard/flyers/{userId}/{filename}
```

## Commands

```bash
# Development
cd /root/tcc-custom/flyer-display && node server.js

# Systemd
systemctl start flyer-display
systemctl stop flyer-display
systemctl restart flyer-display
systemctl status flyer-display

# Logs
journalctl -u flyer-display -f

# Test endpoints
curl http://localhost:2054/api/health
curl http://localhost:2054/api/flyer/status
```

## Migration from MagicMirror-flyer

This service replaces `MagicMirror-flyer/` which used:
- Electron + Node.js framework (heavy, ~50 dependencies)
- Ports 8082 (web UI) + 2054 (API)
- MMM-FlyerView module with node_helper.js
- HTTP POST from admin dashboard to port 2054

Now uses:
- Express 5.1.0 (~4 dependencies)
- Port 2054 only
- WebSocket-only communication (no HTTP callbacks)
- Direct Socket.IO connection to admin dashboard

## Related Files

- **Admin Dashboard Routes**: `/admin-dashboard/routes/flyers.js`
- **Flyer Storage**: `/admin-dashboard/flyers/{userId}/`
- **WebSocket Handler**: `/admin-dashboard/server.js` (display:register event)
