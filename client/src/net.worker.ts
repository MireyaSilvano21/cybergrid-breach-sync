/**
 * La conexión WebSocket vive en un hilo aparte: el ping/pong se mide aquí, sin esperar
 * a que el hilo principal termine de dibujar el cuadro, así que el valor refleja la red.
 */
/** Ámbito del worker, tipado a mano para no mezclar los tipos de DOM y de workers en el proyecto. */
const ctx = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null };

let ws: WebSocket | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const samples: number[] = [];

const ping = () => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', t: performance.now() })); };

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.cmd === 'connect') {
    ws = new WebSocket(m.url);
    ws.onopen = () => { ctx.postMessage({ evt: 'open' }); ping(); timer = setInterval(ping, 2000); };
    ws.onerror = () => ctx.postMessage({ evt: 'error' });
    ws.onclose = () => { clearInterval(timer); ctx.postMessage({ evt: 'close' }); };
    ws.onmessage = (ev) => {
      const data = ev.data as string;
      if (data.startsWith('{"type":"pong"')) {
        const { t } = JSON.parse(data);
        samples.push(performance.now() - t);
        if (samples.length > 5) samples.shift();
        ctx.postMessage({ evt: 'latency', ms: samples.reduce((a, b) => a + b, 0) / samples.length });
        return;
      }
      ctx.postMessage({ evt: 'message', data });
    };
  } else if (m.cmd === 'send') {
    if (ws?.readyState === WebSocket.OPEN) ws.send(m.data);
  } else if (m.cmd === 'close') {
    clearInterval(timer); ws?.close(); ws = null;
  }
};
