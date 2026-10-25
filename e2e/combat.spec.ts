import { expect, test, type Page } from '@playwright/test';
import { register, uniqueName } from './helpers';

const hp = async (page: Page) => Number(await page.locator('#player-state').getAttribute('data-hp'));

test('Flujo de combate: básico apuntado con el cursor, munición y Temblor (E) con recarga en la barra', async ({ browser }) => {
  const host = await browser.newPage(), guest = await browser.newPage();
  const room = uniqueName('Duelo');
  await register(host, uniqueName('atk'));
  await register(guest, uniqueName('def'));
  await host.fill('#room-name', room);
  await host.click('#create-room button[type=submit]');
  const row = guest.locator('#room-list li', { hasText: room });
  await expect(row).toBeVisible({ timeout: 8000 });
  await row.getByRole('button', { name: 'Unirse' }).click();
  await host.click('#ready-btn');
  await guest.click('#ready-btn');
  await expect(host.locator('#screen-game')).toBeVisible();
  await expect(guest.locator('#screen-game')).toBeVisible();
  await host.waitForTimeout(800);

  // Básico apuntado: el anfitrión pone el cursor sobre el rival y hace clic (mantener y soltar).
  const st = host.locator('#player-state');
  await expect(st).not.toHaveAttribute('data-enemy-sx', '', { timeout: 5000 });
  const sx = Number(await st.getAttribute('data-enemy-sx')), sy = Number(await st.getAttribute('data-enemy-sy'));
  await host.mouse.move(sx, sy);
  await host.mouse.down(); await host.waitForTimeout(120); await host.mouse.up();
  await expect.poll(() => hp(guest), { timeout: 5000 }).toBeLessThan(100);
  expect(Number(await st.getAttribute('data-ammo'))).toBeLessThan(3); // gastó una carga

  // Temblor: mantener E y soltar; daña en área y su botón entra en recarga.
  const before = await hp(guest);
  await host.keyboard.press('e');
  await expect.poll(() => hp(guest), { timeout: 3000 }).toBeLessThan(before);
  await expect(host.locator('#abilities .ab[data-slot="E"]')).toHaveAttribute('data-ready', 'false');
  // Cerrar las páginas: así sus partidas no siguen corriendo durante las demás pruebas.
  await Promise.all([host.close(), guest.close()]);
});
