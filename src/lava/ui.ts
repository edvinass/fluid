import GUI from 'lil-gui';
import type { LavaParams } from './LavaSimulator';
import type { LavaLook } from './LavaRenderer';
import { THEMES } from './themes';

export interface LavaSettings {
  theme: string;
  sim: LavaParams;
  look: Omit<LavaLook, 'wax' | 'liquid'>;
}

export interface LavaUIActions {
  setTheme(): void;
  restart(): void;
}

export function createLavaUI(settings: LavaSettings, actions: LavaUIActions): GUI {
  const gui = new GUI({ title: 'Settings' });

  const lamp = gui.addFolder('Lava lamp');
  lamp.add(settings, 'theme', THEMES.map((t) => t.name)).name('Colours').onChange(actions.setTheme).listen();
  lamp.add(settings.sim, 'waxAmount', 0.05, 0.2, 0.01).name('Wax amount').onFinishChange(actions.restart);
  lamp.add(settings.sim, 'heat', 0, 3, 0.05).name('Bulb heat');
  lamp.add(settings.look, 'brightness', 0.2, 2, 0.05).name('Bulb brightness');
  lamp.add(settings.sim, 'timeScale', 0.25, 6, 0.05).name('Speed');
  lamp.add({ restart: actions.restart }, 'restart').name('Cool down and restart (C)');

  const physics = gui.addFolder('Physics');
  physics.add(settings.sim, 'buoyancy', 0, 2, 0.01).name('Buoyancy');
  physics.add(settings.sim, 'cooling', 0, 0.3, 0.005).name('Cooling');
  physics.add(settings.sim, 'drag', 0.5, 12, 0.1).name('Liquid thickness');
  physics.add(settings.sim, 'paused').name('Paused (Space)').listen();

  const view = gui.addFolder('Rendering');
  view.add(settings.look, 'exposure', 0.3, 2.5, 0.05).name('Exposure');

  physics.close();
  view.close();
  gui.close();
  return gui;
}
