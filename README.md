# lvOSK

A vibecoded on-screen keyboard for GNOME Shell, created to make Linux life easier.

## Screenshots

![lvOSK keyboard](img/screenshot1.png)




## Requirements

- GNOME Shell 45-51
- Wayland session
- Touchscreen (recommended) or mouse

## Install

```bash
git clone git@github.com:lvddr/lvOSK.git
cd lvOSK
./install.sh
gnome-extensions enable win11-osk@local
```

### Install from a release
Download the source archive from the [latest release](https://github.com/lvddr/lvOSK/releases/latest), extract it, then:
```bash
cd lvOSK-*
./install.sh
gnome-extensions enable win11-osk@local
```

Then log out and back in (or restart GNOME Shell) so the extension is discovered.

## Usage

- **Toggle keyboard:** click the yellow pill at the bottom-right (appears on touch).
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
  "autoShow": false,
  "numpadByDefault": false
}
```

## Development

Source files live in `src/`. The build bundles them into `main.js` at the project root.

```bash
./build.sh          # bundle src/* into main.js
./install.sh        # copy runtime files to installed location
gnome-extensions disable win11-osk@local
gnome-extensions enable win11-osk@local   # hot reload
```

## License

MIT
