/**
 * The GPU buffers behind a rebuild are freed, not orphaned. three deletes an
 * instance matrix only from its mesh's own `dispose` event and an attribute
 * buffer only from `geometry.dispose()`, and both halves are thrown away on
 * every new maze - so these tests watch for the dispose events themselves
 * rather than for GL calls, since there is no renderer here.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { clearInstanced } from '../js/render/instancedCleanup.js';
import { generateMaze } from '../js/maze/maze.js';
import MazeWorld from '../js/maze/MazeWorld.js';
import SCENERY_DECORS from '../js/decor/scenery.js';
import { SceneryClaims } from '../js/decor/sceneryClaims.js';
import BreadcrumbBaseDecor from '../js/breadcrumbs/BreadcrumbBaseDecor.js';

// counts dispose events on everything a build hands to the renderer
function watch(objects) {
    const seen = new Map();
    for (const object of objects) {
        if (!object) continue;
        seen.set(object, 0);
        object.addEventListener('dispose', () => seen.set(object, seen.get(object) + 1));
    }
    return seen;
}

const meshesIn = group => group.children.filter(child => child.isInstancedMesh);

describe('clearInstanced', () => {
    it('disposes the instanced meshes it detaches', () => {
        const group = new THREE.Group();
        const geometry = new THREE.InstancedBufferGeometry();
        const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 4);
        group.add(mesh);

        const seen = watch([mesh]);
        clearInstanced(group);

        expect(seen.get(mesh)).toBe(1);
        expect(group.children).toHaveLength(0);
    });

    it('disposes the geometries it is given, and leaves materials alone', () => {
        const group = new THREE.Group();
        const geometry = new THREE.InstancedBufferGeometry();
        const material = new THREE.MeshBasicMaterial();
        group.add(new THREE.InstancedMesh(geometry, material, 1));

        const seen = watch([geometry, material]);
        clearInstanced(group, [geometry]);

        expect(seen.get(geometry)).toBe(1);
        expect(seen.get(material)).toBe(0);
    });

    it('leaves a child that is not an instanced mesh undisposed', () => {
        const group = new THREE.Group();
        const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
        group.add(points);

        const seen = watch([points]);
        clearInstanced(group);

        expect(seen.get(points)).toBe(0);
        expect(group.children).toHaveLength(0);
    });
});

describe('a rebuild orphans nothing', () => {
    const mazeData = generateMaze(4);

    for (const Decor of SCENERY_DECORS) {
        it(`${Decor.name} disposes the previous maze's mesh and shared geometries`, () => {
            const decor = new Decor();
            decor.addTo(new THREE.Scene());
            decor.build(mazeData, Math.random, new SceneryClaims(), null);

            const meshes = meshesIn(decor.group);
            // every geometry a mesh is drawn with: the shared ones whose
            // per-instance color is replaced on the next build
            const geometries = [...new Set(meshes.map(mesh => mesh.geometry))];
            expect(meshes.length).toBeGreaterThan(0);

            const seen = watch([...meshes, ...geometries]);
            decor.build(mazeData, Math.random, new SceneryClaims(), null);

            for (const [object, count] of seen) {
                expect(count, object.type).toBe(1);
            }
            // and the replacements are live again, not left disposed
            expect(meshesIn(decor.group).length).toBeGreaterThan(0);
            for (const mesh of meshesIn(decor.group)) {
                expect(seen.has(mesh)).toBe(false);
            }
        });
    }

    it('MazeWorld disposes its three meshes and the wall color geometry', () => {
        const world = new MazeWorld();
        world.setWallGeometry(new THREE.BoxGeometry());
        world.addTo(new THREE.Scene());
        world.build(3);

        const meshes = meshesIn(world.group);
        expect(meshes).toHaveLength(3);

        const seen = watch([...meshes, world.wallGeometry]);
        world.build(3);

        for (const [object, count] of seen) {
            expect(count, object.type).toBe(1);
        }
        expect(meshesIn(world.group)).toHaveLength(3);
    });

    it('BreadcrumbBaseDecor disposes its studs and the dot geometry it reuses', () => {
        const bases = new BreadcrumbBaseDecor();
        bases.addTo(new THREE.Scene());
        const sites = [{
            room: { x: 1, y: 1, z: 1 }, surface: { axis: 'x', dir: 1 },
            hue: 0.5, saturation: 0.8, lightness: 0.6,
        }];
        bases.build(mazeData, sites);

        const studMesh = bases.studMesh;
        expect(studMesh).not.toBeNull();

        const seen = watch([studMesh, bases.studGeometry, bases.dotGeometry]);
        bases.build(mazeData, sites);

        for (const [object, count] of seen) {
            expect(count, object.type).toBe(1);
        }
        // the Points itself is never rebuilt, so it must not be disposed
        expect(bases.dotPoints.geometry).toBe(bases.dotGeometry);
        expect(bases.studMesh).not.toBe(studMesh);
    });
});
