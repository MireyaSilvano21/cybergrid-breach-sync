import {
  PLAYER, TICK_MS, SYNC_SECONDS, computeDamage, applyHealth, generateValidMap, moveCircle, hasLineOfSight,
  phaseAt, scalePhases, DEFAULT_PHASES, placeChests, addToInventory, itemValue, INTERACT_RANGE, ITEMS, INVENTORY_SLOTS, CONSUMABLES, byValueDensity, slotsUsed,
  isSolidWorld, solidAt, pushHistory, positionAt, clampRewind, type TimedPoint, createMoveQueue, enqueueMove, consumeMoves, type MoveQueue,
  FOCOS, abilityFor, clampAim, fanDirections, inCone, inLine, blinkTarget, reloadAmmo, dashMulFor,
  AMMO_MAX, GCD_MS, SWAP_MS, DASH_S, SLOW_MUL, TILE,
  type Build, type Slot, type AbilityDef, type Effect, type ProjectileDef,
  type GridMap, type InputMessage, type MatchRecord, type PhaseConfig,
  type ChestKind, teamSpawns, buildFromProfile, appearanceOf, type Profile, type Appearance,
  RESONANCE, TEAMS, newTeamResonance, stepTeamResonance, pickRelocation, zoneOf, timeMultiplier, type TeamResonance,
  MONSTERS, createMonster, stepMonster, separate, type Monster, type MonsterKind, type Strike, type Target,
  RITUAL, newRitual, startRitual, waveFor, heartWave, stepRitual, damageRitual, needleAt, judgeName, plausibleNeedle, applyName, type Ritual,
  openVault, vaultCenter, SEAL_HEART, rollLoot, RARE_TABLE, createRng,
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
  /** Segundos despertando un monolito, bajas de PvE (aparte del KDR) y pulso que delata tras un Nombre errado. */
  ritualT: number; pveKills: number; pulseUntil: number;
  /** Ángulo de la aguja que mandó el cliente en la prueba de Nombre (se resuelve en el tick). */
  pendingName: number | null;
  /** Acción de mochila pendiente y efectos de consumibles (curación en el tiempo y protección). */
  pendingInv: { a: 'take' | 'all' | 'drop' | 'use'; i: number; from?: string } | null;
  healUntil: number; wardUntil: number;
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
/** Blanco de PvE para los ataques de los jugadores: un Desnombrado o el monolito de otro equipo. */
interface PveTarget { x: number; y: number; r: number; m?: Monster; rit?: number }
/** Monolito con su ritual, la bóveda mayor que abre (-1 si no tiene) y si ya dejó su ofrenda. */
export interface MonolithState { r: Ritual; x: number; y: number; vault: number; reward: boolean }

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
  /** PvE: Desnombrados vivos, golpes pendientes, rituales de cada monolito y pruebas de Nombre en curso. */
  readonly monsters: Monster[] = [];
  private strikes: Strike[] = [];
  private nextMonster = 1;
  readonly rituals: MonolithState[];
  private nameTests = new Map<string, { ritual: number; t0: number; zone: number }>();
  private vaultsOpen: number[] = [];
  private completed = 0;
  /** Bóveda Antigua: sellada, despierta (la custodia el Coloso) o abierta. */
  heart: 'sellada' | 'despierta' | 'abierta' = 'sellada';
  private heartGate: { x: number; y: number };

  constructor(entries: (Conn | { conn: Conn; team: number; profile?: Profile })[], private onEnd: (record: MatchRecord) => void) {
    // Sin equipo indicado, cada jugador va solo (todos contra todos), como en las pruebas.
    const list = entries.map((e, i) => ('conn' in e ? e : { conn: e, team: i % 4, profile: undefined as Profile | undefined }));
    this.map = generateValidMap(this.seed, list.length);
    this.portalIdx = [...this.map.portals];
    // Cada bóveda mayor queda ligada al monolito más cercano.
    this.rituals = this.map.monoliths.map((m) => ({ r: newRitual(), x: m.x, y: m.y, vault: -1, reward: false }));
    (this.map.vaultSeals ?? []).forEach((_, v) => {
      const c = vaultCenter(this.map, v)!;
      const free = this.rituals.filter((m) => m.vault < 0).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
      if (free) free.vault = v;
    });
    this.heartGate = this.findHeartGate();
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
        conn, team, app: { ...appearanceOf(profile, conn.id), body: 'medio' }, x: sp.x + ox, y: sp.y + oy, ax: 0, ay: 1,
        hp: PLAYER.maxHp, shield: 0, alive: true, extracted: false,
        input: null, lastSeq: 0, moves: createMoveQueue(), attackAt: 0, syncT: 0,
        syncPortal: -1, syncRevealUntil: 0, shieldGrant: 0, shieldUntil: 0,
        ritualT: 0, pveKills: 0, pulseUntil: 0, pendingName: null, pendingInv: null, healUntil: 0, wardUntil: 0,
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
    if (msg.inv) a.pendingInv = msg.inv;
    if (msg.name !== undefined) a.pendingName = msg.name;
    else if (msg.use) a.pendingUse = true;
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
  /** Lectura para pruebas: prueba de Nombre en curso de un jugador. */
  nameTestOf(id: string) { return this.nameTests.get(id); }

  /** Avanza la simulación un tick. Público para poder probarla sin temporizadores. */
  tick(now = Date.now()) {
    if (this.finished) return;
    const dt = TICK_MS / 1000, t = (now - this.startedAt) / 1000;
    const ph = phaseAt(t, this.phases);
    // Las bóvedas mayores se abren con su ritual; la Bóveda Antigua, al caer el Coloso.
    this.map.sealsOpen.heart = this.heart === 'abierta';
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
        if (a.pendingInv) { this.invAction(a, a.pendingInv, now); a.pendingInv = null; }
        if (a.pendingName !== null) this.tryName(a, a.pendingName, now);
        else if (a.pendingUse) this.use(a, now);
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
      a.pendingUse = false; a.pendingSwap = false; a.pendingName = null;
      // Tónico de Sutura: cura poco a poco mientras no te golpeen.
      if (now < a.healUntil && a.alive) a.hp = Math.min(100, a.hp + CONSUMABLES.tonico.healPerS * dt);
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

    this.stepPvE(t, dt, now);
    this.stepResonance(ph.resonanceActive, portals, dt, now);
    this.stepProjectiles(dt, now);
    for (const a of this.actors.values()) if (a.alive && !a.extracted) pushHistory(a.history, { t: now, x: a.x, y: a.y });

    if (ph.ended || [...this.actors.values()].every((a) => !a.alive || a.extracted)) return this.finish(now);
    // Se vuelven a leer los portales: la Resonancia pudo relocalizar uno en este tick.
    this.broadcast(t, ph.phase, this.openPortals(t), collapseR, ph.resonanceActive);
  }

  // ---------------------------------------------------------------- PvE: monolitos y Desnombrados

  private teamSize(team: number) {
    let n = 0;
    for (const a of this.actors.values()) if (a.team === team && a.alive && !a.extracted) n++;
    return Math.max(1, n);
  }

  /** Lugar fuera de los sellos de la Bóveda Antigua donde aparece su oleada final. */
  private findHeartGate() {
    const seals: { x: number; y: number }[] = [];
    this.map.tiles.forEach((t, i) => { if (t === SEAL_HEART) seals.push({ x: ((i % this.map.width) + 0.5) * TILE, y: (Math.floor(i / this.map.width) + 0.5) * TILE }); });
    const c = this.map.vault;
    for (const s of seals) {
      const dx = s.x - c.x, dy = s.y - c.y, d = Math.hypot(dx, dy) || 1;
      const p = { x: s.x + (dx / d) * 2.5 * TILE, y: s.y + (dy / d) * 2.5 * TILE };
      if (!isSolidWorld(this.map, p.x, p.y)) return p;
    }
    return { x: c.x, y: c.y };
  }

  /** Coloca una oleada alrededor de un punto, en lugares libres y a la vista de él. */
  private spawnAround(c: { x: number; y: number }, kinds: MonsterKind[], owner: number, dist = 7 * TILE) {
    kinds.forEach((k, j) => {
      const r = MONSTERS[k].radius;
      for (let tries = 0; tries < 18; tries++) {
        const a = j * 2.39996 + tries * 0.7, d = dist * (0.65 + 0.35 * ((tries % 3) / 2));
        const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
        const clear = !isSolidWorld(this.map, x, y) && [0, 1.57, 3.14, 4.71].every((q) => !isSolidWorld(this.map, x + Math.cos(q) * r, y + Math.sin(q) * r));
        // La vista se revisa desde el borde del monolito (su centro es sólido).
        const from = { x: c.x + Math.cos(a) * 1.5 * TILE, y: c.y + Math.sin(a) * 1.5 * TILE };
        if (clear && !isSolidWorld(this.map, from.x, from.y) && hasLineOfSight(this.map, from, { x, y })) { this.monsters.push(createMonster(this.nextMonster++, k, x, y, owner, { x: c.x, y: c.y })); return; }
      }
      this.monsters.push(createMonster(this.nextMonster++, k, c.x, c.y + 60, owner, { x: c.x, y: c.y }));
    });
  }

  /** Disuelve a los Desnombrados de un ritual (al completarse o romperse). */
  private clearMonsters(owner: number) {
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (m.owner !== owner) continue;
      this.fx('disuelve', m.x, m.y, { mk: m.kind });
      this.monsters.splice(i, 1);
    }
    this.strikes = this.strikes.filter((s) => s.monster.owner !== owner);
  }

  private beginRitual(i: number, a: Actor) {
    const m = this.rituals[i];
    startRitual(m.r, a.team);
    this.spawnAround(m, waveFor(1, this.teamSize(a.team)), i);
    this.fx('monolito-pulso', m.x, m.y);
    // El monolito lanza un pulso que oyen los jugadores cercanos.
    for (const b of this.actors.values()) {
      if (b.team === a.team) b.conn.send({ type: 'notice', message: '¡Ritual iniciado! Defiendan el monolito' });
      else if (Math.hypot(b.x - m.x, b.y - m.y) < 1100) b.conn.send({ type: 'notice', message: 'Un monolito despertó cerca' });
    }
  }

  private completeRitual(i: number) {
    const m = this.rituals[i];
    this.clearMonsters(i);
    this.completed++;
    if (m.vault >= 0) { openVault(this.map, m.vault); this.vaultsOpen.push(m.vault); }
    if (!m.reward) {
      // Ofrenda del monolito: un arcón con botín raro junto a él.
      m.reward = true;
      const spot = [[0, 80], [0, -80], [80, 0], [-80, 0]].map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy })).find((p) => !isSolidWorld(this.map, p.x, p.y)) ?? { x: m.x, y: m.y + 80 };
      this.chests.push({ id: `rit${i}`, kind: 'ornamentado', x: spot.x, y: spot.y, state: 'closed', items: rollLoot(createRng((this.seed ^ ((i + 1) * 0x9e3779b1)) >>> 0), 3, RARE_TABLE) });
    }
    this.fx('monolito-completo', m.x, m.y);
    const name = TEAMS[m.r.team]?.name ?? `${m.r.team + 1}`;
    for (const b of this.actors.values()) {
      b.conn.send({ type: 'notice', message: b.team === m.r.team ? (m.vault >= 0 ? '¡Ritual completo! La bóveda se abrió' : '¡Ritual completo! El monolito dejó una ofrenda') : `El equipo ${name} completó un ritual` });
    }
  }

  private wakeHeart() {
    this.heart = 'despierta';
    this.spawnAround(this.heartGate, heartWave(), -1, 4 * TILE);
    for (const b of this.actors.values()) b.conn.send({ type: 'notice', message: '¡La Bóveda Antigua despertó! Un Coloso la custodia' });
  }

  private killMonster(m: Monster, by: Actor | null) {
    const i = this.monsters.indexOf(m);
    if (i < 0) return;
    this.monsters.splice(i, 1);
    if (by) by.pveKills++;
    this.fx('disuelve', m.x, m.y, { mk: m.kind });
    if (m.kind === 'coloso' && m.owner === -1) {
      this.heart = 'abierta'; this.map.sealsOpen.heart = true;
      for (const b of this.actors.values()) b.conn.send({ type: 'notice', message: 'El Coloso cayó: la Bóveda Antigua está abierta' });
    }
  }

  /** Prueba de Nombre: se juzga el ángulo que vio el cliente si es creíble; si no, el del servidor. */
  private tryName(a: Actor, claimed: number, now: number) {
    const nt = this.nameTests.get(a.conn.id);
    if (!nt) return;
    this.nameTests.delete(a.conn.id);
    const m = this.rituals[nt.ritual], el = now - nt.t0;
    const result = judgeName(plausibleNeedle(claimed, el) ? claimed : needleAt(el), nt.zone);
    applyName(m.r, result, now);
    a.conn.send({ type: 'name', result });
    if (result === 'errado') { a.pulseUntil = now + RITUAL.pulseMs; this.fx('pulso', a.x, a.y); }
  }

  /** Blancos de PvE para un atacante: Desnombrados y monolitos activos de otros equipos. */
  private pveTargets(a: Actor): PveTarget[] {
    const out: PveTarget[] = this.monsters.map((m) => ({ x: m.x, y: m.y, r: MONSTERS[m.kind].radius, m }));
    this.rituals.forEach((m, i) => { if ((m.r.phase === 'defensa' || m.r.phase === 'reparar') && m.r.team !== a.team) out.push({ x: m.x, y: m.y, r: 40, rit: i }); });
    return out;
  }

  private hitPve(a: Actor, t: PveTarget, e: Effect, origin: { x: number; y: number }, now: number) {
    if (t.m) {
      const m = t.m;
      if (m.hp <= 0 || !this.monsters.includes(m)) return;
      if (e.dmg) {
        const r = computeDamage({ base: e.dmg, rarity: 'comun', targetShield: 0 });
        m.hp -= r.total;
        a.conn.send({ type: 'hit', target: `m${m.id}`, dmg: r.total, x: Math.round(m.x), y: Math.round(m.y), rewindMs: 0 });
      }
      if (e.slowMs) m.slowUntil = Math.max(m.slowUntil, now + e.slowMs);
      if (e.rootMs) m.rootUntil = Math.max(m.rootUntil, now + e.rootMs);
      if (e.knock && m.kind !== 'coloso') {
        const dx = m.x - origin.x, dy = m.y - origin.y, d = Math.hypot(dx, dy) || 1;
        const p = moveCircle(this.map, m, (dx / d) * e.knock * TILE * 0.6, (dy / d) * e.knock * TILE * 0.6, MONSTERS[m.kind].radius);
        m.x = p.x; m.y = p.y;
      }
      if (m.hp <= 0) this.killMonster(m, a);
    } else if (t.rit !== undefined && e.dmg) {
      // Otros equipos pueden golpear el monolito para interrumpir el ritual.
      damageRitual(this.rituals[t.rit].r, e.dmg * 0.5);
      a.conn.send({ type: 'hit', target: 'monolito', dmg: Math.round(e.dmg * 0.5), x: Math.round(t.x), y: Math.round(t.y), rewindMs: 0 });
    }
  }

  /** Rituales, IA de los Desnombrados y sus golpes. */
  private stepPvE(t: number, dt: number, now: number) {
    const awake = t >= this.phases.primeraLlamada;
    // Despertar un monolito: mantener interactuar junto a él (las bóvedas mayores despiertan en la Primera Llamada).
    for (const a of this.actors.values()) {
      const i = awake && a.alive && !a.extracted && a.input?.interact ? this.rituals.findIndex((m) => m.r.phase === 'dormido' && Math.hypot(m.x - a.x, m.y - a.y) <= RITUAL.range) : -1;
      if (i < 0) { a.ritualT = 0; continue; }
      a.ritualT += dt;
      if (a.ritualT >= RITUAL.activateS) { a.ritualT = 0; this.beginRitual(i, a); }
    }
    this.rituals.forEach((m, i) => {
      const ev = stepRitual(m.r, dt, now);
      if (ev === 'wave2') { this.spawnAround(m, waveFor(2, this.teamSize(m.r.team)), i); this.tellTeamId(m.r.team, 'Segunda oleada: ¡defiendan el monolito!'); }
      else if (ev === 'repair') this.tellTeamId(m.r.team, 'El monolito se debilita: haz la prueba de Nombre (F)');
      else if (ev === 'broken') { this.clearMonsters(i); this.fx('monolito-roto', m.x, m.y); this.tellTeamId(m.r.team, 'El ritual se rompió. El monolito descansará un momento'); }
      else if (ev === 'complete') this.completeRitual(i);
    });
    for (const [id, nt] of this.nameTests) {
      const a = this.actors.get(id), m = this.rituals[nt.ritual];
      if (!a || !a.alive || m.r.phase !== 'reparar' || Math.hypot(m.x - a.x, m.y - a.y) > RITUAL.range + 40) this.nameTests.delete(id);
    }
    if (this.heart === 'sellada' && t >= this.phases.segundaLlamada && this.completed >= Math.min(RITUAL.heartNeeds, this.rituals.length)) this.wakeHeart();

    const players: Target[] = [];
    for (const a of this.actors.values()) if (a.alive && !a.extracted) players.push({ id: a.conn.id, x: a.x, y: a.y, r: PLAYER.radius });
    for (const mo of [...this.monsters]) {
      const rit = mo.owner >= 0 ? this.rituals[mo.owner] : null;
      // Solo cazan dentro de su arena: no recorren el mapa (GDD).
      const near = players.filter((p) => Math.hypot(p.x - mo.home.x, p.y - mo.home.y) <= RITUAL.arena);
      const structure = rit && (rit.r.phase === 'defensa' || rit.r.phase === 'reparar') ? { id: 'monolito', x: rit.x, y: rit.y, r: 40 } : null;
      const s = stepMonster(this.map, mo, near, structure, now, dt);
      if (s) { this.strikes.push(s); this.fx('golpe', mo.x, mo.y, { mk: mo.kind, id: mo.id, x2: Math.round(s.x), y2: Math.round(s.y) }); }
    }
    separate(this.map, this.monsters);
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      if (now < s.at) continue;
      this.strikes.splice(i, 1);
      const def = MONSTERS[s.monster.kind];
      for (const a of this.actors.values()) {
        if (a.alive && !a.extracted && Math.hypot(a.x - s.x, a.y - s.y) <= s.r + PLAYER.radius) this.hurt(a, def.dmg, null, def.name);
      }
      const rit = s.monster.owner >= 0 ? this.rituals[s.monster.owner] : null;
      if (rit && def.structureDmg && Math.hypot(rit.x - s.x, rit.y - s.y) <= s.r + 40) damageRitual(rit.r, def.structureDmg);
    }
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
    // Sal de Guarda: mientras dura, no te ralentizan ni te inmovilizan.
    if (e.slowMs && now >= b.wardUntil) b.slowUntil = Math.max(b.slowUntil, now + e.slowMs);
    if (e.rootMs && now >= b.wardUntil) b.rootUntil = Math.max(b.rootUntil, now + e.rootMs);
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
    for (const t of this.pveTargets(a)) {
      const inside = line ? inLine(a, aim.dirX, aim.dirY, t, b.shape.range, b.shape.width ?? 0.5) : inCone(a, aim.dirX, aim.dirY, t, b.shape.range, b.shape.angle ?? 90);
      if (inside && hasLineOfSight(this.map, a, t)) this.hitPve(a, t, effect, a, now);
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
          if (ab.targets !== 'aliados') for (const t of this.pveTargets(a)) {
            const inside = s.type === 'cono'
              ? inCone(a, aim.dirX, aim.dirY, t, s.range, s.angle ?? 90) && hasLineOfSight(this.map, a, t)
              : Math.hypot(t.x - center.x, t.y - center.y) <= r + t.r && (s.type === 'zona' || hasLineOfSight(this.map, a, t));
            if (inside) this.hitPve(a, t, e, center, now);
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
    for (const t of this.pveTargets(a)) {
      const key = t.m ? `m${t.m.id}` : `r${t.rit}`;
      if (dash.hit.has(key) || Math.hypot(t.x - a.x, t.y - a.y) > PLAYER.radius + t.r + 16) continue;
      dash.hit.add(key);
      this.hitPve(a, t, dash.effect, a, now);
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
        if (dead) break;
        for (const t of this.pveTargets(p.owner)) {
          const key = t.m ? `m${t.m.id}` : `r${t.rit}`;
          if (p.hit.has(key) || Math.hypot(t.x - p.x, t.y - t.r * 0.8 - p.y) >= t.r + p.radius) continue;
          p.hit.add(key);
          this.hitPve(p.owner, t, p.effect, { x: p.x - p.vx, y: p.y - p.vy }, now);
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
  private use(a: Actor, now: number) {
    // Junto a un monolito que se debilita: empieza la prueba de Nombre (en lugar de saquear).
    const rit = this.rituals.findIndex((m) => m.r.phase === 'reparar' && m.r.team === a.team && Math.hypot(m.x - a.x, m.y - a.y) <= RITUAL.range);
    if (rit >= 0) {
      if (!this.nameTests.has(a.conn.id) && now >= this.rituals[rit].r.pausedUntil) this.nameTests.set(a.conn.id, { ritual: rit, t0: now, zone: 1 + Math.random() * 4.2 });
      return;
    }
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
    // Tomar todo: primero lo que más vale por casilla, para que lo valioso nunca se quede.
    const r = addToInventory(a.inventory, byValueDensity(target.items));
    if (!r.taken.length) { a.conn.send({ type: 'notice', message: 'Tu mochila está llena: suelta algo para hacer espacio.' }); return; }
    a.inventory = r.inventory;
    target.items = r.left;
    if ('state' in target) { if (!r.left.length) target.state = 'empty'; }
    else if (!r.left.length) this.remains.splice(this.remains.indexOf(target), 1);
    a.conn.send({ type: 'looted', items: r.taken, left: r.left.length });
  }

  /** Contenedor abierto más cercano al alcance: cofre abierto o restos (o los de un id dado). */
  private lootNear(a: Actor, id?: string) {
    let best: { id: string; x: number; y: number; items: string[] } | null = null, bd: number = INTERACT_RANGE;
    for (const c of [...this.chests.filter((c) => c.state === 'open'), ...this.remains]) {
      if (id && c.id !== id) continue;
      const d = Math.hypot(c.x - a.x, c.y - a.y);
      if (d <= bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Acciones de mochila: tomar un objeto o todo, soltar uno o usar un consumible. */
  private invAction(a: Actor, act: { a: 'take' | 'all' | 'drop' | 'use'; i: number; from?: string }, now: number) {
    if (act.a === 'all') return this.use(a, now);
    if (act.a === 'take') {
      const box = this.lootNear(a, act.from), item = box?.items[act.i];
      if (!box || !item) return;
      if (slotsUsed(a.inventory) + (ITEMS[item]?.size ?? 1) > INVENTORY_SLOTS) { a.conn.send({ type: 'notice', message: 'No cabe: suelta algo para hacer espacio.' }); return; }
      box.items.splice(act.i, 1);
      a.inventory = [...a.inventory, item];
      this.emptied(box);
      a.conn.send({ type: 'looted', items: [item], left: box.items.length });
      return;
    }
    const item = a.inventory[act.i];
    if (!item) return;
    if (act.a === 'drop') {
      a.inventory = a.inventory.filter((_, k) => k !== act.i);
      // Lo soltado queda en el suelo como una bolsa que cualquiera puede saquear.
      const own = this.remains.find((r) => r.id.startsWith(`d-${a.conn.id}-`) && Math.hypot(r.x - a.x, r.y - a.y) < 60);
      if (own) own.items.push(item);
      else this.remains.push({ id: `d-${a.conn.id}-${now}`, x: a.x, y: a.y + 8, items: [item], owner: a.conn.name });
      a.conn.send({ type: 'dropped', item });
      return;
    }
    if (ITEMS[item]?.kind !== 'consumible') return;
    a.inventory = a.inventory.filter((_, k) => k !== act.i);
    if (item === 'tonico') a.healUntil = now + CONSUMABLES.tonico.ms;
    if (item === 'sal') { a.slowUntil = 0; a.rootUntil = 0; a.wardUntil = now + CONSUMABLES.sal.wardMs; }
    a.conn.send({ type: 'used', item });
  }

  /** Un contenedor que se quedó sin nada: el cofre queda vacío y los restos desaparecen. */
  private emptied(box: { id: string; items: string[] }) {
    if (box.items.length) return;
    const c = this.chests.find((x) => x.id === box.id);
    if (c) c.state = 'empty';
    else { const i = this.remains.findIndex((r) => r.id === box.id); if (i >= 0) this.remains.splice(i, 1); }
  }

  private hurt(b: Actor, dmg: number, by: Actor | null, cause = 'El Desnombrar') {
    b.hp = applyHealth(b.hp, dmg);
    b.syncT = 0;
    if (dmg > 0) b.healUntil = 0; // un golpe corta el Tónico
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
    const rit = this.rituals.map((m) => ({
      x: Math.round(m.x), y: Math.round(m.y), ph: m.r.phase, tm: m.r.team, i: Math.round(m.r.integrity), p: Math.round(m.r.progress * 100), w: m.r.wave,
      cd: m.r.phase === 'roto' ? Math.max(0, Math.ceil((m.r.cooldownUntil - now) / 1000)) : 0,
    }));
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
          const d = Math.hypot(b.x - a.x, b.y - a.y), mark = marked(b.team), rev = this.revealedTo(a.team, b, now) || mark || portalRev || now < b.pulseUntil;
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
        rit, vaults: this.vaultsOpen, heart: this.heart,
        mons: this.monsters.filter((m) => Math.hypot(m.x - a.x, m.y - a.y) < VIEW_RADIUS + 200).map((m) => ({
          id: m.id, k: m.kind, x: Math.round(m.x), y: Math.round(m.y), hp: Math.ceil(m.hp), st: m.state === 'windup' ? 'w' : m.state === 'recover' ? 'r' : 'm',
          p: m.state === 'windup' ? Math.round(Math.min(1, Math.max(0, 1 - (m.until - now) / MONSTERS[m.kind].windupMs)) * 100) / 100 : 0,
          ax: Math.round(m.aimX), ay: Math.round(m.aimY), dx: Math.round(m.dirX * 100) / 100, dy: Math.round(m.dirY * 100) / 100, sl: now < m.slowUntil, rt: now < m.rootUntil,
        })),
        chests: this.chests.filter((c) => Math.hypot(c.x - a.x, c.y - a.y) < VIEW_RADIUS).map((c) => ({ id: c.id, k: c.kind, x: c.x, y: c.y, s: c.state })),
        remains: this.remains.filter((r) => Math.hypot(r.x - a.x, r.y - a.y) < VIEW_RADIUS).map((r) => ({ id: r.id, x: Math.round(r.x), y: Math.round(r.y), owner: r.owner })),
        you: {
          x: a.x, y: a.y, hp: a.hp, shield: Math.round(a.shield), team: a.team, alive: a.alive, extracted: a.extracted, sync: a.syncT, syncNeed: SYNC_SECONDS[1], seq: a.lastSeq, ack: a.moves.ack, ackRem: a.moves.ackRem,
          kills: a.kills, atk: now - a.attackAt < 200, attackAt: a.attackAt, inv: a.inventory,
          foco: a.foco, build: a.build, ammo: Math.round(a.ammo * 100) / 100, nextShot: Math.max(0, a.nextShot - now),
          slow: now < a.rootUntil ? 0 : now < a.slowUntil ? SLOW_MUL : 1, root: now < a.rootUntil, invis: now < a.invisUntil, reveal: now < a.revealUntil,
          cds: { Q: cd('Q'), E: cd('E'), R: cd('R') }, gcd: Math.max(0, a.gcdUntil - now), swap: Math.max(0, a.swapReady - now),
          rt: Math.round((a.ritualT / RITUAL.activateS) * 100) / 100, pve: a.pveKills,
          loot: (() => { const b = a.alive && !a.extracted ? this.lootNear(a) : null; return b ? { id: b.id, items: b.items } : null; })(),
          heal: now < a.healUntil, ward: now < a.wardUntil,
          nt: this.nameTests.has(a.conn.id) ? (() => { const n = this.nameTests.get(a.conn.id)!; return { el: now - n.t0, z: Math.round(n.zone * 1000) / 1000 }; })() : null,
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
