/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * The motion cue that plays just after a breadcrumb is placed: three square
 * bands, spaced out along the way the marker points, that leave it together
 * and fade out after about four minorWidths.
 *
 * A marker's whole job is to point somewhere - at you ("this branch is
 * spent") or away from you ("this is the way I was heading") - and a still
 * arrow at arm's length reads the same either way until you have walked
 * around it. The bands say which way it faces by moving that way.
 *
 * Direction comes from the marker's own +Z, the facing axis BreadcrumbManager
 * aims (see its _aimFacing), so nothing here cares which way a placement went:
 * the same local motion runs the other way because the marker itself turned
 * around. That holds for both the Markers Face setting (markerFacing.js) and
 * the double-click reversal of it; only the launch point below is told apart.
 *
 * Acceleration is the deliberate mirror of BreadcrumbBaseDecor's radiating
 * dots, which decelerate to a stop. Those mark a place and should settle;
 * these mark a direction and should read as departing, so they gather pace
 * all the way to the fade. They launch with some speed already on, rather
 * than from a standstill, so the cue is moving the frame it appears - it goes
 * up part way through the double-click window and has to read as a response
 * to the click that just happened.
 *
 * The group is parented to the scene rather than to the breadcrumb, and
 * copies its world transform every frame: breadcrumbs carry a scale of
 * BREADCRUMB_SCALE, and sizing the bands in that space would couple them to
 * the model's own scale for no gain. Following the transform (rather than
 * freezing it at the start) keeps the bands on a marker a VR hand is still
 * moving.
 */
import * as THREE from 'three';
import { minorWidth } from '../maze/maze.js';

// how far a band travels before it is gone, and how long it takes
export const TRAVEL = minorWidth * 4;
export const CUE_SECONDS = 0.5;

// all three launch together and hold their spacing, so the cue reads as one
// object leaving rather than as three separate pulses
export const BAND_COUNT = 3;
export const BAND_SPACING = minorWidth * 1.6;

// Where the leading band starts, measured along the marker's facing axis.
// The two cases look nothing alike from where the player is standing, so
// they do not get the same number.
//
// Aimed away, the player is looking at the arrow's back, and the bands can
// leave from the marker itself: they are in clear sight from the first frame
// and only recede from there.
//
// Aimed at the player, that same spot is behind the arrowhead, with the
// model's own silhouette over it, and a band born there has no run-up to
// speak of. Launching further back - past the model's tail, which sits at
// z = -0.54 in model units, or -2.2 minorWidths once BREADCRUMB_SCALE
// (minorWidth * 4) is applied - gives the approach somewhere to come from.
export const SPAWN_OFFSET_AWAY = 0;
export const SPAWN_OFFSET_TOWARD = -minorWidth * 2.5;

// how much of the travel is covered at the starting speed, the rest going to
// acceleration: 0 is a standing start, 1 is constant speed throughout. Enough
// of a push to be moving the instant it appears, still visibly gathering pace
// after that (it ends up a little over 4x its starting speed).
const INITIAL_SHARE = 0.75;

// fraction of the flight at full brightness before the fade starts - by then
// a band is moving fast and well clear of the marker, so it reads as leaving
// rather than as dissolving in place
const FADE_START = 0.45;

// the outer edge of a band, as a half-extent: matched to BREADCRUMB_SCALE
// (minorWidth * 4, the width of the marker's own model) so a band frames the
// marker it leaves rather than hiding it
const HALF_EXTENT = minorWidth * 2;
// the rails that make up that square are kept deliberately fine: all the
// weight is in DEPTH instead, so a band is a long thin pipe pointing the way
// the marker does rather than a slab facing the player
const THICKNESS = minorWidth * 0.08;
// ...and how far it runs along the direction of travel - several times the
// rail thickness, which is the whole point: the long axis of a band is the
// axis the marker points down. A flat ring would also turn edge-on to nothing
// when seen from the side, where this keeps its shape. Still well under
// BAND_SPACING, so the three stay three.
const DEPTH = minorWidth * 0.5;

// additive on top of the maze, so this is a brightness, not an opacity. Much
// past this and the bands clip to white over a lit panel, losing the hue that
// ties them to the marker they came off.
const BAND_INTENSITY = 0.5;
// how far a band's color sits from the marker's own hue (0) toward white (1).
// A saturated band can disappear against a similarly colored panel, and a
// white one stops reading as this marker's.
const WHITENESS = 0.15;

const WHITE = new THREE.Color(1, 1, 1);

// t in [0, 1] -> 1 down to 0, smoothstep eased
function fadeEnvelope(t) {
    return 1 - t * t * (3 - 2 * t);
}

// A square tube: an annulus in XY - four trapezoids between an outer and an
// inner square, mitered at the corners - extruded along z into a length of
// square pipe. Wound so every face points out of the solid, since the
// material draws front faces only: an additive back face showing through the
// front one would double the brightness wherever the tube overlaps itself.
function squareBandGeometry(halfExtent, thickness, depth) {
    const inner = halfExtent - thickness;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const front = depth / 2;
    const back = -depth / 2;

    // 0-3 outer front, 4-7 inner front, 8-11 outer back, 12-15 inner back
    const positions = [];
    for (const z of [front, back]) {
        for (const [sx, sy] of corners) positions.push(sx * halfExtent, sy * halfExtent, z);
        for (const [sx, sy] of corners) positions.push(sx * inner, sy * inner, z);
    }

    const O_F = 0, I_F = 4, O_B = 8, I_B = 12;
    const indices = [];
    for (let s = 0; s < 4; s++) {
        const n = (s + 1) % 4;

        // the two end caps, facing +z and -z
        indices.push(O_F + s, O_F + n, I_F + n, O_F + s, I_F + n, I_F + s);
        indices.push(O_B + s, I_B + n, O_B + n, O_B + s, I_B + s, I_B + n);

        // the outer wall, facing away from the axis...
        indices.push(O_F + s, O_B + s, O_B + n, O_F + s, O_B + n, O_F + n);
        // ...and the inner one, facing back toward it
        indices.push(I_F + s, I_B + n, I_B + s, I_F + s, I_F + n, I_B + n);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    return geometry;
}

export default class BreadcrumbPlacementCue {
    constructor() {
        this.group = new THREE.Group();
        this.group.visible = false;
        // nothing else in the scene is this small and this short-lived;
        // culling it per frame costs more than drawing it
        this.group.frustumCulled = false;

        this.geometry = squareBandGeometry(HALF_EXTENT, THICKNESS, DEPTH);
        this.bands = [];
        for (let i = 0; i < BAND_COUNT; i++) {
            const material = new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 0,
                depthWrite: false,
                // front faces only - see squareBandGeometry's winding
                side: THREE.FrontSide,
                blending: THREE.AdditiveBlending,
            });
            const band = new THREE.Mesh(this.geometry, material);
            band.visible = false;
            band.frustumCulled = false;
            this.bands.push(band);
            this.group.add(band);
        }

        // the marker the current cue belongs to, or null between cues
        this.breadcrumb = null;
        this._t = 0;
        this._color = new THREE.Color();
        // fixed for the length of a cue - see _spawnOffsetFor
        this._spawn = SPAWN_OFFSET_TOWARD;
        this._facing = new THREE.Vector3();
        this._toViewer = new THREE.Vector3();
        this._markerPos = new THREE.Vector3();
        this._markerQuat = new THREE.Quaternion();
    }

    addTo(scene) {
        scene.add(this.group);
    }

    get isPlaying() {
        return this.breadcrumb !== null;
    }

    // Starts the cue on `breadcrumb`, in its color. Calling it again
    // restarts from the top rather than carrying on, which is what the
    // double-click re-aim wants: the reversal plays in full.
    //
    // `viewerPos` is where the player is watching from. It only decides how
    // far back the bands launch (see _spawnOffsetFor); leaving it out assumes
    // the marker faces the player, which is the setting's default but no
    // longer a safe guess, so every caller passes one.
    start(breadcrumb, viewerPos = null) {
        if (breadcrumb == null) return;

        this.breadcrumb = breadcrumb;
        this._t = 0;
        this._spawn = this._spawnOffsetFor(breadcrumb, viewerPos);

        const source = breadcrumb.userData.originalMaterial ?? breadcrumb.userData.mesh?.material;
        this._color.copy(source?.color ?? WHITE).lerp(WHITE, WHITENESS);
        for (const band of this.bands) band.material.color.copy(this._color);

        this.group.visible = true;
        this._apply();
    }

    // Ends the cue if it is running for this breadcrumb - called when one is
    // picked up mid-cue, so its bands don't outlive it. Any other breadcrumb
    // (or none) leaves a running cue alone.
    cancel(breadcrumb) {
        if (breadcrumb != null && breadcrumb !== this.breadcrumb) return;
        this.stop();
    }

    stop() {
        this.breadcrumb = null;
        this.group.visible = false;
        for (const band of this.bands) band.visible = false;
    }

    update(dt) {
        if (!this.isPlaying) return;

        this._t += dt;
        if (this._t >= CUE_SECONDS) {
            this.stop();
            return;
        }
        this._apply();
    }

    // Which launch point this cue gets, decided once at the start: a marker
    // the player walks around mid-cue shouldn't have its bands jump.
    _spawnOffsetFor(breadcrumb, viewerPos) {
        if (viewerPos == null) return SPAWN_OFFSET_TOWARD;

        breadcrumb.getWorldQuaternion(this._markerQuat);
        breadcrumb.getWorldPosition(this._markerPos);
        this._facing.set(0, 0, 1).applyQuaternion(this._markerQuat);
        this._toViewer.subVectors(viewerPos, this._markerPos);

        return this._facing.dot(this._toViewer) > 0
            ? SPAWN_OFFSET_TOWARD
            : SPAWN_OFFSET_AWAY;
    }

    // how far along its own flight a band has travelled, in world units: a
    // constant-speed part plus a constant-acceleration one, together covering
    // exactly TRAVEL over the flight
    _distance(progress) {
        return TRAVEL * (INITIAL_SHARE * progress
            + (1 - INITIAL_SHARE) * progress * progress);
    }

    _apply() {
        // the marker's own world transform, so +Z is its facing axis; its
        // scale is deliberately left behind (see the file comment)
        this.breadcrumb.updateWorldMatrix(true, false);
        this.breadcrumb.getWorldPosition(this.group.position);
        this.breadcrumb.getWorldQuaternion(this.group.quaternion);

        const progress = this._t / CUE_SECONDS;
        const visible = progress >= 0 && progress < 1;
        const distance = this._distance(progress);
        const opacity = BAND_INTENSITY * (progress < FADE_START
            ? 1
            : fadeEnvelope((progress - FADE_START) / (1 - FADE_START)));

        for (let i = 0; i < this.bands.length; i++) {
            const band = this.bands[i];
            band.visible = visible;
            // bands[0] leads; the rest trail it by a fixed gap, back past the
            // marker's tail, and the whole train moves as one
            band.position.z = this._spawn - i * BAND_SPACING + distance;
            band.material.opacity = opacity;
        }
    }
}
