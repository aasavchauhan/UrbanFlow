/**
 * Vehicle — V2 implementation with spline-based lane traversal.
 */
export const VehicleType = { CAR: 'CAR', BUS: 'BUS', AMBULANCE: 'AMBULANCE', FIRE_TRUCK: 'FIRE_TRUCK' };

const VEHICLE_PROPS = {
    [VehicleType.CAR]: { maxSpeed: 80, accel: 40, decel: 60, size: 14, priority: 0 },
    [VehicleType.BUS]: { maxSpeed: 50, accel: 25, decel: 40, size: 22, priority: 0 },
    [VehicleType.AMBULANCE]: { maxSpeed: 100, accel: 55, decel: 70, size: 18, priority: 10 },
    [VehicleType.FIRE_TRUCK]: { maxSpeed: 90, accel: 45, decel: 65, size: 20, priority: 10 },
};

const CAR_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#f472b6', '#818cf8', '#67e8f9', '#fbbf24'];

let _nextVehicleId = 1;

export class Vehicle {
    constructor(config) {
        this.id = `v${_nextVehicleId++}`;
        this.type = config.type || VehicleType.CAR;
        this.cityGraph = config.cityGraph;

        const props = VEHICLE_PROPS[this.type];
        this.maxSpeed = props.maxSpeed;
        this.accel = props.accel;
        this.decel = props.decel;
        this.size = props.size;
        this.priority = props.priority;

        this.color = this.type === VehicleType.CAR ? CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)] 
                     : this.type === VehicleType.BUS ? '#f59e0b'
                     : this.type === VehicleType.AMBULANCE ? '#ef4444' : '#dc2626';
        this.visible = true;

        this.route = config.route || []; // Array of junction IDs
        this.routeIndex = 0;
        
        this.currentGeomId = null; // ID of current Lane or Connection
        this.geomType = null; // 'lane' or 'connection'
        
        this.x = 0;
        this.y = 0;
        this.angle = 0;
        this.speed = 0;
        this.progress = 0; // 0..1 along current geometry

        this.state = 'moving';
        this.waitTime = 0;
        this.totalTime = 0;
        this.distanceTraveled = 0;

        if (this.route.length >= 2) {
            this._startFirstLane();
        }
    }

    _startFirstLane() {
        const fromId = this.route[this.routeIndex];
        const toId = this.route[this.routeIndex + 1];
        
        // Find a lane on the road between fromId and toId
        let validLanes = [];
        for (const lane of this.cityGraph.lanes.values()) {
            if (lane.startNode === fromId && lane.endNode === toId) {
                validLanes.push(lane);
            }
        }
        
        if (validLanes.length > 0) {
            // Pick a random valid lane
            const chosen = validLanes[Math.floor(Math.random() * validLanes.length)];
            this._transferToGeom(chosen, 'lane');
        } else {
            this.state = 'arrived';
        }
    }

    _transferToGeom(geomObj, type) {
        // Remove from old geom
        if (this.currentGeomId) {
            const oldGeom = this.geomType === 'lane' ? this.cityGraph.lanes.get(this.currentGeomId) 
                                                     : this.cityGraph.connections.get(this.currentGeomId);
            if (oldGeom) {
                oldGeom.vehicles = oldGeom.vehicles.filter(v => v.id !== this.id);
            }
        }
        
        this.currentGeomId = geomObj.id;
        this.geomType = type;
        this.progress = 0;
        geomObj.vehicles.push(this);
        
        this._updateTransform(0);
    }

    update(dt, signalStates = {}, otherVehicles = []) {
        if (this.state === 'arrived') return 'arrived';

        this.totalTime += dt;

        let currentObj = this.geomType === 'lane' ? this.cityGraph.lanes.get(this.currentGeomId) 
                                                  : this.cityGraph.connections.get(this.currentGeomId);
                                                  
        if (!currentObj) {
            this.state = 'arrived';
            return 'arrived';
        }

        const length = currentObj.geom.length;
        const distRemaining = length - (this.progress * length);

        // ─── Determine signal phase for this vehicle's lane ───
        let signalPhase = 'green'; // default: proceed
        if (this.geomType === 'lane') {
            const endJunctionId = currentObj.endNode;
            const signal = signalStates[endJunctionId];
            if (signal && this.priority === 0) {
                // Look up per-lane phase (red/green/yellow)
                signalPhase = (signal.phases && signal.phases[currentObj.id])
                    ? signal.phases[currentObj.id]
                    : (signal.state || 'green');
            }
        }

        // ─── Check vehicle ahead on same geometry ───
        let vehicleAhead = null;
        let nearestDist = Infinity;
        
        for (const other of currentObj.vehicles) {
            if (other.id === this.id) continue;
            if (other.progress > this.progress) {
                const dist = (other.progress - this.progress) * length;
                if (dist < nearestDist) {
                    nearestDist = dist;
                    vehicleAhead = other;
                }
            }
        }

        let targetSpeed = this.maxSpeed;
        const MIN_FOLLOW_DIST = this.size + 15; 
        
        let stoppingForSignal = false;
        let yieldingToTraffic = false;

        // ─── 1. Follow distance to vehicle ahead ───
        if (vehicleAhead) {
            const followDist = nearestDist - MIN_FOLLOW_DIST;
            if (followDist < 0) {
                targetSpeed = 0;
            } else {
                const safeSpeed = Math.sqrt(2 * this.decel * Math.max(0, followDist));
                targetSpeed = Math.min(targetSpeed, safeSpeed, vehicleAhead.speed);
            }
        }

        // ─── 2. Signal & Intersection Entry (approaching end of lane) ───
        if (this.geomType === 'lane') {
            // Stop line is 1 vehicle-length before the end of the lane
            const stopLineDist = distRemaining - this.size;
            
            // Dynamic check distance: fast vehicles need more room to realize they must brake
            const reqBrakeDist = (this.speed * this.speed) / (2 * this.decel);
            const checkDist = Math.max(120, reqBrakeDist * 1.2);
            
            if (stopLineDist < checkDist && stopLineDist > -this.size * 2) {
                let shouldStop = false;
                
                if (signalPhase === 'red' || signalPhase === 'yellow') {
                    // Can we physically stop in time?
                    const stoppingDist = reqBrakeDist;
                    
                    if (signalPhase === 'yellow' && this.speed > 5 && stopLineDist < stoppingDist * 0.5) {
                        // Already-moving vehicles that cannot safely stop may clear yellow.
                        shouldStop = false;
                    } else {
                        shouldStop = true;
                        stoppingForSignal = true;
                    }
                } else {
                    // Green or uncontrolled — check intersection path reservation
                    const nextConnId = this._peekNextConnection(currentObj);
                    if (nextConnId) {
                        const targetConn = this.cityGraph.connections.get(nextConnId);
                        if (targetConn && targetConn.conflictingCurves) {
                            for (const conflictId of targetConn.conflictingCurves) {
                                const conflictConn = this.cityGraph.connections.get(conflictId);
                                if (!conflictConn) continue;
                                
                                if (conflictConn.vehicles.length > 0) {
                                    for (const otherV of conflictConn.vehicles) {
                                        if (otherV.priority > this.priority) {
                                            shouldStop = true; yieldingToTraffic = true; break;
                                        } else if (otherV.priority === this.priority) {
                                            if (targetConn.turnType === 'right' && conflictConn.turnType !== 'right') { // Less sharp curve for LHD
                                                shouldStop = true; yieldingToTraffic = true; break;
                                            } else if (otherV.progress > 0.1) {
                                                shouldStop = true; yieldingToTraffic = true; break;
                                            }
                                        }
                                    }
                                }

                                const fromLane = this.cityGraph.lanes.get(conflictConn.fromLane);
                                if (fromLane && fromLane.vehicles.length > 0 && !shouldStop) {
                                    // Don't yield to vehicles that are facing a red light
                                    let otherSignalPhase = 'green';
                                    const otherSignal = signalStates[fromLane.endNode];
                                    if (otherSignal && otherSignal.phases) {
                                        otherSignalPhase = otherSignal.phases[fromLane.id] || otherSignal.state || 'green';
                                    }
                                    if (otherSignalPhase === 'red') continue;

                                    for (const otherV of fromLane.vehicles) {
                                        const otherDistRemaining = fromLane.geom.length * (1 - otherV.progress) - otherV.size;
                                        const otherBrakeDist = (otherV.speed * otherV.speed) / (2 * otherV.decel);
                                        const otherCheckDist = Math.max(60, otherBrakeDist);
                                        
                                        if (otherDistRemaining < otherCheckDist && otherDistRemaining > 0) {
                                            if (otherV.priority > this.priority) {
                                                shouldStop = true; yieldingToTraffic = true; break;
                                            } else if (otherV.priority === this.priority) {
                                                if (targetConn.turnType === 'right' && conflictConn.turnType !== 'right') {
                                                    shouldStop = true; yieldingToTraffic = true; break;
                                                } else if (targetConn.turnType === conflictConn.turnType && stopLineDist > otherDistRemaining) {
                                                    shouldStop = true; yieldingToTraffic = true; break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                
                if (shouldStop) {
                    if (stopLineDist <= 0) {
                        targetSpeed = 0;
                    } else {
                        const safeSpeed = Math.sqrt(2 * this.decel * Math.max(0, stopLineDist));
                        targetSpeed = Math.min(targetSpeed, safeSpeed);
                    }
                }
            }
        }

        // ─── 3. Inside intersection (connection) — reduced speed + collision avoidance ───
        if (this.geomType === 'connection') {
            const currentConn = this.cityGraph.connections.get(this.currentGeomId);
            
            if (currentConn) {
                // Adjust speed realisticly based on turn type
                if (currentConn.turnType === 'straight') {
                    // Slight reduction for crossing intersection
                    targetSpeed = Math.min(targetSpeed, this.maxSpeed * 0.85);
                } else if (currentConn.turnType === 'right') { // Less sharp curve for LHD
                    targetSpeed = Math.min(targetSpeed, this.maxSpeed * 0.70);
                } else if (currentConn.turnType === 'left') { // Sharp cross-lane curve for LHD
                    targetSpeed = Math.min(targetSpeed, this.maxSpeed * 0.45);
                } else {
                    targetSpeed = Math.min(targetSpeed, this.maxSpeed * 0.5);
                }
            } else {
                targetSpeed = Math.min(targetSpeed, this.maxSpeed * 0.5);
            }
            
            // Adjust for vehicle size (heavy vehicles take turns slower)
            if (this.type === VehicleType.BUS || this.type === VehicleType.FIRE_TRUCK) {
                targetSpeed *= 0.8;
            }
            
            if (currentConn && currentConn.conflictingCurves) {
                for (const conflictId of currentConn.conflictingCurves) {
                    const conflictConn = this.cityGraph.connections.get(conflictId);
                    if (conflictConn) {
                        for (const otherV of conflictConn.vehicles) {
                            const dx = otherV.x - this.x;
                            const dy = otherV.y - this.y;
                            if (dx*dx + dy*dy < (this.size * 2.5) * (this.size * 2.5)) {
                                const dot = Math.cos(this.angle) * dx + Math.sin(this.angle) * dy;
                                if (dot > 0) {
                                    targetSpeed = 0;
                                    yieldingToTraffic = true;
                                } else if (Math.abs(dot) < this.size && this.id > otherV.id) {
                                    targetSpeed = 0;
                                    yieldingToTraffic = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        // ─── Apply Physics ───

        if (targetSpeed < 2 && (stoppingForSignal || yieldingToTraffic || (vehicleAhead && nearestDist < MIN_FOLLOW_DIST + 5))) {
            targetSpeed = 0;
            this.state = 'waiting';
            this.waitTime += dt;
        } else {
            this.state = 'moving';
        }

        if (this.speed < targetSpeed) {
            this.speed = Math.min(targetSpeed, this.speed + this.accel * dt);
        } else if (this.speed > targetSpeed) {
            this.speed = Math.max(targetSpeed, this.speed - this.decel * dt);
        }

        if (this.speed > 0) {
            const progressDelta = (this.speed * dt) / length;
            this.progress += progressDelta;
            this.distanceTraveled += this.speed * dt;
        }

        // ─── Hard clamp: prevent running through a red/yellow signal ───
        // If we're on a lane and the signal is not green, clamp progress
        // so the vehicle can never overshoot the stop line.
        if (this.geomType === 'lane' && (signalPhase === 'red' || signalPhase === 'yellow') && this.priority === 0) {
            const maxProgress = (length - this.size) / length;
            if (this.progress > maxProgress && stoppingForSignal) {
                this.progress = maxProgress;
                this.speed = 0;
                this.state = 'waiting';
                this.waitTime += dt;
            }
        }

        if (this.progress >= 1) {
            this._handleGeomTransition(currentObj);
            return this.state;
        }

        this._updateTransform(this.progress, currentObj);

        return this.state;
    }

    _peekNextConnection(currentObj) {
        if (!this.route[this.routeIndex + 2]) return null;
        const nextJunctionId = this.route[this.routeIndex + 2];
        for (const nextConnId of currentObj.nextLanes) {
            const connObj = nextConnId.id ? nextConnId : this.cityGraph.connections.get(nextConnId.id || nextConnId);
            if (!connObj) continue;
            const targetLane = this.cityGraph.lanes.get(connObj.toLane);
            if (targetLane && targetLane.endNode === nextJunctionId) {
                return connObj.id;
            }
        }
        return null;
    }

    _handleGeomTransition(currentObj) {
        if (this.geomType === 'lane') {
            // Reached end of lane (entering junction)
            this.routeIndex++;
            const nextJunctionId = this.route[this.routeIndex + 1]; // Next macro destination
            
            if (!nextJunctionId) {
                // Arrived
                this.state = 'arrived';
                return;
            }
            
            // Find connection that leads to a lane targeting nextJunctionId
            let validConnections = [];
            for (const nextConnId of currentObj.nextLanes) {
                const connObj = nextConnId.id ? nextConnId : this.cityGraph.connections.get(nextConnId.id || nextConnId);
                if (!connObj) continue;
                
                const targetLane = this.cityGraph.lanes.get(connObj.toLane);
                if (targetLane && targetLane.endNode === nextJunctionId) {
                    validConnections.push(connObj);
                }
            }
            
            if (validConnections.length > 0) {
                const chosen = validConnections[Math.floor(Math.random() * validConnections.length)];
                this._transferToGeom(chosen, 'connection');
            } else {
                this.state = 'arrived'; // Lost path
            }
            
        } else {
            // Reached end of connection (entering new road lane)
            const targetLane = this.cityGraph.lanes.get(currentObj.toLane);
            if (targetLane) {
                this._transferToGeom(targetLane, 'lane');
            } else {
                this.state = 'arrived';
            }
        }
    }

    _updateTransform(t, currentObj = null) {
        if (!currentObj) {
            currentObj = this.geomType === 'lane' ? this.cityGraph.lanes.get(this.currentGeomId) 
                                                  : this.cityGraph.connections.get(this.currentGeomId);
        }
        if (!currentObj || !currentObj.geom) return;
        
        const pt = currentObj.geom.getPoint(t);
        const tangent = currentObj.geom.getTangent(t);
        
        this.x = pt.x;
        this.y = pt.y;
        this.angle = Math.atan2(tangent.y, tangent.x);
    }

    getRenderData() {
        return {
            id: this.id, x: this.x, y: this.y, angle: this.angle,
            type: this.type, color: this.color, visible: this.visible, state: this.state,
            speed: this.speed, progress: this.progress, geomType: this.geomType,
        };
    }
}
