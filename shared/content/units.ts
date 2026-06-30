import type { Effect, UnitCard } from '../types';
import { engines } from '../config/engines';
import { getBreakpoint as bp } from '../config/breakpoints';

const W = engines.wildkin;
const R = engines.reefkin;
const V = engines.revenants;

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
    text: `End of turn: summon a Thornpup.`,
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
    // ✏️⭐ redesign: per-token amp → a pure tokens-this-turn breakpoint (decision #25 redline).
    id: 'wildkin_motherthorn',
    name: 'Mother Thorn',
    tribe: 'wildkin',
    tier: 3,
    atk: 3,
    hp: 4,
    keywords: [],
    axis: ['swarm'],
    text: `Once you've summoned ${bp('wildkin_motherthorn').threshold}+ tokens this turn: summoned tokens get +${bp('wildkin_motherthorn').tokenAtk}/+${bp('wildkin_motherthorn').tokenHp}, and at end of turn your board gets +${bp('wildkin_motherthorn').atk}/+${bp('wildkin_motherthorn').hp}.`,
    effects: [
      {
        trigger: { type: 'onSummon' },
        condition: { kind: 'tokensSummonedThisTurnAtLeast', value: bp('wildkin_motherthorn').threshold },
        target: { selector: 'triggerSource' },
        actions: [{ type: 'buffStats', atk: bp('wildkin_motherthorn').tokenAtk, hp: bp('wildkin_motherthorn').tokenHp, permanent: true }],
      },
      {
        trigger: { type: 'endOfTurn' },
        condition: { kind: 'tokensSummonedThisTurnAtLeast', value: bp('wildkin_motherthorn').threshold },
        target: { selector: 'allAllies' },
        actions: [{ type: 'buffStats', atk: bp('wildkin_motherthorn').atk, hp: bp('wildkin_motherthorn').hp, permanent: true }],
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
    id: 'wildkin_grovelord',
    name: 'Grovelord',
    tribe: 'wildkin',
    tier: 6,
    atk: 8,
    hp: 9,
    keywords: [],
    axis: ['swarm'],
    text: `End of turn: summon ${W.tokensPerTurn * 3} Thornpups (×Grovecaller). SWARM capstone.`,
    effects: [
      {
        trigger: { type: 'endOfTurn' },
        target: { selector: 'self' },
        actions: [{ type: 'summon', summonUnitId: 'wildkin_thornpup', summonCount: W.tokensPerTurn * 3 }],
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
