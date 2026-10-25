/**
 * Íconos de los objetos de la mochila, dibujados una vez con el mismo estilo de tinta del juego
 * y guardados como imagen (data URL) para usarlos en la interfaz.
 */
import { ITEMS } from '@shared/index';

const INK = '#1d0c16';
const cache = new Map<string, string>();

type G = CanvasRenderingContext2D;
function shape(g: G, fill: string, draw: () => void, lw = 3) { g.beginPath(); draw(); g.fillStyle = fill; g.fill(); g.strokeStyle = INK; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); }

const DRAW: Record<string, (g: G) => void> = {
  idolo: (g) => {
    shape(g, '#b98a4a', () => { g.moveTo(22, 54); g.lineTo(42, 54); g.lineTo(39, 34); g.lineTo(25, 34); g.closePath(); });
    shape(g, '#d9a35a', () => g.ellipse(32, 26, 11, 13, 0, 0, 6.283));
    g.fillStyle = INK; g.fillRect(26, 23, 4, 3); g.fillRect(34, 23, 4, 3); g.fillRect(29, 31, 6, 2);
    shape(g, '#e8c27a', () => { g.moveTo(20, 15); g.lineTo(44, 15); g.lineTo(40, 9); g.lineTo(24, 9); g.closePath(); }, 2.5);
  },
  orbe: (g) => {
    shape(g, '#6b5a3a', () => { g.moveTo(20, 54); g.lineTo(44, 54); g.lineTo(38, 46); g.lineTo(26, 46); g.closePath(); });
    shape(g, '#9c56e8', () => g.arc(32, 30, 16, 0, 6.283));
    g.strokeStyle = '#e2c8ff'; g.lineWidth = 2.5; g.beginPath(); g.arc(32, 30, 9, 0.4, 4); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(26, 23, 4, 3, -0.6, 0, 6.283); g.fill();
  },
  martillo: (g) => {
    shape(g, '#5a3a26', () => { g.moveTo(30, 58); g.lineTo(35, 58); g.lineTo(35, 24); g.lineTo(30, 24); g.closePath(); });
    shape(g, '#8a7a88', () => { g.moveTo(14, 12); g.lineTo(50, 12); g.lineTo(52, 26); g.lineTo(12, 26); g.closePath(); });
    g.strokeStyle = '#ff8a3c'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(24, 16); g.lineTo(28, 22); g.lineTo(32, 16); g.lineTo(36, 22); g.lineTo(40, 16); g.stroke();
  },
  corona: (g) => {
    shape(g, '#f2c14e', () => { g.moveTo(12, 46); g.lineTo(52, 46); g.lineTo(54, 20); g.lineTo(44, 32); g.lineTo(38, 14); g.lineTo(32, 30); g.lineTo(26, 16); g.lineTo(20, 32); g.lineTo(10, 22); g.closePath(); });
    g.strokeStyle = INK; g.lineWidth = 2.5; g.beginPath(); g.moveTo(38, 46); g.lineTo(34, 38); g.lineTo(37, 32); g.stroke();
    for (const [x, c] of [[20, '#ff5a64'], [32, '#5ac8ff'], [44, '#8cff9e']] as const) { g.fillStyle = c; g.beginPath(); g.arc(x, 40, 3, 0, 6.283); g.fill(); g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke(); }
  },
  tonico: (g) => {
    shape(g, '#a8a4b4', () => { g.moveTo(27, 8); g.lineTo(37, 8); g.lineTo(37, 18); g.lineTo(27, 18); g.closePath(); });
    shape(g, '#8a5634', () => { g.moveTo(26, 6); g.lineTo(38, 6); g.lineTo(38, 11); g.lineTo(26, 11); g.closePath(); }, 2);
    shape(g, '#dfe6ee', () => { g.moveTo(27, 18); g.lineTo(37, 18); g.quadraticCurveTo(52, 30, 46, 50); g.quadraticCurveTo(32, 58, 18, 50); g.quadraticCurveTo(12, 30, 27, 18); });
    g.fillStyle = '#ff6b6b'; g.beginPath(); g.moveTo(17, 38); g.quadraticCurveTo(32, 34, 47, 38); g.quadraticCurveTo(46, 52, 32, 54); g.quadraticCurveTo(18, 52, 17, 38); g.fill();
    g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(22, 26, 3, 9);
  },
  sal: (g) => {
    shape(g, '#d8c8a0', () => { g.moveTo(16, 24); g.quadraticCurveTo(10, 52, 32, 56); g.quadraticCurveTo(54, 52, 48, 24); g.closePath(); });
    shape(g, '#c0ae84', () => { g.moveTo(18, 24); g.lineTo(46, 24); g.lineTo(40, 14); g.lineTo(24, 14); g.closePath(); }, 2.5);
    g.strokeStyle = '#3a6a8a'; g.lineWidth = 3; g.beginPath(); g.moveTo(17, 26); g.lineTo(47, 26); g.stroke();
    g.fillStyle = '#9de1ff'; for (const [x, y] of [[26, 40], [34, 44], [38, 36], [30, 34]]) { g.beginPath(); g.arc(x, y, 2.4, 0, 6.283); g.fill(); }
  },
  esquirlas: (g) => {
    for (const [x, y, h, c] of [[22, 52, 26, '#c9b8ff'], [34, 54, 34, '#a890f0'], [44, 52, 22, '#d8ccff']] as const) {
      shape(g, c, () => { g.moveTo(x - 6, y); g.lineTo(x, y - h); g.lineTo(x + 6, y); g.closePath(); }, 2.5);
    }
  },
};

/** Ícono del objeto (64 × 64) como data URL. */
export function itemIcon(id: string): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  (DRAW[id] ?? ((gg: G) => shape(gg, ITEMS[id]?.color ?? '#888', () => gg.arc(32, 32, 16, 0, 6.283))))(g);
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}
