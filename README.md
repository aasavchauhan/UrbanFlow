# UrbanFlow – AI-Based Smart Traffic Simulation System

UrbanFlow is a virtual smart city traffic simulation and control system that allows users to design city infrastructure and simulate real-time traffic flow using an intelligent AI-based traffic management system. 

Designed with Indian road conditions in mind (**Left-Hand Drive**), it features professional-grade canvas editing, realistic vehicle physics, and adaptive AI signaling.

## 🚀 Core Features

### 🛠️ Professional Canvas Editor
- **Dynamic Infrastructure:** Draw roads (straight and curved) and create complex junctions.
- **Road Splitting:** Add junctions directly onto existing roads to split them seamlessly.
- **Interactive Editing:** Drag and move junctions with real-time road stretching.
- **Magnetic Snapping:** Accurate alignment when connecting roads.
- **Roundabout Tool:** One-click generation of 4-way roundabouts with clockwise flow.

### 🚗 Advanced Simulation Engine
- **Left-Hand Drive (LHD):** Optimized for Indian traffic rules.
- **Kinematic Physics:** Realistic acceleration and braking using `sqrt(2 * a * d)`.
- **Car-Following Model:** Vehicles maintain safety gaps and queue logically at signals.
- **Intersection Reservation:** Vehicles "reserve" their path through junctions to prevent overlapping and collisions.
- **Priority Logic:** Straight traffic > Left turns > Right turns (crossing oncoming lanes).

### 🚦 Intelligent Traffic Control
- **Traditional Signaling:** Fixed 60s cycles with clockwise phasing.
- **AI-Powered Adaptive Mode:** Dynamically adjusts green times based on queue lengths and waiting times.
- **Visual Timers:** Live digital countdowns and clear stop-line indicators.
- **All-Red Phase:** Real-world safety buffers between signal changes.

### 📊 Visualization & Dashboard
- **Live Heatmap:** Pulsing congestion indicators on busy road segments.
- **Detailed Vehicle Icons:** Rendered with chassis, headlights, and brake lights.
- **Real-time Metrics:** Track throughput, average wait times, and congestion levels.
- **Zoom & Pan:** Navigate high-density city layouts with ease.

## 📥 Getting Started

UrbanFlow is a pure browser-based application with **no backend required**.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/aasavchauhan/UrbanFlow.git
   cd UrbanFlow
   ```

2. **Run a local server:**
   Since it uses ES Modules, you need to serve it via HTML.
   ```powershell
   # Using npx serve
   npx serve .
   
   # Or using Python
   python -m http.server 3000
   ```

3. **Open in Browser:**
   Navigate to `http://localhost:3000`.

## ⌨️ Keyboard Shortcuts

| Key | Tool | Description |
|-----|------|-------------|
| **V** | Select | Click and drag junctions or roads |
| **J** | Junction | Add points or split existing roads |
| **R** | Road | Connect two junctions |
| **O** | Roundabout | Drop a 4-way circle junction |
| **X** | Delete | Remove infrastructure |
| **S** | Simulate| Toggle Simulation vs Editor mode |

## 📁 Project Structure

```text
UrbanFlow/
├── index.html          # Main entry point
├── styles/
│   └── main.css        # Dashboard and UI styling
└── js/
    ├── app.js          # Application bootstrap and UI wiring
    ├── core/
    │   ├── CityGraph.js # Logic for nodes, roads, and lanes
    │   ├── Renderer.js  # Canvas drawing engine
    │   └── EventBus.js  # Messaging system
    ├── simulation/
    │   ├── Vehicle.js   # Kinematic physics and pathing
    │   ├── TrafficSignal.js # Phasing and state logic
    │   └── Pathfinder.js# Graph-based routing (A*)
    └── ai/
        ├── AIController.js # Adaptive signal logic
        └── FixedController.js # Traditional timing
```

## 📜 Vision

UrbanFlow aims to be a foundation for smart city research, providing a self-optimizing ecosystem where infrastructure and AI work together to reduce real-world congestion.

Developed by **Aasav Chauhan**.
