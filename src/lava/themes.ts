import type { Vec3 } from '../sim/SPHSimulator';

export interface Theme {
  name: string;
  /** Linear colours. */
  wax: Vec3;
  liquid: Vec3;
  /** CSS colours for the swatch: wax on liquid. */
  swatch: [string, string];
}

export const THEMES: Theme[] = [
  { name: 'Classic', wax: [1.0, 0.2, 0.03], liquid: [1.0, 0.3, 0.5], swatch: ['#ff5a1e', '#ff7ab0'] },
  { name: 'Retro', wax: [0.9, 0.06, 0.02], liquid: [1.0, 0.7, 0.2], swatch: ['#e8220f', '#ffd36a'] },
  { name: 'Ocean', wax: [0.12, 0.35, 1.0], liquid: [0.5, 0.18, 0.85], swatch: ['#3a8cff', '#a45ae6'] },
  { name: 'Lime', wax: [0.35, 1.0, 0.08], liquid: [0.3, 0.55, 1.0], swatch: ['#9dff3a', '#7fb0ff'] },
  { name: 'Galaxy', wax: [0.6, 0.12, 1.0], liquid: [0.12, 0.75, 0.8], swatch: ['#b25aff', '#48d6e0'] },
];
