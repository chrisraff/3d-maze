import * as THREE from 'three';

/**
 * Renders small static 3D icons into PNG data URLs for use in the DOM.
 *
 * Every icon shares a single WebGL context, created lazily on the first
 * render and never attached to the document. Results are cached by key, so
 * a given icon is rendered at most once per page load - nothing in here
 * runs per frame, and an idle context costs no GPU time.
 *
 * If WebGL (or the DOM) is unavailable, render() returns null and callers
 * simply show no icon.
 */
class IconRenderer {

    constructor(size = 128) {
        this.size = size;
        this._renderer = null;
        this._unavailable = false;
        this._cache = new Map();
    }

    _getRenderer() {
        if (this._renderer !== null || this._unavailable)
            return this._renderer;

        try {
            this._renderer = new THREE.WebGLRenderer({
                alpha: true,
                antialias: true,
                // toDataURL reads the drawing buffer back after render()
                preserveDrawingBuffer: true,
                // keeps toDataURL from picking up blend halos on the
                // transparent background
                premultipliedAlpha: false,
            });
            this._renderer.setPixelRatio(1);
            this._renderer.setSize(this.size, this.size, false);
            this._renderer.setClearColor(0x000000, 0);
        } catch (error) {
            this._unavailable = true;
            this._renderer = null;
        }

        return this._renderer;
    }

    /**
     * @param {string} key - cache key; a key is rendered at most once
     * @param {function(): {scene: THREE.Scene, camera: THREE.Camera}} provide
     *        builds (or reconfigures) the scene. Only called on a cache miss.
     * @returns {string|null} a PNG data URL, or null if rendering isn't possible
     */
    render(key, provide) {
        if (this._cache.has(key))
            return this._cache.get(key);

        const renderer = this._getRenderer();
        if (renderer === null)
            return null;

        const { scene, camera } = provide();
        renderer.render(scene, camera);
        const url = renderer.domElement.toDataURL('image/png');

        this._cache.set(key, url);
        return url;
    }

    dispose() {
        if (this._renderer !== null) {
            this._renderer.dispose();
            this._renderer.forceContextLoss();
            this._renderer = null;
        }
        this._cache.clear();
    }

}

export default new IconRenderer();
