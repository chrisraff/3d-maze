// What the Customize menu's two options mean as values: the modes, what a
// stored string coerces to, and the scenery multiplier each mode implies.
import { describe, it, expect } from 'vitest';
import {
    MARKER_MODES, MAZE_OPTION_BY_KEY, MAZE_OPTION_DEFAULTS, MAZE_OPTION_STORAGE_KEYS,
    SCENERY_MODES, SPARSE_SCENERY_SCALE, coerceMazeOption, coerceMazeOptions, sceneryScaleFor,
} from '../js/state/mazeOptions.js';

describe('modes', () => {
    it('offers the three the menu does, defaulting to how the game was tuned', () => {
        expect(SCENERY_MODES).toEqual(['on', 'sparse', 'off']);
        expect(MARKER_MODES).toEqual(['unlimited', 'on', 'off']);
        expect(MAZE_OPTION_DEFAULTS).toEqual({ scenery: 'on', markers: 'on' });
    });

    it('names a storage key per option, each resolving back to it', () => {
        for (const [option, key] of Object.entries(MAZE_OPTION_STORAGE_KEYS))
            expect(MAZE_OPTION_BY_KEY[key]).toBe(option);
    });
});

describe('coerceMazeOption', () => {
    it('keeps a value that is one of the modes', () => {
        for (const mode of SCENERY_MODES) expect(coerceMazeOption('scenery', mode)).toBe(mode);
        for (const mode of MARKER_MODES) expect(coerceMazeOption('markers', mode)).toBe(mode);
    });

    it('falls back to the default for anything else', () => {
        // nothing stored, a value left behind by an older build, a different
        // case, and a mode that belongs to the other option
        for (const value of [undefined, null, '', 'true', 'Off', 'unlimited'])
            expect(coerceMazeOption('scenery', value), String(value)).toBe('on');
        for (const value of [undefined, 'none', 'On', 'sparse'])
            expect(coerceMazeOption('markers', value), String(value)).toBe('on');
    });

    it('fills in a whole set, so a partial one still generates a maze', () => {
        expect(coerceMazeOptions({ scenery: 'off' })).toEqual({ scenery: 'off', markers: 'on' });
        expect(coerceMazeOptions()).toEqual(MAZE_OPTION_DEFAULTS);
    });
});

describe('sceneryScaleFor', () => {
    it('leaves the tuned density alone when scenery is on', () => {
        expect(sceneryScaleFor('on')).toBe(1);
        // an unreadable mode generates the default maze rather than a bare one
        expect(sceneryScaleFor('nonsense')).toBe(1);
    });

    it('thins every kind for sparse rather than dropping any', () => {
        expect(sceneryScaleFor('sparse')).toBe(SPARSE_SCENERY_SCALE);
        expect(SPARSE_SCENERY_SCALE).toBeGreaterThan(0);
        expect(SPARSE_SCENERY_SCALE).toBeLessThan(1);
    });

    it('places nothing at all when scenery is off', () => {
        expect(sceneryScaleFor('off')).toBe(0);
    });
});
