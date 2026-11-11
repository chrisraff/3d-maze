import { describe, it, expect } from 'vitest';
import { BranchSites, branchSitesOf, pickSite } from '../js/decor/branchSites.js';
import { ROLE, SceneryClaims } from '../js/decor/sceneryClaims.js';
import { findNexuses } from '../js/maze/mazeNexus.js';
import { panelSolid, segmentKey, waysOut } from '../js/maze/mazeQuery.js';
import { generateMaze } from '../js/maze/maze.js';
import SCENERY_DECORS from '../js/decor/scenery.js';
import DripsDecor from '../js/decor/DripsDecor.js';
import SkylineDecor from '../js/decor/SkylineDecor.js';
import MosaicDecor from '../js/decor/MosaicDecor.js';
import LatticeStudsDecor from '../js/decor/LatticeStudsDecor.js';

// Stand-in decor kinds, so the site logic can be tested without geometry.
// Real classes, not object literals: that is what the assignment is handed.
const kind = (name, opts = {}) => {
    const Kind = class {};
    Object.defineProperty(Kind, 'name', { value: name });
    Kind.BRANCH_SITES = opts.branchSites ?? true;
    Kind.PROFILE = { band: [0, 0.1], role: opts.role ?? ROLE.ACCENT };
    return Kind;
};

const siteKey = ({ room, surface }) =>
    `${room.x},${room.y},${room.z}|${surface.axis}${surface.dir}`;

describe('branchSitesOf', () => {
    it('names a solid panel for every site it offers', () => {
        for (const size of [3, 5, 7]) {
            const maze = generateMaze(size);
            for (const nexus of branchSitesOf(maze))
                for (const { room, surface } of nexus)
                    expect(panelSolid(maze, room, surface.axis, surface.dir)).toBe(true);
        }
    });

    // Every opening is a site, dead ends included. Marking only the real
    // branches would make a bare opening a reliable "nothing down there",
    // which is the one thing this must not do.
    it('includes the stub openings a nexus does not count as branches', () => {
        const maze = generateMaze(7);
        const nexuses = findNexuses(maze);
        const groups = branchSitesOf(maze);

        const branches = nexuses.reduce((a, n) => a + n.branches.length, 0);
        const openings = nexuses.reduce(
            (a, n) => a + waysOut(maze, n.region, 0).length, 0);
        const sites = groups.reduce((a, g) => a + g.length, 0);

        expect(openings).toBeGreaterThan(branches);  // there are stubs to find
        expect(sites).toBeGreaterThan(branches);
    });

    it('offers one group per nexus, and no panel twice within a group', () => {
        const maze = generateMaze(7);
        const groups = branchSitesOf(maze);
        expect(groups).toHaveLength(findNexuses(maze).length);
        for (const group of groups)
            expect(new Set(group.map(siteKey)).size).toBe(group.length);
    });
});

describe('BranchSites deals sites out', () => {
    const maze = generateMaze(7);

    it('only to the kinds that opt in', () => {
        const kinds = [kind('Wants'), kind('Also'), kind('Not', { branchSites: false })];
        const report = new BranchSites(maze, kinds).report();
        expect(Object.keys(report).sort()).toEqual(['Also', 'Wants']);
    });

    it('and does nothing at all when no kind wants any', () => {
        const sites = new BranchSites(maze, [kind('Not', { branchSites: false })]);
        expect(sites.report()).toEqual({});
        expect(sites.take(kind('Not'))).toBe(null);
    });

    it('spreading the branches of one nexus across different kinds', () => {
        // branches are dealt round-robin, so with 4 kinds a nexus of up to
        // 4 branches has no repeats at all
        const kinds = [kind('A'), kind('B'), kind('C'), kind('D')];
        const sites = new BranchSites(maze, kinds);

        const owner = new Map();
        for (const k of kinds)
            for (let site = sites.take(k); site; site = sites.take(k))
                owner.set(siteKey(site), k.name);

        let checked = 0;
        for (const group of branchSitesOf(maze)) {
            if (group.length > kinds.length) continue;
            const owners = group.map(s => owner.get(siteKey(s))).filter(Boolean);
            expect(new Set(owners).size).toBe(owners.length);
            checked++;
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('offering every site exactly once, to exactly one kind', () => {
        const kinds = [kind('A'), kind('B')];
        const sites = new BranchSites(maze, kinds);
        const offered = [];
        for (const k of kinds)
            for (let site = sites.take(k); site; site = sites.take(k)) offered.push(siteKey(site));

        const available = branchSitesOf(maze).flat().map(siteKey);
        expect(offered).toHaveLength(available.length);
        expect(new Set(offered).size).toBe(offered.length);
        expect(new Set(offered)).toEqual(new Set(available));
    });
});

describe('pickSite', () => {
    const maze = generateMaze(7);

    it('uses an assigned branch site before drawing at random', () => {
        const only = kind('Only');
        const sites = new BranchSites(maze, [only]);
        const expected = [];
        const peek = new BranchSites(maze, [only]); // same deal, different object
        for (let s = peek.take(only); s; s = peek.take(only)) expected.push(siteKey(s));

        const claims = new SceneryClaims();
        const first = pickSite(maze, Math.random, claims, only, sites);
        expect(expected).toContain(siteKey(first));
    });

    it('falls back to a random panel once the allocation runs out', () => {
        const only = kind('Only');
        const sites = new BranchSites(maze, [only]);
        const claims = new SceneryClaims();
        const assigned = sites.report()[only.name].assigned;

        // drain the allocation, then ask for one more
        for (let i = 0; i < assigned; i++) pickSite(maze, Math.random, claims, only, sites);
        expect(sites.take(only)).toBe(null);

        const extra = pickSite(maze, Math.random, claims, only, sites);
        expect(extra).not.toBe(null);
        expect(panelSolid(maze, extra.room, extra.surface.axis, extra.surface.dir)).toBe(true);
    });

    it('only ever returns a panel the claims ledger granted', () => {
        const only = kind('Only');
        const sites = new BranchSites(maze, [only]);
        const claims = new SceneryClaims();
        const seen = new Set();
        for (let i = 0; i < 40; i++) {
            const site = pickSite(maze, Math.random, claims, only, sites);
            if (site === null) continue;
            // a granted claim is exclusive, so the same side of the same panel
            // must never come back twice
            expect(seen.has(siteKey(site))).toBe(false);
            seen.add(siteKey(site));
        }
    });

    it('counts what was placed against what was assigned', () => {
        const only = kind('Only');
        const sites = new BranchSites(maze, [only]);
        const claims = new SceneryClaims();
        for (let i = 0; i < 3; i++) pickSite(maze, Math.random, claims, only, sites);

        const { assigned, placed } = sites.report()[only.name];
        expect(placed).toBe(3);
        expect(assigned).toBeGreaterThanOrEqual(placed);
    });

    it('works with no site allocation at all', () => {
        const claims = new SceneryClaims();
        const site = pickSite(maze, Math.random, claims, kind('Loose'), null);
        expect(site).not.toBe(null);
    });
});

describe('the decors that opt in', () => {
    it('are every kind but Drips', () => {
        // The multi-panel kinds steer too, taking the branch panel as the
        // seed or start and growing from it. Drips is out: a source has to be
        // a ceiling or wall with somewhere for the water to land, which the
        // panel at the end of a branch often is not.
        for (const Kind of SCENERY_DECORS)
            expect(Kind.BRANCH_SITES ?? false, Kind.name).toBe(Kind !== DripsDecor);
    });

    // The claim this module rests on: it moves scenery, it does not add any.
    //
    // Each build needs its own identically seeded rng, because the piece count
    // rolls for its fractional part (sceneryBudget.js). The roll is the first
    // draw, so both runs get the same budget and then diverge on placement.
    it('place the same number of pieces whether or not they are steered', () => {
        const seeded = () => {
            let state = 20261110;
            return () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        };
        for (const size of [4, 7]) {
            const maze = generateMaze(size);
            const decors = () => SCENERY_DECORS.map(Kind => new Kind());

            const loose = decors().map(d => d.build(maze, seeded(), new SceneryClaims()));

            const steered = decors();
            const sites = new BranchSites(maze, steered);
            const guided = steered.map(
                d => d.build(maze, seeded(), new SceneryClaims(), sites));

            expect(guided).toEqual(loose);
        }
    });

    it('land on branch panels when steered', () => {
        const maze = generateMaze(7);
        const decors = SCENERY_DECORS.map(Kind => new Kind());
        const sites = new BranchSites(maze, decors);
        for (const decor of decors) decor.build(maze, undefined, new SceneryClaims(), sites);

        const report = sites.report();
        const placed = Object.values(report).reduce((a, r) => a + r.placed, 0);
        expect(placed).toBeGreaterThan(0);
        for (const { assigned, placed: got } of Object.values(report))
            expect(got).toBeLessThanOrEqual(assigned);
    });
});
