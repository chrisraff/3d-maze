// The per-frame camera pass: the proximity glow, the nearest-breadcrumb signals
// the lessons read off it, and the counters they read as session totals.
// Grip-driven behaviour lives in BreadcrumbManager.vr.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import BreadcrumbManager, { ABANDON_CELLS } from '../js/breadcrumbs/BreadcrumbManager.js';
import * as maze from '../js/maze/maze.js';
import {
    PLAYER_GATE, SIGHT_GATE, v, stubBreadcrumbDom, makeManager, placeAt,
    giveMaze, segmentAt, makeGrip, makeCamera
} from './breadcrumbHelpers.js';

beforeEach(() => stubBreadcrumbDom());

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('proximity glow', () => {
    function twoFrames(manager, playerPos) {
        vi.spyOn(performance, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(1000); // 1s: exponential lerp fully converges
        manager.updateGlowHighlight(playerPos); // primes _glowLastTime (delta 0)
        manager.updateGlowHighlight(playerPos);
    }

    it('converges toward 0.5 * (dist / gate)^2 when in range with line of sight', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        placeAt(scene, b, 0, 0, 0);

        twoFrames(manager, v(0, 0, 1));

        const expected = 0.5 * (1 / PLAYER_GATE) ** 2;
        expect(b.userData.glowAlpha).toBeCloseTo(expected, 4);
        expect(b.userData.glowMaterial.uniforms.uAlpha.value).toBe(b.userData.glowAlpha);
    });

    it('fades to zero when a wall blocks line of sight', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        giveMaze(manager, [1, 1, 2]);

        const behind = segmentAt(1, 1, 2).setZ(maze.getOffset(2) + 0.2);
        placeAt(scene, b, behind.x, behind.y, behind.z);
        b.userData.glowAlpha = 0.4;

        twoFrames(manager, segmentAt(1, 1, 2).setZ(maze.getOffset(2) - 0.28125));

        expect(b.userData.glowAlpha).toBeCloseTo(0, 4);
    });

    it('fades to zero when the player is out of range', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        placeAt(scene, b, 0, 0, 0);
        b.userData.glowAlpha = 0.4;

        twoFrames(manager, v(0, 0, PLAYER_GATE + 1));

        expect(b.userData.glowAlpha).toBeCloseTo(0, 4);
    });

    it('skips the active interact target', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        placeAt(scene, b, 0, 0, 0);
        manager.beginReorient(b, makeGrip(0, 0, 0.1));
        b.userData.glowAlpha = 0.4;

        twoFrames(manager, v(0, 0, 1));

        expect(b.userData.glowAlpha).toBe(0.4);
    });

    it('removeBreadcrumb resets the glow so stack breadcrumbs do not flash', () => {
        const { manager } = makeManager(1);
        const [b] = manager.breadcrumbs;
        b.userData.glowAlpha = 0.4;
        b.userData.glowMaterial.uniforms.uAlpha.value = 0.4;

        manager.removeBreadcrumb(b);

        expect(b.userData.glowAlpha).toBe(0);
        expect(b.userData.glowMaterial.uniforms.uAlpha.value).toBe(0);
    });
});

describe('initializeMaze', () => {
    it('places half the dead ends, offset along the open direction, all in the scene', () => {
        const manager = new BreadcrumbManager();
        const scene = new THREE.Scene();
        manager.addTo(scene);

        const deadEnds = [
            { position: [2, 0, 4], direction: [0, 0, 1] },
            { position: [6, 0, 8], direction: [1, 0, 0] },
        ];
        const rand = vi.spyOn(Math, 'random').mockImplementation(() => 0); // always pick index 0
        manager.initializeMaze({ segments: [50, 50, 50], analytics: { dead_ends_data: deadEnds } });
        rand.mockRestore();

        expect(manager.breadcrumbs).toHaveLength(1); // floor(2 * 0.5)
        expect(manager.breadcrumbStack).toHaveLength(0);

        const [b] = manager.breadcrumbs;
        const cell = (maze.minorWidth + maze.majorWidth) / 2;
        expect(b.position.x).toBeCloseTo(2 * cell, 6);
        expect(b.position.y).toBeCloseTo(0, 6);
        expect(b.position.z).toBeCloseTo(4 * cell + maze.majorWidth * 0.2, 6);
        expect(scene.children).toContain(b);
        expect(b.scale.x).toBeCloseTo(maze.minorWidth * 4, 6);
    });

    it('cancels an in-progress placement when a new maze loads', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        manager.removeBreadcrumb(b);
        manager.beginPlace(makeGrip(0, 0, 0.5), new THREE.Object3D());
        expect(scene.children).toContain(b);

        manager.initializeMaze({
            segments: [50, 50, 50],
            analytics: { dead_ends_data: [{ position: [0, 0, 0], direction: [0, 0, 1] }] },
        });

        expect(manager.interactState).toBeNull();
        expect(manager.interactTarget).toBeNull();
        expect(scene.children).not.toContain(b);
        expect(manager.breadcrumbStack).toHaveLength(0);
    });
});

// nearestReachable drives the breadcrumb tutorial's entry gate and its marker
// glyph, and only ever considers *placed* breadcrumbs - which is easy to
// forget, because a carried one is invisible to it.
describe('nearestReachable', () => {
    it('finds a placed breadcrumb within the player gate', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        placeAt(scene, b, 0, 0, PLAYER_GATE * 0.5);

        manager.updateGlowHighlight(v(0, 0, 0));
        expect(manager.nearestReachable).toBe(b);
    });

    it('ignores one beyond the player gate', () => {
        const { manager, scene } = makeManager(1);
        placeAt(scene, manager.breadcrumbs[0], 0, 0, PLAYER_GATE * 1.5);

        manager.updateGlowHighlight(v(0, 0, 0));
        expect(manager.nearestReachable).toBeNull();
    });

    it('goes null while the breadcrumb is being carried', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        placeAt(scene, b, 0, 0, PLAYER_GATE * 0.5);

        manager.updateGlowHighlight(v(0, 0, 0));
        expect(manager.nearestReachable).toBe(b);

        // picking it up moves it to the stack, out of `breadcrumbs`
        manager.removeBreadcrumb(b);
        manager.updateGlowHighlight(v(0, 0, 0));

        expect(manager.nearestReachable).toBeNull();
        expect(manager.nextInStack).toBe(b);
    });

    it('picks the closer of two', () => {
        const { manager, scene } = makeManager(2);
        const [near, far] = manager.breadcrumbs;
        placeAt(scene, near, 0, 0, PLAYER_GATE * 0.3);
        placeAt(scene, far, 0, 0, PLAYER_GATE * 0.7);

        manager.updateGlowHighlight(v(0, 0, 0));
        expect(manager.nearestReachable).toBe(near);
    });
});

// nearestInView narrows nearestReachable to a centred oval of the view, so the
// tutorial doesn't fire when the player backs into a marker or pans past one.
describe('nearestInView', () => {
    // looks down -Z by default, like the player camera
    function makeCamera(lookAt = v(0, 0, -1)) {
        const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
        camera.position.set(0, 0, 0);
        camera.lookAt(lookAt);
        camera.updateMatrixWorld(true);
        return camera;
    }

    it('finds a breadcrumb in front of the player', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        placeAt(scene, b, 0, 0, -PLAYER_GATE * 0.5);

        manager.updateGlowHighlight(v(0, 0, 0), makeCamera());
        expect(manager.nearestInView).toBe(b);
    });

    it('ignores one out at the edge of the frame', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        // ~0.80 in NDC x at this FOV and aspect: on screen, outside the oval
        placeAt(scene, b, 0.82, 0, -0.75);

        manager.updateGlowHighlight(v(0, 0, 0), makeCamera());

        expect(manager.nearestInView).toBeNull();
        expect(manager.nearestReachable).toBe(b);
    });

    it('ignores one behind the player, which nearestReachable still sees', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        placeAt(scene, b, 0, 0, PLAYER_GATE * 0.5); // behind: camera looks down -Z

        manager.updateGlowHighlight(v(0, 0, 0), makeCamera());

        expect(manager.nearestInView).toBeNull();
        expect(manager.nearestReachable).toBe(b);
    });

    it('picks an on-screen breadcrumb over a closer one behind', () => {
        const { manager, scene } = makeManager(2);
        const [behind, ahead] = manager.breadcrumbs;
        placeAt(scene, behind, 0, 0, PLAYER_GATE * 0.3);
        placeAt(scene, ahead, 0, 0, -PLAYER_GATE * 0.7);

        manager.updateGlowHighlight(v(0, 0, 0), makeCamera());

        expect(manager.nearestReachable).toBe(behind);
        expect(manager.nearestInView).toBe(ahead);
    });

    it('accepts the same spot once it is nearer the middle', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        placeAt(scene, b, 0.2, 0, -0.75);

        manager.updateGlowHighlight(v(0, 0, 0), makeCamera());
        expect(manager.nearestInView).toBe(b);
    });

    it('is left alone when no camera is given, as in VR', () => {
        const { manager, scene } = makeManager(1);
        placeAt(scene, manager.breadcrumbs[0], 0, 0, -PLAYER_GATE * 0.5);

        manager.updateGlowHighlight(v(0, 0, 0));
        expect(manager.nearestInView).toBeNull();
    });
});

// One camera-driven entry point per frame. The grip-driven half stays in
// VRManager, so updateProximityHighlight must not drive the glow itself -
// in VR it runs before update() in the same frame, and used to redo the
// whole line-of-sight pass.
describe('update', () => {
    const camera = () => {
        const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
        c.position.set(0, 0, 0);
        c.lookAt(v(0, 0, -1));
        c.updateMatrixWorld(true);
        return c;
    };

    function withBreadcrumbAhead() {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        placeAt(scene, b, 0, 0, -PLAYER_GATE * 0.5);
        return { manager, breadcrumb: b };
    }

    it('drives the proximity glow', () => {
        const { manager, breadcrumb } = withBreadcrumbAhead();

        manager.update(0.016, camera());

        expect(manager.nearestReachable).toBe(breadcrumb);
        expect(manager.nearestInView).toBe(breadcrumb);
    });

    it('drives the base decor', () => {
        const { manager } = withBreadcrumbAhead();
        const bases = vi.spyOn(manager.base, 'update');

        manager.update(0.016, camera());

        expect(bases).toHaveBeenCalledWith(0.016);
    });

    it('runs the hover pass only when asked', () => {
        const { manager } = withBreadcrumbAhead();
        const hover = vi.spyOn(manager, 'updateHoveredBreadcrumb').mockImplementation(() => {});

        manager.update(0.016, camera());
        expect(hover).not.toHaveBeenCalled();

        manager.update(0.016, camera(), { hover: true });
        expect(hover).toHaveBeenCalledTimes(1);
    });

    it('leaves the glow to update(), not updateProximityHighlight', () => {
        const { manager } = withBreadcrumbAhead();

        manager.updateProximityHighlight([], camera());

        // the glow pass sets these; the grip pass must not have run it
        expect(manager.nearestReachable).toBeNull();
        expect(manager.nearestInView).toBeNull();
    });
});

// nearestInSight reaches past arm's length so the lesson can point out a
// marker the player would otherwise turn around in front of. Same line of
// sight and same view oval as nearestInView - only the distance differs.
describe('nearestInSight', () => {
    function makeCamera(lookAt = v(0, 0, -1)) {
        const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
        camera.position.set(0, 0, 0);
        camera.lookAt(lookAt);
        camera.updateMatrixWorld(true);
        return camera;
    }

    it('finds one too far to reach but close enough to walk to', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        placeAt(scene, b, 0, 0, -SIGHT_GATE * 0.5); // well past PLAYER_GATE

        manager.updateGlowHighlight(v(0, 0, 0), makeCamera());

        expect(manager.nearestInSight).toBe(b);
        expect(manager.nearestInView).toBeNull();
        expect(manager.nearestReachable).toBeNull();
    });

    it('ignores one beyond the sight gate', () => {
        const { manager, scene } = makeManager(1);
        placeAt(scene, manager.breadcrumbs[0], 0, 0, -SIGHT_GATE - 1);

        manager.updateGlowHighlight(v(0, 0, 0), makeCamera());
        expect(manager.nearestInSight).toBeNull();
    });

    it('ignores one behind the player', () => {
        const { manager, scene } = makeManager(1);
        placeAt(scene, manager.breadcrumbs[0], 0, 0, SIGHT_GATE * 0.5);

        manager.updateGlowHighlight(v(0, 0, 0), makeCamera());
        expect(manager.nearestInSight).toBeNull();
    });

    it('ignores one the maze has no straight line to', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        // cells sit at odd indices; [1][1][4] is the panel two cells along z
        giveMaze(manager, [1, 1, 4]);
        placeAt(scene, b, maze.getOffset(1), maze.getOffset(1), maze.getOffset(5));

        const camera = makeCamera(segmentAt(1, 1, 5));
        camera.position.copy(segmentAt(1, 1, 1));
        camera.updateMatrixWorld(true);

        manager.updateGlowHighlight(segmentAt(1, 1, 1), camera);
        expect(manager.nearestInSight).toBeNull();
    });

    it('sees it once that wall is gone', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        giveMaze(manager); // every panel open
        placeAt(scene, b, maze.getOffset(1), maze.getOffset(1), maze.getOffset(5));

        const camera = makeCamera(segmentAt(1, 1, 5));
        camera.position.copy(segmentAt(1, 1, 1));
        camera.updateMatrixWorld(true);

        manager.updateGlowHighlight(segmentAt(1, 1, 1), camera);
        expect(manager.nearestInSight).toBe(b);
    });

    it('still reports the near ones through nearestInView', () => {
        const { manager, scene } = makeManager(2);
        const [near, far] = manager.breadcrumbs;
        placeAt(scene, near, 0, 0, -PLAYER_GATE * 0.5);
        placeAt(scene, far, 0, 0, -SIGHT_GATE * 0.5);

        manager.updateGlowHighlight(v(0, 0, 0), makeCamera());

        expect(manager.nearestInView).toBe(near);
        expect(manager.nearestInSight).toBe(near); // the closer of the two
    });
});

// The flash is the one time anything but proximity drives the glow, and only
// while the lesson is asking the player to walk over.
describe('setTutorialFlash', () => {
    // the blink is read off the clock, so the test picks the moment: on for
    // the first 0.3s of every 0.8s, hard off the rest
    const FLASH_PERIOD_MS = 800;
    const ON = 100;
    const OFF = 500;

    function frameAt(manager, millis, playerPos = v(0, 0, 0)) {
        vi.spyOn(performance, 'now').mockReturnValue(millis);
        manager.updateGlowHighlight(playerPos);
        return manager;
    }

    const lit = (b) => b.userData.glowMaterial.uniforms.uAlpha.value;

    // one well outside the proximity glow, so anything lit is the flash
    function darkBreadcrumb(count = 1) {
        const { manager, scene } = makeManager(count);
        manager.breadcrumbs.forEach((b, i) => placeAt(scene, b, i, 0, -SIGHT_GATE * 0.5));
        frameAt(manager, 0); // seed the fade's clock
        return { manager, scene };
    }

    it('lights a breadcrumb that proximity alone would leave dark', () => {
        const { manager } = darkBreadcrumb();
        const b = manager.breadcrumbs[0];

        manager.setTutorialFlash(b);
        frameAt(manager, ON);

        expect(lit(b)).toBeGreaterThan(0.5);
    });

    it('drops away once the blink ends', () => {
        const { manager } = darkBreadcrumb();
        const b = manager.breadcrumbs[0];
        manager.setTutorialFlash(b);

        frameAt(manager, ON);
        expect(lit(b)).toBeGreaterThan(0.5);

        frameAt(manager, 300); // 200ms on, the blink is over
        expect(lit(b)).toBeLessThan(0.1);
    });

    it('comes back on the next period', () => {
        const { manager } = darkBreadcrumb();
        const b = manager.breadcrumbs[0];
        manager.setTutorialFlash(b);

        frameAt(manager, OFF);
        expect(lit(b)).toBeCloseTo(0, 4);

        frameAt(manager, FLASH_PERIOD_MS + ON);
        expect(lit(b)).toBeGreaterThan(0.5);
    });

    it('leaves that breadcrumb dark without it', () => {
        const { manager } = darkBreadcrumb();
        const b = manager.breadcrumbs[0];

        frameAt(manager, ON);

        expect(lit(b)).toBeCloseTo(0, 4);
    });

    it('stops blinking once it is cleared', () => {
        const { manager } = darkBreadcrumb();
        const b = manager.breadcrumbs[0];

        manager.setTutorialFlash(b);
        frameAt(manager, ON);
        expect(lit(b)).toBeGreaterThan(0.5);

        manager.setTutorialFlash(null);
        frameAt(manager, FLASH_PERIOD_MS + ON); // when it would blink again

        expect(lit(b)).toBeLessThan(0.1);
    });

    it("reaches the material through the glow's own fade", () => {
        const { manager } = darkBreadcrumb();
        const b = manager.breadcrumbs[0];

        manager.setTutorialFlash(b);
        frameAt(manager, ON);

        expect(lit(b)).toBe(b.userData.glowAlpha);
    });

    it('touches only the one it was given', () => {
        const { manager } = darkBreadcrumb(2);
        const [flashed, other] = manager.breadcrumbs;

        manager.setTutorialFlash(flashed);
        frameAt(manager, ON);

        expect(lit(flashed)).toBeGreaterThan(0.5);
        expect(lit(other)).toBeCloseTo(0, 4);
    });

    it('refuses a breadcrumb that is not placed in the maze', () => {
        const { manager } = darkBreadcrumb();
        const b = manager.breadcrumbs[0];
        manager.removeBreadcrumb(b); // into the player's hand

        manager.setTutorialFlash(b);
        frameAt(manager, ON);

        expect(lit(b)).toBeCloseTo(0, 4);
    });
});

describe('playerLeft', () => {
    // A maze solid but for `cells` and the doorways between consecutive ones:
    // one corridor, so the number of cells walked is unambiguous.
    function giveCorridor(manager, cells) {
        const size = 15; // segments, so cells run 1..13
        const map = Array.from({ length: size }, () =>
            Array.from({ length: size }, () => new Array(size).fill(true)));
        cells.forEach((cell, i) => {
            map[cell[0]][cell[1]][cell[2]] = false;
            if (i === 0) return;
            const door = cell.map((c, a) => (cells[i - 1][a] + c) / 2);
            map[door[0]][door[1]][door[2]] = false;
        });
        manager.mazedata = { ...manager.mazedata, collision_map: map,
                             segments: [size, size, size], bounds: [7, 7, 7] };
    }

    // a straight run of 7 cells along z, the marker in the first
    function straightRun(manager, scene) {
        const cells = [1, 3, 5, 7, 9, 11, 13].map(z => [1, 1, z]);
        giveCorridor(manager, cells);
        placeAt(scene, manager.breadcrumbs[0], ...segmentAt(1, 1, 1).toArray());
        return cells;
    }

    it('is false while the player is inside the abandon band', () => {
        const { manager, scene } = makeManager(1);
        straightRun(manager, scene);

        // ABANDON_CELLS cells along the corridor - the last one that counts
        manager.updateGlowHighlight(segmentAt(1, 1, 1 + 2 * ABANDON_CELLS));
        expect(manager.playerLeft(manager.breadcrumbs[0])).toBe(false);
    });

    it('is true one cell further on', () => {
        const { manager, scene } = makeManager(1);
        straightRun(manager, scene);

        manager.updateGlowHighlight(segmentAt(1, 1, 1 + 2 * (ABANDON_CELLS + 1)));
        expect(manager.playerLeft(manager.breadcrumbs[0])).toBe(true);
    });

    it('counts a player standing in a doorway as still there', () => {
        const { manager, scene } = makeManager(1);
        straightRun(manager, scene);

        // the panel between two cells, which getMazePos reports as itself
        manager.updateGlowHighlight(segmentAt(1, 1, 4));
        expect(manager.playerLeft(manager.breadcrumbs[0])).toBe(false);
    });

    it('is true for a cell that is close but a long way round', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        // the corridor loops away and comes back alongside the marker: [3,1,1]
        // is one cell from it in space and seven of walking
        giveCorridor(manager, [[1, 1, 1], [1, 1, 3], [1, 1, 5], [3, 1, 5],
                               [5, 1, 5], [5, 1, 3], [5, 1, 1], [3, 1, 1]]);
        placeAt(scene, b, ...segmentAt(1, 1, 1).toArray());

        manager.updateGlowHighlight(segmentAt(3, 1, 1));

        expect(manager.playerLeft(b)).toBe(true);
    });

    it('is false for the same cell once a door opens into it', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        giveCorridor(manager, [[1, 1, 1], [3, 1, 1]]);
        placeAt(scene, b, ...segmentAt(1, 1, 1).toArray());

        manager.updateGlowHighlight(segmentAt(3, 1, 1));

        expect(manager.playerLeft(b)).toBe(false);
    });

    it('ignores line of sight - losing sight of it is not leaving', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        // around a corner: two cells of walking, no straight line
        giveCorridor(manager, [[1, 1, 1], [1, 1, 3], [3, 1, 3]]);
        placeAt(scene, b, ...segmentAt(1, 1, 1).toArray());

        const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
        camera.position.copy(segmentAt(3, 1, 3));
        camera.lookAt(segmentAt(1, 1, 1));
        camera.updateMatrixWorld(true);

        manager.updateGlowHighlight(segmentAt(3, 1, 3), camera);

        expect(manager.nearestInSight).toBeNull(); // the corner hides it
        expect(manager.playerLeft(b)).toBe(false); // but they are still next door
    });

    it('is false for one the player is carrying', () => {
        const { manager, scene } = makeManager(1);
        const b = manager.breadcrumbs[0];
        straightRun(manager, scene);
        manager.updateGlowHighlight(segmentAt(1, 1, 13));
        expect(manager.playerLeft(b)).toBe(true);

        manager.removeBreadcrumb(b); // into the player's hand
        expect(manager.playerLeft(b)).toBe(false);
    });

    it('is false for nothing at all, and without a maze to walk', () => {
        const { manager, scene } = makeManager(1);
        placeAt(scene, manager.breadcrumbs[0], 0, 0, -SIGHT_GATE * 4);

        manager.updateGlowHighlight(v(0, 0, 0));

        expect(manager.playerLeft(manager.breadcrumbs[0])).toBe(false);
        expect(manager.playerLeft(null)).toBe(false);
        expect(manager.playerLeft(undefined)).toBe(false);
    });
});

// The lessons read these as session totals - the re-aim lesson waits for a few
// markers to be placed before it offers itself - as well as as deltas.
describe('tutorial counters', () => {
    const nextMaze = (manager) => manager.initializeMaze({
        segments: [50, 50, 50],
        analytics: { dead_ends_data: [{ position: [1, 1, 1], direction: [0, 0, 1] }] }
    });

    it('survive the next maze', () => {
        const { manager } = makeManager(1);
        manager.pickupCount = 4;
        manager.placeCount = 3;
        manager.reaimCount = 1;

        nextMaze(manager);

        expect(manager.pickupCount).toBe(4);
        expect(manager.placeCount).toBe(3);
        expect(manager.reaimCount).toBe(1);
    });

    it('start at zero on a fresh manager', () => {
        const { manager } = makeManager(1);

        expect(manager.pickupCount).toBe(0);
        expect(manager.placeCount).toBe(0);
        expect(manager.reaimCount).toBe(0);
    });
});
