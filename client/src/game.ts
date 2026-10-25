import {
  TILE, PLAYER, INTERP_DELAY_MS, TICK_MS, WALL, THIN, COVER, SEAL_VAULT, SEAL_HEART, DIAG_TL, DIAG_TR, DIAG_BL, DIAG_BR, GATE_DIR, isDiag, isGate, ITEMS, createJitter, updateJitter, adaptiveDelay, viewScale, VISION_RADIUS, INTERACT_RANGE, generateValidMap, sampleBuffer, stepMove, replayMoves, pendingAfterAck, type MoveCmd, createRng, itemValue,
  FOCOS, NOMBRES, DEFAULT_BUILD, abilityFor, clampAim, fanDirections, blinkTarget, dashMulFor, reloadAmmo, solidAt, AMMO_MAX, GCD_MS, SWAP_MS, DASH_S, DASH_MUL,
  type Build, type Slot, type Shape, type ProjectileDef,
  animate, appearanceFor, BODIES, type Appearance, type AnimInput, type ActionKind, type View,
  TEAMS, RESONANCE, stackLabels, MONSTERS, RITUAL, STRIKE_DELAY_MS, needleAt, openVault,
  type GridMap, type TimedPosition,
} from '@shared/index';
import type { Net } from './net';
import { Input, type AimSlot, type Drag } from './input';
import { Sprites, isDeepWall, drawDiagWall, drawThinCracks, drawCover, drawBars, drawBrazier, buildFloorChunk, buildWall, wallKey, buildDecor, drawGrass, glowP, CHUNK, WALL_RISE, INK, type FloorChunk, type Decor } from './art';
import { drawCharacter } from './rig';
import { drawErrante, drawSusurrante, drawColoso, drawRuneTelegraph, drawZoneTelegraph, shadow as monShadow, PveFx, MONSTER_SCALE, SUSURRANTE_MOUTH, type ErrantePose, type SusurrantePose, type ColosoPose } from './desnombrados';

interface Remote { id: string; name: string; buf: TimedPosition[]; hp: number; ax: number; ay: number; atk: boolean; seen: number; lx: number; ly: number; walk: number; flash: number; foco?: string; slow?: boolean; root?: boolean; invis?: boolean; rev?: boolean; mark?: boolean; team?: number; labelDy?: number; swingAt: number; shotAt: number; castAt: number; mv: number; drawT: number }
/** Desnombrado visto: posiciones para interpolar, estado del servidor y cuándo golpeó (para animar). */
interface Mon { id: number; k: 'errante' | 'susurrante' | 'coloso'; buf: TimedPosition[]; hp: number; st: string; p: number; ax: number; ay: number; dx: number; seen: number; strikeAt: number; face: number }
/** Monolito en la instantánea: fase del ritual, equipo, integridad, progreso (%), oleada y descanso (s). */
interface RitualView { x: number; y: number; ph: string; tm: number; i: number; p: number; w: number; cd: number }
interface Fx { kind: string; x: number; y: number; dx?: number; dy?: number; r?: number; x2?: number; y2?: number; ang?: number; w?: number; rgb?: string; t0: number; dur: number }
/** Disparo propio predicho: se dibuja desde que sale, sin esperar al servidor. */
interface MyShot { n: number; kind: string; x0: number; y0: number; dx: number; dy: number; speed: number; radius: number; range: number; t0: number; seen: boolean; dead: boolean; pierce: boolean }
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
/**
 * Luces precalculadas: un degradado radial dibujado una vez en un lienzo pequeño y luego estirado
 * con drawImage. En el móvil es mucho más barato que crear un degradado por luz en cada cuadro.
 */
const lightCache = new Map<string, HTMLCanvasElement>();
function lightSprite(key: string, stops: [number, string][]): HTMLCanvasElement {
  let c = lightCache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [k, col] of stops) gr.addColorStop(k, col);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); lightCache.set(key, c);
  }
  return c;
}
const HOLE = () => lightSprite('hole', [[0, 'rgba(0,0,0,1)'], [0.5, 'rgba(0,0,0,.8)'], [1, 'rgba(0,0,0,0)']]);
const TINT = (c: string, a: number) => lightSprite(`${c}|${a}`, [[0, `rgba(${c},${a})`], [1, `rgba(${c},0)`]]);
/**
 * Escrituras al DOM solo si el valor cambió: cada cambio obliga al navegador a recalcular estilos
 * (y a veces el acomodo), y hacerlo en cada cuadro le cuesta mucho a un celular.
 */
function setText(el: HTMLElement, v: string) { if (el.textContent !== v) el.textContent = v; }
function setStyle(el: HTMLElement, prop: string, v: string) { if (el.style.getPropertyValue(prop) !== v) el.style.setProperty(prop, v); }
function setData(el: HTMLElement, key: string, v: string) { if (el.dataset[key] !== v) el.dataset[key] = v; }

/** Nombres sobre los personajes: se dibujan una vez en un lienzo pequeño y se reutilizan (el texto es caro). */
const labelCache = new Map<string, HTMLCanvasElement>();
function labelSprite(text: string, color: string): HTMLCanvasElement {
  const key = text + '|' + color;
  let c = labelCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    const g0 = c.getContext('2d')!, font = '500 26px "Alegreya Sans", sans-serif';
    g0.font = font; const w = Math.ceil(g0.measureText(text).width) + 8;
    c.width = w; c.height = 34;
    const g = c.getContext('2d')!; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = INK; g.fillText(text, w / 2 + 2, 19); g.fillStyle = color; g.fillText(text, w / 2, 17);
    if (labelCache.size > 200) labelCache.clear();
    labelCache.set(key, c);
  }
  return c;
}
/** Si el juego baja de este ritmo, se reduce la resolución de dibujo (y sube cuando se recupera). */
const LOW_FPS = 45, HIGH_FPS = 57;
/** Medición de tiempos por sección del dibujo (solo con ?perf en la dirección). */
const PERF = typeof location !== 'undefined' && location.search.includes('perf');
/** Color de la faja si no se conoce el equipo (partidas sin equipos). */
const TEAM_ME = '#ffb347', TEAM_OTHER = '#9a6bff';
const teamColor = (t: number | undefined, fallback: string) => (t != null && TEAMS[t] ? TEAMS[t].color : fallback);
/** Duración de cada animación de acción (ms). */
const ACT_MS: Record<ActionKind, number> = { melee: 420, shoot: 360, cast: 600, hit: 340 };
const DIE_MS = 900;
/** Estado de animación de un personaje en este cuadro. */
interface ActorDraw { x: number; y: number; ax: number; ay: number; id: string; me: boolean; color: string; invis?: boolean; walk: number; move: number; foco?: string; swingAt: number; shotAt: number; castAt: number; hitAt: number; dieAt?: number }
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
  private vignette = document.createElement('canvas');
  /** Resolución de la capa de oscuridad respecto al lienzo (1/2 en PC, 1/3 en táctil). */
  private darkK = 0.5;
  /** Calidad de dibujo (1 = completa); baja sola si el dispositivo no alcanza 45 FPS. */
  private quality = 1; private qAcc = 0; private qN = 0; private qHigh = 0; private workAcc = 0; private capWarned = false;
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
  /** Equipo propio (-1 si la partida no tiene equipos) y filas del panel de compañeros. */
  private myTeam = -1;
  private allyRows = new Map<string, HTMLElement>();
  private build: Build = DEFAULT_BUILD;
  private foco: 0 | 1 = 0;
  /** Munición predicha (0 a 3), próximo disparo permitido y número de disparo (para casar la predicción). */
  private ammo = AMMO_MAX; private nextShotAt = 0; private lastFireAt = -1e9; private ammoDeny = -1e9; private shotN = 0;
  private pendingFire: { x: number; y: number; n: number } | null = null;
  private myShots: MyShot[] = [];
  private dashMul = DASH_MUL;
  private rooted = false; private invis = false; private revealing = false;
  /** Recargas predichas (hora local en ms) por habilidad, recarga global y cambio de Foco. */
  private cdById: Record<string, number> = {};
  private castAt: Record<string, number> = {};
  private gcdUntil = 0; private swapUntil = 0; private swapAt = -1e9;
  private slowMul = 1;
  /** Embestida predicha: segundos que quedan y dirección. */
  private dashLeft = 0; private dashDir = { x: 0, y: 0 };
  private pendingCast: { slot: Slot; x: number; y: number; n: number } | null = null;
  private pendingSwap = false;
  private lastAttackAt = 0;
  private projectiles = new Map<number, { x: number; y: number; vx: number; vy: number; t: number; k?: string; r?: number }>();
  private fxs: Fx[] = [];
  private abEls: HTMLElement[] = [];
  private floaters: { x: number; y: number; text: string; t0: number; id?: string; heal?: boolean }[] = [];
  private portals: { x: number; y: number; open: boolean; u?: number }[] = [];
  /** Resonancia del equipo propio (null fuera de la Primera y Segunda Llamada): barra, marca, anillo y multiplicador. */
  private res: { v: number; m: boolean; z: 'near' | 'far' | null; k: number } | null = null;
  private chests: { id: string; k?: ChestKind; x: number; y: number; s: 'closed' | 'open' | 'empty' }[] = [];
  private remains: { id: string; x: number; y: number; owner: string }[] = [];
  private inv: string[] = [];
  private toastTimer: number | undefined;
  private collapseR: number | null = null;
  /** PvE: Desnombrados, efectos de sus ataques, rituales, bóvedas abiertas y prueba de Nombre en curso. */
  private mons = new Map<number, Mon>();
  private pve = new PveFx();
  private pveT = performance.now();
  private rituals: RitualView[] = [];
  private openedVaults = new Set<number>();
  private phaseId = '';
  private nameTest: { el: number; z: number; at: number } | null = null;
  private pendingName: number | null = null;
  private seq = 0;
  private lastSend = 0;
  private raf = 0;
  private last = performance.now();
  private fpsAcc = 0; private fpsN = 0;
  private W = 0; private H = 0; private dpr = 1; private scale = 1;
  private cam = { x: 0, y: 0 };
  private offs: (() => void)[] = [];
  private el: Record<string, HTMLElement>;

  constructor(private root: HTMLElement, private net: Net, start: { seed: number; players: number; x: number; y: number; you?: string; team?: number }) {
    const canvas = root.querySelector('canvas')!;
    // Lienzo opaco (el navegador no mezcla con lo de atrás) y de baja latencia donde se soporte.
    this.ctx = (canvas.getContext('2d', { alpha: false, desynchronized: true }) ?? canvas.getContext('2d'))!;
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
    this.el = { hpBar: q('hp-bar'), hpText: q('hp-text'), phase: q('phase'), timer: q('timer'), ping: q('ping'), fps: q('fps'), sync: q('sync'), syncBar: q('sync-bar'), state: q('player-state'), toast: q('toast'), inv: q('inventory'), invSlots: q('inv-slots'), invValue: q('inv-value'), reso: q('resonance'), resoBar: q('reso-bar'), resoTxt: q('reso-txt'), ritual: q('ritual'), syncTxt: root.querySelector<HTMLElement>('.sync-txt')! };
    Game.loadSprites();
    this.renderInventory([]);
    const names = (ids: string[]) => ids.map((id) => ITEMS[id]?.name ?? id).join(', ');
    this.offs.push(net.on('opened', (m) => this.toast(m.items.length ? `Contiene: ${names(m.items)}` : 'Está vacío')));
    this.offs.push(net.on('looted', (m) => this.toast(`Obtuviste: ${names(m.items)}${m.left ? ' · no cupo todo' : ''}`)));
    this.offs.push(net.on('notice', (m) => this.toast(m.message)));
    this.offs.push(net.on('name', (m) => this.toast(m.result === 'perfecto' ? '¡Nombre perfecto! El monolito se fortalece' : m.result === 'correcto' ? 'Nombre correcto: el ritual sigue' : 'Nombre errado: el monolito te delata')));
    this.offs.push(net.on('extracted', (m) => this.toast(`Escapaste con ${m.value} ◆`)));
    // Curaciones: número verde sobre quien se cura.
    this.offs.push(net.on('heal', (m) => { this.floaters.push({ x: m.x, y: m.y, text: `+${m.amt}`, t0: performance.now(), heal: true }); }));
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
    this.myTeam = start.team ?? -1;
    this.abEls = [...root.querySelectorAll<HTMLElement>('[data-slot]')];
    // Efectos de habilidades de otros jugadores (las propias ya se dibujaron al lanzarlas).
    this.offs.push(net.on('fx', (m) => {
      if (this.onPveFx(m)) return;
      if (m.by === this.myId) return;
      this.addFx(m.kind, m.x, m.y, { dx: m.dx, dy: m.dy, r: m.r, ang: m.ang, w: m.w, rgb: m.rgb, x2: m.x2, y2: m.y2 });
      const r = m.by ? this.remotes.get(m.by) : undefined;
      if (r && m.kind !== 'arco' && m.kind !== 'estocada' && m.kind !== 'embestida') {
        // Giros alrededor (como la Siega) se animan como golpe; lo demás, como lanzamiento.
        const def = Object.values(FOCOS).find((f) => f.insc.id === m.kind)?.insc;
        if (def?.shape.type === 'propio' && def.effect.knock) r.swingAt = performance.now(); else r.castAt = performance.now();
      }
    }));
    this.offs.push(net.on('latency', (m) => { this.el.ping.textContent = `${Math.round(m.ms)} ms`; }));
    this.resize();
    addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() { this.root.querySelector('#aliados')?.replaceChildren(); cancelAnimationFrame(this.raf); removeEventListener('resize', this.resize); this.offs.forEach((o) => o()); window.clearTimeout(this.toastTimer); this.el.toast.hidden = true; }

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
    // En pantallas táctiles la densidad se limita a 1.5x: casi no se nota y son la mitad de píxeles.
    const touch = matchMedia('(pointer: coarse)').matches;
    this.dpr = Math.max(0.6, Math.min(touch ? 1.5 : 2, devicePixelRatio || 1) * this.quality);
    this.W = innerWidth; this.H = innerHeight;
    c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr);
    // La capa de oscuridad va a menor resolución: los degradados no lo notan y el móvil lo agradece.
    this.darkK = touch ? 1 / 3 : 0.5;
    this.dark.width = Math.ceil(c.width * this.darkK); this.dark.height = Math.ceil(c.height * this.darkK);
    // Viñeta y tono violeta a un cuarto de resolución: son degradados suaves.
    const vw = Math.max(1, Math.ceil(this.W / 4)), vh = Math.max(1, Math.ceil(this.H / 4));
    this.vignette.width = vw; this.vignette.height = vh;
    const vgx = this.vignette.getContext('2d')!;
    vgx.fillStyle = 'rgba(70,24,100,.10)'; vgx.fillRect(0, 0, vw, vh);
    const vg = vgx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.3, vw / 2, vh / 2, Math.max(vw, vh) * 0.75);
    vg.addColorStop(0, 'rgba(8,3,12,0)'); vg.addColorStop(1, 'rgba(8,3,12,.8)'); vgx.fillStyle = vg; vgx.fillRect(0, 0, vw, vh);
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
      // Hora del servidor que se está dibujando: los golpes en arco se revisan contra lo que veías.
      viewT: this.serverTimeAt(performance.now() - this.interpDelay),
    };
    if (this.pendingFire) msg.fire = this.pendingFire;
    if (this.pendingCast) msg.cast = this.pendingCast;
    if (this.pendingName !== null) { msg.name = this.pendingName; msg.use = false; this.pendingName = null; this.nameTest = null; }
    this.pendingFire = null; this.pendingCast = null; this.pendingSwap = false;
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
    this.portals = m.portals; this.collapseR = m.collapseR; this.res = m.res ?? null;
    // Mismos sellos que el servidor (la física predicha debe coincidir): cada bóveda mayor la abre
    // su ritual; la Bóveda Antigua, la caída del Coloso.
    for (const v of m.vaults ?? []) if (!this.openedVaults.has(v)) { openVault(this.map, v); this.openedVaults.add(v); }
    this.map.sealsOpen.heart = m.heart === 'abierta';
    this.rituals = m.rit ?? [];
    this.phaseId = m.phase;
    this.syncMonsters(m.mons ?? [], now);
    this.nameTest = m.you.nt ? { el: m.you.nt.el, z: m.you.nt.z, at: now } : null;
    this.chests = m.chests ?? []; this.remains = m.remains ?? [];
    const inv: string[] = m.you.inv ?? [];
    if (inv.join() !== this.inv.join()) this.renderInventory(inv);
    for (const o of m.others) {
      let r = this.remotes.get(o.id);
      if (!r) { r = { id: o.id, name: o.name, buf: [], hp: o.hp, ax: o.ax, ay: o.ay, atk: o.atk, seen: now, lx: o.x, ly: o.y, walk: 0, flash: -1e9, swingAt: -1e9, shotAt: -1e9, castAt: -1e9, mv: 0, drawT: now }; this.remotes.set(o.id, r); }
      r.buf.push({ x: o.x, y: o.y, t: now }); if (r.buf.length > 20) r.buf.shift();
      if (o.atk && !r.atk) this.remoteAttack(r, o);
      Object.assign(r, { hp: o.hp, ax: o.ax, ay: o.ay, atk: o.atk, seen: now, foco: o.foco, slow: o.slow, root: o.root, invis: o.invis, rev: o.rev, mark: o.mark, team: o.team });
    }
    for (const [id, r] of this.remotes) if (now - r.seen > 500) this.remotes.delete(id);
    this.syncCombat(m, now);
    this.renderAllies(m.allies ?? []);
    setStyle(this.el.hpBar, 'width', `${Math.round(m.you.hp)}%`);
    const low = m.you.alive && m.you.hp <= 30, vida = this.el.hpBar.closest<HTMLElement>('.vida');
    if (vida && vida.hasAttribute('data-low') !== low) vida.toggleAttribute('data-low', low);
    setText(this.el.hpText, String(Math.ceil(m.you.hp)));
    setText(this.el.phase, PHASE_LABEL[m.phase] ?? m.phase);
    const s = m.timeLeft; setText(this.el.timer, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    // La misma barra sirve para sincronizar con el portal y para despertar un monolito.
    const rt: number = m.you.rt ?? 0, syncing = m.you.sync > 0 || rt > 0;
    if (this.el.sync.hidden === syncing) this.el.sync.hidden = !syncing;
    if (syncing) {
      setStyle(this.el.syncBar, 'width', `${Math.round(Math.min(100, rt > 0 ? rt * 100 : (m.you.sync / m.you.syncNeed) * 100))}%`);
      setText(this.el.syncTxt, rt > 0 ? 'Despertando el monolito…' : 'Sincronizando con el portal…');
    }
    this.updateResonanceHud();
    this.updateRitualHud();
  }

  /** Línea del ritual de tu equipo bajo la fase: oleada, integridad y progreso. */
  private updateRitualHud() {
    const r = this.rituals.find((x) => x.tm === this.myTeam && (x.ph === 'defensa' || x.ph === 'reparar'));
    const box = this.el.ritual;
    if (box.hidden !== !r) box.hidden = !r;
    if (!r) return;
    setData(box, 'phase', r.ph);
    setText(box, r.ph === 'reparar' ? 'Ritual detenido · haz la prueba de Nombre' : `Ritual · oleada ${r.w}/2 · integridad ${r.i}% · ${r.p}%`);
  }

  /** Actualiza los Desnombrados visibles (con búfer para interpolar como a los jugadores). */
  private syncMonsters(list: { id: number; k: Mon['k']; x: number; y: number; hp: number; st: string; p: number; ax: number; ay: number; dx: number }[], now: number) {
    for (const o of list) {
      let r = this.mons.get(o.id);
      if (!r) { r = { id: o.id, k: o.k, buf: [], hp: o.hp, st: o.st, p: o.p, ax: o.ax, ay: o.ay, dx: o.dx, seen: now, strikeAt: -1e9, face: 1 }; this.mons.set(o.id, r); }
      r.buf.push({ x: o.x, y: o.y, t: now }); if (r.buf.length > 20) r.buf.shift();
      Object.assign(r, { hp: o.hp, st: o.st, p: o.p, ax: o.ax, ay: o.ay, dx: o.dx, seen: now });
      if (Math.abs(o.dx) > 0.2) r.face = o.dx < 0 ? -1 : 1;
    }
    for (const [id, r] of this.mons) if (now - r.seen > 500) this.mons.delete(id);
  }

  /** Efectos de PvE que manda el servidor. Devuelve true si el mensaje era de PvE. */
  private onPveFx(m: any): boolean {
    const near = Math.hypot((m.x2 ?? m.x) - this.me.x, (m.y2 ?? m.y) - this.me.y) < 900;
    switch (m.kind) {
      case 'golpe': {
        const r = this.mons.get(m.id); if (r) r.strikeAt = performance.now();
        if (m.mk === 'errante') this.pve.slash(m.x2, m.y2 - 30, m.x2 - m.x);
        else if (m.mk === 'susurrante') this.pve.lament(m.x, m.y + (SUSURRANTE_MOUTH + 8) * MONSTER_SCALE.susurrante, m.x2, m.y2, STRIKE_DELAY_MS.susurrante);
        else this.pve.impact(m.x2, m.y2, MONSTERS.coloso.area);
        if (!near) this.pve.shake = 0;
        return true;
      }
      case 'disuelve': this.pve.dissolve(m.x, m.y, m.mk === 'coloso'); return true;
      case 'monolito-pulso': this.pve.pulse(m.x, m.y, '190,120,255', 320); return true;
      case 'monolito-completo': this.pve.pulse(m.x, m.y, '255,210,120', 260); return true;
      case 'monolito-roto': this.pve.pulse(m.x, m.y, '255,80,90', 220); return true;
      case 'pulso': this.pve.pulse(m.x, m.y, '140,255,230', 180); return true;
    }
    return false;
  }

  /** Barra de Resonancia bajo la fase: solo mientras está activa; roja y con aviso si el equipo está marcado. */
  private updateResonanceHud() {
    const r = this.res, box = this.el.reso;
    if (box.hidden !== !r) box.hidden = !r;
    if (!r) return;
    setStyle(this.el.resoBar, 'width', `${Math.round(r.v)}%`);
    setData(box, 'value', String(Math.round(r.v)));
    setData(box, 'marked', String(r.m));
    setData(box, 'zone', r.z ?? '');
    setText(this.el.resoTxt, r.m ? '¡Marcados por la Resonancia!' : r.z ? `Resonancia ×${r.k}` : 'Resonancia');
  }

  private loop = (t: number) => {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const w0 = performance.now();
    this.update(dt, t);
    this.draw(t);
    // Tiempo de trabajo del cuadro (sin contar la espera del navegador): distingue si el juego es lento
    // o si el sistema limita los cuadros (modo de ahorro de energía).
    this.workAcc += performance.now() - w0;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { if (!PERF) setText(this.el.fps, `${Math.round(this.fpsN / this.fpsAcc)} fps`); this.fpsAcc = 0; this.fpsN = 0; }
    this.adaptQuality(dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  /**
   * Resolución adaptable, cada 2 s:
   * - Si va lento y el juego tarda mucho por cuadro, baja la resolución (hasta 60 %).
   * - Si va a ~30 FPS justos pero el juego trabaja poco, es el sistema limitando (ahorro de energía):
   *   no se baja la calidad (no ayudaría) y se avisa una vez al jugador.
   * - Si se mantiene rápido 6 s, la resolución vuelve a subir.
   */
  private adaptQuality(dt: number) {
    this.qAcc += dt; this.qN++;
    if (this.qAcc < 2) return;
    const fps = this.qN / this.qAcc, work = this.workAcc / this.qN;
    this.qAcc = 0; this.qN = 0; this.workAcc = 0;
    if (PERF) {
      // Diagnóstico en pantalla (?perf): ritmo, trabajo por cuadro, calidad, densidad y la parte más cara.
      const rows = ((window as any).__cgPerf ?? []).slice(-60) as number[][], names = ['piso', 'objetos', 'luz', 'brillos', 'interfaz', 'final'];
      const avg = names.map((_, i) => rows.reduce((t, r) => t + (r[i] ?? 0), 0) / (rows.length || 1));
      const top = avg.indexOf(Math.max(...avg));
      setText(this.el.fps, `${Math.round(fps)} fps · ${work.toFixed(1)} ms · ${Math.round(this.quality * 100)}% · ${this.dpr.toFixed(2)}x · ${names[top]} ${avg[top].toFixed(1)} ms`);
    }
    if (document.hidden) return;
    const budget = 1000 / 60;
    if (fps < LOW_FPS && work > budget * 0.6 && this.quality > 0.6) { this.quality = Math.max(0.6, this.quality - 0.15); this.qHigh = 0; this.resize(); }
    else if (fps < LOW_FPS && fps > 26 && fps < 34 && work < budget * 0.45 && !this.capWarned) {
      this.capWarned = true;
      this.toast('Tu dispositivo limita el juego a 30 FPS (ahorro de energía). Desactívalo para jugar a 60.');
    }
    else if (fps > HIGH_FPS && this.quality < 1) { if (++this.qHigh >= 3) { this.quality = Math.min(1, this.quality + 0.15); this.qHigh = 0; this.resize(); } }
    else this.qHigh = 0;
  }

  private screenOf(x: number, y: number) {
    return { x: (x - this.cam.x) * this.scale + this.W / 2, y: (y - this.cam.y) * this.scale + this.H / 2 };
  }

  private update(dt: number, t: number) {
    this.input.update(this.screenOf(this.me.x, this.me.y));
    const active = this.me.alive && !this.me.extracted;
    const moving0 = Math.hypot(this.input.mx, this.input.my) > 0.1;
    this.handleCombatInput(active);
    // Dirección cuantizada a centésimas: cliente y servidor calculan exactamente lo mismo.
    const q = (v: number) => Math.round(v * 100) / 100;
    // Inmovilizado: no se mueve (el servidor tampoco lo permitiría).
    let mx = active && !this.rooted ? q(this.input.mx) : 0, my = active && !this.rooted ? q(this.input.my) : 0, sp = this.slowMul > 0 ? this.slowMul : 1, mdt = dt;
    // Embestida predicha: el mismo tiempo exacto que autoriza el servidor, a su velocidad.
    if (this.dashLeft > 0 && active) { mx = q(this.dashDir.x); my = q(this.dashDir.y); sp = this.dashMul; mdt = Math.min(dt, this.dashLeft); this.dashLeft -= mdt; }
    if (active) this.pred = stepMove(this.map, this.pred, mx, my, mdt, sp);
    // La corrección del servidor se reparte en unos cuadros en lugar de aplicarse de golpe.
    const ek = Math.min(1, dt * 10);
    this.err.x -= this.err.x * ek; this.err.y -= this.err.y * ek;
    this.me.x = this.pred.x - this.err.x; this.me.y = this.pred.y - this.err.y;
    // Mira hacia el cursor (PC), hacia donde arrastra o hacia donde camina (táctil).
    if (!this.input.touch || this.input.hold || moving0) { this.me.ax = this.input.aimX; this.me.ay = this.input.aimY; }
    // Las cargas se recargan solas al ritmo del Foco en la mano.
    this.ammo = reloadAmmo(this.ammo, dt * 1000, FOCOS[this.build.focos[this.foco]].basic.reloadMs);
    const moving = Math.hypot(this.input.mx, this.input.my) > 0.1;
    this.moveAmt += ((moving && active ? 1 : 0) - this.moveAmt) * Math.min(1, dt * 10);
    this.walk += dt * 9 * this.moveAmt;
    this.updateEffects(dt);
    this.me.atk = performance.now() - this.swingAt < 200;
    // El búfer se ajusta poco a poco para que el cambio no se note.
    // Sube rápido si la red empeora y baja despacio: así los demás no cambian de ritmo a cada rato.
    this.interpDelay += (this.targetDelay - this.interpDelay) * Math.min(1, dt * (this.targetDelay > this.interpDelay ? 2 : 0.4));
    const use = this.input.consumeUse();
    // En la prueba de Nombre, "usar" detiene la aguja: se manda el ángulo que se ve en pantalla.
    if (use && this.nameTest) this.pendingName = needleAt(this.nameTest.el + (performance.now() - this.nameTest.at));
    // Cada tramo con la misma dirección y velocidad se junta en un comando; al cambiar, se envía el anterior.
    if (this.out && (this.out.mx !== mx || this.out.my !== my || this.out.sp !== sp)) this.sendInput(t, false);
    if (!this.out) this.out = { mx, my, dt: 0, sp };
    if (active) this.out.dt += mdt;
    const idle = mx === 0 && my === 0;
    const urgent = use || this.pendingCast || this.pendingFire || this.pendingSwap || this.pendingName !== null;
    if (urgent || t - this.lastSend >= (idle ? 50 : 15) || this.out.dt >= 0.1) this.sendInput(t, use);
    this.updateAbilityHud();
    this.cam.x += (this.me.x - this.cam.x) * Math.min(1, dt * 6);
    this.cam.y += (this.me.y - 20 - this.cam.y) * Math.min(1, dt * 6);
    const st = this.el.state;
    setData(st, 'x', String(Math.round(this.me.x))); setData(st, 'y', String(Math.round(this.me.y))); setData(st, 'hp', String(this.me.hp));
    // Cofre disponible más cercano: lo usan las pruebas E2E para guiar al jugador.
    let nc: { x: number; y: number; s: string } | null = null, nd = Infinity;
    for (const c of this.chests) { if (c.s === 'empty') continue; const d = Math.hypot(c.x - this.me.x, c.y - this.me.y); if (d < nd) { nd = d; nc = c; } }
    setData(st, 'chestX', nc ? String(Math.round(nc.x)) : ''); setData(st, 'chestY', nc ? String(Math.round(nc.y)) : '');
    setData(st, 'chestState', nc?.s ?? '');
    setData(st, 'interp', String(Math.round(this.interpDelay)));
    // Rival más cercano en pantalla y cargas: los usan las pruebas E2E para apuntar.
    const ne = this.nearestEnemy(Infinity), ns = ne ? this.screenOf(ne.x, ne.y - 20) : null;
    setData(st, 'enemySx', ns ? String(Math.round(ns.x)) : ''); setData(st, 'enemySy', ns ? String(Math.round(ns.y)) : '');
    setData(st, 'ammo', this.ammo.toFixed(2));
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
    this.shake = Math.max(this.shake, this.pve.shake); this.pve.shake = 0;
    this.shake *= Math.pow(0.002, dt);
  }

  private worldTransform(g: CanvasRenderingContext2D, k = 1) {
    const s = this.scale * this.dpr * k, sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    // Desplazamiento en píxeles enteros: el piso y los muros se copian sin suavizado sub-píxel.
    g.setTransform(s, 0, 0, s, Math.round((this.W / 2 - this.cam.x * this.scale + sx) * this.dpr * k), Math.round((this.H / 2 - this.cam.y * this.scale + sy) * this.dpr * k));
  }

  private draw(t: number) {
    const P = PERF ? [performance.now()] : null;
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

    P?.push(performance.now());
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
    map.monoliths.forEach((mo, i) => { if (mo.x > v.x0 - 100 && mo.x < v.x1 + 100 && mo.y > v.y0 && mo.y < v.y1 + 200) list.push({ y: mo.y + 40, draw: () => { this.blob(mo.x, mo.y + 40, 48); this.drawScene(this.monolithKey(i), mo.x, mo.y + 40, MONO_SIZE); } }); });
    const monsNow: { m: Mon; x: number; y: number }[] = [];
    for (const m of this.mons.values()) {
      const p = sampleBuffer(m.buf, now - this.interpDelay); if (!p) continue;
      if (p.x < v.x0 - 200 || p.x > v.x1 + 200 || p.y < v.y0 - 50 || p.y > v.y1 + 300) continue;
      monsNow.push({ m, x: p.x, y: p.y });
      list.push({ y: p.y, draw: () => this.drawMonster(m, p.x, p.y, now, sec) });
    }
    for (const p of this.portals) if (p.x > v.x0 - 160 && p.x < v.x1 + 160 && p.y > v.y0 && p.y < v.y1 + 320) list.push({ y: p.y - 6, draw: () => this.drawScene(`portal_${this.portalState(p)}`, p.x, p.y - 6, PORTAL_SIZE) });
    for (const { r, x, y } of remotesNow) list.push({ y, draw: () => this.drawActor({ x, y, ax: r.ax, ay: r.ay, id: r.id, me: false, color: teamColor(r.team, TEAM_OTHER), invis: r.invis, walk: r.walk, move: r.mv, foco: r.foco, swingAt: r.swingAt, shotAt: r.shotAt, castAt: r.castAt, hitAt: r.flash }, now) });
    const me = this.me, dying = !me.alive && now - this.deadAt < DIE_MS + 600;
    if ((me.alive || dying) && !me.extracted) {
      list.push({ y: me.y, draw: () => this.drawActor({ x: me.x, y: me.y, ax: me.ax, ay: me.ay, id: this.myId, me: true, color: teamColor(this.myTeam >= 0 ? this.myTeam : undefined, TEAM_ME), invis: this.invis, walk: this.walk, move: this.moveAmt, foco: this.build.focos[this.foco], swingAt: this.swingAt, shotAt: this.shotAt, castAt: this.lastCastAt, hitAt: this.hurtAt, dieAt: me.alive ? undefined : this.deadAt }, now) });
    }
    for (const c of this.chests) list.push({ y: c.y, draw: () => this.drawChest(c) });
    for (const r of this.remains) list.push({ y: r.y, draw: () => this.drawRemains(r.x, r.y) });
    list.sort((a, b) => a.y - b.y);
    g.lineCap = 'round'; g.lineJoin = 'round';
    this.drawGroundMarks(remotesNow, sec);
    this.drawTelegraphs(monsNow, now, sec);
    this.pve.drawGround(g);
    for (const o of list) o.draw();

    P?.push(performance.now());
    // 3. Luz: se recorta la oscuridad con cada fuente y luego se tiñe con su color.
    const lights: Light[] = [];
    if (this.me.alive && !this.me.extracted) lights.push({ x: this.me.x, y: this.me.y - 24, r: VISION_RADIUS, c: '255,190,110' });
    for (const d of this.decor) if (d.kind === 'sconce' && d.x > v.x0 - 220 && d.x < v.x1 + 220 && d.y > v.y0 - 220 && d.y < v.y1 + 220) lights.push({ x: d.x, y: d.y - 44, r: 220, c: '255,120,40', fl: d.ph });
    for (const p of this.portals) {
      const st = this.portalState(p);
      lights.push({ x: p.x, y: p.y - 6 + PORTAL_RING.dy, r: st === 'apagado' ? 130 : 300, c: st === 'colapsando' ? '255,50,90' : st === 'abierto' ? '160,100,255' : '90,70,140', a: 0.22 });
    }
    map.monoliths.forEach((mo, i) => {
      // La luz del monolito cuenta en qué va su ritual.
      const ph = this.rituals[i]?.ph;
      const L = ph === 'defensa' ? { r: 240, c: '190,110,255', a: 0.26 } : ph === 'reparar' ? { r: 220, c: '255,80,90', a: 0.2 + 0.1 * Math.sin(sec * 8) }
        : ph === 'completo' ? { r: 200, c: '255,210,120', a: 0.2 } : ph === 'roto' ? { r: 120, c: '150,60,70', a: 0.1 } : { r: 140, c: '190,110,220', a: 0.15 };
      lights.push({ x: mo.x, y: mo.y - 50, ...L });
    });
    for (const pr of map.props) if (pr.kind === 'hito' || pr.kind === 'brasero') lights.push({ x: pr.x, y: pr.y - 20, r: pr.kind === 'hito' ? 260 : 170, c: '255,130,40', fl: pr.x * 0.01 });
    for (const c of this.chests) if (c.s !== 'empty') lights.push({ x: c.x, y: c.y - 30, r: c.s === 'open' ? 150 : 100, c: CHEST_ART[c.k ?? 'forja'].rgb, a: 0.14 });
    const vis = lights.filter((L) => L.x + L.r > v.x0 && L.x - L.r < v.x1 && L.y + L.r > v.y0 && L.y - L.r < v.y1);
    const d = this.dark.getContext('2d')!;
    d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = 'source-over';
    d.fillStyle = 'rgba(9,4,16,.94)'; d.fillRect(0, 0, this.dark.width, this.dark.height);
    this.worldTransform(d, this.darkK); d.globalCompositeOperation = 'destination-out';
    for (const L of vis) {
      const r = L.r * (L.fl != null ? 1 + Math.sin(sec * 9 + L.fl) * 0.04 + Math.sin(sec * 17 + L.fl) * 0.03 : 1);
      d.drawImage(HOLE(), L.x - r, L.y - r, r * 2, r * 2);
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.dark, 0, 0, g.canvas.width, g.canvas.height);
    this.worldTransform(g); g.globalCompositeOperation = 'lighter';
    for (const L of vis) {
      if (L.r >= VISION_RADIUS) continue; // la visión propia no tiñe
      const r = L.r * 0.85;
      g.drawImage(TINT(L.c, L.a ?? 0.3), L.x - r, L.y - r, r * 2, r * 2);
    }

    P?.push(performance.now());
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
    const pdt = Math.min(0.05, (now - this.pveT) / 1000); this.pveT = now;
    this.pve.draw(g, sec, pdt);
    this.drawAimIndicator();

    P?.push(performance.now());
    // 5. Interfaz dentro del mundo: nombres, daño, indicaciones y el colapso final.
    // Nombre y vida forman un bloque; si varios se enciman, suben los de atrás (con una línea a su dueño)
    // y se deslizan suave para que no brinquen cuando la gente se mueve.
    const labels = remotesNow.map(({ r, x, y }) => {
      const ally = !this.isEnemy(r), tc = teamColor(r.team, '#e2c8ff'), lab = labelSprite(r.name, ally ? tc : '#e2c8ff');
      return { r, x, y, ally, tc, lab };
    });
    const lift = stackLabels(labels.map(({ r, x, y, lab }) => ({ id: r.id, x, y: y - 94, w: Math.max(46, lab.width / 2), h: 23 })));
    for (const { r, x, y, ally, tc, lab } of labels) {
      // Compañeros: vida y nombre en el color del equipo. Rivales: vida roja.
      r.labelDy = (r.labelDy ?? 0) + ((lift.get(r.id) ?? 0) - (r.labelDy ?? 0)) * Math.min(1, pdt * 14);
      const dy = Math.round(r.labelDy);
      if (dy < -6) { g.strokeStyle = ally ? tc : 'rgba(226,200,255,.6)'; g.globalAlpha = 0.55; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y - 71 + dy); g.lineTo(x, y - 74); g.stroke(); g.globalAlpha = 1; }
      g.fillStyle = 'rgba(20,10,22,.8)'; g.fillRect(x - 23, y - 79 + dy, 46, 8);
      g.fillStyle = ally ? tc : '#ff6b6b'; g.fillRect(x - 22, y - 78 + dy, 44 * (r.hp / 100), 6);
      g.drawImage(lab, x - lab.width / 4, y - 94 + dy, lab.width / 2, lab.height / 2);
    }
    // Rivales revelados (Escuchar al Viento, la Resonancia o el portal): marca roja que se ve aunque estén en la oscuridad.
    for (const { r, x, y } of remotesNow) {
      const dy = Math.round(r.labelDy ?? 0);
      if (r.mark) this.drawResonanceMark(x, y - 112 + dy, t);
      if (!r.rev) continue;
      const pulse = 1 + Math.sin(t / 120) * 0.08;
      g.strokeStyle = 'rgba(255,90,90,.9)'; g.lineWidth = 3; g.beginPath(); g.ellipse(x, y, 30 * pulse, 12 * pulse, 0, 0, 6.283); g.stroke();
      g.fillStyle = '#ff5a5a'; g.beginPath(); g.moveTo(x, y - 92 + dy); g.lineTo(x - 9, y - 106 + dy); g.lineTo(x + 9, y - 106 + dy); g.closePath(); g.fill();
    }
    this.drawRituals(sec);
    this.drawAmmo();
    this.drawFloaters();
    this.drawPrompt(t);
    if (this.collapseR != null) {
      const lp = this.portals[1];
      if (lp) { g.strokeStyle = 'rgba(255,60,120,.6)'; g.lineWidth = 8; g.beginPath(); g.arc(lp.x, lp.y, this.collapseR, 0, Math.PI * 2); g.stroke(); }
    }

    P?.push(performance.now());
    // 6. Tono violeta, viñeta y destello rojo al recibir daño.
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Tono violeta y viñeta precalculados al cambiar el tamaño (una sola imagen estirada).
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.vignette, 0, 0, this.W, this.H);
    this.drawAllyArrows(remotesNow);
    this.drawNameTest(now);
    const hk = 1 - (now - this.hurtAt) / 400;
    if (hk > 0) {
      const hg = g.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.25, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.7);
      hg.addColorStop(0, 'rgba(200,20,40,0)'); hg.addColorStop(1, `rgba(200,20,40,${0.45 * hk})`); g.fillStyle = hg; g.fillRect(0, 0, this.W, this.H);
    }
    this.worldTransform(g);
    if (P) { P.push(performance.now()); const w = window as any; w.__cgPerf ??= []; w.__cgPerf.push(P.slice(1).map((x, i) => x - P[i])); if (w.__cgPerf.length > 300) w.__cgPerf.shift(); }
  }

  /** Ojo de la Resonancia sobre un rival marcado. */
  private drawResonanceMark(x: number, y: number, t: number) {
    const g = this.ctx, k = 1 + Math.sin(t / 140) * 0.1;
    g.save(); g.translate(x, y); g.scale(k, k);
    g.lineWidth = 3; g.strokeStyle = INK; g.fillStyle = '#ff5a5a';
    g.beginPath(); g.moveTo(-14, 0); g.quadraticCurveTo(0, -12, 14, 0); g.quadraticCurveTo(0, 12, -14, 0); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ffd36a'; g.beginPath(); g.arc(0, 0, 4.5, 0, 6.283); g.fill(); g.stroke();
    g.restore();
  }

  /** Flechas en el borde de la pantalla hacia los compañeros (y rivales marcados) que no se ven. */
  private drawAllyArrows(remotes: { r: Remote; x: number; y: number }[]) {
    const g = this.ctx, m = 34;
    for (const { r, x, y } of remotes) {
      if (this.isEnemy(r) && !r.mark) continue;
      const s = this.screenOf(x, y - 30);
      if (s.x > m && s.x < this.W - m && s.y > m && s.y < this.H - m) continue;
      const cx = this.W / 2, cy = this.H / 2, dx = s.x - cx, dy = s.y - cy;
      const k = Math.min((this.W / 2 - m) / Math.abs(dx || 1e-6), (this.H / 2 - m) / Math.abs(dy || 1e-6));
      const ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx), c = this.isEnemy(r) ? '#ff5a5a' : teamColor(r.team, '#fff');
      g.save(); g.translate(ex, ey); g.rotate(a);
      g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -10); g.lineTo(-4, 0); g.lineTo(-8, 10); g.closePath();
      g.fillStyle = c; g.strokeStyle = INK; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke(); g.fill();
      g.restore();
      g.font = '700 12px "Cabin Sketch", "Alegreya Sans", sans-serif'; g.textAlign = 'center';
      const lx = ex - Math.cos(a) * 26, ly = ey - Math.sin(a) * 22 + 4;
      g.fillStyle = INK; g.fillText(r.name, lx + 1, ly + 1); g.fillStyle = c; g.fillText(r.name, lx, ly);
    }
  }

  /** Panel de compañeros bajo la vida: nombre, vida y si cayó o escapó. */
  private renderAllies(allies: { id: string; name: string; hp: number; alive: boolean; extracted: boolean }[]) {
    const box = this.root.querySelector<HTMLElement>('#aliados'); if (!box) return;
    const color = teamColor(this.myTeam >= 0 ? this.myTeam : undefined, TEAM_ME);
    for (const a of allies) {
      let row = this.allyRows.get(a.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'aliado'; row.style.setProperty('--team', color);
        row.innerHTML = '<span></span><div class="ali-hp"><i></i></div>';
        row.firstElementChild!.textContent = a.name;
        box.append(row); this.allyRows.set(a.id, row);
      }
      const estado = a.extracted ? 'escapo' : a.alive ? 'vivo' : 'cayo';
      if (row.dataset.estado !== estado) row.dataset.estado = estado;
      row.querySelector<HTMLElement>('i')!.style.width = `${a.alive ? a.hp : 0}%`;
    }
  }

  /** Estado visual del portal: el último portal se ve colapsando durante El Desnombrar. */
  private portalState(p: { x: number; y: number; open: boolean; u?: number }): 'apagado' | 'abierto' | 'colapsando' {
    if (!p.open) return 'apagado';
    // Inestable por la Resonancia: parpadea entre abierto y colapsando, más rápido cuanto más cerca de moverse.
    if ((p.u ?? 0) > 0.3) return Math.sin(performance.now() / (220 - 160 * (p.u ?? 0))) > 0 ? 'colapsando' : 'abierto';
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

  /** Rival visible más cercano dentro de `maxDist` (para el auto-apuntado del toque rápido). */
  private nearestEnemy(maxDist: number) {
    let best: { x: number; y: number } | null = null, bd = maxDist;
    for (const r of this.remotes.values()) {
      if (!this.isEnemy(r)) continue;
      const p = this.remotePos(r.id); if (!p) continue;
      const d = Math.hypot(p.x - this.me.x, p.y - this.me.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Rival: de otro equipo (o cualquiera si la partida no tiene equipos). */
  private isEnemy(r: Remote) { return this.myTeam < 0 || r.team == null || r.team !== this.myTeam; }

  /** Forma y alcance de lo que se apunta: el básico del Foco en la mano o la habilidad. */
  private shapeOf(slot: AimSlot): Shape {
    return slot === 'B' ? FOCOS[this.build.focos[this.foco]].basic.shape : abilityFor(this.build, this.foco, slot).shape;
  }

  /**
   * Punto apuntado. PC: el cursor. Táctil: la dirección del arrastre (en zonas, la distancia también);
   * un toque rápido apunta al rival más cercano en alcance, o hacia donde mira el personaje.
   */
  private aimPoint(slot: AimSlot, drag: Drag | null, quick: boolean) {
    const s = this.shapeOf(slot), range = Math.max(1, s.range) * TILE, me = this.me;
    if (s.type === 'propio') return { x: me.x, y: me.y };
    if (drag && drag.len > 18) {
      const k = s.type === 'zona' ? Math.min(1, drag.len / 90) : 1;
      return { x: me.x + (drag.dx / drag.len) * range * k, y: me.y + (drag.dy / drag.len) * range * k };
    }
    if (!this.input.touch && this.input.mouse && !quick) {
      const w = this.worldOf(this.input.mouse.x, this.input.mouse.y); return { x: w.x, y: w.y + 22 };
    }
    const e = this.nearestEnemy(range + TILE);
    if (e) return { x: e.x, y: e.y };
    return { x: me.x + me.ax * range * 0.8, y: me.y + me.ay * range * 0.8 };
  }

  private handleCombatInput(active: boolean) {
    const ev = this.input.consumeEvents(), now = performance.now();
    if (!active) return;
    if (ev.swap && now >= this.swapUntil) {
      this.foco = this.foco === 0 ? 1 : 0; this.swapUntil = now + SWAP_MS; this.swapAt = now; this.pendingSwap = true;
      this.nextShotAt = Math.max(this.nextShotAt, now + 250);
    }
    for (const r of ev.releases) {
      const p = this.aimPoint(r.slot, r.drag, r.quick);
      if (r.slot === 'B') this.tryFire(p, now); else this.tryCast(r.slot, p, now);
    }
  }

  /** Básico apuntado: se predice la carga, la animación y el proyectil; el servidor decide el daño. */
  private tryFire(p: { x: number; y: number }, now: number) {
    const foco = FOCOS[this.build.focos[this.foco]], b = foco.basic;
    if (this.ammo < 1 || now < this.nextShotAt) { this.ammoDeny = now; return; }
    this.ammo -= 1; this.nextShotAt = now + b.intervalMs; this.lastFireAt = now;
    const n = ++this.shotN;
    this.pendingFire = { x: Math.round(p.x), y: Math.round(p.y), n };
    const aim = clampAim(this.me, p, b.shape.range);
    this.me.ax = aim.dirX; this.me.ay = aim.dirY;
    if (b.delivery === 'proyectil') { this.shotAt = now; this.predictProjectiles(n, aim.dirX, aim.dirY, b.projectile!, b.shape.range, foco.id); }
    else { this.swingAt = now; this.addFx(b.shape.type === 'linea' ? 'estocada' : 'arco', this.me.x, this.me.y, { dx: aim.dirX, dy: aim.dirY, r: b.shape.range * TILE, ang: b.shape.angle, w: (b.shape.width ?? 0) * TILE, rgb: foco.rgb }); }
  }

  /** Habilidad: se predice la recarga y el efecto (embestida y parpadeo incluidos); el servidor confirma. */
  private tryCast(slot: Slot, p: { x: number; y: number }, now: number) {
    const ab = abilityFor(this.build, this.foco, slot);
    if (now < this.gcdUntil || now < (this.cdById[ab.id] ?? 0)) return;
    const s = ab.shape, aim = clampAim(this.me, p, s.range || 1);
    this.cdById[ab.id] = now + ab.cd * 1000; this.castAt[ab.id] = now; this.gcdUntil = now + GCD_MS;
    const n = ++this.shotN;
    this.pendingCast = { slot, x: Math.round(p.x), y: Math.round(p.y), n };
    if (s.type !== 'propio') { this.me.ax = aim.dirX; this.me.ay = aim.dirY; }
    if (s.type === 'propio' && ab.effect.knock) this.swingAt = now; else if (ab.delivery !== 'embestida') this.lastCastAt = now;
    const fx = { dx: aim.dirX, dy: aim.dirY, rgb: ab.rgb };
    switch (ab.delivery) {
      case 'embestida':
        this.dashLeft = DASH_S; this.dashDir = { x: aim.dirX, y: aim.dirY }; this.dashMul = dashMulFor(s.range);
        this.addFx(ab.id, this.me.x, this.me.y, { ...fx, r: s.range * TILE });
        break;
      case 'parpadeo': {
        const from = { x: this.me.x, y: this.me.y }, to = blinkTarget(this.map, this.pred, p, s.range);
        this.pred = { x: to.x, y: to.y }; this.err = { x: 0, y: 0 }; this.me.x = to.x; this.me.y = to.y;
        this.addFx(ab.id, from.x, from.y, { ...fx, x2: to.x, y2: to.y });
        break;
      }
      case 'proyectil':
        this.predictProjectiles(n, aim.dirX, aim.dirY, ab.projectile!, s.range, ab.id);
        break;
      case 'instante': {
        const c = s.type === 'zona' ? { x: aim.x, y: aim.y } : { x: this.me.x, y: this.me.y };
        this.addFx(ab.id, c.x, c.y, { ...fx, r: (s.type === 'cono' ? s.range : s.radius ?? 0) * TILE, ang: s.angle });
        break;
      }
    }
  }

  /** Proyectiles propios dibujados al instante; el servidor decide si tocan a alguien. */
  private predictProjectiles(n: number, dirX: number, dirY: number, def: ProjectileDef, rangeTiles: number, kind: string) {
    const now = performance.now();
    for (const [dx, dy] of fanDirections(dirX, dirY, def.count ?? 1, ((def.spreadDeg ?? 0) * Math.PI) / 180)) {
      this.myShots.push({ n, kind, x0: this.me.x + dx * 20, y0: this.me.y - 22 + dy * 20, dx, dy, speed: def.speed, radius: def.radius, range: rangeTiles * TILE, t0: now, seen: false, dead: false, pierce: !!def.pierce });
    }
  }

  private addFx(kind: string, x: number, y: number, o: Partial<Fx> = {}) {
    const dur = kind === 'arco' || kind === 'estocada' ? 240 : kind === 'escuchar' || kind === 'portal-shift' ? 900 : 520;
    this.fxs.push({ kind, x, y, ...o, t0: performance.now(), dur });
    if (this.fxs.length > 80) this.fxs.shift();
  }

  /** Ataque básico de otro jugador: la animación (sus proyectiles llegan en la instantánea). */
  private remoteAttack(r: Remote, o: { foco?: string }) {
    const foco = FOCOS[o.foco ?? 'gemelas'];
    if (foco?.melee) r.swingAt = performance.now(); else r.shotAt = performance.now();
  }

  /** Estado de combate que confirma el servidor. */
  private syncCombat(m: any, now: number) {
    const you = m.you;
    if (you.build) this.build = you.build;
    if (now - this.swapAt > 700 && (you.foco === 0 || you.foco === 1)) this.foco = you.foco;
    this.slowMul = you.slow ?? 1; this.rooted = !!you.root; this.invis = !!you.invis; this.revealing = !!you.reveal;
    // Munición: la del servidor manda, salvo justo después de un disparo predicho.
    if (typeof you.ammo === 'number' && now - this.lastFireAt > 350) { this.ammo = you.ammo; this.nextShotAt = Math.max(this.nextShotAt, now + (you.nextShot ?? 0)); }
    if (you.cds) for (const slot of ['Q', 'E', 'R'] as Slot[]) {
      const id = abilityFor(this.build, this.foco, slot).id, srv = now + you.cds[slot];
      // Si el servidor rechazó un lanzamiento predicho, la recarga vuelve a su valor real.
      if (srv > (this.cdById[id] ?? 0) + 80 || now - (this.castAt[id] ?? -1e9) > 700) this.cdById[id] = srv;
    }
    const seen = new Set<number>(), mine = new Set<number>();
    for (const p of m.projectiles ?? []) {
      if (p.o === this.myId) { if (p.n != null) mine.add(p.n); continue; }
      this.projectiles.set(p.id, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, t: now, k: p.k, r: p.r }); seen.add(p.id);
    }
    for (const id of this.projectiles.keys()) if (!seen.has(id)) this.projectiles.delete(id);
    // Un disparo propio que el servidor ya mostró y luego quitó, chocó con algo.
    for (const s of this.myShots) { if (mine.has(s.n)) s.seen = true; else if (s.seen && !s.pierce) s.dead = true; }
  }

  /** Marcas en el piso: aliados, ralentizados e inmovilizados. */
  private drawGroundMarks(remotes: { r: Remote; x: number; y: number }[], sec: number) {
    const g = this.ctx;
    const ring = (x: number, y: number, c: string, rx = 26) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.ellipse(x, y + 2, rx, rx * 0.38, 0, 0, 6.283); g.stroke(); };
    for (const { r, x, y } of remotes) {
      if (!this.isEnemy(r)) { g.globalAlpha = 0.55; ring(x, y, teamColor(r.team, '#fff'), 24); g.globalAlpha = 1; }
      if (r.slow) ring(x, y, 'rgba(140,210,255,.75)');
      if (r.root) { g.setLineDash([6, 5]); g.lineDashOffset = -sec * 10; ring(x, y, 'rgba(120,230,140,.9)', 30); g.setLineDash([]); }
    }
    if (this.slowMul < 1 && !this.rooted) ring(this.me.x, this.me.y, 'rgba(140,210,255,.75)');
    if (this.rooted) { g.setLineDash([6, 5]); ring(this.me.x, this.me.y, 'rgba(120,230,140,.9)', 30); g.setLineDash([]); }
    this.drawResonanceRings(sec);
  }

  /**
   * Anillos de Resonancia alrededor de los portales abiertos (círculos reales: son las distancias que
   * mide el servidor). Violeta normal; rojo si tu equipo está marcado o el portal se está volviendo inestable.
   */
  private drawResonanceRings(sec: number) {
    if (!this.res) return;
    const g = this.ctx, mine = this.res.m;
    for (const p of this.portals) {
      if (!p.open) continue;
      const u = p.u ?? 0, hot = mine || u > 0;
      const rgb = hot ? '255,80,90' : '190,150,255', flick = u > 0 ? 0.7 + 0.3 * Math.sin(sec * (8 + 20 * u)) : 1;
      g.lineWidth = 4; g.setLineDash([18, 12]); g.lineDashOffset = -sec * 14;
      g.strokeStyle = `rgba(${rgb},${0.5 * flick})`; g.beginPath(); g.arc(p.x, p.y, RESONANCE.nearRadius, 0, 6.283); g.stroke();
      g.lineWidth = 3; g.setLineDash([6, 14]); g.lineDashOffset = sec * 8;
      g.strokeStyle = `rgba(${rgb},${0.28 * flick})`; g.beginPath(); g.arc(p.x, p.y, RESONANCE.farRadius, 0, 6.283); g.stroke();
    }
    g.setLineDash([]); g.lineDashOffset = 0;
    // Tu equipo marcado: halo rojo que late bajo tus pies.
    if (mine && this.me.alive && !this.me.extracted) {
      const k = 1 + Math.sin(sec * 6) * 0.08;
      g.strokeStyle = 'rgba(255,70,80,.85)'; g.lineWidth = 4; g.beginPath(); g.ellipse(this.me.x, this.me.y + 2, 34 * k, 13 * k, 0, 0, 6.283); g.stroke();
    }
  }

  /** Color de magia (r,g,b) de un proyectil o efecto por su id. */
  private rgbOf(kind: string): string {
    return FOCOS[kind]?.rgb ?? NOMBRES[kind]?.rgb ?? Object.values(FOCOS).find((f) => f.insc.id === kind)?.insc.rgb ?? '255,200,110';
  }

  private drawShot(x: number, y: number, vx: number, vy: number, radius: number, kind: string, art: Sprites) {
    const g = this.ctx, rgb = this.rgbOf(kind), sp = Math.hypot(vx, vy) || 1;
    if (kind === 'fractura') {
      // Grieta ancha que avanza por el piso.
      g.fillStyle = `rgba(${rgb},.55)`; g.beginPath(); g.ellipse(x, y + 22, radius * 1.2, radius * 0.5, Math.atan2(vy, vx), 0, 6.283); g.fill();
      return;
    }
    const s = Math.max(22, radius * 3);
    g.globalAlpha = 0.95; g.drawImage(art.dot.white, x - s / 2, y - s / 2, s, s);
    g.globalAlpha = 1; g.strokeStyle = `rgba(${rgb},.85)`; g.lineWidth = Math.max(3, radius * 0.6); g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - (vx / sp) * radius * 4, y - (vy / sp) * radius * 4); g.stroke();
    g.fillStyle = `rgb(${rgb})`; g.beginPath(); g.arc(x, y, Math.max(4, radius * 0.55), 0, 6.283); g.fill();
  }

  /** Proyectiles y efectos de habilidades (en modo aditivo, brillan sobre la oscuridad). */
  private drawCombatFx(now: number, art: Sprites) {
    const g = this.ctx;
    for (const p of this.projectiles.values()) {
      const k = Math.min(0.12, (now - p.t) / 1000);
      this.drawShot(p.x + p.vx * k, p.y + p.vy * k, p.vx, p.vy, p.r ?? 8, p.k ?? '', art);
    }
    // Disparos propios predichos: avanzan solos hasta su alcance o el primer muro.
    this.myShots = this.myShots.filter((s) => !s.dead && (now - s.t0) / 1000 * s.speed < s.range);
    for (const s of this.myShots) {
      const d = ((now - s.t0) / 1000) * s.speed, x = s.x0 + s.dx * d, y = s.y0 + s.dy * d;
      if (solidAt(this.map, x, y + 20, true)) { s.dead = true; continue; }
      this.drawShot(x, y, s.dx * s.speed, s.dy * s.speed, s.radius, s.kind, art);
    }
    this.fxs = this.fxs.filter((f) => now - f.t0 < f.dur);
    for (const f of this.fxs) {
      const k = (now - f.t0) / f.dur, a = 1 - k, rgb = f.rgb ?? this.rgbOf(f.kind);
      const def = NOMBRES[f.kind] ?? Object.values(FOCOS).find((x) => x.insc.id === f.kind)?.insc;
      const type = f.kind === 'arco' ? 'cono' : def?.shape.type;
      if (f.kind === 'portal-shift') {
        // Portal relocalizado: destello violeta que se abre donde estaba y donde aparece.
        const R = 60 + 220 * k;
        g.strokeStyle = `rgba(200,150,255,${a * 0.9})`; g.lineWidth = 10 * a + 2;
        g.beginPath(); g.arc(f.x, f.y - 60, R, 0, 6.283); g.stroke();
        g.globalAlpha = a; g.drawImage(art.dot.violet, f.x - R, f.y - 60 - R, R * 2, R * 2); g.globalAlpha = 1;
      } else if (f.kind === 'estocada') {
        // Estocada: una franja recta que sale y se desvanece.
        const L = (f.r ?? 150) * Math.min(1, k * 2.5), w = Math.max(14, f.w ?? 30);
        g.strokeStyle = `rgba(${rgb},${a * 0.85})`; g.lineWidth = w * a + 2; g.lineCap = 'round';
        g.beginPath(); g.moveTo(f.x, f.y - 16); g.lineTo(f.x + (f.dx ?? 0) * L, f.y - 16 + (f.dy ?? 0) * L); g.stroke();
      } else if (def?.delivery === 'parpadeo' && f.x2 != null && f.y2 != null) {
        for (const [px, py] of [[f.x, f.y], [f.x2, f.y2]]) { g.globalAlpha = a; g.drawImage(art.dot.violet, px - 50, py - 70, 100, 100); }
        g.globalAlpha = 1;
      } else if (def?.delivery === 'embestida') {
        g.strokeStyle = `rgba(${rgb},${a * 0.8})`; g.lineWidth = 16 * a + 2; g.lineCap = 'round';
        const L = (f.r ?? 4 * TILE) * Math.min(1, k * 1.6);
        g.beginPath(); g.moveTo(f.x, f.y - 20); g.lineTo(f.x + (f.dx ?? 0) * L, f.y - 20 + (f.dy ?? 0) * L); g.stroke();
      } else if (type === 'cono') {
        const a0 = Math.atan2(f.dy ?? 0, f.dx ?? 1), half = ((f.ang ?? 90) / 2) * (Math.PI / 180), R = (f.r ?? 100) * (0.5 + 0.5 * Math.min(1, k * 2));
        g.fillStyle = `rgba(${rgb},${a * 0.35})`; g.strokeStyle = `rgba(${rgb},${a * 0.9})`; g.lineWidth = 5 * a + 1;
        g.beginPath(); g.moveTo(f.x, f.y - 10); g.arc(f.x, f.y - 10, R, a0 - half, a0 + half); g.closePath(); g.fill();
        g.beginPath(); g.arc(f.x, f.y - 10, R, a0 - half, a0 + half); g.stroke();
      } else if (type === 'zona' || type === 'propio') {
        const R = (f.r || 80) * (type === 'propio' ? 0.35 + 0.65 * k : 1);
        g.strokeStyle = `rgba(${rgb},${a * 0.9})`; g.lineWidth = 8 * a + 2;
        g.beginPath(); g.ellipse(f.x, f.y, R, R * 0.6, 0, 0, 6.283); g.stroke();
        if (type === 'zona') { g.fillStyle = `rgba(${rgb},${a * 0.25})`; g.fill(); }
      } else {
        g.globalAlpha = a; g.drawImage(art.dot.gold, f.x + (f.dx ?? 0) * 30 - 30, f.y - 50 + (f.dy ?? 0) * 30, 60, 60); g.globalAlpha = 1;
      }
    }
  }

  /**
   * Indicador en el piso mientras se mantiene el apuntado (estilo Brawl Stars): línea, cono, zona,
   * círculo propio o salto, con el alcance real. En rojo si aún no se puede usar.
   */
  private drawAimIndicator() {
    const h = this.input.hold; if (!h || !this.me.alive || this.me.extracted) return;
    if (this.input.touch && (!h.drag || h.drag.len < 18)) return; // en táctil aparece al arrastrar
    const s = this.shapeOf(h.slot), g = this.ctx, me = this.me, now = performance.now();
    const p = this.aimPoint(h.slot, h.drag, false), aim = clampAim(me, p, s.range || 1);
    let ready = true;
    if (h.slot === 'B') ready = this.ammo >= 1;
    else { const ab = abilityFor(this.build, this.foco, h.slot); ready = now >= (this.cdById[ab.id] ?? 0); }
    const col = ready ? '255,255,255' : '255,90,90';
    g.save();
    g.fillStyle = `rgba(${col},.16)`; g.strokeStyle = `rgba(${col},.8)`; g.lineWidth = 3; g.lineJoin = 'round';
    const range = s.range * TILE, a0 = Math.atan2(aim.dirY, aim.dirX);
    if (s.type === 'linea') {
      const w = Math.max(16, (s.width ?? 0.4) * TILE);
      g.translate(me.x, me.y); g.rotate(a0);
      g.beginPath(); g.roundRect(0, -w / 2, range, w, w / 2); g.fill(); g.stroke();
      g.strokeStyle = `rgba(${col},.55)`;
      for (let x = 40; x < range - 10; x += 46) { g.beginPath(); g.moveTo(x, -w * 0.28); g.lineTo(x + 10, 0); g.lineTo(x, w * 0.28); g.stroke(); }
    } else if (s.type === 'cono') {
      const half = ((s.angle ?? 90) / 2) * (Math.PI / 180);
      g.beginPath(); g.moveTo(me.x, me.y); g.arc(me.x, me.y, range, a0 - half, a0 + half); g.closePath(); g.fill(); g.stroke();
    } else if (s.type === 'zona') {
      g.setLineDash([10, 8]); g.strokeStyle = `rgba(${col},.4)`; g.beginPath(); g.arc(me.x, me.y, range, 0, 6.283); g.stroke(); g.setLineDash([]);
      g.strokeStyle = `rgba(${col},.85)`; g.beginPath(); g.arc(aim.x, aim.y, (s.radius ?? 1) * TILE, 0, 6.283); g.fill(); g.stroke();
    } else if (s.type === 'propio') {
      g.beginPath(); g.arc(me.x, me.y, Math.max(0.8, s.radius ?? 1) * TILE, 0, 6.283); g.fill(); g.stroke();
    } else {
      const ab = h.slot === 'B' ? null : abilityFor(this.build, this.foco, h.slot);
      const to = ab?.delivery === 'parpadeo' ? blinkTarget(this.map, this.pred, p, s.range) : { x: me.x + aim.dirX * range, y: me.y + aim.dirY * range };
      g.lineWidth = Math.max(16, PLAYER.radius * 1.2); g.lineCap = 'round'; g.strokeStyle = `rgba(${col},.28)`;
      g.beginPath(); g.moveTo(me.x, me.y); g.lineTo(to.x, to.y); g.stroke();
      g.lineWidth = 3; g.strokeStyle = `rgba(${col},.85)`; g.beginPath(); g.arc(to.x, to.y, PLAYER.radius + 4, 0, 6.283); g.fill(); g.stroke();
    }
    g.restore();
  }

  /** Barra de 3 cargas bajo el personaje propio; tiembla en rojo si se intenta disparar sin munición. */
  private drawAmmo() {
    if (!this.me.alive || this.me.extracted) return;
    const g = this.ctx, now = performance.now(), deny = now - this.ammoDeny < 300;
    const w = 15, gap = 3, total = AMMO_MAX * w + (AMMO_MAX - 1) * gap;
    const x0 = this.me.x - total / 2 + (deny ? Math.sin(now / 20) * 2 : 0), y = this.me.y + 14;
    g.fillStyle = INK; g.beginPath(); g.roundRect(x0 - 3, y - 3, total + 6, 11, 4); g.fill();
    for (let i = 0; i < AMMO_MAX; i++) {
      const fill = Math.max(0, Math.min(1, this.ammo - i)), x = x0 + i * (w + gap);
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, w, 5);
      g.fillStyle = deny ? '#ff5a5a' : fill >= 1 ? '#ffb347' : '#a8743a'; g.fillRect(x, y, w * fill, 5);
    }
  }

  /** Barra de habilidades (PC) y botones táctiles: nombre, recarga y Foco en la mano. */
  private updateAbilityHud() {
    const now = performance.now();
    for (const el of this.abEls) {
      const slot = el.dataset.slot as Slot | 'S';
      let name: string, left: number, total: number, id: string;
      if (slot === 'S') { const f = FOCOS[this.build.focos[this.foco]]; name = f.name; id = f.id; left = this.swapUntil - now; total = SWAP_MS; }
      else { const ab = abilityFor(this.build, this.foco, slot); name = ab.name; id = ab.id; left = Math.max((this.cdById[ab.id] ?? 0) - now, this.gcdUntil - now); total = Math.max(ab.cd * 1000, GCD_MS); }
      const nm = el.querySelector<HTMLElement>('.ab-name'); if (nm) setText(nm, name);
      if (el.title !== name) el.title = name;
      // El ícono de tiza sale de la hoja de estilos según la habilidad o el Foco.
      if (el.dataset.ability !== id) el.dataset.ability = id;
      const cd = el.querySelector<HTMLElement>('.ab-cd');
      if (cd) {
        const p = left > 0 ? Math.min(1, left / total) : 0;
        // Solo cambia cuando avanza al menos un 1 %: así no se repinta el botón en cada cuadro.
        setStyle(cd, '--p', (Math.round(p * 100) / 100).toString());
        setText(cd, left > 400 ? String(Math.ceil(left / 1000)) : '');
      }
      setData(el, 'ready', String(left <= 0));
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
  /** Imagen del monolito según su ritual. */
  private monolithKey(i: number) {
    const ph = this.rituals[i]?.ph;
    return ph === 'defensa' || ph === 'reparar' ? 'monolito_ritual' : ph === 'completo' ? 'monolito_completado' : 'monolito_dormido';
  }

  /** Un Desnombrado con la pose que toca según su estado (preparar, golpear o esperar). */
  private drawMonster(m: Mon, x: number, y: number, now: number, t: number) {
    const g = this.ctx, S = MONSTER_SCALE[m.k], since = now - m.strikeAt, ph = m.id * 1.7;
    monShadow(g, x, y, (m.k === 'coloso' ? 80 : m.k === 'errante' ? 48 : 30) * S);
    const at = (px: number, py: number, alpha: number, fn: () => void) => { g.save(); g.globalAlpha = alpha; g.translate(px, py); g.scale(S * (m.k === 'coloso' ? 1 : m.face), S); fn(); g.restore(); };
    if (m.k === 'errante') {
      const st = Math.sin(t * 2.4 + ph);
      const P: ErrantePose = { sx: 1 - st * 0.02, sy: 1 + st * 0.03, lean: 0, aL: -0.15 + Math.sin(t * 2 + ph) * 0.15, aR: -0.15 + Math.sin(t * 2 + 1 + ph) * 0.15, gl: 0.45 + 0.25 * Math.sin(t * 6 + ph) };
      if (m.st === 'w') { const e = m.p * m.p; Object.assign(P, { sy: 1 - 0.17 * e, sx: 1 + 0.13 * e, lean: -0.2 * e, aL: -0.2 - 1.1 * e, aR: -0.2 - 1.3 * e, gl: 0.5 + 0.5 * m.p }); }
      else if (since < 260) {
        const u = since / 260;
        Object.assign(P, { sx: 1 + 0.12 * (1 - u), sy: 1 - 0.12 * (1 - u), lean: 0.26 * (1 - u), aR: -1.6 + 2.8 * Math.min(1, u * 3), aL: -1.4 + 2.6 * Math.min(1, Math.max(0, u * 3 - 0.8)), gl: 1 });
        // Estela del salto: copias tenues donde estaba hace un instante.
        for (const [lag, a] of [[90, 0.22], [45, 0.32]]) { const q = sampleBuffer(m.buf, now - this.interpDelay - lag); if (q) at(q.x, q.y, a * (1 - u), () => drawErrante(g, t, P)); }
      }
      at(x, y, 1, () => drawErrante(g, t, P));
    } else if (m.k === 'susurrante') {
      const P: SusurrantePose = { rise: 0, flare: 1, charge: 0, mouth: 0, spin: t * 0.7 + ph };
      if (m.st === 'w') Object.assign(P, { rise: 18 * m.p, flare: 1 + 0.55 * m.p, charge: m.p, spin: P.spin + m.p * m.p * 6 });
      else if (since < 900) { const u = since / 900; Object.assign(P, { rise: 18 * Math.max(0, 1 - u * 1.5), flare: 1 + 0.55 * Math.max(0, 1 - u * 2.5), charge: Math.max(0, 1 - u * 3), mouth: Math.max(0, 1 - u * 1.6) }); }
      at(x, y, 1, () => drawSusurrante(g, t, P));
    } else {
      const br = Math.sin(t * 1.4 + ph) * 2;
      const P: ColosoPose = { br, aL: 0.24 + br * 0.02, aR: 0.24 + br * 0.02, gl: 0, chain: 0 };
      if (m.st === 'w') { const e = m.p * m.p * (3 - 2 * m.p); Object.assign(P, { aL: 0.24 - 2.9 * e, aR: 0.24 - 2.9 * e, br: br + 8 * e, gl: e, chain: -e }); }
      else if (since < 700) {
        const u = since / 700;
        if (u < 0.1) { const a = -2.66 + 3.3 * (u / 0.1); Object.assign(P, { aL: a, aR: a, gl: 1 }); }
        else { const a = 0.64 - 0.4 * Math.max(0, (u - 0.4) / 0.6); Object.assign(P, { aL: a, aR: a, gl: Math.max(0, 1 - u * 1.5), chain: 1 - u }); }
      }
      at(x, y, 1, () => drawColoso(g, t, P));
    }
    // Vida: solo si ya recibió daño; el Coloso la muestra siempre, con su nombre.
    const max = MONSTERS[m.k].hp, top = y - (m.k === 'coloso' ? 300 : m.k === 'susurrante' ? 290 : 250) * S;
    if (m.hp < max || m.k === 'coloso') {
      const w = m.k === 'coloso' ? 90 : 40;
      g.fillStyle = 'rgba(20,10,22,.85)'; g.fillRect(x - w / 2 - 1, top - 1, w + 2, 7);
      g.fillStyle = '#ff6b6b'; g.fillRect(x - w / 2, top, w * Math.max(0, m.hp / max), 5);
      if (m.k === 'coloso') { const lab = labelSprite('Coloso', '#ff9ac8'); g.drawImage(lab, x - lab.width / 4, top - 22, lab.width / 2, lab.height / 2); }
    }
  }

  /** Avisos en el piso mientras un Desnombrado prepara su golpe (para poder esquivarlo). */
  private drawTelegraphs(list: { m: Mon }[], now: number, t: number) {
    const g = this.ctx;
    for (const { m } of list) {
      const since = now - m.strikeAt;
      if (m.k === 'susurrante' && (m.st === 'w' || since < STRIKE_DELAY_MS.susurrante)) drawRuneTelegraph(g, m.ax, m.ay, MONSTERS.susurrante.area, m.st === 'w' ? Math.min(1, m.p * 1.4) : 1, t);
      else if (m.k === 'coloso' && m.st === 'w') drawZoneTelegraph(g, m.ax, m.ay, MONSTERS.coloso.area, m.p, t);
      else if (m.k === 'errante' && m.st === 'w') {
        g.save(); g.translate(m.ax, m.ay); g.scale(1, 0.32); g.strokeStyle = `rgba(200,140,255,${0.3 + 0.5 * m.p})`; g.lineWidth = 3;
        g.beginPath(); g.arc(0, 0, MONSTERS.errante.area, 0, 7); g.stroke(); g.restore();
      }
    }
  }

  /** Sobre cada monolito activo: integridad, oleada y progreso; si se rompió, cuánto descansa. */
  private drawRituals(t: number) {
    const g = this.ctx;
    this.rituals.forEach((r) => {
      if (Math.hypot(r.x - this.cam.x, r.y - this.cam.y) > 900) return;
      const y = r.y - 175;
      if (r.ph === 'defensa' || r.ph === 'reparar') {
        const mine = r.tm === this.myTeam, col = teamColor(r.tm, '#e2c8ff'), w = 96;
        g.fillStyle = 'rgba(14,8,16,.85)'; g.beginPath(); g.roundRect(r.x - w / 2 - 6, y - 26, w + 12, 40, 6); g.fill();
        g.fillStyle = '#3a1f2a'; g.fillRect(r.x - w / 2, y, w, 7);
        g.fillStyle = r.ph === 'reparar' ? (Math.sin(t * 10) > 0 ? '#ff5a64' : '#a8323c') : '#8fd6a8'; g.fillRect(r.x - w / 2, y, (w * r.i) / 100, 7);
        g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(r.x, y - 9, 9, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * r.p) / 100); g.stroke();
        g.font = '500 12px "Alegreya Sans", sans-serif'; g.textAlign = 'left'; g.fillStyle = mine ? '#ffc08a' : '#e2c8ff';
        g.fillText(r.ph === 'reparar' ? '¡Nombre!' : `${r.w}/2`, r.x + 4 - w / 2, y - 5);
      } else if (r.ph === 'roto' && r.cd > 0) {
        g.font = '500 13px "Alegreya Sans", sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,140,150,.9)';
        g.fillText(`Descansa · ${r.cd} s`, r.x, y);
      }
    });
  }

  /** Prueba de Nombre: círculo de runas con la zona correcta, la perfecta y la aguja que gira. */
  private drawNameTest(now: number) {
    const nt = this.nameTest; if (!nt) return;
    const g = this.ctx, cx = this.W / 2, cy = this.H * 0.36, R = Math.max(48, Math.min(70, this.W * 0.16));
    const a = needleAt(nt.el + (now - nt.at));
    g.save();
    g.fillStyle = 'rgba(14,8,16,.78)'; g.beginPath(); g.arc(cx, cy, R + 20, 0, 7); g.fill();
    g.strokeStyle = 'rgba(244,239,228,.7)'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    for (let i = 0; i < 16; i++) { const q = (i / 16) * 6.283; g.beginPath(); g.moveTo(cx + Math.cos(q) * (R + 6), cy + Math.sin(q) * (R + 6)); g.lineTo(cx + Math.cos(q) * (R + 13), cy + Math.sin(q) * (R + 13)); g.stroke(); }
    g.lineCap = 'butt';
    g.strokeStyle = '#8fd6a8'; g.lineWidth = 12; g.beginPath(); g.arc(cx, cy, R, nt.z - RITUAL.zone / 2, nt.z + RITUAL.zone / 2); g.stroke();
    g.strokeStyle = '#ffd36a'; g.lineWidth = 14; g.beginPath(); g.arc(cx, cy, R, nt.z - RITUAL.perfect / 2, nt.z + RITUAL.perfect / 2); g.stroke();
    g.lineCap = 'round'; g.strokeStyle = '#f4efe4'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R + 10), cy + Math.sin(a) * (R + 10)); g.stroke();
    g.fillStyle = '#f4efe4'; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill();
    g.font = '500 15px "Alegreya Sans", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffc08a';
    g.fillText(`${this.input.touch ? 'Toca Usar' : 'Pulsa F'} cuando la aguja pase por la zona`, cx, cy + R + 42);
    g.restore();
  }

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
    // Monolitos: despertarlo (desde la Primera Llamada) o hacer la prueba de Nombre si se debilita.
    if (!best) {
      const awake = ['primera-llamada', 'segunda-llamada', 'cierre-portal-1', 'desnombrar'].includes(this.phaseId);
      for (const r of this.rituals) {
        if (Math.hypot(r.x - this.me.x, r.y - this.me.y) > RITUAL.range) continue;
        if (r.ph === 'dormido' && awake) best = { x: r.x, y: r.y, top: 170, text: 'mantén para despertar el monolito' };
        else if (r.ph === 'reparar' && r.tm === this.myTeam && !this.nameTest) best = { x: r.x, y: r.y, top: 170, text: 'prueba de Nombre' };
      }
    }
    if (!best) return;
    const g = this.ctx, label = `${this.input.touch ? 'Usar' : 'F'} · ${best.text}`;
    g.font = '500 15px "Alegreya Sans", sans-serif'; g.textAlign = 'center';
    const w = g.measureText(label).width + 20, y = best.y - best.top - 8 + Math.sin(t / 250) * 2;
    g.fillStyle = 'rgba(20,10,22,.9)'; g.beginPath(); g.roundRect(best.x - w / 2, y - 18, w, 26, 6); g.fill();
    g.fillStyle = '#ffc08a'; g.fillText(label, best.x, y);
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
      g.fillStyle = f.heal ? '#8cff9e' : '#ffd36a'; g.fillText(f.text, f.x, f.y - 60 - k * 30);
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
    const alpha = die != null ? Math.max(0, 1 - Math.max(0, (now - a.dieAt! - DIE_MS) / 600)) : a.invis ? 0.4 : 1;
    if (die == null) this.blob(a.x, a.y, 20);
    drawCharacter(this.ctx, {
      x: a.x, y: a.y, view, flip, app, pose, t: now / 1000, alpha,
      team: a.color, foco: a.foco ?? null,
      flash: now - a.hitAt < 120 ? 1 : 0,
    });
  }
}
