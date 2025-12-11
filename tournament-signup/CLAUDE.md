# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Tournament Signup** is a mobile-first Progressive Web App (PWA) for participant registration in gaming tournaments. It integrates with the Challonge API to automatically display current tournament information and register participants on-the-fly.

**Key Features:**
- Mobile-optimized signup form with participant name + optional Instagram handle
- PWA capabilities (installable, offline support, service worker caching)
- Dynamic game-specific rules and prizes based on current tournament
- Auto-syncs with admin dashboard via shared state file
- Real-time tournament info display (name, participant count)
- **Tournament state awareness** - adaptive UI based on tournament lifecycle
- **Smart registration window** - configurable time-based signup restrictions (default: 48 hours before tournament)
- **Signup cap enforcement** - optional participant limit with "Tournament Full" messaging
- Auto-refresh every 30 seconds to detect state changes
- State-specific displays: registration open, check-in phase, in progress, complete, too early, tournament full
- Registration deadline countdown timer (when start time is set)
- Registration opens countdown timer (when registration window is configured)
- Dark theme UI matching admin dashboard (with light mode toggle)
- Participant lookup ("Am I Registered?") feature
- Waitlist UI when tournament is full

**Domain:** `https://signup.despairhardware.com`
**Port:** 3001
**Service:** `control-center-signup.service` (systemd)

## Development Commands

### Running the Application

```bash
# Production mode
npm start

# Development mode with NODE_ENV=development
npm run dev

# Access at:
# - Local: http://localhost:3001
# - Production: https://signup.despairhardware.com
```

### Service Management

```bash
# Start/stop/restart service
sudo systemctl start control-center-signup
sudo systemctl stop control-center-signup
sudo systemctl restart control-center-signup

# Check status
sudo systemctl status control-center-signup

# View logs (real-time)
sudo journalctl -u control-center-signup -f

# View last 50 log lines
sudo journalctl -u control-center-signup -n 50

# Enable/disable auto-start on boot
sudo systemctl enable control-center-signup
sudo systemctl disable control-center-signup

# Reload systemd after editing service file
sudo systemctl daemon-reload
```

### Testing

```bash
# Health check
curl http://localhost:3001/api/health

# Get current tournament info
curl http://localhost:3001/api/tournament

# Get game-specific config
curl http://localhost:3001/api/game-config

# Test signup (WARNING: adds participant to real tournament!)
curl -X POST http://localhost:3001/api/signup \
  -H "Content-Type: application/json" \
  -d '{"participantName":"Test Player","instagram":"testhandle"}'
```

## Architecture

### Request Flow

```
User's Mobile Browser
    ↓
HTTPS (signup.despairhardware.com)
    ↓
Nginx Proxy Manager (SSL termination, port 443 → 3001)
    ↓
Express Server (port 3001)
    ├─ Static Files (public/*.html)
    └─ REST API (/api/*)
        ├─ Reads tournament ID from state file
        ├─ Fetches data from Challonge API
        └─ Submits participants to Challonge
```

### Key Integration Points

**Tournament State File:** `/root/tournament-dashboard/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json`
- Shared with admin dashboard
- Contains current `tournamentId` and `apiKey`
- Auto-syncs when admin dashboard updates tournament

**Challonge API v2.1 Endpoints Used:**
- `GET /v2.1/tournaments/{id}.json` - Fetch tournament details (name, participant count, game name, state)
- `POST /v2.1/tournaments/{id}/participants.json` - Add new participant

**v2.1 API Authentication:**
- Uses v1 API key with `Authorization-Type: v1` header
- Content-Type: `application/vnd.api+json` (JSON:API format)
- No Bearer prefix on Authorization header

## Technology Stack

**Backend:**
- Node.js 24.11.1
- Express 5.1.0 (routing, static files)
- Axios 1.7.2 (HTTP client for Challonge API)
- dotenv 16.4.5 (environment config)
- body-parser 1.20.2 (request parsing)

**Frontend:**
- Vanilla JavaScript (no framework)
- Tailwind CSS 3.x (via CDN)
- PWA features (service worker, manifest.json, installable)

**Infrastructure:**
- systemd service for process management
- Nginx Proxy Manager for reverse proxy + SSL
- Let's Encrypt SSL certificates

## File Structure

```
control-center-signup/
├── server.js                       # Express backend + API routes
├── package.json                    # Dependencies
├── .env                            # Configuration (API keys, paths)
├── control-center-signup.service       # systemd service definition
│
├── public/                         # Static frontend files
│   ├── index.html                  # Main signup form
│   ├── confirmation.html           # Success page after signup
│   ├── rules.html                  # Dynamic rules & prizes page
│   ├── service-worker.js           # PWA service worker (offline caching)
│   ├── manifest.json               # PWA manifest
│   └── icons/                      # PWA app icons
│
├── game-configs.json               # Game-specific rules & prizes
│
├── README.md                       # Installation & usage
├── PROJECT_SUMMARY.md              # Project overview
├── PWA_FEATURES.md                 # PWA implementation details
├── GAME_CONFIG_GUIDE.md            # How to add/edit game configs
├── DYNAMIC_CONFIG_SUMMARY.md       # Dynamic config system explanation
└── NGINX_PROXY_MANAGER_SETUP.md    # Reverse proxy setup
```

## API Endpoints

**Public Routes:**
- `GET /` - Main signup page (index.html)
- `GET /confirmation` - Success confirmation page
- `GET /rules` - Game-specific rules & prizes page

**API Routes:**
- `GET /api/health` - Health check (returns status, service name, timestamp)
- `GET /api/tournament` - Get current tournament info (name, game, participant count)
- `GET /api/game-config` - Get game-specific configuration (rules, prizes)
- `POST /api/signup` - Submit participant signup (body: `{participantName, instagram?}`)

## Configuration System

### Environment Variables (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `NODE_ENV` | Environment mode | production |
| `CHALLONGE_API_KEY` | Challonge API key | Required |
| `TOURNAMENT_STATE_FILE` | Path to shared tournament state JSON | `/root/tournament-dashboard/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json` |
| `FALLBACK_TOURNAMENT_ID` | Optional backup tournament ID if state file unavailable | (empty) |

**IMPORTANT:** API keys are never exposed to the frontend. All Challonge API requests are proxied through the backend.

### Game Configuration System

**File:** `game-configs.json`

Defines game-specific rules, prizes, and additional info for different tournament types.

**Supported games out-of-the-box:**
- `ssbu` - Super Smash Bros. Ultimate ($150/$75/$35)
- `mkw` - Mario Kart World ($100/$50/$25)
- `halo3` - Halo 3 ($75/$35/$15)
- `melee` - Super Smash Bros. Melee ($100/$50/$25)
- `mk8` - Mario Kart 8 Deluxe ($100/$50/$25)
- `sf6` - Street Fighter 6 ($125/$60/$30)
- `default` - Fallback for any other game ($100/$50/$25)

**Hot-Reload:** Game configs are automatically reloaded when `game-configs.json` is modified, without requiring a service restart. This is powered by chokidar file watcher.

**Game detection logic** (`server.js:28-41`):
- Matches game name from Challonge to config key
- Case-insensitive matching on keywords
- Example: "Super Smash Bros. Ultimate" → `ssbu` config

**Config structure:**
```json
{
  "game-key": {
    "name": "Full Game Name",
    "shortName": "Abbreviation",
    "rules": [{"title": "...", "description": "..."}],
    "prizes": [{"place": 1, "position": "1st Place", "emoji": "🥇", "amount": 100, ...}],
    "additionalInfo": ["...", "..."]
  }
}
```

**To add a new game:**
1. Add config to `game-configs.json`
2. Update `getGameConfigKey()` function in `server.js` with detection logic
3. Restart service: `sudo systemctl restart control-center-signup`

See `GAME_CONFIG_GUIDE.md` for detailed instructions.

## Key Implementation Details

### Tournament State Synchronization

The app reads tournament info from a shared JSON state file written by the admin dashboard:

```javascript
// server.js:49-75
function getTournamentInfo() {
  // 1. Try reading from TOURNAMENT_STATE_FILE
  // 2. Fallback to FALLBACK_TOURNAMENT_ID environment variable
  // 3. Return null if neither available
}
```

**Why this matters:**
- No manual configuration needed when admin dashboard creates/updates tournaments
- Signup app automatically picks up new tournament ID
- Both apps stay in sync through filesystem

### Tournament State Awareness

The signup form adapts its UI based on the tournament's current lifecycle state, providing a better user experience and preventing inappropriate actions.

**Supported Tournament States:**

| State | Display | UI Behavior |
|-------|---------|-------------|
| `pending` | 📝 Registration Open | Show signup form, countdown timer (if start time set) |
| `checking_in` | ✅ Check-In Phase | Hide signup, show check-in message |
| `checked_in` | ✅ Check-In Complete | Hide signup, show check-in complete message |
| `underway` | 🎮 In Progress | Hide signup, show "Tournament In Progress" with bracket link |
| `awaiting_review` | ⏳ Awaiting Review | Hide signup, show "Tournament In Progress" with bracket link |
| `complete` | 🏆 Complete | Hide signup, show "Tournament Complete" with results link |

**Implementation Details:**

1. **State Detection** (`public/index.html:221-237`):
   - Fetches tournament data from `/api/tournament` endpoint
   - Server returns tournament state from Challonge API
   - Calls `updateUIForState()` to show/hide appropriate sections

2. **Auto-Refresh** (`public/index.html:390-400`):
   - Polls `/api/tournament` every 30 seconds
   - Automatically detects state changes (e.g., pending → underway)
   - Updates UI without requiring manual page refresh

3. **Registration Countdown Timer** (`public/index.html:358-388`):
   - Displays countdown when tournament has `start_at` time set
   - Only shown during `pending` state
   - Format: HH:MM:SS until tournament starts
   - Automatically hides when time expires or state changes

4. **Dynamic Bracket Links** (`public/index.html:249-252`):
   - Uses `full_challonge_url` from API response
   - Fallback to constructing URL from tournament ID
   - Shown during `underway`, `awaiting_review`, and `complete` states

**State-Specific Components:**

```html
<!-- Pending State -->
<form id="signup-form">...</form>

<!-- Check-In State -->
<div id="checkin-message">Check-In Open! Please see organizer...</div>

<!-- Underway State -->
<div id="underway-message">
  <a href="[bracket-url]">View Live Bracket →</a>
</div>

<!-- Complete State -->
<div id="complete-message">
  Tournament Complete! 🏆
  <a href="[results-url]">View Full Results →</a>
</div>
```

**API Enhancements:**

The `/api/tournament` endpoint was enhanced to return additional fields:

```javascript
// server.js:198-210
{
  id: tournamentDetails.id,
  name: tournamentDetails.name,
  gameName: tournamentDetails.game_name,
  state: tournamentDetails.state,              // NEW: Tournament state
  participantsCount: tournamentDetails.participants_count,
  url: tournamentDetails.url,                  // NEW: Tournament URL slug
  fullChallongeUrl: tournamentDetails.full_challonge_url,  // NEW: Full bracket URL
  startAt: tournamentDetails.start_at          // NEW: Tournament start time (ISO 8601)
}
```

**Benefits:**
- Prevents late signups after tournament starts
- Clearer communication of tournament status
- Better user experience with state-appropriate messaging
- Reduces confusion and organizer inquiries
- Automatic detection of state changes without manual intervention

### Smart Registration Window

The signup form enforces time-based registration restrictions to prevent early signups and manage tournament capacity.

**Configuration:**

Registration settings are configured per-tournament via the admin dashboard and stored in `tournament-state.json`:

```json
{
  "tournamentId": "abc123",
  "apiKey": "...",
  "registrationWindowHours": 48,    // Hours before tournament that registration opens
  "signupCap": 32,                  // Optional max participants (null = unlimited)
  "lastUpdated": "2025-11-20T07:37:41.731Z"
}
```

**Registration Window Logic:**

| Condition | Registration Status | User Experience |
|-----------|-------------------|-----------------|
| Before window opens | `registrationOpen: false`<br>`reason: 'too_early'` | ⏰ Yellow banner: "Registration Opens Soon!"<br>Countdown to opening time<br>Signup form hidden |
| Within window<br>(tournament pending) | `registrationOpen: true` | ✅ Normal signup form<br>Participant count displayed<br>Submit button enabled |
| Past scheduled start time<br>(tournament still pending) | `registrationOpen: true` | ✅ Normal signup form<br>**Late walk-ins allowed** until admin starts tournament |
| Signup cap reached | `isFull: true` | 🚫 Red banner: "Tournament Full!"<br>Shows capacity (e.g., "32/32")<br>Signup form hidden |
| Tournament started (via admin) | `registrationOpen: false`<br>`reason: 'tournament_started'` | 🎮 State-based UI<br>"Tournament In Progress" message<br>Link to live bracket |

**IMPORTANT:** Registration does NOT close based on the scheduled start time in Challonge. Registration stays open until the tournament is **explicitly started** via the admin dashboard "Start Tournament" button. This allows for late walk-in entries at live events.

**Implementation Details:**

1. **Backend Validation** (`server.js:184-222`):
   ```javascript
   function isRegistrationOpen(tournamentDetails, registrationWindowHours) {
     // Only close when tournament actually starts - NOT based on scheduled time
     if (tournamentDetails.state !== 'pending') {
       return { open: false, reason: 'tournament_started' };
     }

     // Check if before registration window
     const now = new Date();
     const tournamentStart = new Date(tournamentDetails.start_at);
     const registrationOpenTime = new Date(
       tournamentStart.getTime() - (registrationWindowHours * 60 * 60 * 1000)
     );

     if (now < registrationOpenTime) {
       return { open: false, reason: 'too_early', opensAt: registrationOpenTime };
     }

     // Registration stays open until admin clicks "Start Tournament"
     return { open: true };
   }
   ```

2. **API Response Enhancement** (`server.js:220-284`):

   The `/api/tournament` endpoint returns registration status:
   ```json
   {
     "tournament": {
       "name": "SSBU Weekly",
       "state": "pending",
       "participantsCount": 12,
       "startAt": "2025-11-26T12:30:00.000Z",
       "registrationWindowHours": 48,
       "signupCap": 32,
       "registrationOpenTime": "2025-11-24T12:30:00.000Z",
       "registrationOpen": false,
       "registrationReason": "too_early",
       "registrationOpensAt": "2025-11-24T12:30:00.000Z",
       "isFull": false
     }
   }
   ```

3. **Signup Validation** (`server.js:286-352`):

   The `/api/signup` endpoint enforces restrictions:
   ```javascript
   // Check if registration is open
   if (!registrationStatus.open) {
     return res.status(403).json({
       success: false,
       error: "Registration opens Nov 24, 12:30 PM",
       reason: registrationStatus.reason
     });
   }

   // Check signup cap
   if (signupCap && participantsCount >= signupCap) {
     return res.status(403).json({
       success: false,
       error: "Tournament is full (32/32 participants)",
       reason: "tournament_full"
     });
   }
   ```

4. **Frontend Registration Status Handler** (`public/index.html:287-379`):
   ```javascript
   function handleRegistrationStatus(tournament) {
     // Check if tournament is full
     if (tournament.isFull) {
       showRegistrationMessage('full');
       return;
     }

     // Check if registration not yet open
     if (!tournament.registrationOpen && tournament.registrationReason === 'too_early') {
       startRegistrationOpenCountdown(tournament.registrationOpensAt);
       showRegistrationMessage('too_early');
       return;
     }

     // Registration is open - show normal form
     updateUIForState(tournament.state);
   }
   ```

5. **Registration Opens Countdown** (`public/index.html:345-379`):
   - Live countdown timer showing days/hours/minutes/seconds until registration opens
   - Format: "4d 12:30:45" or "12:30:45" if less than 24 hours
   - Auto-reloads tournament data when countdown reaches zero
   - Displays friendly message: "Registration opens Nov 24, 12:30 PM PST"

**User Experience Flow:**

```
Tournament Announced (2-3 weeks early)
         ↓
[⏰ Registration Opens Soon!]
Countdown: 4d 12:30:45
         ↓
Registration Opens (48 hours before tournament)
         ↓
[✅ Signup Form Active]
Participants: 12/32
         ↓
Tournament Full (optional, if cap set)
         ↓
[🚫 Tournament Full! 32/32]
         ↓
Tournament Starts
         ↓
[🎮 Tournament In Progress]
```

**Configuration via Admin Dashboard:**

Organizers set registration settings when configuring tournaments:
1. Navigate to admin dashboard (`admin.despairhardware.com`)
2. Select tournament from Challonge
3. Set **Registration Window** (default: 48 hours, range: 1-336 hours)
4. Set **Signup Cap** (optional, leave empty for unlimited)
5. Submit configuration

Settings are immediately applied and persist across service restarts.

**Benefits:**
- **Prevents early signups** - No signups weeks in advance that lead to no-shows
- **Better attendance tracking** - Know exact numbers 48 hours before tournament
- **Walk-ins still work** - Registration stays open until tournament starts
- **Capacity management** - Optional signup cap prevents oversignup
- **Professional appearance** - Clear communication about registration status
- **Automated enforcement** - No manual intervention required

**Default Behavior:**
- Registration window: **48 hours** (configurable per tournament)
- Signup cap: **Unlimited** (optional per tournament)
- If no start time set: Registration stays open (backward compatible)

### Participant Submission

When user submits signup form:

1. **Frontend** (`public/index.html:216-261`):
   - Validates participant name (required)
   - Sanitizes Instagram handle (removes leading @)
   - Sends POST to `/api/signup`
   - Shows loading spinner, disables button
   - Redirects to confirmation page on success

2. **Backend** (`server.js:217-280`):
   - Validates request body
   - Fetches tournament ID from state file
   - Calls Challonge API to add participant
   - Instagram handle stored in Challonge's `misc` field as "Instagram: @handle"
   - Returns participant ID and seed
   - Handles Challonge API errors gracefully

### PWA Features

**Service Worker** (`public/service-worker.js`):
- Caches static assets (HTML, CSS, JS)
- Enables offline page loads
- Auto-updates every 60 seconds
- Network-first strategy for API calls, cache-first for static files

**Manifest** (`public/manifest.json`):
- Installable on iOS/Android/Desktop
- Custom icons (72px - 512px)
- Standalone display mode (hides browser UI)
- Theme color: `#667eea` (purple gradient)

**Installation prompt** (`public/index.html:266-301`):
- Defers default install prompt
- Can trigger custom install UI (currently logged only)
- Tracks app installation event

## Common Development Tasks

### Updating Game Configurations

**Edit existing game config:**
```bash
nano /root/tournament-dashboard/control-center-signup/game-configs.json
# Make changes to rules, prizes, or additional info
sudo systemctl restart control-center-signup
```

**Add new game:**
1. Add config block to `game-configs.json`
2. Update `getGameConfigKey()` in `server.js` with detection keyword
3. Restart service

**Test game config:**
```bash
# Set up tournament in admin dashboard with new game name
# Visit https://signup.despairhardware.com/rules
# Verify correct rules and prizes appear
```

### Modifying Frontend

**Update signup form** (`public/index.html`):
```bash
nano /root/tournament-dashboard/control-center-signup/public/index.html
# Make changes - no build step required
# Refresh browser to see changes (hard refresh: Ctrl+Shift+R)
```

**Update rules page** (`public/rules.html`):
```bash
nano /root/tournament-dashboard/control-center-signup/public/rules.html
# Dynamic content loaded via JavaScript from /api/game-config
# Static structure can be modified directly
```

**Important:** No build/compile step. Changes are live immediately (static files served directly).

### Adding New API Endpoints

**Example - adding a new endpoint:**
```javascript
// server.js
app.get('/api/my-endpoint', async (req, res) => {
  try {
    // Your logic here
    res.json({ success: true, data: ... });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
```

**Restart required:** Changes to `server.js` require service restart:
```bash
sudo systemctl restart control-center-signup
```

### Testing Challonge Integration

**Verify API key:**
```bash
curl "https://api.challonge.com/v1/tournaments.json?api_key=YOUR_API_KEY"
```

**Check tournament access:**
```bash
# Get tournament ID from state file
cat /root/tournament-dashboard/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json

# Test API access
curl "https://api.challonge.com/v1/tournaments/TOURNAMENT_ID.json?api_key=YOUR_API_KEY"
```

**Monitor signup submissions:**
```bash
sudo journalctl -u control-center-signup -f
# Submit test signup via web form
# Watch logs for "Participant added: ..." message
```

## Testing

This service is tested as part of the system-wide testing infrastructure:

**System-Level Testing:**
- Smoke tests via `scripts/smoke-test.sh` verify the service is running
- CI/CD pipeline includes service health checks during deployment

**Manual Testing:**
```bash
# Test signup page loads
curl -sf http://localhost:3001/ > /dev/null && echo "OK" || echo "FAIL"

# Test with running tournament
# 1. Set up tournament via admin dashboard
# 2. Access signup page and verify tournament info displays
# 3. Submit test registration
```

**Related Testing:**
- Admin dashboard E2E tests cover tournament setup that affects signup
- See `/root/tournament-dashboard/admin-dashboard/__tests__/` for test suite
- See `/root/tournament-dashboard/CLAUDE.md` for full testing documentation

## Troubleshooting

### Service Won't Start

```bash
# Check recent logs for errors
sudo journalctl -u control-center-signup -n 50

# Common issues:
# 1. Port 3001 already in use
sudo lsof -i :3001
# Kill conflicting process or change PORT in .env

# 2. Missing dependencies
cd /root/tournament-dashboard/control-center-signup
npm install

# 3. Permission issues
ls -la /root/tournament-dashboard/control-center-signup/.env
# Ensure .env is readable by root (service runs as root)

# 4. Invalid .env file
cat /root/tournament-dashboard/control-center-signup/.env
# Verify CHALLONGE_API_KEY is set
```

### "No Active Tournament" Error

```bash
# Check state file exists and contains tournament ID
cat /root/tournament-dashboard/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json

# Should contain:
# {"tournamentId":"abc123","apiKey":"...","gameName":"..."}

# If missing:
# 1. Set up tournament via admin dashboard (admin.despairhardware.com)
# 2. OR set FALLBACK_TOURNAMENT_ID in .env
nano /root/tournament-dashboard/control-center-signup/.env
# Add: FALLBACK_TOURNAMENT_ID=your_tournament_id
sudo systemctl restart control-center-signup
```

### Signup Fails / Challonge API Errors

```bash
# View real-time logs while testing
sudo journalctl -u control-center-signup -f

# Test Challonge API directly
curl "https://api.challonge.com/v1/tournaments/TOURNAMENT_ID.json?api_key=YOUR_API_KEY"

# Common Challonge errors:
# - 401 Unauthorized: Invalid API key
# - 404 Not Found: Invalid tournament ID
# - 422 Unprocessable: Duplicate participant name, tournament started, etc.

# Check error details in browser console (F12)
# Backend logs show full Challonge error response
```

### Mobile Access Issues

```bash
# Verify service is running
sudo systemctl status control-center-signup

# Test local access
curl http://localhost:3001/api/health

# Check firewall (if using)
sudo ufw status
sudo ufw allow 3001/tcp  # If needed

# Test from mobile on same network
# Visit http://SERVER_IP:3001

# For production domain (signup.despairhardware.com):
# - Verify NPM proxy points to localhost:3001
# - Check DNS resolves correctly
# - Ensure SSL certificate is valid
```

### PWA Not Installing

**Browser requirements:**
- HTTPS required (or localhost for testing)
- Manifest.json must be valid
- Service worker must register successfully

**Debug steps:**
1. Open browser DevTools (F12)
2. Go to "Application" tab
3. Check "Manifest" section for errors
4. Check "Service Workers" section - should show "activated and running"
5. Look for console errors during registration

**Force refresh service worker:**
```javascript
// In browser console:
navigator.serviceWorker.getRegistrations().then(registrations => {
  registrations.forEach(r => r.unregister());
});
// Then refresh page
```

### Game Config Not Loading

```bash
# Verify game-configs.json is valid JSON
cat /root/tournament-dashboard/control-center-signup/game-configs.json | python3 -m json.tool

# Check logs for config loading message on startup
sudo journalctl -u control-center-signup -n 50 | grep "Loaded game configurations"

# Should show: "Loaded game configurations: default, ssbu, melee, mk8, sf6"

# Test game config endpoint
curl http://localhost:3001/api/game-config

# Check which game key is matched
# View logs while loading /rules page
sudo journalctl -u control-center-signup -f
```

## Security Considerations

**Public Access:**
- No authentication required (intentional - public signup form)
- Consider adding rate limiting for production (not currently implemented)
- Client-side validation + server-side validation on all inputs

**API Key Protection:**
- Challonge API key stored in `.env` (server-side only)
- Never exposed to browser or frontend code
- All Challonge API requests proxied through backend

**Input Sanitization:**
- Participant names: trimmed, max 50 characters (enforced client + server)
- Instagram handles: sanitized (removes leading @), alphanumeric + dots/underscores only, max 30 characters
- SQL injection not applicable (no database, API-only)

**HTTPS:**
- Enforced via Nginx Proxy Manager
- Let's Encrypt SSL certificates
- HTTP → HTTPS redirect enabled

## Integration with Tournament Dashboard Ecosystem

This app is part of a larger tournament system:

| Component | URL/Port | Purpose |
|-----------|----------|---------|
| **Admin Dashboard** | `admin.despairhardware.com:3000` | Tournament setup & control |
| **MagicMirror Match** | Port 2052 | Current match display (API) |
| **MagicMirror Bracket** | Port 2053 | Bracket & flyer display (API) |
| **Tournament Signup** | `signup.despairhardware.com:3001` | Participant registration (this app) |

**Shared state file:** All components read/write tournament info via:
```
/root/tournament-dashboard/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json
```

**Workflow:**
1. Admin sets up tournament → writes `tournament-state.json`
2. Signup app reads tournament ID from state file
3. Participants register via signup app
4. MagicMirror displays live matches and brackets

## Deployment Checklist

**Initial setup:**
```bash
cd /root/tournament-dashboard/control-center-signup
npm install
cp .env.example .env  # If exists
nano .env  # Set CHALLONGE_API_KEY
sudo cp control-center-signup.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable control-center-signup
sudo systemctl start control-center-signup
sudo systemctl status control-center-signup
```

**Nginx Proxy Manager:**
- Domain: `signup.despairhardware.com`
- Forward to: `localhost:3001` (or `192.168.1.27:3001`)
- SSL: Let's Encrypt (auto-renew)
- Force HTTPS: ✓
- HSTS: ✓

**Verify deployment:**
```bash
# Local test
curl http://localhost:3001/api/health

# Remote test
curl https://signup.despairhardware.com/api/health

# Mobile test
# Visit https://signup.despairhardware.com on phone
# Try installing as PWA (Add to Home Screen)
```

## Version History

- **v1.0.0** - Initial release (Nov 19, 2024)
  - Basic signup form + Challonge integration
  - Mobile-first responsive design
  - Auto-sync with admin dashboard

- **v1.1.0** - PWA features (Nov 19, 2024)
  - Service worker + offline support
  - Installable app (Add to Home Screen)
  - Instagram handle integration
  - Rules & prizes page

- **v1.2.0** - Dynamic game configs (Nov 20, 2025)
  - Game-specific rules and prizes
  - Support for SSBU, Melee, MK8, SF6
  - Automatic game detection from Challonge

- **v1.3.0** - Tournament state awareness (Nov 20, 2025)
  - Adaptive UI based on tournament lifecycle state
  - State-specific displays: pending, check-in, underway, complete
  - Auto-refresh every 30 seconds to detect state changes
  - Registration countdown timer (when start time is set)
  - Dynamic bracket links to Challonge
  - Prevents late signups after tournament starts
  - Better user communication throughout tournament lifecycle

- **v1.4.0** - Smart Registration Window (Nov 20, 2025)
  - Configurable registration window (default 48 hours before tournament start)
  - Optional signup cap with "Tournament Full" messaging
  - Registration opens countdown timer with auto-reload
  - Time-based signup restrictions prevent early registrations
  - Admin dashboard controls for per-tournament settings
  - Better attendance tracking for organizers
  - Walk-in support maintained until tournament starts
  - Clear user communication for registration status (too early, full, open)
  - Backend validation enforces restrictions (403 status for blocked signups)

- **v1.5.0** - Challonge API v2.1 Migration (Nov 27, 2025)
  - Migrated from deprecated Challonge API v1 to v2.1
  - Uses JSON:API format for requests/responses
  - `fetchTournamentDetails()` now uses v2.1 endpoint
  - `addParticipant()` now uses v2.1 endpoint with proper JSON:API structure
  - Added `getChallongeV2Headers()` helper for consistent API authentication
  - Response mapping maintains backward compatibility with existing code

- **v1.6.0** - Hot-Reload Game Configs (Dec 7, 2025)
  - Added chokidar file watcher for game-configs.json
  - Game configurations reload automatically when file is modified
  - No service restart required when admin edits game configs
  - Added Mario Kart World (mkw) and Halo 3 (halo3) game configs
  - Admin dashboard manages game configs via new Games page
  - Dual-file sync: admin writes to both admin-dashboard and signup copies

- **v1.7.0** - Late Walk-In Support (Dec 10, 2025)
  - Registration no longer auto-closes at scheduled tournament start time
  - Registration stays open until admin explicitly clicks "Start Tournament"
  - Allows late walk-in entries at live events (common scenario at venues)
  - Fixed issue where people couldn't sign up after scheduled time even though tournament hadn't started
  - Registration window still controls when signup **opens** (X hours before start)
  - Only tournament state change (pending → underway) closes registration

## Related Documentation

- `README.md` - Installation and usage guide
- `PROJECT_SUMMARY.md` - High-level project overview
- `PWA_FEATURES.md` - PWA implementation details
- `GAME_CONFIG_GUIDE.md` - How to configure games
- `DYNAMIC_CONFIG_SUMMARY.md` - Dynamic config system explanation
- `NGINX_PROXY_MANAGER_SETUP.md` - Reverse proxy setup
- Parent project `CLAUDE.md` - Tournament dashboard system overview
