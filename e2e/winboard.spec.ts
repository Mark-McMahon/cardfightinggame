import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { boardCount, gold, pointIn, dragDropTo } from './helpers';

// Verifies the Results-screen winning-board (§10) end-to-end. A scripted lone human rarely beats 7
// bots, so we force a decisive WIN with a 1v1 (bot-fill OFF): page A builds a board; page B just
// readies with an empty board and is whittled to 0 HP in a few rounds. A ends as the last player →
// Results → asserts A sees its own winning board rendered as real card tokens (and screenshots it).
const SHOT = '/private/tmp/claude-501/-Users-markmcmahon-projects-cardfightinggame-regen/6efc1ccd-b815-463a-a332-0cacdca10ec8/scratchpad/results.png';

test('winner sees their winning board on the results screen', async ({ page, browser }) => {
  test.setTimeout(200_000);
  const A = page; // the eventual winner
  const ctxB = await browser.newContext();
  const B = await ctxB.newPage();

  // ── A creates the room, reads the share code ──────────────────────────────────────
  await A.goto('/');
  await A.getByPlaceholder('Your name').fill('Champ');
  await A.getByRole('button', { name: /Create room/i }).click();
  const codeTag = A.locator('.panel').filter({ hasText: 'Room code' }).locator('.tag').first();
  await codeTag.waitFor({ timeout: 15_000 });
  const code = (await codeTag.textContent())?.trim() ?? '';
  expect(code, 'room code should be shown in the lobby').toMatch(/\w+/);

  // ── B joins by code ───────────────────────────────────────────────────────────────
  await B.goto('/');
  await B.getByPlaceholder('Your name').fill('Sacrifice');
  await B.getByPlaceholder('Room code').fill(code);
  await B.getByRole('button', { name: /^Join$/ }).click();

  // ── A: wait for both seated, turn OFF bot-fill (→ a true 1v1), start ───────────────
  await expect(A.locator('.players .pchip')).toHaveCount(2, { timeout: 15_000 });
  // Controlled checkbox: `checked` mirrors server `pub.botFill`, so click + await the synced flip
  // (uncheck() races the round-trip and thinks the click was a no-op).
  const botFillBox = A.locator('input[type="checkbox"]');
  await botFillBox.click();
  await expect(botFillBox).not.toBeChecked({ timeout: 10_000 });
  await A.getByRole('button', { name: /Start match/i }).click();
  await A.locator('.board-felt').waitFor({ state: 'visible', timeout: 30_000 });
  await B.locator('.board-felt').waitFor({ state: 'visible', timeout: 30_000 });

  const boardCenter = () => pointIn(A, '.board-felt', 0.5, 0.5);
  const aReady = A.locator('.tavern-bar .ctl-btn.ready:not([disabled])');
  const bReady = B.locator('.tavern-bar .ctl-btn.ready:not([disabled])');
  const aResults = async () => (await A.getByRole('button', { name: /Back to menu/i }).count()) > 0;
  const liveShop = async (p: Page) =>
    (await p.locator('.tavern-bar .ctl-btn.ready:not([disabled])').count()) > 0 &&
    (await p.locator('.match-main.shop-frozen').count()) === 0;

  const t0 = Date.now();
  let round = 0;
  while (!(await aResults()) && Date.now() - t0 < 160_000) {
    if (await liveShop(A)) {
      round++;
      for (let i = 0; i < 8 && (await gold(A)) >= 3 && (await A.locator('.shelf .dragwrap').count()) > 0; i++) {
        const b = await boardCount(A);
        await dragDropTo(A, '.shelf .dragwrap', await boardCenter());
        if ((await boardCount(A)) <= b) break; // board full
      }
      console.log(`round ${round}: A board=${await boardCount(A)} gold=${await gold(A)} t=${Math.round((Date.now() - t0) / 1000)}s`);
      await aReady.click().catch(() => {});
    }
    if (await liveShop(B)) await bReady.click().catch(() => {}); // B readies an empty board → loses
    await A.getByRole('button', { name: /Skip/i }).click({ timeout: 1200 }).catch(() => {});
    await B.getByRole('button', { name: /Skip/i }).click({ timeout: 1200 }).catch(() => {});
    if (!(await liveShop(A))) await A.waitForTimeout(700);
  }

  // ── A is the winner → Results with its winning board ───────────────────────────────
  const backBtn = A.getByRole('button', { name: /Back to menu/i });
  await expect(backBtn).toBeVisible({ timeout: 15_000 });
  const banner = (await A.locator('.result-banner .rb-word').textContent())?.trim();
  const iWon = banner === 'Victory!';
  const slots = await A.locator('.win-board .arc-slot').count();
  console.log(`RESULT banner="${banner}" iWon=${iWon} winBoardSlots=${slots}`);
  await A.screenshot({ path: SHOT, fullPage: true });

  expect(iWon, 'A should have won the 1v1').toBe(true);
  expect(slots, 'winner must see a non-empty winning board').toBeGreaterThan(0);
  await expect(A.locator('.win-board .standings-title')).toHaveText(/winning board/i);
  await expect(A.locator('.win-board .arc-slot .unit').first()).toBeVisible();
  // Every slot renders a real card token (procedural name + atk/hp stat line).
  expect(await A.locator('.win-board .arc-slot .unit .nm').count()).toBe(slots);
  expect(await A.locator('.win-board .arc-slot .unit .stats').count()).toBe(slots);

  await ctxB.close();
});
