import { describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/db';
import { Persistence, WriteQueue } from '../src/persist';
import { TelemetryStore, generateMatches } from '../src/telemetry';
import { defaultProfile, type Profile } from '@shared/index';

/** Un "proceso" del servidor: su propia caché de usuarios y su telemetría, sobre una base compartida. */
function boot(db: MemoryDb, opts: { profileDebounceMs?: number } = {}) {
  const users = new Map<string, { username: string; salt: string; hash: string }>();
  const tele = new TelemetryStore();
  const p = new Persistence(db, {
    loadUsers: (rows) => { for (const u of rows) if (!users.has(u.username.toLowerCase())) users.set(u.username.toLowerCase(), u); },
    restoreTelemetry: (t) => tele.restore(t),
  }, { profileDebounceMs: opts.profileDebounceMs ?? 5, retryLoadMs: 5, baseDelayMs: 5, log: () => {} });
  return { users, tele, p };
}

describe('Base de datos en segundo plano', () => {
  it('usuarios, perfiles y telemetría sobreviven a un reinicio del servidor', async () => {
    const db = new MemoryDb();
    const a = boot(db); await a.p.start();
    a.p.saveUser({ username: 'Mireya', salt: 's', hash: 'h' });
    const perfil: Profile = { ...defaultProfile('Mireya'), build: { school: 'seleth', focos: ['daga', 'arco'] } };
    a.p.saveProfile('Mireya', perfil);
    const partidas = generateMatches(150, 3);
    a.tele.addMany(partidas); a.p.saveMatches(partidas);
    await a.p.shutdown();

    // Reinicio: memoria vacía, misma base.
    const b = boot(db); await b.p.start();
    expect(b.users.get('mireya')?.hash).toBe('h');
    expect(b.p.profile('MIREYA')?.build.school).toBe('seleth');
    // Se compara todo menos la hora en que se generó el resumen.
    const { generatedAt: _a, ...antes } = a.tele.summary();
    const { generatedAt: _b, ...despues } = b.tele.summary();
    expect(despues).toEqual(antes);
  });

  it('una base lenta no frena nada: guardar es inmediato y la telemetría sigue en memoria', async () => {
    const db = new MemoryDb();
    const s = boot(db); await s.p.start();
    db.delayMs = 2000;
    const mil = generateMatches(1000, 9);
    const t0 = performance.now();
    s.tele.addMany(mil); s.p.saveMatches(mil);
    const resumen = s.tele.summary();
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
    expect(resumen.matches).toBe(1000);
    expect(db.matches).toHaveLength(0); // la base todavía no termina
    db.delayMs = 0;
    await s.p.queue.flush(5000);
    expect(db.matches).toHaveLength(1000);
    expect(db.calls.insertMatches).toBe(1); // las 1000 partidas en una sola operación
  });

  it('si la base falla, reintenta hasta guardar y deja registro del error', async () => {
    const db = new MemoryDb();
    const s = boot(db); await s.p.start();
    db.failNext = 3;
    s.p.saveMatches(generateMatches(100, 1));
    await s.p.queue.flush(3000);
    expect(db.matches).toHaveLength(100);
    expect(s.p.status().ultimoError).toContain('no disponible');
    expect(s.p.status().descartadas).toBe(0);
  });

  it('lo que se juega antes de terminar de cargar no se cuenta dos veces', async () => {
    const db = new MemoryDb();
    db.matches = generateMatches(200, 2);
    db.failNext = 2; // la base tarda en responder al arrancar
    const s = boot(db);
    const carga = s.p.start();
    const nuevas = generateMatches(100, 7);
    s.tele.addMany(nuevas); s.p.saveMatches(nuevas);
    await carga;
    await s.p.queue.flush(3000);
    expect(s.tele.count).toBe(300);
    expect(db.matches).toHaveLength(300);
    expect((await db.loadTotals()).matches).toBe(s.tele.count);
  });

  it('los cambios seguidos de perfil se juntan en una sola escritura', async () => {
    const db = new MemoryDb();
    const s = boot(db, { profileDebounceMs: 30 }); await s.p.start();
    const base = defaultProfile('Luz');
    for (const school of ['tharven', 'seleth', 'vaerel', 'orrath'] as const) s.p.saveProfile('Luz', { ...base, build: { ...base.build, school } });
    await new Promise((r) => setTimeout(r, 60));
    await s.p.queue.flush();
    expect(db.calls.upsertProfile).toBe(1);
    expect((db.profiles.get('luz') as Profile).build.school).toBe('orrath');
  });

  it('un perfil guardado que ya no cumple el esquema se ignora', async () => {
    const db = new MemoryDb();
    db.profiles.set('viejo', { appearance: { body: 'gigante' }, build: {} });
    const s = boot(db); await s.p.start();
    expect(s.p.profile('viejo')).toBeUndefined();
  });

  it('la cola escribe en orden aunque un trabajo falle', async () => {
    const q = new WriteQueue({ baseDelayMs: 1, log: () => {} });
    const orden: string[] = []; let fallo = true;
    q.push('a', async () => { if (fallo) { fallo = false; throw new Error('x'); } orden.push('a'); });
    q.push('b', async () => { orden.push('b'); });
    await q.flush(1000);
    expect(orden).toEqual(['a', 'b']);
  });
});
