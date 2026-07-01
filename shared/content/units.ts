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

// Reefmourner's planted deathrattle (§16.3 #5) — board buff on the host's death.
const PLANTED_DEATHRATTLE: Effect = {
  trigger: { type: 'deathrattle' },
  target: { selector: 'allAllies', excludeSelf: true },
  actions: [{ type: 'buffStats', atk: R.plantedDeathrattleAtk, hp: R.plantedDeathrattleHp }],
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
        actions: [{ type: 'buffStats', atk: W.tokenDeathFloorAtk }],
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
        actions: [{ type: 'buffStats', atk: bp('wildkin_thornwarden').atk, hp: bp('wildkin_thornwarden').hp }],
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
        actions: [{ type: 'buffStats', atk: W.avengePayoffAtk, hp: W.avengePayoffHp }],
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
        actions: [{ type: 'buffStats', atk: W.tokenDeathFloorAtk }],
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
        actions: [{ type: 'buffStats', atk: bp('wildkin_grovelord').atk, hp: bp('wildkin_grovelord').hp }],
      },
    ],
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
        // this-combat buff: combat-fired deathrattles don't persist across combats (writeback gap),
        // so flagging permanent was a no-op lie — kept honest as a this-combat buff.
        trigger: { type: 'deathrattle' },
        target: { selector: 'randomAlly', filterTribe: 'revenants', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 1, hp: 1 }],
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
        // this-combat buff (combat-fired deathrattle — does not persist; see Cryptling note above).
        trigger: { type: 'deathrattle' },
        target: { selector: 'highestStatAlly', stat: 'hp', filterTribe: 'revenants', excludeSelf: true },
        actions: [{ type: 'buffStats', hp: V.deathPayoffHp }],
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
        actions: [{ type: 'buffStats', atk: 1, hp: 1 }],
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
        actions: [{ type: 'buffStats', atk: bp('revenants_mortarch').atk, hp: bp('revenants_mortarch').hp }],
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
        actions: [{ type: 'buffStats', atk: 1, hp: 1 }],
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
        actions: [{ type: 'buffStats', atk: bp('reefkin_pearlguard').atk, hp: bp('reefkin_pearlguard').hp }],
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
    text: `Divine Shield. Taunt. Battlecry: if you've played ${bp('reefkin_leviathan').threshold}+ battlecries this turn, give your whole board Divine Shield.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        condition: { kind: 'battlecriesThisTurnAtLeast', value: bp('reefkin_leviathan').threshold },
        target: { selector: 'allAllies' },
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
          { type: 'buffStats', atk: I.selfDamageBuffAtk },
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
        actions: [{ type: 'buffStats', atk: 2 }],
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
        actions: [{ type: 'buffStats', atk: I.sacrificeBuffAtk, hp: I.sacrificeBuffHp }],
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
        actions: [{ type: 'buffStats', atk: I.sacrificeBuffAtk, hp: I.sacrificeBuffHp }],
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
        actions: [{ type: 'buffStats', atk: bp('infernals_bloodcaller').atk, hp: bp('infernals_bloodcaller').hp }],
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
        actions: [{ type: 'buffStats', atk: I.sacrificeBuffAtk, hp: I.sacrificeBuffHp }],
      },
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'allAllies', excludeSelf: true },
        actions: [{ type: 'buffStats', atk: 2, hp: 2 }],
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
          { type: 'buffStats', atk: bp('infernals_abysslord').atk, hp: bp('infernals_abysslord').hp },
          { type: 'grantKeyword', keyword: 'cleave' },
        ],
      },
    ],
  },

  {
    // ⭐ NEW audit capstone (Infernals T6 — fills the missing top-end + Endorsed Pattern A death scalar).
    // Each friendly death pumps your surviving Infernals; Infernals MANUFACTURE those deaths by spending
    // their own width (Hollow Priest/Pyrewalker/Dreadmaw), so every increment is a spent body. Combat-only
    // (writeback gap) → no free permanence; re-earned each fight. The line ends FEW + TALL, so it folds to
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
        actions: [{ type: 'buffStats', atk: bp('infernals_carrionsovereign').atk, hp: bp('infernals_carrionsovereign').hp }],
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
    // combat-only → no free permanence. Deathrattle rebuilds a guardian. Folds to POISON (kills each
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
        actions: [{ type: 'buffStats', atk: bp('constructs_aegisprime').atk, hp: bp('constructs_aegisprime').hp }],
      },
      {
        trigger: { type: 'deathrattle' },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: 'constructs_sentinel', summonCount: 1 }],
      },
    ],
  },

  // ═══════════════════════════ TUSKERS — SPOILS (exponential doubler) ═══════════════
  // Gem greed: hoard gems each shop turn, then DOUBLE a carry at a gem breakpoint. The
  // doubler's per-application factor is CAPPED (×2 ≤ multiplyFactorCap) — the exponential
  // reach (thousands of stats) comes ONLY from applying it across turns (it writes to the
  // persistent instance, so it compounds), never from an uncapped single multiply. This is
  // the game's tall/amp region: strong when unopposed, but every gain is stat SIZE, which
  // POISON ignores (P1) — so a stat-agnostic chip is the structural counter, and a doubled
  // single carry is also out-actioned by width. Tensions vs ENDURE/TALL for the carry slot.
  // All declarative: gem generators (endOfTurn giveGem) + the gated multiplyStats doubler.
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
    // ⭐ THE doubler — a carry that doubles itself every turn you hoard enough gems.
    id: 'tuskers_ivorytusk',
    name: 'Ivorytusk',
    tribe: 'tuskers',
    tier: 3,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['spoils'],
    text: `End of turn: if you gained ${bp('tuskers_ivorytusk').threshold}+ gems this turn, DOUBLE this minion's stats (×${bp('tuskers_ivorytusk').factor}). Compounds across turns.`,
    effects: [
      {
        trigger: { type: 'endOfTurn' },
        condition: { kind: 'gemsThisTurnAtLeast', value: bp('tuskers_ivorytusk').threshold },
        target: { selector: 'self' },
        actions: [{ type: 'multiplyStats', factor: bp('tuskers_ivorytusk').factor }],
      },
    ],
  },
  {
    // ✏️ audit fix (tall counter-web): Goldgrin now also grants Divine Shield to the buffed carry, so
    // Tuskers can BUY poison counterplay — a shield blanks the FIRST poison instance (combat.ts), letting
    // a doubled carry survive the opening touch and connect. Paid with a card, and poison-in-depth (a
    // second source) still gets through, so the counter survives. This is the "see it coming, have an out".
    id: 'tuskers_goldgrin',
    name: 'Goldgrin',
    tribe: 'tuskers',
    tier: 3,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['spoils', 'endure'],
    text: `Battlecry: gain 2 gems, then give a friendly minion +${T.gemDumpPayoffAtk}/+${T.gemDumpPayoffHp} and Divine Shield.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'self' },
        actions: [{ type: 'giveGem', amount: 2 }],
      },
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'chosenAlly', excludeSelf: true },
        actions: [
          { type: 'buffStats', atk: T.gemDumpPayoffAtk, hp: T.gemDumpPayoffHp, permanent: true },
          { type: 'grantKeyword', keyword: 'divineShield' },
        ],
      },
    ],
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
        actions: [{ type: 'buffStats', atk: 2, hp: 2 }],
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
    text: `Taunt. End of turn: if you gained ${bp('tuskers_ivorylord').threshold}+ gems this turn, DOUBLE this minion's stats (×${bp('tuskers_ivorylord').factor}).`,
    effects: [
      {
        trigger: { type: 'endOfTurn' },
        condition: { kind: 'gemsThisTurnAtLeast', value: bp('tuskers_ivorylord').threshold },
        target: { selector: 'self' },
        actions: [{ type: 'multiplyStats', factor: bp('tuskers_ivorylord').factor }],
      },
    ],
  },
  {
    // ⭐ SPOILS capstone — a Taunt+Cleave doubler. Terrifying if unanswered; poison ends it.
    id: 'tuskers_gemtitan',
    name: 'Gemtitan',
    tribe: 'tuskers',
    tier: 6,
    atk: 8,
    hp: 8,
    keywords: ['taunt'],
    axis: ['spoils'],
    text: `Taunt. Battlecry: gain 3 gems. End of turn: if you gained ${bp('tuskers_gemtitan').threshold}+ gems this turn, DOUBLE this minion's stats (×${bp('tuskers_gemtitan').factor}). A tall carry — poison ignores its size.`,
    effects: [
      {
        trigger: { type: 'battlecry' },
        target: { selector: 'self' },
        actions: [{ type: 'giveGem', amount: 3 }],
      },
      {
        trigger: { type: 'endOfTurn' },
        condition: { kind: 'gemsThisTurnAtLeast', value: bp('tuskers_gemtitan').threshold },
        target: { selector: 'self' },
        actions: [{ type: 'multiplyStats', factor: bp('tuskers_gemtitan').factor }],
      },
    ],
  },

  {
    // ⭐ NEW audit build-around (Endorsed Pattern B — sell a body for gems, the flavor-perfect Tusker
    // fuel). Each 2 gems costs a whole friendly body sold (self-limiting; you thin your board), turning
    // the passive gem stream into an active decision that feeds the doubler's gemsThisTurn breakpoint.
    // The gems only build a single tall carry → folds to POISON (size-agnostic) + a wide board out-tempos
    // the board you sold down. Fires on `onSell` (another friendly was sold this shop turn).
    id: 'tuskers_tuskmonger',
    name: 'Tuskmonger',
    tribe: 'tuskers',
    tier: 3,
    atk: 3,
    hp: 3,
    keywords: [],
    axis: ['spoils'],
    text: 'After you sell another friendly minion, gain 2 gems.',
    effects: [
      {
        trigger: { type: 'onSell' },
        target: { selector: 'self' },
        actions: [{ type: 'giveGem', amount: 2 }],
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
        actions: [{ type: 'buffStats', atk: bp('primordials_tempest').atk }],
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
        actions: [{ type: 'buffStats', atk: bp('corsairs_reaver').atk }],
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
        actions: [{ type: 'buffStats', atk: bp('corsairs_marauder').atk, hp: bp('corsairs_marauder').hp }],
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
