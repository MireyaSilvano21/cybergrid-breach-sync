import {
  TILE, PLAYER, INTERP_DELAY_MS, TICK_MS, WALL, THIN, COVER, SEAL_VAULT, SEAL_HEART, DIAG_TL, DIAG_TR, DIAG_BL, DIAG_BR, GATE_DIR, isDiag, isGate, ITEMS, createJitter, updateJitter, adaptiveDelay, viewScale, VISION_RADIUS, INTERACT_RANGE, generateValidMap, sampleBuffer, stepMove, replayMoves, pendingAfterAck, type MoveCmd, createRng, itemValue,
  FOCOS, DEFAULT_BUILD, abilityFor, inBasicRange, GCD_MS, SWAP_MS, DASH_S, DASH_MUL, type Build, type Slot,
  animate, appearanceFor, BODIES, type Appearance, type AnimInput, type ActionKind, type View,
  type GridMap, type TimedPosition,
} from '@shared/index';
import type { Net } from './net';
import { Input, type CastRequest } from './input';
import { Sprites, isDeepWall, drawDiagWall, drawThinCracks, drawCover, drawBars, drawBrazier, buildFloorChunk, buildWall, wallKey, buildDecor, drawGrass, glowP, CHUNK, WALL_RISE, INK, type FloorChunk, type Decor } from './art';
import { drawCharacter } from './rig';

interface Remote { id: string; name: string; buf: TimedPosition[]; hp: number; ax: number; ay: number; atk: boolean; seen: number; lx: number; ly: number; walk: number; flash: number; tg?: string | null; foco?: string; slow?: boolean; swingAt: number; shotAt: number; castAt: number; mv: number; drawT: number }
interface Fx { kind: string; x: number; y: number; dx?: number; dy?: number; r?: number; x2?: number; y2?: number; t0: number; dur: number }
type ChestKind = 'forja' | 'sarcofago' | 'ornamentado' | 'relicario';
interface Light { x: number; y: number; r: number; c: string; fl?: number; a?: number }

/** Tamaño en el mundo y color de magia de cada tipo de cofre. */
const CHEST_ART: Record<ChestKind, { size: number; rgb: string }> = {
  forja: { size: 104, rgb: '255,140,50' },
  sarcofago: { size: 124, rgb: '110,255,170' },
  ornamentado: { size: 112, rgb: '190,110,255' },
  relicario: { size: 124, rgb: '255,90,216' },
};
const CHEST_FILE = { closed: 'cerrado', open: 'abierto', empty: 'vacio' } as const;
const CHUNK_PX = CHUNK * TILE;
/** Color de la faja: el propio en ámbar y los demás en violeta (luego será el color del equipo). */
const TEAM_ME = '#ffb347', TEAM_OTHER = '#9a6bff';
/** Duración de cada animación de acción (ms). */
const ACT_MS: Record<ActionKind, number> = { melee: 420, shoot: 360, cast: 600, hit: 340 };
const DIE_MS = 900;
/** Estado de animación de un personaje en este cuadro. */
interface ActorDraw { x: number; y: number; ax: number; ay: number; id: string; me: boolean; walk: number; move: number; foco?: string; swingAt: number; shotAt: number; castAt: number; hitAt: number; dieAt?: number }
const DIAGS = { TL: DIAG_TL, TR: DIAG_TR, BL: DIAG_BL, BR: DIAG_BR };
/** Arte de escenario de Astra: tamaño en el mundo (lienzo cuadrado, base al 94 %). */
const PORTAL_SIZE = 300, MONO_SIZE = 200;
/** Centro del anillo del portal respecto a su base, para luces y brillo. */
const PORTAL_RING = { dy: -0.46 * PORTAL_SIZE, r: 0.16 * PORTAL_SIZE };
const SCENE_FILES = ['portal_apagado', 'portal_abierto', 'portal_colapsando', 'monolito_dormido', 'monolito_ritual', 'monolito_completado', 'pilar_dormido', 'pilar_despierto', 'pilar_destruido'];

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
  // --- Arte "Forja Apagada" ---
  private static art: Sprites | null = null;
  private static chestImg: Record<string, HTMLImageElement> = {};
  private static sceneImg: Record<string, HTMLImageElement> = {};
  private chunks = new Map<number, FloorChunk>();
  private walls = new Map<number, HTMLCanvasElement>();
  private wallKeys: Int16Array;
  private decor: Decor[];
  private dark = document.createElement('canvas');
  private embers: { x: number; y: number; vx: number; vy: number; l: number; c: string }[] = [];
  private sparks: { x: number; y: number; vx: number; vy: number; l: number }[] = [];
  private shake = 0; private hurtAt = -1e9; private walk = 0; private moveAmt = 0;
  /** Animaciones del personaje propio: disparo, último lanzamiento y muerte. */
  private shotAt = -1e9; private lastCastAt = -1e9; private deadAt = -1e9;
  private looks = new Map<string, Appearance>();
  private input: Input;
  private me = { x: 0, y: 0, hp: 100, alive: true, extracted: false, ax: 0, ay: 1, atk: false };
  /** Posición predicha exacta (misma física y mismos comandos que el servidor). */
  private pred = { x: 0, y: 0 };
  /** Diferencia visual que se desvanece cuando el servidor corrige (no hay saltos). */
  private err = { x: 0, y: 0 };
  /** Comandos enviados que el servidor todavía no confirma, y el que se está juntando. */
  private pending: MoveCmd[] = [];
  private out: { mx: number; my: number; dt: number; sp: number } | null = null;
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
  // --- Combate estilo Albion ---
  private myId = '';
  private build: Build = DEFAULT_BUILD;
  private foco: 0 | 1 = 0;
  private target: string | null = null;
  private targetSent: string | null = null;
  private targetSetAt = 0;
  /** Recargas predichas (hora local en ms) por habilidad, recarga global y cambio de Foco. */
  private cdById: Record<string, number> = {};
  private castAt: Record<string, number> = {};
  private gcdUntil = 0; private swapUntil = 0; private swapAt = -1e9;
  private slowMul = 1;
  /** Embestida predicha: segundos que quedan y dirección. */
  private dashLeft = 0; private dashDir = { x: 0, y: 0 };
  private pendingCast: { slot: Slot; x: number; y: number; target?: string } | null = null;
  private pendingSwap = false;
  private lastAttackAt = 0;
  private projectiles = new Map<number, { x: number; y: number; vx: number; vy: number; t: number }>();
  private fxs: Fx[] = [];
  private abEls: HTMLElement[] = [];
  private floaters: { x: number; y: number; text: string; t0: number; id?: string }[] = [];
  private portals: { x: number; y: number; open: boolean }[] = [];
  private chests: { id: string; k?: ChestKind; x: number; y: number; s: 'closed' | 'open' | 'empty' }[] = [];
  private remains: { id: string; x: number; y: number; owner: string }[] = [];
  private inv: string[] = [];
  private toastTimer: number | undefined;
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

  constructor(private root: HTMLElement, private net: Net, start: { seed: number; players: number; x: number; y: number; you?: string }) {
    const canvas = root.querySelector('canvas')!;
    this.ctx = canvas.getContext('2d')!;
    this.map = generateValidMap(start.seed, start.players);
    this.wallKeys = new Int16Array(this.map.width * this.map.height).fill(-1);
    // Solo se dibujan los muros que tocan algo recorrible; el resto es oscuridad (como en un plano de mazmorra).
    for (let y = 0; y < this.map.height; y++) for (let x = 0; x < this.map.width; x++) {
      const t = this.map.tiles[y * this.map.width + x];
      if ((t === WALL || t === THIN) && !isDeepWall(this.map, x, y)) this.wallKeys[y * this.map.width + x] = wallKey(this.map, x, y);
    }
    this.decor = buildDecor(this.map);
    this.input = new Input(root);
    this.me.x = this.pred.x = this.cam.x = start.x;
    this.me.y = this.pred.y = this.cam.y = start.y;
    const q = (id: string) => root.querySelector<HTMLElement>('#' + id)!;
    this.el = { hpBar: q('hp-bar'), hpText: q('hp-text'), phase: q('phase'), timer: q('timer'), ping: q('ping'), fps: q('fps'), sync: q('sync'), syncBar: q('sync-bar'), state: q('player-state'), toast: q('toast'), inv: q('inventory'), invSlots: q('inv-slots'), invValue: q('inv-value') };
    Game.loadSprites();
    this.renderInventory([]);
    const names = (ids: string[]) => ids.map((id) => ITEMS[id]?.name ?? id).join(', ');
    this.offs.push(net.on('opened', (m) => this.toast(m.items.length ? `Contiene: ${names(m.items)}` : 'Está vacío')));
    this.offs.push(net.on('looted', (m) => this.toast(`Obtuviste: ${names(m.items)}${m.left ? ' · no cupo todo' : ''}`)));
    this.offs.push(net.on('notice', (m) => this.toast(m.message)));
    this.offs.push(net.on('extracted', (m) => this.toast(`Escapaste con ${m.value} ◆`)));
    this.offs.push(net.on('hit', (m) => {
      const now = performance.now();
      this.floaters.push({ x: m.x, y: m.y, text: `-${m.dmg}`, t0: now, id: m.target });
      const r = this.remotes.get(m.target); if (r) r.flash = now;
      const a0 = Math.atan2(m.y - this.me.y, m.x - this.me.x);
      for (let i = 0; i < 14; i++) { const a = a0 + (Math.random() - 0.5) * 1.8, v = 180 + Math.random() * 300; this.sparks.push({ x: m.x, y: m.y - 30, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 1 }); }
      this.shake = Math.max(this.shake, 6);
    }));
    this.offs.push(net.on('snap', (m) => this.onSnap(m)));
    this.myId = start.you ?? '';
    this.abEls = [...root.querySelectorAll<HTMLElement>('[data-slot]')];
    // Efectos de habilidades de otros jugadores (las propias ya se dibujaron al lanzarlas).
    this.offs.push(net.on('fx', (m) => {
      if (m.by === this.myId) return;
      this.addFx(m.kind, m.x, m.y, { dx: m.dx, dy: m.dy, r: m.r });
      const r = m.by ? this.remotes.get(m.by) : undefined;
      if (r && m.kind !== 'embestida') { if (m.kind === 'barrido') r.swingAt = performance.now(); else r.castAt = performance.now(); }
    }));
    this.offs.push(net.on('latency', (m) => { this.el.ping.textContent = `${Math.round(m.ms)} ms`; }));
    this.resize();
    addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() { cancelAnimationFrame(this.raf); removeEventListener('resize', this.resize); this.offs.forEach((o) => o()); window.clearTimeout(this.toastTimer); this.el.toast.hidden = true; }

  private static loadSprites() {
    if (Game.art) return;
    Game.art = new Sprites();
    for (const k of Object.keys(CHEST_ART)) for (const s of Object.values(CHEST_FILE)) {
      const img = new Image(); img.src = `/assets/chests/v2/${k}_${s}.webp`; Game.chestImg[`${k}_${s}`] = img;
    }
    for (const f of SCENE_FILES) { const img = new Image(); img.src = `/assets/escenario/${f}.webp`; Game.sceneImg[f] = img; }
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
    // La capa de oscuridad va a media resolución: los degradados no lo notan y el móvil lo agradece.
    this.dark.width = Math.ceil(c.width / 2); this.dark.height = Math.ceil(c.height / 2);
    // Zoom según la pantalla para que todos vean la misma porción del mundo.
    this.scale = viewScale(this.W, this.H);
  };

  private sendInput(t: number, use: boolean) {
    const c = this.out ?? { mx: 0, my: 0, dt: 0, sp: 1 };
    this.out = null;
    const seq = ++this.seq, dt = Math.min(0.25, c.dt);
    if (dt > 0 && (c.mx !== 0 || c.my !== 0)) this.pending.push({ seq, mx: c.mx, my: c.my, dt, sp: c.sp });
    if (this.pending.length > 120) this.pending.shift();
    this.lastSend = t;
    const msg: Record<string, unknown> = {
      type: 'input', seq, mx: c.mx, my: c.my, dt, sp: c.sp, ax: this.input.aimX, ay: this.input.aimY, attack: false,
      interact: this.input.interact, use, swap: this.pendingSwap,
      // Hora del servidor que se está dibujando: el básico automático se revisa contra lo que veías.
      viewT: this.serverTimeAt(performance.now() - this.interpDelay),
    };
    if (this.target !== this.targetSent) { msg.target = this.target; this.targetSent = this.target; }
    if (this.pendingCast) msg.cast = this.pendingCast;
    this.pendingCast = null; this.pendingSwap = false;
    this.net.send(msg);
  }

  /**
   * Reconciliación: se parte de la posición confirmada por el servidor y se reaplican los
   * comandos que aún no procesa. Si coincide con lo predicho, no se mueve nada.
   */
  private reconcile(you: { x: number; y: number; ack?: number; ackRem?: number; alive: boolean }) {
    if (you.ack == null) { this.pred = { x: you.x, y: you.y }; return; }
    this.pending = pendingAfterAck(this.pending, you.ack, you.ackRem ?? 0);
    const extra = this.out && this.out.dt > 0 ? [{ seq: this.seq + 1, ...this.out }] : [];
    const p = replayMoves(this.map, { x: you.x, y: you.y }, [...this.pending, ...extra]);
    const cx = p.x - this.pred.x, cy = p.y - this.pred.y;
    if (Math.hypot(cx, cy) > 200 || !you.alive) { this.err = { x: 0, y: 0 }; }
    else if (Math.abs(cx) + Math.abs(cy) > 0.01) { this.err.x += cx; this.err.y += cy; }
    this.pred = p;
  }

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
    this.reconcile(m.you);
    if (m.you.hp < this.me.hp && m.you.alive) { this.hurtAt = now; this.shake = Math.max(this.shake, 10); }
    if (this.me.alive && !m.you.alive) this.deadAt = now;
    Object.assign(this.me, { hp: m.you.hp, alive: m.you.alive, extracted: m.you.extracted });
    this.portals = m.portals; this.collapseR = m.collapseR;
    // Mismos sellos que el servidor, según la fase (la física predicha debe coincidir).
    const later = ['primera-llamada', 'segunda-llamada', 'cierre-portal-1', 'desnombrar', 'fin'];
    this.map.sealsOpen.vault = later.includes(m.phase);
    this.map.sealsOpen.heart = later.indexOf(m.phase) >= 1;
    this.chests = m.chests ?? []; this.remains = m.remains ?? [];
    const inv: string[] = m.you.inv ?? [];
    if (inv.join() !== this.inv.join()) this.renderInventory(inv);
    for (const o of m.others) {
      let r = this.remotes.get(o.id);
      if (!r) { r = { id: o.id, name: o.name, buf: [], hp: o.hp, ax: o.ax, ay: o.ay, atk: o.atk, seen: now, lx: o.x, ly: o.y, walk: 0, flash: -1e9, swingAt: -1e9, shotAt: -1e9, castAt: -1e9, mv: 0, drawT: now }; this.remotes.set(o.id, r); }
      r.buf.push({ x: o.x, y: o.y, t: now }); if (r.buf.length > 20) r.buf.shift();
      if (o.atk && !r.atk) this.remoteAttack(r, o);
      Object.assign(r, { hp: o.hp, ax: o.ax, ay: o.ay, atk: o.atk, seen: now, tg: o.tg, foco: o.foco, slow: o.slow });
    }
    for (const [id, r] of this.remotes) if (now - r.seen > 500) this.remotes.delete(id);
    this.syncCombat(m, now);
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
    // En táctil se apunta hacia el objetivo fijado (si hay).
    const tp = this.target ? this.remotePos(this.target) : null;
    const auto = this.input.touch && tp ? (() => { const d = Math.hypot(tp.x - this.me.x, tp.y - this.me.y) || 1; return { x: (tp.x - this.me.x) / d, y: (tp.y - this.me.y) / d }; })() : null;
    this.input.update(this.screenOf(this.me.x, this.me.y), auto);
    const active = this.me.alive && !this.me.extracted;
    this.handleCombatInput(active);
    // Dirección cuantizada a centésimas: cliente y servidor calculan exactamente lo mismo.
    const q = (v: number) => Math.round(v * 100) / 100;
    let mx = active ? q(this.input.mx) : 0, my = active ? q(this.input.my) : 0, sp = this.slowMul, mdt = dt;
    // Embestida predicha: el mismo tiempo exacto que autoriza el servidor, a su velocidad.
    if (this.dashLeft > 0 && active) { mx = q(this.dashDir.x); my = q(this.dashDir.y); sp = DASH_MUL; mdt = Math.min(dt, this.dashLeft); this.dashLeft -= mdt; }
    if (active) this.pred = stepMove(this.map, this.pred, mx, my, mdt, sp);
    // La corrección del servidor se reparte en unos cuadros en lugar de aplicarse de golpe.
    const ek = Math.min(1, dt * 10);
    this.err.x -= this.err.x * ek; this.err.y -= this.err.y * ek;
    this.me.x = this.pred.x - this.err.x; this.me.y = this.pred.y - this.err.y;
    this.me.ax = this.input.aimX; this.me.ay = this.input.aimY;
    const moving = Math.hypot(this.input.mx, this.input.my) > 0.1;
    this.moveAmt += ((moving && active ? 1 : 0) - this.moveAmt) * Math.min(1, dt * 10);
    this.walk += dt * 9 * this.moveAmt;
    this.updateEffects(dt);
    this.me.atk = performance.now() - this.swingAt < 200;
    // El búfer se ajusta poco a poco para que el cambio no se note.
    // Sube rápido si la red empeora y baja despacio: así los demás no cambian de ritmo a cada rato.
    this.interpDelay += (this.targetDelay - this.interpDelay) * Math.min(1, dt * (this.targetDelay > this.interpDelay ? 2 : 0.4));
    const use = this.input.consumeUse();
    // Cada tramo con la misma dirección y velocidad se junta en un comando; al cambiar, se envía el anterior.
    if (this.out && (this.out.mx !== mx || this.out.my !== my || this.out.sp !== sp)) this.sendInput(t, false);
    if (!this.out) this.out = { mx, my, dt: 0, sp };
    if (active) this.out.dt += mdt;
    const idle = mx === 0 && my === 0;
    const urgent = use || this.pendingCast || this.pendingSwap || this.target !== this.targetSent;
    if (urgent || t - this.lastSend >= (idle ? 50 : 15) || this.out.dt >= 0.1) this.sendInput(t, use);
    this.updateAbilityHud();
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

  /** Trozo de piso con caché LRU: solo se pintan los que se acercan a la cámara. */
  private chunk(cx: number, cy: number): FloorChunk {
    const key = cy * 1000 + cx;
    let c = this.chunks.get(key);
    if (c) { this.chunks.delete(key); this.chunks.set(key, c); return c; }
    c = buildFloorChunk(this.map, cx, cy);
    this.chunks.set(key, c);
    if (this.chunks.size > 36) this.chunks.delete(this.chunks.keys().next().value!);
    return c;
  }

  private wallImg(key: number): HTMLCanvasElement {
    let w = this.walls.get(key);
    if (!w) { w = buildWall(key); this.walls.set(key, w); }
    return w;
  }

  /** Rectángulo del mundo visible, con margen. */
  private viewRect(margin = 0) {
    const hw = this.W / 2 / this.scale + margin, hh = this.H / 2 / this.scale + margin;
    return { x0: this.cam.x - hw, x1: this.cam.x + hw, y0: this.cam.y - hh, y1: this.cam.y + hh };
  }

  private updateEffects(dt: number) {
    const v = this.viewRect(80);
    // Se adelanta un trozo de piso por cuadro alrededor de la vista para no dar tirones al caminar.
    const m = CHUNK_PX;
    outer: for (let cy = Math.floor((v.y0 - m) / m); cy <= Math.floor((v.y1 + m) / m); cy++) for (let cx = Math.floor((v.x0 - m) / m); cx <= Math.floor((v.x1 + m) / m); cx++) {
      if (cx < 0 || cy < 0 || cx * m >= this.map.width * TILE || cy * m >= this.map.height * TILE) continue;
      if (!this.chunks.has(cy * 1000 + cx)) { this.chunk(cx, cy); break outer; }
    }
    for (const d of this.decor) {
      if (d.kind !== 'sconce' || d.x < v.x0 || d.x > v.x1 || d.y < v.y0 || d.y > v.y1 + 60) continue;
      if (Math.random() < dt * 5 && this.embers.length < 140) this.embers.push({ x: d.x + (Math.random() - 0.5) * 12, y: d.y - 50, vx: (Math.random() - 0.5) * 18, vy: -35 - Math.random() * 45, l: 1, c: '255,150,60' });
    }
    for (const p of this.portals) if (p.open && Math.random() < dt * 8 && this.embers.length < 140) {
      const a = Math.random() * 6.283; this.embers.push({ x: p.x + Math.cos(a) * 60, y: p.y + Math.sin(a) * 30, vx: 0, vy: -30 - Math.random() * 30, l: 1, c: '200,160,255' });
    }
    for (let i = this.embers.length - 1; i >= 0; i--) { const p = this.embers[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.l -= dt * 0.7; if (p.l <= 0) this.embers.splice(i, 1); }
    for (let i = this.sparks.length - 1; i >= 0; i--) { const p = this.sparks[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; p.l -= dt * 2.4; if (p.l <= 0) this.sparks.splice(i, 1); }
    this.shake *= Math.pow(0.002, dt);
  }

  private worldTransform(g: CanvasRenderingContext2D, k = 1) {
    const s = this.scale * this.dpr * k, sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    g.setTransform(s, 0, 0, s, (this.W / 2 - this.cam.x * this.scale + sx) * this.dpr * k, (this.H / 2 - this.cam.y * this.scale + sy) * this.dpr * k);
  }

  private draw(t: number) {
    const g = this.ctx, now = performance.now(), sec = now / 1000, v = this.viewRect(40), T = TILE, map = this.map;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0a0510'; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    this.worldTransform(g);

    // 1. Piso por trozos.
    const cracks: [number, number][][] = [];
    for (let cy = Math.max(0, Math.floor(v.y0 / CHUNK_PX)); cy <= Math.floor(v.y1 / CHUNK_PX) && cy * CHUNK_PX < map.height * T; cy++)
      for (let cx = Math.max(0, Math.floor(v.x0 / CHUNK_PX)); cx <= Math.floor(v.x1 / CHUNK_PX) && cx * CHUNK_PX < map.width * T; cx++) {
        const c = this.chunk(cx, cy);
        g.drawImage(c.canvas, cx * CHUNK_PX, cy * CHUNK_PX, CHUNK_PX, CHUNK_PX);
        cracks.push(...c.cracks);
      }

    // 2. Todo lo que tiene altura, ordenado por su base (profundidad en tres cuartos).
    const list: { y: number; draw: () => void }[] = [];
    const tx0 = Math.max(0, Math.floor(v.x0 / T)), tx1 = Math.min(map.width - 1, Math.floor(v.x1 / T));
    const ty0 = Math.max(0, Math.floor(v.y0 / T)), ty1 = Math.min(map.height - 1, Math.floor((v.y1 + WALL_RISE) / T));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = this.wallKeys[ty * map.width + tx], tile = map.tiles[ty * map.width + tx];
      if (key >= 0) list.push({ y: ty * T + T, draw: () => { g.drawImage(this.wallImg(key), tx * T, ty * T - WALL_RISE, T, T + WALL_RISE); if (tile === THIN) drawThinCracks(g, tx, ty); } });
      else if (isDiag(tile)) list.push({ y: ty * T + T, draw: () => drawDiagWall(g, tile, tx, ty, DIAGS) });
      else if (tile === COVER) list.push({ y: ty * T + T - 8, draw: () => drawCover(g, tx, ty, (tx * 7 + ty * 13) & 7) });
      else if (tile === SEAL_VAULT && !map.sealsOpen.vault || tile === SEAL_HEART && !map.sealsOpen.heart) list.push({ y: ty * T + T - 4, draw: () => drawBars(g, tx, ty, true) });
      else if (isGate(tile)) list.push({ y: ty * T + T - 4, draw: () => drawBars(g, tx, ty, false, GATE_DIR[tile]) });
    }
    // Objetos de las plantillas: hitos (braseros grandes), braseros pequeños y pilares Desnombrados.
    for (const pr of map.props) {
      if (pr.x < v.x0 - 120 || pr.x > v.x1 + 120 || pr.y < v.y0 - 60 || pr.y > v.y1 + 220) continue;
      if (pr.kind === 'hito') list.push({ y: pr.y + 40, draw: () => { this.blob(pr.x, pr.y + 40, 40); drawBrazier(g, pr.x, pr.y + 40, true, art.img.flame, sec, pr.x); } });
      else if (pr.kind === 'brasero') list.push({ y: pr.y + 22, draw: () => { this.blob(pr.x, pr.y + 22, 18); drawBrazier(g, pr.x, pr.y + 22, false, art.img.flame, sec, pr.y); } });
      else if (pr.kind === 'pilar') list.push({ y: pr.y + 30, draw: () => { this.blob(pr.x, pr.y + 30, 34); this.drawScene('pilar_dormido', pr.x, pr.y + 30, 150); } });
    }
    const pushers = [{ x: this.me.x, y: this.me.y }];
    const remotesNow: { r: Remote; x: number; y: number }[] = [];
    for (const r of this.remotes.values()) {
      const p = sampleBuffer(r.buf, now - this.interpDelay); if (!p) continue;
      const moved = Math.hypot(p.x - r.lx, p.y - r.ly), fdt = Math.min(0.05, (now - r.drawT) / 1000); r.drawT = now;
      r.mv += ((moved > 0.4 ? 1 : 0) - r.mv) * Math.min(1, fdt * 10); r.walk += fdt * 9 * r.mv; r.lx = p.x; r.ly = p.y;
      remotesNow.push({ r, x: p.x, y: p.y }); pushers.push(p);
    }
    const art = Game.art!;
    for (const d of this.decor) {
      if (d.x < v.x0 || d.x > v.x1 || d.y < v.y0 || d.y > v.y1 + 60) continue;
      if (d.kind === 'skull') list.push({ y: d.y - 20, draw: () => { const i = art.img.skull; if (i) g.drawImage(i, d.x - 12, d.y - 10, 24, 20); } });
      else if (d.kind === 'grass') list.push({ y: d.y, draw: () => drawGrass(g, d, sec, pushers) });
      else list.push({ y: d.y + 0.5, draw: () => this.drawSconce(d, sec) });
    }
    for (const mo of map.monoliths) if (mo.x > v.x0 - 100 && mo.x < v.x1 + 100 && mo.y > v.y0 && mo.y < v.y1 + 200) list.push({ y: mo.y + 40, draw: () => { this.blob(mo.x, mo.y + 40, 48); this.drawScene('monolito_dormido', mo.x, mo.y + 40, MONO_SIZE); } });
    for (const p of this.portals) if (p.x > v.x0 - 160 && p.x < v.x1 + 160 && p.y > v.y0 && p.y < v.y1 + 320) list.push({ y: p.y - 6, draw: () => this.drawScene(`portal_${this.portalState(p)}`, p.x, p.y - 6, PORTAL_SIZE) });
    for (const { r, x, y } of remotesNow) list.push({ y, draw: () => this.drawActor({ x, y, ax: r.ax, ay: r.ay, id: r.id, me: false, walk: r.walk, move: r.mv, foco: r.foco, swingAt: r.swingAt, shotAt: r.shotAt, castAt: r.castAt, hitAt: r.flash }, now) });
    const me = this.me, dying = !me.alive && now - this.deadAt < DIE_MS + 600;
    if ((me.alive || dying) && !me.extracted) {
      list.push({ y: me.y, draw: () => this.drawActor({ x: me.x, y: me.y, ax: me.ax, ay: me.ay, id: this.myId, me: true, walk: this.walk, move: this.moveAmt, foco: this.build.focos[this.foco], swingAt: this.swingAt, shotAt: this.shotAt, castAt: this.lastCastAt, hitAt: this.hurtAt, dieAt: me.alive ? undefined : this.deadAt }, now) });
    }
    for (const c of this.chests) list.push({ y: c.y, draw: () => this.drawChest(c) });
    for (const r of this.remains) list.push({ y: r.y, draw: () => this.drawRemains(r.x, r.y) });
    list.sort((a, b) => a.y - b.y);
    g.lineCap = 'round'; g.lineJoin = 'round';
    this.drawGroundMarks(remotesNow, sec);
    for (const o of list) o.draw();
    this.drawSwing(t);

    // 3. Luz: se recorta la oscuridad con cada fuente y luego se tiñe con su color.
    const lights: Light[] = [];
    if (this.me.alive && !this.me.extracted) lights.push({ x: this.me.x, y: this.me.y - 24, r: VISION_RADIUS, c: '255,190,110' });
    for (const d of this.decor) if (d.kind === 'sconce' && d.x > v.x0 - 220 && d.x < v.x1 + 220 && d.y > v.y0 - 220 && d.y < v.y1 + 220) lights.push({ x: d.x, y: d.y - 44, r: 220, c: '255,120,40', fl: d.ph });
    for (const p of this.portals) {
      const st = this.portalState(p);
      lights.push({ x: p.x, y: p.y - 6 + PORTAL_RING.dy, r: st === 'apagado' ? 130 : 300, c: st === 'colapsando' ? '255,50,90' : st === 'abierto' ? '160,100,255' : '90,70,140', a: 0.22 });
    }
    for (const mo of map.monoliths) lights.push({ x: mo.x, y: mo.y - 50, r: 140, c: '190,110,220', a: 0.15 });
    for (const pr of map.props) if (pr.kind === 'hito' || pr.kind === 'brasero') lights.push({ x: pr.x, y: pr.y - 20, r: pr.kind === 'hito' ? 260 : 170, c: '255,130,40', fl: pr.x * 0.01 });
    for (const c of this.chests) if (c.s !== 'empty') lights.push({ x: c.x, y: c.y - 30, r: c.s === 'open' ? 150 : 100, c: CHEST_ART[c.k ?? 'forja'].rgb, a: 0.14 });
    const vis = lights.filter((L) => L.x + L.r > v.x0 && L.x - L.r < v.x1 && L.y + L.r > v.y0 && L.y - L.r < v.y1);
    const d = this.dark.getContext('2d')!;
    d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = 'source-over';
    d.fillStyle = 'rgba(9,4,16,.94)'; d.fillRect(0, 0, this.dark.width, this.dark.height);
    this.worldTransform(d, 0.5); d.globalCompositeOperation = 'destination-out';
    for (const L of vis) {
      const r = L.r * (L.fl != null ? 1 + Math.sin(sec * 9 + L.fl) * 0.04 + Math.sin(sec * 17 + L.fl) * 0.03 : 1);
      const gr = d.createRadialGradient(L.x, L.y, 0, L.x, L.y, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.5, 'rgba(0,0,0,.8)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = gr; d.beginPath(); d.arc(L.x, L.y, r, 0, 6.283); d.fill();
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.dark, 0, 0, g.canvas.width, g.canvas.height);
    this.worldTransform(g); g.globalCompositeOperation = 'lighter';
    for (const L of vis) {
      if (L.r >= VISION_RADIUS) continue; // la visión propia no tiñe
      const r = L.r * 0.85, gr = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, r);
      gr.addColorStop(0, `rgba(${L.c},${L.a ?? 0.3})`); gr.addColorStop(1, `rgba(${L.c},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(L.x, L.y, r, 0, 6.283); g.fill();
    }

    // 4. Brillos mágicos (no los apaga la oscuridad).
    g.globalAlpha = 0.55 + 0.25 * Math.sin(sec * 1.6);
    for (const c of cracks) glowP(g, c, '255,130,40', 0.8);
    // Portal abierto: el remolino del arte gira con dos trazos de luz y late suavemente.
    for (const p of this.portals) {
      const st = this.portalState(p); if (st === 'apagado') continue;
      const cx = p.x, cy = p.y - 6 + PORTAL_RING.dy, R = PORTAL_RING.r, rgb = st === 'colapsando' ? '255,90,120' : '200,160,255';
      g.globalAlpha = 0.35 + 0.25 * Math.sin(sec * 2.6);
      g.drawImage(st === 'colapsando' ? art.dot.magenta : art.dot.violet, cx - R * 1.6, cy - R * 1.6, R * 3.2, R * 3.2);
      g.globalAlpha = 0.55;
      for (let k = 0; k < 2; k++) {
        g.strokeStyle = `rgba(${rgb},.8)`; g.lineWidth = 3; g.beginPath();
        for (let s = 0; s <= 1.0001; s += 0.05) { const an = -sec * (st === 'colapsando' ? 3.2 : 1.6) + k * Math.PI + s * 4, rd = (1 - s) * R * 0.85 + 3, x = cx + Math.cos(an) * rd, y = cy + Math.sin(an) * rd; if (s) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    for (const p of this.embers) { g.fillStyle = `rgba(${p.c},${p.l})`; g.beginPath(); g.arc(p.x, p.y, 2.2 * p.l + 0.6, 0, 6.283); g.fill(); }
    for (const p of this.sparks) { g.strokeStyle = `rgba(255,${(190 + p.l * 60) | 0},120,${p.l})`; g.lineWidth = 3 * p.l + 1; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); g.stroke(); }
    this.drawCombatFx(now, art);
    g.globalCompositeOperation = 'source-over';
    this.drawAimGuide();

    // 5. Interfaz dentro del mundo: nombres, daño, indicaciones y el colapso final.
    for (const { r, x, y } of remotesNow) {
      g.fillStyle = 'rgba(20,10,22,.8)'; g.fillRect(x - 23, y - 79, 46, 8);
      g.fillStyle = '#ff6b6b'; g.fillRect(x - 22, y - 78, 44 * (r.hp / 100), 6);
      g.font = '500 13px "Alegreya Sans", sans-serif'; g.textAlign = 'center';
      g.fillStyle = INK; g.fillText(r.name, x + 1, y - 84); g.fillStyle = r.id === this.target ? '#ffd36a' : '#e2c8ff'; g.fillText(r.name, x, y - 85);
    }
    this.drawFloaters();
    this.drawPrompt(t);
    if (this.collapseR != null) {
      const lp = this.portals[1];
      if (lp) { g.strokeStyle = 'rgba(255,60,120,.6)'; g.lineWidth = 8; g.beginPath(); g.arc(lp.x, lp.y, this.collapseR, 0, Math.PI * 2); g.stroke(); }
    }

    // 6. Tono violeta, viñeta y destello rojo al recibir daño.
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'soft-light'; g.fillStyle = 'rgba(120,52,160,.18)'; g.fillRect(0, 0, this.W, this.H);
    g.globalCompositeOperation = 'source-over';
    const vg = g.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.3, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
    vg.addColorStop(0, 'rgba(8,3,12,0)'); vg.addColorStop(1, 'rgba(8,3,12,.8)'); g.fillStyle = vg; g.fillRect(0, 0, this.W, this.H);
    const hk = 1 - (now - this.hurtAt) / 400;
    if (hk > 0) {
      const hg = g.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.25, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.7);
      hg.addColorStop(0, 'rgba(200,20,40,0)'); hg.addColorStop(1, `rgba(200,20,40,${0.45 * hk})`); g.fillStyle = hg; g.fillRect(0, 0, this.W, this.H);
    }
    this.worldTransform(g);
  }

  /** Estado visual del portal: el último portal se ve colapsando durante El Desnombrar. */
  private portalState(p: { x: number; y: number; open: boolean }): 'apagado' | 'abierto' | 'colapsando' {
    if (!p.open) return 'apagado';
    return this.collapseR != null && p === this.portals[1] ? 'colapsando' : 'abierto';
  }

  /** Dibuja un sprite de escenario normalizado (base al 94 % y centrada). */
  private drawScene(key: string, x: number, y: number, size: number) {
    const img = Game.sceneImg[key];
    if (img?.complete && img.naturalWidth) this.ctx.drawImage(img, x - size / 2, y - size * 0.94, size, size);
  }

  // ------------------------------------------------------------------------------
  // Combate estilo Albion (cliente): fijar objetivo, lanzar al cursor y predecir recargas.
  // ------------------------------------------------------------------------------

  private worldOf(sx: number, sy: number) {
    return { x: (sx - this.W / 2) / this.scale + this.cam.x, y: (sy - this.H / 2) / this.scale + this.cam.y };
  }

  /** Posición dibujada de otro jugador (la interpolada, la misma que ve el jugador). */
  private remotePos(id: string) {
    const r = this.remotes.get(id); if (!r) return null;
    return sampleBuffer(r.buf, performance.now() - this.interpDelay);
  }

  private nearestRemote(maxDist: number) {
    let best: Remote | null = null, bd = maxDist;
    for (const r of this.remotes.values()) {
      const p = this.remotePos(r.id); if (!p) continue;
      const d = Math.hypot(p.x - this.me.x, p.y - this.me.y);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  private setTarget(id: string | null) {
    if (id === this.target) return;
    this.target = id; this.targetSetAt = performance.now();
  }

  private handleCombatInput(active: boolean) {
    const ev = this.input.consumeEvents(), now = performance.now();
    if (ev.click) {
      // Clic sobre un enemigo lo fija; clic en el suelo lo suelta.
      const w = this.worldOf(ev.click.x, ev.click.y);
      let hit: string | null = null, bd = 48;
      for (const r of this.remotes.values()) {
        const p = this.remotePos(r.id); if (!p) continue;
        const d = Math.hypot(p.x - w.x, p.y - 26 - w.y);
        if (d < bd) { bd = d; hit = r.id; }
      }
      this.setTarget(hit);
    }
    if (ev.tab) this.setTarget(this.nearestRemote(10 * TILE)?.id ?? null);
    if (ev.clear) this.setTarget(null);
    if (this.input.consumeAttack()) this.setTarget(this.nearestRemote(9 * TILE)?.id ?? this.target);
    if (!active) return;
    if (ev.swap && now >= this.swapUntil) {
      this.foco = this.foco === 0 ? 1 : 0; this.swapUntil = now + SWAP_MS; this.swapAt = now; this.pendingSwap = true;
    }
    for (const c of ev.casts) this.tryCast(c, now);
  }

  /** Lanzamiento al instante: se predice la recarga y el efecto; el servidor confirma. */
  private tryCast(c: CastRequest, now: number) {
    const ab = abilityFor(this.build, this.foco, c.slot);
    if (now < this.gcdUntil || now < (this.cdById[ab.id] ?? 0)) return;
    const range = (ab.range || 3) * TILE;
    let x: number, y: number;
    const tp = this.target ? this.remotePos(this.target) : null;
    if (c.drag) {
      const k = ab.aim === 'zona' ? Math.min(1, c.drag.len / 90) : 1;
      x = this.me.x + (c.drag.dx / c.drag.len) * range * k; y = this.me.y + (c.drag.dy / c.drag.len) * range * k;
    } else if (!this.input.touch && this.input.mouse) {
      const w = this.worldOf(this.input.mouse.x, this.input.mouse.y); x = w.x; y = w.y + 22;
    } else if (tp) { x = tp.x; y = tp.y; }
    else { x = this.me.x + this.me.ax * range * 0.7; y = this.me.y + this.me.ay * range * 0.7; }
    this.cdById[ab.id] = now + ab.cd * 1000; this.castAt[ab.id] = now; this.gcdUntil = now + GCD_MS;
    if (ab.id !== 'llamar_piedra' && ab.id !== 'barrido') this.lastCastAt = now; else if (ab.id === 'barrido') this.swingAt = now;
    this.pendingCast = { slot: c.slot, x: Math.round(x), y: Math.round(y), ...(this.target ? { target: this.target } : {}) };
    const d = Math.hypot(x - this.me.x, y - this.me.y) || 1, dx = (x - this.me.x) / d, dy = (y - this.me.y) / d;
    this.me.ax = dx; this.me.ay = dy;
    if (ab.id === 'llamar_piedra') { this.dashLeft = DASH_S; this.dashDir = { x: dx, y: dy }; }
    this.addFx(ab.id === 'llamar_piedra' ? 'embestida' : ab.id, this.me.x, this.me.y, { dx, dy, r: (ab.radius ?? 0) * TILE });
  }

  private addFx(kind: string, x: number, y: number, o: { dx?: number; dy?: number; r?: number; x2?: number; y2?: number } = {}) {
    const dur = kind === 'bolt' ? 140 : kind === 'embestida' ? 400 : 520;
    this.fxs.push({ kind, x, y, ...o, t0: performance.now(), dur });
    if (this.fxs.length > 60) this.fxs.shift();
  }

  /** Ataque básico de otro jugador: giro del báculo o disparo de ámbar hacia su objetivo. */
  private remoteAttack(r: Remote, o: { x: number; y: number; tg?: string | null; foco?: string }) {
    const foco = FOCOS[o.foco ?? 'vara'];
    if (foco?.melee) { r.swingAt = performance.now(); return; }
    r.shotAt = performance.now();
    const tgt = o.tg === this.myId ? this.me : o.tg ? this.remotePos(o.tg) : null;
    if (tgt) this.addFx('bolt', o.x, o.y - 26, { x2: tgt.x, y2: tgt.y - 26 });
  }

  /** Estado de combate que confirma el servidor. */
  private syncCombat(m: any, now: number) {
    const you = m.you;
    if (you.build) this.build = you.build;
    if (now - this.swapAt > 700 && (you.foco === 0 || you.foco === 1)) this.foco = you.foco;
    this.slowMul = you.slow ?? 1;
    if (you.cds) for (const slot of ['Q', 'E', 'R'] as Slot[]) {
      const id = abilityFor(this.build, this.foco, slot).id, srv = now + you.cds[slot];
      // Si el servidor rechazó un lanzamiento predicho, la recarga vuelve a su valor real.
      if (srv > (this.cdById[id] ?? 0) + 80 || now - (this.castAt[id] ?? -1e9) > 700) this.cdById[id] = srv;
    }
    if (you.target == null && this.target && this.targetSent === this.target && now - this.targetSetAt > 700) this.target = null;
    if (you.attackAt && you.attackAt > this.lastAttackAt) {
      const first = this.lastAttackAt === 0;
      this.lastAttackAt = you.attackAt;
      if (!first) {
        const foco = FOCOS[this.build.focos[this.foco]];
        const tp = this.target ? this.remotePos(this.target) : null;
        if (foco.melee) this.swingAt = now;
        else { this.shotAt = now; if (tp) this.addFx('bolt', this.me.x, this.me.y - 26, { x2: tp.x, y2: tp.y - 26 }); }
      }
    }
    const seen = new Set<number>();
    for (const p of m.projectiles ?? []) { this.projectiles.set(p.id, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, t: now }); seen.add(p.id); }
    for (const id of this.projectiles.keys()) if (!seen.has(id)) this.projectiles.delete(id);
  }

  /** Marcas en el piso: aro del objetivo, alcance del básico si está lejos y hielo de ralentización. */
  private drawGroundMarks(remotes: { r: Remote; x: number; y: number }[], sec: number) {
    const g = this.ctx;
    for (const { r, x, y } of remotes) {
      if (r.slow) { g.strokeStyle = 'rgba(140,210,255,.75)'; g.lineWidth = 3; g.beginPath(); g.ellipse(x, y + 2, 26, 10, 0, 0, 6.283); g.stroke(); }
      if (r.id !== this.target) continue;
      const pulse = 1 + Math.sin(sec * 5) * 0.06;
      g.strokeStyle = '#1d0c16'; g.lineWidth = 6; g.beginPath(); g.ellipse(x, y + 2, 30 * pulse, 12 * pulse, 0, 0, 6.283); g.stroke();
      g.strokeStyle = '#ffd36a'; g.lineWidth = 3; g.setLineDash([10, 6]); g.lineDashOffset = -sec * 20; g.stroke(); g.setLineDash([]);
      const foco = FOCOS[this.build.focos[this.foco]];
      if (!inBasicRange(foco, Math.hypot(x - this.me.x, y - this.me.y), PLAYER.radius)) {
        g.strokeStyle = 'rgba(255,211,106,.35)'; g.lineWidth = 2; g.setLineDash([6, 8]);
        g.beginPath(); g.ellipse(this.me.x, this.me.y, foco.basic.range * TILE + PLAYER.radius, (foco.basic.range * TILE + PLAYER.radius) * 0.9, 0, 0, 6.283); g.stroke(); g.setLineDash([]);
      }
    }
    if (this.slowMul < 1) { g.strokeStyle = 'rgba(140,210,255,.75)'; g.lineWidth = 3; g.beginPath(); g.ellipse(this.me.x, this.me.y + 2, 26, 10, 0, 0, 6.283); g.stroke(); }
  }

  /** Proyectiles y efectos de habilidades (en modo aditivo, brillan sobre la oscuridad). */
  private drawCombatFx(now: number, art: Sprites) {
    const g = this.ctx;
    for (const p of this.projectiles.values()) {
      const k = Math.min(0.12, (now - p.t) / 1000), x = p.x + p.vx * k, y = p.y + p.vy * k;
      g.globalAlpha = 0.9; g.drawImage(art.dot.gold, x - 16, y - 16, 32, 32);
      g.globalAlpha = 1; g.strokeStyle = 'rgba(255,200,110,.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x - p.vx * 0.04, y - p.vy * 0.04); g.stroke();
    }
    this.fxs = this.fxs.filter((f) => now - f.t0 < f.dur);
    for (const f of this.fxs) {
      const k = (now - f.t0) / f.dur, a = 1 - k;
      if (f.kind === 'temblor' || f.kind === 'barrido') {
        const R = (f.r || 160) * (0.35 + 0.65 * k);
        g.strokeStyle = f.kind === 'temblor' ? `rgba(255,160,80,${a * 0.8})` : `rgba(255,220,140,${a})`; g.lineWidth = 10 * a + 2;
        g.beginPath(); g.ellipse(f.x, f.y, R, R * 0.6, 0, 0, 6.283); g.stroke();
        if (f.kind === 'barrido') { g.lineWidth = 6; g.beginPath(); g.arc(f.x, f.y - 22, 64, k * 9, k * 9 + 2.4); g.stroke(); }
      } else if (f.kind === 'embestida') {
        g.strokeStyle = `rgba(255,170,90,${a * 0.8})`; g.lineWidth = 16 * a + 2;
        g.beginPath(); g.moveTo(f.x, f.y - 20); g.lineTo(f.x + (f.dx ?? 0) * 4 * TILE * Math.min(1, k * 1.6), f.y - 20 + (f.dy ?? 0) * 4 * TILE * Math.min(1, k * 1.6)); g.stroke();
      } else if (f.kind === 'andanada') {
        g.globalAlpha = a; g.drawImage(art.dot.gold, f.x + (f.dx ?? 0) * 30 - 30, f.y - 50 + (f.dy ?? 0) * 30, 60, 60); g.globalAlpha = 1;
      } else if (f.kind === 'bolt' && f.x2 != null && f.y2 != null) {
        const bx = f.x + (f.x2 - f.x) * k, by = f.y + (f.y2 - f.y) * k;
        g.globalAlpha = 0.95; g.drawImage(art.dot.gold, bx - 12, by - 12, 24, 24); g.globalAlpha = 1;
        g.strokeStyle = 'rgba(255,200,110,.75)'; g.lineWidth = 3; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - (f.x2 - f.x) * 0.12, by - (f.y2 - f.y) * 0.12); g.stroke();
      }
    }
  }

  /** Guía de apuntado mientras se arrastra un botón de habilidad en móvil. */
  private drawAimGuide() {
    const d = this.input.aimDrag; if (!d || d.len < 18) return;
    const ab = abilityFor(this.build, this.foco, d.slot), g = this.ctx;
    const range = (ab.range || 3) * TILE, dx = d.dx / d.len, dy = d.dy / d.len;
    g.strokeStyle = 'rgba(255,211,106,.85)'; g.lineWidth = 4; g.setLineDash([12, 8]);
    if (ab.aim === 'propio') { g.beginPath(); g.ellipse(this.me.x, this.me.y, (ab.radius ?? 2) * TILE, (ab.radius ?? 2) * TILE * 0.6, 0, 0, 6.283); g.stroke(); }
    else if (ab.aim === 'zona') { const k = Math.min(1, d.len / 90); g.beginPath(); g.arc(this.me.x + dx * range * k, this.me.y + dy * range * k, (ab.radius ?? 1) * TILE, 0, 6.283); g.stroke(); }
    else { g.beginPath(); g.moveTo(this.me.x, this.me.y - 20); g.lineTo(this.me.x + dx * range, this.me.y - 20 + dy * range); g.stroke(); }
    g.setLineDash([]);
  }

  /** Barra de habilidades (PC) y botones táctiles: nombre, recarga y Foco en la mano. */
  private updateAbilityHud() {
    const now = performance.now();
    for (const el of this.abEls) {
      const slot = el.dataset.slot as Slot | 'S';
      let name: string, left: number, total: number;
      if (slot === 'S') { const f = FOCOS[this.build.focos[this.foco]]; name = f.name; left = this.swapUntil - now; total = SWAP_MS; }
      else { const ab = abilityFor(this.build, this.foco, slot); name = ab.name; left = Math.max((this.cdById[ab.id] ?? 0) - now, this.gcdUntil - now); total = Math.max(ab.cd * 1000, GCD_MS); }
      const nm = el.querySelector<HTMLElement>('.ab-name'); if (nm && nm.textContent !== name) nm.textContent = name;
      if (el.title !== name) el.title = name;
      const cd = el.querySelector<HTMLElement>('.ab-cd');
      if (cd) {
        const p = left > 0 ? Math.min(1, left / total) : 0;
        cd.style.setProperty('--p', p.toFixed(3));
        const txt = left > 400 ? String(Math.ceil(left / 1000)) : '';
        if (cd.textContent !== txt) cd.textContent = txt;
      }
      el.dataset.ready = String(left <= 0);
    }
  }

  private blob(x: number, y: number, rx: number) {
    const g = this.ctx; g.fillStyle = 'rgba(20,6,12,.42)'; g.beginPath(); g.ellipse(x, y, rx, rx * 0.38, 0, 0, 6.283); g.fill();
  }

  /** Antorcha sobre la cara del muro, con flama que parpadea. */
  private drawSconce(d: Decor, sec: number) {
    const g = this.ctx, art = Game.art!, sc = art.img.sconce, fl = art.img.flame;
    if (sc) g.drawImage(sc, d.x - 15, d.y - 40, 30, 26);
    if (fl) { const f = 1 + Math.sin(sec * 11 + d.ph) * 0.08 + Math.sin(sec * 23 + d.ph) * 0.04; g.save(); g.translate(d.x, d.y - 36); g.scale(1 / f, f); g.drawImage(fl, -13, -34, 26, 34); g.restore(); }
  }

  private drawChest(c: { k?: ChestKind; x: number; y: number; s: 'closed' | 'open' | 'empty' }) {
    const g = this.ctx, k = c.k ?? 'forja', size = CHEST_ART[k].size;
    const img = Game.chestImg[`${k}_${CHEST_FILE[c.s]}`];
    this.blob(c.x, c.y + 6, size * 0.36);
    // El sprite está normalizado: la base cae al 94% del lienzo y centrada en x.
    if (img?.complete && img.naturalWidth) g.drawImage(img, c.x - size / 2, c.y + 10 - size * 0.94, size, size);
    else { g.fillStyle = '#6b3a2c'; g.strokeStyle = INK; g.lineWidth = 4; g.beginPath(); g.roundRect(c.x - 36, c.y - 50, 72, 56, 8); g.fill(); g.stroke(); }
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
  private drawSwing(_t: number) {
    const k = (performance.now() - this.swingAt) / 260;
    if (k < 0 || k > 1 || !this.me.alive) return;
    const g = this.ctx, a0 = Math.atan2(this.me.ay, this.me.ax);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(255,190,90,${(1 - k) * 0.9})`; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.arc(this.me.x, this.me.y - 22, 72, a0 - 1.1, a0 - 1.1 + 2.2 * Math.min(1, k * 1.6)); g.stroke();
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

  /** Apariencia estable de cada jugador (cuerpo, ropa y cabeza). */
  private look(id: string): Appearance {
    let a = this.looks.get(id);
    if (!a) { a = appearanceFor(id || 'yo'); this.looks.set(id, a); }
    return a;
  }

  /** Arcanista animado por piezas: mira hacia donde apunta, camina, golpea, lanza, recibe daño y cae. */
  private drawActor(a: ActorDraw, now: number) {
    const view: View = Math.abs(a.ax) > Math.abs(a.ay) * 0.9 ? 'side' : a.ay < 0 ? 'back' : 'front';
    const flip = view === 'side' && a.ax < 0, app = this.look(a.id);
    // La acción más reciente que siga en curso gana.
    let action: AnimInput['action'] = null, best = -Infinity;
    for (const [kind, at] of [['melee', a.swingAt], ['shoot', a.shotAt], ['cast', a.castAt], ['hit', a.hitAt]] as [ActionKind, number][]) {
      const k = (now - at) / ACT_MS[kind];
      if (k >= 0 && k < 1 && at > best) { best = at; action = { kind, k }; }
    }
    const die = a.dieAt != null ? Math.min(1, (now - a.dieAt) / DIE_MS) : undefined;
    const pose = animate(view, { t: now / 1000, walk: a.walk, move: a.move, action, die }, BODIES[app.body]);
    const alpha = die != null ? Math.max(0, 1 - Math.max(0, (now - a.dieAt! - DIE_MS) / 600)) : 1;
    if (die == null) this.blob(a.x, a.y, 20);
    drawCharacter(this.ctx, {
      x: a.x, y: a.y, view, flip, app, pose, t: now / 1000, alpha,
      team: a.me ? TEAM_ME : TEAM_OTHER, foco: a.foco ?? null,
      flash: now - a.hitAt < 120 ? 1 : 0,
    });
  }
}
