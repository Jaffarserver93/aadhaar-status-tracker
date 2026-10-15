@echo off
setlocal
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo ==================================================================
echo    DISABLE AADHAAR STATUS TRACKER AUTO-START
echo ==================================================================
echo.

if exist "%STARTUP_DIR%\AadhaarStatusTracker.vbs" (
  del "%STARTUP_DIR%\AadhaarStatusTracker.vbs"
  echo [✓] Auto-start file removed from Windows Startup folder.
  echo     The service will NO LONGER start automatically on PC reboot.
) else (
  echo [!] Auto-start was not enabled or already removed.
)

echo ==================================================================
pause
