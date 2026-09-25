import '../style.css';
import { PerspectiveCamera, Quaternion } from 'three';
import { createContext, UnsupportedError } from '../gl/context';
import { buildViewState } from '../render/camera';
import { AutoPour } from './autoPour';
import { PaintInteraction } from './interaction';
import { Palette } from './palette';
import { PaintRenderer, THEMES } from './PaintRenderer';
import { PaintSimulator, type Vec3 } from './PaintSimulator';
import { createPaintUI, QUALITY_LEVELS, type PaintSettings } from './ui';

const BOX_HALF: Vec3 = [0.75, 0.95, 0.75];
const MAX_DEVICE_PIXEL_RATIO = 2;
const INTRO_SECONDS = 3.5;
const AUTO_QUALITY_MIN_FPS = 45;
const QUALITY_ORDER = Object.keys(QUALITY_LEVELS);

function showError(message: string): void {
  document.getElementById('error-message')!.textContent = message;
  document.getElementById('error')!.hidden = false;
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

  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 700;
  const settings: PaintSettings = {
    quality: mobile ? 'Medium' : 'High',
    autoQuality: true,
    sim: {
      timeScale: 1,
      swirl: 3,
      weight: 0.8,
      fade: 0.01,
      drag: 0.15,
      pressureIterations: 28,
      paused: false,
    },
    pour: {
      rate: 8,
      width: 0.045,
      speed: 0.9,
      autoPour: true,
    },
    look: {
      theme: 'light',
      density: 45,
      shadow: 1,
      renderScale: mobile ? 0.45 : 0.6,
    },
  };

  const camera = new PerspectiveCamera(40, 1, 0.05, 100);
  camera.position.set(2.6, 1.3, 3.4);

  const sim = new PaintSimulator(gl, BOX_HALF);
  const renderer = new PaintRenderer(gl, BOX_HALF);
  const interaction = new PaintInteraction(camera, canvas, BOX_HALF, settings.pour);
  interaction.controls.target.set(0, -0.1, 0);
  interaction.controls.update();

  let lastQualityChange = performance.now();
  let slowSamples = 0;
  const setQuality = () => {
    sim.reset(QUALITY_LEVELS[settings.quality]);
    lastQualityChange = performance.now();
    slowSamples = 0;
  };
  setQuality();

  const clear = () => sim.clear();
  const setTheme = () => {
    document.body.className = THEMES[settings.look.theme].bodyClass;
  };
  const palette = new Palette(document.getElementById('palette')!, clear);
  const startTime = performance.now() / 1000;
  const autoPour = new AutoPour(BOX_HALF, settings.pour, () => palette.random(), startTime);

  createPaintUI(settings, { setQuality, clear, setTheme });

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
    if (e.code === 'Space') {
      settings.sim.paused = !settings.sim.paused;
      e.preventDefault();
    } else if (e.code === 'KeyC') {
      clear();
    }
  });

  const help = document.getElementById('help')!;
  const helpToggle = document.getElementById('help-toggle')!;
  helpToggle.addEventListener('click', () => {
    helpToggle.setAttribute('aria-expanded', String(!help.classList.toggle('collapsed')));
  });

  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, { paint: { sim, settings, interaction } });
  }

  const statsEl = document.getElementById('stats')!;
  const identity = new Quaternion();
  let frames = 0;
  let frameIndex = 0;
  let fpsTime = performance.now();
  let last = performance.now();

  const frame = (nowMs: number) => {
    const realDt = Math.min((nowMs - last) / 1000, 1 / 20);
    last = nowMs;
    const now = nowMs / 1000;

    interaction.update(realDt, now);
    if (!settings.sim.paused) {
      const introOver = now - startTime > INTRO_SECONDS;
      const sources = [
        ...interaction.sources(palette.current(now)),
        ...autoPour.sources(now, interaction.idleTime, introOver),
      ];
      sim.step(realDt * settings.sim.timeScale, settings.sim, sources);
    }

    const view = buildViewState(camera, identity, canvas.width, canvas.height);
    renderer.render(view, sim, { ...settings.look, theme: THEMES[settings.look.theme] }, frameIndex++);

    frames++;
    if (nowMs - fpsTime > 500) {
      const fps = (frames * 1000) / (nowMs - fpsTime);
      const [x, y, z] = sim.res;
      statsEl.textContent = `${fps.toFixed(0)} fps · ${x}×${y}×${z} grid${settings.sim.paused ? ' · paused' : ''}`;
      frames = 0;
      fpsTime = nowMs;

      // Step quality down while the frame rate stays low shortly after a change.
      const since = nowMs - lastQualityChange;
      if (settings.autoQuality && !settings.sim.paused && !document.hidden && since > 1500 && since < 12000) {
        slowSamples = fps < AUTO_QUALITY_MIN_FPS ? slowSamples + 1 : 0;
        if (slowSamples >= 4) {
          const level = QUALITY_ORDER.indexOf(settings.quality);
          if (settings.look.renderScale > 0.45) {
            settings.look.renderScale = Math.max(0.4, settings.look.renderScale - 0.15);
            lastQualityChange = nowMs;
            slowSamples = 0;
          } else if (level > 0) {
            settings.quality = QUALITY_ORDER[level - 1];
            setQuality();
          }
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start();
