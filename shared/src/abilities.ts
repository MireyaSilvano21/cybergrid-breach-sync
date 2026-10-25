import { TILE, PLAYER } from './constants';
import { moveCircle } from './physics';
import type { GridMap } from './map';

/**
 * Combate apuntado estilo Brawl Stars (GDD sección 7, revisado):
 * - El básico se apunta (clic o arrastre) y gasta una de 3 cargas que se recargan solas.
 * - Q y E son los Nombres de la escuela; R es la Inscripción del Foco en la mano.
 * - Al mantener, el cliente dibuja en el piso la forma y el alcance; al soltar, sale.
 * - Dos Focos con cambio rápido (Espacio). La munición es una sola para los dos.
 * Alcances en casillas, tiempos en segundos o milisegundos (se indica), daño en puntos de vida.
 */
export type ShapeType = 'linea' | 'cono' | 'zona' | 'propio' | 'salto';
export type Slot = 'Q' | 'E' | 'R';

/** Forma que se dibuja al apuntar y que el servidor usa para decidir a quién toca. */
export interface Shape {
  type: ShapeType;
  /** Alcance en casillas (en 'propio' es 0). */
  range: number;
  /** Ancho de la línea en casillas. */
  width?: number;
  /** Apertura del cono en grados. */
  angle?: number;
  /** Radio en casillas (zona y propio). */
  radius?: number;
}

/** Efectos que aplica al tocar. */
export interface Effect {
  dmg?: number; heal?: number;
  slowMs?: number; rootMs?: number;
  /** Empuje en casillas. */
  knock?: number;
  invisMs?: number;
  revealMs?: number; revealR?: number;
}

export type Delivery = 'proyectil' | 'instante' | 'embestida' | 'parpadeo';
export interface ProjectileDef { speed: number; radius: number; count?: number; spreadDeg?: number; pierce?: boolean }

export interface AbilityDef {
  id: string; name: string; desc: string;
  shape: Shape; delivery: Delivery;
  /** Recarga en segundos. */
  cd: number;
  effect: Effect;
  projectile?: ProjectileDef;
  /** A quién afecta el área: rivales (por defecto) o aliados (curaciones). */
  targets?: 'rivales' | 'aliados';
  /** Color de magia del efecto (r,g,b). */
  rgb: string;
}

export interface BasicDef {
  shape: Shape; delivery: 'proyectil' | 'instante';
  dmg: number;
  /** Tiempo mínimo entre disparos y lo que tarda en recargarse una carga (ms). */
  intervalMs: number; reloadMs: number;
  projectile?: ProjectileDef;
  effect?: Effect;
}

export interface FocoDef { id: string; name: string; desc: string; melee: boolean; color: string; rgb: string; basic: BasicDef; insc: AbilityDef }
export interface NombreDef extends AbilityDef { school: string }

export const AMMO_MAX = 3;
export const GCD_MS = 300;
export const SWAP_MS = 500;
export const DASH_S = 0.25;
export const SLOW_MUL = 0.6;
/** Multiplicador de velocidad para recorrer `tiles` casillas en DASH_S segundos. */
export const dashMulFor = (tiles: number) => (tiles * TILE) / DASH_S / PLAYER.speed;
/** Embestida estándar (Llamar a la Piedra): 4 casillas. */
export const DASH_MUL = dashMulFor(4);

const P = (speed: number, radius: number, extra: Partial<ProjectileDef> = {}): ProjectileDef => ({ speed, radius, ...extra });

export const FOCOS: Record<string, FocoDef> = {
  vara: {
    id: 'vara', name: 'Vara de Fresno', desc: 'Golpe en arco frente a ti.', melee: true, color: '#c98a4a', rgb: '255,190,90',
    basic: { shape: { type: 'cono', range: 1.7, angle: 110 }, delivery: 'instante', dmg: 16, intervalMs: 450, reloadMs: 1100 },
    insc: { id: 'barrido', name: 'Barrido', desc: 'Giro que golpea y empuja a todos alrededor.', shape: { type: 'propio', range: 0, radius: 2.5 }, delivery: 'instante', cd: 10, effect: { dmg: 18, knock: 2 }, rgb: '255,190,90' },
  },
  anillo: {
    id: 'anillo', name: 'Anillo de Ámbar', desc: 'Disparo de ámbar a distancia.', melee: false, color: '#ffb347', rgb: '255,180,70',
    basic: { shape: { type: 'linea', range: 7, width: 0.35 }, delivery: 'proyectil', dmg: 10, intervalMs: 320, reloadMs: 900, projectile: P(950, 10) },
    insc: { id: 'andanada', name: 'Andanada', desc: 'Cinco proyectiles en abanico.', shape: { type: 'cono', range: 8, angle: 40 }, delivery: 'proyectil', cd: 10, effect: { dmg: 7 }, projectile: P(900, 8, { count: 5, spreadDeg: 40 }), rgb: '255,180,70' },
  },
  martillo: {
    id: 'martillo', name: 'Martillo de Basalto', desc: 'Golpe pesado y amplio, lento.', melee: true, color: '#7c7d8c', rgb: '255,140,60',
    basic: { shape: { type: 'cono', range: 1.9, angle: 130 }, delivery: 'instante', dmg: 24, intervalMs: 750, reloadMs: 1500 },
    insc: { id: 'fractura', name: 'Fractura', desc: 'Grieta que avanza en línea, atraviesa y ralentiza.', shape: { type: 'linea', range: 6, width: 1.2 }, delivery: 'proyectil', cd: 11, effect: { dmg: 14, slowMs: 1600 }, projectile: P(620, 34, { pierce: true }), rgb: '255,140,60' },
  },
  daga: {
    id: 'daga', name: 'Daga de Ceniza', desc: 'Cortes cortos y muy rápidos.', melee: true, color: '#9a8aa8', rgb: '210,170,255',
    basic: { shape: { type: 'cono', range: 1.3, angle: 80 }, delivery: 'instante', dmg: 9, intervalMs: 240, reloadMs: 700 },
    insc: { id: 'corte', name: 'Corte espectral', desc: 'Embestida corta que corta a quien atraviesa.', shape: { type: 'salto', range: 3.5 }, delivery: 'embestida', cd: 9, effect: { dmg: 16 }, rgb: '210,170,255' },
  },
  arco: {
    id: 'arco', name: 'Arco de Fresno', desc: 'Flecha de largo alcance.', melee: false, color: '#8a6a3c', rgb: '255,230,150',
    basic: { shape: { type: 'linea', range: 9, width: 0.3 }, delivery: 'proyectil', dmg: 15, intervalMs: 600, reloadMs: 1400, projectile: P(1150, 8) },
    insc: { id: 'lluvia', name: 'Lluvia de flechas', desc: 'Área a distancia que daña a todos dentro.', shape: { type: 'zona', range: 8, radius: 2.2 }, delivery: 'instante', cd: 12, effect: { dmg: 18 }, rgb: '255,230,150' },
  },
  orbe: {
    id: 'orbe', name: 'Orbe de Hilo', desc: 'Esfera lenta y grande, fácil de acertar.', melee: false, color: '#8fae84', rgb: '140,255,170',
    basic: { shape: { type: 'linea', range: 6, width: 0.45 }, delivery: 'proyectil', dmg: 9, intervalMs: 400, reloadMs: 1000, projectile: P(700, 14) },
    insc: { id: 'vinculo', name: 'Vínculo', desc: 'Área que cura a tus aliados (y a ti).', shape: { type: 'zona', range: 6, radius: 2.5 }, delivery: 'instante', cd: 13, effect: { heal: 30 }, targets: 'aliados', rgb: '140,255,170' },
  },
  campana: {
    id: 'campana', name: 'Campana del Viento', desc: 'Onda corta y ancha.', melee: false, color: '#7fd6e0', rgb: '150,230,255',
    basic: { shape: { type: 'cono', range: 3, angle: 70 }, delivery: 'instante', dmg: 12, intervalMs: 550, reloadMs: 1200 },
    insc: { id: 'eco', name: 'Eco', desc: 'Repique que daña y aleja a quien esté cerca.', shape: { type: 'propio', range: 0, radius: 3 }, delivery: 'instante', cd: 11, effect: { dmg: 8, knock: 2.5 }, rgb: '150,230,255' },
  },
  grimorio: {
    id: 'grimorio', name: 'Grimorio Vacío', desc: 'Página que atraviesa a todos en su línea.', melee: false, color: '#c9a8f0', rgb: '200,150,255',
    basic: { shape: { type: 'linea', range: 7.5, width: 0.4 }, delivery: 'proyectil', dmg: 11, intervalMs: 500, reloadMs: 1200, projectile: P(820, 12, { pierce: true }) },
    insc: { id: 'grieta', name: 'Grieta', desc: 'Área a distancia que daña y ralentiza.', shape: { type: 'zona', range: 7, radius: 2 }, delivery: 'instante', cd: 12, effect: { dmg: 14, slowMs: 2000 }, rgb: '200,150,255' },
  },
};

export const NOMBRES: Record<string, NombreDef> = {
  // Tharvén · asalto
  llamar_piedra: { id: 'llamar_piedra', school: 'tharven', name: 'Llamar a la Piedra', desc: 'Embestida que daña y empuja a quien choca.', shape: { type: 'salto', range: 4 }, delivery: 'embestida', cd: 12, effect: { dmg: 12, knock: 2 }, rgb: '255,140,60' },
  temblor: { id: 'temblor', school: 'tharven', name: 'Temblor', desc: 'Onda alrededor que daña y ralentiza.', shape: { type: 'propio', range: 0, radius: 3 }, delivery: 'instante', cd: 14, effect: { dmg: 8, slowMs: 2500 }, rgb: '255,140,60' },
  // Seléth · sigilo
  velo: { id: 'velo', school: 'seleth', name: 'Velo del Olvido', desc: 'Te vuelves invisible para los rivales 3.5 s (atacar te descubre).', shape: { type: 'propio', range: 0, radius: 0.6 }, delivery: 'instante', cd: 16, effect: { invisMs: 3500 }, targets: 'aliados', rgb: '200,150,255' },
  paso: { id: 'paso', school: 'seleth', name: 'Paso sin Nombre', desc: 'Apareces unas casillas más allá (no atraviesa muros).', shape: { type: 'salto', range: 4.5 }, delivery: 'parpadeo', cd: 11, effect: {}, rgb: '200,150,255' },
  // Vaerel · soporte
  hilo_vida: { id: 'hilo_vida', school: 'vaerel', name: 'Hilo de Vida', desc: 'Cura a los aliados en el área (incluido tú).', shape: { type: 'zona', range: 6, radius: 2.5 }, delivery: 'instante', cd: 12, effect: { heal: 25 }, targets: 'aliados', rgb: '140,255,170' },
  atadura: { id: 'atadura', school: 'vaerel', name: 'Atadura', desc: 'Hilo que inmoviliza al primer rival que toca.', shape: { type: 'linea', range: 7, width: 0.45 }, delivery: 'proyectil', cd: 13, effect: { dmg: 6, rootMs: 1300 }, projectile: P(900, 13), rgb: '140,255,170' },
  // Orrath · reconocimiento
  escuchar: { id: 'escuchar', school: 'orrath', name: 'Escuchar al Viento', desc: 'Revela a los rivales cercanos a tu equipo por 4 s, aunque haya muros.', shape: { type: 'propio', range: 0, radius: 14 }, delivery: 'instante', cd: 15, effect: { revealMs: 4000, revealR: 14 }, targets: 'aliados', rgb: '150,230,255' },
  rafaga: { id: 'rafaga', school: 'orrath', name: 'Ráfaga', desc: 'Cono de viento que daña y empuja.', shape: { type: 'cono', range: 3.5, angle: 70 }, delivery: 'instante', cd: 11, effect: { dmg: 10, knock: 2.5 }, rgb: '150,230,255' },
};

export interface Build { school: string; nombres: [string, string]; focos: [string, string] }
/** Build de prueba: Tharvén con un Foco cuerpo a cuerpo y uno a distancia. */
export const DEFAULT_BUILD: Build = { school: 'tharven', nombres: ['llamar_piedra', 'temblor'], focos: ['vara', 'anillo'] };

/** Habilidad que corresponde a cada tecla según el build y el Foco en la mano. */
export function abilityFor(build: Build, foco: 0 | 1, slot: Slot): AbilityDef {
  if (slot === 'Q') return NOMBRES[build.nombres[0]];
  if (slot === 'E') return NOMBRES[build.nombres[1]];
  return FOCOS[build.focos[foco]].insc;
}

/** Punto de destino: se recorta al alcance máximo. */
export function clampAim(from: { x: number; y: number }, to: { x: number; y: number }, rangeTiles: number) {
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1, max = rangeTiles * TILE;
  const k = Math.min(1, max / d);
  return { x: from.x + dx * k, y: from.y + dy * k, dirX: dx / d, dirY: dy / d };
}

/** Direcciones de un abanico centrado en la dirección apuntada. */
export function fanDirections(dirX: number, dirY: number, count = 1, spreadRad = 0): [number, number][] {
  const a0 = Math.atan2(dirY, dirX);
  return Array.from({ length: count }, (_, i) => {
    const a = a0 + (count === 1 ? 0 : -spreadRad / 2 + (spreadRad * i) / (count - 1));
    return [Math.cos(a), Math.sin(a)];
  });
}

/** ¿Está el punto dentro del cono? (alcance en casillas más el radio del cuerpo) */
export function inCone(o: { x: number; y: number }, dirX: number, dirY: number, p: { x: number; y: number }, rangeTiles: number, angleDeg: number, bodyR = PLAYER.radius): boolean {
  const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy);
  if (d > rangeTiles * TILE + bodyR) return false;
  if (d < bodyR) return true;
  const dot = (dx * dirX + dy * dirY) / d;
  // El borde del cono se ensancha un poco con el radio del cuerpo, como en Brawl Stars.
  const half = (angleDeg / 2) * (Math.PI / 180) + Math.asin(Math.min(1, bodyR / d));
  return dot >= Math.cos(Math.min(Math.PI, half));
}

/** Destino del parpadeo: avanza en pasos cortos y se detiene antes del primer obstáculo (no atraviesa muros). */
export function blinkTarget(map: GridMap, from: { x: number; y: number }, to: { x: number; y: number }, rangeTiles: number) {
  const aim = clampAim(from, to, rangeTiles), total = Math.hypot(aim.x - from.x, aim.y - from.y);
  const steps = Math.max(1, Math.ceil(total / 8)), sx = (aim.x - from.x) / steps, sy = (aim.y - from.y) / steps;
  let p = { x: from.x, y: from.y };
  for (let i = 0; i < steps; i++) {
    const q = moveCircle(map, p, sx, sy, PLAYER.radius);
    if (Math.hypot(q.x - (p.x + sx), q.y - (p.y + sy)) > 1.5) break;
    p = q;
  }
  return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
}

/** Munición tras `ms` milisegundos de recarga al ritmo del Foco en la mano. */
export function reloadAmmo(ammo: number, ms: number, reloadMs: number): number {
  return Math.min(AMMO_MAX, ammo + ms / reloadMs);
}
