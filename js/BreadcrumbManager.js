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
    }

    addTo(scene) {
        this.scene = scene;
    };

    initializeMaze(mazedata) {
        this.mazedata = mazedata;

        // clear existing breadcrumbs

        // set up initial breadcrumbs at random dead ends
    }

    handleBreadcrumbInput(idx, camera, mazeData)
    {
        // add a breadcrumb
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
    
        this.scene.add(breadcrumb);
    }

}
