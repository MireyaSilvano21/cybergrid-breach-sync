import { describe, expect, it } from 'vitest';
import { Match, type Conn } from '../src/game';
import { INTERACT_RANGE, ITEMS, itemValue, byValueDensity } from '@shared/index';

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

type Extra = Partial<{ use: boolean; attack: boolean; interact: boolean; ax: number; ay: number; viewT: number; mx: number; my: number; dt: number; sp: number; swap: boolean; fire: { x: number; y: number; n: number }; cast: { slot: 'Q' | 'E' | 'R'; x: number; y: number } }>;
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
    // Tomar todo guarda primero lo que más vale por casilla (no en el orden del cofre).
    expect(match.actor('p0')!.inventory).toEqual(byValueDensity(items));
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
