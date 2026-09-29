import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { SceneryClaims, ROLE, conflicts, panelKey, orderForBuild } from '../js/sceneryClaims.js';
import { generateMaze } from '../js/maze.js';
import BreadcrumbManager from '../js/BreadcrumbManager.js';
import BreadcrumbBaseDecor from '../js/BreadcrumbBaseDecor.js';
import SkylineDecor from '../js/SkylineDecor.js';
import MosaicDecor from '../js/MosaicDecor.js';
import LatticeStudsDecor from '../js/LatticeStudsDecor.js';
import CircuitDecor from '../js/CircuitDecor.js';
import PipesDecor from '../js/PipesDecor.js';
import SplotchesDecor from '../js/SplotchesDecor.js';
import DripsDecor from '../js/DripsDecor.js';

// MotesDecor is absent on purpose: it drifts in open air, declares a null
// PROFILE, and its constructor needs a DOM for its texture.
const PROFILES = {
    Base: BreadcrumbBaseDecor.PROFILE,
    Sky: SkylineDecor.PROFILE,
    Mos: MosaicDecor.PROFILE,
    Lat: LatticeStudsDecor.PROFILE,
    Cir: CircuitDecor.PROFILE,
    Pipe: PipesDecor.PROFILE,
    Splo: SplotchesDecor.PROFILE,
    'Drip-w': DripsDecor.profileFor('wall'),
    'Drip-c': DripsDecor.profileFor('ceiling'),
};
const NAMES = Object.keys(PROFILES);

const room = (x, y, z) => ({ x, y, z });
const surf = (axis, dir) => ({ axis, dir });

describe('conflict verdicts', () => {
    // The table each decor's own geometry constants currently produce. It is
    // asserted rather than derived so that a change to any decor's depth
    // shows up here as an explicit diff of which pairs changed verdict.
    // 'X' = may not share one side of one panel. See docs/scenery-conflicts.md.
    const EXPECTED = {
        //        Base Sky  Mos  Lat  Cir  Pipe Splo Dr-w Dr-c
        Base:     'X    X    X    X    X    X    .    X    X',
        Sky:      'X    X    X    X    X    X    X    X    X',
        Mos:      'X    X    X    X    X    .    .    X    .',
        Lat:      'X    X    X    X    X    X    .    X    X',
        Cir:      'X    X    X    X    X    .    .    X    .',
        Pipe:     'X    X    .    X    .    X    .    .    X',
        Splo:     '.    X    .    .    .    .    .    .    .',
        'Drip-w': 'X    X    X    X    X    .    .    X    .',
        'Drip-c': 'X    X    .    X    .    X    .    .    X',
    };

    for (const a of NAMES) {
        const row = EXPECTED[a].split(/\s+/);
        NAMES.forEach((b, i) => {
            const want = row[i] === 'X';
            it(`${a} ${want ? 'conflicts with' : 'may share a panel with'} ${b}`, () => {
                expect(conflicts(PROFILES[a], PROFILES[b])).toBe(want);
            });
        });
    }

    it('is symmetric across every pair', () => {
        for (const a of NAMES) {
            for (const b of NAMES) {
                expect(conflicts(PROFILES[a], PROFILES[b])).toBe(conflicts(PROFILES[b], PROFILES[a]));
            }
        }
    });

    it('treats a null profile as claiming nothing', () => {
        for (const a of NAMES) {
            expect(conflicts(PROFILES[a], null)).toBe(false);
            expect(conflicts(null, PROFILES[a])).toBe(false);
        }
    });

    it('holds the rules the decor was designed around', () => {
        // pipes stand clear of a flush mosaic but not of a skyline's towers
        expect(conflicts(PROFILES.Pipe, PROFILES.Mos)).toBe(false);
        expect(conflicts(PROFILES.Pipe, PROFILES.Sky)).toBe(true);
        // splotches settle over anything except a claim that admits nothing
        for (const b of NAMES) {
            expect(conflicts(PROFILES.Splo, PROFILES[b])).toBe(b === 'Sky');
        }
        // a wall drip falls behind a pipe; a ceiling drip falls through one
        expect(conflicts(PROFILES['Drip-w'], PROFILES.Pipe)).toBe(false);
        expect(conflicts(PROFILES['Drip-c'], PROFILES.Pipe)).toBe(true);
    });

    it('blocks two panel-owning features that miss each other in depth', () => {
        const inlay = { band: [-0.03, -0.001], role: ROLE.FEATURE };
        expect(conflicts(inlay, PROFILES.Sky)).toBe(true);
        // ...but an accent at the same depth is only judged on its volume
        expect(conflicts({ ...inlay, role: ROLE.ACCENT }, PROFILES.Sky)).toBe(false);
    });
});

describe('panel keys', () => {
    it('names one slab from either room, keeping the two faces apart', () => {
        const a = panelKey(room(1, 1, 1), surf('x', 1));
        const b = panelKey(room(3, 1, 1), surf('x', -1));
        expect(a.split('|')[0]).toBe(b.split('|')[0]); // same slab
        expect(a).not.toBe(b);                          // different faces
    });

    it('separates panels of the same room', () => {
        const keys = new Set([
            panelKey(room(1, 1, 1), surf('x', 1)), panelKey(room(1, 1, 1), surf('x', -1)),
            panelKey(room(1, 1, 1), surf('y', 1)), panelKey(room(1, 1, 1), surf('z', -1)),
        ]);
        expect(keys.size).toBe(4);
    });
});

describe('the ledger', () => {
    it('lets a claim through, then refuses a conflicting one on the same face', () => {
        const claims = new SceneryClaims();
        expect(claims.claim(room(1, 1, 1), surf('x', 1), PROFILES.Sky)).toBe(true);
        expect(claims.canClaim(room(1, 1, 1), surf('x', 1), PROFILES.Mos)).toBe(false);
        expect(claims.canClaim(room(1, 1, 1), surf('x', 1), PROFILES.Splo)).toBe(false); // exclusive
    });

    it('admits a hosted decor onto an occupied face', () => {
        const claims = new SceneryClaims();
        claims.claim(room(1, 1, 1), surf('x', 1), PROFILES.Mos);
        expect(claims.claim(room(1, 1, 1), surf('x', 1), PROFILES.Splo)).toBe(true);
        expect(claims.claim(room(1, 1, 1), surf('x', 1), PROFILES.Pipe)).toBe(true);
    });

    it('leaves the far face of an ordinary claim free', () => {
        const claims = new SceneryClaims();
        claims.claim(room(1, 1, 1), surf('x', 1), PROFILES.Mos);
        expect(claims.canClaim(room(3, 1, 1), surf('x', -1), PROFILES.Mos)).toBe(true);
    });

    it('claims both faces for a decor that pokes through the slab', () => {
        const claims = new SceneryClaims();
        expect(claims.claim(room(1, 1, 1), surf('x', 1), PROFILES.Lat)).toBe(true);
        expect(claims.canClaim(room(3, 1, 1), surf('x', -1), PROFILES.Mos)).toBe(false);
    });

    it('mirrors a through claim rather than copying it onto the far face', () => {
        const claims = new SceneryClaims();
        const asymmetric = { band: [-0.09, 0.01], role: ROLE.FEATURE, through: true };
        claims.claim(room(1, 1, 1), surf('x', 1), asymmetric);
        // seen from the far face the band is [-0.01, 0.09], so a decor
        // reaching 0.05 out of THAT side is blocked, while one 0.05 into
        // the slab from it - where the claim no longer reaches - is not
        const outward = { band: [0.04, 0.06], role: ROLE.ACCENT };
        const inward = { band: [-0.06, -0.04], role: ROLE.ACCENT };
        expect(claims.canClaim(room(3, 1, 1), surf('x', -1), outward)).toBe(false);
        expect(claims.canClaim(room(3, 1, 1), surf('x', -1), inward)).toBe(true);
    });

    it('never leaves a partial claim behind when one face is refused', () => {
        const claims = new SceneryClaims();
        claims.claim(room(3, 1, 1), surf('x', -1), PROFILES.Sky);
        // the lattice wants both faces; only the far one is taken
        expect(claims.claim(room(1, 1, 1), surf('x', 1), PROFILES.Lat)).toBe(false);
        expect(claims.canClaim(room(1, 1, 1), surf('x', 1), PROFILES.Mos)).toBe(true);
    });

    it('reports the union of what a face already holds', () => {
        const claims = new SceneryClaims();
        expect(claims.bandOn(room(1, 1, 1), surf('x', 1))).toBe(null);
        claims.claim(room(1, 1, 1), surf('x', 1), PROFILES.Mos);
        claims.claim(room(1, 1, 1), surf('x', 1), PROFILES.Pipe);
        expect(claims.bandOn(room(1, 1, 1), surf('x', 1)))
            .toEqual([PROFILES.Mos.band[0], PROFILES.Pipe.band[1]]);
    });
});

describe('build order', () => {
    const instances = () => [
        new SplotchesDecor(), new SkylineDecor(), new CircuitDecor(),
        new MosaicDecor(), new PipesDecor(),
    ];

    it('places the decor claiming most of a panel first, whatever the list order', () => {
        const roles = orderForBuild(instances(), () => 0.5)
            .map(d => d.constructor.PROFILE.role);
        expect(roles).toEqual([...roles].sort((a, b) => a - b));
    });

    it('does not always give one decor first pick within its role class', () => {
        let seed = 1;
        const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const firstFeature = new Set();
        for (let i = 0; i < 40; i++) {
            const order = orderForBuild(instances(), rng);
            firstFeature.add(order.find(d => d.constructor.PROFILE.role === ROLE.FEATURE).constructor.name);
        }
        expect(firstFeature.size).toBeGreaterThan(1);
    });
});

describe('against a real maze', () => {
    const buildAll = () => {
        const mazeData = generateMaze(4);
        const claims = new SceneryClaims();
        const decors = [
            new SkylineDecor(), new MosaicDecor(), new LatticeStudsDecor(),
            new CircuitDecor(), new PipesDecor(), new SplotchesDecor(), new DripsDecor(),
        ];
        const placed = {};
        for (const decor of orderForBuild(decors)) {
            placed[decor.constructor.name] = decor.build(mazeData, undefined, claims);
        }
        return { claims, placed };
    };

    it('still places every kind of scenery once they compete for panels', () => {
        const { placed } = buildAll();
        for (const [name, count] of Object.entries(placed)) {
            expect(count, `${name} placed nothing`).toBeGreaterThan(0);
        }
    });

    it('leaves no face of any panel holding a conflicting pair', () => {
        const { claims } = buildAll();
        expect(claims._panels.size).toBeGreaterThan(0);
        for (const [key, held] of claims._panels) {
            const profiles = [...held];
            for (let i = 0; i < profiles.length; i++) {
                for (let j = i + 1; j < profiles.length; j++) {
                    expect(conflicts(profiles[i], profiles[j]), `conflict on ${key}`).toBe(false);
                }
            }
        }
    });
});

describe('breadcrumb bases', () => {
    beforeEach(() => {
        vi.stubGlobal('document', { getElementById: () => ({ innerText: '' }) });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('reserves the panel behind every base it seeds', () => {
        const mazeData = generateMaze(4);
        const claims = new SceneryClaims();
        const manager = new BreadcrumbManager();
        manager.addTo(new THREE.Scene());
        manager.initializeMaze(mazeData, claims);

        expect(claims._panels.size).toBeGreaterThan(0);
        for (const held of claims._panels.values()) {
            expect([...held]).toEqual([BreadcrumbBaseDecor.PROFILE]);
        }
    });

    it('keeps scenery off those panels entirely', () => {
        const mazeData = generateMaze(4);
        const claims = new SceneryClaims();
        const manager = new BreadcrumbManager();
        manager.addTo(new THREE.Scene());
        manager.initializeMaze(mazeData, claims);
        const reserved = new Set(claims._panels.keys());

        for (const decor of orderForBuild([
            new SkylineDecor(), new MosaicDecor(), new LatticeStudsDecor(),
            new CircuitDecor(), new PipesDecor(), new DripsDecor(),
        ])) {
            decor.build(mazeData, undefined, claims);
        }

        // splotches are the one thing a base tolerates, so they are excluded
        // here - every other decor must have stayed off a reserved panel
        for (const key of reserved) {
            expect([...claims._panels.get(key)]).toEqual([BreadcrumbBaseDecor.PROFILE]);
        }
    });
});
