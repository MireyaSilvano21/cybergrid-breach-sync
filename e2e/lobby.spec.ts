import { expect, test } from '@playwright/test';
import { register, uniqueName } from './helpers';

test('Flujo de lobbies: crear sala, marcar Listo y conectar sockets', async ({ browser }) => {
  const host = await browser.newPage(), guest = await browser.newPage();
  const hostName = uniqueName('host'), guestName = uniqueName('guest'), room = uniqueName('Sala');
  await register(host, hostName);
  await register(guest, guestName);

  await host.fill('#room-name', room);
  await host.click('#create-room button[type=submit]');
  await expect(host.locator('#room-title')).toHaveText(room);

  // El invitado ve la sala por la API y se une por WebSocket.
  const row = guest.locator('#room-list li', { hasText: room });
  await expect(row).toBeVisible({ timeout: 8000 });
  await row.getByRole('button', { name: 'Unirse' }).click();
  await expect(guest.locator(`#room-players li[data-player="${hostName}"]`)).toBeVisible();

  // Estado "Listo" sincronizado entre ambos clientes.
  await host.click('#ready-btn');
  await expect(guest.locator(`#room-players li[data-player="${hostName}"] .tag`)).toHaveText('Listo');
  await expect(host.locator('#screen-lobby')).toBeVisible();

  await guest.click('#ready-btn');
  await expect(host.locator('#screen-game')).toBeVisible();
  await expect(guest.locator('#screen-game')).toBeVisible();
  await expect(host.locator('#ping')).toHaveText(/\d+ ms/, { timeout: 5000 });
});
