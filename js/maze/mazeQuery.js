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

/**
 * A set of cells, as segmentKey -> room. A plain Map, so membership is one
 * lookup and iterating still hands the cells back. Regions are passed around
 * in this shape throughout - see mazeNexus.js.
 */
function cellMap(mazeData, rooms) {
    return new Map(rooms.map(room => [segmentKey(mazeData, room), room]));
}

// the room on the other side of one of `room`'s surfaces
function neighbour(room, surface) {
    return { ...room, [surface.axis]: room[surface.axis] + 2 * surface.dir };
}

/**
 * The surfaces of `room` you can walk out of: open panel *and* a room beyond.
 * The maze's entrance and exit are holes in the outer shell, so an open panel
 * there leads out of the maze rather than onward.
 */
function openSides(mazeData, room) {
    return ALL_SURFACES.filter(surface =>
        !panelSolid(mazeData, room, surface.axis, surface.dir)
        && roomInBounds(mazeData, neighbour(room, surface)));
}

/**
 * The one path from `from` to `to`, as a list of cells, or null if there is
 * none. Unique because the maze is a tree - verified across sizes, 90 of 90
 * mazes with no loop at all.
 */
function pathBetween(mazeData, from, to) {
    const target = segmentKey(mazeData, to);
    const parents = new Map([[segmentKey(mazeData, from), null]]);
    const queue = [from];

    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        if (segmentKey(mazeData, current) === target) break;
        for (const surface of openSides(mazeData, current)) {
            const next = neighbour(current, surface);
            const key = segmentKey(mazeData, next);
            if (parents.has(key)) continue;
            parents.set(key, current);
            queue.push(next);
        }
    }

    if (!parents.has(target)) return null;
    const path = [];
    for (let cell = to; cell; cell = parents.get(segmentKey(mazeData, cell))) path.push(cell);
    return path;
}

/**
 * What `room` can see: itself, plus the straight run down each of its six
 * surfaces until a wall stops it. Axis rays only, so cells glimpsed at an
 * angle are not in here - and mazeNexus.js's thresholds are calibrated to
 * that strict reading.
 */
function sightSet(mazeData, room) {
    const seen = cellMap(mazeData, [room]);
    for (const surface of ALL_SURFACES)
        for (const cell of rayCells(mazeData, room, surface))
            seen.set(segmentKey(mazeData, cell), cell);
    return seen;
}

// the cells along one straight ray out of `room`, nearest first, stopping at
// whatever closes the sightline off
function rayCells(mazeData, room, surface) {
    const cells = [];
    let current = room;
    for (;;) {
        if (panelSolid(mazeData, current, surface.axis, surface.dir)) break;
        const next = neighbour(current, surface);
        if (!roomInBounds(mazeData, next)) break;
        cells.push(next);
        current = next;
    }
    return cells;
}

/**
 * How many cells can be reached from `from` without re-entering `region`,
 * giving up once the count passes `limit` so that telling a stub from a real
 * branch never walks the rest of the maze.
 */
function reachBeyond(mazeData, from, region, limit) {
    const seen = new Set([segmentKey(mazeData, from)]);
    const queue = [from];

    for (let head = 0; head < queue.length && seen.size <= limit; head++) {
        for (const surface of openSides(mazeData, queue[head])) {
            const next = neighbour(queue[head], surface);
            const key = segmentKey(mazeData, next);
            if (region.has(key) || seen.has(key)) continue;
            seen.add(key);
            queue.push(next);
        }
    }
    return seen.size;
}

/**
 * Every way out of `region`: the cell inside it and the surface leading away.
 *
 * `stub` discards ways out that die within that many cells, which is most of
 * what separates a place that reads as branching from one that does not; 0
 * keeps every opening. One entry per opening, no de-duplicating: the maze is
 * a tree, so no two ways out can reach the same place.
 */
function waysOut(mazeData, region, stub = 0) {
    const out = [];
    for (const room of region.values())
        for (const surface of openSides(mazeData, room)) {
            const next = neighbour(room, surface);
            if (region.has(segmentKey(mazeData, next))) continue;
            if (stub > 0 && reachBeyond(mazeData, next, region, stub) <= stub) continue;
            out.push({ room, surface });
        }
    return out;
}

/**
 * How branchy the place `room` stands in looks: the ways out of everything it
 * can see, not of the one cell it occupies. Matches hand-labelled nexuses far
 * better than a cell's own branch count - see mazeNexus.js.
 */
function sightScore(mazeData, room, stub = 1) {
    return waysOut(mazeData, sightSet(mazeData, room), stub).length;
}

/**
 * Where looking out of `room` along `surface` ends: the far cell of that
 * straight ray, and the surface of it that stopped the view. A feature there is
 * what somebody standing at `room` sees when they look this way, which is what
 * makes it the place to mark that direction with.
 *
 * This is the end of the SIGHTLINE, not the end of the corridor, and the
 * difference matters. A ray that passes a side opening carries on - at a
 * four-way junction you see straight through it - whereas the corridor arguably
 * stopped there. Following the corridor instead would sometimes name a panel
 * that is an open doorway, which can hold no feature at all and is not what the
 * player is looking at either.
 *
 * The panel named is therefore always solid, with one exception: the maze's own
 * entrance and exit are holes in the outer shell, so a ray ending on one names
 * an open panel. Two panels per maze - callers placing anything should check.
 */
function sightlineEnd(mazeData, room, surface) {
    const cells = rayCells(mazeData, room, surface);
    return { room: cells[cells.length - 1] ?? room, surface };
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

export {
    AXES, WALL_SURFACES, CEILING_SURFACE, FLOOR_SURFACE, ALL_SURFACES,
    roomInBounds, panelSolid, segmentKey, reachableWithin, randomInt, randomRoom,
    cellMap, neighbour, openSides, pathBetween, sightSet, waysOut,
    sightScore, sightlineEnd,
};
