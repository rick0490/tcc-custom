# Game Configuration System - Complete Guide

## Overview

The Tournament Signup app now features a **dynamic game configuration system** that automatically displays game-specific rules and prizes based on the current tournament's game.

## How It Works

1. **Admin sets up tournament** via admin dashboard (e.g., "SSBU Weekly")
2. **Tournament game name** is stored in Challonge (e.g., "Super Smash Bros. Ultimate")
3. **Signup app detects game** when loading rules page
4. **Game-specific config** is loaded from `game-configs.json`
5. **Rules and prizes** automatically update to match the game

---

## Configuration File

**Location**: `/root/tournament-dashboard/tournament-signup/game-configs.json`

### Structure

```json
{
  "game-key": {
    "name": "Full Game Name",
    "shortName": "Abbreviation",
    "rules": [
      {
        "title": "Rule Title",
        "description": "Rule description..."
      }
    ],
    "prizes": [
      {
        "place": 1,
        "position": "1st Place",
        "emoji": "🥇",
        "amount": 100,
        "gradient": "CSS gradient",
        "extras": ["Bonus 1", "Bonus 2"]
      }
    ],
    "additionalInfo": [
      "Additional info bullet 1",
      "Additional info bullet 2"
    ]
  }
}
```

---

## Supported Games (Out of the Box)

### 1. Super Smash Bros. Ultimate (SSBU)
- **Game Key**: `ssbu`
- **Triggers**: Game name contains "ultimate" or "ssbu"
- **Prizes**: $150 / $75 / $35
- **Rules**: 10 SSBU-specific rules (stocks, stages, items, etc.)

### 2. Super Smash Bros. Melee
- **Game Key**: `melee`
- **Triggers**: Game name contains "melee"
- **Prizes**: $100 / $50 / $25
- **Rules**: 10 Melee-specific rules (UCF, wobbling, ledge grabs, etc.)

### 3. Mario Kart 8 Deluxe (MK8DX)
- **Game Key**: `mk8`
- **Triggers**: Game name contains "mario kart", "mk8", or "mk8dx"
- **Prizes**: $100 / $50 / $25
- **Rules**: 10 MK8DX-specific rules (150cc, items, disconnect rules, etc.)

### 4. Street Fighter 6
- **Game Key**: `sf6`
- **Triggers**: Game name contains "street fighter" or "sf6"
- **Prizes**: $125 / $60 / $30
- **Rules**: 10 SF6-specific rules (control types, DLC characters, etc.)

### 5. Default (Fallback)
- **Game Key**: `default`
- **Triggers**: Any game not matched above
- **Prizes**: $100 / $50 / $25
- **Rules**: 10 generic tournament rules

---

## Adding a New Game

### Step 1: Edit `game-configs.json`

Add a new game configuration:

```json
{
  "tekken8": {
    "name": "Tekken 8",
    "shortName": "T8",
    "rules": [
      {
        "title": "Check-In Required",
        "description": "All participants must check in before the tournament starts."
      },
      {
        "title": "Match Format",
        "description": "All matches are best-of-3 rounds. Finals are best-of-5."
      },
      {
        "title": "Stage Selection",
        "description": "Random stage select. No stage bans. Infinite Azure stage banned."
      },
      {
        "title": "Character Selection",
        "description": "Winner keeps character. Loser may switch."
      },
      {
        "title": "DLC Characters",
        "description": "All DLC characters are legal including newest releases."
      }
    ],
    "prizes": [
      {
        "place": 1,
        "position": "1st Place",
        "emoji": "🥇",
        "amount": 120,
        "gradient": "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
        "extras": ["Instagram Feature", "King of Iron Fist"]
      },
      {
        "place": 2,
        "position": "2nd Place",
        "emoji": "🥈",
        "amount": 60,
        "gradient": "linear-gradient(135deg, #c0c0c0 0%, #909090 100%)",
        "extras": ["Instagram Feature"]
      },
      {
        "place": 3,
        "position": "3rd Place",
        "emoji": "🥉",
        "amount": 30,
        "gradient": "linear-gradient(135deg, #cd7f32 0%, #8b5a2b 100%)",
        "extras": ["Instagram Feature"]
      }
    ],
    "additionalInfo": [
      "Heat System is enabled",
      "Bring your own arcade stick or controller",
      "Plugged-in controllers required (wireless banned)",
      "Follow us on Instagram @neilsbahr for updates"
    ]
  }
}
```

### Step 2: Update Game Mapping

Edit `/root/tournament-dashboard/tournament-signup/server.js`:

```javascript
function getGameConfigKey(gameName) {
	if (!gameName) return 'default';

	const lowerGame = gameName.toLowerCase();

	// Add your new game here
	if (lowerGame.includes('tekken') || lowerGame === 't8') return 'tekken8';

	// Existing games...
	if (lowerGame.includes('ultimate') || lowerGame === 'ssbu') return 'ssbu';
	// ...

	return 'default';
}
```

### Step 3: Restart Service

```bash
sudo systemctl restart tournament-signup
```

### Step 4: Test

```bash
# Check logs to confirm config loaded
sudo journalctl -u tournament-signup -n 5

# Should show: "Loaded game configurations: default, ssbu, melee, mk8, sf6, tekken8"

# Test API endpoint
curl http://localhost:3001/api/game-config
```

---

## Modifying Existing Game Configs

### Change Prize Amounts

Edit `game-configs.json`:

```json
"ssbu": {
  "prizes": [
    {
      "place": 1,
      "amount": 200,  // Changed from 150 to 200
      ...
    }
  ]
}
```

Restart service:
```bash
sudo systemctl restart tournament-signup
```

### Add/Remove Rules

Edit `game-configs.json`:

```json
"ssbu": {
  "rules": [
    ...existing rules...,
    {
      "title": "New Rule",
      "description": "This is a new rule we're adding."
    }
  ]
}
```

### Update Additional Info

```json
"ssbu": {
  "additionalInfo": [
    "New info line 1",
    "New info line 2",
    "Follow us on Instagram <a href=\"...\" class=\"...\">@neilsbahr</a>"
  ]
}
```

---

## Testing Different Game Configs

### Method 1: Change Tournament Game Name (via Admin Dashboard)

1. Open admin dashboard: `https://admin.despairhardware.com`
2. Create new tournament or update existing
3. Set **Game Name** to one of the supported games:
   - "Super Smash Bros. Ultimate" → loads SSBU config
   - "Melee" → loads Melee config
   - "Mario Kart 8 Deluxe" → loads MK8 config
   - "Street Fighter 6" → loads SF6 config
   - "Anything Else" → loads default config

### Method 2: Test API Endpoint Directly

```bash
# Current tournament's game config
curl http://localhost:3001/api/game-config | jq '.gameKey'

# Should return: "ssbu", "melee", "mk8", "sf6", or "default"
```

### Method 3: View Rules Page

1. Visit: `https://signup.despairhardware.com/rules`
2. Rules and prizes will dynamically load based on current tournament game
3. Check browser console for loaded game key:
   ```
   Loaded game config: ssbu
   ```

---

## Game Matching Logic

The system uses **fuzzy matching** to detect games:

| Game Name in Challonge | Detected Key | Config Loaded |
|-------------------------|--------------|---------------|
| "Super Smash Bros. Ultimate" | `ssbu` | SSBU config |
| "SSBU Weekly" | `ssbu` | SSBU config |
| "Melee Monthly" | `melee` | Melee config |
| "Super Smash Bros. Melee" | `melee` | Melee config |
| "Mario Kart 8" | `mk8` | MK8 config |
| "MK8DX Tourney" | `mk8` | MK8 config |
| "Street Fighter VI" | `sf6` | SF6 config |
| "SF6 Showdown" | `sf6` | SF6 config |
| "Rocket League" | `default` | Default config |
| "Custom Game" | `default` | Default config |

---

## Configuration Options Reference

### `rules` Array

Each rule object:
- **`title`** (string, required): Short rule title
- **`description`** (string, required): Detailed rule explanation

**Example**:
```json
{
  "title": "Pausing",
  "description": "Pausing loses you the current stock. Report accidental pauses to a TO."
}
```

### `prizes` Array

Each prize object:
- **`place`** (number, required): 1, 2, or 3
- **`position`** (string, required): Display text ("1st Place", "2nd Place", etc.)
- **`emoji`** (string, required): Emoji for visual flair (🥇, 🥈, 🥉)
- **`amount`** (number, required): Cash prize amount (no $ symbol)
- **`gradient`** (string, required): CSS gradient for card background
- **`extras`** (array, optional): Additional prizes/perks

**Gradients**:
- Gold: `linear-gradient(135deg, #f6d365 0%, #fda085 100%)`
- Silver: `linear-gradient(135deg, #c0c0c0 0%, #909090 100%)`
- Bronze: `linear-gradient(135deg, #cd7f32 0%, #8b5a2b 100%)`
- Custom: Use any CSS gradient

**Example**:
```json
{
  "place": 1,
  "position": "1st Place",
  "emoji": "🥇",
  "amount": 150,
  "gradient": "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
  "extras": ["Instagram Feature", "Tournament MVP"]
}
```

### `additionalInfo` Array

Array of strings for additional information bullets:
- Can include HTML for links
- Displayed with checkmark icons
- Good for venue info, social media, equipment rules

**Example**:
```json
[
  "Wireless controllers must be synced before each set",
  "Bring your own controller",
  "Follow us on Instagram <a href=\"https://instagram.com/neilsbahr\" target=\"_blank\" class=\"text-purple-600 hover:underline font-semibold\">@neilsbahr</a> for updates"
]
```

---

## API Reference

### GET `/api/game-config`

Returns game-specific configuration based on current tournament.

**Response**:
```json
{
  "success": true,
  "config": {
    "name": "Super Smash Bros. Ultimate",
    "shortName": "SSBU",
    "rules": [...],
    "prizes": [...],
    "additionalInfo": [...]
  },
  "gameKey": "ssbu",
  "gameName": "Super Smash Bros. Ultimate"
}
```

**Error Handling**:
- If no tournament active: Returns `default` config
- If game not recognized: Returns `default` config
- If Challonge API fails: Returns `default` config

---

## Troubleshooting

### Rules not updating after changing config

**Solution**:
```bash
# Restart the service
sudo systemctl restart tournament-signup

# Clear browser cache
# Hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)
```

### Wrong game config loading

**Check game name**:
```bash
curl http://localhost:3001/api/tournament | jq '.tournament.gameName'
```

**Check game mapping**:
```bash
# View server.js game mapping function
grep -A 10 "function getGameConfigKey" server.js
```

**Test specific game**:
- Change tournament game name in Challonge
- Or update admin dashboard tournament with different game

### Default config loading instead of game-specific

**Possible causes**:
1. Game name doesn't match any triggers
2. Typo in `game-configs.json`
3. Service not restarted after config change

**Debug**:
```bash
# Check loaded configs
sudo journalctl -u tournament-signup | grep "Loaded game configurations"

# Should show: default, ssbu, melee, mk8, sf6

# Test API
curl http://localhost:3001/api/game-config | jq '.gameKey'
```

### JSON syntax error in config file

**Symptom**: Service won't start or config doesn't load

**Solution**:
```bash
# Validate JSON syntax
cat game-configs.json | jq '.'

# If error, fix JSON (missing comma, bracket, etc.)
nano game-configs.json

# Restart service
sudo systemctl restart tournament-signup
```

---

## Best Practices

### 1. Keep Rules Concise
- Max 10 rules per game
- Each rule: 1-2 sentences
- Use clear, simple language

### 2. Prize Consistency
- Always include Instagram Feature for podium places
- Use standard gradients (gold/silver/bronze)
- Keep amounts reasonable and proportional

### 3. Additional Info
- 3-5 bullets max
- Include Instagram link
- Mention equipment requirements
- Add any game-specific notes (DLC, patches, etc.)

### 4. Backup Before Changes
```bash
# Backup config before editing
cp game-configs.json game-configs.json.backup

# If something breaks, restore:
cp game-configs.json.backup game-configs.json
sudo systemctl restart tournament-signup
```

### 5. Test After Changes
1. Edit config
2. Restart service
3. Visit `/rules` page
4. Verify rules/prizes updated
5. Check browser console for errors

---

## Future Enhancements

Potential additions to the game config system:

1. **Admin UI for Config Management**
   - Web interface to edit configs (no JSON editing)
   - Live preview of rules/prizes
   - Validation before saving

2. **Per-Tournament Overrides**
   - Custom rules for specific tournaments
   - Override prizes for special events
   - Tournament-specific additional info

3. **Stage/Map Lists**
   - Visual stage selection guides
   - Images for legal stages
   - Stage striking calculator

4. **Video Embeds**
   - Tutorial videos in rules page
   - Game-specific how-to guides
   - Combo guides, tech explanations

5. **Multi-Language Support**
   - Spanish, French, etc.
   - Configurable per tournament

---

## Examples

### Example: Adding Guilty Gear Strive

`game-configs.json`:
```json
{
  "ggst": {
    "name": "Guilty Gear Strive",
    "shortName": "GGST",
    "rules": [
      {
        "title": "Check-In Required",
        "description": "All participants must check in before the tournament starts. No-shows will be disqualified."
      },
      {
        "title": "Match Format",
        "description": "All matches are best-of-3 rounds. Grand Finals are best-of-5."
      },
      {
        "title": "Stage Selection",
        "description": "Random stage select. No stage bans."
      },
      {
        "title": "Character Selection",
        "description": "Winner must keep character. Loser may switch."
      },
      {
        "title": "Roman Cancel Usage",
        "description": "All Roman Cancel types are legal. No restrictions on RC usage."
      }
    ],
    "prizes": [
      {
        "place": 1,
        "position": "1st Place",
        "emoji": "🥇",
        "amount": 110,
        "gradient": "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
        "extras": ["Instagram Feature", "Heaven or Hell Champion"]
      },
      {
        "place": 2,
        "position": "2nd Place",
        "emoji": "🥈",
        "amount": 55,
        "gradient": "linear-gradient(135deg, #c0c0c0 0%, #909090 100%)",
        "extras": ["Instagram Feature"]
      },
      {
        "place": 3,
        "position": "3rd Place",
        "emoji": "🥉",
        "amount": 25,
        "gradient": "linear-gradient(135deg, #cd7f32 0%, #8b5a2b 100%)",
        "extras": ["Instagram Feature"]
      }
    ],
    "additionalInfo": [
      "All DLC characters are legal",
      "Wired controllers strongly recommended",
      "PS5 version preferred (faster load times)",
      "Follow us on Instagram @neilsbahr for updates"
    ]
  }
}
```

`server.js` (add to getGameConfigKey function):
```javascript
if (lowerGame.includes('guilty gear') || lowerGame === 'ggst') return 'ggst';
```

Restart and test:
```bash
sudo systemctl restart tournament-signup
curl http://localhost:3001/api/game-config | jq '.gameKey'
```

---

## Summary

The dynamic game configuration system provides:
- ✅ Automatic game detection from Challonge
- ✅ Game-specific rules and prizes
- ✅ Easy JSON-based configuration
- ✅ Fallback to default config
- ✅ Support for unlimited games
- ✅ No code changes needed for new games

**Location**: `/root/tournament-dashboard/tournament-signup/game-configs.json`
**API**: `GET /api/game-config`
**Service**: `tournament-signup.service`

---

For questions or support, check the service logs:
```bash
sudo journalctl -u tournament-signup -f
```
