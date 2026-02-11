/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

export default class VRManager extends EventTarget {
    constructor(renderer, cameraNode, cameraCompensationNode, camera) {
        super();

        this.renderer = renderer;
        this.cameraNode = cameraNode;
        this.cameraCompensationNode = cameraCompensationNode;
        this.camera = camera;

        // VR state variables
        this.lastVrCameraPosition = new THREE.Vector3();
        this.newVrCameraPosition = new THREE.Vector3();
        this.calibrated = false;
        this.vrLeftController = null;
        this.vrRightController = null;
        this.lastVrRotateTime = 0;

        // Temporary vector for calculations
        this.tmpVector = new THREE.Vector3();

        // Setup XR
        this.renderer.xr.enabled = true;

        // Setup event listeners
        this.setupXREventListeners();

        // Create VR button
        this.vrButton = VRButton.createButton(this.renderer);
    }

    setupXREventListeners() {
        this.renderer.xr.addEventListener('sessionstart', () => this.onXRSessionStart());
        this.renderer.xr.addEventListener('sessionend', () => this.onXRSessionEnd());
    }

    onXRSessionStart() {
        // Emit event to notify game.js to disable pitch
        this.dispatchEvent(new CustomEvent('vrSessionStart', {}));

        const session = this.renderer.xr.getSession();
        session.addEventListener('inputsourceschange', (event) => this.registerXRInputs(event));

        // let the session start and the camera update to the initial position before doing the compensation, or else the compensation will be wrong
        setTimeout(() => {
            this.cameraCompensationNode.position.copy(this.camera.position).multiplyScalar(-1);
            this.newVrCameraPosition.copy(this.camera.position);
            this.calibrated = true;
        }, 1000);
    }

    onXRSessionEnd() {
        // Emit event to notify game.js to re-enable pitch
        this.dispatchEvent(new CustomEvent('vrSessionEnd', {}));

        this.calibrated = false;

        // reset camera compensation node
        this.cameraCompensationNode.position.set(0, 0, 0);
        this.camera.position.set(0, 0, 0);
        this.camera.rotation.set(0, 0, 0);
    }

    registerXRInputs(event) {
        this.vrLeftController = null;
        this.vrRightController = null;

        const session = this.renderer.xr.getSession();
        for (const source of session.inputSources) {
            console.log(source);
            if (source.handedness == "left") {
                this.vrLeftController = source;
            } else if (source.handedness == "right") {
                this.vrRightController = source;
            }
        }
    }

    /**
     * Update VR state during animation loop
     * @param {THREE.Vector3} tmpVector - Temporary vector for calculations
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

    /**
     * Check if VR session is calibrated
     * @returns {boolean}
     */
    isCalibrated() {
        return this.calibrated;
    }

    /**
     * Reset VR state when window resizes or on session end
     */
    reset() {
        this.calibrated = false;
        this.cameraCompensationNode.position.set(0, 0, 0);
        this.camera.position.set(0, 0, 0);
        this.camera.rotation.set(0, 0, 0);
    }
}
