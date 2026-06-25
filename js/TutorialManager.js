/**
 * @author Chris Raff / http://www.ChrisRaff.com/
 *
 * Tutorial state machine. Provide setup and conditions for tutorial steps
 *
 * Usage:
 *   const manager = new TutorialManager({
 *       tutorialType: 'intro',
 *       showTutorials: { intro: true, vr: true },
 *       useAnimations: true,
 *       callbacks: {
 *           intro: {
 *               conditions: {
 *                   0: () => checkCondition(),
 *                   1: () => checkCondition(),
 *                   // ...
 *               },
 *               setup: {
 *                   0: (tutorialData) => doSetup(tutorialData),
 *                   1: (tutorialData) => doSetup(tutorialData),
 *                   // ...
 *               },
 *               teardown: (tutorialData) => cleanup(tutorialData)
 *           }
 *       }
 *   });
 */

export default class TutorialManager {
    /**
     * @param {Object} options
     * @param {string} [options.tutorialType='intro'] - The active tutorial type
     * @param {Object} [options.showTutorials={}] - Per-type show flags. Unset types default to showing.
     * @param {boolean} [options.showTutorial] - Legacy: sets the show flag for the initial tutorialType
     * @param {boolean} [options.useAnimations=true] - Whether to animate tutorial elements
     * @param {Object} options.callbacks - Tutorial callbacks by type
     *   @param {Object} callbacks[type].conditions - Step completion conditions, indexed by step
     *     conditions[stepNumber](): boolean - Returns true when step is complete
     *   @param {Object} callbacks[type].setup - Step setup callbacks, indexed by step
     *     setup[stepNumber](tutorialData): void - Called when entering a step
     *   @param {Function} [callbacks[type].teardown] - Called when tutorial completes
     *     teardown(tutorialData): void
     */
    constructor(options = {}) {
        this.inTutorial = false;
        this.tutorialType = options.tutorialType || 'intro';
        this.useAnimations = options.useAnimations ?? true;

        // External callbacks provided by upstream
        this.callbacks = options.callbacks || {};

        // Per-type show flags
        this.showTutorials = { ...(options.showTutorials ?? {}) };
        if (options.showTutorial !== undefined) {
            this.showTutorials[this.tutorialType] = options.showTutorial;
        }

        // Used for state snapshots. Passed to callbacks for read and write
        this.tutorialData = {
            step: 0,
            currentElement: null
        };
    }

    /**
     * Register or update callbacks for a tutorial type
     */
    registerTutorialType(type, callbacks) {
        this.callbacks[type] = callbacks;
    }

    setTutorialType(type) {
        if (this.tutorialType === type)
            return;

        this.resetTutorial();
        this.tutorialType = type;
    }

    startTutorial() {
        if (this.showTutorials[this.tutorialType] === false) return;

        if (this.inTutorial) {
            this.resetTutorial();
        }

        this.inTutorial = true;

        this.displayTutorialStep(0);
    }

    /**
     * Display a tutorial step and call its setup callback
     * @returns {boolean} True if step was displayed, false if no more steps
     */
    displayTutorialStep(step) {
        this.tutorialData.step = step;

        const typeCallbacks = this.callbacks[this.tutorialType];
        if (!typeCallbacks) return false;

        // Call setup callback if it exists, passing a reference to tutorialData
        const setup = typeCallbacks.setup?.[step];
        if (setup) setup(this.tutorialData);

        // Get the DOM element for this step
        this.tutorialData.currentElement = document.querySelector(
            `[tutorial-type="${this.tutorialType}"][tutorial-step="${step}"]`
        );

        if (!this.tutorialData.currentElement) return false;

        // Show the element with animation
        this.tutorialData.currentElement.style.display = '';
        if (this.useAnimations) {
            this.tutorialData.currentElement.style.animationName = 'tutorial-text-fade-in';
            this.tutorialData.currentElement.style.animationFillMode = 'forwards';
        }

        return true;
    }

    /**
     * Hide a tutorial step with animation
     */
    cleanupTutorialStep(step) {
        const element = document.querySelector(
            `[tutorial-type="${this.tutorialType}"][tutorial-step="${step}"]`
        );

        if (element) {
            if (this.useAnimations) {
                element.style.animationName = 'tutorial-text-fade-out';
                element.style.animationFillMode = 'forwards';
            } else {
                element.style.display = 'none';
            }
        }
    }

    /**
     * Update tutorial state - check if current step condition is met and advance if so
     */
    update() {
        if (!this.inTutorial) return;

        const typeCallbacks = this.callbacks[this.tutorialType];
        if (!typeCallbacks) return;

        // Check if current step's condition is met
        const condition = typeCallbacks.conditions?.[this.tutorialData.step];
        if (condition && condition(this.tutorialData)) {
            this.cleanupTutorialStep(this.tutorialData.step);

            this.tutorialData.step++;

            // Try to display the next step
            const result = this.displayTutorialStep(this.tutorialData.step);
            if (!result) {
                // No more steps, cleanup and end tutorial
                this.cleanupTutorialStep(this.tutorialData.step - 1);
                setTimeout(() => {
                    this.resetTutorial(true);
                }, 500);
            }
        }
    }

    /**
     * Reset tutorial state and cleanup
     * @param {boolean} [complete=false] - If true, marks this tutorial type as shown (won't show again)
     */
    resetTutorial(complete = false) {
        if (complete) {
            this.showTutorials[this.tutorialType] = false;
        }

        this.inTutorial = false;

        // Hide all tutorial elements
        document.querySelectorAll('.tutorial-element').forEach(element => {
            element.style.display = 'none';
            element.style.animationName = '';
        });

        // Call teardown callback if it exists
        const typeCallbacks = this.callbacks[this.tutorialType];
        if (typeCallbacks?.teardown) {
            typeCallbacks.teardown(this.tutorialData);
        }
    }
}
