/**
 * Renderer — Canvas 2D rendering pipeline for UrbanFlow.
 * Handles camera (pan/zoom), layered drawing, and visual effects.
 */
import { Events } from './EventBus.js';

export class Renderer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import('./EventBus.js').EventBus} eventBus
     */
    constructor(canvas, eventBus) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.eventBus = eventBus;

        // Camera state
        this.camera = {
            x: 0,
            y: 0,
            zoom: 1,
            minZoom: 0.2,
            maxZoom: 3,
        };

        // Rendering options
        this.showGrid = true;
        this.showHeatmap = true;
        this.heatmapData = null;
        this.gridSize = 50;
        this.antiAlias = true;

        // Animation state
        this._animTime = 0;

        // Ghost preview for editor
        this.ghostPreview = null; // { type, x, y, fromJunction, ... }

        this._resizeObserver = null;
        this._setupResize();
    }

    // ─── Resize Handling ───────────────────────────────────────────

    _setupResize() {
        const resize = () => {
            const container = this.canvas.parentElement;
            if (!container) return;
            const dpr = window.devicePixelRatio || 1;
            const rect = container.getBoundingClientRect();
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        this._resizeObserver = new ResizeObserver(resize);
        this._resizeObserver.observe(this.canvas.parentElement);
    }

    // ─── Coordinate Conversion ─────────────────────────────────────

    /**
     * Screen coordinates → World coordinates
     */
    screenToWorld(sx, sy) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (sx - rect.left - rect.width / 2) / this.camera.zoom + this.camera.x,
            y: (sy - rect.top - rect.height / 2) / this.camera.zoom + this.camera.y,
        };
    }

    /**
     * World coordinates → Screen coordinates
     */
    worldToScreen(wx, wy) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (wx - this.camera.x) * this.camera.zoom + rect.width / 2,
            y: (wy - this.camera.y) * this.camera.zoom + rect.height / 2,
        };
    }

    // ─── Camera Controls ───────────────────────────────────────────

    pan(dx, dy) {
        this.camera.x -= dx / this.camera.zoom;
        this.camera.y -= dy / this.camera.zoom;
    }

    zoom(factor, centerX, centerY) {
        const oldZoom = this.camera.zoom;
        const worldBefore = (centerX !== undefined && centerY !== undefined)
            ? this.screenToWorld(centerX, centerY)
            : null;

        this.camera.zoom = Math.max(
            this.camera.minZoom,
            Math.min(this.camera.maxZoom, this.camera.zoom * factor)
        );

        // Zoom toward cursor position
        if (worldBefore && this.camera.zoom !== oldZoom) {
            const rect = this.canvas.getBoundingClientRect();
            this.camera.x = worldBefore.x - (centerX - rect.left - rect.width / 2) / this.camera.zoom;
            this.camera.y = worldBefore.y - (centerY - rect.top - rect.height / 2) / this.camera.zoom;
        }
    }

    centerOn(wx, wy) {
        this.camera.x = wx;
        this.camera.y = wy;
    }

    // ─── Main Render Loop ──────────────────────────────────────────

    /**
     * Render one frame.
     * @param {import('./CityGraph.js').CityGraph} cityGraph
     * @param {object} simState - { vehicles, signals, simTime, mode }
     */
    render(cityGraph, simState = {}) {
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        this._animTime += 0.016; // ~60fps

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Background
        this._drawBackground(ctx, w, h);

        // Apply camera transform
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.scale(this.camera.zoom, this.camera.zoom);
        ctx.translate(-this.camera.x, -this.camera.y);

        // Layer 1: Grid
        if (this.showGrid) {
            this._drawGrid(ctx, w, h);
        }

        // Layer 2: Heatmap (under roads)
        if (this.showHeatmap && simState.vehicles) {
            this._drawLiveHeatmap(ctx, cityGraph, simState.vehicles);
        }

        // Layer 3: Roads
        this._drawRoads(ctx, cityGraph);

        // Layer 4: Lane markings
        this._drawLaneMarkings(ctx, cityGraph);

        // Layer 5: Junctions
        this._drawJunctions(ctx, cityGraph, simState);

        // Layer 5.2: Curve handles (editor)
        if (simState.editor) {
            this._drawCurveHandles(ctx, cityGraph, simState.editor);
        }

        // Layer 5.5: AI strategy overlays
        if (simState.aiEnabled && simState.aiState) {
            this._drawAIOverlays(ctx, cityGraph, simState.aiState);
        }

        // Layer 6: Traffic signals
        this._drawSignals(ctx, cityGraph, simState);

        // Layer 7: Vehicles
        if (simState.vehicles) {
            this._drawVehicles(ctx, simState.vehicles);
        }

        // Layer 8: Ghost preview (editor)
        if (this.ghostPreview) {
            this._drawGhostPreview(ctx);
        }
        
        // Layer 8.5: Editor highlights
        if (simState.editor) {
            this._drawEditorHighlights(ctx, simState.editor, cityGraph);
        }

        // Layer 9: Road events (blockages, accidents)
        if (simState.events) {
            this._drawEvents(ctx, simState.events, cityGraph);
        }

        ctx.restore();

        // HUD (screen space, not affected by camera)
        this._drawHUD(ctx, w, h, simState, cityGraph);
    }

    // ─── Drawing Layers ────────────────────────────────────────────

    _drawBackground(ctx, w, h) {
        // Dark gradient background
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, '#0a0e1a');
        gradient.addColorStop(1, '#111827');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    }

    _drawGrid(ctx, w, h) {
        const { zoom, x: cx, y: cy } = this.camera;
        const size = this.gridSize;
        const halfW = w / 2 / zoom;
        const halfH = h / 2 / zoom;

        const startX = Math.floor((cx - halfW) / size) * size;
        const startY = Math.floor((cy - halfH) / size) * size;
        const endX = Math.ceil((cx + halfW) / size) * size;
        const endY = Math.ceil((cy + halfH) / size) * size;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 0.5 / zoom;
        ctx.beginPath();

        for (let x = startX; x <= endX; x += size) {
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y += size) {
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
        }

        ctx.stroke();
    }

    _drawRoads(ctx, cityGraph) {
        // Draw macro road surface
        for (const road of cityGraph.roads.values()) {
            const fromJ = cityGraph.getJunction(road.from);
            const toJ = cityGraph.getJunction(road.to);
            if (!fromJ || !toJ) continue;

            const roadWidth = road.lanes * 14;
            const geom = road.geom;
            const isCurve = geom && geom.p2 !== undefined;
            const isPolyline = geom && geom.points !== undefined;

            // Road shadow
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.lineWidth = roadWidth + 4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            if (isPolyline) {
                ctx.moveTo(geom.points[0].x, geom.points[0].y);
                for (let i = 1; i < geom.points.length; i++) {
                    ctx.lineTo(geom.points[i].x, geom.points[i].y);
                }
            } else if (isCurve) {
                ctx.moveTo(geom.p0.x, geom.p0.y);
                ctx.quadraticCurveTo(geom.p1.x, geom.p1.y, geom.p2.x, geom.p2.y);
            } else {
                ctx.moveTo(fromJ.x, fromJ.y);
                ctx.lineTo(toJ.x, toJ.y);
            }
            ctx.stroke();

            // Road surface
            ctx.strokeStyle = road.blocked ? '#4a1c1c' : '#2a3040';
            ctx.lineWidth = roadWidth;
            ctx.beginPath();
            if (isPolyline) {
                ctx.moveTo(geom.points[0].x, geom.points[0].y);
                for (let i = 1; i < geom.points.length; i++) {
                    ctx.lineTo(geom.points[i].x, geom.points[i].y);
                }
            } else if (isCurve) {
                ctx.moveTo(geom.p0.x, geom.p0.y);
                ctx.quadraticCurveTo(geom.p1.x, geom.p1.y, geom.p2.x, geom.p2.y);
            } else {
                ctx.moveTo(fromJ.x, fromJ.y);
                ctx.lineTo(toJ.x, toJ.y);
            }
            ctx.stroke();
        }
    }

    _drawLaneMarkings(ctx, cityGraph) {
        // Draw physical lanes and intersection curves
        ctx.lineWidth = 1;
        ctx.lineCap = 'butt';
        
        // Solid white outer edges
        for (const road of cityGraph.roads.values()) {
            const fromJ = cityGraph.getJunction(road.from);
            const toJ = cityGraph.getJunction(road.to);
            if (!fromJ || !toJ) continue;
            const roadWidth = road.lanes * 14;
            const geom = road.geom;
            if (!geom || geom.length === 0) continue;
            const half = roadWidth / 2;
            const edgeSteps = Math.max(10, Math.floor(geom.length / 30));

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            this._strokeOffsetGeom(ctx, geom, half, edgeSteps);
            this._strokeOffsetGeom(ctx, geom, -half, edgeSteps);
            
            // Center yellow line for bidirectional
            if (road.bidirectional) {
                ctx.strokeStyle = 'rgba(255, 200, 0, 0.4)';
                ctx.setLineDash([15, 10]);
                this._strokeGeom(ctx, geom, Math.max(12, Math.floor(geom.length / 28)));
                ctx.setLineDash([]);
            }
        }
        
        // Lane dividers (dashed white)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.setLineDash([8, 12]);
        for (const lane of cityGraph.lanes.values()) {
            const geom = lane.geom;
            const isBezier = geom && geom.p2 !== undefined;
            const isPolyline = geom && geom.points !== undefined;

            ctx.beginPath();
            if (isPolyline) {
                ctx.moveTo(geom.points[0].x, geom.points[0].y);
                for (let i = 1; i < geom.points.length; i++) {
                    ctx.lineTo(geom.points[i].x, geom.points[i].y);
                }
            } else if (isBezier) {
                ctx.moveTo(geom.p0.x, geom.p0.y);
                ctx.quadraticCurveTo(geom.p1.x, geom.p1.y, geom.p2.x, geom.p2.y);
            } else {
                ctx.moveTo(geom.p0.x, geom.p0.y);
                ctx.lineTo(geom.p1.x, geom.p1.y);
            }
            ctx.stroke();
        }
        
        // Intersection curves (guide lines)
        ctx.strokeStyle = 'rgba(100, 150, 255, 0.1)';
        for (const conn of cityGraph.connections.values()) {
            ctx.beginPath();
            ctx.moveTo(conn.geom.p0.x, conn.geom.p0.y);
            // Draw bezier
            for (let t = 0; t <= 1; t += 0.1) {
                const pt = conn.geom.getPoint(t);
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    _strokeGeom(ctx, geom, steps = 16) {
        if (!geom || geom.length === 0) return;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const pt = geom.getPoint(t);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
    }

    _strokeOffsetGeom(ctx, geom, offset, steps = 16) {
        if (!geom || geom.length === 0) return;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const pt = geom.getPoint(t);
            const tangent = this._getSmoothTangent(geom, t, steps);
            const normal = { x: -tangent.y, y: tangent.x };
            const ox = pt.x + normal.x * offset;
            const oy = pt.y + normal.y * offset;
            if (i === 0) ctx.moveTo(ox, oy);
            else ctx.lineTo(ox, oy);
        }
        ctx.stroke();
    }

    _getSmoothTangent(geom, t, steps) {
        const eps = Math.max(1 / (steps * 2), 0.002);
        const t0 = Math.max(0, t - eps);
        const t1 = Math.min(1, t + eps);
        if (t0 === t1) return geom.getTangent(t);
        const p0 = geom.getPoint(t0);
        const p1 = geom.getPoint(t1);
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        return { x: dx / len, y: dy / len };
    }

    _drawJunctions(ctx, cityGraph, simState) {
        for (const junction of cityGraph.junctions.values()) {
            const connCount = junction.connections.length;
            const radius = Math.max(12, connCount * 6);

            // Junction body
            ctx.fillStyle = '#1e2a3a';
            ctx.strokeStyle = 'rgba(100, 180, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(junction.x, junction.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            // Draw crossings if any
            if (junction.crossings && junction.crossings.length > 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                for (const crossing of junction.crossings) {
                    ctx.save();
                    ctx.translate(crossing.x, crossing.y);
                    ctx.rotate(crossing.angle);
                    // Zebra stripes
                    for (let w = -crossing.width/2; w < crossing.width/2; w += 4) {
                        ctx.fillRect(w, -8, 2, 16);
                    }
                    ctx.restore();
                }
            }

            if (junction.facility) {
                const badgeRadius = 8;
                const offset = radius + 8;
                const bx = junction.x + offset;
                const by = junction.y - offset;
                const label = junction.facility === 'hospital' ? 'H' : 'F';
                const fill = junction.facility === 'hospital' ? '#0ea5e9' : '#f97316';

                ctx.fillStyle = fill;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(bx, by, badgeRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#0b1220';
                ctx.font = 'bold 9px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, bx, by + 0.5);
            }

            if (junction.metadata && junction.metadata.label) {
                ctx.fillStyle = 'rgba(200, 220, 255, 0.8)';
                const labelSize = Math.max(9, 10 / this.camera.zoom);
                ctx.font = `${labelSize}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(junction.metadata.label, junction.x, junction.y + radius + 6);
            }

            if (simState.spawn && simState.spawn.enabled) {
                if (junction.id === simState.spawn.originId || junction.id === simState.spawn.destinationId) {
                    const isOrigin = junction.id === simState.spawn.originId;
                    ctx.save();
                    ctx.strokeStyle = isOrigin ? 'rgba(34, 197, 94, 0.9)' : 'rgba(59, 130, 246, 0.9)';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([6, 6]);
                    ctx.lineDashOffset = -this._animTime * 18;
                    ctx.beginPath();
                    ctx.arc(junction.x, junction.y, radius + 8, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                }
            }
        }
    }

    _drawSignals(ctx, cityGraph, simState) {
        if (!simState.signals) return;

        // Draw stop lines on lanes approaching signalized junctions
        for (const [junctionId] of Object.entries(simState.signals)) {
            for (const lane of cityGraph.lanes.values()) {
                if (lane.endNode !== junctionId) continue;
                
                const length = lane.geom.length;
                if (length < 20) continue; // too short
                
                // Stop line near the signalized junction (matches Vehicle.js clamp)
                const stopT = Math.max(0, (length - 6) / length);
                const pt = lane.geom.getPoint(stopT);
                const tangent = lane.geom.getTangent(stopT);
                const normal = { x: -tangent.y, y: tangent.x };
                
                // Draw thick white stop line perpendicular to lane
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(pt.x + normal.x * 8, pt.y + normal.y * 8);
                ctx.lineTo(pt.x - normal.x * 8, pt.y - normal.y * 8);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        }

        for (const [junctionId, signal] of Object.entries(simState.signals)) {
            const junction = cityGraph.getJunction(junctionId);
            if (!junction) continue;

            const radius = Math.max(12, junction.connections.length * 6);

            for (const lane of cityGraph.lanes.values()) {
                if (lane.endNode !== junctionId) continue;
                
                // Signal is placed at the end of the incoming lane, offset to the left side
                const t = 1.0;
                const pt = lane.geom.getPoint(t);
                const tangent = lane.geom.getTangent(t);
                const normal = { x: -tangent.y, y: tangent.x }; // Left side normal
                
                const offsetDistance = 10;
                const signalX = pt.x + normal.x * offsetDistance;
                const signalY = pt.y + normal.y * offsetDistance;

                // Lane-level phase or fallback
                const phase = signal.phases && signal.phases[lane.id] ? signal.phases[lane.id] : signal.state || 'red';
                
                // Draw traffic light housing
                ctx.save();
                ctx.translate(signalX, signalY);
                // Rotate to face oncoming traffic
                ctx.rotate(Math.atan2(tangent.y, tangent.x) + Math.PI); 

                // Box
                ctx.fillStyle = '#111';
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 1;
                ctx.fillRect(-6, -14, 12, 28);
                ctx.strokeRect(-6, -14, 12, 28);
                
                // Lights
                const drawLight = (y, color, isOn) => {
                    ctx.fillStyle = isOn ? color : '#222';
                    ctx.beginPath();
                    ctx.arc(0, y, 3, 0, Math.PI * 2);
                    ctx.fill();
                    if (isOn) {
                        const glow = ctx.createRadialGradient(0, y, 0, 0, y, 10);
                        glow.addColorStop(0, color.replace(')', ', 0.5)').replace('rgb', 'rgba'));
                        glow.addColorStop(1, 'rgba(0,0,0,0)');
                        ctx.fillStyle = glow;
                        ctx.beginPath();
                        ctx.arc(0, y, 10, 0, Math.PI * 2);
                        ctx.fill();
                    }
                };

                drawLight(-9, 'rgb(255, 50, 50)', phase === 'red');
                drawLight(0, 'rgb(255, 200, 0)', phase === 'yellow');
                drawLight(9, 'rgb(0, 255, 100)', phase === 'green');
                
                ctx.restore();

                // Draw Timer
                const timeLeft = signal.timers && signal.timers[lane.id] !== undefined ? signal.timers[lane.id] : 0;
                ctx.fillStyle = phase === 'green' ? '#00ff64' : (phase === 'yellow' ? '#ffc800' : '#ff3232');
                const fontSize = Math.max(9, 10 / this.camera.zoom);
                ctx.font = `bold ${fontSize}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${timeLeft}s`, signalX + normal.x * 12, signalY + normal.y * 12);
            }
        }
    }

    _drawAIOverlays(ctx, cityGraph, aiState) {
        const hints = aiState.laneSpeedHints || {};

        for (const [laneId, hint] of Object.entries(hints)) {
            const lane = cityGraph.lanes.get(laneId);
            if (!lane || !hint) continue;

            const isGreenWave = hint.reason === 'Green wave';
            const isSlowZone = hint.reason === 'Spillback slow zone';
            if (!isGreenWave && !isSlowZone) continue;
            const geom = lane.geom;
            const mid = geom.getPoint(0.56);
            const tangent = geom.getTangent(0.56);
            const color = isGreenWave ? 'rgba(34, 197, 94, 0.72)' : 'rgba(245, 158, 11, 0.82)';

            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = isGreenWave ? 3 : 4;
            ctx.setLineDash(isGreenWave ? [12, 10] : [4, 7]);
            ctx.lineDashOffset = -this._animTime * (isGreenWave ? 26 : 12);
            ctx.beginPath();
            const steps = geom.points ? Math.max(16, geom.points.length * 6) : 16;
            for (let i = 0; i <= steps; i++) {
                const t = 0.08 + (0.84 * (i / steps));
                const pt = geom.getPoint(t);
                if (i === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.translate(mid.x, mid.y);
            ctx.rotate(Math.atan2(tangent.y, tangent.x));
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(9, 0);
            ctx.lineTo(-5, -5);
            ctx.lineTo(-2, 0);
            ctx.lineTo(-5, 5);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        for (const [junctionId, strategy] of Object.entries(aiState.signalStrategies || {})) {
            const junction = cityGraph.getJunction(junctionId);
            if (!junction || !strategy || strategy.bestScore <= 0) continue;

            const pulse = 0.55 + Math.sin(this._animTime * 4) * 0.18;
            const color = strategy.reason === 'Spillback guard'
                ? `rgba(245, 158, 11, ${pulse})`
                : `rgba(34, 197, 94, ${pulse})`;

            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.arc(junction.x, junction.y, Math.max(24, junction.connections.length * 8), 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }
    }

    _drawCurveHandles(ctx, cityGraph, editorState) {
        const showHandles = editorState.activeTool === 'CURVE';
        if (!showHandles) return;

        for (const road of cityGraph.roads.values()) {
            if (!road.controlPoints || road.controlPoints.length === 0) continue;

            ctx.save();
            ctx.strokeStyle = 'rgba(96, 165, 250, 0.35)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 6]);
            ctx.beginPath();

            const fromJ = cityGraph.getJunction(road.from);
            if (fromJ) ctx.moveTo(fromJ.x, fromJ.y);

            for (const cp of road.controlPoints) {
                ctx.lineTo(cp.x, cp.y);
            }

            const toJ = cityGraph.getJunction(road.to);
            if (toJ) ctx.lineTo(toJ.x, toJ.y);
            ctx.stroke();
            ctx.setLineDash([]);

            for (const cp of road.controlPoints) {
                ctx.fillStyle = 'rgba(96, 165, 250, 0.9)';
                ctx.strokeStyle = '#dbeafe';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    _drawVehicles(ctx, vehicles) {
        for (const vehicle of vehicles) {
            if (!vehicle.visible) continue;

            const { x, y, angle, type, color, speed, state } = vehicle;
            const isWaiting = state === 'waiting';
            const isSlow = (speed !== undefined) ? speed < 5 : false;

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle || 0);

            // Vehicle sizes by type
            let vw, vh;
            switch (type) {
                case 'BUS':
                    vw = 24; vh = 10;
                    break;
                case 'AMBULANCE':
                case 'FIRE_TRUCK':
                    vw = 20; vh = 9;
                    break;
                default: // CAR
                    vw = 16; vh = 8;
            }

            // Waiting glow effect — subtle red pulse when stopped at signal
            if (isWaiting) {
                const pulse = 0.3 + 0.15 * Math.sin(this._animTime * 4);
                const glow = ctx.createRadialGradient(0, 0, vw * 0.3, 0, 0, vw * 1.5);
                glow.addColorStop(0, `rgba(255, 60, 60, ${pulse})`);
                glow.addColorStop(1, 'rgba(255, 60, 60, 0)');
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(0, 0, vw * 1.5, 0, Math.PI * 2);
                ctx.fill();
            }

            // Vehicle shadow
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.beginPath();
            ctx.roundRect(-vw / 2 + 2, -vh / 2 + 2, vw, vh, 2);
            ctx.fill();

            // Vehicle body — darken slightly when stopped
            const bodyColor = isWaiting ? this._darkenColor(color || this._getVehicleColor(type), 0.7) 
                                        : (color || this._getVehicleColor(type));
            ctx.fillStyle = bodyColor;
            ctx.beginPath();
            ctx.roundRect(-vw / 2, -vh / 2, vw, vh, 2);
            ctx.fill();

            // Subtle top highlight for 3D look
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.beginPath();
            ctx.roundRect(-vw / 2 + 1, -vh / 2 + 1, vw - 2, vh / 3, 1);
            ctx.fill();

            // Windshield
            ctx.fillStyle = 'rgba(20, 20, 20, 0.8)';
            ctx.beginPath();
            ctx.roundRect(vw / 4 - 2, -vh / 2 + 1, 4, vh - 2, 1);
            ctx.fill();
            // Rear window
            ctx.beginPath();
            ctx.roundRect(-vw / 2 + 2, -vh / 2 + 1.5, 3, vh - 3, 1);
            ctx.fill();

            // Headlights (front) — brighter when moving
            const headlightAlpha = isWaiting ? 0.4 : 0.9;
            ctx.fillStyle = `rgba(255, 255, 200, ${headlightAlpha})`;
            ctx.fillRect(vw / 2 - 2, -vh / 2 + 1, 2, 2);
            ctx.fillRect(vw / 2 - 2, vh / 2 - 3, 2, 2);
            
            // Taillights (rear) — bright red when braking/waiting
            if (isWaiting || isSlow) {
                ctx.fillStyle = 'rgba(255, 20, 20, 1.0)';
                ctx.shadowColor = 'rgba(255, 0, 0, 0.6)';
                ctx.shadowBlur = 6;
            } else {
                ctx.fillStyle = 'rgba(150, 0, 0, 0.8)';
                ctx.shadowBlur = 0;
            }
            ctx.fillRect(-vw / 2, -vh / 2 + 1, 1.5, 2);
            ctx.fillRect(-vw / 2, vh / 2 - 3, 1.5, 2);
            ctx.shadowBlur = 0;

            // Turn indicator flash for waiting vehicles
            if (isWaiting) {
                const blink = Math.sin(this._animTime * 6) > 0;
                if (blink) {
                    ctx.fillStyle = 'rgba(255, 165, 0, 0.8)';
                    ctx.fillRect(-vw / 2, -vh / 2, 1.5, 1.5);
                    ctx.fillRect(-vw / 2, vh / 2 - 1.5, 1.5, 1.5);
                }
            }

            // Emergency flash
            if ((type === 'AMBULANCE' || type === 'FIRE_TRUCK') && Math.sin(this._animTime * 15) > 0) {
                const flashGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
                flashGlow.addColorStop(0, type === 'AMBULANCE' ? 'rgba(255,50,50,0.4)' : 'rgba(255,150,50,0.4)');
                flashGlow.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = flashGlow;
                ctx.beginPath();
                ctx.arc(0, 0, 20, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        }
    }

    _darkenColor(hex, factor) {
        // Darken a hex color by a factor (0-1)
        if (!hex || hex.charAt(0) !== '#') return hex;
        let r = parseInt(hex.slice(1, 3), 16);
        let g = parseInt(hex.slice(3, 5), 16);
        let b = parseInt(hex.slice(5, 7), 16);
        r = Math.round(r * factor);
        g = Math.round(g * factor);
        b = Math.round(b * factor);
        return `rgb(${r},${g},${b})`;
    }

    _getVehicleColor(type) {
        switch (type) {
            case 'BUS': return '#f59e0b';
            case 'AMBULANCE': return '#ef4444';
            case 'FIRE_TRUCK': return '#dc2626';
            default: {
                // Random-ish but deterministic colors for cars
                const colors = ['#60a5fa', '#a78bfa', '#34d399', '#f472b6', '#818cf8', '#67e8f9', '#fbbf24'];
                return colors[Math.floor(Math.random() * colors.length)];
            }
        }
    }

    _drawEditorHighlights(ctx, editorState, cityGraph) {
        // Highlight road
        if (editorState.hoveredRoad) {
            const road = editorState.hoveredRoad;
            const fromJ = cityGraph.getJunction(road.from);
            const toJ = cityGraph.getJunction(road.to);
            if (fromJ && toJ) {
                const isDelete = editorState.activeTool === 'DELETE';
                ctx.strokeStyle = isDelete ? 'rgba(255, 50, 50, 0.4)' : 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = (road.lanes * 14) + 6;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(fromJ.x, fromJ.y);
                ctx.lineTo(toJ.x, toJ.y);
                ctx.stroke();
            }
        }

        // Highlight junction
        const activeJunction = editorState.draggedJunction || editorState.hoveredJunction;
        if (activeJunction) {
            const isDelete = editorState.activeTool === 'DELETE' && !editorState.draggedJunction;
            const isDrag = !!editorState.draggedJunction;
            
            const radius = Math.max(16, activeJunction.connections.length * 6 + 6);
            
            ctx.strokeStyle = isDelete ? '#ff3232' : isDrag ? '#60a5fa' : '#ffffff';
            ctx.lineWidth = isDrag ? 4 : 2;
            
            if (isDrag) {
                ctx.setLineDash([6, 6]);
                ctx.lineDashOffset = -this._animTime * 20;
            }
            
            ctx.beginPath();
            ctx.arc(activeJunction.x, activeJunction.y, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    _drawGhostPreview(ctx) {
        const gp = this.ghostPreview;
        if (!gp) return;

        ctx.globalAlpha = 0.5;

        if (gp.type === 'junction') {
            ctx.fillStyle = '#60a5fa';
            ctx.strokeStyle = '#93c5fd';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(gp.x, gp.y, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (gp.type === 'roundabout') {
            ctx.fillStyle = 'rgba(96, 165, 250, 0.2)';
            ctx.strokeStyle = '#93c5fd';
            ctx.lineWidth = 2;
            
            ctx.beginPath();
            ctx.arc(gp.x, gp.y, 50, 0, Math.PI * 2);
            ctx.stroke();
            
            const pts = [
                {x: gp.x, y: gp.y - 50},
                {x: gp.x + 50, y: gp.y},
                {x: gp.x, y: gp.y + 50},
                {x: gp.x - 50, y: gp.y}
            ];
            pts.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
        } else if (gp.type === 'road' && gp.fromJunction) {
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 20;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(gp.fromJunction.x, gp.fromJunction.y);
            ctx.lineTo(gp.x, gp.y);
            ctx.stroke();
        } else if (gp.type === 'curve') {
            ctx.fillStyle = 'rgba(96, 165, 250, 0.6)';
            ctx.strokeStyle = '#93c5fd';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(gp.x, gp.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (gp.type === 'facility') {
            const label = gp.facility === 'hospital' ? 'H' : 'F';
            const fill = gp.facility === 'hospital' ? '#0ea5e9' : '#f97316';
            ctx.fillStyle = fill;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(gp.x, gp.y, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#0b1220';
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, gp.x, gp.y + 0.5);
        }

        ctx.globalAlpha = 1;
    }

    _drawLiveHeatmap(ctx, cityGraph, vehicles) {
        if (!vehicles || vehicles.length === 0) return;

        // Count vehicles per road
        const counts = {};
        for (const v of vehicles) {
            if (v.geomType === 'lane') {
                const lane = cityGraph.lanes.get(v.currentGeomId);
                if (lane) {
                    counts[lane.roadId] = (counts[lane.roadId] || 0) + 1;
                }
            }
        }

        for (const road of cityGraph.roads.values()) {
            const count = counts[road.id] || 0;
            // Density based on length and lanes
            const capacity = (road.length / 20) * road.lanes;
            let density = count / capacity;
            if (density <= 0.1) continue; // Only show if traffic is building up
            
            density = Math.min(1, density * 1.5);

            const fromJ = cityGraph.getJunction(road.from);
            const toJ = cityGraph.getJunction(road.to);
            if (!fromJ || !toJ) continue;

            const r = 255;
            const g = Math.floor(255 * (1 - density));
            const alpha = 0.2 + (density * 0.4);

            ctx.strokeStyle = `rgba(${r}, ${g}, 0, ${alpha})`;
            ctx.lineWidth = road.lanes * 14 + 16; // Wider glow
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(fromJ.x, fromJ.y);
            ctx.lineTo(toJ.x, toJ.y);
            ctx.stroke();
        }
    }

    _drawEvents(ctx, events, cityGraph) {
        for (const event of events) {
            if (event.type === 'blockage' || event.type === 'accident') {
                const road = cityGraph.roads.get(event.roadId);
                if (!road) continue;
                const fromJ = cityGraph.getJunction(road.from);
                const toJ = cityGraph.getJunction(road.to);
                if (!fromJ || !toJ) continue;

                const mx = (fromJ.x + toJ.x) / 2;
                const my = (fromJ.y + toJ.y) / 2;

                // Warning icon
                const pulse = 1 + Math.sin(this._animTime * 4) * 0.15;
                ctx.fillStyle = event.type === 'accident' ? 'rgba(255, 50, 50, 0.6)' : 'rgba(255, 150, 0, 0.6)';
                ctx.beginPath();
                ctx.arc(mx, my, 10 * pulse, 0, Math.PI * 2);
                ctx.fill();

                // Warning triangle
                ctx.fillStyle = '#fff';
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('⚠', mx, my);
            }

            if (event.type === 'rain') {
                // Rain overlay is handled in HUD
            }
        }
    }

    _drawHUD(ctx, w, h, simState, cityGraph) {
        // Mode indicator
        const mode = simState.mode || 'EDITOR';
        ctx.fillStyle = mode === 'SIMULATION' ? 'rgba(0, 255, 100, 0.15)' : 'rgba(100, 150, 255, 0.15)';
        ctx.fillRect(0, 0, w, 3);

        // Stats overlay (top-left)
        ctx.save();
        ctx.fillStyle = 'rgba(10, 15, 30, 0.7)';
        ctx.fillRect(10, 10, 180, 65);
        ctx.strokeStyle = 'rgba(100, 150, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(10, 10, 180, 65);

        ctx.fillStyle = 'rgba(200, 220, 255, 0.8)';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'left';

        const stats = cityGraph.getStats();
        const vehicleCount = simState.vehicles ? simState.vehicles.length : 0;
        ctx.fillText(`Junctions: ${stats.junctions}  |  Roads: ${stats.roads}`, 20, 28);
        ctx.fillText(`Vehicles: ${vehicleCount}  |  Signals: ${stats.signalizedJunctions}`, 20, 44);
        ctx.fillText(`Zoom: ${(this.camera.zoom * 100).toFixed(0)}%  |  Mode: ${mode}`, 20, 60);

        ctx.restore();

        if (simState.spawn && simState.spawn.enabled) {
            ctx.save();
            ctx.fillStyle = 'rgba(10, 15, 30, 0.7)';
            ctx.fillRect(10, 80, 230, 44);
            ctx.strokeStyle = 'rgba(100, 150, 255, 0.2)';
            ctx.strokeRect(10, 80, 230, 44);

            ctx.fillStyle = 'rgba(200, 220, 255, 0.8)';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'left';
            const hint = simState.spawn.originId ? 'Select destination junction' : 'Select origin junction';
            ctx.fillText(`Click Spawn: ${simState.spawn.vehicleType || 'CAR'}`, 20, 98);
            ctx.fillText(hint, 20, 114);
            ctx.restore();
        }

        // Rain overlay effect
        if (simState.events && simState.events.some(e => e.type === 'rain')) {
            ctx.fillStyle = 'rgba(80, 100, 150, 0.08)';
            ctx.fillRect(0, 0, w, h);

            // Rain drops
            ctx.strokeStyle = 'rgba(150, 180, 220, 0.15)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 60; i++) {
                const rx = ((this._animTime * 50 + i * 37) % (w + 40)) - 20;
                const ry = ((this._animTime * 200 + i * 53) % (h + 40)) - 20;
                ctx.beginPath();
                ctx.moveTo(rx, ry);
                ctx.lineTo(rx - 3, ry + 12);
                ctx.stroke();
            }
        }
    }

    // ─── Cleanup ───────────────────────────────────────────────────

    destroy() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
    }
}
