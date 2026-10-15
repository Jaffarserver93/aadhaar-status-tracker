@echo off
setlocal
echo [*] Terminating Aadhaar Status Tracker instances running on port 3000...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r ":3000.*LISTENING"') do (
  if not "%%a"=="" (
    echo [x] Stopping process with PID %%a...
    taskkill /F /PID %%a >nul 2>nul
  )
)

echo [✓] Service stopped.
timeout /t 2 >nul
