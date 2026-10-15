@echo off
setlocal enabledelayedexpansion
title Aadhaar Status Tracker & Ledger

:: Change directory to script location
cd /d "%~dp0"

echo ==================================================================
echo    AADHAAR STATUS TRACKER & VERIFICATION LEDGER
echo ==================================================================

:: Verify Node.js availability
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [-] Error: Node.js was not found in PATH.
  echo     Please install Node.js (v18+) from https://nodejs.org
  pause
  exit /b 1
)

:: Ensure logs directory exists
if not exist "logs" mkdir "logs"

:: Install dependencies if node_modules is missing
if not exist "node_modules" (
  echo [*] Installing dependencies (npm install)...
  call npm install
)

:: Free port 3000 if already occupied
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r ":3000.*LISTENING"') do (
  if not "%%a"=="" (
    echo [!] Port 3000 is occupied by PID %%a. Releasing port...
    taskkill /F /PID %%a >nul 2>nul
  )
)

echo [+] Starting services on 0.0.0.0:3000...
echo.

node server.js

pause
