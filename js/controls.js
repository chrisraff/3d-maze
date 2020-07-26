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

function clamp(val, min, max) {
    return Math.min( Math.max( val, min ), max );
}

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
    this.tmpVector = new Vector3( 0, 0, 0 );
    
    var scope = this;

    var changeEvent = { type: 'change' };
    var lockEvent = { type: 'lock' };
    var unlockEvent = { type: 'unlock' };

    function is_touch_device() {
        try {
            document.createEvent("TouchEvent");
            return true;
        } catch (e) {
            return false;
        }
    }

    var touchable = is_touch_device();

    var touchDOM = null;

    var panTouchDragging = false;
    var panLastTouchX = 0;
    var panLastTouchY = 0;
    var panTouchIdentifier = 0;

    var moveTouchDragging = false;
    var moveStartX = 0;
    var moveStartY = 0;
    var moveLastX = 0;
    var moveLastY = 0;
    var moveTouchIdentifier = 0;

    function onMouseMove( event ) {
        if ( scope.isLocked === false ) return;

        let movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
        let movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

        scope.tmpVector.set( - movementY, - movementX, 0 );

        scope.applyRotation( scope.tmpVector, 0.002 );

        scope.dispatchEvent( changeEvent );
    };

    function onTouchStart( event ) {
        if ( scope.isLocked === false ) return;

        event.preventDefault();

        for (let i = 0; i < event.changedTouches.length; i++) {
            let t = event.changedTouches[i];
            if (t.clientX >= touchDOM.clientWidth / 2 && !panTouchDragging && (!moveTouchDragging || moveTouchIdentifier != t.identifier)) {
                panTouchDragging = true;

                panLastTouchX = t.clientX;
                panLastTouchY = t.clientY;
                panTouchIdentifier = t.identifier;
            } else if (!moveTouchDragging && (!panTouchDragging || panTouchIdentifier != t.identifier)) {
                moveTouchDragging = true;
                moveStartX = t.clientX;
                moveStartY = t.clientY;
                moveTouchIdentifier = t.identifier;
            }
        }
    }

    function onTouchEnd( event ) {
        event.preventDefault();

        for (let i = 0; i < event.changedTouches.length; i++) {
            let t = event.changedTouches[i];
            if (t.identifier == panTouchIdentifier && panTouchDragging) {
                panTouchDragging = false;
            } else if (t.identifier == moveTouchIdentifier && moveTouchDragging) {
                moveTouchDragging = false;
            }
        }
    }

    function onTouchMove( event ) {
        if ( scope.isLocked === false ) return;

        event.preventDefault();

        for (let i = 0; i < event.touches.length; i++) {
            let t = event.touches[i];
            if (t.identifier == panTouchIdentifier && panTouchDragging) {
                let movementX = (t.clientX - panLastTouchX) || event.mozMovementX || event.webkitMovementX || 0;
                let movementY = (t.clientY - panLastTouchY) || event.mozMovementY || event.webkitMovementY || 0;

                panLastTouchX = t.clientX;
                panLastTouchY = t.clientY;

                scope.tmpVector.set( - movementY, - movementX, 0 );

                scope.applyRotation( scope.tmpVector, 0.002 );

                scope.dispatchEvent( changeEvent );
            } else if (t.identifier == moveTouchIdentifier && moveTouchDragging) {
                moveLastX = t.clientX;
                moveLastY = t.clientY;
            }
        }
    }

    function onPointerlockChange() {
        if ( scope.domElement.ownerDocument.pointerLockElement === scope.domElement ) {

            scope.dispatchEvent( lockEvent );

            scope.isLocked = true;

        } else {

            scope.dispatchEvent( unlockEvent );

            scope.isLocked = false;

        }
    };

    this.disableLock = function( event ) {
        scope.domElement.ownerDocument.exitPointerLock();

        if (scope.isLocked) {
            scope.dispatchEvent( unlockEvent );

            scope.isLocked = false;
        }

        event.preventDefault();
    }

    function onPointerlockError() {
        console.error( 'FlyPointerlockControls: Unable to use Pointer Lock API' );
    };

    this.connect = function() {
        scope.domElement.ownerDocument.addEventListener( 'mousemove', onMouseMove, false);
        scope.domElement.ownerDocument.addEventListener( 'pointerlockchange', onPointerlockChange, false);
        scope.domElement.ownerDocument.addEventListener( 'pointerlockerror', onPointerlockError, false);

        touchDOM = scope.domElement.ownerDocument.getElementById('mainCanvas');
        touchDOM.addEventListener( 'touchstart', onTouchStart, false);
        touchDOM.addEventListener( 'touchmove', onTouchMove, false);
        touchDOM.addEventListener( 'touchend', onTouchEnd, false);

        let exitDOM = scope.domElement.ownerDocument.getElementById('completionMessage');
        exitDOM.addEventListener( 'touchstart', scope.disableLock , false );
    };

    this.disconnect = function() {
        scope.domElement.ownerDocument.removeEventListener( 'mousemove', onMouseMove, false );
        scope.domElement.ownerDocument.removeEventListener( 'pointerlockchange', onPointerlockChange, false );
        scope.domElement.ownerDocument.removeEventListener( 'pointerlockerror', onPointerlockError, false );

        touchDOM.removeEventListener( 'touchstart', onTouchStart, false);
        touchDOM.removeEventListener( 'touchmove', onTouchMove, false);
        touchDOM.removeEventListener( 'touchend', onTouchEnd, false);

        let exitDOM = scope.domElement.ownerDocument.getElementById('completionMessage');
        exitDOM.removeEventListener( 'touchstart', scope.disableLock , false );
    };

    this.dispose = function() {
        this.disconnect();
    };

    this.update = function ( delta ) {

        let moveMult = delta * this.movementSpeed;
        let rotMult = delta * this.rollSpeed;

        this.tmpVector.copy(this.moveVector);

        if (moveTouchDragging) {
            this.tmpVector.x += (moveLastX - moveStartX) * 4 / touchDOM.clientHeight;
            this.tmpVector.z += (moveLastY - moveStartY) * 4 / touchDOM.clientHeight;
        }
        this.tmpVector.x = clamp (this.tmpVector.x, -1, 1);
        this.tmpVector.z = clamp (this.tmpVector.z, -1, 1);

        if (this.tmpVector.length() > 1)
            this.tmpVector.normalize();

        this.object.translateX( this.tmpVector.x * moveMult );
        this.object.translateY( this.tmpVector.y * moveMult );
        this.object.translateZ( this.tmpVector.z * moveMult );

        this.applyRotation( this.rotationVector, rotMult );
    };

    this.applyRotation = function ( rotationVector_, scaleFactor = 1 ) {
        scope.tmpQuaternion.set( rotationVector_.x * scaleFactor, rotationVector_.y * scaleFactor, rotationVector_.z * scaleFactor, 1 ).normalize();
        scope.object.quaternion.multiply( scope.tmpQuaternion );

        // expose the rotation vector for convenience
        scope.object.rotation.setFromQuaternion( scope.object.quaternion, scope.object.rotation.order );
    }

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

        this.disconnect();

    };

    this.lock = function() {
        this.domElement.requestPointerLock();
        if (!this.isLocked && touchable) {

            scope.dispatchEvent( lockEvent );

            scope.isLocked = true;

        }
    }

    this.unlock = function() {
        scope.domElement.ownerDocument.exitPointerLock();
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

            // case 16: /* shift */ scope.movementSpeedMultiplier = .1; break;

            case 87: /*W*/ scope.moveState.forward = 1; break;
            case 83: /*S*/ scope.moveState.back = 1; break;

            case 65: /*A*/ scope.moveState.left = 1; break;
            case 68: /*D*/ scope.moveState.right = 1; break;

            case 32: /* space */ scope.moveState.up = 1; break;
            case 16: /* shift */ scope.moveState.down = 1; break;

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

            // case 16: /* shift */ scope.movementSpeedMultiplier = 1; break;

            case 87: /*W*/ scope.moveState.forward = 0; break;
            case 83: /*S*/ scope.moveState.back = 0; break;

            case 65: /*A*/ scope.moveState.left = 0; break;
            case 68: /*D*/ scope.moveState.right = 0; break;

            case 32: /* shift */ scope.moveState.up = 0; break;
            case 16: /* space */ scope.moveState.down = 0; break;

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