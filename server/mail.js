// Getting a message off this laptop and into an inbox.
//
// Feedback is already stored and shown on the owner's profile, which is enough
// when the owner is the person running the laptop. It is not enough when they
// are asleep, or at college, or the studio has been restarted since — so a
// copy goes to their email as well.
//
// Sending is best-effort by design. A complaint that could not be emailed is
// still a complaint worth keeping, so a failure here is logged and swallowed
// rather than turned into an error the person who wrote it has to see.
//
// Configure with, in .env or the environment:
//
//   MAIL_TO        where notes should land
//   MAIL_USER      the Gmail address sending them
//   MAIL_PASS      a Google App Password, not the account password
//
// Gmail refuses ordinary passwords over SMTP. An App Password needs two-step
// verification switched on, then one generated at:
//   https://myaccount.google.com/apppasswords

import nodemailer from 'nodemailer';

const TO = (process.env.MAIL_TO ?? '').trim();
const USER = (process.env.MAIL_USER ?? '').trim();
const PASS = (process.env.MAIL_PASS ?? '').trim();

export const mailConfigured = Boolean(TO && USER && PASS);

let transport = null;
if (mailConfigured) {
  transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: USER, pass: PASS },
  });
  // Checked once at boot rather than on the first message, so a wrong password
  // is a line in the terminal now instead of a silent loss later.
  transport.verify().then(
    () => console.log(`[mail] ready — notes will reach ${TO}`),
    (err) => console.warn(`[mail] cannot send: ${err.message}`)
  );
} else if (TO || USER || PASS) {
  console.warn('[mail] half configured — needs MAIL_TO, MAIL_USER and MAIL_PASS. Notes will only be stored.');
}

/**
 * Sends one piece of feedback on. Never throws and never blocks the caller.
 *
 * @param {{text:string, kind:string, from?:string|null, where?:string|null}} note
 */
export function mailFeedback(note) {
  if (!transport) return;

  const kind = { bug: 'Something is broken', idea: 'An idea', game: 'A game needs work', other: 'Something else' }[note.kind] ?? 'Feedback';
  // The subject carries enough to triage from a phone's lock screen, because
  // that is where it will be read.
  const subject = `[Fun World] ${kind}: ${note.text.slice(0, 60)}${note.text.length > 60 ? '…' : ''}`;

  transport
    .sendMail({
      from: `"Hypnic Teen — Fun World" <${USER}>`,
      to: TO,
      subject,
      text: [
        note.text,
        '',
        '—',
        `Kind:  ${kind}`,
        `From:  ${note.from ?? 'not signed in'}`,
        `Screen: ${note.where ?? 'unknown'}`,
        `Sent:  ${new Date().toLocaleString()}`,
        '',
        'Also saved in the studio — see your profile.',
      ].join('\n'),
    })
    .then(
      () => console.log(`[mail] sent to ${TO}`),
      // Swallowed on purpose. The note is already on disk; failing to email it
      // is not a reason to tell the person who wrote it that it did not work.
      (err) => console.warn(`[mail] could not send: ${err.message}`)
    );
}
