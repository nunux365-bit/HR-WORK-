@echo off
REM ==============================================================================
REM HR FLOW — Windows User-Space Desktop Installer
REM ZERO ADMIN PRIVILEGES REQUIRED — Runs entirely in User Space
REM Creates Desktop & Start Menu Shortcuts pointing to HR Flow Desktop
REM ==============================================================================

setlocal enabledelayedexpansion
title HR Flow Installer

echo ============================================================
echo   HR Flow - Windows Desktop Application Installer
echo   [No Administrator Password Required]
echo ============================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "START_MENU_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
set "ICON_PATH=%SCRIPT_DIR%\frontend\img\hrflow.ico"
set "LAUNCHER_VBS=%SCRIPT_DIR%\HRFlow.vbs"
set "LAUNCHER_BAT=%SCRIPT_DIR%\run_desktop.bat"

REM 1. Verify Python
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    where py >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [!] Python was not found in your PATH.
        echo Please download and install Python from https://www.python.org/
        pause
        exit /b 1
    ) else (
        set "PY_CMD=py"
    )
) else (
    set "PY_CMD=python"
)

echo [*] Python detected: %PY_CMD%

REM 2. Setup Virtual Environment
if not exist "%SCRIPT_DIR%\.venv" (
    echo [*] Creating virtual environment in .venv...
    %PY_CMD% -m venv "%SCRIPT_DIR%\.venv"
)

set "VENV_PY=%SCRIPT_DIR%\.venv\Scripts\python.exe"
set "VENV_PYW=%SCRIPT_DIR%\.venv\Scripts\pythonw.exe"

if not exist "%VENV_PY%" (
    set "VENV_PY=%PY_CMD%"
    set "VENV_PYW=%PY_CMD%"
)

REM 3. Install requirements
if exist "%SCRIPT_DIR%\requirements.txt" (
    echo [*] Verifying dependencies...
    "%VENV_PY%" -m pip install -q -r "%SCRIPT_DIR%\requirements.txt"
)

REM 4. Create run_desktop.bat
(
    echo @echo off
    echo cd /d "%SCRIPT_DIR%"
    echo start "" "%VENV_PY%" "%SCRIPT_DIR%\desktop_app.py"
) > "%LAUNCHER_BAT%"

REM 5. Create Desktop & Start Menu Shortcuts via PowerShell
echo [*] Creating Desktop and Start Menu Shortcuts...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ws = New-Object -ComObject WScript.Shell; " ^
    "$s = $ws.CreateShortcut('%DESKTOP_DIR%\HR Flow.lnk'); " ^
    "$s.TargetPath = 'wscript.exe'; " ^
    "$s.Arguments = '\"%LAUNCHER_VBS%\"'; " ^
    "$s.WorkingDirectory = '%SCRIPT_DIR%'; " ^
    "$s.IconLocation = '%ICON_PATH%,0'; " ^
    "$s.Description = 'HR Flow - Autonomous Workforce Operations'; " ^
    "$s.Save(); " ^
    "$s2 = $ws.CreateShortcut('%START_MENU_DIR%\HR Flow.lnk'); " ^
    "$s2.TargetPath = 'wscript.exe'; " ^
    "$s2.Arguments = '\"%LAUNCHER_VBS%\"'; " ^
    "$s2.WorkingDirectory = '%SCRIPT_DIR%'; " ^
    "$s2.IconLocation = '%ICON_PATH%,0'; " ^
    "$s2.Description = 'HR Flow - Autonomous Workforce Operations'; " ^
    "$s2.Save();"

echo.
echo ============================================================
echo   [OK] HR Flow Desktop installed successfully!
echo.
echo   You can now launch HR Flow:
echo     1. Double-click the 'HR Flow' icon on your Desktop
echo     2. Launch it from your Windows Start Menu
echo     3. Or double-click: run_desktop.bat
echo ============================================================
echo.
pause

