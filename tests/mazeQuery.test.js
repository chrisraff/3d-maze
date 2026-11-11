import { describe, it, expect } from 'vitest';
import {
    openSides, sightSet, waysOut, sightScore, sightlineEnd, pathBetween,
    cellMap, neighbour, segmentKey, panelSolid,
} from '../js/maze/mazeQuery.js';
import { fromLayout, dirOf } from './mazeLayout.js';

// A spine running north-south with four 2-cell side branches off it: two to the
// east at the top, two to the west at the bottom. Every branch is long enough
// to count as a branch, and no two branches are in line with each other, so
// what a spine cell can see and what leads off it are different sets.
const SPINE = fromLayout(`
    ###########
    #####.....#
    #####.#####
    #####.....#
    #####.#####
    #####.#####
    #####.#####
    #.....#####
    #####.#####
    #.....#####
    ###########
`);

// A straight corridor with one single-cell dead end hanging off the middle of
// it - the "obviously trivial dead end" the stub rule exists to discard.
const STUB = fromLayout(`
    ###########
    #####.#####
    #####.#####
    #.........#
    ###########
    ###########
    ###########
`);

// A four-way crossing: you can see straight through it both ways, which is the
// case that separates the end of a sightline from the end of a corridor.
const CROSS = fromLayout(`
    ###########
    #####.#####
    #####.#####
    #####.#####
    #####.#####
    #.........#
    #####.#####
    #####.#####
    #####.#####
    #####.#####
    ###########
`);

// A corridor that runs east and then turns south.
const BEND = fromLayout(`
    #######
    #.....#
    #####.#
    #####.#
    #####.#
    #####.#
    #######
`);

const at = (x, z) => ({ x, y: 1, z });
const dirs = (mazeData, cell) => openSides(mazeData, cell).map(dirOf).sort();
const cellNames = cells => cells.map(c => `${c.x},${c.z}`).sort();

describe('openSides', () => {
    it('reports the surfaces a cell can be walked out of', () => {
        expect(dirs(SPINE, at(5, 5))).toEqual(['z+', 'z-']);
        expect(dirs(SPINE, at(5, 3))).toEqual(['x+', 'z+', 'z-']);
        expect(dirs(SPINE, at(9, 1))).toEqual(['x-']);
    });

    it('ignores a hole punched in the outer shell', () => {
        // the maze's entrance and exit are exactly this: an open panel on the
        // boundary, leading out of the maze rather than onward
        const holed = fromLayout(`
            #####
            #...#
            #####
        `);
        expect(dirs(holed, at(1, 1))).toEqual(['x+']);
        holed.collision_map[1][1][0] = false;
        expect(dirs(holed, at(1, 1))).toEqual(['x+']);
    });
});

describe('sightSet', () => {
    it('is the straight runs out of a cell, and does not turn corners', () => {
        // from the middle of the spine: the whole spine, and nothing off it
        expect(cellNames([...sightSet(SPINE, at(5, 5)).values()]))
            .toEqual(cellNames([at(5, 1), at(5, 3), at(5, 5), at(5, 7), at(5, 9)]));
    });

    it('sees along both arms of a bend but not around it', () => {
        expect(cellNames([...sightSet(BEND, at(5, 1)).values()]))
            .toEqual(cellNames([at(1, 1), at(3, 1), at(5, 1), at(5, 3), at(5, 5)]));
        // standing one cell west of the corner, the southward arm is hidden
        expect(cellNames([...sightSet(BEND, at(3, 1)).values()]))
            .toEqual(cellNames([at(1, 1), at(3, 1), at(5, 1)]));
    });
});

describe('waysOut', () => {
    const middle = cellMap(STUB, [at(5, 3)]);

    it('counts every opening when nothing is discarded', () => {
        expect(waysOut(STUB, middle, 0).map(w => dirOf(w.surface)).sort())
            .toEqual(['x+', 'x-', 'z-']);
    });

    it('drops a way out that dies within `stub` cells', () => {
        expect(waysOut(STUB, middle, 1).map(w => dirOf(w.surface)).sort())
            .toEqual(['x+', 'x-']);
    });

    it('keeps a branch longer than `stub`, and drops it once stub reaches it', () => {
        const spineCell = cellMap(SPINE, [at(5, 3)]);
        expect(waysOut(SPINE, spineCell, 1).map(w => dirOf(w.surface)).sort())
            .toEqual(['x+', 'z+', 'z-']);
        // the eastward branch is exactly 2 cells, so stub 2 discards it while
        // the spine itself, which leads to the rest of the maze, survives
        expect(waysOut(SPINE, spineCell, 2).map(w => dirOf(w.surface)).sort())
            .toEqual(['z+', 'z-']);
    });

    it('reports one way out per opening, naming the cell inside the region', () => {
        const region = cellMap(SPINE, [at(5, 1), at(5, 3)]);
        const found = waysOut(SPINE, region, 1);
        expect(found).toHaveLength(3); // two east branches, and the spine south
        for (const { room, surface } of found) {
            expect(region.has(segmentKey(SPINE, room))).toBe(true);
            expect(region.has(segmentKey(SPINE, neighbour(room, surface)))).toBe(false);
        }
    });
});

describe('sightScore', () => {
    it('counts the ways out of everything a cell can see', () => {
        // the spine's middle cell can see the whole spine, which has four
        // substantive branches off it - none of them visible from where it stands
        expect(sightScore(SPINE, at(5, 5), 1)).toBe(4);
    });

    it('does not count a cell as branchy for the stubs around it', () => {
        expect(sightScore(STUB, at(5, 3), 1)).toBe(0);
    });

    it('is low in a plain corridor', () => {
        expect(sightScore(BEND, at(3, 1), 1)).toBe(1);
    });
});

describe('sightlineEnd', () => {
    it('runs to the wall that closes off a dead end', () => {
        const end = sightlineEnd(SPINE, at(5, 1), { axis: 'x', dir: 1 });
        expect(end.room).toMatchObject(at(9, 1));
        expect(dirOf(end.surface)).toBe('x+');
    });

    it('stops where the corridor turns, facing back up it', () => {
        const end = sightlineEnd(BEND, at(1, 1), { axis: 'x', dir: 1 });
        expect(end.room).toMatchObject(at(5, 1));
        expect(dirOf(end.surface)).toBe('x+');
    });

    it('stops on the far wall of a junction it cannot see past', () => {
        // coming west up a branch, what you see ahead is the junction's own
        // far wall - which is the panel a feature for this branch goes on
        const end = sightlineEnd(SPINE, at(9, 3), { axis: 'x', dir: -1 });
        expect(end.room).toMatchObject(at(5, 3));
        expect(dirOf(end.surface)).toBe('x-');
    });

    // The reason this is the end of the sightline and not the end of the
    // corridor: at a crossing the corridor arguably stops, but the view does
    // not, and the panel there is an open doorway that could hold no feature.
    it('carries on through a crossing, to a panel that can hold something', () => {
        const end = sightlineEnd(CROSS, at(1, 5), { axis: 'x', dir: 1 });
        expect(end.room).toMatchObject(at(9, 5));
        expect(panelSolid(CROSS, end.room, 'x', 1)).toBe(true);
        // the crossing itself is on the way, and its forward panel is not solid
        expect(panelSolid(CROSS, at(5, 5), 'x', 1)).toBe(false);
    });

    it('gives back the cell itself when the panel beside it is already solid', () => {
        const end = sightlineEnd(SPINE, at(5, 5), { axis: 'x', dir: 1 });
        expect(end.room).toMatchObject(at(5, 5));
    });
});

describe('pathBetween', () => {
    it('gives the one path between two cells', () => {
        expect(cellNames(pathBetween(SPINE, at(9, 1), at(5, 5))))
            .toEqual(cellNames([at(9, 1), at(7, 1), at(5, 1), at(5, 3), at(5, 5)]));
    });

    it('is a single cell for a cell and itself', () => {
        expect(pathBetween(SPINE, at(5, 5), at(5, 5))).toHaveLength(1);
    });

    it('is null when there is no path', () => {
        // (1,1,5) is walled off in this layout
        expect(pathBetween(SPINE, at(5, 5), at(1, 5))).toBe(null);
    });
});
