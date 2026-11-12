import { describe, it, expect, afterEach } from 'vitest';
import {
    DENSITY, roomCount, sceneryBudget, budgetFor, setSceneryDensityScale, sceneryDensityScale,
} from '../js/decor/sceneryBudget.js';
import SCENERY_DECORS from '../js/decor/scenery.js';
import { SPARSE_SCENERY_SCALE, sceneryScaleFor } from '../js/state/mazeOptions.js';

const maze = size => ({ bounds: [size, size, size] });

// The budget rolls for its fractional part, so these pin the two ends of the
// roll rather than the expectation: `rng() < fraction` rounds up.
const down = () => 1;
const up = () => 0;
const mean = (size, weight = 1, opts = {}, runs = 4000) => {
    let total = 0;
    for (let i = 0; i < runs; i++) total += sceneryBudget(maze(size), weight, opts);
    return total / runs;
};

describe('sceneryBudget', () => {
    it('is proportional to rooms, not to one axis', () => {
        // doubling every axis is eight times the rooms, so eight times the pieces
        expect(mean(8)).toBeCloseTo(8 * mean(4), 0);
    });

    it('holds density flat across the whole size slider', () => {
        // 2-12 is the range of the slider in index.html; size 2 is excluded
        // because `min: 1` binds there and lifts it on purpose
        for (let size = 3; size <= 12; size++) {
            const per = mean(size) / roomCount(maze(size));
            expect(per / DENSITY, `size ${size}`).toBeGreaterThan(0.95);
            expect(per / DENSITY, `size ${size}`).toBeLessThan(1.05);
        }
    });

    it('is tuned to leave about a fifth of the maze holding something', () => {
        // the panel supply is exactly 4 solid sides per room (every maze is a
        // spanning tree), and measured end to end this density claims ~20% of
        // them at every size from 3 to 12
        expect(DENSITY).toBeCloseTo(0.057, 3);
    });

    it('scales with weight', () => {
        expect(mean(7, 2)).toBeCloseTo(2 * mean(7, 1), 0);
    });

    it('rolls for the fractional part instead of rounding it away', () => {
        // the case that forced this: a kind wants 1.54 pieces in the default
        // maze, and rounding gave it 1 - an effective density a third short,
        // with no reachable setting in between
        const wanted = DENSITY * roomCount(maze(3));
        expect(wanted).toBeGreaterThan(1);
        expect(wanted).toBeLessThan(2);
        expect(sceneryBudget(maze(3), 1, {}, down)).toBe(1);
        expect(sceneryBudget(maze(3), 1, {}, up)).toBe(2);
        expect(mean(3)).toBeCloseTo(wanted, 1);
    });

    it('never drops a kind entirely, however small the maze', () => {
        // a size-2 maze earns half a piece; there is nothing between one and
        // none, and none reads as the kind being absent rather than rare
        expect(DENSITY * roomCount(maze(2))).toBeLessThan(1);
        expect(sceneryBudget(maze(2), 1, {}, down)).toBe(1);
        expect(sceneryBudget(maze(2), 0.01, {}, down)).toBe(1);
    });

    it('honours a ceiling for a kind that gets expensive when dense', () => {
        expect(sceneryBudget(maze(12), 1, { max: 40 }, up)).toBe(40);
        expect(sceneryBudget(maze(3), 1, { max: 40 }, up)).toBe(2);
    });
});

// the Scenery option lands here as module state, so each case puts it back
describe('the density scale', () => {
    afterEach(() => setSceneryDensityScale(1));

    it('is 1 until something sets it, so the tuned density is the default', () => {
        expect(sceneryDensityScale()).toBe(1);
    });

    it('thins what every kind asks for, in proportion', () => {
        const full = mean(8);
        setSceneryDensityScale(SPARSE_SCENERY_SCALE);
        expect(mean(8) / full).toBeCloseTo(SPARSE_SCENERY_SCALE, 1);
        // the whole mix is still there, just less of it
        for (const Kind of SCENERY_DECORS)
            expect(budgetFor(maze(8), Kind, up), Kind.name).toBeGreaterThan(0);
    });

    it('can thin a kind out of a small maze, which the floor alone could not', () => {
        // a size-3 maze asks for 1.54 pieces of each kind, so a third of
        // that has to be able to come out as none at all
        setSceneryDensityScale(SPARSE_SCENERY_SCALE);
        expect(sceneryBudget(maze(3), 1, {}, down)).toBe(0);
        expect(sceneryBudget(maze(3), 1, {}, up)).toBe(1);
        // and a size-2 maze, where the floor binds at every scale
        expect(sceneryBudget(maze(2), 1, {}, down)).toBe(0);
    });

    it('places nothing anywhere at zero, however big the maze', () => {
        setSceneryDensityScale(sceneryScaleFor('off'));
        for (const size of [2, 3, 12])
            for (const Kind of SCENERY_DECORS)
                expect(budgetFor(maze(size), Kind, up), `${Kind.name} at ${size}`).toBe(0);
    });

    it('still honours a ceiling', () => {
        setSceneryDensityScale(SPARSE_SCENERY_SCALE);
        expect(sceneryBudget(maze(12), 1, { max: 20 }, up)).toBe(20);
    });
});

describe('every decor', () => {
    it('declares a weight, so all the densities are comparable in one place', () => {
        for (const Kind of SCENERY_DECORS) {
            expect(typeof Kind.WEIGHT, Kind.name).toBe('number');
            expect(Kind.WEIGHT, Kind.name).toBeGreaterThan(0);
        }
    });

    it('gets a budget of at least one piece at the default maze size', () => {
        for (const Kind of SCENERY_DECORS)
            expect(budgetFor(maze(3), Kind, down), Kind.name).toBeGreaterThanOrEqual(1);
    });

    // Catches a decor whose count formula was missed by the conversion: the
    // whole point is that one number governs all of them.
    it('derives its count from the shared budget, not from an axis', () => {
        for (const Kind of SCENERY_DECORS) {
            const small = budgetFor(maze(4), Kind, up);
            const big = budgetFor(maze(8), Kind, up);
            expect(big / small, Kind.name).toBeGreaterThan(4);
        }
    });
});
