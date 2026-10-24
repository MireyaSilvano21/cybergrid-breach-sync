import {
  TILE, PLAYER, INTERP_DELAY_MS, TICK_MS, WALL, ITEMS, createJitter, updateJitter, adaptiveDelay, viewScale, VISION_RADIUS, INTERACT_RANGE, generateValidMap, moveCircle, sampleBuffer, createRng, itemValue,
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
  // --- Netcode del cliente ---
  /** Variación de llegada de los paquetes y retraso de interpolación adaptable. */
  private jitter = createJitter();
  private interpDelay = INTERP_DELAY_MS;
  private targetDelay = INTERP_DELAY_MS;
  /** Relación entre la hora local de llegada y la hora del servidor de cada instantánea. */
  private snapTimes: { t: number; st: number }[] = [];
  /** Ataque predicho: la animación sale al instante, sin esperar al servidor. */
  private swingAt = -1e9;
  private cooldownUntil = 0;
  private floaters: { x: number; y: number; text: string; t0: number; id?: string }[] = [];
  private portals: { x: number; y: number; open: boolean }[] = [];
  private chests: { id: string; x: number; y: number; s: 'closed' | 'open' | 'empty' }[] = [];
  private remains: { id: string; x: number; y: number; owner: string }[] = [];
  private inv: string[] = [];
  private toastTimer: number | undefined;
  private static sprites: Record<string, HTMLImageElement> | null = null;
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
    this.el = { hpBar: q('hp-bar'), hpText: q('hp-text'), phase: q('phase'), timer: q('timer'), ping: q('ping'), fps: q('fps'), sync: q('sync'), syncBar: q('sync-bar'), state: q('player-state'), toast: q('toast'), inv: q('inventory'), invSlots: q('inv-slots'), invValue: q('inv-value') };
    Game.loadSprites();
    this.renderInventory([]);
    const names = (ids: string[]) => ids.map((id) => ITEMS[id]?.name ?? id).join(', ');
    this.offs.push(net.on('opened', (m) => this.toast(m.items.length ? `Contiene: ${names(m.items)}` : 'Está vacío')));
    this.offs.push(net.on('looted', (m) => this.toast(`Obtuviste: ${names(m.items)}${m.left ? ' · no cupo todo' : ''}`)));
    this.offs.push(net.on('notice', (m) => this.toast(m.message)));
    this.offs.push(net.on('extracted', (m) => this.toast(`Escapaste con ${m.value} ◆`)));
    this.offs.push(net.on('hit', (m) => this.floaters.push({ x: m.x, y: m.y, text: `-${m.dmg}`, t0: performance.now(), id: m.target })));
    this.offs.push(net.on('snap', (m) => this.onSnap(m)));
    this.offs.push(net.on('latency', (m) => { this.el.ping.textContent = `${Math.round(m.ms)} ms`; }));
    this.resize();
    addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() { cancelAnimationFrame(this.raf); removeEventListener('resize', this.resize); this.offs.forEach((o) => o()); window.clearTimeout(this.toastTimer); this.el.toast.hidden = true; }

  private static loadSprites() {
    if (Game.sprites) return;
    Game.sprites = {};
    for (const k of ['cerrado', 'abierto', 'vacio']) {
      const img = new Image();
      img.src = `/assets/chests/forja_${k}.png`;
      Game.sprites[k] = img;
    }
  }

  private toast(text: string) {
    const el = this.el.toast;
    el.textContent = text; el.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { el.hidden = true; }, 2600);
  }

  private renderInventory(ids: string[]) {
    this.inv = ids;
    const used = ids.reduce((n, id) => n + (ITEMS[id]?.size ?? 1), 0);
    const cells: HTMLElement[] = ids.map((id) => {
      const d = document.createElement('div');
      const it = ITEMS[id];
      d.className = `slot item${it?.size === 2 ? ' wide' : ''}`;
      d.style.background = it?.color ?? '#888';
      d.title = it?.name ?? id;
      return d;
    });
    for (let i = used; i < 10; i++) { const d = document.createElement('div'); d.className = 'slot'; cells.push(d); }
    this.el.invSlots.replaceChildren(...cells);
    const value = itemValue(ids);
    this.el.invValue.textContent = String(value);
    this.el.inv.dataset.count = String(ids.length);
    this.el.inv.dataset.value = String(value);
  }

  private resize = () => {
    const c = this.ctx.canvas;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth; this.H = innerHeight;
    c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr);
    // Zoom según la pantalla para que todos vean la misma porción del mundo.
    this.scale = viewScale(this.W, this.H);
  };

  /** Hora del servidor del estado que se está dibujando (para la compensación de lag). */
  private serverTimeAt(localT: number): number | undefined {
    const b = this.snapTimes;
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= localT && localT <= b[i].t) {
        const k = (localT - b[i - 1].t) / (b[i].t - b[i - 1].t || 1);
        return b[i - 1].st + (b[i].st - b[i - 1].st) * k;
      }
    }
    return b.length ? b[0].st : undefined;
  }

  private onSnap(m: any) {
    const now = performance.now();
    this.jitter = updateJitter(this.jitter, now, TICK_MS);
    this.targetDelay = adaptiveDelay(this.jitter.jitter, TICK_MS);
    this.snapTimes.push({ t: now, st: m.t });
    if (this.snapTimes.length > 40) this.snapTimes.shift();
    this.server = { x: m.you.x, y: m.you.y };
    Object.assign(this.me, { hp: m.you.hp, alive: m.you.alive, extracted: m.you.extracted });
    this.portals = m.portals; this.collapseR = m.collapseR;
    this.chests = m.chests ?? []; this.remains = m.remains ?? [];
    const inv: string[] = m.you.inv ?? [];
    if (inv.join() !== this.inv.join()) this.renderInventory(inv);
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
    // Ataque predicho: se respeta el mismo enfriamiento que el servidor para no mostrar golpes que él rechazaría.
    let attack = this.input.consumeAttack();
    if (attack && (t < this.cooldownUntil || !this.me.alive || this.me.extracted)) attack = false;
    if (attack) { this.swingAt = t; this.cooldownUntil = t + PLAYER.attackCooldownMs; }
    this.me.atk = t - this.swingAt < 200;
    // El búfer se ajusta poco a poco para que el cambio no se note.
    this.interpDelay += (this.targetDelay - this.interpDelay) * Math.min(1, dt * 2);
    const viewT = attack ? this.serverTimeAt(performance.now() - this.interpDelay) : undefined;
    const use = this.input.consumeUse();
    if (t - this.lastSend > 33 || attack || use) {
      this.lastSend = t;
      this.net.send({ type: 'input', seq: ++this.seq, mx: this.input.mx, my: this.input.my, ax: this.input.aimX, ay: this.input.aimY, attack, interact: this.input.interact, use, viewT });
    }
    this.cam.x += (this.me.x - this.cam.x) * Math.min(1, dt * 6);
    this.cam.y += (this.me.y - 20 - this.cam.y) * Math.min(1, dt * 6);
    const st = this.el.state;
    st.dataset.x = String(Math.round(this.me.x)); st.dataset.y = String(Math.round(this.me.y)); st.dataset.hp = String(this.me.hp);
    // Cofre disponible más cercano: lo usan las pruebas E2E para guiar al jugador.
    let nc: { x: number; y: number; s: string } | null = null, nd = Infinity;
    for (const c of this.chests) { if (c.s === 'empty') continue; const d = Math.hypot(c.x - this.me.x, c.y - this.me.y); if (d < nd) { nd = d; nc = c; } }
    st.dataset.chestX = nc ? String(Math.round(nc.x)) : ''; st.dataset.chestY = nc ? String(Math.round(nc.y)) : '';
    st.dataset.chestState = nc?.s ?? '';
    st.dataset.interp = String(Math.round(this.interpDelay));
    this.el.ping.title = `Búfer de suavizado: ${Math.round(this.interpDelay)} ms`;
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

    const renderT = performance.now() - this.interpDelay;
    // Todo lo que tiene altura se dibuja ordenado por su coordenada Y (profundidad).
    const list: { y: number; draw: () => void }[] = [];
    for (const r of this.remotes.values()) {
      const p = sampleBuffer(r.buf, renderT);
      if (p) list.push({ y: p.y, draw: () => this.drawActor({ ...p, name: r.name, hp: r.hp, ax: r.ax, ay: r.ay, atk: r.atk, me: false }) });
    }
    if (this.me.alive && !this.me.extracted) {
      const me = this.me;
      list.push({ y: me.y, draw: () => this.drawActor({ x: me.x, y: me.y, name: '', hp: me.hp, ax: me.ax, ay: me.ay, atk: me.atk, me: true }) });
    }
    for (const c of this.chests) list.push({ y: c.y, draw: () => this.drawChest(c) });
    for (const r of this.remains) list.push({ y: r.y, draw: () => this.drawRemains(r.x, r.y) });
    list.sort((a, b) => a.y - b.y);
    for (const o of list) o.draw();
    this.drawSwing(t);
    this.drawFloaters();
    this.drawPrompt(t);

    // Oscuridad con la visión del jugador y la luz de los portales.
    g.setTransform(1, 0, 0, 1, 0, 0);
    const sc = this.screenOf(this.me.x, this.me.y);
    const grad = g.createRadialGradient(sc.x * this.dpr, sc.y * this.dpr, 70 * this.scale * this.dpr, sc.x * this.dpr, sc.y * this.dpr, VISION_RADIUS * this.scale * this.dpr);
    grad.addColorStop(0, 'rgba(8,3,14,0)'); grad.addColorStop(1, 'rgba(8,3,14,.92)');
    g.fillStyle = grad; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    if (this.collapseR != null) {
      g.setTransform(s, 0, 0, s, (this.W / 2 - this.cam.x * this.scale) * this.dpr, (this.H / 2 - this.cam.y * this.scale) * this.dpr);
      const lp = this.portals[1];
      if (lp) { g.strokeStyle = 'rgba(255,60,120,.6)'; g.lineWidth = 8; g.beginPath(); g.arc(lp.x, lp.y, this.collapseR, 0, Math.PI * 2); g.stroke(); }
    }
  }

  private drawChest(c: { x: number; y: number; s: 'closed' | 'open' | 'empty' }) {
    const g = this.ctx;
    const img = Game.sprites?.[c.s === 'closed' ? 'cerrado' : c.s === 'open' ? 'abierto' : 'vacio'];
    g.fillStyle = 'rgba(10,4,12,.45)'; g.beginPath(); g.ellipse(c.x, c.y + 4, 34, 10, 0, 0, Math.PI * 2); g.fill();
    if (img?.complete && img.naturalWidth) {
      const w = 88, h = (img.naturalHeight / img.naturalWidth) * w;
      g.drawImage(img, c.x - w / 2, c.y + 10 - h, w, h);
    } else {
      g.fillStyle = '#6b3a2c'; g.strokeStyle = '#1d0c16'; g.lineWidth = 4;
      g.beginPath(); g.roundRect(c.x - 36, c.y - 50, 72, 56, 8); g.fill(); g.stroke();
    }
  }

  private drawRemains(x: number, y: number) {
    const g = this.ctx;
    g.fillStyle = 'rgba(10,4,12,.45)'; g.beginPath(); g.ellipse(x, y + 4, 20, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a3550'; g.strokeStyle = '#1d0c16'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(x - 18, y); g.quadraticCurveTo(x - 22, y - 26, x - 6, y - 30); g.lineTo(x + 6, y - 30);
    g.quadraticCurveTo(x + 22, y - 26, x + 18, y); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#c9a36a'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 8, y - 30); g.lineTo(x + 8, y - 34); g.stroke();
    g.fillStyle = '#f2c14e'; g.beginPath(); g.arc(x + 4, y - 14, 3, 0, Math.PI * 2); g.fill();
  }

  /** Indicación junto al cofre o los Restos más cercanos dentro del alcance. */
  private drawPrompt(t: number) {
    if (!this.me.alive || this.me.extracted) return;
    let best: { x: number; y: number; text: string; top: number } | null = null, bd = INTERACT_RANGE;
    for (const c of this.chests) {
      if (c.s === 'empty') continue;
      const d = Math.hypot(c.x - this.me.x, c.y - this.me.y);
      if (d <= bd) { bd = d; best = { x: c.x, y: c.y, top: 96, text: c.s === 'closed' ? 'abrir cofre' : 'tomar botín' }; }
    }
    for (const r of this.remains) {
      const d = Math.hypot(r.x - this.me.x, r.y - this.me.y);
      if (d <= bd) { bd = d; best = { x: r.x, y: r.y, top: 50, text: `saquear a ${r.owner}` }; }
    }
    if (!best) return;
    const g = this.ctx, label = `${this.input.touch ? 'Usar' : 'F'} · ${best.text}`;
    g.font = '500 15px "Alegreya Sans", sans-serif'; g.textAlign = 'center';
    const w = g.measureText(label).width + 20, y = best.y - best.top - 8 + Math.sin(t / 250) * 2;
    g.fillStyle = 'rgba(20,10,22,.9)'; g.beginPath(); g.roundRect(best.x - w / 2, y - 18, w, 26, 6); g.fill();
    g.fillStyle = '#ffc08a'; g.fillText(label, best.x, y);
  }

  /** Arco del golpe propio, dibujado al instante (predicción en el cliente). */
  private drawSwing(t: number) {
    const k = (t - this.swingAt) / 260;
    if (k < 0 || k > 1 || !this.me.alive) return;
    const g = this.ctx, a0 = Math.atan2(this.me.ay, this.me.ax);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(255,190,90,${(1 - k) * 0.9})`; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.arc(this.me.x, this.me.y - 22, PLAYER.attackRange * 0.75, a0 - 1.1, a0 - 1.1 + 2.2 * Math.min(1, k * 1.6)); g.stroke();
    g.restore();
  }

  /** Números de daño confirmados por el servidor, sobre la posición que vio el atacante. */
  private drawFloaters() {
    const g = this.ctx, now = performance.now();
    this.floaters = this.floaters.filter((f) => now - f.t0 < 800);
    g.font = '700 20px "Grenze Gotisch", Georgia, serif'; g.textAlign = 'center';
    for (const f of this.floaters) {
      const k = (now - f.t0) / 800;
      g.globalAlpha = 1 - k;
      g.fillStyle = '#1d0c16'; g.fillText(f.text, f.x + 1.5, f.y - 60 - k * 30 + 1.5);
      g.fillStyle = '#ffd36a'; g.fillText(f.text, f.x, f.y - 60 - k * 30);
    }
    g.globalAlpha = 1;
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
