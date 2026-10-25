import {
  PLAYER, TICK_MS, SYNC_SECONDS, computeDamage, applyHealth, generateValidMap, moveCircle, hasLineOfSight,
  phaseAt, scalePhases, DEFAULT_PHASES, placeChests, addToInventory, itemValue, INTERACT_RANGE,
  isSolidWorld, solidAt, pushHistory, positionAt, clampRewind, type TimedPoint, createMoveQueue, enqueueMove, consumeMoves, type MoveQueue,
  FOCOS, abilityFor, clampAim, fanDirections, inCone, inLine, blinkTarget, reloadAmmo, dashMulFor,
  AMMO_MAX, GCD_MS, SWAP_MS, DASH_S, SLOW_MUL, TILE,
  type Build, type Slot, type AbilityDef, type Effect, type ProjectileDef,
  type GridMap, type InputMessage, type MatchRecord, type PhaseConfig,
  type ChestKind, teamSpawns, buildFromProfile, appearanceOf, type Profile, type Appearance,
  RESONANCE, TEAMS, newTeamResonance, stepTeamResonance, pickRelocation, zoneOf, timeMultiplier, type TeamResonance,
} from '@shared/index';
import { config } from './config';

export interface Conn { id: string; name: string; send(msg: unknown): void }

interface Actor {
  conn: Conn;
  /** Equipo (0 a 3): no hay daño entre compañeros y se ven siempre. */
  team: number;
  /** Aspecto elegido en Preparación (cuerpo, ropa y cabeza). */
  app: Appearance;
  x: number; y: number; ax: number; ay: number;
  hp: number; shield: number;
  alive: boolean; extracted: boolean;
  input: InputMessage | null; lastSeq: number;
  /** Comandos de movimiento en espera y su acuse para la reconciliación del cliente. */
  moves: MoveQueue;
  attackAt: number;
  syncT: number;
  /** Portal (0 o 1) con el que se sincroniza y hasta cuándo ese portal lo delata a los rivales en sus anillos. */
  syncPortal: number; syncRevealUntil: number;
  /** Escudo arcano de la Resonancia: cuánto se dio y cuándo se acaba. */
  shieldGrant: number; shieldUntil: number;
  kills: number; deaths: number; endedAt: number | null;
  inventory: string[];
  pendingUse: boolean; pendingSwap: boolean;
  /** Posiciones del último segundo, para retroceder el tiempo al revisar golpes. */
  history: TimedPoint[];
  // --- Combate apuntado (estilo Brawl Stars) ---
  build: Build; foco: 0 | 1; viewT?: number;
  /** Cargas del básico (0 a 3, con fracción mientras recarga) y cuándo puede volver a disparar. */
  ammo: number; nextShot: number;
  /** Recarga de cada habilidad (por id) y recarga global. */
  cds: Record<string, number>; gcdUntil: number; swapReady: number;
  slowUntil: number; rootUntil: number; invisUntil: number;
  /** Revelar: hasta cuándo y en qué radio (px) el equipo ve a los rivales a través de muros. */
  revealUntil: number; revealR: number;
  /** Empuje recibido: velocidad que se aplica unos ticks. */
  knock: { vx: number; vy: number; until: number } | null;
  /** Embestida en curso: dirección, efecto y a quién ya golpeó. */
  dash: { dx: number; dy: number; until: number; hit: Set<string>; effect: Effect } | null;
}

interface Projectile {
  id: number; owner: Actor; kind: string; n?: number;
  x: number; y: number; vx: number; vy: number; left: number; speed: number; radius: number;
  effect: Effect; pierce: boolean; hit: Set<string>;
}

export interface Chest { id: string; kind: ChestKind; x: number; y: number; state: 'closed' | 'open' | 'empty'; items: string[] }
export interface Remains { id: string; x: number; y: number; items: string[]; owner: string }
/** Portal en la instantánea: posición, si está abierto y qué tan inestable está (0 a 1). */
export interface PortalView { x: number; y: number; open: boolean; u: number }

/** Radio en el que el servidor envía a otros jugadores: un poco más que la mitad de la diagonal visible (1280×640). */
const VIEW_RADIUS = 760;
const PORTAL_RADIUS = 80;
/** A esta distancia un invisible se deja ver (como los arbustos de Brawl Stars). */
const INVIS_NEAR = 1.5 * TILE;

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
  /** Candidato que ocupa cada portal (cambia cuando la Resonancia lo relocaliza). */
  private portalIdx: [number, number];
  /** Resonancia por equipo y segundos de inestabilidad de cada portal. */
  private res = new Map<number, TeamResonance>();
  private unstable: [number, number] = [0, 0];

  constructor(entries: (Conn | { conn: Conn; team: number; profile?: Profile })[], private onEnd: (record: MatchRecord) => void) {
    // Sin equipo indicado, cada jugador va solo (todos contra todos), como en las pruebas.
    const list = entries.map((e, i) => ('conn' in e ? e : { conn: e, team: i % 4, profile: undefined as Profile | undefined }));
    this.map = generateValidMap(this.seed, list.length);
    this.portalIdx = [...this.map.portals];
    this.chests = placeChests(this.map).map((c) => ({ ...c, state: 'closed' as const }));
    const spawnOf = teamSpawns(list.map((e) => e.team), this.map.spawns.length);
    const placed = new Map<number, number>();
    list.forEach(({ conn, team, profile }, i) => {
      // Cada equipo sale de su propia llegada; los compañeros, alrededor.
      const k = placed.get(team) ?? 0; placed.set(team, k + 1);
      const sp = this.map.spawns[config.sameSpawn ? 0 : spawnOf.get(team)!];
      const ring = config.sameSpawn ? i : k;
      // Compañeros de equipo junto a la llegada, en el primer lugar libre de obstáculos.
      const free = (x: number, y: number) => [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI / 4, Math.PI * 1.25].every((a) => !isSolidWorld(this.map, x + Math.cos(a) * PLAYER.radius, y + Math.sin(a) * PLAYER.radius)) && !isSolidWorld(this.map, x, y);
      const offs = ring === 0 ? [[0, 0]] : [[48, 0], [-48, 0], [0, 48], [0, -48], [48, 48], [-48, -48], [48, -48], [-48, 48]].map(([dx, dy]) => [dx * ring, dy * ring]);
      const [ox, oy] = offs.find(([dx, dy]) => free(sp.x + dx, sp.y + dy)) ?? [0, 0];
      this.actors.set(conn.id, {
        conn, team, app: appearanceOf(profile, conn.id), x: sp.x + ox, y: sp.y + oy, ax: 0, ay: 1,
        hp: PLAYER.maxHp, shield: 0, alive: true, extracted: false,
        input: null, lastSeq: 0, moves: createMoveQueue(), attackAt: 0, syncT: 0,
        syncPortal: -1, syncRevealUntil: 0, shieldGrant: 0, shieldUntil: 0,
        kills: 0, deaths: 0, endedAt: null,
        inventory: [], pendingUse: false, pendingSwap: false, history: [],
        build: buildFromProfile(profile), foco: 0, ammo: AMMO_MAX, nextShot: 0, cds: {}, gcdUntil: 0, swapReady: 0,
        slowUntil: 0, rootUntil: 0, invisUntil: 0, revealUntil: 0, revealR: 0, knock: null, dash: null,
      });
    });
  }

  start() {
    const roster = [...this.actors.values()].map((b) => ({ id: b.conn.id, name: b.conn.name, team: b.team, app: b.app }));
    for (const a of this.actors.values()) {
      a.conn.send({ type: 'start', seed: this.seed, players: this.actors.size, you: a.conn.id, team: a.team, roster, build: a.build, phases: this.phases, x: a.x, y: a.y });
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  handleInput(id: string, msg: InputMessage) {
    const a = this.actors.get(id);
    if (!a || msg.seq <= a.lastSeq) return;
    a.lastSeq = msg.seq;
    a.input = msg;
    if (msg.viewT !== undefined) a.viewT = msg.viewT;
    if (msg.swap) a.pendingSwap = true;
    if (msg.use) a.pendingUse = true;
    const now = Date.now();
    // Disparos y habilidades se resuelven al llegar, antes de los tramos de movimiento que vienen detrás
    // (así la embestida y el parpadeo coinciden con lo que predijo el cliente).
    if (msg.fire) this.fire(a, msg.fire, now);
    if (msg.cast) this.cast(a, msg.cast, now);
    if (a.alive && !a.extracted) enqueueMove(a.moves, { seq: msg.seq, mx: msg.mx, my: msg.my, dt: msg.dt ?? 0, sp: msg.sp ?? 1 });
  }

  /** Acceso de solo lectura para pruebas. */
  actor(id: string) { return this.actors.get(id); }

  removePlayer(id: string) {
    const a = this.actors.get(id);
    if (a && a.alive && !a.extracted) { a.alive = false; a.endedAt = Date.now(); }
  }

  private openPortals(t: number): PortalView[] {
    const ph = phaseAt(t, this.phases);
    const [i1, i2] = this.portalIdx;
    const u = (i: number) => Math.round(Math.min(1, this.unstable[i] / RESONANCE.unstableSeconds) * 100) / 100;
    return [
      { ...this.map.portalCandidates[i1], open: ph.portal1Open, u: u(0) },
      { ...this.map.portalCandidates[i2], open: ph.portal2Open, u: u(1) },
    ];
  }

  /** Lectura para pruebas: Resonancia de un equipo y candidato de cada portal. */
  resonanceOf(team: number) { return this.res.get(team); }
  portalSlots(): readonly [number, number] { return this.portalIdx; }

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
      // Las cargas se recargan solas al ritmo del Foco en la mano.
      a.ammo = reloadAmmo(a.ammo, TICK_MS, FOCOS[a.build.focos[a.foco]].basic.reloadMs);
      const inp = a.input;
      if (inp) {
        // Inmovilizado: no avanza (la embestida tampoco). Ralentizado: 60 %.
        a.moves.slow = now < a.rootUntil ? 0 : now < a.slowUntil ? SLOW_MUL : 1;
        const p = consumeMoves(this.map, a, a.moves, dt);
        a.x = p.x; a.y = p.y;
        const al = Math.hypot(inp.ax, inp.ay);
        if (al > 0.1) { a.ax = inp.ax / al; a.ay = inp.ay / al; }
        if (a.pendingSwap && now >= a.swapReady) { a.foco = a.foco === 0 ? 1 : 0; a.swapReady = now + SWAP_MS; a.nextShot = Math.max(a.nextShot, now + 250); }
        if (a.dash) this.dashHits(a, now);
        if (a.pendingUse) this.use(a);
        // Extracción: mantener interactuar junto a un portal abierto.
        const portal = portals.find((pt) => pt.open && Math.hypot(pt.x - a.x, pt.y - a.y) < PORTAL_RADIUS);
        if (portal && inp.interact) {
          if (a.syncT === 0) this.startSync(a, portals.indexOf(portal), ph.resonanceActive, now);
          a.syncT += dt;
          if (a.syncT >= SYNC_SECONDS[1]) {
            a.extracted = true; a.endedAt = now;
            a.conn.send({ type: 'extracted', value: itemValue(a.inventory), items: a.inventory });
            this.tellTeam(a, `${a.conn.name} escapó de la Grid`);
          }
        } else a.syncT = 0;
      }
      a.pendingUse = false; a.pendingSwap = false;
      if (a.shieldUntil && now >= a.shieldUntil) { a.shield = Math.max(0, a.shield - a.shieldGrant); a.shieldGrant = 0; a.shieldUntil = 0; }
      if (a.knock) {
        const k = moveCircle(this.map, a, a.knock.vx * dt, a.knock.vy * dt, PLAYER.radius);
        a.x = k.x; a.y = k.y;
        if (now >= a.knock.until) a.knock = null;
      }
      if (Number.isFinite(collapseR) && Math.hypot(a.x - lastPortal.x, a.y - lastPortal.y) > collapseR) {
        this.hurt(a, 8 * dt * 4, null);
      }
    }

    this.stepResonance(ph.resonanceActive, portals, dt, now);
    this.stepProjectiles(dt, now);
    for (const a of this.actors.values()) if (a.alive && !a.extracted) pushHistory(a.history, { t: now, x: a.x, y: a.y });

    if (ph.ended || [...this.actors.values()].every((a) => !a.alive || a.extracted)) return this.finish(now);
    // Se vuelven a leer los portales: la Resonancia pudo relocalizar uno en este tick.
    this.broadcast(t, ph.phase, this.openPortals(t), collapseR, ph.resonanceActive);
  }

  /** Distancia al portal abierto más cercano (Infinity si no hay ninguno abierto). */
  private portalDistance(a: { x: number; y: number }, portals: PortalView[]) {
    let d = Infinity;
    for (const p of portals) if (p.open) d = Math.min(d, Math.hypot(p.x - a.x, p.y - a.y));
    return d;
  }

  /**
   * Al empezar a sincronizar: el portal delata al jugador unos segundos a los rivales en sus anillos
   * y, si su equipo está marcado, le da un escudo arcano breve (GDD sección 4).
   */
  private startSync(a: Actor, slot: number, resonanceActive: boolean, now: number) {
    a.syncPortal = slot;
    if (!resonanceActive) return;
    a.syncRevealUntil = now + RESONANCE.syncRevealMs;
    if (this.res.get(a.team)?.marked && now >= a.shieldUntil) {
      a.shield += RESONANCE.syncShield; a.shieldGrant = RESONANCE.syncShield; a.shieldUntil = now + RESONANCE.syncShieldMs;
      a.conn.send({ type: 'notice', message: 'Escudo arcano: el portal te protege mientras te sincronizas' });
    }
  }

  /**
   * Resonancia del portal (anti-campeo): barra por equipo según presencia en los anillos, marca al
   * llenarse, daño constante a los marcados dentro de los anillos y relocalización del portal si un
   * equipo marcado sigue en el anillo cercano. El Desnombrar la apaga.
   */
  private stepResonance(active: boolean, portals: PortalView[], dt: number, now: number) {
    if (!active) {
      if (this.res.size) { this.res.clear(); this.unstable = [0, 0]; }
      return;
    }
    const teams = new Map<number, Actor[]>();
    for (const a of this.actors.values()) {
      const list = teams.get(a.team) ?? []; teams.set(a.team, list);
      if (a.alive && !a.extracted) list.push(a);
    }
    for (const [team, members] of teams) {
      const presence = members.map((a) => ({ distance: this.portalDistance(a, portals), syncing: a.syncT > 0 }));
      const { state, event } = stepTeamResonance(this.res.get(team) ?? newTeamResonance(), presence, dt);
      this.res.set(team, state);
      if (event === 'marked') this.announceMark(team);
      else if (event === 'cleared') this.tellTeamId(team, 'La marca de la Resonancia se desvaneció');
      if (!state.marked) continue;
      // Marcados: daño constante mientras sigan dentro de los anillos (quien se sincroniza no lo recibe).
      for (const a of members) {
        if (a.alive && a.syncT === 0 && this.portalDistance(a, portals) <= RESONANCE.farRadius) this.hurt(a, RESONANCE.markedDps * dt, null, 'La Resonancia');
      }
    }
    // El portal se defiende: un equipo marcado en su anillo cercano lo vuelve inestable.
    portals.forEach((p, i) => {
      if (!p.open) { this.unstable[i] = 0; return; }
      let pressed = false;
      for (const a of this.actors.values()) {
        if (a.alive && !a.extracted && a.syncT === 0 && this.res.get(a.team)?.marked && Math.hypot(a.x - p.x, a.y - p.y) <= RESONANCE.nearRadius) { pressed = true; break; }
      }
      this.unstable[i] = pressed ? this.unstable[i] + dt : Math.max(0, this.unstable[i] - dt * 0.5);
      if (this.unstable[i] >= RESONANCE.unstableSeconds) this.relocatePortal(i, p);
    });
  }

  /** Cierra el portal inestable y lo abre en el candidato libre más alejado. */
  private relocatePortal(slot: number, from: PortalView) {
    this.unstable[slot] = 0;
    const to = pickRelocation(this.map.portalCandidates, this.portalIdx);
    if (to == null) return;
    this.portalIdx[slot] = to;
    const dest = this.map.portalCandidates[to];
    // Quien se sincronizaba con ese portal pierde la sincronización.
    for (const a of this.actors.values()) if (a.syncT > 0 && a.syncPortal === slot) a.syncT = 0;
    this.fx('portal-shift', from.x, from.y);
    this.fx('portal-shift', dest.x, dest.y);
    for (const a of this.actors.values()) a.conn.send({ type: 'notice', message: `¡El portal ${slot + 1} se volvió inestable y reapareció en otro lugar!` });
  }

  private announceMark(team: number) {
    const name = TEAMS[team]?.name ?? `${team + 1}`;
    for (const a of this.actors.values()) {
      a.conn.send({ type: 'notice', message: a.team === team ? '¡La Resonancia marcó a tu equipo! Todos los rivales los ven' : `La Resonancia marcó al equipo ${name}` });
    }
  }

  /** Aviso a todo un equipo (por número). */
  private tellTeamId(team: number, message: string) {
    for (const a of this.actors.values()) if (a.team === team) a.conn.send({ type: 'notice', message });
  }

  /** Rivales vivos: los compañeros nunca reciben daño de habilidades, básicos ni proyectiles. */
  private enemies(a: Actor) { return [...this.actors.values()].filter((b) => b.team !== a.team && b.alive && !b.extracted); }
  private allies(a: Actor) { return [...this.actors.values()].filter((b) => b.team === a.team && b.alive && !b.extracted); }

  /** Aviso a los compañeros de un jugador. */
  private tellTeam(a: Actor, message: string) {
    for (const b of this.actors.values()) if (b !== a && b.team === a.team) b.conn.send({ type: 'notice', message });
  }

  /** Aplica daño y avisa al atacante para el número flotante. */
  private strike(a: Actor, b: Actor, base: number, at: { x: number; y: number }, rewindMs = 0) {
    if (a.team === b.team) return;
    const r = computeDamage({ base, rarity: 'comun', targetShield: b.shield });
    b.shield = r.remainingShield;
    this.hurt(b, r.toHealth, a);
    a.conn.send({ type: 'hit', target: b.conn.id, dmg: r.total, x: Math.round(at.x), y: Math.round(at.y), rewindMs });
  }

  /** Efectos de un golpe o un área: daño y estados a rivales; curación a aliados. */
  private applyEffect(a: Actor, b: Actor, e: Effect, origin: { x: number; y: number }, now: number, at: { x: number; y: number } = b, rewindMs = 0) {
    if (b.team === a.team) {
      if (e.heal && b.alive) {
        b.hp = Math.min(PLAYER.maxHp, b.hp + e.heal);
        for (const c of new Set([a, b])) c.conn.send({ type: 'heal', target: b.conn.id, amt: e.heal, x: Math.round(b.x), y: Math.round(b.y) });
      }
      return;
    }
    if (e.dmg) this.strike(a, b, e.dmg, at, rewindMs);
    if (!b.alive) return;
    if (e.slowMs) b.slowUntil = Math.max(b.slowUntil, now + e.slowMs);
    if (e.rootMs) b.rootUntil = Math.max(b.rootUntil, now + e.rootMs);
    if (e.knock) this.push(b, b.x - origin.x, b.y - origin.y, e.knock * TILE, now);
  }

  private push(b: Actor, dx: number, dy: number, dist: number, now: number) {
    const d = Math.hypot(dx, dy) || 1, ms = 200;
    b.knock = { vx: (dx / d) * dist / (ms / 1000), vy: (dy / d) * dist / (ms / 1000), until: now + ms };
  }

  private fx(kind: string, x: number, y: number, extra: Record<string, unknown> = {}) {
    for (const o of this.actors.values()) if (Math.hypot(o.x - x, o.y - y) < VIEW_RADIUS + 300) o.conn.send({ type: 'fx', kind, x: Math.round(x), y: Math.round(y), ...extra });
  }

  private spawnProjectiles(a: Actor, dirX: number, dirY: number, def: ProjectileDef, rangeTiles: number, effect: Effect, kind: string, n?: number) {
    for (const [dx, dy] of fanDirections(dirX, dirY, def.count ?? 1, ((def.spreadDeg ?? 0) * Math.PI) / 180)) {
      this.projectiles.push({
        id: this.nextProjectile++, owner: a, kind, n,
        x: a.x + dx * 20, y: a.y - 22 + dy * 20, vx: dx * def.speed, vy: dy * def.speed, speed: def.speed,
        left: rangeTiles * TILE, radius: def.radius, effect, pierce: !!def.pierce, hit: new Set(),
      });
    }
  }

  /**
   * Básico apuntado: gasta una carga y sale hacia el punto. Los arcos cuerpo a cuerpo se revisan
   * con compensación de lag (posiciones que el atacante veía, máximo 250 ms atrás); los proyectiles
   * viajan y se pueden esquivar.
   */
  private fire(a: Actor, f: { x: number; y: number; n: number }, now: number) {
    if (!a.alive || a.extracted || now < a.nextShot || a.ammo < 1) return;
    const foco = FOCOS[a.build.focos[a.foco]], b = foco.basic;
    const aim = clampAim(a, f, b.shape.range);
    a.ammo -= 1; a.nextShot = now + b.intervalMs; a.attackAt = now; a.invisUntil = 0;
    a.ax = aim.dirX; a.ay = aim.dirY;
    const effect: Effect = { dmg: b.dmg, ...(b.effect ?? {}) };
    if (b.delivery === 'proyectil') { this.spawnProjectiles(a, aim.dirX, aim.dirY, b.projectile!, b.shape.range, effect, foco.id, f.n); return; }
    const at = clampRewind(now, a.viewT);
    // Arco (cono) o estocada (línea): se revisa contra lo que veía el atacante.
    const line = b.shape.type === 'linea';
    for (const t of this.enemies(a)) {
      const seen = positionAt(t.history, at) ?? t;
      const inside = line ? inLine(a, aim.dirX, aim.dirY, seen, b.shape.range, b.shape.width ?? 0.5) : inCone(a, aim.dirX, aim.dirY, seen, b.shape.range, b.shape.angle ?? 90);
      if (!inside || !hasLineOfSight(this.map, a, seen)) continue;
      this.applyEffect(a, t, effect, a, now, seen, now - at);
    }
    this.fx(line ? 'estocada' : 'arco', a.x, a.y, { dx: aim.dirX, dy: aim.dirY, r: b.shape.range * TILE, ang: b.shape.angle, w: (b.shape.width ?? 0) * TILE, rgb: foco.rgb, by: a.conn.id });
  }

  /** Lanza una habilidad: el servidor revisa recarga, recarga global y estado, y aplica el efecto. */
  private cast(a: Actor, c: { slot: Slot; x: number; y: number; n?: number }, now: number) {
    if (!a.alive || a.extracted || now < a.gcdUntil) return;
    const ab: AbilityDef = abilityFor(a.build, a.foco, c.slot);
    if (now < (a.cds[ab.id] ?? 0)) return;
    a.cds[ab.id] = now + ab.cd * 1000; a.gcdUntil = now + GCD_MS;
    const s = ab.shape, aim = clampAim(a, c, s.range || 1);
    if (s.type !== 'propio') { a.ax = aim.dirX; a.ay = aim.dirY; }
    if (!ab.effect.invisMs) a.invisUntil = 0; // atacar o lanzar descubre al invisible
    const base = { by: a.conn.id, rgb: ab.rgb };
    switch (ab.delivery) {
      case 'embestida':
        // Se autoriza la velocidad de embestida; el cliente la predice con sus propios tramos.
        a.moves.dashTime = DASH_S; a.moves.dashMul = dashMulFor(s.range);
        a.dash = { dx: aim.dirX, dy: aim.dirY, until: now + DASH_S * 1000 + 250, hit: new Set(), effect: ab.effect };
        this.fx(ab.id, a.x, a.y, { ...base, dx: aim.dirX, dy: aim.dirY, r: s.range * TILE });
        return;
      case 'parpadeo': {
        const from = { x: a.x, y: a.y }, to = blinkTarget(this.map, a, c, s.range);
        a.x = to.x; a.y = to.y; a.history = [];
        this.fx(ab.id, from.x, from.y, { ...base, x2: Math.round(to.x), y2: Math.round(to.y) });
        return;
      }
      case 'proyectil':
        this.spawnProjectiles(a, aim.dirX, aim.dirY, ab.projectile!, s.range, ab.effect, ab.id, c.n);
        this.fx(ab.id, a.x, a.y, { ...base, dx: aim.dirX, dy: aim.dirY });
        return;
      case 'instante': {
        const e = ab.effect;
        // Efectos sobre uno mismo: invisibilidad y revelar al equipo.
        if (e.invisMs) a.invisUntil = now + e.invisMs;
        if (e.revealMs) { a.revealUntil = now + e.revealMs; a.revealR = (e.revealR ?? 10) * TILE; }
        const center = s.type === 'zona' ? { x: aim.x, y: aim.y } : { x: a.x, y: a.y };
        const r = (s.radius ?? 0) * TILE;
        if (!e.invisMs && !e.revealMs) {
          const pool = ab.targets === 'aliados' ? this.allies(a) : this.enemies(a);
          for (const t of pool) {
            const inside = s.type === 'cono'
              ? inCone(a, aim.dirX, aim.dirY, t, s.range, s.angle ?? 90) && hasLineOfSight(this.map, a, t)
              : Math.hypot(t.x - center.x, t.y - center.y) <= r + PLAYER.radius && (s.type === 'zona' || hasLineOfSight(this.map, a, t));
            if (inside) this.applyEffect(a, t, e, center, now);
          }
        }
        this.fx(ab.id, center.x, center.y, { ...base, r: s.type === 'cono' ? s.range * TILE : r, dx: aim.dirX, dy: aim.dirY, ang: s.angle });
        return;
      }
    }
  }

  /** Durante la embestida, quien queda en el camino recibe el efecto y es empujado (una vez). */
  private dashHits(a: Actor, now: number) {
    const dash = a.dash!;
    for (const b of this.enemies(a)) {
      if (dash.hit.has(b.conn.id) || Math.hypot(b.x - a.x, b.y - a.y) > PLAYER.radius * 2 + 16) continue;
      dash.hit.add(b.conn.id);
      this.applyEffect(a, b, { ...dash.effect, knock: undefined }, a, now);
      if (dash.effect.knock && b.alive) this.push(b, dash.dx, dash.dy, dash.effect.knock * TILE, now);
    }
    if (now >= dash.until) a.dash = null;
  }

  /** Proyectiles: avanzan en pasos cortos, chocan con lo opaco (no con abismos) y con rivales. */
  private stepProjectiles(dt: number, now: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const steps = 3;
      let dead = false;
      for (let k = 0; k < steps && !dead; k++) {
        p.x += (p.vx * dt) / steps; p.y += (p.vy * dt) / steps; p.left -= (p.speed * dt) / steps;
        if (p.left <= 0 || solidAt(this.map, p.x, p.y + 20, true)) { dead = true; break; }
        for (const b of this.enemies(p.owner)) {
          if (p.hit.has(b.conn.id) || Math.hypot(b.x - p.x, b.y - 22 - p.y) >= PLAYER.radius + p.radius) continue;
          p.hit.add(b.conn.id);
          this.applyEffect(p.owner, b, p.effect, { x: p.x - p.vx, y: p.y - p.vy }, now);
          if (!p.pierce) { dead = true; break; }
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

  private hurt(b: Actor, dmg: number, by: Actor | null, cause = 'El Desnombrar') {
    b.hp = applyHealth(b.hp, dmg);
    b.syncT = 0;
    if (b.hp <= 0 && b.alive) {
      b.alive = false; b.deaths++; b.endedAt = Date.now();
      if (by) by.kills++;
      this.dropRemains(b);
      b.conn.send({ type: 'died', by: by?.conn.name ?? cause });
      this.tellTeam(b, `${b.conn.name} cayó`);
    }
  }

  /** Al morir, todo lo que llevaba queda en el suelo como Restos que cualquiera puede saquear. */
  private dropRemains(b: Actor) {
    if (!b.inventory.length) return;
    this.remains.push({ id: `r${this.remains.length}-${b.conn.id}`, x: b.x, y: b.y, items: b.inventory, owner: b.conn.name });
    b.inventory = [];
  }

  /** ¿Algún compañero del equipo `team` está revelando a este rival? */
  private revealedTo(team: number, b: Actor, now: number) {
    for (const t of this.actors.values()) if (t.team === team && t.alive && now < t.revealUntil && Math.hypot(t.x - b.x, t.y - b.y) <= t.revealR) return true;
    return false;
  }

  private broadcast(t: number, phase: string, portals: PortalView[], collapseR: number, resonanceActive = false) {
    const all = [...this.actors.values()], now = Date.now();
    const marked = (team: number) => resonanceActive && !!this.res.get(team)?.marked;
    const markedTeams = resonanceActive ? [...this.res].filter(([, s]) => s.marked).map(([team]) => team) : [];
    for (const a of all) {
      // Compañeros: siempre. Rivales: si se ven (o los revela el equipo); los invisibles solo de cerca.
      // La Resonancia revela además a los equipos marcados (a todos) y a quien empieza a sincronizar
      // (a los rivales dentro de los anillos de ese portal).
      const others = all
        .filter((b) => b !== a && b.alive && !b.extracted)
        .map((b) => {
          if (b.team === a.team) return { b, rev: false, mark: false };
          const sp = portals[b.syncPortal];
          const portalRev = resonanceActive && now < b.syncRevealUntil && !!sp && Math.hypot(sp.x - a.x, sp.y - a.y) <= RESONANCE.farRadius;
          const d = Math.hypot(b.x - a.x, b.y - a.y), mark = marked(b.team), rev = this.revealedTo(a.team, b, now) || mark || portalRev;
          const seen = d < VIEW_RADIUS && hasLineOfSight(this.map, a, b);
          if (!seen && !rev) return null;
          if (now < b.invisUntil && d > INVIS_NEAR && !rev) return null;
          return { b, rev: rev && !seen, mark };
        })
        .filter((x): x is { b: Actor; rev: boolean; mark: boolean } => !!x)
        .map(({ b, rev, mark }) => ({
          id: b.conn.id, name: b.conn.name, team: b.team, x: Math.round(b.x), y: Math.round(b.y), hp: b.hp, ax: b.ax, ay: b.ay,
          atk: now - b.attackAt < 200, foco: b.build.focos[b.foco], slow: now < b.slowUntil, root: now < b.rootUntil,
          invis: now < b.invisUntil, rev, mark,
        }));
      const st = this.res.get(a.team);
      const res = resonanceActive && st ? {
        v: Math.round(st.value), m: st.marked, z: a.alive && !a.extracted ? zoneOf(this.portalDistance(a, portals)) : null, k: timeMultiplier(st.zoneT),
      } : null;
      const allies = all.filter((b) => b !== a && b.team === a.team).map((b) => ({ id: b.conn.id, name: b.conn.name, hp: Math.ceil(b.hp), alive: b.alive, extracted: b.extracted }));
      const cd = (slot: Slot) => Math.max(0, Math.round((a.cds[abilityFor(a.build, a.foco, slot).id] ?? 0) - now));
      a.conn.send({
        type: 'snap', t: now, time: Math.round(t * 10) / 10, phase,
        timeLeft: Math.max(0, Math.round(this.phases.fin - t)),
        portals, collapseR: Number.isFinite(collapseR) ? Math.round(collapseR) : null, res, marked: markedTeams,
        chests: this.chests.filter((c) => Math.hypot(c.x - a.x, c.y - a.y) < VIEW_RADIUS).map((c) => ({ id: c.id, k: c.kind, x: c.x, y: c.y, s: c.state })),
        remains: this.remains.filter((r) => Math.hypot(r.x - a.x, r.y - a.y) < VIEW_RADIUS).map((r) => ({ id: r.id, x: Math.round(r.x), y: Math.round(r.y), owner: r.owner })),
        you: {
          x: a.x, y: a.y, hp: a.hp, shield: Math.round(a.shield), team: a.team, alive: a.alive, extracted: a.extracted, sync: a.syncT, syncNeed: SYNC_SECONDS[1], seq: a.lastSeq, ack: a.moves.ack, ackRem: a.moves.ackRem,
          kills: a.kills, atk: now - a.attackAt < 200, attackAt: a.attackAt, inv: a.inventory,
          foco: a.foco, build: a.build, ammo: Math.round(a.ammo * 100) / 100, nextShot: Math.max(0, a.nextShot - now),
          slow: now < a.rootUntil ? 0 : now < a.slowUntil ? SLOW_MUL : 1, root: now < a.rootUntil, invis: now < a.invisUntil, reveal: now < a.revealUntil,
          cds: { Q: cd('Q'), E: cd('E'), R: cd('R') }, gcd: Math.max(0, a.gcdUntil - now), swap: Math.max(0, a.swapReady - now),
        },
        projectiles: this.projectiles.filter((p) => Math.hypot(p.x - a.x, p.y - a.y) < VIEW_RADIUS + 300).map((p) => ({
          id: p.id, x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), k: p.kind, r: p.radius, o: p.owner.conn.id, n: p.n,
        })),
        others, allies,
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
        name: a.conn.name, team: a.team, kills: a.kills, deaths: a.deaths, extracted: a.extracted,
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
