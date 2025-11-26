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

// webpage objects

var renderer;
var compassRenderer;

var compassScene;
var compassCamera;

// tutorial variables
var showTutorial = true;
var inTutorial = false;

// ui variables
var focusedMenu = null;

// basic objects
var fpsClock;
var timerStartMillis;
var timerRunning;

var scene;
var camera;

var tmpColor;

const PI_2 = Math.PI / 2;

// models
var blockGeometry;
var wallGeometry;

var arrowMesh;

// materials
var dotSprite;

var wallMaterial;
var darkMaterial;

// controls
var controls;

// goal particles
var dotsPerGroup = 20;
var dotGroup;
var dotRotationAxes;
var dotPositionArrays;
var dotColorArrays;
var dotGeometries;
var dotTmpQuaternion;
var dotRotationAnim;

// trail particles
var trailParticles;
var trailMotions;
var trailGeometry;
var trailPointSize;

var lastTrailCameraPosition;

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

const dust = new DustEffect({ count: 1000, spawnRadius: maze.majorWidth * 5 })

function sampleUniformSphere() {

    let x12 = 1;
    let x22 = 1;
    let x1 = 0;
    let x2 = 0;

    while (x12 + x22 >= 1) {

        x1 = Math.random() * 2 - 1;
        x2 = Math.random() * 2 - 1;

        x12 = x1*x1;
        x22 = x2*x2;

    }

    let sqrroot = Math.sqrt(1 - x12 - x22);

    let r = Math.random();
    r *= r;
    r = 1 - r;

    return [
        r * (2 * x1 * sqrroot),
        r * (2 * x2 * sqrroot),
        r * (1 - 2 * (x12 + x22))
    ];

}

function dotGroupRandomize() {

    dotRotationAnim = 0;

    for ( let i = 0; i < 2; i++ ) {

        for (let k = 0; k < 20; k ++ ) {

            tmpColor.setHSL( Math.random(), 1.0, 0.75);

            dotColorArrays[i][ k*3 + 0 ] = tmpColor.r;
            dotColorArrays[i][ k*3 + 1 ] = tmpColor.g;
            dotColorArrays[i][ k*3 + 2 ] = tmpColor.b;

            let newPos = sampleUniformSphere();

            dotPositionArrays[i][ k*3 + 0 ] = newPos[0];
            dotPositionArrays[i][ k*3 + 1 ] = newPos[1];
            dotPositionArrays[i][ k*3 + 2 ] = newPos[2];

        }

        dotGeometries[i].attributes.position.needsUpdate = true;
        dotGeometries[i].attributes.color.needsUpdate = true;
        dotGeometries[i].computeBoundingSphere();

    }

};

function loadSavedVariables()
{
    const lastMazeCompletionDate = Number(storageGetItem('lastMazeCompletionDate', '0'));
    // show tutorial if more than 30 days have passed since the last maze completion
    showTutorial = (Date.now() - lastMazeCompletionDate) > (1000 * 60 * 60 * 24 * 30);
}

function init() {

    loadSavedVariables();

    renderer = new THREE.WebGLRenderer( { antialias: true, powerPreference: "high-performance" } );
    renderer.setPixelRatio( Math.min(window.devicePixelRatio, 2) );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.domElement.id = "mainCanvas";
    document.body.appendChild( renderer.domElement );

    // add 3d compass
    compassRenderer = new THREE.WebGLRenderer( { antialias: true, alpha: true, powerPreference: "high-performance" } );
    compassRenderer.setPixelRatio( renderer.getPixelRatio() );
    let compassWindowSize = Math.floor( Math.min(window.innerWidth, window.innerHeight)/6 );
    compassRenderer.setSize( compassWindowSize, compassWindowSize );
    compassRenderer.setClearColor( 0x000000, 0 );
    compassRenderer.domElement.id = "compass";
    document.querySelector('#compass-container').appendChild( compassRenderer.domElement );

    compassScene = new THREE.Scene();

    compassCamera = new THREE.PerspectiveCamera( 75, 1/1, 0.1, 1000 );
    compassCamera.position.z = 2;

    let compassPoint = new THREE.PointLight( 0xffffff, 5, 0, 1 );
    compassPoint.position.set( -1, -2, 1 );
    compassScene.add( compassPoint );

    compassScene.add( new THREE.AmbientLight( 'gray' ) );

    // setup basic objects
    fpsClock = new THREE.Clock();
    timerStartMillis = 0;
    timerRunning = false;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
    camera.position.set( maze.getOffset(1), maze.getOffset(1), maze.getOffset(-2));

    dust.followObject(camera);
    dust.addTo(scene);  

    tmpColor = new THREE.Color();

    // load models
    blockGeometry = new THREE.InstancedBufferGeometry();
    THREE.BufferGeometry.prototype.copy.call( blockGeometry, new THREE.BoxGeometry() );
    let loader = new GLTFLoader();
    wallGeometry = new THREE.InstancedBufferGeometry();
    let arrowGeometry = new THREE.BufferGeometry();

    loader.load( 'models/wall.glb', function ( gltf ) {
        let modelWall = gltf.scene.getObjectByName('wall');
        THREE.BufferGeometry.prototype.copy.call(wallGeometry, modelWall.geometry);

        // build maze for first time
        // (must wait for this model to load or the colors don't work)
        buildMaze();
    }, undefined, function ( error ) {

        console.error( error );

    } );
    loader.load( 'models/arrow.glb', function ( gltf ) {
        let modelArrow = gltf.scene.getObjectByName('arrow');
        THREE.BufferGeometry.prototype.copy.call(arrowGeometry, modelArrow.geometry);
        arrowMesh = new THREE.Mesh( arrowGeometry, new THREE.MeshLambertMaterial( { color: 0xd92e18 } ) );
        compassScene.add( arrowMesh );
    }, undefined, function ( error ) {

        console.error( error );

    } );

    // load texture
    dotSprite = new THREE.TextureLoader().load( 'textures/dot.png' );

    // materials
    wallMaterial = new THREE.MeshLambertMaterial( { vertexColors: true } );
    darkMaterial = new THREE.MeshPhongMaterial( {color: 'hsl(0, 0%, 10%)'} );

    // set up lights
    let localLight = new THREE.PointLight( 0xffffff, 5, 0, 0.2 );
    camera.add( localLight );
    scene.add( camera );
    let ambLight = new THREE.AmbientLight( 0x808080 );
    scene.add( ambLight );

    // init controls
    if (isMobile) {
        document.body.classList.add('formfactor-non-desktop');
    }
    controls = new FlyPointerLockControls(camera, renderer.domElement);
    controls.movementSpeed = maze.majorWidth;
    controls.rollSpeed = 1;
    document.querySelector('#blocker').addEventListener('click', (event) => {
        menuLockControls();
    });
    document.querySelector('#blocker').addEventListener('onTouch', (event) => {
        menuLockControls();
    });
    controls.addEventListener( 'lock', function() {
        document.querySelector('#blocker').classList.add('hide');
        if (!timerRunning) {
            timerRunning = true;
            timerStartMillis = Date.now();
        }
    } );
    controls.addEventListener( 'unlock', function() {
        document.querySelector('#blocker').classList.remove('hide');

        // determine if the pause menu should be shown
        if (!finishedMaze && focusedMenu.id != 'menu-daily-intro' && !inTutorial)
        {
            updateFocusedMenu('#menu-pause')
        }

        updateMenuCentering();
    } );
    // P key listener
    document.addEventListener('keydown', (event) => {
        if (event.code == 'KeyP' && controls.isLocked)
        {
            controls.disableLock(new Event(''));
        }
    });
    // change end text for Mac
    if (navigator.userAgent.indexOf('Mac OS X') != -1)
    {
        document.querySelectorAll('.os-not-mac').forEach((e => {
            e.classList.add('hide');
        }));
        document.querySelectorAll('.os-mac').forEach((e => {
            e.classList.remove('hide');
        }));
    }

    // goal particles
    dotGroup = new THREE.Group();
    dotRotationAxes = [
        new THREE.Vector3(0.75, 0, 0.5).normalize(),
        new THREE.Vector3(0.75, 1, 0.5).normalize()
    ];
    dotPositionArrays = [
        new Float32Array( 3 * dotsPerGroup ),
        new Float32Array( 3 * dotsPerGroup )
    ];
    dotColorArrays = [
        new Float32Array( 3 * dotsPerGroup ),
        new Float32Array( 3 * dotsPerGroup )
    ];
    dotGeometries = [
        new THREE.BufferGeometry(),
        new THREE.BufferGeometry()
    ];

    for (let i = 0; i < 2; i++) {
        dotGeometries[i].setAttribute( 'position', new THREE.BufferAttribute( dotPositionArrays[i], 3 ) );
        dotGeometries[i].setAttribute( 'color', new THREE.BufferAttribute( dotColorArrays[i], 3 ) );
    }

    let dotMaterials = [
        new THREE.PointsMaterial( { size: maze.minorWidth * 5, map: dotSprite, transparent: true, alphaTest: 0.8, vertexColors: true } ),
        new THREE.PointsMaterial( { size: maze.minorWidth * 2, map: dotSprite, transparent: true, alphaTest: 0.8, vertexColors: true } )
    ];
    let dots = [
        new THREE.Points( dotGeometries[0], dotMaterials[0] ),
        new THREE.Points( dotGeometries[1], dotMaterials[1] )
    ];
    dotGroup.add( ...dots );
    dotTmpQuaternion = new THREE.Quaternion();
    dotRotationAnim = 0;

    scene.add( dotGroup );

    // trail particles
    trailParticles = [];
    trailMotions = [];
    trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [0, 0, 0], 3 ) );
    trailPointSize = window.innerHeight / 25;

    lastTrailCameraPosition = new THREE.Vector3();

    tmpVector = new THREE.Vector3();

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
    focusedMenu = document.querySelector('#menu-intro');
    updateUIDeviceRotation();

    updateMenuCentering();
}

function buildMaze(size=mazeSize) {
    mazeSize = size;

    startedMaze = false;
    finishedMaze = false;

    mazePosNear = null;
    mazePosFar = null;

    segments = mazeSize * 2 - 1;
    endPos.set( maze.getOffset(segments), maze.getOffset(segments), maze.getOffset(segments + 2) );

    dotGroup.position.copy( endPos );
    dotGroupRandomize();

    camera.position.set( maze.getOffset(1), maze.getOffset(1), maze.getOffset(-2));
    camera.lookAt(maze.getOffset(1), maze.getOffset(1), 0);

    historyPositions = [];
    historyLine.geometry.dispose();
    historyMesh.visible = false;

    lastTrailCameraPosition.copy( camera.position );
    for (let i = 0; i < trailParticles.length; i++) {
        let part = trailParticles[i];
        scene.remove(part);
        part.material.dispose();
    }
    trailParticles = [];
    trailMotions = [];

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

    mazeGroup.add( blockInstanceMesh );

    timerRunning = false;

};

const collisionDistance = 0.25;
var axes = {x: 0, y: 1, z: 2};
function checkCollisionOnAxis(majorAxis, othA0, othA1, mazePosRelevant, newMazePosRelevant, mazePosOther, sign) {
    let min0 = Math.min(mazePosRelevant[othA0], mazePosOther[othA0]);
    let max0 = Math.max(mazePosRelevant[othA0], mazePosOther[othA0]);
    let min1 = Math.min(mazePosRelevant[othA1], mazePosOther[othA1]);
    let max1 = Math.max(mazePosRelevant[othA1], mazePosOther[othA1]);

    let collided = false;
    let colAx = mazePosRelevant[majorAxis] + sign;
    // solution for reading into maze xyz in correct order
    let indices = Array(3);
    indices[axes[majorAxis]] = colAx;
    function getMazeData(idx0, idx1) {
        indices[axes[othA0]] = idx0;
        indices[axes[othA1]] = idx1;
        return mazeData.collision_map[indices[0]][indices[1]][indices[2]];
    }
    // check for collisions on orthogonal axese
    for (let i = Math.max(min0, 0); i <= Math.min(mazeData.bounds[axes[othA0]]*2, max0); i++) {
        for (let j = Math.max(min1, 0); j <= Math.min(mazeData.bounds[axes[othA1]]*2, max1); j++) {
            if (colAx >= 0 && colAx <= mazeData.bounds[axes[majorAxis]]*2 && getMazeData(i, j)) {
                collided = true;
                break;
            }
        }
        if (collided)
            break;
    }
    if (collided) {
        camera.position[majorAxis] = maze.getOffset(mazePosRelevant[majorAxis]+sign) - sign * (collisionDistance + maze.minorWidth/2);
        newMazePosRelevant[majorAxis] = mazePosRelevant[majorAxis];
    } else {
        mazePosRelevant[majorAxis] += sign;
    }
};
function collisionUpdate() {
    let nearPos = new THREE.Vector3();
    nearPos.copy(camera.position);
    nearPos.addScalar(-collisionDistance);
    let farPos = new THREE.Vector3();
    farPos.copy(camera.position);
    farPos.addScalar(collisionDistance);
    let newMazePosNear = maze.getMazePos(nearPos);
    let newMazePosFar = maze.getMazePos(farPos);

    // initialize (only happens at start)
    if (mazePosNear == null && mazePosFar == null) {
        mazePosNear = newMazePosNear;
        mazePosFar = newMazePosFar;
    }

    // actual collision checking goes here
    if (newMazePosNear.distanceToSquared(mazePosNear) != 0) {
        if (newMazePosNear.x - mazePosNear.x < 0) {
            checkCollisionOnAxis('x', 'y', 'z', mazePosNear, newMazePosNear, mazePosFar, -1);
        }
        if (newMazePosNear.y - mazePosNear.y < 0) {
            checkCollisionOnAxis('y', 'x', 'z', mazePosNear, newMazePosNear, mazePosFar, -1);
        }
        if (newMazePosNear.z - mazePosNear.z < 0) {
            checkCollisionOnAxis('z', 'y', 'x', mazePosNear, newMazePosNear, mazePosFar, -1);
        }
    }
    if (newMazePosFar.distanceToSquared(mazePosFar) != 0) {
        if (newMazePosFar.x - mazePosFar.x > 0) {
            checkCollisionOnAxis('x', 'y', 'z', mazePosFar, newMazePosFar, mazePosNear, 1);
        }
        if (newMazePosFar.y - mazePosFar.y > 0) {
            checkCollisionOnAxis('y', 'x', 'z', mazePosFar, newMazePosFar, mazePosNear, 1);
        }
        if (newMazePosFar.z - mazePosFar.z > 0) {
            checkCollisionOnAxis('z', 'y', 'x', mazePosFar, newMazePosFar, mazePosNear, 1);
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

function updateFocusedMenu(newFocusedMenuSelector = null)
{
    if (newFocusedMenuSelector != null)
        focusedMenu = document.querySelector(newFocusedMenuSelector);

    document.querySelectorAll('.focusable-menu').forEach((e => {
        e.classList.add('hide');
    }));

    if (!document.querySelector('#menu-rotate-phone').classList.contains('hide'))
        return;

    focusedMenu.classList.remove('hide');
}

function onMazeCompletion()
{
    finishedMaze = true;
    document.querySelector('#completionMessage').classList.remove('hide');

    // switch menu screens
    updateFocusedMenu('#menu-new-maze');
    document.querySelector('#options-body').classList.add('hide');

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
    resetTutorial(true);
    storageSetItem('lastMazeCompletionDate', Date.now());

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

        focusedMenu.classList.add('hide');
        document.querySelector('#menu-rotate-phone').classList.remove('hide');
    }
    // if the rotation hint is showing and the user has rotated, restore the menu
    else if (!document.querySelector('#menu-rotate-phone').classList.contains('hide'))
    {
        document.querySelector('#menu-rotate-phone').classList.add('hide');
        updateFocusedMenu();
    }
}

var animate = function () {
    let delta = Math.min(fpsClock.getDelta(), 0.1);

    requestAnimationFrame( animate );

    controls.update(delta);
    dust.update(delta);

    collisionUpdate();

    // update the compass
    if (arrowMesh != null) {
        arrowMesh.lookAt( camera.position.clone().multiplyScalar(-1).add(endPos) );
        arrowMesh.applyQuaternion( camera.quaternion.clone().invert() );
    }

    // camera trail
    // shrink and disappear
    for (let i = 0; i < trailParticles.length; i++) {
        let part = trailParticles[i];

        part.material.size -= delta * trailPointSize/10;
        part.position.addScaledVector( trailMotions[i], delta * 0.02 );

        if (part.material.size <= 0.01) {
            scene.remove(part);
            part.material.dispose();
            trailParticles = trailParticles.splice(1); // remove earliest
            trailMotions = trailMotions.splice(1);
            i--;
        }
    }
    // spawn new
    if ( lastTrailCameraPosition.distanceToSquared( camera.position ) > collisionDistance**2 ) {
        lastTrailCameraPosition.copy( camera.position );

        let partMaterial = new THREE.PointsMaterial( { color: `hsl(${Math.random() * 360}, 100%, 50%)`, sizeAttenuation: false, size: trailPointSize, map: dotSprite, alphaTest: 0.8, transparent: true } );
        let partPoints = new THREE.Points( trailGeometry, partMaterial );

        tmpVector.set( Math.random() * collisionDistance * 2 - collisionDistance, Math.random() * collisionDistance * 2 - collisionDistance, -maze.minorWidth );
        tmpVector.applyMatrix4( camera.matrix );
        partPoints.position.copy( tmpVector );

        trailParticles.push( partPoints );
        trailMotions.push( new THREE.Vector3( ...sampleUniformSphere() ) );

        scene.add( partPoints );
    }
    if ( historyPositions.length == 0 || historyPositions[historyPositions.length - 1].distanceToSquared( camera.position ) > (0.1 * collisionDistance)**2 )
    {
        // add to history
        let newHistoryPosition = new THREE.Vector3();
        newHistoryPosition.copy(camera.position);
        historyPositions.push( newHistoryPosition );
    }


    // make the goal dots spin
    if (finishedMaze && dotRotationAnim < 1) {
        dotRotationAnim = Math.min(dotRotationAnim + delta*2, 1);
    }
    for (let i = 0; i < dotGroup.children.length; i++) {
        let mesh = dotGroup.children[i];
        dotTmpQuaternion.setFromAxisAngle( dotRotationAxes[i], (2.2 + i*0.4) * delta * (0.1 + dotRotationAnim * 0.9) );
        mesh.applyQuaternion( dotTmpQuaternion );
    }

    if (inTutorial)
    {
        handleTutorial();
    }

    renderer.render( scene, camera );
    compassRenderer.render( compassScene, compassCamera );
};

init();

animate();

function buildMazeAndUpdateUI(size)
{
    verifyAndReportAbandonedMaze();

    buildMaze(size);

    document.querySelector('#completionMessage').classList.add('hide');
    document.querySelector('#menu-new-maze').classList.add('hide');
    // show the pause text if the intro has been cleared
    if (!showTutorial)
        updateFocusedMenu('#menu-intro');

    document.querySelector('#mazeSizeSpan').innerHTML = mazeSize;

    updateMenuCentering();

    resetTutorial();

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
    menu_title.classList.remove('hide');

    let menu_height = document.querySelector('#menu-body').offsetHeight;
    const menu_space_to_fit = document.querySelector('#blocker').offsetHeight;

    // if there is not enough room, hide the title
    if (menu_space_to_fit < menu_height)
    {
        menu_title.classList.add('hide');
    }

    document.querySelector('#blocker').classList.toggle('center-menu', menu_space_to_fit > menu_height);

    // if the new maze menu is showing, make sure the slider is visible
    if (!document.querySelector('#menu-new-maze').classList.contains('hide'))
    {
        document.querySelector('#menu-new-maze-size-slider').scrollIntoView();
    }
}

function menuLockControls()
{
    // do not allow locking on mobile when in portrait mode
    if (!isMobile || isValidMobileAspectRatio())
        controls.lock();

    if (showTutorial && !inTutorial)
    {
        initTutorial();
    }
}

function initTutorial()
{
    // show how to look
    document.querySelector('#touch-tutorial-look').classList.remove('hide');
    document.querySelector('#touch-tutorial-look').style.animationName = 'touch-tutorial-animation-look';

    document.querySelector('#computer-tutorial-look').classList.remove('hide');
    document.querySelector('#computer-tutorial-look').style.animationName = 'tutorial-text-fade-in';
    document.querySelector('#computer-tutorial-look').style.animationFillMode = 'forwards';

    inTutorial = true;
    tutorialData.state = 'look';
}

var tutorialData =
{
    state: 'look', // look, move, finalFadeout
    cameraPos: new THREE.Vector3(),
    lastLoggedTime: 0
}
function handleTutorial()
{
    switch (tutorialData.state)
    {
        case 'look':
        {
            // check if the user has moved the camera
            if (camera.getWorldDirection(tmpVector).z < 0.975)
            {
                tutorialData.state = 'move';
                tutorialData.cameraPos.copy(camera.position);

                document.querySelector('#touch-tutorial-look').classList.add('hide');
                document.querySelector('#touch-tutorial-look').style.animationName = '';
                document.querySelector('#touch-tutorial-move').classList.remove('hide');
                document.querySelector('#touch-tutorial-move').style.animationName = 'touch-tutorial-animation-move';

                document.querySelector('#computer-tutorial-look').style.animationName = 'tutorial-text-fade-out';
                document.querySelector('#computer-tutorial-look').style.animationFillMode = 'forwards';
                document.querySelector('#computer-tutorial-move').classList.remove('hide');
                document.querySelector('#computer-tutorial-move').style.animationName = 'tutorial-text-fade-in';
                document.querySelector('#computer-tutorial-move').style.animationFillMode = 'forwards';

            }
        }
        break;
        case 'move':
        {
            // check if the user has moved enough
            if (camera.position.distanceToSquared(tutorialData.cameraPos) > 4)
            {
                tutorialData.state = 'compass';
                tutorialData.lastLoggedTime = Date.now();

                document.querySelector('#touch-tutorial-move').classList.add('hide');
                document.querySelector('#touch-tutorial-move').style.animationName = '';

                document.querySelector('#computer-tutorial-move').style.animationName = 'tutorial-text-fade-out';
                document.querySelector('#computer-tutorial-move').style.animationFillMode = 'forwards';

                document.querySelector('#computer-tutorial-compass').classList.remove('hide');
                document.querySelector('#computer-tutorial-compass').style.animationName = 'tutorial-text-fade-in';
                document.querySelector('#computer-tutorial-compass').style.animationFillMode = 'forwards';

                document.querySelector('#compass-container').style.animationName = 'compass-tutorial-highlight';
            }
        }
        break;
        case 'compass':
        {
            // check if 6 seconds have passed
            if (Date.now() - tutorialData.lastLoggedTime > 6000)
            {
                tutorialData.state = 'finalFadeout';
                tutorialData.lastLoggedTime = Date.now();

                document.querySelector('#computer-tutorial-compass').style.animationName = 'tutorial-text-fade-out';
                document.querySelector('#computer-tutorial-compass').style.animationFillMode = 'forwards';
            }
        }
        break;
        case 'finalFadeout':
        {
            // check if 0.5 seconds have passed
            if (Date.now() - tutorialData.lastLoggedTime > 500)
            {
                // complete the tutorial
                resetTutorial(true);
            }
        }
        break;
    }
}
function resetTutorial(complete = false)
{
    if (complete)
    {
        showTutorial = false;
    }

    inTutorial = false;
    document.querySelectorAll('.tutorial-element').forEach(element => {
        element.classList.add('hide');
        element.style.animationName = '';
    });
    document.querySelector('#compass-container').style.animationName = '';
}

document.querySelector('#mazeBuildButton').addEventListener('click', (event) => {
    buildMazeAndUpdateUI( document.querySelector('#newMazeSizeSlider').value );
});

document.querySelector('#menu-new-maze-button').addEventListener('click', (event) =>
{
    buildMazeAndUpdateUI( document.querySelector('#menu-new-maze-size-slider').value );

    menuLockControls();
});

document.querySelector('#setting-fixed-camera').addEventListener('change', (event) => {
    controls.setGimbalLocked( event.target.checked );
});

window.addEventListener('beforeunload', verifyAndReportAbandonedMaze);
