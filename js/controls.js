/**
 * @author Chris Raff / https://www.ChrisRaff.com/
 * pointerlock controls:    https://github.com/mrdoob/three.js/blob/master/examples/jsm/controls/PointerLockControls.js
 * fly controls:            https://github.com/mrdoob/three.js/blob/master/examples/jsm/controls/FlyControls.js
 */

import {
    EventDispatcher,
    Quaternion,
    Vector3
} from "https://unpkg.com/three@0.118.3/build/three.module.js";

var FlyPointerLockControls = function ( object, domElement ) {

    if ( domElement === undefined ) {

        console.warn( 'THREE.FlyControls: The second parameter "domElement" is now mandatory.' );
        domElement = document;

    }

    this.object = object;
    this.domElement = domElement;

    if ( domElement ) this.domElement.setAttribute( 'tabindex', - 1 );

    // API

    this.movementSpeed = 1.0;
    this.rollSpeed = 0.005;

    this.autoForward = false;
    
    this.isLocked = false;

    // disable default target object behavior

    // internals

    this.tmpQuaternion = new Quaternion();

    this.mouseStatus = 0;

    this.moveState = { up: 0, down: 0, left: 0, right: 0, forward: 0, back: 0, pitchUp: 0, pitchDown: 0, yawLeft: 0, yawRight: 0, rollLeft: 0, rollRight: 0 };
    this.moveVector = new Vector3( 0, 0, 0 );
    this.rotationVector = new Vector3( 0, 0, 0 );
    
    var scope = this;

    var changeEvent = { type: 'change' };
    var lockEvent = { type: 'lock' };
    var unlockEvent = { type: 'unlock' };

    function onMouseMove( event ) {
        if ( scope.isLocked === false ) return;

        var movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
        var movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

        scope.rotationVector.x = -( movementY * 0.002 );
        scope.rotationVector.y = -( movementX * 0.002 );

        scope.update(0.75, true);

        scope.rotationVector.x = 0;
        scope.rotationVector.y = 0;

        scope.dispatchEvent( changeEvent );
    };

    function onPointerlockChange() {
        if ( scope.domElement.ownerDocument.pointerLockElement === scope.domElement ) {

            scope.dispatchEvent( lockEvent );

            scope.isLocked = true;

        } else {

            scope.dispatchEvent( unlockEvent );

            scope.isLocked = false;

        }
    };

    function onPointerlockError() {
        console.error( 'FlyPointerlockControls: Unable to use Pointer Lock API' );
    };

    this.connect = function() {
        scope.domElement.ownerDocument.addEventListener( 'mousemove', onMouseMove, false);
        scope.domElement.ownerDocument.addEventListener( 'pointerlockchange', onPointerlockChange, false);
        scope.domElement.ownerDocument.addEventListener( 'pointerlockerror', onPointerlockError, false);
    };

    this.disconnect = function() {
        scope.domElement.ownerDocument.removeEventListener( 'mousemove', onMouseMove, false );
        scope.domElement.ownerDocument.removeEventListener( 'pointerlockchange', onPointerlockChange, false );
        scope.domElement.ownerDocument.removeEventListener( 'pointerlockerror', onPointerlockError, false );
    };

    this.dispose = function() {
        this.disconnect();
    };

    this.update = function ( delta, xyRotationOnly=false ) {

        var moveMult = delta * this.movementSpeed;
        var rotMult = delta * this.rollSpeed;

        if (!xyRotationOnly) {
            this.object.translateX( this.moveVector.x * moveMult );
            this.object.translateY( this.moveVector.y * moveMult );
            this.object.translateZ( this.moveVector.z * moveMult );
        }

        this.tmpQuaternion.set( this.rotationVector.x * rotMult, this.rotationVector.y * rotMult, this.rotationVector.z * rotMult * !xyRotationOnly, 1 ).normalize();
        this.object.quaternion.multiply( this.tmpQuaternion );

        // expose the rotation vector for convenience
        this.object.rotation.setFromQuaternion( this.object.quaternion, this.object.rotation.order );

    };

    this.updateMovementVector = function () {

        var forward = ( this.moveState.forward || ( this.autoForward && ! this.moveState.back ) ) ? 1 : 0;

        this.moveVector.x = ( - this.moveState.left + this.moveState.right );
        this.moveVector.y = ( - this.moveState.down + this.moveState.up );
        this.moveVector.z = ( - forward + this.moveState.back );

        //console.log( 'move:', [ this.moveVector.x, this.moveVector.y, this.moveVector.z ] );

    };

    this.updateRotationVector = function () {

        this.rotationVector.x = ( - this.moveState.pitchDown + this.moveState.pitchUp );
        this.rotationVector.y = ( - this.moveState.yawRight + this.moveState.yawLeft );
        this.rotationVector.z = ( - this.moveState.rollRight + this.moveState.rollLeft );

        //console.log( 'rotate:', [ this.rotationVector.x, this.rotationVector.y, this.rotationVector.z ] );

    };

    function contextmenu( event ) {

        event.preventDefault();

    }

    this.dispose = function () {

        this.domElement.removeEventListener( 'contextmenu', contextmenu, false );
        this.domElement.removeEventListener( 'mousedown', _mousedown, false );
        this.domElement.removeEventListener( 'mousemove', _mousemove, false );
        this.domElement.removeEventListener( 'mouseup', _mouseup, false );

        window.removeEventListener( 'keydown', _keydown, false );
        window.removeEventListener( 'keyup', _keyup, false );

    };

    this.lock = function() {
        this.domElement.requestPointerLock();
    }

    this.unlock = function() {
        this.domElement.ownerDocument.exitPointerLock();
    }

    this.domElement.addEventListener( 'contextmenu', contextmenu, false );

    this.updateMovementVector();
    this.updateRotationVector();

    var onKeyDown = function ( event ) {

        if ( !scope.isLocked ) {
            return;
        }

        if ( event.altKey ) {

            return;

        }

        //event.preventDefault();

        switch ( event.keyCode ) {

            case 16: /* shift */ scope.movementSpeedMultiplier = .1; break;

            case 87: /*W*/ scope.moveState.forward = 1; break;
            case 83: /*S*/ scope.moveState.back = 1; break;

            case 65: /*A*/ scope.moveState.left = 1; break;
            case 68: /*D*/ scope.moveState.right = 1; break;

            case 82: /*R*/ scope.moveState.up = 1; break;
            case 70: /*F*/ scope.moveState.down = 1; break;

            case 38: /*up*/ scope.moveState.pitchUp = 1; break;
            case 40: /*down*/ scope.moveState.pitchDown = 1; break;

            case 37: /*left*/ scope.moveState.yawLeft = 1; break;
            case 39: /*right*/ scope.moveState.yawRight = 1; break;

            case 81: /*Q*/ scope.moveState.rollLeft = 1; break;
            case 69: /*E*/ scope.moveState.rollRight = 1; break;

        }

        scope.updateMovementVector();
        scope.updateRotationVector();

    };

    var onKeyUp = function ( event ) {

        switch ( event.keyCode ) {

            case 16: /* shift */ scope.movementSpeedMultiplier = 1; break;

            case 87: /*W*/ scope.moveState.forward = 0; break;
            case 83: /*S*/ scope.moveState.back = 0; break;

            case 65: /*A*/ scope.moveState.left = 0; break;
            case 68: /*D*/ scope.moveState.right = 0; break;

            case 82: /*R*/ scope.moveState.up = 0; break;
            case 70: /*F*/ scope.moveState.down = 0; break;

            case 38: /*up*/ scope.moveState.pitchUp = 0; break;
            case 40: /*down*/ scope.moveState.pitchDown = 0; break;

            case 37: /*left*/ scope.moveState.yawLeft = 0; break;
            case 39: /*right*/ scope.moveState.yawRight = 0; break;

            case 81: /*Q*/ scope.moveState.rollLeft = 0; break;
            case 69: /*E*/ scope.moveState.rollRight = 0; break;

        }

        scope.updateMovementVector();
        scope.updateRotationVector();

    };

    this.domElement.ownerDocument.addEventListener('keydown', onKeyDown, false);
    this.domElement.ownerDocument.addEventListener('keyup', onKeyUp, false);

    this.connect();

};

FlyPointerLockControls.prototype = Object.create( EventDispatcher.prototype );
FlyPointerLockControls.prototype.constructor = FlyPointerLockControls;

export { FlyPointerLockControls };