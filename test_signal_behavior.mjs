import assert from 'node:assert/strict';

import { EventBus } from './js/core/EventBus.js';
import { CityGraph } from './js/core/CityGraph.js';
import { PresetLayouts } from './js/editor/PresetLayouts.js';
import { Vehicle } from './js/simulation/Vehicle.js';
import { VehicleManager } from './js/simulation/VehicleManager.js';
import { SimulationController } from './js/simulation/SimulationController.js';

globalThis.window = {
    DEFAULT_GREEN_TIME: 20,
    DEFAULT_YELLOW_TIME: 3,
};

const eventBus = new EventBus();
const cityGraph = new CityGraph(eventBus);
cityGraph.fromJSON(PresetLayouts.generate('grid'));

const vehicleManager = new VehicleManager(cityGraph, eventBus);
const simController = new SimulationController(cityGraph, vehicleManager, eventBus);
simController.start();
vehicleManager.autoSpawnEnabled = false;

const vehicle = new Vehicle({
    type: 'CAR',
    route: ['j6', 'j2', 'j1'],
    cityGraph,
});
vehicleManager.vehicles.push(vehicle);

const firstLane = cityGraph.lanes.get(vehicle.currentGeomId);
assert.equal(vehicle.size, 14, 'vehicle size must be initialized for stop-line math');
assert.equal(firstLane.endNode, 'j2', 'test vehicle should approach the j2 signal');

const stopLineProgress = (firstLane.geom.length - vehicle.size) / firstLane.geom.length;
vehicle.progress = stopLineProgress;
vehicle.speed = 0;
vehicle.state = 'waiting';
vehicle._updateTransform(vehicle.progress, firstLane);
vehicle.update(1 / 30, {
    [firstLane.endNode]: {
        phases: { [firstLane.id]: 'yellow' },
        state: 'yellow',
    },
});
assert.equal(vehicle.geomType, 'lane', 'stopped vehicle must not release from the stop line on yellow');
assert.equal(vehicle.progress, stopLineProgress, 'stopped vehicle should stay clamped on yellow');

vehicle.progress = 0;
vehicle.speed = 0;
vehicle.state = 'moving';
vehicle._updateTransform(vehicle.progress, firstLane);

let stoppedOnRed = false;
let redLightViolation = false;
let enteredIntersectionAt = null;

for (let tick = 0; tick < 1000; tick++) {
    simController.update(1 / 30);
    const signalStates = simController._getSignalStates();

    if (vehicle.geomType === 'lane') {
        const lane = cityGraph.lanes.get(vehicle.currentGeomId);
        const signal = signalStates[lane.endNode];

        if (signal) {
            const phase = signal.phases[lane.id] || signal.state;
            const stopLineProgress = (lane.geom.length - vehicle.size) / lane.geom.length;

            if (phase === 'red' && vehicle.state === 'waiting') {
                stoppedOnRed = true;
            }

            if ((phase === 'red' || phase === 'yellow') && vehicle.progress > stopLineProgress + 0.001) {
                redLightViolation = true;
            }
        }
    }

    if (!enteredIntersectionAt && vehicle.geomType === 'connection') {
        enteredIntersectionAt = simController.simTime;
    }
}

assert.equal(redLightViolation, false, 'vehicle must not cross the stop line on red/yellow');
assert.equal(stoppedOnRed, true, 'vehicle should wait at the red signal');
assert.ok(enteredIntersectionAt > 20, 'vehicle should enter only after its phase becomes green');
assert.equal(vehicleManager.totalArrived, 1, 'vehicle should eventually finish its route');

const signalizedJunction = cityGraph.getJunction('j2');
signalizedJunction.signalConfig = { greenDuration: 17, yellowDuration: 4 };
const serialized = cityGraph.toJSON();
const restoredGraph = new CityGraph(eventBus);
assert.equal(restoredGraph.fromJSON(serialized), true, 'serialized city should load');
assert.deepEqual(
    restoredGraph.getJunction('j2').signalConfig,
    { greenDuration: 17, yellowDuration: 4 },
    'signal config should persist with the saved map'
);

console.log('Signal behavior regression passed.');
