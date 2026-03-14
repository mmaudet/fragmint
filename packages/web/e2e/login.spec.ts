import { test, expect } from '@playwright/test';

test('login and redirect to fragments', async ({ page }) => {
  await page.goto('/ui/login');
  await page.getByPlaceholder(/utilisateur/i).fill('mmaudet');
  await page.getByPlaceholder(/mot de passe/i).fill('fragmint-dev');
  await page.getByRole('button', { name: /connecter/i }).click();
  await page.waitForURL('**/fragments');
  // Verify we're on the fragments page
  await expect(page.getByRole('heading', { name: /Bibliothèque/i })).toBeVisible();
});
