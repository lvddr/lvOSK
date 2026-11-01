#!/usr/bin/env bash
set -e
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/lvosk@local"
mkdir -p "$DEST"
cp -r "$SRC_DIR"/* "$DEST"/
echo "Installed to $DEST"
echo "Enable with: gnome-extensions enable lvosk@local"
echo "Test in nested session: dbus-run-session -- gnome-shell --wayland --headless"