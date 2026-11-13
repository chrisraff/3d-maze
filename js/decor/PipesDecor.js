/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Scenery: runs of exposed, square-section "conduit" standing just off a
 * wall/ceiling/floor panel's surface, on the room side. Every segment is
 * axis-aligned. A run may bend a single right angle at an arbitrary point
 * within any one room (see BEND_CHANCE), carry on along the same surface
 * into the next room (through a doorway, or straight through the wall
 * between them), or wrap into the room's
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
 * Only the start of a run is capped; every other joint already meets
 * exactly, and a proud fitting on top of one would reach far enough off the
 * wall for the camera's near plane to cut into it (see MAX_PROTRUSION).
 */
import * as THREE from 'three';
import { majorWidth, minorWidth, getOffset } from '../maze/maze.js';
import { AXES, roomInBounds, panelSolid, randomInt } from '../maze/mazeQuery.js';
import { ROLE, SceneryClaims } from './sceneryClaims.js';
import { candidateSites } from './branchSites.js';
import { budgetFor } from './sceneryBudget.js';
import { panelPaletteHSL, shadeLightness, setPaletteColor } from './panelPalette.js';

// see SkylineDecor's file comment for the derivation of this same constant
const CAMERA_COLLISION_DISTANCE = 0.25;
// game.js's own camera near plane - geometry closer to the camera than this
// is clipped away, which is what the player sees as looking "into" a pipe
const CAMERA_NEAR = 0.1;
const EXTRA_MARGIN = 0.05;

const PIPE_RADIUS = 0.028;
const PIPE_DIAMETER = PIPE_RADIUS * 2;
// "spaced one pipe width apart": the GAP between adjacent pipes' own
// surfaces equals one diameter, so center-to-center spacing is two diameters
const PIPE_SPACING = PIPE_DIAMETER * 2;
// The player's collision volume stops the camera closer than
// CAMERA_COLLISION_DISTANCE to a solid panel's face, so the smallest gap
// there can ever be between the camera and a pipe's outer surface is that
// distance minus the pipe's own protrusion. Keeping that gap wider than
// CAMERA_NEAR is what stops the near plane cutting into the pipe when the
// player backs against the wall and looks along it.
const MAX_PROTRUSION = CAMERA_COLLISION_DISTANCE - CAMERA_NEAR - EXTRA_MARGIN;
// how far the pipe's centerline stands off the panel's face, so that its
// outer edge - STANDOFF + PIPE_RADIUS - lands exactly on MAX_PROTRUSION
const STANDOFF = MAX_PROTRUSION - PIPE_RADIUS;

const BEND_CHANCE = 0.55; // at most one bend per room
const BEND_MARGIN = 0.2; // bend point stays within [BEND_MARGIN, 1-BEND_MARGIN] of the available span
const TERMINATE_CHANCE = 0.22; // chance a run ends early even when it could keep going
const MAX_SEGMENTS = 9;
// keeps a run's start point - and every bend point, which becomes the new
// lateral coordinate - this far off the panel's own edge, comfortably more
// than a full bundle's half-width, so no pipe ever grazes a side wall
const START_MARGIN = majorWidth * 0.15;

function inPlaneAxes(axis) {
    return AXES.filter(a => a !== axis);
}

// "roughly the same color as the cell" - the panel's own rendered color,
// darkened/desaturated so the pipe still reads as a distinct object, with a
// small hue jitter that's the same for every segment of one run so the
// whole bundle reads as one consistent material even as it passes through
// differently-colored rooms
function pipeColorFor(mazeData, room, surface, hueJitter) {
    const panelIndex = { ...room, [surface.axis]: room[surface.axis] + surface.dir };
    const hsl = { h: 0, s: 0, l: 0 };
    panelPaletteHSL(mazeData, panelIndex, hsl);
    // the same displayed amount darker than its panel the whole way along the
    // maze's gradient - the old Math.max(0.12, l * 0.6) read the panel's
    // linear value, where the dark end sits around 0.02, so nearly a fifth of
    // all panels hit that floor and came out *brighter* than their wall
    return setPaletteColor(new THREE.Color(), hsl.h + hueJitter, hsl.s * 0.55,
        shadeLightness(hsl.l, -0.14));
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
function pushCap(capMatrices, capColors, dummy, box, halfWidth, color) {
    const size = new THREE.Vector3();
    box.getCenter(dummy.position);
    box.getSize(size).addScalar(halfWidth * 2);
    dummy.quaternion.identity();
    dummy.scale.copy(size);
    dummy.updateMatrix();
    capMatrices.push(dummy.matrix.clone());
    capColors.push(color.r, color.g, color.b);
}

export default class PipesDecor {
    // the run's full reach off the panel, capped so the camera can never get
    // near-plane close to it - which also decides what it may share a panel with
    static PROFILE = {
        band: [STANDOFF - PIPE_RADIUS, STANDOFF + PIPE_RADIUS], role: ROLE.ACCENT,
    };

    // pieces per room relative to the other kinds (sceneryBudget.js)
    static WEIGHT = 1;

    // the run may be started at the end of a branch (branchSites.js) and
    // travels on from there across whatever panels it reaches
    static BRANCH_SITES = true;

    constructor() {
        this.group = new THREE.Group();

        this.pipeGeometry = new THREE.InstancedBufferGeometry();
        THREE.BufferGeometry.prototype.copy.call(this.pipeGeometry, new THREE.BoxGeometry());
        this.pipeMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.pipeMesh = null;

        this.capGeometry = new THREE.InstancedBufferGeometry();
        THREE.BufferGeometry.prototype.copy.call(this.capGeometry, new THREE.BoxGeometry());
        this.capMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.capMesh = null;
    }

    addTo(scene) {
        scene.add(this.group);
    }

    build(mazeData, rng = Math.random, claims = new SceneryClaims(), sites = null) {
        this.group.remove(...this.group.children);
        this.pipeMesh = null;
        this.capMesh = null;

        const count = budgetFor(mazeData, PipesDecor, rng);

        const dummy = new THREE.Object3D();
        const pipeMatrices = [], pipeColors = [];
        const capMatrices = [], capColors = [];

        // every block placed so far, to reject a run that would cross an
        // earlier one - runs on the same surface share one standoff plane,
        // so a crossing would put coplanar faces on top of each other
        const placed = [];
        const unitBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
        const OVERLAP_TOLERANCE = 1e-4; // abutting faces are allowed to touch
        const boxesOf = matrices => matrices.map(m => unitBox.clone().applyMatrix4(m).expandByScalar(-OVERLAP_TOLERANCE));

        let runCount = 0;
        for (let i = 0; i < count * 3 && runCount < count; i++) {
            const run = this._buildRun(mazeData, rng, claims, sites);
            if (!run) continue;
            const { path, commit } = run;
            const runPipes = [], runPipeColors = [], runCaps = [], runCapColors = [];
            this._renderRun(mazeData, path, rng, dummy, runPipes, runPipeColors, runCaps, runCapColors);

            // also reject a run that loops back across itself (pipes and
            // caps checked separately - a cap wraps its own pipe by design;
            // consecutive segments only abut, which the tolerance allows)
            const pipeBoxes = boxesOf(runPipes), capBoxes = boxesOf(runCaps);
            const selfOverlap = list => list.some((a, j) => list.some((b, k) => k > j && a.intersectsBox(b)));
            const boxes = [...pipeBoxes, ...capBoxes];
            if (selfOverlap(pipeBoxes) || selfOverlap(capBoxes)
                || boxes.some(box => placed.some(other => box.intersectsBox(other)))) continue;
            placed.push(...boxes);
            // claimed once the run survives both overlap checks, so a
            // discarded run leaves no panel blocked behind it
            for (const seg of path) claims.claim(seg.room, seg.surface, PipesDecor.PROFILE);
            commit();

            pipeMatrices.push(...runPipes);
            pipeColors.push(...runPipeColors);
            capMatrices.push(...runCaps);
            capColors.push(...runCapColors);
            runCount++;
        }

        if (pipeMatrices.length > 0) {
            this.pipeGeometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(pipeColors), 3));
            this.pipeMesh = new THREE.InstancedMesh(this.pipeGeometry, this.pipeMaterial, pipeMatrices.length);
            pipeMatrices.forEach((m, i) => this.pipeMesh.setMatrixAt(i, m));
            this.pipeMesh.instanceMatrix.needsUpdate = true;
            this.group.add(this.pipeMesh);
        }
        if (capMatrices.length > 0) {
            this.capGeometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(capColors), 3));
            this.capMesh = new THREE.InstancedMesh(this.capGeometry, this.capMaterial, capMatrices.length);
            capMatrices.forEach((m, i) => this.capMesh.setMatrixAt(i, m));
            this.capMesh.instanceMatrix.needsUpdate = true;
            this.group.add(this.capMesh);
        }

        return runCount;
    }

    // Builds one nominal (unshifted) centerline as { path, commit }: path is
    // a list of straight segments { start, end, room, surface, lateralAxis },
    // where lateralAxis is the in-plane axis NOT being traveled along, i.e.
    // the axis a parallel pipe bundle offsets along (see the file comment).
    // `commit` is the caller's to call once it keeps the run - a discarded run
    // still consumes its branch site, which is why build() asks for up to
    // three times as many runs as it needs.
    _buildRun(mazeData, rng, claims, sites = null, maxAttempts = 30) {
        let room = null, surface, commit;
        for (const candidate of candidateSites(mazeData, rng, PipesDecor, sites, maxAttempts)) {
            if (!claims.canClaim(candidate.room, candidate.surface, PipesDecor.PROFILE)) continue;
            ({ room, surface, commit } = candidate);
            break;
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

            // a continue carries straight on into the next room - through
            // the doorway if the connector ahead is open, or straight
            // through the wall if it's solid - as long as the next room's
            // own panel is there to keep running along. A turn wraps up onto
            // the connector itself, so that one needs it solid.
            const continueRoom = { ...room, [travelAxis]: room[travelAxis] + 2 * travelDir };
            const connectorSolid = panelSolid(mazeData, room, travelAxis, travelDir);
            const canContinue = roomInBounds(mazeData, continueRoom)
                && panelSolid(mazeData, continueRoom, surface.axis, surface.dir)
                && claims.canClaim(continueRoom, surface, PipesDecor.PROFILE);
            const canTurn = connectorSolid
                && claims.canClaim(room, { axis: travelAxis, dir: travelDir }, PipesDecor.PROFILE);

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

        return { path, commit };
    }

    _renderRun(mazeData, path, rng, dummy, pipeMatrices, pipeColors, capMatrices, capColors) {
        const hueJitter = (rng() * 2 - 1) * 0.04;
        const colors = path.map(seg => pipeColorFor(mazeData, seg.room, seg.surface, hueJitter));

        const clusterSize = 1 + randomInt(rng, 3);

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
            pushCap(capMatrices, capColors, dummy, new THREE.Box3(starts[0], starts[0]), PIPE_RADIUS * 1.1, colors[0]);
        }
    }
}
