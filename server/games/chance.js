// The machines: slots, plinko, the wheel and scratch cards.
//
// In a real casino these four are the same game wearing four costumes — you
// stake, a random number happens, and the building pays you less than it is
// worth. The costumes are lovely and the game underneath is a tax.
//
// So here they keep the costumes and lose the tax. Everybody stakes into one
// pot, everybody gets a result at the same moment, and the best result takes
// the pot. Nobody is grinding against a machine: the chips are the room's own
// and one of you is going to have them. That also makes a slot machine social,
// which it has never been anywhere else — five people pulling at once and
// looking at each other's reels is a different thing entirely.
//
// One engine, four faces. Each face only has to say how to roll a result, what
// it is worth, and what to call it. Everything about chips, pots, rounds and
// ties is here and tested once.
//
// Every machine's odds live in a table rather than in code, so what a face is
// worth can be read off the page — and so the test can check that the values
// really do come up at the rates the table claims.

import { stake, award, splitPot, balanceOf, MIN_BET } from '../chips.js';

const PHASES = { brief: 14, bets: 20, roll: 6, payout: 9 };

/**
 * Picks from a weighted table.
 *
 * @param {{weight:number}[]} rows
 */
function weighted(rows) {
  const total = rows.reduce((sum, r) => sum + r.weight, 0);
  let n = Math.random() * total;
  for (const row of rows) {
    n -= row.weight;
    if (n <= 0) return row;
  }
  return rows[rows.length - 1];
}

/**
 * Builds one of the machines.
 *
 * @param {object} face
 * @param {string} face.id
 * @param {() => {score:number, detail:object, say:string}} face.roll
 */
export function createMachine(face) {
  // Written above the return, not below it. Function declarations are
  // hoisted and would have survived down there, but the const arrows would
  // not — they would have thrown the first time a round opened.
  /* -------------------------------- the round ----------------------------- */

  function activePlayers(state) {
    return state.players.filter((p) => p.connected !== false);
  }
  function everyoneReady(state) {
    const list = activePlayers(state);
    return list.length > 0 && list.every((p) => state.briefed.includes(p.id));
  }
  const everyoneIn = (state) => activePlayers(state).every((p) => p.in);
  const playing = (state) => state.players.filter((p) => p.in);

  function openRound(state) {
    state.round += 1;
    state.phase = 'bets';
    state.result = null;
    for (const p of state.players) {
      p.in = false;
      p.ante = 0;
      p.roll = null;
    }
    state.phaseTotal = state.settings.betSeconds;
    state.timeLeft = state.settings.betSeconds;
    state.dirty = true;
  }

  function roll(state) {
    const table = playing(state);
    if (!table.length) {
      // Nobody staked. Straight past the roll rather than showing an empty one.
      state.phase = 'payout';
      state.result = { pot: 0, paid: [], carried: state.carried, said: 'Nobody had a go.' };
      state.phaseTotal = PHASES.payout;
      state.timeLeft = PHASES.payout;
      state.dirty = true;
      return;
    }

    // Everybody's result is decided here, together, and held back until the
    // payout — so nothing is visible while anybody could still be staking.
    for (const p of table) p.roll = face.roll();

    state.phase = 'roll';
    state.phaseTotal = PHASES.roll;
    state.timeLeft = PHASES.roll;
    state.dirty = true;
  }

  function settle(state) {
    const table = playing(state);
    let pot = table.reduce((sum, p) => sum + p.ante, 0) + state.carried;

    // A progressive machine holds a slice of every stake back, and it stays
    // held between rounds until somebody hits the thing that takes it. The
    // slice is the room's own chips being kept in the middle rather than a
    // house taking a cut — nothing leaves, it just waits.
    let jackpotWon = null;
    if (face.jackpotShare > 0) {
      const held = Math.floor(pot * face.jackpotShare);
      state.jackpot = (state.jackpot ?? 0) + held;
      pot -= held;

      const hit = table.filter((p) => p.roll && face.jackpotWhen?.(p.roll));
      if (hit.length && state.jackpot > 0) {
        // Split if more than one lands it in the same round, which is rare
        // and would otherwise quietly hand it all to whoever sorted first.
        for (const { id, chips } of splitPot(state.jackpot, hit.map((p) => ({ id: p.id, weight: 1 })))) {
          award(id, chips, `${face.id} — jackpot`);
          const player = state.players.find((x) => x.id === id);
          if (player) {
            player.net += chips;
            player.bestWin = Math.max(player.bestWin, chips);
          }
        }
        jackpotWon = { chips: state.jackpot, names: hit.map((p) => p.name) };
        state.log.push(`${hit.map((p) => p.name).join(' and ')} took the jackpot — ${state.jackpot}.`);
        state.jackpot = 0;
      }
    }

    const best = table.length ? Math.max(...table.map((p) => p.roll?.score ?? 0)) : 0;
    const winners = table.filter((p) => (p.roll?.score ?? 0) === best && best > 0);

    const paid = [];
    if (winners.length && pot > 0) {
      for (const { id, chips } of splitPot(pot, winners.map((w) => ({ id: w.id, weight: 1 })))) {
        award(id, chips, face.id);
        const player = state.players.find((p) => p.id === id);
        if (player) player.bestWin = Math.max(player.bestWin, chips);
        paid.push({ id, name: player?.name ?? id, chips });
      }
      state.carried = 0;
    } else {
      // Everybody blanked. There is nobody to keep it, so it rides.
      state.carried = pot;
    }

    for (const p of table) {
      p.net += (paid.find((x) => x.id === p.id)?.chips ?? 0) - p.ante;
    }

    const top = winners[0];
    state.result = {
      pot,
      paid: paid.sort((a, b) => b.chips - a.chips),
      carried: state.carried,
      jackpot: state.jackpot ?? 0,
      jackpotWon,
      said: paid.length
        ? paid.length === 1
          ? `${paid[0].name} takes ${paid[0].chips} — ${top?.roll?.say ?? ''}`.trim()
          : `${paid.map((x) => x.name).join(' and ')} split ${pot} — ${top?.roll?.say ?? ''}`.trim()
        : `Nobody hit a thing. ${pot} rides on.`,
    };
    state.log.push(state.result.said);

    state.phase = 'payout';
    state.phaseTotal = PHASES.payout;
    state.timeLeft = PHASES.payout;
    state.dirty = true;
  }

  /** Whatever nobody won goes back to whoever last staked it. */
  function closeUp(state) {
    // A jackpot nobody hit is still the room's chips. It goes home with
    // whatever else was riding rather than evaporating with the table.
    if (state.jackpot > 0) {
      state.carried += state.jackpot;
      state.jackpot = 0;
    }
    if (state.carried > 0) {
      const owed = state.players.filter((p) => p.ante > 0);
      const back = owed.length ? owed : activePlayers(state);
      if (back.length) {
        for (const { id, chips } of splitPot(state.carried, back.map((p) => ({ id: p.id, weight: p.ante || 1 })))) {
          award(id, chips, `${face.id} — closed`);
          const player = state.players.find((p) => p.id === id);
          if (player) player.net += chips;
        }
      }
      state.carried = 0;
      state.log.push('Closed up. What nobody won went back.');
    }
    state.over = true;
    state.phase = 'over';
    state.dirty = true;
  }

  return {
    id: face.id,
    name: face.name,
    tagline: face.tagline,
    emoji: face.emoji,
    accent: face.accent,
    client: 'chance',
    minPlayers: 1,
    maxPlayers: 60,
    tickRate: 4,
    stakes: 'chips',
    /** Which face the one shared client should wear. */
    machine: face.id,

    howToPlay: [
      face.blurb,
      'Everybody stakes into one pot and everybody goes at the same moment.',
      'Best result takes the pot. A tie splits it.',
      'There is no house. The chips are the room’s own.',
    ],

    options: {
      rounds: {
        label: 'Rounds',
        hint: 'How many goes before it closes',
        kind: 'number',
        min: 1,
        max: 30,
        hardMax: 200,
        step: 1,
        default: 8,
      },
      ante: {
        label: 'What a go costs',
        kind: 'number',
        min: MIN_BET,
        max: 500,
        hardMax: 5000,
        step: 5,
        default: 20,
      },
      betSeconds: {
        label: 'Seconds to get in',
        kind: 'number',
        min: 6,
        max: 90,
        hardMax: 300,
        step: 1,
        default: PHASES.bets,
      },
    },

    createState(players, ctx = {}) {
      const settings = ctx.settings ?? {};
      return {
        settings: {
          rounds: Math.max(1, Math.min(200, Number(settings.rounds) || 8)),
          ante: Math.max(MIN_BET, Math.min(5000, Number(settings.ante) || 20)),
          betSeconds: Math.max(6, Math.min(300, Number(settings.betSeconds) || PHASES.bets)),
        },
        machine: face.id,
        phase: 'brief',
        timeLeft: PHASES.brief,
        phaseTotal: PHASES.brief,
        briefed: [],
        round: 0,
        players: players.map((p) => ({
          id: p.id,
          name: p.name,
          connected: p.connected !== false,
          in: false,
          ante: 0,
          roll: null,
          net: 0,
          bestWin: 0,
        })),
        carried: 0,
        jackpot: 0,
        result: null,
        log: [],
        over: false,
        dirty: true,
      };
    },

    onPlayerJoin(state, player) {
      const known = state.players.find((p) => p.id === player.id);
      if (known) {
        known.connected = true;
        known.name = player.name;
      } else {
        state.players.push({
          id: player.id, name: player.name, connected: true,
          in: false, ante: 0, roll: null, net: 0, bestWin: 0,
        });
      }
      state.dirty = true;
    },

    onPlayerLeave(state, player) {
      const me = state.players.find((p) => p.id === player.id);
      if (me) me.connected = false;
      // A stake already in stays in. It is going to be rolled either way.
      state.dirty = true;
    },

    onAction(state, player, action = {}) {
      const me = state.players.find((p) => p.id === player.id);
      if (!me) return;

      if (action.type === 'briefed' && state.phase === 'brief') {
        if (!state.briefed.includes(me.id)) state.briefed.push(me.id);
        state.dirty = true;
        if (everyoneReady(state)) openRound(state);
        return;
      }

      if (action.type === 'stake' && state.phase === 'bets' && !me.in) {
        const taken = stake(me.id, state.settings.ante, face.id);
        if (taken.error) return;
        me.in = true;
        me.ante = state.settings.ante;
        state.dirty = true;
        if (everyoneIn(state)) roll(state);
      }
    },

    botAction: () => null,

    onTick(state, dt) {
      if (state.over) return;
      state.timeLeft -= dt;
      if (state.timeLeft > 0) return;

      if (state.phase === 'brief') return openRound(state);
      if (state.phase === 'bets') return roll(state);
      if (state.phase === 'roll') return settle(state);
      if (state.phase === 'payout') {
        if (state.round >= state.settings.rounds) return closeUp(state);
        return openRound(state);
      }
    },

    isDirty(state) {
      const was = state.dirty;
      state.dirty = false;
      return was;
    },

    isOver: (state) => Boolean(state.over),

    results(state) {
      return [...state.players]
        .sort((a, b) => b.net - a.net || b.bestWin - a.bestWin)
        .map((p, i) => ({ playerId: p.id, name: p.name, score: p.net, place: i + 1 }));
    },

    serialize(state) {
      const showRolls = state.phase === 'payout' || state.phase === 'over';
      return {
        phase: state.phase,
        machine: face.id,
        rules: this.howToPlay,
        round: state.round,
        maxRounds: state.settings.rounds,
        ante: state.settings.ante,
        timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
        phaseTotal: state.phaseTotal,
        pot: state.players.reduce((sum, p) => sum + p.ante, 0) + state.carried,
        carried: state.carried,
        // Only on a progressive machine; null everywhere else so the client
        // has nothing to draw unless there is something to draw.
        jackpot: face.jackpotShare > 0 ? (state.jackpot ?? 0) : null,
        players: state.players.map((p) => ({
          id: p.id,
          name: p.name,
          connected: p.connected,
          in: p.in,
          net: p.net,
          // Nobody's result until everybody's. A machine that leaks one roll
          // early is a machine somebody can watch before staking.
          roll: showRolls ? p.roll : null,
        })),
        result: state.result,
        briefed: state.briefed,
        log: state.log.slice(-5),
      };
    },

    serializeFor(state, playerId) {
      const me = state.players.find((p) => p.id === playerId);
      return {
        ...this.serialize(state),
        you: {
          id: playerId,
          chips: balanceOf(playerId),
          in: Boolean(me?.in),
          roll: state.phase === 'payout' || state.phase === 'over' ? me?.roll ?? null : null,
        },
      };
    },
  };

}

/* --------------------------------- the faces ------------------------------ */

const SYMBOLS = [
  { sym: '🍒', weight: 30, worth: 1 },
  { sym: '🍋', weight: 26, worth: 2 },
  { sym: '🔔', weight: 20, worth: 3 },
  { sym: '⭐', weight: 14, worth: 5 },
  { sym: '💎', weight: 8, worth: 10 },
  { sym: '7️⃣', weight: 4, worth: 20 },
];

/** Three reels. Three the same is the big one, two is something. */
export const slots = createMachine({
  id: 'slots',
  name: 'Slots',
  tagline: 'Five people pulling at once, and the best line takes the pot.',
  emoji: '🎰',
  accent: '#e0483d',
  blurb: 'Three reels each. Three of a kind beats two, and a rarer symbol beats a common one.',
  roll() {
    const reels = [weighted(SYMBOLS), weighted(SYMBOLS), weighted(SYMBOLS)];
    const syms = reels.map((r) => r.sym);
    const counts = new Map();
    for (const r of reels) counts.set(r.sym, (counts.get(r.sym) ?? 0) + 1);
    const [topSym, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const worth = SYMBOLS.find((s) => s.sym === topSym).worth;

    // Three of a kind is worth far more than two, and a rare symbol far more
    // than a common one — the ordinary shape of a slot payline.
    const score = topCount === 3 ? worth * 50 : topCount === 2 ? worth * 5 : worth;
    return {
      score,
      detail: { reels: syms },
      say: topCount === 3 ? `three ${topSym}` : topCount === 2 ? `two ${topSym}` : `${topSym} high`,
    };
  },
});

/** A disc down the pegs into a slot. The middle is common, the edges are not. */
export const plinko = createMachine({
  id: 'plinko',
  name: 'Plinko',
  tagline: 'One disc each, twelve rows of pegs, and the edges are where the money is.',
  emoji: '🔻',
  accent: '#4ad6ff',
  blurb: 'A disc bounces down twelve rows. The middle is easy to hit and worth little; the edges are the opposite.',
  roll() {
    // Twelve honest coin flips, which is what a peg is. The binomial that
    // comes out is the reason the middle slot is common and the edge is not.
    const ROWS = 12;
    let slot = 0;
    const path = [];
    for (let i = 0; i < ROWS; i++) {
      const right = Math.random() < 0.5;
      path.push(right ? 1 : 0);
      if (right) slot += 1;
    }
    // Slot 0..12. Worth grows steeply towards the edges.
    const fromMiddle = Math.abs(slot - ROWS / 2);
    const score = Math.round(Math.pow(2, fromMiddle));
    return {
      score,
      detail: { slot, rows: ROWS, path },
      say: `slot ${slot} — ${score}×`,
    };
  },
});

/** One wheel each, twelve wedges, one of them worth having. */
export const wheel = createMachine({
  id: 'wheel',
  name: 'Wheel of Fortune',
  tagline: 'A wedge each. Land the big one and the room’s chips are yours.',
  emoji: '🎯',
  accent: '#f5b93b',
  blurb: 'One spin each, twelve wedges. Most are small; one is worth the whole evening.',
  roll() {
    const WEDGES = [
      { label: '1×', worth: 1, weight: 30 },
      { label: '2×', worth: 2, weight: 24 },
      { label: '3×', worth: 3, weight: 18 },
      { label: '5×', worth: 5, weight: 12 },
      { label: '10×', worth: 10, weight: 8 },
      { label: '25×', worth: 25, weight: 5 },
      { label: '100×', worth: 100, weight: 3 },
    ];
    const got = weighted(WEDGES);
    return { score: got.worth, detail: { label: got.label }, say: `the ${got.label} wedge` };
  },
});

/** Six panels, and whatever is under them. */
export const scratch = createMachine({
  id: 'scratch',
  name: 'Scratch Cards',
  tagline: 'Six panels each. Matching three is what you are after.',
  emoji: '🎫',
  accent: '#b58cff',
  blurb: 'Six panels to scratch. Three matching symbols is a win, and the rarer the symbol the bigger it is.',
  roll() {
    const panels = Array.from({ length: 6 }, () => weighted(SYMBOLS));
    const counts = new Map();
    for (const p of panels) counts.set(p.sym, (counts.get(p.sym) ?? 0) + 1);
    const [topSym, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const worth = SYMBOLS.find((s) => s.sym === topSym).worth;
    // Three matching is the win; four or more is rarer and worth more again.
    const score = topCount >= 3 ? worth * (topCount - 2) * 10 : 0;
    return {
      score,
      detail: { panels: panels.map((p) => p.sym) },
      say: topCount >= 3 ? `${topCount} × ${topSym}` : 'nothing on it',
    };
  },
});
