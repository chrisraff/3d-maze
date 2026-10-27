/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Scenery: small glowing motes/spores drifting slowly in open air within
 * occasional rooms. Unlike the other scenery, these aren't anchored to any
 * wall/ceiling/floor panel at all - small point-style decor has little to
 * occlude or clip through. Animated: call update() each frame.
 */
import * as THREE from 'three';
import { getOffset } from '../maze/maze.js';
import { randomRoom, randomInt } from '../maze/mazeQuery.js';

const CLUSTER_SPREAD = 0.6; // how far motes wander from their room's center
const DRIFT_SPEED = 0.15;
const BOB_AMPLITUDE = 0.12;

export default class MotesDecor {
    // motes drift in open air rather than on a panel, so they claim nothing,
    // conflict with nothing, and take no claims ledger to build
    static PROFILE = null;

    constructor() {
        this.geometry = new THREE.BufferGeometry();
        this.material = new THREE.PointsMaterial({
            size: 0.045,
            color: new THREE.Color(1, 1, 1),
            map: new THREE.TextureLoader().load('textures/dot.png'),
            alphaTest: 0.5,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.points = new THREE.Points(this.geometry, this.material);
        this.points.frustumCulled = false;

        this.origins = [];
        this.phases = [];
        this.t = 0;
    }

    addTo(scene) {
        scene.add(this.points);
    }

    build(mazeData, rng = Math.random) {
        this.t = 0;

        const clusterCount = Math.max(1, Math.round(mazeData.bounds[0] * 1.2));
        const perCluster = 14 + randomInt(rng, 16);

        const origins = [];
        const phases = [];

        for (let c = 0; c < clusterCount; c++) {
            const room = randomRoom(mazeData, rng);
            const center = new THREE.Vector3(getOffset(room.x), getOffset(room.y), getOffset(room.z));

            for (let i = 0; i < perCluster; i++) {
                origins.push(
                    center.x + (rng() * 2 - 1) * CLUSTER_SPREAD,
                    center.y + (rng() * 2 - 1) * CLUSTER_SPREAD,
                    center.z + (rng() * 2 - 1) * CLUSTER_SPREAD,
                );
                phases.push(
                    rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2,
                    0.7 + rng() * 0.6, // per-mote speed variance
                );
            }
        }

        this.origins = new Float32Array(origins);
        this.phases = phases;

        const positions = new Float32Array(origins);
        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.attributes.position.needsUpdate = true;

        return clusterCount;
    }

    update(dt) {
        if (this.origins.length === 0) return;
        this.t += dt;

        const positions = this.geometry.attributes.position.array;
        const count = this.origins.length / 3;
        for (let i = 0; i < count; i++) {
            const [px, py, pz, speed] = [
                this.phases[i * 4], this.phases[i * 4 + 1], this.phases[i * 4 + 2], this.phases[i * 4 + 3],
            ];
            const t = this.t * DRIFT_SPEED * speed;
            positions[i * 3 + 0] = this.origins[i * 3 + 0] + Math.sin(t + px) * BOB_AMPLITUDE;
            positions[i * 3 + 1] = this.origins[i * 3 + 1] + Math.sin(t * 1.3 + py) * BOB_AMPLITUDE;
            positions[i * 3 + 2] = this.origins[i * 3 + 2] + Math.sin(t * 0.8 + pz) * BOB_AMPLITUDE;
        }
        this.geometry.attributes.position.needsUpdate = true;
    }
}
