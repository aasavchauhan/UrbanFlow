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
        this.weights = {
            queue: 12,
            waitTime: 2,
            approaching: 4,
            upstreamFlow: 6,
            downstreamBlock: 28,
        };

        // Flow tracking for prediction
        this._flowHistory = new Map(); // roadId → [flowRate, flowRate, ...]
        this._historyMaxLength = 30;

        // Emergency tracking
        this._activeEmergencies = new Set();
        this._decisionState = {
            laneSpeedHints: {},
            signalStrategies: {},
            recentActions: [],
        };
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
        const laneSpeedHints = {};
        const signalStrategies = {};

        for (const [junctionId, signal] of signals) {
            if (signal.preempted) continue;

            const queues = signal.queues;
            const phaseGroups = signal.phaseGroups;

            // Calculate priority score for each phase group
            const phaseScores = phaseGroups.map((group, idx) => {
                let score = 0;
                let downstreamPressure = 0;
                for (const laneId of group) {
                    const queueLength = queues[laneId] || 0;

                    score += queueLength * this.weights.queue;

                    // Waiting time bonus: penalize long waits
                    const waitingVehicles = vehicleManager.vehicles.filter(
                        v => v.currentGeomId === laneId && v.state === 'waiting'
                    );
                    for (const v of waitingVehicles) {
                        score += v.waitTime * this.weights.waitTime;
                    }

                    const approaching = this._getApproachingVehicles(laneId, vehicleManager);
                    score += approaching * this.weights.approaching;

                    const upstreamFlow = this._getUpstreamFlow(laneId);
                    score += upstreamFlow * this.weights.upstreamFlow;

                    const downstream = this._getDownstreamPressure(laneId);
                    downstreamPressure = Math.max(downstreamPressure, downstream);
                    score -= downstream * this.weights.downstreamBlock;
                }
                return {
                    phaseIndex: idx,
                    score: Math.max(0, score),
                    downstreamPressure,
                };
            });

            // Find the highest-priority phase
            phaseScores.sort((a, b) => b.score - a.score);
            const topPhase = phaseScores[0];
            const secondPhase = phaseScores[1];
            const bestPhaseIndex = topPhase ? topPhase.phaseIndex : signal.currentPhaseIndex;
            const strategyReason = topPhase && topPhase.downstreamPressure > 0.7
                ? 'Spillback guard'
                : topPhase && topPhase.score > 0
                    ? 'Demand response'
                    : 'Balanced cycle';

            signalStrategies[junctionId] = {
                bestPhaseIndex,
                bestScore: topPhase ? Math.round(topPhase.score) : 0,
                reason: strategyReason,
                downstreamPressure: topPhase ? topPhase.downstreamPressure : 0,
            };

            phaseGroups.forEach((group, phaseIndex) => {
                for (const laneId of group) {
                    const downstream = this._getDownstreamPressure(laneId);
                    const isPriorityPhase = phaseIndex === bestPhaseIndex;
                    let factor = 1;
                    let reason = 'Cruise';

                    if (downstream > 0.7) {
                        factor = 0.45;
                        reason = 'Spillback slow zone';
                    } else if (isPriorityPhase && topPhase && topPhase.score > 0) {
                        factor = 1.18;
                        reason = 'Green wave';
                    }

                    laneSpeedHints[laneId] = { factor, reason, downstream };
                }
            });

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
                    reason: bestPhase.downstreamPressure > 0.7 ? 'spillback_avoidance' : 'demand_imbalance',
                    fromPhase: signal.currentPhaseIndex,
                    toPhase: bestPhase.phaseIndex,
                });
                this._rememberAction(`${junctionId}: ${bestPhase.downstreamPressure > 0.7 ? 'spillback guard' : 'demand switch'}`);
            }
        }

        this._decisionState.laneSpeedHints = laneSpeedHints;
        this._decisionState.signalStrategies = signalStrategies;

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

    _getApproachingVehicles(laneId, vehicleManager) {
        let count = 0;
        for (const vehicle of vehicleManager.vehicles) {
            if (vehicle.currentGeomId === laneId && vehicle.progress > 0.2 && vehicle.state !== 'arrived') {
                count++;
            }
        }
        return count;
    }

    _getDownstreamPressure(laneId) {
        const lane = this.cityGraph.lanes.get(laneId);
        if (!lane || !lane.nextLanes || lane.nextLanes.length === 0) return 0;

        let worstPressure = 0;
        for (const nextConn of lane.nextLanes) {
            const connection = nextConn.id ? nextConn : this.cityGraph.connections.get(nextConn);
            if (!connection) continue;

            const targetLane = this.cityGraph.lanes.get(connection.toLane);
            if (!targetLane) continue;

            const targetRoad = this.cityGraph.roads.get(targetLane.roadId);
            if (targetRoad?.blocked) {
                worstPressure = Math.max(worstPressure, 1);
                continue;
            }

            const capacity = Math.max(1, Math.floor(targetLane.geom.length / 18));
            const pressure = Math.min(1, targetLane.vehicles.length / capacity);
            worstPressure = Math.max(worstPressure, pressure);
        }

        return worstPressure;
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

    _rememberAction(label) {
        this._decisionState.recentActions.unshift(label);
        this._decisionState.recentActions = this._decisionState.recentActions.slice(0, 5);
    }

    getState() {
        return {
            mode: this._activeEmergencies.size > 0 ? 'Emergency priority' : 'Adaptive',
            laneSpeedHints: { ...this._decisionState.laneSpeedHints },
            signalStrategies: { ...this._decisionState.signalStrategies },
            recentActions: [...this._decisionState.recentActions],
        };
    }
}
