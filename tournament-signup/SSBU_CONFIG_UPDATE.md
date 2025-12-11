# SSBU Configuration Update

**Date**: November 20, 2025
**Game**: Super Smash Bros. Ultimate
**Status**: ✅ Updated and Live

---

## Changes Made

### 🏆 Prize Pool Updated

| Place | Old Amount | New Amount |
|-------|------------|------------|
| 1st Place | $150 | **$30** |
| 2nd Place | $75 | **$20** |
| 3rd Place | $35 | **$10** |

**Total Prize Pool**: $60 (down from $260)

---

## 📋 Tournament Rules (Updated)

### Rule #1: Check-In Required
All participants must check in before the tournament starts. No-shows will be disqualified.

### Rule #2: Tournament Format
**Single Elimination bracket. 1 vs 1. 32-player cap.**

### Rule #3: Match Format
**All matches are best-of-3 games.**

### Rule #4: Stock & Time
**3 stocks, 7-minute timer. If time runs out, Sudden Death will determine the winner.**

### Rule #5: Stage Selection
**Battlefield and Omega stages only. No other stages are legal.**

### Rule #6: Items
**All items are OFF. No items will spawn during matches.**

### Rule #7: Character Selection
All characters are legal. Players may switch characters between games.

### Rule #8: Pausing
Pausing during a match will result in loss of stock. Report accidental pauses to a TO immediately.

### Rule #9: Lateness
Players have 5 minutes to report to their station when called. Late arrivals forfeit the match.

### Rule #10: Conduct
Unsportsmanlike conduct, harassment, or cheating will result in immediate disqualification. Keep it friendly!

---

## ℹ️ Additional Information Updated

✅ **Entry is FREE - no entry fee required!**
✅ **BYOC (Bring Your Own Controller) - loaner controllers available if needed**
✅ All DLC characters are legal (including newest releases)
✅ Custom controls and button mapping are allowed
✅ Wireless controllers must be synced before each match
✅ Follow us on Instagram [@neilsbahr](https://www.instagram.com/neilsbahr) for updates

---

## Key Changes Summary

### Before (Previous Config):
- ❌ Prize pool: $150/$75/$35 ($260 total)
- ❌ Complex stage list with starters/counterpicks
- ❌ Stage striking rules
- ❌ Winner/loser stage banning system
- ❌ Best-of-5 for finals
- ❌ Different timeout rules

### After (New Config):
- ✅ Prize pool: $30/$20/$10 ($60 total)
- ✅ **Simple stage rule**: Battlefield and Omega only
- ✅ **Sudden Death on timeout**
- ✅ **Single Elimination** (not double)
- ✅ **32-player cap**
- ✅ **Best-of-3 for all matches**
- ✅ **Free entry** highlighted
- ✅ **BYOC with loaners** mentioned

---

## How Participants See It

When participants visit the rules page at `https://signup.despairhardware.com/rules`, they will see:

### Tournament Header
```
Super Smash Bros. Ultimate
SSBU
```

### Rules Section (10 numbered rules)
1. Check-In Required
2. Tournament Format (Single Elim, 1v1, 32-cap)
3. Match Format (Best-of-3)
4. Stock & Time (3 stocks, 7 min, Sudden Death)
5. Stage Selection (Battlefield/Omega only)
6. Items (All OFF)
7. Character Selection (All legal)
8. Pausing (Lose stock)
9. Lateness (5 min, forfeit if late)
10. Conduct (No toxicity)

### Prize Breakdown
```
🥇 1st Place: $30 + Instagram Feature
🥈 2nd Place: $20 + Instagram Feature
🥉 3rd Place: $10 + Instagram Feature
```

### Additional Info
- Entry is FREE
- BYOC with loaners available
- DLC characters legal
- Custom controls allowed
- Wireless sync required
- Instagram link

---

## Testing Results

### ✅ Service Status
```bash
$ sudo systemctl status tournament-signup
● Active: active (running)
```

### ✅ Configuration Loaded
```bash
$ curl http://localhost:3001/api/game-config | grep amount
"amount":30
"amount":20
"amount":10
```

### ✅ Rules Verified
```bash
$ curl http://localhost:3001/api/game-config | grep "Battlefield and Omega"
Battlefield and Omega stages only
```

### ✅ Free Entry Confirmed
```bash
$ curl http://localhost:3001/api/game-config | grep "Entry is FREE"
Entry is FREE
```

---

## Technical Details

**Configuration File**: `/root/tournament-dashboard/tournament-signup/game-configs.json`

**Section Updated**: `"ssbu"` object

**Lines Modified**: 79-158

**Service Restarted**: `sudo systemctl restart tournament-signup`

**API Endpoint**: `GET /api/game-config` (returns SSBU config when tournament game is SSBU)

---

## Verification Checklist

- [x] Prize amounts updated to $30/$20/$10
- [x] Rules simplified to 10 clear rules
- [x] Tournament format changed to Single Elimination
- [x] Stage selection simplified to Battlefield/Omega only
- [x] Sudden Death rule added for timeouts
- [x] 32-player cap mentioned
- [x] Best-of-3 for all matches
- [x] Free entry highlighted in additional info
- [x] BYOC with loaners mentioned
- [x] Service restarted successfully
- [x] API endpoint returning correct data
- [x] All rules displaying on frontend

---

## What Happens Next

1. **Current Tournament**: If game name is "Super Smash Bros. Ultimate" or contains "SSBU":
   - Rules page automatically shows these updated rules
   - Prizes show $30/$20/$10
   - Additional info shows "Entry is FREE" and BYOC details

2. **Future Tournaments**: Every SSBU tournament will use these rules/prizes by default

3. **Other Games**: Other game configs (Melee, MK8, SF6, etc.) remain unchanged

---

## How to Further Customize

If you need to adjust these rules or prizes in the future:

1. Edit the config file:
   ```bash
   nano /root/tournament-dashboard/tournament-signup/game-configs.json
   ```

2. Find the `"ssbu"` section (lines 79-158)

3. Make your changes:
   - Update prize amounts in `"prizes"` array
   - Modify rules in `"rules"` array
   - Change additional info in `"additionalInfo"` array

4. Save file and restart service:
   ```bash
   sudo systemctl restart tournament-signup
   ```

5. Verify changes:
   ```bash
   curl http://localhost:3001/api/game-config | grep amount
   ```

---

## Summary

✅ **SSBU tournament rules updated** to match your specifications
✅ **Prize pool changed** from $260 to $60 total
✅ **Rules simplified** to focus on core tournament format
✅ **Free entry emphasized** in additional information
✅ **BYOC with loaners** mentioned for participant clarity
✅ **Service running** and configuration live
✅ **Automatic detection** - works when tournament game is SSBU

The rules page at `https://signup.despairhardware.com/rules` will now display these updated rules and prizes for all Super Smash Bros. Ultimate tournaments! 🎮

---

**Configuration File**: `/root/tournament-dashboard/tournament-signup/game-configs.json`
**Service**: `tournament-signup.service` (Active)
**URL**: https://signup.despairhardware.com/rules
