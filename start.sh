#!/bin/bash
set -e

# Clean up any stale X locks
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

# Start Xvfb virtual display in background
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99

# Wait for Xvfb to be ready
sleep 1

# Start Node server
echo "[Startup] Starting Express Server with DISPLAY=$DISPLAY on PORT=${PORT:-3000}..."
exec node server.js
