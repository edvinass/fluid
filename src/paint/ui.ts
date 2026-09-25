import GUI from 'lil-gui';
import type { PourSettings } from './interaction';
import type { PaintParams } from './PaintSimulator';

/** Grid cells across the tank width, and the matching raymarch resolution relative to the screen. */
export const QUALITY_LEVELS: Record<string, { cells: number; renderScale: number }> = {
  Low: { cells: 48, renderScale: 0.45 },
  Medium: { cells: 64, renderScale: 0.5 },
  High: { cells: 80, renderScale: 0.6 },
  Ultra: { cells: 112, renderScale: 0.75 },
  Extreme: { cells: 144, renderScale: 0.9 },
  Max: { cells: 176, renderScale: 1 },
};

export interface PaintSettings {
  quality: string;
  autoQuality: boolean;
  sim: PaintParams;
  pour: PourSettings;
  look: {
    theme: 'light' | 'dark';
    density: number;
    shadow: number;
    renderScale: number;
  };
}

export interface PaintUIActions {
  /** Called when the user picks a resolution. */
  chooseQuality(): void;
  clear(): void;
  setTheme(): void;
}

export function createPaintUI(settings: PaintSettings, qualityLevels: string[], actions: PaintUIActions): GUI {
  const gui = new GUI({ title: 'Settings' });

  const paint = gui.addFolder('Paint');
  paint.add(settings, 'quality', qualityLevels).name('Resolution').onChange(actions.chooseQuality).listen();
  paint.add(settings.pour, 'rate', 1, 30, 0.5).name('Pour amount');
  paint.add(settings.pour, 'width', 0.02, 0.12, 0.005).name('Stream width');
  paint.add(settings.pour, 'speed', 0.1, 2.5, 0.05).name('Pour speed');
  paint.add(settings.sim, 'weight', 0, 3, 0.05).name('Paint weight');
  paint.add(settings.sim, 'fade', 0, 0.5, 0.005).name('Fade');
  paint.add(settings.pour, 'autoPour').name('Auto pour when idle');
  paint.add({ clear: actions.clear }, 'clear').name('Clear tank (C)');

  const water = gui.addFolder('Water');
  water.add(settings.sim, 'swirl', 0, 12, 0.1).name('Swirl');
  water.add(settings.sim, 'drag', 0, 2, 0.01).name('Drag');
  water.add(settings.sim, 'timeScale', 0.1, 2, 0.05).name('Time scale');
  water.add(settings.sim, 'paused').name('Paused (Space)').listen();

  const view = gui.addFolder('Rendering');
  view.add(settings.look, 'theme', ['light', 'dark']).name('Studio').onChange(actions.setTheme);
  view.add(settings.look, 'density', 5, 150, 1).name('Paint opacity');
  view.add(settings.look, 'shadow', 0, 3, 0.05).name('Self shadowing');
  view.add(settings.look, 'renderScale', 0.3, 1, 0.05).name('Render sharpness').listen();
  view.add(settings, 'autoQuality').name('Auto quality').listen();
  view.add(settings.sim, 'pressureIterations', 8, 60, 1).name('Solver iterations');

  water.close();
  view.close();
  if (window.innerWidth < 700) gui.close();
  return gui;
}
