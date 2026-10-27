/**
 * Shared fixtures for the BreadcrumbManager suites: a manager holding real
 * breadcrumbs in a scene, the collision maps its reachability tests read, and
 * the gates its own constants imply.
 */
import { vi, expect } from 'vitest';
import * as THREE from 'three';
import BreadcrumbManager, { HOVER_EMISSIVE, HOVER_EMISSIVE_WHITENESS, SIGHT_CELLS } from '../js/breadcrumbs/BreadcrumbManager.js';
import * as maze from '../js/maze/maze.js';

// Gates from findNearby / updateGlowHighlight
export const PLAYER_GATE = maze.majorWidth * 0.75; // 1.5
export const GRIP_GATE = maze.majorWidth / 12;     // ~0.1667
export const CELL_PITCH = maze.getOffset(3) - maze.getOffset(1);
export const SIGHT_GATE = SIGHT_CELLS * CELL_PITCH;

export const v = (x, y, z) => new THREE.Vector3(x, y, z);
export const rotY = (angle) =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

// updateBreadCrumbDisplay writes to #breadcrumb-container; stub the DOM.
export function stubBreadcrumbDom() {
    vi.stubGlobal('document', { getElementById: () => ({ innerText: '' }) });
}

// Build a manager with `count` real breadcrumbs created through initializeMaze
// (Math.random is stubbed so the first `count` dead ends are always selected).
export function makeManager(count = 1) {
    const manager = new BreadcrumbManager();
    const scene = new THREE.Scene();
    manager.addTo(scene);

    const deadEnds = [];
    for (let i = 0; i < count * 2; i++) {
        deadEnds.push({ position: [i * 4, 0, 0], direction: [0, 0, 1] });
    }
    const n = deadEnds.length;
    let calls = 0;
    const rand = vi.spyOn(Math, 'random').mockImplementation(() => (calls++ % n) / n);
    manager.initializeMaze({ segments: [50, 50, 50], analytics: { dead_ends_data: deadEnds } });
    rand.mockRestore();

    manager.setPointerGeometry(new THREE.BoxGeometry(0.2, 0.2, 0.2));
    scene.updateMatrixWorld(true);
    return { manager, scene };
}

export function placeAt(scene, breadcrumb, x, y, z) {
    breadcrumb.position.set(x, y, z);
    scene.updateMatrixWorld(true);
}

// Reachability is answered by the collision map, so a manager that needs walls
// gets one: every segment open but the panels named here. Indices follow
// maze.js - odd is a cell, even the panel between two.
export function giveMaze(manager, ...solidPanels) {
    const size = 9;
    const collision_map = Array.from({ length: size }, () =>
        Array.from({ length: size }, () => new Array(size).fill(false)));
    for (const [i, j, k] of solidPanels) collision_map[i][j][k] = true;
    manager.mazedata = { ...manager.mazedata, collision_map, bounds: [4, 4, 4] };
}

// the world position of a segment's centre
export const segmentAt = (i, j, k) => v(maze.getOffset(i), maze.getOffset(j), maze.getOffset(k));

// A wall collision hitbox as MazeWorld sets them up: layer 3 + isMazeWallHitBox.
// Only _wallClampPosition still raycasts these; line of sight reads the map.
export function addWall(scene, x, y, z, { width = 4, height = 4, depth = 0.05 } = {}) {
    const wall = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshBasicMaterial()
    );
    wall.position.set(x, y, z);
    wall.userData.isMazeWallHitBox = true;
    wall.layers.set(3);
    scene.add(wall);
    scene.updateMatrixWorld(true);
    return wall;
}

// a hovered breadcrumb lights up in its own hue pulled partway toward white,
// not in plain white - assert against the material's actual color so this
// stays independent of which random hue the stubbed Math.random produced
export function expectHueTintedEmissive(breadcrumb) {
    const { color, emissive } = breadcrumb.userData.mesh.material;
    const expected = color.clone()
        .lerp(new THREE.Color(1, 1, 1), HOVER_EMISSIVE_WHITENESS)
        .multiplyScalar(HOVER_EMISSIVE);
    for (const channel of ['r', 'g', 'b'])
        expect(emissive[channel]).toBeCloseTo(expected[channel], 6);
}

export function makeGrip(x = 0, y = 0, z = 0) {
    const grip = new THREE.Object3D();
    grip.position.set(x, y, z);
    return grip;
}

export function makeCamera(x = 0, y = 0, z = 0) {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(x, y, z);
    return camera;
}
