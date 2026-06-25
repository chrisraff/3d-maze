import * as THREE from 'three';
import sampleUniformSphere from './sampleUniformSphere.js';

/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

export default class GoalDotEffect {

    constructor(opts = {}) {
        const o = Object.assign({
            count:    20,
            map:      null,
            sizes:    [0.25, 0.1],
            sizesVR:  [0.3,  0.125],
        }, opts);

        this._count   = o.count;
        this._sizes   = o.sizes;
        this._sizesVR = o.sizesVR;
        this._isVR    = false;

        this._finished     = false;
        this._rotationAnim = 0;
        this._time         = 0;

        const total    = o.count * 2;
        this._total    = total;

        // Stores per-instance size variation (0.85–1.15) so setVR can rescale
        this._a_sizeVariation = new Float32Array(total).fill(1.0);

        // Per-instance attribute buffers
        const a_initialPos  = new Float32Array(total * 3);
        const a_size        = new Float32Array(total);
        const a_speed       = new Float32Array(total);
        const a_axisAngle   = new Float32Array(total);
        const a_color       = new Float32Array(total * 3);

        const plane    = new THREE.PlaneGeometry(1, 1);
        this._geom = new THREE.InstancedBufferGeometry();
        THREE.BufferGeometry.prototype.copy.call(this._geom, plane);
        this._geom.instanceCount = total;

        this._geom.setAttribute('a_initialPos',  new THREE.InstancedBufferAttribute(a_initialPos,  3));
        this._geom.setAttribute('a_size',        new THREE.InstancedBufferAttribute(a_size,        1));
        this._geom.setAttribute('a_speed',       new THREE.InstancedBufferAttribute(a_speed,       1));
        this._geom.setAttribute('a_axisAngle',   new THREE.InstancedBufferAttribute(a_axisAngle,   1));
        this._geom.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(a_color,       3));

        this._material = new THREE.ShaderMaterial({
            uniforms: {
                map:    { value: o.map },
                u_time: { value: 0     },
            },
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>

                attribute vec3  a_initialPos;
                attribute float a_size;
                attribute float a_speed;
                attribute float a_axisAngle;
                attribute vec3  instanceColor;

                uniform float u_time;

                varying vec2 vUv;
                varying vec3 vColor;

                void main() {
                    vUv    = uv;
                    vColor = instanceColor;

                    // Rotation axis parameterised by a single tilt angle
                    vec3 axis = normalize( vec3( cos( a_axisAngle ), sin( a_axisAngle ), 0.5 ) );

                    // Rodrigues rotation of the initial position
                    float theta = a_speed * u_time;
                    float c     = cos( theta );
                    float s     = sin( theta );
                    vec3 localPos = a_initialPos * c
                                  + cross( axis, a_initialPos ) * s
                                  + axis * dot( axis, a_initialPos ) * ( 1.0 - c );

                    vec4 worldCenter = modelMatrix * vec4( localPos, 1.0 );

                    // Viewpoint-oriented billboard
                    vec3 toCamera = normalize( cameraPosition - worldCenter.xyz );
                    vec3 right    = normalize( cross( vec3( 0.0, 1.0, 0.0 ), toCamera ) );
                    vec3 up       = cross( toCamera, right );

                    vec3 worldPos = worldCenter.xyz
                                  + right * position.x * a_size
                                  + up    * position.y * a_size;

                    gl_Position = projectionMatrix * viewMatrix * vec4( worldPos, 1.0 );
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <common>
                #include <logdepthbuf_pars_fragment>

                uniform sampler2D map;

                varying vec2 vUv;
                varying vec3 vColor;

                void main() {
                    vec4 texel = texture2D( map, vUv );
                    if ( texel.a < 0.8 ) discard;
                    gl_FragColor = vec4( vColor * texel.rgb, texel.a );
                    #include <logdepthbuf_fragment>
                }
            `,
            transparent: true,
            depthWrite:  true,
        });

        const mesh = new THREE.Mesh(this._geom, this._material);
        mesh.frustumCulled = false;

        this.object = new THREE.Group();
        this.object.add(mesh);
    }

    addTo(parent) {
        parent.add(this.object);
    }

    setPosition(pos) {
        this.object.position.copy(pos);
    }

    randomize() {
        this._finished     = false;
        this._rotationAnim = 0;
        this._time         = 0;

        const tmpColor  = new THREE.Color();
        const posAttr   = this._geom.attributes.a_initialPos;
        const sizeAttr  = this._geom.attributes.a_size;
        const speedAttr = this._geom.attributes.a_speed;
        const axisAttr  = this._geom.attributes.a_axisAngle;
        const colAttr   = this._geom.attributes.instanceColor;
        const sizes     = this._isVR ? this._sizesVR : this._sizes;

        for (let k = 0; k < this._total; k++) {
            const tier      = k < this._count ? 0 : 1;
            const variation = 0.8 + Math.random() * 0.4;
            this._a_sizeVariation[k] = variation;
            sizeAttr.array[k]  = sizes[tier] * variation;
            speedAttr.array[k] = (2.0 + Math.random() * 1.0) * (tier === 0 ? 1 : 1.5);
            axisAttr.array[k]  = Math.PI * (0.45 + Math.random() * 0.1 + (tier * 0.25));

            const p = sampleUniformSphere();
            posAttr.array[k * 3]     = p[0];
            posAttr.array[k * 3 + 1] = p[1];
            posAttr.array[k * 3 + 2] = p[2];

            tmpColor.setHSL(Math.random(), 1.0, 0.85);
            colAttr.array[k * 3]     = tmpColor.r;
            colAttr.array[k * 3 + 1] = tmpColor.g;
            colAttr.array[k * 3 + 2] = tmpColor.b;
        }

        posAttr.needsUpdate   = true;
        sizeAttr.needsUpdate  = true;
        speedAttr.needsUpdate = true;
        axisAttr.needsUpdate  = true;
        colAttr.needsUpdate   = true;
    }

    finish() {
        this._finished = true;
    }

    update(dt) {
        if (this._finished && this._rotationAnim < 1) {
            this._rotationAnim = Math.min(this._rotationAnim + dt * 2, 1);
        }
        this._time += dt * (0.1 + this._rotationAnim * 0.9);
        this._material.uniforms.u_time.value = this._time;
    }

    setVR(isVR) {
        this._isVR = isVR;
        const sizes    = isVR ? this._sizesVR : this._sizes;
        const sizeAttr = this._geom.attributes.a_size;
        for (let k = 0; k < this._total; k++) {
            const tier = k < this._count ? 0 : 1;
            sizeAttr.array[k] = sizes[tier] * this._a_sizeVariation[k];
        }
        sizeAttr.needsUpdate = true;
    }

    dispose() {
        this._geom.dispose();
        this._material.dispose();
        if (this.object.parent) this.object.parent.remove(this.object);
        this.object = null;
    }

}
