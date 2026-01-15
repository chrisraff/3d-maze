import * as THREE from 'three';
import * as maze from './maze.js';
import checkCollisionOnAxis from './checkCollisionOnAxis.js';

/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

const breadcrumbGeometry = new THREE.BoxGeometry(1, 1, 1);

export default class BreadcrumbManager {
    constructor() {
        this.scene = null;
        this.breadcrumbs = [];
        this.mazedata = null;
        this.raycaster = new THREE.Raycaster();
        this.mouseVector = new THREE.Vector2();
        this.hoveredBreadcrumb = null;
        this.highlightMaterial = new THREE.MeshLambertMaterial({color: 0xffff00, emissive: 0xffffff});
    }

    addTo(scene) {
        this.scene = scene;
    };

    initializeMaze(mazedata) {
        this.mazedata = mazedata;

        // clear existing breadcrumbs
        for (let i = 0; i < this.breadcrumbs.length; i++) {
            this.scene.remove(this.breadcrumbs[i]);
        }
        this.breadcrumbs = [];
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
        for (let i = 0; i < mazedata.analytics.dead_ends_data.length; i++) {
            if (deadEndSelection[i]) {
                const deadEnd = mazedata.analytics.dead_ends_data[i];
                const newMaterial = new THREE.MeshLambertMaterial({color: `hsl(${Math.random() * 360}, 100%, 50%)`});
                const breadcrumb = new THREE.Mesh(breadcrumbGeometry, newMaterial);

                breadcrumb.position.set(
                    deadEnd.position[0] * (maze.minorWidth + maze.majorWidth) / 2,
                    deadEnd.position[1] * (maze.minorWidth + maze.majorWidth) / 2,
                    deadEnd.position[2] * (maze.minorWidth + maze.majorWidth) / 2
                );

                breadcrumb.scale.multiplyScalar(maze.minorWidth * 2);
                
                // Store the original material for unhighlight
                breadcrumb.userData.originalMaterial = newMaterial;

                this.scene.add(breadcrumb);
                this.breadcrumbs.push(breadcrumb);
            }
        }
    }

    handleBreadcrumbInput(camera, mazeData)
    {
        // if a breadcrumb is hovered
        if (this.hoveredBreadcrumb) {
            this.removeBreadcrumbAtMouse();
            return;
        }

        // left click (button 0) - add a breadcrumb
        const newMaterial = new THREE.MeshLambertMaterial({color: `hsl(${Math.random() * 360}, 100%, 50%)`});
        const breadcrumb = new THREE.Mesh(breadcrumbGeometry, newMaterial);
    
        breadcrumb.scale.multiplyScalar(maze.minorWidth * 2);
        breadcrumb.position.copy(camera.position);
        const tmpVector = new THREE.Vector3();
        camera.getWorldDirection(tmpVector);
        breadcrumb.position.addScaledVector(tmpVector, maze.minorWidth * 8);
    
        tmpVector.copy(breadcrumb.position);
        tmpVector.addScalar(maze.minorWidth);
        const breadcrumbMazePosFar = maze.getMazePos(tmpVector);
        tmpVector.addScalar(-2*maze.minorWidth);
        const breadcrumbMazePosNear = maze.getMazePos(tmpVector);
        const cameraMazePos = maze.getMazePos(camera.position);

        if (breadcrumbMazePosNear.x - cameraMazePos.x < 0) {
            checkCollisionOnAxis(mazeData, 'x', 'y', 'z', cameraMazePos, breadcrumbMazePosNear, cameraMazePos, -1, breadcrumb.position, maze.minorWidth);
        }
        if (breadcrumbMazePosNear.y - cameraMazePos.y < 0) {
            checkCollisionOnAxis(mazeData, 'y', 'x', 'z', cameraMazePos, breadcrumbMazePosNear, cameraMazePos, -1, breadcrumb.position, maze.minorWidth);
        }
        if (breadcrumbMazePosNear.z - cameraMazePos.z < 0) {
            checkCollisionOnAxis(mazeData, 'z', 'y', 'x', cameraMazePos, breadcrumbMazePosNear, cameraMazePos, -1, breadcrumb.position, maze.minorWidth);
        }
    
        if (breadcrumbMazePosFar.x - cameraMazePos.x > 0) {
            checkCollisionOnAxis(mazeData, 'x', 'y', 'z', cameraMazePos, breadcrumbMazePosFar, cameraMazePos, 1, breadcrumb.position, maze.minorWidth);
        }
        if (breadcrumbMazePosFar.y - cameraMazePos.y > 0) {
            checkCollisionOnAxis(mazeData, 'y', 'x', 'z', cameraMazePos, breadcrumbMazePosFar, cameraMazePos, 1, breadcrumb.position, maze.minorWidth);
        }
        if (breadcrumbMazePosFar.z - cameraMazePos.z > 0) {
            checkCollisionOnAxis(mazeData, 'z', 'y', 'x', cameraMazePos, breadcrumbMazePosFar, cameraMazePos, 1, breadcrumb.position, maze.minorWidth);
        }
    
        // Store the original material
        breadcrumb.userData.originalMaterial = newMaterial;
        
        this.scene.add(breadcrumb);

        this.breadcrumbs.push(breadcrumb);
    }

    updateHoveredBreadcrumb(camera) {
        this.mouseVector.set(0, 0); // center of screen
        this.raycaster.setFromCamera(this.mouseVector, camera);
        
        const intersects = this.raycaster.intersectObjects(this.breadcrumbs);

        // Unhighlight the previously hovered breadcrumb
        if (this.hoveredBreadcrumb !== null) {
            this.hoveredBreadcrumb.material = this.hoveredBreadcrumb.userData.originalMaterial;
        }

        // Highlight the newly hovered breadcrumb
        if (intersects.length > 0 && intersects[0].distance < maze.majorWidth * 0.75) {
            this.hoveredBreadcrumb = intersects[0].object;
            this.hoveredBreadcrumb.material = this.highlightMaterial;
        } else {
            this.hoveredBreadcrumb = null;
        }
    }

    removeBreadcrumbAtMouse() {
        if (this.hoveredBreadcrumb !== null) {
            this.scene.remove(this.hoveredBreadcrumb);
            const idx = this.breadcrumbs.indexOf(this.hoveredBreadcrumb);
            if (idx > -1) {
                this.breadcrumbs.splice(idx, 1);
            }
            this.hoveredBreadcrumb = null;
        }
    }
}
