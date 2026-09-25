import '../style.css';
import { PerspectiveCamera, Quaternion } from 'three';
import { createContext, UnsupportedError } from '../gl/context';
import { buildViewState } from '../render/camera';
import { LavaInteraction } from './interaction';
import { LavaRenderer } from './LavaRenderer';
import { LavaSimulator } from './LavaSimulator';
import { THEMES } from './themes';
import { LavaToolbar } from './toolbar';
import { createLavaUI, QUALITY_LEVELS, type LavaSettings } from './ui';

const MAX_DEVICE_PIXEL_RATIO = 2;
const AUTO_QUALITY_MIN_FPS = 40;
const QUALITY_ORDER = Object.keys(QUALITY_LEVELS);

function showError(message: string): void {
  document.getElementById('error-message')!.textContent = message;
  document.getElementById('error')!.hidden = false;
}

function start(): void {
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let sim: LavaSimulator;
  let renderer: LavaRenderer;
  try {
    gl = createContext(canvas);
    sim = new LavaSimulator(gl);
    renderer = new LavaRenderer(gl);
  } catch (err) {
    showError(err instanceof UnsupportedError ? err.message : String(err));
    return;
  }

  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 700;
  const settings: LavaSettings = {
    quality: mobile ? 'Low' : 'Medium',
    autoQuality: true,
    theme: THEMES[0].name,
    sim: {
      heat: 1,
      cooling: 0.25,
      buoyancy: 1.5,
      cohesion: 2,
      viscosity: 6,
      drag: 2,
      pressure: 20,
      nearPressure: 2,
      substeps: 3,
      timeScale: 1,
      paused: false,
    },
    look: { brightness: 1, smoothing: 1, exposure: 1 },
  };

  const camera = new PerspectiveCamera(40, 1, 0.05, 100);
  camera.position.set(0, 0.05, 3);
  const interaction = new LavaInteraction(camera, canvas);
  interaction.controls.target.set(0, -0.12, 0);
  interaction.controls.update();

  let lastQualityChange = performance.now();
  let slowSamples = 0;
  const restart = () => {
    sim.reset(QUALITY_LEVELS[settings.quality]);
    lastQualityChange = performance.now();
    slowSamples = 0;
  };
  const chooseQuality = () => {
    settings.autoQuality = false;
    restart();
  };
  const toolbar = new LavaToolbar(document.getElementById('toolbar')!, (name) => {
    settings.theme = name;
    setTheme();
  });
  const setTheme = () => toolbar.select(settings.theme);
  restart();
  setTheme();
  createLavaUI(settings, QUALITY_ORDER, { chooseQuality, setTheme, restart });

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
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

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const theme = THEMES[Number(e.key) - 1];
    if (theme) {
      settings.theme = theme.name;
      setTheme();
    } else if (e.code === 'Space') {
      settings.sim.paused = !settings.sim.paused;
      e.preventDefault();
    } else if (e.code === 'KeyC') {
      restart();
    }
  });

  const help = document.getElementById('help')!;
  const helpToggle = document.getElementById('help-toggle')!;
  helpToggle.addEventListener('click', () => {
    helpToggle.setAttribute('aria-expanded', String(!help.classList.toggle('collapsed')));
  });

  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, { lava: { sim, settings, interaction, restart, camera } });
  }

  const statsEl = document.getElementById('stats')!;
  const identity = new Quaternion();
  let accumulator = 0;
  let frames = 0;
  let fpsTime = performance.now();
  let last = performance.now();

  const frame = (now: number) => {
    const realDt = Math.min((now - last) / 1000, 0.1);
    last = now;
    interaction.update(realDt);

    const params = settings.sim;
    if (params.paused) {
      accumulator = 0;
    } else {
      const fixedDt = 1 / (60 * params.substeps);
      accumulator += realDt * params.timeScale;
      const maxSteps = Math.ceil(params.substeps * Math.max(params.timeScale, 1) * 2);
      let steps = Math.floor(accumulator / fixedDt);
      if (steps > maxSteps) {
        steps = maxSteps;
        accumulator = 0;
      } else {
        accumulator -= steps * fixedDt;
      }
      for (let i = 0; i < steps; i++) sim.substep(fixedDt, params, interaction.mouse);
    }

    const theme = THEMES.find((t) => t.name === settings.theme) ?? THEMES[0];
    const view = buildViewState(camera, identity, canvas.width, canvas.height);
    renderer.render(view, sim, { ...settings.look, wax: theme.wax, liquid: theme.liquid });

    frames++;
    if (now - fpsTime > 500) {
      const fps = (frames * 1000) / (now - fpsTime);
      statsEl.textContent = `${fps.toFixed(0)} fps · ${sim.count.toLocaleString()} wax particles${params.paused ? ' · paused' : ''}`;
      frames = 0;
      fpsTime = now;
      const since = now - lastQualityChange;
      if (settings.autoQuality && !params.paused && !document.hidden && since > 1500 && since < 12000) {
        slowSamples = fps < AUTO_QUALITY_MIN_FPS ? slowSamples + 1 : 0;
        const level = QUALITY_ORDER.indexOf(settings.quality);
        if (slowSamples >= 4 && level > 0) {
          settings.quality = QUALITY_ORDER[level - 1];
          restart();
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start();
