import {
  TILE, PLAYER, INTERP_DELAY_MS, WALL, generateValidMap, moveCircle, sampleBuffer, createRng,
  type GridMap, type TimedPosition,
} from '@shared/index';
import type { Net } from './net';
import { Input } from './input';

interface Remote { id: string; name: string; buf: TimedPosition[]; hp: number; ax: number; ay: number; atk: boolean; seen: number }

const PHASE_LABEL: Record<string, string> = {
  'despertar': 'Despertar', 'primer-silencio': 'Primer Silencio', 'primera-llamada': 'Primera Llamada',
  'segunda-llamada': 'Segunda Llamada', 'cierre-portal-1': 'Cierre del portal', 'desnombrar': 'El Desnombrar', 'fin': 'Fin',
};

/**
 * Cliente de la partida: dibuja en Canvas 2D con un bucle por delta time (independiente
 * de la tasa de refresco). El servidor tiene la autoridad; el cliente solo predice el
 * movimiento propio y lo corrige con cada instantánea.
 */
export class Game {
  private ctx: CanvasRenderingContext2D;
  private map: GridMap;
  private floor: HTMLCanvasElement;
  private input: Input;
  private me = { x: 0, y: 0, hp: 100, alive: true, extracted: false, ax: 0, ay: 1, atk: false };
  private server = { x: 0, y: 0 };
  private remotes = new Map<string, Remote>();
  private portals: { x: number; y: number; open: boolean }[] = [];
  private collapseR: number | null = null;
  private seq = 0;
  private lastSend = 0;
  private raf = 0;
  private last = performance.now();
  private fpsAcc = 0; private fpsN = 0;
  private W = 0; private H = 0; private dpr = 1; private scale = 1;
  private cam = { x: 0, y: 0 };
  private offs: (() => void)[] = [];
  private el: Record<string, HTMLElement>;

  constructor(private root: HTMLElement, private net: Net, start: { seed: number; players: number; x: number; y: number }) {
    const canvas = root.querySelector('canvas')!;
    this.ctx = canvas.getContext('2d')!;
    this.map = generateValidMap(start.seed, start.players);
    this.floor = this.prerender();
    this.input = new Input(root);
    this.me.x = this.server.x = this.cam.x = start.x;
    this.me.y = this.server.y = this.cam.y = start.y;
    const q = (id: string) => root.querySelector<HTMLElement>('#' + id)!;
    this.el = { hpBar: q('hp-bar'), hpText: q('hp-text'), phase: q('phase'), timer: q('timer'), ping: q('ping'), fps: q('fps'), sync: q('sync'), syncBar: q('sync-bar'), state: q('player-state') };
    this.offs.push(net.on('snap', (m) => this.onSnap(m)));
    this.offs.push(net.on('latency', (m) => { this.el.ping.textContent = `${Math.round(m.ms)} ms`; }));
    this.resize();
    addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() { cancelAnimationFrame(this.raf); removeEventListener('resize', this.resize); this.offs.forEach((o) => o()); }

  private resize = () => {
    const c = this.ctx.canvas;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth; this.H = innerHeight;
    c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr);
    this.scale = this.W < 700 ? 0.72 : 1;
  };

  private onSnap(m: any) {
    const now = performance.now();
    this.server = { x: m.you.x, y: m.you.y };
    Object.assign(this.me, { hp: m.you.hp, alive: m.you.alive, extracted: m.you.extracted, atk: m.you.atk });
    this.portals = m.portals; this.collapseR = m.collapseR;
    for (const o of m.others) {
      let r = this.remotes.get(o.id);
      if (!r) { r = { id: o.id, name: o.name, buf: [], hp: o.hp, ax: o.ax, ay: o.ay, atk: o.atk, seen: now }; this.remotes.set(o.id, r); }
      r.buf.push({ x: o.x, y: o.y, t: now }); if (r.buf.length > 20) r.buf.shift();
      Object.assign(r, { hp: o.hp, ax: o.ax, ay: o.ay, atk: o.atk, seen: now });
    }
    for (const [id, r] of this.remotes) if (now - r.seen > 500) this.remotes.delete(id);
    this.el.hpBar.style.width = `${m.you.hp}%`;
    this.el.hpText.textContent = String(Math.ceil(m.you.hp));
    this.el.phase.textContent = PHASE_LABEL[m.phase] ?? m.phase;
    const s = m.timeLeft; this.el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el.sync.hidden = !(m.you.sync > 0);
    this.el.syncBar.style.width = `${Math.min(100, (m.you.sync / m.you.syncNeed) * 100)}%`;
  }

  private loop = (t: number) => {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.update(dt, t);
    this.draw(t);
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.el.fps.textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps`; this.fpsAcc = 0; this.fpsN = 0; }
    this.raf = requestAnimationFrame(this.loop);
  };

  private screenOf(x: number, y: number) {
    return { x: (x - this.cam.x) * this.scale + this.W / 2, y: (y - this.cam.y) * this.scale + this.H / 2 };
  }

  private update(dt: number, t: number) {
    // Auto-apuntado táctil: el enemigo visible más cercano dentro del alcance.
    let auto: { x: number; y: number } | null = null;
    if (this.input.touch) {
      let best = PLAYER.attackRange * 2;
      for (const r of this.remotes.values()) {
        const p = r.buf[r.buf.length - 1]; if (!p) continue;
        const d = Math.hypot(p.x - this.me.x, p.y - this.me.y);
        if (d < best) { best = d; auto = { x: (p.x - this.me.x) / d, y: (p.y - this.me.y) / d }; }
      }
    }
    this.input.update(this.screenOf(this.me.x, this.me.y), auto);
    if (this.me.alive && !this.me.extracted) {
      // Predicción local con la misma física que el servidor.
      const p = moveCircle(this.map, this.me, this.input.mx * PLAYER.speed * dt, this.input.my * PLAYER.speed * dt, PLAYER.radius);
      this.me.x = p.x; this.me.y = p.y;
      // Reconciliación suave con la posición autoritativa.
      const ex = this.server.x - this.me.x, ey = this.server.y - this.me.y;
      if (Math.hypot(ex, ey) > 120) { this.me.x = this.server.x; this.me.y = this.server.y; }
      else { const k = Math.min(1, dt * 8); this.me.x += ex * k; this.me.y += ey * k; }
    }
    this.me.ax = this.input.aimX; this.me.ay = this.input.aimY;
    const attack = this.input.consumeAttack();
    if (t - this.lastSend > 33 || attack) {
      this.lastSend = t;
      this.net.send({ type: 'input', seq: ++this.seq, mx: this.input.mx, my: this.input.my, ax: this.input.aimX, ay: this.input.aimY, attack, interact: this.input.interact });
    }
    this.cam.x += (this.me.x - this.cam.x) * Math.min(1, dt * 6);
    this.cam.y += (this.me.y - 20 - this.cam.y) * Math.min(1, dt * 6);
    const st = this.el.state;
    st.dataset.x = String(Math.round(this.me.x)); st.dataset.y = String(Math.round(this.me.y)); st.dataset.hp = String(this.me.hp);
  }

  private prerender(): HTMLCanvasElement {
    const c = document.createElement('canvas'), m = this.map;
    c.width = m.width * TILE / 2; c.height = m.height * TILE / 2; // media resolución: suficiente para el piso
    const g = c.getContext('2d')!; g.scale(0.5, 0.5);
    const r = createRng(m.seed), pal = ['#4f4f6c', '#4a4964', '#545370', '#46455f', '#4d4a66'];
    g.fillStyle = '#1b1524'; g.fillRect(0, 0, m.width * TILE, m.height * TILE);
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
      const X = x * TILE, Y = y * TILE;
      if (m.tiles[y * m.width + x] === WALL) {
        const below = y + 1 < m.height && m.tiles[(y + 1) * m.width + x] !== WALL;
        g.fillStyle = '#2b2238'; g.fillRect(X, Y, TILE, TILE);
        g.fillStyle = '#3a3050'; g.fillRect(X + 3, Y + 3, TILE - 6, TILE - 6);
        if (below) { g.fillStyle = '#4a3e60'; g.fillRect(X, Y + TILE - 22, TILE, 22); g.fillStyle = '#1d0c16'; g.fillRect(X, Y + TILE - 3, TILE, 3); }
        continue;
      }
      g.fillStyle = pal[Math.floor(r() * pal.length)];
      g.beginPath(); g.roundRect(X + 3, Y + 3, TILE - 6, TILE - 6, 8); g.fill();
      g.fillStyle = 'rgba(255,240,255,.06)'; g.fillRect(X + 6, Y + 5, TILE - 12, 4);
    }
    return c;
  }

  private draw(t: number) {
    const g = this.ctx, s = this.scale * this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b0610'; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.setTransform(s, 0, 0, s, (this.W / 2 - this.cam.x * this.scale) * this.dpr, (this.H / 2 - this.cam.y * this.scale) * this.dpr);
    g.drawImage(this.floor, 0, 0, this.map.width * TILE, this.map.height * TILE);

    for (const p of this.portals) {
      g.lineWidth = 6; g.strokeStyle = p.open ? '#b77bff' : '#3a3050';
      g.beginPath(); g.ellipse(p.x, p.y, 70, 38, 0, 0, Math.PI * 2); g.stroke();
      if (p.open) { g.fillStyle = `rgba(170,120,255,${0.25 + 0.15 * Math.sin(t / 300)})`; g.fill(); }
    }
    for (const mo of this.map.monoliths) { g.fillStyle = '#3d3551'; g.fillRect(mo.x - 14, mo.y - 70, 28, 70); g.strokeStyle = '#1d0c16'; g.lineWidth = 3; g.strokeRect(mo.x - 14, mo.y - 70, 28, 70); }

    const renderT = performance.now() - INTERP_DELAY_MS;
    const actors: { x: number; y: number; name: string; hp: number; ax: number; ay: number; atk: boolean; me: boolean }[] = [];
    for (const r of this.remotes.values()) { const p = sampleBuffer(r.buf, renderT); if (p) actors.push({ ...p, name: r.name, hp: r.hp, ax: r.ax, ay: r.ay, atk: r.atk, me: false }); }
    if (this.me.alive && !this.me.extracted) actors.push({ x: this.me.x, y: this.me.y, name: '', hp: this.me.hp, ax: this.me.ax, ay: this.me.ay, atk: this.me.atk, me: true });
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) this.drawActor(a);

    // Oscuridad con la visión del jugador y la luz de los portales.
    g.setTransform(1, 0, 0, 1, 0, 0);
    const sc = this.screenOf(this.me.x, this.me.y);
    const grad = g.createRadialGradient(sc.x * this.dpr, sc.y * this.dpr, 60 * this.dpr, sc.x * this.dpr, sc.y * this.dpr, 520 * this.scale * this.dpr);
    grad.addColorStop(0, 'rgba(8,3,14,0)'); grad.addColorStop(1, 'rgba(8,3,14,.92)');
    g.fillStyle = grad; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    if (this.collapseR != null) {
      g.setTransform(s, 0, 0, s, (this.W / 2 - this.cam.x * this.scale) * this.dpr, (this.H / 2 - this.cam.y * this.scale) * this.dpr);
      const lp = this.portals[1];
      if (lp) { g.strokeStyle = 'rgba(255,60,120,.6)'; g.lineWidth = 8; g.beginPath(); g.arc(lp.x, lp.y, this.collapseR, 0, Math.PI * 2); g.stroke(); }
    }
  }

  private drawActor(a: { x: number; y: number; name: string; hp: number; ax: number; ay: number; atk: boolean; me: boolean }) {
    const g = this.ctx;
    g.fillStyle = 'rgba(10,4,12,.45)'; g.beginPath(); g.ellipse(a.x, a.y + 4, 20, 8, 0, 0, Math.PI * 2); g.fill();
    g.lineWidth = 4; g.strokeStyle = '#1d0c16'; g.fillStyle = a.me ? '#e3922f' : '#8d879a';
    g.beginPath(); g.arc(a.x, a.y - 22, 20, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = a.atk ? '#ffd36a' : '#6b4226'; g.lineWidth = a.atk ? 7 : 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(a.x + a.ax * 14, a.y - 22 + a.ay * 14); g.lineTo(a.x + a.ax * 40, a.y - 22 + a.ay * 40); g.stroke();
    if (!a.me) {
      g.fillStyle = '#2a1020'; g.fillRect(a.x - 22, a.y - 58, 44, 6);
      g.fillStyle = '#ff6b6b'; g.fillRect(a.x - 22, a.y - 58, 44 * (a.hp / 100), 6);
      g.font = '500 13px "Alegreya Sans", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#f3e6d8'; g.fillText(a.name, a.x, a.y - 64);
    }
  }
}
