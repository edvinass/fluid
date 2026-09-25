# Fluid

Three real-time, interactive 3D fluid visualisations that run in the browser:

- **Water** (`index.html`): a tank of water made of particles that you can slosh, stir and tilt.
- **Paint** (`paint.html`): pour coloured paint into a glass tank of water and watch it sink, curl and mix.
- **Wind** (`wind.html`): a wind tunnel where smoke streams around a wing, a car and other shapes.

Switch between them with the Water / Paint / Wind toggle in the top-left corner.

## Water

The water page is a real-time, interactive 3D water simulation. It uses Smoothed Particle Hydrodynamics (SPH), with the whole solver running on the GPU through WebGL2 fragment shaders, and draws the particles as a smooth liquid surface with screen-space fluid rendering.

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

## Paint

| Input | Action |
| --- | --- |
| Click or hold | Pour paint above the point under the cursor |
| Shift + drag | Stir the water |
| Right drag or Ctrl + drag | Orbit the camera |
| Scroll / pinch | Zoom |
| 1 to 9, 0 | Pick a colour, or rainbow |
| C | Clear the tank |
| Space | Pause or resume |

On touch devices, one finger pours and two fingers orbit and zoom. When nobody is pouring, the page pours paint on its own after a few seconds (turn this off with "Auto pour when idle").

The "Resolution" setting at the top of the Paint panel sets how finely the paint is simulated and drawn, from Low (48 cells across) to Max (176 cells across). The default is Ultra on desktop and Medium on phones. Auto quality only ever steps the resolution down, and choosing one yourself turns auto quality off. Levels that exceed your GPU's texture size limit are hidden.

The paint page uses a different technique from the water page: an incompressible fluid solved on a 3D grid ("stable fluids"). The grid is stored as a 2D atlas of z-slices, so every step is one full-screen shader pass. Each frame it:

1. Advects the velocity field through itself.
2. Adds vorticity confinement (to keep small swirls alive), the downward pull of the heavier paint, and the velocity of any pour or stir.
3. Solves for pressure with Jacobi iterations and removes the divergent part of the velocity.
4. Advects the paint with MacCormack advection, which keeps filaments sharp, and injects new paint.

The paint is drawn by raymarching through the volume with self-shadowing. The floor shadow under the tank takes on the colour of the paint the light passes through.

## Wind

| Input | Action |
| --- | --- |
| Drag the object | Move it around the tunnel |
| Click or hold elsewhere | Hold a smoke wand at that spot |
| Right drag or Ctrl + drag | Orbit the camera |
| Scroll / pinch | Zoom |
| 1 to 5 | Sphere, cylinder, cube, wing or car |
| [ and ] | Change the angle of attack |
| P | Colour the object by surface pressure |
| S | Cycle the smoke colour (white, rainbow, speed) |
| R | Restart the flow |
| Space | Pause or resume |

The wind tunnel uses the same grid solver as the paint page, with different boundaries. Air enters at the left end at the chosen wind speed, with a little turbulence. It leaves freely at the right end and slips along the walls. Every frame, the object is sampled into the grid from a signed distance function, so it can be moved, resized and rotated while the air flows. A rake of smoke emitters at the inlet follows the object's height and depth. You can lay the streams out as a vertical sheet, a horizontal sheet or a grid, and pulse them into dashes that show how fast the air is moving.

"Show surface pressure" colours the object by pressure coefficient. Blue is suction and red is where the air piles up against the object. The "Speed" smoke colour shows slow air in blue and air sped up around the object in red. Try the cylinder for a von Kármán vortex street, and tilt the wing to see the flow separate at high angles of attack.

## Project layout

- `src/main.ts` sets up the water page and runs its frame loop.
- `src/paint/` contains the paint page: the grid solver, volume renderer, pouring interaction, palette and settings.
- `src/wind/` contains the wind tunnel page: the tunnel solver, the object shapes, the smoke and object renderer, and the drag and smoke-wand interaction.
- `src/gl/` holds small WebGL2 helpers for programs, textures and framebuffers.
- `src/sim/` contains the SPH solver, the bitonic sort, the scene presets and the simulation shaders.
- `src/render/` contains the fluid renderer, the particle debug renderer and the container and environment.
- `src/interaction.ts` handles camera controls, mouse forces and tilting.
- `src/ui.ts` builds the settings panel.
