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
        this._shiftHoldSource = 0;
        this._shiftHoldTriggered = false;
        this._repeatInterval = 0;
        this._floating = false;
        this._keypadOpen = false;
        this._settingsMenuOpen = false;
        this._hideSuppressedUntil = 0;
        this._barTimer = 0;
        this._spyglassTimer = 0;
        this._spyglassPosTimer = 0;
        this._callout = null;
        this._calloutTimeout = 0;
        this._destroyed = false;
        this._previewText = '';
        this._previewBar = null;
        this._specialChars = {};
        this._carouselTimer = 0;
        this._carouselTriggered = false;
        this._carousel = null;
        this._visible = false;
        this._height = 420;
        this._renderScheduled = false;
        this._barTimer = 0;
        this._settings = Object.assign(
            {keySize: 'compact', sound: false, autoShow: false, numpadByDefault: false},
            loadSettings());
        if (!KEY_SIZE_FACTORS[this._settings.keySize])
            this._settings.keySize = 'compact';
        if (typeof this._settings.numpadByDefault !== 'boolean')
            this._settings.numpadByDefault = false;
        this._keypadOpen = this._settings.numpadByDefault === true;

        // Follow the system color scheme (light/dark).
        this._interfaceSettings = null;
        this._theme = 'light';
        try {
            this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            this._updateSystemTheme();
            this._interfaceSettings.connect('changed::color-scheme', () => {
                this._updateSystemTheme();
                this._applyMode();
            });
            try {
                this._interfaceSettings.connect('changed::gtk-theme', () => {
                    this._updateSystemTheme();
                    this._applyMode();
                });
            } catch (e) {}
        } catch (e) {}

        this._loadSpecialChars();
        try {
            const is = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
            is.connect('changed::current', () => this._loadSpecialChars());
            is.connect('changed::sources', () => this._loadSpecialChars());
        } catch (e) {}

        this._buildContainer();

        // Keep the keyboard sized and positioned correctly when the monitor
        // geometry changes (e.g. device rotation).
        this._monitorsChangedId = 0;
        try {
            this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
                this._onMonitorsChanged();
            });
        } catch (e) {}
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
            orientation: Clutter.Orientation.VERTICAL,
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
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_expand: true,
        });
        this._container.add_child(this._gridWrapper);

        this._wrapLeft = new St.Widget({x_expand: true});
        this._gridWrapper.add_child(this._wrapLeft);

        this._body = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
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
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'key-grid',
            x_expand: false,
            y_expand: true,
        });
        this._body.add_child(this._gridBox);

        this._midSpacer = new St.Widget({width: 12});
        this._body.add_child(this._midSpacer);

        this._keypadBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
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

        this._buildBar();

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
            orientation: Clutter.Orientation.HORIZONTAL,
        });

        const leftGroup = new St.BoxLayout({style_class: 'header-left', });
        this._settingsBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 15})});
        this._layoutBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Label({text: 'Keypad', style_class: 'lvosk-header-button-label'})});
        this._langBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Label({text: this._langLabel(), style_class: 'lvosk-header-button-label'})});
        this._layoutBtn.connect('clicked', () => this.toggleKeypad());
        this._langBtn.connect('clicked', () => this._cycleInputSource());
        this._settingsBtn.connect('clicked', () => this._settingsMenu.toggle());
        leftGroup.add_child(this._settingsBtn);
        leftGroup.add_child(this._langBtn);

        const center = new St.BoxLayout({x_expand: true});
        // drag handle area
        center.reactive = true;

        const rightGroup = new St.BoxLayout({style_class: 'header-right', });
        const closeBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 15})});
        rightGroup.add_child(this._layoutBtn);
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
            this._scheduleRender();
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

        this._numpadByDefaultItem = new PopupMenu.PopupSwitchMenuItem(
            'Numpad by default', this._settings.numpadByDefault === true);
        this._numpadByDefaultItem.connect('toggled', (item, state) => {
            this._settings.numpadByDefault = state;
            saveSettings(this._settings);
            if (state !== this._keypadOpen) {
                if (this._visible)
                    this.toggleKeypad();
                else {
                    this._keypadOpen = state;
                    this._render();
                }
            }
        });
        menu.addMenuItem(this._numpadByDefaultItem);

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

    _effectiveFactor() {
        const m = this._monitor();
        // On narrow screens (e.g. portrait/rotated tablets) force the large
        // key size so keys stay usable and fill the available width.
        if (!this._floating && m.width < 1000)
            return KEY_SIZE_FACTORS.large;
        return KEY_SIZE_FACTORS[this._settings.keySize] || KEY_SIZE_FACTORS.default;
    }

    _containerWidth() {
        const m = this._monitor();
        if (!this._floating)
            return m.width;
        const factor = KEY_SIZE_FACTORS[this._settings.keySize] || KEY_SIZE_FACTORS.default;
        const base = Math.min(960, Math.max(480, m.width - 40));
        const w = Math.round(base * (factor / KEY_SIZE_FACTORS.default));
        // Never let the floating keyboard overflow the monitor.
        return Math.min(w, m.width - 40);
    }

    _updateSystemTheme() {
        let theme = 'light';
        try {
            if (this._interfaceSettings) {
                const cs = this._interfaceSettings.get_string('color-scheme');
                if (cs === 'prefer-dark')
                    theme = 'dark';
                else if (cs === 'prefer-light')
                    theme = 'light';
                else {
                    const gtk = this._interfaceSettings.get_string('gtk-theme');
                    theme = /dark/i.test(gtk) ? 'dark' : 'light';
                }
            }
        } catch (e) {}
        this._theme = theme;
    }

    _xkbName(s) {
        if (!s) return null;
        if (s === 'Greek_pi') return 'π';
        if (s === 'Greek_OMEGA') return 'Ω';
        if (s === 'eogonek') return 'ę';
        if (s === 'Eogonek') return 'Ę';
        if (s === 'aogonek') return 'ą';
        if (s === 'Aogonek') return 'Ą';
        if (s === 'sacute') return 'ś';
        if (s === 'Sacute') return 'Ś';
        if (s === 'zabovedot') return 'ż';
        if (s === 'Zabovedot') return 'Ż';
        if (s === 'zacute') return 'ź';
        if (s === 'Zacute') return 'Ź';
        if (s === 'cacute') return 'ć';
        if (s === 'Cacute') return 'Ć';
        if (s === 'nacute') return 'ń';
        if (s === 'Nacute') return 'Ń';
        if (s === 'oacute') return 'ó';
        if (s === 'Oacute') return 'Ó';
        if (s === 'lstroke') return 'ł';
        if (s === 'Lstroke') return 'Ł';
        if (s === 'Ustroke') return 'Ŧ';
        if (s === 'dstroke') return 'đ';
        if (s === 'Dstroke') return 'Đ';
        if (s === 'tcedilla') return 'ţ';
        if (s === 'Tcedilla') return 'Ţ';
        if (s === 'scaron') return 'š';
        if (s === 'Scaron') return 'Š';
        if (s === 'ccaron') return 'č';
        if (s === 'Ccaron') return 'Č';
        if (s === 'rcaron') return 'ř';
        if (s === 'Rcaron') return 'Ř';
        if (s === 'zcaron') return 'ž';
        if (s === 'Zcaron') return 'Ž';
        if (s === 'yacute') return 'ý';
        if (s === 'Yacute') return 'Ý';
        if (s === 'uacute') return 'ú';
        if (s === 'Uacute') return 'Ú';
        if (s === 'iacute') return 'í';
        if (s === 'Iacute') return 'Í';
        if (s === 'aacute') return 'á';
        if (s === 'Aacute') return 'Á';
        if (s === 'eacute') return 'é';
        if (s === 'Eacute') return 'É';
        if (s === 'agrave') return 'à';
        if (s === 'Agrave') return 'À';
        if (s === 'egrave') return 'è';
        if (s === 'Egrave') return 'È';
        if (s === 'igrave') return 'ì';
        if (s === 'Igrave') return 'Ì';
        if (s === 'ograve') return 'ò';
        if (s === 'Ograve') return 'Ò';
        if (s === 'ugrave') return 'ù';
        if (s === 'Ugrave') return 'Ù';
        if (s === 'acircumflex') return 'â';
        if (s === 'Acircumflex') return 'Â';
        if (s === 'ecircumflex') return 'ê';
        if (s === 'Ecircumflex') return 'Ê';
        if (s === 'icircumflex') return 'î';
        if (s === 'Icircumflex') return 'Ê';
        if (s === 'ocircumflex') return 'ô';
        if (s === 'Ocircumflex') return 'Ô';
        if (s === 'ucircumflex') return 'û';
        if (s === 'Ucircumflex') return 'Û';
        if (s === 'adiaeresis') return 'ä';
        if (s === 'Adiaeresis') return 'Ä';
        if (s === 'ediaeresis') return 'ë';
        if (s === 'Ediaeresis') return 'Ë';
        if (s === 'idiaeresis') return 'ï';
        if (s === 'Idiaeresis') return 'Ï';
        if (s === 'odiaeresis') return 'ö';
        if (s === 'Odiaeresis') return 'Ö';
        if (s === 'udiaeresis') return 'ü';
        if (s === 'Udiaeresis') return 'Ü';
        if (s === 'aring') return 'å';
        if (s === 'Aring') return 'Å';
        if (s === 'oslash') return 'ø';
        if (s === 'Oslash') return 'Ø';
        if (s === 'ae') return 'æ';
        if (s === 'AE') return 'Æ';
        if (s === 'thorn') return 'þ';
        if (s === 'THORN') return 'Þ';
        if (s === 'ccedilla') return 'ç';
        if (s === 'Ccedilla') return 'Ç';
        if (s === 'ntilde') return 'ñ';
        if (s === 'Ntilde') return 'Ñ';
        if (s === 'ntilde') return 'ñ';
        if (s === 'ssharp') return 'ß';
        if (s === 'eth') return 'ð';
        if (s === 'ETH') return 'Ð';
        return null;
    }

    _langLabel() {
        try {
            const is = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
            const sources = is.get_value('sources');
            let current = 0;
            try { current = is.get_uint('current'); } catch (e) { current = 0; }
            if (sources && sources.n_children() > current) {
                const s = sources.get_child_value(current);
                const id = s.get_child_value(1).get_string()[0] || '';
                if (id.indexOf('+') >= 0) return id.split('+')[0].toUpperCase();
                return id.toUpperCase().slice(0, 2);
            }
        } catch (e) {}
        return 'US';
    }

    _cycleInputSource() {
        try {
            const is = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
            const sources = is.get_value('sources');
            const n = sources ? sources.n_children() : 0;
            if (n <= 1) return;
            let current = 0;
            try { current = is.get_uint('current'); } catch (e) { current = 0; }
            const next = (current + 1) % n;
            is.set_uint('current', next);
            if (this._langBtn && this._langBtn.get_child && this._langBtn.get_child().set_text)
                this._langBtn.get_child().set_text(this._langLabel());
            else if (this._langBtn && this._langBtn.child && this._langBtn.child.set_text)
                this._langBtn.child.set_text(this._langLabel());
            this._loadSpecialChars();
        } catch (e) {}
    }

    _getActiveLayout() {
        try {
            const is = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
            const sources = is.get_value('sources');
            let current = 0;
            try { current = is.get_uint('current'); } catch (e) { current = 0; }
            if (sources && sources.n_children() > current) {
                const s = sources.get_child_value(current);
                const id = s.get_child_value(1).get_string()[0];
                if (!id) return null;
                if (id.indexOf('+') >= 0) {
                    const parts = id.split('+');
                    return {layout: parts[0], variant: parts[1] || ''};
                }
                return {layout: id, variant: ''};
            }
        } catch (e) {}
        return null;
    }

    _loadSpecialChars() {
        this._specialChars = {};
        const l = this._getActiveLayout();
        if (!l) return;
        const cacheKey = l.layout + ':' + l.variant;
        if (this._xkbCacheKey === cacheKey && Object.keys(this._specialChars).length)
            return;
        try {
            const variantPart = l.variant ? '(' + l.variant + ')' : '';
            const km = 'xkb_keymap {\n' +
                '  xkb_keycodes { include "evdev+aliases(qwerty)" };\n' +
                '  xkb_types { include "complete" };\n' +
                '  xkb_compat { include "complete" };\n' +
                '  xkb_symbols { include "pc+' + l.layout + variantPart + '+inet(evdev)" };\n' +
                '  xkb_geometry { include "pc(pc105)" };\n' +
                '};\n';
            const kmPath = '/tmp/opencode/lvosk_km.xkb';
            const outPath = '/tmp/opencode/lvosk_out.xkb';
            GLib.mkdir_with_parents('/tmp/opencode', 0o755);
            GLib.file_set_contents(kmPath, km);
            GLib.spawn_command_line_sync('xkbcomp -xkb ' + kmPath + ' ' + outPath);
            const [ok, bytes] = GLib.file_get_contents(outPath);
            if (!ok) return;
            const text = new TextDecoder().decode(bytes);
            const re = /key <([^>]+)>\s*\{\s*\n\s*type=[^,]*,\s*\n\s*symbols\[Group1\]=\s*\[([^\]]+)\]/g;
            let m;
            while ((m = re.exec(text)) !== null) {
                const symbols = m[2].split(',').map(s => s.trim().replace(/^'+|'+$/g, ''));
                if (symbols.length < 2) continue;
                const base = symbols[0];
                if (!/^[a-zA-Z]$/.test(base)) continue;
                const lower = base.toLowerCase();
                const upper = base.toUpperCase();
                const collected = [];
                for (let i = 1; i < symbols.length; i++) {
                    const sym = symbols[i];
                    if (!sym || sym === 'VoidSymbol' || sym === 'NoSymbol') continue;
                    let ch = this._xkbName(sym);
                    if (!ch) {
                        if (sym.length === 1 && sym !== base && /[^\s]/.test(sym))
                            ch = sym;
                    }
                    if (ch && ch !== base && collected.indexOf(ch) < 0)
                        collected.push(ch);
                }
                if (collected.length) {
                    this._specialChars[lower] = collected;
                    this._specialChars[upper] = collected;
                }
            }
            this._xkbCacheKey = cacheKey;
        } catch (e) {
            console.error('lvosk xkb load error: ' + e);
        }
    }

    _onMonitorsChanged() {
        if (this._destroyed)
            return;
        try {
            this._applyMode();
            this._scheduleRender();
            if (this._visible) {
                const [x, y] = this._targetPosition();
                this._container.set_position(x, y);
            }
            if (this._bar && this._bar.visible)
                this._positionBar();
        } catch (e) {
            console.error('lvosk monitor change error: ' + e);
        }
    }

    _applyMode() {
        const m = this._monitor();
        const theme = this._theme === 'light' ? 'light' : 'dark';
        if (this._floating) {
            const w = this._containerWidth();
            this._height = 400;
            this._container.set_size(w, this._height);
            this._container.style_class = 'lvosk-keyboard floating ' + theme;
        } else {
            // Clamp to the monitor so the whole keyboard always fits,
            // even on rotated/small screens.
            this._height = Math.min(420, Math.max(220, m.height - 24));
            this._container.set_size(m.width, this._height);
            this._container.style_class = 'lvosk-keyboard ' + theme;
        }
        if (this._spyglass) {
            this._spyglass.remove_style_class_name('light');
            this._spyglass.remove_style_class_name('dark');
            this._spyglass.add_style_class_name(theme);
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
        return [m.x, m.y + m.height - this._height];
    }

    _contentWidth() {
        const m = this._monitor();
        const factor = this._effectiveFactor();
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

    _scheduleRender() {
        if (this._renderScheduled)
            return;
        this._renderScheduled = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._renderScheduled = false;
            if (this._destroyed)
                return GLib.SOURCE_REMOVE;
            try { this._render(); } catch (e) { console.error('lvosk render error: ' + e); }
            return GLib.SOURCE_REMOVE;
        });
    }

    _render() {
        this._renderScheduled = false;
        // Drop any in-flight callout so we never paint/position a label while
        // its associated key is being destroyed (crashes GNOME Shell).
        this._hideCallout();
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
        // Stretch/squish the keypad rows so the pad is exactly as tall
        // as the four-row letter grid beside it.
        const rows = this._keypadBox.get_children();
        if (!rows.length)
            return;
        const lettersHeight = this._gridBox.get_preferred_height(-1)[1];
        const gap = 6;
        const totalGap = gap * (rows.length - 1);
        const avail = lettersHeight - totalGap;
        const base = Math.floor(avail / rows.length);
        const rem = avail - base * rows.length;
        rows.forEach((row, i) => {
            const rh = Math.max(36, base + (i < rem ? 1 : 0));
            row.set_height(rh);
            for (const key of row.get_children())
                key.set_height(rh);
        });
    }

    toggleKeypad() {
        if (this._keypadOpen) {
            this._closeKeypadAnimated();
            return;
        }

        this._keypadOpen = true;
        this._shiftMode = 'none';
        if (!this._visible) {
            this._render();
            return;
        }

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._render();

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
            // right edge. Defer to idle so layout (height fitting) completes first.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._gridBox.translation_x = centerOffset;
                this._keypadBox.translation_x = keypadWidth + 24;
                this._keypadBox.opacity = 0;
                const params = {
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                };
                this._gridBox.ease({...params, translation_x: 0});
                this._keypadBox.ease({...params, translation_x: 0, opacity: 255});
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
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
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
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
            return GLib.SOURCE_REMOVE;
        });
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
                orientation: Clutter.Orientation.HORIZONTAL,
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
                const alts = this._specialChars && this._specialChars[spec.label];
                spec.alt = !!(alts && alts.some((ch) => ch !== String(spec.label || '').toUpperCase()));
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
            }
            if (spec.type === 'action' && spec.action === 'ctrl' && this._layerName === 'alternates') {
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
            if (spec.type === 'action' && spec.action === 'shift') {
                return;
            }
            // Letters with XKB special characters use carousel
            if (spec.type === 'char' && this._specialChars && this._specialChars[spec.label]) {
                key._longPressed = true;
                return;
            }
            // Letters never input their (numeric) secondary via long-press.
            if (spec.type === 'char' && /^[a-zA-Z]$/.test(spec.label || ''))
                return;
            if (!spec.secondary)
                return;
            key._longPressed = true;
            this._showCallout(key, spec.secondary);
            this._insertChar(String(spec.secondary));
            if (spec.secondary && String(spec.secondary).length === 1)
                this._previewText += String(spec.secondary);
            this._updateSpyglass();
            this._afterChar();
        });

        key.connect('pressed', () => {
            this._playClick();
            this._showCallout(key, this._calloutText(spec));
            key._carouselTriggered = false;
            if (spec.type === 'char' && this._specialChars && this._specialChars[spec.label]) {
                if (this._carouselTimer) {
                    try { GLib.source_remove(this._carouselTimer); } catch (e) {}
                    this._carouselTimer = 0;
                }
                const specials = this._specialChars[spec.label];
                this._carouselTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                    this._carouselTimer = 0;
                    key._carouselTriggered = true;
                    this._carouselTriggered = true;
                    this._showCarousel(key, specials);
                    return GLib.SOURCE_REMOVE;
                });
            }
            if (spec.type === 'action' && spec.action === 'shift') {
                if (this._shiftHoldSource) {
                    try { GLib.source_remove(this._shiftHoldSource); } catch (e) {}
                    this._shiftHoldSource = 0;
                }
                this._shiftHoldTriggered = false;
                this._shiftHoldSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                    this._shiftHoldSource = 0;
                    this._shiftHoldTriggered = true;
                    this._layerName = 'accents';
                    this._shiftMode = 'none';
                    this._scheduleRender();
                    return GLib.SOURCE_REMOVE;
                });
            }
            if (repeatable) {
                if (spec.type === 'char' && spec.label === ' ') {
                    this._input.sendKeyval(Clutter.KEY_space);
                    this._previewText += ' ';
                    this._updateSpyglass();
                } else if (spec.type === 'action')
                    this._performAction(spec, key);
                this._startRepeat(spec, key);
            } else if (spec.type === 'action' && spec.action !== 'shift') {
                this._performAction(spec, key);
            }
            // char keys handled on release
        });

        key.connect('released', () => {
            this._hideCallout();
            this._stopRepeat();
            if (this._carouselTimer) {
                try { GLib.source_remove(this._carouselTimer); } catch (e) {}
                this._carouselTimer = 0;
            }
            if (key._carouselTriggered) {
                key._carouselTriggered = false;
                this._carouselTriggered = false;
                return;
            }
            if (repeatable)
                return;
            if (spec.type === 'action') {
                if (spec.action === 'shift') {
                    if (this._shiftHoldSource) {
                        try { GLib.source_remove(this._shiftHoldSource); } catch (e) {}
                        this._shiftHoldSource = 0;
                    }
                    if (this._shiftHoldTriggered) {
                        this._shiftHoldTriggered = false;
                        return; // 2s hold already switched to symbols
                    }
                    this._handleShiftTap();
                    this._scheduleRender();
                }
                return;
            }
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
                if (this._previewText.length > 0)
                    this._previewText = this._previewText.slice(0, -1);
                this._updateSpyglass();
                break;
            case 'enter':
                this._input.sendKeyval(Clutter.KEY_Return);
                this._previewText += '\n';
                this._updateSpyglass();
                break;
            case 'left':
                this._input.sendKeyval(Clutter.KEY_Left);
                break;
            case 'right':
                this._input.sendKeyval(Clutter.KEY_Right);
                break;
            case 'shift':
                this._handleShiftTap();
                this._scheduleRender();
                break;
            case 'ctrl':
                this._ctrlSticky = !this._ctrlSticky;
                this._scheduleRender();
                break;
            case 'symbols':
                this._layerName = 'symbols';
                this._scheduleRender();
                break;
            case 'abc':
                this._layerName = this._shiftMode === 'none' ? 'default' : 'shift';
                this._scheduleRender();
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
        // Single tap toggles shift on/off without any timing cooldown.
        if (this._shiftMode === 'locked') {
            this._shiftMode = 'none';
            this._layerName = 'default';
        } else if (this._shiftMode === 'latched') {
            this._shiftMode = 'none';
            this._layerName = 'default';
        } else {
            this._shiftMode = 'latched';
            this._layerName = 'shift';
        }
        this._lastShiftTap = 0;
    }

    _handleShiftLock() {
        // Caps-lock style lock, triggered by long-press so a quick tap can
        // always turn shift off immediately (no double-tap cooldown).
        if (this._shiftMode === 'locked') {
            this._shiftMode = 'none';
            this._layerName = 'default';
        } else {
            this._shiftMode = 'locked';
            this._layerName = 'shift';
        }
        this._lastShiftTap = 0;
    }

    _performChar(spec, key) {
        let ch = spec.label;
        if (this._shiftMode !== 'none' && /[a-z]/.test(ch))
            ch = ch.toUpperCase();
        // ctrl sticky
        if (this._ctrlSticky) {
            this._input.sendCtrlCombo(this._charToKeyval(ch));
            this._ctrlSticky = false;
            this._scheduleRender();
        } else {
            this._insertChar(ch);
        }
        if (ch && ch.length === 1) {
            this._previewText += ch;
            this._updateSpyglass();
        }
        // one-shot shift revert
        if (this._shiftMode === 'latched') {
            this._shiftMode = 'none';
            this._layerName = 'default';
            this._lastShiftTap = 0;
            this._scheduleRender();
        }
        // secondary? no, primary only
    }

    _charToKeyval(ch) {
        // Direct unicode keysym (X11 convention: 0x01000000 | codepoint).
        const code = ch.charCodeAt(0);
        if (code > 127) {
            return 0x01000000 | code;
        }
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
        if (code >= 97 && code <= 122)
            return Clutter.KEY_a + (code - 97);
        if (code >= 65 && code <= 90)
            return Clutter.KEY_A + (code - 65);
        if (code >= 48 && code <= 57)
            return Clutter.KEY_0 + (code - 48);
        return 0;
    }

    _insertChar(ch) {
        if (!ch) return;
        ch = String(ch);
        if (ch.length !== 1) return;
        const code = ch.charCodeAt(0);
        try {
            if (Main.inputMethod && typeof Main.inputMethod.commitString === 'function') {
                Main.inputMethod.commitString(ch);
                return;
            }
        } catch (e) {}
        if (code > 127) {
            try { this._input.sendUnicode(ch); return; } catch (e) {}
        }
        const keyval = this._charToKeyval(ch);
        if (keyval) this._input.sendKeyval(keyval);
    }

    _afterChar() {
        if (this._shiftMode === 'latched') {
            this._shiftMode = 'none';
            this._layerName = 'default';
            this._lastShiftTap = 0;
            this._scheduleRender();
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
        popup.add_style_class_name(this._theme === 'light' ? 'light' : 'dark');
        popup.hide();
        Main.layoutManager.uiGroup.add_child(popup);
        this._callout = popup;
        // Capture the key's position up front, while it is still alive. The
        // deferred positioning below must not touch the (possibly destroyed)
        // key, since that can crash GNOME Shell.
        let kx = 0, ky = 0, kw = 0, kh = 0;
        try {
            [kx, ky] = key.get_transformed_position();
            [kw, kh] = key.get_size();
        } catch (e) {
            // key gone; still try to show popup at origin
        }
        // position after allocation, then show (avoids top-left flash)
        if (this._calloutTimeout) {
            try { GLib.source_remove(this._calloutTimeout); } catch (e) {}
            this._calloutTimeout = 0;
        }
        this._calloutTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            this._calloutTimeout = 0;
            try {
                const [pw, ph] = popup.get_size();
                const cx = kx + kw / 2 - pw / 2;
                const cy = ky - ph - 12;
                popup.set_position(Math.round(cx), Math.round(cy));
                if (popup) popup.show();
            } catch (e) {}
            return GLib.SOURCE_REMOVE;
        });
    }

    _hideCallout() {
        if (this._calloutTimeout) {
            try { GLib.source_remove(this._calloutTimeout); } catch (e) {}
            this._calloutTimeout = 0;
        }
        if (this._callout) {
            try { this._callout.destroy(); } catch (e) {}
            this._callout = null;
        }
    }

    _showCarousel(key, chars) {
        this._hideCarousel();
        if (!chars || !chars.length) return;
        this._carouselHeld = true;
        this._carouselActiveKey = null;
        this._carouselFromKey = key;
        const box = new St.BoxLayout({
            style_class: 'lvosk-carousel',
            orientation: Clutter.Orientation.HORIZONTAL,
        });
        this._carouselKeys = [];
        chars.forEach((ch) => {
            const btn = new St.Button({style_class: 'lvosk-carousel-key', reactive: true});
            const label = new St.Label({text: String(ch), style_class: 'key-label'});
            btn.set_child(label);
            btn._carouselChar = String(ch);
            btn.connect('button-press-event', () => {
                this._insertChar(btn._carouselChar);
                this._previewText += btn._carouselChar;
                this._updateSpyglass();
                if (this._carouselActiveKey && this._carouselActiveKey !== btn) {
                    try { this._carouselActiveKey.remove_style_pseudo_class('hover'); } catch (e) {}
                }
                try { btn.add_style_pseudo_class('hover'); } catch (e) {}
                this._carouselActiveKey = btn;
                return Clutter.EVENT_STOP;
            });
            btn.connect('button-release-event', () => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    this._hideCarousel();
                    return GLib.SOURCE_REMOVE;
                });
                return Clutter.EVENT_STOP;
            });
            btn.connect('touch-event', (actor, event) => {
                if (event.type() === Clutter.EventType.TOUCH_BEGIN) {
                    this._insertChar(btn._carouselChar);
                    this._previewText += btn._carouselChar;
                    this._updateSpyglass();
                    if (this._carouselActiveKey && this._carouselActiveKey !== btn) {
                        try { this._carouselActiveKey.remove_style_pseudo_class('hover'); } catch (e) {}
                    }
                    try { btn.add_style_pseudo_class('hover'); } catch (e) {}
                    this._carouselActiveKey = btn;
                    return Clutter.EVENT_STOP;
                } else if (event.type() === Clutter.EventType.TOUCH_END) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                        this._hideCarousel();
                        return GLib.SOURCE_REMOVE;
                    });
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            btn.connect('enter-event', () => {
                if (this._carouselActiveKey && this._carouselActiveKey !== btn) {
                    try { this._carouselActiveKey.remove_style_pseudo_class('hover'); } catch (e) {}
                }
                try { btn.add_style_pseudo_class('hover'); } catch (e) {}
                this._carouselActiveKey = btn;
                // Do not auto-insert on hover; only explicit press/touch inserts.
                return Clutter.EVENT_PROPAGATE;
            });
            btn.connect('leave-event', () => {
                try { btn.remove_style_pseudo_class('hover'); } catch (e) {}
                if (this._carouselActiveKey === btn)
                    this._carouselActiveKey = null;
                return Clutter.EVENT_PROPAGATE;
            });
            this._carouselKeys.push(btn);
            box.add_child(btn);
        });
        Main.layoutManager.uiGroup.add_child(box);
        this._carousel = box;

        // Position above the key after allocation.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            try {
                let kx = 0, ky = 0, kw = 0, kh = 0;
                [kx, ky] = key.get_transformed_position();
                [kw, kh] = key.get_size();
                const [bw, bh] = box.get_size();
                const m = this._monitor();
                let cx = kx + kw / 2 - bw / 2;
                if (cx < m.x + 8) cx = m.x + 8;
                if (cx + bw > m.x + m.width - 8) cx = m.x + m.width - bw - 8;
                const cy = ky - bh - 8;
                box.set_position(Math.round(cx), Math.round(cy));
            } catch (e) {}
            return GLib.SOURCE_REMOVE;
        });

        // Keep carousel open until a key in it is pressed/released or tapped.
    }

    _hideCarousel() {
        this._carouselHeld = false;
        if (this._carouselActiveKey) {
            try { this._carouselActiveKey.remove_style_pseudo_class('hover'); } catch (e) {}
            this._carouselActiveKey = null;
        }
        if (this._carousel) {
            try { this._carousel.destroy(); } catch (e) {}
            this._carousel = null;
        }
        this._carouselKeys = [];
    }

    _updateSpyglass() {
        const im = Main.inputMethod;
        let text = null;
        let cursor = null;
        if (im) {
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
            if (this._previewBar) {
                this._previewBar.text = '';
                this._previewBar.hide();
            }
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
        if (this._previewBar) {
            this._previewBar.text = display;
            this._previewBar.show();
        }
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

    _buildBar() {
        this._bar = new St.Bin({
            style_class: 'lvosk-panel-pill',
            reactive: true,
            can_focus: false,
            x_expand: false,
            y_expand: false,
            child: new St.Icon({icon_name: 'input-keyboard-symbolic', icon_size: 18, style: 'color: #1c1c1c;'}),
        });
        this._bar.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 1) {
                this.hideBar();
                this.show();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._bar.connect('touch-event', (actor, event) => {
            if (event.type() === Clutter.EventType.TOUCH_BEGIN) {
                this.hideBar();
                this.show();
            }
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.uiGroup.add_child(this._bar);
        this._bar.hide();
    }

    _positionBar() {
        const m = this._monitor();
        const size = 40;
        this._bar.set_size(size, size);
        this._bar.set_position(
            m.x + m.width - size - 16,
            m.y + m.height - size - 64);
    }

    showBar() {
        if (this._visible) return;
        if (this._bar.visible) return;
        this._positionBar();
        this._bar.opacity = 0;
        this._bar.show();
        this._bar.ease({opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        if (this._barTimer) {
            try { GLib.source_remove(this._barTimer); } catch (e) {}
            this._barTimer = 0;
        }
    }

    hideBar() {
        if (this._barTimer) {
            try { GLib.source_remove(this._barTimer); } catch (e) {}
            this._barTimer = 0;
        }
        if (this._bar && this._bar.visible) {
            this._bar.ease({opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => {
                try { this._bar.hide(); this._bar.opacity = 255; } catch (e) {}
            }});
        }
    }

    show() {
        if (this._visible) return;
        this.hideBar();
        this._previewText = '';
        const wantNumpad = this._settings.numpadByDefault === true;
        const changed = wantNumpad !== this._keypadOpen;
        if (changed) {
            this._keypadOpen = wantNumpad;
        }
        this._visible = true;
        this._applyMode();
        const m = this._monitor();
        const [targetX, targetY] = this._targetPosition();
        this._container.set_position(targetX, m.y + m.height); // start below
        this._container.show();
        if (changed) {
            this._render();
        }
        this._container.ease({
            y: targetY,
            duration: SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._startSpyglass();
    }

    hide() {
        this._hideCallout();
        if (this._carouselHeld) this._carouselHeld = false;
        this._hideCarousel();
        if (this._shiftHoldSource) {
            try { GLib.source_remove(this._shiftHoldSource); } catch (e) {}
            this._shiftHoldSource = 0;
        }
        this._shiftHoldTriggered = false;
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

    destroy() {
        this._destroyed = true;
        if (this._monitorsChangedId) {
            try { Main.layoutManager.disconnect(this._monitorsChangedId); } catch (e) {}
            this._monitorsChangedId = 0;
        }
        if (this._shiftHoldSource) {
            try { GLib.source_remove(this._shiftHoldSource); } catch (e) {}
            this._shiftHoldSource = 0;
        }
        try { if (this._interfaceSettings) this._interfaceSettings.run_dispose(); } catch (e) {}
        this._interfaceSettings = null;
        try { this._input.destroy(); } catch (e) {}
        try { if (this._settingsMenu) this._settingsMenu.destroy(); } catch (e) {}
        try { if (this._spyglassTimer) GLib.source_remove(this._spyglassTimer); } catch (e) {}
        try { if (this._spyglassTimer) GLib.source_remove(this._spyglassTimer); } catch (e) {}
        try { if (this._spyglassPosTimer) GLib.source_remove(this._spyglassPosTimer); } catch (e) {}
        try { if (this._calloutTimeout) GLib.source_remove(this._calloutTimeout); } catch (e) {}
        this._calloutTimeout = 0;
        try { if (this._spyglass) this._spyglass.destroy(); } catch (e) {}
        if (this._carouselReleaseId) {
            try { global.stage.disconnect(this._carouselReleaseId); } catch (e) {}
            this._carouselReleaseId = 0;
        }
        try { this._hideCarousel(); } catch (e) {}        try { if (this._barTimer) GLib.source_remove(this._barTimer); } catch (e) {}
        this._barTimer = 0;
        try { if (this._bar) this._bar.destroy(); } catch (e) {}
        try { this._container.destroy(); } catch (e) {}
    }
}