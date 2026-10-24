type Handler = (msg: any) => void;

/** Conexión WebSocket con el servidor, con medición de latencia ping/pong. */
export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private pingTimer: number | undefined;
  latency = 0;
  private samples: number[] = [];

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
      this.ws = ws;
      ws.onopen = () => {
        this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
        this.send({ type: 'ping', t: performance.now() });
        resolve();
      };
      ws.onerror = () => reject(new Error('No se pudo conectar con el servidor.'));
      ws.onclose = () => { window.clearInterval(this.pingTimer); this.emit('close', {}); };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'pong') {
          // Promedio de las últimas 5 mediciones para que el valor no salte.
          this.samples.push(performance.now() - msg.t);
          if (this.samples.length > 5) this.samples.shift();
          this.latency = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
          this.emit('latency', { ms: this.latency });
        }
        this.emit(msg.type, msg);
      };
    });
  }

  get connected() { return this.ws?.readyState === WebSocket.OPEN; }

  send(msg: unknown) { if (this.connected) this.ws!.send(JSON.stringify(msg)); }

  on(type: string, fn: Handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return () => this.handlers.get(type)!.delete(fn);
  }

  private emit(type: string, msg: any) { this.handlers.get(type)?.forEach((h) => h(msg)); }

  close() { window.clearInterval(this.pingTimer); this.ws?.close(); this.ws = null; }
}
