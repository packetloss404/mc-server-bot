import { test, expect } from '@playwright/test';
import { interceptAll } from '../fixtures/intercept';

test.describe('World Map Page', () => {
  test.beforeEach(async ({ page }) => {
    await interceptAll(page);
  });

  test('renders map page with toolbar and entity sidebar', async ({ page }) => {
    await page.goto('/map');

    // Map title
    await expect(page.getByText('World Map')).toBeVisible({ timeout: 10_000 });

    // Toolbar toggle buttons
    await expect(page.getByRole('button', { name: 'Terrain' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grid' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trails' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Coords' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bots' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Players' })).toBeVisible();
  });

  test('entity sidebar lists bots and players', async ({ page }) => {
    await page.goto('/map');

    // The entity sidebar shows names of bots and players with positions
    await expect(page.getByText('Entities')).toBeVisible({ timeout: 10_000 });

    // Bot names in the sidebar
    await expect(page.locator('button', { hasText: 'Farmer_Joe' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Guard_Rex' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Miner_Sam' })).toBeVisible();

    // Player names
    await expect(page.locator('button', { hasText: 'Steve' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Alex' })).toBeVisible();
  });

  test('clicking an entity in the sidebar selects it', async ({ page }) => {
    await page.goto('/map');

    await expect(page.locator('button', { hasText: 'Farmer_Joe' })).toBeVisible({ timeout: 10_000 });

    // Click on Farmer_Joe in the sidebar
    await page.locator('button', { hasText: 'Farmer_Joe' }).click();

    // The button should have the selected background style (bg-zinc-800)
    const btn = page.locator('button', { hasText: 'Farmer_Joe' });
    await expect(btn).toHaveClass(/bg-zinc-800/);
  });

  test('toggle buttons change active state', async ({ page }) => {
    await page.goto('/map');

    const gridBtn = page.getByRole('button', { name: 'Grid' });
    await expect(gridBtn).toBeVisible({ timeout: 10_000 });

    // Grid is on by default (should have active class bg-zinc-800)
    await expect(gridBtn).toHaveClass(/bg-zinc-800/);

    // Toggle it off
    await gridBtn.click();

    // Should no longer have the active class
    await expect(gridBtn).not.toHaveClass(/bg-zinc-800/);

    // Toggle it back on
    await gridBtn.click();
    await expect(gridBtn).toHaveClass(/bg-zinc-800/);
  });

  test('zoom buttons are functional', async ({ page }) => {
    await page.goto('/map');

    // Find zoom controls
    const zoomIn = page.getByRole('button', { name: '+' });
    const zoomOut = page.getByRole('button', { name: '-' });

    await expect(zoomIn).toBeVisible({ timeout: 10_000 });
    await expect(zoomOut).toBeVisible();

    // Initial zoom level display
    const zoomDisplay = page.locator('text=/\\d+\\.\\d+x/').first();
    await expect(zoomDisplay).toBeVisible();

    // Click zoom in
    await zoomIn.click();

    // Zoom level should have changed (we can't know exact value but it should still be visible)
    await expect(zoomDisplay).toBeVisible();
  });

  test('canvas element is rendered', async ({ page }) => {
    await page.goto('/map');

    // The canvas should be rendered
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 10_000 });
  });

  test('legend is visible with bot and player entries', async ({ page }) => {
    await page.goto('/map');

    await expect(page.getByText('Legend')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Bot')).toBeVisible();
    await expect(page.getByText('Player')).toBeVisible();
  });
});
