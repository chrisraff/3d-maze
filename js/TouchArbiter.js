/**
 * @author Chris Raff / https://www.ChrisRaff.com
 */

// Return this from a handler callback to yield the touch to the next registered handler.
export const YIELD = Symbol('yield');

export default class TouchArbiter {
    constructor(element, options = {}) {
        this.element = element;
        this.isEnabled = options.isEnabled ?? (() => true);
        this.preventDefault = options.preventDefault !== false;

        this.handlers = new Map();   // name -> handler object
        this.handlerOrder = [];      // registration order; first gets touches first
        this.sessions = new Map();

        this.boundTouchStart = this.onTouchStart.bind(this);
        this.boundTouchMove = this.onTouchMove.bind(this);
        this.boundTouchEnd = this.onTouchEnd.bind(this);
        this.boundTouchCancel = this.onTouchCancel.bind(this);
    }

    registerHandler(name, handler) {
        this.handlers.set(name, handler);
        this.handlerOrder.push(name);
    }

    connect() {
        this.element.addEventListener('touchstart', this.boundTouchStart, { passive: false });
        this.element.addEventListener('touchmove', this.boundTouchMove, { passive: false });
        this.element.addEventListener('touchend', this.boundTouchEnd, { passive: false });
        this.element.addEventListener('touchcancel', this.boundTouchCancel, { passive: false });
    }

    disconnect() {
        this.element.removeEventListener('touchstart', this.boundTouchStart);
        this.element.removeEventListener('touchmove', this.boundTouchMove);
        this.element.removeEventListener('touchend', this.boundTouchEnd);
        this.element.removeEventListener('touchcancel', this.boundTouchCancel);
    }

    clear() {
        this.sessions.forEach((session) => {
            const handler = this.handlers.get(session.owner);
            this.invokeHandler(handler, 'onTouchCancel', session, null, null);
        });
        this.sessions.clear();
    }

    onTouchStart(event) {
        if (!this.isEnabled())
            return;

        if (this.preventDefault)
            event.preventDefault();

        const firstHandler = this.handlerOrder[0] ?? null;
        if (firstHandler == null)
            return;

        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];

            const session = {
                id: touch.identifier,
                owner: firstHandler,
                startX: touch.clientX,
                startY: touch.clientY,
                startTime: Date.now()
            };

            this.sessions.set(session.id, session);
            this.dispatchToSession('onTouchStart', session, touch, event);
        }
    }

    onTouchMove(event) {
        if (!this.isEnabled())
            return;

        if (this.preventDefault)
            event.preventDefault();

        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const session = this.sessions.get(touch.identifier);
            if (session == null)
                continue;

            this.dispatchToSession('onTouchMove', session, touch, event);
        }
    }

    onTouchEnd(event) {
        if (!this.isEnabled())
            return;

        if (this.preventDefault)
            event.preventDefault();

        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const session = this.sessions.get(touch.identifier);
            if (session == null)
                continue;

            this.dispatchToSession('onTouchEnd', session, touch, event);
            this.sessions.delete(touch.identifier);
        }
    }

    onTouchCancel(event) {
        if (!this.isEnabled())
            return;

        if (this.preventDefault)
            event.preventDefault();

        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const session = this.sessions.get(touch.identifier);
            if (session == null)
                continue;

            this.dispatchToSession('onTouchCancel', session, touch, event);
            this.sessions.delete(touch.identifier);
        }
    }

    dispatchToSession(methodName, session, touch, event) {
        const handler = this.handlers.get(session.owner);
        const result = this.invokeHandler(handler, methodName, session, touch, event);

        if (result === YIELD) {
            const nextOwner = this.nextHandler(session.owner);
            if (nextOwner != null)
                this.transferSession(session, nextOwner, touch, event);
        }
    }

    nextHandler(currentOwner) {
        const idx = this.handlerOrder.indexOf(currentOwner);
        if (idx < 0 || idx + 1 >= this.handlerOrder.length)
            return null;
        return this.handlerOrder[idx + 1];
    }

    transferSession(session, newOwner, touch, event) {
        const currentHandler = this.handlers.get(session.owner);
        const nextHandler = this.handlers.get(newOwner);
        if (nextHandler == null)
            return;

        this.invokeHandler(currentHandler, 'onTouchYield', session, touch, event);

        session.owner = newOwner;
        this.invokeHandler(nextHandler, 'onTouchAdopt', session, touch, event);
    }

    invokeHandler(handler, methodName, session, touch, event) {
        if (handler == null)
            return null;

        const method = handler[methodName];
        if (typeof method !== 'function')
            return null;

        return method(session, touch, event);
    }
}
