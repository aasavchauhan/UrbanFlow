/**
 * TrafficSignal — Signal state machine for junction traffic control.
 */
export const SignalState = {
    GREEN: 'green',
    YELLOW: 'yellow',
    ALL_RED: 'all-red',
    RED: 'red',
};

export class TrafficSignal {
    /**
     * @param {string} junctionId
     * @param {string[]} laneIds - Lane IDs incoming to this junction
     * @param {import('../core/CityGraph.js').CityGraph} cityGraph
     */
    constructor(junctionId, laneIds, cityGraph) {
        this.junctionId = junctionId;
        this.laneIds = laneIds;
        this.cityGraph = cityGraph;

        // Phase groups: divide incoming lanes into groups
        this.phaseGroups = this._createPhaseGroups(laneIds);
        this.currentPhaseIndex = 0;
        
        const junction = this.cityGraph.getJunction(junctionId);
        const config = junction?.signalConfig || {
            greenDuration: window.DEFAULT_GREEN_TIME || 60, // Traditional default per user's preference
            yellowDuration: window.DEFAULT_YELLOW_TIME || 3
        };

        // Timing (in seconds)
        // Values from junction config overrides or UI globals
        this.greenDuration = config.greenDuration;
        this.yellowDuration = config.yellowDuration;
        this.allRedDuration = 1; // Minimal clearance interval

        this.timer = 0;
        this.currentState = SignalState.GREEN;

        // Queue tracking per approach
        this.queues = {};
        for (const laneId of laneIds) {
            this.queues[laneId] = 0;
        }

        // Preemption state
        this.preempted = false;
        this.preemptRoadId = null;
    }

    /**
     * Update signal for one tick.
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (this.preempted) return; // AI controls during preemption

        this.timer += dt;

        if (this.currentState === SignalState.GREEN && this.timer >= this.greenDuration) {
            this.currentState = SignalState.YELLOW;
            this.timer = 0;
        } else if (this.currentState === SignalState.YELLOW && this.timer >= this.yellowDuration) {
            this.currentState = SignalState.ALL_RED;
            this.timer = 0;
        } else if (this.currentState === SignalState.ALL_RED && this.timer >= this.allRedDuration) {
            // Switch to next phase
            this.currentPhaseIndex = (this.currentPhaseIndex + 1) % this.phaseGroups.length;
            this.currentState = SignalState.GREEN;
            this.timer = 0;
        }
    }

    /**
     * Get signal state for each lane approach.
     * @returns {object} { laneId: 'green'|'yellow'|'red' }
     */
    getPhases() {
        const phases = {};
        for (let i = 0; i < this.phaseGroups.length; i++) {
            const isActive = i === this.currentPhaseIndex;
            for (const laneId of this.phaseGroups[i]) {
                if (isActive && this.currentState !== SignalState.ALL_RED) {
                    phases[laneId] = this.currentState;
                } else {
                    phases[laneId] = SignalState.RED;
                }
            }
        }
        return phases;
    }

    /**
     * Computes the timers for each lane to display in UI.
     * 
     * Rules for smooth, never-jumping countdowns:
     * - GREEN lane: shows (remaining green + yellow) as one countdown.
     *   This way green(20)→yellow(5) counts 25→0 without a jump.
     * - YELLOW lane: shows remaining yellow only (continues the countdown seamlessly).
     * - RED lane: shows total time remaining until THIS lane gets green again.
     *   Counts down smoothly from ~81→0 at a 4-way (or ~54→0 at a 3-way).
     */
    _getTimers() {
        const timers = {};
        const phaseCycleDuration = this.greenDuration + this.yellowDuration + this.allRedDuration;

        for (let gi = 0; gi < this.phaseGroups.length; gi++) {
            const isActive = gi === this.currentPhaseIndex;

            for (const laneId of this.phaseGroups[gi]) {
                if (isActive) {
                    if (this.currentState === SignalState.GREEN) {
                        // Show: remaining green + full yellow = smooth countdown
                        timers[laneId] = Math.ceil((this.greenDuration - this.timer) + this.yellowDuration);
                    } else if (this.currentState === SignalState.YELLOW) {
                        // Continues the same countdown seamlessly
                        timers[laneId] = Math.ceil(this.yellowDuration - this.timer);
                    } else if (this.currentState === SignalState.ALL_RED) {
                        // Phase just ended, now waiting for full cycle to come back
                        // remaining allRed + (N-1) full phase cycles
                        let wait = this.allRedDuration - this.timer;
                        for (let i = 1; i < this.phaseGroups.length; i++) {
                            wait += phaseCycleDuration;
                        }
                        timers[laneId] = Math.ceil(wait);
                    }
                } else {
                    // This lane is RED — compute time until its phase starts green
                    let wait = 0;

                    // Step 1: remaining time in CURRENT active phase's state
                    if (this.currentState === SignalState.GREEN) {
                        wait += (this.greenDuration - this.timer) + this.yellowDuration + this.allRedDuration;
                    } else if (this.currentState === SignalState.YELLOW) {
                        wait += (this.yellowDuration - this.timer) + this.allRedDuration;
                    } else if (this.currentState === SignalState.ALL_RED) {
                        wait += (this.allRedDuration - this.timer);
                    }

                    // Step 2: add full cycles for phases between (currentPhase+1) and this lane's phase
                    let idx = (this.currentPhaseIndex + 1) % this.phaseGroups.length;
                    while (idx !== gi) {
                        wait += phaseCycleDuration;
                        idx = (idx + 1) % this.phaseGroups.length;
                    }

                    timers[laneId] = Math.ceil(wait);
                }
            }
        }
        return timers;
    }

    /**
     * Get full state for rendering and AI.
     */
    getState() {
        return {
            state: this.currentState,
            phases: this.getPhases(),
            timers: this._getTimers(),
            timer: this.timer,
            currentPhaseIndex: this.currentPhaseIndex,
            queues: { ...this.queues },
            greenDuration: this.greenDuration,
            preempted: this.preempted,
        };
    }

    /**
     * Set queue count for a lane approach.
     */
    setQueue(laneId, count) {
        if (laneId in this.queues) {
            this.queues[laneId] = count;
        }
    }

    /**
     * Preempt signal for emergency vehicle.
     * @param {string} laneId - The lane the emergency vehicle is on
     */
    preempt(laneId) {
        this.preempted = true;
        this.preemptLaneId = laneId;

        // Set the emergency vehicle's approach to green, everything else to red
        const phaseGroupIndex = this.phaseGroups.findIndex(g => g.includes(laneId));
        if (phaseGroupIndex >= 0) {
            this.currentPhaseIndex = phaseGroupIndex;
            this.currentState = SignalState.GREEN;
            this.timer = 0;
        }
    }

    /**
     * Release preemption, resume normal operation.
     */
    releasePreemption() {
        this.preempted = false;
        this.preemptLaneId = null;
        this.timer = 0;
    }

    /**
     * AI override: set green duration for adaptive control.
     */
    setGreenDuration(duration) {
        this.greenDuration = Math.max(5, Math.min(120, duration));
    }

    /**
     * AI override: force phase switch.
     */
    forcePhaseSwitch(phaseIndex) {
        if (phaseIndex >= 0 && phaseIndex < this.phaseGroups.length) {
            this.currentPhaseIndex = phaseIndex;
            this.currentState = SignalState.GREEN;
            this.timer = 0;
        }
    }

    /**
     * Create phase groups from lane IDs.
     * Traditional logic: Each road approach gets its own dedicated phase, sorted clockwise.
     */
    _createPhaseGroups(laneIds) {
        if (laneIds.length <= 1) return [laneIds];
        if (!this.cityGraph) {
            const mid = Math.ceil(laneIds.length / 2);
            return [laneIds.slice(0, mid), laneIds.slice(mid)];
        }

        const junction = this.cityGraph.getJunction(this.junctionId);
        
        // Group lanes by their source road ID
        const lanesByRoad = new Map();
        for (const laneId of laneIds) {
            const lane = this.cityGraph.lanes.get(laneId);
            if (lane) {
                if (!lanesByRoad.has(lane.roadId)) lanesByRoad.set(lane.roadId, []);
                lanesByRoad.get(lane.roadId).push(laneId);
            }
        }

        // Calculate angle for each road relative to the junction center
        const roadAngles = [];
        for (const [roadId, lIds] of lanesByRoad) {
            const road = this.cityGraph.roads.get(roadId);
            const otherJunctionId = (road.from === this.junctionId) ? road.to : road.from;
            const otherJunction = this.cityGraph.getJunction(otherJunctionId);
            
            if (otherJunction) {
                const angle = Math.atan2(otherJunction.y - junction.y, otherJunction.x - junction.x);
                let normAngle = angle;
                if (normAngle < 0) normAngle += Math.PI * 2;
                roadAngles.push({ roadId, lanes: lIds, angle: normAngle });
            } else {
                roadAngles.push({ roadId, lanes: lIds, angle: 0 });
            }
        }

        // Sort roads by angle clockwise
        roadAngles.sort((a, b) => a.angle - b.angle);

        // Map strictly clockwise, one road per phase
        return roadAngles.map(ra => ra.lanes);
    }
}
