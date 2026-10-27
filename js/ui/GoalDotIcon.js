import * as THREE from 'three';
import iconRenderer from './IconRenderer.js';

/**
 * A still glyph of the goal dots, drawn wherever copy mentions the exit.
 *
 * This is a deliberate simplification of the live effect in goalDots.js: the
 * same dot texture, the same alpha cutoff and the same saturated pastel
 * colour rule, but nine dots spaced evenly over a sphere instead of forty
 * sampled through the volume of one, and a wider size ratio between the two
 * tiers. The real cloud reads as dust at text size, and its per-dot speeds
 * are incommensurable so it never repeats - neither matters for a single
 * frame, and an even, deterministic arrangement means the glyph looks the
 * same everywhere it appears.
 */

const DOT_COUNT  = 9;
const SIZE_LARGE = 0.44;
const SIZE_SMALL = 0.24;
// fraction of the frame the dots fill; the remainder is breathing room
const FILL = 0.94;

// Evenly spaced points on a sphere (golden-angle spiral). Unlike the uniform
// volume sample the live effect uses, this never clumps, which matters a lot
// at sixteen pixels across.
function fibonacciSpherePoint(index, count) {
    const y     = 1 - (2 * index + 1) / count;
    const ring  = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = index * Math.PI * (3 - Math.sqrt(5));
    return [Math.cos(theta) * ring, y, Math.sin(theta) * ring];
}

let _scene = null;
let _camera = null;

function buildScene(texture) {
    const scene = new THREE.Scene();
    const sprites = [];

    for (let i = 0; i < DOT_COUNT; i++) {
        const size = i % 2 === 0 ? SIZE_LARGE : SIZE_SMALL;

        // golden-ratio hue walk, matching the live effect's setHSL(h, 1.0, 0.85)
        const color = new THREE.Color().setHSL((i * 0.618033988749895) % 1, 1.0, 0.85);

        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture,
            color,
            transparent: true,
            // mirrors the `if ( texel.a < 0.8 ) discard;` in the live shader
            alphaTest: 0.8,
        }));

        const [x, y, z] = fibonacciSpherePoint(i, DOT_COUNT);
        // a little deterministic depth variation so it reads as a cloud
        // rather than a perfect shell
        const radius = 0.78 + 0.22 * (((i * 7) % 5) / 4);
        sprite.position.set(x * radius, y * radius, z * radius);
        sprite.scale.setScalar(size);

        scene.add(sprite);
        sprites.push(sprite);
    }

    // Frame the dots from where they actually landed rather than from the
    // nominal sphere radius, so the glyph is centred and fills the icon no
    // matter how the arrangement is tuned.
    const bounds = new THREE.Box2();
    for (const sprite of sprites) {
        const half = sprite.scale.x / 2;
        bounds.expandByPoint(new THREE.Vector2(sprite.position.x - half, sprite.position.y - half));
        bounds.expandByPoint(new THREE.Vector2(sprite.position.x + half, sprite.position.y + half));
    }

    const center = bounds.getCenter(new THREE.Vector2());
    for (const sprite of sprites) {
        sprite.position.x -= center.x;
        sprite.position.y -= center.y;
    }

    const size = bounds.getSize(new THREE.Vector2());
    const halfExtent = Math.max(size.x, size.y) / 2 / FILL;

    // orthographic keeps every dot at its authored size, which reads more
    // evenly than perspective once the whole glyph is sixteen pixels wide
    const camera = new THREE.OrthographicCamera(
        -halfExtent, halfExtent, halfExtent, -halfExtent, 0.1, 100);
    camera.position.z = 10;

    return { scene, camera };
}

/**
 * Render the glyph once and point every `.goal-icon` element at it.
 * @param {THREE.Texture} texture - the shared textures/dot.png sprite
 */
export function mountGoalIcons(texture) {
    if (!texture) return;

    const source = iconRenderer.render('goal-dots', () => {
        if (_scene === null)
            ({ scene: _scene, camera: _camera } = buildScene(texture));
        return { scene: _scene, camera: _camera };
    });

    if (source === null) return;

    document.querySelectorAll('.goal-icon').forEach((element) => {
        element.src = source;
    });
}
