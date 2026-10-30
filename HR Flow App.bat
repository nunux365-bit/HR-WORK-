@echo off
REM ==============================================================================
REM HR FLOW — Native PC Desktop Application Launcher (Windows)
REM Double-click to launch HR Flow like an Adobe or Desktop PC App
REM [Zero Admin Password Required]
REM ==============================================================================

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

if exist "%SCRIPT_DIR%\HRFlow.vbs" (
    start "" wscript.exe "%SCRIPT_DIR%\HRFlow.vbs"
    exit /b 0
)

set "VENV_PY=%SCRIPT_DIR%\.venv\Scripts\pythonw.exe"
if not exist "%VENV_PY%" set "VENV_PY=%SCRIPT_DIR%\.venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
    where python >nul 2>nul
    if %ERRORLEVEL% equ 0 (set "VENV_PY=python") else (set "VENV_PY=py")
)

cd /d "%SCRIPT_DIR%"
start "" "%VENV_PY%" "%SCRIPT_DIR%\desktop_app.py"

