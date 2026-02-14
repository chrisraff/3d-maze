/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { HTMLMesh } from 'three/examples/jsm/interactive/HTMLMesh.js';

export default class VRManager {
    constructor(renderer, cameraNode, cameraCompensationNode, camera, scene, dotSprite) {
        this.renderer = renderer;
        this.cameraNode = cameraNode;
        this.cameraCompensationNode = cameraCompensationNode;
        this.camera = camera;
        this.scene = scene;
        // VR state variables
        this.lastVrCameraPosition = new THREE.Vector3();
        this.newVrCameraPosition = new THREE.Vector3();
        this.calibrated = false;
        this.vrLeftController = null;
        this.vrLeftControllerIndex = null;
        this.vrLeftControllerObject = null;
        this.vrRightController = null;
        this.vrRightControllerIndex = null;
        this.vrRightControllerObject = null;
        this.lastVrRotateTime = 0;
        this.lastVrMoveTime = 0;
        this.moveVector = new THREE.Vector3();
        this.controllers = [];
        this.dotSprite = dotSprite;

        this.rayCaster = new THREE.Raycaster();
        this.rayPosition = new THREE.Vector3();
        this.rayDirection = new THREE.Vector3(0, 0, -1);

        // Temporary vector for calculations
        this.tmpVector = new THREE.Vector3();

        // Setup XR
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local');

        // Setup event listeners
        this.setupXREventListeners();

        // Create VR button
        this.vrButton = VRButton.createButton(this.renderer);

        // UI state
        this.uiInteractionEnabled = false;
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

        // Controller button state tracking
        this.rightControllerButtonPressed = false;
        this.leftControllerButtonPressed = false;
    }

    setupXREventListeners() {
        this.renderer.xr.addEventListener('sessionstart', () => this.onXRSessionStart());
        this.renderer.xr.addEventListener('sessionend', () => this.onXRSessionEnd());
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
    }

    onXRSessionEnd() {
        this.reset();
        this.cameraNode.scale.set(1, 1, 1);
        this.camera.near = 0.1;

        this.uiMesh.dispose();
        this.cameraCompensationNode.remove(this.uiMesh);
        this.uiMesh = null;
        this.scene.remove(this.pointerObject);
    }

    registerXRInputs(event) {
        this.vrLeftController = null;
        this.vrRightController = null;

        const session = this.renderer.xr.getSession();
        for (let i = 0; i < session.inputSources.length; i++) {
            const source = session.inputSources[i];
            console.log(source);
            if (source.handedness == "left") {
                this.vrLeftController = source;
                this.vrLeftControllerIndex = i;
                this.vrLeftControllerObject = this.renderer.xr.getController(i);
            } else if (source.handedness == "right") {
                this.vrRightController = source;
                this.vrRightControllerIndex = i;
                this.vrRightControllerObject = this.renderer.xr.getController(i);
                this.cameraCompensationNode.add(this.vrRightControllerObject);
            }
        }
    }

    /**
     * Update VR state during animation loop
     */
    update() {
        if (!this.renderer.xr.isPresenting || !this.calibrated) {
            return;
        }

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

        // Handle right controller rotation
        if (this.vrRightController != null) {
            if (Math.abs(this.vrRightController.gamepad.axes[2]) > 0.9 && Date.now() - this.lastVrRotateTime > 500) {
                this.lastVrRotateTime = Date.now();

                // rotate the camera node in the direction of the stick
                this.cameraNode.rotation.y -= Math.sign(this.vrRightController.gamepad.axes[2]) * Math.PI / 4;
            }

            // if the right stick returns to center, reset the last rotate time so that the user can immediately rotate again when they push the stick
            if (Math.abs(this.vrRightController.gamepad.axes[2]) < 0.2) {
                this.lastVrRotateTime = 0;
            }

            if (this.uiInteractionEnabled) {
                this.rayCaster.setFromXRController(this.vrRightControllerObject);

                const int = this.rayCaster.intersectObjects([this.uiMesh], true)
                if (int.length > 0) {
                    this.uiUv.copy(int[0].uv);
                    this.uiUv.x *= this.uiDom.clientWidth;
                    this.uiUv.y = 1 - this.uiUv.y;
                    this.uiUv.y *= this.uiDom.clientHeight;

                    this.tmpVector.copy(int[0].face.normal).multiplyScalar(0.01);
                    this.pointerObject.position.copy(int[0].point).add(this.tmpVector);
                    this.pointerObject.visible = true;
                }
                else {
                    this.uiUv.set(-1, -1);
                    this.pointerObject.visible = false;
                }

                if (this.vrRightController.gamepad.buttons[0].pressed && !this.uiClickState) {
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
                    console.log(elementAtLocation);

                    // if the element is a slider, track interaction with it
                    if (elementAtLocation && elementAtLocation.tagName == 'INPUT' && elementAtLocation.type == 'range') {
                        this.uiInteractingElement = elementAtLocation;
                        this.uiInteractingDetails = elementAtLocation.getBoundingClientRect();
                        this.uiInteractingDetails.min = Number(this.uiInteractingElement.min);
                        this.uiInteractingDetails.max = Number(this.uiInteractingElement.max);
                    }
                }
                if (this.vrRightController.gamepad.buttons[0].pressed && this.uiClickState && this.uiInteractingElement) {
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
                else if (!this.vrRightController.gamepad.buttons[0].pressed && this.uiClickState) {
                    this.uiClickState = false;
                    this.uiInteractingElement = null;
                }
            }
        }

        // Handle left controller movement
        if (this.vrLeftController != null) {
            this.moveVector.set(this.vrLeftController.gamepad.axes[2], 0, this.vrLeftController.gamepad.axes[3]);

            const moveDist = 0.5;

            if (this.moveVector.lengthSq() > 0.5 && Date.now() - this.lastVrMoveTime > 500) {
                this.lastVrMoveTime = Date.now();
                this.moveVector.normalize().multiplyScalar(moveDist);
                this.moveVector.applyQuaternion(this.camera.quaternion);
                this.moveVector.applyQuaternion(this.cameraNode.quaternion);
                this.moveVector.multiplyVectors(this.moveVector, this.cameraNode.scale);
                this.cameraNode.position.add(this.moveVector);
            }
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
