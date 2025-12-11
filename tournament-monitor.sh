#!/bin/bash

# ============================================================================
# TOURNAMENT NIGHT COMPREHENSIVE MONITORING SCRIPT
# ============================================================================
#
# This script runs comprehensive monitoring during tournaments and logs all
# data to a text file for post-tournament analysis by Claude Code.
#
# Usage: ./tournament-monitor.sh
# Stop: Press Ctrl+C (graceful shutdown with final report)
#
# Output: monitoring-logs/tournament-YYYY-MM-DD_HH-MM-SS.log
#
# ============================================================================

# Configuration
SAMPLE_INTERVAL=15          # Seconds between samples
LOG_DIR="/root/tournament-control-center/monitoring-logs"
ADMIN_PORT=3000
SIGNUP_PORT=3001
MATCH_PORT=2052
BRACKET_PORT=2053
FLYER_PORT=2054
PI_IP="192.168.1.145"

# Services to monitor
SERVICES=(
    "control-center-admin"
    "control-center-signup"
    "magic-mirror-match"
    "magic-mirror-bracket"
    "magic-mirror-flyer"
)

# API endpoints to check (using public/unauthenticated endpoints)
declare -A API_ENDPOINTS
API_ENDPOINTS["Admin Server"]="http://localhost:${ADMIN_PORT}/"
API_ENDPOINTS["Match Module"]="http://localhost:${MATCH_PORT}/api/tournament/status"
API_ENDPOINTS["Bracket Module"]="http://localhost:${BRACKET_PORT}/api/bracket/status"
API_ENDPOINTS["Flyer Module"]="http://localhost:${FLYER_PORT}/api/flyer/status"
API_ENDPOINTS["Signup PWA"]="http://localhost:${SIGNUP_PORT}/"

# Network targets for latency checks
declare -A NETWORK_TARGETS
NETWORK_TARGETS["Gateway"]="192.168.1.1"
NETWORK_TARGETS["Google DNS"]="8.8.8.8"
NETWORK_TARGETS["Cloudflare DNS"]="1.1.1.1"
NETWORK_TARGETS["Challonge API"]="api.challonge.com"
NETWORK_TARGETS["Pi Display"]="${PI_IP}"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# State tracking
SAMPLE_COUNT=0
START_TIME=""
LOG_FILE=""
ERRORS_DETECTED=0
WARNINGS_DETECTED=0
PI_OFFLINE_COUNT=0
API_ERRORS=0
SERVICE_RESTARTS=0
SLOW_API_COUNT=0
HIGH_LOAD_COUNT=0
HIGH_MEM_COUNT=0

# Thresholds
SLOW_API_THRESHOLD=500      # ms - API response time considered slow
HIGH_LOAD_THRESHOLD=4.0     # Load average considered high
HIGH_MEM_THRESHOLD=80       # Memory % considered high
HIGH_TEMP_THRESHOLD=70      # CPU temp C considered high

# Counters for summary
declare -A SERVICE_DOWNTIME
declare -A API_FAILURE_COUNT
declare -A API_RESPONSE_TIMES
declare -A NETWORK_FAILURES

# Initialize counters
init_counters() {
    for service in "${SERVICES[@]}"; do
        SERVICE_DOWNTIME[$service]=0
    done
    for endpoint in "${!API_ENDPOINTS[@]}"; do
        API_FAILURE_COUNT[$endpoint]=0
        API_RESPONSE_TIMES[$endpoint]=""
    done
    for target in "${!NETWORK_TARGETS[@]}"; do
        NETWORK_FAILURES[$target]=0
    done
}

# Create log directory
mkdir -p "$LOG_DIR"

# Generate log filename
START_TIME=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="${LOG_DIR}/tournament-${START_TIME}.log"

# Trap for clean shutdown
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down monitoring...${NC}"
    write_final_summary
    echo ""
    echo -e "${GREEN}Monitoring complete!${NC}"
    echo -e "Log file: ${CYAN}${LOG_FILE}${NC}"
    echo ""
    echo -e "${PURPLE}To analyze with Claude Code:${NC}"
    echo "  claude \"Read ${LOG_FILE} and analyze the tournament monitoring data\""
    exit 0
}

trap cleanup SIGINT SIGTERM

# Log function with timestamp
log() {
    local level="$1"
    local message="$2"
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    echo "[${timestamp}] [${level}] ${message}" >> "$LOG_FILE"
}

# Log section header
log_section() {
    local title="$1"
    echo "" >> "$LOG_FILE"
    echo "============================================================" >> "$LOG_FILE"
    echo "=== ${title}" >> "$LOG_FILE"
    echo "=== $(date +"%Y-%m-%d %H:%M:%S")" >> "$LOG_FILE"
    echo "============================================================" >> "$LOG_FILE"
}

# Check systemd service status
check_service() {
    local service="$1"
    local status=$(systemctl is-active "$service" 2>/dev/null)
    local memory=""
    local cpu=""
    local uptime_sec=""

    if [[ "$status" == "active" ]]; then
        # Get detailed info
        local show_output=$(systemctl show "$service" --property=MainPID,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp 2>/dev/null)
        local pid=$(echo "$show_output" | grep "MainPID=" | cut -d= -f2)
        local mem_bytes=$(echo "$show_output" | grep "MemoryCurrent=" | cut -d= -f2)
        local cpu_ns=$(echo "$show_output" | grep "CPUUsageNSec=" | cut -d= -f2)
        local start_time=$(echo "$show_output" | grep "ActiveEnterTimestamp=" | cut -d= -f2-)

        # Convert memory to MB
        if [[ -n "$mem_bytes" && "$mem_bytes" != "[not set]" ]]; then
            memory=$(awk "BEGIN {printf \"%.1f\", ${mem_bytes}/1024/1024}")
        fi

        # Calculate uptime
        if [[ -n "$start_time" ]]; then
            local start_epoch=$(date -d "$start_time" +%s 2>/dev/null || echo "0")
            local now_epoch=$(date +%s)
            uptime_sec=$((now_epoch - start_epoch))
        fi

        echo "ACTIVE|${pid}|${memory}MB|${uptime_sec}s"
    else
        ((SERVICE_DOWNTIME[$service]++))
        echo "DOWN|0|0|0"
    fi
}

# Check API endpoint
check_api() {
    local name="$1"
    local url="$2"
    local start_time=$(date +%s%N)

    local response=$(curl -s -o /dev/null -w "%{http_code}|%{time_total}" --connect-timeout 5 --max-time 10 "$url" 2>/dev/null)
    local http_code=$(echo "$response" | cut -d'|' -f1)
    local time_total=$(echo "$response" | cut -d'|' -f2)

    if [[ -z "$http_code" || "$http_code" == "000" ]]; then
        ((API_FAILURE_COUNT[$name]++))
        ((API_ERRORS++))
        echo "ERROR|0|Connection failed"
    elif [[ "$http_code" -ge 200 && "$http_code" -lt 400 ]]; then
        local ms=$(awk "BEGIN {printf \"%.0f\", ${time_total}*1000}")
        API_RESPONSE_TIMES[$name]+="${ms},"
        # Track slow responses
        if [[ "$ms" -gt "$SLOW_API_THRESHOLD" ]]; then
            ((SLOW_API_COUNT++))
            echo "SLOW|${http_code}|${ms}ms"
        else
            echo "OK|${http_code}|${ms}ms"
        fi
    else
        ((API_FAILURE_COUNT[$name]++))
        ((API_ERRORS++))
        echo "ERROR|${http_code}|HTTP error"
    fi
}

# Check network latency
check_network() {
    local name="$1"
    local host="$2"

    local ping_result=$(ping -c 1 -W 3 "$host" 2>/dev/null)
    if [[ $? -eq 0 ]]; then
        local latency=$(echo "$ping_result" | grep -oP "time=\K[0-9.]+" | head -1)
        if [[ -z "$latency" ]]; then
            latency="<1"
        fi
        echo "OK|${latency}ms"
    else
        ((NETWORK_FAILURES[$name]++))
        echo "FAILED|0ms"
    fi
}

# Get system resources
get_system_resources() {
    local load=$(cat /proc/loadavg | awk '{print $1","$2","$3}')
    local mem_info=$(free -m | grep Mem)
    local mem_total=$(echo "$mem_info" | awk '{print $2}')
    local mem_used=$(echo "$mem_info" | awk '{print $3}')
    local mem_percent=$(awk "BEGIN {printf \"%.1f\", (${mem_used}/${mem_total})*100}")

    local disk_percent=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')

    echo "load=${load}|mem_used=${mem_used}MB|mem_total=${mem_total}MB|mem_percent=${mem_percent}%|disk=${disk_percent}%"
}

# Get Pi display status
get_pi_status() {
    # Try to reach Pi via HTTP heartbeat
    local pi_response=$(curl -s --connect-timeout 5 --max-time 10 "http://localhost:${ADMIN_PORT}/api/displays" 2>/dev/null)

    if [[ -n "$pi_response" ]]; then
        # Parse JSON using jq if available, otherwise grep
        if command -v jq &> /dev/null; then
            local display_count=$(echo "$pi_response" | jq '.displays | length' 2>/dev/null || echo "0")
            local online_count=$(echo "$pi_response" | jq '[.displays[] | select(.status == "online")] | length' 2>/dev/null || echo "0")

            if [[ "$display_count" -gt 0 ]]; then
                # Get details of first display
                local display_info=$(echo "$pi_response" | jq -r '.displays[0] | "\(.hostname)|\(.status)|\(.currentView)|\(.systemInfo.cpuTemp // "N/A")|\(.systemInfo.memoryUsage // "N/A")|\(.systemInfo.wifiQuality // "N/A")"' 2>/dev/null)
                echo "displays=${display_count}|online=${online_count}|${display_info}"
            else
                echo "displays=0|online=0|none|offline|none|N/A|N/A|N/A"
            fi
        else
            # Fallback without jq
            if echo "$pi_response" | grep -q '"status":"online"'; then
                echo "displays=1|online=1|pi-display|online|unknown|N/A|N/A|N/A"
            else
                echo "displays=1|online=0|pi-display|offline|unknown|N/A|N/A|N/A"
            fi
        fi
    else
        ((PI_OFFLINE_COUNT++))
        echo "displays=0|online=0|none|error|none|N/A|N/A|N/A"
    fi
}

# Get Challonge rate limiter status
get_rate_limit_status() {
    local response=$(curl -s --connect-timeout 5 --max-time 10 "http://localhost:${ADMIN_PORT}/api/rate-limit/status" 2>/dev/null)

    if [[ -n "$response" ]] && command -v jq &> /dev/null; then
        local mode=$(echo "$response" | jq -r '.currentMode // "UNKNOWN"' 2>/dev/null)
        local rate=$(echo "$response" | jq -r '.effectiveRate // 0' 2>/dev/null)
        local dev_mode=$(echo "$response" | jq -r '.devModeActive // false' 2>/dev/null)
        local polling=$(echo "$response" | jq -r '.matchPolling.active // false' 2>/dev/null)
        echo "mode=${mode}|rate=${rate}/min|devMode=${dev_mode}|polling=${polling}"
    else
        echo "mode=UNKNOWN|rate=0/min|devMode=false|polling=false"
    fi
}

# Get WebSocket connection status
get_websocket_status() {
    local response=$(curl -s --connect-timeout 5 --max-time 10 "http://localhost:${ADMIN_PORT}/api/websocket/status" 2>/dev/null)

    if [[ -n "$response" ]] && command -v jq &> /dev/null; then
        local display_count=$(echo "$response" | jq -r '.displayCount // 0' 2>/dev/null)
        local total=$(echo "$response" | jq -r '.totalConnections // 0' 2>/dev/null)
        echo "displays=${display_count}|total=${total}"
    else
        echo "displays=0|total=0"
    fi
}

# Get recent error logs
get_recent_errors() {
    local service="$1"
    local errors=$(journalctl -u "$service" -n 100 --no-pager --since "5 minutes ago" 2>/dev/null | grep -iE "(error|fail|exception|crash|reject)" | tail -5)

    if [[ -n "$errors" ]]; then
        echo "$errors"
    else
        echo "No recent errors"
    fi
}

# Get tournament info if active
get_tournament_info() {
    local response=$(curl -s --connect-timeout 5 --max-time 10 "http://localhost:${ADMIN_PORT}/api/status" 2>/dev/null)

    if [[ -n "$response" ]] && command -v jq &> /dev/null; then
        local name=$(echo "$response" | jq -r '.matchStatus.tournament.name // "None"' 2>/dev/null)
        local state=$(echo "$response" | jq -r '.matchStatus.tournament.state // "unknown"' 2>/dev/null)
        echo "name=${name}|state=${state}"
    else
        echo "name=Unknown|state=unknown"
    fi
}

# Collect a single sample
collect_sample() {
    local sample_num="$1"
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")

    log_section "SAMPLE #${sample_num} - ${timestamp}"

    # Services
    log "INFO" "--- SERVICE STATUS ---"
    for service in "${SERVICES[@]}"; do
        local result=$(check_service "$service")
        local status=$(echo "$result" | cut -d'|' -f1)
        if [[ "$status" == "DOWN" ]]; then
            log "ERROR" "SERVICE: ${service} = ${result}"
            ((ERRORS_DETECTED++))
        else
            log "INFO" "SERVICE: ${service} = ${result}"
        fi
    done

    # APIs
    log "INFO" "--- API STATUS ---"
    for endpoint in "${!API_ENDPOINTS[@]}"; do
        local result=$(check_api "$endpoint" "${API_ENDPOINTS[$endpoint]}")
        local status=$(echo "$result" | cut -d'|' -f1)
        if [[ "$status" == "ERROR" ]]; then
            log "ERROR" "API: ${endpoint} = ${result}"
            ((ERRORS_DETECTED++))
        elif [[ "$status" == "SLOW" ]]; then
            log "WARN" "API: ${endpoint} = ${result}"
            ((WARNINGS_DETECTED++))
        else
            log "INFO" "API: ${endpoint} = ${result}"
        fi
    done

    # Network
    log "INFO" "--- NETWORK LATENCY ---"
    for target in "${!NETWORK_TARGETS[@]}"; do
        local result=$(check_network "$target" "${NETWORK_TARGETS[$target]}")
        local status=$(echo "$result" | cut -d'|' -f1)
        if [[ "$status" == "FAILED" ]]; then
            log "WARN" "NETWORK: ${target} = ${result}"
            ((WARNINGS_DETECTED++))
        else
            log "INFO" "NETWORK: ${target} = ${result}"
        fi
    done

    # System resources
    log "INFO" "--- SYSTEM RESOURCES ---"
    local sys_resources=$(get_system_resources)
    log "INFO" "SYSTEM: ${sys_resources}"

    # Check for high memory/load
    local load_1m=$(echo "$sys_resources" | grep -oP 'load=\K[0-9.]+' | head -1)
    local mem_percent=$(echo "$sys_resources" | grep -oP 'mem_percent=\K[0-9.]+')

    if (( $(echo "$load_1m > $HIGH_LOAD_THRESHOLD" | bc -l 2>/dev/null || echo 0) )); then
        log "WARN" "HIGH LOAD: ${load_1m} (threshold: ${HIGH_LOAD_THRESHOLD})"
        ((WARNINGS_DETECTED++))
        ((HIGH_LOAD_COUNT++))
    fi

    if (( $(echo "$mem_percent > $HIGH_MEM_THRESHOLD" | bc -l 2>/dev/null || echo 0) )); then
        log "WARN" "HIGH MEMORY: ${mem_percent}% (threshold: ${HIGH_MEM_THRESHOLD}%)"
        ((WARNINGS_DETECTED++))
        ((HIGH_MEM_COUNT++))
    fi

    # Pi display status
    log "INFO" "--- PI DISPLAY STATUS ---"
    local pi_status=$(get_pi_status)
    local online=$(echo "$pi_status" | grep -oP 'online=\K[0-9]+')
    if [[ "$online" == "0" ]]; then
        log "WARN" "PI DISPLAY: ${pi_status}"
        ((WARNINGS_DETECTED++))
    else
        log "INFO" "PI DISPLAY: ${pi_status}"
    fi

    # Rate limiter status
    log "INFO" "--- RATE LIMITER STATUS ---"
    local rate_status=$(get_rate_limit_status)
    log "INFO" "RATE LIMITER: ${rate_status}"

    # WebSocket status
    log "INFO" "--- WEBSOCKET STATUS ---"
    local ws_status=$(get_websocket_status)
    log "INFO" "WEBSOCKET: ${ws_status}"

    # Tournament info
    log "INFO" "--- TOURNAMENT INFO ---"
    local tournament_info=$(get_tournament_info)
    log "INFO" "TOURNAMENT: ${tournament_info}"

    # Recent errors (check every 5 samples)
    if (( sample_num % 5 == 0 )); then
        log "INFO" "--- RECENT ERROR LOGS ---"
        for service in "${SERVICES[@]}"; do
            local errors=$(get_recent_errors "$service")
            if [[ "$errors" != "No recent errors" ]]; then
                log "WARN" "ERRORS IN ${service}:"
                echo "$errors" | while read -r line; do
                    log "WARN" "  ${line}"
                done
            fi
        done
    fi
}

# Write initial header
write_header() {
    cat >> "$LOG_FILE" << EOF
================================================================================
TOURNAMENT CONTROL CENTER - COMPREHENSIVE MONITORING LOG
================================================================================
Started: $(date +"%Y-%m-%d %H:%M:%S %Z")
Hostname: $(hostname)
Sample Interval: ${SAMPLE_INTERVAL} seconds
Log File: ${LOG_FILE}

================================================================================
MONITORED COMPONENTS
================================================================================
Services:
$(for s in "${SERVICES[@]}"; do echo "  - ${s}"; done)

API Endpoints:
$(for e in "${!API_ENDPOINTS[@]}"; do echo "  - ${e}: ${API_ENDPOINTS[$e]}"; done)

Network Targets:
$(for t in "${!NETWORK_TARGETS[@]}"; do echo "  - ${t}: ${NETWORK_TARGETS[$t]}"; done)

================================================================================
DATA COLLECTION STARTED
================================================================================
EOF
}

# Write final summary
write_final_summary() {
    local end_time=$(date +"%Y-%m-%d %H:%M:%S")
    local duration=$(($(date +%s) - $(date -d "${START_TIME//_/ }" +%s 2>/dev/null || date +%s)))
    local hours=$((duration / 3600))
    local minutes=$(((duration % 3600) / 60))
    local seconds=$((duration % 60))

    cat >> "$LOG_FILE" << EOF

================================================================================
MONITORING SESSION SUMMARY
================================================================================
End Time: ${end_time}
Duration: ${hours}h ${minutes}m ${seconds}s
Total Samples: ${SAMPLE_COUNT}

================================================================================
ISSUE SUMMARY
================================================================================
Total Errors Detected: ${ERRORS_DETECTED}
Total Warnings Detected: ${WARNINGS_DETECTED}
API Errors: ${API_ERRORS}
Slow API Responses (>${SLOW_API_THRESHOLD}ms): ${SLOW_API_COUNT}
High Load Events (>${HIGH_LOAD_THRESHOLD}): ${HIGH_LOAD_COUNT}
High Memory Events (>${HIGH_MEM_THRESHOLD}%): ${HIGH_MEM_COUNT}
Pi Offline Events: ${PI_OFFLINE_COUNT}

================================================================================
SERVICE DOWNTIME (samples down)
================================================================================
EOF

    for service in "${SERVICES[@]}"; do
        local downtime=${SERVICE_DOWNTIME[$service]:-0}
        local percent=0
        if [[ $SAMPLE_COUNT -gt 0 ]]; then
            percent=$(awk "BEGIN {printf \"%.1f\", (${downtime}/${SAMPLE_COUNT})*100}")
        fi
        echo "  ${service}: ${downtime}/${SAMPLE_COUNT} samples (${percent}% downtime)" >> "$LOG_FILE"
    done

    cat >> "$LOG_FILE" << EOF

================================================================================
API FAILURE COUNT
================================================================================
EOF

    for endpoint in "${!API_ENDPOINTS[@]}"; do
        local failures=${API_FAILURE_COUNT[$endpoint]:-0}
        local percent=0
        if [[ $SAMPLE_COUNT -gt 0 ]]; then
            percent=$(awk "BEGIN {printf \"%.1f\", (${failures}/${SAMPLE_COUNT})*100}")
        fi
        echo "  ${endpoint}: ${failures}/${SAMPLE_COUNT} failures (${percent}%)" >> "$LOG_FILE"
    done

    cat >> "$LOG_FILE" << EOF

================================================================================
NETWORK FAILURE COUNT
================================================================================
EOF

    for target in "${!NETWORK_TARGETS[@]}"; do
        local failures=${NETWORK_FAILURES[$target]:-0}
        local percent=0
        if [[ $SAMPLE_COUNT -gt 0 ]]; then
            percent=$(awk "BEGIN {printf \"%.1f\", (${failures}/${SAMPLE_COUNT})*100}")
        fi
        echo "  ${target}: ${failures}/${SAMPLE_COUNT} failures (${percent}%)" >> "$LOG_FILE"
    done

    cat >> "$LOG_FILE" << EOF

================================================================================
RECENT SERVICE LOGS (last 100 lines each)
================================================================================
EOF

    # Capture recent logs from all services
    for service in "${SERVICES[@]}"; do
        echo "" >> "$LOG_FILE"
        echo "--- ${service} ---" >> "$LOG_FILE"
        journalctl -u "$service" -n 100 --no-pager 2>/dev/null >> "$LOG_FILE" || echo "No logs available" >> "$LOG_FILE"
    done

    cat >> "$LOG_FILE" << EOF

================================================================================
RECENT ERROR LOGS (filtered)
================================================================================
EOF

    # Extract just error lines
    for service in "${SERVICES[@]}"; do
        local errors=$(journalctl -u "$service" -n 500 --no-pager 2>/dev/null | grep -iE "(error|fail|exception|crash|reject|timeout|refused)" | tail -20)
        if [[ -n "$errors" ]]; then
            echo "" >> "$LOG_FILE"
            echo "--- ${service} ERRORS ---" >> "$LOG_FILE"
            echo "$errors" >> "$LOG_FILE"
        fi
    done

    cat >> "$LOG_FILE" << EOF

================================================================================
RECOMMENDATIONS FOR CLAUDE CODE ANALYSIS
================================================================================
Please analyze this log file for:

1. STABILITY ISSUES
   - Services that went down during the tournament
   - API endpoints that failed or had slow response times
   - Network connectivity problems

2. PERFORMANCE CONCERNS
   - High memory usage patterns (>${HIGH_MEM_THRESHOLD}%)
   - CPU load spikes (>${HIGH_LOAD_THRESHOLD})
   - Slow API response times (>${SLOW_API_THRESHOLD}ms)

3. PI DISPLAY HEALTH
   - Offline events
   - High CPU temperature (>${HIGH_TEMP_THRESHOLD}C)
   - WiFi quality issues

4. RATE LIMITING
   - Mode changes during tournament
   - Dev mode usage
   - Polling status changes

5. SPECIFIC FIXES NEEDED
   - Based on error patterns, suggest code fixes
   - Identify services that need optimization
   - Recommend configuration changes

6. ACTION ITEMS
   - List specific code changes to implement
   - Prioritize by impact on tournament stability

================================================================================
END OF MONITORING LOG
================================================================================
EOF
}

# Main loop
main() {
    init_counters
    write_header

    echo -e "${GREEN}===============================================${NC}"
    echo -e "${GREEN}  TOURNAMENT MONITORING STARTED${NC}"
    echo -e "${GREEN}===============================================${NC}"
    echo ""
    echo -e "Log file: ${CYAN}${LOG_FILE}${NC}"
    echo -e "Sample interval: ${YELLOW}${SAMPLE_INTERVAL}s${NC}"
    echo ""
    echo -e "Press ${RED}Ctrl+C${NC} to stop monitoring and generate summary"
    echo ""

    while true; do
        ((SAMPLE_COUNT++))

        # Visual progress
        local timestamp=$(date +"%H:%M:%S")
        echo -ne "\r[${timestamp}] Sample #${SAMPLE_COUNT} | Errors: ${ERRORS_DETECTED} | Warnings: ${WARNINGS_DETECTED}    "

        # Collect data
        collect_sample "$SAMPLE_COUNT"

        # Wait for next sample
        sleep "$SAMPLE_INTERVAL"
    done
}

# Run main function
main
