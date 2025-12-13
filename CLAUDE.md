## System Information

| Component | Value |
|-----------|-------|
| Hostname | tcc-custom |
| OS | Debian GNU/Linux 13 (trixie) |
| Kernel | Linux 6.8.12-16-pve (Proxmox VE) |
| CPU | Intel Core i7-8700 @ 3.20GHz |
| RAM | 2.0 GB |
| Disk | 32 GB (29 GB available) |

---

# CLAUDE.md - TCC Custom

**Standalone tournament management system with local database storage.** Fork of Tournament Control Center that replaces all Challonge API dependencies with custom bracket generation algorithms and local SQLite storage.

> **Note:** This project is a testing ground for a new implementation approach. It is also being used to evaluate the viability of new features and to explore monetizing this service as a SaaS offering.

## Key Differences from Original TCC

| Feature | Original TCC | TCC-Custom |
|---------|--------------|------------|
| Tournament Data | Challonge API | Local SQLite |
| Bracket Generation | Challonge | Custom algorithms |
| Rate Limiting | Required (API limits) | Not needed |
| Offline Support | Limited | Full |
| Bracket Display | Challonge iframe | Native canvas rendering |

## Coding Standards

**IMPORTANT:** Before writing any code, review these style guides:

### [Coding Style Guide](CODING_STYLE.md)
- Naming conventions by layer (frontend camelCase, database snake_case)
- API request/response transformation patterns
- Field name mapping reference
- **Font system** (Inter, Oswald, JetBrains Mono for 30ft display readability)
- Common pitfalls to avoid

### [Visual Style Guide](STYLE_GUIDE.md)
- Master color palette (brand colors, status colors, grays)
- Typography scales (dashboard, TV display, PDF)
- Spacing system (4px base unit)
- Component patterns (cards, buttons, inputs, modals)
- Animation & motion standards
- Accessibility requirements (WCAG 2.1 AA)

All code contributions must follow these standards to maintain consistency across the project.

## Architecture
```
Admin Dashboard (3000) → Controls all displays via REST API + WebSocket
├─ Multi-database SQLite architecture (4 databases)
│   ├─ tournaments.db  - Live tournament operations (high write, resettable)
│   ├─ players.db      - Historical analytics & Elo (critical backup)
│   ├─ system.db       - Config, auth, games, displays (stable)
│   └─ cache.db        - Ephemeral API caching (deletable anytime)
├─ Custom bracket generation engine (4 formats)
├─ Direct database queries (no external API)
└─ Socket.IO server for instant updates

Match Display (2052)             - Standalone web-based match display (multi-tenant, TV 1/TV 2 layout)
Flyer Display (2054)             - Standalone web-based flyer display (multi-tenant)
MagicMirror Bracket (8081/2053)  - Native bracket rendering (legacy Challonge iframe fallback available)
Tournament Signup (3001)         - Mobile PWA for registration
Stream Deck Controller (Pi Zero 2 W) - Physical control interface (3×5 keys)
```

## Database Architecture (4-Database Design)

| Database | Purpose | Write Freq | Backup Priority |
|----------|---------|------------|-----------------|
| **tournaments.db** | Active tournament state (tcc_* tables) | High | Medium (can rebuild) |
| **players.db** | Player history, Elo ratings, archived tournaments | Low | **Critical** |
| **system.db** | Config, auth, games, displays, sponsors | Rare | High |
| **cache.db** | API response cache | Very High | None (ephemeral) |

### Database Modules (`db/` directory)
| Module | File | Purpose |
|--------|------|---------|
| tournaments-db | `db/tournaments-db.js` | Live tournament CRUD, tcc_* tables |
| players-db | `db/players-db.js` | Player analytics, Elo, archived data |
| system-db | `db/system-db.js` | Config, users, games, displays, sponsors |
| cache-db | `db/cache-db.js` | Ephemeral API caching |
| index | `db/index.js` | Central export, initAll(), closeAll() |

### Cross-Database References
SQLite doesn't support cross-database foreign keys. References use app-level linking:
- `tournaments.db tcc_tournaments.game_id` → `system.db games.id` (via app logic)
- `tournaments.db tcc_participants.player_id` → `players.db players.id` (via app logic)

### Backup Commands
```bash
# Critical backup (players.db - historical data)
cp admin-dashboard/players.db backups/players-$(date +%Y%m%d).db

# Full backup (all databases)
for db in tournaments players system; do
    cp admin-dashboard/${db}.db backups/${db}-$(date +%Y%m%d).db
done

# Cache is ephemeral - safe to delete anytime
rm admin-dashboard/cache.db
```

## New Services (tcc-custom specific)

### Database Services
| Service | File | Purpose |
|---------|------|---------|
| tournament-db | `services/tournament-db.js` | CRUD for tcc_tournaments table |
| match-db | `services/match-db.js` | Match operations + bracket progression |
| participant-db | `services/participant-db.js` | Participant management |

### Bracket Engine
| Algorithm | File | Description |
|-----------|------|-------------|
| Single Elimination | `services/bracket-engine/single-elimination.js` | Standard seeding (1v16, 8v9), BYE distribution |
| Double Elimination | `services/bracket-engine/double-elimination.js` | Winners + losers bracket, grand finals, BYE handling for odd counts |
| Round Robin | `services/bracket-engine/round-robin.js` | Circle method scheduling |
| Swiss | `services/bracket-engine/swiss.js` | Score-based pairing, Buchholz tiebreaker |
| Entry Point | `services/bracket-engine/index.js` | Format dispatcher |

**Double Elimination BYE Handling:**
The losers bracket handles odd participant counts by creating BYE placeholder matches. When an odd number of losers enter any losers bracket round, a BYE match is created that auto-advances the odd player. This ensures proper bracket progression for any participant count (3, 5, 6, 7, 9, 11, etc.).

### Visualization
| Service | File | Purpose |
|---------|------|---------|
| bracket-renderer | `services/bracket-renderer.js` | Generates visualization data for all formats |

### WebSocket Broadcasting
Real-time updates are broadcast via Socket.IO for instant UI updates across all admin pages.

| Route File | Broadcast Function | Events |
|------------|-------------------|--------|
| `routes/tournaments.js` | `broadcastTournament()` | `tournament:created`, `tournament:updated`, `tournament:deleted`, `tournament:started`, `tournament:reset`, `tournament:completed` |
| `routes/participants.js` | `broadcastParticipant()` | `participant:added`, `participant:updated`, `participant:deleted`, `participant:checkin` |
| `routes/matches.js` | `broadcastMatchUpdate()` | `matches:update` |
| `routes/flyers.js` | `broadcastFlyer()` | `flyer:uploaded`, `flyer:deleted`, `flyer:activated` |
| `server.js` | Direct `io.emit()` | `display:registered`, `display:heartbeat` |

**Frontend WebSocket (utils.js):**
- `WS_EVENTS` - Constants for all event types
- `WebSocketManager` - Singleton for Socket.IO connection management
- All pages use adaptive polling (slower when WebSocket connected, faster when disconnected)

## Database Schema

### tournaments.db (Live Tournament Tables)
Located in `db/tournaments-db.js`, tables prefixed with `tcc_`:

```sql
-- Tournaments
CREATE TABLE tcc_tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url_slug TEXT UNIQUE NOT NULL,
    game_id INTEGER,
    tournament_type TEXT CHECK(tournament_type IN
        ('single_elimination','double_elimination','round_robin','swiss')),
    state TEXT DEFAULT 'pending' CHECK(state IN
        ('pending','underway','awaiting_review','complete')),
    signup_cap INTEGER,
    check_in_duration INTEGER,
    starts_at DATETIME,
    started_at DATETIME,
    completed_at DATETIME,
    hold_third_place_match INTEGER DEFAULT 0,
    grand_finals_modifier TEXT,
    swiss_rounds INTEGER,
    hide_seeds INTEGER DEFAULT 0,
    sequential_pairings INTEGER DEFAULT 0,
    format_settings_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Participants
CREATE TABLE tcc_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    player_id INTEGER,
    name TEXT NOT NULL,
    display_name TEXT,
    email TEXT,
    seed INTEGER,
    active INTEGER DEFAULT 1,
    checked_in INTEGER DEFAULT 0,
    checked_in_at DATETIME,
    final_rank INTEGER,
    misc TEXT,
    instagram TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE
);

-- Matches
CREATE TABLE tcc_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    identifier TEXT,
    round INTEGER NOT NULL,
    suggested_play_order INTEGER,
    player1_id INTEGER,
    player2_id INTEGER,
    player1_prereq_match_id INTEGER,
    player2_prereq_match_id INTEGER,
    player1_is_prereq_loser INTEGER DEFAULT 0,
    player2_is_prereq_loser INTEGER DEFAULT 0,
    -- State: pending -> open -> underway -> complete
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','open','underway','complete')),
    winner_id INTEGER,
    loser_id INTEGER,
    player1_score INTEGER,
    player2_score INTEGER,
    scores_csv TEXT,
    station_id INTEGER,
    underway_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE
);

-- Stations
CREATE TABLE tcc_stations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE
);

-- Standings (for round robin/swiss)
CREATE TABLE tcc_standings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    participant_id INTEGER NOT NULL,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    ties INTEGER DEFAULT 0,
    game_wins INTEGER DEFAULT 0,
    game_losses INTEGER DEFAULT 0,
    buchholz REAL DEFAULT 0,
    ranking INTEGER,
    FOREIGN KEY (tournament_id) REFERENCES tcc_tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES tcc_participants(id) ON DELETE CASCADE
);
```

## Bracket Progression Logic

When a match is scored, `match-db.js` handles automatic bracket advancement:

```javascript
// After setWinner() is called:
1. Find matches where this match is a prerequisite
2. Assign winner to player1/player2 slot based on prereq config
3. If loser bracket (double elim), assign loser to appropriate match
4. When both players assigned, set match state to 'open'
5. Broadcast update via WebSocket
```

## Match Lifecycle

Matches follow a 4-state lifecycle with timestamp tracking:

```
pending → open → underway → complete
```

| State | Description | Timestamp |
|-------|-------------|-----------|
| pending | Waiting for players to be assigned | - |
| open | Both players assigned, ready to start | - |
| underway | Match in progress | `underway_at` set |
| complete | Match finished | `completed_at` set |

### State Transitions

| API Call | State Change | Timestamp Behavior |
|----------|--------------|-------------------|
| `markUnderway()` | open → underway | Sets `underway_at` |
| `unmarkUnderway()` | underway → open | Clears `underway_at` |
| `setWinner()` / `setForfeit()` | underway → complete | **Keeps** `underway_at`, sets `completed_at` |
| `reopen()` | complete → open | Clears both timestamps |

### Analytics Use Case

The `underway_at` timestamp is preserved when completing a match, enabling:
- **Match Duration**: `completed_at - underway_at`
- Average match times per tournament
- Identifying slow matches

## Services Reference

### tournament-db.js
```javascript
create(data)              // Create tournament, generate url_slug
getById(id)               // Get by ID
getBySlug(slug)           // Get by URL slug
list(filters)             // List with optional filters
update(id, data)          // Update tournament
updateState(id, state)    // Change state (pending/underway/complete)
delete(id)                // Delete tournament and cascade
```

### match-db.js
```javascript
create(tournamentId, data)           // Create single match
bulkCreate(tournamentId, matches)    // Create multiple matches
getById(id)                          // Get match by ID
getByTournament(tournamentId)        // All matches for tournament
getByState(tournamentId, state)      // Filter by state (pending/open/underway/complete)
getOpenMatches(tournamentId)         // Get open (playable) matches
markUnderway(id)                     // Set state='underway', underway_at=NOW()
unmarkUnderway(id)                   // Set state='open', clear underway_at
setWinner(id, winnerId, scores)      // Set winner, state='complete', keeps underway_at
setForfeit(id, forfeitedId)          // DQ player, state='complete', keeps underway_at
reopen(id)                           // Set state='open', clear both timestamps
setStation(id, stationId)            // Assign to station
getStats(tournamentId)               // Count matches by state
getWaitingForPrereq(tournamentId, prereqId)  // Find dependent matches
```

### participant-db.js
```javascript
create(tournamentId, data)           // Add participant
bulkCreate(tournamentId, list)       // Bulk add
getById(id)                          // Get by ID
getByTournament(tournamentId)        // All participants
update(id, data)                     // Update participant
updateSeed(id, seed)                 // Set seed
randomizeSeeds(tournamentId)         // Shuffle all seeds
checkIn(id)                          // Mark checked in
undoCheckIn(id)                      // Undo check-in
delete(id)                           // Remove participant
clearAll(tournamentId)               // Remove all participants
applyEloSeeding(tournamentId, gameId) // Apply Elo-based seeding
```

**Important:** The `tournamentId` parameter must be a numeric database ID (not a URL slug). When handling API requests where the tournament identifier may be a slug, first resolve it:
```javascript
const tournament = tournamentDb.getById(tournamentId) || tournamentDb.getBySlug(tournamentId);
participantDb.create(tournament.id, data);  // Use tournament.id, not tournamentId
```

### bracket-engine/index.js
```javascript
generateBracket(tournament, participants)  // Generate matches for format
validateBracket(tournament, matches)       // Verify bracket integrity
advanceWinner(match, winnerId, loserId)    // Calculate next match
```

### bracket-renderer.js
```javascript
generateVisualization(tournament, matches, participants)
generateSingleElimVisualization(matches, participants)
generateDoubleElimVisualization(matches, participants)
generateRoundRobinVisualization(matches, participants, standings)
generateSwissVisualization(matches, participants, standings)
formatMatchForViz(match, participants)
getRoundName(round, format, totalRounds)
calculateBracketDimensions(matches, format)
generatePositionData(matches, format)
generateConnections(matches, format)
exportForRendering(visualization)
```

## API Changes from Original

### Removed Endpoints
- `GET /api/rate-limit/*` - No rate limiting needed
- OAuth/token management endpoints

### Modified Endpoints
All tournament/match/participant endpoints now use local database instead of Challonge API. Response format remains compatible.

### New Endpoints
```
GET  /api/bracket/data/:tournamentId      // Full bracket visualization data
POST /api/bracket/render/:tournamentId    // Trigger re-render
```

## MagicMirror Bracket Display

The bracket display (`MMM-BracketView.js`) supports two modes:

### Native Mode (default for tcc-custom)
```javascript
config: {
    renderMode: "native",  // Use custom bracket renderer
    // ...
}
```
- Canvas-based rendering
- Supports all 4 formats
- Real-time updates via WebSocket
- Zoom/pan support

### Iframe Mode (legacy fallback)
```javascript
config: {
    renderMode: "iframe",  // Legacy: Use external iframe embed
    // ...
}
```

## Match Polling

`match-polling.js` is simplified for local database:
- Poll interval: 5 seconds (faster since no API limits)
- Direct database queries
- WebSocket broadcast on changes
- No rate limiter dependency

## Commands

```bash
# Development
cd /root/tcc-custom/admin-dashboard && npm run dev

# Start all services
sudo systemctl restart match-display flyer-display magic-mirror-bracket control-center-admin control-center-signup

# Start individual services
sudo systemctl restart control-center-admin       # Admin Dashboard (port 3000)
sudo systemctl restart control-center-signup      # Tournament Signup (port 3001)
sudo systemctl restart match-display              # Match Display (port 2052) - Standalone web service
sudo systemctl restart flyer-display              # Flyer Display (port 2054) - Standalone web service
sudo systemctl restart magic-mirror-bracket       # Bracket Display (ports 8081, 2053)

# View logs
sudo journalctl -u control-center-admin -f
sudo journalctl -u control-center-signup -f
sudo journalctl -u match-display -f
sudo journalctl -u flyer-display -f
sudo journalctl -u magic-mirror-bracket -f

# Check service status
sudo systemctl status control-center-admin control-center-signup match-display flyer-display magic-mirror-bracket

# Database inspection
sqlite3 admin-dashboard/tournaments.db "SELECT * FROM tcc_tournaments;"
sqlite3 admin-dashboard/tournaments.db "SELECT * FROM tcc_matches WHERE tournament_id=1;"
```

## Tournament Flow

1. **Create Tournament**
   - `POST /api/tournaments/create` with format settings
   - Generates unique url_slug
   - State: `pending`

2. **Add Participants**
   - `POST /api/participants/:tournamentId` or bulk
   - Assign seeds (manual, random, or AI-suggested)

3. **Start Tournament**
   - `POST /api/tournament/:tournamentId/start`
   - Bracket engine generates all matches
   - First round matches set to `open`
   - State: `underway`

4. **Score Matches**
   - `POST /api/matches/:tournamentId/:matchId/score`
   - Winner advances automatically
   - Next matches open when ready

5. **Complete Tournament**
   - `POST /api/tournament/:tournamentId/complete`
   - Final rankings calculated
   - State: `complete`
   - Analytics/Elo updated

## Files Removed

These files from original TCC are not present in tcc-custom:
- `services/challonge-api.js` - Replaced by local DB services
- `services/rate-limiter.js` - Not needed for local operations
- `CHALLONGE_API_REFERENCE.md` - No longer applicable

## Directory Structure

```
/root/tcc-custom/
├── CLAUDE.md (this file)
├── admin-dashboard/
│   ├── server.js
│   ├── analytics-db.js           # Legacy - player analytics only
│   ├── tournaments.db            # Live tournament data
│   ├── players.db                # Historical analytics & Elo
│   ├── system.db                 # Config, auth, displays
│   ├── cache.db                  # Ephemeral API cache
│   ├── db/                       # Database modules
│   │   ├── index.js              # Central export
│   │   ├── tournaments-db.js     # tcc_* tables
│   │   ├── players-db.js         # Player history & Elo
│   │   ├── system-db.js          # Config, users, games
│   │   └── cache-db.js           # API caching
│   ├── services/
│   │   ├── tournament-db.js      # Tournament CRUD (uses db/tournaments-db)
│   │   ├── match-db.js           # Match operations
│   │   ├── participant-db.js     # Participant management
│   │   ├── station-db.js         # Station management
│   │   ├── bracket-engine/
│   │   │   ├── index.js
│   │   │   ├── single-elimination.js
│   │   │   ├── double-elimination.js
│   │   │   ├── round-robin.js
│   │   │   └── swiss.js
│   │   ├── bracket-renderer.js
│   │   ├── match-polling.js
│   │   └── ai-seeding.js
│   ├── scripts/
│   │   └── migrate-to-multi-db.js # Migration script
│   └── routes/
│       ├── tournaments.js        # Tournament CRUD + WebSocket broadcasts
│       ├── matches.js            # Match operations + WebSocket broadcasts
│       ├── participants.js       # Participant management + WebSocket broadcasts
│       │                         # - All routes accept tournamentId as ID or slug
│       │                         # - Helper: buildMiscField(instagram, existingMisc)
│       ├── flyers.js             # Flyer management + WebSocket broadcasts (note: upload route with auto-optimization is in server.js)
│       ├── displays.js           # Display management
│       └── platform.js           # Superadmin APIs (users, keys, tournaments, audit, database, announcements)
├── match-display/                # Standalone web-based match display (port 2052)
│   ├── server.js                 # Express server with EJS templates
│   ├── package.json
│   ├── .env                      # ADMIN_WS_URL config (direct IP for WebSocket)
│   ├── match-display.service     # Systemd service file
│   ├── views/
│   │   └── match-display.ejs     # HTML template
│   └── public/
│       ├── css/
│       │   └── match-display.css # Styles (migrated from MagicMirror)
│       └── js/
│           ├── match-display.js  # Main controller
│           ├── websocket-client.js # Socket.IO client
│           ├── timer-manager.js  # DQ and tournament timers
│           ├── overlay-manager.js # Ticker, QR, sponsors, audio
│           └── podium-display.js # Podium mode rendering
├── flyer-display/                # Standalone web-based flyer display (port 2054)
│   ├── server.js                 # Express server with EJS templates
│   ├── package.json
│   ├── .env                      # ADMIN_WS_URL config (direct IP for WebSocket)
│   ├── flyer-display.service     # Systemd service file
│   ├── views/
│   │   └── flyer-display.ejs     # HTML template
│   └── public/
│       ├── css/
│       │   └── flyer-display.css # Fullscreen flyer styles
│       └── js/
│           ├── flyer-display.js  # Main controller
│           └── websocket-client.js # Socket.IO client
├── MagicMirror-bracket/
│   └── modules/MMM-BracketView/
│       └── MMM-BracketView.js
├── tournament-signup/
└── stream-deck-controller/
```

## Platform Admin (Superadmin Only)

God-mode administrative tools accessible only to superadmin users (admin role + userId 1).

**Access:** Platform Admin link in sidebar (only visible to superadmins)

**Features:**
| Tab | Purpose |
|-----|---------|
| Users | Manage all users, enable/disable, subscription control, impersonation |
| Invite Keys | Create/manage invite keys (single, multi, unlimited), view usage |
| Tournaments | Browse all tournaments across all tenants, search/filter |
| Audit Log | Platform-wide activity log with advanced filtering, CSV export |
| Database | View status, create/download backups, vacuum, clear cache |
| Announcements | Create system-wide announcements (color-coded banners on all pages) |
| Settings | Maintenance mode, signup control, trial settings |

**Platform Announcements:**
- Alert (red), Warning (yellow), Info (blue) banners
- Display at top of all admin pages
- Users can dismiss (persisted in localStorage)
- Auto-checked every 5 minutes

**Database Table (system.db):**
```sql
CREATE TABLE platform_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info' CHECK(type IN ('info', 'warning', 'alert')),
    is_active INTEGER DEFAULT 1,
    expires_at DATETIME,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Superadmin Detection:**
```javascript
function isSuperadmin(req) {
    if (!req.session || !req.session.userId) return false;
    return req.session.role === 'admin' && req.session.userId === 1;
}
```

## Unchanged Components

These work identically to original TCC:
- Stream Deck controller
- Tournament Signup PWA
- Analytics/Elo system
- Sponsor overlays
- Ticker messages
- DQ timers
- Display management
- Authentication system

## Match Display Service

Standalone web-based match display service for browser-based displays.

**URL Pattern:** `/u/:userId/match`
**Port:** 2052
**Location:** `/root/tcc-custom/match-display/`

**Features:**
- TV 1 / TV 2 quadrant layout (60% top, 40% "Up Next")
- Match state colors: pending (white), next-up (orange), underway (red pulse), complete (green glow)
- Winner display with 4-second hold + fade animation
- Ticker announcements (red gradient banner)
- Per-TV DQ timers with warning states
- Tournament-wide timer
- QR code fullscreen overlay
- Sponsor overlays (6 positions)
- Audio TTS announcements
- Podium mode (1st/2nd/3rd when complete)
- Real-time WebSocket updates via Socket.IO

**WebSocket Connection:**
The match display connects to the admin dashboard's Socket.IO server for real-time updates. Due to Nginx Proxy Manager not properly forwarding WebSocket connections, the `ADMIN_WS_URL` in `.env` uses the direct internal IP (`http://192.168.1.28:3000`) instead of the external URL.

**Multi-Tenant Isolation:**
Each user gets isolated match data via WebSocket rooms:
```javascript
socket.join(`user:${userId}`);
socket.join(`user:${userId}:match`);
```

**Up Next Queue Sorting:**
Matches in the "Up Next" section are filtered and sorted:
1. Only matches with known players (no TBD vs TBD)
2. Sorted by round first (earlier rounds first)
3. Then by suggested play order
4. Finally by identifier

## Flyer Display Service

Standalone web-based flyer display service for browser-based displays.

**URL Pattern:** `/u/:userId/flyer`
**Port:** 2054
**Location:** `/root/tcc-custom/flyer-display/`

**Features:**
- Fullscreen image/video display (object-fit: contain)
- Video support (MP4) with autoplay/loop/muted
- Fallback to default flyer on load error
- Real-time updates from admin dashboard via WebSocket
- Cache-busting for Cloudflare CDN
- Multi-tenant support (user-specific flyers)
- Pure black background (#000)
- Connection status indicator (debug mode)

**WebSocket Events:**
| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `display:register` | Client → Server | `{ displayType: 'flyer', userId, displayId }` | Register display |
| `flyer:activated` | Server → Client | `{ flyer: 'filename.png', userId }` | Flyer changed |
| `flyer:uploaded` | Server → Client | `{ flyer: 'filename.png', userId }` | New flyer available |
| `flyer:deleted` | Server → Client | `{ flyer: 'filename.png', userId }` | Flyer removed |

**Multi-Tenant Isolation:**
Each user gets isolated flyer data via WebSocket rooms:
```javascript
socket.join(`user:${userId}`);
socket.join(`user:${userId}:flyer`);
```

**Flyer URL Construction:**
```javascript
const flyerUrl = `${adminUrl}/api/flyers/preview/${userId}/${filename}?v=${Date.now()}`;
```

## Important Notes

- **Offline Operation:** Works completely offline once set up
- **No API Keys:** No Challonge credentials needed
- **Faster Updates:** 5-second polling vs 15-second (no rate limits)
- **Data Ownership:** All data stored locally in SQLite (4 databases)
- **Backup Priority:** `players.db` (critical) > `system.db` (high) > `tournaments.db` (medium) > `cache.db` (none)
- **Migration:** Run `scripts/migrate-to-multi-db.js` to create new database structure
- **Auto Image Optimization:** Flyer uploads are automatically resized (max 1920x1080) and compressed using sharp library - reduces large phone photos from ~4MB to ~140KB (97% reduction)

## Debugging Infrastructure

Comprehensive verbose debugging is available throughout the platform, controlled via environment variables and browser settings.

### Enabling Debug Mode

**Backend (all services):**
```bash
# Set in .env file or environment
DEBUG_MODE=true

# Or start service with debug mode
DEBUG_MODE=true npm start
```

**Frontend (admin dashboard):**
```javascript
// Enable via browser console
localStorage.setItem('debug_mode', 'true');
location.reload();

// Or via URL parameter
https://admin.despairhardware.com/?debug=true

// Disable
localStorage.removeItem('debug_mode');
```

### Log Format

All debug logs follow a consistent format:

**Backend:**
```
[ISO_TIMESTAMP] [SERVICE:ACTION] { context data }
[2025-12-11T10:30:45.123Z] [tournament-db:create] { name: "Weekly", format: "double_elimination" }
```

**Frontend:**
```
%c[FrontendDebug] [SERVICE] ACTION { context }
[FrontendDebug] [Dashboard] Status refresh { modules: 3 }
```

### Service Prefixes

| Service | Prefix | Location |
|---------|--------|----------|
| Admin Dashboard Server | `admin` | server.js |
| Tournament DB | `tournament-db` | services/tournament-db.js |
| Match DB | `match-db` | services/match-db.js |
| Participant DB | `participant-db` | services/participant-db.js |
| Station DB | `station-db` | services/station-db.js |
| Bracket Engine | `bracket-engine` | services/bracket-engine/*.js |
| Match Polling | `match-polling` | services/match-polling.js |
| WebSocket | `websocket` | server.js |
| HTTP Requests | `http` | server.js middleware |
| Match Display | `match-display` | match-display/public/js/*.js |
| Flyer Display | `flyer-display` | flyer-display/public/js/*.js |
| Bracket Display | `bracket-display` | MagicMirror-bracket node_helper.js |
| Signup PWA | `signup` | tournament-signup/server.js |

### Frontend Debug Methods

The `FrontendDebug` utility provides color-coded console output:

| Method | Color | Usage |
|--------|-------|-------|
| `FrontendDebug.log(service, msg, data)` | Green | General logging |
| `FrontendDebug.warn(service, msg, data)` | Orange | Warnings |
| `FrontendDebug.error(service, msg, error)` | Red | Errors |
| `FrontendDebug.api(service, msg, data)` | Blue | API calls |
| `FrontendDebug.ws(service, msg, data)` | Purple | WebSocket events |
| `FrontendDebug.action(service, msg, data)` | Cyan | User actions |

### Debug Commands

```bash
# View debug logs in real-time
sudo journalctl -u control-center-admin -f | grep DEBUG

# Filter by service
sudo journalctl -u control-center-admin -f | grep "tournament-db"

# View bracket engine logs
sudo journalctl -u control-center-admin -f | grep "bracket-engine"

# View WebSocket logs
sudo journalctl -u control-center-admin -f | grep "websocket"

# Check if debug mode is enabled
curl http://localhost:3000/api/status | jq '.debug'
```

### What Gets Logged

**Database Operations:**
- Tournament CRUD (create, read, update, delete)
- Match operations (create, score, advance)
- Participant management (add, seed, check-in)
- Station assignments

**Bracket Engine:**
- Format selection and participant count
- Seeding assignments and BYE placements
- Round generation with match counts
- Prerequisite match linking
- Winners/losers bracket creation (double elim)

**Match Polling:**
- Poll cycle start/end with duration
- Match state changes detected
- WebSocket broadcast confirmations

**HTTP Requests (when DEBUG_MODE=true):**
- Request method, path, query params
- Request body (non-GET)
- Response status and duration

**WebSocket:**
- Connection/disconnection events
- Event broadcasts with payload sizes
- Client registration

## Troubleshooting

```bash
# Check database tables exist
sqlite3 admin-dashboard/tournaments.db ".tables"

# Verify tournament data (tournaments.db)
sqlite3 admin-dashboard/tournaments.db "SELECT id, name, state FROM tcc_tournaments;"

# Check match progression (tournaments.db)
sqlite3 admin-dashboard/tournaments.db "SELECT id, round, state, player1_id, player2_id FROM tcc_matches WHERE tournament_id=1 ORDER BY round, id;"

# Reset tournament (delete matches, keep participants)
sqlite3 admin-dashboard/tournaments.db "DELETE FROM tcc_matches WHERE tournament_id=1; UPDATE tcc_tournaments SET state='pending' WHERE id=1;"

# Check system config (system.db)
sqlite3 admin-dashboard/system.db "SELECT * FROM users;"
sqlite3 admin-dashboard/system.db "SELECT * FROM system_settings;"

# Check player data (players.db)
sqlite3 admin-dashboard/players.db "SELECT * FROM players LIMIT 10;"
```

### Common Participant Route Errors

**404 "Participant not found" when participant exists:**
- Cause: Route using `parseInt(tournamentId)` on a URL slug string returns `NaN`
- Fix: Use `tournamentDb.getById(id) || tournamentDb.getBySlug(id)` pattern, then compare with `tournament.id`

**FOREIGN KEY constraint failed when adding/updating participants:**
- Cause: Passing URL slug string to `participantDb` functions instead of numeric tournament ID
- Fix: Resolve tournament first, then use `tournament.id` for all `participantDb` calls

**"Cannot read properties of null (reading 'replace')" in participant update:**
- Cause: `buildMiscField()` receives `null` from database for `misc` field
- Fix: Ensure `buildMiscField()` handles null: `const misc = existingMisc || ''`

### Tournament Deployment Issues

**Pre-flight checklist shows "Not deployed" even after deploying:**
- Cause: The `tournament-state.json` file doesn't exist or has wrong tournament ID
- The admin dashboard writes this state file during `/api/tournament/setup`
- State file path: `$MATCH_STATE_FILE` env var or default `/root/tcc-custom/admin-dashboard/tournament-state.json`
- Verify: `cat /root/tcc-custom/admin-dashboard/tournament-state.json`
- The `tournamentId` field must match the tournament's `url_slug` (not numeric ID)

### Double Elimination Bracket Errors

**"Cannot read properties of undefined" when starting double elimination tournament:**
- Previously caused by odd participant counts (3, 5, 7, 9, etc.) in the losers bracket
- Root cause was the losers bracket loop not handling odd loser counts properly
- Fixed: BYE placeholder matches are now created when odd number of losers enter any round
- Tested working with participant counts: 3, 5, 6, 7, 9, 11, 13, 15
