import { MODULE_TILES, TILE } from './constants';
import { createRng, randInt } from './rng';

/**
 * Generador procedural de la Grid (GDD sección 11).
 * La ruina es una cuadrícula de módulos de 16x16 casillas. Cada partida usa una semilla:
 * la misma semilla produce exactamente el mismo mapa.
 */
export type ModuleType = 'pasillo' | 'sala' | 'camara' | 'santuario' | 'umbral' | 'corazon' | 'llegada';
export const FLOOR = 0;
export const WALL = 1;

export interface ModuleInfo { mx: number; my: number; type: ModuleType }
export interface Point { x: number; y: number }

export interface GridMap {
  seed: number;
  modules: number; // módulos por lado
  width: number; // casillas
  height: number;
  tiles: number[]; // FLOOR | WALL, fila por fila
  layout: ModuleInfo[];
  spawns: Point[]; // centro en unidades de mundo
  portalCandidates: Point[];
  portals: [number, number]; // índices de los dos portales elegidos
  monoliths: Point[];
  vault: Point;
}

const DOOR_FROM = 6;
const DOOR_TO = 9;

const key = (x: number, y: number) => `${x},${y}`;

/**
 * Módulos por lado. Se usan tamaños impares (5x5 y 7x7) para que el mapa tenga un
 * módulo central exacto y la simetría en espejo deje a todas las llegadas a la misma
 * distancia de los portales.
 */
export function modulesForPlayers(players: number): number {
  return players <= 6 ? 5 : 7;
}

export function tileAt(map: GridMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return WALL;
  return map.tiles[ty * map.width + tx];
}

export function isSolidWorld(map: GridMap, x: number, y: number): boolean {
  return tileAt(map, Math.floor(x / TILE), Math.floor(y / TILE)) === WALL;
}

const moduleCenter = (mx: number, my: number): Point => ({
  x: (mx * MODULE_TILES + MODULE_TILES / 2) * TILE,
  y: (my * MODULE_TILES + MODULE_TILES / 2) * TILE,
});

export function generateMap(seed: number, players = 12): GridMap {
  const rng = createRng(seed);
  const n = modulesForPlayers(players);
  const W = n * MODULE_TILES;
  const tiles = new Array<number>(W * W).fill(WALL);
  const mid = Math.floor(n / 2);

  // 1) Conexiones entre módulos: árbol aleatorio + lazos extra para tener varias rutas.
  const links = new Set<string>();
  const linkKey = (a: [number, number], b: [number, number]) =>
    [key(...a), key(...b)].sort().join('|');
  const visited = new Set<string>([key(0, 0)]);
  const stack: [number, number][] = [[0, 0]];
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nbrs = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
      .map(([dx, dy]) => [cx + dx, cy + dy] as [number, number])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n && !visited.has(key(x, y)));
    if (!nbrs.length) { stack.pop(); continue; }
    const nb = nbrs[Math.floor(rng() * nbrs.length)];
    links.add(linkKey([cx, cy], nb));
    visited.add(key(...nb));
    stack.push(nb);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (x + 1 < n && rng() < 0.55) links.add(linkKey([x, y], [x + 1, y]));
    if (y + 1 < n && rng() < 0.55) links.add(linkKey([x, y], [x, y + 1]));
  }
  const linked = (a: [number, number], b: [number, number]) => links.has(linkKey(a, b));

  // 2) Tipos de módulo según reglas de colocación.
  const layout: ModuleInfo[] = [];
  const portalMods: [number, number][] = [[0, mid], [n - 1, mid], [mid, 0], [mid, n - 1]];
  const spawnMods: [number, number][] = [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]];
  const shrineMods: [number, number][] = [[mid - 1, mid - 1], [mid + 1, mid - 1], [mid, mid + 1]];
  const typeOf = (x: number, y: number): ModuleType => {
    if (x === mid && y === mid) return 'corazon';
    if (spawnMods.some(([a, b]) => a === x && b === y)) return 'llegada';
    if (portalMods.some(([a, b]) => a === x && b === y)) return 'umbral';
    if (shrineMods.some(([a, b]) => a === x && b === y)) return 'santuario';
    const r = rng();
    return r < 0.3 ? 'pasillo' : r < 0.6 ? 'camara' : 'sala';
  };

  // 3) Tallado de cada módulo: interior libre, muros en el borde, puertas donde hay conexión.
  for (let my = 0; my < n; my++) for (let mx = 0; mx < n; mx++) {
    const type = typeOf(mx, my);
    layout.push({ mx, my, type });
    const ox = mx * MODULE_TILES, oy = my * MODULE_TILES;
    for (let y = 1; y < MODULE_TILES - 1; y++) for (let x = 1; x < MODULE_TILES - 1; x++) tiles[(oy + y) * W + ox + x] = FLOOR;
    const open = (x: number, y: number) => { tiles[(oy + y) * W + ox + x] = FLOOR; };
    for (let d = DOOR_FROM; d <= DOOR_TO; d++) {
      if (mx + 1 < n && linked([mx, my], [mx + 1, my])) open(MODULE_TILES - 1, d);
      if (mx > 0 && linked([mx, my], [mx - 1, my])) open(0, d);
      if (my + 1 < n && linked([mx, my], [mx, my + 1])) open(d, MODULE_TILES - 1);
      if (my > 0 && linked([mx, my], [mx, my - 1])) open(d, 0);
    }
    // Obstáculos (columnas, escombros) fuera de los carriles centrales.
    if (type === 'sala' || type === 'camara' || type === 'pasillo') {
      const count = randInt(rng, 2, 5);
      for (let i = 0; i < count; i++) {
        const w = randInt(rng, 1, 2), h = randInt(rng, 1, 2);
        const x = randInt(rng, 2, MODULE_TILES - 3 - w), y = randInt(rng, 2, MODULE_TILES - 3 - h);
        const inLane = (v: number, s: number) => v + s - 1 >= DOOR_FROM - 1 && v <= DOOR_TO + 1;
        if (inLane(x, w) || inLane(y, h)) continue;
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) tiles[(oy + y + yy) * W + ox + x + xx] = WALL;
      }
    }
  }

  // 4) Simetría en espejo (horizontal y vertical): garantiza que todas las llegadas
  //    estén a la misma distancia de su portal más cercano, como en mapas competitivos.
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const cx = Math.min(x, W - 1 - x), cy = Math.min(y, W - 1 - y);
    tiles[y * W + x] = tiles[cy * W + cx];
  }
  for (const m of layout) {
    const canon = layout.find((o) => o.mx === Math.min(m.mx, n - 1 - m.mx) && o.my === Math.min(m.my, n - 1 - m.my));
    const special = m.type === 'corazon' || m.type === 'llegada' || m.type === 'umbral' || m.type === 'santuario';
    if (canon && !special && canon.type !== 'corazon' && canon.type !== 'llegada' && canon.type !== 'umbral' && canon.type !== 'santuario') m.type = canon.type;
  }

  // 5) Cerrar bolsas aisladas: todo piso no alcanzable desde la primera llegada se vuelve muro.
  const start = { x: (spawnMods[0][0] * MODULE_TILES + 8), y: (spawnMods[0][1] * MODULE_TILES + 8) };
  const reach = floodFill(tiles, W, W, start.x, start.y);
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === FLOOR && reach[i] < 0) tiles[i] = WALL;

  const horizontalPair = rng() < 0.5;
  return {
    seed, modules: n, width: W, height: W, tiles, layout,
    spawns: spawnMods.map(([x, y]) => moduleCenter(x, y)),
    portalCandidates: portalMods.map(([x, y]) => moduleCenter(x, y)),
    portals: horizontalPair ? [0, 1] : [2, 3],
    monoliths: shrineMods.map(([x, y]) => moduleCenter(x, y)),
    vault: moduleCenter(mid, mid),
  };
}

/** BFS sobre casillas. Devuelve la distancia en casillas desde el origen (-1 = inalcanzable). */
export function floodFill(tiles: number[], w: number, h: number, sx: number, sy: number): Int32Array {
  const dist = new Int32Array(w * h).fill(-1);
  if (tiles[sy * w + sx] !== FLOOR) return dist;
  const q = new Int32Array(w * h);
  let head = 0, tail = 0;
  q[tail++] = sy * w + sx; dist[sy * w + sx] = 0;
  while (head < tail) {
    const i = q[head++], x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (tiles[j] !== FLOOR || dist[j] >= 0) continue;
      dist[j] = dist[i] + 1; q[tail++] = j;
    }
  }
  return dist;
}

export interface MapValidation { connected: boolean; fairness: number; ok: boolean; distances: number[] }

/**
 * Validaciones del GDD: todo el mapa conectado y distancias parecidas (±10 %)
 * de cada llegada a su portal más cercano.
 */
export function validateMap(map: GridMap, tolerance = 0.1): MapValidation {
  const toTile = (p: Point) => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
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
export function generateValidMap(seed: number, players = 12, maxAttempts = 200): GridMap {
  let best: GridMap | null = null, bestF = Infinity;
  for (let i = 0; i < maxAttempts; i++) {
    const m = generateMap(seed + i * 7919, players);
    const v = validateMap(m);
    if (v.ok) return m;
    if (v.connected && v.fairness < bestF) { best = m; bestF = v.fairness; }
  }
  return best ?? generateMap(seed, players);
}
