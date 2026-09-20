import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TutorialManager from '../js/TutorialManager.js';

// Minimal stand-in for the step markup: an element per type/step pair, looked
// up by the same attribute selector TutorialManager builds.
function stubDom(steps) {
    const elements = new Map();
    for (const [type, count] of Object.entries(steps)) {
        for (let step = 0; step < count; step++) {
            elements.set(`[tutorial-type="${type}"][tutorial-step="${step}"]`,
                         { style: { display: 'none' } });
        }
    }
    vi.stubGlobal('document', {
        querySelector: (selector) => elements.get(selector) ?? null,
        querySelectorAll: () => [...elements.values()]
    });
    return elements;
}

const visible = (elements, type, step) =>
    elements.get(`[tutorial-type="${type}"][tutorial-step="${step}"]`).style.display === '';

let elements;

beforeEach(() => {
    vi.useFakeTimers();
    elements = stubDom({ intro: 2, breadcrumbs: 2 });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

// a type that finishes as soon as `done` flips, optionally gated on `ready`
const type = (state, gated = false) => ({
    ...(gated ? { available: () => state.ready } : {}),
    conditions: { 0: () => state.done, 1: () => state.done }
});

function build(options = {}) {
    const intro = { done: false };
    const breadcrumbs = { done: false, ready: false };
    const completed = [];
    const manager = new TutorialManager({
        tutorialOrder: ['intro', 'breadcrumbs'],
        onTutorialComplete: (t) => completed.push(t),
        callbacks: { intro: type(intro), breadcrumbs: type(breadcrumbs, true) },
        ...options
    });
    return { manager, intro, breadcrumbs, completed };
}

// runs the tutorial to its end and lets the trailing reset timer fire
function finish(manager, state) {
    state.done = true;
    manager.update();
    manager.update();
    vi.runAllTimers();
}

describe('startNextTutorial', () => {
    it('starts the first uncompleted type right away when it has no gate', () => {
        const { manager } = build();
        expect(manager.startNextTutorial()).toBe(true);
        expect(manager.tutorialType).toBe('intro');
        expect(manager.inTutorial).toBe(true);
        expect(visible(elements, 'intro', 0)).toBe(true);
    });

    it('arms a gated type instead of starting it', () => {
        const { manager } = build({ showTutorials: { intro: false } });
        expect(manager.startNextTutorial()).toBe(true);
        expect(manager.armedType).toBe('breadcrumbs');
        expect(manager.inTutorial).toBe(false);
        expect(visible(elements, 'breadcrumbs', 0)).toBe(false);
    });

    it('returns false once every type is complete', () => {
        const { manager } = build({
            showTutorials: { intro: false, breadcrumbs: false }
        });
        expect(manager.startNextTutorial()).toBe(false);
        expect(manager.inTutorial).toBe(false);
    });

    it('starts a type chosen outside the order rather than overriding it', () => {
        elements = stubDom({ intro: 2, breadcrumbs: 2, vr: 2 });
        const state = { done: false };
        const manager = new TutorialManager({
            tutorialOrder: ['intro', 'breadcrumbs'],
            callbacks: { intro: type({ done: false }), vr: type(state) }
        });

        // what entering VR does: pick the type, then lock, which starts one
        manager.setTutorialType('vr');
        manager.startNextTutorial();

        expect(manager.tutorialType).toBe('vr');
        expect(visible(elements, 'vr', 0)).toBe(true);
    });

    it('offers the next type only after the previous one completes', () => {
        const { manager, intro } = build();
        manager.startNextTutorial();
        finish(manager, intro);

        expect(manager.nextTutorialType()).toBe('breadcrumbs');
        manager.startNextTutorial();
        expect(manager.armedType).toBe('breadcrumbs');
    });
});

describe('available() gate', () => {
    it('holds step 0 back until the gate opens', () => {
        const { manager, breadcrumbs } = build({ showTutorials: { intro: false } });
        manager.startNextTutorial();

        manager.update();
        expect(manager.inTutorial).toBe(false);

        breadcrumbs.ready = true;
        manager.update();
        expect(manager.inTutorial).toBe(true);
        expect(manager.armedType).toBe(null);
        expect(visible(elements, 'breadcrumbs', 0)).toBe(true);
    });

    it('does not fire after another type takes over', () => {
        const { manager, breadcrumbs } = build({ showTutorials: { intro: false } });
        manager.startNextTutorial();

        manager.setTutorialType('vr');
        breadcrumbs.ready = true;
        manager.update();

        expect(manager.armedType).toBe(null);
        expect(manager.tutorialType).toBe('vr');
    });
});

describe('chained types', () => {
    // intro (ungated) -> hint (gated + chained), the shape breadcrumbs and
    // breadcrumb-reaim have
    function buildChain() {
        const intro = { done: false };
        const hint = { done: false, ready: false };
        const manager = new TutorialManager({
            tutorialOrder: ['intro', 'hint'],
            callbacks: {
                intro: type(intro),
                hint: { ...type(hint, true), chained: true }
            }
        });
        return { manager, intro, hint };
    }

    it('offers a chained type as soon as the one before it finishes', () => {
        elements = stubDom({ intro: 2, hint: 2 });
        const { manager, intro } = buildChain();
        manager.startNextTutorial();
        finish(manager, intro);

        expect(manager.armedType).toBe('hint');
    });

    it('still holds the chained type at its own gate', () => {
        elements = stubDom({ intro: 2, hint: 2 });
        const { manager, intro, hint } = buildChain();
        manager.startNextTutorial();
        finish(manager, intro);

        manager.update();
        expect(manager.inTutorial).toBe(false);

        hint.ready = true;
        manager.update();
        expect(visible(elements, 'hint', 0)).toBe(true);
    });

    it('keeps a chained type for the next maze when its gate never opens', () => {
        elements = stubDom({ intro: 2, hint: 2 });
        const { manager, intro } = buildChain();
        manager.startNextTutorial();
        finish(manager, intro);

        // the player finishes the maze still holding nothing
        manager.resetTutorial(true);

        expect(manager.showTutorials.hint).not.toBe(false);
        expect(manager.nextTutorialType()).toBe('hint');
    });

    it('does not chain a type that is not marked chained', () => {
        elements = stubDom({ intro: 2, hint: 2 });
        const intro = { done: false };
        const manager = new TutorialManager({
            tutorialOrder: ['intro', 'hint'],
            callbacks: { intro: type(intro), hint: type({ done: false }, true) }
        });
        manager.startNextTutorial();
        finish(manager, intro);

        expect(manager.armedType).toBe(null);
    });
});

describe('completion reporting', () => {
    it('reports a type that actually ran', () => {
        const { manager, intro, completed } = build();
        manager.startNextTutorial();
        finish(manager, intro);

        expect(completed).toEqual(['intro']);
        expect(manager.showTutorials.intro).toBe(false);
    });

    it('leaves a type still waiting on its gate uncompleted', () => {
        const { manager, completed } = build({ showTutorials: { intro: false } });
        manager.startNextTutorial();

        // what maze completion does while the player never met a breadcrumb
        manager.resetTutorial(true);

        expect(completed).toEqual([]);
        expect(manager.showTutorials.breadcrumbs).not.toBe(false);
        expect(manager.nextTutorialType()).toBe('breadcrumbs');
    });
});
