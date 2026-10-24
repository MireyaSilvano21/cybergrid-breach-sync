import { describe, expect, it } from 'vitest';
import { updateResonance, timeMultiplier, RESONANCE } from '@shared/resonance';
import { phaseAt, DEFAULT_PHASES, scalePhases } from '@shared/phases';

describe('Resonancia del portal (anti-campeo)', () => {
  it('sube más rápido con más integrantes del equipo cerca', () => {
    const one = updateResonance(0, [{ distance: 50, syncing: false }], 0, 1);
    const three = updateResonance(0, [1, 2, 3].map(() => ({ distance: 50, syncing: false })), 0, 1);
    expect(three).toBeCloseTo(one * 3);
  });

  it('no cuenta a quien se sincroniza y baja lento fuera de los anillos', () => {
    expect(updateResonance(10, [{ distance: 50, syncing: true }], 0, 1)).toBeCloseTo(10 - RESONANCE.decayRate);
    expect(timeMultiplier(25)).toBe(4);
  });
});

describe('Fases de la partida', () => {
  it('abre y cierra portales según el tiempo', () => {
    expect(phaseAt(60).portal1Open).toBe(false);
    expect(phaseAt(7 * 60).portal1Open).toBe(true);
    expect(phaseAt(13 * 60).portal1Open).toBe(false);
    expect(phaseAt(15 * 60).resonanceActive).toBe(false);
    expect(phaseAt(18 * 60).ended).toBe(true);
    expect(phaseAt(90, scalePhases(DEFAULT_PHASES, 0.2)).portal1Open).toBe(true);
  });
});
