import { GASES } from './gases';

/** Bottom toolbar: one swatch per gas fill. */
export class PlasmaToolbar {
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(container: HTMLElement, onGas: (index: number) => void) {
    GASES.forEach((gas, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = gas.swatch;
      b.title = `${gas.name} (${i + 1})`;
      b.setAttribute('aria-label', gas.name);
      b.addEventListener('click', () => onGas(i));
      container.append(b);
      this.buttons.push(b);
    });
  }

  select(index: number): void {
    this.buttons.forEach((b, i) => {
      b.classList.toggle('selected', i === index);
      b.setAttribute('aria-pressed', String(i === index));
    });
  }
}
