import { describe, expect, it } from 'vitest';
import { generateValidMap } from '@shared/map';
import { PLAYER, TICK_MS } from '@shared/constants';
import { createMoveQueue, enqueueMove, consumeMoves, replayMoves, pendingAfterAck, stepMove, MAX_CREDIT_S, type MoveCmd } from '@shared/prediction';

const map = generateValidMap(2026);
const start = map.spawns[0];
const TICK = TICK_MS / 1000;

/** Simula al servidor: recibe comandos con retraso y variación, y avanza por ticks. */
function serverRun(cmds: MoveCmd[], arrivals: number[], ticks: number) {
  const q = createMoveQueue();
  let pos = { ...start }, i = 0;
  const acks: { tick: number; ack: number; ackRem: number; x: number; y: number }[] = [];
  for (let k = 1; k <= ticks; k++) {
    while (i < cmds.length && arrivals[i] <= k * TICK) enqueueMove(q, { ...cmds[i++] });
    pos = consumeMoves(map, pos, q, TICK);
    acks.push({ tick: k, ack: q.ack, ackRem: q.ackRem, x: pos.x, y: pos.y });
  }
  return acks;
}

describe('Movimiento por comandos y reconciliación', () => {
  const cmds: MoveCmd[] = Array.from({ length: 60 }, (_, i) => ({ seq: i + 1, mx: i < 30 ? 1 : 0, my: i < 30 ? 0 : 1, dt: 1 / 60 }));
  // Llegadas con 60–140 ms de retraso variable (en orden, como en TCP).
  let last = 0;
  const arrivals = cmds.map((_, i) => (last = Math.max(last, i / 60 + 0.06 + ((i * 37) % 9) / 100)));

  it('al final, la posición del servidor es la misma que predijo el cliente', () => {
    const client = replayMoves(map, start, cmds);
    const acks = serverRun(cmds, arrivals, 90);
    const end = acks[acks.length - 1];
    expect(end.ack).toBe(60);
    expect(Math.hypot(end.x - client.x, end.y - client.y)).toBeLessThan(0.01);
  });

  it('en cada instantánea, reaplicar lo pendiente reproduce exactamente la predicción', () => {
    const acks = serverRun(cmds, arrivals, 90);
    const client = replayMoves(map, start, cmds);
    for (const a of acks) {
      const p = replayMoves(map, { x: a.x, y: a.y }, pendingAfterAck(cmds, a.ack, a.ackRem));
      expect(Math.hypot(p.x - client.x, p.y - client.y)).toBeLessThan(0.5);
    }
  });

  it('no se puede ir más rápido que el tiempo real aunque se manden duraciones falsas', () => {
    const q = createMoveQueue();
    for (let i = 1; i <= 40; i++) enqueueMove(q, { seq: i, mx: 1, my: 0, dt: 0.25 });
    let pos = { ...start }, moved = 0;
    for (let k = 0; k < 30; k++) { const p = consumeMoves(map, pos, q, TICK); moved += Math.hypot(p.x - pos.x, p.y - pos.y); pos = p; }
    expect(moved).toBeLessThanOrEqual(PLAYER.speed * (30 * TICK + MAX_CREDIT_S) + 1);
  });

  it('quedarse quieto se confirma al momento y no frena lo que viene después', () => {
    const q = createMoveQueue();
    enqueueMove(q, { seq: 1, mx: 0, my: 0, dt: 0.05 });
    expect(q.ack).toBe(1);
    expect(q.queue).toHaveLength(0);
    const p = stepMove(map, start, 0, 0, 1);
    expect(p).toEqual({ x: start.x, y: start.y });
  });
});
