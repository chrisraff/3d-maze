import * as THREE from 'three';
import * as maze from '../maze/maze.js';
import checkCollisionOnAxis from '../maze/checkCollisionOnAxis.js';
import { YIELD } from '../input/TouchArbiter.js';
import BreadcrumbBaseDecor from './BreadcrumbBaseDecor.js';
import BreadcrumbPlacementCue from './BreadcrumbPlacementCue.js';
import { SceneryClaims } from '../decor/sceneryClaims.js';
import createGlowMaterial from '../render/glowMaterial.js';
import { breadcrumbIconSource } from './BreadcrumbIcon.js';
import { pickBreadcrumbHue, BREADCRUMB_SATURATION, BREADCRUMB_LIGHTNESS } from './breadcrumbHue.js';
import { reachableWithin, segmentKey } from '../maze/mazeQuery.js';
import { MAZE_OPTION_DEFAULTS } from '../state/mazeOptions.js';
import {
    MARKER_FACING_DEFAULT, coerceMarkerFacing, reverseMarkerFacing,
} from '../state/markerFacing.js';

/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

// The grab target is a sphere grown a little past the breadcrumb, so aiming
// near one is enough. Anything parking a breadcrumb against a wall has to
// leave its world radius clear, or the sphere sticks out the far side.
const HITBOX_GEOMETRY_RADIUS = 0.5;
const HITBOX_GROWTH = 1.2;
const BREADCRUMB_SCALE = maze.minorWidth * 4;
export const HITBOX_RADIUS = HITBOX_GEOMETRY_RADIUS * HITBOX_GROWTH * BREADCRUMB_SCALE;

const hitBoxGeometry = new THREE.SphereGeometry(HITBOX_GEOMETRY_RADIUS, 6, 6);
const hitBoxMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const glowSphereGeometry = new THREE.SphereGeometry(0.6, 16, 12);


// a dead end's `direction` is the axis-aligned move that led into it (see
// maze.js's analytics pass), which is exactly the same {axis, dir} the
// blocking wall sits at - the cell's own collision_map is solid there by
// construction, since that's the move that couldn't continue
function surfaceFromDirection(direction) {
    const axes = ['x', 'y', 'z'];
    for (let i = 0; i < 3; i++) {
        if (direction[i] !== 0) return { axis: axes[i], dir: Math.sign(direction[i]) };
    }
    return null;
}

// half-angle cone (as a dot-product threshold) the aim reticle lights up
// within - wide on purpose, since its job is to draw the eye toward a
// breadcrumb before the player's aim is precise enough to actually click it
const RETICLE_AIM_COS = Math.cos(THREE.MathUtils.degToRad(25));

// how hard a hovered breadcrumb lights up, as a multiplier on its tint
export const HOVER_EMISSIVE = 0.2;

// how far that tint goes from the breadcrumb's own hue (0) toward white (1).
// Pure white washes out against the additive-white proximity glow behind the
// arrow; pure hue reads dim. In between keeps both.
export const HOVER_EMISSIVE_WHITENESS = 0.5;

// Taps only count inside an oval: a circle this many viewport heights across,
// so the far ends of a wide screen and the corners fall outside it.
export const TAP_ZONE_DIAMETER_SCALE = 1.25;
// insets every edge on top of the oval, which is what clears the pause button
// (44px + 10px margin + safe-area slack) on a near-4:3 screen
export const TAP_ZONE_EDGE_MARGIN_PX = 72;

// window for a second click/tap to re-aim the breadcrumb the first one placed
export const DOUBLE_ACTIVATE_MS = 300;

// how long after a placement its motion cue goes up. Half the window, so the
// click gets an answer; a re-aim after that restarts the cue the other way.
export const CUE_SETTLE_MS = DOUBLE_ACTIVATE_MS / 2;

// how centred `nearestInView` demands a breadcrumb be; an NDC ellipse, so it
// reads as an oval on a wide screen
export const IN_VIEW_NDC_RADIUS = 0.6;

// one cell to the next, in world units
const CELL_PITCH = maze.getOffset(3) - maze.getOffset(1);

// how far `nearestInSight` reaches, in cells. Markers sit at dead ends, so a
// player who only sees one from the mouth of a corridor turns around rather
// than walking up to it - the lesson has to be able to start from there.
export const SIGHT_CELLS = 2;
const SIGHT_GATE = SIGHT_CELLS * CELL_PITCH;

// how far the player has to go before the tutorial is abandoned
export const ABANDON_CELLS = SIGHT_CELLS + 1;

// Parameters for flashing during the breadcrumb tutorial.
const FLASH_PERIOD_SECONDS = 0.8;
const FLASH_ON_SECONDS = 0.3;
const FLASH_LEVEL = 0.9;

// how far ahead of the camera a click/tap drops a breadcrumb, in cells
export const PLACEMENT_DISTANCE_SCALE = 0.33;

// how solid the gaze ghost looks while it is still only a preview
export const GHOST_OPACITY = 0.55;

// Distances a marker fades out over as the player closes on it, so walking
// into one dissolves it instead of being sliced open on the near plane - and
// also seconds of approach, walking speed being majorWidth per second.
// Desktop's 0.1 near plane (game.js) is what binds: the arrow reaches 0.138
// along its facing axis, so it starts clipping at 0.238, where it is still
// ~9% opaque. VR has room to spare - VRManager drops near to 0.001.
const NEAR_FADE_START = maze.majorWidth * 0.2;
const NEAR_FADE_END = maze.majorWidth * 0.1;

const HOVER_EMISSIVE_WHITE = new THREE.Color(1, 1, 1);

const isFinitePosition = (v) =>
    Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

export default class BreadcrumbManager {
    constructor() {
        this.scene = null;
        this.breadcrumbs = [];
        this.mazedata = null;
        this.raycaster = new THREE.Raycaster();
        this.mouseVector = new THREE.Vector2();
        this.hoveredBreadcrumb = null;
        this.breadcrumbGeometry = null;

        this.breadcrumbStack = [];
        // the Markers option this maze was built under (mazeOptions.js)
        this.markerMode = MAZE_OPTION_DEFAULTS.markers;
        // which way a placement aims a marker (markerFacing.js)
        this.facingMode = MARKER_FACING_DEFAULT;

        // tutorial signals; the counts run for the session, read both as
        // totals and as deltas, so a new maze does not zero them
        this.nearestReachable = null;
        this.nearestInView = null;
        // in view and in line down the maze, but likely still out of reach
        this.nearestInSight = null;
        this._flashTarget = null;
        // where the player stood on the last glow update - `playerLeft` measures
        // from here, so it costs nothing per frame
        this._glowPlayerPos = new THREE.Vector3();
        // { breadcrumb, near } - the cells around one marker, walked once
        this._abandonReach = null;
        this.pickupCount = 0;
        this.placeCount = 0;
        this.reaimCount = 0;
        // what the desktop reticle is doing, so VR can mirror it in world space
        this.reticleVisible = false;
        this.reticleHovered = false;

        this.touchData = {} // map of touch identifier to touch data
        this.touchTapMaxDurationMs = 350;
        this.touchTapMaxMovePx = 10;

        this.raycaster.layers.set(3);

        this._wallRaycaster = new THREE.Raycaster();
        this._wallRaycaster.layers.set(3);
        // reusable temp objects to avoid per-frame allocation
        this._tmpPos = new THREE.Vector3();
        // the breadcrumb the last click/tap placed, for the double gesture
        this._lastPlacement = null;
        this._rayDir = new THREE.Vector3();
        this._playerWorldPos = new THREE.Vector3();
        this._tmpProject = new THREE.Vector3();
        // placement scratch - the gaze ghost recomputes this every frame
        this._placePos = new THREE.Vector3();
        this._planeNormal = new THREE.Vector3();
        this._cameraWorldPos = new THREE.Vector3();
        this._placePlane = new THREE.Plane();
        this._placeGhostPos = new THREE.Vector3();
        this._cameraForward = new THREE.Vector3();

        // Spatial interaction state (null | 'reorienting' | 'placing' | 'gaze-placing')
        this._interactState = null;
        this._interactTarget = null;
        this._interactGripObject = null;
        this._interactStartPos = new THREE.Vector3();      // grip world pos at interact start
        this._interactStartQuat = new THREE.Quaternion();  // grip world quat at interact start
        this._interactTargetStartPos = new THREE.Vector3(); // breadcrumb pos at reorient start
        this._interactTargetStartQuat = new THREE.Quaternion(); // breadcrumb quat at reorient start
        this._interactStartOrientQuat = new THREE.Quaternion(); // initial breadcrumb orient for placing
        this._interactCurrentQuat = new THREE.Quaternion(); // temp
        this._interactDeltaQuat = new THREE.Quaternion();  // temp

        this._glowLastTime = null;

        // marks exactly where each originally-spawned breadcrumb was placed
        // (see BreadcrumbBaseDecor's file comment) - never moves, never
        // appears for a breadcrumb the player places themselves
        this.base = new BreadcrumbBaseDecor();

        // the bands that show which way a freshly placed breadcrumb points,
        // and the placement waiting to fire them - see updatePlacementCue
        this.placementCue = new BreadcrumbPlacementCue();
        this._pendingCue = null;
    }

    get interactState() { return this._interactState; }
    get interactTarget() { return this._interactTarget; }

    // the breadcrumb addBreadcrumb would place next, or null when empty-handed
    get nextInStack() {
        return this.breadcrumbStack[this.breadcrumbStack.length - 1] ?? null;
    }

    addTo(scene) {
        this.scene = scene;
        this.base.addTo(scene);
        this.placementCue.addTo(scene);
    };

    updateBases(dt) {
        this.base.update(dt);
    }

    createTouchHandler({ camera, getMazeData = () => this.mazedata } = {}) {
        return {
            onTouchStart: (session, touch) => {
                // the edges belong to the camera, so yield rather than
                // tracking a tap we would only discard later
                if (!this.isWithinTapMargins(touch.clientX, touch.clientY))
                    return YIELD;

                this.beginTouchCandidate(touch.identifier, touch.clientX, touch.clientY, session.startTime);
            },
            onTouchMove: (_session, touch) => {
                if (this.shouldYieldTouchCandidate(touch.identifier, touch.clientX, touch.clientY))
                    return YIELD;
            },
            onTouchEnd: (_session, touch) => {
                this.finalizeTouchCandidate(touch.identifier, touch.clientX, touch.clientY, camera, getMazeData());
            },
            // clear() cancels with no touch to read, so take the id off the
            // session - it is the same number either way
            onTouchCancel: (session) => {
                this.cancelTouchCandidate(session.id);
            },
            onTouchYield: (_session, touch) => {
                this.cancelTouchCandidate(touch.identifier);
            }
        };
    }

    // The inset that keeps taps off the screen edges and out from under the
    // pause button. Capped at a quarter of each dimension so the zone always
    // exists. Everything the player can tap at all has to clear this.
    isWithinTapMargins(clientX, clientY, width = window.innerWidth, height = window.innerHeight) {
        const marginX = Math.min(TAP_ZONE_EDGE_MARGIN_PX, width / 4);
        const marginY = Math.min(TAP_ZONE_EDGE_MARGIN_PX, height / 4);

        return Math.abs(clientX - width / 2) <= width / 2 - marginX
            && Math.abs(clientY - height / 2) <= height / 2 - marginY;
    }

    // The margins narrowed to an oval, which is where a tap may *place* a
    // breadcrumb. Picking one up only needs the margins - the tap has a
    // target under it, so it needs no guard against being a stray.
    isWithinTapZone(clientX, clientY, width = window.innerWidth, height = window.innerHeight) {
        if (!this.isWithinTapMargins(clientX, clientY, width, height))
            return false;

        const dx = clientX - width / 2;
        const dy = clientY - height / 2;
        const radius = height * TAP_ZONE_DIAMETER_SCALE / 2;
        return dx * dx + dy * dy <= radius * radius;
    }

    beginTouchCandidate(identifier, clientX, clientY, startTime = Date.now()) {
        this.touchData[identifier] = {
            touchStartTime: startTime,
            touchStartX: clientX,
            touchStartY: clientY
        };
    }

    cancelTouchCandidate(identifier) {
        delete this.touchData[identifier];
    }

    getTouchCandidateDistance(identifier, clientX, clientY) {
        const touchData = this.touchData[identifier];
        if (touchData == null)
            return 0;

        const dx = clientX - touchData.touchStartX;
        const dy = clientY - touchData.touchStartY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    shouldYieldTouchCandidate(identifier, clientX, clientY, now = Date.now()) {
        const touchData = this.touchData[identifier];
        if (touchData == null)
            return false;

        const timeDiff = now - touchData.touchStartTime;
        const distance = this.getTouchCandidateDistance(identifier, clientX, clientY);
        return timeDiff > this.touchTapMaxDurationMs || distance > this.touchTapMaxMovePx;
    }

    screenToScene(clientX, clientY) {
        return {
            sceneX: 2 * clientX / window.innerWidth - 1,
            sceneY: 1 - 2 * clientY / window.innerHeight
        };
    }

    finalizeTouchCandidate(identifier, clientX, clientY, camera, mazeData, now = Date.now()) {
        const touchData = this.touchData[identifier];
        if (touchData == null)
            return false;

        const timeDiff = now - touchData.touchStartTime;
        const distance = this.getTouchCandidateDistance(identifier, clientX, clientY);
        const isTap = timeDiff <= this.touchTapMaxDurationMs && distance <= this.touchTapMaxMovePx;

        delete this.touchData[identifier];

        if (!isTap)
            return false;

        const scenePos = this.screenToScene(clientX, clientY);
        this.handleBreadcrumbTap(camera, mazeData, scenePos.sceneX, scenePos.sceneY,
                                 this.isWithinTapZone(clientX, clientY));
        return true;
    }

    setPointerGeometry(geometry) {
        this.breadcrumbGeometry = geometry;

        for (let i = 0; i < this.breadcrumbs.length; i++) {
            this.breadcrumbs[i].remove(this.breadcrumbs[i].userData.mesh);
            this.updateBreadcrumbMesh(this.breadcrumbs[i]);
        }
    }

    updateBreadcrumbMesh(breadcrumb) {
        let mesh;
        if (this.breadcrumbGeometry === null)
            mesh = new THREE.Object3D();
        else
            mesh = new THREE.Mesh(this.breadcrumbGeometry, breadcrumb.userData.originalMaterial);

        breadcrumb.userData.mesh = mesh;
        breadcrumb.add(mesh);

        this.updateGlowMesh(breadcrumb);
    }

    updateGlowMesh(breadcrumb) {
        if (breadcrumb.userData.glowMesh) {
            breadcrumb.remove(breadcrumb.userData.glowMesh);
            breadcrumb.userData.glowMesh = null;
        }
        const glowMesh = new THREE.Mesh(glowSphereGeometry, breadcrumb.userData.glowMaterial);
        breadcrumb.userData.glowMesh = glowMesh;
        breadcrumb.add(glowMesh);
    }

    // --- Spatial interaction API ---

    // Returns the closest placed breadcrumb within hand reach of gripWorldPos, or null.
    findNearby(gripWorldPos, playerWorldPos) {
        const playerGate = maze.majorWidth * 0.75;
        const gripGate = maze.majorWidth / 12;

        let best = null;
        let bestDist = Infinity;

        for (const breadcrumb of this.breadcrumbs) {
            const playerDist = playerWorldPos.distanceTo(breadcrumb.position);
            if (playerDist > playerGate)
                continue;
            const gripDist = gripWorldPos.distanceTo(breadcrumb.position);
            if (gripDist > gripGate)
                continue;
            if (!this._canReachBreadcrumb(playerWorldPos, breadcrumb))
                continue;
            if (gripDist < bestDist) {
                bestDist = gripDist;
                best = breadcrumb;
            }
        }
        return best;
    }

    // True if the maze leaves a straight line open from fromPos to the breadcrumb.
    // Reach is decided by where the breadcrumb is rather than by what its hitbox
    // touches: the sphere is wider than a panel is thick, so it can overhang one.
    _canReachBreadcrumb(fromPos, breadcrumb) {
        if (this.mazedata?.collision_map == null) return true;
        return maze.isPathClear(this.mazedata, fromPos, breadcrumb.position);
    }

    // Begin translating + rotating a placed breadcrumb with the grip.
    beginReorient(breadcrumb, gripObject) {
        this._interactState = 'reorienting';
        this._interactTarget = breadcrumb;
        this._interactGripObject = gripObject;
        gripObject.getWorldPosition(this._interactStartPos);
        gripObject.getWorldQuaternion(this._interactStartQuat);
        this._interactTargetStartPos.copy(breadcrumb.position);
        this._interactTargetStartQuat.copy(breadcrumb.quaternion);
        this._deenergizeBase(breadcrumb);
    }

    // no-op for a breadcrumb the player placed themselves (no medallionIndex)
    _deenergizeBase(breadcrumb) {
        if (breadcrumb.userData.medallionIndex !== undefined)
            this.base.deenergize(breadcrumb.userData.medallionIndex);
    }

    // Commit the current position/orientation and leave the breadcrumb placed.
    endReorient() {
        this._interactState = null;
        this._interactTarget = null;
        this._interactGripObject = null;
    }

    // Restore original position/orientation and return the breadcrumb to the stack.
    cancelReorient() {
        this._interactTarget.position.copy(this._interactTargetStartPos);
        this._interactTarget.quaternion.copy(this._interactTargetStartQuat);
        this.removeBreadcrumb(this._interactTarget);
        this._interactState = null;
        this._interactTarget = null;
        this._interactGripObject = null;
    }

    // Pop from stack and begin previewing placement at the grip position.
    // gripObject: grip-space THREE object (hand position/orientation)
    // pointObject: ray-space THREE object (controller aim direction for initial orientation)
    // Returns true if started, false if the stack is empty.
    beginPlace(gripObject, pointObject) {
        const breadcrumb = this._takeFromStack();
        if (breadcrumb === null) return false;

        this.scene.add(breadcrumb);

        // the ray runs down the controller's own -Z and +Z is the marker's
        // facing axis, so the quaternion as copied already aims it back along
        // the ray at the player; Away turns it to point where the hand points
        pointObject.getWorldQuaternion(breadcrumb.quaternion);
        if (this.facingMode === 'away') breadcrumb.rotateY(Math.PI);
        this._interactStartOrientQuat.copy(breadcrumb.quaternion);

        gripObject.getWorldPosition(this._interactStartPos);
        gripObject.getWorldQuaternion(this._interactStartQuat);
        breadcrumb.position.copy(this._interactStartPos);

        this._interactState = 'placing';
        this._interactTarget = breadcrumb;
        this._interactGripObject = gripObject;
        this.updateBreadCrumbDisplay();
        return true;
    }

    // Commit the in-progress placement.
    endPlace() {
        this.breadcrumbs.push(this._interactTarget);
        this._startPlacementCue(this._interactTarget);
        this._interactState = null;
        this._interactTarget = null;
        this._interactGripObject = null;
    }

    // Per-frame: move and/or rotate the active interaction target to follow the grip.
    updateInteract(camera) {
        // Only the grip-driven states belong here. Gaze placing has no grip
        // object to read, and update() drives it instead.
        if (this._interactState !== 'placing' && this._interactState !== 'reorienting')
            return;

        // deltaQuat = currentGripQuat * startGripQuat^-1
        this._interactGripObject.getWorldQuaternion(this._interactCurrentQuat);
        this._interactDeltaQuat.copy(this._interactStartQuat).invert();
        this._interactDeltaQuat.premultiply(this._interactCurrentQuat);

        camera.getWorldPosition(this._playerWorldPos);

        if (this._interactState === 'reorienting') {
            // translate: breadcrumb snaps to and follows grip, wall-clamped
            this._interactGripObject.getWorldPosition(this._tmpPos);
            this._wallClampPosition(this._tmpPos, this._playerWorldPos);

            // rotate: apply grip delta to the breadcrumb's original orientation
            this._interactTarget.quaternion
                .copy(this._interactTargetStartQuat)
                .premultiply(this._interactDeltaQuat);

        } else if (this._interactState === 'placing') {
            // position: current grip world position, wall-clamped
            this._interactGripObject.getWorldPosition(this._tmpPos);
            this._wallClampPosition(this._tmpPos, this._playerWorldPos);

            // orientation: apply grip delta to the initial point-direction orient
            this._interactTarget.quaternion
                .copy(this._interactStartOrientQuat)
                .premultiply(this._interactDeltaQuat);
        }
    }

    // Raycast from playerPos toward targetPos; clamp targetPos to the nearest wall if blocked.
    _wallClampPosition(targetPos, playerPos) {
        this._rayDir.subVectors(targetPos, playerPos);
        const dist = this._rayDir.length();
        if (dist === 0) return;

        this._rayDir.divideScalar(dist);
        this._wallRaycaster.set(playerPos, this._rayDir);
        this._wallRaycaster.far = dist;
        const hits = this._wallRaycaster.intersectObjects(this.scene.children, true);
        this._wallRaycaster.far = Infinity;

        for (const hit of hits) {
            if (hit.object.userData.isMazeWallHitBox) {
                // Stop a hitbox radius short of the surface: flush against a
                // panel leaves the sphere poking through, and a breadcrumb
                // centred in one is unreachable from either side.
                const stop = Math.max(0, hit.distance - HITBOX_RADIUS);
                targetPos.copy(playerPos).addScaledVector(this._rayDir, stop);
                break;
            }
        }
        this._interactTarget.position.copy(targetPos);
    }

    // --- Per-frame proximity highlight (called by VRManager) ---

    // positions: array of Vector3 world positions (one per connected controller).
    // The glow is not touched here; update() drives it once a frame for both
    // VR and non-VR, and VRManager.update() always runs before it.
    updateProximityHighlight(positions, camera) {
        // gaze placing is not grip-driven; update()'s raycast owns hover there
        if (this.isGazePlacing) return;

        camera.getWorldPosition(this._playerWorldPos);

        if (this._interactState !== null) {
            // keep the reoriented breadcrumb highlighted during a hold; clear otherwise
            this._setHoveredBreadcrumb(this._interactState === 'reorienting' ? this._interactTarget : null);
            return;
        }

        // No grips means gaze, and this pass has no opinion on what is hovered
        // there - update()'s raycast owns it. Answering anyway would fight it
        // every frame, since VRManager.update() runs first.
        if (positions.length === 0) return;

        let best = null;
        let bestDist = Infinity;
        for (const pos of positions) {
            const candidate = this.findNearby(pos, this._playerWorldPos);
            if (candidate !== null) {
                const d = pos.distanceTo(candidate.position);
                if (d < bestDist) {
                    bestDist = d;
                    best = candidate;
                }
            }
        }
        this._setHoveredBreadcrumb(best);
    }

    updateGlowHighlight(playerWorldPos, camera = null) {
        this._glowPlayerPos.copy(playerWorldPos);
        const now = performance.now();
        const deltaTime = this._glowLastTime === null ? 0 : (now - this._glowLastTime) / 1000;
        this._glowLastTime = now;

        const FADE_SPEED = 16.0;
        const playerGate = maze.majorWidth * 0.75;

        const flashOn = (now / 1000) % FLASH_PERIOD_SECONDS < FLASH_ON_SECONDS;

        // closest in-range breadcrumb with line of sight, off the same test
        // that drives the glow - no second pass needed
        let nearest = null;
        let nearestDist = Infinity;
        // and the closest of those the player is actually looking at
        let inView = null;
        let inViewDist = Infinity;
        // the same, out to SIGHT_GATE: too far to touch, close enough to point at
        let inSight = null;
        let inSightDist = Infinity;

        for (const breadcrumb of this.breadcrumbs) {
            if (breadcrumb === this._interactTarget) continue;

            const playerDist = playerWorldPos.distanceTo(breadcrumb.position);
            this._updateNearFade(breadcrumb, playerDist);

            // the wide band first, so line of sight is walked at most once
            const hasSight = playerDist <= SIGHT_GATE
                && this._canReachBreadcrumb(playerWorldPos, breadcrumb);
            const inRange = hasSight && playerDist <= playerGate;
            const visible = hasSight && camera !== null
                && this._isInView(breadcrumb, camera);

            if (inRange && playerDist < nearestDist) {
                nearestDist = playerDist;
                nearest = breadcrumb;
            }
            if (inRange && visible && playerDist < inViewDist) {
                inViewDist = playerDist;
                inView = breadcrumb;
            }
            if (visible && playerDist < inSightDist) {
                inSightDist = playerDist;
                inSight = breadcrumb;
            }

            let target = inRange ? 0.5 * (playerDist / playerGate)**2 : 0.0;

            // if the tutorial is pointing at this breadcrumb, pulse it up to FLASH_LEVEL
            if (breadcrumb === this._flashTarget && flashOn) {
                target = Math.max(target, FLASH_LEVEL);
            }

            const alpha = THREE.MathUtils.lerp(
                breadcrumb.userData.glowAlpha,
                target,
                1 - Math.exp(-FADE_SPEED * deltaTime)
            );
            breadcrumb.userData.glowAlpha = alpha;
            breadcrumb.userData.glowMaterial.uniforms.uAlpha.value = alpha;
        }

        this.nearestReachable = nearest;
        if (camera !== null) {
            this.nearestInView = inView;
            this.nearestInSight = inSight;
        }
    }

    // Pulse one breadcrumb's glow while the lesson points it out. Null clears
    // it, and anything no longer in the maze is dropped rather than kept.
    setTutorialFlash(breadcrumb) {
        this._flashTarget = this.breadcrumbs.includes(breadcrumb) ? breadcrumb : null;
    }

    /**
     * Has the player gone somewhere else? Counted in cells walked, so turning
     * away or losing sight of it is still standing there, while the corridor
     * on the far side of its wall is not. One they are carrying counts as not
     * left, and so does anything from another maze.
     * @param {THREE.Object3D} breadcrumb
     * @returns {boolean}
     */
    playerLeft(breadcrumb) {
        if (!this.breadcrumbs.includes(breadcrumb)) return false;
        if (this.mazedata?.collision_map == null) return false;

        // the fan-out only changes when the marker does, so walk it once
        if (this._abandonReach?.breadcrumb !== breadcrumb) {
            const cell = maze.getMazePos(breadcrumb.position);
            const near = reachableWithin(this.mazedata, cell, ABANDON_CELLS);
            this._abandonReach = { breadcrumb, near };
        }

        const here = maze.getMazePos(this._glowPlayerPos);
        return !this._abandonReach.near.has(segmentKey(this.mazedata, here));
    }

    // --- Marker supply ---
    //
    // Where a player's markers come from, per the Markers option
    // (mazeOptions.js). Only 'on' spawns any into the maze, so the other two
    // modes leave no medallion bases behind either (BreadcrumbBaseDecor).

    // takes effect on the next initializeMaze, where a maze's markers settle
    setMarkerMode(mode) {
        this.markerMode = mode;
    }

    /**
     * Which way the next placement aims a marker (markerFacing.js). Settings
     * pushes this in whenever the player changes it, or moves between the
     * screen and VR, so it lands on the next placement rather than the next
     * maze - and the double gesture stays its exact reverse either way.
     */
    setFacingMode(mode) {
        this.facingMode = coerceMarkerFacing(mode);
    }

    get isUnlimited() { return this.markerMode === 'unlimited'; }

    // the HUD and VR ring count; a bottomless stack holds one marker, not "1"
    get inventoryLabel() {
        return this.isUnlimited ? '\u221e' : String(this.breadcrumbStack.length);
    }

    /**
     * A marker with its hue, meshes and grab target, standing nowhere yet.
     * A minted one has no dead end behind it, so no medallion base and no
     * panel to hold its hue away from (breadcrumbHue.js); its caller passes
     * a hue off the whole wheel.
     */
    _createMarker(hue) {
        const breadcrumb = new THREE.Object3D();

        breadcrumb.userData.originalMaterial = new THREE.MeshLambertMaterial({
            color: `hsl(${hue}, ${BREADCRUMB_SATURATION * 100}%, ${BREADCRUMB_LIGHTNESS * 100}%)`,
            vertexColors: true,
            transparent: true,
        });
        breadcrumb.userData.glowMaterial = createGlowMaterial();
        breadcrumb.userData.glowAlpha = 0.0;

        this.updateBreadcrumbMesh(breadcrumb);

        const hitBox = new THREE.Mesh(hitBoxGeometry, hitBoxMaterial);
        hitBox.scale.multiplyScalar(HITBOX_GROWTH);
        hitBox.userData.isBreadCrumbHitBox = true;
        hitBox.userData.parentBreadcrumb = breadcrumb;
        hitBox.layers.set(3);
        breadcrumb.add(hitBox);

        breadcrumb.scale.multiplyScalar(BREADCRUMB_SCALE);

        return breadcrumb;
    }

    /**
     * Takes the marker a placement is about to use, refilling a bottomless
     * stack behind it so the inventory never empties; null means
     * empty-handed. Refilling after the pop rather than holding a spare
     * keeps the icon, the count and `nextInStack` - all of which read the
     * stack directly - showing the marker the next placement will use.
     */
    _takeFromStack() {
        const breadcrumb = this.breadcrumbStack.pop() ?? null;
        if (breadcrumb !== null && this.isUnlimited && this.breadcrumbStack.length === 0)
            this.breadcrumbStack.push(this._createMarker(Math.random() * 360));
        return breadcrumb;
    }

    // --- Maze lifecycle ---

    // `claims` is the scenery ledger this maze's decor will be built
    // against - bases are placed first and only ever record a claim, since
    // nothing else has been placed yet for them to check against
    initializeMaze(mazedata, claims = new SceneryClaims()) {
        this.mazedata = mazedata;

        // cancel any in-progress spatial interaction
        if ((this._interactState === 'placing' || this._interactState === 'gaze-placing')
            && this._interactTarget !== null) {
            this.scene.remove(this._interactTarget);
        }
        this._interactState = null;
        this._interactTarget = null;
        this._interactGripObject = null;

        // a cue still running belongs to a breadcrumb this maze is about to
        // take out of the scene
        this._pendingCue = null;
        this.placementCue.cancel();

        // clear existing breadcrumbs
        for (let i = 0; i < this.breadcrumbs.length; i++) {
            this.scene.remove(this.breadcrumbs[i]);
        }
        this.highlightedBreadcrumb = null;
        this.breadcrumbs = [];
        this.breadcrumbStack = [];
        this.hoveredBreadcrumb = null;
        this.nearestReachable = null;
        this.nearestInView = null;
        this.nearestInSight = null;
        this._flashTarget = null;
        this._abandonReach = null;

        // pick X% of dead ends at random; only 'on' stocks the maze
        const DEAD_END_FILL = this.markerMode === 'on' ? 0.5 : 0;
        let deadEndSelection = new Array(mazedata.analytics.dead_ends_data.length).fill(false);
        const numBreadcrumbs = Math.floor(mazedata.analytics.dead_ends_data.length * DEAD_END_FILL);
        let count = 0;
        while (count < numBreadcrumbs) {
            const idx = Math.floor(Math.random() * mazedata.analytics.dead_ends_data.length);
            if (!deadEndSelection[idx]) {
                deadEndSelection[idx] = true;
                count++;
            }
        }

        // add breadcrumbs
        const directionVector = new THREE.Vector3();
        const medallionSites = [];
        for (let i = 0; i < mazedata.analytics.dead_ends_data.length; i++) {
            if (deadEndSelection[i]) {
                const deadEnd = mazedata.analytics.dead_ends_data[i];
                directionVector.set(...deadEnd.direction);

                // surface first: it names the panel breadcrumbHue.js measures
                // the hue against, so a breadcrumb can't match its own wall
                const surface = surfaceFromDirection(deadEnd.direction);
                const room = { x: deadEnd.position[0], y: deadEnd.position[1], z: deadEnd.position[2] };
                const hue = surface
                    ? pickBreadcrumbHue(mazedata, { ...room, [surface.axis]: room[surface.axis] + surface.dir })
                    : Math.random() * 360;

                const breadcrumb = this._createMarker(hue);
                const newMaterial = breadcrumb.userData.originalMaterial;

                if (surface) {
                    // read the hue back out of the material's actual color
                    // rather than reusing the value passed into the CSS hsl()
                    // string above - Color.setStyle() runs that through an
                    // sRGB conversion that Color.setHSL() (used by the
                    // medallion) doesn't, so the two would otherwise drift
                    // apart and the medallion would end up a visibly
                    // different hue than its own breadcrumb
                    const hsl = { h: 0, s: 0, l: 0 };
                    newMaterial.color.getHSL(hsl);
                    // remembered so grabbing this exact breadcrumb later can
                    // de-energize its own base - see removeBreadcrumb/beginReorient
                    breadcrumb.userData.medallionIndex = medallionSites.length;
                    claims.claim(room, surface, BreadcrumbBaseDecor.PROFILE);
                    medallionSites.push({
                        room,
                        surface,
                        hue: hsl.h,
                        saturation: hsl.s,
                        lightness: hsl.l,
                    });
                }

                // `direction` led into the dead end, so reverse it to face up the corridor
                breadcrumb.lookAt(directionVector);
                breadcrumb.rotateY(Math.PI);

                breadcrumb.position.set(
                    deadEnd.position[0] * (maze.minorWidth + maze.majorWidth) / 2,
                    deadEnd.position[1] * (maze.minorWidth + maze.majorWidth) / 2,
                    deadEnd.position[2] * (maze.minorWidth + maze.majorWidth) / 2
                );

                breadcrumb.position.addScaledVector(directionVector, maze.majorWidth * 0.2);

                this.scene.add(breadcrumb);
                this.breadcrumbs.push(breadcrumb);
            }
        }

        this.base.build(mazedata, medallionSites);

        // nothing in the maze to go and find, so the first one starts in hand
        if (this.isUnlimited)
            this.breadcrumbStack.push(this._createMarker(Math.random() * 360));

        this.updateBreadCrumbDisplay();
    }

    // --- Gaze placement ---
    //
    // Gaze has one button, already spoken for by move and by the options menu,
    // so placing is a mode: the breadcrumb previews where a tap would drop it
    // and follows the player's look until they commit or cancel.

    get isGazePlacing() { return this._interactState === 'gaze-placing'; }

    // A gaze tap takes whatever the player is looking at. With nothing there it
    // returns false and the tap stays what it always was - a step forward.
    tryGazePickup(camera) {
        if (this._interactState !== null) return false;

        const breadcrumb = this.raycastSearchForBreadcrumb(camera);
        if (breadcrumb === null) return false;

        this.removeBreadcrumb(breadcrumb);
        this.pickupCount++;
        return true;
    }

    // Take a breadcrumb out of the stack and start previewing it.
    // Returns false when empty-handed or already mid-interaction.
    beginGazePlace(camera, mazeData) {
        if (this._interactState !== null) return false;

        const breadcrumb = this._takeFromStack();
        if (breadcrumb === null) return false;

        this.scene.add(breadcrumb);

        this._interactState = 'gaze-placing';
        this._interactTarget = breadcrumb;
        this._setGhost(breadcrumb, true);

        this.updateGazePlace(camera, mazeData);
        this.updateBreadCrumbDisplay();
        return true;
    }

    // Per-frame: sit exactly where a tap would drop it, aimed the way the
    // facing setting will leave it.
    updateGazePlace(camera, mazeData) {
        if (!this.isGazePlacing) return;

        this.placementPosition(this._placeGhostPos, camera, mazeData);

        // Never hand a bad position to the scene graph: a NaN there silently
        // breaks matrix updates for everything under it.
        if (!isFinitePosition(this._placeGhostPos)) return;

        this._interactTarget.position.copy(this._placeGhostPos);
        this._aimFacing(this._interactTarget, camera);
    }

    // Leave it where it stands. Returns the breadcrumb, or null if not placing.
    commitGazePlace() {
        if (!this.isGazePlacing) return null;

        const breadcrumb = this._interactTarget;
        this._setGhost(breadcrumb, false);
        this.breadcrumbs.push(breadcrumb);

        this._interactState = null;
        this._interactTarget = null;

        this._rememberPlacement(breadcrumb);
        this.updateBreadCrumbDisplay();
        return breadcrumb;
    }

    // Put it back in the player's hand.
    cancelGazePlace() {
        if (!this.isGazePlacing) return;

        const breadcrumb = this._interactTarget;
        this._setGhost(breadcrumb, false);
        this.scene.remove(breadcrumb);

        this._interactState = null;
        this._interactTarget = null;

        this.breadcrumbStack.push(breadcrumb);
        this.updateBreadCrumbDisplay();
    }

     */
    _updateNearFade(breadcrumb, playerDist) {
        const mesh = breadcrumb.userData.mesh;
        const material = mesh?.material;
        if (!material) return;

        const opacity = THREE.MathUtils.smoothstep(playerDist, NEAR_FADE_END, NEAR_FADE_START);
        if (material.opacity === opacity) return;

        material.opacity = opacity;
        mesh.visible = opacity > 0;
    }

    // Back to solid, for a marker leaving the scene: a pickup at point blank
    // takes a fully faded one, and it has to be visible when re-placed.
    _resetNearFade(breadcrumb) {
        const mesh = breadcrumb.userData.mesh;
        if (!mesh) return;

        mesh.visible = true;
        if (!mesh.material) return;
        mesh.material.opacity = 1;
    }

    _setGhost(breadcrumb, isGhost) {
        const material = breadcrumb?.userData.mesh?.material;
        if (!material) return;

        material.opacity = isGhost ? GHOST_OPACITY : 1;
        // a translucent preview shouldn't occlude the maze behind it
        material.depthWrite = !isGhost;
    }

    // --- Non-VR interaction (touch / mouse) ---

    // canPlace false still picks up and re-aims, it just won't drop a new
    // breadcrumb - see isWithinTapZone
    handleBreadcrumbTap(camera, mazeData, sceneX=0, sceneY=0, canPlace=true)
    {
        const breadcrumb = this.raycastSearchForBreadcrumb(camera, sceneX, sceneY);

        if (this._tryReversePlacementAim(camera, breadcrumb))
            return;

        if (breadcrumb !== null) {
            this.removeBreadcrumb(breadcrumb);
            this.pickupCount++;
            return;
        }

        if (!canPlace)
            return;

        this._rememberPlacement(this.addBreadcrumb(camera, mazeData, sceneX, sceneY));
    }

    handleBreadcrumbClick(camera, mazeData) {
        if (this._tryReversePlacementAim(camera, this.hoveredBreadcrumb))
            return;

        if (this.hoveredBreadcrumb) {
            this.removeBreadcrumb(this.hoveredBreadcrumb);
            this.pickupCount++;
            return;
        }

        this._rememberPlacement(this.addBreadcrumb(camera, mazeData));
    }

    _rememberPlacement(breadcrumb, now = Date.now()) {
        this._lastPlacement = breadcrumb == null ? null : { breadcrumb, time: now };
        if (breadcrumb == null) return;

        this.placeCount++;
        this._pendingCue = { breadcrumb, settleAt: now + CUE_SETTLE_MS };
    }

    // Second half of a double click/tap: turn the breadcrumb the first half
    // placed around, so it points the other way from however the facing
    // setting left it (markerFacing.js). `target` is what this click/tap
    // actually hit - aiming somewhere else places a second breadcrumb as
    // usual rather than spinning the first.
    _tryReversePlacementAim(camera, target, now = Date.now()) {
        const placement = this._lastPlacement;
        this._lastPlacement = null;

        if (placement == null || target !== placement.breadcrumb)
            return false;
        if (now - placement.time > DOUBLE_ACTIVATE_MS)
            return false;
        if (!this.breadcrumbs.includes(placement.breadcrumb))
            return false;

        // same helper as placement, so the two gestures stay exact opposites
        this._aimFacing(placement.breadcrumb, camera, reverseMarkerFacing(this.facingMode));
        this.reaimCount++;
        // restart the cue so the reversal plays in full; this can land between
        // frames, so take the player position here rather than trust it
        camera.getWorldPosition(this._playerWorldPos);
        this._startPlacementCue(placement.breadcrumb);
        return true;
    }

    updateHoveredBreadcrumb(camera)
    {
        const { anyInRange, reticleVisible } = this._scanBreadcrumbAim(camera);

        // raycastSearchForBreadcrumb walks the whole scene graph
        // (intersectObjects(..., true)) every call, so it's worth skipping
        // outright once nothing is even within grabbing range - it could
        // never hit anything in that case, so this only ever saves cost,
        // never changes the result
        this._setHoveredBreadcrumb(anyInRange ? this.raycastSearchForBreadcrumb(camera) : null);

        // also show the reticle on an exact hover hit even outside the aim
        // cone - at close range the actual hitbox can subtend a wider angle
        // than RETICLE_AIM_COS allows for, so a breadcrumb can be hovered
        // (and clickable) without the cone test alone picking it up
        this._updateReticle(reticleVisible || this.hoveredBreadcrumb !== null,
                            this.hoveredBreadcrumb !== null);
    }

    // one pass over placed breadcrumbs computing both signals the caller
    // needs: anyInRange (cheap distance-only gate for the expensive raycast
    // above) and reticleVisible (anyInRange further narrowed to a wide
    // dot-product cone - RETICLE_AIM_COS - plus a reachability check, so the
    // aim reticle can guide the player's aim before it's precise enough to
    // actually hit, rather than only confirming a hit they've already made)
    _scanBreadcrumbAim(camera) {
        camera.getWorldPosition(this._playerWorldPos);
        camera.getWorldDirection(this._cameraForward);
        const playerGate = maze.majorWidth * 0.75;

        let anyInRange = false;
        let reticleVisible = false;

        for (const breadcrumb of this.breadcrumbs) {
            const dist = this._playerWorldPos.distanceTo(breadcrumb.position);
            if (dist === 0 || dist > playerGate) continue;
            anyInRange = true;

            if (reticleVisible) continue;
            this._tmpPos.subVectors(breadcrumb.position, this._playerWorldPos).divideScalar(dist);
            if (this._tmpPos.dot(this._cameraForward) < RETICLE_AIM_COS) continue;
            if (this._canReachBreadcrumb(this._playerWorldPos, breadcrumb)) reticleVisible = true;
        }

        return { anyInRange, reticleVisible };
    }

    _updateReticle(visible, hovered=false) {
        this.reticleVisible = visible;
        this.reticleHovered = hovered;

        const reticle = document.getElementById('breadcrumb-reticle');
        if (!reticle) return;
        reticle.classList.toggle('visible', visible);
        reticle.classList.toggle('hovered', hovered);
    }

    /**
     * The per-frame camera-driven work: hover, proximity glow and base decor.
     * The grip-driven half stays in VRManager, which owns the controllers.
     *
     * @param {boolean} [hover=false] - run the mouse/gaze hover pass, which
     *        only applies where there is a cursor or a gaze cursor to aim
     * @param {Object} [mazeData=null] - needed to keep a gaze ghost out of walls
     */
    update(delta, camera, { hover = false, mazeData = null } = {}) {
        if (mazeData !== null)
            this.updateGazePlace(camera, mazeData);

        if (hover)
            this.updateHoveredBreadcrumb(camera);

        this.updateGlowForCamera(camera);
        this.updateBases(delta);
        this.updatePlacementCue(delta);
    }

    // Fires a placement's cue once CUE_SETTLE_MS has passed (a re-aim restarts
    // it instead), then advances whichever cue is running.
    updatePlacementCue(delta, now = Date.now()) {
        if (this._pendingCue !== null && now >= this._pendingCue.settleAt)
            this._startPlacementCue(this._pendingCue.breadcrumb);

        this.placementCue.update(delta);
    }

    // A breadcrumb picked up again before this never gets a cue. The player
    // position decides how far back the bands launch; update() keeps it fresh.
    _startPlacementCue(breadcrumb) {
        this._pendingCue = null;
        if (breadcrumb == null || !this.breadcrumbs.includes(breadcrumb)) return;

        this.placementCue.start(breadcrumb, this._playerWorldPos);
    }

    updateGlowForCamera(camera) {
        camera.getWorldPosition(this._playerWorldPos);
        this.updateGlowHighlight(this._playerWorldPos, camera);
    }

    // in the centred oval of the view, not merely on screen - panning past
    // the far edge shouldn't count. Behind the camera projects to |z| > 1.
    _isInView(breadcrumb, camera) {
        const ndc = this._tmpProject.copy(breadcrumb.position).project(camera);
        if (Math.abs(ndc.z) > 1) return false;

        return ndc.x * ndc.x + ndc.y * ndc.y
            <= IN_VIEW_NDC_RADIUS * IN_VIEW_NDC_RADIUS;
    }

    // prevent errors when breadcrumb mesh hasn't loaded yet
    _setBreadcrumbEmissive(breadcrumb, value) {
        const material = breadcrumb?.userData.mesh?.material;
        if (material)
            material.emissive.copy(material.color)
                .lerp(HOVER_EMISSIVE_WHITE, HOVER_EMISSIVE_WHITENESS)
                .multiplyScalar(value);
    }

    _setHoveredBreadcrumb(breadcrumb) {
        if (breadcrumb === this.hoveredBreadcrumb)
            return;
        this._setBreadcrumbEmissive(this.hoveredBreadcrumb, 0);
        this.hoveredBreadcrumb = breadcrumb;
        this._setBreadcrumbEmissive(this.hoveredBreadcrumb, HOVER_EMISSIVE);
    }

    // look for a breadcrumb at a corresponding screen position
    raycastSearchForBreadcrumb(camera, sceneX=0, sceneY=0) {
        this.mouseVector.set(sceneX, sceneY);
        this.raycaster.setFromCamera(this.mouseVector, camera);

        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        if (intersects.length > 0) {
            let i = -1;
            while (++i < intersects.length) {
                if (intersects[i].distance > maze.majorWidth * 0.75) {
                    return null;
                }
                if (intersects[i].object.userData.isMazeWallHitBox) {
                    return null;
                }
                if (intersects[i].object.userData.isBreadCrumbHitBox) {
                    const breadcrumb = intersects[i].object.userData.parentBreadcrumb;
                    if (breadcrumb === this._interactTarget)
                        continue;
                    // the hitbox can overhang a panel the breadcrumb is behind
                    if (!this._canReachBreadcrumb(this.raycaster.ray.origin, breadcrumb))
                        continue;
                    return breadcrumb;
                }
            }
        }
        return null;
    }

    removeBreadcrumb(breadcrumb) {
        if (breadcrumb == null)
            return;

        this._deenergizeBase(breadcrumb);

        if (this._pendingCue?.breadcrumb === breadcrumb) this._pendingCue = null;
        this.placementCue.cancel(breadcrumb);

        this.scene.remove(breadcrumb);
        const idx = this.breadcrumbs.indexOf(breadcrumb);
        if (idx > -1) {
            this.breadcrumbs.splice(idx, 1);
        }
        // if necessary, unhighlight the breadcrumb
        if (this.hoveredBreadcrumb === breadcrumb) {
            this._setBreadcrumbEmissive(this.hoveredBreadcrumb, 0);
        };
        this.hoveredBreadcrumb = null;

        breadcrumb.userData.glowAlpha = 0.0;
        if (breadcrumb.userData.glowMaterial)
            breadcrumb.userData.glowMaterial.uniforms.uAlpha.value = 0.0;
        this._resetNearFade(breadcrumb);

        this.breadcrumbStack.push(breadcrumb);

        this.updateBreadCrumbDisplay(true);
    }

    // returns the breadcrumb placed, or null if the stack was empty
    /**
     * Where a click/tap at this screen point drops a breadcrumb: onto a plane
     * PLACEMENT_DISTANCE_SCALE cells ahead, then pushed out of any wall it
     * would sit inside. The gaze ghost previews this, so what the player lines
     * up is what actually gets placed.
     *
     * @param {THREE.Vector3} target - written in place and returned
     */
    placementPosition(target, camera, mazeData, sceneX=0, sceneY=0) {
        const breadcrumbCollisionDistance = maze.minorWidth * 2;

        this.mouseVector.set(sceneX, sceneY);
        this.raycaster.setFromCamera(this.mouseVector, camera);

        // a plane in front of the camera to raycast against
        camera.getWorldDirection(this._planeNormal);
        camera.getWorldPosition(this._cameraWorldPos);
        this._placePos.copy(this._cameraWorldPos)
            .addScaledVector(this._planeNormal, maze.majorWidth * PLACEMENT_DISTANCE_SCALE);
        this._placePlane.setFromNormalAndCoplanarPoint(this._planeNormal, this._placePos);

        // a ray parallel to the plane leaves target untouched, which would
        // otherwise be read as a placement at wherever it last pointed
        if (this.raycaster.ray.intersectPlane(this._placePlane, target) === null)
            return target;

        this._placePos.copy(target);
        this._placePos.addScalar(maze.minorWidth);
        const breadcrumbMazePosFar = maze.getMazePos(this._placePos);
        this._placePos.addScalar(-2*maze.minorWidth);
        const breadcrumbMazePosNear = maze.getMazePos(this._placePos);
        const cameraMazePos = maze.getMazePos(this._cameraWorldPos);

        if (breadcrumbMazePosNear.x - cameraMazePos.x < 0) {
            checkCollisionOnAxis(mazeData, 'x', 'y', 'z', cameraMazePos, breadcrumbMazePosNear, cameraMazePos, -1, target, breadcrumbCollisionDistance);
        }
        if (breadcrumbMazePosNear.y - cameraMazePos.y < 0) {
            checkCollisionOnAxis(mazeData, 'y', 'x', 'z', cameraMazePos, breadcrumbMazePosNear, cameraMazePos, -1, target, breadcrumbCollisionDistance);
        }
        if (breadcrumbMazePosNear.z - cameraMazePos.z < 0) {
            checkCollisionOnAxis(mazeData, 'z', 'y', 'x', cameraMazePos, breadcrumbMazePosNear, cameraMazePos, -1, target, breadcrumbCollisionDistance);
        }

        if (breadcrumbMazePosFar.x - cameraMazePos.x > 0) {
            checkCollisionOnAxis(mazeData, 'x', 'y', 'z', cameraMazePos, breadcrumbMazePosFar, cameraMazePos, 1, target, breadcrumbCollisionDistance);
        }
        if (breadcrumbMazePosFar.y - cameraMazePos.y > 0) {
            checkCollisionOnAxis(mazeData, 'y', 'x', 'z', cameraMazePos, breadcrumbMazePosFar, cameraMazePos, 1, target, breadcrumbCollisionDistance);
        }
        if (breadcrumbMazePosFar.z - cameraMazePos.z > 0) {
            checkCollisionOnAxis(mazeData, 'z', 'y', 'x', cameraMazePos, breadcrumbMazePosFar, cameraMazePos, 1, target, breadcrumbCollisionDistance);
        }

        return target;
    }

    // +Z is the facing axis, and a camera looks down its own -Z, so this faces the player
    _aimAtPlayer(breadcrumb, camera) {
        camera.getWorldQuaternion(breadcrumb.quaternion);
    }

    // facing where the player was heading, rather than back at them
    _aimAwayFromPlayer(breadcrumb, camera) {
        this._aimAtPlayer(breadcrumb, camera);
        breadcrumb.rotateY(Math.PI);
    }

    // How a placement aims a marker: the facing setting by default, or the
    // other mode for the double gesture. One helper for both, so the two stay
    // exact opposites whichever way the setting points.
    _aimFacing(breadcrumb, camera, mode = this.facingMode) {
        if (mode === 'away') this._aimAwayFromPlayer(breadcrumb, camera);
        else this._aimAtPlayer(breadcrumb, camera);
    }

    addBreadcrumb(camera, mazeData, sceneX=0, sceneY=0) {
        const breadcrumb = this._takeFromStack();
        if (breadcrumb === null)
            return null;

        this.placementPosition(breadcrumb.position, camera, mazeData, sceneX, sceneY);

        this.scene.add(breadcrumb);
        this._aimFacing(breadcrumb, camera);
        this.breadcrumbs.push(breadcrumb);

        this.updateBreadCrumbDisplay();
        return breadcrumb;
    }

    // pickedUp pops the icon; the other callers (placing, a new maze) shouldn't
    updateBreadCrumbDisplay(pickedUp = false) {
        const count = this.breadcrumbStack.length;

        const container = document.getElementById('breadcrumb-container');
        // nothing is shown at all while the inventory is empty
        if (container?.classList)
            container.classList.toggle('hide', count === 0);

        if (count === 0)
            return;

        const countElement = document.getElementById('breadcrumb-count');
        if (countElement)
            countElement.textContent = this.inventoryLabel;

        // the icon depicts the breadcrumb that addBreadcrumb would pop next
        const iconElement = document.getElementById('breadcrumb-icon');
        if (iconElement) {
            const source = breadcrumbIconSource(this.breadcrumbStack[count - 1]);
            if (source !== null)
                iconElement.src = source;

            // re-adding the class alone won't replay a running animation, so
            // clear it and force a reflow first - two quick pickups should pop twice
            if (pickedUp && iconElement.classList) {
                iconElement.classList.remove('pickup');
                void iconElement.offsetWidth;
                iconElement.classList.add('pickup');
            }
        }
    }
}
