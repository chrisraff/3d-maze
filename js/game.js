/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */
import * as THREE from 'https://unpkg.com/three@0.118.3/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.118.3/examples/jsm/loaders/GLTFLoader.js';
import { FlyPointerLockControls } from './controls.js';
import * as maze from './maze.js';

// get webpage objects
var blocker = document.getElementById('blocker');
var completionMessage = document.getElementById('completionMessage');

var renderer = new THREE.WebGLRenderer();
// renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );


// add 3d compass
var compassRenderer = new THREE.WebGLRenderer( { alpha: true } );
var compassWindowSize = Math.floor( Math.min(window.innerWidth, window.innerHeight)/6 );
compassRenderer.setSize( compassWindowSize, compassWindowSize );
compassRenderer.setClearColor( 0x000000, 0 );
compassRenderer.domElement.id = "compass";
document.body.appendChild( compassRenderer.domElement );

var compassScene = new THREE.Scene();

var compassCamera = new THREE.PerspectiveCamera( 75, 1/1, 0.1, 1000 );
compassCamera.position.z = 2;

var dir = new THREE.Vector3( 1, 0, 0 );
var origin = new THREE.Vector3( 0, 0, 0 );
var length = 1;
var hex = 0xd92e18;

var arrowHelper = new THREE.ArrowHelper( dir, origin, length, hex, 0.5, 0.5 );
arrowHelper.line.material.color = new THREE.Color( 0xffffff );
arrowHelper.line.material.needsUpdate = true;
compassScene.add( arrowHelper );


// setup basic objects
var clock = new THREE.Clock();

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

const PI_2 = Math.PI / 2;

// load model
var blockGeometry = new THREE.BoxGeometry();
var loader = new GLTFLoader();
var wallGeometry = new THREE.BufferGeometry();

loader.load( 'models/wall.glb', function ( gltf ) {
    let modelWall = gltf.scene.getObjectByName('wall');
    THREE.BufferGeometry.prototype.copy.call(wallGeometry, modelWall.geometry);
}, undefined, function ( error ) {

    console.error( error );

} );

var darkMaterial = new THREE.MeshPhongMaterial( {color: 'hsl(0, 0%, 10%)'} );

// set up lights
var localLight = new THREE.PointLight( 0xffffff );
camera.add( localLight );
scene.add( camera );
var ambLight = new THREE.AmbientLight( 0x808080 );
scene.add( ambLight );

// init controls
const form_factor = WURFL.form_factor;
if (form_factor == 'Smartphone' || form_factor == 'Tablet') {
    // adjust controls
}
const controls = new FlyPointerLockControls(camera, renderer.domElement);
controls.movementSpeed = maze.majorWidth;
controls.rollSpeed = 1;
blocker.addEventListener( 'click', function() {
    controls.lock();
}, false );
controls.addEventListener( 'lock', function() {
    blocker.style.display = 'none';
} );
controls.addEventListener( 'unlock', function() {
    blocker.style.display = 'block';
} );

// maze variables
var mazeSize = 5;
var mazeData = maze.generateMaze(mazeSize);
var mazeGroup = new THREE.Group();
scene.add( mazeGroup );
// checkpoints
var startedMaze = false;
var finishedMaze = false;
// collisions
var mazePosNear = null; // closer to 0,0,0 (-)
var mazePosFar = null;

function buildMaze(size=mazeSize) {
    startedMaze = false;
    finishedMaze = false;

    completionMessage.style.display = 'none';

    mazePosNear = null;
    mazePosFar = null;

    camera.position.set( maze.getOffset(1), maze.getOffset(1), maze.getOffset(-2));
    camera.lookAt(maze.getOffset(1), maze.getOffset(1), 0);

    mazeGroup.remove(...mazeGroup.children);

    mazeSize = size;
    mazeData = maze.generateMaze(mazeSize);
    for (let i = 0; i < mazeData.length; i++) {
        for (let j = 0; j < mazeData[i].length; j++) {
            for (let k = 0; k < mazeData[i].length; k++) {
                if (    !mazeData[i][j][k] ||
                        (i!=0 && i!=mazeSize*2 && j!=0 && j!=mazeSize*2 && k!=0 && k!=mazeSize*2 && // if we're inside...
                            i%2==0 && j%2==0 && k%2==0)) // don't create unseen blocks
                    continue;

                let iWidth = maze.getWidth(i);
                let jWidth = maze.getWidth(j);
                let kWidth = maze.getWidth(k);

                // only large walls get color
                let colorful = false;
                if (iWidth + jWidth + kWidth >= 2 * maze.majorWidth + maze.minorWidth)
                    colorful = true;

                let block = null;

                // let material = new THREE.MeshLambertMaterial( { color: `hsl(${Math.floor(Math.random() * 360)},${colorful ? 100 : 0}%,${colorful ? 50 : 10}%)` } );
                if (colorful) {

                    let material = new THREE.MeshLambertMaterial( { color: `rgb(${
                        Math.floor( 25 + 200 * i/(mazeSize*2+1) ) },${
                        Math.floor( 25 + 200 * j/(mazeSize*2+1) ) },${
                        Math.floor( 25 + 200 * k/(mazeSize*2+1) ) })`
                    } );
                    block = new THREE.Mesh( wallGeometry, material );
                    block.scale.set( maze.majorWidth, maze.minorWidth, maze.majorWidth );
                    block.position.set( maze.getOffset(i), maze.getOffset(j), maze.getOffset(k) );

                    // rotate appropriately
                    if (iWidth == maze.minorWidth) {
                        block.rotation.z = PI_2;
                    } else if (kWidth == maze.minorWidth) {
                        block.rotation.x = PI_2;
                    }

                } else {
                    block = new THREE.Mesh( blockGeometry, darkMaterial );
                    block.scale.set( iWidth, jWidth, kWidth );
                    block.position.set( maze.getOffset(i), maze.getOffset(j), maze.getOffset(k) );
                }

                mazeGroup.add( block );
            }
        }
    }

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
        return mazeData[indices[0]][indices[1]][indices[2]];
    }
    // check for collisions on orthogonal axes
    for (let i = Math.max(min0, 0); i <= Math.min(mazeSize*2, max0); i++) {
        for (let j = Math.max(min1, 0); j <= Math.min(mazeSize*2, max1); j++) {
            if (colAx >= 0 && colAx <= mazeSize*2 && getMazeData(i, j)) {
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
    if (newMazePosNear.distanceTo(mazePosNear) != 0) {
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
    if (newMazePosFar.distanceTo(mazePosFar) != 0) {
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

    if (mazePosFar.z == -1 && startedMaze) {
        startedMaze = false;
    } else if (!startedMaze && mazePosFar.z == 1 && mazePosFar.x == 1 && mazePosFar.y == 1) {
        startedMaze = true;
    } else if (!finishedMaze && startedMaze && mazePosFar.z == mazeSize * 2) {
        finishedMaze = true;
        completionMessage.style.display = 'block';
    }
};

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize( window.innerWidth, window.innerHeight );

}

window.addEventListener( 'resize', onWindowResize, false );

// save the positions of the entrance and exit of the maze
var startPos = new THREE.Vector3( maze.getOffset(1), maze.getOffset(1), maze.getOffset(1) );
var segments = mazeSize * 2 - 0.5;
var endPos = new THREE.Vector3( maze.getOffset(segments), maze.getOffset(segments), maze.getOffset(segments) );


var animate = function () {
    let delta = clock.getDelta();

    requestAnimationFrame( animate );

    controls.update(delta);

    collisionUpdate();

    // update the compass
    var compassDir = camera.position.clone().multiplyScalar(-1).add(endPos).normalize();
    compassDir.applyQuaternion( camera.quaternion.clone().inverse() );
    arrowHelper.setDirection(compassDir);

    renderer.render( scene, camera );
    compassRenderer.render( compassScene, compassCamera );
};

buildMaze();
animate();
