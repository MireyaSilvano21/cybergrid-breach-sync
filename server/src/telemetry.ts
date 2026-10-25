import { createRng, randInt, type MatchRecord } from '@shared/index';
import type { Totals } from './db';

export interface TelemetrySummary {
  matches: number;
  playerEntries: number;
  winRate: number;
  kdr: number;
  avgSurvivalS: number;
  avgMatchDurationS: number;
  avgExtractedValue: number;
  generatedAt: number;
}

/**
 * Almacén de partidas con agregados incrementales: el resumen se calcula en O(1)
 * para responder /api/test/telemetry muy por debajo de 200 ms con miles de partidas.
 */
export class TelemetryStore {
  private n = 0;
  private agg = { entries: 0, wins: 0, kills: 0, deaths: 0, survival: 0, duration: 0, loot: 0 };

  add(m: MatchRecord) {
    this.n++;
    this.agg.duration += m.durationS;
    for (const p of m.players) {
      this.agg.entries++;
      if (p.extracted) this.agg.wins++;
      this.agg.kills += p.kills;
      this.agg.deaths += p.deaths;
      this.agg.survival += p.survivedS;
      this.agg.loot += p.lootValue ?? 0;
    }
  }

  addMany(ms: MatchRecord[]) { for (const m of ms) this.add(m); }

  /** Suma los totales guardados en la base (se llama una vez al arrancar el servidor). */
  restore(t: Totals) {
    this.n += t.matches;
    const a = this.agg;
    a.entries += t.entries; a.wins += t.wins; a.kills += t.kills; a.deaths += t.deaths; a.survival += t.survival; a.duration += t.duration; a.loot += t.loot;
  }

  reset() {
    this.n = 0;
    this.agg = { entries: 0, wins: 0, kills: 0, deaths: 0, survival: 0, duration: 0, loot: 0 };
  }

  get count() { return this.n; }

  summary(): TelemetrySummary {
    const a = this.agg, n = this.n;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return {
      matches: n,
      playerEntries: a.entries,
      winRate: a.entries ? r(a.wins / a.entries) : 0,
      kdr: r(a.kills / Math.max(1, a.deaths)),
      avgSurvivalS: a.entries ? r(a.survival / a.entries) : 0,
      avgMatchDurationS: n ? r(a.duration / n) : 0,
      avgExtractedValue: a.wins ? r(a.loot / a.wins) : 0,
      generatedAt: Date.now(),
    };
  }
}

/** Genera partidas sintéticas reproducibles para /api/test/seed. */
export function generateMatches(count: number, seed = 1): MatchRecord[] {
  const rng = createRng(seed);
  const names = ['tharven', 'seleth', 'vaerel', 'orrath', 'arcanista', 'umbral', 'runa', 'eco'];
  return Array.from({ length: count }, (_, i) => {
    const durationS = randInt(rng, 240, 1080);
    const players = Array.from({ length: randInt(rng, 2, 12) }, (_, j) => {
      const survivedS = randInt(rng, 30, durationS);
      const extracted = rng() < 0.4;
      return {
        name: `${names[j % names.length]}${j}`,
        kills: randInt(rng, 0, 6),
        deaths: rng() < 0.55 ? 1 : 0,
        survivedS,
        extracted,
        lootValue: extracted ? randInt(rng, 50, 900) : 0,
      };
    });
    return { id: `seed-${seed}-${i}`, endedAt: Date.now(), durationS, players };
  });
}

export const telemetry = new TelemetryStore();
