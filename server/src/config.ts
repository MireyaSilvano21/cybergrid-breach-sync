import { randomBytes } from 'node:crypto';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** Clave para firmar tokens. En producción se define en el entorno. */
  secret: process.env.AUTH_SECRET ?? randomBytes(32).toString('hex'),
  /** Endpoints /api/test/* activos (la especificación exige que estén expuestos). */
  testEndpoints: process.env.TEST_ENDPOINTS !== 'false',
  /** Escala de la duración de la partida: 1 = 18 min; 0.2 ≈ 3.6 min para demos y E2E. */
  matchScale: Number(process.env.MATCH_SCALE ?? 1),
  /** Jugadores listos necesarios para iniciar (1 permite probar solo). */
  minPlayers: Number(process.env.MIN_PLAYERS ?? 1),
  /** Solo pruebas E2E: todos aparecen en la misma llegada para poder probar el combate. */
  sameSpawn: process.env.SAME_SPAWN === '1',
  /** Emparejamiento: jugadores y equipos mínimos, y cuánto se espera a más escuadras. */
  queue: {
    minPlayers: Number(process.env.QUEUE_MIN_PLAYERS ?? 2),
    minTeams: Number(process.env.QUEUE_MIN_TEAMS ?? 2),
    waitMs: Number(process.env.QUEUE_WAIT_MS ?? 15000),
  },
  tokenTtlMs: 1000 * 60 * 60 * 12,
};
