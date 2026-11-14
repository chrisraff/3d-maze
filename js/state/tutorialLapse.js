/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * When a lesson has gone stale. Completed tutorials are remembered, but a
 * player who has been away long enough has forgotten the controls, so that
 * record is dropped and the lessons come back in order.
 *
 * Screen and VR lapse on their own clocks, off their own completion dates: the
 * two orders teach different gestures (see VR_TUTORIAL_ORDER in game.js), so a
 * month of play at a keyboard says nothing about whether the VR lessons are
 * still learned - and a week away from a headset is long enough that they are
 * not.
 *
 * Both clocks run on *completed mazes* rather than on sessions, since reaching
 * the exit is the proof that the lessons took. A player who has never finished
 * one in VR therefore always reads as lapsed, and the VR lessons keep being
 * offered until one does.
 */

/** 30 days with no completed maze and the screen lessons are offered again. */
export const SCREEN_LAPSE_MS = 1000 * 60 * 60 * 24 * 30;

/** A week with no maze completed *in VR* and the VR lessons come back. */
export const VR_LAPSE_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * Whether a record kept since `lastCompletion` has lapsed. A missing date (0)
 * always has - nothing has ever proved those lessons stuck.
 */
export function hasLapsed(lastCompletion, lapseMs, now = Date.now()) {
    return (now - lastCompletion) > lapseMs;
}

/**
 * The completed types still worth believing, given which orders have lapsed.
 * Every type is judged by the order it belongs to, so the two records expire
 * independently rather than either one wiping the other.
 */
export function liveTutorialsSeen(seen, vrTypes, { screenLapsed = false, vrLapsed = false } = {}) {
    const isVrType = new Set(vrTypes);
    return seen.filter((type) => isVrType.has(type) ? !vrLapsed : !screenLapsed);
}
