// Will feedback actually reach the inbox?
//
//   npm run test:mail
//
// Reads the same three settings the studio does and asks Gmail directly. The
// point is to get a straight answer now rather than discovering months later
// that every report has been stored and none of it was ever sent — the failure
// is silent by design, because a note that could not be emailed is still worth
// keeping.
//
// Nothing is sent unless you pass --send.

import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

// The starter script is where these live, and it is not a shell this process
// inherits — so read them from it when they are not already in the environment.
function fromStarter(key) {
  try {
    const text = readFileSync(path.join(ROOT, 'START-ONLINE.cmd'), 'utf8');
    return new RegExp(`^\\s*set ${key}=(.*)$`, 'mi').exec(text)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}
const setting = (key) => (process.env[key] ?? '').trim() || fromStarter(key);

const TO = setting('MAIL_TO');
const USER = setting('MAIL_USER');
// Google shows an App Password as four groups of four. The spaces are for
// reading it; SMTP wants the sixteen characters.
const PASS = setting('MAIL_PASS').replace(/\s+/g, '');

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

console.log('\n  Will feedback reach the inbox?\n');
console.log(`  to     ${TO || red('not set')}`);
console.log(`  from   ${USER || red('not set')}`);
console.log(`  pass   ${PASS ? `${PASS.length} characters` : red('not set')}`);

if (!TO || !USER || !PASS) {
  console.log(red('\n  Not configured. Feedback will be stored and shown on your profile, but not emailed.'));
  console.log(dim('  Fill in MAIL_TO, MAIL_USER and MAIL_PASS in START-ONLINE.cmd.\n'));
  process.exit(1);
}

// Said before the attempt, because "invalid login" from Google does not
// explain which of the several possible mistakes was made, and this is far and
// away the most common one.
if (PASS.length !== 16) {
  console.log(
    `\n  ${red('That does not look like an App Password.')} They are exactly 16 characters —`
  );
  console.log('  Google shows them as four groups of four, like abcd efgh ijkl mnop.');
  console.log(dim('  A 6-digit code from a text message or the Authenticator app is not one:'));
  console.log(dim('  those expire in a minute and cannot be used for mail.'));
  console.log(dim('  Make one at https://myaccount.google.com/apppasswords (needs 2-step verification on).\n'));
}

const transport = nodemailer.createTransport({ service: 'gmail', auth: { user: USER, pass: PASS } });

try {
  await transport.verify();
  console.log(green('\n  Gmail accepted the login. Feedback will arrive in that inbox.'));
} catch (err) {
  console.log(red(`\n  Gmail refused it: ${err.message}`));
  if (/invalid login|badcredentials|535/i.test(err.message)) {
    console.log(dim('  That is the password, not the address. An ordinary account password'));
    console.log(dim('  never works over SMTP — it has to be an App Password.'));
  }
  process.exit(1);
}

if (process.argv.includes('--send')) {
  const info = await transport.sendMail({
    from: `"Hypnic Teen — Fun World" <${USER}>`,
    to: TO,
    subject: '[Fun World] Test — feedback email is working',
    text: 'If you are reading this, feedback from the site will reach you here.\n\nSent by npm run test:mail --send.',
  });
  console.log(green(`  Sent. Check ${TO} — message ${info.messageId}`));
} else {
  console.log(dim('  Nothing sent. Add --send to put a test message in that inbox.'));
}
console.log('');
process.exit(0);
