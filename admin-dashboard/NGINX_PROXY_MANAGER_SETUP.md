# Nginx Proxy Manager Setup Guide

## ✅ Prerequisites

- [x] Admin dashboard service is running on port 3000
- [ ] Nginx Proxy Manager is installed and accessible
- [ ] Domain `admin.despairhardware.com` DNS points to your server IP
- [ ] Port 80 and 443 are accessible from internet

## 📋 Quick Setup Steps

### Step 1: Verify Service is Running

```bash
sudo systemctl status tournament-admin
```

You should see: `Active: active (running)`

Test locally:
```bash
curl -u admin:tournament2024 http://localhost:3000/api/status
```

Should return JSON with tournament status.

---

### Step 2: Configure Nginx Proxy Manager

1. **Open Nginx Proxy Manager**
   - Access your NPM dashboard (usually at `http://your-server:81`)
   - Login with your credentials

2. **Add New Proxy Host**
   - Click "Proxy Hosts" → "Add Proxy Host"

3. **Details Tab Configuration:**

   ```
   Domain Names:
   ┌────────────────────────────────────────┐
   │ admin.despairhardware.com              │
   └────────────────────────────────────────┘

   Scheme: http

   Forward Hostname / IP:
   ┌────────────────────────────────────────┐
   │ 192.168.1.27    (or localhost)         │
   └────────────────────────────────────────┘

   Forward Port:
   ┌────────────────────────────────────────┐
   │ 3000                                   │
   └────────────────────────────────────────┘

   ☐ Cache Assets
   ☑ Block Common Exploits
   ☑ Websockets Support (optional but recommended)
   ```

4. **SSL Tab Configuration:**

   ```
   SSL Certificate:
   ┌────────────────────────────────────────┐
   │ Request a new SSL Certificate         │
   │ (or select existing wildcard cert)    │
   └────────────────────────────────────────┘

   ☑ Force SSL
   ☑ HTTP/2 Support
   ☑ HSTS Enabled
   ☐ HSTS Subdomains (optional)

   Email Address for Let's Encrypt:
   ┌────────────────────────────────────────┐
   │ your-email@example.com                 │
   └────────────────────────────────────────┘

   ☑ I Agree to the Let's Encrypt Terms of Service
   ```

5. **Advanced Tab (Optional but Recommended):**

   Add this custom Nginx configuration for better security:

   ```nginx
   # Security headers
   add_header X-Frame-Options "SAMEORIGIN" always;
   add_header X-Content-Type-Options "nosniff" always;
   add_header X-XSS-Protection "1; mode=block" always;
   add_header Referrer-Policy "no-referrer-when-downgrade" always;

   # Rate limiting (optional - dashboard has its own)
   limit_req_zone $binary_remote_addr zone=admin_limit:10m rate=10r/s;
   limit_req zone=admin_limit burst=20 nodelay;

   # Increase timeout for long-running requests
   proxy_read_timeout 300;
   proxy_connect_timeout 300;
   proxy_send_timeout 300;

   # WebSocket support (if needed)
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

6. **Save**
   - Click "Save"
   - NPM will automatically configure Nginx and request SSL certificate

---

### Step 3: Verify Configuration

**Check NPM status:**
- The proxy host should show as "Online" with a green indicator
- SSL certificate should show as valid

**Test from browser:**
1. Open `https://admin.despairhardware.com`
2. You should see browser login prompt (Basic Auth)
3. Enter:
   - Username: `admin`
   - Password: `tournament2024`
4. Dashboard should load!

**Test from command line:**
```bash
curl -I -u admin:tournament2024 https://admin.despairhardware.com
```

Should return `HTTP/2 200`

---

## 🔧 Troubleshooting

### Issue: "502 Bad Gateway"

**Cause:** Dashboard service not running or wrong IP/port

**Fix:**
```bash
# Check service
sudo systemctl status tournament-admin

# If not running, start it
sudo systemctl start tournament-admin

# Verify it's listening on port 3000
sudo lsof -i :3000

# Test locally
curl http://localhost:3000
```

In NPM, verify:
- Forward IP is `192.168.1.27` or `localhost` or `127.0.0.1`
- Forward Port is `3000`
- Scheme is `http` (not https)

---

### Issue: "Connection Refused"

**Cause:** Firewall blocking port 3000 or service not bound to all interfaces

**Fix:**

Check `.env` file:
```bash
cat /root/tournament-dashboard/admin-dashboard/.env | grep PORT
```

Verify server is listening on all interfaces:
```bash
sudo netstat -tlnp | grep 3000
```

Should show: `0.0.0.0:3000` or `:::3000`

If using firewall:
```bash
# Allow NPM to access port 3000 locally (usually not needed)
sudo ufw allow from 192.168.1.0/24 to any port 3000
```

---

### Issue: SSL Certificate Fails

**Cause:** DNS not pointing to server or ports 80/443 blocked

**Fix:**

1. Verify DNS:
   ```bash
   nslookup admin.despairhardware.com
   # Should return your server's public IP
   ```

2. Check ports 80 and 443 are open:
   ```bash
   sudo lsof -i :80
   sudo lsof -i :443
   ```

3. Test Let's Encrypt challenge:
   - Temporarily disable SSL in NPM
   - Visit `http://admin.despairhardware.com`
   - Should connect (even if redirected)
   - Re-enable SSL

4. Use Cloudflare DNS Challenge (if available):
   - In NPM SSL tab, select "Use a DNS Challenge"
   - Choose your DNS provider (Cloudflare)
   - Enter API credentials

---

### Issue: Login Prompt Doesn't Appear

**Cause:** Browser cached credentials or NPM is stripping auth headers

**Fix:**

1. Clear browser cache and try incognito mode

2. In NPM Advanced tab, add:
   ```nginx
   # Preserve authentication headers
   proxy_set_header Authorization $http_authorization;
   proxy_pass_header Authorization;
   ```

3. Try different browser

---

### Issue: Dashboard Loads but Shows Errors

**Cause:** MagicMirror modules not running or accessible

**Fix:**

Check both MagicMirror services:
```bash
sudo systemctl status magic-mirror-match
sudo systemctl status magic-mirror-bracket
```

Test module APIs:
```bash
curl http://localhost:2052/api/tournament/status
curl http://localhost:2053/api/tournament/status
```

If modules are offline:
```bash
sudo systemctl start magic-mirror-match
sudo systemctl start magic-mirror-bracket
```

---

## 🎨 Optional: Custom Domain Configuration

If you want multiple subdomains:

**For match display API:**
```
Domain: match.despairhardware.com
Forward to: localhost:2052
```

**For bracket display API:**
```
Domain: bracket.despairhardware.com
Forward to: localhost:2053
```

**For admin dashboard:**
```
Domain: admin.despairhardware.com
Forward to: localhost:3000
```

---

## 🔐 Security Best Practices

### 1. Change Default Password

```bash
nano /root/tournament-dashboard/admin-dashboard/.env
```

Change:
```env
ADMIN_PASSWORD=YourStrongPasswordHere123!
```

Restart service:
```bash
sudo systemctl restart tournament-admin
```

### 2. Enable Additional Security in NPM

In Advanced tab:
```nginx
# Only allow specific IPs (optional)
# allow 1.2.3.4;  # Your home/office IP
# deny all;

# Additional security headers
add_header Content-Security-Policy "default-src 'self' https://cdn.tailwindcss.com; script-src 'self' https://cdn.tailwindcss.com 'unsafe-inline'; style-src 'self' https://cdn.tailwindcss.com 'unsafe-inline';" always;
```

### 3. Enable Access Logs

In NPM, enable access logs for the proxy host to monitor who's accessing the dashboard.

---

## ✅ Final Verification Checklist

- [ ] Service running: `sudo systemctl status tournament-admin`
- [ ] Local access works: `curl -u admin:password http://localhost:3000`
- [ ] NPM proxy host created with correct IP/port
- [ ] SSL certificate obtained and valid
- [ ] External access works: `https://admin.despairhardware.com`
- [ ] Browser login prompt appears
- [ ] Dashboard loads after authentication
- [ ] Status panel shows both modules
- [ ] Can upload flyer
- [ ] Can configure tournament
- [ ] Default password changed

---

## 📊 Network Architecture

```
Internet
   │
   ├─> Port 443 (HTTPS)
   │
   ▼
Nginx Proxy Manager
   │
   ├─> SSL Termination
   ├─> Reverse Proxy
   │
   ▼
Tournament Admin Dashboard (Port 3000)
   │
   ├─> Basic Auth
   ├─> API Server
   │
   ├──▶ Match Module API (Port 2052)
   │
   └──▶ Bracket Module API (Port 2053)
```

---

## 🚀 Quick Reference

**Service Commands:**
```bash
sudo systemctl status tournament-admin   # Check status
sudo systemctl restart tournament-admin  # Restart
sudo journalctl -u tournament-admin -f   # View logs
```

**NPM Settings:**
```
Domain: admin.despairhardware.com
Scheme: http
Forward IP: 192.168.1.27 (or localhost)
Forward Port: 3000
SSL: Enabled with Let's Encrypt
```

**Access:**
```
URL: https://admin.despairhardware.com
Username: admin
Password: (in .env file)
```

---

**Setup complete! Your admin dashboard should now be accessible from anywhere! 🎉**
