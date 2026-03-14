import type { Page } from '@playwright/test';

export async function login(page: Page) {
  await page.goto('/ui/login');
  await page.getByPlaceholder(/utilisateur/i).fill('mmaudet');
  await page.getByPlaceholder(/mot de passe/i).fill('fragmint-dev');
  await page.getByRole('button', { name: /connecter/i }).click();
  await page.waitForURL('**/fragments', { timeout: 15000 });
}
