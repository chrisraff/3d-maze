import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import BreadcrumbManager, {
    TAP_ZONE_DIAMETER_SCALE,
    TAP_ZONE_EDGE_MARGIN_PX,
    DOUBLE_ACTIVATE_MS
} from '../js/BreadcrumbManager.js';
import { YIELD } from '../js/TouchArbiter.js';

// A wide phone in landscape, and the narrowest shape the game lets you play in
// (isValidMobileAspectRatio in game.js requires width * 3.95 / 3 > height).
const WIDE = { width: 844, height: 390 };
const NARROW = { width: 1024, height: 1300 };

// 44px box with a 10px margin, pinned to the top right. Its bottom edge is
// the boundary case: the part nearest the zone, so what the margin must clear.
const PAUSE_BUTTON_POINTS = (w) => [
    { x: w - 32, y: 32 },  // centre
    { x: w - 10, y: 54 },  // bottom left corner, nearest the zone
];

beforeEach(() => {
    vi.stubGlobal('document', { getElementById: () => ({ innerText: '' }) });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const inZone = (manager, x, y, { width, height }) =>
    manager.isWithinTapZone(x, y, width, height);

describe('isWithinTapZone', () => {
    it('accepts the centre of the screen', () => {
        const manager = new BreadcrumbManager();
        expect(inZone(manager, WIDE.width / 2, WIDE.height / 2, WIDE)).toBe(true);
    });

    it('rejects the far left and right ends of a wide screen', () => {
        const manager = new BreadcrumbManager();
        const midY = WIDE.height / 2;

        expect(inZone(manager, 20, midY, WIDE)).toBe(false);
        expect(inZone(manager, WIDE.width - 20, midY, WIDE)).toBe(false);
    });

    it('keeps the full height usable through the middle of the screen', () => {
        // the circle is taller than the viewport, so only the margin trims here
        const manager = new BreadcrumbManager();
        const midX = WIDE.width / 2;

        expect(inZone(manager, midX, TAP_ZONE_EDGE_MARGIN_PX + 1, WIDE)).toBe(true);
        expect(inZone(manager, midX, WIDE.height - TAP_ZONE_EDGE_MARGIN_PX - 1, WIDE)).toBe(true);
        expect(inZone(manager, midX, TAP_ZONE_EDGE_MARGIN_PX - 1, WIDE)).toBe(false);
    });

    it('rejects the pause button corner in both playable aspect ratios', () => {
        const manager = new BreadcrumbManager();

        for (const viewport of [WIDE, NARROW])
            for (const pause of PAUSE_BUTTON_POINTS(viewport.width))
                expect(inZone(manager, pause.x, pause.y, viewport)).toBe(false);
    });

    it('rejects all four corners', () => {
        const manager = new BreadcrumbManager();

        for (const [x, y] of [[0, 0], [WIDE.width, 0], [0, WIDE.height], [WIDE.width, WIDE.height]])
            expect(inZone(manager, x, y, WIDE)).toBe(false);
    });

    it('still has a usable centre on a viewport smaller than twice the margin', () => {
        // the margin cap keeps it from insetting past the middle
        const manager = new BreadcrumbManager();
        const tiny = { width: TAP_ZONE_EDGE_MARGIN_PX, height: TAP_ZONE_EDGE_MARGIN_PX };

        expect(inZone(manager, tiny.width / 2, tiny.height / 2, tiny)).toBe(true);
    });

    it('scales the oval with the viewport height', () => {
        const manager = new BreadcrumbManager();
        const radius = WIDE.height * TAP_ZONE_DIAMETER_SCALE / 2;
        const midY = WIDE.height / 2;

        // walk out along the horizontal centre line, where the oval is widest
        expect(inZone(manager, WIDE.width / 2 + radius - 1, midY, WIDE)).toBe(true);
        expect(inZone(manager, WIDE.width / 2 + radius + 1, midY, WIDE)).toBe(false);
    });
});

describe('createTouchHandler tap zone gating', () => {
    function setup() {
        const manager = new BreadcrumbManager();
        vi.stubGlobal('window', { innerWidth: WIDE.width, innerHeight: WIDE.height });
        const handler = manager.createTouchHandler({ camera: null, getMazeData: () => null });
        return { manager, handler };
    }

    const touchAt = (x, y) => ({ identifier: 1, clientX: x, clientY: y });
    const session = { startTime: 1000 };

    it('yields an edge touch to the camera without tracking a tap', () => {
        const { manager, handler } = setup();

        expect(handler.onTouchStart(session, touchAt(20, WIDE.height / 2))).toBe(YIELD);
        expect(manager.touchData[1]).toBeUndefined();
    });

    it('tracks a tap started inside the zone', () => {
        const { manager, handler } = setup();

        expect(handler.onTouchStart(session, touchAt(WIDE.width / 2, WIDE.height / 2))).not.toBe(YIELD);
        expect(manager.touchData[1]).toBeDefined();
    });
});

describe('double click / tap placement facing', () => {
    // a wall-free maze, so addBreadcrumb's collision passes leave placement alone
    const emptyMazeData = () => ({
        bounds: [2, 2, 2],
        collision_map: Array.from({ length: 5 },
            () => Array.from({ length: 5 }, () => Array(5).fill(false)))
    });

    function makeManager() {
        const manager = new BreadcrumbManager();
        const scene = new THREE.Scene();
        manager.addTo(scene);

        vi.stubGlobal('window', { innerWidth: WIDE.width, innerHeight: WIDE.height });
        const rand = vi.spyOn(Math, 'random').mockReturnValue(0);
        manager.initializeMaze({
            segments: [50, 50, 50],
            analytics: { dead_ends_data: [{ position: [0, 0, 0], direction: [0, 0, 1] },
                                          { position: [4, 0, 0], direction: [0, 0, 1] }] }
        });
        rand.mockRestore();

        manager.setPointerGeometry(new THREE.BoxGeometry(0.2, 0.2, 0.2));

        // everything in hand, so nothing is already placed to confuse a hit test
        for (const b of [...manager.breadcrumbs])
            manager.removeBreadcrumb(b);
        scene.updateMatrixWorld(true);

        const camera = new THREE.PerspectiveCamera();
        camera.lookAt(0, 0, -1);
        camera.updateMatrixWorld(true);
        return { manager, camera };
    }

    // +Z is the facing axis; 1 means aimed at the camera, -1 means away from it
    const facingTowardCamera = (breadcrumb, camera) => {
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(breadcrumb.quaternion);
        const toCamera = camera.position.clone().sub(breadcrumb.position).normalize();
        return facing.dot(toCamera);
    };

    function place(manager, camera, now = 1000) {
        const placed = manager.addBreadcrumb(camera, emptyMazeData());
        manager._rememberPlacement(placed, now);
        return placed;
    }

    it('places facing away from the player on a single click', () => {
        const { manager, camera } = makeManager();

        manager.handleBreadcrumbClick(camera, emptyMazeData());

        const [placed] = manager.breadcrumbs;
        expect(facingTowardCamera(placed, camera)).toBeCloseTo(-1, 6);
    });

    it('turns that breadcrumb around on a second click that hits it', () => {
        const { manager, camera } = makeManager();
        const placed = place(manager, camera);

        expect(manager._tryPointPlacementAtPlayer(camera, placed, 1100)).toBe(true);

        expect(manager.breadcrumbs).toContain(placed);
        expect(manager.breadcrumbStack).not.toContain(placed);
        expect(facingTowardCamera(placed, camera)).toBeCloseTo(1, 6);
    });

    it('leaves it alone when the second click hits nothing, so a second can be placed', () => {
        const { manager, camera } = makeManager();
        const placed = place(manager, camera);

        expect(manager._tryPointPlacementAtPlayer(camera, null, 1100)).toBe(false);
        expect(facingTowardCamera(placed, camera)).toBeCloseTo(-1, 6);
    });

    it('leaves it alone when the second click hits a different breadcrumb', () => {
        const { manager, camera } = makeManager();
        const placed = place(manager, camera);
        const other = manager.breadcrumbStack[0];

        expect(manager._tryPointPlacementAtPlayer(camera, other, 1100)).toBe(false);
        expect(facingTowardCamera(placed, camera)).toBeCloseTo(-1, 6);
    });

    it('does nothing when the second click comes too late', () => {
        const { manager, camera } = makeManager();
        const placed = place(manager, camera);

        expect(manager._tryPointPlacementAtPlayer(camera, placed, 1000 + DOUBLE_ACTIVATE_MS + 1)).toBe(false);
        expect(facingTowardCamera(placed, camera)).toBeCloseTo(-1, 6);
    });

    it('is consumed by a single attempt, so a third click behaves normally', () => {
        const { manager, camera } = makeManager();
        const placed = place(manager, camera);

        expect(manager._tryPointPlacementAtPlayer(camera, placed, 1100)).toBe(true);
        expect(manager._tryPointPlacementAtPlayer(camera, placed, 1150)).toBe(false);
    });

    it('does not arm the gesture when the stack was empty', () => {
        const { manager, camera } = makeManager();
        manager.breadcrumbStack.length = 0;

        expect(place(manager, camera)).toBeNull();
        expect(manager._lastPlacement).toBeNull();
    });

    it('does nothing when that breadcrumb was picked back up in between', () => {
        const { manager, camera } = makeManager();
        const placed = place(manager, camera);
        manager.removeBreadcrumb(placed);

        expect(manager._tryPointPlacementAtPlayer(camera, placed, 1100)).toBe(false);
    });
});
