' ==============================================================================
' HR FLOW — Silent Windows Desktop Launcher (Zero Black Command Window)
' ==============================================================================
Dim WshShell, fso, strPath, pyExe

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strPath

' Check if virtual environment pythonw exists, else fallback to system pythonw
If fso.FileExists(strPath & "\.venv\Scripts\pythonw.exe") Then
    pyExe = """" & strPath & "\.venv\Scripts\pythonw.exe"""
ElseIf fso.FileExists(strPath & "\.venv\Scripts\python.exe") Then
    pyExe = """" & strPath & "\.venv\Scripts\python.exe"""
Else
    pyExe = "pythonw.exe"
End If

' Launch desktop_app.py completely hidden (0 = hide window, False = don't wait)
WshShell.Run pyExe & " """ & strPath & "\desktop_app.py""", 0, False

