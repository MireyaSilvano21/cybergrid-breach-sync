import type { Slot } from '@shared/index';

/** Lanzamiento pedido: en PC apunta al cursor; en móvil, a donde se arrastró el botón (o rápido si solo se tocó). */
export interface CastRequest { slot: Slot; drag: { dx: number; dy: number; len: number } | null }

/**
 * Entrada adaptativa (controles estilo Albion):
 * PC: WASD mover, clic sobre un enemigo para fijarlo (clic al suelo lo suelta), Tab el más cercano,
 * Q/E/R habilidades hacia el cursor, Espacio cambia de Foco, F usar.
 * Táctil: joystick a la izquierda; a la derecha Atacar (fija al más cercano), Q/E/R con arrastre para apuntar, cambio de Foco y Usar.
 */
export class Input {
  mx = 0; my = 0;
  aimX = 0; aimY = 1;
  attack = false; interact = false; use = false;
  touch = false;
  /** Posición del mouse en pantalla (para apuntar habilidades). */
  mouse: { x: number; y: number } | null = null;
  casts: CastRequest[] = [];
  swap = false; tab = false; clear = false;
  /** Clic en pantalla para fijar o soltar objetivo. */
  click: { x: number; y: number } | null = null;
  /** Arrastre activo de un botón de habilidad (para dibujar la guía). */
  aimDrag: { slot: Slot; dx: number; dy: number; len: number } | null = null;
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };

  constructor(private root: HTMLElement) {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (e.repeat) return;
      if (k === 'q' || k === 'e' || k === 'r') this.casts.push({ slot: k.toUpperCase() as Slot, drag: null });
      if (e.key === ' ') { this.swap = true; e.preventDefault(); }
      if (e.key === 'Tab') { this.tab = true; e.preventDefault(); }
      if (e.key === 'Escape') this.clear = true;
      if (k === 'f') this.use = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    const canvas = root.querySelector('canvas')!;
    canvas.addEventListener('mousemove', (e) => { this.mouse = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this.click = { x: e.clientX, y: e.clientY }; });
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
    // Botones de habilidad: tocar lanza rápido; arrastrar muestra la guía y lanza al soltar (volver al botón cancela).
    for (const b of this.root.querySelectorAll<HTMLElement>('.tbtn.ab')) {
      const slot = b.dataset.slot as Slot;
      let pid: number | null = null, sx = 0, sy = 0;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); pid = e.pointerId; b.setPointerCapture(pid); sx = e.clientX; sy = e.clientY; this.aimDrag = { slot, dx: 0, dy: 0, len: 0 }; });
      b.addEventListener('pointermove', (e) => { if (e.pointerId !== pid) return; const dx = e.clientX - sx, dy = e.clientY - sy; this.aimDrag = { slot, dx, dy, len: Math.hypot(dx, dy) }; });
      const end = (e: PointerEvent, cancel: boolean) => {
        if (e.pointerId !== pid) return;
        pid = null;
        const d = this.aimDrag; this.aimDrag = null;
        const r = b.getBoundingClientRect(), back = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (cancel || !d) return;
        if (d.len > 18 && back) return; // se arrastró y se regresó al botón: cancelar
        this.casts.push({ slot, drag: d.len > 18 ? d : null });
      };
      b.addEventListener('pointerup', (e) => end(e, false));
      b.addEventListener('pointercancel', (e) => end(e, true));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    const sw = this.root.querySelector<HTMLElement>('#t-swap');
    sw?.addEventListener('pointerdown', (e) => { e.preventDefault(); this.swap = true; });
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
    this.interact = this.keys.has('f') || this.useHeld;
  }

  consumeAttack() { const a = this.attack; this.attack = false; return a; }
  /** Entrega y limpia los eventos de este cuadro. */
  consumeEvents() {
    const ev = { casts: this.casts, swap: this.swap, tab: this.tab, clear: this.clear, click: this.click };
    this.casts = []; this.swap = false; this.tab = false; this.clear = false; this.click = null;
    return ev;
  }
  consumeUse() { const u = this.use; this.use = false; return u; }
}
