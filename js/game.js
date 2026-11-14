/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FlyPointerLockControls } from './input/controls.js';
import * as maze from './maze/maze.js';
import { storageGetItem, storageSetItem } from './state/storage.js';
import DustEffect from './render/dust.js';
import TrailEffect from './render/trail.js';
import PlayerCollider from './maze/PlayerCollider.js';
import CompassManager from './ui/compassManager.js';
import VRManager from './vr/VRManager.js';
import TutorialManager from './ui/TutorialManager.js';
import MenuManager from './ui/MenuManager.js';
import BreadcrumbManager from './breadcrumbs/BreadcrumbManager.js';
import TouchArbiter from './input/TouchArbiter.js';
import TouchJoystick from './input/TouchJoystick.js';
import GoalDotEffect from './ui/goalDots.js';
import { mountGoalIcons } from './ui/GoalDotIcon.js';
import { setBreadcrumbIconGeometry, mountBreadcrumbIcons } from './breadcrumbs/BreadcrumbIcon.js';
import bus from './state/EventBus.js';
import initAnalytics from './state/analytics.js';
import GameSession, { formatMazeTime } from './state/GameSession.js';
import RunHistory from './state/RunHistory.js';
import MazeWorld from './maze/MazeWorld.js';
import MazeIntroCinematic from './MazeIntroCinematic.js';
import SCENERY_DECORS from './decor/scenery.js';
import { SceneryClaims, orderForBuild } from './decor/sceneryClaims.js';
import BranchSites from './decor/branchSites.js';
import Settings from './state/Settings.js';
import { MAZE_OPTION_DEFAULTS, sceneryScaleFor } from './state/mazeOptions.js';
import { SCREEN_LAPSE_MS, VR_LAPSE_MS, hasLapsed, liveTutorialsSeen } from './state/tutorialLapse.js';
import { setSceneryDensityScale } from './decor/sceneryBudget.js';

initAnalytics();

// webpage objects

var renderer;

var compassManager;

// ui variables
var menuManager = null;

// basic objects
var fpsClock;

var scene;
var cameraNode;
var cameraCompensationNode;
var camera;

var spectator;

// vr state
var vrManager;

// user settings
var settings;

// textures
var dotSprite;

// controls
var controls;

// goal particles
var goalDots;

var tmpVector;

// maze variables
var mazeSize;
var mazeData;
var mazeWorld;
// scenery (drips, pipes, etc.) grown across maze walls/ceilings - one
// instance of every kind in scenery.js, rebuilt for each new maze
var scenery = [];
// run state (timer + checkpoints)
var session;
// save the positions of the entrance and exit of the maze
var startPos;
var segments;
var endPos;
// collisions
var playerCollider;
// history
var runHistory;
// breadcrumbs
var breadcrumbs;
var touchArbiter;
var touchJoystick;

var dust;
var trail;

var dustSize   = 0.025;
var dustSizeVR = 0.0075;

var tutorialManager;
// screen tutorials, one per maze in this order
const TUTORIAL_ORDER = ['intro', 'breadcrumbs', 'breadcrumb-reaim'];
// Entering VR swaps the order wholesale (setTutorialOrder). The marker lesson
// there is its own type rather than VR copy on the screen one: a lesson
// teaches a gesture, so learning markers with a mouse says nothing about
// taking one off the end of a beam - and the screen steps live outside
// #overlay, which a headset never draws. There is no VR re-aim lesson because
// there is no VR re-aim: both VR placements already aim the marker by where
// the hand or the head was pointing.
const VR_TUTORIAL_ORDER = ['vr', 'vr-breadcrumbs'];
// Lessons that finishing does not record. The VR movement lesson is mostly
// timed beats, so sitting through it proves nothing: a player who put a
// headset on, watched it and backed out should be taught again next time.
// What records it is a maze finished in VR (onMazeCompleted) - proof they can
// actually get around in one. Its steps running out still stops it repeating
// for the rest of this page load.
const PROVEN_BY_VR_COMPLETION = ['vr'];
// The marker lessons and the supply each needs: finding one only means
// something where markers stand in the maze; re-aiming just needs one in hand.
const MARKER_TUTORIALS = {
    'breadcrumbs': (markerMode) => markerMode === 'on',
    'breadcrumb-reaim': (markerMode) => markerMode !== 'off',
    'vr-breadcrumbs': (markerMode) => markerMode === 'on',
};
// which types the player has finished, minus whichever order has lapsed
// (tutorialLapse.js); kept so that hiding a lesson for one maze is never
// mistaken for having learned it
var tutorialsSeen = [];
// markers placed before the re-aim lesson offers itself - it refines a habit,
// so it waits until the player has one to refine
const REAIM_AFTER_PLACEMENTS = 5;
var playerLight;
var introCinematic;
// armed before controls.lock() - on touch devices lock() dispatches its event
// synchronously - and consumed by the lock handler, so the shot only starts
// once the player is actually in the maze and the menu is gone
var introCinematicPending = false;
// a first-time player has no idea what the shot is about to show them, so it
// plays through; everyone else can cut it short
var hasCompletedMaze = false;
// the shot establishes the maze in front of the player, so it belongs to that
// maze and plays once for it - not again on every lock, which is what a VR
// session in the middle of a run used to leave behind
var introCinematicShown = false;
// set from sessionstart/sessionend rather than read off renderer.xr, which the
// VR mirror blanks mid-frame (see Settings.vrPresenting)
var vrPresenting = false;


function loadSavedVariables()
{
    const lastMazeCompletionDate = Number(storageGetItem('lastMazeCompletionDate', '0'));
    hasCompletedMaze = lastMazeCompletionDate > 0;

    // each order is offered again after a long enough gap, measured against
    // its own completions (tutorialLapse.js)
    const screenLapsed = hasLapsed(lastMazeCompletionDate, SCREEN_LAPSE_MS);
    const vrLapsed = hasLapsed(
        Number(storageGetItem('lastVrMazeCompletionDate', '0')), VR_LAPSE_MS);

    // Which types are done, dropping whichever order has lapsed. 'intro' is
    // seeded so players predating this key skip it.
    tutorialsSeen = liveTutorialsSeen(
        ['intro', ...storageGetItem('tutorialsSeen', '').split(',').filter(Boolean)],
        VR_TUTORIAL_ORDER,
        { screenLapsed, vrLapsed });

    const showTutorials = {};
    // both orders, since a type is only ever offered under its own
    for (const type of [...TUTORIAL_ORDER, ...VR_TUTORIAL_ORDER])
        showTutorials[type] = !tutorialsSeen.includes(type);

    const tutorialCallbacks = {
        intro: {
            // they reached the exit, so they know the controls
            satisfiedByGoal: true,
            conditions: {
                0: (tutorialData) => {
                    return cameraNode && cameraNode.getWorldDirection(tmpVector).z > -0.975;
                },
                1: (tutorialData) => {
                    return cameraNode && cameraNode.position.distanceToSquared(tutorialData.cameraPos) > 4;
                },
                2: (tutorialData) => {
                    return Date.now() - tutorialData.lastLoggedTime > 6000;
                }
            },
            setup: {
                0: (tutorialData) => {
                    if (isMobile) {
                        const el = document.querySelector('#touch-tutorial-look');
                        el.style.display = '';
                        el.style.animationName = 'touch-tutorial-animation-look';
                    }
                },
                1: (tutorialData) => {
                    tutorialData.cameraPos = cameraNode.position.clone();

                    if (isMobile) {
                        const el = document.querySelector('#touch-tutorial-look');
                        el.style.display = 'none';
                        el.style.animationName = '';
                        const moveEl = document.querySelector('#touch-tutorial-move');
                        moveEl.style.display = '';
                        moveEl.style.animationName = 'touch-tutorial-animation-move';
                    }
                },
                2: (tutorialData) => {
                    tutorialData.lastLoggedTime = Date.now();

                    if (isMobile) {
                        document.querySelector('#touch-tutorial-move').style.display = 'none';
                        document.querySelector('#touch-tutorial-move').style.animationName = '';
                    }

                    document.querySelector('#computer-tutorial-compass').style.animationFillMode = 'forwards';
                    document.querySelector('#compass-container').style.animationName = 'compass-tutorial-highlight';
                }
            },
            teardown: (tutorialData) => {
                document.querySelector('#compass-container').style.animationName = '';
            }
        },
        breadcrumbs: {
            // a few cells is enough: markers sit at dead ends, and a player who
            // only ever sees one from the mouth of a corridor turns around
            available: () => breadcrumbs.nearestInSight !== null
                && !breadcrumbs.playerLeft(breadcrumbs.nearestInSight),
            conditions: {
                0: () => breadcrumbs.nearestInView !== null,
                1: (tutorialData) => breadcrumbs.pickupCount > tutorialData.pickupStart,
                2: (tutorialData) => breadcrumbs.placeCount > tutorialData.placeStart,
                3: (tutorialData) => Date.now() - tutorialData.lastLoggedTime > 6000
            },
            setup: {
                0: (tutorialData) => {
                    // kept for later steps: carrying one takes it out of
                    // `breadcrumbs`, and placing it empties the stack
                    tutorialData.marker = breadcrumbs.nearestInSight;
                    mountBreadcrumbIcons(tutorialData.marker);
                    // the only place the glow is ever driven by anything but
                    // proximity, and only while this step is asking for a walk
                    breadcrumbs.setTutorialFlash(tutorialData.marker);
                },
                1: (tutorialData) => {
                    breadcrumbs.setTutorialFlash(null);
                    tutorialData.pickupStart = breadcrumbs.pickupCount;
                    // they may have walked up to a different one
                    tutorialData.marker = breadcrumbs.nearestInView ?? tutorialData.marker;
                    mountBreadcrumbIcons(tutorialData.marker);
                },
                2: (tutorialData) => {
                    tutorialData.placeStart = breadcrumbs.placeCount;
                },
                3: (tutorialData) => {
                    tutorialData.lastLoggedTime = Date.now();
                    mountBreadcrumbIcons(tutorialData.marker
                        ?? breadcrumbs.nearestReachable ?? breadcrumbs.nextInStack);
                }
            },
            abandoned: {
                // only the walk is abandonable - later steps are at the marker
                0: (tutorialData) => breadcrumbs.playerLeft(tutorialData.marker)
            },
            teardown: () => breadcrumbs.setTutorialFlash(null)
        },
        'breadcrumb-reaim': {
            // Follows the lesson above, once a few markers are down and the
            // next is in hand. Unoffered, it stays armed for the next maze.
            chained: true,
            available: () => breadcrumbs.placeCount >= REAIM_AFTER_PLACEMENTS
                && breadcrumbs.breadcrumbStack.length > 0,
            conditions: {
                // no action required: advance once they try it, or on a timer
                0: (tutorialData) => breadcrumbs.reaimCount > tutorialData.reaimStart
                    || Date.now() - tutorialData.lastLoggedTime > 10000
            },
            setup: {
                0: (tutorialData) => {
                    tutorialData.reaimStart = breadcrumbs.reaimCount;
                    tutorialData.lastLoggedTime = Date.now();
                    // the gate guarantees they are holding one
                    mountBreadcrumbIcons(breadcrumbs.nextInStack);
                }
            }
        },
        vr: {
            // Gaze has no step 3: its one button is already spoken for, so
            // pausing is the options ring step 2 just taught and the step
            // holds no copy for it. End at the ring rather than sit on a
            // blank panel for six seconds.
            lastStep: () => vrManager.isUsingGazeControls ? 2 : 3,
            conditions: {
                0: (tutorialData) => {
                    return cameraNode && cameraNode.position.distanceToSquared(tutorialData.cameraPos) > 1;
                },
                1: (tutorialData) => {
                    if (vrManager.isUsingGazeControls) {
                        // For gaze controls, they can't rotate so just wait 6 seconds
                        return Date.now() - tutorialData.lastLoggedTime > 6000;
                    }

                    if (cameraNode && cameraNode.rotation.y != tutorialData.rotationStart)
                        tutorialData.rotateCondition = true;
                    return (tutorialData.rotateCondition && Date.now() - tutorialData.lastLoggedTime > 4000);
                },
                2: (tutorialData) => {
                    return Date.now() - tutorialData.lastLoggedTime > 6000;
                },
                3: (tutorialData) => {
                    return Date.now() - tutorialData.lastLoggedTime > 6000;
                }
            },
            setup: {
                0: (tutorialData) => {
                    tutorialData.cameraPos = cameraNode.position.clone();
                    vrManager.updateControlSchemeDisplay();
                },
                1: (tutorialData) => {
                    tutorialData.lastLoggedTime = Date.now();
                    tutorialData.rotationStart = cameraNode.rotation.y;
                    tutorialData.rotateCondition = false;
                },
                2: (tutorialData) => {
                    tutorialData.lastLoggedTime = Date.now();
                },
                3: (tutorialData) => {
                    tutorialData.lastLoggedTime = Date.now();
                }
            }
        },
        // Markers in VR, keyed to the control scheme: a controller takes one
        // off the end of its beam and places by holding the trigger, while
        // gaze taps and goes through the options ring. The copy for each lives
        // in the step's .vr-controls-* spans (index.html).
        'vr-breadcrumbs': {
            // follows the movement lesson rather than waiting for the next
            // maze, so a player's first VR session gets to this one
            chained: true,
            // the screen lesson's gate: a marker in sight down the corridor,
            // with the player still standing where they saw it
            available: () => breadcrumbs.nearestInSight !== null
                && !breadcrumbs.playerLeft(breadcrumbs.nearestInSight),
            conditions: {
                0: () => breadcrumbs.nearestInView !== null,
                1: (tutorialData) => breadcrumbs.pickupCount > tutorialData.pickupStart,
                // the press that starts a placement, under either scheme. A
                // pull quick enough to begin and finish one inside a single
                // frame never shows as 'placing', so a placement already
                // counted clears this step too
                2: (tutorialData) => breadcrumbs.interactState === 'placing'
                    || breadcrumbs.isGazePlacing
                    || breadcrumbs.placeCount > tutorialData.placeStart,
                3: (tutorialData) => breadcrumbs.placeCount > tutorialData.placeStart,
                4: (tutorialData) => Date.now() - tutorialData.lastLoggedTime > 6000
            },
            setup: {
                0: (tutorialData) => {
                    // which scheme's copy to show is the whole point of this
                    // lesson, and a controller can connect late
                    vrManager.updateControlSchemeDisplay();
                    // kept for later steps: carrying one takes it out of
                    // `breadcrumbs`, and placing it empties the stack
                    tutorialData.marker = breadcrumbs.nearestInSight;
                    mountVrMarkerIcons(tutorialData.marker);
                    breadcrumbs.setTutorialFlash(tutorialData.marker);
                },
                1: (tutorialData) => {
                    breadcrumbs.setTutorialFlash(null);
                    tutorialData.pickupStart = breadcrumbs.pickupCount;
                    // they may have pointed at a different one on the way in
                    tutorialData.marker = breadcrumbs.nearestInView ?? tutorialData.marker;
                    mountVrMarkerIcons(tutorialData.marker);
                },
                // one baseline for both halves of the placement, so a pull
                // that clears step 2 by placing outright doesn't leave step 3
                // waiting for a second marker
                2: (tutorialData) => {
                    tutorialData.placeStart = breadcrumbs.placeCount;
                },
                4: (tutorialData) => {
                    tutorialData.lastLoggedTime = Date.now();
                    mountVrMarkerIcons(tutorialData.marker
                        ?? breadcrumbs.nearestReachable ?? breadcrumbs.nextInStack);
                }
            },
            abandoned: {
                // only the walk is abandonable - later steps are at the marker
                0: (tutorialData) => breadcrumbs.playerLeft(tutorialData.marker)
            },
            teardown: () => breadcrumbs.setTutorialFlash(null)
        }
    };

    tutorialManager = new TutorialManager({
        showTutorials,
        tutorialOrder: TUTORIAL_ORDER,
        callbacks: tutorialCallbacks,
        onTutorialComplete: (type) => {
            if (PROVEN_BY_VR_COMPLETION.includes(type)) return;
            recordTutorialSeen(type);
        }
    });

    document.querySelectorAll('.menu-experienced').forEach((el) => {
        el.style.display = screenLapsed ? 'none' : '';
    });
}

/**
 * Write a lesson down as learned. Also clears its show flag, since this is
 * called for a lesson the player wasn't necessarily running at the time -
 * a maze finished in VR proves the movement lesson whichever lesson, if any,
 * is on the panel when they reach the exit.
 */
function recordTutorialSeen(type) {
    if (tutorialManager) tutorialManager.showTutorials[type] = false;

    if (tutorialsSeen.includes(type)) return;
    tutorialsSeen.push(type);
    storageSetItem('tutorialsSeen', tutorialsSeen.join(','));
}

/**
 * Hides or restores the marker lessons for the maze about to be built. A
 * lesson whose supply isn't there would hold its slot rather than skip it:
 * `breadcrumbs` would arm and wait forever for a marker to come into sight,
 * with re-aim queued behind it. Hidden rather than recorded as seen, so the
 * lesson still comes in a maze that can give it.
 */
function applyMarkerTutorialVisibility(markerMode) {
    if (!tutorialManager) return;

    for (const [type, needsSupply] of Object.entries(MARKER_TUTORIALS))
        tutorialManager.showTutorials[type] = needsSupply(markerMode) && !tutorialsSeen.includes(type);
}

/**
 * Point the VR marker lesson's own glyphs at one breadcrumb. Scoped to its
 * steps rather than the whole document: the gaze options ring carries a
 * `.breadcrumb-icon` too, and that one depicts the next marker in the stack.
 */
function mountVrMarkerIcons(breadcrumb) {
    document.querySelectorAll('[tutorial-type="vr-breadcrumbs"]')
        .forEach((step) => mountBreadcrumbIcons(breadcrumb, step));
}

function setupInputBindings() {
    const canvas = renderer.domElement;

    touchJoystick = new TouchJoystick(
        document.querySelector('#touch-joystick'),
        document.querySelector('#touch-joystick-knob'));

    touchArbiter = new TouchArbiter(canvas, {
        isEnabled: () => controls.isLocked
    });

    // Touches go to breadcrumbs first; if breadcrumbs yield, controls take over.
    touchArbiter.registerHandler('breadcrumb', breadcrumbs.createTouchHandler({
        camera,
        getMazeData: () => mazeData
    }));
    touchArbiter.registerHandler('controls', controls.createTouchHandler());

    touchArbiter.connect();

    canvas.addEventListener('mousedown', (event) => {
        if (event.button !== 0)
            return;
        breadcrumbs.handleBreadcrumbClick(camera, mazeData);
    });
}

function init() {

    renderer = new THREE.WebGLRenderer( { antialias: true, powerPreference: "high-performance" } );
    renderer.setPixelRatio( Math.min(window.devicePixelRatio, 2) );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.domElement.id = "mainCanvas";
    renderer.setAnimationLoop( animate );
    document.body.appendChild( renderer.domElement );

    // add 3d compass
    compassManager = new CompassManager();

    compassManager.renderer.setPixelRatio( renderer.getPixelRatio() );

    // setup basic objects
    fpsClock = new THREE.Clock();

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

    // put camera inside a camera node so it can be transformed as a unit
    cameraNode = new THREE.Object3D();
    cameraCompensationNode = new THREE.Object3D();
    cameraNode.add( cameraCompensationNode );
    cameraCompensationNode.add( camera );

    spectator = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
    cameraCompensationNode.add( spectator );

    // establishing shot; runs on its own camera so cameraNode is untouched
    introCinematic = new MazeIntroCinematic( scene );

    // maze world (owns maze geometry, materials and the maze scene group)
    mazeWorld = new MazeWorld();
    mazeWorld.addTo(scene);

    scenery = SCENERY_DECORS.map(Decor => new Decor());
    for (const decor of scenery) decor.addTo(scene);

    // load models
    let loader = new GLTFLoader();

    loader.load( 'models/wall.glb', function ( gltf ) {
        let modelWall = gltf.scene.getObjectByName('wall');
        mazeWorld.setWallGeometry(modelWall.geometry);

        // build maze for first time
        // (must wait for this model to load or the colors don't work)
        buildMaze();
    }, undefined, function ( error ) {

        console.error( error );

    } );

    loader.load( 'models/pointer.glb', function ( gltf ) {
        let modelPointer = gltf.scene.getObjectByName('pointer');
        breadcrumbs.setPointerGeometry(modelPointer.geometry);

        // the HUD inventory icon uses the same geometry
        setBreadcrumbIconGeometry(modelPointer.geometry);
        breadcrumbs.updateBreadCrumbDisplay();
    }, undefined, function ( error ) {

        console.error( error );

    } );

    // load texture
    dotSprite = new THREE.TextureLoader().load( 'textures/dot.png', () => {
        // draw the goal dot glyph into the copy that mentions the exit
        mountGoalIcons( dotSprite );
    } );

    // set up lights
    playerLight = new THREE.PointLight( 0xffffff, 5, 0, 0.2 );
    camera.add( playerLight );
    scene.add( cameraNode );
    let ambLight = new THREE.AmbientLight( 0x808080 );
    scene.add( ambLight );

    // init controls
    if (isMobile) {
        document.body.classList.add('is-formfactor-non-desktop');
        document.querySelectorAll('.formfactor-desktop').forEach((e => {
            e.style.display = 'none';
        }));
        document.querySelectorAll('.formfactor-non-desktop:not(.tutorial-element)').forEach((e => {
            e.style.display = '';
        }));
    }
    controls = new FlyPointerLockControls(cameraNode, renderer.domElement);
    // sits outside the canvas, so TouchArbiter never sees this touch
    document.querySelector('#pause-button').addEventListener('touchstart', (event) => {
        controls.disableLock(event);
    }, false);
    // A phone has no cursor to capture, and Chrome on Android answers the
    // request with a banner that sits on screen for seconds. Anything with both
    // input methods - tablets, Surfaces, touchscreen laptops - is not matched by
    // isMobile and keeps pointer lock alongside its touch handling.
    controls.pointerLockEnabled = !isMobile;
    controls.movementSpeed = maze.majorWidth;
    controls.rollSpeed = 1;
    controls.addEventListener( 'lock', function() {
        document.querySelector('#blocker').style.display = 'none';
        session.startTimer();

        vrManager.setUiInteraction(false);
        setPauseButtonVisible(true);

        if (introCinematicPending) {
            introCinematicPending = false;
            playIntroCinematic();
        }
    } );
    controls.addEventListener( 'unlock', function() {
        introCinematicPending = false;
        introCinematic.skip();
        setPauseButtonVisible(false);
        document.querySelector('#blocker').style.display = '';
        touchArbiter?.clear();

        // determine if the pause menu should be shown
        if (!session.finishedMaze && !tutorialManager.inTutorial && menuManager.focusedMenu !== 'menu-rotate-phone')
        {
            menuManager.focusRootMenu('menu-pause');
        }

        updateMenuCentering();

        vrManager.setUiInteraction(true);
        vrManager.recenterUI();
    } );
    // P key listener
    document.addEventListener('keydown', (event) => {
        if (event.code == 'KeyP' && controls.isLocked)
        {
            controls.disableLock(new Event(''));
        }
        if (event.code == 'escape' && controls.isLocked)
        {
            controls.disableLock(new Event(''));
        }
    });
    // change end text for Mac
    if (navigator.userAgent.indexOf('Mac OS X') != -1)
    {
        document.querySelectorAll('.os-not-mac').forEach((e => {
            e.style.display = 'none';
        }));
        document.querySelectorAll('.os-mac').forEach((e => {
            e.style.display = '';
        }));
    }

    // goal particles
    goalDots = new GoalDotEffect({
        count:    20,
        map:      dotSprite,
        sizes:    [ maze.minorWidth * 4, maze.minorWidth * 1.5 ],
        sizesVR:  [ maze.minorWidth * 5, maze.minorWidth * 2   ],
    });
    goalDots.addTo( scene );

    tmpVector = new THREE.Vector3();

    // breadcrumbs
    breadcrumbs = new BreadcrumbManager();
    breadcrumbs.addTo(scene);
    setupInputBindings();

    // dust effect
    dust = new DustEffect({
        count: 2000,
        spawnRadius: maze.majorWidth * 5,
        map: dotSprite,
        size: dustSize
    });
    dust.followObject(cameraNode);
    dust.addTo(scene);

    // trail effect
    trail = new TrailEffect({
        count: 1000,
        map: dotSprite,
        size: window.innerHeight / 25,
        collisionDistance: CameraCollisionDistance
    });
    trail.followObject(cameraNode);
    trail.addTo(scene);

    compassManager.followObject(cameraNode);

    // init VR manager
    vrManager = new VRManager(renderer, cameraNode, cameraCompensationNode, camera, scene, dotSprite, controls);

    vrManager.setBreadcrumbs(breadcrumbs, () => mazeData);
    vrManager.setupRadialMenu();
    // a finished maze has nothing left to mark, so hold goes straight to the
    // menu there - which is what the completion message tells gaze players
    vrManager.canOpenRadialMenu = () => !session.finishedMaze;

    vrManager.addEventListener('pause', () => {
        if (controls.isLocked) {
            controls.disableLock(new Event(''));
        }
        else if (controls.isLocked === false) {
            controls.lock(new Event(''));
        }
    });

    // Setup VR event listeners
    renderer.xr.addEventListener('sessionstart', (event) => {
        controls.setXRPresenting(true);
        vrPresenting = true;
        // marker facing is stored per context, so entering VR swaps which of
        // the two values is in force (markerFacing.js)
        settings?.setVrPresenting(true);
        dust._material.size = dustSizeVR;
        goalDots.setVR( true );

        tutorialManager.useAnimations = false;
        // the VR lessons teach VR gestures, so they are a different order
        tutorialManager.setTutorialOrder(VR_TUTORIAL_ORDER);
        tutorialManager.setTutorialType('vr');
    });

    renderer.xr.addEventListener('sessionend', (event) => {
        controls.setXRPresenting(false);
        vrPresenting = false;
        settings?.setVrPresenting(false);
        // gaze state belongs to the session; a stranded preview would follow
        // the camera around for the rest of the run
        vrManager.closeRadialMenu();
        breadcrumbs.cancelGazePlace();
        controls.disableLock(new Event(''));
        dust._material.size = dustSize;
        goalDots.setVR( false );
        tutorialManager.useAnimations = true;
        tutorialManager.setTutorialOrder(TUTORIAL_ORDER);
        tutorialManager.setTutorialType('intro');
        onWindowResize();
    });

    // setup vr ui elements
    const vrDeviceType = getVrDeviceType();
    for (const type of ['vr-device-first', 'vr-device-enabled', 'vr-device-last']) {
        document.querySelectorAll(`.${type}`).forEach((el) => {
            el.style.display = 'none';
        });
    }
    document.querySelectorAll(`.${vrDeviceType}`).forEach((el) => {
        el.style.display = '';
    });

    // maze variables
    mazeSize = 3;
    mazeData = null;
    // run state (timer + checkpoints)
    session = new GameSession(bus);
    // save the positions of the entrance and exit of the maze
    startPos = new THREE.Vector3( maze.getOffset(1), maze.getOffset(1), maze.getOffset(1) );
    segments = mazeSize * 2 - 0.5;
    endPos = new THREE.Vector3();
    // collisions
    playerCollider = new PlayerCollider(CameraCollisionDistance);
    // history
    runHistory = new RunHistory({
        map: dotSprite,
        resolution: new THREE.Vector2( window.innerWidth, window.innerHeight ),
        pointSpacing: CameraCollisionDistance
    });
    runHistory.addTo(scene);

    // setup window resize handlers
    window.addEventListener( 'resize', onWindowResize, false );
    window.addEventListener( 'orientationchange', onWindowResize, false );

    // init UI
    menuManager = new MenuManager();
    menuManager.addEventListener('menuChanged', (evt) => {
        updateMenuCentering();
    });
    document.querySelectorAll('.button-play').forEach((button) => {
        button.addEventListener('click', () => {
            if (vrDeviceType === 'vr-device-first' && !renderer.xr.isPresenting) {
                vrManager.toggleVR();
                // Defer until after sessionstart, which allows vr tutorial to initialize correctly.
                renderer.xr.addEventListener('sessionstart', () => menuLockControls(), { once: true });
            } else {
                menuLockControls();
            }
        });
    });

    updateUIDeviceRotation();
    document.querySelectorAll('.focusable-menu').forEach((el) => {
        el.addEventListener('click', (evt) => {
            evt.stopPropagation();
        });
    });

    updateMenuCentering();

    loadSavedVariables();

    // user settings (storage <-> DOM <-> controls)
    settings = new Settings({ controls, vrManager, renderer, vrDeviceType, breadcrumbs });
    settings.load();
    settings.bindDom();

    // completion UI reacts to the session's completion event
    bus.on('maze:completed', onMazeCompleted);

    tutorialManager.cameraNode = cameraNode;
}

function buildMaze(size=mazeSize) {
    mazeSize = size;

    // a new maze is a new establishing shot
    introCinematicShown = false;

    playerCollider.reset();

    segments = mazeSize * 2 - 1;
    endPos.set( maze.getOffset(segments), maze.getOffset(segments), maze.getOffset(segments + 2) );
    compassManager.setEndPos( endPos );

    goalDots.setPosition( endPos );
    goalDots.randomize();

    // set the camera in front of the maze, looking in
    cameraNode.position.set( maze.getOffset(1), maze.getOffset(1), maze.getOffset(-2));
    cameraNode.lookAt(maze.getOffset(1), maze.getOffset(1), maze.getOffset(-3));
    if (!renderer.xr.isPresenting) {
        camera.rotation.set(0,0,0);

    } else {
        // get the camera's forward vector
        const forward = tmpVector.set(0, 0, 1).applyQuaternion(camera.quaternion);
        const targetRotation = Math.atan2(forward.x, forward.z);
        // adjust cameraNode's rotation
        cameraNode.rotation.y -= targetRotation;
    }

    runHistory.reset();

    dust.respawnAllParticles();
    trail.reset();

    mazeData = mazeWorld.build(mazeSize);

    // read at build time, not when they change: an option describes a maze,
    // so it lands on the next one (settings load after the first build starts)
    const mazeOptions = settings?.mazeOptions ?? MAZE_OPTION_DEFAULTS;
    const sceneryScale = sceneryScaleFor(mazeOptions.scenery);
    setSceneryDensityScale(sceneryScale);
    breadcrumbs.setMarkerMode(mazeOptions.markers);
    applyMarkerTutorialVisibility(mazeOptions.markers);

    // breadcrumb bases are placed before any scenery and claim their panels
    // outright, so decor grows around the wayfinding markers rather than over
    // them; the rest follows by role (see sceneryClaims.js)
    const claims = new SceneryClaims();
    breadcrumbs.initializeMaze(mazeData, claims);
    // Every kind's branch sites are dealt out before any of them builds, so
    // that build order can't double as site-quality order (branchSites.js).
    // Scenery off still runs every build, which is what clears the last
    // maze's decor, but no kind will ask for a site, so skip the nexus scan.
    const branchSites = sceneryScale > 0 ? new BranchSites(mazeData, scenery) : null;
    for (const decor of orderForBuild(scenery))
        decor.build(mazeData, undefined, claims, branchSites);

    session.newMaze(mazeData);
};

const CameraCollisionDistance = 0.25;
function collisionUpdate() {
    const mazePosFar = playerCollider.update(mazeData, cameraNode.position);
    session.updateCheckpoints(mazePosFar);
};

// runs when the session emits 'maze:completed' on the bus
function onMazeCompleted({ mazeData: completedMazeData, elapsedMillis })
{
    goalDots.finish();
    document.querySelector('#completionMessage').style.display = '';

    // switch menu screens
    vrManager.recenterUI();
    menuManager.focusRootMenu('menu-new-maze');

    document.querySelector('#mazeTimeSpan').textContent = formatMazeTime(elapsedMillis);
    document.querySelector('#mazeCompSizeSpan').textContent = completedMazeData.size_string;

    runHistory.showCompletedTrail();

    // reaching the exit only completes the lessons it actually demonstrates
    tutorialManager?.endOnGoalReached();

    storageSetItem('lastMazeCompletionDate', Date.now());
    hasCompletedMaze = true;
    // VR keeps its own clock, since the lessons it has to offer are its own:
    // a headset run is what holds them learned, and a week without one brings
    // them back (tutorialLapse.js). It is also the only thing that records the
    // movement lesson, so that goes down here rather than when its last step
    // times out.
    if (vrPresenting) {
        storageSetItem('lastVrMazeCompletionDate', Date.now());
        PROVEN_BY_VR_COMPLETION.forEach(recordTutorialSeen);
    }
}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    introCinematic.setAspect( camera.aspect );
    runHistory.setResolution( window.innerWidth, window.innerHeight );

    renderer.setSize( window.innerWidth, window.innerHeight );

    updateUIDeviceRotation();

    updateMenuCentering();
}

// returns false if the device is in portrait and has a screen ratio steeper than 4:3
function isValidMobileAspectRatio()
{
    return window.innerWidth * 3.95 / 3.0 > window.innerHeight;
}

function updateUIDeviceRotation()
{
    // if mobile and the aspect ratio is steeper than 4:3, require the user to rotate the phone
    if (isMobile && !isValidMobileAspectRatio())
    {
        if (controls.isLocked)
        {
            controls.disableLock(new Event(''));
        }

        menuManager.focusMenu('menu-rotate-phone');
    }
    // if the rotation hint is showing and the user has rotated, restore the menu
    else if (!document.querySelector('#menu-rotate-phone').style.display || document.querySelector('#menu-rotate-phone').style.display != 'none')
    {
        document.querySelector('#menu-rotate-phone').style.display = 'none';
        menuManager.focusPreviousMenu();
    }
}

var animate = function () {
    let delta = Math.min(fpsClock.getDelta(), 0.1);

    if (introCinematic.isActive) {
        // the player systems all read or write the player camera, so they sit
        // the shot out - nothing moves except the scene's own ambient effects
        introCinematic.update(delta);
        dust.update(delta);
        goalDots.update(delta);
        // controls.update() is sitting the shot out, so a drag started under
        // it moves nothing - don't draw a stick that isn't driving anything
        touchJoystick.hide();
        renderer.render( scene, introCinematic.camera );
        return;
    }

    controls.update(delta);
    touchJoystick.update(controls.getMoveTouchState());
    dust.update(delta);
    trail.update(delta);
    for (const decor of scenery) decor.update?.(delta);
    vrManager.update(delta);
    compassManager.update();
    tutorialManager.update();

    if (mazeData == null)
        return;

    collisionUpdate();

    // hover needs a cursor to aim: a pointer, or VR's gaze cursor
    breadcrumbs.update(delta, camera, {
        // gaze aims with the head, so it needs the raycast even on a phone
        hover: vrManager.isUsingGazeControls || (!isMobile && !vrManager.isPresenting()),
        mazeData
    });

    runHistory.recordPosition(cameraNode.position);

    goalDots.update( delta );

    renderer.render( scene, camera );
    compassManager.render();

    if (renderer.xr.isPresenting && settings.vrMirrorEnabled) {
        mirrorRender();
    }
};

function mirrorRender() {
    // Copy the camera's position and rotation
    const xrCam = camera;
    spectator.position.copy(xrCam.position);
    spectator.quaternion.copy(xrCam.quaternion);
    spectator.aspect = window.innerWidth / window.innerHeight;

    // turn off the WebXR rendering
    const currentRenderTarget = renderer.getRenderTarget();
    renderer.xr.isPresenting = false;

    // render to the main display canvas
    renderer.setRenderTarget(null);
    renderer.render(scene, spectator);

    // restore to WebXR render target
    renderer.setRenderTarget(currentRenderTarget);
    renderer.xr.isPresenting = true;
}

init();

function buildMazeAndUpdateUI(size)
{
    session.reportIfAbandoned();

    buildMaze(size);

    document.querySelector('#completionMessage').style.display = 'none';

    menuManager.focusRootMenu('menu-pause');

    document.querySelector('#mazeSizeSpan').innerHTML = mazeSize;

    updateMenuCentering();

    if (tutorialManager) tutorialManager.resetTutorial();
    vrManager?.closeRadialMenu();

    bus.emit('maze:built', { size: mazeSize });
}

function updateMenuCentering()
{
    const menu_title = document.querySelector('#menu-title');
    menu_title.style.display = '';

    let menu_height = document.querySelector('#menu-body').offsetHeight;
    const menu_space_to_fit = document.querySelector('#blocker').offsetHeight;

    // if there is not enough room, hide the title
    if (menu_space_to_fit < menu_height)
    {
        // check if completion menu is showing
        const completionMessage = document.querySelector('#completionMessage');
        if (!completionMessage.style.display || completionMessage.style.display == 'none') {
            completionMessage.style.display = 'none';
        }

        menu_title.style.display = 'none';
    }

    document.querySelector('#blocker').classList.toggle('center-menu', menu_space_to_fit > menu_height);

    // if the new maze menu is showing, make sure the slider is visible
    if (!document.querySelector('#menu-new-maze').style.display || document.querySelector('#menu-new-maze').style.display != 'none')
    {
        document.querySelector('#menu-new-maze-size-slider').scrollIntoView();
    }
}

/**
 * The fly-around is gated on the same thing the intro tutorial is: it is an
 * orientation aid, not something a returning player should sit through. VR
 * runs its own tutorial type and would be a motion-sickness problem besides.
 *
 * It also runs at most once per maze. It establishes the maze standing in
 * front of the player, so coming back to the same one - from a pause, or out
 * of a VR session that interrupted the intro lesson mid-run - has nothing left
 * to establish, and the tutorial state alone cannot tell that apart: an
 * unfinished intro lesson still leaves `nextTutorialType()` reading 'intro'.
 */
function shouldPlayIntroCinematic()
{
    return mazeData !== null
        && !introCinematicShown
        && !vrPresenting
        && tutorialManager.nextTutorialType() === 'intro';
}

// the caption comes up on the settle beat and stays through the push-in and the
// hold; it goes away again as the camera heads back
function showCinematicCaption(visible)
{
    const caption = document.querySelector('#cinematic-caption');
    if (!caption) return;

    if (visible) {
        caption.style.display = '';
        caption.style.animationName = 'tutorial-text-fade-in';
    } else {
        caption.style.animationName = 'tutorial-text-fade-out';
    }
    caption.style.animationFillMode = 'forwards';
}

function hideCinematicCaption()
{
    const caption = document.querySelector('#cinematic-caption');
    if (!caption) return;
    caption.style.display = 'none';
    caption.style.animationName = '';
}

function playIntroCinematic()
{
    introCinematicShown = true;
    document.querySelector('#hud-container').classList.add('hide');
    setPauseButtonVisible(false);

    introCinematic.play({
        segments,
        endPos,
        fromCamera: camera,
        // the shot borrows the player's light and the dust field, and hands
        // them back at the end
        light: playerLight,
        followers: [ dust ],
        skippable: hasCompletedMaze,
        onPhase: (phase) => {
            if (phase === 'settle') showCinematicCaption(true);
            else if (phase === 'return') showCinematicCaption(false);
        },
        onComplete: () => {
            hideCinematicCaption();
            document.querySelector('#hud-container').classList.remove('hide');
            setPauseButtonVisible(true);
            // the shot is time the player had no control over, so it isn't
            // charged to their run
            session.restartTimer();
            tutorialManager.startNextTutorial();
        },
    });
}

// the pause button is only meaningful while the player is actually in the maze
function setPauseButtonVisible(visible)
{
    document.querySelector('#pause-button')?.classList.toggle('hide', !visible);
}

function menuLockControls()
{
    const startingTutorial = tutorialManager
        && !tutorialManager.inTutorial && tutorialManager.armedType === null;
    const playingCinematic = startingTutorial && shouldPlayIntroCinematic();
    introCinematicPending = playingCinematic;

    // do not allow locking on mobile when in portrait mode
    if (!isMobile || isValidMobileAspectRatio())
        controls.lock();

    // branch on the local, not the flag: on touch, lock() dispatches its event
    // synchronously, so the handler has already consumed the flag by now and
    // the prompts would start on top of the cinematic
    if (startingTutorial && !playingCinematic) {
        tutorialManager.startNextTutorial();
    }

    if (session.finishedMaze) {
        document.querySelector('#completionMessage').style.display = '';
    }
}

document.querySelector('#menu-new-maze-button').addEventListener('click', (event) =>
{
    buildMazeAndUpdateUI( document.querySelector('#menu-new-maze-size-slider').value );

    menuLockControls();
});

function getVrDeviceType() {
    if (navigator.userAgent.indexOf('OculusBrowser') !== -1) {
        return 'vr-device-first';
    }
    if (isMobile) {
        return 'vr-device-last';
    }
    return 'vr-device-enabled';
}

window.addEventListener('beforeunload', () => session.reportIfAbandoned());
