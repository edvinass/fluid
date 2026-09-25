import { MaterialCode, type Vec3 } from './SandSimulator';

export const SCENES = ['Pour', 'Sandcastle', 'Snowman'] as const;
export type SceneName = (typeof SCENES)[number];

export interface Material {
  name: string;
  swatch: string;
  code: MaterialCode;
}

/** What the pour tool can pour. */
export const MATERIALS: Material[] = [
  { name: 'Sand', swatch: '#d9b27a', code: MaterialCode.Sand },
  { name: 'Wet sand', swatch: '#8a6238', code: MaterialCode.WetSand },
  { name: 'Snow', swatch: '#eef4ff', code: MaterialCode.Snow },
  { name: 'Jelly', swatch: '#e0263c', code: MaterialCode.Jelly },
];

/** Must match sandScene.glsl. */
export const TABLE_Y = -0.5;
export const TRAY_HALF = 0.72;
export const TRAY_FLOOR = TABLE_Y + 0.025;
export const TRAY_WALL = 0.03;
export const TRAY_HEIGHT = 0.16;

export interface Batch {
  positions: Float32Array;
  material: MaterialCode;
}

function jitter(spacing: number): number {
  return (Math.random() - 0.5) * spacing * 0.6;
}

/**
 * Fills a box on a jittered lattice, keeping points where `material` returns a code (or skipping
 * them for -1), grouped by material.
 */
function fill(min: Vec3, max: Vec3, spacing: number, material: (x: number, y: number, z: number) => number): Batch[] {
  const groups = new Map<number, number[]>();
  for (let y = min[1] + spacing * 0.5; y < max[1]; y += spacing) {
    for (let x = min[0] + spacing * 0.5; x < max[0]; x += spacing) {
      for (let z = min[2] + spacing * 0.5; z < max[2]; z += spacing) {
        const px = x + jitter(spacing);
        const py = y + jitter(spacing);
        const pz = z + jitter(spacing);
        const m = material(px, py, pz);
        if (m < 0) continue;
        let g = groups.get(m);
        if (!g) groups.set(m, (g = []));
        g.push(px, py, pz);
      }
    }
  }
  return [...groups].map(([m, p]) => ({ material: m as MaterialCode, positions: new Float32Array(p) }));
}

const INNER = TRAY_HALF - 0.005;

/** A flat layer of one material over the sandbox floor. */
function layer(depth: number, material: MaterialCode, spacing: number): Batch[] {
  return fill([-INNER, TRAY_FLOOR, -INNER], [INNER, TRAY_FLOOR + depth, INNER], spacing, () => material);
}

const LAYER = 0.035;

/** A wet sand castle (walled base, keep and four towers with battlements) on dry sand. */
export function sandcastle(spacing: number): Batch[] {
  const y0 = TRAY_FLOOR + LAYER;
  const baseTop = y0 + 0.09;
  const keepTop = baseTop + 0.17;
  const towerTop = y0 + 0.25;
  const battlement = 0.03;
  const merlon = (angle: number) => Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 12) % 2 === 0;
  const castle = fill([-0.3, y0, -0.3], [0.3, keepTop + battlement, 0.3], spacing, (x, y, z) => {
    for (const tx of [-0.2, 0.2]) {
      for (const tz of [-0.2, 0.2]) {
        const dx = x - tx;
        const dz = z - tz;
        if (dx * dx + dz * dz < 0.06 ** 2) {
          if (y < towerTop) return MaterialCode.WetSand;
          if (y < towerTop + battlement && dx * dx + dz * dz > 0.035 ** 2 && merlon(Math.atan2(dz, dx))) return MaterialCode.WetSand;
        }
      }
    }
    if (Math.abs(x) < 0.2 && Math.abs(z) < 0.2 && y < baseTop) return MaterialCode.WetSand;
    const k = Math.max(Math.abs(x), Math.abs(z));
    if (k < 0.1) {
      if (y < keepTop) return MaterialCode.WetSand;
      if (y < keepTop + battlement && k > 0.075 && Math.floor((x + z + 1) / 0.04) % 2 === 0) return MaterialCode.WetSand;
    }
    return -1;
  });
  return [...layer(LAYER, MaterialCode.Sand, spacing), ...castle];
}

/** A snowman with coal eyes and buttons and a carrot nose, on a layer of snow. */
export function snowman(spacing: number): Batch[] {
  const g = TRAY_FLOOR + 0.04;
  const balls: [number, number][] = [
    [g + 0.13, 0.16],
    [g + 0.355, 0.115],
    [g + 0.52, 0.085],
  ];
  const head = balls[2];
  const middle = balls[1];
  const coal: Vec3[] = [
    [-0.03, head[0] + 0.022, 0.072],
    [0.03, head[0] + 0.022, 0.072],
    [0, middle[0] + 0.05, 0.105],
    [0, middle[0], 0.113],
    [0, middle[0] - 0.05, 0.105],
  ];
  const noseStart = 0.07;
  const noseLength = 0.09;
  const figure = fill([-0.17, g, -0.17], [0.17, head[0] + head[1], noseStart + noseLength + 0.01], spacing, (x, y, z) => {
    if (y < g) return -1;
    for (const [cx, cy, cz] of coal) {
      if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < 0.016 ** 2) return MaterialCode.Coal;
    }
    const along = z - noseStart;
    if (along > -0.02 && along < noseLength) {
      const r = 0.02 * (1 - Math.max(along, 0) / noseLength);
      if (x * x + (y - head[0]) ** 2 < r * r) return MaterialCode.Carrot;
    }
    for (const [cy, r] of balls) {
      if (x * x + (y - cy) ** 2 + z * z < r * r) return MaterialCode.Snow;
    }
    return -1;
  });
  return [...layer(0.04, MaterialCode.Snow, spacing), ...figure];
}

/** A ball of particles. */
export function blob(center: Vec3, radius: number, spacing: number): Float32Array {
  const [b] = fill(
    [center[0] - radius, center[1] - radius, center[2] - radius],
    [center[0] + radius, center[1] + radius, center[2] + radius],
    spacing,
    (x, y, z) => ((x - center[0]) ** 2 + (y - center[1]) ** 2 + (z - center[2]) ** 2 < radius * radius ? 0 : -1),
  );
  return b?.positions ?? new Float32Array();
}

/** A cube of particles. */
export function cube(center: Vec3, half: number, spacing: number): Float32Array {
  const [b] = fill(
    [center[0] - half, center[1] - half, center[2] - half],
    [center[0] + half, center[1] + half, center[2] + half],
    spacing,
    () => 0,
  );
  return b?.positions ?? new Float32Array();
}

/** A slice of a pour stream: `count` particles in a disc below `nozzle`, spread over `length`. */
export function streamSlice(nozzle: Vec3, radius: number, length: number, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    out.set([nozzle[0] + Math.cos(a) * r, nozzle[1] - Math.random() * length, nozzle[2] + Math.sin(a) * r], i * 3);
  }
  return out;
}
