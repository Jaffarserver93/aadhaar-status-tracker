# Aadhaar Status Tracker - Enable Auto-Start on Windows Boot / Login
$projectDir = $PSScriptRoot
$startupFolder = [System.IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Startup')
$startupScriptPath = [System.IO.Path]::Combine($startupFolder, 'AadhaarStatusTracker.vbs')

if (!(Test-Path "$projectDir\logs")) {
    New-Item -ItemType Directory -Path "$projectDir\logs" -Force | Out-Null
}

$vbsLines = @(
    "' Aadhaar Status Tracker Auto-Start on Windows Boot",
    "Set objShell = CreateObject(""WScript.Shell"")",
    "Set objFSO = CreateObject(""Scripting.FileSystemObject"")",
    "strDir = ""$projectDir""",
    "objShell.CurrentDirectory = strDir",
    "If Not objFSO.FolderExists(strDir & ""\logs"") Then objFSO.CreateFolder(strDir & ""\logs"")",
    "objShell.Run ""cmd /c node server.js >> logs\service.log 2>&1"", 0, False"
)

Set-Content -Path $startupScriptPath -Value $vbsLines -Encoding ASCII

if (Test-Path $startupScriptPath) {
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host "[OK] Windows Auto-Start is now ENABLED!" -ForegroundColor Green
    Write-Host "    Script installed to: $startupScriptPath" -ForegroundColor Gray
    Write-Host "    On every PC restart or login, the tracker will start silently" -ForegroundColor Gray
    Write-Host "    and serve requests over Localhost and LAN on port 3000." -ForegroundColor Gray
    Write-Host "==================================================================" -ForegroundColor Cyan
} else {
    Write-Host "[-] Failed to install startup script." -ForegroundColor Red
}
