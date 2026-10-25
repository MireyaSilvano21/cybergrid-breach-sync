/**
 * Arte final de los Focos (entrega v01 de Astra): arma en la mano y su capa de brillo.
 * Cada PNG viene vertical, punta arriba, con el punto de agarre en armas.json. Al cargarse,
 * se reducen una sola vez a un tamaño cercano al de pantalla para no escalar imágenes grandes
 * en cada cuadro (importa en celular). Mientras cargan, el juego usa las formas provisionales.
 */
type Ctx = CanvasRenderingContext2D;

interface Meta {
  /** Punto de agarre y borde superior e inferior del dibujo, en píxeles del PNG. */
  grip: [number, number];
  top: number;
  bottom: number;
  /** Largo del arma respecto a la altura del personaje. */
  len: number;
}

const META: Record<string, Meta> = {
  daga: { grip: [106, 395], top: 21, bottom: 492, len: 0.34 },
  gemelas: { grip: [135, 418], top: 12, bottom: 496, len: 0.5 },
  revolver: { grip: [163, 421], top: 12, bottom: 499, len: 0.34 },
  llama: { grip: [133, 620], top: 38, bottom: 728, len: 0.66 },
  cetro_lunar: { grip: [104, 665], top: 13, bottom: 756, len: 0.9 },
  lanza: { grip: [134, 614], top: 13, bottom: 755, len: 1.1 },
  guadana: { grip: [339, 631], top: 23, bottom: 741, len: 1.0 },
  martillo: { grip: [186, 574], top: 53, bottom: 725, len: 0.82 },
  cetro_rubi: { grip: [126, 610], top: 12, bottom: 755, len: 0.9 },
  arco: { grip: [204, 382], top: 13, bottom: 755, len: 0.86 },
};

/** Alto en píxeles al que se reduce cada arma por cada 1.0 de largo (≈ el doble de lo que ocupa en pantalla). */
const PX_PER_LEN = 300;

export interface FocoArt { base: HTMLCanvasElement; glow: HTMLCanvasElement | null; gx: number; gy: number; px: number; len: number }
const cache = new Map<string, FocoArt | 'cargando' | 'error'>();

function shrink(img: HTMLImageElement, k: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function load(src: string) {
  return new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
}

/** Arte listo de un Foco, o null mientras carga (o si no hay arte). La primera llamada empieza la carga. */
export function focoArt(id: string): FocoArt | null {
  const hit = cache.get(id);
  if (hit && hit !== 'cargando' && hit !== 'error') return hit;
  const m = META[id];
  if (hit || !m || typeof document === 'undefined') return null;
  cache.set(id, 'cargando');
  const k = (m.len * PX_PER_LEN) / (m.bottom - m.top);
  Promise.all([load(`/assets/focos/foco_${id}.png`), load(`/assets/focos/foco_${id}_brillo.png`).catch(() => null)])
    .then(([b, gl]) => cache.set(id, { base: shrink(b, k), glow: gl ? shrink(gl, k) : null, gx: m.grip[0] * k, gy: m.grip[1] * k, px: m.len * PX_PER_LEN, len: m.len }))
    .catch(() => cache.set(id, 'error'));
  return null;
}

/**
 * Dibuja el arma con el agarre en (x, y) del espacio de la mano, punta hacia arriba.
 * H es la altura del personaje en esas unidades; mirror refleja (mano izquierda de las Gemelas).
 */
export function drawFocoArt(g: Ctx, a: FocoArt, x: number, y: number, H: number, mirror = false) {
  const s = (a.len * H) / a.px;
  g.save();
  g.translate(x, y);
  g.scale(mirror ? -s : s, s);
  g.drawImage(a.base, -a.gx, -a.gy);
  if (a.glow) {
    // La capa de brillo suma luz encima (emisión): runas, gemas y energía resaltan en lo oscuro.
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha *= 0.55;
    g.drawImage(a.glow, -a.gx, -a.gy);
  }
  g.restore();
}

/** Precarga todas las armas (por ejemplo, al entrar al campamento) para que no aparezcan tarde. */
export function preloadFocos() { for (const id of Object.keys(META)) focoArt(id); }
