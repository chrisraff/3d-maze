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

camera.position.set( getOffset(1), getOffset(1), getOffset(-2))
camera.lookAt(getOffset(1), getOffset(1), 0);

var mazeData = generateMaze();
var geometry = new THREE.BoxGeometry();
for (var i = 0; i < mazeData.length; i++) {
    for (var j = 0; j < mazeData[i].length; j++) {
        for (var k = 0; k < mazeData[i].length; k++) {
            if (!mazeData[i][j][k])
                continue;
            
            var iWidth = getWidth(i);
            var jWidth = getWidth(j);
            var kWidth = getWidth(k);

            // only large walls get color
            var colorful = false;
            if (iWidth + jWidth + kWidth >= 2 * majorWidth + minorWidth)
                colorful = true;

            var material = new THREE.MeshLambertMaterial( { color: `hsl(${Math.floor(Math.random() * 360)},${colorful ? 100 : 0}%,${colorful ? 50 : 10}%)` } );
            var block = new THREE.Mesh( geometry, material );
            block.scale.set( iWidth, jWidth, kWidth );
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