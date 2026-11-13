/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * The one place a decor asks "what color is the panel I'm sitting on, and how
 * do I shade off it". Every kind whose palette is anchored to the wall's own
 * color goes through here.
 *
 * This mirrors MazeWorld.build()'s RGB-from-grid-index tint rather than
 * importing it, which is what keeps a decor module free of MazeWorld's
 * THREE/scene setup. Two things it has to get right that a bare copy of that
 * formula does not:
 *
 * - **The clamp.** The gradient is `0.05 + 0.9 * (index - 1) / segments`, so
 *   grid index 0 - the outer shell on the low side of every axis, which is
 *   exactly the darkest corner of the maze - goes *negative* whenever
 *   `0.9 / segments > 0.05`, i.e. at sizes 3-8. The GPU clamps that to black;
 *   `getHSL` does not, and reports a saturation above 1 (2.25 at size 6) off a
 *   hue taken from a channel that renders as nothing. That inflated saturation
 *   then hard-clamps to a fully saturated decor color on 8-17% of the panels of
 *   a small maze, whatever the wall in front of the player actually looks like.
 *
 * - **The space.** Those gradient values are fed in as vertex colors, which
 *   THREE reads as the linear working space and encodes on output, so the
 *   number is nothing like the lightness the player sees: the dark end of the
 *   gradient is linear 0.015-0.085 where the screen shows 0.12-0.31. A palette
 *   offset is authored for what the player sees ("a touch darker than the
 *   wall"), so it has to be applied in sRGB. Applied to the linear number
 *   instead, a -0.13 nudge lands *below black* and clips flat - which is the
 *   black circuit traces and skyline towers that used to appear wherever the
 *   maze is darkest. `panelPaletteHSL` and `setPaletteColor` are an sRGB pair:
 *   read the panel the way it is displayed, shade it there with
 *   `shadeLightness`, and hand back the linear color the vertex buffer wants.
 *
 * breadcrumbHue.js measures its own distances in sRGB for the same reason, and
 * documents the same clamp.
 */

import * as THREE from 'three';

const clamp01 = c => c < 0 ? 0 : c > 1 ? 1 : c;

const _panelColor = new THREE.Color();

// The color MazeWorld.build() actually renders this panel as, in the linear
// working space its vertex colors live in - clamped, so it matches the screen.
export function panelRenderedColor(mazeData, panelIndex, target = new THREE.Color()) {
    return target.setRGB(
        clamp01(0.05 + 0.9 * (panelIndex.x - 1) / mazeData.segments[0]),
        clamp01(0.05 + 0.9 * (panelIndex.y - 1) / mazeData.segments[1]),
        clamp01(0.05 + 0.9 * (panelIndex.z - 1) / mazeData.segments[2]),
    );
}

// That same color decomposed in sRGB: the space every decor palette below is
// authored in. Fills and returns `target` ({h, s, l}).
export function panelPaletteHSL(mazeData, panelIndex, target) {
    panelRenderedColor(mazeData, panelIndex, _panelColor);
    return _panelColor.getHSL(target, THREE.SRGBColorSpace);
}

// How far a decor may close on black or white before it stops reading as a
// surface at all. 0.75 leaves a quarter of the remaining range, which is what
// keeps a trace off pure black on the maze's darkest panel.
const MAX_HEADROOM_USE = 0.75;

// Shade an sRGB lightness by `offset` - a **constant offset in the space the
// player sees**, which is the whole point: the maze's gradient spans displayed
// lightness 0.12 to 0.88, and a decor is supposed to sit the same amount off
// its wall in the dark corner as in the bright one.
//
// Two tempting alternatives both fail at the corners. A flat offset applied
// raw overshoots and clips, which is where the black circuit traces came from.
// A *fraction* of the remaining headroom never clips but is not a constant
// offset at all - it shrinks to nothing at whichever end it is heading for, so
// a -0.11 trace that reads correctly mid-maze fades to -0.03 in the dark
// corner and deepens to -0.22 in the bright one, and a lightness *lift*
// (Lattice) inverts into a drop. Both leave the far corners feeling unlike the
// maze they belong to.
//
// So: the offset as authored wherever there is room for it, giving way only as
// the gradient's own end closes in, and never using more than
// MAX_HEADROOM_USE of what is left. Each kind's constant below is the
// displayed offset it had mid-maze, which is where the palettes were tuned.
export function shadeLightness(lightness, offset) {
    const l = clamp01(lightness);
    const headroom = offset >= 0 ? 1 - l : l;
    const eased = Math.min(Math.abs(offset), headroom * MAX_HEADROOM_USE);
    return clamp01(offset >= 0 ? l + eased : l - eased);
}

// Write an sRGB hue/saturation/lightness into `color` as the linear components
// a vertex color buffer wants. Hue wraps; saturation and lightness clamp.
export function setPaletteColor(color, hue, saturation, lightness) {
    return color.setHSL(
        ((hue % 1) + 1) % 1,
        clamp01(saturation),
        clamp01(lightness),
        THREE.SRGBColorSpace,
    );
}
