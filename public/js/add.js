// The page where friends send in a picture round.
//
// Everything here is aimed at somebody who is doing this once, on a phone,
// because a friend asked them to. So: no accounts, no jargon, one screen, and
// every refusal says what to do about it rather than what went wrong.
//
// Pictures are shrunk in the browser before they are sent. A phone camera
// produces four megabytes a shot and the game shows them at about two hundred
// pixels; uploading the original would be slow on a hotspot and would fill the
// disk for no visible gain.

const $ = (sel) => document.querySelector(sel);

/** The longest edge we keep. Comfortably more than the grid ever shows. */
const MAX_EDGE = 900;
const JPEG_QUALITY = 0.82;

let kind = 'song';
const shots = new Map(); // slot index -> data URL

/* ------------------------------- song or film ----------------------------- */

for (const btn of document.querySelectorAll('.kind')) {
  btn.addEventListener('click', () => {
    kind = btn.dataset.kind;
    for (const other of document.querySelectorAll('.kind')) other.classList.toggle('on', other === btn);
    // The audio question only makes sense for a song.
    $('#audio').closest('.field').hidden = kind !== 'song';
  });
}

/* ------------------------------ how many boxes ---------------------------- */

const howMany = $('#howMany');
const out = $('#howManyOut');

function drawSlots() {
  const n = Number(howMany.value);
  out.textContent = n;
  const box = $('#shots');
  box.replaceChildren();

  for (let i = 0; i < n; i++) {
    const slot = document.createElement('label');
    slot.className = 'shot';
    slot.innerHTML =
      '<span class="shot-n"></span>' +
      '<span class="shot-hint">tap to add</span>' +
      '<img alt="" hidden />' +
      '<input type="file" accept="image/*" hidden />';
    slot.querySelector('.shot-n').textContent = String(i + 1);

    // Keep whatever was already chosen when the count changes — nobody wants
    // to re-pick four photographs because they moved the slider.
    if (shots.has(i)) {
      const img = slot.querySelector('img');
      img.src = shots.get(i);
      img.hidden = false;
      slot.classList.add('filled');
    }

    slot.querySelector('input').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      slot.classList.add('working');
      try {
        const url = await shrink(file);
        shots.set(i, url);
        const img = slot.querySelector('img');
        img.src = url;
        img.hidden = false;
        slot.classList.add('filled');
      } catch {
        note('That picture could not be read. Try a different one.', true);
      } finally {
        slot.classList.remove('working');
      }
    });

    box.appendChild(slot);
  }

  // Slots beyond the new count are dropped, or a hidden ninth picture would
  // arrive with a round the sender thought had four.
  for (const key of [...shots.keys()]) if (key >= n) shots.delete(key);
}

howMany.addEventListener('input', drawSlots);
drawSlots();

/**
 * Reads a photograph and gives back a smaller JPEG.
 *
 * Done here rather than on the server so the upload itself is small — the
 * person sending this is very likely on the same hotspot as everyone playing.
 */
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
  const pictures = [...shots.entries()].sort((a, b) => a[0] - b[0]).map(([, url]) => url);

  // Said as the next thing to do, not as a complaint about what is missing.
  if (answer.length < 2) return note('Put the answer in first — the song or film name.', true);
  if (pictures.length < 2) return note('Add at least two pictures. They are the round.', true);
  if (pictures.length < Number(howMany.value)) {
    return note(`${Number(howMany.value) - pictures.length} box(es) still empty — fill them or move the slider down.`, true);
  }

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
      /* the round is still worth having without the tune */
    }
  }

  try {
    const res = await fetch('/api/clues', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer, kind, clues, pictures, audio }),
    }).then((r) => r.json());

    if (res.error) {
      send.disabled = false;
      send.textContent = 'Send it in';
      return note(res.error, true);
    }

    $('.add-form').hidden = true;
    $('#done').hidden = false;
    $('#doneWhat').textContent =
      `${answer} — ${pictures.length} pictures${clues.length ? `, ${clues.length} clue${clues.length > 1 ? 's' : ''}` : ''}` +
      `${audio ? ', and the song' : ''}. It is in the game now.`;
  } catch {
    send.disabled = false;
    send.textContent = 'Send it in';
    note('Could not reach the studio. Is the laptop still running it?', true);
  }
});

$('#another').addEventListener('click', () => {
  shots.clear();
  $('#answer').value = '';
  $('#clue1').value = '';
  $('#clue2').value = '';
  $('#audio').value = '';
  $('#addError').hidden = true;
  $('#addNote').hidden = true;
  const send = $('#send');
  send.disabled = false;
  send.textContent = 'Send it in';
  drawSlots();
  $('#done').hidden = true;
  $('.add-form').hidden = false;
  $('#answer').focus();
});
