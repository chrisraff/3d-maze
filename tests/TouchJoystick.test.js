import { describe, it, expect, beforeEach } from 'vitest';
import TouchJoystick from '../js/TouchJoystick.js';

// Stand-in for the two divs: enough of an element for the widget's writes.
function stubElement() {
    const classes = new Set();
    return {
        style: {},
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name)
        }
    };
}

// the pixel offsets the widget wrote into a transform
function translationOf(element) {
    const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(element.style.transform);
    return match === null ? null : { x: Number(match[1]), y: Number(match[2]) };
}

const state = (overrides = {}) => ({
    active: true, centerX: 200, centerY: 300, offsetX: 0, offsetY: 0, radius: 100,
    ...overrides
});

let root, knob, joystick;

beforeEach(() => {
    root = stubElement();
    knob = stubElement();
    joystick = new TouchJoystick(root, knob);
});

describe('visibility', () => {
    it('stays hidden while no drag is running', () => {
        joystick.update(state({ active: false }));
        expect(root.classList.contains('visible')).toBe(false);
    });

    it('shows on an active drag and hides when it ends', () => {
        joystick.update(state());
        expect(root.classList.contains('visible')).toBe(true);

        joystick.update(state({ active: false }));
        expect(root.classList.contains('visible')).toBe(false);
    });

    it('hides on a missing state rather than throwing', () => {
        joystick.update(state());
        joystick.update(null);
        expect(root.classList.contains('visible')).toBe(false);
    });

    // touchDOM is null until the controls connect
    it('hides on a zero radius', () => {
        joystick.update(state({ radius: 0 }));
        expect(root.classList.contains('visible')).toBe(false);
    });
});

describe('placement', () => {
    it('centres the ring on the touch that started the drag', () => {
        joystick.update(state({ centerX: 200, centerY: 300, radius: 100 }));

        expect(root.style.width).toBe('200px');
        expect(root.style.height).toBe('200px');
        // the ring is placed by its top left corner
        expect(translationOf(root)).toEqual({ x: 100, y: 200 });
    });

    it('resizes when the viewport changes the full-speed distance', () => {
        joystick.update(state({ radius: 100 }));
        joystick.update(state({ radius: 60 }));

        expect(root.style.width).toBe('120px');
    });
});

describe('knob clamping', () => {
    it('follows the finger inside the ring', () => {
        joystick.update(state({ offsetX: 30, offsetY: -40, radius: 100 }));
        expect(translationOf(knob)).toEqual({ x: 30, y: -40 });
    });

    it('clamps to the ring without turning the drag', () => {
        joystick.update(state({ offsetX: 300, offsetY: -400, radius: 100 }));

        const knobAt = translationOf(knob);
        expect(Math.hypot(knobAt.x, knobAt.y)).toBeCloseTo(100);
        // same direction as the 3:-4 drag that produced it
        expect(knobAt.x).toBeCloseTo(60);
        expect(knobAt.y).toBeCloseTo(-80);
    });

    it('sits on the ring exactly at the full-speed distance', () => {
        joystick.update(state({ offsetX: 0, offsetY: 100, radius: 100 }));
        expect(translationOf(knob)).toEqual({ x: 0, y: 100 });
    });
});
