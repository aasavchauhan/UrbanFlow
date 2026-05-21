/**
 * CityGraph — Graph-based city model for UrbanFlow V2.
 * Includes macro (Junction/Road) and micro (Lane/Spline) graphs.
 */
import { Events } from './EventBus.js';
import { Vector2, LineSegment, BezierCurve } from './Geometry.js';

export const JunctionType = {
    INTERSECTION: 'intersection',
    T_JUNCTION: 't-junction',
    ROUNDABOUT: 'roundabout',
    DEAD_END: 'dead-end',
    ENTRY_EXIT: 'entry-exit',
};

export const RoadType = {
    NORMAL: 'normal',
    HIGHWAY: 'highway',
    RESIDENTIAL: 'residential',
};

export const LANE_WIDTH = 14;

let _nextJunctionId = 1;
let _nextRoadId = 1;
let _nextLaneId = 1;

export class CityGraph {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.junctions = new Map();
        this.roads = new Map();
        this._adjacency = new Map();
        
        // Micro-level geometry graphs
        this.lanes = new Map();      // Road segments
        this.connections = new Map(); // Intersection curves
    }

    addJunction(x, y, type = JunctionType.INTERSECTION) {
        const id = `j${_nextJunctionId++}`;
        const junction = {
            id, x, y, type,
            connections: [],
            signalState: null,
            signalPhases: null,
            internalCurves: [], // BezierCurve connections
            crossings: []       // Pedestrian crossings
        };
        this.junctions.set(id, junction);
        this._adjacency.set(id, new Set());
        this.eventBus.emit(Events.JUNCTION_ADDED, junction);
        return id;
    }

    removeJunction(id) {
        const junction = this.junctions.get(id);
        if (!junction) return;
        const roadIds = [...junction.connections];
        for (const roadId of roadIds) this.removeRoad(roadId);
        this.junctions.delete(id);
        this._adjacency.delete(id);
        this.rebuildGeometry();
        this.eventBus.emit(Events.JUNCTION_REMOVED, { id });
    }

    getJunction(id) { return this.junctions.get(id) || null; }

    findJunctionNear(x, y, radius = 30) {
        let nearest = null, nearestDist = radius;
        for (const j of this.junctions.values()) {
            const dx = j.x - x, dy = j.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < nearestDist) { nearestDist = dist; nearest = j; }
        }
        return nearest;
    }

    addRoad(fromId, toId, config = {}) {
        const fromJ = this.junctions.get(fromId);
        const toJ = this.junctions.get(toId);
        if (!fromJ || !toJ || fromId === toId) return null;
        if (this.getRoadBetween(fromId, toId)) return null;

        const id = `r${_nextRoadId++}`;
        const dx = toJ.x - fromJ.x, dy = toJ.y - fromJ.y;
        const length = Math.sqrt(dx * dx + dy * dy);

        const road = {
            id, from: fromId, to: toId,
            type: config.type || RoadType.NORMAL,
            lanes: config.lanes || 2, // Total lanes
            speedLimit: config.speedLimit || 60,
            length,
            bidirectional: config.bidirectional !== false,
            blocked: false,
            laneObjects: [], // Micro-level lane data
        };

        this.roads.set(id, road);
        fromJ.connections.push(id);
        toJ.connections.push(id);
        this._adjacency.get(fromId).add(toId);
        if (road.bidirectional) this._adjacency.get(toId).add(fromId);
        
        this.rebuildGeometry();
        this.eventBus.emit(Events.ROAD_ADDED, road);
        return id;
    }

    removeRoad(id) {
        const road = this.roads.get(id);
        if (!road) return;
        
        const fromJ = this.junctions.get(road.from);
        const toJ = this.junctions.get(road.to);
        if (fromJ) fromJ.connections = fromJ.connections.filter(r => r !== id);
        if (toJ) toJ.connections = toJ.connections.filter(r => r !== id);

        if (this._adjacency.has(road.from) && !this.getRoadBetween(road.from, road.to, id)) {
            this._adjacency.get(road.from).delete(road.to);
        }
        if (road.bidirectional && this._adjacency.has(road.to) && !this.getRoadBetween(road.to, road.from, id)) {
            this._adjacency.get(road.to).delete(road.from);
        }

        this.roads.delete(id);
        this.rebuildGeometry();
        this.eventBus.emit(Events.ROAD_REMOVED, { id });
    }

    getRoadBetween(fromId, toId, excludeId = null) {
        for (const road of this.roads.values()) {
            if (road.id === excludeId) continue;
            if ((road.from === fromId && road.to === toId) ||
                (road.bidirectional && road.from === toId && road.to === fromId)) {
                return road;
            }
        }
        return null;
    }

    getRoadsAt(junctionId) {
        const j = this.junctions.get(junctionId);
        return j ? j.connections.map(id => this.roads.get(id)).filter(Boolean) : [];
    }
    
    getNeighbors(junctionId) {
        const n = this._adjacency.get(junctionId);
        return n ? [...n] : [];
    }
    
    getRoadFromTo(fromId, toId) {
        for (const road of this.roads.values()) {
            if (road.from === fromId && road.to === toId) return { road, reversed: false };
            if (road.bidirectional && road.from === toId && road.to === fromId) return { road, reversed: true };
        }
        return null;
    }

    // ─── V2 Geometry & Micro-routing ─────────────────────────────────────
    
    rebuildGeometry() {
        this.lanes.clear();
        this.connections.clear();
        
        // Step 1: Generate straight lanes for roads
        for (const road of this.roads.values()) {
            const fromJ = this.junctions.get(road.from);
            const toJ = this.junctions.get(road.to);
            road.laneObjects = [];
            
            const startNodeRadius = Math.max(12, fromJ.connections.length * 6);
            const endNodeRadius = Math.max(12, toJ.connections.length * 6);
            
            const dir = new Vector2(toJ.x - fromJ.x, toJ.y - fromJ.y).normalize();
            // Left-hand drive: use the left normal for offsets
            const offsetDir = new Vector2(dir.y, -dir.x); 
            
            // Adjust road start/end so they don't clip into junction center
            const pStart = new Vector2(fromJ.x, fromJ.y).add(dir.mult(startNodeRadius));
            const pEnd = new Vector2(toJ.x, toJ.y).sub(dir.mult(endNodeRadius));
            
            // Determine forward and backward lanes
            let fwdCount = road.bidirectional ? Math.floor(road.lanes / 2) : road.lanes;
            let bwdCount = road.bidirectional ? Math.ceil(road.lanes / 2) : 0;
            if (fwdCount === 0 && road.lanes > 0) fwdCount = 1;
            
            // Generate Forward Lanes
            for (let i = 0; i < fwdCount; i++) {
                // Offset side
                let offset = (i + 0.5) * LANE_WIDTH;
                if (!road.bidirectional) {
                    offset = (i - fwdCount / 2 + 0.5) * LANE_WIDTH;
                }
                const lStart = pStart.add(offsetDir.mult(offset));
                const lEnd = pEnd.add(offsetDir.mult(offset));
                const geom = new LineSegment(lStart, lEnd);
                
                const laneId = `l_${_nextLaneId++}`;
                const lane = {
                    id: laneId, roadId: road.id, direction: 'fwd',
                    index: i, geom, startNode: road.from, endNode: road.to,
                    nextLanes: [], vehicles: []
                };
                road.laneObjects.push(lane);
                this.lanes.set(laneId, lane);
            }
            
            // Generate Backward Lanes
            for (let i = 0; i < bwdCount; i++) {
                // Offset opposite side, traveling in reverse
                let offset = (i + 0.5) * LANE_WIDTH;
                const lStart = pEnd.sub(offsetDir.mult(offset));
                const lEnd = pStart.sub(offsetDir.mult(offset));
                const geom = new LineSegment(lStart, lEnd);
                
                const laneId = `l_${_nextLaneId++}`;
                const lane = {
                    id: laneId, roadId: road.id, direction: 'bwd',
                    index: i, geom, startNode: road.to, endNode: road.from,
                    nextLanes: [], vehicles: []
                };
                road.laneObjects.push(lane);
                this.lanes.set(laneId, lane);
            }
        }
        
        // Step 2: Generate Intersection Curves
        for (const j of this.junctions.values()) {
            j.internalCurves = [];
            
            // Get all incoming and outgoing lanes for this junction
            const incoming = [];
            const outgoing = [];
            
            for (const lane of this.lanes.values()) {
                if (lane.endNode === j.id) incoming.push(lane);
                if (lane.startNode === j.id) outgoing.push(lane);
            }
            
            // Connect incoming to outgoing (except U-turns unless dead-end)
            for (const inLane of incoming) {
                for (const outLane of outgoing) {
                    if (inLane.roadId === outLane.roadId && j.connections.length > 1) continue; // No U-turn
                    
                    const p0 = inLane.geom.p1; // End of incoming
                    const p2 = outLane.geom.p0; // Start of outgoing
                    
                    // Control point: Center of junction
                    const p1 = new Vector2(j.x, j.y);
                    
                    const curve = new BezierCurve(p0, p1, p2);
                    
                    const connId = `c_${inLane.id}_${outLane.id}`;
                    const connection = {
                        id: connId, junctionId: j.id, 
                        fromLane: inLane.id, toLane: outLane.id, 
                        geom: curve, vehicles: []
                    };
                    
                    j.internalCurves.push(connection);
                    this.connections.set(connId, connection);
                    inLane.nextLanes.push(connection);
                }
            }
        }

        // Step 3: Compute Intersection Matrix for the Junctions
        for (const j of this.junctions.values()) {
            const curves = j.internalCurves;
            const curveSamples = curves.map(c => {
                const pts = [];
                for (let t = 0; t <= 1; t += 0.1) pts.push(c.geom.getPoint(t));
                
                const tIn = c.geom.getTangent(0);
                const tOut = c.geom.getTangent(1);
                const cross = tIn.x * tOut.y - tIn.y * tOut.x;
                const dot = tIn.x * tOut.x + tIn.y * tOut.y;
                let turnType = 'straight';
                if (dot > 0.7) { 
                    turnType = 'straight';
                } else if (cross > 0) { 
                    turnType = 'right'; // Clockwise in Y-down
                } else {
                    turnType = 'left';  // Counter-clockwise
                }
                c.turnType = turnType;
                c.conflictingCurves = new Set();
                return { id: c.id, pts };
            });

            for (let i = 0; i < curveSamples.length; i++) {
                for (let k = i + 1; k < curveSamples.length; k++) {
                    const cA = curveSamples[i];
                    const cB = curveSamples[k];
                    const curveA = curves.find(c => c.id === cA.id);
                    const curveB = curves.find(c => c.id === cB.id);
                    
                    if (curveA.fromLane === curveB.fromLane || curveA.toLane === curveB.toLane) {
                        curveA.conflictingCurves.add(cB.id);
                        curveB.conflictingCurves.add(cA.id);
                        continue;
                    }

                    let conflict = false;
                    for (const pA of cA.pts) {
                        for (const pB of cB.pts) {
                            const dx = pA.x - pB.x;
                            const dy = pA.y - pB.y;
                            if (dx*dx + dy*dy < (LANE_WIDTH * 1.5) * (LANE_WIDTH * 1.5)) {
                                conflict = true; break;
                            }
                        }
                        if (conflict) break;
                    }
                    
                    if (conflict) {
                        curveA.conflictingCurves.add(cB.id);
                        curveB.conflictingCurves.add(cA.id);
                    }
                }
            }
        }
    }

    // ─── Shortest Path using V2 Lane Graph ──────────────────────────
    
    getShortestPath(startJunctionId, endJunctionId, options = {}) {
        if (!this.junctions.has(startJunctionId) || !this.junctions.has(endJunctionId)) return null;
        if (startJunctionId === endJunctionId) return [startJunctionId];

        const dist = new Map();
        const prev = new Map();
        const visited = new Set();
        const queue = [];

        dist.set(startJunctionId, 0);
        queue.push({ id: startJunctionId, cost: 0 });

        while (queue.length > 0) {
            queue.sort((a, b) => a.cost - b.cost);
            const { id: current } = queue.shift();

            if (current === endJunctionId) {
                const path = [];
                let node = endJunctionId;
                while (node) { path.unshift(node); node = prev.get(node); }
                return path;
            }

            if (visited.has(current)) continue;
            visited.add(current);

            const neighbors = this.getNeighbors(current);
            for (const neighborId of neighbors) {
                if (visited.has(neighborId)) continue;
                
                const roadInfo = this.getRoadFromTo(current, neighborId);
                if (!roadInfo) continue;
                const { road } = roadInfo;
                if (options.avoidBlocked && road.blocked) continue;

                let cost = road.length;
                if (options.congestionWeight > 0) {
                    cost += road.laneObjects.reduce((acc, l) => acc + l.vehicles.length, 0) * options.congestionWeight * 50;
                }

                const newDist = dist.get(current) + cost;
                if (!dist.has(neighborId) || newDist < dist.get(neighborId)) {
                    dist.set(neighborId, newDist);
                    prev.set(neighborId, current);
                    queue.push({ id: neighborId, cost: newDist });
                }
            }
        }
        return null;
    }

    getSignalizedJunctions() {
        return Array.from(this.junctions.values()).filter(j => j.signalState);
    }
    
    getEntryExitPoints() {
        return Array.from(this.junctions.values()).filter(j => j.type === JunctionType.ENTRY_EXIT || j.connections.length <= 2);
    }

    // ─── Serialization & Session Management ──────────────────────────
    
    toJSON() {
        return {
            junctions: Array.from(this.junctions.values()).map(j => ({
                id: j.id,
                x: j.x,
                y: j.y,
                type: j.type,
                signalState: j.signalState ? { ...j.signalState } : null,
                signalPhases: j.signalPhases ? { ...j.signalPhases } : null,
                signalConfig: j.signalConfig ? { ...j.signalConfig } : null,
            })),
            roads: Array.from(this.roads.values()).map(r => ({
                id: r.id, from: r.from, to: r.to, type: r.type, lanes: r.lanes, speedLimit: r.speedLimit, bidirectional: r.bidirectional
            })),
            nextJunctionId: _nextJunctionId,
            nextRoadId: _nextRoadId
        };
    }

    fromJSON(data) {
        if (!data) return false;
        try {
            this.clear();
            
            let maxJid = 0;
            for (const j of data.junctions) {
                this.junctions.set(j.id, {
                    ...j,
                    signalState: j.signalState || null,
                    signalPhases: j.signalPhases || null,
                    signalConfig: j.signalConfig || null,
                    connections: [],
                    internalCurves: [],
                    crossings: j.crossings || [],
                });
                this._adjacency.set(j.id, new Set());
                
                const num = parseInt(j.id.replace('j', ''));
                if (!isNaN(num) && num > maxJid) maxJid = num;
            }
            
            let maxRid = 0;
            if (data.roads) {
                for (const r of data.roads) {
                    this.roads.set(r.id, { ...r, blocked: false, laneObjects: [] });
                    const fromJ = this.junctions.get(r.from);
                    const toJ = this.junctions.get(r.to);
                    if (fromJ) fromJ.connections.push(r.id);
                    if (toJ) toJ.connections.push(r.id);
                    if (fromJ && toJ) {
                        this._adjacency.get(r.from).add(r.to);
                        if (r.bidirectional) this._adjacency.get(r.to).add(r.from);
                    }
                    
                    const num = parseInt(r.id.replace('r', ''));
                    if (!isNaN(num) && num > maxRid) maxRid = num;
                }
            }
            
            _nextJunctionId = data.nextJunctionId || (maxJid + 1);
            _nextRoadId = data.nextRoadId || (maxRid + 1);
            
            this.rebuildGeometry();
            return true;
        } catch(e) {
            console.error("Failed to load JSON data", e);
            return false;
        }
    }
    
    saveSession() {
        const data = this.toJSON();
        localStorage.setItem('urbanflow_session', JSON.stringify(data));
        console.log("Session saved.");
    }
    
    loadSession() {
        const json = localStorage.getItem('urbanflow_session');
        if (!json) return false;
        return this.fromJSON(JSON.parse(json));
    }

    clear() {
        this.junctions.clear();
        this.roads.clear();
        this._adjacency.clear();
        this.lanes.clear();
        this.connections.clear();
        _nextJunctionId = 1;
        _nextRoadId = 1;
        _nextLaneId = 1;
    }

    getStats() {
        return {
            junctions: this.junctions.size,
            roads: this.roads.size,
            lanes: this.lanes.size,
            signalizedJunctions: this.getSignalizedJunctions().length,
        };
    }
}
