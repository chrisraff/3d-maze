import * as THREE from 'three';
import * as maze from './maze.js';
import checkCollisionOnAxis from './checkCollisionOnAxis.js';
import { YIELD } from './TouchArbiter.js';

/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

const hitBoxGeometry = new THREE.SphereGeometry(0.5, 6, 6);
const hitBoxMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

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

        this.touchData = {} // map of touch identifier to touch data
        this.touchTapMaxDurationMs = 350;
        this.touchTapMaxMovePx = 10;

        this.raycaster.layers.set(3);

        this._wallRaycaster = new THREE.Raycaster();
        this._wallRaycaster.layers.set(3);
        // reusable temp objects to avoid per-frame allocation
        this._tmpPos = new THREE.Vector3();
        this._rayDir = new THREE.Vector3();
        this._playerWorldPos = new THREE.Vector3();

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
    }

    get interactState() { return this._interactState; }
    get interactTarget() { return this._interactTarget; }

    addTo(scene) {
        this.scene = scene;
    };

    createTouchHandler({ camera, getMazeData = () => this.mazedata } = {}) {
        return {
            onTouchStart: (session, touch) => {
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
        this.handleBreadcrumbTap(camera, mazeData, scenePos.sceneX, scenePos.sceneY);
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
            // translate: breadcrumb follows grip delta, wall-clamped
            this._interactGripObject.getWorldPosition(this._tmpPos);
            this._tmpPos.sub(this._interactStartPos).add(this._interactTargetStartPos);
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
        if (this._interactState !== null) {
            // keep the reoriented breadcrumb highlighted during a hold; clear otherwise
            this._setHoveredBreadcrumb(this._interactState === 'reorienting' ? this._interactTarget : null);
            return;
        }

        camera.getWorldPosition(this._playerWorldPos);

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
        for (let i = 0; i < mazedata.analytics.dead_ends_data.length; i++) {
            if (deadEndSelection[i]) {
                const deadEnd = mazedata.analytics.dead_ends_data[i];
                directionVector.set(...deadEnd.direction);

                const breadcrumb = new THREE.Object3D();

                const newMaterial = new THREE.MeshLambertMaterial({color: `hsl(${Math.random() * 360}, 100%, 50%)`, vertexColors: true});
                breadcrumb.userData.originalMaterial = newMaterial; // Store the original material for unhighlight

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

        this.updateBreadCrumbDisplay();
    }

    // --- Non-VR interaction (touch / mouse) ---

    handleBreadcrumbTap(camera, mazeData, sceneX=0, sceneY=0)
    {
        const breadcrumb = this.raycastSearchForBreadcrumb(camera, sceneX, sceneY);
        if (breadcrumb !== null) {
            this.removeBreadcrumb(breadcrumb);
            return;
        }

        this.addBreadcrumb(camera, mazeData, sceneX, sceneY);
    }

    handleBreadcrumbClick(camera, mazeData) {
        if (this.hoveredBreadcrumb) {
            this.removeBreadcrumb(this.hoveredBreadcrumb);
            return;
        }

        this.addBreadcrumb(camera, mazeData);
    }

    updateHoveredBreadcrumb(camera)
    {
        this._setHoveredBreadcrumb(this.raycastSearchForBreadcrumb(camera));
    }

    _setHoveredBreadcrumb(breadcrumb) {
        if (breadcrumb === this.hoveredBreadcrumb)
            return;
        if (this.hoveredBreadcrumb !== null)
            this.hoveredBreadcrumb.userData.mesh.material.emissive.setScalar(0);
        this.hoveredBreadcrumb = breadcrumb;
        if (this.hoveredBreadcrumb !== null)
            this.hoveredBreadcrumb.userData.mesh.material.emissive.setScalar(0.3);
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

        this.scene.remove(breadcrumb);
        const idx = this.breadcrumbs.indexOf(breadcrumb);
        if (idx > -1) {
            this.breadcrumbs.splice(idx, 1);
        }
        // if necessary, unhighlight the breadcrumb
        if (this.hoveredBreadcrumb === breadcrumb) {
            this.hoveredBreadcrumb.userData.mesh.material.emissive.setScalar(0);
        };
        this.hoveredBreadcrumb = null;

        this.breadcrumbStack.push(breadcrumb);

        this.updateBreadCrumbDisplay();
    }

    addBreadcrumb(camera, mazeData, sceneX=0, sceneY=0) {
        const breadcrumbCollisionDistance = maze.minorWidth * 2;
        if (this.breadcrumbStack.length === 0)
            return;

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
    }

    updateBreadCrumbDisplay() {
        const breadcrumbContainer = document.getElementById('breadcrumb-container');
        if (this.breadcrumbStack.length > 0)
            breadcrumbContainer.innerText = this.breadcrumbStack.length.toString();
        else
            breadcrumbContainer.innerText = "";
    }
}
