# Tournament Dashboard - Quick Reference

## 🚀 Quick Start (MacBook Pro)

```bash
python3 tournament_setup.py
```

Then follow the prompts!

## 📋 File Locations

**On MagicMirror:**
- Config: `/root/tournament-dashboard/MagicMirror-bracket/config/config.js`
- Flyers: `/root/tournament-dashboard/MagicMirror-bracket/flyers/`
- Module: `/root/tournament-dashboard/MagicMirror-bracket/modules/MMM-BracketView/`

**On MacBook:**
- Script: `tournament_setup.py` (copy this to your Mac)
- Documentation: `LAPTOP_SETUP.md`

## 🎮 Available Games

1. **Super Smash Bros Ultimate** → `ssbu_flyer.png`
2. **Mario Kart Wii** → `mkw_flyer.png`
3. **Custom Game** → (you specify the flyer)

## 🌐 Network Info

- **MagicMirror Display:** `http://MAGIC_MIRROR_IP:8081`
- **API Endpoint:** `http://MAGIC_MIRROR_IP:3000/api/tournament/update`
- **Status Check:** `http://MAGIC_MIRROR_IP:3000/api/tournament/status`

## ⏰ Display Schedule (Central Time)

| Time | Display Behavior |
|------|-----------------|
| Before 6pm | Flyer only |
| 6pm - 8pm | Rotates: 2 min flyer, 15 sec bracket |
| After 8pm | Bracket only |

## 🔧 Starting MagicMirror

```bash
cd /root/tournament-dashboard/MagicMirror-bracket
node --run server
```

Then open browser to: `http://localhost:8081`

## 🧪 Testing the API

```bash
# Health check
curl http://localhost:3000/api/tournament/status

# Send tournament update
curl -X POST http://localhost:3000/api/tournament/update \
  -H "Content-Type: application/json" \
  -d '{"flyer": "mkw_flyer.png", "bracketUrl": "http://challonge.com/y8ltomds/module?scale_to_fit=1"}'
```

## 📝 Challonge URL Format

**What you paste in the script:**
```
https://challonge.com/y8ltomds
```

**What gets sent to MagicMirror:**
```
http://challonge.com/y8ltomds/module?scale_to_fit=1
```

The script automatically converts it!

## 🎨 Adding New Flyers

1. Create your flyer image (PNG recommended)
2. Copy to MagicMirror: `/root/tournament-dashboard/MagicMirror-bracket/flyers/`
3. Use option "3 - Custom Game" in the script
4. Enter the filename (e.g., `my_tournament.png`)

## 📱 Typical Tournament Night Workflow

**Before the tournament (on your MacBook):**
1. Open Terminal
2. Run: `python3 tournament_setup.py`
3. Select your game (1 or 2)
4. Create your Challonge bracket and paste the URL
5. Confirm

**MagicMirror automatically:**
- Shows the flyer before 6pm
- Rotates flyer/bracket during registration (6-8pm)
- Shows bracket only after 8pm

## 🛠️ Configuration Files

### Change Display Times
Edit: `config/config.js`
```javascript
registrationStartHour: 18,  // 6pm
registrationEndHour: 20,    // 8pm
timezone: "America/Chicago"
```

### Change Rotation Timing
Edit: `config/config.js`
```javascript
flyerDisplaySeconds: 120,    // 2 minutes
bracketDisplaySeconds: 15,   // 15 seconds
```

### Change Default Flyer
Edit: `config/config.js`
```javascript
defaultFlyer: "mkw_flyer.png",
```

## 🐛 Troubleshooting

**Flyer not showing?**
- Check the file exists in `/flyers/` directory
- Restart MagicMirror server
- Refresh browser

**Bracket not showing?**
- Make sure you sent the tournament update via the script
- Check it's after registration start time
- Verify Challonge URL is correct

**Can't connect from MacBook?**
- Verify MagicMirror IP address is correct
- Make sure both devices are on the same network
- Check MagicMirror server is running

**API not responding?**
- Make sure a browser is connected to MagicMirror
- Check logs: API server only starts after browser connects
- Verify port 3000 is not blocked

## 📞 API Reference

### POST `/api/tournament/update`
Updates the tournament display

**Request:**
```json
{
  "flyer": "mkw_flyer.png",
  "bracketUrl": "http://challonge.com/y8ltomds/module?scale_to_fit=1"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Tournament updated successfully",
  "data": {
    "flyer": "mkw_flyer.png",
    "bracketUrl": "http://challonge.com/y8ltomds/module?scale_to_fit=1"
  }
}
```

### GET `/api/tournament/status`
Health check endpoint

**Response:**
```json
{
  "success": true,
  "message": "MMM-BracketView API is running",
  "timestamp": "2025-11-16T03:00:00.000Z"
}
```
