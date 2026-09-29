/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Scenery: a perfectly regular 3x3 grid of uniform studs covering one
 * wall/ceiling/floor panel. Purely geometric: no randomized drift, no
 * organic variance in size or depth - deliberately mechanical and
 * repetitive, to contrast against the organic scenery. Always occupies
 * exactly one cell.
 *
 * The wall model (models/wall.glb) already has its own square holes cut
 * into it: dividing the panel into a 9x9 grid, those holes sit centered on
 * cells (2,2) (2,5) (2,8) (5,2) (5,5) (5,8) (8,2) (8,5) (8,8), using
 * 1-indexed cell numbers 1..9 - i.e. exactly the center of each of the
 * panel's 3 even thirds. The stud grid below shares those same 9 centers
 * (HOLE_OFFSETS) rather than an arbitrary spacing, so it reads as
 * decorating the existing holes instead of floating independently of them.
 *
 * Color is a deliberate hue rotation away from the panel's own rendered
 * color (see panelRenderedColor), with a saturation and lightness lift, so
 * the studs read as a coordinated hardware accent rather than blending into
 * the wall. The rotation stays small - a large jump reads as glaringly
 * mismatched, closer to a highlighted UI element than a wall fixture.
 */
import * as THREE from 'three';
import { majorWidth, minorWidth, getOffset } from './maze.js';
import { ALL_SURFACES, panelSolid, randomRoom, randomInt } from './mazeQuery.js';
import { ROLE, SceneryClaims } from './sceneryClaims.js';

// deep enough to clear minorWidth (the wall's own thickness) on both sides
// with room to spare, so each stud visibly pokes through rather than
// sitting flush with (or buried inside) the panel
const STUD_DEPTH = 0.18;
// the center of each third of the panel - see the file comment above
const HOLE_OFFSETS = [-majorWidth / 3, 0, majorWidth / 3];
const STUD_SIZE = (majorWidth / 3) * 0.4;
// how far a stud reaches past each face, being centered on a slab thinner
// than it is deep
const STUD_PROTRUSION = (STUD_DEPTH - minorWidth) / 2;

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

function pushStud(matrices, colors, dummy, tmpColor, position, size, depth, normalAxis, hue, saturation, lightness) {
    dummy.position.copy(position);
    dummy.scale.set(size, size, size);
    dummy.scale[normalAxis] = depth;
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    tmpColor.setHSL(((hue % 1) + 1) % 1, saturation, lightness);
    colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
}

export default class LatticeStudsDecor {
    // studs are centered on the slab's mid-plane, so they poke out of both
    // its faces and claim the neighboring room's side of the panel too
    static PROFILE = {
        band: [-STUD_PROTRUSION, STUD_PROTRUSION], role: ROLE.FEATURE, through: true,
    };

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
            if (claims.claim(room, surface, LatticeStudsDecor.PROFILE)) return { room, surface };
        }
        return null;
    }

    _buildPanel(mazeData, { room, surface }, dummy, tmpColor, matrices, colors, rng) {
        const [axisA, axisB] = ['x', 'y', 'z'].filter(a => a !== surface.axis);
        const center = new THREE.Vector3(getOffset(room.x), getOffset(room.y), getOffset(room.z));
        // the wall panel's own mid-plane (not just its near face), so a
        // stud centered here pokes out past both the room side and the
        // far side by roughly the same amount
        const wallMid = getOffset(room[surface.axis]) + surface.dir * (majorWidth / 2 + minorWidth / 2);

        // a deliberate hue rotation off the panel's own color - see the
        // file comment - drawn from [0.0417, 0.0833] turns (15-30 degrees),
        // in a random direction each panel
        const panelIndex = { ...room, [surface.axis]: room[surface.axis] + surface.dir };
        const panelHSL = { h: 0, s: 0, l: 0 };
        panelRenderedColor(mazeData, panelIndex).getHSL(panelHSL);
        const rotation = (0.0417 + rng() * 0.0417) * (rng() < 0.5 ? -1 : 1);
        const hue = ((panelHSL.h + rotation) % 1 + 1) % 1;
        const saturation = Math.min(1, panelHSL.s + 0.1 + rng() * 0.1);
        const baseLightness = Math.min(1, panelHSL.l * 0.5 + 0.3);

        const position = new THREE.Vector3();
        for (let i = 0; i < HOLE_OFFSETS.length; i++) {
            for (let j = 0; j < HOLE_OFFSETS.length; j++) {
                position.copy(center);
                position[axisA] = center[axisA] + HOLE_OFFSETS[i];
                position[axisB] = center[axisB] + HOLE_OFFSETS[j];
                position[surface.axis] = wallMid;

                const lightness = Math.min(1, Math.max(0, baseLightness + 0.08 * ((i + j) % 2))); // subtle checker shading
                pushStud(matrices, colors, dummy, tmpColor, position, STUD_SIZE, STUD_DEPTH, surface.axis, hue, saturation, lightness);
            }
        }
    }
}
