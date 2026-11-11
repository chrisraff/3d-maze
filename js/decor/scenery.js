/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Every kind of scenery grown across the maze's walls, ceilings and floors.
 * Each Decor class exposes addTo(scene) and build(mazeData, rng), plus
 * update(dt) if it animates (see DripsDecor).
 */
import DripsDecor from './DripsDecor.js';
import LatticeStudsDecor from './LatticeStudsDecor.js';
import SplotchesDecor from './SplotchesDecor.js';
import SkylineDecor from './SkylineDecor.js';
import CircuitDecor from './CircuitDecor.js';
import MosaicDecor from './MosaicDecor.js';
import PipesDecor from './PipesDecor.js';

const SCENERY_DECORS = [
    DripsDecor,
    LatticeStudsDecor,
    SplotchesDecor,
    SkylineDecor,
    CircuitDecor,
    MosaicDecor,
    PipesDecor,
];

export default SCENERY_DECORS;
