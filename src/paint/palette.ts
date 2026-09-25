import { Color } from 'three';
import type { Vec3 } from './PaintSimulator';

export const PAINT_COLORS: { name: string; hex: string }[] = [
  { name: 'Crimson', hex: '#e02b3c' },
  { name: 'Tangerine', hex: '#f77f1e' },
  { name: 'Sunflower', hex: '#f7c81e' },
  { name: 'Emerald', hex: '#17a36b' },
  { name: 'Teal', hex: '#0fa3b1' },
  { name: 'Cobalt', hex: '#1d4ed8' },
  { name: 'Violet', hex: '#7b2cbf' },
  { name: 'Magenta', hex: '#e0368e' },
  { name: 'Ink', hex: '#1a1a24' },
];

const RAINBOW = -1;

function hexToVec3(hex: string): Vec3 {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/** Colour picker bar: a swatch per paint, a cycling rainbow option and a clear button. */
export class Palette {
  private selected = RAINBOW;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly colors = PAINT_COLORS.map((c) => hexToVec3(c.hex));
  private readonly scratch = new Color();

  constructor(container: HTMLElement, onClear: () => void) {
    PAINT_COLORS.forEach((c, i) => {
      const b = this.makeSwatch(`${c.name} (${i + 1})`, i);
      b.style.background = c.hex;
    });
    const rainbow = this.makeSwatch('Rainbow (0)', RAINBOW);
    rainbow.classList.add('rainbow');

    container.append(...this.buttons);
    const divider = document.createElement('span');
    divider.className = 'divider';
    const clear = document.createElement('button');
    clear.className = 'text';
    clear.textContent = 'Clear';
    clear.title = 'Clear the tank (C)';
    clear.addEventListener('click', onClear);
    container.append(divider, clear);
    this.select(RAINBOW);

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key >= '1' && e.key <= String(PAINT_COLORS.length)) this.select(Number(e.key) - 1);
      else if (e.key === '0') this.select(RAINBOW);
    });
  }

  private makeSwatch(title: string, index: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.dataset.index = String(index);
    b.addEventListener('click', () => this.select(index));
    this.buttons.push(b);
    return b;
  }

  private select(index: number): void {
    this.selected = index;
    for (const b of this.buttons) {
      const on = Number(b.dataset.index) === index;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  /** Colour to pour right now; the rainbow option slowly cycles through hues. */
  current(time: number): Vec3 {
    if (this.selected !== RAINBOW) return this.colors[this.selected];
    this.scratch.setHSL((time * 0.12) % 1, 0.85, 0.5);
    return [this.scratch.r, this.scratch.g, this.scratch.b];
  }

  /** A random colour from the palette, excluding ink, for automatic pours. */
  random(): Vec3 {
    return this.colors[Math.floor(Math.random() * (this.colors.length - 1))];
  }
}
