import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('view inventory metrics and gaps', async ({ page }) => {
  await login(page);
  // Navigate to inventory
  await page.getByText(/Inventaire/i).first().click();
  await page.waitForURL('**/inventory');
  // Expect metrics visible
  await expect(page.getByText(/Total fragments/i)).toBeVisible({ timeout: 10000 });
});
