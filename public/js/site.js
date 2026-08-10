// Site shell: hash router, the studio landing, membership flow, lobby and game
// mounting. Game modules live at /games/<id>/client.js and export { mount(ctx) }.

import { Net } from './net.js';
import { Auth } from './auth.js';
import { Theme } from './theme.js';
import { Sound } from './sound.js';
import { confetti } from './fx.js';
import { playIntro, maybePlayIntro } from './intro.js';

const view = document.getElementById('view');
const connDot = document.getElementById('conn');
const topnav = document.getElementById('topnav');
const chip = document.getElementById('profileChip');

let games = [];
let activeGame = null; // { id, unmount }
let lastRoute = '';
let cleanupView = null;
let signupDraft = null; // survives while the wizard is open
let revealObserver = null;

const PUBLIC_ROUTES = ['#/gate', '#/signup', '#/login', '#/reveal', '#/recover'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------- helpers ------------------------------- */

const tpl = (id) => document.getElementById(id).content.cloneNode(true);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const gameById = (id) => games.find((g) => g.id === id);
const initials = (name) => (name ?? '?').trim().slice(0, 1).toUpperCase();

function render(templateId) {
  unmountGame();
  view.replaceChildren(tpl(templateId));
  view.classList.remove('view-enter');
  void view.offsetWidth; // restart the entrance animation
  view.classList.add('view-enter');
  observeReveals();
}

function unmountGame() {
  if (activeGame) {
    try {
      activeGame.unmount?.();
    } catch (err) {
      console.error('unmount failed:', err);
    }
    activeGame = null;
  }
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/** Scroll-driven entrances. Elements start hidden only once JS is here to
 *  reveal them, so a failed observer can never leave the page blank. */
function observeReveals() {
  revealObserver?.disconnect();
  const targets = $$('.reveal', view);
  if (!targets.length) return;
  if (reduceMotion || !('IntersectionObserver' in window)) {
    for (const el of targets) el.classList.add('in');
    return;
  }
  revealObserver = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        obs.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
  );
  for (const el of targets) revealObserver.observe(el);
}

/** Numbers tick up rather than snapping in. */
function countUp(el, value, duration = 900) {
  const target = Number(value) || 0;
  if (reduceMotion || target === 0) {
    el.textContent = String(value);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    el.textContent = String(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Same slot carries good news too — `tone` keeps a confirmation from being
// painted in the same alarming red as a failure.
function showError(el, message, tone = 'error') {
  el.textContent = message;
  el.hidden = !message;
  el.dataset.tone = tone;
}

async function copyText(text, button, doneLabel = 'Copied') {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = doneLabel;
    setTimeout(() => (button.textContent = original), 1600);
  } catch {
    prompt('Copy this:', text);
  }
}

/* ------------------------------- chrome ---------------------------------- */

function paintChrome() {
  const p = Auth.profile;
  topnav.hidden = !p;
  chip.hidden = !p;
  if (!p) return;
  const av = $('#chipAvatar');
  av.textContent = initials(p.name);
  av.style.background = p.accent;
  $('#chipName').textContent = p.name;
  $('#chipLevel').textContent = `Lv ${p.level} · ${p.points} pts`;
}

function paintNav() {
  const hash = location.hash || '#/';
  for (const link of $$('#topnav a')) {
    link.classList.toggle('active', link.dataset.route === hash);
  }
}

Auth.onChange(paintChrome);
chip.addEventListener('click', () => go('#/profile'));

/* ----------------------------- theme picker ------------------------------ */

Theme.apply(Theme.current);
const themeDialog = document.getElementById('themeDialog');
document.getElementById('themeBtn').addEventListener('click', () => {
  Theme.mountPicker(document.getElementById('themeGrid'), () => Sound.play('pick'));
  themeDialog.showModal();
});
document.getElementById('themeClose').addEventListener('click', () => themeDialog.close());
document.getElementById('qrClose').addEventListener('click', () => document.getElementById('qrDialog').close());

/* -------------------------------- sound ---------------------------------- */

const soundBtn = document.getElementById('soundBtn');
const paintSound = (muted) => {
  soundBtn.textContent = muted ? '🔇' : '🔊';
  soundBtn.setAttribute('aria-pressed', String(!muted));
};
paintSound(Sound.muted);
Sound.onChange(paintSound);
soundBtn.addEventListener('click', () => Sound.toggle());

// One delegated listener covers every button in the app, including the ones
// that views create later.
document.addEventListener('pointerdown', (e) => {
  const hit = e.target.closest('.btn, .option, .game-card, .theme-swatch, .big-choice, .vote-item, a[data-nav]');
  if (!hit || hit.disabled) return;
  Sound.play(hit.matches('.back, .btn-quiet') ? 'back' : 'click');
});

/* ------------------------------ game cards ------------------------------- */

function gameCard(game, onPlay) {
  const card = document.createElement('button');
  card.className = 'game-card';
  card.type = 'button';
  card.style.setProperty('--tint', game.accent);
  // A visitor who arrives alone needs to see immediately what they can play.
  const solo = game.minPlayers <= 1;
  card.innerHTML = `
    <span class="emoji">${game.emoji}</span>
    <h3></h3>
    <p></p>
    <div class="card-foot">
      <span>${game.minPlayers === game.maxPlayers ? game.minPlayers : `${game.minPlayers}–${game.maxPlayers}`} players</span>
      <span class="pill ${solo ? 'solo' : ''}">${solo ? 'Solo OK' : `Needs ${game.minPlayers}`}</span>
      <span class="go">Play →</span>
    </div>`;
  $('h3', card).textContent = game.name;
  $('p', card).textContent = game.tagline;
  if (game.status === 'soon') card.disabled = true;
  else card.addEventListener('click', () => onPlay(game));
  return card;
}

/* --------------------------- the studio landing -------------------------- */

// The band under the hero.
//
// Everything except the studio name is Japanese, and stays Japanese — no
// romaji, no translation, no tooltip. It reads as texture and mood rather than
// information, which is the point: it should feel like a game studio's title
// screen, not a feature list.
//
// The pool is deliberately much longer than the band. Each visit shuffles it
// and takes a slice, so the marquee is different every time you land — and the
// loop stays short enough that you actually see the whole thing go past.
const MARQUEE_STUDIO = 'Hypnic Teen Studio';
const MARQUEE_BAND_SIZE = 12; // two full passes over the six languages

// Six languages, ten words each, in their own scripts.
//
// The rule that matters: **no concept appears twice across the pool.** An
// earlier version had 夢幻 / Dreamscape / Sueño / Traum / 梦境 / 꿈 — six ways
// of saying "dream" — which reads as a translation table rather than a studio.
// So each language owns its own territory instead:
//
//   ja  dreams and the uncanny      (the studio's namesake)
//   en  arcade mechanics            (words only games have)
//   es  passion and danger
//   de  structure and menace
//   zh  martial and cosmic
//   ko  fate and feeling
//
// If you add a word, check no other language already carries that meaning.
const MARQUEE_POOL = {
  ja: ['夢幻', '白昼夢', '微睡み', '妖怪', '刹那', '花火', '黄昏', '必殺', '迷宮', '青春'],
  en: ['Respawn', 'Boss Fight', 'Checkpoint', 'High Score', 'Speedrun', 'Combo', 'Loot', 'Power Up', 'Sudden Death', 'Player One'],
  es: ['Corazón', 'Peligro', 'Locura', 'Suerte', 'Reino', 'Tormenta', 'Salto', 'Rival', 'Amanecer', 'Fiesta'],
  de: ['Schatten', 'Klinge', 'Rätsel', 'Jäger', 'Festung', 'Nebel', 'Verrat', 'Rüstung', 'Freiheit', 'Wunder'],
  zh: ['江湖', '剑客', '苍穹', '秘境', '龙', '战友', '雷霆', '逆转', '修行', '无限'],
  ko: ['운명', '각성', '별빛', '우정', '전설', '모험', '불꽃', '승리', '마법', '유령'],
};

const shuffled = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * A fresh band, studio name first, then one word per language in rotation —
 * so eight scripts are always visible at once, in a different order each visit.
 */
function marqueeBand() {
  const queues = shuffled(Object.keys(MARQUEE_POOL)).map((lang) => shuffled(MARQUEE_POOL[lang]));
  const band = [MARQUEE_STUDIO];
  for (let i = 0; band.length <= MARQUEE_BAND_SIZE; i++) {
    const queue = queues[i % queues.length];
    if (queue.length) band.push(queue.pop());
  }
  return band;
}

const SAMPLE_IDS = ['ShadowFox', 'NovaTiger', 'MidnightRaven', 'VoltKraken', 'FrostOwl', 'NitroPhoenix', 'ChronoWolf'];

function renderLanding() {
  render('view-landing');

  // The marquee needs its content duplicated so the loop is seamless.
  const track = $('#marqueeTrack');
  const band = marqueeBand().flatMap((word, i) => [
    Object.assign(document.createElement('span'), {
      textContent: word,
      // The studio name is the one Latin entry — mark it so it can be styled.
      className: i === 0 ? 'studio' : '',
    }),
    Object.assign(document.createElement('i'), { textContent: '✦' }),
  ]);
  track.replaceChildren(...band, ...band.map((el) => el.cloneNode(true)));

  const word = $('#sampleWord');
  let i = 0;
  const spin = reduceMotion
    ? null
    : setInterval(() => {
        i = (i + 1) % SAMPLE_IDS.length;
        word.textContent = SAMPLE_IDS[i];
        word.style.animation = 'none';
        void word.offsetWidth;
        word.style.animation = '';
      }, 1800);
  cleanupView = () => spin && clearInterval(spin);

  for (const btn of ['#createIdBtn', '#createIdBtn2']) {
    $(btn)?.addEventListener('click', () => go('#/signup'));
  }
  $('#haveIdBtn').addEventListener('click', () => go('#/login'));

  // Games are browsable before signing up; picking one starts the ID flow.
  const grid = $('#landingGames');
  grid.replaceChildren(...games.map((g) => gameCard(g, () => go('#/signup'))));
  if (!games.length) grid.innerHTML = '<div class="empty-state">Games are being loaded in.</div>';

  fetch('/api/health')
    .then((r) => r.json())
    .then(({ members }) => {
      const el = $('#memberCount');
      if (!el) return;
      el.textContent = members
        ? `${members} teen${members === 1 ? '' : 's'} already have theirs.`
        : 'Nobody has one yet. Be the first.';
    })
    .catch(() => {});
}

/* ---------------------------- signup wizard ------------------------------ */

async function renderSignup() {
  render('view-signup');

  if (!signupDraft) {
    const { questions, error } = await Auth.quiz();
    if (error) return showError($('#signupError'), error);
    signupDraft = { step: 0, name: '', age: '', pin: '', answers: {}, questions };
  }

  const body = $('#stepBody');
  const errorEl = $('#signupError');
  const bar = $('#progressBar');
  const stepCount = $('#stepCount');
  const prevBtn = $('#prevStep');
  const nextBtn = $('#nextStep');
  const totalSteps = signupDraft.questions.length + 2; // details + quiz + pin

  function paint() {
    const { step, questions } = signupDraft;
    showError(errorEl, '');
    bar.style.width = `${((step + 1) / totalSteps) * 100}%`;
    stepCount.textContent = `Step ${step + 1} of ${totalSteps}`;
    prevBtn.hidden = step === 0;
    nextBtn.textContent = step === totalSteps - 1 ? 'Create my ID' : 'Next';

    body.style.animation = 'none';
    void body.offsetWidth;
    body.style.animation = '';

    if (step === 0) return paintDetails();
    if (step <= questions.length) return paintQuestion(questions[step - 1]);
    return paintPin();
  }

  function paintDetails() {
    body.innerHTML = `
      <h2>First, the basics</h2>
      <p class="muted small">Your name is what friends see in the lobby. Your age helps shape your ID.</p>
      <label class="field"><span>Your name</span>
        <input id="suName" type="text" maxlength="16" placeholder="e.g. Advay" autocomplete="nickname" /></label>
      <label class="field"><span>Your age</span>
        <input id="suAge" type="number" min="8" max="99" placeholder="17" inputmode="numeric" /></label>`;
    $('#suName').value = signupDraft.name;
    $('#suAge').value = signupDraft.age;
    $('#suName').focus();
  }

  function paintQuestion(question) {
    body.innerHTML = '<h2></h2><div class="options"></div>';
    $('h2', body).textContent = question.q;
    const box = $('.options', body);
    for (const opt of question.options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.textContent = opt.label;
      if (signupDraft.answers[question.id] === opt.id) btn.classList.add('picked');
      btn.addEventListener('click', () => {
        signupDraft.answers[question.id] = opt.id;
        for (const el of box.children) el.classList.remove('picked');
        btn.classList.add('picked');
        setTimeout(next, 200); // picking an answer moves you along
      });
      box.appendChild(btn);
    }
  }

  function paintPin() {
    body.innerHTML = `
      <h2>Pick a 4-digit PIN</h2>
      <p class="muted small">You'll need this every time you sign in. Don't reuse your phone unlock code.</p>
      <input id="suPin" type="password" inputmode="numeric" maxlength="4" placeholder="••••" class="pin-input" />`;
    $('#suPin').value = signupDraft.pin;
    $('#suPin').focus();
  }

  function capture() {
    const { step, questions } = signupDraft;
    if (step === 0) {
      signupDraft.name = $('#suName')?.value.trim() ?? '';
      signupDraft.age = $('#suAge')?.value ?? '';
      if (signupDraft.name.length < 2) return 'Enter a name with at least 2 characters.';
      const age = Number(signupDraft.age);
      if (!age || age < 8 || age > 99) return 'Enter an age between 8 and 99.';
      return null;
    }
    if (step <= questions.length) {
      return signupDraft.answers[questions[step - 1].id] ? null : 'Pick one to continue.';
    }
    signupDraft.pin = $('#suPin')?.value ?? '';
    return /^\d{4}$/.test(signupDraft.pin) ? null : 'Your PIN must be exactly 4 digits.';
  }

  async function next() {
    const problem = capture();
    if (problem) return showError(errorEl, problem);

    if (signupDraft.step < totalSteps - 1) {
      signupDraft.step += 1;
      return paint();
    }

    nextBtn.disabled = true;
    nextBtn.textContent = 'Deriving your ID…';
    const res = await Auth.signup({
      name: signupDraft.name,
      age: Number(signupDraft.age),
      pin: signupDraft.pin,
      answers: signupDraft.answers,
    });
    nextBtn.disabled = false;
    nextBtn.textContent = 'Create my ID';
    if (res.error) return showError(errorEl, res.error);
    signupDraft = null;
    go('#/reveal');
  }

  nextBtn.addEventListener('click', next);
  prevBtn.addEventListener('click', () => {
    capture(); // keep whatever they typed
    signupDraft.step = Math.max(0, signupDraft.step - 1);
    paint();
  });
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      next();
    }
  });

  paint();
}

function renderReveal() {
  const p = Auth.profile;
  if (!p) return go('#/gate');
  render('view-reveal');

  // Letter-by-letter landing for the keyword.
  const idEl = $('#revealId');
  const keyword = document.createElement('span');
  keyword.className = 'keyword';
  [...p.keyword].forEach((ch, i) => {
    const letter = document.createElement('i');
    letter.textContent = ch;
    letter.style.animationDelay = `${260 + i * 45}ms`;
    keyword.appendChild(letter);
  });
  idEl.replaceChildren(document.createTextNode('Hypnic>'), keyword, document.createTextNode('<Teen'));

  $('#revealSpirit').textContent = `${p.spirit} · Level ${p.level} · member #${p.memberNumber}`;
  $('#copyIdBtn').addEventListener('click', (e) => copyText(p.id, e.target));
  $('#enterStudioBtn').addEventListener('click', () => go('#/'));

  // Getting your ID is the one genuinely ceremonial moment on the site.
  const section = $('.reveal-screen');
  section.style.position = 'relative';
  setTimeout(() => {
    Sound.play('win');
    confetti(section, { count: 70 });
  }, 320);
}

function renderLogin() {
  render('view-login');
  const errorEl = $('#loginError');
  const idInput = $('#loginId');
  const pinInput = $('#loginPin');

  // Arriving straight from the recovery screen, with the ID already found.
  const recovered = sessionStorage.getItem('htfw:recoveredId');
  if (recovered) {
    idInput.value = recovered;
    sessionStorage.removeItem('htfw:recoveredId');
    setTimeout(() => pinInput.focus(), 60);
  }

  const submit = async () => {
    showError(errorEl, '');
    const res = await Auth.login(idInput.value, pinInput.value);
    if (res.error) return showError(errorEl, res.error);
    go('#/');
  };

  $('#loginBtn').addEventListener('click', submit);
  $('#toSignup').addEventListener('click', () => go('#/signup'));
  $('#forgotId').addEventListener('click', () => go('#/recover'));
  for (const el of [idInput, pinInput]) {
    el.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  }
  idInput.focus();
}

/**
 * Getting an ID back.
 *
 * The ID is the only key to somebody's points, titles and history, and it is
 * two words wrapped in angle brackets — memorable to read, impossible to
 * recall. This asks for the three things only the owner has: their name, their
 * PIN, and whatever they set as a recovery answer.
 */
function renderRecover() {
  render('view-recover');
  const els = {
    name: $('#recName'),
    pin: $('#recPin'),
    answer: $('#recAnswer'),
    answerField: $('#recAnswerField'),
    question: $('#recQuestion'),
    error: $('#recError'),
    found: $('#recFound'),
    id: $('#recId'),
    since: $('#recSince'),
    actions: $('#recActions'),
  };

  // Ask them their own question, as soon as we know which one it is. It also
  // tells them the name is right before they wonder about the PIN.
  let lookup = null;
  els.name.addEventListener('input', () => {
    clearTimeout(lookup);
    const name = els.name.value.trim();
    if (name.length < 2) return (els.answerField.hidden = true);
    lookup = setTimeout(async () => {
      const res = await fetch(`/api/recover/hint?name=${encodeURIComponent(name)}`).then((r) => r.json()).catch(() => ({}));
      els.answerField.hidden = !res?.question;
      if (res?.question) els.question.textContent = res.question;
    }, 350);
  });

  const find = async () => {
    showError(els.error, '');
    const res = await fetch('/api/recover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: els.name.value.trim(),
        pin: els.pin.value.trim(),
        answer: els.answer.value.trim(),
      }),
    }).then((r) => r.json()).catch(() => ({ error: 'Could not reach the studio.' }));

    if (res.error) return showError(els.error, res.error);
    els.found.hidden = false;
    els.actions.hidden = true;
    els.id.textContent = res.id;
    els.since.textContent = `Member since ${res.memberSince}`;
    Sound.play('unlock');
    // Straight into the sign-in box with it already filled in — nobody should
    // have to copy two words out of angle brackets by hand.
    $('#recGo').addEventListener('click', () => {
      sessionStorage.setItem('htfw:recoveredId', res.id);
      go('#/login');
    });
  };

  $('#recFind').addEventListener('click', find);
  for (const el of [els.name, els.pin, els.answer]) {
    el.addEventListener('keydown', (e) => e.key === 'Enter' && find());
  }
  els.name.focus();
}

/* --------------------------------- arcade -------------------------------- */

function renderHome() {
  render('view-home');
  const grid = $('#gameGrid');
  $('#gameCount').textContent = games.length ? `${games.length} live` : '';
  $('#joinCta').addEventListener('click', openJoinDialog);
  // Hosting means picking a game, but that was only discoverable by scrolling.
  // The button takes you to the shelf and makes it obvious that's the next step.
  $('#hostCta').addEventListener('click', () => {
    const head = $('.section-head');
    head?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    grid.classList.add('nudge');
    setTimeout(() => grid.classList.remove('nudge'), 900);
  });

  const p = Auth.profile;
  const cells = [
    ['Games', games.length],
    ['Your points', p?.points ?? 0],
    ['Matches', p?.gamesPlayed ?? 0],
    ['Titles', p?.titles?.length ?? 0],
  ];
  $('#statStrip').replaceChildren(
    ...cells.map(([label, value]) => {
      const box = document.createElement('div');
      box.innerHTML = '<b>0</b><span></span>';
      $('span', box).textContent = label;
      countUp($('b', box), value);
      return box;
    })
  );

  if (!games.length) {
    grid.innerHTML =
      '<div class="empty-state">No games loaded yet.<br />Drop a module into <code>server/games/</code> and it appears here.</div>';
    return;
  }
  grid.replaceChildren(...games.map((g) => gameCard(g, (game) => hostGame(game.id))));

  $('#feedbackBtn').addEventListener('click', openFeedback);

  paintCupColumn();
  // The board is pushed by the server whenever anything changes, so an open
  // cup appears on someone's home screen without them refreshing.
  const offBoard = Net.on('tourney:board', paintCupColumn);
  const prev = cleanupView;
  cleanupView = () => { offBoard(); prev?.(); };
  Net.listCups().then((res) => paintCupColumn(res.tournaments));
}

/* ------------------------------- tournaments ------------------------------ */

let cupBoard = [];

const CUP_STATUS = { open: 'Registration open', running: 'Under way', done: 'Finished' };

/** Time left, in the words a person would use. */
function untilText(ms) {
  if (ms <= 0) return 'any moment now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `in ${hrs}h ${mins % 60}m`;
}

function paintCupColumn(list) {
  if (list) cupBoard = list;
  const column = document.getElementById('cupColumn');
  const box = document.getElementById('cupList');
  if (!column || !box) return; // not on the home screen any more

  document.getElementById('newCupBtn').onclick = openCupDialog;

  // Finished cups are history; the column is for what you can still join or
  // watch. An empty column still shows, because "Run one" lives in it.
  const live = cupBoard.filter((t) => t.status !== 'done');
  column.hidden = false;

  if (!live.length) {
    box.innerHTML = '<div class="empty-state">No tournaments running. Start one and everybody gets a bracket.</div>';
    return;
  }

  box.replaceChildren(
    ...live.map((t) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cup-card';
      card.dataset.status = t.status;
      card.innerHTML =
        '<span class="cup-trophy">🏆</span>' +
        '<span class="cup-body"><b></b><small></small></span>' +
        '<span class="cup-tag"></span>';
      $('b', card).textContent = t.name;
      const size = t.mode === 'teams' ? `${t.teams.length} teams` : `${t.entrants.length} players`;
      $('small', card).textContent =
        t.status === 'open'
          ? `${t.gameName} · ${size} · starts ${untilText(t.startsAt - Date.now())}`
          : `${t.gameName} · ${size} · ${CUP_STATUS[t.status]}`;
      $('.cup-tag', card).textContent = t.entrants.some((e) => e.id === Net.playerId) ? 'Entered' : CUP_STATUS[t.status];
      card.addEventListener('click', () => go(`#/cup/${t.id}`));
      return card;
    })
  );
}

function openCupDialog() {
  const dlg = document.getElementById('cupDialog');
  const pick = document.getElementById('cupGame');
  pick.replaceChildren(
    ...games.map((g) => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.emoji} ${g.name}`;
      return opt;
    })
  );

  const mode = document.getElementById('cupMode');
  const sizeField = document.getElementById('cupSizeField');
  mode.onchange = () => { sizeField.hidden = mode.value !== 'teams'; };
  mode.value = 'solo';
  sizeField.hidden = true;

  // Each game brings its own knobs, so the panel is rebuilt whenever the game
  // changes — a quiz's round count means nothing to Ship Attack.
  let tieSettings = {};
  const paintTieSetup = () => {
    tieSettings = {};
    const options = gameById(pick.value)?.options ?? null;
    const box = document.getElementById('cupSetup');
    box.hidden = !options;
    if (!options) return box.replaceChildren();
    // Cup ties default shorter than a friendly: a bracket is many matches.
    const suggested = {};
    if (options.rounds) suggested.rounds = Math.max(options.rounds.min ?? 1, Math.ceil((options.rounds.default ?? 5) / 2));
    if (options.pace) suggested.pace = 'brisk';
    buildSetupFields(box, options, { ...suggested, ...tieSettings }, (key, value) => {
      tieSettings[key] = value;
      Sound.play('pick');
    });
    tieSettings = { ...suggested };
  };
  pick.onchange = paintTieSetup;
  paintTieSetup();

  // Half an hour out is the sane default: long enough to round people up.
  const soon = new Date(Date.now() + 30 * 60000);
  document.getElementById('cupStart').value =
    `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
  document.getElementById('cupTitle').value = '';
  document.getElementById('cupPrize').value = '';
  showError(document.getElementById('cupFormError'), '');

  document.getElementById('cupCancel').onclick = () => dlg.close();
  document.getElementById('cupCreate').onclick = async () => {
    const [h, m] = (document.getElementById('cupStart').value || '').split(':').map(Number);
    const when = new Date();
    if (Number.isFinite(h)) {
      when.setHours(h, m || 0, 0, 0);
      // A time that has already passed today means tonight, not this morning.
      if (when.getTime() < Date.now()) when.setDate(when.getDate() + 1);
    }
    const res = await Net.createCup({
      gameId: pick.value,
      name: document.getElementById('cupTitle').value.trim(),
      mode: mode.value,
      teamSize: Number(document.getElementById('cupTeamSize').value),
      reward: document.getElementById('cupPrize').value.trim(),
      settings: tieSettings,
      startsAt: Number.isFinite(h) ? when.getTime() : Date.now() + 30 * 60000,
    });
    if (res.error) return showError(document.getElementById('cupFormError'), res.error);
    dlg.close();
    Sound.play('start');
    go(`#/cup/${res.tournament.id}`);
  };

  dlg.showModal();
}

function renderCup(id) {
  render('view-cup');

  const els = {
    name: $('#cupName'),
    meta: $('#cupMeta'),
    reward: $('#cupReward'),
    clock: $('#cupClock'),
    actions: $('#cupActions'),
    error: $('#cupError'),
    count: $('#cupCount'),
    teams: $('#cupTeams'),
    entrants: $('#cupEntrants'),
    bracketWrap: $('#cupBracketWrap'),
    bracket: $('#cupBracket'),
    emoji: $('#cupEmoji'),
  };

  const paint = (t) => {
    if (!t) {
      els.name.textContent = 'No such tournament';
      return;
    }
    const mine = t.entrants.some((e) => e.id === Net.playerId);
    const isHost = t.hostId === Net.playerId;

    els.emoji.textContent = gameById(t.gameId)?.emoji ?? '🏆';
    els.name.textContent = t.name;
    // People should know what they are signing up for before they sign up.
    const tie = describeSettings(gameById(t.gameId)?.options, t.settings);
    els.meta.textContent =
      `${t.gameName} · ${t.mode === 'teams' ? `${t.teamSize} a side` : 'solo'} · run by ${t.hostName}` +
      (tie ? ` · ties: ${tie}` : '');
    els.reward.hidden = !t.reward;
    els.reward.textContent = t.reward ? `🏅 ${t.reward}` : '';

    els.clock.textContent =
      t.status === 'done'
        ? `Champion: ${t.champion?.name ?? 'nobody'}`
        : t.status === 'running'
          ? 'Under way — your tie will open by itself when it is your turn.'
          : `Starts ${untilText(t.startsAt - Date.now())}`;
    els.clock.dataset.state = t.status;

    /* ---- what you can do from here ---- */
    els.actions.replaceChildren();
    const button = (label, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn ${cls}`;
      b.textContent = label;
      b.addEventListener('click', async () => {
        showError(els.error, '');
        const res = await fn();
        if (res?.error) return showError(els.error, res.error);
        Sound.play('pick');
        if (res?.tournament) paint(res.tournament);
      });
      els.actions.appendChild(b);
      return b;
    };

    if (t.status === 'open') {
      if (!mine) {
        button('Enter', 'btn-primary', () => {
          // Teams mode asks who you are playing with; typing the same name as
          // your friend is how you end up on the same side.
          const team = t.mode === 'teams'
            ? (prompt(`Team name — type the same one as your friends, or leave blank to be paired at random.`) ?? '')
            : '';
          return Net.joinCup(t.id, team);
        });
      } else {
        button('Withdraw', 'btn-quiet', () => Net.leaveCup(t.id));
      }
      if (isHost) {
        if (t.mode === 'teams') button('Pair the strays', 'btn-ghost', () => Net.pairCup(t.id));
        button('Start the bracket', 'btn-primary', () => Net.startCup(t.id));
      }
    }

    // There was no way to get rid of one. A tournament started by mistake, or
    // abandoned when the room lost interest, stayed at the top of everybody's
    // home screen for good — only finished ones were ever swept away.
    if (isHost || Auth.profile?.isOwner) {
      button('Call it off', 'btn-quiet', async () => {
        if (!confirm(`Call off "${t.name}"? Everyone entered will lose their place.`)) return null;
        const res = await Net.cancelCup(t.id);
        if (res?.ok) {
          toast(`"${res.name}" is off`);
          go('#/');
        }
        return res;
      });
    }

    /* ---- who is in ---- */
    els.entrants.hidden = t.status === 'done';
    els.count.textContent = t.mode === 'teams' ? `${t.teams.length} teams` : `${t.entrants.length}`;
    const unteamed = t.entrants.filter((e) => !e.teamId);
    els.teams.replaceChildren(
      ...t.teams.map((team) => {
        const row = document.createElement('div');
        row.className = 'cup-team';
        row.innerHTML = '<b></b><span></span>';
        $('b', row).textContent = team.name;
        $('span', row).textContent = team.members.join(', ');
        return row;
      }),
      ...(t.mode === 'solo'
        ? t.entrants.map((e) => {
            const row = document.createElement('div');
            row.className = 'cup-team';
            row.innerHTML = '<b></b><span></span>';
            $('b', row).textContent = e.name;
            $('span', row).textContent = e.id === Net.playerId ? 'you' : '';
            return row;
          })
        : unteamed.length
          ? [(() => {
              const row = document.createElement('div');
              row.className = 'cup-team cup-strays';
              row.innerHTML = '<b>Not yet on a team</b><span></span>';
              $('span', row).textContent = unteamed.map((e) => e.name).join(', ');
              return row;
            })()]
          : [])
    );

    /* ---- the bracket ---- */
    els.bracketWrap.hidden = !t.rounds.length;
    els.bracket.replaceChildren(
      ...t.rounds.map((round) => {
        const col = document.createElement('div');
        col.className = 'bracket-round';
        const head = document.createElement('h4');
        head.textContent = round.name;
        col.appendChild(head);
        for (const m of round.matches) {
          const tie = document.createElement('div');
          tie.className = 'tie';
          if (m.done) tie.classList.add('settled');
          for (const side of ['a', 'b']) {
            const row = document.createElement('div');
            row.className = 'tie-side';
            if (m[side] && m.winner === m[side].id) row.classList.add('won');
            if (m.done && m[side] && m.winner !== m[side].id) row.classList.add('out');
            row.textContent = m[side]?.name ?? '—';
            tie.appendChild(row);
          }
          if (m.score) {
            const score = document.createElement('small');
            score.textContent = m.score;
            tie.appendChild(score);
          }
          col.appendChild(tie);
        }
        return col;
      })
    );

    if (t.status === 'done' && t.champion) {
      const crown = document.createElement('div');
      crown.className = 'cup-champion';
      crown.innerHTML = '<span>🏆</span><b></b>';
      $('b', crown).textContent = `${t.champion.name} wins${t.reward ? ` — ${t.reward}` : ''}`;
      els.bracketWrap.prepend(crown);
    }
  };

  Net.getCup(id).then((res) => paint(res.tournament));
  // Live: every registration, every result, without a refresh.
  const off = Net.on('tourney:state', (t) => { if (t.id === id) paint(t); });
  const prev = cleanupView;
  cleanupView = () => { off(); prev?.(); };
}

async function hostGame(gameId) {
  const res = await Net.createRoom(gameId);
  if (res.error) return alert(res.error);
  go(`#/room/${res.code}`);
}

function openJoinDialog() {
  const dlg = document.getElementById('joinDialog');
  const input = document.getElementById('codeInput');
  const err = document.getElementById('joinError');
  input.value = '';
  err.hidden = true;
  dlg.showModal();
  input.focus();

  dlg.addEventListener(
    'close',
    async () => {
      if (dlg.returnValue !== 'join') return;
      const code = input.value.toUpperCase().trim();
      if (code.length < 4) return;
      const res = await Net.joinRoom(code);
      if (res.error) {
        err.textContent = res.error;
        err.hidden = false;
        dlg.showModal();
        return;
      }
      go(`#/room/${res.code}`);
    },
    { once: true }
  );
}

/* --------------------------------- lobby --------------------------------- */

/* ------------------------------ lobby setup ------------------------------- */

/** One line the whole room can read: "8 rounds · Blitz (×2 points)". */
function describeSettings(options, settings) {
  if (!options) return '';
  return Object.entries(options)
    .map(([key, spec]) => {
      const value = settings?.[key] ?? spec.default;
      if (spec.kind === 'choice') {
        const choice = spec.choices.find((c) => c.id === value);
        return choice ? `${choice.label}${choice.note ? ` (${choice.note})` : ''}` : null;
      }
      if (spec.kind === 'toggle') return value ? spec.label : null;
      // "1 rounds" reads like a bug even when it is not, and cup ties are
      // routinely one of something.
      const label = spec.label.toLowerCase();
      return `${value} ${Number(value) === 1 ? label.replace(/s$/, '') : label}`;
    })
    .filter(Boolean)
    .join(' · ');
}

/**
 * Builds the host's controls from whatever the game declares, so a new game
 * gets an editor for its own knobs without this function learning about it.
 */
function buildSetupFields(box, options, settings, onChange) {
  box.replaceChildren();
  for (const [key, spec] of Object.entries(options ?? {})) {
    const value = settings?.[key] ?? spec.default;
    const field = document.createElement('label');
    field.className = 'setup-field';

    const head = document.createElement('span');
    head.className = 'setup-label';
    head.textContent = spec.label;
    if (spec.hint) {
      const hint = document.createElement('small');
      hint.textContent = spec.hint;
      head.appendChild(hint);
    }
    field.appendChild(head);

    if (spec.kind === 'choice') {
      const row = document.createElement('div');
      row.className = 'setup-choices';
      for (const choice of spec.choices) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'setup-choice';
        btn.dataset.id = choice.id;
        if (choice.id === value) btn.classList.add('on');
        btn.innerHTML = '<b></b><small></small>';
        $('b', btn).textContent = choice.label;
        $('small', btn).textContent = choice.note ?? '';
        btn.addEventListener('click', () => onChange(key, choice.id));
        row.appendChild(btn);
      }
      field.appendChild(row);
    } else if (spec.kind === 'toggle') {
      const box2 = document.createElement('input');
      box2.type = 'checkbox';
      box2.checked = Boolean(value);
      box2.addEventListener('change', () => onChange(key, box2.checked));
      field.appendChild(box2);
    } else {
      const row = document.createElement('div');
      row.className = 'setup-number';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = spec.min;
      input.max = spec.max;
      input.step = spec.step ?? 1;
      input.value = value;

      // A slider is quick but it cannot be precise, and it cannot go past its
      // own end. The host sets the rules of their own room, so the number is
      // also typeable — including numbers outside what the slider can reach,
      // where the game allows it.
      const out = document.createElement('input');
      out.type = 'number';
      out.className = 'setup-exact';
      out.min = spec.min;
      out.max = spec.hardMax ?? spec.max;
      out.step = spec.step ?? 1;
      out.value = value;
      out.setAttribute('aria-label', spec.label);

      const settle = (raw, from) => {
        const n = Math.round(Number(raw));
        if (!Number.isFinite(n)) return;
        const capped = Math.min(spec.hardMax ?? spec.max, Math.max(spec.min, n));
        if (from !== 'slider') input.value = Math.min(spec.max, capped);
        if (from !== 'typed') out.value = capped;
        onChange(key, capped);
      };

      // Paint while dragging, but only tell the server when the finger lifts.
      input.addEventListener('input', () => (out.value = input.value));
      input.addEventListener('change', () => settle(input.value, 'slider'));
      out.addEventListener('change', () => settle(out.value, 'typed'));
      out.addEventListener('keydown', (e) => e.key === 'Enter' && settle(out.value, 'typed'));

      row.append(input, out);
      if (spec.hardMax && spec.hardMax > spec.max) {
        const note = document.createElement('small');
        note.className = 'setup-reach';
        note.textContent = `type up to ${spec.hardMax}`;
        row.appendChild(note);
      }
      field.appendChild(row);
    }

    box.appendChild(field);
  }
}

/** A dead end always needs a way out. */
function backToArcadeLink(text = 'Back to the arcade') {
  const a = document.createElement('a');
  a.href = '#/';
  a.dataset.nav = '';
  a.className = 'accent-text';
  a.textContent = text;
  return a;
}

function renderLobby(code) {
  lastRoute = `${code}:lobby`;
  render('view-lobby');

  const els = {
    emoji: $('#lobbyEmoji'),
    name: $('#lobbyGame'),
    tagline: $('#lobbyTagline'),
    code: $('#roomCode'),
    hint: $('#joinHint'),
    list: $('#playerList'),
    count: $('#playerCount'),
    start: $('#startBtn'),
    error: $('#lobbyError'),
    setupSummary: $('#setupSummary'),
    setupFields: $('#setupFields'),
    editSetup: $('#editSetup'),
  };

  // Kept open across repaints — a slider that folds itself away every time a
  // player joins is unusable in a busy lobby.
  let setupOpen = false;

  /**
   * Draws the host's controls from whatever the game declares. Called both on
   * open and on every repaint: building them only on the next broadcast meant
   * pressing Edit revealed an empty box until someone else happened to move.
   */
  function renderSetup(room) {
    if (!room?.options || !setupOpen) return;
    buildSetupFields(els.setupFields, room.options, room.settings, async (key, value) => {
      const res = await Net.updateSettings({ [key]: value });
      if (res?.error) showError(els.error, res.error);
      else Sound.play('pick');
    });
  }

  els.editSetup.addEventListener('click', () => {
    setupOpen = !setupOpen;
    els.setupFields.hidden = !setupOpen;
    els.editSetup.textContent = setupOpen ? 'Done' : 'Edit';
    if (setupOpen) {
      Sound.play('click');
      renderSetup(Net.room);
    }
  });

  els.code.textContent = code;

  // Landing on a room you are not in — after leaving, after a refresh, or from
  // a shared link — used to paint a dead lobby that never filled in and whose
  // Start button did nothing. Ask to be let in instead.
  if (Net.room?.code !== code) {
    els.start.disabled = true;
    els.start.textContent = 'Joining…';
    Net.joinRoom(code).then((res) => {
      if (res?.error) {
        showError(els.error, `${res.error} `);
        els.error.appendChild(backToArcadeLink());
        els.start.textContent = 'Start game';
      }
      // A success arrives as room:joined, which paintRoom already handles.
    });
  }

  // Two addresses, two audiences. The one in the address bar works for whoever
  // is on the same network; a friend somewhere else needs the public one, and
  // sending them a 192.168 link is the single easiest way to waste an evening.
  let inviteUrl = `${location.origin}/#/room/${code}`;
  let farUrl = null;

  const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);

  const paintInvite = () => {
    els.hint.replaceChildren();
    const line = (label, url) => {
      const row = document.createElement('span');
      row.className = 'join-line';
      row.innerHTML = '<b></b><code></code>';
      $('b', row).textContent = label;
      $('code', row).textContent = url;
      els.hint.appendChild(row);
    };
    if (isLocal) line('In the room', inviteUrl);
    else line('Send them', inviteUrl);
    if (farUrl && farUrl !== inviteUrl) line('Anywhere else', farUrl);
  };
  paintInvite();

  // The launcher tells the server its public address once the tunnel is up,
  // which may be before this screen was drawn or a minute after it.
  const useFar = (publicUrl) => {
    if (!publicUrl) return;
    farUrl = `${publicUrl}/#/room/${code}`;
    paintInvite();
  };
  fetch('/api/where').then((r) => r.json()).then(({ publicUrl }) => useFar(publicUrl)).catch(() => {});
  const offWhere = Net.on('app:where', ({ publicUrl }) => useFar(publicUrl));
  const prevCleanup = cleanupView;
  cleanupView = () => { offWhere(); prevCleanup?.(); };

  // Copy whichever link reaches the most people.
  $('#copyLink').addEventListener('click', (e) => copyText(farUrl ?? inviteUrl, e.target));

  // The host puts this on screen and the room scans it — the fastest way to get
  // a crowd into a game with no internet and no typing.
  $('#showQr').addEventListener('click', () => {
    const dlg = document.getElementById('qrDialog');
    // The QR is for the people in the room holding up their phones, so it is
    // always the local address — a tunnel URL would route them out to the
    // internet and back for no reason, and would break the moment it changes.
    const qr = document.getElementById('qrImage');
    qr.src = `/api/qr.svg?text=${encodeURIComponent(inviteUrl)}`;
    qr.hidden = false;
    document.getElementById('qrCaption').textContent = inviteUrl;
    dlg.showModal();
  });

  if (navigator.share) {
    const shareBtn = $('#shareLink');
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', () =>
      navigator
        .share({ title: 'Hypnic Teen — Fun World', text: `Join my room: ${code}`, url: inviteUrl })
        .catch(() => {})
    );
  }

  // CPU players: a solo host can start anything, and a short room can be
  // topped up rather than waiting for stragglers.
  const botBtn = async (sel, fn) => {
    $(sel).addEventListener('click', async () => {
      const res = await fn();
      if (res?.error) showError(els.error, res.error);
      else Sound.play('join');
    });
  };
  botBtn('#addBot', () => Net.addBot());
  botBtn('#dropBot', () => Net.removeBot());
  botBtn('#fillBots', () => Net.fillWithBots());

  const callBtn = $('#callEveryone');
  callBtn.addEventListener('click', async () => {
    showError(els.error, '');
    const res = await Net.invite();
    if (res?.error) return showError(els.error, res.error);
    Sound.play('join');

    // Say who it reached. "Called 5 people" and "nobody else is online" look
    // identical from the host's chair otherwise, which is how you end up
    // pressing a button that does nothing and never finding out.
    const reached = res?.reached ?? 0;
    showError(
      els.error,
      reached
        ? `Called ${reached} ${reached === 1 ? 'person' : 'people'} on the site.`
        : 'Nobody else is on the site right now — send them the code or the QR.',
      reached ? 'note' : 'warn'
    );

    // The cooldown is the server's rule; the button just stops lying about it.
    callBtn.disabled = true;
    const label = callBtn.textContent;
    let left = 30;
    callBtn.textContent = `Called! ${left}s`;
    const tick = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(tick);
        callBtn.disabled = false;
        callBtn.textContent = label;
      } else {
        callBtn.textContent = `Called! ${left}s`;
      }
    }, 1000);
  });

  els.start.addEventListener('click', async () => {
    showError(els.error, '');
    const res = await Net.startGame();
    if (res.error) showError(els.error, res.error);
  });

  $('#leaveBtn').addEventListener('click', () => {
    Net.leaveRoom();
    go('#/');
  });

  $('#dmForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#dmInput');
    if (input.value.trim()) Net.chat(input.value);
    input.value = '';
  });

  let lastCount = -1;
  const paintRoom = (room) => {
    if (!room || room.code !== code) return;
    // A chime when someone walks in is the whole point of a lobby.
    if (lastCount >= 0 && room.players.length !== lastCount) {
      Sound.play(room.players.length > lastCount ? 'join' : 'leave');
    }
    lastCount = room.players.length;
    const meta = gameById(room.gameId);
    els.emoji.textContent = meta?.emoji ?? '🎮';
    els.name.textContent = room.gameName;
    els.tagline.textContent = meta?.tagline ?? '';
    els.count.textContent = `${room.players.length}/${room.maxPlayers}`;

    els.list.replaceChildren(
      ...room.players.map((p) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span class="avatar small"></span>
          <span class="pcol"><span class="pname"></span><small></small></span>`;
        const av = $('.avatar', li);
        av.textContent = initials(p.name);
        av.style.background = p.accent ?? 'var(--accent)';
        av.classList.toggle('offline', !p.connected);

        $('.pname', li).textContent = p.name + (p.id === Net.playerId ? ' (you)' : '');
        $('small', li).textContent = [p.title ? `${p.title.emoji} ${p.title.name}` : null, `Lv ${p.level ?? 1}`]
          .filter(Boolean)
          .join(' · ');

        const tag = document.createElement('span');
        tag.className = p.isBot ? 'tag bot' : p.isHost ? 'tag host' : 'tag';
        tag.textContent = p.isBot ? 'CPU' : p.isHost ? 'Host' : p.connected ? 'Ready' : 'Away';
        li.appendChild(tag);
        return li;
      })
    );

    // Say exactly how many more people are needed, rather than letting someone
    // press Start and get an error.
    const isHost = room.hostId === Net.playerId;
    const here = room.players.filter((p) => p.connected).length;
    const short = Math.max(0, (room.minPlayers ?? 1) - here);
    // Only the host can call the room out, so nobody else needs the button.
    $('#callEveryone').hidden = !isHost;
    $('#botActions').hidden = !isHost;
    $('#dropBot').disabled = !room.players.some((p) => p.isBot);
    $('#fillBots').disabled = here >= (room.minPlayers ?? 1);

    // Everyone sees the setup; only the host can touch it.
    els.setupSummary.textContent = describeSettings(room.options, room.settings) || 'Standard rules';
    els.editSetup.hidden = !isHost || !room.options;
    if (isHost) renderSetup(room);
    else els.setupFields.hidden = true;
    if (!isHost) {
      els.start.disabled = true;
      els.start.textContent = 'Waiting for host…';
    } else if (short > 0) {
      els.start.disabled = true;
      els.start.textContent = `Need ${short} more player${short === 1 ? '' : 's'}`;
    } else {
      els.start.disabled = false;
      els.start.textContent = 'Start game';
    }
    if (room.phase === 'playing') mountGame(room);
  };

  paintRoom(Net.room);
  const offRoom = Net.on('room:state', paintRoom);
  const offJoin = Net.on('room:joined', (p) => paintRoom(p.room));
  const offChat = Net.on('chat:message', (msg) => {
    const log = $('#dmLog');
    if (!log) return;
    if (msg.name !== Auth.profile?.name) Sound.play('chat');
    const li = document.createElement('li');
    li.innerHTML = '<b></b> <span></span>';
    $('b', li).textContent = `${msg.name}:`;
    $('span', li).textContent = msg.text;
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  });

  cleanupView = () => {
    offRoom();
    offJoin();
    offChat();
  };

  // Landed here from an invite link without ever joining - join now.
  if (!Net.room || Net.room.code !== code) {
    Net.joinRoom(code).then((res) => {
      if (res.error) showError(els.error, res.error);
    });
  }
}

/* ------------------------------ leaderboard ------------------------------ */

async function renderLeaderboard() {
  render('view-leaderboard');
  const gameSel = $('#boardGame');
  const sortSel = $('#boardSort');
  const list = $('#boardList');

  for (const g of games) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.emoji} ${g.name}`;
    gameSel.appendChild(opt);
  }

  async function load() {
    sortSel.querySelector('option[value="best"]').disabled = !gameSel.value;
    if (!gameSel.value && sortSel.value === 'best') sortSel.value = 'points';

    const rows = await Auth.leaderboard({ gameId: gameSel.value, sort: sortSel.value });
    if (rows.error || !rows.length) {
      list.innerHTML = '<li class="empty-state">Nobody on this board yet. Go play something.</li>';
      return;
    }
    list.replaceChildren(
      ...rows.map((r) => {
        const li = document.createElement('li');
        if (r.id === Auth.profile?.id) li.classList.add('me');
        li.innerHTML = `
          <span class="rank"></span>
          <span class="avatar small"></span>
          <span class="pcol"><span class="pname"></span><small></small></span>
          <span class="value"></span>`;
        $('.rank', li).textContent = r.rank;
        const av = $('.avatar', li);
        av.textContent = initials(r.name);
        av.style.background = r.accent;
        $('.pname', li).textContent = r.name;
        $('small', li).textContent = [`Lv ${r.level}`, r.spirit, ...r.titles.map((t) => `${t.emoji} ${t.name}`)]
          .filter(Boolean)
          .join(' · ');
        countUp($('.value', li), r.value, 700);
        return li;
      })
    );
  }

  gameSel.addEventListener('change', load);
  sortSel.addEventListener('change', load);
  load();
}

/* --------------------------------- profile ------------------------------- */

async function renderProfile() {
  await Auth.refresh();
  const p = Auth.profile;
  if (!p) return go('#/gate');

  render('view-profile');
  const av = $('#profAvatar');
  av.textContent = initials(p.name);
  av.style.background = p.accent;
  $('#profName').textContent = p.name;
  $('#profId').textContent = p.id;
  $('#profSpirit').textContent = `${p.spirit} · Level ${p.level} · member #${p.memberNumber}`;

  /* ---- the way back in ---- */

  const hasIt = Boolean(p.recovery?.question);
  const box = {
    state: $('#recoveryState'),
    blurb: $('#recoveryBlurb'),
    form: $('#recoveryForm'),
    toggle: $('#recToggle'),
    q: $('#recQ'),
    a: $('#recA'),
    error: $('#recSaveError'),
  };

  const paintRecovery = () => {
    const set = Boolean(Auth.profile?.recovery?.question);
    box.state.textContent = set ? '✅ Set' : '⚠️ Not set';
    box.state.classList.toggle('warn', !set);
    box.blurb.textContent = set
      ? `If you ever lose your ID, your name, your PIN and “${Auth.profile.recovery.question}” will find it again.`
      : 'Your Hypnic ID is the only key to your points and titles. Set a question now and your name and PIN can recover it later.';
    box.toggle.textContent = set ? 'Change it' : 'Set it up';
  };
  paintRecovery();

  box.toggle.addEventListener('click', () => {
    box.form.hidden = !box.form.hidden;
    if (!box.form.hidden) {
      box.q.value = Auth.profile?.recovery?.question ?? '';
      box.q.focus();
    }
  });

  $('#recSave').addEventListener('click', async () => {
    showError(box.error, '');
    const res = await fetch('/api/recovery', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${Auth.token}` },
      body: JSON.stringify({ question: box.q.value.trim(), answer: box.a.value.trim() }),
    }).then((r) => r.json()).catch(() => ({ error: 'Could not reach the studio.' }));
    if (res.error) return showError(box.error, res.error);
    await Auth.refresh();
    box.form.hidden = true;
    box.a.value = '';
    paintRecovery();
    Sound.play('unlock');
    showError(box.error, 'Saved. You can get your ID back now.', 'note');
  });

  /* ---- what people have said (owner only) ---- */

  // 403 for everyone else, so the panel simply never appears — the server
  // decides who the owner is, not this page.
  fetch('/api/feedback', { headers: { authorization: `Bearer ${Auth.token}` } })
    .then((r) => (r.ok ? r.json() : null))
    .then((box) => {
      if (!box) return;
      const list = $('#inboxList');
      $('#inboxBox').hidden = false;

      const paint = (items, unread) => {
        $('#inboxState').textContent = unread ? `${unread} unread` : `${items.length} in total`;
        $('#inboxState').classList.toggle('warn', unread > 0);

        if (!items.length) {
          list.innerHTML = '<p class="muted small">Nothing yet. The button is on the arcade page.</p>';
          return;
        }
        list.replaceChildren(
          ...items.slice(0, 30).map((item) => {
            const row = document.createElement('article');
            row.className = `note-in${item.read ? ' read' : ''}`;
            row.innerHTML =
              '<header><b></b><time></time></header><p></p><small></small><div class="note-acts"></div>';
            $('b', row).textContent = { bug: '🐞 Broken', idea: '💡 Idea', game: '🎮 A game', other: '💬 Something else' }[item.kind] ?? '💬';
            $('time', row).textContent = when(item.at);
            $('p', row).textContent = item.text;
            // Who said it, in the order a person reads: the name they go by,
            // then the ID needed to actually find them. An ID alone was
            // unreadable, and a report you cannot attribute is one you cannot
            // follow up.
            $('small', row).textContent =
              [
                item.fromName ? `${item.fromName} · ${item.from}` : item.from || 'not signed in',
                item.where,
              ]
                .filter(Boolean)
                .join(' · ');

            // What has already been said back, so the same person is not
            // answered twice — the reply itself lands in their notifications,
            // where this panel cannot see it.
            for (const r of item.replies ?? []) {
              const said = document.createElement('p');
              said.className = 'note-reply';
              said.innerHTML = '<span>You replied</span><b></b><time></time>';
              $('b', said).textContent = r.text;
              $('time', said).textContent = when(r.at);
              row.insertBefore(said, $('.note-acts', row));
            }

            const act = (text, fn) => {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'btn btn-quiet btn-sm';
              b.textContent = text;
              b.addEventListener('click', async () => {
                const res = await fetch(`/api/feedback/${item.id}`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', authorization: `Bearer ${Auth.token}` },
                  body: JSON.stringify(fn),
                }).then((r) => r.json()).catch(() => null);
                if (!res) return;
                const fresh = await fetch('/api/feedback', { headers: { authorization: `Bearer ${Auth.token}` } }).then((r) => r.json());
                paint(fresh.items, fresh.unread);
              });
              $('.note-acts', row).appendChild(b);
            };
            if (!item.read) act('Mark read', { read: true });
            act('Delete', { remove: true });

            // Answering somebody who was not signed in has nowhere to go, so
            // the box is not offered rather than offered and then refused.
            if (item.from) {
              const form = document.createElement('form');
              form.className = 'note-answer';
              form.innerHTML =
                '<input type="text" maxlength="900" placeholder="Write back…" autocomplete="off" />' +
                '<button class="btn btn-primary btn-sm" type="submit">Send</button>';
              form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const box = $('input', form);
                const text = box.value.trim();
                if (!text) return;
                const btn = $('button', form);
                btn.disabled = true;
                btn.textContent = 'Sending…';
                const res = await fetch(`/api/feedback/${item.id}`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', authorization: `Bearer ${Auth.token}` },
                  body: JSON.stringify({ reply: text }),
                }).then((r) => r.json()).catch(() => null);
                btn.disabled = false;
                btn.textContent = 'Send';
                if (!res || res.error) return toast(res?.error ?? 'Could not send that.');
                box.value = '';
                toast(`Sent to ${item.fromName ?? item.from}`);
                const fresh = await fetch('/api/feedback', { headers: { authorization: `Bearer ${Auth.token}` } }).then((r) => r.json());
                paint(fresh.items, fresh.unread);
              });
              row.appendChild(form);
            }
            return row;
          })
        );
      };

      paint(box.items, box.unread);
      // The inbox answering at all is the server saying this is the owner, so
      // the composer belongs to the same answer rather than a second check.
      setUpComposer();
    })
    .catch(() => {});

  /* ---- saying something, to everyone or to one person (owner only) ---- */

  /**
   * Until now the only way to post a notice was to call the API by hand, which
   * meant in practice that nothing was ever announced.
   */
  function setUpComposer() {
    const box = $('#sayBox');
    if (!box || box.dataset.ready) return;
    box.dataset.ready = '1';
    box.hidden = false;

    let who = 'all';
    for (const tab of box.querySelectorAll('.say-tab')) {
      tab.addEventListener('click', () => {
        who = tab.dataset.who;
        for (const t of box.querySelectorAll('.say-tab')) t.classList.toggle('on', t === tab);
        $('#sayToField').hidden = who !== 'one';
        $('#sayState').textContent = who === 'one' ? 'Only they will see it' : 'Everybody will see it';
      });
    }
    $('#sayState').textContent = 'Everybody will see it';

    // The member list, so an ID never has to be typed from memory — they are
    // long, and one wrong character sends a private note into nowhere.
    fetch('/api/members', { headers: { authorization: `Bearer ${Auth.token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (!res?.members) return;
        $('#memberIds').replaceChildren(
          ...res.members.map((m) => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name ? `${m.name} — ${m.id}` : m.id;
            return opt;
          })
        );
      })
      .catch(() => {});

    $('#saySend').addEventListener('click', async () => {
      const err = $('#sayError');
      const title = $('#sayTitle').value.trim();
      const body = $('#sayBody').value.trim();
      const to = who === 'one' ? $('#sayTo').value.trim() : null;

      const complain = (msg) => { err.textContent = msg; err.hidden = false; };
      err.hidden = true;
      if (!title) return complain('Give it a heading.');
      if (!body) return complain('Write what you want to say.');
      if (who === 'one' && !to) return complain('Say whose it is, or switch to Everyone.');

      const btn = $('#saySend');
      btn.disabled = true;
      btn.textContent = 'Posting…';
      const res = await fetch('/api/notices', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${Auth.token}` },
        body: JSON.stringify({ title, body, kind: $('#sayKind').value, to }),
      }).then((r) => r.json()).catch(() => null);
      btn.disabled = false;
      btn.textContent = 'Post it';

      if (!res || res.error) return complain(res?.error ?? 'Could not post that.');
      $('#sayTitle').value = '';
      $('#sayBody').value = '';
      toast(to ? `Sent to ${to}` : 'Posted for everyone');
    });
  }

  /* ---- who may use IELTS training (owner only) ---- */

  // The server decides whether this is shown at all — it knows who the owner
  // is, and a check here would be a suggestion rather than a rule.
  fetch('/api/access/study')
    .then((r) => r.json())
    .then((state) => {
      if (!state.owner || state.owner !== p.id) return;
      const box = $('#accessBox');
      box.hidden = false;

      const paint = (s) => {
        $('#accessState').textContent = s.open ? '🔓 Open to everybody' : `🔒 ${s.allowed.length} allowed`;
        $('#accessState').classList.toggle('warn', s.open);
        $('#accessBlurb').textContent = s.open
          ? 'Anybody with a Hypnic ID can use it. Untick to go back to a list.'
          : 'Only the people below can sign in to IELTS training. Everyone else is told to ask you.';
        $('#accessOpen').checked = s.open;

        $('#accessList').replaceChildren(
          ...s.allowed.map((id) => {
            const row = document.createElement('div');
            row.className = 'access-row';
            row.innerHTML = '<code></code>';
            $('code', row).textContent = id;
            if (id === s.owner) {
              const you = document.createElement('span');
              you.className = 'muted small';
              you.textContent = 'you';
              row.appendChild(you);
            } else {
              const drop = document.createElement('button');
              drop.type = 'button';
              drop.className = 'btn btn-quiet btn-sm';
              drop.textContent = 'Remove';
              drop.addEventListener('click', () => change({ revoke: id }));
              row.appendChild(drop);
            }
            return row;
          })
        );
      };

      const change = async (patch) => {
        showError($('#accessError'), '');
        const res = await fetch('/api/access/study', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${Auth.token}` },
          body: JSON.stringify(patch),
        }).then((r) => r.json()).catch(() => ({ error: 'Could not reach the studio.' }));
        if (res.error) return showError($('#accessError'), res.error);
        paint(res);
        Sound.play('pick');
      };

      paint(state);
      $('#accessAdd').addEventListener('click', () => {
        const id = $('#accessId').value.trim();
        if (!id) return;
        $('#accessId').value = '';
        change({ allow: id });
      });
      $('#accessOpen').addEventListener('change', (e) => change({ open: e.target.checked }));
    })
    .catch(() => {});

  // Arriving from a notice that said "go and set this up" — open the form and
  // put it under their nose rather than leaving them to find it.
  if (sessionStorage.getItem('htfw:goRecovery')) {
    sessionStorage.removeItem('htfw:goRecovery');
    box.form.hidden = false;
    setTimeout(() => {
      $('#recoveryBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
      box.q.focus();
    }, 200);
  }
  void hasIt;

  const winRate = p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) : 0;
  const stats = [
    ['Points', p.points],
    ['Matches', p.gamesPlayed],
    ['Wins', p.wins],
    ['Win rate', winRate, '%'],
    ['Best streak', p.bestStreak],
    ['Titles', p.titles.length],
  ];
  $('#statRow').replaceChildren(
    ...stats.map(([label, value, suffix]) => {
      const box = document.createElement('div');
      box.className = 'stat';
      box.innerHTML = '<b>0</b><small></small>';
      $('small', box).textContent = label;
      const num = $('b', box);
      countUp(num, value);
      if (suffix) setTimeout(() => (num.textContent += suffix), 950);
      return box;
    })
  );

  const allTitles = await Auth.titles();
  const owned = new Map(p.titles.map((t) => [t.id, t]));
  $('#titleCount').textContent = `${p.titles.length}/${Array.isArray(allTitles) ? allTitles.length : 0}`;
  $('#titleWall').replaceChildren(
    ...(Array.isArray(allTitles) ? allTitles : []).map((t) => titleBadge(t, owned.get(t.id)))
  );

  const gameRows = Object.entries(p.stats ?? {});
  $('#gameStats').replaceChildren(
    ...(gameRows.length
      ? gameRows.map(([gameId, s]) => {
          const meta = gameById(gameId);
          const row = document.createElement('div');
          row.className = 'game-stat';
          row.innerHTML = `<span class="gs-emoji">${meta?.emoji ?? '🎮'}</span>
            <span class="pcol"><span class="pname"></span><small></small></span>`;
          $('.pname', row).textContent = meta?.name ?? gameId;
          $('small', row).textContent = `${s.plays} played · ${s.wins} won · best ${s.bestScore}`;
          return row;
        })
      : [Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'No matches yet.' })])
  );

  $('#copyProfileId').addEventListener('click', (e) => copyText(p.id, e.target));
  $('#logoutBtn').addEventListener('click', () => {
    if (!confirm('Sign out? You will need your Hypnic ID and PIN to get back in.')) return;
    Net.leaveRoom();
    Auth.logout();
    go('#/gate');
  });
}

function titleBadge(title, earned) {
  const el = document.createElement('div');
  el.className = earned ? 'badge earned' : 'badge';
  el.innerHTML = '<span class="badge-emoji"></span><b></b><small></small>';
  $('.badge-emoji', el).textContent = earned ? title.emoji : '🔒';
  $('b', el).textContent = title.name;
  $('small', el).textContent = title.desc;
  return el;
}

async function renderTitles() {
  render('view-titles');
  const all = await Auth.titles();
  const owned = new Map((Auth.profile?.titles ?? []).map((t) => [t.id, t]));
  $('#allTitles').replaceChildren(
    ...(Array.isArray(all) ? all : []).map((t) => titleBadge(t, owned.get(t.id)))
  );
}

/* ----------------------------- game mounting ----------------------------- */

async function mountGame(room) {
  // Written here rather than in the router because a match begins on a server
  // message — the router is not involved, and a guard it never updates goes
  // stale the moment the first game starts.
  lastRoute = `${room.code}:play`;
  if (activeGame?.id === room.gameId) return;
  render('view-play');

  // What this button can honestly do depends on who is pressing it. The host
  // can end the match and take everyone back. Anyone else pressing "Lobby"
  // mid-match used to do nothing at all — the room was still 'playing', so the
  // router re-mounted the same game and the screen never changed. They get a
  // button that leaves instead, which is the thing they can actually do.
  const quit = $('#quitBtn');
  // "Back to the lobby" is not something you can do while a match is running —
  // the lobby does not exist yet. Mid-match the only honest option is to walk
  // out, so that is what the button says. It becomes the way back once the
  // match is over.
  const paintQuit = () => {
    const live = Net.room?.phase === 'playing';
    quit.textContent = live ? '← Leave' : '← Lobby';
    quit.title = live ? 'Leave the match — you forfeit' : 'Back to the lobby';
  };
  paintQuit();
  const offPhase = Net.on('room:state', paintQuit);

  quit.addEventListener('click', () => {
    // The results dialog sits over the game; leaving it open would hide
    // whatever we are about to show.
    document.getElementById('overDialog')?.close();

    // Mid-match this is a forfeit, for the host as much as anyone. Once the
    // match is over it is simply the door back to the lobby.
    if (Net.room?.phase === 'playing') {
      Net.leaveRoom();
      return go('#/');
    }
    go(`#/room/${room.code}`);
  });

  const canvas = $('#stage');
  const wrap = $('#stageWrap');
  const hud = $('#hud');

  // Party games all share one renderer; real-time games ship their own.
  const meta = gameById(room.gameId);
  const clientDir = meta?.client ?? room.gameId;

  try {
    const mod = await import(`/games/${clientDir}/client.js`);
    const unmount = await mod.default.mount({ canvas, wrap, hud, Net, room, gameById, meta });
    activeGame = {
      id: room.gameId,
      unmount: () => {
        offPhase();
        unmount?.();
      },
    };
  } catch (err) {
    console.error(err);
    view.innerHTML = `<section class="doc"><a class="back" href="#/" data-nav>&larr; Back</a>
      <h2>Couldn't load that game</h2>
      <p class="muted">Missing <code>public/games/${clientDir}/client.js</code>.</p></section>`;
  }
}

function renderStudio() {
  render('view-studio');
  $('#replayIntro').addEventListener('click', () => playIntro({ force: true }));
}

/* --------------------------------- router -------------------------------- */

function route() {
  const hash = location.hash || '#/';

  // One room URL serves two different screens — the lobby and the game — so the
  // "already here, don't re-render" guard has to compare the screen we want,
  // not the address. Comparing addresses meant that once a game was mounted
  // there was no route back to the lobby, because the URL never changed.
  const cupMatch = hash.match(/^#\/cup\/([A-Za-z0-9]+)$/);
  const roomMatch = hash.match(/^#\/room\/([A-Za-z0-9]{4})$/);
  const code = roomMatch ? roomMatch[1].toUpperCase() : null;
  const wantsGame = Boolean(code) && Net.room?.phase === 'playing' && Net.room.code === code;
  const target = code ? `${code}:${wantsGame ? 'play' : 'lobby'}` : '';

  // `lastRoute` is a record of what is painted, and it is written by the two
  // functions that do the painting — not here. A match starts on a server
  // message, not a URL change, so mountGame gets entered without the router
  // ever running; setting the guard here meant it still read "lobby" while a
  // game was on screen, and every later request for the lobby was dismissed as
  // "you are already there". That is the dead Lobby button after a match.
  if (code && target === lastRoute) return; // room:state ticks must not thrash

  // Anything overlaying the last screen has no business over the next one.
  // A notice opened on the arcade stayed modal across a navigation, so the
  // page underneath could be reached by URL and then not touched.
  for (const dlg of document.querySelectorAll('dialog[open]')) dlg.close();

  cleanupView?.();
  cleanupView = null;
  paintNav();

  // Everything past the gate needs a Hypnic ID.
  if (!Auth.signedIn && !PUBLIC_ROUTES.includes(hash)) {
    if (hash.startsWith('#/room/')) sessionStorage.setItem('htfw:pendingRoom', hash);
    return go('#/gate');
  }
  if (Auth.signedIn && PUBLIC_ROUTES.includes(hash) && hash !== '#/reveal') return go('#/');

  if (code) {
    if (wantsGame) mountGame(Net.room);
    else renderLobby(code);
    return;
  }
  lastRoute = ''; // out of the room entirely — nothing to guard against

  if (cupMatch) return renderCup(cupMatch[1]);

  switch (hash) {
    case '#/gate': return renderLanding();
    case '#/signup': return renderSignup();
    case '#/login': return renderLogin();
    case '#/recover': return renderRecover();
    case '#/reveal': return renderReveal();
    case '#/leaderboard': return renderLeaderboard();
    case '#/profile': return renderProfile();
    case '#/titles': return renderTitles();
    case '#/studio': return renderStudio();
    case '#/how': return render('view-how');
    default: return renderHome();
  }
}

/* --------------------------------- events -------------------------------- */

Net.on('status', ({ online }) => connDot.setAttribute('data-state', online ? 'on' : 'off'));

/* -------------------------------- feedback -------------------------------- */

// Deliberately reachable without signing in. Every real bug in this project so
// far was found by somebody looking at a screen and saying "this isn't
// working" — and the person most likely to hit one is the person who could not
// get past it, who by definition may not be signed in.
function openFeedback() {
  const dlg = document.getElementById('feedbackDialog');
  const text = $('#fbText');
  const send = $('#fbSend');

  showError($('#fbError'), '');
  text.value = '';
  send.disabled = false;
  send.textContent = 'Send it';
  $('#fbWho').textContent = Auth.profile
    ? `Sent as ${Auth.profile.name} — so a reply can find you.`
    : 'Sent anonymously. Sign in first if you would like a reply.';

  $('#fbCancel').onclick = () => dlg.close();
  send.onclick = async () => {
    const body = text.value.trim();
    if (body.length < 3) return showError($('#fbError'), 'Say a little more and it can be acted on.');
    send.disabled = true;
    send.textContent = 'Sending…';
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: body,
        kind: $('#fbKind').value,
        from: Auth.profile?.id ?? null,
        // The name too. An ID on its own is unreadable, and the owner reading
        // a pile of reports needs to know who they are answering.
        fromName: Auth.profile?.name ?? null,
        // Which screen they were on when they gave up, which is usually the
        // first thing you would ask them.
        where: location.hash || '#/',
      }),
    }).then((r) => r.json()).catch(() => ({ error: 'Could not reach the studio.' }));

    if (res.error) {
      send.disabled = false;
      send.textContent = 'Send it';
      return showError($('#fbError'), res.error);
    }
    dlg.close();
    Sound.play('unlock');
    toast('Sent — thank you. It goes straight to the studio.');
  };

  dlg.showModal();
  setTimeout(() => text.focus(), 60);
}

/* --------------------------------- people --------------------------------- */

// Who else is in the studio, and everything you can do about it: open their
// card, ask to be friends, say something, or call them into the room you are
// already sitting in.
const peopleBtn = document.getElementById('peopleBtn');
const peopleCount = document.getElementById('peopleCount');
let people = [];      // the whole membership, online flag included
let pendingIn = [];   // requests waiting on me

async function loadPeople() {
  if (!Auth.token) {
    peopleBtn.hidden = true;
    return;
  }
  const res = await Net.request('social:here', { token: Auth.token });
  if (res?.error) return;
  people = res.directory ?? [];
  pendingIn = res.requests ?? [];
  peopleBtn.hidden = false;
  const nudges = pendingIn.length + (res.unread ?? 0);
  peopleCount.hidden = nudges === 0;
  peopleCount.textContent = nudges > 9 ? '9+' : String(nudges);
  peopleBtn.title = `${people.filter((p) => p.online).length} online · ${people.length} members`;
}

function openPeople() {
  const dlg = document.getElementById('peopleDialog');
  const search = document.getElementById('peopleSearch');

  const paint = () => {
    const term = search.value.trim().toLowerCase();
    const shown = people.filter((p) => !p.you && (!term || p.name.toLowerCase().includes(term)));
    const online = shown.filter((p) => p.online).length;
    document.getElementById('peopleTitle').textContent = `Members · ${online} online of ${people.length}`;

    // Anyone waiting on an answer goes to the top, with the two buttons.
    const reqBox = document.getElementById('peopleRequests');
    reqBox.hidden = pendingIn.length === 0;
    reqBox.replaceChildren(
      ...pendingIn.map((r) => {
        const row = document.createElement('div');
        row.className = 'person request';
        row.innerHTML = '<b></b><span class="muted small">wants to be friends</span>';
        $('b', row).textContent = r.name;
        for (const [label, cls, event] of [
          ['Accept', 'btn-primary', 'social:accept'],
          ['No', 'btn-quiet', 'social:decline'],
        ]) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `btn btn-sm ${cls}`;
          b.textContent = label;
          b.addEventListener('click', async () => {
            await Net.request(event, { token: Auth.token, id: r.from });
            await loadPeople();
            paint();
            Sound.play('join');
          });
          row.appendChild(b);
        }
        return row;
      })
    );

    document.getElementById('peopleList').replaceChildren(
      ...(shown.length
        ? shown.map((p) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `person${p.online ? ' on' : ''}${p.friend ? ' mate' : ''}`;
            row.innerHTML =
              '<span class="dot"></span><span class="person-who"><b></b><small></small></span><span class="person-tag"></span>';
            $('b', row).textContent = p.name;
            $('small', row).textContent = p.where;
            $('.person-tag', row).textContent = p.friend ? 'friend' : `Lv ${p.level}`;
            row.style.setProperty('--who', p.accent);
            row.addEventListener('click', () => {
              dlg.close();
              openCard(p.id);
            });
            return row;
          })
        : [Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Nobody by that name.' })])
    );
  };

  search.oninput = paint;
  search.value = '';
  paint();
  dlg.showModal();
}

/** One member: their card, and what you can do with them. */
async function openCard(id) {
  const dlg = document.getElementById('cardDialog');
  const res = await Net.request('social:card', { id });
  if (res?.error) return;
  const c = res.card;
  const known = people.find((p) => p.id === id) ?? {};

  const av = $('#cardAvatar');
  av.textContent = initials(c.name);
  av.style.background = c.accent;
  $('#cardName').textContent = c.name;
  $('#cardId').textContent = c.id;
  $('#cardSpirit').textContent = `${c.spirit} · Level ${c.level} · member #${c.memberNumber}${c.online ? ' · online' : ''}`;
  showError($('#cardError'), '');

  $('#cardStats').replaceChildren(
    ...[['Points', c.points], ['Matches', c.gamesPlayed], ['Wins', c.wins], ['Best streak', c.bestStreak], ['Titles', c.titles.length]].map(
      ([label, value]) => {
        const box = document.createElement('div');
        box.innerHTML = '<b></b><span></span>';
        $('b', box).textContent = value;
        $('span', box).textContent = label;
        return box;
      }
    )
  );

  const chat = $('#cardChat');
  chat.hidden = !known.friend;
  const actions = $('#cardActions');
  actions.replaceChildren();

  const act = (label, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-sm ${cls}`;
    b.textContent = label;
    b.addEventListener('click', async () => {
      showError($('#cardError'), '');
      const out = await fn();
      if (out?.error) return showError($('#cardError'), out.error);
      Sound.play('join');
      await loadPeople();
      openCard(id);
    });
    actions.appendChild(b);
  };

  if (known.friend) {
    act('Remove friend', 'btn-quiet', () => Net.request('social:remove', { token: Auth.token, id }));
  } else if (known.asking) {
    act('Accept request', 'btn-primary', () => Net.request('social:accept', { token: Auth.token, id }));
  } else if (known.asked) {
    const waiting = document.createElement('span');
    waiting.className = 'muted small';
    waiting.textContent = 'Request sent — waiting on them.';
    actions.appendChild(waiting);
  } else {
    act('Add friend', 'btn-primary', () => Net.request('social:add', { token: Auth.token, id }));
  }

  // Only offer to call somebody in if there is somewhere to call them to.
  if (c.online && Net.room?.code) {
    act('Invite to my room', 'btn-ghost', () => Net.request('social:invite', { token: Auth.token, id }));
  }

  if (known.friend) await openChat(id);
  dlg.showModal();
}

/** The conversation with one friend, and the box to add to it. */
async function openChat(id) {
  const res = await Net.request('social:thread', { token: Auth.token, id });
  const log = $('#dmLog');
  const paint = (messages) => {
    log.replaceChildren(
      ...messages.map((m) => {
        const line = document.createElement('div');
        line.className = `chat-line${m.from === Net.playerId ? ' mine' : ''}`;
        line.innerHTML = '<p></p><time></time>';
        $('p', line).textContent = m.text;
        $('time', line).textContent = when(m.at);
        return line;
      })
    );
    log.scrollTop = log.scrollHeight;
  };
  paint(res?.messages ?? []);

  const form = $('#dmForm');
  const input = $('#dmInput');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const sent = await Net.request('social:say', { token: Auth.token, id, text });
    if (sent?.error) return showError($('#cardError'), sent.error);
    const now = await Net.request('social:thread', { token: Auth.token, id });
    paint(now?.messages ?? []);
  };
}

peopleBtn.addEventListener('click', openPeople);
document.getElementById('peopleClose').addEventListener('click', () => document.getElementById('peopleDialog').close());
document.getElementById('cardClose').addEventListener('click', () => document.getElementById('cardDialog').close());

// Somebody asked, answered, or said something. Refresh the counter and, if the
// conversation is open in front of us, the conversation.
for (const event of ['social:request', 'social:friend', 'social:roster']) {
  Net.on(event, () => loadPeople());
}
Net.on('social:message', async ({ from, name, text }) => {
  await loadPeople();
  const open = document.getElementById('cardDialog').open && $('#cardId').textContent === from;
  if (open) openChat(from);
  else toast(`${name}: ${text.slice(0, 60)}`);
  Sound.play('chat');
});

// A friend calling you into their room, by name rather than by shouting.
Net.on('social:invite', ({ name, code, game, emoji }) => {
  Sound.play('unlock');
  const el = document.createElement('div');
  el.className = 'toast invite';
  el.innerHTML = `<span>${emoji ?? '🎮'}</span><b></b><span class="muted small"></span>`;
  $('b', el).textContent = `${name} wants you in ${game}`;
  $('.muted', el).textContent = `Room ${code}`;
  const join = document.createElement('button');
  join.type = 'button';
  join.className = 'btn btn-primary btn-sm';
  join.textContent = 'Join';
  join.addEventListener('click', async () => {
    el.remove();
    const res = await Net.joinRoom(code);
    if (!res?.error) go(`#/room/${code}`);
  });
  el.appendChild(join);
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 14000);
  setTimeout(() => el.remove(), 14600);
});

Auth.onChange(() => loadPeople());

/* ----------------------------- word from the studio ----------------------- */

// Maintenance, rewards, and anything the owner needs the room to know. A chat
// line scrolls away and half the room was mid-match; this waits until it has
// been read, once, and then stops asking.
const newsBtn = document.getElementById('newsBtn');
const newsCount = document.getElementById('newsCount');
let notices = [];

async function loadNotices() {
  if (!Auth.token) {
    newsBtn.hidden = true;
    return;
  }
  const res = await fetch('/api/notices', { headers: { authorization: `Bearer ${Auth.token}` } })
    .then((r) => r.json())
    .catch(() => null);
  if (!res) return;
  notices = res.notices ?? [];
  newsBtn.hidden = notices.length === 0;
  paintNewsBadge(res.unread ?? 0);
  // Something waiting the first time you arrive deserves to open itself —
  // a badge nobody notices is the same as no message at all.
  // …but never over a live match. A message from the studio landing on top of
  // somebody's board mid-round is worse than one they read a minute later, so
  // it waits for the game to end and opens then.
  if (res.unread > 0 && !sessionStorage.getItem('htfw:newsShown')) {
    sessionStorage.setItem('htfw:newsShown', '1');
    const whenFree = () => {
      if (Net.room?.phase === 'playing' || document.querySelector('dialog[open]')) {
        return setTimeout(whenFree, 4000);
      }
      openNews();
    };
    setTimeout(whenFree, 900);
  }
}

function paintNewsBadge(unread) {
  newsCount.hidden = unread === 0;
  newsCount.textContent = unread > 9 ? '9+' : String(unread);
  newsBtn.classList.toggle('has-news', unread > 0);
}

/** "3 days ago" beats a date nobody can place against their week. */
function when(at) {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / 1440);
  return days < 8 ? `${days}d ago` : new Date(at).toLocaleDateString();
}

/**
 * The button a notice carries, if it is asking for something. Matched on the
 * notice's key rather than its wording, so the text can be rewritten without
 * quietly breaking the link.
 */
function actionFor(notice) {
  if (notice.key === 'set-recovery' || /recovery question/i.test(notice.body ?? '')) {
    return {
      label: 'Set it up now',
      run: () => {
        sessionStorage.setItem('htfw:goRecovery', '1');
        go('#/profile');
      },
    };
  }
  if (notice.link) return { label: notice.linkLabel ?? 'Open', run: () => go(notice.link) };
  return null;
}

function openNews() {
  const dlg = document.getElementById('newsDialog');
  const list = document.getElementById('newsList');
  // Unread first, then newest — with twenty notices the one that matters must
  // not be the one you have to scroll for.
  notices = [...notices].sort((a, b) => (a.read === b.read ? b.at - a.at : a.read ? 1 : -1));
  document.getElementById('newsTitle').textContent =
    notices.filter((n) => !n.read).length > 1 ? `From the studio · ${notices.filter((n) => !n.read).length} new` : 'From the studio';
  if (!notices.length) {
    list.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Nothing from the studio right now.' }));
  } else {
    list.replaceChildren(
      ...notices.map((n) => {
        const card = document.createElement('article');
        card.className = `notice notice-${n.kind}`;
        if (!n.read) card.classList.add('unread');
        card.innerHTML = '<header><b></b><time></time></header><p></p><small></small>';
        $('b', card).textContent = n.title;
        $('time', card).textContent = when(n.at);
        $('p', card).textContent = n.body;
        $('small', card).textContent = n.from;

        // A notice that asks you to do something should take you there. Being
        // told to "open your profile and set a recovery question" and then
        // having to go and find it is most of the reason nobody would.
        const go = actionFor(n);
        if (go) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-primary btn-sm';
          b.textContent = go.label;
          b.addEventListener('click', () => {
            document.getElementById('newsDialog').close();
            go.run();
          });
          card.appendChild(b);
        }
        return card;
      })
    );
  }
  dlg.showModal();
  // Opening it is reading it.
  if (Auth.token) {
    fetch('/api/notices/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${Auth.token}` },
      body: JSON.stringify({ ids: notices.map((n) => n.id) }),
    })
      .then((r) => r.json())
      .then(({ unread }) => {
        for (const n of notices) n.read = true;
        paintNewsBadge(unread ?? 0);
      })
      .catch(() => {});
  }
}

newsBtn.addEventListener('click', openNews);
document.getElementById('newsClose').addEventListener('click', () => document.getElementById('newsDialog').close());
Net.on('notice:new', (notice) => {
  notices = [notice, ...notices.filter((n) => n.id !== notice.id)];
  newsBtn.hidden = false;
  paintNewsBadge(notices.filter((n) => !n.read).length);
  Sound.play('unlock');
});
Auth.onChange(() => loadNotices());
loadNotices();

Net.on('game:start', () => {
  Sound.play('start');
  // Anything the player was reading is over — a match has started and their
  // board is underneath it. Waiting for a quiet moment before opening the
  // notice was not enough on its own: it opens in the arcade, and then the
  // game starts around it.
  for (const id of ['newsDialog', 'peopleDialog', 'cardDialog', 'qrDialog']) {
    document.getElementById(id)?.close();
  }
  if (Net.room) mountGame(Net.room);
});

Net.on('game:over', ({ results }) => {
  const dlg = document.getElementById('overDialog');
  const list = document.getElementById('resultsList');
  const medals = ['🥇', '🥈', '🥉'];
  const iWon = results?.[0]?.playerId === Net.playerId;

  list.replaceChildren(
    ...(results ?? []).map((r) => {
      const li = document.createElement('li');
      if (r.place === 1) li.classList.add('champion');
      li.innerHTML = '<span class="place"></span><span class="rname"></span><span class="score"></span>';
      $('.place', li).textContent = medals[r.place - 1] ?? r.place;
      $('.rname', li).textContent = r.name + (r.playerId === Net.playerId ? ' (you)' : '');
      $('.score', li).textContent = r.score;
      return li;
    })
  );
  document.getElementById('overTitle').textContent = results?.[0] ? `${results[0].name} wins` : 'Game over';
  document.getElementById('rewardBox').hidden = true;
  if (!dlg.open) dlg.showModal();

  Sound.play(iWon ? 'win' : 'lose');
  if (iWon) confetti(dlg, { count: 60 });
});

// Points and unlocked titles arrive separately - they are per player.
Net.on('profile:reward', ({ pointsEarned, newTitles }) => {
  const box = document.getElementById('rewardBox');
  const points = document.createElement('div');
  points.className = 'reward-points';
  points.textContent = `+${pointsEarned} points`;
  box.replaceChildren(points);

  (newTitles ?? []).forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'reward-title';
    el.style.animationDelay = `${160 + i * 120}ms`;
    el.innerHTML = '<span class="em"></span><b></b><small></small>';
    $('.em', el).textContent = t.emoji;
    $('b', el).textContent = `New title — ${t.name}`;
    $('small', el).textContent = t.desc;
    box.appendChild(el);
    // Stagger the chime so three unlocks at once still read as three.
    setTimeout(() => Sound.play('unlock'), 260 + i * 420);
  });
  box.hidden = false;
});

document.getElementById('againBtn').addEventListener('click', () => {
  document.getElementById('overDialog').close();
  // The host resets the room for everyone; everyone else just walks back to
  // the lobby screen and waits there for the next match to be called.
  if (Net.isHost) Net.backToLobby();
  // If we already left the room there is nothing to go back to, and doing
  // nothing strands you on a finished game with no way out.
  go(Net.room ? `#/room/${Net.room.code}` : '#/');
});

// Not everyone wants another round, and while the results are up this is the
// only reachable way out of the room.
document.getElementById('overLeaveBtn').addEventListener('click', () => {
  document.getElementById('overDialog').close();
  Net.leaveRoom();
  go('#/');
});

Net.on('room:state', (room) => {
  // Host sent everyone back to the lobby.
  if (room.phase === 'lobby' && activeGame) go(`#/room/${room.code}`);
});

// Your tie is ready. Nobody should have to type a code to play a tournament
// they already registered for, so the site walks you in.
Net.on('tourney:match', async ({ code, label }) => {
  if (Net.room?.code === code) return;
  const res = await Net.joinRoom(code);
  if (res?.error) return;
  Sound.play('start');
  toast(label ? `${label} — you're in` : 'Your tournament match is ready');
  go(`#/room/${code}`);
});

/** A line that says what just happened and then gets out of the way. */
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3800);
}

/* ---------------------------- stale tab detection -------------------------- */

// An open tab keeps running whatever modules it loaded, so an update can leave
// someone with a page that looks fine and quietly misses new events. The server
// fingerprints its code; the first one we see is ours, and any change after
// that means this tab is out of date.
let knownBuild = null;
Net.on('app:version', ({ build }) => {
  if (!knownBuild) {
    knownBuild = build;
    return;
  }
  if (build === knownBuild || document.querySelector('.stale-bar')) return;

  const bar = document.createElement('div');
  bar.className = 'stale-bar';
  bar.innerHTML = '<span>The arcade was updated.</span><button class="btn btn-primary btn-sm" type="button">Reload</button>';
  bar.querySelector('button').addEventListener('click', () => location.reload());
  document.body.appendChild(bar);
});

/* ------------------------------ room invites ------------------------------ */

// A host calling the room out lands here for everyone else on the site. It is
// an offer, never a redirect — the whole point is that you get to say no.
Net.on('invite:new', (invite) => {
  // Mid-match nothing gets thrown over your game. Merely being seated in a
  // lobby you have wandered away from is not a reason to hide the offer — you
  // are allowed to prefer somewhere else.
  if (activeGame) return;
  if (Net.room?.code === invite.code) return;
  document.querySelector('.invite-card')?.remove();

  const card = document.createElement('div');
  card.className = 'invite-card';
  card.innerHTML = `
    <span class="invite-emoji"></span>
    <div class="invite-text"><b></b><small></small></div>
    <div class="invite-actions">
      <button class="btn btn-primary btn-sm" data-act="join" type="button">Join</button>
      <button class="btn btn-quiet btn-sm" data-act="skip" type="button">Not now</button>
    </div>`;
  $('.invite-emoji', card).textContent = invite.emoji;
  $('b', card).textContent = `${invite.host} is hosting ${invite.game}`;
  $('small', card).textContent =
    `Room ${invite.code} · ${invite.players} ${invite.players === 1 ? 'player' : 'players'} waiting`;

  const dismiss = () => {
    card.classList.add('leaving');
    setTimeout(() => card.remove(), 260);
  };

  card.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'skip') return dismiss();
    const res = await Net.joinRoom(invite.code);
    if (res.error) {
      $('small', card).textContent = res.error;
      return;
    }
    dismiss();
    go(`#/room/${invite.code}`);
  });

  document.body.appendChild(card);
  Sound.play('unlock');
  // It expires on its own — a stale invite for a game that already started is
  // worse than no invite.
  setTimeout(() => card.isConnected && dismiss(), 45000);
});

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-nav]');
  if (link) {
    e.preventDefault();
    go(link.getAttribute('href'));
  }
});
window.addEventListener('hashchange', route);

/* ---------------------------------- boot --------------------------------- */

const loadCatalogue = () =>
  fetch('/api/games')
    .then((r) => r.json())
    .catch(() => []);

/** Keeps asking for the games until the server has some to give. */
let retrying = null;
function retryCatalogue() {
  if (retrying) return;
  let wait = 1500;
  const tick = async () => {
    const list = await loadCatalogue();
    if (Array.isArray(list) && list.length) {
      retrying = null;
      games = list;
      // Redraw whatever is on screen now that there is something to draw.
      if (location.hash === '#/' || !location.hash) renderHome();
      else paintChrome();
      return;
    }
    // Backing off to half a minute: a laptop that is properly off should not
    // be hammered by every open tab in the room.
    wait = Math.min(30000, Math.round(wait * 1.6));
    retrying = setTimeout(tick, wait);
  };
  retrying = setTimeout(tick, wait);
}

(async function boot() {
  // The studio opening plays over the top while everything else loads under
  // it — first thing, so nobody sees a half-painted page before the film.
  maybePlayIntro();

  Net.connect();
  const [catalogue] = await Promise.all([loadCatalogue(), Auth.restore()]);
  games = Array.isArray(catalogue) ? catalogue : [];
  paintChrome();

  // An arcade with no games in it is almost always a page that was opened
  // while the laptop was between restarts — the list is fetched once at boot
  // and, without this, never again. The shelf stayed empty for the rest of the
  // session even after the server came back, with nothing on screen to
  // explain it. So it keeps trying, and it tries again the moment the socket
  // reconnects, which is the earliest possible sign the server is back.
  if (!games.length) retryCatalogue();
  Net.on('status', ({ online }) => {
    if (online && !games.length) retryCatalogue();
  });

  // Someone clicked an invite link before signing in - take them there now.
  const pending = sessionStorage.getItem('htfw:pendingRoom');
  if (pending && Auth.signedIn && (!location.hash || location.hash === '#/')) {
    sessionStorage.removeItem('htfw:pendingRoom');
    return go(pending);
  }

  route();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
