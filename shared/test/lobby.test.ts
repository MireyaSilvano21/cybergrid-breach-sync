import { describe, expect, it } from 'vitest';
import { pickMatch, queueStatus, buildFromProfile, defaultProfile, ProfileSchema, ClientMessageSchema, DEFAULT_BUILD } from '../src/index';

const rules = { minPlayers: 2, minTeams: 2, waitMs: 15000 };
const q = (id: string, size: number, since: number) => ({ id, size, since });

describe('Emparejamiento', () => {
  it('con 4 escuadras arranca al instante y cada escuadra es un equipo', () => {
    expect(pickMatch([q('a', 3, 0), q('b', 1, 1), q('c', 2, 2), q('d', 1, 3), q('e', 3, 4)], 10, rules)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('espera el mínimo de jugadores y de equipos, y luego unos segundos por si llegan más', () => {
    expect(pickMatch([q('a', 3, 0)], 60000, rules)).toBeNull(); // una escuadra sola no tiene rivales
    expect(pickMatch([q('a', 1, 0), q('b', 1, 5000)], 10000, rules)).toBeNull(); // aún dentro de la espera
    expect(pickMatch([q('a', 1, 0), q('b', 1, 5000)], 15000, rules)).toEqual(['a', 'b']);
    expect(pickMatch([q('a', 1, 0)], 15000, { minPlayers: 1, minTeams: 1, waitMs: 0 })).toEqual(['a']);
  });

  it('el estado dice cuánto falta y cuándo arranca', () => {
    expect(queueStatus([q('a', 1, 0)], 1000, rules)).toEqual({ players: 1, teams: 1, needPlayers: 1, needTeams: 1, startsInMs: null });
    expect(queueStatus([q('a', 2, 0), q('b', 1, 0)], 5000, rules).startsInMs).toBe(10000);
  });
});

describe('Perfil de Preparación', () => {
  it('se valida y arma el build con los Nombres de la escuela; Focos repetidos vuelven al de prueba', () => {
    const p = defaultProfile('jugador');
    expect(ProfileSchema.safeParse(p).success).toBe(true);
    expect(buildFromProfile({ ...p, build: { school: 'tharven', focos: ['anillo', 'vara'] } }).focos).toEqual(['anillo', 'vara']);
    expect(buildFromProfile({ ...p, build: { school: 'seleth', focos: ['daga', 'arco'] } })).toEqual({ school: 'seleth', nombres: ['velo', 'paso'], focos: ['daga', 'arco'] });
    expect(buildFromProfile({ ...p, build: { school: 'tharven', focos: ['vara', 'vara'] } })).toBe(DEFAULT_BUILD);
    expect(ProfileSchema.safeParse({ ...p, appearance: { ...p.appearance, body: 'gigante' } }).success).toBe(false);
  });

  it('los mensajes del campamento se validan', () => {
    expect(ClientMessageSchema.safeParse({ type: 'party_join', code: 'ab2cd' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'party_join', code: 'ABC' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'queue', on: true }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'profile', profile: defaultProfile('x') }).success).toBe(true);
  });
});
