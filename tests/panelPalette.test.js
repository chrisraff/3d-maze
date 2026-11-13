import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
    panelRenderedColor,
    panelPaletteHSL,
    shadeLightness,
    setPaletteColor,
} from '../js/decor/panelPalette.js';

function mazeStub(size) {
    return { segments: [size * 2 + 1, size * 2 + 1, size * 2 + 1] };
}

// Every panel side a decor can sit on: a room (odd indices) plus one step
// along one axis, which is the even coordinate the panel sits at.
function decorablePanels(size) {
    const segments = size * 2 + 1;
    const panels = [];
    for (let x = 1; x < segments - 1; x += 2)
        for (let y = 1; y < segments - 1; y += 2)
            for (let z = 1; z < segments - 1; z += 2)
                for (const [axis, dir] of [['x', -1], ['x', 1], ['y', -1], ['y', 1], ['z', -1], ['z', 1]])
                    panels.push({ x, y, z, [axis]: { x, y, z }[axis] + dir });
    return panels;
}

const SIZES = [3, 6, 12];

describe('panelRenderedColor', () => {
    it('reproduces MazeWorld\'s gradient wherever it is in range', () => {
        const maze = mazeStub(6);
        const c = panelRenderedColor(maze, { x: 5, y: 7, z: 9 });
        expect(c.r).toBeCloseTo(0.05 + 0.9 * 4 / 13, 10);
        expect(c.g).toBeCloseTo(0.05 + 0.9 * 6 / 13, 10);
        expect(c.b).toBeCloseTo(0.05 + 0.9 * 8 / 13, 10);
    });

    // Grid index 0 - the outer shell on the low side of every axis - drives
    // the formula negative in a small maze. The GPU clamps it; this has to too,
    // or getHSL reports a saturation above 1 off a channel that renders black.
    it('clamps the negative channel grid index 0 produces', () => {
        const maze = mazeStub(6);
        expect(0.05 + 0.9 * (0 - 1) / 13).toBeLessThan(0); // the raw formula
        expect(panelRenderedColor(maze, { x: 0, y: 1, z: 1 }).r).toBe(0);
    });

    it('stays in [0, 1] on every decorable panel of every size', () => {
        for (const size of SIZES) {
            const maze = mazeStub(size);
            for (const panel of decorablePanels(size)) {
                const { r, g, b } = panelRenderedColor(maze, panel);
                for (const v of [r, g, b]) {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(1);
                }
            }
        }
    });
});

describe('panelPaletteHSL', () => {
    it('reads the panel in sRGB, not the linear value the vertex buffer holds', () => {
        const hsl = panelPaletteHSL(mazeStub(6), { x: 1, y: 1, z: 1 }, { h: 0, s: 0, l: 0 });
        // linear 0.05 is what MazeWorld pushes; 0.248 is what the player sees
        expect(hsl.l).toBeCloseTo(0.2478, 3);
    });

    it('never reports a saturation above 1', () => {
        for (const size of SIZES) {
            const maze = mazeStub(size);
            const hsl = { h: 0, s: 0, l: 0 };
            for (const panel of decorablePanels(size)) {
                panelPaletteHSL(maze, panel, hsl);
                expect(hsl.s).toBeLessThanOrEqual(1);
                expect(hsl.l).toBeGreaterThanOrEqual(0);
                expect(hsl.l).toBeLessThanOrEqual(1);
            }
        }
    });

    it('round-trips back to the linear color MazeWorld renders', () => {
        const maze = mazeStub(6);
        const hsl = { h: 0, s: 0, l: 0 };
        for (const panel of decorablePanels(6).slice(0, 200)) {
            panelPaletteHSL(maze, panel, hsl);
            const back = setPaletteColor(new THREE.Color(), hsl.h, hsl.s, hsl.l);
            const want = panelRenderedColor(maze, panel);
            expect(back.r).toBeCloseTo(want.r, 4);
            expect(back.g).toBeCloseTo(want.g, 4);
            expect(back.b).toBeCloseTo(want.b, 4);
        }
    });
});

describe('shadeLightness', () => {
    it('applies the offset exactly wherever the gradient has room for it', () => {
        expect(shadeLightness(0.5, -0.11)).toBeCloseTo(0.39, 10);
        expect(shadeLightness(0.5, 0.09)).toBeCloseTo(0.59, 10);
        expect(shadeLightness(0.248, -0.11)).toBeCloseTo(0.138, 10);
        expect(shadeLightness(0.877, 0.09)).toBeCloseTo(0.877 + 0.09, 10);
    });

    it('stays inside [0, 1] from either end, where a flat offset would clip', () => {
        for (const l of [0, 0.02, 0.124, 0.5, 0.877, 0.98, 1]) {
            for (const o of [-0.9, -0.5, -0.14, -0.05, 0.05, 0.16, 0.5, 0.9]) {
                const out = shadeLightness(l, o);
                expect(out).toBeGreaterThanOrEqual(0);
                expect(out).toBeLessThanOrEqual(1);
            }
        }
    });

    it('moves in the direction asked for, and not past the endpoint', () => {
        expect(shadeLightness(0.124, -0.14)).toBeLessThan(0.124);
        expect(shadeLightness(0.124, -0.14)).toBeGreaterThan(0);
        expect(shadeLightness(0.877, 0.16)).toBeGreaterThan(0.877);
        expect(shadeLightness(0.877, 0.16)).toBeLessThan(1);
    });

    // The reason it eases at all: the circuit trace offset used to be applied
    // raw, and the darkest panels of a maze have no room for it.
    it('keeps a circuit trace off pure black on every panel of every size', () => {
        for (const size of SIZES) {
            const maze = mazeStub(size);
            const hsl = { h: 0, s: 0, l: 0 };
            for (const panel of decorablePanels(size)) {
                panelPaletteHSL(maze, panel, hsl);
                expect(shadeLightness(hsl.l, -0.11)).toBeGreaterThan(0);
                expect(shadeLightness(hsl.l, 0.09)).toBeLessThan(1);
            }
        }
    });

    // What the far corners are for: an offset has to read as the same amount
    // of shading everywhere, or a corner stops feeling like the same maze.
    it('holds a trace within a tight band of its authored offset everywhere', () => {
        let min = Infinity, max = -Infinity;
        for (const size of SIZES) {
            const maze = mazeStub(size);
            const hsl = { h: 0, s: 0, l: 0 };
            for (const panel of decorablePanels(size)) {
                panelPaletteHSL(maze, panel, hsl);
                const delta = hsl.l - shadeLightness(hsl.l, -0.11);
                min = Math.min(min, delta);
                max = Math.max(max, delta);
            }
        }
        expect(max).toBeCloseTo(0.11, 5);   // the authored offset, mid-gradient
        expect(min).toBeGreaterThan(0.08);  // the darkest corner still shades
    });

    // A lift must stay a lift: the proportional form inverted Lattice's studs
    // into a darkening past mid-maze.
    it('never reverses the direction of an offset across the gradient', () => {
        for (const size of SIZES) {
            const maze = mazeStub(size);
            const hsl = { h: 0, s: 0, l: 0 };
            for (const panel of decorablePanels(size)) {
                panelPaletteHSL(maze, panel, hsl);
                expect(shadeLightness(hsl.l, 0.08)).toBeGreaterThan(hsl.l);
                expect(shadeLightness(hsl.l, -0.14)).toBeLessThan(hsl.l);
            }
        }
    });
});

describe('setPaletteColor', () => {
    it('writes linear components, so a decor matches the wall it is read against', () => {
        const c = setPaletteColor(new THREE.Color(), 0, 0, 0.2478065754484477);
        expect(c.r).toBeCloseTo(0.05, 5);
    });

    it('wraps hue and clamps saturation and lightness', () => {
        const wrapped = setPaletteColor(new THREE.Color(), -0.9, 0.5, 0.5);
        const plain = setPaletteColor(new THREE.Color(), 0.1, 0.5, 0.5);
        expect(wrapped.getHex()).toBe(plain.getHex());

        const low = setPaletteColor(new THREE.Color(), 0.3, -1, -1);
        expect(low.getHex()).toBe(0x000000);
        const high = setPaletteColor(new THREE.Color(), 0.3, 2, 2);
        expect(high.getHex()).toBe(0xffffff);
    });
});
