/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Small shared pure-logic helpers for code that needs to ask basic questions
 * about a maze - "is this cell in bounds", "is this panel solid". No THREE/DOM
 * dependency, mirrors maze.js's own philosophy.
 *
 * Cell and room both mean one of the maze's own open segments here, the way
 * maze.js uses them. The decor modules also call the squares of a panel's 9x9
 * surface grid cells - those are the ones carrying an {i, j}.
 */

const AXES = ['x', 'y', 'z'];

// the 4 side walls
const WALL_SURFACES = [
    { axis: 'x', dir: 1 },
    { axis: 'x', dir: -1 },
    { axis: 'z', dir: 1 },
    { axis: 'z', dir: -1 },
];
const CEILING_SURFACE = { axis: 'y', dir: 1 };
const FLOOR_SURFACE = { axis: 'y', dir: -1 };
const ALL_SURFACES = [...WALL_SURFACES, CEILING_SURFACE, FLOOR_SURFACE];

// rooms live at odd indices 1..2*bounds-1 on every axis
function roomInBounds(mazeData, room) {
    return AXES.every((a, i) => room[a] >= 1 && room[a] <= mazeData.bounds[i] * 2 - 1);
}

// true if the panel adjacent to `room` in (axis, dir) is solid (blocks movement)
function panelSolid(mazeData, room, axis, dir) {
    const p = { ...room, [axis]: room[axis] + dir };
    return mazeData.collision_map[p.x][p.y][p.z] === true;
}

// a segment's index in the maze, flattened - cheap enough to use as a Set key
function segmentKey(mazeData, segment) {
    return segment.x + mazeData.segments[0] * (segment.y + mazeData.segments[1] * segment.z);
}

/**
 * Every segment within `steps` cells of travel from `cell`, as a Set of
 * segmentKey values - the doorways between them included, so a player standing
 * in one still counts. Walking distance, not distance: the next corridor over
 * is one cell away and a long way round.
 *
 * Bounded on purpose. This answers "is that still nearby", not "where is it".
 */
function reachableWithin(mazeData, cell, steps) {
    const seen = new Set([segmentKey(mazeData, cell)]);
    let frontier = [cell];

    for (let step = 0; step < steps && frontier.length > 0; step++) {
        const next = [];
        for (const from of frontier) {
            for (const axis of AXES) {
                for (const dir of [-1, 1]) {
                    if (panelSolid(mazeData, from, axis, dir)) continue;

                    const neighbour = { ...from, [axis]: from[axis] + 2 * dir };
                    if (!roomInBounds(mazeData, neighbour)) continue;

                    const key = segmentKey(mazeData, neighbour);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    seen.add(segmentKey(mazeData, { ...from, [axis]: from[axis] + dir }));
                    next.push(neighbour);
                }
            }
        }
        frontier = next;
    }
    return seen;
}

function randomInt(rng, n) {
    return Math.floor(rng() * n);
}

// a uniformly random room anywhere in the maze
function randomRoom(mazeData, rng) {
    return {
        x: 1 + 2 * randomInt(rng, mazeData.bounds[0]),
        y: 1 + 2 * randomInt(rng, mazeData.bounds[1]),
        z: 1 + 2 * randomInt(rng, mazeData.bounds[2]),
    };
}

export { AXES, WALL_SURFACES, CEILING_SURFACE, FLOOR_SURFACE, ALL_SURFACES, roomInBounds, panelSolid, segmentKey, reachableWithin, randomInt, randomRoom };
