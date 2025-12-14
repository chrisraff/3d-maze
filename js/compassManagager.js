import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export default class CompassManager {
    constructor(opts = {}) {
        const o = Object.assign({
            count: 800,
            color: new THREE.Color(0.4, 0.4, 0.4),
            spawnRadius: 20,
            map: null,
            size: 0.1
        }, opts);

        this.arrowMesh = null;

        this.renderer = new THREE.WebGLRenderer( { antialias: true, alpha: true, powerPreference: "high-performance" } );
        
        let compassWindowSize = Math.floor( Math.min(window.innerWidth, window.innerHeight)/6 );
        this.renderer.setSize( compassWindowSize, compassWindowSize );
        this.renderer.setClearColor( 0x000000, 0 );
        this.renderer.domElement.id = "compass";
        document.querySelector('#compass-container').appendChild( this.renderer.domElement );

        this.scene = new THREE.Scene();
        
        this.camera = new THREE.PerspectiveCamera( 75, 1/1, 0.1, 1000 );
        this.camera.position.z = 2;

        let compassPoint = new THREE.PointLight( 0xffffff, 5, 0, 1 );
        compassPoint.position.set( -1, -2, 1 );

        let compassSecondaryDirectional = new THREE.DirectionalLight( 0xffffff, 0.5 );
        compassSecondaryDirectional.position.set( 1, 0, 1);
        compassSecondaryDirectional.target.position.set(0,0,0);

        this.scene.add( compassSecondaryDirectional )
        this.scene.add( compassPoint );
    
        this.scene.add( new THREE.AmbientLight( 'gray' ) );

        // load the model
        const arrowGeometry = new THREE.BufferGeometry();
        const loader = new GLTFLoader();
        loader.load( 'models/arrow.glb', ( gltf ) => {
            const modelArrow = gltf.scene.getObjectByName('arrow');
            THREE.BufferGeometry.prototype.copy.call(arrowGeometry, modelArrow.geometry);
            this.arrowMesh = new THREE.Mesh( arrowGeometry, new THREE.MeshLambertMaterial( { color: 0xd92e18 } ) );
            this.scene.add( this.arrowMesh );
        }, undefined, ( error ) => {

            console.error( error );

        } );
    }

    followObject(object) {
        this.followedObject = object;
    }

    setEndPos(position) {
        this.endPos = position;
    }

    update() {
        if (this.arrowMesh != null && this.followedObject != null && this.endPos != null ) {
            this.arrowMesh.lookAt( this.followedObject.position.clone().multiplyScalar(-1).add(this.endPos) );
            this.arrowMesh.applyQuaternion( this.followedObject.quaternion.clone().invert() );
        }
    }

    render() {
        this.renderer.render( this.scene, this.camera );
    }
}