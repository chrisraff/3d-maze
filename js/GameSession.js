/**
 * Tracks one maze run: timer, entered/finished checkpoints, abandonment.
 * Pure logic — no THREE, no DOM. Emits on the event bus:
 *   'maze:completed' { mazeData, elapsedMillis } when the exit is crossed
 *   'maze:abandoned' { mazeData, elapsedMillis } via reportIfAbandoned()
 */

// formats an elapsed time in millis as "SS.ss" or "M:SS.s" for display
export function formatMazeTime(elapsedMillis) {
    let seconds = (elapsedMillis / 1000).toFixed(2);
    let timeString = seconds;
    if (seconds >= 60) {
        let minutes = Math.floor(seconds / 60);
        let secondString = "" + seconds % 60;
        if (secondString < 10) {
            secondString = `0${secondString}`;
        }
        // toFixed can't be trusted
        secondString = secondString.substring(0, 5);
        timeString = `${minutes}:${secondString}`;
    } else {
        timeString = seconds.substring(0, seconds >= 10 ? 5 : 4);
    }
    return timeString;
}

export default class GameSession {
    constructor(bus) {
        this.bus = bus;
        this.mazeData = null;
        this.startedMaze = false;
        this.finishedMaze = false;
        this.timerRunning = false;
        this.timerStartMillis = 0;
    }

    // call when a maze is (re)built
    newMaze(mazeData) {
        this.mazeData = mazeData;
        this.startedMaze = false;
        this.finishedMaze = false;
        this.timerRunning = false;
    }

    // call when the player takes control (pointer lock / VR start)
    startTimer() {
        if (!this.timerRunning) {
            this.timerRunning = true;
            this.timerStartMillis = Date.now();
        }
    }

    get elapsedMillis() {
        return Date.now() - this.timerStartMillis;
    }

    // called each frame with the player's far-corner maze position;
    // handles enter/leave/finish checkpoint transitions
    updateCheckpoints(mazePosFar) {
        if (mazePosFar.z == -1 && this.startedMaze) {
            this.startedMaze = false;
        } else if (!this.startedMaze && mazePosFar.z == 1 && mazePosFar.x == 1 && mazePosFar.y == 1) {
            this.startedMaze = true;
        } else if (!this.finishedMaze && this.startedMaze && mazePosFar.z == this.mazeData.bounds[2] * 2 + 1) {
            this.finishedMaze = true;
            this.bus.emit('maze:completed', { mazeData: this.mazeData, elapsedMillis: this.elapsedMillis });
        }
    }

    // call before discarding a run (new maze, page unload)
    reportIfAbandoned() {
        const elapsedMillis = this.elapsedMillis;
        if (this.startedMaze && !this.finishedMaze && elapsedMillis > 7000) {
            this.bus.emit('maze:abandoned', { mazeData: this.mazeData, elapsedMillis });
        }
    }
}
