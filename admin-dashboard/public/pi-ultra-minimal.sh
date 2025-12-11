#!/bin/bash
#
# Ultra-Minimal Pi Kiosk
# ONLY: X11 + openbox + surf browser
# NO: heartbeat, no extra services
#

echo "========================================="
echo "  Ultra-Minimal Pi Kiosk Setup"
echo "========================================="
echo ""

# Disable display-manager heartbeat service
echo "[1/5] Disabling heartbeat service..."
sudo systemctl stop display-manager 2>/dev/null || true
sudo systemctl disable display-manager 2>/dev/null || true

# Disable all non-essential services
echo "[2/5] Disabling unnecessary services..."
for svc in bluetooth avahi-daemon triggerhappy cups cups-browsed ModemManager pigpiod hciuart; do
    sudo systemctl stop $svc 2>/dev/null
    sudo systemctl disable $svc 2>/dev/null
done

# Remove bloat (run in background, non-blocking)
echo "[3/5] Removing bloat packages (this may take a while)..."
sudo apt purge -y --auto-remove \
    wolfram-engine libreoffice* scratch* minecraft-pi sonic-pi dillo gpicview \
    penguinspuzzle oracle-java8-jdk openjdk* bluej greenfoot nodered nuscratch \
    claws-mail geany* thonny idle* python-games python3-pygame realvnc* vlc* \
    chromium* firefox* 2>/dev/null || true
sudo apt autoremove -y 2>/dev/null || true
sudo apt clean 2>/dev/null || true

# Create minimal kiosk script
echo "[4/5] Creating minimal kiosk script..."
cat > ~/kiosk.sh << 'KIOSK'
#!/bin/bash
# Ultra-minimal kiosk - just surf browser

xset s off
xset s noblank
xset -dpms

unclutter -idle 1 -root &

openbox &
sleep 2

exec surf -F https://live.despairhardware.com
KIOSK
chmod +x ~/kiosk.sh

# Reduce GPU memory
echo "[5/5] Optimizing GPU memory..."
CONFIG="/boot/firmware/config.txt"
[ ! -f "$CONFIG" ] && CONFIG="/boot/config.txt"
if [ -f "$CONFIG" ]; then
    sudo sed -i '/^gpu_mem=/d' "$CONFIG"
    echo "gpu_mem=64" | sudo tee -a "$CONFIG" > /dev/null
fi

echo ""
echo "========================================="
echo "  Done! Rebooting..."
echo "========================================="
sudo reboot
