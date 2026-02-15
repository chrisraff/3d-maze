/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 */

import * as THREE from 'three';

export default class TutorialManager {
    constructor(options = {}) {
        this.showTutorial = options.showTutorial ?? true;
        this.inTutorial = false;
        this.tutorialType = options.tutorialType || 'default';
        this.tutorialData = {
            state: 'look',
            cameraPos: null,
            lastLoggedTime: 0
        };
        this.cameraNode = options.cameraNode;
        this.isMobile = options.isMobile;

        this.tmpVector = new THREE.Vector3();
    }

    startTutorial(type = 'default') {
        this.tutorialType = type;
        this.inTutorial = true;
        this.tutorialData = {
            state: 'look',
            cameraPos: this.cameraNode ? this.cameraNode.position.clone() : null,
            lastLoggedTime: 0
        };

        if (this.isMobile) {
            document.querySelector('#touch-tutorial-look').style.display = '';
            document.querySelector('#touch-tutorial-look').style.animationName = 'touch-tutorial-animation-look';
        }

        document.querySelector('#computer-tutorial-look').style.display = '';
        document.querySelector('#computer-tutorial-look').style.animationName = 'tutorial-text-fade-in';
        document.querySelector('#computer-tutorial-look').style.animationFillMode = 'forwards';

    }

    update() {
        if (!this.inTutorial) return;

        switch (this.tutorialData.state) {
            case 'look':
                if (this.cameraNode && this.cameraNode.getWorldDirection(this.tmpVector).z > -0.975) {
                    this.tutorialData.state = 'move';
                    this.tutorialData.cameraPos = this.cameraNode.position.clone();
                    this.updateTutorialUI('move');
                }
                break;
            case 'move':
                if (this.cameraNode && this.cameraNode.position.distanceToSquared(this.tutorialData.cameraPos) > 4) {
                    this.tutorialData.state = 'compass';
                    this.tutorialData.lastLoggedTime = Date.now();
                    this.updateTutorialUI('compass');
                }
                break;
            case 'compass':
                if (Date.now() - this.tutorialData.lastLoggedTime > 6000) {
                    this.tutorialData.state = 'finalFadeout';
                    this.tutorialData.lastLoggedTime = Date.now();
                    this.updateTutorialUI('finalFadeout');
                }
                break;
            case 'finalFadeout':
                if (Date.now() - this.tutorialData.lastLoggedTime > 500) {
                    this.resetTutorial(true);
                }
                break;
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
        const compass = document.querySelector('#compass-container');
        if (compass) compass.style.animationName = '';
    }

    updateTutorialUI(state) {
        // Update UI for each tutorial step/state
        if (state === 'move') {
            if (this.isMobile) {
                document.querySelector('#touch-tutorial-look').style.display = 'none';
                document.querySelector('#touch-tutorial-look').style.animationName = '';
                document.querySelector('#touch-tutorial-move').style.display = '';
                document.querySelector('#touch-tutorial-move').style.animationName = 'touch-tutorial-animation-move';
            }

            document.querySelector('#computer-tutorial-look').style.animationName = 'tutorial-text-fade-out';
            document.querySelector('#computer-tutorial-look').style.animationFillMode = 'forwards';
            document.querySelector('#computer-tutorial-move').style.display = '';
            document.querySelector('#computer-tutorial-move').style.animationName = 'tutorial-text-fade-in';
            document.querySelector('#computer-tutorial-move').style.animationFillMode = 'forwards';
        } else if (state === 'compass') {
            document.querySelector('#touch-tutorial-move').style.display = 'none';
            document.querySelector('#touch-tutorial-move').style.animationName = '';
            document.querySelector('#computer-tutorial-move').style.animationName = 'tutorial-text-fade-out';
            document.querySelector('#computer-tutorial-move').style.animationFillMode = 'forwards';
            document.querySelector('#computer-tutorial-compass').style.display = '';
            document.querySelector('#computer-tutorial-compass').style.animationName = 'tutorial-text-fade-in';
            document.querySelector('#computer-tutorial-compass').style.animationFillMode = 'forwards';
            document.querySelector('#compass-container').style.animationName = 'compass-tutorial-highlight';
        } else if (state === 'finalFadeout') {
            document.querySelector('#computer-tutorial-compass').style.animationName = 'tutorial-text-fade-out';
            document.querySelector('#computer-tutorial-compass').style.animationFillMode = 'forwards';
        }
    }
}
