/**
 * Arte "Forja Apagada": tinta gruesa color ciruela, piedra con 2–3 tonos y luces saturadas.
 * Todo se genera con código (SVG y Canvas) a partir de la semilla del mapa, así que el
 * cliente no descarga texturas pesadas y cada partida se ve distinta pero coherente.
 */
import { TILE, WALL, createRng, type GridMap } from '@shared/index';

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

export interface Robe { robe: string; fold: string; hood: string; trim: string }
/** Túnica propia en ámbar; la de los demás en violeta para distinguirlos de un vistazo. */
export const ROBES: Record<'me' | 'other', Robe> = {
  me: { robe: '#e3922f', fold: '#a8601c', hood: '#7e3a1c', trim: '#ffd36a' },
  other: { robe: '#8a6ad0', fold: '#5d4396', hood: '#3f2a6a', trim: '#e2c8ff' },
};

function robeSvg(c: Robe, view: 'front' | 'side' | 'back'): string {
  const body = `<path d="M24 8C12 8 9 19 10 29C7 41 5 52 6 60H42C43 52 41 41 38 29C39 19 36 8 24 8Z" fill="${c.robe}" ${st(INK, 3.5)}/><path d="M15 40C17 50 16 56 15 60M33 40C31 50 32 56 33 60" fill="none" ${st(c.fold, 3)}/>`;
  const trim = view === 'back' ? '' : `<path d="M17 35L24 41L31 35" fill="none" ${st(c.trim, 2.5)}/>`;
  const hood = view === 'side'
    ? `<path d="M22 3C12 3 9 13 10 24C14 31 34 31 38 24C39 13 33 3 22 3Z" fill="${c.hood}" ${st(INK, 3.5)}/>`
    : view === 'back'
      ? `<path d="M24 3C13 3 9 13 10 26C16 33 32 33 38 26C39 13 35 3 24 3Z" fill="${c.hood}" ${st(INK, 3.5)}/><path d="M24 6V28" fill="none" ${st(shade(c.hood, -0.3), 2.5)}/>`
      : `<path d="M24 3C13 3 9 13 10 24C14 31 34 31 38 24C39 13 35 3 24 3Z" fill="${c.hood}" ${st(INK, 3.5)}/>`;
  const face = view === 'side'
    ? '<ellipse cx="30" cy="20" rx="7" ry="7" fill="#1a0a10"/><circle cx="32" cy="20" r="2.2" fill="#ffe7a8"/>'
    : view === 'front' ? '<ellipse cx="24" cy="20" rx="9" ry="7" fill="#1a0a10"/><circle cx="20.5" cy="20" r="2.2" fill="#ffe7a8"/><circle cx="27.5" cy="20" r="2.2" fill="#ffe7a8"/>' : '';
  return svg(48, 64, body + trim + hood + face);
}

const STAFF = svg(14, 60, `<rect x="5" y="14" width="4" height="44" rx="2" fill="#6b4226" ${st(INK, 2.5)}/><path d="M7 2L13 10L7 18L1 10Z" fill="#ffb347" ${st(INK, 2.5)}/>`);
const SKULL = svg(24, 20, `<path d="M12 2C4 2 2 8 3 12C4 15 6 15 6 18H18C18 15 20 15 21 12C22 8 20 2 12 2Z" fill="#e8dcc6" ${st(INK, 2.5)}/><circle cx="8.5" cy="10" r="2.3" fill="${INK}"/><circle cx="15.5" cy="10" r="2.3" fill="${INK}"/>`);
const FLAME = svg(40, 52, `<path d="M20 50C6 46 4 30 12 20C12 28 16 30 18 26C14 16 20 6 26 2C24 14 36 18 34 32C40 30 38 22 38 22C44 34 36 48 20 50Z" fill="#ff6a1a" ${st('#3a0d08', 3)}/><path d="M20 46C12 42 14 32 18 28C20 34 24 34 24 30C30 34 30 44 20 46Z" fill="#ffd56a"/>`);
const SCONCE = svg(30, 26, `<path d="M4 4H26L20 16H10Z" fill="#3e3446" ${st(INK, 3)}/><path d="M8 7H22" fill="none" ${st('#ff8a2a', 2)}/><path d="M15 16V24" fill="none" ${st(INK, 4)}/>`);

export type ImgKey = 'staff' | 'skull' | 'flame' | 'sconce' | `robe-${'me' | 'other'}-${'front' | 'side' | 'back'}`;

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
    for (const who of ['me', 'other'] as const) for (const v of ['front', 'side', 'back'] as const) add(`robe-${who}-${v}`, robeSvg(ROBES[who], v), true);
    add('staff', STAFF); add('skull', SKULL); add('flame', FLAME); add('sconce', SCONCE);
    for (const [k, c] of [['ember', '255,140,50'], ['violet', '170,120,255'], ['magenta', '255,90,216'], ['white', '255,240,255'], ['gold', '255,200,90']]) this.dot[k] = softDot(c);
  }
}

// ---------- monolito y estrado del portal ----------

export interface Prop { body: HTMLCanvasElement; glow: HTMLCanvasElement; w: number; h: number }

export function buildMonolith(seed: number): Prop {
  const r = createRng(seed ^ 0x51), runes: Pt[][] = [];
  const [body, g] = canvas(76, 156);
  for (let i = 0; i < 6; i++) { const x = 4 + r() * 60, s = 5 + r() * 7; paintStone(g, r, stonePts(r, x, 147 - s * 0.5, s * 1.5, s, 1.5), '#4a4560', 0.25); }
  const pl: Pt[] = [[8, 130], [68, 130], [70, 146], [6, 146]]; paintStone(g, r, pl, '#544d68', 0.25); poly(g, pl); g.strokeStyle = INK; g.lineWidth = 3.2; g.stroke();
  paintStone(g, r, [[18, 132], [20, 34], [38, 8], [38, 132]], '#6d6489', 0.2);
  paintStone(g, r, [[38, 8], [56, 34], [58, 132], [38, 132]], '#3d3551', 0.1);
  strokeP(g, [[38, 11], [38, 130]], '#a69cc4', 1.6);
  poly(g, [[18, 132], [20, 34], [38, 8], [56, 34], [58, 132]]); g.strokeStyle = INK; g.lineWidth = 3.4; g.stroke();
  for (const p of [[[28, 44], [28, 60]], [[24, 50], [32, 50]], [[24, 70], [32, 80]], [[32, 70], [24, 80]], [[28, 92], [28, 110]], [[24, 96], [28, 92], [32, 96]], [[46, 50], [50, 58], [46, 66]], [[47, 86], [47, 104]]] as Pt[][]) { runes.push(p); strokeP(g, p, '#241d33', 2.6); }
  const [glow, e] = canvas(76, 156);
  for (const p of runes) glowP(e, p, '255,90,216', 1);
  return { body, glow, w: 76, h: 156 };
}

const FLOOR_PAL = ['#4f4f6c', '#4a4964', '#545370', '#46455f', '#4d4a66', '#535068'];

export function buildDais(seed: number): Prop {
  const r = createRng(seed ^ 0xda15), cx = 105, cy = 62;
  const [body, g] = canvas(210, 124);
  g.fillStyle = '#120b18'; g.beginPath(); g.ellipse(cx, cy, 98, 52, 0, 0, 6.283); g.fill();
  const n = 16, pt = (a: number, rx: number, ry: number): Pt => [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 6.283 + 0.035, a1 = ((i + 1) / n) * 6.283 - 0.035, am = (a0 + a1) / 2;
    paintStone(g, r, [pt(a0, 94, 49), pt(am, 95.5, 50), pt(a1, 94, 49), pt(a1, 71, 37), pt(am, 70, 36.5), pt(a0, 71, 37)], FLOOR_PAL[i % FLOOR_PAL.length], 0.22);
  }
  g.strokeStyle = INK; g.lineWidth = 3.2; g.beginPath(); g.ellipse(cx, cy, 97, 51, 0, 0, 6.283); g.stroke();
  g.fillStyle = '#160c22'; g.beginPath(); g.ellipse(cx, cy, 68, 35, 0, 0, 6.283); g.fill(); g.stroke();
  const marks: Pt[][] = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283, x = cx + Math.cos(a) * 82, y = cy + Math.sin(a) * 43; const p: Pt[] = [[x - 3, y - 2], [x, y + 2], [x + 3, y - 2]]; marks.push(p); strokeP(g, p, '#241d33', 2); }
  const [glow, e] = canvas(210, 124);
  for (const p of marks) glowP(e, p, '170,120,255', 0.8);
  return { body, glow, w: 210, h: 124 };
}

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
  const solid = (x: number, y: number) => x < 0 || y < 0 || x >= map.width || y >= map.height || map.tiles[y * map.width + x] === WALL;
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
    if (solid(mx, my)) { f.fillStyle = '#140c18'; f.fillRect(X, Y, TILE, TILE); continue; }
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
  const solid = (a: number, b: number) => a >= 0 && b >= 0 && a < map.width && b < map.height && map.tiles[b * map.width + a] === WALL;
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
  const keep = [...map.spawns, ...map.portalCandidates, ...map.monoliths, map.vault];
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
    if (near(keep, px, py, 110)) continue;
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
