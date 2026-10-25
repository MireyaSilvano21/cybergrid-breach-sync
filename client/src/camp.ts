/**
 * Escenas del campamento (Canvas 2D):
 * - CampScene: la escuadra de pie alrededor de una fogata, con nombres y lugares libres.
 * - PreviewScene: un personaje grande que gira entre sus tres vistas (Preparación).
 * Reusan el esqueleto y las piezas de rig.ts, así que se ven igual que en la partida.
 */
import { BODIES, animate, TEAMS, type Appearance, type View, type ActionKind } from '@shared/index';
import { drawCharacter } from './rig';
import { INK, Sprites } from './art';

export interface CampMember { id: string; name: string; app: Appearance; foco: string; leader: boolean; school: string }

const SLOTS = [{ x: 0.5, y: 0.86, s: 1 }, { x: 0.25, y: 0.8, s: 0.92 }, { x: 0.75, y: 0.8, s: 0.92 }];
let sprites: Sprites | null = null;

function fit(c: HTMLCanvasElement) {
  const dpr = Math.min(2, devicePixelRatio || 1), r = c.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { g: c.getContext('2d')!, w, h, dpr };
}

/** Suelo de losas en óvalo, ruinas al fondo y una fogata con piedras y troncos. */
function drawCamp(g: CanvasRenderingContext2D, w: number, h: number, sec: number) {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#120a1a'); sky.addColorStop(0.55, '#24182c'); sky.addColorStop(1, '#0d0710');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  // Ruinas: arcos oscuros al fondo.
  g.fillStyle = '#1a1222'; g.strokeStyle = INK; g.lineWidth = Math.max(2, w * 0.003);
  for (const [cx, aw, ah] of [[0.12, 0.13, 0.42], [0.36, 0.09, 0.3], [0.66, 0.1, 0.34], [0.9, 0.14, 0.46]]) {
    const x = cx * w, bw = aw * w, top = h * (0.62 - ah);
    g.beginPath(); g.moveTo(x - bw / 2, h * 0.62); g.lineTo(x - bw / 2, top + bw / 2); g.arc(x, top + bw / 2, bw / 2, Math.PI, 0); g.lineTo(x + bw / 2, h * 0.62);
    g.lineTo(x + bw * 0.28, h * 0.62); g.lineTo(x + bw * 0.28, top + bw * 0.55); g.arc(x, top + bw * 0.55, bw * 0.28, 0, Math.PI, true); g.lineTo(x - bw * 0.28, h * 0.62); g.closePath();
    g.fill(); g.stroke();
  }
  // Suelo.
  const cx = w / 2, cy = h * 0.74;
  g.fillStyle = '#3a3850'; g.beginPath(); g.ellipse(cx, cy, w * 0.56, h * 0.3, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(29,12,22,.55)'; g.lineWidth = Math.max(1.5, w * 0.002);
  for (let i = 0; i < 26; i++) {
    const a = (i * 2.399) % (Math.PI * 2), r = 0.15 + ((i * 37) % 80) / 100, sx = cx + Math.cos(a) * w * 0.48 * r, sy = cy + Math.sin(a) * h * 0.24 * r;
    g.fillStyle = i % 3 ? '#45435e' : '#4f4c68'; g.beginPath(); g.ellipse(sx, sy, w * 0.035, h * 0.022, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  // Fogata.
  const fx = w / 2, fy = h * 0.6, u = Math.min(w, h) / 600;
  const glow = g.createRadialGradient(fx, fy - 30 * u, 0, fx, fy - 30 * u, 320 * u * (1 + Math.sin(sec * 9) * 0.03));
  glow.addColorStop(0, 'rgba(255,150,60,.55)'); glow.addColorStop(0.45, 'rgba(255,110,40,.18)'); glow.addColorStop(1, 'rgba(255,110,40,0)');
  g.globalCompositeOperation = 'lighter'; g.fillStyle = glow; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over';
  g.lineWidth = 3 * u;
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; g.fillStyle = i % 2 ? '#6c6878' : '#5a5668'; g.beginPath(); g.ellipse(fx + Math.cos(a) * 46 * u, fy + Math.sin(a) * 16 * u, 13 * u, 9 * u, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.stroke(); }
  for (const s of [-1, 1]) { g.save(); g.translate(fx, fy - 4 * u); g.rotate(s * 0.35); g.fillStyle = '#6b4226'; g.beginPath(); g.roundRect(-40 * u, -7 * u, 80 * u, 14 * u, 7 * u); g.fill(); g.strokeStyle = INK; g.stroke(); g.restore(); }
  const flame = sprites?.img.flame;
  if (flame) { const f = 1 + Math.sin(sec * 11) * 0.07 + Math.sin(sec * 23) * 0.04; g.save(); g.translate(fx, fy - 6 * u); g.scale((2.6 * u) / f, 2.6 * u * f); g.drawImage(flame, -16, -42, 32, 42); g.restore(); }
  for (let i = 0; i < 10; i++) {
    const k = (sec * 0.35 + i / 10) % 1, ex = fx + Math.sin(i * 7.3 + sec * 1.7) * 30 * u * k, ey = fy - 40 * u - k * 180 * u;
    g.fillStyle = `rgba(255,${160 + i * 8},90,${1 - k})`; g.beginPath(); g.arc(ex, ey, (2.5 - k) * u, 0, Math.PI * 2); g.fill();
  }
}

function nameplate(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, leader: boolean, sub?: string) {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${size}px "Alegreya Sans", sans-serif`;
  const label = leader ? `♛ ${text}` : text, tw = g.measureText(label).width + size * 1.2;
  g.fillStyle = 'rgba(29,12,22,.82)'; g.strokeStyle = leader ? '#e2b23e' : 'rgba(244,239,228,.35)'; g.lineWidth = Math.max(1.5, size * 0.12);
  g.beginPath(); g.roundRect(x - tw / 2, y - size * 0.8, tw, size * 1.6, size * 0.5); g.fill(); g.stroke();
  g.fillStyle = leader ? '#ffd36a' : '#f4efe4'; g.fillText(label, x, y + 1);
  if (sub) { g.font = `500 ${size * 0.78}px "Alegreya Sans", sans-serif`; g.fillStyle = 'rgba(244,239,228,.7)'; g.fillText(sub, x, y + size * 1.45); }
}

/** Campamento: la escuadra junto a la fogata. El jugador propio va al centro. */
export class CampScene {
  private members: CampMember[] = [];
  private greet = new Map<string, number>();
  private raf = 0; private running = false;
  constructor(private canvas: HTMLCanvasElement, private myId: () => string) { sprites ??= new Sprites(); }

  set(members: CampMember[]) {
    const now = performance.now();
    // Quien llega a la escuadra saluda levantando los brazos.
    for (const m of members) if (!this.members.some((x) => x.id === m.id) && this.members.length) this.greet.set(m.id, now);
    const me = members.find((m) => m.id === this.myId());
    this.members = me ? [me, ...members.filter((m) => m !== me)] : members;
  }

  start() { if (this.running) return; this.running = true; const loop = (t: number) => { if (!this.running) return; try { this.draw(t); } catch (e) { console.error(e); } this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  private draw(now: number) {
    const { g, w, h } = fit(this.canvas), sec = now / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0);
    drawCamp(g, w, h, sec);
    const order = [1, 2, 0]; // primero los de atrás, al final el del centro
    for (const i of order) {
      const slot = SLOTS[i], m = this.members[i], x = slot.x * w, y = slot.y * h, size = Math.max(11, h * 0.032);
      if (!m) {
        g.setLineDash([8, 7]); g.strokeStyle = 'rgba(244,239,228,.35)'; g.lineWidth = 2.5;
        g.beginPath(); g.ellipse(x, y, w * 0.06, h * 0.025, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        g.fillStyle = 'rgba(244,239,228,.45)'; g.font = `700 ${h * 0.09}px "Cabin Sketch", sans-serif`; g.textAlign = 'center'; g.fillText('+', x, y - h * 0.13);
        g.font = `500 ${size}px "Alegreya Sans", sans-serif`; g.fillText('Lugar libre', x, y + h * 0.05);
        continue;
      }
      const body = BODIES[m.app.body], view: View = i === 0 ? 'front' : 'front';
      const ga = this.greet.get(m.id), k = ga != null ? (now - ga) / 900 : 2;
      const action = k >= 0 && k < 1 ? { kind: 'cast' as ActionKind, k } : null;
      const pose = animate(view, { t: sec + i * 0.7, walk: 0, move: 0, action }, body);
      const s = (h * 0.5 * slot.s) / 1003;
      g.fillStyle = 'rgba(8,4,12,.45)'; g.beginPath(); g.ellipse(x, y, body.dims.shoulderW * s * 0.95, h * 0.022, 0, 0, Math.PI * 2); g.fill();
      drawCharacter(g, { x, y, view, flip: i === 2, app: m.app, pose, team: TEAMS[0].color, foco: m.foco, t: sec + i, scale: s });
      nameplate(g, m.name, x, y + h * 0.05, size, m.leader, m.school);
    }
  }
}

/** Vista previa de Preparación: el personaje gira entre frente, lado y espalda. */
export class PreviewScene {
  private app: Appearance | null = null; private foco = 'gemelas';
  private raf = 0; private running = false; private t0 = performance.now();
  view: View | null = null;
  constructor(private canvas: HTMLCanvasElement) { sprites ??= new Sprites(); }
  set(app: Appearance, foco: string) { this.app = app; this.foco = foco; this.t0 = performance.now(); }
  start() { if (this.running) return; this.running = true; const loop = (t: number) => { if (!this.running) return; try { this.draw(t); } catch (e) { console.error(e); } this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  private draw(now: number) {
    const { g, w, h } = fit(this.canvas), sec = now / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const bg = g.createRadialGradient(w / 2, h * 0.6, 0, w / 2, h * 0.6, Math.max(w, h) * 0.7);
    bg.addColorStop(0, '#3b2c46'); bg.addColorStop(1, '#130b18'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a2236'; g.beginPath(); g.ellipse(w / 2, h * 0.88, w * 0.32, h * 0.06, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
    if (!this.app) return;
    const views: View[] = ['front', 'side', 'back', 'side'];
    // El tiempo del cuadro puede ser un poco anterior a t0: se usa max(0) para no dar un índice negativo.
    const step = Math.floor(Math.max(0, now - this.t0) / 2600) % 4;
    const view = this.view ?? views[step];
    const flip = !this.view && step === 3;
    const body = BODIES[this.app.body], pose = animate(view, { t: sec, walk: 0, move: 0 }, body);
    drawCharacter(g, { x: w / 2, y: h * 0.88, view, flip, app: this.app, pose, team: TEAMS[0].color, foco: this.foco, t: sec, scale: (h * 0.74) / 1003 });
  }
}
