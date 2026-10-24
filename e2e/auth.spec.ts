import { expect, test } from '@playwright/test';
import { register, uniqueName } from './helpers';

test.describe('Flujo de autenticación', () => {
  test('las salas están protegidas: sin sesión se muestra el acceso', async ({ page }) => {
    await page.goto('/#lobby');
    await expect(page.locator('#screen-login')).toBeVisible();
    await expect(page.locator('#screen-lobby')).toBeHidden();
    // El servidor rechaza sockets sin token válido.
    const rejected = await page.evaluate(() => new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://${location.host}/ws?token=falso`);
      ws.onopen = () => resolve(false);
      ws.onerror = () => resolve(true);
      ws.onclose = () => resolve(true);
    }));
    expect(rejected).toBe(true);
  });

  test('credenciales incorrectas muestran un error y las correctas dan acceso', async ({ page }) => {
    const name = uniqueName('arc');
    await register(page, name);
    await page.click('#logout-btn');
    await expect(page.locator('#screen-login')).toBeVisible();
    await page.fill('#username', name);
    await page.fill('#password', 'equivocada');
    await page.click('#login-btn');
    await expect(page.locator('#auth-error')).toContainText('incorrectos');
    await page.fill('#password', 'secreta123');
    await page.click('#login-btn');
    await expect(page.locator('#screen-lobby')).toBeVisible();
    await expect(page.locator('#whoami')).toHaveText(name);
  });
});
