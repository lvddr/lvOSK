let _kb = null;
let _saved = null;
let _a11ySettings = null;
let _savedScreenKeyboard = null;

function _toggle() {
    if (!_kb) return;
    if (_kb._visible) _kb.hide(); else _kb.show();
}

function _hideGnomeKeyboard() {
    try {
        if (Main.keyboard && Main.keyboard.keyboardActor)
            Main.keyboard.keyboardActor.visible = false;
    } catch (e) {}
}

export function enable() {
    _kb = new KeyboardUI();

    try {
        const Keyboard = KeyboardModule.Keyboard;
        _saved = {
            open: Keyboard.prototype.open,
            _open: Keyboard.prototype._open,
            close: Keyboard.prototype.close,
            _close: Keyboard.prototype._close,
            mgrOpen: Main.keyboard ? Main.keyboard.open : null,
            mgrClose: Main.keyboard ? Main.keyboard.close : null,
            imChangedIds: [],
            touchHandlerId: null,
        };

        Keyboard.prototype.open = function () {
            if (_kb && _kb.autoShow) _kb.show();
        };
        Keyboard.prototype._open = function () {
            if (_kb && _kb.autoShow) _kb.show();
        };
        Keyboard.prototype.close = function () {
            if (_kb && !_kb.settingsMenuOpen) _kb.hide();
        };
        Keyboard.prototype._close = function () {
            if (_kb && !_kb.settingsMenuOpen) _kb.hide();
        };

        if (Main.keyboard) {
            Main.keyboard.open = (monitor) => {
                try { Main.layoutManager.keyboardIndex = monitor; } catch (e) {}
                if (_kb && _kb.autoShow) _kb.show();
            };
            Main.keyboard.close = () => {
                if (_kb && !_kb.settingsMenuOpen) _kb.hide();
            };
            _hideGnomeKeyboard();
        }

        // Touch-triggered floating button: show on any touchscreen tap.
        _saved.touchHandlerId = global.stage.connect('captured-event', (actor, event) => {
            try {
                if (event.type() === Clutter.EventType.TOUCH_BEGIN) {
                    if (_kb) _kb.showBar();
                } else if (event.type() === Clutter.EventType.MOTION || event.type() === Clutter.EventType.BUTTON_PRESS) {
                    if (_kb) _kb.hideBar();
                }
            } catch (e) {}
            return Clutter.EVENT_PROPAGATE;
        });

        if (Main.inputMethod) {
            const im = Main.inputMethod;
            const variants = ['current-focus', '_current-focus', '_currentFocus', 'currentFocus'];
            for (const v of variants) {
                try {
                    const id = im.connect('notify::' + v, () => {
                        try {
                            const focused = im.currentFocus || im._currentFocus;
                            if (focused) {
                                if (_kb && _kb.autoShow) _kb.show();
                            } else {
                                if (_kb && !_kb.settingsMenuOpen) {
                                    let a = global.stage.key_focus;
                                    let onOsk = false;
                                    while (a) {
                                        if (a === _kb._container) { onOsk = true; break; }
                                        a = a.get_parent();
                                    }
                                    if (!onOsk) _kb.hide();
                                }
                            }
                        } catch (e) {}
                    });
                    _saved.imChangedIds.push(id);
                } catch (e) {}
            }
        }

        _a11ySettings = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.applications'});
        _savedScreenKeyboard = _a11ySettings.get_boolean('screen-keyboard-enabled');
        if (!_savedScreenKeyboard)
            _a11ySettings.set_boolean('screen-keyboard-enabled', true);
        _hideGnomeKeyboard();
    } catch (e) {
        console.error('lvosk hook error: ' + e);
    }
}

export function disable() {
    try {
        if (_saved) {
            const Keyboard = KeyboardModule.Keyboard;
            Keyboard.prototype.open = _saved.open;
            Keyboard.prototype._open = _saved._open;
            Keyboard.prototype.close = _saved.close;
            Keyboard.prototype._close = _saved._close;
            if (Main.keyboard) {
                if (_saved.mgrOpen) Main.keyboard.open = _saved.mgrOpen;
                if (_saved.mgrClose) Main.keyboard.close = _saved.mgrClose;
                try { if (Main.keyboard.keyboardActor) Main.keyboard.keyboardActor.visible = true; } catch (e) {}
            }
            if (Main.inputMethod && _saved.imChangedIds) {
                for (const id of _saved.imChangedIds) {
                    try { Main.inputMethod.disconnect(id); } catch (e) {}
                }
            }
            if (_saved.touchHandlerId) {
                try { global.stage.disconnect(_saved.touchHandlerId); } catch (e) {}
            }
        }
    } catch (e) {
        console.error('lvosk unhook error: ' + e);
    }
    _saved = null;

    try {
        if (_a11ySettings && _savedScreenKeyboard === false)
            _a11ySettings.set_boolean('screen-keyboard-enabled', false);
    } catch (e) {
        console.error('lvosk setting restore error: ' + e);
    }
    _a11ySettings = null;
    _savedScreenKeyboard = null;

    if (_kb) {
        _kb.destroy();
        _kb = null;
    }
}
