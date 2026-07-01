import { describe, it, expect } from 'vitest';
import { UNITS } from '@cardgame/shared';
import { cardFace, hasCardRecipe } from './cardArt';

// The user-facing contract (task): every card the player can meet — in the shop or on the
// combat board, tokens included — must have art that uniquely identifies it. These tests
// fail loudly if a new unit is added without its own portrait, or if two recipes collide.

describe('card art coverage', () => {
  it('every catalog unit has its own bespoke portrait recipe (no tribe-blob fallback)', () => {
    const missing = UNITS.filter((u) => !hasCardRecipe(u.id)).map((u) => u.id);
    expect(missing).toEqual([]);
  });

  it('every card renders a distinct portrait — no two cards share art', () => {
    const byArt = new Map<string, string>();
    const collisions: string[] = [];
    for (const u of UNITS) {
      const svg = cardFace(u.id, u.tribe);
      const prior = byArt.get(svg);
      if (prior) collisions.push(`${u.id} renders identically to ${prior}`);
      else byArt.set(svg, u.id);
    }
    expect(collisions).toEqual([]);
    expect(byArt.size).toBe(UNITS.length);
  });

  it('produces non-empty SVG markup for every unit', () => {
    for (const u of UNITS) {
      const svg = cardFace(u.id, u.tribe);
      expect(svg.length, u.id).toBeGreaterThan(0);
      expect(svg, u.id).toContain('fill=');
    }
  });
});
