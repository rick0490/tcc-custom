# CLAUDE.md - Match Display Service

Standalone multi-tenant match display service for browser-based displays.

## Overview

| Property | Value |
|----------|-------|
| Port | 2052 |
| URL Pattern | `/u/:userId/match` |
| Technology | Express 5.1.0, EJS, Socket.IO Client |

## Architecture

```
Browser → Match Display (2052) → Admin Dashboard (3000)
              │                         │
              └── Socket.IO ────────────┘ (WebSocket for real-time updates)
```

The match display is a thin frontend that:
1. Serves EJS templates with user-specific configuration
2. Client-side JavaScript connects directly to Admin Dashboard via Socket.IO
3. HTTP fallback APIs for when WebSocket is unavailable

## Files

```
match-display/
├── server.js              # Express server (~200 lines)
├── package.json           # Dependencies
├── .env                   # Environment config
├── match-display.service  # Systemd service
├── views/
│   └── match-display.ejs  # HTML template
└── public/
    ├── css/
    │   └── match-display.css    # Styles (migrated from MagicMirror)
    └── js/
        ├── match-display.js     # Main controller (~1200 lines)
        ├── websocket-client.js  # Socket.IO connection
        ├── timer-manager.js     # DQ and tournament timers
        ├── overlay-manager.js   # Ticker, QR, sponsors, audio
        └── podium-display.js    # Podium mode rendering
```

## Configuration

### Environment Variables (.env)

```env
# Server port (uses legacy MagicMirror-match port for admin-dashboard compatibility)
PORT=2052

# Admin Dashboard URL (for HTTP fallback API calls)
ADMIN_DASHBOARD_URL=http://localhost:3000

# Admin Dashboard WebSocket URL (for real-time updates from browser)
# IMPORTANT: Use internal IP to bypass Nginx Proxy Manager WebSocket issues
ADMIN_WS_URL=http://192.168.1.28:3000

# Enable debug logging
DEBUG_MODE=true
```

### WebSocket URL Note

The `ADMIN_WS_URL` should use the **direct internal IP** of the admin dashboard server, not the external URL through Nginx Proxy Manager. This is because NPM doesn't properly forward WebSocket connections by default.

If you configure NPM with WebSocket support, you can use the external URL:
```env
ADMIN_WS_URL=https://admin.despairhardware.com
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service info and documentation link |
| `/api/health` | GET | Health check with uptime |
| `/api/tournament/status` | GET | Status endpoint for admin dashboard pre-flight checklist |
| `/u/:userId/match` | GET | Render match display for user |
| `/u/:userId` | GET | Redirect to `/u/:userId/match` |
| `/api/u/:userId/tournament` | GET | Get active tournament (HTTP fallback) |
| `/api/u/:userId/matches/:tournamentId` | GET | Get matches (HTTP fallback) |

### Health Check Response

```json
{
  "success": true,
  "service": "match-display",
  "version": "1.0.0",
  "timestamp": "2025-12-12T...",
  "uptime": 3600.5
}
```

## Features

### Display Layout

- **TV 1 / TV 2 Quadrants:** Top 60% of screen shows current matches on each TV
- **Up Next Queue:** Bottom 40% shows upcoming matches without station assignments
- **Responsive:** Adapts to different screen sizes

### Match State Lifecycle

Database match states follow: `pending → open → underway → complete`

The display translates these to visual states:

| Database State | Display State | Color | Description |
|----------------|---------------|-------|-------------|
| pending | Pending | White | Match waiting for players |
| open (with station) | Next Up | Orange | Match ready to start |
| underway | Underway | Red pulse | Match in progress |
| complete | Complete | Green glow | Match finished |

**Note:** The `getMatchState()` function checks `state === 'underway'` first, with a backwards-compatible fallback to check `underway_at` timestamp for older data.

### Winner Display

When a match completes:
1. Winner name shown with green glow
2. 4-second hold time
3. Fade animation to next state

### Overlays

| Feature | Description |
|---------|-------------|
| Ticker | Red gradient banner, slides from bottom |
| QR Code | Fullscreen overlay with URL |
| Sponsors | 6 positions (4 corners, 2 banners) |
| Audio TTS | Text-to-speech announcements |

### Timers

| Timer | Description |
|-------|-------------|
| DQ Timer | Per-TV timer with warning states (yellow at 30s, red at 10s) |
| Tournament Timer | Global countdown timer |

### Podium Mode

When tournament completes, displays:
- 1st Place (gold)
- 2nd Place (silver)
- 3rd Place (bronze)

## WebSocket Events

The client connects to Admin Dashboard's Socket.IO server and listens for:

| Event | Description |
|-------|-------------|
| `matches:update` | Match data update (includes all matches) |
| `ticker:message` | Ticker announcement |
| `timer:dq` | DQ timer start/stop |
| `timer:tournament` | Tournament timer start/stop |
| `qr:show` / `qr:hide` | QR code overlay |
| `sponsor:show` / `sponsor:hide` | Sponsor overlay |
| `audio:announce` | TTS announcement |

### Multi-Tenant Room Isolation

On connection, the client registers with userId:
```javascript
socket.emit('display:register', {
    displayType: 'match',
    userId: userId,
    displayId: `web-match-${userId}-${Date.now()}`
});
```

Server joins client to user-specific rooms:
```javascript
socket.join(`user:${userId}`);
socket.join(`user:${userId}:match`);
```

This ensures users only receive their own tournament data.

## Up Next Queue Logic

The "Up Next" section shows matches waiting to be assigned to a station:

```javascript
// Filter criteria:
// 1. Match is open or underway (not pending or complete)
// 2. No station assigned
// 3. Not a 3rd place match
// 4. Both players are known (not TBD)

// Sort order:
// 1. By round (earlier rounds first)
// 2. By suggested play order
// 3. By identifier
```

This prevents "TBD vs TBD" matches from appearing in the queue.

## Font System

Optimized for 30-foot viewing distance. See [CODING_STYLE.md](../CODING_STYLE.md#font-system) for complete documentation.

| Font | Variable | Usage |
|------|----------|-------|
| Inter | `--font-primary` | UI elements |
| Oswald | `--font-display` | Player names, TV labels (main display font) |
| JetBrains Mono | `--font-mono` | Timers, scores |

**Display sizes (30ft viewing):**
- TV labels: `5vw` (~96px)
- Player names: `4vw` (~72px)
- Ticker: `5vw` (~96px)

## Commands

```bash
# Start service
sudo systemctl start match-display

# Stop service
sudo systemctl stop match-display

# Restart service
sudo systemctl restart match-display

# View logs
sudo journalctl -u match-display -f

# Check status
sudo systemctl status match-display

# Development mode
cd /root/tcc-custom/match-display && npm run dev
```

## Installation

```bash
# Install dependencies
cd /root/tcc-custom/match-display
npm install

# Copy service file
sudo cp match-display.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable match-display

# Start service
sudo systemctl start match-display
```

## Debugging

### Enable Debug Mode

In `.env`:
```env
DEBUG_MODE=true
```

Restart service to apply.

### Debug Logs

```bash
# View all logs
sudo journalctl -u match-display -f

# Filter by action
sudo journalctl -u match-display -f | grep "renderDisplay"
```

### Browser Console

Enable frontend debugging:
```javascript
localStorage.setItem('debug_mode', 'true');
location.reload();
```

### Common Issues

**WebSocket Not Connecting:**
- Check `ADMIN_WS_URL` uses direct IP, not proxied URL
- Verify admin dashboard is running on port 3000
- Check browser console for CORS errors

**Matches Not Loading:**
- Verify user has an active tournament
- Check WebSocket connection status in browser dev tools
- Look for `matches:update` events in Network tab

**TBD vs TBD in Up Next:**
- Fixed in match-display.js by filtering `player1_id != null && player2_id != null`

## Dependencies

```json
{
  "express": "^5.1.0",
  "ejs": "^3.1.10",
  "socket.io-client": "^4.7.5",
  "axios": "^1.7.2",
  "dotenv": "^16.4.5",
  "express-rate-limit": "^7.0.0"
}
```

## Key Features

- Express + vanilla JS (no MagicMirror dependencies)
- Port 2052 for admin-dashboard HTTP fallback compatibility
- Multi-tenant support with per-user URLs
- Socket.IO for real-time WebSocket updates
- Standalone CSS styling
- TV 1/TV 2 quadrant layout
- Ticker, QR, sponsors, audio TTS overlays
- Podium display for tournament completion
