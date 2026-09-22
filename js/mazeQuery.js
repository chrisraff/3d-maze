/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Small shared pure-logic helpers for scenery that needs to ask
 * basic questions about a maze - "is this room in bounds", "is this panel
 * solid". No THREE/DOM dependency, mirrors maze.js's own philosophy.
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

export { AXES, WALL_SURFACES, CEILING_SURFACE, FLOOR_SURFACE, ALL_SURFACES, roomInBounds, panelSolid, randomInt, randomRoom };
