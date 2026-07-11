import type { Effect, UnitCard } from '../types';
import { engines } from '../config/engines';
import { getBreakpoint as bp } from '../config/breakpoints';

const W = engines.wildkin;
const R = engines.reefkin;
const V = engines.revenants;
const I = engines.infernals; // Prompt-2: Infernals (sacrifice / risk)
const T = engines.tuskers; // Round-6: Tuskers (spoils / exponential doubler)
const P = engines.primordials; // Round-6: Primordials (elements / cleave)
const S = engines.sirens; // Round-6: Sirens (spellcraft / poison + burst)
const C = engines.corsairs; // Round-6: Corsairs (tempo / reborn + shield)

// ─────────────────────────────────────────────────────────────────────────────
// Round-6 vertical-slice catalog (spec §16.5). All names original (clean-room §0).
// Primary/breakpoint payoffs read their numbers from config/breakpoints.ts; engine
// knobs from config/engines.ts; minor one-shot buffs use literals (as in v1).
//
// Legend: ⭐ breakpoint payoff · 🔶 cross-tribe bridge · axis = which competing axis a
// card feeds (static/categorical — §16.6, decision #28).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Writeback audit (decision #38, 2026-07-01): the §7.5 combat→board writeback is LIVE, so a
// combat-fired `buffStats` with `permanent:true` now really persists onto survivors. Every
// combat-fired buff below (startOfCombat / onAttack / onShieldBreak / deathrattle /
// afterFriendlyDeaths / combat-side onSummon) therefore carries an EXPLICIT `permanent:false`
// (this-combat, the pre-#38 behavior — no card is silently upgraded). Sole shop-gated
// exemption (#38, encoded by the EV-WBK-08 lint): Mother Thorn's `onSummon` keeps
// `permanent:true` — its `tokensSummonedThisTurnAtLeast` condition is shop-scoped (reads 0
// in combat), so the effect can never fire in combat. Shop-fired permanents
// (battlecry / onSell / afterFriendlyBattlecry rows) already mutate the persistent instance
// directly and emit no combat events, so they cannot double-apply through the fold.
// ─────────────────────────────────────────────────────────────────────────────

// Reefmourner's planted deathrattle (§16.3 #5) — board buff on the host's death.
const PLANTED_DEATHRATTLE: Effect = {
  trigger: { type: 'deathrattle' },
  target: { selector: 'allAllies', excludeSelf: true },
  actions: [{ type: 'buffStats', atk: R.plantedDeathrattleAtk, hp: R.plantedDeathrattleHp, permanent: false }],
};

export const UNITS: UnitCard[] = [
  // ═══════════════════════════ WILDKIN — SWARM (tokens) ═══════════════════════
  {
    id: 'wildkin_brambleling',
    name: 'Brambleling',
    tribe: 'wildkin',
    tier: 1,
    atk: 1,
    hp: 3,
    keywords: [],
    axis: ['swarm'],
    text: `End of turn: summon ${W.tokensPerTurn} Thornpup${W.tokensPerTurn === 1 ? '' : 's'}.`,
    effects: [
      {
        trigger: { type: 'endOfTurn' },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: 'wildkin_thornpup', summonCount: W.tokensPerTurn }],
      },
    ],
  },
  {
    id: 'wildkin_thornpup',
    name: 'Thornpup',
    tribe: 'wildkin',
    tier: 1,
    atk: 1,
    hp: 1,
    keywords: [],
    isToken: true,
    axis: ['swarm'],
    text: 'Token.',
    effects: [],
  },
  {
    // ✏️ redesign: stat-stick → carries a thin DEATHS floor off dying tokens.
    id: 'wildkin_gorehide',
    name: 'Gorehide',
    tribe: 'wildkin',
    tier: 2,
    atk: 2,
    hp: 4,
    keywords: ['cleave'],
    axis: ['swarm', 'deaths'],
    text: `Cleave. +${W.tokenDeathFloorAtk} Attack each time a friendly token dies this combat (max +${W.tokenDeathFloorCapAtk}).`,
    effects: [
      {
        trigger: { type: 'afterFriendlyDeaths', tokensOnly: true, threshold: 1, everyN: true },
        target: { selector: 'self' },
        // config-driven permanence (engines.wildkin.tokenBuffPermanent = false: "this combat").
        actions: [{ type: 'buffStats', atk: W.tokenDeathFloorAtk, permanent: W.tokenBuffPermanent }],
      },
    ],
  },
  {
    // ⭐ new — ENDURE-flavoured go-wide payoff at a board-size breakpoint.
    id: 'wildkin_thornwarden',
    name: 'Thornwarden',
    tribe: 'wildkin',
    tier: 2,
    atk: 2,
    hp: 3,
    keywords: ['taunt'],
    axis: ['swarm', 'endure'],
    text: `Taunt. Start of combat: if you control ${bp('wildkin_thornwarden').threshold}+ minions, gain +${bp('wildkin_thornwarden').atk}/+${bp('wildkin_thornwarden').hp}.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'countAllies', value: bp('wildkin_thornwarden').threshold },
        target: { selector: 'self' },
        actions: [{ type: 'buffStats', atk: bp('wildkin_thornwarden').atk, hp: bp('wildkin_thornwarden').hp, permanent: false }],
      },
    ],
  },
  {
    // ✏️⭐ audit redesign (Gate 1): the old end-of-turn WHOLE-BOARD +3/+3 (permanent) was met forever by
    // one Brambleling → free per-turn permanent power (the flagged free-permanence lane). REMOVED. Only
    // the per-token buff survives, and its threshold is raised 2→3 so it costs a real over-summon: each
    // +2/+2 rides on a specific token that ENTERED play, never a free whole-board slab. Wide 3/3 tokens
    // still fold to CLEAVE (a cleaver chains the neighbours) and POISON (a touch kills each, size-agnostic).
    id: 'wildkin_motherthorn',
    name: 'Mother Thorn',
    tribe: 'wildkin',
    tier: 3,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['swarm'],
    text: `After you summon a token, if you've summoned ${bp('wildkin_motherthorn').threshold}+ tokens this turn, that token gains +${bp('wildkin_motherthorn').tokenAtk}/+${bp('wildkin_motherthorn').tokenHp}.`,
    effects: [
      {
        trigger: { type: 'onSummon' },
        condition: { kind: 'tokensSummonedThisTurnAtLeast', value: bp('wildkin_motherthorn').threshold },
        target: { selector: 'triggerSource' },
        // permanent:true is the #38 audit's sole combat-trigger exemption: the shop-scoped
        // condition above reads 0 in combat, so this can never fire there (EV-WBK-08 lint).
        actions: [{ type: 'buffStats', atk: bp('wildkin_motherthorn').tokenAtk, hp: bp('wildkin_motherthorn').tokenHp, permanent: true }],
      },
    ],
  },
  {
    // ⭐ DEATHS avenge (every-N) — tokens dying feed it (SWARM↔DEATHS structural bridge).
    id: 'wildkin_packmother',
    name: 'Pack Mother',
    tribe: 'wildkin',
    tier: 3,
    atk: 2,
    hp: 4,
    keywords: [],
    axis: ['deaths'],
    text: `After every ${W.avengeDeathThreshold} friendly deaths in combat: give your minions +${W.avengePayoffAtk}/+${W.avengePayoffHp}.`,
    effects: [
      {
        trigger: { type: 'afterFriendlyDeaths', threshold: W.avengeDeathThreshold, everyN: true },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: W.avengePayoffAtk, hp: W.avengePayoffHp, permanent: false }],
      },
    ],
  },
  {
    // 🔶 bridge → Reefkin: a battlecry that pays off on the BATTLECRY axis.
    id: 'wildkin_brackentide',
    name: 'Brackentide',
    tribe: 'wildkin',
    tier: 3,
    atk: 2,
    hp: 2,
    keywords: [],
    axis: ['swarm', 'battlecries'],
    text: `Battlecry: summon a Thornpup. If you've played ${bp('wildkin_brackentide').threshold}+ battlecries this turn, summon ${1 + (bp('wildkin_brackentide').summonCount ?? 0)} instead.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: 'wildkin_thornpup', summonCount: 1 }],
      },
      {
        trigger: { type: 'battlecry' },
        condition: { kind: 'battlecriesThisTurnAtLeast', value: bp('wildkin_brackentide').threshold },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: bp('wildkin_brackentide').summonUnitId, summonCount: bp('wildkin_brackentide').summonCount }],
      },
    ],
  },
  {
    id: 'wildkin_grovecaller',
    name: 'Grovecaller',
    tribe: 'wildkin',
    tier: 4,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['swarm'],
    text: `Your end-of-turn effects trigger ${W.endOfTurnTriggerMultiplier}× (capped).`,
    effects: [],
    auras: [
      {
        scope: 'yourEndOfTurn',
        modifier: { kind: 'triggerMultiplier', value: W.endOfTurnTriggerMultiplier },
        stacks: false,
      },
    ],
  },
  {
    id: 'wildkin_bonepiper',
    name: 'Bonepiper',
    tribe: 'wildkin',
    tier: 4,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['deaths'],
    text: 'After this attacks, re-trigger an adjacent friendly deathrattle (without it dying).',
    effects: [
      {
        trigger: { type: 'onAttack' },
        target: { selector: 'self' },
        actions: [
          {
            type: 'custom',
            handlerId: 'replayAdjacentDeathrattle',
            params: { scope: W.deathrattleReplayScope, eachAttack: W.deathrattleReplayEachAttack },
          },
        ],
      },
    ],
  },
  {
    // ✏️ redesign: stat-stick → SWARM/DEATHS floor carrier (capstone-tier body).
    id: 'wildkin_thornbeast',
    name: 'Thornbeast',
    tribe: 'wildkin',
    tier: 5,
    atk: 5,
    hp: 7,
    keywords: ['cleave', 'taunt'],
    axis: ['swarm', 'deaths'],
    text: `Taunt. Cleave. +${W.tokenDeathFloorAtk} Attack each time a friendly token dies this combat (max +${W.tokenDeathFloorCapAtk}).`,
    effects: [
      {
        trigger: { type: 'afterFriendlyDeaths', tokensOnly: true, threshold: 1, everyN: true },
        target: { selector: 'self' },
        // config-driven permanence (engines.wildkin.tokenBuffPermanent = false: "this combat").
        actions: [{ type: 'buffStats', atk: W.tokenDeathFloorAtk, permanent: W.tokenBuffPermanent }],
      },
    ],
  },
  {
    // ✏️⭐ redesign (Prompt-1 Part B): the old "summon 6 Thornpups (×Grovecaller = 12)" was the
    // reference cap-truncation failure — a SWARM capstone that summons ONTO a board that swarm
    // keeps full, so its payoff was silently eaten by the 7-wide cap and paid off MOST when you
    // were behind (empty slots). Reworked into a real capstone whose payoff SURVIVES a full board:
    // it still trickles 2 Thornpups a turn (graceful, ×Grovecaller), but its headline is a
    // start-of-combat WIDE-board bomb that buffs the tokens you already have (best when ahead,
    // not when behind). Breakpoint-gated (alliesAtStart), one-shot → not linear.
    id: 'wildkin_grovelord',
    name: 'Grovelord',
    tribe: 'wildkin',
    tier: 6,
    atk: 8,
    hp: 9,
    keywords: [],
    axis: ['swarm', 'endure'],
    text: `End of turn: summon ${W.tokensPerTurn} Thornpups (×Grovecaller). Start of combat: if you control ${bp('wildkin_grovelord').threshold}+ minions, give your minions +${bp('wildkin_grovelord').atk}/+${bp('wildkin_grovelord').hp}. SWARM capstone.`,
    effects: [
      {
        trigger: { type: 'endOfTurn' },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: 'wildkin_thornpup', summonCount: W.tokensPerTurn }],
      },
      {
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'countAllies', value: bp('wildkin_grovelord').threshold },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: bp('wildkin_grovelord').atk, hp: bp('wildkin_grovelord').hp, permanent: false }],
      },
    ],
  },
  {
    // ⭐ Phase 7 SWARM↔DEATHS scaling capstone — Thornqueen (decision #74). Wildkin was the WEAKEST tribe: a
    // wide board of modest tokens with only a flat, width-capped Grovelord buff — no way for the swarm's per-body
    // to scale high. This turns the swarm's endless FALLEN into a whole-board payoff: a TIERED breakpoint on the
    // PERSISTENT `lifetimeDeaths` counter (REUSED from Ossuary Titan — combat deaths incl. tokens feed it, so a
    // wide board accrues it FAST → reachable). One cumulative board-wide buff to your WILDKIN per crossed tier at
    // start of combat, THIS COMBAT ONLY (permanent:false). A step, not a line — mirrors Ossuary Titan/Magnaforge
    // but board-wide over the swarm. Reborn so the queen returns to keep leading the brood (and her death feeds the
    // counter). Numbers live in breakpoints.ts.tiers. Still folds to poison + cleave + width-removal.
    id: 'wildkin_thornqueen',
    name: 'Thornqueen',
    tribe: 'wildkin',
    tier: 6,
    atk: 6,
    hp: 7,
    keywords: ['reborn'],
    axis: ['swarm', 'deaths'],
    text: `Reborn. Start of combat: for every fallen-swarm milestone this game (${bp('wildkin_thornqueen').tiers!.map((t) => t.threshold).join('/')} lifetime deaths), give your Wildkin an escalating +Atk/+Health this combat. SWARM capstone.`,
    effects: bp('wildkin_thornqueen').tiers!.map(
      (tier): Effect => ({
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'lifetimeDeathsAtLeast', value: tier.threshold },
        target: { selector: 'allAllies', filterTribe: 'wildkin' },
        actions: [{ type: 'buffStats', atk: tier.atk, hp: tier.hp, permanent: false }],
      }),
    ),
  },

  // ═══════════════════════════ REVENANTS — DEATHS ═════════════════════════════
  {
    // ✏️ redesign: vanilla reborn → reborn body that pays the tribe on death.
    id: 'revenants_cryptling',
    name: 'Cryptling',
    tribe: 'revenants',
    tier: 1,
    atk: 1,
    hp: 1,
    keywords: ['reborn'],
    axis: ['deaths'],
    text: 'Reborn. Deathrattle: give a random friendly Revenant +1/+1.',
    effects: [
      {
        // this-combat buff BY DESIGN (explicit since #38 made combat permanence real): Cryptling's
        // death payoff is re-earned each fight, not a free persistent trickle.
        trigger: { type: 'deathrattle' },
        target: { selector: 'randomAlly', filterTribe: 'revenants', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 1, hp: 1, permanent: false }],
      },
    ],
  },
  {
    id: 'revenants_wisp',
    name: 'Grave Wisp',
    tribe: 'revenants',
    tier: 1,
    atk: 1,
    hp: 1,
    keywords: [],
    isToken: true,
    axis: ['deaths'],
    text: 'Token.',
    effects: [],
  },
  {
    // new — DEATHS enabler: doubles the next friendly deathrattle (handler).
    id: 'revenants_pallbearer',
    name: 'Pallbearer',
    tribe: 'revenants',
    tier: 1,
    atk: 2,
    hp: 2,
    keywords: [],
    axis: ['deaths'],
    text: 'Deathrattle: the next friendly to die this combat triggers its Deathrattle twice.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'self' },
        actions: [{ type: 'custom', handlerId: 'primeNextDeathrattleDouble' }],
      },
    ],
  },
  {
    id: 'revenants_gravewing',
    name: 'Gravewing',
    tribe: 'revenants',
    tier: 2,
    atk: 2,
    hp: 1,
    keywords: ['reborn'],
    axis: ['deaths'],
    text: `Reborn. Deathrattle: give your highest-health Revenant +${V.deathPayoffHp} health.`,
    effects: [
      {
        // this-combat buff by design (see Cryptling note above).
        trigger: { type: 'deathrattle' },
        target: { selector: 'highestStatAlly', stat: 'hp', filterTribe: 'revenants', excludeSelf: true },
        actions: [{ type: 'buffStats', hp: V.deathPayoffHp, permanent: false }],
      },
    ],
  },
  {
    id: 'revenants_tombspawn',
    name: 'Tombspawn',
    tribe: 'revenants',
    tier: 2,
    atk: 1,
    hp: 2,
    keywords: [],
    axis: ['deaths'],
    text: 'Deathrattle: summon two Grave Wisps.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: 'revenants_wisp', summonCount: 2 }],
      },
    ],
  },
  {
    id: 'revenants_graverobber',
    name: 'Graverobber',
    tribe: 'revenants',
    tier: 3,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['deaths'],
    text: 'Deathrattle: give your Revenants +1/+1.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'allAllies', filterTribe: 'revenants', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 1, hp: 1, permanent: false }],
      },
    ],
  },
  {
    // ⭐ marquee DEATHS break.
    id: 'revenants_mortarch',
    name: 'Mortarch',
    tribe: 'revenants',
    tier: 3,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['deaths'],
    text: `At ${bp('revenants_mortarch').threshold}+ friendly deaths this combat: give your board +${bp('revenants_mortarch').atk}/+${bp('revenants_mortarch').hp} (once).`,
    effects: [
      {
        trigger: { type: 'afterFriendlyDeaths', threshold: bp('revenants_mortarch').threshold, everyN: false },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: bp('revenants_mortarch').atk, hp: bp('revenants_mortarch').hp, permanent: false }],
      },
    ],
  },
  {
    id: 'revenants_dirgecaller',
    name: 'Dirgecaller',
    tribe: 'revenants',
    tier: 4,
    atk: 3,
    hp: 4,
    keywords: ['reborn'],
    axis: ['deaths', 'endure'],
    text: 'Reborn. Deathrattle: give your minions +1/+1.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'allAllies', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 1, hp: 1, permanent: false }],
      },
    ],
  },
  {
    // Phase 4 POSITIONAL card (decision #52; clean-room §0 — "Last Rites Drummer" is original). A
    // deathrattle that grants REBORN to its board-index ±1 neighbors (the `adjacentAllies` selector,
    // §6.3/§7.3), computed against the SETTLED board at deathrattle time (D1). Rewards clustering it
    // between two carries so its death re-arms the flanks; folds to poison (kills each reborn twice).
    id: 'revenants_lastrites',
    name: 'Last Rites Drummer',
    tribe: 'revenants',
    tier: 3,
    atk: 2,
    hp: 3,
    keywords: [],
    axis: ['deaths', 'endure'],
    text: 'Deathrattle: your adjacent minions gain Reborn.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'adjacentAllies' },
        actions: [{ type: 'grantKeyword', keyword: 'reborn' }],
      },
    ],
  },
  {
    // 🔶 bridge → Reefkin: a battlecry on a DEATHS body.
    id: 'revenants_tideclaimer',
    name: 'Tideclaimer',
    tribe: 'revenants',
    tier: 4,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['deaths', 'battlecries'],
    text: `Battlecry: if you've played ${bp('revenants_tideclaimer').threshold}+ battlecries this turn, summon a 2/2 Reborn Wisp.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        condition: { kind: 'battlecriesThisTurnAtLeast', value: bp('revenants_tideclaimer').threshold },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: bp('revenants_tideclaimer').summonUnitId, summonCount: bp('revenants_tideclaimer').summonCount }],
      },
    ],
  },
  {
    // ✏️⭐ redesign: always-on aura → DEATHS breakpoint (decision #25). Amp capped.
    id: 'revenants_palelich',
    name: 'Pale Lich',
    tribe: 'revenants',
    tier: 5,
    atk: 4,
    hp: 6,
    keywords: [],
    axis: ['deaths'],
    text: `At ${V.undeadDamageThreshold}+ Revenant deaths this combat, your Revenants deal ${Math.min(V.undeadDamageAmp, V.undeadDamageAmpCap)}× damage for the rest of combat.`,
    effects: [],
    auras: [
      {
        scope: 'selfTribeAllies',
        modifier: { kind: 'damageMultiplier', value: Math.min(V.undeadDamageAmp, V.undeadDamageAmpCap), tribe: 'revenants' },
        stacks: V.undeadDamageAmpStacks,
        activeWhen: { counter: 'revenantDeaths', threshold: V.undeadDamageThreshold },
      },
    ],
  },
  {
    // ✏️ redesign: vanilla → DEATHS capstone gated on a death count.
    id: 'revenants_boncolossus',
    name: 'Bone Colossus',
    tribe: 'revenants',
    tier: 6,
    atk: 5,
    hp: 7,
    keywords: ['taunt', 'reborn'],
    axis: ['deaths', 'endure'],
    text: `Taunt. Reborn. Deathrattle: if ${bp('revenants_boncolossus').threshold}+ friendlies died this combat, summon two 4/4 Reborn Wraiths.`,
    effects: [
      {
        trigger: { type: 'deathrattle' },
        condition: { kind: 'deathsThisCombatAtLeast', value: bp('revenants_boncolossus').threshold },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: bp('revenants_boncolossus').summonUnitId, summonCount: bp('revenants_boncolossus').summonCount }],
      },
    ],
  },
  {
    // ⭐ Phase 3 LIFETIME scaling — Ossuary Titan. The original "+1/+1 per 2 lifetime deaths" was LINEAR
    // primary scaling (banned by #22); reworked to DISCRETE, ESCALATING breakpoints on the PERSISTENT
    // lifetimeDeaths counter (rides in on the CombatBoard scalar). One cumulative self-buff per crossed
    // tier at start of combat, THIS COMBAT ONLY (permanent:false). Numbers live in breakpoints.ts.tiers.
    id: 'revenants_ossuarytitan',
    name: 'Ossuary Titan',
    tribe: 'revenants',
    tier: 5,
    atk: 4,
    hp: 6,
    keywords: [],
    axis: ['deaths'],
    text: `Start of combat: for every lifetime-friendly-death milestone reached (${bp('revenants_ossuarytitan').tiers!.map((t) => t.threshold).join('/')}), gain an escalating +Atk/+Health this combat.`,
    effects: bp('revenants_ossuarytitan').tiers!.map(
      (tier): Effect => ({
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'lifetimeDeathsAtLeast', value: tier.threshold },
        target: { selector: 'self' },
        actions: [{ type: 'buffStats', atk: tier.atk, hp: tier.hp, permanent: false }],
      }),
    ),
  },
  {
    // ⭐ Phase 3 CONTESTED-CONDITION double — Gravemonarch (T6 capstone). End of combat: if 5+ friendlies
    // died THIS combat AND it survived, permanently DOUBLE its stats (via the §7.5 writeback-multiply
    // extension). Exponential, but each double is BOUGHT by surviving a near-wipe (a contested condition,
    // legal under #22/#40) — the opponent contests it by finishing the kill (poison the 1-hp reborn body,
    // out-tempo). Reborn edge (#44): a Reborn RETURN counts as surviving; the double folds onto the
    // PERSISTENT instance (its post-reborn 1-hp combat state is irrelevant to the persistent write).
    // Clean-room: renamed from the working title "Grave Emperor" to the original compound "Gravemonarch".
    id: 'revenants_gravemonarch',
    name: 'Gravemonarch',
    tribe: 'revenants',
    tier: 6,
    atk: 6,
    hp: 7,
    keywords: ['reborn'],
    axis: ['deaths', 'endure'],
    text: `Reborn. End of combat: if ${V.graveEmperorDeathThreshold}+ friendly minions died this combat and Gravemonarch survived, permanently multiply its stats by ${V.graveEmperorFactor}.`,
    effects: [
      {
        trigger: { type: 'endOfCombat' },
        condition: { kind: 'deathsThisCombatAtLeast', value: V.graveEmperorDeathThreshold },
        target: { selector: 'self' },
        actions: [{ type: 'multiplyStats', factor: V.graveEmperorFactor, permanent: true }],
      },
    ],
  },
  {
    id: 'revenants_rebornwisp',
    name: 'Reborn Wisp',
    tribe: 'revenants',
    tier: 2,
    atk: 2,
    hp: 2,
    keywords: ['reborn'],
    isToken: true,
    axis: ['deaths'],
    text: 'Token. Reborn.',
    effects: [],
  },
  {
    id: 'revenants_rebornwraith',
    name: 'Reborn Wraith',
    tribe: 'revenants',
    tier: 4,
    atk: 4,
    hp: 4,
    keywords: ['reborn'],
    isToken: true,
    axis: ['deaths'],
    text: 'Token. Reborn.',
    effects: [],
  },

  // ═══════════════════════════ REEFKIN — BATTLECRIES ══════════════════════════
  {
    id: 'reefkin_tidecaller',
    name: 'Tidecaller Initiate',
    tribe: 'reefkin',
    tier: 1,
    atk: 2,
    hp: 1,
    keywords: [],
    axis: ['battlecries'],
    text: `Battlecry: give a friendly Reefkin +${R.battlecryChainAtk}/+${R.battlecryChainHp}.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', filterTribe: 'reefkin', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: R.battlecryChainAtk, hp: R.battlecryChainHp, permanent: true }],
      },
    ],
  },
  {
    // ✏️ redesign: poison stat-stick → spreads poison on death (DEATHS splash).
    id: 'reefkin_spinefish',
    name: 'Spinefish',
    tribe: 'reefkin',
    tier: 1,
    atk: 2,
    hp: 1,
    keywords: ['poison'],
    axis: ['deaths'],
    text: 'Poison. Deathrattle: give a random friendly minion Poison.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'randomAlly', excludeSelf: true },
        actions: [{ type: 'grantKeyword', keyword: 'poison' }],
      },
    ],
  },
  {
    // ⭐ ENDURE break: rewards surviving the shield hit.
    id: 'reefkin_pearlguard',
    name: 'Pearlguard',
    tribe: 'reefkin',
    tier: 2,
    atk: 2,
    hp: 3,
    keywords: ['divineShield', 'taunt'],
    axis: ['endure'],
    text: `Divine Shield. Taunt. When its Shield breaks: give your board +${bp('reefkin_pearlguard').atk}/+${bp('reefkin_pearlguard').hp}.`,
    effects: [
      {
        trigger: { type: 'onShieldBreak' },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: bp('reefkin_pearlguard').atk, hp: bp('reefkin_pearlguard').hp, permanent: false }],
      },
    ],
  },
  {
    id: 'reefkin_brineling',
    name: 'Brineling',
    tribe: 'reefkin',
    tier: 2,
    atk: 2,
    hp: 2,
    keywords: [],
    axis: ['battlecries'],
    text: 'Battlecry: give a friendly minion Poison.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [{ type: 'grantKeyword', keyword: 'poison' }],
      },
    ],
  },
  {
    id: 'reefkin_coralwarden',
    name: 'Coral Warden',
    tribe: 'reefkin',
    tier: 3,
    atk: 2,
    hp: 3,
    keywords: [],
    axis: ['battlecries', 'endure'],
    text: 'Battlecry: give a friendly minion Divine Shield and Taunt.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [
          { type: 'grantKeyword', keyword: 'divineShield' },
          { type: 'grantKeyword', keyword: 'taunt' },
        ],
      },
    ],
  },
  {
    id: 'reefkin_deepsinger',
    name: 'Deepsinger',
    tribe: 'reefkin',
    tier: 3,
    atk: 2,
    hp: 2,
    keywords: [],
    axis: ['battlecries'],
    text: `Battlecry: give a friendly minion +${R.megabuffAtk}/+${R.megabuffHp}.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: R.megabuffAtk, hp: R.megabuffHp, permanent: R.megabuffPersists }],
      },
    ],
  },
  {
    // ⭐ marquee BATTLECRY break.
    id: 'reefkin_chorustide',
    name: 'Chorus Tide',
    tribe: 'reefkin',
    tier: 3,
    atk: 2,
    hp: 3,
    keywords: [],
    axis: ['battlecries'],
    text: `Battlecry: if you've played ${bp('reefkin_chorustide').threshold}+ battlecries this turn, give your board +${bp('reefkin_chorustide').atk}/+${bp('reefkin_chorustide').hp}.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        condition: { kind: 'battlecriesThisTurnAtLeast', value: bp('reefkin_chorustide').threshold },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: bp('reefkin_chorustide').atk, hp: bp('reefkin_chorustide').hp, permanent: true }],
      },
    ],
  },
  {
    id: 'reefkin_echochoir',
    name: 'Echo Choir',
    tribe: 'reefkin',
    tier: 4,
    atk: 3,
    hp: 5,
    keywords: [],
    axis: ['battlecries'],
    text: `Your battlecries trigger ${R.battlecryTriggerMultiplier}× (capped). Doubled triggers still count toward battlecry breakpoints.`,
    effects: [],
    auras: [
      {
        scope: 'yourBattlecries',
        modifier: { kind: 'triggerMultiplier', value: R.battlecryTriggerMultiplier },
        stacks: R.battlecryDoublerStacks,
      },
    ],
  },
  {
    // 🔶 bridge → Revenants: plants a deathrattle on a friendly minion.
    id: 'reefkin_reefmourner',
    name: 'Reefmourner',
    tribe: 'reefkin',
    tier: 4,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['battlecries', 'deaths'],
    text: `Battlecry: give a friendly minion "Deathrattle: give your board +${R.plantedDeathrattleAtk}/+${R.plantedDeathrattleHp}".`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [{ type: 'plantDeathrattle', planted: PLANTED_DEATHRATTLE }],
      },
    ],
  },
  {
    id: 'reefkin_tideprophet',
    name: 'Tide Prophet',
    tribe: 'reefkin',
    tier: 5,
    atk: 5,
    hp: 5,
    keywords: [],
    axis: ['battlecries'],
    text: 'Battlecry: give your Reefkin +2/+2.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'allAllies', filterTribe: 'reefkin', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 2, hp: 2, permanent: true }],
      },
    ],
  },
  {
    // ✏️⭐ redesign: vanilla → ENDURE capstone gated on the BATTLECRY axis.
    id: 'reefkin_leviathan',
    name: 'Reef Leviathan',
    tribe: 'reefkin',
    tier: 6,
    atk: 6,
    hp: 6,
    keywords: ['divineShield', 'taunt'],
    axis: ['battlecries', 'endure'],
    text: `Divine Shield. Taunt. Battlecry: if you've played ${bp('reefkin_leviathan').threshold}+ battlecries this turn, give your Reefkin Divine Shield.`,
    effects: [
      {
        // Phase 4 rebalance (decision #51): the Divine Shield grant is scoped to REEFKIN (filterTribe),
        // no longer the whole board — the capstone rewards a committed Reefkin line, not any splash body.
        trigger: { type: 'battlecry' },
        condition: { kind: 'battlecriesThisTurnAtLeast', value: bp('reefkin_leviathan').threshold },
        target: { selector: 'allAllies', filterTribe: 'reefkin' },
        actions: [{ type: 'grantKeyword', keyword: bp('reefkin_leviathan').grantKeyword }],
      },
    ],
  },

  {
    // ⭐ NEW audit build-around (Endorsed Pattern A — tribal win-condition scalar). Each battlecry you
    // play buys one +1/+1 for the tribe: paid per cast (a card + gold + slot), uncapped but earned. The
    // buffed Reefkin board is medium-wide → folds to POISON (a touch kills each, ignoring the +1/+1) and
    // CLEAVE (clustered bodies). Fires on `afterFriendlyBattlecry` (another friendly battlecry resolved).
    id: 'reefkin_tidebinder',
    name: 'Tidebinder',
    tribe: 'reefkin',
    tier: 4,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['battlecries'],
    text: 'After you play another battlecry this turn, give your Reefkin +1/+1 (permanent).',
    effects: [
      {
        trigger: { type: 'afterFriendlyBattlecry' },
        target: { selector: 'allAllies', filterTribe: 'reefkin' },
        actions: [{ type: 'buffStats', atk: 1, hp: 1, permanent: true }],
      },
    ],
  },

  // ═══════════════════════════ INFERNALS — SACRIFICE (risk) ════════════════════
  // A risk engine (reference engines 10 & 12): pay HP / spend your own bodies at START OF
  // COMBAT for a live burst. Nothing is baked — the sacrifice/self-buff fires from base
  // stats inside combat, so the fragility is real. Tensions vs ENDURE (spend vs preserve)
  // and SWARM (eats tokens for height); bridges DEATHS (manufactures friendly deaths) but
  // plays as an AGGRESSOR that ends narrow — its counters are poison (ignores the swelled
  // carry) and width (you thinned yourself). No new keyword/handler: all declarative.
  {
    // self-damage-for-scaling (engine 10): pay 1 HP → +attack. A fragile tempo body.
    id: 'infernals_cinderling',
    name: 'Cinderling',
    tribe: 'infernals',
    tier: 1,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['sacrifice'],
    text: `Start of combat: take ${I.selfDamageHpCost} damage, then gain +${I.selfDamageBuffAtk} Attack.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'self' },
        actions: [
          { type: 'dealDamage', amount: I.selfDamageHpCost },
          { type: 'buffStats', atk: I.selfDamageBuffAtk, permanent: false },
        ],
      },
    ],
  },
  {
    // sacrifice FUEL + DEATHS bridge: dying (or being sacrificed) pumps the board's attack.
    id: 'infernals_gravebrand',
    name: 'Gravebrand',
    tribe: 'infernals',
    tier: 2,
    atk: 2,
    hp: 2,
    keywords: [],
    axis: ['sacrifice', 'deaths'],
    text: 'Deathrattle: give your other minions +2 Attack.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'allAllies', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 2, permanent: false }],
      },
    ],
  },
  {
    // sacrifice payoff (engine 12): consume your weakest body → the sacrificer swells.
    id: 'infernals_hollowpriest',
    name: 'Hollow Priest',
    tribe: 'infernals',
    tier: 2,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['sacrifice'],
    text: `Start of combat: destroy your lowest-Attack other minion; gain +${I.sacrificeBuffAtk}/+${I.sacrificeBuffHp}.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'lowestStatAlly', stat: 'atk', excludeSelf: true },
        actions: [{ type: 'destroy' }], // D11: destroy lowest-Attack ally; the self-buff below is unconditional
      },
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'self' },
        actions: [{ type: 'buffStats', atk: I.sacrificeBuffAtk, hp: I.sacrificeBuffHp, permanent: false }],
      },
    ],
  },
  {
    // second sacrificer — stacking them manufactures the friendly deaths the ⭐ carries want.
    id: 'infernals_pyrewalker',
    name: 'Pyrewalker',
    tribe: 'infernals',
    tier: 3,
    atk: 4,
    hp: 4,
    keywords: [],
    axis: ['sacrifice'],
    text: `Start of combat: destroy your lowest-Attack other minion; gain +${I.sacrificeBuffAtk}/+${I.sacrificeBuffHp}.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'lowestStatAlly', stat: 'atk', excludeSelf: true },
        actions: [{ type: 'destroy' }],
      },
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'self' },
        actions: [{ type: 'buffStats', atk: I.sacrificeBuffAtk, hp: I.sacrificeBuffHp, permanent: false }],
      },
    ],
  },
  {
    // ⭐ SACRIFICE breakpoint carry — pays off on manufactured deaths (a step, not a line).
    id: 'infernals_bloodcaller',
    name: 'Bloodcaller',
    tribe: 'infernals',
    tier: 3,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['sacrifice', 'deaths'],
    text: `At ${bp('infernals_bloodcaller').threshold}+ friendly deaths this combat: gain +${bp('infernals_bloodcaller').atk}/+${bp('infernals_bloodcaller').hp} (once).`,
    effects: [
      {
        trigger: { type: 'afterFriendlyDeaths', threshold: bp('infernals_bloodcaller').threshold, everyN: false },
        target: { selector: 'self' },
        actions: [{ type: 'buffStats', atk: bp('infernals_bloodcaller').atk, hp: bp('infernals_bloodcaller').hp, permanent: false }],
      },
    ],
  },
  {
    // big sacrifice engine + a death payoff of its own (pays the board when IT dies).
    id: 'infernals_dreadmaw',
    name: 'Dreadmaw',
    tribe: 'infernals',
    tier: 4,
    atk: 5,
    hp: 6,
    keywords: [],
    axis: ['sacrifice', 'deaths'],
    text: `Start of combat: destroy your lowest-Attack other minion; gain +${I.sacrificeBuffAtk}/+${I.sacrificeBuffHp}. Deathrattle: give your board +2/+2.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'lowestStatAlly', stat: 'atk', excludeSelf: true },
        actions: [{ type: 'destroy' }],
      },
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'self' },
        actions: [{ type: 'buffStats', atk: I.sacrificeBuffAtk, hp: I.sacrificeBuffHp, permanent: false }],
      },
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'allAllies', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 2, hp: 2, permanent: false }],
      },
    ],
  },
  {
    // ⭐ SACRIFICE capstone — a glass cannon that, once enough have died, swings wide.
    id: 'infernals_abysslord',
    name: 'Abysslord',
    tribe: 'infernals',
    tier: 5,
    atk: 6,
    hp: 7,
    keywords: [],
    axis: ['sacrifice', 'deaths'],
    text: `At ${bp('infernals_abysslord').threshold}+ friendly deaths this combat: gain +${bp('infernals_abysslord').atk}/+${bp('infernals_abysslord').hp} and Cleave (once).`,
    effects: [
      {
        trigger: { type: 'afterFriendlyDeaths', threshold: bp('infernals_abysslord').threshold, everyN: false },
        target: { selector: 'self' },
        actions: [
          { type: 'buffStats', atk: bp('infernals_abysslord').atk, hp: bp('infernals_abysslord').hp, permanent: false },
          { type: 'grantKeyword', keyword: 'cleave' },
        ],
      },
    ],
  },

  {
    // Phase 3 CONSUMPTION — the proactive sacrifice body. Battlecry: eat a chosen friendly, keeping its
    // stats. Absorb reads LIVE stats (a golden target contributes its doubled stats), keywords do NOT
    // transfer. Increments the PERSISTENT lifetimeFriendlyDeaths (a shop-phase destroy). Clean-room:
    // renamed from the working title "Gluttonous Maw" to the clearly-original compound "Gorgemaw".
    id: 'infernals_gorgemaw',
    name: 'Gorgemaw',
    tribe: 'infernals',
    tier: 4,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['sacrifice'],
    text: 'Battlecry: destroy another friendly minion and permanently gain its Attack and Health.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        // absorb BEFORE destroy (reads the target's live stats, then consumes it) — identical outcome
        // to "destroy then absorb"; this order is re-entrancy-safe under an Echo-Choir double.
        actions: [{ type: 'absorbStats' }, { type: 'destroyAlly' }],
      },
    ],
  },
  {
    // Phase 3 CONSUMPTION — a GO-TALL reward: at ≤4 minions, concentrate the board into the leftmost
    // threat (+4/+4 and Taunt, THIS COMBAT). A pure combat buff (permanent:false) — the §7.5 writeback
    // must NOT pick it up. Countered by wide boards (it never fires above the threshold) and by poison.
    // Clean-room: renamed from the working title "Lone Vanguard" to the original compound "Cindermarshal".
    id: 'infernals_cindermarshal',
    name: 'Cindermarshal',
    tribe: 'infernals',
    tier: 4,
    atk: 4,
    hp: 5,
    keywords: [],
    axis: ['sacrifice'],
    text: `Start of combat: if you have ${I.loneVanguardAllyThreshold} or fewer minions, give your leftmost minion +${I.loneVanguardBuffAtk}/+${I.loneVanguardBuffHp} and Taunt this combat.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'alliesAtMost', value: I.loneVanguardAllyThreshold },
        target: { selector: 'leftmostAlly' },
        actions: [
          { type: 'buffStats', atk: I.loneVanguardBuffAtk, hp: I.loneVanguardBuffHp, permanent: false },
          { type: 'grantKeyword', keyword: 'taunt' },
        ],
      },
    ],
  },
  {
    // ⭐ NEW audit capstone (Infernals T6 — fills the missing top-end + Endorsed Pattern A death scalar).
    // Each friendly death pumps your surviving Infernals; Infernals MANUFACTURE those deaths by spending
    // their own width (Hollow Priest/Pyrewalker/Dreadmaw), so every increment is a spent body. Combat-only
    // by design (explicit permanent:false since #38) → no free permanence; re-earned each fight. The line ends FEW + TALL, so it folds to
    // POISON (a touch kills the giant survivor, ignoring the buff) and a WIDE board out-actions 2-3 bodies.
    id: 'infernals_carrionsovereign',
    name: 'Carrion Sovereign',
    tribe: 'infernals',
    tier: 6,
    atk: 7,
    hp: 8,
    keywords: [],
    axis: ['sacrifice', 'deaths'],
    text: `After a friendly minion dies, give your Infernals +${bp('infernals_carrionsovereign').atk}/+${bp('infernals_carrionsovereign').hp} (this combat).`,
    effects: [
      {
        trigger: { type: 'afterFriendlyDeaths', threshold: bp('infernals_carrionsovereign').threshold, everyN: true },
        target: { selector: 'allAllies', filterTribe: 'infernals' },
        actions: [{ type: 'buffStats', atk: bp('infernals_carrionsovereign').atk, hp: bp('infernals_carrionsovereign').hp, permanent: false }],
      },
    ],
  },
  {
    // ⭐ Phase 7 SACRIFICE PERSISTENT ceiling — Soulglutton (decision #75). Infernals' pre-Phase-7 payoffs were ALL
    // this-combat or one-time (Gorgemaw's single eat), so the "few+tall" carry could never reach a very-high TOTAL.
    // This is the first PERMANENT death payoff: at 3+ friendly deaths this combat (once), the carry PERMANENTLY gains
    // +6/+6 — permanent:true, so the §7.5 writeback folds it onto the SURVIVING instance and it carries across combats.
    // Each combat where you manufacture 3+ sacrifices adds one chunk → the carry grows TALL over the whole game through
    // MANY EARNED STEPS (each death is a spent body), never one multiply. Taunt so it is the front wall that tanks + survives
    // to fold its buff; still folds HARD to poison (a touch kills the giant, stat-agnostic) and to a wide board.
    id: 'infernals_soulglutton',
    name: 'Soulglutton',
    tribe: 'infernals',
    tier: 6,
    atk: 6,
    hp: 9,
    keywords: ['taunt'],
    axis: ['sacrifice', 'deaths'],
    text: `Taunt. The FIRST time ${bp('infernals_soulglutton').threshold}+ friendly minions die in a combat, permanently gain +${bp('infernals_soulglutton').atk}/+${bp('infernals_soulglutton').hp}.`,
    effects: [
      {
        trigger: { type: 'afterFriendlyDeaths', threshold: bp('infernals_soulglutton').threshold, everyN: false },
        target: { selector: 'self' },
        actions: [{ type: 'buffStats', atk: bp('infernals_soulglutton').atk, hp: bp('infernals_soulglutton').hp, permanent: true }],
      },
    ],
  },

  // ═══════════════════════════ CONSTRUCTS — ASSEMBLY (redeploy) ═════════════════
  // Graceful degradation (reference engine 24): bodies leave Scrap on death and the board
  // reassembles at breakpoints, so it is hard to fully CLEAR — the answer to cleave/burst and
  // to swarm. Its counters are poison (kills each body regardless of the refill; the few
  // one-shot shields only stop the first instance and the scrap is unshielded) and going TALL
  // (a single big body punches through the small redeployed chaff before the board rebuilds).
  // Tensions vs ENDURE (Reefkin shields) and DEATHS (Revenants) for the durability/dying slots.
  // All declarative: deathrattle→summon + a keyword-grant trickle. No new keyword/handler.
  {
    id: 'constructs_scrapling',
    name: 'Scrapling',
    tribe: 'constructs',
    tier: 1,
    atk: 2,
    hp: 1,
    keywords: [],
    isToken: true,
    axis: ['assembly'],
    text: 'Token.',
    effects: [],
  },
  {
    id: 'constructs_sentinel',
    name: 'Sentinel',
    tribe: 'constructs',
    tier: 4,
    atk: 6,
    hp: 6,
    keywords: ['taunt'],
    isToken: true,
    axis: ['assembly', 'endure'],
    text: 'Token. Taunt.',
    effects: [],
  },
  {
    id: 'constructs_cogling',
    name: 'Cogling',
    tribe: 'constructs',
    tier: 1,
    atk: 2,
    hp: 2,
    keywords: [],
    axis: ['assembly', 'deaths'],
    text: 'Deathrattle: summon a Scrapling.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: 'constructs_scrapling', summonCount: 1 }],
      },
    ],
  },
  {
    // sticky shielded wall body: absorbs one hit, then leaves a body behind.
    id: 'constructs_bulwark',
    name: 'Bulwark',
    tribe: 'constructs',
    tier: 2,
    atk: 2,
    hp: 4,
    keywords: ['taunt', 'divineShield'],
    axis: ['assembly', 'endure'],
    text: 'Taunt. Divine Shield. Deathrattle: summon a Scrapling.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: 'constructs_scrapling', summonCount: 1 }],
      },
    ],
  },
  {
    id: 'constructs_reclaimer',
    name: 'Reclaimer',
    tribe: 'constructs',
    tier: 3,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['assembly', 'deaths'],
    text: 'Deathrattle: summon two Scraplings.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: 'constructs_scrapling', summonCount: 2 }],
      },
    ],
  },
  {
    // shield-redeploy trickle: hands its shield forward on death (a thin ENDURE bridge,
    // deliberately single-target so it is a trickle, not a poison-proof wall).
    id: 'constructs_shielddrone',
    name: 'Shield Drone',
    tribe: 'constructs',
    tier: 3,
    atk: 3,
    hp: 3,
    keywords: ['divineShield'],
    axis: ['assembly', 'endure'],
    text: 'Divine Shield. Deathrattle: give a random other friendly Divine Shield.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'randomAlly', excludeSelf: true },
        actions: [{ type: 'grantKeyword', keyword: 'divineShield' }],
      },
    ],
  },
  {
    // ⭐ ASSEMBLY rebuild capstone — reassembles a big guardian once the board has bled.
    id: 'constructs_foundry',
    name: 'Foundry',
    tribe: 'constructs',
    tier: 4,
    atk: 4,
    hp: 5,
    keywords: [],
    axis: ['assembly', 'deaths'],
    text: `Deathrattle: if ${bp('constructs_foundry').threshold}+ friendlies died this combat, summon a 6/6 Taunt Sentinel.`,
    effects: [
      {
        trigger: { type: 'deathrattle' },
        condition: { kind: 'deathsThisCombatAtLeast', value: bp('constructs_foundry').threshold },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: bp('constructs_foundry').summonUnitId, summonCount: bp('constructs_foundry').summonCount }],
      },
    ],
  },
  {
    // ⭐ ASSEMBLY capstone — a WIDE board assembles a guardian at start of combat.
    id: 'constructs_titanforge',
    name: 'Titanforge',
    tribe: 'constructs',
    tier: 5,
    atk: 6,
    hp: 8,
    keywords: ['taunt'],
    axis: ['assembly', 'endure'],
    text: `Taunt. Start of combat: if you control ${bp('constructs_titanforge').threshold}+ minions, summon a 6/6 Taunt Sentinel.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'countAllies', value: bp('constructs_titanforge').threshold },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: bp('constructs_titanforge').summonUnitId, summonCount: bp('constructs_titanforge').summonCount }],
      },
    ],
  },

  {
    // ⭐ NEW audit tech (the SECOND structural answer to TALL, besides poison). Poison ignores size by
    // KILLING; Nullforge ignores size by DELETING the size — at start of combat it strips the enemy's
    // biggest minion back to its printed stats (a 2000/2000 doubler → its base 8/8), which the board can
    // then fight normally. A single draftable, stat-agnostic tech: dead vs a wide board, live vs tall —
    // a read-the-lobby pick, never an auto-include.
    id: 'constructs_nullforge',
    name: 'Nullforge',
    tribe: 'constructs',
    tier: 4,
    atk: 4,
    hp: 5,
    keywords: [],
    axis: ['assembly'],
    text: "Start of combat: reduce the enemy's highest-Attack minion to its printed stats (strip its buffs).",
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'highestStatEnemy', stat: 'atk' },
        actions: [{ type: 'resetToBase' }],
      },
    ],
  },
  {
    // ⭐ NEW audit capstone (Constructs T6 — fills the missing top-end + Endorsed Pattern A redeploy
    // scalar). Each friendly death pumps the surviving Constructs (the die-and-rebuild loop IS the fuel);
    // combat-only by design (explicit permanent:false since #38) → no free permanence. Deathrattle rebuilds a guardian. Folds to POISON (kills each
    // rebuilt body regardless) + TALL (a big body punches through the small chaff before it rebuilds).
    id: 'constructs_aegisprime',
    name: 'Aegis Prime',
    tribe: 'constructs',
    tier: 6,
    atk: 6,
    hp: 8,
    keywords: ['taunt'],
    axis: ['assembly', 'deaths'],
    text: `Taunt. After a friendly minion dies, give your Constructs +${bp('constructs_aegisprime').atk}/+${bp('constructs_aegisprime').hp} (this combat). Deathrattle: summon a 6/6 Taunt Sentinel.`,
    effects: [
      {
        trigger: { type: 'afterFriendlyDeaths', threshold: bp('constructs_aegisprime').threshold, everyN: true },
        target: { selector: 'allAllies', filterTribe: 'constructs' },
        actions: [{ type: 'buffStats', atk: bp('constructs_aegisprime').atk, hp: bp('constructs_aegisprime').hp, permanent: false }],
      },
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: 'constructs_sentinel', summonCount: 1 }],
      },
    ],
  },

  // ─── Constructs MAGNETIC merge (Phase 5, decision #54 — reserved keyword → live) ────────────────
  // A magnetic minion may be MERGED into a friendly Construct during the shop (the `merge` intent):
  // the tower PERMANENTLY gains the magnetic unit's current stats + keywords and the magnetic unit is
  // CONSUMED (not a death/sell; pool copy does not return, like a triple). Optional — magnetic units also
  // play standalone. A go-tall CONSOLIDATION tool; folds to POISON (one-shots the tower, stat-agnostic),
  // Nullforge (strips the merged stats back to print), and WIDTH (one tall body is out-actioned). Per-unit
  // merge cap = engines.constructs.magneticMergeCap (discrete → breakpoint law #22). No new keyword/handler.
  {
    id: 'constructs_boltfitter',
    name: 'Boltfitter',
    tribe: 'constructs',
    tier: 2,
    atk: 2,
    hp: 2,
    keywords: ['magnetic'],
    axis: ['assembly'],
    text: 'Magnetic. (Play it, or merge it into a friendly Construct to hand over its stats.)',
    effects: [],
  },
  {
    id: 'constructs_alloyrig',
    name: 'Alloy Rig',
    tribe: 'constructs',
    tier: 4,
    atk: 4,
    hp: 4,
    keywords: ['magnetic', 'divineShield'],
    axis: ['assembly', 'endure'],
    text: 'Magnetic. Divine Shield. (Merge to hand a Construct its stats AND Divine Shield.)',
    effects: [],
  },
  {
    id: 'constructs_omegachassis',
    name: 'Omega Chassis',
    tribe: 'constructs',
    tier: 5,
    atk: 5,
    hp: 5,
    keywords: ['magnetic', 'taunt'],
    axis: ['assembly', 'endure'],
    text: 'Magnetic. Taunt. (Merge to hand a Construct its stats AND Taunt.)',
    effects: [],
  },
  {
    // Phase 6 (#68) — smallest magnetic FODDER. Fills the T1 rung of the magnetic ladder so a magnetic
    // build is reachable EARLY and every shop offers more merge fuel: a cheap body to merge for raw stats
    // (or play standalone). More sources → the boardMerges tiers (Magnaforge 3/6/9) become reachable. It
    // grants no keyword — pure stat fodder; the Magnaforge payoff, not the tower height, is the scaling.
    id: 'constructs_rivetling',
    name: 'Rivetling',
    tribe: 'constructs',
    tier: 1,
    atk: 2,
    hp: 1,
    keywords: ['magnetic'],
    axis: ['assembly'],
    text: 'Magnetic. (Play it, or merge it into a friendly Construct for its stats.)',
    effects: [],
  },
  {
    // Phase 6 (#68) — mid-tier magnetic FODDER, filling the T3 rung (between Boltfitter T2 and Alloy Rig
    // T4). A bigger raw-stat merge body for the mid-game; no extra keyword (raw stats), so it feeds the
    // boardMerges count + tower height without duplicating Alloy Rig's Divine-Shield niche.
    id: 'constructs_coilcore',
    name: 'Coilcore',
    tribe: 'constructs',
    tier: 3,
    atk: 4,
    hp: 3,
    keywords: ['magnetic'],
    axis: ['assembly'],
    text: 'Magnetic. (Play it, or merge it into a friendly Construct for its stats.)',
    effects: [],
  },
  {
    // ⭐ NEW (Phase 6, decision #68) — the BOARD-WIDE MAGNETIC capstone (Constructs T6). Magnetic used to
    // be single-carry ONLY (merge into one tower, go-tall). Magnaforge turns assembled merges into a
    // WHOLE-BOARD payoff: a TIERED breakpoint on `boardMerges` (total merges across your board, carried in
    // on the CombatBoard scalar — Ossuary Titan pattern) fires one cumulative +Atk/+Health to your
    // Constructs per crossed milestone (3/6/9), THIS COMBAT (permanent:false — the §7.5 writeback must NOT
    // fold it; re-earned each fight). Numbers live in breakpoints.ts.tiers (escalating 3/3→5/5→8/8, ≥1.5×).
    // It is itself the ideal merge TARGET (a big Taunt base), so the tall-tower line and the wide-payoff
    // line share one body. High ceiling by MANY EARNED STEPS (each merge is a bought+consumed body), never
    // a single multiply. Folds to POISON (one-shots any pumped body), CLEAVE (mows the board), Nullforge
    // (strips the permanent merged towers beneath the buff), and WIDTH (a this-combat buff still dies).
    id: 'constructs_magnaforge',
    name: 'Magnaforge',
    tribe: 'constructs',
    tier: 6,
    atk: 6,
    hp: 8,
    keywords: ['taunt'],
    axis: ['assembly'],
    text: `Taunt. Start of combat: for every magnetic-merge milestone across your board (${bp('constructs_magnaforge').tiers!.map((t) => t.threshold).join('/')}), give your Constructs an escalating +Atk/+Health this combat. MAGNETIC capstone.`,
    effects: bp('constructs_magnaforge').tiers!.map(
      (tier): Effect => ({
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'boardMergesAtLeast', value: tier.threshold },
        target: { selector: 'allAllies', filterTribe: 'constructs' },
        actions: [{ type: 'buffStats', atk: tier.atk, hp: tier.hp, permanent: false }],
      }),
    ),
  },
  {
    // ⭐ NEW (Phase 5, decision #55) — the persistent Sentinel modifier. Each Forgemaster you PLAY adds a
    // GAME-LONG +1/+1 stack to every FUTURE Sentinel at its combat creation (Foundry/Titanforge/Aegis).
    // The stack SURVIVES this Forgemaster's sale/death (a lifetime per-copy-played counter). Modeled as a
    // `yourSentinels`/`statBuffOnEvent` aura MARKER (a persistent-counter marker, NOT a board-read passive —
    // §6.4): playUnit reads the marker to bump the private `forgemastersPlayed` counter, which rides into
    // combat on the CombatBoard scalar. Folds to POISON/TALL exactly like the Sentinels it buffs.
    id: 'constructs_forgemaster',
    name: 'Forgemaster',
    tribe: 'constructs',
    tier: 4,
    atk: 3,
    hp: 5,
    keywords: [],
    axis: ['assembly'],
    text: `Your Sentinels have +${engines.constructs.forgemasterSentinelBuff}/+${engines.constructs.forgemasterSentinelBuff}, this game (stacks per Forgemaster played).`,
    effects: [],
    auras: [{ scope: 'yourSentinels', modifier: { kind: 'statBuffOnEvent', value: engines.constructs.forgemasterSentinelBuff } }],
  },

  // ═══════════════════════════ TUSKERS — SPOILS (purchased doubler, decision #39) ═══
  // Gem greed: hoard SPENDABLE gems each shop turn, then BUY doubles for a carry. The
  // doubler is an ACTIVATED ability (once per turn per minion): pay the shared escalating
  // per-game price (doubleBaseCost + doubleCostStep × doubles already purchased) to
  // multiply the carry ×doublerFactor (≤ multiplyFactorCap). The exponential reach
  // (thousands of stats) comes ONLY from buying steps across turns (it writes to the
  // persistent instance, so it compounds), never from an uncapped single multiply — and
  // every step is a real DECISION against the gem sinks (Gemwright/Facetguard/Oreseeker).
  // This is the game's tall/amp region: strong when unopposed, but every gain is stat
  // SIZE, which POISON ignores (P1) — the structural counter — and a doubled single carry
  // is also out-actioned by width. Tensions vs ENDURE/TALL for the carry slot.
  {
    id: 'tuskers_gemsnout',
    name: 'Gemsnout',
    tribe: 'tuskers',
    tier: 1,
    atk: 2,
    hp: 3,
    keywords: [],
    axis: ['spoils'],
    text: `End of turn: gain ${T.gemBaseValue} gem.`,
    effects: [
      {
        trigger: { type: 'endOfTurn' },
        target: { selector: 'self' },
        actions: [{ type: 'giveGem', amount: T.gemBaseValue }],
      },
    ],
  },
  {
    id: 'tuskers_tuskhoarder',
    name: 'Tuskhoarder',
    tribe: 'tuskers',
    tier: 2,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['spoils'],
    text: `End of turn: gain ${T.gemBaseValue} gem.`,
    effects: [
      {
        trigger: { type: 'endOfTurn' },
        target: { selector: 'self' },
        actions: [{ type: 'giveGem', amount: T.gemBaseValue }],
      },
    ],
  },
  {
    id: 'tuskers_grubtusk',
    name: 'Grubtusk',
    tribe: 'tuskers',
    tier: 2,
    atk: 2,
    hp: 4,
    keywords: ['taunt'],
    axis: ['spoils', 'endure'],
    text: `Taunt. End of turn: gain ${T.gemBaseValue} gem.`,
    effects: [
      {
        trigger: { type: 'endOfTurn' },
        target: { selector: 'self' },
        actions: [{ type: 'giveGem', amount: T.gemBaseValue }],
      },
    ],
  },
  {
    // ⭐ THE doubler — a carry you PAY to double (spend-gated, decision #39; escalating shared cost).
    id: 'tuskers_ivorytusk',
    name: 'Ivorytusk',
    tribe: 'tuskers',
    tier: 3,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['spoils'],
    text: `Once per turn: spend gems (${T.doubleBaseCost}, +${T.doubleCostStep} per double you've bought this game) to permanently DOUBLE this minion's stats (×${T.doublerFactor}). Compounds across turns.`,
    effects: [],
    activated: {
      cost: 'doublerEscalating',
      target: { selector: 'self' },
      actions: [{ type: 'multiplyStats', factor: T.doublerFactor }],
    },
  },
  {
    // ✏️ decision #39 rework: Goldgrin is now a pure gem battlecry (its old chosenAlly
    // +2/+2 + Divine Shield rider moved behind Facetguard's GEM COST — the poison-counterplay
    // purchase lives there now, priced in gems instead of bundled free with the tempo body).
    id: 'tuskers_goldgrin',
    name: 'Goldgrin',
    tribe: 'tuskers',
    tier: 3,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['spoils'],
    text: `Battlecry: gain ${T.goldgrinGems} gems.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'self' },
        actions: [{ type: 'giveGem', amount: T.goldgrinGems }],
      },
    ],
  },
  {
    // NEW (decision #39) — THE gem→gold bridge, and deliberately the ONLY one, one-way
    // (gold can never buy gems). Turns a hoard into tempo at a lossy rate; goldCap-clamped.
    id: 'tuskers_gemwright',
    name: 'Gemwright',
    tribe: 'tuskers',
    tier: 3,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['spoils'],
    text: `Once per turn: spend ${T.gemwrightCost} gems to gain ${T.gemwrightGold} gold (never above the gold cap).`,
    effects: [],
    activated: {
      cost: T.gemwrightCost,
      target: { selector: 'self' },
      actions: [{ type: 'gainGold', amount: T.gemwrightGold }],
    },
  },
  {
    // NEW (decision #39) — the purchased poison-counterplay body (took over Goldgrin's old
    // free rider). Reuses the chosenAlly pendingTarget machinery: activate → pick a friendly.
    id: 'tuskers_facetguard',
    name: 'Facetguard',
    tribe: 'tuskers',
    tier: 3,
    atk: 2,
    hp: 5,
    keywords: ['taunt'],
    axis: ['spoils', 'endure'],
    text: `Taunt. Once per turn: spend ${T.facetguardCost} gems to give a friendly minion +${T.gemDumpPayoffAtk}/+${T.gemDumpPayoffHp} and Divine Shield.`,
    effects: [],
    activated: {
      cost: T.facetguardCost,
      target: { selector: 'chosenAlly' },
      actions: [
        { type: 'buffStats', atk: T.gemDumpPayoffAtk, hp: T.gemDumpPayoffHp, permanent: true },
        { type: 'grantKeyword', keyword: 'divineShield' },
      ],
      prompt: 'choose a friendly minion to shield',
    },
  },
  {
    // NEW (decision #39) — gem-paid shop tempo: a FREE refresh (same seeded draw path as a
    // paid roll; clears a freeze exactly like rolling does). Renamed from the generic
    // "Prospector" to the clearly-original compound "Oreseeker" (clean-room §0).
    id: 'tuskers_oreseeker',
    name: 'Oreseeker',
    tribe: 'tuskers',
    tier: 2,
    atk: 2,
    hp: 3,
    keywords: [],
    axis: ['spoils'],
    text: `Once per turn: spend ${T.oreseekerCost} gems to refresh the shop for free.`,
    effects: [],
    activated: {
      cost: T.oreseekerCost,
      target: { selector: 'self' },
      actions: [{ type: 'refreshShop' }],
    },
  },
  {
    id: 'tuskers_warhoard',
    name: 'Warhoard',
    tribe: 'tuskers',
    tier: 4,
    atk: 5,
    hp: 6,
    keywords: ['taunt'],
    axis: ['spoils', 'endure'],
    text: `Taunt. End of turn: gain ${T.gemBaseValue} gem. Deathrattle: give your board +2/+2.`,
    effects: [
      {
        trigger: { type: 'endOfTurn' },
        target: { selector: 'self' },
        actions: [{ type: 'giveGem', amount: T.gemBaseValue }],
      },
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'allAllies', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 2, hp: 2, permanent: false }],
      },
    ],
  },
  {
    // ⭐ second doubler — a durable Taunt carry (harder to remove before it snowballs).
    id: 'tuskers_ivorylord',
    name: 'Ivorylord',
    tribe: 'tuskers',
    tier: 5,
    atk: 5,
    hp: 7,
    keywords: ['taunt'],
    axis: ['spoils', 'endure'],
    text: `Taunt. Once per turn: spend gems (${T.doubleBaseCost}, +${T.doubleCostStep} per double you've bought this game) to permanently DOUBLE this minion's stats (×${T.doublerFactor}).`,
    effects: [],
    activated: {
      cost: 'doublerEscalating',
      target: { selector: 'self' },
      actions: [{ type: 'multiplyStats', factor: T.doublerFactor }],
    },
  },
  {
    // ⭐ SPOILS capstone — a Taunt doubler. Terrifying if unanswered; poison ends it.
    id: 'tuskers_gemtitan',
    name: 'Gemtitan',
    tribe: 'tuskers',
    tier: 6,
    atk: 8,
    hp: 8,
    keywords: ['taunt'],
    axis: ['spoils'],
    text: `Taunt. Battlecry: gain ${T.gemtitanGems} gems. Once per turn: spend gems (${T.doubleBaseCost}, +${T.doubleCostStep} per double you've bought this game) to permanently DOUBLE this minion's stats (×${T.doublerFactor}). A tall carry — poison ignores its size.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'self' },
        actions: [{ type: 'giveGem', amount: T.gemtitanGems }],
      },
    ],
    activated: {
      cost: 'doublerEscalating',
      target: { selector: 'self' },
      actions: [{ type: 'multiplyStats', factor: T.doublerFactor }],
    },
  },

  {
    // ⭐ NEW audit build-around (Endorsed Pattern B — sell a body for gems, the flavor-perfect Tusker
    // fuel). Each sale costs a whole friendly body (self-limiting; you thin your board), turning the
    // passive gem stream into an active decision that fuels the PURCHASED doubler wallet (decision #39;
    // there is no gemsThisTurn breakpoint anymore). The gems only build a single tall carry → folds to
    // POISON (size-agnostic) + a wide board out-tempos the board you sold down. Fires on `onSell`.
    id: 'tuskers_tuskmonger',
    name: 'Tuskmonger',
    tribe: 'tuskers',
    tier: 3,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['spoils'],
    text: `After you sell another friendly minion, gain ${T.tuskmongerGems} gems.`,
    effects: [
      {
        trigger: { type: 'onSell' },
        target: { selector: 'self' },
        actions: [{ type: 'giveGem', amount: T.tuskmongerGems }],
      },
    ],
  },

  // ═══════════════════════════ PRIMORDIALS — ELEMENTS (wide cleave) ═════════════════
  // Play-count → WIDE cleave splash. The go-wide answer to swarm and to clustered boards,
  // and the exemplar the web must keep beatable by TALL (a lone big body starves cleave of
  // neighbours to splash) and by poison (cleavers die to a chip). Tensions vs SWARM (both
  // want board width) and CLEAVE-tech (Wildkin). All declarative: cleave keyword + one-shot
  // play buffs + gated board buffs / a board-wide cleave grant.
  {
    id: 'primordials_sparkling',
    name: 'Sparkling',
    tribe: 'primordials',
    tier: 1,
    atk: 2,
    hp: 2,
    keywords: [],
    axis: ['elements'],
    text: `Battlecry: give a friendly minion +${P.elementalPlayBuffAtk} Attack.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: P.elementalPlayBuffAtk, permanent: true }],
      },
    ],
  },
  {
    id: 'primordials_gustling',
    name: 'Gustling',
    tribe: 'primordials',
    tier: 2,
    atk: 3,
    hp: 2,
    keywords: ['cleave'],
    axis: ['elements'],
    text: 'Cleave.',
    effects: [],
  },
  {
    id: 'primordials_tideling',
    name: 'Tideling',
    tribe: 'primordials',
    tier: 2,
    atk: 2,
    hp: 3,
    keywords: [],
    axis: ['elements'],
    text: 'Battlecry: give your other minions +1 Attack.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'allAllies', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 1, permanent: true }],
      },
    ],
  },
  {
    // ⭐ ELEMENTS breakpoint — a play-count board buff (BATTLECRIES axis bridge).
    id: 'primordials_stormcaller',
    name: 'Stormcaller',
    tribe: 'primordials',
    tier: 3,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['elements', 'battlecries'],
    text: `Battlecry: if you've played ${bp('primordials_stormcaller').threshold}+ battlecries this turn, give your board +${bp('primordials_stormcaller').atk}/+${bp('primordials_stormcaller').hp}.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        condition: { kind: 'battlecriesThisTurnAtLeast', value: bp('primordials_stormcaller').threshold },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: bp('primordials_stormcaller').atk, hp: bp('primordials_stormcaller').hp, permanent: true }],
      },
    ],
  },
  {
    id: 'primordials_cinderwing',
    name: 'Cinderwing',
    tribe: 'primordials',
    tier: 3,
    atk: 4,
    hp: 4,
    keywords: ['cleave'],
    axis: ['elements'],
    text: 'Cleave.',
    effects: [],
  },
  {
    // ⭐ ELEMENTS breakpoint — going WIDE arms the whole board's attack (combat-fired).
    id: 'primordials_tempest',
    name: 'Tempest',
    tribe: 'primordials',
    tier: 4,
    atk: 5,
    hp: 5,
    keywords: ['cleave'],
    axis: ['elements'],
    text: `Cleave. Start of combat: if you control ${bp('primordials_tempest').threshold}+ minions, give your minions +${bp('primordials_tempest').atk} Attack.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'countAllies', value: bp('primordials_tempest').threshold },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: bp('primordials_tempest').atk, permanent: false }],
      },
    ],
  },
  {
    id: 'primordials_thunderhead',
    name: 'Thunderhead',
    tribe: 'primordials',
    tier: 5,
    atk: 6,
    hp: 6,
    keywords: ['cleave', 'taunt'],
    axis: ['elements', 'endure'],
    text: 'Cleave. Taunt. Battlecry: give your other minions +1/+1.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'allAllies', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 1, hp: 1, permanent: true }],
      },
    ],
  },
  {
    // ⭐ ELEMENTS capstone — a WIDE board turns the WHOLE line into cleavers. Brutal vs wide;
    //    wasted into a tall board; the cleavers still die to poison.
    id: 'primordials_worldspark',
    name: 'Worldspark',
    tribe: 'primordials',
    tier: 6,
    atk: 7,
    hp: 8,
    keywords: ['cleave'],
    axis: ['elements'],
    text: `Cleave. Start of combat: if you control ${bp('primordials_worldspark').threshold}+ minions, give your minions Cleave.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'countAllies', value: bp('primordials_worldspark').threshold },
        target: { selector: 'allAllies' },
        actions: [{ type: 'grantKeyword', keyword: bp('primordials_worldspark').grantKeyword }],
      },
    ],
  },
  {
    // ⭐ Phase 7 ELEMENTS scaling capstone — Elderstorm (decision #72). The old Primordials ceiling was the
    // WEAKEST of the nine: only shop-turn / go-wide one-shots, no PERSISTENT axis. This turns every element
    // CHANNELLED over the game into a WHOLE-BOARD payoff: a TIERED breakpoint on the persistent `elementsPlayed`
    // counter (rides in on the CombatBoard scalar; incremented in shop.playUnit per Primordial played). One
    // cumulative board-wide buff to your Primordials per crossed tier at start of combat, THIS COMBAT ONLY
    // (permanent:false). A step, not a line — mirrors Magnaforge but on a lifetime PLAY counter. Numbers live
    // in breakpoints.ts.tiers. Cleave body so the buffed wide line splashes; still folds to poison + tall.
    id: 'primordials_elderstorm',
    name: 'Elderstorm',
    tribe: 'primordials',
    tier: 6,
    atk: 6,
    hp: 8,
    keywords: ['cleave'],
    axis: ['elements'],
    text: `Cleave. Start of combat: for every element-played milestone this game (${bp('primordials_elderstorm').tiers!.map((t) => t.threshold).join('/')}), give your Primordials an escalating +Atk/+Health this combat. ELEMENTS capstone.`,
    effects: bp('primordials_elderstorm').tiers!.map(
      (tier): Effect => ({
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'elementsPlayedAtLeast', value: tier.threshold },
        target: { selector: 'allAllies', filterTribe: 'primordials' },
        actions: [{ type: 'buffStats', atk: tier.atk, hp: tier.hp, permanent: false }],
      }),
    ),
  },

  // ═══════════════════════════ SIRENS — SPELLCRAFT (poison + burst) ═════════════════
  // A SECOND poison home (the counter is load-bearing, so more reachable poison boards
  // enrich the web) plus start-of-combat burst. Poison ignores stat size (P1) → the answer
  // to TALL / amp / the Tusker doubler; its own counter is a divine-shield WALL (a shield
  // blanks the first poison instance, P2) and being out-tempo'd before it connects. Tensions
  // vs ENDURE (shields it wants to bypass) and against Tuskers/TALL directly. All declarative:
  // poison keyword + grant-poison + start-of-combat dealDamage. No spell system needed.
  {
    id: 'sirens_lurefish',
    name: 'Lurefish',
    tribe: 'sirens',
    tier: 1,
    atk: 2,
    hp: 2,
    keywords: ['poison'],
    axis: ['spellcraft'],
    text: 'Poison.',
    effects: [],
  },
  {
    id: 'sirens_reefwitch',
    name: 'Reefwitch',
    tribe: 'sirens',
    tier: 2,
    atk: 2,
    hp: 3,
    keywords: [],
    axis: ['spellcraft'],
    text: 'Battlecry: give a friendly minion Poison.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [{ type: 'grantKeyword', keyword: 'poison' }],
      },
    ],
  },
  {
    id: 'sirens_sirenling',
    name: 'Sirenling',
    tribe: 'sirens',
    tier: 2,
    atk: 3,
    hp: 2,
    keywords: [],
    axis: ['spellcraft'],
    text: `Start of combat: deal ${S.burstDamage} damage to the front enemy.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'frontEnemy' },
        actions: [{ type: 'dealDamage', amount: S.burstDamage }],
      },
    ],
  },
  {
    id: 'sirens_venomsong',
    name: 'Venomsong',
    tribe: 'sirens',
    tier: 3,
    atk: 3,
    hp: 3,
    keywords: ['poison'],
    axis: ['spellcraft', 'deaths'],
    text: 'Poison. Deathrattle: give a random friendly minion Poison.',
    effects: [
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'randomAlly', excludeSelf: true },
        actions: [{ type: 'grantKeyword', keyword: 'poison' }],
      },
    ],
  },
  {
    // ⭐ SPELLCRAFT breakpoint — a battlecry payoff that arms a poison carry.
    id: 'sirens_deepchanter',
    name: 'Deepchanter',
    tribe: 'sirens',
    tier: 3,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['spellcraft', 'battlecries'],
    text: `Battlecry: if you've played ${bp('sirens_deepchanter').threshold}+ battlecries this turn, give a friendly minion Poison and +${bp('sirens_deepchanter').atk}/+${bp('sirens_deepchanter').hp}.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        condition: { kind: 'battlecriesThisTurnAtLeast', value: bp('sirens_deepchanter').threshold },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [
          { type: 'grantKeyword', keyword: 'poison' },
          { type: 'buffStats', atk: bp('sirens_deepchanter').atk, hp: bp('sirens_deepchanter').hp, permanent: true },
        ],
      },
    ],
  },
  {
    id: 'sirens_tempestsinger',
    name: 'Tempestsinger',
    tribe: 'sirens',
    tier: 4,
    atk: 4,
    hp: 5,
    keywords: ['poison'],
    axis: ['spellcraft'],
    text: `Poison. Start of combat: deal ${S.burstDamage} damage to the front enemy.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'frontEnemy' },
        actions: [{ type: 'dealDamage', amount: S.burstDamage }],
      },
    ],
  },
  {
    // ⭐ SPELLCRAFT breakpoint — board-wide Poison at a battlecry threshold (folds to shields).
    id: 'sirens_abysscantor',
    name: 'Abysscantor',
    tribe: 'sirens',
    tier: 5,
    atk: 5,
    hp: 6,
    keywords: [],
    axis: ['spellcraft', 'battlecries'],
    text: `Battlecry: if you've played ${bp('sirens_abysscantor').threshold}+ battlecries this turn, give your Sirens Poison.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        condition: { kind: 'battlecriesThisTurnAtLeast', value: bp('sirens_abysscantor').threshold },
        target: { selector: 'allAllies', filterTribe: 'sirens', excludeSelf: true },
        actions: [{ type: 'grantKeyword', keyword: 'poison' }],
      },
    ],
  },
  {
    // ⭐ SPELLCRAFT capstone — a poison body that also pumps + spreads at the breakpoint.
    id: 'sirens_leviathansong',
    name: 'Leviathansong',
    tribe: 'sirens',
    tier: 6,
    atk: 6,
    hp: 7,
    keywords: ['poison'],
    axis: ['spellcraft', 'battlecries'],
    text: `Poison. Battlecry: if you've played ${bp('sirens_leviathansong').threshold}+ battlecries this turn, give your board +${bp('sirens_leviathansong').atk}/+${bp('sirens_leviathansong').hp} and a random friendly minion Poison.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        condition: { kind: 'battlecriesThisTurnAtLeast', value: bp('sirens_leviathansong').threshold },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: bp('sirens_leviathansong').atk, hp: bp('sirens_leviathansong').hp, permanent: true }],
      },
      {
        trigger: { type: 'battlecry' },
        condition: { kind: 'battlecriesThisTurnAtLeast', value: bp('sirens_leviathansong').threshold },
        target: { selector: 'randomAlly', excludeSelf: true },
        actions: [{ type: 'grantKeyword', keyword: 'poison' }],
      },
    ],
  },

  {
    // ⭐ NEW audit build-around (Endorsed Pattern B — sacrifice a body for a poison alpha). Each combat you
    // spend one body to arm your Sirens with Poison for the fight: combat-only, so it re-costs a body EVERY
    // combat (no free permanence) — a real "sell the body for the poison alpha vs keep it" decision, and a
    // poison payoff that DOESN'T need a battlecry gate (unlike Abysscantor). Folds to divine-SHIELD WALLS
    // (each poison hit's first instance is blanked) and being out-tempo'd before it connects.
    id: 'sirens_maelstromcantor',
    name: 'Maelstrom Cantor',
    tribe: 'sirens',
    tier: 5,
    atk: 4,
    hp: 5,
    keywords: ['poison'],
    axis: ['spellcraft'],
    text: 'Poison. Start of combat: destroy your lowest-Attack other minion, then give your Sirens Poison this combat.',
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'lowestStatAlly', stat: 'atk', excludeSelf: true },
        actions: [{ type: 'destroy' }],
      },
      {
        trigger: { type: 'startOfCombat' },
        target: { selector: 'allAllies', filterTribe: 'sirens' },
        actions: [{ type: 'grantKeyword', keyword: 'poison' }],
      },
    ],
  },
  {
    // ⭐ Phase 7 POISON-COVERAGE capstone — Venomtide (decision #77). Sirens stays deliberately STAT-AGNOSTIC
    // (decision #1): its scaling is measured in COVERAGE/REACH — more CONNECTING poison bodies — NOT stat totals.
    // At a WIDE board (alliesAtStart≥6) it gives your Sirens Cleave this combat; because a poison attacker's cleave
    // carries POISON to the splashed neighbours (combat `attackerPoison`), a wide poison board (innate poison +
    // Abysscantor's board-poison) poisons the WHOLE enemy row per swing — the poison REACHES past the shielded front
    // to the bodies beside/behind it. Coverage scales with the number of poison bodies (each becomes a 3-wide poison-
    // cleaver), never with stats. Same primitive as Worldspark, different PURPOSE (poison delivery, not damage splash);
    // this-combat only. Counter UNCHANGED: divine-SHIELD walls blank each poison instance (shield MORE to survive), and
    // the fragile low-stat Sirens are out-tempo'd if walled. Its own body carries Poison so it is a cleaver too.
    id: 'sirens_venomtide',
    name: 'Venomtide',
    tribe: 'sirens',
    tier: 6,
    atk: 5,
    hp: 7,
    keywords: ['poison'],
    axis: ['spellcraft'],
    text: `Poison. Start of combat: if you control ${bp('sirens_venomtide').threshold}+ minions, give your Sirens Cleave (so your poison splashes the enemy row). SPELLCRAFT capstone.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'countAllies', value: bp('sirens_venomtide').threshold },
        target: { selector: 'allAllies', filterTribe: 'sirens' },
        actions: [{ type: 'grantKeyword', keyword: bp('sirens_venomtide').grantKeyword }],
      },
    ],
  },

  // ═══════════════════════════ CORSAIRS — TEMPO (reborn + shields) ══════════════════
  // On-buy aggression → sticky width: cheap REBORN bodies and divine SHIELDS that trade up,
  // buffed wide by on-play attack. Its width is the counter to a lone tall body, but folds to
  // POISON (kills each reborn body on the return too — a chip beats "comes back at 1 HP") and
  // to CLEAVE (mows the clustered small bodies). Tensions vs SWARM (both go wide) and vs
  // DEATHS/ENDURE for the reborn/shield slots. All declarative: keywords + one-shot / gated buffs.
  {
    id: 'corsairs_swab',
    name: 'Swab',
    tribe: 'corsairs',
    tier: 1,
    atk: 2,
    hp: 1,
    keywords: ['reborn'],
    axis: ['tempo'],
    text: 'Reborn.',
    effects: [],
  },
  {
    id: 'corsairs_deckhand',
    name: 'Deckhand',
    tribe: 'corsairs',
    tier: 1,
    atk: 3,
    hp: 2,
    keywords: [],
    axis: ['tempo'],
    text: `Battlecry: give a friendly minion +${C.onBuyBuffAtk + 1} Attack.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: C.onBuyBuffAtk + 1, permanent: true }],
      },
    ],
  },
  {
    id: 'corsairs_ironclad',
    name: 'Ironclad',
    tribe: 'corsairs',
    tier: 2,
    atk: 2,
    hp: 4,
    keywords: ['divineShield', 'taunt'],
    axis: ['tempo', 'endure'],
    text: 'Divine Shield. Taunt.',
    effects: [],
  },
  {
    // Phase 4 POSITIONAL card (decision #52; clean-room §0 — "Vanguard Pennant" is original, no
    // reference-game card of this name). A cheap standard-bearer whose `leftmost` aura (§6.4) hands
    // the FRONT minion +C.leftmostAttackBuff attack. Query-at-read-time, so it rewards positioning
    // your biggest body left / benefits whoever inherits the front when the leftmost dies mid-fight.
    id: 'corsairs_pennant',
    name: 'Vanguard Pennant',
    tribe: 'corsairs',
    tier: 2,
    atk: 1,
    hp: 4,
    keywords: [],
    axis: ['tempo'],
    text: `Your leftmost minion has +${C.leftmostAttackBuff} Attack.`,
    effects: [],
    auras: [{ scope: 'leftmost', modifier: { kind: 'attackBuff', value: C.leftmostAttackBuff } }],
  },
  {
    id: 'corsairs_cutthroat',
    name: 'Cutthroat',
    tribe: 'corsairs',
    tier: 2,
    atk: 3,
    hp: 3,
    keywords: ['reborn'],
    axis: ['tempo', 'deaths'],
    text: 'Reborn. Battlecry: give your other minions +1 Attack.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'allAllies', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 1, permanent: true }],
      },
    ],
  },
  {
    id: 'corsairs_stormrider',
    name: 'Stormrider',
    tribe: 'corsairs',
    tier: 3,
    atk: 4,
    hp: 3,
    keywords: ['divineShield'],
    axis: ['tempo', 'endure'],
    text: 'Divine Shield. Battlecry: give a friendly minion Divine Shield.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [{ type: 'grantKeyword', keyword: 'divineShield' }],
      },
    ],
  },
  {
    // ⭐ TEMPO breakpoint — going wide arms the board's attack (combat-fired).
    id: 'corsairs_reaver',
    name: 'Reaver',
    tribe: 'corsairs',
    tier: 3,
    atk: 3,
    hp: 4,
    keywords: ['reborn'],
    axis: ['tempo'],
    text: `Reborn. Start of combat: if you control ${bp('corsairs_reaver').threshold}+ minions, give your minions +${bp('corsairs_reaver').atk} Attack.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'countAllies', value: bp('corsairs_reaver').threshold },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: bp('corsairs_reaver').atk, permanent: false }],
      },
    ],
  },
  {
    // ⭐ TEMPO breakpoint — a bigger wide-board arm (combat-fired).
    id: 'corsairs_marauder',
    name: 'Marauder',
    tribe: 'corsairs',
    tier: 4,
    atk: 5,
    hp: 5,
    keywords: ['reborn'],
    axis: ['tempo'],
    text: `Reborn. Start of combat: if you control ${bp('corsairs_marauder').threshold}+ minions, give your minions +${bp('corsairs_marauder').atk}/+${bp('corsairs_marauder').hp}.`,
    effects: [
      {
        trigger: { type: 'startOfCombat' },
        condition: { kind: 'countAllies', value: bp('corsairs_marauder').threshold },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: bp('corsairs_marauder').atk, hp: bp('corsairs_marauder').hp, permanent: false }],
      },
    ],
  },
  {
    id: 'corsairs_seaqueen',
    name: 'Sea Queen',
    tribe: 'corsairs',
    tier: 5,
    atk: 5,
    hp: 6,
    keywords: ['divineShield', 'taunt'],
    axis: ['tempo', 'endure'],
    text: 'Divine Shield. Taunt. Battlecry: give your other minions +2 Attack; give a friendly minion Reborn.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'allAllies', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 2, permanent: true }],
      },
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [{ type: 'grantKeyword', keyword: 'reborn' }],
      },
    ],
  },
  {
    // TEMPO capstone — a sticky, wide-buffing Reborn cleaver. Big, but poison/cleave answer it.
    id: 'corsairs_dreadnought',
    name: 'Dreadnought',
    tribe: 'corsairs',
    tier: 6,
    atk: 7,
    hp: 7,
    keywords: ['reborn', 'cleave'],
    axis: ['tempo'],
    text: 'Reborn. Cleave. Battlecry: give your board +2/+1.',
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: 2, hp: 1, permanent: true }],
      },
    ],
  },
  {
    // ⭐ NEW audit build-around (Endorsed Pattern B — sell a body for sticky tempo). Each +2/+2 costs a
    // whole body sold PLUS the gold you paid to buy it (sell refund < buy cost), so the permanence is paid
    // twice over and self-limiting. The buffed reborn/shield width folds to POISON (kills each reborn body
    // on its return too) + CLEAVE (mows the clustered width). Fires on `onSell` (another friendly was sold).
    id: 'corsairs_quartermaster',
    name: 'Quartermaster',
    tribe: 'corsairs',
    tier: 4,
    atk: 4,
    hp: 4,
    keywords: ['reborn'],
    axis: ['tempo'],
    text: 'Reborn. After you sell another friendly minion, give your highest-Attack Corsair +2/+2 (permanent).',
    effects: [
      {
        trigger: { type: 'onSell' },
        target: { selector: 'highestStatAlly', stat: 'atk', filterTribe: 'corsairs' },
        actions: [{ type: 'buffStats', atk: 2, hp: 2, permanent: true }],
      },
    ],
  },

  // ─── Corsairs GOLD economy (Phase 5, decision #56 — gold ONLY; gold/gems stay separate) ──────────
  // Four tempo-economy bodies: delayed gold (Bursar), a raised sell refund (Fence), conditional
  // delayed gold (Moneylender), and a raised gold cap (Vault Keeper). Every number is a config knob.
  // A buy(3g)/sell(≤2g) churn STRICTLY loses gold, so no loop mints infinite money; gems (Tuskmonger)
  // stay a separate currency (the ONLY bridge remains Gemwright, gems→gold, one-way).
  {
    id: 'corsairs_bursar',
    name: 'Bursar',
    tribe: 'corsairs',
    tier: 2,
    atk: 2,
    hp: 2,
    keywords: [],
    axis: ['tempo'],
    text: `Battlecry: gain ${C.bursarGold} gold at the start of your next turn.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'self' },
        actions: [{ type: 'gainGoldNextTurn', amount: C.bursarGold }],
      },
    ],
  },
  {
    id: 'corsairs_fence',
    name: 'Fence',
    tribe: 'corsairs',
    tier: 3,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['tempo'],
    text: `Your minions sell for ${C.fenceSellRefund} gold.`,
    effects: [],
    auras: [{ scope: 'yourEconomy', modifier: { kind: 'sellRefundSet', value: C.fenceSellRefund } }],
  },
  {
    id: 'corsairs_moneylender',
    name: 'Moneylender',
    tribe: 'corsairs',
    tier: 3,
    atk: 2,
    hp: 4,
    keywords: [],
    axis: ['tempo'],
    text: `End of turn: if you have ${C.moneylenderThreshold}+ unspent gold, gain ${C.moneylenderGold} gold next turn.`,
    effects: [],
    auras: [{ scope: 'yourEconomy', modifier: { kind: 'goldNextTurnIfRich', value: C.moneylenderGold } }],
  },
  {
    id: 'corsairs_vaultkeeper',
    name: 'Vault Keeper',
    tribe: 'corsairs',
    tier: 4,
    atk: 3,
    hp: 5,
    keywords: ['taunt'],
    axis: ['tempo', 'endure'],
    text: `Taunt. While on your board, your gold cap is ${C.vaultKeeperGoldCap}.`,
    effects: [],
    auras: [{ scope: 'yourEconomy', modifier: { kind: 'goldCapSet', value: C.vaultKeeperGoldCap } }],
  },
  {
    // ⭐ Phase 7 TEMPO/GOLD scaling capstone — Prizemaster (decision #73). Corsairs' pre-Phase-7 ceiling was
    // the low-stat TEMPO/reborn+shields identity + a gold ECONOMY (Vault Keeper/Fence/Moneylender/Bursar)
    // with NO stat payoff — gold could only buy tempo, never scale a carry. This is the first SPEND-GATED
    // GOLD lever (§6.6a, §11.3c's second legal payoff class): once per turn, spend gold to permanently pump a
    // chosen Corsair. Distinct from the Tuskers gem-doublers on every axis — GOLD not gems, ADDITIVE +5/+5 not
    // a ×2 multiply (so it folds to poison, never a multiplyFactorCap concern), a CHOSEN carry not self. The
    // high ceiling is EARNED + CAPPED: each +5/+5 is bought with gold you'd otherwise spend on tempo/tiering,
    // one per turn, and how many you can afford scales with the gold ECONOMY (Vault Keeper's raised cap funds
    // more). Reborn so the pump survives a combat to keep compounding; still folds to poison-that-connects
    // (one-shots the carry regardless of size; a second poison kills the reborn return) and to removal/cleave.
    id: 'corsairs_prizemaster',
    name: 'Prizemaster',
    tribe: 'corsairs',
    tier: 6,
    atk: 5,
    hp: 7,
    keywords: ['reborn'],
    axis: ['tempo', 'endure'],
    text: `Reborn. Once per turn: spend ${C.prizemasterCost} gold to give a friendly Corsair +${C.prizemasterBuffAtk}/+${C.prizemasterBuffHp} permanently.`,
    effects: [],
    activated: {
      cost: C.prizemasterCost,
      currency: 'gold',
      target: { selector: 'chosenAlly', filterTribe: 'corsairs' },
      actions: [{ type: 'buffStats', atk: C.prizemasterBuffAtk, hp: C.prizemasterBuffHp, permanent: true }],
      prompt: 'choose a Corsair to reward with plunder',
    },
  },
];

// ── Catalog index helpers ────────────────────────────────────────────────────
export const UNIT_BY_ID: Record<string, UnitCard> = Object.fromEntries(
  UNITS.map((u) => [u.id, u]),
);

export function getCard(id: string): UnitCard {
  const c = UNIT_BY_ID[id];
  if (!c) throw new Error(`Unknown unit card: ${id}`);
  return c;
}

/** Purchasable (non-token) cards, the shop pool source. */
export const PURCHASABLE_UNITS: UnitCard[] = UNITS.filter((u) => !u.isToken);
