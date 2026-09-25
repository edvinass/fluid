import '../boot';
import '../style.css';
import { PerspectiveCamera, Quaternion } from 'three';
import { createContext, UnsupportedError } from '../gl/context';
import { gridLayout } from '../paint/PaintSimulator';
import { buildViewState } from '../render/camera';
import { FireInteraction } from './interaction';
import { FireRenderer } from './FireRenderer';
import { FireSimulator, type Emitter, type Vec3 } from './FireSimulator';
import { FLAME_COLOURS, SCENE_GEOMETRY, SceneEmitters, SCENES, type SceneName } from './scenes';
import { FireToolbar } from './toolbar';
import { createFireUI, QUALITY_LEVELS, type FireSettings } from './ui';

const BOX_HALF: Vec3 = [0.8, 1.2, 0.8];
const MAX_DEVICE_PIXEL_RATIO = 2;
const AUTO_QUALITY_MIN_FPS = 45;
const QUALITY_ORDER = Object.keys(QUALITY_LEVELS);
const SCENE_COLOUR: Partial<Record<SceneName, string>> = { Campfire: 'Natural', 'Gas burner': 'Gas blue' };
/** In the torch scene, a demo torch takes over after this many idle seconds. */
const DEMO_TORCH_IDLE = 4;

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
  const settings: FireSettings = {
    quality: initialQuality,
    autoQuality: true,
    scene: 'Campfire',
    colour: 'Natural',
    size: 1,
    sim: {
      buoyancy: 1.6,
      weight: 0.1,
      swirl: 6,
      burnRate: 6,
      heatRelease: 1,
      soot: 0.25,
      cooling: 1.8,
      smokeFade: 0.3,
      breeze: 0,
      drag: 0.05,
      timeScale: 1,
      pressureIterations: 20,
      paused: false,
    },
    look: {
      brightness: 12,
      smoke: 25,
      bloom: 0.6,
      exposure: 1,
      renderScale: QUALITY_LEVELS[initialQuality].renderScale,
    },
  };

  const camera = new PerspectiveCamera(40, 1, 0.05, 100);
  camera.position.set(0.9, -0.2, 3.3);

  const sim = new FireSimulator(gl, BOX_HALF);
  const renderer = new FireRenderer(gl, BOX_HALF);
  const interaction = new FireInteraction(camera, canvas, BOX_HALF);
  interaction.controls.target.set(0, -0.55, 0);
  interaction.controls.update();
  const sceneEmitters = new SceneEmitters(-BOX_HALF[1]);

  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const qualityOrder = QUALITY_ORDER.filter((name) => {
    const { width, height } = gridLayout(BOX_HALF, QUALITY_LEVELS[name].cells);
    return width <= maxTexture && height <= maxTexture;
  });

  let lastQualityChange = performance.now();
  let slowSamples = 0;
  const setQuality = () => {
    sim.reset(QUALITY_LEVELS[settings.quality].cells);
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

  const toolbar = new FireToolbar(
    document.getElementById('toolbar')!,
    (scene) => {
      settings.scene = scene;
      setScene();
    },
    (colour) => {
      settings.colour = colour;
      setColour();
    },
  );
  const setColour = () => toolbar.select(settings.scene, settings.colour);
  const setScene = () => {
    sim.scene = SCENE_GEOMETRY[settings.scene];
    settings.colour = SCENE_COLOUR[settings.scene] ?? settings.colour;
    toolbar.select(settings.scene, settings.colour);
  };
  setScene();
  const clear = () => sim.clear();

  createFireUI(settings, qualityOrder, { chooseQuality, setScene, setColour, clear });

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
    const scene = SCENES[Number(e.key) - 1];
    if (scene) {
      settings.scene = scene;
      setScene();
    } else if (e.code === 'Space') {
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
    Object.assign(window, { fire: { sim, settings, interaction, setQuality, setScene } });
  }

  /** A torch tracing a slow figure of eight, so the torch scene isn't empty when nobody's playing. */
  const demoTorch = (now: number): Emitter => ({
    shape: 'ellipsoid',
    position: [Math.sin(now * 0.7) * 0.4, -BOX_HALF[1] + 0.35 + Math.sin(now * 1.4) * 0.15, Math.cos(now * 0.7) * 0.2],
    size: [0.05, 0.05, 0.05],
    velocity: [Math.cos(now * 0.7) * 0.3, 0.4, 0],
    push: 0.4,
    fuel: 30,
    heat: 8,
    smoke: 0.3,
    flicker: 0.4,
  });

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
      const emitters = [...sceneEmitters.emitters(settings.scene, settings.size, now), ...interaction.emitters()];
      if (settings.scene === 'Torch' && interaction.idleTime > DEMO_TORCH_IDLE) emitters.push(demoTorch(now));
      sim.step(realDt * settings.sim.timeScale, settings.sim, emitters);
    }

    const view = buildViewState(camera, identity, canvas.width, canvas.height);
    const tint = FLAME_COLOURS.find((c) => c.name === settings.colour)?.tint ?? null;
    renderer.render(view, sim, { ...settings.look, tint }, frameIndex++);

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
