/**
 * Persisted user settings: loads them from storage into the UI and the
 * control/VR options, and keeps storage in sync when the DOM controls change.
 * The only module besides storage.js that touches localStorage.
 */
import { storageGetItem, storageSetItem } from './storage.js';

export default class Settings {
    constructor({ controls, vrManager, renderer, vrDeviceType }) {
        this.controls = controls;
        this.vrManager = vrManager;
        this.renderer = renderer;
        this.vrDeviceType = vrDeviceType;

        this.vrMirrorEnabled = false;
    }

    // reads stored settings and applies them to the controls and the menu DOM
    load() {
        const vrTeleport = storageGetItem('vr-setting-movement', 'teleport');
        this.controls.vrControlOptions.teleportationEnabled = vrTeleport == 'teleport';
        document.querySelectorAll('[name="vr-setting-movement"]').forEach((el) => {
            el.checked = el.value == vrTeleport;
        });

        const vrRotation = storageGetItem('vr-setting-rotation', 'instant');
        this.controls.vrControlOptions.rotationSmoothing = vrRotation == 'smooth';
        document.querySelectorAll('[name="vr-setting-rotation"]').forEach((el) => {
            el.checked = el.value == vrRotation;
        });

        this._updateVrRotateSpeedSettingEnabled();

        const vrRotationSpeed = Number(storageGetItem('vr-setting-rotation-speed', '0'));
        this.vrManager.rotationSpeed = Math.pow(3, vrRotationSpeed);
        document.querySelector('#vr-setting-rotation-speed').value = vrRotationSpeed;

        const vrMirroringDefault = this.vrDeviceType === 'vr-device-enabled' ? 'true' : 'false';
        this.vrMirrorEnabled = storageGetItem('vr-setting-mirror', vrMirroringDefault) === 'true';
        document.querySelector('#vr-setting-mirror').checked = this.vrMirrorEnabled;
    }

    // attaches change/input listeners to the settings DOM controls
    bindDom() {
        document.querySelector('#setting-fixed-camera').addEventListener('change', (event) => {
            this.controls.setGimbalLocked( event.target.checked );
        });

        document.querySelector('#vr-setting-mirror').addEventListener('change', (event) => {
            storageSetItem('vr-setting-mirror', event.target.checked ? 'true' : 'false');
            this.vrMirrorEnabled = event.target.checked;
        });

        document.querySelectorAll('.menu-radio-button').forEach((el) => {
            el.addEventListener('change', (event) => {
                if (event.target.name == 'vr-setting-movement') {
                    this.controls.vrControlOptions.teleportationEnabled = event.target.value == 'teleport';
                    storageSetItem('vr-setting-movement', event.target.value);
                }
                if (event.target.name == 'vr-setting-rotation') {
                    this.controls.vrControlOptions.rotationSmoothing = event.target.value == 'smooth';
                    this._updateVrRotateSpeedSettingEnabled();
                    storageSetItem('vr-setting-rotation', event.target.value);
                }
            });
        });

        document.querySelectorAll('.menu-slider').forEach((el) => {
            el.addEventListener('input', (event) => {
                const value = event.target.value;
                if (event.target.id == 'vr-setting-rotation-speed') {
                    const expValue = Math.pow(3, value);
                    this.vrManager.rotationSpeed = expValue;
                    storageSetItem('vr-setting-rotation-speed', value);
                }
                this.vrManager.uiMesh.material.map.update();
            });
        });

        document.querySelectorAll('.xr-force-redraw').forEach((el) => {
            el.addEventListener('change', (event) => {
                if (this.renderer.xr.isPresenting) {
                    this.vrManager.uiMesh.material.map.update();
                }
            });
        });
    }

    _updateVrRotateSpeedSettingEnabled() {
        const vrRotationSpeedSetting = document.querySelector('#vr-setting-rotation-speed');
        vrRotationSpeedSetting.disabled = !this.controls.vrControlOptions.rotationSmoothing;
    }
}
