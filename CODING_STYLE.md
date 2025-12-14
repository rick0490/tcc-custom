# Coding Style Guide - TCC Custom Admin Dashboard

This document standardizes naming conventions and code patterns across the tcc-custom project.

## Naming Conventions by Layer

| Layer | Convention | Example |
|-------|------------|---------|
| Frontend (JavaScript) | camelCase | `tournamentType`, `gameName`, `startAt` |
| Backend API (Express routes) | Accept camelCase from frontend | `req.body.gameName` |
| Database (SQLite) | snake_case | `tournament_type`, `game_name`, `starts_at` |
| API Response | camelCase (via transform function) | `transformTournament()` returns camelCase |

## Field Name Mapping Reference

| Frontend (camelCase) | Database (snake_case) |
|---------------------|----------------------|
| `gameName` | `game_name` |
| `tournamentType` | `tournament_type` |
| `startAt` | `starts_at` |
| `checkInDuration` | `check_in_duration` |
| `signupCap` | `signup_cap` |
| `openSignup` | `open_signup` |
| `holdThirdPlaceMatch` | `hold_third_place_match` |
| `grandFinalsModifier` | `grand_finals_modifier` |
| `swissRounds` | `swiss_rounds` |
| `rankedBy` | `ranked_by` |
| `hideSeeds` | `hide_seeds` |
| `sequentialPairings` | `sequential_pairings` |
| `showRounds` | `show_rounds` |
| `autoAssign` | `auto_assign` |

## API Request Handling Pattern

Backend routes should:
1. Destructure camelCase from `req.body`
2. Map to snake_case when calling database services

```javascript
// CORRECT PATTERN
router.post('/create', async (req, res) => {
    // Frontend sends camelCase
    const { gameName, tournamentType, startAt } = req.body;

    // Map to snake_case for database
    const tournament = tournamentDb.create({
        game_name: gameName,
        tournament_type: tournamentType || 'double_elimination',
        starts_at: startAt
    });
});
```

```javascript
// INCORRECT PATTERN - DO NOT DO THIS
router.post('/create', async (req, res) => {
    // This expects snake_case but frontend sends camelCase!
    const { game_name, tournament_type, starts_at } = req.body;
    // All values will be undefined because frontend uses camelCase
});
```

## API Response Transformation Pattern

All database records should be transformed to camelCase before returning to frontend:

```javascript
function transformTournament(dbRecord) {
    return {
        id: dbRecord.id,
        tournamentId: dbRecord.url_slug,
        name: dbRecord.name,
        tournamentType: dbRecord.tournament_type,   // snake_case -> camelCase
        game: dbRecord.game_name,                   // snake_case -> camelCase
        state: dbRecord.state,
        startAt: dbRecord.starts_at,                // snake_case -> camelCase
        checkInDuration: dbRecord.check_in_duration,
        signupCap: dbRecord.signup_cap,
        openSignup: !!dbRecord.open_signup,
        holdThirdPlaceMatch: !!dbRecord.hold_third_place_match,
        grandFinalsModifier: dbRecord.grand_finals_modifier,
        sequentialPairings: !!dbRecord.sequential_pairings,
        showRounds: !!dbRecord.show_rounds,
        swissRounds: dbRecord.swiss_rounds,
        rankedBy: dbRecord.ranked_by,
        hideSeeds: !!dbRecord.hide_seeds,
        source: 'local'
    };
}
```

## Additional Standards

### JavaScript Variables
- **Variables:** camelCase (`matchData`, `tournamentId`, `participantList`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_PARTICIPANTS`, `API_TIMEOUT`, `POLL_INTERVAL`)
- **Boolean variables:** Use `is`, `has`, `can` prefixes (`isActive`, `hasCheckedIn`, `canStart`)

### CSS Classes
- **Class names:** kebab-case (`match-card`, `tournament-list`, `status-indicator`)
- **Modifier classes:** Use `--` suffix (`match-card--active`, `status-indicator--online`)

## Font System

### Font Stack

The project uses three Google Fonts across all services:

| Purpose | Font | CSS Variable | Weights |
|---------|------|--------------|---------|
| **Primary** | Inter | `--font-primary` | 400, 500, 600, 700, 800, 900 |
| **Display** | Oswald | `--font-display` | 500, 600, 700 |
| **Monospace** | JetBrains Mono | `--font-mono` | 500, 700 |

### Font Usage by Context

| Context | Font | Reason |
|---------|------|--------|
| Body text, UI elements | Inter | Screen-optimized, highly readable |
| Player names, TV labels | Oswald | Tall x-height, visible from 30ft |
| Timers, scores, code | JetBrains Mono | Fixed-width, clear 0/O distinction |

### CSS Variables (All Services)

Add to `:root` in all CSS files:

```css
:root {
  --font-primary: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-display: 'Oswald', 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', 'Courier New', monospace;
}
```

**Note:** MagicMirror instances use `--font-primary` and `--font-secondary` (Inter maps to secondary for UI).

### Google Fonts Import

Add to `<head>` in all HTML files:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Oswald:wght@500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
```

### Font Sizes for 30-Foot Viewing (Tournament Displays)

Based on "1 inch per 10 feet" rule for readability:

| Element | CSS Size | Approx Height |
|---------|----------|---------------|
| TV Labels ("TV 1", "TV 2") | `5vw` / `96px` | ~4-5 inches |
| Player Names | `4vw` / `72px` | ~3-4 inches |
| "Now Playing" subtitle | `2.8vw` / `48px` | ~2-2.5 inches |
| Ticker messages | `5vw` / `96px` | ~4-5 inches |
| Timer countdown | `4vw` / `72px` | ~3-4 inches |
| Status badges | `2vw` / `36px` | ~1.5 inches |

### Font Sizes for Admin Dashboard (Laptop/Tablet)

| Element | Size | Tailwind/CSS |
|---------|------|--------------|
| Page headings | 24-30px | `text-2xl` to `text-3xl` |
| Section headers | 18-20px | `text-lg` to `text-xl` |
| Body text | 14-16px | `text-sm` to `text-base` |
| Small text/labels | 12-13px | `text-xs` |
| Input fields | 16px | `text-base` (prevents iOS zoom) |

### Font Weight Guidelines

| Purpose | Font | Weight | CSS |
|---------|------|--------|-----|
| Body text | Inter | Regular | `font-weight: 400` |
| Emphasis | Inter | Medium | `font-weight: 500` |
| Headings | Inter | Semibold | `font-weight: 600` |
| Important UI | Inter | Bold | `font-weight: 700` |
| Display text (TV) | Oswald | Bold | `font-weight: 700` |
| Player names (TV) | Oswald | Extrabold | `font-weight: 800` |
| Timers/scores | JetBrains Mono | Medium | `font-weight: 500` |

### File Names
- **JavaScript files:** kebab-case (`tournament-db.js`, `match-polling.js`, `bracket-engine.js`)
- **Routes:** kebab-case, singular (`tournaments.js`, `matches.js`, `participants.js`)
- **Services:** kebab-case (`ai-seeding.js`, `sponsor.js`, `dq-timer.js`)

### Database Tables
- **Table names:** snake_case with `tcc_` prefix (`tcc_tournaments`, `tcc_matches`, `tcc_participants`)
- **Column names:** snake_case (`tournament_id`, `player1_id`, `created_at`)
- **Foreign keys:** Use `_id` suffix (`tournament_id`, `player_id`, `station_id`)
- **Timestamps:** Use `_at` suffix (`created_at`, `updated_at`, `completed_at`)
- **Booleans:** No prefix, stored as INTEGER 0/1 (`active`, `checked_in`, `hide_seeds`)

## Common Pitfalls

### 1. Field Name Mismatch (The Bug This Guide Prevents)

```javascript
// BUG: Backend expects snake_case but frontend sends camelCase
const { game_name, tournament_type } = req.body;
// Result: game_name = undefined, tournament_type = undefined (uses default)

// FIX: Accept camelCase from frontend
const { gameName, tournamentType } = req.body;
db.create({ game_name: gameName, tournament_type: tournamentType });
```

### 2. Missing Boolean Coercion

```javascript
// BUG: Boolean may come as string "true" or undefined
const tournament = db.create({
    open_signup: open_signup  // Could be "true" (string) or undefined
});

// FIX: Always coerce booleans
const tournament = db.create({
    open_signup: !!openSignup  // Converts to true boolean
});
```

### 3. Forgetting to Transform Response

```javascript
// BUG: Returns snake_case directly from database
res.json({ success: true, tournament: dbRecord });
// Frontend receives: { tournament_type: "double_elimination" }

// FIX: Transform before returning
res.json({ success: true, tournament: transformTournament(dbRecord) });
// Frontend receives: { tournamentType: "double_elimination" }
```

## Existing Transform Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `transformTournament()` | `routes/tournaments.js:682` | Transform tournament DB record |
| `transformMatch()` | `routes/matches.js` | Transform match DB record |
| `transformParticipant()` | `routes/participants.js` | Transform participant DB record |

## Data Flow Summary

```
Frontend (camelCase)
    ↓
    POST /api/tournaments/create
    { tournamentType: "single elimination", gameName: "Halo 3" }
    ↓
Backend Route (accepts camelCase, maps to snake_case)
    const { tournamentType, gameName } = req.body;
    db.create({ tournament_type: tournamentType, game_name: gameName })
    ↓
Database (snake_case)
    INSERT INTO tcc_tournaments (tournament_type, game_name) VALUES (...)
    ↓
Backend Response (transform to camelCase)
    res.json({ tournament: transformTournament(dbRecord) })
    ↓
Frontend (camelCase)
    { tournamentType: "single_elimination", game: "Halo 3" }
```

## WebSocket Data Standards

### Rule: All WebSocket broadcasts MUST use camelCase (transformed data)

WebSocket events are an extension of the API - they should use the same camelCase format as HTTP responses.

```javascript
// CORRECT: Use transform function for WebSocket broadcasts
function broadcastMatchUpdate(tournamentId, data) {
    const matches = matchDb.getByTournament(tournamentId);
    io.emit('matches:update', {
        tournamentId,
        matches: matches.map(m => transformMatch(m))  // camelCase
    });
}

// INCORRECT: Sending raw database format
function broadcastMatchUpdate(tournamentId, data) {
    const matches = matchDb.getByTournament(tournamentId);
    io.emit('matches:update', {
        tournamentId,
        matches: matches  // snake_case - WRONG!
    });
}
```

### Cache Data Standards

Cached data should store **transformed (camelCase)** data, not raw database records:

```javascript
// CORRECT: Cache transformed data
const payload = {
    matches: matches.map(m => transformMatch(m)),  // camelCase
    timestamp: new Date().toISOString()
};
saveMatchDataCache(tournamentId, payload);

// INCORRECT: Cache raw database data
const payload = {
    matches: matches,  // snake_case from DB - causes format inconsistency
    timestamp: new Date().toISOString()
};
```

### Single Source of Truth

Each entity type should have ONE transform function used everywhere:

| Entity | Transform Function | Used In |
|--------|-------------------|---------|
| Tournament | `transformTournament()` | HTTP responses, WebSocket, cache |
| Match | `transformMatch()` | HTTP responses, WebSocket, cache |
| Participant | `transformParticipant()` | HTTP responses, WebSocket, cache |

### Common WebSocket Pitfall

```javascript
// BUG: Multiple data sources with different formats
// Route broadcasts use transformMatch() → camelCase
// Cache uses raw DB data → snake_case
// Frontend receives BOTH formats for same event!

// FIX: Ensure ALL sources of 'matches:update' use transformMatch()
```

### Frontend WebSocket Handlers

Frontend code receiving WebSocket events should expect camelCase (same as HTTP):

```javascript
// CORRECT: Expect camelCase from WebSocket (same as HTTP API)
socket.on('matches:update', (data) => {
    const matches = data.matches.map(m => ({
        id: m.id,
        state: m.state,
        player1Name: m.player1Name,  // camelCase
        stationName: m.stationName   // camelCase
    }));
});

// INCORRECT: Handling multiple formats (indicates backend inconsistency)
socket.on('matches:update', (data) => {
    const matches = data.matches.map(m => ({
        player1Name: m.player1Name ?? m.player1_name,  // Dual format = code smell
        stationName: m.stationName ?? m.station_name   // Fix the backend instead!
    }));
});
```

## Quick Reference

When adding a new field:

1. **Add to frontend form** (camelCase): `newFieldName`
2. **Add to route destructuring** (camelCase): `const { newFieldName } = req.body`
3. **Map in db.create()** (snake_case): `new_field_name: newFieldName`
4. **Add to database schema** (snake_case): `new_field_name TEXT`
5. **Add to transform function** (camelCase output): `newFieldName: dbRecord.new_field_name`
6. **WebSocket broadcasts**: Use the same transform function (camelCase output)
