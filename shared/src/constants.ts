/** Tamaño de una casilla del mapa en unidades de mundo (px lógicos). */
export const TILE = 64;
/** Casillas por módulo de la Grid (cada módulo es una sala de 16x16). */
export const MODULE_TILES = 16;
/** Frecuencia de simulación del servidor. */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
/** Retraso de interpolación en el cliente (dos ticks). */
export const INTERP_DELAY_MS = TICK_MS * 2;

export const PLAYER = {
  radius: 18,
  speed: 230,
  maxHp: 100,
  attackCooldownMs: 450,
  attackRange: 95,
  /** Coseno mínimo entre la dirección de apuntado y el objetivo. */
  attackArc: 0.2,
} as const;

export const SYNC_SECONDS = { 3: 5, 2: 4, 1: 3.5 } as const;
export const MAX_TEAM_SIZE = 3;
export const MAX_TEAMS = 4;
export const MAX_PLAYERS = MAX_TEAM_SIZE * MAX_TEAMS;
