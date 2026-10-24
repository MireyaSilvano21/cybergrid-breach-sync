import { describe, expect, it } from 'vitest';
import { ClientMessageSchema, CredentialsSchema, SeedPayloadSchema } from '@shared/schemas';

const match = (i: number) => ({ id: `m${i}`, endedAt: 1, durationS: 600, players: [{ name: 'a', kills: 1, deaths: 0, survivedS: 600, extracted: true }] });

describe('Esquemas Zod de payload', () => {
  it('acepta un input válido y rechaza valores fuera de rango', () => {
    const ok = { type: 'input', seq: 1, mx: 1, my: 0, ax: 0, ay: 1, attack: false, interact: false };
    expect(ClientMessageSchema.safeParse(ok).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...ok, mx: 5 }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'teleport', x: 0 }).success).toBe(false);
  });

  it('el seed solo acepta entre 100 y 1000 partidas', () => {
    expect(SeedPayloadSchema.safeParse({ matches: Array.from({ length: 100 }, (_, i) => match(i)) }).success).toBe(true);
    expect(SeedPayloadSchema.safeParse({ matches: Array.from({ length: 99 }, (_, i) => match(i)) }).success).toBe(false);
    expect(SeedPayloadSchema.safeParse({ generate: { count: 1001 } }).success).toBe(false);
  });

  it('valida credenciales', () => {
    expect(CredentialsSchema.safeParse({ username: 'usiel', password: 'secreta1' }).success).toBe(true);
    expect(CredentialsSchema.safeParse({ username: 'u', password: '123' }).success).toBe(false);
  });
});
