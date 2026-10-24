/** Fases de una partida de 18 minutos (GDD sección 10). Tiempos en segundos. */
export type PhaseId = 'despertar' | 'primer-silencio' | 'primera-llamada' | 'segunda-llamada' | 'cierre-portal-1' | 'desnombrar' | 'fin';

export interface PhaseConfig {
  despertar: number;
  primeraLlamada: number;
  segundaLlamada: number;
  cierrePortal1: number;
  desnombrar: number;
  fin: number;
}

export const DEFAULT_PHASES: PhaseConfig = {
  despertar: 30,
  primeraLlamada: 7 * 60,
  segundaLlamada: 10 * 60,
  cierrePortal1: 13 * 60,
  desnombrar: 14.5 * 60,
  fin: 18 * 60,
};

/** Escala todos los tiempos (por ejemplo 0.2 para una partida de prueba de ~3.6 minutos). */
export function scalePhases(cfg: PhaseConfig, factor: number): PhaseConfig {
  const out = { ...cfg };
  for (const k of Object.keys(out) as (keyof PhaseConfig)[]) out[k] = cfg[k] * factor;
  return out;
}

export interface PhaseState {
  phase: PhaseId;
  portal1Open: boolean;
  portal2Open: boolean;
  resonanceActive: boolean;
  collapsing: boolean;
  ended: boolean;
}

export function phaseAt(t: number, c: PhaseConfig = DEFAULT_PHASES): PhaseState {
  const phase: PhaseId =
    t >= c.fin ? 'fin' :
    t >= c.desnombrar ? 'desnombrar' :
    t >= c.cierrePortal1 ? 'cierre-portal-1' :
    t >= c.segundaLlamada ? 'segunda-llamada' :
    t >= c.primeraLlamada ? 'primera-llamada' :
    t >= c.despertar ? 'primer-silencio' : 'despertar';
  return {
    phase,
    portal1Open: t >= c.primeraLlamada && t < c.cierrePortal1,
    portal2Open: t >= c.segundaLlamada && t < c.fin,
    resonanceActive: t >= c.primeraLlamada && t < c.desnombrar,
    collapsing: t >= c.desnombrar && t < c.fin,
    ended: t >= c.fin,
  };
}
