import * as THREE from 'https://unpkg.com/three@0.118.3/build/three.module.js';
import { FlyControls } from 'https://unpkg.com/three@0.118.3/examples/jsm/controls/FlyControls.js';

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
controls.movementSpeed = majorWidth;
controls.rollSpeed = 1;

camera.position.set( getOffset(1), getOffset(1), getOffset(-2))
camera.lookAt(getOffset(1), getOffset(1), 0);

// build maze
var mazeSize = 5;
var mazeData = generateMaze(mazeSize);
var geometry = new THREE.BoxGeometry();
for (var i = 0; i < mazeData.length; i++) {
    for (var j = 0; j < mazeData[i].length; j++) {
        for (var k = 0; k < mazeData[i].length; k++) {
            if (    !mazeData[i][j][k] || 
                    (i!=0 && i!=mazeSize*2 && j!=0 && j!=mazeSize*2 && k!=0 && k!=mazeSize*2 && // if we're inside...
                        i%2==0 && j%2==0 && k%2==0)) // don't create unseen blocks
                continue;
            
            let iWidth = getWidth(i);
            let jWidth = getWidth(j);
            let kWidth = getWidth(k);

            // only large walls get color
            let colorful = false;
            if (iWidth + jWidth + kWidth >= 2 * majorWidth + minorWidth)
                colorful = true;

            // let material = new THREE.MeshLambertMaterial( { color: `hsl(${Math.floor(Math.random() * 360)},${colorful ? 100 : 0}%,${colorful ? 50 : 10}%)` } );
            let material = new THREE.MeshPhongMaterial( { color: colorful ? `rgb(${
                Math.floor( 255 * i/(mazeSize*2+1) ) },${
                Math.floor( 255 * j/(mazeSize*2+1) ) },${
                Math.floor( 255 * k/(mazeSize*2+1) ) })` : `hsl(0, 0%, 10%)`,
                opacity: 0.9, transparent: colorful, map: colorful ? gridTexture : null, specularMap: colorful ? gridSpecMap : null} );
            let block = new THREE.Mesh( geometry, material );
            block.scale.set( iWidth, jWidth, kWidth );
            block.position.set( getOffset(i), getOffset(j), getOffset(k) );

            scene.add( block );
        }
    }
}

var animate = function () {
    let delta = clock.getDelta();

    requestAnimationFrame( animate );

    controls.update(delta);

    renderer.render( scene, camera );
};

animate();