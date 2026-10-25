import { randomInt } from 'node:crypto';
import { MAX_TEAM_SIZE, defaultProfile, pickMatch, queueStatus, type Profile, type QueuedParty, type QueueRules } from '@shared/index';
import type { Conn } from './game';

/**
 * Campamento: escuadras, perfiles y cola de emparejamiento.
 * - Cada jugador conectado siempre está en una escuadra (al principio, solo él).
 * - Se entra a otra escuadra con su código de 5 caracteres o aceptando una invitación.
 * - El líder pone a la escuadra en cola; el emparejador junta escuadras como equipos.
 */
export interface Party { id: string; code: string; leader: string; members: string[]; state: 'idle' | 'searching' | 'playing'; since: number }

export interface HubDeps {
  rules: QueueRules;
  /** ¿Está el jugador en una sala privada o en partida? (entonces no puede entrar a la cola) */
  busy: (connId: string) => boolean;
  /** Arranca una partida con estos jugadores; cada escuadra es un equipo. */
  start: (entries: { conn: Conn; team: number }[], onEnd: () => void) => void;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Hub {
  private conns = new Map<string, Conn>();
  private profiles = new Map<string, Profile>();
  private parties = new Map<string, Party>();
  private partyOf = new Map<string, string>();
  private byCode = new Map<string, string>();
  private queue: QueuedParty[] = [];
  private timer: NodeJS.Timeout | null = null;
  private nextId = 1;

  constructor(private deps: HubDeps) {}

  startTicking(ms = 500) { this.timer = setInterval(() => this.tick(), ms); }
  stop() { if (this.timer) clearInterval(this.timer); }

  profileOf(id: string) { return this.profiles.get(id); }
  party(id: string) { const p = this.partyOf.get(id); return p ? this.parties.get(p) : undefined; }

  connect(conn: Conn) {
    this.conns.set(conn.id, conn);
    this.profiles.set(conn.id, defaultProfile(conn.name));
    this.solo(conn.id);
    this.broadcastOnline();
  }

  disconnect(id: string) {
    this.removeFromParty(id);
    this.conns.delete(id); this.profiles.delete(id);
    this.broadcastOnline();
  }

  setProfile(id: string, p: Profile) {
    if (!this.conns.has(id)) return;
    this.profiles.set(id, p);
    const party = this.party(id); if (party) this.sendParty(party);
  }

  /** Entra a una escuadra por su código. */
  join(id: string, code: string): string | null {
    const target = this.parties.get(this.byCode.get(code.toUpperCase()) ?? '');
    if (!target) return 'No existe una escuadra con ese código.';
    const mine = this.party(id);
    if (mine === target) return null;
    if (target.members.length >= MAX_TEAM_SIZE) return 'La escuadra está completa.';
    if (target.state !== 'idle') return 'Esa escuadra está buscando partida o jugando.';
    if (mine?.state === 'playing' || this.deps.busy(id)) return 'Termina tu partida antes de cambiar de escuadra.';
    this.removeFromParty(id);
    target.members.push(id); this.partyOf.set(id, target.id);
    this.sendParty(target);
    this.broadcastOnline();
    return null;
  }

  /** Sale de su escuadra y queda en una propia. */
  leave(id: string) {
    const p = this.party(id);
    if (!p || p.members.length === 1 || p.state === 'playing') return;
    this.removeFromParty(id);
    this.solo(id);
    this.broadcastOnline();
  }

  invite(from: string, to: string): string | null {
    const p = this.party(from), c = this.conns.get(to), me = this.conns.get(from);
    if (!p || !c || !me || to === from) return 'Ese jugador ya no está conectado.';
    if (p.members.includes(to)) return null;
    if (p.members.length >= MAX_TEAM_SIZE) return 'Tu escuadra está completa.';
    c.send({ type: 'invite', from: me.name, code: p.code });
    return null;
  }

  /** El líder busca partida (o cancela). Nadie de la escuadra puede estar en una sala privada. */
  setQueue(id: string, on: boolean): string | null {
    const p = this.party(id);
    if (!p) return null;
    if (p.leader !== id) return 'Solo el líder de la escuadra puede buscar partida.';
    if (on) {
      if (p.state !== 'idle') return null;
      if (p.members.some((m) => this.deps.busy(m))) return 'Alguien de la escuadra está en una sala privada.';
      p.state = 'searching'; p.since = Date.now();
      this.queue.push({ id: p.id, size: p.members.length, since: p.since });
    } else {
      if (p.state !== 'searching') return null;
      this.dequeue(p);
    }
    this.sendParty(p);
    return null;
  }

  /** Si alguien entra a una sala privada mientras su escuadra busca, la búsqueda se cancela. */
  cancelFor(id: string) { const p = this.party(id); if (p?.state === 'searching') { this.dequeue(p); this.sendParty(p); } }

  /** Revisa la cola: arma partidas y avisa el estado de la búsqueda. Público para las pruebas. */
  tick(now = Date.now()) {
    if (!this.queue.length) return;
    const ids = pickMatch(this.queue, now, this.deps.rules);
    if (ids) {
      const parties = ids.map((x) => this.parties.get(x)!).filter(Boolean);
      const entries = parties.flatMap((p, team) => p.members.map((m) => ({ conn: this.conns.get(m)!, team })).filter((e) => e.conn));
      for (const p of parties) { this.queue = this.queue.filter((q) => q.id !== p.id); p.state = 'playing'; this.sendParty(p); }
      this.deps.start(entries, () => {
        for (const p of parties) if (this.parties.has(p.id)) { p.state = 'idle'; this.sendParty(p); }
        this.broadcastOnline();
      });
      this.broadcastOnline();
    }
    const status = queueStatus(this.queue, now, this.deps.rules);
    for (const q of this.queue) {
      const p = this.parties.get(q.id);
      if (p) for (const m of p.members) this.conns.get(m)?.send({ type: 'queue', ...status, waitedMs: now - q.since });
    }
  }

  private dequeue(p: Party) { this.queue = this.queue.filter((q) => q.id !== p.id); p.state = 'idle'; }

  private solo(id: string) {
    let code = '';
    do code = Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); while (this.byCode.has(code));
    const p: Party = { id: `e${this.nextId++}`, code, leader: id, members: [id], state: 'idle', since: 0 };
    this.parties.set(p.id, p); this.byCode.set(code, p.id); this.partyOf.set(id, p.id);
    this.sendParty(p);
  }

  private removeFromParty(id: string) {
    const p = this.party(id); if (!p) return;
    this.partyOf.delete(id);
    p.members = p.members.filter((m) => m !== id);
    // Cambió la escuadra: si buscaba partida, la búsqueda se cancela.
    if (p.state === 'searching') this.dequeue(p);
    if (!p.members.length) { this.parties.delete(p.id); this.byCode.delete(p.code); return; }
    if (p.leader === id) p.leader = p.members[0];
    this.sendParty(p);
  }

  private sendParty(p: Party) {
    const members = p.members.map((m) => ({ id: m, name: this.conns.get(m)?.name ?? '?', profile: this.profiles.get(m) }));
    for (const m of p.members) this.conns.get(m)?.send({ type: 'party', id: p.id, code: p.code, leader: p.leader, state: p.state, members });
  }

  /** Jugadores conectados (para invitar), con el tamaño de su escuadra. */
  private broadcastOnline() {
    const players = [...this.conns.values()].map((c) => ({ id: c.id, name: c.name, party: this.party(c.id)?.members.length ?? 1, playing: this.party(c.id)?.state === 'playing' }));
    const msg = { type: 'online', players };
    for (const c of this.conns.values()) c.send(msg);
  }
}
