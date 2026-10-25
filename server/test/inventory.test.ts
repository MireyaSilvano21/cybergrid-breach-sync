import { describe, expect, it } from 'vitest';
import { Match, type Conn } from '../src/game';
import { TICK_MS, INVENTORY_SLOTS, CONSUMABLES, byValueDensity } from '@shared/index';

function setup() {
  const sent: Record<string, any[]> = {};
  const list = [0, 1].map((team) => {
    const id = `p${team}`; sent[id] = [];
    const conn: Conn = { id, name: `jugador${team}`, send: (m: any) => sent[id].push(m) };
    return { conn, team };
  });
  return { match: new Match(list, () => {}), sent };
}
let seq = 1;
const send = (match: Match, id: string, extra: Record<string, unknown>) =>
  match.handleInput(id, { type: 'input', seq: seq++, mx: 0, my: 0, dt: 0, sp: 1, swap: false, ax: 0, ay: 1, attack: false, interact: false, use: false, ...extra } as any);
const lastSnap = (msgs: any[]) => msgs.filter((m) => m.type === 'snap').at(-1);

/** Pone unos restos con estos objetos junto al jugador 0. */
function remainsNear(match: Match, items: string[]) {
  const a = match.actor('p0')!;
  match.remains.push({ id: 'prueba', x: a.x + 20, y: a.y, items: [...items], owner: 'alguien' });
  return a;
}

describe('Mochila', () => {
  it('tomar todo empieza por lo que más vale por casilla', () => {
    expect(byValueDensity(['esquirlas', 'corona', 'orbe', 'sal'])).toEqual(['orbe', 'corona', 'sal', 'esquirlas']);
    const { match } = setup();
    const a = remainsNear(match, ['esquirlas', 'esquirlas', 'esquirlas', 'esquirlas', 'esquirlas', 'esquirlas', 'esquirlas', 'esquirlas', 'esquirlas', 'orbe']);
    a.inventory = ['sal'];
    let now = Date.now();
    send(match, 'p0', { inv: { a: 'all', i: 0 } }); match.tick(now += TICK_MS);
    expect(a.inventory).toContain('orbe');
    expect(a.inventory).toHaveLength(INVENTORY_SLOTS);
    match.stop();
  });

  it('se puede tomar un objeto a la vez y la vista del botín cercano llega al cliente', () => {
    const { match, sent } = setup();
    const a = remainsNear(match, ['idolo', 'tonico']);
    let now = Date.now();
    match.tick(now += TICK_MS);
    expect(lastSnap(sent.p0).you.loot).toEqual({ id: 'prueba', items: ['idolo', 'tonico'] });
    send(match, 'p0', { inv: { a: 'take', i: 1, from: 'prueba' } }); match.tick(now += TICK_MS);
    expect(a.inventory).toEqual(['tonico']);
    expect(lastSnap(sent.p0).you.loot.items).toEqual(['idolo']);
    send(match, 'p0', { inv: { a: 'take', i: 0, from: 'prueba' } }); match.tick(now += TICK_MS);
    expect(match.remains.find((r) => r.id === 'prueba')).toBeUndefined();
    match.stop();
  });

  it('si no cabe, avisa y no toma nada', () => {
    const { match, sent } = setup();
    const a = remainsNear(match, ['corona']);
    a.inventory = Array(INVENTORY_SLOTS - 1).fill('esquirlas');
    send(match, 'p0', { inv: { a: 'take', i: 0, from: 'prueba' } }); match.tick(Date.now());
    expect(a.inventory).not.toContain('corona');
    expect(sent.p0.some((m) => m.type === 'notice' && m.message.includes('No cabe'))).toBe(true);
    match.stop();
  });

  it('soltar deja una bolsa en el suelo que otro puede saquear', () => {
    const { match } = setup();
    const a = match.actor('p0')!;
    a.inventory = ['corona', 'sal'];
    send(match, 'p0', { inv: { a: 'drop', i: 0 } }); match.tick(Date.now());
    expect(a.inventory).toEqual(['sal']);
    const bolsa = match.remains.find((r) => r.id.startsWith('d-p0-'))!;
    expect(bolsa.items).toEqual(['corona']);
    const b = match.actor('p1')!; b.x = bolsa.x; b.y = bolsa.y;
    send(match, 'p1', { inv: { a: 'all', i: 0 } }); match.tick(Date.now() + TICK_MS);
    expect(b.inventory).toEqual(['corona']);
    match.stop();
  });

  it('el Tónico cura con el tiempo y un golpe lo corta', () => {
    const { match } = setup();
    const a = match.actor('p0')!;
    a.inventory = ['tonico']; a.hp = 40;
    let now = Date.now();
    send(match, 'p0', { inv: { a: 'use', i: 0 } });
    for (let i = 0; i < 30; i++) match.tick(now += TICK_MS);
    expect(a.inventory).toEqual([]);
    expect(a.hp).toBeGreaterThan(40 + CONSUMABLES.tonico.healPerS * 0.8);
    const hp = a.hp;
    (match as any).hurt(a, 5, null);
    for (let i = 0; i < 15; i++) match.tick(now += TICK_MS);
    expect(a.hp).toBe(hp - 5);
    match.stop();
  });

  it('la Sal de Guarda quita la ralentización y protege un momento', () => {
    const { match } = setup();
    const a = match.actor('p0')!;
    const now = Date.now();
    a.inventory = ['sal']; a.slowUntil = now + 5000; a.rootUntil = now + 5000;
    send(match, 'p0', { inv: { a: 'use', i: 0 } }); match.tick(now);
    expect(a.slowUntil).toBe(0);
    (match as any).applyEffect(match.actor('p1')!, a, { slowMs: 2000 }, a, now + 100, a, 0);
    expect(a.slowUntil).toBe(0);
    match.stop();
  });

  it('no se usan objetos que no son consumibles', () => {
    const { match } = setup();
    const a = match.actor('p0')!;
    a.inventory = ['corona'];
    send(match, 'p0', { inv: { a: 'use', i: 0 } }); match.tick(Date.now());
    expect(a.inventory).toEqual(['corona']);
    match.stop();
  });
});
