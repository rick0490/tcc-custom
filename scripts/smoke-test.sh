#!/bin/bash
set -e

echo "Running smoke tests..."
echo ""

FAILED=0

# Test Admin Dashboard
echo -n "Admin login page: "
if curl -sf http://localhost:3000/login.html > /dev/null; then
    echo "OK"
else
    echo "FAILED"
    FAILED=1
fi

# Test Tournament Signup
echo -n "Signup home page: "
if curl -sf http://localhost:3001/ > /dev/null; then
    echo "OK"
else
    echo "FAILED"
    FAILED=1
fi

# Test Match Module API
echo -n "Match module API: "
if curl -sf http://localhost:2052/api/tournament/status > /dev/null; then
    echo "OK"
else
    echo "FAILED"
    FAILED=1
fi

# Test Bracket Module API
echo -n "Bracket module API: "
if curl -sf http://localhost:2053/api/tournament/status > /dev/null; then
    echo "OK"
else
    echo "FAILED"
    FAILED=1
fi

# Test Flyer Module API
echo -n "Flyer module API: "
if curl -sf http://localhost:2054/api/tournament/status > /dev/null; then
    echo "OK"
else
    echo "FAILED"
    FAILED=1
fi

echo ""

if [ $FAILED -eq 0 ]; then
    echo "All smoke tests passed!"
    exit 0
else
    echo "Some smoke tests failed!"
    exit 1
fi
