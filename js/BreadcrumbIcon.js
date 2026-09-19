import * as THREE from 'three';
import iconRenderer from './IconRenderer.js';

/**
 * A still icon of the breadcrumb the player would place next, shown beside
 * the count in the HUD inventory.
 *
 * Breadcrumbs each get a random hue at maze init, so the icon can't be a
 * prebaked asset - but it doesn't need to move either, so it's rendered on
 * demand and cached. Hues are quantised to HUE_STEPS buckets, which is
 * indistinguishable at HUD size and caps the number of renders per session
 * at 32 regardless of how many breadcrumbs a maze contains.
 */

const HUE_STEPS = 32;
// three-quarter view
const VIEW_ROTATION = [0.35, 1.45, 0.0];
const CAMERA_FOV = 30;
// how much of the frame the dart fills; the rest is breathing room
const FILL = 0.92;

let _geometry = null;
let _scene    = null;
let _camera   = null;
let _mesh     = null;

/** Hand over the pointer.glb geometry once it has loaded. */
export function setBreadcrumbIconGeometry(geometry) {
    _geometry = geometry;
}

function buildScene() {
    _scene = new THREE.Scene();

    _mesh = new THREE.Mesh(_geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
    _mesh.rotation.set(...VIEW_ROTATION);
    _scene.add(_mesh);

    // Fit the frame to the rotated vertices themselves. A bounding sphere
    // would do, but the dart is long and thin and mostly pointing away from
    // the camera at this angle, so a sphere fit leaves it filling about half
    // the icon - which is half the resolution wasted at HUD size. There are
    // only 42 vertices, so an exact fit is free.
    const rotated = [];
    const position = _geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
        rotated.push(
            new THREE.Vector3().fromBufferAttribute(position, i).applyEuler(_mesh.rotation));
    }

    const extent = new THREE.Box3().setFromPoints(rotated);
    const center = extent.getCenter(new THREE.Vector3());
    _mesh.position.set(-center.x, -center.y, 0);

    _camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.01, 100);

    // smallest camera distance at which every vertex still projects inside
    // the frustum
    const tangent = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2) * FILL;
    let distance = 0;
    for (const vertex of rotated) {
        const reach = Math.max(
            Math.abs(vertex.x - center.x), Math.abs(vertex.y - center.y));
        distance = Math.max(distance, vertex.z + reach / tangent);
    }
    _camera.position.z = distance;

    // Off-axis key light. The light the player carries sits on the camera,
    // which lights the breadcrumb head-on and flattens it into a silhouette -
    // fine in a maze full of other depth cues, useless in a 32 pixel icon.
    _scene.add(new THREE.AmbientLight(0x808080));

    const key = new THREE.PointLight(0xffffff, 5, 0, 0.2);
    key.position.set(-1, 2, 1.5).multiplyScalar(_camera.position.z * 0.5);
    _scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(1, 0, 1);
    _scene.add(fill);
}

/**
 * @param {THREE.Object3D} breadcrumb - the breadcrumb to depict
 * @returns {string|null} a PNG data URL, or null if it can't be rendered yet
 */
export function breadcrumbIconSource(breadcrumb) {
    const color = breadcrumb?.userData?.originalMaterial?.color;
    if (_geometry === null || !color) return null;

    // read the hue back out of the material's own colour rather than
    // recreating it, so the icon takes the same sRGB path the breadcrumb did
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    const step = Math.round(hsl.h * HUE_STEPS) % HUE_STEPS;

    return iconRenderer.render(`breadcrumb:${step}`, () => {
        if (_scene === null) buildScene();
        _mesh.material.color.setHSL(step / HUE_STEPS, hsl.s, hsl.l);
        return { scene: _scene, camera: _camera };
    });
}
