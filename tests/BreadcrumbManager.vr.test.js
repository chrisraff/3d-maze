// What a VR controller does to a breadcrumb: grip hover, pickup, placement and
// re-aim. The camera-driven half of the same work is in BreadcrumbManager.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { HITBOX_RADIUS } from '../js/breadcrumbs/BreadcrumbManager.js';
import * as maze from '../js/maze/maze.js';
import {
    PLAYER_GATE, GRIP_GATE, v, rotY, stubBreadcrumbDom, makeManager, placeAt,
    giveMaze, segmentAt, addWall, expectHueTintedEmissive, makeGrip, makeCamera
} from './breadcrumbHelpers.js';

beforeEach(() => stubBreadcrumbDom());

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('findNearby', () => {
    it('returns a breadcrumb within both distance gates with clear line of sight', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        placeAt(scene, b, 0, 0, 0);

        expect(manager.findNearby(v(0, 0, 0.1), v(0, 0, 1))).toBe(b);
    });

    it('returns null when the player is beyond majorWidth * 0.75', () => {
        const { manager, scene } = makeManager(1);
        placeAt(scene, manager.breadcrumbs[0], 0, 0, 0);

        expect(manager.findNearby(v(0, 0, 0.1), v(0, 0, PLAYER_GATE + 0.1))).toBeNull();
    });

    it('returns null when the grip is beyond majorWidth / 12', () => {
        const { manager, scene } = makeManager(1);
        placeAt(scene, manager.breadcrumbs[0], 0, 0, 0);

        expect(manager.findNearby(v(0, 0, GRIP_GATE + 0.05), v(0, 0, 1))).toBeNull();
    });

    it('returns null when a wall blocks line of sight from the player', () => {
        const { manager, scene } = makeManager(1);
        giveMaze(manager, [1, 1, 2]); // the panel between cells z=1 and z=3

        // breadcrumb just past the panel, player just short of it - well inside
        // both gates, so only the wall can rule it out
        const behind = segmentAt(1, 1, 2).setZ(maze.getOffset(2) + 0.2);
        placeAt(scene, manager.breadcrumbs[0], behind.x, behind.y, behind.z);
        const eye = segmentAt(1, 1, 2).setZ(maze.getOffset(2) - 0.28125);

        expect(manager.findNearby(behind, eye)).toBeNull();
    });

    it('returns the candidate closest to the grip', () => {
        const { manager, scene } = makeManager(2);
        const [b0, b1] = manager.breadcrumbs;
        placeAt(scene, b0, 0.12, 0, 0);
        placeAt(scene, b1, -0.12, 0, 0);

        // grip is 0.14 from b0 and 0.10 from b1
        expect(manager.findNearby(v(-0.02, 0, 0), v(0, 0, 1))).toBe(b1);
    });

    it('reaches a breadcrumb sitting as close to a panel as the clamp leaves it', () => {
        // Regression guard: _wallClampPosition stops HITBOX_RADIUS short of the
        // surface, which leaves the breadcrumb on the player's own side.
        const { manager, scene } = makeManager(1);
        giveMaze(manager, [1, 1, 2]);

        const face = maze.getOffset(2) - maze.minorWidth / 2;
        const clamped = segmentAt(1, 1, 2).setZ(face - HITBOX_RADIUS);
        placeAt(scene, manager.breadcrumbs[0], clamped.x, clamped.y, clamped.z);
        const eye = segmentAt(1, 1, 2).setZ(face - 0.25);

        expect(manager.findNearby(clamped, eye)).toBe(manager.breadcrumbs[0]);
    });

    it('does not reach through a panel a breadcrumb is only just behind', () => {
        // Its hitbox overhangs into the cell the player is standing in, which
        // must not count as reaching it.
        const { manager, scene } = makeManager(1);
        giveMaze(manager, [1, 1, 2]);

        const farFace = maze.getOffset(2) + maze.minorWidth / 2;
        const behind = segmentAt(1, 1, 2).setZ(farFace + 0.05);
        placeAt(scene, manager.breadcrumbs[0], behind.x, behind.y, behind.z);
        const eye = segmentAt(1, 1, 2).setZ(maze.getOffset(2) - 0.28125);

        expect(behind.z - farFace).toBeLessThan(HITBOX_RADIUS); // it really does overhang
        expect(manager.findNearby(behind, eye)).toBeNull();
    });
});

describe('beginPlace / endPlace', () => {
    it('returns false and stays idle when the stack is empty', () => {
        const { manager } = makeManager(1);
        expect(manager.breadcrumbStack).toHaveLength(0);

        expect(manager.beginPlace(makeGrip(), new THREE.Object3D())).toBe(false);
        expect(manager.interactState).toBeNull();
    });

    it('pops from the stack, adds to the scene at the grip, aimed back up the ray', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        manager.removeBreadcrumb(b);
        expect(manager.breadcrumbStack).toEqual([b]);
        expect(scene.children).not.toContain(b);

        const grip = makeGrip(0.2, 0.3, 0.4);
        const point = new THREE.Object3D(); // identity aim

        expect(manager.beginPlace(grip, point)).toBe(true);
        expect(manager.interactState).toBe('placing');
        expect(manager.interactTarget).toBe(b);
        expect(manager.breadcrumbStack).toHaveLength(0);
        expect(scene.children).toContain(b);
        expect(b.position.distanceTo(v(0.2, 0.3, 0.4))).toBeLessThan(1e-9);
        // the ray runs down the controller's -Z and +Z is the marker's facing
        // axis, so the aim quaternion as copied already points it at the player
        expect(b.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
        // not committed to placed collection until endPlace
        expect(manager.breadcrumbs).not.toContain(b);
    });

    it('aims it down the ray instead when the facing setting says Away', () => {
        const { manager } = makeManager(1);
        const [b] = manager.breadcrumbs;
        manager.removeBreadcrumb(b);
        manager.setFacingMode('away');

        manager.beginPlace(makeGrip(), new THREE.Object3D()); // identity aim

        expect(b.quaternion.angleTo(rotY(Math.PI))).toBeLessThan(1e-6);
    });

    it('endPlace commits the breadcrumb to the placed collection and clears state', () => {
        const { manager } = makeManager(1);
        const [b] = manager.breadcrumbs;
        manager.removeBreadcrumb(b);
        manager.beginPlace(makeGrip(), new THREE.Object3D());

        manager.endPlace();

        expect(manager.breadcrumbs).toContain(b);
        expect(manager.interactState).toBeNull();
        expect(manager.interactTarget).toBeNull();
    });
});

describe('updateInteract while placing', () => {
    function startPlacing(manager, grip) {
        manager.removeBreadcrumb(manager.breadcrumbs[0]);
        manager.beginPlace(grip, new THREE.Object3D());
        return manager.interactTarget;
    }

    it('follows the grip world position when unobstructed', () => {
        const { manager } = makeManager(1);
        const grip = makeGrip(0, 0, 0.5);
        const b = startPlacing(manager, grip);

        grip.position.set(0.2, 0.1, -0.3);
        manager.updateInteract(makeCamera(0, 0, 1));

        expect(b.position.distanceTo(v(0.2, 0.1, -0.3))).toBeLessThan(1e-9);
    });

    it('stops the breadcrumb a hitbox short of a wall the grip passes through', () => {
        const { manager, scene } = makeManager(1);
        addWall(scene, 0, 0, -0.5); // faces at z = -0.475 and -0.525
        const grip = makeGrip(0, 0, 0.5);
        const b = startPlacing(manager, grip);

        grip.position.set(0, 0, -1); // beyond the wall
        manager.updateInteract(makeCamera(0, 0, 1));

        // flush on the surface would leave the hitbox poking out the far side
        expect(b.position.z).toBeCloseTo(-0.475 + HITBOX_RADIUS, 6);
        expect(b.position.x).toBeCloseTo(0, 6);
        expect(b.position.y).toBeCloseTo(0, 6);
    });

    it('applies the grip rotation delta on top of the initial aim orientation', () => {
        const { manager } = makeManager(1);
        const grip = makeGrip(0, 0, 0.5);
        // Away, so the start orientation is something the delta can be told
        // apart from: identity aim -> start orient rotY(PI)
        manager.setFacingMode('away');
        const b = startPlacing(manager, grip);

        grip.quaternion.copy(rotY(Math.PI / 2));
        manager.updateInteract(makeCamera(0, 0, 1));

        const expected = rotY(Math.PI / 2).multiply(rotY(Math.PI));
        expect(b.quaternion.angleTo(expected)).toBeLessThan(1e-6);
    });
});

describe('reorienting', () => {
    it('snaps the breadcrumb to the grip origin rather than preserving the pickup offset', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        placeAt(scene, b, 0, 0, 0);
        const grip = makeGrip(0.05, 0, 0.05);

        manager.beginReorient(b, grip);
        expect(manager.interactState).toBe('reorienting');
        expect(manager.interactTarget).toBe(b);

        manager.updateInteract(makeCamera(0, 0, 1));
        expect(b.position.distanceTo(v(0.05, 0, 0.05))).toBeLessThan(1e-9);
    });

    it('applies the grip rotation delta on top of the starting orientation', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        placeAt(scene, b, 0, 0, 0);
        const startQuat = b.quaternion.clone();
        const grip = makeGrip(0, 0, 0);

        manager.beginReorient(b, grip);
        grip.quaternion.copy(rotY(Math.PI / 2));
        manager.updateInteract(makeCamera(0, 0, 1));

        const expected = rotY(Math.PI / 2).multiply(startQuat);
        expect(b.quaternion.angleTo(expected)).toBeLessThan(1e-6);
    });

    it('endReorient commits the new pose and keeps the breadcrumb placed', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        placeAt(scene, b, 0, 0, 0);
        const grip = makeGrip(0.1, 0, 0.1);

        manager.beginReorient(b, grip);
        manager.updateInteract(makeCamera(0, 0, 1));
        manager.endReorient();

        expect(manager.interactState).toBeNull();
        expect(manager.interactTarget).toBeNull();
        expect(manager.breadcrumbs).toContain(b);
        expect(manager.breadcrumbStack).not.toContain(b);
        expect(b.position.distanceTo(v(0.1, 0, 0.1))).toBeLessThan(1e-9);
    });

    it('cancelReorient restores the original pose and returns the breadcrumb to the stack', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        placeAt(scene, b, 0.3, 0.2, 0.1);
        const startPos = b.position.clone();
        const startQuat = b.quaternion.clone();
        const grip = makeGrip(0.5, 0, 0.5);
        grip.quaternion.copy(rotY(1));

        manager.beginReorient(b, grip);
        grip.position.set(1, 0, 1);
        grip.quaternion.copy(rotY(2));
        manager.updateInteract(makeCamera(0, 0, 1));
        manager.cancelReorient();

        expect(b.position.distanceTo(startPos)).toBeLessThan(1e-9);
        expect(b.quaternion.angleTo(startQuat)).toBeLessThan(1e-6);
        expect(manager.interactState).toBeNull();
        expect(manager.breadcrumbs).not.toContain(b);
        expect(manager.breadcrumbStack).toContain(b);
        expect(scene.children).not.toContain(b);
    });
});

describe('updateProximityHighlight', () => {
    it('hovers the grip-closest reachable breadcrumb across all controllers', () => {
        const { manager, scene } = makeManager(2);
        const [b0, b1] = manager.breadcrumbs;
        placeAt(scene, b0, 0, 0, 0);
        placeAt(scene, b1, 0.5, 0, 0);
        const camera = makeCamera(0, 0, 1);

        // controller 0 is 0.12 from b0; controller 1 is 0.05 from b1
        manager.updateProximityHighlight([v(0, 0, 0.12), v(0.5, 0, 0.05)], camera);

        expect(manager.hoveredBreadcrumb).toBe(b1);
        expectHueTintedEmissive(b1);
        expect(b0.userData.mesh.material.emissive.getHex()).toBe(0x000000);
    });

    it('clears the hover when no breadcrumb is in reach', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        placeAt(scene, b, 0, 0, 0);
        const camera = makeCamera(0, 0, 1);

        manager.updateProximityHighlight([v(0, 0, 0.1)], camera);
        expect(manager.hoveredBreadcrumb).toBe(b);

        manager.updateProximityHighlight([v(5, 5, 5)], camera);
        expect(manager.hoveredBreadcrumb).toBeNull();
        expect(b.userData.mesh.material.emissive.getHex()).toBe(0x000000);
    });

    it('keeps the target highlighted while reorienting', () => {
        const { manager, scene } = makeManager(1);
        const [b] = manager.breadcrumbs;
        placeAt(scene, b, 0, 0, 0);

        manager.beginReorient(b, makeGrip(0, 0, 0.1));
        manager.updateProximityHighlight([], makeCamera(0, 0, 1));

        expect(manager.hoveredBreadcrumb).toBe(b);
        expectHueTintedEmissive(b);
    });

    it('clears the hover while placing', () => {
        const { manager, scene } = makeManager(2);
        const [b0, b1] = manager.breadcrumbs;
        placeAt(scene, b0, 0, 0, 0);
        placeAt(scene, b1, 0.5, 0, 0);
        const camera = makeCamera(0, 0, 1);

        manager.updateProximityHighlight([v(0, 0, 0.12)], camera);
        expect(manager.hoveredBreadcrumb).toBe(b0);

        manager.removeBreadcrumb(b1);
        manager.beginPlace(makeGrip(0.5, 0, 0.5), new THREE.Object3D());
        manager.updateProximityHighlight([v(0, 0, 0.12)], camera);

        expect(manager.hoveredBreadcrumb).toBeNull();
    });
});
