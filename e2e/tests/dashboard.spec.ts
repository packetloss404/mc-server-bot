import { test, expect } from '@playwright/test';
import { interceptAll } from '../fixtures/intercept';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await interceptAll(page);
  });

  test('loads and shows bot cards with correct data', async ({ page }) => {
    await page.goto('/');

    // Wait for the bot data to load (SocketProvider fetches /api/bots on mount)
    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Guard_Rex')).toBeVisible();
    await expect(page.getByText('Miner_Sam')).toBeVisible();

    // Verify the bots count header
    await expect(page.getByText('Bots (3)')).toBeVisible();
  });

  test('shows hero stat cards with correct values', async ({ page }) => {
    await page.goto('/');

    // Wait for data
    await expect(page.getByText('Bots Online')).toBeVisible({ timeout: 10_000 });

    // Bot count stat card
    const botsStat = page.locator('text=Bots Online').locator('..');
    await expect(botsStat).toBeVisible();

    // World time
    await expect(page.getByText('World Time')).toBeVisible();
    await expect(page.getByText('Day 42')).toBeVisible();

    // Weather
    await expect(page.getByText('Weather')).toBeVisible();
    await expect(page.getByText('Clear')).toBeVisible();
  });

  test('shows online players section', async ({ page }) => {
    await page.goto('/');

    // Players are fetched from /api/players; bots are filtered out
    await expect(page.getByText('Online Players (2)')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Steve')).toBeVisible();
    await expect(page.getByText('Alex')).toBeVisible();
  });

  test('shows activity feed from API', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Recent Activity')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Harvested 64 wheat')).toBeVisible();
    await expect(page.getByText('Defeated a zombie')).toBeVisible();
    await expect(page.getByText('Reached diamond level')).toBeVisible();
  });

  test('quick action links navigate correctly', async ({ page }) => {
    await page.goto('/');

    // Wait for page to be interactive
    await expect(page.getByText('Open Map')).toBeVisible({ timeout: 10_000 });

    // Check links exist with correct hrefs
    await expect(page.getByRole('link', { name: 'Open Map' })).toHaveAttribute('href', '/map');
    await expect(page.getByRole('link', { name: 'Create Bot' })).toHaveAttribute('href', '/manage');
    await expect(page.getByRole('link', { name: 'Open Chat' })).toHaveAttribute('href', '/chat');
  });

  test('bot cards link to detail pages', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Farmer_Joe')).toBeVisible({ timeout: 10_000 });

    // BotCard wraps in a Link to /bots/{name}
    const farmCard = page.getByRole('link', { name: /Farmer_Joe/ });
    await expect(farmCard).toHaveAttribute('href', '/bots/Farmer_Joe');
  });

  test('sidebar shows connection status and navigation', async ({ page }) => {
    await page.goto('/');

    // Sidebar header
    await expect(page.getByText('DyoCraft')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Control Panel')).toBeVisible();

    // Navigation items
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'World Map' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Chat' })).toBeVisible();
  });
});
