import { z } from 'zod';

/** Credenciales de acceso. */
export const CredentialsSchema = z.object({
  username: z.string().trim().min(3, 'El usuario debe tener al menos 3 caracteres').max(20).regex(/^[a-zA-Z0-9_]+$/, 'Solo letras, números y guion bajo'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres').max(72),
});

export const CreateRoomSchema = z.object({
  name: z.string().trim().min(3).max(24),
  password: z.string().max(32).optional(),
});

/** Mensajes del cliente al servidor por WebSocket. */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), t: z.number() }),
  z.object({ type: z.literal('join'), roomId: z.string().min(1).max(40), password: z.string().max(32).optional() }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('ready'), ready: z.boolean() }),
  z.object({
    type: z.literal('input'),
    seq: z.number().int().nonnegative(),
    mx: z.number().min(-1).max(1),
    my: z.number().min(-1).max(1),
    ax: z.number().min(-1).max(1),
    ay: z.number().min(-1).max(1),
    attack: z.boolean(),
    interact: z.boolean(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type InputMessage = Extract<ClientMessage, { type: 'input' }>;

/** Registro de un jugador dentro de una partida terminada (telemetría). */
export const PlayerRecordSchema = z.object({
  name: z.string().min(1).max(20),
  kills: z.number().int().min(0).max(500),
  deaths: z.number().int().min(0).max(500),
  survivedS: z.number().min(0).max(3600),
  extracted: z.boolean(),
});

export const MatchRecordSchema = z.object({
  id: z.string().min(1).max(64),
  endedAt: z.number().int().nonnegative(),
  durationS: z.number().min(0).max(3600),
  players: z.array(PlayerRecordSchema).min(1).max(12),
});
export type MatchRecord = z.infer<typeof MatchRecordSchema>;

/**
 * Payload de POST /api/test/seed: partidas explícitas (100–1000) o una orden de generarlas.
 */
export const SeedPayloadSchema = z.union([
  z.object({ matches: z.array(MatchRecordSchema).min(100).max(1000), reset: z.boolean().optional() }),
  z.object({ generate: z.object({ count: z.number().int().min(100).max(1000), seed: z.number().int().optional() }), reset: z.boolean().optional() }),
]);
export type SeedPayload = z.infer<typeof SeedPayloadSchema>;
