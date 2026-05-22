# UrbanFlow

UrbanFlow is a browser-based smart traffic simulation system for designing city road networks, running live traffic simulations, and comparing fixed timing against AI-driven signal control.

## Features

- Visual city editor for junctions, roads, roundabouts, and signals
- Preset layouts: Grid City, Ring City, Highway + Town, and saved browser sessions
- Real-time traffic simulation with vehicle spawning and speed controls
- AI traffic control with adaptive signal timing and emergency preemption
- Dashboard views for wait time, throughput, congestion, and charts
- Scenario events such as ambulance, fire truck, blockage, and rain
- City import/export and browser save/load support
- Compare mode for fixed vs AI strategy analysis

## Project structure

- `index.html` — main UI shell
- `styles/main.css` — app styling
- `js/core/` — graph, geometry, event bus, and renderer
- `js/editor/` — city editor tools and preset layouts
- `js/simulation/` — vehicles, signals, routing, and simulation loop
- `js/ai/` — fixed and adaptive controllers plus metrics collection
- `js/dashboard/` — charts, heatmap, and sidebar dashboard

## Running locally

UrbanFlow is a static browser app, so you can serve the folder with any local web server.

### Option 1: Python

```bash
python -m http.server 3000
```

### Option 2: Node

```bash
npx serve -l 3000
```

Then open:

```text
http://localhost:3000
```

## Usage

1. Open the app in your browser.
2. Start in **Editor** mode and choose a preset or build your own city.
3. Switch to **Simulate** to run traffic flow.
4. Use the AI toggle, scenario events, and dashboard tabs to explore behavior.
5. Export or import city JSON files to save and share layouts.

## Controls

- **Editor / Simulate**: switch between building and running the city
- **Select (V)**: move junctions or pan the view
- **Add Junction (J)**: place new junctions
- **Draw Road (R)**: connect junctions
- **Roundabout (O)**: add roundabouts
- **Add Signal (S)**: toggle signals on junctions
- **Delete (X)**: remove objects
- **Undo / Redo**: `Ctrl+Z` / `Ctrl+Y`
- **Zoom**: `+`, `-`, and reset view

## Testing

The repository includes a regression check:

```bash
node test_signal_behavior.mjs
```

## Notes

- The app uses native ES modules, so it should be served over HTTP rather than opened directly from disk.
- Browser storage is used for saved cities in the current session.
