#!/usr/bin/env bash
# ==============================================================================
# HR FLOW — Linux User-Space Desktop Installer
# ZERO SUDO / NO ADMIN PASSWORD REQUIRED
# Installs to user's home directory (~/.local/share/applications & ~/Desktop)
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
ICON_PATH="$DIR/frontend/img/nexus-logo-512.png"
LAUNCHER_SCRIPT="$DIR/run_desktop.sh"
DESKTOP_DIR="$HOME/Desktop"
APPS_DIR="$HOME/.local/share/applications"

echo "============================================================"
echo "  HR Flow — Desktop Application Installer (Linux)"
echo "  [No Sudo / No Root Password Required]"
echo "============================================================"

# 1. Verify Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 is not installed on this system."
    echo "Please ensure Python 3 is installed."
    exit 1
fi

echo "✓ Python 3 found: $(python3 --version)"

# 2. Check Virtual Environment
if [ ! -d "$DIR/.venv" ]; then
    echo "📦 Initializing user virtual environment (.venv)..."
    python3 -m venv "$DIR/.venv"
fi

# 3. Install dependencies if requirements.txt exists
if [ -f "$DIR/requirements.txt" ]; then
    echo "📦 Checking Python dependencies..."
    "$DIR/.venv/bin/python3" -m pip install -q -r "$DIR/requirements.txt" || true
fi

# 4. Create the run_desktop.sh script
cat << 'EOF' > "$LAUNCHER_SCRIPT"
#!/usr/bin/env bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PYTHON_BIN="$DIR/.venv/bin/python3"
if [ ! -f "$PYTHON_BIN" ]; then
    PYTHON_BIN="python3"
fi
cd "$DIR"
exec "$PYTHON_BIN" "$DIR/desktop_app.py"
EOF
chmod +x "$LAUNCHER_SCRIPT"

# 5. Create Desktop Launcher Entry
mkdir -p "$APPS_DIR" 2>/dev/null || APPS_DIR="$DIR"
DESKTOP_FILE="$APPS_DIR/hrflow.desktop"

cat << EOF > "$DESKTOP_FILE"
[Desktop Entry]
Version=1.0
Type=Application
Name=HR Flow
Comment=Autonomous HR Service Desk & Workforce Operations
Exec=$LAUNCHER_SCRIPT
Icon=$ICON_PATH
Terminal=false
Categories=Office;Development;Utility;
StartupNotify=true
StartupWMClass=hrflow
EOF

chmod +x "$DESKTOP_FILE"

# 6. Copy to User's Desktop if Desktop folder exists
if [ -d "$DESKTOP_DIR" ] && [ "$DESKTOP_DIR" != "$DIR" ]; then
    cp "$DESKTOP_FILE" "$DESKTOP_DIR/HRFlow.desktop" 2>/dev/null || true
    chmod +x "$DESKTOP_DIR/HRFlow.desktop" 2>/dev/null || true
    if command -v gio &> /dev/null; then
        gio set "$DESKTOP_DIR/HRFlow.desktop" metadata::trusted true 2>/dev/null || true
    fi
    echo "✓ Desktop icon added to: $DESKTOP_DIR/HRFlow.desktop"
fi

echo "✓ Application launcher registered at: $DESKTOP_FILE"
echo ""
echo "============================================================"
echo "🎉 HR Flow Desktop installed successfully!"
echo "You can now launch HR Flow:"
echo "  1. Directly from your PC Application Menu (Search 'HR Flow')"
echo "  2. By double-clicking the 'HR Flow' icon on your Desktop"
echo "  3. Or run: ./run_desktop.sh"
echo "============================================================"
