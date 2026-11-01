import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {LvOSKKey} from './keyWidget.js';
import {getLayout} from './layouts.js';
import {InputController} from './inputController.js';

const SLIDE_MS = 180;

const SETTINGS_PATH = GLib.build_filenamev([
    GLib.get_user_config_dir(), 'lvosk', 'settings.json',
]);

function bundledSound(name) {
    try {
        const [path] = GLib.filename_from_uri(import.meta.url.split('?')[0]);
        return GLib.build_filenamev([GLib.path_get_dirname(path), name]);
    } catch (e) {
        return null;
    }
}

const CLICK_SOUND = bundledSound('click.wav');

function bundledPath(name) {
    try {
        const [path] = GLib.filename_from_uri(import.meta.url.split('?')[0]);
        return GLib.build_filenamev([GLib.path_get_dirname(path), name]);
    } catch (e) {
        return null;
    }
}

const KEYPAD_ICON_PATH = bundledPath('keypad-icon.svg');
const CLICK_SOUND_OK = !!CLICK_SOUND && GLib.file_test(CLICK_SOUND, GLib.FileTest.EXISTS);
const KEY_SIZE_FACTORS = {compact: 0.62, default: 0.82, large: 0.95};
const KEY_SIZE_LABELS = {compact: 'Compact', default: 'Default', large: 'Large'};
const KEY_SIZE_ORDER = ['compact', 'default', 'large'];

function loadSettings() {
    try {
        const [ok, bytes] = GLib.file_get_contents(SETTINGS_PATH);
        if (!ok)
            return {};
        const data = JSON.parse(new TextDecoder().decode(bytes));
        return data && typeof data === 'object' ? data : {};
    } catch (e) {
        return {};
    }
}

function saveSettings(settings) {
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(SETTINGS_PATH), 0o755);
        GLib.file_set_contents(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('lvosk settings save error: ' + e);
    }
}

export class KeyboardUI {
    constructor() {
        this._input = new InputController();
        this._layerName = 'default'; // default | shift | symbols
        this._shiftMode = 'none'; // none | latched | locked
        this._ctrlSticky = false;
        this._lastShiftTap = 0;
        this._repeatSource = 0;
        this._repeatInterval = 0;
        this._floating = false;
        this._keypadOpen = false;
        this._settingsMenuOpen = false;
        this._hideSuppressedUntil = 0;
        this._spyglassTimer = 0;
        this._spyglassPosTimer = 0;
        this._callout = null;
        this._visible = false;
        this._height = 420;
        this._settings = Object.assign(
            {keySize: 'compact', sound: false, autoShow: false},
            loadSettings());
        if (!KEY_SIZE_FACTORS[this._settings.keySize])
            this._settings.keySize = 'compact';

        this._buildContainer();
    }

    get autoShow() {
        return this._settings.autoShow !== false;
    }

    get settingsMenuOpen() {
        const now = GLib.get_monotonic_time() / 1000;
        if (this._settingsMenu && this._settingsMenu.isOpen)
            return true;
        return (this._hideSuppressedUntil || 0) > now;
    }

    _monitor() {
        return Main.layoutManager.primaryMonitor || {width: 1920, height: 1080, x: 0, y: 0};
    }

    _buildContainer() {
        this._container = new St.BoxLayout({
            vertical: true,
            style_class: 'lvosk-keyboard',
            reactive: true,
            can_focus: false,
            x_expand: true,
        });
        this._container.set_position(0, 10000); // off-screen initially

        // Header
        this._header = this._buildHeader();
        this._container.add_child(this._header);

        // Body wrapper: two expanding spacers keep the body centered at its
        // natural width when the keypad is closed.
        this._gridWrapper = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_expand: true,
        });
        this._container.add_child(this._gridWrapper);

        this._wrapLeft = new St.Widget({x_expand: true});
        this._gridWrapper.add_child(this._wrapLeft);

        this._body = new St.BoxLayout({
            vertical: false,
            style_class: 'key-body',
            x_expand: false,
            y_expand: true,
        });
        this._body.y_align = Clutter.ActorAlign.CENTER;
        this._gridWrapper.add_child(this._body);

        this._wrapRight = new St.Widget({x_expand: true});
        this._gridWrapper.add_child(this._wrapRight);

        this._bodyLeftPad = new St.Widget({width: 12});
        this._body.add_child(this._bodyLeftPad);

        this._gridBox = new St.BoxLayout({
            vertical: true,
            style_class: 'key-grid',
            x_expand: false,
            y_expand: true,
        });
        this._body.add_child(this._gridBox);

        this._midSpacer = new St.Widget({width: 12});
        this._body.add_child(this._midSpacer);

        this._keypadBox = new St.BoxLayout({
            vertical: true,
            style_class: 'keypad-grid',
            x_expand: false,
            y_expand: true,
        });
        this._keypadBox.visible = false;
        this._body.add_child(this._keypadBox);

        this._bodyRightPad = new St.Widget({width: 12});
        this._body.add_child(this._bodyRightPad);

        // Mount
        Main.layoutManager.uiGroup.add_child(this._container);

        this._spyglass = new St.Label({text: '', style_class: 'keyboard-spyglass'});
        Main.layoutManager.uiGroup.add_child(this._spyglass);
        this._spyglass.hide();

        if (Main.inputMethod) {
            try {
                Main.inputMethod.connect('notify::_surroundingText', () => {
                    if (this._visible) this._updateSpyglass();
                });
            } catch (e) {}
            try {
                Main.inputMethod.connect('notify::_preeditStr', () => {
                    if (this._visible) this._updateSpyglass();
                });
            } catch (e) {}
            try {
                Main.inputMethod.connect('notify::_preeditVisible', () => {
                    if (this._visible) this._updateSpyglass();
                });
            } catch (e) {}
        }


        this._applyMode();
        this._render();
        this._container.hide();
    }

    _buildHeader() {
        const header = new St.BoxLayout({
            style_class: 'lvosk-keyboard-header',
            x_expand: true,
            vertical: false,
        });

        const leftGroup = new St.BoxLayout({style_class: 'header-left', });
        this._settingsBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 15})});
        this._layoutBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Icon({icon_name: 'view-grid-symbolic', icon_size: 15})});
        this._layoutBtn.connect('clicked', () => this.toggleKeypad());
        this._settingsBtn.connect('clicked', () => this._settingsMenu.toggle());
        leftGroup.add_child(this._settingsBtn);
        leftGroup.add_child(this._layoutBtn);

        const center = new St.BoxLayout({x_expand: true});
        // drag handle area
        center.reactive = true;

        const rightGroup = new St.BoxLayout({style_class: 'header-right', });
        this._dockBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Icon({icon_name: 'window-minimize-symbolic', icon_size: 15})});
        const closeBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 15})});
        rightGroup.add_child(this._dockBtn);
        rightGroup.add_child(closeBtn);

        header.add_child(leftGroup);
        header.add_child(center);
        header.add_child(rightGroup);

        // Dragging in floating mode
        let dragStart = null;
        const onDown = (a, e) => {
            if (!this._floating) return Clutter.EVENT_PROPAGATE;
            const [x, y] = e.get_coords();
            dragStart = {x, y, cx: this._container.x, cy: this._container.y};
            return Clutter.EVENT_STOP;
        };
        const onMotion = (a, e) => {
            if (!dragStart) return Clutter.EVENT_PROPAGATE;
            const [x, y] = e.get_coords();
            this._container.set_position(dragStart.cx + (x - dragStart.x), dragStart.cy + (y - dragStart.y));
            return Clutter.EVENT_STOP;
        };
        const onUp = () => { dragStart = null; return Clutter.EVENT_STOP; };
        center.connect('button-press-event', onDown);
        center.connect('motion-event', onMotion);
        center.connect('button-release-event', onUp);

        closeBtn.connect('clicked', () => this.hide());
        this._dockBtn.connect('clicked', () => this.toggleFloat());

        this._buildSettingsMenu();
        return header;
    }

    _buildSettingsMenu() {
        const menu = new PopupMenu.PopupMenu(this._settingsBtn, 0.0, St.Side.TOP);
        menu.actor.add_style_class_name('lvosk-settings-menu');
        Main.layoutManager.uiGroup.add_child(menu.actor);
        menu.actor.hide();

        menu.connect('open-state-changed', (m, isOpen) => {
            this._settingsMenuOpen = isOpen;
            if (isOpen) {
                this._hideSuppressedUntil = 0;
            } else {
                this._hideSuppressedUntil =
                    GLib.get_monotonic_time() / 1000 + 600;
            }
        });

        this._keySizeItem = new PopupMenu.PopupMenuItem(
            `Key size: ${KEY_SIZE_LABELS[this._settings.keySize]}`);
        this._keySizeItem.connect('activate', () => {
            const i = KEY_SIZE_ORDER.indexOf(this._settings.keySize);
            this._settings.keySize =
                KEY_SIZE_ORDER[(i + 1) % KEY_SIZE_ORDER.length];
            this._keySizeItem.label.text =
                `Key size: ${KEY_SIZE_LABELS[this._settings.keySize]}`;
            saveSettings(this._settings);
            this._applyMode();
            this._render();
            if (this._visible) {
                const [x, y] = this._targetPosition();
                this._container.ease({
                    x, y,
                    duration: SLIDE_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        });
        menu.addMenuItem(this._keySizeItem);

        this._soundItem = new PopupMenu.PopupSwitchMenuItem(
            'Sound feedback', this._settings.sound === true);
        this._soundItem.connect('toggled', (item, state) => {
            this._settings.sound = state;
            saveSettings(this._settings);
        });
        menu.addMenuItem(this._soundItem);

        this._autoShowItem = new PopupMenu.PopupSwitchMenuItem(
            'Show on text focus', this._settings.autoShow !== false);
        this._autoShowItem.connect('toggled', (item, state) => {
            this._settings.autoShow = state;
            saveSettings(this._settings);
        });
        menu.addMenuItem(this._autoShowItem);

        this._settingsMenu = menu;
    }

    _playClick() {
        if (!this._settings.sound)
            return;
        try {
            const player = global.display.get_sound_player();
            if (CLICK_SOUND_OK) {
                player.play_from_file(
                    Gio.File.new_for_path(CLICK_SOUND),
                    'On-screen keyboard key', null);
                return;
            }
        } catch (e) {}
        try {
            global.display.get_sound_player().play_from_theme(
                'bell', 'On-screen keyboard key', null);
        } catch (e) {}
    }

    _containerWidth() {
        const m = this._monitor();
        if (!this._floating)
            return m.width;
        const factor = KEY_SIZE_FACTORS[this._settings.keySize] || 0.82;
        const base = Math.min(960, Math.max(480, m.width - 40));
        return Math.round(base * (factor / KEY_SIZE_FACTORS.default));
    }

    _applyMode() {
        const m = this._monitor();
        if (this._floating) {
            const w = this._containerWidth();
            this._height = 400;
            this._container.set_size(w, this._height);
            this._container.style_class = 'lvosk-keyboard floating';
        } else {
            this._height = 420;
            this._container.set_size(m.width, this._height);
            this._container.style_class = 'lvosk-keyboard';
        }
    }

    _targetPosition() {
        const m = this._monitor();
        if (this._floating) {
            const w = this._containerWidth();
            const x = m.x + Math.round((m.width - w) / 2);
            const y = Math.max(m.y + 40, m.y + Math.round((m.height - this._height) / 2));
            return [x, y];
        }
        return [0, m.y + m.height - this._height];
    }

    _contentWidth() {
        const m = this._monitor();
        const factor = KEY_SIZE_FACTORS[this._settings.keySize] || 0.82;
        if (this._floating)
            return this._containerWidth() - 24;
        return Math.min(m.width * factor, factor >= 0.95 ? 1600 : 1280);
    }

    _containerPixelWidth() {
        return this._floating ? this._containerWidth() : this._monitor().width;
    }

    _keypadWidth() {
        if (!this._keypadOpen)
            return 0;
        const container = this._containerPixelWidth();
        return Math.round(Math.min(360, Math.max(220, container * 0.24)));
    }

    _render() {
        const container = this._containerPixelWidth();
        const content = this._contentWidth();
        const keypadWidth = this._keypadWidth();
        const split = this._keypadOpen;
        // In split mode the letters hug the left edge and the keypad the
        // right edge, leaving whatever space the key size leaves in between.
        const lettersWidth = split
            ? Math.min(content, container - keypadWidth - 36)
            : content;

        this._gridBox.translation_x = 0;
        this._keypadBox.translation_x = 0;
        this._keypadBox.opacity = 255;
        this._gridBox.destroy_all_children();
        this._keypadBox.destroy_all_children();
        this._gridBox.set_width(lettersWidth);
        this._keypadBox.set_width(keypadWidth);
        this._keypadBox.visible = split;

        this._bodyLeftPad.visible = split;
        this._bodyRightPad.visible = split;
        this._midSpacer.visible = split;
        this._wrapLeft.visible = true;
        this._wrapRight.visible = true;
        this._body.x_expand = false;

        this._lettersWidth = lettersWidth;
        this._keypadPixelWidth = keypadWidth;
        this._containerPixelWidthCache = container;

        if (split)
            this._layoutBtn.add_style_class_name('toggled');
        else
            this._layoutBtn.remove_style_class_name('toggled');

        let layoutName = this._layerName;
        if (layoutName === 'shift' && this._shiftMode === 'locked') layoutName = 'shift';
        this._populate(getLayout(layoutName), this._gridBox, lettersWidth, false);

        if (split)
            this._populate(getLayout('keypad'), this._keypadBox, keypadWidth, true);

        if (split)
            this._fitKeypadHeight();
    }

    _fitKeypadHeight() {
        // Stretch/squish the five keypad rows so the pad is exactly as tall
        // as the four-row letter grid beside it.
        const rows = this._keypadBox.get_children();
        if (!rows.length)
            return;
        const lettersHeight = this._gridBox.get_preferred_height(-1)[1];
        const gap = 6;
        const rowHeight = Math.max(
            36, Math.floor((lettersHeight - gap * (rows.length - 1)) / rows.length));
        for (const row of rows) {
            row.set_height(rowHeight);
            for (const key of row.get_children())
                key.set_height(rowHeight);
        }
    }

    toggleKeypad() {
        if (this._keypadOpen) {
            this._closeKeypadAnimated();
            return;
        }

        this._keypadOpen = true;
        this._shiftMode = 'none';
        this._render();
        if (!this._visible)
            return;

        const container = this._containerPixelWidthCache || this._containerPixelWidth();
        const lettersWidth = this._lettersWidth || 0;
        const keypadWidth = this._keypadPixelWidth || 0;
        // The letters+keypad group is centered, so when the keypad appears the
        // letters shift left by roughly half of it. Start them where they were
        // centered on their own.
        const groupWidth = lettersWidth + keypadWidth + 36;
        const finalLettersX = groupWidth >= container
            ? 12
            : (container - groupWidth) / 2 + 12;
        const centerOffset = Math.max(0, (container - lettersWidth) / 2 - finalLettersX);

        // Letters slide left while the keypad fades and slides in from the
        // right edge.
        this._gridBox.translation_x = centerOffset;
        this._keypadBox.translation_x = keypadWidth + 24;
        this._keypadBox.opacity = 0;
        const params = {
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        };
        this._gridBox.ease({...params, translation_x: 0});
        this._keypadBox.ease({...params, translation_x: 0, opacity: 255});
    }

    _closeKeypadAnimated() {
        if (!this._visible) {
            this._keypadOpen = false;
            this._render();
            return;
        }

        const container = this._containerPixelWidthCache || this._containerPixelWidth();
        const lettersWidth = this._lettersWidth || 0;
        const keypadWidth = this._keypadPixelWidth || 0;
        const groupWidth = lettersWidth + keypadWidth + 36;
        const finalLettersX = groupWidth >= container
            ? 12
            : (container - groupWidth) / 2 + 12;
        const centerOffset = Math.max(0, (container - lettersWidth) / 2 - finalLettersX);
        const params = {
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._keypadOpen = false;
                this._render();
            },
        };
        this._keypadBox.ease({...params, translation_x: keypadWidth + 24, opacity: 0});
        this._gridBox.ease({...params, translation_x: centerOffset});
    }

    _populate(rows, box, width, isKeypad) {
        rows.forEach((row) => {
            // leftOffset
            let leftOffset = 0;
            const first = row[0];
            if (first && first.leftOffset) {
                leftOffset = first.leftOffset;
                row = row.slice(1);
            }
            // compute total units
            let total = leftOffset;
            row.forEach(k => { total += (k.width || 1); });

            const rowBox = new St.BoxLayout({
                vertical: false,
                style_class: isKeypad ? 'key-row keypad-row' : 'key-row',
            });

            const unit = this._unitWidth(total, width, isKeypad);

            if (leftOffset > 0) {
                const spacer = new St.Widget({
                    width: Math.round(leftOffset * unit),
                    x_expand: false,
                });
                rowBox.add_child(spacer);
            }

            row.forEach((spec) => {
                const key = new LvOSKKey(spec);
                if (spec.type === 'char' && /^[a-zA-Z]$/.test(spec.label || ''))
                    key.button.add_style_class_name('alpha-key');
                if (isKeypad)
                    key.button.add_style_class_name('keypad-key');
                // adjust active style for shift keys based on mode
                if (spec.type === 'action' && spec.action === 'shift') {
                    if (this._shiftMode !== 'none')
                        key.setLatched(true);
                }
                if (spec.type === 'action' && spec.action === 'ctrl') {
                    if (this._ctrlSticky)
                        key.setLatched(true);
                }
                if (spec.type === 'action' && spec.action === 'symbols' && this._layerName === 'symbols') {
                    key.setLatched(true);
                }

                // width
                key.set_size(Math.round((spec.width || 1) * unit), -1);

                this._wireKey(key, spec);
                rowBox.add_child(key);
            });

            box.add_child(rowBox);
        });
    }

    _unitWidth(totalUnits, width, isKeypad) {
        // Reserve room for the gaps between keys. Letter rows can have up to
        // 12 children; keypad rows only 3.
        const gaps = 6 * (isKeypad ? 2 : 12);
        return Math.max(20, (width - gaps) / totalUnits);
    }

    _wireKey(key, spec) {
        const repeatable = this._isRepeatable(spec);

        key.connect('long-press', () => {
            if (!spec.secondary)
                return;
            key._longPressed = true;
            this._showCallout(key, spec.secondary);
            this._input.sendKeyval(this._charToKeyval(spec.secondary));
            this._afterChar();
        });

        key.connect('pressed', () => {
            this._playClick();
            this._showCallout(key, this._calloutText(spec));
            if (repeatable) {
                if (spec.type === 'char' && spec.label === ' ')
                    this._input.sendKeyval(Clutter.KEY_space);
                else if (spec.type === 'action')
                    this._performAction(spec, key);
                this._startRepeat(spec, key);
            } else if (spec.type === 'action') {
                this._performAction(spec, key);
            }
            // char keys handled on release
        });

        key.connect('released', () => {
            this._hideCallout();
            this._stopRepeat();
            if (repeatable)
                return;
            if (spec.type === 'action')
                return;
            // char key
            if (key._longPressed) {
                key._longPressed = false;
                return; // secondary already sent
            }
            this._performChar(spec, key);
        });
    }

    _isRepeatable(spec) {
        if (spec.type === 'char' && spec.label === ' ')
            return true;
        if (spec.type === 'action' && (spec.action === 'backspace' || spec.action === 'left' || spec.action === 'right'))
            return true;
        return false;
    }

    _performAction(spec, key) {
        switch (spec.action) {
            case 'backspace':
                this._input.sendKeyval(Clutter.KEY_BackSpace);
                break;
            case 'enter':
                this._input.sendKeyval(Clutter.KEY_Return);
                break;
            case 'left':
                this._input.sendKeyval(Clutter.KEY_Left);
                break;
            case 'right':
                this._input.sendKeyval(Clutter.KEY_Right);
                break;
            case 'shift':
                this._handleShiftTap();
                this._render();
                break;
            case 'ctrl':
                this._ctrlSticky = !this._ctrlSticky;
                this._render();
                break;
            case 'symbols':
                this._layerName = 'symbols';
                this._render();
                break;
            case 'abc':
                this._layerName = this._shiftMode === 'none' ? 'default' : 'shift';
                this._render();
                break;
            case 'mic':
                this._input.sendSuperH();
                break;
            case 'hide':
                this.hide();
                break;
            case 'emoji':
            case 'layout':
                // not implemented
                break;
        }
    }

    _handleShiftTap() {
        const now = GLib.get_monotonic_time() / 1000;
        if (this._shiftMode === 'locked') {
            this._shiftMode = 'none';
            this._layerName = 'default';
            return;
        }
        if (this._lastShiftTap && (now - this._lastShiftTap) < 300) {
            this._shiftMode = 'locked';
            this._layerName = 'shift';
        } else {
            this._shiftMode = 'latched';
            this._layerName = 'shift';
        }
        this._lastShiftTap = now;
    }

    _performChar(spec, key) {
        let ch = spec.label;
        if (this._shiftMode !== 'none' && /[a-z]/.test(ch))
            ch = ch.toUpperCase();
        // ctrl sticky
        if (this._ctrlSticky) {
            this._input.sendCtrlCombo(this._charToKeyval(ch));
            this._ctrlSticky = false;
            this._render();
        } else {
            this._input.sendKeyval(this._charToKeyval(ch));
        }
        // one-shot shift revert
        if (this._shiftMode === 'latched') {
            this._shiftMode = 'none';
            this._layerName = 'default';
            this._render();
        }
        // secondary? no, primary only
    }

    _charToKeyval(ch) {
        // Map common chars to Clutter keys
        const map = {
            ' ': Clutter.KEY_space,
            ',': Clutter.KEY_comma,
            '.': Clutter.KEY_period,
            '?': Clutter.KEY_question,
            '!': Clutter.KEY_exclam,
            "'": Clutter.KEY_apostrophe,
            '"': Clutter.KEY_quotedbl,
            ';': Clutter.KEY_semicolon,
            ':': Clutter.KEY_colon,
            '/': Clutter.KEY_slash,
            '\\': Clutter.KEY_backslash,
            '-': Clutter.KEY_minus,
            '+': Clutter.KEY_plus,
            '*': Clutter.KEY_asterisk,
            '(': Clutter.KEY_parenleft,
            ')': Clutter.KEY_parenright,
            '&': Clutter.KEY_ampersand,
            '#': Clutter.KEY_numbersign,
            '$': Clutter.KEY_dollar,
            '%': Clutter.KEY_percent,
            '@': Clutter.KEY_at,
            '_': Clutter.KEY_underscore,
            '=': Clutter.KEY_equal,
        };
        if (map[ch] !== undefined)
            return map[ch];
        const code = ch.charCodeAt(0);
        if (code >= 97 && code <= 122)
            return Clutter.KEY_a + (code - 97);
        if (code >= 65 && code <= 90)
            return Clutter.KEY_A + (code - 65);
        if (code >= 48 && code <= 57)
            return Clutter.KEY_0 + (code - 48);
        return 0;
    }

    _afterChar() {
        if (this._shiftMode === 'latched') {
            this._shiftMode = 'none';
            this._layerName = 'default';
            this._render();
        }
    }

    _startRepeat(spec, key) {
        this._stopRepeat();
        this._repeatSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._repeatInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                if (spec.type === 'char' && spec.label === ' ')
                    this._input.sendKeyval(Clutter.KEY_space);
                else if (spec.type === 'action')
                    this._performAction(spec, key);
                return GLib.SOURCE_CONTINUE;
            });
            this._repeatSource = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopRepeat() {
        if (this._repeatSource) {
            try { GLib.source_remove(this._repeatSource); } catch (e) {}
            this._repeatSource = 0;
        }
        if (this._repeatInterval) {
            try { GLib.source_remove(this._repeatInterval); } catch (e) {}
            this._repeatInterval = 0;
        }
    }

    _calloutText(spec) {
        if (spec.type === 'char') {
            let ch = spec.label;
            if (this._shiftMode !== 'none' && /[a-z]/.test(ch))
                ch = ch.toUpperCase();
            return ch === ' ' ? '␣' : ch;
        }
        if (spec.label)
            return spec.label;
        return (spec.action || '').toUpperCase();
    }

    _showCallout(key, text) {
        this._hideCallout();
        if (!text)
            return;
        const popup = new St.Label({text: String(text), style_class: 'key-callout'});
        Main.layoutManager.uiGroup.add_child(popup);
        this._callout = popup;
        // position after allocation
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            try {
                const [kx, ky] = key.get_transformed_position();
                const [kw, kh] = key.get_size();
                const [pw, ph] = popup.get_size();
                const cx = kx + kw / 2 - pw / 2;
                const cy = ky - ph - 12;
                popup.set_position(Math.round(cx), Math.round(cy));
            } catch (e) {}
            return GLib.SOURCE_REMOVE;
        });
    }

    _hideCallout() {
        if (this._callout) {
            try { this._callout.destroy(); } catch (e) {}
            this._callout = null;
        }
    }

    _updateSpyglass() {
        const im = Main.inputMethod;
        let text = null;
        let cursor = null;
        if (im) {
            // Prefer preedit (in-progress composition) for real-time feedback.
            if (im._preeditStr && im._preeditVisible) {
                text = im._preeditStr;
                cursor = (im._preeditPos != null) ? im._preeditPos : text.length;
            } else {
                text = im._surroundingText;
                cursor = im._surroundingTextCursor;
            }
        }
        if (!text) {
            this._spyglass.hide();
            return;
        }
        const c = (cursor != null && cursor >= 0) ? Math.min(cursor, text.length) : text.length;
        let display;
        if (text.length <= 60) {
            display = text.slice(0, c) + '│' + text.slice(c);
        } else {
            const start = Math.max(0, c - 30);
            const end = Math.min(text.length, c + 30);
            display = (start > 0 ? '…' : '') +
                text.slice(start, c) + '│' + text.slice(c, end) +
                (end < text.length ? '…' : '');
        }
        this._spyglass.set_text(display);
        // position above keyboard
        if (this._spyglassPosTimer) {
            try { GLib.source_remove(this._spyglassPosTimer); } catch (e) {}
            this._spyglassPosTimer = 0;
        }
        this._spyglassPosTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            this._spyglassPosTimer = 0;
            try {
                const [kx, ky] = this._container.get_transformed_position();
                const [kw] = this._container.get_size();
                const [pw, ph] = this._spyglass.get_size();
                this._spyglass.set_position(
                    Math.round(kx + kw / 2 - pw / 2),
                    Math.round(ky - ph - 10));
                this._spyglass.show();
            } catch (e) {}
            return GLib.SOURCE_REMOVE;
        });
    }

    _requestSurrounding() {
        const im = Main.inputMethod;
        if (!im) return;
        try { im._emitRequestSurrounding(); } catch (e) {}
    }

    _startSpyglass() {
        this._stopSpyglass();
        this._requestSurrounding();
        this._updateSpyglass();
        this._spyglassTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._requestSurrounding();
            this._updateSpyglass();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopSpyglass() {
        if (this._spyglassTimer) {
            try { GLib.source_remove(this._spyglassTimer); } catch (e) {}
            this._spyglassTimer = 0;
        }
        if (this._spyglassPosTimer) {
            try { GLib.source_remove(this._spyglassPosTimer); } catch (e) {}
            this._spyglassPosTimer = 0;
        }
        if (this._spyglass) this._spyglass.hide();
    }

    show() {
        if (this._visible) return;
        this._visible = true;
        this._applyMode();
        const m = this._monitor();
        const [targetX, targetY] = this._targetPosition();
        this._container.set_position(targetX, m.y + m.height); // start below
        this._container.show();
        this._container.ease({
            y: targetY,
            duration: SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._startSpyglass();
    }

    hide() {
        this._hideCallout();
        if (!this._visible) return;
        this._visible = false;
        this._stopSpyglass();
        const m = this._monitor();
        const targetY = m.y + m.height;
        this._container.ease({
            y: targetY,
            duration: SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._container.hide(),
        });
    }

    toggleFloat() {
        this._floating = !this._floating;
        this._applyMode();
        this._render();
        if (this._visible) {
            const [targetX, targetY] = this._targetPosition();
            this._container.ease({
                x: targetX,
                y: targetY,
                duration: SLIDE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    destroy() {
        try { this._input.destroy(); } catch (e) {}
        try { if (this._settingsMenu) this._settingsMenu.destroy(); } catch (e) {}
        try { if (this._spyglassTimer) GLib.source_remove(this._spyglassTimer); } catch (e) {}
        try { if (this._spyglassTimer) GLib.source_remove(this._spyglassTimer); } catch (e) {}
        try { if (this._spyglassPosTimer) GLib.source_remove(this._spyglassPosTimer); } catch (e) {}
        try { if (this._spyglass) this._spyglass.destroy(); } catch (e) {}
        try { this._container.destroy(); } catch (e) {}
    }
}