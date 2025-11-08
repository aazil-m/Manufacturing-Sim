# Manufacturing Line Simulation

A mini full‑stack web application that simulates the **flow of goods through a manufacturing line**.  
The system consists of a **FastAPI backend** and a **React + Three.js (React Three Fiber)** frontend.

---

## 🚀 Project Overview

The simulator represents a set of machines (Cutting, Assembly, Packaging) that process and pass items downstream.  
Each machine has a configurable **takt time** (processing duration) and **buffer size** (number of items it can hold).  
The simulation runs continuously, showing item movement and live performance metrics such as throughput and utilization.

---

## 🧩 Project Structure

```
manufacturing-sim/
│
├── backend/
│ ├── main.py     #FastAPI simulation server with dynamic line editing
│ ├── requirements.txt     #Backend dependencies
│
├── frontend/
│ ├── index.html
│ ├── package.json     #React project dependencies
│ ├── vite.config.ts     #Proxy setup for backend communication
│ ├── src/
│ │ ├── main.tsx     #React entry point
│ │ ├── App.tsx     #Layout: Visualization + Controls + Metrics
│ │ ├── api.ts     #API service layer (REST calls)
│ │ ├── types.ts     #Shared TypeScript types
│ │ ├── ui/
│ │ │ ├── Controls.tsx     #Start/Pause + Dynamic Add/Remove Machine Controls
│ │ │ └── Metrics.tsx     #Metrics & statistics panel
│ │ └── scene/
│ │ ├── Factory.tsx     #Three.js scene (3D visualization)
│ │ ├── MachineBox.tsx    #Machine cube component
│ │ └── ItemSphere.tsx    #Moving item component
│
└── README.md # (this file)
```

---

## ⚙️ Backend Setup (FastAPI)

### 1. Create & activate a virtual environment
```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # on Windows: .venv\Scripts\activate
```

### 2. Install dependencies
```bash
pip install -r requirements.txt
```

### 3. Run the FastAPI server
```bash
uvicorn main:app --reload --port 8000
```
The backend will start at **http://127.0.0.1:8000**  
Interactive API docs available at **http://127.0.0.1:8000/docs**.

---

## 💻 Frontend Setup (React + Three.js)

### 1. Install dependencies
```bash
cd ../frontend
npm install
```

### 2. Start the development server
```bash
npm run dev
```
The frontend runs by default at **http://localhost:5173** and communicates with the backend on port 8000.

---

## 🧠 Simulation Logic & Design

### Data Model
The backend holds an **in-memory list of machines**, e.g.:
```python
machines = [
    {"id": 1, "name": "Cutting",   "next": 2, "takt_time": 5.0, "buffer": 2},
    {"id": 2, "name": "Assembly",  "next": 3, "takt_time": 7.5, "buffer": 2},
    {"id": 3, "name": "Packaging", "next": None, "takt_time": 3.0, "buffer": 1}
]
```

### Core Concepts
- **Takt Time** – seconds per item a machine needs to process.
- **Buffer** – how many finished items can wait before transfer to the next machine.
- **Flow Logic** – an item only moves forward when the next buffer has room.
- **Simulation Clock** – a background thread steps time every 0.1s; pausing freezes the clock.

### Behavior
- Items are generated at the first machine if buffer space exists.
- Each machine processes one item at a time for `takt_time` seconds.
- When finished, items move to the next machine or are marked “completed” at the end of the line.
- Metrics tracked:
  - Total items started / completed
  - Items currently in system
  - Throughput (items per second)
  - Average cycle time per item
  - Per-machine utilization (% of time busy)

---

## 🎨 Frontend Visualization

Built with **React Three Fiber** (Three.js + React).

- Machines → 3D boxes labeled with their names.
- Items → moving spheres that approach, disappear “inside”, then emerge to the next stage.
- Colors:
  - 🟩 Green – currently processing
  - 🟨 Yellow – queued (waiting items)
  - 🟦 Blue – idle
- Control panel lets you **start**, **pause**, and **edit machine parameters** in real time.
- Metrics panel displays live statistics pulled from the `/state` endpoint every second.

---

## 🧮 Design Choices

- **FastAPI + background thread** → clean async simulation loop independent of requests.
- **Immutable state snapshots** → frontend polling or WebSocket updates stay consistent.
- **React Three Fiber** → minimal boilerplate 3D rendering integrated into React state.
- **TypeScript frontend** → safer prop handling and type-checked API integration.
- **Separation of Concerns** → backend purely logic; frontend purely visualization.

---

## 🧱 Extensible Features (extra credit ideas)

- ✅Dynamic addition/removal of machines via UI.
- WebSocket live updates instead of polling.
- Persistent save/load of simulation state.
- Historical throughput graphs over time.
- Multiple production lines or item types.

---

## 📄 License
MIT License – for educational and interview demonstration use.
