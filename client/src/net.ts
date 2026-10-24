type Handler = (msg: any) => void;

/**
 * Conexión con el servidor. El WebSocket y la medición de latencia corren en un Web Worker
 * (net.worker.ts) para que el dibujo del juego no retrase la lectura de los mensajes.
 */
export class Net {
  private worker: Worker | null = null;
  private open = false;
  private handlers = new Map<string, Set<Handler>>();
  latency = 0;

  connect(token: string): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`;
      const worker = new Worker(new URL('./net.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data;
        switch (m.evt) {
          case 'open': this.open = true; resolve(); break;
          case 'error': if (!this.open) reject(new Error('No se pudo conectar con el servidor.')); break;
          case 'close': this.open = false; this.emit('close', {}); break;
          case 'latency': this.latency = m.ms; this.emit('latency', { ms: m.ms }); break;
          case 'message': { const msg = JSON.parse(m.data); this.emit(msg.type, msg); break; }
        }
      };
      worker.postMessage({ cmd: 'connect', url });
    });
  }

  get connected() { return this.open; }

  send(msg: unknown) { if (this.open) this.worker!.postMessage({ cmd: 'send', data: JSON.stringify(msg) }); }

  on(type: string, fn: Handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return () => this.handlers.get(type)!.delete(fn);
  }

  private emit(type: string, msg: any) { this.handlers.get(type)?.forEach((h) => h(msg)); }

  close() {
    this.worker?.postMessage({ cmd: 'close' });
    this.worker?.terminate();
    this.worker = null;
    this.open = false;
  }
}
