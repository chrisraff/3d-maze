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

var compassPoint = new THREE.PointLight( 0xffffff );
compassPoint.position.set( -1, -2, 1 );
compassScene.add( compassPoint );

compassScene.add( new THREE.AmbientLight( 'gray' ) );


// setup basic objects
var clock = new THREE.Clock();

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

const PI_2 = Math.PI / 2;

// load models
var blockGeometry = new THREE.BoxGeometry();
var loader = new GLTFLoader();
var wallGeometry = new THREE.BufferGeometry();
var arrowGeometry = new THREE.BufferGeometry();
var arrowMesh = null;

loader.load( 'models/wall.glb', function ( gltf ) {
    let modelWall = gltf.scene.getObjectByName('wall');
    THREE.BufferGeometry.prototype.copy.call(wallGeometry, modelWall.geometry);
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
var dotSprite = new THREE.TextureLoader().load( 'textures/dot.png' );

// common materials
var darkMaterial = new THREE.MeshPhongMaterial( {color: 'hsl(0, 0%, 10%)'} );
var dotMaterialLarge = new THREE.PointsMaterial( { size: maze.minorWidth * 5, map: dotSprite, transparent: true, alphaTest: 0.8, vertexColors: true } );
var dotMaterialSmall = new THREE.PointsMaterial( { size: maze.minorWidth * 2, map: dotSprite, transparent: true, alphaTest: 0.8, vertexColors: true } );

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

// goal particles
var dotGroup = new THREE.Group();
var dotQuaternions = [];
for ( var i = 0; i < 2; i++ ) {
    let dotVertices = [];
    let dotColors = [];

    let tmpColor = new THREE.Color();

    for (let i = 0; i < 20; i ++ ) {
        // uniform sphere
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

        dotVertices.push(
            r * (2 * x1 * sqrroot),
            r * (2 * x2 * sqrroot),
            r * (1 - 2 * (x12 + x22))
        );

        tmpColor.setHSL( Math.random(), 1.0, 0.75);

        dotColors.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }

    let dotGeometry = new THREE.BufferGeometry();
    dotGeometry.setAttribute( 'position', new THREE.Float32BufferAttribute( dotVertices, 3 ) );
    dotGeometry.setAttribute( 'color', new THREE.Float32BufferAttribute( dotColors, 3 ) );

    let dots = new THREE.Points( dotGeometry, [dotMaterialLarge, dotMaterialSmall][i] );
    dotGroup.add( dots );

    let quaternion = new THREE.Quaternion();
    quaternion.setFromAxisAngle( new THREE.Vector3(0.75, i, 0).normalize(), 0.02 );
    dotQuaternions.push( quaternion );
}
scene.add( dotGroup );

// maze variables
var mazeSize = 3;
var mazeData = maze.generateMaze(mazeSize);
var mazeGroup = new THREE.Group();
scene.add( mazeGroup );
// checkpoints
var startedMaze = false;
var finishedMaze = false;
// save the positions of the entrance and exit of the maze
var startPos = new THREE.Vector3( maze.getOffset(1), maze.getOffset(1), maze.getOffset(1) );
var segments = mazeSize * 2 - 0.5;
var endPos = new THREE.Vector3( maze.getOffset(segments), maze.getOffset(segments), maze.getOffset(segments) );
// collisions
var mazePosNear = null; // closer to 0,0,0 (-)
var mazePosFar = null;

function buildMaze(size=mazeSize) {
    mazeSize = size;

    startedMaze = false;
    finishedMaze = false;

    completionMessage.style.display = 'none';

    mazePosNear = null;
    mazePosFar = null;

    segments = mazeSize * 2 - 1;
    endPos.set( maze.getOffset(segments), maze.getOffset(segments), maze.getOffset(segments) );

    dotGroup.position.copy( endPos );
    dotGroup.position.z += maze.majorWidth + maze.minorWidth;

    camera.position.set( maze.getOffset(1), maze.getOffset(1), maze.getOffset(-2));
    camera.lookAt(maze.getOffset(1), maze.getOffset(1), 0);

    mazeGroup.remove(...mazeGroup.children);

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


var animate = function () {
    let delta = clock.getDelta();

    requestAnimationFrame( animate );

    controls.update(delta);

    collisionUpdate();

    // update the compass
    if (arrowMesh != null) {
        arrowMesh.lookAt( camera.position.clone().multiplyScalar(-1).add(endPos) );
        arrowMesh.applyQuaternion( camera.quaternion.clone().inverse() );
    }

    // make the goal dots look interesting
    for (let i = 0; i < dotGroup.children.length; i++) {
        let mesh = dotGroup.children[i];
        mesh.applyQuaternion( dotQuaternions[i] ) };

    renderer.render( scene, camera );
    compassRenderer.render( compassScene, compassCamera );
};

buildMaze();
animate();

document.getElementById('mazeBuildButton').addEventListener('click', (event) => {
    let newSize = document.getElementById('newMazeSizeSpan').innerHTML;
    buildMaze(newSize);
    document.getElementById('mazeSizeSpan').innerHTML = mazeSize;
}, false);
