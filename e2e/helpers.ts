import { expect, type Page } from '@playwright/test';

export const uniqueName = (p: string) => `${p}${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;

/** Registra y entra al lobby. Por defecto abre "Partidas privadas" (salas manuales). */
export async function register(page: Page, name: string, password = 'secreta123', tab: 'privadas' | 'campamento' = 'privadas') {
  await page.goto('/');
  await page.fill('#username', name);
  await page.fill('#password', password);
  await page.click('#register-btn');
  await expect(page.locator('#screen-lobby')).toBeVisible();
  await expect(page.locator('#socket-status')).toHaveAttribute('data-state', 'connected');
  await page.click(`.tabs [data-tab="${tab}"]`);
}

export async function startSoloMatch(page: Page, room: string) {
  await page.fill('#room-name', room);
  await page.click('#create-room button[type=submit]');
  await expect(page.locator('#room-panel')).toBeVisible();
  await page.click('#ready-btn');
  await expect(page.locator('#screen-game')).toBeVisible();
  await expect(page.locator('#game')).toBeVisible();
}
