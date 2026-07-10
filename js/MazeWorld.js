/**
 * Owns the maze's scene representation: instanced wall/block meshes, the
 * layer-3 raycast hitboxes, and the geometries/materials behind them.
 * Maze *data* comes from maze.js; this module turns it into THREE objects.
 */
import * as THREE from 'three';
import * as maze from './maze.js';

const PI_2 = Math.PI / 2;

export default class MazeWorld {
    constructor() {
        this.group = new THREE.Group();
        this.mazeData = null;

        this.blockGeometry = new THREE.InstancedBufferGeometry();
        THREE.BufferGeometry.prototype.copy.call(this.blockGeometry, new THREE.BoxGeometry());

        this.wallHitGeometry = new THREE.InstancedBufferGeometry();
        THREE.BufferGeometry.prototype.copy.call(this.wallHitGeometry, new THREE.BoxGeometry());

        // filled in once models/wall.glb loads (see setWallGeometry)
        this.wallGeometry = new THREE.InstancedBufferGeometry();

        this.wallMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.darkMaterial = new THREE.MeshPhongMaterial({ color: 'hsl(0, 0%, 10%)' });
        this.basicMaterial = new THREE.MeshBasicMaterial();
    }

    addTo(scene) {
        scene.add(this.group);
    }

    setWallGeometry(geometry) {
        THREE.BufferGeometry.prototype.copy.call(this.wallGeometry, geometry);
    }

    // generates a new maze and rebuilds the scene meshes; returns the maze data
    build(size) {
        this.group.remove(...this.group.children);

        let dummyWall = new THREE.Object3D;
        let wallMatrices = [];
        let wallColors = [];
        let blockMatrices = [];

        const mazeData = maze.generateMaze(size);
        this.mazeData = mazeData;

        for (let i = 0; i < mazeData.collision_map.length; i++) {
            for (let j = 0; j < mazeData.collision_map[i].length; j++) {
                for (let k = 0; k < mazeData.collision_map[i][j].length; k++) {
                    if (    !mazeData.collision_map[i][j][k] ||
                            (i!=0 && i!=mazeData.bounds[0]*2 && j!=0 && j!=mazeData.bounds[1]*2 && k!=0 && k!=mazeData.bounds[2]*2 && // if we're inside...
                                i%2==0 && j%2==0 && k%2==0)) // don't create unseen blocks
                        continue;

                    let iWidth = maze.getWidth(i);
                    let jWidth = maze.getWidth(j);
                    let kWidth = maze.getWidth(k);

                    // only large walls get color
                    let colorful = false;
                    if (iWidth + jWidth + kWidth >= 2 * maze.majorWidth + maze.minorWidth)
                        colorful = true;

                    if (colorful) {
                        dummyWall.scale.set( maze.majorWidth, maze.minorWidth, maze.majorWidth );
                        dummyWall.position.set( maze.getOffset(i), maze.getOffset(j), maze.getOffset(k) );

                        // rotate appropriately
                        if (iWidth == maze.minorWidth) {
                            dummyWall.rotation.z = PI_2;
                        } else if (kWidth == maze.minorWidth) {
                            dummyWall.rotation.x = PI_2;
                        }

                        dummyWall.updateMatrix();

                        dummyWall.rotation.set(0,0,0);

                        wallMatrices.push( dummyWall.matrix.clone() );

                        wallColors.push(
                            0.05 + 0.9 * (i-1)/(mazeData.segments[0]),
                            0.05 + 0.9 * (j-1)/(mazeData.segments[1]),
                            0.05 + 0.9 * (k-1)/(mazeData.segments[2])
                        );

                    } else {
                        dummyWall.scale.set( iWidth, jWidth, kWidth );
                        dummyWall.position.set( maze.getOffset(i), maze.getOffset(j), maze.getOffset(k) );

                        dummyWall.updateMatrix();

                        blockMatrices.push( dummyWall.matrix.clone() );
                    }
                }
            }
        }

        this.wallGeometry.setAttribute( 'color', new THREE.InstancedBufferAttribute( new Float32Array( wallColors ), 3 ) );
        let wallInstancedMesh = new THREE.InstancedMesh( this.wallGeometry, this.wallMaterial, wallMatrices.length );
        let i = 0;
        wallMatrices.forEach((mat) => wallInstancedMesh.setMatrixAt( i++, mat ) );
        wallInstancedMesh.needsUpdate = true;

        this.group.add( wallInstancedMesh );

        let blockInstanceMesh = new THREE.InstancedMesh( this.blockGeometry, this.darkMaterial, blockMatrices.length );
        i = 0;
        blockMatrices.forEach((mat) => blockInstanceMesh.setMatrixAt( i++, mat ) );
        blockInstanceMesh.needsUpdate = true;

        // invisible-to-camera hitbox mesh on raycast layer 3 (walls + blocks)
        let wallHitInstanceMesh = new THREE.InstancedMesh( this.wallHitGeometry, this.basicMaterial, wallMatrices.length + blockMatrices.length );
        i = 0;
        wallMatrices.forEach((mat) => wallHitInstanceMesh.setMatrixAt( i++, mat ) );
        blockMatrices.forEach((mat) => wallHitInstanceMesh.setMatrixAt( i++, mat ) );
        wallHitInstanceMesh.needsUpdate = true;
        wallHitInstanceMesh.layers.set(3);
        wallHitInstanceMesh.userData.isMazeWallHitBox = true;

        this.group.add( blockInstanceMesh );
        this.group.add( wallHitInstanceMesh );

        return mazeData;
    }
}
