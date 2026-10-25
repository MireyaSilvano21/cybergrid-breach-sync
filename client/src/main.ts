import './style.css';
import { Net } from './net';
import { Game } from './game';
import { TEAMS, MAX_TEAM_SIZE } from '@shared/index';
import { HubUI } from './hubui';
import { setupSplash } from './fullscreen';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = ['screen-login', 'screen-lobby', 'screen-game'] as const;
function show(id: typeof screens[number]) { for (const s of screens) $(s).hidden = s !== id; hub?.setVisible(id === 'screen-lobby'); }

let token: string | null = null;
try { token = sessionStorage.getItem('cg-token'); } catch { /* sin almacenamiento */ }
let username = '';
const net = new Net();
let game: Game | null = null;
let roomsTimer: number | undefined;
let currentRoom: string | null = null;
/** La partida actual vino del emparejamiento (al terminar se vuelve al campamento). */
let matchmade = false;
let hub: HubUI | null = null;

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
  // Cuatro equipos con su color; cada uno muestra a sus jugadores y un botón para cambiarse.
  $('room-players').replaceChildren(...TEAMS.map((t) => {
    const members = m.players.filter((p: any) => p.team === t.id);
    const sec = document.createElement('section');
    sec.className = 'equipo'; sec.dataset.team = String(t.id); sec.style.setProperty('--team', t.color);
    if (me?.team === t.id) sec.classList.add('mio');
    const head = document.createElement('header');
    head.innerHTML = `<span class="chip"></span><b></b><span class="cupo">${members.length}/${MAX_TEAM_SIZE}</span>`;
    head.querySelector('b')!.textContent = t.name;
    if (me && me.team !== t.id) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mini'; b.textContent = 'Unirme';
      b.disabled = members.length >= MAX_TEAM_SIZE;
      b.addEventListener('click', () => net.send({ type: 'team', team: t.id }));
      head.append(b);
    }
    const ul = document.createElement('ul'); ul.className = 'list';
    for (const p of members) {
      const li = document.createElement('li');
      li.dataset.player = p.name;
      li.innerHTML = `<span></span><span class="tag ${p.ready ? 'ok' : ''}">${p.ready ? 'Listo' : 'Esperando'}</span>`;
      li.firstElementChild!.textContent = p.name;
      ul.append(li);
    }
    if (!members.length) { const li = document.createElement('li'); li.className = 'libre'; li.textContent = 'Libre'; ul.append(li); }
    sec.append(head, ul);
    return sec;
  }));
});
// Campamento: escuadra, preparación y emparejamiento.
hub = new HubUI(net, () => currentRoom !== null);

$('ready-btn').addEventListener('click', () => net.send({ type: 'ready', ready: $('ready-btn').getAttribute('aria-pressed') !== 'true' }));
$('leave-btn').addEventListener('click', () => { net.send({ type: 'leave' }); currentRoom = null; $('room-panel').hidden = true; refreshRooms(); });

// ---------- Partida ----------
net.on('start', (m) => {
  window.clearInterval(roomsTimer);
  matchmade = currentRoom === null;
  $('back-btn').textContent = matchmade ? 'Volver al campamento' : 'Volver a la sala';
  $('result').hidden = true;
  show('screen-game');
  game?.destroy();
  game = new Game($('screen-game'), net, m);
});
net.on('end', (m) => {
  $('result-title').textContent = 'Partida terminada';
  // Resultados por equipo: el botín que sacaron entre todos y cada integrante.
  const teams = TEAMS.filter((t) => m.results.some((p: any) => p.team === t.id));
  const groups = teams.length ? teams.map((t) => ({ t, list: m.results.filter((p: any) => p.team === t.id) })) : [{ t: null, list: m.results }];
  const total = (l: any[]) => l.reduce((n, p) => n + (p.extracted ? p.lootValue ?? 0 : 0), 0);
  groups.sort((a, b) => total(b.list) - total(a.list));
  $('result-list').replaceChildren(...groups.flatMap(({ t, list }) => {
    const items: HTMLElement[] = [];
    if (t) {
      const h = document.createElement('li');
      h.className = 'res-equipo'; h.style.setProperty('--team', t.color);
      const out = list.filter((p: any) => p.extracted).length;
      h.textContent = `Equipo ${t.name} · ${out}/${list.length} escaparon · ${total(list)} ◆`;
      items.push(h);
    }
    for (const p of list) {
      const li = document.createElement('li');
      li.textContent = `${p.name} · ${p.extracted ? `Extrajo ${p.lootValue ?? 0} ◆` : 'Cayó'} · ${p.kills} bajas · ${Math.round(p.survivedS)} s`;
      items.push(li);
    }
    return items;
  }));
  $('result').hidden = false;
});
net.on('extracted', () => { $('result-title').textContent = 'Escapaste de la Grid'; });
$('back-btn').addEventListener('click', () => { game?.destroy(); game = null; enterLobby(); });

setupSplash();

// ---------- Arranque: las salas están protegidas, sin sesión se muestra el acceso ----------
if (token) enterLobby(); else show('screen-login');
