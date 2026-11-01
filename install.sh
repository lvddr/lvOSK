#!/usr/bin/env bash
set -e
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/win11-osk@local"
mkdir -p "$DEST"
# Copy only the runtime files needed by GNOME Shell.
for f in extension.js main.js metadata.json stylesheet.css click.wav; do
    if [ -f "$SRC_DIR/$f" ]; then
        cp "$SRC_DIR/$f" "$DEST"/
    fi
done
echo "Installed to $DEST"
echo "Enable with: gnome-extensions enable win11-osk@local"
echo "Test in nested session: dbus-run-session -- gnome-shell --wayland --headless"
