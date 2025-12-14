# Tournament Admin Dashboard

Web-based admin interface for controlling MagicMirror² tournament displays.

## Features

- 🎮 **Tournament Setup** - Configure tournament ID, API key, and game name
- 🖼️ **Flyer Management** - Upload, view, and delete tournament flyers
- 📊 **Live Status Monitoring** - Real-time status of both MagicMirror modules
- 🔒 **Basic Authentication** - Password-protected access
- 🎨 **Modern UI** - Clean, responsive design with Tailwind CSS

## Installation

### 1. Install Dependencies

```bash
cd /root/tournament-dashboard/admin-dashboard
npm install
```

### 2. Configure Environment

Edit `.env` file with your credentials:

```bash
nano .env
```

**Important:** Change the default password!

### 3. Test Locally

```bash
npm start
```

Visit: `http://localhost:3000`

### 4. Install as systemd Service

```bash
# Copy service file
sudo cp tournament-admin.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable tournament-admin

# Start the service
sudo systemctl start tournament-admin

# Check status
sudo systemctl status tournament-admin
```

## Service Management

```bash
# Start service
sudo systemctl start tournament-admin

# Stop service
sudo systemctl stop tournament-admin

# Restart service
sudo systemctl restart tournament-admin

# View logs
sudo journalctl -u tournament-admin -f

# Check status
sudo systemctl status tournament-admin
```

## Configuration

### Environment Variables (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_USERNAME` | Login username | `admin` |
| `ADMIN_PASSWORD` | Login password | `tournament2024` |
| `PORT` | Server port | `3000` |
| `MATCH_API_URL` | Match module API | `http://localhost:2052` |
| `BRACKET_API_URL` | Bracket module API | `http://localhost:2053` |
| `FLYERS_PATH` | Flyer storage directory | `/root/tcc-custom/admin-dashboard/flyers` |

## Usage

### Setting Up a Tournament

1. **Log in** with your credentials
2. **Enter tournament details:**
   - Tournament ID (from Challonge URL)
   - Game name (select from dropdown or enter custom)
   - Challonge API key (optional, uses default if blank)
3. **Select a flyer** from the gallery
4. **Click "Test Connection"** to verify Challonge access (optional)
5. **Click "Start Tournament"** to push configuration to both displays

### Managing Flyers

- **Upload:** Click "Upload New Flyer" button
  - PNG format only
  - Max 5MB file size
  - 16:9 aspect ratio recommended (1920x1080)
- **Select:** Click on a flyer in the gallery to select it
- **Delete:** Click the red "Delete" button on any flyer card

### Monitoring Status

- Status refreshes automatically every 5 seconds
- Green indicator = Module running
- Red indicator = Module offline
- Shows current tournament and last update time

## API Endpoints

### Dashboard APIs

- `GET /` - Dashboard homepage (requires auth)
- `GET /api/status` - Get system status
- `POST /api/tournament/setup` - Configure tournament
- `GET /api/flyers` - List available flyers
- `POST /api/flyers/upload` - Upload new flyer
- `DELETE /api/flyers/:filename` - Delete flyer
- `POST /api/test-connection` - Test Challonge connection

## Domain Setup

### Using admin.despairhardware.com

#### Option 1: Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name admin.despairhardware.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable SSL with Let's Encrypt:

```bash
sudo certbot --nginx -d admin.despairhardware.com
```

#### Option 2: Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

## Security Recommendations

1. **Change default password** in `.env` immediately
2. **Enable HTTPS** via Nginx + Let's Encrypt or Cloudflare
3. **Limit IP access** if possible (firewall rules)
4. **Keep API key secure** - never commit to git
5. **Backup `.env` file** regularly

## Troubleshooting

### Service won't start

```bash
# Check logs
sudo journalctl -u tournament-admin -n 50

# Verify Node.js is installed
node --version

# Check if port 3000 is available
sudo lsof -i :3000
```

### Can't access dashboard

1. Check service is running: `sudo systemctl status tournament-admin`
2. Test locally: `curl http://localhost:3000`
3. Check firewall: `sudo ufw status`
4. Verify credentials in `.env`

### Modules not responding

1. Verify display services are running:
   ```bash
   sudo systemctl status match-display
   sudo systemctl status bracket-display
   sudo systemctl status flyer-display
   ```
2. Test API endpoints directly:
   ```bash
   curl http://localhost:2052/api/health
   curl http://localhost:2053/api/health
   curl http://localhost:2054/api/health
   ```

### Flyer upload fails

1. Check permissions on flyers directory:
   ```bash
   ls -la /root/tcc-custom/admin-dashboard/flyers
   ```
2. Verify file is PNG format and under 5MB
3. Check disk space: `df -h`

## Development

Run in development mode with auto-restart:

```bash
npm run dev
```

## Version History

- **v1.0.0** (2024-11-19) - Initial release
  - Tournament setup form
  - Flyer management
  - Live status monitoring
  - Basic authentication

## License

MIT

## Support

For issues, check:
- Service logs: `sudo journalctl -u tournament-admin -f`
- MagicMirror logs: `sudo journalctl -u magic-mirror-match -f`
- Browser console for frontend errors
