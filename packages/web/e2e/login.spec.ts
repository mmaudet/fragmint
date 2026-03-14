import { test, expect } from '@playwright/test';

test('login and redirect to fragments', async ({ page }) => {
  await page.goto('/ui/login');
  await page.getByPlaceholder(/utilisateur/i).fill('mmaudet');
  await page.getByPlaceholder(/mot de passe/i).fill('fragmint-dev');
  await page.getByRole('button', { name: /connecter/i }).click();
  await page.waitForURL('**/fragments', { timeout: 15000 });
  // Verify sidebar navigation is visible (proves we're in the authenticated app)
  await expect(page.getByText(/Bibliothèque|Library/i).first()).toBeVisible({ timeout: 5000 });
});
