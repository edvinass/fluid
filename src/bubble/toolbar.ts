import type { Environment } from './BubbleRenderer';

const ENVIRONMENTS: Environment[] = ['Studio', 'Daylight'];

/** Bottom toolbar: lighting choice, plus pop and new-bubble buttons. */
export class BubbleToolbar {
  private readonly envButtons = new Map<Environment, HTMLButtonElement>();

  constructor(container: HTMLElement, onEnvironment: (env: Environment) => void, onPop: () => void, onNew: () => void) {
    for (const env of ENVIRONMENTS) {
      const b = this.button(container, env, env);
      b.addEventListener('click', () => onEnvironment(env));
      this.envButtons.set(env, b);
    }
    const divider = document.createElement('span');
    divider.className = 'divider';
    container.append(divider);
    this.button(container, 'Pop', 'Pop the bubble (P)').addEventListener('click', onPop);
    this.button(container, 'New bubble', 'Blow a new bubble (R)').addEventListener('click', onNew);
  }

  select(env: Environment): void {
    for (const [name, b] of this.envButtons) {
      b.classList.toggle('selected', name === env);
      b.setAttribute('aria-pressed', String(name === env));
    }
  }

  private button(container: HTMLElement, label: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'text';
    b.textContent = label;
    b.title = title;
    container.append(b);
    return b;
  }
}
