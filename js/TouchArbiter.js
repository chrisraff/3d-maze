/**
 * @author Chris Raff / https://www.ChrisRaff.com
 */

export default class TouchArbiter {
    constructor(element, options = {}) {
        this.element = element;
        this.isEnabled = options.isEnabled ?? (() => true);
        this.preventDefault = options.preventDefault !== false;

        this.handlers = new Map();
        this.sessions = new Map();
        this.startHandlerResolver = null;
        this.defaultHandlerName = null;

        this.boundTouchStart = this.onTouchStart.bind(this);
        this.boundTouchMove = this.onTouchMove.bind(this);
        this.boundTouchEnd = this.onTouchEnd.bind(this);
        this.boundTouchCancel = this.onTouchCancel.bind(this);
    }

    registerHandler(name, handler) {
        this.handlers.set(name, handler);
    }

    setDefaultHandler(name) {
        this.defaultHandlerName = name;
    }

    setStartHandlerResolver(resolver) {
        this.startHandlerResolver = resolver;
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

        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const owner = this.resolveStartHandler(touch, event);
            if (owner == null)
                continue;

            const session = {
                id: touch.identifier,
                owner,
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

    resolveStartHandler(touch, event) {
        if (this.startHandlerResolver != null)
            return this.startHandlerResolver(touch, event);

        return this.defaultHandlerName;
    }

    dispatchToSession(methodName, session, touch, event) {
        const handler = this.handlers.get(session.owner);
        const result = this.invokeHandler(handler, methodName, session, touch, event);
        const transferTo = this.resolveTransfer(result);

        if (transferTo != null)
            this.transferSession(session, transferTo, touch, event);
    }

    transferSession(session, newOwner, touch, event) {
        if (newOwner === session.owner)
            return;

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

    resolveTransfer(result) {
        if (typeof result === 'string')
            return result;

        if (result != null && typeof result === 'object' && typeof result.transferTo === 'string')
            return result.transferTo;

        return null;
    }
}
