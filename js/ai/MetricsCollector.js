/**
 * MetricsCollector — Collects and aggregates simulation metrics.
 * Provides data for dashboard charts and Fixed vs AI comparison.
 */
export class MetricsCollector {
    constructor() {
        // Rolling history (last N data points)
        this.maxHistory = 300; // ~5 minutes at 1 sample/sec

        // Time-series data
        this.waitTimeHistory = [];
        this.throughputHistory = [];
        this.congestionHistory = [];
        this.vehicleCountHistory = [];

        // Accumulated metrics
        this.totalWaitTime = 0;
        this.totalVehiclesProcessed = 0;
        this.emergencyResponseTimes = [];

        // Per-tick counters
        this._arrivedThisPeriod = 0;
        this._periodTimer = 0;
        this._periodDuration = 1; // 1 second per data point

        // Snapshot for comparison
        this.snapshot = null;
    }

    /**
     * Update metrics from simulation state.
     * @param {number} dt - Delta time in seconds
     * @param {import('../simulation/VehicleManager.js').VehicleManager} vehicleManager
     * @param {Map} signals
     */
    update(dt, vehicleManager, signals) {
        this._periodTimer += dt;

        if (this._periodTimer >= this._periodDuration) {
            this._periodTimer = 0;

            const stats = vehicleManager.getStats();

            // Wait time
            this.waitTimeHistory.push(stats.avgWaitTime);
            if (this.waitTimeHistory.length > this.maxHistory) {
                this.waitTimeHistory.shift();
            }

            // Throughput (vehicles arrived per minute)
            const throughput = (vehicleManager.totalArrived - this._arrivedThisPeriod) * 60;
            this._arrivedThisPeriod = vehicleManager.totalArrived;
            this.throughputHistory.push(throughput);
            if (this.throughputHistory.length > this.maxHistory) {
                this.throughputHistory.shift();
            }

            // Congestion (% of lanes with vehicles > 50% capacity)
            let congestedLanes = 0;
            let totalLanes = 0;
            for (const lane of vehicleManager.cityGraph.lanes.values()) {
                totalLanes++;
                const capacity = 5; // rough capacity estimate per lane
                if (lane.vehicles.length > capacity * 0.5) {
                    congestedLanes++;
                }
            }
            const congestion = totalLanes > 0 ? congestedLanes / totalLanes : 0;
            this.congestionHistory.push(congestion);
            if (this.congestionHistory.length > this.maxHistory) {
                this.congestionHistory.shift();
            }

            // Vehicle count
            this.vehicleCountHistory.push(stats.activeVehicles);
            if (this.vehicleCountHistory.length > this.maxHistory) {
                this.vehicleCountHistory.shift();
            }
        }
    }

    /**
     * Record emergency vehicle response time.
     */
    recordEmergencyResponse(responseTime) {
        this.emergencyResponseTimes.push(responseTime);
    }

    /**
     * Get current metrics for dashboard display.
     */
    getCurrentMetrics() {
        const avgWait = this.waitTimeHistory.length > 0
            ? this.waitTimeHistory[this.waitTimeHistory.length - 1]
            : 0;
        const throughput = this.throughputHistory.length > 0
            ? this.throughputHistory[this.throughputHistory.length - 1]
            : 0;
        const congestion = this.congestionHistory.length > 0
            ? this.congestionHistory[this.congestionHistory.length - 1]
            : 0;
        const vehicles = this.vehicleCountHistory.length > 0
            ? this.vehicleCountHistory[this.vehicleCountHistory.length - 1]
            : 0;

        return {
            avgWaitTime: avgWait,
            throughput: Math.round(throughput),
            congestion,
            activeVehicles: vehicles,
            avgEmergencyResponse: this._avgEmergencyResponse(),
        };
    }

    /**
     * Take a snapshot of current metrics for comparison.
     * @param {string} label - 'fixed' or 'ai'
     */
    takeSnapshot(label) {
        const metrics = this.getCurrentMetrics();

        // Calculate averages over full history
        const avgWait = this._average(this.waitTimeHistory);
        const avgThroughput = this._average(this.throughputHistory);
        const avgCongestion = this._average(this.congestionHistory);

        this.snapshot = {
            label,
            avgWaitTime: avgWait,
            avgThroughput: Math.round(avgThroughput),
            avgCongestion: avgCongestion,
            avgEmergencyResponse: this._avgEmergencyResponse(),
            timestamp: Date.now(),
        };

        return this.snapshot;
    }

    /**
     * Reset all metrics.
     */
    reset() {
        this.waitTimeHistory = [];
        this.throughputHistory = [];
        this.congestionHistory = [];
        this.vehicleCountHistory = [];
        this.totalWaitTime = 0;
        this.totalVehiclesProcessed = 0;
        this.emergencyResponseTimes = [];
        this._arrivedThisPeriod = 0;
        this._periodTimer = 0;
    }

    // ─── Helpers ───────────────────────────────────────────────────

    _average(arr) {
        if (arr.length === 0) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    _avgEmergencyResponse() {
        if (this.emergencyResponseTimes.length === 0) return 0;
        return this._average(this.emergencyResponseTimes);
    }
}
