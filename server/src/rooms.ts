import { randomUUID } from 'node:crypto';
import { MAX_PLAYERS, autoTeam, canJoinTeam, type InputMessage, type MatchRecord } from '@shared/index';
import { config } from './config';
import { Match, type Conn } from './game';

interface Member { conn: Conn; ready: boolean; team: number }
export interface Room {
  id: string; name: string; password?: string; host: string;
  members: Map<string, Member>;
  state: 'lobby' | 'playing';
  match: Match | null;
}

/** Salas (lobbies): creación, unión protegida con contraseña, estado "Listo" e inicio de partida. */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private where = new Map<string, string>(); // connId -> roomId

  constructor(private onMatchEnd: (r: MatchRecord) => void) {}

  create(name: string, host: string, password?: string): Room {
    const room: Room = { id: randomUUID().slice(0, 8), name, password: password || undefined, host, members: new Map(), state: 'lobby', match: null };
    this.rooms.set(room.id, room);
    return room;
  }

  list() {
    return [...this.rooms.values()].map((r) => ({ id: r.id, name: r.name, players: r.members.size, max: MAX_PLAYERS, locked: !!r.password, state: r.state }));
  }

  join(conn: Conn, roomId: string, password?: string): string | null {
    const room = this.rooms.get(roomId);
    if (!room) return 'La sala no existe.';
    if (room.password && room.password !== password) return 'Contraseña de sala incorrecta.';
    if (room.state !== 'lobby') return 'La partida ya empezó.';
    if (room.members.size >= MAX_PLAYERS) return 'La sala está llena.';
    this.leave(conn.id);
    // Entra al equipo con menos jugadores: dos personas que no eligen quedan como rivales.
    const team = autoTeam([...room.members.values()].map((m) => m.team));
    if (team === null) return 'La sala está llena.';
    room.members.set(conn.id, { conn, ready: false, team });
    this.where.set(conn.id, room.id);
    this.broadcastLobby(room);
    return null;
  }

  leave(connId: string) {
    const roomId = this.where.get(connId);
    if (!roomId) return;
    this.where.delete(connId);
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.members.delete(connId);
    room.match?.removePlayer(connId);
    if (room.members.size === 0) { room.match?.stop(); this.rooms.delete(room.id); return; }
    this.broadcastLobby(room);
  }

  setReady(connId: string, ready: boolean) {
    const room = this.roomOf(connId);
    const m = room?.members.get(connId);
    if (!room || !m || room.state !== 'lobby') return;
    m.ready = ready;
    this.broadcastLobby(room);
    const members = [...room.members.values()];
    if (members.length >= config.minPlayers && members.every((x) => x.ready)) this.startMatch(room);
  }

  /** Cambio de equipo en el lobby: máximo 3 por equipo; quita el "Listo" para no arrancar por accidente. */
  setTeam(connId: string, team: number): string | null {
    const room = this.roomOf(connId);
    const m = room?.members.get(connId);
    if (!room || !m || room.state !== 'lobby') return null;
    if (m.team === team) return null;
    const others = [...room.members.values()].filter((x) => x !== m).map((x) => x.team);
    if (!canJoinTeam(others, team)) return 'Ese equipo ya está completo.';
    m.team = team; m.ready = false;
    this.broadcastLobby(room);
    return null;
  }

  input(connId: string, msg: InputMessage) { this.roomOf(connId)?.match?.handleInput(connId, msg); }

  roomOf(connId: string): Room | undefined {
    const id = this.where.get(connId);
    return id ? this.rooms.get(id) : undefined;
  }

  private startMatch(room: Room) {
    room.state = 'playing';
    room.match = new Match([...room.members.values()].map((m) => ({ conn: m.conn, team: m.team })), (record) => {
      this.onMatchEnd(record);
      room.state = 'lobby';
      room.match = null;
      for (const m of room.members.values()) m.ready = false;
      this.broadcastLobby(room);
    });
    this.broadcastLobby(room);
    room.match.start();
  }

  private broadcastLobby(room: Room) {
    const msg = {
      type: 'lobby',
      room: { id: room.id, name: room.name, locked: !!room.password, state: room.state },
      players: [...room.members.values()].map((m) => ({ id: m.conn.id, name: m.conn.name, ready: m.ready, team: m.team })),
    };
    for (const m of room.members.values()) m.conn.send(msg);
  }
}
