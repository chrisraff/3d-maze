/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Keeps a breadcrumb's hue clear of the dead-end wall it hangs on. Walls are
 * tinted by grid position (see MazeWorld.js's build()), so a freely random hue
 * can land on the color of its own panel - and the medallion base inherits the
 * same hue, so one bad draw costs both the marker and its base.
 *
 * The floor is a distance, not an angle: excluding a band of hues around the
 * panel's own reads as the obvious mirror of what the scenery modules do, but a
 * rotation at fixed saturation and lightness barely moves a color when the
 * panel is already a vivid near-primary, and the separation a band buys is not
 * monotonic in its width - +/-45 degrees guarantees less than +/-30, since the
 * wider rotation lands on a different panel's blind spot. An OKLab floor holds
 * at its stated value by construction, and costs less of the hue wheel.
 *
 * Distances are measured in sRGB, the pixel the player sees. Wall colors go in
 * as vertex colors, so THREE reads them as linear working space and encodes
 * them on output; for saturated panels the linear hue and the on-screen hue
 * differ by up to 16 degrees, more than the separation at stake. The scenery
 * modules compare in linear space and are self-consistent doing so, but a
 * breadcrumb's hue is authored as a CSS hsl() string, which is sRGB.
 */

// OKLab distance a breadcrumb keeps from its own wall. ~0.02 is one
// just-noticeable step, so this is several - and leaves 287 of 360 hues usable.
export const MIN_PANEL_DISTANCE = 0.08;

// only the hue is drawn, so the floor only ever reasons about one axis
export const BREADCRUMB_SATURATION = 1.0;
export const BREADCRUMB_LIGHTNESS = 0.5;

// ~78% of hues pass on the worst panel, so a miss by 20 tries is ~1e-14
const MAX_ATTEMPTS = 20;

const clamp01 = c => c < 0 ? 0 : c > 1 ? 1 : c;

// Ottosson's formulas, matching BreadcrumbBaseDecor's pair - carried here
// rather than imported, as each module does with the panel color formula
function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c) {
    c = clamp01(c);
    return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function rgbToOklab(r, g, b) {
    const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return {
        L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    };
}

// hue in degrees, saturation and lightness in [0, 1] - resolves to the same
// sRGB components a CSS hsl() string of those three values would
function hslToSrgb(hue, saturation, lightness) {
    const h = (((hue % 360) + 360) % 360) / 360;
    const q = lightness < 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    const channel = t => {
        t = (t % 1 + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 0.5) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

// The panel color as it reaches the screen, so this mirrors both the output
// encode and the GPU's clamp of the negative channel index 0 produces.
export function panelDisplayedColor(mazeData, panelIndex) {
    return [
        linearToSrgb(0.05 + 0.9 * (panelIndex.x - 1) / mazeData.segments[0]),
        linearToSrgb(0.05 + 0.9 * (panelIndex.y - 1) / mazeData.segments[1]),
        linearToSrgb(0.05 + 0.9 * (panelIndex.z - 1) / mazeData.segments[2]),
    ];
}

// OKLab distance between a candidate hue and a panel color, both as displayed.
// Exported so the tests can sweep it over every panel a maze can produce.
export function hueDistanceToPanel(hue, panelSrgb) {
    const panel = rgbToOklab(panelSrgb[0], panelSrgb[1], panelSrgb[2]);
    const crumb = rgbToOklab(...hslToSrgb(hue, BREADCRUMB_SATURATION, BREADCRUMB_LIGHTNESS));
    return Math.hypot(panel.L - crumb.L, panel.a - crumb.a, panel.b - crumb.b);
}

/**
 * A hue in degrees for a breadcrumb against `panelIndex`, redrawn while it sits
 * closer than MIN_PANEL_DISTANCE to the panel's own color.
 *
 * Rejection sampling rather than solving for the passing arcs: most of the wheel
 * passes, so a couple of draws settle it, and the hue stays uniform over
 * whatever set that is instead of bunching at the edges of the excluded one. If
 * every attempt is rejected the furthest hue seen wins, so a breadcrumb still
 * gets the best color drawn rather than none of the guarantee.
 */
export function pickBreadcrumbHue(mazeData, panelIndex, rng = Math.random) {
    const panelSrgb = panelDisplayedColor(mazeData, panelIndex);

    let bestHue = 0;
    let bestDistance = -1;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const hue = rng() * 360;
        const distance = hueDistanceToPanel(hue, panelSrgb);
        if (distance >= MIN_PANEL_DISTANCE) return hue;
        if (distance > bestDistance) {
            bestDistance = distance;
            bestHue = hue;
        }
    }
    return bestHue;
}
