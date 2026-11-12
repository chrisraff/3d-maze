/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * How many pieces each decor places: proportional to the room count, so
 * density holds across the size slider (2-12) instead of being set off one
 * axis.
 *
 * Tuned so ~20% of the maze's solid panel sides end up claimed (measured
 * 19.4-20.3%, sizes 3-12). Panel supply is exactly 4 per room - every maze is
 * a spanning tree - so rooms and panels are the same denominator. A
 * multi-panel kind pays for every panel it covers, except Drips, which claims
 * its source only.
 *
 * Weights are not comparable between kinds: a "piece" is one panel for
 * Skyline, a run for Pipes, a grown region for Circuits. They are all 1,
 * which is an even mix of pieces rather than of panels - Circuits and
 * Splotches are over half the claimed panels between them. A weight is the
 * dial for changing a kind's share.
 */

// pieces per room, per unit weight
const DENSITY = 0.057;

/**
 * A multiplier on every kind's budget at once: the Scenery option
 * (mazeOptions.js), 1 as tuned above. Module state, set once per maze by
 * buildMaze, rather than an argument threaded through seven build()
 * signatures - each kind already reaches in here for its own count.
 */
let densityScale = 1;

function setSceneryDensityScale(scale) {
    densityScale = scale;
}

function sceneryDensityScale() {
    return densityScale;
}

const roomCount = mazeData => mazeData.bounds.reduce((a, b) => a * b, 1);

/**
 * The number of pieces a decor of weight `weight` places in this maze.
 *
 * The fractional part is rolled for rather than rounded, because a kind's
 * share of the default maze is 1.5 pieces: rounding made size 3 untunable,
 * jumping from 13% to 24% occupancy with nothing reachable between.
 *
 * `min` keeps a kind from vanishing in a small maze, and only binds below
 * ~18 rooms. `max` caps a kind whose pieces get expensive (see SkylineDecor).
 * `min` applies before the density scale, so it floors what a kind asks for
 * rather than what it gets - Off places nothing, and Sparse can thin a kind
 * out of a small maze.
 */
function sceneryBudget(mazeData, weight = 1, { min = 1, max = Infinity } = {}, rng = Math.random) {
    const wanted = Math.max(min, DENSITY * weight * roomCount(mazeData)) * densityScale;
    const whole = Math.floor(wanted);
    const count = whole + (rng() < wanted - whole ? 1 : 0);
    return Math.min(max, count);
}

/** The budget for a decor class, from its `static WEIGHT` and `static BUDGET`. */
function budgetFor(mazeData, kind, rng = Math.random) {
    return sceneryBudget(mazeData, kind.WEIGHT ?? 1, kind.BUDGET ?? {}, rng);
}

export { DENSITY, roomCount, sceneryBudget, budgetFor, setSceneryDensityScale, sceneryDensityScale };
