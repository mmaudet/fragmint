import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('select template and see context form', async ({ page }) => {
  await login(page);
  await page.getByText(/Compositeur/i).first().click();
  await page.waitForURL('**/compose');
  // Select the first template
  await page.getByRole('combobox').first().click();
  await page.waitForTimeout(500);
  const option = page.getByRole('option').first();
  if (await option.isVisible()) {
    await option.click();
    // Should see context form or template description
    await expect(page.getByText(/Contexte|v1\.0/i).first()).toBeVisible({ timeout: 5000 });
  }
});
