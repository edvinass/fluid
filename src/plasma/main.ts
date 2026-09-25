import '../boot';
import '../style.css';
import { PerspectiveCamera, Quaternion } from 'three';
import { createContext, UnsupportedError } from '../gl/context';
import { buildViewState } from '../render/camera';
import { GASES, hueColor } from './gases';
import { PlasmaInteraction } from './interaction';
import { Microphone } from './microphone';
import { PlasmaRenderer } from './PlasmaRenderer';
import { PlasmaSimulator, type FilamentColors, type Vec3 } from './PlasmaSimulator';
import { PlasmaToolbar } from './toolbar';
import { createPlasmaUI, type PlasmaSettings } from './ui';

const MAX_DEVICE_PIXEL_RATIO = 2;

function showError(message: string): void {
  document.getElementById('error-message')!.textContent = message;
  document.getElementById('error')!.hidden = false;
}

function start(): void {
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let renderer: PlasmaRenderer;
  try {
    gl = createContext(canvas);
    renderer = new PlasmaRenderer(gl);
  } catch (err) {
    showError(err instanceof UnsupportedError ? err.message : String(err));
    return;
  }

  const settings: PlasmaSettings = {
    sound: false,
    sim: { count: 24, voltage: 1, twist: 1, tendrils: 0.7, wander: 1, flicker: 1, timeScale: 1, paused: false },
    look: { bloom: 0.6, exposure: 1, roomLight: 1 },
  };

  const camera = new PerspectiveCamera(40, 1, 0.05, 100);
  const sim = new PlasmaSimulator();
  const interaction = new PlasmaInteraction(camera, canvas);
  interaction.controls.target.set(0, -0.2, 0);
  interaction.controls.maxDistance = 10;
  // Pull back on a tall screen so the globe and its base clear the page chrome.
  const aspect = Math.max(canvas.clientWidth / Math.max(canvas.clientHeight, 1), 0.3);
  const halfTan = Math.tan((camera.fov * Math.PI) / 360);
  const distance = Math.max(4.4, 1.15 / (halfTan * aspect));
  const pitch = 0.19;
  camera.position.set(0, -0.2 + Math.sin(pitch) * distance, Math.cos(pitch) * distance);
  interaction.controls.update();

  let gasIndex = 0;
  let time = 0;
  const colorOf = (i: number, seed: number): FilamentColors => {
    const { thread, glow } = GASES[gasIndex];
    if (thread && glow) return { thread, glow };
    const h = (seed * 0.137 + i * 0.13 + time * 0.05) % 1;
    return { thread: hueColor(h), glow: hueColor((h + 0.08) % 1) };
  };
  const gasColor = (): Vec3 => GASES[gasIndex].glow ?? (hueColor((time * 0.05) % 1).map((c) => 0.4 + 0.6 * c) as Vec3);

  const toolbar = new PlasmaToolbar(document.getElementById('toolbar')!, (i) => setGas(i));
  const setGas = (i: number) => {
    gasIndex = i;
    toolbar.select(i);
  };
  setGas(0);

  const microphone = new Microphone();
  const setSound = () => {
    if (!settings.sound) {
      microphone.stop();
      return;
    }
    microphone.start().catch((err) => {
      console.warn('Microphone unavailable:', err);
      settings.sound = false;
    });
  };
  const reset = () => sim.reset();
  createPlasmaUI(settings, { setSound, reset });

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
    } else if (e.code === 'KeyR') {
      reset();
    } else if (e.code === 'KeyM') {
      settings.sound = !settings.sound;
      setSound();
    } else if (/^Digit[1-9]$/.test(e.code)) {
      const i = Number(e.code.slice(5)) - 1;
      if (i < GASES.length) setGas(i);
    }
  });

  const help = document.getElementById('help')!;
  const helpToggle = document.getElementById('help-toggle')!;
  helpToggle.addEventListener('click', () => {
    helpToggle.setAttribute('aria-expanded', String(!help.classList.toggle('collapsed')));
  });

  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, { plasma: { sim, settings, interaction, setGas } });
  }

  const statsEl = document.getElementById('stats')!;
  const identity = new Quaternion();
  let frames = 0;
  let fpsTime = performance.now();
  let last = performance.now();

  const frame = (nowMs: number) => {
    const realDt = Math.min((nowMs - last) / 1000, 1 / 20);
    last = nowMs;
    const paused = settings.sim.paused;
    const dt = paused ? 0 : realDt * settings.sim.timeScale;
    time += dt;

    interaction.update(realDt);
    const boost = settings.sound ? microphone.level(realDt) : 0;
    if (!paused) {
      sim.step(dt, settings.sim, interaction.touches(), boost);
      sim.writePaths(settings.sim, colorOf, boost);
    }

    const view = buildViewState(camera, identity, canvas.width, canvas.height);
    renderer.render(view, sim, gasColor(), settings.look, time);

    frames++;
    if (nowMs - fpsTime > 500) {
      const fps = (frames * 1000) / (nowMs - fpsTime);
      statsEl.textContent = `${fps.toFixed(0)} fps · ${sim.activeCount} filaments${paused ? ' · paused' : ''}`;
      frames = 0;
      fpsTime = nowMs;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start();
