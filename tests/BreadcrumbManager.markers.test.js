// The Markers option: how many markers a maze is stocked with, and whether
// placing one costs anything. 'on' is the behaviour every other suite runs
// under, so it appears here only as the baseline the other two differ from.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import BreadcrumbManager from '../js/breadcrumbs/BreadcrumbManager.js';
import { MARKER_MODES, MAZE_OPTION_DEFAULTS } from '../js/state/mazeOptions.js';
import { stubBreadcrumbDom, makeManager, makeCamera, makeGrip } from './breadcrumbHelpers.js';

// no walls, so addBreadcrumb leaves the placement where the camera put it
const emptyMazeData = () => ({
    bounds: [2, 2, 2],
    collision_map: Array.from({ length: 5 },
        () => Array.from({ length: 5 }, () => Array(5).fill(false)))
});

beforeEach(() => stubBreadcrumbDom());

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('stocking a maze', () => {
    it('defaults to the mode the game was tuned at', () => {
        expect(new BreadcrumbManager().markerMode).toBe(MAZE_OPTION_DEFAULTS.markers);
        expect(MARKER_MODES).toContain(MAZE_OPTION_DEFAULTS.markers);
    });

    it('fills half the dead ends with markers when they are on', () => {
        const { manager } = makeManager(3);
        expect(manager.breadcrumbs.length).toBe(3); // of 6 dead ends
        expect(manager.breadcrumbStack.length).toBe(0);
    });

    it('places none, and no bases, when they are off', () => {
        const { manager } = makeManager(3, { markerMode: 'off' });
        expect(manager.breadcrumbs.length).toBe(0);
        expect(manager.breadcrumbStack.length).toBe(0);
        // the medallions are a marker's own base, so they go with them
        expect(manager.base.studMesh).toBe(null);
    });

    it('hands one over at the start when they are unlimited', () => {
        // the supply comes out of the stack, so nothing is in the maze to find
        const { manager } = makeManager(3, { markerMode: 'unlimited' });
        expect(manager.breadcrumbs.length).toBe(0);
        expect(manager.base.studMesh).toBe(null);
        // and one is in hand from the first frame
        expect(manager.breadcrumbStack.length).toBe(1);
        expect(manager.nextInStack).not.toBe(null);
    });

    it('re-stocks on the next maze, so the mode can change between them', () => {
        const { manager } = makeManager(2, { markerMode: 'unlimited' });
        expect(manager.breadcrumbStack.length).toBe(1);

        manager.setMarkerMode('off');
        manager.initializeMaze({
            segments: [50, 50, 50],
            analytics: { dead_ends_data: [{ position: [1, 1, 1], direction: [0, 0, 1] }] }
        });

        expect(manager.breadcrumbs.length).toBe(0);
        expect(manager.breadcrumbStack.length).toBe(0);
    });
});

describe('an unlimited stack', () => {
    it('never empties, however many markers are placed', () => {
        const { manager } = makeManager(1, { markerMode: 'unlimited' });
        const camera = makeCamera();

        for (let i = 0; i < 5; i++)
            expect(manager.addBreadcrumb(camera, emptyMazeData()), `placement ${i}`).not.toBe(null);

        expect(manager.breadcrumbStack.length).toBe(1);
        expect(manager.breadcrumbs.length).toBe(5);
    });

    it('mints a distinct marker each time rather than re-placing one', () => {
        const { manager } = makeManager(1, { markerMode: 'unlimited' });
        const camera = makeCamera();

        const first = manager.addBreadcrumb(camera, emptyMazeData());
        const second = manager.addBreadcrumb(camera, emptyMazeData());

        expect(second).not.toBe(first);
        expect(manager.nextInStack).not.toBe(first);
        expect(manager.nextInStack).not.toBe(second);
    });

    it('mints a marker with its mesh, grab target and scale', () => {
        const { manager } = makeManager(1, { markerMode: 'unlimited' });
        const spawned = makeManager(1).manager.breadcrumbs[0];
        const minted = manager.nextInStack;

        expect(minted.userData.originalMaterial).toBeTruthy();
        expect(minted.userData.glowMaterial).toBeTruthy();
        expect(minted.userData.mesh).toBeTruthy();
        // a spawned marker's scale, so the two are the same size in hand
        expect(minted.scale.x).toBeCloseTo(spawned.scale.x, 6);
        expect(minted.children.some(child => child.userData.isBreadCrumbHitBox)).toBe(true);
        // nothing to de-energize: it has no dead end, and so no base
        expect(minted.userData.medallionIndex).toBe(undefined);
    });

    it('keeps the VR and gaze placements supplied too', () => {
        const { manager } = makeManager(1, { markerMode: 'unlimited' });

        expect(manager.beginPlace(makeGrip(), new THREE.Object3D())).toBe(true);
        manager.endPlace();
        expect(manager.beginGazePlace(makeCamera(), emptyMazeData())).toBe(true);
        manager.commitGazePlace();

        expect(manager.breadcrumbStack.length).toBe(1);
    });

    it('reads as infinite rather than as the one marker it holds', () => {
        const { manager } = makeManager(1, { markerMode: 'unlimited' });
        expect(manager.inventoryLabel).toBe('\u221e');
    });
});

describe('a finite stack', () => {
    it('empties as markers are placed, and says how many are left', () => {
        const { manager } = makeManager(2);
        const camera = makeCamera();

        expect(manager.inventoryLabel).toBe('0');
        expect(manager.addBreadcrumb(camera, emptyMazeData())).toBe(null);

        manager.removeBreadcrumb(manager.breadcrumbs[0]);
        manager.removeBreadcrumb(manager.breadcrumbs[0]);
        expect(manager.inventoryLabel).toBe('2');

        expect(manager.addBreadcrumb(camera, emptyMazeData())).not.toBe(null);
        expect(manager.inventoryLabel).toBe('1');
        expect(manager.addBreadcrumb(camera, emptyMazeData())).not.toBe(null);
        expect(manager.inventoryLabel).toBe('0');
        expect(manager.addBreadcrumb(camera, emptyMazeData())).toBe(null);
    });

    it('has nothing to place at all with markers off', () => {
        const { manager } = makeManager(2, { markerMode: 'off' });
        expect(manager.addBreadcrumb(makeCamera(), emptyMazeData())).toBe(null);
        expect(manager.beginPlace(makeGrip(), new THREE.Object3D())).toBe(false);
        expect(manager.beginGazePlace(makeCamera(), emptyMazeData())).toBe(false);
    });
});
