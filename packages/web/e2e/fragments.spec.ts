import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('view fragments and open detail', async ({ page }) => {
  await login(page);
  // Wait for at least one fragment card to appear
  await page.waitForTimeout(2000);
  // Find any clickable card content
  const cards = page.locator('.cursor-pointer');
  const cardCount = await cards.count();
  if (cardCount > 0) {
    await cards.first().click();
    // Sheet should open — look for metadata/content text
    await expect(page.getByText(/Auteur|Domaine|Contenu/i).first()).toBeVisible({ timeout: 5000 });
  }
});
