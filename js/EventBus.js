/**
 * Shared application event bus.
 *
 * Emitters publish game-level events here instead of holding references to
 * every interested party. Payloads ride on `event.detail`.
 *
 * Events currently on the bus:
 *   'maze:built'      { size }
 *   'maze:completed'  { mazeData, elapsedMillis }
 *   'maze:abandoned'  { mazeData, elapsedMillis }
 *   'vr:sessionStart' {}
 */
export class EventBus extends EventTarget {
    emit(type, detail = {}) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    on(type, callback) {
        const handler = (event) => callback(event.detail, event);
        this.addEventListener(type, handler);
        return handler; // pass back to off() to unsubscribe
    }

    off(type, handler) {
        this.removeEventListener(type, handler);
    }
}

// the app-wide bus; tests can construct their own EventBus instead
const bus = new EventBus();
export default bus;
