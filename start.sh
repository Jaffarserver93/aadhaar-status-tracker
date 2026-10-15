#!/usr/bin/env bash
# ==============================================================================
# Aadhaar Status Tracker - Service Startup Script
# Starts Express server, background worker, neural OCR, and cron on 0.0.0.0
# Accessible locally and across LAN (Wi-Fi / Ethernet)
# ==============================================================================

set -e

# Change to script directory
cd "$(dirname "$0")"

PORT="${PORT:-3000}"

echo "=================================================================="
echo "    AADHAAR STATUS TRACKER & VERIFICATION LEDGER"
echo "=================================================================="

# Check if Node.js is installed
if ! command -v node >/dev/null 2>&1; then
  echo "[-] Error: Node.js is not installed or not in PATH."
  echo "    Please install Node.js (v18+) to run this service."
  exit 1
fi

# Ensure logs directory exists
mkdir -p logs

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "[*] Initializing dependencies (npm install)..."
  npm install
fi

# Check if port is already in use and free it if requested
if command -v lsof >/dev/null 2>&1; then
  PID=$(lsof -ti :$PORT || true)
  if [ -n "$PID" ]; then
    echo "[!] Port $PORT is already in use by PID $PID."
    echo "[*] Stopping previous instance..."
    kill -9 $PID 2>/dev/null || true
    sleep 1
  fi
elif command -v netstat >/dev/null 2>&1; then
  # On Windows Git Bash
  PID=$(netstat -ano 2>/dev/null | grep ":$PORT " | grep "LISTENING" | awk '{print $NF}' | head -n 1 || true)
  if [ -n "$PID" ] && [ "$PID" -gt 0 ] 2>/dev/null; then
    echo "[!] Port $PORT is occupied by PID $PID. Releasing port..."
    taskkill //F //PID "$PID" 2>/dev/null || true
    sleep 1
  fi
fi

# Discover LAN IP address
LAN_IP=""
if command -v node >/dev/null 2>&1; then
  LAN_IP=$(node -e "
    const os = require('os');
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const i of ifaces[name]) {
        if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) {
          process.stdout.write(i.address);
          process.exit(0);
        }
      }
    }
  " 2>/dev/null || true)
fi

echo "[+] Starting service on 0.0.0.0:$PORT..."
echo ""
echo "    Local URL:       http://localhost:$PORT"
if [ -n "$LAN_IP" ]; then
  echo "    Phone / LAN URL: http://$LAN_IP:$PORT"
else
  echo "    Phone / LAN URL: http://<YOUR_PC_IP>:$PORT"
fi
echo "    API Console:     http://localhost:$PORT/api"
echo "=================================================================="
echo ""

# Start the Node.js server
exec node server.js
