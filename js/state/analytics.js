/**
 * Google Analytics reporting, decoupled from game logic via the event bus.
 * game code emits domain events; this module is the only place that knows
 * about gtag.
 */
import bus from './EventBus.js';

function send(name, params = {}) {
    if (typeof gtag !== 'function')
        return;
    gtag('event', name, { 'event_category': '3d-maze', ...params });
}

function mazeRunParams(mazeData, elapsedMillis) {
    return {
        'value': mazeData.size_string,
        'solution_length': mazeData.analytics.distance_to_end,
        'branches_on_solution': mazeData.analytics.branches_on_solution.length,
        'branches_total': mazeData.analytics.branches_total,
        'time_since_start': elapsedMillis
    };
}

export default function initAnalytics() {
    bus.on('maze:built', ({ size }) => {
        send('maze_built', { 'value': size });
    });

    bus.on('maze:completed', ({ mazeData, elapsedMillis }) => {
        send('maze_completed', mazeRunParams(mazeData, elapsedMillis));
    });

    bus.on('maze:abandoned', ({ mazeData, elapsedMillis }) => {
        send('maze_abandoned', mazeRunParams(mazeData, elapsedMillis));
    });

    bus.on('vr:sessionStart', () => {
        send('vr_session_start');
    });
}
