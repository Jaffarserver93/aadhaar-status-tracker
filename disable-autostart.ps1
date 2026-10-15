# Aadhaar Status Tracker - Disable Auto-Start on Windows Boot / Login
$startupFolder = [System.IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Startup')
$startupScriptPath = [System.IO.Path]::Combine($startupFolder, 'AadhaarStatusTracker.vbs')

if (Test-Path $startupScriptPath) {
    Remove-Item -Path $startupScriptPath -Force
    Write-Host "[✓] Windows Auto-Start has been DISABLED." -ForegroundColor Yellow
    Write-Host "    Removed $startupScriptPath" -ForegroundColor Gray
} else {
    Write-Host "[!] Auto-start was not enabled or already removed." -ForegroundColor Gray
}
