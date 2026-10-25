import { TILE } from './constants';

/**
 * Combate estilo Albion (GDD sección 7):
 * - Ataque básico automático sobre un objetivo fijado mientras esté en alcance y a la vista.
 * - Habilidades que salen al instante hacia el cursor (Q y E: Nombres de la escuela; R: Inscripción del Foco).
 * - Dos Focos con cambio rápido (Espacio). Cada Inscripción conserva su propia recarga.
 * Los valores están en casillas y segundos, como en el GDD; el código los pasa a píxeles.
 */
export type AimType = 'direccion' | 'zona' | 'objetivo' | 'desplazamiento' | 'propio';
export type Slot = 'Q' | 'E' | 'R';

export interface AbilityDef {
  id: string;
  name: string;
  aim: AimType;
  /** Alcance en casillas (o radio, si es alrededor del personaje). */
  range: number;
  radius?: number;
  cd: number;
  dmg: number;
  desc: string;
}

export interface FocoDef {
  id: string;
  name: string;
  melee: boolean;
  /** Ataque básico: alcance en casillas, golpes por segundo y daño. */
  basic: { range: number; rate: number; dmg: number };
  insc: AbilityDef;
  color: string;
}

export const FOCOS: Record<string, FocoDef> = {
  vara: {
    id: 'vara', name: 'Vara de Fresno', melee: true, color: '#c98a4a',
    basic: { range: 1.5, rate: 1.0, dmg: 14 },
    insc: { id: 'barrido', name: 'Barrido', aim: 'propio', range: 0, radius: 2.5, cd: 10, dmg: 18, desc: 'Giro que golpea y empuja a todos alrededor.' },
  },
  anillo: {
    id: 'anillo', name: 'Anillo de Ámbar', melee: false, color: '#ffb347',
    basic: { range: 7, rate: 1.2, dmg: 10 },
    insc: { id: 'andanada', name: 'Andanada', aim: 'direccion', range: 8, cd: 10, dmg: 7, desc: 'Cinco proyectiles en abanico hacia el cursor.' },
  },
};

export const NOMBRES: Record<string, AbilityDef & { school: string }> = {
  llamar_piedra: { id: 'llamar_piedra', school: 'tharven', name: 'Llamar a la Piedra', aim: 'desplazamiento', range: 4, cd: 12, dmg: 12, desc: 'Embestida hacia el cursor que empuja a quien choca.' },
  temblor: { id: 'temblor', school: 'tharven', name: 'Temblor', aim: 'propio', range: 0, radius: 3, cd: 14, dmg: 8, desc: 'Onda que daña y ralentiza un 40 % durante 2.5 s.' },
};

export interface Build { school: string; nombres: [string, string]; focos: [string, string] }
/** Build de prueba de la primera parte: Tharvén con un Foco cuerpo a cuerpo y uno de distancia. */
export const DEFAULT_BUILD: Build = { school: 'tharven', nombres: ['llamar_piedra', 'temblor'], focos: ['vara', 'anillo'] };

export const GCD_MS = 300;
export const SWAP_MS = 500;
/** Embestida: 4 casillas en 0.25 s. */
export const DASH_S = 0.25;
export const DASH_MUL = (4 * TILE) / DASH_S / 230;
export const SLOW_MUL = 0.6;
export const SLOW_MS = 2500;
export const KNOCK_PX = 2 * TILE;
export const PROJECTILE = { speed: 900, radius: 8, spreadRad: (40 * Math.PI) / 180, count: 5 };

/** Habilidad que corresponde a cada tecla según el build y el Foco en la mano. */
export function abilityFor(build: Build, foco: 0 | 1, slot: Slot): AbilityDef {
  if (slot === 'Q') return NOMBRES[build.nombres[0]];
  if (slot === 'E') return NOMBRES[build.nombres[1]];
  return FOCOS[build.focos[foco]].insc;
}

/** ¿Está el objetivo dentro del alcance del ataque básico? (distancia entre centros, con el radio del cuerpo) */
export function inBasicRange(foco: FocoDef, dist: number, bodyRadius: number): boolean {
  return dist <= foco.basic.range * TILE + bodyRadius;
}

/** Punto de destino de una habilidad: se recorta al alcance máximo. */
export function clampAim(from: { x: number; y: number }, to: { x: number; y: number }, rangeTiles: number) {
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1, max = rangeTiles * TILE;
  const k = Math.min(1, max / d);
  return { x: from.x + dx * k, y: from.y + dy * k, dirX: dx / d, dirY: dy / d };
}

/** Direcciones de la Andanada: abanico centrado en la dirección apuntada. */
export function fanDirections(dirX: number, dirY: number, count = PROJECTILE.count, spread = PROJECTILE.spreadRad): [number, number][] {
  const a0 = Math.atan2(dirY, dirX);
  return Array.from({ length: count }, (_, i) => {
    const a = a0 + (count === 1 ? 0 : -spread / 2 + (spread * i) / (count - 1));
    return [Math.cos(a), Math.sin(a)];
  });
}
