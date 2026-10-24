import { describe, expect, it } from 'vitest';
import { interpolatePosition, sampleBuffer } from '@shared/interpolation';

describe('Interpolación de posiciones de jugadores', () => {
  it('a la mitad del intervalo devuelve el punto medio', () => {
    const p = interpolatePosition({ x: 0, y: 0, t: 0 }, { x: 100, y: 50, t: 100 }, 50);
    expect(p).toEqual({ x: 50, y: 25 });
  });

  it('no extrapola fuera del intervalo', () => {
    const from = { x: 0, y: 0, t: 0 }, to = { x: 100, y: 0, t: 100 };
    expect(interpolatePosition(from, to, 250).x).toBe(100);
    expect(interpolatePosition(from, to, -50).x).toBe(0);
  });

  it('elige el par de instantáneas correcto dentro del búfer', () => {
    const buf = [{ x: 0, y: 0, t: 0 }, { x: 10, y: 0, t: 50 }, { x: 30, y: 0, t: 100 }];
    expect(sampleBuffer(buf, 75)).toEqual({ x: 20, y: 0 });
    expect(sampleBuffer([], 10)).toBeNull();
  });
});
