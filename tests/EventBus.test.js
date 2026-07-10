import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../js/EventBus.js';

describe('EventBus', () => {
    it('delivers emitted payloads to listeners', () => {
        const bus = new EventBus();
        const seen = [];
        bus.on('maze:built', (detail) => seen.push(detail));

        bus.emit('maze:built', { size: 4 });

        expect(seen).toEqual([{ size: 4 }]);
    });

    it('supports multiple listeners and unsubscription', () => {
        const bus = new EventBus();
        const a = vi.fn();
        const b = vi.fn();
        const handleA = bus.on('ping', a);
        bus.on('ping', b);

        bus.emit('ping');
        bus.off('ping', handleA);
        bus.emit('ping');

        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(2);
    });

    it('does not deliver events of other types', () => {
        const bus = new EventBus();
        const fn = vi.fn();
        bus.on('maze:completed', fn);

        bus.emit('maze:built', { size: 3 });

        expect(fn).not.toHaveBeenCalled();
    });
});
