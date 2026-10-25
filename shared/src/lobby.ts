import { z } from 'zod';
import { BODY_IDS, HEAD_IDS, OUTFIT_IDS, appearanceFor, type Appearance } from './rig';
import { DEFAULT_BUILD, FOCOS, NOMBRES, type Build } from './abilities';
import { MAX_TEAMS, MAX_TEAM_SIZE } from './constants';

/**
 * Lobby estilo Delta Force: campamento con la escuadra, preparación (build y aspecto) y
 * emparejamiento automático. Aquí van las reglas que comparten cliente y servidor.
 */

/** Escuelas del GDD. Las que aún no tienen habilidades se muestran bloqueadas. */
export const SCHOOLS = [
  { id: 'tharven', name: 'Tharvén', title: 'Voces de la Piedra', role: 'Asalto', playable: true },
  { id: 'seleth', name: 'Seléth', title: 'Los Que Olvidaron su Nombre', role: 'Sigilo', playable: false },
  { id: 'vaerel', name: 'Vaerel', title: 'Tejedores del Vínculo', role: 'Soporte', playable: false },
  { id: 'orrath', name: 'Orrath', title: 'Los Que Escuchan al Viento', role: 'Reconocimiento', playable: false },
] as const;
export type SchoolId = typeof SCHOOLS[number]['id'];
const SCHOOL_IDS = SCHOOLS.map((s) => s.id) as [SchoolId, ...SchoolId[]];
const FOCO_IDS = Object.keys(FOCOS) as [string, ...string[]];

/** Perfil que el jugador arma en Preparación: aspecto y build. */
export const ProfileSchema = z.object({
  appearance: z.object({ body: z.enum(BODY_IDS), outfit: z.enum(OUTFIT_IDS), head: z.enum(HEAD_IDS) }),
  build: z.object({ school: z.enum(SCHOOL_IDS), focos: z.tuple([z.enum(FOCO_IDS), z.enum(FOCO_IDS)]) }),
});
export type Profile = z.infer<typeof ProfileSchema>;

export function defaultProfile(seed: string): Profile {
  return { appearance: appearanceFor(seed, 'tharven'), build: { school: 'tharven', focos: [DEFAULT_BUILD.focos[0], DEFAULT_BUILD.focos[1]] } };
}

/** Build de combate a partir del perfil: escuelas bloqueadas o Focos repetidos vuelven al de prueba. */
export function buildFromProfile(p: Profile | undefined): Build {
  if (!p) return DEFAULT_BUILD;
  const school = SCHOOLS.find((s) => s.id === p.build.school);
  const [f1, f2] = p.build.focos;
  if (!school?.playable || f1 === f2 || !FOCOS[f1] || !FOCOS[f2]) return DEFAULT_BUILD;
  const nombres = Object.values(NOMBRES).filter((n) => n.school === school.id).map((n) => n.id);
  if (nombres.length < 2) return DEFAULT_BUILD;
  return { school: school.id, nombres: [nombres[0], nombres[1]], focos: [f1, f2] };
}

export function appearanceOf(p: Profile | undefined, seed: string): Appearance {
  return p?.appearance ?? appearanceFor(seed);
}

// ---------- Emparejamiento ----------

export interface QueuedParty { id: string; size: number; since: number }
export interface QueueRules {
  /** Jugadores mínimos para arrancar (sumando escuadras). */
  minPlayers: number;
  /** Equipos mínimos: con 2, una escuadra sola nunca arranca sin rivales. */
  minTeams: number;
  /** Cuánto se espera a que lleguen más escuadras una vez que se cumple el mínimo. */
  waitMs: number;
}

/**
 * Decide qué escuadras entran juntas a una partida. Cada escuadra es un equipo (nunca se separa).
 * Con 4 escuadras arranca al instante; con menos, cuando se cumple el mínimo y la más antigua
 * ya esperó `waitMs`. Devuelve los ids en orden (el índice es el equipo) o null.
 */
export function pickMatch(queue: QueuedParty[], now: number, rules: QueueRules): string[] | null {
  const q = [...queue].filter((p) => p.size >= 1 && p.size <= MAX_TEAM_SIZE).sort((a, b) => a.since - b.since).slice(0, MAX_TEAMS);
  if (!q.length) return null;
  if (q.length === MAX_TEAMS) return q.map((p) => p.id);
  const players = q.reduce((n, p) => n + p.size, 0);
  if (players >= rules.minPlayers && q.length >= rules.minTeams && now - q[0].since >= rules.waitMs) return q.map((p) => p.id);
  return null;
}

/** Lo que ve cada escuadra mientras busca: cuántos hay y cuánto falta. */
export function queueStatus(queue: QueuedParty[], now: number, rules: QueueRules) {
  const q = [...queue].sort((a, b) => a.since - b.since).slice(0, MAX_TEAMS);
  const players = q.reduce((n, p) => n + p.size, 0);
  const ready = players >= rules.minPlayers && q.length >= rules.minTeams;
  return {
    players, teams: q.length,
    needPlayers: Math.max(0, rules.minPlayers - players),
    needTeams: Math.max(0, rules.minTeams - q.length),
    startsInMs: ready && q.length ? Math.max(0, rules.waitMs - (now - q[0].since)) : null,
  };
}
