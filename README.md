# Magnetic Building Toy Simulator

A 3D simulation of a magnetic construction toy (like Geomag) built with Bun, TypeScript, and Three.js. Build complex 3D structures by connecting steel balls with magnetic shafts.

## Features

- Interactive 3D environment with camera controls (rotate, zoom, pan)
- Steel balls with magnetic connection points
- Two shaft sizes:
  - **Small shafts** (2 units): Perfect for creating cube edges
  - **Large shafts** (3.464 units): Perfect for diagonal connections across cubes
- **Smart constraint solving**: Automatically adjusts entire structures to satisfy shaft length requirements
- Click-based interface for adding balls and connecting them with shafts
- Automatic magnetic snapping when balls are the correct distance apart
- Click shaft ends to instantly create and connect new balls
- Real-time 3D rendering with realistic metallic materials
- Visual feedback with color-coded notifications (success/warning/error)

## Installation

```bash
bun install
```

## Running the Application

```bash
bun dev
```

Then open your browser to `http://localhost:3000`

## How to Use

1. **Add Balls**: Click the "Add Ball" button to create a new steel ball at the origin
2. **Select Shaft Size**: Choose between Small or Large shafts
3. **Connect Balls**: 
   - Click on a ball to attach a shaft
   - Click on another ball to connect the shaft (if the distance is correct)
4. **Build Structures**: Create cubes, pyramids, hexagons, and complex 3D shapes

### Controls

- **Left Click**: Select balls and connect shafts
- **Right Click + Drag**: Rotate camera
- **Mouse Wheel**: Zoom in/out
- **Middle Click + Drag**: Pan camera

## Technical Details

### Dimensions

The sizing is carefully calculated to allow building perfect cubes:

- **Ball Radius**: 0.5 units
- **Small Shaft Length**: 2 units (for cube edges)
- **Large Shaft Length**: 3.464 units (√3 × 2, for cube diagonals)

This means you can:
- Create a cube using small shafts for edges
- Connect opposite corners with large shafts for structural support
- Build complex geometric patterns and structures

### Technologies

- **Bun**: Fast JavaScript runtime and bundler
- **TypeScript**: Type-safe development
- **Three.js**: 3D rendering and graphics
- **OrbitControls**: Intuitive camera controls

This project was created using `bun init` in bun v1.3.0. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

