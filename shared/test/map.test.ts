import { describe, expect, it } from 'vitest';
import { createRng } from '@shared/rng';
import { generateMap, generateValidMap, validateMap, FLOOR, tileAt, modulesForPlayers } from '@shared/map';
import { TILE } from '@shared/constants';

describe('Generador procedimental de mapas', () => {
  it('el RNG es determinista: misma semilla, misma secuencia', () => {
    const a = createRng(42), b = createRng(42);
    const sa = Array.from({ length: 5 }, a), sb = Array.from({ length: 5 }, b);
    expect(sa).toEqual(sb);
    expect(createRng(43)()).not.toBe(sa[0]);
  });

  it('la misma semilla genera exactamente el mismo mapa', () => {
    const m1 = generateMap(1234), m2 = generateMap(1234);
    expect(m1.tiles).toEqual(m2.tiles);
    expect(m1.portals).toEqual(m2.portals);
    expect(generateMap(1235).tiles).not.toEqual(m1.tiles);
  });

  it('usa 5x5 módulos con 6 jugadores o menos y 7x7 con más', () => {
    expect(modulesForPlayers(6)).toBe(5);
    expect(generateMap(7, 4).width).toBe(5 * 16);
    expect(generateMap(7, 12).width).toBe(7 * 16);
  });

  it('el mapa validado está conectado y es justo (±10 %) para todas las llegadas', () => {
    for (const seed of [1, 99, 2026, 31337]) {
      const map = generateValidMap(seed);
      const v = validateMap(map);
      expect(v.connected).toBe(true);
      expect(v.fairness).toBeLessThanOrEqual(0.1);
    }
  });

  it('llegadas, portales, monolitos y bóveda caen sobre piso', () => {
    const map = generateValidMap(77);
    const pts = [...map.spawns, ...map.portalCandidates, ...map.monoliths, map.vault];
    for (const p of pts) expect(tileAt(map, Math.floor(p.x / TILE), Math.floor(p.y / TILE))).toBe(FLOOR);
  });
});
