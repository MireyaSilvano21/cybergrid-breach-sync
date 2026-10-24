/** Entrada adaptativa: teclado y mouse en PC; joystick virtual y botones en pantallas táctiles. */
export class Input {
  mx = 0; my = 0;
  aimX = 0; aimY = 1;
  attack = false; interact = false;
  touch = false;
  private keys = new Set<string>();
  private mouse: { x: number; y: number } | null = null;
  private stick = { x: 0, y: 0 };

  constructor(private root: HTMLElement) {
    addEventListener('keydown', (e) => { this.keys.add(e.key.toLowerCase()); if (e.key === ' ') this.attack = true; });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    const canvas = root.querySelector('canvas')!;
    canvas.addEventListener('mousemove', (e) => { this.mouse = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('mousedown', () => { this.attack = true; });
    if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) this.enableTouch();
    addEventListener('touchstart', () => this.enableTouch(), { passive: true, once: true });
    this.bindTouch();
  }

  private enableTouch() {
    if (this.touch) return;
    this.touch = true;
    this.root.querySelector<HTMLElement>('#touch')!.hidden = false;
    this.root.classList.add('touch-on');
  }

  private bindTouch() {
    const stick = this.root.querySelector<HTMLElement>('#stick')!, knob = this.root.querySelector<HTMLElement>('#knob')!;
    let id: number | null = null;
    const move = (e: PointerEvent) => {
      const b = stick.getBoundingClientRect();
      let dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
      const d = Math.hypot(dx, dy), m = 48;
      if (d > m) { dx = (dx / d) * m; dy = (dy / d) * m; }
      this.stick = { x: dx / m, y: dy / m };
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e: PointerEvent) => { if (e.pointerId === id) { id = null; this.stick = { x: 0, y: 0 }; knob.style.transform = ''; } };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const atk = this.root.querySelector<HTMLElement>('#t-attack')!, use = this.root.querySelector<HTMLElement>('#t-interact')!;
    atk.addEventListener('pointerdown', (e) => { e.preventDefault(); this.attack = true; });
    use.addEventListener('pointerdown', (e) => { e.preventDefault(); this.useHeld = true; });
    use.addEventListener('pointerup', () => { this.useHeld = false; });
    use.addEventListener('pointercancel', () => { this.useHeld = false; });
  }
  private useHeld = false;

  /** Actualiza los valores de este frame. playerScreen es la posición del jugador en pantalla. */
  update(playerScreen: { x: number; y: number }, autoAim: { x: number; y: number } | null) {
    const k = (a: string, b: string) => (this.keys.has(a) || this.keys.has(b) ? 1 : 0);
    let mx = k('d', 'arrowright') - k('a', 'arrowleft');
    let my = k('s', 'arrowdown') - k('w', 'arrowup');
    if (this.touch && (this.stick.x || this.stick.y)) { mx = this.stick.x; my = this.stick.y; }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    this.mx = mx; this.my = my;
    if (this.mouse && !this.touch) {
      const ax = this.mouse.x - playerScreen.x, ay = this.mouse.y - playerScreen.y, al = Math.hypot(ax, ay) || 1;
      this.aimX = ax / al; this.aimY = ay / al;
    } else if (autoAim) {
      this.aimX = autoAim.x; this.aimY = autoAim.y;
    } else if (l > 0.1) { this.aimX = mx / (l || 1); this.aimY = my / (l || 1); }
    this.interact = this.keys.has('f') || this.keys.has('e') || this.useHeld;
  }

  consumeAttack() { const a = this.attack; this.attack = false; return a; }
}
