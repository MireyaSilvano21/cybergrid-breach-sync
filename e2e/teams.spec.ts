import { expect, test, type Page } from '@playwright/test';
import { register, uniqueName } from './helpers';

const hp = async (page: Page) => Number(await page.locator('#player-state').getAttribute('data-hp'));

test('Flujo de equipos: elegir equipo en la sala y no dañar al compañero', async ({ browser }) => {
  const host = await browser.newPage(), guest = await browser.newPage();
  const hostName = uniqueName('lider'), guestName = uniqueName('aliado'), room = uniqueName('Equipo');
  await register(host, hostName);
  await register(guest, guestName);
  await host.fill('#room-name', room);
  await host.click('#create-room button[type=submit]');
  const row = guest.locator('#room-list li', { hasText: room });
  await expect(row).toBeVisible({ timeout: 8000 });
  await row.getByRole('button', { name: 'Unirse' }).click();

  // Al entrar sin elegir quedan como rivales; el invitado se cambia al equipo del anfitrión.
  await expect(host.locator(`#room-players section[data-team="1"] li[data-player="${guestName}"]`)).toBeVisible();
  await guest.locator('#room-players section[data-team="0"] button', { hasText: 'Unirme' }).click();
  await expect(host.locator(`#room-players section[data-team="0"] li[data-player="${guestName}"]`)).toBeVisible();
  await expect(host.locator('#room-players section[data-team="0"] .cupo')).toHaveText('2/3');

  await host.click('#ready-btn');
  await guest.click('#ready-btn');
  await expect(host.locator('#screen-game')).toBeVisible();
  await expect(guest.locator('#screen-game')).toBeVisible();

  // El panel muestra al compañero; un básico y el Temblor junto a él no le hacen daño.
  await expect(host.locator('#aliados .aliado', { hasText: guestName })).toBeVisible({ timeout: 5000 });
  const box = await host.locator('#game').boundingBox();
  await host.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 40);
  await host.mouse.down(); await host.mouse.up();
  await host.keyboard.press('e');
  await host.waitForTimeout(1500);
  expect(await hp(guest)).toBe(100);
  // Cerrar las páginas: así sus partidas no siguen corriendo durante las demás pruebas.
  await Promise.all([host.close(), guest.close()]);
});
