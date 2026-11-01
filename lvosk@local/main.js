import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as KeyboardModule from 'resource:///org/gnome/shell/ui/keyboard.js';

// ===== keyWidget.js =====
const _lvoskKeyGType = `LvOSKKey_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
const LvOSKKey = GObject.registerClass({
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
this._secondaryPos = this._inferSecondaryPos(spec);
this.button = this._build(spec);
this.add_child(this.button);
this.set_width_spec(spec.width || 1);
}
set_width_spec(units) {
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
const content = new St.Widget({
layout_manager: new Clutter.GridLayout({
column_homogeneous: false,
row_homogeneous: false,
}),
x_expand: true,
y_expand: true,
});
const grid = content.layout_manager;
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
btn.set_child(content);
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
});
// ===== layouts.js =====
const L = (s, sec = null, w = 1) => ({type: 'char', label: s, secondary: sec, width: w});
const A = (action, opts = {}) => ({type: 'action', action, ...opts});
const LAYOUTS = {
default: [
[
L('q','1'), L('w','2'), L('e','3'), L('r','4'), L('t','5'),
L('y','6'), L('u','7'), L('i','8'), L('o','9'), L('p','0'),
A('backspace', {icon: 'edit-clear-symbolic', width: 1.8}),
],
[
{leftOffset: 0.45},
L('a'), L('s'), L('d'), L('f'), L('g'), L('h'), L('j'), L('k'), L('l'),
L("'", '"', 1.0),
A('enter', {icon: 'go-next-symbolic', width: 1.35, label: '↵'}),
],
[
A('shift', {icon: 'go-up-symbolic', width: 1.0, side: 'left'}),
L('z'), L('x'), L('c'), L('v'), L('b'), L('n'), L('m'),
L(',', ';'), L('.', ':'), L('?', '!'),
A('shift', {icon: 'go-up-symbolic', width: 1.0, side: 'right'}),
],
[
A('symbols', {label: '&123', width: 1.0}),
A('ctrl', {label: 'Ctrl', width: 1.0}),
A('mic', {icon: 'audio-input-microphone-symbolic', width: 1.0}),
L(' ', null, 6.8),
A('left', {icon: 'go-previous-symbolic', width: 1.0}),
A('right', {icon: 'go-next-symbolic', width: 1.0}),
],
],
shift: [
[
L('Q','1'), L('W','2'), L('E','3'), L('R','4'), L('T','5'),
L('Y','6'), L('U','7'), L('I','8'), L('O','9'), L('P','0'),
A('backspace', {icon: 'edit-clear-symbolic', width: 1.8}),
],
[
{leftOffset: 0.45},
L('A'), L('S'), L('D'), L('F'), L('G'), L('H'), L('J'), L('K'), L('L'),
L('"', "'", 1.0),
A('enter', {icon: 'go-next-symbolic', width: 1.35, label: '↵'}),
],
[
A('shift', {icon: 'go-up-symbolic', width: 1.0, side: 'left', active: true}),
L('Z'), L('X'), L('C'), L('V'), L('B'), L('N'), L('M'),
L(';', ','), L(':', '.'), L('!', '?'),
A('shift', {icon: 'go-up-symbolic', width: 1.0, side: 'right', active: true}),
],
[
A('symbols', {label: '&123', width: 1.0}),
A('ctrl', {label: 'Ctrl', width: 1.0}),
A('mic', {icon: 'audio-input-microphone-symbolic', width: 1.0}),
L(' ', null, 6.8),
A('left', {icon: 'go-previous-symbolic', width: 1.0}),
A('right', {icon: 'go-next-symbolic', width: 1.0}),
],
],
symbols: [
[
L('1'), L('2'), L('3'), L('4'), L('5'), L('6'), L('7'), L('8'), L('9'), L('0'),
A('backspace', {icon: 'edit-clear-symbolic', width: 1.8}),
],
[
{leftOffset: 0.45},
L('@'), L('#'), L('$'), L('%'), L('&'), L('-'), L('+'), L('('), L(')'),
A('enter', {icon: 'go-next-symbolic', width: 1.35, label: '↵'}),
],
[
A('abc', {label: 'ABC', width: 1.0}),
L('*'), L('"'), L("'"), L(':'), L(';'), L('!'), L('?'),
A('abc', {label: 'ABC', width: 3.0}),
],
[
A('abc', {label: 'ABC', width: 1.0}),
L('_'), L('/'), L(' ', null, 3.0), L(','), L('.'),
A('emoji', {icon: 'face-smile-symbolic', width: 1.0}),
A('layout', {icon: 'input-keyboard-symbolic', width: 1.0}),
A('hide', {icon: 'window-close-symbolic', width: 1.0}),
],
],
};
function getLayout(name) {
return LAYOUTS[name] || LAYOUTS.default;
}
const kp = (s, w = 1.0) => ({type: 'char', label: s, width: w});
LAYOUTS.keypad = [
[kp('1'), kp('2'), kp('3')],
[kp('4'), kp('5'), kp('6')],
[kp('7'), kp('8'), kp('9')],
[kp('*'), kp('0'), kp('#')],
[{type: 'action', action: 'backspace', icon: 'edit-clear-symbolic', width: 3.0}],
];
// ===== inputController.js =====
class InputController {
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
// ===== keyboardUI.js =====
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
class KeyboardUI {
constructor() {
this._input = new InputController();
this._layerName = 'default';
this._shiftMode = 'none';
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
this._container.set_position(0, 10000);
this._header = this._buildHeader();
this._container.add_child(this._header);
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
this._settingsBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Icon({icon_name: 'emblem-system-symbolic'})});
this._layoutBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Icon({icon_name: 'view-grid-symbolic'})});
this._layoutBtn.connect('clicked', () => this.toggleKeypad());
this._settingsBtn.connect('clicked', () => this._settingsMenu.toggle());
leftGroup.add_child(this._settingsBtn);
leftGroup.add_child(this._layoutBtn);
const center = new St.BoxLayout({x_expand: true});
center.reactive = true;
const rightGroup = new St.BoxLayout({style_class: 'header-right', });
this._dockBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Icon({icon_name: 'window-minimize-symbolic'})});
const closeBtn = new St.Button({style_class: 'lvosk-header-button', child: new St.Icon({icon_name: 'window-close-symbolic'})});
rightGroup.add_child(this._dockBtn);
rightGroup.add_child(closeBtn);
header.add_child(leftGroup);
header.add_child(center);
header.add_child(rightGroup);
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
const groupWidth = lettersWidth + keypadWidth + 36;
const finalLettersX = groupWidth >= container
? 12
: (container - groupWidth) / 2 + 12;
const centerOffset = Math.max(0, (container - lettersWidth) / 2 - finalLettersX);
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
let leftOffset = 0;
const first = row[0];
if (first && first.leftOffset) {
leftOffset = first.leftOffset;
row = row.slice(1);
}
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
key.set_size(Math.round((spec.width || 1) * unit), -1);
this._wireKey(key, spec);
rowBox.add_child(key);
});
box.add_child(rowBox);
});
}
_unitWidth(totalUnits, width, isKeypad) {
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
});
key.connect('released', () => {
this._hideCallout();
this._stopRepeat();
if (repeatable)
return;
if (spec.type === 'action')
return;
if (key._longPressed) {
key._longPressed = false;
return;
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
if (this._ctrlSticky) {
this._input.sendCtrlCombo(this._charToKeyval(ch));
this._ctrlSticky = false;
this._render();
} else {
this._input.sendKeyval(this._charToKeyval(ch));
}
if (this._shiftMode === 'latched') {
this._shiftMode = 'none';
this._layerName = 'default';
this._render();
}
}
_charToKeyval(ch) {
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
this._container.set_position(targetX, m.y + m.height);
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
// ===== impl.js =====
let _kb = null;
let _indicator = null;
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
function enable() {
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
_saved.touchHandlerId = global.stage.connect('captured-event', (actor, event) => {
try {
const t = event.type();
if (t === Clutter.EventType.TOUCH_BEGIN) {
if (_indicator) _indicator.show();
} else if (t === Clutter.EventType.BUTTON_PRESS || t === Clutter.EventType.MOTION) {
if (_indicator && _indicator.visible) {
let onPill = false;
let a = actor;
while (a) {
if (a === _indicator) { onPill = true; break; }
a = a.get_parent();
}
if (!onPill) _indicator.hide();
}
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
const _origShow = _kb.show.bind(_kb);
_kb.show = function () {
if (_indicator) _indicator.hide();
return _origShow();
};
_indicator = new St.Button({
style_class: 'lvosk-panel-pill',
can_focus: false,
reactive: true,
child: new St.Icon({icon_name: 'input-keyboard-symbolic', icon_size: 18, style: 'color: #1c1c1c;'}),
});
_indicator.connect('clicked', () => {
_toggle();
});
Main.panel._centerBox.add_child(_indicator);
_indicator.hide();
}
function disable() {
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
if (_indicator) {
try { _indicator.get_parent().remove_child(_indicator); } catch (e) {}
try { _indicator.destroy(); } catch (e) {}
_indicator = null;
}
if (_kb) {
_kb.destroy();
_kb = null;
}
}

export { enable, disable };
