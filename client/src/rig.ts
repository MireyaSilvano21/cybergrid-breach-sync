/**
 * Dibujo de personajes por piezas sobre el esqueleto de shared/src/rig.ts.
 *
 * Mientras llega el lote 2 de Astra, cada pieza se pinta con formas planas y tinta gruesa
 * (cuerpo, 8 ropas y 6 cabezas del encargo). Cada pieza pertenece a un hueso y se dibuja en
 * las coordenadas de reposo del lienzo: cuando llegue el PNG de esa pieza, se dibuja en el mismo
 * lugar con la misma transformación y el resto del código no cambia.
 */
import {
  BODIES, solve, posedJoints, BONES, RIG_WORLD_SCALE,
  type Appearance, type BoneId, type BodyDef, type HeadId, type JointSet, type OutfitId, type Pose, type View,
} from '@shared/index';
import { INK, shade } from './art';

type Ctx = CanvasRenderingContext2D;
type P = [number, number];

// ---------- Ropas y cabezas del encargo ----------

interface Outfit {
  name: string; school: string;
  top: string; sleeve: string | null; pants: string; boots: string; trim: string;
  sleeves: 'long' | 'short' | 'none';
  /** Botas altas: cubren media pantorrilla. */
  tallBoots?: boolean;
  hood?: string; cape?: { c: string; len: 'short' | 'long' | 'tails' };
  skirt?: { c: string; kind: 'strips' | 'apron' | 'robe' | 'coat' };
  pauldron?: string; scarf?: string; veil?: string; shawl?: string; goggles?: boolean;
  /** Líneas de magia (runas, hilo dorado) del único color de magia del atuendo. */
  runes?: string; vest?: string; gloves?: string;
}

export const OUTFITS: Record<OutfitId, Outfit> = {
  tharven_aprendiz: { name: 'Aprendiz de cantera', school: 'Tharvén', top: '#e2d3b0', vest: '#b98a4e', sleeve: '#e2d3b0', sleeves: 'short', pants: '#7d746c', boots: '#5b4a40', trim: '#c9743a', tallBoots: true },
  tharven_guardia: { name: 'Guardia de basalto', school: 'Tharvén', top: '#5f6070', sleeve: '#4b4c5a', sleeves: 'long', pants: '#3f404c', boots: '#4d4e5c', trim: '#c9743a', pauldron: '#80818f', skirt: { c: '#6f4c36', kind: 'strips' }, runes: '#ff8a3a', gloves: '#6f4c36', tallBoots: true },
  seleth_novicia: { name: 'Sombra novicia', school: 'Seléth', top: '#2f2542', sleeve: '#2f2542', sleeves: 'long', pants: '#211b2d', boots: '#17121f', trim: '#c9c9d9', hood: '#3a2c52', cape: { c: '#3a2c52', len: 'short' }, scarf: '#1b1526', gloves: '#17121f' },
  seleth_velo: { name: 'Velo sin nombre', school: 'Seléth', top: '#261a33', sleeve: '#261a33', sleeves: 'long', pants: '#170f20', boots: '#2c1e3b', trim: '#d9d9ea', cape: { c: '#3d2757', len: 'tails' }, veil: '#c9a8f0', runes: '#c9a8f0', tallBoots: true, gloves: '#170f20' },
  vaerel_tejedor: { name: 'Tejedor de aldea', school: 'Vaerel', top: '#efe4c8', sleeve: '#efe4c8', sleeves: 'long', pants: '#7d8f6e', boots: '#8a6a4a', trim: '#d9a93a', shawl: '#8fae84', skirt: { c: '#c7b186', kind: 'apron' } },
  vaerel_hilo: { name: 'Hilo mayor', school: 'Vaerel', top: '#6f8f63', sleeve: '#efe4c8', sleeves: 'long', pants: '#5b7552', boots: '#6b5440', trim: '#e2b23e', skirt: { c: '#6f8f63', kind: 'robe' }, runes: '#ffd36a' },
  orrath_vigia: { name: 'Vigía de colina', school: 'Orrath', top: '#d9c39a', sleeve: '#d9c39a', sleeves: 'long', pants: '#b39c72', boots: '#6a5a48', trim: '#f4efe2', cape: { c: '#5f9aa8', len: 'short' }, scarf: '#f4efe2', goggles: true },
  orrath_tormenta: { name: 'Voz de tormenta', school: 'Orrath', top: '#e8e4da', sleeve: '#3f6b8a', sleeves: 'long', pants: '#c4b08a', boots: '#4a5a6a', trim: '#f4efe2', cape: { c: '#3f6b8a', len: 'long' }, skirt: { c: '#3f6b8a', kind: 'coat' }, runes: '#6ff0ff', hood: '#2f5470' },
};

/** Malla neutra de los cuerpos base (así se pidieron los cuerpos en el lote 1). */
export const BASE_OUTFIT: Outfit = { name: 'Cuerpo base', school: '', top: '#4a4656', sleeve: '#4a4656', sleeves: 'long', pants: '#3f3b4a', boots: '#34303e', trim: '#4a4656' };

interface Head { name: string; skin: string; hair: string; style: 'messy' | 'ponytail' | 'topknot' | 'curly' | 'bob' | 'short'; freckles?: boolean; scar?: boolean; beard?: boolean; old?: boolean }
export const HEADS: Record<HeadId, Head> = {
  a: { name: 'A · despeinado', skin: '#a86a45', hair: '#2a1a14', style: 'messy' },
  b: { name: 'B · cola baja', skin: '#f2d2b6', hair: '#7a5230', style: 'ponytail', freckles: true },
  c: { name: 'C · chongo', skin: '#5a3424', hair: '#1a1010', style: 'topknot', scar: true },
  d: { name: 'D · rizado', skin: '#c99a6a', hair: '#3a2418', style: 'curly' },
  e: { name: 'E · flequillo', skin: '#f0cfb0', hair: '#1f5a5a', style: 'bob' },
  f: { name: 'F · canoso', skin: '#b9875e', hair: '#bdb8ae', style: 'short', beard: true, old: true },
};

// ---------- Pintura ----------

const LW = 26;
const colorCache = new Map<string, string>();
/** Variante de color: más clara para el destello de golpe, más oscura para las extremidades lejanas. */
function col(c: string, k: number): string {
  if (!k) return c;
  const key = c + k; let v = colorCache.get(key);
  if (!v) { v = shade(c, k); colorCache.set(key, v); }
  return v;
}

interface Paint { g: Ctx; k: number; ink: boolean }
function fillStroke(p: Paint, fill: string, lw = LW) {
  p.g.fillStyle = col(fill, p.k); p.g.fill();
  if (p.ink) { p.g.lineWidth = lw; p.g.strokeStyle = INK; p.g.stroke(); }
}
function capsule(p: Paint, a: P, b: P, w: number, fill: string) {
  const g = p.g, dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, nx = -dy / d * w / 2, ny = dx / d * w / 2;
  const ang = Math.atan2(dy, dx);
  g.beginPath(); g.moveTo(a[0] + nx, a[1] + ny); g.lineTo(b[0] + nx, b[1] + ny);
  g.arc(b[0], b[1], w / 2, ang + Math.PI / 2, ang - Math.PI / 2, true);
  g.lineTo(a[0] - nx, a[1] - ny);
  g.arc(a[0], a[1], w / 2, ang - Math.PI / 2, ang + Math.PI / 2, true);
  g.closePath(); fillStroke(p, fill);
}
function ellipse(p: Paint, x: number, y: number, rx: number, ry: number, fill: string, lw = LW) {
  p.g.beginPath(); p.g.ellipse(x, y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2); fillStroke(p, fill, lw);
}
function shape(p: Paint, pts: P[], fill: string, smooth = true, lw = LW) {
  const g = p.g; g.beginPath();
  if (!smooth) { g.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) g.lineTo(q[0], q[1]); }
  else {
    // Curva cerrada que pasa por los puntos medios: esquinas suaves, aspecto de recorte de papel.
    const n = pts.length, mid = (i: number): P => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2];
    const m0 = mid(n - 1); g.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) { const m = mid(i); g.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
  }
  g.closePath(); fillStroke(p, fill, lw);
}
function line(p: Paint, pts: P[], color: string, w: number) {
  const g = p.g; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) g.lineTo(q[0], q[1]);
  g.strokeStyle = col(color, p.k); g.lineWidth = w; g.stroke();
}

// ---------- Piezas ----------

interface Ctx2 { p: Paint; j: JointSet; b: BodyDef; o: Outfit; h: Head; view: View; team: string; t: number }
type Piece = { bone: BoneId; far?: boolean; draw: (c: Ctx2) => void };

function headGeo(c: Ctx2) {
  const L = c.b.dims.headLen, top = c.j.headTop, side = c.view === 'side';
  const cx = top[0] + (side ? L * 0.04 : 0), cy = top[1] + L * 0.47, rx = L * (side ? 0.41 : 0.42), ry = L * 0.43;
  return { L, cx, cy, rx, ry, side };
}

const neck: Piece = { bone: 'head', draw: (c) => {
  const { cx, cy, ry, L } = headGeo(c);
  capsule(c.p, [cx - (c.view === 'side' ? L * 0.03 : 0), cy + ry * 0.7], [c.j.neck[0], c.j.neck[1] + L * 0.05], L * 0.2, c.h.skin);
} };

const hairBack: Piece = { bone: 'head', draw: (c) => {
  const { cx, cy, rx, ry, side } = headGeo(c), s = c.h.style, hair = c.h.hair;
  if (c.o.hood) {
    // Capucha: la parte de atrás es más grande que la cabeza.
    ellipse(c.p, cx - (side ? rx * 0.12 : 0), cy - ry * 0.05, rx * 1.2, ry * 1.18, c.o.hood);
    return;
  }
  if (s === 'curly') { for (const [dx, dy, r] of [[-0.8, -0.3, 0.45], [0.8, -0.3, 0.45], [-0.6, 0.35, 0.4], [0.6, 0.35, 0.4], [0, -0.75, 0.55], [-0.55, -0.7, 0.45], [0.55, -0.7, 0.45]]) ellipse(c.p, cx + dx * rx * (side ? 0.8 : 1) - (side ? rx * 0.15 : 0), cy + dy * ry, r * rx, r * ry, hair); }
  else if (s === 'bob') shape(c.p, [[cx - rx * 1.12, cy - ry * 0.2], [cx - rx * 0.8, cy - ry * 1.15], [cx + rx * 0.8, cy - ry * 1.15], [cx + rx * 1.12, cy - ry * 0.2], [cx + rx * 1.1, cy + ry * 0.75], [cx - rx * 1.1, cy + ry * 0.75]], hair);
  else if (s === 'ponytail') {
    const tx = side ? cx - rx * 1.05 : cx + (c.view === 'front' ? rx * 0.95 : 0), ty = cy + ry * 0.35;
    const sway = Math.sin(c.t * 3) * rx * 0.06;
    shape(c.p, [[tx - rx * 0.18, ty - ry * 0.3], [tx + rx * 0.18, ty - ry * 0.3], [tx + rx * 0.2 + sway, ty + ry * 0.9], [tx + sway, ty + ry * 1.25], [tx - rx * 0.2 + sway, ty + ry * 0.9]], hair);
  }
} };

const face: Piece = { bone: 'head', draw: (c) => {
  const { cx, cy, rx, ry, side, L } = headGeo(c), p = c.p, h = c.h, v = c.view;
  // Oreja (de lado) y cabeza.
  ellipse(p, cx, cy, rx, ry, h.skin);
  if (v === 'back') return;
  const ink = col(INK, 0);
  if (side) {
    // Nariz y un ojo hacia adelante.
    shape(p, [[cx + rx * 0.92, cy - ry * 0.02], [cx + rx * 1.1, cy + ry * 0.18], [cx + rx * 0.9, cy + ry * 0.24]], h.skin, false, LW * 0.7);
    ellipse(p, cx - rx * 0.12, cy + ry * 0.1, rx * 0.16, ry * 0.2, shade(h.skin, -0.12), LW * 0.7);
    p.g.fillStyle = ink; p.g.beginPath(); p.g.ellipse(cx + rx * 0.5, cy + ry * 0.05, rx * 0.1, ry * 0.15, 0, 0, 6.283); p.g.fill();
    p.g.fillStyle = '#fff'; p.g.beginPath(); p.g.arc(cx + rx * 0.53, cy - ry * 0.01, rx * 0.04, 0, 6.283); p.g.fill();
    if (h.freckles) { p.g.fillStyle = col('#b0603c', p.k); for (const d of [0.62, 0.72]) { p.g.beginPath(); p.g.arc(cx + rx * d, cy + ry * 0.32, rx * 0.025, 0, 6.283); p.g.fill(); } }
    if (h.scar) line(p, [[cx + rx * 0.4, cy - ry * 0.28], [cx + rx * 0.62, cy - ry * 0.12]], '#f0b8a0', LW * 0.45);
    return;
  }
  for (const sx of [-1, 1]) {
    const ex = cx + sx * rx * 0.36, ey = cy + ry * 0.08;
    p.g.fillStyle = ink; p.g.beginPath(); p.g.ellipse(ex, ey, rx * 0.1, ry * 0.15, 0, 0, 6.283); p.g.fill();
    p.g.fillStyle = '#fff'; p.g.beginPath(); p.g.arc(ex + rx * 0.03, ey - ry * 0.06, rx * 0.04, 0, 6.283); p.g.fill();
    if (h.old) line(p, [[ex - rx * 0.12, ey - ry * 0.22], [ex + rx * 0.12, ey - ry * 0.24]], h.hair, LW * 0.6);
    if (h.freckles) { p.g.fillStyle = col('#b0603c', p.k); for (const d of [-0.08, 0.08]) { p.g.beginPath(); p.g.arc(ex + d * rx, cy + ry * 0.36, rx * 0.025, 0, 6.283); p.g.fill(); } }
  }
  if (h.scar) line(p, [[cx + rx * 0.24, cy - ry * 0.2], [cx + rx * 0.46, cy - ry * 0.04]], '#f0b8a0', LW * 0.45);
  line(p, [[cx - rx * 0.1, cy + ry * 0.48], [cx + rx * 0.1, cy + ry * 0.48]], shade(h.skin, -0.45), LW * 0.5);
  void L;
} };

const hairFront: Piece = { bone: 'head', draw: (c) => {
  const { cx, cy, rx, ry, side } = headGeo(c), p = c.p, h = c.h, hair = h.hair, v = c.view;
  if (h.beard && v !== 'back') {
    if (side) shape(p, [[cx - rx * 0.1, cy + ry * 0.2], [cx + rx * 0.95, cy + ry * 0.35], [cx + rx * 0.7, cy + ry * 1.05], [cx + rx * 0.05, cy + ry * 0.85]], hair);
    else shape(p, [[cx - rx * 0.85, cy + ry * 0.2], [cx + rx * 0.85, cy + ry * 0.2], [cx + rx * 0.6, cy + ry * 0.95], [cx, cy + ry * 1.12], [cx - rx * 0.6, cy + ry * 0.95]], hair);
  }
  if (c.o.hood) return;
  const top = cy - ry;
  if (v === 'back') {
    // De espaldas el pelo cubre casi toda la cabeza.
    const low = h.style === 'topknot' || h.style === 'short' ? 0.45 : h.style === 'messy' ? 0.6 : 0.85;
    shape(p, [[cx - rx * 1.04, cy + ry * low], [cx - rx * 1.05, cy - ry * 0.3], [cx - rx * 0.6, top - ry * 0.08], [cx + rx * 0.6, top - ry * 0.08], [cx + rx * 1.05, cy - ry * 0.3], [cx + rx * 1.04, cy + ry * low]], h.style === 'topknot' ? shade(hair, 0.25) : hair);
    if (h.style === 'topknot') ellipse(p, cx, top - ry * 0.12, rx * 0.32, ry * 0.26, hair);
    if (h.style === 'ponytail') ellipse(p, cx, cy + ry * 0.5, rx * 0.16, ry * 0.12, h.hair);
    return;
  }
  const f = side ? 1 : 0; // de lado el pelo se carga hacia atrás
  switch (h.style) {
    case 'messy': shape(p, [[cx - rx * 1.05, cy + ry * 0.05 - f * ry * 0.0], [cx - rx * 1.0, cy - ry * 0.6], [cx - rx * 0.4, top - ry * 0.12], [cx + rx * 0.5, top - ry * 0.1], [cx + rx * 1.05, cy - ry * 0.55], [cx + rx * (side ? 0.95 : 1.05), cy - ry * 0.05], [cx + rx * 0.55, cy - ry * 0.42], [cx + rx * 0.3, cy - ry * 0.18], [cx, cy - ry * 0.45], [cx - rx * 0.35, cy - ry * 0.2], [cx - rx * 0.6, cy - ry * 0.45]], hair, false); break;
    case 'ponytail': shape(p, [[cx - rx * 1.03, cy - ry * 0.05], [cx - rx * 0.85, cy - ry * 0.75], [cx, top - ry * 0.06], [cx + rx * 0.85, cy - ry * 0.75], [cx + rx * 1.03, cy - ry * 0.05], [cx + rx * 0.7, cy - ry * 0.5], [cx - rx * 0.15, cy - ry * 0.55]], hair); break;
    case 'topknot':
      shape(p, [[cx - rx * 1.0, cy - ry * 0.05], [cx - rx * 0.8, cy - ry * 0.78], [cx, top - ry * 0.04], [cx + rx * 0.8, cy - ry * 0.78], [cx + rx * 1.0, cy - ry * 0.05], [cx + rx * 0.4, cy - ry * 0.55], [cx - rx * 0.4, cy - ry * 0.55]], shade(hair, 0.25));
      ellipse(p, cx - f * rx * 0.25, top - ry * 0.12, rx * 0.32, ry * 0.26, hair); break;
    case 'curly': for (const [dx, dy, r] of [[-0.6, -0.65, 0.38], [0, -0.85, 0.42], [0.6, -0.65, 0.38], [-0.85, -0.2, 0.3], [0.85, -0.2, 0.3]]) ellipse(p, cx + dx * rx - f * rx * 0.2, cy + dy * ry, r * rx, r * ry, hair); break;
    case 'bob': shape(p, [[cx - rx * 1.08, cy + ry * 0.1], [cx - rx * 0.95, cy - ry * 0.75], [cx, top - ry * 0.08], [cx + rx * 0.95, cy - ry * 0.75], [cx + rx * 1.08, cy + (side ? -ry * 0.25 : ry * 0.1)], [cx + rx * 0.75, cy - ry * 0.25], [cx - rx * 0.75, cy - ry * 0.25]], hair, false); break;
    case 'short': shape(p, [[cx - rx * 1.0, cy - ry * 0.1], [cx - rx * 0.8, cy - ry * 0.8], [cx, top - ry * 0.05], [cx + rx * 0.8, cy - ry * 0.8], [cx + rx * 1.0, cy - ry * 0.1], [cx + rx * 0.5, cy - ry * 0.55], [cx - rx * 0.5, cy - ry * 0.55]], hair); break;
  }
} };

const hoodFront: Piece = { bone: 'head', draw: (c) => {
  const { cx, cy, rx, ry, side } = headGeo(c), hood = c.o.hood, p = c.p;
  if (!hood) return;
  if (c.view === 'back') { ellipse(p, cx, cy - ry * 0.05, rx * 1.18, ry * 1.16, hood); line(p, [[cx, cy - ry * 1.0], [cx, cy + ry * 0.9]], shade(hood, -0.3), LW * 0.6); return; }
  // Marco de la capucha alrededor de la cara.
  const g = p.g; g.beginPath();
  if (side) {
    g.moveTo(cx + rx * 0.55, cy + ry * 0.9); g.quadraticCurveTo(cx + rx * 0.7, cy - ry * 1.25, cx - rx * 0.4, cy - ry * 1.2);
    g.quadraticCurveTo(cx - rx * 1.45, cy - ry * 0.4, cx - rx * 1.0, cy + ry * 1.0); g.closePath();
  } else {
    g.moveTo(cx - rx * 1.18, cy + ry * 0.9); g.quadraticCurveTo(cx - rx * 1.3, cy - ry * 1.3, cx, cy - ry * 1.22);
    g.quadraticCurveTo(cx + rx * 1.3, cy - ry * 1.3, cx + rx * 1.18, cy + ry * 0.9);
    g.lineTo(cx + rx * 0.8, cy + ry * 0.75); g.quadraticCurveTo(cx + rx * 0.9, cy - ry * 0.75, cx, cy - ry * 0.78);
    g.quadraticCurveTo(cx - rx * 0.9, cy - ry * 0.75, cx - rx * 0.8, cy + ry * 0.75); g.closePath();
  }
  fillStroke(p, hood);
} };

const accessories: Piece = { bone: 'head', draw: (c) => {
  const { cx, cy, rx, ry, side } = headGeo(c), o = c.o, p = c.p;
  if (c.view === 'back') { if (o.goggles) line(p, [[cx - rx * 1.0, cy - ry * 0.35], [cx + rx * 1.0, cy - ry * 0.35]], '#4a3a2c', LW * 1.2); return; }
  if (o.veil) {
    p.g.globalAlpha = 0.82;
    shape(p, side ? [[cx + rx * 0.05, cy + ry * 0.25], [cx + rx * 1.12, cy + ry * 0.2], [cx + rx * 0.9, cy + ry * 1.25], [cx + rx * 0.1, cy + ry * 0.95]] : [[cx - rx * 0.95, cy + ry * 0.25], [cx + rx * 0.95, cy + ry * 0.25], [cx + rx * 0.7, cy + ry * 1.3], [cx, cy + ry * 1.45], [cx - rx * 0.7, cy + ry * 1.3]], o.veil, true, LW * 0.8);
    p.g.globalAlpha = 1;
  }
  if (o.goggles) {
    const y = cy - ry * 0.55;
    if (side) { line(p, [[cx - rx * 0.9, y + ry * 0.12], [cx + rx * 0.4, y]], '#4a3a2c', LW * 1.2); ellipse(p, cx + rx * 0.6, y, rx * 0.22, ry * 0.2, '#7fd6e0'); }
    else { line(p, [[cx - rx * 1.0, y], [cx + rx * 1.0, y]], '#4a3a2c', LW * 1.2); for (const sx of [-1, 1]) ellipse(p, cx + sx * rx * 0.36, y, rx * 0.25, ry * 0.21, '#7fd6e0'); }
  }
} };

function torsoPts(c: Ctx2): P[] {
  const j = c.j, d = c.b.dims, v = c.view, top = j.neck[1] + d.headLen * 0.04, bot = j.hip[1] + d.leg * 0.35;
  if (v === 'side') {
    const w = d.torsoD / 2, x0 = j.neck[0] * 0.5;
    return [[x0 - w * 0.8, top], [x0 + w * 0.7, top], [x0 + w * 1.05, top + (bot - top) * 0.35], [w * 0.9, bot], [-w * 0.95, bot], [x0 - w * 1.0, top + (bot - top) * 0.4]];
  }
  const sw = d.shoulderW / 2 + d.arm * 0.3, hw = d.hipW / 2 + 6;
  return [[-sw * 0.85, top], [sw * 0.85, top], [sw, top + d.arm * 0.5], [hw * 1.02, j.hip[1] - (j.hip[1] - top) * 0.35], [hw, bot], [-hw, bot], [-hw * 1.02, j.hip[1] - (j.hip[1] - top) * 0.35], [-sw, top + d.arm * 0.5]];
}

const torso: Piece = { bone: 'torso', draw: (c) => {
  const o = c.o, p = c.p, pts = torsoPts(c), j = c.j, d = c.b.dims, v = c.view;
  shape(p, pts, o.top);
  const top = pts[0][1], bot = j.hip[1];
  if (o.vest) {
    if (v === 'front') { shape(p, [[pts[0][0], top], [pts[0][0] * 0.35, top], [-6, bot], [pts[5][0], bot + d.leg * 0.3], [pts[7][0] * 0.9, top + d.arm * 0.5]], o.vest); shape(p, [[pts[1][0], top], [pts[1][0] * 0.35, top], [6, bot], [pts[4][0], bot + d.leg * 0.3], [pts[2][0] * 0.9, top + d.arm * 0.5]], o.vest); }
    else if (v === 'back') shape(p, [[pts[0][0] * 0.95, top], [pts[1][0] * 0.95, top], [pts[2][0] * 0.95, top + d.arm * 0.5], [pts[4][0], bot + d.leg * 0.3], [pts[5][0], bot + d.leg * 0.3], [pts[7][0] * 0.95, top + d.arm * 0.5]], o.vest);
    else shape(p, [[pts[0][0], top], [pts[1][0] * 0.7, top], [pts[3][0], bot + d.leg * 0.3], [pts[4][0], bot + d.leg * 0.3], [pts[5][0], top + (bot - top) * 0.4]], o.vest);
  }
  if (o.shawl) {
    if (v === 'side') shape(p, [[pts[0][0] - 10, top - 10], [pts[1][0] + 14, top - 10], [pts[2][0] + 10, top + (bot - top) * 0.45], [pts[5][0] - 10, top + (bot - top) * 0.5]], o.shawl);
    else shape(p, [[pts[0][0] - 14, top - 8], [pts[1][0] + 14, top - 8], [pts[2][0] + 6, top + d.arm * 0.6], [0, top + (bot - top) * (v === 'front' ? 0.62 : 0.5)], [pts[7][0] - 6, top + d.arm * 0.6]], o.shawl);
    for (const t of [-0.5, 0, 0.5]) line(p, [[t * d.shoulderW * 0.5, top + (bot - top) * 0.2], [t * d.shoulderW * 0.5, top + (bot - top) * 0.32]], o.trim, LW * 0.5);
  }
  if (v === 'front' && !o.vest && !o.shawl) line(p, [[0, top + 8], [0, bot - 10]], shade(o.top, -0.25), LW * 0.55);
  if (o.runes && v !== 'side') {
    const ry = top + (bot - top) * 0.35, w = d.shoulderW * 0.22;
    line(p, [[-w, ry], [-w * 0.3, ry + w * 0.6], [w * 0.3, ry], [w, ry + w * 0.6]], o.runes, LW * 0.55);
    if (v === 'front') { p.g.fillStyle = col(o.runes, p.k); for (const [x, y] of [[-w * 1.2, ry - w], [w * 1.1, ry - w * 0.8], [0, ry + w * 1.4]]) { p.g.beginPath(); p.g.arc(x, y, LW * 0.45, 0, 6.283); p.g.fill(); } }
  }
  if (o.scarf && v !== 'back') {
    const ny = top + 4, w = (v === 'side' ? d.torsoD * 0.45 : d.shoulderW * 0.36);
    shape(p, [[j.neck[0] * 0.5 - w, ny - 26], [j.neck[0] * 0.5 + w, ny - 26], [j.neck[0] * 0.5 + w * 0.9, ny + 40], [j.neck[0] * 0.5 - w * 0.9, ny + 40]], o.scarf);
    const flutter = Math.sin(c.t * 6) * 18;
    if (v === 'side') shape(p, [[-w * 0.6, ny], [-w * 0.2, ny + 20], [-w * 2.6, ny + 70 + flutter], [-w * 2.8, ny + 30 + flutter]], o.scarf);
    else shape(p, [[w * 0.2, ny + 20], [w * 0.75, ny + 20], [w * 0.7, ny + 190], [w * 0.25, ny + 170]], o.scarf);
  }
} };

const sash: Piece = { bone: 'pelvis', draw: (c) => {
  const j = c.j, d = c.b.dims, v = c.view, y = j.hip[1] - d.leg * 0.15, hgt = Math.max(46, d.height * 0.045);
  const w = v === 'side' ? d.torsoD / 2 * 1.02 : d.hipW / 2 + 12;
  shape(c.p, [[-w, y - hgt / 2], [w, y - hgt / 2], [w * 1.02, y + hgt / 2], [-w * 1.02, y + hgt / 2]], c.team, false);
  // Nudo con caída: el color del equipo se lee desde lejos.
  const kx = v === 'side' ? -w * 0.7 : v === 'front' ? w * 0.55 : -w * 0.55, sway = Math.sin(c.t * 4) * 8;
  shape(c.p, [[kx - 18, y], [kx + 18, y], [kx + 26 + sway, y + hgt * 2.2], [kx + 2 + sway, y + hgt * 1.9]], c.team, false);
} };

const pelvis: Piece = { bone: 'pelvis', draw: (c) => {
  const j = c.j, d = c.b.dims, v = c.view, w = v === 'side' ? d.torsoD / 2 * 0.95 : d.hipW / 2 + 4;
  shape(c.p, [[-w, j.hip[1] - d.leg * 0.4], [w, j.hip[1] - d.leg * 0.4], [w, j.hip[1] + d.leg * 0.6], [-w, j.hip[1] + d.leg * 0.6]], c.o.pants);
} };

const skirt: Piece = { bone: 'skirt', draw: (c) => {
  const s = c.o.skirt; if (!s) return;
  const j = c.j, d = c.b.dims, v = c.view, y0 = j.hip[1] - d.leg * 0.1;
  const len = s.kind === 'robe' ? (j.ankleL[1] - y0) * 0.78 : s.kind === 'coat' ? (j.kneeL[1] - y0) * 1.15 : s.kind === 'apron' ? (j.kneeL[1] - y0) * 0.85 : (j.kneeL[1] - y0) * 0.7;
  const w0 = v === 'side' ? d.torsoD / 2 : d.hipW / 2 + 10, w1 = w0 * (s.kind === 'strips' ? 1.15 : 1.3);
  if (s.kind === 'apron' && v === 'back') return;
  if (s.kind === 'apron') { shape(c.p, [[-w0 * 0.7, y0], [w0 * 0.7, y0], [w0 * 0.8, y0 + len], [-w0 * 0.8, y0 + len]], s.c); line(c.p, [[-w0 * 0.3, y0 + len * 0.45], [w0 * 0.3, y0 + len * 0.45]], c.o.trim, LW * 0.5); return; }
  if (s.kind === 'strips') {
    const n = v === 'side' ? 2 : 4;
    for (let i = 0; i < n; i++) { const a = -w1 + (2 * w1 * i) / n, b = a + (2 * w1) / n; shape(c.p, [[a + 4, y0], [b - 4, y0], [b - 2, y0 + len], [a + 2, y0 + len]], i % 2 ? shade(s.c, -0.12) : s.c, false); }
    return;
  }
  const back = v === 'side' ? -w1 * 0.4 : 0;
  shape(c.p, [[-w0, y0], [w0, y0], [w1 + (v === 'side' ? 0 : 0), y0 + len], [v === 'front' && s.kind === 'coat' ? w1 * 0.25 : 0, y0 + len * (v === 'front' && s.kind === 'coat' ? 0.55 : 1.02)], [-w1 + back, y0 + len]], s.c);
  if (c.o.runes) line(c.p, [[-w1 * 0.8 + back, y0 + len * 0.85], [w1 * 0.8, y0 + len * 0.85]], c.o.runes, LW * 0.5);
} };

const cape: Piece = { bone: 'cape', draw: (c) => {
  const k = c.o.cape; if (!k) return;
  const j = c.j, d = c.b.dims, v = c.view, top = j.neck[1] + d.headLen * 0.05;
  const end = k.len === 'short' ? j.hip[1] + d.leg * 0.2 : k.len === 'long' ? j.kneeL[1] + (j.ankleL[1] - j.kneeL[1]) * 0.3 : j.kneeL[1];
  const sw = d.shoulderW / 2 + d.arm * 0.45;
  if (v === 'side') {
    const back = -(d.torsoD * 0.6 + (k.len === 'short' ? 40 : 90));
    if (k.len === 'tails') { for (const dx of [0, 40]) shape(c.p, [[-d.torsoD * 0.35, top], [d.torsoD * 0.1, top], [back * 0.6 + dx, end - 60], [back + dx, end + 30]], dx ? shade(k.c, -0.15) : k.c); return; }
    shape(c.p, [[-d.torsoD * 0.35, top - 10], [d.torsoD * 0.15, top], [back * 0.5, end], [back, end - 30], [back * 0.8, (top + end) / 2]], k.c);
    return;
  }
  if (k.len === 'tails') {
    for (const sx of [-1, 1]) shape(c.p, [[sx * sw * 0.15, top + 30], [sx * sw * 0.95, top + 20], [sx * sw * 0.85, end], [sx * sw * 0.45, end + 50]], k.c);
    return;
  }
  shape(c.p, [[-sw * 0.85, top - 10], [sw * 0.85, top - 10], [sw * 1.08, end], [0, end + 25], [-sw * 1.08, end]], v === 'front' ? shade(k.c, -0.25) : k.c);
  if (v === 'back') line(c.p, [[-sw * 0.4, top + 60], [-sw * 0.45, end - 30]], shade(k.c, -0.2), LW * 0.6);
} };

function arm(side: 'L' | 'R', far = false): Piece[] {
  const up = `upperArm${side}` as BoneId, fo = `forearm${side}` as BoneId, ha = `hand${side}` as BoneId;
  const sh = `shoulder${side}` as const, el = `elbow${side}` as const, wr = `wrist${side}` as const;
  return [
    { bone: up, far, draw: (c) => {
      const o = c.o, w = c.b.dims.arm;
      capsule(c.p, c.j[sh], c.j[el], w, o.sleeves === 'none' ? c.h.skin : (o.sleeve ?? o.top));
      if (o.pauldron) { ellipse(c.p, c.j[sh][0] + (c.view === 'side' ? 0 : (side === 'R' ? 10 : -10)), c.j[sh][1] + 6, w * 0.95, w * 0.7, o.pauldron); if (o.runes) line(c.p, [[c.j[sh][0] - w * 0.35, c.j[sh][1] + 6], [c.j[sh][0] + w * 0.35, c.j[sh][1] + 6]], o.runes, LW * 0.5); }
    } },
    { bone: fo, far, draw: (c) => {
      const o = c.o, w = c.b.dims.arm * 0.92;
      capsule(c.p, c.j[el], c.j[wr], w, o.sleeves === 'long' ? (o.sleeve ?? o.top) : c.h.skin);
      if (o.sleeves === 'long') line(c.p, [[c.j[wr][0] - w * 0.45, c.j[wr][1] - w * 0.4], [c.j[wr][0] + w * 0.45, c.j[wr][1] - w * 0.4]], o.trim, LW * 0.5);
    } },
    { bone: ha, far, draw: (c) => { const w = c.b.dims.arm; ellipse(c.p, c.j[wr][0], c.j[wr][1] + w * 0.35, w * 0.5, w * 0.55, c.o.gloves ?? c.h.skin); } },
  ];
}

function leg(side: 'L' | 'R', far = false): Piece[] {
  const th = `thigh${side}` as BoneId, sh = `shin${side}` as BoneId, ft = `foot${side}` as BoneId;
  const hp = `hip${side}` as const, kn = `knee${side}` as const, an = `ankle${side}` as const;
  return [
    { bone: th, far, draw: (c) => capsule(c.p, c.j[hp], c.j[kn], c.b.dims.leg, c.o.pants) },
    { bone: sh, far, draw: (c) => {
      const w = c.b.dims.leg * 0.9, k = c.j[kn], a = c.j[an];
      capsule(c.p, k, a, w, c.o.pants);
      const bt: P = c.o.tallBoots ? [k[0] + (a[0] - k[0]) * 0.35, k[1] + (a[1] - k[1]) * 0.35] : [k[0] + (a[0] - k[0]) * 0.7, k[1] + (a[1] - k[1]) * 0.7];
      capsule(c.p, bt, a, w * 1.08, c.o.boots);
    } },
    { bone: ft, far, draw: (c) => {
      const a = c.j[an], w = c.b.dims.leg;
      if (c.view === 'side') shape(c.p, [[a[0] - w * 0.55, a[1] - w * 0.3], [a[0] + w * 0.4, a[1] - w * 0.3], [a[0] + w * 1.15, a[1] + w * 0.15], [a[0] + w * 1.1, a[1] + w * 0.62], [a[0] - w * 0.55, a[1] + w * 0.62]], c.o.boots);
      else ellipse(c.p, a[0] + (side === 'R' ? 4 : -4), a[1] + w * 0.25, w * 0.7, w * 0.5, c.o.boots);
    } },
  ];
}

/**
 * Foco en la mano: formas provisionales de las 10 armas de referencia (el arte final las reemplaza).
 * Se dibujan en la mano derecha; las Espadas Gemelas llevan una hoja en cada mano.
 */
function weapon(foco: string, hand: 'R' | 'L' = 'R'): Piece {
  return { bone: hand === 'R' ? 'handR' : 'handL', draw: (c) => {
    const w = hand === 'R' ? c.j.wristR : c.j.wristL, a = c.b.dims.arm, p = c.p, H = c.b.dims.height;
    const x = w[0] + (c.view === 'side' ? a * 0.15 : 0), y0 = w[1] + a * 0.35;
    const glow = (gx: number, gy: number, r: number, rgb: string) => {
      const g = p.g, gr = g.createRadialGradient(gx, gy, 0, gx, gy, r);
      gr.addColorStop(0, `rgba(${rgb},.7)`); gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(gx, gy, r, 0, 6.283); g.fill();
    };
    const shaft = (top: number, bot: number, col: string, wd = 1.7) => capsule(p, [x, bot], [x, top], LW * wd, col);
    switch (foco) {
      case 'daga': // hoja curva carmesí, mango claro con guarda dorada
        shape(p, [[x - 26, y0 - 30], [x + 22, y0 - 30], [x + 40, y0 - H * 0.16], [x + 20, y0 - H * 0.3], [x - 4, y0 - H * 0.2]], '#c8323c');
        capsule(p, [x - 48, y0 - 26], [x + 48, y0 - 26], LW * 1.3, '#d9a93a');
        shaft(y0 - 20, y0 + 40, '#e8e0d0', 1.4);
        return;
      case 'llama': { // hoja de fuego ondulada sobre un mango rojo
        glow(x, y0 - H * 0.28, a * 2.4, '255,180,60');
        const pts: [number, number][] = [];
        for (let k = 0; k <= 8; k++) pts.push([x + Math.sin(k * 0.9 + c.t * 6) * 18 + 16, y0 - 50 - k * H * 0.055]);
        for (let k = 8; k >= 0; k--) pts.push([x + Math.sin(k * 0.9 + c.t * 6) * 18 - 16, y0 - 50 - k * H * 0.055]);
        shape(p, pts, '#ffd36a', true, LW * 0.8);
        capsule(p, [x - 44, y0 - 40], [x + 44, y0 - 40], LW * 1.3, '#3a2a44');
        shaft(y0 - 36, y0 + 50, '#9c2a3a', 1.5);
        return;
      }
      case 'cetro_lunar': { // vara dorada con aro lunar y cristal rosa
        const top = y0 - H * 0.5;
        shaft(top + 60, y0 + H * 0.16, '#d9b47a', 1.3);
        p.g.beginPath(); p.g.arc(x, top, 70, -2.6, 1.6); p.g.lineWidth = LW * 1.6; p.g.strokeStyle = INK; p.g.stroke(); p.g.lineWidth = LW * 0.8; p.g.strokeStyle = col('#e2b23e', p.k); p.g.stroke();
        glow(x, top, 90, '230,160,255');
        shape(p, [[x, top - 44], [x + 26, top], [x, top + 44], [x - 26, top]], '#e8a8f0', false);
        return;
      }
      case 'lanza': { // asta oscura con puntas ígneas en ambos extremos
        const top = y0 - H * 0.58, bot = y0 + H * 0.3;
        shaft(top + 40, bot - 30, '#3a2a2a', 1.4);
        glow(x, top, 80, '255,140,50');
        shape(p, [[x, top - 90], [x + 34, top + 10], [x + 70, top + 4], [x + 18, top + 50], [x - 18, top + 50], [x - 70, top + 4], [x - 34, top + 10]], '#e8732a', false);
        shape(p, [[x, bot + 50], [x + 22, bot - 20], [x - 22, bot - 20]], '#e8732a', false);
        return;
      }
      case 'guadana': { // asta blanca larga con gran hoja en media luna y rubíes
        const top = y0 - H * 0.55;
        shaft(top, y0 + H * 0.2, '#ecebf2', 1.4);
        shape(p, [[x + 20, top - 30], [x - 360, top + 20], [x - 470, top + 170], [x - 280, top + 70], [x - 20, top + 70]], '#dfe0ea', false);
        ellipse(p, x, top + 20, 18, 18, '#c8323c', LW * 0.6);
        return;
      }
      case 'gemelas': // hoja lavanda con guarda dorada (una en cada mano)
        shape(p, [[x - 20, y0 - 30], [x + 20, y0 - 30], [x + 14, y0 - H * 0.36], [x, y0 - H * 0.42], [x - 14, y0 - H * 0.36]], '#c8d4ff', false);
        shape(p, [[x - 56, y0 - 40], [x - 20, y0 - 60], [x, y0 - 34], [x + 20, y0 - 60], [x + 56, y0 - 40], [x, y0 - 18]], '#e2b23e', false);
        shaft(y0 - 20, y0 + 36, '#6a4a8a', 1.3);
        return;
      case 'martillo': { // cabeza rosa y dorada con espiral, asta clara
        const top = y0 - H * 0.42;
        shaft(top, y0 + H * 0.18, '#f0d8c8', 1.6);
        shape(p, [[x - 110, top - 40], [x + 60, top - 40], [x + 140, top - 10], [x + 60, top + 40], [x - 110, top + 40]], '#f0a890', false);
        ellipse(p, x - 20, top, 22, 22, '#e2b23e', LW * 0.6);
        return;
      }
      case 'cetro_rubi': { // asta roja con media luna dorada y gema roja
        const top = y0 - H * 0.5;
        shaft(top + 40, y0 + H * 0.18, '#9c2a2a', 1.4);
        p.g.beginPath(); p.g.arc(x, top, 62, 0.6, 5.2); p.g.lineWidth = LW * 2; p.g.strokeStyle = INK; p.g.stroke(); p.g.lineWidth = LW * 1.1; p.g.strokeStyle = col('#c9a35a', p.k); p.g.stroke();
        glow(x, top, 70, '255,70,80');
        ellipse(p, x, top, 30, 30, '#d0303c', LW * 0.8);
        return;
      }
      case 'revolver': { // revólver blanco y dorado que apunta al frente
        const fx = c.view === 'side' ? 1 : 0.4, dy = c.view === 'side' ? 0 : 1, k = 1.7;
        shape(p, [[x - 20 * k, y0 - 30 * k], [x + 150 * fx * k, y0 - 30 * k + 40 * dy * k], [x + 150 * fx * k, y0 + 6 * k + 40 * dy * k], [x + 30 * k, y0 + 6 * k], [x + 10 * k, y0 + 60 * k], [x - 30 * k, y0 + 50 * k]], '#f0f0f8', false);
        ellipse(p, x + 30 * fx * k, y0 - 12 * k + 10 * dy * k, 22 * k, 18 * k, '#d9b47a', LW * 0.6);
        return;
      }
      case 'arco': { // arco dorado con alas de plumas blancas
        const g = p.g, r = H * 0.32, cx = x - r * 0.5, cy = y0 - H * 0.1;
        for (const sgn of [-1, 1]) {
          const ex = cx + Math.cos(1.0) * r, ey = cy + sgn * Math.sin(1.0) * r;
          shape(p, [[ex, ey], [ex - 60, ey + sgn * 20], [ex - 110, ey - sgn * 40], [ex - 40, ey - sgn * 70]], '#f4f4f8', false);
        }
        g.beginPath(); g.arc(cx, cy, r, -1.0, 1.0); g.lineWidth = LW * 2; g.strokeStyle = INK; g.stroke(); g.lineWidth = LW; g.strokeStyle = col('#d9b47a', p.k); g.stroke();
        line(p, [[cx + Math.cos(1) * r, cy - Math.sin(1) * r], [cx + Math.cos(1) * r, cy + Math.sin(1) * r]], '#ffffff', LW * 0.35);
        return;
      }
    }
    // Sin Foco conocido: vara simple.
    shaft(y0 - H * 0.5, y0 + H * 0.16, '#6b4226', 1.9);
  } };
}

/** Orden de las piezas por vista (de atrás hacia adelante). */
function layers(view: View, foco: string | null): Piece[] {
  const w = foco ? [weapon(foco), ...(foco === 'gemelas' ? [weapon(foco, 'L')] : [])] : [];
  if (view === 'front') return [cape, hairBack, ...leg('L'), ...leg('R'), pelvis, neck, torso, skirt, sash, ...arm('L'), ...arm('R'), ...w, face, hairFront, hoodFront, accessories];
  if (view === 'back') return [...w, hairBack, ...leg('L'), ...leg('R'), pelvis, neck, torso, skirt, sash, cape, ...arm('L'), ...arm('R'), face, hairFront, hoodFront, accessories];
  return [...arm('L', true), ...leg('L', true), cape, hairBack, ...leg('R'), pelvis, neck, torso, skirt, sash, face, hairFront, hoodFront, accessories, ...arm('R'), ...w];
}

export interface DrawOpts {
  x: number; y: number; view: View; flip: boolean; app: Appearance; pose: Pose;
  team: string; foco?: string | null; t: number;
  /** 0 a 1: destello blanco al recibir daño. */
  flash?: number; alpha?: number;
  /** Dibuja los huesos y las articulaciones encima (visor del esqueleto). */
  debug?: boolean; scale?: number; body?: BodyDef;
  /** Para plantillas: dibuja con la malla neutra en lugar de la ropa. */
  base?: boolean;
}

/** Dibuja un personaje con los pies en (x, y) del mundo. */
export function drawCharacter(g: Ctx, o: DrawOpts) {
  const body = o.body ?? BODIES[o.app.body], joints = body.joints[o.view], mats = solve(joints, o.pose);
  const s = (o.scale ?? RIG_WORLD_SCALE);
  const outfit = o.base ? BASE_OUTFIT : OUTFITS[o.app.outfit], head = HEADS[o.app.head];
  g.save();
  g.translate(o.x, o.y); g.scale(o.flip ? -s : s, s);
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (o.alpha != null) g.globalAlpha = o.alpha;
  const base = o.flash ? 0.8 * o.flash : 0;
  const c: Ctx2 = { p: { g, k: base, ink: true }, j: joints, b: body, o: outfit, h: head, view: o.view, team: o.team, t: o.t };
  for (const piece of layers(o.view, o.foco ?? null)) {
    c.p.k = piece.far ? (base || -0.28) : base;
    const m = mats[piece.bone];
    g.save(); g.transform(m[0], m[1], m[2], m[3], m[4], m[5]); piece.draw(c); g.restore();
  }
  if (o.debug) drawBones(g, joints, o.pose, 1 / s);
  g.restore();
}

/** Huesos (líneas) y articulaciones (puntos) en la pose actual. */
function drawBones(g: Ctx, joints: JointSet, pose: Pose, px: number) {
  const q = posedJoints(joints, pose);
  g.globalAlpha = 1;
  g.lineWidth = 2.2 * px; g.strokeStyle = '#3df2c4';
  for (const b of BONES) {
    if (b.pivot === b.end) continue;
    g.beginPath(); g.moveTo(q[b.pivot][0], q[b.pivot][1]); g.lineTo(q[b.end][0], q[b.end][1]); g.stroke();
  }
  for (const k of Object.keys(q) as (keyof JointSet)[]) {
    g.fillStyle = k === 'headTop' ? '#3df2c4' : '#ff5ad8';
    g.beginPath(); g.arc(q[k][0], q[k][1], 4 * px, 0, 6.283); g.fill();
  }
  // Línea base de los pies.
  g.strokeStyle = 'rgba(255,211,106,.7)'; g.lineWidth = 1.5 * px;
  g.beginPath(); g.moveTo(-300, 0); g.lineTo(300, 0); g.stroke();
}
