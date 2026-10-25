import { describe, expect, it } from 'vitest';
import { RITUAL, newRitual, startRitual, stepRitual, damageRitual, waveFor, heartWave, needleAt, judgeName, plausibleNeedle, applyName } from '@shared/ritual';
import { MONSTERS, createMonster, stepMonster, pickTarget, ERRANTE_LUNGE } from '@shared/desnombrados';
import { FLOOR, type GridMap } from '@shared/map';

function open(w = 40, h = 40): GridMap {
  return { seed: 1, modules: 1, width: w, height: h, tiles: Array(w * h).fill(FLOOR), layout: [], spawns: [], portalCandidates: [], portals: [0, 1], monoliths: [], vault: { x: 0, y: 0 }, chestSpots: [], props: [], sealsOpen: { vault: false, heart: false } };
}

describe('Ritual del monolito', () => {
  it('las oleadas escalan con el equipo: alguien solo enfrenta menos que un trío', () => {
    expect(waveFor(1, 1).length).toBeLessThan(waveFor(1, 3).length);
    expect(waveFor(2, 3).length).toBeGreaterThan(waveFor(1, 3).length);
    expect(waveFor(1, 1)).not.toContain('coloso');
    expect(heartWave()).toContain('coloso');
  });

  it('avanza, manda la segunda oleada y se completa', () => {
    const r = newRitual(); startRitual(r, 2);
    const events: string[] = [];
    for (let i = 0; i < RITUAL.durationS * 10 + 5; i++) { const e = stepRitual(r, 0.1, i * 100); if (e) events.push(e); }
    expect(events).toEqual(['wave2', 'complete']);
    expect(r.phase).toBe('completo');
    expect(r.team).toBe(2);
  });

  it('con poca integridad se detiene hasta la prueba de Nombre; en cero se rompe y descansa', () => {
    const r = newRitual(); startRitual(r, 0);
    damageRitual(r, 100 - RITUAL.repairBelow + 1);
    expect(stepRitual(r, 0.1, 0)).toBe('repair');
    const p = r.progress;
    stepRitual(r, 1, 100);
    expect(r.progress).toBe(p);
    damageRitual(r, 100);
    expect(stepRitual(r, 0.1, 1000)).toBe('broken');
    expect(stepRitual(r, 0.1, 1000 + RITUAL.cooldownS * 1000 - 1)).toBeNull();
    expect(stepRitual(r, 0.1, 1000 + RITUAL.cooldownS * 1000)).toBe('ready');
    expect(r.phase).toBe('dormido');
  });

  it('la prueba de Nombre distingue perfecto, correcto y errado', () => {
    expect(judgeName(2, 2)).toBe('perfecto');
    expect(judgeName(2 + RITUAL.zone / 2 - 0.01, 2)).toBe('correcto');
    expect(judgeName(2 + Math.PI, 2)).toBe('errado');
    expect(judgeName(0.05, Math.PI * 2 - 0.05)).toBe('perfecto');
  });

  it('solo acepta un ángulo por el que la aguja acaba de pasar', () => {
    const el = 2000, now = needleAt(el);
    expect(plausibleNeedle(now, el)).toBe(true);
    expect(plausibleNeedle(needleAt(el - 200), el)).toBe(true);
    expect(plausibleNeedle(now + 1.5, el)).toBe(false);
  });

  it('un Nombre correcto repara y reanuda; uno errado pausa y quita progreso', () => {
    const r = newRitual(); startRitual(r, 0); r.integrity = 20; r.phase = 'reparar'; r.progress = 0.5;
    applyName(r, 'errado', 1000);
    expect(r.phase).toBe('reparar');
    expect(r.pausedUntil).toBe(1000 + RITUAL.errPauseMs);
    expect(r.progress).toBeCloseTo(0.45);
    applyName(r, 'correcto', 3000);
    expect(r.phase).toBe('defensa');
    expect(r.integrity).toBe(50);
  });
});

describe('IA de los Desnombrados', () => {
  it('persigue al jugador cercano; sin jugadores va contra el monolito', () => {
    const m = createMonster(1, 'errante', 500, 500, 0, { x: 500, y: 500 });
    const mono = { id: 'monolito', x: 800, y: 500, r: 40 };
    expect(pickTarget(m, [{ id: 'p', x: 600, y: 500, r: 18 }], mono)?.id).toBe('p');
    expect(pickTarget(m, [{ id: 'p', x: 500 + MONSTERS.errante.aggro + 50, y: 500, r: 18 }], mono)?.id).toBe('monolito');
  });

  it('se acerca, prepara el golpe sobre un punto fijo y salta al golpear', () => {
    const map = open(), m = createMonster(1, 'errante', 300, 300, 0, { x: 300, y: 300 });
    const p = { id: 'p', x: 500, y: 300, r: 18 };
    let now = 0;
    while (m.state === 'move' && now < 5000) { stepMonster(map, m, [p], null, now, 0.033); now += 33; }
    expect(m.state).toBe('windup');
    expect(m.aimX).toBe(500);
    const x0 = m.x;
    const s = stepMonster(map, m, [{ ...p, x: 700 }], null, m.until, 0.033);
    expect(s).not.toBeNull();
    expect(s!.r).toBe(MONSTERS.errante.area);
    expect(m.x - x0).toBeGreaterThan(0);
    expect(m.x - x0).toBeLessThanOrEqual(ERRANTE_LUNGE + 0.01);
    expect(m.state).toBe('recover');
  });

  it('el Susurrante ataca de lejos y su golpe cae después (los espíritus viajan)', () => {
    const map = open(), m = createMonster(1, 'susurrante', 300, 300, 0, { x: 300, y: 300 });
    stepMonster(map, m, [{ id: 'p', x: 300 + MONSTERS.susurrante.reach, y: 300, r: 18 }], null, 0, 0.033);
    expect(m.state).toBe('windup');
    const s = stepMonster(map, m, [], null, m.until, 0.033)!;
    expect(s.at).toBeGreaterThan(m.until - MONSTERS.susurrante.recoverMs);
  });
});
