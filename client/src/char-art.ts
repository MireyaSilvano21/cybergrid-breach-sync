/**
 * Personajes con el arte de Astra (lote 2): cuerpo Medio, 8 ropas y 6 cabezas.
 * Las piezas vienen ya recortadas y reducidas (tools/personajes.py) con su lugar en el lienzo y el
 * orden de dibujo por vista. Se cargan solo las de la apariencia que se usa; mientras llegan,
 * el juego dibuja la versión provisional.
 */
import type { Appearance, BoneId, JointSet, View } from '@shared/index';

interface PieceInfo { f: string; x: number; y: number; w: number; h: number }
interface Manifest {
  escala: number;
  rig: Record<View, JointSet>;
  cuerpo: Record<View, Record<string, PieceInfo>>;
  ropas: Record<string, Record<View, { orden: string[]; piezas: Record<string, PieceInfo> }>>;
  cabezas: Record<string, Record<View, Record<string, PieceInfo>>>;
}
export interface ArtLayer { bone: BoneId; img: HTMLImageElement; x: number; y: number; w: number; h: number }
/** Capas listas para dibujar y dónde va el arma (índice de la lista después del cual se dibuja). */
export interface CharArt { joints: JointSet; layers: ArtLayer[]; weaponAt: number }

const BASE = '/assets/personajes/';
const BONE: Record<string, BoneId> = {
  torso: 'torso', cuello: 'torso', cuello_ropa: 'torso', cadera: 'pelvis', faja: 'pelvis', falda: 'skirt', capa: 'cape',
  muslo_L: 'thighL', muslo_R: 'thighR', pierna_L: 'shinL', pierna_R: 'shinR', pie_L: 'footL', pie_R: 'footR',
  brazo_L: 'upperArmL', brazo_R: 'upperArmR', antebrazo_L: 'forearmL', antebrazo_R: 'forearmR', mano_L: 'handL', mano_R: 'handR',
  cabeza: 'head', pelo_atras: 'head', pelo_frente: 'head',
};

let manifest: Manifest | null = null, loading = false;
const images = new Map<string, HTMLImageElement>();
const ready = new Map<string, CharArt | 'cargando'>();

function loadManifest() {
  if (loading || manifest || typeof fetch === 'undefined') return;
  loading = true;
  fetch(`${BASE}manifest.json`).then((r) => (r.ok ? r.json() : null)).then((m) => { manifest = m; }).catch(() => {}).finally(() => { loading = false; });
}

function img(f: string) {
  let i = images.get(f);
  if (!i) { i = new Image(); i.decoding = 'async'; i.src = BASE + f; images.set(f, i); }
  return i;
}

/** Arma la lista de capas de una apariencia en una vista (cuerpo y ropa por ranura, luego la cabeza). */
function build(m: Manifest, app: Appearance, view: View): { art: CharArt; imgs: HTMLImageElement[] } | null {
  const ropa = m.ropas[app.outfit]?.[view], body = m.cuerpo[view], head = m.cabezas[app.head]?.[view];
  if (!ropa || !body || !head) return null;
  const layers: ArtLayer[] = [], imgs: HTMLImageElement[] = [];
  const push = (name: string, p: PieceInfo | undefined) => {
    if (!p || !BONE[name]) return;
    const i = img(p.f); imgs.push(i);
    layers.push({ bone: BONE[name], img: i, x: p.x, y: p.y, w: p.w, h: p.h });
  };
  // De frente y de lado el pelo de atrás queda detrás de todo; de espaldas va con la cabeza.
  if (view !== 'back') push('pelo_atras', head.pelo_atras);
  let weaponAt = -1;
  for (const slot of ropa.orden) {
    if (slot === 'cabeza') {
      // De espaldas el pelo cubre la cabeza: primero la cabeza (orejas y nuca) y el pelo encima.
      if (view === 'back') { push('cabeza', head.cabeza); push('pelo_frente', head.pelo_frente); push('pelo_atras', head.pelo_atras); }
      else { push('cabeza', head.cabeza); push('pelo_frente', head.pelo_frente); }
      continue;
    }
    // La piel del cuerpo va debajo de la prenda de la misma ranura (tapa huecos al doblar).
    push(slot, body[slot]);
    push(slot, ropa.piezas[slot]);
    if (view === 'front' && (slot === 'mano_L' || slot === 'mano_R')) weaponAt = layers.length - 1;
  }
  if (view === 'back') weaponAt = -1;
  else if (view === 'side') weaponAt = layers.length - 1;
  return { art: { joints: m.rig[view], layers, weaponAt }, imgs };
}

/** Arte listo para esta apariencia y vista, o null mientras carga (la primera llamada empieza la carga). */
export function charArt(app: Appearance, view: View): CharArt | null {
  if (!manifest) { loadManifest(); return null; }
  const key = `${app.outfit}|${app.head}|${view}`, hit = ready.get(key);
  if (hit && hit !== 'cargando') return hit;
  if (hit) return null;
  const b = build(manifest, app, view);
  if (!b) return null;
  ready.set(key, 'cargando');
  Promise.all(b.imgs.map((i) => (i.complete && i.naturalWidth ? Promise.resolve() : i.decode().catch(() => {}))))
    .then(() => ready.set(key, b.art));
  return null;
}

/** Precarga el manifiesto (al entrar al campamento). */
export function preloadCharArt() { loadManifest(); }
