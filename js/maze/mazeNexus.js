/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Finds the places in a maze that read as one branchy junction, so scenery can
 * be spent where a player is choosing. Pure logic over mazeData, no THREE/DOM.
 *
 * A nexus is an AREA, not a cell: hand-labelled ones averaged 4.6 cells and
 * 4.0 ways out. It comes back as a region plus its ways out, since the design
 * needs a feature per way out and the region is where they are seen from.
 *
 * Seeds are cells whose `sightScore` clears `thresh` - the ways out of
 * everything the cell can see down its straight corridors, not of the cell
 * itself. A cell's own branch count barely discriminates, since about a
 * quarter of all cells in a tree maze are junctions.
 *
 * Two things to know before tuning:
 *
 * - **A higher `thresh` does not reliably give fewer nexuses.** The seed it
 *   removes can be the one bridging two groups, splitting one nexus in two.
 *   Only `radius` is monotone in the count.
 * - **Region size has a long tail that grows with the maze.** Clustering is
 *   transitive, so a chain of junctions each within `radius` of the next is
 *   one nexus however long it runs: median 3-4 cells, but 15% exceed 12 at
 *   size 9 and those hold about half of all region cells. Nothing caps it, so
 *   anything spending per nexus should bound its own spend.
 *
 * For placement: from the best single cell of a nexus you can see only 2.7 of
 * its 5.7 ways out, and from nowhere in one can you see them all. **The
 * decision point is the cell** - its own open sides are straight rays, so
 * their `sightlineEnd` features are in view together by construction.
 */
import { cellMap, openSides, pathBetween, segmentKey, sightScore, waysOut, reachableWithin } from './mazeQuery.js';

const DEFAULTS = {
    // a way out dying within this many cells is not a branch
    stub: 1,
    // the sight score a cell needs to seed a nexus
    thresh: 3,
    // seeds this far apart in cells of travel belong to the same nexus
    radius: 2,
};

// union-find over seeds, by segmentKey
function makeGroups() {
    const parent = new Map();
    const find = key => {
        while (parent.get(key) !== key) {
            parent.set(key, parent.get(parent.get(key)));
            key = parent.get(key);
        }
        return key;
    };
    return {
        add: key => parent.set(key, key),
        find,
        union: (a, b) => {
            const [ra, rb] = [find(a), find(b)];
            if (ra !== rb) parent.set(ra, rb);
        },
    };
}

/**
 * The nexuses of `mazeData`, each as:
 *   region   a cell map (see mazeQuery.cellMap) of the cells it covers
 *   seeds    the high-scoring cells it was built from
 *   branches its ways out, as { room, surface } - one per way out, each the
 *            cell inside the region and the surface leading away. Pair with
 *            `sightlineEnd` to get the panel a feature goes on.
 */
function findNexuses(mazeData, options = {}) {
    const { stub, thresh, radius } = { ...DEFAULTS, ...options };

    // A seed must be a junction AND stand somewhere branchy. The degree test
    // is load-bearing: a plain corridor cell can see as far as the junction it
    // is looking at, and without it the clusters run together across the maze.
    // It is also the condition `thresh` was calibrated under.
    const seeds = [];
    for (let x = 1; x <= mazeData.bounds[0] * 2 - 1; x += 2)
        for (let y = 1; y <= mazeData.bounds[1] * 2 - 1; y += 2)
            for (let z = 1; z <= mazeData.bounds[2] * 2 - 1; z += 2) {
                const room = { x, y, z };
                if (openSides(mazeData, room).length < 3) continue;
                if (sightScore(mazeData, room, stub) >= thresh) seeds.push(room);
            }

    const groups = makeGroups();
    for (const seed of seeds) groups.add(segmentKey(mazeData, seed));
    for (const seed of seeds) {
        const near = reachableWithin(mazeData, seed, radius);
        for (const other of seeds) {
            const key = segmentKey(mazeData, other);
            if (other !== seed && near.has(key))
                groups.union(segmentKey(mazeData, seed), key);
        }
    }

    const clusters = new Map();
    for (const seed of seeds) {
        const root = groups.find(segmentKey(mazeData, seed));
        if (!clusters.has(root)) clusters.set(root, []);
        clusters.get(root).push(seed);
    }

    const nexuses = [];
    for (const cluster of clusters.values()) {
        // Smallest connected area holding every seed. In a tree that is the
        // union of the paths from any one seed to all the others, so it costs
        // one BFS per seed rather than one per pair.
        const region = cellMap(mazeData, cluster);
        for (const seed of cluster)
            for (const cell of pathBetween(mazeData, cluster[0], seed) ?? [])
                region.set(segmentKey(mazeData, cell), cell);

        nexuses.push({
            region,
            seeds: cluster,
            branches: waysOut(mazeData, region, stub),
        });
    }
    return nexuses;
}

export { findNexuses, DEFAULTS };
export default findNexuses;
