import { describe, expect, it } from 'vitest';
import { moveCircle, hasLineOfSight } from '@shared/physics';
import { FLOOR, WALL, PIT, GATE_E, SEAL_VAULT, DIAG_TL, type GridMap } from '@shared/map';
import { TILE } from '@shared/constants';

/** Mapa de prueba de 7×3 casillas: todo piso salvo la columna del medio, que cambia por prueba. */
function lane(mid: number): GridMap {
  const w = 7, h = 3, tiles = Array(w * h).fill(FLOOR);
  for (let y = 0; y < h; y++) tiles[y * w + 3] = mid;
  return { seed: 1, modules: 1, width: w, height: h, tiles, layout: [], spawns: [], portalCandidates: [], portals: [0, 1], monoliths: [], vault: { x: 0, y: 0 }, chestSpots: [], props: [], sealsOpen: { vault: false, heart: false } };
}
const walkRight = (map: GridMap, steps = 60) => {
  let p = { x: 1.5 * TILE, y: 1.5 * TILE };
  for (let i = 0; i < steps; i++) p = moveCircle(map, p, 8, 0, 18);
  return p;
};
const walkLeft = (map: GridMap, steps = 60) => {
  let p = { x: 5.5 * TILE, y: 1.5 * TILE };
  for (let i = 0; i < steps; i++) p = moveCircle(map, p, -8, 0, 18);
  return p;
};

describe('Física del mapa por plantillas', () => {
  it('el abismo no se cruza pero deja ver al otro lado', () => {
    const m = lane(PIT);
    expect(walkRight(m).x).toBeLessThan(3 * TILE);
    expect(hasLineOfSight(m, { x: 1.5 * TILE, y: 1.5 * TILE }, { x: 5.5 * TILE, y: 1.5 * TILE })).toBe(true);
    expect(hasLineOfSight(lane(WALL), { x: 1.5 * TILE, y: 1.5 * TILE }, { x: 5.5 * TILE, y: 1.5 * TILE })).toBe(false);
  });

  it('la reja de un solo sentido deja pasar hacia la flecha y no de regreso', () => {
    const m = lane(GATE_E);
    expect(walkRight(m).x).toBeGreaterThan(4 * TILE);
    expect(walkLeft(m).x).toBeGreaterThan(4 * TILE);
  });

  it('el sello de bóveda bloquea hasta que se abre con la Llamada', () => {
    const m = lane(SEAL_VAULT);
    expect(walkRight(m).x).toBeLessThan(3 * TILE);
    m.sealsOpen.vault = true;
    expect(walkRight(m).x).toBeGreaterThan(4 * TILE);
  });

  it('el muro en diagonal empuja hacia fuera por su lado inclinado', () => {
    const m = lane(FLOOR);
    m.tiles[1 * 7 + 3] = DIAG_TL; // triángulo sólido arriba a la izquierda de la casilla (3,1)
    // Un círculo dentro del triángulo sale hacia abajo y a la derecha, a través de la diagonal.
    const p = moveCircle(m, { x: 3.2 * TILE, y: 1.2 * TILE }, 0, 0, 18);
    expect(p.x).toBeGreaterThan(3.2 * TILE);
    expect(p.y).toBeGreaterThan(1.2 * TILE);
  });
});
