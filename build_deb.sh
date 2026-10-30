#!/usr/bin/env bash
# ==============================================================================
# HR FLOW — Native Debian Installer Generator (.deb)
# Builds a real Linux installation package: dist/hrflow_1.0.0_amd64.deb
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
BUILD_DIR="$DIR/dist/debian_build"
DIST_DIR="$DIR/dist"

echo "============================================================"
echo "  Building HR Flow Native Linux Installer (.deb)"
echo "============================================================"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/DEBIAN"
mkdir -p "$BUILD_DIR/opt/hrflow"
mkdir -p "$BUILD_DIR/usr/bin"
mkdir -p "$BUILD_DIR/usr/share/applications"
mkdir -p "$BUILD_DIR/usr/share/icons/hicolor/512x512/apps"

# 1. Control File
cat << 'EOF' > "$BUILD_DIR/DEBIAN/control"
Package: hrflow
Version: 1.0.0
Section: office
Priority: optional
Architecture: amd64
Maintainer: HR Flow Core Team <support@hrflow.internal>
Description: Autonomous HR Service Desk & Workforce Operations Desktop Application
 HR Flow provides autonomous email intake, case management, and workforce operations.
EOF

# 2. Copy App Files to /opt/hrflow
echo "📦 Copying application files..."
cp "$DIR/desktop_app.py" "$BUILD_DIR/opt/hrflow/"
cp "$DIR/requirements.txt" "$BUILD_DIR/opt/hrflow/"
cp -r "$DIR/backend" "$BUILD_DIR/opt/hrflow/"
cp -r "$DIR/frontend" "$BUILD_DIR/opt/hrflow/"
cp -r "$DIR/data" "$BUILD_DIR/opt/hrflow/"
cp -r "$DIR/WorkFlow" "$BUILD_DIR/opt/hrflow/" 2>/dev/null || true

# 3. Create Desktop Launcher Entry
cat << 'EOF' > "$BUILD_DIR/usr/share/applications/hrflow.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=HR Flow
Comment=Autonomous HR Service Desk & Workforce Operations
Exec=/usr/bin/hrflow
Icon=hrflow
Terminal=false
Categories=Office;Development;Utility;
StartupNotify=true
StartupWMClass=hrflow
EOF

# 4. Icon
cp "$DIR/frontend/img/nexus-logo-512.png" "$BUILD_DIR/usr/share/icons/hicolor/512x512/apps/hrflow.png"

# 5. Global CLI Binary /usr/bin/hrflow
cat << 'EOF' > "$BUILD_DIR/usr/bin/hrflow"
#!/usr/bin/env bash
cd /opt/hrflow
exec python3 /opt/hrflow/desktop_app.py "$@"
EOF
chmod +x "$BUILD_DIR/usr/bin/hrflow"

# 6. Build the .deb package
echo "🔨 Compiling .deb package..."
chmod 755 "$BUILD_DIR/DEBIAN"
chmod 644 "$BUILD_DIR/DEBIAN/control"
mkdir -p "$DIST_DIR"
dpkg-deb --build "$BUILD_DIR" "$DIST_DIR/hrflow_1.0.0_amd64.deb"
rm -rf "$BUILD_DIR"

SIZE_MB=$(du -sh "$DIST_DIR/hrflow_1.0.0_amd64.deb" | cut -f1)
echo "============================================================"
echo "🎉 Native Linux Installer successfully built:"
echo "   $DIST_DIR/hrflow_1.0.0_amd64.deb ($SIZE_MB)"
echo "============================================================"
