import '../style.css';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { createContext, UnsupportedError } from '../gl/context';
import { gridLayout } from '../paint/PaintSimulator';
import { buildViewState } from '../render/camera';
import { SandInteraction } from './interaction';
import { SandRenderer } from './SandRenderer';
import { MaterialCode, SandSimulator, type Ball, type Vec3 } from './SandSimulator';
import {
  blob,
  cube,
  MATERIALS,
  sandcastle,
  SCENES,
  snowman,
  streamSlice,
  TABLE_Y,
  TRAY_FLOOR,
  TRAY_HALF,
  TRAY_HEIGHT,
  TRAY_WALL,
  type Batch,
} from './scenes';
import { SandToolbar } from './toolbar';
import { createSandUI, QUALITY_LEVELS, type SandSettings } from './ui';

const BOX_HALF: Vec3 = [0.8, 0.55, 0.8];
const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_STEP = 1 / 60;
const AUTO_QUALITY_MIN_FPS = 40;
const QUALITY_ORDER = Object.keys(QUALITY_LEVELS);
/** Seconds without input before the page starts playing by itself. */
const DEMO_IDLE = 4;
const STREAM_RADIUS = 0.035;
const POUR_HEIGHT = TRAY_FLOOR + 0.4;
const BALL_RADIUS = 0.07;
const THROW_SPEED = 3.5;
const PLOW_HEIGHT = TRAY_FLOOR + 0.07;
/** Where things may be poured or thrown to. */
const REACH = TRAY_HALF - 0.08;

function showError(message: string): void {
  document.getElementById('error-message')!.textContent = message;
  document.getElementById('error')!.hidden = false;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function start(): void {
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let sim: SandSimulator;
  try {
    gl = createContext(canvas);
    sim = new SandSimulator(gl, BOX_HALF);
  } catch (err) {
    showError(err instanceof UnsupportedError ? err.message : String(err));
    return;
  }

  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 700;
  const settings: SandSettings = {
    quality: mobile ? 'Low' : 'Medium',
    autoQuality: true,
    scene: 'Sandcastle',
    material: 'Sand',
    pourRate: 1,
    sim: { stiffness: 3, gravity: 6, friction: 0.9, substeps: 2, timeScale: 1, paused: false },
    look: { smoothing: 1, grainSize: 0.0025, exposure: 1 },
  };

  const camera = new PerspectiveCamera(40, 1, 0.05, 100);
  camera.position.set(0, 0.55, 1.65);
  const renderer = new SandRenderer(gl);
  const interaction = new SandInteraction(camera, canvas);
  interaction.controls.target.set(0, -0.35, 0);
  interaction.controls.update();

  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const qualityOrder = QUALITY_ORDER.filter((name) => {
    const { width, height } = gridLayout(BOX_HALF, QUALITY_LEVELS[name].cells);
    return width <= maxTexture && height <= maxTexture && QUALITY_LEVELS[name].capacity / 512 <= maxTexture;
  });

  const ball: Ball = { on: false, position: [0, 0, 0], velocity: [0, 0, 0], radius: BALL_RADIUS };
  const ballPos = new Vector3();
  const ballVel = new Vector3();
  const ballPrev = new Vector3();
  let plowing = false;
  let pourCarry = 0;
  let pourTimer = 0;
  let demoTimer = 0;
  let demoCount = 0;
  let time = 0;
  const pourPoint = new Vector3();

  const add = (batches: Batch[]) => {
    for (const b of batches) sim.addParticles(b.positions, b.material, [0, 0, 0]);
  };
  const startScene = () => {
    sim.clear();
    ball.on = false;
    plowing = false;
    if (settings.scene === 'Sandcastle') add(sandcastle(sim.spacing));
    else if (settings.scene === 'Snowman') add(snowman(sim.spacing));
    demoTimer = 1;
    demoCount = 0;
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

  const toolbar = new SandToolbar(
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
  // Picking something to pour switches to pouring, on top of whatever is already there.
  const setMaterial = () => {
    settings.scene = 'Pour';
    toolbar.select(settings.scene, settings.material);
  };
  setQuality();
  toolbar.select(settings.scene, settings.material);
  createSandUI(settings, qualityOrder, { chooseQuality, setScene, setMaterial, clear: startScene });

  /** Launch speed and start point to land at `target`, starting `back` along the camera ray. */
  const launch = (target: Vector3, back: number, speed: number) => {
    const from = camera.position.clone().sub(target).normalize().multiplyScalar(back).add(target);
    from.set(clamp(from.x, -REACH, REACH), clamp(from.y, TRAY_FLOOR + 0.2, BOX_HALF[1] - 0.1), clamp(from.z, -REACH, REACH));
    const flight = from.distanceTo(target) / speed;
    const g = settings.sim.gravity;
    const vel = target.clone().sub(from).divideScalar(flight);
    vel.y += 0.5 * g * flight;
    return { from, vel };
  };
  const throwBall = (target: Vector3) => {
    const { from, vel } = launch(target, 1.1, THROW_SPEED);
    ballPos.copy(from);
    ballPrev.copy(from);
    ballVel.copy(vel);
    ball.on = true;
    plowing = false;
  };
  const throwSnowball = (target: Vector3) => {
    const { from, vel } = launch(target, 0.5, THROW_SPEED);
    sim.addParticles(blob(from.toArray() as Vec3, 0.045, sim.spacing), MaterialCode.Snow, vel.toArray() as Vec3);
  };
  const aimPoint = (height: number) => {
    const p = interaction.horizontalPoint(height);
    return p ? p.set(clamp(p.x, -REACH, REACH), p.y, clamp(p.z, -REACH, REACH)) : null;
  };

  interaction.onPress = () => {
    if (interaction.shift) {
      const p = aimPoint(PLOW_HEIGHT);
      if (p) {
        plowing = true;
        ball.on = true;
        ballPos.copy(p);
        ballPrev.copy(p);
        ballVel.set(0, 0, 0);
      }
      return;
    }
    if (settings.scene === 'Sandcastle') {
      const p = aimPoint(TRAY_FLOOR + 0.12);
      if (p) throwBall(p);
    } else if (settings.scene === 'Snowman') {
      const p = aimPoint(TRAY_FLOOR + 0.25);
      if (p) throwSnowball(p);
    } else {
      pourTimer = 0;
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
    }
  });

  const help = document.getElementById('help')!;
  const helpToggle = document.getElementById('help-toggle')!;
  helpToggle.addEventListener('click', () => {
    helpToggle.setAttribute('aria-expanded', String(!help.classList.toggle('collapsed')));
  });

  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, { sand: { sim, settings, interaction, setQuality, setScene, throwBall, throwSnowball, ball } });
  }

  /** Pours the chosen material at `point`: a stream, or cubes for jelly. */
  const pour = (point: Vector3, dt: number) => {
    const m = material();
    const s = sim.spacing;
    if (m.code === MaterialCode.Jelly) {
      pourTimer -= dt;
      if (pourTimer <= 0) {
        pourTimer = 0.7;
        sim.addParticles(cube([point.x, POUR_HEIGHT - 0.1, point.z], 0.05, s), m.code, [0, -0.5, 0]);
      }
      return;
    }
    const speed = settings.pourRate;
    pourCarry += (Math.PI * STREAM_RADIUS ** 2 * speed * dt) / s ** 3;
    const n = Math.floor(pourCarry);
    pourCarry -= n;
    if (n > 0) sim.addParticles(streamSlice([point.x, POUR_HEIGHT, point.z], STREAM_RADIUS, speed * dt, n), m.code, [0, -speed, 0]);
  };

  /** The ball: dragged across the sandbox while plowing, otherwise flying and bouncing. */
  const moveBall = (dt: number) => {
    if (!ball.on) return;
    if (plowing) {
      if (interaction.pressing) {
        const p = aimPoint(PLOW_HEIGHT);
        if (p) {
          const step = p.sub(ballPos);
          const maxStep = 1.2 * dt;
          if (step.length() > maxStep) step.setLength(maxStep);
          ballPos.add(step);
        }
      } else {
        plowing = false;
      }
      ballVel.copy(ballPos).sub(ballPrev).divideScalar(Math.max(dt, 1e-4));
      return;
    }
    const r = BALL_RADIUS;
    ballVel.y -= settings.sim.gravity * dt;
    // Sand soaks up a moving ball's energy.
    if (ballPos.y < TRAY_FLOOR + 0.1 + r) ballVel.multiplyScalar(Math.exp(-2.5 * dt));
    ballPos.addScaledVector(ballVel, dt);
    const inTray = Math.abs(ballPos.x) < TRAY_HALF + TRAY_WALL && Math.abs(ballPos.z) < TRAY_HALF + TRAY_WALL;
    const floor = inTray ? TRAY_FLOOR : TABLE_Y;
    if (ballPos.y < floor + r) {
      ballPos.y = floor + r;
      if (ballVel.y < 0) ballVel.y *= -0.3;
      ballVel.x *= Math.exp(-3 * dt);
      ballVel.z *= Math.exp(-3 * dt);
    }
    if (inTray && ballPos.y < TABLE_Y + TRAY_HEIGHT + r) {
      for (const axis of ['x', 'z'] as const) {
        const limit = TRAY_HALF - r;
        if (Math.abs(ballPos[axis]) > limit && Math.abs(ballPrev[axis]) <= limit + 1e-3) {
          ballPos[axis] = Math.sign(ballPos[axis]) * limit;
          ballVel[axis] *= -0.4;
        }
      }
    }
  };

  /** What happens when nobody has touched the page for a while. */
  const demo = (dt: number) => {
    if (interaction.idleTime < DEMO_IDLE) return;
    demoTimer -= dt;
    if (settings.scene === 'Pour') {
      if (sim.count < sim.capacity * 0.5) {
        pourPoint.set(Math.cos(time * 0.4) * 0.3, 0, Math.sin(time * 0.53) * 0.3);
        pour(pourPoint, dt);
      }
      return;
    }
    if (demoTimer > 0) return;
    const rounds = settings.scene === 'Sandcastle' ? 3 : 8;
    if (demoCount >= rounds) {
      startScene();
      demoTimer = 3;
      return;
    }
    demoCount++;
    const a = Math.random() * Math.PI * 2;
    if (settings.scene === 'Sandcastle') {
      demoTimer = 6;
      throwBall(new Vector3(Math.cos(a) * 0.1, TRAY_FLOOR + 0.15, Math.sin(a) * 0.1));
    } else {
      demoTimer = 2.5;
      const top = TRAY_FLOOR + 0.2 + Math.random() * 0.35;
      throwSnowball(new Vector3(Math.cos(a) * 0.05, top, 0.05 + Math.random() * 0.1));
    }
  };

  const statsEl = document.getElementById('stats')!;
  const identity = new Quaternion();
  let frames = 0;
  let fpsTime = performance.now();
  let last = performance.now();

  const frame = (nowMs: number) => {
    const realDt = Math.min((nowMs - last) / 1000, 1 / 30);
    last = nowMs;
    interaction.update(realDt);
    const paused = settings.sim.paused;
    // Substeps grow with the step, so on slow frames run in slow motion rather than fall further behind.
    const dt = Math.min(realDt, MAX_STEP) * settings.sim.timeScale;

    ballPrev.copy(ballPos);
    const from = ballPos.toArray() as Vec3;
    if (!paused && dt > 0) {
      time += dt;
      moveBall(dt);
      if (settings.scene === 'Pour' && interaction.pressing && !interaction.shift) {
        const p = aimPoint(TRAY_FLOOR);
        if (p) pour(p, dt);
      }
      demo(dt);
      ball.position = ballPos.toArray() as Vec3;
      ball.velocity = ballVel.toArray() as Vec3;
      sim.step(dt, settings.sim, ball, from);
    }

    const view = buildViewState(camera, identity, canvas.width, canvas.height);
    renderer.render(view, sim, ball, settings.look);

    frames++;
    if (nowMs - fpsTime > 500) {
      const fps = (frames * 1000) / (nowMs - fpsTime);
      const full = sim.count >= sim.capacity ? ' · full, press C' : '';
      statsEl.textContent = `${fps.toFixed(0)} fps · ${sim.count.toLocaleString()} grains${full}${paused ? ' · paused' : ''}`;
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
