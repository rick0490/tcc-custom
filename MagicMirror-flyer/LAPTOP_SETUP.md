# Tournament Setup - MacBook Pro Instructions

This guide will help you set up the tournament script on your MacBook Pro (macOS 11).

## Prerequisites

Your Mac should already have Python 3 installed. To verify:

```bash
python3 --version
```

## Setup Instructions

### 1. Copy the script to your MacBook

Transfer the `tournament_setup.py` file to your MacBook. You can:
- Use a USB drive
- Email it to yourself
- Use `scp` if you're comfortable with terminal

### 2. Install required Python library

Open Terminal on your Mac and run:

```bash
pip3 install requests
```

If you get an error that pip3 is not found, try:

```bash
python3 -m pip install requests
```

### 3. Configure the MagicMirror IP address

Edit the script to point to your MagicMirror:

1. Open the script in a text editor (TextEdit, VS Code, etc.)
2. Find line 12-13:
   ```python
   MAGIC_MIRROR_HOST = "localhost"  # Change this to your MagicMirror's IP address
   MAGIC_MIRROR_PORT = 3000
   ```
3. Change `"localhost"` to your MagicMirror's IP address
   - Example: `MAGIC_MIRROR_HOST = "192.168.1.100"`
   - To find your MagicMirror's IP, on the MagicMirror machine run: `hostname -I`

### 4. Make the script executable (optional)

```bash
chmod +x tournament_setup.py
```

## Running the Script

### Method 1: Direct Python execution

```bash
python3 tournament_setup.py
```

### Method 2: If you made it executable

```bash
./tournament_setup.py
```

## Using the Script

When you run the script, it will guide you through these steps:

1. **Select your game:**
   - Press `1` for Super Smash Bros Ultimate (SSBU)
   - Press `2` for Mario Kart Wii
   - Press `3` for Custom Game (you'll need to specify the flyer filename)

2. **Enter the Challonge URL:**
   - Paste the full URL, like: `https://challonge.com/y8ltomds`
   - The script will automatically extract the tournament ID

3. **Confirm:**
   - Review your selections
   - Type `y` to send to MagicMirror

4. **Done!**
   - The MagicMirror should update with your tournament info
   - During 6pm-8pm Central: Rotates between flyer (2 min) and bracket (15 sec)
   - After 8pm Central: Shows bracket only

## Available Flyers

Currently configured flyers:
- `ssbu_flyer.png` - Super Smash Bros Ultimate
- `mkw_flyer.png` - Mario Kart Wii

To add a new flyer:
1. Place the image file in the `/flyers/` directory on the MagicMirror
2. Use option `3` (Custom Game) and enter the filename

## Troubleshooting

### "Could not connect to MagicMirror"
- Make sure the MagicMirror is running
- Verify the IP address is correct
- Make sure you're on the same network as the MagicMirror
- Check that port 3000 is not blocked by a firewall

### "Invalid Challonge URL format"
- Make sure you're pasting the full URL: `https://challonge.com/TOURNAMENT_ID`
- The script accepts these formats:
  - `https://challonge.com/y8ltomds`
  - `http://challonge.com/y8ltomds`
  - `challonge.com/y8ltomds`

### Script won't run on macOS
- macOS may block the script for security. If so:
  - Go to System Preferences > Security & Privacy
  - Click "Allow" for the script
  - Or run: `python3 tournament_setup.py` instead of `./tournament_setup.py`

## Quick Reference

**MagicMirror Display Times (Central Time):**
- Before 6pm: Flyer only
- 6pm-8pm: Rotates (2 min flyer, 15 sec bracket)
- After 8pm: Bracket only

**API Endpoint:**
- `http://MAGIC_MIRROR_IP:3000/api/tournament/update`

**Test the connection:**
```bash
curl http://MAGIC_MIRROR_IP:3000/api/tournament/status
```

## Example Usage Session

```
$ python3 tournament_setup.py

============================================================
    TOURNAMENT SETUP - MagicMirror Bracket Display
============================================================

Select the game for tonight's tournament:
  1. Super Smash Bros Ultimate (SSBU)
  2. Mario Kart Wii
  3. Custom Game

Enter your choice (1-3): 2

Selected: Mario Kart Wii

Enter the Challonge tournament URL:
Example: https://challonge.com/y8ltomds

Challonge URL: https://challonge.com/y8ltomds

------------------------------------------------------------
CONFIRMATION
------------------------------------------------------------
Game: Mario Kart Wii
Flyer: mkw_flyer.png
Bracket URL: http://challonge.com/y8ltomds/module?scale_to_fit=1

Send to MagicMirror? (y/n): y

Sending tournament data to MagicMirror...
  Flyer: mkw_flyer.png
  Bracket URL: http://challonge.com/y8ltomds/module?scale_to_fit=1

✓ Tournament data successfully sent to MagicMirror!

MagicMirror should now display:
  - Flyer: mkw_flyer.png
  - Bracket will rotate during registration hours (6pm-8pm)

============================================================
Setup complete! Your tournament is ready to go!
============================================================
```
