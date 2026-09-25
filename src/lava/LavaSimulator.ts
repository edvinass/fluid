import type { MouseForce, Vec3 } from '../sim/SPHSimulator';
import { MOUSE_NONE } from '../sim/SPHSimulator';

export interface LavaParams {
  /** Bulb power: how fast the pool of wax on the bulb melts. */
  heat: number;
  /** How fast blobs lose heat to the liquid. */
  cooling: number;
  /** Lift on melted wax and sink on cooled wax, world units / s^2. */
  buoyancy: number;
  /** How thick the liquid is: higher is slower. */
  drag: number;
  /** Fraction of the lamp filled with wax (applied on restart). */
  waxAmount: number;
  timeScale: number;
  paused: boolean;
}

/** Must match lamp.glsl. */
export const LAMP = {
  bottom: -0.62,
  waist: -0.25,
  top: 0.62,
  rBottom: 0.17,
  rWaist: 0.25,
  rTop: 0.12,
};

export function lampRadius(y: number): number {
  const t = (a: number, b: number) => Math.min(1, Math.max(0, (y - a) / (b - a)));
  return y < LAMP.waist
    ? LAMP.rBottom + (LAMP.rWaist - LAMP.rBottom) * t(LAMP.bottom, LAMP.waist)
    : LAMP.rWaist + (LAMP.rTop - LAMP.rWaist) * t(LAMP.waist, LAMP.top);
}

export interface Blob {
  p: Vec3;
  v: Vec3;
  volume: number;
  /** 0 = cold, 1 = hot. Wax melts (and turns buoyant) between about 0.45 and 0.65. */
  temperature: number;
  /** Still growing out of the pool. */
  attached: boolean;
  /** Volume at which a growing bud lets go of the pool. */
  budVolume: number;
  /** Radius of the neck joining the blob to the pool (thins to nothing after it lets go). */
  neck: number;
  /** Vertical stretch (1 = round; horizontal scale is 1 / sqrt of it, so volume is kept). */
  stretch: number;
  /** Being absorbed into another blob, or into the pool (`mergeIntoPool`). */
  mergeInto: Blob | null;
  mergeIntoPool: boolean;
  /** Seconds before this blob may merge again (just after splitting). */
  noMerge: number;
  phase: number;
}

export const MAX_BLOBS = 24;
const MIN_VOLUME = 4e-5;
const MELT_LOW = 0.45;
const MELT_HIGH = 0.65;

const radiusOf = (volume: number) => Math.cbrt((3 * volume) / (4 * Math.PI));
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Liquid temperature: warm just above the bulb, cool everywhere else. */
function liquidTemperature(y: number): number {
  return 0.25 + 0.35 * Math.exp(-(y - LAMP.bottom) / 0.08);
}

/**
 * The wax in a lava lamp, simulated as it behaves: a pool on the bulb melts, swells into a bud
 * that necks and pinches off, and the blob rises through the liquid while losing heat (small blobs
 * faster), squashes against the cap, sinks once it has cooled and melts back into the pool. Blobs
 * of similar temperature merge; a hot rising blob and a cold sinking one slide past each other.
 */
export class LavaSimulator {
  blobs: Blob[] = [];
  poolVolume = 0;
  poolTemperature = 0.3;
  time = 0;
  private totalVolume = 0;
  private budCooldown = 0;
  /** Cumulative lamp volume from the bottom, sampled evenly in height. */
  private readonly volumeTable: Float64Array;
  private readonly tableStep: number;

  constructor() {
    const n = 512;
    this.tableStep = (LAMP.top - LAMP.bottom) / n;
    this.volumeTable = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const r = lampRadius(LAMP.bottom + (i + 0.5) * this.tableStep);
      this.volumeTable[i + 1] = this.volumeTable[i] + Math.PI * r * r * this.tableStep;
    }
  }

  get lampVolume(): number {
    return this.volumeTable[this.volumeTable.length - 1];
  }

  /** Height of the pool's surface. */
  get poolTop(): number {
    const table = this.volumeTable;
    let lo = 0;
    let hi = table.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid] < this.poolVolume) lo = mid;
      else hi = mid;
    }
    const f = (this.poolVolume - table[lo]) / Math.max(table[hi] - table[lo], 1e-12);
    return LAMP.bottom + (lo + Math.min(Math.max(f, 0), 1)) * this.tableStep;
  }

  /** All the wax cold, in a pool on the bulb. */
  reset(waxAmount: number): void {
    this.totalVolume = waxAmount * this.lampVolume;
    this.poolVolume = this.totalVolume;
    this.poolTemperature = 0.3;
    this.blobs = [];
    this.time = 0;
    this.budCooldown = 0;
  }

  radius(b: Blob): number {
    return radiusOf(b.volume);
  }

  step(dt: number, params: LavaParams, mouse: MouseForce | null): void {
    this.time += dt;
    const poolTop = this.poolTop;
    this.heatPool(dt, params);
    this.growBuds(dt, params, poolTop);

    for (const b of this.blobs) {
      if (b.attached) continue;
      b.noMerge = Math.max(0, b.noMerge - dt);
      const r = radiusOf(b.volume);
      // Heat exchange with the liquid, faster for small blobs (more surface for their volume).
      b.temperature += params.cooling * (0.07 / r) * (liquidTemperature(b.p[1]) - b.temperature) * dt;
      // Wax touching the pool warms up quickly.
      if (b.p[1] - r * b.stretch < poolTop + 0.02) b.temperature += 0.5 * (this.poolTemperature - b.temperature) * dt;

      const lift = params.buoyancy * (2 * smoothstep(MELT_LOW, MELT_HIGH, b.temperature) - 1);
      // Terminal speed grows with size, as it does for drops sinking or rising through a liquid.
      const drag = params.drag * (0.07 / r);
      b.v[1] += lift * dt;
      if (mouse && mouse.mode !== MOUSE_NONE) this.push(b, r, mouse, dt);
      const damp = Math.exp(-drag * dt);
      for (let i = 0; i < 3; i++) b.v[i] *= damp;
      b.neck = Math.max(0, b.neck - r * 0.5 * dt);
    }

    this.collide(dt, params, poolTop);
    this.merge(dt);
    this.split(dt);

    for (const b of this.blobs) {
      if (!b.attached) for (let i = 0; i < 3; i++) b.p[i] += b.v[i] * dt;
      this.confine(b, poolTop);
      this.shape(b, dt);
    }
    this.blobs = this.blobs.filter((b) => b.volume > 0);
  }

  private heatPool(dt: number, params: LavaParams): void {
    // The bulb melts the pool; the glass around it takes some heat away.
    const t = this.poolTemperature;
    this.poolTemperature += (params.heat * 0.2 * (1 - t) - 0.06 * (t - 0.3)) * dt;
  }

  /** Once the pool has melted, it swells into a bud that grows until it lets go. */
  private growBuds(dt: number, params: LavaParams, poolTop: number): void {
    this.budCooldown -= dt;
    let bud = this.blobs.find((b) => b.attached);
    const minPool = this.totalVolume * 0.2;
    if (!bud && this.budCooldown <= 0 && this.poolTemperature > 0.6 && this.poolVolume > minPool * 1.5 && this.blobs.length < MAX_BLOBS) {
      const angle = Math.random() * Math.PI * 2;
      const off = Math.random() * 0.05;
      const target = Math.min(this.totalVolume * (0.1 + Math.random() * 0.14), this.poolVolume - minPool);
      bud = {
        p: [Math.cos(angle) * off, poolTop, Math.sin(angle) * off],
        v: [0, 0, 0],
        volume: MIN_VOLUME,
        temperature: this.poolTemperature,
        attached: true,
        budVolume: target,
        neck: 0,
        stretch: 1,
        mergeInto: null,
        mergeIntoPool: false,
        noMerge: 0,
        phase: Math.random() * 10,
      };
      this.poolVolume -= MIN_VOLUME;
      this.blobs.push(bud);
    }
    if (!bud) return;

    const rate = this.totalVolume * 0.035 * Math.max(0.3, (this.poolTemperature - 0.45) / 0.4) * Math.max(params.heat, 0.2);
    const grow = Math.min(rate * dt, bud.budVolume - bud.volume, Math.max(this.poolVolume - minPool, 0));
    bud.volume += grow;
    this.poolVolume -= grow;
    bud.temperature = this.poolTemperature;
    const r = radiusOf(bud.volume);
    const progress = Math.min(bud.volume / bud.budVolume, 1);
    // The bud emerges from the pool as it grows, joined to it by a neck.
    bud.p[1] = poolTop - r * 0.6 + r * 1.9 * progress * progress;
    bud.neck = r * 0.65;
    if (progress >= 1 || grow <= 0) {
      bud.attached = false;
      bud.v = [0, 0.02, 0];
      // The wax that left was the hottest; the rest of the pool has to melt again.
      this.poolTemperature -= 0.12 + 0.4 * (bud.volume / this.totalVolume);
      this.budCooldown = 1.5 + Math.random() * 2;
    }
  }

  private push(b: Blob, r: number, mouse: MouseForce, dt: number): void {
    const [ox, oy, oz] = mouse.rayOrigin;
    const [dx, dy, dz] = mouse.rayDir;
    const rx = b.p[0] - ox;
    const ry = b.p[1] - oy;
    const rz = b.p[2] - oz;
    const along = rx * dx + ry * dy + rz * dz;
    const px = rx - dx * along;
    const py = ry - dy * along;
    const pz = rz - dz * along;
    const dist = Math.hypot(px, py, pz);
    const reach = mouse.radius + r;
    if (dist > reach) return;
    const w = 1 - dist / reach;
    const k = Math.min(8 * w * dt, 1);
    for (let i = 0; i < 3; i++) b.v[i] += (mouse.velocity[i] * 0.6 - b.v[i]) * k;
  }

  /** Blobs of different temperature push apart instead of merging. */
  private collide(dt: number, params: LavaParams, poolTop: number): void {
    const blobs = this.blobs;
    for (let i = 0; i < blobs.length; i++) {
      const a = blobs[i];
      if (a.mergeInto || a.mergeIntoPool) continue;
      const ra = radiusOf(a.volume);
      for (let j = i + 1; j < blobs.length; j++) {
        const b = blobs[j];
        if (b.mergeInto || b.mergeIntoPool) continue;
        const rb = radiusOf(b.volume);
        const d = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
        const dist = Math.hypot(d[0], d[1], d[2]) || 1e-6;
        const overlap = ra + rb - dist;
        if (overlap <= 0) continue;
        const similar = Math.abs(a.temperature - b.temperature) < 0.18;
        const canMerge = similar && !a.attached && !b.attached && a.noMerge <= 0 && b.noMerge <= 0;
        if (canMerge && dist < 0.8 * (ra + rb)) {
          const [small, big] = a.volume < b.volume ? [a, b] : [b, a];
          small.mergeInto = big;
          continue;
        }
        if (canMerge) continue;
        // Soft contact: push apart, and let them slide past each other.
        const push = overlap * 6 * params.buoyancy;
        const wa = a.attached ? 0 : b.volume / (a.volume + b.volume);
        const wb = b.attached ? 0 : a.volume / (a.volume + b.volume);
        for (let k = 0; k < 3; k++) {
          const n = d[k] / dist;
          a.v[k] -= n * push * wa * dt * 2;
          b.v[k] += n * push * wb * dt * 2;
        }
      }
      // A sinking blob that reaches the pool melts back into it.
      if (!a.attached && a.v[1] < 0.02 && a.p[1] - ra * a.stretch < poolTop + 0.004 && a.noMerge <= 0) {
        a.mergeIntoPool = true;
      }
    }
  }

  /** Absorbing blobs drain into their target over about a second, so merges look like flowing. */
  private merge(dt: number): void {
    for (const s of this.blobs) {
      const target = s.mergeInto;
      if (!target && !s.mergeIntoPool) continue;
      const rate = Math.max(s.volume * 1.8, this.totalVolume * 0.02);
      const moved = Math.min(rate * dt, s.volume);
      const rest = s.volume - moved <= MIN_VOLUME ? s.volume : moved;
      if (target && target.volume > 0) {
        const total = target.volume + rest;
        target.temperature = (target.temperature * target.volume + s.temperature * rest) / total;
        for (let k = 0; k < 3; k++) {
          target.v[k] = (target.v[k] * target.volume + s.v[k] * rest) / total;
          s.p[k] += (target.p[k] - s.p[k]) * Math.min(3 * dt, 1);
        }
        target.volume = total;
      } else if (s.mergeIntoPool) {
        const total = this.poolVolume + rest;
        this.poolTemperature = (this.poolTemperature * this.poolVolume + s.temperature * rest) / total;
        this.poolVolume = total;
        s.v[1] = Math.min(s.v[1], -0.01);
      } else {
        s.mergeInto = null;
        continue;
      }
      s.volume -= rest;
    }
  }

  /** Now and then a big blob tears in two. */
  private split(dt: number): void {
    const born: Blob[] = [];
    for (const b of this.blobs) {
      if (b.attached || b.mergeInto || b.mergeIntoPool || b.noMerge > 0) continue;
      if (b.volume < this.totalVolume * 0.14 || this.blobs.length + born.length >= MAX_BLOBS) continue;
      const speed = Math.abs(b.v[1]);
      if (Math.random() > dt * 0.04 * (1 + speed * 20)) continue;
      const f = 0.4 + Math.random() * 0.2;
      const r = radiusOf(b.volume);
      const angle = Math.random() * Math.PI * 2;
      const dir: Vec3 = [Math.cos(angle) * 0.6, (Math.random() - 0.5) * 1.2, Math.sin(angle) * 0.6];
      const child: Blob = {
        ...b,
        p: [b.p[0] + dir[0] * r * 0.5, b.p[1] + dir[1] * r * 0.5, b.p[2] + dir[2] * r * 0.5],
        v: [b.v[0] + dir[0] * 0.02, b.v[1] + dir[1] * 0.02, b.v[2] + dir[2] * 0.02],
        volume: b.volume * f,
        noMerge: 4,
        neck: 0,
        phase: Math.random() * 10,
      };
      b.volume *= 1 - f;
      for (let k = 0; k < 3; k++) {
        b.p[k] -= dir[k] * r * 0.4;
        b.v[k] -= dir[k] * 0.02;
      }
      b.noMerge = 4;
      born.push(child);
    }
    this.blobs.push(...born);
  }

  /** Inside the glass: blobs squash a little against the walls and the cap. */
  private confine(b: Blob, poolTop: number): void {
    const r = radiusOf(b.volume);
    const ry = r * b.stretch;
    const rxz = r / Math.sqrt(b.stretch);
    const top = LAMP.top - ry * 0.85;
    if (b.p[1] > top) {
      b.p[1] = top;
      b.v[1] = Math.min(b.v[1], 0);
    }
    const bottom = b.attached || b.mergeIntoPool ? LAMP.bottom : Math.max(LAMP.bottom + ry * 0.8, poolTop - ry * 0.5);
    if (b.p[1] < bottom) {
      b.p[1] = bottom;
      b.v[1] = Math.max(b.v[1], 0);
    }
    const limit = Math.max(lampRadius(b.p[1]) - rxz * 0.9, 0);
    const d = Math.hypot(b.p[0], b.p[2]);
    if (d > limit) {
      const nx = b.p[0] / d;
      const nz = b.p[2] / d;
      b.p[0] = nx * limit;
      b.p[2] = nz * limit;
      const vn = b.v[0] * nx + b.v[2] * nz;
      if (vn > 0) {
        b.v[0] -= nx * vn;
        b.v[2] -= nz * vn;
      }
    }
  }

  /** Rising and sinking blobs stretch into teardrops; blobs pressed on the cap flatten. */
  private shape(b: Blob, dt: number): void {
    const r = radiusOf(b.volume);
    let target = 1 + Math.min(Math.abs(b.v[1]) * 3, 0.35);
    if (b.p[1] >= LAMP.top - r * b.stretch * 0.9) target = 0.78;
    if (b.attached) target = 1.1;
    target *= 1 + 0.05 * Math.sin(this.time * 1.1 + b.phase);
    b.stretch += (target - b.stretch) * Math.min(2 * dt, 1);
  }
}
