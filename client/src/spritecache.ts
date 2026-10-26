/**
 * Caché de dibujo por entidad: en lugar de trazar a un personaje o Desnombrado (decenas de
 * caminos vectoriales) en cada cuadro, se dibuja en un lienzo propio a un ritmo de animación
 * fijo (30 o 15 por segundo) y en cada cuadro solo se copia esa imagen en su posición.
 * La posición se sigue moviendo a 60; solo la pose se actualiza a menor ritmo, como en la
 * animación 2D tradicional. Recomendación de MDN: pre-dibujar en un lienzo aparte lo que se repite.
 */
export interface Box { l: number; t: number; w: number; h: number }

export class SpriteCache {
  private c = document.createElement('canvas');
  private g = this.c.getContext('2d')!;
  private at = -1e9;
  private key = '';
  private k = 0;

  /**
   * Dibuja en dst la entidad con los pies en (x, y). box es el área que ocupa respecto a los pies
   * (unidades del mundo); px, cuántos píxeles reales mide una unidad del mundo en pantalla.
   * key cambia cuando algo debe redibujarse de inmediato (por ejemplo, un destello o un giro).
   */
  draw(dst: CanvasRenderingContext2D, x: number, y: number, box: Box, px: number, fps: number, now: number, key: string, render: (g: CanvasRenderingContext2D) => void) {
    const k = Math.min(4, Math.max(0.5, px));
    if (now - this.at >= 1000 / fps - 2 || key !== this.key || Math.abs(k - this.k) > 0.05) {
      const W = Math.ceil(box.w * k), H = Math.ceil(box.h * k);
      if (this.c.width !== W || this.c.height !== H) { this.c.width = W; this.c.height = H; }
      else { this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.clearRect(0, 0, W, H); }
      this.g.setTransform(k, 0, 0, k, -box.l * k, -box.t * k);
      this.g.globalAlpha = 1; this.g.globalCompositeOperation = 'source-over';
      render(this.g);
      this.at = now; this.key = key; this.k = k;
    }
    dst.drawImage(this.c, x + box.l, y + box.t, box.w, box.h);
  }
}

/** Una caché por id que se limpia sola cuando una entidad deja de verse. */
export class SpriteCaches {
  private map = new Map<string, { c: SpriteCache; seen: number }>();
  get(id: string, now: number) {
    let e = this.map.get(id);
    if (!e) { e = { c: new SpriteCache(), seen: now }; this.map.set(id, e); }
    e.seen = now;
    return e.c;
  }
  prune(now: number) { for (const [id, e] of this.map) if (now - e.seen > 3000) this.map.delete(id); }
}
