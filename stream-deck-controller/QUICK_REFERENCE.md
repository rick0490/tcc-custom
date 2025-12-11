# Stream Deck Controller - Quick Reference Guide

## Physical Layout (3 rows x 5 columns)

```
┌─────┬─────┬─────┬─────┬─────┐
│  0  │  1  │  2  │  3  │  4  │  ← Row 0
├─────┼─────┼─────┼─────┼─────┤
│  5  │  6  │  7  │  8  │  9  │  ← Row 1
├─────┼─────┼─────┼─────┼─────┤
│ 10  │ 11  │ 12  │ 13  │ 14  │  ← Row 2
└─────┴─────┴─────┴─────┴─────┘
```

**Consistent Navigation (across all views):**
- Key 12 = Back
- Key 13 = HOME
- Key 14 = Exit/Cancel

---

## 1. MAIN VIEW (Home Screen)

**Purpose:** Overview of tournament matches, quick access to key functions.

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│ Live 1  │ Live 2  │ Open 1  │ Open 2  │ Open 3  │  ← Matches
├─────────┼─────────┼─────────┼─────────┼─────────┤
│   <     │    R    │    >    │    T    │    !    │  ← Nav + Actions
│  Prev   │ Refresh │  Next   │ Ticker  │ ANNOUNCE│
├─────────┼─────────┼─────────┼─────────┼─────────┤
│    S    │    #    │    B    │    H    │    X    │  ← Settings + Nav
│ Station │  Stats  │ Bright  │  HOME   │  Exit   │
└─────────┴─────────┴─────────┴─────────┴─────────┘
```

### Button Functions

| Key | Label | Color | Action |
|-----|-------|-------|--------|
| 0 | Live 1 | GREEN | Tap: Select match for control |
| 1 | Live 2 | GREEN | Tap: Select match for control |
| 2 | Open 1 | BLUE | Tap: Select match for control |
| 3 | Open 2 | BLUE | Tap: Select match for control |
| 4 | Open 3 | BLUE | Tap: Select match for control |
| 5 | Prev | PURPLE | Tap: Previous page of matches |
| 6 | Refresh | CYAN | Tap: Refresh tournament data from server |
| 7 | Next | PURPLE | Tap: Next page of matches |
| 8 | Ticker | BLUE | Tap: Open ticker presets menu |
| 9 | ANNOUNCE | YELLOW | Tap: Quick send first ticker preset |
| 10 | Station | ORANGE | Tap: Cycle station filter (All → TV 1 → TV 2 → All) |
| 11 | Stats | GREEN/PURPLE | Display: Shows live count or completed/total matches |
| 12 | Bright | GRAY | Tap: Cycle brightness (20% → 40% → 60% → 80% → 100%) |
| 13 | HOME | PURPLE | Tap: Return to this view |
| 14 | Exit | RED | Tap: Exit controller |

### Match Button Colors
- **GREEN** = Match is LIVE (underway)
- **BLUE** = Match is OPEN (ready to play)
- **GRAY** = Match is COMPLETE
- **DARK** = Match is PENDING (waiting)

### Long Press
- **Long press any match** (0.8s) = Quick START (marks match as underway)

---

## 2. MATCH CONTROL VIEW

**Purpose:** Control a specific match - start/stop, scores, winner, station assignment.

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│  P1     │  0 - 0  │  P2     │    W    │    W    │  ← Players + Winners
│ (name)  │ (score) │ (name)  │ P1 Win  │ P2 Win  │
├─────────┼─────────┼─────────┼─────────┼─────────┤
│    +    │    S    │    +    │   >/||  │    X    │  ← Quick Scores + Actions
│ +1 P1   │ Scores  │ +1 P2   │ START   │ Forfeit │
├─────────┼─────────┼─────────┼─────────┼─────────┤
│  TV 1   │  TV 2   │    <    │    H    │    O    │  ← Stations + Nav
│         │         │  Back   │  HOME   │ Reopen  │
└─────────┴─────────┴─────────┴─────────┴─────────┘
```

### Button Functions

| Key | Label | Color | Action |
|-----|-------|-------|--------|
| 0 | P1 Name | BLUE | Display: Player 1 name |
| 1 | Score | DARK_GRAY | Tap: Open score entry view |
| 2 | P2 Name | RED | Display: Player 2 name |
| 3 | P1 Win | BLUE | Tap: Declare P1 as winner (with current score) |
| 4 | P2 Win | RED | Tap: Declare P2 as winner (with current score) |
| 5 | +1 P1 | BLUE | Tap: Add 1 point to P1 (quick score) |
| 6 | Scores | PURPLE | Tap: Open detailed score entry |
| 7 | +1 P2 | RED | Tap: Add 1 point to P2 (quick score) |
| 8 | START/STOP | GREEN/ORANGE | Tap: Toggle match underway state |
| 9 | Forfeit | GRAY | Tap: Open forfeit dialog |
| 10 | TV 1 | GRAY/YELLOW | Tap: Assign/unassign to TV 1 station |
| 11 | TV 2 | GRAY/YELLOW | Tap: Assign/unassign to TV 2 station |
| 12 | Back | PURPLE | Tap: Return to main view |
| 13 | HOME | PURPLE | Tap: Return to main view |
| 14 | Reopen | YELLOW | Tap: Reopen a completed match |

### Station Assignment
- **GRAY** = Station not assigned to this match
- **YELLOW** = Station IS assigned to this match
- Tap to toggle assignment

### START/STOP Toggle
- Shows **START** (green) when match is NOT underway
- Shows **STOP** (orange) when match IS underway

---

## 3. SCORE ENTRY VIEW

**Purpose:** Detailed score adjustment with +/- controls for each player.

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│  P1     │    -    │  P1: X  │    +    │   P2    │  ← P1 Controls
│ (name)  │ -1 P1   │ (score) │ +1 P1   │ (name)  │
├─────────┼─────────┼─────────┼─────────┼─────────┤
│  X - X  │    -    │  P2: X  │    +    │    W    │  ← P2 Controls
│ (total) │ -1 P2   │ (score) │ +1 P2   │ Winner  │
├─────────┼─────────┼─────────┼─────────┼─────────┤
│    0    │    U    │    <    │    H    │    X    │  ← Actions + Nav
│  Clear  │ Submit  │  Back   │  HOME   │ Cancel  │
└─────────┴─────────┴─────────┴─────────┴─────────┘
```

### Button Functions

| Key | Label | Color | Action |
|-----|-------|-------|--------|
| 0 | P1 Name | BLUE | Display: Player 1 name |
| 1 | -1 | BLUE | Tap: Decrease P1 score by 1 |
| 2 | P1: X | BLUE | Display: Current P1 score |
| 3 | +1 | BLUE | Tap: Increase P1 score by 1 |
| 4 | P2 Name | RED | Display: Player 2 name |
| 5 | X - X | DARK_GRAY | Display: Total score (P1 - P2) |
| 6 | -1 | RED | Tap: Decrease P2 score by 1 |
| 7 | P2: X | RED | Display: Current P2 score |
| 8 | +1 | RED | Tap: Increase P2 score by 1 |
| 9 | Winner | GREEN | Tap: Declare winner based on higher score |
| 10 | Clear | GRAY | Tap: Reset both scores to 0 |
| 11 | Submit | CYAN | Tap: Save scores without declaring winner |
| 12 | Back | PURPLE | Tap: Return to match control view |
| 13 | HOME | PURPLE | Tap: Return to main view |
| 14 | Cancel | RED | Tap: Discard changes, return to match control |

### Notes
- Scores cannot go below 0
- Winner button only works if scores are not tied
- Submit saves scores but keeps match open

---

## 4. TICKER VIEW

**Purpose:** Send announcement messages to the match display.

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│ 5m Break│ Report  │ Starting│ Finals  │ Check-In│  ← Preset Row 1
├─────────┼─────────┼─────────┼─────────┼─────────┤
│Last Call│   ---   │   ---   │   ---   │   ---   │  ← Preset Row 2
├─────────┼─────────┼─────────┼─────────┼─────────┤
│   ---   │   ---   │    <    │    H    │    X    │  ← Reserved + Nav
│         │         │  Back   │  HOME   │ Cancel  │
└─────────┴─────────┴─────────┴─────────┴─────────┘
```

### Button Functions

| Key | Label | Color | Action |
|-----|-------|-------|--------|
| 0 | 5m Break | BLUE | Tap: Send "5 MINUTE BREAK" |
| 1 | Report | BLUE | Tap: Send "PLAYERS REPORT TO YOUR STATIONS" |
| 2 | Starting | BLUE | Tap: Send "MATCHES STARTING SOON" |
| 3 | Finals | BLUE | Tap: Send "GRAND FINALS STARTING NOW" |
| 4 | Check-In | BLUE | Tap: Send "CHECK-IN IS NOW OPEN" |
| 5 | Last Call | BLUE | Tap: Send "LAST CALL FOR CHECK-IN" |
| 6-9 | --- | DISABLED | Reserved for additional presets |
| 10-11 | --- | DISABLED | Reserved |
| 12 | Back | PURPLE | Tap: Return to main view |
| 13 | HOME | PURPLE | Tap: Return to main view |
| 14 | Cancel | RED | Tap: Return to main view |

### Presets (Configurable in config.json)
Default presets send messages for 5-10 seconds.

---

## 5. CONFIRM VIEW

**Purpose:** Confirm dangerous actions (forfeit, etc.)

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│         │         │         │         │ Message │  ← Key 4 shows message
├─────────┼─────────┼─────────┼─────────┼─────────┤
│         │         │         │         │    Y    │  ← Key 9 = Confirm
│         │         │         │         │ Confirm │
├─────────┼─────────┼─────────┼─────────┼─────────┤
│         │    N    │         │         │         │  ← Key 11 = Cancel
│         │ Cancel  │         │         │         │
└─────────┴─────────┴─────────┴─────────┴─────────┘
```

| Key | Label | Color | Action |
|-----|-------|-------|--------|
| 4 | Message | DARK_GRAY | Display: Confirmation message |
| 9 | Confirm | GREEN | Tap: Execute the action |
| 11 | Cancel | RED | Tap: Cancel and return to previous view |

---

## Color Reference

| Color | RGB | Meaning |
|-------|-----|---------|
| GREEN | (0, 170, 0) | Active/Underway/Success |
| BLUE | (0, 102, 204) | Ready/Open/Info |
| YELLOW | (204, 136, 0) | Attention/Warning/Assigned |
| RED | (204, 0, 0) | Danger/Exit/P2 |
| PURPLE | (102, 68, 170) | Navigation/System |
| CYAN | (0, 150, 150) | Refresh/Action |
| ORANGE | (200, 100, 0) | Settings/Config |
| GRAY | (60, 60, 60) | Inactive/Disabled |
| DARK_GRAY | (40, 40, 40) | Background/Default |

---

## Workflow Examples

### Quick Start a Match
1. From Main View, **tap a match** (keys 0-4) to select it
2. In Match Control, **tap START** (key 8) to mark underway

### Alternative: Long Press Quick Start
1. From Main View, **long press any match** (0.8s) to immediately start it

### Add Score and Declare Winner
1. Select match from Main View
2. Use **+1 P1** (key 5) or **+1 P2** (key 7) to add points
3. Tap **P1 Win** (key 3) or **P2 Win** (key 4) when done

### Detailed Score Entry
1. Select match from Main View
2. Tap **Scores** (key 6) to enter Score Entry view
3. Use **+/-** buttons to adjust each player's score
4. Tap **Winner** (key 9) to declare winner with entered score
5. Or tap **Submit** (key 11) to save score without declaring winner

### Assign Station
1. Select match from Main View
2. Tap **TV 1** (key 10) or **TV 2** (key 11) to assign
3. Tap again to unassign (toggle)

### Send Announcement
**Quick Method:**
- From Main View, tap **ANNOUNCE** (key 9) to send first preset

**Full Menu:**
1. From Main View, tap **Ticker** (key 8)
2. Tap any preset button to send that message

---

## Troubleshooting

### Stream Deck Not Responding
```bash
# Reset USB device
sudo usbreset 0fd9:00b9

# Restart controller
sudo systemctl restart stream-deck-controller
```

### Buttons Not Working
- Check if controller is running: `pgrep -la python`
- Check logs: `cat /tmp/controller.log`

### Data Not Updating
- Tap **Refresh** (key 6) to force update
- Check network connection to admin dashboard
