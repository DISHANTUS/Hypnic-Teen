// The player's journey, written once.
//
// Sign up, get an ID, open the arcade, host a game, play a round with a second
// player. tools/device-test.mjs runs this inside the app on a real phone;
// tools/journey-dry-run.mjs runs the identical steps in desktop Chrome. Sharing
// the code means a dry run on the laptop actually proves the phone run, instead
// of two scripts drifting apart until the interesting one breaks.
//
// A driver supplies three things: evaluate(js) to run code in the page,
// check(label, ok, extra) to record a result, and shot(name) for a screenshot.

export function pageTools(evaluate) {
  const q = (sel) => JSON.stringify(sel);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    wait,
    click: (sel) => evaluate(`const e=document.querySelector(${q(sel)}); if(e) e.click(); return !!e;`),
    textOf: (sel) => evaluate(`const e=document.querySelector(${q(sel)}); return e ? e.textContent.trim() : null;`),
    count: (sel) => evaluate(`return document.querySelectorAll(${q(sel)}).length`),

    typeInto: (sel, value) => evaluate(`
      const e = document.querySelector(${q(sel)});
      if (!e) return false;
      e.focus();
      e.value = ${JSON.stringify(value)};
      e.dispatchEvent(new Event('input', {bubbles:true}));
      e.dispatchEvent(new Event('change', {bubbles:true}));
      return true;
    `),

    async waitFor(sel, timeoutMs = 12000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(`return !!document.querySelector(${q(sel)})`)) return true;
        await wait(200);
      }
      return false;
    },

    async waitForGone(sel, timeoutMs = 8000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!(await evaluate(`return !!document.querySelector(${q(sel)})`))) return true;
        await wait(200);
      }
      return false;
    },
  };
}

/** Starts collecting anything the page throws, so quiet failures still fail. */
export const watchForErrors = (evaluate) => evaluate(`
  window.__journeyErrors = [];
  addEventListener('error', (e) => window.__journeyErrors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__journeyErrors.push(String(e.reason)));
  return true;
`);

/**
 * Walks the whole journey. `joinAsSecondPlayer(code)` should put another player
 * in the room and answer for them; returning null skips the multiplayer leg.
 */
export async function runJourney({ evaluate, check, shot, base, joinAsSecondPlayer, label = 'device' }) {
  const { click, textOf, count, typeInto, waitFor, waitForGone, wait } = pageTools(evaluate);
  let fatal = false;
  const must = (ok) => { if (!ok) fatal = true; return ok; };

  /* the studio opening — plays over everything on a fresh session */
  if (check('the studio opening plays', await waitFor('.studio-intro', 8000))) {
    const motto = ((await textOf('.si-brand')) ?? '').toLowerCase();
    check('the motto is on the title card', motto.includes('imagination is the limit'));
    await wait(1500);
    const rolling = await evaluate(`
      const film = document.querySelector('.si-film');
      return film ? film.currentTime : -1;
    `);
    check('the film is actually rolling', rolling > 0.2, `${Math.round(rolling * 10) / 10}s in`);
    await shot('opening');
    await click('.si-skip');
    check('the opening can be skipped', await waitForGone('.studio-intro'));
  }

  /* the site itself */
  must(check('studio loads', await waitFor('.wordmark'), await textOf('.brand-text b')));
  if (fatal) return { fatal };

  check('live connection to the server', await evaluate(`
    const dot = document.getElementById('conn');
    return dot ? dot.dataset.state === 'on' : false;
  `));
  const words = await count('#marqueeTrack span');
  check('marquee running', words > 10, `${words} words`);
  await shot('landing');

  /* getting a Hypnic ID */
  await click('#createIdBtn');
  if (!must(check('signup opens', await waitFor('#suName')))) return { fatal };

  await typeInto('#suName', label === 'device' ? 'DeviceTest' : 'DryRun');
  await typeInto('#suAge', '18');
  await click('#nextStep');
  await wait(700);

  let answered = 0;
  for (let i = 0; i < 10; i++) {
    if (await evaluate(`return !!document.querySelector('#suPin')`)) break;
    if (await click('.options .option')) answered += 1;
    await wait(650);
  }
  check('quiz questions answerable by tap', answered >= 5, `${answered} answered`);
  await shot('signup');

  if (!must(check('reaches the PIN step', await waitFor('#suPin')))) return { fatal };
  await typeInto('#suPin', '1111');
  await click('#nextStep');

  const id = (await waitFor('#revealId', 15000)) ? await textOf('#revealId') : null;
  must(check('a Hypnic ID is minted', Boolean(id?.includes('Hypnic')), id ?? 'nothing revealed'));
  await shot('id-reveal');
  if (fatal) return { fatal };

  /* the arcade */
  await click('#enterStudioBtn');
  if (!must(check('arcade opens', await waitFor('.game-card')))) return { fatal };
  const cards = await count('.game-card');
  const catalogue = await fetch(`${base}/api/games`).then((r) => r.json());
  check('every game is on the shelf', cards === catalogue.length, `${cards} of ${catalogue.length}`);

  // Hosting used to mean "scroll down and somehow know to press a game".
  check('there is a Host button', await evaluate(`return !!document.getElementById('hostCta')`));
  await click('#hostCta');
  await wait(500);
  check('Host takes you to the games', await evaluate(`
    const grid = document.getElementById('gameGrid');
    if (!grid) return false;
    const box = grid.getBoundingClientRect();
    return box.top < innerHeight && box.bottom > 0;
  `));
  await shot('arcade');

  /* hosting */
  await evaluate(`
    const all = [...document.querySelectorAll('.game-card')];
    const quiz = all.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === 'Quiz');
    (quiz ?? all[0]).click();
    return true;
  `);
  if (!must(check('a room opens', await waitFor('#roomCode', 15000)))) return { fatal };
  const code = await textOf('#roomCode');
  must(check('room code shown', Boolean(code) && code !== '----', code));
  await shot('lobby');
  if (fatal) return { fatal };

  /* the host's controls: setup editing and CPU players */
  check('the host can see an Edit button', await evaluate(`
    const b = document.getElementById('editSetup');
    return Boolean(b) && !b.hidden;
  `));
  check('the setup is described before you open it', ((await textOf('#setupSummary')) ?? '').length > 3, await textOf('#setupSummary'));
  await click('#editSetup');
  const knobs = await count('.setup-field');
  check('editing reveals the lobby settings', knobs > 0, `${knobs} settings`);
  await shot('lobby-setup');
  await click('#editSetup');

  check('CPU players can be added', await evaluate(`
    const b = document.getElementById('botActions');
    return Boolean(b) && !b.hidden;
  `));
  await click('#addBot');
  await wait(900);
  const withBot = await evaluate(`return [...document.querySelectorAll('#playerList .tag')].some(t => t.textContent === 'CPU')`);
  check('a CPU joins the lobby', withBot);
  await click('#dropBot');
  await wait(700);

  /* a second player, from the other machine */
  if (joinAsSecondPlayer) {
    const err = await joinAsSecondPlayer(code);
    check('a PC player can join the room', !err, err ?? 'joined');
    await wait(1500);
    const seats = await count('#playerList li');
    check('lobby shows both players', seats === 2, `${seats} seated`);
    await shot('two-players');
  }

  /* playing */
  await click('#startBtn');

  // A match opens with the rules and a stopped clock, so nobody is learning the
  // game while their answer time drains.
  if (!must(check('the rules come up first', await waitFor('.intro-card', 15000), await textOf('.intro-card h2')))) {
    await shot('start-failed');
    return { fatal };
  }
  const ruleCount = await count('.intro-rules li');
  check('the briefing actually explains the game', ruleCount >= 2, `${ruleCount} lines`);
  await shot('briefing');

  await click('.intro-ready');
  if (!must(check('tapping Ready starts the game', await waitFor('.prompt-card', 20000), await textOf('.prompt-card h2')))) {
    await shot('start-failed');
    return { fatal };
  }
  check('countdown is drawn', await evaluate(`return !!document.querySelector('.timer svg')`));

  const options = await count('.options-grid .option');
  check('answer buttons rendered', options > 0, `${options} choices`);
  await shot('in-game');

  if (options > 0) {
    await click('.options-grid .option');
    // The engine cuts the phase short once everyone has answered, so poll
    // rather than sleeping — otherwise the highlight is gone before we look.
    check('tapping an answer locks it in', await waitFor('.option.picked', 2500));
    await shot('answered');
  }

  // Mass rooms show a crowd meter instead of a chip per player, so which of the
  // two is present depends on the game — either one proves both are counted.
  const chips = await count('.pchip');
  const crowd = await textOf('.crowd-count');
  if (joinAsSecondPlayer) {
    check('both players counted in-game', chips === 2 || /\/\s*2\b/.test(crowd ?? ''), crowd ?? `${chips} chips`);
  }

  /* the round should finish by itself when the timer runs out */
  check('round resolves into results', await waitFor('.reveal-panel', 40000), await textOf('.reveal-panel h2, .reveal-sub'));
  await shot('result');

  /* getting back out again */

  // Mid-match there is no lobby to go back to, so the button forfeits instead
  // — and it must say so rather than offering a door that leads nowhere.
  check('mid-match the button offers to leave, not to go back', ((await textOf('#quitBtn')) ?? '').includes('Leave'), await textOf('#quitBtn'));
  await click('#quitBtn');
  check('leaving a live match lands you somewhere real', await waitFor('.game-card', 8000));

  // And walking back in has to work, not show an empty shell. Where you land
  // depends on the room: if the others are still playing you rejoin the match
  // — which is what you want after a dropped connection — and if they have
  // finished you land in the lobby. Either is a real screen; a blank one is not.
  await evaluate(`location.hash = '#/room/${code}'; return true;`);
  const backIn = await waitFor('#playerList li, #stage', 8000);
  const where = await evaluate(`return document.querySelector('#playerList') ? 'lobby' : (document.querySelector('#stage') ? 'match' : 'nowhere')`);
  check('you can walk back into the room you left', backIn, `rejoined the ${where}`);
  await shot('rejoined');

  /* every sound is synthesised, so no Web Audio means a silent game */
  check('Web Audio supported', await evaluate(`return Boolean(window.AudioContext || window.webkitAudioContext)`));
  check('sound toggle present', await evaluate(`return !!document.getElementById('soundBtn')`));

  const thrown = await evaluate(`return (window.__journeyErrors ?? []).length`);
  check('nothing threw during the round', thrown === 0, thrown ? `${thrown} errors` : '');

  return { fatal: false, id, code };
}

/**
 * Someone else opens a room and calls everyone in. Checks the invite actually
 * shows up here, and that saying yes gets you into their room.
 * `hostElsewhere()` should open a room somewhere else and shout, returning its
 * code.
 */
export async function checkInvite({ evaluate, check, shot, hostElsewhere }) {
  const { click, textOf, waitFor, wait } = pageTools(evaluate);

  // Invites are deliberately suppressed for anyone already in a room, so this
  // has to start from the arcade.
  await evaluate(`location.hash = '#/'; return true;`);
  await wait(1200);

  const code = await hostElsewhere();
  if (!check('someone else opens a room and calls out', Boolean(code), code ?? 'no room')) return;

  if (!check('the invite shows up', await waitFor('.invite-card', 8000), await textOf('.invite-card b'))) return;
  check('it says which room and how many are waiting', /\w{4}/.test((await textOf('.invite-card small')) ?? ''), await textOf('.invite-card small'));
  check('you can say no', await evaluate(`return !!document.querySelector('.invite-card [data-act="skip"]')`));
  await shot('invite');

  await click('.invite-card [data-act="join"]');
  check('saying yes puts you in their room', await waitFor('#roomCode', 8000), await textOf('#roomCode'));
  await shot('invite-joined');
}

/**
 * Signs up a throwaway account and parks it in the room, answering whatever it
 * is shown so the round can progress. It waits a beat first: answering the
 * instant the question lands would end the phase before the player under test
 * has even seen their own tap register.
 */
let guestSeq = 0;
export async function makeGuest(io, base, answerDelayMs = 4000) {
  const nth = guestSeq++;
  const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
  const account = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: nth === 0 ? 'LaptopMate' : `Mate${nth}`,
      age: 19 + nth,
      // Different answers per guest, so each derives its own keyword rather
      // than leaning on the collision path.
      pin: '2222',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + nth) % q.options.length].id])),
    }),
  }).then((r) => r.json());
  if (account.error) throw new Error(`guest signup: ${account.error}`);

  const socket = io(base, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => socket.once('connect', r));

  let answeredRound = -1;
  socket.on('game:state', (s) => {
    // The rules screen holds the match until everyone is ready.
    if (s.phase === 'intro') return socket.emit('game:action', { type: 'ready' });
    if (s.phase !== 'answer' || s.round === answeredRound) return;
    answeredRound = s.round;
    const options = s.prompt?.options;
    setTimeout(() => {
      if (options?.length) socket.emit('game:action', { type: 'choice', optionId: options[0].id });
      else socket.emit('game:action', { type: 'answer', text: 'guess' });
    }, answerDelayMs);
  });

  const join = async (code) => {
    const res = await new Promise((r) => socket.emit('room:join', { code, token: account.token }, r));
    return res?.error ?? null;
  };

  return { socket, join, token: account.token, close: () => socket.close() };
}
