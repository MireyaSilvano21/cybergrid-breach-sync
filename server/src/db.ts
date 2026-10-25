/**
 * Base de datos de CyberGrid: usuarios, perfiles y partidas terminadas.
 *
 * El juego nunca espera a la base (patrón de memoria primero, como Nakama o los DataStores de
 * Roblox): al arrancar se cargan usuarios, perfiles y totales de telemetría a memoria; después
 * todo se lee de memoria y las escrituras van a una cola en segundo plano con reintentos.
 *
 * Con DATABASE_URL se usa Postgres (Neon); sin ella, una base en memoria (desarrollo, CI y E2E).
 */
import type { MatchRecord } from '@shared/index';

export interface UserRow { username: string; salt: string; hash: string }

/** Totales de telemetría: lo mismo que suma TelemetryStore, para cargarlo al arrancar. */
export interface Totals { matches: number; entries: number; wins: number; kills: number; deaths: number; survival: number; duration: number; loot: number }
export const emptyTotals = (): Totals => ({ matches: 0, entries: 0, wins: 0, kills: 0, deaths: 0, survival: 0, duration: 0, loot: 0 });

export interface Db {
  readonly kind: 'memoria' | 'postgres';
  /** Crea las tablas si no existen. */
  init(): Promise<void>;
  loadUsers(): Promise<UserRow[]>;
  loadProfiles(): Promise<{ key: string; data: unknown }[]>;
  loadTotals(): Promise<Totals>;
  insertUser(u: UserRow): Promise<void>;
  upsertProfile(key: string, data: unknown): Promise<void>;
  /** Inserta todas las partidas en una sola operación. */
  insertMatches(ms: MatchRecord[]): Promise<void>;
  deleteMatches(): Promise<void>;
  close(): Promise<void>;
}

/** Totales de una partida (se guardan junto a ella para que cargar la telemetría sea una suma). */
export function matchTotals(m: MatchRecord) {
  let wins = 0, kills = 0, deaths = 0, survival = 0, loot = 0;
  for (const p of m.players) {
    if (p.extracted) wins++;
    kills += p.kills; deaths += p.deaths; survival += p.survivedS; loot += p.lootValue ?? 0;
  }
  return { entries: m.players.length, wins, kills, deaths, survival, loot };
}

/**
 * Base en memoria con la misma interfaz que Postgres. Sirve cuando no hay DATABASE_URL y en las
 * pruebas, donde puede simular una base lenta (delayMs) o que falla las primeras veces (failNext).
 */
export class MemoryDb implements Db {
  readonly kind = 'memoria' as const;
  users = new Map<string, UserRow>();
  profiles = new Map<string, unknown>();
  matches: MatchRecord[] = [];
  calls = { insertMatches: 0, upsertProfile: 0, insertUser: 0 };
  delayMs = 0;
  failNext = 0;

  private async io() {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext > 0) { this.failNext--; throw new Error('base no disponible (simulado)'); }
  }
  async init() { await this.io(); }
  async loadUsers() { await this.io(); return [...this.users.values()]; }
  async loadProfiles() { await this.io(); return [...this.profiles].map(([key, data]) => ({ key, data })); }
  async loadTotals() {
    await this.io();
    const t = emptyTotals();
    for (const m of this.matches) {
      const s = matchTotals(m);
      t.matches++; t.duration += m.durationS;
      t.entries += s.entries; t.wins += s.wins; t.kills += s.kills; t.deaths += s.deaths; t.survival += s.survival; t.loot += s.loot;
    }
    return t;
  }
  async insertUser(u: UserRow) { await this.io(); this.calls.insertUser++; const k = u.username.toLowerCase(); if (!this.users.has(k)) this.users.set(k, u); }
  async upsertProfile(key: string, data: unknown) { await this.io(); this.calls.upsertProfile++; this.profiles.set(key, data); }
  async insertMatches(ms: MatchRecord[]) { await this.io(); this.calls.insertMatches++; this.matches.push(...ms); }
  async deleteMatches() { await this.io(); this.matches = []; }
  async close() {}
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  username_key text PRIMARY KEY,
  username     text NOT NULL,
  salt         text NOT NULL,
  hash         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS profiles (
  username_key text PRIMARY KEY,
  data         jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS matches (
  id          bigserial PRIMARY KEY,
  ext_id      text NOT NULL,
  ended_at    timestamptz NOT NULL,
  duration_s  double precision NOT NULL,
  entries     integer NOT NULL,
  wins        integer NOT NULL,
  kills       integer NOT NULL,
  deaths      integer NOT NULL,
  survival_s  double precision NOT NULL,
  loot        double precision NOT NULL,
  players     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matches_ended_at ON matches (ended_at);
`;

/** Postgres con un grupo pequeño de conexiones reutilizadas (Neon pide SSL en la cadena). */
export async function createPgDb(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000 });
  // Un error de una conexión inactiva (por ejemplo, la base se suspendió) no debe tumbar el servidor.
  pool.on('error', (e: Error) => console.warn('[db] conexión cerrada:', e.message));
  const q = (text: string, params?: unknown[]) => pool.query(text, params);
  return {
    kind: 'postgres',
    async init() { await q(SCHEMA); },
    async loadUsers() { return (await q('SELECT username, salt, hash FROM users')).rows as UserRow[]; },
    async loadProfiles() { return (await q('SELECT username_key AS key, data FROM profiles')).rows as { key: string; data: unknown }[]; },
    async loadTotals() {
      const r = (await q(`SELECT count(*)::int AS matches, coalesce(sum(entries),0)::float8 AS entries, coalesce(sum(wins),0)::float8 AS wins,
        coalesce(sum(kills),0)::float8 AS kills, coalesce(sum(deaths),0)::float8 AS deaths, coalesce(sum(survival_s),0)::float8 AS survival,
        coalesce(sum(duration_s),0)::float8 AS duration, coalesce(sum(loot),0)::float8 AS loot FROM matches`)).rows[0];
      return { matches: r.matches, entries: r.entries, wins: r.wins, kills: r.kills, deaths: r.deaths, survival: r.survival, duration: r.duration, loot: r.loot };
    },
    async insertUser(u) {
      await q('INSERT INTO users (username_key, username, salt, hash) VALUES ($1, $2, $3, $4) ON CONFLICT (username_key) DO NOTHING', [u.username.toLowerCase(), u.username, u.salt, u.hash]);
    },
    async upsertProfile(key, data) {
      await q(`INSERT INTO profiles (username_key, data, updated_at) VALUES ($1, $2, now())
        ON CONFLICT (username_key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [key, JSON.stringify(data)]);
    },
    async insertMatches(ms) {
      if (!ms.length) return;
      // Una sola sentencia para todas las partidas (la siembra puede traer 1000).
      const cols: unknown[][] = [[], [], [], [], [], [], [], [], [], []];
      for (const m of ms) {
        const t = matchTotals(m);
        [m.id, new Date(m.endedAt).toISOString(), m.durationS, t.entries, t.wins, t.kills, t.deaths, t.survival, t.loot, JSON.stringify(m.players)].forEach((v, i) => cols[i].push(v));
      }
      await q(`INSERT INTO matches (ext_id, ended_at, duration_s, entries, wins, kills, deaths, survival_s, loot, players)
        SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::float8[], $4::int[], $5::int[], $6::int[], $7::int[], $8::float8[], $9::float8[], $10::jsonb[])`, cols);
    },
    async deleteMatches() { await q('TRUNCATE matches'); },
    async close() { await pool.end(); },
  };
}
