import {
  PLAYER, TICK_MS, SYNC_SECONDS, computeDamage, applyHealth, generateValidMap, moveCircle, hasLineOfSight,
  phaseAt, scalePhases, DEFAULT_PHASES, type GridMap, type InputMessage, type MatchRecord, type PhaseConfig,
} from '@shared/index';
import { config } from './config';

export interface Conn { id: string; name: string; send(msg: unknown): void }

interface Actor {
  conn: Conn;
  x: number; y: number; ax: number; ay: number;
  hp: number; shield: number;
  alive: boolean; extracted: boolean;
  input: InputMessage | null; lastSeq: number;
  cooldownUntil: number; attackAt: number;
  syncT: number;
  kills: number; deaths: number; endedAt: number | null;
}

const VIEW_RADIUS = 900;
const PORTAL_RADIUS = 80;
const BASE_DAMAGE = 22;

/** Partida autoritativa: el servidor decide posiciones, colisiones, daño e inventario. */
export class Match {
  readonly seed = Math.floor(Math.random() * 2 ** 31);
  readonly map: GridMap;
  readonly phases: PhaseConfig = scalePhases(DEFAULT_PHASES, config.matchScale);
  private actors = new Map<string, Actor>();
  private startedAt = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private finished = false;

  constructor(conns: Conn[], private onEnd: (record: MatchRecord) => void) {
    this.map = generateValidMap(this.seed, conns.length);
    conns.forEach((conn, i) => {
      const sp = this.map.spawns[i % this.map.spawns.length];
      const ring = Math.floor(i / this.map.spawns.length);
      this.actors.set(conn.id, {
        conn, x: sp.x + ring * 48, y: sp.y + ring * 48, ax: 0, ay: 1,
        hp: PLAYER.maxHp, shield: 0, alive: true, extracted: false,
        input: null, lastSeq: 0, cooldownUntil: 0, attackAt: 0, syncT: 0,
        kills: 0, deaths: 0, endedAt: null,
      });
    });
  }

  start() {
    for (const a of this.actors.values()) {
      a.conn.send({ type: 'start', seed: this.seed, players: this.actors.size, you: a.conn.id, phases: this.phases, x: a.x, y: a.y });
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  handleInput(id: string, msg: InputMessage) {
    const a = this.actors.get(id);
    if (a && msg.seq >= a.lastSeq) a.input = msg;
  }

  removePlayer(id: string) {
    const a = this.actors.get(id);
    if (a && a.alive && !a.extracted) { a.alive = false; a.endedAt = Date.now(); }
  }

  private elapsed() { return (Date.now() - this.startedAt) / 1000; }

  private openPortals(t: number) {
    const ph = phaseAt(t, this.phases);
    const [i1, i2] = this.map.portals;
    return [
      { ...this.map.portalCandidates[i1], open: ph.portal1Open },
      { ...this.map.portalCandidates[i2], open: ph.portal2Open },
    ];
  }

  private tick() {
    if (this.finished) return;
    const now = Date.now(), dt = TICK_MS / 1000, t = this.elapsed();
    const ph = phaseAt(t, this.phases);
    const portals = this.openPortals(t);
    const lastPortal = portals[1];
    const collapseProgress = ph.collapsing ? (t - this.phases.desnombrar) / (this.phases.fin - this.phases.desnombrar) : 0;
    const maxR = this.map.width * 64;
    const collapseR = ph.collapsing ? maxR * (1 - collapseProgress) + 200 * collapseProgress : Infinity;

    for (const a of this.actors.values()) {
      if (!a.alive || a.extracted) continue;
      const inp = a.input;
      if (inp) {
        a.lastSeq = inp.seq;
        let mx = inp.mx, my = inp.my;
        const l = Math.hypot(mx, my);
        if (l > 1) { mx /= l; my /= l; }
        const p = moveCircle(this.map, a, mx * PLAYER.speed * dt, my * PLAYER.speed * dt, PLAYER.radius);
        a.x = p.x; a.y = p.y;
        const al = Math.hypot(inp.ax, inp.ay);
        if (al > 0.1) { a.ax = inp.ax / al; a.ay = inp.ay / al; }
        if (inp.attack && now >= a.cooldownUntil) this.attack(a, now);
        // Extracción: mantener interactuar junto a un portal abierto.
        const portal = portals.find((pt) => pt.open && Math.hypot(pt.x - a.x, pt.y - a.y) < PORTAL_RADIUS);
        if (portal && inp.interact) {
          a.syncT += dt;
          if (a.syncT >= SYNC_SECONDS[1]) { a.extracted = true; a.endedAt = now; a.conn.send({ type: 'extracted' }); }
        } else a.syncT = 0;
      }
      if (Number.isFinite(collapseR) && Math.hypot(a.x - lastPortal.x, a.y - lastPortal.y) > collapseR) {
        this.hurt(a, 8 * dt * 4, null);
      }
    }

    if (ph.ended || [...this.actors.values()].every((a) => !a.alive || a.extracted)) return this.finish(now);
    this.broadcast(t, ph.phase, portals, collapseR);
  }

  private attack(a: Actor, now: number) {
    a.cooldownUntil = now + PLAYER.attackCooldownMs;
    a.attackAt = now;
    for (const b of this.actors.values()) {
      if (b === a || !b.alive || b.extracted) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > PLAYER.attackRange || (dx * a.ax + dy * a.ay) / (d || 1) < PLAYER.attackArc) continue;
      if (!hasLineOfSight(this.map, a, b)) continue;
      const r = computeDamage({ base: BASE_DAMAGE, rarity: 'comun', targetShield: b.shield });
      b.shield = r.remainingShield;
      this.hurt(b, r.toHealth, a);
    }
  }

  private hurt(b: Actor, dmg: number, by: Actor | null) {
    b.hp = applyHealth(b.hp, dmg);
    b.syncT = 0;
    if (b.hp <= 0 && b.alive) {
      b.alive = false; b.deaths++; b.endedAt = Date.now();
      if (by) by.kills++;
      b.conn.send({ type: 'died', by: by?.conn.name ?? 'El Desnombrar' });
    }
  }

  private broadcast(t: number, phase: string, portals: { x: number; y: number; open: boolean }[], collapseR: number) {
    const all = [...this.actors.values()];
    for (const a of all) {
      const others = all
        .filter((b) => b !== a && b.alive && !b.extracted)
        .filter((b) => Math.hypot(b.x - a.x, b.y - a.y) < VIEW_RADIUS && hasLineOfSight(this.map, a, b))
        .map((b) => ({ id: b.conn.id, name: b.conn.name, x: Math.round(b.x), y: Math.round(b.y), hp: b.hp, ax: b.ax, ay: b.ay, atk: Date.now() - b.attackAt < 200 }));
      a.conn.send({
        type: 'snap', t: Date.now(), time: Math.round(t * 10) / 10, phase,
        timeLeft: Math.max(0, Math.round(this.phases.fin - t)),
        portals, collapseR: Number.isFinite(collapseR) ? Math.round(collapseR) : null,
        you: { x: a.x, y: a.y, hp: a.hp, alive: a.alive, extracted: a.extracted, sync: a.syncT, syncNeed: SYNC_SECONDS[1], seq: a.lastSeq, kills: a.kills, atk: Date.now() - a.attackAt < 200 },
        others,
      });
    }
  }

  private finish(now: number) {
    this.finished = true;
    if (this.timer) clearInterval(this.timer);
    const durationS = (now - this.startedAt) / 1000;
    const players = [...this.actors.values()].map((a) => {
      if (a.alive && !a.extracted) { a.alive = false; a.deaths++; a.endedAt = now; }
      return {
        name: a.conn.name, kills: a.kills, deaths: a.deaths, extracted: a.extracted,
        survivedS: Math.round(((a.endedAt ?? now) - this.startedAt) / 100) / 10,
      };
    });
    const record: MatchRecord = { id: `match-${this.seed}-${now}`, endedAt: now, durationS: Math.round(durationS * 10) / 10, players };
    for (const a of this.actors.values()) a.conn.send({ type: 'end', results: players });
    this.onEnd(record);
  }

  stop() { this.finished = true; if (this.timer) clearInterval(this.timer); }
}
