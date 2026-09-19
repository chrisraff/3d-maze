import { describe, it, expect, vi, afterEach } from 'vitest';
import GameSession, { formatMazeTime } from '../js/GameSession.js';
import { EventBus } from '../js/EventBus.js';

const FAKE_MAZE = { bounds: [3, 3, 3], size_string: '3' };

function makeSession() {
    const bus = new EventBus();
    const events = [];
    bus.on('maze:completed', (detail) => events.push(['completed', detail]));
    bus.on('maze:abandoned', (detail) => events.push(['abandoned', detail]));
    const session = new GameSession(bus);
    session.newMaze(FAKE_MAZE);
    return { session, events };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('GameSession checkpoints', () => {
    it('starts the run when the player reaches the first cell', () => {
        const { session } = makeSession();
        session.updateCheckpoints({ x: 1, y: 1, z: 1 });
        expect(session.startedMaze).toBe(true);
        expect(session.finishedMaze).toBe(false);
    });

    it('un-starts the run if the player backs out of the entrance', () => {
        const { session } = makeSession();
        session.updateCheckpoints({ x: 1, y: 1, z: 1 });
        session.updateCheckpoints({ x: 1, y: 1, z: -1 });
        expect(session.startedMaze).toBe(false);
    });

    it('emits maze:completed when the exit plane is crossed after starting', () => {
        const { session, events } = makeSession();
        session.updateCheckpoints({ x: 1, y: 1, z: 1 });
        session.updateCheckpoints({ x: 5, y: 5, z: FAKE_MAZE.bounds[2] * 2 + 1 });

        expect(session.finishedMaze).toBe(true);
        expect(events.length).toBe(1);
        expect(events[0][0]).toBe('completed');
        expect(events[0][1].mazeData).toBe(FAKE_MAZE);
    });

    it('does not complete without entering the maze first', () => {
        const { session, events } = makeSession();
        session.updateCheckpoints({ x: 5, y: 5, z: FAKE_MAZE.bounds[2] * 2 + 1 });
        expect(session.finishedMaze).toBe(false);
        expect(events).toEqual([]);
    });

    it('emits maze:completed only once', () => {
        const { session, events } = makeSession();
        session.updateCheckpoints({ x: 1, y: 1, z: 1 });
        const exit = { x: 5, y: 5, z: FAKE_MAZE.bounds[2] * 2 + 1 };
        session.updateCheckpoints(exit);
        session.updateCheckpoints(exit);
        expect(events.length).toBe(1);
    });
});

describe('GameSession abandonment', () => {
    it('reports abandonment only for started, unfinished runs older than 7s', () => {
        vi.useFakeTimers();
        const { session, events } = makeSession();
        session.startTimer();
        session.updateCheckpoints({ x: 1, y: 1, z: 1 });

        vi.advanceTimersByTime(5000);
        session.reportIfAbandoned();
        expect(events).toEqual([]); // too soon

        vi.advanceTimersByTime(5000);
        session.reportIfAbandoned();
        expect(events.length).toBe(1);
        expect(events[0][0]).toBe('abandoned');
        expect(events[0][1].elapsedMillis).toBe(10000);
    });

    it('does not report abandonment for finished runs', () => {
        vi.useFakeTimers();
        const { session, events } = makeSession();
        session.startTimer();
        session.updateCheckpoints({ x: 1, y: 1, z: 1 });
        session.updateCheckpoints({ x: 5, y: 5, z: FAKE_MAZE.bounds[2] * 2 + 1 });
        events.length = 0;

        vi.advanceTimersByTime(60000);
        session.reportIfAbandoned();
        expect(events).toEqual([]);
    });
});

describe('GameSession timer', () => {
    it('startTimer only arms once until the next maze', () => {
        vi.useFakeTimers();
        const { session } = makeSession();
        session.startTimer();
        const started = session.timerStartMillis;

        vi.advanceTimersByTime(3000);
        session.startTimer(); // e.g. re-locking after pause
        expect(session.timerStartMillis).toBe(started);

        session.newMaze(FAKE_MAZE);
        vi.advanceTimersByTime(1000);
        session.startTimer();
        expect(session.timerStartMillis).toBe(started + 4000);
    });

    it('restartTimer drops the time spent in the intro fly-around', () => {
        vi.useFakeTimers();
        const { session } = makeSession();
        session.startTimer();

        vi.advanceTimersByTime(5400); // the establishing shot
        session.restartTimer();
        expect(session.elapsedMillis).toBe(0);

        vi.advanceTimersByTime(2000); // the player's own time
        expect(session.elapsedMillis).toBe(2000);
        expect(session.timerRunning).toBe(true);
    });
});

describe('formatMazeTime', () => {
    it('formats sub-minute times with hundredths', () => {
        expect(formatMazeTime(5678)).toBe('5.68');
        expect(formatMazeTime(12345)).toBe('12.35');
        expect(formatMazeTime(59990)).toBe('59.99');
    });

    it('formats minute+ times as M:SS', () => {
        expect(formatMazeTime(60000)).toBe('1:00');
        expect(formatMazeTime(65400)).toBe('1:05.40');
        expect(formatMazeTime(125500)).toBe('2:05.5');
    });
});
