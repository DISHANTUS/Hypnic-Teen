// Truth or Dare: the bottle, the pairing, and who gets to say it happened.
//
//   npm run test:truth-dare
//
// The rules that matter here are all about permission — who may choose, who
// may ask, who may confirm — because the game only works if none of those can
// be done by the wrong person. And the bottle has to be genuinely random, or
// the same two people spend the night staring at each other.

import game from '../server/games/truth-dare.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, connected: true }));
const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };
const who = (id) => ({ id });

/** Past the rules and into the first spin. */
function start(players = 4, settings = {}) {
  const state = game.createState(mk(players), { settings: { rounds: 6, ...settings } });
  for (const p of state.players) game.onAction(state, p, { type: 'ready' }, api);
  game.onTick(state, 0.5, api);
  return state;
}

/** Skip whatever the current phase is waiting for. */
const skip = (state) => game.onTick(state, 999, api);

console.log('\n  Truth or Dare\n');

/* ------------------------------- the bottle ------------------------------- */

{
  const state = start(4);
  check('a match opens with the rules', game.createState(mk(4), {}).phase === 'intro');
  check('and the first spin follows', state.phase === 'spin');

  // Somebody who never presses Ready cannot hold the room on the rules screen.
  const stalled = game.createState(mk(4), {});
  game.onTick(stalled, 999, api);
  check('a player who wanders off does not freeze the match', stalled.phase === 'spin');
  check('the bottle has somewhere to land', Number.isFinite(state.bottle?.angle));
  check('and several turns to get there', state.bottle.spinTo > 360 * 3, `${Math.round(state.bottle.spinTo)}°`);

  // The neck lands on one person; the base points at the one opposite.
  const askedSeat = state.seats.indexOf(state.askedId);
  const askerSeat = state.seats.indexOf(state.askerId);
  check('the neck picks somebody', askedSeat >= 0);
  check('whoever is opposite does the asking', askerSeat === (askedSeat + 2) % 4, `seat ${askedSeat} → seat ${askerSeat}`);
  check('and it is never the same person', state.askedId !== state.askerId);

  // The angle the client animates to must actually agree with the seat the
  // server picked, or the bottle stops pointing at the wrong person.
  const slice = 360 / state.seats.length;
  const landedOn = Math.round(state.bottle.angle / slice) % state.seats.length;
  check('the angle points at the seat it claims to', landedOn === state.bottle.seat, `${state.bottle.angle.toFixed(0)}° → seat ${landedOn}`);

  // Two players is the smallest circle, and "opposite" still has to work.
  const pair = start(2);
  check('two players still face each other', pair.askedId !== pair.askerId);
}

{
  // Randomness, over enough spins to tell. A bottle that always stops in the
  // same place is a bottle nobody believes.
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(start(4).bottle.seat);
  check('the bottle does not favour a seat', seen.size >= 3, `${seen.size} of 4 seats seen in 60 spins`);
}

{
  // Everybody moves between rounds, so you are not stuck opposite one person.
  const state = start(6);
  const first = state.seats.join(',');
  const orders = new Set([first]);
  for (let r = 0; r < 8; r++) {
    skip(state); // choose
    skip(state); // write
    skip(state); // act
    skip(state); // reveal
    if (state.over) break;
    orders.add(state.seats.join(','));
  }
  check('the circle is reshuffled between rounds', orders.size > 1, `${orders.size} seatings`);
}

/* ------------------------------- permission ------------------------------- */

{
  const state = start(4);
  skip(state); // into 'choose'
  check('the round reaches the choice', state.phase === 'choose');

  const bystander = state.players.find((p) => p.id !== state.askedId && p.id !== state.askerId);
  game.onAction(state, who(bystander.id), { type: 'choice', choice: 'dare' }, api);
  check('a bystander cannot choose for you', state.choice === null);

  game.onAction(state, who(state.askerId), { type: 'choice', choice: 'dare' }, api);
  check('nor can the person asking', state.choice === null);

  game.onAction(state, who(state.askedId), { type: 'choice', choice: 'dare' }, api);
  check('the person on the spot chooses', state.choice === 'dare' && state.phase === 'write');

  game.onAction(state, who(bystander.id), { type: 'question', text: 'do something silly' }, api);
  check('only the person opposite may set it', state.question === null);

  game.onAction(state, who(state.askerId), { type: 'question', text: 'Ten push-ups, right now' }, api);
  check('and they type it themselves', state.question === 'Ten push-ups, right now' && state.phase === 'act');
  check('the question is not the app\'s', !state.dares.includes(state.question));

  // A dare is claimed by the performer and confirmed by whoever set it.
  game.onAction(state, who(state.askerId), { type: 'did-it' }, api);
  check('the asker cannot claim it on your behalf', state.claimed === false);

  game.onAction(state, who(state.askedId), { type: 'did-it' }, api);
  check('the performer says they did it', state.claimed === true && state.phase === 'verdict');

  game.onAction(state, who(bystander.id), { type: 'verdict', ok: true }, api);
  check('a bystander cannot confirm it', state.verdict === null);

  game.onAction(state, who(state.askedId), { type: 'verdict', ok: true }, api);
  check('nor can the performer confirm their own dare', state.verdict === null);

  const performer = state.players.find((p) => p.id === state.askedId);
  game.onAction(state, who(state.askerId), { type: 'verdict', ok: true }, api);
  check('only the person who set it can confirm', state.verdict === 'yes' && state.phase === 'reveal');
  check('a confirmed dare scores', state.roundScores[performer.id] > 0, `+${state.roundScores[performer.id]}`);
  check('and the asker is paid for thinking of it', state.roundScores[state.askerId] > 0);
  check('nobody is mocked for going through with it', performer.nickname === null);
}

/* -------------------------------- backing out ----------------------------- */

{
  // A long match, because this needs the bottle to come back round to the same
  // person and a six-round game often never does.
  const state = start(4, { rounds: 40 });
  skip(state);
  game.onAction(state, who(state.askedId), { type: 'choice', choice: 'dare' }, api);
  game.onAction(state, who(state.askerId), { type: 'question', text: 'Sing the anthem standing on a chair' }, api);

  const coward = state.players.find((p) => p.id === state.askedId);
  game.onAction(state, who(state.askedId), { type: 'nope' }, api);
  check('you are allowed to refuse', state.phase === 'reveal' && state.outcome === 'refused');
  check('but the room names you for it', Boolean(coward.nickname), coward.nickname ?? 'none');
  check('and refusing scores nothing', !state.roundScores[coward.id]);

  // A second refusal does not pile on — one nickname is a joke, five is
  // something else.
  const firstName = coward.nickname;
  // Spin on until the bottle comes back to them. The loop has to land on a
  // round where they are the one on the spot, or the second refusal would be
  // somebody else's and the check would prove nothing.
  let rounds = 0;
  skip(state);
  while (!state.over && rounds++ < 200) {
    if (state.phase === 'choose' && state.askedId === coward.id) break;
    skip(state);
  }
  if (!state.over && state.askedId === coward.id && state.phase === 'choose') {
    game.onAction(state, who(state.askedId), { type: 'choice', choice: 'dare' }, api);
    game.onAction(state, who(state.askerId), { type: 'question', text: 'Again' }, api);
    game.onAction(state, who(state.askedId), { type: 'nope' }, api);
    check('a second refusal does not pile on more names', coward.nickname === firstName, coward.nickname);
    check('though the count goes up', coward.chickened >= 2, `${coward.chickened} times`);
  } else {
    check('the bottle came back round to them', false, 'never landed on the same player again');
  }
}

{
  // Setting a dare and then disputing it is the asker's right, and it costs
  // the performer.
  const state = start(4);
  skip(state);
  game.onAction(state, who(state.askedId), { type: 'choice', choice: 'dare' }, api);
  game.onAction(state, who(state.askerId), { type: 'question', text: 'Do a handstand' }, api);
  game.onAction(state, who(state.askedId), { type: 'did-it' }, api);
  const performer = state.players.find((p) => p.id === state.askedId);
  game.onAction(state, who(state.askerId), { type: 'verdict', ok: false }, api);
  check('a disputed dare does not score', !state.roundScores[performer.id], state.outcome);
  check('and earns a nickname', Boolean(performer.nickname), performer.nickname ?? 'none');
}

{
  // If the asker wanders off after a claim, the performer keeps the benefit of
  // the doubt — being let down by somebody else is not backing out.
  const state = start(4);
  skip(state);
  game.onAction(state, who(state.askedId), { type: 'choice', choice: 'dare' }, api);
  game.onAction(state, who(state.askerId), { type: 'question', text: 'Touch your nose with your tongue' }, api);
  game.onAction(state, who(state.askedId), { type: 'did-it' }, api);
  const performer = state.players.find((p) => p.id === state.askedId);
  skip(state); // the verdict clock runs out with no answer
  check('an unconfirmed claim still counts', state.roundScores[performer.id] > 0, state.outcome);
  check('and does not earn a nickname', performer.nickname === null);
}

/* --------------------------------- truths --------------------------------- */

{
  const state = start(3);
  skip(state);
  game.onAction(state, who(state.askedId), { type: 'choice', choice: 'truth' }, api);
  game.onAction(state, who(state.askerId), { type: 'question', text: 'What is the worst thing you have said about me?' }, api);
  const teller = state.players.find((p) => p.id === state.askedId);
  game.onAction(state, who(state.askedId), { type: 'answer', text: 'Nothing I would repeat here.' }, api);
  check('a truth goes straight to the result', state.phase === 'reveal' && state.outcome === 'answered');
  check('answering scores', state.roundScores[teller.id] > 0);
  check('a truth is worth less than a dare', state.roundScores[teller.id] < 150);
  check('the answer is shown to the room', game.serialize(state).answer?.length > 0);
}

/* ------------------------- nobody is left hanging ------------------------- */

{
  // Every clock has to lead somewhere, or a room where one person walked off
  // sits on the same screen forever.
  const state = start(4, { rounds: 3 });
  let guard = 0;
  const phases = new Set();
  while (!state.over && guard++ < 60) {
    phases.add(state.phase);
    skip(state);
  }
  check('a match with nobody playing still finishes', state.over, `${guard} beats`);
  check('and it passes through every phase on the way', phases.has('choose') && phases.has('write') && phases.has('act'), [...phases].join('→'));

  const table = game.results(state);
  check('a ranked table comes out', table.length === 4 && table[0].place === 1);
  const named = table.find((r) => r.name.includes('"'));
  check('a nickname follows you onto the scoreboard', Boolean(named), named?.name ?? 'nobody was mocked');
}

/* ----------------------------- what leaks out ----------------------------- */

{
  const state = start(4);
  skip(state);
  game.onAction(state, who(state.askedId), { type: 'choice', choice: 'truth' }, api);

  const shared = game.serialize(state);
  check('the question is hidden while it is being written', shared.question === null);

  // The suggestion card is the asker's private prompt. If it went to the room,
  // everyone would see the question before it was asked.
  const roomView = JSON.stringify(game.serializeFor(state, state.askedId));
  check('the asker\'s suggestion card is theirs alone', !roomView.includes(state.suggestion ?? ' nope'));
  const askerView = game.serializeFor(state, state.askerId);
  check('but they can see it', typeof askerView.you.suggestion === 'string');

  game.onAction(state, who(state.askerId), { type: 'question', text: 'Who here would you call at 3am?' }, api);
  check('once asked, everyone sees it', game.serialize(state).question?.includes('3am'));
}

/* ---------------------------------- CPUs ---------------------------------- */

{
  const state = start(4, { rounds: 3 });
  let guard = 0;
  // Every player is a CPU, so the whole match has to run on botAction alone.
  while (!state.over && guard++ < 200) {
    for (const p of state.players) {
      const move = game.botAction(state, p);
      if (move) game.onAction(state, who(p.id), move, api);
    }
    game.onTick(state, 1.2, api);
  }
  check('a room full of CPUs plays it through', state.over, `${guard} ticks`);
  const scored = state.players.filter((p) => p.score > 0).length;
  check('and they actually score', scored > 0, `${scored} of 4 on the board`);
}

/* --------------------------------- report --------------------------------- */

const passed = results.filter((r) => r.ok).length;
console.log(`\n  ${passed}/${results.length} checks passed\n`);
for (const f of results.filter((r) => !r.ok)) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
process.exit(passed === results.length ? 0 : 1);
