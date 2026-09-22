/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Scenery: runs of exposed, square-section "conduit" standing just off a
 * wall/ceiling/floor panel's surface, on the room side. Every segment is
 * axis-aligned. A run may bend a single right angle at an arbitrary point
 * within any one room (see BEND_CHANCE), carry on along the same surface
 * through an open doorway into the next room, or wrap into the room's
 * inside corner onto the perpendicular panel ahead, and always finishes by
 * plunging into whichever solid panel it's against when it ends, stopping
 * exactly at that panel's own mid-plane (the middle of its
 * minorWidth-thick slab - see wallMid in LatticeStudsDecor) so it always
 * ends buried in solid material and never pokes out the far side. Before a
 * wrap or a plunge the run stops STANDOFF short of the panel ahead, so the
 * corner lands exactly on that panel's own standoff plane. Each run is a
 * small bundle of 1-3 parallel pipes (see clusterSize in _renderRun),
 * spaced one pipe-width apart, following the identical path. A run that
 * would overlap an earlier run, or loop back across itself, is discarded -
 * runs on the same surface share one standoff plane, so any crossing would
 * put coplanar faces on top of each other.
 *
 * Color is read straight off whichever room's panel a given segment is
 * currently running against (the same raw grid-position formula
 * MazeWorld.js colors panels with - mirrored here, not imported, matching
 * the other scenery that needs it), darkened and desaturated a bit so a
 * pipe reads as a distinct object mounted on the wall rather than
 * camouflaged flush with it.
 *
 * Parallel pipes and right-angle bends: offsetting a whole bundle sideways
 * by a fixed world-space vector doesn't survive a 90-degree bend - the
 * "sideways" axis has to rotate with the turn, exactly like a real bank of
 * parallel conduit elbows. Each pipe in the bundle gets its own exact miter
 * at every joint instead: the shared corner point is nudged by that pipe's
 * own offset along whichever axis was lateral just before the joint, and
 * again along whichever axis is lateral just after it (the same axis both
 * times at a wrap, since lateralAxis carries straight through unchanged, or
 * two different axes at a same-panel bend, where lateralAxis swaps with
 * travelAxis). At a bend the offset's sign can flip, too: the pipe on the
 * inside of the turn has to bend earlier than the one on the outside, or
 * the bundle crosses itself. Each joint is squared off by running the
 * incoming segment one radius past the corner and starting the outgoing one
 * right where that ends, so the two abut face to face without overlapping.
 * A joint block is only occasionally dropped on top (JOINT_BLOCK_CHANCE) as
 * a chunkier elbow-fitting flourish, not because the geometry needs one.
 */
import * as THREE from 'three';
import { majorWidth, minorWidth, getOffset } from './maze.js';
import { AXES, ALL_SURFACES, roomInBounds, panelSolid, randomRoom, randomInt } from './mazeQuery.js';

// see SkylineDecor's file comment for the derivation of this same constant
const CAMERA_COLLISION_DISTANCE = 0.25;
const EXTRA_MARGIN = 0.05;

const PIPE_RADIUS = 0.028;
const PIPE_DIAMETER = PIPE_RADIUS * 2;
// "spaced one pipe width apart": the GAP between adjacent pipes' own
// surfaces equals one diameter, so center-to-center spacing is two diameters
const PIPE_SPACING = PIPE_DIAMETER * 2;
// how far the pipe's centerline stands off the panel's face - derived (not
// just picked to look safe) so the pipe's own outer edge, STANDOFF +
// PIPE_RADIUS, always stays short of CAMERA_COLLISION_DISTANCE, with the
// same extra pull-back Skyline uses for the wall's own thickness
const STANDOFF = CAMERA_COLLISION_DISTANCE - EXTRA_MARGIN - PIPE_RADIUS - minorWidth * 0.75;

const BEND_CHANCE = 0.55; // at most one bend per room
const BEND_MARGIN = 0.2; // bend point stays within [BEND_MARGIN, 1-BEND_MARGIN] of the available span
const TERMINATE_CHANCE = 0.22; // chance a run ends early even when it could keep going
const MAX_SEGMENTS = 9;
// keeps a run's start point - and every bend point, which becomes the new
// lateral coordinate - this far off the panel's own edge, comfortably more
// than a full bundle's half-width, so no pipe ever grazes a side wall
const START_MARGIN = majorWidth * 0.15;

// every interior joint is already an exact zero-gap miter (see _renderRun) -
// this only decides whether to drop a chunky elbow-fitting block on top for
// visual variety - rare enough that it doesn't happen on every turn
const JOINT_BLOCK_CHANCE = 0.15;
const JOINT_BLOCK_RADIUS = PIPE_RADIUS * 2.4;

function inPlaneAxes(axis) {
    return AXES.filter(a => a !== axis);
}

// mirrors MazeWorld.js's own wall-coloring formula (see BreadcrumbBaseDecor's
// panelRenderedColor for the same derivation) - not imported, to keep this
// module free of MazeWorld's THREE/scene setup
function panelRenderedColor(mazeData, panelIndex) {
    return new THREE.Color(
        0.05 + 0.9 * (panelIndex.x - 1) / mazeData.segments[0],
        0.05 + 0.9 * (panelIndex.y - 1) / mazeData.segments[1],
        0.05 + 0.9 * (panelIndex.z - 1) / mazeData.segments[2],
    );
}

// "roughly the same color as the cell" - the panel's own rendered color,
// darkened/desaturated so the pipe still reads as a distinct object, with a
// small hue jitter that's the same for every segment of one run so the
// whole bundle reads as one consistent material even as it passes through
// differently-colored rooms
function pipeColorFor(mazeData, room, surface, hueJitter) {
    const panelIndex = { ...room, [surface.axis]: room[surface.axis] + surface.dir };
    const hsl = { h: 0, s: 0, l: 0 };
    panelRenderedColor(mazeData, panelIndex).getHSL(hsl);
    const color = new THREE.Color();
    color.setHSL(((hsl.h + hueJitter) % 1 + 1) % 1, hsl.s * 0.55, Math.max(0.12, hsl.l * 0.6));
    return color;
}

function pushSegment(matrices, colors, dummy, start, end, color) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 1e-6) return;
    direction.divideScalar(length);
    dummy.position.copy(start).lerp(end, 0.5);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    dummy.scale.set(PIPE_DIAMETER, length, PIPE_DIAMETER);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    colors.push(color.r, color.g, color.b);
}

// an axis-aligned block spanning the box `box`, grown by `halfWidth` on
// every side - so a single point gives a cube of +/-halfWidth around it
function pushJoint(blockMatrices, blockColors, dummy, box, halfWidth, color) {
    const size = new THREE.Vector3();
    box.getCenter(dummy.position);
    box.getSize(size).addScalar(halfWidth * 2);
    dummy.quaternion.identity();
    dummy.scale.copy(size);
    dummy.updateMatrix();
    blockMatrices.push(dummy.matrix.clone());
    blockColors.push(color.r, color.g, color.b);
}

export default class PipesDecor {
    constructor() {
        this.group = new THREE.Group();

        this.pipeGeometry = new THREE.InstancedBufferGeometry();
        THREE.BufferGeometry.prototype.copy.call(this.pipeGeometry, new THREE.BoxGeometry());
        this.pipeMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.pipeMesh = null;

        this.jointGeometry = new THREE.InstancedBufferGeometry();
        THREE.BufferGeometry.prototype.copy.call(this.jointGeometry, new THREE.BoxGeometry());
        this.jointMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.jointMesh = null;
    }

    addTo(scene) {
        scene.add(this.group);
    }

    build(mazeData, rng = Math.random) {
        this.group.remove(...this.group.children);
        this.pipeMesh = null;
        this.jointMesh = null;

        const count = Math.max(1, mazeData.bounds[0] - 1);

        const dummy = new THREE.Object3D();
        const pipeMatrices = [], pipeColors = [];
        const jointMatrices = [], jointColors = [];

        // every block placed so far, to reject a run that would cross an
        // earlier one - runs on the same surface share one standoff plane,
        // so a crossing would put coplanar faces on top of each other
        const placed = [];
        const unitBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
        const OVERLAP_TOLERANCE = 1e-4; // abutting faces are allowed to touch
        const boxesOf = matrices => matrices.map(m => unitBox.clone().applyMatrix4(m).expandByScalar(-OVERLAP_TOLERANCE));

        let runCount = 0;
        for (let i = 0; i < count * 3 && runCount < count; i++) {
            const path = this._buildRun(mazeData, rng);
            if (!path) continue;
            const runPipes = [], runPipeColors = [], runJoints = [], runJointColors = [];
            this._renderRun(mazeData, path, rng, dummy, runPipes, runPipeColors, runJoints, runJointColors);

            // also reject a run that loops back across itself (pipes and
            // joint blocks checked separately - a joint block wraps its own
            // pipes by design; consecutive segments only abut, which the
            // tolerance already allows)
            const pipeBoxes = boxesOf(runPipes), jointBoxes = boxesOf(runJoints);
            const selfOverlap = list => list.some((a, j) => list.some((b, k) => k > j && a.intersectsBox(b)));
            const boxes = [...pipeBoxes, ...jointBoxes];
            if (selfOverlap(pipeBoxes) || selfOverlap(jointBoxes)
                || boxes.some(box => placed.some(other => box.intersectsBox(other)))) continue;
            placed.push(...boxes);

            pipeMatrices.push(...runPipes);
            pipeColors.push(...runPipeColors);
            jointMatrices.push(...runJoints);
            jointColors.push(...runJointColors);
            runCount++;
        }

        if (pipeMatrices.length > 0) {
            this.pipeGeometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(pipeColors), 3));
            this.pipeMesh = new THREE.InstancedMesh(this.pipeGeometry, this.pipeMaterial, pipeMatrices.length);
            pipeMatrices.forEach((m, i) => this.pipeMesh.setMatrixAt(i, m));
            this.pipeMesh.instanceMatrix.needsUpdate = true;
            this.group.add(this.pipeMesh);
        }
        if (jointMatrices.length > 0) {
            this.jointGeometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(jointColors), 3));
            this.jointMesh = new THREE.InstancedMesh(this.jointGeometry, this.jointMaterial, jointMatrices.length);
            jointMatrices.forEach((m, i) => this.jointMesh.setMatrixAt(i, m));
            this.jointMesh.instanceMatrix.needsUpdate = true;
            this.group.add(this.jointMesh);
        }

        return runCount;
    }

    // builds one nominal (unshifted) centerline as a list of straight
    // segments: { start, end, room, surface, lateralAxis } - lateralAxis is
    // the in-plane axis NOT being traveled along for that segment, i.e. the
    // axis a parallel pipe bundle offsets along (see the file comment)
    _buildRun(mazeData, rng, maxAttempts = 30) {
        let room, surface;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            room = randomRoom(mazeData, rng);
            surface = ALL_SURFACES[randomInt(rng, ALL_SURFACES.length)];
            if (panelSolid(mazeData, room, surface.axis, surface.dir)) break;
            room = null;
        }
        if (!room) return null;

        const [axisA, axisB] = inPlaneAxes(surface.axis);
        let travelAxis = rng() < 0.5 ? axisA : axisB;
        let lateralAxis = travelAxis === axisA ? axisB : axisA;
        let travelDir = rng() < 0.5 ? 1 : -1;

        const point = new THREE.Vector3(getOffset(room.x), getOffset(room.y), getOffset(room.z));
        point[travelAxis] += (rng() * 2 - 1) * (majorWidth / 2 - START_MARGIN);
        point[lateralAxis] += (rng() * 2 - 1) * (majorWidth / 2 - START_MARGIN);
        point[surface.axis] = getOffset(room[surface.axis]) + surface.dir * (majorWidth / 2 - STANDOFF);

        const path = [];
        const maxRooms = 2 + randomInt(rng, 4);
        let roomsVisited = 0;

        while (path.length < MAX_SEGMENTS) {
            roomsVisited++;

            // the bend point becomes the new lateral coordinate, so it keeps
            // the same START_MARGIN clearance from the edge a start point does
            const bendLimit = getOffset(room[travelAxis]) + travelDir * (majorWidth / 2 - START_MARGIN);
            if ((bendLimit - point[travelAxis]) * travelDir > 0 && rng() < BEND_CHANCE) {
                const t = BEND_MARGIN + rng() * (1 - 2 * BEND_MARGIN);
                const bendPoint = point.clone();
                bendPoint[travelAxis] = point[travelAxis] + (bendLimit - point[travelAxis]) * t;
                path.push({ start: point.clone(), end: bendPoint.clone(), room, surface, lateralAxis });
                point.copy(bendPoint);

                [travelAxis, lateralAxis] = [lateralAxis, travelAxis];
                travelDir = rng() < 0.5 ? 1 : -1;
            }

            const edgeCoord = getOffset(room[travelAxis]) + travelDir * majorWidth / 2;
            const edgePoint = point.clone();
            edgePoint[travelAxis] = edgeCoord;
            path.push({ start: point.clone(), end: edgePoint.clone(), room, surface, lateralAxis });
            point.copy(edgePoint);

            // a continue passes straight through the doorway into the next
            // room, so the connector ahead has to be OPEN, with the next
            // room's own panel (and the edge strip joining the two panels)
            // solid to keep running along. A turn wraps up onto the connector
            // itself, so that one needs it solid.
            const continueRoom = { ...room, [travelAxis]: room[travelAxis] + 2 * travelDir };
            const connectorSolid = panelSolid(mazeData, room, travelAxis, travelDir);
            const edgeStrip = { ...room, [travelAxis]: room[travelAxis] + travelDir };
            const canContinue = !connectorSolid && roomInBounds(mazeData, continueRoom)
                && panelSolid(mazeData, continueRoom, surface.axis, surface.dir)
                && panelSolid(mazeData, edgeStrip, surface.axis, surface.dir);
            const canTurn = connectorSolid;

            let choice = null;
            if (path.length < MAX_SEGMENTS && roomsVisited < maxRooms && rng() >= TERMINATE_CHANCE) {
                const options = [];
                if (canContinue) options.push('continue');
                if (canTurn) options.push('turn');
                if (options.length > 0) choice = options[randomInt(rng, options.length)];
            }

            if (choice === 'continue') {
                room = continueRoom;
                continue;
            }

            // turning or terminating: stop STANDOFF short of the panel ahead
            // instead of at its face, so the corner (or the plunge) lands
            // exactly on that panel's own standoff plane and every segment
            // stays axis-aligned
            path[path.length - 1].end[travelAxis] -= travelDir * STANDOFF;
            point.copy(path[path.length - 1].end);
            if (choice === null) break;

            const oldSurface = surface;
            surface = { axis: travelAxis, dir: travelDir };
            travelAxis = oldSurface.axis;
            travelDir = -oldSurface.dir;
            // lateralAxis is unchanged - see the file comment
        }

        // terminate by plunging into whichever panel the run is currently
        // against, straight along that panel's own normal, stopping exactly
        // at that panel's own mid-plane - see the file comment
        const buried = point.clone();
        buried[surface.axis] = getOffset(room[surface.axis]) + surface.dir * (majorWidth / 2 + minorWidth / 2);
        path.push({ start: point.clone(), end: buried, room, surface, lateralAxis });

        return path;
    }

    _renderRun(mazeData, path, rng, dummy, pipeMatrices, pipeColors, jointMatrices, jointColors) {
        const hueJitter = (rng() * 2 - 1) * 0.04;
        const colors = path.map(seg => pipeColorFor(mazeData, seg.room, seg.surface, hueJitter));

        const clusterSize = 1 + randomInt(rng, 3);
        // every pipe's corner at each interior joint (index i), so a fitting
        // block can wrap the whole bundle at once
        const jointBoxes = path.map(() => new THREE.Box3());

        // which way each segment runs along its own travel axis, and the sign
        // its lateral offset takes - flipped at a bend when needed so the
        // pipe on the inside of the turn bends first (see the file comment)
        const travelSign = path.map(seg => {
            const d = seg.end.clone().sub(seg.start);
            const axis = AXES.reduce((best, a) => Math.abs(d[a]) > Math.abs(d[best]) ? a : best);
            return Math.sign(d[axis]);
        });
        const offsetSign = [1];
        for (let i = 1; i < path.length; i++) {
            const bend = path[i].lateralAxis !== path[i - 1].lateralAxis;
            offsetSign.push(bend ? -offsetSign[i - 1] * travelSign[i - 1] * travelSign[i] : offsetSign[i - 1]);
        }
        for (let k = 0; k < clusterSize; k++) {
            const offset = (k - (clusterSize - 1) / 2) * PIPE_SPACING;

            // this pipe's own shifted endpoints - see the file comment for
            // the miter math at each interior joint
            const starts = path.map(seg => seg.start.clone());
            const ends = path.map(seg => seg.end.clone());
            const last = path.length - 1;
            starts[0][path[0].lateralAxis] += offset * offsetSign[0];
            ends[last][path[last].lateralAxis] += offset * offsetSign[last];
            for (let i = 1; i < path.length; i++) {
                const oldLateral = path[i - 1].lateralAxis;
                const newLateral = path[i].lateralAxis;
                const corner = path[i - 1].end.clone();
                corner[oldLateral] += offset * offsetSign[i - 1];
                if (newLateral !== oldLateral) corner[newLateral] += offset * offsetSign[i];
                ends[i - 1] = corner;
                starts[i] = corner.clone();
            }

            for (let i = 1; i < path.length; i++) jointBoxes[i].expandByPoint(starts[i]);

            // square off every interior joint: a box running centerline to
            // centerline stops at the corner's center, leaving the outer
            // quarter of the corner empty. The incoming segment runs one
            // radius past the corner so it fills the whole corner cube, and
            // the outgoing one starts right where that cube ends - the two
            // abut face to face without overlapping, so no coplanar faces
            // fight. (Straight-through joints just shift their seam by one
            // radius.)
            const dirs = path.map((_, i) => ends[i].clone().sub(starts[i]).normalize());
            for (let i = 1; i < path.length; i++) {
                ends[i - 1].addScaledVector(dirs[i - 1], PIPE_RADIUS);
                starts[i].addScaledVector(dirs[i], PIPE_RADIUS);
            }

            for (let i = 0; i < path.length; i++)
                pushSegment(pipeMatrices, pipeColors, dummy, starts[i], ends[i], colors[i]);

            // start cap
            pushJoint(jointMatrices, jointColors, dummy, new THREE.Box3(starts[0], starts[0]), PIPE_RADIUS * 1.1, colors[0]);
        }

        // every interior joint above already meets exactly - this is purely
        // an occasional stylistic flourish, not a structural need. Rolled
        // once per joint and drawn as one block around the whole bundle:
        // per-pipe blocks this size would overlap their neighbors (they're
        // wider than PIPE_SPACING) and z-fight on their shared faces
        for (let i = 1; i < path.length; i++) {
            if (rng() < JOINT_BLOCK_CHANCE)
                pushJoint(jointMatrices, jointColors, dummy, jointBoxes[i], JOINT_BLOCK_RADIUS, colors[i]);
        }
    }
}
