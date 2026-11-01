const L = (s, sec = null, w = 1) => ({type: 'char', label: s, secondary: sec, width: w});
const A = (action, opts = {}) => ({type: 'action', action, ...opts});

export const LAYOUTS = {
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

export function getLayout(name) {
    return LAYOUTS[name] || LAYOUTS.default;
}

// Keypad layout (phone-style, shown to the right of the letter grid)
const kp = (s, w = 1.0) => ({type: 'char', label: s, width: w});
LAYOUTS.keypad = [
    [kp('1'), kp('2'), kp('3')],
    [kp('4'), kp('5'), kp('6')],
    [kp('7'), kp('8'), kp('9')],
    [kp('*'), kp('0'), kp('#')],
];