import { describe, expect, it } from 'vitest';
import { Match, type Conn } from '../src/game';
import { RITUAL, TICK_MS, SEAL_VAULT, MONSTERS, needleAt, isSolidWorld } from '@shared/index';

function setup() {
  const sent: Record<string, any[]> = {};
  const list = [0, 1].map((team) => {
    const id = `p${team}`; sent[id] = [];
    const conn: Conn = { id, name: `jugador${team}`, send: (m: any) => sent[id].push(m) };
    return { conn, team };
  });
  return { match: new Match(list, () => {}), sent };
}
const input = (seq: number, extra: Record<string, unknown> = {}) =>
  ({ type: 'input' as const, seq, mx: 0, my: 0, dt: 0, sp: 1, swap: false, ax: 0, ay: 1, attack: false, interact: false, use: false, ...extra });
const notices = (msgs: any[]) => msgs.filter((m) => m.type === 'notice').map((m) => m.message as string);

/** Lugar libre junto al monolito 0, dentro del alcance para activarlo. */
function spot(match: Match) {
  const m = match.rituals[0];
  for (let d = 70; d <= RITUAL.range - 10; d += 6) for (let a = 0; a < 6.28; a += 0.3) {
    const x = m.x + Math.cos(a) * d, y = m.y + Math.sin(a) * d;
    if ([0, 1.57, 3.14, 4.71, -1].every((q) => !isSolidWorld(match.map, x + (q < 0 ? 0 : Math.cos(q) * 18), y + (q < 0 ? 0 : Math.sin(q) * 18)))) return { x, y };
  }
  throw new Error('sin lugar libre');
}

/** Mantiene interactuar junto al monolito 0 hasta despertarlo. Devuelve el instante (ms) en que quedó activo. */
function activate(match: Match, fromS: number) {
  const a = match.actor('p0')!, p = spot(match);
  let now = Date.now() + fromS * 1000, seq = 1;
  for (let i = 0; i < Math.ceil((RITUAL.activateS * 1000) / TICK_MS) + 2; i++) {
    a.x = p.x; a.y = p.y; a.hp = 100;
    match.handleInput('p0', input(seq++, { interact: true }));
    match.tick(now); now += TICK_MS;
  }
  return now;
}

describe('Ritual del monolito en la partida', () => {
  it('no se puede despertar antes de la Primera Llamada', () => {
    const { match } = setup();
    activate(match, 10);
    expect(match.rituals[0].r.phase).toBe('dormido');
    expect(match.monsters).toHaveLength(0);
    match.stop();
  });

  it('mantener interactuar despierta el monolito y aparece la primera oleada', () => {
    const { match, sent } = setup();
    activate(match, match.phases.primeraLlamada + 1);
    expect(match.rituals[0].r.phase).toBe('defensa');
    expect(match.rituals[0].r.team).toBe(0);
    expect(match.monsters.length).toBeGreaterThan(0);
    expect(match.monsters.every((m) => m.owner === 0)).toBe(true);
    expect(notices(sent.p0)).toContain('¡Ritual iniciado! Defiendan el monolito');
    match.stop();
  });

  it('los Desnombrados golpean a quien defiende', () => {
    const { match } = setup();
    let now = activate(match, match.phases.primeraLlamada + 1);
    const a = match.actor('p0')!, p = { x: a.x, y: a.y };
    a.hp = 100;
    // Los Desnombrados vienen solos hacia quien defiende.
    for (let i = 0; i < 300 && a.hp === 100; i++) { a.x = p.x; a.y = p.y; match.tick(now); now += TICK_MS; }
    expect(a.hp).toBeLessThan(100);
    match.stop();
  });

  it('matar a un Desnombrado cuenta como baja de PvE', () => {
    const { match } = setup();
    activate(match, match.phases.primeraLlamada + 1);
    const a = match.actor('p0')!, mo = match.monsters[0], before = match.monsters.length;
    for (const o of match.monsters) { o.x = a.x + 500; o.y = a.y; }
    mo.x = a.x + 30; mo.y = a.y; mo.hp = 1;
    match.handleInput('p0', input(500, { fire: { x: mo.x, y: mo.y, n: 1 } }));
    expect(match.monsters.length).toBe(before - 1);
    expect(a.pveKills).toBe(1);
    match.stop();
  });

  it('la prueba de Nombre repara el monolito debilitado', () => {
    const { match, sent } = setup();
    let now = activate(match, match.phases.primeraLlamada + 1);
    const r = match.rituals[0].r;
    match.monsters.length = 0;
    r.integrity = RITUAL.repairBelow - 5;
    match.tick(now); now += TICK_MS;
    expect(r.phase).toBe('reparar');
    match.handleInput('p0', input(600, { use: true }));
    match.tick(now); now += TICK_MS;
    const nt = match.nameTestOf('p0')!;
    expect(nt).toBeDefined();
    // Se toca justo después de que la aguja pasa por el centro de la zona.
    const at = nt.t0 + (nt.zone / RITUAL.needleSpeed) * 1000 + 40;
    match.handleInput('p0', input(601, { name: nt.zone }));
    match.tick(at);
    expect(sent.p0.filter((m) => m.type === 'name').at(-1)?.result).toBe('perfecto');
    expect(r.phase).toBe('defensa');
    expect(r.integrity).toBeGreaterThan(RITUAL.repairBelow);
    match.stop();
  });

  it('un ángulo imposible se juzga con la aguja del servidor', () => {
    const { match, sent } = setup();
    let now = activate(match, match.phases.primeraLlamada + 1);
    const r = match.rituals[0].r;
    match.monsters.length = 0; r.integrity = 10;
    match.tick(now); now += TICK_MS;
    match.handleInput('p0', input(700, { use: true }));
    match.tick(now);
    const nt = match.nameTestOf('p0')!;
    const at = nt.t0 + 1000, real = needleAt(1000);
    // El cliente dice que la aguja estaba en la zona, pero en realidad estaba lejos.
    const far = (nt.zone + Math.PI) % (Math.PI * 2);
    const claimed = Math.abs(real - nt.zone) > 1.5 ? nt.zone : far;
    match.handleInput('p0', input(701, { name: claimed }));
    match.tick(at);
    const res = sent.p0.filter((m) => m.type === 'name').at(-1)?.result;
    if (claimed === nt.zone) expect(res).toBe('errado');
    expect(match.actor('p0')!.pulseUntil > 0 || res !== 'errado').toBe(true);
    match.stop();
  });

  it('al completarse abre su bóveda, deja una ofrenda y disuelve la oleada', () => {
    const { match, sent } = setup();
    let now = activate(match, match.phases.primeraLlamada + 1);
    const m = match.rituals[0];
    m.r.progress = 0.9999; m.r.wave = 2;
    match.tick(now); now += TICK_MS;
    expect(m.r.phase).toBe('completo');
    expect(match.monsters.filter((x) => x.owner === 0)).toHaveLength(0);
    expect(match.chests.some((c) => c.id === 'rit0' && c.state === 'closed')).toBe(true);
    if (m.vault >= 0) expect(match.map.vaultSeals![m.vault].every((i) => match.map.tiles[i] !== SEAL_VAULT)).toBe(true);
    expect(notices(sent.p1)).toContain('El equipo Ámbar completó un ritual');
    match.stop();
  });

  it('tres rituales despiertan la Bóveda Antigua y el Coloso la abre al caer', () => {
    const { match, sent } = setup();
    let now = activate(match, match.phases.segundaLlamada + 1);
    for (const m of match.rituals.slice(0, 3)) { if (m.r.phase === 'dormido') { m.r.phase = 'defensa'; m.r.team = 0; m.r.wave = 2; } m.r.progress = 0.9999; }
    match.tick(now); now += TICK_MS;
    match.tick(now); now += TICK_MS;
    expect(match.heart).toBe('despierta');
    expect(match.map.sealsOpen.heart).toBe(false);
    const coloso = match.monsters.find((x) => x.kind === 'coloso')!;
    expect(coloso.hp).toBe(MONSTERS.coloso.hp);
    const a = match.actor('p0')!;
    a.x = coloso.x - 30; a.y = coloso.y; coloso.hp = 1;
    match.handleInput('p0', input(800, { fire: { x: coloso.x, y: coloso.y, n: 2 } }));
    expect(match.heart).toBe('abierta');
    match.tick(now);
    expect(match.map.sealsOpen.heart).toBe(true);
    expect(notices(sent.p1)).toContain('El Coloso cayó: la Bóveda Antigua está abierta');
    match.stop();
  });
});
