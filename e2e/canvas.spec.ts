import { expect, test, devices } from '@playwright/test';
import { register, startSoloMatch, uniqueName } from './helpers';

const readPos = async (page: import('@playwright/test').Page) => {
  const el = page.locator('#player-state');
  return { x: Number(await el.getAttribute('data-x')), y: Number(await el.getAttribute('data-y')) };
};

test('Flujo de Canvas: los controles cambian las coordenadas del jugador en el DOM', async ({ page }) => {
  await register(page, uniqueName('mov'));
  await startSoloMatch(page, uniqueName('Canvas'));
  await expect(page.locator('#touch')).toBeHidden(); // en PC los controles táctiles se ocultan
  await page.waitForTimeout(500);
  const before = await readPos(page);
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  await page.keyboard.down('s');
  await page.waitForTimeout(500);
  await page.keyboard.up('s');
  await expect.poll(async () => (await readPos(page)).x, { timeout: 3000 }).toBeGreaterThan(before.x + 40);
  const after = await readPos(page);
  expect(after.y).toBeGreaterThan(before.y);
});

const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];

test.describe('Móvil', () => {
  test.use({ ...pixel7 });
  test('el D-Pad táctil aparece y mueve al jugador', async ({ page }) => {
    await register(page, uniqueName('tch'));
    await startSoloMatch(page, uniqueName('Movil'));
    await expect(page.locator('#touch')).toBeVisible();
    await page.waitForTimeout(500);
    const before = await readPos(page);
    const box = (await page.locator('#stick').boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy, { steps: 4 });
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect.poll(async () => (await readPos(page)).x, { timeout: 3000 }).toBeGreaterThan(before.x + 30);
  });
});
