import GUI from 'lil-gui';
import { DRAG_ACTIONS, type InteractionSettings } from './interaction';
import { PRESET_NAMES, type PresetName } from './sim/presets';
import type { SimParams } from './sim/SPHSimulator';

export type RenderMode = 'fluid' | 'particles';

export interface RenderSettings {
  mode: RenderMode;
  waterColor: string;
  absorption: number;
  refraction: number;
  smoothing: number;
  resolution: number;
}

export interface AppSettings {
  preset: PresetName;
  /** Halve the particle count automatically if the frame rate stays low after a reset. */
  autoQuality: boolean;
  sim: SimParams;
  interaction: InteractionSettings;
  render: RenderSettings;
}

export interface UIActions {
  loadPreset(preset: PresetName): void;
  reset(): void;
  resetTilt(): void;
  setDeviceTilt(enabled: boolean): Promise<boolean>;
  resize(): void;
}

export const PARTICLE_COUNTS: Record<string, number> = {
  '8k': 8192,
  '16k': 16384,
  '32k': 32768,
  '65k': 65536,
};

export function createUI(settings: AppSettings, actions: UIActions): GUI {
  const gui = new GUI({ title: 'Settings' });

  const scenes = gui.addFolder('Scenes');
  const presetButtons: Record<string, () => void> = {};
  for (const name of PRESET_NAMES) presetButtons[name] = () => actions.loadPreset(name);
  for (const name of PRESET_NAMES) scenes.add(presetButtons, name);
  scenes.add({ Reset: () => actions.reset() }, 'Reset').name('Reset (R)');

  const sim = gui.addFolder('Simulation');
  sim.add(settings.sim, 'particleCount', PARTICLE_COUNTS).name('Particles').onChange(() => actions.reset()).listen();
  sim.add(settings, 'autoQuality').name('Auto quality');
  sim.add(settings.sim, 'paused').name('Paused (Space)').listen();
  sim.add(settings.sim, 'timeScale', 0.1, 2, 0.05).name('Time scale');
  sim.add(settings.sim, 'substeps', 1, 10, 1).name('Substeps / frame');
  sim.add(settings.sim, 'gravity', 0, 25, 0.1).name('Gravity');
  sim.add(settings.sim, 'pressure', 5, 400, 1).name('Stiffness');
  sim.add(settings.sim, 'nearPressure', 0, 40, 0.1).name('Near pressure');
  sim.add(settings.sim, 'viscosity', 0, 30, 0.1).name('Viscosity');
  sim.add(settings.sim, 'restitution', 0, 1, 0.01).name('Wall bounce');

  const interact = gui.addFolder('Interaction');
  interact.add(settings.interaction, 'dragAction', DRAG_ACTIONS).name('Drag action');
  interact.add(settings.interaction, 'radius', 0.1, 1, 0.01).name('Brush radius');
  interact.add(settings.interaction, 'strength', 5, 120, 1).name('Brush strength');
  const deviceTilt = interact
    .add(settings.interaction, 'deviceTilt')
    .name('Device tilt')
    .onChange(async (enabled: boolean) => {
      const ok = await actions.setDeviceTilt(enabled);
      if (enabled && !ok) {
        settings.interaction.deviceTilt = false;
        deviceTilt.updateDisplay();
      }
    });
  interact.add({ resetTilt: () => actions.resetTilt() }, 'resetTilt').name('Reset tilt');

  const render = gui.addFolder('Rendering');
  render.add(settings.render, 'mode', ['fluid', 'particles']).name('Mode (F)').listen();
  render.addColor(settings.render, 'waterColor').name('Water color');
  render.add(settings.render, 'absorption', 0, 4, 0.01).name('Absorption');
  render.add(settings.render, 'refraction', 0, 0.15, 0.001).name('Refraction');
  render.add(settings.render, 'smoothing', 0, 2, 0.01).name('Smoothing');
  render.add(settings.render, 'resolution', 0.5, 1, 0.05).name('Resolution').onFinishChange(() => actions.resize());

  interact.close();
  render.close();
  gui.close();
  return gui;
}
