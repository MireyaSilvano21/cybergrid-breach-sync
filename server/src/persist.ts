/**
 * Persistencia en segundo plano: el juego escribe en memoria y aquí se encolan las escrituras a la
 * base. Nada de esto se espera desde el bucle de la partida ni desde la telemetría.
 */
import { ProfileSchema, type MatchRecord, type Profile } from '@shared/index';
import type { Db, Totals, UserRow } from './db';

interface Job { name: string; run: () => Promise<void>; tries: number }

/** Cola de escrituras en orden, con reintentos y espera creciente. Se puede pausar. */
export class WriteQueue {
  private jobs: Job[] = [];
  private running = false;
  paused = false;
  done = 0;
  dropped = 0;
  lastError: string | null = null;

  constructor(private opts: { baseDelayMs?: number; maxTries?: number; slowMs?: number; log?: (m: string) => void } = {}) {}

  get pending() { return this.jobs.length; }

  push(name: string, run: () => Promise<void>) {
    this.jobs.push({ name, run, tries: 0 });
    void this.pump();
  }

  resume() { this.paused = false; void this.pump(); }

  private async pump() {
    if (this.running || this.paused) return;
    this.running = true;
    const base = this.opts.baseDelayMs ?? 500, max = this.opts.maxTries ?? 10, log = this.opts.log ?? ((m) => console.log(m));
    while (this.jobs.length && !this.paused) {
      const job = this.jobs[0], t0 = performance.now();
      try {
        await job.run();
        this.jobs.shift(); this.done++;
        const ms = performance.now() - t0;
        if (ms > (this.opts.slowMs ?? 1000)) log(`[db] ${job.name} tardó ${Math.round(ms)} ms`);
      } catch (e) {
        job.tries++;
        this.lastError = `${job.name}: ${(e as Error).message}`;
        if (job.tries >= max) { this.jobs.shift(); this.dropped++; log(`[db] se descartó ${job.name} tras ${max} intentos: ${(e as Error).message}`); continue; }
        await new Promise((r) => setTimeout(r, Math.min(30_000, base * 2 ** (job.tries - 1))));
      }
    }
    this.running = false;
  }

  /** Espera a que la cola se vacíe (al apagar el servidor o en pruebas). */
  async flush(timeoutMs = 10_000) {
    const end = Date.now() + timeoutMs;
    while ((this.jobs.length || this.running) && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    return this.jobs.length === 0;
  }
}

/** Lo que la persistencia llena al arrancar: caché de usuarios, perfiles y totales de telemetría. */
export interface Targets {
  loadUsers(rows: UserRow[]): void;
  restoreTelemetry(t: Totals): void;
}

export class Persistence {
  readonly queue: WriteQueue;
  private profiles = new Map<string, Profile>();
  private profileTimers = new Map<string, NodeJS.Timeout>();
  loaded = false;
  loadError: string | null = null;

  constructor(readonly db: Db, private targets: Targets, private opts: { profileDebounceMs?: number; retryLoadMs?: number; baseDelayMs?: number; log?: (m: string) => void } = {}) {
    this.queue = new WriteQueue({ baseDelayMs: opts.baseDelayMs, log: opts.log });
    // Hasta cargar lo que ya hay en la base, las escrituras esperan: así no se cuentan dos veces.
    this.queue.paused = true;
  }

  private log(m: string) { (this.opts.log ?? ((x: string) => console.log(x)))(m); }

  /** Crea tablas y carga usuarios, perfiles y totales. Si la base no responde, reintenta en segundo plano. */
  async start(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.db.init();
        const [users, profiles, totals] = await Promise.all([this.db.loadUsers(), this.db.loadProfiles(), this.db.loadTotals()]);
        this.targets.loadUsers(users);
        for (const { key, data } of profiles) {
          // Un perfil viejo que ya no cumple el esquema (por ejemplo, un Foco que cambió) se ignora.
          const p = ProfileSchema.safeParse(data);
          if (p.success && !this.profiles.has(key)) this.profiles.set(key, p.data);
        }
        this.targets.restoreTelemetry(totals);
        this.loaded = true; this.loadError = null;
        this.queue.resume();
        this.log(`[db] ${this.db.kind}: ${users.length} usuarios, ${profiles.length} perfiles y ${totals.matches} partidas cargadas`);
        return;
      } catch (e) {
        this.loadError = (e as Error).message;
        this.log(`[db] no se pudo cargar la base (intento ${attempt}): ${this.loadError}`);
        await new Promise((r) => setTimeout(r, this.opts.retryLoadMs ?? 10_000));
      }
    }
  }

  saveUser(u: UserRow) { this.queue.push(`usuario ${u.username}`, () => this.db.insertUser(u)); }

  profile(username: string) { return this.profiles.get(username.toLowerCase()); }

  /** Guarda el perfil; los cambios seguidos en Preparación se juntan en una sola escritura. */
  saveProfile(username: string, p: Profile) {
    const key = username.toLowerCase();
    this.profiles.set(key, p);
    clearTimeout(this.profileTimers.get(key));
    this.profileTimers.set(key, setTimeout(() => {
      this.profileTimers.delete(key);
      const latest = this.profiles.get(key);
      if (latest) this.queue.push(`perfil ${key}`, () => this.db.upsertProfile(key, latest));
    }, this.opts.profileDebounceMs ?? 1000));
  }

  saveMatches(ms: MatchRecord[]) { if (ms.length) this.queue.push(`${ms.length} partidas`, () => this.db.insertMatches(ms)); }

  resetMatches() { this.queue.push('borrar partidas', () => this.db.deleteMatches()); }

  /** Al apagar: manda los perfiles pendientes y espera la cola. */
  async shutdown(timeoutMs = 8000) {
    for (const [key, t] of this.profileTimers) {
      clearTimeout(t);
      const p = this.profiles.get(key);
      if (p) this.queue.push(`perfil ${key}`, () => this.db.upsertProfile(key, p));
    }
    this.profileTimers.clear();
    const ok = await this.queue.flush(timeoutMs);
    await this.db.close();
    return ok;
  }

  status() {
    return { tipo: this.db.kind, cargada: this.loaded, pendientes: this.queue.pending, guardadas: this.queue.done, descartadas: this.queue.dropped, ultimoError: this.queue.lastError ?? this.loadError };
  }
}
