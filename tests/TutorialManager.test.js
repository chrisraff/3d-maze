import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TutorialManager from '../js/ui/TutorialManager.js';

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

// Entering VR swaps the whole order out, so the two sets of lessons never
// compete for a slot - see VR_TUTORIAL_ORDER in game.js.
describe('setTutorialOrder', () => {
    function buildTwoOrders(options = {}) {
        elements = stubDom({ intro: 2, breadcrumbs: 2, vr: 2, 'vr-markers': 2 });
        const vr = { done: false };
        const vrMarkers = { done: false, ready: false };
        const manager = new TutorialManager({
            tutorialOrder: ['intro', 'breadcrumbs'],
            callbacks: {
                intro: type({ done: false }),
                breadcrumbs: type({ done: false, ready: false }, true),
                vr: type(vr),
                'vr-markers': { ...type(vrMarkers, true), chained: true }
            },
            ...options
        });
        return { manager, vr, vrMarkers };
    }

    // what entering VR does: swap the order, then pick that order's first type
    const enterVr = (manager) => {
        manager.setTutorialOrder(['vr', 'vr-markers']);
        manager.setTutorialType('vr');
    };

    it('offers the new order instead of the old one', () => {
        const { manager } = buildTwoOrders();
        enterVr(manager);

        expect(manager.nextTutorialType()).toBe('vr');
        manager.startNextTutorial();
        expect(visible(elements, 'vr', 0)).toBe(true);
        expect(visible(elements, 'intro', 0)).toBe(false);
    });

    it('chains into a type of the new order', () => {
        const { manager, vr, vrMarkers } = buildTwoOrders();
        enterVr(manager);
        manager.startNextTutorial();

        finish(manager, vr);
        expect(manager.armedType).toBe('vr-markers');

        vrMarkers.ready = true;
        manager.update();
        expect(visible(elements, 'vr-markers', 0)).toBe(true);
    });

    it('drops a type armed under the old order, unseen', () => {
        const { manager } = buildTwoOrders({ showTutorials: { intro: false } });
        manager.startNextTutorial();
        expect(manager.armedType).toBe('breadcrumbs');

        enterVr(manager);

        expect(manager.armedType).toBe(null);
        // and it is still there to be offered when that order comes back
        manager.setTutorialOrder(['intro', 'breadcrumbs']);
        expect(manager.nextTutorialType()).toBe('breadcrumbs');
    });

    it('keeps a type armed when the new order still lists it', () => {
        const { manager } = buildTwoOrders({ showTutorials: { intro: false } });
        manager.startNextTutorial();

        manager.setTutorialOrder(['breadcrumbs']);

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
        manager.endOnGoalReached();

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
        manager.endOnGoalReached();

        expect(completed).toEqual([]);
        expect(manager.showTutorials.breadcrumbs).not.toBe(false);
        expect(manager.nextTutorialType()).toBe('breadcrumbs');
    });
});

describe('abandoning an unfinished tutorial', () => {
    it('does not report a lesson the player started but never finished', () => {
        const { manager, completed } = build();
        manager.startNextTutorial();
        expect(manager.inTutorial).toBe(true);
        expect(visible(elements, 'intro', 0)).toBe(true);

        manager.abandonTutorial();

        expect(completed).toEqual([]);
        expect(manager.showTutorials.intro).not.toBe(false);
    });

    it('offers that same lesson again afterwards', () => {
        const { manager } = build();
        manager.startNextTutorial();
        manager.abandonTutorial();

        expect(manager.nextTutorialType()).toBe('intro');
        expect(manager.startNextTutorial()).toBe(true);
        expect(manager.inTutorial).toBe(true);
        expect(visible(elements, 'intro', 0)).toBe(true);
    });

    it('abandons a lesson stopped part way through its steps', () => {
        const { manager, intro, completed } = build();
        manager.startNextTutorial();

        // clear step 0 only, so step 1 is showing and the lesson is unfinished
        intro.done = true;
        manager.update();
        intro.done = false;
        expect(manager.tutorialData.step).toBe(1);

        manager.abandonTutorial();

        expect(completed).toEqual([]);
        expect(manager.showTutorials.intro).not.toBe(false);
    });

    it('puts a gated lesson back on its gate', () => {
        const { manager, breadcrumbs } = build({ showTutorials: { intro: false } });
        manager.startNextTutorial();
        breadcrumbs.ready = true;
        manager.update();
        expect(manager.inTutorial).toBe(true);

        manager.abandonTutorial();

        expect(manager.inTutorial).toBe(false);
        expect(manager.armedType).toBe('breadcrumbs');

        // and the gate opening again starts it over from step 0
        manager.update();
        expect(manager.inTutorial).toBe(true);
        expect(manager.tutorialData.step).toBe(0);
    });

    it('leaves an ungated lesson waiting for the next offer', () => {
        const { manager } = build();
        manager.startNextTutorial();
        manager.abandonTutorial();

        expect(manager.armedType).toBe(null);
        manager.update();
        expect(manager.inTutorial).toBe(false);
    });

    it('still reports a lesson that genuinely ran out of steps', () => {
        const { manager, intro, completed } = build();
        manager.startNextTutorial();
        finish(manager, intro);

        expect(completed).toEqual(['intro']);
        expect(manager.showTutorials.intro).toBe(false);
    });
});

describe('reaching the goal', () => {
    // a lesson reaching the goal proves, like the controls
    const proven = (state) => ({ ...type(state), satisfiedByGoal: true });

    it('counts a lesson the goal demonstrates as learned', () => {
        const completed = [];
        const manager = new TutorialManager({
            tutorialOrder: ['intro', 'breadcrumbs'],
            onTutorialComplete: (t) => completed.push(t),
            callbacks: {
                intro: proven({ done: false }),
                breadcrumbs: type({ done: false, ready: false }, true)
            }
        });
        manager.startNextTutorial();
        expect(manager.inTutorial).toBe(true);

        // the maze ends with intro step 0 still on screen
        manager.endOnGoalReached();

        expect(completed).toEqual(['intro']);
        expect(manager.showTutorials.intro).toBe(false);
        expect(manager.nextTutorialType()).toBe('breadcrumbs');
    });

    it('does not count a lesson the goal says nothing about', () => {
        const { manager, breadcrumbs, completed } = build({
            showTutorials: { intro: false }
        });
        manager.startNextTutorial();
        breadcrumbs.ready = true;
        manager.update();
        expect(manager.inTutorial).toBe(true);

        // they reached the exit without ever picking a marker up
        manager.endOnGoalReached();

        expect(completed).toEqual([]);
        expect(manager.showTutorials.breadcrumbs).not.toBe(false);
        expect(manager.nextTutorialType()).toBe('breadcrumbs');
    });
});

// A step can give up on its own: the thing it was asking about went away.
describe('abandoned() step tests', () => {
    // breadcrumbs, gated, where step 0 can decide it has lost the plot
    const givingUp = (state) => ({
        ...type(state, true),
        abandoned: { 0: () => state.gone }
    });

    function buildGiving() {
        const state = { done: false, ready: true, gone: false };
        const completed = [];
        const manager = new TutorialManager({
            tutorialOrder: ['breadcrumbs'],
            tutorialType: 'breadcrumbs',
            onTutorialComplete: (t) => completed.push(t),
            callbacks: { breadcrumbs: givingUp(state) }
        });
        manager.startNextTutorial();
        manager.update();
        return { manager, state, completed };
    }

    it('drops the lesson unseen when the step gives up', () => {
        const { manager, state, completed } = buildGiving();
        expect(manager.inTutorial).toBe(true);

        state.gone = true;
        manager.update();

        expect(manager.inTutorial).toBe(false);
        expect(completed).toEqual([]);
        expect(manager.showTutorials.breadcrumbs).not.toBe(false);
    });

    it('starts over once the gate opens again', () => {
        const { manager, state } = buildGiving();
        state.gone = true;
        manager.update();

        state.gone = false;
        manager.update();

        expect(manager.inTutorial).toBe(true);
        expect(manager.tutorialData.step).toBe(0);
        expect(visible(elements, 'breadcrumbs', 0)).toBe(true);
    });

    it('does not consult a step that has no test of its own', () => {
        const { manager, state } = buildGiving();

        // step 1, where walking off is expected rather than a failure
        state.done = true;
        manager.update();
        state.done = false;
        expect(manager.tutorialData.step).toBe(1);

        state.gone = true;
        manager.update();

        expect(manager.inTutorial).toBe(true);
    });

    it('advances rather than gives up when both would fire', () => {
        const { manager, state } = buildGiving();

        state.done = true;
        state.gone = false;
        manager.update();

        expect(manager.tutorialData.step).toBe(1);
    });
});
