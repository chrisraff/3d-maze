import * as THREE from 'three';
import * as maze from './maze.js';
import checkCollisionOnAxis from './checkCollisionOnAxis.js';
import { YIELD } from './TouchArbiter.js';

/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

const hitBoxGeometry = new THREE.SphereGeometry(0.5, 6, 6);
const hitBoxMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false });

export default class BreadcrumbManager {
    constructor() {
        this.scene = null;
        this.breadcrumbs = [];
        this.mazedata = null;
        this.raycaster = new THREE.Raycaster();
        this.mouseVector = new THREE.Vector2();
        this.hoveredBreadcrumb = null;
        this.highlightMaterial = new THREE.MeshLambertMaterial({color: 0xffff00, emissive: 0xffffff});
        this.breadcrumbGeometry = null;

        this.breadcrumbStack = [];

        this.touchData = {} // map of touch identifier to touch data
        this.touchTapMaxDurationMs = 350;
        this.touchTapMaxMovePx = 10;

        this.raycaster.layers.set(1);

        this.vrHeldBreadcrumb = null;
        this.vrHeldGrip = null;
        this.vrWallRaycaster = new THREE.Raycaster();
        this.vrWallRaycaster.layers.set(1);
        // reusable temp objects to avoid per-frame allocation in updateVRHeld
        this._vrGripPos = new THREE.Vector3();
        this._vrGripQuat = new THREE.Quaternion();
        this._vrRayDir = new THREE.Vector3();
    }

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

    initializeMaze(mazedata) {
        this.mazedata = mazedata;

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

                const newMaterial = new THREE.MeshLambertMaterial({color: `hsl(${Math.random() * 360}, 100%, 50%)`});
                breadcrumb.userData.originalMaterial = newMaterial; // Store the original material for unhighlight

                this.updateBreadcrumbMesh(breadcrumb);

                const hitBox = new THREE.Mesh(hitBoxGeometry, hitBoxMaterial);
                hitBox.scale.multiplyScalar(1.2);
                hitBox.userData.isBreadCrumbHitBox = true;
                hitBox.userData.parentBreadcrumb = breadcrumb;
                hitBox.layers.set(1);
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

    handleBreadcrumbTap(camera, mazeData, sceneX=0, sceneY=0)
    {
        const breadcrumb = this.raycastSearchForBreadcrumb(camera, sceneX, sceneY);
        if (breadcrumb !== null) {
            // remove the breadcrumb
            this.removeBreadcrumb(breadcrumb);
            return;
        }

        this.addBreadcrumb(camera, mazeData, sceneX, sceneY);
    }

    handleBreadcrumbClick(camera, mazeData) {
        // if a breadcrumb is hovered, remove it
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

    handleVRSelect(gripObject, playerWorldPos) {
        if (this.vrHeldBreadcrumb !== null) {
            this._commitVRPlacement();
            return;
        }

        // pick up an existing placed breadcrumb if grip is close enough
        gripObject.getWorldPosition(this._vrGripPos);
        const nearby = this._findPickupCandidate(this._vrGripPos, playerWorldPos);
        if (nearby !== null) {
            this.removeBreadcrumb(nearby);
            return;
        }

        if (this.breadcrumbStack.length === 0)
            return;

        const breadcrumb = this.breadcrumbStack.pop();
        this.vrHeldBreadcrumb = breadcrumb;
        this.vrHeldGrip = gripObject;
        this.scene.add(breadcrumb);
        this.updateBreadCrumbDisplay();
    }

    // Returns the closest breadcrumb within both the player distance gate and the grip proximity gate, or null.
    _findPickupCandidate(gripWorldPos, playerWorldPos) {
        const playerGate = maze.majorWidth * 0.75;
        const gripGate = maze.majorWidth * 0.5;

        let best = null;
        let bestDist = Infinity;

        for (const breadcrumb of this.breadcrumbs) {
            const playerDist = playerWorldPos.distanceTo(breadcrumb.position);
            if (playerDist > playerGate)
                continue;
            const gripDist = gripWorldPos.distanceTo(breadcrumb.position);
            if (gripDist > gripGate)
                continue;
            if (gripDist < bestDist) {
                bestDist = gripDist;
                best = breadcrumb;
            }
        }
        return best;
    }

    // Per-frame: highlight the breadcrumb closest to any connected grip that meets both distance gates.
    // gripPositions is an array of Vector3 world positions (one per connected controller).
    updateVRProximityHighlight(gripPositions, playerWorldPos) {
        if (this.vrHeldBreadcrumb !== null) {
            this._setHoveredBreadcrumb(null);
            return;
        }

        let best = null;
        let bestDist = Infinity;
        for (const gripPos of gripPositions) {
            const candidate = this._findPickupCandidate(gripPos, playerWorldPos);
            if (candidate !== null) {
                const d = gripPos.distanceTo(candidate.position);
                if (d < bestDist) {
                    bestDist = d;
                    best = candidate;
                }
            }
        }
        this._setHoveredBreadcrumb(best);
    }

    _setHoveredBreadcrumb(breadcrumb) {
        if (breadcrumb === this.hoveredBreadcrumb)
            return;
        if (this.hoveredBreadcrumb !== null)
            this.hoveredBreadcrumb.userData.mesh.material = this.hoveredBreadcrumb.userData.originalMaterial;
        this.hoveredBreadcrumb = breadcrumb;
        if (this.hoveredBreadcrumb !== null)
            this.hoveredBreadcrumb.userData.mesh.material = this.highlightMaterial;
    }

    updateVRHeld(playerWorldPosition) {
        if (this.vrHeldBreadcrumb === null || this.vrHeldGrip === null)
            return;

        this.vrHeldGrip.getWorldPosition(this._vrGripPos);
        this.vrHeldGrip.getWorldQuaternion(this._vrGripQuat);

        // raycast from player toward grip — clamp to wall if blocked
        this._vrRayDir.subVectors(this._vrGripPos, playerWorldPosition);
        const dist = this._vrRayDir.length();
        this._vrRayDir.divideScalar(dist);
        this.vrWallRaycaster.set(playerWorldPosition, this._vrRayDir);
        this.vrWallRaycaster.far = dist;
        const hits = this.vrWallRaycaster.intersectObjects(this.scene.children, true);
        this.vrWallRaycaster.far = Infinity;

        let targetPos = this._vrGripPos;
        for (const hit of hits) {
            if (hit.object.userData.isMazeWallHitBox) {
                targetPos = hit.point;
                break;
            }
        }

        this.vrHeldBreadcrumb.position.copy(targetPos);
        this.vrHeldBreadcrumb.quaternion.copy(this._vrGripQuat);
        this.vrHeldBreadcrumb.rotateY(Math.PI);
    }

    _commitVRPlacement() {
        this.breadcrumbs.push(this.vrHeldBreadcrumb);
        this.vrHeldBreadcrumb = null;
        this.vrHeldGrip = null;
        this.updateBreadCrumbDisplay();
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
                    // don't interact with the breadcrumb currently held in VR
                    if (breadcrumb === this.vrHeldBreadcrumb)
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
            this.hoveredBreadcrumb.userData.mesh.material = this.hoveredBreadcrumb.userData.originalMaterial;
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
