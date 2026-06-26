/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */
import * as THREE from 'three';
import { MeshLine, MeshLineMaterial } from './THREE.MeshLine.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FlyPointerLockControls } from './controls.js';
import * as maze from './maze.js';
import { storageGetItem, storageSetItem } from './storage.js';
import DustEffect from './dust.js';
import TrailEffect from './trail.js';
import checkCollisionOnAxis from './checkCollisionOnAxis.js';
import CompassManager from './compassManagager.js';
import VRManager from './VRManager.js';
import TutorialManager from './TutorialManager.js';
import MenuManager from './MenuManager.js';
import BreadcrumbManager from './BreadcrumbManager.js';
import TouchArbiter from './TouchArbiter.js';
import GoalDotEffect from './goalDots.js';

// webpage objects

var renderer;

var compassManager;

// ui variables
var menuManager = null;

// basic objects
var fpsClock;
var timerStartMillis;
var timerRunning;

var scene;
var cameraNode;
var cameraCompensationNode;
var camera;

var spectator;

var tmpColor;

const PI_2 = Math.PI / 2;

// models
var blockGeometry;
var wallGeometry;
var wallHitGeometry;

// vr state
var vrManager;
var vrMirrorEnabled = false;

// materials
var dotSprite;

var wallMaterial;
var darkMaterial;
var basicMaterial;

// controls
var controls;

// goal particles
var goalDots;

var tmpVector;

// maze variables
var mazeSize;
var mazeData;
var mazeGroup;
// checkpoints
var startedMaze;
var finishedMaze;
// save the positions of the entrance and exit of the maze
var startPos;
var segments;
var endPos;
// collisions
var mazePosNear;
var mazePosFar;
// history
var historyPositions;
var	historyLineMaterial;
var historyLine;
var historyMesh;
// breadcrumbs
var breadcrumbs;
var touchArbiter;

var dust;
var trail;

var dustSize   = 0.025;
var dustSizeVR = 0.0075;

var tutorialManager;


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

    const vrTeleport = storageGetItem('vr-setting-movement', 'teleport');
    controls.vrControlOptions.teleportationEnabled = vrTeleport == 'teleport';
    document.querySelectorAll('[name="vr-setting-movement"]').forEach((el) => {
        el.checked = el.value == vrTeleport;
    });

    const vrRotation = storageGetItem('vr-setting-rotation', 'instant');
    controls.vrControlOptions.rotationSmoothing = vrRotation == 'smooth';
    document.querySelectorAll('[name="vr-setting-rotation"]').forEach((el) => {
        el.checked = el.value == vrRotation;
    });

    updateVrRotateSpeedSettingEnabled();

    const vrRotationSpeed = Number(storageGetItem('vr-setting-rotation-speed', '0'));
    vrManager.rotationSpeed = Math.pow(3, vrRotationSpeed);
    document.querySelector('#vr-setting-rotation-speed').value = vrRotationSpeed;

    const vrMirroringDefault = getVrDeviceType() === 'vr-device-enabled' ? 'true' : 'false';
    vrMirrorEnabled = storageGetItem('vr-setting-mirror', vrMirroringDefault) === 'true';
    document.querySelector('#vr-setting-mirror').checked = vrMirrorEnabled;
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
    timerStartMillis = 0;
    timerRunning = false;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

    // put camera inside a camera node so it can be transformed as a unit
    cameraNode = new THREE.Object3D();
    cameraCompensationNode = new THREE.Object3D();
    cameraNode.add( cameraCompensationNode );
    cameraCompensationNode.add( camera );

    spectator = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
    cameraCompensationNode.add( spectator );

    tmpColor = new THREE.Color();

    wallHitGeometry = new THREE.InstancedBufferGeometry();
    THREE.BufferGeometry.prototype.copy.call( wallHitGeometry, new THREE.BoxGeometry() );

    // load models
    blockGeometry = new THREE.InstancedBufferGeometry();
    THREE.BufferGeometry.prototype.copy.call( blockGeometry, new THREE.BoxGeometry() );
    let loader = new GLTFLoader();
    wallGeometry = new THREE.InstancedBufferGeometry();

    loader.load( 'models/wall.glb', function ( gltf ) {
        let modelWall = gltf.scene.getObjectByName('wall');
        THREE.BufferGeometry.prototype.copy.call(wallGeometry, modelWall.geometry);

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

    // materials
    wallMaterial = new THREE.MeshLambertMaterial( { vertexColors: true } );
    darkMaterial = new THREE.MeshPhongMaterial( {color: 'hsl(0, 0%, 10%)'} );
    basicMaterial = new THREE.MeshBasicMaterial();

    // set up lights
    let localLight = new THREE.PointLight( 0xffffff, 5, 0, 0.2 );
    camera.add( localLight );
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
    controls.movementSpeed = maze.majorWidth;
    controls.rollSpeed = 1;
    controls.addEventListener( 'lock', function() {
        document.querySelector('#blocker').style.display = 'none';
        if (!timerRunning) {
            timerRunning = true;
            timerStartMillis = Date.now();
        }

        vrManager.setUiInteraction(false);
    } );
    controls.addEventListener( 'unlock', function() {
        document.querySelector('#blocker').style.display = '';
        touchArbiter?.clear();

        // determine if the pause menu should be shown
        if (!finishedMaze && !tutorialManager.inTutorial && menuManager.focusedMenu !== 'menu-rotate-phone')
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

    const _vrPlayerWorldPos = new THREE.Vector3();
    const _vrLeftGripWorldPos = new THREE.Vector3();
    const _vrRightGripWorldPos = new THREE.Vector3();
    const _vrGripPositions = [];
    vrManager.addEventListener('vrSelectInGame', (event) => {
        camera.getWorldPosition(_vrPlayerWorldPos);
        breadcrumbs.handleVRSelect(event.detail.gripObject, _vrPlayerWorldPos);
    });

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
    mazeGroup = new THREE.Group();
    scene.add( mazeGroup );
    // checkpoints
    startedMaze = false;
    finishedMaze = false;
    // save the positions of the entrance and exit of the maze
    startPos = new THREE.Vector3( maze.getOffset(1), maze.getOffset(1), maze.getOffset(1) );
    segments = mazeSize * 2 - 0.5;
    endPos = new THREE.Vector3();
    // collisions
    mazePosNear = null; // closer to 0,0,0 (-)
    mazePosFar = null;
    // history
    historyPositions = [];
    historyLineMaterial = new MeshLineMaterial( {
        useMap: true,
        map: dotSprite,
		opacity: 1,
		resolution: new THREE.Vector2( window.innerWidth, window.innerHeight ),
		sizeAttenuation: true,
		lineWidth: 0.01,
        vertexColors: true
	});
    historyLine = new MeshLine(); // this is a geometry;

    historyMesh = new THREE.Mesh(historyLine, historyLineMaterial);
    scene.add( historyMesh );

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

    tutorialManager.cameraNode = cameraNode;
}

function buildMaze(size=mazeSize) {
    mazeSize = size;

    startedMaze = false;
    finishedMaze = false;

    mazePosNear = null;
    mazePosFar = null;

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

    historyPositions = [];
    historyLine.geometry.dispose();
    historyMesh.visible = false;

    dust.respawnAllParticles();
    trail.reset();

    mazeGroup.remove(...mazeGroup.children);

    let dummyWall = new THREE.Object3D;
    let wallMatrices = [];
    let wallColors = [];
    let blockMatrices = [];

    mazeData = maze.generateMaze(mazeSize);
    for (let i = 0; i < mazeData.collision_map.length; i++) {
        for (let j = 0; j < mazeData.collision_map[i].length; j++) {
            for (let k = 0; k < mazeData.collision_map[i][j].length; k++) {
                if (    !mazeData.collision_map[i][j][k] ||
                        (i!=0 && i!=mazeData.bounds[0]*2 && j!=0 && j!=mazeData.bounds[1]*2 && k!=0 && k!=mazeData.bounds[2]*2 && // if we're inside...
                            i%2==0 && j%2==0 && k%2==0)) // don't create unseen blocks
                    continue;

                let iWidth = maze.getWidth(i);
                let jWidth = maze.getWidth(j);
                let kWidth = maze.getWidth(k);

                // only large walls get color
                let colorful = false;
                if (iWidth + jWidth + kWidth >= 2 * maze.majorWidth + maze.minorWidth)
                    colorful = true;

                if (colorful) {
                    dummyWall.scale.set( maze.majorWidth, maze.minorWidth, maze.majorWidth );
                    dummyWall.position.set( maze.getOffset(i), maze.getOffset(j), maze.getOffset(k) );

                    // rotate appropriately
                    if (iWidth == maze.minorWidth) {
                        dummyWall.rotation.z = PI_2;
                    } else if (kWidth == maze.minorWidth) {
                        dummyWall.rotation.x = PI_2;
                    }

                    dummyWall.updateMatrix();

                    dummyWall.rotation.set(0,0,0);

                    wallMatrices.push( dummyWall.matrix.clone() );

                    wallColors.push(
                        0.05 + 0.9 * (i-1)/(mazeData.segments[0]),
                        0.05 + 0.9 * (j-1)/(mazeData.segments[1]),
                        0.05 + 0.9 * (k-1)/(mazeData.segments[2])
                    );

                } else {
                    dummyWall.scale.set( iWidth, jWidth, kWidth );
                    dummyWall.position.set( maze.getOffset(i), maze.getOffset(j), maze.getOffset(k) );

                    dummyWall.updateMatrix();

                    blockMatrices.push( dummyWall.matrix.clone() );
                }
            }
        }
    }

    breadcrumbs.initializeMaze(mazeData);

    wallGeometry.setAttribute( 'color', new THREE.InstancedBufferAttribute( new Float32Array( wallColors ), 3 ) );
    let wallInstancedMesh = new THREE.InstancedMesh( wallGeometry, wallMaterial, wallMatrices.length );
    let i = 0;
    wallMatrices.forEach((mat) => wallInstancedMesh.setMatrixAt( i++, mat ) );
    wallInstancedMesh.needsUpdate = true;

    mazeGroup.add( wallInstancedMesh );

    let blockInstanceMesh = new THREE.InstancedMesh( blockGeometry, darkMaterial, blockMatrices.length );
    i = 0;
    blockMatrices.forEach((mat) => blockInstanceMesh.setMatrixAt( i++, mat ) );
    blockInstanceMesh.needsUpdate = true;

    let wallHitInstanceMesh = new THREE.InstancedMesh( wallHitGeometry, basicMaterial, wallMatrices.length + blockMatrices.length );
    i = 0;
    wallMatrices.forEach((mat) => wallHitInstanceMesh.setMatrixAt( i++, mat ) );
    blockMatrices.forEach((mat) => wallHitInstanceMesh.setMatrixAt( i++, mat ) );
    wallHitInstanceMesh.needsUpdate = true;
    wallHitInstanceMesh.layers.set(3);
    wallHitInstanceMesh.userData.isMazeWallHitBox = true;

    mazeGroup.add( blockInstanceMesh );
    mazeGroup.add( wallHitInstanceMesh );

    timerRunning = false;

};

const CameraCollisionDistance = 0.25;
function collisionUpdate() {
    let nearPos = new THREE.Vector3();
    nearPos.copy(cameraNode.position);
    nearPos.addScalar(-CameraCollisionDistance);
    let farPos = new THREE.Vector3();
    farPos.copy(cameraNode.position);
    farPos.addScalar(CameraCollisionDistance);
    let newMazePosNear = maze.getMazePos(nearPos);
    let newMazePosFar = maze.getMazePos(farPos);

    // initialize (only happens at start)
    if (mazePosNear == null && mazePosFar == null) {
        mazePosNear = newMazePosNear;
        mazePosFar = newMazePosFar;
    }

    // if the player moved more than 1 unit on any axis, adjust newMazePos
    if (Math.abs(newMazePosNear.x - mazePosNear.x) > 1) {
        newMazePosNear.x = mazePosNear.x + Math.sign(newMazePosNear.x - mazePosNear.x);
    }
    if (Math.abs(newMazePosNear.y - mazePosNear.y) > 1) {
        newMazePosNear.y = mazePosNear.y + Math.sign(newMazePosNear.y - mazePosNear.y);
    }
    if (Math.abs(newMazePosNear.z - mazePosNear.z) > 1) {
        newMazePosNear.z = mazePosNear.z + Math.sign(newMazePosNear.z - mazePosNear.z);
    }
    if (Math.abs(newMazePosFar.x - mazePosFar.x) > 1) {
        newMazePosFar.x = mazePosFar.x + Math.sign(newMazePosFar.x - mazePosFar.x);
    }
    if (Math.abs(newMazePosFar.y - mazePosFar.y) > 1) {
        newMazePosFar.y = mazePosFar.y + Math.sign(newMazePosFar.y - mazePosFar.y);
    }
    if (Math.abs(newMazePosFar.z - mazePosFar.z) > 1) {
        newMazePosFar.z = mazePosFar.z + Math.sign(newMazePosFar.z - mazePosFar.z);
    }

    // actual collision checking goes here
    if (newMazePosNear.distanceToSquared(mazePosNear) != 0) {
        if (newMazePosNear.x - mazePosNear.x < 0) {
            checkCollisionOnAxis(mazeData, 'x', 'y', 'z', mazePosNear, newMazePosNear, mazePosFar, -1, cameraNode.position, CameraCollisionDistance);
        }
        if (newMazePosNear.y - mazePosNear.y < 0) {
            checkCollisionOnAxis(mazeData, 'y', 'x', 'z', mazePosNear, newMazePosNear, mazePosFar, -1, cameraNode.position, CameraCollisionDistance);
        }
        if (newMazePosNear.z - mazePosNear.z < 0) {
            checkCollisionOnAxis(mazeData, 'z', 'y', 'x', mazePosNear, newMazePosNear, mazePosFar, -1, cameraNode.position, CameraCollisionDistance);
        }
    }
    if (newMazePosFar.distanceToSquared(mazePosFar) != 0) {
        if (newMazePosFar.x - mazePosFar.x > 0) {
            checkCollisionOnAxis(mazeData, 'x', 'y', 'z', mazePosFar, newMazePosFar, mazePosNear, 1, cameraNode.position, CameraCollisionDistance);
        }
        if (newMazePosFar.y - mazePosFar.y > 0) {
            checkCollisionOnAxis(mazeData, 'y', 'x', 'z', mazePosFar, newMazePosFar, mazePosNear, 1, cameraNode.position, CameraCollisionDistance);
        }
        if (newMazePosFar.z - mazePosFar.z > 0) {
            checkCollisionOnAxis(mazeData, 'z', 'y', 'x', mazePosFar, newMazePosFar, mazePosNear, 1, cameraNode.position, CameraCollisionDistance);
        }
    }

    mazePosNear = newMazePosNear;
    mazePosFar = newMazePosFar;

    // check for maze completion
    if (mazePosFar.z == -1 && startedMaze) {
        startedMaze = false;
    } else if (!startedMaze && mazePosFar.z == 1 && mazePosFar.x == 1 && mazePosFar.y == 1) {
        startedMaze = true;
    } else if (!finishedMaze && startedMaze && mazePosFar.z == mazeData.bounds[2] * 2 + 1) {
        onMazeCompletion();
    }
};

function onMazeCompletion()
{
    finishedMaze = true;
    goalDots.finish();
    document.querySelector('#completionMessage').style.display = '';

    // switch menu screens
    vrManager.recenterUI();
    menuManager.focusRootMenu('menu-new-maze');

    let seconds = ( (Date.now() - timerStartMillis) / 1000).toFixed(2);
    let timeString = seconds;
    if (seconds >= 60) {
        let minutes = Math.floor(seconds / 60);
        let secondString = "" + seconds % 60;
        if (secondString < 10) {
            secondString = `0${secondString}`;
        }
        // toFixed can't be trusted
        secondString = secondString.substring(0, 5);
        timeString = `${minutes}:${secondString}`;
    } else {
        timeString = seconds.substring(0, seconds >= 10 ? 5 : 4);
    }
    document.querySelector('#mazeTimeSpan').textContent = timeString;
    document.querySelector('#mazeCompSizeSpan').textContent = mazeData.size_string;

    // build history
    let historyVerts = new Float32Array( 3 * historyPositions.length );
    let historyCols  = new Float32Array( 6 * historyPositions.length );

    for (let i = 0; i < historyPositions.length; i++)
    {
        historyVerts[i*3 + 0] = historyPositions[i].x;
        historyVerts[i*3 + 1] = historyPositions[i].y;
        historyVerts[i*3 + 2] = historyPositions[i].z;

        tmpColor.setHSL( i / historyPositions.length, 1.0, 0.75);

        historyCols[ i*6 + 0 ] = tmpColor.r;
        historyCols[ i*6 + 1 ] = tmpColor.g;
        historyCols[ i*6 + 2 ] = tmpColor.b;
        historyCols[ i*6 + 0+3 ] = tmpColor.r;
        historyCols[ i*6 + 1+3 ] = tmpColor.g;
        historyCols[ i*6 + 2+3 ] = tmpColor.b;
    }

    historyLine.setPoints(historyVerts);
    historyLine.setAttribute( 'color',    new THREE.BufferAttribute( historyCols,  3 ) );

    historyMesh.visible = true;

    // complete tutorial
    if (tutorialManager) {
        tutorialManager.resetTutorial(true);
        storageSetItem('lastMazeCompletionDate', Date.now());
    }

    gtag('event', 'maze_completed', {
            'event_category': '3d-maze',
            'value': mazeData.size_string,
            'solution_length': mazeData.analytics.distance_to_end,
            'branches_on_solution': mazeData.analytics.branches_on_solution,
            'branches_total': mazeData.analytics.branches_on_solution,
            'time_since_start': Date.now() - timerStartMillis
    });
}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

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

    controls.update(delta);
    dust.update(delta);
    trail.update(delta);
    vrManager.update(delta);
    if (renderer.xr.isPresenting) {
        camera.getWorldPosition(_vrPlayerWorldPos);
        breadcrumbs.updateVRHeld(_vrPlayerWorldPos);

        _vrGripPositions.length = 0;
        if (vrManager.vrLeftController.gripObject) {
            vrManager.vrLeftController.gripObject.getWorldPosition(_vrLeftGripWorldPos);
            _vrGripPositions.push(_vrLeftGripWorldPos);
        }
        if (vrManager.vrRightController.gripObject) {
            vrManager.vrRightController.gripObject.getWorldPosition(_vrRightGripWorldPos);
            _vrGripPositions.push(_vrRightGripWorldPos);
        }
        breadcrumbs.updateVRProximityHighlight(_vrGripPositions, _vrPlayerWorldPos);
    }
    compassManager.update();
    tutorialManager.update();

    if (mazeData == null)
        return;

    collisionUpdate();

    // Update breadcrumb hover highlighting on non-mobile devices
    if (!isMobile) {
        breadcrumbs.updateHoveredBreadcrumb(camera);
    }

    if ( historyPositions.length == 0 || historyPositions[historyPositions.length - 1].distanceToSquared( cameraNode.position ) > (0.1 * CameraCollisionDistance)**2 )
    {
        // add to history
        const newHistoryPosition = tmpVector.copy(cameraNode.position);

        let lastPos = historyPositions.length > 0 ? historyPositions[historyPositions.length - 1] : cameraNode.position;
        let distance = lastPos.distanceTo(newHistoryPosition);
        let numPoints = Math.max(1, Math.ceil(distance / CameraCollisionDistance));

        // in case of long distances (e.g. teleportation), interpolate points so the line doesn't look broken
        for (let i = 0; i < numPoints; i++) {
            let t = numPoints > 1 ? i / (numPoints - 1) : 1;
            let interpolatedPos = new THREE.Vector3();
            interpolatedPos.lerpVectors(lastPos, newHistoryPosition, t);
            historyPositions.push(interpolatedPos);
        }
    }

    goalDots.update( delta );

    renderer.render( scene, camera );
    compassManager.render();

    if (renderer.xr.isPresenting && vrMirrorEnabled) {
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
    verifyAndReportAbandonedMaze();

    buildMaze(size);

    document.querySelector('#completionMessage').style.display = 'none';

    menuManager.focusRootMenu('menu-pause');

    document.querySelector('#mazeSizeSpan').innerHTML = mazeSize;

    updateMenuCentering();

    if (tutorialManager) tutorialManager.resetTutorial();

    gtag('event', 'maze_built', {'event_category': '3d-maze', 'value': mazeSize});
}

function verifyAndReportAbandonedMaze()
{
    // check if maze was started and if time has passed
    const elapsed_time = Date.now() - timerStartMillis;
    if (startedMaze && !finishedMaze && elapsed_time > 7000)
    {
        gtag('event', 'maze_abandoned', {
                'event_category': '3d-maze',
                'value': mazeData.size_string,
                'solution_length': mazeData.analytics.distance_to_end,
                'branches_on_solution': mazeData.analytics.branches_on_solution,
                'branches_total': mazeData.analytics.branches_on_solution,
                'time_since_start': elapsed_time
        });
    }
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

function menuLockControls()
{
    // do not allow locking on mobile when in portrait mode
    if (!isMobile || isValidMobileAspectRatio())
        controls.lock();

    if (tutorialManager && !tutorialManager.inTutorial) {
        tutorialManager.startTutorial();
    }

    if (finishedMaze) {
        document.querySelector('#completionMessage').style.display = '';
    }
}

document.querySelector('#menu-new-maze-button').addEventListener('click', (event) =>
{
    buildMazeAndUpdateUI( document.querySelector('#menu-new-maze-size-slider').value );

    menuLockControls();
});

document.querySelector('#setting-fixed-camera').addEventListener('change', (event) => {
    controls.setGimbalLocked( event.target.checked );
});

document.querySelector('#vr-setting-mirror').addEventListener('change', (event) => {
    storageSetItem('vr-setting-mirror', event.target.checked ? 'true' : 'false');
    vrMirrorEnabled = event.target.checked;
});

document.querySelectorAll('.menu-radio-button').forEach((el) => {
    el.addEventListener('change', (event) => {
        if (event.target.name == 'vr-setting-movement') {
            controls.vrControlOptions.teleportationEnabled = event.target.value == 'teleport';
            storageSetItem('vr-setting-movement', event.target.value);
        }
        if (event.target.name == 'vr-setting-rotation') {
            controls.vrControlOptions.rotationSmoothing = event.target.value == 'smooth';
            updateVrRotateSpeedSettingEnabled();
            storageSetItem('vr-setting-rotation', event.target.value);
        }
    });
});

function updateVrRotateSpeedSettingEnabled() {
    const vrRotationSpeedSetting = document.querySelector('#vr-setting-rotation-speed');
    vrRotationSpeedSetting.disabled = !controls.vrControlOptions.rotationSmoothing;
}

function getVrDeviceType() {
    if (navigator.userAgent.indexOf('OculusBrowser') !== -1) {
        return 'vr-device-first';
    }
    if (isMobile) {
        return 'vr-device-last';
    }
    return 'vr-device-enabled';
}

document.querySelectorAll('.menu-slider').forEach((el) => {
    el.addEventListener('input', (event) => {
        const value = event.target.value;
        if (event.target.id == 'vr-setting-rotation-speed') {
            const expValue = Math.pow(3, value);
            vrManager.rotationSpeed = expValue;
            storageSetItem('vr-setting-rotation-speed', value);
        }
        vrManager.uiMesh.material.map.update();
    });
});

document.querySelectorAll('.xr-force-redraw').forEach((el) => {
    el.addEventListener('change', (event) => {
        if (renderer.xr.isPresenting) {
            vrManager.uiMesh.material.map.update();
        }
    });
});

window.addEventListener('beforeunload', verifyAndReportAbandonedMaze);
