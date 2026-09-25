import { THEMES } from './themes';

/** Bottom toolbar: one swatch per colour scheme (keys 1-5), wax on liquid. */
export class LavaToolbar {
  private readonly swatches = new Map<string, HTMLButtonElement>();

  constructor(container: HTMLElement, onTheme: (name: string) => void) {
    THEMES.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.title = `${t.name} (${i + 1})`;
      b.setAttribute('aria-label', t.name);
      b.style.background = `radial-gradient(circle at 40% 40%, ${t.swatch[0]} 0 38%, ${t.swatch[1]} 42%)`;
      b.addEventListener('click', () => onTheme(t.name));
      this.swatches.set(t.name, b);
      container.append(b);
    });
  }

  select(name: string): void {
    for (const [n, b] of this.swatches) {
      b.classList.toggle('selected', n === name);
      b.setAttribute('aria-pressed', String(n === name));
    }
  }
}
