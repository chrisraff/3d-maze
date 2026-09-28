import { describe, it, expect } from 'vitest';
import { majorWidth, minorWidth, getWidth, getOffset, generateMaze, getMazePos, isPathClear } from '../js/maze.js';

// Maze indexing convention: even indices are thin wall segments (minorWidth),
// odd indices are open cells (majorWidth). A maze of size s has segments
// 0..2s on each axis; cells live at odd (i,j,k), the player enters at
// (1,1,0) and exits at (2s-1, 2s-1, 2s).

describe('grid geometry', () => {
    it('getWidth returns minorWidth for even indices, majorWidth for odd', () => {
        expect(getWidth(0)).toBe(minorWidth);
        expect(getWidth(1)).toBe(majorWidth);
        expect(getWidth(2)).toBe(minorWidth);
        expect(getWidth(7)).toBe(majorWidth);
    });

    it('getOffset spaces indices by half a (major+minor) pitch', () => {
        expect(getOffset(0)).toBe(0);
        expect(getOffset(2)).toBeCloseTo(majorWidth + minorWidth);
        expect(getOffset(5)).toBeCloseTo(2.5 * (majorWidth + minorWidth));
    });

    it('getMazePos maps a segment-center position back to its index', () => {
        for (let i = 0; i <= 12; i++) {
            const p = { x: getOffset(i), y: getOffset(i), z: getOffset(i) };
            const mazePos = getMazePos(p);
            expect(mazePos.x).toBe(i);
            expect(mazePos.y).toBe(i);
            expect(mazePos.z).toBe(i);
        }
    });

    it('getMazePos maps positions anywhere inside a cell to that cell', () => {
        // just inside the edges of cell index 3
        const lo = getOffset(2) + minorWidth;
        const hi = getOffset(4) - minorWidth;
        expect(getMazePos({ x: lo, y: lo, z: lo }).x).toBe(3);
        expect(getMazePos({ x: hi, y: hi, z: hi }).x).toBe(3);
    });
});

// breadth-first search over open cells; moves are 2 indices with the
// intervening wall index open
function isSolvable(mazeData) {
    const [sx, sy, sz] = mazeData.segments;
    const open = (x, y, z) => !mazeData.collision_map[x][y][z];
    const key = (x, y, z) => x + sx * (y + sy * z);
    const goal = [sx - 2, sy - 2, sz - 2];

    const queue = [[1, 1, 1]];
    const seen = new Set([key(1, 1, 1)]);
    while (queue.length > 0) {
        const [x, y, z] = queue.shift();
        if (x === goal[0] && y === goal[1] && z === goal[2])
            return true;
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
            const nx = x + dx * 2, ny = y + dy * 2, nz = z + dz * 2;
            if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz)
                continue;
            if (seen.has(key(nx, ny, nz)))
                continue;
            if (!open(x + dx, y + dy, z + dz)) // wall between
                continue;
            seen.add(key(nx, ny, nz));
            queue.push([nx, ny, nz]);
        }
    }
    return false;
}

describe.each([2, 3, 4, 5])('generateMaze(%i)', (size) => {
    // maze generation is random; run a few instances per size
    const mazes = Array.from({ length: 3 }, () => generateMaze(size));

    it('reports correct bounds, segments and size string', () => {
        for (const m of mazes) {
            expect(m.bounds).toEqual([size, size, size]);
            expect(m.segments).toEqual([2 * size + 1, 2 * size + 1, 2 * size + 1]);
            expect(m.size_string).toBe(`${size}`);
        }
    });

    it('builds a collision map matching the segment dimensions', () => {
        for (const m of mazes) {
            expect(m.collision_map.length).toBe(m.segments[0]);
            expect(m.collision_map[0].length).toBe(m.segments[1]);
            expect(m.collision_map[0][0].length).toBe(m.segments[2]);
        }
    });

    it('hollows out every cell position', () => {
        for (const m of mazes) {
            for (let i = 1; i < m.segments[0]; i += 2)
                for (let j = 1; j < m.segments[1]; j += 2)
                    for (let k = 1; k < m.segments[2]; k += 2)
                        expect(m.collision_map[i][j][k]).toBe(false);
        }
    });

    it('opens the entrance and exit, and only those, on the outer shell', () => {
        for (const m of mazes) {
            const last = 2 * size;
            expect(m.collision_map[1][1][0]).toBe(false);
            expect(m.collision_map[last - 1][last - 1][last]).toBe(false);

            let openings = 0;
            for (let i = 0; i <= last; i++)
                for (let j = 0; j <= last; j++)
                    for (let k = 0; k <= last; k++) {
                        const onShell = i === 0 || i === last || j === 0 || j === last || k === 0 || k === last;
                        if (onShell && !m.collision_map[i][j][k])
                            openings++;
                    }
            expect(openings).toBe(2);
        }
    });

    it('is solvable from entrance to exit', () => {
        for (const m of mazes) {
            expect(isSolvable(m)).toBe(true);
        }
    });

    it('produces analytics with a plausible solution distance', () => {
        for (const m of mazes) {
            // shortest possible path visits 3*(size-1)+1 cells;
            // distance_from_start counts the entrance cell as 1
            const minCells = 3 * (size - 1) + 1;
            const maxCells = size ** 3;
            expect(m.analytics.distance_to_end).toBeGreaterThanOrEqual(minCells);
            expect(m.analytics.distance_to_end).toBeLessThanOrEqual(maxCells);
            expect(m.analytics.branches_total).toBeGreaterThanOrEqual(0);
            expect(Array.isArray(m.analytics.dead_ends_data)).toBe(true);
        }
    });
});

describe('isPathClear', () => {
    // a 9x9x9 grid of open segments; close the panels a test cares about
    const openMaze = (...solid) => {
        const collision_map = Array.from({ length: 9 },
            () => Array.from({ length: 9 }, () => Array(9).fill(false)));
        for (const [i, j, k] of solid) collision_map[i][j][k] = true;
        return { collision_map };
    };
    const at = (i, j, k) => ({ x: getOffset(i), y: getOffset(j), z: getOffset(k) });

    it('is clear between two rooms with the panel between them open', () => {
        expect(isPathClear(openMaze(), at(1, 1, 1), at(1, 1, 3))).toBe(true);
    });

    it('is blocked when that panel is solid', () => {
        expect(isPathClear(openMaze([1, 1, 2]), at(1, 1, 1), at(1, 1, 3))).toBe(false);
    });

    it('does not step over a panel thinner than the rooms either side of it', () => {
        // a sampler coarser than minorWidth would walk straight through this
        const from = { x: getOffset(1), y: getOffset(1), z: getOffset(2) - 0.2 };
        const to = { x: getOffset(1), y: getOffset(1), z: getOffset(2) + 0.2 };
        expect(isPathClear(openMaze([1, 1, 2]), from, to)).toBe(false);
    });

    it('is blocked by a panel crossed at a shallow angle', () => {
        const from = { x: getOffset(1) - 0.9, y: getOffset(1) - 0.9, z: getOffset(2) - 0.05 };
        const to = { x: getOffset(1) + 0.9, y: getOffset(1) + 0.9, z: getOffset(2) + 0.05 };
        expect(isPathClear(openMaze([1, 1, 2]), from, to)).toBe(false);
    });

    it('stops short of a panel that lies just beyond the far end', () => {
        const from = at(1, 1, 1);
        const to = { x: getOffset(1), y: getOffset(1), z: getOffset(2) - minorWidth };
        expect(isPathClear(openMaze([1, 1, 2]), from, to)).toBe(true);
    });

    it('rejects both endpoints being inside solid maze', () => {
        const inPanel = at(1, 1, 2);
        expect(isPathClear(openMaze([1, 1, 2]), inPanel, at(1, 1, 1))).toBe(false);
        expect(isPathClear(openMaze([1, 1, 2]), at(1, 1, 1), inPanel)).toBe(false);
    });

    it('treats a zero-length line as clear when it is in open space', () => {
        expect(isPathClear(openMaze([1, 1, 2]), at(1, 1, 1), at(1, 1, 1))).toBe(true);
    });

    it('agrees with dense sampling of a real maze', () => {
        const m = generateMaze(4);
        // Ground truth by brute force. Segment lookup is by the walls' real
        // edges rather than getMazePos, whose tolerance around a panel reaches
        // half a panel past it - see exactSegment in maze.js.
        const pitch = majorWidth + minorWidth;
        const segment = (x) => {
            const cell = Math.floor(x / pitch);
            const within = x - cell * pitch;
            if (within < minorWidth / 2) return 2 * cell;
            if (within > pitch - minorWidth / 2) return 2 * (cell + 1);
            return 2 * cell + 1;
        };
        const sample = (from, to) => {
            const steps = 20000;
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const i = segment(from.x + (to.x - from.x) * t);
                const j = segment(from.y + (to.y - from.y) * t);
                const k = segment(from.z + (to.z - from.z) * t);
                if (m.collision_map[i]?.[j]?.[k] === true) return false;
            }
            return true;
        };

        // fixed lines rather than random ones, so a failure is reproducible
        const span = m.bounds[0] * 2 * pitch / 2;
        let checked = 0;
        for (let n = 0; n < 400; n++) {
            const h = (a) => ((Math.sin(n * a) + 1) / 2); // deterministic spread
            const from = { x: h(12.9898) * span, y: h(78.233) * span, z: h(37.719) * span };
            const to = { x: from.x + h(4.898) * 3 - 1.5,
                         y: from.y + h(23.14) * 3 - 1.5,
                         z: from.z + h(91.17) * 3 - 1.5 };
            expect(isPathClear(m, from, to)).toBe(sample(from, to));
            checked++;
        }
        expect(checked).toBe(400);
    });
});
