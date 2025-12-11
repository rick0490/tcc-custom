# CLAUDE.md - TCC Custom

**Standalone tournament management system with local database storage.** Fork of Tournament Control Center that replaces all Challonge API dependencies with custom bracket generation algorithms and local SQLite storage.

> **Note:** This project is a testing ground for a new implementation approach.

## Key Differences from Original TCC

| Feature | Original TCC | TCC-Custom |
|---------|--------------|------------|
| Tournament Data | Challonge API | Local SQLite |
| Bracket Generation | Challonge | Custom algorithms |
| Rate Limiting | Required (API limits) | Not needed |
| Offline Support | Limited | Full |
| Bracket Display | Challonge iframe | Native canvas rendering |

## Architecture
```
Admin Dashboard (3000) → Controls all displays via REST API + WebSocket
├─ Local SQLite database (analytics.db with tcc_* tables)
├─ Custom bracket generation engine (4 formats)
├─ Direct database queries (no external API)
└─ Socket.IO server for instant updates

MagicMirror Match (8080/2052)  - Live match display, TV 1/TV 2 layout
MagicMirror Bracket (8081/2053) - Native bracket rendering OR Challonge iframe
MagicMirror Flyer (8082/2054)   - Static flyer display
Tournament Signup (3001) - Mobile PWA for registration
Stream Deck Controller (Pi Zero 2 W) - Physical control interface (3×5 keys)
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
| Double Elimination | `services/bracket-engine/double-elimination.js` | Winners + losers bracket, grand finals |
| Round Robin | `services/bracket-engine/round-robin.js` | Circle method scheduling |
| Swiss | `services/bracket-engine/swiss.js` | Score-based pairing, Buchholz tiebreaker |
| Entry Point | `services/bracket-engine/index.js` | Format dispatcher |

### Visualization
| Service | File | Purpose |
|---------|------|---------|
| bracket-renderer | `services/bracket-renderer.js` | Generates visualization data for all formats |

## Database Schema

Located in `analytics-db.js`, tables prefixed with `tcc_`:

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
    state TEXT DEFAULT 'pending' CHECK(state IN ('pending','open','complete')),
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
getByState(tournamentId, state)      // Filter by state
getOpenMatches(tournamentId)         // Get open (playable) matches
setWinner(id, winnerId, scores)      // Score match, advance bracket
setStation(id, stationId)            // Assign to station
updateState(id, state)               // Manual state change
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

### Iframe Mode (legacy/Challonge)
```javascript
config: {
    renderMode: "iframe",  // Use Challonge embed
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
sudo systemctl restart control-center-admin magic-mirror-match magic-mirror-bracket magic-mirror-flyer

# View logs
sudo journalctl -u control-center-admin -f

# Database inspection
sqlite3 admin-dashboard/analytics.db "SELECT * FROM tcc_tournaments;"
sqlite3 admin-dashboard/analytics.db "SELECT * FROM tcc_matches WHERE tournament_id=1;"
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
│   ├── analytics-db.js (includes tcc_* tables)
│   ├── services/
│   │   ├── tournament-db.js      # NEW
│   │   ├── match-db.js           # NEW
│   │   ├── participant-db.js     # NEW
│   │   ├── bracket-engine/       # NEW
│   │   │   ├── index.js
│   │   │   ├── single-elimination.js
│   │   │   ├── double-elimination.js
│   │   │   ├── round-robin.js
│   │   │   └── swiss.js
│   │   ├── bracket-renderer.js   # NEW
│   │   ├── match-polling.js      # MODIFIED (local DB)
│   │   └── ai-seeding.js         # MODIFIED (local DB)
│   └── routes/
│       ├── tournaments.js        # MODIFIED (local DB)
│       ├── matches.js            # MODIFIED (local DB + progression)
│       └── participants.js       # MODIFIED (local DB)
├── MagicMirror-bracket/
│   └── modules/MMM-BracketView/
│       └── MMM-BracketView.js    # MODIFIED (native rendering)
├── MagicMirror-match/
├── MagicMirror-flyer/
├── tournament-signup/
└── stream-deck-controller/
```

## Unchanged Components

These work identically to original TCC:
- Stream Deck controller
- MagicMirror Match display
- MagicMirror Flyer display
- Tournament Signup PWA
- Analytics/Elo system
- Sponsor overlays
- Ticker messages
- DQ timers
- Display management
- Authentication system

## Important Notes

- **Offline Operation:** Works completely offline once set up
- **No API Keys:** No Challonge credentials needed
- **Faster Updates:** 5-second polling vs 15-second (no rate limits)
- **Data Ownership:** All data stored locally in SQLite
- **Backup:** Simply backup `analytics.db` file
- **Migration:** Can import from Challonge via CSV export (manual process)

## Troubleshooting

```bash
# Check database tables exist
sqlite3 admin-dashboard/analytics.db ".tables" | grep tcc_

# Verify tournament data
sqlite3 admin-dashboard/analytics.db "SELECT id, name, state FROM tcc_tournaments;"

# Check match progression
sqlite3 admin-dashboard/analytics.db "SELECT id, round, state, player1_id, player2_id FROM tcc_matches WHERE tournament_id=1 ORDER BY round, id;"

# Reset tournament (delete matches, keep participants)
sqlite3 admin-dashboard/analytics.db "DELETE FROM tcc_matches WHERE tournament_id=1; UPDATE tcc_tournaments SET state='pending' WHERE id=1;"
```
