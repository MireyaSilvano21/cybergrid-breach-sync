import express from 'express';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientMessageSchema, CredentialsSchema, CreateRoomSchema, SeedPayloadSchema } from '@shared/index';
import { config } from './config';
import { checkCredentials, issueToken, registerUser, requireAuth, verifyToken, type AuthedRequest } from './auth';
import { RoomManager } from './rooms';
import { generateMatches, telemetry } from './telemetry';
import type { Conn } from './game';

export function createGameServer(): { app: express.Express; server: Server; rooms: RoomManager } {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  const rooms = new RoomManager((record) => telemetry.add(record));

  app.get('/api/health', (_req, res) => res.json({ ok: true, uptimeS: Math.round(process.uptime()) }));

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
      if (p.data.reset) telemetry.reset();
      const matches = 'matches' in p.data ? p.data.matches : generateMatches(p.data.generate.count, p.data.generate.seed);
      telemetry.addMany(matches);
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
    ws.on('message', (raw) => {
      let data: unknown;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      const p = ClientMessageSchema.safeParse(data);
      if (!p.success) return conn.send({ type: 'error', message: 'Mensaje inválido.' });
      const m = p.data;
      switch (m.type) {
        case 'ping': return conn.send({ type: 'pong', t: m.t });
        case 'join': { const err = rooms.join(conn, m.roomId, m.password); if (err) conn.send({ type: 'error', message: err }); return; }
        case 'leave': return rooms.leave(conn.id);
        case 'ready': return rooms.setReady(conn.id, m.ready);
        case 'team': { const err = rooms.setTeam(conn.id, m.team); if (err) conn.send({ type: 'error', message: err }); return; }
        case 'input': return rooms.input(conn.id, m);
      }
    });
    ws.on('close', () => rooms.leave(conn.id));
  });

  return { app, server, rooms };
}

if (!process.env.VITEST) {
  const { server } = createGameServer();
  server.listen(config.port, () => console.log(`CyberGrid escuchando en http://localhost:${config.port}`));
}
