import GUI from 'lil-gui';
import type { PlasmaLook } from './PlasmaRenderer';
import { MAX_FILAMENTS, type PlasmaParams } from './PlasmaSimulator';

export interface PlasmaSettings {
  sound: boolean;
  sim: PlasmaParams;
  look: PlasmaLook;
}

export interface PlasmaUIActions {
  setSound(): void;
  reset(): void;
}

export function createPlasmaUI(settings: PlasmaSettings, actions: PlasmaUIActions): GUI {
  const gui = new GUI({ title: 'Settings' });

  const globe = gui.addFolder('Globe');
  globe.add(settings.sim, 'count', 1, MAX_FILAMENTS, 1).name('Filaments');
  globe.add(settings.sim, 'voltage', 0.2, 2, 0.01).name('Voltage');
  globe.add(settings.sim, 'twist', 0, 2.5, 0.01).name('Twistiness');
  globe.add(settings.sim, 'tendrils', 0, 2.5, 0.01).name('Tendrils');
  globe.add(settings.sim, 'wander', 0, 5, 0.01).name('Drift');
  globe.add(settings.sim, 'flicker', 0, 2, 0.01).name('Flicker');
  globe.add(settings, 'sound').name('React to sound (M)').onChange(actions.setSound).listen();
  globe.add({ reset: actions.reset }, 'reset').name('Restart (R)');
  globe.add(settings.sim, 'timeScale', 0.1, 2, 0.05).name('Time scale');
  globe.add(settings.sim, 'paused').name('Paused (Space)').listen();

  const view = gui.addFolder('Rendering');
  view.add(settings.look, 'bloom', 0, 2, 0.01).name('Glow');
  view.add(settings.look, 'exposure', 0.2, 3, 0.05).name('Exposure');
  view.add(settings.look, 'roomLight', 0, 3, 0.05).name('Light on the table');

  view.close();
  gui.close();
  return gui;
}
