import type { Vec3 } from './HoneySimulator';

export const SCENES = ['Drizzle', 'Dipper', 'Drop'] as const;
export type SceneName = (typeof SCENES)[number];

/** Which dish each scene uses (0 = plate, 1 = bowl) and whether the dipper is there. */
export const SCENE_SETUP: Record<SceneName, { dish: number; dipper: boolean }> = {
  Drizzle: { dish: 0, dipper: true },
  Dipper: { dish: 1, dipper: true },
  Drop: { dish: 0, dipper: false },
};

export interface Material {
  name: string;
  swatch: string;
  /** Kinematic viscosity, world units^2 / s. */
  viscosity: number;
  /** Light absorbed per world unit of thickness, per colour channel. */
  absorption: Vec3;
  /** Colour of light scattered inside the liquid (dark for clear liquids). */
  scatter: Vec3;
}

export const MATERIALS: Material[] = [
  { name: 'Honey', swatch: '#e8a317', viscosity: 0.8, absorption: [4, 17, 70], scatter: [0.05, 0.02, 0.002] },
  { name: 'Maple syrup', swatch: '#b5561c', viscosity: 0.12, absorption: [9, 30, 70], scatter: [0.03, 0.01, 0.001] },
  { name: 'Caramel', swatch: '#c87f2c', viscosity: 1, absorption: [30, 55, 110], scatter: [0.55, 0.26, 0.07] },
  { name: 'Chocolate', swatch: '#4a2616', viscosity: 0.7, absorption: [120, 140, 160], scatter: [0.055, 0.024, 0.012] },
  { name: 'Water', swatch: '#5ab4e8', viscosity: 0.0005, absorption: [0.8, 0.25, 0.12], scatter: [0, 0, 0] },
];

export const TABLE_Y = -0.62;
export const BOWL_CENTER: Vec3 = [0, TABLE_Y + 0.47, 0];
export const BOWL_INNER_RADIUS = 0.415;
/** Height of the dipper's head above the plate while drizzling. */
export const DRIZZLE_HEIGHT = TABLE_Y + 0.45;

function jitter(spacing: number): number {
  return (Math.random() - 0.5) * spacing * 0.8;
}

/** Particles filling the bowl up to `level` (0 = bottom, 1 = rim), on a jittered lattice. */
export function fillBowl(spacing: number, level: number): Float32Array {
  const out: number[] = [];
  const r = BOWL_INNER_RADIUS - spacing;
  const top = BOWL_CENTER[1] - r + 2 * r * level * 0.5;
  for (let y = BOWL_CENTER[1] - r; y < top; y += spacing) {
    for (let x = -r; x <= r; x += spacing) {
      for (let z = -r; z <= r; z += spacing) {
        const dy = y - BOWL_CENTER[1];
        if (x * x + dy * dy + z * z < r * r) out.push(x + jitter(spacing), y + jitter(spacing), z + jitter(spacing));
      }
    }
  }
  return new Float32Array(out);
}

/** A ball of particles. */
export function blob(center: Vec3, radius: number, spacing: number): Float32Array {
  const out: number[] = [];
  for (let x = -radius; x <= radius; x += spacing) {
    for (let y = -radius; y <= radius; y += spacing) {
      for (let z = -radius; z <= radius; z += spacing) {
        if (x * x + y * y + z * z < radius * radius) {
          out.push(center[0] + x + jitter(spacing), center[1] + y + jitter(spacing), center[2] + z + jitter(spacing));
        }
      }
    }
  }
  return new Float32Array(out);
}

/**
 * A slice of a pour stream: `count` particles in a disc of `radius` below `nozzle`, spread over the
 * `length` the stream moves in one frame so it comes out even.
 */
export function streamSlice(nozzle: Vec3, radius: number, length: number, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    out.set([nozzle[0] + Math.cos(a) * r, nozzle[1] - Math.random() * length, nozzle[2] + Math.sin(a) * r], i * 3);
  }
  return out;
}
