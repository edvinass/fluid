import '../boot';
import '../style.css';
import { PerspectiveCamera, Quaternion } from 'three';
import { createContext, UnsupportedError } from '../gl/context';
import { THEMES } from '../paint/PaintRenderer';
import { gridLayout } from '../paint/PaintSimulator';
import { buildViewState } from '../render/camera';
import { WindInteraction } from './interaction';
import { Obstacle, SHAPES, type ShapeName, type Vec3 } from './obstacle';
import { ShapeBar } from './shapeBar';
import { createWindUI, QUALITY_LEVELS, type WindSettings } from './ui';
import { WindRenderer } from './WindRenderer';
import { WindSimulator, type SmokeColour } from './WindSimulator';

const BOX_HALF: Vec3 = [1.6, 0.5, 0.6];
const MAX_DEVICE_PIXEL_RATIO = 2;
const AUTO_QUALITY_MIN_FPS = 45;
const QUALITY_ORDER = Object.keys(QUALITY_LEVELS);
const SMOKE_COLOURS: SmokeColour[] = ['White', 'Rainbow', 'Speed'];
const DEFAULT_ANGLE: Partial<Record<ShapeName, number>> = { Wing: 8 };

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
  const initialQuality = mobile ? 'Medium' : 'High';
  const settings: WindSettings = {
    quality: initialQuality,
    autoQuality: true,
    sim: {
      wind: 1.2,
      turbulence: 0.03,
      swirl: 2.5,
      timeScale: 1,
      pressureIterations: 32,
      paused: false,
    },
    object: { shape: 'Wing', angle: DEFAULT_ANGLE.Wing ?? 0, yaw: 0, size: 1 },
    smoke: {
      rake: 'Vertical',
      streams: 10,
      width: 0.01,
      amount: 1,
      colour: 'Rainbow',
      pulse: false,
      fade: 0.05,
    },
    look: {
      theme: 'dark',
      density: 60,
      shadow: 0.6,
      pressure: false,
      renderScale: QUALITY_LEVELS[initialQuality].renderScale,
    },
  };

  const camera = new PerspectiveCamera(40, 1, 0.05, 100);
  camera.position.set(1.0, 1.25, 3.7);

  const sim = new WindSimulator(gl, BOX_HALF);
  const renderer = new WindRenderer(gl, BOX_HALF);
  const obstacle = new Obstacle(BOX_HALF);
  obstacle.resetPosition(settings.object);
  const interaction = new WindInteraction(camera, canvas, BOX_HALF, obstacle, settings.object);
  interaction.controls.target.set(0, -0.12, 0);
  interaction.controls.update();

  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const qualityOrder = QUALITY_ORDER.filter((name) => {
    const { width, height } = gridLayout(BOX_HALF, QUALITY_LEVELS[name].cells);
    return width <= maxTexture && height <= maxTexture;
  });

  let lastQualityChange = performance.now();
  let slowSamples = 0;
  const setQuality = () => {
    sim.reset(QUALITY_LEVELS[settings.quality].cells, settings.sim.wind);
    lastQualityChange = performance.now();
    slowSamples = 0;
  };
  // An explicit choice wins over auto quality, which would otherwise step it back down.
  const chooseQuality = () => {
    settings.look.renderScale = QUALITY_LEVELS[settings.quality].renderScale;
    settings.autoQuality = false;
    setQuality();
  };
  setQuality();

  const shapeBar = new ShapeBar(document.getElementById('shapes')!, (shape) => {
    settings.object.shape = shape;
    setShape();
  });
  const setShape = () => {
    settings.object.angle = DEFAULT_ANGLE[settings.object.shape] ?? 0;
    settings.object.yaw = 0;
    obstacle.resetPosition(settings.object);
    shapeBar.select(settings.object.shape);
  };
  shapeBar.select(settings.object.shape);
  const resetFlow = () => sim.clear(settings.sim.wind);
  const setTheme = () => {
    document.body.className = THEMES[settings.look.theme].bodyClass;
  };
  setTheme();

  createWindUI(settings, qualityOrder, {
    chooseQuality,
    setShape,
    resetObject: () => obstacle.resetPosition(settings.object),
    resetFlow,
    setTheme,
  });

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
    const shape = SHAPES[Number(e.key) - 1];
    if (shape) {
      settings.object.shape = shape;
      setShape();
    } else if (e.code === 'Space') {
      settings.sim.paused = !settings.sim.paused;
      e.preventDefault();
    } else if (e.code === 'KeyR') {
      resetFlow();
    } else if (e.code === 'KeyP') {
      settings.look.pressure = !settings.look.pressure;
    } else if (e.code === 'KeyS') {
      const i = SMOKE_COLOURS.indexOf(settings.smoke.colour);
      settings.smoke.colour = SMOKE_COLOURS[(i + 1) % SMOKE_COLOURS.length];
    } else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      const delta = e.code === 'BracketLeft' ? -2 : 2;
      settings.object.angle = Math.max(-30, Math.min(30, settings.object.angle + delta));
    }
  });

  const help = document.getElementById('help')!;
  const helpToggle = document.getElementById('help-toggle')!;
  helpToggle.addEventListener('click', () => {
    helpToggle.setAttribute('aria-expanded', String(!help.classList.toggle('collapsed')));
  });

  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, { wind: { sim, settings, obstacle, interaction, setQuality } });
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

    interaction.update(realDt);
    obstacle.update(settings.object, realDt);
    if (!settings.sim.paused) {
      sim.step(realDt * settings.sim.timeScale, settings.sim, settings.smoke, obstacle, interaction.wand());
    }

    const view = buildViewState(camera, identity, canvas.width, canvas.height);
    renderer.render(
      view,
      sim,
      obstacle,
      { ...settings.look, theme: THEMES[settings.look.theme], colour: settings.smoke.colour },
      settings.sim.wind,
      frameIndex++,
    );

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
          const level = qualityOrder.indexOf(settings.quality);
          if (settings.look.renderScale > 0.45) {
            settings.look.renderScale = Math.max(0.4, settings.look.renderScale - 0.15);
            lastQualityChange = nowMs;
            slowSamples = 0;
          } else if (level > 0) {
            settings.quality = qualityOrder[level - 1];
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
