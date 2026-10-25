import { expect, test, type Page } from '@playwright/test';
import { register, uniqueName } from './helpers';

const hp = async (page: Page) => Number(await page.locator('#player-state').getAttribute('data-hp'));

test('Flujo de combate: fijar con Tab, básico automático y Temblor (E) con recarga en la barra', async ({ browser }) => {
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

  // Tab fija al enemigo más cercano; la Vara golpea sola mientras esté en alcance.
  await host.keyboard.press('Tab');
  await expect.poll(() => hp(guest), { timeout: 5000 }).toBeLessThan(100);

  // Temblor: daño en área y su botón entra en recarga.
  const before = await hp(guest);
  await host.keyboard.press('e');
  await expect.poll(() => hp(guest), { timeout: 3000 }).toBeLessThan(before);
  await expect(host.locator('#abilities .ab[data-slot="E"]')).toHaveAttribute('data-ready', 'false');
});
