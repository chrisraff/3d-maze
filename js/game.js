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
controls.movementSpeed = 1;
controls.rollSpeed = 1;

var geometry = new THREE.BoxGeometry();
var material = new THREE.MeshLambertMaterial( { color: 0x00ff00 } );
var cube = new THREE.Mesh( geometry, material );
scene.add( cube );

camera.position.z = 5;

var animate = function () {
    var delta = clock.getDelta();

    requestAnimationFrame( animate );

    controls.update(delta);

    renderer.render( scene, camera );
};

animate();