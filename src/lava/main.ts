import '../style.css';
import { PerspectiveCamera, Quaternion } from 'three';
import { createContext, UnsupportedError } from '../gl/context';
import { buildViewState } from '../render/camera';
import { LavaInteraction } from './interaction';
import { LavaRenderer } from './LavaRenderer';
import { LavaSimulator } from './LavaSimulator';
import { THEMES } from './themes';
import { LavaToolbar } from './toolbar';
import { createLavaUI, type LavaSettings } from './ui';

const MAX_DEVICE_PIXEL_RATIO = 2;
const STEP = 1 / 120;

function showError(message: string): void {
  document.getElementById('error-message')!.textContent = message;
  document.getElementById('error')!.hidden = false;
}

function start(): void {
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let renderer: LavaRenderer;
  try {
    gl = createContext(canvas);
    renderer = new LavaRenderer(gl);
  } catch (err) {
    showError(err instanceof UnsupportedError ? err.message : String(err));
    return;
  }
  const sim = new LavaSimulator();

  const settings: LavaSettings = {
    theme: THEMES[0].name,
    sim: {
      heat: 1,
      cooling: 0.06,
      buoyancy: 0.5,
      drag: 5,
      waxAmount: 0.14,
      timeScale: 1,
      paused: false,
    },
    look: { brightness: 1, exposure: 1 },
  };

  const camera = new PerspectiveCamera(40, 1, 0.05, 100);
  camera.position.set(0, 0.05, 3);
  const interaction = new LavaInteraction(camera, canvas);
  interaction.controls.target.set(0, -0.12, 0);
  interaction.controls.update();

  const restart = () => sim.reset(settings.sim.waxAmount);
  const toolbar = new LavaToolbar(document.getElementById('toolbar')!, (name) => {
    settings.theme = name;
    setTheme();
  });
  const setTheme = () => toolbar.select(settings.theme);
  restart();
  setTheme();
  createLavaUI(settings, { setTheme, restart });

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
      accumulator = Math.min(accumulator + realDt * params.timeScale, 0.5);
      while (accumulator >= STEP) {
        sim.step(STEP, params, interaction.mouse);
        accumulator -= STEP;
      }
    }

    const theme = THEMES.find((t) => t.name === settings.theme) ?? THEMES[0];
    const view = buildViewState(camera, identity, canvas.width, canvas.height);
    renderer.render(view, sim, { ...settings.look, wax: theme.wax, liquid: theme.liquid });

    frames++;
    if (now - fpsTime > 500) {
      const fps = (frames * 1000) / (now - fpsTime);
      const n = sim.blobs.length;
      statsEl.textContent = `${fps.toFixed(0)} fps · ${n} ${n === 1 ? 'blob' : 'blobs'}${params.paused ? ' · paused' : ''}`;
      frames = 0;
      fpsTime = now;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start();
