import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as KeyboardModule from 'resource:///org/gnome/shell/ui/keyboard.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const Keyboard = KeyboardModule.Keyboard;

/* ---------- Key container (replicates GNOME's internal KeyContainer) ---------- */
const Win11KeyContainer = GObject.registerClass(
class Win11KeyContainer extends St.Widget {
    _init() {
        const gridLayout = new Clutter.GridLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            column_homogeneous: true,
            row_homogeneous: true,
        });
        super._init({
            layout_manager: gridLayout,
            x_expand: true,
            y_expand: true,
        });
        this._gridLayout = gridLayout;
        this._nRows = 0;
        this._currentCol = 0;
        this._maxCols = 0;
    }

    appendRow() {
        this._nRows++;
        this._currentCol = 0;
    }

    appendKey(key, width = 1, height = 1, leftOffset = 0) {
        const left = this._currentCol + leftOffset;
        const top = this._nRows;
        this._gridLayout.attach(key,
            left * 2, top * 2,
            width * 2, height * 2);

        this._currentCol += leftOffset + width;
        this._maxCols = Math.max(this._currentCol, this._maxCols);
    }

    getRatio() {
        return [this._maxCols, this._nRows];
    }
});

/* ---------- Key (replicates GNOME's Key with a secondary/top-left label) ---------- */
const Win11Key = GObject.registerClass({
    Signals: {
        'long-press': {},
        'pressed': {},
        'released': {},
        'keyval': {param_types: [GObject.TYPE_UINT]},
        'commit': {param_types: [GObject.TYPE_STRING]},
    },
}, class Win11Key extends St.BoxLayout {
    _init(params, extendedKeys = []) {
        const {label, iconName, commitString, keyval, hasAction, secondary} =
            {keyval: 0, ...params};

        super._init({style_class: 'key-container'});

        this._secondary = secondary || null;
        this._keyval = parseInt(keyval, 16) || 0;
        this.keyButton = this._makeKey(commitString, label, iconName, this._secondary);

        this.add_child(this.keyButton);
        this.connect('destroy', this._onDestroy.bind(this));

        this._extendedKeys = extendedKeys || [];
        this._extendedKeyboard = null;
        this._pressTimeoutId = 0;
        this._capturedPress = false;
        this._hasAction = !!hasAction;
        this._touchPressSlot = null;
        this._pressed = false;
    }

    get iconName() {
        return this._icon ? this._icon.icon_name : null;
    }

    set iconName(value) {
        if (this._icon)
            this._icon.icon_name = value;
    }

    _onDestroy() {
        if (this._boxPointer) {
            this._boxPointer.destroy();
            this._boxPointer = null;
        }
        this.cancel();
    }

    _press(button) {
        if (button === this.keyButton) {
            this._pressTimeoutId = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT,
                250,
                () => {
                    this._pressTimeoutId = 0;
                    this.emit('long-press');

                    if (this._extendedKeys && this._extendedKeys.length > 0) {
                        this._touchPressSlot = null;
                        // extended popup is best-effort; skip if BoxPointer unavailable
                    }
                });
        }
        this.emit('pressed');
        this._pressed = true;
    }

    _release(button, commitString) {
        if (this._pressTimeoutId !== 0) {
            GLib.source_remove(this._pressTimeoutId);
            this._pressTimeoutId = 0;
        }

        if (this._pressed) {
            if (this._keyval && button === this.keyButton)
                this.emit('keyval', this._keyval);
            else if (commitString)
                this.emit('commit', commitString);
            else if (!this._hasAction)
                console.error('Need keyval, commitString or an action');
        }

        this.emit('released');
        this._pressed = false;
    }

    cancel() {
        if (this._pressTimeoutId !== 0) {
            GLib.source_remove(this._pressTimeoutId);
            this._pressTimeoutId = 0;
        }
        this._touchPressSlot = null;
        if (this.keyButton)
            this.keyButton.set_hover(false);
    }

    _makeKey(commitString, label, icon, secondary) {
        const button = new St.Button({
            style_class: 'keyboard-key',
            x_expand: true,
        });

        if (icon) {
            const content = new Clutter.Actor({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
            });
            const iconActor = new St.Icon({icon_name: icon});
            iconActor.x_align = Clutter.ActorAlign.CENTER;
            iconActor.y_align = Clutter.ActorAlign.CENTER;
            content.add_child(iconActor);
            this._icon = iconActor;

            if (secondary) {
                const sec = new St.Label({text: secondary, style_class: 'key-secondary'});
                sec.x_align = Clutter.ActorAlign.START;
                sec.y_align = Clutter.ActorAlign.START;
                sec.set_margin_top(2);
                sec.set_margin_left(4);
                content.add_child(sec);
            }
            button.set_child(content);
        } else {
            const content = new Clutter.Actor({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
            });
            const mainLabel = new St.Label({
                text: label || commitString || '',
                style_class: 'key-label',
            });
            mainLabel.x_align = Clutter.ActorAlign.CENTER;
            mainLabel.y_align = Clutter.ActorAlign.CENTER;
            content.add_child(mainLabel);

            if (secondary) {
                const sec = new St.Label({text: secondary, style_class: 'key-secondary'});
                sec.x_align = Clutter.ActorAlign.START;
                sec.y_align = Clutter.ActorAlign.START;
                sec.set_margin_top(2);
                sec.set_margin_left(4);
                content.add_child(sec);
            }
            button.set_child(content);
        }

        button.connect('button-press-event', () => {
            this._press(button, commitString);
            button.add_style_pseudo_class('active');
            return Clutter.EVENT_STOP;
        });
        button.connect('button-release-event', () => {
            this._release(button, commitString);
            button.remove_style_pseudo_class('active');
            return Clutter.EVENT_STOP;
        });
        button.connect('touch-event', (actor, event) => {
            const slot = event.get_event_sequence().get_slot();

            if (!this._touchPressSlot &&
                event.type() === Clutter.EventType.TOUCH_BEGIN) {
                this._touchPressSlot = slot;
                this._press(button, commitString);
                button.add_style_pseudo_class('active');
            } else if (event.type() === Clutter.EventType.TOUCH_END) {
                if (!this._touchPressSlot ||
                    this._touchPressSlot === slot) {
                    this._release(button, commitString);
                    button.remove_style_pseudo_class('active');
                }
                if (this._touchPressSlot === slot)
                    this._touchPressSlot = null;
            }
            return Clutter.EVENT_STOP;
        });

        return button;
    }

    setLatched(latched) {
        if (latched)
            this.keyButton.add_style_pseudo_class('latched');
        else
            this.keyButton.remove_style_pseudo_class('latched');
    }
});

/* ---------- Save originals ---------- */
const origSetupKeyboard = Keyboard.prototype._setupKeyboard;
const origUpdateLayout = Keyboard.prototype._updateLayout;
const origAddRowKeys = Keyboard.prototype._addRowKeys;

/* ---------- Custom layout builder ---------- */
function buildRows() {
    const letters = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
    const nums = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

    const defaultTop = letters.map((ch, idx) => ({
        strings: [ch],
        secondary: nums[idx],
    }));
    defaultTop.push({action: 'delete', iconName: 'osk-delete-symbolic', width: 1.5});

    const defaultRows = [
        defaultTop,
        [
            {leftOffset: 0.5, strings: ['a', 'à', 'á', 'â', 'ä', 'æ', 'ã', 'å', 'ā']},
            {strings: ['s', 'ß']},
            {strings: ['d']},
            {strings: ['f']},
            {strings: ['g']},
            {strings: ['h']},
            {strings: ['j']},
            {strings: ['k']},
            {strings: ['l']},
            {iconName: 'osk-enter-symbolic', keyval: '0xff0d', width: 2},
        ],
        [
            {action: 'levelSwitch', iconName: 'osk-shift-symbolic', level: 'shift'},
            {strings: ['z']},
            {strings: ['x']},
            {strings: ['c', 'ç']},
            {strings: ['v']},
            {strings: ['b']},
            {strings: ['n', 'ñ']},
            {strings: ['m']},
            {strings: [',']},
            {strings: ['.']},
            {strings: ['?']},
            {action: 'levelSwitch', iconName: 'osk-shift-symbolic', level: 'shift', width: 1.5},
        ],
        [
            {action: 'levelSwitch', label: '&123', level: 'opt', width: 1.5},
            {action: 'modifier', keyval: '0xffe3', label: 'Ctrl', width: 1.2},
            {action: 'mic', iconName: 'audio-input-microphone-symbolic', width: 1.2},
            {strings: [' '], width: 5},
            {keyval: '0xff51', iconName: 'go-previous-symbolic', width: 1.2},
            {keyval: '0xff53', iconName: 'go-next-symbolic', width: 1.2},
        ],
    ];

    const shiftTop = letters.map((ch) => ({strings: [ch.toUpperCase()]}));
    shiftTop.push({action: 'delete', iconName: 'osk-delete-symbolic', width: 1.5});

    const shiftRows = [
        shiftTop,
        [
            {leftOffset: 0.5, strings: ['A', 'À', 'Á', 'Â', 'Ä', 'Æ', 'Ã', 'Å', 'Ā']},
            {strings: ['S', 'ẞ']},
            {strings: ['D']},
            {strings: ['F']},
            {strings: ['G']},
            {strings: ['H']},
            {strings: ['J']},
            {strings: ['K']},
            {strings: ['L']},
            {iconName: 'osk-enter-symbolic', keyval: '0xff0d', width: 2},
        ],
        [
            {action: 'levelSwitch', iconName: 'osk-shift-symbolic', level: 'default'},
            {strings: ['Z']},
            {strings: ['X']},
            {strings: ['C', 'Ç']},
            {strings: ['V']},
            {strings: ['B']},
            {strings: ['N', 'Ñ']},
            {strings: ['M']},
            {strings: [',']},
            {strings: ['.']},
            {strings: ['?']},
            {action: 'levelSwitch', iconName: 'osk-shift-symbolic', level: 'default', width: 1.5},
        ],
        [
            {action: 'levelSwitch', label: '&123', level: 'opt', width: 1.5},
            {action: 'modifier', keyval: '0xffe3', label: 'Ctrl', width: 1.2},
            {action: 'mic', iconName: 'audio-input-microphone-symbolic', width: 1.2},
            {strings: [' '], width: 5},
            {keyval: '0xff51', iconName: 'go-previous-symbolic', width: 1.2},
            {keyval: '0xff53', iconName: 'go-next-symbolic', width: 1.2},
        ],
    ];

    const optRow1 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => ({
        strings: [d],
    }));
    optRow1.push({action: 'delete', iconName: 'osk-delete-symbolic', width: 1.5});

    const optRows = [
        optRow1,
        [
            {leftOffset: 0.5, strings: ['@']},
            {strings: ['#']},
            {strings: ['$']},
            {strings: ['%']},
            {strings: ['&']},
            {strings: ['-']},
            {strings: ['+']},
            {strings: ['(']},
            {strings: [')']},
            {iconName: 'osk-enter-symbolic', keyval: '0xff0d', width: 2},
        ],
        [
            {action: 'levelSwitch', label: 'ABC', level: 'default', width: 1.5},
            {strings: ['*']},
            {strings: ['"']},
            {strings: ["'"]},
            {strings: [':']},
            {strings: [';']},
            {strings: ['!']},
            {strings: ['?']},
            {action: 'levelSwitch', label: 'ABC', level: 'default', width: 3},
        ],
        [
            {action: 'levelSwitch', label: 'ABC', level: 'default', width: 1.5},
            {strings: ['_']},
            {strings: ['/']},
            {strings: [' '], width: 3},
            {strings: [',']},
            {strings: ['.']},
            {action: 'emoji', iconName: 'osk-emoji-picker-symbolic'},
            {action: 'languageMenu', iconName: 'osk-layout-symbolic'},
            {action: 'hide', iconName: 'osk-hide-symbolic'},
        ],
    ];

    return {defaultRows, shiftRows, optRows};
}

/* ---------- Override _updateLayout ---------- */
Keyboard.prototype._updateLayout = function(groupName, purpose) {
    const isTextPurpose =
        purpose === Clutter.InputContentPurpose.NORMAL ||
        purpose === Clutter.InputContentPurpose.ALPHA ||
        purpose === Clutter.InputContentPurpose.PASSWORD ||
        purpose === Clutter.InputContentPurpose.TERMINAL;

    if (!isTextPurpose) {
        return origUpdateLayout.call(this, groupName, purpose);
    }

    const {defaultRows, shiftRows, optRows} = buildRows();

    const layers = {};
    const layout = new Clutter.Actor({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
    });

    this._modifiers.clear();
    this._modifierKeys.clear();

    const levels = [
        {level: 'default', mode: 'default', rows: defaultRows},
        {level: 'shift', mode: 'latched', rows: shiftRows},
        {level: 'opt', mode: 'locked', rows: optRows},
        {level: 'opt+shift', mode: 'locked', rows: optRows},
    ];

    levels.forEach(({level, mode, rows}) => {
        const levelLayout = new Win11KeyContainer();
        levelLayout.shiftKeys = [];
        levelLayout.mode = mode;

        rows.forEach((row) => {
            levelLayout.appendRow();
            this._addRowKeys(row, levelLayout, true);
        });

        layers[level] = levelLayout;
        layout.add_child(levelLayout);
        levelLayout.hide();
    });

    this._aspectContainer.add_child(layout);
    this._currentLayout?.destroy();
    this._currentLayout = layout;
    this._layers = layers;
};

/* ---------- Override _addRowKeys ---------- */
Keyboard.prototype._addRowKeys = function(keys, layout, emojiVisible) {
    let accumulatedWidth = 0;
    for (let i = 0; i < keys.length; ++i) {
        const key = keys[i];
        const {strings} = key;
        const commitString = strings?.shift();

        if (key.action === 'emoji' && !emojiVisible) {
            accumulatedWidth = key.width ?? 1;
            continue;
        }

        if (accumulatedWidth > 0) {
            key.width = (key.width ?? 1) + accumulatedWidth;
            accumulatedWidth = 0;
        }

        const button = new Win11Key({
            commitString,
            label: key.label,
            iconName: key.iconName,
            keyval: key.keyval,
            hasAction: !!key.action,
            secondary: key.secondary,
        }, strings || []);

        if (key.action) {
            button.connect('released', () => {
                if (key.action === 'hide') {
                    this.close(true);
                    this._updateLevelFromHints(true);
                } else if (key.action === 'languageMenu') {
                    this._popupLanguageMenu(button);
                } else if (key.action === 'emoji') {
                    this._toggleEmoji();
                } else if (key.action === 'modifier') {
                    this._toggleModifier(key.keyval);
                } else if (key.action === 'delete') {
                    this._keyboardController.toggleDelete(true);
                    this._keyboardController.toggleDelete(false);
                    this._updateLevelFromHints(true);
                } else if (key.action === 'mic') {
                    // Voice input is not wired in this custom build.
                } else if (!this._longPressed && key.action === 'levelSwitch') {
                    this._setActiveLevel(key.level);
                    this._setLatched(
                        key.level === 1 &&
                            key.iconName === 'osk-caps-lock-symbolic');
                }

                this._longPressed = false;
            });
        } else if (key.keyval) {
            button.connect('keyval', (_actor, keyval) => {
                this._keyboardController.keyvalPress(keyval);
                this._keyboardController.keyvalRelease(keyval);
                this._updateLevelFromHints(true);
            });
        } else {
            button.connect('commit', (_actor, str) => {
                this._keyboardController.commit(str, this._modifiers).then(() => {
                    this._disableAllModifiers();
                    this._updateLevelFromHints(true);
                }).catch(console.error);
            });
        }

        if (key.action === 'levelSwitch' &&
            key.iconName === 'osk-shift-symbolic') {
            layout.shiftKeys.push(button);
            if (key.level === 'shift') {
                button.connect('long-press', () => {
                    this._setActiveLevel(key.level);
                    this._setLatched(true);
                    this._longPressed = true;
                });
            }
        }

        if (key.action === 'delete') {
            button.connect('long-press',
                () => this._keyboardController.toggleDelete(true));
        }

        if (key.action === 'modifier') {
            const modifierKeys = this._modifierKeys.get(key.keyval) ?? [];
            modifierKeys.push(button);
            this._modifierKeys.set(key.keyval, modifierKeys);
        }

        if (key.action || key.keyval)
            button.keyButton.add_style_class_name('default-key');

        layout.appendKey(button, key.width, key.height, key.leftOffset);
    }
};

/* ---------- Header bar ---------- */
Keyboard.prototype._setupKeyboard = function() {
    origSetupKeyboard.call(this);

    const header = new St.BoxLayout({
        style_class: 'win11-keyboard-header',
        x_expand: true,
    });

    const spacer = new St.BoxLayout({x_expand: true});
    header.add_child(spacer);

    const gear = new St.Button({
        style_class: 'win11-header-button',
        child: new St.Icon({icon_name: 'preferences-system-symbolic'}),
    });
    const layoutSwitcher = new St.Button({
        style_class: 'win11-header-button',
        child: new St.Icon({icon_name: 'input-keyboard-symbolic'}),
    });
    const minimize = new St.Button({
        style_class: 'win11-header-button',
        child: new St.Icon({icon_name: 'pan-down-symbolic'}),
    });
    const close = new St.Button({
        style_class: 'win11-header-button',
        child: new St.Icon({icon_name: 'window-close-symbolic'}),
    });

    close.connect('clicked', () => this.close(true));
    minimize.connect('clicked', () => this.close(true));

    header.add_child(gear);
    header.add_child(layoutSwitcher);
    header.add_child(minimize);
    header.add_child(close);

    this.insert_child_at_index(header, 0);
};

/* ---------- Patched method references ---------- */
const patchedSetupKeyboard = Keyboard.prototype._setupKeyboard;
const patchedUpdateLayout = Keyboard.prototype._updateLayout;
const patchedAddRowKeys = Keyboard.prototype._addRowKeys;

/* ---------- Extension lifecycle ---------- */
export default class Win11OskExtension extends Extension {
    enable() {
        Keyboard.prototype._setupKeyboard = patchedSetupKeyboard;
        Keyboard.prototype._updateLayout = patchedUpdateLayout;
        Keyboard.prototype._addRowKeys = patchedAddRowKeys;
    }

    disable() {
        Keyboard.prototype._setupKeyboard = origSetupKeyboard;
        Keyboard.prototype._updateLayout = origUpdateLayout;
        Keyboard.prototype._addRowKeys = origAddRowKeys;
    }
}