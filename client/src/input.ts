/** Entrada adaptativa: teclado y mouse en PC; joystick virtual y botones en pantallas táctiles. */
export class Input {
  mx = 0; my = 0;
  aimX = 0; aimY = 1;
  attack = false; interact = false; use = false;
  touch = false;
  private keys = new Set<string>();
  private mouse: { x: number; y: number } | null = null;
  private stick = { x: 0, y: 0 };

  constructor(private root: HTMLElement) {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (e.key === ' ') this.attack = true;
      if ((k === 'f' || k === 'e') && !e.repeat) this.use = true;
    });
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
    const zone = this.root.querySelector<HTMLElement>('#stick-zone')!;
    const stick = this.root.querySelector<HTMLElement>('#stick')!, knob = this.root.querySelector<HTMLElement>('#knob')!;
    const R = 48;
    let id: number | null = null, cx = 0, cy = 0;
    // Joystick flotante: aparece donde el pulgar toca dentro de la mitad izquierda.
    const place = (x: number, y: number) => {
      const b = stick.getBoundingClientRect();
      const half = b.width / 2;
      cx = Math.max(half + 8, Math.min(innerWidth * 0.48 - half, x));
      cy = Math.max(innerHeight * 0.3 + half, Math.min(innerHeight - half - 8, y));
      stick.style.left = `${cx - half}px`; stick.style.top = `${cy - half}px`; stick.style.bottom = 'auto';
    };
    const move = (x: number, y: number) => {
      let dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      const dead = 0.12, mag = Math.min(1, d / R);
      this.stick = mag < dead ? { x: 0, y: 0 } : { x: dx / R, y: dy / R };
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    };
    const reset = () => {
      id = null; this.stick = { x: 0, y: 0 };
      knob.style.transform = ''; stick.classList.remove('active');
      stick.style.left = ''; stick.style.top = ''; stick.style.bottom = '';
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId; zone.setPointerCapture(id);
      stick.classList.add('active'); place(e.clientX, e.clientY); move(e.clientX, e.clientY);
      this.requestFullscreen();
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.preventDefault(); move(e.clientX, e.clientY); } });
    zone.addEventListener('pointerup', (e) => { if (e.pointerId === id) reset(); });
    zone.addEventListener('pointercancel', (e) => { if (e.pointerId === id) reset(); });
    zone.addEventListener('contextmenu', (e) => e.preventDefault());

    const atk = this.root.querySelector<HTMLElement>('#t-attack')!, use = this.root.querySelector<HTMLElement>('#t-interact')!;
    atk.addEventListener('pointerdown', (e) => { e.preventDefault(); this.attack = true; this.requestFullscreen(); });
    use.addEventListener('pointerdown', (e) => { e.preventDefault(); this.useHeld = true; this.use = true; });
    use.addEventListener('pointerup', () => { this.useHeld = false; });
    use.addEventListener('pointercancel', () => { this.useHeld = false; });
    for (const b of [atk, use]) b.addEventListener('contextmenu', (e) => e.preventDefault());

    const fs = this.root.querySelector<HTMLButtonElement>('#fs-btn')!;
    const sync = () => { fs.hidden = !document.fullscreenEnabled || !!document.fullscreenElement; };
    fs.addEventListener('click', () => this.requestFullscreen(true));
    document.addEventListener('fullscreenchange', sync);
    sync();
  }

  private fsTried = false;
  /** Pantalla completa en horizontal. El navegador solo lo permite tras un toque del usuario. */
  requestFullscreen(force = false) {
    if ((!force && this.fsTried) || document.fullscreenElement || !document.fullscreenEnabled) return;
    this.fsTried = true;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => { /* el navegador puede negarlo; el juego funciona igual */ });
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
  consumeUse() { const u = this.use; this.use = false; return u; }
}
