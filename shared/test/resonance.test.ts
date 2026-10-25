import { describe, expect, it } from 'vitest';
import { RESONANCE, zoneOf, newTeamResonance, stepTeamResonance, pickRelocation, type TeamResonance, type MemberPresence } from '@shared/resonance';

const near: MemberPresence = { distance: 50, syncing: false };
const far: MemberPresence = { distance: (RESONANCE.nearRadius + RESONANCE.farRadius) / 2, syncing: false };
const away: MemberPresence = { distance: RESONANCE.farRadius + 100, syncing: false };

/** Avanza la Resonancia en pasos de 0.1 s y devuelve el estado y los eventos que hubo. */
function run(s: TeamResonance, members: MemberPresence[], seconds: number) {
  const events: string[] = [];
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    const r = stepTeamResonance(s, members, 0.1);
    s = r.state; if (r.event) events.push(r.event);
  }
  return { s, events };
}

describe('Resonancia por equipo', () => {
  it('distingue el anillo cercano, el lejano y fuera de los anillos', () => {
    expect(zoneOf(RESONANCE.nearRadius)).toBe('near');
    expect(zoneOf(RESONANCE.nearRadius + 1)).toBe('far');
    expect(zoneOf(RESONANCE.farRadius + 1)).toBeNull();
  });

  it('marca al equipo al llenarse y avisa una sola vez', () => {
    const { s, events } = run(newTeamResonance(), [near], 30);
    expect(s.value).toBe(RESONANCE.max);
    expect(s.marked).toBe(true);
    expect(events).toEqual(['marked']);
  });

  it('la marca no se quita en cuanto baja la barra, solo bajo el umbral', () => {
    const marked: TeamResonance = { value: RESONANCE.max, zoneT: 25, marked: true };
    const a = run(marked, [away], 5);
    expect(a.s.marked).toBe(true);
    const b = run(marked, [away], (RESONANCE.max - RESONANCE.unmarkAt) / RESONANCE.decayRate + 1);
    expect(b.s.marked).toBe(false);
    expect(b.events).toEqual(['cleared']);
  });

  it('el tiempo en zona se reinicia al salir y no cuenta a quien se sincroniza', () => {
    expect(run(newTeamResonance(), [far], 12).s.zoneT).toBeCloseTo(12);
    expect(run({ value: 40, zoneT: 15, marked: false }, [away], 0.1).s.zoneT).toBe(0);
    expect(run(newTeamResonance(), [{ ...near, syncing: true }], 5).s.zoneT).toBe(0);
  });

  it('un trío se marca antes que alguien solo, y el anillo lejano tarda más que el cercano', () => {
    const t = (members: MemberPresence[]) => { let s = newTeamResonance(), n = 0; while (!s.marked && n < 1000) { s = stepTeamResonance(s, members, 0.1).state; n++; } return n; };
    expect(t([near, near, near])).toBeLessThan(t([near]));
    expect(t([near])).toBeLessThan(t([far]));
  });
});

describe('Relocalización del portal', () => {
  const cands = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }, { x: 900, y: 900 }];

  it('elige el candidato libre más alejado de los portales en uso', () => {
    expect(pickRelocation(cands, [0, 1])).toBe(2);
    expect(pickRelocation(cands, [0, 2])).toBe(1);
  });

  it('sin candidatos libres el portal se queda donde está', () => {
    expect(pickRelocation(cands.slice(0, 2), [0, 1])).toBeNull();
  });
});
