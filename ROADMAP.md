# TCC-Custom Market Roadmap

**Goal:** Launch bracketspot.com as a competitive tournament management SaaS by **January 5, 2026**

**Generated:** 2025-12-15
**Source:** FUTURE_IMPROVEMENTS.txt analysis

---

## Phase Overview

| Phase | Focus | Timeline Target | Status |
|-------|-------|-----------------|--------|
| **1** | MVP Stabilization | Immediate | In Progress |
| **2** | Core Tournament Operations | Week 1-2 | Pending |
| **3** | Revenue & Monetization | Week 2-3 | Pending |
| **4** | Market Differentiation | Week 3-4 | Pending |
| **5** | Scale & Growth | Week 4-6 | Pending |
| **5.5** | **Pi Onboarding System** | Post-VPS | Pending |
| **6** | Participant Experience | Week 6-8 | Pending |
| **7** | Advanced AI Features | Week 8-10 | Pending |
| **8** | Visual Polish & UX | Week 10-12 | Pending |

---

## Phase 1: MVP Stabilization

**Priority:** CRITICAL
**Goal:** Ensure system reliability for production use

These items must be complete before launch. A single failure during a live tournament damages reputation.

### 1.1 Error Handling Standardization ✅ COMPLETED 2025-12-15
**Effort:** 2-3 days | **Source:** NEW-1

- [x] Create `services/error-handler.js` with standardized error types
- [x] Add exponential backoff retry logic for external API calls
- [x] Implement circuit breaker pattern for flaky services
- [x] Add contextual logging with request ID tracking
- [x] Return consistent error response format across all endpoints

**Files:** routes/matches.js, routes/analytics.js, routes/participants.js, routes/displays.js

### 1.2 Input Validation Completion ✅ COMPLETED 2025-12-15
**Effort:** 2 days | **Source:** NEW-2

- [x] Enforce Joi validation middleware on ALL routes
- [x] Add comprehensive validation for bulk participant add
- [x] Implement field-level transformation (trim, sanitize)
- [x] Add seed number validation (1-N, no duplicates)

**Files:** validation/schemas.js (~850 lines), routes/participants.js, routes/matches.js, routes/tournaments.js, routes/flyers.js

### 1.3 Health Check Diagnostics Enhancement ✅ COMPLETED 2025-12-15
**Effort:** 2 days | **Source:** NEW-3

- [x] Add database integrity check (PRAGMA integrity_check)
- [x] Check disk space for database location (warn < 10%)
- [x] Add memory usage monitoring (warn > 80%)
- [x] Check WebSocket message queue length (warn > 1000)
- [x] Return detailed health report JSON

**Files:** services/health-check.js, server.js (endpoints)

### 1.4 Display Offline Resilience
**Effort:** 2 days | **Source:** NEW-5

- [ ] Store last successful bracket/match data in localStorage
- [ ] Show "Connection Lost - Retrying..." overlay when disconnected
- [ ] Display last-known match info (not blank)
- [ ] Auto-reload page if disconnected > 2 minutes

**Files:** bracket-display/public/js/*, match-display/public/js/*, flyer-display/public/js/*

### 1.5 Real-Time Data Freshness
**Effort:** 3-4 days | **Source:** Item #13

- [ ] Add "Force Refresh All" button
- [ ] Show staleness indicators on data panels
- [ ] Force cache clear on tournament state changes
- [ ] Implement WebSocket-first architecture for ACTIVE mode
- [ ] Add Cache-Control headers from origin

---

## Phase 2: Core Tournament Operations

**Priority:** HIGH
**Goal:** Smooth tournament day experience for operators

### 2.1 Participant Check-In Improvements
**Effort:** 2 days | **Source:** Item #9

- [ ] Bulk check-in ("Check in all participants")
- [ ] Visual/audio alerts when check-in deadline approaches
- [ ] Self-check-in via signup app (with verification code)
- [ ] QR code scanning for instant check-in

### 2.2 Match History Log
**Effort:** 1-2 days | **Source:** Item #12

- [ ] Side panel showing last 10 completed matches
- [ ] Timestamp, players, score, winner display
- [ ] Click to reopen if needed
- [ ] Export match history to CSV

### 2.3 Bulk Check-In Operations
**Effort:** 2 days | **Source:** NEW-7

- [ ] "Check In Multiple" modal with participant selection
- [ ] QR code scanning for instant check-in (mobile camera)
- [ ] Batch check-in via CSV/names list
- [ ] Show check-in count progress badge
- [ ] "Check In All Remaining" button

### 2.4 DQ Timer Enhancements
**Effort:** 1-2 days | **Source:** NEW-8

- [ ] Preset custom durations (30s, 60s, 90s, 180s)
- [ ] Per-match DQ timer history
- [ ] "Give Extra Time" button (+30s)
- [ ] Push notification when DQ timer expires
- [ ] Sound alerts at thresholds (60s, 30s, 10s, 5s, 0s)

### 2.5 Stream Deck Enhancements
**Effort:** 2-3 days | **Source:** Items #18-23

- [ ] Local data caching for offline resilience
- [ ] Macro support for complex operations
- [ ] Profile per tournament/game
- [ ] Haptic/visual feedback improvements
- [ ] Multi-page match navigation

---

## Phase 3: Revenue & Monetization

**Priority:** HIGH
**Goal:** Enable sustainable business model

### 3.1 Stripe Payment Integration
**Effort:** 3-4 days | **Source:** NEW-4

- [ ] Entry fee collection via signup PWA
- [ ] Automatic payment tracking per participant
- [ ] Refund handling for no-shows
- [ ] Revenue reporting integration
- [ ] Stripe Elements for secure card entry

**Environment:** STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET

### 3.2 Email Service Integration
**Effort:** 1-2 days | **Source:** NEW-5 / Item #40

- [ ] Tournament confirmation emails
- [ ] 24-hour reminder emails
- [ ] Results & Elo update emails
- [ ] Check-in deadline reminders
- [ ] HTML email templates with branding

**Files:** admin-dashboard/services/email-service.js, admin-dashboard/templates/email/*.html

### 3.3 Custom Branding Theme Builder
**Effort:** 3-4 days | **Source:** NEW-13

- [ ] Per-user color scheme customization
- [ ] Logo upload for branded displays
- [ ] Custom fonts selection
- [ ] Preview before applying
- [ ] Export/import theme configurations

**Monetization:** Premium feature for paid subscription tiers

### 3.4 Revenue Tracking
**Effort:** 2-3 days | **Source:** Item #59

- [ ] Entry fee tracking per tournament
- [ ] Pot bonus recording
- [ ] Payout distribution calculator
- [ ] Expense tracking
- [ ] Profit/loss summary and CSV export

### 3.5 Sponsor ROI Metrics
**Effort:** 2 days | **Source:** Item #64

- [ ] Track sponsor logo display time
- [ ] Calculate "impressions" (viewers x time)
- [ ] Sponsor placement report (PDF)
- [ ] ROI calculator for sponsors

---

## Phase 4: Market Differentiation

**Priority:** HIGH
**Goal:** Features that set bracketspot.com apart from competitors

### 4.1 Discord Bot Integration ✅ COMPLETED 2025-12-14
**Effort:** 3-4 days | **Source:** NEW-1 (Tier 12)

- [x] Automated match announcements to Discord channel
- [x] Player @mentions when matches are called
- [x] Results posting with rich embeds
- [x] Slash commands: /tournament-status, /bracket, /results, /announce

**Files:** admin-dashboard/services/discord-bot/, admin-dashboard/routes/discord-bot.js

### 4.2 Real-Time Analytics Dashboard
**Effort:** 2-3 days | **Source:** NEW-8 (Tier 12)

- [ ] Live tournament progress visualization (Chart.js)
- [ ] Match duration trend charts
- [ ] Player Elo history graphs
- [ ] Attendance over time line chart
- [ ] Export charts as images for social media

### 4.3 Command Palette (Spotlight Search)
**Effort:** 2-3 days | **Source:** NEW-23

- [ ] Ctrl+K opens command palette overlay
- [ ] Search across: pages, actions, participants, matches
- [ ] Quick actions: "Start next match", "Send ticker"
- [ ] Recent actions history
- [ ] Fuzzy search matching

### 4.4 Undo/Redo System for Match Actions
**Effort:** 2-3 days | **Source:** NEW-21

- [ ] Undo last score entry (5-action history stack)
- [ ] Redo capability
- [ ] Visual indicator of undoable actions
- [ ] Confirmation for destructive undos

### 4.5 Bracket Predictions System
**Effort:** 3-4 days | **Source:** Item #42

- [ ] Visual bracket picker with clickable matches
- [ ] Device fingerprint for account-free identity
- [ ] Hybrid lock system (early = full points, late = 0.5x)
- [ ] Live leaderboard with real-time scoring
- [ ] Claim code for prize verification

---

## Phase 5: Scale & Growth

**Priority:** MEDIUM
**Goal:** Support business growth beyond single-operator

### 5.1 Multi-Tournament View
**Effort:** 4-5 days | **Source:** Item #55

- [ ] Run multiple tournaments simultaneously
- [ ] Tabbed interface on admin dashboard
- [ ] Split-screen TV displays
- [ ] "Active Tournament" selector per display
- [ ] Color-coded tabs by tournament

### 5.2 Referee Role
**Effort:** 3-4 days | **Source:** Item #56

- [ ] New role with limited permissions
- [ ] CAN: View matches, enter scores, mark underway
- [ ] CANNOT: Create tournaments, manage participants, system settings
- [ ] Per-tournament referee assignment
- [ ] Referee-specific mobile view

### 5.3 Attendee Profiles
**Effort:** 3-4 days | **Source:** Item #58

- [ ] Automatic player identification (fuzzy name matching)
- [ ] Player profile page (attendance, placements, Elo)
- [ ] "Regular" badge for frequent attendees
- [ ] Notes field for accessibility needs
- [ ] Birthday tracking (optional)

### 5.4 Start.gg Sync Bridge
**Effort:** 5-6 days | **Source:** NEW-3

- [ ] Import tournaments from start.gg
- [ ] Sync participants bidirectionally
- [ ] Export results to external platforms
- [ ] OAuth integration with start.gg

### 5.5 Multi-Venue Support
**Effort:** 4-5 days | **Source:** Item #57

- [ ] Define multiple venues
- [ ] Per-venue display configuration
- [ ] Per-venue network settings
- [ ] Tournaments assigned to venue

---

## Phase 5.5: Raspberry Pi Onboarding System (Post-VPS)

**Priority:** HIGH (Post-Migration)
**Goal:** Automated multi-tenant Pi provisioning and management
**Prerequisite:** VPS migration complete (bracketspot.com live)

This feature enables customers to set up display Pis without manual configuration. Pis boot to a QR code, users scan to claim, and displays automatically bind to their account.

### 5.5.1 Database Schema

**Effort:** 1 day

New/modified tables in `system.db`:

```sql
-- Add columns to existing displays table
ALTER TABLE displays ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE displays ADD COLUMN claim_status TEXT DEFAULT 'unclaimed'
    CHECK(claim_status IN ('unclaimed', 'pending', 'claimed'));
ALTER TABLE displays ADD COLUMN display_name TEXT;
ALTER TABLE displays ADD COLUMN discovered_via TEXT CHECK(discovered_via IN ('qr', 'mdns', 'manual'));
ALTER TABLE displays ADD COLUMN claimed_at DATETIME;
ALTER TABLE displays ADD COLUMN assigned_view TEXT DEFAULT 'match'
    CHECK(assigned_view IN ('match', 'bracket', 'flyer'));

-- New table: Claim tokens (10-minute expiry, one-time use)
CREATE TABLE display_claim_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,        -- 64-char hex (32 bytes random)
    display_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    claimed_by INTEGER REFERENCES users(id),
    claimed_at DATETIME,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'claimed', 'expired'))
);

-- New table: mDNS discovery cache
CREATE TABLE display_discovery_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac TEXT UNIQUE NOT NULL,
    hostname TEXT,
    ip TEXT,
    discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    discovered_by_user INTEGER REFERENCES users(id)
);
```

**Files:** `admin-dashboard/db/system-db.js`

### 5.5.2 Claim Token API Endpoints

**Effort:** 2 days

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/displays/claim-token` | None | Pi requests token, gets QR URL |
| GET | `/api/displays/claim/:token` | Session | User opens claim page |
| POST | `/api/displays/claim/:token` | Session | User confirms claim |
| GET | `/api/displays/claim-status/:displayId` | MAC | Pi polls claim status |

**QR Claim Flow:**
```
Pi                          Server                      User
|                              |                          |
| POST /claim-token ---------> |                          |
| <-- { token, qrUrl } --------|                          |
|                              |                          |
| [Show QR on screen]          |                          |
|                              | <-- Scan QR -------------|
|                              | --> Claim page ----------|
|                              | <-- POST confirm --------|
| <-- WS: display:claimed ---- |                          |
| [Start display]              |                          |
```

**Files:** `admin-dashboard/routes/displays.js`, `admin-dashboard/services/display-onboarding.js`

### 5.5.3 mDNS Auto-Discovery

**Effort:** 2 days

**Pi broadcasts via Avahi:**
```xml
<!-- /etc/avahi/services/tcc-display.service -->
<service-group>
  <name>TCC Display %h</name>
  <service>
    <type>_tcc-display._tcp</type>
    <port>9300</port>
    <txt-record>mac=XX:XX:XX:XX:XX:XX</txt-record>
    <txt-record>status=unclaimed</txt-record>
  </service>
</service-group>
```

**Server discovers using `bonjour-service` npm package:**
```javascript
const Bonjour = require('bonjour-service').Bonjour;
const browser = bonjour.find({ type: 'tcc-display' }, (service) => {
    if (service.txt?.status === 'unclaimed') {
        // Push to admin dashboards via WebSocket
    }
});
```

**Discovery Endpoints:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/displays/discover` | List unclaimed Pis on LAN |
| POST | `/api/displays/discover/refresh` | Trigger mDNS scan |
| POST | `/api/displays/discover/claim/:mac` | Claim from discovery list |

**Files:** `admin-dashboard/services/mdns-discovery.js`

### 5.5.4 Remote Display Mode Switching

**Effort:** 1 day

Admin can change Pi between match/bracket/flyer views remotely:

```
PUT /api/displays/:id/view { view: 'bracket' }
    ↓
Server updates DB, emits WebSocket: display:switch-view
    ↓
Pi receives, kills browser, restarts with new URL
    ↓
Pi heartbeat confirms new view
```

**View URLs:** `/u/{userId}/match`, `/u/{userId}/bracket`, `/u/{userId}/flyer`

**Files:** `admin-dashboard/routes/displays.js`, Pi-side `switch-view.sh`

### 5.5.5 Pi Onboarding State Machine

**Effort:** 2 days

```
[Boot] → [CONNECTING] → [UNCLAIMED] → [QR_DISPLAYED] → [CLAIMING] → [CLAIMED] → [RUNNING]
              ↑                                                                      |
              +----------------------------------------------------------------------+
                                                                             [DISCONNECTED]
```

| State | Actions |
|-------|---------|
| CONNECTING | Wait for network, show "Connecting..." |
| UNCLAIMED | Request claim token from server |
| QR_DISPLAYED | Show fullscreen QR, poll for claim |
| CLAIMING | Show "Claiming..." animation |
| CLAIMED | Transition to normal operation |
| RUNNING | Show configured display type |
| DISCONNECTED | Overlay "Disconnected - Reconnecting..." |

**Files:** Pi-side `onboarding-manager.js`

### 5.5.6 Offline Indicator Overlay

**Effort:** 1 day

- Monitor Socket.IO `disconnect` event
- Inject CSS overlay via CDP (Chrome DevTools Protocol, port 9223)
- Show "Disconnected - Reconnecting..." with dimmed display behind
- Exponential backoff reconnect (5s → 30s max)
- Auto-remove overlay on reconnect

**Files:** Pi-side `connection-monitor.js`

### 5.5.7 Pi Provisioning (Hybrid Approach)

**Effort:** 3 days

#### Option A: Bootstrap Script (Primary)

Users flash stock Raspberry Pi OS Lite and add files to boot partition:

**Files for /boot partition:**
- `tcc-bootstrap.sh` - Main setup script
- `tcc-config.txt` - Server URL, optional WiFi

**tcc-config.txt:**
```ini
SERVER_URL=https://bracketspot.com
WIFI_SSID=MyNetwork          # Optional
WIFI_PASSWORD=MyPassword     # Optional
HOSTNAME=tcc-display-1       # Optional (auto-generated if blank)
```

**Bootstrap workflow:**
1. Wait for network → Set hostname
2. `apt install chromium-browser nodejs npm avahi-daemon xserver-xorg openbox`
3. Download setup package from `SERVER_URL/api/pi/setup-package`
4. Install systemd services, configure autologin
5. Reboot → boots to QR claim screen

**User workflow:**
1. Flash Raspberry Pi OS Lite (64-bit) to SD card
2. Download `tcc-bootstrap.zip` from bracketspot.com
3. Extract to boot partition, edit `tcc-config.txt`
4. Boot Pi, wait ~5 mins, scan QR to claim

#### Option B: Pre-Built Image (Optional)

Everything pre-installed, boots to "Enter Server URL" screen:
- Build using `pi-gen` tool
- Host on CDN (Cloudflare R2)
- ~1.2 GB compressed

### 5.5.8 Setup Package (Served by Server)

**Endpoint:** `GET /api/pi/setup-package`

Returns `tcc-setup.tar.gz`:
```
tcc-display/
├── package.json
├── onboarding-manager.js     # State machine
├── heartbeat.js              # Status reporting
├── websocket-client.js       # Connection manager
├── qr-display.html           # QR code template
├── offline-overlay.html      # Disconnect overlay
├── systemd/
│   ├── tcc-kiosk.service
│   ├── tcc-heartbeat.service
│   └── tcc-onboarding.service
└── scripts/
    ├── start-kiosk.sh
    ├── switch-view.sh
    └── update-avahi-status.sh
```

**Endpoint:** `GET /api/pi/bootstrap-files`

Returns `tcc-bootstrap.zip` with bootstrap script and config template.

### 5.5.9 Admin Dashboard UI

**Effort:** 2 days

**New pages/sections:**
- `/setup/pi` - Download page with instructions
- `/displays` - Device management (list, status, controls)
- Discovery panel - Shows unclaimed Pis on LAN

**Display management features:**
- View claimed displays with online/offline status
- Switch display mode (match/bracket/flyer)
- Rename displays
- Unclaim/release displays
- Reboot/refresh commands

### 5.5.10 Security Measures

| Threat | Mitigation |
|--------|------------|
| Token brute force | Rate limit: 5 tokens/hour/MAC |
| MAC spoofing | Token bound to display_id at creation |
| Cross-tenant access | user_id FK + ownership validation |
| Replay attacks | One-time tokens + 10-min expiry |

### 5.5.11 WebSocket Events

**Pi → Server:**
- `display:qr:shown` - Pi showing QR code
- `display:claimed:ack` - Pi acknowledges claim
- `display:heartbeat` - Periodic status

**Server → Pi:**
- `display:claimed` - Notify claim success
- `display:switch-view` - Change display type
- `display:qr:regenerate` - Token expired

**Server → Admin:**
- `display:discovered` - New device on LAN
- `display:claim:status` - Claim status changed
- `display:online/offline` - Connection status

### Implementation Phases

| Phase | Effort | Description |
|-------|--------|-------------|
| 1 | 1 day | Database migration + claim token table |
| 2 | 2 days | Claim API endpoints + QR flow |
| 3 | 2 days | Pi setup package + systemd services |
| 4 | 1 day | Bootstrap script + testing |
| 5 | 2 days | mDNS discovery (server + Pi) |
| 6 | 1 day | Display switching + offline overlay |
| 7 | 2 days | Admin dashboard UI |
| 8 | 1 day | Testing edge cases |

**Total Effort:** ~12 days

### Files to Create

```
admin-dashboard/
├── services/
│   ├── display-onboarding.js    # Token management
│   └── mdns-discovery.js        # Bonjour browser
├── public/
│   ├── claim.html               # Claim landing page
│   ├── js/claim.js              # Claim page logic
│   └── pi-setup/
│       ├── tcc-bootstrap.sh
│       └── tcc-config.txt

Pi-side (in setup package):
├── onboarding-manager.js
├── qr-display.html
├── offline-overlay.html
└── systemd/*.service
```

### Files to Modify

- `admin-dashboard/db/system-db.js` - Add tables
- `admin-dashboard/routes/displays.js` - Add claim endpoints
- `admin-dashboard/validation/schemas.js` - Add claim schemas
- `admin-dashboard/server.js` - Add WebSocket events

---

## Phase 6: Participant Experience

**Priority:** MEDIUM
**Goal:** Better UX drives user acquisition

### 6.1 Participant Self Check-In
**Effort:** 2-3 days | **Source:** Item #38

- [ ] Self check-in button on signup app
- [ ] Verification code system
- [ ] QR code scanning for quick check-in
- [ ] Check-in deadline countdown timer
- [ ] Push notification reminder

### 6.2 Waitlist System
**Effort:** 2 days | **Source:** Item #39

- [ ] "Join Waitlist" button when tournament is full
- [ ] Waitlist position display
- [ ] Auto-promote when slots open
- [ ] Notification when promoted

**Note:** UI COMPLETED 2025-12-09 (backend pending)

### 6.3 Registration Confirmation QR Code
**Effort:** 1-2 days | **Source:** Item #44

- [ ] QR code displayed on confirmation page
- [ ] Contains participant ID and verification code
- [ ] Printable confirmation (PDF download)
- [ ] Scannable by admin for quick check-in

### 6.4 Push Notifications (Signup App) ✅ COMPLETED 2025-12-13
**Effort:** 2-3 days | **Source:** Item #46

- [x] Push notification opt-in during signup
- [x] Signup confirmation notifications
- [x] Check-in reminder notifications
- [x] Tournament starting soon notifications

### 6.5 Offline Signup Queue ✅ COMPLETED 2025-12-13
**Effort:** 2-3 days | **Source:** Item #47

- [x] Queue signup locally when offline
- [x] Automatically submit when online
- [x] Show pending status to user
- [x] Sync status indicator

---

## Phase 7: Advanced AI Features

**Priority:** MEDIUM
**Goal:** Premium differentiating features

### 7.1 Smart Operator Assistant
**Effort:** 3-4 days | **Source:** AI-4

- [ ] Real-time suggestions during tournament
- [ ] Anomaly detection (unusual match durations, score patterns)
- [ ] Proactive alerts (behind schedule, stations underutilized)
- [ ] AI suggestions panel in Command Center

### 7.2 Intelligent Ticker Message Generator
**Effort:** 2 days | **Source:** AI-5

- [ ] Context-aware ticker suggestions
- [ ] Automatic event triggers (upset, grand finals)
- [ ] Customizable tone (Hype/Professional/Casual)
- [ ] One-click send from suggestion

### 7.3 Station Auto-Assignment
**Effort:** 3-4 days | **Source:** AI-16

- [ ] Automatic assignment based on duration prediction
- [ ] Player rest time consideration
- [ ] Match importance weighting
- [ ] Streaming preferences (top seeds on TV 1)
- [ ] Auto-assign mode with manual override

### 7.4 Match Outcome Predictions
**Effort:** 4-5 days | **Source:** AI-3 / AI-17

- [ ] Win probability display for upcoming matches
- [ ] Based on: Elo, head-to-head, recent form
- [ ] "Upset Alert" highlighting
- [ ] Post-match accuracy tracking

### 7.5 Live Commentary Generation
**Effort:** 2-3 days | **Source:** AI-10

- [ ] Real-time commentary ticker on match display
- [ ] Historical records between players
- [ ] Stakes explanation
- [ ] Path to victory analysis

---

## Phase 8: Visual Polish & UX

**Priority:** LOW
**Goal:** Professional appearance for brand credibility

### 8.1 Glassmorphism UI Refresh
**Effort:** 2-3 days | **Source:** NEW-11

- [ ] Frosted glass effect on modals and cards
- [ ] Backdrop blur for overlays
- [ ] Gradient backgrounds with noise texture

### 8.2 Animated Match Transitions
**Effort:** 2-3 days | **Source:** NEW-12

- [ ] Smooth card transitions when matches update
- [ ] Winner celebration micro-animations
- [ ] Score change animations (number roll)

### 8.3 Accessibility Improvements (WCAG 2.1 AA)
**Effort:** 2-3 days | **Source:** NEW-14 / Item #82

- [ ] Color contrast fixes
- [ ] Focus visible indicators
- [ ] Screen reader announcements
- [ ] Keyboard navigation improvements
- [ ] Reduced motion preferences support

### 8.4 Loading State Skeletons
**Effort:** 1 day | **Source:** NEW-19

- [ ] Skeleton loading states for all data panels
- [ ] Shimmer animations during fetch
- [ ] Consistent loading UX

### 8.5 Dark Mode Improvements
**Effort:** 1 day | **Source:** NEW-18

- [ ] True OLED black option
- [ ] Automatic scheduling (sunset/sunrise)
- [ ] Per-display theme override
- [ ] Reduced blue light mode

---

## Quick Wins (Can Be Done Anytime)

**Effort:** 1-4 hours each

### Admin Dashboard
- [ ] Copy Tournament ID Button
- [ ] Match Count Stats ("8/15 matches complete")
- [ ] Participant Count Badge with cap warning
- [ ] Error Message Improvements
- [ ] Settings Validation (client-side)
- [ ] Keyboard Shortcuts Visual Cheatsheet

### Signup App
- [ ] Copy Bracket Link Button
- [ ] Social Share Buttons
- [ ] Animated Success Checkmark
- [ ] Tournament Timezone Display
- [ ] Rules Page Print Button

### Raspberry Pi
- [ ] Add hostname to log messages
- [ ] Add uptime to heartbeat startup
- [ ] Browser crash notification to admin
- [ ] Add Pi model to heartbeat

### Stream Deck
- [ ] Connection timeout to HID device open
- [ ] Log API response times
- [ ] Cache participant names locally
- [ ] Error count display on main view

---

## Already Completed (Reference)

Features completed as of 2025-12-15:

| Feature | Completed |
|---------|-----------|
| Command Center View | 2025-12-07 |
| Keyboard Shortcuts | 2025-12-07 |
| Stream Deck WebSocket | 2025-12-07 |
| Push Notifications | 2025-12-09 |
| Tournament Templates | 2025-12-09 |
| Batch Score Entry | 2025-12-09 |
| DQ/Forfeit Automation | 2025-12-09 |
| Match Queue Auto-Advance | 2025-12-09 |
| Audio Announcements | 2025-12-10 |
| Tournament Day Checklist | 2025-12-10 |
| Scheduled Ticker Messages | 2025-12-10 |
| Automated Sponsor Rotation | 2025-12-10 |
| AI-Powered Seeding | 2025-12-09 |
| Tournament Narrative Generator | 2025-12-09 |
| Chromium Hang Detection | 2025-12-09 |
| Display Scale Factor | 2025-12-09 |
| Participant Lookup | 2025-12-09 |
| Dark Mode Toggle | 2025-12-09 |
| Modular Refactor | 2025-12-09 |
| Auto-Deploy to Displays | 2025-12-13 |
| Always-Live Displays | 2025-12-13 |
| Signup PWA Push Notifications | 2025-12-13 |
| Signup PWA Offline Support | 2025-12-13 |
| Backup Scheduling UI | 2025-12-13 |
| Panic Mode / Emergency Controls | 2025-12-14 |
| Discord Bot Integration | 2025-12-14 |
| Video Media Controls (Flyer) | 2025-12-14 |
| Three New Tournament Formats | 2025-12-15 |
| Bracket Editor Improvements | 2025-12-15 |
| Error Handling Standardization | 2025-12-15 |
| Input Validation Completion | 2025-12-15 |
| Health Check Diagnostics | 2025-12-15 |

See **COMPLETED_IMPROVEMENTS.txt** for full details.

---

## Dependencies & Blockers

### External Services Required
- **Stripe:** API keys for payment processing
- **SendGrid/Resend:** API key for transactional email
- **Discord:** Bot token and OAuth app for integration
- **start.gg:** Developer API access (application required)
- **Cloudflare:** Zone ID and API token for cache purging
- **Cloudflare R2:** (Optional) CDN hosting for pre-built Pi images

### Infrastructure Requirements
- VPS migration to bracketspot.com (target: Jan 5, 2026)
- SSL certificates for all subdomains
- Database backup automation

### Pi Onboarding Requirements (Phase 5.5)
- **npm packages:** `bonjour-service` (mDNS discovery), `qrcode` (QR generation)
- **Pi prerequisites:** Raspberry Pi OS Lite (64-bit), network access during setup
- **Server requirements:** Port 9300 available for mDNS (LAN discovery only)

---

## Success Metrics

### Launch Readiness (Phase 1-2 Complete)
- Zero blank-screen incidents during 10+ test tournaments
- < 500ms average API response time
- 99.9% WebSocket uptime during events

### Revenue Targets (Phase 3 Complete)
- Stripe payment processing functional
- At least 1 paid subscription tier available
- Email confirmation system operational

### Growth Metrics (Phase 5 Complete)
- Support 3+ concurrent tournaments
- 5+ referee accounts active
- Integration with 1 external platform (Discord or start.gg)

---

## Contact

**Repository:** https://github.com/rick0490/tournament-control-center (private)
**Domain:** bracketspot.com (migration pending)
**Current:** admin.despairhardware.com
