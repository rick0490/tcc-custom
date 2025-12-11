# Challonge API v2.1 Complete Reference

**CRITICAL: All operations should use v2.1. Do NOT use v1 endpoints as Challonge v1 API is being deprecated.**

**Known v2.1 Issues (as of Dec 2025):**
- `PUT /matches/{id}/change_state.json` returns 500 Internal Server Error consistently
- **Workaround:** Local underway tracking in server.js - matches are tracked locally when v2.1 fails
  - `localUnderwayTracking` Map stores `tournamentId:matchId` -> ISO timestamp
  - GET /api/matches merges local tracking into match data
  - Match completion (winner declared) clears local tracking
  - No v1 fallback used (v1 API is deprecated)

## Table of Contents
1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Tournament Endpoints](#tournament-endpoints)
4. [Match Endpoints](#match-endpoints)
5. [Participant Endpoints](#participant-endpoints)
6. [Schema Reference](#schema-reference)
7. [Tournament States](#tournament-states)
8. [Field Mapping (v1 to v2.1)](#field-mapping-v1-to-v21)
9. [Error Handling](#error-handling)
10. [Implementation Constraints](#implementation-constraints)

---

## Overview

### Base URL
```
https://api.challonge.com/v2.1
```

### Required Headers (All Requests)
```javascript
{
  'Content-Type': 'application/vnd.api+json',
  'Accept': 'application/json',
  'Authorization-Type': 'v2',  // or 'v1' for legacy API key
  'Authorization': 'Bearer <access_token>'  // or '<api_key>' for v1
}
```

### JSON:API Format
All request/response bodies follow JSON:API specification:
```javascript
{
  "data": {
    "type": "ResourceType",
    "attributes": { /* fields */ }
  }
}
```

---

## Authentication

### OAuth 2.0 (Recommended)
```javascript
// Headers for OAuth Bearer token
{
  'Authorization': 'Bearer <access_token>',
  'Authorization-Type': 'v2',  // REQUIRED for OAuth
  'Content-Type': 'application/vnd.api+json',
  'Accept': 'application/json'
}
```

### Legacy API Key (Fallback)
```javascript
// Headers for API key
{
  'Authorization': '<api_key>',
  'Authorization-Type': 'v1',  // REQUIRED for API key
  'Content-Type': 'application/vnd.api+json',
  'Accept': 'application/json'
}
```

### OAuth Token Endpoints

#### Token Request
```
POST /oauth/token
```
Query Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| code | Yes | Authorization code from OAuth callback |
| client_id | Yes | Application client ID |
| grant_type | Yes | `authorization_code` |
| redirect_uri | Yes | Application redirect URI |

Response:
```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 604800,
  "refresh_token": "...",
  "scope": "...",
  "created_at": 1234567890
}
```

#### Refresh Token Request
```
POST /oauth/token
```
Query Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| refresh_token | Yes | Refresh token from previous token request |
| client_id | Yes | Application client ID |
| grant_type | Yes | `refresh_token` |
| redirect_uri | Yes | Application redirect URI |

---

## Tournament Endpoints

### List Tournaments
```
GET /tournaments.json
```

Query Parameters:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | integer | 1 | Page number |
| per_page | integer | 25 | Results per page |
| state | string | - | Filter: `pending`, `in_progress`, `ended` |
| type | string | - | Filter: `single_elimination`, `double_elimination`, `round_robin`, `swiss`, `free_for_all` |
| created_after | datetime | - | Format: mm/dd/yyyy |
| created_before | datetime | - | Format: mm/dd/yyyy |
| community_id | string | - | Community subdomain (if applicable) |

Response: Array of TournamentModel objects

---

### Get Tournament
```
GET /tournaments/{tournament_id}.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |

Query Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| community_id | No | Required if tournament belongs to a community |

Response: TournamentModel object

---

### Create Tournament
```
POST /tournaments.json
```

Request Body:
```javascript
{
  "data": {
    "type": "Tournaments",
    "attributes": {
      "name": "Tournament Name",  // Required
      "tournament_type": "single elimination",  // Required
      "url": "my-tournament",
      "game_name": "Game Name",
      "private": false,
      "starts_at": "2025-12-25T20:00:00.000Z",
      "description": "Description text",
      "notifications": {
        "upon_matches_open": true,
        "upon_tournament_ends": true
      },
      "match_options": {
        "consolation_matches_target_rank": 3,  // 3 = third place match
        "accept_attachments": false
      },
      "registration_options": {
        "open_signup": false,
        "signup_cap": 16,
        "check_in_duration": 30  // Must be multiple of 5
      },
      "seeding_options": {
        "hide_seeds": false,
        "sequential_pairings": false
      },
      "station_options": {
        "auto_assign": false,
        "only_start_matches_with_assigned_stations": false
      },
      "group_stage_enabled": false,
      "group_stage_options": { /* see schema */ },
      "double_elimination_options": {
        "split_participants": false,
        "grand_finals_modifier": null  // 'single', 'skip', or null
      },
      "round_robin_options": { /* see schema */ },
      "swiss_options": { /* see schema */ },
      "free_for_all_options": { /* see schema */ }
    }
  }
}
```

Response: 201 Created with TournamentModel

---

### Update Tournament
```
PUT /tournaments/{tournament_id}.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |

Request Body: Same structure as Create Tournament

Response: 200 OK with TournamentModel

---

### Delete Tournament
```
DELETE /tournaments/{tournament_id}.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |

Response: 204 No Content

---

### Change Tournament State
```
PUT /tournaments/{tournament_id}/change_state.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |

Request Body:
```javascript
{
  "data": {
    "type": "TournamentState",
    "attributes": {
      "state": "start"  // See valid states below
    }
  }
}
```

Valid State Values:
| State | Description |
|-------|-------------|
| `process_checkin` | Process check-in results |
| `abort_checkin` | Abort check-in phase |
| `start_group_stage` | Start group stage |
| `finalize_group_stage` | Finalize group stage |
| `reset_group_stage` | Reset group stage |
| `start` | Start tournament |
| `finalize` | Finalize tournament |
| `reset` | Reset tournament |
| `open_predictions` | Open for predictions |

Response: 200 OK with TournamentModel

---

## Match Endpoints

### List Matches
```
GET /tournaments/{tournament_id}/matches.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |

Query Parameters:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | integer | 1 | Page number |
| per_page | integer | 25 | Results per page |
| state | string | - | Filter: `pending`, `open`, `complete` |
| participant_id | string | - | Filter by participant |
| community_id | string | - | Community subdomain (if applicable) |

Response: Array of MatchModel objects

---

### Get Match
```
GET /tournaments/{tournament_id}/matches/{match_id}.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |
| match_id | Yes | Match identifier |

Response: MatchModel object

---

### Update Match (Submit Scores)
```
PUT /tournaments/{tournament_id}/matches/{match_id}.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |
| match_id | Yes | Match identifier |

Request Body:
```javascript
{
  "data": {
    "type": "Match",
    "attributes": {
      "match": [
        {
          "participant_id": "123",
          "score_set": "2",       // Comma-separated for sets: "4,2,4"
          "rank": 1,              // 1 = winner
          "advancing": true
        },
        {
          "participant_id": "456",
          "score_set": "1",
          "rank": 2,
          "advancing": false
        }
      ],
      "tie": false,               // Set true for tie (advancing must be false for both)
      "location": "Station 1",    // Optional
      "scheduled_time": "2025-12-25T20:00:00.000Z"  // Optional
    }
  }
}
```

**Score Format:** For a best-of-3 where participant wins 4-1, 2-4, 4-0:
- Winner: `"score_set": "4,2,4"`
- Loser: `"score_set": "1,4,0"`

Response: 200 OK with MatchModel

---

### Change Match State
```
PUT /tournaments/{tournament_id}/matches/{match_id}/change_state.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |
| match_id | Yes | Match identifier |

Request Body:
```javascript
{
  "data": {
    "type": "MatchState",
    "attributes": {
      "state": "mark_as_underway"  // See valid states below
    }
  }
}
```

Valid State Values:
| State | Description |
|-------|-------------|
| `mark_as_underway` | Mark match as in progress |
| `unmark_as_underway` | Remove underway status |
| `reopen` | Reopen a completed match |

Response: 200 OK with MatchModel

---

## Participant Endpoints

### List Participants
```
GET /tournaments/{tournament_id}/participants.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |

Query Parameters:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | integer | 1 | Page number |
| per_page | integer | 25 | Results per page |
| community_id | string | - | Community subdomain (if applicable) |

Response: Array of ParticipantModel objects

---

### Get Participant
```
GET /tournaments/{tournament_id}/participants/{participant_id}.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |
| participant_id | Yes | Participant identifier |

Response: ParticipantModel object

---

### Create Participant
```
POST /tournaments/{tournament_id}/participants.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |

Request Body:
```javascript
{
  "data": {
    "type": "Participants",
    "attributes": {
      "name": "Player Name",  // Required
      "seed": 1,              // Optional
      "misc": "custom-id",    // Optional - for your foreign key
      "email": "player@example.com",  // Optional - invites user
      "username": "challonge_user"    // Optional - invites user
    }
  }
}
```

Response: 200 OK with ParticipantModel

---

### Update Participant
```
PUT /tournaments/{tournament_id}/participants/{participant_id}.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |
| participant_id | Yes | Participant identifier |

Request Body: Same structure as Create Participant

Response: 200 OK with ParticipantModel

---

### Delete Participant
```
DELETE /tournaments/{tournament_id}/participants/{participant_id}.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |
| participant_id | Yes | Participant identifier |

Response:
- 200 OK: Participant deactivated (tournament underway)
- 204 No Content: Participant deleted (tournament not started)

---

### Bulk Create Participants
```
POST /tournaments/{tournament_id}/participants/bulk_add.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |

Request Body:
```javascript
{
  "data": {
    "type": "Participants",
    "attributes": {
      "participants": [  // 1-20 items
        { "name": "Player 1", "seed": 1 },
        { "name": "Player 2", "seed": 2 },
        { "name": "Player 3" }
      ]
    }
  }
}
```

Response: 200 OK with array of ParticipantModel objects

---

### Clear All Participants
```
DELETE /tournaments/{tournament_id}/participants/clear.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |

Response: 204 No Content

---

### Randomize Participants
```
PUT /tournaments/{tournament_id}/participants/randomize.json
```

Path Parameters:
| Parameter | Required | Description |
|-----------|----------|-------------|
| tournament_id | Yes | Tournament ID or URL slug |

Response: 200 OK with array of ParticipantModel objects

---

## Schema Reference

### TournamentModel
```javascript
{
  "id": "30201",
  "type": "tournament",
  "attributes": {
    "name": "Tournament Name",
    "tournament_type": "single elimination",  // Enum: see below
    "url": "tournament-slug",
    "game_name": "Game Name",
    "private": false,
    "starts_at": "2025-12-25T20:00:00.000Z",
    "description": "Description",
    "state": "pending",  // See Tournament States
    "notifications": { /* NotificationsOptions */ },
    "match_options": { /* MatchOptions */ },
    "registration_options": { /* RegistrationOptions */ },
    "seeding_options": { /* SeedingOptions */ },
    "station_options": { /* StationOptions */ },
    "group_stage_enabled": false,
    "group_stage_options": { /* GroupStageOptions */ },
    "double_elimination_options": { /* DoubleEliminationOptions */ },
    "round_robin_options": { /* RoundRobinOptions */ },
    "swiss_options": { /* SwissOptions */ },
    "free_for_all_options": { /* FreeForAllOptions */ }
  }
}
```

**tournament_type enum:**
- `single elimination`
- `double elimination`
- `round robin`
- `swiss`
- `free for all`

### Nested Tournament Options

#### notifications
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| upon_matches_open | boolean | true | Notify when matches open |
| upon_tournament_ends | boolean | true | Notify when tournament ends |

#### match_options
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| consolation_matches_target_rank | integer | 3 | 3 = third place match enabled |
| accept_attachments | boolean | false | Allow match attachments |

#### registration_options
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| open_signup | boolean | false | Allow public registration |
| signup_cap | integer | - | Maximum participants |
| check_in_duration | integer | - | Minutes (multiple of 5) |

#### seeding_options
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| hide_seeds | boolean | false | Hide seed numbers |
| sequential_pairings | boolean | false | 1v2, 3v4 instead of 1v8, 2v7 |

#### station_options
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| auto_assign | boolean | false | Auto-assign stations |
| only_start_matches_with_assigned_stations | boolean | false | Require station assignment |

#### double_elimination_options
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| split_participants | boolean | false | Split bracket |
| grand_finals_modifier | string | null | `'single'`, `'skip'`, or `null` (default double) |

#### group_stage_options
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| stage_type | string | - | `round robin`, `single elimination`, `double elimination` |
| group_size | integer | 4 | Participants per group |
| participant_count_to_advance_per_group | integer | 2 | Advancers per group |
| rr_iterations | integer | 1 | Round robin iterations |
| ranked_by | string | - | Ranking method |
| rr_pts_for_match_win | float | - | Points for match win |
| rr_pts_for_match_tie | float | - | Points for match tie |
| rr_pts_for_game_win | float | - | Points for game win |
| rr_pts_for_game_tie | float | - | Points for game tie |
| split_participants | boolean | false | Split participants |

#### round_robin_options
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| iterations | integer | 2 | Number of iterations |
| ranking | string | - | Ranking method |
| pts_for_game_win | float | - | Points for game win |
| pts_for_game_tie | float | - | Points for game tie |
| pts_for_match_win | float | - | Points for match win |
| pts_for_match_tie | float | - | Points for match tie |

#### swiss_options
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| rounds | integer | 2 | Number of rounds |
| pts_for_game_win | float | - | Points for game win |
| pts_for_game_tie | float | - | Points for game tie |
| pts_for_match_win | float | - | Points for match win |
| pts_for_match_tie | float | - | Points for match tie |

#### free_for_all_options
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| max_participants | integer | 4 | Max per match |

---

### MatchModel
```javascript
{
  "id": "8008135",
  "type": "match",
  "attributes": {
    "state": "complete",           // Enum: pending, open, complete
    "round": 1,
    "identifier": "A",
    "suggested_play_order": 1,
    "scores": "2 - 0",            // Display format
    "score_in_sets": [[2, 0]],    // Nested array
    "points_by_participant": [
      { "participant_id": "123", "scores": [2] },
      { "participant_id": "456", "scores": [0] }
    ],
    "timestamps": {
      "created_at": "2025-12-25T20:00:00.000Z",
      "updated_at": "2025-12-25T21:00:00.000Z"
    },
    "underway_at": null,          // null or ISO datetime
    "winner_id": 123
  },
  "relationships": {
    "player1": { "data": { "id": "123", "type": "participant" } },
    "player2": { "data": { "id": "456", "type": "participant" } }
  }
}
```

**Match State Detection:**
- `pending`: Match not yet playable
- `open`: Match playable, not complete
- `open` + `underway_at != null`: Match in progress
- `complete`: Match finished

---

### MatchInput
```javascript
{
  "data": {
    "type": "Match",
    "attributes": {
      "match": [
        {
          "participant_id": "123",    // Required
          "score_set": "4,2,4",       // Required - comma-separated scores
          "rank": 1,                  // Default: 1 (1 = winner)
          "advancing": true           // Default: false
        }
      ],
      "tie": false,                   // Default: false
      "location": "Station 1",        // Optional
      "scheduled_time": "ISO-8601"    // Optional
    }
  }
}
```

---

### MatchStateInput
```javascript
{
  "data": {
    "type": "MatchState",
    "attributes": {
      "state": "mark_as_underway"  // Enum: reopen, mark_as_underway, unmark_as_underway
    }
  }
}
```

---

### ParticipantModel
```javascript
{
  "id": "76",
  "type": "participant",
  "attributes": {
    "name": "Player Name",
    "seed": 1,
    "group_id": null,
    "tournament_id": 12345,
    "username": "challonge_user",
    "final_rank": null,
    "states": {
      "active": true
    },
    "misc": "custom-foreign-key",
    "timestamps": {
      "created_at": "2025-12-25T20:00:00.000Z",
      "updated_at": "2025-12-25T20:00:00.000Z"
    }
  }
}
```

---

### ParticipantInput
```javascript
{
  "data": {
    "type": "Participants",
    "attributes": {
      "name": "Player Name",         // Required
      "seed": 1,                     // Optional
      "misc": "foreign-key",         // Optional - API-only field
      "email": "email@example.com",  // Optional - invites user
      "username": "challonge_user"   // Optional - invites user
    }
  }
}
```

---

### ParticipantBulkInput
```javascript
{
  "data": {
    "type": "Participants",
    "attributes": {
      "participants": [              // Min: 1, Max: 20 items
        {
          "name": "Player 1",        // Required
          "seed": 1,
          "misc": "id-1",
          "email": "p1@example.com",
          "username": "player1"
        },
        {
          "name": "Player 2"         // Only name required
        }
      ]
    }
  }
}
```

---

### TournamentStateInput
```javascript
{
  "data": {
    "type": "TournamentState",
    "attributes": {
      "state": "start"
      // Enum: process_checkin, abort_checkin, start_group_stage,
      //       finalize_group_stage, reset_group_stage, start,
      //       finalize, reset, open_predictions
    }
  }
}
```

---

### ErrorModel
```javascript
{
  "errors": {
    "detail": "Error message description",
    "status": 422,
    "source": {
      "pointer": "/data/attributes/field_name"
    }
  }
}
```

---

### UserModel
```
GET /me.json
```
```javascript
{
  "id": "12345",
  "type": "user",
  "attributes": {
    "email": "user@example.com",
    "username": "username",
    "image_url": "https://..."
  }
}
```

---

## Tournament States

### State Descriptions
| State | Description |
|-------|-------------|
| `pending` | Tournament setup - adding participants, configuring |
| `checking_in` | Check-in window open |
| `checked_in` | Check-in processed |
| `accepting_predictions` | Predictions open (if enabled) |
| `group_stages_underway` | Group stage in progress |
| `group_stages_finalized` | Group stage complete |
| `underway` | Final stage in progress |
| `awaiting_review` | All matches reported, awaiting finalization |
| `complete` | Tournament finished |

### State Transitions
```
pending
  └─> checking_in (if check-in enabled)
        └─> checked_in
              └─> accepting_predictions (if predictions enabled)
                    └─> group_stages_underway (if group stage enabled)
                          └─> group_stages_finalized
                                └─> underway
  └─> underway (direct start)
        └─> awaiting_review
              └─> complete
```

---

## Field Mapping (v1 to v2.1)

| v1 Field | v2.1 Field | Notes |
|----------|------------|-------|
| `start_at` | `starts_at` | Note the 's' |
| `check_in_duration` | `registration_options.check_in_duration` | Nested |
| `signup_cap` | `registration_options.signup_cap` | Nested |
| `open_signup` | `registration_options.open_signup` | Nested |
| `hide_seeds` | `seeding_options.hide_seeds` | Nested |
| `sequential_pairings` | `seeding_options.sequential_pairings` | Nested |
| `accept_attachments` | `match_options.accept_attachments` | Nested |
| `hold_third_place_match` | `match_options.consolation_matches_target_rank` | 3 = enabled |
| `grand_finals_modifier` | `double_elimination_options.grand_finals_modifier` | Nested |
| `notify_users_when_matches_open` | `notifications.upon_matches_open` | Nested + renamed |
| `notify_users_when_the_tournament_ends` | `notifications.upon_tournament_ends` | Nested + renamed |

---

## Error Handling

### HTTP Status Codes
| Code | Description |
|------|-------------|
| 200 | OK - Resource retrieved/updated |
| 201 | Created - Resource created |
| 204 | No Content - Resource deleted |
| 400 | Bad Request - Invalid payload or parameters |
| 401 | Unauthorized - Invalid/missing authentication |
| 403 | Forbidden - No permission for resource |
| 404 | Not Found - Resource doesn't exist |
| 406 | Not Acceptable - Invalid Accept header |
| 415 | Unsupported Media Type - Invalid Content-Type |
| 422 | Unprocessable Entity - Validation error |
| 500 | Internal Server Error - Challonge server issue |

### Error Response Format
```javascript
{
  "errors": {
    "detail": "Description of what went wrong",
    "status": 422,
    "source": {
      "pointer": "/data/attributes/name"
    }
  }
}
```

---

## Implementation Constraints

### Critical Rules
1. **Always use v2.1** - Never call deprecated or v1 endpoints
2. **Authorization-Type header is REQUIRED** - Use `v2` for OAuth, `v1` for API key
3. **JSON:API format** - All bodies must wrap data in `{ "data": { "type": "...", "attributes": {...} } }`
4. **Score submission requires scores** - Cannot declare winner without providing scores (422 error)
5. **Match state detection** - Underway matches: `state='open'` AND `underway_at != null`

### Quirks & Gotchas
| Issue | Solution |
|-------|----------|
| `consolation_matches_target_rank` must be >= 3 | Set to 3 for third place match, omit entirely to disable |
| Cannot send `null` for `consolation_matches_target_rank` | Omit the field instead |
| Match underway detection | Check both `state='open'` AND `underway_at != null` |
| `grand_finals_modifier` | Accepts `'single'`, `'skip'`, or `null` (default double match) |
| Bulk participants | Max 20 per request |
| `check_in_duration` | Must be multiple of 5 |

### Rate Limiting
Use rate-limited requests with adaptive modes:

| Mode | Rate | Trigger |
|------|------|---------|
| IDLE | 12/min | No tournaments within 48h |
| UPCOMING | 20/min | Tournament within 48h |
| ACTIVE | 30/min | Tournament underway |

### Best Practices
1. Use tournament ID (not URL slug) when possible - more reliable
2. Include `community_id` query param if tournament belongs to a community
3. Handle 401 errors with token refresh or fallback to API key
4. Cache responses and implement stale-while-revalidate pattern
5. Use pagination for list endpoints (default 25 per page)
