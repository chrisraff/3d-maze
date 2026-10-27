/**
 * Pure player-vs-maze collision resolution — no THREE, no DOM.
 *
 * Tracks the maze-grid positions of the near and far corners of the player's
 * axis-aligned collision cube, and clamps `position` back out of walls when a
 * corner tries to cross into a filled segment. `position` only needs mutable
 * x/y/z, so a THREE.Vector3 works directly.
 */
import * as maze from './maze.js';
import checkCollisionOnAxis from './checkCollisionOnAxis.js';

const AXES = ['x', 'y', 'z'];

export default class PlayerCollider {
    constructor(collisionDistance) {
        this.collisionDistance = collisionDistance;
        this.mazePosNear = null; // closer to 0,0,0 (-)
        this.mazePosFar = null;
    }

    // call when the maze is rebuilt or the player is teleported to a fresh start
    reset() {
        this.mazePosNear = null;
        this.mazePosFar = null;
    }

    // resolves collisions for this frame, mutating position; returns the far
    // corner's maze position (used for checkpoint/completion checks)
    update(mazeData, position) {
        const cd = this.collisionDistance;
        const newMazePosNear = maze.getMazePos({ x: position.x - cd, y: position.y - cd, z: position.z - cd });
        const newMazePosFar  = maze.getMazePos({ x: position.x + cd, y: position.y + cd, z: position.z + cd });

        // initialize (only happens at start)
        if (this.mazePosNear == null && this.mazePosFar == null) {
            this.mazePosNear = newMazePosNear;
            this.mazePosFar = newMazePosFar;
        }

        // if the player moved more than 1 segment on any axis, clamp the step
        for (const axis of AXES) {
            if (Math.abs(newMazePosNear[axis] - this.mazePosNear[axis]) > 1) {
                newMazePosNear[axis] = this.mazePosNear[axis] + Math.sign(newMazePosNear[axis] - this.mazePosNear[axis]);
            }
            if (Math.abs(newMazePosFar[axis] - this.mazePosFar[axis]) > 1) {
                newMazePosFar[axis] = this.mazePosFar[axis] + Math.sign(newMazePosFar[axis] - this.mazePosFar[axis]);
            }
        }

        const moved = (a, b) => a.x != b.x || a.y != b.y || a.z != b.z;

        if (moved(newMazePosNear, this.mazePosNear)) {
            if (newMazePosNear.x - this.mazePosNear.x < 0) {
                checkCollisionOnAxis(mazeData, 'x', 'y', 'z', this.mazePosNear, newMazePosNear, this.mazePosFar, -1, position, cd);
            }
            if (newMazePosNear.y - this.mazePosNear.y < 0) {
                checkCollisionOnAxis(mazeData, 'y', 'x', 'z', this.mazePosNear, newMazePosNear, this.mazePosFar, -1, position, cd);
            }
            if (newMazePosNear.z - this.mazePosNear.z < 0) {
                checkCollisionOnAxis(mazeData, 'z', 'y', 'x', this.mazePosNear, newMazePosNear, this.mazePosFar, -1, position, cd);
            }
        }
        if (moved(newMazePosFar, this.mazePosFar)) {
            if (newMazePosFar.x - this.mazePosFar.x > 0) {
                checkCollisionOnAxis(mazeData, 'x', 'y', 'z', this.mazePosFar, newMazePosFar, this.mazePosNear, 1, position, cd);
            }
            if (newMazePosFar.y - this.mazePosFar.y > 0) {
                checkCollisionOnAxis(mazeData, 'y', 'x', 'z', this.mazePosFar, newMazePosFar, this.mazePosNear, 1, position, cd);
            }
            if (newMazePosFar.z - this.mazePosFar.z > 0) {
                checkCollisionOnAxis(mazeData, 'z', 'y', 'x', this.mazePosFar, newMazePosFar, this.mazePosNear, 1, position, cd);
            }
        }

        this.mazePosNear = newMazePosNear;
        this.mazePosFar = newMazePosFar;

        return this.mazePosFar;
    }
}
