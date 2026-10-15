#!/usr/bin/env bash
PORT="${PORT:-3000}"
echo "[*] Stopping Aadhaar Status Tracker on port $PORT..."

if command -v lsof >/dev/null 2>&1; then
  PID=$(lsof -ti :$PORT || true)
  if [ -n "$PID" ]; then
    kill -9 $PID 2>/dev/null || true
    echo "[✓] Stopped PID $PID."
  else
    echo "[-] No process found listening on port $PORT."
  fi
else
  # Windows git bash
  PID=$(netstat -ano 2>/dev/null | grep ":$PORT " | grep "LISTENING" | awk '{print $NF}' | head -n 1 || true)
  if [ -n "$PID" ] && [ "$PID" -gt 0 ] 2>/dev/null; then
    taskkill //F //PID "$PID" 2>/dev/null || true
    echo "[✓] Stopped PID $PID."
  else
    echo "[-] No process found listening on port $PORT."
  fi
fi
