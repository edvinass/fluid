import '../boot';
import '../style.css';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { createContext, UnsupportedError } from '../gl/context';
import { buildViewState } from '../render/camera';
import { BubbleInteraction } from './interaction';
import { BubbleRenderer, type Environment } from './BubbleRenderer';
import { BubbleSimulator, type Vec3 } from './BubbleSimulator';
import { BubbleToolbar } from './toolbar';
import { createBubbleUI, QUALITY_LEVELS, type BubbleSettings } from './ui';

const MAX_DEVICE_PIXEL_RATIO = 2;
const AUTO_QUALITY_MIN_FPS = 45;
const QUALITY_ORDER = Object.keys(QUALITY_LEVELS);
const INFLATE_SECONDS = 0.9;
/** Radians per second at which the hole of a popping bubble spreads. */
const POP_SPEED = 8;
const GONE_SECONDS = 0.6;

type Phase = 'inflating' | 'alive' | 'popping' | 'gone';

function showError(message: string): void {
  document.getElementById('error-message')!.textContent = message;
  document.getElementById('error')!.hidden = false;
}

/** Overshoots slightly before settling, like a bubble leaving the wand. */
function easeOutBack(t: number): number {
  const c = 1.4;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
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
  const initialQuality = mobile ? 'Medium' : 'Ultra';
  const settings: BubbleSettings = {
    quality: initialQuality,
    autoQuality: true,
    autoPop: true,
    lifetime: 45,
    sim: {
      thickness: 0.45,
      convection: 8,
      swirl: 3,
      turbulence: 0.5,
      drainage: 0.04,
      evaporation: 0.006,
      plumes: 1,
      drag: 0.3,
      timeScale: 1,
      pressureIterations: 20,
      paused: false,
    },
    look: { environment: 'Studio', exposure: 1, filmIndex: 1.33 },
  };

  const camera = new PerspectiveCamera(40, 1, 0.05, 100);

  const sim = new BubbleSimulator(gl);
  const renderer = new BubbleRenderer(gl);
  const center = new Vector3();
  let radius = 0;
  let phase: Phase = 'inflating';
  let phaseTime = 0;
  let age = 0;
  let popPoint: Vec3 | null = null;
  let popRadius = 0;

  const pop = (point?: Vec3) => {
    if (phase !== 'alive' && phase !== 'inflating') return;
    if (!point) {
      // A random spot on the upper half, where the film is thinnest.
      const a = Math.random() * Math.PI * 2;
      const y = 0.3 + Math.random() * 0.6;
      const r = Math.sqrt(1 - y * y);
      point = [Math.cos(a) * r, y, Math.sin(a) * r];
    }
    popPoint = point;
    popRadius = 0;
    phase = 'popping';
    phaseTime = 0;
  };
  const newBubble = () => {
    sim.newBubble(settings.sim.thickness);
    popPoint = null;
    phase = 'inflating';
    phaseTime = 0;
    age = 0;
  };

  const interaction = new BubbleInteraction(camera, canvas, () => ({ center, radius }), pop);
  interaction.controls.target.set(0, 0, 0);
  interaction.controls.maxDistance = 10;
  // Pull back on a tall screen so the bubble clears the page chrome.
  const aspect = Math.max(canvas.clientWidth / Math.max(canvas.clientHeight, 1), 0.3);
  const halfTan = Math.tan((camera.fov * Math.PI) / 360);
  const distance = Math.max(3.6, 1.15 / (halfTan * aspect));
  const pitch = 0.09;
  camera.position.set(0, Math.sin(pitch) * distance, Math.cos(pitch) * distance);
  interaction.controls.update();

  const maxCube = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE) as number;
  const qualityOrder = QUALITY_ORDER.filter((name) => QUALITY_LEVELS[name] <= maxCube);

  let lastQualityChange = performance.now();
  let slowSamples = 0;
  const setQuality = () => {
    sim.reset(QUALITY_LEVELS[settings.quality], settings.sim.thickness);
    newBubble();
    lastQualityChange = performance.now();
    slowSamples = 0;
  };
  // An explicit choice wins over auto quality, which would otherwise step it back down.
  const chooseQuality = () => {
    settings.autoQuality = false;
    setQuality();
  };
  setQuality();

  const toolbar = new BubbleToolbar(
    document.getElementById('toolbar')!,
    (env) => {
      settings.look.environment = env;
      setEnvironment();
    },
    () => pop(),
    newBubble,
  );
  const setEnvironment = () => toolbar.select(settings.look.environment as Environment);
  setEnvironment();

  createBubbleUI(settings, qualityOrder, { chooseQuality, setEnvironment, pop: () => pop(), newBubble });

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
    } else if (e.code === 'KeyP') {
      pop();
    } else if (e.code === 'KeyR') {
      newBubble();
    }
  });

  const help = document.getElementById('help')!;
  const helpToggle = document.getElementById('help-toggle')!;
  helpToggle.addEventListener('click', () => {
    helpToggle.setAttribute('aria-expanded', String(!help.classList.toggle('collapsed')));
  });

  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, { bubble: { sim, settings, interaction, setQuality, pop, newBubble } });
  }

  const statsEl = document.getElementById('stats')!;
  const identity = new Quaternion();
  let frames = 0;
  let fpsTime = performance.now();
  let last = performance.now();
  let time = 0;

  const frame = (nowMs: number) => {
    const realDt = Math.min((nowMs - last) / 1000, 1 / 20);
    last = nowMs;
    const paused = settings.sim.paused;
    const dt = paused ? 0 : realDt * settings.sim.timeScale;
    time += dt;

    phaseTime += dt;
    if (phase === 'inflating') {
      radius = easeOutBack(Math.min(phaseTime / INFLATE_SECONDS, 1));
      if (phaseTime >= INFLATE_SECONDS) phase = 'alive';
    } else if (phase === 'alive') {
      radius = 1;
      age += dt;
      if (settings.autoPop && age > settings.lifetime) pop();
    } else if (phase === 'popping') {
      popRadius = phaseTime * POP_SPEED;
      if (popRadius > Math.PI) {
        phase = 'gone';
        phaseTime = 0;
        radius = 0;
      }
    } else if (phaseTime > GONE_SECONDS) {
      newBubble();
    }
    center.set(Math.sin(time * 0.31) * 0.04, Math.sin(time * 0.53) * 0.05, 0);

    interaction.update(realDt);
    if (!paused && radius > 0) sim.step(dt, settings.sim, interaction.stirs());

    const view = buildViewState(camera, identity, canvas.width, canvas.height);
    renderer.render(view, sim.filmTexture, { center: center.toArray() as Vec3, radius, popPoint, popRadius }, settings.look, time);

    frames++;
    if (nowMs - fpsTime > 500) {
      const fps = (frames * 1000) / (nowMs - fpsTime);
      const size = sim.size;
      statsEl.textContent = `${fps.toFixed(0)} fps · 6×${size}×${size} film${paused ? ' · paused' : ''}`;
      frames = 0;
      fpsTime = nowMs;

      // Step quality down while the frame rate stays low shortly after a change.
      const since = nowMs - lastQualityChange;
      if (settings.autoQuality && !paused && !document.hidden && since > 1500 && since < 12000) {
        slowSamples = fps < AUTO_QUALITY_MIN_FPS ? slowSamples + 1 : 0;
        const level = qualityOrder.indexOf(settings.quality);
        if (slowSamples >= 4 && level > 0) {
          settings.quality = qualityOrder[level - 1];
          setQuality();
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start();
