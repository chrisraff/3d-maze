/**
 * Hand-drawn mazes for tests, written as a literal picture of `collision_map`:
 * odd segments are open cells, even ones the walls between them. '.' is open,
 * '#' is solid, whitespace ignored. One row per z, one character per x, so a
 * layout reads as a map from above. Single-layer - every cell is at y=1 with
 * solid floor and ceiling; tests needing vertical movement build mazeData
 * directly.
 *
 *     const maze = fromLayout(`
 *         #####
 *         #...#     <- cells (1,1,1) (3,1,1) and the doorway between them
 *         ###.#
 *         #...#
 *         #####
 *     `);
 *
 * Nothing checks that a layout is a tree, and several helpers rely on it, so
 * a loop makes for a bad test rather than an interesting one.
 */

function fromLayout(layout) {
    const rows = layout.split('\n')
        .map(row => row.replace(/\s/g, ''))
        .filter(row => row.length > 0);

    const width = rows[0].length;
    if (rows.some(row => row.length !== width))
        throw new Error('fromLayout: rows must all be the same width');
    if (width % 2 === 0 || rows.length % 2 === 0)
        throw new Error('fromLayout: a segment grid has odd width and height');

    const segments = [width, 3, rows.length];
    const bounds = [(width - 1) / 2, 1, (rows.length - 1) / 2];

    // [x][y][z], true where solid; the floor at y=0 and ceiling at y=2 are
    // solid everywhere, so the only way out of a cell is sideways
    const collision_map = [];
    for (let x = 0; x < segments[0]; x++) {
        collision_map.push([[], [], []]);
        for (let z = 0; z < segments[2]; z++) {
            collision_map[x][0][z] = true;
            collision_map[x][1][z] = rows[z][x] !== '.';
            collision_map[x][2][z] = true;
        }
    }
    return { bounds, segments, collision_map };
}

// every open cell of a layout, for tests that want to sweep the whole maze
function cellsOf(mazeData) {
    const cells = [];
    for (let x = 1; x <= mazeData.bounds[0] * 2 - 1; x += 2)
        for (let z = 1; z <= mazeData.bounds[2] * 2 - 1; z += 2)
            if (mazeData.collision_map[x][1][z] === false) cells.push({ x, y: 1, z });
    return cells;
}

// a readable name for a cell, for test failure messages
const name = cell => `(${cell.x},${cell.y},${cell.z})`;

// a surface as the short string the tests compare against
const dirOf = surface => `${surface.axis}${surface.dir > 0 ? '+' : '-'}`;

export { fromLayout, cellsOf, name, dirOf };
