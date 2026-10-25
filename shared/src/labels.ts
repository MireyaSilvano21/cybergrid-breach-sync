/**
 * Nombres sobre los personajes sin que se tapen: cuando varios jugadores están juntos, la etiqueta
 * de quien está más adelante (más abajo en pantalla) se queda en su lugar y las demás suben.
 */
export interface LabelBox {
  id: string;
  /** Centro horizontal y borde superior de la etiqueta en su lugar normal (coordenadas del mundo). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Devuelve cuánto sube cada etiqueta (px, 0 o negativo). Es estable: mismo acomodo para la misma escena. */
export function stackLabels(boxes: LabelBox[], gap = 2, maxRise = 120): Map<string, number> {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const out = new Map<string, number>();
  const order = [...boxes].sort((a, b) => b.y - a.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const b of order) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2;
    let top = b.y;
    for (let guard = 0; guard < 24; guard++) {
      const hit = placed.find((p) => x0 < p.x1 && x1 > p.x0 && top < p.y1 + gap && top + b.h > p.y0 - gap);
      if (!hit) break;
      top = hit.y0 - gap - b.h;
    }
    top = Math.max(top, b.y - maxRise);
    placed.push({ x0, x1, y0: top, y1: top + b.h });
    out.set(b.id, top - b.y);
  }
  return out;
}
