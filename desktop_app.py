#!/usr/bin/env python3
"""
HR FLOW — Universal Cross-Platform PC Desktop Launcher (desktop_app.py)
Works on Windows, Linux, and macOS without requiring Administrator / Sudo passwords.

Responsibilities:
  1. Automatically launches the Flask + SQLite backend in the background if not active.
  2. Opens HR Flow in a clean, chromeless standalone Desktop Window.
  3. Cleanly shuts down background processes when the application window is closed.
"""

import os
import sys
import time
import subprocess
import urllib.request
import urllib.error
import webbrowser
import shutil

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_SERVER_SCRIPT = os.path.join(PROJECT_ROOT, "backend", "server.py")
APP_URL = "http://127.0.0.1:5000/login.html"
HEALTH_URL = "http://127.0.0.1:5000/api/health"


def is_backend_running(timeout: float = 1.0) -> bool:
    """Checks if the HR Flow backend server is actively responding on port 5000."""
    try:
        req = urllib.request.Request(HEALTH_URL, headers={"User-Agent": "HRFlow-Desktop-Launcher"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status in (200, 302, 404)
    except Exception:
        return False


def start_backend_daemon():
    """Starts the Flask server as a background subprocess using current Python environment."""
    print("⚡ Starting HR Flow backend engine...")
    python_bin = sys.executable

    # In production/deployment, avoid opening separate black command windows on Windows
    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0x08000000

    proc = subprocess.Popen(
        [python_bin, BACKEND_SERVER_SCRIPT],
        cwd=PROJECT_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags
    )

    # Wait up to 10 seconds for backend to become ready
    for i in range(20):
        time.sleep(0.5)
        if is_backend_running(timeout=1.0):
            print("✓ Backend engine is online.")
            return proc

    print("⚠️ Backend took longer than expected to initialize. Proceeding to launch UI...")
    return proc


def find_chromeless_browser():
    """Finds available browsers supporting standalone app mode (--app=...)."""
    if sys.platform == "win32":
        candidates = [
            os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"),
            os.path.expandvars(r"%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe"),
        ]
        for c in candidates:
            if os.path.isfile(c):
                return c

    elif sys.platform.startswith("linux"):
        for binary in [
            "google-chrome",
            "google-chrome-stable",
            "chromium-browser",
            "chromium",
            "microsoft-edge",
            "microsoft-edge-stable",
            "brave-browser",
        ]:
            path = shutil.which(binary)
            if path:
                return path

    elif sys.platform == "darwin":
        mac_candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]
        for c in mac_candidates:
            if os.path.isfile(c):
                return c

    return None


def launch_desktop_ui(backend_proc=None):
    """Launches the desktop application interface."""
    # Priority 1: pywebview (Native OS Webview Window)
    try:
        import webview
        print("🚀 Opening native desktop window (pywebview)...")
        icon_path = os.path.join(PROJECT_ROOT, "frontend", "img", "nexus-logo-512.png")
        window = webview.create_window(
            title="HR Flow — Autonomous Workforce Operations",
            url=APP_URL,
            width=1340,
            height=860,
            min_size=(1000, 650),
            background_color="#0f172a"
        )
        webview.start()
        return
    except ImportError:
        pass

    # Priority 2: Chromeless App Mode (Zero-installation native window using preinstalled Edge/Chrome)
    browser_bin = find_chromeless_browser()
    if browser_bin:
        print(f"🚀 Opening standalone application window via {os.path.basename(browser_bin)}...")
        user_profile_dir = os.path.join(os.path.expanduser("~"), ".hrflow_app_profile")
        os.makedirs(user_profile_dir, exist_ok=True)

        args = [
            browser_bin,
            f"--app={APP_URL}",
            "--window-size=1340,860",
            f"--user-data-dir={user_profile_dir}",
            "--disable-extensions",
            "--no-first-run",
        ]
        browser_proc = subprocess.Popen(args)
        browser_proc.wait()
        return

    # Priority 3: Firefox dedicated window
    ff_bin = shutil.which("firefox")
    if ff_bin:
        print("🚀 Opening dedicated application window via Firefox...")
        browser_proc = subprocess.Popen([ff_bin, "--new-window", APP_URL])
        browser_proc.wait()
        return

    # Priority 4: Fallback to System Default Browser
    print("🚀 Opening in default browser...")
    webbrowser.open(APP_URL)


def main():
    print("=" * 60)
    print("  HR FLOW — WORKFORCE OPERATIONS DESKTOP")
    print("=" * 60)

    server_proc = None
    if not is_backend_running(timeout=1.0):
        server_proc = start_backend_daemon()
    else:
        print("✓ Backend engine already running on port 5000.")

    try:
        launch_desktop_ui(server_proc)
    except KeyboardInterrupt:
        print("\nExiting HR Flow Desktop...")
    finally:
        if server_proc:
            print("Stopping background backend engine...")
            server_proc.terminate()
            try:
                server_proc.wait(timeout=3)
            except Exception:
                server_proc.kill()
        print("HR Flow Desktop closed.")


if __name__ == "__main__":
    main()
