@echo off
setlocal
echo ==================================================================
echo    AADHAAR STATUS TRACKER - SERVICE STATUS CHECK
echo ==================================================================

for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r ":3000.*LISTENING"') do (
  if not "%%a"=="" (
    echo [✓] Service is ACTIVE and RUNNING!
    echo     Process PID: %%a
    echo     Port: 3000 [0.0.0.0 - LAN and Local]
    goto :check_endpoints
  )
)

echo [-] Service is NOT currently running.
echo     Run start.bat or start.sh to launch the service.
goto :end

:check_endpoints
echo.
echo [*] Service endpoints:
node -e "const os = require('os'); console.log('    Local URL:       http://localhost:3000'); const ifaces = os.networkInterfaces(); for (const name of Object.keys(ifaces)) { for (const i of ifaces[name]) { if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) { console.log('    Phone / LAN URL: http://' + i.address + ':3000 (' + name + ')'); } } }"

echo.
echo [*] Recent background service log (last 10 lines):
if exist "logs\service.log" (
  powershell -Command "Get-Content logs\service.log -Tail 10" 2>nul
) else (
  echo     (No logs\service.log created yet)
)

:end
echo ==================================================================
pause
