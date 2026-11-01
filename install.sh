#!/usr/bin/env bash
set -e
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/win11-osk@local"
mkdir -p "$DEST"
cp -r "$SRC_DIR"/* "$DEST"/
echo "Installed to $DEST"
echo "Enable with: gnome-extensions enable win11-osk@local"
echo "Test in nested session: dbus-run-session -- gnome-shell --wayland --headless"