import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { uiLookDirection } from '../js/VRManager.js';

// Camera looking down -Z by default; pitch it with a rotation about X.
const looking = (pitchRadians = 0, yawRadians = 0) =>
    new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchRadians, yawRadians, 0, 'YXZ'));

const dir = (quaternion, mode) =>
    uiLookDirection(new THREE.Vector3(), quaternion, mode);

const isFinite3 = (v) =>
    Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

describe('uiLookDirection', () => {
    describe("'level'", () => {
        it('keeps a horizontal gaze as it is', () => {
            const d = dir(looking(0, 0), 'level');
            expect(d.x).toBeCloseTo(0, 6);
            expect(d.y).toBeCloseTo(0, 6);
            expect(d.z).toBeCloseTo(-1, 6);
        });

        it('drops the pitch but keeps the heading', () => {
            const d = dir(looking(-Math.PI / 4, Math.PI / 2), 'level');

            expect(d.y).toBeCloseTo(0, 6);
            expect(d.length()).toBeCloseTo(1, 6);
            // yawed a quarter turn: now facing -X
            expect(d.x).toBeCloseTo(-1, 6);
        });
    });

    describe("'gaze'", () => {
        it('keeps the pitch', () => {
            const d = dir(looking(Math.PI / 4), 'gaze');

            expect(d.y).toBeCloseTo(Math.SQRT1_2, 6);
            expect(d.length()).toBeCloseTo(1, 6);
        });

        it('handles straight up without dividing by zero', () => {
            const d = dir(looking(Math.PI / 2), 'gaze');

            expect(isFinite3(d)).toBe(true);
            expect(d.y).toBeCloseTo(1, 6);
        });
    });

    // The reason for the guard: levelling a vertical gaze leaves a zero vector,
    // and three.js normalize() would hand back (0,0,0) - putting the UI exactly
    // on the camera.
    describe('near-vertical gaze', () => {
        for (const [name, pitch] of [['straight up', Math.PI / 2], ['straight down', -Math.PI / 2]]) {
            it(`falls back to the gaze looking ${name}`, () => {
                const d = dir(looking(pitch), 'level');

                expect(isFinite3(d)).toBe(true);
                expect(d.length()).toBeCloseTo(1, 6);
                expect(d.y).toBeCloseTo(pitch > 0 ? 1 : -1, 6);
            });
        }

        it('still levels a gaze that is merely steep', () => {
            const d = dir(looking(Math.PI / 2 - 0.05), 'level');

            expect(d.y).toBeCloseTo(0, 6);
            expect(d.length()).toBeCloseTo(1, 6);
        });
    });
});
