#!/bin/bash

BACKUP_DIR="/root/tournament-control-center/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "Creating backups..."

# Backup analytics database
if [ -f "admin-dashboard/analytics.db" ]; then
    cp admin-dashboard/analytics.db "$BACKUP_DIR/analytics_$TIMESTAMP.db"
    echo "  analytics.db backed up"
fi

# Backup users file
if [ -f "admin-dashboard/users.json" ]; then
    cp admin-dashboard/users.json "$BACKUP_DIR/users_$TIMESTAMP.json"
    echo "  users.json backed up"
fi

# Backup system settings
if [ -f "admin-dashboard/system-settings.json" ]; then
    cp admin-dashboard/system-settings.json "$BACKUP_DIR/system-settings_$TIMESTAMP.json"
    echo "  system-settings.json backed up"
fi

# Backup auth data
if [ -f "admin-dashboard/auth-data.json" ]; then
    cp admin-dashboard/auth-data.json "$BACKUP_DIR/auth-data_$TIMESTAMP.json"
    echo "  auth-data.json backed up"
fi

# Clean up old backups (keep last 10 of each type)
echo "Cleaning up old backups..."
for pattern in analytics users system-settings auth-data; do
    ls -t "$BACKUP_DIR/${pattern}_"*.* 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
done

echo "Backup completed: $TIMESTAMP"
