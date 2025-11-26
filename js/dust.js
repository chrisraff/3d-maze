import * as THREE from 'three';

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
            color: 0xffffff,
            spawnRadius: 20,
            sizeJitter: 3,     // size randomness TODO
        }, opts);

        this.count = o.count;

        this._geometry = new THREE.BufferGeometry();

        // Attribute arrays
        this._positions = new Float32Array(this.count * 3);
        this._spawnTime = new Float32Array(this.count);
        this._lifeTime = new Float32Array(this.count);
        this._startSize = new Float32Array(this.count);
        this._endSize = new Float32Array(this.count);
        this._direction = new Float32Array(this.count * 3);

        for (let i = 0; i < this.count; i++) {
            this._positions[i*3+0] = 0;
            this._positions[i*3+1] = 0;
            this._positions[i*3+2] = 0;

            this._spawnTime[i] = 0;
            this._lifeTime[i] = 1;
            this._startSize[i] = 2.0;
            this._endSize[i] = 6.0;
            this._direction[i*3+0] = 0;
            this._direction[i*3+1] = 0;
            this._direction[i*3+2] = 0;
        }

        this._geometry.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
        this._geometry.setAttribute("spawnTime", new THREE.BufferAttribute(this._spawnTime, 1));
        this._geometry.setAttribute("lifeTime", new THREE.BufferAttribute(this._lifeTime, 1));
        this._geometry.setAttribute("startSize", new THREE.BufferAttribute(this._startSize, 1));
        this._geometry.setAttribute("endSize", new THREE.BufferAttribute(this._endSize, 1));
        this._geometry.setAttribute("direction", new THREE.BufferAttribute(this._direction, 3));

        this._dustVertexShader = document.querySelector('#dustVertexShader').textContent;
        this._dustFragmentShader = document.querySelector('#dustFragmentShader').textContent;
        this._material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,

            uniforms: {
                u_time: { value: 0 },
                u_spawnRadius: { value: o.spawnRadius },
                u_fadeIn: { value: 0.2 },
                u_fadeOut: { value: 0.8 },
                u_driftSpeed: { value: 0.04 }
            },

            vertexShader: this._dustVertexShader,
            fragmentShader: this._dustFragmentShader
        });

        this.object = new THREE.Points(this._geometry, this._material);
        // Particles are always "at 0,0,0" since they are an effect
        this.object.frustumCulled = false;
    }

    // Adds the particle system to a scene or an object3D
    addTo(parent) {
        parent.add(this.object);
        this.parent = parent;
    }

    // the object to spawn dust around, likely a camera
    followObject(object) {
        this.followed = object
    }

    // Update must be called each frame with deltaSeconds
    update(dt) {
        this._material.uniforms.u_time.value += dt;

        const t = this._material.uniforms.u_time.value;

        for (let i = 0; i < this.count; i++) {
            const age = t - this._spawnTime[i];
            if (age > this._lifeTime[i]) {
                this.respawnParticle(i);
            }
        }
    }

    respawnParticle(i) {
        const r = this._material.uniforms.u_spawnRadius.value;

        this._positions[i*3+0] = this.followed.position.x + (Math.random() * 2 - 1) * r;
        this._positions[i*3+1] = this.followed.position.y + (Math.random() * 2 - 1) * r * 0.3; // more flat vertically
        this._positions[i*3+2] = this.followed.position.z + (Math.random() * 2 - 1) * r;

        this._direction[i*3+0] = (Math.random() * 2 - 1) * 0.1;
        this._direction[i*3+1] = (Math.random() * 2 - 1) * 0.1;
        this._direction[i*3+2] = (Math.random() * 2 - 1) * 0.1;

        this._spawnTime[i] = this._material.uniforms.u_time.value;
        this._lifeTime[i] = 2.0 + Math.random() * 3.0;

        this._startSize[i] = 1 + Math.random() * 2;
        this._endSize[i] = 3 + Math.random() * 4;

        this._geometry.attributes.position.needsUpdate = true;
        this._geometry.attributes.spawnTime.needsUpdate = true;
        this._geometry.attributes.lifeTime.needsUpdate = true;
        this._geometry.attributes.startSize.needsUpdate = true;
        this._geometry.attributes.endSize.needsUpdate = true;
        this._geometry.attributes.direction.needsUpdate = true;
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
