import { describe, expect, it } from 'vitest';
import { Match, type Conn } from '../src/game';
import { RESONANCE, TICK_MS } from '@shared/index';

/** Partida de dos equipos (p0 en Ámbar, p1 en Violeta) con los mensajes de cada uno. */
function setup() {
  const sent: Record<string, any[]> = {};
  const list = [0, 1].map((team) => {
    const id = `p${team}`; sent[id] = [];
    const conn: Conn = { id, name: `jugador${team}`, send: (m: any) => sent[id].push(m) };
    return { conn, team };
  });
  const match = new Match(list, () => {});
  return { match, sent };
}

/** Avanza la partida desde el segundo `fromS` durante `seconds`, a ritmo de tick. Devuelve el instante final. */
function play(match: Match, fromS: number, seconds: number, every?: () => void) {
  const t0 = Date.now() + fromS * 1000;
  const n = Math.round((seconds * 1000) / TICK_MS);
  for (let i = 0; i < n; i++) { every?.(); match.tick(t0 + i * TICK_MS); }
  return fromS + seconds;
}

/** Coloca a un jugador junto al portal 1 (dentro del anillo cercano). */
function atPortal(match: Match, id: string) {
  const p = match.map.portalCandidates[match.portalSlots()[0]];
  const a = match.actor(id)!;
  a.x = p.x; a.y = p.y;
  return p;
}

const notices = (msgs: any[]) => msgs.filter((m) => m.type === 'notice').map((m) => m.message as string);
const lastSnap = (msgs: any[]) => msgs.filter((m) => m.type === 'snap').at(-1);

describe('Resonancia en la partida', () => {
  it('no corre antes de la Primera Llamada', () => {
    const { match, sent } = setup();
    atPortal(match, 'p0');
    play(match, 10, 20);
    expect(match.resonanceOf(0)).toBeUndefined();
    expect(lastSnap(sent.p0).res).toBeNull();
    match.stop();
  });

  it('acampar junto al portal marca al equipo: avisa a todos y los rivales lo ven donde esté', () => {
    const { match, sent } = setup();
    const start = match.phases.primeraLlamada + 1;
    // p1 se queda en su llegada, lejos del portal; p0 acampa en el anillo cercano.
    play(match, start, 25, () => { atPortal(match, 'p0'); match.actor('p0')!.hp = 100; });
    expect(match.resonanceOf(0)!.marked).toBe(true);
    expect(match.resonanceOf(1)!.marked).toBe(false);
    expect(notices(sent.p0)).toContain('¡La Resonancia marcó a tu equipo! Todos los rivales los ven');
    expect(notices(sent.p1)).toContain('La Resonancia marcó al equipo Ámbar');
    const snap = lastSnap(sent.p1);
    expect(snap.marked).toEqual([0]);
    expect(snap.others.find((o: any) => o.id === 'p0')?.mark).toBe(true);
    expect(lastSnap(sent.p0).res).toMatchObject({ m: true, z: 'near' });
    match.stop();
  });

  it('el equipo marcado recibe daño dentro de los anillos y el portal se relocaliza', () => {
    const { match, sent } = setup();
    const start = match.phases.primeraLlamada + 1;
    const before = match.portalSlots()[0];
    // Se llena la barra (vida restaurada para medir solo el daño de después).
    play(match, start, 25, () => { atPortal(match, 'p0'); match.actor('p0')!.hp = 100; });
    expect(match.resonanceOf(0)!.marked).toBe(true);
    const a = match.actor('p0')!;
    a.hp = 100;
    play(match, start + 25, 1, () => atPortal(match, 'p0'));
    expect(a.hp).toBeLessThan(100);
    expect(a.hp).toBeGreaterThan(100 - RESONANCE.markedDps * 1.5);
    // Sigue en el anillo cercano hasta que el portal se vuelve inestable y cambia de lugar.
    let moved = false;
    play(match, start + 26, RESONANCE.unstableSeconds + 2, () => {
      if (match.portalSlots()[0] !== before) moved = true;
      if (!moved) { a.x = match.map.portalCandidates[before].x; a.y = match.map.portalCandidates[before].y; }
      a.hp = 100;
    });
    expect(match.portalSlots()[0]).not.toBe(before);
    expect(match.portalSlots()[0]).not.toBe(match.portalSlots()[1]);
    expect(notices(sent.p1)).toContain('¡El portal 1 se volvió inestable y reapareció en otro lugar!');
    const p = lastSnap(sent.p1).portals[0];
    const dest = match.map.portalCandidates[match.portalSlots()[0]];
    expect([p.x, p.y]).toEqual([dest.x, dest.y]);
    match.stop();
  });

  it('quien se sincroniza estando marcado recibe el escudo arcano y no recibe el daño del anillo', () => {
    const { match } = setup();
    const start = match.phases.primeraLlamada + 1;
    play(match, start, 25, () => { atPortal(match, 'p0'); match.actor('p0')!.hp = 100; });
    const a = match.actor('p0')!;
    a.hp = 100;
    let seq = 100;
    play(match, start + 25, 1, () => {
      atPortal(match, 'p0');
      match.handleInput('p0', { type: 'input', seq: ++seq, mx: 0, my: 0, dt: 0, sp: 1, swap: false, ax: 0, ay: 1, attack: false, interact: true, use: false });
    });
    expect(a.shield).toBe(RESONANCE.syncShield);
    expect(a.hp).toBe(100);
    expect(a.syncT).toBeGreaterThan(0);
    match.stop();
  });

  it('El Desnombrar apaga la Resonancia y quita las marcas', () => {
    const { match, sent } = setup();
    const start = match.phases.primeraLlamada + 1;
    play(match, start, 25, () => { atPortal(match, 'p0'); match.actor('p0')!.hp = 100; });
    expect(match.resonanceOf(0)!.marked).toBe(true);
    play(match, match.phases.desnombrar + 1, 0.2);
    expect(match.resonanceOf(0)).toBeUndefined();
    expect(lastSnap(sent.p1).marked).toEqual([]);
    expect(lastSnap(sent.p1).res).toBeNull();
    match.stop();
  });
});
