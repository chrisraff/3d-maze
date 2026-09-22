/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Scenery: a blotchy patch of small cubes that spreads outward across
 * walls, ceilings and floors, turning corners onto whichever solid panel is
 * next rather than being confined to one room's panel or one surface
 * orientation. Growth is a discrete flood-fill over each panel's own 9x9
 * grid - the same grid the wall model's holes are centered on (see
 * LatticeStudsDecor's file comment), so the cubes read as aligned to the
 * wall pattern. A cell is only ever a single grid step from its neighbors,
 * so - unlike a continuous walker - a step only ever crosses one panel
 * boundary at a time; there's no "clipped a corner diagonally" case to
 * guard against.
 *
 * At each grid step off the edge of the current panel, there are two ways
 * to keep going, and either, both, or neither may be available:
 *   - continue: the same surface (same axis/dir) carries on into whichever
 *     neighboring room shares that edge, hopping through the wall between
 *     them.
 *   - turn: wrap into the room's own inside corner onto a perpendicular
 *     panel of the SAME room (wall to ceiling, wall to floor, wall to the
 *     adjacent wall) - this is what lets a splotch climb onto ceilings and
 *     floors.
 * Not every visited cell is actually rendered (see FILL_CHANCE), so the
 * splotch reads as a patchy, non-solid stain rather than a solid block -
 * growth still propagates through a skipped cell either way.
 */
import * as THREE from 'three';
import { majorWidth, minorWidth, getOffset } from './maze.js';
import { AXES, ALL_SURFACES, roomInBounds, panelSolid, randomRoom, randomInt } from './mazeQuery.js';

const GRID_SIZE = 9; // matches the wall model's 9x9 hole layout
const CELL_SIZE = majorWidth / GRID_SIZE;
const CUBE_SIZE = minorWidth / 2;
const MIN_CELLS = 9; // a splotch smaller than this is discarded and reseeded
// chance a visited cell actually gets a cube, vs. staying an empty hole -
// growth still propagates from a hole either way, so this thins the patch
// out without capping how far it can spread
const FILL_CHANCE = 0.72;
// chance growth continues from a cell into each open neighbor at all -
// keeps a splotch from flood-filling every reachable panel in the maze
const PROPAGATE_CHANCE = 0.88;
const MAX_SEED_ATTEMPTS = 10;

function cellKey(room, surface, i, j) {
    return `${surface.axis}${surface.dir}:${room.x},${room.y},${room.z}:${i},${j}`;
}

// the two axes spanning a panel's own plane, in a fixed order - same order
// regardless of which room/surface is asking, which is what makes the
// "turn" index math below consistent
function inPlaneAxes(surfaceAxis) {
    return AXES.filter(a => a !== surfaceAxis);
}

// every open neighbor of one grid cell: up to 4 directions, each either a
// same-panel step, a same-surface crossing into the next room, a corner
// turn onto a perpendicular panel of the same room, both, or neither
function neighborsOf(mazeData, cell) {
    const { room, surface, i, j } = cell;
    const [axisA, axisB] = inPlaneAxes(surface.axis);
    const out = [];

    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;

        if (ni >= 0 && ni <= GRID_SIZE - 1 && nj >= 0 && nj <= GRID_SIZE - 1) {
            out.push({ room, surface, i: ni, j: nj });
            continue;
        }

        // exactly one of ni/nj is ever out of range at a time, since each
        // step only moves one axis - no corner-clip ambiguity to resolve
        const crossedA = ni < 0 || ni > GRID_SIZE - 1;
        const axis = crossedA ? axisA : axisB;
        const dir = crossedA ? Math.sign(di) : Math.sign(dj);
        const keepIdx = crossedA ? j : i;

        // continue: same surface, into the neighboring room across this edge
        // - only where the connector between the two rooms is solid, so
        // growth hops through the wall rather than across a doorway. A
        // splotch is patchy and discontiguous anyway, so that jump reads
        // fine.
        const continueRoom = { ...room, [axis]: room[axis] + 2 * dir };
        if (roomInBounds(mazeData, continueRoom) && panelSolid(mazeData, continueRoom, surface.axis, surface.dir) && panelSolid(mazeData, room, axis, dir)) {
            const wrapped = dir > 0 ? 0 : GRID_SIZE - 1;
            out.push(axis === axisA
                ? { room: continueRoom, surface, i: wrapped, j: keepIdx }
                : { room: continueRoom, surface, i: keepIdx, j: wrapped });
        }

        // turn: wrap onto a perpendicular panel of the same room. The
        // shared corner edge sits, on the new panel, at the extreme index
        // nearest the old panel's own dir along the old normal axis (now
        // in-plane), with the other in-plane position carried straight
        // across unchanged
        const turnSurface = { axis, dir };
        if (panelSolid(mazeData, room, axis, dir)) {
            const edgeIdx = surface.dir > 0 ? GRID_SIZE - 1 : 0;
            const newAxes = inPlaneAxes(axis);
            let newI, newJ;
            newAxes.forEach((a, idx) => {
                const value = a === surface.axis ? edgeIdx : keepIdx;
                if (idx === 0) newI = value; else newJ = value;
            });
            out.push({ room, surface: turnSurface, i: newI, j: newJ });
        }
    }

    return out;
}

function cellWorldPos(cell) {
    const { room, surface, i, j } = cell;
    const [axisA, axisB] = inPlaneAxes(surface.axis);
    const pos = new THREE.Vector3();
    pos[surface.axis] = getOffset(room[surface.axis]) + surface.dir * majorWidth / 2;
    pos[axisA] = getOffset(room[axisA]) + (i - (GRID_SIZE - 1) / 2) * CELL_SIZE;
    pos[axisB] = getOffset(room[axisB]) + (j - (GRID_SIZE - 1) / 2) * CELL_SIZE;
    return pos;
}

function pushCube(matrices, colors, dummy, tmpColor, position, hue, saturation, lightness) {
    dummy.position.copy(position);
    dummy.scale.set(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    tmpColor.setHSL(((hue % 1) + 1) % 1, saturation, lightness);
    colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
}

export default class SplotchesDecor {
    constructor() {
        this.group = new THREE.Group();
        this.boxGeometry = new THREE.InstancedBufferGeometry();
        THREE.BufferGeometry.prototype.copy.call(this.boxGeometry, new THREE.BoxGeometry());
        this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.mesh = null;
    }

    addTo(scene) {
        scene.add(this.group);
    }

    build(mazeData, rng = Math.random) {
        this.group.remove(...this.group.children);
        this.mesh = null;

        const splotchTarget = Math.max(1, mazeData.bounds[0] - 1);
        const claimed = new Set();

        const dummy = new THREE.Object3D();
        dummy.rotation.set(0, 0, 0);
        const matrices = [];
        const colors = [];
        const tmpColor = new THREE.Color();

        let splotchCount = 0;
        for (let i = 0; i < splotchTarget; i++) {
            if (this._growSplotch(mazeData, claimed, rng, dummy, tmpColor, matrices, colors))
                splotchCount++;
        }

        if (matrices.length === 0)
            return 0;

        this.boxGeometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(colors), 3));
        this.mesh = new THREE.InstancedMesh(this.boxGeometry, this.material, matrices.length);
        matrices.forEach((m, i) => this.mesh.setMatrixAt(i, m));
        this.mesh.instanceMatrix.needsUpdate = true;
        this.group.add(this.mesh);

        return splotchCount;
    }

    // picks a seed panel + flood-fills outward from its center cell,
    // rendering cubes for the filled cells directly
    _growSplotch(mazeData, claimed, rng, dummy, tmpColor, matrices, colors) {
        for (let attempt = 0; attempt < MAX_SEED_ATTEMPTS; attempt++) {
            const room = randomRoom(mazeData, rng);
            const surface = ALL_SURFACES[randomInt(rng, ALL_SURFACES.length)];
            if (!panelSolid(mazeData, room, surface.axis, surface.dir)) continue;

            const seed = { room, surface, i: Math.floor((GRID_SIZE - 1) / 2), j: Math.floor((GRID_SIZE - 1) / 2) };
            const seedKey = cellKey(seed.room, seed.surface, seed.i, seed.j);
            if (claimed.has(seedKey)) continue;

            const filled = this._flood(mazeData, seed, claimed, rng);
            if (filled.length < MIN_CELLS) continue;

            const hue = rng(); // full hue range per splotch - a mixed mineral palette
            const saturation = 0.1 + rng() * 0.15; // pale, crystalline
            for (const cell of filled) {
                const lightness = 0.7 + 0.15 * (((cell.i + cell.j) % 2 === 0) ? 1 : -1);
                const position = cellWorldPos(cell);
                position[cell.surface.axis] -= cell.surface.dir * CUBE_SIZE / 2;
                pushCube(matrices, colors, dummy, tmpColor, position, hue, saturation, lightness);
            }
            return true;
        }
        return false;
    }

    _flood(mazeData, seed, claimed, rng) {
        const targetCells = 20 + randomInt(rng, 40);
        const maxVisited = targetCells * 6;

        const seedKey = cellKey(seed.room, seed.surface, seed.i, seed.j);
        const visited = new Set([seedKey]);
        const filled = [];
        let frontier = [seed];

        while (frontier.length > 0 && visited.size < maxVisited && filled.length < targetCells) {
            const idx = randomInt(rng, frontier.length);
            const cell = frontier[idx];
            frontier[idx] = frontier[frontier.length - 1];
            frontier.pop();

            if (rng() < FILL_CHANCE) filled.push(cell);

            for (const next of neighborsOf(mazeData, cell)) {
                const key = cellKey(next.room, next.surface, next.i, next.j);
                if (visited.has(key) || claimed.has(key)) continue;
                if (rng() >= PROPAGATE_CHANCE) continue;
                visited.add(key);
                frontier.push(next);
            }
        }

        for (const cell of filled) claimed.add(cellKey(cell.room, cell.surface, cell.i, cell.j));
        return filled;
    }
}
