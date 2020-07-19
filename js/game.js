import * as THREE from 'https://unpkg.com/three@0.118.3/build/three.module.js';
import { FlyControls } from 'https://unpkg.com/three@0.118.3/examples/jsm/controls/FlyControls.js';
import * as maze from './maze.js';

var renderer = new THREE.WebGLRenderer();
// renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );

// load textures
var gridTexture = new THREE.TextureLoader().load( "textures/grid.bmp" );
gridTexture.wrapS = THREE.RepeatWrapping;
gridTexture.wrapT = THREE.RepeatWrapping;
gridTexture.repeat.set( 4, 4 );
gridTexture.magFilter = THREE.NearestFilter;
var gridSpecMap = new THREE.TextureLoader().load( "textures/gridSpec.bmp" );
gridSpecMap.wrapS = THREE.RepeatWrapping;
gridSpecMap.wrapT = THREE.RepeatWrapping;
gridSpecMap.repeat.set( 4, 4 );
gridSpecMap.magFilter = THREE.NearestFilter;

// setup basic objects
var clock = new THREE.Clock();

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

// set up lights
var localLight = new THREE.PointLight( 0xffffff );
camera.add( localLight );
scene.add( camera );
var ambLight = new THREE.AmbientLight( 0x808080 );
scene.add( ambLight );

// init controls
const controls = new FlyControls(camera, renderer.domElement);
controls.dragToLook = true;
controls.movementSpeed = maze.majorWidth;
controls.rollSpeed = 1;

camera.position.set( maze.getOffset(1), maze.getOffset(1), maze.getOffset(-2))
camera.lookAt(maze.getOffset(1), maze.getOffset(1), 0);

// build maze
var mazeSize = 5;
var mazeData = maze.generateMaze(mazeSize);
var geometry = new THREE.BoxGeometry();
for (var i = 0; i < mazeData.length; i++) {
    for (var j = 0; j < mazeData[i].length; j++) {
        for (var k = 0; k < mazeData[i].length; k++) {
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

            // let material = new THREE.MeshLambertMaterial( { color: `hsl(${Math.floor(Math.random() * 360)},${colorful ? 100 : 0}%,${colorful ? 50 : 10}%)` } );
            let material = new THREE.MeshPhongMaterial( { color: colorful ? `rgb(${
                Math.floor( 255 * i/(mazeSize*2+1) ) },${
                Math.floor( 255 * j/(mazeSize*2+1) ) },${
                Math.floor( 255 * k/(mazeSize*2+1) ) })` : `hsl(0, 0%, 10%)`,
                opacity: 0.85, transparent: colorful, map: colorful ? gridTexture : null, specularMap: colorful ? gridSpecMap : null} );
            let block = new THREE.Mesh( geometry, material );
            block.scale.set( iWidth, jWidth, kWidth );
            block.position.set( maze.getOffset(i), maze.getOffset(j), maze.getOffset(k) );

            scene.add( block );
        }
    }
}

const collisionDistance = 0.25;
var mazePosNear = null; // closer to 0,0,0 (-)
var mazePosFar = null;
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
    }
}
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
        let diffX = newMazePosNear.x - mazePosNear.x;
        if (diffX < 0) {
            checkCollisionOnAxis('x', 'y', 'z', mazePosNear, newMazePosNear, mazePosFar, -1);
        }
    }
    if (newMazePosFar.distanceTo(mazePosFar) != 0) {
        let diffX = newMazePosFar.x - mazePosFar.x;
        if (diffX > 0) {
            console.log('col')
            checkCollisionOnAxis('x', 'y', 'z', mazePosFar, newMazePosFar, mazePosNear, 1);
        }
    }

    mazePosNear = newMazePosNear;
    mazePosFar = newMazePosFar;
}

var animate = function () {
    let delta = clock.getDelta();

    requestAnimationFrame( animate );

    controls.update(delta);

    collisionUpdate();

    renderer.render( scene, camera );
};

animate();