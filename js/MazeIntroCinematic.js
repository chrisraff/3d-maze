import * as THREE from 'three';
import * as maze from './maze.js';
import createGlowMaterial from './glowMaterial.js';

/**
 * The establishing shot played once, ahead of the intro tutorial's control
 * prompts: pull back off the player's face until the whole maze is in frame,
 * leaving a glow sphere behind on the spot they are standing on, then orbit
 * around to the far corner where the goal dots are waiting.
 *
 * The player's own point light rides along on the shot camera, so the maze is
 * lit from wherever the shot is looking rather than staying lit from the one
 * spot the player happens to be parked on. Camera-centred effects - the dust
 * field - are re-pointed at it for the same reason, and handed back on stop.
 *
 * It runs on its own camera and never touches cameraNode, so the player's
 * position and heading are exactly where they left them when it hands back -
 * game.js renders through `camera` while `isActive` is true and skips the
 * player systems for the duration.
 */

const PULL_OUT_SECONDS = 1.3;
const ORBIT_SECONDS    = 2.2;
// a beat on the whole maze before closing in, so the orbit's last framing
// registers before the camera commits to the exit
const SETTLE_SECONDS   = 1.0;
const PUSH_IN_SECONDS  = 1.2;
// the still beat, once the camera has settled on the dots - the caption is
// already up from the push-in and gets read here, with nothing moving
const HOLD_SECONDS     = 1.0;
const RETURN_SECONDS   = 1.1;

// the orbit starts low, looking up at the near-bottom corner the player
// entered from, and finishes above, looking down at the far-top corner
const START_ELEVATION = THREE.MathUtils.degToRad(-18);
const END_ELEVATION   = THREE.MathUtils.degToRad(30);

// Entrance and exit sit on the maze's body diagonal, so an orbit that ran
// corner to corner would begin and end looking straight down it, flattening
// the cube into a hexagon. Swinging the whole arc off that axis gives both
// ends a three-quarter view instead; aim is unaffected, so the goal dots
// still finish centred.
const AZIMUTH_OFFSET = THREE.MathUtils.degToRad(30);

// Fraction of the frame's narrower axis the maze fills at full pull-out.
// There is less headroom here than it looks: EXIT_AIM_BIAS pushes the maze
// off frame centre, so anything above ~0.90 starts clipping a corner during
// the orbit on square-ish windows.
const FILL = 0.88;
// how far the camera's aim drifts off the maze centre toward the exit as the
// orbit finishes - enough to favour the goal dots without losing the maze
const EXIT_AIM_BIAS = 0.25;

// the goal dots occupy a unit ball plus their own size, whatever the maze size
const EXIT_RADIUS = 1.25;
// fraction of the frame the dot cluster fills once the push-in settles
const EXIT_FILL = 0.6;
// ...but always close at least this much of the gap, so the push reads as a
// push on narrow screens too, where fitting the narrower axis would otherwise
// leave the camera further out than the orbit already was
const EXIT_MIN_CLOSE = 0.4;
// and never closer than this, or the camera ends up inside the cluster
const EXIT_MIN_DISTANCE = 2.5;

const GLOW_ALPHA = 0.9;
// steep, so the marker is a bright core feathering out to nothing rather than
// the flat disc the breadcrumbs' default falloff would give it out here
const GLOW_FALLOFF = 3.0;
const GLOW_RADIUS_CELLS = 0.5;
// The marker sits exactly where the camera starts, so the camera begins the
// shot inside it. Hold the fade off until the pull-out has carried the camera
// clear of the sphere, or the first frames wash out.
const GLOW_FADE_IN_START = 0.35;

const SKIP_EVENTS = ['keydown', 'mousedown', 'touchstart', 'wheel'];

function smoothstep(t) {
    const k = Math.min(Math.max(t, 0), 1);
    return k * k * (3 - 2 * k);
}

export default class MazeIntroCinematic {

    constructor(scene) {
        this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        this.isActive = false;

        scene.add(this.camera);

        this._glowMaterial = createGlowMaterial();
        // the marker sits in the first cell, behind the maze's outer face, so
        // it is drawn through the walls - otherwise it would spend the whole
        // shot hidden inside the box it is meant to be pointing at
        this._glowMaterial.depthTest = false;
        this._glowMaterial.uniforms.uFalloff.value = GLOW_FALLOFF;
        this._glow = new THREE.Mesh(
            new THREE.SphereGeometry(1, 24, 16), this._glowMaterial);
        this._glow.renderOrder = 999;
        this._glow.visible = false;
        scene.add(this._glow);

        this._elapsed = 0;
        this._distance = 0;
        this._onComplete = null;
        this._light = null;
        this._lightParent = null;
        this._followers = [];
        this._followerTargets = [];
        this._phase = null;
        this._onPhase = null;

        this._center        = new THREE.Vector3();
        this._aimStart      = new THREE.Vector3();
        this._aimEnd        = new THREE.Vector3();
        this._fromPos       = new THREE.Vector3();
        this._fromQuat      = new THREE.Quaternion();
        this._establishPos  = new THREE.Vector3();
        this._establishQuat = new THREE.Quaternion();
        this._orbitEndPos   = new THREE.Vector3();
        this._orbitEndQuat  = new THREE.Quaternion();
        this._pushEndPos    = new THREE.Vector3();
        this._pushEndQuat   = new THREE.Quaternion();

        this._tmpPos = new THREE.Vector3();
        this._tmpAim = new THREE.Vector3();
        this._lookMatrix = new THREE.Matrix4();
        this._up = new THREE.Vector3(0, 1, 0);

        this._onSkip = () => this.skip();
    }

    setAspect(aspect) {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }

    /**
     * @param {number} segments - the maze's segment count, as game.js has it
     * @param {THREE.Vector3} endPos - where the goal dots sit, past the far face
     * @param {THREE.Camera} fromCamera - the player camera to take over from
     * @param {THREE.Light} [light] - the player's light, borrowed for the shot
     * @param {Array} [followers] - effects with followObject(), re-pointed at
     *        the shot camera for the duration (the dust field)
     * @param {function} [onPhase] - called with 'pullOut' | 'orbit' | 'settle' |
     *        'pushIn' | 'hold' | 'return' as the shot moves between them
     * @param {boolean} [skippable] - whether player input cuts the shot short
     * @param {function} [onComplete]
     */
    play({ segments, endPos, fromCamera, light = null, followers = [],
           skippable = true, onPhase = null, onComplete = null }) {
        if (this.isActive) this._stop();

        this.camera.fov = fromCamera.fov;
        this.setAspect(fromCamera.aspect);

        // the maze runs from index 0 out to the wall past its last cell
        const extent = maze.getOffset(segments + 1);
        this._center.set(extent / 2, extent / 2, extent / 2);
        this._aimStart.copy(this._center);
        this._aimEnd.lerpVectors(this._center, endPos, EXIT_AIM_BIAS);

        // fit the bounding sphere rather than the projected box, so the
        // framing holds all the way around the orbit instead of breathing
        this._distance = this._fitDistance((extent / 2) * Math.sqrt(3));

        fromCamera.getWorldPosition(this._fromPos);
        fromCamera.getWorldQuaternion(this._fromQuat);

        this._azimuthStart = this._azimuthOf(this._fromPos) + AZIMUTH_OFFSET;
        // half a turn: the player stands at one corner and the exit is at the
        // opposite one, so this sweeps across the face of the maze rather
        // than around behind it
        this._azimuthEnd = this._azimuthStart + Math.PI;

        this._poseAt(this._azimuthStart, START_ELEVATION, this._aimStart,
                     this._establishPos, this._establishQuat);
        this._poseAt(this._azimuthEnd, END_ELEVATION, this._aimEnd,
                     this._orbitEndPos, this._orbitEndQuat);

        // the push-in runs straight down the line from the orbit's last pose to
        // the dots, stopping where the cluster frames up
        this._pushEndPos.subVectors(this._orbitEndPos, endPos);
        const standoff = this._pushEndPos.length();
        const settleAt = Math.max(
            EXIT_MIN_DISTANCE,
            Math.min(this._fitDistance(EXIT_RADIUS, EXIT_FILL),
                     standoff * (1 - EXIT_MIN_CLOSE)));
        this._pushEndPos
            .multiplyScalar(Math.min(settleAt, standoff) / standoff)
            .add(endPos);

        this._lookMatrix.lookAt(this._pushEndPos, endPos, this._up);
        this._pushEndQuat.setFromRotationMatrix(this._lookMatrix);

        this._glow.position.copy(this._fromPos);
        this._glow.scale.setScalar(maze.majorWidth * GLOW_RADIUS_CELLS);
        this._setGlow(0);
        this._glow.visible = true;

        this.camera.position.copy(this._fromPos);
        this.camera.quaternion.copy(this._fromQuat);

        this._light = light;
        if (light !== null) {
            this._lightParent = light.parent;
            this.camera.add(light);
        }

        // an effect that spawns around the player would leave the shot flying
        // through empty space, so point them at the shot camera instead
        this._followers = followers;
        this._followerTargets = followers.map((follower) => follower.followed);
        for (const follower of followers) follower.followObject(this.camera);

        this._elapsed = 0;
        this._phase = null;
        this._onPhase = onPhase;
        this._onComplete = onComplete;
        this.isActive = true;

        if (skippable) {
            for (const name of SKIP_EVENTS)
                document.addEventListener(name, this._onSkip, { passive: true });
        }
    }

    /**
     * Cut straight back to the player's view. Still available to the caller
     * when the shot is unskippable - that only takes away the input listeners.
     */
    skip() {
        if (!this.isActive) return;
        const done = this._onComplete;
        this._stop();
        if (done) done();
    }

    /** @returns {boolean} whether the shot is still running */
    update(delta) {
        if (!this.isActive) return false;

        this._elapsed += delta;
        let t = this._elapsed;

        if (t < PULL_OUT_SECONDS) {
            this._setPhase('pullOut');
            const k = smoothstep(t / PULL_OUT_SECONDS);
            this.camera.position.lerpVectors(this._fromPos, this._establishPos, k);
            this.camera.quaternion.slerpQuaternions(this._fromQuat, this._establishQuat, k);
            this._setGlow((k - GLOW_FADE_IN_START) / (1 - GLOW_FADE_IN_START));
            return true;
        }
        t -= PULL_OUT_SECONDS;

        if (t < ORBIT_SECONDS) {
            this._setPhase('orbit');
            const k = smoothstep(t / ORBIT_SECONDS);
            this._tmpAim.lerpVectors(this._aimStart, this._aimEnd, k);
            this._poseAt(
                THREE.MathUtils.lerp(this._azimuthStart, this._azimuthEnd, k),
                THREE.MathUtils.lerp(START_ELEVATION, END_ELEVATION, k),
                this._tmpAim, this.camera.position, this.camera.quaternion);
            // the marker fades over the back half of the orbit, handing the
            // shot over to the goal dots coming into frame
            this._setGlow(1 - smoothstep((k - 0.5) / 0.5));
            return true;
        }
        t -= ORBIT_SECONDS;

        if (t < SETTLE_SECONDS) {
            this._setPhase('settle');
            this.camera.position.copy(this._orbitEndPos);
            this.camera.quaternion.copy(this._orbitEndQuat);
            this._setGlow(0);
            return true;
        }
        t -= SETTLE_SECONDS;

        // the orbit only brings the exit into frame; closing on it is what
        // actually says "this one"
        if (t < PUSH_IN_SECONDS) {
            this._setPhase('pushIn');
            const k = smoothstep(t / PUSH_IN_SECONDS);
            this.camera.position.lerpVectors(this._orbitEndPos, this._pushEndPos, k);
            this.camera.quaternion.slerpQuaternions(this._orbitEndQuat, this._pushEndQuat, k);
            this._setGlow(0);
            return true;
        }
        t -= PUSH_IN_SECONDS;

        if (t < HOLD_SECONDS) {
            this._setPhase('hold');
            this.camera.position.copy(this._pushEndPos);
            this.camera.quaternion.copy(this._pushEndQuat);
            this._setGlow(0);
            return true;
        }
        t -= HOLD_SECONDS;

        if (t < RETURN_SECONDS) {
            this._setPhase('return');
            const k = smoothstep(t / RETURN_SECONDS);
            this.camera.position.lerpVectors(this._pushEndPos, this._fromPos, k);
            this.camera.quaternion.slerpQuaternions(this._pushEndQuat, this._fromQuat, k);
            this._setGlow(0);
            return true;
        }

        this.skip();
        return false;
    }

    _setPhase(phase) {
        if (this._phase === phase) return;
        this._phase = phase;
        if (this._onPhase !== null) this._onPhase(phase);
    }

    _setGlow(k) {
        this._glowMaterial.uniforms.uAlpha.value =
            Math.min(Math.max(k, 0), 1) * GLOW_ALPHA;
    }

    // camera distance at which a sphere of this radius fits the narrower of
    // the two frustum axes, so portrait phones frame it too
    _fitDistance(radius, fill = FILL) {
        const halfVertical = THREE.MathUtils.degToRad(this.camera.fov) / 2;
        const halfHorizontal = Math.atan(Math.tan(halfVertical) * this.camera.aspect);
        return radius / (Math.sin(Math.min(halfVertical, halfHorizontal)) * fill);
    }

    _azimuthOf(point) {
        return Math.atan2(point.x - this._center.x, point.z - this._center.z);
    }

    _poseAt(azimuth, elevation, aim, outPosition, outQuaternion) {
        const horizontal = Math.cos(elevation) * this._distance;
        this._tmpPos.set(
            this._center.x + Math.sin(azimuth) * horizontal,
            this._center.y + Math.sin(elevation) * this._distance,
            this._center.z + Math.cos(azimuth) * horizontal);

        // Matrix4.lookAt builds the camera convention, -Z toward the target.
        // Object3D.lookAt only does that for objects flagged isCamera/isLight;
        // on a plain Object3D it builds the opposite one, which aims the shot
        // a clean 180 degrees away from the maze.
        this._lookMatrix.lookAt(this._tmpPos, aim, this._up);

        outPosition.copy(this._tmpPos);
        outQuaternion.setFromRotationMatrix(this._lookMatrix);
    }

    _stop() {
        this._followers.forEach((follower, i) => {
            follower.followObject(this._followerTargets[i]);
        });
        this._followers = [];
        this._followerTargets = [];

        if (this._light !== null) {
            // Object3D.add already detaches from the current parent
            if (this._lightParent !== null) this._lightParent.add(this._light);
            else this._light.removeFromParent();
            this._light = null;
            this._lightParent = null;
        }

        this.isActive = false;
        this._onComplete = null;
        this._onPhase = null;
        this._phase = null;
        this._glow.visible = false;
        this._setGlow(0);
        for (const name of SKIP_EVENTS)
            document.removeEventListener(name, this._onSkip);
    }

}
