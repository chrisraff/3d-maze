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

        this.useAnimations = true;

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
            },
            vr: {
                conditions: {
                    0: () => {
                        return this.cameraNode && this.cameraNode.position.distanceToSquared(this.tutorialData.cameraPos) > 1;
                    },
                    1: () => {
                        if (this.cameraNode && this.cameraNode.rotation.y != this.tutorialData.rotationStart)
                            this.tutorialData.rotateCondition = true;

                        return (this.tutorialData.rotateCondition && Date.now() - this.tutorialData.lastLoggedTime > 4000);
                    },
                    2: () => {
                        return Date.now() - this.tutorialData.lastLoggedTime > 6000;
                    }
                },
                setup: {
                    0: () => {
                        this.tutorialData.cameraPos = this.cameraNode.position.clone();
                    },
                    1: () => {
                        this.tutorialData.lastLoggedTime = Date.now();
                        this.tutorialData.rotationStart = this.cameraNode.rotation.y;
                        this.tutorialData.rotateCondition = false;
                    },
                    2: () => {
                        this.tutorialData.lastLoggedTime = Date.now();
                    }
                }
            }
        };
    }

    setTutorialType(type) {
        if (this.tutorialType == type)
            return;

        const wasInTutorial = this.inTutorial;

        this.resetTutorial();
        this.tutorialType = type;

        if (wasInTutorial) {
            this.startTutorial();
        }
    }

    startTutorial() {
        if (this.inTutorial) {
            this.resetTutorial();
        }

        this.inTutorial = true;

        this.displayTutorialStep(0);
    }

    displayTutorialStep(step) {

        this.tutorialData.step = step;

        const setup = this.tutorialCallbacks[this.tutorialType].setup[step];
        if (setup) setup();

        this.tutorialData.currentElement = document.querySelector('[tutorial-type="' + this.tutorialType + '"][tutorial-step="' + step + '"]');

        if (this.tutorialData.currentElement == null) return false;

        this.tutorialData.currentElement.style.display = '';
        if (this.useAnimations) {
            this.tutorialData.currentElement.style.animationName = 'tutorial-text-fade-in';
            this.tutorialData.currentElement.style.animationFillMode = 'forwards';
        }

        return true;
    }

    cleanupTutorialStep(step) {
        const element = document.querySelector('[tutorial-type="' + this.tutorialType + '"][tutorial-step="' + step + '"]');
        if (element) {
            if (this.useAnimations) {
                element.style.animationName = 'tutorial-text-fade-out';
                element.style.animationFillMode = 'forwards';
            } else {
                element.style.display = 'none';
            }
        }
    }

    update() {
        if (!this.inTutorial) return;

        const callbacks = this.tutorialCallbacks[this.tutorialType];
        if (!callbacks) return;

        const condition = callbacks.conditions[this.tutorialData.step];
        if (condition && condition()) {
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
