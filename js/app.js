/**
 * UrbanFlow — Main Application Entry Point.
 * 
 * Initializes all modules, manages the main render loop,
 * handles UI interactions, and coordinates mode switching.
 */
import { EventBus, Events } from './core/EventBus.js';
import { CityGraph } from './core/CityGraph.js';
import { Renderer } from './core/Renderer.js';
import { EditorController, Tools } from './editor/EditorController.js';
import { PresetLayouts } from './editor/PresetLayouts.js';
import { VehicleManager } from './simulation/VehicleManager.js';
import { SimulationController } from './simulation/SimulationController.js';
import { AIController } from './ai/AIController.js';
import { FixedController } from './ai/FixedController.js';
import { MetricsCollector } from './ai/MetricsCollector.js';
import { Dashboard } from './dashboard/Dashboard.js';
import { Heatmap } from './dashboard/Heatmap.js';
import { VehicleType } from './simulation/Vehicle.js';

window.DEFAULT_GREEN_TIME = 20;
window.DEFAULT_YELLOW_TIME = 3;

// ═══════════════════════════════════════════════════════════
// Application State
// ═══════════════════════════════════════════════════════════
const state = {
    mode: 'EDITOR', // 'EDITOR' | 'SIMULATION'
    aiEnabled: false,
};

const spawnState = {
    enabled: false,
    vehicleType: VehicleType.CAR,
    originId: null,
    destinationId: null,
    autoDestination: false,
};

const benchmarkState = {
    active: false,
    mode: null,
    continuous: false,
    duration: 120,
    intervalId: null,
    lastSnapshotAt: 0,
    previousTraffic: null,
};

// ═══════════════════════════════════════════════════════════
// Initialize Modules
// ═══════════════════════════════════════════════════════════
const canvas = document.getElementById('main-canvas');
const eventBus = new EventBus();
const cityGraph = new CityGraph(eventBus);
const renderer = new Renderer(canvas, eventBus);
const editor = new EditorController(canvas, cityGraph, renderer, eventBus);
const vehicleManager = new VehicleManager(cityGraph, eventBus);
const simController = new SimulationController(cityGraph, vehicleManager, eventBus);
const aiController = new AIController(cityGraph, eventBus);
const fixedController = new FixedController();
const metricsCollector = new MetricsCollector();
const dashboard = new Dashboard(metricsCollector);
const heatmap = new Heatmap();
const SESSION_STORAGE_KEY = 'urbanflow_session';

// Set default AI controller based on initial state
simController.aiController = state.aiEnabled ? aiController : fixedController;

eventBus.on(Events.VEHICLE_ARRIVED, (data) => {
    if (!data || !data.vehicleType) return;
    if (data.vehicleType === VehicleType.AMBULANCE || data.vehicleType === VehicleType.FIRE_TRUCK) {
        metricsCollector.recordEmergencyResponse(data.totalTime || 0);
    }
});

// ═══════════════════════════════════════════════════════════
// Load Default Preset
// ═══════════════════════════════════════════════════════════
function loadPreset(name) {
    simController.reset();
    const data = PresetLayouts.generate(name);
    cityGraph.fromJSON(data);
    renderer.centerOn(0, 0);
    renderer.camera.zoom = 1;
    vehicleManager.pathfinder.clearCache();
    eventBus.emit(Events.PRESET_LOADED, { name });
    eventBus.emit(Events.CITY_CHANGED, { reason: 'preset:loaded' });
}

let autoSaveTimer = null;
let autoSaveEnabled = false;

function saveCurrentCity() {
    cityGraph.saveSession();
    updateSavedPresetState();
}

function loadSavedCity(showAlert = true) {
    if (cityGraph.loadSession()) {
        simController.reset();
        renderer.centerOn(0, 0);
        renderer.camera.zoom = 1;
        vehicleManager.pathfinder.clearCache();
        eventBus.emit(Events.PRESET_LOADED, { name: 'saved-session' });
        if (showAlert) alert('Saved city loaded.');
        return true;
    }

    if (showAlert) alert('No saved city found in this browser.');
    return false;
}

function updateSavedPresetState() {
    const savedButton = document.getElementById('preset-saved-city');
    const savedDesc = document.getElementById('saved-city-desc');
    if (!savedButton || !savedDesc) return;

    const savedJson = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!savedJson) {
        savedButton.disabled = true;
        savedDesc.textContent = 'No browser save yet';
        return;
    }

    try {
        const data = JSON.parse(savedJson);
        savedButton.disabled = false;
        savedDesc.textContent = `${data.junctions?.length || 0} junctions, ${data.roads?.length || 0} roads`;
    } catch {
        savedButton.disabled = true;
        savedDesc.textContent = 'Saved city is unreadable';
    }
}

function exportCurrentCity() {
    const data = cityGraph.toJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.href = url;
    link.download = `urbanflow-city-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function importCityFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            if (!cityGraph.fromJSON(data)) {
                alert('Could not import this city file.');
                return;
            }

            simController.reset();
            renderer.centerOn(0, 0);
            renderer.camera.zoom = 1;
            vehicleManager.pathfinder.clearCache();
            saveCurrentCity();
            eventBus.emit(Events.PRESET_LOADED, { name: 'imported-city' });
            alert('City imported and saved in this browser.');
        } catch {
            alert('Invalid city JSON file.');
        }
    };
    reader.readAsText(file);
}

function scheduleAutoSave() {
    if (!autoSaveEnabled) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(saveCurrentCity, 250);
}

function initializeCity() {
    if (cityGraph.loadSession()) {
        renderer.centerOn(0, 0);
        renderer.camera.zoom = 1;
        vehicleManager.pathfinder.clearCache();
        eventBus.emit(Events.PRESET_LOADED, { name: 'saved-session' });
    } else {
        loadPreset('grid');
    }
    autoSaveEnabled = true;
    updateSavedPresetState();
}

initializeCity();

// ═══════════════════════════════════════════════════════════
// Mode Switching
// ═══════════════════════════════════════════════════════════
function setMode(mode) {
    state.mode = mode;

    if (mode === 'EDITOR') {
        simController.reset();
        editor.enable();
        document.getElementById('toolbar').classList.remove('hidden');
        document.getElementById('sim-controls').style.display = 'none';
        updateStatusBadge('stopped', 'Ready');
    } else {
        editor.disable();
        document.getElementById('toolbar').classList.add('hidden');
        document.getElementById('sim-controls').style.display = 'flex';
        simController.start();
        updateStatusBadge('running', 'Running');
    }

    // Update mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    eventBus.emit(Events.MODE_CHANGED, { mode });
}

function updateStatusBadge(status, text) {
    const badge = document.getElementById('sim-status');
    const textEl = document.getElementById('sim-status-text');
    badge.className = `status-badge ${status}`;
    textEl.textContent = text;
}

function isAIControllerActive() {
    return state.aiEnabled || benchmarkState.mode === 'ai' || simController.aiController === aiController;
}

function setAIEnabled(enabled) {
    state.aiEnabled = enabled;
    simController.aiController = enabled ? aiController : fixedController;

    document.querySelectorAll('#toggle-ai').forEach(toggle => {
        toggle.dataset.active = enabled.toString();
        toggle.classList.toggle('active', enabled);
    });

    const pill = document.getElementById('compare-ai-mode-pill');
    if (pill) {
        pill.textContent = enabled ? 'AI live' : 'AI ready';
    }

    eventBus.emit(Events.AI_MODE_CHANGED, { enabled });
}

function setClickSpawnEnabled(enabled) {
    spawnState.enabled = enabled;
    spawnState.originId = null;
    spawnState.destinationId = null;

    document.querySelectorAll('#toggle-click-spawn, #toggle-compare-click-spawn').forEach(toggle => {
        toggle.dataset.active = enabled.toString();
        toggle.classList.toggle('active', enabled);
    });
}

function setSpawnType(type) {
    spawnState.vehicleType = VehicleType[type] || VehicleType.CAR;
    spawnState.originId = null;
    spawnState.destinationId = null;
    spawnState.autoDestination = false;

    document.querySelectorAll('#select-spawn-type, #select-compare-spawn-type').forEach(select => {
        select.value = spawnState.vehicleType;
    });

    updateSpawnHints();
}

function ensureSimulationRunningWithAI() {
    stopBenchmark(false);
    if (state.mode !== 'SIMULATION') {
        setMode('SIMULATION');
    }
    setAIEnabled(true);
    simController.aiController = aiController;
    if (!simController.running) {
        simController.start();
    }
    updateStatusBadge('running', 'AI Live Test');
}

function armEmergencyClickSpawn(type) {
    ensureSimulationRunningWithAI();
    setSpawnType(type);
    spawnState.autoDestination = false;
    setClickSpawnEnabled(true);
    updateSpawnHints();
}

function updateSpawnHints() {
    const isEmergency = spawnState.vehicleType === VehicleType.AMBULANCE || spawnState.vehicleType === VehicleType.FIRE_TRUCK;
    const text = isEmergency
        ? `Select origin junction, then destination junction for the ${spawnState.vehicleType === VehicleType.AMBULANCE ? 'ambulance' : 'fire truck'}. AI will clear that route.`
        : 'Click an origin junction, then a destination junction.';

    const compareHint = document.getElementById('compare-spawn-hint');
    if (compareHint) compareHint.textContent = text;
}

// ═══════════════════════════════════════════════════════════
// Main Render Loop
// ═══════════════════════════════════════════════════════════
let lastTime = 0;

function mainLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1); // Cap at 100ms
    lastTime = timestamp;

    // Update simulation
    if (state.mode === 'SIMULATION') {
        simController.update(dt);
        simController.updateEvents();
        heatmap.update(dt * simController.speed, cityGraph);
        metricsCollector.update(dt * simController.speed, vehicleManager, simController.signals);
        dashboard.update(dt * simController.speed, simController.running);
    }

    // Update renderer heatmap
    renderer.showHeatmap = heatmap.enabled;
    renderer.heatmapData = heatmap.getData();

    // Build render state
    const aiState = isAIControllerActive() && typeof aiController.getState === 'function'
        ? aiController.getState()
        : null;
    updateAIStatus(aiState);

    const simState = {
        mode: state.mode,
        aiEnabled: state.aiEnabled,
        aiState,
        vehicles: vehicleManager.getRenderData(),
        signals: simController._getSignalStates(),
        events: simController.activeEvents,
        spawn: { ...spawnState },
        editor: state.mode === 'EDITOR' ? {
            activeTool: editor.activeTool,
            hoveredJunction: editor.hoveredJunction,
            hoveredRoad: editor.hoveredRoad,
            draggedJunction: editor.draggedJunction
        } : null
    };

    // Render
    renderer.render(cityGraph, simState);

    requestAnimationFrame(mainLoop);
}

function updateAIStatus(aiState) {
    const modeEl = document.getElementById('ai-live-mode');
    const greenEl = document.getElementById('ai-live-greenwaves');
    const slowEl = document.getElementById('ai-live-slowzones');
    const decisionEl = document.getElementById('ai-live-decision');
    if (!modeEl || !greenEl || !slowEl || !decisionEl) return;

    if (!state.aiEnabled || !aiState) {
        modeEl.textContent = 'Standby';
        greenEl.textContent = '0';
        slowEl.textContent = '0';
        decisionEl.textContent = 'Enable AI to view live coordination cues.';
        return;
    }

    const hints = Object.values(aiState.laneSpeedHints || {});
    const greenWaves = hints.filter(h => h.reason === 'Green wave').length;
    const slowZones = hints.filter(h => h.reason === 'Spillback slow zone').length;
    const activeStrategies = Object.values(aiState.signalStrategies || {})
        .filter(s => s.bestScore > 0)
        .sort((a, b) => b.bestScore - a.bestScore);
    const activeEmergency = (aiState.activeEmergencies || [])[0];

    modeEl.textContent = aiState.mode || 'Adaptive';
    greenEl.textContent = greenWaves;
    slowEl.textContent = slowZones;
    decisionEl.textContent = activeEmergency
        ? `${activeEmergency.vehicleType} priority: green corridor at ${activeEmergency.junctionId}`
        : activeStrategies.length > 0
        ? `${activeStrategies[0].reason}: priority score ${activeStrategies[0].bestScore}`
        : 'Scanning queues, platoons, and downstream capacity.';
}

requestAnimationFrame((ts) => {
    lastTime = ts;
    requestAnimationFrame(mainLoop);
});

// ═══════════════════════════════════════════════════════════
// UI Event Handlers
// ═══════════════════════════════════════════════════════════

// ─── Mode Toggle ───────────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

// ─── Editor Toolbar ────────────────────────────────────────
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        editor.setTool(tool);

        // Update active state
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b =>
            b.classList.toggle('active', b.dataset.tool === tool)
        );
    });
});

// Undo/Redo buttons
document.getElementById('btn-undo')?.addEventListener('click', () => editor.undo());
document.getElementById('btn-redo')?.addEventListener('click', () => editor.redo());

// ─── Canvas View Controls ──────────────────────────────────
document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    renderer.zoom(1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
});

document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    renderer.zoom(0.8, rect.left + rect.width / 2, rect.top + rect.height / 2);
});

document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
    renderer.centerOn(0, 0);
    renderer.camera.zoom = 1;
});

// ─── Preset Layouts ────────────────────────────────────────
document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
        loadPreset(btn.dataset.preset);
    });
});

document.getElementById('preset-saved-city')?.addEventListener('click', () => {
    loadSavedCity();
});

// ─── Session Management ────────────────────────────────────
document.getElementById('btn-save-session')?.addEventListener('click', () => {
    saveCurrentCity();
    alert('City saved in this browser.');
});

document.getElementById('btn-load-session')?.addEventListener('click', () => {
    loadSavedCity();
});

document.getElementById('btn-export-city')?.addEventListener('click', () => {
    exportCurrentCity();
});

document.getElementById('btn-import-city')?.addEventListener('click', () => {
    document.getElementById('input-import-city')?.click();
});

document.getElementById('input-import-city')?.addEventListener('change', (e) => {
    importCityFile(e.target.files?.[0]);
    e.target.value = '';
});

// ─── Simulation Controls ───────────────────────────────────
document.getElementById('btn-sim-play')?.addEventListener('click', () => {
    simController.togglePlayPause();
    const isRunning = simController.running;
    document.getElementById('btn-sim-play').textContent = isRunning ? '⏸' : '▶';
    updateStatusBadge(isRunning ? 'running' : 'paused', isRunning ? 'Running' : 'Paused');
});

document.getElementById('btn-sim-step')?.addEventListener('click', () => {
    simController.step();
});

document.getElementById('btn-sim-reset')?.addEventListener('click', () => {
    simController.reset();
    metricsCollector.reset();
    dashboard.reset();
    document.getElementById('btn-sim-play').textContent = '▶';
    updateStatusBadge('stopped', 'Ready');
});

// Speed controls
document.getElementById('btn-speed-up')?.addEventListener('click', () => {
    simController.setSpeed(simController.speed * 2);
    document.getElementById('speed-display').textContent = simController.speed + '×';
});

document.getElementById('btn-speed-down')?.addEventListener('click', () => {
    simController.setSpeed(simController.speed / 2);
    document.getElementById('speed-display').textContent = simController.speed + '×';
});

// ─── Settings Sliders ──────────────────────────────────────
document.getElementById('slider-density')?.addEventListener('input', (e) => {
    const density = parseInt(e.target.value);
    document.getElementById('val-density').textContent = density + '%';
    vehicleManager.maxActiveVehicles = Math.round(20 + density * 1.6);
    vehicleManager.autoSpawnRate = Math.max(0.5, Math.round((density / 25) * 10) / 10);
    document.getElementById('slider-spawn-rate').value = Math.max(1, Math.round(vehicleManager.autoSpawnRate));
    document.getElementById('val-spawn-rate').textContent = vehicleManager.autoSpawnRate + '/s';
});

const sliderGreen = document.getElementById('slider-green-time');
const valGreen = document.getElementById('val-green-time');
if (sliderGreen) {
    sliderGreen.addEventListener('input', (e) => {
        valGreen.textContent = `${e.target.value}s`;
        window.DEFAULT_GREEN_TIME = parseInt(e.target.value);
        if (simController && simController.signals) {
            for (const signal of simController.signals.values()) {
                signal.greenDuration = window.DEFAULT_GREEN_TIME;
            }
        }
    });
}

const sliderYellow = document.getElementById('slider-yellow-time');
const valYellow = document.getElementById('val-yellow-time');
if (sliderYellow) {
    sliderYellow.addEventListener('input', (e) => {
        valYellow.textContent = `${e.target.value}s`;
        window.DEFAULT_YELLOW_TIME = parseInt(e.target.value);
        if (simController && simController.signals) {
            for (const signal of simController.signals.values()) {
                signal.yellowDuration = window.DEFAULT_YELLOW_TIME;
            }
        }
    });
}

document.getElementById('slider-spawn-rate')?.addEventListener('input', (e) => {
    const rate = parseInt(e.target.value);
    vehicleManager.autoSpawnRate = rate;
    document.getElementById('val-spawn-rate').textContent = rate + '/s';
});

// ─── Click Spawn Controls ─────────────────────────────────
document.getElementById('toggle-click-spawn')?.addEventListener('click', (e) => {
    const toggle = e.currentTarget;
    const isActive = toggle.dataset.active === 'true';
    setClickSpawnEnabled(!isActive);
});

document.getElementById('toggle-compare-click-spawn')?.addEventListener('click', (e) => {
    const toggle = e.currentTarget;
    const isActive = toggle.dataset.active === 'true';
    ensureSimulationRunningWithAI();
    setClickSpawnEnabled(!isActive);
});

document.getElementById('select-spawn-type')?.addEventListener('change', (e) => {
    setSpawnType(e.target.value);
});

document.getElementById('select-compare-spawn-type')?.addEventListener('change', (e) => {
    ensureSimulationRunningWithAI();
    setSpawnType(e.target.value);
});

// ─── Toggles ───────────────────────────────────────────────
document.getElementById('toggle-ai')?.addEventListener('click', (e) => {
    const toggle = e.currentTarget;
    const isActive = toggle.dataset.active === 'true';
    setAIEnabled(!isActive);
});

document.getElementById('toggle-heatmap')?.addEventListener('click', (e) => {
    const toggle = e.currentTarget;
    const isActive = toggle.dataset.active === 'true';
    toggle.dataset.active = !isActive;
    toggle.classList.toggle('active', !isActive);
    heatmap.toggle();
    eventBus.emit(Events.HEATMAP_TOGGLED, { enabled: heatmap.enabled });
});

// ─── Scenario Events ───────────────────────────────────────
document.querySelectorAll('.event-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (state.mode !== 'SIMULATION' || !simController.running) return;
        simController.triggerEvent(btn.dataset.event);
    });
});

// ─── Vehicle Spawning ──────────────────────────────────────
document.getElementById('btn-spawn-10')?.addEventListener('click', () => {
    if (state.mode !== 'SIMULATION') return;
    vehicleManager.spawnRandom(10, VehicleType.CAR);
});

document.getElementById('btn-spawn-50')?.addEventListener('click', () => {
    if (state.mode !== 'SIMULATION') return;
    vehicleManager.spawnRandom(50, VehicleType.CAR);
});

document.getElementById('btn-spawn-bus')?.addEventListener('click', () => {
    if (state.mode !== 'SIMULATION') return;
    vehicleManager.spawnRandom(1, VehicleType.BUS);
});

document.getElementById('btn-clear-vehicles')?.addEventListener('click', () => {
    vehicleManager.clearAll();
});

canvas.addEventListener('click', (e) => {
    if (state.mode !== 'SIMULATION' || !spawnState.enabled) return;
    if (e.button !== 0 || editor.wasLastPointerDrag()) return;

    const worldPos = renderer.screenToWorld(e.clientX, e.clientY);
    const junction = cityGraph.findJunctionNear(worldPos.x, worldPos.y, 30);
    if (!junction) return;

    if (!spawnState.originId) {
        spawnState.originId = junction.id;
        spawnState.destinationId = null;
        return;
    }

    if (!spawnState.destinationId) {
        if (junction.id === spawnState.originId) return;
        spawnState.destinationId = junction.id;
        vehicleManager.spawnVehicle(spawnState.vehicleType, spawnState.originId, spawnState.destinationId);
        spawnState.originId = null;
        spawnState.destinationId = null;
    }
});

// ─── Sidebar Tabs ──────────────────────────────────────────
document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;

        document.querySelectorAll('.sidebar-tab').forEach(t =>
            t.classList.toggle('active', t.dataset.tab === targetTab)
        );
        document.querySelectorAll('.sidebar-panel').forEach(p =>
            p.classList.toggle('active', p.id === `panel-${targetTab}`)
        );
    });
});

// ─── Signal Configuration Panel ────────────────────────────

// Listen for signal selection
eventBus.on(Events.SIGNAL_SELECTED, (data) => {
    const { junctionId } = data;
    const junction = cityGraph.getJunction(junctionId);
    
    if (!junction || !junction.signalState) return;
    
    // Show panel and populate values
    const configPanel = document.getElementById('signal-config-panel');
    const junctionIdInput = document.getElementById('config-junction-id');
    const greenSlider = document.getElementById('slider-indiv-green');
    const yellowSlider = document.getElementById('slider-indiv-yellow');
    const greenValue = document.getElementById('val-indiv-green');
    const yellowValue = document.getElementById('val-indiv-yellow');
    
    // Store junction ID
    junctionIdInput.value = junctionId;
    
    // Get current config or use defaults
    const config = junction.signalConfig || {
        greenDuration: window.DEFAULT_GREEN_TIME || 20,
        yellowDuration: window.DEFAULT_YELLOW_TIME || 3
    };
    
    // Set slider values
    greenSlider.value = config.greenDuration;
    yellowSlider.value = config.yellowDuration;
    greenValue.textContent = config.greenDuration;
    yellowValue.textContent = config.yellowDuration;
    
    // Show panel
    configPanel.style.display = 'block';
});

// Update slider display values as user adjusts them
document.getElementById('slider-indiv-green')?.addEventListener('input', (e) => {
    document.getElementById('val-indiv-green').textContent = e.target.value;
});

document.getElementById('slider-indiv-yellow')?.addEventListener('input', (e) => {
    document.getElementById('val-indiv-yellow').textContent = e.target.value;
});

// Apply signal configuration
document.getElementById('btn-apply-signal-config')?.addEventListener('click', () => {
    const junctionId = document.getElementById('config-junction-id').value;
    if (!junctionId) return;
    
    const junction = cityGraph.getJunction(junctionId);
    if (!junction) return;
    
    // Update signal config
    junction.signalConfig = {
        greenDuration: parseInt(document.getElementById('slider-indiv-green').value),
        yellowDuration: parseInt(document.getElementById('slider-indiv-yellow').value)
    };
    
    // Emit event
    eventBus.emit(Events.SIGNAL_CHANGED, { junctionId });
    eventBus.emit(Events.CITY_CHANGED, { reason: 'signal:configured' });
});

// Remove signal
document.getElementById('btn-remove-signal')?.addEventListener('click', () => {
    const junctionId = document.getElementById('config-junction-id').value;
    if (!junctionId) return;
    
    const junction = cityGraph.getJunction(junctionId);
    if (!junction) return;
    
    // Remove signal
    junction.signalState = null;
    junction.signalPhases = {};
    junction.signalConfig = null;
    
    // Emit event
    eventBus.emit(Events.SIGNAL_CHANGED, { junctionId });
    eventBus.emit(Events.CITY_CHANGED, { reason: 'signal:removed' });
    
    // Hide panel
    document.getElementById('signal-config-panel').style.display = 'none';
});

eventBus.on(Events.CITY_CHANGED, () => {
    vehicleManager.pathfinder.clearCache();
    scheduleAutoSave();
    updateSavedPresetState();
});

// Close signal config panel
document.getElementById('btn-close-signal-config')?.addEventListener('click', () => {
    document.getElementById('signal-config-panel').style.display = 'none';
});

// ─── Comparison Benchmark ──────────────────────────────────
// Compare AI Live Spawning
document.getElementById('btn-compare-live-ai')?.addEventListener('click', () => {
    ensureSimulationRunningWithAI();
});

document.getElementById('btn-compare-spawn-10')?.addEventListener('click', () => {
    ensureSimulationRunningWithAI();
    vehicleManager.spawnRandom(10, VehicleType.CAR);
});

document.getElementById('btn-compare-spawn-bus')?.addEventListener('click', () => {
    ensureSimulationRunningWithAI();
    vehicleManager.spawnRandom(1, VehicleType.BUS);
});

document.getElementById('btn-compare-spawn-ambulance')?.addEventListener('click', () => {
    armEmergencyClickSpawn(VehicleType.AMBULANCE);
});

document.getElementById('btn-compare-spawn-fire')?.addEventListener('click', () => {
    armEmergencyClickSpawn(VehicleType.FIRE_TRUCK);
});

document.getElementById('btn-compare-clear')?.addEventListener('click', () => {
    vehicleManager.clearAll();
});

document.getElementById('btn-run-fixed')?.addEventListener('click', async () => {
    await startBenchmark('fixed');
});

document.getElementById('btn-run-ai')?.addEventListener('click', async () => {
    await startBenchmark('ai');
});

document.getElementById('btn-stop-benchmark')?.addEventListener('click', () => {
    stopBenchmark();
});

const benchmarkDurationSlider = document.getElementById('slider-benchmark-duration');
const benchmarkDurationValue = document.getElementById('val-benchmark-duration');
if (benchmarkDurationSlider) {
    benchmarkState.duration = parseInt(benchmarkDurationSlider.value);
    if (benchmarkDurationValue) {
        benchmarkDurationValue.textContent = `${benchmarkState.duration}s`;
    }
    benchmarkDurationSlider.addEventListener('input', (e) => {
        benchmarkState.duration = parseInt(e.target.value);
        benchmarkDurationValue.textContent = `${benchmarkState.duration}s`;
    });
}

document.getElementById('toggle-benchmark-continuous')?.addEventListener('click', (e) => {
    const toggle = e.currentTarget;
    const isActive = toggle.dataset.active === 'true';
    toggle.dataset.active = (!isActive).toString();
    toggle.classList.toggle('active', !isActive);
    benchmarkState.continuous = !isActive;
});

/**
 * Run benchmark for a specified number of simulated seconds.
 */
function runBenchmark(simSeconds) {
    return new Promise(resolve => {
        const startSimTime = simController.simTime;
        const checkInterval = setInterval(() => {
            if (simController.simTime - startSimTime >= simSeconds) {
                clearInterval(checkInterval);
                resolve();
            }
        }, 100);
    });
}

async function startBenchmark(mode) {
    if (state.mode !== 'SIMULATION') {
        setMode('SIMULATION');
    }

    stopBenchmark(false);

    benchmarkState.active = true;
    benchmarkState.mode = mode;
    benchmarkState.previousTraffic = {
        autoSpawnRate: vehicleManager.autoSpawnRate,
        maxActiveVehicles: vehicleManager.maxActiveVehicles,
    };

    setAIEnabled(mode === 'ai');
    simController.aiController = mode === 'ai' ? aiController : fixedController;
    simController.reset();
    metricsCollector.reset();
    simController.start();
    simController.setSpeed(1);
    vehicleManager.autoSpawnRate = 0.9;
    vehicleManager.maxActiveVehicles = 42;
    vehicleManager.spawnRandom(10, VehicleType.CAR);
    document.getElementById('speed-display').textContent = '1×';
    document.getElementById('speed-display').textContent = '5×';

    document.getElementById('speed-display').textContent = '1×';
    updateStatusBadge('running', mode === 'ai' ? 'Running AI...' : 'Running Fixed...');

    if (benchmarkState.continuous) {
        benchmarkState.lastSnapshotAt = simController.simTime;
        benchmarkState.intervalId = setInterval(() => {
            if (!benchmarkState.active) return;
            const elapsed = simController.simTime - benchmarkState.lastSnapshotAt;
            if (elapsed >= benchmarkState.duration) {
                const snapshot = metricsCollector.takeSnapshot(mode);
                dashboard.setSnapshot(mode, snapshot);
                benchmarkState.lastSnapshotAt = simController.simTime;
            }
        }, 200);
        return;
    }

    await runBenchmark(benchmarkState.duration);

    const snapshot = metricsCollector.takeSnapshot(mode);
    dashboard.setSnapshot(mode, snapshot);
    updateStatusBadge('paused', mode === 'ai' ? 'AI Complete' : 'Fixed Complete');
    stopBenchmark(false);
}

function stopBenchmark(pauseSim = true) {
    if (benchmarkState.intervalId) {
        clearInterval(benchmarkState.intervalId);
        benchmarkState.intervalId = null;
    }

    if (pauseSim && simController.running) {
        simController.pause();
    }

    benchmarkState.active = false;
    benchmarkState.mode = null;

    simController.setSpeed(1);
    document.getElementById('speed-display').textContent = '1×';
    simController.aiController = state.aiEnabled ? aiController : fixedController;
    if (benchmarkState.previousTraffic) {
        vehicleManager.autoSpawnRate = benchmarkState.previousTraffic.autoSpawnRate;
        vehicleManager.maxActiveVehicles = benchmarkState.previousTraffic.maxActiveVehicles;
        benchmarkState.previousTraffic = null;
    }
}

// ─── Keyboard Shortcuts ────────────────────────────────────
document.addEventListener('keydown', (e) => {
    // Don't handle if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            if (state.mode === 'SIMULATION') {
                simController.togglePlayPause();
                const isRunning = simController.running;
                document.getElementById('btn-sim-play').textContent = isRunning ? '⏸' : '▶';
                updateStatusBadge(isRunning ? 'running' : 'paused', isRunning ? 'Running' : 'Paused');
            }
            break;
        case '1': simController.setSpeed(1); document.getElementById('speed-display').textContent = '1×'; break;
        case '2': simController.setSpeed(2); document.getElementById('speed-display').textContent = '2×'; break;
        case '3': simController.setSpeed(5); document.getElementById('speed-display').textContent = '5×'; break;
        case '4': simController.setSpeed(10); document.getElementById('speed-display').textContent = '10×'; break;
        case 'v': if (state.mode === 'EDITOR') selectTool('SELECT'); break;
        case 'j': if (state.mode === 'EDITOR') selectTool('JUNCTION'); break;
        case 'r': if (state.mode === 'EDITOR') selectTool('ROAD'); break;
        case 'o': if (state.mode === 'EDITOR') selectTool('ROUNDABOUT'); break;
        case 's': if (state.mode === 'EDITOR') selectTool('SIGNAL'); break;
        case 'c': if (state.mode === 'EDITOR') selectTool('CURVE'); break;
        case 'h': if (state.mode === 'EDITOR') selectTool('HOSPITAL'); break;
        case 'f': if (state.mode === 'EDITOR') selectTool('FIRE_STATION'); break;
        case 'x': if (state.mode === 'EDITOR') selectTool('DELETE'); break;
        case 'escape':
            editor.setTool(Tools.SELECT);
            selectTool('SELECT');
            break;
        case 'z':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.shiftKey) editor.redo();
                else editor.undo();
            }
            break;
        case 'y':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                editor.redo();
            }
            break;
    }
});

function selectTool(toolName) {
    editor.setTool(toolName);
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b =>
        b.classList.toggle('active', b.dataset.tool === toolName)
    );
}

// ─── Help Button ───────────────────────────────────────────
document.getElementById('btn-help')?.addEventListener('click', () => {
    alert(
        `⌨️ Keyboard Shortcuts\n\n` +
        `EDITOR MODE:\n` +
        `  V — Select tool\n` +
        `  J — Junction tool\n` +
        `  R — Road tool\n` +
        `  S — Signal tool\n` +
        `  C — Curve road tool\n` +
        `  H — Hospital tool\n` +
        `  F — Fire station tool\n` +
        `  X — Delete tool\n` +
        `  Ctrl+Z / Ctrl+Y — Undo / Redo\n\n` +
        `SIMULATION MODE:\n` +
        `  Space — Play / Pause\n` +
        `  1-4 — Speed (1×, 2×, 5×, 10×)\n\n` +
        `NAVIGATION:\n` +
        `  Drag empty canvas — Pan map\n` +
        `  Middle/right drag or Alt+drag — Pan from any tool\n` +
        `  Scroll at cursor — Zoom in/out\n` +
        `  Escape — Deselect tool`
    );
});

// ═══════════════════════════════════════════════════════════
// Console Welcome
// ═══════════════════════════════════════════════════════════
console.log(
    '%c🚦 UrbanFlow %cv1.0 — AI Smart Traffic Simulation',
    'font-size:16px; font-weight:bold; color:#60a5fa;',
    'font-size:12px; color:#94a3b8;'
);
console.log('Press F12 → Console for debug output');
