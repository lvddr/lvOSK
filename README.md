# lvOSK

A Windows 11-style on-screen keyboard for GNOME Shell, built because the default GNOME OSK is terrible.

## Why not the default GNOME OSK?

The built-in GNOME on-screen keyboard is, frankly, bad:

- **Ugly and outdated** — it looks like it was designed in 2008 and never touched again.
- **Terrible layout** — no proper key sizing, no useful alternates, no phone-style numpad.
- **No feedback** — no key press animations, no callouts, no click sound worth listening to.
- **Bare-bones settings** — basically nothing to configure.
- **Inconsistent behavior** — shows up at random times, doesn't follow text focus reliably, especially in Chrome/Electron apps.
- **No touch-friendly affordances** — tiny hit targets, no drag handle, no dock/float toggle.

lvOSK replaces all of that with a modern, touch-friendly, Windows 11-inspired keyboard that actually feels good to use.

## Features

- Windows 11-style 4-row layout with proper key sizing and gaps
- Bigger keys, bigger bottom margin, darker alphabet keys
- Character callout above the pressed key
- Alternate-key hints with long-press to type the secondary character
- Phone-style numeric keypad that slides in from the right
- Noticeably lighter pressed-key color
- macOS-style soft key click sound
- Settings menu: key size (Compact / Default / Large), sound feedback, auto-show on text focus
- Touch-triggered pill button in the GNOME top panel (hidden until you touch the screen)
- Compact mode by default
- Input preview bubble above the keyboard
- Auto-show on text focus in GTK apps; touch detection works in Chrome and other apps
- Hot-reloadable (no need to restart GNOME Shell after edits)
- Persists settings to `~/.config/lvosk/settings.json`

## Requirements

- GNOME Shell 45-50
- Wayland session
- Touchscreen (recommended) or mouse

## Install

```bash
git clone git@github.com:lvddr/lvOSK.git
cd lvOSK
./install.sh
gnome-extensions enable win11-osk@local
```

Then log out and back in (or restart GNOME Shell) so the extension is discovered.

## Usage

- **Toggle keyboard:** click the yellow pill in the center of the top panel (appears on touch).
- **Settings:** click the gear icon on the keyboard header.
- **Numeric keypad:** click the grid icon to slide in the numpad.
- **Dock/float:** click the minimize icon to toggle floating mode.
- **Close:** click the X icon.

## Settings

Settings are stored in `~/.config/lvosk/settings.json`:

```json
{
  "keySize": "compact",
  "sound": true,
  "autoShow": false
}
```

## Development

```bash
./build.sh          # bundle sources into main.js
./install.sh        # copy to installed location
gnome-extensions disable win11-osk@local
gnome-extensions enable win11-osk@local   # hot reload
```

## License

MIT
