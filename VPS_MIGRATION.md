# VPS Migration Plan: TCC-Custom to bracketspot.com

## Overview

Migrate TCC-Custom from current Proxmox VM to Vultr VPS with Cloudflare CDN.

| Item | Value |
|------|-------|
| **Target Domain** | www.bracketspot.com |
| **VPS Provider** | Vultr |
| **VPS Spec** | 2GB RAM, 1 vCPU, 55GB SSD ($12/mo) |
| **CDN/DNS** | Cloudflare (free tier) |
| **URL Structure** | Path-based (single domain) |
| **Downtime** | 1-4 hours acceptable |

---

## URL Structure (Path-Based)

All services under single domain with Nginx reverse proxy:

| Path | Service | Backend Port |
|------|---------|--------------|
| `www.bracketspot.com/` | Admin Dashboard | 3000 |
| `www.bracketspot.com/signup/` | Tournament Signup | 3001 |
| `www.bracketspot.com/u/:userId/match` | Match Display | 2052 |
| `www.bracketspot.com/u/:userId/bracket` | Bracket Display | 2053 |
| `www.bracketspot.com/u/:userId/flyer` | Flyer Display | 2054 |
| `www.bracketspot.com/api/*` | Admin API | 3000 |
| `www.bracketspot.com/socket.io/*` | WebSocket | 3000 |

---

## Phase 1: VPS Provisioning (Vultr)

### 1.1 Create Vultr Instance
- **Plan:** Regular Cloud Compute - $12/mo (2GB RAM, 1 vCPU, 55GB SSD)
- **Location:** Choose closest to your users (likely US)
- **OS:** Debian 12 (Bookworm) or Ubuntu 24.04 LTS
- **Enable:** IPv4 + IPv6, Auto Backups ($2.40/mo extra - recommended)

### 1.2 Initial Server Setup
```bash
# SSH into new VPS
ssh root@<VPS_IP>

# Update system
apt update && apt upgrade -y

# Install essentials
apt install -y curl wget git nginx certbot python3-certbot-nginx ufw sqlite3

# Install Node.js 22.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Verify versions
node -v  # Should be v22.x
npm -v   # Should be v10.x

# Install Sharp dependencies (image processing)
apt install -y libvips-dev

# Configure firewall
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable
```

### 1.3 Create Project Directory
```bash
mkdir -p /root/tcc-custom
```

---

## Phase 2: Cloudflare Setup

### 2.1 Add Domain to Cloudflare
1. Log into Cloudflare dashboard
2. Add site: `bracketspot.com`
3. Select Free plan
4. Update nameservers at your domain registrar to Cloudflare's

### 2.2 Configure DNS Records
| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | @ | `<VPS_IP>` | Proxied (orange) |
| A | www | `<VPS_IP>` | Proxied (orange) |
| CNAME | * | bracketspot.com | DNS only (gray) |

### 2.3 Cloudflare SSL/TLS Settings
- **SSL Mode:** Full (Strict)
- **Always Use HTTPS:** On
- **Minimum TLS Version:** 1.2

### 2.4 Cloudflare Page Rules (for WebSocket)
Create rule:
- **URL:** `*bracketspot.com/socket.io/*`
- **Settings:** Cache Level = Bypass, Disable Security (optional)

---

## Phase 3: Data Backup (Current Server)

### 3.1 Create Migration Backup
```bash
# On current server (192.168.1.28)
cd /root/tcc-custom

# Create backup directory
mkdir -p /root/vps-migration-$(date +%Y%m%d)
cd /root/vps-migration-$(date +%Y%m%d)

# Backup databases (CRITICAL)
cp /root/tcc-custom/admin-dashboard/players.db .
cp /root/tcc-custom/admin-dashboard/system.db .
cp /root/tcc-custom/admin-dashboard/tournaments.db .

# Backup secrets
cp /root/tcc-custom/.secrets.enc .
cp /root/tcc-custom/.secrets.key .

# Backup JSON configs
cp /root/tcc-custom/admin-dashboard/users.json .
cp /root/tcc-custom/admin-dashboard/system-settings.json .
cp /root/tcc-custom/admin-dashboard/tournament-state.json .
cp /root/tcc-custom/admin-dashboard/displays.json .
cp /root/tcc-custom/admin-dashboard/activity-log.json .

# Backup sponsor images
cp -r /root/tcc-custom/admin-dashboard/sponsors .

# Backup flyers directory (if exists)
cp -r /root/tcc-custom/admin-dashboard/flyers . 2>/dev/null || echo "No flyers dir"

# Create archive
tar -czvf migration-backup.tar.gz *

# Verify backup size (should be ~2-5 MB)
ls -lh migration-backup.tar.gz
```

### 3.2 Transfer to VPS
```bash
# From current server
scp /root/vps-migration-*/migration-backup.tar.gz root@<VPS_IP>:/root/
```

---

## Phase 4: Code Deployment (VPS)

### 4.1 Clone Repository
```bash
# On VPS
cd /root
git clone <your-repo-url> tcc-custom
# OR copy from current server:
# scp -r root@192.168.1.28:/root/tcc-custom /root/
```

### 4.2 Install Dependencies
```bash
cd /root/tcc-custom/admin-dashboard && npm install
cd /root/tcc-custom/tournament-signup && npm install
cd /root/tcc-custom/match-display && npm install
cd /root/tcc-custom/bracket-display && npm install
cd /root/tcc-custom/flyer-display && npm install
```

### 4.3 Restore Backup Data
```bash
cd /root
tar -xzvf migration-backup.tar.gz -C /root/tcc-custom-restore

# Copy databases
cp /root/tcc-custom-restore/players.db /root/tcc-custom/admin-dashboard/
cp /root/tcc-custom-restore/system.db /root/tcc-custom/admin-dashboard/
cp /root/tcc-custom-restore/tournaments.db /root/tcc-custom/admin-dashboard/

# Copy secrets
cp /root/tcc-custom-restore/.secrets.* /root/tcc-custom/

# Copy configs
cp /root/tcc-custom-restore/*.json /root/tcc-custom/admin-dashboard/

# Copy sponsors
cp -r /root/tcc-custom-restore/sponsors /root/tcc-custom/admin-dashboard/

# Copy flyers (if exists)
cp -r /root/tcc-custom-restore/flyers /root/tcc-custom/admin-dashboard/ 2>/dev/null
```

---

## Phase 5: Environment Configuration (VPS)

### 5.1 Admin Dashboard `.env`

**File:** `/root/tcc-custom/admin-dashboard/.env`

```bash
PORT=3000
NODE_ENV=production
DEBUG_MODE=false

# Generate new session secret
SESSION_SECRET=<run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">

# Display URLs (internal - localhost since same server)
MATCH_API_URL=http://localhost:2052
BRACKET_API_URL=http://localhost:2053
FLYER_API_URL=http://localhost:2054

# External base URL (for generating links)
BASE_URL=https://www.bracketspot.com

# Anthropic API (optional - for AI features)
ANTHROPIC_API_KEY=

# Push Notifications (regenerate or keep existing)
VAPID_PUBLIC_KEY=<existing or regenerate>
VAPID_PRIVATE_KEY=<existing or regenerate>
VAPID_EMAIL=mailto:admin@bracketspot.com

# State files
MATCH_STATE_FILE=/root/tcc-custom/admin-dashboard/tournament-state.json
FLYERS_PATH=/root/tcc-custom/admin-dashboard/flyers
```

### 5.2 Match Display `.env`

**File:** `/root/tcc-custom/match-display/.env`

```bash
PORT=2052
NODE_ENV=production
DEBUG_MODE=false
ADMIN_DASHBOARD_URL=http://localhost:3000
ADMIN_WS_URL=http://localhost:3000
BASE_PATH=/u
```

### 5.3 Bracket Display `.env`

**File:** `/root/tcc-custom/bracket-display/.env`

```bash
PORT=2053
NODE_ENV=production
DEBUG_MODE=false
ADMIN_DASHBOARD_URL=http://localhost:3000
ADMIN_WS_URL=http://localhost:3000
BASE_PATH=/u
```

### 5.4 Flyer Display `.env`

**File:** `/root/tcc-custom/flyer-display/.env`

```bash
PORT=2054
NODE_ENV=production
DEBUG_MODE=false
ADMIN_DASHBOARD_URL=http://localhost:3000
ADMIN_WS_URL=http://localhost:3000
BASE_PATH=/u
```

### 5.5 Tournament Signup `.env`

**File:** `/root/tcc-custom/tournament-signup/.env`

```bash
PORT=3001
NODE_ENV=production
ADMIN_API_URL=http://localhost:3000
TOURNAMENT_STATE_FILE=/root/tcc-custom/admin-dashboard/tournament-state.json
BASE_PATH=/signup
```

---

## Phase 6: Nginx Configuration

### 6.1 Create Nginx Config

**File:** `/etc/nginx/sites-available/bracketspot.com`

```nginx
# Upstream definitions
upstream admin_dashboard {
    server 127.0.0.1:3000;
}

upstream tournament_signup {
    server 127.0.0.1:3001;
}

upstream match_display {
    server 127.0.0.1:2052;
}

upstream bracket_display {
    server 127.0.0.1:2053;
}

upstream flyer_display {
    server 127.0.0.1:2054;
}

# Redirect non-www to www
server {
    listen 80;
    listen [::]:80;
    server_name bracketspot.com;
    return 301 https://www.bracketspot.com$request_uri;
}

# Main server block
server {
    listen 80;
    listen [::]:80;
    server_name www.bracketspot.com;

    # Cloudflare handles SSL, so we accept HTTP from Cloudflare
    # For Full (Strict) mode, add origin certificate later

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # WebSocket support for Socket.IO
    location /socket.io/ {
        proxy_pass http://admin_dashboard;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # Tournament Signup PWA
    location /signup {
        proxy_pass http://tournament_signup;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Match Display (path: /u/:userId/match)
    location ~ ^/u/([^/]+)/match {
        proxy_pass http://match_display;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Bracket Display (path: /u/:userId/bracket)
    location ~ ^/u/([^/]+)/bracket {
        proxy_pass http://bracket_display;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Flyer Display (path: /u/:userId/flyer)
    location ~ ^/u/([^/]+)/flyer {
        proxy_pass http://flyer_display;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Admin Dashboard API
    location /api/ {
        proxy_pass http://admin_dashboard;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Admin Dashboard (catch-all for main app)
    location / {
        proxy_pass http://admin_dashboard;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 6.2 Enable Site
```bash
ln -s /etc/nginx/sites-available/bracketspot.com /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default  # Remove default site
nginx -t  # Test configuration
systemctl restart nginx
```

---

## Phase 7: Systemd Services

### 7.1 Admin Dashboard Service

**File:** `/etc/systemd/system/tcc-admin.service`

```ini
[Unit]
Description=TCC Custom - Admin Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/tcc-custom/admin-dashboard
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 7.2 Tournament Signup Service

**File:** `/etc/systemd/system/tcc-signup.service`

```ini
[Unit]
Description=TCC Custom - Tournament Signup
After=network.target tcc-admin.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/tcc-custom/tournament-signup
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 7.3 Match Display Service

**File:** `/etc/systemd/system/tcc-match.service`

```ini
[Unit]
Description=TCC Custom - Match Display
After=network.target tcc-admin.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/tcc-custom/match-display
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 7.4 Bracket Display Service

**File:** `/etc/systemd/system/tcc-bracket.service`

```ini
[Unit]
Description=TCC Custom - Bracket Display
After=network.target tcc-admin.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/tcc-custom/bracket-display
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 7.5 Flyer Display Service

**File:** `/etc/systemd/system/tcc-flyer.service`

```ini
[Unit]
Description=TCC Custom - Flyer Display
After=network.target tcc-admin.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/tcc-custom/flyer-display
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 7.6 Enable and Start Services
```bash
systemctl daemon-reload
systemctl enable tcc-admin tcc-signup tcc-match tcc-bracket tcc-flyer
systemctl start tcc-admin tcc-signup tcc-match tcc-bracket tcc-flyer

# Check status
systemctl status tcc-admin tcc-signup tcc-match tcc-bracket tcc-flyer
```

---

## Phase 8: Code Modifications Required

### 8.1 Files to Update for Path-Based Routing

These files contain hardcoded domain references that need updating:

| File | Change Required |
|------|-----------------|
| `admin-dashboard/server.js` | Update CORS origins, redirect URIs |
| `admin-dashboard/public/js/dashboard.js` | Update signup URL references |
| `admin-dashboard/public/js/command-center.js` | Update signup URL references |
| `tournament-signup/server.js` | Update productionUrl |
| `tournament-signup/public/js/ui.js` | Update bracket link |
| `admin-dashboard/displays.json` | Update serverUrl entries |
| `stream-deck-controller/config.json` | Update admin_url |

### 8.2 Domain Reference Updates

Search and replace these patterns:
- `admin.despairhardware.com` -> `www.bracketspot.com`
- `signup.despairhardware.com` -> `www.bracketspot.com/signup`
- `live.despairhardware.com` -> `www.bracketspot.com` (match display via path)
- `bracket.despairhardware.com` -> `www.bracketspot.com` (bracket display via path)
- `flyer.despairhardware.com` -> `www.bracketspot.com` (flyer display via path)

### 8.3 Base Path Support

Display services need to be aware of their base path. Add to each display server:

```javascript
// In match-display/server.js, bracket-display/server.js, flyer-display/server.js
const BASE_PATH = process.env.BASE_PATH || '';
app.use(BASE_PATH, express.static('public'));
```

---

## Phase 9: SSL Certificate (Origin)

### 9.1 Option A: Cloudflare Origin Certificate (Recommended)
1. Cloudflare Dashboard -> SSL/TLS -> Origin Server
2. Create Certificate (15 years validity)
3. Save certificate and key to VPS:
   - `/etc/ssl/cloudflare/bracketspot.com.pem`
   - `/etc/ssl/cloudflare/bracketspot.com.key`
4. Update Nginx to use HTTPS internally

### 9.2 Option B: Let's Encrypt (if not using Cloudflare proxy)
```bash
certbot --nginx -d www.bracketspot.com -d bracketspot.com
```

---

## Phase 10: Testing Checklist

### 10.1 Service Health
- [ ] All 5 Node.js services running (`systemctl status tcc-*`)
- [ ] Nginx running and config valid (`nginx -t`)
- [ ] No errors in service logs (`journalctl -u tcc-admin -f`)

### 10.2 URL Access
- [ ] `https://www.bracketspot.com/` -> Admin Dashboard
- [ ] `https://www.bracketspot.com/signup/` -> Tournament Signup
- [ ] `https://www.bracketspot.com/u/1/match` -> Match Display
- [ ] `https://www.bracketspot.com/u/1/bracket` -> Bracket Display
- [ ] `https://www.bracketspot.com/u/1/flyer` -> Flyer Display

### 10.3 Functionality
- [ ] Admin login works
- [ ] WebSocket connection established (check browser console)
- [ ] Can create/edit tournament
- [ ] Match display updates in real-time
- [ ] Bracket display renders correctly
- [ ] Flyer display shows images
- [ ] Signup form submits successfully

### 10.4 Database
- [ ] Player data migrated correctly
- [ ] Tournament history intact
- [ ] Elo ratings preserved

---

## Phase 11: DNS Cutover

### 11.1 Pre-Cutover
1. Verify all tests pass on VPS
2. Note current DNS TTL (lower to 300 seconds 24h before)
3. Schedule maintenance window

### 11.2 Cutover Steps
1. Stop services on old server
2. Final database backup and transfer
3. Restore latest data on VPS
4. Verify data integrity
5. Update Cloudflare DNS A record to VPS IP
6. Wait for propagation (5-30 minutes with low TTL)
7. Test all functionality

### 11.3 Post-Cutover
1. Monitor logs for errors
2. Increase DNS TTL back to 3600+
3. Keep old server available for 48h rollback window

---

## Phase 12: Post-Migration

### 12.1 Security Hardening
- [ ] Change default admin password
- [ ] Disable DEBUG_MODE in all .env files
- [ ] Set NODE_ENV=production
- [ ] Configure fail2ban for SSH
- [ ] Review firewall rules

### 12.2 Automated Backups
```bash
# Create backup script
cat > /root/tcc-custom/scripts/daily-backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR=/root/backups/$(date +%Y%m%d)
mkdir -p $BACKUP_DIR
cp /root/tcc-custom/admin-dashboard/players.db $BACKUP_DIR/
cp /root/tcc-custom/admin-dashboard/system.db $BACKUP_DIR/
cp /root/tcc-custom/admin-dashboard/tournaments.db $BACKUP_DIR/
# Keep 30 days of backups
find /root/backups -type d -mtime +30 -exec rm -rf {} +
EOF

chmod +x /root/tcc-custom/scripts/daily-backup.sh

# Add to crontab
echo "0 2 * * * /root/tcc-custom/scripts/daily-backup.sh" | crontab -
```

### 12.3 Monitoring
- [ ] Set up uptime monitoring (UptimeRobot, Healthchecks.io)
- [ ] Configure log rotation
- [ ] Set up disk space alerts

---

## Quick Reference Commands

```bash
# Start all services
systemctl start tcc-admin tcc-signup tcc-match tcc-bracket tcc-flyer

# Stop all services
systemctl stop tcc-admin tcc-signup tcc-match tcc-bracket tcc-flyer

# Restart all services
systemctl restart tcc-admin tcc-signup tcc-match tcc-bracket tcc-flyer

# View logs
journalctl -u tcc-admin -f
journalctl -u tcc-signup -f

# Check service status
systemctl status tcc-admin tcc-signup tcc-match tcc-bracket tcc-flyer

# Nginx
nginx -t && systemctl reload nginx

# Database inspection
sqlite3 /root/tcc-custom/admin-dashboard/players.db "SELECT COUNT(*) FROM players;"
```

---

## Rollback Plan

If migration fails:
1. Update Cloudflare DNS back to old server IP
2. Start services on old server
3. Verify functionality
4. Investigate VPS issues before retry

---

## Cost Summary

| Item | Monthly Cost |
|------|-------------|
| Vultr VPS (2GB) | $12.00 |
| Vultr Auto Backup | $2.40 |
| Cloudflare | Free |
| **Total** | **$14.40/mo** |

---

## Data Migration Summary

### Critical Data (Must Backup)
| File | Size | Priority |
|------|------|----------|
| `players.db` | ~172 KB | CRITICAL - Elo ratings, player history |
| `system.db` | ~260 KB | HIGH - User accounts, config |
| `tournaments.db` | ~156 KB | MEDIUM - Active tournaments |
| `.secrets.enc` + `.secrets.key` | ~500 B | HIGH - Encrypted secrets |

### Configuration Files
- `users.json` - Admin user accounts
- `system-settings.json` - System configuration
- `tournament-state.json` - Current deployment state
- `displays.json` - Registered display devices
- `activity-log.json` - Audit trail

### Uploads
- `sponsors/` directory - Sponsor logo images
- `flyers/` directory - Event flyers

### Ephemeral (Don't need to migrate)
- `cache.db` - API cache (regenerates automatically)
- `.db-wal`, `.db-shm` files - SQLite write-ahead logs
