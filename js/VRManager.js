/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */
import * as THREE from 'three';
import { HTMLMesh } from 'three/examples/jsm/interactive/HTMLMesh.js';
import VRButtonManager from './VRButtonManager.js';

export default class VRManager extends EventTarget {
    constructor(renderer, cameraNode, cameraCompensationNode, camera, scene, dotSprite, controls) {
        super();

        this.renderer = renderer;
        this.cameraNode = cameraNode;
        this.cameraCompensationNode = cameraCompensationNode;
        this.camera = camera;
        this.scene = scene;
        // VR state variables
        this.lastVrCameraPosition = new THREE.Vector3();
        this.newVrCameraPosition = new THREE.Vector3();
        this.calibrated = false;
        this.controllers;
        this.vrLeftController = new Controller();
        this.vrRightController = new Controller();
        this.vrGazeController = new Controller();
        this.controllers = [this.vrLeftController, this.vrRightController, this.vrGazeController];
        this.moveVector = new THREE.Vector3();
        this.isVrControllingMovement = false;
        this.isVrControllingRotation = false;
        this.dotSprite = dotSprite;
        this.controls = controls;
        this.rotationSpeed = 1.0;

        this.isUsingGazeControls = false;
        this.lastGazeSelectTime = 0;
        this.isGazeSelectingFromGame = false;

        this.rayCaster = new THREE.Raycaster();
        this.rayPosition = new THREE.Vector3();
        this.rayDirection = new THREE.Vector3(0, 0, -1);

        // Temporary vector for calculations
        this.tmpVector = new THREE.Vector3();
        this.tmpVector2 = new THREE.Vector3();

        // Controller setup
        this.controller1 = this.renderer.xr.getController(0);
        this.controller2 = this.renderer.xr.getController(1);
        this.cameraCompensationNode.add(this.controller1);
        this.cameraCompensationNode.add(this.controller2);

        this.controller1.addEventListener('connected', (event) => {
            this.setupController(event, this.controller1);
        });
        this.controller1.addEventListener('disconnected', (event) => {
            this.onControllerDisconnected(event, this.controller1);
        });
        this.controller2.addEventListener('connected', (event) => {
            this.setupController(event, this.controller2);
        });
        this.controller2.addEventListener('disconnected', (event) => {
            this.onControllerDisconnected(event, this.controller2);
        });

        // blackout variables
        this.blackoutPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 'black', transparent: true, opacity: 0 }));
        this.blackoutPlane.visible = false;
        this.blackoutPlane.material.depthTest = false;
        this.blackoutPlane.renderOrder = 10000;
        this.camera.add(this.blackoutPlane);
        this.blackoutPlane.position.set(0, 0, -0.5);
        // listen for teleports
        controls.addEventListener('teleport', () => {
            this.doTeleportEffect();
        });

        // Setup XR
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local');

        // Setup event listeners
        this.setupXREventListeners();
        this.setupGamepadListeners();

        // Create VR button
        new VRButtonManager(this.renderer);

        // UI state
        this.uiInteractionEnabled = true;
        this.uiDom = document.querySelector('#overlay');

        this.pointerObject = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
            map: this.dotSprite,
            size: 0.015,
            color: 0x0088cc,
            opacity: 0.75,
            transparent: true,
            depthTest: false,
        }));
        // draw the ui pointer on top of everything else
        this.pointerObject.renderOrder = 1000;
        this.pointerObject.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
        this.pointerObject.visible = false;

        this.uiUv = new THREE.Vector2();
        this.uiInteractingElement = null;
        this.uiInteractingDetails = {};
        this.uiCurrentController = null;
        this.uiIsMouseControlled = false;
        this.mouseMoveListenerHandle = this.mouseMoveListener.bind(this);

        // controller pointer lines (shown in menu mode)
        this.vrLeftControllerLine = this._createControllerPointerLine();
        this.vrRightControllerLine = this._createControllerPointerLine();

        // store original display of elements that should be hidden in vr so that we can restore them when exiting vr
        this.hiddenDomElemnts = [];
    }

    setupController(event, controller) {
        let controllerSuper = null;
        if (event.data.targetRayMode === 'gaze') {
            controllerSuper = this.vrGazeController;
        } else if (event.data.handedness === 'left') {
            controllerSuper = this.vrLeftController;
            controller.add(this.vrLeftControllerLine);
        } else if (event.data.handedness === 'right') {
            controllerSuper = this.vrRightController;
            controller.add(this.vrRightControllerLine);
        }

        if (!controllerSuper) return;

        controllerSuper.object = controller;
        controllerSuper.inputSource = event.data;

        if (this.vrRightController.isValid() || this.vrLeftController.isValid()) {
            this.setUiInteractor(false, this.vrRightController.isValid() ? this.vrRightController : this.vrLeftController);
            this.isUsingGazeControls = false;
            document.querySelectorAll('.vr-controls-controllers').forEach(element => element.style.display = '');
            document.querySelectorAll('.vr-controls-gaze').forEach(element => element.style.display = 'none');
        } else if (this.vrGazeController.isValid()) {
            this.setUiInteractor(false, this.vrGazeController);

            this.isUsingGazeControls = true;

            document.querySelectorAll('.vr-controls-controllers').forEach(element => element.style.display = 'none');
            document.querySelectorAll('.vr-controls-gaze').forEach(element => element.style.display = '');
        }
    }

    onControllerDisconnected(event, controller) {
        // find the object associated
        let controllerSuper = null;
        if (this.vrLeftController.object === controller) {
            controllerSuper = this.vrLeftController;
            this.vrLeftControllerLine.removeFromParent();
        } else if (this.vrRightController.object === controller) {
            controllerSuper = this.vrRightController;
            this.vrRightControllerLine.removeFromParent();
        }
        if (controllerSuper) {
            controllerSuper.reset();
        }
    }

    setupXREventListeners() {
        this.renderer.xr.addEventListener('sessionstart', () => this.onXRSessionStart());
        this.renderer.xr.addEventListener('sessionend', () => this.onXRSessionEnd());
    }

    setupGamepadListeners() {
        // dispatch pause event when the thumbstick is pressed
        this.vrLeftController.addEventListener('buttondown', (event) => {
            if (event.detail.button === 3) {
                this.dispatchEvent(new CustomEvent('pause'));

                this.setUiInteractor(false, this.vrLeftController);
            }
        });
        this.vrRightController.addEventListener('buttondown', (event) => {
            if (event.detail.button === 3) {
                this.dispatchEvent(new CustomEvent('pause'));

                this.setUiInteractor(false, this.vrRightController);
            }
        });
    }

    setupSelectListeners(session) {
        session.addEventListener('selectstart', (event) => {
            if (this.uiInteractionEnabled) {
                // check if this event is from the current ui controller
                if (event.inputSource !== this.uiCurrentController?.inputSource && !this.uiClickState) {
                    // set the current ui controller
                    const controller = this.controllers.find((c) => c.inputSource === event.inputSource);
                    this.setUiInteractor(false, controller);
                    this.uiClickState = false;
                    return;
                }

                if (event.inputSource === this.uiCurrentController?.inputSource && !this.uiClickState) {
                    // if the event is from the current controller, but the click state is not active, activate it and pass a click to the dom
                    this.uiClickState = true;

                    const clickEvent = new MouseEvent('click', {
                        clientX: this.uiUv.x,
                        clientY: this.uiUv.y,
                        view: window,
                        bubbles: true,
                        cancelable: true
                    });
                    const elementAtLocation = document.elementFromPoint(this.uiUv.x, this.uiUv.y);

                    (elementAtLocation || this.uiDom).dispatchEvent(clickEvent);

                    // if the element is a slider, track interaction with it
                    if (elementAtLocation && elementAtLocation.tagName == 'INPUT' && elementAtLocation.type == 'range' && !elementAtLocation.disabled) {
                        this.uiInteractingElement = elementAtLocation;
                        this.uiInteractingDetails = elementAtLocation.getBoundingClientRect();
                        this.uiInteractingDetails.min = Number(this.uiInteractingElement.min);
                        this.uiInteractingDetails.max = Number(this.uiInteractingElement.max);
                        this.uiInteractingDetails.step = Number(this.uiInteractingElement.step) || 1;
                    }
                }

            // handle gaze input in game mode
            } else if (event.inputSource.targetRayMode === 'gaze') {
                this.lastGazeSelectTime = Date.now();
                this.isGazeSelectingFromGame = true;
            }
        });

        session.addEventListener('selectend', (event) => {
            if (this.uiInteractionEnabled) {
                // if the event is from the current controller, reset click state and stop interacting with any element
                if (event.inputSource === this.uiCurrentController?.inputSource) {
                    this.uiClickState = false;
                    this.uiInteractingElement = null;
                }

            // handle gaze input in game mode
            } else if (event.inputSource.targetRayMode === 'gaze') {
                if (!this.isGazeSelectingFromGame)
                    return;

                this.isGazeSelectingFromGame = false;

                if (Date.now() - this.lastGazeSelectTime > 500) {
                    this.dispatchEvent(new CustomEvent('pause'));
                } else {
                    // use short selections as forward motion
                    this.moveVector.set(0, 0, -1);
                    this.moveVector.applyQuaternion(this.camera.quaternion);
                    this.moveVector.applyQuaternion(this.cameraCompensationNode.quaternion);

                    setTimeout(() => {
                        console.log(this)
                        // stop movement after a short time
                        this.moveVector.set(0, 0, 0);
                    }, 50);
                }
            }
        });
    }

    onXRSessionStart() {
        const session = this.renderer.xr.getSession();

        // let the session start and the camera update to the initial position before doing the compensation, or else the compensation will be wrong
        setTimeout(() => {
            this.cameraCompensationNode.position.copy(this.camera.position).multiplyScalar(-1);
            this.newVrCameraPosition.copy(this.camera.position);
            this.calibrated = true;
        }, 1000);

        this.cameraNode.scale.set(1.5, 1.5, 1.5);
        this.camera.near = 0.001;

        this.uiMesh = new HTMLMesh(this.uiDom);
        this.uiMesh.position.set(0, 0, -1.5);
        // always draw the ui on top (but behind pointer)
        this.uiMesh.material.depthTest = false;
        this.uiMesh.renderOrder = 999;
        this.cameraCompensationNode.add(this.uiMesh);
        this.scene.add(this.pointerObject);
        this.uiClickState = false;

        document.querySelectorAll('.xr-non-vr').forEach((element) => {
            this.hiddenDomElemnts.push({ element, display: element.style.display });
            element.style.display = 'none';
        });
        document.querySelectorAll('.xr-vr').forEach(element => element.style.display = '');

        this.setupSelectListeners(session);
        window.addEventListener('mousemove', this.mouseMoveListenerHandle);
    }

    onXRSessionEnd() {
        this.reset();
        this.cameraNode.scale.set(1, 1, 1);
        this.camera.near = 0.1;

        this.uiMesh.dispose();
        this.cameraCompensationNode.remove(this.uiMesh);
        this.uiMesh = null;
        this.scene.remove(this.pointerObject);
        this.blackoutPlane.visible = false;

        document.querySelectorAll('.xr-vr').forEach(element => element.style.display = 'none');

        this.hiddenDomElemnts.forEach(({ element, display }) => element.style.display = display);
        this.hiddenDomElemnts = [];

        window.removeEventListener('mousemove', this.mouseMoveListenerHandle);
    }

    mouseMoveListener(event) {

        if (this.uiInteractionEnabled && this.renderer.xr.isPresenting) {
            // check if the mouse moved a significant amount
            if (event.movementX + event.movementY < 2) {
                this.setUiInteractor(true, null);
            }

            // compute world coordinates of mouse position on the ui plane
            this.tmpVector.set((event.clientX / this.uiDom.clientWidth - 0.5) * this.uiMesh.geometry.parameters.width, (0.5 - event.clientY / this.uiDom.clientHeight) * this.uiMesh.geometry.parameters.height, 0);
            this.uiMesh.localToWorld(this.tmpVector);
            this.pointerObject.position.copy(this.tmpVector);

            this.pointerObject.visible = true;
        }
    }

    _createControllerPointerLine() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
            color: 0x4499d0,
            opacity: 0.75,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        }));
        line.renderOrder = 1000;
        line.visible = false;
        return line;
    }

    _updateControllerLines() {
        const pairs = [
            { controller: this.vrLeftController, line: this.vrLeftControllerLine },
            { controller: this.vrRightController, line: this.vrRightControllerLine },
        ];

        for (const { controller, line } of pairs) {
            if (!this.uiInteractionEnabled || !controller.isValid()) {
                line.visible = false;
                continue;
            }

            line.visible = true;

            const isFocused = controller === this.uiCurrentController;
            let length;
            if (isFocused && this.uiMesh) {
                this.rayCaster.setFromXRController(controller.object);
                const hits = this.rayCaster.intersectObjects([this.uiMesh], true);
                if (hits.length > 0) {
                    // Convert world-space hit point to controller local space to account
                    // for any scale applied to parent nodes (e.g. cameraNode scale 1.5x).
                    this.tmpVector.copy(hits[0].point);
                    controller.object.worldToLocal(this.tmpVector);
                    length = -this.tmpVector.z;
                } else {
                    length = 3;
                }
            } else {
                length = 0.15;
            }

            line.geometry.attributes.position.setZ(1, -length);
            line.geometry.attributes.position.needsUpdate = true;
        }
    }

    /**
     * Update VR state during animation loop
     */
    update(delta) {
        if (!this.renderer.xr.isPresenting || !this.calibrated) {
            return;
        }

        this.vrLeftController.update();
        this.vrRightController.update();
        this._updateControllerLines();

        // in vr, compensate for user movement by updating the compensation node to put the head at the camera node position
        this.lastVrCameraPosition.copy(this.newVrCameraPosition);
        this.newVrCameraPosition.copy(this.camera.position);

        // compute the change in position since the last frame
        this.tmpVector.copy(this.newVrCameraPosition);
        this.tmpVector.sub(this.lastVrCameraPosition);

        this.cameraCompensationNode.position.sub(this.tmpVector);
        // rotate the tmpVector by the camera node rotation so that movement is in the correct direction relative to the maze
        this.tmpVector.applyQuaternion(this.cameraNode.quaternion);
        this.tmpVector.multiplyVectors(this.tmpVector, this.cameraNode.scale);
        this.cameraNode.position.add(this.tmpVector);

        // if the ui is disabled, allow controls
        if (!this.uiInteractionEnabled) {
            // if either controller is present, use them for movement and rotation controls
            if (this.vrLeftController.isValid() || this.vrRightController.isValid()) {
                this.moveVector.set(0, 0, 0);
            }

            // Handle right controller rotation via controls
            if (this.vrRightController.hasGamepad()) {
                // take max of stick and touchpad to support both input types
                const rightAxes = this.vrRightController.inputSource.gamepad.axes;
                const rightX = Math.abs(rightAxes[2]) >= Math.abs(rightAxes[0]) ? rightAxes[2] : rightAxes[0];
                const rightY = Math.abs(rightAxes[3]) >= Math.abs(rightAxes[1]) ? rightAxes[3] : rightAxes[1];

                // x axes is for left / right rotation
                if (Math.abs(rightX) > 0.01) {
                    this.isVrControllingRotation = true;
                    this.controls.rotationVector.set(0, -rightX * this.rotationSpeed, 0);
                } else if (this.isVrControllingRotation) {
                    this.controls.rotationVector.set(0, 0, 0);
                    this.isVrControllingRotation = false;
                }

                // use the right stick for up / down movement
                // (threshold requirement to prevent drift if smooth motion is enabled)
                if (Math.abs(rightY) > Math.abs(rightX * 0.75)) {
                    this.moveVector.y -= rightY;
                }
            }

            // Handle left controller movement
            if (this.vrLeftController.hasGamepad()) {
                // take max of stick and touchpad to support both input types
                const leftAxes = this.vrLeftController.inputSource.gamepad.axes;
                const leftX = Math.abs(leftAxes[2]) >= Math.abs(leftAxes[0]) ? leftAxes[2] : leftAxes[0];
                const leftY = Math.abs(leftAxes[3]) >= Math.abs(leftAxes[1]) ? leftAxes[3] : leftAxes[1];
                this.tmpVector.set(leftX, 0, leftY);

                this.tmpVector.applyQuaternion(this.camera.quaternion);
                this.tmpVector.applyQuaternion(this.cameraCompensationNode.quaternion);

                this.moveVector.add(this.tmpVector);
            }

            // send movement to controls
            if (this.moveVector.lengthSq() > 0.01) {
                this.controls.moveVector.copy(this.moveVector);
                this.isVrControllingMovement = true;
            } else if (this.isVrControllingMovement) {
                // don't override other controls
                this.controls.moveVector.set(0, 0, 0);
                this.isVrControllingMovement = false;
            }
        }

        // if the ui is enabled
        else {
            // if a controller is interacting with the ui
            if (this.uiCurrentController != null && this.uiCurrentController.isValid()) {

                // cast a ray from the controller
                this.rayCaster.setFromXRController(this.uiCurrentController.object);

                const int = this.rayCaster.intersectObjects([this.uiMesh], true)
                if (int.length > 0) {
                    this.uiUv.copy(int[0].uv);
                    this.uiUv.x *= this.uiDom.clientWidth;
                    this.uiUv.y = 1 - this.uiUv.y;
                    this.uiUv.y *= this.uiDom.clientHeight;

                    this.pointerObject.position.copy(int[0].point);
                    this.pointerObject.visible = true;
                }
                else {
                    this.uiUv.set(-1, -1);
                    this.pointerObject.visible = false;
                }

                if (this.uiClickState && this.uiInteractingElement) {
                    // compute slider value
                    let percent = (this.uiUv.x - this.uiInteractingDetails.left) / this.uiInteractingDetails.width;
                    percent = Math.max(0, Math.min(1, percent));

                    const value = Math.round((percent * (this.uiInteractingDetails.max - this.uiInteractingDetails.min) + this.uiInteractingDetails.min) / this.uiInteractingDetails.step) * this.uiInteractingDetails.step;

                    if (this.uiInteractingElement.value != value) {
                        this.uiInteractingElement.value = value;
                        const inputEvent = new Event('input', { bubbles: true });
                        this.uiInteractingElement.dispatchEvent(inputEvent);
                    }
                }
            }

            // check if either controller is trying to interact with the ui
            if (!this.uiClickState) {
                if (this.vrRightController.hasGamepad() && this.vrRightController.inputSource.gamepad.buttons[0].pressed) {
                    this.setUiInteractor(false, this.vrRightController);
                    this.uiClickState = true;
                }
                else if (this.vrLeftController.hasGamepad() && this.vrLeftController.inputSource.gamepad.buttons[0].pressed) {
                    this.setUiInteractor(false, this.vrLeftController);
                    this.uiClickState = true;
                }
            }
        }

        // make sure the ui is always in front of the player
        const cameraToUi = this.tmpVector.copy(this.uiMesh.position);
        cameraToUi.sub(this.camera.position);
        const distanceToUi2 = cameraToUi.lengthSq();

        // if looking away, reposition the ui to be in front of the user
        const cameraXZLook = this.tmpVector2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        cameraXZLook.projectOnPlane(new THREE.Vector3(0, 1, 0));
        cameraXZLook.normalize();
        cameraToUi.normalize();
        if (cameraXZLook.dot(cameraToUi) < 0.5 || distanceToUi2 > 9) {
            // set the ui position to be in front of the camera
            this.uiMesh.position.copy(cameraXZLook);
            this.uiMesh.position.multiplyScalar(1.5);
            this.uiMesh.position.add(this.camera.position);

            // make the ui face the camera
            cameraToUi.copy(this.uiMesh.position);
            cameraToUi.sub(cameraXZLook);
            cameraToUi.applyQuaternion(this.cameraCompensationNode.quaternion).add(this.cameraCompensationNode.position);
            cameraToUi.applyQuaternion(this.cameraNode.quaternion).add(this.cameraNode.position);
            this.uiMesh.lookAt(cameraToUi);
        }

        // teleport effect
        if (this.blackoutPlane.visible) {
            this.blackoutPlane.material.opacity -= delta * 4;
            if (this.blackoutPlane.material.opacity <= 0) {
                this.blackoutPlane.visible = false;
                this.blackoutPlane.material.opacity = 0;
            }
        }
    }

    doTeleportEffect() {
        if (!this.renderer.xr.isPresenting) {
            return;
        }

        this.blackoutPlane.visible = true;
        this.blackoutPlane.material.opacity = 0.75;
    }

    /**
     * Get the VR button element to add to the UI
     * @returns {HTMLElement} The VR button
     */
    getButton() {
        return this.vrButton;
    }

    /**
     * Check if VR is currently presenting
     * @returns {boolean}
     */
    isPresenting() {
        return this.renderer.xr.isPresenting;
    }

    setUiInteraction(enabled) {
        if (!enabled) {
            this.pointerObject.visible = false;
            this.uiInteractingElement = null;
        }
        this.uiClickState = false;
        this.uiInteractionEnabled = enabled;
    }

    setUiInteractor(isMouse, controller) {
        if (isMouse) {
            this.uiIsMouseControlled = true;
            this.uiCurrentController = null;
        } else {
            this.uiIsMouseControlled = false;
            this.uiCurrentController = controller;
        }
    }

    /**
     * Reset VR state on session end
     */
    reset() {
        this.calibrated = false;
        this.cameraCompensationNode.position.set(0, 0, 0);
        this.camera.position.set(0, 0, 0);
        this.camera.rotation.set(0, 0, 0);
    }
}

class Controller extends EventTarget {
    constructor() {
        super();

        this.reset();
    }

    isValid() {
        return this.object != null && this.inputSource != null;
    }

    // separate from isValid(): hand-tracking input sources can be valid (trackable, raycastable,
    // clickable via select events) without ever having a gamepad to read joystick/button state from
    hasGamepad() {
        return this.isValid() && this.inputSource.gamepad != null;
    }

    update() {
        if (!this.inputSource?.gamepad) {
            return;
        }

        for (let i = 0; i < this.inputSource.gamepad.buttons.length; i++) {
            const button = this.inputSource.gamepad.buttons[i];
            if (button.pressed && !this.buttonsPressed[i]) {
                this.buttonsPressed[i] = true;
                this.dispatchEvent(new CustomEvent('buttondown', { detail: { button: i, gamepad: this.inputSource.gamepad } }));
            } else if (!button.pressed && this.buttonsPressed[i]) {
                this.buttonsPressed[i] = false;
                this.dispatchEvent(new CustomEvent('buttonup', { detail: { button: i, gamepad: this.inputSource.gamepad } }));
            }
            else {
                this.buttonsPressed[i] = button.pressed;
            }
        }
    }

    reset() {
        this.object = null;
        this.inputSource = null;

        this.buttonsPressed = {};
    };
}
