import { test, expect } from '@playwright/test';
import { interceptAll } from '../fixtures/intercept';

test.describe('Bot Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await interceptAll(page);
  });

  test('shows bot profile with vitals and equipment', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    // Hero section loads
    await expect(page.getByRole('heading', { name: 'Farmer_Joe' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('The Farmer')).toBeVisible();

    // Health and food bars are rendered (via VitalBar)
    await expect(page.getByText('HP')).toBeVisible();
    await expect(page.getByText('FD')).toBeVisible();

    // Health value
    await expect(page.getByText('18/20')).toBeVisible();
    await expect(page.getByText('15/20')).toBeVisible();
  });

  test('displays voyager state with current task', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });

    // Current task from voyager
    await expect(page.getByText('Plant and harvest wheat field')).toBeVisible();
  });

  test('shows completed and failed task lists when toggled', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });

    // Completed tasks section (collapsed by default)
    const completedToggle = page.getByRole('button', { name: /Completed \(3\)/ });
    await expect(completedToggle).toBeVisible();
    await completedToggle.click();

    // Completed tasks should now show
    await expect(page.getByText('Craft diamond hoe')).toBeVisible();
    await expect(page.getByText('Find water source')).toBeVisible();

    // Failed tasks section
    const failedToggle = page.getByRole('button', { name: /Failed \(1\)/ });
    await expect(failedToggle).toBeVisible();
    await failedToggle.click();

    await expect(page.getByText('Breed animals')).toBeVisible();
  });

  test('command center buttons are visible and interactive', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    await expect(page.getByText('Commands')).toBeVisible({ timeout: 10_000 });

    // Pause button (bot is running and not paused)
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

    // Stop button
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

    // Follow button
    await expect(page.getByRole('button', { name: 'Follow' })).toBeVisible();

    // Go To button
    await expect(page.getByRole('button', { name: 'Go To' })).toBeVisible();
  });

  test('pause command sends API request and shows feedback', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Pause' }).click();

    // Feedback message
    await expect(page.getByText('Pause sent')).toBeVisible({ timeout: 5_000 });
  });

  test('Go To command opens coordinate input and submits', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    await expect(page.getByRole('button', { name: 'Go To' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Go To' }).click();

    // Coordinate input appears
    const coordInput = page.getByPlaceholder('x, z  or  x, y, z');
    await expect(coordInput).toBeVisible();

    await coordInput.fill('100, 200');
    await page.getByRole('button', { name: 'Go' }).click();

    // Feedback
    await expect(page.getByText('Walk to sent')).toBeVisible({ timeout: 5_000 });
  });

  test('shows inventory grid', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    await expect(page.getByText(/Inventory \(3\)/)).toBeVisible({ timeout: 10_000 });
  });

  test('shows relationships section', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    await expect(page.getByText(/Relationships \(2\)/)).toBeVisible({ timeout: 10_000 });

    // Player names in relationship list
    await expect(page.getByText('Steve')).toBeVisible();
    await expect(page.getByText('Alex')).toBeVisible();
  });

  test('shows world context panel', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    // World context data
    await expect(page.getByText('plains')).toBeVisible({ timeout: 10_000 });
  });

  test('breadcrumb navigates back to dashboard', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });

    const breadcrumb = page.locator('a', { hasText: 'Dashboard' }).first();
    await expect(breadcrumb).toHaveAttribute('href', '/');
  });
});
