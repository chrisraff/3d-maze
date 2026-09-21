import { describe, it, expect, beforeEach } from 'vitest';
import TouchArbiter, { YIELD } from '../js/TouchArbiter.js';

// Stand-in for the canvas: records listeners so tests can fire touches at it.
function stubElement() {
    const listeners = new Map();
    return {
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name) => listeners.delete(name),
        fire: (name, event) => listeners.get(name)?.(event),
        listeners
    };
}

const touchEvent = (touches) => ({
    changedTouches: touches,
    preventDefault: () => {}
});

const touchAt = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });

// Records what each callback was handed, the way the real handlers read it.
function recordingHandler(name, log, { yieldOnMove = false } = {}) {
    const record = (method) => (session, touch) => {
        log.push({ name, method, sessionId: session.id, touch });
        if (method === 'onTouchMove' && yieldOnMove)
            return YIELD;
    };
    return {
        onTouchStart: record('onTouchStart'),
        onTouchMove: record('onTouchMove'),
        onTouchEnd: record('onTouchEnd'),
        onTouchCancel: record('onTouchCancel'),
        onTouchYield: record('onTouchYield'),
        onTouchAdopt: record('onTouchAdopt')
    };
}

let element, arbiter, log;

beforeEach(() => {
    element = stubElement();
    arbiter = new TouchArbiter(element);
    log = [];
});

describe('clear', () => {
    beforeEach(() => {
        arbiter.registerHandler('first', recordingHandler('first', log));
        arbiter.connect();
    });

    // The pause button unlocks mid-drag, and game.js clears the arbiter from
    // the unlock handler. There is no touch to hand over there, so a handler
    // has to be able to find the id on the session - reading it off the touch
    // threw, which aborted the rest of the unlock and stranded the menu.
    it('cancels with no touch, but always with the session', () => {
        element.fire('touchstart', touchEvent([touchAt(7, 200, 300)]));
        log.length = 0;

        arbiter.clear();

        expect(log).toEqual([
            { name: 'first', method: 'onTouchCancel', sessionId: 7, touch: null }
        ]);
    });

    it('drops every session', () => {
        element.fire('touchstart', touchEvent([touchAt(1, 10, 10), touchAt(2, 20, 20)]));

        arbiter.clear();

        expect(arbiter.sessions.size).toBe(0);
        expect(log.filter((entry) => entry.method === 'onTouchCancel')
                  .map((entry) => entry.sessionId)).toEqual([1, 2]);
    });

    it('drops the sessions even when a handler throws', () => {
        arbiter.handlers.get('first').onTouchCancel = () => { throw new Error('boom'); };
        element.fire('touchstart', touchEvent([touchAt(3, 30, 30)]));

        expect(() => arbiter.clear()).toThrow('boom');
        expect(arbiter.sessions.size).toBe(0);
    });

    it('does nothing with no live touches', () => {
        arbiter.clear();
        expect(log).toEqual([]);
    });
});

describe('cancel from the browser', () => {
    it('still carries the touch', () => {
        arbiter.registerHandler('first', recordingHandler('first', log));
        arbiter.connect();

        element.fire('touchstart', touchEvent([touchAt(4, 40, 50)]));
        log.length = 0;
        element.fire('touchcancel', touchEvent([touchAt(4, 40, 50)]));

        expect(log).toHaveLength(1);
        expect(log[0].method).toBe('onTouchCancel');
        expect(log[0].touch.identifier).toBe(4);
        expect(arbiter.sessions.size).toBe(0);
    });
});

describe('yielding', () => {
    // the drag that owns the joystick reaches controls this way
    it('hands the session to the next handler, which keeps the id', () => {
        arbiter.registerHandler('first', recordingHandler('first', log, { yieldOnMove: true }));
        arbiter.registerHandler('second', recordingHandler('second', log));
        arbiter.connect();

        element.fire('touchstart', touchEvent([touchAt(5, 200, 300)]));
        element.fire('touchmove', touchEvent([touchAt(5, 240, 260)]));

        expect(log.map((entry) => `${entry.name}.${entry.method}`)).toEqual([
            'first.onTouchStart', 'first.onTouchMove',
            'first.onTouchYield', 'second.onTouchAdopt'
        ]);

        // and a later clear() cancels on the new owner
        log.length = 0;
        arbiter.clear();
        expect(log).toEqual([
            { name: 'second', method: 'onTouchCancel', sessionId: 5, touch: null }
        ]);
    });
});
