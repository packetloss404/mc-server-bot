import { test, expect } from '@playwright/test';
import { interceptAll } from '../fixtures/intercept';

test.describe('Manage (Fleet) Page', () => {
  test.beforeEach(async ({ page }) => {
    await interceptAll(page);
  });

  test('lists all bots with state and personality info', async ({ page }) => {
    await page.goto('/manage');

    await expect(page.getByText('Bot Management')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Active Bots (3)')).toBeVisible();

    // Each bot row
    await expect(page.getByText('Farmer_Joe')).toBeVisible();
    await expect(page.getByText('Guard_Rex')).toBeVisible();
    await expect(page.getByText('Miner_Sam')).toBeVisible();
  });

  test('create bot form submits and shows success', async ({ page }) => {
    await page.goto('/manage');

    await expect(page.getByText('Create New Bot')).toBeVisible({ timeout: 10_000 });

    // Fill in the bot name
    const nameInput = page.getByPlaceholder('Bot name...');
    await nameInput.fill('TestBot');

    // Select a personality (click the explorer button)
    await page.getByRole('button', { name: /explorer/i }).click();

    // Click Create Bot
    await page.getByRole('button', { name: 'Create Bot' }).click();

    // Should show success message (our mock returns success)
    await expect(page.getByText(/created successfully/i)).toBeVisible({ timeout: 5_000 });
  });

  test('mode toggle button is visible for each bot', async ({ page }) => {
    await page.goto('/manage');

    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });

    // codegen and primitive mode buttons should exist
    const codegenButtons = page.getByRole('button', { name: 'codegen' });
    const primitiveButtons = page.getByRole('button', { name: 'primitive' });
    const totalModeButtons = await codegenButtons.count() + await primitiveButtons.count();
    expect(totalModeButtons).toBe(3); // 3 bots
  });

  test('queue task input opens and submits for a bot', async ({ page }) => {
    await page.goto('/manage');

    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });

    // Click the + button (queue task) for the first bot row
    // The + icon buttons are the task queue triggers
    const taskButtons = page.locator('button[title="Queue task"]');
    await taskButtons.first().click();

    // Task input should appear
    const taskInput = page.getByPlaceholder(/Queue a task for/);
    await expect(taskInput).toBeVisible();

    await taskInput.fill('Harvest more wheat');

    // Click Queue
    await page.getByRole('button', { name: 'Queue' }).click();

    // Input should clear after successful queue (mock returns success)
    await expect(taskInput).not.toBeVisible({ timeout: 3_000 });
  });

  test('bot rows link to detail pages', async ({ page }) => {
    await page.goto('/manage');

    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });

    // Bot name is a link
    const botLink = page.getByRole('link', { name: 'Farmer_Joe' });
    await expect(botLink).toHaveAttribute('href', '/bots/Farmer_Joe');
  });
});
