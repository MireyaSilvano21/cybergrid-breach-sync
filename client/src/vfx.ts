/**
 * Efectos de combate de los jugadores (ataques, Inscripciones y Nombres).
 * Siguen las reglas de "game feel": anticipación corta, un barrido (smear) rápido que se ve
 * completo, destello de impacto, partículas pocas pero con dirección, y sacudida medida según el
 * peso del golpe. Las formas en el piso que marcan el área real se siguen dibujando aparte.
 * Todo en coordenadas del mundo; se dibuja después de la oscuridad para que brille.
 */
import { glow, INK } from './desnombrados';

type G = CanvasRenderingContext2D;
type Kind = 'spark' | 'ember' | 'petal' | 'leaf' | 'plus' | 'smoke' | 'rock' | 'dust' | 'mote' | 'shard';
interface Part { k: Kind; x: number; y: number; vx: number; vy: number; gr: number; t: number; life: number; s: number; rgb: string; rot: number; vr: number; drag: number; ground?: number }
interface Fx { k: string; x: number; y: number; t: number; life: number; dx: number; dy: number; r: number; w: number; ang: number; rgb: string; x2?: number; y2?: number; n?: number; cr?: number[][][] }

/** Quita en el mismo arreglo lo que ya no sirve (sin crear uno nuevo en cada cuadro). */
function compact<T>(arr: T[], keep: (x: T) => boolean) { let j = 0; for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[j++] = arr[i]; arr.length = j; }

const TAU = Math.PI * 2;
const ease = (u: number) => 1 - (1 - u) * (1 - u);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class CombatVfx {
  private parts: Part[] = [];
  private fx: Fx[] = [];
  /** Sacudida pedida por el último golpe; el juego la toma y la suma a la suya. */
  shake = 0;

  private add(f: Partial<Fx> & { k: string; x: number; y: number; life: number }) {
    this.fx.push({ t: 0, dx: 1, dy: 0, r: 60, w: 20, ang: 90, rgb: '255,255,255', ...f });
    if (this.fx.length > 90) this.fx.shift();
  }
  private spawn(p: Partial<Part> & { k: Kind; x: number; y: number; life: number }) {
    if (this.parts.length > 320) return;
    this.parts.push({ vx: 0, vy: 0, gr: 0, t: 0, s: 3, rgb: '255,255,255', rot: Math.random() * TAU, vr: 0, drag: 0, ...p });
  }
  private burst(x: number, y: number, n: number, k: Kind, rgb: string, sp: [number, number], life: [number, number], dir?: number, spread = TAU, extra: Partial<Part> = {}) {
    for (let i = 0; i < n; i++) {
      const a = dir === undefined ? Math.random() * TAU : dir + (Math.random() - 0.5) * spread, v = rnd(sp[0], sp[1]);
      this.spawn({ k, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(life[0], life[1]), rgb, s: rnd(2, 4), ...extra });
    }
  }

  // ------------------------------------------------------------------ ataques básicos

  /**
   * Golpe cuerpo a cuerpo: barrido en media luna del color del Foco. heavy agrega sacudida y polvo;
   * twin, una segunda media luna cruzada (Gemelas); el Foco decide las partículas.
   */
  slash(x: number, y: number, dx: number, dy: number, r: number, angDeg: number, rgb: string, foco = '') {
    const heavy = foco === 'martillo' || foco === 'guadana', twin = foco === 'gemelas';
    const R = Math.max(46, r), y0 = y - 22;
    this.add({ k: 'slash', x, y: y0, dx, dy, r: R, ang: Math.min(200, angDeg + 20), rgb, life: heavy ? 0.34 : 0.24, w: heavy ? 26 : 16 });
    if (twin) this.add({ k: 'slash', x, y: y0 + 6, dx, dy, r: R * 0.85, ang: angDeg, rgb, life: 0.24, w: 12, n: -1 });
    const a0 = Math.atan2(dy, dx), tip = { x: x + Math.cos(a0) * R, y: y0 + Math.sin(a0) * R };
    if (foco === 'llama') this.burst(tip.x, tip.y, 12, 'ember', '255,170,60', [60, 180], [0.4, 0.8], a0, 1.6, { gr: -120, drag: 1.5 });
    else if (foco === 'guadana') this.burst(tip.x, tip.y, 8, 'petal', '230,60,90', [60, 160], [0.6, 1], a0, 2, { gr: 60, drag: 1.2, vr: 6 });
    else if (foco === 'daga') this.burst(tip.x, tip.y, 6, 'shard', '255,110,120', [120, 240], [0.2, 0.35], a0, 1.2);
    else this.burst(tip.x, tip.y, 6, 'spark', rgb, [160, 320], [0.15, 0.3], a0, 1.4);
    if (heavy) {
      this.shake = Math.max(this.shake, 5);
      if (foco === 'martillo') this.groundHit(tip.x, tip.y + 22, 46, '255,170,140', false);
    }
  }

  /** Estocada en línea (Lanza): una punta de luz afilada con chispas en la punta. */
  thrust(x: number, y: number, dx: number, dy: number, len: number, w: number, rgb: string) {
    this.add({ k: 'thrust', x, y: y - 18, dx, dy, r: Math.max(80, len), w: Math.max(16, w), rgb, life: 0.26 });
    const tx = x + dx * len, ty = y - 18 + dy * len;
    this.burst(tx, ty, 9, 'ember', rgb, [80, 220], [0.25, 0.5], Math.atan2(dy, dx), 1, { drag: 2 });
  }

  /** Fogonazo al disparar (Revólver, Arco, Cetros, Inscripciones de proyectil). */
  muzzle(x: number, y: number, dx: number, dy: number, rgb: string, big = false) {
    this.add({ k: 'muzzle', x, y, dx, dy, r: big ? 34 : 22, rgb, life: 0.12 });
    this.burst(x, y, big ? 6 : 3, 'spark', rgb, [120, 260], [0.1, 0.22], Math.atan2(dy, dx), 0.9);
    if (big) this.spawn({ k: 'smoke', x, y, vx: dx * 30, vy: dy * 30 - 20, life: 0.6, s: 10, rgb: '90,84,100', drag: 2 });
  }

  /** Confirmación de golpe (el servidor avisa): destello en estrella, anillo y chispas. */
  hit(x: number, y: number, dirX: number, dirY: number, rgb: string, dmg: number) {
    const big = dmg >= 15;
    this.add({ k: 'star', x, y: y - 30, r: big ? 34 : 24, rgb, life: big ? 0.16 : 0.12, ang: Math.random() * 0.8 });
    this.add({ k: 'ring', x, y: y - 30, r: big ? 46 : 32, rgb, life: 0.22 });
    this.burst(x, y - 30, big ? 10 : 6, 'spark', rgb, [160, 360], [0.15, 0.3], Math.atan2(dirY, dirX), 1.6);
    if (big) this.shake = Math.max(this.shake, 4);
  }

  // ------------------------------------------------------------------ habilidades

  /** Embestida (Llamar a la Piedra, Corte espectral): estela de velocidad y polvo al salir. */
  dash(x: number, y: number, dx: number, dy: number, len: number, rgb: string, slashAtEnd: boolean) {
    this.add({ k: 'dash', x, y: y - 20, dx, dy, r: len, rgb, life: 0.42, w: 22 });
    this.burst(x, y, 6, 'dust', '120,110,130', [30, 80], [0.4, 0.7], Math.atan2(-dy, -dx), 1.4, { s: 8, drag: 2 });
    if (slashAtEnd) this.slash(x + dx * len, y + dy * len, dx, dy, 60, 140, rgb, 'gemelas');
    else this.shake = Math.max(this.shake, 3);
  }

  /** Paso sin Nombre: la tinta se cierra donde estabas y se abre donde apareces. */
  blink(x: number, y: number, x2: number, y2: number, rgb: string) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, d = rnd(30, 60);
      this.spawn({ k: 'mote', x: x + Math.cos(a) * d, y: y - 30 + Math.sin(a) * d, vx: -Math.cos(a) * d * 4, vy: -Math.sin(a) * d * 4, life: 0.25, rgb, s: 3 });
    }
    this.add({ k: 'ring', x: x2, y: y2 - 30, r: 50, rgb, life: 0.35 });
    this.add({ k: 'line', x, y: y - 30, x2, y2: y2 - 30, rgb, life: 0.3 });
    this.burst(x2, y2 - 30, 14, 'mote', rgb, [80, 200], [0.3, 0.6]);
  }

  /** Golpe al piso en un área (Temblor, Grieta, Fractura del Martillo): onda, grietas, rocas y polvo. */
  groundHit(x: number, y: number, r: number, rgb: string, heavy = true) {
    this.add({ k: 'wave', x, y, r: r * 1.3, rgb, life: 0.5 });
    const cr: number[][][] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + Math.random() * 0.5, p = [[x, y]];
      let px = x, py = y;
      for (let j = 0; j < 3; j++) { const aa = a + (Math.random() - 0.5) * 0.7; px += Math.cos(aa) * r * 0.3; py += Math.sin(aa) * r * 0.13; p.push([px, py]); }
      cr.push(p);
    }
    this.add({ k: 'cracks', x, y, rgb, life: 1, cr });
    for (let i = 0; i < (heavy ? 10 : 5); i++) {
      const a = -Math.PI * rnd(0.1, 0.9), s = rnd(90, 220);
      this.spawn({ k: 'rock', x: x + rnd(-r * 0.4, r * 0.4), y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, gr: 900, ground: y + rnd(-6, 8), life: 0.9, s: rnd(2.5, 5), vr: rnd(-12, 12), rgb: '75,70,80' });
    }
    this.burst(x, y, heavy ? 8 : 4, 'dust', '120,110,130', [30, 70], [0.6, 0.9], undefined, TAU, { s: 10, drag: 2, vy: -15 });
    this.shake = Math.max(this.shake, heavy ? 7 : 4);
  }

  /** Grieta (Cetro de Rubí): fisura en el piso de la que brotan cristales de rubí. */
  rubyRift(x: number, y: number, r: number) {
    this.groundHit(x, y, r, '255,70,80', false);
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * TAU, d = rnd(0, r * 0.75);
      this.add({ k: 'crystal', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.45, r: rnd(14, 26), rgb: '255,70,80', life: 0.9, ang: rnd(-0.3, 0.3), t: -i * 0.04 });
    }
  }

  /** Lluvia de flechas: caen en tandas sobre el área. */
  arrowRain(x: number, y: number, r: number) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * r;
      this.add({ k: 'arrow', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.45, rgb: '255,250,230', life: 0.55, t: -i * 0.025 });
    }
    this.add({ k: 'wave', x, y, r, rgb: '255,250,230', life: 0.6, t: -0.3 });
  }

  /** Curación (Hilo de Vida, Vínculo): hilos de luz que suben y cruces que flotan. */
  heal(x: number, y: number, r: number, rgb: string) {
    this.add({ k: 'wave', x, y, r, rgb, life: 0.7 });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * r;
      this.spawn({ k: i % 3 ? 'mote' : 'plus', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.45, vy: rnd(-90, -50), life: rnd(0.7, 1.1), rgb, s: i % 3 ? 2.5 : 5 });
    }
  }

  /** Velo del Olvido: bocanada de humo violeta que te envuelve. */
  veil(x: number, y: number, rgb: string) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU;
      this.spawn({ k: 'smoke', x: x + Math.cos(a) * 14, y: y - 30 + Math.sin(a) * 18, vx: Math.cos(a) * rnd(30, 70), vy: Math.sin(a) * rnd(20, 50) - 20, life: rnd(0.6, 1), s: rnd(10, 18), rgb: '60,40,80', drag: 1.5 });
    }
    this.burst(x, y - 30, 10, 'mote', rgb, [40, 120], [0.4, 0.8]);
  }

  /** Escuchar al Viento: anillos de viento que se abren y hojas que giran. */
  wind(x: number, y: number, rgb: string) {
    for (let i = 0; i < 3; i++) this.add({ k: 'windring', x, y: y - 20, r: 220 + i * 60, rgb, life: 0.9, t: -i * 0.12 });
    this.burst(x, y - 30, 10, 'leaf', '170,220,180', [80, 180], [0.7, 1.1], undefined, TAU, { vr: 8, drag: 1 });
  }

  /** Ráfaga: cono de viento con trazos de velocidad. */
  gust(x: number, y: number, dx: number, dy: number, r: number, angDeg: number, rgb: string) {
    this.add({ k: 'gust', x, y: y - 20, dx, dy, r, ang: angDeg, rgb, life: 0.4 });
    this.burst(x, y - 20, 10, 'leaf', '170,220,180', [180, 320], [0.4, 0.7], Math.atan2(dy, dx), (angDeg * Math.PI) / 180, { vr: 10, drag: 1.5 });
  }

  /** Siega: giro completo de la guadaña, con pétalos que se cierran hacia el centro. */
  spin(x: number, y: number, r: number, rgb: string) {
    this.add({ k: 'spin', x, y: y - 20, r, rgb, life: 0.42, w: 22 });
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU;
      this.spawn({ k: 'petal', x: x + Math.cos(a) * r, y: y - 20 + Math.sin(a) * r * 0.5, vx: -Math.cos(a) * r * 1.6, vy: -Math.sin(a) * r * 0.8, life: 0.6, rgb: '230,60,90', vr: 8, drag: 2.5, s: 4 });
    }
    this.shake = Math.max(this.shake, 4);
  }

  // ------------------------------------------------------------------ dibujo

  /** Grietas bajo los personajes (antes que ellos). */
  drawGround(g: G) {
    for (const f of this.fx) {
      if (f.k !== 'cracks' || !f.cr || f.t < 0) continue;
      const a = Math.max(0, 1 - f.t / f.life);
      g.lineCap = 'round';
      for (const p of f.cr) { g.strokeStyle = `rgba(10,6,12,${a * 0.8})`; g.lineWidth = 5; g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (const q of p) g.lineTo(q[0], q[1]); g.stroke(); }
    }
  }

  draw(g: G, dt: number) {
    g.save();
    for (const f of this.fx) {
      f.t += dt;
      if (f.t < 0) continue;
      const u = Math.min(1, f.t / f.life), a = 1 - u;
      switch (f.k) {
        case 'slash': this.drawSlash(g, f, u); break;
        case 'thrust': {
          const a0 = Math.atan2(f.dy, f.dx), L = f.r * ease(Math.min(1, u * 3));
          g.save(); g.translate(f.x, f.y); g.rotate(a0);
          for (const [w, col, al] of [[f.w, f.rgb, 0.75], [f.w * 0.4, '255,255,255', 0.95]] as const) {
            g.fillStyle = `rgba(${col},${al * a})`; g.beginPath(); g.moveTo(0, -w / 2); g.quadraticCurveTo(L * 0.6, -w / 2, L, 0); g.quadraticCurveTo(L * 0.6, w / 2, 0, w / 2); g.closePath(); g.fill();
          }
          for (let i = 0; i < 3; i++) { g.strokeStyle = `rgba(${f.rgb},${0.6 * a})`; g.lineWidth = 2; const yy = (i - 1) * f.w * 0.9; g.beginPath(); g.moveTo(L * 0.2 - u * 30, yy); g.lineTo(L * 0.7 - u * 30, yy); g.stroke(); }
          g.restore();
          glow(g, f.x + Math.cos(a0) * L, f.y + Math.sin(a0) * L, 26 * a + 6, f.rgb, 0.8 * a);
          break;
        }
        case 'muzzle': {
          const a0 = Math.atan2(f.dy, f.dx), R = f.r * (0.6 + 0.6 * u);
          glow(g, f.x, f.y, R * 1.4, f.rgb, a);
          g.save(); g.translate(f.x, f.y); g.rotate(a0); g.fillStyle = `rgba(255,250,235,${a})`;
          g.beginPath(); g.moveTo(0, -R * 0.35); g.lineTo(R * 1.3, 0); g.lineTo(0, R * 0.35); g.lineTo(R * 0.4, 0); g.closePath(); g.fill(); g.restore();
          break;
        }
        case 'star': {
          const R = f.r * (0.5 + ease(u) * 0.8);
          glow(g, f.x, f.y, R * 1.6, f.rgb, a * 0.9);
          g.save(); g.translate(f.x, f.y); g.rotate(f.ang); g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath();
          for (let i = 0; i < 8; i++) { const rr = i % 2 ? R * 0.22 : R, q = (i / 8) * TAU; g.lineTo(Math.cos(q) * rr, Math.sin(q) * rr); }
          g.closePath(); g.fill(); g.restore();
          break;
        }
        case 'ring': case 'wave': case 'windring': {
          const R = f.r * ease(u), flat = f.k === 'ring' ? 1 : 0.42;
          g.save(); g.translate(f.x, f.y); g.scale(1, flat);
          g.strokeStyle = `rgba(${f.rgb},${a * (f.k === 'windring' ? 0.5 : 0.85)})`; g.lineWidth = (f.k === 'wave' ? 10 : 5) * a + 1.5;
          if (f.k === 'windring') { g.setLineDash([26, 18]); g.lineDashOffset = -u * 80; }
          g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke(); g.setLineDash([]); g.restore();
          break;
        }
        case 'line': {
          g.strokeStyle = `rgba(${f.rgb},${0.6 * a})`; g.lineWidth = 3; g.setLineDash([6, 10]);
          g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(f.x2 ?? f.x, f.y2 ?? f.y); g.stroke(); g.setLineDash([]);
          break;
        }
        case 'cracks':
          for (const p of f.cr ?? []) { g.strokeStyle = `rgba(${f.rgb},${a})`; g.lineWidth = 2.4; g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (const q of p) g.lineTo(q[0], q[1]); g.stroke(); }
          glow(g, f.x, f.y, 50, f.rgb, 0.4 * a);
          break;
        case 'crystal': {
          const h = f.r * ease(Math.min(1, u * 4)), fade = u > 0.7 ? (1 - u) / 0.3 : 1;
          g.save(); g.translate(f.x, f.y); g.rotate(f.ang); g.globalAlpha = fade;
          glow(g, 0, -h * 0.5, h, f.rgb, 0.5);
          g.fillStyle = '#d0303c'; g.strokeStyle = INK; g.lineWidth = 2;
          g.beginPath(); g.moveTo(-h * 0.25, 0); g.lineTo(0, -h); g.lineTo(h * 0.25, 0); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#ff9aa8'; g.beginPath(); g.moveTo(0, -h); g.lineTo(h * 0.25, 0); g.lineTo(h * 0.05, 0); g.closePath(); g.fill();
          g.restore(); g.globalAlpha = 1;
          break;
        }
        case 'arrow': {
          // Cae desde arriba en diagonal y se clava.
          const fall = Math.min(1, u * 2.2), h = (1 - ease(fall)) * 160, sx = f.x - h * 0.35, sy = f.y - h;
          if (fall < 1) {
            g.strokeStyle = `rgba(255,250,230,${0.4 + 0.5 * fall})`; g.lineWidth = 2; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - 12, sy - 34); g.stroke();
            glow(g, sx, sy, 10, f.rgb, 0.8);
          } else {
            const fade = 1 - (u - 0.45) / 0.55;
            g.strokeStyle = `rgba(230,220,200,${fade})`; g.lineWidth = 2.5; g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(f.x - 6, f.y - 16); g.stroke();
            if (u < 0.55) glow(g, f.x, f.y, 16, f.rgb, 0.8);
          }
          break;
        }
        case 'dash': {
          const a0 = Math.atan2(f.dy, f.dx), L = f.r;
          g.save(); g.translate(f.x, f.y); g.rotate(a0);
          for (let i = 0; i < 5; i++) {
            const yy = (i - 2) * 9, s = L * (0.4 + 0.6 * Math.random());
            g.strokeStyle = `rgba(${f.rgb},${0.55 * a})`; g.lineWidth = i === 2 ? 6 : 2.5;
            g.beginPath(); g.moveTo(L * u * 0.5, yy); g.lineTo(L * u * 0.5 + s * (1 - u), yy); g.stroke();
          }
          g.restore();
          break;
        }
        case 'gust': {
          const a0 = Math.atan2(f.dy, f.dx), half = (f.ang * Math.PI) / 360, R = f.r * ease(u);
          for (let i = 0; i < 6; i++) {
            const q = a0 - half + (i + 0.5) * ((2 * half) / 6);
            g.strokeStyle = `rgba(${f.rgb},${0.65 * a})`; g.lineWidth = 3;
            g.beginPath(); g.arc(f.x, f.y, R * (0.6 + 0.08 * i), q - 0.12, q + 0.12); g.stroke();
          }
          break;
        }
        case 'spin': {
          const sweep = TAU * ease(Math.min(1, u * 2.5)), start = -Math.PI / 2;
          g.save(); g.translate(f.x, f.y); g.scale(1, 0.55);
          for (const [w, col, al] of [[f.w, f.rgb, 0.7], [f.w * 0.4, '255,255,255', 0.9]] as const) {
            g.strokeStyle = `rgba(${col},${al * a})`; g.lineWidth = w * a + 2; g.lineCap = 'round';
            g.beginPath(); g.arc(0, 0, f.r, start, start + sweep); g.stroke();
          }
          g.restore();
          break;
        }
      }
    }
    compact(this.fx, (f) => f.t < f.life);
    for (const p of this.parts) {
      p.t += dt;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vy = p.vy * dr + p.gr * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.ground !== undefined && p.y > p.ground) { p.y = p.ground; p.vy *= -0.3; p.vx *= 0.5; p.vr *= 0.5; }
      const a = Math.max(0, 1 - p.t / p.life);
      switch (p.k) {
        case 'spark': g.strokeStyle = `rgba(${p.rgb},${a})`; g.lineWidth = p.s * 0.8; g.lineCap = 'round'; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); g.stroke(); break;
        case 'ember': glow(g, p.x, p.y, p.s * 3, p.rgb, a); g.fillStyle = `rgba(255,240,200,${a})`; g.fillRect(p.x - 1, p.y - 1, 2, 2); break;
        case 'mote': glow(g, p.x, p.y, p.s * 3, p.rgb, a * 0.9); break;
        case 'shard': g.save(); g.translate(p.x, p.y); g.rotate(Math.atan2(p.vy, p.vx)); g.fillStyle = `rgba(${p.rgb},${a})`; g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -2); g.lineTo(-4, 2); g.closePath(); g.fill(); g.restore(); break;
        case 'petal': case 'leaf':
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = `rgba(${p.rgb},${a})`; g.strokeStyle = `rgba(13,8,11,${a})`; g.lineWidth = 1.2;
          g.beginPath(); g.ellipse(0, 0, p.s * 1.4, p.s * 0.7, 0, 0, TAU); g.fill(); g.stroke(); g.restore(); break;
        case 'plus':
          g.save(); g.translate(p.x, p.y); glow(g, 0, 0, 14, p.rgb, a * 0.7); g.fillStyle = `rgba(${p.rgb},${a})`;
          g.fillRect(-p.s, -1.6, p.s * 2, 3.2); g.fillRect(-1.6, -p.s, 3.2, p.s * 2); g.restore(); break;
        case 'smoke': g.fillStyle = `rgba(${p.rgb},${a * 0.45})`; g.beginPath(); g.arc(p.x, p.y, p.s * (1 + p.t * 1.5), 0, TAU); g.fill(); break;
        case 'dust': g.fillStyle = `rgba(${p.rgb},${a * 0.4})`; g.beginPath(); g.ellipse(p.x, p.y, p.s * (1 + p.t * 2), p.s * 0.6 * (1 + p.t), 0, 0, TAU); g.fill(); break;
        case 'rock':
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, a * 3); g.fillStyle = `rgb(${p.rgb})`; g.strokeStyle = INK; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(-p.s, -p.s * 0.6); g.lineTo(p.s * 0.7, -p.s); g.lineTo(p.s, p.s * 0.4); g.lineTo(-p.s * 0.3, p.s); g.closePath(); g.fill(); g.stroke(); g.restore(); g.globalAlpha = 1; break;
      }
    }
    compact(this.parts, (p) => p.t < p.life);
    g.restore();
  }

  /** Media luna del barrido: se abre rápido (un tercio de su vida) y luego se desvanece. */
  private drawSlash(g: G, f: Fx, u: number) {
    const a0 = Math.atan2(f.dy, f.dx), half = ((f.ang * Math.PI) / 180) / 2, dir = f.n === -1 ? -1 : 1;
    const open = ease(Math.min(1, u * 3)), fade = u < 0.33 ? 1 : 1 - (u - 0.33) / 0.67;
    const s0 = a0 - half * dir, s1 = s0 + 2 * half * dir * open, N = 18;
    g.save(); g.translate(f.x, f.y);
    for (const [wk, col, al] of [[1, f.rgb, 0.8], [0.45, '255,255,255', 0.95]] as const) {
      g.beginPath();
      for (let i = 0; i <= N; i++) { const q = s0 + (s1 - s0) * (i / N); g.lineTo(Math.cos(q) * f.r, Math.sin(q) * f.r); }
      for (let i = N; i >= 0; i--) {
        const v = i / N, q = s0 + (s1 - s0) * v, w = f.w * wk * Math.sin(Math.PI * Math.min(1, v * 1.15)) * (0.4 + 0.6 * v);
        g.lineTo(Math.cos(q) * (f.r - w), Math.sin(q) * (f.r - w));
      }
      g.closePath(); g.fillStyle = `rgba(${col},${al * fade})`; g.fill();
    }
    // Líneas de velocidad por detrás del filo.
    g.strokeStyle = `rgba(${f.rgb},${0.5 * fade})`; g.lineWidth = 2;
    for (let i = 1; i <= 2; i++) { g.beginPath(); g.arc(0, 0, f.r * (1 - 0.18 * i), s0, s0 + (s1 - s0) * 0.8, dir < 0); g.stroke(); }
    g.restore();
  }
}
