import * as THREE from 'three';
import sampleUniformSphere from './sampleUniformSphere.js';

/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 * Drop-in Three.js Dust Effect
 * Usage (ESM):
 * import DustEffect from './dust.js';
 * const dust = new DustEffect({ count:1000 });
 * dust.addTo(scene);
 * dust.followObject(camera); // optional: make dust follow camera
 * In your render loop: dust.update(deltaSeconds);
 */

export default class DustEffect {
    constructor(opts = {}) {
        const o = Object.assign({
            count: 800,
            color: new THREE.Color(0.4, 0.4, 0.4),
            spawnRadius: 20,
            map: null,
            size: 0.1
        }, opts);

        this.count = o.count;

        this.radius = o.spawnRadius;
        this.t = 0;
        this._dirty = false;

        // last frame's follow position, so we know which way it moved
        this._lastFollow = new THREE.Vector3();
        this._travel = new THREE.Vector3();

        this._geometry = new THREE.BufferGeometry();

        // Attribute arrays
        this._positions = new Float32Array(this.count * 3);
        this._spawnTime = new Float32Array(this.count);
        this._lifeTime = new Float32Array(this.count);
        this._direction = new Float32Array(this.count * 3);

        for (let i = 0; i < this.count; i++) {
            this._positions[i*3+0] = 0;
            this._positions[i*3+1] = 0;
            this._positions[i*3+2] = 0;

            this._spawnTime[i] = 0;
            this._lifeTime[i] = 1;
            this._direction[i*3+0] = 0;
            this._direction[i*3+1] = 0;
            this._direction[i*3+2] = 0;
        }

        this._geometry.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
        this._geometry.setAttribute("spawnTime", new THREE.BufferAttribute(this._spawnTime, 1));
        this._geometry.setAttribute("lifeTime", new THREE.BufferAttribute(this._lifeTime, 1));
        this._geometry.setAttribute("direction", new THREE.BufferAttribute(this._direction, 3));

        this._material = new THREE.PointsMaterial({
            transparent: true,
            size: o.size,
            map: o.map,
            alphaTest: 0.8,
            depthWrite: false,
            color: o.color,
            blending: THREE.AdditiveBlending
        });
        this._material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, {
                u_time: { value: 0 },
                u_fadeIn: { value: 0.2 },
                u_fadeOut: { value: 0.8 },
            });
            shader.vertexShader = shader.vertexShader.replace('#include <common>', `
                #include <common>
                uniform float u_time;

                uniform float u_fadeIn;
                uniform float u_fadeOut;

                attribute float spawnTime;
                attribute float lifeTime;
                attribute float startSize;
                attribute float endSize;
                attribute vec3 direction;

                varying float v_alpha;
            `).replace('#include <begin_vertex>', `
                // compute particle age and move the vertex by direction * age
                float age = u_time - spawnTime;
                float t = clamp(age / lifeTime, 0.0, 1.0);

                vec3 transformed = position + direction * age;

                // Fade in & out
                float fadeInStage = smoothstep(0.0, u_fadeIn, t);
                float fadeOutStage = 1.0 - smoothstep(u_fadeOut, 1.0, t);
                v_alpha = fadeInStage * fadeOutStage;

                // Distance-based fade: compute world position and distance to camera
                vec3 worldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
                float dist = length(worldPos - cameraPosition);
                float distFade = clamp(dist - 0.5, 0.0, 1.0);
                v_alpha *= distFade;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
                #include <common>
                varying float v_alpha;
            `).replace('#include <premultiplied_alpha_fragment>', `
                #include <premultiplied_alpha_fragment>
                gl_FragColor = vec4( outgoingLight, diffuseColor.a * v_alpha );
            `);
            this._shader = shader;
        }

        this.object = new THREE.Points(this._geometry, this._material);
        // Particles are always "at 0,0,0" since they are an effect,
        // so disable frustum culling
        this.object.frustumCulled = false;
    }

    // Adds the particle system to a scene or an object3D
    addTo(parent) {
        parent.add(this.object);
        this.parent = parent;
    }

    // the object to spawn dust around, likely a camera
    followObject(object) {
        this.followed = object;
        // adopt its position, so swapping targets doesn't read as movement
        this._lastFollow.copy(object.position);
    }

    // Update must be called each frame with deltaSeconds
    update(dt) {
        if (!this._shader) return;
        this._shader.uniforms.u_time.value += dt;

        this.t = this._shader.uniforms.u_time.value;

        const follow = this.followed.position;
        const radiusSq = this.radius * this.radius;

        // how far and which way the cloud's centre moved this frame
        this._travel.subVectors(follow, this._lastFollow);
        const travelled = this._travel.length();
        const moving = travelled > 1e-6;
        if (moving) this._travel.multiplyScalar(1 / travelled);
        this._lastFollow.copy(follow);

        for (let i = 0; i < this.count; i++) {
            const age = this.t - this._spawnTime[i];
            if (age > this._lifeTime[i]) {
                this.respawnParticle(i);
                continue;
            }

            // recycle whatever the target outran, or the space ahead empties
            // (spawn position, not the drifted one the shader renders)
            const dx = this._positions[i*3+0] - follow.x;
            const dy = this._positions[i*3+1] - follow.y;
            const dz = this._positions[i*3+2] - follow.z;
            const distSq = dx*dx + dy*dy + dz*dz;

            if (distSq > radiusSq)
                this._recycleAcross(i, dx, dy, dz, moving);
        }

        this._flushAttributes();
    }

    // Re-enters an outrun particle at the far end of its own chord, keeping its
    // distance from the axis of travel - rescaling the whole offset vector
    // instead shrinks that every wrap and the cloud collapses inward.
    _recycleAcross(i, dx, dy, dz, moving) {
        if (!moving) {
            // no direction of travel to re-enter along
            this.respawnParticle(i);
            return;
        }

        const travel = this._travel;
        const along = dx * travel.x + dy * travel.y + dz * travel.z;
        if (along > 0) {
            // drifted out the front rather than being outrun
            this.respawnParticle(i);
            return;
        }

        const px = dx - along * travel.x;
        const py = dy - along * travel.y;
        const pz = dz - along * travel.z;

        const halfChordSq = this.radius * this.radius - (px*px + py*py + pz*pz);
        if (halfChordSq <= 0) {
            // grazing the rim; no chord worth re-entering along
            this.respawnParticle(i);
            return;
        }

        const halfChord = Math.sqrt(halfChordSq);

        // wrap by the overshoot rather than pinning to the edge, which would
        // stack recycled particles into a hollow shell at speed
        const alongNew = 2 * halfChord + along;
        if (alongNew < -halfChord) {
            // overshot the whole chord in one frame
            this.respawnParticle(i);
            return;
        }

        const follow = this.followed.position;
        this._placeParticle(i,
            follow.x + px + travel.x * alongNew,
            follow.y + py + travel.y * alongNew,
            follow.z + pz + travel.z * alongNew);
    }

    respawnParticle(i) {
        const r = this.radius;
        const follow = this.followed.position;
        const spawnPos = sampleUniformSphere();

        this._placeParticle(i,
            follow.x + spawnPos[0] * r,
            follow.y + spawnPos[1] * r,
            follow.z + spawnPos[2] * r);
    }

    // resetting spawnTime restarts the fade-in, so a recycled particle eases in
    // rather than popping
    _placeParticle(i, x, y, z) {
        this._positions[i*3+0] = x;
        this._positions[i*3+1] = y;
        this._positions[i*3+2] = z;

        this._direction[i*3+0] = (Math.random() * 2 - 1) * 0.1;
        this._direction[i*3+1] = (Math.random() * 2 - 1) * 0.1;
        this._direction[i*3+2] = (Math.random() * 2 - 1) * 0.1;

        this._spawnTime[i] = this.t;
        this._lifeTime[i] = 2.0 + Math.random() * 3.0;

        this._dirty = true;
    }

    // one upload per frame at most
    _flushAttributes() {
        if (!this._dirty) return;

        this._geometry.attributes.position.needsUpdate = true;
        this._geometry.attributes.spawnTime.needsUpdate = true;
        this._geometry.attributes.lifeTime.needsUpdate = true;
        this._geometry.attributes.direction.needsUpdate = true;

        this._dirty = false;
    }

    respawnAllParticles() {
        this._lastFollow.copy(this.followed.position);
        for (let i = 0; i < this.count; i++) {
            this.respawnParticle(i);
            this._spawnTime[i] -= Math.random() * this._lifeTime[i];
        }
        this._flushAttributes();
    }

    // Dispose geometry, textures, material
    dispose() {
        if (this._geometry) {
            this._geometry.dispose();
            this._geometry = null;
        }
        if (this._material) {
            this._material.dispose();
            this._material = null;
        }
        if (this.object && this.object.parent) {
            this.object.parent.remove(this.object);
        }
        this.object = null;
    }
}
