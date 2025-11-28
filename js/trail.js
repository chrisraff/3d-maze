import * as THREE from 'three';
import * as maze from './maze.js';
import sampleUniformSphere from './sampleUniformSphere.js';

/**
 * TrailEffect
 * @author Chris Raff / http://www.ChrisRaff.com/
 * Drop-in Three.js Trail Effect
 *
 * Usage (ESM):
 * import TrailEffect from './trail.js';
 * const trail = new TrailEffect({
 *   count: 800,                // number of particles
 *   map: particleTexture,      // optional sprite texture
 *   size: 0.1,                 // base point size
 *   collisionDistance: 0.5     // spawn distance threshold
 * });
 * trail.addTo(scene);
 * trail.followObject(camera); // make trail spawn from camera or any Object3D
 * In your render loop: trail.update(deltaSeconds);
 */

export default class TrailEffect {
    constructor(opts = {}) {
        const o = Object.assign({
            count: 800,
            map: null,
            size: 0.1,
            collisionDistance: 0.5
        }, opts);

        this.count = o.count;
        this.collisionDistance = o.collisionDistance;

        this.lastTrailCameraPosition = new THREE.Vector3();

        this._nextSpawnIndex = 0;

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

            this._direction[i*3+0] = 0;
            this._direction[i*3+1] = 0;
            this._direction[i*3+2] = 0;
        }

        this._geometry.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
        this._geometry.setAttribute("spawnTime", new THREE.BufferAttribute(this._spawnTime, 1));
        this._geometry.setAttribute("direction", new THREE.BufferAttribute(this._direction, 3));
        this._geometry.setAttribute("color", new THREE.BufferAttribute(this._colors, 3));

        this._material = new THREE.PointsMaterial({
            transparent: true,
            size: o.size,
            map: o.map,
            alphaTest: 0.8,
            vertexColors: true,
            sizeAttenuation: false,
        });
        this._material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, {
                u_time: { value: 0 }
            });
            shader.vertexShader = shader.vertexShader.replace('#include <common>', `
                #include <common>
                uniform float u_time;

                attribute float spawnTime;
                attribute vec3 direction;

                varying float v_alpha;
            `).replace('#include <begin_vertex>', `
                // compute particle age and move the vertex by direction * age
                float age = u_time - spawnTime;

                vec3 transformed = position + direction * age;

                // Distance-based fade: compute world position and distance to camera
                vec3 worldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
                float dist = length(worldPos - cameraPosition);
                float distFade = clamp(dist*3.0 - 0.25, 0.0, 1.0);
                v_alpha = distFade;
            `).replace('gl_PointSize = size;', `
                // Compute size over lifetime
                float subtraction = size * 0.1;
                gl_PointSize = clamp(size - age * subtraction, 0.0, size);
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

    // the object to spawn trail from, likely a camera
    followObject(object) {
        this.followed = object;
        this.lastTrailCameraPosition.copy( object.position );
    }

    // Update must be called each frame with deltaSeconds
    update(dt) {
        if (!this._shader) return;
        this._shader.uniforms.u_time.value += dt;

        // spawn new
        if ( this.lastTrailCameraPosition.distanceToSquared( this.followed.position ) > this.collisionDistance**2 ) {
            this.lastTrailCameraPosition.copy( this.followed.position );

            const tmpVector = new THREE.Vector3( Math.random() * this.collisionDistance * 2 - this.collisionDistance, Math.random() * this.collisionDistance * 2 - this.collisionDistance, -maze.minorWidth );
            tmpVector.applyMatrix4( this.followed.matrix );

            this._positions[this._nextSpawnIndex*3+0] = tmpVector.x;
            this._positions[this._nextSpawnIndex*3+1] = tmpVector.y;
            this._positions[this._nextSpawnIndex*3+2] = tmpVector.z;

            this._spawnTime[this._nextSpawnIndex] = this._shader.uniforms.u_time.value;
    
            const motion = sampleUniformSphere();
            this._direction[this._nextSpawnIndex*3+0] = motion[0] * 0.02;
            this._direction[this._nextSpawnIndex*3+1] = motion[1] * 0.02;
            this._direction[this._nextSpawnIndex*3+2] = motion[2] * 0.02;

            const tmpColor = new THREE.Color( `hsl(${Math.random() * 360}, 100%, 50%)` );
            this._colors[this._nextSpawnIndex*3+0] = tmpColor.r;
            this._colors[this._nextSpawnIndex*3+1] = tmpColor.g;
            this._colors[this._nextSpawnIndex*3+2] = tmpColor.b;
    
            this._nextSpawnIndex = ( this._nextSpawnIndex + 1 ) % this.count;
            this._geometry.attributes.position.needsUpdate = true;
            this._geometry.attributes.spawnTime.needsUpdate = true;
            this._geometry.attributes.direction.needsUpdate = true;
            this._geometry.attributes.color.needsUpdate = true;
        }
    }

    reset() {
        this._nextSpawnIndex = 0;
        for (let i = 0; i < this.count; i++) {
            this._spawnTime[i] = -10.0;
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
