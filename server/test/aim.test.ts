import { describe, expect, it } from 'vitest';
import { Match, type Conn } from '../src/game';
import { AMMO_MAX, FOCOS, TILE, WALL, defaultProfile, type Profile } from '@shared/index';

type Extra = Partial<{ mx: number; my: number; dt: number; sp: number; swap: boolean; viewT: number; fire: { x: number; y: number; n: number }; cast: { slot: 'Q' | 'E' | 'R'; x: number; y: number } }>;
const input = (seq: number, extra: Extra = {}) =>
  ({ type: 'input' as const, seq, mx: 0, my: 0, dt: 0, sp: 1, swap: false, ax: 0, ay: 1, attack: false, interact: false, use: false, ...extra });

/** Partida en campo abierto con builds elegidos: p0 contra p1 (y p2 compañero de p0 si se pide). */
function arena(builds: { school?: string; focos?: [string, string] }[], teams?: number[]) {
  const sent: Record<string, any[]> = {};
  const entries = builds.map((b, i) => {
    const id = `p${i}`; sent[id] = [];
    const conn: Conn = { id, name: `jugador${i}`, send: (m: any) => sent[id].push(m) };
    const base = defaultProfile(id);
    const profile: Profile = { ...base, build: { school: (b.school ?? 'tharven') as Profile['build']['school'], focos: b.focos ?? ['gemelas', 'revolver'] } };
    return { conn, team: teams?.[i] ?? i, profile };
  });
  const match = new Match(entries, () => {});
  match.map.tiles.fill(0); // campo abierto: la prueba no depende del mapa generado
  const actors = entries.map((e) => match.actor(e.conn.id)!);
  const x = 20 * TILE, y = 20 * TILE;
  for (const a of actors) { a.x = x; a.y = y; a.history = []; }
  return { match, sent, actors, x, y };
}
const lastSnap = (sent: any[]) => sent.filter((m) => m.type === 'snap').at(-1);

describe('Básico apuntado con munición', () => {
  it('el arco de las Espadas Gemelas solo golpea hacia donde se apunta y gasta una carga', () => {
    const { match, actors: [a, b] } = arena([{}, {}]);
    b.y = a.y + 70;
    match.handleInput('p0', input(1, { fire: { x: a.x, y: a.y - 100, n: 1 } })); // hacia arriba: falla
    expect(b.hp).toBe(100);
    expect(a.ammo).toBe(AMMO_MAX - 1);
    a.nextShot = 0;
    match.handleInput('p0', input(2, { fire: { x: b.x, y: b.y, n: 2 } })); // hacia abajo: acierta
    expect(b.hp).toBe(100 - FOCOS.gemelas.basic.dmg);
    match.stop();
  });

  it('sin cargas no dispara; respeta el intervalo y recarga con el tiempo', () => {
    const { match, actors: [a, b] } = arena([{}, {}]);
    b.y = a.y + 70;
    match.handleInput('p0', input(1, { fire: { x: b.x, y: b.y, n: 1 } }));
    match.handleInput('p0', input(2, { fire: { x: b.x, y: b.y, n: 2 } })); // dentro del intervalo: rechazado
    expect(b.hp).toBe(100 - 11);
    for (let n = 3; n <= 6; n++) { a.nextShot = 0; match.handleInput('p0', input(n, { fire: { x: b.x, y: b.y, n } })); }
    expect(a.ammo).toBeLessThan(1);
    expect(b.hp).toBe(100 - 11 * 3); // solo 3 cargas
    const now = Date.now();
    for (let i = 0; i < 40; i++) match.tick(now + i * 33); // ~1.3 s: vuelve al menos una carga
    expect(a.ammo).toBeGreaterThanOrEqual(1);
    match.stop();
  });

  it('el arco usa compensación de lag: acierta donde lo veía el atacante (máx. 250 ms)', () => {
    const { match, actors: [a, b], x, y } = arena([{}, {}]);
    const now = Date.now();
    b.history = [{ t: now - 400, x, y: y + 60 }, { t: now - 120, x, y: y + 60 }, { t: now - 100, x, y: y + 300 }, { t: now, x, y: y + 300 }];
    b.y = y + 300;
    match.handleInput('p0', input(1, { fire: { x, y: y + 60, n: 1 }, viewT: now - 150 }));
    expect(b.hp).toBeLessThan(100);
    b.hp = 100; a.nextShot = 0;
    b.history = [{ t: now - 1000, x, y: y + 60 }, { t: now - 300, x, y: y + 300 }, { t: now, x, y: y + 300 }];
    match.handleInput('p0', input(2, { fire: { x, y: y + 60, n: 2 }, viewT: now - 900 })); // pide demasiado atrás: se recorta a 250 ms
    expect(b.hp).toBe(100);
    match.stop();
  });

  it('la bala del Revólver viaja, acierta en línea y se puede esquivar', () => {
    const { match, actors: [a, b] } = arena([{ focos: ['revolver', 'gemelas'] }, {}]);
    b.y = a.y + 4 * TILE;
    const now = Date.now();
    match.handleInput('p0', input(1, { fire: { x: b.x, y: b.y, n: 1 } }));
    expect(match.projectiles).toHaveLength(1);
    expect(b.hp).toBe(100); // aún no llega
    for (let i = 1; i < 15; i++) match.tick(now + i * 33);
    expect(b.hp).toBe(91);
    // Segundo disparo: el rival se hace a un lado y la bala sigue de largo.
    a.nextShot = 0;
    match.handleInput('p0', input(2, { fire: { x: b.x, y: b.y, n: 2 } }));
    b.x += 2 * TILE;
    for (let i = 15; i < 30; i++) match.tick(now + i * 33);
    expect(b.hp).toBe(91);
    match.stop();
  });

  it('Lanzamiento (R de la Lanza) atraviesa: golpea a dos rivales en la misma línea', () => {
    const { match, actors: [a, b, c] } = arena([{ focos: ['lanza', 'gemelas'] }, {}, {}], [0, 1, 1]);
    b.y = a.y + 2 * TILE; c.y = a.y + 4 * TILE;
    match.handleInput('p0', input(1, { cast: { slot: 'R', x: a.x, y: a.y + 400 } }));
    const now = Date.now();
    for (let i = 1; i < 20; i++) match.tick(now + i * 33);
    expect(b.hp).toBe(80); expect(c.hp).toBe(80);
    match.stop();
  });

  it('la estocada de la Lanza golpea en línea recta, no a los lados', () => {
    const { match, actors: [a, b, c] } = arena([{ focos: ['lanza', 'gemelas'] }, {}, {}], [0, 1, 1]);
    b.y = a.y + 2 * TILE; c.x = a.x + 1.5 * TILE; c.y = a.y + TILE;
    match.handleInput('p0', input(1, { fire: { x: a.x, y: a.y + 300, n: 1 } }));
    expect(b.hp).toBe(100 - FOCOS.lanza.basic.dmg);
    expect(c.hp).toBe(100);
    match.stop();
  });

  it('la Siega de la Guadaña daña y atrae al rival hacia quien la lanza', () => {
    const { match, actors: [a, b] } = arena([{ focos: ['guadana', 'gemelas'] }, {}]);
    b.y = a.y + 2.5 * TILE;
    match.handleInput('p0', input(1, { cast: { slot: 'R', x: a.x, y: a.y } }));
    expect(b.hp).toBe(88);
    expect(b.knock?.vy).toBeLessThan(0); // hacia arriba, donde está el lanzador
    match.stop();
  });

  it('nadie va más rápido de lo normal sin una embestida autorizada', () => {
    const { match, actors: [a] } = arena([{}, {}]);
    const x0 = a.x;
    match.handleInput('p0', input(1, { mx: 1, dt: 0.1, sp: 5 }));
    const now = Date.now();
    for (let i = 0; i < 6; i++) match.tick(now + i * 33);
    expect(a.x - x0).toBeLessThanOrEqual(230 * 0.1 + 1);
    match.stop();
  });
});

describe('Escuelas', () => {
  it('Seléth · Velo: invisible para el rival lejano, visible de cerca; atacar lo descubre', () => {
    const { match, sent, actors: [a, b] } = arena([{ school: 'seleth' }, {}]);
    b.y = a.y + 5 * TILE;
    match.handleInput('p0', input(1, { cast: { slot: 'Q', x: a.x, y: a.y } }));
    match.tick();
    expect(lastSnap(sent.p1).others.map((o: any) => o.id)).toEqual([]);
    b.y = a.y + TILE; match.tick();
    expect(lastSnap(sent.p1).others.map((o: any) => o.id)).toEqual(['p0']);
    b.y = a.y + 5 * TILE;
    match.handleInput('p0', input(2, { fire: { x: a.x, y: a.y - 100, n: 1 } }));
    match.tick();
    expect(lastSnap(sent.p1).others.map((o: any) => o.id)).toEqual(['p0']);
    match.stop();
  });

  it('Seléth · Paso sin Nombre: aparece más allá pero no atraviesa muros', () => {
    const { match, actors: [a] } = arena([{ school: 'seleth' }, {}]);
    const x0 = a.x;
    match.handleInput('p0', input(1, { cast: { slot: 'E', x: a.x + 10 * TILE, y: a.y } }));
    expect(a.x - x0).toBeCloseTo(4.5 * TILE, 0);
    // Muro dos casillas a la derecha: se detiene antes.
    const tx = Math.floor((a.x + 2 * TILE) / TILE), ty = Math.floor(a.y / TILE);
    match.map.tiles[ty * match.map.width + tx] = WALL;
    a.cds = {}; a.gcdUntil = 0;
    const x1 = a.x;
    match.handleInput('p0', input(2, { cast: { slot: 'E', x: a.x + 10 * TILE, y: a.y } }));
    expect(a.x).toBeLessThan(tx * TILE);
    expect(a.x).toBeGreaterThan(x1);
    match.stop();
  });

  it('Vaerel · Atadura inmoviliza al rival; Hilo de Vida cura al compañero', () => {
    const { match, actors: [a, b, c] } = arena([{ school: 'vaerel' }, {}, {}], [0, 1, 0]);
    b.y = a.y + 3 * TILE;
    match.handleInput('p0', input(1, { cast: { slot: 'E', x: b.x, y: b.y } }));
    const now = Date.now();
    for (let i = 1; i < 10; i++) match.tick(now + i * 33);
    expect(b.rootUntil).toBeGreaterThan(now);
    const y0 = b.y;
    match.handleInput('p1', input(1, { my: 1, dt: 0.1 }));
    match.tick(now + 400);
    expect(b.y).toBe(y0);
    c.hp = 50; c.x = a.x + TILE; a.gcdUntil = 0;
    match.handleInput('p0', input(2, { cast: { slot: 'Q', x: c.x, y: c.y } }));
    expect(c.hp).toBe(75);
    match.stop();
  });

  it('Orrath · Escuchar al Viento revela al rival aunque haya un muro de por medio', () => {
    const { match, sent, actors: [a, b] } = arena([{ school: 'orrath' }, {}]);
    b.x = a.x + 6 * TILE;
    const ty = Math.floor(a.y / TILE);
    for (let dy = -3; dy <= 3; dy++) match.map.tiles[(ty + dy) * match.map.width + Math.floor((a.x + 3 * TILE) / TILE)] = WALL;
    match.tick();
    expect(lastSnap(sent.p0).others).toHaveLength(0);
    match.handleInput('p0', input(1, { cast: { slot: 'Q', x: a.x, y: a.y } }));
    match.tick();
    const o = lastSnap(sent.p0).others;
    expect(o.map((x: any) => x.id)).toEqual(['p1']);
    expect(o[0].rev).toBe(true);
    match.stop();
  });

  it('Orrath · Ráfaga daña y empuja en cono', () => {
    const { match, actors: [a, b] } = arena([{ school: 'orrath' }, {}]);
    b.y = a.y + 2 * TILE;
    match.handleInput('p0', input(1, { cast: { slot: 'E', x: b.x, y: b.y } }));
    expect(b.hp).toBe(90);
    expect(b.knock?.vy).toBeGreaterThan(0);
    match.stop();
  });
});
