/**
 * EditorController — Interactive city editor tools.
 * Handles tool selection, mouse events, junction/road placement, and undo/redo.
 */
import { Events } from '../core/EventBus.js';
import { FacilityType, JunctionType, RoadType } from '../core/CityGraph.js';
import { GridSystem } from './GridSystem.js';

// Tool modes
export const Tools = {
    SELECT: 'SELECT',
    JUNCTION: 'JUNCTION',
    ROAD: 'ROAD',
    ROUNDABOUT: 'ROUNDABOUT',
    SIGNAL: 'SIGNAL',
    HOSPITAL: 'HOSPITAL',
    FIRE_STATION: 'FIRE_STATION',
    DELETE: 'DELETE',
};

export class EditorController {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import('../core/CityGraph.js').CityGraph} cityGraph
     * @param {import('../core/Renderer.js').Renderer} renderer
     * @param {import('../core/EventBus.js').EventBus} eventBus
     */
    constructor(canvas, cityGraph, renderer, eventBus) {
        this.canvas = canvas;
        this.cityGraph = cityGraph;
        this.renderer = renderer;
        this.eventBus = eventBus;
        this.grid = new GridSystem(50);

        this.activeTool = Tools.SELECT;
        this.enabled = true;

        // Road drawing state
        this._roadStartJunction = null;

        // Pan state
        this._isPanning = false;
        this._lastMouse = { x: 0, y: 0 };
        this._pointerDown = null;
        this._spacePanActive = false;
        this._lastPointerWasDrag = false;
        this._dragThreshold = 4;

        // Hover state
        this.hoveredJunction = null;
        this.hoveredRoad = null;
        this.draggedJunction = null;
        this._dragCandidateJunction = null;

        // Undo/Redo
        this._undoStack = [];
        this._redoStack = [];
        this._maxHistory = 50;

        this._bindEvents();
        this._updateCursor();
    }

    // ─── Tool Selection ────────────────────────────────────────────

    setTool(tool) {
        this.activeTool = tool;
        this._roadStartJunction = null;
        this.renderer.ghostPreview = null;
        this.draggedJunction = null;
        this.eventBus.emit(Events.TOOL_CHANGED, { tool });

        this._updateCursor();
    }

    // ─── Event Binding ─────────────────────────────────────────────

    _bindEvents() {
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        window.addEventListener('mousemove', (e) => this._onMouseMove(e));
        window.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('keydown', (e) => {
            if (!this.enabled || e.code !== 'Space' || this._isTypingTarget(e.target)) return;
            this._spacePanActive = true;
            if (!this._isPanning) this.canvas.style.cursor = 'grab';
        });
        window.addEventListener('keyup', (e) => {
            if (e.code !== 'Space') return;
            this._spacePanActive = false;
            this._updateCursor();
        });

        // Touch support for mobile
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this._onMouseDown({ clientX: touch.clientX, clientY: touch.clientY, button: 0 });
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this._onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
        });
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this._onMouseUp({ button: 0 });
        });
    }

    _onMouseDown(e) {
        if (!this._isCanvasEvent(e)) return;

        const worldPos = this.renderer.screenToWorld(e.clientX, e.clientY);
        const shouldPan = this._shouldStartPan(e);

        this._pointerDown = {
            button: e.button,
            startX: e.clientX,
            startY: e.clientY,
            lastX: e.clientX,
            lastY: e.clientY,
            worldPos,
            action: shouldPan ? 'pan' : 'tool',
            moved: false,
        };
        this._lastPointerWasDrag = false;

        if (shouldPan) {
            e.preventDefault();
            this._isPanning = true;
            this._lastMouse = { x: e.clientX, y: e.clientY };
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        if (!this.enabled) return;

        if (this.activeTool === Tools.SELECT) {
            if (this.hoveredJunction) {
                this._dragCandidateJunction = this.hoveredJunction;
                this.canvas.style.cursor = 'grab';
            } else {
                this._isPanning = true;
                this._pointerDown.action = 'pan';
                this._lastMouse = { x: e.clientX, y: e.clientY };
                this.canvas.style.cursor = 'grabbing';
            }
        }
    }

    _onMouseMove(e) {
        if (!this.enabled && !this._pointerDown) return;
        if (!this._pointerDown && !this._isCanvasEvent(e)) return;

        const worldPos = this.renderer.screenToWorld(e.clientX, e.clientY);
        const pointer = this._pointerDown;

        if (pointer) {
            const movedDistance = Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY);
            if (movedDistance >= this._dragThreshold) {
                pointer.moved = true;
                this._lastPointerWasDrag = true;
            }
        }

        // Handle panning
        if (this._isPanning) {
            const dx = e.clientX - this._lastMouse.x;
            const dy = e.clientY - this._lastMouse.y;
            this.renderer.pan(dx, dy);
            this._lastMouse = { x: e.clientX, y: e.clientY };
            return;
        }

        if (!this.enabled) return;

        if (this._dragCandidateJunction && pointer?.moved && !this.draggedJunction) {
            this._saveUndo();
            this.draggedJunction = this._dragCandidateJunction;
            this._dragCandidateJunction = null;
            this.canvas.style.cursor = 'grabbing';
        }

        // Handle Dragging Junction
        if (this.draggedJunction) {
            const snapped = this.grid.snap(worldPos.x, worldPos.y);
            this.draggedJunction.x = snapped.x;
            this.draggedJunction.y = snapped.y;
            this.cityGraph.rebuildGeometry();
            return;
        }

        // Update hover state
        const junctionHoverRadius = this.activeTool === Tools.SIGNAL ? 45 : 25;
        this.hoveredJunction = this.cityGraph.findJunctionNear(worldPos.x, worldPos.y, junctionHoverRadius);
        this.hoveredRoad = this.hoveredJunction ? null : this._findRoadNear(worldPos.x, worldPos.y, 15);

        // Update cursor based on hover
        this._updateCursor(worldPos);

        // Ghost preview for placement tools
        if (this.activeTool === Tools.JUNCTION) {
            const snapped = this.grid.snap(worldPos.x, worldPos.y);
            this.renderer.ghostPreview = { type: 'junction', x: snapped.x, y: snapped.y };
        } else if (this.activeTool === Tools.ROUNDABOUT) {
            const snapped = this.grid.snap(worldPos.x, worldPos.y);
            this.renderer.ghostPreview = { type: 'roundabout', x: snapped.x, y: snapped.y };
        } else if (this.activeTool === Tools.HOSPITAL || this.activeTool === Tools.FIRE_STATION) {
            const snapped = this.grid.snap(worldPos.x, worldPos.y);
            this.renderer.ghostPreview = {
                type: 'facility',
                x: snapped.x,
                y: snapped.y,
                facility: this.activeTool === Tools.HOSPITAL ? FacilityType.HOSPITAL : FacilityType.FIRE_STATION
            };
        } else if (this.activeTool === Tools.ROAD && this._roadStartJunction) {
            // Magnetic snap to hovered junction if it exists
            const targetX = this.hoveredJunction ? this.hoveredJunction.x : worldPos.x;
            const targetY = this.hoveredJunction ? this.hoveredJunction.y : worldPos.y;
            this.renderer.ghostPreview = {
                type: 'road',
                fromJunction: this._roadStartJunction,
                x: targetX,
                y: targetY,
            };
        } else {
            this.renderer.ghostPreview = null;
        }
    }

    _onMouseUp(e) {
        const pointer = this._pointerDown;
        const shouldRunClickAction = pointer &&
            pointer.action === 'tool' &&
            !pointer.moved &&
            this.enabled &&
            e.button === pointer.button;

        if (this._isPanning) {
            this._isPanning = false;
        }
        if (this.draggedJunction) {
            this.eventBus.emit(Events.CITY_CHANGED, { reason: 'junction:moved' });
            this.draggedJunction = null;
        }

        if (shouldRunClickAction) {
            this._runToolAction(pointer.worldPos);
        }

        this._pointerDown = null;
        this._dragCandidateJunction = null;
        this._updateCursor();
    }

    _runToolAction(worldPos) {
        switch (this.activeTool) {
            case Tools.SELECT:
                break;

            case Tools.JUNCTION:
                this._placeJunction(worldPos);
                break;

            case Tools.ROAD:
                this._handleRoadClick(worldPos);
                break;

            case Tools.ROUNDABOUT:
                this._placeRoundabout(worldPos);
                break;

            case Tools.SIGNAL:
                this._toggleSignal(worldPos);
                break;

            case Tools.HOSPITAL:
                this._placeFacility(worldPos, FacilityType.HOSPITAL);
                break;

            case Tools.FIRE_STATION:
                this._placeFacility(worldPos, FacilityType.FIRE_STATION);
                break;

            case Tools.DELETE:
                this._deleteAt(worldPos);
                break;
        }
    }

    _onWheel(e) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        this.renderer.zoom(factor, e.clientX, e.clientY);
    }

    _shouldStartPan(e) {
        if (!this.enabled) return e.button === 0 || e.button === 1 || e.button === 2;
        return e.button === 1 || e.button === 2 || e.altKey || this._spacePanActive;
    }

    _isCanvasEvent(e) {
        return !e.target || e.target === this.canvas;
    }

    _isTypingTarget(target) {
        if (!target) return false;
        const tag = target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    _updateCursor(worldPos = null) {
        if (this._isPanning) {
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        if (this._spacePanActive) {
            this.canvas.style.cursor = 'grab';
            return;
        }

        if (!this.enabled) {
            this.canvas.style.cursor = 'grab';
            return;
        }

        switch (this.activeTool) {
            case Tools.SELECT:
                this.canvas.style.cursor = this.hoveredJunction ? 'grab' : 'grab';
                break;
            case Tools.SIGNAL:
                this.canvas.style.cursor = !worldPos || this._findSignalTarget(worldPos) ? 'pointer' : 'not-allowed';
                break;
            case Tools.JUNCTION:
            case Tools.ROAD:
            case Tools.ROUNDABOUT:
            case Tools.HOSPITAL:
            case Tools.FIRE_STATION:
                this.canvas.style.cursor = 'crosshair';
                break;
            case Tools.DELETE:
                this.canvas.style.cursor = 'cell';
                break;
            default:
                this.canvas.style.cursor = 'grab';
        }
    }

    wasLastPointerDrag() {
        return this._lastPointerWasDrag;
    }

    // ─── Tool Actions ──────────────────────────────────────────────

    _placeJunction(worldPos) {
        const snapped = this.grid.snap(worldPos.x, worldPos.y);

        // Check if we are dropping onto an existing road
        const existingRoad = this._findRoadNear(snapped.x, snapped.y, 15);
        let finalX = snapped.x;
        let finalY = snapped.y;

        if (existingRoad) {
            const fromJ = this.cityGraph.getJunction(existingRoad.from);
            const toJ = this.cityGraph.getJunction(existingRoad.to);
            const closest = this._getClosestPointOnSegment(snapped.x, snapped.y, fromJ.x, fromJ.y, toJ.x, toJ.y);
            finalX = closest.x;
            finalY = closest.y;
        }

        // Check if junction already exists nearby
        const existing = this.cityGraph.findJunctionNear(finalX, finalY, 20);
        if (existing) return;

        this._saveUndo();
        const newJId = this.cityGraph.addJunction(finalX, finalY, JunctionType.INTERSECTION);

        if (existingRoad) {
            const rFrom = existingRoad.from;
            const rTo = existingRoad.to;
            const config = {
                type: existingRoad.type,
                lanes: existingRoad.lanes,
                speedLimit: existingRoad.speedLimit,
                bidirectional: existingRoad.bidirectional
            };
            // Split the road
            this.cityGraph.removeRoad(existingRoad.id);
            this.cityGraph.addRoad(rFrom, newJId, config);
            this.cityGraph.addRoad(newJId, rTo, config);
        }
        this.eventBus.emit(Events.CITY_CHANGED, { reason: 'junction:placed' });
    }

    _placeFacility(worldPos, facilityType) {
        const snapped = this.grid.snap(worldPos.x, worldPos.y);
        let target = this.cityGraph.findJunctionNear(snapped.x, snapped.y, 30);

        this._saveUndo();

        if (!target) {
            const newJId = this.cityGraph.addJunction(snapped.x, snapped.y, JunctionType.INTERSECTION);
            target = this.cityGraph.getJunction(newJId);
        }

        if (!target) return;

        target.facility = facilityType;
        this.eventBus.emit(Events.CITY_CHANGED, { reason: 'facility:placed' });
    }

    _placeRoundabout(worldPos) {
        const snapped = this.grid.snap(worldPos.x, worldPos.y);

        // Check if there is space
        if (this.cityGraph.findJunctionNear(snapped.x, snapped.y, 40)) return;

        this._saveUndo();
        const radius = 50; 

        const jN = this.cityGraph.addJunction(snapped.x, snapped.y - radius, JunctionType.ROUNDABOUT);
        const jE = this.cityGraph.addJunction(snapped.x + radius, snapped.y, JunctionType.ROUNDABOUT);
        const jS = this.cityGraph.addJunction(snapped.x, snapped.y + radius, JunctionType.ROUNDABOUT);
        const jW = this.cityGraph.addJunction(snapped.x - radius, snapped.y, JunctionType.ROUNDABOUT);

        const config = {
            type: RoadType.NORMAL,
            lanes: 2,
            speedLimit: 40,
            bidirectional: false // One-way loop
        };

        // Clockwise connections for LHD
        this.cityGraph.addRoad(jN, jE, config);
        this.cityGraph.addRoad(jE, jS, config);
        this.cityGraph.addRoad(jS, jW, config);
        this.cityGraph.addRoad(jW, jN, config);
        this.eventBus.emit(Events.CITY_CHANGED, { reason: 'roundabout:placed' });
    }

    _handleRoadClick(worldPos) {
        const junction = this.cityGraph.findJunctionNear(worldPos.x, worldPos.y, 30);

        if (!junction) {
            // Clicked empty space — cancel road drawing
            this._roadStartJunction = null;
            this.renderer.ghostPreview = null;
            return;
        }

        if (!this._roadStartJunction) {
            // First click — set start junction
            this._roadStartJunction = junction;
        } else {
            // Second click — create road
            if (junction.id !== this._roadStartJunction.id) {
                this._saveUndo();
                this.cityGraph.addRoad(this._roadStartJunction.id, junction.id);
                this.eventBus.emit(Events.CITY_CHANGED, { reason: 'road:placed' });
            }
            this._roadStartJunction = null;
            this.renderer.ghostPreview = null;
        }
    }

    _toggleSignal(worldPos) {
        const junction = this._findSignalTarget(worldPos);
        if (!junction) return;

        if (junction.signalState) {
            // Signal exists — open configuration panel
            this.eventBus.emit(Events.SIGNAL_SELECTED, { junctionId: junction.id });
        } else {
            // Add signal with default phases
            this._saveUndo();
            junction.signalState = {
                currentPhase: 0,
                timer: 0,
                state: 'green',
            };
            // Create phases based on connected roads
            const roads = this.cityGraph.getRoadsAt(junction.id);
            const phases = {};
            roads.forEach((road, i) => {
                phases[road.id] = i % 2 === 0 ? 'green' : 'red';
            });
            junction.signalPhases = phases;
            
            // Allow setting specific timings per junction
            junction.signalConfig = {
                greenDuration: window.DEFAULT_GREEN_TIME || 20,
                yellowDuration: window.DEFAULT_YELLOW_TIME || 3
            };

            this.eventBus.emit(Events.SIGNAL_CHANGED, { junctionId: junction.id });
            this.eventBus.emit(Events.SIGNAL_SELECTED, { junctionId: junction.id });
            this.eventBus.emit(Events.CITY_CHANGED, { reason: 'signal:added' });
        }
    }

    _deleteAt(worldPos) {
        // Try to delete junction first
        const junction = this.cityGraph.findJunctionNear(worldPos.x, worldPos.y, 30);
        if (junction) {
            this._saveUndo();
            this.cityGraph.removeJunction(junction.id);
            this.eventBus.emit(Events.CITY_CHANGED, { reason: 'junction:deleted' });
            return;
        }

        // Try to delete road
        const road = this._findRoadNear(worldPos.x, worldPos.y, 15);
        if (road) {
            this._saveUndo();
            this.cityGraph.removeRoad(road.id);
            this.eventBus.emit(Events.CITY_CHANGED, { reason: 'road:deleted' });
        }
    }

    _findSignalTarget(worldPos) {
        const directJunction = this.cityGraph.findJunctionNear(worldPos.x, worldPos.y, 45);
        if (directJunction) return directJunction;

        const road = this._findRoadNear(worldPos.x, worldPos.y, 18);
        if (!road) return null;

        const fromJ = this.cityGraph.getJunction(road.from);
        const toJ = this.cityGraph.getJunction(road.to);
        if (!fromJ || !toJ) return null;

        const fromDist = Math.hypot(worldPos.x - fromJ.x, worldPos.y - fromJ.y);
        const toDist = Math.hypot(worldPos.x - toJ.x, worldPos.y - toJ.y);
        const nearest = fromDist <= toDist ? fromJ : toJ;
        return Math.min(fromDist, toDist) <= 70 ? nearest : null;
    }

    _findRoadNear(x, y, threshold) {
        let nearest = null;
        let nearestDist = threshold;

        for (const road of this.cityGraph.roads.values()) {
            const fromJ = this.cityGraph.getJunction(road.from);
            const toJ = this.cityGraph.getJunction(road.to);
            if (!fromJ || !toJ) continue;

            const pt = this._getClosestPointOnSegment(x, y, fromJ.x, fromJ.y, toJ.x, toJ.y);
            const dist = Math.sqrt((x - pt.x) ** 2 + (y - pt.y) ** 2);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = road;
            }
        }
        return nearest;
    }

    _getClosestPointOnSegment(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return { x: ax, y: ay };

        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));

        return {
            x: ax + t * dx,
            y: ay + t * dy
        };
    }

    // ─── Undo/Redo ─────────────────────────────────────────────────

    _saveUndo() {
        this._undoStack.push(JSON.stringify(this.cityGraph.toJSON()));
        if (this._undoStack.length > this._maxHistory) {
            this._undoStack.shift();
        }
        this._redoStack = [];
    }

    undo() {
        if (this._undoStack.length === 0) return;
        this._redoStack.push(JSON.stringify(this.cityGraph.toJSON()));
        const data = JSON.parse(this._undoStack.pop());
        this.cityGraph.fromJSON(data);
        this.eventBus.emit(Events.CITY_CHANGED, { reason: 'undo' });
    }

    redo() {
        if (this._redoStack.length === 0) return;
        this._undoStack.push(JSON.stringify(this.cityGraph.toJSON()));
        const data = JSON.parse(this._redoStack.pop());
        this.cityGraph.fromJSON(data);
        this.eventBus.emit(Events.CITY_CHANGED, { reason: 'redo' });
    }

    // ─── Enable/Disable ────────────────────────────────────────────

    enable() {
        this.enabled = true;
        this._updateCursor();
    }

    disable() {
        this.enabled = false;
        this._roadStartJunction = null;
        this.renderer.ghostPreview = null;
        this.draggedJunction = null;
        this._dragCandidateJunction = null;
        this.hoveredJunction = null;
        this.hoveredRoad = null;
        this._updateCursor();
    }
}
