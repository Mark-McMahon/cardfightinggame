import { test, expect, type Page } from '@playwright/test';

async function isVisible(page: Page, selector: ReturnType<Page['getByRole']>): Promise<boolean> {
  return selector.isVisible().catch(() => false);
}

test('create a room, fill with bots, and play a full match to a winner', async ({ page }) => {
  await page.goto('/');

  // ── connect / create room ──
  await expect(page.getByText('Mythic Menagerie')).toBeVisible();
  await page.getByRole('button', { name: 'Create room (with bots)' }).click();

  // ── lobby → start ──
  await expect(page.getByRole('button', { name: 'Start match' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Start match' }).click();

  // ── round 1 shop: exercise buy + play intents ──
  await expect(page.getByText('SHOP', { exact: true })).toBeVisible({ timeout: 15000 });
  const shopZone = page.locator('.zone', { hasText: 'Shop' });
  const benchZone = page.locator('.zone', { hasText: 'Bench' });
  const boardZone = page.locator('.zone', { hasText: 'Your board' });

  await expect(shopZone.locator('.unit').first()).toBeVisible({ timeout: 10000 });
  await shopZone.locator('.unit').first().click(); // buy

  // wait for the server to push the bought unit onto the bench, then play it
  await expect(benchZone.locator('.unit').first()).toBeVisible({ timeout: 8000 });
  await benchZone.locator('.unit').first().click(); // play onto board

  // resolve a chosen-target battlecry / discover if one popped up
  const legal = page.locator('.unit.legal').first();
  if (await legal.isVisible().catch(() => false)) await legal.click();
  const discover = page.locator('.discover-card .unit').first();
  if (await discover.isVisible().catch(() => false)) await discover.click();

  await expect(boardZone.locator('.unit').first()).toBeVisible({ timeout: 8000 });

  // ── drive the loop: ready up, watch combat, continue, until a winner ──
  const results = page.getByText('Final standings');
  let sawCombat = false;
  for (let i = 0; i < 140; i++) {
    if (await results.isVisible().catch(() => false)) break;

    const cont = page.getByRole('button', { name: 'Continue' });
    if (await isVisible(page, cont)) {
      sawCombat = true;
      await cont.click();
      continue;
    }
    const ready = page.getByRole('button', { name: 'Ready up' });
    if ((await isVisible(page, ready)) && (await ready.isEnabled().catch(() => false))) {
      await ready.click();
    }
    await page.waitForTimeout(800);
  }

  expect(sawCombat, 'a combat replay should have been shown at least once').toBe(true);
  await expect(results).toBeVisible({ timeout: 20000 });
  // a 1st-place trophy is shown in the standings panel
  await expect(page.locator('.panel').getByText('🏆')).toBeVisible();
});
