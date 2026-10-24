import { TILE } from './constants';
import { GridMap, WALL, tileAt } from './map';
import type { Vec2 } from './interpolation';

/**
 * Mueve un círculo y lo empuja fuera de las casillas sólidas.
 * Lo usan el servidor (autoridad) y el cliente (predicción) para que ambos coincidan.
 */
export function moveCircle(map: GridMap, pos: Vec2, dx: number, dy: number, r: number): Vec2 {
  const p = { x: pos.x + dx, y: pos.y + dy };
  for (let iter = 0; iter < 2; iter++) {
    const tx0 = Math.floor((p.x - r) / TILE), tx1 = Math.floor((p.x + r) / TILE);
    const ty0 = Math.floor((p.y - r) / TILE), ty1 = Math.floor((p.y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (tileAt(map, tx, ty) !== WALL) continue;
      const cx = Math.max(tx * TILE, Math.min(p.x, tx * TILE + TILE));
      const cy = Math.max(ty * TILE, Math.min(p.y, ty * TILE + TILE));
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

/** Línea de visión entre dos puntos: false si una casilla sólida la bloquea. */
export function hasLineOfSight(map: GridMap, a: Vec2, b: Vec2): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.ceil(dist / (TILE / 4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (tileAt(map, Math.floor((a.x + (b.x - a.x) * t) / TILE), Math.floor((a.y + (b.y - a.y) * t) / TILE)) === WALL) return false;
  }
  return true;
}
