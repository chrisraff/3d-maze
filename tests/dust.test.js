import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import DustEffect from '../js/dust.js';

const RADIUS = 10;
const COUNT = 2000;

// update() no-ops until the material hands back its compiled shader, which
// only happens on a real render - stand in for it so the recycling logic runs
function makeDust() {
    const dust = new DustEffect({ count: COUNT, spawnRadius: RADIUS });
    dust._shader = { uniforms: { u_time: { value: 0 } } };

    const follow = new THREE.Object3D();
    dust.followObject(follow);
    dust.respawnAllParticles();

    return { dust, follow };
}

// offsets of every particle from the thing it is following
function offsets(dust, follow) {
    const out = [];
    for (let i = 0; i < dust.count; i++) {
        out.push(new THREE.Vector3(
            dust._positions[i * 3 + 0] - follow.position.x,
            dust._positions[i * 3 + 1] - follow.position.y,
            dust._positions[i * 3 + 2] - follow.position.z));
    }
    return out;
}

// fly the follow target `distance` units along +z over one second of frames
function travel(dust, follow, distance, frames = 60) {
    for (let f = 0; f < frames; f++) {
        follow.position.z += distance / frames;
        dust.update(1 / frames);
    }
}

describe('DustEffect recycling', () => {
    it('leaves no particle behind when the target outruns the cloud', () => {
        const { dust, follow } = makeDust();

        travel(dust, follow, RADIUS * 4);

        const stragglers = offsets(dust, follow).filter(o => o.length() > RADIUS);
        expect(stragglers).toHaveLength(0);
    });

    it('keeps the cloud centred instead of trailing behind the target', () => {
        const { dust, follow } = makeDust();

        travel(dust, follow, RADIUS * 4);

        // the direction of travel is the half that empties out if particles
        // are only recycled when their lifetime expires
        const ahead = offsets(dust, follow).filter(o => o.z > 0).length;
        expect(ahead / COUNT).toBeGreaterThan(0.4);
        expect(ahead / COUNT).toBeLessThan(0.6);
    });

    it('stays radially uniform instead of collapsing towards the middle', () => {
        const { dust, follow } = makeDust();

        // far enough that every particle is recycled several times over - the
        // regression this guards against (rescaling the whole offset vector,
        // which quietly shrinks the offset from the axis of travel on every
        // wrap) only shows up after a few cloud-widths, and took the outer
        // half from 50% down to 26%
        travel(dust, follow, RADIUS * 12, 180);

        // for points spread evenly through a ball, half the volume - and so
        // half the particles - sits outside radius / cbrt(2)
        const half = RADIUS / Math.cbrt(2);
        const outer = offsets(dust, follow).filter(o => o.length() > half).length;
        expect(outer / COUNT).toBeGreaterThan(0.45);
        expect(outer / COUNT).toBeLessThan(0.55);
    });

    it('keeps each particle on its own line of travel', () => {
        const { dust, follow } = makeDust();
        const axis = new THREE.Vector3(0, 0, 1);

        // distance from the axis of travel is what the wrap has to preserve;
        // if it decays, the cloud funnels into the middle
        const spread = () => {
            const perp = offsets(dust, follow)
                .map(o => o.clone().projectOnPlane(axis).length());
            return perp.reduce((a, b) => a + b, 0) / perp.length;
        };

        const before = spread();
        travel(dust, follow, RADIUS * 12, 180);
        const after = spread();

        expect(after).toBeGreaterThan(before * 0.9);
        expect(after).toBeLessThan(before * 1.1);
    });

    it('scatters fresh rather than mirroring when the target jumps clear', () => {
        const { dust, follow } = makeDust();

        // further than the cloud is wide, so there is no opposite side to
        // land on and every particle has to be respawned
        follow.position.z += RADIUS * 10;
        dust.update(1 / 60);

        const stragglers = offsets(dust, follow).filter(o => o.length() > RADIUS);
        expect(stragglers).toHaveLength(0);
    });

    it('only uploads the buffers when something actually moved', () => {
        const { dust, follow } = makeDust();
        // respawnAllParticles back-dates ages across the whole lifetime range,
        // which would retire a handful of particles every frame; flatten it so
        // only movement can dirty the buffers
        dust._spawnTime.fill(0);

        // needsUpdate is a write-only setter on BufferAttribute - reading it
        // gives undefined, so watch the version counter it bumps instead
        const version = () => dust._geometry.attributes.position.version;

        dust.update(1 / 60);
        const idle = version();
        dust.update(1 / 60);
        expect(version()).toBe(idle);

        travel(dust, follow, RADIUS * 2, 1);
        expect(version()).toBeGreaterThan(idle);
    });
});
