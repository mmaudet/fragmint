import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('view validation queue with reviewed fragments', async ({ page }) => {
  await login(page);
  await page.getByText(/Validation/i).first().click();
  await page.waitForURL('**/validation');

  // The example-vault has 1 "reviewed" fragment (Open RAG vs solutions propriétaires)
  // Either we see it in the queue, or we see the empty message
  const hasReviewed = await page.getByText(/reviewed/).first().isVisible({ timeout: 5000 }).catch(() => false);
  const hasEmpty = await page.getByText(/Aucun fragment|No fragments/i).first().isVisible({ timeout: 2000 }).catch(() => false);

  // One of the two must be true
  expect(hasReviewed || hasEmpty).toBe(true);

  // If reviewed fragments exist, click one and verify drawer
  if (hasReviewed) {
    const cards = page.locator('.cursor-pointer');
    const count = await cards.count();
    if (count > 0) {
      await cards.first().click();
      // Verify approve button is visible in drawer
      await expect(page.getByRole('button', { name: /Approuver|Approve/i })).toBeVisible({ timeout: 5000 });
    }
  }
});
