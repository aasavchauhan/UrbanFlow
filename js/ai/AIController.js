/**
 * AIController — Adaptive traffic signal optimizer.
 * 
 * Uses rule-based heuristics to dynamically adjust signal timing:
 * - Queue-proportional green time allocation
 * - Emergency vehicle preemption
 * - Congestion prediction based on upstream flow
 */
import { Events } from '../core/EventBus.js';

export class AIController {
    /**
     * @param {import('../core/CityGraph.js').CityGraph} cityGraph
     * @param {import('../core/EventBus.js').EventBus} eventBus
     */
    constructor(cityGraph, eventBus) {
        this.cityGraph = cityGraph;
        this.eventBus = eventBus;

        // AI parameters
        this.minGreenTime = 8;     // seconds
        this.maxGreenTime = 55;    // seconds
        this.evaluationInterval = 2; // seconds between evaluations
        this._evalTimer = 0;

        // Flow tracking for prediction
        this._flowHistory = new Map(); // roadId → [flowRate, flowRate, ...]
        this._historyMaxLength = 30;

        // Emergency tracking
        this._activeEmergencies = new Set();
    }

    /**
     * Called each simulation tick by SimulationController.
     * @param {number} dt - Scaled delta time
     * @param {Map<string, import('../simulation/TrafficSignal.js').TrafficSignal>} signals
     * @param {import('../simulation/VehicleManager.js').VehicleManager} vehicleManager
     */
    update(dt, signals, vehicleManager) {
        // Check for emergency vehicles
        this._handleEmergencies(signals, vehicleManager);

        // Periodic evaluation
        this._evalTimer += dt;
        if (this._evalTimer >= this.evaluationInterval) {
            this._evalTimer = 0;
            this._evaluateAndAdjust(signals, vehicleManager);
        }
    }

    /**
     * Emergency vehicle detection and signal preemption.
     */
    _handleEmergencies(signals, vehicleManager) {
        const currentEmergencies = new Set();

        for (const vehicle of vehicleManager.vehicles) {
            if (vehicle.priority <= 0) continue; // Not emergency

            // Find the next junction this vehicle is approaching
            if (vehicle.routeIndex + 1 < vehicle.route.length) {
                const nextJunctionId = vehicle.route[vehicle.routeIndex + 1];
                const signal = signals.get(nextJunctionId);

                if (signal && vehicle.progress > 0.4) {
                    const key = `${vehicle.id}-${nextJunctionId}`;
                    currentEmergencies.add(key);

                    if (!this._activeEmergencies.has(key)) {
                        // New emergency approaching — preempt signal
                        if (vehicle.geomType === 'lane') {
                            signal.preempt(vehicle.currentGeomId);
                            this.eventBus.emit(Events.SIGNAL_PREEMPTED, {
                                junctionId: nextJunctionId,
                                vehicleId: vehicle.id,
                                vehicleType: vehicle.type,
                            });
                        }
                    }
                }
            }
        }

        // Release preemptions for emergencies that have passed
        for (const oldKey of this._activeEmergencies) {
            if (!currentEmergencies.has(oldKey)) {
                const [, junctionId] = oldKey.split('-');
                const signal = signals.get(junctionId);
                if (signal && signal.preempted) {
                    signal.releasePreemption();
                }
            }
        }

        this._activeEmergencies = currentEmergencies;
    }

    /**
     * Evaluate all signals and adjust green durations adaptively.
     */
    _evaluateAndAdjust(signals, vehicleManager) {
        for (const [junctionId, signal] of signals) {
            if (signal.preempted) continue;

            const queues = signal.queues;
            const phaseGroups = signal.phaseGroups;

            // Calculate priority score for each phase group
            const phaseScores = phaseGroups.map((group, idx) => {
                let score = 0;
                for (const laneId of group) {
                    const queueLength = queues[laneId] || 0;

                    // Base score: queue length
                    score += queueLength * 10;

                    // Waiting time bonus: penalize long waits
                    const waitingVehicles = vehicleManager.vehicles.filter(
                        v => v.currentGeomId === laneId && v.state === 'waiting'
                    );
                    for (const v of waitingVehicles) {
                        score += v.waitTime * 2;
                    }

                    // Upstream pressure: check incoming traffic
                    const upstreamFlow = this._getUpstreamFlow(laneId);
                    score += upstreamFlow * 5;
                }
                return { phaseIndex: idx, score };
            });

            // Find the highest-priority phase
            phaseScores.sort((a, b) => b.score - a.score);
            const topPhase = phaseScores[0];
            const secondPhase = phaseScores[1];

            // Adjust green duration proportionally
            if (topPhase && secondPhase) {
                const totalScore = topPhase.score + secondPhase.score;
                if (totalScore > 0) {
                    const topRatio = topPhase.score / totalScore;
                    const cycleDuration = this.minGreenTime * 2 + 10; // Base cycle
                    const newGreenTime = this.minGreenTime + topRatio * (this.maxGreenTime - this.minGreenTime);
                    signal.setGreenDuration(Math.round(newGreenTime));
                }
            }

            // If the current phase has very low queue and another has high queue, switch early
            const currentPhaseScore = phaseScores.find(
                p => p.phaseIndex === signal.currentPhaseIndex
            );
            const bestPhase = phaseScores[0];

            if (
                currentPhaseScore &&
                bestPhase.phaseIndex !== signal.currentPhaseIndex &&
                bestPhase.score > currentPhaseScore.score * 3 && // 3x more demand
                signal.timer > this.minGreenTime // Minimum green time elapsed
            ) {
                signal.forcePhaseSwitch(bestPhase.phaseIndex);

                this.eventBus.emit(Events.AI_DECISION, {
                    type: 'phase_switch',
                    junctionId,
                    reason: 'demand_imbalance',
                    fromPhase: signal.currentPhaseIndex,
                    toPhase: bestPhase.phaseIndex,
                });
            }
        }

        // Update flow history
        this._updateFlowHistory(vehicleManager);
    }

    /**
     * Get upstream traffic flow prediction for a lane.
     */
    _getUpstreamFlow(laneId) {
        const history = this._flowHistory.get(laneId);
        if (!history || history.length < 2) return 0;

        // Simple trend: average of last few measurements
        const recent = history.slice(-5);
        return recent.reduce((sum, val) => sum + val, 0) / recent.length;
    }

    /**
     * Track flow rates for prediction.
     */
    _updateFlowHistory(vehicleManager) {
        for (const lane of this.cityGraph.lanes.values()) {
            const vehicleCount = lane.vehicles ? lane.vehicles.length : 0;
            if (!this._flowHistory.has(lane.id)) {
                this._flowHistory.set(lane.id, []);
            }
            const history = this._flowHistory.get(lane.id);
            history.push(vehicleCount);
            if (history.length > this._historyMaxLength) {
                history.shift();
            }
        }
    }
}
