/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Steers scenery onto the panels a player looks at when choosing a branch,
 * instead of letting every kind land uniformly at random. Pure logic over
 * mazeData, no THREE/DOM.
 *
 * A nexus's branches are its ways out (mazeNexus.js). The panel worth
 * decorating for one of them is its `sightlineEnd`, so a feature there is
 * what you see when you look down that branch. This only moves scenery; a
 * kind still places exactly the number of pieces its budget gives it.
 *
 * Sites are dealt out here, before anything builds, because `orderForBuild`
 * runs in role order (sceneryClaims.js) and build order must not double as
 * site-quality order. Branches of one nexus go to different kinds, cycling,
 * since telling two apart is the point.
 *
 * Every kind but Drips opts in, which is enough pieces to cover every site:
 * measured ~100% of both branch ends and stub ends marked, sizes 5-12, and
 * 95%/83% at size 3 where there are only a handful of pieces. So a branch
 * almost always has an identity, and a feature says nothing about whether the
 * opening leads anywhere - which is the point of stubs being sites.
 */
import { findNexuses } from '../maze/mazeNexus.js';
import {
    ALL_SURFACES, panelSolid, randomInt, randomRoom, sightlineEnd, waysOut,
} from '../maze/mazeQuery.js';

// one side of one panel, the same identity sceneryClaims.js arbitrates over
const siteKey = ({ room, surface }) =>
    `${room.x},${room.y},${room.z}|${surface.axis}${surface.dir}`;

function shuffled(list, rng) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/**
 * The panels worth decorating, grouped by nexus: one per opening, at the far
 * end of the view down it.
 *
 * Every opening, stubs included - `waysOut` with stub 0 rather than the
 * nexus's own `branches`. A nexus's branches exclude trivial dead ends,
 * because that is how the places were labelled, but marking only those would
 * make absence of a feature a reliable "nothing down there".
 *
 * A panel holds one feature, so each is offered once across the whole maze,
 * not once per nexus. Two openings sharing an end panel is common within a
 * nexus and happens between neighbouring ones too.
 */
function branchSitesOf(mazeData, options = {}) {
    const taken = new Set();
    return findNexuses(mazeData, options).map(nexus => {
        const sites = [];
        for (const { room, surface } of waysOut(mazeData, nexus.region, 0)) {
            const site = sightlineEnd(mazeData, room, surface);
            // a ray ending on the maze's entrance or exit hole names an open
            // panel, which can hold nothing
            if (!panelSolid(mazeData, site.room, surface.axis, surface.dir)) continue;
            const key = siteKey(site);
            if (taken.has(key)) continue;
            taken.add(key);
            sites.push(site);
        }
        return sites;
    });
}

/**
 * Deals this maze's branch sites out to the kinds that opt in with
 * `static BRANCH_SITES = true`. A kind takes its allocation first and falls
 * back to a uniform draw once it runs out.
 */
class BranchSites {
    constructor(mazeData, decors, rng = Math.random, options = {}) {
        this.mazeData = mazeData;
        this._queues = new Map();   // decor class -> sites not yet offered
        this._counts = new Map();   // decor class -> { assigned, placed }

        // instances (as game.js has them) or the classes themselves; going
        // via `.constructor` for both resolves a class to `Function`
        const kinds = decors
            .map(decor => (typeof decor === 'function' ? decor : decor.constructor))
            .filter(kind => kind?.BRANCH_SITES);
        if (kinds.length === 0) return;

        for (const kind of kinds) {
            this._queues.set(kind, []);
            this._counts.set(kind, { assigned: 0, placed: 0 });
        }

        // cycle kinds within each nexus so its branches differ, carrying
        // `turn` across nexuses so no one kind always gets first pick
        let turn = randomInt(rng, kinds.length);
        for (const nexus of branchSitesOf(mazeData, options)) {
            const order = shuffled(kinds, rng);
            for (const site of shuffled(nexus, rng)) {
                const kind = order[turn % order.length];
                turn++;
                this._queues.get(kind).push(site);
                this._counts.get(kind).assigned++;
            }
        }
    }

    /** The next branch site offered to this kind, or null once it has run out. */
    take(kind) {
        return this._queues.get(kind)?.shift() ?? null;
    }

    /** Called when a kind actually claims a site it was offered. */
    recordPlaced(kind) {
        const count = this._counts.get(kind);
        if (count) count.placed++;
    }

    /**
     * Assigned against placed, per kind. Leftover sites are normal - a kind is
     * dealt more than it has pieces for. Only `placed === 0` with sites
     * assigned means something is wrong, namely that every panel it tried was
     * already claimed.
     */
    report() {
        const out = {};
        for (const [kind, count] of this._counts) out[kind.name] = { ...count };
        return out;
    }
}

const noop = () => {};

/**
 * Solid panels to try, in order of preference: this kind's assigned branch
 * sites, then uniform draws. Lazy, so a caller that stops after the first
 * usable one leaves the rest of its allocation for its next piece.
 *
 * Each candidate carries `commit()`, to be called once the piece is actually
 * going in. A decor that validates a panel before taking it - growing a
 * region that may come out too small, laying a run that may not fit - needs
 * this rather than `pickSite`, which claims as it picks.
 */
function* candidateSites(mazeData, rng, kind, sites = null, maxAttempts = 30) {
    for (let site = sites?.take(kind); site; site = sites.take(kind))
        yield { ...site, commit: () => sites.recordPlaced(kind) };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const room = randomRoom(mazeData, rng);
        const surface = ALL_SURFACES[randomInt(rng, ALL_SURFACES.length)];
        if (panelSolid(mazeData, room, surface.axis, surface.dir))
            yield { room, surface, commit: noop };
    }
}

/**
 * Picks and claims one panel, for a decor that occupies exactly what it
 * picks. A contested panel is dropped and the next one tried, so the decor
 * still gets a panel, just not that one.
 */
function pickSite(mazeData, rng, claims, kind, sites = null, maxAttempts = 30) {
    for (const { room, surface, commit } of candidateSites(mazeData, rng, kind, sites, maxAttempts)) {
        if (!claims.claim(room, surface, kind.PROFILE)) continue;
        commit();
        return { room, surface };
    }
    return null;
}

export { BranchSites, branchSitesOf, candidateSites, pickSite };
export default BranchSites;
