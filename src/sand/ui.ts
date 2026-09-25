import GUI from 'lil-gui';
import type { SandParams } from './SandSimulator';
import type { SandLook } from './SandRenderer';
import { MATERIALS, SCENES, type SceneName } from './scenes';

/** Grid cells across the domain, and room for particles to match. */
export const QUALITY_LEVELS: Record<string, { cells: number; capacity: number }> = {
  Low: { cells: 40, capacity: 49152 },
  Medium: { cells: 48, capacity: 98304 },
  High: { cells: 64, capacity: 196608 },
  Ultra: { cells: 80, capacity: 327680 },
};

export interface SandSettings {
  quality: string;
  autoQuality: boolean;
  scene: SceneName;
  material: string;
  /** Pour stream speed, world units / s. */
  pourRate: number;
  sim: SandParams;
  look: SandLook;
}

export interface SandUIActions {
  chooseQuality(): void;
  setScene(): void;
  setMaterial(): void;
  clear(): void;
}

export function createSandUI(settings: SandSettings, qualityLevels: string[], actions: SandUIActions): GUI {
  const gui = new GUI({ title: 'Settings' });

  const sand = gui.addFolder('Sand & snow');
  sand.add(settings, 'quality', qualityLevels).name('Resolution').onChange(actions.chooseQuality).listen();
  sand.add(settings, 'scene', [...SCENES]).name('Scene').onChange(actions.setScene).listen();
  sand.add(settings, 'material', MATERIALS.map((m) => m.name)).name('Pour').onChange(actions.setMaterial).listen();
  sand.add(settings, 'pourRate', 0.3, 3, 0.05).name('Pour rate');
  sand.add({ clear: actions.clear }, 'clear').name('Start again (C)');

  const physics = gui.addFolder('Physics');
  physics.add(settings.sim, 'gravity', 1, 15, 0.1).name('Gravity');
  physics.add(settings.sim, 'stiffness', 1, 8, 0.1).name('Stiffness');
  physics.add(settings.sim, 'friction', 0, 2, 0.05).name('Wall friction');
  physics.add(settings.sim, 'substeps', 2, 16, 1).name('Min substeps');
  physics.add(settings.sim, 'timeScale', 0.1, 2, 0.05).name('Time scale');
  physics.add(settings.sim, 'paused').name('Paused (Space)').listen();

  const view = gui.addFolder('Rendering');
  view.add(settings.look, 'smoothing', 0, 2, 0.05).name('Surface smoothing');
  view.add(settings.look, 'grainSize', 0.001, 0.01, 0.0005).name('Grain size');
  view.add(settings.look, 'exposure', 0.3, 2.5, 0.05).name('Exposure');
  view.add(settings, 'autoQuality').name('Auto quality').listen();

  physics.close();
  view.close();
  gui.close();
  return gui;
}
