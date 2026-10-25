import { z } from 'zod';

/**
 * Esqueleto de los personajes (animación por piezas).
 *
 * Todo está en "unidades de lienzo": el mismo lienzo de 836 × 1254 por vista que se pidió a Astra,
 * con el origen en el centro de los pies (x = 418, y = 92 % de 1254). Así las piezas que entregue
 * (PNG del tamaño del lienzo, cada una en su lugar) se dibujan sin recortes ni ajustes: basta con
 * aplicar la transformación del hueso al que pertenecen.
 */
export const RIG_CANVAS = { w: 836, h: 1254, baseline: 0.92 } as const;
export const RIG_ORIGIN = { x: RIG_CANVAS.w / 2, y: Math.round(RIG_CANVAS.h * RIG_CANVAS.baseline) } as const;
/** Escala del mundo: un personaje medio (80 % del lienzo) mide unos 70 px en el juego. */
export const RIG_WORLD_SCALE = 70 / (RIG_CANVAS.h * 0.8);

export type View = 'front' | 'side' | 'back';
export const VIEWS: View[] = ['front', 'side', 'back'];

/** Puntos de unión. L y R son el lado izquierdo y derecho de la pantalla en la vista de frente;
 *  en la vista de lado, R es el lado cercano a la cámara y L el lejano. */
export const JOINTS = [
  'headTop', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR',
  'hip', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR',
] as const;
export type Joint = typeof JOINTS[number];
export type Pt = [number, number];
export type JointSet = Record<Joint, Pt>;

export const BONES = [
  { id: 'pelvis', parent: null, pivot: 'hip', end: 'hip' },
  { id: 'torso', parent: 'pelvis', pivot: 'hip', end: 'neck' },
  { id: 'head', parent: 'torso', pivot: 'neck', end: 'headTop' },
  { id: 'cape', parent: 'torso', pivot: 'neck', end: 'hip' },
  { id: 'skirt', parent: 'pelvis', pivot: 'hip', end: 'hip' },
  { id: 'upperArmL', parent: 'torso', pivot: 'shoulderL', end: 'elbowL' },
  { id: 'forearmL', parent: 'upperArmL', pivot: 'elbowL', end: 'wristL' },
  { id: 'handL', parent: 'forearmL', pivot: 'wristL', end: 'wristL' },
  { id: 'upperArmR', parent: 'torso', pivot: 'shoulderR', end: 'elbowR' },
  { id: 'forearmR', parent: 'upperArmR', pivot: 'elbowR', end: 'wristR' },
  { id: 'handR', parent: 'forearmR', pivot: 'wristR', end: 'wristR' },
  { id: 'thighL', parent: 'pelvis', pivot: 'hipL', end: 'kneeL' },
  { id: 'shinL', parent: 'thighL', pivot: 'kneeL', end: 'ankleL' },
  { id: 'footL', parent: 'shinL', pivot: 'ankleL', end: 'ankleL' },
  { id: 'thighR', parent: 'pelvis', pivot: 'hipR', end: 'kneeR' },
  { id: 'shinR', parent: 'thighR', pivot: 'kneeR', end: 'ankleR' },
  { id: 'footR', parent: 'shinR', pivot: 'ankleR', end: 'ankleR' },
] as const satisfies readonly { id: string; parent: string | null; pivot: Joint; end: Joint }[];
export type BoneId = typeof BONES[number]['id'];

/** Medidas de un tipo de cuerpo (unidades de lienzo). Las piezas provisionales se dibujan con ellas. */
export interface BodyDims {
  height: number; headLen: number; legLen: number;
  shoulderW: number; hipW: number; torsoD: number;
  arm: number; leg: number; upper: number; fore: number;
}
export interface BodyDef { id: BodyId; name: string; dims: BodyDims; joints: Record<View, JointSet> }

export const BODY_IDS = ['medio', 'esbelto', 'fornido', 'bajo'] as const;
export type BodyId = typeof BODY_IDS[number];

/** Proporciones del encargo: cabeza grande, piernas largas; altura en % del lienzo. */
const BODY_PARAMS: Record<BodyId, { name: string; h: number; head: number; legs: number; sh: number; hip: number; depth: number; arm: number; leg: number }> = {
  medio: { name: 'Medio', h: 0.80, head: 0.30, legs: 0.40, sh: 0.28, hip: 0.20, depth: 0.17, arm: 64, leg: 78 },
  esbelto: { name: 'Esbelto alto', h: 0.86, head: 0.27, legs: 0.45, sh: 0.22, hip: 0.16, depth: 0.14, arm: 54, leg: 66 },
  fornido: { name: 'Fornido', h: 0.78, head: 0.27, legs: 0.37, sh: 0.40, hip: 0.27, depth: 0.24, arm: 94, leg: 104 },
  bajo: { name: 'Bajo y ágil', h: 0.66, head: 0.34, legs: 0.37, sh: 0.27, hip: 0.20, depth: 0.17, arm: 60, leg: 76 },
};

const ARM_SPREAD = (20 * Math.PI) / 180;

/** Genera las articulaciones de las tres vistas a partir de las proporciones. */
export function makeBody(id: BodyId): BodyDef {
  const p = BODY_PARAMS[id];
  const H = Math.round(RIG_CANVAS.h * p.h), headLen = Math.round(H * p.head), legLen = Math.round(H * p.legs);
  const hipY = -legLen, neckY = -(H - headLen), ankleY = -Math.round(H * 0.045), kneeY = Math.round((hipY + ankleY) / 2);
  const shY = neckY + Math.round(H * 0.035), shoulderW = Math.round(H * p.sh), hipW = Math.round(H * p.hip);
  const armLen = (neckY - hipY) * -1 * 1.0 + H * 0.06; // de hombro a muñeca, llega a la mitad del muslo
  const upper = Math.round(armLen * 0.5), fore = Math.round(armLen * 0.46);
  const front: JointSet = {
    headTop: [0, -H], neck: [0, neckY],
    shoulderL: [-shoulderW / 2, shY], shoulderR: [shoulderW / 2, shY],
    elbowL: [-shoulderW / 2 - Math.sin(ARM_SPREAD) * upper, shY + Math.cos(ARM_SPREAD) * upper],
    elbowR: [shoulderW / 2 + Math.sin(ARM_SPREAD) * upper, shY + Math.cos(ARM_SPREAD) * upper],
    wristL: [-shoulderW / 2 - Math.sin(ARM_SPREAD) * (upper + fore), shY + Math.cos(ARM_SPREAD) * (upper + fore)],
    wristR: [shoulderW / 2 + Math.sin(ARM_SPREAD) * (upper + fore), shY + Math.cos(ARM_SPREAD) * (upper + fore)],
    hip: [0, hipY], hipL: [-hipW / 2 + p.leg / 2, hipY], hipR: [hipW / 2 - p.leg / 2, hipY],
    kneeL: [-hipW / 2 + p.leg / 2, kneeY], kneeR: [hipW / 2 - p.leg / 2, kneeY],
    ankleL: [-hipW / 2 + p.leg / 2, ankleY], ankleR: [hipW / 2 - p.leg / 2, ankleY],
  };
  // De lado: hombros y caderas casi encimados (el lejano un poco atrás); brazos rectos hacia abajo.
  const off = 10, lean = Math.round(H * 0.012);
  const side: JointSet = {
    headTop: [lean, -H], neck: [lean, neckY],
    shoulderL: [-off, shY], shoulderR: [off, shY],
    elbowL: [-off, shY + upper], elbowR: [off, shY + upper],
    wristL: [-off + 4, shY + upper + fore], wristR: [off + 4, shY + upper + fore],
    hip: [0, hipY], hipL: [-off, hipY], hipR: [off, hipY],
    kneeL: [-off + 6, kneeY], kneeR: [off + 6, kneeY],
    ankleL: [-off, ankleY], ankleR: [off, ankleY],
  };
  // De espaldas las articulaciones caen en el mismo lugar que de frente (lo que cambia son las piezas).
  const round = (s: JointSet) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, [Math.round(v[0]), Math.round(v[1])]])) as JointSet;
  return {
    id, name: p.name,
    dims: { height: H, headLen, legLen, shoulderW, hipW, torsoD: Math.round(H * p.depth), arm: p.arm, leg: p.leg, upper, fore },
    joints: { front: round(front), side: round(side), back: round(front) },
  };
}

export const BODIES: Record<BodyId, BodyDef> = Object.fromEntries(BODY_IDS.map((id) => [id, makeBody(id)])) as Record<BodyId, BodyDef>;

// ---------- Formato del lote 2 de Astra ----------

const point = z.tuple([z.number(), z.number()]);
const jointSet = z.object(Object.fromEntries(JOINTS.map((j) => [j, point])) as Record<Joint, typeof point>);
/** rig.json que acompaña a las piezas: articulaciones en píxeles del lienzo de cada vista. */
export const rigJsonSchema = z.object({
  version: z.literal(1),
  body: z.enum(BODY_IDS),
  canvas: z.object({ w: z.literal(RIG_CANVAS.w), h: z.literal(RIG_CANVAS.h) }),
  views: z.object({ front: jointSet, side: jointSet, back: jointSet }),
});
export type RigJson = z.infer<typeof rigJsonSchema>;

/** Convierte el rig.json (píxeles del lienzo) al esqueleto del juego (origen en los pies). */
export function bodyFromJson(raw: unknown): BodyDef {
  const j = rigJsonSchema.parse(raw), base = BODIES[j.body];
  const conv = (s: Record<Joint, Pt>) => Object.fromEntries(JOINTS.map((k) => [k, [s[k][0] - RIG_ORIGIN.x, s[k][1] - RIG_ORIGIN.y]])) as JointSet;
  return { ...base, joints: { front: conv(j.views.front), side: conv(j.views.side), back: conv(j.views.back) } };
}

/** Inverso de bodyFromJson: sirve para entregar a Astra la plantilla con nuestras articulaciones. */
export function bodyToJson(b: BodyDef): RigJson {
  const conv = (s: JointSet) => Object.fromEntries(JOINTS.map((k) => [k, [s[k][0] + RIG_ORIGIN.x, s[k][1] + RIG_ORIGIN.y]])) as Record<Joint, Pt>;
  return { version: 1, body: b.id, canvas: { w: RIG_CANVAS.w, h: RIG_CANVAS.h }, views: { front: conv(b.joints.front), side: conv(b.joints.side), back: conv(b.joints.back) } };
}

// ---------- Cinemática directa ----------

/** Matriz afín de canvas: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
export function mul(m: Mat, n: Mat): Mat {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
export function apply(m: Mat, p: Pt): Pt { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }
const rotAbout = (r: number, px: number, py: number, dx = 0, dy = 0): Mat => {
  const c = Math.cos(r), s = Math.sin(r);
  // T(p + d) · R(r) · T(-p)
  return [c, s, -s, c, px + dx - (c * px - s * py), py + dy - (s * px + c * py)];
};

/** Hueso que arrastra a cada articulación (el extremo se mueve con su hueso: la muñeca con el antebrazo). */
const JOINT_OWNER: Record<Joint, BoneId> = {
  headTop: 'head', neck: 'torso', shoulderL: 'upperArmL', shoulderR: 'upperArmR',
  elbowL: 'upperArmL', elbowR: 'upperArmR', wristL: 'forearmL', wristR: 'forearmR',
  hip: 'pelvis', hipL: 'thighL', hipR: 'thighR', kneeL: 'thighL', kneeR: 'thighR', ankleL: 'shinL', ankleR: 'shinR',
};

export interface BonePose { r?: number; x?: number; y?: number }
export interface Pose { root: { x: number; y: number; r: number }; bones: Partial<Record<BoneId, BonePose>> }
export const REST: Pose = { root: { x: 0, y: 0, r: 0 }, bones: {} };

/** Transformación de cada hueso (de la pose de reposo a la pose animada). */
export function solve(joints: JointSet, pose: Pose): Record<BoneId, Mat> {
  const out = {} as Record<BoneId, Mat>;
  const root = rotAbout(pose.root.r, 0, 0, pose.root.x, pose.root.y);
  for (const b of BONES) {
    const bp = pose.bones[b.id] ?? {}, [px, py] = joints[b.pivot];
    const local = rotAbout(bp.r ?? 0, px, py, bp.x ?? 0, bp.y ?? 0);
    out[b.id] = mul(b.parent ? out[b.parent as BoneId] : root, local);
  }
  return out;
}

/** Posición animada de cada articulación (para depurar y para pegar armas o efectos). */
export function posedJoints(joints: JointSet, pose: Pose): JointSet {
  const m = solve(joints, pose), out = {} as JointSet;
  for (const j of JOINTS) out[j] = apply(m[JOINT_OWNER[j]], joints[j]);
  return out;
}

// ---------- Animaciones ----------

export type ActionKind = 'melee' | 'shoot' | 'cast' | 'hit';
export interface AnimInput {
  /** Segundos (para respirar). */
  t: number;
  /** Fase del ciclo de caminar en radianes y cuánto se está moviendo (0 a 1). */
  walk: number; move: number;
  action?: { kind: ActionKind; k: number } | null;
  /** 0 a 1 mientras cae al morir. */
  die?: number;
}

const ease = (k: number) => k * k * (3 - 2 * k);
/** Envolvente de una acción: entra rápido, se sostiene y sale suave. */
function envelope(k: number, attack = 0.15, release = 0.35) {
  if (k <= 0 || k >= 1) return 0;
  return k < attack ? ease(k / attack) : k > 1 - release ? ease((1 - k) / release) : 1;
}

/** Pose para una vista. Con signo "hacia afuera" o "hacia adelante" negativo para el lado R (ver rotAbout). */
export function animate(view: View, a: AnimInput, body: BodyDef): Pose {
  const H = body.dims.height, pose: Pose = { root: { x: 0, y: 0, r: 0 }, bones: {} };
  const B = pose.bones, set = (id: BoneId, v: BonePose) => { B[id] = { ...B[id], ...v }; };
  const s = Math.sin(a.walk), c = Math.cos(a.walk), m = a.move;
  // Reposo: respiración leve y brazos que se mecen.
  const br = Math.sin(a.t * 2.2);
  set('torso', { r: 0.012 * br * (1 - m) });
  set('head', { r: -0.02 * br * (1 - m), y: 3 * br });
  set('cape', { r: 0.03 * Math.sin(a.t * 1.7) });

  if (view === 'side') {
    set('thighR', { r: -0.55 * s * m }); set('thighL', { r: 0.55 * s * m });
    set('shinR', { r: 0.8 * Math.max(0, c) * m }); set('shinL', { r: 0.8 * Math.max(0, -c) * m });
    set('footR', { r: -0.25 * Math.max(0, c) * m }); set('footL', { r: -0.25 * Math.max(0, -c) * m });
    set('upperArmR', { r: 0.45 * s * m }); set('upperArmL', { r: -0.45 * s * m });
    set('forearmR', { r: -0.3 * m }); set('forearmL', { r: -0.3 * m });
    set('torso', { r: 0.08 * m + (B.torso?.r ?? 0) });
    set('cape', { r: 0.25 * m + 0.05 * s * m + (B.cape?.r ?? 0) });
    set('skirt', { r: 0.05 * s * m });
  } else {
    // De frente y de espaldas la pierna que avanza sube un poco y los brazos se balancean.
    const lift = H * 0.035 * m;
    set('thighR', { y: -lift * Math.max(0, c) }); set('thighL', { y: -lift * Math.max(0, -c) });
    set('upperArmR', { r: 0.12 * s * m - 0.03 * br * (1 - m) }); set('upperArmL', { r: 0.12 * s * m + 0.03 * br * (1 - m) });
    set('torso', { r: 0.035 * s * m + (B.torso?.r ?? 0) });
    set('head', { r: -0.03 * s * m + (B.head?.r ?? 0) });
    set('cape', { r: 0.04 * s * m + (B.cape?.r ?? 0) });
    set('skirt', { r: 0.03 * s * m });
  }
  pose.root.y = -Math.abs(c) * H * 0.018 * m;

  const act = a.action;
  if (act && act.k > 0 && act.k < 1) {
    const w = envelope(act.k), k = act.k, mix = (id: BoneId, r: number) => set(id, { r: (B[id]?.r ?? 0) * (1 - w) + r * w });
    const side = view === 'side';
    if (act.kind === 'melee') {
      // Levanta el arma y la baja en arco.
      const sw = k < 0.35 ? -2.7 * ease(k / 0.35) : -2.7 + 3.4 * ease(Math.min(1, (k - 0.35) / 0.3));
      mix('upperArmR', side ? sw : sw * 0.85); mix('forearmR', side ? -0.4 : -0.3);
      mix('torso', side ? (k < 0.35 ? -0.12 : 0.15) : (k < 0.35 ? -0.06 : 0.08));
      mix('upperArmL', side ? 0.4 : 0.35);
    } else if (act.kind === 'shoot') {
      // Brazo extendido hacia adelante con un pequeño retroceso.
      const kick = k > 0.25 && k < 0.5 ? Math.sin(((k - 0.25) / 0.25) * Math.PI) * 0.25 : 0;
      mix('upperArmR', (side ? -1.5 : -1.25) + kick); mix('forearmR', side ? -0.1 : 0.15);
      mix('torso', side ? -0.05 : 0);
    } else if (act.kind === 'cast') {
      // Ambos brazos arriba, como quien pronuncia un Nombre.
      const up = k < 0.4 ? ease(k / 0.4) : 1;
      mix('upperArmR', (side ? -2.7 : -2.5) * up); mix('forearmR', (side ? -0.3 : 0.5) * up);
      mix('upperArmL', (side ? -2.4 : 2.5) * up); mix('forearmL', (side ? -0.3 : -0.5) * up);
      mix('head', side ? -0.15 : 0);
      pose.root.y += -H * 0.03 * w * Math.sin(Math.min(1, k / 0.5) * Math.PI);
    } else if (act.kind === 'hit') {
      mix('torso', side ? -0.22 : 0.1); mix('head', side ? -0.18 : -0.12);
      mix('upperArmR', side ? 0.5 : -0.6); mix('upperArmL', side ? 0.6 : 0.6);
      pose.root.x += (side ? -H * 0.02 : 0) * w;
    }
  }

  // El dibujo está en pose A (brazos separados) para poder recortar las piezas; en el juego los
  // brazos se relajan hacia el cuerpo.
  if (view !== 'side') { set('upperArmR', { r: (B.upperArmR?.r ?? 0) + 0.2 }); set('upperArmL', { r: (B.upperArmL?.r ?? 0) - 0.2 }); }
  // La mano del Foco compensa el giro del brazo para que el arma quede casi vertical; al golpear
  // se alinea con el brazo para que el arco del golpe sea el del arma.
  const armR = (B.torso?.r ?? 0) + (B.upperArmR?.r ?? 0) + (B.forearmR?.r ?? 0);
  const upright = -armR + (view === 'side' ? 0.3 : 0.08);
  const strike = act?.kind === 'melee' && act.k > 0 && act.k < 1 ? envelope(act.k, 0.2, 0.3) : 0;
  set('handR', { r: upright * (1 - strike) + Math.PI * 0.85 * strike });

  if (a.die != null && a.die > 0) {
    const k = ease(Math.min(1, a.die));
    pose.root.r = -1.45 * k;
    pose.root.y += -H * 0.02 * Math.sin(k * Math.PI);
    set('head', { r: -0.3 * k }); set('upperArmR', { r: -0.8 * k }); set('upperArmL', { r: 0.8 * k });
    set('thighR', { r: -0.3 * k, y: 0 }); set('shinR', { r: 0.5 * k });
  }
  return pose;
}

// ---------- Apariencia ----------

export const OUTFIT_IDS = [
  'tharven_aprendiz', 'tharven_guardia', 'seleth_novicia', 'seleth_velo',
  'vaerel_tejedor', 'vaerel_hilo', 'orrath_vigia', 'orrath_tormenta',
] as const;
export type OutfitId = typeof OUTFIT_IDS[number];
export const HEAD_IDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
export type HeadId = typeof HEAD_IDS[number];
export interface Appearance { body: BodyId; outfit: OutfitId; head: HeadId }

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Apariencia estable por jugador. Mientras no exista el selector del lobby, la ropa sale de la
 * escuela (Aprendiz o Maestro) y el cuerpo y la cabeza del identificador.
 */
export function appearanceFor(id: string, school?: string): Appearance {
  const h = fnv(id);
  const pool = school ? OUTFIT_IDS.filter((o) => o.startsWith(school)) : [...OUTFIT_IDS];
  return {
    body: BODY_IDS[h % BODY_IDS.length],
    head: HEAD_IDS[(h >>> 4) % HEAD_IDS.length],
    outfit: (pool.length ? pool : [...OUTFIT_IDS])[(h >>> 9) % (pool.length || OUTFIT_IDS.length)],
  };
}
