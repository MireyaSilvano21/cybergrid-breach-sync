import { describe, expect, it } from 'vitest';
import { TEAMS, autoTeam, canJoinTeam, teamCounts, teamSpawns, PlayerRecordSchema, ClientMessageSchema } from '../src/index';

describe('Equipos', () => {
  it('quien entra va al equipo con menos jugadores; con 12 la sala se llena', () => {
    const t: number[] = [];
    for (let i = 0; i < 12; i++) { const k = autoTeam(t); expect(k).not.toBeNull(); t.push(k!); }
    expect(t.slice(0, 4)).toEqual([0, 1, 2, 3]); // los primeros cuatro quedan como rivales
    expect(teamCounts(t)).toEqual([3, 3, 3, 3]);
    expect(autoTeam(t)).toBeNull();
  });

  it('nadie se cambia a un equipo completo ni a uno que no existe', () => {
    expect(canJoinTeam([0, 0, 1], 0)).toBe(true);
    expect(canJoinTeam([0, 0, 0], 0)).toBe(false);
    expect(canJoinTeam([], 4)).toBe(false);
    expect(TEAMS.map((x) => x.color)).toHaveLength(new Set(TEAMS.map((x) => x.color)).size);
  });

  it('cada equipo tiene su llegada; con dos equipos salen de lados opuestos', () => {
    expect([...teamSpawns([1, 3, 1]).entries()]).toEqual([[1, 0], [3, 2]]);
    expect(new Set(teamSpawns([0, 1, 2, 3]).values()).size).toBe(4);
    expect(teamSpawns([2, 2, 2]).get(2)).toBe(0);
  });

  it('el mensaje de cambio de equipo y el registro con equipo se validan', () => {
    expect(ClientMessageSchema.safeParse({ type: 'team', team: 2 }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'team', team: 7 }).success).toBe(false);
    expect(PlayerRecordSchema.safeParse({ name: 'a', kills: 0, deaths: 0, survivedS: 1, extracted: true, team: 1 }).success).toBe(true);
    expect(PlayerRecordSchema.safeParse({ name: 'a', kills: 0, deaths: 0, survivedS: 1, extracted: true }).success).toBe(true);
  });
});
