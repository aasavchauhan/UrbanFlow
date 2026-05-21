/**
 * Heatmap — Traffic density overlay for the main canvas.
 * Calculates density per road and provides data for Renderer.
 */
export class Heatmap {
    constructor() {
        this.enabled = false;
        this._data = {};      // roadId → density (0..1)
        this._updateTimer = 0;
        this._updateInterval = 0.5; // seconds between updates
    }

    /**
     * Update heatmap data from simulation state.
     * @param {number} dt
     * @param {import('../core/CityGraph.js').CityGraph} cityGraph
     */
    update(dt, cityGraph) {
        if (!this.enabled) return;

        this._updateTimer += dt;
        if (this._updateTimer < this._updateInterval) return;
        this._updateTimer = 0;

        this._data = {};
        for (const road of cityGraph.roads.values()) {
            const capacity = road.lanes * 4; // estimated capacity
            const vehicleCount = road.vehicles ? road.vehicles.length : 0;
            this._data[road.id] = Math.min(1, vehicleCount / Math.max(1, capacity));
        }
    }

    /**
     * Get current heatmap data for rendering.
     */
    getData() {
        return this.enabled ? this._data : null;
    }

    toggle() {
        this.enabled = !this.enabled;
        if (!this.enabled) {
            this._data = {};
        }
    }
}
