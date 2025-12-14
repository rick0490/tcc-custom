#!/bin/bash
#
# Raspberry Pi 5 Kiosk Setup Script
# For Raspberry Pi 5 (4GB/8GB) running Pi OS Lite (Bookworm)
#
# Features:
#   - Chromium browser in kiosk mode with power optimization
#   - Software rendering (Chromium on Pi OS uses SwiftShader)
#   - Display manager service for admin dashboard integration
#   - Reload loop protection with exponential backoff
#   - Intent restart detection (URL changes don't count as crashes)
#   - Auto cache clearing after consecutive failures
#   - Remote URL configuration from admin dashboard
#   - Heartbeat reporting (CPU temp, memory, WiFi quality, SSID, voltage)
#   - Network wait on boot (prevents premature Chromium start)
#   - CPU governor set based on storage type (performance for NVMe, ondemand for SD)
#   - HDMI force hotplug (prevents blank screen on boot)
#   - zram compressed swap (50% of RAM)
#   - Proper log rotation via logrotate (7-day, 10MB max)
#   - NTP time synchronization verified on boot
#   - scrot installed for remote screenshots
#   - NVMe detection for enhanced performance settings
#   - Configurable display scale factor (reads from config.json)
#
# Usage (after fresh Pi OS Lite install):
#   curl -sSL https://admin.despairhardware.com/setup-pi.sh | sudo bash
#

set -e

# ============================================
# STORAGE DETECTION (NVMe vs SD Card)
# ============================================
# Detect storage type to apply appropriate performance settings
# NVMe drives allow for more aggressive performance tuning

# Detect storage type directly (not in subshell to preserve variable)
STORAGE_TYPE="sdcard"  # Default to SD card
NVME_DEVICE=""
NVME_SIZE=""

if lsblk -d -o NAME,TRAN 2>/dev/null | grep -q "nvme"; then
    STORAGE_TYPE="nvme"
    # Get NVMe drive info
    NVME_DEVICE=$(lsblk -d -o NAME,TRAN | grep nvme | head -1 | awk '{print $1}')
    NVME_SIZE=$(lsblk -d -o NAME,SIZE | grep "$NVME_DEVICE" | awk '{print $2}')
fi

# Performance settings based on storage type
if [ "$STORAGE_TYPE" = "nvme" ]; then
    # NVMe: Higher performance settings (with active cooler assumed)
    CPU_GOVERNOR="performance"
    RASTER_THREADS=4
    ENABLE_GPU_COMPOSITING=true
    CACHE_SIZE=524288000  # 500MB cache
    echo_info() { echo -e "\033[0;32m[INFO]\033[0m $1"; }
    echo_info "NVMe detected: Enabling high-performance mode"
else
    # SD Card: Conservative settings to reduce wear and heat
    CPU_GOVERNOR="ondemand"
    RASTER_THREADS=1
    ENABLE_GPU_COMPOSITING=false
    CACHE_SIZE=104857600  # 100MB cache
fi

# ============================================
# CONFIGURATION (set by interactive prompts)
# ============================================
# These variables will be set by the interactive configuration section
ADMIN_URL=""
USER_ID=""
DEFAULT_URL=""
HEARTBEAT_INTERVAL=30
CONFIG_CHECK_INTERVAL=60
WIFI_NETWORKS=()

# Display scale factor for large TVs (1.0 = no scaling)
# Recommended: 2.0-2.5 for 40"+ TVs viewed from 10+ feet
# Set to empty string "" to disable
DISPLAY_SCALE_FACTOR="1.0"

# Auto-detect user
if [ -n "$SUDO_USER" ]; then
    KIOSK_USER="$SUDO_USER"
elif [ "$(whoami)" != "root" ]; then
    KIOSK_USER="$(whoami)"
else
    KIOSK_USER=$(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1; exit}')
fi

HOME_DIR="/home/$KIOSK_USER"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================
# PRE-FLIGHT CHECKS
# ============================================
echo ""
echo "========================================"
echo "  Raspberry Pi 5 Kiosk Setup"
echo "  For Tournament Display System"
echo "========================================"
echo ""

if [ "$EUID" -ne 0 ]; then
    echo_error "Please run as root: sudo bash $0"
    exit 1
fi

if [ -z "$KIOSK_USER" ] || [ ! -d "$HOME_DIR" ]; then
    echo_error "Could not detect kiosk user."
    exit 1
fi

# Check for Pi 5
PI_MODEL=$(cat /proc/device-tree/model 2>/dev/null || echo "Unknown")
echo_info "Detected: $PI_MODEL"
echo_info "Storage: $STORAGE_TYPE"
if [ "$STORAGE_TYPE" = "nvme" ]; then
    echo_info "NVMe Drive: $NVME_DEVICE ($NVME_SIZE)"
    echo_info "Performance Mode: High (NVMe + Active Cooler)"
else
    echo_info "Performance Mode: Power Saving (SD Card)"
fi
echo_info "User: $KIOSK_USER"
echo ""

# ============================================
# INTERACTIVE CONFIGURATION
# ============================================
echo ""
echo "========================================"
echo "  Configuration"
echo "========================================"
echo ""

# Admin Dashboard URL (required)
while true; do
    read -p "Enter Admin Dashboard URL (e.g., https://admin.example.com): " ADMIN_URL
    if [ -z "$ADMIN_URL" ]; then
        echo_error "Admin URL is required"
        continue
    fi
    # Validate URL format
    if ! echo "$ADMIN_URL" | grep -qE '^https?://'; then
        echo_error "URL must start with http:// or https://"
        continue
    fi
    # Remove trailing slash if present
    ADMIN_URL="${ADMIN_URL%/}"
    # Test connectivity
    echo_info "Testing connection to $ADMIN_URL..."
    if curl -s --connect-timeout 5 "$ADMIN_URL/api/status" >/dev/null 2>&1; then
        echo_info "Connection successful!"
        break
    else
        echo_warn "Could not connect to $ADMIN_URL"
        read -p "Continue anyway? (y/n): " CONTINUE
        [ "$CONTINUE" = "y" ] && break
    fi
done

# User ID (required for multi-tenant)
while true; do
    read -p "Enter User ID for this display: " USER_ID
    if [ -z "$USER_ID" ]; then
        echo_error "User ID is required for multi-tenant displays"
        continue
    fi
    if ! echo "$USER_ID" | grep -qE '^[0-9]+$'; then
        echo_error "User ID must be a number"
        continue
    fi
    break
done

# Generate default match display URL
DEFAULT_URL="${ADMIN_URL}/u/${USER_ID}/match"
echo_info "Match Display URL: $DEFAULT_URL"

# WiFi Configuration (interactive, can add multiple)
echo ""
echo_info "WiFi Network Configuration"
echo_info "You can add multiple networks. Press Enter without typing to finish."
PRIORITY=30
while true; do
    read -p "Enter WiFi SSID (or press Enter to finish): " WIFI_SSID
    [ -z "$WIFI_SSID" ] && break
    read -sp "Enter WiFi password: " WIFI_PASSWORD
    echo ""
    if [ -n "$WIFI_PASSWORD" ]; then
        WIFI_NETWORKS+=("$WIFI_SSID:$WIFI_PASSWORD:$PRIORITY")
        echo_info "Added: $WIFI_SSID (priority $PRIORITY)"
        PRIORITY=$((PRIORITY - 10))
    else
        echo_warn "Skipping $WIFI_SSID (no password provided)"
    fi
done

echo ""
echo_info "Configuration complete!"
echo_info "  Admin URL:    $ADMIN_URL"
echo_info "  User ID:      $USER_ID"
echo_info "  Display URL:  $DEFAULT_URL"
echo_info "  WiFi Networks: ${#WIFI_NETWORKS[@]} configured"
echo ""

# ============================================
# STEP 1: Update System
# ============================================
echo_info "[1/9] Updating system packages..."
apt update
apt upgrade -y

# ============================================
# STEP 2: Install Packages
# ============================================
echo_info "[2/9] Installing X server, Chromium, and dependencies..."
apt install -y --no-install-recommends \
    xserver-xorg \
    xserver-xorg-video-fbdev \
    x11-xserver-utils \
    xinit \
    openbox \
    chromium \
    unclutter \
    curl \
    jq \
    network-manager \
    wireless-tools \
    scrot \
    xdotool \
    raspi-utils-core \
    logrotate \
    systemd-timesyncd \
    bc

# Install Node.js for CDP service (if not present)
if ! command -v node &> /dev/null; then
    echo_info "Installing Node.js for CDP scale service..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

# ============================================
# STEP 3: Configure LightDM for X11 Kiosk
# ============================================
echo_info "[3/9] Configuring LightDM for X11 kiosk mode..."

# Create custom X11 kiosk session for LightDM
# This avoids conflict with Wayland sessions (rpd-labwc) that Pi OS defaults to
mkdir -p /usr/share/xsessions
cat > /usr/share/xsessions/kiosk.desktop << EOF
[Desktop Entry]
Name=Kiosk
Comment=Tournament Display Kiosk
Exec=$HOME_DIR/kiosk.sh
Type=Application
EOF

# Configure LightDM for autologin with our custom kiosk session
# This replaces the Wayland-based rpd-labwc session with our X11 kiosk
if [ -f /etc/lightdm/lightdm.conf ]; then
    sed -i 's/^autologin-session=.*/autologin-session=kiosk/' /etc/lightdm/lightdm.conf
    sed -i 's/^user-session=.*/user-session=kiosk/' /etc/lightdm/lightdm.conf
    # Ensure autologin is set
    if ! grep -q "^autologin-user=" /etc/lightdm/lightdm.conf; then
        sed -i "/\[Seat:\*\]/a autologin-user=$KIOSK_USER" /etc/lightdm/lightdm.conf
    else
        sed -i "s/^autologin-user=.*/autologin-user=$KIOSK_USER/" /etc/lightdm/lightdm.conf
    fi
    if ! grep -q "^autologin-session=" /etc/lightdm/lightdm.conf; then
        sed -i "/\[Seat:\*\]/a autologin-session=kiosk" /etc/lightdm/lightdm.conf
    fi
fi

# Disable getty autologin on tty1 since LightDM handles display
# This prevents conflicts between getty and LightDM
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/override.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --noclear %I \$TERM
EOF

# ============================================
# STEP 4: Create Kiosk Configuration
# ============================================
echo_info "[4/9] Creating kiosk configuration..."

# Create config directory
mkdir -p "$HOME_DIR/.config/kiosk"

# Create default config file with multi-tenant support
cat > "$HOME_DIR/.config/kiosk/config.json" << EOF
{
    "url": "$DEFAULT_URL",
    "adminUrl": "$ADMIN_URL",
    "userId": $USER_ID,
    "heartbeatInterval": $HEARTBEAT_INTERVAL,
    "configCheckInterval": $CONFIG_CHECK_INTERVAL,
    "displayScaleFactor": 1.0,
    "lastUpdated": "$(date -Iseconds)"
}
EOF
chown -R $KIOSK_USER:$KIOSK_USER "$HOME_DIR/.config/kiosk"

# ============================================
# STEP 5: Create Kiosk Scripts
# ============================================
echo_info "[5/9] Creating kiosk scripts..."

# Main kiosk launcher script with reload loop protection and Pi 5 optimizations
# Note: Using double heredoc marker to allow variable substitution for RASTER_THREADS and GPU_FLAGS
cat > "$HOME_DIR/kiosk.sh" << KIOSKSCRIPT
#!/bin/bash
#
# Kiosk Launcher for Raspberry Pi 5
# Launches Chromium in fullscreen kiosk mode
#
# Storage Type: $STORAGE_TYPE
# CPU Governor: $CPU_GOVERNOR
# Raster Threads: $RASTER_THREADS
# GPU Compositing: $ENABLE_GPU_COMPOSITING
#
# Note: Chromium 142+ on Raspberry Pi OS uses SwiftShader (software rendering)
# Hardware GPU rendering cannot be forced via flags - this is a Debian packaging decision
# The Pi 5's VideoCore VII GPU is not supported by this Chromium build's ANGLE backend
#
# Power considerations:
#   - Page loads cause CPU spikes (software rendering)
#   - Use adequate 5V 5A power supply for Pi 5
#   - Active cooling recommended (heatsink + fan)
#   - Steady-state CPU usage is low (~3%)
#
# Features:
#   - Reload loop protection with exponential backoff
#   - Intent restart detection (URL changes don't count as crashes)
#   - Auto cache clearing after consecutive failures
#   - Soft start power management (CPU throttling during load)
#   - Crash counter with auto-reset after stable run
#   - Debug mode with verbose logging to admin dashboard
#   - Configurable display scale factor (reads from config.json)
#   - Storage-aware performance tuning (NVMe vs SD card)
#

CONFIG_FILE="\$HOME/.config/kiosk/config.json"
STATE_FILE="\$HOME/.config/kiosk/state.json"
CHROMIUM_PROFILE="\$HOME/.config/chromium-kiosk"
LOG_FILE="\$HOME/.config/kiosk/kiosk.log"
DEBUG_LOG_FILE="\$HOME/.config/kiosk/debug.log"
INTENT_FILE="\$HOME/.config/kiosk/intent_restart"
CRASH_STATE_FILE="\$HOME/.config/kiosk/crash-state.json"

# Storage-based performance settings (set during install)
RASTER_THREADS=$RASTER_THREADS
ENABLE_GPU_COMPOSITING=$ENABLE_GPU_COMPOSITING
DISK_CACHE_SIZE=$CACHE_SIZE

# Display scale factor for large TVs
# Now reads from config.json if set, otherwise uses install default
# Recommended: 2.0-2.5 for 40"+ TVs viewed from 10+ feet
DEFAULT_SCALE_FACTOR=$DISPLAY_SCALE_FACTOR

# Get display scale factor from config or use default
get_scale_factor() {
    if [ -f "\$CONFIG_FILE" ]; then
        local config_scale=\$(jq -r '.displayScaleFactor // empty' "\$CONFIG_FILE" 2>/dev/null)
        if [ -n "\$config_scale" ] && [ "\$config_scale" != "null" ]; then
            echo "\$config_scale"
            return
        fi
    fi
    echo "\$DEFAULT_SCALE_FACTOR"
}

# Reload loop protection settings
CRASH_COUNTER=0
MAX_CRASHES_BEFORE_CACHE_CLEAR=3
BASE_BACKOFF=10
MAX_BACKOFF=300
STABLE_RUN_THRESHOLD=120

# Watchdog settings for hang detection
# Detects frozen/unresponsive Chromium and force-kills to restart
WATCHDOG_CHECK_INTERVAL=30    # Check every 30 seconds
WATCHDOG_TIMEOUT=90           # Consider hung after 90 seconds unresponsive
WATCHDOG_PID=""               # Track watchdog process PID

# Debug mode state (read from state.json)
DEBUG_MODE=false

# PID file for single instance check
PID_FILE="\$HOME/.config/kiosk/kiosk.pid"

# Single instance check using PID file
# This prevents multiple kiosk.sh processes from running simultaneously
# which can happen if ssh-agent or other session wrappers spawn duplicates
if [ -f "\$PID_FILE" ]; then
    OLD_PID=\$(cat "\$PID_FILE")
    if [ -n "\$OLD_PID" ] && [ -d "/proc/\$OLD_PID" ]; then
        OLD_CMD=\$(cat "/proc/\$OLD_PID/cmdline" 2>/dev/null | tr '\0' ' ')
        if echo "\$OLD_CMD" | grep -q "kiosk.sh"; then
            echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Another kiosk instance running (PID \$OLD_PID), exiting" >> "\$LOG_FILE"
            exit 0
        fi
    fi
fi
echo \$\$ > "\$PID_FILE"
trap "rm -f \$PID_FILE; [ -n \"\$WATCHDOG_PID\" ] && kill \$WATCHDOG_PID 2>/dev/null" EXIT

# Logging function
log() {
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] \$1" | tee -a "\$LOG_FILE"
}

# Debug logging function - writes to debug log when debug mode is enabled
debug_log() {
    local level="\${2:-info}"
    local message="\$1"
    if [ "\$DEBUG_MODE" = "true" ]; then
        local timestamp=\$(date -Iseconds)
        echo "[\${timestamp}] [\${level}] [kiosk] \${message}" >> "\$DEBUG_LOG_FILE"
        # Also write to regular log for immediate visibility
        log "[DEBUG] \$message"
    fi
}

# Check debug mode from state file
check_debug_mode() {
    if [ -f "\$STATE_FILE" ]; then
        DEBUG_MODE=\$(jq -r '.debugMode // false' "\$STATE_FILE" 2>/dev/null || echo "false")
    else
        DEBUG_MODE="false"
    fi
}

# Read URL from config (multi-tenant aware)
get_url() {
    if [ -f "\$CONFIG_FILE" ]; then
        local url=\$(jq -r '.url // empty' "\$CONFIG_FILE" 2>/dev/null)
        local admin_url=\$(jq -r '.adminUrl // empty' "\$CONFIG_FILE" 2>/dev/null)
        local user_id=\$(jq -r '.userId // empty' "\$CONFIG_FILE" 2>/dev/null)

        if [ -n "\$url" ]; then
            echo "\$url"
        elif [ -n "\$admin_url" ] && [ -n "\$user_id" ]; then
            echo "\${admin_url}/u/\${user_id}/match"
        else
            # Fallback to admin URL configured during setup
            echo "$ADMIN_URL"
        fi
    else
        echo "$ADMIN_URL"
    fi
}

# Wait for network connectivity and server availability
wait_for_network() {
    log "Waiting for network..."
    local i=0
    while [ \$i -lt 30 ]; do
        if ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; then
            log "Network is up!"
            break
        fi
        sleep 1
        i=\$((i + 1))
    done

    # Wait for server to be ready (up to 60 seconds)
    log "Waiting for server..."
    local kiosk_url=\$(get_url)
    local server_wait=0
    while [ \$server_wait -lt 60 ]; do
        if curl -s --connect-timeout 2 "\$kiosk_url" >/dev/null 2>&1; then
            log "Server is ready!"
            return 0
        fi
        sleep 2
        server_wait=\$((server_wait + 2))
    done
    log "Server timeout - starting anyway (will retry)"
    return 1
}

# Calculate backoff with exponential increase
calculate_backoff() {
    local backoff=\$((BASE_BACKOFF * (2 ** (CRASH_COUNTER - 1))))
    [ \$backoff -gt \$MAX_BACKOFF ] && backoff=\$MAX_BACKOFF
    echo \$backoff
}

# Clear browser cache
clear_cache() {
    log "Clearing browser cache..."
    rm -rf "\$CHROMIUM_PROFILE/Default/Cache" 2>/dev/null
    rm -rf "\$CHROMIUM_PROFILE/Default/Code Cache" 2>/dev/null
    rm -rf "\$CHROMIUM_PROFILE/Default/GPUCache" 2>/dev/null
    rm -rf "\$CHROMIUM_PROFILE/ShaderCache" 2>/dev/null
    log "Cache cleared"
}

# Check if Chromium window is responsive using xdotool
# Returns 0 if responsive, 1 if unresponsive or no window found
check_chromium_responsive() {
    # Check if xdotool is available
    if ! command -v xdotool >/dev/null 2>&1; then
        # xdotool not installed, assume responsive (graceful degradation)
        return 0
    fi

    # Get Chromium window ID
    local window_id=\$(xdotool search --name "chromium" 2>/dev/null | head -1)

    if [ -z "\$window_id" ]; then
        # No window found - process may be starting or crashed
        return 1
    fi

    # Try to get window name - this will fail if window is unresponsive
    if xdotool getwindowname "\$window_id" >/dev/null 2>&1; then
        return 0  # Responsive
    else
        return 1  # Unresponsive
    fi
}

# Watchdog process - runs in background, monitors Chromium health
# Detects frozen/unresponsive browser and force-kills to trigger restart
run_watchdog() {
    local last_responsive=\$(date +%s)
    local check_interval=\$WATCHDOG_CHECK_INTERVAL
    local timeout=\$WATCHDOG_TIMEOUT
    local parent_pid=\$\$

    while true; do
        sleep \$check_interval

        # Check if main kiosk process is still running
        if ! kill -0 \$parent_pid 2>/dev/null; then
            log "[Watchdog] Parent process ended, exiting watchdog"
            exit 0
        fi

        # Check Chromium responsiveness
        if check_chromium_responsive; then
            last_responsive=\$(date +%s)
            debug_log "Watchdog check: Chromium responsive" "debug"
        else
            local now=\$(date +%s)
            local unresponsive_time=\$((now - last_responsive))

            if [ \$unresponsive_time -ge \$timeout ]; then
                log "[Watchdog] HANG DETECTED - Chromium unresponsive for \${unresponsive_time}s, force-killing"
                debug_log "Watchdog hang detected: unresponsive for \${unresponsive_time}s, killing browser" "error"

                # Force kill Chromium
                pkill -9 -f chromium 2>/dev/null || true

                # Reset responsive time for next cycle
                last_responsive=\$(date +%s)

                # Sleep briefly to let main loop handle restart
                sleep 5
            else
                log "[Watchdog] Chromium unresponsive for \${unresponsive_time}s (timeout at \${timeout}s)"
                debug_log "Watchdog warning: Chromium unresponsive for \${unresponsive_time}s" "warn"
            fi
        fi
    done
}

# Check if Chromium is already running with our profile
# This prevents starting a second browser instance
chromium_running() {
    pgrep -f "chromium.*chromium-kiosk" >/dev/null 2>&1
}

# Disable screen blanking and power management
xset s off
xset s noblank
xset -dpms

# Force HDMI on with off/on cycle (fixes Pi 5 HDMI handshake issues)
xrandr --output HDMI-1 --off 2>/dev/null
sleep 1
xrandr --output HDMI-1 --auto --mode 1920x1080 2>/dev/null

# Keep screen blanking disabled (refresh every 60 seconds in background)
(while true; do sleep 60; xset s off; xset s noblank; xset -dpms; done) &

# Hide cursor after 1 second of inactivity
unclutter -idle 1 -root &

# Start openbox window manager
log "Started openbox, waiting for it to initialize..."
openbox &
sleep 3

# Wait for network before starting browser
wait_for_network

# Soft start function - DISABLED since we now use ondemand governor
# The ondemand governor already scales CPU based on load, so soft_start is redundant
# and was causing issues during page loads (conflicting governor changes)
soft_start() {
    # Function disabled - ondemand governor handles CPU scaling automatically
    :  # No-op
}

# Main loop - restart chromium when it exits (for URL changes)
while true; do
    # Check debug mode at start of each iteration
    check_debug_mode

    # Check if Chromium is already running (prevents double instance)
    if chromium_running; then
        log "Chromium already running, waiting..."
        debug_log "Chromium already running, skipping start" "warn"
        sleep 5
        continue
    fi

    # Get current URL
    KIOSK_URL=\$(get_url)
    log "Starting Chromium with URL: \$KIOSK_URL (crash_count=\$CRASH_COUNTER)"
    debug_log "Browser start: URL=\$KIOSK_URL, crash_counter=\$CRASH_COUNTER, debug_mode=\$DEBUG_MODE"

    # Clear any crash flags from previous sessions
    rm -rf "\$CHROMIUM_PROFILE/Default/Preferences" 2>/dev/null
    mkdir -p "\$CHROMIUM_PROFILE/Default"

    # Create clean preferences to avoid restore prompts
    cat > "\$CHROMIUM_PROFILE/Default/Preferences" << PREFS
{
    "session": {
        "restore_on_startup": 1
    },
    "browser": {
        "has_seen_welcome_page": true
    }
}
PREFS

    # Brief pause before starting browser to let system stabilize
    sleep 1

    # Apply soft start to reduce power spike
    soft_start

    # Track start time for crash detection
    START_TIME=\$(date +%s)

    # Build GPU flags based on storage type
    GPU_FLAGS=""
    if [ "\$ENABLE_GPU_COMPOSITING" = "true" ]; then
        GPU_FLAGS="--use-gl=egl --enable-gpu-rasterization --ignore-gpu-blocklist"
    else
        GPU_FLAGS="--disable-gpu-compositing"
    fi

    # Build scale factor flag for large TVs (reads from config.json)
    DISPLAY_SCALE_FACTOR=\$(get_scale_factor)
    SCALE_FLAG=""
    if [ -n "\$DISPLAY_SCALE_FACTOR" ] && [ "\$DISPLAY_SCALE_FACTOR" != "1.0" ]; then
        SCALE_FLAG="--force-device-scale-factor=\$DISPLAY_SCALE_FACTOR"
        log "Using display scale factor: \$DISPLAY_SCALE_FACTOR"
    fi

    # Start watchdog process in background to detect frozen browser
    run_watchdog &
    WATCHDOG_PID=\$!
    log "Started watchdog process (PID: \$WATCHDOG_PID)"

    # Launch Chromium with storage-optimized flags
    # NVMe: More raster threads, GPU compositing enabled, larger cache
    # SD Card: Conservative settings to reduce wear and heat
    # Disable Google services (GCM, MediaRouter, etc.) to prevent 30-40s timeout crashes
    chromium \
        --password-store=basic \
        --disable-features=Translate,InProductHelp,IPH_TabSearch,IPH_SidePanelGenericPinnableCard,IPH_PasswordManagerShortcutFeature,IPH_ProfileSwitch,IPH_ReadingListInSidePanel,IPH_SidePanelReadingListReminder,UserEducation,GCMConnectionHandler,MediaRouter,SafeBrowsingEnhancedProtection,OptimizationHints,SignInRecovery,PushMessaging,BackgroundSync,Notifications,SyncPromos \
        --kiosk \
        --start-fullscreen \
        --start-maximized \
        --no-first-run \
        --disable-translate \
        --disable-infobars \
        --disable-suggestions-service \
        --disable-save-password-bubble \
        --disable-session-crashed-bubble \
        --disable-component-update \
        --disable-background-networking \
        --disable-sync \
        --disable-notifications \
        --disable-default-apps \
        --disable-extensions \
        --autoplay-policy=no-user-gesture-required \
        --check-for-update-interval=31536000 \
        --num-raster-threads=\$RASTER_THREADS \
        --disk-cache-size=\$DISK_CACHE_SIZE \
        \$GPU_FLAGS \
        \$SCALE_FLAG \
        --disable-breakpad \
        --disable-renderer-backgrounding \
        --disable-background-timer-throttling \
        --disable-dev-shm-usage \
        --remote-debugging-port=9222 \
        --remote-debugging-address=127.0.0.1 \
        --user-data-dir="\$CHROMIUM_PROFILE" \
        --window-position=0,0 \
        "\$KIOSK_URL"

    # Stop watchdog process
    if [ -n "\$WATCHDOG_PID" ] && kill -0 \$WATCHDOG_PID 2>/dev/null; then
        kill \$WATCHDOG_PID 2>/dev/null || true
        wait \$WATCHDOG_PID 2>/dev/null || true
        log "Stopped watchdog process"
    fi
    WATCHDOG_PID=""

    # Calculate how long Chromium ran
    END_TIME=\$(date +%s)
    RUNTIME=\$((END_TIME - START_TIME))

    # Crash protection with reload loop detection
    if [ \$RUNTIME -lt \$STABLE_RUN_THRESHOLD ]; then
        # Check if this was an intentional restart (URL change from display-manager)
        INTENT_VALID=false
        if [ -f "\$INTENT_FILE" ]; then
            # Read intent timestamp and validate it's recent (created after browser started)
            INTENT_TIME=\$(cat "\$INTENT_FILE" 2>/dev/null || echo "0")

            # Intent must be created after browser start, with 10s grace window
            GRACE_WINDOW=10
            VALID_INTENT_TIME=\$((START_TIME - GRACE_WINDOW))

            if [ "\$INTENT_TIME" -ge "\$VALID_INTENT_TIME" ] 2>/dev/null; then
                INTENT_VALID=true
                log "Intentional restart detected (URL change) - not counting as crash"
                debug_log "Intentional restart: runtime=\${RUNTIME}s, intent_time=\$INTENT_TIME, start_time=\$START_TIME" "info"
            else
                log "Stale intent file ignored (created at \$INTENT_TIME, browser started at \$START_TIME)"
                debug_log "Stale intent file: intent_time=\$INTENT_TIME, start_time=\$START_TIME - treating as crash" "warn"
            fi
            rm -f "\$INTENT_FILE"
        fi

        if [ "\$INTENT_VALID" = "true" ]; then
            sleep 2
        else
            # Quick exit without valid intent file - this is a crash
            CRASH_COUNTER=\$((CRASH_COUNTER + 1))
            log "Chromium exited after \${RUNTIME}s (crash #\$CRASH_COUNTER)"
            debug_log "Browser crashed: runtime=\${RUNTIME}s, crash_count=\$CRASH_COUNTER" "warn"

            # Clear cache after repeated failures
            if [ \$CRASH_COUNTER -ge \$MAX_CRASHES_BEFORE_CACHE_CLEAR ]; then
                clear_cache
                debug_log "Cache cleared after \$MAX_CRASHES_BEFORE_CACHE_CLEAR consecutive crashes" "warn"
                CRASH_COUNTER=0
            fi

            # Calculate and apply backoff
            BACKOFF=\$(calculate_backoff)
            log "Applying \${BACKOFF}s backoff before restart..."
            debug_log "Applying backoff: \${BACKOFF}s before restart" "info"
            sleep \$BACKOFF
        fi
    else
        # Stable run - reset crash counter
        if [ \$CRASH_COUNTER -gt 0 ]; then
            log "Stable run detected (\${RUNTIME}s) - resetting crash counter"
            debug_log "Stable run detected: runtime=\${RUNTIME}s, resetting crash counter" "info"
            CRASH_COUNTER=0
        fi
        log "Chromium exited after \${RUNTIME}s - restarting in 2 seconds..."
        debug_log "Browser exited normally: runtime=\${RUNTIME}s, restarting" "info"
        sleep 2
    fi
done
KIOSKSCRIPT
chmod +x "$HOME_DIR/kiosk.sh"
chown $KIOSK_USER:$KIOSK_USER "$HOME_DIR/kiosk.sh"

# .xinitrc - start kiosk on X launch
cat > "$HOME_DIR/.xinitrc" << EOF
#!/bin/bash
exec $HOME_DIR/kiosk.sh
EOF
chmod +x "$HOME_DIR/.xinitrc"
chown $KIOSK_USER:$KIOSK_USER "$HOME_DIR/.xinitrc"

# .bash_profile - no startx needed since LightDM handles X session
# Keep a minimal .bash_profile for SSH sessions
cat > "$HOME_DIR/.bash_profile" << 'EOF'
# Source .bashrc for interactive shells
if [ -f "$HOME/.bashrc" ]; then
    . "$HOME/.bashrc"
fi
EOF
chown $KIOSK_USER:$KIOSK_USER "$HOME_DIR/.bash_profile"

# CDP Scale Service - enables real-time display scale changes via Chrome DevTools Protocol
# This Node.js service connects to Chromium's CDP port and applies scale changes instantly
cat > "$HOME_DIR/cdp-service.js" << 'CDPSCRIPT'
#!/usr/bin/env node
/**
 * CDP Scale Service
 * Provides real-time display scaling via Chrome DevTools Protocol
 * Runs on port 9223 (localhost only) and connects to Chromium on port 9222
 */

const http = require('http');

const CDP_PORT = 9222;
const SERVICE_PORT = 9223;
const SCALE_MIN = 0.5;
const SCALE_MAX = 3.0;

let wsConnection = null;
let reconnectTimer = null;
let currentScale = 1.0;

// Logging
function log(msg, level = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${msg}`);
}

// Connect to Chromium CDP
async function connectToCDP() {
    try {
        // Get list of targets
        const targetsRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
        const targets = await targetsRes.json();

        // Find the page target
        const pageTarget = targets.find(t => t.type === 'page');
        if (!pageTarget) {
            log('No page target found', 'warn');
            scheduleReconnect();
            return false;
        }

        log(`Found page target: ${pageTarget.title || pageTarget.url}`);

        // Connect via WebSocket to page's debugger URL
        // When connecting directly to page's webSocketDebuggerUrl, we're already
        // attached to that target - no need to call Target.attachToTarget
        const WebSocket = require('ws');
        wsConnection = new WebSocket(pageTarget.webSocketDebuggerUrl);

        // Handle CDP responses - set up before 'open' event
        let msgId = 0;
        const pendingCallbacks = new Map();

        wsConnection.sendCommand = (method, params = {}) => {
            return new Promise((resolve, reject) => {
                const id = ++msgId;
                pendingCallbacks.set(id, { resolve, reject });
                // No sessionId needed when connected directly to page's websocket
                const msg = JSON.stringify({ id, method, params });
                wsConnection.send(msg);
            });
        };

        wsConnection.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.id && pendingCallbacks.has(msg.id)) {
                    const { resolve, reject } = pendingCallbacks.get(msg.id);
                    pendingCallbacks.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(msg.error.message));
                    } else {
                        resolve(msg.result);
                    }
                }
            } catch (e) {
                log(`Failed to parse CDP message: ${e}`, 'error');
            }
        });

        wsConnection.on('open', () => {
            log('Connected to Chromium CDP - ready for scale commands');
        });

        wsConnection.on('close', () => {
            log('CDP connection closed', 'warn');
            wsConnection = null;
            scheduleReconnect();
        });

        wsConnection.on('error', (err) => {
            log(`CDP connection error: ${err.message}`, 'error');
        });

        return true;
    } catch (err) {
        log(`Failed to connect to CDP: ${err.message}`, 'error');
        scheduleReconnect();
        return false;
    }
}

// Send CDP command
async function sendCDPCommand(method, params = {}) {
    if (!wsConnection || wsConnection.readyState !== 1) {
        throw new Error('Not connected to CDP');
    }
    return wsConnection.sendCommand(method, params);
}

// Schedule reconnection
function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        log('Attempting to reconnect to CDP...');
        connectToCDP();
    }, 5000);
}

// Apply display scale via CDP
async function applyScale(scale) {
    if (!wsConnection || wsConnection.readyState !== 1) {
        throw new Error('CDP not connected');
    }

    // Validate scale
    if (scale < SCALE_MIN || scale > SCALE_MAX) {
        throw new Error(`Scale must be between ${SCALE_MIN} and ${SCALE_MAX}`);
    }

    // Use Emulation.setDeviceMetricsOverride to set scale
    // Get current viewport size first
    const viewport = await sendCDPCommand('Runtime.evaluate', {
        expression: 'JSON.stringify({width: window.innerWidth, height: window.innerHeight})',
        returnByValue: true
    });

    let width = 1920;
    let height = 1080;
    try {
        const dims = JSON.parse(viewport.result.value);
        width = dims.width || 1920;
        height = dims.height || 1080;
    } catch (e) {
        log('Could not get viewport size, using defaults', 'warn');
    }

    // Apply the device metrics override
    await sendCDPCommand('Emulation.setDeviceMetricsOverride', {
        width: Math.round(width / scale),
        height: Math.round(height / scale),
        deviceScaleFactor: scale,
        mobile: false
    });

    currentScale = scale;
    log(`Scale applied: ${scale}x`);
    return true;
}

// HTTP Server
const server = http.createServer(async (req, res) => {
    // CORS headers for local requests
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({
            status: 'ok',
            chromiumConnected: wsConnection && wsConnection.readyState === 1,
            currentScale: currentScale
        }));
        return;
    }

    // Scale endpoint
    if (req.method === 'POST' && req.url === '/scale') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const scale = parseFloat(data.scaleFactor);

                if (isNaN(scale)) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Invalid scaleFactor' }));
                    return;
                }

                await applyScale(scale);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, appliedScale: scale }));
            } catch (err) {
                log(`Scale error: ${err.message}`, 'error');
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    // 404 for unknown routes
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});

// Start server
server.listen(SERVICE_PORT, '127.0.0.1', () => {
    log(`CDP Scale Service listening on 127.0.0.1:${SERVICE_PORT}`);
    // Initial connection to CDP (with delay to let Chromium start)
    setTimeout(() => connectToCDP(), 3000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('Shutting down...');
    if (wsConnection) wsConnection.close();
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    log('Interrupted, shutting down...');
    if (wsConnection) wsConnection.close();
    server.close(() => process.exit(0));
});
CDPSCRIPT
chmod +x "$HOME_DIR/cdp-service.js"
chown $KIOSK_USER:$KIOSK_USER "$HOME_DIR/cdp-service.js"

# Install ws package for WebSocket support (required by cdp-service.js)
echo_info "Installing WebSocket package for CDP service..."
cd "$HOME_DIR"
sudo -u $KIOSK_USER npm init -y 2>/dev/null || true
sudo -u $KIOSK_USER npm install ws --save 2>/dev/null || npm install ws --save

# Display Detection Script - detects TV physical size via xrandr and suggests scale
cat > "$HOME_DIR/detect-display.sh" << 'DETECTSCRIPT'
#!/bin/bash
#
# Display Detection Script
# Detects physical display dimensions via xrandr and calculates suggested scale
#

CONFIG_DIR="$HOME/.config/kiosk"
DISPLAY_INFO_FILE="$CONFIG_DIR/display-info.json"

mkdir -p "$CONFIG_DIR"

# Get display dimensions from xrandr
# Format: "HDMI-1 connected 1920x1080+0+0 (normal...) 600mm x 340mm"
get_display_dimensions() {
    # Need DISPLAY for xrandr
    export DISPLAY=:0

    local xrandr_output=$(xrandr 2>/dev/null | grep " connected" | head -1)

    if [ -z "$xrandr_output" ]; then
        echo "0 0"
        return 1
    fi

    # Extract dimensions like "600mm x 340mm" or "950mm x 540mm"
    local dimensions=$(echo "$xrandr_output" | grep -oP '\d+mm x \d+mm' | head -1)

    if [ -z "$dimensions" ]; then
        echo "0 0"
        return 1
    fi

    local width_mm=$(echo "$dimensions" | grep -oP '^\d+')
    local height_mm=$(echo "$dimensions" | grep -oP '\d+(?=mm$)')

    echo "$width_mm $height_mm"
}

# Calculate diagonal in inches
calculate_diagonal() {
    local width_mm=$1
    local height_mm=$2

    if [ "$width_mm" -eq 0 ] || [ "$height_mm" -eq 0 ]; then
        echo "0"
        return
    fi

    # diagonal = sqrt(w^2 + h^2) / 25.4
    local diagonal=$(echo "scale=1; sqrt($width_mm * $width_mm + $height_mm * $height_mm) / 25.4" | bc)
    echo "$diagonal"
}

# Suggest scale based on diagonal size
suggest_scale() {
    local diagonal=$1

    # Handle empty or zero
    if [ -z "$diagonal" ] || [ "$diagonal" = "0" ]; then
        echo "1.0"
        return
    fi

    # Compare using bc for floating point
    if [ $(echo "$diagonal < 32" | bc) -eq 1 ]; then
        echo "1.0"
    elif [ $(echo "$diagonal < 40" | bc) -eq 1 ]; then
        echo "1.5"
    elif [ $(echo "$diagonal < 50" | bc) -eq 1 ]; then
        echo "2.0"
    else
        echo "2.5"
    fi
}

# Main detection
main() {
    local dims=$(get_display_dimensions)
    local width_mm=$(echo "$dims" | cut -d' ' -f1)
    local height_mm=$(echo "$dims" | cut -d' ' -f2)

    local diagonal=$(calculate_diagonal "$width_mm" "$height_mm")
    local suggested_scale=$(suggest_scale "$diagonal")

    # Write to JSON file
    cat > "$DISPLAY_INFO_FILE" << EOF
{
    "physicalWidth": $width_mm,
    "physicalHeight": $height_mm,
    "diagonalInches": $diagonal,
    "suggestedScale": $suggested_scale,
    "detectedAt": "$(date -Iseconds)"
}
EOF

    echo "Display detected: ${width_mm}mm x ${height_mm}mm = ${diagonal}\" diagonal"
    echo "Suggested scale: ${suggested_scale}x"
}

main "$@"
DETECTSCRIPT
chmod +x "$HOME_DIR/detect-display.sh"
chown $KIOSK_USER:$KIOSK_USER "$HOME_DIR/detect-display.sh"

# CDP Service systemd unit
cat > /etc/systemd/system/cdp-scale.service << EOF
[Unit]
Description=CDP Scale Service for Display Scaling
After=graphical.target kiosk-manager.service
Wants=graphical.target

[Service]
Type=simple
User=$KIOSK_USER
WorkingDirectory=$HOME_DIR
ExecStart=/usr/bin/node $HOME_DIR/cdp-service.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=graphical.target
EOF

# Enable CDP service
systemctl daemon-reload
systemctl enable cdp-scale.service

# Create cron job to run display detection hourly
(crontab -u $KIOSK_USER -l 2>/dev/null || true; echo "0 * * * * $HOME_DIR/detect-display.sh > /dev/null 2>&1") | sort -u | crontab -u $KIOSK_USER -

# Run initial display detection (will run after X starts)
cat > /etc/systemd/system/detect-display.service << EOF
[Unit]
Description=Detect Display Dimensions
After=graphical.target
Wants=graphical.target

[Service]
Type=oneshot
User=$KIOSK_USER
ExecStartPre=/bin/sleep 10
ExecStart=$HOME_DIR/detect-display.sh
Environment=DISPLAY=:0

[Install]
WantedBy=graphical.target
EOF

systemctl daemon-reload
systemctl enable detect-display.service

# ============================================
# STEP 6: Create Display Manager Service
# ============================================
echo_info "[6/9] Creating display manager service..."

# Display manager script - handles registration, heartbeats, config changes, remote commands, and debug logging
# Supports cross-network communication with admin dashboard
cat > "$HOME_DIR/display-manager.sh" << 'MANAGERSCRIPT'
#!/bin/bash
#
# Display Manager for Tournament Display System
# Supports cross-network communication with admin dashboard
# Debug mode support with log collection and push to admin
#

CONFIG_FILE="$HOME/.config/kiosk/config.json"
STATE_FILE="$HOME/.config/kiosk/state.json"
LOG_FILE="$HOME/.config/kiosk/manager.log"
DEBUG_LOG_FILE="$HOME/.config/kiosk/debug.log"
# Read ADMIN_URL from config, fallback to configured value from setup
ADMIN_URL=\$(jq -r '.adminUrl // empty' "\$CONFIG_FILE" 2>/dev/null)
[ -z "\$ADMIN_URL" ] && ADMIN_URL="$ADMIN_URL"
MAX_LOG_LINES=1000
MAX_DEBUG_LOG_LINES=2000

mkdir -p "$(dirname "$LOG_FILE")"

# Cached values
CACHED_MAC=""
CACHED_HOSTNAME=""
CACHED_DISPLAY_ID=""
CACHED_EXTERNAL_IP=""
EXTERNAL_IP_LAST_CHECK=0

# Debug mode state
DEBUG_MODE=false
LAST_LOG_PUSH=0
LOG_PUSH_INTERVAL=30

log() {
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] $1" >> "$LOG_FILE"
    # Truncate log if too large
    local lines=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
    [ "$lines" -gt $MAX_LOG_LINES ] && tail -n 500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
}

# Debug logging function - writes to debug log when debug mode is enabled
debug_log() {
    local level="${2:-info}"
    local source="${3:-manager}"
    local message="$1"
    if [ "$DEBUG_MODE" = "true" ]; then
        local timestamp=$(date -Iseconds)
        echo "{\"timestamp\":\"${timestamp}\",\"level\":\"${level}\",\"source\":\"${source}\",\"message\":\"${message}\"}" >> "$DEBUG_LOG_FILE"
        # Also write to regular log
        log "[DEBUG:${level}] $message"
        # Truncate debug log if too large
        local lines=$(wc -l < "$DEBUG_LOG_FILE" 2>/dev/null || echo 0)
        [ "$lines" -gt $MAX_DEBUG_LOG_LINES ] && tail -n 1000 "$DEBUG_LOG_FILE" > "$DEBUG_LOG_FILE.tmp" && mv "$DEBUG_LOG_FILE.tmp" "$DEBUG_LOG_FILE"
    fi
}

# Update debug mode in state file
update_debug_mode() {
    local new_mode="$1"
    if [ "$new_mode" != "$DEBUG_MODE" ]; then
        DEBUG_MODE="$new_mode"
        # Update state file
        if [ -f "$STATE_FILE" ]; then
            local state=$(cat "$STATE_FILE")
            echo "$state" | jq --arg mode "$DEBUG_MODE" '. + {debugMode: ($mode == "true")}' > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
        fi
        log "Debug mode changed to: $DEBUG_MODE"
        if [ "$DEBUG_MODE" = "true" ]; then
            debug_log "Debug mode enabled - verbose logging started" "info" "manager"
            debug_log "System info: hostname=$CACHED_HOSTNAME, MAC=$CACHED_MAC, IP=$(get_ip)" "info" "system"
            debug_log "CPU temp=$(get_cpu_temp)C, Memory=$(get_memory_usage)%, Voltage=$(get_voltage)V" "info" "system"
        fi
    fi
}

# Push debug logs to admin dashboard
push_debug_logs() {
    [ "$DEBUG_MODE" != "true" ] && return
    [ -z "$CACHED_DISPLAY_ID" ] && return
    [ ! -f "$DEBUG_LOG_FILE" ] && return

    local now=$(date +%s)
    [ $((now - LAST_LOG_PUSH)) -lt $LOG_PUSH_INTERVAL ] && return

    LAST_LOG_PUSH=$now

    # Read last 50 lines of debug log and format as JSON array
    local log_entries=$(tail -n 50 "$DEBUG_LOG_FILE" 2>/dev/null | jq -s '.' 2>/dev/null)
    [ -z "$log_entries" ] || [ "$log_entries" = "null" ] && return

    # Push to admin dashboard
    local response=$(curl -s --connect-timeout 5 -X POST "$ADMIN_URL/api/displays/$CACHED_DISPLAY_ID/logs" \
        -H "Content-Type: application/json" \
        -d "{\"logs\":$log_entries}" 2>/dev/null)

    if echo "$response" | jq -e '.success' >/dev/null 2>&1; then
        # Check if debug mode is still enabled
        local server_debug=$(echo "$response" | jq -r '.debugMode // false')
        if [ "$server_debug" = "false" ] && [ "$DEBUG_MODE" = "true" ]; then
            log "Debug mode disabled by server"
            update_debug_mode "false"
        fi
    fi
}

init_cached_values() {
    CACHED_MAC=$(cat /sys/class/net/wlan0/address 2>/dev/null || cat /sys/class/net/eth0/address 2>/dev/null || echo "00:00:00:00:00:00")
    CACHED_HOSTNAME=$(hostname)
    CACHED_DISPLAY_ID=$(jq -r ".displayId // empty" "$STATE_FILE" 2>/dev/null)
    DEBUG_MODE=$(jq -r ".debugMode // false" "$STATE_FILE" 2>/dev/null || echo "false")
    log "Cached: MAC=$CACHED_MAC, hostname=$CACHED_HOSTNAME, display_id=$CACHED_DISPLAY_ID, debug_mode=$DEBUG_MODE"
}

get_ip() {
    hostname -I 2>/dev/null | awk '{print $1}' || echo "Unknown"
}

get_external_ip() {
    # Cache external IP, refresh every 5 minutes
    local now=$(date +%s)
    if [ $((now - EXTERNAL_IP_LAST_CHECK)) -gt 300 ] || [ -z "$CACHED_EXTERNAL_IP" ]; then
        CACHED_EXTERNAL_IP=$(curl -s --connect-timeout 3 https://api.ipify.org 2>/dev/null || echo "Unknown")
        EXTERNAL_IP_LAST_CHECK=$now
    fi
    echo "$CACHED_EXTERNAL_IP"
}

get_cpu_temp() {
    local temp=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)
    echo $((temp / 1000))
}

get_memory_usage() {
    local meminfo=$(cat /proc/meminfo)
    local total=$(echo "$meminfo" | awk '/MemTotal:/ {print $2}')
    local available=$(echo "$meminfo" | awk '/MemAvailable:/ {print $2}')
    echo $(( (total - available) * 100 / total ))
}

get_wifi_info() {
    local iwout=$(iwconfig wlan0 2>/dev/null)
    local quality=$(echo "$iwout" | grep -o 'Link Quality=[0-9]*/[0-9]*' | cut -d'=' -f2)
    local signal=$(echo "$iwout" | grep -o 'Signal level=-[0-9]*' | cut -d'=' -f2 | tr -d '-')

    local quality_pct=0
    if [ -n "$quality" ]; then
        local current=$(echo "$quality" | cut -d'/' -f1)
        local max=$(echo "$quality" | cut -d'/' -f2)
        [ "$max" -gt 0 ] && quality_pct=$((current * 100 / max))
    fi
    echo "$quality_pct ${signal:-0}"
}

get_ssid() {
    iwgetid -r 2>/dev/null || echo "Unknown"
}

get_voltage() {
    vcgencmd measure_volts core 2>/dev/null | grep -oP '[0-9.]+' || echo "0"
}

get_uptime() {
    awk '{printf "%.0f", $1}' /proc/uptime
}

# Get display info from detect-display.sh output
get_display_info() {
    local display_info_file="$HOME/.config/kiosk/display-info.json"
    if [ -f "$display_info_file" ]; then
        cat "$display_info_file"
    else
        echo '{"physicalWidth":0,"physicalHeight":0,"diagonalInches":0,"suggestedScale":1.0}'
    fi
}

get_current_url() {
    if [ -f "$CONFIG_FILE" ]; then
        local url=$(jq -r '.url // empty' "$CONFIG_FILE" 2>/dev/null)
        local admin_url=$(jq -r '.adminUrl // empty' "$CONFIG_FILE" 2>/dev/null)
        local user_id=$(jq -r '.userId // empty' "$CONFIG_FILE" 2>/dev/null)

        if [ -n "$url" ]; then
            echo "$url"
        elif [ -n "$admin_url" ] && [ -n "$user_id" ]; then
            echo "${admin_url}/u/${user_id}/match"
        else
            echo "$ADMIN_URL"
        fi
    else
        echo "$ADMIN_URL"
    fi
}

get_current_view() {
    local url=$(get_current_url)
    # Check by URL pattern, domain, or port number
    case "$url" in
        # Multi-tenant match display pattern
        */u/*/match*) echo "match" ;;
        # Port-based detection (TCC-Custom ports)
        *:2052*) echo "match" ;;
        *:2053*|*:8081*) echo "bracket" ;;
        *:2054*|*:8082*) echo "flyer" ;;
        # Domain-based detection (external)
        *flyer*) echo "flyer" ;;
        *bracket*) echo "bracket" ;;
        *match*|*live*) echo "match" ;;
        # Default to match
        *) echo "match" ;;
    esac
}

update_url() {
    local new_url="$1"
    local current_url=$(get_current_url)
    local current_scale=$(jq -r '.displayScaleFactor // 1.0' "$CONFIG_FILE" 2>/dev/null || echo "1.0")
    local current_user_id=$(jq -r '.userId // empty' "$CONFIG_FILE" 2>/dev/null)
    local current_admin_url=$(jq -r '.adminUrl // empty' "$CONFIG_FILE" 2>/dev/null)

    if [ "$new_url" != "$current_url" ]; then
        log "URL changed: $current_url -> $new_url"
        cat > "$CONFIG_FILE" << CONF
{
    "url": "$new_url",
    "adminUrl": "${current_admin_url:-$ADMIN_URL}",
    "userId": ${current_user_id:-0},
    "displayScaleFactor": $current_scale,
    "heartbeatInterval": 30,
    "configCheckInterval": 60,
    "lastUpdated": "$(date -Iseconds)"
}
CONF
        return 0
    fi
    return 1
}

refresh_browser() {
    log "Killing browser for URL change"
    # Write epoch timestamp to intent file so kiosk.sh can validate it's recent
    echo $(date +%s) > "$HOME/.config/kiosk/intent_restart"
    pkill -f chromium 2>/dev/null || true
}

execute_command() {
    local action="$1"
    log "Executing pending command: $action"
    case "$action" in
        reboot)
            log "Rebooting system..."
            sudo reboot
            ;;
        shutdown)
            log "Shutting down system..."
            sudo shutdown -h now
            ;;
        *)
            log "Unknown command: $action"
            ;;
    esac
}

register_display() {
    local ip=$(get_ip)
    local external_ip=$(get_external_ip)
    local current_view=$(get_current_view)
    local user_id=$(jq -r '.userId // empty' "$CONFIG_FILE" 2>/dev/null)

    log "Registering: $CACHED_HOSTNAME, MAC: $CACHED_MAC, IP: $ip, External: $external_ip, userId: $user_id"

    local response=$(curl -s --connect-timeout 10 -X POST "$ADMIN_URL/api/displays/register" \
        -H "Content-Type: application/json" \
        -d "{\"hostname\":\"$CACHED_HOSTNAME\",\"mac\":\"$CACHED_MAC\",\"ip\":\"$ip\",\"externalIp\":\"$external_ip\",\"currentView\":\"$current_view\",\"userId\":${user_id:-null}}" 2>/dev/null)

    if echo "$response" | jq -e '.success' >/dev/null 2>&1; then
        CACHED_DISPLAY_ID=$(echo "$response" | jq -r '.id')
        echo "{\"displayId\":\"$CACHED_DISPLAY_ID\",\"registeredAt\":\"$(date -Iseconds)\"}" > "$STATE_FILE"
        log "Registered! ID: $CACHED_DISPLAY_ID"

        local server_url=$(echo "$response" | jq -r '.config.serverUrl // empty')
        if [ -n "$server_url" ]; then
            local use_tls=$(echo "$response" | jq -r '.config.useTls // true')
            [ "$use_tls" = "false" ] && local protocol="http" || local protocol="https"
            update_url "${protocol}://${server_url}" && refresh_browser
        fi
        return 0
    else
        log "Registration failed"
        return 1
    fi
}

send_heartbeat() {
    [ -z "$CACHED_DISPLAY_ID" ] && { register_display; return; }

    local current_view=$(get_current_view)
    local ip=$(get_ip)
    local external_ip=$(get_external_ip)
    local ssid=$(get_ssid)
    local voltage=$(get_voltage)
    local cpu_temp=$(get_cpu_temp)
    local mem_usage=$(get_memory_usage)
    local wifi_info=$(get_wifi_info)
    local wifi_quality=$(echo "$wifi_info" | awk '{print $1}')
    local wifi_signal=$(echo "$wifi_info" | awk '{print $2}')
    local uptime_secs=$(get_uptime)
    local user_id=$(jq -r '.userId // empty' "$CONFIG_FILE" 2>/dev/null)

    # Get display info (physical dimensions, diagonal, suggested scale)
    local display_info=$(get_display_info)
    local display_width=$(echo "$display_info" | jq -r '.physicalWidth // 0')
    local display_height=$(echo "$display_info" | jq -r '.physicalHeight // 0')
    local display_diagonal=$(echo "$display_info" | jq -r '.diagonalInches // 0')
    local display_suggested=$(echo "$display_info" | jq -r '.suggestedScale // 1.0')

    # Check if CDP service is running
    local cdp_status=$(curl -s --connect-timeout 1 "http://127.0.0.1:9223/health" 2>/dev/null || echo '{}')
    local cdp_connected=$(echo "$cdp_status" | jq -r '.chromiumConnected // false')

    debug_log "Sending heartbeat: CPU=${cpu_temp}C, Mem=${mem_usage}%, WiFi=${wifi_quality}%, View=${current_view}, userId=${user_id}, CDP=${cdp_connected}" "debug" "manager"

    local response=$(curl -s --connect-timeout 5 -X POST "$ADMIN_URL/api/displays/$CACHED_DISPLAY_ID/heartbeat" \
        -H "Content-Type: application/json" \
        -d "{\"uptimeSeconds\":$uptime_secs,\"cpuTemp\":$cpu_temp,\"memoryUsage\":$mem_usage,\"wifiQuality\":$wifi_quality,\"wifiSignal\":$wifi_signal,\"currentView\":\"$current_view\",\"ip\":\"$ip\",\"externalIp\":\"$external_ip\",\"ssid\":\"$ssid\",\"voltage\":$voltage,\"mac\":\"$CACHED_MAC\",\"hostname\":\"$CACHED_HOSTNAME\",\"userId\":${user_id:-null},\"displayInfo\":{\"physicalWidth\":$display_width,\"physicalHeight\":$display_height,\"diagonalInches\":$display_diagonal,\"suggestedScale\":$display_suggested},\"cdpEnabled\":$cdp_connected}" 2>/dev/null)

    if ! echo "$response" | jq -e '.success' >/dev/null 2>&1; then
        debug_log "Heartbeat failed - no response or server error" "warn" "manager"
    fi
}

# Apply scale via CDP service (instant, no browser restart)
apply_scale_via_cdp() {
    local scale="$1"

    debug_log "Attempting CDP scale change to ${scale}x" "info" "manager"

    local response=$(curl -s --connect-timeout 2 -X POST "http://127.0.0.1:9223/scale" \
        -H "Content-Type: application/json" \
        -d "{\"scaleFactor\":$scale}" 2>/dev/null)

    if echo "$response" | jq -e '.success == true' >/dev/null 2>&1; then
        log "Scale changed to ${scale}x via CDP (instant)"
        debug_log "CDP scale success: ${scale}x applied instantly" "info" "manager"
        return 0
    else
        local error=$(echo "$response" | jq -r '.error // "Unknown error"' 2>/dev/null)
        log "CDP scale failed: $error"
        debug_log "CDP scale failed: $error, falling back to browser restart" "warn" "manager"
        return 1
    fi
}

check_config() {
    [ -z "$CACHED_DISPLAY_ID" ] && return

    debug_log "Checking config from server" "debug" "manager"
    local response=$(curl -s --connect-timeout 5 "$ADMIN_URL/api/displays/$CACHED_DISPLAY_ID/config" 2>/dev/null)

    if echo "$response" | jq -e '.success' >/dev/null 2>&1; then
        # Check for debug mode changes
        local server_debug_mode=$(echo "$response" | jq -r '.debugMode // false')
        if [ "$server_debug_mode" = "true" ] && [ "$DEBUG_MODE" != "true" ]; then
            update_debug_mode "true"
        elif [ "$server_debug_mode" = "false" ] && [ "$DEBUG_MODE" = "true" ]; then
            update_debug_mode "false"
        fi

        # Check for display scale factor changes
        local server_scale=$(echo "$response" | jq -r '.displayScaleFactor // empty')
        if [ -n "$server_scale" ] && [ "$server_scale" != "null" ]; then
            local current_scale=$(jq -r '.displayScaleFactor // "1.0"' "$CONFIG_FILE" 2>/dev/null)
            if [ "$server_scale" != "$current_scale" ]; then
                log "Scale factor changed: $current_scale -> $server_scale"
                debug_log "Scale factor update: $current_scale -> $server_scale" "info" "manager"

                # Update config file with new scale
                local current_url=$(get_current_url)
                cat > "$CONFIG_FILE" << CONF
{
    "url": "$current_url",
    "displayScaleFactor": $server_scale,
    "adminUrl": "$ADMIN_URL",
    "heartbeatInterval": 30,
    "configCheckInterval": 60,
    "lastUpdated": "$(date -Iseconds)"
}
CONF

                # Try CDP first (instant scale change)
                if apply_scale_via_cdp "$server_scale"; then
                    # CDP succeeded - no browser restart needed
                    return
                fi

                # CDP failed - fallback to browser restart
                refresh_browser
                return
            fi
        fi

        # Check for pending command first
        local pending_cmd=$(echo "$response" | jq -r '.pendingCommand.action // empty')
        if [ -n "$pending_cmd" ]; then
            debug_log "Received pending command: $pending_cmd" "info" "manager"
            execute_command "$pending_cmd"
            return
        fi

        # Check for URL change
        local should_restart=$(echo "$response" | jq -r '.shouldRestart // false')
        local server_url=$(echo "$response" | jq -r '.config.serverUrl // empty')

        if [ "$should_restart" = "true" ] && [ -n "$server_url" ]; then
            debug_log "URL change detected, restarting browser to: $server_url" "info" "manager"
            local use_tls=$(echo "$response" | jq -r '.config.useTls // true')
            [ "$use_tls" = "false" ] && local protocol="http" || local protocol="https"
            update_url "${protocol}://${server_url}" && refresh_browser
        fi
    else
        debug_log "Config check failed - no response or invalid JSON" "warn" "manager"
    fi
}

wait_for_network() {
    log "Waiting for network..."
    local i=0
    while [ $i -lt 30 ]; do
        ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1 && { log "Network up!"; return 0; }
        sleep 1
        i=$((i + 1))
    done
    log "Network timeout"
    return 1
}

# MAIN
log "========================================="
log "Display Manager starting..."
log "========================================="

wait_for_network
init_cached_values
register_display

last_heartbeat=0
last_config_check=0
last_log_push=0

while true; do
    current_time=$(date +%s)

    [ $((current_time - last_heartbeat)) -ge 30 ] && { send_heartbeat; last_heartbeat=$current_time; }
    [ $((current_time - last_config_check)) -ge 10 ] && { check_config; last_config_check=$current_time; }

    # Push debug logs every 30 seconds when debug mode is enabled
    if [ "$DEBUG_MODE" = "true" ] && [ $((current_time - last_log_push)) -ge 30 ]; then
        push_debug_logs
        last_log_push=$current_time
    fi

    sleep 5
done
MANAGERSCRIPT

# Replace HOME with actual path
sed -i "s|\$HOME|$HOME_DIR|g" "$HOME_DIR/display-manager.sh"
chmod +x "$HOME_DIR/display-manager.sh"
chown $KIOSK_USER:$KIOSK_USER "$HOME_DIR/display-manager.sh"

# Create systemd service for display manager
cat > /etc/systemd/system/kiosk-manager.service << EOF
[Unit]
Description=Tournament Display Manager
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$KIOSK_USER
Environment=HOME=$HOME_DIR
ExecStartPre=/bin/sleep 15
ExecStart=$HOME_DIR/display-manager.sh
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kiosk-manager

# ============================================
# STEP 7: System Optimizations for Pi 5
# ============================================
echo_info "[7/9] Applying Pi 5 optimizations..."

# Disable ssh-agent to prevent duplicate kiosk.sh processes
# ssh-agent wraps the session script and can cause fd inheritance issues with flock
echo_info "Disabling ssh-agent in Xsession.options..."
if [ -f /etc/X11/Xsession.options ]; then
    sed -i 's/^use-ssh-agent/#use-ssh-agent/' /etc/X11/Xsession.options
fi

# Create Xorg config to disable DPMS and screen blanking
echo_info "Creating Xorg blanking prevention config..."
mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/10-blanking.conf << 'XORGCONF'
Section "Extensions"
    Option "DPMS" "false"
EndSection

Section "ServerFlags"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime" "0"
    Option "BlankTime" "0"
EndSection
XORGCONF

# Create dispsetup.sh script (runs before X session starts)
echo_info "Creating display setup script..."
cat > /usr/share/dispsetup.sh << 'DISPSETUP'
#!/bin/sh
# Disable screen blanking and force HDMI on with cycle
xset s off
xset s noblank
xset -dpms

# HDMI off/on cycle to force handshake (fixes Pi 5 blank screen on boot)
sleep 2
xrandr --output HDMI-1 --off 2>/dev/null
sleep 1
xrandr --output HDMI-1 --auto --mode 1920x1080 2>/dev/null
xrandr --output HDMI-A-1 --off 2>/dev/null
sleep 1
xrandr --output HDMI-A-1 --auto --mode 1920x1080 2>/dev/null
exit 0
DISPSETUP
chmod +x /usr/share/dispsetup.sh

# Add display-setup-script to lightdm config
if [ -f /etc/lightdm/lightdm.conf ]; then
    if ! grep -q "^display-setup-script=" /etc/lightdm/lightdm.conf; then
        sed -i '/\[Seat:\*\]/a display-setup-script=/usr/share/dispsetup.sh' /etc/lightdm/lightdm.conf
    fi
fi

# NOTE: HDMI keepalive service REMOVED - it was causing Chromium page reloads every 60 seconds
# The dispsetup.sh script handles HDMI initialization at X startup, which is sufficient
# If screen blanking issues persist, the openbox autostart and xset commands handle it
echo_info "Skipping HDMI keepalive service (causes page reloads)..."

# Create openbox autostart for screen blanking prevention
mkdir -p "$HOME_DIR/.config/openbox"
cat > "$HOME_DIR/.config/openbox/autostart" << 'OBSTART'
# Disable screen blanking and ensure HDMI is on
xset s off &
xset s noblank &
xset -dpms &
xrandr --output HDMI-1 --auto &
OBSTART
chown -R $KIOSK_USER:$KIOSK_USER "$HOME_DIR/.config/openbox"

# Mask sleep/suspend/hibernate targets
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true

# Install and configure zram (compressed RAM swap)
apt install -y zram-tools
cat > /etc/default/zramswap << EOF
ALGO=lz4
PERCENT=50
EOF
systemctl enable zramswap

# Remove Chromium system flags that conflict with kiosk mode
# Raspbian/Debian adds flags via /etc/chromium.d/ that interfere with our --disable-features flag
# Keep only the apikeys file (for Google API access), remove the rest
if [ -d /etc/chromium.d ]; then
    echo_info "Cleaning up Chromium system flags (preventing flag conflicts)..."
    mkdir -p /etc/chromium.d.bak
    for f in /etc/chromium.d/*; do
        [ -f "$f" ] || continue
        fname=$(basename "$f")
        if [ "$fname" != "apikeys" ] && [ "$fname" != "README" ]; then
            mv "$f" /etc/chromium.d.bak/ 2>/dev/null || true
            echo_info "  Moved $fname to backup"
        fi
    done
fi

# Disable SD card swap (zram is faster)
if [ -f /etc/dphys-swapfile ]; then
    systemctl disable dphys-swapfile 2>/dev/null || true
    swapoff -a 2>/dev/null || true
fi

# Configure GPU memory for Pi 5 (256MB for hardware acceleration)
CONFIG_TXT="/boot/firmware/config.txt"
[ ! -f "$CONFIG_TXT" ] && CONFIG_TXT="/boot/config.txt"

if [ -f "$CONFIG_TXT" ]; then
    # Remove existing gpu_mem setting
    sed -i '/^gpu_mem=/d' "$CONFIG_TXT"
    # Add 256MB GPU memory for Pi 5
    echo "gpu_mem=256" >> "$CONFIG_TXT"

    # Force HDMI output (prevent blank screen on boot)
    if ! grep -q "^hdmi_force_hotplug=" "$CONFIG_TXT"; then
        echo "" >> "$CONFIG_TXT"
        echo "# Force HDMI output (prevent blank screen issues)" >> "$CONFIG_TXT"
        echo "hdmi_force_hotplug=1" >> "$CONFIG_TXT"
        echo "hdmi_group=1" >> "$CONFIG_TXT"
        echo "hdmi_mode=16" >> "$CONFIG_TXT"
    fi

    # Enable hardware acceleration
    if ! grep -q "^dtoverlay=vc4-kms-v3d" "$CONFIG_TXT"; then
        echo "dtoverlay=vc4-kms-v3d" >> "$CONFIG_TXT"
    fi
fi

# Add consoleblank=0 to kernel cmdline (disables console blanking at kernel level)
CMDLINE_FILE="/boot/firmware/cmdline.txt"
[ ! -f "$CMDLINE_FILE" ] && CMDLINE_FILE="/boot/cmdline.txt"
if [ -f "$CMDLINE_FILE" ]; then
    if ! grep -q "consoleblank=0" "$CMDLINE_FILE"; then
        echo_info "Adding consoleblank=0 to kernel cmdline..."
        sed -i 's/$/ consoleblank=0/' "$CMDLINE_FILE"
    fi
fi

# Set CPU governor based on storage type
# NVMe with active cooler: 'performance' mode for maximum responsiveness
# SD Card: 'ondemand' mode to reduce heat (scales down to 1.5GHz when idle)
echo_info "Setting CPU governor to $CPU_GOVERNOR mode..."
if [ -d /sys/devices/system/cpu/cpu0/cpufreq ]; then
    # Set immediately
    for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
        echo "$CPU_GOVERNOR" > "$cpu" 2>/dev/null || true
    done

    # Make persistent via rc.local
    if [ ! -f /etc/rc.local ]; then
        cat > /etc/rc.local << RCLOCAL
#!/bin/bash
# Set CPU governor to $CPU_GOVERNOR mode (storage-optimized setting)
for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
    echo "$CPU_GOVERNOR" > "\$cpu" 2>/dev/null
done
exit 0
RCLOCAL
        chmod +x /etc/rc.local
    elif ! grep -q "scaling_governor" /etc/rc.local; then
        # Add before exit 0
        sed -i "/^exit 0/i # Set CPU governor to $CPU_GOVERNOR mode\nfor cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do\n    echo \"$CPU_GOVERNOR\" > \"\\\$cpu\" 2>/dev/null\ndone" /etc/rc.local
    fi
fi

# Disable unnecessary services
for svc in bluetooth avahi-daemon triggerhappy cups cups-browsed ModemManager; do
    systemctl disable $svc 2>/dev/null || true
    systemctl stop $svc 2>/dev/null || true
done

# Configure logrotate for kiosk logs (proper log rotation)
echo_info "Configuring logrotate for kiosk logs..."
cat > /etc/logrotate.d/kiosk << LOGROTATE
$HOME_DIR/.config/kiosk/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 $KIOSK_USER $KIOSK_USER
    maxsize 10M
}
LOGROTATE

# Enable and verify NTP time synchronization
echo_info "Enabling NTP time synchronization..."
systemctl enable systemd-timesyncd
systemctl start systemd-timesyncd

# Wait for time sync (important for SSL certificates and logging)
echo_info "Waiting for time sync..."
SYNC_WAIT=0
while [ $SYNC_WAIT -lt 30 ]; do
    if timedatectl status | grep -q "System clock synchronized: yes"; then
        echo_info "Time synchronized successfully"
        break
    fi
    sleep 1
    SYNC_WAIT=$((SYNC_WAIT + 1))
done

if [ $SYNC_WAIT -ge 30 ]; then
    echo_warn "Time sync not confirmed (will retry on boot)"
fi

# Show current time settings
timedatectl status | grep -E "(Local time|System clock synchronized)" || true

# ============================================
# STEP 8: Set Hostname
# ============================================
# Use existing hostname if customized, otherwise generate from MAC
CURRENT_HOSTNAME=$(hostname)
if [ "$CURRENT_HOSTNAME" = "raspberrypi" ] || [ -z "$CURRENT_HOSTNAME" ]; then
    # Generate unique hostname from last 6 chars of MAC address
    MAC_SUFFIX=$(cat /sys/class/net/wlan0/address 2>/dev/null || cat /sys/class/net/eth0/address 2>/dev/null | tr -d ':' | tail -c 7)
    NEW_HOSTNAME="pi-display-${MAC_SUFFIX}"
    echo_info "[8/9] Setting hostname to $NEW_HOSTNAME..."
    hostnamectl set-hostname "$NEW_HOSTNAME"
    sed -i "s/127.0.1.1.*/127.0.1.1\t$NEW_HOSTNAME/" /etc/hosts
else
    NEW_HOSTNAME="$CURRENT_HOSTNAME"
    echo_info "[8/9] Keeping existing hostname: $NEW_HOSTNAME"
fi

# ============================================
# STEP 9: Configure WiFi Networks
# ============================================
echo_info "[9/9] Configuring WiFi networks..."

# Add WiFi networks from interactive configuration
# WIFI_NETWORKS array contains entries in format "SSID:PASSWORD:PRIORITY"
if [ ${#WIFI_NETWORKS[@]} -eq 0 ]; then
    echo_info "No WiFi networks configured during setup."
    echo_info "You can add networks later with: nmcli connection add type wifi ..."
else
    echo_info "Adding ${#WIFI_NETWORKS[@]} WiFi network(s)..."
    for network in "${WIFI_NETWORKS[@]}"; do
        IFS=':' read -r ssid password priority <<< "$network"
        echo_info "  Adding: $ssid (priority $priority)"
        nmcli connection add \
            type wifi \
            con-name "$ssid" \
            ssid "$ssid" \
            ifname wlan0 \
            wifi-sec.key-mgmt wpa-psk \
            wifi-sec.psk "$password" \
            connection.autoconnect yes \
            connection.autoconnect-priority "$priority" \
            2>/dev/null || echo_warn "WiFi '$ssid' may already exist"
    done
    echo_info "WiFi networks configured successfully."
fi

# ============================================
# COMPLETE
# ============================================
echo ""
echo "========================================"
echo -e "${GREEN}  Setup Complete!${NC}"
echo "========================================"
echo ""
echo "Storage Detection:"
echo "  Type:         $STORAGE_TYPE"
if [ "$STORAGE_TYPE" = "nvme" ]; then
echo "  NVMe Device:  $NVME_DEVICE ($NVME_SIZE)"
echo "  Mode:         High Performance (active cooling assumed)"
else
echo "  Mode:         Power Saving (SD card wear protection)"
fi
echo ""
echo "Multi-Tenant Configuration:"
echo "  Admin URL:    $ADMIN_URL"
echo "  User ID:      $USER_ID"
echo "  Display URL:  $DEFAULT_URL"
echo "  Hostname:     $NEW_HOSTNAME"
echo ""
echo "Browser Settings:"
echo "  Browser:      Chromium (storage-optimized)"
echo "  GPU Memory:   256MB"
echo "  CPU Governor: $CPU_GOVERNOR"
echo "  Raster Threads: $RASTER_THREADS"
echo "  GPU Compositing: $ENABLE_GPU_COMPOSITING"
echo "  Disk Cache:   $((CACHE_SIZE / 1048576))MB"
echo ""
echo "WiFi Networks:  ${#WIFI_NETWORKS[@]} configured"
if [ ${#WIFI_NETWORKS[@]} -gt 0 ]; then
    for network in "${WIFI_NETWORKS[@]}"; do
        IFS=':' read -r ssid password priority <<< "$network"
        echo "  - $ssid (priority $priority)"
    done
fi
echo ""
echo "Performance Optimizations:"
echo "  - zram compressed swap (50%)"
echo "  - Reload loop protection with auto-recovery"
echo "  - Storage-aware Chromium settings"
echo "  - Intent restart detection (URL changes don't count as crashes)"
echo "  - Configurable display scale factor via config.json"
echo ""
echo "Log Management:"
echo "  - Logrotate configured for kiosk logs"
echo "  - 7-day rotation, 10MB max size, compressed"
echo "  - NTP time sync verified on boot"
echo ""
echo "Screen Blanking Prevention:"
echo "  - DPMS disabled at Xorg level"
echo "  - HDMI initialization via dispsetup.sh on X startup"
echo "  - Console blanking disabled in kernel"
echo "  - xset refresh loop in kiosk.sh"
echo ""
echo "Single Instance Protection:"
echo "  - PID file lock prevents duplicate kiosk.sh"
echo "  - chromium_running() check before browser start"
echo "  - ssh-agent disabled to prevent wrapper spawning"
echo ""
echo "Debug Mode Features:"
echo "  - Toggle debug mode from admin dashboard"
echo "  - Verbose logging with level and source tracking"
echo "  - Logs stored locally at ~/.config/kiosk/debug.log"
echo "  - Auto-push to admin dashboard every 30 seconds"
echo "  - Logs viewable, filterable, and downloadable in dashboard"
echo ""
echo "On reboot, the Pi will:"
echo "  1. LightDM auto-login as $KIOSK_USER"
echo "  2. Start X server via custom kiosk session"
echo "  3. Launch Chromium in fullscreen kiosk mode"
echo "  4. Register with admin dashboard"
echo "  5. Send heartbeats every 30 seconds"
echo "  6. Auto-update URL when changed from dashboard"
echo "  7. Auto-recover from Cloudflare rate limits"
echo "  8. Push debug logs when debug mode is enabled"
echo ""
echo "Admin Dashboard: $ADMIN_URL"
echo "Display will appear in: Displays page"
echo ""
echo "Setup complete. Rebooting in 10 seconds... (Ctrl+C to cancel)"
sleep 10
echo_info "Rebooting..."
reboot
