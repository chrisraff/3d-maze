/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Scenery: flat color variation instead of height variation - a
 * wall/ceiling/floor panel fully tiled (unlike Splotches' patchy growth) with thin, flush tiles in a 9x9
 * grid (the wall model's own hole grid - the 9 cells the holes sit in are
 * skipped so a tile never floats over open space). Every tile's hue drifts
 * smoothly across the panel, driven by the same kind of randomized
 * interference pattern Skyline uses for height - here mapped to hue instead
 * - so the whole panel reads as one continuously-shifting mosaic rather than
 * per-tile noise; a light per-tile lightness checker (plus a touch of
 * jitter) gives the individual tiles definition against their neighbors.
 *
 * The whole palette is anchored to the panel's own rendered color (see
 * panelRenderedColor) rather than a free-floating random hue - close to the
 * wall, but a little different, same as Skyline.
 */
import * as THREE from 'three';
import { majorWidth, minorWidth, getOffset } from '../maze/maze.js';
import { ALL_SURFACES, panelSolid, randomRoom, randomInt } from '../maze/mazeQuery.js';
import { ROLE, SceneryClaims } from './sceneryClaims.js';

const GRID_SIZE = 9; // matches the wall model's 9x9 hole layout
const CELL_SIZE = majorWidth / GRID_SIZE;
const TILE_GAP = CELL_SIZE * 0.1; // grout line
const TILE_DEPTH = minorWidth * 0.4;
const HOLE_INDICES = [1, 4, 7]; // 0-indexed cells the wall model's holes sit in (1-indexed 2,5,8)

function isHoleCell(i, j) {
    return HOLE_INDICES.includes(i) && HOLE_INDICES.includes(j);
}

// same shape as SkylineDecor's makePatternFn (two rotated sine waves plus a
// radial ripple, randomized per panel) but the caller maps the [0, 1] result
// onto a hue offset rather than a height ceiling
function makePatternFn(rng) {
    const angle = rng() * Math.PI;
    const freqA = 1 + rng() * 2.5;
    const freqB = 1 + rng() * 2.5;
    const phaseA = rng() * Math.PI * 2;
    const phaseB = rng() * Math.PI * 2;
    const freqR = 0.5 + rng() * 2;
    const phaseR = rng() * Math.PI * 2;

    return (u, v) => {
        const ru = u * Math.cos(angle) - v * Math.sin(angle);
        const rv = u * Math.sin(angle) + v * Math.cos(angle);
        const wave = Math.sin(ru * freqA * Math.PI * 2 + phaseA) + Math.sin(rv * freqB * Math.PI * 2 + phaseB);
        const radial = Math.sin(Math.hypot(u, v) * freqR * Math.PI * 2 + phaseR);
        const raw = wave * 0.6 + radial * 0.4;
        return (raw / 2) * 0.5 + 0.5; // -> [0, 1]
    };
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

function pushTile(matrices, colors, dummy, tmpColor, position, surfaceAxis, hue, saturation, lightness) {
    dummy.position.copy(position);
    dummy.scale.set(CELL_SIZE - TILE_GAP, CELL_SIZE - TILE_GAP, CELL_SIZE - TILE_GAP);
    dummy.scale[surfaceAxis] = TILE_DEPTH;
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    tmpColor.setHSL(((hue % 1) + 1) % 1, saturation, lightness);
    colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
}

export default class MosaicDecor {
    // tiles are thin but stand off the face, so anything else lying flat on
    // the panel collides with them while anything standing clear passes over
    static PROFILE = { band: [0, TILE_DEPTH], role: ROLE.FEATURE };

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

        const count = Math.max(1, mazeData.bounds[0] - 1);

        const dummy = new THREE.Object3D();
        dummy.rotation.set(0, 0, 0);
        const matrices = [];
        const colors = [];
        const tmpColor = new THREE.Color();

        let panelCount = 0;
        for (let i = 0; i < count; i++) {
            const site = this._pickSite(mazeData, rng, claims);
            if (!site) continue;
            this._buildPanel(mazeData, site, dummy, tmpColor, matrices, colors, rng);
            panelCount++;
        }

        if (matrices.length === 0)
            return 0;

        this.boxGeometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(colors), 3));
        this.mesh = new THREE.InstancedMesh(this.boxGeometry, this.material, matrices.length);
        matrices.forEach((m, i) => this.mesh.setMatrixAt(i, m));
        this.mesh.instanceMatrix.needsUpdate = true;
        this.group.add(this.mesh);

        return panelCount;
    }

    _pickSite(mazeData, rng, claims, maxAttempts = 30) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const room = randomRoom(mazeData, rng);
            const surface = ALL_SURFACES[randomInt(rng, ALL_SURFACES.length)];
            if (!panelSolid(mazeData, room, surface.axis, surface.dir)) continue;
            if (claims.claim(room, surface, MosaicDecor.PROFILE)) return { room, surface };
        }
        return null;
    }

    _buildPanel(mazeData, { room, surface }, dummy, tmpColor, matrices, colors, rng) {
        const [axisA, axisB] = ['x', 'y', 'z'].filter(a => a !== surface.axis);
        const center = new THREE.Vector3(getOffset(room.x), getOffset(room.y), getOffset(room.z));
        const panelOffset = getOffset(room[surface.axis]) + surface.dir * majorWidth / 2;

        // close to the wall's own color, but a little different - unlike
        // Circuit, this is allowed to read as its own decorative surface
        const panelIndex = { ...room, [surface.axis]: room[surface.axis] + surface.dir };
        const panelHSL = { h: 0, s: 0, l: 0 };
        panelRenderedColor(mazeData, panelIndex).getHSL(panelHSL);
        const baseHue = ((panelHSL.h + (rng() * 2 - 1) * 0.06) % 1 + 1) % 1;
        const hueRange = 0.05 + rng() * 0.05; // how far the mosaic drifts from baseHue
        const pattern = makePatternFn(rng);
        const saturation = Math.min(1, panelHSL.s + 0.05 + rng() * 0.1);
        const baseLightness = panelHSL.l;

        const position = new THREE.Vector3();
        for (let i = 0; i < GRID_SIZE; i++) {
            const u = (i - (GRID_SIZE - 1) / 2) / GRID_SIZE;
            for (let j = 0; j < GRID_SIZE; j++) {
                if (isHoleCell(i, j)) continue;
                const v = (j - (GRID_SIZE - 1) / 2) / GRID_SIZE;

                const hue = baseHue + (pattern(u, v) - 0.5) * hueRange;
                const checker = (i + j) % 2 === 0 ? 1 : -1;
                // scaled by whichever headroom (to black or to white) is
                // actually available, rather than added then hard-clamped -
                // near either end of the maze's color gradient (a very dark
                // or very light panel), a flat +/-0.14 swing would otherwise
                // regularly overshoot past 0 or 1 and clip flat, reading as
                // jarring pure-black/pure-white tiles instead of "a little
                // different" from their neighbor
                const delta = 0.1 * checker + (rng() * 2 - 1) * 0.04;
                const lightness = baseLightness + delta * (delta >= 0 ? (1 - baseLightness) : baseLightness);

                position.copy(center);
                position[axisA] = center[axisA] + (i - (GRID_SIZE - 1) / 2) * CELL_SIZE;
                position[axisB] = center[axisB] + (j - (GRID_SIZE - 1) / 2) * CELL_SIZE;
                position[surface.axis] = panelOffset - surface.dir * TILE_DEPTH / 2;

                pushTile(matrices, colors, dummy, tmpColor, position, surface.axis, hue, saturation, lightness);
            }
        }
    }
}
