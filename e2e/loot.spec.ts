import { expect, test, type Page } from '@playwright/test';
import { register, startSoloMatch, uniqueName } from './helpers';

async function state(page: Page) {
  return page.locator('#player-state').evaluate((el: HTMLElement) => ({
    x: Number(el.dataset.x), y: Number(el.dataset.y),
    cx: Number(el.dataset.chestX), cy: Number(el.dataset.chestY),
  }));
}

/** Camina hacia el cofre más cercano con el teclado hasta quedar dentro del alcance. */
async function walkToChest(page: Page) {
  for (let i = 0; i < 40; i++) {
    const s = await state(page);
    const dx = s.cx - s.x, dy = s.cy - s.y;
    if (Math.hypot(dx, dy) < 40) return;
    const keys = [Math.abs(dx) > 12 ? (dx > 0 ? 'd' : 'a') : null, Math.abs(dy) > 12 ? (dy > 0 ? 's' : 'w') : null].filter(Boolean) as string[];
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(90);
    for (const k of keys) await page.keyboard.up(k);
  }
  throw new Error('No se llegó al cofre');
}

test('Flujo de saqueo: abrir un cofre y tomar el botín', async ({ page }) => {
  await register(page, uniqueName('loot'));
  await startSoloMatch(page, uniqueName('Botin'));
  await expect(page.locator('#player-state')).not.toHaveAttribute('data-chest-x', '', { timeout: 5000 });
  await walkToChest(page);

  await page.keyboard.press('f');
  await expect(page.locator('#toast')).toContainText('Contiene');
  await expect(page.locator('#inventory')).toHaveAttribute('data-count', '0');

  await page.keyboard.press('f');
  await expect(page.locator('#toast')).toContainText('Obtuviste');
  await expect.poll(async () => Number(await page.locator('#inventory').getAttribute('data-count'))).toBeGreaterThan(0);
  expect(Number(await page.locator('#inventory').getAttribute('data-value'))).toBeGreaterThan(0);
});
