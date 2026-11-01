import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

export class InputController {
    constructor() {
        const backend = Clutter.get_default_backend();
        const seat = backend.get_default_seat();
        this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._modifiers = new Set();
    }

    _now() {
        return Math.floor(GLib.get_monotonic_time() / 1000);
    }

    sendKeyval(keyval) {
        if (!keyval)
            return;
        const ts = this._now();
        // Handle shifted characters by pressing Shift_L around the base keyval.
        const shifted = this._shiftedBase(keyval);
        if (shifted) {
            this._device.notify_keyval(ts, Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
            this._device.notify_keyval(ts, shifted, Clutter.KeyState.PRESSED);
            this._device.notify_keyval(ts, shifted, Clutter.KeyState.RELEASED);
            this._device.notify_keyval(ts, Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
        } else {
            this._device.notify_keyval(ts, keyval, Clutter.KeyState.PRESSED);
            this._device.notify_keyval(ts, keyval, Clutter.KeyState.RELEASED);
        }
    }

    sendKeycode(keycode) {
        if (!keycode)
            return;
        const ts = this._now();
        this._device.notify_key(ts, keycode, Clutter.KeyState.PRESSED);
        this._device.notify_key(ts, keycode, Clutter.KeyState.RELEASED);
    }

    _shiftedBase(keyval) {
        // Returns base keyval if the given keyval is an uppercase/shifted variant
        // that needs Shift held; null otherwise (caller sends directly).
        const map = {
            [Clutter.KEY_A]: Clutter.KEY_a, [Clutter.KEY_B]: Clutter.KEY_b,
            [Clutter.KEY_C]: Clutter.KEY_c, [Clutter.KEY_D]: Clutter.KEY_d,
            [Clutter.KEY_E]: Clutter.KEY_e, [Clutter.KEY_F]: Clutter.KEY_f,
            [Clutter.KEY_G]: Clutter.KEY_g, [Clutter.KEY_H]: Clutter.KEY_h,
            [Clutter.KEY_I]: Clutter.KEY_i, [Clutter.KEY_J]: Clutter.KEY_j,
            [Clutter.KEY_K]: Clutter.KEY_k, [Clutter.KEY_L]: Clutter.KEY_l,
            [Clutter.KEY_M]: Clutter.KEY_m, [Clutter.KEY_N]: Clutter.KEY_n,
            [Clutter.KEY_O]: Clutter.KEY_o, [Clutter.KEY_P]: Clutter.KEY_p,
            [Clutter.KEY_Q]: Clutter.KEY_q, [Clutter.KEY_R]: Clutter.KEY_r,
            [Clutter.KEY_S]: Clutter.KEY_s, [Clutter.KEY_T]: Clutter.KEY_t,
            [Clutter.KEY_U]: Clutter.KEY_u, [Clutter.KEY_V]: Clutter.KEY_v,
            [Clutter.KEY_W]: Clutter.KEY_w, [Clutter.KEY_X]: Clutter.KEY_x,
            [Clutter.KEY_Y]: Clutter.KEY_y, [Clutter.KEY_Z]: Clutter.KEY_z,
            [Clutter.KEY_exclam]: Clutter.KEY_1, [Clutter.KEY_question]: Clutter.KEY_slash,
            [Clutter.KEY_quotedbl]: Clutter.KEY_apostrophe,
            [Clutter.KEY_colon]: Clutter.KEY_semicolon,
        };
        return map[keyval] || null;
    }

    sendCtrlCombo(keyval) {
        const ts = this._now();
        this._device.notify_keyval(ts, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        this._device.notify_keyval(ts, keyval, Clutter.KeyState.PRESSED);
        this._device.notify_keyval(ts, keyval, Clutter.KeyState.RELEASED);
        this._device.notify_keyval(ts, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    }

    sendSuperH() {
        const ts = this._now();
        this._device.notify_keyval(ts, Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
        this._device.notify_keyval(ts, Clutter.KEY_h, Clutter.KeyState.PRESSED);
        this._device.notify_keyval(ts, Clutter.KEY_h, Clutter.KeyState.RELEASED);
        this._device.notify_keyval(ts, Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    }

    destroy() {
        try { this._device.destroy(); } catch (e) {}
        this._device = null;
    }
}