import { TILE } from './constants';
import { GridMap, tileAt, blocksMovement, isDiag, isGate, GATE_DIR, DIAG_TL, DIAG_TR, DIAG_BL, solidAt } from './map';
import type { Vec2 } from './interpolation';

/** Triángulo sólido de una casilla en diagonal, en coordenadas del mundo. */
function diagTriangle(t: number, tx: number, ty: number): [number, number][] {
  const x0 = tx * TILE, y0 = ty * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
  if (t === DIAG_TL) return [[x0, y0], [x1, y0], [x0, y1]];
  if (t === DIAG_TR) return [[x0, y0], [x1, y0], [x1, y1]];
  if (t === DIAG_BL) return [[x0, y0], [x0, y1], [x1, y1]];
  return [[x1, y0], [x1, y1], [x0, y1]];
}

function closestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const vx = bx - ax, vy = by - ay, l = vx * vx + vy * vy;
  const k = l ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l)) : 0;
  return [ax + vx * k, ay + vy * k];
}

function insideTriangle(px: number, py: number, tri: [number, number][]): boolean {
  const s = (a: [number, number], b: [number, number]) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  const d1 = s(tri[0], tri[1]), d2 = s(tri[1], tri[2]), d3 = s(tri[2], tri[0]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** El círculo en `p` toca la casilla (para saber si ya estaba dentro de una reja). */
const overlapsTile = (p: Vec2, r: number, tx: number, ty: number) => {
  const cx = Math.max(tx * TILE, Math.min(p.x, tx * TILE + TILE)), cy = Math.max(ty * TILE, Math.min(p.y, ty * TILE + TILE));
  return Math.hypot(p.x - cx, p.y - cy) < r;
};

/**
 * Mueve un círculo y lo empuja fuera de lo sólido: muros, objetos, abismos, sellos
 * cerrados, muros en diagonal y rejas que se intentan cruzar al revés.
 * Lo usan el servidor (autoridad) y el cliente (predicción) para que ambos coincidan.
 */
export function moveCircle(map: GridMap, pos: Vec2, dx: number, dy: number, r: number): Vec2 {
  const p = { x: pos.x + dx, y: pos.y + dy };
  for (let iter = 0; iter < 3; iter++) {
    const tx0 = Math.floor((p.x - r) / TILE), tx1 = Math.floor((p.x + r) / TILE);
    const ty0 = Math.floor((p.y - r) / TILE), ty1 = Math.floor((p.y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const t = tileAt(map, tx, ty);
      let cx: number, cy: number;
      if (isDiag(t)) {
        const tri = diagTriangle(t, tx, ty);
        if (insideTriangle(p.x, p.y, tri)) {
          // Dentro del triángulo: se empuja hacia la hipotenusa.
          const [a, b] = t === DIAG_TL ? [tri[1], tri[2]] : [tri[0], tri[2]];
          [cx, cy] = closestOnSegment(p.x, p.y, a[0], a[1], b[0], b[1]);
          const nx = cx - p.x, ny = cy - p.y, l = Math.hypot(nx, ny) || 1;
          p.x = cx + (nx / l) * r; p.y = cy + (ny / l) * r;
          continue;
        }
        let best = Infinity; cx = p.x; cy = p.y;
        for (let i = 0; i < 3; i++) {
          const [qx, qy] = closestOnSegment(p.x, p.y, tri[i][0], tri[i][1], tri[(i + 1) % 3][0], tri[(i + 1) % 3][1]);
          const d = Math.hypot(p.x - qx, p.y - qy);
          if (d < best) { best = d; cx = qx; cy = qy; }
        }
      } else {
        if (isGate(t)) {
          // Reja de un solo sentido: deja pasar si avanzas a favor de la flecha o ya estabas dentro.
          const [gx, gy] = GATE_DIR[t];
          if (dx * gx + dy * gy > 0 || overlapsTile(pos, r, tx, ty)) continue;
        } else if (!blocksMovement(map, t)) continue;
        cx = Math.max(tx * TILE, Math.min(p.x, tx * TILE + TILE));
        cy = Math.max(ty * TILE, Math.min(p.y, ty * TILE + TILE));
      }
      let ox = p.x - cx, oy = p.y - cy;
      let d = Math.hypot(ox, oy);
      if (d >= r) continue;
      if (d < 1e-4) { ox = 0; oy = -1; d = 1; }
      p.x += (ox / d) * (r - d);
      p.y += (oy / d) * (r - d);
    }
  }
  return p;
}

/** Línea de visión entre dos puntos: false si algo opaco la bloquea (los abismos dejan ver). */
export function hasLineOfSight(map: GridMap, a: Vec2, b: Vec2): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.ceil(dist / (TILE / 4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (solidAt(map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, true)) return false;
  }
  return true;
}
