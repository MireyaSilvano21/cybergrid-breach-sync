import { MAX_TEAM_SIZE, MAX_TEAMS } from './constants';

/**
 * Equipos (GDD: hasta 3 por equipo, también dúo o solo; máximo 4 equipos por sala).
 * Cada equipo tiene un color fijo: se usa en la faja de los personajes, los nombres y el lobby.
 */
export interface TeamDef { id: number; name: string; color: string }
export const TEAMS: TeamDef[] = [
  { id: 0, name: 'Ámbar', color: '#f2a33a' },
  { id: 1, name: 'Violeta', color: '#9a6bff' },
  { id: 2, name: 'Jade', color: '#3fc79a' },
  { id: 3, name: 'Carmín', color: '#e8505b' },
];

/** Cuántos jugadores hay en cada equipo. */
export function teamCounts(teams: number[]): number[] {
  const c = Array.from({ length: MAX_TEAMS }, () => 0);
  for (const t of teams) if (t >= 0 && t < MAX_TEAMS) c[t]++;
  return c;
}

/**
 * Equipo para quien entra a la sala: el que tenga menos jugadores (los vacíos primero), así dos
 * personas que entran sin elegir quedan como rivales. Devuelve null si todos están llenos.
 */
export function autoTeam(teams: number[]): number | null {
  const c = teamCounts(teams);
  let best: number | null = null;
  for (let t = 0; t < MAX_TEAMS; t++) if (c[t] < MAX_TEAM_SIZE && (best === null || c[t] < c[best])) best = t;
  return best;
}

/** ¿Puede un jugador cambiarse a ese equipo? */
export function canJoinTeam(teams: number[], team: number): boolean {
  return Number.isInteger(team) && team >= 0 && team < MAX_TEAMS && teamCounts(teams)[team] < MAX_TEAM_SIZE;
}

/**
 * Llegada de cada equipo. Las 4 llegadas del mapa están ordenadas por ángulo (simetría de rehilete):
 * con 2 equipos se usan las opuestas, con 3 o 4 una por equipo.
 */
export function teamSpawns(teams: number[], spawnCount = 4): Map<number, number> {
  const ids = [...new Set(teams)].sort((a, b) => a - b);
  const order = ids.length === 2 ? [0, 2] : [0, 1, 2, 3];
  return new Map(ids.map((t, i) => [t, order[i % order.length] % spawnCount]));
}
