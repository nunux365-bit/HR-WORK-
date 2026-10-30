@echo off
REM ==============================================================================
REM HR FLOW — Windows 1-Click Desktop Launcher
REM Launches HR Flow backend and desktop window without opening a browser tab
REM ==============================================================================

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "VENV_PY=%SCRIPT_DIR%\.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    where python >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        set "VENV_PY=python"
    ) else (
        set "VENV_PY=py"
    )
)

cd /d "%SCRIPT_DIR%"
start "" "%VENV_PY%" "%SCRIPT_DIR%\desktop_app.py"

