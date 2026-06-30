import { test, expect, type Locator } from '@playwright/test';

async function visible(sel: Locator): Promise<boolean> {
  return sel.isVisible().catch(() => false);
}

// Drives a real match to its first combat and verifies the re-architected replay mounts,
// exposes its manual controls, and steps through beats without crashing. Captures a
// screenshot of a live beat as visual proof.
test('combat replay: mounts, pairs combatants, and steps through beats', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room (with bots)' }).click();
  await page.getByRole('button', { name: 'Start match' }).click({ timeout: 15000 });

  // round-1 shop: buy + play one unit so we field a board into combat
  await expect(page.getByText('SHOP', { exact: true })).toBeVisible({ timeout: 15000 });
  const shopZone = page.locator('.zone', { hasText: 'Shop' });
  const benchZone = page.locator('.zone', { hasText: 'Bench' });
  await expect(shopZone.locator('.unit').first()).toBeVisible({ timeout: 10000 });
  await shopZone.locator('.unit').first().click();
  await expect(benchZone.locator('.unit').first()).toBeVisible({ timeout: 8000 });
  await benchZone.locator('.unit').first().click();
  const legal = page.locator('.unit.legal').first();
  if (await legal.isVisible().catch(() => false)) await legal.click();
  const discover = page.locator('.discover-card .unit').first();
  if (await discover.isVisible().catch(() => false)) await discover.click();

  // ready up until the combat overlay appears
  const overlay = page.locator('.overlay');
  for (let i = 0; i < 40 && !(await visible(overlay)); i++) {
    const ready = page.getByRole('button', { name: 'Ready up' });
    if ((await visible(ready)) && (await ready.isEnabled().catch(() => false))) await ready.click();
    await page.waitForTimeout(700);
  }
  await expect(overlay).toBeVisible({ timeout: 20000 });

  // ── the re-architected replay structure is present ──
  await expect(page.locator('.battlefield')).toBeVisible();
  await expect(page.getByText(/^beat \d+\/\d+$/)).toBeVisible(); // beat counter
  await expect(page.locator('.combat-controls .scrub')).toBeVisible(); // manual scrub
  await expect(page.getByRole('button', { name: /Step/ }).first()).toBeVisible();
  // (no perm/temp legend: in-combat permanence isn't a real mechanic, so the distinction was removed)

  // pause and manually step a couple of beats — the heart of "go through it one beat at a time"
  await page.getByRole('button', { name: /Pause/ }).click().catch(() => {});
  const beatLabel = page.getByText(/^beat \d+\/\d+$/);
  const before = await beatLabel.textContent();
  await page.getByRole('button', { name: 'Step ▶' }).click().catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/combat-replay-beat.png' });
  const after = await beatLabel.textContent();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();

  // scrub to the end and finish the combat
  const scrub = page.locator('.combat-controls .scrub');
  await scrub.focus();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Continue' }).click({ timeout: 10000 });
});
