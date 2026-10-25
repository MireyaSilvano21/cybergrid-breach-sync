import express from 'express';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientMessageSchema, CredentialsSchema, CreateRoomSchema, SeedPayloadSchema } from '@shared/index';
import { config } from './config';
import { checkCredentials, issueToken, loadUsers, registerUser, requireAuth, setUserSink, verifyToken, type AuthedRequest } from './auth';
import { RoomManager } from './rooms';
import { Hub } from './hub';
import { generateMatches, telemetry } from './telemetry';
import { MemoryDb, createPgDb, type Db } from './db';
import { Persistence } from './persist';
import type { Conn } from './game';

/** Persistencia que llena la caché de usuarios y la telemetría de este proceso. */
export function createPersistence(db: Db = new MemoryDb()) {
  return new Persistence(db, { loadUsers, restoreTelemetry: (t) => telemetry.restore(t) });
}

export function createGameServer(opts: { persistence?: Persistence } = {}): { app: express.Express; server: Server; rooms: RoomManager; hub: Hub; persistence: Persistence } {
  // Sin persistencia indicada (pruebas), una base en memoria que carga al instante.
  const persistence = opts.persistence ?? createPersistence();
  if (!opts.persistence) void persistence.start();
  setUserSink((u) => persistence.saveUser(u));
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  // El campamento (escuadras y cola) y las salas se conocen: la cola arranca partidas en salas ocultas.
  let hub: Hub;
  // Al terminar una partida: telemetría en memoria al instante y escritura a la base en segundo plano.
  const rooms = new RoomManager((record) => { telemetry.add(record); persistence.saveMatches([record]); }, (id) => hub.profileOf(id));
  hub = new Hub({
    rules: config.queue, busy: (id) => rooms.busy(id), start: (entries, onEnd) => rooms.startQueued(entries, onEnd),
    profiles: { get: (name) => persistence.profile(name), save: (name, p) => persistence.saveProfile(name, p) },
  });
  if (!process.env.VITEST) hub.startTicking();

  app.get('/api/health', (_req, res) => res.json({ ok: true, uptimeS: Math.round(process.uptime()), db: persistence.status() }));

  // --- Autenticación ---
  app.post('/api/auth/register', (req, res) => {
    const p = CredentialsSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
    if (!registerUser(p.data.username, p.data.password)) return res.status(409).json({ error: 'Ese usuario ya existe.' });
    res.status(201).json({ token: issueToken(p.data.username), username: p.data.username });
  });

  app.post('/api/auth/login', (req, res) => {
    const p = CredentialsSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
    const user = checkCredentials(p.data.username, p.data.password);
    if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    res.json({ token: issueToken(user), username: user });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => res.json({ username: req.username }));

  // --- Salas ---
  app.get('/api/rooms', requireAuth, (_req, res) => res.json({ rooms: rooms.list() }));
  app.post('/api/rooms', requireAuth, (req: AuthedRequest, res) => {
    const p = CreateRoomSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
    const room = rooms.create(p.data.name, req.username!, p.data.password);
    res.status(201).json({ id: room.id, name: room.name });
  });

  // --- Endpoints de prueba y telemetría (especificación, sección 2) ---
  if (config.testEndpoints) {
    app.get('/api/test/telemetry', (_req, res) => {
      res.set('Cache-Control', 'no-store').json(telemetry.summary());
    });
    app.post('/api/test/seed', (req, res) => {
      const started = performance.now();
      const p = SeedPayloadSchema.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Payload inválido: envía entre 100 y 1000 partidas.', issues: p.error.issues.slice(0, 5) });
      if (p.data.reset) { telemetry.reset(); persistence.resetMatches(); }
      const matches = 'matches' in p.data ? p.data.matches : generateMatches(p.data.generate.count, p.data.generate.seed);
      telemetry.addMany(matches);
      // La base se escribe en segundo plano: la respuesta y la telemetría no la esperan.
      persistence.saveMatches(matches);
      const queryStart = performance.now();
      const summary = telemetry.summary();
      res.status(201).json({
        inserted: matches.length,
        totalMatches: telemetry.count,
        insertMs: Math.round((queryStart - started) * 100) / 100,
        queryMs: Math.round((performance.now() - queryStart) * 1000) / 1000,
        summary,
      });
    });
  }

  // --- Cliente compilado ---
  const here = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = [path.join(here, 'public'), path.join(here, '../../dist/public')].find((d) => fs.existsSync(d));
  if (publicDir) {
    app.use(express.static(publicDir, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Protección: solo se aceptan sockets con un token válido.
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    const user = verifyToken(url.searchParams.get('token'));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, user));
  });

  wss.on('connection', (ws: WebSocket, username: string) => {
    const conn: Conn = {
      id: randomUUID().slice(0, 8),
      name: username,
      send: (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    };
    conn.send({ type: 'hello', id: conn.id, name: conn.name });
    hub.connect(conn);
    ws.on('message', (raw) => {
      let data: unknown;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      const p = ClientMessageSchema.safeParse(data);
      if (!p.success) return conn.send({ type: 'error', message: 'Mensaje inválido.' });
      const m = p.data;
      switch (m.type) {
        case 'ping': return conn.send({ type: 'pong', t: m.t });
        case 'join': { hub.cancelFor(conn.id); const err = rooms.join(conn, m.roomId, m.password); if (err) conn.send({ type: 'error', message: err }); return; }
        case 'leave': return rooms.leave(conn.id);
        case 'ready': return rooms.setReady(conn.id, m.ready);
        case 'team': { const err = rooms.setTeam(conn.id, m.team); if (err) conn.send({ type: 'error', message: err }); return; }
        case 'input': return rooms.input(conn.id, m);
        case 'profile': return hub.setProfile(conn.id, m.profile);
        case 'party_join': { const err = hub.join(conn.id, m.code); if (err) conn.send({ type: 'error', message: err }); return; }
        case 'party_leave': return hub.leave(conn.id);
        case 'invite': { const err = hub.invite(conn.id, m.to); if (err) conn.send({ type: 'error', message: err }); return; }
        case 'queue': { const err = hub.setQueue(conn.id, m.on); if (err) conn.send({ type: 'error', message: err }); return; }
      }
    });
    ws.on('close', () => { rooms.leave(conn.id); hub.disconnect(conn.id); });
  });

  return { app, server, rooms, hub, persistence };
}

if (!process.env.VITEST) {
  // Con DATABASE_URL (Neon) se guarda en Postgres; sin ella, en memoria como antes.
  const url = process.env.DATABASE_URL;
  const persistence = createPersistence(url ? await createPgDb(url) : new MemoryDb());
  if (!url) console.log('[db] sin DATABASE_URL: los datos viven en memoria y se pierden al reiniciar');
  const { server } = createGameServer({ persistence });
  // Se espera la carga inicial un máximo de 8 s; si la base tarda más, sigue intentando en segundo plano.
  await Promise.race([persistence.start(), new Promise((r) => setTimeout(r, 8000))]);
  server.listen(config.port, () => console.log(`CyberGrid escuchando en http://localhost:${config.port}`));
  // Al apagar (por ejemplo, en cada deploy de Render) se vacía la cola de escrituras antes de salir.
  let closing = false;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, async () => {
    if (closing) return; closing = true;
    console.log(`[db] ${sig}: guardando lo pendiente…`);
    server.close();
    await persistence.shutdown();
    process.exit(0);
  });
}
