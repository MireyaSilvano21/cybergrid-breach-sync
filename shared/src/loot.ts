import { MODULE_TILES, TILE } from './constants';
import { createRng } from './rng';
import { FLOOR, tileAt, type GridMap, type Point } from './map';

/** Catálogo de objetos que se pueden encontrar en la Grid (GDD sección 8). */
export type ItemKind = 'reliquia' | 'consumible' | 'moneda';
export interface ItemDef { id: string; name: string; kind: ItemKind; value: number; size: 1 | 2; color: string }

export const ITEMS: Record<string, ItemDef> = {
  idolo: { id: 'idolo', name: 'Ídolo de ceniza', kind: 'reliquia', value: 120, size: 1, color: '#d9a35a' },
  orbe: { id: 'orbe', name: 'Orbe de eco', kind: 'reliquia', value: 180, size: 1, color: '#9c56e8' },
  martillo: { id: 'martillo', name: 'Martillo rúnico', kind: 'reliquia', value: 220, size: 2, color: '#ff8a3c' },
  corona: { id: 'corona', name: 'Corona rota', kind: 'reliquia', value: 300, size: 2, color: '#f2c14e' },
  tonico: { id: 'tonico', name: 'Tónico de Sutura', kind: 'consumible', value: 40, size: 1, color: '#ff6b6b' },
  sal: { id: 'sal', name: 'Sal de Guarda', kind: 'consumible', value: 35, size: 1, color: '#9de1ff' },
  esquirlas: { id: 'esquirlas', name: 'Esquirlas', kind: 'moneda', value: 25, size: 1, color: '#c9b8ff' },
};
export const ITEM_IDS = Object.keys(ITEMS);

/** Tabla de botín de los cofres comunes: [objeto, peso]. */
const COMMON_TABLE: [string, number][] = [
  ['esquirlas', 30], ['tonico', 18], ['sal', 16], ['idolo', 14], ['orbe', 10], ['martillo', 7], ['corona', 5],
];

export const INVENTORY_SLOTS = 10;
export const INTERACT_RANGE = 80;

export const itemValue = (ids: string[]) => ids.reduce((sum, id) => sum + (ITEMS[id]?.value ?? 0), 0);
export const slotsUsed = (ids: string[]) => ids.reduce((sum, id) => sum + (ITEMS[id]?.size ?? 1), 0);

/**
 * Intenta meter objetos en una mochila. Devuelve lo que entró y lo que no cupo,
 * sin modificar los arreglos originales.
 */
export function addToInventory(inventory: string[], incoming: string[], capacity = INVENTORY_SLOTS) {
  const inv = [...inventory];
  const taken: string[] = [];
  const left: string[] = [];
  let used = slotsUsed(inv);
  for (const id of incoming) {
    const size = ITEMS[id]?.size ?? 1;
    if (used + size <= capacity) { inv.push(id); taken.push(id); used += size; } else left.push(id);
  }
  return { inventory: inv, taken, left };
}

export function rollLoot(rng: () => number, count: number): string[] {
  const total = COMMON_TABLE.reduce((s, [, w]) => s + w, 0);
  return Array.from({ length: count }, () => {
    let r = rng() * total;
    for (const [id, w] of COMMON_TABLE) { r -= w; if (r <= 0) return id; }
    return COMMON_TABLE[0][0];
  });
}

export interface ChestSpawn extends Point { id: string; items: string[] }

/** Busca la casilla de piso más cercana a un punto (en espiral) para no dejar cofres dentro de muros. */
function nearestFloor(map: GridMap, p: Point): Point | null {
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (tileAt(map, tx + dx, ty + dy) === FLOOR) return { x: (tx + dx) * TILE + TILE / 2, y: (ty + dy) * TILE + TILE / 2 };
  }
  return null;
}

/**
 * Coloca los cofres de forma determinista a partir de la semilla del mapa:
 * uno junto a cada llegada (igual para todos los equipos) y uno o dos en salas y cámaras.
 */
export function placeChests(map: GridMap): ChestSpawn[] {
  const rng = createRng((map.seed ^ 0x9e3779b9) >>> 0);
  const chests: ChestSpawn[] = [];
  const add = (p: Point, n: number) => {
    const f = nearestFloor(map, p);
    if (!f || chests.some((c) => Math.hypot(c.x - f.x, c.y - f.y) < TILE * 2)) return;
    chests.push({ id: `c${chests.length}`, x: f.x, y: f.y, items: rollLoot(rng, n) });
  };
  for (const sp of map.spawns) add({ x: sp.x + TILE * 2, y: sp.y + TILE * 2 }, 2);
  for (const m of map.layout) {
    if (m.type !== 'sala' && m.type !== 'camara') continue;
    const ox = m.mx * MODULE_TILES * TILE, oy = m.my * MODULE_TILES * TILE;
    const spots = m.type === 'camara' ? 2 : 1;
    for (let i = 0; i < spots; i++) {
      add({ x: ox + (3 + rng() * 10) * TILE, y: oy + (3 + rng() * 10) * TILE }, m.type === 'camara' ? 3 : 2);
    }
  }
  return chests;
}
