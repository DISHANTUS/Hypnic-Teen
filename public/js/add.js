// The page where friends make a picture puzzle.
//
// Aimed at somebody doing this once, on a phone, because a friend sent them a
// link — so: no accounts, no jargon, no counting up front. They add pictures
// one at a time, see them in order as they go, and can move or drop any of
// them. Every refusal says what to do next rather than what went wrong.
//
// Pictures are shrunk in the browser before they are sent. A phone camera
// makes four megabytes a shot and the game shows them at about two hundred
// pixels; uploading the original would crawl on a hotspot for no visible gain.

const $ = (sel) => document.querySelector(sel);

/** The longest edge we keep. Comfortably more than the grid ever shows. */
const MAX_EDGE = 900;
const JPEG_QUALITY = 0.82;
/** Not a rule anybody will hit — a stop on a runaway loop or a stuck finger. */
const CEILING = 12;

let kind = 'song';
/** The pictures, in the order they will be shown. */
let shots = [];
/** Everything already sent in, so we can say "that one is done" as they type. */
let taken = [];

/* ----------------------------- what is already in ------------------------- */

/**
 * The same reduction the server does in own-clues.js — keep the two in step.
 *
 * This copy exists so the warning appears as the answer is typed rather than
 * after the pictures have been gathered and sent. The server still decides:
 * this one can be wrong, or stale, or skipped entirely, and nothing breaks.
 */
const titleKey = (raw) =>
  String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\s*the\s+/, '')
    .replace(/[^a-z0-9]+/g, '');

async function loadTaken() {
  try {
    const res = await fetch('/api/clues').then((r) => r.json());
    taken = Array.isArray(res.titles) ? res.titles : [];
  } catch {
    // Not being able to check is not a reason to stop. They can still send it
    // in, and the server refuses a duplicate anyway.
    taken = [];
    $('#takenCount').textContent = 'Could not check what is already in — send it anyway and we will tell you.';
    return;
  }
  paintTaken();
  checkAnswer();
}

/** The list under the search box: matches while searching, everything when not. */
function paintTaken() {
  const q = titleKey($('#lookup').value);
  const list = q ? taken.filter((t) => titleKey(t.answer).includes(q)) : taken;

  $('#takenList').replaceChildren(
    ...list.slice(0, 60).map((t) => {
      const li = document.createElement('li');
      li.className = 'taken-item';
      li.innerHTML = '<span class="taken-kind"></span><b></b><small></small>';
      li.querySelector('.taken-kind').textContent = t.kind === 'movie' ? '🎬' : '🎵';
      li.querySelector('b').textContent = t.answer;
      li.querySelector('small').textContent = `${t.pictures} pictures`;
      return li;
    })
  );

  if (!taken.length) {
    $('#takenCount').textContent = 'Nothing yet — yours would be the first.';
  } else if (q && !list.length) {
    $('#takenCount').textContent = 'Nothing like that yet. It is yours to make.';
  } else if (q) {
    $('#takenCount').textContent = `${list.length} like that already in.`;
  } else {
    $('#takenCount').textContent = `${taken.length} already in${taken.length > 60 ? ' — search to find one' : ''}.`;
  }
}

$('#lookup').addEventListener('input', paintTaken);

/** Warns on the answer field itself, because that is where the decision is made. */
function checkAnswer() {
  const want = titleKey($('#answer').value);
  const warn = $('#answerTaken');
  const hit = want && taken.find((t) => titleKey(t.answer) === want);

  if (hit) {
    warn.textContent = `“${hit.answer}” is already in the game, with ${hit.pictures} pictures. Pick another one.`;
    warn.hidden = false;
  } else {
    warn.hidden = true;
  }
  // Not disabled — the search above is the place to browse, and a person who
  // is sure should be stopped by the server with a reason, not by a dead
  // button with no explanation.
  return Boolean(hit);
}

$('#answer').addEventListener('input', checkAnswer);
loadTaken();

/* ------------------------------- song or film ----------------------------- */

for (const btn of document.querySelectorAll('.kind')) {
  btn.addEventListener('click', () => {
    kind = btn.dataset.kind;
    for (const other of document.querySelectorAll('.kind')) other.classList.toggle('on', other === btn);
    $('#kindNote').textContent =
      kind === 'song' ? 'It will show up in Guess the Song.' : 'It will show up in Guess the Movie.';
    // The audio question only makes sense for a song.
    $('#audioStep').hidden = kind !== 'song';
  });
}

/* -------------------------------- the pictures ---------------------------- */

function paintShots() {
  const box = $('#shots');
  box.replaceChildren(
    ...shots.map((url, i) => {
      const card = document.createElement('figure');
      card.className = 'shot';
      card.innerHTML =
        '<span class="shot-n"></span>' +
        '<img alt="" />' +
        '<span class="shot-acts">' +
        '<button type="button" class="shot-move" data-dir="-1" title="Move earlier">↑</button>' +
        '<button type="button" class="shot-move" data-dir="1" title="Move later">↓</button>' +
        '<button type="button" class="shot-drop" title="Remove">×</button>' +
        '</span>';
      // The number is what players call out across a room, so it is the loudest
      // thing on the card.
      card.querySelector('.shot-n').textContent = String(i + 1);
      card.querySelector('img').src = url;

      for (const b of card.querySelectorAll('.shot-move')) {
        const dir = Number(b.dataset.dir);
        b.disabled = (dir < 0 && i === 0) || (dir > 0 && i === shots.length - 1);
        b.addEventListener('click', () => {
          const to = i + dir;
          [shots[i], shots[to]] = [shots[to], shots[i]];
          paintShots();
        });
      }
      card.querySelector('.shot-drop').addEventListener('click', () => {
        shots.splice(i, 1);
        paintShots();
      });
      return card;
    })
  );

  $('#shotCount').textContent = shots.length
    ? `${shots.length} picture${shots.length === 1 ? '' : 's'}${shots.length < 2 ? ' — one more at least' : ''}`
    : 'No pictures yet.';
  $('#addShot').hidden = shots.length >= CEILING;
}

/**
 * Takes pictures from wherever they came from.
 *
 * The file picker was the only way in, which is the wrong way round on a
 * laptop: the pictures for a puzzle are found in a browser, and the natural
 * thing to do with one is copy it, or drag it straight over. Being made to
 * save it to Downloads first and then hunt for it in a dialog is enough
 * friction to lose a submission.
 */
async function takeFiles(files) {
  const pictures = [...files].filter((f) => f && (f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(f.name ?? '')));
  if (!pictures.length) {
    note('That did not have a picture in it. Try copying the image itself.', true);
    return;
  }

  $('#addShot').classList.add('working');
  let refused = 0;
  for (const file of pictures) {
    if (shots.length >= CEILING) break;
    try {
      shots.push(await shrink(file));
    } catch {
      refused++;
    }
  }
  $('#addShot').classList.remove('working');
  if (refused) note(`${refused === 1 ? 'One of those' : `${refused} of those`} could not be read. Try a different picture.`, true);
  paintShots();
}

// One tap, any number of files — a phone gallery lets you multi-select, and
// refusing that would mean tapping through the picker five times.
$('#addShot').querySelector('input').addEventListener('change', (e) => {
  const files = [...(e.target.files ?? [])];
  e.target.value = ''; // so the same file can be picked again
  if (files.length) takeFiles(files);
});

/* --------------------------- copied and dragged --------------------------- */

// Paste. Anywhere on the page, because there is nothing else on it you would
// paste an image into, and asking somebody to click the right box first is a
// step that only exists to make the code simpler.
document.addEventListener('paste', (e) => {
  // …except in a text box, where a pasted screenshot is not what they meant
  // and their clipboard probably holds the song title.
  const typing = document.activeElement;
  const items = [...(e.clipboardData?.items ?? [])];
  const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (!files.length) return;
  if (typing?.tagName === 'INPUT' && typing.type === 'text' && e.clipboardData?.getData('text')) return;
  e.preventDefault();
  takeFiles(files);
});

// Drag and drop. The whole page is the target, so there is no small rectangle
// to hit — but the box says so, and lights up, or nobody would know.
const dropZone = document.querySelector('.add-page') ?? document.body;
let dragDepth = 0;

// Both of these must be cancelled or the browser navigates away to the image,
// losing everything typed so far.
for (const type of ['dragover', 'dragenter']) {
  dropZone.addEventListener(type, (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    if (type === 'dragenter' && dragDepth++ === 0) document.body.classList.add('dropping');
  });
}
// Counted rather than toggled: dragging across a child element fires leave on
// the parent, and a plain toggle flickers the whole page as you move.
dropZone.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dropping');
  }
});
dropZone.addEventListener('drop', (e) => {
  if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dropping');
  takeFiles(e.dataTransfer?.files ?? []);
});

paintShots();

/** Reads a photograph and gives back a smaller JPEG. */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('unreadable'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('not an image'));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* --------------------------------- sending -------------------------------- */

function note(text, bad = false) {
  const el = bad ? $('#addError') : $('#addNote');
  const other = bad ? $('#addNote') : $('#addError');
  other.hidden = true;
  el.textContent = text;
  el.hidden = false;
}

const readFile = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('unreadable'));
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });

$('#send').addEventListener('click', async () => {
  const answer = $('#answer').value.trim();
  const clues = [$('#clue1').value.trim(), $('#clue2').value.trim()].filter(Boolean);

  // Said as the next thing to do, not as a complaint about what is missing.
  if (answer.length < 2) return note('Put the answer in first — the song or film name.', true);
  // Caught here as well as on the server, because the upload is several
  // megabytes over a hotspot and there is no sense spending it on a refusal.
  if (checkAnswer()) return note('That one is already in the game. Try another song or film.', true);
  if (shots.length < 2) return note('Add at least two pictures. They are the puzzle.', true);

  const send = $('#send');
  send.disabled = true;
  send.textContent = 'Sending…';
  note('Sending — this can take a moment on a hotspot.');

  let audio = null;
  const audioFile = $('#audio').files?.[0];
  if (kind === 'song' && audioFile) {
    try {
      audio = await readFile(audioFile);
    } catch {
      /* the puzzle is still worth having without the tune */
    }
  }

  try {
    const res = await fetch('/api/clues', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer, kind, clues, pictures: shots, audio }),
    }).then((r) => r.json());

    if (res.error) {
      send.disabled = false;
      send.textContent = 'Send it in';
      // Somebody else got there first while this one was being filled in. Take
      // the server's word for it and put it in the list, so the warning under
      // the answer field now agrees with the message they just read.
      if (res.taken && !taken.some((t) => titleKey(t.answer) === titleKey(res.taken))) {
        taken.push({ answer: res.taken, kind: null, pictures: 0 });
        paintTaken();
        checkAnswer();
      }
      return note(res.error, true);
    }

    taken.push({ answer: res.answer, kind, pictures: res.pictures });
    paintTaken();

    $('.add-form').hidden = true;
    $('.how-it-works').hidden = true;
    $('#done').hidden = false;
    $('#doneWhat').textContent =
      `${answer} — ${shots.length} pictures` +
      `${clues.length ? `, ${clues.length} clue${clues.length > 1 ? 's' : ''}` : ''}` +
      `${audio ? ', and the song' : ''}. It is in ${kind === 'song' ? 'Guess the Song' : 'Guess the Movie'} now.`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    send.disabled = false;
    send.textContent = 'Send it in';
    note('Could not reach the studio. Is the laptop still running it?', true);
  }
});

$('#another').addEventListener('click', () => {
  shots = [];
  for (const id of ['#answer', '#clue1', '#clue2', '#audio']) $(id).value = '';
  $('#addError').hidden = true;
  $('#addNote').hidden = true;
  $('#answerTaken').hidden = true;
  const send = $('#send');
  send.disabled = false;
  send.textContent = 'Send it in';
  paintShots();
  $('#done').hidden = true;
  $('.add-form').hidden = false;
  $('.how-it-works').hidden = false;
  $('#answer').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
