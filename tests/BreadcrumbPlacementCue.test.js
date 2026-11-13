// The motion cue that plays after a placement: three square bands leaving the
// marker along the way it points. What matters is that they go the direction
// the marker actually faces, that a double-click restarts them pointing the
// other way, and that they launch together with some speed already on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { CUE_SETTLE_MS } from '../js/breadcrumbs/BreadcrumbManager.js';
import {
    TRAVEL, BAND_COUNT, BAND_SPACING, SPAWN_OFFSET_TOWARD, SPAWN_OFFSET_AWAY,
    CUE_SECONDS
} from '../js/breadcrumbs/BreadcrumbPlacementCue.js';
import { v, stubBreadcrumbDom, makeManager, makeCamera } from './breadcrumbHelpers.js';

const emptyMazeData = () => ({
    segments: [50, 50, 50],
    bounds: [4, 4, 4],
    collision_map: Array.from({ length: 5 },
        () => Array.from({ length: 5 }, () => Array(5).fill(false)))
});

// a manager with everything in hand, so a placement is the only breadcrumb out
function makeEmptyHandedManager() {
    const { manager, scene } = makeManager(1);
    for (const b of [...manager.breadcrumbs]) manager.removeBreadcrumb(b);
    scene.updateMatrixWorld(true);

    const camera = makeCamera(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);
    return { manager, scene, camera };
}

// place, then let the settle time pass so the cue fires. updateGlowForCamera
// is what update() runs first in a real frame, and it is where the player
// position the cue reads comes from.
function placeAndSettle(manager, camera, now = 1000) {
    const placed = manager.addBreadcrumb(camera, emptyMazeData());
    manager._rememberPlacement(placed, now);
    manager.updateGlowForCamera(camera);
    manager.updatePlacementCue(0, now + CUE_SETTLE_MS);
    return placed;
}

const visibleBands = (manager) => manager.placementCue.bands.filter(b => b.visible);

// where a band sits relative to the marker, in world space
function bandOffset(manager, band) {
    manager.placementCue.group.updateMatrixWorld(true);
    return band.getWorldPosition(new THREE.Vector3())
        .sub(manager.placementCue.group.position);
}

beforeEach(() => stubBreadcrumbDom());

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('when the cue fires', () => {
    it('holds off until the settle time, rather than firing on the click', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = manager.addBreadcrumb(camera, emptyMazeData());
        manager._rememberPlacement(placed, 1000);

        manager.updatePlacementCue(0, 1000 + CUE_SETTLE_MS - 1);

        expect(manager.placementCue.isPlaying).toBe(false);
    });

    it('plays once the settle time has passed', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAndSettle(manager, camera);

        expect(manager.placementCue.isPlaying).toBe(true);
        expect(manager.placementCue.breadcrumb).toBe(placed);
    });

    it('starts over from the top on a re-aim, mid-cue', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAndSettle(manager, camera);
        manager.placementCue.update(0.2);
        manager.scene.updateMatrixWorld(true);

        expect(manager._tryReversePlacementAim(camera, placed, 1100)).toBe(true);

        expect(manager.placementCue.isPlaying).toBe(true);
        expect(manager.placementCue.breadcrumb).toBe(placed);
        // sitting on its launch point, which only happens at t = 0: it
        // started over rather than carrying on from partway through
        expect(manager.placementCue.bands[0].position.z).toBeCloseTo(SPAWN_OFFSET_AWAY, 6);
    });

    it('never plays for a breadcrumb picked back up before it fires', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = manager.addBreadcrumb(camera, emptyMazeData());
        manager._rememberPlacement(placed, 1000);

        manager.removeBreadcrumb(placed);
        manager.updatePlacementCue(0, 1000 + CUE_SETTLE_MS);

        expect(manager.placementCue.isPlaying).toBe(false);
    });

    it('stops when its breadcrumb is picked up mid-cue', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAndSettle(manager, camera);

        manager.removeBreadcrumb(placed);

        expect(manager.placementCue.isPlaying).toBe(false);
        expect(visibleBands(manager)).toHaveLength(0);
    });

    it('leaves a running cue alone when a different breadcrumb is picked up', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const first = manager.addBreadcrumb(camera, emptyMazeData());
        const second = placeAndSettle(manager, camera, 2000);

        manager.removeBreadcrumb(first);

        expect(manager.placementCue.breadcrumb).toBe(second);
    });

    it('stops when a new maze clears the breadcrumb out from under it', () => {
        const { manager, camera } = makeEmptyHandedManager();
        placeAndSettle(manager, camera);

        manager.initializeMaze({
            segments: [50, 50, 50],
            analytics: { dead_ends_data: [{ position: [0, 0, 0], direction: [0, 0, 1] }] }
        });

        expect(manager.placementCue.isPlaying).toBe(false);
    });

    it('ends when the flight is over', () => {
        const { manager, camera } = makeEmptyHandedManager();
        placeAndSettle(manager, camera);

        manager.placementCue.update(CUE_SECONDS);

        expect(manager.placementCue.isPlaying).toBe(false);
        expect(manager.placementCue.group.visible).toBe(false);
    });

});

// Placing and repositioning are separate gestures on a controller: a grip in
// open space pulls a new marker off the stack, a grip on one already down
// moves it (see VRManager's selectstart). Only the first is a placement, and
// only the first gets a cue.
describe('in VR', () => {
    const makeGrip = () => new THREE.Object3D();

    it('fires when the hand lets go of a newly placed marker', () => {
        const { manager } = makeEmptyHandedManager();

        expect(manager.beginPlace(makeGrip(), new THREE.Object3D())).toBe(true);
        const placed = manager.interactTarget;
        manager.endPlace();

        // the hand aimed it, so there is nothing left to settle
        expect(manager.placementCue.isPlaying).toBe(true);
        expect(manager.placementCue.breadcrumb).toBe(placed);
    });

    it('stays quiet when a marker already down is only repositioned', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAndSettle(manager, camera);
        manager.placementCue.update(CUE_SECONDS);   // let the placement's own cue finish

        manager.beginReorient(placed, makeGrip());
        manager.endReorient();

        expect(manager.placementCue.isPlaying).toBe(false);
    });

    it('lets a cue already running play out when the marker is grabbed', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAndSettle(manager, camera);
        expect(manager.placementCue.isPlaying).toBe(true);

        manager.beginReorient(placed, makeGrip());
        manager.placementCue.update(CUE_SECONDS / 2);

        // a grab interrupts nothing: the bands run their course, following
        // the marker in the hand
        expect(manager.placementCue.isPlaying).toBe(true);
        expect(manager.placementCue.breadcrumb).toBe(placed);
    });

    it('still fires a cue the grab beat to the settle time', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = manager.addBreadcrumb(camera, emptyMazeData());
        manager._rememberPlacement(placed, 1000);

        manager.beginReorient(placed, makeGrip());
        manager.updateGlowForCamera(camera);
        manager.updatePlacementCue(0, 1000 + CUE_SETTLE_MS);

        // the placement happened; being grabbed since doesn't unmake it
        expect(manager.placementCue.isPlaying).toBe(true);
    });
});

describe('which way the bands go', () => {
    // the marker's own facing axis, which the bands travel along: the
    // launch point sits behind the marker, so what has to point this way is
    // the distance covered, not where a band happens to be
    const facingOf = (placed) => v(0, 0, 1).applyQuaternion(placed.quaternion);

    it('leaves along the facing axis, which is toward the player by default', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAndSettle(manager, camera);
        const start = bandOffset(manager, manager.placementCue.bands[0]).clone();
        manager.placementCue.update(0.2);

        const [band] = visibleBands(manager);
        const travelled = bandOffset(manager, band).sub(start);
        const toPlayer = camera.position.clone().sub(placed.position).normalize();

        expect(travelled.length()).toBeGreaterThan(0);
        expect(travelled.clone().normalize().dot(toPlayer)).toBeCloseTo(1, 6);
        expect(travelled.dot(facingOf(placed))).toBeGreaterThan(0);
    });

    it('leaves away from the player once a re-aim has turned the marker around', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = manager.addBreadcrumb(camera, emptyMazeData());
        manager._rememberPlacement(placed, 1000);
        manager.scene.updateMatrixWorld(true);
        manager._tryReversePlacementAim(camera, placed, 1100);
        const start = bandOffset(manager, manager.placementCue.bands[0]).clone();
        manager.placementCue.update(0.2);

        const [band] = visibleBands(manager);
        const travelled = bandOffset(manager, band).sub(start);
        const toPlayer = camera.position.clone().sub(placed.position).normalize();

        expect(travelled.clone().normalize().dot(toPlayer)).toBeCloseTo(-1, 6);
        // the marker turned around, so the same local motion reversed with it
        expect(travelled.dot(facingOf(placed))).toBeGreaterThan(0);
    });

    it('follows a marker that is still being moved', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAndSettle(manager, camera);
        manager.placementCue.update(0.2);

        placed.position.set(0.5, 0.25, -0.75);
        manager.placementCue.update(0.01);

        expect(manager.placementCue.group.position.distanceTo(placed.position)).toBeCloseTo(0, 6);
    });
});

describe('where the bands launch', () => {
    it('starts further back on a marker aimed at the player', () => {
        const { manager, camera } = makeEmptyHandedManager();
        placeAndSettle(manager, camera);

        // behind the arrowhead, which is covering that spot from here
        expect(manager.placementCue.bands[0].position.z).toBeCloseTo(SPAWN_OFFSET_TOWARD, 6);
        expect(SPAWN_OFFSET_TOWARD).toBeLessThan(SPAWN_OFFSET_AWAY);
    });

    it('starts at the marker itself once it is aimed away', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAndSettle(manager, camera);
        manager.scene.updateMatrixWorld(true);

        manager._tryReversePlacementAim(camera, placed, 1100);

        // the player is looking at the arrow's back now, so there is nothing
        // in the way and no run-up to find
        expect(manager.placementCue.bands[0].position.z).toBeCloseTo(SPAWN_OFFSET_AWAY, 6);
    });

    it('assumes a marker faces the player when nobody says otherwise', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAndSettle(manager, camera);

        manager.placementCue.start(placed);   // no viewer position

        expect(manager.placementCue.bands[0].position.z).toBeCloseTo(SPAWN_OFFSET_TOWARD, 6);
    });
});

// Everything above runs on the default facing, where a marker points back
// at the player. Away is the same cue with the other launch point, and the
// timing it hangs off - the settle delay, and a re-aim restarting it - has to
// be the same on both sides, or half the setting's players get a cue that
// fires before the gesture it answers is finished.
describe('with the facing setting on Away', () => {
    const facingTowardCamera = (placed, camera) => v(0, 0, 1)
        .applyQuaternion(placed.quaternion)
        .dot(camera.position.clone().sub(placed.position).normalize());

    function placeAway(manager, camera, now = 1000) {
        manager.setFacingMode('away');
        const placed = manager.addBreadcrumb(camera, emptyMazeData());
        manager._rememberPlacement(placed, now);
        manager.scene.updateMatrixWorld(true);
        return placed;
    }

    it('still holds off until the settle time', () => {
        const { manager, camera } = makeEmptyHandedManager();
        placeAway(manager, camera);

        manager.updateGlowForCamera(camera);
        manager.updatePlacementCue(0, 1000 + CUE_SETTLE_MS - 1);

        expect(manager.placementCue.isPlaying).toBe(false);
    });

    it('fires at the settle time, launching from the marker itself', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAway(manager, camera);

        manager.updateGlowForCamera(camera);
        manager.updatePlacementCue(0, 1000 + CUE_SETTLE_MS);

        expect(manager.placementCue.isPlaying).toBe(true);
        expect(facingTowardCamera(placed, camera)).toBeCloseTo(-1, 6);
        expect(manager.placementCue.bands[0].position.z).toBeCloseTo(SPAWN_OFFSET_AWAY, 6);
    });

    it('leaves away from the player, the way the marker points', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAway(manager, camera);
        manager.updateGlowForCamera(camera);
        manager.updatePlacementCue(0, 1000 + CUE_SETTLE_MS);
        const start = bandOffset(manager, manager.placementCue.bands[0]).clone();

        manager.placementCue.update(0.2);

        const [band] = visibleBands(manager);
        const travelled = bandOffset(manager, band).sub(start);
        const toPlayer = camera.position.clone().sub(placed.position).normalize();

        expect(travelled.length()).toBeGreaterThan(0);
        expect(travelled.clone().normalize().dot(toPlayer)).toBeCloseTo(-1, 6);
    });

    // the gesture is a reversal, so on this setting it is the one that lands
    // a marker facing the player - and the cue has to find the run-up again
    it('restarts from the far launch point when a re-aim turns it toward the player', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAway(manager, camera);
        manager.updateGlowForCamera(camera);
        manager.updatePlacementCue(0, 1000 + CUE_SETTLE_MS);
        manager.placementCue.update(0.2);

        expect(manager._tryReversePlacementAim(camera, placed, 1100)).toBe(true);

        expect(facingTowardCamera(placed, camera)).toBeCloseTo(1, 6);
        expect(manager.placementCue.isPlaying).toBe(true);
        expect(manager.placementCue.bands[0].position.z).toBeCloseTo(SPAWN_OFFSET_TOWARD, 6);
    });
});

describe('how the bands move', () => {
    it('launches with speed already on, then gathers more', () => {
        const { manager, camera } = makeEmptyHandedManager();
        placeAndSettle(manager, camera);
        const [first] = manager.placementCue.bands;

        const step = CUE_SECONDS / 10;
        manager.placementCue.update(step);
        const openingStep = first.position.z - SPAWN_OFFSET_TOWARD;
        const before = first.position.z;
        manager.placementCue.update(step);
        const secondStep = first.position.z - before;

        // moving on the opening step rather than creeping off a standstill
        expect(openingStep).toBeGreaterThan(TRAVEL * 0.02);
        // but not so hard that the opening reads as a jump
        expect(openingStep).toBeLessThan(TRAVEL * 0.1);
        // and still speeding up after it
        expect(secondStep).toBeGreaterThan(openingStep);
    });

    it('is still accelerating at the halfway mark', () => {
        const { manager, camera } = makeEmptyHandedManager();
        placeAndSettle(manager, camera);
        const [first] = manager.placementCue.bands;

        manager.placementCue.update(CUE_SECONDS / 2);
        const half = first.position.z - SPAWN_OFFSET_TOWARD;

        // past a standing start's quarter, short of constant speed's half
        expect(half).toBeGreaterThan(TRAVEL / 4);
        expect(half).toBeLessThan(TRAVEL / 2);
    });

    it('covers TRAVEL from its launch point before it goes', () => {
        const { manager, camera } = makeEmptyHandedManager();
        placeAndSettle(manager, camera);
        const [first] = manager.placementCue.bands;

        let last = SPAWN_OFFSET_TOWARD;
        for (let t = 0; t < CUE_SECONDS; t += 0.01) {
            manager.placementCue.update(0.01);
            if (first.visible) last = first.position.z;
        }

        expect(last - SPAWN_OFFSET_TOWARD).toBeGreaterThan(TRAVEL * 0.9);
        expect(last - SPAWN_OFFSET_TOWARD).toBeLessThanOrEqual(TRAVEL);
    });

    it('fades out over the back half of the flight', () => {
        const { manager, camera } = makeEmptyHandedManager();
        placeAndSettle(manager, camera);
        const [first] = manager.placementCue.bands;

        manager.placementCue.update(0.001);
        const opening = first.material.opacity;
        manager.placementCue.update(CUE_SECONDS * 0.7);
        const fading = first.material.opacity;
        manager.placementCue.update(CUE_SECONDS * 0.29);
        const gone = first.material.opacity;

        expect(opening).toBeGreaterThan(0);
        expect(fading).toBeLessThan(opening);
        expect(gone).toBeLessThan(fading);
        expect(gone).toBeLessThan(0.1);
    });

    it('launches all three at once, already spaced out', () => {
        const { manager, camera } = makeEmptyHandedManager();
        placeAndSettle(manager, camera);

        expect(visibleBands(manager)).toHaveLength(BAND_COUNT);

        // the leader starts at the marker's widest point, the rest trail it
        // by a fixed gap they hold for the whole flight
        const atLaunch = manager.placementCue.bands.map(b => b.position.z);
        expect(atLaunch[0]).toBeCloseTo(SPAWN_OFFSET_TOWARD, 6);
        expect(atLaunch[0] - atLaunch[1]).toBeCloseTo(BAND_SPACING, 6);
        expect(atLaunch[1] - atLaunch[2]).toBeCloseTo(BAND_SPACING, 6);

        manager.placementCue.update(CUE_SECONDS / 2);

        const midFlight = manager.placementCue.bands.map(b => b.position.z);
        expect(midFlight[0] - midFlight[1]).toBeCloseTo(BAND_SPACING, 6);
        expect(midFlight[0]).toBeGreaterThan(atLaunch[0]);
    });

    it('wears the marker own color', () => {
        const { manager, camera } = makeEmptyHandedManager();
        const placed = placeAndSettle(manager, camera);

        const markerHsl = { h: 0, s: 0, l: 0 };
        placed.userData.originalMaterial.color.getHSL(markerHsl);
        const bandHsl = { h: 0, s: 0, l: 0 };
        manager.placementCue.bands[0].material.color.getHSL(bandHsl);

        expect(bandHsl.h).toBeCloseTo(markerHsl.h, 6);
        // the hue survives, pulled partway toward white so it stays legible
        // against a panel of its own hue - see WHITENESS. A tint of a fully
        // saturated hue is still fully saturated in HSL, so lightness is
        // where that pull shows up.
        expect(bandHsl.l).toBeGreaterThan(markerHsl.l);
    });
});
