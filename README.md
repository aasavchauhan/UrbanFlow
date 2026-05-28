<p align="center">
  <img src="assets/urbanflow-header.png" alt="UrbanFlow Simulation" width="100%">
</p>

# UrbanFlow Simulation

UrbanFlow is a browser-based smart city traffic simulator for designing road networks, running live traffic flow, and comparing fixed-time signals against adaptive AI traffic control.

The project is built as a pure HTML, CSS, and JavaScript canvas application. It runs locally without a backend and is configured for Vercel deployment.

## Live Links

- GitHub: [github.com/aasavchauhan/UrbanFlow](https://github.com/aasavchauhan/UrbanFlow)
- Vercel: [urbanflow.vercel.app](https://urbanflow.vercel.app)

## What It Does

- Build city layouts on a canvas with roads, junctions, roundabouts, and signalized intersections.
- Simulate cars, buses, ambulances, and fire trucks moving through lane-level geometry.
- Route vehicles using graph-based pathfinding.
- Compare fixed signal timing with adaptive AI signal control.
- Visualize congestion, waiting vehicles, green-wave corridors, slow zones, and AI strategy cues.
- Save, load, import, and export custom city maps directly in the browser.

## Core Features

### City Canvas Editor

- Add and move junctions.
- Draw roads between junctions.
- Split existing roads by placing junctions on top of them.
- Add roundabouts.
- Add and configure traffic signals.
- Save custom maps locally in the browser.
- Export and import city layouts as JSON.

### Traffic Simulation

- Lane-level vehicle movement.
- Realistic acceleration, braking, and queue formation.
- Stop-line behavior at red and yellow signals.
- Vehicle-following logic for practical traffic queues.
- Pathfinding across the city graph.
- Road blockage and rain events.
- Live speed controls.

### AI Traffic Control

UrbanFlow includes an adaptive AI controller that responds to live traffic conditions:

- Queue-weighted phase scoring.
- Wait-time pressure.
- Approaching vehicle detection.
- Upstream flow prediction.
- Downstream spillback prevention.
- Lane-level speed hints.
- Green-wave corridor cues.
- Emergency vehicle preemption.

The AI does not only switch lights. It also publishes visible strategy state so users can see why traffic is being controlled a certain way.

### Emergency Handling

- Spawn ambulances and fire trucks.
- Give emergency vehicles signal priority.
- Compare emergency movement under fixed control versus AI control.
- Visualize how adaptive signaling clears a route through traffic.

### Dashboard And Comparison

- Average wait time.
- Throughput per minute.
- Congestion percentage.
- Active vehicle count.
- Fixed vs AI benchmark table.
- Live charts for wait time and throughput.
- AI strategy panel showing green-wave lanes, slow zones, and current decisions.

## Smart City Strategies Modeled

UrbanFlow is designed around practical smart-city traffic ideas:

| Situation | AI Response |
|---|---|
| Long queue on one approach | Extend green and switch early from low-demand phases |
| Previous junction releases a platoon | Prepare downstream green-wave timing |
| Next road is saturated | Hold upstream traffic to prevent spillback |
| Emergency vehicle approaching | Preempt signals and clear conflicting phases |
| Rain or reduced road speed | Lower effective flow and adjust release behavior |
| Road blockage | Reduce traffic entry into the blocked link and reroute vehicles |
| Balanced low traffic | Use shorter adaptive cycles to reduce unnecessary waiting |

## Run Locally

UrbanFlow uses ES modules, so open it through a local static server.

```bash
git clone https://github.com/aasavchauhan/UrbanFlow.git
cd UrbanFlow
```

Use any static server:

```bash
npx serve . -l 3000
```

Or:

```bash
python -m http.server 3000
```

Then open:

```text
http://localhost:3000
```

## Usage

1. Open the app.
2. Choose a city preset or load a saved map.
3. Use Editor mode to add roads, junctions, roundabouts, and signals.
4. Switch to Simulation mode.
5. Spawn vehicles or enable automatic traffic generation.
6. Turn on AI Control to watch adaptive behavior.
7. Use the Compare panel to evaluate fixed control versus AI control.

## Controls

| Key | Action |
|---|---|
| V | Select tool |
| J | Add junction |
| R | Draw road |
| O | Add roundabout |
| S | Add signal |
| X | Delete |
| Space | Play or pause simulation |
| 1 / 2 / 3 / 4 | Set simulation speed |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |

## Project Structure

```text
UrbanFlow/
├── assets/
│   └── urbanflow-header.png
├── index.html
├── styles/
│   └── main.css
├── js/
│   ├── app.js
│   ├── ai/
│   │   ├── AIController.js
│   │   ├── FixedController.js
│   │   └── MetricsCollector.js
│   ├── core/
│   │   ├── CityGraph.js
│   │   ├── EventBus.js
│   │   ├── Geometry.js
│   │   └── Renderer.js
│   ├── dashboard/
│   │   ├── Charts.js
│   │   ├── Dashboard.js
│   │   └── Heatmap.js
│   ├── editor/
│   │   ├── EditorController.js
│   │   ├── GridSystem.js
│   │   └── PresetLayouts.js
│   └── simulation/
│       ├── Pathfinder.js
│       ├── SimulationController.js
│       ├── TrafficSignal.js
│       ├── Vehicle.js
│       └── VehicleManager.js
└── test_signal_behavior.mjs
```

## Validation

Run the traffic signal regression test:

```bash
node test_signal_behavior.mjs
```

The test verifies:

- Vehicles stop correctly at red and yellow signals.
- Stopped vehicles do not release on yellow.
- Queues close up behind stopped vehicles.
- Signal configuration persists in saved city data.

## Deployment

The repo is configured for Vercel. The local `.vercel` folder is intentionally ignored because it contains project metadata.

Static deployment works directly from the repository root because the app has no build step.

## Author

Built by [Aasav Chauhan](https://github.com/aasavchauhan).
