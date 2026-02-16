/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { HTMLMesh } from 'three/examples/jsm/interactive/HTMLMesh.js';

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
        this.vrLeftController = new Controller();
        this.vrRightController = new Controller();
        this.lastVrRotateTime = 0;
        this.moveVector = new THREE.Vector3();
        this.isVrControllingMovement = false;
        this.controllers = [];
        this.dotSprite = dotSprite;
        this.controls = controls;

        this.rayCaster = new THREE.Raycaster();
        this.rayPosition = new THREE.Vector3();
        this.rayDirection = new THREE.Vector3(0, 0, -1);

        // Temporary vector for calculations
        this.tmpVector = new THREE.Vector3();
        this.tmpVector2 = new THREE.Vector3();

        // Setup XR
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local');

        // Setup event listeners
        this.setupXREventListeners();
        this.setupGamepadListeners();

        // Create VR button
        this.vrButton = VRButton.createButton(this.renderer);

        // UI state
        this.uiInteractionEnabled = true;
        this.uiDom = document.querySelector('body');

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

        // store original display of elements that should be hidden in vr so that we can restore them when exiting vr
        this.hiddenDomElemnts = [];
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

    onXRSessionStart() {
        const session = this.renderer.xr.getSession();
        session.addEventListener('inputsourceschange', (event) => this.registerXRInputs(event));

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

        document.querySelectorAll('.xr-non-vr').forEach((element) => {
            this.hiddenDomElemnts.push({ element, display: element.style.display });
            element.style.display = 'none';
        });
        document.querySelectorAll('.xr-vr').forEach(element => element.style.display = '');

        window.addEventListener('mousemove', this.mouseMoveListener.bind(this));
    }

    onXRSessionEnd() {
        this.reset();
        this.cameraNode.scale.set(1, 1, 1);
        this.camera.near = 0.1;

        this.uiMesh.dispose();
        this.cameraCompensationNode.remove(this.uiMesh);
        this.uiMesh = null;
        this.scene.remove(this.pointerObject);

        document.querySelectorAll('.xr-vr').forEach(element => element.style.display = 'none');

        this.hiddenDomElemnts.forEach(({ element, display }) => element.style.display = display);
        this.hiddenDomElemnts = [];

        window.removeEventListener('mousemove', this.mouseMoveListener.bind(this));
    }

    registerXRInputs(event) {

        this.vrLeftController.gamepad = null;
        this.vrRightController.gamepad = null;

        const session = this.renderer.xr.getSession();
        for (let i = 0; i < session.inputSources.length; i++) {
            const source = session.inputSources[i];
            if (source.handedness == "left") {
                this.vrLeftController.gamepad = source.gamepad;
                this.vrLeftController.object = this.renderer.xr.getController(i);
                this.cameraCompensationNode.add(this.vrLeftController.object);
            } else if (source.handedness == "right") {
                this.vrRightController.gamepad = source.gamepad;
                this.vrRightController.object = this.renderer.xr.getController(i);
                this.cameraCompensationNode.add(this.vrRightController.object);
            }
        }
    }

    mouseMoveListener(event) {
        if (this.uiInteractionEnabled && this.renderer.xr.isPresenting) {
            this.setUiInteractor(true, null);

            // compute world coordinates of mouse position on the ui plane
            this.tmpVector.set((event.clientX / this.uiDom.clientWidth - 0.5) * this.uiMesh.geometry.parameters.width, (0.5 - event.clientY / this.uiDom.clientHeight) * this.uiMesh.geometry.parameters.height, 0);
            this.uiMesh.localToWorld(this.tmpVector);
            this.pointerObject.position.copy(this.tmpVector);

            this.pointerObject.visible = true;
        }
    }

    /**
     * Update VR state during animation loop
     */
    update() {
        if (!this.renderer.xr.isPresenting || !this.calibrated) {
            return;
        }

        this.vrLeftController.update();
        this.vrRightController.update();

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
            this.moveVector.set(0, 0, 0);

            // Handle right controller rotation
            if (this.vrRightController.isValid()) {
                if (Math.abs(this.vrRightController.gamepad.axes[2]) > 0.9 && Date.now() - this.lastVrRotateTime > 500) {
                    this.lastVrRotateTime = Date.now();

                    // rotate the camera node in the direction of the stick
                    this.cameraNode.rotation.y -= Math.sign(this.vrRightController.gamepad.axes[2]) * Math.PI / 4;
                }

                // if the right stick returns to center, reset the last rotate time so that the user can immediately rotate again when they push the stick
                if (Math.abs(this.vrRightController.gamepad.axes[2]) < 0.2) {
                    this.lastVrRotateTime = 0;
                }

                // use the right stick for up / down movement
                this.moveVector.y -= this.vrRightController.gamepad.axes[3];
            }

            // Handle left controller movement
            if (this.vrLeftController.isValid()) {
                this.tmpVector.set(this.vrLeftController.gamepad.axes[2], 0, this.vrLeftController.gamepad.axes[3]);

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

                // if the trigger button is pressed, pass a click to dom
                if (this.uiCurrentController.gamepad.buttons[0].pressed && !this.uiClickState) {
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
                    if (elementAtLocation && elementAtLocation.tagName == 'INPUT' && elementAtLocation.type == 'range') {
                        this.uiInteractingElement = elementAtLocation;
                        this.uiInteractingDetails = elementAtLocation.getBoundingClientRect();
                        this.uiInteractingDetails.min = Number(this.uiInteractingElement.min);
                        this.uiInteractingDetails.max = Number(this.uiInteractingElement.max);
                    }
                }
                if (this.uiCurrentController.gamepad.buttons[0].pressed && this.uiClickState && this.uiInteractingElement) {
                    // compute slider value
                    let percent = (this.uiUv.x - this.uiInteractingDetails.left) / this.uiInteractingDetails.width;
                    percent = Math.max(0, Math.min(1, percent));

                    const value = this.uiInteractingDetails.min + percent * (this.uiInteractingDetails.max - this.uiInteractingDetails.min);

                    if (this.uiInteractingElement.value != Math.round(value)) {
                        this.uiInteractingElement.value = Math.round(value);
                        const inputEvent = new Event('input', { bubbles: true });
                        this.uiInteractingElement.dispatchEvent(inputEvent);
                    }
                }
                else if (!this.uiCurrentController.gamepad.buttons[0].pressed && this.uiClickState) {
                    this.uiClickState = false;
                    this.uiInteractingElement = null;
                }
            }

            // check if either controller is trying to interact with the ui
            if (!this.uiClickState) {
                if (this.vrRightController.isValid() && this.vrRightController.gamepad.buttons[0].pressed) {
                    this.setUiInteractor(false, this.vrRightController);
                    this.uiClickState = true;
                }
                else if (this.vrLeftController.isValid() && this.vrLeftController.gamepad.buttons[0].pressed) {
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
            this.uiClickState = false;
            this.pointerObject.visible = false;
        }
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

        this.gamepad = null;
        this.object = null;

        this.buttonsPressed = {};
    }

    isValid() {
        return this.gamepad != null && this.object != null;
    }

    update() {
        if (!this.gamepad) {
            return;
        }

        for (let i = 0; i < this.gamepad.buttons.length; i++) {
            const button = this.gamepad.buttons[i];
            if (button.pressed && !this.buttonsPressed[i]) {
                this.buttonsPressed[i] = true;
                this.dispatchEvent(new CustomEvent('buttondown', { detail: { button: i, gamepad: this.gamepad } }));
            } else if (!button.pressed && this.buttonsPressed[i]) {
                this.buttonsPressed[i] = false;
                this.dispatchEvent(new CustomEvent('buttonup', { detail: { button: i, gamepad: this.gamepad } }));
            }
            else {
                this.buttonsPressed[i] = button.pressed;
            }
        }
    }
}
