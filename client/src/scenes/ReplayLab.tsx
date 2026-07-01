// ReplayLab — DEV-ONLY harness (activated by URL hash #replay-lab) for auditing/iterating on the
// combat replay animations in isolation. It builds real boards through the shared engine and calls
// the pure `resolveCombat` to get an authentic CombatEvent[], then renders <CombatReplay/>. NOT part
// of the shipped app flow — it's a workbench so the §10 game-feel work doesn't require driving a
// full Colyseus match to reach combat. Multiple canned matchups exercise strikes, cleave, divine
// shield, taunt, reborn/deathrattle summons, and poison.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { makeInstance, toCombatBoard, resolveCombat, type CombatBoard, type UnitInstance } from '@cardgame/shared';
import { CombatReplay } from './CombatReplay';

interface Entry {
  cardId: string;
  count?: number;
  atk?: number;
  hp?: number;
  golden?: boolean;
}

function board(entries: Entry[], prefix: string, tier = 6): CombatBoard {
  const insts: UnitInstance[] = [];
  let seq = 0;
  for (const e of entries) for (let k = 0; k < (e.count ?? 1); k++) insts.push(makeInstance(e.cardId, { uid: `${prefix}${seq++}`, atk: e.atk, hp: e.hp, golden: e.golden, bornTurn: 0 }));
  return toCombatBoard(insts, tier);
}

interface Matchup {
  name: string;
  a: Entry[];
  b: Entry[];
  seed: string;
}

const MATCHUPS: Matchup[] = [
  {
    name: 'Cleave vs wide swarm',
    a: [{ cardId: 'wildkin_thornbeast' }, { cardId: 'primordials_worldspark' }, { cardId: 'wildkin_gorehide' }],
    b: [{ cardId: 'revenants_cryptling', count: 4 }, { cardId: 'reefkin_spinefish' }, { cardId: 'reefkin_pearlguard' }],
    seed: 'lab-cleave',
  },
  {
    name: 'Shields & taunts',
    a: [{ cardId: 'reefkin_pearlguard' }, { cardId: 'reefkin_leviathan' }, { cardId: 'corsairs_seaqueen' }],
    b: [{ cardId: 'wildkin_thornbeast' }, { cardId: 'revenants_boncolossus' }, { cardId: 'sirens_venomsong' }],
    seed: 'lab-shield',
  },
  {
    name: 'Deaths & reborn',
    a: [{ cardId: 'revenants_cryptling', count: 3 }, { cardId: 'revenants_palelich' }, { cardId: 'revenants_dirgecaller' }],
    b: [{ cardId: 'wildkin_thornbeast' }, { cardId: 'primordials_tempest' }, { cardId: 'reefkin_spinefish' }],
    seed: 'lab-reborn',
  },
  {
    name: 'Big brawl',
    a: [{ cardId: 'wildkin_thornbeast' }, { cardId: 'wildkin_grovecaller' }, { cardId: 'wildkin_gorehide' }, { cardId: 'wildkin_thornwarden' }, { cardId: 'wildkin_brambleling' }],
    b: [{ cardId: 'revenants_boncolossus' }, { cardId: 'revenants_palelich' }, { cardId: 'revenants_cryptling', count: 2 }, { cardId: 'reefkin_pearlguard' }],
    seed: 'lab-brawl',
  },
];

export function ReplayLab(): ReactNode {
  const [pick, setPick] = useState(0);
  const m = MATCHUPS[pick];
  const log = useMemo(() => resolveCombat(board(m.a, 'a'), board(m.b, 'b'), m.seed), [m]);
  const myBoard = useMemo(() => {
    const start = log.find((e) => e.t === 'combatStart');
    return start && start.t === 'combatStart' ? start.a.units.map((u) => ({ uid: u.uid, cardId: u.cardId })) : [];
  }, [log]);

  return (
    <div>
      <div style={{ position: 'fixed', top: 8, left: 8, zIndex: 100, display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 480 }}>
        {MATCHUPS.map((mm, i) => (
          <button key={mm.name} className={i === pick ? 'primary' : ''} onClick={() => setPick(i)}>
            {mm.name}
          </button>
        ))}
      </div>
      <CombatReplay key={pick} log={log} myBoard={myBoard} />
    </div>
  );
}

export default ReplayLab;
