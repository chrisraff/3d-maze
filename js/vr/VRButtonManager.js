/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 * Similar to https://github.com/mrdoob/three.js/blob/master/examples/jsm/webxr/VRButton.js
 * Derived for this project to work with multiple buttons
 */

export default class VRButtonManager {
    constructor(renderer, sessionInit = {}, buttonClass = 'button-vr') {
        this.renderer = renderer;
        this.buttons = document.querySelectorAll(`.${buttonClass}`);
        this.currentSession = null;
        this.sessionOptions = {
            ...sessionInit,
            optionalFeatures: [
                'local-floor',
                'bounded-floor',
                'layers',
                ...(sessionInit.optionalFeatures || [])
            ]
        };

        this.boundOnSessionEnded = this.onSessionEnded.bind(this);
        this.boundOnButtonClicked = this.onButtonClicked.bind(this);

        this.buttons.forEach((button) => {
            button.style.display = 'none';
            button.addEventListener('click', this.boundOnButtonClicked);
        });

        if ('xr' in navigator) {
            navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
                if (supported) {
                    this.buttons.forEach((button) => {
                        button.style.display = '';
                    });
                    this.offerSession();
                }
            }).catch((err) => {
                console.warn('Error checking WebXR support', err);
            });
        }
    }

    async onSessionStarted(session) {
        session.addEventListener('end', this.boundOnSessionEnded);
        this.currentSession = session;

        await this.renderer.xr.setSession(session);

        this.buttons.forEach((button) => {
            button.textContent = 'Exit VR';
        });
    }

    async onSessionEnded() {
        this.currentSession.removeEventListener('end', this.boundOnSessionEnded);

        this.currentSession = null;

        this.buttons.forEach((button) => {
            button.textContent = 'Enter VR';
        });
    }

    onButtonClicked = () => {
        if (this.currentSession === null) {
            navigator.xr.requestSession('immersive-vr', this.sessionOptions).then(this.onSessionStarted.bind(this));
        } else {
            this.currentSession.end();

            this.offerSession();
        }
    }

    offerSession() {
        if (navigator.xr && navigator.xr.offerSession !== undefined) {

            navigator.xr.offerSession('immersive-vr', this.sessionOptions)
                .then(this.onSessionStarted.bind(this))
                .catch((err) => {
                    console.warn(err);
                } );
        }
    }
}
