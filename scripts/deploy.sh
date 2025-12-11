#!/bin/bash
set -e

echo "=== Tournament Control Center Deployment ==="
echo "Started at: $(date)"

# Navigate to project root
cd /root/tournament-control-center

# Backup databases first
./scripts/backup-db.sh

# Pull latest code
echo "Pulling latest changes..."
git pull origin main

# Install dependencies for admin-dashboard
echo "Installing admin-dashboard dependencies..."
cd /root/tournament-control-center/admin-dashboard
npm ci --production

# Install dependencies for control-center-signup
echo "Installing control-center-signup dependencies..."
cd /root/tournament-control-center/control-center-signup
npm ci --production

# Return to project root
cd /root/tournament-control-center

# Restart services
echo "Restarting services..."
sudo systemctl restart control-center-admin
sudo systemctl restart control-center-signup

# Wait for services to start
echo "Waiting for services to start..."
sleep 10

# Run smoke tests
echo "Running smoke tests..."
./scripts/smoke-test.sh

echo ""
echo "=== Deployment complete at: $(date) ==="
