# Fluid

A real-time, interactive 3D water simulation that runs in the browser. It uses Smoothed Particle Hydrodynamics (SPH), with the whole solver running on the GPU through WebGL2 fragment shaders, and draws the particles as a smooth liquid surface with screen-space fluid rendering.

## Running it

```bash
npm install
npm run dev      # start the dev server at http://localhost:5173
npm run build    # type-check and build a static site into dist/
npm run preview  # serve the production build locally
```

You need a browser with WebGL2 and support for rendering to float textures (`EXT_color_buffer_float`). All current desktop versions of Chrome, Edge, Firefox and Safari support this, as do most recent phones.

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit the camera |
| Scroll / pinch | Zoom |
| Shift + drag | Stir the water |
| Right drag | Attract water to the cursor |
| Shift + right drag | Repel water from the cursor |
| Alt + drag, arrow keys or WASD | Tilt the container |
| Space | Pause or resume |
| R | Reset the current scene |
| F | Switch between fluid and particle rendering |

The default is 32k particles on desktop and 16k on phones. With "Auto quality" turned on (the default), the particle count halves if the frame rate stays below 45 fps during the first few seconds after a scene loads.

On touch devices, pick what a one-finger drag does ("orbit", "stir", "attract", "repel" or "tilt") in the settings panel. Tilting your phone tilts the box once you allow motion access.

## How it works

Every particle's position and velocity is stored in a floating-point texture. Each simulation substep is a series of full-screen shader passes:

1. Hash each particle's predicted position into a uniform grid whose cell size equals the smoothing radius.
2. Sort the particles by cell with a GPU bitonic sort, then reorder the particle data so neighbours sit next to each other in memory.
3. Build a table of where each cell starts and ends in the sorted list, using a binary search per cell.
4. Compute density and near-density from neighbouring particles in the surrounding 27 cells.
5. Apply pressure, near-pressure and viscosity forces.
6. Integrate, and collide with the walls of the container.

The container simulates in its own local frame. When you tilt it, gravity is rotated into that frame and the water keeps its world-space motion, so it sloshes against the walls.

Rendering splats every particle as a sphere into a depth buffer, smooths that depth with a bilateral blur, rebuilds surface normals, and shades the result with Fresnel reflection, refraction and Beer-Lambert absorption based on an accumulated thickness buffer.

## Project layout

- `src/main.ts` sets everything up and runs the frame loop.
- `src/gl/` holds small WebGL2 helpers for programs, textures and framebuffers.
- `src/sim/` contains the SPH solver, the bitonic sort, the scene presets and the simulation shaders.
- `src/render/` contains the fluid renderer, the particle debug renderer and the container and environment.
- `src/interaction.ts` handles camera controls, mouse forces and tilting.
- `src/ui.ts` builds the settings panel.
