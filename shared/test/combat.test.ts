import { describe, expect, it } from 'vitest';
import { computeDamage, applyHealth, RARITY_MULT } from '@shared/combat';

describe('Fórmulas de daño y escalado', () => {
  it('escala el daño base por la rareza del Foco', () => {
    expect(computeDamage({ base: 20, rarity: 'comun' }).total).toBe(20);
    expect(computeDamage({ base: 20, rarity: 'reliquia' }).total).toBe(Math.round(20 * RARITY_MULT.reliquia));
  });

  it('el escudo absorbe antes que la vida', () => {
    const r = computeDamage({ base: 20, rarity: 'comun', targetShield: 15 });
    expect(r.absorbedByShield).toBe(15);
    expect(r.toHealth).toBe(5);
    expect(r.remainingShield).toBe(0);
  });

  it('el daño nunca es negativo y la vida nunca baja de cero', () => {
    expect(computeDamage({ base: 20, rarity: 'comun', multiplier: -3 }).total).toBe(0);
    expect(applyHealth(10, 50)).toBe(0);
    expect(applyHealth(10, -5)).toBe(10);
  });
});
