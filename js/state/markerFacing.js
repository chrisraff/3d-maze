/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Which way a marker points when the player places one: back at them ("this
 * branch is spent", the default) or away ("this is where I was going"). A
 * setting rather than a maze option - it describes a gesture, not a maze, so
 * it lands on the very next placement instead of the next maze.
 *
 * Screen and VR hold separate values behind one control, because the gesture
 * is not the same one: a click aims a marker with the whole camera, while a
 * controller aims it with a hand that can already point down the corridor.
 * Settings.js persists both and reflects each into its own half of the menu;
 * BreadcrumbManager reads whichever the player is currently playing through.
 */

export const MARKER_FACING_MODES = ['toward', 'away'];

/** What an unset or unreadable stored value falls back to, in both contexts. */
export const MARKER_FACING_DEFAULT = 'toward';

// One stored value per context, the key doubling as the control's `name` the
// way the VR and maze settings do. They are deliberately different names, so
// the two halves of the control edit a value each rather than mirroring one.
export const MARKER_FACING_STORAGE_KEYS = {
    screen: 'setting-marker-facing',
    vr: 'vr-setting-marker-facing',
};

export const MARKER_FACING_CONTEXT_BY_KEY = Object.fromEntries(
    Object.entries(MARKER_FACING_STORAGE_KEYS).map(([context, key]) => [key, context]));

/** Which stored value is in force while the player is (or isn't) in VR. */
export function markerFacingContext(isPresenting) {
    return isPresenting ? 'vr' : 'screen';
}

/**
 * A stored or submitted value, or the default if it isn't one of the modes -
 * a stale key from an older build shouldn't aim markers nobody asked for.
 */
export function coerceMarkerFacing(value) {
    return MARKER_FACING_MODES.includes(value) ? value : MARKER_FACING_DEFAULT;
}

/**
 * The other mode, which is what the double click/tap aims a marker: the
 * gesture means "not that way, this way", so it is the reverse of whatever
 * the setting just placed rather than a fixed direction of its own.
 */
export function reverseMarkerFacing(mode) {
    return coerceMarkerFacing(mode) === 'away' ? 'toward' : 'away';
}
