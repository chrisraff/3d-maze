import * as THREE from 'three';

/**
 * Fresnel glow, drawn on the inside of a sphere. Shared by the breadcrumbs and
 * by the intro fly-around's start marker.
 *
 * `uFalloff` shapes how fast the brightness drops off toward the silhouette.
 * At the default 1.0 it is nearly flat across the disc, which is what the
 * breadcrumbs want - their arrow mesh occludes the bright middle, leaving the
 * ring around it. A marker with nothing inside it to hide behind needs a much
 * steeper value or it reads as a solid ball rather than a glow.
 *
 * Each call returns its own material: the uniforms are animated per instance.
 */
export default function createGlowMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uAlpha: { value: 0.0 },
            uFalloff: { value: 1.0 },
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vLook;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 worldPosition = modelViewMatrix * vec4(position, 1.0);
                vLook = normalize(worldPosition.xyz);
                gl_Position = projectionMatrix * worldPosition;
            }
        `,
        fragmentShader: `
            uniform float uAlpha;
            uniform float uFalloff;
            varying vec3 vNormal;
            varying vec3 vLook;
            void main() {
                float intensity = pow(max(dot(vNormal, vLook), 0.0), uFalloff);
                gl_FragColor = vec4(1.0, 1.0, 1.0, intensity * uAlpha);
            }
        `,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
    });
}
