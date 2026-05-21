/**
 * EventBus — Lightweight pub/sub event system for UrbanFlow.
 * All modules communicate through this to stay loosely coupled.
 */
export class EventBus {
    constructor() {
        this._listeners = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);

        // Return unsubscribe function
        return () => this.off(event, callback);
    }

    /**
     * Subscribe to an event, auto-unsubscribe after first call.
     */
    once(event, callback) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            callback(...args);
        };
        return this.on(event, wrapper);
    }

    /**
     * Unsubscribe from an event.
     */
    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            listeners.delete(callback);
            if (listeners.size === 0) {
                this._listeners.delete(event);
            }
        }
    }

    /**
     * Emit an event to all subscribers.
     * @param {string} event - Event name
     * @param {*} data - Event payload
     */
    emit(event, data) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            for (const callback of listeners) {
                try {
                    callback(data);
                } catch (err) {
                    console.error(`[EventBus] Error in listener for "${event}":`, err);
                }
            }
        }
    }

    /**
     * Remove all listeners for an event, or all listeners entirely.
     */
    clear(event) {
        if (event) {
            this._listeners.delete(event);
        } else {
            this._listeners.clear();
        }
    }
}

// Event name constants for type safety
export const Events = {
    // Editor events
    JUNCTION_ADDED: 'junction:added',
    JUNCTION_REMOVED: 'junction:removed',
    ROAD_ADDED: 'road:added',
    ROAD_REMOVED: 'road:removed',
    CITY_CHANGED: 'city:changed',
    TOOL_CHANGED: 'editor:toolChanged',
    PRESET_LOADED: 'editor:presetLoaded',
    SIGNAL_CHANGED: 'signal:changed',
    SIGNAL_SELECTED: 'signal:selected',

    // Mode events
    MODE_CHANGED: 'app:modeChanged',

    // Simulation events
    SIM_STARTED: 'sim:started',
    SIM_PAUSED: 'sim:paused',
    SIM_RESUMED: 'sim:resumed',
    SIM_RESET: 'sim:reset',
    SIM_TICK: 'sim:tick',
    SIM_SPEED_CHANGED: 'sim:speedChanged',

    // Vehicle events
    VEHICLE_SPAWNED: 'vehicle:spawned',
    VEHICLE_ARRIVED: 'vehicle:arrived',
    VEHICLE_REMOVED: 'vehicle:removed',

    // Signal events
    SIGNAL_CHANGED: 'signal:changed',
    SIGNAL_PREEMPTED: 'signal:preempted',

    // AI events
    AI_MODE_CHANGED: 'ai:modeChanged',
    AI_DECISION: 'ai:decision',

    // Dashboard events
    METRICS_UPDATED: 'metrics:updated',
    HEATMAP_TOGGLED: 'heatmap:toggled',

    // Scenario events
    EVENT_TRIGGERED: 'event:triggered',
    EVENT_CLEARED: 'event:cleared',
};
