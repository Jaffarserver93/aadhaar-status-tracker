' ==============================================================================
' Aadhaar Status Tracker - Background Silent Service Launcher
' Launches node server.js with hidden console window and logs to logs\service.log
' ==============================================================================

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Set working directory to project folder
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.CurrentDirectory = strScriptDir

' Ensure logs directory exists
If Not objFSO.FolderExists(strScriptDir & "\logs") Then
  objFSO.CreateFolder(strScriptDir & "\logs")
End If

' Run node server.js hidden (window style 0), redirect output to logs\service.log
objShell.Run "cmd /c node server.js >> logs\service.log 2>&1", 0, False
