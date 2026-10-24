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
  tokenTtlMs: 1000 * 60 * 60 * 12,
};
