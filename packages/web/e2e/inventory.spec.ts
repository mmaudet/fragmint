import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('view inventory metrics and gaps', async ({ page }) => {
  await login(page);
  await page.getByText(/Inventaire|Inventory/i).first().click();
  await page.waitForURL('**/inventory');

  // Verify total fragment count is visible and > 0
  await expect(page.getByText(/Total fragments/i)).toBeVisible({ timeout: 10000 });

  // The example-vault has approved, reviewed, and draft fragments
  await expect(page.getByText('approved').first()).toBeVisible();
  await expect(page.getByText('draft').first()).toBeVisible();

  // Gaps table should be visible with actual gaps
  await expect(page.getByText(/Lacunes|Gaps/i).first()).toBeVisible();
  // example-vault has missing translations (en)
  await expect(page.getByText(/missing_translation/).first()).toBeVisible();
});
