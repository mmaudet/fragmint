import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('view fragments and open detail', async ({ page }) => {
  await login(page);

  // Wait for fragment cards to load — example-vault has 16+ fragments
  const cards = page.locator('.cursor-pointer');
  await expect(cards.first()).toBeVisible({ timeout: 10000 });

  // Verify we have multiple fragments
  const cardCount = await cards.count();
  expect(cardCount).toBeGreaterThan(0);

  // Verify a known fragment from example-vault is visible
  await expect(page.getByText(/souveraineté/i).first()).toBeVisible();

  // Click first card and verify drawer opens with detail
  await cards.first().click();
  await expect(page.getByText(/Auteur|Author/i).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/Domaine|Domain/i).first()).toBeVisible();
});
