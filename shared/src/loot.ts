import { createRng } from './rng';
import { type GridMap, type ModuleType, type Point } from './map';

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

/** Tabla de los cofres raros: más reliquias grandes y nada de moneda suelta. */
const RARE_TABLE: [string, number][] = [
  ['tonico', 10], ['sal', 8], ['idolo', 20], ['orbe', 22], ['martillo', 20], ['corona', 20],
];

export function rollLoot(rng: () => number, count: number, table: [string, number][] = COMMON_TABLE): string[] {
  const total = table.reduce((s, [, w]) => s + w, 0);
  return Array.from({ length: count }, () => {
    let r = rng() * total;
    for (const [id, w] of table) { r -= w; if (r <= 0) return id; }
    return table[0][0];
  });
}

/** Cuatro tipos de cofre, de más común a más valioso (GDD sección 8). */
export type ChestKind = 'forja' | 'sarcofago' | 'ornamentado' | 'relicario';
export const CHEST_KINDS: Record<ChestKind, { name: string; items: number; rare: boolean }> = {
  forja: { name: 'Cofre de la Forja', items: 2, rare: false },
  sarcofago: { name: 'Sarcófago Rúnico', items: 2, rare: false },
  ornamentado: { name: 'Arcón Ornamentado', items: 3, rare: true },
  relicario: { name: 'Relicario Antiguo', items: 4, rare: true },
};

export interface ChestSpawn extends Point { id: string; kind: ChestKind; items: string[] }

/** Tipo de cofre según la función de la sala donde está (Propuesta de mapa, sección 3.5). */
const KIND_BY_ROLE: Partial<Record<ModuleType, ChestKind>> = {
  llegada: 'forja', galeria: 'forja', cruce: 'forja', portal: 'forja', pasaje: 'forja',
  osario: 'sarcofago', santuario: 'ornamentado', boveda: 'ornamentado', corazon: 'relicario',
};

/**
 * Coloca los cofres en los puntos que marcan las plantillas de sala. El tipo sale de la
 * función de la sala (osario → sarcófago, bóveda → arcón…) y el botín, de la semilla.
 * Los cofres menores de los nichos traen un solo objeto común.
 */
export function placeChests(map: GridMap): ChestSpawn[] {
  const rng = createRng((map.seed ^ 0x9e3779b9) >>> 0);
  return map.chestSpots.map((spot, i) => {
    const kind: ChestKind = spot.relic ? 'relicario' : spot.small ? 'forja' : KIND_BY_ROLE[spot.role] ?? 'forja';
    const k = CHEST_KINDS[kind];
    const count = spot.small ? 1 : k.items;
    return { id: `c${i}`, kind, x: spot.x, y: spot.y, items: rollLoot(rng, count, k.rare ? RARE_TABLE : COMMON_TABLE) };
  });
}
