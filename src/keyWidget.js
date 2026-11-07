import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

const _lvoskKeyGType = `LvOSKKey_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

export const LvOSKKey = GObject.registerClass({
    GTypeName: _lvoskKeyGType,
    Signals: {
        'pressed': {},
        'released': {},
        'long-press': {},
    },
}, class LvOSKKey extends St.BoxLayout {
    _init(spec = {}) {
        super._init({style_class: 'key-container', x_expand: true});
        this.spec = spec;
        this._pressed = false;
        this._pressTimeout = 0;
        // Safety net: cancel the long-press timer if the widget is destroyed.
        this.connect('destroy', () => {
            if (this._pressTimeout) {
                try { GLib.source_remove(this._pressTimeout); } catch (e) {}
                this._pressTimeout = 0;
            }
        });
        this._secondaryPos = this._inferSecondaryPos(spec);
        this.button = this._build(spec);
        this.add_child(this.button);
        this.set_width_spec(spec.width || 1);
    }

    set_width_spec(units) {
        // width handled by parent grid; store for layout engine
        this._widthUnits = units;
    }

    get widthUnits() {
        return this._widthUnits || (this.spec.width || 1);
    }

    _inferSecondaryPos(spec) {
        const sec = spec.secondary;
        if (!sec)
            return null;
        if (/^\d$/.test(sec))
            return 'topleft';
        return 'topcenter';
    }

    _build(spec) {
        const btn = new St.Button({
            style_class: 'keyboard-key',
            x_expand: true,
            y_expand: true,
            can_focus: false,
            reactive: true,
        });

        // GridLayout honors each child's alignment, unlike BinLayout which
        // centers everything and made the secondary labels sit on top of the
        // main character.
        const content = new St.Widget({
            layout_manager: new Clutter.GridLayout({
                column_homogeneous: false,
                row_homogeneous: false,
            }),
            x_expand: true,
            y_expand: true,
        });
        const grid = content.layout_manager;

        // Punctuation primaries sit slightly below center so the top-center
        // secondary label has room; everything else stays centered.
        const hasTopCenterSecondary =
            !!spec.secondary && this._secondaryPos !== 'topleft';

        if (spec.icon) {
            const icon = new St.Icon({icon_name: spec.icon, style_class: 'key-icon'});
            icon.x_align = Clutter.ActorAlign.CENTER;
            icon.y_align = Clutter.ActorAlign.CENTER;
            icon.x_expand = true;
            icon.y_expand = true;
            grid.attach(icon, 0, 0, 3, 2);
            this._icon = icon;
        } else {
            const label = new St.Label({text: spec.label || '', style_class: 'key-label'});
            label.x_align = Clutter.ActorAlign.CENTER;
            label.y_align = Clutter.ActorAlign.CENTER;
            label.x_expand = true;
            label.y_expand = true;
            if (hasTopCenterSecondary)
                grid.attach(label, 0, 1, 3, 1);
            else
                grid.attach(label, 0, 0, 3, 2);
            this._label = label;
        }

        // secondary label: digits sit top-left, punctuation top-center
        if (spec.secondary) {
            const sec = new St.Label({text: spec.secondary, style_class: 'key-secondary'});
            sec.y_align = Clutter.ActorAlign.START;
            sec.set_margin_top(2);
            if (this._secondaryPos === 'topleft') {
                sec.x_align = Clutter.ActorAlign.START;
                sec.set_margin_left(6);
                grid.attach(sec, 0, 0, 1, 1);
            } else {
                sec.x_align = Clutter.ActorAlign.CENTER;
                grid.attach(sec, 0, 0, 3, 1);
            }
            this._secondaryLabel = sec;

            const indicator = new St.Label({text: '▴', style_class: 'key-alt-indicator'});
            indicator.x_align = Clutter.ActorAlign.END;
            indicator.y_align = Clutter.ActorAlign.START;
            indicator.set_margin_top(1);
            indicator.set_margin_right(4);
            grid.attach(indicator, 2, 0, 1, 1);
        }

        if (spec.alt) {
            const dot = new St.Label({text: '•', style: 'font-size: 9px; color: #888;'});
            dot.x_align = Clutter.ActorAlign.END;
            dot.y_align = Clutter.ActorAlign.END;
            dot.set_margin_bottom(1);
            dot.set_margin_right(3);
            grid.attach(dot, 2, 1, 1, 1);
            this._altDot = dot;
        }
        btn.set_child(content);

        // latched/active style for modifiers
        if (spec.active)
            btn.add_style_pseudo_class('latched');

        btn.connect('button-press-event', () => {
            this._onPress();
            btn.add_style_pseudo_class('active');
            return Clutter.EVENT_STOP;
        });
        btn.connect('button-release-event', () => {
            this._onRelease();
            btn.remove_style_pseudo_class('active');
            return Clutter.EVENT_STOP;
        });
        btn.connect('touch-event', (actor, event) => {
            const seq = event.get_event_sequence();
            if (event.type() === Clutter.EventType.TOUCH_BEGIN) {
                this._onPress();
                btn.add_style_pseudo_class('active');
            } else if (event.type() === Clutter.EventType.TOUCH_END) {
                this._onRelease();
                btn.remove_style_pseudo_class('active');
            }
            return Clutter.EVENT_STOP;
        });

        return btn;
    }

    _onPress() {
        if (this._pressTimeout)
            GLib.source_remove(this._pressTimeout);
        this._pressTimeout = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 300, () => {
            this._pressTimeout = 0;
            this.emit('long-press');
        });
        this._pressed = true;
        this.emit('pressed');
    }

    _onRelease() {
        if (this._pressTimeout) {
            GLib.source_remove(this._pressTimeout);
            this._pressTimeout = 0;
        }
        if (this._pressed) {
            this._pressed = false;
            this.emit('released');
        }
    }

    cancel() {
        if (this._pressTimeout) {
            GLib.source_remove(this._pressTimeout);
            this._pressTimeout = 0;
        }
        this._pressed = false;
        try { this.button.set_hover(false); } catch (e) {}
    }

    setLatched(latched) {
        if (latched)
            this.button.add_style_pseudo_class('latched');
        else
            this.button.remove_style_pseudo_class('latched');
    }

    setLabel(text) {
        if (this._label)
            this._label.set_text(text);
    }

    vfunc_destroy() {
        // Cancel any pending long-press timer so it cannot fire on a
        // destroyed (and disposed) actor, which would crash GNOME Shell.
        if (this._pressTimeout) {
            try { GLib.source_remove(this._pressTimeout); } catch (e) {}
            this._pressTimeout = 0;
        }
        super.vfunc_destroy();
    }
});