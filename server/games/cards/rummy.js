// Rummy and Gin Rummy.
//
// Draw one, do something with your hand, discard one. Underneath that both
// games are the same loop and they share it here — what differs is what "going
// out" means. In Rummy you lay melds down as you make them and win by emptying
// your hand; in Gin nothing is laid down until somebody knocks, and the knock
// is only legal if what is left over is worth ten or less.
//
// That legality check is the reason melds.js searches rather than guesses. A
// greedy arrangement of the same ten cards can be three or four points out, and
// three or four points is exactly the margin a knock turns on. A player who can
// count their own hand will know when the screen is wrong about it, and there
// is no way to explain that away.
//
// The discard pile is public, top card face up, and taking from it is the one
// piece of information everybody gets about everybody else. So a draw from the
// discard is announced and a draw from the deck is not — the same asymmetry a
// real table has.

import {
  createCardGame, dealAround, drawCards, goOut, finishOrder, passTurn, inPlay,
  rankOf, sayCard,
} from './kit.js';
import { bestLayout, isMeld, extends_, handPoints, tidy, pointsOf } from './melds.js';

/* --------------------------------- shared --------------------------------- */

function draw(state, seat, action) {
  if (state.drewThisTurn) return;
  if (action.from === 'discard' && state.pile.length) {
    const card = state.pile.pop();
    seat.hand.push(card);
    state.drewThisTurn = true;
    // Public, because everybody watched it go. This is the only thing anybody
    // learns about anybody else's hand all game.
    state.said = `${seat.name} takes the ${sayCard(card)} off the pile.`;
    state.log.push(state.said);
  } else {
    const got = drawCards(state, seat, 1);
    if (!got.length) return;
    state.drewThisTurn = true;
    state.said = `${seat.name} draws.`;
  }
  state.dirty = true;
}

function discard(state, seat, card) {
  if (!state.drewThisTurn) return false;      // draw first, always
  if (!seat.hand.includes(card)) return false;
  seat.hand.splice(seat.hand.indexOf(card), 1);
  state.pile.push(card);
  state.drewThisTurn = false;
  return true;
}

/* --------------------------------- Rummy ---------------------------------- */

export const rummy = createCardGame({
  id: 'rummy',
  name: 'Rummy',
  tagline: 'Draw one, lay what you can, throw one away.',
  emoji: '🀄',
  accent: '#16a085',
  face: 'rummy',
  minPlayers: 2,
  maxPlayers: 6,
  hands: 3,
  turnSeconds: 35,

  howToPlay: [
    'Draw one — off the deck, or the top of the discard pile where everybody can see.',
    'A meld is three or more of a rank, or three or more in a row in one suit.',
    'Lay melds down in front of you, and add to anybody’s once they are down.',
    'Finish your turn by throwing one card away.',
    'First to get rid of every card wins. Everybody else scores what they are left holding, against them.',
  ],

  init(state) {
    state.melds = [];        // { by, cards[] } — on the table, anybody may extend
    state.drewThisTurn = false;
    state.finished = [];
  },

  deal(state) {
    dealAround(state, state.seats.length > 4 ? 7 : 10);
    state.melds = [];
    state.drewThisTurn = false;
    state.finished = [];
    state.pile = [state.deck.pop()];
    state.turn = state.hand % state.seats.length;
    state.said = 'Draw, meld, discard.';
  },

  act(state, seat, action) {
    if (state.seats[state.turn]?.id !== seat.id || seat.out) return;

    if (action.type === 'draw') return draw(state, seat, action);

    if (action.type === 'meld') {
      if (!state.drewThisTurn) return;
      const cards = Array.isArray(action.cards) ? [...new Set(action.cards)] : [];
      if (cards.length < 3 || !cards.every((c) => seat.hand.includes(c))) return;
      if (!isMeld(cards)) return;
      for (const c of cards) seat.hand.splice(seat.hand.indexOf(c), 1);
      state.melds.push({ by: seat.seat, byName: seat.name, cards: tidy(cards) });
      state.said = `${seat.name} lays down ${cards.length}.`;
      state.dirty = true;
      // Emptying your hand on a meld goes out without a discard.
      if (!seat.hand.length) finishTurnByGoingOut(state, seat);
      return;
    }

    if (action.type === 'layoff') {
      if (!state.drewThisTurn) return;
      const card = String(action.card ?? '');
      const meld = state.melds[Number(action.meld)];
      if (!meld || !seat.hand.includes(card)) return;
      if (!extends_(meld.cards, card)) return;
      seat.hand.splice(seat.hand.indexOf(card), 1);
      meld.cards = tidy([...meld.cards, card]);
      state.said = `${seat.name} adds the ${sayCard(card)}.`;
      state.dirty = true;
      if (!seat.hand.length) finishTurnByGoingOut(state, seat);
      return;
    }

    if (action.type === 'discard') {
      const card = String(action.card ?? '');
      if (!discard(state, seat, card)) return;
      state.said = `${seat.name} throws the ${sayCard(card)}.`;
      if (!seat.hand.length) { finishTurnByGoingOut(state, seat); return; }
      passTurn(state);
    }
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || seat.out) return;
    if (!state.drewThisTurn) { draw(state, seat, { from: 'deck' }); return; }
    // Throw the most expensive thing not in a meld, which is what somebody who
    // had stopped paying attention would be advised to do anyway.
    const { deadwood } = bestLayout(seat.hand);
    const worst = (deadwood.length ? deadwood : seat.hand)
      .sort((a, b) => pointsOf(b) - pointsOf(a))[0];
    state.log.push(`${seat.name} was away — threw one.`);
    rummy.__spec.act(state, seat, { type: 'discard', card: worst });
  },

  handOver: (state) => inPlay(state).length <= 1 || state.deck.length + state.pile.length <= 1,

  scoreHand(state) {
    // Whoever went out scores what everybody else is still holding.
    const out = state.seats.find((s) => s.out) ?? null;
    let pot = 0;
    for (const s of state.seats) {
      if (out && s.seat === out.seat) continue;
      const left = handPoints(s.hand);
      s.score -= left;
      pot += left;
    }
    if (out) { out.score += pot; out.won += 1; }
    state.said = out
      ? `${out.name} goes out and takes ${pot}.`
      : 'The deck ran out — nobody went out.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      melds: state.melds.map((m, i) => ({ at: i, by: m.by, byName: m.byName, cards: m.cards })),
      top: state.pile[state.pile.length - 1] ?? null,
      pileSize: state.pile.length,
      drewThisTurn: state.drewThisTurn,
      finished: state.finished,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    const layout = bestLayout(seat.hand);
    return {
      // What the hand is worth if it stopped here, and the best arrangement of
      // it — worked out on the server because the client would have to
      // reimplement the whole search to show the same thing.
      layout: layout.melds,
      deadwood: layout.deadwood,
      points: layout.points,
      mustDraw: !state.drewThisTurn,
    };
  },
});

function finishTurnByGoingOut(state, seat) {
  goOut(state, seat);
  state.said = `${seat.name} is out.`;
  state.drewThisTurn = false;
  if (inPlay(state).length > 1) passTurn(state);
  state.dirty = true;
}

/* ------------------------------- Gin Rummy -------------------------------- */

/** The most deadwood you may knock on. Gin is nought. */
const KNOCK_AT = 10;

export const gin = createCardGame({
  id: 'gin',
  name: 'Gin Rummy',
  tagline: 'Nothing goes down until you knock — and only if you can.',
  emoji: '🍸',
  accent: '#27ae60',
  face: 'rummy',
  minPlayers: 2,
  maxPlayers: 2,
  hands: 4,
  turnSeconds: 35,

  howToPlay: [
    'Ten cards each. Draw one, throw one. Nothing is laid down while you play.',
    'A meld is three or more of a rank, or three or more in a row in one suit.',
    'What is left over is deadwood. Knock when your deadwood is worth ten or less.',
    'Nought deadwood is gin, and worth a lot more.',
    'Knock badly and your opponent can undercut you — then they score instead.',
  ],

  init(state) {
    state.drewThisTurn = false;
    state.knock = null;
    state.finished = [];
  },

  deal(state) {
    dealAround(state, 10);
    state.drewThisTurn = false;
    state.knock = null;
    state.finished = [];
    state.pile = [state.deck.pop()];
    state.turn = state.hand % state.seats.length;
    state.said = 'Draw one, throw one.';
  },

  act(state, seat, action) {
    if (state.seats[state.turn]?.id !== seat.id || state.knock) return;

    if (action.type === 'draw') return draw(state, seat, action);

    if (action.type === 'knock') {
      if (!state.drewThisTurn) return;
      const card = String(action.card ?? '');
      if (!seat.hand.includes(card)) return;
      // The knock is judged on the hand *after* the discard, which is the rule
      // and also the only way an eleven-card hand can ever be worth ten.
      const after = seat.hand.filter((c) => c !== card);
      const layout = bestLayout(after);
      if (layout.points > KNOCK_AT) return;

      discard(state, seat, card);
      state.knock = { by: seat.seat, byName: seat.name, points: layout.points, gin: layout.points === 0 };
      state.said = layout.points === 0
        ? `${seat.name} has gin.`
        : `${seat.name} knocks on ${layout.points}.`;
      state.log.push(state.said);
      state.dirty = true;
      return;
    }

    if (action.type === 'discard') {
      const card = String(action.card ?? '');
      if (!discard(state, seat, card)) return;
      state.said = `${seat.name} throws the ${sayCard(card)}.`;
      passTurn(state);
    }
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || state.knock) return;
    if (!state.drewThisTurn) { draw(state, seat, { from: 'deck' }); return; }
    const { deadwood } = bestLayout(seat.hand);
    const worst = (deadwood.length ? deadwood : seat.hand)
      .sort((a, b) => pointsOf(b) - pointsOf(a))[0];
    state.log.push(`${seat.name} was away — threw one.`);
    gin.__spec.act(state, seat, { type: 'discard', card: worst });
  },

  handOver: (state) => Boolean(state.knock) || state.deck.length <= 2,

  scoreHand(state) {
    if (!state.knock) {
      state.said = 'The deck ran out. No score.';
      return;
    }
    const knocker = state.seats.find((s) => s.seat === state.knock.by);
    const other = state.seats.find((s) => s.seat !== state.knock.by);
    if (!knocker || !other) { state.said = 'Hand over.'; return; }

    const mine = state.knock.points;
    const theirs = bestLayout(other.hand).points;

    if (state.knock.gin) {
      knocker.score += theirs + 25;
      knocker.won += 1;
      state.said = `Gin. ${knocker.name} takes ${theirs + 25}.`;
    } else if (theirs <= mine) {
      // The undercut, which is the entire reason a marginal knock is a gamble.
      other.score += (mine - theirs) + 25;
      other.won += 1;
      state.said = `Undercut! ${other.name} was on ${theirs} and takes ${(mine - theirs) + 25}.`;
    } else {
      knocker.score += theirs - mine;
      knocker.won += 1;
      state.said = `${knocker.name} knocks on ${mine} against ${theirs} and takes ${theirs - mine}.`;
    }
    state.log.push(state.said);
  },

  table(state) {
    return {
      top: state.pile[state.pile.length - 1] ?? null,
      pileSize: state.pile.length,
      drewThisTurn: state.drewThisTurn,
      knock: state.knock,
      knockAt: KNOCK_AT,
      // Nothing is on the table in Gin until the knock, so the melds list is
      // deliberately empty rather than absent — the client draws one screen.
      melds: [],
      finished: state.finished,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    const layout = bestLayout(seat.hand);
    return {
      layout: layout.melds,
      deadwood: layout.deadwood,
      points: layout.points,
      canKnock: state.drewThisTurn && bestKnockDiscard(seat.hand) !== null,
      mustDraw: !state.drewThisTurn,
    };
  },

  rank: (a, b) => b.score - a.score,
});

/**
 * The discard that would make a legal knock, if there is one.
 *
 * Worked out here rather than left to the player to hunt for, because "you may
 * knock but only after throwing exactly the right card" is a rule that reads as
 * a broken button when the button is simply disabled.
 */
export function bestKnockDiscard(hand) {
  let best = null;
  let bestPoints = Infinity;
  for (const card of hand) {
    const layout = bestLayout(hand.filter((c) => c !== card));
    if (layout.points <= KNOCK_AT && layout.points < bestPoints) {
      best = card;
      bestPoints = layout.points;
    }
  }
  return best;
}

void rankOf;
void finishOrder;

export const RUMMY_GAMES = [rummy, gin];
