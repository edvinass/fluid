import { Vector3 } from 'three';

export type Vec3 = [number, number, number];

export const ELECTRODE_RADIUS = 0.14;
export const GLASS_RADIUS = 1;
/** Filaments end on the inside of the glass. */
export const INNER_RADIUS = 0.975;
/** Height of the top of the base; the glass below it sits inside the base. */
export const BASE_TOP = -0.8;
export const MAX_FILAMENTS = 32;
export const BRANCHES = 3;
/** Points along every filament and branch. */
export const POINTS = 41;
export const STRIPS = MAX_FILAMENTS * (1 + BRANCHES);
/** Lowest a filament's end may sit on the glass, as the y of its direction. The base hides the rest. */
const MIN_END_Y = -0.55;
const CORE_WIDTH = 0.006;

export interface PlasmaParams {
  count: number;
  /** Overall brightness of the discharge. */
  voltage: number;
  /** How far the filaments wave about. */
  twist: number;
  /** How quickly the filaments drift over the glass. */
  wander: number;
  flicker: number;
  /** How far the forks at the end of each filament spread. */
  tendrils: number;
  timeScale: number;
  paused: boolean;
}

export interface FilamentColors {
  /** Colour of the thread itself. */
  thread: Vec3;
  /** Colour of the glow where it meets the electrode and the glass. */
  glow: Vec3;
}

export interface Touch {
  id: number;
  /** Unit direction from the centre of the globe. */
  point: Vec3;
}

interface Filament {
  end: Vector3;
  vel: Vector3;
  root: Vector3;
  /** Reference axis perpendicular to the filament, carried along so its wiggles don't jump. */
  u: Vector3;
  seed: number;
  age: number;
  life: number;
  /** 0 when the filament is out, 1 when fully lit. */
  presence: number;
  /** How strongly a finger holds this filament, easing between 0 and 1. */
  capture: number;
  touch: number;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise in [-1, 1]. */
function noise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i) * 2 - 1) * (1 - u) + (hash(i + 1) * 2 - 1) * u;
}

const OCTAVE_FREQ = [1.1, 2.3];
const OCTAVE_SPEED = [2, 3.6];
const OCTAVE_AMP = [1, 0.3];

/** Smooth, slowly flowing bends along a filament that travel outward from the electrode over time. */
function wiggle(t: number, time: number, seed: number): number {
  let sum = 0;
  for (let o = 0; o < OCTAVE_FREQ.length; o++) {
    sum += noise(t * OCTAVE_FREQ[o] - time * OCTAVE_SPEED[o] + seed * 31.7 + o * 13.1) * OCTAVE_AMP[o];
  }
  return sum;
}

function randomEnd(target: Vector3): Vector3 {
  const y = -0.3 + Math.random() * 1.2;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - Math.min(y, 0.95) ** 2));
  return target.set(Math.cos(a) * r, Math.min(y, 0.95), Math.sin(a) * r).normalize();
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const force = new Vector3();
const axis = new Vector3();
const v = new Vector3();
const point = new Vector3();
const start = new Vector3();
const branchEnd = new Vector3();
const touchDir = new Vector3();

/**
 * The discharge inside the globe. Each filament's end wanders over the glass, pushed apart from the
 * others and lifted by the hot gas, and snaps to a finger that touches the globe. Its path from the
 * electrode is rebuilt every frame from layered noise, with a few forks near the glass.
 */
export class PlasmaSimulator {
  /** Two texels per point: (x, y, z, core width) then (intensity, r, g, b). */
  readonly paths = new Float32Array(STRIPS * POINTS * 2 * 4);
  /** Per filament: end direction and brightness, for the glow where it meets the glass. */
  readonly ends = new Float32Array(MAX_FILAMENTS * 4);
  /** Per filament: where it leaves the electrode, and its brightness. */
  readonly roots = new Float32Array(MAX_FILAMENTS * 4);
  /** Per filament: its glow colour. */
  readonly colors = new Float32Array(MAX_FILAMENTS * 3);

  private readonly filaments: Filament[] = [];
  private time = 0;
  /** Eases to 1 while a finger draws the current away from the other filaments. */
  private drain = 0;

  constructor() {
    for (let i = 0; i < MAX_FILAMENTS; i++) {
      const end = randomEnd(new Vector3());
      this.filaments.push({
        end,
        vel: new Vector3(),
        root: end.clone(),
        u: new Vector3(1, 0, 0),
        seed: Math.random() * 100,
        age: Math.random() * 6,
        life: 3 + Math.random() * 10,
        presence: 0,
        capture: 0,
        touch: -1,
      });
    }
  }

  get activeCount(): number {
    return this.filaments.filter((f) => f.presence > 0.05).length;
  }

  /** Scatters the filaments over the glass again. */
  reset(): void {
    for (const f of this.filaments) {
      randomEnd(f.end);
      f.root.copy(f.end);
      f.vel.set(0, 0, 0);
      f.presence = 0;
      f.age = 0;
    }
  }

  step(dt: number, params: PlasmaParams, touches: Touch[], boost: number): void {
    this.time += dt;
    const fil = this.filaments;
    const count = Math.min(params.count, MAX_FILAMENTS);

    // Release filaments whose finger has lifted, then give each new finger the nearest free filament.
    const touchIds = new Set(touches.map((t) => t.id));
    for (const f of fil) if (f.touch >= 0 && !touchIds.has(f.touch)) f.touch = -1;
    for (const touch of touches) {
      if (fil.some((f) => f.touch === touch.id)) continue;
      touchDir.fromArray(touch.point);
      let best: Filament | null = null;
      let bestDot = -2;
      for (let i = 0; i < count; i++) {
        const f = fil[i];
        if (f.touch >= 0 || f.presence < 0.2) continue;
        const d = f.end.dot(touchDir);
        if (d > bestDot) {
          bestDot = d;
          best = f;
        }
      }
      if (best) best.touch = touch.id;
    }
    this.drain += ((touches.length > 0 ? 1 : 0) - this.drain) * (1 - Math.exp(-dt * 4));

    const wander = params.wander * (1 + boost);
    const repulsion = 0.6 / Math.max(count, 1);
    for (let i = 0; i < MAX_FILAMENTS; i++) {
      const f = fil[i];
      const active = i < count;
      const touch = f.touch >= 0 ? touches.find((t) => t.id === f.touch) : undefined;
      f.capture += ((touch ? 1 : 0) - f.capture) * (1 - Math.exp(-dt * (touch ? 8 : 3)));

      f.age += dt;
      const dying = !active || (!touch && f.age > f.life);
      f.presence = dying ? Math.max(0, f.presence - dt * 5) : Math.min(1, f.presence + dt * 3);
      if (dying && f.presence === 0 && active) {
        randomEnd(f.end);
        f.root.copy(f.end);
        f.vel.set(0, 0, 0);
        f.age = 0;
        f.life = 2 + Math.random() * 10;
        f.seed = Math.random() * 100;
      }

      if (touch) {
        touchDir.fromArray(touch.point);
        f.end.lerp(touchDir, 1 - Math.exp(-dt * 14)).normalize();
        f.vel.set(0, 0, 0);
      } else {
        const s = f.seed;
        const tw = this.time * 2.6 * wander;
        force.set(noise(tw + s), noise(tw + s + 17.3), noise(tw + s + 41.9)).multiplyScalar(5 * wander);
        force.y += 0.25;
        for (let j = 0; j < MAX_FILAMENTS; j++) {
          const g = fil[j];
          if (j === i || g.presence < 0.05) continue;
          tmp.subVectors(f.end, g.end);
          const d = tmp.length();
          force.addScaledVector(tmp, (repulsion * g.presence) / (d * d * d + 0.02));
        }
        for (const t of touches) {
          touchDir.fromArray(t.point);
          const closeness = Math.max(0, f.end.dot(touchDir) - 0.5) * 2;
          force.addScaledVector(tmp.subVectors(touchDir, f.end), closeness * 2.5);
        }
        if (f.end.y < MIN_END_Y) force.y += (MIN_END_Y - f.end.y) * 30;
        force.addScaledVector(f.end, -force.dot(f.end));
        f.vel.addScaledVector(force, dt).multiplyScalar(Math.exp(-dt * 1.6));
        f.vel.addScaledVector(f.end, -f.vel.dot(f.end));
        f.end.addScaledVector(f.vel, dt).normalize();
        if (f.end.y < MIN_END_Y - 0.05) {
          f.end.y = MIN_END_Y - 0.05;
          f.end.normalize();
        }
      }

      const rt = this.time * 3.2 * wander;
      tmp.set(noise(rt + f.seed * 3.1), noise(rt + f.seed * 5.7), noise(rt + f.seed * 7.3));
      tmp2.copy(f.end).addScaledVector(tmp, 0.35 * (1 - f.capture * 0.7)).normalize();
      f.root.lerp(tmp2, 1 - Math.exp(-dt * 7)).normalize();
    }
  }

  /** Rebuilds the filament paths for rendering, each coloured by `colorOf(filament index)`. */
  writePaths(params: PlasmaParams, colorOf: (index: number, seed: number) => FilamentColors, boost: number): void {
    const out = this.paths;
    out.fill(0);
    const time = this.time;
    const wander = params.wander * (1 + boost);
    const flickerTime = time * 7;
    const voltage = params.voltage * (1 + boost * 1.5);

    for (let i = 0; i < MAX_FILAMENTS; i++) {
      const f = this.filaments[i];
      const e = i * 4;
      const colors = colorOf(i, f.seed);
      this.colors.set(colors.glow, i * 3);
      const flick = 1 - params.flicker * 0.25 * (0.5 + 0.5 * noise(flickerTime + f.seed * 9.1));
      const brightness = f.presence * voltage * flick * (1 - 0.45 * this.drain * (1 - f.capture)) * (1 + 1.6 * f.capture);
      this.ends.set([f.end.x, f.end.y, f.end.z, brightness], e);
      this.roots.set([f.root.x, f.root.y, f.root.z, brightness], e);
      if (brightness <= 0.001) continue;

      start.copy(f.root).multiplyScalar(ELECTRODE_RADIUS);
      axis.copy(f.end).multiplyScalar(INNER_RADIUS).sub(start).normalize();
      f.u.addScaledVector(axis, -f.u.dot(axis));
      if (f.u.lengthSq() < 1e-6) f.u.set(axis.y, -axis.z, axis.x).addScaledVector(axis, -axis.dot(f.u));
      f.u.normalize();
      v.crossVectors(axis, f.u);

      const amp = 0.16 * params.twist * (1 + boost * 0.8) * (1 - 0.6 * f.capture);
      const width = CORE_WIDTH * (1 + 0.7 * f.capture);
      const mainStrip = i * (1 + BRANCHES);
      const wt = time * wander;
      const mainEnd = (POINTS - 1) * 8 + mainStrip * POINTS * 8;
      for (let k = 0; k < POINTS; k++) {
        const t = k / (POINTS - 1);
        point.copy(f.root).lerp(f.end, t).normalize().multiplyScalar(ELECTRODE_RADIUS + (INNER_RADIUS - ELECTRODE_RADIUS) * t);
        const env = Math.pow(Math.sin(Math.PI * t), 0.7) * amp;
        point.addScaledVector(f.u, wiggle(t, wt, f.seed) * env).addScaledVector(v, wiggle(t, wt, f.seed + 17) * env);
        this.writePoint(mainStrip, k, point, width * (0.9 + 0.5 * t), brightness * (1.1 - 0.3 * t), colors, t);
      }

      // Forks peel smoothly off the main thread and bow out to their own spot on the glass.
      for (let b = 0; b < BRANCHES; b++) {
        const bs = f.seed * 7.1 + b * 3.7;
        // Only some filaments fork, and only close to the glass.
        if (hash(bs + 3) > 0.3) continue;
        const tb = 0.78 + 0.12 * hash(bs);
        const phi = hash(bs + 1) * Math.PI * 2 + noise(time * 0.3 * wander + bs) * 1.5;
        const spread = (0.035 + 0.07 * hash(bs + 2)) * params.tendrils * (1 - 0.75 * f.capture) * (0.8 + 0.3 * noise(time * 0.7 + bs));
        branchEnd
          .copy(f.end)
          .addScaledVector(f.u, Math.cos(phi) * spread)
          .addScaledVector(v, Math.sin(phi) * spread)
          .normalize();
        if (branchEnd.y < MIN_END_Y - 0.1) branchEnd.setY(MIN_END_Y - 0.1).normalize();
        branchEnd.multiplyScalar(INNER_RADIUS);
        branchEnd.x -= out[mainEnd];
        branchEnd.y -= out[mainEnd + 1];
        branchEnd.z -= out[mainEnd + 2];
        const on = Math.min(1, Math.max(0, 0.7 + noise(time * 1.5 * params.flicker + bs * 2.3)));
        const strip = mainStrip + 1 + b;
        for (let k = 0; k < POINTS; k++) {
          const s = k / (POINTS - 1);
          const t = tb + (1 - tb) * s;
          const along = t * (POINTS - 1);
          const k0 = Math.min(Math.floor(along), POINTS - 2);
          const o0 = (mainStrip * POINTS + k0) * 8;
          const w = along - k0;
          start.set(out[o0], out[o0 + 1], out[o0 + 2]);
          point.set(out[o0 + 8], out[o0 + 9], out[o0 + 10]);
          point.lerp(start, 1 - w).addScaledVector(branchEnd, s * s);
          const bow = Math.sin(Math.PI * s) * amp * 0.25 * s;
          point.addScaledVector(f.u, wiggle(s * 0.5, wt, bs) * bow).addScaledVector(v, wiggle(s * 0.5, wt, bs + 5) * bow);
          const fadeIn = s * s * (3 - 2 * s);
          this.writePoint(strip, k, point, width * (0.8 + 0.4 * s), brightness * 0.6 * on * Math.min(1, fadeIn * 2), colors, t);
        }
      }
    }
  }

  /** Threads take on the glow colour where they meet the electrode and the glass. */
  private writePoint(strip: number, k: number, p: Vector3, width: number, intensity: number, colors: FilamentColors, t: number): void {
    const r = p.length();
    if (r > INNER_RADIUS) p.multiplyScalar(INNER_RADIUS / r);
    else if (r < ELECTRODE_RADIUS) p.multiplyScalar(ELECTRODE_RADIUS / r);
    if (p.y < BASE_TOP + 0.03) p.y = BASE_TOP + 0.03;
    const o = (strip * POINTS + k) * 8;
    const out = this.paths;
    out[o] = p.x;
    out[o + 1] = p.y;
    out[o + 2] = p.z;
    out[o + 3] = width;
    out[o + 4] = intensity;
    const g = 0.55 * (1 - Math.min(1, t / 0.12)) + 0.45 * Math.max(0, (t - 0.85) / 0.15);
    const { thread, glow } = colors;
    out[o + 5] = thread[0] + (glow[0] - thread[0]) * g;
    out[o + 6] = thread[1] + (glow[1] - thread[1]) * g;
    out[o + 7] = thread[2] + (glow[2] - thread[2]) * g;
  }
}
