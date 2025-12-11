# MMM-BracketView Quick Start Guide

## What Was Created

Your MagicMirror now has a tournament bracket display module that can be controlled remotely via API calls from your laptop.

### Files Created

1. **Module Files** (`/modules/MMM-BracketView/`)
   - `MMM-BracketView.js` - Main module with display logic
   - `node_helper.js` - API server for remote control
   - `MMM-BracketView.css` - Fullscreen styling
   - `README.md` - Comprehensive documentation
   - `example_api_client.py` - Python script for remote control

2. **Configuration** (`/config/config.js`)
   - Module configured and ready to use
   - Network access enabled for remote API calls

## How It Works

### Time-Based Display Logic

**6:00 PM - 8:00 PM Central (Registration Period)**
- Shows flyer for 120 seconds
- Shows Challonge bracket for 15 seconds
- Loops continuously

**After 8:00 PM Central**
- Shows bracket fullscreen for the rest of the night

**Before Tournament Starts**
- Shows default flyer (`mkw_flyer.png`)

### Your Flyers

Located in `/flyers/`:
- `mkw_flyer.png` - Mario Kart Wii tournament
- `ssbu_flyer.png` - Super Smash Bros Ultimate tournament

## Remote Control from Your Laptop

### Python Script Usage

Copy `example_api_client.py` to your laptop and use it like this:

```bash
# Check if MagicMirror API is running
python3 example_api_client.py <MAGIC_MIRROR_IP> --status

# Start a Mario Kart Wii tournament
python3 example_api_client.py <MAGIC_MIRROR_IP> \
  --flyer mkw_flyer.png \
  --bracket https://challonge.com/mkw_weekly_123

# Start a Smash Bros tournament
python3 example_api_client.py <MAGIC_MIRROR_IP> \
  --flyer ssbu_flyer.png \
  --bracket https://challonge.com/ssbu_weekly_456

# Update just the bracket URL
python3 example_api_client.py <MAGIC_MIRROR_IP> \
  --bracket https://challonge.com/new_bracket
```

### Using curl (Linux/Mac)

```bash
# Update tournament
curl -X POST http://<MAGIC_MIRROR_IP>:8081/api/tournament/update \
  -H "Content-Type: application/json" \
  -d '{
    "flyer": "mkw_flyer.png",
    "bracketUrl": "https://challonge.com/your_tournament"
  }'

# Check status
curl http://<MAGIC_MIRROR_IP>:8081/api/tournament/status
```

### Using Python requests library

```python
import requests

def start_tournament(magic_mirror_ip, flyer_name, bracket_url):
    url = f"http://{magic_mirror_ip}:8081/api/tournament/update"

    payload = {
        "flyer": flyer_name,
        "bracketUrl": bracket_url
    }

    response = requests.post(url, json=payload)
    print(response.json())

# Example: Start MKW tournament
start_tournament(
    magic_mirror_ip="192.168.1.100",  # Replace with actual IP
    flyer_name="mkw_flyer.png",
    bracket_url="https://challonge.com/mkw_weekly_123"
)
```

## Network Setup

### MagicMirror Side (Already Configured)

The `config.js` is already set up to accept remote connections:
```javascript
address: "0.0.0.0",  // Listen on all network interfaces
ipWhitelist: [],     // Allow all IP addresses
```

API server runs on port **8081**

### Your Laptop Side

1. Make sure you can ping the MagicMirror device
2. Find the MagicMirror IP address:
   ```bash
   # On MagicMirror device
   hostname -I
   ```
3. Install Python requests library (if needed):
   ```bash
   pip install requests
   ```

## Starting MagicMirror

```bash
cd /root/tournament-dashboard/MagicMirror-bracket
npm start
```

For development/debugging:
```bash
npm start dev
```

## Testing the Setup

1. **Start MagicMirror** on the mirror device
2. **From your laptop**, check the API status:
   ```bash
   curl http://<MAGIC_MIRROR_IP>:8081/api/tournament/status
   ```
3. **Send a test tournament update**:
   ```bash
   python3 example_api_client.py <MAGIC_MIRROR_IP> \
     --flyer mkw_flyer.png \
     --bracket https://challonge.com
   ```

## API Endpoints

### POST `/api/tournament/update`
Update tournament display

**Request Body:**
```json
{
  "flyer": "mkw_flyer.png",
  "bracketUrl": "https://challonge.com/your_tournament"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Tournament updated successfully",
  "data": {
    "flyer": "mkw_flyer.png",
    "bracketUrl": "https://challonge.com/your_tournament"
  }
}
```

### GET `/api/tournament/status`
Check if API is running

**Response:**
```json
{
  "success": true,
  "message": "MMM-BracketView API is running",
  "timestamp": "2025-11-16T02:30:00.000Z"
}
```

## Workflow Example: Weekly Tournament

### Before 6:00 PM
From your laptop, send the tournament info:
```bash
python3 example_api_client.py 192.168.1.100 \
  --flyer mkw_flyer.png \
  --bracket https://challonge.com/mkw_weekly_123
```

The MagicMirror will show the flyer until registration starts.

### 6:00 PM - Registration Begins
- MagicMirror automatically starts rotating
- Shows flyer for 2 minutes
- Shows bracket for 15 seconds
- Loops until 8:00 PM

### 8:00 PM - Registration Ends
- MagicMirror automatically switches to bracket-only display
- Shows bracket fullscreen for the rest of the night

### No manual intervention needed!
The time-based logic is automatic based on Central Time.

## Troubleshooting

### Can't connect to API
1. Check MagicMirror is running
2. Verify IP address is correct
3. Check firewall isn't blocking port 8081
4. Ping the MagicMirror device from your laptop

### Flyer not showing
1. Verify flyer file exists in `/flyers/` directory
2. Check filename matches exactly (case-sensitive)
3. Ensure it's a valid PNG file

### Bracket not loading
1. Make sure Challonge URL is correct
2. Verify the bracket is public/embeddable
3. Test the URL in a regular web browser first

### Time rotation not working
1. Check the MagicMirror device's system time
2. Verify timezone is set to Central Time in config
3. Look at MagicMirror logs for errors

## Next Steps

1. Get your MagicMirror's IP address
2. Copy `example_api_client.py` to your laptop
3. Test the connection with `--status` flag
4. Send your first tournament update!

## Need Help?

Check the full documentation:
- `/modules/MMM-BracketView/README.md`

MagicMirror documentation:
- https://docs.magicmirror.builders/
