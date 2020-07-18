import * as THREE from 'https://unpkg.com/three@0.118.3/build/three.module.js';
import { FlyControls } from 'https://unpkg.com/three@0.118.3/examples/jsm/controls/FlyControls.js';

var renderer = new THREE.WebGLRenderer();
// renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );

var clock = new THREE.Clock();

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

var localLight = new THREE.PointLight( 0xffffff );
camera.add( localLight );
scene.add( camera );
var ambLight = new THREE.AmbientLight( 0x303030 );
scene.add( ambLight );

const controls = new FlyControls(camera, renderer.domElement);
controls.dragToLook = true;
controls.movementSpeed = majorWidth;
controls.rollSpeed = 1;

var geometry = new THREE.BoxGeometry();
camera.position.z = -5;
camera.lookAt(0, 0, 0);

var mazeData = generateMaze();
for (var i = 0; i < mazeData.length; i++) {
    for (var j = 0; j < mazeData[i].length; j++) {
        for (var k = 0; k < mazeData[i].length; k++) {
            if (!mazeData[i][j][k])
                continue;
            var material = new THREE.MeshLambertMaterial( { color: new THREE.Color(`hsl(${Math.floor(Math.random() * 360)},100%,50%)`) } );
            var block = new THREE.Mesh( geometry, material );
            block.scale.set( getWidth(i), getWidth(j), getWidth(k) );
            block.position.set( getOffset(i), getOffset(j), getOffset(k) );
            scene.add( block );
        }
    }
}

var animate = function () {
    var delta = clock.getDelta();

    requestAnimationFrame( animate );

    controls.update(delta);

    renderer.render( scene, camera );
};

animate();