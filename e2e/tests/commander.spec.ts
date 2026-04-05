import { test, expect } from '@playwright/test';
import { interceptAll } from '../fixtures/intercept';

test.describe('Commander (Natural Language Input)', () => {
  test.beforeEach(async ({ page }) => {
    await interceptAll(page);
  });

  test('manage page allows queuing a natural language task for a bot', async ({ page }) => {
    // The commander flow works through the bot detail page's task queue input
    // or the manage page's per-bot task queue.
    await page.goto('/manage');

    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });

    // Open task input for the first bot
    const taskButtons = page.locator('button[title="Queue task"]');
    await taskButtons.first().click();

    const taskInput = page.getByPlaceholder(/Queue a task for/);
    await expect(taskInput).toBeVisible();

    // Type a natural language command
    await taskInput.fill('Go to the mine entrance and collect iron ore');
    await page.getByRole('button', { name: 'Queue' }).click();

    // The mock returns success, the input should close
    await expect(taskInput).not.toBeVisible({ timeout: 3_000 });
  });

  test('bot detail page queues a task via the task queue section', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    await expect(page.getByText('Task Queue')).toBeVisible({ timeout: 10_000 });

    const taskInput = page.getByPlaceholder('Queue a task...');
    await taskInput.fill('Build a fence around the wheat farm');

    // Intercept the task POST to verify the request was made
    const taskRequest = page.waitForRequest((req) =>
      req.url().includes('/api/bots/Farmer_Joe/task') && req.method() === 'POST',
    );

    await page.getByRole('button', { name: 'Queue' }).click();

    const req = await taskRequest;
    const body = req.postDataJSON();
    expect(body.description).toBe('Build a fence around the wheat farm');
  });

  test('bot detail page shows task history from voyager', async ({ page }) => {
    await page.goto('/bots/Farmer_Joe');

    // Current task visible in the activity panel
    await expect(page.getByText('Plant and harvest wheat field')).toBeVisible({ timeout: 10_000 });

    // The completed tasks count is shown
    await expect(page.getByText(/Completed \(3\)/)).toBeVisible();
  });
});
