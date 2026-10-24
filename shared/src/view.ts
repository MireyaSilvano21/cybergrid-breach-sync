/**
 * Cámara justa: todos los jugadores ven aproximadamente la misma porción del mundo,
 * sin importar el tamaño de su pantalla. El zoom se ajusta para que lo visible
 * no pase de VIEW_W × VIEW_H unidades de mundo.
 */
export const VIEW_W = 1280;
export const VIEW_H = 640;
/** Radio de visión en unidades de mundo: fuera de él la escena queda a oscuras. */
export const VISION_RADIUS = 560;

export function viewScale(screenW: number, screenH: number): number {
  return Math.max(screenW / VIEW_W, screenH / VIEW_H);
}

/** Porción del mundo visible (en unidades de mundo) para una pantalla dada. */
export function visibleWorld(screenW: number, screenH: number) {
  const s = viewScale(screenW, screenH);
  return { w: screenW / s, h: screenH / s, scale: s };
}
