## System Information

| Hostname | tcc-custom | OS | Debian 13 (Proxmox) | RAM | 2GB | Disk | 32GB |

## Upcoming Migration

> **bracketspot.com** acquired. Migration to VPS by **Jan 5, 2026**. See [VPS_MIGRATION.md](VPS_MIGRATION.md).

---

# CLAUDE.md - TCC Custom

**Standalone tournament management with local SQLite storage.** Fork replacing Challonge API with custom bracket algorithms.

| Feature | Original TCC | TCC-Custom |
|---------|--------------|------------|
| Tournament Data | Challonge API | Local SQLite |
| Bracket Generation | Challonge | Custom algorithms |
| Rate Limiting | Required | Not needed |
| Offline Support | Limited | Full |

## Coding Standards

**Review before writing code:**
- **[CODING_STYLE.md](CODING_STYLE.md)** - Naming (frontend camelCase, DB snake_case), API transforms
- **[STYLE_GUIDE.md](STYLE_GUIDE.md)** - Colors, typography, spacing (4px base), WCAG 2.1 AA
- **[MONETIZATION.md](MONETIZATION.md)** - SaaS tiers, sponsor system
- **[ROADMAP.md](ROADMAP.md)** - Market-focused implementation phases (8 phases, prioritized for launch)
- **[COMPLETED_IMPROVEMENTS.txt](COMPLETED_IMPROVEMENTS.txt)** / **[FUTURE_IMPROVEMENTS.txt](FUTURE_IMPROVEMENTS.txt)** - Progress

## Architecture

```
Admin Dashboard (3000) → Controls all displays via REST + WebSocket
├─ 4 SQLite databases (tournaments, players, system, cache)
├─ Custom bracket engine (7 formats)
└─ Socket.IO for instant updates

Match Display (2052)    - TV 1/TV 2 layout, timers, podium
Bracket Display (2053)  - Native canvas, 5 themes
Flyer Display (2054)    - Fullscreen image/video, media controls
Tournament Signup (3001) - Mobile PWA
Stream Deck Controller   - Pi Zero 2 W
```

## Database Architecture

| Database | Purpose | Backup Priority |
|----------|---------|-----------------|
| **tournaments.db** | Active tournament state (tcc_* tables) | Medium |
| **players.db** | Player history, Elo ratings | **Critical** |
| **system.db** | Config, auth, games, displays | High |
| **cache.db** | API response cache | None |

**Modules (`db/`):** `tournaments-db.js`, `players-db.js`, `system-db.js`, `cache-db.js`, `index.js`

**Cross-DB References:** App-level linking (SQLite lacks cross-DB FKs)
- `tcc_tournaments.game_id` → `system.db games.id`
- `tcc_participants.player_id` → `players.db players.id`

```bash
# Critical backup
cp admin-dashboard/players.db backups/players-$(date +%Y%m%d).db

# Full backup
for db in tournaments players system; do cp admin-dashboard/${db}.db backups/${db}-$(date +%Y%m%d).db; done
```

## Bracket Engine (`services/bracket-engine/`)

| Format | File | Description |
|--------|------|-------------|
| Single Elimination | `single-elimination.js` | Standard seeding (1v16, 8v9), BYE distribution |
| Double Elimination | `double-elimination.js` | Winners + losers bracket, grand finals, BYE for odd counts |
| Round Robin | `round-robin.js` | Circle method scheduling |
| Swiss | `swiss.js` | Score-based pairing, Buchholz tiebreaker |
| Two-Stage | `two-stage.js` | Group stage → knockout (FIFA World Cup style) |
| Free-for-All | `free-for-all.js` | Multi-player matches with placement points |
| Leaderboard | `leaderboard.js` | Ongoing rankings across events |

**Double Elim BYE:** Creates BYE matches when odd losers enter any round. Tested: 3,5,6,7,9,11,13,15 participants.

**Format Options:**
- **Two-Stage:** `group_count` (2-8), `advance_per_group` (1-4), `knockout_format` (single/double)
- **Free-for-All:** `players_per_match` (4-16), `total_rounds` (1-10), `points_system_json`
- **Leaderboard:** `format_settings_json` with `rankingType`, `decayEnabled`, `minEventsToRank`

## Database Schema

Schema in `db/tournaments-db.js`. Tables prefixed with `tcc_`:

### Core Tables

**tcc_tournaments:**
- `id`, `name`, `url_slug` (unique), `game_id`, `tournament_type`, `state`
- `signup_cap`, `check_in_duration`, `starts_at`, `started_at`, `completed_at`
- `hold_third_place_match`, `grand_finals_modifier`, `swiss_rounds`
- `hide_seeds`, `sequential_pairings`, `format_settings_json`
- Two-Stage: `group_count`, `advance_per_group`, `knockout_format`, `current_stage`
- Free-for-All: `players_per_match`, `total_rounds`, `points_system_json`

**tcc_participants:**
- `id`, `tournament_id`, `player_id`, `name`, `display_name`, `email`
- `seed`, `active`, `checked_in`, `checked_in_at`, `final_rank`
- `on_waiting_list`, `group_id`, `group_seed`, `misc`, `instagram`

**tcc_matches:**
- `id`, `tournament_id`, `identifier`, `round`, `group_id`
- `suggested_play_order`, `player1_id`, `player2_id`
- `player1_prereq_match_id`, `player2_prereq_match_id`
- `player1_is_prereq_loser`, `player2_is_prereq_loser`
- `state` (pending/open/underway/complete)
- `winner_id`, `loser_id`, `player1_score`, `player2_score`, `scores_csv`
- `station_id`, `underway_at`, `completed_at`

**tcc_stations:** `id`, `tournament_id`, `name`, `active`, `current_match_id`

**tcc_standings:** `tournament_id`, `participant_id`, `group_id`, `wins`, `losses`, `ties`, `game_wins`, `game_losses`, `points_scored`, `points_against`, `buchholz`, `rank`

### Format-Specific Tables

- **tcc_ffa_placements:** `match_id`, `participant_id`, `placement`, `points_awarded`
- **tcc_leaderboard_events:** `tournament_id`, `event_name`, `event_date`, `is_complete`
- **tcc_leaderboard_results:** `event_id`, `participant_id`, `placement`, `points_awarded`
- **tcc_waitlist:** `tournament_id`, `name`, `email`, `phone`, `position`, `status`

**Tournament Types:** `single_elimination`, `double_elimination`, `round_robin`, `swiss`, `two_stage`, `free_for_all`, `leaderboard`

**Match States:** `pending` → `open` → `underway` → `complete`

## Match Lifecycle

| State | Description | Timestamp |
|-------|-------------|-----------|
| pending | Waiting for players | - |
| open | Both players assigned | - |
| underway | In progress | `underway_at` set |
| complete | Finished | `completed_at` set |

| API Call | Transition | Timestamp |
|----------|------------|-----------|
| `markUnderway()` | open → underway | Sets `underway_at` |
| `unmarkUnderway()` | underway → open | Clears `underway_at` |
| `setWinner()`/`setForfeit()` | → complete | Keeps `underway_at`, sets `completed_at` |
| `reopen()` | complete → open | Clears both |

**Analytics:** `completed_at - underway_at` = match duration

### Bracket Progression (match-db.js)

After `setWinner()`:
1. Find matches where this match is a prerequisite
2. Assign winner to player1/player2 slot based on prereq config
3. If loser bracket (double elim), assign loser to appropriate match
4. When both players assigned, set match state to 'open'
5. Broadcast update via WebSocket

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
create(tournamentId, data)
bulkCreate(tournamentId, matches)
getById(id)
getByTournament(tournamentId)
getByState(tournamentId, state)
getOpenMatches(tournamentId)
markUnderway(id)                     // state='underway', underway_at=NOW()
unmarkUnderway(id)                   // state='open', clear underway_at
setWinner(id, winnerId, scores)      // state='complete', keeps underway_at
setForfeit(id, forfeitedId)
reopen(id)                           // state='open', clear both timestamps
setStation(id, stationId)
getStats(tournamentId)
getWaitingForPrereq(tournamentId, prereqId)
```

### participant-db.js
```javascript
create(tournamentId, data)
bulkCreate(tournamentId, list)
getById(id)
getByTournament(tournamentId)
update(id, data)
updateSeed(id, seed)
randomizeSeeds(tournamentId)
checkIn(id)
undoCheckIn(id)
delete(id)
clearAll(tournamentId)
applyEloSeeding(tournamentId, gameId)
```

**Important:** `tournamentId` must be numeric DB ID. Resolve slugs first:
```javascript
const tournament = tournamentDb.getById(id) || tournamentDb.getBySlug(id);
participantDb.create(tournament.id, data);  // Use tournament.id, not tournamentId
```

### bracket-engine/index.js
```javascript
generateBracket(tournament, participants)  // Generate matches for format
validateBracket(tournament, matches)       // Verify bracket integrity
advanceWinner(match, winnerId, loserId)    // Calculate next match
```

### discord-notify.js
```javascript
sendTournamentStarted(tournament)         // Discord embed on tournament start
sendMatchCalled(match, participants)      // Notify players their match is ready
sendTournamentResults(tournament, results) // Post final standings
sendCustomAnnouncement(message)           // Custom message to configured channel
```

**Discord Bot Slash Commands (discord-bot/):**
- `/tournament-status` - Show current tournament status embed
- `/bracket` - Post bracket link to channel
- `/results` - Post tournament results
- `/announce <message>` - Send custom announcement

### error-handler.js
```javascript
ValidationError(message, details)          // Input validation failures
NotFoundError(resource, id)                // Resource not found
ConflictError(message)                     // Resource state conflicts
createErrorMiddleware()                    // Express error middleware
wrapAsync(fn)                              // Async route wrapper
```

**Error Response Format:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "User-friendly message",
    "details": {}
  }
}
```

## WebSocket Broadcasting

| Route | Function | Events |
|-------|----------|--------|
| tournaments.js | `broadcastTournament()` | `tournament:created/updated/deleted/started/reset/completed` |
| participants.js | `broadcastParticipant()` | `participant:added/updated/deleted/checkin` |
| matches.js | `broadcastMatchUpdate()` | `matches:update` |
| flyers.js | `broadcastFlyer()` | `flyer:uploaded/deleted/activated` |
| server.js | Direct `io.emit()` | `display:registered/heartbeat` |

**Frontend (utils.js):** `WS_EVENTS` constants, `WebSocketManager` singleton, adaptive polling

## API Endpoints

### Bracket APIs
```
GET  /api/bracket/data/:tournamentId      // Full bracket visualization data
POST /api/bracket/render/:tournamentId    // Trigger re-render

# Bracket Editor (seed management before tournament starts)
POST /api/bracket-editor/preview/:tournamentId
POST /api/bracket-editor/apply-seeds/:tournamentId
GET  /api/bracket-editor/status/:tournamentId
```

### Emergency APIs
```
GET  /api/emergency/status
POST /api/emergency/activate     {reason}
POST /api/emergency/deactivate
GET  /api/matches/:id/history
POST /api/matches/:id/undo
```

### Removed from Original
- `GET /api/rate-limit/*` - No rate limiting needed
- OAuth/token management endpoints

## Display Services

All displays: Express + EJS, WebSocket to admin (direct IP `192.168.1.28:3000` due to Nginx WS issues), multi-tenant isolation via rooms (`user:${userId}`, `user:${userId}:${type}`).

### Match Display (2052) `/u/:userId/match`

- TV1/TV2 quadrant layout (60% top, 40% "Up Next")
- State colors: pending (white), next-up (orange), underway (red pulse), complete (green)
- Winner display: 4-second hold + fade animation
- Ticker announcements (red gradient banner)
- Per-TV DQ timers with warning states
- Tournament-wide timer
- QR code fullscreen overlay
- Sponsor overlays (6 positions)
- Audio TTS announcements
- Podium mode (1st/2nd/3rd when complete)

**Up Next Sorting:** round → suggested_play_order → identifier (excludes TBD vs TBD)

### Bracket Display (2053) `/u/:userId/bracket`

- Native canvas rendering (no iframes)
- All 7 formats supported
- 5 themes: Midnight, Arctic, Neon, Royal, Forest
- Pan/zoom with mouse and touch
- Sponsor overlay system (6 positions)

### Flyer Display (2054) `/u/:userId/flyer`

- Fullscreen image/video (MP4), object-fit: contain
- **Remote media controls:** play/pause/restart, volume 0-100%, mute/unmute
- **Playlist mode:** queue management, auto-advance, drag-drop reorder
- Status reporting to admin dashboard
- Fallback to default flyer on error
- Cache-busting for Cloudflare CDN

**Flyer Media Settings (system.db `flyer_media_settings`):**
- `loop_enabled`, `autoplay_enabled`, `default_muted`, `default_volume`
- `playlist_enabled`, `playlist_loop`, `playlist_auto_advance`, `playlist_items_json`
- `playback_state`, `current_time`, `duration`, `is_muted`, `current_volume`

**Flyer APIs:**
```
GET  /api/displays/flyer/settings
PUT  /api/displays/flyer/settings
POST /api/displays/flyer/control          // play/pause/restart/mute/unmute
POST /api/displays/flyer/volume           // 0-100
GET  /api/displays/flyer/playlist
PUT  /api/displays/flyer/playlist
POST /api/displays/flyer/playlist/control // skip/goto/toggle
POST /api/displays/flyer/status           // Status from display (no auth)
```

**Flyer Events:** `flyer:control`, `flyer:volume`, `flyer:settings`, `flyer:playlist`, `flyer:status`

## Emergency Controls (Panic Mode)

| Control | Shortcut | Action |
|---------|----------|--------|
| STOP (red) | P | Activate - displays show "Technical Difficulties" |
| Resume (amber) | P | Deactivate |
| Undo | Z | Rollback last match |
| Reboot TVs | - | Queue reboot for all Pi displays |

**Display Overlays:** Full-screen black (z-index 100000), pulsing icon, "Technical Difficulties"
- Match Display: Red (#ff2e2e)
- Bracket Display: Blue (#3b82f6)
- Flyer Display: Purple (#8b5cf6)

**Server State (server.js):**
```javascript
emergencyModeState = { active, activatedAt, activatedBy, reason };
matchHistory = new Map(); // tournamentId -> [{matchId, previousState, action, user, timestamp}]
```

## Commands

```bash
# Development
cd /root/tcc-custom/admin-dashboard && npm run dev

# Start all services
sudo systemctl restart control-center-admin control-center-signup match-display bracket-display flyer-display

# View logs
sudo journalctl -u control-center-admin -f

# Check status
sudo systemctl status control-center-admin control-center-signup match-display bracket-display flyer-display

# Database inspection
sqlite3 admin-dashboard/tournaments.db "SELECT * FROM tcc_tournaments;"
sqlite3 admin-dashboard/tournaments.db "SELECT * FROM tcc_matches WHERE tournament_id=1;"
```

## Tournament Flow

1. **Create:** `POST /api/tournaments/create` → generates url_slug, state=`pending`
2. **Add Participants:** `POST /api/participants/:tournamentId` or bulk, assign seeds
3. **Start:** `POST /api/tournament/:tournamentId/start` → generates matches, state=`underway`
4. **Score:** `POST /api/matches/:tournamentId/:matchId/score` → auto-advances
5. **Complete:** `POST /api/tournament/:tournamentId/complete` → rankings, Elo updated

## Platform Admin (Superadmin Only)

Requires `role === 'admin' && userId === 1`

| Tab | Purpose |
|-----|---------|
| Users | Manage, impersonate, subscription control |
| Invite Keys | Create/manage (single, multi, unlimited) |
| Tournaments | Browse all tenants |
| Audit Log | Filter, CSV export |
| Database | Backup, vacuum, clear cache |
| Announcements | System-wide banners (alert/warning/info) |
| Settings | Maintenance mode, signup control |

**Announcements (system.db `platform_announcements`):** `message`, `type` (info/warning/alert), `is_active`, `expires_at`

## Directory Structure

```
/root/tcc-custom/
├── admin-dashboard/
│   ├── server.js
│   ├── *.db (tournaments, players, system, cache)
│   ├── db/ (tournaments-db, players-db, system-db, cache-db, index)
│   ├── services/
│   │   ├── tournament-db.js, match-db.js, participant-db.js, station-db.js
│   │   ├── bracket-engine/ (index, single/double-elim, round-robin, swiss, two-stage, ffa, leaderboard)
│   │   ├── discord-bot/, discord-notify.js, error-handler.js
│   │   ├── bracket-renderer.js, match-polling.js, ai-seeding.js, backup-scheduler.js
│   └── routes/ (tournaments, matches, participants, flyers, displays, bracket-editor, platform, discord-bot)
├── match-display/ (2052)
│   ├── server.js, views/match-display.ejs
│   └── public/js/ (match-display, websocket-client, timer-manager, overlay-manager, podium-display)
├── bracket-display/ (2053)
│   ├── server.js, views/bracket-display.ejs
│   └── public/js/ (bracket-display, websocket-client, bracket-renderer, sponsor-overlay)
├── flyer-display/ (2054)
│   ├── server.js, views/flyer-display.ejs
│   └── public/js/ (flyer-display, websocket-client)
├── tournament-signup/ (3001)
└── stream-deck-controller/
```

## Debugging

**Enable:** `DEBUG_MODE=true` (env) or `localStorage.setItem('debug_mode', 'true')` (browser)

**Format:** `[ISO_TIMESTAMP] [SERVICE:ACTION] { context }`

**Prefixes:** `admin`, `tournament-db`, `match-db`, `participant-db`, `station-db`, `bracket-engine`, `match-polling`, `websocket`, `http`

**Frontend:** `FrontendDebug.log/warn/error/api/ws/action(service, msg, data)`

```bash
# View debug logs
sudo journalctl -u control-center-admin -f | grep "bracket-engine"
sudo journalctl -u control-center-admin -f | grep "websocket"
```

## Troubleshooting

```bash
# Check tables
sqlite3 admin-dashboard/tournaments.db ".tables"

# Verify data
sqlite3 admin-dashboard/tournaments.db "SELECT id, name, state FROM tcc_tournaments;"
sqlite3 admin-dashboard/system.db "SELECT * FROM users;"

# Reset tournament (delete matches, keep participants)
sqlite3 admin-dashboard/tournaments.db "DELETE FROM tcc_matches WHERE tournament_id=1; UPDATE tcc_tournaments SET state='pending' WHERE id=1;"
```

### Common Errors

**404 "Participant not found" when participant exists:**
- Cause: `parseInt(tournamentId)` on URL slug → `NaN`
- Fix: Use `tournamentDb.getById(id) || tournamentDb.getBySlug(id)`, compare with `tournament.id`

**FOREIGN KEY constraint failed:**
- Cause: Passing slug string to `participantDb` instead of numeric ID
- Fix: Resolve tournament first, use `tournament.id`

**"Cannot read properties of null" in participant update:**
- Cause: `buildMiscField()` receives `null`
- Fix: `const misc = existingMisc || ''`

**"Not deployed" in preflight:**
- Cause: `tournament-state.json` missing or wrong tournament ID
- Fix: Verify `cat tournament-state.json`, `tournamentId` must match `url_slug`

**Double elim "undefined" error:**
- Previously broken for odd counts (3,5,7,9)
- Fixed: BYE placeholder matches in losers bracket

## Unchanged Components

Work identically to original TCC:
- Stream Deck controller
- Tournament Signup PWA
- Analytics/Elo system
- Sponsor overlays, ticker messages, DQ timers
- Display management, authentication

## Important Notes

- **Offline:** Works fully offline
- **No API Keys:** No Challonge credentials needed
- **5s Polling:** Faster than 15s (no rate limits)
- **Backup Priority:** players.db > system.db > tournaments.db > cache.db
- **Auto Image Optimization:** Flyer uploads resized (1920x1080) via sharp (~97% reduction)
