import { test, expect } from '@playwright/test';
import { interceptAll } from '../fixtures/intercept';

test.describe('Navigation and Cross-Page Flows', () => {
  test.beforeEach(async ({ page }) => {
    await interceptAll(page);
  });

  test('sidebar navigation works across all main pages', async ({ page }) => {
    await page.goto('/');

    // Dashboard is active
    await expect(page.getByText('Bots Online')).toBeVisible({ timeout: 10_000 });

    // Navigate to Map
    await page.getByRole('link', { name: 'World Map' }).click();
    await expect(page).toHaveURL('/map');
    await expect(page.getByText('World Map')).toBeVisible();

    // Navigate to Manage
    await page.getByRole('link', { name: 'Manage' }).click();
    await expect(page).toHaveURL('/manage');
    await expect(page.getByText('Bot Management')).toBeVisible();

    // Navigate back to Dashboard
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL('/');
  });

  test('clicking a bot card on dashboard navigates to bot detail', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });

    // Click the bot card (which is a Link)
    await page.getByRole('link', { name: /Farmer_Joe/ }).click();

    await expect(page).toHaveURL('/bots/Farmer_Joe');
    await expect(page.getByRole('heading', { name: 'Farmer_Joe' })).toBeVisible();
  });

  test('full flow: dashboard -> manage -> create bot', async ({ page }) => {
    await page.goto('/');

    // Click "Create Bot" quick action
    await page.getByRole('link', { name: 'Create Bot' }).click();
    await expect(page).toHaveURL('/manage');

    // Create a new bot
    await page.getByPlaceholder('Bot name...').fill('FlowTestBot');
    await page.getByRole('button', { name: 'Create Bot' }).click();

    await expect(page.getByText(/created successfully/i)).toBeVisible({ timeout: 5_000 });
  });

  test('full flow: dashboard -> bot detail -> send command', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });

    // Navigate to bot detail
    await page.getByRole('link', { name: /Farmer_Joe/ }).click();
    await expect(page).toHaveURL('/bots/Farmer_Joe');

    // Wait for detail page to load
    await expect(page.getByText('Commands')).toBeVisible({ timeout: 10_000 });

    // Send stop command
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Stop sent')).toBeVisible({ timeout: 5_000 });
  });

  test('error page shown for nonexistent bot', async ({ page }) => {
    // Override the detailed endpoint to return an error for this specific bot
    await page.route('http://localhost:3001/api/bots/NonExistentBot/detailed', (route) =>
      route.fulfill({ status: 404, json: { error: 'Bot not found' } }),
    );

    await page.goto('/bots/NonExistentBot');

    await expect(page.getByText('Bot not found')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Back to Dashboard')).toBeVisible();
  });
});
