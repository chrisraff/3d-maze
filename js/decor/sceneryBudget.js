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
 */
function sceneryBudget(mazeData, weight = 1, { min = 1, max = Infinity } = {}, rng = Math.random) {
    const wanted = DENSITY * weight * roomCount(mazeData);
    const whole = Math.floor(wanted);
    const count = whole + (rng() < wanted - whole ? 1 : 0);
    return Math.max(min, Math.min(max, count));
}

/** The budget for a decor class, from its `static WEIGHT` and `static BUDGET`. */
function budgetFor(mazeData, kind, rng = Math.random) {
    return sceneryBudget(mazeData, kind.WEIGHT ?? 1, kind.BUDGET ?? {}, rng);
}

export { DENSITY, roomCount, sceneryBudget, budgetFor };
