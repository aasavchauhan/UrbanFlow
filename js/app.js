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

// Set default AI controller based on initial state
simController.aiController = state.aiEnabled ? aiController : fixedController;

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
    const simState = {
        mode: state.mode,
        vehicles: vehicleManager.getRenderData(),
        signals: simController._getSignalStates(),
        events: simController.activeEvents,
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
    renderer.zoom(1.2, canvas.width / 2, canvas.height / 2);
});

document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    renderer.zoom(0.8, canvas.width / 2, canvas.height / 2);
});

document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
    renderer.centerOn(0, 0);
    renderer.camera.zoom = 1;
});

// ─── Preset Layouts ────────────────────────────────────────
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        loadPreset(btn.dataset.preset);
    });
});

// ─── Session Management ────────────────────────────────────
document.getElementById('btn-save-session')?.addEventListener('click', () => {
    saveCurrentCity();
    alert('Session saved successfully.');
});

document.getElementById('btn-load-session')?.addEventListener('click', () => {
    if (cityGraph.loadSession()) {
        simController.reset();
        renderer.centerOn(0, 0);
        renderer.camera.zoom = 1;
        vehicleManager.pathfinder.clearCache();
        eventBus.emit(Events.PRESET_LOADED, { name: 'saved-session' });
        alert('Session loaded successfully.');
    } else {
        alert('No saved session found or failed to load.');
    }
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
    document.getElementById('val-density').textContent = e.target.value + '%';
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

// ─── Toggles ───────────────────────────────────────────────
document.getElementById('toggle-ai')?.addEventListener('click', (e) => {
    const toggle = e.currentTarget;
    const isActive = toggle.dataset.active === 'true';
    toggle.dataset.active = !isActive;
    toggle.classList.toggle('active', !isActive);

    state.aiEnabled = !isActive;
    simController.aiController = state.aiEnabled ? aiController : fixedController;
    eventBus.emit(Events.AI_MODE_CHANGED, { enabled: state.aiEnabled });
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
});

// Close signal config panel
document.getElementById('btn-close-signal-config')?.addEventListener('click', () => {
    document.getElementById('signal-config-panel').style.display = 'none';
});

// ─── Comparison Benchmark ──────────────────────────────────
document.getElementById('btn-run-fixed')?.addEventListener('click', async () => {
    if (state.mode !== 'SIMULATION') {
        setMode('SIMULATION');
    }

    // Switch to fixed controller, run for 30 seconds, take snapshot
    simController.aiController = fixedController;
    simController.reset();
    metricsCollector.reset();
    simController.start();
    simController.setSpeed(5);

    updateStatusBadge('running', 'Running Fixed...');

    // Run for simulated time
    await runBenchmark(30);

    const snapshot = metricsCollector.takeSnapshot('fixed');
    dashboard.setSnapshot('fixed', snapshot);
    simController.pause();
    updateStatusBadge('paused', 'Fixed Complete');

    // Restore AI setting
    simController.aiController = state.aiEnabled ? aiController : fixedController;
});

document.getElementById('btn-run-ai')?.addEventListener('click', async () => {
    if (state.mode !== 'SIMULATION') {
        setMode('SIMULATION');
    }

    // Switch to AI controller, run for 30 seconds, take snapshot
    simController.aiController = aiController;
    simController.reset();
    metricsCollector.reset();
    simController.start();
    simController.setSpeed(5);

    updateStatusBadge('running', 'Running AI...');

    await runBenchmark(30);

    const snapshot = metricsCollector.takeSnapshot('ai');
    dashboard.setSnapshot('ai', snapshot);
    simController.pause();
    updateStatusBadge('paused', 'AI Complete');

    // Restore speed
    simController.setSpeed(1);
    document.getElementById('speed-display').textContent = '1×';

    // Restore AI setting
    simController.aiController = state.aiEnabled ? aiController : fixedController;
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
        `  X — Delete tool\n` +
        `  Ctrl+Z / Ctrl+Y — Undo / Redo\n\n` +
        `SIMULATION MODE:\n` +
        `  Space — Play / Pause\n` +
        `  1-4 — Speed (1×, 2×, 5×, 10×)\n\n` +
        `NAVIGATION:\n` +
        `  Drag — Pan canvas\n` +
        `  Scroll — Zoom in/out\n` +
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
