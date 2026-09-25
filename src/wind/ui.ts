import GUI from 'lil-gui';
import { SHAPES, type ObjectSettings } from './obstacle';
import type { SmokeParams, WindParams } from './WindSimulator';

/** Grid cells along the tunnel, and the matching raymarch resolution relative to the screen. */
export const QUALITY_LEVELS: Record<string, { cells: number; renderScale: number }> = {
  Low: { cells: 128, renderScale: 0.45 },
  Medium: { cells: 160, renderScale: 0.5 },
  High: { cells: 208, renderScale: 0.6 },
  Ultra: { cells: 256, renderScale: 0.75 },
  Extreme: { cells: 320, renderScale: 0.9 },
  Max: { cells: 384, renderScale: 1 },
};

export interface WindSettings {
  quality: string;
  autoQuality: boolean;
  sim: WindParams;
  object: ObjectSettings;
  smoke: SmokeParams;
  look: {
    theme: 'light' | 'dark';
    density: number;
    shadow: number;
    pressure: boolean;
    renderScale: number;
  };
}

export interface WindUIActions {
  /** Called when the user picks a resolution. */
  chooseQuality(): void;
  setShape(): void;
  resetObject(): void;
  resetFlow(): void;
  setTheme(): void;
}

export function createWindUI(settings: WindSettings, qualityLevels: string[], actions: WindUIActions): GUI {
  const gui = new GUI({ title: 'Settings' });

  const tunnel = gui.addFolder('Tunnel');
  tunnel.add(settings, 'quality', qualityLevels).name('Resolution').onChange(actions.chooseQuality).listen();
  tunnel.add(settings.sim, 'wind', 0, 2.5, 0.05).name('Wind speed');
  tunnel.add(settings.sim, 'turbulence', 0, 0.3, 0.005).name('Turbulence');
  tunnel.add(settings.sim, 'swirl', 0, 10, 0.1).name('Swirl');
  tunnel.add(settings.sim, 'timeScale', 0.1, 2, 0.05).name('Time scale');
  tunnel.add(settings.sim, 'paused').name('Paused (Space)').listen();
  tunnel.add({ reset: actions.resetFlow }, 'reset').name('Restart flow (R)');

  const object = gui.addFolder('Object');
  object.add(settings.object, 'shape', [...SHAPES]).name('Shape').onChange(actions.setShape).listen();
  object.add(settings.object, 'angle', -30, 30, 0.5).name('Angle of attack').listen();
  object.add(settings.object, 'yaw', -60, 60, 1).name('Yaw').listen();
  object.add(settings.object, 'size', 0.5, 1.6, 0.05).name('Size');
  object.add(settings.look, 'pressure').name('Show surface pressure (P)').listen();
  object.add({ reset: actions.resetObject }, 'reset').name('Recentre object');

  const smoke = gui.addFolder('Smoke');
  smoke.add(settings.smoke, 'rake', ['Vertical', 'Horizontal', 'Grid', 'Off']).name('Smoke rake');
  smoke.add(settings.smoke, 'streams', 2, 32, 1).name('Streams');
  smoke.add(settings.smoke, 'width', 0.005, 0.05, 0.001).name('Stream width');
  smoke.add(settings.smoke, 'colour', ['White', 'Rainbow', 'Speed']).name('Colour').listen();
  smoke.add(settings.smoke, 'pulse').name('Pulsed streaks');
  smoke.add(settings.smoke, 'fade', 0, 1, 0.01).name('Fade');

  const view = gui.addFolder('Rendering');
  view.add(settings.look, 'theme', ['light', 'dark']).name('Studio').onChange(actions.setTheme);
  view.add(settings.look, 'density', 5, 150, 1).name('Smoke opacity');
  view.add(settings.look, 'shadow', 0, 3, 0.05).name('Self shadowing');
  view.add(settings.look, 'renderScale', 0.3, 1, 0.05).name('Render sharpness').listen();
  view.add(settings, 'autoQuality').name('Auto quality').listen();
  view.add(settings.sim, 'pressureIterations', 8, 80, 1).name('Solver iterations');

  smoke.close();
  view.close();
  if (window.innerWidth < 700) gui.close();
  return gui;
}
