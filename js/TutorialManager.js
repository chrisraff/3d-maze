/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

import * as THREE from 'three';

export default class TutorialManager {
    constructor(options = {}) {
        this.showTutorial = options.showTutorial ?? true;
        this.inTutorial = false;
        this.tutorialType = options.tutorialType || 'intro';
        this.tutorialData = {
            step: 0,
            currentElement: null
        };
        this.cameraNode = options.cameraNode;
        this.isMobile = options.isMobile;

        this.tmpVector = new THREE.Vector3();

        this.tutorialCallbacks = {
            intro: {
                conditions: {
                    0: () => {
                        return this.cameraNode && this.cameraNode.getWorldDirection(this.tmpVector).z > -0.975;
                    },
                    1: () => {
                        return this.cameraNode && this.cameraNode.position.distanceToSquared(this.tutorialData.cameraPos) > 4;
                    },
                    2: () => {
                        return Date.now() - this.tutorialData.lastLoggedTime > 6000;
                    }
                },
                setup: {
                    0: () => {
                        if (this.isMobile) {
                            const el = document.querySelector('#touch-tutorial-look');
                            el.style.display = '';
                            el.style.animationName = 'touch-tutorial-animation-look';
                        }
                    },
                    1: () => {
                        this.tutorialData.cameraPos = this.cameraNode.position.clone();

                        if (this.isMobile) {
                            const el = document.querySelector('#touch-tutorial-look');
                            el.style.display = 'none';
                            el.style.animationName = '';
                            const moveEl = document.querySelector('#touch-tutorial-move');
                            moveEl.style.display = '';
                            moveEl.style.animationName = 'touch-tutorial-animation-move';
                        }
                    },
                    2: () => {
                        this.tutorialData.lastLoggedTime = Date.now();

                        if (this.isMobile) {
                            document.querySelector('#touch-tutorial-move').style.display = 'none';
                            document.querySelector('#touch-tutorial-move').style.animationName = '';
                        }

                        document.querySelector('#computer-tutorial-compass').style.animationFillMode = 'forwards';
                        document.querySelector('#compass-container').style.animationName = 'compass-tutorial-highlight';
                    }
                },
                teardown: () => {
                    document.querySelector('#compass-container').style.animationName = '';
                }
            }
        };
    }

    startTutorial(type = 'intro') {
        this.tutorialType = type;
        this.inTutorial = true;

        this.displayTutorialStep(0);
    }

    displayTutorialStep(step) {

        const setup = this.tutorialCallbacks[this.tutorialType].setup[step];
        if (setup) setup();

        this.tutorialData.currentElement = document.querySelector('[tutorial-type="' + this.tutorialType + '"][tutorial-step="' + step + '"]');

        if (this.tutorialData.currentElement == null) return false;

        this.tutorialData.currentElement.style.display = '';
        this.tutorialData.currentElement.style.animationName = 'tutorial-text-fade-in';
        this.tutorialData.currentElement.style.animationFillMode = 'forwards';

        return true;
    }

    cleanupTutorialStep(step) {
        const element = document.querySelector('[tutorial-type="' + this.tutorialType + '"][tutorial-step="' + step + '"]');
        if (element) {
            element.style.animationName = 'tutorial-text-fade-out';
            element.style.animationFillMode = 'forwards';
        }
    }

    update() {
        if (!this.inTutorial) return;

        const callbacks = this.tutorialCallbacks[this.tutorialType];
        if (!callbacks) return;

        const condition = callbacks.conditions[this.tutorialData.step];
        if (condition && condition()) {
            console.log('Tutorial step ' + this.tutorialData.step + ' complete');
            this.cleanupTutorialStep(this.tutorialData.step);

            this.tutorialData.step++;

            const result = this.displayTutorialStep(this.tutorialData.step);
            if (!result) {
                // enter final fadeout
                this.cleanupTutorialStep(this.tutorialData.step - 1);
                setTimeout(() => {
                    this.resetTutorial(true);
                }, 500);
            }
        }
    }

    resetTutorial(complete = false) {
        if (complete) {
            this.showTutorial = false;
        }
        this.inTutorial = false;
        document.querySelectorAll('.tutorial-element').forEach(element => {
            element.style.display = 'none';
            element.style.animationName = '';
        });
        this.tutorialCallbacks[this.tutorialType].teardown?.();
    }
}
