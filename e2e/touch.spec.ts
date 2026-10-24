import { expect, test, devices } from '@playwright/test';
import { register, startSoloMatch, uniqueName } from './helpers';

const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];
test.use({ ...pixel7 });

test('el joystick responde a un arrastre táctil real', async ({ page }) => {
  await register(page, uniqueName('drag'));
  await startSoloMatch(page, uniqueName('Drag'));
  await page.waitForTimeout(400);
  const el = page.locator('#player-state');
  const x0 = Number(await el.getAttribute('data-x'));
  const box = (await page.locator('#stick-zone').boundingBox())!;
  const cx = Math.round(box.x + 110), cy = Math.round(box.y + box.height - 110);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as any);
  await touch('touchStart', cx, cy);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', cx + i * 8, cy); await page.waitForTimeout(16); }
  await page.waitForTimeout(800);
  await touch('touchEnd', cx + 64, cy);
  await expect.poll(async () => Number(await el.getAttribute('data-x')), { timeout: 3000 }).toBeGreaterThan(x0 + 40);
});
