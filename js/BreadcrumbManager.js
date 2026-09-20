import * as THREE from 'three';
import * as maze from './maze.js';
import checkCollisionOnAxis from './checkCollisionOnAxis.js';
import { YIELD } from './TouchArbiter.js';
import BreadcrumbBaseDecor from './BreadcrumbBaseDecor.js';
import createGlowMaterial from './glowMaterial.js';
import { breadcrumbIconSource } from './BreadcrumbIcon.js';

/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

const hitBoxGeometry = new THREE.SphereGeometry(0.5, 6, 6);
const hitBoxMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const glowSphereGeometry = new THREE.SphereGeometry(0.6, 16, 12);


// a dead end's `direction` is the axis-aligned move that led into it (see
// maze.js's analytics pass), which is exactly the same {axis, dir} the
// blocking wall sits at - the room's own collision_map is solid there by
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

// how centred `nearestInView` demands a breadcrumb be; an NDC ellipse, so it
// reads as an oval on a wide screen
export const IN_VIEW_NDC_RADIUS = 0.6;

const HOVER_EMISSIVE_WHITE = new THREE.Color(1, 1, 1);

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

        // tutorial signals; counts are monotonic across a maze
        this.nearestReachable = null;
        this.nearestInView = null;
        this.pickupCount = 0;
        this.placeCount = 0;
        this.reaimCount = 0;

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
        this._cameraForward = new THREE.Vector3();

        // Spatial interaction state (null | 'reorienting' | 'placing')
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
            onTouchCancel: (_session, touch) => {
                this.cancelTouchCandidate(touch.identifier);
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

    // Returns true if a raycast from fromPos to breadcrumb's hitbox hits the hitbox before any wall.
    _canReachBreadcrumb(fromPos, breadcrumb) {
        this._rayDir.subVectors(breadcrumb.position, fromPos);
        const dist = this._rayDir.length();
        if (dist === 0) return true;
        this._rayDir.divideScalar(dist);
        this._wallRaycaster.set(fromPos, this._rayDir);
        this._wallRaycaster.far = dist;
        const hits = this._wallRaycaster.intersectObjects(this.scene.children, true);
        this._wallRaycaster.far = Infinity;
        for (const hit of hits) {
            if (hit.object.userData.isBreadCrumbHitBox && hit.object.userData.parentBreadcrumb === breadcrumb)
                return true;
            if (hit.object.userData.isMazeWallHitBox)
                return false;
        }
        return false;
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
        if (this.breadcrumbStack.length === 0) return false;

        const breadcrumb = this.breadcrumbStack.pop();
        this.scene.add(breadcrumb);

        pointObject.getWorldQuaternion(breadcrumb.quaternion);
        breadcrumb.rotateY(Math.PI);
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
        this._interactState = null;
        this._interactTarget = null;
        this._interactGripObject = null;
    }

    // Per-frame: move and/or rotate the active interaction target to follow the grip.
    updateInteract(camera) {
        if (this._interactState === null) return;

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
                targetPos.copy(hit.point);
                break;
            }
        }
        this._interactTarget.position.copy(targetPos);
    }

    // --- Per-frame proximity highlight (called by VRManager) ---

    // positions: array of Vector3 world positions (one per connected controller).
    updateProximityHighlight(positions, camera) {
        camera.getWorldPosition(this._playerWorldPos);

        if (this._interactState !== null) {
            // keep the reoriented breadcrumb highlighted during a hold; clear otherwise
            this._setHoveredBreadcrumb(this._interactState === 'reorienting' ? this._interactTarget : null);
            this.updateGlowHighlight(this._playerWorldPos);
            return;
        }

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
        this.updateGlowHighlight(this._playerWorldPos);
    }

    updateGlowHighlight(playerWorldPos, camera = null) {
        const now = performance.now();
        const deltaTime = this._glowLastTime === null ? 0 : (now - this._glowLastTime) / 1000;
        this._glowLastTime = now;

        const FADE_SPEED = 16.0;
        const playerGate = maze.majorWidth * 0.75;

        // closest in-range breadcrumb with line of sight, off the same test
        // that drives the glow - no second pass needed
        let nearest = null;
        let nearestDist = Infinity;
        // and the closest of those the player is actually looking at
        let inView = null;
        let inViewDist = Infinity;

        for (const breadcrumb of this.breadcrumbs) {
            if (breadcrumb === this._interactTarget) continue;

            const playerDist = playerWorldPos.distanceTo(breadcrumb.position);
            const inRange = playerDist <= playerGate
                && this._canReachBreadcrumb(playerWorldPos, breadcrumb);

            if (inRange && playerDist < nearestDist) {
                nearestDist = playerDist;
                nearest = breadcrumb;
            }
            if (inRange && playerDist < inViewDist
                && camera !== null && this._isInView(breadcrumb, camera)) {
                inViewDist = playerDist;
                inView = breadcrumb;
            }

            const target = inRange ? 0.5 * (playerDist / playerGate)**2 : 0.0;
            const alpha = THREE.MathUtils.lerp(
                breadcrumb.userData.glowAlpha,
                target,
                1 - Math.exp(-FADE_SPEED * deltaTime)
            );
            breadcrumb.userData.glowAlpha = alpha;
            breadcrumb.userData.glowMaterial.uniforms.uAlpha.value = alpha;
        }

        this.nearestReachable = nearest;
        if (camera !== null) this.nearestInView = inView;
    }

    // --- Maze lifecycle ---

    initializeMaze(mazedata) {
        this.mazedata = mazedata;

        // cancel any in-progress spatial interaction
        if (this._interactState === 'placing' && this._interactTarget !== null) {
            this.scene.remove(this._interactTarget);
        }
        this._interactState = null;
        this._interactTarget = null;
        this._interactGripObject = null;

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
        this.pickupCount = 0;
        this.placeCount = 0;
        this.reaimCount = 0;

        // pick X% of dead ends at random
        const DEAD_END_FILL = 0.5;
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

                const breadcrumb = new THREE.Object3D();

                const newMaterial = new THREE.MeshLambertMaterial({color: `hsl(${Math.random() * 360}, 100%, 50%)`, vertexColors: true});
                breadcrumb.userData.originalMaterial = newMaterial;

                const surface = surfaceFromDirection(deadEnd.direction);
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
                    medallionSites.push({
                        room: { x: deadEnd.position[0], y: deadEnd.position[1], z: deadEnd.position[2] },
                        surface,
                        hue: hsl.h,
                        saturation: hsl.s,
                        lightness: hsl.l,
                    });
                }
                breadcrumb.userData.glowMaterial = createGlowMaterial();
                breadcrumb.userData.glowAlpha = 0.0;

                this.updateBreadcrumbMesh(breadcrumb);

                const hitBox = new THREE.Mesh(hitBoxGeometry, hitBoxMaterial);
                hitBox.scale.multiplyScalar(1.2);
                hitBox.userData.isBreadCrumbHitBox = true;
                hitBox.userData.parentBreadcrumb = breadcrumb;
                hitBox.layers.set(3);
                breadcrumb.add(hitBox);

                breadcrumb.lookAt(directionVector);
                breadcrumb.rotateY(Math.PI);

                breadcrumb.position.set(
                    deadEnd.position[0] * (maze.minorWidth + maze.majorWidth) / 2,
                    deadEnd.position[1] * (maze.minorWidth + maze.majorWidth) / 2,
                    deadEnd.position[2] * (maze.minorWidth + maze.majorWidth) / 2
                );

                breadcrumb.position.addScaledVector(directionVector, maze.majorWidth * 0.2);

                breadcrumb.scale.multiplyScalar(maze.minorWidth * 4);

                this.scene.add(breadcrumb);
                this.breadcrumbs.push(breadcrumb);
            }
        }

        this.base.build(mazedata, medallionSites);

        this.updateBreadCrumbDisplay();
    }

    // --- Non-VR interaction (touch / mouse) ---

    // canPlace false still picks up and re-aims, it just won't drop a new
    // breadcrumb - see isWithinTapZone
    handleBreadcrumbTap(camera, mazeData, sceneX=0, sceneY=0, canPlace=true)
    {
        const breadcrumb = this.raycastSearchForBreadcrumb(camera, sceneX, sceneY);

        if (this._tryPointPlacementAtPlayer(camera, breadcrumb))
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
        if (this._tryPointPlacementAtPlayer(camera, this.hoveredBreadcrumb))
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
        if (breadcrumb != null) this.placeCount++;
    }

    // Second half of a double click/tap: turn the breadcrumb the first half
    // placed around to point at the player instead of away. `target` is what
    // this click/tap actually hit - aiming somewhere else places a second
    // breadcrumb as usual rather than spinning the first one.
    _tryPointPlacementAtPlayer(camera, target, now = Date.now()) {
        const placement = this._lastPlacement;
        this._lastPlacement = null;

        if (placement == null || target !== placement.breadcrumb)
            return false;
        if (now - placement.time > DOUBLE_ACTIVATE_MS)
            return false;
        if (!this.breadcrumbs.includes(placement.breadcrumb))
            return false;

        // lookAt points +Z at the target - the same axis addBreadcrumb aims
        // along the view direction, so this is placement's facing reversed
        camera.getWorldPosition(this._tmpPos);
        placement.breadcrumb.lookAt(this._tmpPos);
        this.reaimCount++;
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
        const reticle = document.getElementById('breadcrumb-reticle');
        if (!reticle) return;
        reticle.classList.toggle('visible', visible);
        reticle.classList.toggle('hovered', hovered);
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

        this.breadcrumbStack.push(breadcrumb);

        this.updateBreadCrumbDisplay(true);
    }

    // returns the breadcrumb placed, or null if the stack was empty
    addBreadcrumb(camera, mazeData, sceneX=0, sceneY=0) {
        const breadcrumbCollisionDistance = maze.minorWidth * 2;
        if (this.breadcrumbStack.length === 0)
            return null;

        let breadcrumb = this.breadcrumbStack.pop();

        const tmpVector = new THREE.Vector3();

        // If user tapped on scene, place breadcrumb at tap location,
        // or the middle of the screen for mouse clicks
        this.mouseVector.set(sceneX, sceneY);
        this.raycaster.setFromCamera(this.mouseVector, camera);

        // Create a plane in front of the camera to raycast against
        const planeNormal = new THREE.Vector3();
        camera.getWorldDirection(planeNormal);
        const cameraWorldPos = new THREE.Vector3();
        camera.getWorldPosition(cameraWorldPos);
        const planePoint = new THREE.Vector3();
        planePoint.copy(cameraWorldPos).addScaledVector(planeNormal, maze.majorWidth * 0.33);
        const plane = new THREE.Plane(planeNormal, -planeNormal.dot(planePoint));

        const intersection = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(plane, intersection);
        breadcrumb.position.copy(intersection);

        tmpVector.copy(breadcrumb.position);
        tmpVector.addScalar(maze.minorWidth);
        const breadcrumbMazePosFar = maze.getMazePos(tmpVector);
        tmpVector.addScalar(-2*maze.minorWidth);
        const breadcrumbMazePosNear = maze.getMazePos(tmpVector);
        const cameraMazePos = maze.getMazePos(cameraWorldPos);

        if (breadcrumbMazePosNear.x - cameraMazePos.x < 0) {
            checkCollisionOnAxis(mazeData, 'x', 'y', 'z', cameraMazePos, breadcrumbMazePosNear, cameraMazePos, -1, breadcrumb.position, breadcrumbCollisionDistance);
        }
        if (breadcrumbMazePosNear.y - cameraMazePos.y < 0) {
            checkCollisionOnAxis(mazeData, 'y', 'x', 'z', cameraMazePos, breadcrumbMazePosNear, cameraMazePos, -1, breadcrumb.position, breadcrumbCollisionDistance);
        }
        if (breadcrumbMazePosNear.z - cameraMazePos.z < 0) {
            checkCollisionOnAxis(mazeData, 'z', 'y', 'x', cameraMazePos, breadcrumbMazePosNear, cameraMazePos, -1, breadcrumb.position, breadcrumbCollisionDistance);
        }

        if (breadcrumbMazePosFar.x - cameraMazePos.x > 0) {
            checkCollisionOnAxis(mazeData, 'x', 'y', 'z', cameraMazePos, breadcrumbMazePosFar, cameraMazePos, 1, breadcrumb.position, breadcrumbCollisionDistance);
        }
        if (breadcrumbMazePosFar.y - cameraMazePos.y > 0) {
            checkCollisionOnAxis(mazeData, 'y', 'x', 'z', cameraMazePos, breadcrumbMazePosFar, cameraMazePos, 1, breadcrumb.position, breadcrumbCollisionDistance);
        }
        if (breadcrumbMazePosFar.z - cameraMazePos.z > 0) {
            checkCollisionOnAxis(mazeData, 'z', 'y', 'x', cameraMazePos, breadcrumbMazePosFar, cameraMazePos, 1, breadcrumb.position, breadcrumbCollisionDistance);
        }

        this.scene.add(breadcrumb);

        // set the breadcrumb to face the same way as the camera
        camera.getWorldQuaternion(breadcrumb.quaternion);
        breadcrumb.rotateY(Math.PI);

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
            countElement.textContent = count.toString();

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
