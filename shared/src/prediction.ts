import { PLAYER, TICK_MS } from './constants';
import { moveCircle } from './physics';
import type { GridMap } from './map';
import type { Vec2 } from './interpolation';

/**
 * Movimiento por comandos (modelo de Gabriel Gambetta / Valve):
 * el cliente manda cada tramo de movimiento con su duración y su número de secuencia;
 * el servidor los aplica en orden con la misma física y avisa hasta cuál llegó (ack).
 * El cliente parte de esa posición confirmada y vuelve a aplicar los comandos que el
 * servidor aún no procesa. Si nadie hizo trampa ni hubo choque distinto, el resultado
 * es idéntico a lo que ya se veía y no hay corrección: adiós a los tirones.
 */
export interface MoveCmd { seq: number; mx: number; my: number; dt: number }

/** Un paso de movimiento: normaliza la dirección y aplica la colisión con muros. */
export function stepMove(map: GridMap, pos: Vec2, mx: number, my: number, dt: number): Vec2 {
  const l = Math.hypot(mx, my);
  if (l > 1) { mx /= l; my /= l; }
  if (dt <= 0 || (mx === 0 && my === 0)) return { x: pos.x, y: pos.y };
  return moveCircle(map, pos, mx * PLAYER.speed * dt, my * PLAYER.speed * dt, PLAYER.radius);
}

/** Aplica en orden los comandos pendientes (lo que hace el cliente al reconciliar). */
export function replayMoves(map: GridMap, pos: Vec2, cmds: MoveCmd[]): Vec2 {
  let p = { x: pos.x, y: pos.y };
  for (const c of cmds) p = stepMove(map, p, c.mx, c.my, c.dt);
  return p;
}

/** Estado de movimiento de un jugador en el servidor. */
export interface MoveQueue { queue: MoveCmd[]; credit: number; ack: number; ackRem: number }
export const createMoveQueue = (): MoveQueue => ({ queue: [], credit: 0, ack: 0, ackRem: 0 });

/** Tiempo máximo de movimiento que se puede "deber" (ráfaga tras un corte de red). */
export const MAX_CREDIT_S = 0.3;
/** Cola máxima: lo que exceda se descarta y el cliente se corrige. */
export const MAX_QUEUE_S = 0.5;
/** Nivel de cola que el servidor intenta mantener para absorber la variación de la red. */
export const TARGET_QUEUE_S = 0.05;

export const queuedTime = (q: MoveQueue) => q.queue.reduce((s, c) => s + c.dt, 0);

export function enqueueMove(q: MoveQueue, cmd: MoveCmd) {
  if (cmd.mx === 0 && cmd.my === 0) {
    // Estar quieto no ocupa turno: se confirma al momento si no hay nada antes.
    if (q.queue.length === 0) { q.ack = cmd.seq; q.ackRem = 0; return; }
  }
  q.queue.push({ ...cmd });
  // Cola demasiado larga (cliente acelerado o red muy mala): se tira lo más viejo.
  while (queuedTime(q) > MAX_QUEUE_S && q.queue.length > 1) { const d = q.queue.shift()!; q.ack = d.seq; q.ackRem = 0; }
}

/**
 * Avanza un tick. Consume la cola a ritmo real, un poco más rápido si se acumuló y más
 * lento si casi se vacía (así los demás ven un movimiento parejo). El crédito impide
 * moverse más rápido que el tiempo real aunque el cliente mande duraciones falsas.
 */
export function consumeMoves(map: GridMap, pos: Vec2, q: MoveQueue, tickS = TICK_MS / 1000): Vec2 {
  q.credit = Math.min(MAX_CREDIT_S, q.credit + tickS);
  const queued = queuedTime(q);
  const rate = Math.max(0.5, Math.min(2, 1 + (queued - TARGET_QUEUE_S) / 0.1));
  let budget = Math.min(q.credit, tickS * rate);
  let p = { x: pos.x, y: pos.y };
  while (q.queue.length && budget > 1e-6) {
    const c = q.queue[0];
    const use = Math.min(c.dt, budget);
    p = stepMove(map, p, c.mx, c.my, use);
    c.dt -= use; budget -= use; q.credit -= use;
    // Si quedó a medias, el ack apunta a este comando con lo que le falta por aplicar.
    if (c.dt <= 1e-6) { q.queue.shift(); q.ack = c.seq; q.ackRem = 0; } else { q.ack = c.seq; q.ackRem = c.dt; }
  }
  // Comandos de "quieto" que quedaron al frente se confirman sin gastar tiempo.
  while (q.queue.length && q.queue[0].mx === 0 && q.queue[0].my === 0) { const c = q.queue.shift()!; q.ack = c.seq; q.ackRem = 0; }
  return p;
}

/**
 * Lo que el cliente todavía debe reaplicar tras un ack: los comandos posteriores y,
 * si el último quedó a medias, solo la parte que falta.
 */
export function pendingAfterAck(cmds: MoveCmd[], ack: number, ackRem: number): MoveCmd[] {
  const out: MoveCmd[] = [];
  for (const c of cmds) {
    if (c.seq > ack) out.push(c);
    else if (c.seq === ack && ackRem > 0) out.push({ ...c, dt: ackRem });
  }
  return out;
}
