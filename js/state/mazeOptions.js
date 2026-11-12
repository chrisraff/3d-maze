/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * The maze generation options behind the Customize menu, as values rather
 * than as UI: what modes exist, what a stored value coerces to, and the
 * scenery multiplier a mode implies. Both are read when a maze is generated,
 * never mid-run, so changing one leaves the maze you are standing in alone
 * and takes effect on the next one - the menu says so. Settings.js persists
 * them and reflects them into the menu; game.js applies them in buildMaze.
 */

// How much scenery (drips, pipes, circuits...) a maze grows.
export const SCENERY_MODES = ['on', 'sparse', 'off'];

// How a maze hands out markers. 'on' stocks half the dead ends with a finite
// supply to find and re-place; 'unlimited' stocks none and hands them out of
// a bottomless stack instead; 'off' gives none at all.
export const MARKER_MODES = ['unlimited', 'on', 'off'];

export const MAZE_OPTION_MODES = {
    scenery: SCENERY_MODES,
    markers: MARKER_MODES,
};

// the modes the game was tuned at, and what an unset or unreadable stored
// value falls back to
export const MAZE_OPTION_DEFAULTS = {
    scenery: 'on',
    markers: 'on',
};

// A radio group's `name` doubles as its storage key, as the VR settings do,
// so one string is enough to find the controls and the stored value both.
export const MAZE_OPTION_STORAGE_KEYS = {
    scenery: 'maze-setting-scenery',
    markers: 'maze-setting-markers',
};

export const MAZE_OPTION_BY_KEY = Object.fromEntries(
    Object.entries(MAZE_OPTION_STORAGE_KEYS).map(([option, key]) => [key, option]));

/**
 * What Sparse multiplies every kind's budget by (sceneryBudget.js): a third,
 * which lands the default maze near 7% of its panels holding something
 * instead of 20%. Thinning every kind at once rather than dropping some of
 * them keeps a sparse maze the same world with less in it.
 */
export const SPARSE_SCENERY_SCALE = 1 / 3;

/** The budget multiplier a scenery mode implies; 0 places nothing at all. */
export function sceneryScaleFor(mode) {
    switch (mode) {
        case 'off': return 0;
        case 'sparse': return SPARSE_SCENERY_SCALE;
        default: return 1;
    }
}

/**
 * A stored or submitted value for `option`, or its default if that isn't one
 * of the modes - a stale key from an older build shouldn't generate a maze
 * nobody asked for.
 */
export function coerceMazeOption(option, value) {
    return MAZE_OPTION_MODES[option]?.includes(value)
        ? value
        : MAZE_OPTION_DEFAULTS[option];
}

/** A complete, valid set of options, with anything missing defaulted. */
export function coerceMazeOptions(options = {}) {
    const result = {};
    for (const option of Object.keys(MAZE_OPTION_MODES))
        result[option] = coerceMazeOption(option, options[option]);
    return result;
}
