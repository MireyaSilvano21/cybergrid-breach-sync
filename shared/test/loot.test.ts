import { describe, expect, it } from 'vitest';
import { addToInventory, placeChests, itemValue, slotsUsed, INVENTORY_SLOTS, ITEMS, CHEST_KINDS } from '@shared/loot';
import { generateValidMap, tileAt, FLOOR } from '@shared/map';
import { TILE } from '@shared/constants';

describe('Cofres y botín', () => {
  it('la misma semilla coloca los mismos cofres con el mismo botín, siempre sobre piso', () => {
    const map = generateValidMap(2026);
    const a = placeChests(map), b = placeChests(map);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(map.spawns.length);
    for (const c of a) {
      expect(tileAt(map, Math.floor(c.x / TILE), Math.floor(c.y / TILE))).toBe(FLOOR);
      for (const id of c.items) expect(ITEMS[id]).toBeDefined();
    }
  });

  it('cada llegada tiene un cofre cercano', () => {
    const map = generateValidMap(77);
    const chests = placeChests(map);
    for (const sp of map.spawns) {
      const d = Math.min(...chests.map((c) => Math.hypot(c.x - sp.x, c.y - sp.y)));
      expect(d).toBeLessThan(TILE * 5);
    }
  });
});

describe('Tipos de cofre', () => {
  it('hay un solo Relicario, cerca de la Bóveda, y los cofres raros traen más botín', () => {
    for (const seed of [3, 2026, 77]) {
      const map = generateValidMap(seed);
      const chests = placeChests(map);
      const reli = chests.filter((c) => c.kind === 'relicario');
      expect(reli).toHaveLength(1);
      expect(Math.hypot(reli[0].x - map.vault.x, reli[0].y - map.vault.y)).toBeLessThan(TILE * 6);
      for (const c of chests) {
        expect(c.items.length).toBeLessThanOrEqual(CHEST_KINDS[c.kind].items);
        if (CHEST_KINDS[c.kind].rare) expect(c.items).toHaveLength(CHEST_KINDS[c.kind].items);
      }
      expect(new Set(chests.map((c) => c.kind)).size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Inventario', () => {
  it('respeta las 10 casillas: las reliquias grandes ocupan 2', () => {
    const full = Array.from({ length: 4 }, () => 'corona'); // 8 casillas
    const r = addToInventory(full, ['martillo', 'idolo', 'orbe']);
    expect(slotsUsed(r.inventory)).toBeLessThanOrEqual(INVENTORY_SLOTS);
    expect(r.taken).toEqual(['martillo']);
    expect(r.left).toEqual(['idolo', 'orbe']);
  });

  it('calcula el valor total del botín', () => {
    expect(itemValue(['corona', 'esquirlas'])).toBe(ITEMS.corona.value + ITEMS.esquirlas.value);
    expect(itemValue([])).toBe(0);
  });
});
