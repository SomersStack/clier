#!/bin/bash

# Test script for daemon implementation
# This will test basic daemon functionality

set -e

echo "Testing Clier Daemon Implementation"
echo "===================================="
echo

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Build the project
echo "1. Building project..."
npm run build > /dev/null 2>&1
echo "   ✓ Build successful"
echo

# Clean up any existing daemon
echo "2. Cleaning up any existing daemon..."
./dist/bin/clier.js stop > /dev/null 2>&1 || true
sleep 1
rm -rf .clier 2>/dev/null || true
echo "   ✓ Cleanup complete"
echo

# Start the daemon
echo "3. Starting daemon..."
./dist/bin/clier.js start example-pipeline.json
echo
sleep 2

# Check status
echo "4. Checking daemon status..."
./dist/bin/clier.js status
echo

# Wait for processes to start
echo "5. Waiting for processes to initialize..."
sleep 3

# Check logs
echo "6. Checking logs..."
./dist/bin/clier.js logs echo-service -n 10
echo

# Check status again
echo "7. Checking status again..."
./dist/bin/clier.js status
echo

# Stop the daemon
echo "8. Stopping daemon..."
./dist/bin/clier.js stop
echo

# Verify daemon stopped
echo "9. Verifying daemon stopped..."
sleep 1
if ./dist/bin/clier.js status 2>&1 | grep -q "not running"; then
    echo "   ✓ Daemon stopped successfully"
else
    echo "   ✗ Daemon still running!"
    exit 1
fi
echo

echo "===================================="
echo "All tests passed! ✓"
echo "===================================="
