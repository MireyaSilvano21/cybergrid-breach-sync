import { describe, expect, it } from 'vitest';
import { TelemetryStore, generateMatches } from '../src/telemetry';

describe('Telemetría agregada', () => {
  it('calcula Win Rate, KDR y supervivencia promedio', () => {
    const s = new TelemetryStore();
    s.add({ id: 'a', endedAt: 1, durationS: 600, players: [
      { name: 'x', kills: 3, deaths: 0, survivedS: 600, extracted: true, lootValue: 450 },
      { name: 'y', kills: 0, deaths: 1, survivedS: 200, extracted: false },
    ] });
    const r = s.summary();
    expect(r.matches).toBe(1);
    expect(r.winRate).toBe(0.5);
    expect(r.kdr).toBe(3);
    expect(r.avgSurvivalS).toBe(400);
    expect(r.avgExtractedValue).toBe(450);
  });

  it('las partidas generadas son reproducibles con la misma semilla', () => {
    const a = generateMatches(100, 5), b = generateMatches(100, 5);
    expect(a.map((m) => m.players.length)).toEqual(b.map((m) => m.players.length));
  });
});
