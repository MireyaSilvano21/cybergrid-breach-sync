import { describe, expect, it } from 'vitest';
import { clampRewind, positionAt, pushHistory, MAX_REWIND_MS, type TimedPoint } from '@shared/lagcomp';
import { adaptiveDelay, createJitter, updateJitter } from '@shared/interpolation';

describe('Compensación de lag', () => {
  it('reconstruye la posición pasada interpolando el historial', () => {
    const h: TimedPoint[] = [];
    pushHistory(h, { t: 1000, x: 0, y: 0 });
    pushHistory(h, { t: 1100, x: 100, y: 0 });
    expect(positionAt(h, 1050)).toEqual({ x: 50, y: 0 });
    expect(positionAt(h, 900)).toEqual({ x: 0, y: 0 });
    expect(positionAt(h, 2000)).toEqual({ x: 100, y: 0 });
  });

  it('descarta muestras de más de un segundo', () => {
    const h: TimedPoint[] = [];
    for (let t = 0; t <= 3000; t += 100) pushHistory(h, { t, x: t, y: 0 });
    expect(h[0].t).toBeGreaterThanOrEqual(2000);
  });

  it('limita el retroceso: nunca al futuro ni más de 250 ms atrás', () => {
    expect(clampRewind(5000, 4900)).toBe(4900);
    expect(clampRewind(5000, 1000)).toBe(5000 - MAX_REWIND_MS);
    expect(clampRewind(5000, 9999)).toBe(5000);
    expect(clampRewind(5000, undefined)).toBe(5000);
  });
});

describe('Búfer de suavizado adaptable', () => {
  it('con paquetes puntuales usa el mínimo de dos ticks', () => {
    let s = createJitter();
    for (let i = 0; i < 50; i++) s = updateJitter(s, i * 33, 33);
    expect(adaptiveDelay(s.jitter, 33)).toBeCloseTo(66, 0);
  });

  it('con una red irregular aumenta el retraso, sin pasar de 250 ms', () => {
    let s = createJitter();
    let t = 0;
    for (let i = 0; i < 80; i++) { t += i % 2 ? 10 : 90; s = updateJitter(s, t, 33); }
    const d = adaptiveDelay(s.jitter, 33);
    expect(d).toBeGreaterThan(120);
    expect(adaptiveDelay(1000, 33)).toBe(250);
  });
});
