import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import BreadcrumbManager, { GHOST_OPACITY } from '../js/BreadcrumbManager.js';

// A wall-free maze, so the collision passes leave placement alone.
const emptyMazeData = () => ({
    bounds: [2, 2, 2],
    collision_map: Array.from({ length: 5 },
        () => Array.from({ length: 5 }, () => Array(5).fill(false)))
});

beforeEach(() => {
    vi.stubGlobal('document', { getElementById: () => ({ innerText: '' }) });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function makeManager() {
    const manager = new BreadcrumbManager();
    const scene = new THREE.Scene();
    manager.addTo(scene);

    // initializeMaze fills half the dead ends, and its selection loop spins
    // forever on a constant Math.random - cycle it so distinct indices come up
    const deadEnds = [];
    for (let i = 0; i < 4; i++)
        deadEnds.push({ position: [i * 4, 0, 0], direction: [0, 0, 1] });

    let calls = 0;
    const rand = vi.spyOn(Math, 'random')
        .mockImplementation(() => (calls++ % deadEnds.length) / deadEnds.length);
    manager.initializeMaze({ segments: [50, 50, 50], analytics: { dead_ends_data: deadEnds } });
    rand.mockRestore();

    manager.setPointerGeometry(new THREE.BoxGeometry(0.2, 0.2, 0.2));

    // everything into the player's hand, so nothing is already placed
    for (const b of [...manager.breadcrumbs])
        manager.removeBreadcrumb(b);
    scene.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);
    return { manager, camera, scene };
}

const facingTowardCamera = (breadcrumb, camera) => {
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(breadcrumb.quaternion);
    const toCamera = camera.position.clone().sub(breadcrumb.position).normalize();
    return facing.dot(toCamera);
};

describe('tryGazePickup', () => {
    it('takes the breadcrumb the player is looking at', () => {
        const { manager, camera, scene } = makeManager();
        const placed = manager.addBreadcrumb(camera, emptyMazeData());
        scene.updateMatrixWorld(true);
        const held = manager.breadcrumbStack.length;

        expect(manager.tryGazePickup(camera)).toBe(true);

        expect(manager.breadcrumbs).not.toContain(placed);
        expect(manager.breadcrumbStack).toHaveLength(held + 1);
        expect(manager.pickupCount).toBe(1);
    });

    // the tap has to fall through to movement, or gaze players lose their
    // primary control whenever a marker drifts into view
    it('leaves the tap alone when there is nothing to take', () => {
        const { manager, camera } = makeManager();

        expect(manager.tryGazePickup(camera)).toBe(false);
        expect(manager.pickupCount).toBe(0);
    });

    it('does nothing mid-placement, which commits instead', () => {
        const { manager, camera, scene } = makeManager();
        manager.addBreadcrumb(camera, emptyMazeData());
        scene.updateMatrixWorld(true);
        manager.beginGazePlace(camera, emptyMazeData());

        expect(manager.tryGazePickup(camera)).toBe(false);
        expect(manager.isGazePlacing).toBe(true);
    });
});

// VRManager.update() runs before breadcrumbs.update(), so if the grip pass
// answered for gaze it would clear the hover every frame and the raycast would
// set it back - the highlight would churn instead of holding.
describe('updateProximityHighlight with no grips', () => {
    it('leaves the hover alone', () => {
        const { manager, camera, scene } = makeManager();
        const placed = manager.addBreadcrumb(camera, emptyMazeData());
        scene.updateMatrixWorld(true);
        manager._setHoveredBreadcrumb(placed);

        manager.updateProximityHighlight([], camera);

        expect(manager.hoveredBreadcrumb).toBe(placed);
    });

    it('leaves it alone mid gaze-placement too', () => {
        const { manager, camera, scene } = makeManager();
        const placed = manager.addBreadcrumb(camera, emptyMazeData());
        scene.updateMatrixWorld(true);
        manager.beginGazePlace(camera, emptyMazeData());
        manager._setHoveredBreadcrumb(placed);

        manager.updateProximityHighlight([], camera);

        expect(manager.hoveredBreadcrumb).toBe(placed);
    });
});

describe('gaze placement', () => {
    it('takes a breadcrumb out of the stack and shows it', () => {
        const { manager, camera, scene } = makeManager();
        const held = manager.breadcrumbStack.length;

        expect(manager.beginGazePlace(camera, emptyMazeData())).toBe(true);

        expect(manager.isGazePlacing).toBe(true);
        expect(manager.breadcrumbStack).toHaveLength(held - 1);
        expect(scene.children).toContain(manager.interactTarget);
        // not placed yet, so nothing picks it up or glows it
        expect(manager.breadcrumbs).toHaveLength(0);
    });

    it('refuses when the player is empty-handed', () => {
        const { manager, camera } = makeManager();
        manager.breadcrumbStack = [];

        expect(manager.beginGazePlace(camera, emptyMazeData())).toBe(false);
        expect(manager.isGazePlacing).toBe(false);
    });

    it('previews exactly where a tap would drop it', () => {
        const { manager, camera } = makeManager();

        manager.beginGazePlace(camera, emptyMazeData());
        const previewed = manager.interactTarget.position.clone();
        const previewedFacing = manager.interactTarget.quaternion.clone();
        manager.cancelGazePlace();

        // what an ordinary tap does, from the same pose
        const placed = manager.addBreadcrumb(camera, emptyMazeData());

        expect(placed.position.distanceTo(previewed)).toBeCloseTo(0, 6);
        expect(placed.quaternion.angleTo(previewedFacing)).toBeCloseTo(0, 6);
    });

    it('follows the look direction', () => {
        const { manager, camera } = makeManager();
        manager.beginGazePlace(camera, emptyMazeData());
        const before = manager.interactTarget.position.clone();

        camera.lookAt(1, 0, 0);
        camera.updateMatrixWorld(true);
        manager.updateGazePlace(camera, emptyMazeData());

        expect(manager.interactTarget.position.distanceTo(before)).toBeGreaterThan(0.1);
    });

    it('aims away from the player, like a tap placement', () => {
        const { manager, camera } = makeManager();

        manager.beginGazePlace(camera, emptyMazeData());

        expect(facingTowardCamera(manager.interactTarget, camera)).toBeCloseTo(-1, 6);
    });

    it('commits where it stands', () => {
        const { manager, camera, scene } = makeManager();
        manager.beginGazePlace(camera, emptyMazeData());
        const at = manager.interactTarget.position.clone();

        const placed = manager.commitGazePlace();

        expect(manager.isGazePlacing).toBe(false);
        expect(manager.breadcrumbs).toContain(placed);
        expect(scene.children).toContain(placed);
        expect(placed.position.distanceTo(at)).toBeCloseTo(0, 6);
        expect(manager.placeCount).toBe(1);
    });

    it('gives it back on cancel', () => {
        const { manager, camera, scene } = makeManager();
        const held = manager.breadcrumbStack.length;
        manager.beginGazePlace(camera, emptyMazeData());

        manager.cancelGazePlace();

        expect(manager.isGazePlacing).toBe(false);
        expect(manager.breadcrumbStack).toHaveLength(held);
        expect(manager.breadcrumbs).toHaveLength(0);
        expect(scene.children).not.toContain(manager.breadcrumbStack.at(-1));
        expect(manager.placeCount).toBe(0);
    });

    it('is translucent while previewing and solid once placed', () => {
        const { manager, camera } = makeManager();

        manager.beginGazePlace(camera, emptyMazeData());
        const material = manager.interactTarget.userData.mesh.material;
        expect(material.transparent).toBe(true);
        expect(material.opacity).toBeCloseTo(GHOST_OPACITY, 6);

        manager.commitGazePlace();
        expect(material.transparent).toBe(false);
        expect(material.opacity).toBeCloseTo(1, 6);
    });

    it('drops an in-flight preview when a new maze loads', () => {
        const { manager, camera, scene } = makeManager();
        manager.beginGazePlace(camera, emptyMazeData());
        const ghost = manager.interactTarget;

        const rand = vi.spyOn(Math, 'random').mockReturnValue(0);
        manager.initializeMaze({
            segments: [50, 50, 50],
            analytics: { dead_ends_data: [{ position: [0, 0, 0], direction: [0, 0, 1] }] }
        });
        rand.mockRestore();

        expect(manager.isGazePlacing).toBe(false);
        expect(scene.children).not.toContain(ghost);
    });

    // VRManager calls updateInteract every frame for the controller paths. It
    // used to guard only on `state === null`, so gaze placing walked into it
    // and dereferenced a grip object that gaze never has - throwing inside the
    // XR animate loop, which is a black headset.
    it('is ignored by the grip-driven updateInteract', () => {
        const { manager, camera } = makeManager();
        manager.beginGazePlace(camera, emptyMazeData());
        const at = manager.interactTarget.position.clone();

        expect(() => manager.updateInteract(camera)).not.toThrow();
        expect(manager.interactTarget.position.distanceTo(at)).toBeCloseTo(0, 6);
    });

    it('will not start on top of another interaction', () => {
        const { manager, camera } = makeManager();
        manager.beginGazePlace(camera, emptyMazeData());

        expect(manager.beginGazePlace(camera, emptyMazeData())).toBe(false);
    });
});
