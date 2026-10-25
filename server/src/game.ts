import {
  PLAYER, TICK_MS, SYNC_SECONDS, computeDamage, applyHealth, generateValidMap, moveCircle, hasLineOfSight,
  phaseAt, scalePhases, DEFAULT_PHASES, placeChests, addToInventory, itemValue, INTERACT_RANGE,
  isSolidWorld, solidAt, pushHistory, positionAt, clampRewind, type TimedPoint, createMoveQueue, enqueueMove, consumeMoves, type MoveQueue,
  FOCOS, DEFAULT_BUILD, abilityFor, inBasicRange, clampAim, fanDirections, GCD_MS, SWAP_MS, DASH_S, DASH_MUL, SLOW_MUL, SLOW_MS, KNOCK_PX, PROJECTILE, TILE,
  type Build, type Slot, type AbilityDef,
  type GridMap, type InputMessage, type MatchRecord, type PhaseConfig,
  type ChestKind,
} from '@shared/index';
import { config } from './config';

export interface Conn { id: string; name: string; send(msg: unknown): void }

interface Actor {
  conn: Conn;
  x: number; y: number; ax: number; ay: number;
  hp: number; shield: number;
  alive: boolean; extracted: boolean;
  input: InputMessage | null; lastSeq: number;
  /** Comandos de movimiento en espera y su acuse para la reconciliación del cliente. */
  moves: MoveQueue;
  cooldownUntil: number; attackAt: number;
  syncT: number;
  kills: number; deaths: number; endedAt: number | null;
  inventory: string[];
  /** Pulsos recibidos entre ticks: un toque rápido nunca se pierde. */
  /** Ataque pendiente con la dirección y el instante que el atacante veía. */
  pendingAttack: { ax: number; ay: number; viewT?: number } | null; pendingUse: boolean;
  /** Posiciones del último segundo, para retroceder el tiempo al revisar golpes. */
  history: TimedPoint[];
  // --- Combate estilo Albion ---
  build: Build; foco: 0 | 1;
  target: string | null; nextBasic: number; viewT?: number;
  /** Recarga de cada habilidad (por id) y recarga global. */
  cds: Record<string, number>; gcdUntil: number; swapReady: number;
  slowUntil: number;
  /** Empuje recibido: velocidad que se aplica unos ticks. */
  knock: { vx: number; vy: number; until: number } | null;
  /** Embestida en curso: dirección y a quién ya golpeó. */
  dash: { dx: number; dy: number; until: number; hit: Set<string> } | null;
  pendingCast: { slot: Slot; x: number; y: number; target?: string } | null; pendingSwap: boolean;
}

interface Projectile { id: number; owner: Actor; x: number; y: number; vx: number; vy: number; left: number; dmg: number }

export interface Chest { id: string; kind: ChestKind; x: number; y: number; state: 'closed' | 'open' | 'empty'; items: string[] }
export interface Remains { id: string; x: number; y: number; items: string[]; owner: string }

/** Radio en el que el servidor envía a otros jugadores: un poco más que la mitad de la diagonal visible (1280×640). */
const VIEW_RADIUS = 760;
const PORTAL_RADIUS = 80;
const BASE_DAMAGE = 22;

/** Partida autoritativa: el servidor decide posiciones, colisiones, daño e inventario. */
export class Match {
  readonly seed = Math.floor(Math.random() * 2 ** 31);
  readonly map: GridMap;
  readonly phases: PhaseConfig = scalePhases(DEFAULT_PHASES, config.matchScale);
  private actors = new Map<string, Actor>();
  readonly chests: Chest[];
  readonly remains: Remains[] = [];
  readonly projectiles: Projectile[] = [];
  private nextProjectile = 1;
  private startedAt = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private finished = false;

  constructor(conns: Conn[], private onEnd: (record: MatchRecord) => void) {
    this.map = generateValidMap(this.seed, conns.length);
    this.chests = placeChests(this.map).map((c) => ({ ...c, state: 'closed' as const }));
    conns.forEach((conn, i) => {
      const sp = this.map.spawns[config.sameSpawn ? 0 : i % this.map.spawns.length];
      const ring = config.sameSpawn ? i : Math.floor(i / this.map.spawns.length);
      // Compañeros de equipo junto a la llegada, en el primer lugar libre de obstáculos.
      const free = (x: number, y: number) => [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI / 4, Math.PI * 1.25].every((a) => !isSolidWorld(this.map, x + Math.cos(a) * PLAYER.radius, y + Math.sin(a) * PLAYER.radius)) && !isSolidWorld(this.map, x, y);
      const offs = ring === 0 ? [[0, 0]] : [[48, 0], [-48, 0], [0, 48], [0, -48], [48, 48], [-48, -48], [48, -48], [-48, 48]].map(([dx, dy]) => [dx * ring, dy * ring]);
      const [ox, oy] = offs.find(([dx, dy]) => free(sp.x + dx, sp.y + dy)) ?? [0, 0];
      this.actors.set(conn.id, {
        conn, x: sp.x + ox, y: sp.y + oy, ax: 0, ay: 1,
        hp: PLAYER.maxHp, shield: 0, alive: true, extracted: false,
        input: null, lastSeq: 0, moves: createMoveQueue(), cooldownUntil: 0, attackAt: 0, syncT: 0,
        kills: 0, deaths: 0, endedAt: null,
        inventory: [], pendingAttack: null, pendingUse: false, history: [],
        build: DEFAULT_BUILD, foco: 0, target: null, nextBasic: 0, cds: {}, gcdUntil: 0, swapReady: 0,
        slowUntil: 0, knock: null, dash: null, pendingCast: null, pendingSwap: false,
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
    if (!a || msg.seq <= a.lastSeq) return;
    a.lastSeq = msg.seq;
    a.input = msg;
    if (msg.viewT !== undefined) a.viewT = msg.viewT;
    if (msg.target !== undefined) a.target = msg.target && msg.target !== id && this.actors.has(msg.target) ? msg.target : null;
    if (msg.swap) a.pendingSwap = true;
    if (msg.use) a.pendingUse = true;
    // La embestida se autoriza al recibir el lanzamiento, antes de los tramos rápidos que vienen detrás.
    if (msg.cast) this.cast(a, msg.cast, Date.now());
    if (a.alive && !a.extracted) enqueueMove(a.moves, { seq: msg.seq, mx: msg.mx, my: msg.my, dt: msg.dt ?? 0, sp: msg.sp ?? 1 });
  }

  /** Acceso de solo lectura para pruebas. */
  actor(id: string) { return this.actors.get(id); }

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

  /** Avanza la simulación un tick. Público para poder probarla sin temporizadores. */
  tick(now = Date.now()) {
    if (this.finished) return;
    const dt = TICK_MS / 1000, t = (now - this.startedAt) / 1000;
    const ph = phaseAt(t, this.phases);
    // Los sellos se abren con las Llamadas: bóvedas mayores en la primera, el Corazón en la segunda.
    this.map.sealsOpen.vault = t >= this.phases.primeraLlamada;
    this.map.sealsOpen.heart = t >= this.phases.segundaLlamada;
    const portals = this.openPortals(t);
    const lastPortal = portals[1];
    const collapseProgress = ph.collapsing ? (t - this.phases.desnombrar) / (this.phases.fin - this.phases.desnombrar) : 0;
    const maxR = this.map.width * 64;
    const collapseR = ph.collapsing ? maxR * (1 - collapseProgress) + 200 * collapseProgress : Infinity;

    for (const a of this.actors.values()) {
      if (!a.alive || a.extracted) continue;
      const inp = a.input;
      if (inp) {
        a.moves.slow = now < a.slowUntil ? SLOW_MUL : 1;
        const p = consumeMoves(this.map, a, a.moves, dt);
        a.x = p.x; a.y = p.y;
        const al = Math.hypot(inp.ax, inp.ay);
        if (al > 0.1) { a.ax = inp.ax / al; a.ay = inp.ay / al; }
        if (a.pendingSwap && now >= a.swapReady) { a.foco = a.foco === 0 ? 1 : 0; a.swapReady = now + SWAP_MS; a.nextBasic = Math.max(a.nextBasic, now + 300); }
        if (a.dash) this.dashHits(a, now);
        this.basicAttack(a, now);
        if (a.pendingUse) this.use(a);
        // Extracción: mantener interactuar junto a un portal abierto.
        const portal = portals.find((pt) => pt.open && Math.hypot(pt.x - a.x, pt.y - a.y) < PORTAL_RADIUS);
        if (portal && inp.interact) {
          a.syncT += dt;
          if (a.syncT >= SYNC_SECONDS[1]) {
            a.extracted = true; a.endedAt = now;
            a.conn.send({ type: 'extracted', value: itemValue(a.inventory), items: a.inventory });
          }
        } else a.syncT = 0;
      }
      a.pendingAttack = null; a.pendingUse = false; a.pendingSwap = false;
      if (a.knock) {
        const k = moveCircle(this.map, a, a.knock.vx * dt, a.knock.vy * dt, PLAYER.radius);
        a.x = k.x; a.y = k.y;
        if (now >= a.knock.until) a.knock = null;
      }
      if (Number.isFinite(collapseR) && Math.hypot(a.x - lastPortal.x, a.y - lastPortal.y) > collapseR) {
        this.hurt(a, 8 * dt * 4, null);
      }
    }

    this.stepProjectiles(dt);
    for (const a of this.actors.values()) if (a.alive && !a.extracted) pushHistory(a.history, { t: now, x: a.x, y: a.y });

    if (ph.ended || [...this.actors.values()].every((a) => !a.alive || a.extracted)) return this.finish(now);
    this.broadcast(t, ph.phase, portals, collapseR);
  }

  private enemies(a: Actor) { return [...this.actors.values()].filter((b) => b !== a && b.alive && !b.extracted); }

  /** Aplica daño de una habilidad o básico y avisa al atacante para el número flotante. */
  private strike(a: Actor, b: Actor, base: number, at: { x: number; y: number }, now: number, rewindMs = 0) {
    const r = computeDamage({ base, rarity: 'comun', targetShield: b.shield });
    b.shield = r.remainingShield;
    this.hurt(b, r.toHealth, a);
    a.conn.send({ type: 'hit', target: b.conn.id, dmg: r.total, x: Math.round(at.x), y: Math.round(at.y), rewindMs });
  }

  private push(b: Actor, dx: number, dy: number, dist: number, now: number) {
    const d = Math.hypot(dx, dy) || 1, ms = 200;
    b.knock = { vx: (dx / d) * dist / (ms / 1000), vy: (dy / d) * dist / (ms / 1000), until: now + ms };
  }

  private fx(kind: string, x: number, y: number, extra: Record<string, unknown> = {}) {
    for (const o of this.actors.values()) if (Math.hypot(o.x - x, o.y - y) < VIEW_RADIUS + 200) o.conn.send({ type: 'fx', kind, x: Math.round(x), y: Math.round(y), ...extra });
  }

  /**
   * Ataque básico estilo Albion: automático sobre el objetivo fijado. Usa compensación de lag:
   * el alcance se revisa en la posición que el atacante veía (máximo 250 ms atrás).
   */
  private basicAttack(a: Actor, now: number) {
    if (!a.target) return;
    const b = this.actors.get(a.target);
    if (!b || !b.alive || b.extracted) { a.target = null; return; }
    if (now < a.nextBasic || a.dash) return;
    const foco = FOCOS[a.build.focos[a.foco]];
    const at = clampRewind(now, a.viewT);
    const seen = positionAt(b.history, at) ?? b;
    const d = Math.hypot(seen.x - a.x, seen.y - a.y);
    if (!inBasicRange(foco, d, PLAYER.radius) || !hasLineOfSight(this.map, a, seen)) return;
    a.ax = (seen.x - a.x) / (d || 1); a.ay = (seen.y - a.y) / (d || 1);
    a.attackAt = now; a.nextBasic = now + 1000 / foco.basic.rate;
    this.strike(a, b, foco.basic.dmg, seen, now, now - at);
  }

  /** Lanza una habilidad: el servidor revisa recarga, recarga global y estado, y aplica el efecto. */
  private cast(a: Actor, c: { slot: Slot; x: number; y: number; target?: string }, now: number) {
    if (!a.alive || a.extracted || now < a.gcdUntil) return;
    const ab: AbilityDef = abilityFor(a.build, a.foco, c.slot);
    if (now < (a.cds[ab.id] ?? 0)) return;
    a.cds[ab.id] = now + ab.cd * 1000; a.gcdUntil = now + GCD_MS;
    const aim = clampAim(a, c, ab.range || 1);
    a.ax = aim.dirX; a.ay = aim.dirY;
    switch (ab.id) {
      case 'llamar_piedra':
        // Se autorizan 0.25 s de velocidad de embestida; el cliente la predice con sus propios tramos.
        a.moves.dashTime = DASH_S; a.moves.dashMul = DASH_MUL;
        a.dash = { dx: aim.dirX, dy: aim.dirY, until: now + DASH_S * 1000 + 250, hit: new Set() };
        this.fx('embestida', a.x, a.y, { dx: aim.dirX, dy: aim.dirY, by: a.conn.id });
        break;
      case 'temblor': case 'barrido': {
        const r = (ab.radius ?? 2) * TILE;
        for (const b of this.enemies(a)) {
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d > r + PLAYER.radius || !hasLineOfSight(this.map, a, b)) continue;
          this.strike(a, b, ab.dmg, b, now);
          if (ab.id === 'temblor') b.slowUntil = now + SLOW_MS;
          else this.push(b, b.x - a.x, b.y - a.y, KNOCK_PX, now);
        }
        this.fx(ab.id, a.x, a.y, { r, by: a.conn.id });
        break;
      }
      case 'andanada':
        for (const [dx, dy] of fanDirections(aim.dirX, aim.dirY)) {
          this.projectiles.push({ id: this.nextProjectile++, owner: a, x: a.x + dx * 24, y: a.y - 20 + dy * 24, vx: dx * PROJECTILE.speed, vy: dy * PROJECTILE.speed, left: ab.range * TILE, dmg: ab.dmg });
        }
        this.fx('andanada', a.x, a.y, { dx: aim.dirX, dy: aim.dirY, by: a.conn.id });
        break;
    }
  }

  /** Durante la embestida, quien queda en el camino recibe daño y es empujado (una vez). */
  private dashHits(a: Actor, now: number) {
    const dash = a.dash!;
    for (const b of this.enemies(a)) {
      if (dash.hit.has(b.conn.id) || Math.hypot(b.x - a.x, b.y - a.y) > PLAYER.radius * 2 + 16) continue;
      dash.hit.add(b.conn.id);
      this.strike(a, b, abilityFor(a.build, a.foco, 'Q').dmg, b, now);
      this.push(b, dash.dx, dash.dy, KNOCK_PX, now);
    }
    if (now >= dash.until) a.dash = null;
  }

  /** Proyectiles: avanzan en pasos cortos, chocan con lo opaco (no con abismos) y con el primer enemigo. */
  private stepProjectiles(dt: number) {
    const now = Date.now();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const steps = 3;
      let dead = false;
      for (let k = 0; k < steps && !dead; k++) {
        p.x += (p.vx * dt) / steps; p.y += (p.vy * dt) / steps; p.left -= (PROJECTILE.speed * dt) / steps;
        if (p.left <= 0 || solidAt(this.map, p.x, p.y + 20, true)) { dead = true; break; }
        for (const b of this.enemies(p.owner)) {
          if (Math.hypot(b.x - p.x, b.y - 22 - p.y) < PLAYER.radius + PROJECTILE.radius) { this.strike(p.owner, b, p.dmg, b, now); dead = true; break; }
        }
      }
      if (dead) this.projectiles.splice(i, 1);
    }
  }

  /**
   * Usar: el servidor valida distancia y estado. Un cofre cerrado se abre; uno abierto
   * (o unos Restos) entrega lo que quepa en la mochila.
   */
  private use(a: Actor) {
    const near = <T extends { x: number; y: number }>(list: T[]) =>
      list.map((o) => ({ o, d: Math.hypot(o.x - a.x, o.y - a.y) })).filter((e) => e.d <= INTERACT_RANGE).sort((x, y) => x.d - y.d)[0]?.o;
    const chest = near(this.chests.filter((c) => c.state !== 'empty'));
    const rem = near(this.remains);
    const target = chest && rem ? (Math.hypot(chest.x - a.x, chest.y - a.y) <= Math.hypot(rem.x - a.x, rem.y - a.y) ? chest : rem) : chest ?? rem;
    if (!target) return;
    if ('state' in target && target.state === 'closed') {
      target.state = 'open';
      a.conn.send({ type: 'opened', id: target.id, items: target.items });
      return;
    }
    const r = addToInventory(a.inventory, target.items);
    if (!r.taken.length) { a.conn.send({ type: 'notice', message: 'Tu mochila está llena.' }); return; }
    a.inventory = r.inventory;
    target.items = r.left;
    if ('state' in target) { if (!r.left.length) target.state = 'empty'; }
    else if (!r.left.length) this.remains.splice(this.remains.indexOf(target), 1);
    a.conn.send({ type: 'looted', items: r.taken, left: r.left.length });
  }

  private hurt(b: Actor, dmg: number, by: Actor | null) {
    b.hp = applyHealth(b.hp, dmg);
    b.syncT = 0;
    if (b.hp <= 0 && b.alive) {
      b.alive = false; b.deaths++; b.endedAt = Date.now();
      if (by) by.kills++;
      this.dropRemains(b);
      b.conn.send({ type: 'died', by: by?.conn.name ?? 'El Desnombrar' });
    }
  }

  /** Al morir, todo lo que llevaba queda en el suelo como Restos que cualquiera puede saquear. */
  private dropRemains(b: Actor) {
    if (!b.inventory.length) return;
    this.remains.push({ id: `r${this.remains.length}-${b.conn.id}`, x: b.x, y: b.y, items: b.inventory, owner: b.conn.name });
    b.inventory = [];
  }

  private broadcast(t: number, phase: string, portals: { x: number; y: number; open: boolean }[], collapseR: number) {
    const all = [...this.actors.values()];
    for (const a of all) {
      const others = all
        .filter((b) => b !== a && b.alive && !b.extracted)
        .filter((b) => Math.hypot(b.x - a.x, b.y - a.y) < VIEW_RADIUS && hasLineOfSight(this.map, a, b))
        .map((b) => ({ id: b.conn.id, name: b.conn.name, x: Math.round(b.x), y: Math.round(b.y), hp: b.hp, ax: b.ax, ay: b.ay, atk: Date.now() - b.attackAt < 200, tg: b.target, foco: b.build.focos[b.foco], slow: Date.now() < b.slowUntil }));
      const now = Date.now();
      const cd = (slot: Slot) => Math.max(0, Math.round((a.cds[abilityFor(a.build, a.foco, slot).id] ?? 0) - now));
      a.conn.send({
        type: 'snap', t: Date.now(), time: Math.round(t * 10) / 10, phase,
        timeLeft: Math.max(0, Math.round(this.phases.fin - t)),
        portals, collapseR: Number.isFinite(collapseR) ? Math.round(collapseR) : null,
        chests: this.chests.filter((c) => Math.hypot(c.x - a.x, c.y - a.y) < VIEW_RADIUS).map((c) => ({ id: c.id, k: c.kind, x: c.x, y: c.y, s: c.state })),
        remains: this.remains.filter((r) => Math.hypot(r.x - a.x, r.y - a.y) < VIEW_RADIUS).map((r) => ({ id: r.id, x: Math.round(r.x), y: Math.round(r.y), owner: r.owner })),
        you: {
          x: a.x, y: a.y, hp: a.hp, alive: a.alive, extracted: a.extracted, sync: a.syncT, syncNeed: SYNC_SECONDS[1], seq: a.lastSeq, ack: a.moves.ack, ackRem: a.moves.ackRem,
          kills: a.kills, atk: now - a.attackAt < 200, attackAt: a.attackAt, inv: a.inventory,
          target: a.target, foco: a.foco, build: a.build, slow: now < a.slowUntil ? SLOW_MUL : 1,
          cds: { Q: cd('Q'), E: cd('E'), R: cd('R') }, gcd: Math.max(0, a.gcdUntil - now), swap: Math.max(0, a.swapReady - now),
        },
        projectiles: this.projectiles.filter((p) => Math.hypot(p.x - a.x, p.y - a.y) < VIEW_RADIUS + 200).map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy) })),
        others,
      });
    }
  }

  private finish(now: number) {
    this.finished = true;
    if (this.timer) clearInterval(this.timer);
    const durationS = (now - this.startedAt) / 1000;
    const players = [...this.actors.values()].map((a) => {
      if (a.alive && !a.extracted) { a.alive = false; a.deaths++; a.endedAt = now; a.inventory = []; }
      return {
        name: a.conn.name, kills: a.kills, deaths: a.deaths, extracted: a.extracted,
        lootValue: a.extracted ? itemValue(a.inventory) : 0,
        survivedS: Math.round(((a.endedAt ?? now) - this.startedAt) / 100) / 10,
      };
    });
    const record: MatchRecord = { id: `match-${this.seed}-${now}`, endedAt: now, durationS: Math.round(durationS * 10) / 10, players };
    for (const a of this.actors.values()) a.conn.send({ type: 'end', results: players });
    this.onEnd(record);
  }

  stop() { this.finished = true; if (this.timer) clearInterval(this.timer); }
}
