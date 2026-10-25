import type { Slot } from '@shared/index';
import { enterFullscreen } from './fullscreen';

/** B es el básico; Q, E y R las habilidades. */
export type AimSlot = 'B' | Slot;
export interface Drag { dx: number; dy: number; len: number }
/** Apuntado en curso (se dibuja el indicador en el piso mientras se mantiene). */
export interface AimHold { slot: AimSlot; drag: Drag | null }
/** Al soltar: en PC apunta al cursor; en táctil, a donde se arrastró, o solo si fue un toque rápido. */
export interface AimRelease { slot: AimSlot; drag: Drag | null; quick: boolean }

/**
 * Entrada adaptativa (apuntado estilo Brawl Stars):
 * PC: WASD mover; mantener clic izquierdo o Q/E/R muestra el indicador y al soltar sale hacia el cursor;
 * clic derecho o Esc cancela; Espacio cambia de Foco; F usar.
 * Táctil: joystick a la izquierda; a la derecha Atacar y Q/E/R: arrastrar apunta y soltar dispara;
 * un toque rápido apunta solo al rival más cercano.
 */
export class Input {
  mx = 0; my = 0;
  aimX = 0; aimY = 1;
  interact = false; use = false;
  touch = false;
  /** Posición del mouse en pantalla. */
  mouse: { x: number; y: number } | null = null;
  hold: AimHold | null = null;
  releases: AimRelease[] = [];
  swap = false;
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };

  constructor(private root: HTMLElement) {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (e.repeat) return;
      if (k === 'q' || k === 'e' || k === 'r') this.hold = { slot: k.toUpperCase() as Slot, drag: null };
      if (e.key === ' ') { this.swap = true; e.preventDefault(); }
      if (e.key === 'Tab') e.preventDefault();
      if (e.key === 'Escape') this.hold = null;
      if (k === 'f') this.use = true;
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if ((k === 'q' || k === 'e' || k === 'r') && this.hold?.slot === k.toUpperCase()) { this.releases.push({ slot: this.hold.slot, drag: null, quick: false }); this.hold = null; }
    });
    addEventListener('blur', () => { this.keys.clear(); this.hold = null; });
    const canvas = root.querySelector('canvas')!;
    canvas.addEventListener('mousemove', (e) => { this.mouse = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('mousedown', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (e.button === 0) this.hold = { slot: 'B', drag: null };
      else if (e.button === 2) this.hold = null;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0 && this.hold?.slot === 'B') { this.releases.push({ slot: 'B', drag: null, quick: false }); this.hold = null; } });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
    // Atacar y Q/E/R: arrastrar muestra el indicador y suelta hacia ahí; un toque rápido auto-apunta.
    // Arrastrar y regresar al botón cancela.
    const aimButton = (b: HTMLElement, slot: AimSlot) => {
      // maxLen: hasta dónde llegó el arrastre (si salió y regresó al botón, se cancela).
      let pid: number | null = null, sx = 0, sy = 0, maxLen = 0;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); pid = e.pointerId; b.setPointerCapture(pid); sx = e.clientX; sy = e.clientY; maxLen = 0; this.hold = { slot, drag: { dx: 0, dy: 0, len: 0 } }; this.requestFullscreen(); });
      b.addEventListener('pointermove', (e) => { if (e.pointerId !== pid) return; const dx = e.clientX - sx, dy = e.clientY - sy, len = Math.hypot(dx, dy); maxLen = Math.max(maxLen, len); this.hold = { slot, drag: { dx, dy, len } }; });
      const end = (e: PointerEvent, cancel: boolean) => {
        if (e.pointerId !== pid) return;
        pid = null;
        const d = this.hold?.slot === slot ? this.hold.drag : null; this.hold = null;
        const r = b.getBoundingClientRect(), back = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (cancel) return;
        if (maxLen > 18 && (back || !d || d.len <= 18)) return; // se arrastró y se regresó: cancelar
        const dragged = !!d && d.len > 18;
        this.releases.push({ slot, drag: dragged ? d : null, quick: !dragged });
      };
      b.addEventListener('pointerup', (e) => end(e, false));
      b.addEventListener('pointercancel', (e) => end(e, true));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    aimButton(atk, 'B');
    for (const b of this.root.querySelectorAll<HTMLElement>('.tbtn.ab')) aimButton(b, b.dataset.slot as Slot);
    const sw = this.root.querySelector<HTMLElement>('#t-swap');
    sw?.addEventListener('pointerdown', (e) => { e.preventDefault(); this.swap = true; });
    use.addEventListener('pointerdown', (e) => { e.preventDefault(); this.useHeld = true; this.use = true; });
    use.addEventListener('pointerup', () => { this.useHeld = false; });
    use.addEventListener('pointercancel', () => { this.useHeld = false; });
    use.addEventListener('contextmenu', (e) => e.preventDefault());

    const fs = this.root.querySelector<HTMLButtonElement>('#fs-btn')!;
    const sync = () => { fs.hidden = !document.fullscreenEnabled || !!document.fullscreenElement; };
    fs.addEventListener('click', () => this.requestFullscreen(true));
    document.addEventListener('fullscreenchange', sync);
    sync();
  }

  /** Pantalla completa en horizontal (si se salió de ella); el navegador lo permite tras un toque. */
  requestFullscreen(_force = false) { void enterFullscreen(); }

  private useHeld = false;

  /** Actualiza los valores de este frame. playerScreen es la posición del jugador en pantalla. */
  update(playerScreen: { x: number; y: number }) {
    const k = (a: string, b: string) => (this.keys.has(a) || this.keys.has(b) ? 1 : 0);
    let mx = k('d', 'arrowright') - k('a', 'arrowleft');
    let my = k('s', 'arrowdown') - k('w', 'arrowup');
    if (this.touch && (this.stick.x || this.stick.y)) { mx = this.stick.x; my = this.stick.y; }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    this.mx = mx; this.my = my;
    const d = this.hold?.drag;
    if (this.mouse && !this.touch) {
      const ax = this.mouse.x - playerScreen.x, ay = this.mouse.y - playerScreen.y, al = Math.hypot(ax, ay) || 1;
      this.aimX = ax / al; this.aimY = ay / al;
    } else if (d && d.len > 18) { this.aimX = d.dx / d.len; this.aimY = d.dy / d.len; }
    else if (l > 0.1) { this.aimX = mx / (l || 1); this.aimY = my / (l || 1); }
    this.interact = this.keys.has('f') || this.useHeld;
  }

  /** Entrega y limpia los eventos de este cuadro. */
  consumeEvents() {
    const ev = { releases: this.releases, swap: this.swap };
    this.releases = []; this.swap = false;
    return ev;
  }
  consumeUse() { const u = this.use; this.use = false; return u; }
}
