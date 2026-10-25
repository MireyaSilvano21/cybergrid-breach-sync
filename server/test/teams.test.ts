import { describe, expect, it } from 'vitest';
import { Match, type Conn } from '../src/game';
import { RoomManager } from '../src/rooms';

function conns(n: number) {
  const sent: Record<string, any[]> = {};
  const list: Conn[] = Array.from({ length: n }, (_, i) => { const id = `p${i}`; sent[id] = []; return { id, name: `jugador${i}`, send: (m: any) => sent[id].push(m) }; });
  return { list, sent };
}
const input = (seq: number, extra: Record<string, unknown> = {}) =>
  ({ type: 'input' as const, seq, mx: 0, my: 0, dt: 0, sp: 1, swap: false, ax: 0, ay: 1, attack: false, interact: false, use: false, ...extra });

describe('Equipos en la sala', () => {
  it('reparte a quien entra, deja cambiarse y no pasa de 3 por equipo', () => {
    const rooms = new RoomManager(() => {});
    const room = rooms.create('Prueba', 'host');
    const { list, sent } = conns(5);
    for (const c of list) expect(rooms.join(c, room.id)).toBeNull();
    const team = () => [...room.members.values()].map((m) => m.team);
    expect(team()).toEqual([0, 1, 2, 3, 0]);
    expect(rooms.setTeam('p1', 0)).toBeNull();
    expect(rooms.setTeam('p2', 0)).toBe('Ese equipo ya está completo.');
    const last = sent.p0.at(-1);
    expect(last.type).toBe('lobby');
    expect(last.players.find((p: any) => p.id === 'p1').team).toBe(0);
  });

  it('cambiarse de equipo quita el Listo', () => {
    const rooms = new RoomManager(() => {});
    const room = rooms.create('Prueba', 'host');
    const { list } = conns(2);
    for (const c of list) rooms.join(c, room.id);
    room.members.get('p0')!.ready = true;
    rooms.setTeam('p0', 2);
    expect(room.members.get('p0')!.ready).toBe(false);
  });
});

describe('Equipos en la partida', () => {
  function teamMatch() {
    const { list, sent } = conns(3);
    const match = new Match([{ conn: list[0], team: 0 }, { conn: list[1], team: 0 }, { conn: list[2], team: 1 }], () => {});
    return { match, sent };
  }

  it('los compañeros salen juntos y el rival desde otra llegada', () => {
    const { match } = teamMatch();
    const [a, b, c] = ['p0', 'p1', 'p2'].map((id) => match.actor(id)!);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(200);
    expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(600);
    match.stop();
  });

  it('no hay daño entre compañeros: no se puede fijar a uno y el Temblor no lo toca', () => {
    const { match } = teamMatch();
    const [a, b, c] = ['p0', 'p1', 'p2'].map((id) => match.actor(id)!);
    match.map.tiles.fill(0);
    b.x = a.x; b.y = a.y + 60; c.x = a.x; c.y = a.y - 60;
    match.handleInput('p0', input(1, { target: 'p1' }));
    expect(a.target).toBeNull();
    match.handleInput('p0', input(2, { cast: { slot: 'E', x: a.x, y: a.y } }));
    expect(b.hp).toBe(100);
    expect(c.hp).toBeLessThan(100);
    match.stop();
  });

  it('el compañero llega en cada instantánea aunque esté lejos; el rival lejano no', () => {
    const { match, sent } = teamMatch();
    const [a, b, c] = ['p0', 'p1', 'p2'].map((id) => match.actor(id)!);
    b.x = a.x + 3000; c.x = a.x + 3000; c.y = b.y;
    match.tick();
    const snap = sent.p0.filter((m) => m.type === 'snap').at(-1);
    expect(snap.others.map((o: any) => o.id)).toEqual(['p1']);
    expect(snap.allies).toEqual([{ id: 'p1', name: 'jugador1', hp: 100, alive: true, extracted: false }]);
    expect(snap.you.team).toBe(0);
    match.stop();
  });

  it('el inicio trae el equipo de cada jugador y el registro final también', () => {
    const { list, sent } = conns(2);
    let record: any = null;
    const match = new Match([{ conn: list[0], team: 3 }, { conn: list[1], team: 1 }], (r) => { record = r; });
    match.start(); match.stop();
    const start = sent.p0.find((m) => m.type === 'start');
    expect(start.team).toBe(3);
    expect(start.roster.map((r: any) => ({ id: r.id, name: r.name, team: r.team }))).toEqual([{ id: 'p0', name: 'jugador0', team: 3 }, { id: 'p1', name: 'jugador1', team: 1 }]);
    expect(start.roster[0].app.body).toBeTruthy();
    (match as any).finished = false; (match as any).finish(Date.now());
    expect(record.players.map((p: any) => p.team)).toEqual([3, 1]);
  });
});
