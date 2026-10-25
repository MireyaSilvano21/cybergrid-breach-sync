import { describe, expect, it } from 'vitest';
import { Match, type Conn } from '../src/game';
import { INTERACT_RANGE, ITEMS, itemValue } from '@shared/index';

function setup(n = 1) {
  const sent: Record<string, any[]> = {};
  const conns: Conn[] = Array.from({ length: n }, (_, i) => {
    const id = `p${i}`; sent[id] = [];
    return { id, name: `jugador${i}`, send: (m: any) => sent[id].push(m) };
  });
  let record: any = null;
  const match = new Match(conns, (r) => { record = r; });
  return { match, sent, getRecord: () => record };
}

type Extra = Partial<{ use: boolean; attack: boolean; interact: boolean; ax: number; ay: number; viewT: number; mx: number; my: number; dt: number; sp: number; swap: boolean; target: string | null; cast: { slot: 'Q' | 'E' | 'R'; x: number; y: number } }>;
const input = (seq: number, extra: Extra = {}) =>
  ({ type: 'input' as const, seq, mx: 0, my: 0, dt: 0, sp: 1, swap: false, ax: 0, ay: 1, attack: false, interact: false, use: false, ...extra });

/** Coloca al jugador junto al primer cofre. */
function standAtChest(match: Match, id = 'p0') {
  const chest = match.chests[0];
  const a = match.actor(id)!;
  a.x = chest.x; a.y = chest.y + INTERACT_RANGE / 2;
  return chest;
}

describe('Interacción autoritativa con cofres', () => {
  it('primer uso abre el cofre, segundo uso entrega el botín y lo deja vacío', () => {
    const { match } = setup();
    const chest = standAtChest(match);
    const items = [...chest.items];
    match.handleInput('p0', input(1, { use: true })); match.tick();
    expect(chest.state).toBe('open');
    expect(match.actor('p0')!.inventory).toEqual([]);
    match.handleInput('p0', input(2, { use: true })); match.tick();
    expect(chest.state).toBe('empty');
    expect(match.actor('p0')!.inventory).toEqual(items);
    match.stop();
  });

  it('rechaza el uso si el jugador está lejos del cofre', () => {
    const { match } = setup();
    const chest = standAtChest(match);
    const a = match.actor('p0')!;
    a.x = chest.x + INTERACT_RANGE * 3;
    match.handleInput('p0', input(1, { use: true })); match.tick();
    expect(chest.state).toBe('closed');
    match.stop();
  });

  it('un toque rápido no se pierde aunque llegue otro input antes del tick', () => {
    const { match } = setup();
    const chest = standAtChest(match);
    match.handleInput('p0', input(1, { use: true }));
    match.handleInput('p0', input(2, { use: false }));
    match.tick();
    expect(chest.state).toBe('open');
    match.stop();
  });
});

describe('Muerte y extracción', () => {
  it('al morir suelta Restos con su botín y otro jugador puede saquearlos', () => {
    const { match } = setup(2);
    const a = match.actor('p0')!, b = match.actor('p1')!;
    a.inventory = ['corona', 'idolo'];
    a.x = 1000; a.y = 1000; a.hp = 5;
    b.x = 1000; b.y = 1000 - 40; // b mira hacia abajo (ay = 1) y ataca a a
    (match as any).hurt(a, 10, b);
    expect(a.alive).toBe(false);
    expect(a.inventory).toEqual([]);
    expect(match.remains).toHaveLength(1);
    match.handleInput('p1', input(1, { use: true })); match.tick();
    expect(b.inventory).toEqual(['corona', 'idolo']);
    expect(match.remains).toHaveLength(0);
    match.stop();
  });

  it('el valor del botín extraído llega al registro de la partida', () => {
    const { match, getRecord } = setup(1);
    const a = match.actor('p0')!;
    a.inventory = ['orbe', 'esquirlas'];
    a.extracted = true;
    match.tick();
    const rec = getRecord();
    expect(rec.players[0].lootValue).toBe(itemValue(['orbe', 'esquirlas']));
    expect(rec.players[0].lootValue).toBe(ITEMS.orbe.value + ITEMS.esquirlas.value);
  });
});

describe('Compensación de lag en los golpes', () => {
  /** Simula que el objetivo estuvo frente al atacante y se movió fuera de alcance 120 ms después. */
  function scenario() {
    const ctx = setup(2);
    const a = ctx.match.actor('p0')!, b = ctx.match.actor('p1')!;
    const { x, y } = ctx.match.map.spawns[0]; // centro de una llegada: piso libre
    a.x = x; a.y = y; b.hp = 100;
    const now = Date.now();
    b.history = [
      { t: now - 400, x, y: y + 60 },
      { t: now - 120, x, y: y + 60 },
      { t: now - 100, x, y: y + 300 },
      { t: now, x, y: y + 300 },
    ];
    b.x = x; b.y = y + 300; // posición actual: fuera de alcance
    return { ...ctx, a, b, now };
  }

  it('acierta si el objetivo estaba en alcance en lo que vio el atacante', () => {
    const { match, b, now, sent } = scenario();
    match.handleInput('p0', input(1, { target: 'p1', viewT: now - 150 }));
    match.tick(now);
    expect(b.hp).toBeLessThan(100);
    expect(sent.p0.some((m) => m.type === 'hit' && m.target === 'p1')).toBe(true);
    match.stop();
  });

  it('sin compensación (instante actual) el mismo golpe falla', () => {
    const { match, b, now } = scenario();
    match.handleInput('p0', input(1, { target: 'p1' }));
    match.tick(now);
    expect(b.hp).toBe(100);
    match.stop();
  });

  it('no retrocede más de 250 ms aunque el cliente lo pida', () => {
    const { match, b, now } = scenario();
    const { x, y } = match.map.spawns[0];
    b.history = [{ t: now - 1000, x, y: y + 60 }, { t: now - 300, x, y: y + 300 }, { t: now, x, y: y + 300 }];
    match.handleInput('p0', input(1, { target: 'p1', viewT: now - 900 }));
    match.tick(now);
    expect(b.hp).toBe(100);
    match.stop();
  });
});

describe('Combate estilo Albion', () => {
  /** Dos jugadores frente a frente en una llegada (piso libre). */
  function duel(dist: number) {
    const ctx = setup(2);
    const a = ctx.match.actor('p0')!, b = ctx.match.actor('p1')!;
    ctx.match.map.tiles.fill(0); // campo abierto: la prueba no depende del mapa generado
    const x = 20 * 64, y = 20 * 64;
    a.x = x; a.y = y; b.x = x; b.y = y + dist;
    a.history = []; b.history = [];
    return { ...ctx, a, b };
  }

  it('el básico es automático sobre el objetivo fijado y respeta el ritmo del Foco', () => {
    const { match, b } = duel(60);
    let now = Date.now();
    match.handleInput('p0', input(1, { target: 'p1' }));
    for (let i = 0; i < 32; i++) match.tick(now + i * 33); // ~1 s con la Vara (1 golpe por segundo)
    expect(b.hp).toBe(100 - 14 * 2); // golpe inmediato y otro al segundo
    match.stop();
  });

  it('fuera de alcance no golpea; con el Anillo (7 casillas) sí', () => {
    const { match, b } = duel(3 * 64);
    const now = Date.now();
    match.handleInput('p0', input(1, { target: 'p1' }));
    match.tick(now);
    expect(b.hp).toBe(100);
    match.handleInput('p0', input(2, { swap: true }));
    match.tick(now + 400);
    match.tick(now + 800);
    expect(b.hp).toBe(90);
    match.stop();
  });

  it('Temblor daña y ralentiza en el radio; respeta la recarga', () => {
    const { match, a, b } = duel(2 * 64);
    const now = Date.now();
    match.handleInput('p0', input(1, { cast: { slot: 'E', x: a.x, y: a.y } }));
    expect(b.hp).toBe(92);
    expect(b.slowUntil).toBeGreaterThan(now);
    match.handleInput('p0', input(2, { cast: { slot: 'E', x: a.x, y: a.y } }));
    expect(b.hp).toBe(92); // segunda vez rechazada por la recarga
    match.stop();
  });

  it('la Andanada lanza 5 proyectiles que golpean al que está enfrente', () => {
    const { match, a, b } = duel(3 * 64);
    match.handleInput('p0', input(1, { swap: true }));
    const now = Date.now();
    match.tick(now);
    match.handleInput('p0', input(2, { cast: { slot: 'R', x: a.x, y: a.y + 400 } }));
    expect(match.projectiles.length).toBe(5);
    for (let i = 1; i < 15; i++) match.tick(now + 600 + i * 33);
    expect(b.hp).toBeLessThan(100);
    match.stop();
  });

  it('nadie va más rápido de lo normal sin una embestida autorizada', () => {
    const { match, a } = duel(400);
    const x0 = a.x;
    match.handleInput('p0', input(1, { mx: 1, dt: 0.1, sp: 5 }));
    const now = Date.now();
    for (let i = 0; i < 6; i++) match.tick(now + i * 33);
    expect(a.x - x0).toBeLessThanOrEqual(230 * 0.1 + 1);
    match.stop();
  });
});
