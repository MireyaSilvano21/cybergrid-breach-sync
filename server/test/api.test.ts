import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createGameServer } from '../src/index';

let base = '', wsBase = '';
const { server } = createGameServer();

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`; wsBase = `ws://127.0.0.1:${port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (p: string, body: unknown, token?: string) => fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});

async function login(name: string) {
  const r = await post('/api/auth/register', { username: name, password: 'secreta123' });
  return (await r.json()).token as string;
}

function openWs(token?: string): Promise<{ ws: WebSocket; next: (type: string) => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws${token ? `?token=${token}` : ''}`);
    const queue: any[] = []; const waiters: { type: string; fn: (m: any) => void }[] = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      const i = waiters.findIndex((w) => w.type === m.type);
      if (i >= 0) waiters.splice(i, 1)[0].fn(m); else queue.push(m);
    });
    const next = (type: string) => new Promise<any>((res) => {
      const i = queue.findIndex((m) => m.type === type);
      if (i >= 0) res(queue.splice(i, 1)[0]); else waiters.push({ type, fn: res });
    });
    ws.on('open', () => resolve({ ws, next }));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))));
  });
}

describe('Endpoints de prueba', () => {
  it('POST /api/test/seed inyecta 1000 partidas y GET /api/test/telemetry responde en < 200 ms', async () => {
    const r = await post('/api/test/seed', { generate: { count: 1000, seed: 7 }, reset: true });
    expect(r.status).toBe(201);
    expect((await r.json()).totalMatches).toBe(1000);
    const t0 = performance.now();
    const t = await fetch(base + '/api/test/telemetry');
    const elapsed = performance.now() - t0;
    expect(t.status).toBe(200);
    const body = await t.json();
    expect(body).toMatchObject({ matches: 1000 });
    expect(body.winRate).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });

  it('rechaza un seed fuera de rango', async () => {
    expect((await post('/api/test/seed', { generate: { count: 5 } })).status).toBe(400);
  });
});

describe('Sockets y salas', () => {
  it('rechaza la conexión WebSocket sin token válido', async () => {
    await expect(openWs()).rejects.toThrow('401');
    await expect(openWs('falso.token')).rejects.toThrow('401');
  });

  it('ping/pong con latencia < 100 ms', async () => {
    const { ws, next } = await openWs(await login('pinger'));
    await next('hello');
    const t0 = performance.now();
    ws.send(JSON.stringify({ type: 'ping', t: t0 }));
    await next('pong');
    expect(performance.now() - t0).toBeLessThan(100);
    ws.close();
  });

  it('crea sala, marca Listo e inicia la partida con estado autoritativo', async () => {
    const token = await login('lider');
    const room = await (await post('/api/rooms', { name: 'Sala de prueba' }, token)).json();
    const { ws, next } = await openWs(token);
    await next('hello');
    ws.send(JSON.stringify({ type: 'join', roomId: room.id }));
    expect((await next('lobby')).players).toHaveLength(1);
    ws.send(JSON.stringify({ type: 'ready', ready: true }));
    const start = await next('start');
    expect(typeof start.seed).toBe('number');
    const snap = await next('snap');
    expect(snap.you.hp).toBe(100);
    ws.close();
  });
});
