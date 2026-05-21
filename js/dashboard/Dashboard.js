/**
 * Dashboard — Manages the sidebar dashboard panels.
 * Updates metric cards, charts, and comparison table.
 */
import { Charts } from './Charts.js';

export class Dashboard {
    /**
     * @param {import('../ai/MetricsCollector.js').MetricsCollector} metricsCollector
     */
    constructor(metricsCollector) {
        this.metricsCollector = metricsCollector;

        // Chart canvases
        this.waitTimeChart = document.getElementById('chart-wait-time');
        this.throughputChart = document.getElementById('chart-throughput');
        this.comparisonChart = document.getElementById('chart-comparison');

        // Metric elements
        this.els = {
            waitTime: document.getElementById('metric-wait-time'),
            throughput: document.getElementById('metric-throughput'),
            vehicles: document.getElementById('metric-vehicles'),
            congestion: document.getElementById('metric-congestion'),
            metricsStatus: document.getElementById('metrics-status'),
        };

        // Comparison data
        this.fixedSnapshot = null;
        this.aiSnapshot = null;

        // Update interval
        this._updateTimer = 0;
        this._updateInterval = 0.5; // seconds between dashboard updates
    }

    /**
     * Update dashboard visuals.
     * @param {number} dt
     * @param {boolean} running
     */
    update(dt, running) {
        this._updateTimer += dt;
        if (this._updateTimer < this._updateInterval) return;
        this._updateTimer = 0;

        if (!running) return;

        const metrics = this.metricsCollector.getCurrentMetrics();

        // Update metric cards
        if (this.els.waitTime) {
            this.els.waitTime.textContent = metrics.avgWaitTime.toFixed(1) + 's';
            this.els.waitTime.className = 'metric-value ' + (
                metrics.avgWaitTime < 5 ? 'good' : metrics.avgWaitTime < 15 ? 'warn' : 'bad'
            );
        }

        if (this.els.throughput) {
            this.els.throughput.textContent = metrics.throughput;
            this.els.throughput.className = 'metric-value ' + (
                metrics.throughput > 20 ? 'good' : metrics.throughput > 5 ? 'warn' : 'bad'
            );
        }

        if (this.els.vehicles) {
            this.els.vehicles.textContent = metrics.activeVehicles;
        }

        if (this.els.congestion) {
            const pct = (metrics.congestion * 100).toFixed(0);
            this.els.congestion.textContent = pct + '%';
            this.els.congestion.className = 'metric-value ' + (
                metrics.congestion < 0.3 ? 'good' : metrics.congestion < 0.6 ? 'warn' : 'bad'
            );
        }

        // Show live indicator
        if (this.els.metricsStatus) {
            this.els.metricsStatus.style.display = running ? '' : 'none';
        }

        // Update charts
        Charts.drawLineChart(this.waitTimeChart, this.metricsCollector.waitTimeHistory, {
            lineColor: '#f59e0b',
            fillColor: 'rgba(245, 158, 11, 0.08)',
            label: 'Avg Wait Time (s)',
        });

        Charts.drawLineChart(this.throughputChart, this.metricsCollector.throughputHistory, {
            lineColor: '#22c55e',
            fillColor: 'rgba(34, 197, 94, 0.08)',
            label: 'Throughput (vehicles/min)',
        });

        // Update comparison
        this._updateComparison();
    }

    /**
     * Store a comparison snapshot.
     */
    setSnapshot(label, snapshot) {
        if (label === 'fixed') {
            this.fixedSnapshot = snapshot;
        } else if (label === 'ai') {
            this.aiSnapshot = snapshot;
        }
        this._updateComparison();
    }

    _updateComparison() {
        // Update table cells
        if (this.fixedSnapshot) {
            this._setCmpCell('cmp-fixed-wait', this.fixedSnapshot.avgWaitTime.toFixed(1) + 's');
            this._setCmpCell('cmp-fixed-throughput', this.fixedSnapshot.avgThroughput + '/min');
            this._setCmpCell('cmp-fixed-congestion', (this.fixedSnapshot.avgCongestion * 100).toFixed(0) + '%');
            this._setCmpCell('cmp-fixed-emergency', this.fixedSnapshot.avgEmergencyResponse.toFixed(1) + 's');
        }

        if (this.aiSnapshot) {
            this._setCmpCell('cmp-ai-wait', this.aiSnapshot.avgWaitTime.toFixed(1) + 's');
            this._setCmpCell('cmp-ai-throughput', this.aiSnapshot.avgThroughput + '/min');
            this._setCmpCell('cmp-ai-congestion', (this.aiSnapshot.avgCongestion * 100).toFixed(0) + '%');
            this._setCmpCell('cmp-ai-emergency', this.aiSnapshot.avgEmergencyResponse.toFixed(1) + 's');

            // Color better/worse
            if (this.fixedSnapshot) {
                this._colorCompare('cmp-ai-wait', 'cmp-fixed-wait', true); // lower is better
                this._colorCompare('cmp-ai-throughput', 'cmp-fixed-throughput', false); // higher is better
                this._colorCompare('cmp-ai-congestion', 'cmp-fixed-congestion', true);
                this._colorCompare('cmp-ai-emergency', 'cmp-fixed-emergency', true);
            }
        }

        // Update comparison chart
        if (this.fixedSnapshot && this.aiSnapshot) {
            Charts.drawComparisonChart(this.comparisonChart, [
                { label: 'Wait Time', fixed: this.fixedSnapshot.avgWaitTime, ai: this.aiSnapshot.avgWaitTime },
                { label: 'Throughput', fixed: this.fixedSnapshot.avgThroughput, ai: this.aiSnapshot.avgThroughput },
                { label: 'Congestion', fixed: this.fixedSnapshot.avgCongestion * 100, ai: this.aiSnapshot.avgCongestion * 100 },
            ]);
        } else {
            Charts.drawComparisonChart(this.comparisonChart, []);
        }
    }

    _setCmpCell(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    _colorCompare(aiId, fixedId, lowerIsBetter) {
        const aiEl = document.getElementById(aiId);
        const fixedEl = document.getElementById(fixedId);
        if (!aiEl || !fixedEl) return;

        const aiVal = parseFloat(aiEl.textContent);
        const fixedVal = parseFloat(fixedEl.textContent);

        if (isNaN(aiVal) || isNaN(fixedVal)) return;

        const aiBetter = lowerIsBetter ? aiVal < fixedVal : aiVal > fixedVal;
        aiEl.className = aiBetter ? 'better' : 'worse';
        fixedEl.className = aiBetter ? 'worse' : 'better';
    }

    /**
     * Reset dashboard.
     */
    reset() {
        if (this.els.waitTime) this.els.waitTime.textContent = '0.0s';
        if (this.els.throughput) this.els.throughput.textContent = '0';
        if (this.els.vehicles) this.els.vehicles.textContent = '0';
        if (this.els.congestion) this.els.congestion.textContent = '0%';

        for (const id of ['cmp-fixed-wait', 'cmp-fixed-throughput', 'cmp-fixed-congestion', 'cmp-fixed-emergency',
            'cmp-ai-wait', 'cmp-ai-throughput', 'cmp-ai-congestion', 'cmp-ai-emergency']) {
            const el = document.getElementById(id);
            if (el) { el.textContent = '—'; el.className = ''; }
        }
    }
}
