export type Rarity = 'comun' | 'pulido' | 'raro' | 'reliquia';

export const RARITY_MULT: Record<Rarity, number> = {
  comun: 1,
  pulido: 1.12,
  raro: 1.25,
  reliquia: 1.4,
};

export interface DamageInput {
  /** Daño base del Foco. */
  base: number;
  rarity: Rarity;
  /** Multiplicadores adicionales (pasivas, habilidades). 1 = sin cambio. */
  multiplier?: number;
  /** Escudo arcano actual del objetivo, absorbe antes que la vida. */
  targetShield?: number;
}

export interface DamageResult {
  total: number;
  absorbedByShield: number;
  toHealth: number;
  remainingShield: number;
}

/**
 * Fórmula de daño del juego: base × rareza × multiplicadores, redondeado.
 * El escudo absorbe primero; el daño nunca es negativo.
 */
export function computeDamage(input: DamageInput): DamageResult {
  const mult = Math.max(0, input.multiplier ?? 1);
  const total = Math.max(0, Math.round(input.base * RARITY_MULT[input.rarity] * mult));
  const shield = Math.max(0, input.targetShield ?? 0);
  const absorbed = Math.min(shield, total);
  return { total, absorbedByShield: absorbed, toHealth: total - absorbed, remainingShield: shield - absorbed };
}

/** Aplica daño a una vida y devuelve la vida resultante (mínimo 0). */
export function applyHealth(hp: number, damage: number): number {
  return Math.max(0, hp - Math.max(0, damage));
}
