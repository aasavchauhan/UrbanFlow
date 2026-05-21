/**
 * GridSystem — Configurable grid with snap-to-grid logic.
 */
export class GridSystem {
    constructor(gridSize = 50) {
        this.gridSize = gridSize;
        this.enabled = true;
    }

    /**
     * Snap world coordinates to nearest grid point.
     */
    snap(x, y) {
        if (!this.enabled) return { x, y };
        return {
            x: Math.round(x / this.gridSize) * this.gridSize,
            y: Math.round(y / this.gridSize) * this.gridSize,
        };
    }

    /**
     * Snap to grid with a tolerance threshold.
     * Only snaps if within threshold distance of a grid point.
     */
    snapWithThreshold(x, y, threshold = 20) {
        const snapped = this.snap(x, y);
        const dx = Math.abs(x - snapped.x);
        const dy = Math.abs(y - snapped.y);
        if (dx < threshold && dy < threshold) {
            return snapped;
        }
        return { x, y };
    }

    setGridSize(size) {
        this.gridSize = Math.max(10, Math.min(200, size));
    }
}
