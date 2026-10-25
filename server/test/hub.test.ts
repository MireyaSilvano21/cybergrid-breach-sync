import { describe, expect, it } from 'vitest';
import { Hub } from '../src/hub';
import type { Conn } from '../src/game';

function setup(n: number, rules = { minPlayers: 2, minTeams: 2, waitMs: 0 }) {
  const sent: Record<string, any[]> = {};
  const conns: Conn[] = Array.from({ length: n }, (_, i) => { const id = `p${i}`; sent[id] = []; return { id, name: `jugador${i}`, send: (m: any) => sent[id].push(m) }; });
  const started: { conn: Conn; team: number }[][] = []; const ends: (() => void)[] = [];
  const busy = new Set<string>();
  const hub = new Hub({ rules, busy: (id) => busy.has(id), start: (e, onEnd) => { started.push(e); ends.push(onEnd); } });
  for (const c of conns) hub.connect(c);
  const last = (id: string, type: string) => sent[id].filter((m) => m.type === type).at(-1);
  return { hub, sent, started, ends, busy, last };
}

describe('Escuadras', () => {
  it('cada jugador empieza en su escuadra; otro entra con el código y el líder no cambia', () => {
    const { hub, last } = setup(3);
    const code = last('p0', 'party').code;
    expect(code).toMatch(/^[A-Z0-9]{5}$/);
    expect(hub.join('p1', code)).toBeNull();
    const p = last('p0', 'party');
    expect(p.members.map((m: any) => m.id)).toEqual(['p0', 'p1']);
    expect(p.leader).toBe('p0');
    expect(last('p1', 'party').code).toBe(code);
    expect(hub.join('p2', 'ZZZZZ')).toBe('No existe una escuadra con ese código.');
  });

  it('máximo 3 por escuadra; si el líder se va, lo hereda el siguiente', () => {
    const { hub, last } = setup(4);
    const code = last('p0', 'party').code;
    hub.join('p1', code); hub.join('p2', code);
    expect(hub.join('p3', code)).toBe('La escuadra está completa.');
    hub.disconnect('p0');
    expect(last('p1', 'party').leader).toBe('p1');
  });

  it('la invitación llega con el código de la escuadra', () => {
    const { hub, last } = setup(2);
    expect(hub.invite('p0', 'p1')).toBeNull();
    expect(last('p1', 'invite')).toEqual({ type: 'invite', from: 'jugador0', code: last('p0', 'party').code });
  });
});

describe('Cola de emparejamiento', () => {
  it('solo el líder busca; dos escuadras arrancan juntas, cada una como equipo', () => {
    const { hub, last, started } = setup(3);
    hub.join('p1', last('p0', 'party').code);
    expect(hub.setQueue('p1', true)).toBe('Solo el líder de la escuadra puede buscar partida.');
    hub.setQueue('p0', true);
    hub.tick();
    expect(started).toHaveLength(0); // falta un rival
    expect(last('p0', 'queue')).toMatchObject({ players: 2, teams: 1, needTeams: 1 });
    hub.setQueue('p2', true);
    hub.tick();
    expect(started).toHaveLength(1);
    expect(started[0].map((e) => [e.conn.id, e.team])).toEqual([['p0', 0], ['p1', 0], ['p2', 1]]);
    expect(last('p1', 'party').state).toBe('playing');
  });

  it('al terminar vuelven al campamento; cambiar la escuadra o entrar a una sala cancela la búsqueda', () => {
    const { hub, last, ends, busy } = setup(3);
    hub.setQueue('p0', true); hub.setQueue('p1', true); hub.tick();
    ends[0]();
    expect(last('p0', 'party').state).toBe('idle');
    hub.setQueue('p0', true);
    expect(hub.join('p2', last('p0', 'party').code)).toBe('Esa escuadra está buscando partida o jugando.');
    hub.setQueue('p0', false);
    expect(hub.join('p2', last('p0', 'party').code)).toBeNull();
    hub.setQueue('p0', true);
    hub.leave('p2'); // cambió la escuadra: la búsqueda se cancela
    expect(last('p0', 'party').state).toBe('idle');
    hub.join('p2', last('p0', 'party').code);
    busy.add('p2');
    expect(hub.setQueue('p0', true)).toBe('Alguien de la escuadra está en una sala privada.');
  });

  it('el perfil se guarda y se ve en la escuadra', () => {
    const { hub, last } = setup(1);
    const p = last('p0', 'party').members[0].profile;
    hub.setProfile('p0', { ...p, appearance: { body: 'fornido', outfit: 'seleth_velo', head: 'f' } });
    expect(hub.profileOf('p0')!.appearance.body).toBe('fornido');
    expect(last('p0', 'party').members[0].profile.appearance.outfit).toBe('seleth_velo');
  });
});
