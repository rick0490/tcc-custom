#!/bin/bash
#
# Tournament Stream Deck Controller Installation Script
# For Raspberry Pi Zero 2 W with Elgato Stream Deck Module 15
#
# Usage:
#   curl -sSL https://admin.despairhardware.com/streamdeck/install.sh | sudo bash
#
# Or manually:
#   sudo bash install.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[INSTALL]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check root
if [ "$EUID" -ne 0 ]; then
    error "Please run as root (sudo bash install.sh)"
fi

# Get the user who invoked sudo
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo ~$REAL_USER)

log "Installing Tournament Stream Deck Controller..."
log "User: $REAL_USER, Home: $REAL_HOME"

# Step 1: System update and dependencies
log "Step 1/7: Installing system dependencies..."
apt-get update
apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    libhidapi-libusb0 \
    libudev-dev \
    libusb-1.0-0-dev \
    libjpeg-dev \
    zlib1g-dev \
    fonts-dejavu-core \
    git

# Step 2: Create installation directory
INSTALL_DIR="$REAL_HOME/stream-deck-controller"
log "Step 2/7: Creating installation directory at $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
chown -R $REAL_USER:$REAL_USER "$INSTALL_DIR"

# Step 3: Download controller files
log "Step 3/7: Downloading controller files..."
DOWNLOAD_URL="https://admin.despairhardware.com/streamdeck"

for file in hid_device.py api_client.py websocket_client.py controller.py config.json requirements.txt; do
    log "  Downloading $file..."
    curl -sSL "$DOWNLOAD_URL/$file" -o "$INSTALL_DIR/$file" || {
        warn "Failed to download $file from server, checking local..."
        if [ -f "/root/tournament-control-center/stream-deck-controller/$file" ]; then
            cp "/root/tournament-control-center/stream-deck-controller/$file" "$INSTALL_DIR/$file"
        fi
    }
done

chown -R $REAL_USER:$REAL_USER "$INSTALL_DIR"

# Step 4: Create Python virtual environment
log "Step 4/7: Setting up Python virtual environment..."
sudo -u $REAL_USER python3 -m venv "$INSTALL_DIR/venv"
sudo -u $REAL_USER "$INSTALL_DIR/venv/bin/pip" install --upgrade pip
sudo -u $REAL_USER "$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

# Step 5: Set up udev rules for Stream Deck access
log "Step 5/7: Setting up udev rules for Stream Deck..."
cat > /etc/udev/rules.d/99-streamdeck.rules << 'UDEV_RULES'
# Elgato Stream Deck devices
# Stream Deck Module 15 (20GBA9901)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="00b9", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="00b9", MODE="0666", GROUP="plugdev"

# Stream Deck Original (15-key)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0060", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0060", MODE="0666", GROUP="plugdev"

# Stream Deck Original V2 (15-key)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="006d", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="006d", MODE="0666", GROUP="plugdev"

# Stream Deck Mini (6-key)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0063", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0063", MODE="0666", GROUP="plugdev"

# Stream Deck XL (32-key)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="006c", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="006c", MODE="0666", GROUP="plugdev"

# Stream Deck MK.2 (15-key)
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0080", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0080", MODE="0666", GROUP="plugdev"

# Stream Deck Pedal
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0086", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0086", MODE="0666", GROUP="plugdev"

# Stream Deck Plus
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0084", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0084", MODE="0666", GROUP="plugdev"
UDEV_RULES

# Add user to plugdev group
usermod -a -G plugdev $REAL_USER

# Reload udev rules
udevadm control --reload-rules
udevadm trigger

# Step 6: Create .env file for API token
log "Step 6/8: Creating environment file for API token..."
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << 'ENV'
# Stream Deck Controller Environment Variables
# Generate an API token from the admin dashboard: Settings > API Tokens
# The token is shown only once when created - copy it here

ADMIN_API_TOKEN=
ENV
    chmod 600 "$ENV_FILE"
    chown $REAL_USER:$REAL_USER "$ENV_FILE"
    log "Created $ENV_FILE - Add your API token here"
else
    log ".env file already exists, skipping..."
fi

# Step 7: Create systemd service
log "Step 7/8: Creating systemd service..."
cat > /etc/systemd/system/stream-deck-controller.service << SERVICE
[Unit]
Description=Tournament Stream Deck Controller
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/venv/bin/python3 $INSTALL_DIR/controller.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Environment
Environment=PYTHONUNBUFFERED=1

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$INSTALL_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICE

# Reload systemd
systemctl daemon-reload
systemctl enable stream-deck-controller.service

# Step 8: Create management scripts
log "Step 8/8: Creating management scripts..."

# Start script
cat > "$INSTALL_DIR/start.sh" << 'STARTSH'
#!/bin/bash
sudo systemctl start stream-deck-controller
sudo journalctl -u stream-deck-controller -f
STARTSH
chmod +x "$INSTALL_DIR/start.sh"

# Stop script
cat > "$INSTALL_DIR/stop.sh" << 'STOPSH'
#!/bin/bash
sudo systemctl stop stream-deck-controller
STOPSH
chmod +x "$INSTALL_DIR/stop.sh"

# Status script
cat > "$INSTALL_DIR/status.sh" << 'STATUSSH'
#!/bin/bash
sudo systemctl status stream-deck-controller
STATUSSH
chmod +x "$INSTALL_DIR/status.sh"

# Logs script
cat > "$INSTALL_DIR/logs.sh" << 'LOGSSH'
#!/bin/bash
sudo journalctl -u stream-deck-controller -f
LOGSSH
chmod +x "$INSTALL_DIR/logs.sh"

# Test script (run manually without service)
cat > "$INSTALL_DIR/test.sh" << TESTSH
#!/bin/bash
cd $INSTALL_DIR
$INSTALL_DIR/venv/bin/python3 controller.py
TESTSH
chmod +x "$INSTALL_DIR/test.sh"

chown -R $REAL_USER:$REAL_USER "$INSTALL_DIR"

# Done!
echo ""
log "=============================================="
log "Installation complete!"
log "=============================================="
echo ""
echo -e "${BLUE}Installation directory:${NC} $INSTALL_DIR"
echo ""
echo -e "${BLUE}Usage:${NC}"
echo "  Test manually:    cd $INSTALL_DIR && ./test.sh"
echo "  Start service:    sudo systemctl start stream-deck-controller"
echo "  Stop service:     sudo systemctl stop stream-deck-controller"
echo "  View logs:        sudo journalctl -u stream-deck-controller -f"
echo "  Check status:     sudo systemctl status stream-deck-controller"
echo ""
echo -e "${BLUE}Configuration:${NC}"
echo "  Edit config:      nano $INSTALL_DIR/config.json"
echo "  Set API token:    nano $INSTALL_DIR/.env"
echo ""
echo -e "${YELLOW}Important - API Token Setup:${NC}"
echo "  1. Go to admin dashboard: Settings > API Tokens"
echo "  2. Click 'Create New Token' and name it (e.g., 'Stream Deck 1')"
echo "  3. Copy the token (shown only once!)"
echo "  4. Edit $INSTALL_DIR/.env and paste your token"
echo "  5. Restart the service: sudo systemctl restart stream-deck-controller"
echo ""
echo -e "${YELLOW}Other Notes:${NC}"
echo "  - Plug in Stream Deck if not already connected"
echo "  - You may need to re-plug the Stream Deck for udev rules to take effect"
echo "  - You may need to log out and back in for group membership to take effect"
echo ""
echo -e "${GREEN}To start the controller now:${NC}"
echo "  sudo systemctl start stream-deck-controller"
echo ""
