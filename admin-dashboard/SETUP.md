# Quick Setup Guide - Tournament Admin Dashboard

## 🚀 First-Time Setup

### Step 1: Install Dependencies

```bash
cd /root/tournament-dashboard/admin-dashboard
npm install
```

### Step 2: Configure Credentials

**IMPORTANT:** Change the default password!

```bash
nano .env
```

Change these lines:
```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password-here
```

Save and exit (Ctrl+X, Y, Enter)

### Step 3: Test Locally

```bash
npm start
```

Open browser: `http://localhost:3000`

Login with your credentials. You should see the dashboard!

Press Ctrl+C to stop.

### Step 4: Install as Service

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

You should see:
```
● tournament-admin.service - Tournament Admin Dashboard
   Active: active (running)
```

## 🌐 Domain Setup (admin.despairhardware.com)

### Option A: Cloudflare Tunnel (Recommended)

1. Install cloudflared
2. Run: `cloudflared tunnel --url http://localhost:3000`
3. Set up permanent tunnel in Cloudflare dashboard

### Option B: Nginx Reverse Proxy

Create `/etc/nginx/sites-available/admin-dashboard`:

```nginx
server {
    listen 80;
    server_name admin.despairhardware.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable and restart:
```bash
sudo ln -s /etc/nginx/sites-available/admin-dashboard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Add SSL with Let's Encrypt
sudo certbot --nginx -d admin.despairhardware.com
```

## ✅ Verify Everything Works

### 1. Check all services are running:

```bash
sudo systemctl status tournament-admin
sudo systemctl status magic-mirror-match
sudo systemctl status magic-mirror-bracket
```

All should show "active (running)" in green.

### 2. Test the dashboard:

1. Open `http://localhost:3000` (or your domain)
2. Login with credentials
3. Check "System Status" section - should show status of both modules
4. Try uploading a test flyer
5. Fill in tournament form with test data

### 3. Test tournament setup:

Use a real or test tournament:
- Tournament ID: `test123` (or real ID from Challonge)
- Game: Select from dropdown
- Flyer: Select from gallery
- Click "Test Connection" (if using real tournament)
- Click "Start Tournament"

You should see green success message and both modules update!

## 🔧 Common Commands

```bash
# View live logs
sudo journalctl -u tournament-admin -f

# Restart service
sudo systemctl restart tournament-admin

# Stop service
sudo systemctl stop tournament-admin

# Start service
sudo systemctl start tournament-admin

# Disable auto-start
sudo systemctl disable tournament-admin
```

## 🛡️ Security Checklist

- [ ] Changed default password in `.env`
- [ ] .env file has correct permissions (600)
- [ ] Using HTTPS (via Cloudflare or Let's Encrypt)
- [ ] Firewall allows port 3000 (or proxied via 80/443)
- [ ] Backed up `.env` file securely

## 📝 Next Steps

1. Set up your domain DNS (if not already done)
2. Configure SSL/HTTPS
3. Test from external network
4. Set up all three services to auto-start on boot
5. Create tournament and test end-to-end

## ❓ Need Help?

Check logs:
```bash
sudo journalctl -u tournament-admin -n 50
```

Test services individually:
```bash
curl http://localhost:3000/api/status -u admin:your-password
```

Read full documentation:
- `README.md` - Full feature documentation
- `/root/tournament-dashboard/CLAUDE.md` - System architecture

---

**You're all set!** 🎉

Access your dashboard at: `http://admin.despairhardware.com` (or `http://localhost:3000`)
