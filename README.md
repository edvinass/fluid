# Fluid

Six real-time, interactive 3D fluid visualisations that run in the browser:

- **Water** (`index.html`): a tank of water made of particles that you can slosh, stir and tilt.
- **Paint** (`paint.html`): pour coloured paint into a glass tank of water and watch it sink, curl and mix.
- **Wind** (`wind.html`): a wind tunnel where smoke streams around a wing, a car and other shapes.
- **Fire** (`fire.html`): a campfire, a gas burner, fireballs and a torch you can wield, at night.
- **Bubble** (`bubble.html`): a soap bubble whose film swirls and shimmers with interference colours until it pops.
- **Honey** (`honey.html`): drizzle honey onto a plate, lift a honey dipper out of a bowl, or drop blobs of syrup, caramel and chocolate.

Switch between them with the toggle in the top-left corner.

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

## Fire

| Input | Action |
| --- | --- |
| Click or hold | Wield a torch at the cursor |
| Shift + drag | Blow on the flames |
| Right drag or Ctrl + drag | Orbit the camera |
| Scroll / pinch | Zoom |
| 1 to 4 | Campfire, gas burner, fireballs or torch |
| C | Put the fire out |
| Space | Pause or resume |

The bottom bar also picks a flame colour. Besides natural fire, you can choose the colours of a flame test: blue gas, copper green, potassium violet, strontium red and sodium yellow.

The fire runs on the same grid solver as the paint page. The grid carries temperature, smoke and fuel alongside the velocity. Fuel burns once it's hot enough, releasing heat and soot. Heat makes the gas rise, and it cools as it climbs, so flames turn into smoke. The ground is solid, and the sides and top are open, so the fire draws in fresh air. The campfire logs and stones and the gas burner are signed distance functions sampled into the grid, so the flames flow around them.

Each frame, the fire's total glow and its centre are summed on the GPU into a single texel. That turns the fire into a flickering point light for the ground, the stones, the logs and the smoke. The flames are raymarched as glowing, light-absorbing gas, then bloom and filmic tone mapping are applied.

## Bubble

| Input | Action |
| --- | --- |
| Drag across the bubble | Stir the film |
| Drag beside it or right drag | Orbit the camera |
| Scroll / pinch | Zoom |
| Double-click or P | Pop the bubble where you clicked |
| R | Blow a new bubble |
| Space | Pause or resume |

The bottom bar switches between a dark photo studio and a sunny meadow. Bubbles pop by themselves after a while (turn this off with "Pop by itself"), and a new one inflates straight away.

The soap film is simulated as a thin, incompressible 2D fluid flowing over the surface of the sphere. Its velocity and thickness are stored in cube maps, so every step is a shader pass per cube face, with neighbour lookups crossing seamlessly between faces. Each frame it:

1. Advects the velocity along the sphere.
2. Adds buoyancy (thick film is heavier and slides down, thin film rises), vorticity confinement, a gentle breeze and the stir from your pointer.
3. Solves for pressure with Jacobi iterations, weighting each neighbour by its true distance on the sphere.
4. Advects the thickness with MacCormack advection, drains liquid from the top towards the bottom, and now and then thins a patch near the bottom, which rises as a colourful plume.

The bubble is ray traced in one pass. At its front and back surfaces, the colour comes from thin-film interference: light reflected off the film's inner and outer faces cancels or reinforces depending on thickness, angle and wavelength. The shader sums that over 16 wavelengths, converts to colour with the CIE colour matching functions and reflects the environment with it. As the top of the bubble drains, its film fades from rich colours to pale silver and gold. Left long enough (turn off "Pop by itself"), it thins into black film, which barely reflects at all. The "Resolution" setting sets the size of each cube face, from Low (128 texels) to Max (768).

## Honey

| Input | Action |
| --- | --- |
| Click or drag | Drizzle: move the dipper. Dipper: lift and move it. Drop: drop a blob |
| Right drag or Ctrl + drag | Orbit the camera |
| Scroll / pinch | Zoom |
| 1 to 3 | Drizzle, dipper or drop |
| T | Twirl the dipper |
| C | Start again |
| Space | Pause or resume |

The bottom bar picks the liquid: honey, maple syrup, caramel, chocolate or water. Each has its own viscosity and colour, and you can change the viscosity separately. On touch devices, one finger acts and two fingers orbit and zoom. When nobody is interacting, each scene plays by itself: the drizzle traces loops across the plate, the dipper lifts out of the bowl and drips, and blobs drop now and then.

Thick liquids are hard for the methods the other pages use, so this page uses the Material Point Method (MLS-MPM). Particles carry the liquid, and a background grid (stored as a 2D atlas of slices, like the paint page) does the physics. Each substep:

1. Transfers the particles' mass and momentum to the 27 grid nodes around each one. The GPU does this by drawing a point per particle and node, with additive blending (this needs `EXT_float_blend`).
2. Turns momentum into velocity, adds gravity, and makes nodes inside the plate, bowl or dipper take on that object's velocity, so the liquid sticks.
3. Solves viscosity implicitly with Jacobi iterations, which stays stable however thick the liquid is.
4. Transfers the new velocities and their gradients back to the particles, moves them and keeps them out of the scenery.

Pressure comes from how much each particle's volume has changed, which keeps the liquid nearly incompressible. The table, plate, bowl and dipper are ray marched with soft shadows, and the liquid is drawn with the water page's screen-space technique. The liquid is shaded as a clear, amber liquid. What's behind it is bent by refraction and tinted by Beer-Lambert absorption, so thin films glow gold and thick pools turn deep amber. Domes of liquid focus bright caustics onto the dish, and the surface reflects the room's windows. The "Resolution" setting sets the grid (48 to 96 cells across) and how many particles fit, from 65k to 393k. Pouring stops when the particle budget is full.

## Project layout

- `src/main.ts` sets up the water page and runs its frame loop.
- `src/paint/` contains the paint page: the grid solver, volume renderer, pouring interaction, palette and settings.
- `src/fire/` contains the fire page: the combustion solver, the scenes and scenery, the flame renderer with bloom, and the torch interaction.
- `src/bubble/` contains the bubble page: the film solver on cube maps, the thin-film ray tracer, the stirring and popping interaction and the lifecycle of each bubble.
- `src/honey/` contains the honey page: the MPM solver, the scenes and liquids, the table-top renderer and the dipper interaction.
- `src/wind/` contains the wind tunnel page: the tunnel solver, the object shapes, the smoke and object renderer, and the drag and smoke-wand interaction.
- `src/gl/` holds small WebGL2 helpers for programs, textures and framebuffers.
- `src/sim/` contains the SPH solver, the bitonic sort, the scene presets and the simulation shaders.
- `src/render/` contains the fluid renderer, the particle debug renderer and the container and environment.
- `src/interaction.ts` handles camera controls, mouse forces and tilting.
- `src/ui.ts` builds the settings panel.
