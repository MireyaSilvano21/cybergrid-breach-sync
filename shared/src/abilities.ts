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

/**
 * Los 10 Focos (armas). Cada uno tiene su básico y su Inscripción (R). Diseños de referencia del
 * equipo; el arte final se pedirá con el mismo id.
 */
export const FOCOS: Record<string, FocoDef> = {
  daga: {
    id: 'daga', name: 'Daga Carmesí', desc: 'Cortes cortos y muy rápidos.', melee: true, color: '#c8323c', rgb: '255,90,90',
    basic: { shape: { type: 'cono', range: 1.3, angle: 80 }, delivery: 'instante', dmg: 9, intervalMs: 240, reloadMs: 700 },
    insc: { id: 'abanico', name: 'Abanico de dagas', desc: 'Lanza tres dagas en abanico.', shape: { type: 'cono', range: 5, angle: 30 }, delivery: 'proyectil', cd: 9, effect: { dmg: 9 }, projectile: P(1000, 9, { count: 3, spreadDeg: 30 }), rgb: '255,90,90' },
  },
  llama: {
    id: 'llama', name: 'Hoja de Llama', desc: 'Latigazo de fuego largo y estrecho.', melee: true, color: '#ffb347', rgb: '255,180,60',
    basic: { shape: { type: 'cono', range: 3, angle: 28 }, delivery: 'instante', dmg: 13, intervalMs: 520, reloadMs: 1150 },
    insc: { id: 'llamarada', name: 'Llamarada', desc: 'Ola de fuego que atraviesa y ralentiza.', shape: { type: 'linea', range: 6.5, width: 1.1 }, delivery: 'proyectil', cd: 11, effect: { dmg: 16, slowMs: 1200 }, projectile: P(750, 30, { pierce: true }), rgb: '255,180,60' },
  },
  cetro_lunar: {
    id: 'cetro_lunar', name: 'Cetro Lunar', desc: 'Esfera de luz lunar.', melee: false, color: '#d8a8f0', rgb: '230,160,255',
    basic: { shape: { type: 'linea', range: 6.5, width: 0.45 }, delivery: 'proyectil', dmg: 10, intervalMs: 420, reloadMs: 1050, projectile: P(750, 13) },
    insc: { id: 'vinculo', name: 'Vínculo', desc: 'Área que cura a tus aliados (y a ti).', shape: { type: 'zona', range: 6, radius: 2.5 }, delivery: 'instante', cd: 13, effect: { heal: 30 }, targets: 'aliados', rgb: '230,160,255' },
  },
  lanza: {
    id: 'lanza', name: 'Lanza Ígnea', desc: 'Estocada en línea de largo alcance.', melee: true, color: '#e8732a', rgb: '255,140,50',
    basic: { shape: { type: 'linea', range: 2.6, width: 0.6 }, delivery: 'instante', dmg: 17, intervalMs: 600, reloadMs: 1300 },
    insc: { id: 'lanzamiento', name: 'Lanzamiento', desc: 'Arroja la lanza: atraviesa a todos en su línea.', shape: { type: 'linea', range: 9, width: 0.4 }, delivery: 'proyectil', cd: 11, effect: { dmg: 20 }, projectile: P(1300, 12, { pierce: true }), rgb: '255,140,50' },
  },
  guadana: {
    id: 'guadana', name: 'Guadaña de Rosas', desc: 'Arco muy amplio y lento.', melee: true, color: '#e8e8f0', rgb: '255,80,110',
    basic: { shape: { type: 'cono', range: 2.2, angle: 170 }, delivery: 'instante', dmg: 18, intervalMs: 700, reloadMs: 1450 },
    insc: { id: 'siega', name: 'Siega', desc: 'Giro que daña y atrae a los rivales hacia ti.', shape: { type: 'propio', range: 0, radius: 3 }, delivery: 'instante', cd: 12, effect: { dmg: 12, knock: -1.6 }, rgb: '255,80,110' },
  },
  gemelas: {
    id: 'gemelas', name: 'Espadas Gemelas', desc: 'Dos hojas: golpes rápidos al frente.', melee: true, color: '#a8c0ff', rgb: '180,200,255',
    basic: { shape: { type: 'cono', range: 1.6, angle: 100 }, delivery: 'instante', dmg: 11, intervalMs: 300, reloadMs: 850 },
    insc: { id: 'corte', name: 'Corte espectral', desc: 'Embestida corta que corta a quien atraviesa.', shape: { type: 'salto', range: 3.5 }, delivery: 'embestida', cd: 9, effect: { dmg: 16 }, rgb: '180,200,255' },
  },
  martillo: {
    id: 'martillo', name: 'Martillo de Rosa', desc: 'Golpe pesado y amplio, lento.', melee: true, color: '#f0a890', rgb: '255,170,140',
    basic: { shape: { type: 'cono', range: 1.9, angle: 130 }, delivery: 'instante', dmg: 24, intervalMs: 750, reloadMs: 1500 },
    insc: { id: 'fractura', name: 'Fractura', desc: 'Grieta que avanza en línea, atraviesa y ralentiza.', shape: { type: 'linea', range: 6, width: 1.2 }, delivery: 'proyectil', cd: 11, effect: { dmg: 14, slowMs: 1600 }, projectile: P(620, 34, { pierce: true }), rgb: '255,170,140' },
  },
  cetro_rubi: {
    id: 'cetro_rubi', name: 'Cetro de Rubí', desc: 'Disparo de rubí a media distancia.', melee: false, color: '#d0303c', rgb: '255,70,80',
    basic: { shape: { type: 'linea', range: 7.5, width: 0.4 }, delivery: 'proyectil', dmg: 12, intervalMs: 500, reloadMs: 1200, projectile: P(850, 11) },
    insc: { id: 'grieta', name: 'Grieta', desc: 'Área a distancia que daña y ralentiza.', shape: { type: 'zona', range: 7, radius: 2 }, delivery: 'instante', cd: 12, effect: { dmg: 14, slowMs: 2000 }, rgb: '255,70,80' },
  },
  revolver: {
    id: 'revolver', name: 'Revólver Arcano', desc: 'Balas muy rápidas de poco daño.', melee: false, color: '#f0f0ff', rgb: '170,200,255',
    basic: { shape: { type: 'linea', range: 8, width: 0.25 }, delivery: 'proyectil', dmg: 9, intervalMs: 220, reloadMs: 800, projectile: P(1400, 7) },
    insc: { id: 'andanada', name: 'Vaciar el tambor', desc: 'Seis balas en abanico.', shape: { type: 'cono', range: 7, angle: 36 }, delivery: 'proyectil', cd: 10, effect: { dmg: 6 }, projectile: P(1300, 7, { count: 6, spreadDeg: 36 }), rgb: '170,200,255' },
  },
  arco: {
    id: 'arco', name: 'Arco Alado', desc: 'Flecha de largo alcance.', melee: false, color: '#f4f0e0', rgb: '255,250,230',
    basic: { shape: { type: 'linea', range: 9, width: 0.3 }, delivery: 'proyectil', dmg: 15, intervalMs: 600, reloadMs: 1400, projectile: P(1150, 8) },
    insc: { id: 'lluvia', name: 'Lluvia de flechas', desc: 'Área a distancia que daña a todos dentro.', shape: { type: 'zona', range: 8, radius: 2.2 }, delivery: 'instante', cd: 12, effect: { dmg: 18 }, rgb: '255,250,230' },
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
export const DEFAULT_BUILD: Build = { school: 'tharven', nombres: ['llamar_piedra', 'temblor'], focos: ['gemelas', 'revolver'] };

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

/** ¿Está el punto dentro de la línea (estocada)? Largo y ancho en casillas, más el radio del cuerpo. */
export function inLine(o: { x: number; y: number }, dirX: number, dirY: number, p: { x: number; y: number }, rangeTiles: number, widthTiles: number, bodyR = PLAYER.radius): boolean {
  const dx = p.x - o.x, dy = p.y - o.y, along = dx * dirX + dy * dirY, across = Math.abs(-dx * dirY + dy * dirX);
  return along >= -bodyR && along <= rangeTiles * TILE + bodyR && across <= (widthTiles * TILE) / 2 + bodyR;
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
