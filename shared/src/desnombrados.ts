/**
 * Los Desnombrados (GDD sección 9): enemigos PvE que solo aparecen con los rituales de monolito
 * y en la Bóveda Antigua. La IA es simple y corre en el servidor: buscar el objetivo más cercano,
 * acercarse, preparar el golpe (el aviso que ve el jugador) y golpear un área fija.
 */
import type { GridMap } from './map';
import { moveCircle, hasLineOfSight } from './physics';

export type MonsterKind = 'errante' | 'susurrante' | 'coloso';

export interface MonsterDef {
  name: string;
  hp: number;
  /** Velocidad en px/s. */
  speed: number;
  radius: number;
  /** Distancia a la que empieza a preparar el golpe (px, sin contar el radio del objetivo). */
  reach: number;
  /** Preparación: lo que el jugador ve venir y puede esquivar. */
  windupMs: number;
  recoverMs: number;
  /** Daño a jugadores y radio del área que golpea. */
  dmg: number;
  area: number;
  /** Daño a la integridad del monolito. */
  structureDmg: number;
  /** Distancia a la que persigue jugadores. */
  aggro: number;
}

export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  errante: { name: 'Errante', hp: 70, speed: 150, radius: 18, reach: 70, windupMs: 420, recoverMs: 600, dmg: 12, area: 46, structureDmg: 5, aggro: 320 },
  susurrante: { name: 'Susurrante', hp: 50, speed: 110, radius: 20, reach: 330, windupMs: 900, recoverMs: 1100, dmg: 14, area: 62, structureDmg: 4, aggro: 460 },
  coloso: { name: 'Coloso', hp: 700, speed: 75, radius: 42, reach: 110, windupMs: 1100, recoverMs: 1300, dmg: 38, area: 105, structureDmg: 0, aggro: 600 },
};

/** Tiempo entre el fin de la preparación y el impacto: los espíritus del Susurrante viajan. */
export const STRIKE_DELAY_MS: Record<MonsterKind, number> = { errante: 0, susurrante: 450, coloso: 0 };
/** Distancia del salto del Errante al golpear. */
export const ERRANTE_LUNGE = 90;

export interface Monster {
  id: number;
  kind: MonsterKind;
  x: number; y: number;
  hp: number;
  state: 'move' | 'windup' | 'recover';
  /** Fin del estado actual (ms). */
  until: number;
  /** Punto fijado al empezar a preparar: ahí cae el golpe aunque el objetivo se mueva. */
  aimX: number; aimY: number;
  dirX: number; dirY: number;
  target: string | null;
  slowUntil: number; rootUntil: number;
  /** Punto de origen (el monolito o la Bóveda Antigua) y a qué ritual pertenece (-1: Bóveda Antigua). */
  home: { x: number; y: number };
  owner: number;
}

export interface Target { id: string; x: number; y: number; r: number }
/** Golpe pendiente: área y hora en que se resuelve. */
export interface Strike { monster: Monster; x: number; y: number; r: number; at: number }

export function createMonster(id: number, kind: MonsterKind, x: number, y: number, owner: number, home: { x: number; y: number }): Monster {
  return { id, kind, x, y, hp: MONSTERS[kind].hp, state: 'move', until: 0, aimX: x, aimY: y, dirX: 0, dirY: 1, target: null, slowUntil: 0, rootUntil: 0, home, owner };
}

/** Objetivo: el jugador más cercano dentro de su alcance de caza; si no hay ninguno, la estructura (el monolito). */
export function pickTarget(m: Monster, players: Target[], structure: Target | null): Target | null {
  let best: Target | null = null, bd: number = MONSTERS[m.kind].aggro;
  for (const p of players) {
    const d = Math.hypot(p.x - m.x, p.y - m.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best ?? structure;
}

/** Un paso de la IA. Devuelve el golpe cuando termina de preparar. */
export function stepMonster(map: GridMap, m: Monster, players: Target[], structure: Target | null, now: number, dt: number): Strike | null {
  const def = MONSTERS[m.kind];
  if (m.state === 'windup') {
    if (now < m.until) return null;
    let sx = m.aimX, sy = m.aimY;
    if (m.kind === 'errante') {
      // Salta hacia el punto fijado y golpea al llegar.
      const dx = m.aimX - m.x, dy = m.aimY - m.y, L = Math.hypot(dx, dy) || 1, step = Math.min(L, ERRANTE_LUNGE);
      const p = moveCircle(map, m, (dx / L) * step, (dy / L) * step, def.radius);
      m.x = p.x; m.y = p.y;
      sx = m.x + (dx / L) * 20; sy = m.y + (dy / L) * 20;
    }
    m.state = 'recover'; m.until = now + def.recoverMs;
    return { monster: m, x: sx, y: sy, r: def.area, at: now + STRIKE_DELAY_MS[m.kind] };
  }
  if (m.state === 'recover' && now < m.until) return null;
  m.state = 'move';
  const tg = pickTarget(m, players, structure);
  const goal = tg ?? { id: 'casa', x: m.home.x, y: m.home.y, r: 0 };
  m.target = tg?.id ?? null;
  const dx = goal.x - m.x, dy = goal.y - m.y, d = Math.hypot(dx, dy);
  if (d > 0.5) { m.dirX = dx / d; m.dirY = dy / d; }
  if (tg && d <= def.reach + tg.r && (m.kind !== 'susurrante' || hasLineOfSight(map, m, tg))) {
    m.state = 'windup'; m.until = now + def.windupMs;
    if (m.kind === 'coloso') { const k = Math.min(d, 60); m.aimX = m.x + m.dirX * k; m.aimY = m.y + m.dirY * k; }
    else { m.aimX = tg.x; m.aimY = tg.y; }
    return null;
  }
  if (!tg && d < 40) return null;
  if (now < m.rootUntil) return null;
  const speed = def.speed * (now < m.slowUntil ? 0.6 : 1);
  const p = moveCircle(map, m, m.dirX * speed * dt, m.dirY * speed * dt, def.radius);
  m.x = p.x; m.y = p.y;
  return null;
}

/** Separa a los Desnombrados que se enciman (empuje simple por pares). */
export function separate(map: GridMap, list: Monster[]) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], min = MONSTERS[a.kind].radius + MONSTERS[b.kind].radius;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= min || d === 0) continue;
    const push = (min - d) / 2, nx = dx / d, ny = dy / d;
    const pa = moveCircle(map, a, -nx * push, -ny * push, MONSTERS[a.kind].radius); a.x = pa.x; a.y = pa.y;
    const pb = moveCircle(map, b, nx * push, ny * push, MONSTERS[b.kind].radius); b.x = pb.x; b.y = pb.y;
  }
}
