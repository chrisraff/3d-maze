import { describe, it, expect } from 'vitest';
import {
    pickBreadcrumbHue,
    hueDistanceToPanel,
    panelDisplayedColor,
    MIN_PANEL_DISTANCE,
    BREADCRUMB_SATURATION,
    BREADCRUMB_LIGHTNESS,
} from '../js/breadcrumbHue.js';

function mazeStub(size) {
    return { segments: [size * 2 + 1, size * 2 + 1, size * 2 + 1] };
}

// A dead end's wall panel has two odd coordinates (the room) and one even one
// (the wall it faces) - the only panels the floor has to hold for.
function deadEndPanels(size) {
    const segments = size * 2 + 1;
    const odd = [], even = [];
    for (let i = 0; i < segments; i++) (i % 2 ? odd : even).push(i);

    const seen = new Set();
    const panels = [];
    for (const axis of ['x', 'y', 'z']) {
        const others = ['x', 'y', 'z'].filter(a => a !== axis);
        for (const wall of even) {
            for (const a of odd) {
                for (const b of odd) {
                    const panel = { [axis]: wall, [others[0]]: a, [others[1]]: b };
                    const key = `${panel.x},${panel.y},${panel.z}`;
                    if (!seen.has(key)) { seen.add(key); panels.push(panel); }
                }
            }
        }
    }
    return panels;
}

function allPanels(size) {
    const segments = size * 2 + 1;
    const panels = [];
    for (let x = 0; x < segments; x++)
        for (let y = 0; y < segments; y++)
            for (let z = 0; z < segments; z++)
                panels.push({ x, y, z });
    return panels;
}

// the in-game size slider runs 2..12
const SIZES = [2, 3, 6, 12];

describe('panelDisplayedColor', () => {
    it('clamps the negative channel a boundary panel produces', () => {
        // index 0 gives 0.05 - 0.9/segments, which is negative for every size
        const [r] = panelDisplayedColor(mazeStub(3), { x: 0, y: 1, z: 1 });
        expect(r).toBe(0);
    });

    it('stays inside the display range across the whole grid', () => {
        for (const panel of allPanels(3)) {
            for (const channel of panelDisplayedColor(mazeStub(3), panel)) {
                expect(channel).toBeGreaterThanOrEqual(0);
                expect(channel).toBeLessThanOrEqual(1);
            }
        }
    });

    it('brightens the raw figures, since they go in as linear vertex colors', () => {
        // walls are far more vivid on screen than their raw channel figures
        // suggest, which is what makes a hue collision noticeable
        const [r] = panelDisplayedColor(mazeStub(3), { x: 1, y: 1, z: 1 });
        expect(r).toBeCloseTo(0.2478, 4);
    });
});

describe('the guarantee', () => {
    it.each(SIZES)('holds for every dead-end panel of a size %i maze', size => {
        const mazeData = mazeStub(size);
        // a fixed sweep rather than Math.random, so a failure is reproducible
        // and every panel is probed the same way
        const draws = 24;
        let worst = Infinity;

        for (const panel of deadEndPanels(size)) {
            for (let d = 0; d < draws; d++) {
                let call = 0;
                const rng = () => ((d + call++ * 7) % draws) / draws;
                const hue = pickBreadcrumbHue(mazeData, panel, rng);
                const distance = hueDistanceToPanel(hue, panelDisplayedColor(mazeData, panel));
                expect(distance).toBeGreaterThanOrEqual(MIN_PANEL_DISTANCE);
                worst = Math.min(worst, distance);
            }
        }

        expect(worst).toBeGreaterThanOrEqual(MIN_PANEL_DISTANCE);
    });

    it('leaves most of the hue wheel usable on the most constrained panel', () => {
        // the floor's cost. If this drops far, MIN_PANEL_DISTANCE is too high.
        const mazeData = mazeStub(6);
        let fewestUsable = 360;

        for (const panel of deadEndPanels(6)) {
            const panelSrgb = panelDisplayedColor(mazeData, panel);
            let usable = 0;
            for (let hue = 0; hue < 360; hue += 2)
                if (hueDistanceToPanel(hue, panelSrgb) >= MIN_PANEL_DISTANCE) usable += 2;
            fewestUsable = Math.min(fewestUsable, usable);
        }

        expect(fewestUsable).toBeGreaterThan(240);
    });

    // What a hue band would guarantee instead: the worst pair it still permits,
    // with the breadcrumb sitting on the near edge of the excluded band.
    function bandWorstCase(size, band) {
        const mazeData = mazeStub(size);
        let worst = Infinity;

        for (const panel of deadEndPanels(size)) {
            const panelSrgb = panelDisplayedColor(mazeData, panel);
            const [r, g, b] = panelSrgb;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let panelHue = 0;
            if (max !== min) {
                const delta = max - min;
                panelHue = 60 * (max === r ? ((g - b) / delta + (g < b ? 6 : 0))
                    : max === g ? ((b - r) / delta + 2)
                    : ((r - g) / delta + 4));
            }
            for (const edge of [band, -band])
                worst = Math.min(worst, hueDistanceToPanel(panelHue + edge, panelSrgb));
        }
        return worst;
    }

    it('beats every hue band up to +/-45 degrees', () => {
        for (const band of [15, 30, 45])
            expect(bandWorstCase(6, band)).toBeLessThan(MIN_PANEL_DISTANCE);
    });

    it('is not beaten by widening the band, because the band is not monotonic', () => {
        // a wider rotation just lands on a different panel's blind spot, so a
        // band's guarantee can't be reasoned about from its width
        expect(bandWorstCase(6, 45)).toBeLessThan(bandWorstCase(6, 30));

        // +/-60 clears the floor, but only just, and for a third of the wheel
        // rather than the fifth the floor costs
        expect(bandWorstCase(6, 60)).toBeGreaterThan(MIN_PANEL_DISTANCE);
        expect(bandWorstCase(6, 60)).toBeLessThan(MIN_PANEL_DISTANCE * 1.1);
    });
});

describe('hue selection', () => {
    it('returns the first draw when it already clears the floor', () => {
        const mazeData = mazeStub(6);
        const panel = { x: 2, y: 1, z: 1 };
        const firstDraw = 0.5;
        expect(hueDistanceToPanel(firstDraw * 360, panelDisplayedColor(mazeData, panel)))
            .toBeGreaterThanOrEqual(MIN_PANEL_DISTANCE);
        expect(pickBreadcrumbHue(mazeData, panel, () => firstDraw)).toBeCloseTo(firstDraw * 360);
    });

    it('falls back to the furthest hue it saw when every draw is rejected', () => {
        const mazeData = mazeStub(6);
        // one of the most constrained panels: a vivid corner-ish wall, where
        // 46 of the 360 hues sit under the floor
        const panel = { x: 12, y: 1, z: 1 };
        const panelSrgb = panelDisplayedColor(mazeData, panel);

        // feed only a failing hue, so the picker exhausts its attempts and has
        // to hand back the best it saw rather than one with no floor behind it
        let failing = null;
        for (let hue = 0; hue < 360 && failing === null; hue++)
            if (hueDistanceToPanel(hue, panelSrgb) < MIN_PANEL_DISTANCE) failing = hue;
        expect(failing).not.toBeNull();

        const hue = pickBreadcrumbHue(mazeData, panel, () => failing / 360);
        expect(hue).toBeCloseTo(failing);
    });

    it('spreads hues over the wheel rather than bunching at the excluded edges', () => {
        const mazeData = mazeStub(6);
        const panel = { x: 2, y: 1, z: 1 };
        const buckets = new Array(12).fill(0);
        let seed = 1;
        const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

        for (let i = 0; i < 2400; i++)
            buckets[Math.floor(pickBreadcrumbHue(mazeData, panel, rng) / 30)]++;

        // no 30-degree wedge starved or hogged: rejection sampling keeps the
        // draw uniform over whatever set passes
        for (const count of buckets) expect(count).toBeGreaterThan(60);
    });

    it('keeps breadcrumbs at full saturation', () => {
        expect(BREADCRUMB_SATURATION).toBe(1.0);
        expect(BREADCRUMB_LIGHTNESS).toBe(0.5);
    });
});
