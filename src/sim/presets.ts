export type PresetName = 'Dam Break' | 'Drop' | 'Double Dam' | 'Calm Pool';

export const PRESET_NAMES: PresetName[] = ['Dam Break', 'Drop', 'Double Dam', 'Calm Pool'];

type Vec3 = [number, number, number];

interface Region {
  min: Vec3;
  size: Vec3;
  /** Fraction of the particles placed in this region. */
  share: number;
}

/** Fraction of the container volume filled with water, for every preset. */
export const WATER_FRACTION = 0.3;

function regionsFor(preset: PresetName, half: Vec3, volume: number): Region[] {
  const [hx, hy, hz] = half;
  const width = 2 * hx;
  const depth = 2 * hz;
  const m = 0.02;
  switch (preset) {
    case 'Dam Break': {
      const height = 2 * hy * 0.85;
      const length = volume / (height * depth);
      return [{ min: [-hx + m, -hy + m, -hz + m], size: [length, height, depth - 2 * m], share: 1 }];
    }
    case 'Double Dam': {
      const height = 2 * hy * 0.85;
      const length = volume / 2 / (height * depth);
      return [
        { min: [-hx + m, -hy + m, -hz + m], size: [length, height, depth - 2 * m], share: 0.5 },
        { min: [hx - m - length, -hy + m, -hz + m], size: [length, height, depth - 2 * m], share: 0.5 },
      ];
    }
    case 'Drop': {
      const poolVolume = volume * 0.55;
      const poolHeight = poolVolume / (width * depth);
      const side = Math.cbrt(volume - poolVolume);
      const top = hy - m - side * 1.05;
      return [
        { min: [-hx + m, -hy + m, -hz + m], size: [width - 2 * m, poolHeight, depth - 2 * m], share: 0.55 },
        { min: [-side / 2, top, -side / 2], size: [side, side, side], share: 0.45 },
      ];
    }
    case 'Calm Pool':
    default: {
      const height = volume / (width * depth);
      return [{ min: [-hx + m, -hy + m, -hz + m], size: [width - 2 * m, height, depth - 2 * m], share: 1 }];
    }
  }
}

/**
 * Fills the preset's regions with particles on a jittered lattice of spacing `spacing`,
 * layer by layer from the bottom. Returns RGBA float data (xyz = position).
 */
export function buildPreset(preset: PresetName, count: number, half: Vec3, spacing: number): Float32Array {
  const volume = WATER_FRACTION * 8 * half[0] * half[1] * half[2];
  const regions = regionsFor(preset, half, volume);
  const data = new Float32Array(count * 4);
  const jitter = spacing * 0.1;
  let written = 0;

  regions.forEach((region, r) => {
    const target = r === regions.length - 1 ? count - written : Math.round(count * region.share);
    const nx = Math.max(1, Math.floor(region.size[0] / spacing));
    const nz = Math.max(1, Math.floor(region.size[2] / spacing));
    const maxY = half[1] - spacing * 0.5;
    for (let n = 0; n < target; n++) {
      const layer = Math.floor(n / (nx * nz));
      const inLayer = n % (nx * nz);
      const ix = inLayer % nx;
      const iz = Math.floor(inLayer / nx);
      const x = region.min[0] + (ix + 0.5) * spacing + (Math.random() - 0.5) * jitter;
      const y = Math.min(region.min[1] + (layer + 0.5) * spacing, maxY) + (Math.random() - 0.5) * jitter;
      const z = region.min[2] + (iz + 0.5) * spacing + (Math.random() - 0.5) * jitter;
      const o = (written + n) * 4;
      data[o] = x;
      data[o + 1] = y;
      data[o + 2] = z;
      data[o + 3] = 1;
    }
    written += target;
  });

  return data;
}
