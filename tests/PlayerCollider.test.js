import { describe, it, expect } from 'vitest';
import PlayerCollider from '../js/PlayerCollider.js';
import { generateMaze, getOffset, minorWidth } from '../js/maze.js';

const COLLISION_DISTANCE = 0.25;

// player starts in the entrance cell (maze indices 1,1,1)
function startPosition() {
    return { x: getOffset(1), y: getOffset(1), z: getOffset(1) };
}

function makeCollider(mazeData, position) {
    const collider = new PlayerCollider(COLLISION_DISTANCE);
    collider.update(mazeData, position); // first call initializes near/far tracking
    return collider;
}

describe('PlayerCollider', () => {
    it('reports the far-corner maze position', () => {
        const mazeData = generateMaze(2);
        const pos = startPosition();
        const collider = new PlayerCollider(COLLISION_DISTANCE);
        const far = collider.update(mazeData, pos);
        expect(far).toEqual({ x: 1, y: 1, z: 1 });
    });

    it('clamps movement into the -x shell wall', () => {
        const mazeData = generateMaze(2);
        const pos = startPosition();
        const collider = makeCollider(mazeData, pos);

        pos.x = getOffset(0); // try to push through the outer wall at x index 0
        collider.update(mazeData, pos);

        // clamped to the wall face plus collision radius
        expect(pos.x).toBeCloseTo(getOffset(0) + COLLISION_DISTANCE + minorWidth / 2);
        expect(collider.mazePosNear.x).toBe(1); // still registered inside the cell
    });

    it('clamps movement into the +y shell wall from the far corner cell', () => {
        const size = 2;
        const mazeData = generateMaze(size);
        const last = 2 * size;
        // start in the far corner cell
        const pos = { x: getOffset(last - 1), y: getOffset(last - 1), z: getOffset(last - 1) };
        const collider = makeCollider(mazeData, pos);

        pos.y = getOffset(last); // push into the ceiling
        collider.update(mazeData, pos);

        expect(pos.y).toBeCloseTo(getOffset(last) - COLLISION_DISTANCE - minorWidth / 2);
    });

    it('allows movement out through the open entrance', () => {
        const mazeData = generateMaze(2);
        const pos = startPosition();
        const collider = makeCollider(mazeData, pos);

        // step just past the entrance wall plane (segment 0 on z);
        // collision_map[1][1][0] is open, so nothing should clamp
        const target = getOffset(0);
        pos.z = target;
        collider.update(mazeData, pos);

        expect(pos.z).toBe(target);
        expect(collider.mazePosNear.z).toBe(0);
    });

    it('walks the full entrance corridor without getting stuck (multi-frame)', () => {
        const mazeData = generateMaze(3);
        const pos = { x: getOffset(1), y: getOffset(1), z: getOffset(-2) };
        const collider = makeCollider(mazeData, pos);

        // walk forward in small steps from outside the maze into the first cell
        const goal = getOffset(1);
        let clampedEarly = false;
        while (pos.z < goal) {
            pos.z = Math.min(pos.z + 0.05, goal);
            const before = pos.z;
            collider.update(mazeData, pos);
            if (pos.z !== before)
                clampedEarly = true;
        }
        expect(clampedEarly).toBe(false);
        expect(collider.mazePosFar).toEqual({ x: 1, y: 1, z: 1 });
    });

    it('reset() re-initializes tracking at the next update', () => {
        const mazeData = generateMaze(2);
        const pos = startPosition();
        const collider = makeCollider(mazeData, pos);

        collider.reset();
        expect(collider.mazePosNear).toBeNull();
        expect(collider.mazePosFar).toBeNull();

        // after reset, a far-away position initializes cleanly instead of clamping
        const elsewhere = { x: getOffset(3), y: getOffset(1), z: getOffset(1) };
        collider.update(mazeData, elsewhere);
        expect(collider.mazePosFar).toEqual({ x: 3, y: 1, z: 1 });
        expect(elsewhere.x).toBe(getOffset(3));
    });
});
