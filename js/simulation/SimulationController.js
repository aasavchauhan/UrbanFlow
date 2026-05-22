/**
 * SimulationController — Master simulation loop.
 * Coordinates vehicles, signals, and AI controller per tick.
 */
import { TrafficSignal } from './TrafficSignal.js';
import { Events } from '../core/EventBus.js';

export class SimulationController {
    /**
     * @param {import('../core/CityGraph.js').CityGraph} cityGraph
     * @param {import('./VehicleManager.js').VehicleManager} vehicleManager
     * @param {import('../core/EventBus.js').EventBus} eventBus
     */
    constructor(cityGraph, vehicleManager, eventBus) {
        this.cityGraph = cityGraph;
        this.vehicleManager = vehicleManager;
        this.eventBus = eventBus;

        // AI controller (set externally)
        this.aiController = null;

        // Simulation state
        this.running = false;
        this.simTime = 0;       // Total simulation time (seconds)
        this.speed = 1;         // Time multiplier
        this.tickCount = 0;

        // Traffic signals
        /** @type {Map<string, TrafficSignal>} */
        this.signals = new Map();

        // Active events
        this.activeEvents = [];
    }

    /**
     * Initialize signals from city graph.
     * Call this when entering simulation mode.
     */
    initializeSignals() {
        this.signals.clear();

        for (const junction of this.cityGraph.junctions.values()) {
            if (junction.signalState) {
                const incomingLanes = [];
                for (const lane of this.cityGraph.lanes.values()) {
                    if (lane.endNode === junction.id) {
                        incomingLanes.push(lane.id);
                    }
                }
                
                if (incomingLanes.length >= 2) {
                    this.signals.set(junction.id, new TrafficSignal(junction.id, incomingLanes, this.cityGraph));
                }
            }
        }
    }

    /**
     * Add signals to all junctions with 3+ connections.
     * For presets where signals aren't manually placed.
     */
    autoAddSignals() {
        for (const junction of this.cityGraph.junctions.values()) {
            if (junction.connections.length >= 3 && !junction.signalState) {
                junction.signalState = {
                    currentPhase: 0,
                    timer: 0,
                    state: 'green',
                };
            }
        }
        this.initializeSignals();
    }

    /**
     * Update simulation for one frame.
     * @param {number} dt - Raw delta time in seconds
     */
    update(dt) {
        if (!this.running) return;

        const scaledDt = dt * this.speed;
        this.simTime += scaledDt;
        this.tickCount++;

        // 1. Update traffic signals
        for (const signal of this.signals.values()) {
            signal.update(scaledDt);
        }

        // 2. Update queue counts at signals
        this._updateSignalQueues();

        // 3. Run AI controller (if attached)
        if (this.aiController) {
            this.aiController.update(scaledDt, this.signals, this.vehicleManager);
        }

        // 4. Build signal states for vehicles
        const signalStates = this._getSignalStates();
        const aiState = this.aiController && typeof this.aiController.getState === 'function'
            ? this.aiController.getState()
            : null;

        // 5. Update vehicles
        this.vehicleManager.update(scaledDt, signalStates, aiState);

        // 6. Emit tick event
        this.eventBus.emit(Events.SIM_TICK, {
            simTime: this.simTime,
            tickCount: this.tickCount,
            signalStates,
            aiState,
        });
    }

    /**
     * Get signal states for rendering and vehicle awareness.
     */
    _getSignalStates() {
        const states = {};
        for (const [junctionId, signal] of this.signals) {
            states[junctionId] = signal.getState();
        }
        return states;
    }

    /**
     * Update queue counts at each signal based on vehicle positions.
     */
    _updateSignalQueues() {
        for (const [junctionId, signal] of this.signals) {
            const incomingLanes = [];
            for (const lane of this.cityGraph.lanes.values()) {
                if (lane.endNode === junctionId) incomingLanes.push(lane);
            }
            
            for (const lane of incomingLanes) {
                let queueCount = 0;
                for (const vehicle of lane.vehicles) {
                    if (vehicle.progress > 0.6) {
                        queueCount++;
                    }
                }
                signal.setQueue(lane.id, queueCount);
            }
        }
    }

    // ─── Controls ──────────────────────────────────────────────────

    start() {
        if (this.signals.size === 0) {
            this.autoAddSignals();
        }
        this.running = true;
        this.vehicleManager.autoSpawnEnabled = true;
        this.eventBus.emit(Events.SIM_STARTED, {});
    }

    pause() {
        this.running = false;
        this.vehicleManager.autoSpawnEnabled = false;
        this.eventBus.emit(Events.SIM_PAUSED, {});
    }

    resume() {
        this.running = true;
        this.vehicleManager.autoSpawnEnabled = true;
        this.eventBus.emit(Events.SIM_RESUMED, {});
    }

    togglePlayPause() {
        if (this.running) {
            this.pause();
        } else if (this.simTime > 0) {
            this.resume();
        } else {
            this.start();
        }
    }

    step() {
        // Run one tick at normal speed
        const wasRunning = this.running;
        this.running = true;
        this.update(1 / 60);
        this.running = wasRunning;
    }

    reset() {
        this.running = false;
        this.simTime = 0;
        this.tickCount = 0;
        this.speed = 1;
        this.vehicleManager.clearAll();
        this.vehicleManager.autoSpawnEnabled = false;
        this.vehicleManager.totalSpawned = 0;
        this.vehicleManager.totalArrived = 0;
        this.signals.clear();
        this.activeEvents = [];
        this.eventBus.emit(Events.SIM_RESET, {});
    }

    setSpeed(speed) {
        this.speed = Math.max(0.5, Math.min(10, speed));
        this.eventBus.emit(Events.SIM_SPEED_CHANGED, { speed: this.speed });
    }

    // ─── Events ────────────────────────────────────────────────────

    triggerEvent(eventType) {
        switch (eventType) {
            case 'ambulance':
                this.vehicleManager.spawnEmergency('AMBULANCE');
                break;

            case 'firetruck':
                this.vehicleManager.spawnEmergency('FIRE_TRUCK');
                break;

            case 'blockage': {
                // Block a random road
                const roads = Array.from(this.cityGraph.roads.values()).filter(r => !r.blocked);
                if (roads.length > 0) {
                    const road = roads[Math.floor(Math.random() * roads.length)];
                    road.blocked = true;
                    road.blockReason = 'Road blockage';
                    this.activeEvents.push({
                        type: 'blockage',
                        roadId: road.id,
                        startTime: this.simTime,
                        duration: 30, // 30 seconds
                    });
                    // Invalidate pathfinding cache
                    this.vehicleManager.pathfinder.clearCache();
                }
                break;
            }

            case 'rain': {
                this.vehicleManager.speedMultiplier = 0.7;
                this.activeEvents.push({
                    type: 'rain',
                    startTime: this.simTime,
                    duration: 60,
                });
                break;
            }
        }

        this.eventBus.emit(Events.EVENT_TRIGGERED, { type: eventType });
    }

    /**
     * Check and clear expired events.
     */
    updateEvents() {
        const expired = [];
        for (const event of this.activeEvents) {
            if (this.simTime - event.startTime >= event.duration) {
                expired.push(event);
            }
        }

        for (const event of expired) {
            if (event.type === 'blockage') {
                const road = this.cityGraph.roads.get(event.roadId);
                if (road) {
                    road.blocked = false;
                    road.blockReason = null;
                }
                this.vehicleManager.pathfinder.clearCache();
            }
            if (event.type === 'rain') {
                this.vehicleManager.speedMultiplier = 1.0;
            }

            const idx = this.activeEvents.indexOf(event);
            if (idx >= 0) this.activeEvents.splice(idx, 1);

            this.eventBus.emit(Events.EVENT_CLEARED, { type: event.type });
        }
    }

    /**
     * Get simulation state for rendering.
     */
    getState() {
        return {
            running: this.running,
            simTime: this.simTime,
            speed: this.speed,
            tickCount: this.tickCount,
            signalStates: this._getSignalStates(),
            aiState: this.aiController && typeof this.aiController.getState === 'function'
                ? this.aiController.getState()
                : null,
            activeEvents: this.activeEvents,
        };
    }
}
