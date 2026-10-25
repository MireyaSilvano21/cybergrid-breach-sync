import { expect, test } from '@playwright/test';
import { register, uniqueName } from './helpers';
test('Flujo de combate táctil: Usar responde, arrastrar apunta, regresar cancela y un toque rápido auto-apunta', async ({ browser }) => {
  const mc = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const m = await mc.newPage(), b = await browser.newPage();
  await register(m, uniqueName('tactil')); await register(b, uniqueName('rival'));
  const room = uniqueName('Movil');
  await m.fill('#room-name', room); await m.click('#create-room button[type=submit]');
  const row = b.locator('#room-list li', { hasText: room }); await expect(row).toBeVisible({ timeout: 8000 });
  await row.getByRole('button', { name: 'Unirse' }).click();
  await m.click('#ready-btn'); await b.click('#ready-btn');
  await expect(m.locator('#screen-game')).toBeVisible();
  await m.waitForTimeout(1500);
  // El botón Usar no queda tapado por la caja de los botones de habilidad.
  const use = await m.locator('#t-interact').boundingBox();
  expect(await m.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [use!.x + use!.width / 2, use!.y + use!.height / 2])).toBe('t-interact');
  const atk = await m.locator('#t-attack').boundingBox();
  const cx = atk!.x + atk!.width / 2, cy = atk!.y + atk!.height / 2;
  // Arrastrar: aparece el indicador del básico.
  await m.mouse.move(cx, cy); await m.mouse.down(); await m.mouse.move(cx - 60, cy - 40, { steps: 5 });
  await m.waitForTimeout(150);
  await m.mouse.move(cx, cy, { steps: 5 }); await m.mouse.up(); // regresar al botón cancela
  await m.waitForTimeout(300);
  expect(Number(await m.locator('#player-state').getAttribute('data-ammo'))).toBeGreaterThanOrEqual(2.99); // no gastó carga
  // Toque rápido: auto-apunta al rival más cercano (están juntos por SAME_SPAWN).
  const hp0 = Number(await b.locator('#player-state').getAttribute('data-hp'));
  await m.mouse.click(cx, cy);
  await expect.poll(async () => Number(await b.locator('#player-state').getAttribute('data-hp')), { timeout: 4000 }).toBeLessThan(hp0);
  await Promise.all([m.close(), b.close(), mc.close()]);
});
