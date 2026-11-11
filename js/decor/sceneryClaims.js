/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Arbitration between the scenery decors when more than one wants the same
 * wall/ceiling/floor panel. Pure logic, no THREE/DOM - same philosophy as
 * mazeQuery.js.
 *
 * Every decor declares a PROFILE holding the interval it occupies along its
 * panel's outward normal, measured from the panel's room-facing face (so
 * negative reaches into the wall slab, positive out into the room). Two
 * decors conflict when those intervals overlap. Nothing is written down
 * pair by pair: each module derives its own band from its own geometry
 * constants, so changing a decor's height changes what it will share a
 * panel with, automatically.
 *
 * Two flags cover the cases the interval alone can't see:
 *   - unobtrusive: sparse/small enough to live inside another decor's volume
 *     rather than compete with it (splotches, drip sources).
 *   - exclusive: claims its volume outright and admits nothing, unobtrusive or
 *     not (skyline, whose silhouette is the whole point of it).
 *
 * `role` is how much of the panel a decor claims as its own. It orders the
 * build - the decor claiming most places first and never yields - and
 * backstops one case the bands miss: two decors that each own the whole
 * panel's composition but happen not to overlap in depth (a slab-only inlay
 * under a wholly-protruding skyline, say) still can't share, because the
 * panel can only read as one thing.
 *
 * Scope: a claim covers ONE SIDE of one panel. It says nothing about the
 * room in front of it, so a band reaching to Infinity (a ceiling drip,
 * falling away forever) only ever means "past anything else mountable on
 * this panel", never "down the whole column below it".
 */

// how much of a panel a decor claims, and so the order it places in
const ROLE = {
    RESERVED: 0, // navigation aids; placed before scenery, yields to nothing
    FEATURE: 1,  // owns the panel's composition
    ACCENT: 2,   // reads as its own object against whatever the panel is
    FILL: 3,     // opportunistic, fits around what's already there
};

function bandsOverlap(a, b) {
    return a[0] <= b[1] && b[0] <= a[1];
}

// true if these two decors may not share one side of one panel
function conflicts(a, b) {
    // a null profile claims nothing at all, so it can't contend for a panel
    if (!a || !b) return false;

    if (!bandsOverlap(a.band, b.band)) {
        return a.role === ROLE.FEATURE && b.role === ROLE.FEATURE;
    }
    // overlapping volume is fine when one side is small enough to sit
    // inside the other, unless the other admits nothing at all
    if (a.unobtrusive && !b.exclusive) return false;
    if (b.unobtrusive && !a.exclusive) return false;
    return true;
}

// Identifies one side of one panel. A panel index has exactly one even
// coordinate (rooms are all-odd), so the axis is implied and only the side
// needs naming - which is what keeps a room's +x face distinct from its
// neighbor's -x face while still recognizing them as one shared slab.
function panelKey(room, surface, side = surface.dir) {
    const axis = surface.axis;
    const p = { ...room, [axis]: room[axis] + surface.dir };
    return `${p.x},${p.y},${p.z}|${side}`;
}

// the same occupancy as seen from the panel's other face, for a decor that
// pokes clean through the slab (see LatticeStudsDecor)
function mirrorProfile(profile) {
    return { ...profile, band: [-profile.band[1], -profile.band[0]] };
}

// Orders decor instances by role, shuffling within each role so no one
// decor permanently wins every contested panel.
function orderForBuild(decors, rng = Math.random) {
    const roleOf = d => (d.constructor.PROFILE ? d.constructor.PROFILE.role : ROLE.FILL + 1);
    const shuffled = [...decors];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Array.prototype.sort is stable, so equal roles keep the shuffled order
    return shuffled.sort((a, b) => roleOf(a) - roleOf(b));
}

class SceneryClaims {
    constructor() {
        this._panels = new Map(); // panelKey -> Set of profiles held there
    }

    // which sides this profile occupies, and the profile as seen from each
    _sides(room, surface, profile) {
        const near = [panelKey(room, surface), profile];
        if (!profile.through) return [near];
        return [near, [panelKey(room, surface, -surface.dir), mirrorProfile(profile)]];
    }

    canClaim(room, surface, profile) {
        if (!profile) return true;
        return this._sides(room, surface, profile).every(([key, asSeen]) => {
            const held = this._panels.get(key);
            if (!held) return true;
            for (const other of held) {
                if (conflicts(asSeen, other)) return false;
            }
            return true;
        });
    }

    // claims every side this profile occupies, or leaves the ledger
    // untouched and returns false - never a partial claim
    claim(room, surface, profile) {
        if (!profile) return true;
        if (!this.canClaim(room, surface, profile)) return false;
        for (const [key, asSeen] of this._sides(room, surface, profile)) {
            if (!this._panels.has(key)) this._panels.set(key, new Set());
            this._panels.get(key).add(asSeen);
        }
        return true;
    }

    // the union of what's already claimed here, for an unobtrusive decor that
    // would rather sit on top of its neighbors than interpenetrate them
    bandOn(room, surface) {
        const held = this._panels.get(panelKey(room, surface));
        if (!held || held.size === 0) return null;
        let near = Infinity;
        let far = -Infinity;
        for (const profile of held) {
            near = Math.min(near, profile.band[0]);
            far = Math.max(far, profile.band[1]);
        }
        return [near, far];
    }
}

export { ROLE, SceneryClaims, conflicts, panelKey, bandsOverlap, mirrorProfile, orderForBuild };
export default SceneryClaims;
