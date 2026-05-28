/**
 * VehicleManager — Manages vehicle lifecycle: spawn, route, update, despawn.
 */
import { Vehicle, VehicleType } from './Vehicle.js';
import { Pathfinder } from './Pathfinder.js';
import { Events } from '../core/EventBus.js';

export class VehicleManager {
    /**
     * @param {import('../core/CityGraph.js').CityGraph} cityGraph
     * @param {import('../core/EventBus.js').EventBus} eventBus
     */
    constructor(cityGraph, eventBus) {
        this.cityGraph = cityGraph;
        this.eventBus = eventBus;
        this.pathfinder = new Pathfinder(cityGraph);

        /** @type {Vehicle[]} */
        this.vehicles = [];

        // Auto-spawner
        this.autoSpawnEnabled = false;
        this.autoSpawnRate = 3; // vehicles per second
        this.maxActiveVehicles = 80;
        this._spawnAccumulator = 0;

        // Weather modifier
        this.speedMultiplier = 1.0;

        // Stats
        this.totalSpawned = 0;
        this.totalArrived = 0;
    }

    /**
     * Update all vehicles for one frame.
     * @param {number} dt - Delta time in seconds
     * @param {object} signalStates - Map of junctionId → signal info
     */
    update(dt, signalStates = {}, aiState = null) {
        // Auto-spawn
        if (this.autoSpawnEnabled && this._canAutoSpawn()) {
            this._spawnAccumulator += dt * this.autoSpawnRate;
            while (this._spawnAccumulator >= 1) {
                this.spawnRandom(1, VehicleType.CAR);
                this._spawnAccumulator -= 1;
            }
        } else {
            this._spawnAccumulator = Math.min(this._spawnAccumulator, 0.5);
        }

        // Update all vehicles
        const arrived = [];
        const stale = [];
        for (const vehicle of this.vehicles) {
            // Apply weather speed modifier
            const originalMax = vehicle.maxSpeed;
            let speedFactor = this.speedMultiplier;
            if (aiState?.laneSpeedHints && vehicle.geomType === 'lane') {
                const hint = aiState.laneSpeedHints[vehicle.currentGeomId];
                if (hint?.factor) {
                    speedFactor *= hint.factor;
                }
            }
            vehicle.maxSpeed *= speedFactor;

            vehicle.update(dt, signalStates, this.vehicles);

            vehicle.maxSpeed = originalMax;

            if (vehicle.state === 'arrived') {
                arrived.push(vehicle);
            } else if (this._isGridlocked(vehicle)) {
                stale.push(vehicle);
            }
        }

        // Remove arrived vehicles
        for (const vehicle of [...arrived, ...stale]) {
            this._removeVehicle(vehicle);
        }
    }

    /**
     * Spawn a single vehicle with a specific route.
     */
    spawnVehicle(type, originId, destId) {
        const route = this.pathfinder.findPath(originId, destId, {
            avoidBlocked: true,
            congestionWeight: 0.3,
        });

        if (!route || route.length < 2) return null;

        const vehicle = new Vehicle({
            type,
            route,
            cityGraph: this.cityGraph,
        });

        if (vehicle.state === 'blocked-spawn' || vehicle.state === 'arrived') {
            return null;
        }

        this.vehicles.push(vehicle);
        this.totalSpawned++;
        this.eventBus.emit(Events.VEHICLE_SPAWNED, { vehicle });
        return vehicle;
    }

    /**
     * Spawn N random vehicles.
     */
    spawnRandom(count, type = VehicleType.CAR) {
        let entryPoints = this.cityGraph.getEntryExitPoints();
        if (entryPoints.length < 2) {
            entryPoints = Array.from(this.cityGraph.junctions.values());
        }
        if (entryPoints.length < 2) return;

        const centroid = entryPoints.reduce(
            (acc, j) => ({ x: acc.x + j.x, y: acc.y + j.y }),
            { x: 0, y: 0 }
        );
        centroid.x /= entryPoints.length;
        centroid.y /= entryPoints.length;

        const weights = entryPoints.map(j => {
            const dx = j.x - centroid.x;
            const dy = j.y - centroid.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            return 1 + dist / 200;
        });

        const pickWeighted = () => {
            const total = weights.reduce((sum, w) => sum + w, 0);
            let roll = Math.random() * total;
            for (let i = 0; i < entryPoints.length; i++) {
                roll -= weights[i];
                if (roll <= 0) return entryPoints[i];
            }
            return entryPoints[entryPoints.length - 1];
        };

        let spawned = 0;
        let attempts = 0;

        while (spawned < count && attempts < count * 8) {
            attempts++;
            const origin = pickWeighted();
            let dest = pickWeighted();

            // Ensure different origin and destination
            if (origin.id === dest.id) continue;

            const vehicle = this.spawnVehicle(type, origin.id, dest.id);
            if (vehicle) spawned++;
        }
    }

    /**
     * Spawn an emergency vehicle.
     */
    spawnEmergency(type, originId = null, destId = null) {
        if (type !== VehicleType.AMBULANCE && type !== VehicleType.FIRE_TRUCK) {
            type = VehicleType.AMBULANCE;
        }
        const facilityType = type === VehicleType.FIRE_TRUCK ? 'fire-station' : 'hospital';
        const facilities = this.cityGraph.getFacilities?.(facilityType) || [];
        const entryPoints = this.cityGraph.getEntryExitPoints();

        if (originId && destId && originId !== destId) {
            return this.spawnVehicle(type, originId, destId);
        }

        if (originId) {
            const destinations = facilities.length > 0
                ? facilities
                : Array.from(this.cityGraph.junctions.values()).filter(j => j.id !== originId);
            const dest = this._pickFarthestReachable(originId, destinations);
            if (dest) return this.spawnVehicle(type, originId, dest.id);
        }

        if (facilities.length > 0 && entryPoints.length > 0) {
            const origin = entryPoints[Math.floor(Math.random() * entryPoints.length)];
            const dest = facilities[Math.floor(Math.random() * facilities.length)];
            if (origin && dest && origin.id !== dest.id) {
                return this.spawnVehicle(type, origin.id, dest.id);
            }
        }

        return this.spawnRandom(1, type);
    }

    /**
     * Remove all vehicles.
     */
    clearAll() {
        this.vehicles = [];
        // Clear lane and connection vehicle tracking
        if (this.cityGraph.lanes) {
            for (const lane of this.cityGraph.lanes.values()) {
                lane.vehicles = [];
            }
            for (const conn of this.cityGraph.connections.values()) {
                conn.vehicles = [];
            }
        }
    }

    /**
     * Get render data for all visible vehicles.
     */
    getRenderData() {
        return this.vehicles
            .filter(v => v.state !== 'arrived')
            .map(v => v.getRenderData());
    }

    /**
     * Get statistics.
     */
    getStats() {
        let totalWaitTime = 0;
        let waitingCount = 0;
        let movingCount = 0;

        for (const v of this.vehicles) {
            totalWaitTime += v.waitTime;
            if (v.state === 'waiting') waitingCount++;
            if (v.state === 'moving') movingCount++;
        }

        return {
            activeVehicles: this.vehicles.length,
            movingCount,
            waitingCount,
            avgWaitTime: this.vehicles.length > 0 ? totalWaitTime / this.vehicles.length : 0,
            totalSpawned: this.totalSpawned,
            totalArrived: this.totalArrived,
        };
    }

    // ─── Private ───────────────────────────────────────────────────

    _removeVehicle(vehicle) {
        const idx = this.vehicles.indexOf(vehicle);
        if (idx >= 0) {
            this.vehicles.splice(idx, 1);
            
            // Remove from lane/connection
            if (vehicle.currentGeomId) {
                const geom = vehicle.geomType === 'lane'
                    ? this.cityGraph.lanes.get(vehicle.currentGeomId)
                    : this.cityGraph.connections.get(vehicle.currentGeomId);
                if (geom) {
                    const gIdx = geom.vehicles.indexOf(vehicle);
                    if (gIdx > -1) geom.vehicles.splice(gIdx, 1);
                }
            }
            
            this.totalArrived++;
            this.eventBus.emit(Events.VEHICLE_ARRIVED, {
                vehicleId: vehicle.id,
                vehicleType: vehicle.type,
                priority: vehicle.priority,
                totalTime: vehicle.totalTime,
                waitTime: vehicle.waitTime,
            });
        }
    }

    _canAutoSpawn() {
        if (this.vehicles.length >= this.maxActiveVehicles) return false;
        const laneCount = Math.max(1, this.cityGraph.lanes.size);
        const networkCapacity = laneCount * 3;
        if (this.vehicles.length >= networkCapacity) return false;
        if (this.vehicles.length < 8) return true;

        const waiting = this.vehicles.filter(v => v.state === 'waiting').length;
        const waitingRatio = waiting / this.vehicles.length;
        return waitingRatio < 0.32;
    }

    _isGridlocked(vehicle) {
        if (vehicle.priority > 0) return false;
        if (vehicle.waitReason === 'signal') {
            return vehicle.waitTime > 65;
        }
        if (vehicle.deadlockTime < 18) return false;

        const geom = vehicle.geomType === 'lane'
            ? this.cityGraph.lanes.get(vehicle.currentGeomId)
            : this.cityGraph.connections.get(vehicle.currentGeomId);
        if (!geom) return true;

        const localPileup = geom.vehicles.filter(v => v.state === 'waiting' && v.waitReason !== 'signal').length;
        return localPileup >= 2 || vehicle.deadlockTime > 28;
    }

    _pickFarthestReachable(originId, candidates) {
        let best = null;
        let bestDistance = -Infinity;
        const origin = this.cityGraph.getJunction(originId);
        if (!origin) return null;

        for (const candidate of candidates) {
            if (!candidate || candidate.id === originId) continue;
            const route = this.pathfinder.findPath(originId, candidate.id, {
                avoidBlocked: true,
                congestionWeight: 0.2,
            });
            if (!route || route.length < 2) continue;

            const dx = candidate.x - origin.x;
            const dy = candidate.y - origin.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > bestDistance) {
                bestDistance = distance;
                best = candidate;
            }
        }

        return best;
    }
}
