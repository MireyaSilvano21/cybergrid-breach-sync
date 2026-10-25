/**
 * Pantalla completa como en un juego: en pantallas táctiles el primer toque la activa y gira a
 * horizontal. Los navegadores solo la permiten tras un toque del usuario, por eso hay una pantalla
 * de inicio "Toca para empezar". En iPhone (Safari no la permite en páginas) se recomienda
 * agregar el juego a la pantalla de inicio, que abre sin barras gracias al manifiesto.
 */
export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function enterFullscreen(): Promise<void> {
  if (document.fullscreenElement || !document.fullscreenEnabled) return Promise.resolve();
  return document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => { /* el navegador puede negarlo; el juego funciona igual */ });
}

/** Pantalla de inicio en táctil: un toque entra a pantalla completa y la quita. */
export function setupSplash() {
  const splash = document.getElementById('splash');
  if (!splash || !isTouch() || standalone()) return;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !document.fullscreenEnabled;
  splash.querySelector<HTMLElement>('.ios')!.hidden = !ios;
  splash.hidden = false;
  const go = (e: Event) => { e.preventDefault(); enterFullscreen().finally(() => { splash.hidden = true; }); };
  splash.addEventListener('pointerup', go, { once: true });
  // Si se sale de la pantalla completa, el siguiente toque en cualquier parte la vuelve a activar.
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) return;
    document.addEventListener('pointerup', () => enterFullscreen(), { once: true });
  });
}
