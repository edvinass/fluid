import './style.css';
import { Color, PerspectiveCamera } from 'three';
import { createContext, UnsupportedError } from './gl/context';
import { Interaction } from './interaction';
import { buildViewState } from './render/camera';
import { Container } from './render/Container';
import { FluidRenderer } from './render/FluidRenderer';
import { ParticleRenderer } from './render/ParticleRenderer';
import type { PresetName } from './sim/presets';
import { SPHSimulator, type Vec3 } from './sim/SPHSimulator';
import { createUI, type AppSettings } from './ui';

const BOX_HALF: Vec3 = [1.2, 0.75, 0.6];
const BASE_ABSORPTION: Vec3 = [3.6, 1.3, 0.7];
const MAX_DEVICE_PIXEL_RATIO = 2;
const AUTO_QUALITY_MIN_FPS = 45;
const MIN_AUTO_PARTICLES = 8192;

function showError(message: string): void {
  const el = document.getElementById('error')!;
  document.getElementById('error-message')!.textContent = message;
  el.hidden = false;
}

function defaultParticleCount(): number {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 700;
  return mobile ? 16384 : 32768;
}

function start(): void {
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  try {
    gl = createContext(canvas);
  } catch (err) {
    showError(err instanceof UnsupportedError ? err.message : String(err));
    return;
  }

  const settings: AppSettings = {
    preset: 'Dam Break',
    autoQuality: true,
    sim: {
      particleCount: defaultParticleCount(),
      substeps: 4,
      timeScale: 1,
      gravity: 9.8,
      pressure: 60,
      nearPressure: 4,
      viscosity: 4,
      restitution: 0.2,
      paused: false,
    },
    interaction: {
      dragAction: 'orbit',
      radius: 0.35,
      strength: 40,
      deviceTilt: false,
    },
    render: {
      mode: 'fluid',
      waterColor: '#2b9be0',
      absorption: 1,
      refraction: 0.04,
      smoothing: 1,
      resolution: 1,
    },
  };

  const camera = new PerspectiveCamera(45, 1, 0.05, 100);
  camera.position.set(2.6, 1.8, 3.4);
  camera.lookAt(0, 0, 0);

  const sim = new SPHSimulator(gl, BOX_HALF);
  const container = new Container(gl, BOX_HALF);
  const fluidRenderer = new FluidRenderer(gl);
  const particleRenderer = new ParticleRenderer(gl);
  const interaction = new Interaction(camera, canvas, settings.interaction);

  let accumulator = 0;
  let lastReset = performance.now();
  let slowSamples = 0;
  const reset = () => {
    sim.reset(settings.sim.particleCount, settings.preset);
    interaction.syncAppliedRotation();
    accumulator = 0;
    lastReset = performance.now();
    slowSamples = 0;
  };
  const loadPreset = (preset: PresetName) => {
    settings.preset = preset;
    reset();
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO) * settings.render.resolution;
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  reset();

  createUI(settings, {
    loadPreset,
    reset,
    resetTilt: () => interaction.resetTilt(),
    setDeviceTilt: (enabled) => interaction.setDeviceTilt(enabled),
    resize,
  });

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    if (e.code === 'Space') {
      settings.sim.paused = !settings.sim.paused;
      e.preventDefault();
    } else if (e.code === 'KeyR') {
      reset();
    } else if (e.code === 'KeyF') {
      settings.render.mode = settings.render.mode === 'fluid' ? 'particles' : 'fluid';
    }
  });

  const help = document.getElementById('help')!;
  document.getElementById('help-toggle')!.addEventListener('click', () => {
    const collapsed = help.classList.toggle('collapsed');
    document.getElementById('help-toggle')!.setAttribute('aria-expanded', String(!collapsed));
  });

  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, { fluid: { sim, settings, interaction, stats: () => sim.readStats() } });
  }

  const statsEl = document.getElementById('stats')!;
  const waterColor = new Color();
  let frames = 0;
  let fpsTime = performance.now();
  let last = performance.now();

  const frame = (now: number) => {
    const realDt = Math.min((now - last) / 1000, 0.1);
    last = now;

    interaction.update(realDt);

    const params = settings.sim;
    if (params.paused) {
      interaction.syncAppliedRotation();
      accumulator = 0;
    } else {
      const fixedDt = 1 / (60 * params.substeps);
      accumulator += realDt * params.timeScale;
      const maxSteps = params.substeps * 2;
      let steps = Math.floor(accumulator / fixedDt);
      if (steps > maxSteps) {
        steps = maxSteps;
        accumulator = 0;
      } else {
        accumulator -= steps * fixedDt;
      }
      if (steps > 0) {
        const input = {
          frameRotation: interaction.consumeFrameRotation(),
          gravityDir: interaction.gravityDir(),
          mouse: interaction.mouse,
        };
        for (let i = 0; i < steps; i++) sim.substep(fixedDt, params, input, i === 0);
      }
    }

    const view = buildViewState(camera, interaction.boxRotation, canvas.width, canvas.height);
    if (settings.render.mode === 'fluid') {
      fluidRenderer.sceneTarget(view.width, view.height).bind();
      container.drawBackground(view);
      container.drawEdges(view, false);
      waterColor.set(settings.render.waterColor);
      const a = settings.render.absorption;
      fluidRenderer.render(view, sim, container, {
        waterColor: [waterColor.r, waterColor.g, waterColor.b],
        absorption: [BASE_ABSORPTION[0] * a, BASE_ABSORPTION[1] * a, BASE_ABSORPTION[2] * a],
        refraction: settings.render.refraction,
        smoothing: settings.render.smoothing,
      });
      container.drawEdges(view, true);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, view.width, view.height);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      container.drawBackground(view);
      particleRenderer.render(view, sim);
      container.drawEdges(view, true);
    }

    frames++;
    if (now - fpsTime > 500) {
      const fps = (frames * 1000) / (now - fpsTime);
      statsEl.textContent = `${fps.toFixed(0)} fps · ${sim.count.toLocaleString()} particles${params.paused ? ' · paused' : ''}`;
      frames = 0;
      fpsTime = now;

      // Only judge performance shortly after a reset, so tab switches or hiccups later on
      // don't silently shrink the simulation.
      const sinceReset = now - lastReset;
      if (settings.autoQuality && !params.paused && !document.hidden && sinceReset > 1500 && sinceReset < 12000) {
        slowSamples = fps < AUTO_QUALITY_MIN_FPS ? slowSamples + 1 : 0;
        if (slowSamples >= 4 && params.particleCount > MIN_AUTO_PARTICLES) {
          params.particleCount /= 2;
          reset();
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start();
