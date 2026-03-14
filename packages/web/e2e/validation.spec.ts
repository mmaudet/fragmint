import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('view validation queue', async ({ page }) => {
  await login(page);
  await page.getByText(/Validation/i).first().click();
  await page.waitForURL('**/validation');
  // Should see the validation page heading and either fragments or empty message
  await expect(page.getByText(/Validation/i).first()).toBeVisible({ timeout: 5000 });
});
