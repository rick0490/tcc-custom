# Tournament Signup - Project Summary

## Overview

A modern, mobile-first web application for tournament participant registration using the Challonge API. Built with Express.js and vanilla JavaScript with Tailwind CSS for a clean, responsive design.

## Project Details

- **Name:** Tournament Signup Web App
- **Domain:** `signup.despairhardware.com`
- **Port:** 3001
- **Status:** ✅ Active and Running
- **Created:** November 19, 2024

## Features

### Core Functionality
- ✅ Displays current tournament name from Challonge API
- ✅ Simple participant signup form (name entry + submit)
- ✅ Automatic submission to Challonge via API
- ✅ Success confirmation page with next steps
- ✅ Auto-sync with admin dashboard for tournament ID
- ✅ Mobile-first responsive design
- ✅ Real-time participant count display

### Technical Features
- ✅ Express.js backend with REST API
- ✅ Challonge API integration
- ✅ State file sharing with admin dashboard
- ✅ systemd service for automatic startup
- ✅ Production-ready error handling
- ✅ Health check endpoint
- ✅ Logging via systemd journal

### Design Features
- ✅ Beautiful gradient backgrounds
- ✅ Smooth animations and transitions
- ✅ Touch-friendly buttons (mobile-optimized)
- ✅ Loading states and error messages
- ✅ Clean, distraction-free interface
- ✅ Responsive layout (works on all devices)

## Architecture

```
┌─────────────────────────────────────────┐
│  User's Mobile Device                   │
│  └─ Browser                             │
│     └─ https://signup.despairhardware.com
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  Nginx Proxy Manager                    │
│  ├─ SSL Termination (Let's Encrypt)     │
│  └─ Reverse Proxy (Port 443 → 3001)     │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  Tournament Signup App (Port 3001)      │
│  ├─ Express Server                      │
│  ├─ Static HTML/CSS/JS                  │
│  ├─ REST API Endpoints                  │
│  └─ systemd Service                     │
│                                          │
│  Integrations:                           │
│  ├──▶ Challonge API (read tournament,   │
│  │     add participants)                │
│  └──▶ Tournament State File (read       │
│        current tournament ID)            │
└─────────────────────────────────────────┘
```

## Technology Stack

**Backend:**
- Node.js 24.11.1
- Express 5.1.0
- Axios 1.7.2 (Challonge API calls)
- dotenv 16.4.5 (environment config)
- body-parser 1.20.2 (request parsing)

**Frontend:**
- Vanilla JavaScript (no framework)
- Tailwind CSS 3.x (via CDN)
- Responsive HTML5
- CSS3 animations

**Infrastructure:**
- systemd service management
- Nginx Proxy Manager (reverse proxy)
- Let's Encrypt SSL
- Linux (Proxmox VE)

## File Structure

```
tournament-signup/
├── server.js                        # Express backend
├── package.json                     # Dependencies
├── .env                             # Configuration (API keys, paths)
├── .gitignore                       # Git ignore rules
├── tournament-signup.service        # systemd service file
│
├── public/                          # Static frontend files
│   ├── index.html                   # Main signup page
│   └── confirmation.html            # Success page
│
├── README.md                        # Installation & usage guide
├── NGINX_PROXY_MANAGER_SETUP.md     # NPM setup instructions
└── PROJECT_SUMMARY.md               # This file
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Main signup page (HTML) |
| GET | `/confirmation` | Confirmation page (HTML) |
| GET | `/api/health` | Health check |
| GET | `/api/tournament` | Get current tournament info |
| POST | `/api/signup` | Submit participant signup |

## Configuration

**Environment Variables (`.env`):**
- `PORT` - Server port (default: 3001)
- `NODE_ENV` - Environment mode (production/development)
- `CHALLONGE_API_KEY` - Challonge API key for authentication
- `TOURNAMENT_STATE_FILE` - Path to shared tournament state JSON
- `FALLBACK_TOURNAMENT_ID` - Optional backup tournament ID

**State File Integration:**
The app reads the current tournament ID from:
```
/root/tournament-dashboard/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json
```

This allows automatic synchronization when tournaments are configured via the admin dashboard.

## User Flow

1. **User visits** `https://signup.despairhardware.com`
2. **Page loads** tournament name automatically from Challonge API
3. **User enters** their name/tag in the input field
4. **User clicks** "Join Tournament" button
5. **App submits** participant to Challonge via API
6. **User redirected** to confirmation page with success message
7. **User can** sign up another player or close the page

## Deployment

**Installation:**
```bash
cd /root/tournament-dashboard/tournament-signup
npm install
sudo cp tournament-signup.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable tournament-signup
sudo systemctl start tournament-signup
```

**Service Management:**
```bash
sudo systemctl status tournament-signup    # Check status
sudo systemctl restart tournament-signup   # Restart
sudo journalctl -u tournament-signup -f    # View logs
```

**NPM Configuration:**
- Domain: `signup.despairhardware.com`
- Forward to: `localhost:3001`
- SSL: Let's Encrypt (automatic)
- Force HTTPS: ✓

See `NGINX_PROXY_MANAGER_SETUP.md` for detailed NPM setup instructions.

## Testing

**Local Testing:**
```bash
# Health check
curl http://localhost:3001/api/health

# Tournament info
curl http://localhost:3001/api/tournament

# Test signup (be careful - adds to real tournament!)
curl -X POST http://localhost:3001/api/signup \
  -H "Content-Type: application/json" \
  -d '{"participantName":"Test Player"}'
```

**Browser Testing:**
1. Open `http://localhost:3001` locally
2. Or visit `https://signup.despairhardware.com` from anywhere
3. Test on mobile devices for responsive design

## Security

**Public Access:**
- No authentication required (intentional - public signup)
- Rate limiting recommended for production (optional)

**API Key Protection:**
- Challonge API key stored server-side only in `.env`
- Never exposed to browser/frontend
- Backend proxies all Challonge API requests

**HTTPS:**
- Forced SSL via Nginx Proxy Manager
- Let's Encrypt certificate (auto-renewal)

## Monitoring

**Check Service Status:**
```bash
sudo systemctl status tournament-signup
```

**View Logs:**
```bash
sudo journalctl -u tournament-signup -f
```

**Test Endpoints:**
```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/tournament
```

## Integration with Tournament Dashboard

The signup app is part of the larger tournament dashboard ecosystem:

- **Admin Dashboard** (`admin.despairhardware.com`) - Tournament configuration
- **MagicMirror Match** (port 2052) - Current match display
- **MagicMirror Bracket** (port 2053) - Bracket and flyer display
- **Tournament Signup** (`signup.despairhardware.com`) - Participant registration ← **This app**

All components share tournament state through JSON files and Challonge API.

## Future Enhancements (Optional)

Potential improvements:
- [ ] Rate limiting on signup endpoint
- [ ] Duplicate name detection
- [ ] Email confirmation (requires email integration)
- [ ] QR code for easy mobile access
- [ ] Analytics (signup count, time tracking)
- [ ] Custom branding per tournament
- [ ] Multiple language support
- [ ] Discord/Slack notifications on signup

## Support

**Documentation:**
- `README.md` - Installation and usage
- `NGINX_PROXY_MANAGER_SETUP.md` - Reverse proxy setup
- `PROJECT_SUMMARY.md` - This file

**Troubleshooting:**
```bash
# Service not starting
sudo journalctl -u tournament-signup -n 50

# API errors
sudo journalctl -u tournament-signup -f
# (then test signup)

# Tournament not loading
curl http://localhost:3001/api/tournament
```

## Credits

- Built for DespairHardware tournaments
- Uses Challonge API for tournament management
- Tailwind CSS for styling
- Express.js for backend

## License

MIT

---

**Status:** ✅ Production Ready
**Version:** 1.0.0
**Last Updated:** November 19, 2024
