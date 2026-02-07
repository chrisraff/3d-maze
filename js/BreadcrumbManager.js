import * as THREE from 'three';
import * as maze from './maze.js';
import checkCollisionOnAxis from './checkCollisionOnAxis.js';

/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

const hitBoxGeometry = new THREE.SphereGeometry(0.5, 6, 6);
const hitBoxMaterial = new THREE.MeshBasicMaterial();

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

        this.raycaster.layers.set(1);
    }

    addTo(scene) {
        this.scene = scene;
    };

    addEventListeners(element, camera) {
        // track touches - a quick single tap adds or removes a breadcrumb
        element.addEventListener('touchstart', (event) =>
        {
            // get the latest touch only
            let touch = event.touches[event.touches.length - 1];
            this.touchData[touch.identifier] = {
                touchStartTime: Date.now(),
                touchStartX: touch.clientX,
                touchStartY: touch.clientY
            };

            this.mouseVector.set(
                (touch.clientX / window.innerWidth) * 2 - 1,
                -(touch.clientY / window.innerHeight) * 2 + 1
            );
        });

        element.addEventListener('touchend', (event) =>
        {
            // check if the touch was a quick tap (no movement)
            if (event.changedTouches.length == 0)
                return;

            let touch = event.changedTouches[0];
            if (!(touch.identifier in this.touchData))
                return;

            // check if the touch was a quick tap (no movement)
            const touchData = this.touchData[touch.identifier];
            const timeDiff = Date.now() - touchData.touchStartTime;
            const distance = Math.sqrt(
                Math.pow(touch.clientX - touchData.touchStartX, 2) +
                Math.pow(touch.clientY - touchData.touchStartY, 2)
            );
            if (timeDiff > 500 || distance > 10) {
                // not a quick tap
                delete this.touchData[touch.identifier];
                return;
            }

            delete this.touchData[touch.identifier];

            this.handleBreadcrumbTap(camera, this.mazedata, 2 * touch.clientX / window.innerWidth - 1, 1 - 2 * touch.clientY / window.innerHeight);
        });

        element.addEventListener('mousedown', (event) =>
        {
            if (event.button !== 0)
                return;

            this.handleBreadcrumbClick(camera, this.mazedata);
        });
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
        const breadcrumb = this.raycastSearchForBreadcrumb(camera);

        // Unhighlight the previously hovered breadcrumb
        if (this.hoveredBreadcrumb !== null) {
            this.hoveredBreadcrumb.userData.mesh.material = this.hoveredBreadcrumb.userData.originalMaterial;
        }

        // Highlight the newly hovered breadcrumb
        if (breadcrumb !== null) {
            this.hoveredBreadcrumb = breadcrumb;
            this.hoveredBreadcrumb.userData.mesh.material = this.highlightMaterial;
        } else {
            this.hoveredBreadcrumb = null;
        }
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
                    return intersects[i].object.userData.parentBreadcrumb;
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
        const planePoint = new THREE.Vector3();
        planePoint.copy(camera.position).addScaledVector(planeNormal, maze.majorWidth * 0.33);
        const plane = new THREE.Plane(planeNormal, -planeNormal.dot(planePoint));

        const intersection = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(plane, intersection);
        breadcrumb.position.copy(intersection);

        tmpVector.copy(breadcrumb.position);
        tmpVector.addScalar(maze.minorWidth);
        const breadcrumbMazePosFar = maze.getMazePos(tmpVector);
        tmpVector.addScalar(-2*maze.minorWidth);
        const breadcrumbMazePosNear = maze.getMazePos(tmpVector);
        const cameraMazePos = maze.getMazePos(camera.position);

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

        // set the breadcrumb to point away from the camera
        breadcrumb.lookAt(camera.position);
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
