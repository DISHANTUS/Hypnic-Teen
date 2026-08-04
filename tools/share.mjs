// Puts the studio on a public https link so you can send it to someone who
// isn't on your WiFi.
//
//   npm run share
//
// Uses localhost.run over plain SSH — no account, no install, nothing to sign
// up for (ssh already ships with Windows, macOS and Linux). The link lives as
// long as this stays running; close it and the link dies.
//
// For a link that survives closing your laptop, deploy instead — see the
// "Sending someone a link" section of the README.

import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT) || 8008;
const banner = (msg) => console.log(msg);

banner('\n  Opening a public tunnel to localhost:' + PORT + '…');
banner('  (first connection asks you to trust the host key — type "yes")\n');

const ssh = spawn(
  'ssh',
  [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=30',
    '-R', `80:localhost:${PORT}`,
    'nokey@localhost.run',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

let announced = false;

function scan(chunk) {
  const text = chunk.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.lhr\.life/i);
  if (match && !announced) {
    announced = true;
    const url = match[0];
    banner('\n  ──────────────────────────────────────────────');
    banner('   Your studio is live at:');
    banner(`\n   \x1b[36m${url}\x1b[0m\n`);
    banner('   Send that to anyone, on any network.');
    banner('   Ctrl+C here closes it.');
    banner('  ──────────────────────────────────────────────\n');
  } else if (!announced) {
    process.stdout.write(text);
  }
}

ssh.stdout.on('data', scan);
ssh.stderr.on('data', scan);

ssh.on('error', (err) => {
  console.error('\n  Could not start ssh:', err.message);
  console.error('  Is OpenSSH installed? On Windows: Settings → Apps → Optional features → OpenSSH Client.\n');
  process.exit(1);
});

ssh.on('exit', (code) => {
  banner(`\n  Tunnel closed (exit ${code}). The public link no longer works.\n`);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  ssh.kill();
  process.exit(0);
});
