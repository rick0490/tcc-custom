# Dynamic Game Configuration System - Implementation Summary

**Date**: November 20, 2025
**Feature**: Game-specific rules and prizes that change automatically based on tournament game
**Status**: ✅ Fully Implemented and Tested

---

## 🎯 Problem Solved

**Before**: Rules and prizes were hardcoded in HTML. Every game had the same generic rules and prize amounts.

**After**: Rules and prizes dynamically change based on the game being played. SSBU tournaments show SSBU-specific rules, Melee shows Melee rules, etc.

---

## 🚀 How It Works

```
1. Tournament created in Challonge
   ↓
2. Game name set (e.g., "Super Smash Bros. Ultimate")
   ↓
3. User visits signup.despairhardware.com/rules
   ↓
4. JavaScript fetches /api/game-config
   ↓
5. Server reads game name from Challonge
   ↓
6. Server matches game → config key (e.g., "ultimate" → "ssbu")
   ↓
7. Server returns game-specific config from game-configs.json
   ↓
8. Frontend dynamically renders rules, prizes, and info
```

---

## 📁 Files Created/Modified

### New Files (2)
```
game-configs.json               # Game configurations (default, ssbu, melee, mk8, sf6)
GAME_CONFIG_GUIDE.md           # Complete documentation
DYNAMIC_CONFIG_SUMMARY.md      # This file
```

### Modified Files (2)
```
server.js                      # Added game config loading + API endpoint
public/rules.html              # Completely rewritten for dynamic content
```

---

## 🎮 Supported Games Out-of-the-Box

| Game | Config Key | Prize Pool | Special Rules |
|------|------------|------------|---------------|
| **Super Smash Bros. Ultimate** | `ssbu` | $150/$75/$35 | 10 SSBU-specific rules |
| **Super Smash Bros. Melee** | `melee` | $100/$50/$25 | UCF, wobbling, ledge grabs |
| **Mario Kart 8 Deluxe** | `mk8` | $100/$50/$25 | Swiss + bracket, 150cc |
| **Street Fighter 6** | `sf6` | $125/$60/$30 | Modern/Classic controls |
| **Default (any other game)** | `default` | $100/$50/$25 | Generic tournament rules |

---

## 🔧 Configuration Structure

Each game config in `game-configs.json`:

```json
{
  "ssbu": {
    "name": "Super Smash Bros. Ultimate",
    "shortName": "SSBU",
    "rules": [
      { "title": "...", "description": "..." }
    ],
    "prizes": [
      {
        "place": 1,
        "position": "1st Place",
        "emoji": "🥇",
        "amount": 150,
        "gradient": "linear-gradient(...)",
        "extras": ["Instagram Feature", "Tournament MVP"]
      }
    ],
    "additionalInfo": [
      "Bullet point 1",
      "Bullet point 2"
    ]
  }
}
```

---

## 📡 New API Endpoint

### `GET /api/game-config`

Returns game-specific configuration for current tournament.

**Example Response**:
```json
{
  "success": true,
  "config": {
    "name": "Super Smash Bros. Ultimate",
    "rules": [...],
    "prizes": [...],
    "additionalInfo": [...]
  },
  "gameKey": "ssbu",
  "gameName": "Super Smash Bros. Ultimate"
}
```

**Fallback Behavior**:
- No tournament active → returns `default` config
- Game not recognized → returns `default` config
- API error → returns `default` config

---

## ✨ Key Features

### 1. Automatic Game Detection
- Reads game name from Challonge API
- Fuzzy matching: "SSBU Weekly" → detects as SSBU
- Case-insensitive matching
- Supports abbreviations (MK8, SF6, etc.)

### 2. Dynamic Content Rendering
- Rules rendered from JSON array
- Prizes rendered with custom gradients
- Additional info with checkmark bullets
- Loading states while fetching data

### 3. Easy to Extend
- Add new game: edit JSON + add 1 line to server.js
- No HTML changes needed
- Restart service to apply changes
- No code compilation required

### 4. Graceful Fallbacks
- Unknown game → default config
- API failure → default config
- Invalid JSON → service logs error, uses default

---

## 🧪 Testing Results

### ✅ Service Status
```bash
$ sudo systemctl status tournament-signup
● Active: active (running)

$ sudo journalctl -u tournament-signup | grep "Loaded game configurations"
Loaded game configurations: default, ssbu, melee, mk8, sf6
```

### ✅ API Endpoint
```bash
$ curl http://localhost:3001/api/game-config | jq '.gameKey'
"ssbu"

$ curl http://localhost:3001/api/game-config | jq '.config.prizes[0].amount'
150
```

### ✅ Frontend Rendering
- Visit `http://localhost:3001/rules`
- Rules dynamically load based on current game
- Prizes show game-specific amounts
- Browser console shows: `Loaded game config: ssbu`

---

## 📝 Usage Examples

### Example 1: Running SSBU Tournament

1. Admin creates tournament: "SSBU Weekly #1"
2. Sets game name: "Super Smash Bros. Ultimate"
3. Participants visit rules page
4. See: 10 SSBU-specific rules, $150/$75/$35 prizes
5. Rules include stages, stocks, hazards, etc.

### Example 2: Running Melee Tournament

1. Admin creates tournament: "Melee Monthly"
2. Sets game name: "Melee"
3. Participants visit rules page
4. See: 10 Melee-specific rules, $100/$50/$25 prizes
5. Rules include UCF, wobbling limits, port priority, etc.

### Example 3: Running Custom Game Tournament

1. Admin creates tournament: "Rocket League 2v2"
2. Sets game name: "Rocket League"
3. Participants visit rules page
4. See: Default generic rules, $100/$50/$25 prizes
5. Rules cover general tournament conduct

---

## 🔄 How to Change Rules/Prizes

### Quick Prize Update

```bash
# Edit config file
nano /root/tournament-dashboard/tournament-signup/game-configs.json

# Find your game, change prize amounts:
"ssbu": {
  "prizes": [
    { "place": 1, "amount": 200 },  # Changed from 150
    { "place": 2, "amount": 100 },  # Changed from 75
    { "place": 3, "amount": 50 }    # Changed from 35
  ]
}

# Save file
# Restart service
sudo systemctl restart tournament-signup

# Verify
curl http://localhost:3001/api/game-config | jq '.config.prizes[0].amount'
# Should return: 200
```

### Add New Rule

```json
"ssbu": {
  "rules": [
    ...existing rules...,
    {
      "title": "Streaming",
      "description": "All matches may be streamed. Inform TO if you do not consent to streaming."
    }
  ]
}
```

Restart service after editing.

---

## ➕ Adding a New Game

### Step-by-Step: Adding Tekken 8

**1. Add configuration to `game-configs.json`:**
```json
{
  "tekken8": {
    "name": "Tekken 8",
    "shortName": "T8",
    "rules": [
      { "title": "Check-In Required", "description": "..." },
      { "title": "Match Format", "description": "Best-of-3, finals best-of-5" },
      ...
    ],
    "prizes": [
      { "place": 1, "position": "1st Place", "emoji": "🥇", "amount": 120, ... },
      { "place": 2, "position": "2nd Place", "emoji": "🥈", "amount": 60, ... },
      { "place": 3, "position": "3rd Place", "emoji": "🥉", "amount": 30, ... }
    ],
    "additionalInfo": [
      "Heat System enabled",
      "Bring your own controller"
    ]
  }
}
```

**2. Add game mapping to `server.js`:**

Find the `getGameConfigKey()` function and add:
```javascript
if (lowerGame.includes('tekken') || lowerGame === 't8') return 'tekken8';
```

**3. Restart service:**
```bash
sudo systemctl restart tournament-signup
```

**4. Test:**
- Create tournament with game name "Tekken 8"
- Visit rules page
- Verify Tekken-specific rules load

---

## 🐛 Troubleshooting

### Problem: Wrong game config loading

**Check current game:**
```bash
curl http://localhost:3001/api/tournament | jq '.tournament.gameName'
```

**Check which config is loading:**
```bash
curl http://localhost:3001/api/game-config | jq '.gameKey'
```

**Solution**: Update game name in Challonge or add new mapping in `server.js`

### Problem: Config not updating after edit

**Solution**:
```bash
# 1. Restart service
sudo systemctl restart tournament-signup

# 2. Hard refresh browser (Ctrl+Shift+R)

# 3. Verify config loaded
sudo journalctl -u tournament-signup | tail -5
```

### Problem: JSON syntax error

**Symptom**: Service logs show JSON parse error

**Debug**:
```bash
# Validate JSON
cat game-configs.json | jq '.'

# If error shown, fix syntax (missing comma, bracket, quote)
nano game-configs.json

# Restart service
sudo systemctl restart tournament-signup
```

---

## 📊 Comparison: Before vs After

### Before (Static)
```html
<!-- Hardcoded in HTML -->
<div class="rule-item">
  <div class="rule-number">1</div>
  <div>Check-In Required: All participants must check in...</div>
</div>
<div class="prize-badge">$100</div>
```

**Issues**:
- ❌ Same rules for every game
- ❌ Same prizes for every game
- ❌ Must edit HTML to change
- ❌ No game-specific content

### After (Dynamic)
```javascript
// Loaded from JSON
fetch('/api/game-config')
  .then(data => renderRules(data.config.rules))

// Rules and prizes change per game automatically
```

**Benefits**:
- ✅ Game-specific rules (SSBU ≠ Melee ≠ MK8)
- ✅ Game-specific prizes
- ✅ Edit JSON, no HTML changes
- ✅ Automatic game detection
- ✅ Easy to add new games

---

## 🎉 Summary

### What Was Built

A **fully dynamic game configuration system** that:
1. Detects game from Challonge API
2. Loads game-specific rules and prizes from JSON
3. Renders content dynamically on frontend
4. Falls back to default config gracefully
5. Supports unlimited games via simple JSON editing

### Files Involved

- **`game-configs.json`**: Game configurations (5 games included)
- **`server.js`**: API endpoint + game detection logic
- **`public/rules.html`**: Dynamic rendering frontend
- **`GAME_CONFIG_GUIDE.md`**: Complete documentation

### Benefits

- 🎮 **Game-specific content**: Different rules for each game
- 💰 **Flexible prizes**: Easy to change prize pools
- ⚡ **Fast updates**: Edit JSON, restart service
- 📱 **No code changes**: Add games without touching HTML/JS
- 🔄 **Automatic switching**: Changes when you switch games

### Next Steps

1. ✅ System is ready to use
2. Edit prizes/rules in `game-configs.json` as needed
3. Add new games following guide
4. Monitor logs: `sudo journalctl -u tournament-signup -f`

---

**Configuration Location**: `/root/tournament-dashboard/tournament-signup/game-configs.json`
**Documentation**: `/root/tournament-dashboard/tournament-signup/GAME_CONFIG_GUIDE.md`
**API Endpoint**: `GET /api/game-config`
**Service**: `tournament-signup.service`

---

✨ **Dynamic rules and prizes are now live!** ✨
