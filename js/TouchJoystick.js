/**
 * The floating movement stick for touch play.
 *
 * The ring is drawn at the drag distance that reaches full speed, so the knob
 * touching it means the player is moving as fast as they can - there is no
 * separate speedometer to read. Both come from `controls.getMoveTouchState()`,
 * which is where that distance is actually defined; nothing here decides how
 * fast anything moves.
 *
 * The knob is clamped radially, keeping the finger's direction. The movement
 * math clamps each axis first, so a drag far past the ring and well off the
 * diagonal moves at a different angle than the knob shows.
 */
export default class TouchJoystick {

    /**
     * @param {HTMLElement} root - the ring; sized and positioned per drag
     * @param {HTMLElement} knob - the inner circle, offset within the ring
     */
    constructor(root, knob) {
        this.root = root;
        this.knob = knob;
        this._visible = false;
        this._radius = 0;
    }

    /** @param {object} state - as `controls.getMoveTouchState()` returns it */
    update(state) {
        if (state == null || !state.active) {
            this.hide();
            return;
        }

        const radius = state.radius;
        if (radius <= 0) {
            this.hide();
            return;
        }

        if (radius !== this._radius) {
            this._radius = radius;
            this.root.style.width = `${radius * 2}px`;
            this.root.style.height = `${radius * 2}px`;
        }

        this.root.style.transform =
            `translate(${state.centerX - radius}px, ${state.centerY - radius}px)`;

        let x = state.offsetX;
        let y = state.offsetY;
        const distance = Math.hypot(x, y);
        if (distance > radius) {
            x *= radius / distance;
            y *= radius / distance;
        }
        this.knob.style.transform = `translate(${x}px, ${y}px)`;

        if (!this._visible) {
            this._visible = true;
            this.root.classList.add('visible');
        }
    }

    hide() {
        if (!this._visible)
            return;
        this._visible = false;
        this.root.classList.remove('visible');
    }

}
