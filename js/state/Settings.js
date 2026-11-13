/**
 * Persisted user settings: loads them from storage into the UI and the
 * control/VR options, and keeps storage in sync when the DOM controls change.
 * The only module besides storage.js that touches localStorage. The maze
 * generation options are persisted here too but applied by buildMaze, off
 * `mazeOptions` (see mazeOptions.js); marker facing is pushed straight into
 * BreadcrumbManager, since it applies to the next placement (markerFacing.js).
 */
import { storageGetItem, storageSetItem } from './storage.js';
import {
    MAZE_OPTION_BY_KEY, MAZE_OPTION_DEFAULTS, MAZE_OPTION_STORAGE_KEYS, coerceMazeOption,
} from './mazeOptions.js';
import {
    MARKER_FACING_CONTEXT_BY_KEY, MARKER_FACING_DEFAULT, MARKER_FACING_MODES,
    MARKER_FACING_STORAGE_KEYS, coerceMarkerFacing, markerFacingContext,
    reverseMarkerFacing,
} from './markerFacing.js';

export default class Settings {
    constructor({ controls, vrManager, renderer, vrDeviceType, breadcrumbs }) {
        this.controls = controls;
        this.vrManager = vrManager;
        this.renderer = renderer;
        this.vrDeviceType = vrDeviceType;
        this.breadcrumbs = breadcrumbs;

        this.vrMirrorEnabled = false;

        // { scenery, markers } - what the next maze will be generated with
        this.mazeOptions = { ...MAZE_OPTION_DEFAULTS };

        // { screen, vr } - which way each context aims a placed marker
        // (markerFacing.js). Tracked rather than read off renderer.xr, since
        // the VR mirror blanks isPresenting mid-frame to render the spectator.
        this.markerFacing = { screen: MARKER_FACING_DEFAULT, vr: MARKER_FACING_DEFAULT };
        this.vrPresenting = false;
    }

    /** The facing mode in force, which is the context the player is in. */
    get markerFacingMode() {
        return this.markerFacing[markerFacingContext(this.vrPresenting)];
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

        for (const [option, key] of Object.entries(MAZE_OPTION_STORAGE_KEYS)) {
            const mode = coerceMazeOption(option, storageGetItem(key, MAZE_OPTION_DEFAULTS[option]));
            this.mazeOptions[option] = mode;
            this._showMazeOption(key, mode);
        }

        for (const [context, key] of Object.entries(MARKER_FACING_STORAGE_KEYS)) {
            const mode = coerceMarkerFacing(storageGetItem(key, MARKER_FACING_DEFAULT));
            this.markerFacing[context] = mode;
            this._showMarkerFacing(key, mode);
        }
        this._applyMarkerFacing();
    }

    // Entering or leaving VR swaps which of the two stored values is in
    // force; the control itself is the same one either side.
    setVrPresenting(isPresenting) {
        this.vrPresenting = isPresenting;
        this._applyMarkerFacing();
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
                // the VR half of a maze option or of marker facing (see index.html)
                this._setMazeOption(event.target.name, event.target.value);
                this._setMarkerFacing(event.target.name, event.target.value);
            });
        });

        // the dropdown half of a maze option, which is what non-VR shows
        document.querySelectorAll('.menu-select').forEach((el) => {
            el.addEventListener('change', (event) => {
                this._setMazeOption(event.target.name, event.target.value);
                this._setMarkerFacing(event.target.name, event.target.value);
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

    /**
     * Records a maze option the player just chose; buildMaze applies it to
     * the next maze. `key` is the control's name, which doubles as its
     * storage key, and anything that isn't a maze option's is ignored, since
     * this shares its listeners with the control settings.
     */
    _setMazeOption(key, value) {
        const option = MAZE_OPTION_BY_KEY[key];
        if (!option) return;

        const mode = coerceMazeOption(option, value);
        this.mazeOptions[option] = mode;
        storageSetItem(key, mode);
        this._showMazeOption(key, mode);
    }

    // a dropdown and a radio group are two views of one setting, only one on
    // screen at a time, so both are set whichever the value came from
    _showMazeOption(key, mode) {
        document.querySelectorAll(`[name="${key}"]`).forEach((el) => {
            if (el.tagName == 'SELECT') el.value = mode;
            else if (el.type == 'radio') el.checked = el.value == mode;
        });
    }

    /**
     * Records which way the player just asked markers to face. `key` is the
     * control's name, which doubles as its storage key and names the context
     * it belongs to; anything that isn't one is ignored, since this shares
     * its listeners with the other settings.
     */
    _setMarkerFacing(key, value) {
        const context = MARKER_FACING_CONTEXT_BY_KEY[key];
        if (!context) return;

        const mode = coerceMarkerFacing(value);
        this.markerFacing[context] = mode;
        storageSetItem(key, mode);
        this._showMarkerFacing(key, mode);
        this._applyMarkerFacing();
    }

    // The two halves of this control hold a value each rather than mirroring
    // one, so a half only ever shows its own context's mode.
    _showMarkerFacing(key, mode) {
        document.querySelectorAll(`[name="${key}"]`).forEach((el) => {
            if (el.tagName == 'SELECT') el.value = mode;
            else if (el.type == 'radio') el.checked = el.value == mode;
        });
    }

    _applyMarkerFacing() {
        const mode = this.markerFacingMode;
        this.breadcrumbs?.setFacingMode(mode);
        this._showMarkerFacingCopy(mode);
    }

    /**
     * The one lesson that names a direction (`breadcrumb-reaim`) has a
     * fragment per direction, each classed for what it promises. The gesture
     * reverses whatever the setting placed, so the one shown is the reverse
     * of the mode. That copy lives outside `#overlay`, so inline display is
     * for the form-factor pass's sake rather than HTMLMesh's.
     */
    _showMarkerFacingCopy(mode) {
        const promised = reverseMarkerFacing(mode);
        for (const direction of MARKER_FACING_MODES) {
            document.querySelectorAll(`.marker-aim-${direction}`).forEach((el) => {
                el.style.display = direction == promised ? '' : 'none';
            });
        }
    }

    _updateVrRotateSpeedSettingEnabled() {
        const vrRotationSpeedSetting = document.querySelector('#vr-setting-rotation-speed');
        vrRotationSpeedSetting.disabled = !this.controls.vrControlOptions.rotationSmoothing;
    }
}
