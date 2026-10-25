/** Visor del esqueleto: prueba cada combinación de cuerpo, ropa y cabeza con todas las animaciones. */
import { BODIES, BODY_IDS, HEAD_IDS, OUTFIT_IDS, animate, RIG_WORLD_SCALE, type ActionKind, type Appearance, type View } from '@shared/index';
import { drawCharacter, OUTFITS, HEADS } from './rig';

type Anim = 'quieto' | 'caminar' | ActionKind | 'morir';
const ANIMS: [Anim, string][] = [['quieto', 'Quieto'], ['caminar', 'Caminar'], ['melee', 'Golpe'], ['shoot', 'Disparo'], ['cast', 'Lanzar'], ['hit', 'Recibir golpe'], ['morir', 'Morir']];
const VIEWS_ES: [View | 'gira', string][] = [['front', 'Frente'], ['side', 'Lado'], ['back', 'Espalda'], ['gira', 'Girar']];
const FOCOS: [string, string][] = [['vara', 'Vara'], ['anillo', 'Anillo'], ['', 'Ninguno']];
const TEAM = '#ffb347';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const state = { anim: 'caminar' as Anim, view: 'gira' as View | 'gira', foco: 'vara', app: { body: 'medio', outfit: 'tharven_guardia', head: 'a' } as Appearance };

function seg<T extends string>(id: string, items: [T, string][], get: () => T, set: (v: T) => void) {
  const el = $(id);
  const render = () => { for (const b of el.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === get()); };
  for (const [v, label] of items) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.v = v; b.textContent = label;
    b.onclick = () => { set(v); render(); t0 = performance.now(); };
    el.append(b);
  }
  render();
}
function select(id: string, items: [string, string][], get: () => string, set: (v: string) => void) {
  const el = $<HTMLSelectElement>(id);
  for (const [v, label] of items) el.add(new Option(label, v));
  el.value = get(); el.onchange = () => set(el.value);
}

seg('anim', ANIMS, () => state.anim, (v) => (state.anim = v));
seg('view', VIEWS_ES, () => state.view, (v) => (state.view = v));
seg('foco', FOCOS, () => state.foco, (v) => (state.foco = v));
select('body', BODY_IDS.map((b) => [b, BODIES[b].name]), () => state.app.body, (v) => (state.app.body = v as Appearance['body']));
select('outfit', OUTFIT_IDS.map((o) => [o, `${OUTFITS[o].school} · ${OUTFITS[o].name}`]), () => state.app.outfit, (v) => (state.app.outfit = v as Appearance['outfit']));
select('head', HEAD_IDS.map((h) => [h, HEADS[h].name]), () => state.app.head, (v) => (state.app.head = v as Appearance['head']));

let t0 = performance.now();
const ACTION_MS: Record<string, number> = { melee: 520, shoot: 420, cast: 700, hit: 380, morir: 900 };

function animInput(anim: Anim, ms: number, sec: number) {
  if (anim === 'caminar') return { t: sec, walk: sec * 9, move: 1 };
  if (anim === 'quieto') return { t: sec, walk: 0, move: 0 };
  const dur = ACTION_MS[anim], cycle = dur + 600, k = (ms % cycle) / dur;
  if (anim === 'morir') return { t: sec, walk: 0, move: 0, die: Math.min(1, k) };
  return { t: sec, walk: 0, move: 0, action: k < 1 ? { kind: anim as ActionKind, k } : null };
}

function fit(c: HTMLCanvasElement) {
  const dpr = Math.min(2, devicePixelRatio || 1), r = c.getBoundingClientRect();
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { g: c.getContext('2d')!, w, h, dpr };
}

function floor(g: CanvasRenderingContext2D, w: number, h: number, y: number) {
  g.fillStyle = '#2a2538'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#4a4964'; g.fillRect(0, y, w, h - y);
  g.strokeStyle = '#1d0c16'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
}

function frame(now: number) {
  const ms = now - t0, sec = now / 1000;
  // Escenario grande: las tres vistas o una sola, con huesos.
  const S = fit($('stage'));
  const base = S.h * 0.86;
  floor(S.g, S.w, S.h, base);
  const views: View[] = state.view === 'gira' ? (['front', 'side', 'back'] as View[]) : [state.view];
  const scale = (S.h * 0.78) / 1100;
  views.forEach((v, i) => {
    const x = S.w * ((i + 0.5) / views.length), input = animInput(state.anim, ms, sec);
    const body = BODIES[state.app.body];
    const pose = animate(v, input, body);
    const ak = input.action?.kind === 'hit' ? 1 - input.action.k : 0;
    S.g.fillStyle = 'rgba(10,4,16,.35)'; S.g.beginPath(); S.g.ellipse(x, base, body.dims.shoulderW * scale * 0.9, 14 * S.dpr, 0, 0, 6.283); S.g.fill();
    drawCharacter(S.g, { x, y: base, view: v, flip: false, app: state.app, pose, team: TEAM, foco: state.foco || null, t: sec, flash: ak > 0.6 ? 1 : 0, debug: ($('bones') as HTMLInputElement).checked, scale });
  });

  // Galería al tamaño del juego (x2 para que se aprecie en pantallas densas).
  const G = fit($('gallery'));
  const gy = G.h * 0.8;
  floor(G.g, G.w, G.h, gy);
  const n = OUTFIT_IDS.length, k = (G.w / n), gs = RIG_WORLD_SCALE * 2 * G.dpr;
  OUTFIT_IDS.forEach((o, i) => {
    const app: Appearance = { outfit: o, body: BODY_IDS[i % 4], head: HEAD_IDS[i % HEAD_IDS.length] };
    const v: View = (['front', 'side', 'back', 'side'] as View[])[Math.floor(sec / 2.5 + i) % 4];
    const pose = animate(v, { t: sec + i, walk: sec * 9, move: i % 2 ? 1 : 0 }, BODIES[app.body]);
    drawCharacter(G.g, { x: k * (i + 0.5), y: gy, view: v, flip: i % 4 === 3, app, pose, team: i % 2 ? '#9a6bff' : TEAM, foco: i % 2 ? 'anillo' : 'vara', t: sec, scale: gs });
    G.g.fillStyle = '#efe4d2'; G.g.font = `${12 * G.dpr}px 'Alegreya Sans', sans-serif`; G.g.textAlign = 'center';
    G.g.fillText(OUTFITS[o].name, k * (i + 0.5), gy + 26 * G.dpr);
    G.g.fillStyle = '#a897b4'; G.g.fillText(BODIES[app.body].name, k * (i + 0.5), gy + 42 * G.dpr);
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
