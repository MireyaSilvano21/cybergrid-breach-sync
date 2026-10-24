/**
 * Compensación de lag ("favorecer al que ataca"), como en Source, Overwatch o Valorant:
 * el servidor revisa un golpe contra las posiciones que el atacante veía en su pantalla,
 * no contra las posiciones actuales. Se limita a MAX_REWIND_MS para que nadie reciba
 * golpes muy atrasados después de cubrirse.
 */
export const MAX_REWIND_MS = 250;
export const HISTORY_MS = 1000;

export interface TimedPoint { t: number; x: number; y: number }

/** Agrega una muestra al historial y descarta las más viejas que HISTORY_MS. */
export function pushHistory(history: TimedPoint[], sample: TimedPoint, keepMs = HISTORY_MS): void {
  history.push(sample);
  while (history.length > 2 && history[0].t < sample.t - keepMs) history.shift();
}

/** Posición en el instante t, interpolando entre las dos muestras que lo rodean. */
export function positionAt(history: TimedPoint[], t: number): { x: number; y: number } | null {
  if (!history.length) return null;
  if (t <= history[0].t) return { x: history[0].x, y: history[0].y };
  for (let i = history.length - 1; i > 0; i--) {
    const a = history[i - 1], b = history[i];
    if (a.t <= t && t <= b.t) {
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  const last = history[history.length - 1];
  return { x: last.x, y: last.y };
}

/**
 * Instante al que se retrocede: el que el cliente dice haber visto, pero nunca en el
 * futuro ni más de maxMs hacia atrás (evita abusos con valores falsos).
 */
export function clampRewind(now: number, viewT: number | undefined, maxMs = MAX_REWIND_MS): number {
  if (viewT === undefined || !Number.isFinite(viewT)) return now;
  return Math.min(now, Math.max(now - maxMs, viewT));
}
