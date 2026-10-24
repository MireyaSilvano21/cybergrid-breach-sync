/**
 * Resonancia del portal (anti-campeo v2). Mide presencia acumulada por equipo,
 * no quietud. Ver GDD sección 4.
 */
export const RESONANCE = {
  nearRadius: 160,
  farRadius: 320,
  nearRate: 6, // puntos por segundo por integrante en el anillo cercano
  farRate: 2.5, // en el anillo lejano
  decayRate: 1.5, // la barra baja lento fuera de los anillos
  max: 100,
} as const;

/** Multiplicador por tiempo continuo en zona: x1 (0–10 s), x2 (10–20 s), x4 (>20 s). */
export function timeMultiplier(secondsInZone: number): number {
  if (secondsInZone > 20) return 4;
  if (secondsInZone > 10) return 2;
  return 1;
}

export interface MemberPresence {
  /** Distancia al portal. */
  distance: number;
  /** Si está sincronizándose para extraer, su aporte no cuenta. */
  syncing: boolean;
}

/** Calcula la nueva barra de Resonancia de un equipo tras dt segundos. */
export function updateResonance(current: number, members: MemberPresence[], secondsInZone: number, dt: number): number {
  let rate = 0;
  for (const m of members) {
    if (m.syncing) continue;
    if (m.distance <= RESONANCE.nearRadius) rate += RESONANCE.nearRate;
    else if (m.distance <= RESONANCE.farRadius) rate += RESONANCE.farRate;
  }
  const next = rate > 0
    ? current + rate * timeMultiplier(secondsInZone) * dt
    : current - RESONANCE.decayRate * dt;
  return Math.min(RESONANCE.max, Math.max(0, next));
}
