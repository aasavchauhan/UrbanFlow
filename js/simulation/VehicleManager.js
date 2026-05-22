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
        if (this.autoSpawnEnabled) {
            this._spawnAccumulator += dt * this.autoSpawnRate;
            while (this._spawnAccumulator >= 1) {
                this.spawnRandom(1, VehicleType.CAR);
                this._spawnAccumulator -= 1;
            }
        }

        // Update all vehicles
        const arrived = [];
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
            }
        }

        // Remove arrived vehicles
        for (const vehicle of arrived) {
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

        this.vehicles.push(vehicle);
        this.totalSpawned++;
        this.eventBus.emit(Events.VEHICLE_SPAWNED, { vehicle });
        return vehicle;
    }

    /**
     * Spawn N random vehicles.
     */
    spawnRandom(count, type = VehicleType.CAR) {
        const entryPoints = this.cityGraph.getEntryExitPoints();
        if (entryPoints.length < 2) return;

        let spawned = 0;
        let attempts = 0;

        while (spawned < count && attempts < count * 3) {
            attempts++;
            const origin = entryPoints[Math.floor(Math.random() * entryPoints.length)];
            let dest = entryPoints[Math.floor(Math.random() * entryPoints.length)];

            // Ensure different origin and destination
            if (origin.id === dest.id) continue;

            const vehicle = this.spawnVehicle(type, origin.id, dest.id);
            if (vehicle) spawned++;
        }
    }

    /**
     * Spawn an emergency vehicle.
     */
    spawnEmergency(type) {
        if (type !== VehicleType.AMBULANCE && type !== VehicleType.FIRE_TRUCK) {
            type = VehicleType.AMBULANCE;
        }
        this.spawnRandom(1, type);
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
                totalTime: vehicle.totalTime,
                waitTime: vehicle.waitTime,
            });
        }
    }
}
