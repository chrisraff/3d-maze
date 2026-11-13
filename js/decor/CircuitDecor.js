/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Scenery: a branching circuit-board trace etched onto a wall/ceiling/floor
 * panel: a thin line
 * (not a blob, unlike Splotches) that walks across the panel's own 9x9 grid
 * (same grid the wall model's holes are centered on), occasionally forking
 * into two, and terminating in a brighter "pad" wherever it forks, ends,
 * started, or bends (see isBend in _growCircuit's walk loop) - every trace
 * segment gets its own independently jittered color (see the file's color
 * comment further down), and a bend is also exactly where the incoming and
 * outgoing trace boxes are forced to overlap in a small square (two
 * fixed-width rectangles meeting at a right angle necessarily share a
 * corner), so a pad sits there to cleanly cover that overlap with one
 * unambiguous, slightly-proud color rather than leaving two different
 * random colors to z-fight over the same coplanar patch. A trace can carry
 * on through a doorway into whichever neighboring room continues the same
 * surface, or wrap into the room's inside corner onto a perpendicular panel
 * of the same room - walked one 9x9 grid cell at a time, like Splotches'
 * flood fill.
 * A turn edge renders as two half-segments meeting at the panels' shared
 * physical corner (see the isTurn branch in _growCircuit), since - unlike
 * every other edge - its two cells don't lie on the same flat plane.
 */
import * as THREE from 'three';
import { majorWidth, minorWidth, getOffset } from '../maze/maze.js';
import { AXES, roomInBounds, panelSolid, randomInt } from '../maze/mazeQuery.js';
import { ROLE, SceneryClaims, panelKey } from './sceneryClaims.js';
import { candidateSites } from './branchSites.js';
import { budgetFor } from './sceneryBudget.js';
import { panelPaletteHSL, shadeLightness, setPaletteColor } from './panelPalette.js';
import { clearInstanced } from '../render/instancedCleanup.js';

const GRID_SIZE = 9; // matches the wall model's 9x9 hole layout
const CELL_SIZE = majorWidth / GRID_SIZE;

const TRACE_WIDTH = CELL_SIZE * 0.22;
const TRACE_DEPTH = minorWidth * 0.3;
const PAD_SIZE = CELL_SIZE * 0.5;
const PAD_DEPTH = minorWidth * 0.55;

// chance a walker keeps heading the same direction rather than turning onto
// one of its two perpendicular options - biased high so traces read as
// mostly-straight runs with occasional right-angle bends, not zigzag noise
const STRAIGHT_BIAS = 0.7;
// chance, at each step, that the current cell also spins off a second
// walker (marking the cell a junction pad) in addition to the main walker
// continuing normally
const FORK_CHANCE = 0.1;
const MAX_WALKERS = 5;
const MAX_STEPS = 45;

function inPlaneAxes(surfaceAxis) {
    return AXES.filter(a => a !== surfaceAxis);
}

// the wall model's own cut-out holes sit centered on cells (2,2) (2,5) (2,8)
// (5,2) (5,5) (5,8) (8,2) (8,5) (8,8), 1-indexed - i.e. wherever both
// indices land on one of these three thirds-of-the-panel centers, 0-indexed
// here (see LatticeStudsDecor's file comment for the derivation). A cell
// here is never allowed to be one of these - it's an actual gap in the wall
// mesh, not solid material a trace can sit in
const HOLE_INDICES = [1, 4, 7];
function isHoleCell(i, j) {
    return HOLE_INDICES.includes(i) && HOLE_INDICES.includes(j);
}

function cellKey(room, surface, i, j) {
    return `${surface.axis}${surface.dir}:${room.x},${room.y},${room.z}:${i},${j}`;
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

// every valid way to step along `axis`/`sign` from `cell`: a same-panel
// step, a same-surface crossing into the next room (Splotches' "continue"),
// or a wrap onto a perpendicular panel of the same room (Splotches' "turn")
// - either, both, or neither may be available. Each candidate carries its
// own `dir`: what "continuing straight" means from there - unchanged for a
// same-panel step or a continue, but rotated for a turn (the old surface's
// own normal axis becomes the new travel axis, heading away from the
// corner - see the file comment)
function stepCandidates(mazeData, cell, axis, sign) {
    const { room, surface, i, j } = cell;
    const [axisA] = inPlaneAxes(surface.axis);
    const onA = axis === axisA;
    const idx = onA ? i : j;
    const next = idx + sign;

    if (next >= 0 && next <= GRID_SIZE - 1) {
        if (isHoleCell(onA ? next : i, onA ? j : next)) return [];
        const nextCell = onA ? { room, surface, i: next, j } : { room, surface, i, j: next };
        return [{ cell: nextCell, dir: [axis, sign] }];
    }

    const keepIdx = onA ? j : i;
    const out = [];

    // continue: same surface, into the neighboring room across this edge -
    // only through an open connector (a doorway), since a trace is etched
    // onto the surface and never passes through a wall
    const continueRoom = { ...room, [axis]: room[axis] + 2 * sign };
    if (roomInBounds(mazeData, continueRoom) && panelSolid(mazeData, continueRoom, surface.axis, surface.dir) && !panelSolid(mazeData, room, axis, sign)) {
        const wrapped = sign > 0 ? 0 : GRID_SIZE - 1;
        const nextCell = onA
            ? { room: continueRoom, surface, i: wrapped, j: keepIdx }
            : { room: continueRoom, surface, i: keepIdx, j: wrapped };
        out.push({ cell: nextCell, dir: [axis, sign] });
    }

    // turn: wrap onto a perpendicular panel of the same room - identical
    // index math to Splotches' own turn case
    const turnSurface = { axis, dir: sign };
    if (panelSolid(mazeData, room, axis, sign)) {
        const edgeIdx = surface.dir > 0 ? GRID_SIZE - 1 : 0;
        const newAxes = inPlaneAxes(axis);
        let newI, newJ;
        newAxes.forEach((a, idx2) => {
            const value = a === surface.axis ? edgeIdx : keepIdx;
            if (idx2 === 0) newI = value; else newJ = value;
        });
        if (!isHoleCell(newI, newJ)) {
            const nextCell = { room, surface: turnSurface, i: newI, j: newJ };
            out.push({ cell: nextCell, dir: [surface.axis, -surface.dir] });
        }
    }

    return out;
}

// one trace box spanning from -> to, both assumed to lie on `surface`'s own
// flat plane - shared by straight edges and by each half of a turn edge
// (see the file comment)
function pushTraceSegment(matrices, colors, dummy, from, to, surface, travelAxis, lateralAxis, color) {
    const mid = from.clone().lerp(to, 0.5);
    mid[surface.axis] -= surface.dir * TRACE_DEPTH / 2;
    // the true endpoint distance, not CELL_SIZE - a "continue" edge into
    // the next room spans CELL_SIZE *plus* minorWidth (the real gap between
    // two rooms' own wall panels, where the solid corner pillar sits). The
    // box is centered at the midpoint and reaches exactly to `from` and
    // `to`, with deliberately no padding: any overlap between consecutive
    // traces would be two independently-random colors z-fighting over the
    // same coplanar patch. A pad is placed over every bend/turn cell (see
    // the "isBend" check in _growCircuit's walk loop) to cover the
    // unavoidable corner overlap with one unambiguous, slightly-proud color
    const travelLength = from.distanceTo(to);

    dummy.position.copy(mid);
    dummy.scale.set(TRACE_WIDTH, TRACE_WIDTH, TRACE_WIDTH);
    dummy.scale[travelAxis] = travelLength;
    dummy.scale[lateralAxis] = TRACE_WIDTH;
    dummy.scale[surface.axis] = TRACE_DEPTH;
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    colors.push(color.r, color.g, color.b);
}

function pushPad(matrices, colors, dummy, tmpColor, position, size, depth, normalAxis, hue, saturation, lightness) {
    dummy.position.copy(position);
    dummy.scale.set(size, size, size);
    dummy.scale[normalAxis] = depth;
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    setPaletteColor(tmpColor, hue, saturation, lightness);
    colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
}

export default class CircuitDecor {
    // pads are the deepest part of a trace and still lie close to the face,
    // so a circuit shares a panel with anything standing clear of them
    static PROFILE = { band: [0, PAD_DEPTH], role: ROLE.ACCENT };

    // pieces per room relative to the other kinds (sceneryBudget.js)
    static WEIGHT = 1;

    // the seed panel may be steered to the end of a branch (branchSites.js);
    // the trace then walks outward from there
    static BRANCH_SITES = true;

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

    build(mazeData, rng = Math.random, claims = new SceneryClaims(), sites = null) {
        clearInstanced(this.group, [this.boxGeometry]);
        this.mesh = null;

        const count = budgetFor(mazeData, CircuitDecor, rng);
        const claimed = new Set();

        const dummy = new THREE.Object3D();
        dummy.rotation.set(0, 0, 0);
        const matrices = [];
        const colors = [];
        const tmpColor = new THREE.Color();

        let circuitCount = 0;
        for (let i = 0; i < count; i++) {
            if (this._growCircuit(mazeData, claimed, claims, rng, dummy, tmpColor, matrices, colors, sites))
                circuitCount++;
        }

        if (matrices.length === 0)
            return 0;

        this.boxGeometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(colors), 3));
        this.mesh = new THREE.InstancedMesh(this.boxGeometry, this.material, matrices.length);
        matrices.forEach((m, i) => this.mesh.setMatrixAt(i, m));
        this.mesh.instanceMatrix.needsUpdate = true;
        this.group.add(this.mesh);

        return circuitCount;
    }

    _growCircuit(mazeData, claimed, claims, rng, dummy, tmpColor, matrices, colors, sites = null) {
        for (const { room, surface, commit } of candidateSites(mazeData, rng, CircuitDecor, sites, 10)) {
            if (!claims.canClaim(room, surface, CircuitDecor.PROFILE)) continue;

            const [axisA, axisB] = inPlaneAxes(surface.axis);
            // one cell off dead-center, not dead-center itself - the
            // panel's exact center cell is always one of the wall model's
            // own cut-out holes (see isHoleCell)
            const seed = { room, surface, i: Math.floor((GRID_SIZE - 1) / 2), j: Math.floor((GRID_SIZE - 1) / 2) - 1 };
            const seedKey = cellKey(seed.room, seed.surface, seed.i, seed.j);
            if (claimed.has(seedKey)) continue;

            const seedDirections = [[axisA, 1], [axisA, -1], [axisB, 1], [axisB, -1]];

            const visited = new Set([seedKey]);
            const edges = []; // { from: cell, to: cell, axis }
            const nodes = [seed]; // seed, forks, and dead-ends

            let walkers = [{ cell: seed, dir: seedDirections[randomInt(rng, 4)] }];
            let steps = 0;
            while (walkers.length > 0 && steps < MAX_STEPS) {
                const wi = randomInt(rng, walkers.length);
                const walker = walkers[wi];
                steps++;

                // recomputed every step, not just at the seed - a turn
                // changes which axes are even in-plane on the walker's
                // current panel
                const [wAxisA, wAxisB] = inPlaneAxes(walker.cell.surface.axis);
                const directions = [[wAxisA, 1], [wAxisA, -1], [wAxisB, 1], [wAxisB, -1]];

                const candidates = [];
                for (const dir of directions) {
                    if (dir[0] === walker.dir[0] && dir[1] === -walker.dir[1]) continue; // no backtracking
                    for (const { cell: next, dir: nextDir } of stepCandidates(mazeData, walker.cell, dir[0], dir[1])) {
                        const key = cellKey(next.room, next.surface, next.i, next.j);
                        if (visited.has(key) || claimed.has(key)) continue;
                        if (!claims.canClaim(next.room, next.surface, CircuitDecor.PROFILE)) continue;
                        candidates.push({ dir, nextDir, next, key });
                    }
                }

                if (candidates.length === 0) {
                    nodes.push(walker.cell); // boxed in - ends here
                    walkers.splice(wi, 1);
                    continue;
                }

                const straightCandidates = candidates.filter(c => c.dir[0] === walker.dir[0] && c.dir[1] === walker.dir[1]);
                let chosen;
                if (straightCandidates.length > 0 && rng() < STRAIGHT_BIAS) chosen = straightCandidates[randomInt(rng, straightCandidates.length)];
                else chosen = candidates[randomInt(rng, candidates.length)];

                if (walkers.length < MAX_WALKERS && candidates.length > 1 && rng() < FORK_CHANCE) {
                    const forkCandidate = candidates.find(c => c !== chosen) || chosen;
                    if (forkCandidate !== chosen) {
                        nodes.push(walker.cell);
                        visited.add(forkCandidate.key);
                        edges.push({ from: walker.cell, to: forkCandidate.next, axis: forkCandidate.dir[0] });
                        walkers.push({ cell: forkCandidate.next, dir: forkCandidate.nextDir });
                    }
                }

                // a direction change (either a same-panel bend or a wrap
                // onto a perpendicular panel) makes the incoming and
                // outgoing trace boxes overlap in a real, unavoidable
                // TRACE_WIDTH-ish square at this cell (two rectangles of
                // fixed width meeting at a right angle necessarily share a
                // corner square) - mark it so a pad covers that seam
                // instead of leaving two differently-colored traces to
                // z-fight over it (see pushTraceSegment's own comment)
                const isBend = chosen.dir[0] !== walker.dir[0] || chosen.dir[1] !== walker.dir[1];
                if (isBend) nodes.push(walker.cell);

                visited.add(chosen.key);
                edges.push({ from: walker.cell, to: chosen.next, axis: chosen.dir[0] });
                walker.cell = chosen.next;
                walker.dir = chosen.nextDir;
            }
            for (const walker of walkers) nodes.push(walker.cell); // ran out of step budget mid-trace

            if (edges.length < 3) continue; // too short to read as a circuit

            // circuits are the busiest-reading scenery (a branching line
            // plus bright pads), so they stay the closest of all the
            // wall-colored scenery to the panel's own color - barely
            // distinguishable as its own object, never reading as a UI
            // element or something to interact with
            const panelIndex = { ...room, [surface.axis]: room[surface.axis] + surface.dir };
            const panelHSL = { h: 0, s: 0, l: 0 };
            panelPaletteHSL(mazeData, panelIndex, panelHSL);
            const hue = ((panelHSL.h + (rng() * 2 - 1) * 0.02) % 1 + 1) % 1;
            // traces sit a touch darker than the wall (an etched groove);
            // pads sit a touch brighter (both anchored to the wall's own
            // color) so a junction reads as slightly "live" without looking
            // like a UI glow. These are displayed offsets, held constant
            // across the maze's gradient by shadeLightness (panelPalette.js) -
            // the -0.13 they replace was an offset on the panel's *linear*
            // value, which came to about this much mid-maze and ran off the
            // bottom into pure black wherever the maze is dark
            const traceSaturation = panelHSL.s + 0.05;
            const padSaturation = panelHSL.s + 0.2;
            for (const edge of edges) {
                setPaletteColor(tmpColor, hue,
                    traceSaturation + rng() * 0.08,
                    shadeLightness(panelHSL.l, -0.11 + rng() * 0.05));

                const isTurn = edge.from.surface.axis !== edge.to.surface.axis || edge.from.surface.dir !== edge.to.surface.dir;
                if (!isTurn) {
                    const [axisA2, axisB2] = inPlaneAxes(edge.from.surface.axis);
                    const lateralAxis = edge.axis === axisA2 ? axisB2 : axisA2;
                    pushTraceSegment(matrices, colors, dummy,
                        cellWorldPos(edge.from), cellWorldPos(edge.to), edge.from.surface, edge.axis, lateralAxis, tmpColor);
                    continue;
                }

                // turn edge: edge.from and edge.to sit on two different flat
                // panels meeting at a shared physical corner - render as two
                // half-segments meeting there, rather than one box that
                // would otherwise span two different planes (see the file
                // comment)
                const corner = cellWorldPos(edge.from).clone();
                corner[edge.axis] = getOffset(edge.from.room[edge.axis]) + edge.to.surface.dir * majorWidth / 2;

                const [fromAxisA, fromAxisB] = inPlaneAxes(edge.from.surface.axis);
                const lateralAxis1 = edge.axis === fromAxisA ? fromAxisB : fromAxisA;
                pushTraceSegment(matrices, colors, dummy,
                    cellWorldPos(edge.from), corner, edge.from.surface, edge.axis, lateralAxis1, tmpColor);

                const [toAxisA, toAxisB] = inPlaneAxes(edge.to.surface.axis);
                const lateralAxis2 = edge.from.surface.axis === toAxisA ? toAxisB : toAxisA;
                pushTraceSegment(matrices, colors, dummy,
                    corner, cellWorldPos(edge.to), edge.to.surface, edge.from.surface.axis, lateralAxis2, tmpColor);
            }

            for (const key of visited) claimed.add(key);
            // claimed on commit, once the trace is known to be worth keeping -
            // panel-level against other decor, while `claimed` keeps circuits
            // apart at the finer cell level they can actually share a panel at
            const touched = new Map();
            const touch = c => touched.set(panelKey(c.room, c.surface), c);
            for (const edge of edges) { touch(edge.from); touch(edge.to); }
            for (const node of nodes) touch(node);
            for (const cell of touched.values()) claims.claim(cell.room, cell.surface, CircuitDecor.PROFILE);
            commit();

            for (const node of nodes) {
                const pos = cellWorldPos(node);
                pos[node.surface.axis] -= node.surface.dir * PAD_DEPTH / 2;
                pushPad(matrices, colors, dummy, tmpColor, pos, PAD_SIZE, PAD_DEPTH, node.surface.axis, hue,
                    padSaturation, shadeLightness(panelHSL.l, 0.09));
            }

            return true;
        }
        return false;
    }
}
