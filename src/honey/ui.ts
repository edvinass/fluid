import GUI from 'lil-gui';
import type { HoneyParams } from './HoneySimulator';
import { MATERIALS, SCENES, type SceneName } from './scenes';

/** Grid cells across the domain, and room for particles to match. */
export const QUALITY_LEVELS: Record<string, { cells: number; capacity: number }> = {
  Low: { cells: 48, capacity: 65536 },
  Medium: { cells: 64, capacity: 131072 },
  High: { cells: 80, capacity: 262144 },
  Ultra: { cells: 96, capacity: 393216 },
};

export interface HoneySettings {
  quality: string;
  autoQuality: boolean;
  scene: SceneName;
  material: string;
  /** Pour stream speed, world units / s. */
  pourRate: number;
  twirl: boolean;
  sim: HoneyParams;
  look: { refraction: number; smoothing: number; exposure: number };
}

export interface HoneyUIActions {
  chooseQuality(): void;
  setScene(): void;
  setMaterial(): void;
  clear(): void;
}

export function createHoneyUI(settings: HoneySettings, qualityLevels: string[], actions: HoneyUIActions): GUI {
  const gui = new GUI({ title: 'Settings' });

  const honey = gui.addFolder('Honey');
  honey.add(settings, 'quality', qualityLevels).name('Resolution').onChange(actions.chooseQuality).listen();
  honey.add(settings, 'scene', [...SCENES]).name('Scene').onChange(actions.setScene).listen();
  honey.add(settings, 'material', MATERIALS.map((m) => m.name)).name('Liquid').onChange(actions.setMaterial).listen();
  honey.add(settings.sim, 'viscosity', 0, 1.5, 0.005).name('Thickness (viscosity)').listen();
  honey.add(settings, 'pourRate', 0.1, 1.5, 0.05).name('Pour rate');
  honey.add(settings, 'twirl').name('Twirl the dipper (T)').listen();
  honey.add({ clear: actions.clear }, 'clear').name('Start again (C)');

  const physics = gui.addFolder('Physics');
  physics.add(settings.sim, 'gravity', 1, 15, 0.1).name('Gravity');
  physics.add(settings.sim, 'stiffness', 1, 8, 0.1).name('Incompressibility');
  physics.add(settings.sim, 'substeps', 2, 12, 1).name('Substeps');
  physics.add(settings.sim, 'viscosityIterations', 0, 60, 1).name('Viscosity iterations');
  physics.add(settings.sim, 'timeScale', 0.1, 2, 0.05).name('Time scale');
  physics.add(settings.sim, 'paused').name('Paused (Space)').listen();

  const view = gui.addFolder('Rendering');
  view.add(settings.look, 'smoothing', 0, 2, 0.05).name('Surface smoothing');
  view.add(settings.look, 'refraction', 0, 0.1, 0.005).name('Refraction');
  view.add(settings.look, 'exposure', 0.3, 2.5, 0.05).name('Exposure');
  view.add(settings, 'autoQuality').name('Auto quality').listen();

  physics.close();
  view.close();
  if (window.innerWidth < 700) gui.close();
  return gui;
}
