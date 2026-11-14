// When a remembered lesson stops counting: the two lapse windows, what a
// missing completion date means, and that the screen and VR records expire
// independently of each other.
import { describe, it, expect } from 'vitest';
import {
    SCREEN_LAPSE_MS, VR_LAPSE_MS, hasLapsed, liveTutorialsSeen,
} from '../js/state/tutorialLapse.js';

const DAY = 1000 * 60 * 60 * 24;
const VR_TYPES = ['vr', 'vr-breadcrumbs'];
const ALL_TYPES = ['intro', 'breadcrumbs', 'breadcrumb-reaim', ...VR_TYPES];

describe('lapse windows', () => {
    it('gives the screen lessons a month and the VR ones a week', () => {
        expect(SCREEN_LAPSE_MS).toBe(30 * DAY);
        expect(VR_LAPSE_MS).toBe(7 * DAY);
    });

    it('holds a record inside its window and drops it past it', () => {
        const now = 100 * DAY;

        expect(hasLapsed(now - 6 * DAY, VR_LAPSE_MS, now)).toBe(false);
        expect(hasLapsed(now - 8 * DAY, VR_LAPSE_MS, now)).toBe(true);
        expect(hasLapsed(now - 8 * DAY, SCREEN_LAPSE_MS, now)).toBe(false);
        expect(hasLapsed(now - 31 * DAY, SCREEN_LAPSE_MS, now)).toBe(true);
    });

    // nothing has ever proved those lessons stuck, so they keep being offered
    it('counts a player who has never completed a maze as lapsed', () => {
        expect(hasLapsed(0, SCREEN_LAPSE_MS, 100 * DAY)).toBe(true);
        expect(hasLapsed(0, VR_LAPSE_MS, 100 * DAY)).toBe(true);
    });
});

describe('liveTutorialsSeen', () => {
    it('keeps every type while neither order has lapsed', () => {
        expect(liveTutorialsSeen(ALL_TYPES, VR_TYPES, {})).toEqual(ALL_TYPES);
    });

    // a week away from a headset says nothing about the mouse and keyboard
    it('drops only the VR types when VR has lapsed', () => {
        expect(liveTutorialsSeen(ALL_TYPES, VR_TYPES, { vrLapsed: true }))
            .toEqual(['intro', 'breadcrumbs', 'breadcrumb-reaim']);
    });

    it('drops only the screen types when the screen order has lapsed', () => {
        expect(liveTutorialsSeen(ALL_TYPES, VR_TYPES, { screenLapsed: true }))
            .toEqual(VR_TYPES);
    });

    it('drops everything when both have lapsed', () => {
        expect(liveTutorialsSeen(ALL_TYPES, VR_TYPES,
            { screenLapsed: true, vrLapsed: true })).toEqual([]);
    });

    // the VR marker lesson lapses with the movement one, rather than outliving
    // the controls it builds on
    it('treats the whole VR order as one record', () => {
        expect(liveTutorialsSeen(VR_TYPES, VR_TYPES, { vrLapsed: true })).toEqual([]);
    });
});
