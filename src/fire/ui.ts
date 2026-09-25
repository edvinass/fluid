import GUI from 'lil-gui';
import type { FireParams } from './FireSimulator';
import { FLAME_COLOURS, SCENES, type SceneName } from './scenes';

/** Grid cells across the box, and the matching raymarch resolution relative to the screen. */
export const QUALITY_LEVELS: Record<string, { cells: number; renderScale: number }> = {
  Low: { cells: 56, renderScale: 0.45 },
  Medium: { cells: 72, renderScale: 0.5 },
  High: { cells: 96, renderScale: 0.6 },
  Ultra: { cells: 120, renderScale: 0.75 },
  Extreme: { cells: 144, renderScale: 0.9 },
  Max: { cells: 176, renderScale: 1 },
};

export interface FireSettings {
  quality: string;
  autoQuality: boolean;
  scene: SceneName;
  colour: string;
  size: number;
  sim: FireParams;
  look: {
    brightness: number;
    smoke: number;
    bloom: number;
    exposure: number;
    renderScale: number;
  };
}

export interface FireUIActions {
  chooseQuality(): void;
  setScene(): void;
  setColour(): void;
  clear(): void;
}

export function createFireUI(settings: FireSettings, qualityLevels: string[], actions: FireUIActions): GUI {
  const gui = new GUI({ title: 'Settings' });

  const fire = gui.addFolder('Fire');
  fire.add(settings, 'quality', qualityLevels).name('Resolution').onChange(actions.chooseQuality).listen();
  fire.add(settings, 'scene', [...SCENES]).name('Scene').onChange(actions.setScene).listen();
  fire.add(settings, 'colour', FLAME_COLOURS.map((c) => c.name)).name('Flame colour').onChange(actions.setColour).listen();
  fire.add(settings, 'size', 0.3, 2.5, 0.05).name('Fire size');
  fire.add(settings.sim, 'breeze', -1.5, 1.5, 0.05).name('Breeze');
  fire.add(settings.sim, 'swirl', 0, 15, 0.1).name('Turbulence');
  fire.add(settings.sim, 'soot', 0, 1, 0.01).name('Smokiness');
  fire.add({ clear: actions.clear }, 'clear').name('Put out (C)');

  const physics = gui.addFolder('Combustion');
  physics.add(settings.sim, 'buoyancy', 0.2, 5, 0.05).name('Buoyancy');
  physics.add(settings.sim, 'burnRate', 1, 20, 0.1).name('Burn rate');
  physics.add(settings.sim, 'heatRelease', 0.2, 3, 0.05).name('Heat release');
  physics.add(settings.sim, 'cooling', 0.1, 5, 0.05).name('Cooling');
  physics.add(settings.sim, 'smokeFade', 0, 2, 0.01).name('Smoke fade');
  physics.add(settings.sim, 'timeScale', 0.1, 2, 0.05).name('Time scale');
  physics.add(settings.sim, 'paused').name('Paused (Space)').listen();

  const view = gui.addFolder('Rendering');
  view.add(settings.look, 'brightness', 1, 40, 0.5).name('Flame brightness');
  view.add(settings.look, 'smoke', 0, 80, 1).name('Smoke opacity');
  view.add(settings.look, 'bloom', 0, 2, 0.05).name('Glow');
  view.add(settings.look, 'exposure', 0.2, 3, 0.05).name('Exposure');
  view.add(settings.look, 'renderScale', 0.3, 1, 0.05).name('Render sharpness').listen();
  view.add(settings, 'autoQuality').name('Auto quality').listen();
  view.add(settings.sim, 'pressureIterations', 8, 60, 1).name('Solver iterations');

  physics.close();
  view.close();
  if (window.innerWidth < 700) gui.close();
  return gui;
}
