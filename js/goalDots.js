import * as THREE from 'three';
import sampleUniformSphere from './sampleUniformSphere.js';

/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

export default class GoalDotEffect {

    constructor(opts = {}) {
        const o = Object.assign({
            count: 20,
            map: null,
            sizes: [0.25, 0.1],
            sizesVR: [0.3, 0.125],
        }, opts);

        this._count = o.count;
        this._sizes = o.sizes;
        this._sizesVR = o.sizesVR;
        this._finished = false;
        this._rotationAnim = 0;

        this._tmpQuat  = new THREE.Quaternion();
        this._tmpMat   = new THREE.Matrix4();
        this._tmpColor = new THREE.Color();

        this._rotationAxes = [
            new THREE.Vector3(0.75, 0, 0.5).normalize(),
            new THREE.Vector3(0.75, 1, 0.5).normalize(),
        ];

        this._planeGeom = new THREE.PlaneGeometry(1, 1);
        this._materials = o.sizes.map(size => this._makeMaterial(size, o.map));

        this.object = new THREE.Group();
        for (let i = 0; i < 2; i++) {
            const mesh = new THREE.InstancedMesh(this._planeGeom, this._materials[i], o.count);
            mesh.frustumCulled = false;
            this.object.add(mesh);
        }
    }

    _makeMaterial(size, sprite) {
        return new THREE.ShaderMaterial({
            uniforms: {
                map:    { value: sprite },
                u_size: { value: size },
            },
            vertexShader: `
                #include <common>
                #include <color_pars_vertex>
                #include <logdepthbuf_pars_vertex>

                uniform float u_size;
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    #include <color_vertex>

                    #ifdef USE_INSTANCING
                        vec4 worldCenter = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
                    #else
                        vec4 worldCenter = modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
                    #endif

                    vec3 toCamera = normalize( cameraPosition - worldCenter.xyz );
                    vec3 right    = normalize( cross( vec3( 0.0, 1.0, 0.0 ), toCamera ) );
                    vec3 up       = cross( toCamera, right );

                    vec3 worldPos = worldCenter.xyz
                                  + right * position.x * u_size
                                  + up    * position.y * u_size;

                    gl_Position = projectionMatrix * viewMatrix * vec4( worldPos, 1.0 );
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <common>
                #include <color_pars_fragment>
                #include <logdepthbuf_pars_fragment>

                uniform sampler2D map;
                varying vec2 vUv;

                void main() {
                    vec4 texel = texture2D( map, vUv );
                    if ( texel.a < 0.8 ) discard;
                    gl_FragColor = vec4( vColor * texel.rgb, texel.a );
                    #include <logdepthbuf_fragment>
                }
            `,
            transparent: true,
            depthWrite: true,
        });
    }

    addTo(parent) {
        parent.add(this.object);
    }

    setPosition(pos) {
        this.object.position.copy(pos);
    }

    randomize() {
        this._finished = false;
        this._rotationAnim = 0;
        for (let i = 0; i < this.object.children.length; i++) {
            const mesh = this.object.children[i];
            for (let k = 0; k < this._count; k++) {
                this._tmpColor.setHSL(Math.random(), 1.0, 0.75);
                mesh.setColorAt(k, this._tmpColor);
                const p = sampleUniformSphere();
                this._tmpMat.makeTranslation(p[0], p[1], p[2]);
                mesh.setMatrixAt(k, this._tmpMat);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor.needsUpdate = true;
        }
    }

    finish() {
        this._finished = true;
    }

    update(dt) {
        if (this._finished && this._rotationAnim < 1) {
            this._rotationAnim = Math.min(this._rotationAnim + dt * 2, 1);
        }
        for (let i = 0; i < this.object.children.length; i++) {
            const mesh = this.object.children[i];
            this._tmpQuat.setFromAxisAngle(
                this._rotationAxes[i],
                (2.2 + i * 0.4) * dt * (0.1 + this._rotationAnim * 0.9)
            );
            mesh.applyQuaternion(this._tmpQuat);
        }
    }

    setVR(isVR) {
        const sizes = isVR ? this._sizesVR : this._sizes;
        for (let i = 0; i < this._materials.length; i++) {
            this._materials[i].uniforms.u_size.value = sizes[i];
        }
    }

    dispose() {
        this._planeGeom.dispose();
        for (const mat of this._materials) mat.dispose();
        if (this.object.parent) this.object.parent.remove(this.object);
        this.object = null;
    }

}
