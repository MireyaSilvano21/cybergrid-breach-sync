import { createRng, randInt, type MatchRecord } from '@shared/index';

export interface TelemetrySummary {
  matches: number;
  playerEntries: number;
  winRate: number;
  kdr: number;
  avgSurvivalS: number;
  avgMatchDurationS: number;
  generatedAt: number;
}

/**
 * Almacén de partidas con agregados incrementales: el resumen se calcula en O(1)
 * para responder /api/test/telemetry muy por debajo de 200 ms con miles de partidas.
 */
export class TelemetryStore {
  private records: MatchRecord[] = [];
  private agg = { entries: 0, wins: 0, kills: 0, deaths: 0, survival: 0, duration: 0 };

  add(m: MatchRecord) {
    this.records.push(m);
    this.agg.duration += m.durationS;
    for (const p of m.players) {
      this.agg.entries++;
      if (p.extracted) this.agg.wins++;
      this.agg.kills += p.kills;
      this.agg.deaths += p.deaths;
      this.agg.survival += p.survivedS;
    }
  }

  addMany(ms: MatchRecord[]) { for (const m of ms) this.add(m); }

  reset() {
    this.records = [];
    this.agg = { entries: 0, wins: 0, kills: 0, deaths: 0, survival: 0, duration: 0 };
  }

  get count() { return this.records.length; }

  summary(): TelemetrySummary {
    const a = this.agg, n = this.records.length;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return {
      matches: n,
      playerEntries: a.entries,
      winRate: a.entries ? r(a.wins / a.entries) : 0,
      kdr: r(a.kills / Math.max(1, a.deaths)),
      avgSurvivalS: a.entries ? r(a.survival / a.entries) : 0,
      avgMatchDurationS: n ? r(a.duration / n) : 0,
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
      return {
        name: `${names[j % names.length]}${j}`,
        kills: randInt(rng, 0, 6),
        deaths: rng() < 0.55 ? 1 : 0,
        survivedS,
        extracted: rng() < 0.4,
      };
    });
    return { id: `seed-${seed}-${i}`, endedAt: Date.now(), durationS, players };
  });
}

export const telemetry = new TelemetryStore();
