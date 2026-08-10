// Blackjack, with nobody to beat but each other.
//
// A real blackjack table is you against a dealer who hits on sixteen and
// stands on seventeen, and that dealer is the house — the whole game is built
// around an edge working quietly against everybody sitting down. Take the
// dealer away and the game is better, not worse: everyone plays a hand, the
// closest to twenty-one without going over takes the pot, and the chips move
// between friends.
//
// It also changes how it plays, in a good way. Against a dealer, standing on
// seventeen is correct and boring. Against five other people who are all still
// drawing, seventeen is a coward's hand — you can see how many are still in
// and how many have already gone bust, and the right moment to stop moves with
// the table. That is a decision worth making.

import { freshDeck, shuffle, blackjackValue, isBlackjack } from '../cards.js';
import { stake, award, splitPot, balanceOf, MIN_BET } from '../chips.js';

const PHASES = { brief: 16, bets: 20, play: 20, reveal: 10 };

export default {
  id: 'blackjack',
  name: 'Blackjack',
  tagline: 'No dealer. Closest to twenty-one takes everybody’s chips.',
  emoji: '🂡',
  accent: '#c8392b',
  client: 'blackjack',
  minPlayers: 2,
  maxPlayers: 12,
  tickRate: 4,
  stakes: 'chips',

  howToPlay: [
    'Everybody antes, everybody gets two cards. There is no dealer.',
    'Hit or stand — closest to twenty-one without going over takes the pot.',
    'Go over and you are out of the hand. Everybody bust and the pot rides.',
    'Two cards to twenty-one is blackjack, and it beats a twenty-one made the long way.',
  ],

  options: {
    hands: {
      label: 'Hands',
      hint: 'How many before the table closes',
      kind: 'number',
      min: 1,
      max: 30,
      hardMax: 200,
      step: 1,
      default: 10,
    },
    ante: {
      label: 'Ante',
      hint: 'What everybody puts in to be dealt',
      kind: 'number',
      min: MIN_BET,
      max: 200,
      hardMax: 5000,
      step: 5,
      default: 20,
    },
    playSeconds: {
      label: 'Seconds to decide',
      hint: 'Run out and you stand on what you have',
      kind: 'number',
      min: 5,
      max: 90,
      hardMax: 300,
      step: 1,
      default: PHASES.play,
    },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    return {
      settings: {
        hands: Math.max(1, Math.min(200, Number(settings.hands) || 10)),
        ante: Math.max(MIN_BET, Math.min(5000, Number(settings.ante) || 20)),
        playSeconds: Math.max(5, Math.min(300, Number(settings.playSeconds) || PHASES.play)),
      },
      phase: 'brief',
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      hand: 0,
      deck: [],
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected !== false,
        cards: [],
        in: false,
        stood: false,
        bust: false,
        ante: 0,
        net: 0,
      })),
      /** What nobody won last hand, riding on this one. */
      carried: 0,
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
        cards: [], in: false, stood: false, bust: false, ante: 0, net: 0,
      });
    }
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const me = state.players.find((p) => p.id === player.id);
    if (me) {
      me.connected = false;
      // Their ante stays in the pot — leaving cannot be a way to take it back.
      if (me.in && !me.bust) me.stood = true;
    }
    state.dirty = true;
  },

  onAction(state, player, action = {}) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me) return;

    if (action.type === 'briefed' && state.phase === 'brief') {
      if (!state.briefed.includes(me.id)) state.briefed.push(me.id);
      state.dirty = true;
      if (everyoneReady(state)) openBets(state);
      return;
    }

    if (action.type === 'ante' && state.phase === 'bets' && !me.in) {
      const taken = stake(me.id, state.settings.ante, 'blackjack — ante');
      if (taken.error) return;
      me.in = true;
      me.ante = state.settings.ante;
      state.dirty = true;
      if (everyoneAnted(state)) dealHand(state);
      return;
    }

    if (state.phase !== 'play' || !me.in || me.stood || me.bust) return;

    if (action.type === 'hit') {
      me.cards.push(state.deck.pop());
      const value = blackjackValue(me.cards);
      if (value.bust) {
        me.bust = true;
        state.log.push(`${me.name} went bust on ${value.total}.`);
      } else if (value.total === 21) {
        // Nothing to gain by drawing on twenty-one, and plenty to lose.
        me.stood = true;
      }
      state.dirty = true;
      if (everyoneDone(state)) settle(state);
      return;
    }

    if (action.type === 'stand') {
      me.stood = true;
      state.dirty = true;
      if (everyoneDone(state)) settle(state);
    }
  },

  botAction: () => null,

  onTick(state, dt) {
    if (state.over) return;
    state.timeLeft -= dt;
    if (state.timeLeft > 0) return;

    if (state.phase === 'brief') return openBets(state);
    if (state.phase === 'bets') {
      // Anybody who did not ante sits the hand out rather than being charged
      // for one they did not ask for.
      if (playing(state).length >= 2) return dealHand(state);
      return closeTable(state, 'Not enough players anted.');
    }
    if (state.phase === 'play') {
      // Out of time is standing on what you have. Drawing a card for somebody
      // could bust them, and nothing should bust you but your own decision.
      for (const p of playing(state)) if (!p.bust) p.stood = true;
      return settle(state);
    }
    if (state.phase === 'reveal') {
      if (state.hand >= state.settings.hands) return closeTable(state, null);
      return openBets(state);
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
      .sort((a, b) => b.net - a.net)
      .map((p, i) => ({ playerId: p.id, name: p.name, score: p.net, place: i + 1 }));
  },

  serialize(state) {
    const showAll = state.phase === 'reveal' || state.phase === 'over';
    return {
      phase: state.phase,
      rules: this.howToPlay,
      hand: state.hand,
      maxHands: state.settings.hands,
      ante: state.settings.ante,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      pot: state.players.reduce((sum, p) => sum + p.ante, 0) + state.carried,
      carried: state.carried,
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        in: p.in,
        stood: p.stood,
        bust: p.bust,
        net: p.net,
        // One card up, one down, the way a table does it — until the reveal.
        cards: showAll || !p.cards.length ? p.cards : [p.cards[0], ...p.cards.slice(1).map(() => '??')],
        // How many they hold, so the room can see somebody on five cards.
        held: p.cards.length,
        // Only ever the whole total once everything is face up. Sending it
        // early would put everybody's hand on everybody's screen in a number.
        total: showAll ? blackjackValue(p.cards).total : null,
      })),
      result: state.result,
      briefed: state.briefed,
      log: state.log.slice(-5),
    };
  },

  serializeFor(state, playerId) {
    const me = state.players.find((p) => p.id === playerId);
    const value = me ? blackjackValue(me.cards) : null;
    return {
      ...this.serialize(state),
      you: {
        id: playerId,
        chips: balanceOf(playerId),
        in: Boolean(me?.in),
        cards: me?.cards ?? [],
        total: value?.total ?? 0,
        soft: Boolean(value?.soft),
        bust: Boolean(me?.bust),
        stood: Boolean(me?.stood),
        blackjack: me ? isBlackjack(me.cards) : false,
        canPlay: state.phase === 'play' && Boolean(me?.in) && !me?.stood && !me?.bust,
      },
    };
  },
};

/* --------------------------------- the hand ------------------------------- */

const active = (state) => state.players.filter((p) => p.connected !== false);
const playing = (state) => state.players.filter((p) => p.in);

function everyoneReady(state) {
  const list = active(state);
  return list.length > 0 && list.every((p) => state.briefed.includes(p.id));
}
const everyoneAnted = (state) => active(state).every((p) => p.in);
const everyoneDone = (state) => playing(state).every((p) => p.stood || p.bust);

function openBets(state) {
  state.hand += 1;
  state.phase = 'bets';
  state.result = null;
  for (const p of state.players) {
    p.cards = [];
    p.in = false;
    p.stood = false;
    p.bust = false;
    p.ante = 0;
  }
  state.phaseTotal = PHASES.bets;
  state.timeLeft = PHASES.bets;
  state.dirty = true;
}

function dealHand(state) {
  const table = playing(state);
  if (table.length < 2) return closeTable(state, 'Not enough players anted.');

  state.deck = shuffle(freshDeck());
  for (let i = 0; i < 2; i++) for (const p of table) p.cards.push(state.deck.pop());

  // Two cards to twenty-one needs no decision.
  for (const p of table) if (isBlackjack(p.cards)) p.stood = true;

  state.phase = 'play';
  state.phaseTotal = state.settings.playSeconds;
  state.timeLeft = state.settings.playSeconds;
  state.dirty = true;

  if (everyoneDone(state)) settle(state);
}

/**
 * Closest to twenty-one without going over.
 *
 * Blackjack — two cards to twenty-one — beats a twenty-one built the long way,
 * which is the one rule from the real game worth keeping, because otherwise
 * being dealt it is worth nothing at all.
 */
function settle(state) {
  const table = playing(state);
  const pot = table.reduce((sum, p) => sum + p.ante, 0) + state.carried;

  const standing = table.filter((p) => !p.bust);
  const scored = standing.map((p) => ({
    p,
    total: blackjackValue(p.cards).total,
    natural: isBlackjack(p.cards),
  }));

  let winners = [];
  if (scored.length) {
    const naturals = scored.filter((s) => s.natural);
    const pool = naturals.length ? naturals : scored;
    const best = Math.max(...pool.map((s) => s.total));
    winners = pool.filter((s) => s.total === best);
  }

  const paid = [];
  if (winners.length && pot > 0) {
    for (const { id, chips } of splitPot(pot, winners.map((w) => ({ id: w.p.id, weight: 1 })))) {
      award(id, chips, 'blackjack');
      paid.push({ id, name: state.players.find((p) => p.id === id)?.name ?? id, chips });
    }
    state.carried = 0;
  } else {
    // Everybody bust. Nobody has earned it, and there is no house to keep it,
    // so it rides on the next hand.
    state.carried = pot;
  }

  for (const p of table) {
    const won = paid.find((x) => x.id === p.id)?.chips ?? 0;
    p.net += won - p.ante;
  }

  const totals = Object.fromEntries(table.map((p) => [p.id, blackjackValue(p.cards).total]));
  state.result = {
    pot,
    paid: paid.sort((a, b) => b.chips - a.chips),
    carried: state.carried,
    totals,
    said: paid.length
      ? paid.length === 1
        ? `${paid[0].name} takes ${paid[0].chips} with ${totals[paid[0].id]}${winners[0]?.natural ? ' — blackjack' : ''}.`
        : `${paid.map((x) => x.name).join(' and ')} split ${pot}.`
      : `Everybody bust. ${pot} rides on.`,
  };
  state.log.push(state.result.said);

  state.phase = 'reveal';
  state.phaseTotal = PHASES.reveal;
  state.timeLeft = PHASES.reveal;
  state.dirty = true;
}

/** Anything nobody won goes back to whoever last put it in. */
function closeTable(state, why) {
  // An ante for a hand that never got played. The table can close during the
  // betting phase — not enough people anted — and without this the ones who
  // did are simply charged for a hand nobody dealt.
  const unplayed = state.result === null;
  if (unplayed) {
    for (const p of state.players) {
      if (p.ante > 0) {
        award(p.id, p.ante, 'blackjack — hand not played');
        p.ante = 0;
      }
    }
  }

  if (state.carried > 0) {
    const owed = state.players.filter((p) => p.ante > 0);
    if (owed.length) {
      for (const { id, chips } of splitPot(state.carried, owed.map((p) => ({ id: p.id, weight: p.ante })))) {
        award(id, chips, 'blackjack — table closed');
        const player = state.players.find((p) => p.id === id);
        if (player) player.net += chips;
      }
    } else {
      // Nobody is owed it — the last hand's players have all been reset. Give
      // it back to whoever is still at the table rather than losing it.
      const here = active(state);
      if (here.length) {
        for (const { id, chips } of splitPot(state.carried, here.map((p) => ({ id: p.id, weight: 1 })))) {
          award(id, chips, 'blackjack — table closed');
          const player = state.players.find((p) => p.id === id);
          if (player) player.net += chips;
        }
      }
    }
    state.carried = 0;
  }
  if (why) state.log.push(why);
  state.over = true;
  state.phase = 'over';
  state.dirty = true;
}
