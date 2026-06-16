import * as maze from './maze.js';

var axes = {x: 0, y: 1, z: 2};

export default function checkCollisionOnAxis(mazeData, majorAxis, othA0, othA1, mazePosRelevant, newMazePosRelevant, mazePosOther, sign, targetVector, collisionDistance) {
    let min0 = Math.min(mazePosRelevant[othA0], mazePosOther[othA0]);
    let max0 = Math.max(mazePosRelevant[othA0], mazePosOther[othA0]);
    let min1 = Math.min(mazePosRelevant[othA1], mazePosOther[othA1]);
    let max1 = Math.max(mazePosRelevant[othA1], mazePosOther[othA1]);

    let collided = false;
    let colAx = mazePosRelevant[majorAxis] + sign;
    // solution for reading into maze xyz in correct order
    let indices = Array(3);
    indices[axes[majorAxis]] = colAx;
    function getMazeData(idx0, idx1) {
        indices[axes[othA0]] = idx0;
        indices[axes[othA1]] = idx1;
        return mazeData.collision_map[indices[0]][indices[1]][indices[2]];
    }
    // check for collisions on orthogonal axese
    for (let i = Math.max(min0, 0); i <= Math.min(mazeData.bounds[axes[othA0]]*2, max0); i++) {
        for (let j = Math.max(min1, 0); j <= Math.min(mazeData.bounds[axes[othA1]]*2, max1); j++) {
            if (colAx >= 0 && colAx <= mazeData.bounds[axes[majorAxis]]*2 && getMazeData(i, j)) {
                collided = true;
                break;
            }
        }
        if (collided)
            break;
    }
    if (collided) {
        targetVector[majorAxis] = maze.getOffset(mazePosRelevant[majorAxis]+sign) - sign * (collisionDistance + maze.minorWidth/2);
        newMazePosRelevant[majorAxis] = mazePosRelevant[majorAxis];
    } else {
        mazePosRelevant[majorAxis] += sign;
    }
};
