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
  /** La marca se quita cuando la barra baja de aquí (evita que parpadee en el límite). */
  unmarkAt: 60,
  /** Daño por segundo a un equipo marcado mientras siga dentro de los anillos. */
  markedDps: 6,
  /** Segundos de un equipo marcado en el anillo cercano para que el portal se relocalice. */
  unstableSeconds: 6,
  /** Escudo arcano breve para quien se sincroniza estando marcado, y cuánto dura. */
  syncShield: 25,
  syncShieldMs: 3000,
  /** Al empezar a sincronizar, el portal revela al jugador a los rivales en sus anillos. */
  syncRevealMs: 4000,
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

export type ResonanceZone = 'near' | 'far' | null;

/** Anillo en el que está alguien según su distancia al portal. */
export function zoneOf(distance: number): ResonanceZone {
  if (distance <= RESONANCE.nearRadius) return 'near';
  if (distance <= RESONANCE.farRadius) return 'far';
  return null;
}

/** Estado de la Resonancia de un equipo: barra, tiempo continuo en zona y si está marcado. */
export interface TeamResonance {
  value: number;
  zoneT: number;
  marked: boolean;
}

export function newTeamResonance(): TeamResonance {
  return { value: 0, zoneT: 0, marked: false };
}

export type ResonanceEvent = 'marked' | 'cleared' | null;

/**
 * Avanza la Resonancia de un equipo dt segundos. El tiempo en zona solo corre mientras algún
 * integrante (sin sincronizar) esté en los anillos; la marca entra al llenarse y sale al bajar
 * de `unmarkAt`. Devuelve el estado nuevo y si el equipo se acaba de marcar o desmarcar.
 */
export function stepTeamResonance(s: TeamResonance, members: MemberPresence[], dt: number): { state: TeamResonance; event: ResonanceEvent } {
  const inZone = members.some((m) => !m.syncing && m.distance <= RESONANCE.farRadius);
  const zoneT = inZone ? s.zoneT + dt : 0;
  const value = updateResonance(s.value, members, zoneT, dt);
  let marked = s.marked, event: ResonanceEvent = null;
  if (!marked && value >= RESONANCE.max) { marked = true; event = 'marked'; }
  else if (marked && value < RESONANCE.unmarkAt) { marked = false; event = 'cleared'; }
  return { state: { value, zoneT, marked }, event };
}

/**
 * Nuevo lugar para un portal inestable: el candidato libre más alejado de los portales en uso
 * (incluido el que se mueve). Devuelve null si no queda ningún candidato libre.
 */
export function pickRelocation(candidates: { x: number; y: number }[], used: number[]): number | null {
  let best: number | null = null, bestD = -1;
  candidates.forEach((c, i) => {
    if (used.includes(i)) return;
    const d = Math.min(...used.map((u) => Math.hypot(candidates[u].x - c.x, candidates[u].y - c.y)));
    if (d > bestD) { bestD = d; best = i; }
  });
  return best;
}
