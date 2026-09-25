import type { Vec3 } from './PlasmaSimulator';

export interface Gas {
  name: string;
  /** Colour of the glow, or null to give every filament its own shifting hue. */
  color: Vec3 | null;
  /** CSS colour for the toolbar swatch. */
  swatch: string;
}

export const GASES: Gas[] = [
  { name: 'Neon & argon', color: [0.7, 0.25, 1], swatch: '#b14dff' },
  { name: 'Neon', color: [1, 0.28, 0.07], swatch: '#ff5a1f' },
  { name: 'Argon', color: [0.42, 0.32, 1], swatch: '#6b52ff' },
  { name: 'Xenon', color: [0.28, 0.55, 1], swatch: '#478cff' },
  { name: 'Helium', color: [1, 0.5, 0.4], swatch: '#ff8a70' },
  { name: 'Krypton', color: [0.75, 0.85, 1], swatch: '#c4d6ff' },
  { name: 'Rainbow', color: null, swatch: 'conic-gradient(#ff3b6b, #ffb13b, #3bff9d, #3bb4ff, #b13bff, #ff3b6b)' },
];

export function hueColor(h: number): Vec3 {
  const c = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.max(0, Math.min(1, Math.abs(k - 3) - 1));
  };
  return [c(5), c(3), c(1)];
}
