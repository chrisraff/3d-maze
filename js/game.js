/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FlyPointerLockControls } from './controls.js';
import * as maze from './maze.js';
import { storageGetItem, storageSetItem } from './storage.js';
import DustEffect from './dust.js';
import TrailEffect from './trail.js';
import PlayerCollider from './PlayerCollider.js';
import CompassManager from './compassManagager.js';
import VRManager from './VRManager.js';
import TutorialManager from './TutorialManager.js';
import MenuManager from './MenuManager.js';
import BreadcrumbManager from './BreadcrumbManager.js';
import TouchArbiter from './TouchArbiter.js';
import GoalDotEffect from './goalDots.js';
import bus from './EventBus.js';
import initAnalytics from './analytics.js';
import GameSession, { formatMazeTime } from './GameSession.js';
import RunHistory from './RunHistory.js';
import MazeWorld from './MazeWorld.js';
import MazeIntroCinematic from './MazeIntroCinematic.js';
import Settings from './Settings.js';

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

var dust;
var trail;

var dustSize   = 0.025;
var dustSizeVR = 0.0075;

var tutorialManager;
var playerLight;
var introCinematic;
// armed before controls.lock() - on touch devices lock() dispatches its event
// synchronously - and consumed by the lock handler, so the shot only starts
// once the player is actually in the maze and the menu is gone
var introCinematicPending = false;


function loadSavedVariables()
{
    const lastMazeCompletionDate = Number(storageGetItem('lastMazeCompletionDate', '0'));

    // show tutorial if more than 30 days have passed since the last maze completion
    const showTutorial = (Date.now() - lastMazeCompletionDate) > (1000 * 60 * 60 * 24 * 30);

    const tutorialCallbacks = {
        intro: {
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
        vr: {
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
        }
    };

    tutorialManager = new TutorialManager({
        showTutorial,
        callbacks: tutorialCallbacks
    });

    document.querySelectorAll('.menu-experienced').forEach((el) => {
        el.style.display = showTutorial ? 'none' : '';
    });
}

function setupInputBindings() {
    const canvas = renderer.domElement;

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
    }, undefined, function ( error ) {

        console.error( error );

    } );

    // load texture
    dotSprite = new THREE.TextureLoader().load( 'textures/dot.png' );

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

        if (introCinematicPending) {
            introCinematicPending = false;
            playIntroCinematic();
        }
    } );
    controls.addEventListener( 'unlock', function() {
        introCinematicPending = false;
        introCinematic.skip();
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

    vrManager.setBreadcrumbs(breadcrumbs);

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
        dust._material.size = dustSizeVR;
        goalDots.setVR( true );

        tutorialManager.useAnimations = false;
        tutorialManager.showTutorials['vr'] = true;
        tutorialManager.setTutorialType('vr');
    });

    renderer.xr.addEventListener('sessionend', (event) => {
        controls.setXRPresenting(false);
        controls.disableLock(new Event(''));
        dust._material.size = dustSize;
        goalDots.setVR( false );
        tutorialManager.useAnimations = true;
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
    settings = new Settings({ controls, vrManager, renderer, vrDeviceType });
    settings.load();
    settings.bindDom();

    // completion UI reacts to the session's completion event
    bus.on('maze:completed', onMazeCompleted);

    tutorialManager.cameraNode = cameraNode;
}

function buildMaze(size=mazeSize) {
    mazeSize = size;

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

    breadcrumbs.initializeMaze(mazeData);

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

    // complete tutorial
    if (tutorialManager) {
        tutorialManager.resetTutorial(true);
        storageSetItem('lastMazeCompletionDate', Date.now());
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
        renderer.render( scene, introCinematic.camera );
        return;
    }

    controls.update(delta);
    dust.update(delta);
    trail.update(delta);
    vrManager.update(delta);
    compassManager.update();
    tutorialManager.update();

    if (mazeData == null)
        return;

    collisionUpdate();

    // Update breadcrumb hover highlighting on non-mobile, non-VR devices (or VR gaze mode)
    if (!isMobile && (!vrManager.isPresenting() || vrManager.isUsingGazeControls)) {
        breadcrumbs.updateHoveredBreadcrumb(camera);
    }
    breadcrumbs.updateGlowForCamera(camera);
    breadcrumbs.updateBases(delta);

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

// The fly-around is gated on the same thing the intro tutorial is: it is an
// orientation aid, not something a returning player should sit through. VR
// runs its own tutorial type and would be a motion-sickness problem besides.
function shouldPlayIntroCinematic()
{
    return mazeData !== null
        && !renderer.xr.isPresenting
        && tutorialManager.tutorialType === 'intro'
        && tutorialManager.showTutorials['intro'] !== false;
}

// the caption comes up on the settle beat and stays through the push-in and the
// hold; it goes away again as the camera heads back
function showCinematicCaption(visible)
{
    const caption = document.querySelector('#cinematic-caption');
    if (!caption) return;

    // its own keyframes, not the shared tutorial ones: those fade `color`,
    // which leaves the caption's text-shadow behind
    if (visible) {
        caption.style.display = '';
        caption.style.animationName = 'cinematic-caption-fade-in';
    } else {
        caption.style.animationName = 'cinematic-caption-fade-out';
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
    document.querySelector('#hud-container').classList.add('hide');

    introCinematic.play({
        segments,
        endPos,
        fromCamera: camera,
        // the shot borrows the player's light and the dust field, and hands
        // them back at the end
        light: playerLight,
        followers: [ dust ],
        onPhase: (phase) => {
            if (phase === 'settle') showCinematicCaption(true);
            else if (phase === 'return') showCinematicCaption(false);
        },
        onComplete: () => {
            hideCinematicCaption();
            document.querySelector('#hud-container').classList.remove('hide');
            // the shot is time the player had no control over, so it isn't
            // charged to their run
            session.restartTimer();
            tutorialManager.startTutorial();
        },
    });
}

function menuLockControls()
{
    const startingTutorial = tutorialManager && !tutorialManager.inTutorial;
    const playingCinematic = startingTutorial && shouldPlayIntroCinematic();
    introCinematicPending = playingCinematic;

    // do not allow locking on mobile when in portrait mode
    if (!isMobile || isValidMobileAspectRatio())
        controls.lock();

    // branch on the local, not the flag: on touch, lock() dispatches its event
    // synchronously, so the handler has already consumed the flag by now and
    // the prompts would start on top of the cinematic
    if (startingTutorial && !playingCinematic) {
        tutorialManager.startTutorial();
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
