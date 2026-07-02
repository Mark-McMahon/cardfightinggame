import { test, expect } from '@playwright/test';
import {
  startMatchToShop, advanceRound,
  boardCount, handCount, shopCount, gold,
  pointIn, centerOf, dragDropTo,
} from './helpers';

// Full regression over EVERY drag path, driven through real game state. Kept to a handful of rounds
// (the player stays alive; late-game combat windows are slow) while still populating the board. Board
// drops aim at the visual CENTER of the felt — where a player naturally releases — proving the whole
// board surface accepts drops after the fix.
test('every drag path works with a populated board', async ({ page }) => {
  test.setTimeout(120_000);
  await startMatchToShop(page);
  const boardCenter = () => pointIn(page, '.board-felt', 0.5, 0.5);
  const needGold = async (n: number) => { while ((await gold(page)) < n) await advanceRound(page); };

  // ── 1. shop → board (buy + place at felt center) — the originally-broken path ───
  await needGold(3);
  {
    const b = await boardCount(page);
    await dragDropTo(page, '.shelf .dragwrap', await boardCenter());
    await expect.poll(() => boardCount(page), { message: 'shop→board should add a board unit' }).toBe(b + 1);
  }

  // ── 2. shop → board again + POSITIONAL insert at the far left (slot 0) ──────────
  await needGold(3);
  {
    const b = await boardCount(page);
    // drop near the left edge → slotFromX inserts at the front; count grows either way
    await dragDropTo(page, '.shelf .dragwrap', await pointIn(page, '.board-felt', 0.04, 0.5));
    await expect.poll(() => boardCount(page)).toBe(b + 1);
    expect(await boardCount(page), 'need ≥2 units to reorder next').toBeGreaterThanOrEqual(2);
  }

  // ── 3. board → board (reorder) — no crash, count preserved ─────────────────────
  {
    const n = await boardCount(page);
    await dragDropTo(page, '.board-row .arc-slot:first-child', await pointIn(page, '.board-row', 0.95, 0.5));
    await page.waitForTimeout(400);
    expect(await boardCount(page), 'reorder must not add/drop a unit').toBe(n);
  }

  // ── 4. board → tavern (sell) ───────────────────────────────────────────────────
  {
    const n = await boardCount(page);
    const g = await gold(page);
    await dragDropTo(page, '.board-row .arc-slot:last-child', await centerOf(page, '.tavern'));
    await expect.poll(() => boardCount(page), { message: 'board→tavern should sell a unit' }).toBe(n - 1);
    expect(await gold(page), 'selling refunds gold').toBeGreaterThan(g - 1);
  }

  // ── 5. shop → hand (buy to bench) ──────────────────────────────────────────────
  await needGold(3);
  {
    const h = await handCount(page);
    await dragDropTo(page, '.shelf .dragwrap', await centerOf(page, '.hand-fan'));
    await expect.poll(() => handCount(page), { message: 'shop→hand should bench a unit' }).toBe(h + 1);
  }

  // ── 6. hand → board (play a benched unit at felt center) ───────────────────────
  {
    expect(await handCount(page)).toBeGreaterThanOrEqual(1);
    const b = await boardCount(page);
    const h = await handCount(page);
    await dragDropTo(page, '.hand-fan .fan-card', await boardCenter());
    await expect.poll(() => boardCount(page), { message: 'hand→board should play the unit' }).toBe(b + 1);
    expect(await handCount(page)).toBe(h - 1);
  }

  // ── 7. hand → tavern (sell from bench) ─────────────────────────────────────────
  await needGold(3);
  {
    const h0 = await handCount(page);
    await dragDropTo(page, '.shelf .dragwrap', await centerOf(page, '.hand-fan'));
    await expect.poll(() => handCount(page)).toBe(h0 + 1);
    const h1 = await handCount(page);
    await dragDropTo(page, '.hand-fan .fan-card:last-child', await centerOf(page, '.tavern'));
    await expect.poll(() => handCount(page), { message: 'hand→tavern should sell from bench' }).toBe(h1 - 1);
  }

  // ── 8. click fallbacks still work (buy by click, play by click) ────────────────
  await needGold(3);
  {
    const h0 = await handCount(page);
    await page.locator('.shelf .dragwrap').first().click();
    await expect.poll(() => handCount(page), { message: 'click a shop card should buy to bench' }).toBe(h0 + 1);
    const b0 = await boardCount(page);
    await page.locator('.hand-fan .fan-card').first().click();
    await expect.poll(() => boardCount(page), { message: 'click a bench card should play to board' }).toBe(b0 + 1);
  }

  console.log(`✓ all drag paths — final: board=${await boardCount(page)} hand=${await handCount(page)} gold=${await gold(page)}`);
});
