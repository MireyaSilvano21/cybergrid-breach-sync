import { MODULE_TILES, TILE } from './constants';
import { createRng, pick } from './rng';
import { ROOM_TEMPLATES, type RoomRole } from './templates';

/**
 * Generador procedural de la Grid (GDD sección 11 y Propuesta de mapa).
 *
 * Trabaja en dos niveles, como Enter the Gungeon o Dark and Darker:
 *  1. Estructura: qué módulos existen, qué función tiene cada uno (llegada, osario,
 *     santuario, bóveda…) y cómo se conectan (árbol al azar + lazos).
 *  2. Salas: cada función toma una plantilla diseñada a mano, girada o volteada.
 *
 * Para que sea justo, se genera un dominio (un cuarto del mapa) y se copia girado 90°
 * alrededor del centro (simetría de rehilete): los 4 equipos reciben el mismo cuarto.
 * La misma semilla produce exactamente el mismo mapa.
 */
export type ModuleType = RoomRole | 'pasaje' | 'vacio';

// Tipos de casilla.
export const FLOOR = 0;
export const WALL = 1;
/** Abismo: no se cruza, pero se ve a través. */
export const PIT = 2;
/** Muro delgado: la Grieta de Tharvén lo podrá abrir. */
export const THIN = 3;
/** Sellos: el de las bóvedas mayores se abre en la Primera Llamada; el del Corazón, en la Segunda. */
export const SEAL_VAULT = 4;
export const SEAL_HEART = 5;
/** Rejas de un solo sentido (se cruzan hacia N, E, S u O). */
export const GATE_N = 6;
export const GATE_E = 7;
export const GATE_S = 8;
export const GATE_W = 9;
/** Escombros o estantes: cobertura que bloquea paso y vista. */
export const COVER = 10;
/** Objeto grande: hito, monolito o pilar. */
export const PROP = 11;
/** Brasero pequeño: estorba el paso, no la vista. */
export const BRAZIER = 12;
/** Muros en diagonal: el triángulo sólido está en la esquina indicada. */
export const DIAG_TL = 13;
export const DIAG_TR = 14;
export const DIAG_BL = 15;
export const DIAG_BR = 16;

export interface ModuleInfo { mx: number; my: number; type: ModuleType }
export interface Point { x: number; y: number }
export interface ChestSpot extends Point { role: ModuleType; small: boolean; relic: boolean }
export interface MapProp extends Point { kind: 'hito' | 'monolito' | 'pilar' | 'brasero' }

export interface GridMap {
  seed: number;
  modules: number; // módulos por lado
  width: number; // casillas
  height: number;
  tiles: number[]; // tipos de casilla, fila por fila
  layout: ModuleInfo[];
  spawns: Point[]; // una llegada por cuarto del mapa
  portalCandidates: Point[];
  portals: [number, number]; // índices de los dos portales elegidos
  monoliths: Point[];
  vault: Point; // centro del Corazón (Relicario)
  chestSpots: ChestSpot[];
  props: MapProp[];
  /** Estado de los sellos (cambia durante la partida). */
  sealsOpen: { vault: boolean; heart: boolean };
  /** Casillas de sello de cada bóveda mayor (índices de casilla), en el orden de giro del mapa. */
  vaultSeals?: number[][];
}

/** Abre una bóveda mayor: sus sellos pasan a ser piso (servidor y cliente hacen lo mismo). */
export function openVault(map: GridMap, i: number) {
  for (const idx of map.vaultSeals?.[i] ?? []) if (map.tiles[idx] === SEAL_VAULT) map.tiles[idx] = FLOOR;
}

/** Centro de los sellos de una bóveda mayor. */
export function vaultCenter(map: GridMap, i: number): Point | null {
  const seals = map.vaultSeals?.[i];
  if (!seals?.length) return null;
  let x = 0, y = 0;
  for (const idx of seals) { x += (idx % map.width) + 0.5; y += Math.floor(idx / map.width) + 0.5; }
  return { x: (x / seals.length) * TILE, y: (y / seals.length) * TILE };
}

export function modulesForPlayers(players: number): number {
  return players <= 6 ? 5 : 7;
}

export function tileAt(map: GridMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return WALL;
  return map.tiles[ty * map.width + tx];
}

export const isDiag = (t: number) => t >= DIAG_TL && t <= DIAG_BR;
export const isGate = (t: number) => t >= GATE_N && t <= GATE_W;
export const GATE_DIR: Record<number, [number, number]> = { [GATE_N]: [0, -1], [GATE_E]: [1, 0], [GATE_S]: [0, 1], [GATE_W]: [-1, 0] };

/** Casillas que nunca se pisan (las rejas y los sellos dependen de la dirección o la fase). */
export function blocksMovement(map: GridMap, t: number): boolean {
  if (t === FLOOR || isGate(t)) return false;
  if (t === SEAL_VAULT) return !map.sealsOpen.vault;
  if (t === SEAL_HEART) return !map.sealsOpen.heart;
  return true;
}

/** Casillas que tapan la vista (los abismos, rejas y braseros dejan ver). */
export function blocksSight(map: GridMap, t: number): boolean {
  if (t === FLOOR || t === PIT || t === BRAZIER || isGate(t)) return false;
  if (t === SEAL_VAULT) return !map.sealsOpen.vault;
  if (t === SEAL_HEART) return !map.sealsOpen.heart;
  return true;
}

/** ¿El punto del mundo cae en la parte sólida de su casilla? Respeta las diagonales. */
export function solidAt(map: GridMap, x: number, y: number, forSight = false): boolean {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), t = tileAt(map, tx, ty);
  if (isDiag(t)) {
    const u = x / TILE - tx, v = y / TILE - ty;
    return t === DIAG_TL ? u + v < 1 : t === DIAG_TR ? (1 - u) + v < 1 : t === DIAG_BL ? u + (1 - v) < 1 : (1 - u) + (1 - v) < 1;
  }
  return forSight ? blocksSight(map, t) : blocksMovement(map, t);
}

export function isSolidWorld(map: GridMap, x: number, y: number): boolean {
  return solidAt(map, x, y);
}

/** Para recorrer el mapa en las validaciones: se puede pasar por rejas y sellos. */
const walkableForGraph = (t: number) => t === FLOOR || isGate(t) || t === SEAL_VAULT || t === SEAL_HEART;

// ---------------------------------------------------------------------------------
// Generación
// ---------------------------------------------------------------------------------

type Cell = [number, number];
const N = MODULE_TILES;
const ARROW_ROT: Record<string, string> = { '^': '>', '>': 'v', 'v': '<', '<': '^' };
const ARROW_FLIP: Record<string, string> = { '<': '>', '>': '<' };

/** Gira una plantilla 90° en sentido horario (las rejas giran con ella). */
function rotGrid(g: string[][]): string[][] {
  return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => { const c = g[N - 1 - x][y]; return ARROW_ROT[c] ?? c; }));
}
function flipGrid(g: string[][]): string[][] {
  return g.map((row) => row.map((_, x) => { const c = row[N - 1 - x]; return ARROW_FLIP[c] ?? c; }));
}
function doorsOf(g: string[][]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < N; i++) {
    if (g[0][i] === '=') s.add('N');
    if (g[N - 1][i] === '=') s.add('S');
    if (g[i][0] === '=') s.add('W');
    if (g[i][N - 1] === '=') s.add('E');
  }
  return s;
}

interface Structure { role: Map<string, ModuleType>; edges: Set<string>; spawn: Cell }

const ck = (c: Cell) => `${c[0]},${c[1]}`;
const ek = (a: Cell, b: Cell) => { const x = ck(a), y = ck(b); return x < y ? `${x}|${y}` : `${y}|${x}`; };

function buildStructure(rng: () => number, M: number): Structure | null {
  const h = (M - 1) / 2, C: Cell = [h, h];
  const rotc = (c: Cell): Cell => [M - 1 - c[1], c[0]];
  const dom: Cell[] = [];
  for (let j = 0; j <= h; j++) for (let i = 0; i < h; i++) dom.push([i, j]);
  const orbit = new Map<string, string>(); // celda → celda del dominio
  for (const d of dom) { let c = d; for (let k = 0; k < 4; k++) { orbit.set(ck(c), ck(d)); c = rotc(c); } }
  orbit.set(ck(C), ck(C));
  const all: Cell[] = []; for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) all.push([i, j]);
  const nb = (c: Cell): Cell[] => ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => [c[0] + dx, c[1] + dy] as Cell).filter(([x, y]) => x >= 0 && y >= 0 && x < M && y < M);

  const role = new Map<string, ModuleType>();
  role.set(ck(C), 'corazon');
  const portalOpts: Cell[] = [[0, h], ...Array.from({ length: h - 1 }, (_, i) => [i + 1, 0] as Cell)];
  const portal = pick(rng, portalOpts); role.set(ck(portal), 'portal');
  const spawnOpts = dom.filter((d) => (d[0] === 0 || d[1] === 0) && Math.abs(d[0] - portal[0]) + Math.abs(d[1] - portal[1]) > 1);
  if (!spawnOpts.length) return null;
  const spawn = pick(rng, spawnOpts); role.set(ck(spawn), 'llegada');
  for (const d of dom) if (!role.has(ck(d)) && rng() < 0.2) role.set(ck(d), 'vacio');
  const full = (c: Cell) => role.get(orbit.get(ck(c))!)!;

  const dist = new Map<string, number>([[ck(spawn), 0]]); const q: Cell[] = [spawn];
  while (q.length) { const c = q.shift()!; for (const n of nb(c)) if (!dist.has(ck(n)) && role.get(orbit.get(ck(n))!) !== 'vacio') { dist.set(ck(n), dist.get(ck(c))! + 1); q.push(n); } }
  const free = dom.filter((d) => !role.has(ck(d)));
  if (free.length < 2 || free.some((d) => !dist.has(ck(d)))) return null;
  const sant = [...free].sort((a, b) => dist.get(ck(b))! - dist.get(ck(a))!)[0];
  role.set(ck(sant), 'santuario');
  const vb = dom.filter((d) => !role.has(ck(d)) && Math.abs(d[0] - sant[0]) + Math.abs(d[1] - sant[1]) === 1);
  if (vb.length && rng() < 0.8) role.set(ck(pick(rng, vb)), 'boveda');
  for (const d of dom) if (!role.has(ck(d))) role.set(ck(d), pick(rng, (dist.get(ck(d)) ?? 9) >= 2 ? ['galeria', 'osario', 'cruce'] as const : ['galeria', 'galeria', 'cruce'] as const));

  // Conexiones: árbol al azar desde la llegada + lazos.
  const E = new Set<string>(); const seen = new Set([ck(spawn)]); const st: Cell[] = [spawn];
  while (st.length) {
    const c = st[st.length - 1];
    const opts = nb(c).filter((n) => !seen.has(ck(n)) && full(n) !== 'vacio' && full(n) !== 'boveda');
    if (!opts.length) { st.pop(); continue; }
    const n = pick(rng, opts); seen.add(ck(n)); E.add(ek(c, n)); st.push(n);
  }
  for (const c of all) if (full(c) !== 'vacio') for (const n of nb(c)) if (full(n) !== 'vacio' && full(c) !== 'boveda' && full(n) !== 'boveda' && rng() < 0.3) E.add(ek(c, n));
  // Pasajes: módulos vacíos tallados como atajo entre dos vecinos.
  for (const d of dom) {
    if (role.get(ck(d)) !== 'vacio') continue;
    const ns = nb(d).filter((n) => full(n) !== 'vacio' && full(n) !== 'boveda');
    if (ns.length >= 2 && rng() < 0.6) {
      const a = ns.splice(Math.floor(rng() * ns.length), 1)[0], b = pick(rng, ns);
      role.set(ck(d), 'pasaje'); E.add(ek(d, a)); E.add(ek(d, b));
    }
  }
  // Bóveda: se entra desde un vecino común y se sale hacia el santuario.
  for (const v of dom.filter((d) => role.get(ck(d)) === 'boveda')) {
    const ins = nb(v).filter((n) => !['vacio', 'santuario', 'corazon', 'pasaje', 'boveda'].includes(full(n)));
    if (!ins.length) { role.set(ck(v), 'osario'); continue; }
    E.add(ek(v, pick(rng, ins))); E.add(ek(v, sant));
  }
  // Cierre por giro: la misma conexión en los cuatro cuartos.
  const closed = new Set<string>();
  for (const e of E) {
    let [a, b] = e.split('|').map((s) => s.split(',').map(Number) as Cell);
    for (let k = 0; k < 4; k++) { closed.add(ek(a, b)); a = rotc(a); b = rotc(b); }
  }
  const deg = (c: Cell) => [...closed].filter((e) => e.split('|').includes(ck(c))).length;
  for (const c of all) {
    const r = full(c);
    if (r === 'boveda' && deg(c) !== 2) return null;
    if ((r === 'santuario' || r === 'portal' || r === 'corazon') && deg(c) < 2) return null;
  }
  // Todo lo que existe debe estar conectado.
  const reach = new Set([ck(spawn)]); const q2 = [ck(spawn)];
  const adj = new Map<string, string[]>();
  for (const e of closed) { const [a, b] = e.split('|'); adj.set(a, [...(adj.get(a) ?? []), b]); adj.set(b, [...(adj.get(b) ?? []), a]); }
  while (q2.length) { const c = q2.shift()!; for (const n of adj.get(c) ?? []) if (!reach.has(n)) { reach.add(n); q2.push(n); } }
  if (all.some((c) => full(c) !== 'vacio' && !reach.has(ck(c)))) return null;
  const fullRole = new Map<string, ModuleType>(); for (const c of all) fullRole.set(ck(c), full(c));
  return { role: fullRole, edges: closed, spawn };
}

export function generateMap(seed: number, players = 12): GridMap {
  const rng = createRng(seed);
  const M = modulesForPlayers(players), W = M * N, h = (M - 1) / 2;
  let s: Structure | null = null;
  for (let i = 0; i < 400 && !s; i++) s = buildStructure(rng, M);
  if (!s) throw new Error('No se pudo armar la estructura del mapa');
  const { role, edges } = s;
  const rotc = (c: Cell): Cell => [M - 1 - c[1], c[0]];
  const side = (a: Cell, b: Cell) => (b[0] > a[0] ? 'E' : b[0] < a[0] ? 'W' : b[1] > a[1] ? 'S' : 'N');
  const reqOf = (c: Cell) => {
    const out = new Set<string>();
    for (const e of edges) { const [a, b] = e.split('|'); if (a === ck(c)) out.add(side(c, b.split(',').map(Number) as Cell)); else if (b === ck(c)) out.add(side(c, a.split(',').map(Number) as Cell)); }
    return out;
  };

  const passage = (req: Set<string>): string[][] => {
    const g = Array.from({ length: N }, () => Array(N).fill(' '));
    for (const sd of req) {
      const tgt = ({ N: [7, 0], S: [7, N - 1], W: [0, 7], E: [N - 1, 7] } as Record<string, number[]>)[sd];
      let x = 7, y = 7;
      while (x !== tgt[0] || y !== tgt[1]) {
        const dx = Math.sign(tgt[0] - x), dy = Math.sign(tgt[1] - y);
        if (dx && dy) { if (rng() < 0.5) x += dx; else y += dy; } else { x += dx; y += dy; }
        for (const [a, b] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) if (a >= 0 && b >= 0 && a < N && b < N) g[b][a] = a === 0 || b === 0 || a === N - 1 || b === N - 1 ? '=' : '.';
      }
    }
    for (const [a, b] of [[7, 7], [8, 7], [7, 8], [8, 8]]) g[b][a] = '.';
    return g;
  };

  const choose = (c: Cell, r: ModuleType, req: Set<string>): string[][] => {
    if (r === 'pasaje') return passage(req);
    const outer = new Set<string>(); if (c[1] === 0) outer.add('N'); if (c[0] === 0) outer.add('W'); if (c[1] === M - 1) outer.add('S'); if (c[0] === M - 1) outer.add('E');
    const opts: string[][][] = [];
    for (const t of ROOM_TEMPLATES.filter((t) => t.role === r)) {
      for (const base of [t.rows.map((row) => row.split('')), flipGrid(t.rows.map((row) => row.split('')))]) {
        let g = base;
        for (let k = 0; k < 4; k++) {
          const ds = doorsOf(g);
          if ([...req].every((x) => ds.has(x)) && !(r === 'portal' && [...outer].some((x) => ds.has(x)))) opts.push(g);
          g = rotGrid(g);
        }
      }
    }
    if (opts.length) return pick(rng, opts);
    // Ninguna encaja: se toma una y se abren las puertas que falten.
    const g = pick(rng, ROOM_TEMPLATES.filter((t) => t.role === r)).rows.map((row) => row.split(''));
    for (const sd of req) for (const d of [7, 8]) {
      let [x, y] = ({ N: [d, 0], S: [d, N - 1], W: [0, d], E: [N - 1, d] } as Record<string, number[]>)[sd];
      const [dx, dy] = ({ N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] } as Record<string, number[]>)[sd];
      g[y][x] = '='; x += dx; y += dy;
      while (x > 0 && y > 0 && x < N - 1 && y < N - 1 && (g[y][x] === ' ' || g[y][x] === '#')) { g[y][x] = '.'; x += dx; y += dy; }
    }
    return g;
  };

  const chars = Array.from({ length: W }, () => Array<string>(W).fill(' '));
  const modRole = new Map<string, ModuleType>();
  const place = (c: Cell, g: string[][], req: Set<string>) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let ch = g[y][x];
      const sd = y === 0 ? 'N' : y === N - 1 ? 'S' : x === 0 ? 'W' : x === N - 1 ? 'E' : '';
      if (ch === '=') ch = req.has(sd) ? '.' : ' ';
      // Sellos de lados sin puerta: se vuelven muro.
      if (ch === 'G') {
        const near = (y <= 3 ? 'N' : y >= N - 4 ? 'S' : '') + (x <= 3 ? 'W' : x >= N - 4 ? 'E' : '');
        if (near && ![...near].some((k) => req.has(k))) ch = ' ';
      }
      chars[c[1] * N + y][c[0] * N + x] = ch;
    }
  };
  const dom: Cell[] = []; for (let j = 0; j <= h; j++) for (let i = 0; i < h; i++) dom.push([i, j]);
  for (const d of [...dom, [h, h] as Cell]) {
    const r = role.get(ck(d))!;
    if (r === 'vacio') { let c = d; for (let k = 0; k < 4; k++) { modRole.set(ck(c), r); c = rotc(c); } continue; }
    const g = choose(d, r, reqOf(d));
    place(d, g, reqOf(d)); modRole.set(ck(d), r);
    if (d[0] === h && d[1] === h) continue;
    let gg = g, c = d;
    for (let k = 1; k < 4; k++) { gg = rotGrid(gg); c = rotc(c); place(c, gg, reqOf(c)); modRole.set(ck(c), r); }
  }
  // Une puertas enfrentadas de distinto ancho (se calcula todo antes de aplicar, para no romper la simetría).
  const openings: [number, number][] = [];
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    if (chars[y][x] !== '.' || !(x % N === 0 || x % N === N - 1 || y % N === 0 || y % N === N - 1)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = y + dy;
      if (a >= 0 && b >= 0 && a < W && b < W && (Math.floor(a / N) !== Math.floor(x / N) || Math.floor(b / N) !== Math.floor(y / N)) && chars[b][a] === ' ') openings.push([a, b]);
    }
  }
  for (const [a, b] of openings) chars[b][a] = '.';

  // Caracteres → casillas y objetos.
  const tiles = new Array<number>(W * W).fill(WALL);
  const groups = new Map<string, Point[]>();
  const chestSpots: ChestSpot[] = [];
  const props: MapProp[] = [];
  const center = (x: number, y: number): Point => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
  const roleAt = (x: number, y: number) => modRole.get(`${Math.floor(x / N)},${Math.floor(y / N)}`) ?? 'vacio';
  const CODE: Record<string, number> = { '.': FLOOR, 'o': PIT, 't': THIN, '#': WALL, 'x': COVER, 'L': PROP, 'M': PROP, 'D': PROP, 'b': BRAZIER, '^': GATE_N, '>': GATE_E, 'v': GATE_S, '<': GATE_W };
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const ch = chars[y][x];
    if (ch === ' ') continue;
    let t = CODE[ch] ?? FLOOR;
    if (ch === 'G') t = roleAt(x, y) === 'corazon' ? SEAL_HEART : SEAL_VAULT;
    tiles[y * W + x] = t;
    if ('SPMRDL'.includes(ch)) {
      const k = `${ch}${Math.floor(x / N)},${Math.floor(y / N)}`;
      groups.set(k, [...(groups.get(k) ?? []), center(x, y)]);
    }
    if (ch === 'C' || ch === 'c') chestSpots.push({ ...center(x, y), role: roleAt(x, y), small: ch === 'c', relic: false });
    if (ch === 'b') props.push({ ...center(x, y), kind: 'brasero' });
  }
  // Objetos de varias casillas: su centro (los pilares sueltos cuentan por separado).
  const avg = (ps: Point[]): Point => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length });
  const byKind = (ch: string) => [...groups.entries()].filter(([k]) => k[0] === ch).map(([, ps]) => ps);
  const spawns = byKind('S').map(avg), portalsC = byKind('P').map(avg), monoliths = byKind('M').map(avg);
  const relic = byKind('R').map(avg)[0] ?? center(h * N + 7.5, h * N + 7.5);
  for (const ps of byKind('L')) props.push({ ...avg(ps), kind: 'hito' });
  for (const ps of byKind('M')) props.push({ ...avg(ps), kind: 'monolito' });
  for (const ps of byKind('D')) {
    // Pilares en casillas separadas son pilares distintos.
    const used = new Set<number>();
    ps.forEach((p, i) => {
      if (used.has(i)) return;
      const cl = ps.filter((o, j) => !used.has(j) && Math.abs(o.x - p.x) <= TILE && Math.abs(o.y - p.y) <= TILE);
      ps.forEach((o, j) => { if (cl.includes(o)) used.add(j); });
      props.push({ ...avg(cl), kind: 'pilar' });
    });
  }
  chestSpots.push({ ...relic, role: 'corazon', small: false, relic: true });

  // Muros en diagonal: esquinas de muro con piso en dos lados contiguos.
  const before = tiles.slice();
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < W && before[y * W + x] !== WALL;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    if (tiles[y * W + x] !== WALL || chars[y][x] === '#') continue;
    const u = open(x, y - 1), d = open(x, y + 1), l = open(x - 1, y), r = open(x + 1, y);
    if (d && r && !u && !l) tiles[y * W + x] = DIAG_TL;
    else if (d && l && !u && !r) tiles[y * W + x] = DIAG_TR;
    else if (u && r && !d && !l) tiles[y * W + x] = DIAG_BL;
    else if (u && l && !d && !r) tiles[y * W + x] = DIAG_BR;
  }

  // Orden de llegadas y portales por cuarto del mapa (giro alrededor del centro).
  const quad = (p: Point) => { const cx = W * TILE / 2, a = Math.atan2(p.y - cx, p.x - cx); return (a + Math.PI * 2) % (Math.PI * 2); };
  spawns.sort((a, b) => quad(a) - quad(b)); portalsC.sort((a, b) => quad(a) - quad(b));
  const layout: ModuleInfo[] = [];
  for (let my = 0; my < M; my++) for (let mx = 0; mx < M; mx++) layout.push({ mx, my, type: modRole.get(`${mx},${my}`) ?? 'vacio' });
  const pair: [number, number] = rng() < 0.5 ? [0, 2] : [1, 3];
  // Sellos de bóveda agrupados por módulo, en el mismo orden de giro que llegadas y portales.
  const sealGroups = new Map<string, number[]>();
  tiles.forEach((t, i) => {
    if (t !== SEAL_VAULT) return;
    const k = `${Math.floor((i % W) / N)},${Math.floor(Math.floor(i / W) / N)}`;
    sealGroups.set(k, [...(sealGroups.get(k) ?? []), i]);
  });
  const sealCenter = (g: number[]): Point => ({ x: (g.reduce((a, i) => a + (i % W), 0) / g.length + 0.5) * TILE, y: (g.reduce((a, i) => a + Math.floor(i / W), 0) / g.length + 0.5) * TILE });
  const vaultSeals = [...sealGroups.values()].sort((a, b) => quad(sealCenter(a)) - quad(sealCenter(b)));
  return {
    seed, modules: M, width: W, height: W, tiles, layout, spawns, portalCandidates: portalsC,
    portals: portalsC.length >= 4 ? pair : [0, Math.min(1, portalsC.length - 1)] as [number, number],
    monoliths, vault: relic, chestSpots, props, sealsOpen: { vault: false, heart: false }, vaultSeals,
  };
}

/** BFS sobre casillas recorribles (rejas y sellos cuentan como paso). -1 = inalcanzable. */
export function floodFill(tiles: number[], w: number, h: number, sx: number, sy: number): Int32Array {
  const dist = new Int32Array(w * h).fill(-1);
  if (!walkableForGraph(tiles[sy * w + sx])) return dist;
  const q = new Int32Array(w * h);
  let head = 0, tail = 0;
  q[tail++] = sy * w + sx; dist[sy * w + sx] = 0;
  while (head < tail) {
    const i = q[head++], x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!walkableForGraph(tiles[j]) || dist[j] >= 0) continue;
      dist[j] = dist[i] + 1; q[tail++] = j;
    }
  }
  return dist;
}

export interface MapValidation { connected: boolean; fairness: number; ok: boolean; distances: number[] }

/**
 * Validaciones: todo el piso conectado, 4 llegadas y distancias parecidas (±10 %)
 * de cada llegada a su portal más cercano.
 */
export function validateMap(map: GridMap, tolerance = 0.1): MapValidation {
  const toTile = (p: Point) => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
  if (map.spawns.length < 4 || map.portalCandidates.length < 2) return { connected: false, fairness: 1, ok: false, distances: [] };
  const s0 = toTile(map.spawns[0]);
  const reach = floodFill(map.tiles, map.width, map.height, s0.x, s0.y);
  let connected = true;
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === FLOOR && reach[i] < 0) { connected = false; break; }
  const portals = map.portals.map((i) => toTile(map.portalCandidates[i]));
  const distances = map.spawns.map((sp) => {
    const t = toTile(sp);
    const d = floodFill(map.tiles, map.width, map.height, t.x, t.y);
    const ds = portals.map((p) => d[p.y * map.width + p.x]).filter((v) => v >= 0);
    return ds.length ? Math.min(...ds) : Infinity;
  });
  const min = Math.min(...distances), max = Math.max(...distances);
  const fairness = Number.isFinite(max) && max > 0 ? (max - min) / max : 1;
  return { connected, fairness, ok: connected && fairness <= tolerance, distances };
}

/** Genera mapas a partir de la semilla hasta que uno pase las validaciones. */
export function generateValidMap(seed: number, players = 12, maxAttempts = 60): GridMap {
  let best: GridMap | null = null, bestF = Infinity;
  for (let i = 0; i < maxAttempts; i++) {
    const m = generateMap(seed + i * 7919, players);
    // Si un par de portales no es justo, se prueba el otro par antes de cambiar de mapa.
    for (const pair of [m.portals, [1, 3], [0, 2]] as [number, number][]) {
      if (pair[1] >= m.portalCandidates.length) continue;
      m.portals = pair;
      const v = validateMap(m);
      if (v.ok) return m;
      if (v.connected && v.fairness < bestF) { best = { ...m, portals: pair }; bestF = v.fairness; }
    }
  }
  return best ?? generateMap(seed, players);
}
