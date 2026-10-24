import './style.css';
import { Net } from './net';
import { Game } from './game';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = ['screen-login', 'screen-lobby', 'screen-game'] as const;
function show(id: typeof screens[number]) { for (const s of screens) $(s).hidden = s !== id; }

let token: string | null = null;
try { token = sessionStorage.getItem('cg-token'); } catch { /* sin almacenamiento */ }
let username = '';
const net = new Net();
let game: Game | null = null;
let roomsTimer: number | undefined;
let currentRoom: string | null = null;

async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Error inesperado.');
  return data;
}

// ---------- Acceso ----------
async function authenticate(kind: 'login' | 'register') {
  const err = $('auth-error');
  err.textContent = '';
  const body = { username: $<HTMLInputElement>('username').value.trim(), password: $<HTMLInputElement>('password').value };
  if (body.username.length < 3) { err.textContent = 'Escribe un usuario de al menos 3 caracteres.'; return; }
  if (body.password.length < 6) { err.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
  try {
    const r = await api(`/api/auth/${kind}`, { method: 'POST', body });
    token = r.token; username = r.username;
    try { sessionStorage.setItem('cg-token', r.token); } catch { /* opcional */ }
    await enterLobby();
  } catch (e) { err.textContent = (e as Error).message; }
}
$('auth-form').addEventListener('submit', (e) => { e.preventDefault(); authenticate('login'); });
$('register-btn').addEventListener('click', () => authenticate('register'));
$('logout-btn').addEventListener('click', logout);

function logout() {
  token = null; net.close(); window.clearInterval(roomsTimer);
  try { sessionStorage.removeItem('cg-token'); } catch { /* opcional */ }
  location.hash = '';
  show('screen-login');
}

// ---------- Lobby ----------
async function enterLobby() {
  try { username = (await api('/api/auth/me')).username; }
  catch { return logout(); }
  $('whoami').textContent = username;
  show('screen-lobby');
  location.hash = 'lobby';
  if (!net.connected) {
    await net.connect(token!);
    setSocket(true);
  }
  await refreshRooms();
  window.clearInterval(roomsTimer);
  roomsTimer = window.setInterval(refreshRooms, 3000);
}

function setSocket(on: boolean) {
  const s = $('socket-status');
  s.dataset.state = on ? 'connected' : 'disconnected';
  s.textContent = on ? 'Conectado' : 'Desconectado';
}

async function refreshRooms() {
  const { rooms } = await api('/api/rooms').catch(() => ({ rooms: [] }));
  const list = $('room-list');
  list.replaceChildren(...rooms.map((r: any) => {
    const li = document.createElement('li');
    li.dataset.roomId = r.id;
    const info = document.createElement('span');
    info.textContent = `${r.name} · ${r.players}/${r.max}${r.locked ? ' · con contraseña' : ''}${r.state === 'playing' ? ' · en partida' : ''}`;
    const actions = document.createElement('span');
    actions.className = 'row'; actions.style.margin = '0';
    let pwd: HTMLInputElement | null = null;
    if (r.locked) { pwd = document.createElement('input'); pwd.placeholder = 'Contraseña'; pwd.type = 'password'; actions.append(pwd); }
    const btn = document.createElement('button');
    btn.textContent = 'Unirse'; btn.disabled = r.state === 'playing' || currentRoom === r.id;
    btn.addEventListener('click', () => net.send({ type: 'join', roomId: r.id, password: pwd?.value || undefined }));
    actions.append(btn);
    li.append(info, actions);
    return li;
  }));
  if (!rooms.length) { const li = document.createElement('li'); li.textContent = 'No hay salas. Crea la primera.'; list.append(li); }
}

$('create-room').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('lobby-error').textContent = '';
  const name = $<HTMLInputElement>('room-name').value.trim();
  if (name.length < 3) { $('lobby-error').textContent = 'El nombre de la sala necesita al menos 3 caracteres.'; return; }
  try {
    const password = $<HTMLInputElement>('room-password').value || undefined;
    const room = await api('/api/rooms', { method: 'POST', body: { name, password } });
    net.send({ type: 'join', roomId: room.id, password });
    await refreshRooms();
  } catch (err) { $('lobby-error').textContent = (err as Error).message; }
});

net.on('error', (m) => { $('lobby-error').textContent = m.message; });
net.on('close', () => setSocket(false));
net.on('latency', (m) => { $('lobby-ping').textContent = `${Math.round(m.ms)} ms`; });
net.on('lobby', (m) => {
  currentRoom = m.room.id;
  $('room-panel').hidden = false;
  $('room-title').textContent = m.room.name;
  const me = m.players.find((p: any) => p.name === username);
  const ready = $('ready-btn');
  ready.setAttribute('aria-pressed', String(!!me?.ready));
  ready.textContent = me?.ready ? 'Listo ✓' : 'Listo';
  $('room-players').replaceChildren(...m.players.map((p: any) => {
    const li = document.createElement('li');
    li.dataset.player = p.name;
    li.innerHTML = `<span></span><span class="tag ${p.ready ? 'ok' : ''}">${p.ready ? 'Listo' : 'Esperando'}</span>`;
    li.firstElementChild!.textContent = p.name;
    return li;
  }));
});
$('ready-btn').addEventListener('click', () => net.send({ type: 'ready', ready: $('ready-btn').getAttribute('aria-pressed') !== 'true' }));
$('leave-btn').addEventListener('click', () => { net.send({ type: 'leave' }); currentRoom = null; $('room-panel').hidden = true; refreshRooms(); });

// ---------- Partida ----------
net.on('start', (m) => {
  window.clearInterval(roomsTimer);
  $('result').hidden = true;
  show('screen-game');
  game?.destroy();
  game = new Game($('screen-game'), net, m);
});
net.on('end', (m) => {
  $('result-title').textContent = 'Partida terminada';
  $('result-list').replaceChildren(...m.results.map((p: any) => {
    const li = document.createElement('li');
    li.textContent = `${p.name} · ${p.extracted ? 'Extrajo' : 'Cayó'} · ${p.kills} bajas · ${Math.round(p.survivedS)} s`;
    return li;
  }));
  $('result').hidden = false;
});
net.on('extracted', () => { $('result-title').textContent = 'Escapaste de la Grid'; });
$('back-btn').addEventListener('click', () => { game?.destroy(); game = null; enterLobby(); });

// ---------- Arranque: las salas están protegidas, sin sesión se muestra el acceso ----------
if (token) enterLobby(); else show('screen-login');
