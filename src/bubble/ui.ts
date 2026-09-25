import GUI from 'lil-gui';
import type { BubbleParams } from './BubbleSimulator';
import type { BubbleLook } from './BubbleRenderer';

/** Texels along each cube face of the film. */
export const QUALITY_LEVELS: Record<string, number> = {
  Low: 128,
  Medium: 192,
  High: 256,
  Ultra: 384,
  Extreme: 512,
  Max: 768,
};

export interface BubbleSettings {
  quality: string;
  autoQuality: boolean;
  autoPop: boolean;
  /** Seconds before a bubble pops by itself. */
  lifetime: number;
  sim: BubbleParams;
  look: BubbleLook;
}

export interface BubbleUIActions {
  chooseQuality(): void;
  setEnvironment(): void;
  pop(): void;
  newBubble(): void;
}

export function createBubbleUI(settings: BubbleSettings, qualityLevels: string[], actions: BubbleUIActions): GUI {
  const gui = new GUI({ title: 'Settings' });

  const bubble = gui.addFolder('Bubble');
  bubble.add(settings, 'quality', qualityLevels).name('Resolution').onChange(actions.chooseQuality).listen();
  bubble.add(settings.look, 'environment', ['Studio', 'Daylight']).name('Lighting').onChange(actions.setEnvironment).listen();
  bubble.add(settings.sim, 'thickness', 0.2, 1.2, 0.01).name('Film thickness (µm)');
  bubble.add(settings.sim, 'convection', 0, 20, 0.1).name('Swirling');
  bubble.add(settings.sim, 'turbulence', 0, 3, 0.01).name('Breeze');
  bubble.add(settings.sim, 'plumes', 0, 4, 0.05).name('Rising plumes');
  bubble.add(settings, 'autoPop').name('Pop by itself');
  bubble.add(settings, 'lifetime', 5, 120, 1).name('Lifetime (s)');
  bubble.add({ pop: actions.pop }, 'pop').name('Pop (P)');
  bubble.add({ newBubble: actions.newBubble }, 'newBubble').name('New bubble (R)');

  const physics = gui.addFolder('Film physics');
  physics.add(settings.sim, 'swirl', 0, 10, 0.1).name('Vorticity');
  physics.add(settings.sim, 'drainage', 0, 0.3, 0.005).name('Drainage');
  physics.add(settings.sim, 'evaporation', 0, 0.05, 0.001).name('Evaporation');
  physics.add(settings.sim, 'drag', 0, 2, 0.01).name('Drag');
  physics.add(settings.sim, 'timeScale', 0.1, 2, 0.05).name('Time scale');
  physics.add(settings.sim, 'paused').name('Paused (Space)').listen();

  const view = gui.addFolder('Rendering');
  view.add(settings.look, 'exposure', 0.2, 3, 0.05).name('Exposure');
  view.add(settings.look, 'filmIndex', 1.2, 1.6, 0.01).name('Refractive index');
  view.add(settings, 'autoQuality').name('Auto quality').listen();
  view.add(settings.sim, 'pressureIterations', 4, 60, 1).name('Solver iterations');

  physics.close();
  view.close();
  if (window.innerWidth < 700) gui.close();
  return gui;
}
