/**
 * Ritual del monolito (GDD sección 9): activar, defender por oleadas mientras baja la integridad,
 * reparar con una prueba de Nombre y abrir la bóveda. Todo es lógica pura que usa el servidor.
 */
import type { MonsterKind } from './desnombrados';

export const RITUAL = {
  /** Segundos manteniendo interactuar para despertar el monolito. */
  activateS: 3,
  /** Duración de la defensa (≈ 45 s, 2 oleadas). */
  durationS: 45,
  /** Progreso al que llega la segunda oleada. */
  secondWaveAt: 0.45,
  integrity: 100,
  /** Bajo esta integridad el ritual se detiene hasta la prueba de Nombre. */
  repairBelow: 35,
  /** Segundos que el monolito queda inactivo si se rompe. */
  cooldownS: 30,
  /** Distancia para activar o reparar (desde el centro del monolito, que es sólido). */
  range: 120,
  /** Distancia a la que persiguen los Desnombrados de un ritual. */
  arena: 600,
  /** Prueba de Nombre: velocidad de la aguja (rad/s), zona correcta y zona perfecta (rad). */
  needleSpeed: 3.4,
  zone: 0.95,
  perfect: 0.3,
  /** Nombre errado: pausa antes de reintentar y tiempo que el pulso delata la posición. */
  errPauseMs: 1800,
  pulseMs: 3000,
  /** Rituales completados para despertar la Bóveda Antigua (desde la Segunda Llamada). */
  heartNeeds: 3,
} as const;

export type RitualPhase = 'dormido' | 'defensa' | 'reparar' | 'completo' | 'roto';

export interface Ritual {
  phase: RitualPhase;
  team: number;
  integrity: number;
  /** 0 a 1. */
  progress: number;
  wave: number;
  cooldownUntil: number;
  /** Tras un Nombre errado, no se puede reintentar hasta esta hora. */
  pausedUntil: number;
}

export type RitualEvent = 'wave2' | 'complete' | 'repair' | 'broken' | 'ready' | null;

export function newRitual(): Ritual {
  return { phase: 'dormido', team: -1, integrity: RITUAL.integrity, progress: 0, wave: 0, cooldownUntil: 0, pausedUntil: 0 };
}

export function startRitual(r: Ritual, team: number) {
  Object.assign(r, { phase: 'defensa', team, integrity: RITUAL.integrity, progress: 0, wave: 1, pausedUntil: 0 });
}

/**
 * Oleada según el tamaño del equipo que activó el monolito: alguien solo enfrenta menos enemigos
 * que un trío (GDD: las oleadas escalan con el equipo).
 */
export function waveFor(wave: number, teamSize: number): MonsterKind[] {
  const n = Math.max(1, Math.min(3, teamSize));
  const errantes = wave === 1 ? 1 + n : 2 + n;
  const susurrantes = wave === 1 ? (n >= 2 ? 1 : 0) : Math.ceil(n / 2);
  return [...Array<MonsterKind>(errantes).fill('errante'), ...Array<MonsterKind>(susurrantes).fill('susurrante')];
}

/** Oleada final de la Bóveda Antigua: el Coloso con su escolta. */
export function heartWave(): MonsterKind[] {
  return ['coloso', 'errante', 'errante', 'errante', 'susurrante', 'susurrante'];
}

/** Avanza el ritual dt segundos y devuelve lo que pasó. */
export function stepRitual(r: Ritual, dt: number, now: number): RitualEvent {
  if (r.phase === 'roto') {
    if (now >= r.cooldownUntil) { Object.assign(r, newRitual()); return 'ready'; }
    return null;
  }
  if (r.phase !== 'defensa' && r.phase !== 'reparar') return null;
  if (r.integrity <= 0) {
    r.phase = 'roto'; r.integrity = 0; r.cooldownUntil = now + RITUAL.cooldownS * 1000;
    return 'broken';
  }
  if (r.phase === 'reparar') return null;
  if (r.integrity < RITUAL.repairBelow) { r.phase = 'reparar'; return 'repair'; }
  r.progress = Math.min(1, r.progress + dt / RITUAL.durationS);
  if (r.wave === 1 && r.progress >= RITUAL.secondWaveAt) { r.wave = 2; return 'wave2'; }
  if (r.progress >= 1) { r.phase = 'completo'; return 'complete'; }
  return null;
}

export function damageRitual(r: Ritual, amount: number) {
  if (r.phase === 'defensa' || r.phase === 'reparar') r.integrity = Math.max(0, r.integrity - amount);
}

// --- Prueba de Nombre: aguja que gira sobre un círculo de runas ---

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
/** Diferencia angular con signo, entre -π y π. */
const angDiff = (a: number, b: number) => { const d = wrap(a - b); return d > Math.PI ? d - TAU : d; };

export type NameResult = 'perfecto' | 'correcto' | 'errado';

/** Ángulo de la aguja ms después de empezar la prueba. */
export function needleAt(elapsedMs: number): number {
  return wrap((elapsedMs / 1000) * RITUAL.needleSpeed);
}

/** Juzga dónde se detuvo la aguja respecto al centro de la zona. */
export function judgeName(angle: number, zoneCenter: number): NameResult {
  const d = Math.abs(angDiff(angle, zoneCenter));
  if (d <= RITUAL.perfect / 2) return 'perfecto';
  if (d <= RITUAL.zone / 2) return 'correcto';
  return 'errado';
}

/**
 * El cliente dice dónde vio la aguja al tocar. Se acepta solo si la aguja pasó por ese ángulo
 * en la ventana reciente (latencia), así no se puede elegir un ángulo arbitrario.
 */
export function plausibleNeedle(claimed: number, elapsedMs: number, windowMs = 350): boolean {
  const from = needleAt(Math.max(0, elapsedMs - windowMs)), sweep = (Math.min(elapsedMs, windowMs) / 1000) * RITUAL.needleSpeed;
  return wrap(claimed - from) <= sweep + 0.05;
}

/** Aplica el resultado: perfecto repara más y adelanta; errado pausa y quita progreso. */
export function applyName(r: Ritual, result: NameResult, now: number) {
  if (r.phase !== 'reparar') return;
  if (result === 'errado') { r.pausedUntil = now + RITUAL.errPauseMs; r.progress = Math.max(0, r.progress - 0.05); return; }
  r.integrity = Math.min(RITUAL.integrity, r.integrity + (result === 'perfecto' ? 45 : 30));
  if (result === 'perfecto') r.progress = Math.min(0.99, r.progress + 0.04);
  r.phase = 'defensa';
}
