import GUI from 'lil-gui';
import type { LavaParams } from './LavaSimulator';
import type { LavaLook } from './LavaRenderer';
import { THEMES } from './themes';

/** Number of wax particles for each quality level. */
export const QUALITY_LEVELS: Record<string, number> = {
  Low: 8192,
  Medium: 16384,
  High: 32768,
  Ultra: 65536,
};

export interface LavaSettings {
  quality: string;
  autoQuality: boolean;
  theme: string;
  sim: LavaParams;
  look: Omit<LavaLook, 'wax' | 'liquid'>;
}

export interface LavaUIActions {
  chooseQuality(): void;
  setTheme(): void;
  restart(): void;
}

export function createLavaUI(settings: LavaSettings, qualityLevels: string[], actions: LavaUIActions): GUI {
  const gui = new GUI({ title: 'Settings' });

  const lamp = gui.addFolder('Lava lamp');
  lamp.add(settings, 'quality', qualityLevels).name('Resolution').onChange(actions.chooseQuality).listen();
  lamp.add(settings, 'theme', THEMES.map((t) => t.name)).name('Colours').onChange(actions.setTheme).listen();
  lamp.add(settings.sim, 'heat', 0, 3, 0.05).name('Bulb heat');
  lamp.add(settings.look, 'brightness', 0.2, 2, 0.05).name('Bulb brightness');
  lamp.add(settings.sim, 'timeScale', 0.25, 4, 0.05).name('Speed');
  lamp.add({ restart: actions.restart }, 'restart').name('Cool down and restart (C)');

  const physics = gui.addFolder('Physics');
  physics.add(settings.sim, 'buoyancy', 0, 4, 0.05).name('Buoyancy');
  physics.add(settings.sim, 'cooling', 0, 1, 0.01).name('Cooling');
  physics.add(settings.sim, 'cohesion', 0, 6, 0.1).name('Blob stickiness');
  physics.add(settings.sim, 'viscosity', 0, 20, 0.5).name('Wax viscosity');
  physics.add(settings.sim, 'drag', 0, 6, 0.1).name('Liquid drag');
  physics.add(settings.sim, 'substeps', 1, 8, 1).name('Substeps');
  physics.add(settings.sim, 'paused').name('Paused (Space)').listen();

  const view = gui.addFolder('Rendering');
  view.add(settings.look, 'smoothing', 0, 2, 0.05).name('Surface smoothing');
  view.add(settings.look, 'exposure', 0.3, 2.5, 0.05).name('Exposure');
  view.add(settings, 'autoQuality').name('Auto quality').listen();

  physics.close();
  view.close();
  if (window.innerWidth < 700) gui.close();
  return gui;
}
