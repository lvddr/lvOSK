#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/main.js"

python3 - "$DIR" "$OUT" <<'PY'
import sys, re, os

def minify(text):
    out = []
    i = 0
    n = len(text)
    in_str = None
    in_line = False
    in_block = False
    while i < n:
        c = text[i]
        if in_line:
            if c == '\n':
                in_line = False
                while out and out[-1] == ' ':
                    out.pop()
                out.append('\n')
            i += 1
            continue
        if in_block:
            if c == '*' and i + 1 < n and text[i + 1] == '/':
                in_block = False
                i += 2
                continue
            if c == '\n':
                while out and out[-1] == ' ':
                    out.pop()
                out.append('\n')
            i += 1
            continue
        if in_str:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == in_str:
                in_str = None
            i += 1
            continue
        if c == '"' or c == "'" or c == '`':
            in_str = c
            out.append(c)
            i += 1
            continue
        if c == '/' and i + 1 < n:
            if text[i + 1] == '/':
                in_line = True
                i += 2
                continue
            if text[i + 1] == '*':
                in_block = True
                i += 2
                continue
        if c == ' ' or c == '\t':
            if out and out[-1] not in (' ', '\n', '\t'):
                out.append(' ')
            i += 1
            continue
        if c == '\n':
            while out and out[-1] == ' ':
                out.pop()
            out.append('\n')
            i += 1
            continue
        out.append(c)
        i += 1
    lines = [ln.strip() for ln in ''.join(out).split('\n')]
    lines = [ln for ln in lines if ln]
    return '\n'.join(lines) + '\n'

src, outp = sys.argv[1], sys.argv[2]
files = ['keyWidget.js', 'layouts.js', 'inputController.js', 'keyboardUI.js', 'impl.js']
header = "import GObject from 'gi://GObject';\nimport St from 'gi://St';\nimport Clutter from 'gi://Clutter';\nimport GLib from 'gi://GLib';\nimport Gio from 'gi://Gio';\nimport * as Main from 'resource:///org/gnome/shell/ui/main.js';\nimport * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';\nimport * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';\nimport * as KeyboardModule from 'resource:///org/gnome/shell/ui/keyboard.js';\n\n"
parts = [header]
for f in files:
    text = open(os.path.join(src, 'src', f)).read()
    lines = []
    for line in text.splitlines():
        if re.match(r'^\s*import\s', line):
            continue
        line = re.sub(r'^\s*export\s+', '', line)
        lines.append(line)
    body = '\n'.join(lines)
    parts.append("// ===== " + f + " =====\n" + minify(body))
open(outp, 'w').write(''.join(parts) + '\nexport { enable, disable };\n')
print("built " + outp)
PY
