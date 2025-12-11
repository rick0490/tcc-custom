# Stream Deck Controller

Custom HID-based controller for Elgato Stream Deck Module 15, designed for tournament organizing operations.

## Overview

This module provides a physical control interface for the tournament dashboard using an Elgato Stream Deck with 15 LCD keys. It communicates directly with the Stream Deck via raw HID protocol (no Elgato SDK required) and interfaces with the admin dashboard REST API.

**Hardware:**
- Elgato Stream Deck Module 15 (20GBA9901)
- Raspberry Pi Zero 2 W (hostname: streamdeck1, IP: 192.168.1.175)
- USB connection

**HID Protocol Reference:** https://docs.elgato.com/streamdeck/hid/module-15_32

## Pi Zero 2 W Connection

```bash
# SSH to Pi Zero 2 W
ssh streamdeck1@192.168.1.175
# Password: California4490

# Installation directory
cd ~/stream-deck-controller
```

## Device Specifications

| Property | Value |
|----------|-------|
| VID | 0x0FD9 |
| PID | 0x00B9 |
| Keys | 15 (3 rows × 5 columns) |
| LCD | 480 × 272 pixels |
| Key Image | 72 × 72 pixels (JPEG, rotated 180°) |
| Interface | USB 2.0 HID |

## Key Layout

```
Physical layout (3 rows × 5 columns):
    [ 0] [ 1] [ 2] [ 3] [ 4]
    [ 5] [ 6] [ 7] [ 8] [ 9]
    [10] [11] [12] [13] [14]
```

### Main View Layout
```
    [Live 1] [Live 2] [Open 1] [Open 2] [Open 3]   <- Matches
    [ Prev ] [Refresh] [ Next ] [Ticker] [ANNOUNCE] <- Nav + Actions
    [Station] [Stats ] [Bright] [ HOME ] [ Exit ]   <- Settings + Nav
```

### Match Control Layout (when match selected)
```
    [  P1  ] [Score ] [  P2  ] [P1 Win] [P2 Win]   <- Players + Winners
    [+1 P1 ] [Scores] [+1 P2 ] [START ] [Forfeit]  <- Scores + Actions
    [ TV 1 ] [ TV 2 ] [ Back ] [ HOME ] [Reopen ]  <- Stations + Nav
```

### Score Entry Layout
```
    [  P1  ] [-1 P1 ] [P1: X ] [+1 P1 ] [  P2  ]   <- P1 controls
    [Score ] [-1 P2 ] [P2: X ] [+1 P2 ] [Winner]   <- P2 controls
    [Clear ] [Submit] [ Back ] [ HOME ] [Cancel]   <- Actions + Nav
```

### Ticker View Layout
```
    [5 Min ] [Report] [Start ] [Finals] [CheckIn]  <- Presets row 1
    [LastCl] [  --  ] [  --  ] [  --  ] [  --  ]   <- Presets row 2
    [  --  ] [  --  ] [ Back ] [ HOME ] [Cancel]   <- Nav
```

## Installation

### On Pi Zero 2 W

```bash
# Download and run installer
curl -sSL https://admin.despairhardware.com/streamdeck/install.sh | sudo bash

# Or manually:
cd /root/tournament-control-center/stream-deck-controller
sudo bash install.sh
```

### Manual Installation

```bash
# Install dependencies
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv \
    libhidapi-libusb0 libudev-dev libusb-1.0-0-dev \
    libjpeg-dev zlib1g-dev fonts-dejavu-core

# Create virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Set up udev rules (for non-root access)
sudo cp 99-streamdeck.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo usermod -a -G plugdev $USER
# Log out and back in for group to take effect

# Test
python3 controller.py
```

## Usage

### Commands

```bash
# Start service
sudo systemctl start stream-deck-controller

# Stop service
sudo systemctl stop stream-deck-controller

# View logs
sudo journalctl -u stream-deck-controller -f

# Check status
sudo systemctl status stream-deck-controller

# Run manually (for testing)
cd ~/stream-deck-controller
./test.sh
```

### Command Line Options

```bash
python3 controller.py --help

Options:
  --config, -c    Path to config file (default: config.json)
  --url, -u       Admin dashboard URL
  --station, -s   Station filter (e.g., "TV 1")
  --brightness, -b  Initial brightness (0-100)
```

## Authentication

The Stream Deck controller uses API token authentication. No plaintext credentials are stored.

**Setup:**
1. Go to admin dashboard: Settings > API Tokens
2. Click "Create New Token" and name it (e.g., "Stream Deck 1")
3. Copy the token (shown only once!)
4. SSH to Pi: `nano ~/stream-deck-controller/.env`
5. Set `ADMIN_API_TOKEN=<your-token>`
6. Restart: `sudo systemctl restart stream-deck-controller`

**Token Security:**
- Tokens are hashed with SHA-256 in the database
- Tokens can be revoked from the dashboard if compromised
- .env file has chmod 600 (owner read/write only)
- Tokens bypass CSRF validation (token itself is proof of authorization)

**API Token Endpoints (admin dashboard):**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/tokens` | POST | Create new token |
| `/api/auth/tokens` | GET | List all tokens |
| `/api/auth/tokens/:id` | DELETE | Revoke token |
| `/api/auth/verify-token` | GET | Verify token validity |

## Configuration

Edit `config.json`:

```json
{
  "admin_url": "https://admin.despairhardware.com",
  "api_token": null,            // Optional: can also use ADMIN_API_TOKEN env var
  "station_filter": null,       // null = all matches, "TV 1" = only TV 1
  "brightness": 80,             // 0-100
  "poll_interval": 5,           // seconds
  "ticker_presets": [
    {"label": "5m Break", "message": "5 MINUTE BREAK", "duration": 10},
    {"label": "Report In", "message": "PLAYERS REPORT TO YOUR STATIONS", "duration": 8}
  ]
}
```

Edit `.env` for API token (preferred, more secure):

```bash
# Token generated from admin dashboard Settings > API Tokens
ADMIN_API_TOKEN=your_64_char_hex_token_here
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       controller.py                             │
│  ┌───────────────┐   ┌────────────────┐   ┌─────────────────┐  │
│  │  View Modes   │   │  Key Handling  │   │  State Manager  │  │
│  │  - Main       │   │  - Press/Hold  │   │  - Matches      │  │
│  │  - Match Ctrl │   │  - Long Press  │   │  - Stations     │  │
│  │  - Score      │   │  - Actions     │   │  - Tournament   │  │
│  │  - Ticker     │   │                │   │                 │  │
│  └───────────────┘   └────────────────┘   └─────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
           ┌─────────────────┴─────────────────┐
           │                                   │
           v                                   v
┌──────────────────────┐           ┌──────────────────────┐
│    hid_device.py     │           │    api_client.py     │
│  ┌────────────────┐  │           │  ┌────────────────┐  │
│  │  HID Protocol  │  │           │  │  REST Client   │  │
│  │  - Input 0x01  │  │           │  │  - Matches     │  │
│  │  - Output 0x02 │  │           │  │  - Stations    │  │
│  │  - Feature 0x03│  │           │  │  - Ticker      │  │
│  │  - Images      │  │           │  │  - Winners     │  │
│  └────────────────┘  │           │  └────────────────┘  │
└──────────┬───────────┘           └──────────┬───────────┘
           │                                   │
           v                                   v
    ┌────────────┐                  ┌──────────────────────┐
    │ Stream Deck│                  │   Admin Dashboard    │
    │  (USB HID) │                  │  (Port 3000)         │
    └────────────┘                  └──────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `hid_device.py` | Raw HID communication with Stream Deck |
| `api_client.py` | Tournament dashboard REST API client |
| `websocket_client.py` | Socket.IO client for real-time updates |
| `controller.py` | Main controller with view modes and key handling |
| `config.json` | User configuration |
| `requirements.txt` | Python dependencies |
| `install.sh` | Installation script for Pi |

## WebSocket Real-Time Updates

The controller uses Socket.IO WebSocket for instant match updates (<100ms latency vs 2-5 second HTTP polling).

### Connection Status Indicator

Key 11 on the main view shows connection status:
- **GREEN** (WS:X) - WebSocket connected, X = live matches
- **YELLOW** (POLL:X) - WebSocket failed, using HTTP polling fallback
- **PURPLE** (HTTP:X) - WebSocket disabled, HTTP polling only

### Configuration

```json
{
  "websocket_enabled": true,
  "websocket_reconnect_delay": 1,
  "websocket_max_reconnect_delay": 60,
  "poll_fallback_interval": 5
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `websocket_enabled` | `true` | Enable/disable WebSocket connection |
| `websocket_reconnect_delay` | `1` | Initial reconnection delay (seconds) |
| `websocket_max_reconnect_delay` | `60` | Maximum reconnection delay (seconds) |
| `poll_fallback_interval` | `5` | HTTP polling interval when WebSocket disconnected |

### WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `display:register` | Client → Server | Register as Stream Deck device |
| `display:registered` | Server → Client | Registration confirmed |
| `matches:update` | Server → Client | Match state changes (instant) |
| `tournament:update` | Server → Client | Tournament configuration changes |
| `ticker:message` | Server → Client | Ticker message broadcast |
| `matches:request` | Client → Server | Request current match data |

### Fallback Behavior

1. On startup, controller attempts WebSocket connection
2. If WebSocket fails, falls back to HTTP polling
3. When WebSocket disconnects, automatically switches to polling
4. When WebSocket reconnects, polling stops and real-time resumes

### Troubleshooting WebSocket

```bash
# Check WebSocket connection in logs
sudo journalctl -u stream-deck-controller | grep WebSocket

# Test WebSocket manually
cd ~/stream-deck-controller
./venv/bin/python3 websocket_client.py https://admin.despairhardware.com

# Disable WebSocket if issues persist
# Edit config.json: "websocket_enabled": false
```

## HID Protocol

### Report Types

| Report ID | Direction | Purpose |
|-----------|-----------|---------|
| 0x01 | Input | Key state changes |
| 0x02 | Output | Commands (images, etc.) |
| 0x03 | Feature | Configuration |

### Commands

| Command | ID | Description |
|---------|-----|-------------|
| Set Key Image | 0x07 | Update individual key LCD |
| Set LCD Image | 0x08 | Update full LCD |
| Set Boot Logo | 0x09 | Update boot logo |
| Set Background | 0x0D | Update background |
| Brightness | 0x08 (Feature) | Set LCD brightness 0-100 |
| Sleep Timeout | 0x0D (Feature) | Set sleep timeout |

### Image Format

- Size: 72 × 72 pixels per key
- Format: JPEG
- Rotation: 180° (required by protocol)
- Chunked transfer: 1016 bytes per chunk

## API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/status` | GET | System status |
| `/api/matches/:id` | GET | Match list |
| `/api/matches/:id/stats` | GET | Match statistics |
| `/api/matches/:id/:mid/underway` | POST | Mark underway |
| `/api/matches/:id/:mid/unmark-underway` | POST | Stop match |
| `/api/matches/:id/:mid/score` | POST | Update score |
| `/api/matches/:id/:mid/winner` | POST | Declare winner |
| `/api/matches/:id/:mid/station` | POST | Assign station |
| `/api/stations/:id` | GET | Station list |
| `/api/ticker/send` | POST | Send ticker message |

## Troubleshooting

### Stream Deck Not Found

```bash
# Check if device is connected
lsusb | grep 0fd9

# Check hidraw devices
ls -la /dev/hidraw*

# Check udev rules
cat /etc/udev/rules.d/99-streamdeck.rules

# Reload udev
sudo udevadm control --reload-rules
sudo udevadm trigger
```

### Permission Denied

```bash
# Add user to plugdev group
sudo usermod -a -G plugdev $USER

# Log out and back in, then verify
groups
```

### Images Not Displaying

- Ensure fonts are installed: `sudo apt-get install fonts-dejavu-core`
- Check Pillow is installed: `pip list | grep Pillow`
- Verify JPEG support: `python3 -c "from PIL import Image; print(Image.EXTENSION)"`

### API Connection Failed

- Check network connectivity: `curl https://admin.despairhardware.com/api/status`
- Verify URL in config.json
- Check admin dashboard is running

## Development

### Testing HID Layer

```python
from hid_device import StreamDeckHID, create_text_image

deck = StreamDeckHID()
if deck.open():
    deck.set_brightness(80)
    deck.set_key_image(0, create_text_image("Hello"))
    deck.close()
```

### Testing API Client

```python
from api_client import TournamentAPIClient

client = TournamentAPIClient()
client.refresh_state()
print(client.get_open_matches())
```

## View Modes

The controller has 5 view modes:

| Mode | Purpose |
|------|---------|
| MAIN | Tournament overview, match list, quick actions |
| MATCH_CONTROL | Control selected match (start/stop, scores, winner) |
| SCORE_ENTRY | Detailed +/- score adjustment |
| TICKER | Send announcement messages |
| CONFIRM | Confirmation dialogs |

### Navigation Anchors (Consistent across all views)
- Key 12 = Back
- Key 13 = HOME
- Key 14 = Exit/Cancel

## Color Scheme

| Color | RGB | Meaning |
|-------|-----|---------|
| GREEN | (0, 170, 0) | Active/Underway/Success |
| BLUE | (0, 102, 204) | Ready/Open/Info |
| YELLOW | (204, 136, 0) | Attention/Warning/Assigned |
| RED | (204, 0, 0) | Danger/Exit/P2 |
| PURPLE | (102, 68, 170) | Navigation/System |
| CYAN | (0, 150, 150) | Refresh/Action |
| ORANGE | (200, 100, 0) | Settings/Config |

## Pi Zero 2 W Notes

### USB Reset Requirement
The Pi Zero 2 W kernel has limited hidraw support. Before starting the controller, reset the USB device:

```bash
sudo usbreset 0fd9:00b9
```

### Running with sudo
The controller requires root permissions for HID access:

```bash
cd ~/stream-deck-controller
sudo ./venv/bin/python3 controller.py
```

### Quick Reference
See `QUICK_REFERENCE.md` for detailed button layouts and workflow examples.

## Testing

This controller is tested through integration with the admin dashboard:

**Integration Testing:**
- Controller actions call admin dashboard REST API
- API responses are validated and displayed on Stream Deck

**Manual Testing:**
```bash
# SSH to Pi Zero 2 W
ssh streamdeck1@192.168.1.175

# Start controller
cd ~/stream-deck-controller
sudo usbreset 0fd9:00b9
sudo ./venv/bin/python3 controller.py

# Test button presses and verify:
# 1. Match data loads from admin API
# 2. Actions (mark underway, scores) update Challonge
# 3. Display updates reflect changes
```

**Related Testing:**
- Admin dashboard API tested via Jest unit tests
- E2E tests cover the same API endpoints this controller uses
- See `/root/tournament-control-center/admin-dashboard/__tests__/` for API tests
- See `/root/tournament-control-center/CLAUDE.md` for full system testing docs

## Current Status on Pi (As of 2025-12-06)

### Files on Device
```
/home/streamdeck1/
├── config.json                    # User config (brightness, presets)
├── controller.py                  # Main controller (copy)
├── api_client.py                  # API client (copy)
├── hid_device.py                  # HID layer (copy)
├── install.sh                     # Installer
├── requirements.txt               # Python deps
├── CLAUDE.md                      # Docs
└── stream-deck-controller/        # Working installation
    ├── venv/                      # Python virtual environment
    ├── .env                       # API token (chmod 600)
    ├── config.json                # Settings (no credentials)
    ├── controller.py
    ├── api_client.py
    ├── hid_device.py
    └── run.sh
```

### Systemd Service
```
/etc/systemd/system/stream-deck-controller.service
- User: streamdeck1
- WorkingDirectory: /home/streamdeck1/stream-deck-controller
- Restart: always (5s delay)
```

### udev Rules
```
/etc/udev/rules.d/99-streamdeck.rules
- MODE: 0666 for Stream Deck devices
- GROUP: plugdev
```

## Known Issues

1. **No offline caching** - If network fails, no cached data displayed
2. **USB reset sometimes required** - Pi kernel hidraw support is limited

## Future Improvements

- [x] ~~**CRITICAL: Remove plaintext credentials**~~ - COMPLETED (2025-12-06): API token auth
- [x] ~~Add CSRF token support~~ - NOT NEEDED: Token auth bypasses CSRF
- [x] ~~WebSocket for real-time updates (instead of polling)~~ - COMPLETED (2025-12-07): Socket.IO client
- [x] ~~Connection status indicator on key display~~ - COMPLETED (2025-12-07): Key 11 shows WS/POLL status
- [x] ~~Auto-reconnect with exponential backoff~~ - COMPLETED (2025-12-07): Built into WebSocket client
- [ ] Multi-page match navigation
- [ ] Sound effects for button presses (Pi audio output)
- [ ] Profile switching (different layouts)
- [ ] Custom key icon uploads
- [ ] Hotkey combos (multi-key actions)
- [ ] Local match data caching for offline resilience
- [ ] Haptic feedback support (if available on device)
