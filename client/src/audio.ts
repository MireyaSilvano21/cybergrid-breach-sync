/**
 * Sonido del juego, sintetizado con Web Audio (sin archivos): un solo AudioContext que se
 * desbloquea con el primer toque o tecla (política de autoplay), un compresor que evita que los
 * sonidos sumados saturen, límite de voces y de repeticiones, y sonido posicional sencillo
 * (volumen por distancia y paneo izquierda/derecha respecto a la cámara).
 */
type Pos = { x: number; y: number };
type Recipe = (s: Synth) => void;

const KEY = 'cybergrid.sonido';
const MAX_VOICES = 28;
const HEAR = 1000;

/** Herramientas para armar un sonido en el instante t, hacia la salida out. */
class Synth {
  constructor(readonly ctx: AudioContext, readonly out: AudioNode, readonly t: number, readonly noiseBuf: AudioBuffer, private track: (n: AudioScheduledSourceNode) => void) {}

  private env(g: GainNode, at: number, peak: number, attack: number, dur: number) {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  }

  /** Oscilador con deslizamiento de frecuencia y envolvente. */
  tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0, attack = 0.005) {
    const at = this.t + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    this.env(g, at, gain, attack, dur);
    o.connect(g).connect(this.out); o.start(at); o.stop(at + dur + 0.02); this.track(o);
  }

  /** Ruido filtrado (barridos, golpes, chasquidos). */
  noise(dur: number, gain: number, type: BiquadFilterType, f0: number, f1: number, q = 1, delay = 0, attack = 0.003) {
    const at = this.t + delay, src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.noiseBuf; src.loop = true;
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, at); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + dur);
    this.env(g, at, gain, attack, dur);
    src.connect(f).connect(g).connect(this.out); src.start(at, Math.random()); src.stop(at + dur + 0.02); this.track(src);
  }

  /** Campana: parciales inarmónicos que se apagan lento. */
  bell(f: number, dur: number, gain: number, delay = 0) {
    for (const [m, k] of [[1, 1], [2.01, 0.5], [2.76, 0.35], [5.4, 0.15]]) this.tone('sine', f * m, f * m * 0.995, dur * (1.1 - k * 0.3), gain * k, delay, 0.004);
  }
}

const R: Record<string, Recipe> = {
  // Ataques
  swing: (s) => s.noise(0.14, 0.35, 'bandpass', 2200, 600, 1.2),
  swing_heavy: (s) => { s.noise(0.26, 0.45, 'bandpass', 1000, 220, 1); s.tone('sine', 110, 45, 0.22, 0.5, 0.08); },
  stab: (s) => { s.noise(0.09, 0.35, 'highpass', 2600, 1200); s.tone('triangle', 700, 220, 0.07, 0.25); },
  shot: (s) => { s.noise(0.12, 0.55, 'lowpass', 4000, 600); s.tone('sine', 170, 55, 0.13, 0.55); s.noise(0.02, 0.3, 'highpass', 5000, 5000); },
  bow: (s) => { s.tone('triangle', 440, 170, 0.2, 0.3); s.noise(0.06, 0.2, 'highpass', 3000, 1500); },
  magic: (s) => { s.tone('sine', 520, 900, 0.26, 0.14); s.tone('sine', 790, 1350, 0.26, 0.1, 0.02); s.noise(0.25, 0.08, 'highpass', 6000, 9000); },
  fire: (s) => { s.noise(0.4, 0.35, 'lowpass', 1600, 400, 0.8); s.noise(0.3, 0.15, 'bandpass', 3000, 1200, 3, 0.05); },
  // Habilidades
  heal: (s) => { [523, 659, 784, 1046].forEach((f, i) => s.tone('sine', f, f, 0.22, 0.14, i * 0.06)); },
  blink: (s) => { s.noise(0.22, 0.35, 'bandpass', 300, 3200, 2); s.tone('sine', 300, 1200, 0.2, 0.08); },
  dash: (s) => s.noise(0.28, 0.4, 'bandpass', 400, 1600, 1.5),
  quake: (s) => { s.tone('sine', 75, 32, 0.55, 0.7); s.noise(0.5, 0.4, 'lowpass', 400, 80); },
  veil: (s) => { s.noise(0.5, 0.25, 'lowpass', 900, 200); s.tone('sine', 400, 200, 0.4, 0.06); },
  wind: (s) => { s.noise(0.7, 0.3, 'bandpass', 500, 1500, 3); s.noise(0.7, 0.2, 'bandpass', 1500, 600, 3, 0.1); },
  ward: (s) => { s.tone('sine', 1200, 1600, 0.3, 0.08); s.tone('sine', 1800, 2400, 0.3, 0.05, 0.05); },
  // Impactos y daño
  hit: (s) => { s.tone('sine', 190, 60, 0.1, 0.55); s.noise(0.05, 0.35, 'bandpass', 1400, 900, 1); },
  hurt: (s) => { s.tone('square', 160, 80, 0.14, 0.12); s.noise(0.12, 0.35, 'lowpass', 900, 200); },
  death: (s) => { s.tone('sawtooth', 280, 50, 0.8, 0.18); s.noise(0.8, 0.2, 'lowpass', 1200, 100); },
  // Botín y mochila
  pickup: (s) => { s.tone('sine', 880, 880, 0.08, 0.18); s.tone('sine', 1320, 1320, 0.12, 0.16, 0.06); },
  chest: (s) => { s.tone('sawtooth', 130, 85, 0.3, 0.1); s.noise(0.05, 0.3, 'bandpass', 900, 600, 2, 0.24); },
  drop: (s) => { s.tone('triangle', 320, 140, 0.12, 0.25); s.noise(0.06, 0.2, 'lowpass', 800, 300, 1, 0.08); },
  tonic: (s) => { for (let i = 0; i < 4; i++) s.tone('sine', 300 + i * 90, 700 + i * 90, 0.07, 0.12, i * 0.07); },
  // Partida
  sync: (s) => s.tone('sine', 300, 620, 0.5, 0.1, 0, 0.05),
  extract: (s) => { [392, 494, 587, 784].forEach((f, i) => s.tone('triangle', f, f, 0.9, 0.12, i * 0.08, 0.02)); },
  portal: (s) => { s.tone('sine', 55, 70, 1.6, 0.4, 0, 0.6); s.tone('sine', 110, 140, 1.6, 0.18, 0.1, 0.6); },
  phase: (s) => s.bell(330, 2.2, 0.3),
  alarm: (s) => { for (let i = 0; i < 4; i++) s.tone('square', i % 2 ? 660 : 880, i % 2 ? 660 : 880, 0.11, 0.07, i * 0.13); },
  mono: (s) => { s.bell(98, 2.5, 0.35); s.tone('sine', 49, 49, 2, 0.25, 0, 0.2); },
  name_ok: (s) => s.bell(880, 0.9, 0.25),
  name_bad: (s) => s.tone('square', 140, 110, 0.28, 0.15),
  // Desnombrados
  m_slash: (s) => { s.noise(0.16, 0.35, 'bandpass', 1500, 500, 1.2); s.tone('sawtooth', 190, 110, 0.18, 0.08); },
  m_lament: (s) => { s.tone('sawtooth', 300, 220, 0.8, 0.08, 0, 0.1); s.noise(0.8, 0.12, 'bandpass', 600, 1300, 6); },
  m_slam: (s) => { s.tone('sine', 55, 28, 0.8, 0.9); s.noise(0.7, 0.5, 'lowpass', 350, 60); },
  m_die: (s) => s.noise(0.5, 0.3, 'lowpass', 2200, 150),
  // Interfaz y escenario
  click: (s) => s.tone('sine', 1300, 900, 0.035, 0.08),
  door: (s) => s.tone('sawtooth', 95, 70, 0.22, 0.05, 0, 0.02),
};

export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private voices = 0;
  private last = new Map<string, number>();
  private amb: { stop(): void } | null = null;
  private wantAmb = false;
  /** Posición de quien escucha (la cámara), para volumen y paneo. */
  listener: Pos = { x: 0, y: 0 };
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem(KEY) === 'off'; } catch { /* sin almacenamiento */ }
    // El navegador solo deja sonar después de un gesto: el primer toque o tecla lo desbloquea.
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, unlock, { capture: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.ctx?.suspend(); else if (!this.muted) void this.ctx?.resume(); });
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
        const out = ctx.createGain(); out.gain.value = this.muted ? 0 : 0.7;
        out.connect(comp).connect(ctx.destination);
        const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.ctx = ctx; this.out = out; this.noiseBuf = buf;
        // Si la partida ya pidió el fondo antes de que hubiera sonido, empieza ahora.
        if (this.wantAmb) this.startAmbience();
      }
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
    } catch { /* sin Web Audio: el juego sigue en silencio */ }
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem(KEY, m ? 'off' : 'on'); } catch { /* sin almacenamiento */ }
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  /**
   * Toca un sonido. Con posición, baja con la distancia (deja de oírse a ~1000 px) y se panea.
   * minGapMs evita que el mismo sonido se apile muchas veces en el mismo instante.
   */
  play(name: string, pos?: Pos, vol = 1, minGapMs = 40) {
    const ctx = this.ctx, out = this.out, recipe = R[name];
    if (!ctx || !out || !this.noiseBuf || !recipe || this.muted || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1e9) < minGapMs || this.voices >= MAX_VOICES) return;
    this.last.set(name, now);
    let gain = vol, pan = 0;
    if (pos) {
      const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, d = Math.hypot(dx, dy);
      if (d > HEAR) return;
      gain *= Math.pow(1 - d / HEAR, 1.5);
      pan = Math.max(-0.85, Math.min(0.85, dx / 600));
    }
    try {
      const g = ctx.createGain(); g.gain.value = gain;
      let node: AudioNode = g;
      if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
      node.connect(out);
      const track = (n: AudioScheduledSourceNode) => { this.voices++; n.onended = () => { this.voices--; }; };
      recipe(new Synth(ctx, g, ctx.currentTime + 0.005, this.noiseBuf, track));
    } catch { /* un sonido fallido no detiene el juego */ }
  }

  /** Fondo de la partida: un zumbido grave que respira, muy bajo (la música necesitaría archivos). */
  startAmbience() {
    this.wantAmb = true;
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out || this.amb) return;
    try {
      const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 4);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240; f.Q.value = 2;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 120; lfo.connect(lg).connect(f.frequency);
      const oscs = [55, 55.4, 82.4].map((fr) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(); return o; });
      f.connect(g).connect(out); lfo.start();
      this.amb = { stop: () => { g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5); setTimeout(() => { for (const o of [...oscs, lfo]) o.stop(); }, 2000); } };
    } catch { /* sin fondo */ }
  }

  stopAmbience() { this.wantAmb = false; this.amb?.stop(); this.amb = null; }
}

/** Un solo sonido para todo el juego (menús y partida). */
export const sound = new Sound();
