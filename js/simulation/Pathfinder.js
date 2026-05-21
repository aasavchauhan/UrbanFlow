/**
 * Pathfinder — A* pathfinding on the city graph.
 * Used by VehicleManager to compute routes.
 */
export class Pathfinder {
    /**
     * @param {import('../core/CityGraph.js').CityGraph} cityGraph
     */
    constructor(cityGraph) {
        this.cityGraph = cityGraph;
        this._cache = new Map(); // key → path
        this._cacheSize = 200;
    }

    /**
     * Find shortest path between two junctions using A*.
     * @param {string} startId
     * @param {string} endId
     * @param {object} options
     * @returns {string[]|null} Junction IDs forming the path
     */
    findPath(startId, endId, options = {}) {
        const { avoidBlocked = true, congestionWeight = 0.3, useCache = true } = options;

        // Check cache
        const cacheKey = `${startId}-${endId}-${avoidBlocked}`;
        if (useCache && congestionWeight === 0 && this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        const path = this._astar(startId, endId, avoidBlocked, congestionWeight);

        // Cache result (only for static paths)
        if (path && useCache && congestionWeight === 0) {
            this._cache.set(cacheKey, path);
            if (this._cache.size > this._cacheSize) {
                const firstKey = this._cache.keys().next().value;
                this._cache.delete(firstKey);
            }
        }

        return path;
    }

    /**
     * A* implementation with configurable cost function.
     */
    _astar(startId, endId, avoidBlocked, congestionWeight) {
        if (!this.cityGraph.junctions.has(startId) || !this.cityGraph.junctions.has(endId)) {
            return null;
        }
        if (startId === endId) return [startId];

        const startJ = this.cityGraph.getJunction(startId);
        const endJ = this.cityGraph.getJunction(endId);

        const openSet = [{ id: startId, f: 0, g: 0 }];
        const gScore = new Map([[startId, 0]]);
        const cameFrom = new Map();
        const closedSet = new Set();

        while (openSet.length > 0) {
            // Get node with lowest f score
            openSet.sort((a, b) => a.f - b.f);
            const current = openSet.shift();

            if (current.id === endId) {
                return this._reconstructPath(cameFrom, endId);
            }

            closedSet.add(current.id);

            const neighbors = this.cityGraph.getNeighbors(current.id);
            for (const neighborId of neighbors) {
                if (closedSet.has(neighborId)) continue;

                const roadInfo = this.cityGraph.getRoadFromTo(current.id, neighborId);
                if (!roadInfo) continue;

                const { road } = roadInfo;
                if (avoidBlocked && road.blocked) continue;

                // Cost calculation
                let moveCost = road.length;

                // Congestion penalty
                if (congestionWeight > 0) {
                    const vehicleCount = road.vehicles ? road.vehicles.length : 0;
                    moveCost += vehicleCount * congestionWeight * 50;
                }

                // Speed limit bonus (faster roads are cheaper per unit distance)
                moveCost *= (60 / (road.speedLimit || 60));

                const tentativeG = gScore.get(current.id) + moveCost;

                if (!gScore.has(neighborId) || tentativeG < gScore.get(neighborId)) {
                    cameFrom.set(neighborId, current.id);
                    gScore.set(neighborId, tentativeG);

                    // Heuristic: Euclidean distance to goal
                    const neighborJ = this.cityGraph.getJunction(neighborId);
                    const h = this._heuristic(neighborJ, endJ);

                    const fScore = tentativeG + h;

                    // Add to open set if not already there
                    const existingIdx = openSet.findIndex(n => n.id === neighborId);
                    if (existingIdx >= 0) {
                        openSet[existingIdx].f = fScore;
                        openSet[existingIdx].g = tentativeG;
                    } else {
                        openSet.push({ id: neighborId, f: fScore, g: tentativeG });
                    }
                }
            }
        }

        return null; // No path found
    }

    _heuristic(nodeA, nodeB) {
        if (!nodeA || !nodeB) return 0;
        const dx = nodeA.x - nodeB.x;
        const dy = nodeA.y - nodeB.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    _reconstructPath(cameFrom, endId) {
        const path = [endId];
        let current = endId;
        while (cameFrom.has(current)) {
            current = cameFrom.get(current);
            path.unshift(current);
        }
        return path;
    }

    /**
     * Invalidate cache (call when graph structure changes).
     */
    clearCache() {
        this._cache.clear();
    }
}
