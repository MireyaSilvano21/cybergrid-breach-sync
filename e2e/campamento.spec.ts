import { expect, test } from '@playwright/test';
import { register, uniqueName } from './helpers';

test('Flujo de campamento: preparar aspecto, invitar a la escuadra y entrar por emparejamiento', async ({ browser }) => {
  const lider = await browser.newPage(), amigo = await browser.newPage();
  const liderName = uniqueName('lider'), amigoName = uniqueName('amigo');
  await register(lider, liderName, 'secreta123', 'campamento');
  await register(amigo, amigoName, 'secreta123', 'campamento');

  // Preparación: cambiar de cuerpo actualiza la vista previa y se guarda.
  await lider.click('.tabs [data-tab="preparacion"]');
  const cuerpo = lider.locator('.selector[data-part="body"] b');
  const antes = await cuerpo.textContent();
  await lider.click('.selector[data-part="body"] button[data-dir="1"]');
  await expect(cuerpo).not.toHaveText(antes ?? '');
  await expect(lider.locator('.escuela[data-school="seleth"]')).toBeDisabled();
  await lider.click('.tabs [data-tab="campamento"]');

  // Invitación desde la lista de conectados.
  await lider.locator(`#online-list li[data-online="${amigoName}"] button`).click();
  await expect(amigo.locator('#invite-box')).toBeVisible();
  await amigo.click('#invite-accept');
  await expect(lider.locator(`#party-members li[data-member="${amigoName}"]`)).toBeVisible();
  await expect(amigo.locator('#deploy-btn')).toBeDisabled(); // solo el líder busca partida
  await expect(amigo.locator('#party-code')).toHaveText((await lider.locator('#party-code').textContent())!);

  // Entrar a la Grid: la escuadra entra junta como un equipo.
  await lider.click('#deploy-btn');
  await expect(lider.locator('#screen-game')).toBeVisible({ timeout: 10000 });
  await expect(amigo.locator('#screen-game')).toBeVisible();
  await expect(lider.locator('#aliados .aliado', { hasText: amigoName })).toBeVisible({ timeout: 5000 });
  // Cerrar las páginas: así sus partidas no siguen corriendo durante las demás pruebas.
  await Promise.all([lider.close(), amigo.close()]);
});
