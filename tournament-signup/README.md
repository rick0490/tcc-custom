# Tournament Signup Web App

**Progressive Web App (PWA)** for tournament participant signup using the Challonge API. Installable on mobile and desktop with offline support!

## Features

### Core Features
- 🎮 **Tournament Display** - Shows current tournament name from Challonge
- 📱 **Mobile-First Design** - Beautiful, responsive UI optimized for mobile devices
- ✨ **Simple Signup Flow** - Enter name → Submit → Confirmation
- 🔄 **Auto-Sync** - Reads tournament ID from admin dashboard state
- 🎨 **Modern UI** - Gradient backgrounds, smooth animations, Tailwind CSS

### NEW: PWA Features (v1.1.0)
- 📲 **Install to Home Screen** - Works like a native app on mobile/desktop
- ⚡ **Offline Support** - Service worker caching for instant load times
- 📸 **Instagram Integration** - Optional Instagram handle for podium winner tagging
- 📋 **Rules & Prizes Page** - Dedicated page showing tournament rules and cash prizes
- 🎯 **Standalone Mode** - Opens without browser UI when installed
- 🔔 **Future-Ready** - Built for push notifications and background sync

See [PWA_FEATURES.md](PWA_FEATURES.md) for complete PWA documentation.

## Installation

### 1. Install Dependencies

```bash
cd /root/tournament-dashboard/tournament-signup
npm install
```

### 2. Configure Environment

Edit `.env` file:

```bash
nano .env
```

**Important:** Verify `TOURNAMENT_STATE_FILE` path points to your active tournament state.

### 3. Test Locally

```bash
npm start
```

Visit: `http://localhost:3001`

### 4. Install as systemd Service

```bash
# Copy service file
sudo cp tournament-signup.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable tournament-signup

# Start the service
sudo systemctl start tournament-signup

# Check status
sudo systemctl status tournament-signup
```

## Service Management

```bash
# Start service
sudo systemctl start tournament-signup

# Stop service
sudo systemctl stop tournament-signup

# Restart service
sudo systemctl restart tournament-signup

# View logs
sudo journalctl -u tournament-signup -f

# Check status
sudo systemctl status tournament-signup
```

## Configuration

### Environment Variables (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment mode | `production` |
| `CHALLONGE_API_KEY` | Challonge API key | Required |
| `TOURNAMENT_STATE_FILE` | Path to tournament state JSON | See .env |
| `FALLBACK_TOURNAMENT_ID` | Backup tournament ID | Optional |

## Usage

### Setting Up for a Tournament

**Method 1: Auto-Sync (Recommended)**
1. Set up tournament via admin dashboard at `admin.despairhardware.com`
2. Signup app automatically reads tournament ID from state file
3. No additional configuration needed!

**Method 2: Manual Fallback**
1. Edit `.env` and set `FALLBACK_TOURNAMENT_ID`
2. Restart service: `sudo systemctl restart tournament-signup`

### Participant Flow

1. **Visit signup page** - `https://signup.despairhardware.com`
2. **View tournament name** - Automatically loaded from Challonge
3. **Enter name** - Participant enters their name/tag
4. **Submit** - Clicks "Join Tournament" button
5. **Confirmation** - Redirected to success page with instructions

## Domain Setup

### Using signup.despairhardware.com

#### Nginx Proxy Manager Configuration

1. **Open NPM Dashboard**
2. **Add New Proxy Host:**
   - Domain: `signup.despairhardware.com`
   - Scheme: `http`
   - Forward IP: `localhost` (or `192.168.1.27`)
   - Forward Port: `3001`
   - Block Common Exploits: ✓
   - Websockets Support: ✓ (optional)

3. **SSL Tab:**
   - SSL Certificate: Request new (Let's Encrypt)
   - Force SSL: ✓
   - HTTP/2 Support: ✓
   - HSTS Enabled: ✓

4. **Save**

#### Alternative Domain Suggestions

If `signup.despairhardware.com` doesn't fit your needs:
- `register.despairhardware.com`
- `join.despairhardware.com`
- `checkin.despairhardware.com`
- `entry.despairhardware.com`

## API Endpoints

- `GET /` - Main signup page
- `GET /confirmation` - Confirmation page
- `GET /api/tournament` - Get current tournament info
- `POST /api/signup` - Submit participant signup
- `GET /api/health` - Health check

## Troubleshooting

### Service won't start

```bash
# Check logs
sudo journalctl -u tournament-signup -n 50

# Verify Node.js
node --version

# Check port availability
sudo lsof -i :3001
```

### "No active tournament" error

```bash
# Verify state file exists and is readable
cat /root/tournament-dashboard/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json

# Check state file contains tournamentId
# Set fallback in .env if needed
nano /root/tournament-dashboard/tournament-signup/.env
```

### Signup fails

```bash
# Test Challonge API manually
curl "https://api.challonge.com/v1/tournaments/YOUR_TOURNAMENT_ID.json?api_key=YOUR_API_KEY"

# Check service logs
sudo journalctl -u tournament-signup -f

# Verify API key is correct
cat /root/tournament-dashboard/tournament-signup/.env | grep CHALLONGE
```

### Can't access from mobile

1. Check service is running: `sudo systemctl status tournament-signup`
2. Verify firewall allows port 3001
3. Test local access: `curl http://localhost:3001/api/health`
4. Check NPM proxy configuration
5. Verify DNS points to correct server

## Development

Run in development mode with auto-restart:

```bash
npm run dev
```

## Mobile Testing

Access the app from your mobile device:
1. Ensure mobile is on same network
2. Visit `http://YOUR_SERVER_IP:3001`
3. Or use the domain: `https://signup.despairhardware.com`

## Security Notes

- No authentication required (public signup)
- Rate limiting recommended for production (can be added)
- API key stored server-side only (never exposed to browser)
- HTTPS strongly recommended via NPM/Let's Encrypt

## Version History

- **v1.0.0** (2024-11-19) - Initial release
  - Tournament name display via Challonge API
  - Mobile-friendly signup form
  - Confirmation page
  - Auto-sync with admin dashboard

## License

MIT

## Support

For issues, check:
- Service logs: `sudo journalctl -u tournament-signup -f`
- Browser console for frontend errors
- Test API: `curl http://localhost:3001/api/health`
