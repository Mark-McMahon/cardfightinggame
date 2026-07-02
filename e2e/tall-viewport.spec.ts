import { test, expect } from '@playwright/test';
import { startMatchToShop, boardCount, pointIn, probeDropPoint, dragDropTo } from './helpers';

// The regression amplified: on a tall/maximized window, .board-felt (flex:1 1 auto) grows to fill
// the table while .board-row stays card-height pinned to the bottom. So the visible board is mostly
// a dead zone — a drop aimed at the obvious board area is silently rejected. This is the user's bug.
test('tall window: most of the visible board rejects drops', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1300 });
  await startMatchToShop(page);

  const felt = await page.locator('.board-felt').boundingBox();
  const row = await page.locator('.board-row').boundingBox();
  console.log(`\nfelt: y=${felt!.y.toFixed(0)} h=${felt!.height.toFixed(0)}   row: y=${row!.y.toFixed(0)} h=${row!.height.toFixed(0)}`);

  let deadBands = 0;
  const map: string[] = [];
  for (const fy of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const pt = await pointIn(page, '.board-felt', 0.5, fy);
    const r = await probeDropPoint(page, '.shelf .dragwrap', pt);
    if (!r.accepted) deadBands++;
    map.push(`  fy=${fy.toFixed(2)} accepted=${r.accepted ? 'YES' : 'no '} over=${r.over}`);
  }
  console.log('felt accept-map (top→bottom):\n' + map.join('\n'));
  const deadPct = Math.round((deadBands / 9) * 100);
  console.log(`\ndead (drop-rejecting) fraction of visible board ≈ ${deadPct}%`);

  // A player aims at the upper-middle of the board (the natural focal point) and drops.
  const before = await boardCount(page);
  await dragDropTo(page, '.shelf .dragwrap', await pointIn(page, '.board-felt', 0.5, 0.35));
  await page.waitForTimeout(500);
  const landed = (await boardCount(page)) > before;
  console.log(`upper-middle drop (0.5, 0.35): ${landed ? 'WORKED' : 'FAILED — silently rejected'}`);

  // This assertion documents the bug: pre-fix it FAILS (dead zone is large / upper drop rejected).
  expect(deadBands, 'no part of the visible board should reject a drop').toBe(0);
});
