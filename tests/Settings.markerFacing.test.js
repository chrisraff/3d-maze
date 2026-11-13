/**
 * Settings' half of the Markers Face control: two stored values behind one
 * pair of DOM halves, and which of them is in force. The rest of Settings is
 * DOM plumbing, so only the parts this setting needs are stubbed here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    MARKER_FACING_MODES, MARKER_FACING_STORAGE_KEYS as KEYS,
} from '../js/state/markerFacing.js';

const SCREEN_KEY = KEYS.screen;
const VR_KEY = KEYS.vr;

// storage.js namespaces what it writes, so the fake store below is keyed the
// way the browser would be. Spelled out rather than imported, so a careless
// change to the prefix fails here instead of orphaning every stored setting.
const STORED_PREFIX = '3dmaze-';

// a stand-in DOM element: enough of one for Settings to read, write and
// listen to. `dispatch` plays the part of an event bubbling up to a handler.
function el({ id = null, name = null, tagName = 'INPUT', type = null, value = null, classes = [] }) {
    return {
        id, name, tagName, type, value, classes,
        checked: false,
        disabled: false,
        style: { display: '' },
        _listeners: {},
        addEventListener(event, handler) {
            (this._listeners[event] ??= []).push(handler);
        },
        dispatch(event, target = this) {
            for (const handler of this._listeners[event] ?? []) handler({ target });
        },
    };
}

function makeDom(elements) {
    const match = (selector) => {
        if (selector.startsWith('#')) return elements.filter(e => e.id === selector.slice(1));
        if (selector.startsWith('.')) return elements.filter(e => e.classes.includes(selector.slice(1)));
        const named = selector.match(/^\[name="(.+)"\]$/);
        if (named) return elements.filter(e => e.name === named[1]);
        return [];
    };
    return {
        querySelector: (selector) => match(selector)[0] ?? null,
        querySelectorAll: (selector) => match(selector),
    };
}

// Settings reaches storage.js, which grabs window.localStorage as it loads, so
// the stub has to be in place before the import.
async function setup(stored = {}) {
    const backing = new Map(
        Object.entries(stored).map(([key, value]) => [STORED_PREFIX + key, value]));
    vi.stubGlobal('window', {
        localStorage: {
            getItem: (key) => backing.has(key) ? backing.get(key) : null,
            setItem: (key, value) => backing.set(key, String(value)),
        },
    });

    const facingSelect = el({
        id: 'setting-marker-facing-select', name: SCREEN_KEY,
        tagName: 'SELECT', value: 'toward', classes: ['menu-select'],
    });
    const facingRadioGroup = el({
        name: VR_KEY, tagName: 'DIV', classes: ['menu-radio-button', 'xr-force-redraw'],
    });
    const facingRadios = ['toward', 'away'].map(value =>
        el({ name: VR_KEY, type: 'radio', value }));
    // the breadcrumb-reaim lesson's two direction fragments
    const copy = {
        away: el({ tagName: 'SPAN', classes: ['marker-aim-away'] }),
        toward: el({ tagName: 'SPAN', classes: ['marker-aim-toward'] }),
    };

    const elements = [
        el({ id: 'setting-fixed-camera', type: 'checkbox' }),
        el({ id: 'vr-setting-mirror', type: 'checkbox', classes: ['xr-force-redraw'] }),
        el({ id: 'vr-setting-rotation-speed', classes: ['menu-slider', 'xr-force-redraw'] }),
        ...['teleport', 'smooth'].map(value => el({ name: 'vr-setting-movement', type: 'radio', value })),
        ...['instant', 'smooth'].map(value => el({ name: 'vr-setting-rotation', type: 'radio', value })),
        ...['maze-setting-scenery', 'maze-setting-markers'].map(name =>
            el({ name, tagName: 'SELECT', classes: ['menu-select'] })),
        facingSelect, facingRadioGroup, ...facingRadios, copy.away, copy.toward,
    ];
    vi.stubGlobal('document', makeDom(elements));

    const applied = [];
    const breadcrumbs = { setFacingMode: (mode) => applied.push(mode) };

    const { default: Settings } = await import('../js/state/Settings.js');
    const settings = new Settings({
        controls: { vrControlOptions: {}, setGimbalLocked: () => {} },
        vrManager: { uiMesh: { material: { map: { update: () => {} } } } },
        renderer: { xr: { isPresenting: false } },
        vrDeviceType: 'vr-device-last',
        breadcrumbs,
    });
    settings.load();
    settings.bindDom();

    const radioOf = (mode) => facingRadios.find(r => r.value === mode);
    const shownCopy = () => MARKER_FACING_MODES
        .filter(direction => copy[direction].style.display !== 'none');
    // the setting's own key, so a test says what it means rather than carrying
    // the prefix around; `rawKeys` is for checking the prefix landed at all
    const store = {
        get: (key) => backing.get(STORED_PREFIX + key),
        has: (key) => backing.has(STORED_PREFIX + key),
        rawKeys: () => [...backing.keys()],
    };
    return { settings, store, applied, facingSelect, facingRadioGroup, radioOf, shownCopy };
}

beforeEach(() => vi.resetModules());

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('load', () => {
    it('reads a value per context and puts the screen one in force', async () => {
        const { settings, applied } = await setup({ [SCREEN_KEY]: 'away', [VR_KEY]: 'toward' });

        expect(settings.markerFacing).toEqual({ screen: 'away', vr: 'toward' });
        expect(settings.markerFacingMode).toBe('away');
        expect(applied.at(-1)).toBe('away');
    });

    it('shows each half its own context, not a mirror of one value', async () => {
        const { facingSelect, radioOf } = await setup({ [SCREEN_KEY]: 'toward', [VR_KEY]: 'away' });

        expect(facingSelect.value).toBe('toward');
        expect(radioOf('away').checked).toBe(true);
        expect(radioOf('toward').checked).toBe(false);
    });

    it('defaults both to toward, including a value an older build left', async () => {
        const { settings } = await setup({ [SCREEN_KEY]: 'sideways' });

        expect(settings.markerFacing).toEqual({ screen: 'toward', vr: 'toward' });
    });
});

// The lesson teaches the double gesture, which is a reversal, so the copy has
// to promise the direction opposite the setting - saying "away from you" to
// somebody whose markers already point away teaches them nothing.
describe('the direction the breadcrumb-reaim lesson names', () => {
    it('is away while the setting is toward', async () => {
        const { shownCopy } = await setup({ [SCREEN_KEY]: 'toward' });

        expect(shownCopy()).toEqual(['away']);
    });

    it('is toward while the setting is away', async () => {
        const { shownCopy } = await setup({ [SCREEN_KEY]: 'away' });

        expect(shownCopy()).toEqual(['toward']);
    });

    it('follows the setting as the player changes it', async () => {
        const { facingSelect, shownCopy } = await setup({ [SCREEN_KEY]: 'toward' });

        facingSelect.value = 'away';
        facingSelect.dispatch('change');

        expect(shownCopy()).toEqual(['toward']);
    });
});

describe('changing it', () => {
    it('stores the screen half and hands it straight to the markers', async () => {
        const { settings, store, applied, facingSelect } = await setup();

        facingSelect.value = 'away';
        facingSelect.dispatch('change');

        expect(store.get(SCREEN_KEY)).toBe('away');
        expect(settings.markerFacingMode).toBe('away');
        expect(applied.at(-1)).toBe('away');
    });

    it('leaves the VR half alone when the screen half changes', async () => {
        const { settings, store, facingSelect } = await setup();

        facingSelect.value = 'away';
        facingSelect.dispatch('change');

        expect(settings.markerFacing.vr).toBe('toward');
        expect(store.has(VR_KEY)).toBe(false);
    });

    it('stores the VR half under its own key, without taking force on screen', async () => {
        const { settings, store, applied, facingRadioGroup, radioOf } = await setup();

        facingRadioGroup.dispatch('change', radioOf('away'));

        expect(store.get(VR_KEY)).toBe('away');
        expect(settings.markerFacing).toEqual({ screen: 'toward', vr: 'away' });
        // not in VR, so what the markers are using hasn't changed
        expect(applied.at(-1)).toBe('toward');
    });

    // the game shares an origin with the rest of the site, so neither half may
    // claim a bare name of its own (storage.js)
    it('writes both halves under the namespaced key', async () => {
        const { store, facingSelect, facingRadioGroup, radioOf } = await setup();

        facingSelect.value = 'away';
        facingSelect.dispatch('change');
        facingRadioGroup.dispatch('change', radioOf('away'));

        expect(store.rawKeys()).toEqual([`${STORED_PREFIX}${SCREEN_KEY}`, `${STORED_PREFIX}${VR_KEY}`]);
    });
});

describe('moving between contexts', () => {
    it('swaps which stored value is in force', async () => {
        const { settings, applied } = await setup({ [SCREEN_KEY]: 'toward', [VR_KEY]: 'away' });

        settings.setVrPresenting(true);
        expect(settings.markerFacingMode).toBe('away');
        expect(applied.at(-1)).toBe('away');

        settings.setVrPresenting(false);
        expect(settings.markerFacingMode).toBe('toward');
        expect(applied.at(-1)).toBe('toward');
    });

    it('applies a VR change as it is made once the player is in VR', async () => {
        const { settings, applied, facingRadioGroup, radioOf } = await setup();
        settings.setVrPresenting(true);

        facingRadioGroup.dispatch('change', radioOf('away'));

        expect(applied.at(-1)).toBe('away');
    });
});
