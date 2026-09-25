import '../boot';
import '../style.css';
import { Color, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { createContext, UnsupportedError } from '../gl/context';
import { gridLayout } from '../paint/PaintSimulator';
import { buildViewState } from '../render/camera';
import { HoneyInteraction } from './interaction';
import { HoneyRenderer } from './HoneyRenderer';
import { HoneySimulator, type SceneState, type Vec3 } from './HoneySimulator';
import { blob, BOWL_CENTER, BOWL_INNER_RADIUS, DRIZZLE_HEIGHT, fillBowl, MATERIALS, SCENE_SETUP, SCENES, streamSlice, TABLE_Y } from './scenes';
import { HoneyToolbar } from './toolbar';
import { createHoneyUI, QUALITY_LEVELS, type HoneySettings } from './ui';

const BOX_HALF: Vec3 = [0.8, 0.7, 0.8];
const MAX_DEVICE_PIXEL_RATIO = 2;
const AUTO_QUALITY_MIN_FPS = 40;
const QUALITY_ORDER = Object.keys(QUALITY_LEVELS);
/** Seconds without input before the page starts playing by itself. */
const DEMO_IDLE = 4;
const STREAM_RADIUS = 0.035;
const DIPPER_HEAD_RADIUS = 0.085;
const TWIRL_SPEED = 4;
const BOWL_BOTTOM = BOWL_CENTER[1] - BOWL_INNER_RADIUS;

function showError(message: string): void {
  document.getElementById('error-message')!.textContent = message;
  document.getElementById('error')!.hidden = false;
}

function start(): void {
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let sim: HoneySimulator;
  try {
    gl = createContext(canvas);
    sim = new HoneySimulator(gl, BOX_HALF);
  } catch (err) {
    showError(err instanceof UnsupportedError ? err.message : String(err));
    return;
  }

  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 700;
  const initialQuality = mobile ? 'Low' : 'Medium';
  const settings: HoneySettings = {
    quality: initialQuality,
    autoQuality: true,
    scene: 'Drizzle',
    material: 'Honey',
    pourRate: 0.6,
    twirl: true,
    sim: {
      viscosity: MATERIALS[0].viscosity,
      stiffness: 3,
      gravity: 5,
      substeps: 4,
      viscosityIterations: 12,
      timeScale: 1,
      paused: false,
    },
    look: { refraction: 0.03, smoothing: 1, exposure: 1 },
  };

  const camera = new PerspectiveCamera(40, 1, 0.05, 100);
  camera.position.set(0, 0.75, 1.75);
  const renderer = new HoneyRenderer(gl);
  const interaction = new HoneyInteraction(camera, canvas);
  interaction.controls.target.set(0, -0.42, 0);
  interaction.controls.update();

  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const qualityOrder = QUALITY_ORDER.filter((name) => {
    const { width, height } = gridLayout(BOX_HALF, QUALITY_LEVELS[name].cells);
    return width <= maxTexture && height <= maxTexture && QUALITY_LEVELS[name].capacity / 512 <= maxTexture;
  });

  // The dipper: where it is, where it's heading, and where it was at the start of the frame.
  const dipper = new Vector3();
  const dipperTarget = new Vector3();
  const dipperPrev = new Vector3();
  const grabOffset = new Vector3();
  let dipperAngle = 0;
  let pourCarry = 0;
  let demoTimer = 0;
  /** Scene time, restarted with each scene so the demos begin at the start of their cycle. */
  let time = 0;

  const setup = () => SCENE_SETUP[settings.scene];
  const startScene = () => {
    sim.clear();
    const s = sim.spacing;
    if (settings.scene === 'Drizzle') {
      dipper.set(0, DRIZZLE_HEIGHT, 0);
    } else if (settings.scene === 'Dipper') {
      sim.addParticles(fillBowl(s, 0.72), [0, 0, 0]);
      dipper.set(0.08, BOWL_BOTTOM + 0.04, 0.05);
    } else {
      sim.addParticles(blob([0, TABLE_Y + 0.4, 0], 0.16, s), [0, 0, 0]);
    }
    dipperTarget.copy(dipper);
    dipperPrev.copy(dipper);
    demoTimer = 3;
    time = 0;
  };

  let lastQualityChange = performance.now();
  let slowSamples = 0;
  const setQuality = () => {
    const q = QUALITY_LEVELS[settings.quality];
    sim.reset(q.cells, q.capacity);
    startScene();
    lastQualityChange = performance.now();
    slowSamples = 0;
  };
  const chooseQuality = () => {
    settings.autoQuality = false;
    setQuality();
  };

  const toolbar = new HoneyToolbar(
    document.getElementById('toolbar')!,
    (scene) => {
      settings.scene = scene;
      setScene();
    },
    (name) => {
      settings.material = name;
      setMaterial();
    },
  );
  const material = () => MATERIALS.find((m) => m.name === settings.material) ?? MATERIALS[0];
  const setScene = () => {
    toolbar.select(settings.scene, settings.material);
    startScene();
  };
  const setMaterial = () => {
    settings.sim.viscosity = material().viscosity;
    toolbar.select(settings.scene, settings.material);
  };
  setQuality();
  setMaterial();
  toolbar.select(settings.scene, settings.material);

  createHoneyUI(settings, qualityOrder, { chooseQuality, setScene, setMaterial, clear: startScene });

  const dropBlob = (x: number, z: number) => {
    sim.addParticles(blob([x, TABLE_Y + 0.42, z], 0.13, sim.spacing), [0, 0, 0]);
  };
  interaction.onPress = () => {
    if (settings.scene === 'Drop') {
      const p = interaction.horizontalPoint(TABLE_Y + 0.03);
      if (p) dropBlob(Math.max(-0.5, Math.min(0.5, p.x)), Math.max(-0.5, Math.min(0.5, p.z)));
    } else if (settings.scene === 'Dipper') {
      grabOffset.copy(interaction.uprightPoint(dipper)).sub(dipper);
    }
  };

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
      startScene();
    } else if (e.code === 'KeyT') {
      settings.twirl = !settings.twirl;
    }
  });

  const help = document.getElementById('help')!;
  const helpToggle = document.getElementById('help-toggle')!;
  helpToggle.addEventListener('click', () => {
    helpToggle.setAttribute('aria-expanded', String(!help.classList.toggle('collapsed')));
  });

  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, { honey: { sim, settings, interaction, setQuality, setScene, dipper } });
  }

  /** Moves the dipper towards where the user (or the demo) wants it. */
  const moveDipper = (dt: number, time: number) => {
    const idle = interaction.idleTime > DEMO_IDLE;
    if (settings.scene === 'Drizzle') {
      if (interaction.pressing) {
        const p = interaction.horizontalPoint(TABLE_Y + 0.03);
        if (p) dipperTarget.set(p.x, DRIZZLE_HEIGHT, p.z);
      } else if (idle) {
        // Slowly write loops across the plate.
        const r = 0.25 + 0.1 * Math.sin(time * 0.23);
        dipperTarget.set(Math.cos(time * 0.5) * r, DRIZZLE_HEIGHT, Math.sin(time * 0.7) * r * 0.8);
      }
      const r = Math.hypot(dipperTarget.x, dipperTarget.z);
      if (r > 0.5) dipperTarget.multiplyScalar(0.5 / r).setY(DRIZZLE_HEIGHT);
    } else if (settings.scene === 'Dipper') {
      if (interaction.pressing) {
        dipperTarget.copy(interaction.uprightPoint(dipper)).sub(grabOffset);
      } else if (idle) {
        // Every 12 s: lift the dipper out, let it drip, and lower it back in.
        const phase = time % 12;
        const ease = (t: number) => t * t * (3 - 2 * t);
        const lift = phase < 3 ? ease(phase / 3) : phase < 7 ? 1 : phase < 9 ? 1 - ease((phase - 7) / 2) : 0;
        dipperTarget.set(0.08, BOWL_BOTTOM + 0.04 + lift * 0.62, 0.05);
      }
      dipperTarget.x = Math.max(-0.6, Math.min(0.6, dipperTarget.x));
      dipperTarget.z = Math.max(-0.6, Math.min(0.6, dipperTarget.z));
      dipperTarget.y = Math.max(BOWL_BOTTOM + 0.03, Math.min(0.35, dipperTarget.y));
      // Below the rim, keep the head inside the bowl.
      const dy = dipperTarget.y - BOWL_CENTER[1];
      if (dy < 0) {
        const inner = Math.sqrt(Math.max(BOWL_INNER_RADIUS ** 2 - dy * dy, 0)) - DIPPER_HEAD_RADIUS;
        const r = Math.hypot(dipperTarget.x, dipperTarget.z);
        if (r > Math.max(inner, 0)) {
          const s = Math.max(inner, 0) / Math.max(r, 1e-6);
          dipperTarget.x *= s;
          dipperTarget.z *= s;
        }
      }
    }
    // Ease towards the target, but never faster than the solver can follow.
    const step = dipperTarget.clone().sub(dipper).multiplyScalar(Math.min(1, dt * 10));
    const maxStep = 1.5 * dt;
    if (step.length() > maxStep) step.setLength(maxStep);
    dipper.add(step);
  };

  const statsEl = document.getElementById('stats')!;
  const identity = new Quaternion();
  const coatColor = new Color();
  let frames = 0;
  let fpsTime = performance.now();
  let last = performance.now();

  const frame = (nowMs: number) => {
    const realDt = Math.min((nowMs - last) / 1000, 1 / 30);
    last = nowMs;
    interaction.update(realDt);
    const paused = settings.sim.paused;
    const dt = realDt * settings.sim.timeScale;
    const { dish, dipper: dipperOn } = setup();

    dipperPrev.copy(dipper);
    if (!paused) {
      time += dt;
      moveDipper(dt, time);
      const spin = settings.twirl ? TWIRL_SPEED : 0;
      dipperAngle += spin * dt;

      if (settings.scene === 'Drizzle') {
        const s = sim.spacing;
        const speed = settings.pourRate;
        pourCarry += (Math.PI * STREAM_RADIUS ** 2 * speed * dt) / s ** 3;
        const n = Math.floor(pourCarry);
        pourCarry -= n;
        const nozzle: Vec3 = [dipper.x, dipper.y - 0.015, dipper.z];
        const vel: Vec3 = [(dipper.x - dipperPrev.x) / dt, -speed, (dipper.z - dipperPrev.z) / dt];
        if (n > 0) sim.addParticles(streamSlice(nozzle, STREAM_RADIUS, speed * dt, n), vel);
      } else if (settings.scene === 'Drop' && interaction.idleTime > DEMO_IDLE && sim.count < sim.capacity * 0.6) {
        demoTimer -= dt;
        if (demoTimer <= 0) {
          demoTimer = 5;
          dropBlob((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5);
        }
      }
    }
    const state: SceneState = {
      scene: dish,
      dipperOn,
      dipperFrom: dipperPrev.toArray() as Vec3,
      dipperTo: dipper.toArray() as Vec3,
      dipperSpin: settings.twirl ? TWIRL_SPEED : 0,
      dipperAngle,
    };
    if (!paused && dt > 0) sim.step(dt, settings.sim, state);

    const view = buildViewState(camera, identity, canvas.width, canvas.height);
    const m = material();
    coatColor.set(m.swatch);
    const coat: [number, number, number, number] = [coatColor.r, coatColor.g, coatColor.b, settings.scene === 'Drizzle' ? 0.85 : 0];
    renderer.render(view, sim, state, { ...settings.look, absorption: m.absorption, scatter: m.scatter, coat });

    frames++;
    if (nowMs - fpsTime > 500) {
      const fps = (frames * 1000) / (nowMs - fpsTime);
      const full = sim.count >= sim.capacity ? ' · full, press C' : '';
      statsEl.textContent = `${fps.toFixed(0)} fps · ${sim.count.toLocaleString()} particles${full}${paused ? ' · paused' : ''}`;
      frames = 0;
      fpsTime = nowMs;

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
