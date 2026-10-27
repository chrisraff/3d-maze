/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Scenery: a single wall/ceiling/floor panel tiled with a fine 27x27 grid
 * of small cubes (three subdivisions per cell of LatticeStudsDecor/
 * SplotchesDecor's 9x9 grid), each poking out to a random height - a little "skyline" of towers. The
 * randomness isn't uniform across the whole panel though: a smooth
 * interference pattern (two rotated sine waves plus a radial ripple,
 * randomized per wall so every one reads differently) sets a ceiling at
 * each cell, and the actual height is sampled anywhere between 0 and that
 * ceiling - so the skyline's silhouette still traces out the same wavy
 * shape as the pattern alone would, but every individual tower is chaotic
 * rather than sitting flush on a smooth surface. Heights also taper down
 * toward the panel's edges (a soft border fade, not an abrupt cutoff) so
 * the piece reads as self-contained rather than looking clipped by the
 * wall's own boundary - and taper down again near the wall model's own
 * cut-out holes (see LatticeStudsDecor's file comment for where those sit),
 * so a tower never looks like it's sprouting out of a gap in the wall.
 *
 * The palette is anchored to the panel's own rendered color (see
 * panelRenderedColor) rather than a free-floating random hue - close to the
 * wall, but a little different, same as Mosaic.
 */
import * as THREE from 'three';
import { majorWidth, minorWidth, getOffset } from '../maze/maze.js';
import { ALL_SURFACES, panelSolid, randomRoom, randomInt } from '../maze/mazeQuery.js';
import { ROLE, SceneryClaims } from './sceneryClaims.js';

const GRID_SIZE = 27;
const CELL_SIZE = majorWidth / GRID_SIZE;
const CELL_GAP = CELL_SIZE * 0.08; // thin reveal line between tiles

// mirrors game.js's CameraCollisionDistance (not imported directly - that'd
// pull this module into game.js's module graph, which already imports this
// one). The player's own collision volume keeps their camera from ever
// getting closer than CAMERA_COLLISION_DISTANCE to a solid wall's surface -
// so a tower reaching any FURTHER than that off the wall reaches into space
// the camera itself can freely occupy, which is exactly what "clipping
// through it" looks like. Capping tower height at CAMERA_COLLISION_DISTANCE
// (minus a bit of margin) keeps every tower's tip on the far side of where
// the camera can ever be, so it can be walked right up to but never through.
const CAMERA_COLLISION_DISTANCE = 0.25;
const EXTRA_MARGIN = 0.05;
// pulled back further still, by most of the wall's own thickness, so
// towers read as clearly shy of the collision distance rather than just
// grazing it
const MAX_HEIGHT = CAMERA_COLLISION_DISTANCE - EXTRA_MARGIN - minorWidth * 0.75;
const MIN_HEIGHT = 0.01;
// the taper begins once a cell is this far toward the edge (as a fraction
// of the panel's own half-width) and eases down to ~0 right at the edge
const TAPER_START = 0.55;

// the wall model's own cut-out holes divide the panel into a 9x9 grid and
// sit centered on cells (2,2) (2,5) (2,8) (5,2) (5,5) (5,8) (8,2) (8,5)
// (8,8) (1-indexed) - same 9 centers LatticeStudsDecor's studs plug (see
// that file's comment for the derivation)
const HOLE_OFFSETS = [-majorWidth / 3, 0, majorWidth / 3];
// each hole occupies exactly one of those 9 equal cells, so its true
// half-width is half of one ninth of the panel
const HOLE_HALF_WIDTH = (majorWidth / 9) / 2;
// extra distance beyond the hole's edge the falloff eases back up over
const HOLE_TAPER_MARGIN = majorWidth / 9;

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

function pushCell(matrices, colors, dummy, tmpColor, position, surfaceAxis, height, hue, saturation, lightness) {
    dummy.position.copy(position);
    dummy.scale.set(CELL_SIZE - CELL_GAP, CELL_SIZE - CELL_GAP, CELL_SIZE - CELL_GAP);
    dummy.scale[surfaceAxis] = Math.max(height, 0.002);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    tmpColor.setHSL(((hue % 1) + 1) % 1, saturation, lightness);
    colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
}

// 1 in the middle of the panel, easing down toward 0 near the edge - u is
// a coordinate in roughly [-0.5, 0.5] across the panel
function edgeTaper(u) {
    const d = Math.abs(u) / 0.5;
    if (d <= TAPER_START) return 1;
    const t = Math.min(1, (d - TAPER_START) / (1 - TAPER_START));
    return 1 - t * t * (3 - 2 * t); // smoothstep ease-out
}

function nearestHoleDist1D(coord) {
    let best = Infinity;
    for (const h of HOLE_OFFSETS) {
        const d = Math.abs(coord - h);
        if (d < best) best = d;
    }
    return best;
}

// true if worldA/worldB (a cell's in-plane offset from the panel center, in
// world units) falls inside a hole's true square footprint - each hole is
// one full cell of the 9x9 grid, so this checks both axes independently
// against the nearest hole's half-width (the 9 holes form a Cartesian
// product of the same 3 offsets on each axis)
function isInHole(worldA, worldB) {
    return nearestHoleDist1D(worldA) <= HOLE_HALF_WIDTH && nearestHoleDist1D(worldB) <= HOLE_HALF_WIDTH;
}

// 0 right at a hole's edge, easing back up to 1 a short distance out -
// callers must skip cells where isInHole is true rather than relying on
// this reaching exactly 0 there
function holeTaper(worldA, worldB) {
    const dist = Math.max(nearestHoleDist1D(worldA), nearestHoleDist1D(worldB)) - HOLE_HALF_WIDTH;
    if (dist >= HOLE_TAPER_MARGIN) return 1;
    if (dist <= 0) return 0;
    const t = dist / HOLE_TAPER_MARGIN;
    return t * t * (3 - 2 * t); // smoothstep ease-in
}

// one randomized-per-wall interference pattern - returns a smooth value in
// [0, 1] that acts as the height ceiling a cell's random tower is sampled
// under, not the height itself
function makePatternFn(rng) {
    const angle = rng() * Math.PI;
    const freqA = 1.5 + rng() * 3.5;
    const freqB = 1.5 + rng() * 3.5;
    const phaseA = rng() * Math.PI * 2;
    const phaseB = rng() * Math.PI * 2;
    const freqR = 1 + rng() * 3;
    const phaseR = rng() * Math.PI * 2;
    const waveWeight = 0.4 + rng() * 0.6;
    const radialWeight = 0.3 + rng() * 0.7;

    return (u, v) => {
        // u, v in roughly [-0.5, 0.5] across the panel
        const ru = u * Math.cos(angle) - v * Math.sin(angle);
        const rv = u * Math.sin(angle) + v * Math.cos(angle);
        const wave = Math.sin(ru * freqA * Math.PI * 2 + phaseA) + Math.sin(rv * freqB * Math.PI * 2 + phaseB);
        const radial = Math.sin(Math.hypot(u, v) * freqR * Math.PI * 2 + phaseR);
        const raw = wave * waveWeight + radial * radialWeight;
        const normalized = raw / (2 * waveWeight + radialWeight);
        return normalized * 0.5 + 0.5; // -> [0, 1]
    };
}

export default class SkylineDecor {
    // towers stand entirely off the face, up to the cap derived above -
    // exclusive because a silhouette shared with anything else isn't one
    static PROFILE = { band: [0, MAX_HEIGHT], role: ROLE.FEATURE, exclusive: true };

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

    build(mazeData, rng = Math.random, claims = new SceneryClaims()) {
        this.group.remove(...this.group.children);
        this.mesh = null;

        const count = Math.max(1, mazeData.bounds[0] - 2);

        const dummy = new THREE.Object3D();
        dummy.rotation.set(0, 0, 0);
        const matrices = [];
        const colors = [];
        const tmpColor = new THREE.Color();

        let wallCount = 0;
        for (let i = 0; i < count; i++) {
            const site = this._pickSite(mazeData, rng, claims);
            if (!site) continue;
            this._buildWall(mazeData, site, dummy, tmpColor, matrices, colors, rng);
            wallCount++;
        }

        if (matrices.length === 0)
            return 0;

        this.boxGeometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(colors), 3));
        this.mesh = new THREE.InstancedMesh(this.boxGeometry, this.material, matrices.length);
        matrices.forEach((m, i) => this.mesh.setMatrixAt(i, m));
        this.mesh.instanceMatrix.needsUpdate = true;
        this.group.add(this.mesh);

        return wallCount;
    }

    _pickSite(mazeData, rng, claims, maxAttempts = 30) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const room = randomRoom(mazeData, rng);
            const surface = ALL_SURFACES[randomInt(rng, ALL_SURFACES.length)];
            if (!panelSolid(mazeData, room, surface.axis, surface.dir)) continue;
            if (claims.claim(room, surface, SkylineDecor.PROFILE)) return { room, surface };
        }
        return null;
    }

    _buildWall(mazeData, { room, surface }, dummy, tmpColor, matrices, colors, rng) {
        const [axisA, axisB] = ['x', 'y', 'z'].filter(a => a !== surface.axis);
        const center = new THREE.Vector3(getOffset(room.x), getOffset(room.y), getOffset(room.z));
        const panelOffset = getOffset(room[surface.axis]) + surface.dir * majorWidth / 2;

        // close to the wall's own color, but a little different - unlike
        // Circuit, this is allowed to read as its own decorative surface
        const panelIndex = { ...room, [surface.axis]: room[surface.axis] + surface.dir };
        const panelHSL = { h: 0, s: 0, l: 0 };
        panelRenderedColor(mazeData, panelIndex).getHSL(panelHSL);

        const pattern = makePatternFn(rng);
        const hue = ((panelHSL.h + (rng() * 2 - 1) * 0.06) % 1 + 1) % 1;
        const saturation = Math.min(1, panelHSL.s + 0.05 + rng() * 0.1);

        const position = new THREE.Vector3();
        for (let i = 0; i < GRID_SIZE; i++) {
            const u = (i - (GRID_SIZE - 1) / 2) / GRID_SIZE;
            const worldA = (i - (GRID_SIZE - 1) / 2) * CELL_SIZE;
            for (let j = 0; j < GRID_SIZE; j++) {
                const v = (j - (GRID_SIZE - 1) / 2) / GRID_SIZE;
                const worldB = (j - (GRID_SIZE - 1) / 2) * CELL_SIZE;
                if (isInHole(worldA, worldB)) continue;
                const taper = edgeTaper(u) * edgeTaper(v) * holeTaper(worldA, worldB);
                const ceiling = pattern(u, v) * taper;
                const height = MIN_HEIGHT + rng() * MAX_HEIGHT * ceiling;

                position.copy(center);
                position[axisA] = center[axisA] + worldA;
                position[axisB] = center[axisB] + worldB;
                position[surface.axis] = panelOffset - surface.dir * height / 2;

                // taller towers still read as brighter (a depth cue), but
                // the whole range is anchored to the panel's own lightness
                // rather than a fixed absolute floor/ceiling
                const lightness = Math.min(1, Math.max(0,
                    panelHSL.l * 0.6 + 0.4 * (height / MAX_HEIGHT)));
                pushCell(matrices, colors, dummy, tmpColor, position, surface.axis, height, hue, saturation, lightness);
            }
        }
    }
}
