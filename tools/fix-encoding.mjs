// One-off repair for game files whose UTF-8 was read as Windows-1252 and
// written back out as UTF-8.
//
// Most of the damage is reversible: characters that landed in U+0080–U+00FF are
// single bytes of the original sequence. But bytes with no CP1252 mapping (0x81,
// 0x8D, 0x8F, 0x90, 0x9D) were replaced with U+FFFD on the way in, destroying
// them — so anything containing those has to be restored from knowledge of what
// it said, not by transformation. That is what EMOJI and SEQUENCES below are.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Punctuation whose leading byte survived as U+FFFD.
const SEQUENCES = [
  ['�€”', '—'], // E2 80 94  em dash
  ['�€', '”'], // E2 80 9D  right double quote
  ['�€', '“'], // E2 80 9C  left double quote
  ['�€¦', '…'], // E2 80 A6  ellipsis
  ['�€�', '…'], // same, when the tail was lost too
];

// The one thing no rule can recover: which emoji each game had.
const EMOJI = {
  clash: '⚔️',
  'find-word': '\u{1F524}',
  imposter: '\u{1F3AD}',
  movies: '\u{1F3AC}',
  poll: '\u{1F4CA}',
  quiz: '❓',
  situations: '\u{1F914}',
  songs: '\u{1F3B5}',
  'truth-dare': '\u{1F3B2}',
};

let bad = 0;

for (const file of process.argv.slice(2)) {
  const id = path.basename(file, '.js');
  let text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const before = text;

  // Reverse the plain mojibake first: every char <= U+00FF is one original byte.
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) bytes.push(cp);
    else bytes.push(...Buffer.from(ch, 'utf8'));
  }
  text = Buffer.from(bytes).toString('utf8');

  for (const [from, to] of SEQUENCES) text = text.split(from).join(to);

  if (EMOJI[id]) {
    text = text.replace(/^(\s*emoji:\s*')[^']*(',)/m, `$1${EMOJI[id]}$2`);
  }

  const left = (text.match(/�/g) ?? []).length;
  if (left) {
    bad += left;
    console.log(`  \x1b[31m${left} unrecovered\x1b[0m ${file}`);
    for (const line of text.split('\n')) {
      if (line.includes('�')) console.log(`      ${line.trim()}`);
    }
  }

  if (text !== before) {
    writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    console.log(`  repaired ${file}`);
  } else {
    console.log(`  clean    ${file}`);
  }
}

process.exit(bad ? 1 : 0);
