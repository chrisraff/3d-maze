/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * A glowing "base" marking exactly where each breadcrumb was originally
 * spawned: a medallion of concentric studs on whichever panel the
 * breadcrumb's dead end terminates against (BreadcrumbManager resolves
 * that surface from the dead end's own direction and hands it to build()
 * pre-resolved, so this module stays free of breadcrumb-specific concepts),
 * plus a ring of animated dots radiating outward from its center. Bases
 * never move with their breadcrumb and never appear for one placed by the
 * player - build() is only ever called once per maze, from the same pass
 * that spawns the original dead-end breadcrumbs.
 *
 * Color: the outer ring is the breadcrumb's own true color (hue, saturation
 * and lightness all read straight off its material), blending inward toward
 * - almost but not quite reaching - the actual rendered color of the panel
 * it sits on, so the very center nearly disappears into the room's own
 * palette while the outer edge unambiguously reads as "this breadcrumb's."
 * Height mirrors that same inward motion: minimal at the outer ring,
 * ramping up toward a single tall stud at the center.
 *
 * Dots: each spawns at a random angle and random point in the cycle,
 * decelerating uniformly outward (fast at first, slowing to a stop right as
 * it reaches its max radius) with a slight drift off the surface, then
 * fades out over the last stretch of the cycle - see FADE_START.
 *
 * De-energizing: once a breadcrumb is grabbed (BreadcrumbManager calls
 * deenergize(index) from beginReorient/removeBreadcrumb), its base's dots
 * stop spawning immediately and its studs ease further toward the panel's
 * own color over DEENERGIZE_DURATION - see deenergize() and
 * _applyDeenergizeTransitions(). This only ever moves a stud CLOSER to the
 * panel color (on top of whatever blend it already had), so the center,
 * already mostly blended in, fades almost the rest of the way while the
 * outer ring - previously the breadcrumb's true color - settles to roughly
 * matching the center's old look.
 */
import * as THREE from 'three';
import { majorWidth, minorWidth, getOffset } from './maze.js';

const MAX_RADIUS = majorWidth * 0.4;
const HEIGHT_MIN = 0.0075;
const HEIGHT_MAX = 0.07;
const HEIGHT_EASE = 1.5; // >1 keeps most rings low, saving the height ramp for the last stretch toward center

// how far, at most, the center is allowed to blend toward the panel's own
// color - kept under 1 so even dead center keeps a last trace of the
// breadcrumb's own color rather than being visually identical to the panel
const BLEND_TOWARD_PANEL_MAX = 0.92;

// how far a stud sinks into the solid wall along the panel's normal, so it
// reads as embedded rather than merely flush against the surface
const EMBED_DEPTH = minorWidth / 4;

// how much further toward the panel's own color a de-energized medallion's
// studs blend, on top of whatever blend they already had, and how long that
// transition takes once triggered (see deenergize())
const DEENERGIZE_BLEND_AMOUNT = 0.5;
const DEENERGIZE_DURATION = 1.0;

const DOTS_PER_MEDALLION = 21;
const RADIATE_RADIUS = MAX_RADIUS * 1.15; // roughly majorWidth/2 - how far out a dot travels before it fades
const RADIATE_PERIOD = 2.6; // seconds for one dot's full cycle, center to fade-out
// fraction of the cycle a dot spends at full brightness before fading -
// it's already slowed almost to a stop by the time this kicks in (see the
// deceleration curve in _applyDotPositions), so it reads as coasting to
// rest and fading, not fading while still visibly moving
const FADE_START = 0.7;
const DOT_SIZE = 0.03;
// overall material opacity, on top of each dot's own fade envelope - keeps
// the additive blending (see dotMaterial, matched to dust.js's effect) from
// blowing out too bright where several dots overlap
const DOT_OPACITY = 0.7;
// where a dot spawns along the panel's own normal, before any drift - just
// beneath the medallion's tallest point (the center stud, which reaches
// HEIGHT_MAX off the panel - see _buildMedallion's `place`), so dots read
// as emanating from near the beacon's tip rather than from the flat panel
const DOT_SPAWN_OFFSET = HEIGHT_MAX * 0.9;
// additional outward drift along that same normal as a dot travels - reads
// as gently puffing further off the surface, not staying at a fixed height
const NORMAL_DRIFT_MAX = 0.05;

// the wall model's own hole layout reuses this exact RGB-from-grid-index
// formula (see MazeWorld.js's build()) to color each panel - mirrored here
// (not imported, to avoid coupling this module to MazeWorld's THREE/scene
// setup) so a medallion's center can blend toward the real color of the
// panel behind it
function panelRenderedColor(mazeData, panelIndex) {
    return new THREE.Color(
        0.05 + 0.9 * (panelIndex.x - 1) / mazeData.segments[0],
        0.05 + 0.9 * (panelIndex.y - 1) / mazeData.segments[1],
        0.05 + 0.9 * (panelIndex.z - 1) / mazeData.segments[2],
    );
}

// t in [0, 1] -> 1 down to 0, smoothstep eased
function dotFadeEnvelope(t) {
    return 1 - t * t * (3 - 2 * t);
}

// sRGB <-> OKLab (Björn Ottosson's formulas) - used instead of HSL for the
// stud color blend below, because linearly interpolating HSL's lightness
// sweeps through l=0.5 (the most visually vivid lightness for any given
// hue/saturation) even when both endpoints look fairly muted, producing a
// garish "flash" partway through the blend that OKLab's perceptually
// uniform lightness doesn't
function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c) {
    c = Math.max(0, Math.min(1, c));
    return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}
function rgbToOklab(color) {
    const r = srgbToLinear(color.r), g = srgbToLinear(color.g), b = srgbToLinear(color.b);
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    return {
        L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    };
}
function oklabToRgb(lab, target) {
    const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
    const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    const s_ = lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    target.r = linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    target.g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    target.b = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
    return target;
}

// shared by both build-time coloring and the de-energize transition, so
// there's one definition of "how a stud's color blends toward the panel's
// own color": extraBlend (0 normally) shifts the whole thing further toward
// the panel on top of the ring's own radius-based blend, capped at 1
function studColorOklab(target, radiusFraction, trueOklab, panelOklab, extraBlend = 0) {
    const blend = Math.min(1, BLEND_TOWARD_PANEL_MAX * (1 - radiusFraction) + extraBlend);
    target.L = THREE.MathUtils.lerp(trueOklab.L, panelOklab.L, blend);
    target.a = THREE.MathUtils.lerp(trueOklab.a, panelOklab.a, blend);
    target.b = THREE.MathUtils.lerp(trueOklab.b, panelOklab.b, blend);
    return target;
}

// TextureLoader needs document.createElementNS to build an Image, which
// isn't available in every environment this module gets constructed in -
// fall back to an untextured (square) dot there rather than throwing
function loadDotTexture() {
    try {
        return new THREE.TextureLoader().load('textures/dot.png');
    } catch {
        return null;
    }
}

function pushStud(matrices, colors, dummy, position, size, depth, normalAxis, color) {
    dummy.position.copy(position);
    dummy.scale.set(size, size, size);
    dummy.scale[normalAxis] = depth;
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    colors.push(color.r, color.g, color.b);
}

export default class BreadcrumbBaseDecor {
    constructor() {
        this.group = new THREE.Group();
        this.studGeometry = new THREE.InstancedBufferGeometry();
        THREE.BufferGeometry.prototype.copy.call(this.studGeometry, new THREE.BoxGeometry());
        this.studMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.studMesh = null;

        this.dotGeometry = new THREE.BufferGeometry();
        this.dotMaterial = new THREE.PointsMaterial({
            size: DOT_SIZE,
            vertexColors: true,
            map: loadDotTexture(),
            alphaTest: 0.5,
            transparent: true,
            opacity: DOT_OPACITY,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.dotPoints = new THREE.Points(this.dotGeometry, this.dotMaterial);
        this.dotPoints.frustumCulled = false;

        this._dotCenters = [];
        this._dotDirections = [];
        this._dotNormalDirs = [];
        this._dotSpeed = [];
        this._dotPhase = [];
        this._dotBaseColor = [];
        this._dotMuted = [];
        this._t = 0;

        // one entry per site passed to build(), in the same order - lets
        // deenergize(index) find and recolor just that medallion's studs
        // and mute just its dots, without touching any other medallion
        this._medallions = [];
        // per-stud radius fraction (0 at the center stud, up to 1 at the
        // outermost ring), index-aligned with the studMesh's own instances -
        // needed to recompute a stud's color on demand during a transition
        this._studRadiusFraction = [];
    }

    addTo(scene) {
        scene.add(this.group);
        scene.add(this.dotPoints);
    }

    // sites: [{ room: {x,y,z}, surface: {axis, dir}, hue, saturation,
    // lightness }, ...] - one per originally-spawned breadcrumb; hue/
    // saturation/lightness in [0, 1], read straight off that breadcrumb's
    // own material color so the outer ring is a true match
    build(mazeData, sites, rng = Math.random) {
        this.group.remove(...this.group.children);
        this.studMesh = null;

        const dummy = new THREE.Object3D();
        dummy.rotation.set(0, 0, 0);
        const matrices = [];
        const colors = [];
        const tmpColor = new THREE.Color();

        const dotCenters = [];
        const dotDirections = [];
        const dotNormalDirs = [];
        const dotSpeed = [];
        const dotPhase = [];
        const dotBaseColor = [];
        const studRadiusFraction = [];
        const medallions = [];

        for (const site of sites) {
            this._buildMedallion(mazeData, site, dummy, tmpColor, matrices, colors, studRadiusFraction, rng,
                dotCenters, dotDirections, dotNormalDirs, dotSpeed, dotPhase, dotBaseColor, medallions);
        }

        if (matrices.length > 0) {
            this.studGeometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(colors), 3));
            this.studMesh = new THREE.InstancedMesh(this.studGeometry, this.studMaterial, matrices.length);
            matrices.forEach((m, i) => this.studMesh.setMatrixAt(i, m));
            this.studMesh.instanceMatrix.needsUpdate = true;
            this.group.add(this.studMesh);
        }

        this._dotCenters = dotCenters;
        this._dotDirections = dotDirections;
        this._dotNormalDirs = dotNormalDirs;
        this._dotSpeed = dotSpeed;
        this._dotPhase = dotPhase;
        this._dotBaseColor = dotBaseColor;
        this._dotMuted = new Array(dotCenters.length).fill(false);
        this._studRadiusFraction = studRadiusFraction;
        this._medallions = medallions;
        this._t = 0;

        const n = dotCenters.length;
        this.dotGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        this.dotGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        this._applyDotPositions(); // paint an initial frame so nothing pops in at the origin

        return sites.length;
    }

    update(dt) {
        if (this._medallions.length === 0) return;
        this._t += dt;
        this._applyDotPositions();
        this._applyDeenergizeTransitions();
    }

    // called by BreadcrumbManager the moment a placed breadcrumb is grabbed
    // (VR beginReorient) or picked up (removeBreadcrumb) - index is the same
    // index that breadcrumb's site had in the `sites` array passed to
    // build(). Safe to call more than once (or with an out-of-range index,
    // e.g. a breadcrumb the player placed themselves, which has none) - a
    // no-op past the first call
    deenergize(index) {
        const medallion = this._medallions[index];
        if (!medallion || medallion.deenergizeStart !== null) return;
        medallion.deenergizeStart = this._t;
        for (let i = medallion.dotStart; i < medallion.dotStart + medallion.dotCount; i++) {
            this._dotMuted[i] = true;
        }
    }

    _applyDotPositions() {
        const n = this._dotCenters.length;
        const positions = this.dotGeometry.attributes.position.array;
        const colors = this.dotGeometry.attributes.color.array;
        const tmpColor = new THREE.Color();

        for (let i = 0; i < n; i++) {
            if (this._dotMuted[i]) {
                // de-energized: stop spawning/showing this dot outright,
                // rather than letting it finish its current cycle
                colors[i * 3 + 0] = 0;
                colors[i * 3 + 1] = 0;
                colors[i * 3 + 2] = 0;
                continue;
            }

            const progress = ((this._t * this._dotSpeed[i] + this._dotPhase[i]) % 1 + 1) % 1;
            // uniformly decelerating motion (like a spark losing momentum to
            // friction): starts at speed 2*RADIATE_RADIUS/RADIATE_PERIOD and
            // slows to a stop exactly as it lands on RADIATE_RADIUS at
            // progress=1 - same reach as the old constant-speed version
            // (1 - (1-t)^2 == 2t - t^2, the standard quadratic ease-out)
            const radius = RADIATE_RADIUS * (1 - (1 - progress) ** 2);
            const normalOffset = DOT_SPAWN_OFFSET + NORMAL_DRIFT_MAX * progress;
            const center = this._dotCenters[i];
            const dir = this._dotDirections[i];
            const normalDir = this._dotNormalDirs[i];

            positions[i * 3 + 0] = center.x + dir.x * radius + normalDir.x * normalOffset;
            positions[i * 3 + 1] = center.y + dir.y * radius + normalDir.y * normalOffset;
            positions[i * 3 + 2] = center.z + dir.z * radius + normalDir.z * normalOffset;

            // full brightness while it's still moving, fading out over the
            // last stretch as it coasts to a stop
            const envelope = progress < FADE_START ? 1 : dotFadeEnvelope((progress - FADE_START) / (1 - FADE_START));
            tmpColor.copy(this._dotBaseColor[i]).multiplyScalar(envelope);
            colors[i * 3 + 0] = tmpColor.r;
            colors[i * 3 + 1] = tmpColor.g;
            colors[i * 3 + 2] = tmpColor.b;
        }

        this.dotGeometry.attributes.position.needsUpdate = true;
        this.dotGeometry.attributes.color.needsUpdate = true;
    }

    // recolors the studs of any medallion currently mid-transition (or just
    // finished) toward its de-energized target; medallions untouched since
    // the last frame are skipped entirely, and a medallion is skipped for
    // good once it reaches the end of its transition
    _applyDeenergizeTransitions() {
        if (!this.studMesh) return;

        const colorArray = this.studGeometry.attributes.color.array;
        const lab = { L: 0, a: 0, b: 0 };
        const tmpColor = new THREE.Color();
        let anyChanged = false;

        for (const medallion of this._medallions) {
            if (medallion.deenergizeStart === null || medallion.settled) continue;

            const t = Math.min(1, (this._t - medallion.deenergizeStart) / DEENERGIZE_DURATION);
            const eased = t * t * (3 - 2 * t); // smoothstep
            const extraBlend = DEENERGIZE_BLEND_AMOUNT * eased;

            for (let i = medallion.studStart; i < medallion.studStart + medallion.studCount; i++) {
                studColorOklab(lab, this._studRadiusFraction[i], medallion.trueOklab, medallion.panelOklab, extraBlend);
                oklabToRgb(lab, tmpColor);
                colorArray[i * 3 + 0] = tmpColor.r;
                colorArray[i * 3 + 1] = tmpColor.g;
                colorArray[i * 3 + 2] = tmpColor.b;
            }
            anyChanged = true;
            if (t >= 1) medallion.settled = true;
        }

        if (anyChanged) this.studGeometry.attributes.color.needsUpdate = true;
    }

    _buildMedallion(mazeData, { room, surface, hue, saturation: trueSaturation, lightness: trueLightness }, dummy, tmpColor, matrices, colors, studRadiusFraction, rng,
        dotCenters, dotDirections, dotNormalDirs, dotSpeed, dotPhase, dotBaseColor, medallions) {
        const [axisA, axisB] = ['x', 'y', 'z'].filter(a => a !== surface.axis);
        const roomCenter = new THREE.Vector3(getOffset(room.x), getOffset(room.y), getOffset(room.z));
        const panelOffset = getOffset(room[surface.axis]) + surface.dir * majorWidth / 2;

        const panelIndex = { ...room, [surface.axis]: room[surface.axis] + surface.dir };
        const panelColor = panelRenderedColor(mazeData, panelIndex);
        const panelOklab = rgbToOklab(panelColor);
        const trueOklab = rgbToOklab(tmpColor.setHSL(((hue % 1) + 1) % 1, trueSaturation, trueLightness));

        const ringCount = 2 + Math.floor(rng() * 3); // 2..4 rings
        const angleOffset = rng() * Math.PI * 2;
        const studStart = matrices.length;
        const dotStart = dotCenters.length;

        const position = new THREE.Vector3();
        const lab = { L: 0, a: 0, b: 0 };
        const place = (axisAOffset, axisBOffset, r) => {
            const radiusFraction = r / ringCount;

            position.copy(roomCenter);
            position[axisA] = roomCenter[axisA] + axisAOffset;
            position[axisB] = roomCenter[axisB] + axisBOffset;

            // true breadcrumb color at the outer edge, blending further
            // toward the panel's own color the closer to center - see
            // studColorOklab (shared with the de-energize transition)
            studColorOklab(lab, radiusFraction, trueOklab, panelOklab);
            oklabToRgb(lab, tmpColor);
            const height = HEIGHT_MIN + (HEIGHT_MAX - HEIGHT_MIN) * (1 - radiusFraction) ** HEIGHT_EASE;
            const size = 0.09 * (1 - 0.08 * r);

            // extends EMBED_DEPTH further into the solid wall rather than
            // just sitting flush against its surface - the room-facing tip
            // stays exactly where a non-embedded stud's would be (still
            // `height` proud of the panel); only the wall-facing back face
            // moves, growing the block's total depth by EMBED_DEPTH
            const depth = height + EMBED_DEPTH;
            position[surface.axis] = panelOffset - surface.dir * (height - EMBED_DEPTH) / 2;
            pushStud(matrices, colors, dummy, position, size, depth, surface.axis, tmpColor);
            studRadiusFraction.push(radiusFraction);
        };

        // a single center stud, tallest and nearly (but not exactly) the panel's own color
        place(0, 0, 0);

        for (let r = 1; r <= ringCount; r++) {
            const radius = (r / ringCount) * MAX_RADIUS;
            const studsOnRing = 4 + r * 3;

            for (let s = 0; s < studsOnRing; s++) {
                const angle = angleOffset + (s / studsOnRing) * Math.PI * 2 + r * 0.15;
                place(Math.cos(angle) * radius, Math.sin(angle) * radius, r);
            }
        }

        // animated dots radiating outward from the medallion's own center -
        // random angle and random start-of-cycle timing per dot (rather than
        // evenly spaced spokes) so they read as scattered sparks, not a
        // mechanical pattern; each also drifts slightly off the surface
        // as it travels (see NORMAL_DRIFT_MAX)
        const dotColor = new THREE.Color().setHSL(hue, 0.85, 0.65);
        const panelPoint = new THREE.Vector3(roomCenter.x, roomCenter.y, roomCenter.z);
        panelPoint[surface.axis] = panelOffset;
        const normalDir = new THREE.Vector3();
        normalDir[surface.axis] = -surface.dir; // away from the wall, into the room

        for (let d = 0; d < DOTS_PER_MEDALLION; d++) {
            const angle = rng() * Math.PI * 2;
            const dir = new THREE.Vector3();
            dir[axisA] = Math.cos(angle);
            dir[axisB] = Math.sin(angle);

            dotCenters.push(panelPoint);
            dotDirections.push(dir);
            dotNormalDirs.push(normalDir);
            dotSpeed.push(1 / RADIATE_PERIOD);
            dotPhase.push(rng());
            dotBaseColor.push(dotColor);
        }

        medallions.push({
            studStart, studCount: matrices.length - studStart,
            dotStart, dotCount: dotCenters.length - dotStart,
            trueOklab, panelOklab,
            deenergizeStart: null, settled: false,
        });
    }
}
