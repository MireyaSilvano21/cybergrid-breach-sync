import { describe, expect, it } from 'vitest';
import { createRng } from '@shared/rng';
import { generateMap, generateValidMap, validateMap, FLOOR, tileAt, modulesForPlayers, GATE_N, GATE_E, GATE_S, GATE_W, DIAG_TL, DIAG_TR, DIAG_BL, DIAG_BR } from '@shared/map';
import { ROOM_TEMPLATES } from '@shared/templates';
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

  it('llegadas, portales y el Relicario caen sobre piso; hay 4 de cada uno por cuarto', () => {
    const map = generateValidMap(77);
    expect(map.spawns).toHaveLength(4);
    expect(map.portalCandidates).toHaveLength(4);
    expect(map.monoliths).toHaveLength(4);
    for (const p of [...map.spawns, ...map.portalCandidates, map.vault]) expect(tileAt(map, Math.floor(p.x / TILE), Math.floor(p.y / TILE))).toBe(FLOOR);
  });

  it('simetría girada: el mapa es igual a sí mismo girado 90° (justo para los 4 equipos)', () => {
    const map = generateValidMap(2026, 4), W = map.width;
    const ARROW: Record<number, number> = { [GATE_N]: GATE_E, [GATE_E]: GATE_S, [GATE_S]: GATE_W, [GATE_W]: GATE_N, [DIAG_TL]: DIAG_TR, [DIAG_TR]: DIAG_BR, [DIAG_BR]: DIAG_BL, [DIAG_BL]: DIAG_TL };
    let diff = 0;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const t = map.tiles[y * W + x], r = map.tiles[x * W + (W - 1 - y)];
      if ((ARROW[t] ?? t) !== r) diff++;
    }
    expect(diff).toBe(0);
  });

  it('cada partida cambia la estructura: funciones de los módulos distintas entre semillas', () => {
    const sig = (s: number) => generateMap(s, 4).layout.map((m) => m.type).join();
    const set = new Set([1, 2, 3, 4, 5, 6].map(sig));
    expect(set.size).toBeGreaterThanOrEqual(4);
  });
});

describe('Plantillas de sala', () => {
  it('las 28 plantillas son de 16×16 y desde cada puerta se llega a todo el piso', () => {
    expect(ROOM_TEMPLATES.length).toBeGreaterThanOrEqual(28);
    const walk = '.=SPCcGRb<>^v';
    for (const t of ROOM_TEMPLATES) {
      expect(t.rows).toHaveLength(16);
      for (const r of t.rows) expect(r).toHaveLength(16);
      const at = (x: number, y: number) => (x < 0 || y < 0 || x > 15 || y > 15 ? ' ' : t.rows[y][x]);
      const doors: [number, number][] = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (at(x, y) === '=') doors.push([x, y]);
      const seen = new Set([doors[0].join()]), q = [doors[0]];
      while (q.length) {
        const [x, y] = q.shift()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = x + dx, b = y + dy;
          if (walk.includes(at(a, b)) && !seen.has(`${a},${b}`)) { seen.add(`${a},${b}`); q.push([a, b]); }
        }
      }
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (walk.includes(at(x, y))) expect(seen.has(`${x},${y}`), `${t.name} (${x},${y})`).toBe(true);
    }
  });
});
