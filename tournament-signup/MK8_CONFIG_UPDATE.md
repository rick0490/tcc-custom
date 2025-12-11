# Mario Kart World Configuration Update

**Date**: November 20, 2025
**Game**: Mario Kart World (formerly Mario Kart 8 Deluxe)
**Status**: ✅ Updated and Live

---

## Changes Made

### 🎮 **Game Name Updated**

| Before | After |
|--------|-------|
| Mario Kart 8 Deluxe (MK8DX) | **Mario Kart World (MKW)** |

### 🏆 **Prize Pool Updated**

| Place | Old Amount | New Amount |
|-------|------------|------------|
| 1st Place | $100 | **$30** |
| 2nd Place | $50 | **$20** |
| 3rd Place | $25 | **$10** |

**Total Prize Pool**: $60 (down from $175)

### ❌ **Removed Prize Extras**
- Instagram Feature removed from all prize tiers

---

## 📋 Tournament Rules (Updated)

### Rule #1: Tournament Format
**Single Elimination bracket. 1 vs 1.**

### Rule #2: Match Format
**Each match is a 3-race Grand Prix. Player with most points at the end of 3 races advances.**

### Rule #3: Race Settings
**150cc, Normal Items, Normal COMs.**

### Rule #4: Track Selection
**Random track selection. No track bans.**

### Rule #5: Scoring
**Standard Mario Kart scoring applies. Points accumulated across all 3 races determine the winner.**

### Rule #6: Lateness
Players have 2 minutes to join lobby when match is called. Late arrivals forfeit the match.

### Rule #7: Conduct
Unsportsmanlike conduct, harassment, or cheating will result in immediate disqualification. Keep it friendly!

---

## ℹ️ Additional Information

✅ **Entry is FREE - no entry fee required!**
✅ **BYOC (Bring Your Own Controller) - loaner controllers available if needed**
✅ All DLC tracks (Booster Course Pass) are included
✅ All vehicles and characters are allowed
✅ Follow us on Instagram [@neilsbahr](https://www.instagram.com/neilsbahr) for updates

---

## Key Changes Summary

### Before (Previous Config):
- ❌ Game: "Mario Kart 8 Deluxe"
- ❌ Prize pool: $100/$50/$25 ($175 total)
- ❌ Format: Swiss rounds + top 8 bracket
- ❌ Match: 4 races per match
- ❌ Complex scoring system (15pts, 12pts, etc.)
- ❌ Disconnect rules
- ❌ Tiebreaker rules
- ❌ 3-minute lateness window

### After (New Config):
- ✅ Game: **"Mario Kart World"**
- ✅ Prize pool: $30/$20/$10 ($60 total)
- ✅ Format: **Single Elimination**
- ✅ Match: **3-race Grand Prix**
- ✅ Scoring: **Standard Mario Kart scoring**
- ✅ Settings: **150cc, Normal Items, Normal COMs**
- ✅ Tracks: **Random selection**
- ✅ **2-minute lateness window**
- ✅ **Free entry** highlighted
- ✅ **BYOC with loaners** mentioned

---

## Tournament Format Explained

### Single Elimination
- Players compete in a bracket
- Lose once = eliminated
- Winner advances until final champion

### 3-Race Grand Prix Format
Each match consists of:
1. **Race 1** - Random track
2. **Race 2** - Random track
3. **Race 3** - Random track

**Winner Determination**: Player with most cumulative points after all 3 races advances

**Example Match**:
```
Player A finishes: 1st, 3rd, 2nd = 15 + 10 + 12 = 37 points
Player B finishes: 2nd, 1st, 4th = 12 + 15 + 8 = 35 points

Player A wins and advances! ✅
```

### Race Settings
- **Speed**: 150cc
- **Items**: Normal (all items enabled)
- **COMs**: Normal (computer players active)
- **Tracks**: Random selection from all tracks
- **Vehicles/Characters**: All allowed

---

## How Participants See It

When participants visit the rules page at `https://signup.despairhardware.com/rules` for a Mario Kart World tournament:

### Tournament Header
```
Mario Kart World
MKW
```

### Rules Section (7 numbered rules)
1. Tournament Format (Single Elim, 1v1)
2. Match Format (3-race GP, most points advances)
3. Race Settings (150cc, Normal Items, Normal COMs)
4. Track Selection (Random)
5. Scoring (Standard MK scoring)
6. Lateness (2 min, forfeit if late)
7. Conduct (No toxicity)

### Prize Breakdown
```
🥇 1st Place: $30
🥈 2nd Place: $20
🥉 3rd Place: $10
```

### Additional Info
- Entry is FREE
- BYOC with loaners available
- All DLC tracks included
- All vehicles/characters allowed
- Instagram link

---

## Game Name Matching

The system will detect Mario Kart World tournaments when the game name contains:
- "Mario Kart" (case-insensitive)
- "MK8"
- "MK8DX"
- "Mario Kart World"

All of these will load the Mario Kart World configuration automatically.

---

## Testing Verification

### ✅ Service Status
```bash
$ sudo systemctl status tournament-signup
● Active: active (running)

$ sudo journalctl -u tournament-signup | grep "Loaded game"
Loaded game configurations: default, ssbu, melee, mk8, sf6
```

### ✅ Configuration Values
- Game name: "Mario Kart World" ✓
- Short name: "MKW" ✓
- Rules count: 7 ✓
- Prize amounts: $30/$20/$10 ✓
- Prize extras: Empty arrays ✓
- Free entry mentioned: Yes ✓
- BYOC mentioned: Yes ✓

---

## Rules Comparison

| Aspect | Old (MK8DX) | New (MKW) |
|--------|-------------|-----------|
| **Rules Count** | 10 rules | **7 rules** |
| **Format** | Swiss + Top 8 | **Single Elim** |
| **Races per Match** | 4 races | **3 races** |
| **Scoring** | Complex (15/12/10 pts) | **Standard MK** |
| **COMs** | Not mentioned | **Normal COMs** |
| **Lateness** | 3 minutes | **2 minutes** |
| **Prizes** | $100/$50/$25 | **$30/$20/$10** |
| **Entry Fee** | Not mentioned | **FREE** |

---

## Technical Details

**Configuration File**: `/root/tournament-dashboard/tournament-signup/game-configs.json`

**Section Updated**: `"mk8"` object (lines 230-296)

**Service Restarted**: `sudo systemctl restart tournament-signup`

**Config Key**: `mk8` (unchanged - maintains backward compatibility)

**API Endpoint**: `GET /api/game-config` (returns MKW config when tournament game contains "mario kart")

---

## Verification Checklist

- [x] Game name changed to "Mario Kart World"
- [x] Short name changed to "MKW"
- [x] Prize amounts updated to $30/$20/$10
- [x] Instagram Feature extras removed
- [x] Rules simplified to 7 clear rules
- [x] Tournament format changed to Single Elimination
- [x] Match format changed to 3-race GP
- [x] Race settings specified: 150cc, Normal Items, Normal COMs
- [x] Random track selection mentioned
- [x] Standard scoring applies
- [x] Lateness changed to 2 minutes
- [x] Free entry highlighted in additional info
- [x] BYOC with loaners mentioned
- [x] Service restarted successfully
- [x] Configuration loaded correctly

---

## Future Edits

To update Mario Kart World rules or prizes:

```bash
# 1. Edit config file
nano /root/tournament-dashboard/tournament-signup/game-configs.json

# 2. Find "mk8" section (around line 230)

# 3. Make changes to rules, prizes, or additionalInfo

# 4. Save and restart
sudo systemctl restart tournament-signup

# 5. Verify
curl http://localhost:3001/api/game-config
```

---

## Summary

✅ **Mario Kart World tournament rules updated** to match your specifications
✅ **Game name changed** from "Mario Kart 8 Deluxe" to "Mario Kart World"
✅ **Prize pool reduced** from $175 to $60 total
✅ **Format simplified** to Single Elimination with 3-race GPs
✅ **Race settings specified**: 150cc, Normal Items, Normal COMs
✅ **Free entry emphasized** in additional information
✅ **BYOC with loaners** mentioned for participant clarity
✅ **Service running** and configuration live

The rules page will now display these updated rules and prizes for all Mario Kart World tournaments! 🏎️

---

**Configuration File**: `/root/tournament-dashboard/tournament-signup/game-configs.json`
**Service**: `tournament-signup.service` (Active)
**URL**: https://signup.despairhardware.com/rules
