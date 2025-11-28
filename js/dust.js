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
            color: 0xffffff,
            spawnRadius: 20,
            map: null,
            size: 0.1,
            colorSampler: () => THREE.Color(1,1,1)
        }, opts);

        this.count = o.count;
        this.colorSampler = o.colorSampler;

        this._geometry = new THREE.BufferGeometry();

        // Attribute arrays
        this._positions = new Float32Array(this.count * 3);
        this._spawnTime = new Float32Array(this.count);
        this._lifeTime = new Float32Array(this.count);
        this._direction = new Float32Array(this.count * 3);
        this._colors = new Float32Array(this.count * 3);

        for (let i = 0; i < this.count; i++) {
            this._positions[i*3+0] = 0;
            this._positions[i*3+1] = 0;
            this._positions[i*3+2] = 0;

            this._spawnTime[i] = 0;
            this._lifeTime[i] = 1;
            this._direction[i*3+0] = 0;
            this._direction[i*3+1] = 0;
            this._direction[i*3+2] = 0;

            this._colors[i*3+0] = ((o.color >> 16) & 0xff) / 255;
            this._colors[i*3+1] = ((o.color >> 8) & 0xff) / 255;
            this._colors[i*3+2] = (o.color & 0xff) / 255;
        }

        this._geometry.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
        this._geometry.setAttribute("spawnTime", new THREE.BufferAttribute(this._spawnTime, 1));
        this._geometry.setAttribute("lifeTime", new THREE.BufferAttribute(this._lifeTime, 1));
        this._geometry.setAttribute("direction", new THREE.BufferAttribute(this._direction, 3));
        this._geometry.setAttribute("color", new THREE.BufferAttribute(this._colors, 3));

        this._material = new THREE.PointsMaterial({
            transparent: true,
            size: o.size,
            map: o.map,
            alphaTest: 0.8,
            depthWrite: false,
            vertexColors: true
        });
        this._material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, {
                u_time: { value: 0 },
                u_spawnRadius: { value: o.spawnRadius },
                u_fadeIn: { value: 0.2 },
                u_fadeOut: { value: 0.8 },
            });
            shader.vertexShader = shader.vertexShader.replace('#include <common>', `
                #include <common>
                uniform float u_time;
                uniform float u_spawnRadius;

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
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <map_fragment>', `
                    #include <map_fragment>
                    #ifdef USE_MAP
                    diffuseColor.a *= texture2D(map, vUv).a;
                    #endif
                `)
                .replace('#include <premultiplied_alpha_fragment>', `
                    #include <premultiplied_alpha_fragment>
                    gl_FragColor = vec4(outgoingLight, diffuseColor.a);
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
        this.followed = object
    }

    // Update must be called each frame with deltaSeconds
    update(dt) {
        if (!this._shader) return;
        this._shader.uniforms.u_time.value += dt;

        const t = this._shader.uniforms.u_time.value;

        for (let i = 0; i < this.count; i++) {
            const age = t - this._spawnTime[i];
            if (age > this._lifeTime[i]) {
                this.respawnParticle(i);
            }
        }
    }

    respawnParticle(i) {
        const r = this._shader.uniforms.u_spawnRadius.value;

        const spawnPos = sampleUniformSphere();
        this._positions[i*3+0] = this.followed.position.x + spawnPos[0] * r;
        this._positions[i*3+1] = this.followed.position.y + spawnPos[1] * r;
        this._positions[i*3+2] = this.followed.position.z + spawnPos[2] * r;

        this._direction[i*3+0] = (Math.random() * 2 - 1) * 0.1;
        this._direction[i*3+1] = (Math.random() * 2 - 1) * 0.1;
        this._direction[i*3+2] = (Math.random() * 2 - 1) * 0.1;

        this._spawnTime[i] = this._shader.uniforms.u_time.value;
        this._lifeTime[i] = 2.0 + Math.random() * 3.0;

        // Color from sampler
        const color = this.colorSampler(this._positions[i*3+0], this._positions[i*3+1], this._positions[i*3+2]);
        this._colors[i*3+0] = color.r;
        this._colors[i*3+1] = color.g;
        this._colors[i*3+2] = color.b;

        this._geometry.attributes.position.needsUpdate = true;
        this._geometry.attributes.spawnTime.needsUpdate = true;
        this._geometry.attributes.lifeTime.needsUpdate = true;
        this._geometry.attributes.direction.needsUpdate = true;
        this._geometry.attributes.color.needsUpdate = true;
    }

    respawnAllParticles() {
        for (let i = 0; i < this.count; i++) {
            this.respawnParticle(i);
            this._spawnTime[i] -= Math.random() * this._lifeTime[i];
        }
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
