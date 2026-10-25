import { describe, it, expect } from 'vitest';
import {
  BODIES, BODY_IDS, JOINTS, VIEWS, REST, RIG_CANVAS, RIG_ORIGIN, solve, posedJoints, animate,
  appearanceFor, bodyFromJson, bodyToJson, OUTFIT_IDS, type View,
} from '../src/rig';

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('Esqueleto de personajes', () => {
  it('cada tipo de cuerpo tiene todas las articulaciones en las tres vistas, dentro del lienzo y con los pies en la línea base', () => {
    for (const id of BODY_IDS) for (const v of VIEWS) {
      const j = BODIES[id].joints[v];
      for (const k of JOINTS) {
        const [x, y] = j[k];
        expect(x + RIG_ORIGIN.x).toBeGreaterThan(0); expect(x + RIG_ORIGIN.x).toBeLessThan(RIG_CANVAS.w);
        expect(y + RIG_ORIGIN.y).toBeGreaterThan(0); expect(y).toBeLessThanOrEqual(0);
      }
      // Altura total = la del encargo (cabeza arriba, pies en el origen).
      expect(-j.headTop[1]).toBe(BODIES[id].dims.height);
    }
    expect(BODIES.esbelto.dims.height).toBeGreaterThan(BODIES.medio.dims.height);
    expect(BODIES.bajo.dims.height).toBeLessThan(BODIES.fornido.dims.height);
    expect(BODIES.fornido.dims.shoulderW).toBeGreaterThan(BODIES.esbelto.dims.shoulderW);
  });

  it('la pose de reposo deja cada articulación en su lugar y la animación conserva el largo de los huesos', () => {
    const j = BODIES.medio.joints.side;
    expect(posedJoints(j, REST)).toEqual(j);
    const p = animate('side', { t: 1.3, walk: 2.1, move: 1, action: { kind: 'melee', k: 0.5 } }, BODIES.medio);
    const q = posedJoints(j, p);
    for (const [a, b] of [['shoulderR', 'elbowR'], ['elbowR', 'wristR'], ['hipL', 'kneeL'], ['kneeL', 'ankleL']] as const)
      expect(dist(q[a], q[b])).toBeCloseTo(dist(j[a], j[b]), 6);
    expect(Object.keys(solve(j, p))).toHaveLength(17);
  });

  it('al caminar de lado las piernas se alternan y los pies no se hunden en el piso', () => {
    const body = BODIES.medio, j = body.joints.side;
    let minY = Infinity, maxSplit = 0;
    for (let w = 0; w < Math.PI * 2; w += 0.2) {
      const q = posedJoints(j, animate('side', { t: 0, walk: w, move: 1 }, body));
      maxSplit = Math.max(maxSplit, Math.abs(q.ankleR[0] - q.ankleL[0]));
      minY = Math.min(minY, -Math.max(q.ankleR[1], q.ankleL[1]));
    }
    expect(maxSplit).toBeGreaterThan(body.dims.height * 0.1);
    expect(minY).toBeGreaterThan(-body.dims.height * 0.03);
  });

  it('el ataque cuerpo a cuerpo levanta el brazo del arma por encima del hombro y morir acuesta al personaje', () => {
    const body = BODIES.fornido;
    for (const v of ['front', 'side'] as View[]) {
      const q = posedJoints(body.joints[v], animate(v, { t: 0, walk: 0, move: 0, action: { kind: 'melee', k: 0.34 } }, body));
      expect(q.wristR[1]).toBeLessThan(q.shoulderR[1]);
    }
    const dead = posedJoints(body.joints.side, animate('side', { t: 0, walk: 0, move: 0, die: 1 }, body));
    expect(Math.abs(dead.headTop[1])).toBeLessThan(body.dims.height * 0.35);
  });

  it('el rig.json del lote 2 se valida y regresa el mismo esqueleto', () => {
    const json = bodyToJson(BODIES.bajo);
    expect(json.views.front.headTop[1]).toBe(RIG_ORIGIN.y - BODIES.bajo.dims.height);
    expect(bodyFromJson(JSON.parse(JSON.stringify(json))).joints).toEqual(BODIES.bajo.joints);
    const bad = structuredClone(json) as any; delete bad.views.side.kneeL;
    expect(() => bodyFromJson(bad)).toThrow();
  });

  it('la apariencia es estable por jugador, respeta la escuela y da variedad', () => {
    expect(appearanceFor('p-123')).toEqual(appearanceFor('p-123'));
    expect(appearanceFor('p-9', 'seleth').outfit.startsWith('seleth')).toBe(true);
    const seen = { body: new Set<string>(), outfit: new Set<string>(), head: new Set<string>() };
    for (let i = 0; i < 200; i++) { const a = appearanceFor(`jugador-${i}`); seen.body.add(a.body); seen.outfit.add(a.outfit); seen.head.add(a.head); }
    expect(seen.body.size).toBe(4); expect(seen.outfit.size).toBe(OUTFIT_IDS.length); expect(seen.head.size).toBe(6);
  });
});
