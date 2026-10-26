/**
 * Campamento (lobby estilo Delta Force): pestañas, escuadra, invitaciones, búsqueda de partida
 * y Preparación (escuela, Focos y aspecto). El perfil se guarda en el navegador y se manda al servidor.
 */
import {
  SCHOOLS, FOCOS, NOMBRES, BODIES, BODY_IDS, OUTFIT_IDS, HEAD_IDS, MAX_TEAM_SIZE, ProfileSchema, defaultProfile,
  type Profile, type View,
} from '@shared/index';
import { CampScene, PreviewScene, type CampMember } from './camp';
import { OUTFITS, HEADS } from './rig';
import type { Net } from './net';

type Tab = 'campamento' | 'preparacion' | 'privadas';
const KEY = 'cg-perfil';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface PartyMsg { id: string; code: string; leader: string; state: 'idle' | 'searching' | 'playing'; members: { id: string; name: string; profile?: Profile }[] }

export class HubUI {
  private myId = '';
  private profile: Profile | null = null;
  private party: PartyMsg | null = null;
  private online: { id: string; name: string; party: number; playing: boolean }[] = [];
  private tab: Tab = 'campamento';
  private visible = false;
  private camp: CampScene;
  private preview: PreviewScene;
  private searchStart = 0;
  private queueInfo: any = null;
  private inviteCode = '';
  private ticker = 0;

  constructor(private net: Net, private inPrivateRoom: () => boolean) {
    this.camp = new CampScene($<HTMLCanvasElement>('camp-canvas'), () => this.myId);
    this.preview = new PreviewScene($<HTMLCanvasElement>('prep-canvas'));
    for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]')) b.addEventListener('click', () => this.show(b.dataset.tab as Tab));
    // Preparación en pantallas angostas: una sección a la vez (Escuela, Focos o Aspecto).
    const ajustes = document.querySelector<HTMLElement>('.ajustes')!;
    for (const b of document.querySelectorAll<HTMLButtonElement>('.subtabs [data-sec]')) b.addEventListener('click', () => {
      ajustes.dataset.sec = b.dataset.sec!;
      for (const o of document.querySelectorAll<HTMLButtonElement>('.subtabs [data-sec]')) o.setAttribute('aria-selected', String(o === b));
    });

    net.on('hello', (m) => {
      this.myId = m.id;
      // El perfil guardado en este navegador manda; si no hay, se usa el del servidor.
      const saved = this.load();
      if (saved) { this.profile = saved; net.send({ type: 'profile', profile: saved }); }
    });
    net.on('party', (m: PartyMsg) => {
      const was = this.party?.state;
      this.party = m;
      if (!this.profile) this.profile = m.members.find((x) => x.id === this.myId)?.profile ?? null;
      if (m.state === 'searching' && was !== 'searching') this.searchStart = performance.now();
      if (m.state !== 'searching') this.queueInfo = null;
      this.renderParty(); this.renderOnline(); this.renderDeploy(); this.renderPrep();
    });
    net.on('online', (m) => { this.online = m.players; this.renderOnline(); });
    net.on('queue', (m) => { this.queueInfo = m; this.renderDeploy(); });
    net.on('invite', (m) => {
      this.inviteCode = m.code;
      $('invite-text').textContent = `${m.from} te invita a su escuadra.`;
      $('invite-box').hidden = false;
    });
    net.on('error', (m) => { if (this.visible && this.tab === 'campamento') $('party-error').textContent = m.message; });

    $('deploy-btn').addEventListener('click', () => {
      if (!this.party) return;
      this.net.send({ type: 'queue', on: this.party.state !== 'searching' });
    });
    $('party-copy').addEventListener('click', () => { if (this.party) navigator.clipboard?.writeText(this.party.code).catch(() => {}); });
    $('party-leave').addEventListener('click', () => this.net.send({ type: 'party_leave' }));
    $('party-join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = $<HTMLInputElement>('party-code-input').value.trim().toUpperCase();
      $('party-error').textContent = '';
      if (!/^[A-Z0-9]{5}$/.test(code)) { $('party-error').textContent = 'El código tiene 5 letras o números.'; return; }
      this.net.send({ type: 'party_join', code });
      $<HTMLInputElement>('party-code-input').value = '';
    });
    $('invite-accept').addEventListener('click', () => { this.net.send({ type: 'party_join', code: this.inviteCode }); $('invite-box').hidden = true; });
    $('invite-ignore').addEventListener('click', () => { $('invite-box').hidden = true; });

    for (const sel of document.querySelectorAll<HTMLElement>('.selector')) {
      for (const b of sel.querySelectorAll<HTMLButtonElement>('button')) b.addEventListener('click', () => this.cycle(sel.dataset.part as 'body' | 'outfit' | 'head', Number(b.dataset.dir)));
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('.giro [data-view]')) b.addEventListener('click', () => { this.preview.view = (b.dataset.view || null) as View | null; });
  }

  /** Muestra u oculta el campamento (las escenas solo se dibujan cuando se ven). */
  setVisible(on: boolean) {
    this.visible = on;
    window.clearInterval(this.ticker);
    if (on) { this.ticker = window.setInterval(() => this.renderDeploy(), 1000); this.show(this.tab); }
    else { this.camp.stop(); this.preview.stop(); }
  }

  show(tab: Tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const s of document.querySelectorAll<HTMLElement>('#screen-lobby .tab')) s.hidden = s.dataset.tab !== tab;
    if (!this.visible) return;
    if (tab === 'campamento') this.camp.start(); else this.camp.stop();
    if (tab === 'preparacion') { this.renderPrep(); this.preview.start(); } else this.preview.stop();
    this.renderDeploy();
  }

  private load(): Profile | null {
    try { const raw = localStorage.getItem(KEY); if (!raw) return null; const p = ProfileSchema.safeParse(JSON.parse(raw)); return p.success ? p.data : null; } catch { return null; }
  }

  private save(p: Profile) {
    this.profile = p;
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
    this.net.send({ type: 'profile', profile: p });
    this.renderPrep();
  }

  private renderParty() {
    const p = this.party; if (!p) return;
    $('party-code').textContent = p.code;
    $('party-leave').hidden = p.members.length < 2 || p.state === 'playing';
    const list = $('party-members');
    list.replaceChildren(...p.members.map((m) => {
      const li = document.createElement('li');
      li.dataset.member = m.name;
      const school = SCHOOLS.find((s) => s.id === m.profile?.build.school)?.name ?? '';
      li.innerHTML = '<span class="quien"></span><span class="tag"></span>';
      li.querySelector('.quien')!.textContent = `${m.id === p.leader ? '♛ ' : ''}${m.name}${m.id === this.myId ? ' (tú)' : ''}`;
      li.querySelector('.tag')!.textContent = school;
      return li;
    }));
    for (let i = p.members.length; i < MAX_TEAM_SIZE; i++) { const li = document.createElement('li'); li.className = 'libre'; li.textContent = 'Lugar libre'; list.append(li); }
    const members: CampMember[] = p.members.map((m) => {
      const prof = m.profile ?? defaultProfile(m.name);
      return { id: m.id, name: m.name, app: prof.appearance, foco: prof.build.focos[0], leader: m.id === p.leader, school: SCHOOLS.find((s) => s.id === prof.build.school)?.name ?? '' };
    });
    this.camp.set(members);
  }

  private renderOnline() {
    const p = this.party, list = $('online-list');
    const others = this.online.filter((o) => o.id !== this.myId && !p?.members.some((m) => m.id === o.id));
    if (!others.length) { const li = document.createElement('li'); li.className = 'libre'; li.textContent = 'Nadie más conectado por ahora.'; list.replaceChildren(li); return; }
    const full = (p?.members.length ?? 1) >= MAX_TEAM_SIZE;
    list.replaceChildren(...others.map((o) => {
      const li = document.createElement('li');
      li.dataset.online = o.name;
      const name = document.createElement('span');
      name.textContent = `${o.name}${o.playing ? ' · en partida' : o.party > 1 ? ` · escuadra de ${o.party}` : ''}`;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mini'; b.textContent = 'Invitar';
      b.disabled = full || o.playing;
      b.addEventListener('click', () => { this.net.send({ type: 'invite', to: o.id }); b.textContent = 'Invitado'; b.disabled = true; });
      li.append(name, b);
      return li;
    }));
  }

  private renderDeploy() {
    const p = this.party, btn = $<HTMLButtonElement>('deploy-btn'), st = $('queue-status');
    if (!p) { btn.disabled = true; return; }
    const leader = p.leader === this.myId;
    btn.dataset.state = p.state;
    if (this.inPrivateRoom()) { btn.disabled = true; btn.textContent = 'Estás en una sala privada'; st.textContent = 'Sal de la sala privada para buscar partida.'; return; }
    if (p.state === 'playing') { btn.disabled = true; btn.textContent = 'En partida'; st.textContent = ''; return; }
    if (p.state === 'searching') {
      btn.disabled = !leader; btn.textContent = leader ? 'Cancelar búsqueda' : 'Buscando…';
      const s = Math.floor((performance.now() - this.searchStart) / 1000), q = this.queueInfo;
      let msg = `Buscando partida · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (q) {
        msg += ` · ${q.players} en cola`;
        const falta: string[] = [];
        if (q.needPlayers > 0) falta.push(`${q.needPlayers} jugador${q.needPlayers > 1 ? 'es' : ''}`);
        if (q.needTeams > 0) falta.push(`${q.needTeams} equipo${q.needTeams > 1 ? 's' : ''} rival${q.needTeams > 1 ? 'es' : ''}`);
        msg += falta.length ? ` · faltan ${falta.join(' y ')}` : q.startsInMs != null ? ` · arranca en ${Math.ceil(q.startsInMs / 1000)} s` : '';
      }
      st.textContent = msg;
      return;
    }
    btn.disabled = !leader;
    btn.textContent = leader ? 'Entrar a la Grid' : 'Esperando al líder';
    st.textContent = leader ? (p.members.length > 1 ? `Entras con tu escuadra de ${p.members.length} como un equipo.` : 'Entras solo; puedes invitar hasta 2 más.') : 'El líder decide cuándo entrar.';
  }

  private renderPrep() {
    const p = this.profile; if (!p) return;
    const schools = $('school-list');
    schools.replaceChildren(...SCHOOLS.map((s) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'escuela'; b.dataset.school = s.id;
      b.setAttribute('aria-pressed', String(p.build.school === s.id));
      b.disabled = !s.playable;
      b.innerHTML = '<b></b><span class="titulo"></span><span class="rol"></span>';
      b.querySelector('b')!.textContent = s.name;
      b.querySelector('.titulo')!.textContent = s.title;
      const ns = Object.values(NOMBRES).filter((n) => n.school === s.id).map((n) => n.name).join(' · ');
      b.querySelector('.rol')!.textContent = s.playable ? `${s.role} · ${ns}` : `${s.role} · Próximamente`;
      b.addEventListener('click', () => this.save({ ...p, build: { ...p.build, school: s.id } }));
      return b;
    }));
    // Focos: dos de los ocho, con flechas para cambiar cada uno (no se puede repetir).
    const focos = $('foco-list'), ids = Object.keys(FOCOS);
    const cards = p.build.focos.map((id, i) => {
      const f = FOCOS[id], d = document.createElement('div');
      d.className = 'foco'; d.dataset.ability = id; d.dataset.slot = String(i);
      d.innerHTML = '<button type="button" class="mini" data-dir="-1" aria-label="Anterior">‹</button><span class="ico-foco" aria-hidden="true"></span><div><b></b><span></span></div><button type="button" class="mini" data-dir="1" aria-label="Siguiente">›</button>';
      d.querySelector('b')!.textContent = `${i === 0 ? 'Principal' : 'Secundario'} · ${f.name}`;
      const kind = f.basic.shape.type === 'cono' ? (f.melee ? 'cuerpo a cuerpo' : 'onda corta') : `a distancia, ${f.basic.shape.range} casillas`;
      d.querySelector(':scope > div > span')!.textContent = `${f.desc} ${kind[0].toUpperCase() + kind.slice(1)}. R: ${f.insc.name}, ${f.insc.desc.toLowerCase()}`;
      for (const b of d.querySelectorAll<HTMLButtonElement>('button')) b.addEventListener('click', () => {
        const other = p.build.focos[1 - i], dir = Number(b.dataset.dir);
        let k = ids.indexOf(id);
        do k = (k + dir + ids.length) % ids.length; while (ids[k] === other);
        const next: [string, string] = i === 0 ? [ids[k], other] : [other, ids[k]];
        this.save({ ...p, build: { ...p.build, focos: next } });
      });
      return d;
    });
    const swap = document.createElement('button');
    swap.type = 'button'; swap.className = 'mini'; swap.textContent = 'Intercambiar orden';
    swap.addEventListener('click', () => this.save({ ...p, build: { ...p.build, focos: [p.build.focos[1], p.build.focos[0]] } }));
    focos.replaceChildren(...cards, swap);
    const names = {
      body: BODIES.medio.name,
      outfit: `${OUTFITS[p.appearance.outfit].name} (${OUTFITS[p.appearance.outfit].school})`,
      head: HEADS[p.appearance.head].name,
    };
    for (const sel of document.querySelectorAll<HTMLElement>('.selector')) sel.querySelector('b')!.textContent = names[sel.dataset.part as keyof typeof names];
    this.preview.set(p.appearance, p.build.focos[0]);
  }

  private cycle(part: 'body' | 'outfit' | 'head', dir: number) {
    const p = this.profile; if (!p) return;
    const list: readonly string[] = part === 'body' ? BODY_IDS : part === 'outfit' ? OUTFIT_IDS : HEAD_IDS;
    const i = list.indexOf(p.appearance[part]);
    const next = list[(i + dir + list.length) % list.length];
    this.save({ ...p, appearance: { ...p.appearance, [part]: next } as Profile['appearance'] });
  }
}
