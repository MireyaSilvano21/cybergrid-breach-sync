import { describe, expect, it } from 'vitest';
import { visibleWorld, VIEW_W, VIEW_H } from '@shared/view';

const screens: Record<string, [number, number]> = {
  'PC 1920×966': [1920, 966],
  'PC ultra ancho 2560×1080': [2560, 1080],
  'Laptop 1366×768': [1366, 768],
  'Celular horizontal 800×360': [800, 360],
  'Celular vertical 412×915': [412, 915],
};

describe('Cámara justa entre dispositivos', () => {
  it('ninguna pantalla ve más mundo que el límite común', () => {
    for (const [w, h] of Object.values(screens)) {
      const v = visibleWorld(w, h);
      expect(v.w).toBeLessThanOrEqual(VIEW_W + 1e-6);
      expect(v.h).toBeLessThanOrEqual(VIEW_H + 1e-6);
    }
  });

  it('PC y celular en horizontal ven casi la misma área (±15 %)', () => {
    const pc = visibleWorld(...screens['PC 1920×966']);
    const phone = visibleWorld(...screens['Celular horizontal 800×360']);
    const ratio = (pc.w * pc.h) / (phone.w * phone.h);
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });
});
