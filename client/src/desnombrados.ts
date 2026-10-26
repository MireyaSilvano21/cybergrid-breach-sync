/**
 * Pintor de los Desnombrados: estilo de pincel (contorno negro de grosor irregular, textura de
 * pincel seco y jirones), proporciones de muñeco y un solo color de magia por criatura.
 * Todo se dibuja con Canvas 2D; las texturas se precalculan una vez como patrones.
 */
type G = CanvasRenderingContext2D;
/** Punto de un contorno; el tercer valor (1) lo vuelve una esquina en punta. */
type P = [number, number, number?];

/** Quita en el mismo arreglo lo que ya no sirve (sin crear uno nuevo en cada cuadro). */
function compact<T>(arr: T[], keep: (x: T) => boolean) { let j = 0; for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[j++] = arr[i]; arr.length = j; }

export const INK = '#0d080b';
/** Escala de cada criatura respecto al arte original (que mide unos 250 px). */
export const MONSTER_SCALE = { errante: 0.42, susurrante: 0.42, coloso: 0.6 } as const;

function rng(seed: number) {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

function path(g: G, p: P[]) {
  const n = p.length, a0 = p[n - 1], b0 = p[0];
  g.moveTo((a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2);
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (a[2]) { g.lineTo(a[0], a[1]); g.lineTo(mx, my); } else g.quadraticCurveTo(a[0], a[1], mx, my);
  }
  g.closePath();
}

/** Tiembla un poco el contorno (siempre igual para la misma semilla): parece trazado a mano. */
function rough(p: P[], seed: number, amp: number): P[] {
  const r = rng(seed), o: P[] = [], n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    o.push(a);
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    if (L < 16) continue;
    const nx = -dy / L, ny = dx / L;
    for (const u of [0.34, 0.67]) { const m = (r() * 2 - 1) * amp; o.push([a[0] + dx * u + nx * m, a[1] + dy * u + ny * m]); }
  }
  return o;
}

/** Mancha de color con contorno de pincel: un trazo grueso y otro desplazado más fino. */
function ink(g: G, fill: string, p: P[], seed: number, lw = 6) {
  const q = rough(p, seed, 1.5);
  g.beginPath(); path(g, q); g.fillStyle = fill; g.fill();
  g.strokeStyle = INK; g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = lw; g.stroke();
  g.save(); g.translate(1.3, 1.1); g.beginPath(); path(g, q); g.lineWidth = lw * 0.5; g.stroke(); g.restore();
}
function clip(g: G, p: P[], fn: () => void) { g.save(); g.beginPath(); path(g, p); g.clip(); fn(); g.restore(); }
function line(g: G, p: number[][], c: string, w: number) {
  g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); g.stroke();
}

const glowCache = new Map<string, HTMLCanvasElement>();
/** Brillo de magia: un degradado precalculado por color, estirado al tamaño pedido. */
export function glow(g: G, x: number, y: number, r: number, rgb: string, a: number) {
  if (a <= 0 || r <= 0) return;
  let c = glowCache.get(rgb);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 64;
    const x2 = c.getContext('2d')!, gr = x2.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(1, `rgba(${rgb},0)`); x2.fillStyle = gr; x2.fillRect(0, 0, 64, 64);
    glowCache.set(rgb, c);
  }
  const prev = g.globalAlpha; g.globalAlpha = prev * Math.min(1, a); g.drawImage(c, x - r, y - r, r * 2, r * 2); g.globalAlpha = prev;
}

const grainCache = new Map<string, CanvasPattern>();
/** Textura de pincel seco: rayones cortos precalculados en un patrón que se repite. */
function grain(g: G, x0: number, y0: number, x1: number, y1: number, seed: number, n: number, c: string, w: number) {
  const key = `${c}|${w}|${n > 50 ? 'h' : 'l'}|${seed % 3}`;
  let pat = grainCache.get(key);
  if (!pat) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 96;
    const x2 = cv.getContext('2d')!, r = rng(seed % 3 + 7), count = n > 50 ? 70 : 26;
    x2.strokeStyle = c; x2.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x = r() * 96, y = r() * 96, l = 2 + r() * 10, a = -0.7 + r() * 0.5;
      x2.lineWidth = w * (0.4 + r());
      x2.beginPath(); x2.moveTo(x, y); x2.quadraticCurveTo(x + l * 0.5, y + l * 0.5 * Math.sin(a) - 1.5, x + l * Math.cos(a), y + l * Math.sin(a)); x2.stroke();
    }
    pat = g.createPattern(cv, 'repeat')!;
    grainCache.set(key, pat);
  }
  g.fillStyle = pat; g.fillRect(x0, y0, x1 - x0, y1 - y0);
}

function shreds(x1: number, x2: number, y: number, n: number, d: number, t: number, seed: number, sway = 0): P[] {
  const r = rng(seed), o: P[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, x = x1 + (x2 - x1) * u, w = Math.sin(t * 3 + i * 1.3) * sway;
    if (i % 2 === 0) o.push([x + w, y + d * (0.3 + 0.7 * r()), 1]); else o.push([x + w * 0.4, y - 2 - r() * 7, 1]);
  }
  return o;
}
function strands(g: G, x1: number, x2: number, y: number, n: number, len: number, t: number, seed: number) {
  const r = rng(seed);
  g.strokeStyle = INK;
  for (let i = 0; i < n; i++) {
    const x = x1 + r() * (x2 - x1), l = len * (0.4 + r() * 0.6), s = Math.sin(t * 2.6 + i) * 4;
    g.lineWidth = 1.5 + r() * 1.5; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s * 0.5, y + l * 0.6, x + s, y + l); g.stroke();
  }
}
/** Mano negra de dedos largos y delgados (tres falanges que se doblan). */
function hand(g: G, x: number, y: number, a: number, curl: number, s = 1) {
  g.save(); g.translate(x, y); g.rotate(a); g.scale(s, s);
  g.fillStyle = INK; g.beginPath(); g.ellipse(0, 0, 9, 7, 0, 0, 7); g.fill();
  g.strokeStyle = INK; g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    let px = (i - 2) * 3.6, py = 4, dir = Math.PI / 2 + (i - 2) * 0.34;
    for (const [L, w] of [[11, 4.4], [10, 3.1], [10, 1.6]]) {
      const nx = px + Math.cos(dir) * L, ny = py + Math.sin(dir) * L;
      g.lineWidth = w; g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      px = nx; py = ny; dir += (i < 2 ? -1 : 1) * curl * 0.4 + (i - 2) * 0.07;
    }
  }
  g.restore();
}
function rivet(g: G, x: number, y: number) { g.fillStyle = '#a8823f'; g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 1.8; g.stroke(); }
export function shadow(g: G, x: number, y: number, rx: number) { g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.ellipse(x, y, rx, rx * 0.26, 0, 0, 7); g.fill(); }

// ------------------------------------------------------------------------------------- Errante

export interface ErrantePose { sx: number; sy: number; lean: number; aL: number; aR: number; gl: number }

function armE(g: G, sx: number, sy: number, a: number, side: number, curl: number, seed: number) {
  g.save(); g.translate(sx, sy); g.scale(side, 1); g.rotate(a);
  const sl: P[] = [[0, -13], [30, -16], [52, -14, 1], [44, -7], [56, -2, 1], [44, 2], [54, 9, 1], [40, 9], [46, 18, 1], [30, 11], [0, 13]];
  ink(g, '#36323a', sl, seed);
  clip(g, sl, () => { g.fillStyle = '#272429'; g.fillRect(-4, 2, 60, 14); grain(g, 0, -16, 56, 16, seed + 3, 26, 'rgba(8,5,8,.55)', 2); line(g, [[14, -14], [20, 13]], '#7a4231', 7); line(g, [[10, -14], [16, 13]], INK, 2.2); line(g, [[18, -14], [24, 13]], INK, 2.2); });
  hand(g, 44, 10, -0.5, curl);
  g.restore();
}

/** Errante: máscara de hueso agrietada con su nombre tachado, mortaja de vendas y tablillas. Origen: el suelo. */
export function drawErrante(g: G, t: number, P: ErrantePose) {
  glow(g, 6, -130, 150, '185,120,255', 0.08 + 0.22 * P.gl);
  g.save(); g.scale(P.sx, P.sy); g.rotate(P.lean);
  for (const s of [-1, 1]) { g.save(); g.translate(s * 16, -6); for (let i = 0; i < 3; i++) line(g, [[i * 5 - 5, 0], [i * 6 - 7 + s * 2, 8]], INK, 3.5); g.restore(); }
  armE(g, -36, -78, P.aL, -1, 0.6 + 0.3 * Math.sin(t * 3), 21);
  const body: P[] = [[-30, -98], [-46, -62], [-50, -16], ...shreds(-50, 50, -14, 20, 20, t, 11, 1.4), [50, -16], [46, -62], [30, -98]];
  ink(g, '#3a363c', body, 12);
  clip(g, body, () => {
    g.fillStyle = '#29262b'; g.fillRect(-60, -110, 32, 110); g.fillStyle = '#47434a'; g.fillRect(30, -110, 26, 110);
    line(g, [[-60, -74], [60, -44]], '#7a4231', 13); line(g, [[-60, -81], [60, -51]], INK, 3); line(g, [[-60, -67], [60, -37]], INK, 3);
    line(g, [[-60, -30], [60, -56]], '#6a3a2c', 11); line(g, [[-60, -36], [60, -62]], INK, 2.6); line(g, [[-60, -24], [60, -50]], INK, 2.6);
    grain(g, -55, -104, 55, -4, 13, 90, 'rgba(8,5,8,.55)', 2.4); grain(g, -55, -104, 55, -4, 14, 24, 'rgba(140,128,140,.3)', 1.4);
    line(g, [[-14, -90], [-20, -54], [-15, -20]], INK, 3); line(g, [[14, -92], [19, -58], [14, -24]], INK, 2.6);
  });
  strands(g, -46, 46, -8, 9, 16, t, 15);
  const hood: P[] = [[-48, -108], [-60, -158], [-42, -214], [0, -236], [44, -218], [62, -166], [50, -108], ...shreds(52, -50, -104, 16, 16, t, 17, 1)];
  ink(g, '#2c292e', hood, 18);
  clip(g, hood, () => { g.fillStyle = '#1f1d21'; g.fillRect(-70, -240, 30, 140); grain(g, -62, -238, 62, -90, 19, 80, 'rgba(5,3,6,.6)', 2.4); grain(g, -62, -238, 62, -90, 20, 18, 'rgba(130,120,135,.25)', 1.3); });
  g.fillStyle = '#070407'; g.beginPath(); g.ellipse(4, -162, 46, 52, 0, 0, 7); g.fill();
  const mask: P[] = [[-36, -204], [-8, -218], [20, -214], [28, -204, 1], [34, -212, 1], [40, -196], [45, -164], [38, -128], [18, -108], [-6, -106], [-26, -118], [-40, -144], [-44, -178]];
  ink(g, '#d6c8ac', mask, 22, 6);
  const c = `rgba(225,180,255,${0.55 + 0.45 * P.gl})`;
  clip(g, mask, () => {
    g.fillStyle = '#b5a589'; g.fillRect(-50, -150, 26, 50); g.fillRect(-50, -126, 100, 30); g.fillStyle = '#e6dac2'; g.fillRect(20, -216, 24, 60);
    grain(g, -46, -220, 46, -104, 23, 70, 'rgba(90,76,60,.45)', 2);
    glow(g, 2, -166, 70, '200,140,255', 0.35 * P.gl);
    for (const cr of [[[2, -166], [-14, -196], [-10, -214]], [[2, -166], [26, -140], [22, -112]], [[2, -166], [-30, -150], [-40, -138]]]) { line(g, cr, INK, 5); line(g, cr, c, 2.5); }
    line(g, [[26, -140], [40, -148]], INK, 3.5); line(g, [[-14, -196], [-28, -196]], INK, 3);
  });
  g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.arc(2, -166, 15, 0, 7); g.stroke(); line(g, [[2, -186], [2, -146]], INK, 5);
  line(g, [[-16, -184], [20, -148]], INK, 7); line(g, [[20, -184], [-16, -148]], INK, 7);
  line(g, [[-16, -184], [20, -148]], `rgba(225,180,255,${P.gl})`, 2.5); line(g, [[20, -184], [-16, -148]], `rgba(225,180,255,${P.gl})`, 2.5);
  g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.moveTo(-28, -104); g.quadraticCurveTo(4, -82, 34, -104); g.stroke();
  [0.2, 0.5, 0.8].forEach((u, i) => {
    const m = 1 - u, px = m * m * -28 + 2 * m * u * 4 + u * u * 34, py = m * m * -104 + 2 * m * u * -82 + u * u * -104;
    g.save(); g.translate(px, py + 6); g.rotate((u - 0.5) * 0.8 + Math.sin(t * 3 + i) * 0.1);
    ink(g, i === 1 ? '#a07b3e' : '#8b8276', [[-7, -2], [7, -2], [7, 16], [-7, 16]], 31 + i, 3);
    line(g, [[0, 1], [0, 13]], INK, 2.2); line(g, [[-4, 4], [4, 11]], INK, 2.2); line(g, [[4, 4], [-4, 11]], INK, 2.2);
    g.restore();
  });
  armE(g, 38, -80, P.aR, 1, 0.6 + 0.3 * Math.sin(t * 3 + 1), 41);
  g.restore();
}

// ---------------------------------------------------------------------------------- Susurrante

export interface SusurrantePose { rise: number; flare: number; charge: number; mouth: number; spin: number }
/** Altura de la boca del Susurrante respecto al suelo (sin escalar). */
export const SUSURRANTE_MOUTH = -176;

function candle(g: G, t: number, i: number, bright: number) {
  ink(g, '#cbbd9f', [[-5, -14], [5, -14], [5, 6], [-5, 6]], 60 + i, 3); g.fillStyle = '#e8dcc2'; g.fillRect(-3, -12, 3, 16);
  const f = 1 + Math.sin(t * 11 + i) * 0.15;
  glow(g, 0, -22, 22 + bright * 10, '110,255,225', 0.55 + bright * 0.4);
  ink(g, '#8ffff0', [[0, -34 * f + 8, 1], [5, -19], [0, -14], [-5, -19]], 70 + i, 2.5);
}

/** Susurrante: capucha caída con campanita, boca cosida que brilla, incensario y velas que orbitan. */
export function drawSusurrante(g: G, t: number, P: SusurrantePose) {
  const cy = SUSURRANTE_MOUTH - P.rise + Math.sin(t * 1.8) * 7;
  glow(g, 0, cy + 30, 150, '90,255,215', 0.08 + 0.2 * P.charge);
  const orb = (back: boolean) => {
    for (let i = 0; i < 3; i++) {
      const a = P.spin + i * 2.094, z = Math.sin(a);
      if (back !== z < 0) continue;
      g.save(); g.translate(Math.cos(a) * (84 + P.charge * 10), cy + 40 + z * 16 + Math.sin(t * 2 + i) * 4);
      const s = 0.8 + z * 0.15; g.scale(s, s); candle(g, t, i, P.charge); g.restore();
    }
  };
  orb(true);
  const fl = P.flare;
  const L1: P[] = [[-28, cy + 8], [-44, cy + 60], [-52 * fl, cy + 130], ...shreds(-52 * fl, 52 * fl, cy + 130, 18, 26 * fl, t, 21, 3 * fl), [52 * fl, cy + 130], [44, cy + 60], [28, cy + 8]];
  ink(g, '#1f2125', L1, 81);
  clip(g, L1, () => { g.fillStyle = '#16181b'; g.fillRect(-70, cy, 36, 180); grain(g, -60, cy, 60, cy + 160, 82, 80, 'rgba(0,0,0,.55)', 2.2); });
  strands(g, -46 * fl, 46 * fl, cy + 134, 12, 26, t, 83);
  const L2: P[] = [[-30, cy + 4], [-50, cy + 40], [-58 * fl, cy + 90], ...shreds(-58 * fl, 58 * fl, cy + 90, 16, 20 * fl, t + 1, 33, 2.5 * fl), [58 * fl, cy + 90], [50, cy + 40], [30, cy + 4]];
  ink(g, '#2b2e33', L2, 84);
  clip(g, L2, () => { g.fillStyle = '#202327'; g.fillRect(-70, cy, 34, 110); grain(g, -62, cy, 62, cy + 100, 85, 70, 'rgba(0,0,0,.5)', 2.2); grain(g, -62, cy, 62, cy + 100, 86, 14, 'rgba(150,160,165,.22)', 1.3); line(g, [[-12, cy + 14], [-16, cy + 80]], INK, 2.6); line(g, [[14, cy + 12], [18, cy + 78]], INK, 2.6); });
  hand(g, -52, cy + 38, 0.5, 0.7 + 0.4 * Math.sin(t * 5));
  const tip = Math.sin(t * 0.9) * 4;
  const hood: P[] = [[-58, cy + 30, 1], [-48, cy + 14], [-62, cy - 20], [-52, cy - 64], [-20, cy - 94], [22, cy - 106], [56, cy - 114 + tip], [84, cy - 102 + tip], [98, cy - 80 + tip, 1], [80, cy - 86 + tip], [62, cy - 76], [56, cy - 40], [64, cy - 4], [62, cy + 30, 1], [46, cy + 16], [36, cy + 32, 1], [22, cy + 14], [-22, cy + 14], [-36, cy + 32, 1], [-46, cy + 16]];
  ink(g, '#2e3136', hood, 87, 6.5);
  clip(g, hood, () => {
    g.fillStyle = '#212428'; g.fillRect(-70, cy - 120, 34, 160); g.fillStyle = '#3a3e44'; g.fillRect(30, cy - 120, 40, 90);
    grain(g, -66, cy - 118, 100, cy + 30, 88, 110, 'rgba(0,0,0,.55)', 2.4); grain(g, -66, cy - 118, 100, cy + 30, 89, 22, 'rgba(160,170,175,.22)', 1.3);
    line(g, [[-70, cy + 6], [70, cy + 6]], '#2b6a6a', 15); line(g, [[-70, cy - 2], [70, cy - 2]], INK, 3); line(g, [[-70, cy + 14], [70, cy + 14]], INK, 3);
    g.strokeStyle = '#7fd8c8'; g.lineWidth = 2.2; g.beginPath(); for (let xx = -70; xx <= 70; xx += 8) g.lineTo(xx, cy + ((xx / 8) % 2 ? 2 : 10)); g.stroke();
    line(g, [[-30, cy - 84], [-40, cy - 30]], INK, 2.6); line(g, [[30, cy - 96], [38, cy - 50]], INK, 2.6);
  });
  line(g, [[98, cy - 80 + tip], [98, cy - 70 + tip]], INK, 2.5);
  ink(g, '#a07b3e', [[92, cy - 70 + tip], [104, cy - 70 + tip], [106, cy - 58 + tip], [90, cy - 58 + tip]], 90, 3);
  g.fillStyle = '#050607'; g.beginPath(); g.ellipse(0, cy - 16, 36, 32, 0, 0, 7); g.fill();
  const e = Math.min(1, 0.7 + 0.3 * Math.sin(t * 6) + P.charge * 0.4);
  glow(g, 0, cy - 10, 48, '90,255,215', 0.35 * e);
  g.fillStyle = `rgba(150,255,235,${e})`; g.beginPath(); g.arc(-12, cy - 28, 2.6 + P.charge * 1.5, 0, 7); g.arc(12, cy - 28, 2.6 + P.charge * 1.5, 0, 7); g.fill();
  const mo = P.mouth;
  if (mo < 0.05) {
    line(g, [[0, cy - 12], [0, cy + 8]], `rgba(140,255,230,${e})`, 3);
    for (let i = 0; i < 4; i++) { const yy = cy - 10 + i * 5.5 + Math.sin(t * 30) * P.charge * 1.2; line(g, [[-5, yy - 2], [5, yy + 2]], INK, 2.6); }
  } else {
    glow(g, 0, cy - 2, 40 + mo * 30, '90,255,215', 0.8 * mo);
    ink(g, '#0a1a18', [[-5 - 8 * mo, cy - 4], [0, cy - 14 - 6 * mo], [5 + 8 * mo, cy - 4], [0, cy + 10 + 14 * mo]], 91, 3);
    g.fillStyle = `rgba(150,255,235,${mo})`; g.beginPath(); g.ellipse(0, cy + 2 + 4 * mo, 3 + 5 * mo, 4 + 9 * mo, 0, 0, 7); g.fill();
  }
  const cs = Math.sin(t * 2.2) * 0.25, cx2 = 52 + Math.sin(cs) * 56, cyy = cy + 40 + Math.cos(cs) * 52;
  for (let i = 1; i < 7; i++) { const u = i / 7; g.strokeStyle = INK; g.lineWidth = 4.5; g.beginPath(); g.ellipse(52 + (cx2 - 52) * u, cy + 40 + (cyy - cy - 40) * u, 3, 4.5, cs, 0, 7); g.stroke(); g.strokeStyle = '#7d828a'; g.lineWidth = 2; g.stroke(); }
  hand(g, 52, cy + 36, -0.4, 0.9);
  g.save(); g.translate(cx2, cyy); g.rotate(cs * 0.6);
  glow(g, 0, 6, 40 + P.charge * 20, '90,255,215', 0.5 + P.charge * 0.4);
  ink(g, '#9a7438', [[-14, -6], [14, -6], [16, 10], [8, 22], [-8, 22], [-16, 10]], 92, 4); ink(g, '#7c5c2c', [[-6, -14], [6, -14], [8, -6], [-8, -6]], 93, 3);
  g.fillStyle = 'rgba(150,255,235,.95)'; for (const [hx, hy] of [[-6, 6], [0, 11], [6, 6], [0, 1]]) { g.beginPath(); g.arc(hx, hy, 2.3, 0, 7); g.fill(); }
  g.restore();
  orb(false);
}

// -------------------------------------------------------------------------------------- Coloso

export interface ColosoPose { br: number; aL: number; aR: number; gl: number; chain: number }

function armC(g: G, sx: number, side: number, a: number, br: number, seed: number) {
  g.save(); g.translate(sx, -150 - br); g.scale(side, 1); g.rotate(a);
  const up: P[] = [[-26, -8], [26, -8], [24, 40], [18, 66], [-18, 66], [-24, 40]];
  ink(g, '#47434c', up, seed);
  clip(g, up, () => { g.fillStyle = '#38353d'; g.fillRect(-30, -10, 22, 80); grain(g, -28, -10, 28, 70, seed + 1, 40, 'rgba(5,4,6,.55)', 2.2); line(g, [[-30, 24], [30, 20]], '#28282e', 11); [-14, 0, 14].forEach((x) => rivet(g, x, 22)); });
  const f: P[] = [[-30, 58], [30, 58], [34, 92], [22, 104], [-22, 104], [-34, 92]];
  ink(g, '#55505a', f, seed + 2);
  clip(g, f, () => {
    g.fillStyle = '#423e47'; g.fillRect(-36, 90, 72, 20); grain(g, -34, 56, 34, 106, seed + 3, 36, 'rgba(5,4,6,.55)', 2.2);
    for (const yy of [68, 80]) { line(g, [[-36, yy], [36, yy + 5]], '#6f737c', 7); line(g, [[-36, yy - 4], [36, yy + 1]], INK, 2); line(g, [[-36, yy + 4], [36, yy + 9]], INK, 2); }
  });
  for (let i = -1; i <= 1; i++) line(g, [[i * 11, 92], [i * 11, 103]], INK, 3);
  g.restore();
}

/** Yelmo de campana: bronce abollado, una rendija con dos ojos magenta y un badajo colgando. */
function headCampana(g: G, t: number, c: number, gl: number) {
  const p: P[] = [[-44, -180], [44, -180], [40, -198], [36, -236], [22, -262], [0, -270], [-22, -262], [-36, -236], [-40, -198]];
  ink(g, '#80612f', p, 211, 6.5);
  const mg = `rgba(255,95,175,${c})`;
  clip(g, p, () => {
    g.fillStyle = '#634a22'; g.fillRect(-52, -280, 24, 110); g.fillStyle = '#9f7c3e'; g.fillRect(18, -272, 30, 70);
    grain(g, -46, -274, 46, -178, 212, 90, 'rgba(20,12,4,.55)', 2.3); grain(g, -46, -274, 46, -178, 213, 18, 'rgba(240,210,150,.3)', 1.3);
    line(g, [[-50, -196], [50, -196]], '#5a4220', 9); line(g, [[-50, -201], [50, -201]], INK, 2.6); line(g, [[-50, -191], [50, -191]], INK, 2.6);
    line(g, [[-30, -246], [30, -246]], INK, 2.6);
    g.fillStyle = '#07040a'; g.beginPath(); g.moveTo(-30, -228); g.lineTo(30, -226); g.lineTo(26, -216); g.lineTo(-28, -218); g.closePath(); g.fill();
    glow(g, 0, -222, 36, '255,70,160', 0.6 * c);
    g.fillStyle = `rgba(255,140,200,${c})`; g.beginPath(); g.ellipse(-12, -222, 4 + gl * 2, 2.4, 0, 0, 7); g.ellipse(12, -221, 4 + gl * 2, 2.4, 0, 0, 7); g.fill();
    const cr = [[-36, -262], [-22, -244], [-28, -232]]; line(g, cr, INK, 5); line(g, cr, mg, 2.4);
    const cr2 = [[24, -204], [14, -196], [18, -184]]; line(g, cr2, INK, 4.5); line(g, cr2, mg, 2.2);
    g.fillStyle = '#4a3618'; g.beginPath(); g.ellipse(26, -250, 7, 5, 0.5, 0, 7); g.fill();
  });
  for (let x = -36; x <= 36; x += 18) rivet(g, x, -196);
  ink(g, '#5a4220', [[-8, -270], [8, -270], [6, -284], [-6, -284]], 214, 4);
  g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.arc(0, -288, 7, Math.PI, 0); g.stroke();
  const sw = Math.sin(t * 3) * 3;
  ink(g, '#3a3d44', [[-6 + sw, -170], [6 + sw, -170], [8 + sw, -160], [-8 + sw, -160]], 215, 3);
  ink(g, '#cdbda9', [[-36, -236], [-66, -252, 1], [-44, -246], [-38, -246]], 216, 3.5);
  ink(g, '#cdbda9', [[36, -236], [66, -252, 1], [44, -246], [38, -246]], 217, 3.5);
}

/** Coloso: mole de piedra con banda de hierro, lápidas tachadas, cadenas y yelmo de campana. */
export function drawColoso(g: G, t: number, P: ColosoPose) {
  glow(g, 0, -130, 180, '255,70,160', 0.06 + 0.3 * P.gl);
  for (const s of [-1, 1]) {
    const lg: P[] = [[s * 34 - 22, -46], [s * 34 + 22, -46], [s * 34 + 26, -2], [s * 34 - 26, -2]];
    ink(g, '#3e3b42', lg, 40 + s);
    clip(g, lg, () => { grain(g, s * 34 - 26, -46, s * 34 + 26, 0, 50 + s, 24, 'rgba(5,4,6,.55)', 2); line(g, [[s * 34 - 30, -24], [s * 34 + 30, -24]], '#28282e', 9); rivet(g, s * 34 - 11, -24); rivet(g, s * 34 + 11, -24); });
  }
  const br = P.br;
  armC(g, -80, -1, P.aL, br, 101);
  g.save(); g.translate(0, -br);
  const body: P[] = [[-76, -40], [-92, -112], [-70, -178], [-26, -200], [26, -198], [72, -178], [94, -112], [80, -40], [0, -24]];
  ink(g, '#4b4750', body, 61, 7.5);
  const c = Math.min(1, 0.6 + 0.3 * Math.sin(t * 2.6) + P.gl * 0.5), mg = `rgba(255,95,175,${c})`;
  clip(g, body, () => {
    g.fillStyle = '#38353d'; g.fillRect(-100, -210, 46, 210); g.fillRect(-100, -64, 200, 44); g.fillStyle = '#5c5862'; g.fillRect(44, -196, 50, 80);
    grain(g, -94, -204, 96, -22, 62, 150, 'rgba(5,4,6,.55)', 2.6); grain(g, -94, -204, 96, -22, 63, 30, 'rgba(150,140,155,.25)', 1.4);
    for (const p of [[[-62, -152], [-46, -136], [-52, -114]], [[58, -98], [42, -86], [48, -62], [36, -50]], [[-30, -72], [-18, -62], [-24, -44]]]) line(g, p, INK, 3.2);
    line(g, [[-100, -120], [100, -132]], '#28282e', 17); line(g, [[-100, -129], [100, -141]], INK, 3.2); line(g, [[-100, -111], [100, -123]], INK, 3.2);
    for (let xx = -80; xx <= 80; xx += 20) rivet(g, xx, -126 - xx * 0.06);
    glow(g, 10, -92, 60, '255,70,160', 0.45 * c);
    const v = [[-40, -162], [-22, -144], [-30, -120], [-6, -104], [12, -118], [28, -98], [22, -76]]; line(g, v, INK, 6.5); line(g, v, mg, 3.4);
    const v2 = [[-6, -104], [-2, -84], [-14, -70]]; line(g, v2, INK, 5.5); line(g, v2, mg, 2.6);
  });
  ([[-34, -84, -0.12], [24, -60, 0.1]] as const).forEach(([tx, ty, a], i) => {
    g.save(); g.translate(tx, ty); g.rotate(a);
    ink(g, '#8b8276', [[-12, -16], [12, -16], [12, 16], [-12, 16]], 110 + i, 4);
    line(g, [[-6, -8], [6, -8]], INK, 2.6); line(g, [[0, -8], [0, 10]], INK, 2.6); line(g, [[-7, -2], [7, 7]], mg, 3.2); line(g, [[7, -2], [-7, 7]], mg, 3.2);
    g.restore();
  });
  for (const [cx, len] of [[-52, 5], [48, 4]]) for (let i = 0; i < len; i++) {
    const sw = Math.sin(t * 2 + i * 0.6 + cx) * 2 * i + P.chain * i * 3;
    g.strokeStyle = INK; g.lineWidth = 5.5; g.beginPath(); g.ellipse(cx + sw, -114 + i * 13, 5, 7.5, 0, 0, 7); g.stroke(); g.strokeStyle = '#7a7e88'; g.lineWidth = 2.4; g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.ellipse(0, -186, 40, 9, 0, 0, 7); g.fill();
  headCampana(g, t, c, P.gl);
  g.restore();
  armC(g, 80, 1, P.aR, br, 131);
}

// ----------------------------------------------------------------------------- Avisos en el piso

/** Círculo de runas donde caerá el Lamento del Susurrante. */
export function drawRuneTelegraph(g: G, x: number, y: number, r: number, a: number, t: number) {
  g.save(); g.translate(x, y); g.scale(1, 0.32); g.globalAlpha = Math.min(1, a);
  g.strokeStyle = 'rgba(110,255,225,.85)'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(0, 0, r * 0.78, 0, 7); g.stroke();
  g.fillStyle = `rgba(90,255,215,${0.18 * a})`; g.beginPath(); g.arc(0, 0, r * Math.min(1, a), 0, 7); g.fill();
  g.rotate(t * 1.5); for (let i = 0; i < 10; i++) { g.rotate(0.628); line(g, [[r * 0.8, 0], [r * 0.96, 0]], 'rgba(110,255,225,.9)', 3); }
  g.restore();
}

/** Zona de peligro del Derrumbe del Coloso: borde punteado que se va llenando. */
export function drawZoneTelegraph(g: G, x: number, y: number, r: number, p: number, t: number) {
  g.save(); g.translate(x, y); g.scale(1, 0.3);
  g.strokeStyle = 'rgba(255,80,160,.85)'; g.lineWidth = 5; g.setLineDash([14, 10]); g.lineDashOffset = -t * 40; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); g.setLineDash([]);
  const e = p * p * (3 - 2 * p);
  g.fillStyle = `rgba(255,60,140,${0.12 + 0.18 * p})`; g.beginPath(); g.arc(0, 0, r * e, 0, 7); g.fill();
  g.restore();
}

// --------------------------------------------------------------------------------- Efectos de PvE

interface Part { k: 'spark' | 'ink' | 'rock' | 'dust' | 'stitch'; x: number; y: number; vx: number; vy: number; gr: number; t: number; life: number; s: number; c?: string; rot: number; vr: number; ground?: number; seed?: number }
interface Fx { k: 'claw' | 'ring' | 'cracks' | 'scream' | 'pillar' | 'burst'; x: number; y: number; t: number; life: number; rot?: number; r0?: number; r1?: number; c?: string; cr?: number[][][] }
interface Wisp { x0: number; y0: number; x1: number; y1: number; c1: [number, number]; c2: [number, number]; t0: number; dur: number; trail: [number, number][]; seed: number }

/** Partículas y efectos de los ataques de los Desnombrados (coordenadas del mundo). */
export class PveFx {
  private parts: Part[] = [];
  private fx: Fx[] = [];
  private wisps: Wisp[] = [];
  /** Sacudida pedida por el último golpe fuerte (el juego la suma a la suya). */
  shake = 0;

  private spawn(p: Omit<Part, 't' | 'rot' | 'vr' | 'gr'> & Partial<Pick<Part, 'rot' | 'vr' | 'gr'>>) { if (this.parts.length < 260) this.parts.push({ t: 0, rot: 0, vr: 0, gr: 0, ...p }); }

  /** Zarpazo del Errante: dos medias lunas cruzadas, chispas violetas y tinta. */
  slash(x: number, y: number, dir: number) {
    const rot = dir < 0 ? Math.PI : 0;
    this.fx.push({ k: 'claw', x, y, t: 0, life: 0.32, rot: rot + 0.4 }, { k: 'claw', x, y: y + 8, t: -0.06, life: 0.32, rot: rot - 0.4 });
    this.shake = Math.max(this.shake, 4);
    for (let i = 0; i < 10; i++) { const a = rot - 0.8 + Math.random() * 1.6, s = 140 + Math.random() * 180; this.spawn({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.2, c: '220,170,255', s: 1.5 + Math.random() * 2 }); }
    for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28, s = 60 + Math.random() * 110; this.spawn({ k: 'ink', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, gr: 500, life: 0.5, s: 2 + Math.random() * 3 }); }
  }

  /** Lamento del Susurrante: ondas desde la boca y tres espíritus que caen en curva sobre el punto. */
  lament(mx: number, my: number, tx: number, ty: number, travelMs: number) {
    this.fx.push({ k: 'scream', x: mx, y: my, t: 0, life: 0.55 });
    this.shake = Math.max(this.shake, 2);
    for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28; this.spawn({ k: 'stitch', x: mx, y: my, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120 - 50, gr: 400, life: 0.45, s: 2, rot: Math.random() * 6, vr: 12 }); }
    const now = performance.now();
    for (let i = 0; i < 3; i++) {
      const side = i - 1;
      this.wisps.push({ x0: mx, y0: my, x1: tx + side * 10, y1: ty - 6, c1: [mx + side * 50, my - 80], c2: [tx - side * 40, ty - 110 + i * 20], t0: now + i * 45, dur: travelMs - i * 45, trail: [], seed: 300 + i });
    }
  }

  /** Derrumbe del Coloso: ondas, grietas que brillan, rocas que rebotan y polvo. */
  impact(x: number, y: number, r: number) {
    this.shake = Math.max(this.shake, 14);
    this.fx.push({ k: 'ring', x, y, t: 0, life: 0.6, r0: 20, r1: r * 1.6, c: '255,90,170' }, { k: 'ring', x, y, t: 0, life: 0.45, r0: 12, r1: r, c: '255,220,235' });
    const cr: number[][][] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.random() * 0.4, p = [[x, y]]; let px = x, py = y;
      for (let j = 0; j < 4; j++) { const aa = a + (Math.random() - 0.5) * 0.6; px += Math.cos(aa) * (10 + Math.random() * 10); py += Math.sin(aa) * (4 + Math.random() * 4); p.push([px, py]); }
      cr.push(p);
    }
    this.fx.push({ k: 'cracks', x, y, t: 0, life: 1.4, cr });
    for (let i = 0; i < 14; i++) { const a = -Math.PI * (0.1 + 0.8 * Math.random()), s = 110 + Math.random() * 200; this.spawn({ k: 'rock', x: x + (Math.random() - 0.5) * 24, y: y - 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, gr: 900, ground: y + 8 + Math.random() * 8, life: 1.1, s: 2.5 + Math.random() * 4, vr: (Math.random() - 0.5) * 14, seed: 400 + i }); }
    for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2; this.spawn({ k: 'dust', x: x + Math.cos(a) * 18, y: y + Math.sin(a) * 5, vx: Math.cos(a) * 55, vy: -14 - Math.random() * 18, life: 0.9, s: 6 + Math.random() * 6 }); }
    for (let i = 0; i < 8; i++) { const a = -Math.PI * Math.random(), s = 160 + Math.random() * 180; this.spawn({ k: 'spark', x, y: y - 3, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35, c: '255,120,190', s: 2.5 }); }
  }

  /** Un Desnombrado se deshace en tinta y polvo. */
  dissolve(x: number, y: number, big: boolean) {
    for (let i = 0; i < (big ? 22 : 12); i++) { const a = Math.random() * 6.28, s = 40 + Math.random() * (big ? 140 : 90); this.spawn({ k: 'ink', x: x + (Math.random() - 0.5) * 20, y: y - 30 - Math.random() * (big ? 90 : 40), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, gr: 300, life: 0.7, s: 2 + Math.random() * (big ? 5 : 3) }); }
    for (let i = 0; i < 6; i++) this.spawn({ k: 'dust', x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * 40, vy: -20, life: 0.8, s: big ? 14 : 8 });
  }

  /** Pulso de un monolito o de un Nombre errado. */
  pulse(x: number, y: number, rgb: string, r: number) { this.fx.push({ k: 'ring', x, y, t: 0, life: 0.9, r0: 20, r1: r, c: rgb }, { k: 'burst', x, y, t: 0, life: 0.6, c: rgb, r1: r * 0.4 }); }

  /** Grietas bajo los personajes (se dibujan antes que ellos). */
  drawGround(g: G) {
    for (const f of this.fx) if (f.k === 'cracks' && f.cr) { const a = Math.max(0, 1 - f.t / f.life); for (const p of f.cr) line(g, p, `rgba(0,0,0,${a * 0.7})`, 6); }
  }

  draw(g: G, t: number, dt: number) {
    for (const f of this.fx) {
      f.t += dt;
      if (f.t < 0) continue;
      const u = f.t / f.life, a = Math.max(0, 1 - u);
      if (f.k === 'claw') {
        const s = 1 + u * 0.5;
        for (const [r, w, col] of [[26 * s, 9 * a + 2, '#b77cff'], [23 * s, 5 * a + 1, '#f3e6ff']] as const) {
          g.save(); g.translate(f.x, f.y); g.rotate(f.rot ?? 0); g.globalAlpha = a;
          g.beginPath(); g.arc(0, 0, r, -1.15, 1.15); g.arc(w * 0.6, 0, r - w, 1.15, -1.15, true); g.closePath();
          g.fillStyle = col; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke(); g.restore();
        }
        g.globalAlpha = 1;
      } else if (f.k === 'ring') {
        const R = (f.r0 ?? 10) + ((f.r1 ?? 60) - (f.r0 ?? 10)) * (1 - (1 - u) * (1 - u));
        g.save(); g.translate(f.x, f.y); g.scale(1, 0.3); g.strokeStyle = `rgba(${f.c},${a})`; g.lineWidth = 8 * a + 2; g.beginPath(); g.arc(0, 0, R, 0, 7); g.stroke(); g.restore();
      } else if (f.k === 'burst') {
        glow(g, f.x, f.y - 30, (f.r1 ?? 60) * (0.6 + u), f.c ?? '255,255,255', 0.7 * a);
      } else if (f.k === 'cracks' && f.cr) {
        for (const p of f.cr) line(g, p, `rgba(255,95,175,${a})`, 2.4);
        glow(g, f.x, f.y, 50, '255,70,160', 0.5 * a);
      } else if (f.k === 'scream') {
        for (let j = 0; j < 4; j++) {
          const R = 10 + u * 70 + j * 11; g.strokeStyle = `rgba(140,255,230,${Math.max(0, a - j * 0.15)})`; g.lineWidth = 3.5 - j * 0.6;
          g.beginPath(); g.arc(f.x, f.y, R, -0.3, 0.9); g.stroke(); g.beginPath(); g.arc(f.x, f.y, R, Math.PI - 0.9, Math.PI + 0.3); g.stroke();
        }
      } else if (f.k === 'pillar') {
        const h = 90 * Math.min(1, u * 5), w = 15 * (1 - u * 0.6);
        glow(g, f.x, f.y - h * 0.5, 60, '90,255,215', 0.6 * a);
        g.save(); g.translate(f.x, f.y); g.globalAlpha = a; g.beginPath(); g.moveTo(-w, 0);
        for (let i = 0; i <= 6; i++) g.lineTo(-w * (1 - i / 7) + Math.sin(t * 20 + i) * 2.5, -h * i / 6);
        g.lineTo(0, -h - 12);
        for (let i = 6; i >= 0; i--) g.lineTo(w * (1 - i / 7) + Math.sin(t * 20 + i + 2) * 2.5, -h * i / 6);
        g.closePath(); g.fillStyle = '#4fe3c6'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2.5; g.stroke();
        g.beginPath(); g.moveTo(-w * 0.4, 0); g.lineTo(0, -h * 0.8); g.lineTo(w * 0.4, 0); g.closePath(); g.fillStyle = '#eafff9'; g.fill();
        g.restore(); g.globalAlpha = 1;
      }
    }
    compact(this.fx, (f) => f.t < f.life);
    const now = performance.now();
    for (let i = this.wisps.length - 1; i >= 0; i--) {
      const w = this.wisps[i], u = (now - w.t0) / w.dur;
      if (u < 0) continue;
      if (u >= 1) {
        this.fx.push({ k: 'pillar', x: w.x1, y: w.y1 + 6, t: 0, life: 0.55 });
        this.shake = Math.max(this.shake, 3);
        for (let j = 0; j < 8; j++) { const a = -Math.PI * Math.random(), s = 80 + Math.random() * 140; this.spawn({ k: 'spark', x: w.x1, y: w.y1, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4, c: '140,255,230', s: 2 }); }
        this.wisps.splice(i, 1); continue;
      }
      const m = 1 - u;
      const bx = m * m * m * w.x0 + 3 * m * m * u * w.c1[0] + 3 * m * u * u * w.c2[0] + u * u * u * w.x1;
      const by = m * m * m * w.y0 + 3 * m * m * u * w.c1[1] + 3 * m * u * u * w.c2[1] + u * u * u * w.y1;
      w.trail.push([bx, by]); if (w.trail.length > 10) w.trail.shift();
      for (let j = 1; j < w.trail.length; j++) line(g, [w.trail[j - 1], w.trail[j]], `rgba(110,255,225,${(j / w.trail.length) * 0.6})`, j * 0.7);
      glow(g, bx, by, 20, '90,255,215', 0.7);
      const pv = w.trail.length > 1 ? w.trail[w.trail.length - 2] : [bx - 1, by], ang = Math.atan2(by - pv[1], bx - pv[0]);
      g.save(); g.translate(bx, by); g.rotate(ang); g.scale(0.6, 0.6);
      ink(g, '#bffff4', [[12, 0], [4, -9], [-10, -6], [-22, 0, 1], [-10, 6], [4, 9]], w.seed, 3);
      g.fillStyle = INK; g.beginPath(); g.arc(5, -3, 1.8, 0, 7); g.arc(5, 3, 1.8, 0, 7); g.fill(); g.beginPath(); g.ellipse(9, 0, 1.4, 2.4, 0, 0, 7); g.fill();
      g.restore();
    }
    for (const p of this.parts) {
      p.t += dt; p.vy += p.gr * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.ground && p.y > p.ground) { p.y = p.ground; p.vy *= -0.32; p.vx *= 0.55; p.vr *= 0.5; }
      const a = Math.max(0, 1 - p.t / p.life);
      if (p.k === 'spark') line(g, [[p.x, p.y], [p.x - p.vx * 0.035, p.y - p.vy * 0.035]], `rgba(${p.c},${a})`, p.s);
      else if (p.k === 'ink') { g.fillStyle = INK; g.beginPath(); g.arc(p.x, p.y, p.s * (0.4 + 0.6 * a), 0, 7); g.fill(); }
      else if (p.k === 'stitch') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); line(g, [[-3, 0], [3, 0]], `rgba(140,255,230,${a})`, 2); g.restore(); }
      else if (p.k === 'rock') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, a * 3); ink(g, '#4b4750', [[-p.s, -p.s * 0.6], [p.s * 0.7, -p.s], [p.s, p.s * 0.4], [-p.s * 0.3, p.s]], p.seed ?? 1, 2); g.restore(); g.globalAlpha = 1; }
      else if (p.k === 'dust') { g.fillStyle = `rgba(95,88,100,${a * 0.45})`; g.beginPath(); g.ellipse(p.x, p.y, p.s * (1 + p.t * 2.4), p.s * (0.6 + p.t * 1.2), 0, 0, 7); g.fill(); }
    }
    compact(this.parts, (p) => p.t < p.life);
  }
}
