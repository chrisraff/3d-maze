import { describe, it, expect } from 'vitest';
import { findNexuses } from '../js/maze/mazeNexus.js';
import {
    openSides, sightScore, segmentKey, neighbour, cellMap, waysOut,
} from '../js/maze/mazeQuery.js';
import { generateMaze } from '../js/maze/maze.js';
import { fromLayout, name } from './mazeLayout.js';

// Two junctions one cell apart on a north-south spine, each with a 2-cell side
// branch, plus a 2-cell continuation of the spine past each of them. Small
// enough to check the answer by eye: the nexus is the two junctions and the
// corridor cell between them, and it has four ways out.
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

// No junction anywhere, so nothing to find however branchy the sightlines are.
const CORRIDOR = fromLayout(`
    #######
    #.....#
    #####.#
    #####.#
    #####.#
    #####.#
    #######
`);

const at = (x, z) => ({ x, y: 1, z });
const names = cells => [...cells].map(name).sort();

describe('findNexuses on a maze small enough to check by eye', () => {
    const found = findNexuses(SPINE);

    it('finds one nexus', () => {
        expect(found).toHaveLength(1);
    });

    it('seeds on the junctions', () => {
        expect(names(found[0].seeds)).toEqual(names([at(5, 3), at(5, 7)]));
    });

    it('covers the junctions and the corridor joining them', () => {
        expect(names(found[0].region.values()))
            .toEqual(names([at(5, 3), at(5, 5), at(5, 7)]));
    });

    it('reports every substantive way out of the whole area', () => {
        expect(found[0].branches).toHaveLength(4);
        expect(found[0].branches.map(b => `${name(b.room)}${b.surface.axis}${b.surface.dir > 0 ? '+' : '-'}`).sort())
            .toEqual(['(5,1,3)x+', '(5,1,3)z-', '(5,1,7)x-', '(5,1,7)z+']);
    });

    // The bug this guards against made every corridor cell in sight of a
    // junction into a seed of its own, which ran the clusters together across
    // the whole maze.
    it('does not seed a corridor cell, however much it can see', () => {
        const corridor = at(5, 5);
        expect(openSides(SPINE, corridor)).toHaveLength(2);
        expect(sightScore(SPINE, corridor, 1)).toBe(4); // higher than either seed
        expect(names(found[0].seeds)).not.toContain(name(corridor));
        // but it is still part of the area, because it lies between two seeds
        expect(found[0].region.has(segmentKey(SPINE, corridor))).toBe(true);
    });

    it('finds nothing in a maze with no junction in it', () => {
        expect(findNexuses(CORRIDOR)).toEqual([]);
    });

    it('finds nothing, rather than failing, in a maze too small to have one', () => {
        expect(findNexuses(generateMaze(2))).toEqual([]);
    });
});

describe('the parameters move in the direction they claim to', () => {
    const maze = generateMaze(7);
    const count = options => findNexuses(maze, options).length;
    const seeds = options => findNexuses(maze, options)
        .reduce((total, nexus) => total + nexus.seeds.length, 0);
    const covered = options => findNexuses(maze, options)
        .reduce((total, nexus) => total + nexus.region.size, 0);

    // Raising the bar takes seeds away, and takes area away with them...
    it('a higher threshold seeds less of the maze and covers less of it', () => {
        expect(seeds({ thresh: 4 })).toBeLessThanOrEqual(seeds({ thresh: 3 }));
        expect(seeds({ thresh: 5 })).toBeLessThanOrEqual(seeds({ thresh: 4 }));
        expect(covered({ thresh: 4 })).toBeLessThanOrEqual(covered({ thresh: 3 }));
    });

    // ...but it does NOT reliably find fewer nexuses, which is worth knowing
    // before tuning it. A seed that was bridging two groups can be the one the
    // higher bar removes, and one nexus becomes two. Only the coarseness of the
    // grouping is monotone, and that is `radius`, which leaves seeds untouched.
    it('a wider clustering radius never finds more, because it only merges', () => {
        expect(seeds({ radius: 1 })).toBe(seeds({ radius: 3 }));
        expect(count({ radius: 2 })).toBeLessThanOrEqual(count({ radius: 1 }));
        expect(count({ radius: 3 })).toBeLessThanOrEqual(count({ radius: 2 }));
    });

    it('a stricter stub rule seeds less of the maze', () => {
        expect(seeds({ stub: 2 })).toBeLessThanOrEqual(seeds({ stub: 1 }));
    });
});

describe('what a nexus is guaranteed to be, over generated mazes', () => {
    const SIZES = [3, 5, 7];
    const PER_SIZE = 4;

    const everyNexus = fn => {
        for (const size of SIZES)
            for (let i = 0; i < PER_SIZE; i++) {
                const maze = generateMaze(size);
                for (const nexus of findNexuses(maze)) fn(maze, nexus);
            }
    };

    it('is a connected area', () => {
        everyNexus((maze, nexus) => {
            const start = [...nexus.region.values()][0];
            const seen = new Set([segmentKey(maze, start)]);
            const queue = [start];
            for (let head = 0; head < queue.length; head++)
                for (const surface of openSides(maze, queue[head])) {
                    const next = neighbour(queue[head], surface);
                    const key = segmentKey(maze, next);
                    if (!nexus.region.has(key) || seen.has(key)) continue;
                    seen.add(key);
                    queue.push(next);
                }
            expect(seen.size).toBe(nexus.region.size);
        });
    });

    it('leads away through every branch it reports, and no branch leads back in', () => {
        everyNexus((maze, nexus) => {
            for (const { room, surface } of nexus.branches) {
                expect(nexus.region.has(segmentKey(maze, room))).toBe(true);
                expect(nexus.region.has(segmentKey(maze, neighbour(room, surface)))).toBe(false);
            }
            // and the branch list is exactly what the region's own ways out are
            expect(nexus.branches).toHaveLength(waysOut(maze, nexus.region, 1).length);
        });
    });

    it('contains at least one seed, and every seed is a junction', () => {
        everyNexus((maze, nexus) => {
            expect(nexus.seeds.length).toBeGreaterThan(0);
            for (const seed of nexus.seeds) {
                expect(nexus.region.has(segmentKey(maze, seed))).toBe(true);
                expect(openSides(maze, seed).length).toBeGreaterThanOrEqual(3);
            }
        });
    });

    // Empirical rather than proved - two Steiner trees over seed sets more than
    // `radius` apart could in principle share a corridor cell. It has never
    // been seen, and placement assumes it, so this is the guard: if it ever
    // fires, overlapping regions should be merged into one nexus.
    it('never shares a cell with another nexus', () => {
        for (const size of SIZES)
            for (let i = 0; i < PER_SIZE; i++) {
                const maze = generateMaze(size);
                const owner = new Map();
                for (const nexus of findNexuses(maze))
                    for (const key of nexus.region.keys()) {
                        expect(owner.has(key)).toBe(false);
                        owner.set(key, nexus);
                    }
            }
    });
});

describe('firing rate', () => {
    // The rate is the only figure the hand labels could really check the
    // detector against, and it has to hold across the size slider or scenery
    // driven by it inherits the density collapse of the per-axis site counts.
    // Wide bounds on purpose: generateMaze is unseeded, so this is a guard
    // against a change of character, not a measurement.
    it('is roughly one nexus per 30 cells at every size', () => {
        for (const size of [3, 5, 7, 9]) {
            let cells = 0;
            let nexuses = 0;
            for (let i = 0; i < 4; i++) {
                cells += size ** 3;
                nexuses += findNexuses(generateMaze(size)).length;
            }
            const rate = nexuses / cells;
            expect(rate, `size ${size} fired at ${rate.toFixed(3)} per cell`)
                .toBeGreaterThan(0.015);
            expect(rate, `size ${size} fired at ${rate.toFixed(3)} per cell`)
                .toBeLessThan(0.07);
        }
    });
});
