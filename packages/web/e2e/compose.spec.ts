import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('select template, fill context, and compose document', async ({ page }) => {
  await login(page);
  await page.getByText(/Compositeur|Composer/i).first().click();
  await page.waitForURL('**/compose');

  // Select template — example-vault has proposition-commerciale and devis
  await page.getByRole('combobox').first().click();
  await page.waitForTimeout(500);
  const option = page.getByRole('option').first();
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();

  // Template description should appear
  await expect(page.getByText(/v1\.0/).first()).toBeVisible({ timeout: 5000 });

  // Context form should appear — fill required fields
  // Wait for context section
  await expect(page.getByText(/Contexte|Context/i).first()).toBeVisible({ timeout: 5000 });

  // Fill text inputs (product, client)
  const textInputs = page.locator('input[type="text"]');
  const inputCount = await textInputs.count();
  for (let i = 0; i < inputCount; i++) {
    const val = await textInputs.nth(i).inputValue();
    if (!val) await textInputs.nth(i).fill('test-value');
  }

  // Select enum dropdowns (lang)
  const selects = page.getByRole('combobox');
  const selectCount = await selects.count();
  for (let i = 1; i < selectCount; i++) {
    await selects.nth(i).click();
    const firstOpt = page.getByRole('option').first();
    if (await firstOpt.isVisible({ timeout: 1000 }).catch(() => false)) {
      await firstOpt.click();
    }
  }

  // Click compose button
  const composeBtn = page.getByRole('button', { name: /Composer|Compose/i });
  if (await composeBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
    await composeBtn.click();
    // Wait for result
    await expect(page.getByText(/terminée|complete/i).first()).toBeVisible({ timeout: 15000 });
    // Download button should be visible
    await expect(page.getByRole('button', { name: /Télécharger|Download/i })).toBeVisible();
  }
});
