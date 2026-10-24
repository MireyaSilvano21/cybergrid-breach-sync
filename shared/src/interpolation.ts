export interface Vec2 { x: number; y: number }

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface TimedPosition extends Vec2 { t: number }

/**
 * Interpola la posición de un jugador remoto entre dos instantáneas del servidor.
 * renderTime suele ser (ahora - INTERP_DELAY_MS). El factor se limita a [0, 1]
 * para no extrapolar hacia posiciones que el servidor no ha confirmado.
 */
export function interpolatePosition(from: TimedPosition, to: TimedPosition, renderTime: number): Vec2 {
  const span = to.t - from.t;
  if (span <= 0) return { x: to.x, y: to.y };
  const k = Math.min(1, Math.max(0, (renderTime - from.t) / span));
  return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k) };
}

/** Busca el par de instantáneas que rodea renderTime y devuelve la posición interpolada. */
export function sampleBuffer(buffer: TimedPosition[], renderTime: number): Vec2 | null {
  if (buffer.length === 0) return null;
  if (renderTime <= buffer[0].t) return { x: buffer[0].x, y: buffer[0].y };
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i].t <= renderTime && renderTime <= buffer[i + 1].t) {
      return interpolatePosition(buffer[i], buffer[i + 1], renderTime);
    }
  }
  const last = buffer[buffer.length - 1];
  return { x: last.x, y: last.y };
}
