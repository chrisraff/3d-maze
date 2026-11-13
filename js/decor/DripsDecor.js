/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Scenery: small dots of water that sit and grow at their source for a few
 * seconds, then fall, accelerating up to a terminal velocity rather than
 * snapping straight to full speed, down to whatever solid floor is actually
 * beneath them - which may be several rooms down, through any open floors
 * along the way - then loop back to the top. Sources are one of three kinds: a point on a solid
 * wall, a point in an open doorway (water finding its way through the
 * gap), or scattered across a whole solid ceiling panel.
 *
 * While sitting at the source, each dot's size and opacity ramp up from
 * nothing to full over its own grow duration - so a drip visibly forms
 * rather than just popping into existence - then hold at full for the
 * fall. Landing gets its own little animation too, rather than just
 * despawning the instant the head touches the floor: the head freezes
 * there and the tail decelerates (see LANDING_DECEL) to catch up with it,
 * so the streak visibly collapses into a resting droplet before it
 * respawns at its source.
 *
 * Falling dots are drawn as short streaks rather than dots: a thin quad,
 * cubic (roughly as long as it is wide) at rest and stretching longer the
 * faster it falls, capturing the same motion-blur look real rain gets.
 * The quad is a view-aligned stretched billboard: it always faces the
 * camera squarely, laid out along the drip's own fall axis projected into
 * the view plane and stretched to that projected length. Pinning the
 * length to world Y instead would be cheaper, but such a quad turns
 * edge-on - an invisible sliver - exactly when the camera looks along the
 * fall axis, which is what standing under a drip does. Projecting the axis
 * foreshortens it to nothing there instead, and the shape below collapses
 * to a round dot, so a drip reads as a volume from every angle without a
 * second crossed quad to pay for. The whole thing is done per-vertex in
 * the shader rather than on the CPU, since update(dt) has no camera
 * reference to work with. Each instance's position/width/length ride along
 * on its own InstancedMesh transform (see _writeInstanceMatrix); a custom
 * `instanceGrowth` attribute carries the same grow-in ramp described above.
 *
 * The streak's shape is computed analytically in the fragment shader
 * rather than from a stretched texture - a texture mapped 0..1 over the
 * streak's length only reads as "round" at the one aspect ratio it was
 * drawn for, and this quad's aspect ratio swings from square (at rest)
 * to long and thin (at speed). Instead each fragment measures its
 * distance to the nearest point on the streak's own centerline (a
 * "stadium"/pill SDF: a straight segment capped by a true semicircle of
 * radius width/2 at each end) - which collapses to an exact circle when
 * length equals width, and stays a properly round-bottomed pill however
 * long it stretches. A separate fade multiplies over just the extra
 * length beyond that resting circle, so the tail only fades once there's
 * actually a tail to fade.
 */
import * as THREE from 'three';
import { majorWidth, getOffset } from '../maze/maze.js';
import { WALL_SURFACES, CEILING_SURFACE, panelSolid, roomInBounds, randomRoom, randomInt } from '../maze/mazeQuery.js';
import { ROLE, SceneryClaims } from './sceneryClaims.js';
import { budgetFor } from './sceneryBudget.js';
import { clearInstanced } from '../render/instancedCleanup.js';

const DOT_SIZE = 0.035; // streak width, and its length at zero speed (cubic at rest)
const STREAK_LENGTH_PER_SPEED = 0.06; // extra length per world-unit/sec of fall speed
const TERMINAL_SPEED = 3.3; // world units per second, before per-dot variance
const FALL_ACCEL = 3.0; // world units per second^2 - how fast it ramps up to terminal speed
const LANDING_DECEL = 12.0; // world units per second^2 - how fast the tail catches up on landing
const GROW_DURATION_BASE = 3.0; // seconds sitting at the source before it starts falling
const GROW_DURATION_VARIANCE = 1.0;
// the anchor position is the streak's head (its bottom, in world terms) -
// the quad extends *upward* from there by its current length, which is at
// least DOT_SIZE even at rest - so anchoring flush against a ceiling/
// doorway-top surface would poke a resting drip's top edge straight
// through it. Anchors on those upward-facing surfaces need to clear the
// surface by DOT_SIZE plus a small epsilon, not just the epsilon alone.
const CEILING_ANCHOR_DROP = DOT_SIZE + 0.02;
// how far a wall source sits off its panel's face; its fall stays pinned
// there, so this is the whole reach a wall drip has along that normal
const WALL_INSET = 0.02;

// --- particle-density derivation ---
// Each dot repeats a grow -> fall -> land -> respawn cycle forever, so one
// dot is a renewal process with period T_cycle. With N independent dots
// sharing a source, the aggregate "a drop lands and a new one starts"
// arrival process is approximately Poisson with rate N/T_cycle, so the
// chance of a gap longer than SPAWN_GAP_WINDOW seconds with nothing
// spawning is ~exp(-N/T_cycle * SPAWN_GAP_WINDOW). Solving that for N
// against a target tolerance gives the count a source needs "on tap" to
// read as a continuously (if randomly) regenerating spray rather than a
// handful of particles whose shared lifecycle becomes visible as feast
// and famine. Ceiling sources can fall arbitrarily many rooms, so their
// fall (and landing) time - and thus the count they need - grows with
// fall distance; opening sources have a fixed ~1 room fall (see
// _addSourceDots) so this reduces to one constant for them.
const SPAWN_GAP_WINDOW = 2.5; // seconds - longer gaps start reading as "nothing is happening"
const SPAWN_GAP_TOLERANCE = 0.1; // accepted chance of an occasional gap that long
const MEAN_TERMINAL_SPEED = TERMINAL_SPEED * 1.1; // average of the (0.7, 1.5) per-dot multiplier range
const MEAN_GROW_DURATION = GROW_DURATION_BASE + GROW_DURATION_VARIANCE / 2;

// estimated grow+fall+land cycle time for a dot falling `fallDistance`
// world units, using the population's mean terminal speed (count has to
// be picked before any individual dot's own speed is rolled)
function estimateCycleTime(fallDistance) {
    const capDistance = (MEAN_TERMINAL_SPEED * MEAN_TERMINAL_SPEED) / (2 * FALL_ACCEL);
    const fallTime = fallDistance <= capDistance
        ? Math.sqrt(2 * fallDistance / FALL_ACCEL)
        : MEAN_TERMINAL_SPEED / FALL_ACCEL + (fallDistance - capDistance) / MEAN_TERMINAL_SPEED;
    const landingSpeed = Math.min(MEAN_TERMINAL_SPEED, Math.sqrt(2 * FALL_ACCEL * fallDistance));
    const landTime = landingSpeed / LANDING_DECEL;
    return MEAN_GROW_DURATION + fallTime + landTime;
}

// how many independent dots a source needs "on tap" so new drops keep
// arriving often enough to not read as a handful of particles on a
// visible shared lifecycle - see the derivation above
function targetDotCount(fallDistance) {
    const requiredRate = Math.log(1 / SPAWN_GAP_TOLERANCE) / SPAWN_GAP_WINDOW;
    return Math.max(2, Math.ceil(requiredRate * estimateCycleTime(fallDistance)));
}

// local space: x in [-0.5, 0.5] is the streak's width, y in [0, 1] runs from
// the head (the drip's actual position) to the tail (trailing upward, since
// that's where the drip recently was) - scaled and billboarded per-instance
// in the vertex shader below
const VERTEX_SHADER = `
attribute vec3 color;
attribute float instanceGrowth;
varying vec3 vColor;
varying float vGrowth;
varying vec2 vLocal; // (localX, localY) in view-plane world units, head cap at y=0
varying float vCapRadius; // width / 2 - the resting circle's radius
varying float vExtraLength; // how far past a resting circle this streak has stretched
void main() {
    vColor = color;
    vGrowth = instanceGrowth;

    // instanceMatrix carries translation (the head position) and scale
    // (x = width, y = length) but no rotation - billboarding happens here
    // instead, so it can react to the camera every frame without the CPU
    // side needing a camera reference
    vec3 instancePos = instanceMatrix[3].xyz;
    float width = instanceMatrix[0][0];
    float streakLength = instanceMatrix[1][1];

    // the streak's own axis, head to tail, in view space - the quad is
    // built along that axis PROJECTED into the view plane (its xy), so the
    // streak always faces the camera squarely however it's viewed. Seen
    // from the side the projection is the full length and this reads as the
    // old vertical streak; seen from directly below or above it shrinks to
    // nothing and the pill SDF collapses to a round dot - the honest
    // foreshortening of a streak viewed down its own axis, instead of the
    // edge-on sliver a world-Y-aligned quad degenerates into.
    vec4 headView = viewMatrix * modelMatrix * vec4(instancePos, 1.0);
    vec4 tailView = viewMatrix * modelMatrix * vec4(instancePos + vec3(0.0, streakLength, 0.0), 1.0);
    vec2 axisView = tailView.xy - headView.xy;
    float projectedLength = length(axisView);

    vCapRadius = width * 0.5;
    vExtraLength = max(0.0, projectedLength - width);
    // the pill never shrinks below its own resting circle, so a fully
    // foreshortened drip stays a full-width dot rather than vanishing
    float pillLength = width + vExtraLength;

    // where the pill sits along that axis relative to the head. Side-on,
    // the head cap's near edge sits on the anchor (the drip's own position,
    // which is what lands on the floor); as the streak foreshortens, the
    // pill eases into being centered on the anchor instead - by then it's a
    // plain dot, and centering it keeps the axis direction (which goes
    // unstable as the projection vanishes) from wobbling the dot around.
    float lengthwise = clamp(projectedLength / max(width, 1e-6), 0.0, 1.0);
    float alongStart = -vCapRadius * (1.0 - lengthwise);
    float along = alongStart + position.y * pillLength;

    vec2 axis = projectedLength < 1e-6 ? vec2(0.0, 1.0) : axisView / projectedLength;

    vLocal = vec2(position.x * width, position.y * pillLength);

    // the quad is laid out in the view plane directly - depth is the only
    // thing taken from the 3D segment, on a parameter clamped to the
    // segment's own span (an unclamped one blows up as the projection, its
    // denominator, vanishes head-on)
    float depthFraction = clamp(along / max(projectedLength, 1e-6), 0.0, 1.0);
    // the quad's local x maps to this perpendicular: it has to be the axis
    // turned this way round, not the other, or the triangles wind backwards
    // and the material's own face culling drops every drip. The handedness
    // is the same whichever way the axis points, so this one sign holds for
    // every view.
    vec2 perpendicular = vec2(axis.y, -axis.x);
    vec3 viewPosition = vec3(
        headView.xy + axis * along + perpendicular * vLocal.x,
        mix(headView.z, tailView.z, depthFraction));
    gl_Position = projectionMatrix * vec4(viewPosition, 1.0);
}
`;

const FRAGMENT_SHADER = `
uniform float opacity;
varying vec3 vColor;
varying float vGrowth;
varying vec2 vLocal;
varying float vCapRadius;
varying float vExtraLength;
void main() {
    // stadium/pill SDF: distance from this fragment to the nearest point
    // on the streak's centerline segment - collapses to a plain circle
    // when vExtraLength is 0 (segment has zero length)
    float segY = clamp(vLocal.y, vCapRadius, vCapRadius + vExtraLength);
    float dist = length(vec2(vLocal.x, vLocal.y - segY));
    float edge = max(vCapRadius * 0.15, 0.0005);
    float shapeAlpha = 1.0 - smoothstep(vCapRadius - edge, vCapRadius + edge, dist);
    if (shapeAlpha <= 0.0) discard;

    // fades the tail. The falloff's *reach* is floored at one cap radius
    // (rather than vExtraLength itself) so a barely-moving drip's fade
    // spreads across that same one-radius band instead of collapsing to a
    // razor-thin range and snapping everything past it straight to
    // invisible - but once the streak has stretched further than that, the
    // reach grows right along with it, so a long fast tail still fades
    // gradually over its own length instead of clipping to nothing after a
    // fixed short distance. *Strength* ramps in separately over that same
    // one-radius distance, reaching zero (no fade at all) right at rest.
    float capRadiusSafe = max(vCapRadius, 0.0001);
    float reach = max(vExtraLength, capRadiusSafe);
    float t = clamp((vLocal.y - vCapRadius) / reach, 0.0, 1.0);
    float intensity = clamp(vExtraLength / capRadiusSafe, 0.0, 1.0);
    float fade = 1.0 - t * intensity;

    gl_FragColor = vec4(vColor, shapeAlpha * fade * opacity * vGrowth);
}
`;

// smoothstep ease, so growth accelerates into and out of the ramp rather
// than moving at a constant rate
function easeGrowth(t) {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}

// a thin quad in the local space the shaders above expect: x in
// [-0.5, 0.5] (width), y in [0, 1] (head to tail) - the actual streak
// shape is carved out of this bounding rectangle analytically in the
// fragment shader, not by this geometry
function buildStreakGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        -0.5, 0, 0,
        0.5, 0, 0,
        0.5, 1, 0,
        -0.5, 1, 0,
    ]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    return geometry;
}

export default class DripsDecor {
    // A source's band is the stretch of its host panel's normal the water
    // sweeps, which is why the three kinds differ so sharply: a wall drip
    // is pinned just off the face and falls parallel to it, a ceiling drip
    // falls straight out along it, and an opening targets a non-solid panel
    // nothing else can be mounted on.
    //
    // Deliberately not `unobtrusive`: water sweeps a volume rather than
    // nestling into one, so anything its band reaches is something it would
    // visibly fall through - including a pipe it never touches laterally.
    static PROFILE = {
        role: ROLE.FILL,
        variants: {
            wall: { band: [WALL_INSET, WALL_INSET] },
            ceiling: { band: [CEILING_ANCHOR_DROP, Infinity] },
            opening: null,
        },
    };

    // pieces per room relative to the other kinds (sceneryBudget.js)
    static WEIGHT = 1;

    // the profile for one source kind, or null where there's nothing to claim
    static profileFor(type) {
        const variant = DripsDecor.PROFILE.variants[type];
        return variant ? { ...DripsDecor.PROFILE, ...variant } : null;
    }

    constructor() {
        this.group = new THREE.Group();
        this.streakGeometry = buildStreakGeometry();
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                opacity: { value: 0.6 },
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.mesh = null;
        this._dummy = new THREE.Object3D();

        this.x = [];
        this.z = [];
        this.startY = [];
        this.floorY = [];
        this.terminalSpeed = [];
        this.growDuration = [];
        this.y = [];
        this.velocity = [];
        this.elapsed = [];
        this.growth = [];
        this.landing = [];
    }

    addTo(scene) {
        scene.add(this.group);
    }

    // writes dot i's current head position/width/length (no rotation - the
    // shader billboards around world Y itself) into `dummy`'s matrix
    _writeInstanceMatrix(i) {
        const width = DOT_SIZE * this.growth[i];
        const length = (DOT_SIZE + this.velocity[i] * STREAK_LENGTH_PER_SPEED) * this.growth[i];
        this._dummy.position.set(this.x[i], this.y[i], this.z[i]);
        this._dummy.rotation.set(0, 0, 0);
        this._dummy.scale.set(width, length, 1);
        this._dummy.updateMatrix();
    }

    build(mazeData, rng = Math.random, claims = new SceneryClaims()) {
        const sourceCount = budgetFor(mazeData, DripsDecor, rng);

        const xs = [], zs = [], startYs = [], floorYs = [], terminalSpeeds = [], colorComponents = [];

        let liveSourceCount = 0;
        for (let i = 0; i < sourceCount; i++) {
            const source = this._pickSource(mazeData, rng, claims);
            if (!source) continue;
            const added = this._addSourceDots(mazeData, source, rng, xs, zs, startYs, floorYs, terminalSpeeds, colorComponents);
            if (added === 0) continue;
            // claimed once the source actually produced water - it yields
            // nothing when there's no solid floor anywhere below it
            claims.claim(source.room, source.surface ?? CEILING_SURFACE, DripsDecor.profileFor(source.type));
            liveSourceCount++;
        }

        const n = xs.length;
        this.x = xs;
        this.z = zs;
        this.startY = startYs;
        this.floorY = floorYs;
        this.terminalSpeed = terminalSpeeds;
        this.growDuration = Array.from({ length: n }, () => GROW_DURATION_BASE + rng() * GROW_DURATION_VARIANCE);
        // start every dot mid-grow, at a random point in that wait, so
        // they don't all sit there in lockstep
        this.elapsed = this.growDuration.map(gd => rng() * gd);
        this.velocity = new Array(n).fill(0);
        this.y = startYs.slice();
        this.growth = this.elapsed.map((e, i) => easeGrowth(e / this.growDuration[i]));
        this.landing = new Array(n).fill(false);

        clearInstanced(this.group, [this.streakGeometry]);
        this.mesh = null;
        if (n > 0) {
            this.mesh = new THREE.InstancedMesh(this.streakGeometry, this.material, n);
            this.mesh.frustumCulled = false;
            this.mesh.geometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(colorComponents), 3));
            this.mesh.geometry.setAttribute('instanceGrowth', new THREE.InstancedBufferAttribute(new Float32Array(this.growth), 1));

            for (let i = 0; i < n; i++) {
                this._writeInstanceMatrix(i);
                this.mesh.setMatrixAt(i, this._dummy.matrix);
            }
            this.mesh.instanceMatrix.needsUpdate = true;
            this.group.add(this.mesh);
        }

        return liveSourceCount;
    }

    update(dt) {
        const n = this.x.length;
        if (n === 0 || !this.mesh) return;

        const growthValues = this.mesh.geometry.attributes.instanceGrowth.array;
        for (let i = 0; i < n; i++) {
            if (this.landing[i]) {
                // head is frozen at the floor (see below) - the tail
                // catches up to it by decelerating back to zero, since the
                // streak's length is driven entirely by velocity
                this.velocity[i] = Math.max(0, this.velocity[i] - LANDING_DECEL * dt);
                if (this.velocity[i] === 0) {
                    // caught up - respawn at the source
                    this.y[i] = this.startY[i];
                    this.elapsed[i] = 0;
                    this.growDuration[i] = GROW_DURATION_BASE + Math.random() * GROW_DURATION_VARIANCE;
                    this.growth[i] = 0;
                    this.landing[i] = false;
                }
            } else {
                this.elapsed[i] += dt;

                if (this.elapsed[i] < this.growDuration[i]) {
                    // sitting at the source, growing in before it drops
                    this.y[i] = this.startY[i];
                    this.velocity[i] = 0;
                    this.growth[i] = easeGrowth(this.elapsed[i] / this.growDuration[i]);
                } else {
                    // fully grown and falling, accelerating up to (not
                    // instantly at) terminal speed
                    this.growth[i] = 1;
                    this.velocity[i] = Math.min(this.terminalSpeed[i], this.velocity[i] + FALL_ACCEL * dt);
                    this.y[i] -= this.velocity[i] * dt;

                    if (this.y[i] <= this.floorY[i]) {
                        // freeze the head at the floor and let the tail
                        // catch up instead of despawning immediately
                        this.y[i] = this.floorY[i];
                        this.landing[i] = true;
                    }
                }
            }

            this._writeInstanceMatrix(i);
            this.mesh.setMatrixAt(i, this._dummy.matrix);
            growthValues[i] = this.growth[i];
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.geometry.attributes.instanceGrowth.needsUpdate = true;
    }

    // a solid wall, an open doorway, or a solid ceiling - see the file comment
    _pickSource(mazeData, rng, claims, maxAttempts = 30) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const room = randomRoom(mazeData, rng);
            const roll = rng();

            if (roll < 0.4) {
                if (panelSolid(mazeData, room, CEILING_SURFACE.axis, CEILING_SURFACE.dir)
                    && claims.canClaim(room, CEILING_SURFACE, DripsDecor.profileFor('ceiling'))) {
                    return { type: 'ceiling', room };
                }
            } else if (roll < 0.75) {
                const surface = WALL_SURFACES[randomInt(rng, WALL_SURFACES.length)];
                if (panelSolid(mazeData, room, surface.axis, surface.dir)
                    && claims.canClaim(room, surface, DripsDecor.profileFor('wall'))) {
                    return { type: 'wall', room, surface };
                }
            } else {
                const surface = WALL_SURFACES[randomInt(rng, WALL_SURFACES.length)];
                if (!panelSolid(mazeData, room, surface.axis, surface.dir)) {
                    return { type: 'opening', room, surface };
                }
            }
        }
        return null;
    }

    // walks straight down from `startRoom`, room by room, until it finds a
    // solid floor (which may be several levels down, through any open
    // floors along the way) - or null if it runs out of maze first, so a
    // source with nowhere solid to land never spawns anything at all
    // (never drips out the bottom of the maze into nothing)
    _findFloorY(mazeData, startRoom, maxDepth = 64) {
        let room = { ...startRoom };
        for (let i = 0; i < maxDepth; i++) {
            if (!roomInBounds(mazeData, room)) return null;
            if (panelSolid(mazeData, room, 'y', -1)) {
                return getOffset(room.y) - majorWidth / 2;
            }
            room = { ...room, y: room.y - 2 };
        }
        return null;
    }

    _addSourceDots(mazeData, source, rng, xs, zs, startYs, floorYs, terminalSpeeds, colorComponents) {
        const { type, room, surface } = source;
        // opening drips spawn precisely on the doorway's centerline, which
        // coincides with the maze's permanently-solid lattice beam (never
        // derived from collision_map - see LatticeStudsDecor's file
        // comment) - so unlike ceiling/wall, an opening's fall is always
        // exactly one room tall and needs no room-by-room search
        const floorY = type === 'opening'
            ? getOffset(room.y) - majorWidth / 2
            : this._findFloorY(mazeData, room);
        if (floorY === null) return 0;

        const tmpColor = new THREE.Color(1, 1, 1);
        const pushColor = () => colorComponents.push(tmpColor.r, tmpColor.g, tmpColor.b);

        if (type === 'ceiling') {
            const startY = getOffset(room.y) + majorWidth / 2 - CEILING_ANCHOR_DROP;
            // count scales with fall distance - see targetDotCount's
            // derivation - with a small random spread so sources don't all
            // look identically dense
            const count = Math.max(2, targetDotCount(startY - floorY) + randomInt(rng, 3) - 1);
            for (let i = 0; i < count; i++) {
                xs.push(getOffset(room.x) + (rng() * 2 - 1) * majorWidth * 0.4);
                zs.push(getOffset(room.z) + (rng() * 2 - 1) * majorWidth * 0.4);
                startYs.push(startY);
                floorYs.push(floorY);
                terminalSpeeds.push(TERMINAL_SPEED * (0.7 + rng() * 0.8));
                pushColor();
            }
            return count;
        }

        const [horizAxis] = ['x', 'z'].filter(a => a !== surface.axis);

        if (type === 'opening') {
            // the doorway is the maze's "false" wall cell - same
            // minorWidth (surface.axis) x majorWidth (horizAxis) x
            // majorWidth (y) slot a solid panel would occupy, just without
            // a panel in it. Water seeps in along its open top edge - the
            // majorWidth-wide line at the cell's own ceiling height - so
            // dots are scattered along that whole line rather than
            // clustered at one point, and start falling from there instead
            // of from a random mid-height point
            const panelCenter = getOffset(room[surface.axis] + surface.dir);
            const topY = getOffset(room.y) + majorWidth / 2 - CEILING_ANCHOR_DROP;

            // fixed ~1 room fall distance, so targetDotCount reduces to a
            // constant here - see its derivation above
            const count = Math.max(2, targetDotCount(topY - floorY) + randomInt(rng, 3) - 1);
            for (let i = 0; i < count; i++) {
                const point = { x: getOffset(room.x), z: getOffset(room.z) };
                point[surface.axis] = panelCenter;
                point[horizAxis] = getOffset(room[horizAxis]) + (rng() * 2 - 1) * majorWidth * 0.45;
                xs.push(point.x);
                zs.push(point.z);
                startYs.push(topY);
                floorYs.push(floorY);
                terminalSpeeds.push(TERMINAL_SPEED * (0.7 + rng() * 0.8));
                pushColor();
            }
            return count;
        }

        // wall: a small cluster near one point on a solid panel
        const point = { x: getOffset(room.x), z: getOffset(room.z) };
        point[horizAxis] = getOffset(room[horizAxis]) + (rng() * 2 - 1) * majorWidth * 0.35;
        point[surface.axis] = getOffset(room[surface.axis]) + surface.dir * (majorWidth / 2 - WALL_INSET);
        const startY = getOffset(room.y) + (rng() * 2 - 1) * majorWidth * 0.3;

        const count = 2 + randomInt(rng, 4);
        for (let i = 0; i < count; i++) {
            // jitter only in-plane (along horizAxis) - the other axis is
            // pinned to the wall's own plane in `point` and must stay there
            const jitter = (rng() * 2 - 1) * 0.04;
            xs.push(point.x + (horizAxis === 'x' ? jitter : 0));
            zs.push(point.z + (horizAxis === 'z' ? jitter : 0));
            startYs.push(startY);
            floorYs.push(floorY);
            terminalSpeeds.push(TERMINAL_SPEED * (0.7 + rng() * 0.8));
            pushColor();
        }
        return count;
    }
}
