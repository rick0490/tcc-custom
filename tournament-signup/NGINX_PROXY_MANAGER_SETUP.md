# Nginx Proxy Manager Setup Guide - Tournament Signup

## ✅ Prerequisites

- [x] Tournament signup service is running on port 3001
- [ ] Nginx Proxy Manager is installed and accessible
- [ ] Domain `signup.despairhardware.com` DNS points to your server IP
- [ ] Port 80 and 443 are accessible from internet

## 📋 Quick Setup Steps

### Step 1: Verify Service is Running

```bash
sudo systemctl status tournament-signup
```

You should see: `Active: active (running)`

Test locally:
```bash
curl http://localhost:3001/api/health
```

Should return JSON: `{"status":"ok","service":"tournament-signup",...}`

Test tournament endpoint:
```bash
curl http://localhost:3001/api/tournament
```

Should return current tournament info from Challonge.

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
   │ signup.despairhardware.com             │
   └────────────────────────────────────────┘

   Scheme: http

   Forward Hostname / IP:
   ┌────────────────────────────────────────┐
   │ 192.168.1.27    (or localhost)         │
   └────────────────────────────────────────┘

   Forward Port:
   ┌────────────────────────────────────────┐
   │ 3001                                   │
   └────────────────────────────────────────┘

   ☐ Cache Assets
   ☑ Block Common Exploits
   ☑ Websockets Support (recommended)
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

   Add this custom Nginx configuration:

   ```nginx
   # Security headers
   add_header X-Frame-Options "SAMEORIGIN" always;
   add_header X-Content-Type-Options "nosniff" always;
   add_header X-XSS-Protection "1; mode=block" always;
   add_header Referrer-Policy "no-referrer-when-downgrade" always;

   # Mobile optimization
   add_header Cache-Control "public, max-age=3600" always;

   # Increase timeout for API calls to Challonge
   proxy_read_timeout 60;
   proxy_connect_timeout 60;
   proxy_send_timeout 60;

   # WebSocket support
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";

   # Pass real client IP
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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
1. Open `https://signup.despairhardware.com`
2. You should see the tournament signup page
3. Tournament name should load automatically
4. Try entering a test name (or not - don't pollute your tournament!)

**Test from command line:**
```bash
curl -I https://signup.despairhardware.com
```

Should return `HTTP/2 200`

**Test from mobile device:**
1. Open browser on your phone
2. Visit `https://signup.despairhardware.com`
3. Verify mobile-responsive design works
4. Test form submission (optional)

---

## 🔧 Troubleshooting

### Issue: "502 Bad Gateway"

**Cause:** Signup service not running or wrong IP/port

**Fix:**
```bash
# Check service
sudo systemctl status tournament-signup

# If not running, start it
sudo systemctl start tournament-signup

# Verify it's listening on port 3001
sudo lsof -i :3001

# Test locally
curl http://localhost:3001/api/health
```

In NPM, verify:
- Forward IP is `192.168.1.27` or `localhost` or `127.0.0.1`
- Forward Port is `3001`
- Scheme is `http` (not https)

---

### Issue: "Connection Refused"

**Cause:** Firewall blocking port 3001 or service not bound to all interfaces

**Fix:**

Check service is listening:
```bash
sudo netstat -tlnp | grep 3001
```

Should show: `0.0.0.0:3001` or `:::3001`

If using firewall:
```bash
# Allow NPM to access port 3001 locally (usually not needed for localhost)
sudo ufw allow from 192.168.1.0/24 to any port 3001
```

---

### Issue: SSL Certificate Fails

**Cause:** DNS not pointing to server or ports 80/443 blocked

**Fix:**

1. Verify DNS:
   ```bash
   nslookup signup.despairhardware.com
   # Should return your server's public IP
   ```

2. Check ports 80 and 443 are open:
   ```bash
   sudo lsof -i :80
   sudo lsof -i :443
   ```

3. Test Let's Encrypt challenge:
   - Temporarily disable SSL in NPM
   - Visit `http://signup.despairhardware.com`
   - Should connect (even if redirected)
   - Re-enable SSL

4. Use Cloudflare DNS Challenge (if available):
   - In NPM SSL tab, select "Use a DNS Challenge"
   - Choose your DNS provider (Cloudflare)
   - Enter API credentials

---

### Issue: "No active tournament" Error

**Cause:** Tournament not configured via admin dashboard

**Fix:**

1. Go to admin dashboard: `https://admin.despairhardware.com`
2. Set up a tournament with Challonge API
3. Wait a few seconds for state file to update
4. Refresh signup page

**Or manually check state file:**
```bash
cat /root/tournament-dashboard/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json
```

Should contain `tournamentId` field.

---

### Issue: Tournament Name Not Loading

**Cause:** Challonge API issue or invalid API key

**Fix:**

```bash
# Check service logs
sudo journalctl -u tournament-signup -n 50

# Test Challonge API manually
curl "https://api.challonge.com/v1/tournaments/YOUR_TOURNAMENT_ID.json?api_key=YOUR_API_KEY"

# Verify API key in .env
cat /root/tournament-dashboard/tournament-signup/.env | grep CHALLONGE
```

---

### Issue: Signup Fails / "Failed to complete signup"

**Cause:** Challonge API error or network issue

**Fix:**

1. Check browser console for errors (F12)
2. Check service logs:
   ```bash
   sudo journalctl -u tournament-signup -f
   # Then try signing up again
   ```

3. Verify tournament is in "pending" or "open" state (not "complete"):
   ```bash
   curl http://localhost:3001/api/tournament | jq '.tournament.state'
   ```

4. Test Challonge API directly:
   ```bash
   # Replace TOURNAMENT_ID and API_KEY
   curl -X POST "https://api.challonge.com/v1/tournaments/TOURNAMENT_ID/participants.json" \
     -d "api_key=API_KEY" \
     -d "participant[name]=Test Player"
   ```

---

### Issue: Mobile Layout Looks Wrong

**Cause:** Browser caching old CSS or viewport meta tag issue

**Fix:**

1. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
2. Clear browser cache
3. Try different mobile browser
4. Check viewport meta tag in source

---

## 📱 Mobile Optimization

The signup app is designed mobile-first with:
- Responsive design (works on any screen size)
- Large touch-friendly buttons
- Clean, distraction-free interface
- Fast loading (Tailwind CSS via CDN)
- Auto-focus on name input field
- Gradient background optimized for mobile

**Testing on various devices:**
- iPhone: Safari, Chrome
- Android: Chrome, Firefox, Samsung Internet
- Tablet: Safari (iPad), Chrome (Android tablets)

---

## 🎨 Alternative Domain Suggestions

If `signup.despairhardware.com` doesn't fit:
- `register.despairhardware.com` - More formal
- `join.despairhardware.com` - Friendly, inviting
- `checkin.despairhardware.com` - Tournament check-in style
- `entry.despairhardware.com` - Entry registration
- `bracket.despairhardware.com/signup` - Subdirectory (requires nginx location config)

---

## 🔐 Security Notes

**No Authentication Required:**
- Public signup page (intentional)
- Anyone can sign up for the tournament
- No CORS restrictions

**API Key Security:**
- Challonge API key stored server-side only in `.env`
- Never exposed to browser/frontend
- Backend proxies all Challonge API calls

**Rate Limiting (Optional):**

If you want to add rate limiting to prevent spam signups, add this to NPM Advanced config:

```nginx
# Rate limiting - max 10 signups per IP per minute
limit_req_zone $binary_remote_addr zone=signup_limit:10m rate=10r/m;
limit_req zone=signup_limit burst=5 nodelay;
```

Or add to Express server (requires `express-rate-limit` package).

---

## ✅ Final Verification Checklist

- [ ] Service running: `sudo systemctl status tournament-signup`
- [ ] Local access works: `curl http://localhost:3001`
- [ ] NPM proxy host created with correct IP/port
- [ ] SSL certificate obtained and valid
- [ ] External access works: `https://signup.despairhardware.com`
- [ ] Tournament name displays correctly
- [ ] Mobile layout looks good
- [ ] Test signup (optional - don't spam tournament!)
- [ ] Confirmation page appears after signup

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
Tournament Signup App (Port 3001)
   │
   ├─> Express Server
   ├─> Static Files (HTML/CSS/JS)
   │
   ├──▶ Challonge API (participant signup)
   │
   └──▶ Tournament State File (read tournament ID)
       /root/tournament-dashboard/MagicMirror-match/modules/MMM-TournamentNowPlaying/tournament-state.json
```

---

## 🚀 Quick Reference

**Service Commands:**
```bash
sudo systemctl status tournament-signup   # Check status
sudo systemctl restart tournament-signup  # Restart
sudo journalctl -u tournament-signup -f   # View logs
```

**NPM Settings:**
```
Domain: signup.despairhardware.com
Scheme: http
Forward IP: 192.168.1.27 (or localhost)
Forward Port: 3001
SSL: Enabled with Let's Encrypt
```

**Access:**
```
Production URL: https://signup.despairhardware.com
Local URL: http://localhost:3001
Mobile-friendly: ✓
```

---

**Setup complete! Your tournament signup page should now be accessible from anywhere! 📱🎮**
