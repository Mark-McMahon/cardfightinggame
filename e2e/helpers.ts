import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// ── Native HTML5 drag-and-drop simulation ────────────────────────────────────────────────────────
// Playwright's mouse events do NOT trigger native HTML5 DnD (dragstart/dragover/drop). The app's
// Shop uses the native DnD API (draggable + onDragStart/onDragOver/onDrop), so we dispatch real
// DragEvents carrying a SHARED DataTransfer — exactly how a browser wires a drag gesture.
//
// Crucially, we deliver dragenter/dragover/drop to whatever element is actually under the drop
// POINT (document.elementFromPoint), letting the event bubble. That faithfully reproduces "the user
// released the card over this spot on screen": if a non-drop element sits on top, the drop is
// rejected just like in the real app.

export interface Point {
  x: number;
  y: number;
}

/** Center point of the first element matching `selector`. */
export async function centerOf(page: Page, selector: string): Promise<Point> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Point at fractional (fx, fy) within an element's box. fy=0.15 = near the top of the element,
 * fy=0.85 = near the bottom. Used to probe WHERE within the visible board a drop lands.
 */
export async function pointIn(page: Page, selector: string, fx = 0.5, fy = 0.5): Promise<Point> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/**
 * Perform a native drag from `sourceSelector` and drop at screen point `to`. Returns which element
 * (tag + classes) actually received the drop — useful to prove which zone caught it.
 */
export async function dragDropTo(
  page: Page,
  sourceSelector: string,
  to: Point,
): Promise<{ droppedOn: string }> {
  const src = page.locator(sourceSelector).first();
  const box = await src.boundingBox();
  if (!box) throw new Error(`no bounding box for source ${sourceSelector}`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  return page.evaluate(
    ({ sourceSelector, from, to }) => {
      const src = document.querySelector(sourceSelector) as HTMLElement | null;
      if (!src) throw new Error(`source gone: ${sourceSelector}`);
      const dt = new DataTransfer();

      const fire = (el: Element, type: string, x: number, y: number): boolean => {
        const ev = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          // @ts-expect-error dataTransfer is a valid DragEventInit member at runtime
          dataTransfer: dt,
        });
        return el.dispatchEvent(ev);
      };

      const describe = (el: Element | null): string => {
        if (!el) return '<none>';
        const cls = typeof el.className === 'string' ? el.className : '';
        return `${el.tagName.toLowerCase()}.${cls.split(/\s+/).filter(Boolean).join('.')}`;
      };

      // 1) dragstart on the source (bubbles to the draggable wrapper + React's onDragStart)
      fire(src, 'dragstart', from.x, from.y);

      // 2) the element the pointer is actually over at the drop point
      const target = document.elementFromPoint(to.x, to.y) ?? document.body;

      // 3) dragenter / dragover / drop delivered there (bubbling to any ancestor drop zone)
      fire(target, 'dragenter', to.x, to.y);
      const overAccepted = !fire(target, 'dragover', to.x, to.y); // preventDefault() => returns false
      fire(target, 'drop', to.x, to.y);

      // 4) dragend back on the source
      fire(src, 'dragend', to.x, to.y);

      return { droppedOn: describe(target), overAccepted };
    },
    { sourceSelector, from, to },
  );
}

/** Convenience: drag a source and drop at the center of a target selector. */
export async function dragDropOn(page: Page, sourceSelector: string, targetSelector: string): Promise<{ droppedOn: string }> {
  return dragDropTo(page, sourceSelector, await centerOf(page, targetSelector));
}

/**
 * Side-effect-free probe: start a drag from `sourceSelector`, hover over screen point `to`, and
 * report whether that spot ACCEPTS the drop (dragover called preventDefault) and which element is
 * under the pointer. No 'drop' is fired, so no buy/play/sell happens — safe to sweep many points.
 */
export async function probeDropPoint(
  page: Page,
  sourceSelector: string,
  to: Point,
): Promise<{ accepted: boolean; over: string }> {
  const src = page.locator(sourceSelector).first();
  const box = await src.boundingBox();
  if (!box) throw new Error(`no bounding box for source ${sourceSelector}`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return page.evaluate(
    ({ sourceSelector, from, to }) => {
      const src = document.querySelector(sourceSelector) as HTMLElement | null;
      if (!src) throw new Error(`source gone: ${sourceSelector}`);
      const dt = new DataTransfer();
      const fire = (el: Element, type: string, x: number, y: number): boolean => {
        const ev = new DragEvent(type, {
          bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
          // @ts-expect-error runtime-valid
          dataTransfer: dt,
        });
        return el.dispatchEvent(ev);
      };
      const describe = (el: Element | null): string => {
        if (!el) return '<none>';
        const cls = typeof el.className === 'string' ? el.className : '';
        return `${el.tagName.toLowerCase()}.${cls.split(/\s+/).filter(Boolean).join('.')}`;
      };
      fire(src, 'dragstart', from.x, from.y);
      const target = document.elementFromPoint(to.x, to.y) ?? document.body;
      fire(target, 'dragenter', to.x, to.y);
      const accepted = !fire(target, 'dragover', to.x, to.y); // preventDefault() => dispatch returns false
      fire(src, 'dragend', to.x, to.y);
      return { accepted, over: describe(target) };
    },
    { sourceSelector, from, to },
  );
}

// ── Match bootstrapping ──────────────────────────────────────────────────────────────────────────

/** From a fresh page, create a bots room and start the match, landing in the live Shop. */
export async function startMatchToShop(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Your name').fill('Tester');
  await page.getByRole('button', { name: /Create room/i }).click();
  // Lobby → start
  await page.getByRole('button', { name: /Start match/i }).click();
  // Shop is live once the tavern + board felt render and the phase is 'shop' (Ready button visible)
  await page.locator('.board-felt').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.tavern-bar .ctl-btn.ready').waitFor({ state: 'visible' });
}

/** Number of units currently on the board (arc slots). */
export async function boardCount(page: Page): Promise<number> {
  return page.locator('.board-row .arc-slot').count();
}

/** Number of units currently in the hand/bench (fan cards). */
export async function handCount(page: Page): Promise<number> {
  return page.locator('.hand-fan .fan-card').count();
}

/** Number of shop offers on the tavern shelf. */
export async function shopCount(page: Page): Promise<number> {
  return page.locator('.shelf .dragwrap').count();
}

/** Current round number, read from the standings rail. */
export async function currentRound(page: Page): Promise<number> {
  const t = await page.locator('.side-round').textContent();
  return parseInt((t || '').match(/\d+/)?.[0] ?? '0', 10);
}

/** Ready up, skip the replay, and wait until the NEXT live shop is showing. Robust to long late-game
 *  combat windows (the round number flips at combat start while the shop is still frozen). */
export async function advanceRound(page: Page): Promise<void> {
  const r = await currentRound(page);
  await page.locator('.tavern-bar .ctl-btn.ready:not([disabled])').click();
  try { await page.getByRole('button', { name: /Skip/i }).click({ timeout: 3000 }); } catch { /* no overlay (bye) */ }
  // Live next shop = round advanced AND the table is no longer frozen. Poll generously: the server
  // holds the combat window (up to ~40s late-game) regardless of the client Skip.
  await expect(async () => {
    if ((await page.locator('.results, .finished, .game-over').count()) > 0) throw new Error('match ended');
    expect(await currentRound(page)).toBeGreaterThan(r);
    expect(await page.locator('.match-main.shop-frozen').count()).toBe(0);
    expect(await page.locator('.board-felt').count()).toBeGreaterThan(0);
  }).toPass({ timeout: 75_000, intervals: [400] });
  await page.locator('.tavern-bar .ctl-btn.ready:not([disabled])').waitFor({ timeout: 15_000 });
}

/** Advance rounds until at least `n` gold is available (gold = min(2+round, 10)). */
export async function ensureGold(page: Page, n: number, maxRounds = 12): Promise<void> {
  for (let i = 0; i < maxRounds && (await gold(page)) < n; i++) await advanceRound(page);
}

/** Read the gold value from the tavern-bar wallet. */
export async function gold(page: Page): Promise<number> {
  const badge = await page.locator('.tavern-bar .coin').first().innerText();
  const m = badge.match(/\d+/);
  return m ? Number(m[0]) : NaN;
}
