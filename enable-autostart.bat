@echo off
setlocal
cd /d "%~dp0"
set "PROJECT_DIR=%~dp0"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if not exist "logs" mkdir "logs"

echo ==================================================================
echo    CONFIGURE AADHAAR STATUS TRACKER AUTO-START ON PC RESTART
echo ==================================================================
echo.
echo [*] Installing startup script to Windows Startup folder:
echo     "%STARTUP_DIR%"
echo.

(
echo ' Aadhaar Status Tracker - Windows Autostart on Boot
echo Set objShell = CreateObject^("WScript.Shell"^)
echo Set objFSO = CreateObject^("Scripting.FileSystemObject"^)
echo strDir = "%PROJECT_DIR:~0,-1%"
echo objShell.CurrentDirectory = strDir
echo If Not objFSO.FolderExists^(strDir ^& "\logs"^) Then objFSO.CreateFolder^(strDir ^& "\logs"^)
echo objShell.Run "cmd /c node server.js >> logs\service.log 2>&1", 0, False
) > "%STARTUP_DIR%\AadhaarStatusTracker.vbs"

if exist "%STARTUP_DIR%\AadhaarStatusTracker.vbs" (
  echo [✓] SUCCESS: Auto-start on PC reboot is now ENABLED!
  echo.
  echo     Whenever this PC is turned on or restarted, the Aadhaar Status
  echo     Tracker service will start silently in the background on port 3000.
  echo.
  echo     LAN devices (phone, laptop) can connect anytime to:
  echo     http://%COMPUTERNAME%:3000 or your local IP:3000
  echo.
  echo     To disable auto-start later, simply run disable-autostart.bat.
) else (
  echo [-] Failed to create startup file in %STARTUP_DIR%.
)

echo ==================================================================
pause
