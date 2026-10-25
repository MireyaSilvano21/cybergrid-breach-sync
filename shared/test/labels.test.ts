import { describe, expect, it } from 'vitest';
import { stackLabels } from '@shared/labels';

const box = (id: string, x: number, y: number, w = 60, h = 23) => ({ id, x, y, w, h });

describe('Nombres sin encimarse', () => {
  it('si están lejos, nadie se mueve', () => {
    const r = stackLabels([box('a', 0, 0), box('b', 300, 0)]);
    expect(r.get('a')).toBe(0);
    expect(r.get('b')).toBe(0);
  });

  it('la etiqueta de quien está más adelante se queda y la de atrás sube justo encima', () => {
    const r = stackLabels([box('atras', 10, -5), box('frente', 0, 0)], 2);
    expect(r.get('frente')).toBe(0);
    expect(-5 + r.get('atras')! + 23).toBeLessThanOrEqual(-2);
  });

  it('tres jugadores juntos quedan en tres renglones sin tocarse', () => {
    const boxes = [box('a', 0, 0), box('b', 5, -2), box('c', -5, -4)];
    const r = stackLabels(boxes, 2);
    const tops = boxes.map((b) => b.y + r.get(b.id)!).sort((p, q) => p - q);
    expect(tops[1] - tops[0]).toBeGreaterThanOrEqual(25);
    expect(tops[2] - tops[1]).toBeGreaterThanOrEqual(25);
  });

  it('no suben más del límite aunque haya muchos juntos', () => {
    const boxes = Array.from({ length: 12 }, (_, i) => box(`p${i}`, 0, 0));
    const r = stackLabels(boxes, 2, 80);
    for (const v of r.values()) expect(v).toBeGreaterThanOrEqual(-80);
  });

  it('el acomodo no depende del orden en que llegan', () => {
    const a = [box('x', 0, 0), box('y', 4, 0), box('z', 8, -1)];
    const r1 = stackLabels(a), r2 = stackLabels([...a].reverse());
    for (const b of a) expect(r1.get(b.id)).toBe(r2.get(b.id));
  });
});
