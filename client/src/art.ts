/**
 * Arte "Forja Apagada": tinta gruesa color ciruela, piedra con 2–3 tonos y luces saturadas.
 * Todo se genera con código (SVG y Canvas) a partir de la semilla del mapa, así que el
 * cliente no descarga texturas pesadas y cada partida se ve distinta pero coherente.
 */
import { TILE, WALL, FLOOR, PIT, THIN, isDiag, createRng, type GridMap } from '@shared/index';

export const INK = '#1d0c16';
type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

// ---------- utilidades de pintura ----------

export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))));
  return `rgb(${c})`;
}

function poly(g: Ctx, pts: Pt[]) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

function stonePts(r: () => number, x: number, y: number, w: number, h: number, j: number): Pt[] {
  const c = () => 1.5 + r() * Math.min(6, w * 0.18, h * 0.18), J = () => (r() - 0.5) * j;
  const a = c(), b = c(), d = c(), e = c();
  return [[x + a + J(), y + J()], [x + w - b + J(), y + J()], [x + w + J(), y + b + J()], [x + w + J(), y + h - d + J()],
    [x + w - d + J(), y + h + J()], [x + e + J(), y + h + J()], [x + J(), y + h - e + J()], [x + J(), y + a + J()]];
}

/** Piedra biselada: base oscura, cara clara, manchas suaves y un filo iluminado arriba a la izquierda. */
function paintStone(g: Ctx, r: () => number, pts: Pt[], base: string, hl = 0.15) {
  let cx = 0, cy = 0, x0 = 1e9, x1 = -1e9;
  for (const p of pts) { cx += p[0]; cy += p[1]; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
  cx /= pts.length; cy /= pts.length; const w = x1 - x0;
  poly(g, pts); g.fillStyle = shade(base, -0.32); g.fill();
  const top: Pt[] = pts.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return [x - (dx / l) * 2.1 - 0.4, y - (dy / l) * 2.1 - 1.5]; });
  poly(g, top); g.fillStyle = base; g.fill();
  g.save(); poly(g, top); g.clip();
  for (let i = 0; i < 3; i++) {
    const bx = cx + (r() - 0.5) * w, by = cy + (r() - 0.5) * w * 0.6, rad = 5 + r() * w * 0.55;
    const gr = g.createRadialGradient(bx, by, 0, bx, by, rad), li = r() < 0.45;
    gr.addColorStop(0, li ? 'rgba(235,225,255,.12)' : 'rgba(12,2,24,.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
  }
  g.translate(1.2, 1.9); poly(g, top); g.strokeStyle = shade(base, hl); g.lineWidth = 2.4; g.stroke();
  g.restore();
}

function strokeP(g: Ctx, p: Pt[], col: string, w: number) {
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(p[0][0], p[0][1]);
  for (const q of p) g.lineTo(q[0], q[1]);
  g.stroke();
}

/** Trazo luminoso en tres pasadas (halo, cuerpo y núcleo). */
export function glowP(g: Ctx, p: Pt[], rgb: string, s = 1) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [w, a] of [[7 * s, 0.16], [3.2 * s, 0.5], [1.3 * s, 0.95]]) strokeP(g, p, `rgba(${rgb},${a})`, w);
}

function canvas(w: number, h: number, k = 2): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas'); c.width = Math.ceil(w * k); c.height = Math.ceil(h * k);
  const g = c.getContext('2d')!; g.scale(k, k); g.lineJoin = 'round'; g.lineCap = 'round';
  return [c, g];
}

export function softDot(rgb: string): HTMLCanvasElement {
  const [c, g] = canvas(64, 64, 1), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.4, `rgba(${rgb},.45)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c;
}

export function tintCopy(src: CanvasImageSource & { width: number; height: number }, color: string): HTMLCanvasElement {
  const [c, g] = canvas(src.width, src.height, 1);
  g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  return c;
}

// ---------- personajes (SVG con contorno de tinta) ----------

const st = (c: string, w: number) => `stroke="${c}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const svg = (w: number, h: number, b: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}">${b}</svg>`;

const STAFF = svg(14, 60, `<rect x="5" y="14" width="4" height="44" rx="2" fill="#6b4226" ${st(INK, 2.5)}/><path d="M7 2L13 10L7 18L1 10Z" fill="#ffb347" ${st(INK, 2.5)}/>`);
const SKULL = svg(24, 20, `<path d="M12 2C4 2 2 8 3 12C4 15 6 15 6 18H18C18 15 20 15 21 12C22 8 20 2 12 2Z" fill="#e8dcc6" ${st(INK, 2.5)}/><circle cx="8.5" cy="10" r="2.3" fill="${INK}"/><circle cx="15.5" cy="10" r="2.3" fill="${INK}"/>`);
const FLAME = svg(40, 52, `<path d="M20 50C6 46 4 30 12 20C12 28 16 30 18 26C14 16 20 6 26 2C24 14 36 18 34 32C40 30 38 22 38 22C44 34 36 48 20 50Z" fill="#ff6a1a" ${st('#3a0d08', 3)}/><path d="M20 46C12 42 14 32 18 28C20 34 24 34 24 30C30 34 30 44 20 46Z" fill="#ffd56a"/>`);
const SCONCE = svg(30, 26, `<path d="M4 4H26L20 16H10Z" fill="#3e3446" ${st(INK, 3)}/><path d="M8 7H22" fill="none" ${st('#ff8a2a', 2)}/><path d="M15 16V24" fill="none" ${st(INK, 4)}/>`);

export type ImgKey = 'staff' | 'skull' | 'flame' | 'sconce';

/** Carga asíncrona de los sprites SVG; el juego dibuja un respaldo mientras no estén listos. */
export class Sprites {
  readonly img: Partial<Record<ImgKey, HTMLImageElement>> = {};
  readonly white: Partial<Record<ImgKey, HTMLCanvasElement>> = {};
  readonly dot: Record<string, HTMLCanvasElement> = {};
  constructor() {
    const add = (k: ImgKey, s: string, white = false) => {
      const i = new Image();
      i.onload = () => { this.img[k] = i; if (white) this.white[k] = tintCopy(i, '#fff'); };
      i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    };
    add('staff', STAFF); add('skull', SKULL); add('flame', FLAME); add('sconce', SCONCE);
    for (const [k, c] of [['ember', '255,140,50'], ['violet', '170,120,255'], ['magenta', '255,90,216'], ['white', '255,240,255'], ['gold', '255,200,90']]) this.dot[k] = softDot(c);
  }
}

const FLOOR_PAL = ['#4f4f6c', '#4a4964', '#545370', '#46455f', '#4d4a66', '#535068'];

// ---------- piso por trozos y muros ----------

export const CHUNK = 8; // casillas por lado de cada trozo de piso
const CELL = 32;

export interface FloorChunk { canvas: HTMLCanvasElement; cracks: Pt[][] }

function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0);
}

/** Pinta un trozo de 8×8 casillas: losas de varios tamaños, manchas, grietas de brasa y sombra junto a los muros. */
export function buildFloorChunk(map: GridMap, cx: number, cy: number): FloorChunk {
  const size = CHUNK * TILE, [c, f] = canvas(size, size, 1), r = createRng(hash(map.seed, cx, cy));
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? WALL : map.tiles[y * map.width + x]);
  const solid = (x: number, y: number) => { const t = at(x, y); return t === WALL || t === THIN || isDiag(t); };
  const tx0 = cx * CHUNK, ty0 = cy * CHUNK;
  f.fillStyle = '#211b2b'; f.fillRect(0, 0, size, size);
  const M = size / CELL, occ = new Uint8Array(M * M);
  const sizes: Pt[] = [[2, 1], [1, 2], [2, 2], [1, 1], [3, 2], [2, 3], [3, 1], [2, 2]];
  for (let gy = 0; gy < M; gy++) for (let gx = 0; gx < M; gx++) {
    if (occ[gy * M + gx]) continue;
    let pick: Pt = [1, 1];
    for (let k = 0; k < 10; k++) {
      const sz = sizes[Math.floor(r() * sizes.length)];
      let ok = gx + sz[0] <= M && gy + sz[1] <= M;
      for (let yy = 0; ok && yy < sz[1]; yy++) for (let xx = 0; ok && xx < sz[0]; xx++) if (occ[(gy + yy) * M + gx + xx]) ok = false;
      if (ok) { pick = sz; break; }
    }
    for (let yy = 0; yy < pick[1]; yy++) for (let xx = 0; xx < pick[0]; xx++) occ[(gy + yy) * M + gx + xx] = 1;
    const x = gx * CELL, y = gy * CELL, w = pick[0] * CELL, h = pick[1] * CELL;
    if (r() < 0.045) { // grava
      f.fillStyle = '#2e2426'; f.fillRect(x + 2, y + 2, w - 4, h - 4);
      for (let i = 0; i < 6; i++) { const px = x + 4 + r() * (w - 8), py = y + 4 + r() * (h - 8), pr = 1.5 + r() * 3; f.fillStyle = '#4a3d40'; f.beginPath(); f.ellipse(px, py, pr, pr * 0.7, 0, 0, 6.283); f.fill(); }
      continue;
    }
    paintStone(f, r, stonePts(r, x + 1.8, y + 1.8, w - 3.6, h - 3.6, 2.2), r() < 0.08 ? '#6b5d68' : FLOOR_PAL[Math.floor(r() * FLOOR_PAL.length)]);
  }
  for (let i = 0; i < 10; i++) {
    const x = r() * size, y = r() * size, rad = 50 + r() * 150, g = f.createRadialGradient(x, y, 0, x, y, rad), k = r();
    g.addColorStop(0, k < 0.55 ? 'rgba(20,8,22,.26)' : k < 0.8 ? 'rgba(70,46,40,.20)' : 'rgba(170,150,210,.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = g; f.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const cracks: Pt[][] = [];
  if (r() < 0.7) {
    let x = 40 + r() * (size - 80), y = 40 + r() * (size - 80); const pts: Pt[] = [[x, y]];
    for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 22; y += (r() - 0.5) * 22; pts.push([x, y]); }
    const tx = Math.floor(pts[0][0] / TILE) + tx0, ty = Math.floor(pts[0][1] / TILE) + ty0;
    if (!solid(tx, ty)) { strokeP(f, pts, '#120c14', 3); cracks.push(pts.map(([a, b]) => [a + tx0 * TILE, b + ty0 * TILE])); }
  }
  const ao = (x: number, y: number, w: number, h: number, x0: number, y0: number, x1: number, y1: number, a: number) => {
    const g = f.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(14,4,18,${a})`); g.addColorStop(1, 'rgba(14,4,18,0)');
    f.fillStyle = g; f.fillRect(x, y, w, h);
  };
  for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
    const mx = tx0 + x, my = ty0 + y, X = x * TILE, Y = y * TILE;
    if (at(mx, my) === WALL) { f.fillStyle = isDeepWall(map, mx, my) ? '#07040b' : '#140c18'; f.fillRect(X, Y, TILE, TILE); continue; }
    if (at(mx, my) === PIT) {
      // Abismo: negro con un borde de roca donde el piso de arriba se corta.
      const g = f.createLinearGradient(0, Y, 0, Y + TILE); g.addColorStop(0, '#0b0510'); g.addColorStop(1, '#030106');
      f.fillStyle = g; f.fillRect(X, Y, TILE, TILE);
      if (at(mx, my - 1) !== PIT) {
        f.fillStyle = '#3a3350'; f.fillRect(X, Y, TILE, 16); f.fillStyle = '#2a2438'; f.fillRect(X, Y + 16, TILE, 6);
        strokeP(f, [[X, Y + 22], [X + TILE, Y + 22]], INK, 2.4);
      }
      if (at(mx - 1, my) !== PIT) strokeP(f, [[X + 1, Y], [X + 1, Y + TILE]], INK, 2.4);
      if (at(mx + 1, my) !== PIT) strokeP(f, [[X + TILE - 1, Y], [X + TILE - 1, Y + TILE]], INK, 2.4);
      continue;
    }
    if (isDiag(at(mx, my))) continue;
    if (solid(mx, my - 1)) ao(X, Y, TILE, 50, 0, Y, 0, Y + 50, 0.75);
    if (solid(mx - 1, my)) ao(X, Y, 32, TILE, X, 0, X + 32, 0, 0.65);
    if (solid(mx + 1, my)) ao(X + TILE - 32, Y, 32, TILE, X + TILE, 0, X + TILE - 32, 0, 0.65);
    if (solid(mx, my + 1)) ao(X, Y + TILE - 24, TILE, 24, 0, Y + TILE, 0, Y + TILE - 24, 0.6);
  }
  return { canvas: c, cracks };
}

/** Altura visible del muro: la tapa se levanta 40 px sobre su casilla y la cara ocupa la parte baja. */
export const WALL_RISE = 40;
const CAP = ['#6a6687', '#646080', '#716b8c', '#5e5a7a'], FACE = ['#3e3953', '#443e5a', '#38344c', '#403a50'];

/**
 * Bloque de muro según sus vecinos (contorno solo en los lados expuestos) y una de 4 variantes.
 * Se cachea por clave: como mucho 64 lienzos pequeños aunque el mapa tenga miles de muros.
 */
export function buildWall(key: number): HTMLCanvasElement {
  const r = createRng(0x3a11 + key * 977), top = key & 1, left = key & 2, right = key & 4, open = key & 8;
  const [c, g] = canvas(TILE, TILE + WALL_RISE);
  if (open) {
    g.fillStyle = '#110a15'; g.fillRect(0, 62, 64, 42);
    for (const [ry, rh] of [[63, 19], [82, 20]]) { let xx = -r() * 14; while (xx < 64) { const w = 16 + r() * 22; paintStone(g, r, stonePts(r, xx + 1.2, ry + 1, w - 2.4, rh - 2, 1.6), FACE[Math.floor(r() * FACE.length)], 0.18); xx += w; } }
    const gr = g.createLinearGradient(0, 62, 0, 104); gr.addColorStop(0, 'rgba(255,160,110,.10)'); gr.addColorStop(0.35, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(10,3,16,.62)'); g.fillStyle = gr; g.fillRect(0, 62, 64, 42);
  } else { g.fillStyle = '#140c18'; g.fillRect(0, 62, 64, 42); }
  g.fillStyle = '#140c18'; g.fillRect(0, 0, 64, 64);
  const split = r() < 0.5 ? [[0, 0, 64, 30], [0, 30, 30, 34], [30, 30, 34, 34]] : [[0, 0, 34, 64], [34, 0, 30, 28], [34, 28, 30, 36]];
  for (const [sx, sy, sw, sh] of split) paintStone(g, r, stonePts(r, sx + 1.6, sy + 1.6, sw - 3.2, sh - 3.2, 2), CAP[Math.floor(r() * CAP.length)], 0.3);
  g.strokeStyle = INK; g.lineWidth = 3.6; g.beginPath();
  if (!top) { g.moveTo(0, 1.8); g.lineTo(64, 1.8); }
  if (!left) { g.moveTo(1.8, 0); g.lineTo(1.8, open ? 104 : 64); }
  if (!right) { g.moveTo(62.2, 0); g.lineTo(62.2, open ? 104 : 64); }
  if (open) { g.moveTo(0, 62); g.lineTo(64, 62); g.moveTo(0, 102.2); g.lineTo(64, 102.2); }
  g.stroke();
  if (open) strokeP(g, [[2, 59.5], [62, 59.5]], 'rgba(190,175,215,.55)', 1.4);
  return c;
}

export function wallKey(map: GridMap, x: number, y: number): number {
  // Fuera del mapa cuenta como vacío para que el borde exterior también lleve contorno de tinta.
  // Los muros profundos (en oscuridad) cuentan como vacío: el borde lleva contorno de tinta.
  const solid = (a: number, b: number) => { if (a < 0 || b < 0 || a >= map.width || b >= map.height) return false; const t = map.tiles[b * map.width + a]; return (t === WALL || t === THIN || isDiag(t)) && !isDeepWall(map, a, b); };
  return (solid(x, y - 1) ? 1 : 0) | (solid(x - 1, y) ? 2 : 0) | (solid(x + 1, y) ? 4 : 0) | (y + 1 >= map.height || solid(x, y + 1) ? 0 : 8) | ((hash(map.seed, x, y) & 3) << 4);
}

// ---------- decoración (solo visual, sin colisión) ----------

export interface Decor { kind: 'skull' | 'grass' | 'sconce'; x: number; y: number; ph: number; blades?: { ox: number; a: number; len: number; w: number; ph: number; tone: number }[] }

/** Calaveras y pasto rojo en el piso, y antorchas en las caras de muro que dan al sur. */
export function buildDecor(map: GridMap): Decor[] {
  const out: Decor[] = [], r = createRng(map.seed ^ 0xdec0);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? WALL : map.tiles[y * map.width + x]);
  const taken = new Set<number>();
  const near = (p: { x: number; y: number }[], x: number, y: number, d: number) => p.some((q) => Math.hypot(q.x - x, q.y - y) < d);
  const keep = [...map.spawns, ...map.portalCandidates, ...map.monoliths, map.vault, ...map.chestSpots, ...map.props];
  for (let y = 0; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) {
    const t = at(x, y), h = hash(map.seed, x, y);
    if (t === WALL) {
      // Antorcha: muro con piso abajo, espaciadas para no saturar.
      if (at(x, y + 1) !== WALL && at(x - 1, y) === WALL && at(x + 1, y) === WALL && h % 9 === 0 && !taken.has((y >> 2) * 1000 + (x >> 2))) {
        taken.add((y >> 2) * 1000 + (x >> 2));
        out.push({ kind: 'sconce', x: x * TILE + TILE / 2, y: y * TILE + TILE, ph: r() * 10 });
      }
      continue;
    }
    const px = x * TILE + 8 + r() * (TILE - 16), py = y * TILE + 8 + r() * (TILE - 16);
    if (t !== FLOOR || near(keep, px, py, 110)) continue;
    if (y === 0) continue;
    if (h % 61 === 0) out.push({ kind: 'skull', x: px, y: py, ph: 0 });
    else if (h % 37 === 0) {
      const g = createRng(h), n = 9 + Math.floor(g() * 6), blades = [];
      for (let i = 0; i < n; i++) blades.push({ ox: (g() - 0.5) * 30, a: (g() - 0.5) * 0.9, len: 16 + g() * 22, w: 2.6 + g() * 1.8, ph: g() * 6.28, tone: g() });
      blades.sort((a, b) => a.len - b.len);
      out.push({ kind: 'grass', x: px, y: py, ph: 0, blades });
    }
  }
  return out;
}

/** Pasto que se mece y se aparta cuando alguien pasa cerca. */
export function drawGrass(g: Ctx, d: Decor, t: number, pushers: { x: number; y: number }[]) {
  for (const b of d.blades ?? []) {
    const bx = d.x + b.ox, by = d.y;
    let sw = Math.sin(t * 1.7 + bx * 0.015 + b.ph * 0.3) * 0.18;
    for (const p of pushers) { const dx = bx - p.x, dy = by - p.y, dd = Math.hypot(dx, dy); if (dd < 58) sw += (dx > 0 ? 1 : -1) * (1 - dd / 58) * 0.9; }
    const a = b.a + sw, tx = bx + Math.sin(a) * b.len, ty = by - Math.cos(a) * b.len, qx = bx + Math.sin(a * 0.4) * b.len * 0.5, qy = by - b.len * 0.55;
    g.strokeStyle = INK; g.lineWidth = b.w + 2.6; g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(qx, qy, tx, ty); g.stroke();
    g.strokeStyle = b.tone < 0.5 ? '#6e1c2a' : '#561424'; g.lineWidth = b.w; g.stroke();
    const mx = (bx + 2 * qx + tx) / 4, my = (by + 2 * qy + ty) / 4;
    g.strokeStyle = b.tone < 0.5 ? '#d0504c' : '#ad3c46'; g.lineWidth = b.w * 0.6; g.beginPath(); g.moveTo(mx, my); g.quadraticCurveTo((qx + tx) / 2, (qy + ty) / 2, tx, ty); g.stroke();
  }
}

// ---------- piezas del mapa por plantillas ----------

/** Muro "profundo": no toca nada recorrible en sus 8 vecinos; se deja en oscuridad. */
export function isDeepWall(map: GridMap, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const a = x + dx, b = y + dy;
    if (a < 0 || b < 0 || a >= map.width || b >= map.height) continue;
    const t = map.tiles[b * map.width + a];
    if (t !== WALL && t !== THIN && !isDiag(t)) return false;
  }
  return true;
}

const STONE_CAP = '#6a6687', STONE_FACE = '#3e3953';

/** Muro en diagonal en tres cuartos: tapa triangular levantada y, si mira al sur, su cara. */
export function drawDiagWall(g: Ctx, t: number, tx: number, ty: number, kinds: { TL: number; TR: number; BL: number; BR: number }) {
  const x0 = tx * TILE, y0 = ty * TILE, x1 = x0 + TILE, y1 = y0 + TILE, R = WALL_RISE;
  const tri: Pt[] = t === kinds.TL ? [[x0, y0], [x1, y0], [x0, y1]] : t === kinds.TR ? [[x0, y0], [x1, y0], [x1, y1]] : t === kinds.BL ? [[x0, y0], [x0, y1], [x1, y1]] : [[x1, y0], [x1, y1], [x0, y1]];
  if (t === kinds.TL || t === kinds.TR) {
    const [a, b] = t === kinds.TL ? [tri[1], tri[2]] : [tri[0], tri[2]];
    poly(g, [[a[0], a[1] - R], [b[0], b[1] - R], [b[0], b[1]], [a[0], a[1]]]);
    g.fillStyle = STONE_FACE; g.fill(); g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
    strokeP(g, [[a[0], a[1] - R + 3], [b[0], b[1] - R + 3]], 'rgba(190,175,215,.45)', 1.4);
  }
  poly(g, tri.map(([x, y]) => [x, y - R] as Pt));
  g.fillStyle = STONE_CAP; g.fill(); g.strokeStyle = INK; g.lineWidth = 3.4; g.stroke();
}

/** Muro delgado: igual que un muro, con grietas de brasa que delatan que se puede abrir. */
export function drawThinCracks(g: Ctx, tx: number, ty: number) {
  const x = tx * TILE, y = ty * TILE - WALL_RISE;
  glowP(g, [[x + 14, y + 10], [x + 26, y + 26], [x + 22, y + 40], [x + 36, y + 54]], '255,140,60', 0.7);
  glowP(g, [[x + 46, y + 18], [x + 38, y + 34]], '255,140,60', 0.6);
}

/** Escombros, cajas o estantes: cobertura de una casilla. */
export function drawCover(g: Ctx, tx: number, ty: number, variant: number) {
  const x = tx * TILE + 6, y = ty * TILE + 10, w = TILE - 12, h = TILE - 22, R = 22;
  if (variant % 3 === 2) { // escombros
    for (const [ox, oy, s] of [[8, 34, 18], [28, 30, 22], [40, 40, 14], [18, 18, 14]]) {
      poly(g, [[x + ox - s / 2, y + oy], [x + ox - s / 3, y + oy - s * 0.7], [x + ox + s / 3, y + oy - s * 0.8], [x + ox + s / 2, y + oy]]);
      g.fillStyle = '#5a5470'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2.6; g.stroke();
    }
    return;
  }
  // Caja: cara frontal y tapa levantada.
  poly(g, [[x, y + h - R], [x + w, y + h - R], [x + w, y + h], [x, y + h]]); g.fillStyle = '#6b3f26'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2.8; g.stroke();
  poly(g, [[x, y - R + 4], [x + w, y - R + 4], [x + w, y + h - R], [x, y + h - R]]); g.fillStyle = variant % 3 ? '#9a6238' : '#8a5530'; g.fill(); g.stroke();
  strokeP(g, [[x + 6, y - R + 12], [x + w - 6, y + h - R - 6]], '#5a3420', 2.2);
  strokeP(g, [[x, y + h - R + 8], [x + w, y + h - R + 8]], '#4a2a18', 2);
}

/** Barrotes: sello dorado de bóveda o reja de hierro de un solo sentido. */
export function drawBars(g: Ctx, tx: number, ty: number, gold: boolean, dir?: [number, number]) {
  const x = tx * TILE, y = ty * TILE, R = 46;
  const col = gold ? '#d9a54a' : '#7a7690', dark = gold ? '#8a5a1c' : '#3e3a52';
  poly(g, [[x + 2, y + TILE - 8 - R], [x + TILE - 2, y + TILE - 8 - R], [x + TILE - 2, y + TILE - 2 - R], [x + 2, y + TILE - 2 - R]]);
  g.fillStyle = dark; g.fill(); g.strokeStyle = INK; g.lineWidth = 2.4; g.stroke();
  for (let i = 0; i < 4; i++) {
    const bx = x + 9 + i * 15;
    poly(g, [[bx - 3, y + TILE - 6 - R], [bx + 3, y + TILE - 6 - R], [bx + 3, y + TILE - 6], [bx - 3, y + TILE - 6]]);
    g.fillStyle = col; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
  }
  if (dir) {
    // Flecha en el piso: hacia dónde se puede cruzar.
    const cx = x + TILE / 2 + dir[0] * 14, cy = y + TILE / 2 + dir[1] * 14 + 10, px = -dir[1], py = dir[0];
    poly(g, [[cx + dir[0] * 9, cy + dir[1] * 9], [cx + px * 8 - dir[0] * 4, cy + py * 8 - dir[1] * 4], [cx - px * 8 - dir[0] * 4, cy - py * 8 - dir[1] * 4]]);
    g.fillStyle = 'rgba(160,220,255,.85)'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
  }
}

/** Brasero de pie: grande para los hitos de cruce y llegada, pequeño en salas. */
export function drawBrazier(g: Ctx, x: number, y: number, big: boolean, flame: HTMLImageElement | undefined, sec: number, ph: number) {
  const s = big ? 1.7 : 1;
  poly(g, [[x - 12 * s, y], [x - 6 * s, y - 26 * s], [x + 6 * s, y - 26 * s], [x + 12 * s, y]]); g.fillStyle = '#2e2937'; g.fill(); g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
  poly(g, [[x - 22 * s, y - 34 * s], [x + 22 * s, y - 34 * s], [x + 16 * s, y - 24 * s], [x - 16 * s, y - 24 * s]]); g.fillStyle = '#3e3446'; g.fill(); g.stroke();
  strokeP(g, [[x - 18 * s, y - 31 * s], [x + 18 * s, y - 31 * s]], '#ff8a2a', 2.4);
  if (flame) { const f = 1 + Math.sin(sec * 11 + ph) * 0.08 + Math.sin(sec * 23 + ph) * 0.04; g.save(); g.translate(x, y - 32 * s); g.scale(s / f, s * f); g.drawImage(flame, -16, -42, 32, 42); g.restore(); }
}
