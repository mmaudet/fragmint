import type { Page } from '@playwright/test';

export async function login(page: Page) {
  await page.goto('/ui/login');
  // Wait for the login form to be ready
  await page.getByPlaceholder(/utilisateur/i).waitFor({ timeout: 5000 });
  await page.getByPlaceholder(/utilisateur/i).fill('mmaudet');
  await page.getByPlaceholder(/mot de passe/i).fill('fragmint-dev');
  await page.getByRole('button', { name: /connecter/i }).click();
  // Wait for redirect — either URL changes or sidebar appears
  await Promise.race([
    page.waitForURL('**/fragments', { timeout: 15000 }),
    page.waitForURL('**/inventory', { timeout: 15000 }),
    page.waitForURL('**/compose', { timeout: 15000 }),
    page.waitForURL('**/validation', { timeout: 15000 }),
  ]).catch(() => {
    // If URL didn't change, check if we're already on an authenticated page
  });
  // Give the app a moment to render
  await page.waitForTimeout(500);
}
